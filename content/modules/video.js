/**
 * Video — pure helpers for reading video identity, titles and aspect ratios
 * out of YouTube URLs and DOM. No state, no side effects.
 */
(function (YTC) {
    'use strict';

    const VIDEO_ID_PATTERNS = [
        /[?&]v=([^&]+)/,
        /\/shorts\/([^?&]+)/,
        /youtu\.be\/([^?&]+)/
    ];

    const VERTICAL_RATIO = 9 / 16;
    const HORIZONTAL_RATIO = 16 / 9;
    const VERTICAL_THRESHOLD = 0.85;

    function getVideoID(url) {
        if (!url) return null;
        for (const pattern of VIDEO_ID_PATTERNS) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    function isShortVideo(url) {
        if (!url) return false;
        return /\/shorts\//i.test(url);
    }

    function getVideoTimestamp(url) {
        if (!url) return null;
        const match = url.match(/[?&](?:t|start)=([0-9hms]+)/i);
        return match ? match[1] : null;
    }

    function parseTimestampToSeconds(ts) {
        if (!ts) return 0;
        if (typeof ts === 'number') return Math.floor(ts);
        const str = String(ts).trim();
        if (/^\d+s?$/i.test(str)) return parseInt(str, 10);

        let total = 0;
        const h = str.match(/(\d+)h/i);
        const m = str.match(/(\d+)m/i);
        const s = str.match(/(\d+)s/i);
        if (h) total += parseInt(h[1], 10) * 3600;
        if (m) total += parseInt(m[1], 10) * 60;
        if (s) total += parseInt(s[1], 10);
        return total;
    }

    function buildPlayerUrl(videoId, isShort = false, timestamp = null, useEmbed = true) {
        const loop = isShort ? `&loop=1&playlist=${encodeURIComponent(videoId)}` : '';

        if (useEmbed) {
            let src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&enablejsapi=1&rel=0`;
            const sec = timestamp ? parseTimestampToSeconds(timestamp) : 0;
            if (sec > 0) src += `&start=${sec}`;
            return src + loop;
        }

        let src = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&autoplay=1`;
        if (timestamp) src += `&t=${encodeURIComponent(timestamp)}`;
        return src + loop;
    }

    const TITLE_CONTAINER_SELECTOR =
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
        'ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ' +
        'yt-lockup-view-model, ytd-rich-grid-media';

    const TITLE_ELEMENT_SELECTOR =
        '#video-title, #title, .yt-lockup-metadata-view-model-wiz__title, ' +
        'yt-formatted-string[title], h3 a, [id="video-title-link"]';

    const WATCH_TITLE_SELECTOR =
        'h1.ytd-watch-metadata yt-formatted-string, #title h1, yt-formatted-string.ytd-watch-metadata';

    /** YouTube ships alt="true" on search-result thumbnails; that is not a title. */
    const UNUSABLE_TITLE_TEXT = new Set(['true', 'false']);

    function normalizeTitle(value) {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (!text || UNUSABLE_TITLE_TEXT.has(text.toLowerCase())) return null;
        return text;
    }

    function getVideoTitle(element) {
        if (!element) return 'YouTube Video';

        // 1. Title / aria-label on the element itself or an inner anchor
        const directTitle = normalizeTitle(element.getAttribute('title')) ||
            normalizeTitle(element.getAttribute('aria-label')) ||
            normalizeTitle(element.querySelector('a[title]')?.getAttribute('title')) ||
            normalizeTitle(element.querySelector('a[aria-label]')?.getAttribute('aria-label'));
        if (directTitle) return directTitle;

        // 2. Alt text on the thumbnail image
        const imgAlt = normalizeTitle(element.querySelector('img[alt]')?.getAttribute('alt'));
        if (imgAlt) return imgAlt;

        // 3. Closest video container (standard + newer YouTube web components)
        const container = element.closest(TITLE_CONTAINER_SELECTOR);
        if (container) {
            const titleEl = container.querySelector(TITLE_ELEMENT_SELECTOR);
            if (titleEl) {
                const text = normalizeTitle(titleEl.getAttribute('title')) || normalizeTitle(titleEl.textContent);
                if (text) return text;
            }
        }

        return 'YouTube Video';
    }

    function titleFromDocument(doc) {
        const titleEl = doc?.querySelector(WATCH_TITLE_SELECTOR);
        return titleEl?.textContent?.trim() || doc?.title?.replace(/ - YouTube$/, '').trim() || 'YouTube Video';
    }

    function getCurrentWatchPageTitle() {
        return titleFromDocument(document);
    }

    /**
     * Instant aspect-ratio detection from the thumbnail / DOM metadata,
     * so the container can be sized correctly on the very first frame.
     */
    function detectVideoAspectRatio(link) {
        if (!link) return detectPageAspectRatio();

        const href = link.href || window.location.href || '';
        if (isShortVideo(href)) {
            return { ratio: VERTICAL_RATIO, isVertical: true };
        }

        if (isShortsElement(link)) {
            return { ratio: VERTICAL_RATIO, isVertical: true };
        }

        // 1. Thumbnail container bounding box
        const rect = resolveThumbnailRect(link);
        if (rect) {
            const r = rect.width / rect.height;
            if (r < VERTICAL_THRESHOLD) {
                return { ratio: VERTICAL_RATIO, isVertical: true };
            }
            if (r <= 2.5) {
                if (Math.abs(r - HORIZONTAL_RATIO) < 0.08) {
                    return { ratio: HORIZONTAL_RATIO, isVertical: false };
                }
                return { ratio: r, isVertical: false };
            }
        }

        // 2. Thumbnail image natural dimensions
        const thumbImg = link.querySelector('img') ||
            link.closest('ytd-thumbnail, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer')?.querySelector('img');
        if (thumbImg && thumbImg.naturalWidth > 0 && thumbImg.naturalHeight > 0) {
            const imgRatio = thumbImg.naturalWidth / thumbImg.naturalHeight;
            if (imgRatio < VERTICAL_THRESHOLD) {
                return { ratio: VERTICAL_RATIO, isVertical: true };
            }
            if (Math.abs(imgRatio - HORIZONTAL_RATIO) < 0.08) {
                return { ratio: HORIZONTAL_RATIO, isVertical: false };
            }
        }

        return { ratio: HORIZONTAL_RATIO, isVertical: false };
    }

    function detectPageAspectRatio() {
        if (isShortVideo(window.location.href)) {
            return { ratio: VERTICAL_RATIO, isVertical: true };
        }
        const pageVideo = document.querySelector('video');
        if (pageVideo && pageVideo.videoWidth > 0 && pageVideo.videoHeight > 0) {
            const r = pageVideo.videoWidth / pageVideo.videoHeight;
            return { ratio: r, isVertical: r < VERTICAL_THRESHOLD };
        }
        return { ratio: HORIZONTAL_RATIO, isVertical: false };
    }

    function isShortsElement(link) {
        return Boolean(link.closest(
            'ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ' +
            'ytd-rich-shelf-renderer[is-shorts], [is-shorts], ' +
            'yt-lockup-view-model[is-shorts], [aspect-ratio="9:16"]'
        ));
    }

    function resolveThumbnailRect(link) {
        const thumbContainer = link.closest('ytd-thumbnail, .yt-lockup-view-model-wiz__media, ytd-reel-item-renderer') || link;
        const rect = thumbContainer.getBoundingClientRect();
        return (rect.width > 0 && rect.height > 0) ? rect : null;
    }

    const RECOMMENDATION_ROOTS = 'ytd-watch-next-secondary-results-renderer, #related, ytd-rich-grid-renderer, ytd-browse[page-subtype="home"]';
    const RECOMMENDATION_LINKS =
        'a#thumbnail[href*="watch?v="], a#thumbnail[href*="shorts/"], ' +
        'a.yt-lockup-view-model__content-image, ytd-compact-video-renderer a#thumbnail';

    function findNextRecommendation(currentId) {
        // Look within YouTube's related / recommended containers first
        const scopedContainer = document.querySelector(RECOMMENDATION_ROOTS);
        const searchRoot = scopedContainer || document;

        for (const link of searchRoot.querySelectorAll(RECOMMENDATION_LINKS)) {
            const vId = getVideoID(link.href);
            if (vId && vId !== currentId) {
                return {
                    videoId: vId,
                    title: getVideoTitle(link),
                    isShort: isShortVideo(link.href)
                };
            }
        }
        return null;
    }

    YTC.video = {
        VERTICAL_RATIO,
        HORIZONTAL_RATIO,
        VERTICAL_THRESHOLD,
        getVideoID,
        isShortVideo,
        getVideoTimestamp,
        parseTimestampToSeconds,
        buildPlayerUrl,
        getVideoTitle,
        getCurrentWatchPageTitle,
        titleFromDocument,
        detectVideoAspectRatio,
        findNextRecommendation
    };
})(globalThis.YTC);
