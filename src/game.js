var GAME = (function () {
    "use strict";

    function Images(batch) {
        this.bean = batch.load("bean.png");
    }

    function Bean(position, angle) {
        this.position = position;
        this.angle = angle;
        this.selectionOrder = -1;
        this.size = 20;
    }

    Bean.prototype.draw = function (context, images, bounds)
    {
        context.save();
        var x = bounds.left + Math.floor(this.position.x * bounds.width),
            y = bounds.top + Math.floor(this.position.y * bounds.height);
        context.translate(x, y);
        context.rotate(this.angle);
        BLIT.draw(
            context, images.bean,
            0, 0,
            BLIT.ALIGN.Center,
            this.size, this.size
        );
        context.restore();
    }

    function Player(direction) {
        this.direction = direction;
    }

    function BeanPatch() {
        this.beans = [];
    }

    BeanPatch.prototype.sproutAt = function(position, angle) {
        this.beans.push(new Bean(position, angle));
    }

    BeanPatch.prototype.sprout = function(entropy) {
        this.sproutAt(randomPoint(entropy), R2.FULL_CIRCLE * entropy.random());
    }

    BeanPatch.prototype.draw = function(context, images, bounds) {
        for (var b = 0; b < this.beans.length; ++b) {
            this.beans[b].draw(context, images, bounds);
        }
    }

    function randomPoint(entropy) {
        return new R2.V(entropy.random(), entropy.random());
    }

    function Game(height) {
        this.clearColor = [0,0,1,1];
        this.maximize = true;
        this.updateInDraw = true;
        this.preventDefaultIO = true;

        this.loadState = "loading";
        this.split = height / 2;

        this.setup();
    }

    Game.prototype.setup = function () {
        var self = this;
        this.batch = new BLIT.Batch("images/", function() {
            self.postLoad();
        });

        this.images = new Images(this.batch);

        this.batch.commit();
    }

    Game.prototype.postLoad = function() {
        this.patches = [
            new BeanPatch(),
            new BeanPatch()
        ];

        this.entropy = new ENTROPY.Entropy(12334);
        for (var p = 0; p < this.patches.length; ++p) {
            this.sproutBeans(p, 10, this.entropy);
        }

        this.loadState = null;
    }

    Game.prototype.sproutBeans = function(patchIndex, count, entropy) {
        var patch = this.patches[patchIndex];
        for (var b = 0; b < count; ++b) {
            patch.sprout(entropy);
        }
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
        this.split = height / 2;
    }

    Game.prototype.draw = function (context, width, height) {
        if (this.loadState !== null) {
            return;
        }

        var border = 10,
            bounds = new R2.AABox(border, border, width - 2 * border, this.split - 2 * border);
        context.strokeStyle = "rgba(128, 128, 128, 255)";
        context.strokeRect(0, this.split, width, 1);
        context.save();
        context.translate(0, this.split);
        this.patches[0].draw(context, this.images, bounds);
        context.restore();
        context.save();
        context.translate(0, this.split);
        context.scale(1, -1);
        this.patches[1].draw(context, this.images, bounds);
        context.restore();
    }

    function start() {
        if (MAIN.runTestSuites() === 0) {
            console.log("All Tests Passed!");
        }
        var canvas = document.getElementById("canvas"),
            game = new Game(canvas.height);
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
