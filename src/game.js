var GAME = (function () {
    "use strict";

    function Game(viewport) {
        this.clearColor = [0,0,0,1];
        this.maximize = viewport === "safe";
        this.updateInDraw = true;
        this.preventDefaultIO = true;
        this.viewport = viewport ? viewport : "canvas";
        this.program = null;
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
    }

    Game.prototype.render = function (room, width, height) {
        room.clear(this.clearColor);
    }

    function geoTest() {
        var cube = GEO.makeCube(1.0, true);
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
