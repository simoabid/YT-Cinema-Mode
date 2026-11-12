/**
 * Keyboard control — the in-overlay hotkey dispatcher. Works both from the page
 * and from inside the embed, where text inputs must not swallow the keys.
 */
(function (YTC) {
    'use strict';

    const state = YTC.state;

    const SEEK_STEP = 5;
    const JUMP_STEP = 10;

    function isTypingTarget() {
        const active = document.activeElement;
        if (!active) return false;
        return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || Boolean(active.isContentEditable);
    }

    function isDrawerFocused() {
        const active = document.activeElement;
        if (!active || typeof active.closest !== 'function') return false;
        return Boolean(
            active.closest('.yt-cinema-comments-panel') ||
            active.closest('.yt-cinema-chapters-panel') ||
            active.closest('.yt-cinema-queue-panel')
        );
    }

    function createKeyboardControl(ctx) {
        const { overlayElement, iframe, els, flags } = ctx;

        function requestFullscreenOf(el) {
            return el.requestFullscreen || el.mozRequestFullScreen || el.webkitRequestFullscreen;
        }

        function toggleFullscreen(target, fallbackTarget) {
            const current = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement;
            const exit = document.exitFullscreen || document.mozCancelFullScreen || document.webkitExitFullscreen;

            try {
                if (current) {
                    if (exit) exit.call(document);
                    return;
                }
                if (!target) return;

                const request = requestFullscreenOf(target);
                if (!request) {
                    const fallbackRequest = fallbackTarget && requestFullscreenOf(fallbackTarget);
                    if (fallbackRequest) fallbackRequest.call(fallbackTarget);
                    return;
                }

                const result = request.call(target);
                if (result && typeof result.catch === 'function') {
                    result.catch(() => {
                        const fallbackRequest = fallbackTarget && requestFullscreenOf(fallbackTarget);
                        if (fallbackRequest) fallbackRequest.call(fallbackTarget);
                    });
                }
            } catch (_) {}
        }

        function toggleTheaterMode() {
            try {
                YTC.player.getEmbedDocument(iframe)?.querySelector('.ytp-size-button')?.click();
            } catch (_) {}
        }

        /** @returns {boolean} true when the key was consumed by the overlay. */
        function handleKey(event, fromIframe = false) {
            if (!fromIframe && isTypingTarget()) return true;

            if (!fromIframe && isDrawerFocused()) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    if (ctx.engagement?.isCommentsOpen?.()) ctx.engagement.toggleComments(false);
                    else if (ctx.chapters?.isOpen?.()) ctx.chapters.togglePanel(false);
                    else if (ctx.queue?.isOpen?.()) ctx.queue.togglePanel(false);
                    return true;
                }
                const lower = event.key.toLowerCase();
                if (event.shiftKey && lower === 'c') {
                    event.preventDefault();
                    ctx.engagement?.toggleComments();
                    return true;
                }
                if (!event.ctrlKey && !event.metaKey && !event.altKey && lower === 'o') {
                    event.preventDefault();
                    ctx.chapters?.togglePanel?.();
                    return true;
                }
                if (!event.ctrlKey && !event.metaKey && !event.altKey && lower === 'u') {
                    event.preventDefault();
                    ctx.queue?.togglePanel?.();
                    return true;
                }
                // Do not intercept scrolling or navigation keys when navigating drawers
                return false;
            }

            ctx.autohide.reset();

            if (event.key === 'Escape') {
                event.preventDefault();
                if (flags.qualityMenuOpen) ctx.quality.closeMenu();
                else if (flags.speedMenuOpen) ctx.speed.closeMenu();
                else if (flags.filtersMenuOpen) ctx.filters?.closeMenu?.();
                else if (ctx.engagement?.isCommentsOpen()) ctx.engagement.toggleComments(false);
                else if (ctx.chapters?.isOpen?.()) ctx.chapters.togglePanel(false);
                else if (ctx.queue?.isOpen?.()) ctx.queue.togglePanel(false);
                else ctx.close();
                return true;
            }

            if (ctx.quality.handleMenuKey(event)) {
                event.preventDefault();
                return true;
            }

            const { transport, navigation, screenshot, dock, speed } = ctx;

            switch (event.key) {
                case 'ArrowUp':
                    event.preventDefault();
                    transport.changeVolume(5);
                    return true;
                case 'ArrowDown':
                    event.preventDefault();
                    transport.changeVolume(-5);
                    return true;
                case '[':
                case '<':
                    event.preventDefault();
                    speed.changeByStep(-1);
                    return true;
                case ']':
                case '>':
                    event.preventDefault();
                    speed.changeByStep(1);
                    return true;
                case 'ArrowLeft':
                    event.preventDefault();
                    transport.seekBySeconds(-SEEK_STEP);
                    return true;
                case 'ArrowRight':
                    event.preventDefault();
                    transport.seekBySeconds(SEEK_STEP);
                    return true;
                case ' ':
                    event.preventDefault();
                    transport.togglePlayPause();
                    return true;
            }

            switch (event.key.toLowerCase()) {
                case 'm':
                    event.preventDefault();
                    transport.toggleMute();
                    return true;
                case 'p':
                    event.preventDefault();
                    navigation.playPrevious();
                    return true;
                case 'd':
                    event.preventDefault();
                    dock.toggle();
                    return true;
                case 's':
                    event.preventDefault();
                    screenshot.takeScreenshot(event.shiftKey);
                    return true;
                case 'n':
                    event.preventDefault();
                    navigation.playNext();
                    return true;
                case 'f':
                    event.preventDefault();
                    toggleFullscreen(overlayElement, els.container);
                    return true;
                case 't':
                    toggleTheaterMode();
                    return true;
                case 'q':
                    event.preventDefault();
                    ctx.quality.toggleMenu();
                    return true;
                case 'c':
                    if (event.shiftKey) {
                        event.preventDefault();
                        ctx.engagement?.toggleComments();
                        return true;
                    }
                    return false;
                case 'j':
                    event.preventDefault();
                    transport.seekBySeconds(-JUMP_STEP);
                    return true;
                case 'k':
                    event.preventDefault();
                    transport.togglePlayPause();
                    return true;
                case 'l':
                    event.preventDefault();
                    transport.seekBySeconds(JUMP_STEP);
                    return true;
                case 'b':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.loop?.cycleABLoop?.();
                    return true;
                case 'r':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.loop?.toggleRepeatAll?.();
                    return true;
                case 'o':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.chapters?.togglePanel?.();
                    return true;
                case 'u':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.queue?.togglePanel?.();
                    return true;
                case 'v':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.filters?.toggleMenu?.();
                    return true;
                case 'z':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.filters?.cycleZoom?.();
                    return true;
                case 'x':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.zen?.toggleZen?.();
                    return true;
                case 'y':
                    if (event.ctrlKey || event.metaKey || event.altKey) return false;
                    event.preventDefault();
                    ctx.zen?.cycleSleepTimer?.();
                    return true;
                default:
                    return false;
            }
        }

        /** While docked, only the topmost window reacts to global hotkeys. */
        function isFocusedOverlay() {
            if (!overlayElement.isConnected) {
                window.removeEventListener('keydown', keyHandler, true);
                return false;
            }
            if (!ctx.isDocked) return true;

            if (state.activeModalOverlay && state.activeModalOverlay !== overlayElement) return false;

            let highestZ = -1;
            let topOverlay = null;
            for (const docked of state.activeDockedOverlays) {
                const z = parseInt(docked.style.zIndex, 10) || 0;
                if (z > highestZ) {
                    highestZ = z;
                    topOverlay = docked;
                }
            }
            return !topOverlay || topOverlay === overlayElement;
        }

        function keyHandler(event) {
            if (!isFocusedOverlay()) return;
            handleKey(event, false);
        }

        /** Re-attach listeners to the embed whenever it navigates. */
        function attachIframeListeners() {
            try {
                const iframeWindow = iframe.contentWindow;
                const iframeDoc = YTC.player.getEmbedDocument(iframe);

                if (iframeWindow) {
                    iframeWindow.addEventListener('mousedown', () => {
                        if (ctx.isDocked) ctx.dock.bringToFront();
                        if (flags.speedMenuOpen) ctx.speed.closeMenu();
                        if (flags.qualityMenuOpen) ctx.quality.closeMenu();
                        if (flags.filtersMenuOpen) ctx.filters?.closeMenu?.();
                    });
                    iframeWindow.addEventListener('keydown', (event) => handleKey(event, true), true);
                }

                if (iframeDoc) {
                    ctx.quality.injectBridge(iframeDoc);
                    ctx.quality.queryFromPlayer();
                    iframeDoc.addEventListener('mouseenter', ctx.autohide.noteVideoActivity);
                    iframeDoc.addEventListener('mousemove', ctx.autohide.noteVideoActivity, { passive: true });
                    iframeDoc.addEventListener('mouseleave', ctx.autohide.leaveVideoFrame);
                }
            } catch (_) {}
        }

        function bind() {
            window.addEventListener('keydown', keyHandler, true);
            iframe.addEventListener('load', attachIframeListeners);
        }

        /**
         * Detach our window listener and stop listening for further embed loads.
         *
         * The listeners `attachIframeListeners` puts on the embed's own
         * window/document are intentionally left alone: they die with that
         * document, and holding references to a torn-down iframe would keep the
         * whole embed alive for nothing.
         */
        function dispose() {
            window.removeEventListener('keydown', keyHandler, true);
            iframe.removeEventListener('load', attachIframeListeners);
        }

        return { bind, dispose };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.keyboard = { createKeyboardControl, isTypingTarget };
})(globalThis.YTC);
