/**
 * Launcher — the single place that decides *how* a video gets opened.
 * Every trigger (hotkey, Alt+Click, middle-click, hover badge, global command)
 * funnels through these two helpers.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;
    const video = YTC.video;
    const overlay = YTC.overlay;

    /**
     * @param {HTMLAnchorElement} link        the thumbnail link to open
     * @param {object}  [options]
     * @param {boolean} [options.startDocked] open straight into the mini-player
     * @param {boolean} [options.useDirectPiP] force the direct-PiP route
     * @returns {boolean} whether a video was found and launched
     */
    function openFromLink(link, { startDocked = false, useDirectPiP = settings.directPiP } = {}) {
        if (!link || !link.href) return false;

        const videoId = video.getVideoID(link.href);
        if (!videoId) return false;

        const title = video.getVideoTitle(link);
        const timestamp = video.getVideoTimestamp(link.href) ||
            YTC.progress.resumeTimestamp(videoId);

        if (useDirectPiP) {
            overlay.openDirectPictureInPicture(videoId, title, timestamp);
        } else {
            const aspect = video.detectVideoAspectRatio(link);
            overlay.createOverlay(videoId, title, timestamp, aspect.isVertical, aspect.ratio, startDocked);
        }
        return true;
    }

    /**
     * Open whatever video the current page is playing.
     *
     * @param {object}   [options]
     * @param {boolean}  [options.startDocked]       open straight into the mini-player
     * @param {boolean}  [options.useDirectPiP]      force the direct-PiP route
     * @param {boolean}  [options.timestampFromUrl]  fall back to the ?t= URL param at 0s
     * @param {boolean}  [options.requireWatchPath]  only act on /watch and /shorts pages
     * @returns {boolean} whether a video was found and launched
     */
    function openFromPage({ startDocked = false, useDirectPiP = settings.directPiP, timestampFromUrl = false, requireWatchPath = false } = {}) {
        if (requireWatchPath && !isWatchLikePath()) return false;

        const videoId = video.getVideoID(window.location.href);
        if (!videoId) return false;

        const title = video.getCurrentWatchPageTitle();
        const pageVideo = document.querySelector('video');
        let timestamp = (pageVideo && pageVideo.currentTime > 0)
            ? Math.floor(pageVideo.currentTime).toString()
            : null;
        if (!timestamp && timestampFromUrl) {
            timestamp = video.getVideoTimestamp(window.location.href);
        }
        if (!timestamp) {
            timestamp = YTC.progress.resumeTimestamp(videoId);
        }

        if (useDirectPiP) {
            overlay.openDirectPictureInPicture(videoId, title, timestamp);
        } else {
            const aspect = video.detectVideoAspectRatio(null);
            overlay.createOverlay(videoId, title, timestamp, aspect.isVertical, aspect.ratio, startDocked);
        }
        return true;
    }

    function isWatchLikePath() {
        return window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts/');
    }

    YTC.launcher = { openFromLink, openFromPage, isWatchLikePath };
})(globalThis.YTC);
