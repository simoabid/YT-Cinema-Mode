/**
 * Navigation control — in-overlay history (Prev/Next), header title updates
 * and swapping the embedded video without tearing down the overlay.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;
    const video = YTC.video;
    const layout = YTC.layout;

    function createNavigationControl(ctx) {
        const { overlayElement, iframe, els } = ctx;
        const history = [];

        function readCurrentEntry() {
            const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
            return {
                videoId: ctx.currentVideoId,
                title: titleSpan?.textContent?.trim() || 'YouTube Video',
                isShort: Boolean(els.container?.classList.contains('yt-cinema-shorts'))
            };
        }

        function pushHistory() {
            if (ctx.currentVideoId) history.push(readCurrentEntry());
        }

        /** Single place that writes the "which video am I showing" mirrors. */
        function syncOverlayIdentity(newId, isShortVideo) {
            ctx.currentVideoId = newId;
            overlayElement.dataset.videoId = newId;
            overlayElement._currentVideoId = newId;
            overlayElement._isShort = isShortVideo;
        }

        /**
         * Called when the embed navigates on its own (autoplay / playlist).
         *
         * The iframe already moved, so this only mirrors identity and updates
         * the header — it must never reassign `iframe.src`, or we would restart
         * the very navigation we are reacting to.
         */
        function recordNavigation(newId, newTitle, isShortVideo) {
            if (!newId || newId === ctx.currentVideoId) return;
            pushHistory();

            // player.js reads `_currentVideoId` / `_isShort` to build the
            // restricted-embed fallback URL, so leaving them stale would offer
            // the *previous* video's link after an autoplay jump.
            syncOverlayIdentity(newId, Boolean(isShortVideo));

            // The bridge re-reports this video's quality list, and the reset
            // makes the remembered quality eligible to apply once again.
            ctx.quality.resetForNewVideo();
            ctx.history.onVideoChanged(newId);

            if (newTitle) updateHeaderTitle(newTitle, Boolean(isShortVideo));
        }

        function updateHeaderTitle(newTitle, isShortVideo) {
            const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
            if (titleSpan) {
                titleSpan.textContent = newTitle;
                titleSpan.setAttribute('title', newTitle);
            }

            const existingBadge = overlayElement.querySelector('.yt-cinema-shorts-badge');
            const titleContainer = overlayElement.querySelector('.yt-cinema-title');

            if (isShortVideo && !existingBadge && titleSpan && titleContainer) {
                const badge = document.createElement('span');
                badge.className = 'yt-cinema-shorts-badge';
                badge.innerHTML = icons.shortsBadge;
                titleContainer.insertBefore(badge, titleSpan);
            } else if (!isShortVideo && existingBadge) {
                existingBadge.remove();
            }
        }

        function loadVideo(newId, newTitle, isShortVideo, addToHistory = true) {
            if (addToHistory && ctx.currentVideoId && ctx.currentVideoId !== newId) {
                pushHistory();
            }

            syncOverlayIdentity(newId, isShortVideo);
            overlayElement._isWatchFallback = false;
            overlayElement._cachedVideo = null;
            overlayElement._cachedPlayer = null;

            updateHeaderTitle(newTitle, isShortVideo);

            const initialRatio = isShortVideo ? video.VERTICAL_RATIO : video.HORIZONTAL_RATIO;
            const dims = layout.calculateContainerDimensions(initialRatio, isShortVideo);
            layout.applyOrientation(els.container, isShortVideo);
            els.container.dataset.aspectRatio = dims.ratio.toString();

            if (!ctx.isDocked) {
                layout.setContainerBox(els.container, dims);
                layout.syncAmbientToContainer(overlayElement, els.container);
            }

            ctx.history.stop();
            ctx.quality.resetForNewVideo();
            const resume = YTC.progress.resumeTimestamp(newId);
            iframe.src = video.buildPlayerUrl(newId, isShortVideo, resume, true);
        }

        /** Click the player's own previous button, else fall back to our history. */
        function playPrevious() {
            if (history.length > 0) {
                const previous = history.pop();
                loadVideo(previous.videoId, previous.title, previous.isShort, false);
                ctx.toast.show(`Previous: ${previous.title || 'Video'}`, icons.previous);
                return;
            }

            if (triggerPlayerNavigation('previousVideo', '.ytp-prev-button', (btn) =>
                !btn.disabled && btn.getAttribute('aria-disabled') !== 'true')) {
                ctx.toast.show('Previous playlist video', icons.previous);
            } else {
                ctx.toast.show('No previous video in session', icons.info);
            }
        }

        /** Click the player's own next button, else fall back to a recommendation. */
        function playNext() {
            if (!triggerPlayerNavigation('nextVideo', '.ytp-next-button')) {
                const recommendation = video.findNextRecommendation(ctx.currentVideoId);
                if (recommendation) {
                    loadVideo(recommendation.videoId, recommendation.title, recommendation.isShort);
                }
            }
        }

        function triggerPlayerNavigation(playerMethod, buttonSelector, isUsable = () => true) {
            let triggered = false;
            try {
                const { player } = ctx.getPlayerElements();
                const playerObj = player?.wrappedJSObject || player;
                if (playerObj && typeof playerObj[playerMethod] === 'function') {
                    playerObj[playerMethod]();
                    triggered = true;
                } else {
                    const button = YTC.player.getEmbedDocument(iframe)?.querySelector(buttonSelector);
                    if (button && isUsable(button)) {
                        button.click();
                        triggered = true;
                    }
                }
            } catch (_) {}
            return triggered;
        }

        function bind() {
            els.prevBtn?.addEventListener('click', playPrevious);
            els.nextBtn?.addEventListener('click', playNext);
        }

        return { recordNavigation, playPrevious, playNext, bind };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.navigation = { createNavigationControl };
})(globalThis.YTC);
