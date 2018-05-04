var GAME = (function () {
    "use strict";

    function Game(viewport) {
        this.clearColor = [0,0,0,1];
        this.maximize = viewport === "safe";
        this.updateInDraw = true;
        this.preventDefaultIO = true;
        this.viewport = viewport ? viewport : "canvas";
        this.program = null;

        this.eyeHeight = 1.0;
        this.things = [];
        this.loadState = "loading";
        this.tint = 0;

        this.setup();
    }

    Game.prototype.setup = function ()
    {
        var self = this;
        this.batch = new BLIT.Batch("blitblort/images/", function() {
            self.postLoad();
        });

        this.cubeUV = this.batch.load("cubeUV.png");

        this.batch.commit();
    }

    Game.prototype.postLoad = function()
    {
        this.defaultCube = GEO.makeCube(1.0, null, 1/128, true);
        this.uvCube = GEO.makeCube(1.0, false);
        var thing1 = new BLOB.Thing(this.defaultCube);
        thing1.move(new R3.V(0,0,-1.5));
        this.things.push(thing1);

        this.uvCube.image = this.cubeUV;
        var thing2 = new BLOB.Thing(this.uvCube, null, 1/256, false);
        thing2.move(new R3.V(0,0,1.5));
        this.things.push(thing2);

        this.loadState = null;
    }

    Game.prototype.setupRoom = function (room) {
        this.program = room.programFromElements("vertex-test", "fragment-test", true, false, true);

        room.viewer.near = 0.05;
        room.viewer.far = 15;
        room.gl.enable(room.gl.CULL_FACE);
        room.gl.blendFunc(room.gl.SRC_ALPHA, room.gl.ONE_MINUS_SRC_ALPHA);
        room.gl.enable(room.gl.BLEND);
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
        var angle = elapsed * 0.001;
        for (var t = 0; t < this.things.length; ++t) {
            this.things[t].rotate(angle, new R3.V(0, 1, 0));
            this.things[t].rotate(angle * 0.5, new R3.V(1, 0, 0));
        }
    }

    Game.prototype.eyePosition = function ()
    {
        return new R3.V(-5, this.eyeHeight, 0);
    }

    Game.prototype.render = function (room, width, height) {
        room.clear(this.clearColor);
        if (this.loadState !== null) {
            return;
        }

        var tintUniform = room.gl.getUniformLocation(this.program.shader, "uTint");
        room.gl.uniform4f(tintUniform, 0.0, 0.0, 0.0, this.tint);

        if (room.viewer.showOnPrimary()) {
            var eye = this.eyePosition();
            room.viewer.positionView(eye, new R3.V(0, 0, 0), new R3.V(0, 1, 0));
            room.setupView(this.program, this.viewport);
            room.gl.depthMask(true);

            for (var t = 0; t < this.things.length; ++t) {
                var thing = this.things[t];
                thing.render(room, this.program);
            }
        }
    }

    function geoTest() {
        var cylinder = GEO.makeCylinder(1.0, 1.0, 32, WGL.uvFill(), false);
        var plane = GEO.makePlane(WGL.uvFill());
    }

    function start() {
        if (MAIN.runTestSuites() === 0) {
            console.log("All Tests Passed!");
            geoTest();
        }
        var canvas = document.getElementById("canvas3D"),
            game = new Game("safe");
        game.inputElement = document;
        MAIN.start(canvas, game);

        window.addEventListener("mouseDown", function(e) {
            window.focus();
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    window.onload = function(e) {
        MAIN.setupToggleControls();
        start();
    };

    return {
    };
}());
