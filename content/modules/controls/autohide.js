/**
 * Auto-hide control — hides both the cinema chrome and the embed's native
 * YouTube controls after a short idle period while the video plays.
 *
 * The two follow the same idle rule but are triggered differently:
 *   - Cinema chrome: any mouse movement anywhere over the overlay.
 *   - Video controls: movement over / hover of the video frame only.
 * Moving over the header or footer shows the chrome and hides the video controls.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;

    /** Idle time before the cinema header/footer fade out. */
    const CHROME_IDLE_DELAY = 500;

    /** Idle time before the native video controls fade out. */
    const VIDEO_IDLE_DELAY = 250;

    /** Re-check interval while a transient block (menu, scrub, popup) is active. */
    const TRANSIENT_RETRY_MS = 150;

    function createAutoHideControl(ctx) {
        const { overlayElement, iframe, els, flags } = ctx;

        let isHoveringControls = false;
        let isHoveringVideoFrame = false;
        let isControlsVisible = true;
        let isVideoControlsVisible = true;

        let lastActivity = 0;
        let lastVideoActivity = 0;
        let hideTimer = null;
        let videoHideTimer = null;

        // ------------------------------------------------------ player probes

        function isVideoPlaying() {
            try {
                const { video } = ctx.getPlayerElements();
                return Boolean(video && !video.paused && !video.ended && video.readyState >= 2);
            } catch (_) {
                return false;
            }
        }

        /**
         * Only signals we control are checked here.
         *
         * We deliberately do NOT probe YouTube's own popup containers
         * (`.ytp-popup`, `.ytp-settings-menu`): YouTube keeps them in the DOM at
         * full size while closed, so any "is it sized?" test vetoed the hide
         * permanently and the controls were left to YouTube's own ~4s auto-hide.
         * Those popups live inside the chrome we hide anyway, so closing them is
         * harmless — hovering brings the whole bar back.
         */
        function isPlayerInteracting() {
            try {
                const { video, player } = ctx.getPlayerElements();
                if (video && video.seeking) return true;

                const playerEl = player || overlayElement._cachedPlayer;
                if (playerEl) {
                    if (playerEl.classList.contains('ytp-scrubbing')) return true;
                    if (playerEl.querySelector('.ytp-volume-slider-active')) return true;
                }
            } catch (_) {}
            return false;
        }

        /** Hiding is suppressed while a menu is open or the user is on the chrome. */
        function isBlockingHide() {
            return !settings.autoHideControls || ctx.isDocked || isHoveringControls ||
                flags.speedMenuOpen || flags.qualityMenuOpen;
        }

        /** Persistent state: the video hide timer is never armed in this mode. */
        function isVideoHideDisabled() {
            return !settings.autoHideControls || ctx.isDocked;
        }

        /** Transient state: the user is mid-interaction, so keep watching. */
        function isVideoHideBlocked() {
            return isPlayerInteracting() || flags.speedMenuOpen || flags.qualityMenuOpen;
        }

        // ------------------------------------------------- cinema chrome

        function showControls() {
            if (!isControlsVisible) {
                isControlsVisible = true;
                els.container?.classList.remove('yt-cinema-controls-hidden');
            }
            if (!isHoveringVideoFrame) {
                try {
                    YTC.player.getEmbedDocument(iframe)?.body?.classList.remove('yt-cinema-cursor-hidden');
                } catch (_) {}
            }
        }

        function hideControls() {
            if (!isControlsVisible) return;
            if (isBlockingHide()) return;
            if (!isVideoPlaying()) return;

            isControlsVisible = false;
            els.container?.classList.add('yt-cinema-controls-hidden');
            try {
                YTC.player.getEmbedDocument(iframe)?.body?.classList.add('yt-cinema-cursor-hidden');
            } catch (_) {}
        }

        // --------------------------------------------- native video controls

        function showVideoControls() {
            isVideoControlsVisible = true;
            try {
                const doc = YTC.player.getEmbedDocument(iframe);
                if (doc?.body) {
                    doc.body.classList.remove('yt-cinema-video-controls-hidden');
                    doc.body.classList.add('yt-cinema-video-controls-visible');
                    doc.body.classList.remove('yt-cinema-cursor-hidden');
                    const playerEl = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player');
                    if (playerEl && playerEl.classList.contains('ytp-autohide')) {
                        playerEl.classList.remove('ytp-autohide');
                    }
                }
            } catch (_) {}
        }

        function hideVideoControls() {
            // Deliberately not gated on playback state: a paused frame should be
            // just as clean as a playing one.
            if (isVideoHideDisabled() || isVideoHideBlocked()) return;

            try {
                const doc = YTC.player.getEmbedDocument(iframe);
                if (doc?.body) {
                    isVideoControlsVisible = false;
                    doc.body.classList.remove('yt-cinema-video-controls-visible');
                    doc.body.classList.add('yt-cinema-video-controls-hidden');
                    doc.body.classList.add('yt-cinema-cursor-hidden');
                    const playerEl = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player');
                    if (playerEl && !playerEl.classList.contains('ytp-autohide')) {
                        playerEl.classList.add('ytp-autohide');
                    }
                }
            } catch (_) {}
        }

        // ---------------------------------------------------------- timers

        /**
         * Arm the chrome hide timer.
         *
         * When the idle deadline has not passed yet, the timer re-arms itself
         * for exactly the remaining time rather than giving up — the same
         * behaviour `armVideoHide` uses for transient blocks, so both clocks
         * converge on a single rule instead of drifting apart.
         */
        function armHide(ms) {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                hideTimer = null;

                if (isBlockingHide()) {
                    showControls();
                    return;
                }

                const idle = performance.now() - lastActivity;
                if (idle >= CHROME_IDLE_DELAY) {
                    hideControls();
                } else {
                    armHide(CHROME_IDLE_DELAY - idle);
                }
            }, ms);
        }

        function armVideoHide(ms) {
            if (videoHideTimer) clearTimeout(videoHideTimer);
            videoHideTimer = setTimeout(() => {
                videoHideTimer = null;

                if (isVideoHideDisabled()) {
                    showVideoControls();
                    return;
                }

                // While the user is mid-interaction (scrubbing, a menu open,
                // YouTube's own popup) keep the timer alive instead of giving up,
                // so the controls vanish as soon as they let go.
                if (isVideoHideBlocked()) {
                    showVideoControls();
                    armVideoHide(TRANSIENT_RETRY_MS);
                    return;
                }

                if (!isHoveringVideoFrame) {
                    hideVideoControls();
                    return;
                }
                const idle = performance.now() - lastVideoActivity;
                if (idle >= VIDEO_IDLE_DELAY) {
                    hideVideoControls();
                } else {
                    armVideoHide(VIDEO_IDLE_DELAY - idle);
                }
            }, ms);
        }

        function noteActivity() {
            lastActivity = performance.now();
            if (!isControlsVisible) showControls();
            if (settings.autoHideControls && !ctx.isDocked) {
                armHide(CHROME_IDLE_DELAY);
            }
        }

        function noteVideoActivity() {
            lastVideoActivity = performance.now();
            isHoveringVideoFrame = true;
            if (!isVideoControlsVisible) showVideoControls();
            if (settings.autoHideControls && !ctx.isDocked) {
                armVideoHide(VIDEO_IDLE_DELAY);
            }
            noteActivity();
        }

        function leaveVideoFrame() {
            isHoveringVideoFrame = false;
            hideVideoControls();
        }

        function clearTimers() {
            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            if (videoHideTimer) {
                clearTimeout(videoHideTimer);
                videoHideTimer = null;
            }
        }

        /**
         * Re-apply the hover rule, e.g. after the video pauses or ends.
         * Hovering the frame keeps the controls up; anywhere else they go away.
         */
        function syncVideoControls() {
            if (videoHideTimer) {
                clearTimeout(videoHideTimer);
                videoHideTimer = null;
            }
            if (isVideoHideDisabled() || isHoveringVideoFrame) showVideoControls();
            else hideVideoControls();
        }

        /** Re-evaluate auto-hide after the setting or dock state changed. */
        function update() {
            if (!settings.autoHideControls || ctx.isDocked) {
                clearTimers();
                showControls();
                showVideoControls();
                return;
            }
            noteActivity();
            if (isHoveringVideoFrame) noteVideoActivity();
        }

        // ------------------------------------------------- hover tracking

        function trackChromeHover(element) {
            element.addEventListener('mouseenter', () => {
                isHoveringControls = true;
                isHoveringVideoFrame = false;
                hideVideoControls();
                noteActivity();
            });
            element.addEventListener('mouseleave', () => {
                isHoveringControls = false;
                noteActivity();
            });
        }

        function bindHoverTracking() {
            if (els.header) trackChromeHover(els.header);
            if (els.footer) trackChromeHover(els.footer);

            const wrapper = els.playerWrapper;
            if (wrapper) {
                wrapper.addEventListener('mouseenter', noteVideoActivity);
                wrapper.addEventListener('mousemove', noteVideoActivity, { passive: true });
                wrapper.addEventListener('mouseleave', leaveVideoFrame);
            }

            overlayElement.addEventListener('mousemove', (e) => {
                noteActivity();
                if (!wrapper) return;
                if (wrapper.contains(e.target)) {
                    noteVideoActivity();
                } else {
                    leaveVideoFrame();
                }
            }, { passive: true });
        }

        return {
            showControls,
            showVideoControls,
            hideVideoControls,
            noteActivity,
            noteVideoActivity,
            leaveVideoFrame,
            syncVideoControls,
            isHoveringVideoFrame: () => isHoveringVideoFrame,
            reset: noteActivity,
            clearTimers,
            update,
            bindHoverTracking
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.autohide = { createAutoHideControl };
})(globalThis.YTC);
