var GAME = (function () {
    "use strict";

    var UNSELECTED = -1,
        BEAN_TOUCH_RADIUS = 0.05,
        CLOSE_DRAW_TIMER = 500;

    function Images(batch) {
        this.bean = batch.load("bean.png");
        this.line = batch.load("lineGlow.png");
    }

    function Bean(position, angle) {
        this.position = position;
        this.angle = angle;
        this.selected = false;
        this.size = 20;
    }

    Bean.prototype.draw = function (context, images, bounds) {
        context.save();
        var pos = bounds.interpolate(this.position),
            tint = this.selected ? [1, .5, .5] : null;
        context.translate(pos.x, pos.y);
        context.rotate(this.angle);
        BLIT.draw(
            context, images.bean,
            0, 0,
            BLIT.ALIGN.Center,
            this.size, this.size,
            BLIT.MIRROR.None,
            tint
        );
        context.restore();
    }

    function Player(direction) {
        this.direction = direction;
    }

    function BeanPatch() {
        this.beans = [];
        this.lastTouchID = null;
        this.openLoop = [];
        this.closedLoop = null;

        this.closeDraw = null;
        this.lastTouchPos = null;
    }

    BeanPatch.prototype.sproutAt = function (position, angle) {
        for (var b = 0; b < this.beans.length; ++b) {
            if(R2.pointDistance(this.beans[b].position, position) < 2 * BEAN_TOUCH_RADIUS)
            {
                return false;
            }
        }
        this.beans.push(new Bean(position, angle));
        return true;
    }

    BeanPatch.prototype.sprout = function (entropy) {
        var attempts = 0;
        while(!this.sproutAt(randomPoint(entropy), R2.FULL_CIRCLE * entropy.random()))
        {
            ++attempts;
            if(attempts > 1000000) {
                throw "No place for bean! - too many attempts";
            }
        }
    }

    function valueToByte(value) {
        return Math.floor(value * 255);
    }

    function tintToStyle(tint) {
        return "rgba(" +
            valueToByte(tint[0]) + "," +
            valueToByte(tint[1]) + "," +
            valueToByte(tint[2]) + "," +
            valueToByte(tint[3]) +
        ")";
    }

    BeanPatch.prototype.drawSelection = function (context, images, bounds, selection, closed, opposite) {
        var poly = this.selectionToPoly(selection, bounds, opposite),
            tint = opposite ? [.5,.5, 1, .5] : [1, .5, .5, .5];

        if (closed)
        {
            context.save();
            context.beginPath();
            var style = tintToStyle(tint);
            context.fillStyle = style;
            for (var s = 0; s < poly.length; ++s) {
                var segment = poly[s];
                if (s === 0) {
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

    BeanPatch.prototype.selectionToPoly = function (selection, bounds, opposite) {
        var poly = [];
        for (var s = 0; s < (selection.length - 1); ++s) {
            poly.push(new R2.Segment(
                bounds.interpolate(selection[s].position),
                bounds.interpolate(selection[s+1].position)
            ));
        }
        if(!opposite && selection.length > 0 && this.lastTouchPos)
        {
            poly.push(new R2.Segment(
                bounds.interpolate(selection[selection.length-1].position),
                bounds.interpolate(this.lastTouchPos)
            ));
        }
        return poly;
    }

    BeanPatch.prototype.selectBean = function (bean) {
        bean.selected = true;
        this.openLoop.push(bean);
    }

    BeanPatch.prototype.closeLoop = function (bean) {
        this.closedLoop = this.openLoop;
        this.closedLoop.push(bean);
        this.closeDraw = CLOSE_DRAW_TIMER;
        this.openLoop = [];
    }

    BeanPatch.prototype.finalizeLoop = function () {
        this.closeDraw = null;
        for (var b = 0; b < this.closedLoop.length - 1; ++b) {
            var bean = this.closedLoop[b];
            this.beans.splice(this.beans.indexOf(bean), 1);
        }
        this.closedLoop = null;
    }

    BeanPatch.prototype.update = function (elapsed, bounds, otherPatch, touches) {
        if (this.closeDraw != null) {
            this.closeDraw -= elapsed;
            if (this.closeDraw < 0) {
                this.finalizeLoop();
            }
        }
        this.lastTouchPos = null;
        for (var t = 0; t < touches.length; ++t) {
            var touchPoint = touches[t];
            for (var b = 0; b < this.beans.length; ++b) {
                var bean = this.beans[b],
                    distance = R2.pointDistance(bean.position, touchPoint);
                if (distance < BEAN_TOUCH_RADIUS) {
                    if(!bean.selected) {
                        this.selectBean(bean);
                    } else if(this.openLoop.length > 2 && this.openLoop[0] == bean) {
                        this.closeLoop(bean);
                    }
                }
            }
            this.lastTouchPos = touchPoint;
        }
    }

    BeanPatch.prototype.drawSelections = function (context, images, bounds, opposite) {
        this.drawSelection(context, images, bounds, this.openLoop, false, opposite);
        if(this.closedLoop) {
            this.drawSelection(context, images, bounds, this.closedLoop, true, opposite);
        }
    }

    BeanPatch.prototype.draw = function (context, images, bounds) {
        this.drawSelections(context, images, bounds, false);
        for (var b = 0; b < this.beans.length; ++b) {
            this.beans[b].draw(context, images, bounds);
        }
    }

    BeanPatch.prototype.drawOpposite = function (context, images, bounds) {
        this.drawSelections(context, images, bounds, true);
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

        this.entropy = ENTROPY.makeRandom();
        for (var p = 0; p < this.patches.length; ++p) {
            this.sproutBeans(p, 44, this.entropy);
        }
        this.patches[0].nextSelection = UNSELECTED;

        this.loadState = null;
    }

    Game.prototype.sproutBeans = function (patchIndex, count, entropy) {
        var patch = this.patches[patchIndex];
        for (var b = 0; b < count; ++b) {
            patch.sprout(entropy);
        }
    }

    Game.prototype.mapToBounds = function (patch, location) {
        var x = location.x,
            y = location.y;
        if(patch === 0) {
            x = this.split - x;
        } else {
            x = x - this.split;
        }
        x -= this.bounds.left;
        return new R2.V(x / this.bounds.width, (y - this.bounds.top) / this.bounds.height);
    }

    Game.prototype.mapLocation = function (location, touches) {
        var touchPatch = 0;
        if(location.x > this.split)
        {
            touchPatch = 1;
        }
        touches[touchPatch].push(this.mapToBounds(touchPatch, location));
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
        if (this.loadState !== null) {
            return;
        }

        var border = 10;

        this.split = width / 2;
        this.bounds = new R2.AABox(border, border, this.split - 2 * border, height - 2 * border);

        var touches = [
            [],
            []
        ]

        if(pointer.touch.touches.length > 0) {
            for(var t = 0; t < pointer.touch.touches.length; ++t) {
                var touch = pointer.touch.touches[t];
                this.mapLocation(new R2.V(touch.clientX, touch.clientY), touches);
            }
        } else if(pointer.location()) {
            this.mapLocation(pointer.location(), touches);
        }

        this.patches[0].update(elapsed, this.bounds, this.patches[1], touches[0]);
        this.patches[1].update(elapsed, this.bounds, this.patches[0], touches[1]);
    }

    Game.prototype.draw = function (context, width, height) {
        if (this.loadState !== null) {
            return;
        }

        context.strokeStyle = "rgba(128, 128, 128, 255)";
        context.strokeRect(this.split, 0, 1, height);
        context.save();
        context.translate(this.split, 0);
        context.scale(-1, 1);
        this.patches[1].drawOpposite(context, this.images, this.bounds);
        this.patches[0].draw(context, this.images, this.bounds);
        context.restore();
        context.save();
        context.translate(this.split, 0);
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
        } else {
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
