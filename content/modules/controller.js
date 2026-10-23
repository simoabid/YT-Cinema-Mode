/**
 * Controller — builds the per-overlay context, instantiates every control
 * against it and exposes the `overlayElement._*` hooks that the rest of the
 * extension (player bootstrap, settings, fallbacks) calls back into.
 */
(function (YTC) {
    'use strict';

    const state = YTC.state;
    const icons = YTC.icons;
    const controls = YTC.controls;

    const CLOSE_FADE_MS = 300;
    const MIN_VIDEO_READY_STATE = 2;

    const OVERLAY_ELEMENTS = {
        container: '.yt-cinema-container',
        playerWrapper: '.yt-cinema-player-wrapper',
        header: '.yt-cinema-header',
        footer: '.yt-cinema-footer',
        closeBtn: '.yt-cinema-close-btn',
        pipBtn: '.yt-cinema-pip-btn',
        newTabBtn: '.yt-cinema-newtab-btn',
        copyBtn: '.yt-cinema-copy-btn',
        screenshotBtn: '.yt-cinema-screenshot-btn',
        dockBtn: '.yt-cinema-dock-btn',
        prevBtn: '.yt-cinema-prev-btn',
        nextBtn: '.yt-cinema-next-btn',
        speedPill: '.yt-cinema-speed-pill',
        speedMenu: '.yt-cinema-speed-menu',
        qualityPill: '.yt-cinema-quality-pill',
        qualityMenu: '.yt-cinema-quality-menu',
        dragShield: '.yt-cinema-drag-shield',
        shutterFlash: '.yt-cinema-shutter-flash',
        volumeHud: '.yt-cinema-volume-hud',
        toast: '.yt-cinema-toast'
    };

    function collectElements(overlayElement) {
        const els = {};
        for (const [name, selector] of Object.entries(OVERLAY_ELEMENTS)) {
            els[name] = overlayElement.querySelector(selector);
        }
        return els;
    }

    function setupOverlayEvents(overlayElement, iframe, options) {
        const ctx = {
            overlayElement,
            iframe,
            els: collectElements(overlayElement),

            initialTimestamp: options.initialTimestamp,
            isDirectPiP: options.isDirectPiP,
            ambientCtx: options.ambientCtx,
            ambientCanvas: options.ambientCanvas,
            ambientLayer: options.ambientLayer,

            // Shared mutable state, owned by the controls that change them.
            isDocked: Boolean(options.startDocked),
            isShort: Boolean(options.isShort),
            currentVideoId: options.videoId,
            flags: { speedMenuOpen: false, qualityMenuOpen: false },

            /** Cached <video>/player pair for the embed, re-resolved when stale. */
            getPlayerElements() {
                let video = overlayElement._cachedVideo;
                let player = overlayElement._cachedPlayer;
                if (video && video.isConnected) return { video, player };

                try {
                    const doc = YTC.player.getEmbedDocument(iframe);
                    if (doc) {
                        video = doc.querySelector('video');
                        player = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player');
                        if (video) {
                            overlayElement._cachedVideo = video;
                            overlayElement._cachedPlayer = player;
                        }
                    }
                } catch (_) {}
                return { video, player };
            }
        };

        ctx.close = () => closeOverlay(ctx);

        ctx.toast = controls.toast.createToastControl(ctx);
        ctx.autohide = controls.autohide.createAutoHideControl(ctx);
        ctx.speed = controls.speed.createSpeedControl(ctx);
        ctx.quality = controls.quality.createQualityControl(ctx);
        ctx.transport = controls.transport.createTransportControl(ctx);
        ctx.history = controls.history.createHistoryControl(ctx);
        ctx.ambient = controls.ambient.createAmbientControl(ctx);
        ctx.screenshot = controls.screenshot.createScreenshotControl(ctx);
        ctx.dock = controls.dock.createDockControl(ctx);
        ctx.navigation = controls.navigation.createNavigationControl(ctx);
        ctx.keyboard = controls.keyboard.createKeyboardControl(ctx);

        exposeOverlayHooks(overlayElement, ctx);
        bindVideoEvents(ctx);
        bindOverlayChrome(ctx);

        ctx.dock.initDockedState();
        ctx.autohide.noteActivity();

        return ctx;
    }

    /** The `overlayElement._*` surface used by the player, settings and fallbacks. */
    function exposeOverlayHooks(overlayElement, ctx) {
        overlayElement._showToast = ctx.toast.show;
        overlayElement._recordNavigation = ctx.navigation.recordNavigation;
        overlayElement._close = ctx.close;
        overlayElement._toggleDock = ctx.dock.toggle;
        overlayElement._updateAutoHide = ctx.autohide.update;
        overlayElement._applySpeed = ctx.speed.applyToPlayer;
        overlayElement._applyQuality = ctx.quality.applyToPlayer;
        overlayElement._queryQuality = ctx.quality.queryFromPlayer;
        overlayElement._injectQualityBridge = ctx.quality.injectBridge;
    }

    // ------------------------------------------------------- video bindings

    function bindVideoEvents(ctx) {
        const { overlayElement } = ctx;
        const boundVideos = new WeakSet();

        overlayElement._bindVideo = (video) => {
            if (!video || boundVideos.has(video)) return;
            boundVideos.add(video);

            const onDimensionsReady = () => {
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    YTC.layout.adjustContainerSize(video.videoWidth, video.videoHeight, overlayElement);
                }
            };
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                onDimensionsReady();
            } else {
                video.addEventListener('loadedmetadata', onDimensionsReady, { once: true });
            }
            video.addEventListener('resize', onDimensionsReady);

            const onPlaying = () => {
                ctx.autohide.noteActivity();
                if (ctx.autohide.isHoveringVideoFrame()) {
                    ctx.autohide.noteVideoActivity();
                } else {
                    ctx.autohide.hideVideoControls();
                }
                ctx.speed.applyToPlayer();
                overlayElement._startAmbient?.();
                ctx.history.onPlaying();
            };

            const onStopped = () => {
                ctx.autohide.showControls();
                // Pause/end is not a hover: let the hover rule decide, so a
                // paused frame away from the pointer stays completely clean.
                ctx.autohide.syncVideoControls();
                overlayElement._stopAmbient?.();
            };

            video.addEventListener('play', onPlaying);
            video.addEventListener('playing', onPlaying);
            video.addEventListener('pause', () => {
                onStopped();
                ctx.history.onPaused();
            });
            video.addEventListener('ended', () => {
                onStopped();
                ctx.history.onEnded();
            });
            video.addEventListener('seeking', () => ctx.history.onSeeking());

            // A new embed document belongs to a (possibly) different video.
            ctx.history.onVideoChanged(ctx.currentVideoId);

            if (!video.paused && video.readyState >= MIN_VIDEO_READY_STATE) {
                overlayElement._startAmbient?.();
                ctx.history.onPlaying();
            }

            video.addEventListener('loadedmetadata', () => {
                ctx.speed.applyToPlayer();
                if (ctx.isDirectPiP && (document.pictureInPictureEnabled || video.ownerDocument?.pictureInPictureEnabled)) {
                    if (typeof video.requestPictureInPicture === 'function') {
                        video.requestPictureInPicture().catch(() => {});
                    }
                }
            });

            video.addEventListener('ratechange', () => {
                ctx.speed.syncFromPlayer(video.playbackRate);
            });
        };
    }

    // --------------------------------------------------------- chrome wiring

    function bindOverlayChrome(ctx) {
        const { overlayElement, iframe, els, flags } = ctx;

        ctx.speed.bind();
        ctx.quality.bind();
        ctx.screenshot.bind();
        ctx.dock.bind();
        ctx.navigation.bind();
        ctx.autohide.bindHoverTracking();
        ctx.keyboard.bind();

        els.closeBtn?.addEventListener('click', ctx.close);
        els.pipBtn?.addEventListener('click', () => togglePictureInPicture(ctx));
        els.newTabBtn?.addEventListener('click', () => openInNewTab(ctx));
        els.copyBtn?.addEventListener('click', () => copyShareLink(ctx));

        overlayElement.addEventListener('click', (e) => {
            if (flags.speedMenuOpen && !e.target.closest('.yt-cinema-speed-container')) {
                ctx.speed.closeMenu();
            }
            if (flags.qualityMenuOpen && !e.target.closest('.yt-cinema-quality-container')) {
                ctx.quality.closeMenu();
            }
            if (ctx.isDocked) return;
            if (e.target === overlayElement) ctx.close();
        });
    }

    function togglePictureInPicture(ctx) {
        const { iframe } = ctx;

        try {
            const { video } = ctx.getPlayerElements();
            const doc = YTC.player.getEmbedDocument(iframe);
            if (video && (document.pictureInPictureEnabled || doc?.pictureInPictureEnabled)) {
                if (document.pictureInPictureElement) {
                    document.exitPictureInPicture();
                    return;
                }
                video.requestPictureInPicture();
                return;
            }
        } catch (_) {}

        try {
            const ytPipBtn = YTC.player.getEmbedDocument(iframe)?.querySelector('.ytp-pip-button');
            if (ytPipBtn) {
                ytPipBtn.click();
                return;
            }
        } catch (_) {}

        ctx.toast.show('Click Firefox blue PiP icon or press Ctrl+Shift+]', icons.pip);
    }

    function openInNewTab(ctx) {
        const seconds = YTC.player.getCurrentPlaybackSeconds(ctx.iframe, ctx.initialTimestamp);
        const base = `https://www.youtube.com/watch?v=${ctx.currentVideoId}`;
        window.open(seconds > 0 ? `${base}&t=${seconds}s` : base, '_blank');
    }

    async function copyShareLink(ctx) {
        const seconds = YTC.player.getCurrentPlaybackSeconds(ctx.iframe, ctx.initialTimestamp);
        const shareUrl = seconds > 0
            ? `https://youtu.be/${ctx.currentVideoId}?t=${seconds}`
            : `https://youtu.be/${ctx.currentVideoId}`;

        try {
            await navigator.clipboard.writeText(shareUrl);
        } catch (_) {
            copyViaTextarea(shareUrl);
        }

        controls.toast.flashSuccess(ctx.els.copyBtn, 'Copy Link at Current Time', 'Copied to clipboard!');
    }

    function copyViaTextarea(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    // ------------------------------------------------------------- teardown

    /**
     * Tear the overlay down: stop timers, stop playback, detach listeners and
     * fade the element out before removing it.
     */
    function closeOverlay(ctx) {
        const { overlayElement, iframe } = ctx;
        if (!overlayElement.isConnected) return;

        state.activeDockedOverlays.delete(overlayElement);
        if (state.activeModalOverlay === overlayElement) {
            state.activeModalOverlay = null;
        }

        if (overlayElement._initPlayerTimeout) {
            clearTimeout(overlayElement._initPlayerTimeout);
            overlayElement._initPlayerTimeout = null;
        }

        ctx.ambient.stop();
        ctx.toast.clear();
        ctx.autohide.clearTimers();
        ctx.autohide.showControls();
        ctx.autohide.showVideoControls();
        ctx.speed.closeMenu();
        ctx.quality.closeMenu();
        ctx.transport.clearTimers();
        ctx.history.stop();

        try {
            const { video } = ctx.getPlayerElements();
            if (video && !video.paused) video.pause();
        } catch (_) {}

        YTC.resumeBackgroundVideo();

        ctx.dock.cancelPendingFrames();
        ctx.dock.endResize();

        overlayElement._cachedVideo = null;
        overlayElement._cachedPlayer = null;

        overlayElement.classList.remove('yt-cinema-visible', 'yt-cinema-docked');
        if (!state.activeModalOverlay) YTC.unlockScroll();

        try {
            iframe.src = 'about:blank';
        } catch (_) {}

        ctx.keyboard.dispose();
        ctx.quality.dispose();

        setTimeout(() => overlayElement.remove(), CLOSE_FADE_MS);
    }

    YTC.controller = { setupOverlayEvents };
})(globalThis.YTC);
