/**
 * Ambient control — samples the video into a tiny canvas that the stylesheet
 * turns into a colour-matched glow. Runs at ~10 FPS and only while playing.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;

    const AMBIENT_INTERVAL_MS = 100;

    function createAmbientControl(ctx) {
        const { overlayElement, ambientCtx, ambientCanvas } = ctx;
        let timer = null;

        function draw() {
            if (!overlayElement.isConnected) {
                stop();
                return;
            }
            if (document.hidden) return;

            try {
                const { video } = ctx.getPlayerElements();
                if (video && !video.paused && !video.ended && video.readyState >= 2 && ambientCtx && ambientCanvas) {
                    ambientCtx.drawImage(video, 0, 0, ambientCanvas.width, ambientCanvas.height);
                }
            } catch (_) {}
        }

        function start() {
            if (timer || ctx.isDocked || !settings.ambientLighting || !ambientCtx || !ambientCanvas) return;
            timer = setInterval(draw, AMBIENT_INTERVAL_MS);
        }

        function stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }

        // Exposed so the player module and settings can drive the loop.
        overlayElement._startAmbient = start;
        overlayElement._stopAmbient = stop;

        return { start, stop };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.ambient = { createAmbientControl };
})(globalThis.YTC);
