var GAME = (function () {
    "use strict";

    var UNSELECTED = -1;

    function Images(batch) {
        this.bean = batch.load("bean.png");
        this.line = batch.load("lineGlow.png");
    }

    function Bean(position, angle) {
        this.position = position;
        this.angle = angle;
        this.selectionOrder = UNSELECTED;
        this.size = 20;
    }

    Bean.prototype.draw = function (context, images, bounds) {
        context.save();
        var pos = bounds.interpolate(this.position),
            tint = this.selectionOrder != UNSELECTED ? [255, 128, 128] : null;
        context.translate(pos.x, pos.y);
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
        this.nextSelection = 0;
    }

    BeanPatch.prototype.isSelectionClosed = function () {
        return this.nextSelection == UNSELECTED;
    }

    BeanPatch.prototype.sproutAt = function (position, angle) {
        this.beans.push(new Bean(position, angle));
    }

    BeanPatch.prototype.sprout = function (entropy) {
        this.sproutAt(randomPoint(entropy), R2.FULL_CIRCLE * entropy.random());
    }

    BeanPatch.prototype.getSelection = function () {
        var selection = [];
        for (var b = 0; b < this.beans.length; ++b) {
            var bean = this.beans[b];
            if(bean.selectionOrder != UNSELECTED) {
                selection[bean.selectionOrder] = bean;
            }
        }

        for (var s = 0; s < selection.length; ++s) {
            if(!selection[s]) {
                throw "Invalid selection";
            }
        }
        if(this.isSelectionClosed()) {
            selection.push(selection[0]);
        }
        return selection;
    }

    function valueToByte(value)
    {
        return Math.floor(value * 255);
    }

    function tintToStyle(tint)
    {
        var style = "rgba(" +
            valueToByte(tint[0]) + "," +
            valueToByte(tint[1]) + "," +
            valueToByte(tint[2]) + "," +
            valueToByte(tint[3]) +
        ")";
        console.log(style);
        return(style);
    }

    BeanPatch.prototype.drawSelection = function (context, images, bounds, selection, closed, opposite) {
        var poly = this.selectionToPoly(selection, bounds),
            tint = opposite ? [.5,.5, 1, .5] : [1, .5, .5, .5];

        if(closed)
        {
            context.save();
            context.beginPath();
            var style = tintToStyle(tint);
            context.fillStyle = style;
            for (var s = 0; s < poly.length; ++s) {
                var segment = poly[s];
                if(s === 0) {
                    context.moveTo(segment.start.x, segment.start.y);
                }
                context.lineTo(segment.end.x, segment.end.y);
            }
            context.closePath();
            context.fill();
            context.restore();
        }

        for (var s = 0; s < poly.length; ++s) {
            var segment = poly[s],
                mid = segment.interpolate(0.5),
                length = segment.length();

            context.save();
            context.translate(mid.x, mid.y);
            context.rotate(segment.angle());
            BLIT.draw(context, images.line, 0, 0, BLIT.ALIGN.Center, length, images.line.height, BLIT.MIRROR.None, tint);
            context.restore();
        }
    }

    BeanPatch.prototype.selectionToPoly = function (selection, bounds) {
        var poly = [];
        for (var s = 0; s < (selection.length - 1); ++s) {
            poly.push(new R2.Segment(
                bounds.interpolate(selection[s].position),
                bounds.interpolate(selection[s+1].position)
            ));
        }
        return poly;
    }

    BeanPatch.prototype.update = function (elapsed, bounds, otherPatch) {

    }

    BeanPatch.prototype.draw = function (context, images, bounds) {
        var selection = this.getSelection();
        this.drawSelection(context, images, bounds, selection, this.isSelectionClosed(), false);
        for (var b = 0; b < this.beans.length; ++b) {
            this.beans[b].draw(context, images, bounds);
        }
    }

    BeanPatch.prototype.drawOpposite = function (context, images, bounds) {
        var selection = this.getSelection();
        this.drawSelection(context, images, bounds, selection, this.isSelectionClosed(), true);
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

    Game.prototype.postLoad = function () {
        this.patches = [
            new BeanPatch(),
            new BeanPatch()
        ];

        this.entropy = new ENTROPY.Entropy(12334);
        for (var p = 0; p < this.patches.length; ++p) {
            this.sproutBeans(p, 10, this.entropy);
        }
        this.patches[0].nextSelection = UNSELECTED;

        this.loadState = null;
    }

    Game.prototype.sproutBeans = function (patchIndex, count, entropy) {
        var patch = this.patches[patchIndex];
        for (var b = 0; b < count; ++b) {
            patch.sprout(entropy);
            if (b < 3) {
                patch.beans[b].selectionOrder = b;
            }
        }
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
        if (this.loadState !== null) {
            return;
        }

        var border = 10;

        this.split = width / 2;
        this.bounds = new R2.AABox(border, border, this.split - 2 * border, height - 2 * border);

        this.patches[0].update(elapsed, this.bounds, this.patches[1]);
        this.patches[1].update(elapsed, this.bounds, this.patches[0]);
    }

    Game.prototype.draw = function (context, width, height) {
        if (this.loadState !== null) {
            return;
        }

        context.strokeStyle = "rgba(128, 128, 128, 255)";
        context.strokeRect(this.split, 0, 1, height);
        context.save();
        context.translate(this.split, 0);
        this.patches[1].drawOpposite(context, this.images, this.bounds);
        this.patches[0].draw(context, this.images, this.bounds);
        context.restore();
        context.save();
        context.translate(this.split, 0);
        context.scale(-1, 1);
        this.patches[0].drawOpposite(context, this.images, this.bounds);
        this.patches[1].draw(context, this.images, this.bounds);
        context.restore();
    }

    function toggleFullScreen() {
        var doc = window.document;
        var docEl = doc.documentElement;
      
        var requestFullScreen = docEl.requestFullscreen || docEl.mozRequestFullScreen || docEl.webkitRequestFullScreen || docEl.msRequestFullscreen;
        var cancelFullScreen = doc.exitFullscreen || doc.mozCancelFullScreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      
        if(!doc.fullscreenElement && !doc.mozFullScreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
          requestFullScreen.call(docEl);
        }
        else {
          cancelFullScreen.call(doc);
        }
    }

    Game.prototype.setupControls = function () {
        var goFS = document.getElementById("buttonFullscreen");
        goFS.addEventListener("click", function() {
            toggleFullScreen();
        }, false);
    }

    function start() {
        if (MAIN.runTestSuites() === 0) {
            console.log("All Tests Passed!");
        }
        var canvas = document.getElementById("canvas"),
            game = new Game(canvas.height);
        game.inputElement = document;
        game.setupControls();
        MAIN.start(canvas, game);

        window.addEventListener("mouseDown", function (e) {
            window.focus();
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    window.onload = function (e) {
        MAIN.setupToggleControls();
        start();
    };

    return {
    };
}());
