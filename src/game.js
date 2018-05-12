var GAME = (function () {
    "use strict";

    var BEAN_RADIUS = 0.05,
        CLOSE_DRAW_TIMER = 500,
        CAPTURE_DELAY = 100,
        LOW_POWER_WARNING_COOLDOWN = 500,
        BORDER_FRACTION = 0.07,
        BEAN_FRACTION = 0.04,
        BEANS_PER_PLAYER = 55,
        MAX_POWER = 5,
        START_POWER = 1,
        POWER_PER_BEAN = (MAX_POWER - START_POWER) / (2 * BEANS_PER_PLAYER),
        POINTS_PER_SAVE = 50,
        POINTS_PER_CAPTURE = 100,
        DEFAULT_FRAME_TIME = 32,
        BEANLESS_BONUS = 500,
        GAME_VOLUME = 0.4,
        TITLE_VOLUME = 0.9,
        RED_COLOR = "rgba(255,0,51,255)",
        BLUE_COLOR = "rgba(0,170,255,255)";

    function Images(batch, index, other) {
        var BEAN_FRAMES = 12,
            SELECT_FRAMES = 18,
            DEATH_FRAMES = 12;
        this.beans = index ? other.beans : [
            new BLIT.Flip(batch, "beanIdle/beanIdleA_", BEAN_FRAMES, 2),
            new BLIT.Flip(batch, "beanIdle/beanIdleB_", BEAN_FRAMES, 2),
            new BLIT.Flip(batch, "beanIdle/beanIdleC_", BEAN_FRAMES, 2)
        ];
        var selectBase = index ? "beanSelectBlue/beanSelectBlue_" : "beanSelectRed/beanSelectRed_";
        this.select = new BLIT.Flip(batch, selectBase, SELECT_FRAMES, 2);
        this.death = index ? other.death : new BLIT.Flip(batch, "beanDeath/beanDeath_", DEATH_FRAMES, 2);
        this.line = batch.load(index ? "line_blue.png" : "line_red.png");
        this.dot = batch.load(index ? "dot_blue.png" : "dot_red.png");
        this.lineBad = index ? other.lineBad : batch.load("line_grey.png");
    }

    function makeImages(batch) {
        var images = new Images(batch, 0, null);
        return [
            images,
            new Images(batch, 1, images)
        ];
    }

    function Sounds(captures, player) {
        this.entropy = ENTROPY.makeRandom();
        this.captures = captures;
        this.selects = [
            new BLORT.Noise("sounds/P" + player + "_SelectBean_01.wav"),
            new BLORT.Noise("sounds/P" + player + "_SelectBean_02.wav"),
            new BLORT.Noise("sounds/P" + player + "_SelectBean_03.wav")
        ];
        this.creates = [
            new BLORT.Noise("sounds/P" + player + "_CreateShape.wav")
        ];
        this.powerDowns = [
            new BLORT.Noise("sounds/P" + player + "_OutOfPower.wav")
        ];
    }

    Sounds.prototype.play = function (set) {
        this.entropy.randomElement(set).play();
    }

    Sounds.prototype.select = function () {
        this.play(this.selects);
    }

    Sounds.prototype.capture = function () {
        this.play(this.captures);
    }

    Sounds.prototype.powerDown = function () {
        this.play(this.powerDowns);
    }

    Sounds.prototype.create = function () {
        this.play(this.creates);
    }

    function makeSounds() {
        var captures = [
                new BLORT.Noise("sounds/BeanStolen_01.wav"),
                new BLORT.Noise("sounds/BeanStolen_02.wav"),
                new BLORT.Noise("sounds/BeanStolen_03.wav"),
            ];
        return [
            new Sounds(captures, "1"),
            new Sounds(captures, "2")
        ];
    }

    function Bean(position, size, images, entropy) {
        this.position = position;
        var range = Math.PI / 20;
        this.angle = -range + 2 * range * entropy.random();
        this.rate = entropy.random() + 0.1;
        this.idle = entropy.randomElement(images.beans).setupPlayback(DEFAULT_FRAME_TIME, true, entropy.randomInt(1000));
        this.selectFlip = images.select;
        this.sel = null;
        this.death = null;
        this.size = size;
    }

    Bean.prototype.select = function () {
        this.sel = this.selectFlip.setupPlayback(DEFAULT_FRAME_TIME, false);
    }

    Bean.prototype.unselect = function () {
        this.sel = null;
    }

    Bean.prototype.isSelected = function() {
        return this.sel !== null;
    }

    Bean.prototype.draw = function (context, images, bounds, captured, swapped) {
        context.save();
        var pos = bounds.interpolate(this.position);
        context.translate(pos.x, pos.y);
        context.rotate(this.angle - (swapped ? 0 : Math.PI / 2));
        var flip = this.isSelected() ? this.sel : this.idle,
            scaleFactor = this.isSelected() || captured ? 2 : 2 * 64/96,
            size = this.size * scaleFactor;
        if (captured) {
            if (this.death === null) {
                this.death = images.death.setupPlayback(DEFAULT_FRAME_TIME, false);
            }
            flip = this.death;
        }
        flip.draw(context, 0, 0, BLIT.ALIGN.Center, size, size);
        context.restore();
    }

    Bean.prototype.update = function (elapsed) {
        this.idle.update(Math.floor(this.rate * elapsed));
        if (this.isSelected()) {
            this.sel.update(elapsed);
        }
        if (this.death !== null) {
            this.death.update(elapsed);
        }
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
        start = flip ? max - size : min;
        if (size > 0) {
            context.fillStyle = this.isEmpty() ? overStyle : "rgba(196,255,0,255)";
            this.drawBar(context, swapped, barEdge, barWidth, start, size);
        }
        if (this.pendingDraw > 0) {
            var pendingSize = this.pendingDraw * unitCount;
            start = flip ? start - pendingSize : start + size;
            context.fillStyle = this.isEmpty() ? overStyle : "rgba(255,196,0,255)";
            this.drawBar(context, swapped, barEdge, barWidth, start, pendingSize);
        }
        context.restore();
    }

    function BeanPatch(sounds) {
        this.powerBar = new PowerBar();
        this.sounds = sounds;
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
        this.saveCount = 0;
        this.captureCount = 0;

        this.powerBar.reset();
    }

    BeanPatch.prototype.score = function () {
        var score = 0;
        score += this.saveCount * POINTS_PER_SAVE;
        score += this.captureCount * POINTS_PER_CAPTURE
        if (this.beans.length == 0) {
            score += BEANLESS_BONUS;
        }
        return(score);
    }

    BeanPatch.prototype.sproutAt = function (position, size, images, entropy) {
        for (var b = 0; b < this.beans.length; ++b) {
            if(R2.pointDistance(this.beans[b].position, position) < 2 * BEAN_RADIUS) {
                return false;
            }
        }
        this.beans.push(new Bean(position, Math.floor(size * BEAN_RADIUS), images, entropy));
        return true;
    }

    BeanPatch.prototype.sprout = function (size, images, entropy) {
        var attempts = 0;
        while (!this.sproutAt(randomPoint(entropy), size, images, entropy)) {
            ++attempts;
            if (attempts > 1000000) {
                throw "No place for bean! - too many attempts";
            }
        }
    }

    function valueToByte(value) {
        return Math.floor(value * 255);
    }

    BeanPatch.prototype.drawSelection = function (context, images, bounds, selection, closed, opposite, index) {
        var poly = this.selectionToPoly(selection, bounds, !closed && !opposite);
        context.save();
        if (opposite) {
            context.globalAlpha = 0.5;
        }
        if (closed) {
            context.save();
            context.beginPath();
            context.fillStyle = index ? BLUE_COLOR : RED_COLOR;
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
                length = segment.length(),
                dot = images.dot;

            if (opposite) {
                BLIT.draw(context, dot, segment.start.x, segment.start.y, BLIT.ALIGN.Center, dot.width /2, dot.height/2);
            }

            context.save();
            context.translate(mid.x, mid.y);
            context.rotate(segment.angle());
            var lineImage = this.powerBar.isEmpty() ? images.lineBad : images.line;
            BLIT.draw(context, lineImage, 0, 0, BLIT.ALIGN.Center, length, lineImage.height / 2, BLIT.MIRROR.None);
            context.restore();
        }
        context.restore();
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
            bean.select();
            this.openLoop.push(bean);
            this.sounds.select();
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
        this.sounds.create();

        var poly = this.selectionToPoly(this.closedLoop, new R2.AABox(0, 0, 1, 1), false);

        for (var b = 0; b < this.beans.length; ++b) {
            var bean = this.beans[b];
            if (!bean.isSelected()) {
                if (isInPoly(poly, bean.position)) {
                    bean.select();
                }
            }
        }

        otherPatch.captured = [];
        for (var c = 0; c < otherPatch.beans.length; ++c) {
            var bean = otherPatch.beans[c];

            if (isInPoly(poly, bean.position)) {
                bean.unselect();
                otherPatch.captured.push(bean);
            }
        }
        this.pendingCaptures = otherPatch.captured.length;
        if (otherPatch.openLoop) {
            removeItems(otherPatch.openLoop, otherPatch.captured);
            removeItems(otherPatch.beans, otherPatch.captured);
        }
    }

    BeanPatch.prototype.finalizeLoop = function (otherPatch) {
        this.closeDraw = null;
        for (var b = 0; b < this.beans.length; ++b) {
            var bean = this.beans[b];
            if (bean.isSelected() && this.closedLoop.indexOf(bean) < 0) {
                this.closedLoop.push(bean);
            }
        }

        var saved = this.closedLoop.length - 1,
            captured = otherPatch.captured.length;
        this.saveCount += saved;
        this.captureCount += captured;
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
        } else if (this.beans.length > 10) {
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
            if (this.pendingCaptures > 0) {
                var before = Math.floor(this.closeDraw / CAPTURE_DELAY),
                    after = Math.floor((this.closeDraw - elapsed) / CAPTURE_DELAY);
                if (before != after) {
                    --this.pendingCaptures;
                    this.sounds.capture();
                    console.log("Playing capture after " + after);
                }
            }

            this.closeDraw -= elapsed;
            if (this.closedLoop && this.closeDraw < 0) {
                this.finalizeLoop(otherPatch);
            }
        }
        for (var a = 0; a < this.beans.length; ++a) {
            this.beans[a].update(elapsed);
        }
        if (this.captured) {
            for (var c = 0; c < this.captured.length; ++c) {
                this.captured[c].update(elapsed);
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
                        if (!bean.isSelected() && !bean.captured) {
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
                    this.openLoop[o].unselect();
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

    BeanPatch.prototype.drawSelections = function (context, images, bounds, opposite, index) {
        if (this.openLoop) {
            this.drawSelection(context, images, bounds, this.openLoop, false, opposite, index);
        }
        if (this.closedLoop) {
            this.drawSelection(context, images, bounds, this.closedLoop, true, opposite, index);
        }
    }

    BeanPatch.prototype.draw = function (context, images, bounds, swapped, patchIndex) {
        this.drawSelections(context, images, bounds, false, patchIndex);
        for (var b = 0; b < this.beans.length; ++b) {
            this.beans[b].draw(context, images, bounds, false, swapped);
        }
        if (this.captured) {
            for (var c = 0; c < this.captured.length; ++c) {
                this.captured[c].draw(context, images, bounds, true, swapped);
            }
        }
        this.powerBar.draw(context, images, bounds, swapped, patchIndex === 0);
    }

    BeanPatch.prototype.drawOpposite = function (context, images, bounds, patchIndex) {
        this.drawSelections(context, images, bounds, true, patchIndex);
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

        var sounds = makeSounds();

        this.patches = [
            new BeanPatch(sounds[0]),
            new BeanPatch(sounds[1])
        ];

        this.setup();
    }

    Game.prototype.setup = function () {
        var self = this;
        this.batch = new BLIT.Batch("images/", function() {
            self.postLoad();
        });

        this.images = makeImages(this.batch);

        this.track = new BLORT.Tune("sounds/BattleBeans_Music");
        this.music = null;
        this.winSound = new BLORT.Noise("sounds/SomeoneWon.wav");
        this.startSound = new BLORT.Noise("sounds/StartSplatter.wav");

        this.titleBackground = this.batch.load("titleBackground.jpg");
        this.gameBackground = this.batch.load("gameBackground.jpg");

        var CAN_IDLE_FRAMES = 24,
            CAN_OPEN_FRAMES = 29,
            SPIN_FRAMES = 24;
        this.canIdle = new BLIT.Flip(this.batch, "canIdle/canIdle_", CAN_IDLE_FRAMES, 2);
        this.canOpen = new BLIT.Flip(this.batch, "canOpen/canOpen_", CAN_OPEN_FRAMES, 2);
        this.spinBean = new BLIT.Flip(this.batch, "spinningBean/spinningBean_", SPIN_FRAMES, 2);
        this.spinPlay = this.spinBean.setupPlayback(DEFAULT_FRAME_TIME, true);

        this.batch.commit();
    }

    Game.prototype.reset = function () {
        for (var p = 0; p < this.patches.length; ++p) {
            var patch = this.patches[p];
            patch.reset();
            for (var b = 0; b < BEANS_PER_PLAYER; ++b) {
                patch.sprout(this.size, this.images[p], this.entropy);
            }
        }
        this.currentScreen = new TitleScreen(this.canIdle, this.canOpen);
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
        } else if (target == "FADE") {
            this.currentScreen = new FadeScreen();
        } else if (target == "SPLATTER") {
            this.startSound.play();
        } else if (target == "START") {
            this.currentScreen = null;
        }
    }

    Game.prototype.update = function (now, elapsed, keyboard, pointer, width, height) {
        if (this.music === null && pointer.activated()) {
            if (this.track.isLoaded()) {
                this.music = this.track;
                this.music.setVolume(0.0);
                this.music.play();
            }
        } else if (this.currentScreen && this.music !== null) {
            this.music.setVolume(this.currentScreen.volume);
        }


        if (this.spinPlay) {
            this.spinPlay.update(elapsed);
        }

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
            var p0Score = this.patches[0].score(),
                p1Score = this.patches[1].score(),
                winner = null;
            if (p0Score > p1Score) {
                winner = 0;
            } else if (p1Score > p0Score) {
                winner = 1;
            }
            this.startEndGame(endGame, winner);
        }
    }

    function interpolate(start, end, t) {
        return (start * t + (1 - t) * end);
    }

    function GameOverScreen(movelessIndex, winnerIndex) {
        this.showDuration = 2000;
        this.gameOverSoundTime = 1000;
        this.showTime = this.showDuration + this.gameOverSoundTime;
        this.isOverlay = true;
        this.isTitle = false;
        this.titleBackground = false;
        this.drawInHUD = true;
        this.volume = GAME_VOLUME;
        this.movelessIndex = movelessIndex;
        this.winnerIndex = winnerIndex;
    }

    GameOverScreen.prototype.update = function (elapsed, keyboard, pointer, width, height, swapped) {
        this.showTime -= elapsed;        
        if (this.showTime < 0 && (keyboard.keysDown() > 0 || pointer.activated())) {
            this.volume = TITLE_VOLUME;
            return("RESTART");
        } else {
            var volume = TITLE_VOLUME;
            if (this.showTime > this.showDuration) {
                volume = GAME_VOLUME;
            } else if (this.showTime > 0) {
                volume = interpolate(GAME_VOLUME, TITLE_VOLUME, this.showTime / this.showDuration);
            }
            this.volume = volume;
        }
        return(null);
    }

    GameOverScreen.prototype.draw = function (context, width, height, swapped, hudIndex) {
        if (hudIndex === null) {
            return;
        }
        var message = this.winnerIndex === null ? "Everybody Wins!" : (this.winnerIndex === hudIndex ? "You Win!" : "You Also Win!");
        context.save();
        context.font = "40px sans-serif";
        var offset = height / 2,
            fill = "rgba(255,255,255,255)",
            shadow = "rgba(128,128,128,255)";

        BLIT.centeredText(
            context, message,
            width / 2, offset,
            fill, shadow,
            2
        );
        if (hudIndex === this.movelessIndex) {
            offset += 80;
            BLIT.centeredText(
                context, "Out of Moves!",
                width / 2, offset,
                fill, shadow,
                2
            );
        }
        context.restore();
    }

    function TitleScreen(canIdle, canOpen) {
        this.idle = canIdle.setupPlayback(DEFAULT_FRAME_TIME, true);
        this.open = null;
        this.canOpen = canOpen;
        this.isOverlay = true;
        this.isTitle = true;
        this.titleBackground = true;
        this.drawInHUD = false;
        this.showTime = 1000;
        this.volume = TITLE_VOLUME;
    }

    TitleScreen.prototype.update = function (elapsed, keyboard, pointer, width, height, swapped) {
        this.idle.update(elapsed);
        if (this.open) {
            if (this.open.update(elapsed)) {
                return "FADE";
            }
            return null;
        }
        this.showTime -= elapsed;
        if (this.showTime < 0 && (keyboard.keysDown() > 0 || pointer.activated())) {
            this.open = this.canOpen.setupPlayback(DEFAULT_FRAME_TIME, false);
            return "SPLATTER";
        }
        return(null);
    }

    TitleScreen.prototype.draw = function (context, centerX, centerY, scale) {
        var flip = this.open !== null ? this.open : this.idle;
        flip.draw(context, centerX, centerY, BLIT.ALIGN.Center, flip.width() * scale, flip.height() * scale);
    }

    function FadeScreen() {
        this.fadeDuration = 500;
        this.fadeTime = this.fadeDuration
        this.isOverlay = true;
        this.drawInHUD = false;
        this.isTitle = true;
        this.titleBackground = false;
        this.volume = TITLE_VOLUME;
    }

    FadeScreen.prototype.update = function (elapsed, keyboard, pointer, width, height, swapped) {
        this.fadeTime -= elapsed;
        if (this.fadeTime < 0) {
            this.volume = GAME_VOLUME;
            return "START";            
        }
        this.volume = interpolate(TITLE_VOLUME, GAME_VOLUME, this.fadeTime / this.fadeDuration)
        return null;
    }

    FadeScreen.prototype.draw = function (context, centerX, centerY, scale) {
        context.save();
        context.globalAlpha = this.fadeTime / this.fadeDuration;
        context.fillStyle = "rgba(0,0,0,255)";
        context.fillRect(0, 0, 2 * centerX, 2 * centerY);
        context.restore();
    }

    Game.prototype.startEndGame = function (movelessIndex, winnerIndex) {
        this.currentScreen = new GameOverScreen(movelessIndex, winnerIndex);
        this.winSound.play();
    }

    Game.prototype.drawHUD = function (context, width, height, patchIndex) {
        var patch = this.patches[patchIndex];

        var border = this.bounds.left,
            pivotX = 0,
            pivotY = 0,
            size = 0,
            rotation = 0;
        if (patchIndex == 0) {
            if (this.swapped) {
                // top edge, rotate 180
                pivotX = width;
                pivotY = this.split;
                size = width;
                rotation = Math.PI;
            } else {
                // left edge, rotate 90 clock
                pivotX = this.split;
                pivotY = 0;
                size = height;
                rotation = Math.PI / 2;
            }
        } else {
            if (this.swapped) {
                // bottom edge, unrotated
                pivotX = 0;
                pivotY = this.split;
                size = width;
            } else {
                // right edge, rotate 90 counter
                pivotX = this.split;
                pivotY = height;
                size = height;
                rotation = -Math.PI / 2;
            }
        }
        context.save();
        context.translate(pivotX, pivotY);
        if (rotation) {
            context.rotate(rotation); 
        }
        context.font = "25px sans-serif";
        context.textBaseline = "top";
        context.fillStyle = patchIndex ? BLUE_COLOR : RED_COLOR;
        var HALF_SPIN = 20,
            SPIN_SIZE = 2 * HALF_SPIN,
            spinX = HALF_SPIN,
            reference = SPIN_SIZE;
        if (this.swapped) {
            reference = size - SPIN_SIZE;
            spinX = size - HALF_SPIN
            context.textAlign = "end";
        } else {
            context.textAlign = "start";

        }
        this.spinPlay.draw(context, spinX, HALF_SPIN, BLIT.ALIGN.Center, SPIN_SIZE, SPIN_SIZE);
        context.fillText(patch.score(), reference, 2);

        if (this.currentScreen && this.currentScreen.drawInHUD) {
            this.currentScreen.draw(context, size, this.split, this.swapped, patchIndex);
        }
        context.restore();
    }

    Game.prototype.draw = function (context, width, height) {
        if (this.loadState !== null) {
            return;
        }

        var isTitle = this.currentScreen && this.currentScreen.isTitle,
            background = isTitle && this.currentScreen.titleBackground ? this.titleBackground : this.gameBackground,
            centerX = width / 2,
            centerY = height / 2,
            scale = height / background.height;
        context.save();
        if (this.swapped) {
            scale = width / background.height;
            context.rotate(Math.PI / 2);
            centerX = height / 2;
            centerY = -width / 2;
        }
        BLIT.draw(context, background, centerX, centerY, BLIT.ALIGN.Center, background.width * scale, background.height * scale);

        if (isTitle) {
            this.currentScreen.draw(context, centerX, centerY, scale);
        }
        context.restore();

        if (isTitle) {
            return;
        }

        context.save();
        context.strokeStyle = "rgba(128, 128, 128, 255)";
        if (this.swapped) {
            //context.strokeRect(0, this.split, width, 1);
            context.translate(0, this.split);
            context.scale(1, -1);
        } else {
            //context.strokeRect(this.split, 0, 1, height);
            context.translate(this.split, 0);
            context.scale(-1, 1);
        }
        this.patches[1].drawOpposite(context, this.images[1], this.bounds, 1);
        this.patches[0].draw(context, this.images[0], this.bounds, this.swapped, 0);
        context.restore();
        context.save();
        if (this.swapped) {
            context.translate(0, this.split);
        } else {
            context.translate(this.split, 0);
        }
        this.patches[0].drawOpposite(context, this.images[0], this.bounds, 0);
        this.patches[1].draw(context, this.images[1], this.bounds, this.swapped, 1);
        context.restore();

        this.drawHUD(context, width, height, 0);
        this.drawHUD(context, width, height, 1);

        if(this.currentScreen) {
            this.currentScreen.draw(context, width, height, this.swapped, null);
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
