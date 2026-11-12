/**
 * Overlay — builds the overlay DOM tree, the standalone page toast and the
 * direct Picture-in-Picture entry point.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;
    const state = YTC.state;
    const icons = YTC.icons;
    const video = YTC.video;
    const layout = YTC.layout;

    const RESIZE_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

    let pageToastTimer = null;
    let pageToastEl = null;

    // -------------------------------------------------------- page toast

    function showPageToast(message, iconSvg = icons.pip, onClick = null) {
        if (!pageToastEl) {
            pageToastEl = document.createElement('div');
            pageToastEl.className = 'yt-cinema-page-toast';
            pageToastEl.innerHTML = '<span class="yt-cinema-toast-icon"></span><span class="yt-cinema-toast-text"></span>';
            document.body.appendChild(pageToastEl);
        }

        const iconEl = pageToastEl.querySelector('.yt-cinema-toast-icon');
        const textEl = pageToastEl.querySelector('.yt-cinema-toast-text');
        if (iconEl) iconEl.innerHTML = iconSvg;
        if (textEl) textEl.textContent = message;

        if (typeof onClick === 'function') {
            pageToastEl.classList.add('clickable');
            pageToastEl.onclick = (e) => {
                e.stopPropagation();
                onClick();
            };
        } else {
            pageToastEl.classList.remove('clickable');
            pageToastEl.onclick = null;
        }

        pageToastEl.classList.add('yt-cinema-toast-visible');

        if (pageToastTimer) clearTimeout(pageToastTimer);
        pageToastTimer = setTimeout(() => {
            if (pageToastEl) pageToastEl.classList.remove('yt-cinema-toast-visible');
        }, 2600);
    }

    // ------------------------------------------------------- direct PiP

    /**
     * Toggle the browser's own PiP for the page video.
     *
     * @returns {boolean} true when PiP was engaged (or already exiting), so the
     *                   caller knows not to open its own floating player.
     *                   The target is threaded in explicitly because the toast
     *                   and the fallback overlay both need it.
     */
    function toggleNativePictureInPicture(videoId, title, timestamp) {
        const pageVideo = document.querySelector('video');
        if (!pageVideo) return false;

        const announce = () => showPageToast(`Picture-in-Picture: ${String(title || 'YouTube Video').slice(0, 45)}`, icons.pip);

        // PiP refused (no user gesture, video too small, codec unsupported):
        // open the docked overlay instead so the trigger never dead-ends.
        const openFallbackOverlay = () => {
            const aspectInfo = video.detectVideoAspectRatio(null);
            createOverlay(videoId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio, true, true);
        };

        if (document.pictureInPictureEnabled || pageVideo.pictureInPictureEnabled) {
            if (document.pictureInPictureElement) {
                try {
                    document.exitPictureInPicture();
                } catch (_) {}
                return true;
            }
            if (typeof pageVideo.requestPictureInPicture === 'function') {
                pageVideo.requestPictureInPicture().then(announce, openFallbackOverlay);
                return true;
            }
        }

        const ytPipBtn = document.querySelector('.ytp-pip-button');
        if (ytPipBtn) {
            ytPipBtn.click();
            announce();
            return true;
        }

        return false;
    }

    /**
     * Open a video straight into a floating mini-player (no heavy backdrop).
     * When the target is the video already playing on this page we hand over to
     * the browser's native PiP first.
     */
    function openDirectPictureInPicture(videoId, title = 'YouTube Video', timestamp = null) {
        if (!videoId) return;

        const currentWatchId = video.getVideoID(window.location.href);
        const isCurrentPageVideo = (videoId === currentWatchId && window.location.pathname.startsWith('/watch'));
        if (isCurrentPageVideo && toggleNativePictureInPicture(videoId, title, timestamp)) return;

        // Hovered thumbnails and other pages open directly as a floating player.
        const aspectInfo = video.detectVideoAspectRatio(state.currentTarget);
        showPageToast(`Picture-in-Picture: ${title.slice(0, 45)}`, icons.pip);
        createOverlay(videoId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio, true, true);
    }

    // ----------------------------------------------------------- markup

    function buildHeaderMarkup() {
        return `
            <div class="yt-cinema-title">
                <div class="yt-cinema-drag-grip" title="Drag to reposition">${icons.dragGrip}</div>
                ${icons.clapper.replace('<svg ', '<svg class="yt-cinema-icon" ')}
                <span class="yt-cinema-shorts-badge" style="display: none;">${icons.shortsBadge}</span>
                <span class="yt-cinema-title-text"></span>
            </div>
            <div class="yt-cinema-controls">
                <div class="yt-cinema-engagement">
                    <button class="yt-cinema-subscribe-btn yt-cinema-subscribe-hidden" title="Subscribe" aria-pressed="false"><span class="yt-cinema-subscribe-icon"></span><span class="yt-cinema-subscribe-label">Subscribe</span><span class="yt-cinema-subscribe-count"></span></button>
                    <button class="yt-cinema-rating-btn yt-cinema-like-btn" title="Like this video" aria-pressed="false">${icons.thumbsUp}<span class="yt-cinema-rating-count"></span></button>
                    <button class="yt-cinema-rating-btn yt-cinema-dislike-btn" title="Dislike this video" aria-pressed="false">${icons.thumbsDown}</button>
                    <button class="yt-cinema-btn yt-cinema-comments-btn" title="Comments (Shift+C)">${icons.comment}<span class="yt-cinema-comments-count"></span></button>
                </div>
                <button type="button" class="yt-cinema-btn yt-cinema-chapters-btn" title="Chapters & Info (O)">${icons.chapters}<span class="yt-cinema-chapters-count"></span></button>
                <button type="button" class="yt-cinema-btn yt-cinema-queue-btn" title="Watch Queue (U)">${icons.queue}<span class="yt-cinema-queue-count"></span></button>
                <button class="yt-cinema-btn yt-cinema-prev-btn" title="Previous Video (P)">${icons.previous}</button>
                <button class="yt-cinema-btn yt-cinema-next-btn" title="Next Video (N)">${icons.next}</button>
                <button class="yt-cinema-btn yt-cinema-dock-btn" title="Mini-Player / Corner Dock (D)">${icons.dock}</button>
                <button type="button" class="yt-cinema-btn yt-cinema-loop-btn" title="A-B Loop (B) • Shift+Click or R to Repeat" aria-pressed="false">${icons.loop}<span class="yt-cinema-loop-badge"></span></button>
                <div class="yt-cinema-speed-container">
                    <button class="yt-cinema-speed-pill" title="Playback Speed ([ / ])">1x</button>
                    <div class="yt-cinema-speed-menu"></div>
                </div>
                <div class="yt-cinema-quality-container">
                    <button class="yt-cinema-quality-pill" title="Video Quality (Q)">Auto</button>
                    <div class="yt-cinema-quality-menu"></div>
                </div>
                <div class="yt-cinema-filters-container">
                    <button type="button" class="yt-cinema-btn yt-cinema-filters-btn" title="Cinema Filters (V) • Ultrawide Zoom (Z)">${icons.filters}</button>
                    <div class="yt-cinema-filters-menu"></div>
                </div>
                <button type="button" class="yt-cinema-btn yt-cinema-zen-btn" title="Zen Focus Mode (X) • Sleep Timer (Y)" aria-pressed="false">${icons.zen}<span class="yt-cinema-sleep-badge"></span></button>
                <button class="yt-cinema-btn yt-cinema-screenshot-btn" title="Take Screenshot (S) • Shift+Click to Copy">${icons.screenshot}</button>
                <button class="yt-cinema-btn yt-cinema-copy-btn" title="Copy Link at Current Time">${icons.copyLink}</button>
                <button class="yt-cinema-btn yt-cinema-pip-btn" title="Picture-in-Picture">${icons.pip}</button>
                <button class="yt-cinema-btn yt-cinema-newtab-btn" title="Open in New Tab">${icons.newTab}</button>
                <button class="yt-cinema-btn yt-cinema-close-btn" title="Close (ESC)">${icons.close}</button>
            </div>
        `;
    }

    function buildFooterMarkup() {
        return `
            <div class="yt-cinema-hint">
                <span class="yt-cinema-key">ESC</span> Close
                <span class="yt-cinema-key">D</span> Dock
                <span class="yt-cinema-key">B</span> Loop
                <span class="yt-cinema-key">O</span> Chapters
                <span class="yt-cinema-key">U</span> Queue
                <span class="yt-cinema-key">V</span> Filters
                <span class="yt-cinema-key">Z</span> Zoom
                <span class="yt-cinema-key">X</span> Zen
                <span class="yt-cinema-key">Y</span> Sleep
                <span class="yt-cinema-key">Q</span> Quality
                <span class="yt-cinema-key">[</span><span class="yt-cinema-key">]</span> Speed
                <span class="yt-cinema-key">S</span> Shot
                <span class="yt-cinema-key">↑</span><span class="yt-cinema-key">↓</span> Vol
                <span class="yt-cinema-key">M</span> Mute
                <span class="yt-cinema-key">P</span><span class="yt-cinema-key">N</span> Nav
                <span class="yt-cinema-key">F</span> Full
            </div>
            <div class="yt-cinema-branding">Cinema Mode</div>
        `;
    }

    function buildOverlayElements({ title, isShort, videoId, initialTimestamp, startDocked, isDirectPiP, dims }) {
        const overlay = document.createElement('div');
        overlay.id = 'yt-cinema-overlay-' + Date.now();
        overlay.className = 'yt-cinema-overlay';
        overlay.dataset.videoId = videoId;

        const container = document.createElement('div');
        container.className = 'yt-cinema-container';
        if (startDocked) container.classList.add('yt-cinema-docked');
        if (isDirectPiP) container.classList.add('yt-cinema-pip-mode');
        layout.sizeContainer(container, dims, { ratio: dims.ratio });

        const header = document.createElement('div');
        header.className = 'yt-cinema-header';
        header.innerHTML = buildHeaderMarkup();

        const playerWrapper = document.createElement('div');
        playerWrapper.className = 'yt-cinema-player-wrapper';

        const iframe = document.createElement('iframe');
        iframe.className = 'yt-cinema-iframe';
        iframe.src = video.buildPlayerUrl(videoId, isShort, initialTimestamp, true);
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';

        const dragShield = document.createElement('div');
        dragShield.className = 'yt-cinema-drag-shield';

        const shutterFlash = document.createElement('div');
        shutterFlash.className = 'yt-cinema-shutter-flash';

        const toast = document.createElement('div');
        toast.className = 'yt-cinema-toast';
        toast.innerHTML = '<span class="yt-cinema-toast-icon"></span><span class="yt-cinema-toast-text"></span>';

        const volumeHud = document.createElement('div');
        volumeHud.className = 'yt-cinema-volume-hud';
        volumeHud.innerHTML = `
            <span class="yt-cinema-volume-icon"></span>
            <div class="yt-cinema-volume-track">
                <div class="yt-cinema-volume-fill"></div>
            </div>
            <span class="yt-cinema-volume-text">100%</span>
        `;

        const commentsPanel = document.createElement('div');
        commentsPanel.className = 'yt-cinema-comments-panel';
        commentsPanel.setAttribute('aria-hidden', 'true');
        commentsPanel.innerHTML = `
            <div class="yt-cinema-comments-head">
                <span class="yt-cinema-comments-heading">Comments</span>
                <span class="yt-cinema-comments-total"></span>
                <button class="yt-cinema-comments-close" title="Close comments (Shift+C or Esc)">${icons.close}</button>
            </div>
            <div class="yt-cinema-comments-status"></div>
            <div class="yt-cinema-comments-list"></div>
            <button class="yt-cinema-comments-more" title="Load more comments">Show more comments</button>
        `;

        const loopBar = document.createElement('div');
        loopBar.className = 'yt-cinema-loop-bar';
        loopBar.innerHTML = '<div class="yt-cinema-loop-fill"></div>';

        const chaptersPanel = document.createElement('div');
        chaptersPanel.className = 'yt-cinema-chapters-panel';
        chaptersPanel.setAttribute('aria-hidden', 'true');
        chaptersPanel.innerHTML = `
            <div class="yt-cinema-chapters-head">
                <span class="yt-cinema-chapters-heading">Chapters &amp; Info</span>
                <span class="yt-cinema-chapters-total"></span>
                <button type="button" class="yt-cinema-chapters-close" title="Close chapters (O or Esc)">${icons.close}</button>
            </div>
            <div class="yt-cinema-chapters-meta">
                <div class="yt-cinema-chapters-desc"></div>
            </div>
            <div class="yt-cinema-chapters-status"></div>
            <div class="yt-cinema-chapters-list"></div>
        `;

        const queuePanel = document.createElement('div');
        queuePanel.className = 'yt-cinema-queue-panel';
        queuePanel.setAttribute('aria-hidden', 'true');
        queuePanel.innerHTML = `
            <div class="yt-cinema-queue-head">
                <span class="yt-cinema-queue-heading">Watch Queue</span>
                <button type="button" class="yt-cinema-queue-clear" title="Clear watch queue">Clear</button>
                <button type="button" class="yt-cinema-queue-close" title="Close queue (U or Esc)">${icons.close}</button>
            </div>
            <div class="yt-cinema-queue-status"></div>
            <div class="yt-cinema-queue-list"></div>
        `;

        playerWrapper.appendChild(iframe);
        playerWrapper.appendChild(dragShield);
        playerWrapper.appendChild(shutterFlash);
        playerWrapper.appendChild(loopBar);
        playerWrapper.appendChild(volumeHud);
        playerWrapper.appendChild(commentsPanel);
        playerWrapper.appendChild(chaptersPanel);
        playerWrapper.appendChild(queuePanel);
        playerWrapper.appendChild(toast);

        const footer = document.createElement('div');
        footer.className = 'yt-cinema-footer';
        footer.innerHTML = buildFooterMarkup();

        container.appendChild(header);
        container.appendChild(playerWrapper);
        container.appendChild(footer);

        for (const dir of RESIZE_DIRECTIONS) {
            const handle = document.createElement('div');
            handle.className = `yt-cinema-resize-handle yt-cinema-resize-${dir}`;
            handle.dataset.direction = dir;
            container.appendChild(handle);
        }

        const resizeGrip = document.createElement('div');
        resizeGrip.className = 'yt-cinema-resize-grip';
        resizeGrip.dataset.direction = 'se';
        resizeGrip.setAttribute('title', 'Drag corner to resize');
        resizeGrip.innerHTML = icons.resizeGrip;
        container.appendChild(resizeGrip);

        const ambientLayer = document.createElement('div');
        ambientLayer.className = 'yt-cinema-ambient-layer';
        ambientLayer.style.width = `${dims.width}px`;
        ambientLayer.style.height = `${dims.height}px`;

        const ambientCanvas = document.createElement('canvas');
        ambientCanvas.className = 'yt-cinema-ambient-canvas';
        ambientCanvas.width = 32;
        ambientCanvas.height = 18;

        const ambientFallback = document.createElement('div');
        ambientFallback.className = 'yt-cinema-ambient-fallback';

        ambientLayer.appendChild(ambientFallback);
        ambientLayer.appendChild(ambientCanvas);

        overlay.appendChild(ambientLayer);
        overlay.appendChild(container);

        const titleTextEl = header.querySelector('.yt-cinema-title-text');
        if (titleTextEl) {
            const safeTitle = title || 'YouTube Video';
            titleTextEl.textContent = safeTitle;
            titleTextEl.setAttribute('title', safeTitle);
        }
        if (isShort) {
            const badge = header.querySelector('.yt-cinema-shorts-badge');
            if (badge) badge.style.display = 'inline-flex';
        }

        return { overlay, container, iframe, ambientCtx: ambientCanvas.getContext('2d'), ambientCanvas, ambientLayer };
    }

    /**
     * Create, register and wire up a new cinema overlay.
     *
     * @param {object} options
     * @param {boolean} startDocked  open straight into the floating mini-player
     * @param {boolean} isDirectPiP  suppress backdrop chrome for direct-PiP mode
     */
    function createOverlay(videoId, title, initialTimestamp = null, isShort = false, initialRatio = null, startDocked = false, isDirectPiP = false) {
        if (!startDocked && state.activeModalOverlay && typeof state.activeModalOverlay._close === 'function') {
            state.activeModalOverlay._close();
        }
        YTC.hover.hideIndicator();

        // Exact initial dimensions, computed instantly with no placeholder sizing.
        const effectiveRatio = (initialRatio && initialRatio > 0) ? initialRatio : (isShort ? video.VERTICAL_RATIO : video.HORIZONTAL_RATIO);
        const effectiveVertical = isShort || effectiveRatio < video.VERTICAL_THRESHOLD;
        const dims = layout.calculateContainerDimensions(effectiveRatio, effectiveVertical);

        const elements = buildOverlayElements({
            title, isShort, videoId, initialTimestamp, startDocked, isDirectPiP, dims
        });
        const { overlay, iframe, ambientCtx, ambientCanvas, ambientLayer } = elements;

        if (ambientCtx) {
            ambientCtx.imageSmoothingQuality = 'high';
        }

        overlay._currentVideoId = videoId;
        overlay._initialTimestamp = initialTimestamp;
        overlay._isShort = isShort;
        overlay._isWatchFallback = false;

        if (startDocked) {
            state.activeDockedOverlays.add(overlay);
            overlay.classList.add('yt-cinema-docked');
        } else {
            state.activeModalOverlay = overlay;
        }

        document.body.appendChild(overlay);

        if (!startDocked) {
            YTC.applyBackdropSettings(overlay);
            YTC.lockScroll();
        }
        YTC.pauseBackgroundVideo();

        requestAnimationFrame(() => {
            overlay.classList.add('yt-cinema-visible');
        });

        iframe.addEventListener('load', () => {
            YTC.player.injectPlayerStyles(iframe, overlay._currentVideoId || videoId, overlay, ambientCtx, ambientCanvas, overlay._isWatchFallback);
        });

        YTC.controller.setupOverlayEvents(overlay, iframe, {
            videoId,
            initialTimestamp,
            isShort,
            ambientCtx,
            ambientCanvas,
            ambientLayer,
            startDocked,
            isDirectPiP
        });
    }

    YTC.overlay = { openDirectPictureInPicture, createOverlay, showPageToast };
})(globalThis.YTC);
