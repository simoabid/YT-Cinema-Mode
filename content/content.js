/**
 * YouTube Cinema Mode — content script bootstrap.
 *
 * This file only wires page-level triggers. Everything it touches lives in
 * content/modules/*, which must be loaded first (see the manifest).
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;
    const state = YTC.state;
    const util = YTC.util;

    const CARD_CONTAINER_SELECTOR =
        'ytd-rich-item-renderer, ytd-rich-grid-media, ytd-video-renderer, ' +
        'ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ' +
        'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model';

    const CARD_CONTAINER_FALLBACKS = [
        'ytd-thumbnail, yt-thumbnail-view-model',
        'a#thumbnail, a[href*="watch?v="], a[href*="shorts/"]'
    ];

    const SCROLL_HIDE_DEBOUNCE_MS = 120;

    let hoverIndicator = null;
    let hoverRafId = null;
    let scrollDebounceTimer = null;
    let lastHoverEl = null;

    // ------------------------------------------------------- hover indicator

    function hideIndicator() {
        hoverIndicator?.classList.remove('yt-cinema-hover-visible');
    }

    function updateIndicatorHotkey() {
        if (!hoverIndicator) return;
        const span = hoverIndicator.querySelector('span');
        if (!span) return;

        const hotkey = util.formatKeyDisplay(settings.hotkey || ' ');
        if (settings.directPiP) {
            span.innerHTML = `Press ${util.escapeHtml(hotkey)} for PiP`;
        } else if (settings.directMiniPlayer) {
            span.innerHTML = `Press ${util.escapeHtml(hotkey)} <span style="opacity:0.8;font-size:11px;margin-left:3px;">(Ctrl+${util.escapeHtml(hotkey)}: Mini)</span>`;
        } else {
            span.textContent = `Press ${hotkey}`;
        }
    }

    function updateIndicatorPosition(element) {
        if (!hoverIndicator || !element) return;
        const anchor = element.closest('ytd-thumbnail, yt-thumbnail-view-model, [id="thumbnail"]') || element;
        const rect = anchor.getBoundingClientRect();
        const validRect = (rect.width > 0 && rect.height > 0) ? rect : element.getBoundingClientRect();
        hoverIndicator.style.transform =
            `translate3d(${Math.round(validRect.left + 8)}px, ${Math.round(validRect.top + 8)}px, 0)`;
    }

    function queueLink(link) {
        if (!link?.href) return false;
        const videoId = YTC.video.getVideoID(link.href);
        if (!videoId) return false;
        const title = YTC.video.getVideoTitle(link) || 'YouTube Video';
        const isShort = YTC.video.isShortVideo(link.href);
        const added = YTC.queue.add({ videoId, title, isShort });
        const message = added ? `Added to Cinema Queue: ${title}` : `Already in Queue: ${title}`;
        if (state.activeModalOverlay && typeof state.activeModalOverlay._showToast === 'function') {
            state.activeModalOverlay._showToast(message, YTC.icons.queue);
        } else {
            YTC.overlay.showPageToast?.(message, YTC.icons.queue);
        }
        return added;
    }

    function showIndicator(element) {
        if (!settings.showIndicator) return;

        if (!hoverIndicator) {
            hoverIndicator = document.createElement('div');
            hoverIndicator.className = 'yt-cinema-hover-indicator';
            hoverIndicator.innerHTML = `${YTC.icons.clapper}<span></span><button type="button" class="yt-cinema-hover-queue-btn" title="Add to Cinema Queue (Alt+Q)">+ Queue</button>`;
            hoverIndicator.querySelector('.yt-cinema-hover-queue-btn')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                queueLink(state.currentTarget);
            });
            hoverIndicator.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                YTC.launcher.openFromLink(state.currentTarget);
            });
            document.body.appendChild(hoverIndicator);
        }

        updateIndicatorHotkey();
        updateIndicatorPosition(element);
        hoverIndicator.classList.add('yt-cinema-hover-visible');
    }

    function scheduleIndicator(link) {
        if (hoverRafId) cancelAnimationFrame(hoverRafId);
        hoverRafId = requestAnimationFrame(() => {
            hoverRafId = null;
            if (state.currentTarget === link) showIndicator(link);
        });
    }

    function isIndicatorElement(target) {
        return Boolean(target) && (target === hoverIndicator || hoverIndicator?.contains(target));
    }

    // --------------------------------------------------------- DOM matching

    function getVideoCard(element) {
        if (!element || !element.closest) return null;
        return element.closest(CARD_CONTAINER_SELECTOR) ||
            element.closest(CARD_CONTAINER_FALLBACKS[0]) ||
            element.closest(CARD_CONTAINER_FALLBACKS[1]);
    }

    function isThumbnailLink(link) {
        return Boolean(
            link.id === 'thumbnail' ||
            link.classList.contains('ytd-thumbnail') ||
            link.closest('ytd-thumbnail, ytd-rich-grid-media, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytd-rich-item-renderer') ||
            link.querySelector('img, yt-image, ytd-thumbnail, .yt-core-image')
        );
    }

    /** Resolve the playable link for a hovered element, if there is one. */
    function findVideoLink(target) {
        if (!target || !target.closest) return null;

        const link = target.closest('a[href*="watch?v="], a[href*="shorts/"]');
        if (link && isThumbnailLink(link)) return link;

        const card = target.closest(
            'ytd-thumbnail, yt-thumbnail-view-model, ytd-rich-item-renderer, ytd-rich-grid-media, ' +
            'ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ' +
            'ytd-reel-item-renderer, yt-lockup-view-model'
        );
        if (!card) return null;

        return card.querySelector(
            'a#thumbnail[href*="watch?v="], a#thumbnail[href*="shorts/"], ' +
            'a.yt-lockup-view-model__content-image, a[href*="watch?v="], a[href*="shorts/"]'
        );
    }

    function isSameVideo(a, b) {
        if (!a?.href || !b?.href) return false;
        return YTC.video.getVideoID(a.href) === YTC.video.getVideoID(b.href);
    }

    // ------------------------------------------------------------- triggers

    /** Configured mouse triggers must not run YouTube's own Save As / autoscroll. */
    function preventDefaultMouseActions(e) {
        if (state.activeModalOverlay) return;
        const isAlt = settings.altClickTrigger && e.altKey && e.button === 0;
        const isMiddle = settings.middleClickTrigger && e.button === 1;
        if (!isAlt && !isMiddle) return;

        const link = findVideoLink(e.target);
        if (link && YTC.video.getVideoID(link.href)) {
            e.preventDefault();
        }
    }

    /** Shared by the Alt+Click and middle-click triggers. */
    function openFromMouseEvent(e) {
        if (state.activeModalOverlay) return false;

        const link = findVideoLink(e.target);
        if (!link?.href || !YTC.video.getVideoID(link.href)) return false;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return YTC.launcher.openFromLink(link);
    }

    function onHotkeyDown(e) {
        if (e.repeat) return;
        if (YTC.controls.keyboard.isTypingTarget()) return;

        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'q') {
            if (state.currentTarget?.href && YTC.video.getVideoID(state.currentTarget.href)) {
                e.preventDefault();
                e.stopPropagation();
                queueLink(state.currentTarget);
            }
            return;
        }

        if (!util.isHotkeyMatch(e, settings.hotkey)) return;

        const isCtrl = e.ctrlKey || e.metaKey;
        const isDirectMini = settings.directMiniPlayer && isCtrl && !e.altKey && !e.shiftKey;
        const isStandardCinema = !isCtrl && !e.altKey && !e.metaKey && !e.shiftKey;

        if (isDirectMini) {
            if (YTC.launcher.openFromLink(state.currentTarget, { startDocked: true, useDirectPiP: false })) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (!state.activeModalOverlay) {
                if (YTC.launcher.openFromPage({ startDocked: true, useDirectPiP: false, timestampFromUrl: true })) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
            return;
        }

        if (!isStandardCinema || state.activeModalOverlay) return;

        if (settings.directPiP) {
            // A hovered thumbnail always wins; the page fallback only applies
            // when nothing is hovered.
            if (state.currentTarget?.href) {
                if (YTC.launcher.openFromLink(state.currentTarget)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            } else if (YTC.launcher.openFromPage({ useDirectPiP: true, requireWatchPath: true })) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }

        if (YTC.launcher.openFromLink(state.currentTarget)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }

    function onGlobalCommand() {
        if (state.activeModalOverlay && typeof state.activeModalOverlay._close === 'function') {
            state.activeModalOverlay._close();
            return;
        }
        if (state.currentTarget?.href) {
            YTC.launcher.openFromLink(state.currentTarget);
            return;
        }
        YTC.launcher.openFromPage({ timestampFromUrl: true });
    }

    // --------------------------------------------------------------- hover

    function onMouseOver(e) {
        if (state.activeModalOverlay) return;
        const el = e.target;
        if (!el || el === lastHoverEl) return;
        lastHoverEl = el;

        if (isIndicatorElement(el)) return;

        // Stay put while the cursor is still within the same video card.
        if (state.currentTarget) {
            const currentCard = getVideoCard(state.currentTarget);
            if (currentCard?.contains(el)) return;
        }

        if (!getVideoCard(el)) return;

        const link = findVideoLink(el);
        if (!link) return;

        // Always track, so hotkeys work even when the indicator is disabled.
        state.currentTarget = link;
        if (settings.showIndicator) scheduleIndicator(link);
    }

    function onMouseOut(e) {
        if (!state.currentTarget) return;
        const related = e.relatedTarget;

        // 1. Moving onto the hover indicator.
        if (isIndicatorElement(related)) return;

        // 2. Moving to another element inside the same video card.
        const currentCard = getVideoCard(state.currentTarget);
        if (related && currentCard?.contains(related)) return;

        // 3. Moving to another link for the same video.
        if (related) {
            const relatedLink = findVideoLink(related);
            if (relatedLink && isSameVideo(relatedLink, state.currentTarget)) {
                state.currentTarget = relatedLink;
                return;
            }
        }

        // 4. The node under the cursor was replaced (YouTube preview activation).
        if (!related) {
            const replacement = elementUnderCursor(e);
            if (replacement) {
                if (isIndicatorElement(replacement)) return;
                if (currentCard?.contains(replacement)) return;
                const pointLink = findVideoLink(replacement);
                if (pointLink && isSameVideo(pointLink, state.currentTarget)) {
                    state.currentTarget = pointLink;
                    return;
                }
            }
        }

        clearHoverTarget();
    }

    function elementUnderCursor(e) {
        if (e.clientX <= 0 || e.clientY <= 0 ||
            e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
            return null;
        }
        return document.elementFromPoint(e.clientX, e.clientY);
    }

    function clearHoverTarget() {
        state.currentTarget = null;
        lastHoverEl = null;
        if (hoverRafId) {
            cancelAnimationFrame(hoverRafId);
            hoverRafId = null;
        }
        hideIndicator();
    }

    function onScroll() {
        if (!state.currentTarget) {
            hideIndicator();
            return;
        }

        // Hide immediately during scroll motion so the badge never detaches.
        hideIndicator();

        if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
        scrollDebounceTimer = setTimeout(() => {
            scrollDebounceTimer = null;
            if (!state.currentTarget || !settings.showIndicator) {
                hideIndicator();
                return;
            }

            const rect = state.currentTarget.getBoundingClientRect();
            const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight ||
                rect.right < 0 || rect.left > window.innerWidth;

            if (isOffscreen) {
                hideIndicator();
            } else {
                updateIndicatorPosition(state.currentTarget);
                hoverIndicator.classList.add('yt-cinema-hover-visible');
            }
        }, SCROLL_HIDE_DEBOUNCE_MS);
    }

    function onPageNavigation() {
        clearHoverTarget();
    }

    // ------------------------------------------------------------- register

    function registerListeners() {
        YTC.api.runtime.onMessage.addListener((message) => {
            if (message && message.action === 'toggle-cinema') onGlobalCommand();
        });

        document.addEventListener('keydown', onHotkeyDown);
        document.addEventListener('mousedown', preventDefaultMouseActions, true);

        document.addEventListener('click', (e) => {
            if (!settings.altClickTrigger || !e.altKey || e.button !== 0) return;
            openFromMouseEvent(e);
        }, true);

        document.addEventListener('auxclick', (e) => {
            if (!settings.middleClickTrigger || e.button !== 1) return;
            openFromMouseEvent(e);
        }, true);

        document.addEventListener('mouseover', onMouseOver, { passive: true });
        document.addEventListener('mouseout', onMouseOut, { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('yt-navigate-finish', onPageNavigation);
    }

    /** Hover badge API used by the settings module and the overlay factory. */
    YTC.hover = {
        hideIndicator,
        refreshHotkeyLabel: updateIndicatorHotkey
    };

    YTC.initSettings();
    YTC.player.installOverlayMessageBridge();
    YTC.layout.installWindowResizeHandler();
    registerListeners();
})(globalThis.YTC);
