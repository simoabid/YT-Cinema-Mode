/**
 * Player — everything that reaches *into* the YouTube embed iframe:
 * style injection, player bootstrap polling, restricted-video fallback and the
 * postMessage bridge used for resize + error reporting.
 */
(function (YTC) {
    'use strict';

    const state = YTC.state;
    const video = YTC.video;
    const icons = YTC.icons;

    const INIT_POLL_INTERVAL_MS = 200;
    const INIT_MAX_ATTEMPTS = 16;
    const BLOCKED_CHECK_ATTEMPT = 8;

    const PLAYER_ERROR_CODES = [150, 152, 153, 101, 100, 2, 5];

    /**
     * Every piece of YouTube's own player chrome, as one shared list so the
     * show and hide rules can never drift apart. YouTube reshuffles these
     * containers between releases, so this is deliberately generous: an entry
     * that doesn't exist on the current build is simply a no-op.
     *
     * `.ytp-large-play-button` is deliberately absent — hiding it would break
     * "click the video to resume" while paused.
     */
    const VIDEO_CHROME_SELECTORS = [
        '.ytp-chrome-bottom',
        '.ytp-chrome-top',
        '.ytp-chrome-left-bottom',
        '.ytp-gradient-bottom',
        '.ytp-gradient-top',
        '.ytp-title-rich',
        '.ytp-title-bar',
        '.ytp-left-controls',
        '.ytp-right-controls',
        '.ytp-progress-bar-container',
        '.ytp-settings-button',
        '.ytp-subtitles-button',
        '.ytp-volume-button',
        '.ytp-cards-teaser',
        '.ytp-cards-button',
        '.ytp-endscreen-content',
        '.ytp-top-center-container',
        '.ytp-pause-overlay'
    ];

    /** Idle delay and fades are tuned in controls/autohide.js; keep these snappy. */
    const VIDEO_FADE_HIDE = '0.14s ease-out';
    const VIDEO_FADE_SHOW = '0.1s ease-out';

    function videoControlsCss() {
        const chrome = (prefix) => VIDEO_CHROME_SELECTORS.map((sel) => `${prefix} ${sel}`).join(',\n');
        const state = (prefix, opacity, pointerEvents, shift, fade) => `
        ${chrome(prefix)} {
            opacity: ${opacity} !important;
            pointer-events: ${pointerEvents} !important;
            transform: translateY(${shift}) !important;
            transition: opacity ${fade}, transform ${fade} !important;
        }`;

        return `
        /* YouTube's own player chrome.
           Hidden by default and revealed only while the pointer is over the player,
           so the controls can never sit around waiting on YouTube's slow native
           auto-hide. controls/autohide.js layers the idle delay and the hover state
           we track in the host page on top of this.
           Order matters: the JS-driven states share a specificity with :hover, so
           the "hidden" state is emitted last and wins. */
${state('', 0, 'none', '4px', VIDEO_FADE_HIDE)}

${state('body:hover', 1, 'auto', 0, VIDEO_FADE_SHOW)}

${state('body.yt-cinema-video-controls-visible', 1, 'auto', 0, VIDEO_FADE_SHOW)}

${state('body.yt-cinema-video-controls-hidden', 0, 'none', '4px', VIDEO_FADE_HIDE)}
        `;
    }

    /** CSS injected into the embed document to strip YouTube chrome and letterbox the video. */
    const EMBED_BASE_STYLES = `
        html, body, #player, #movie_player, .html5-video-player {
            background: #000 !important;
            overflow: hidden !important;
            scrollbar-width: none !important;
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            min-height: 0 !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
        }

        html::-webkit-scrollbar, body::-webkit-scrollbar {
            display: none !important;
        }

        .html5-video-container {
            width: 100% !important;
            height: 100% !important;
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            overflow: hidden !important;
        }

        video, .html5-main-video {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
            margin: 0 auto !important;
            padding: 0 !important;
            object-fit: contain !important;
        }

        .ytp-chrome-bottom {
            width: calc(100% - 24px) !important;
            left: 12px !important;
        }

        ${videoControlsCss()}

        body.yt-cinema-cursor-hidden,
        body.yt-cinema-cursor-hidden * {
            cursor: none !important;
        }
    `;

    /** Extra rules used only when falling back to the full /watch page. */
    const EMBED_WATCH_FALLBACK_STYLES = `
        /* Hide all non-player UI elements on watch page fallback */
        ytd-masthead, #masthead, #masthead-container,
        #secondary, #comments, #related, #info, #meta,
        #ticket-shelf, #merch-shelf, #below, #chat-container,
        ytd-watch-metadata, .ytp-chrome-top, #guide,
        ytd-mini-guide-renderer, #guide-button, tp-yt-app-drawer,
        #chips-wrapper, ytd-feed-filter-chip-bar-renderer,
        ytd-watch-next-secondary-results-renderer,
        #action-buttons, #subscribe-button, #top-row,
        #description, #info-contents, #menu-container,
        ytd-engagement-panel-section-list-renderer,
        #sponsor-button, #actions, ytd-merch-shelf-renderer,
        ytd-donation-shelf-renderer, #super-title,
        ytd-player-overlay-autoplay-next-video-renderer,
        .ytp-paid-content-overlay, #clarify-box,
        ytd-watch-info-text, #above-the-fold {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            overflow: hidden !important;
        }
        ytd-watch-flexy {
            --ytd-watch-flexy-panel-max-height: 100% !important;
            --ytd-watch-flexy-space-below-player: 0px !important;
            --ytd-watch-flexy-non-player-height: 0px !important;
            display: flex !important;
            flex-direction: column !important;
        }
        #player-container-outer,
        #player-container-inner,
        #player-container,
        #player-theater-container {
            width: 100% !important;
            height: 100% !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 1 !important;
            background: #000 !important;
            overflow: hidden !important;
        }
    `;

    /** Access can throw across the extension boundary; callers own the try/catch. */
    function getEmbedDocument(iframe) {
        return iframe.contentDocument || iframe.contentWindow?.document || null;
    }

    function injectPlayerStyles(iframe, videoId, overlayElement, ambientCtx, ambientCanvas, isWatchFallback = false) {
        try {
            const doc = getEmbedDocument(iframe);
            if (!doc) return;

            let style = doc.getElementById('yt-cinema-injected-styles');
            if (!style) {
                style = doc.createElement('style');
                style.id = 'yt-cinema-injected-styles';
                style.textContent = (isWatchFallback ? EMBED_WATCH_FALLBACK_STYLES : '') + EMBED_BASE_STYLES;
                const target = doc.head || doc.documentElement || doc.body;
                if (target) {
                    target.appendChild(style);
                }
            }

            if (!overlayElement) return;

            initPlayerInIframe(iframe, overlayElement, ambientCtx, ambientCanvas);
            watchIframeNavigation(iframe, doc, overlayElement);
        } catch (err) {
            console.debug('[Cinema Mode] Could not inject styles:', err.message);
        }
    }

    /** Track autoplay / playlist navigation that happens *inside* the embed. */
    function watchIframeNavigation(iframe, doc, overlayElement) {
        try {
            if (doc._ytNavAttached) return;
            doc._ytNavAttached = true;
            doc.addEventListener('yt-navigate-finish', () => {
                const newId = video.getVideoID(doc.location?.href);
                if (!newId || !overlayElement.isConnected) return;

                // The navigation control owns the identity mirrors and the
                // header title, so there is nothing to patch here.
                invoke(overlayElement, '_recordNavigation',
                    newId,
                    video.titleFromDocument(doc),
                    video.isShortVideo(doc.location?.href));
            });
        } catch (_) {}
    }

    /**
     * Poll the embed until its <video> element appears, then hand it to the
     * overlay controller. Bails out early when the embed shows a hard error.
     */
    function initPlayerInIframe(iframe, overlayElement, ambientCtx, ambientCanvas) {
        if (!overlayElement || !iframe) return;

        if (overlayElement._initPlayerTimeout) {
            clearTimeout(overlayElement._initPlayerTimeout);
            overlayElement._initPlayerTimeout = null;
        }

        let attempts = 0;

        const checkReady = () => {
            if (!overlayElement.isConnected) return;
            attempts++;

            try {
                const doc = getEmbedDocument(iframe);
                if (!doc) return;

                if (!overlayElement._isWatchFallback) {
                    if (isEmbedBlocked(doc)) {
                        requestWatchFallback(overlayElement, iframe);
                        return;
                    }
                    // No <video> after ~1.6s and a playability error is showing.
                    if (attempts >= BLOCKED_CHECK_ATTEMPT && !doc.querySelector('video') &&
                        doc.querySelector('.ytp-playability-error, [class*="error"]')) {
                        requestWatchFallback(overlayElement, iframe);
                        return;
                    }
                }

                const media = doc.querySelector('video');
                if (!media) {
                    if (attempts < INIT_MAX_ATTEMPTS) {
                        overlayElement._initPlayerTimeout = setTimeout(checkReady, INIT_POLL_INTERVAL_MS);
                    }
                    return;
                }

                overlayElement._cachedVideo = media;
                overlayElement._cachedPlayer = doc.getElementById('movie_player') || doc.querySelector('.html5-video-player');

                invoke(overlayElement, '_bindVideo', media);
                invoke(overlayElement, '_applySpeed');
                invoke(overlayElement, '_injectQualityBridge', doc);
                invoke(overlayElement, '_applyQuality');
                invoke(overlayElement, '_queryQuality');

                if (YTC.settings.autoTheater && overlayElement._isWatchFallback) {
                    const theaterBtn = doc.querySelector('.ytp-size-button');
                    if (theaterBtn && !theaterBtn.classList.contains('ytp-size-button-active')) {
                        theaterBtn.click();
                    }
                }
            } catch (_) {
                if (attempts < INIT_MAX_ATTEMPTS) {
                    overlayElement._initPlayerTimeout = setTimeout(checkReady, INIT_POLL_INTERVAL_MS);
                }
            }
        };

        checkReady();
    }

    function invoke(target, method, ...args) {
        if (typeof target[method] === 'function') target[method](...args);
    }

    /** Did the embed render one of YouTube's "playback restricted" screens? */
    function isEmbedBlocked(doc) {
        const errorEl = doc.querySelector('.ytp-error, .ytp-error-content, [class*="ytp-error"], ytd-player-error-message-renderer');
        const errorMsg = doc.querySelector('.ytp-error-message, .ytp-error-content-reason');
        const bodyText = doc.body?.textContent || '';

        return Boolean(
            (errorEl && (errorEl.offsetHeight > 0 || errorEl.offsetWidth > 0)) ||
            (errorMsg && errorMsg.textContent?.trim().length > 0) ||
            bodyText.includes('Error code:') ||
            bodyText.includes('This video is unavailable') ||
            bodyText.includes('Playback on other websites has been disabled')
        );
    }

    function requestWatchFallback(overlayElement, iframe) {
        triggerWatchFallback(overlayElement, iframe, overlayElement._currentVideoId, overlayElement._initialTimestamp);
    }

    /**
     * Embedding is blocked for this video: offer the full watch page instead.
     */
    function triggerWatchFallback(overlayElement, iframe, videoId, timestamp = null) {
        if (!overlayElement || !iframe || overlayElement._isWatchFallback || overlayElement._fallbackNoticeShown) return;
        overlayElement._fallbackNoticeShown = true;
        overlayElement._cachedVideo = null;
        overlayElement._cachedPlayer = null;

        invoke(overlayElement, '_stopAmbient');

        const playerWrapper = overlayElement.querySelector('.yt-cinema-player-wrapper');
        if (!playerWrapper) return;

        const watchUrl = video.buildPlayerUrl(videoId, overlayElement._isShort, timestamp, false);

        const fallbackCard = document.createElement('div');
        fallbackCard.className = 'yt-cinema-fallback-notice';
        fallbackCard.innerHTML = `
            <div class="yt-cinema-fallback-icon">${icons.alert}</div>
            <div class="yt-cinema-fallback-title">Playback Restricted by YouTube</div>
            <div class="yt-cinema-fallback-desc">Embedding is disabled by the owner or YouTube for this video. You can open it in a new tab or try the full web player.</div>
            <div class="yt-cinema-fallback-actions">
                <button class="yt-cinema-fallback-btn yt-cinema-fallback-btn-primary yt-cinema-fallback-open-tab" type="button">Open in New Tab</button>
                <button class="yt-cinema-fallback-btn yt-cinema-fallback-btn-secondary yt-cinema-fallback-try-full" type="button">Try Full Player</button>
            </div>
        `;

        fallbackCard.querySelector('.yt-cinema-fallback-open-tab')?.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open(watchUrl, '_blank');
            invoke(overlayElement, '_close');
        });

        fallbackCard.querySelector('.yt-cinema-fallback-try-full')?.addEventListener('click', (e) => {
            e.stopPropagation();
            fallbackCard.remove();
            overlayElement._isWatchFallback = true;
            overlayElement._showToast('Loading restricted video via full player...', icons.info);
            iframe.src = watchUrl;
        });

        playerWrapper.appendChild(fallbackCard);
    }

    // ------------------------------------------------- postMessage bridge

    /** Find the overlay that owns a given iframe window. */
    function overlayForSource(source) {
        if (!source) return null;

        const candidates = state.activeModalOverlay
            ? [state.activeModalOverlay, ...state.activeDockedOverlays]
            : state.activeDockedOverlays;

        for (const overlay of candidates) {
            const iframe = overlay.querySelector('iframe');
            if (iframe && iframe.contentWindow === source) return overlay;
        }
        return null;
    }

    function isEmbedErrorMessage(data) {
        return data.event === 'onError' ||
            (typeof data.info === 'number' && PLAYER_ERROR_CODES.includes(data.info)) ||
            (typeof data.data === 'number' && PLAYER_ERROR_CODES.includes(data.data)) ||
            (typeof data.info === 'string' && (data.info.includes('152') || data.info.includes('150') || data.info.includes('unavailable')));
    }

    function isErrorShapedPayload(payload) {
        if (typeof payload !== 'string' || !payload.startsWith('{')) return false;
        return ['onError', '150', '152', '153', '101', 'unavailable'].some(marker => payload.includes(marker));
    }

    function installOverlayMessageBridge() {
        window.addEventListener('message', (event) => {
            if (!state.activeModalOverlay && state.activeDockedOverlays.size === 0) return;
            const overlay = overlayForSource(event.source);
            if (!overlay) return;

            let data = event.data;
            if (!data) return;

            if (data.type === 'YT_CINEMA_RESIZE') {
                YTC.layout.adjustContainerSize(data.width, data.height, overlay);
                return;
            }

            if (isErrorShapedPayload(data)) {
                try {
                    data = JSON.parse(data);
                } catch (_) {
                    return;
                }
            }

            if (typeof data === 'object' && isEmbedErrorMessage(data) && !overlay._isWatchFallback) {
                const iframe = overlay.querySelector('iframe');
                if (iframe) {
                    triggerWatchFallback(overlay, iframe, overlay._currentVideoId, overlay._initialTimestamp);
                }
            }
        });
    }

    /** Current playback position in whole seconds, falling back to the link timestamp. */
    function getCurrentPlaybackSeconds(iframe, fallbackTimestamp) {
        try {
            const media = iframe.contentDocument?.querySelector('video');
            if (media && typeof media.currentTime === 'number' && media.currentTime > 0) {
                return Math.floor(media.currentTime);
            }
        } catch (_) {}

        return video.parseTimestampToSeconds(fallbackTimestamp);
    }

    YTC.player = {
        getEmbedDocument,
        injectPlayerStyles,
        installOverlayMessageBridge,
        getCurrentPlaybackSeconds
    };
})(globalThis.YTC);
