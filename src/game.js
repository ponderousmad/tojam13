var GAME = (function () {
    "use strict";

    var UNSELECTED = -1,
        BEAN_RADIUS = 0.05,
        CLOSE_DRAW_TIMER = 500,
        LOW_POWER_WARNING_COOLDOWN = 500,
        BORDER_FRACTION = 0.05,
        BEAN_FRACTION = 0.04,
        BEANS_PER_PLAYER = 55,
        MAX_POWER = 5,
        START_POWER = 1,
        POWER_PER_BEAN = (MAX_POWER - START_POWER) / (2 * BEANS_PER_PLAYER),
        POINTS_PER_SAVE = 50,
        POINTS_PER_CAPTURE = 100,
        BEANLESS_BONUS = 500;

    function Images(batch) {
        this.bean = batch.load("bean.png");
        this.line = batch.load("lineGlow.png");
    }

    function Bean(position, angle, size) {
        this.position = position;
        this.angle = angle;
        this.selected = false;
        this.size = size;
    }

    Bean.prototype.draw = function (context, images, bounds, captured) {
        context.save();
        var pos = bounds.interpolate(this.position),
            tint = captured ?  [0, 1, 0] : (this.selected ? [1, .5, .5] : null);
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

    function PowerBar() {
        this.reset();
    }

    PowerBar.prototype.reset = function () {
        this.level = START_POWER;
        this.drawLevel = 0;
        this.pendingDraw = 0;        
    }

    PowerBar.prototype.setDraw = function (draw, pending) {
        this.drawLevel = draw;
        this.pendingDraw = pending;
    }

    PowerBar.prototype.isEmpty = function () {
        return this.drawLevel + this.pendingDraw > this.level;
    }

    PowerBar.prototype.drawBar = function (context, swapped, barEdge, barWidth, start, size) {
        if (swapped) {
            context.fillRect(start, barEdge, size, barWidth);
        } else {
            context.fillRect(barEdge, start, barWidth, size);
        }
    }

    PowerBar.prototype.draw = function (context, images, bounds, swapped, flip) {
        var border = swapped ? bounds.top : bounds.left,
            barEdge = Math.floor(bounds.left * 0.1),
            barWidth = Math.floor(bounds.left * 0.5),
            min = 0,
            max = swapped ? (bounds.right + bounds.left) - min: // Reconstruct width;
                            (bounds.bottom + bounds.top) - min, // Reconstruct height;
            unitCount = (max - min) / MAX_POWER,
            overStyle = "rgba(255,0,0,255)";
        context.save();
        context.fillStyle = "rgba(0,128,0,255)";
        var size = unitCount * this.level,
            start = flip ? max - size : min;
        this.drawBar(context, swapped, barEdge, barWidth, start, size);
        size = unitCount * this.drawLevel;
        start = flip ? min - size : max;
        if (size > 0) {
            context.fillStyle = this.isEmpty() ? overStyle : "rgba(196,255,0,255)";
            this.drawBar(context, swapped, barEdge, barWidth, start, size);
        }
        if (this.pendingDraw > 0) {
            var pendingSize = this.pendingDraw * unitCount;
            start = flip ? start - pendingSize : start + size;
            context.fillStyle = this.isEmpty() ? overStyle : "rgba(255,196,0,255)";
            this.drawBar(context, swapped, barEdge, barWidth, start, size);
        }
        context.restore();
    }

    function BeanPatch() {
        this.powerBar = new PowerBar();
    }

    BeanPatch.prototype.reset = function () {
        this.beans = [];
        this.lastTouchID = null;
        this.openLoop = [];
        this.closedLoop = null;
        this.captured = null;

        this.closeDraw = null;
        this.lastTouchPos = null;
        this.lowPowerWarningTimer = -1;
        this.saved = 0;
        this.captured = 0;

        this.score = 0;

        this.powerBar.reset();
    }

    BeanPatch.prototype.sproutAt = function (position, angle, size) {
        for (var b = 0; b < this.beans.length; ++b) {
            if(R2.pointDistance(this.beans[b].position, position) < 2 * BEAN_RADIUS) {
                return false;
            }
        }
        this.beans.push(new Bean(position, angle, Math.floor(size * BEAN_RADIUS)));
        return true;
    }

    BeanPatch.prototype.sprout = function (entropy, size) {
        var attempts = 0;
        while (!this.sproutAt(randomPoint(entropy), R2.FULL_CIRCLE * entropy.random(), size)) {
            ++attempts;
            if (attempts > 1000000) {
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
        var poly = this.selectionToPoly(selection, bounds, !closed && !opposite),
            tint = opposite ? [.5,.5, 1, .5] : [1, .5, .5, .5];

        if (closed) {
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

    BeanPatch.prototype.selectionToPoly = function (selection, bounds, includeLastTouch) {
        var poly = [];
        for (var s = 0; s < (selection.length - 1); ++s) {
            poly.push(new R2.Segment(
                bounds.interpolate(selection[s].position),
                bounds.interpolate(selection[s+1].position)
            ));
        }
        if(includeLastTouch && selection.length > 0 && this.lastTouchPos) {
            poly.push(new R2.Segment(
                bounds.interpolate(selection[selection.length-1].position),
                bounds.interpolate(this.lastTouchPos)
            ));
        }
        return poly;
    }

    function checkWinding(edge, test) {
        if(!edge.intersects(test)) {
            return 0;
        }/*
        else if(edge.direction().cross(test.direction()) > 0) {
            return 1;
        } else {
            return -1;
        }*/
        return 1;
    }

    function isInPoly(poly, point) {
        var testSegment = new R2.Segment(0, 0, point.x, point.y),
            windingCount = 0;

        for(var l = 0; l < poly.length; ++l) {
            windingCount += checkWinding(poly[l], testSegment);
        }
        return windingCount % 2 == 1;
    }

    BeanPatch.prototype.selectBean = function (bean) {
        if (this.openLoop) {
            bean.selected = true;
            this.openLoop.push(bean);
        }
    }

    function removeItems(list, toRemove) {
        for (var i = 0; i < toRemove.length; ++i) {
            var index = list.indexOf(toRemove[i]);
            if (index >= 0) {
                list.splice(index, 1);
            }
        }
    }

    BeanPatch.prototype.closeLoop = function (bean, otherPatch) {
        this.closedLoop = this.openLoop;
        this.closedLoop.push(bean);
        this.closeDraw = CLOSE_DRAW_TIMER;
        this.openLoop = null;

        var poly = this.selectionToPoly(this.closedLoop, new R2.AABox(0, 0, 1, 1), false);

        for (var b = 0; b < this.beans.length; ++b) {
            var bean = this.beans[b];
            if (!bean.selected) {
                if (isInPoly(poly, bean.position)) {
                    bean.selected = true;
                }
            }
        }

        otherPatch.captured = [];
        for (var c = 0; c < otherPatch.beans.length; ++c) {
            var bean = otherPatch.beans[c];

            if (isInPoly(poly, bean.position)) {
                bean.selected = false;
                otherPatch.captured.push(bean);
            }
        }
        if (otherPatch.openLoop) {
            removeItems(otherPatch.openLoop, otherPatch.captured);
            removeItems(otherPatch.beans, otherPatch.captured);
        }
    }

    BeanPatch.prototype.finalizeLoop = function (otherPatch) {
        this.closeDraw = null;
        for (var b = 0; b < this.beans.length; ++b) {
            var bean = this.beans[b];
            if (bean.selected && this.closedLoop.indexOf(bean) < 0) {
                this.closedLoop.push(bean);
            }
        }

        var saved = this.closedLoop.length - 1,
            captured = otherPatch.captured.length;
        this.saved += saved;
        this.captured += captured;
        this.powerBar.level += (saved + captured) * POWER_PER_BEAN;
        removeItems(this.beans, this.closedLoop);
        this.closedLoop = null;
        otherPatch.captured = null;
    }

    function pathCost(selection) {
        var startPos = selection[0].position,
            prev = startPos,
            power = 0;
        for (var s = 1; s < selection.length; ++s) {
            var bean = selection[s];
            power += R2.pointDistance(prev, bean.position);
            prev = bean.position;
        }
        power += R2.pointDistance(prev, startPos);
        return(power);
    }

    BeanPatch.prototype.findPath = function (choices, chosen) {
        if (chosen.length === 3) {
            return pathCost(chosen) < this.powerBar.level;
        }
        var subChoices = choices.slice();
        while (subChoices.length + chosen.length > 2) {
            var choice = subChoices.pop(),
                subChosen = chosen.slice();
                subChosen.push(choice);
            if(this.findPath(subChoices, subChosen)) {
                return(true);
            }
        }
        return(false);
    }

    BeanPatch.prototype.isValidMove = function () {
        if (this.beans.length < 3) {
            return false;
        } else if (this.beans.length > 6) {
            return true;
        }
        return this.findPath(this.beans, []);
    }

    BeanPatch.prototype.isAnimationPending = function () {
        if (this.closeDraw) {
            return(true);
        }
    }

    BeanPatch.prototype.isGameOver = function () {
        if (this.isValidMove()) {
            return false;
        }
        if (this.isAnimationPending()) {
            return false;
        }
        return true;
    }

    BeanPatch.prototype.update = function (elapsed, bounds, otherPatch, touches) {
        if (this.closeDraw != null) {
            this.closeDraw -= elapsed;
            if (this.closeDraw < 0) {
                this.finalizeLoop(otherPatch);
            }
        }
        this.lowPowerWarningTimer -= elapsed;
        var power = 0, pending = 0, prev = null;
        if (this.openLoop && this.openLoop.length > 0) {
            prev = this.openLoop[0].position;
            for (var s = 1; s < this.openLoop.length; ++s) {
                var bean = this.openLoop[s];
                power += R2.pointDistance(prev, bean.position);
                prev = bean.position;
            }
        }

        this.lastTouchPos = null;
        for (var t = 0; t < touches.length; ++t) {
            var touchPoint = touches[t];
            if (this.openLoop != null) {
                for (var b = 0; b < this.beans.length; ++b) {
                    var bean = this.beans[b],
                        distance = R2.pointDistance(bean.position, touchPoint);
                    if (distance < BEAN_RADIUS) {
                        var powerStep = (this.openLoop.length > 0 ? R2.pointDistance(prev, bean.position) : 0),
                            lowPower = (power + powerStep) > this.powerBar.level;
                        if (!bean.selected && !bean.captured) {
                            if (!lowPower) {
                                if (this.selectBean(bean)) {
                                    power += powerStep;
                                    prev += bean.position;
                                }
                            } else {
                                this.warnLowPower(bean);
                            }
                        } else if(this.openLoop.length > 2 && this.openLoop[0] == bean) {
                            if (!lowPower) {
                                power += powerStep;
                                prev = bean.position;
                                this.closeLoop(bean, otherPatch);
                            } else {
                                this.warnLowPower(bean);
                            }
                        }
                    }
                }
            }
            this.lastTouchPos = touchPoint;
        }

        if (this.lastTouchPos) {
            if (prev) {
                pending = R2.pointDistance(prev, this.lastTouchPos);
            }
        } else {
            if (this.openLoop) {
                for (var o = 0; o < this.openLoop.length; ++o) {
                    this.openLoop[o].selected = false;
                }
            }
            this.openLoop = [];
            this.powerBar.drawLevel = 0;
        }
        this.powerBar.setDraw(power, pending);

        return this.isGameOver();
    }

    BeanPatch.prototype.warnLowPower = function () {
        if (this.lowPowerWarningTimer < 0)
        {
            this.lowPowerWarningTimer = LOW_POWER_WARNING_COOLDOWN;
        }
    }

    BeanPatch.prototype.drawSelections = function (context, images, bounds, opposite) {
        if (this.openLoop) {
            this.drawSelection(context, images, bounds, this.openLoop, false, opposite);
        }
        if (this.closedLoop) {
            this.drawSelection(context, images, bounds, this.closedLoop, true, opposite);
        }
    }

    BeanPatch.prototype.draw = function (context, images, bounds, swapped, patchIndex) {
        this.drawSelections(context, images, bounds, false);
        for (var b = 0; b < this.beans.length; ++b) {
            this.beans[b].draw(context, images, bounds, false);
        }
        if (this.captured) {
            for (var c = 0; c < this.captured.length; ++c) {
                this.captured[c].draw(context, images, bounds, true);
            }
        }
        this.powerBar.draw(context, images, bounds, swapped, patchIndex === 0);
    }

    BeanPatch.prototype.drawOpposite = function (context, images, bounds) {
        this.drawSelections(context, images, bounds, true);
    }

    function randomPoint(entropy) {
        return new R2.V(entropy.random(), entropy.random());
    }

    function Game(width, height) {
        this.clearColor = [0,0,1,1];
        this.maximize = true;
        this.updateInDraw = true;
        this.preventDefaultIO = true;

        this.loadState = "loading";
        this.swapped = height > width;
        this.split = Math.max(width, height) / 2;
        this.size = Math.min(width, height);
        this.currentScreen = null;

        this.entropy = ENTROPY.makeRandom();

        this.patches = [
            new BeanPatch(),
            new BeanPatch()
        ];

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

    Game.prototype.reset = function () {
        for (var p = 0; p < this.patches.length; ++p) {
            var patch = this.patches[p];
            patch.reset();
            for (var b = 0; b < BEANS_PER_PLAYER; ++b) {
                patch.sprout(this.entropy, this.size);
            }
        }
        this.currentScreen = null;
    }

    Game.prototype.postLoad = function () {
        this.reset();
        this.loadState = null;
    }

    Game.prototype.mapToBounds = function (patch, location) {
        var x = location.x,
            y = location.y;
        if (this.swapped) {
            if(patch === 0) {
                y = this.split - y;
            } else {
                y = y - this.split;
            }
        } else {
            if(patch === 0) {
                x = this.split - x;
            } else {
                x = x - this.split;
            }
        }
        x -= this.bounds.left;
        y -= this.bounds.top;
        return new R2.V(x / this.bounds.width, y / this.bounds.height);
    }

    Game.prototype.mapLocation = function (location, touches) {
        var touchPatch = 0;
        if (this.swapped ? location.y > this.split : location.x > this.split) {
            touchPatch = 1;
        }
        touches[touchPatch].push(this.mapToBounds(touchPatch, location));
    }

    Game.prototype.goto = function (target) {
        if (target == "RESTART") {
            this.reset();
        }
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
        var border = Math.floor(height * BORDER_FRACTION);

        this.swapped = height > width;
        this.split = Math.max(width, height) / 2;
        if (this.swapped) {
            this.bounds = new R2.AABox(border, border, width - 2 * border, this.split - 2 * border);
        } else {
            this.bounds = new R2.AABox(border, border, this.split - 2 * border, height - 2 * border);
        }

        if (this.currentScreen) {
            var target = this.currentScreen.update(elapsed, keyboard, pointer, width, height, this.swapped);
            if (target) {
                this.goto(target);
            }
            return;
        }

        if (this.loadState !== null) {
            return;
        }

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

        var endGame = null,
            pCount = this.patches.length;
        for (var p = 0; p < pCount; ++p) {
            if (this.patches[p].update(elapsed, this.bounds, this.patches[pCount - (p+1)], touches[p])) {
                endGame = p;
            }
        }
        if (endGame !== null) {
            this.startEndGame(endGame);
        }
    }

    function GameOverScreen(message) {
        this.message = message;
        this.showTime = 1000;
        this.isOverlay = true;
    }

    GameOverScreen.prototype.update = function (elapsed, keyboard, pointer, width, height, swapped) {
        this.showTime -= elapsed;
        if (this.showTime < 0 && (keyboard.keysDown() > 0 || pointer.activated())) {
            return("RESTART");
        }
        return(null);
    }

    GameOverScreen.prototype.draw = function (context, width, height, swapped) {
        context.save();
        context.font = "40px sans-serif";
        BLIT.centeredText(
            context, this.message,
            width / 2, height / 2,
            "rgba(255,255,255,255)",
            "rgba(128,128,128,255)",
            2
        );
        context.restore();
    }

    function OverlayScreen(image, target, showTime) {
        this.image = image;
        this.showTime = showTime | 1000;
        this.target = target;
        this.isOverlay = true;
    }

    OverlayScreen.prototype.update = function (elapsed, keyboard, pointer, width, height, swapped) {
        this.showTime -= elapsed;
        if (this.showTime < 0 && (keyboard.keysDown() > 0 || pointer.activated())) {
            return(this.target);
        }
        return(null);
    }

    OverlayScreen.prototype.draw = function (context, width, height, swapped) {
        context.save();
        context.font = "40px sans-serif";
        BLIT.centeredText(
            context, this.message,
            width / 2, height / 2,
            "rgba(255,255,255,255)",
            "rgba(128,128,128,255)",
            2
        );
        context.restore();
    }

    Game.prototype.startEndGame = function (patchIndex) {
        this.currentScreen = new GameOverScreen("The " + (patchIndex ? "Red" : "Blue") + " player is out of moves!");
    }

    Game.prototype.draw = function (context, width, height) {
        if (this.currentScreen && !this.currentScreen.isOverlay) {
            this.currentScreen.draw(context, width, height, this.swapped);
            return;
        }

        if (this.loadState !== null) {
            return;
        }

        context.save();
        context.strokeStyle = "rgba(128, 128, 128, 255)";
        if (this.swapped) {
            context.strokeRect(0, this.split, width, 1);
            context.translate(0, this.split);
            context.scale(1, -1);
        } else {
            context.strokeRect(this.split, 0, 1, height);
            context.translate(this.split, 0);
            context.scale(-1, 1);
        }
        this.patches[1].drawOpposite(context, this.images, this.bounds);
        this.patches[0].draw(context, this.images, this.bounds, this.swapped, 0);
        context.restore();
        context.save();
        if (this.swapped) {
            context.translate(0, this.split);
        } else {
            context.translate(this.split, 0);
        }
        this.patches[0].drawOpposite(context, this.images, this.bounds);
        this.patches[1].draw(context, this.images, this.bounds, this.swapped, 1);
        context.restore();

        if(this.currentScreen)
        {
            this.currentScreen.draw(context, width, height, this.swapped);
        }
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
            game = new Game(canvas.width, canvas.height);
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
