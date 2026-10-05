(function () {
    'use strict';

    const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

    let currentTarget = null;
    let activeModalOverlay = null;
    const activeDockedOverlays = new Set();
    let topZIndex = 2147483640;
    let savedDockedPos = null;
    let savedDockedSize = null;
    let savedDockedShortsSize = null;

    try {
        api.storage.local.get(['ytCinemaDockedPos', 'ytCinemaDockedSize', 'ytCinemaDockedShortsSize'], (res) => {
            if (res) {
                if (res.ytCinemaDockedPos) savedDockedPos = res.ytCinemaDockedPos;
                if (res.ytCinemaDockedSize) savedDockedSize = res.ytCinemaDockedSize;
                if (res.ytCinemaDockedShortsSize) savedDockedShortsSize = res.ytCinemaDockedShortsSize;
            }
        });
    } catch (_) {}

    let wasBackgroundPlaying = false;
    let backgroundVideoElement = null;

    let settings = {
        hotkey: 'h',
        overlayOpacity: 90,
        backdropStyle: 'glass',
        ambientLighting: true,
        ambientFullScreen: true,
        ambientGlow: 75,
        autoPause: true,
        autoHideControls: false,
        rememberSpeed: false,
        savedSpeed: 1,
        directMiniPlayer: true,
        directPiP: false,
        altClickTrigger: true,
        middleClickTrigger: false,
        playerWidth: 85,
        autoTheater: true,
        showControls: true,
        showIndicator: true
    };

    function applyAmbientSettings(targetOverlay = activeModalOverlay) {
        if (!targetOverlay) return;
        const ambientLayer = targetOverlay.querySelector('.yt-cinema-ambient-layer');
        if (!ambientLayer) return;

        ambientLayer.style.display = settings.ambientLighting ? 'flex' : 'none';
        if (!settings.ambientLighting) return;

        const isFullScreenGlow = settings.ambientFullScreen !== false;
        if (isFullScreenGlow) {
            ambientLayer.classList.add('yt-cinema-ambient-fullscreen');
            ambientLayer.style.width = '100vw';
            ambientLayer.style.height = '100vh';
        } else {
            ambientLayer.classList.remove('yt-cinema-ambient-fullscreen');
            const cont = targetOverlay.querySelector('.yt-cinema-container');
            if (cont) {
                ambientLayer.style.width = cont.style.width;
                ambientLayer.style.height = cont.style.height;
            }
        }

        const glowVal = typeof settings.ambientGlow === 'number' ? settings.ambientGlow : 75;
        const normalized = Math.max(0.2, Math.min(1.0, glowVal / 100));

        const haloBlur = Math.round(30 + normalized * 70);
        const haloScale = (1.04 + normalized * 0.12).toFixed(2);
        const fsBlur = Math.round(50 + normalized * 90);
        const fsScale = (1.12 + normalized * 0.35).toFixed(2);
        const opacity = (0.35 + normalized * 0.55).toFixed(2);
        const brightness = Math.round(95 + normalized * 25);

        targetOverlay.style.setProperty('--yt-cinema-ambient-blur', `${haloBlur}px`);
        targetOverlay.style.setProperty('--yt-cinema-ambient-scale', haloScale);
        targetOverlay.style.setProperty('--yt-cinema-ambient-fs-blur', `${fsBlur}px`);
        targetOverlay.style.setProperty('--yt-cinema-ambient-fs-scale', fsScale);
        targetOverlay.style.setProperty('--yt-cinema-ambient-opacity', opacity);
        targetOverlay.style.setProperty('--yt-cinema-ambient-brightness', `${brightness}%`);
    }

    function applyBackdropSettings(targetOverlay = activeModalOverlay) {
        if (!targetOverlay) return;
        if (settings.backdropStyle === 'oled') {
            targetOverlay.classList.add('yt-cinema-oled');
            targetOverlay.style.removeProperty('--yt-cinema-backdrop-bg');
            targetOverlay.style.removeProperty('--yt-cinema-backdrop-blur');
        } else {
            targetOverlay.classList.remove('yt-cinema-oled');
            const opacity = (settings.overlayOpacity !== undefined ? settings.overlayOpacity : 90) / 100;
            targetOverlay.style.setProperty('--yt-cinema-backdrop-bg', `rgba(0, 0, 0, ${opacity})`);
            targetOverlay.style.setProperty('--yt-cinema-backdrop-blur', 'blur(20px)');
        }

        applyAmbientSettings(targetOverlay);
    }

    function pauseBackgroundVideo() {
        if (!settings.autoPause) return;
        try {
            const videos = document.querySelectorAll('video');
            for (const vid of videos) {
                // Ignore any video inside any of our cinema overlays
                if (vid.closest('.yt-cinema-overlay')) continue;
                if (!vid.paused && !vid.ended && vid.readyState > 1) {
                    backgroundVideoElement = vid;
                    wasBackgroundPlaying = true;
                    vid.pause();
                    break;
                }
            }
        } catch (e) {
            console.log('[Cinema Mode] Could not pause background video:', e);
        }
    }

    function resumeBackgroundVideo() {
        if (activeModalOverlay || activeDockedOverlays.size > 0) return;
        if (wasBackgroundPlaying && backgroundVideoElement) {
            try {
                backgroundVideoElement.play().catch(() => {});
            } catch (e) {}
        }
        wasBackgroundPlaying = false;
        backgroundVideoElement = null;
    }

    // Handle commands from background service worker
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.action === 'toggle-cinema') {
            if (activeModalOverlay && typeof activeModalOverlay._close === 'function') {
                activeModalOverlay._close();
            } else if (currentTarget && currentTarget.href) {
                const vidId = getVideoID(currentTarget.href);
                if (vidId) {
                    const title = getVideoTitle(currentTarget);
                    const timestamp = getVideoTimestamp(currentTarget.href);
                    if (settings.directPiP) {
                        openDirectPictureInPicture(vidId, title, timestamp);
                    } else {
                        const aspectInfo = detectVideoAspectRatio(currentTarget);
                        createOverlay(vidId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio);
                    }
                }
            } else {
                // If on a watch or shorts page, toggle current video
                const vidId = getVideoID(window.location.href);
                if (vidId) {
                    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, yt-formatted-string.ytd-watch-metadata');
                    const pageTitle = titleEl?.textContent?.trim() || document.title.replace(/ - YouTube$/, '').trim() || 'YouTube Video';
                    let pageTimestamp = null;
                    const pageVideo = document.querySelector('video');
                    if (pageVideo && pageVideo.currentTime > 0) {
                        pageTimestamp = Math.floor(pageVideo.currentTime).toString();
                    } else {
                        pageTimestamp = getVideoTimestamp(window.location.href);
                    }
                    if (settings.directPiP) {
                        openDirectPictureInPicture(vidId, pageTitle, pageTimestamp);
                    } else {
                        const aspectInfo = detectVideoAspectRatio(null);
                        createOverlay(vidId, pageTitle, pageTimestamp, aspectInfo.isVertical, aspectInfo.ratio);
                    }
                }
            }
        }
    });

    // Instant aspect ratio detection from thumbnail / DOM metadata (0ms latency)
    function detectVideoAspectRatio(link) {
        if (!link) {
            if (isShortVideo(window.location.href)) {
                return { ratio: 9 / 16, isVertical: true };
            }
            const pageVideo = document.querySelector('video');
            if (pageVideo && pageVideo.videoWidth > 0 && pageVideo.videoHeight > 0) {
                const r = pageVideo.videoWidth / pageVideo.videoHeight;
                return { ratio: r, isVertical: r < 0.85 };
            }
            return { ratio: 16 / 9, isVertical: false };
        }

        const href = link.href || window.location.href || '';
        if (isShortVideo(href)) {
            return { ratio: 9 / 16, isVertical: true };
        }

        const isShortsElement = link.closest(
            'ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ' +
            'ytd-rich-shelf-renderer[is-shorts], [is-shorts], ' +
            'yt-lockup-view-model[is-shorts], [aspect-ratio="9:16"]'
        );
        if (isShortsElement) {
            return { ratio: 9 / 16, isVertical: true };
        }

        // 1. Inspect thumbnail container bounding rect
        const thumbContainer = link.closest('ytd-thumbnail, .yt-lockup-view-model-wiz__media, ytd-reel-item-renderer') || link;
        if (thumbContainer) {
            const rect = thumbContainer.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const r = rect.width / rect.height;
                if (r < 0.85) {
                    return { ratio: 9 / 16, isVertical: true };
                }
                if (r >= 0.85 && r <= 2.5) {
                    if (Math.abs(r - (16 / 9)) < 0.08) {
                        return { ratio: 16 / 9, isVertical: false };
                    }
                    return { ratio: r, isVertical: false };
                }
            }
        }

        // 2. Inspect thumbnail image natural dimensions if available
        const thumbImg = link.querySelector('img') ||
            link.closest('ytd-thumbnail, yt-lockup-view-model, ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer')?.querySelector('img');
        if (thumbImg && thumbImg.naturalWidth > 0 && thumbImg.naturalHeight > 0) {
            const imgRatio = thumbImg.naturalWidth / thumbImg.naturalHeight;
            if (imgRatio < 0.85) {
                return { ratio: 9 / 16, isVertical: true };
            }
            if (Math.abs(imgRatio - (16 / 9)) < 0.08) {
                return { ratio: 16 / 9, isVertical: false };
            }
        }

        return { ratio: 16 / 9, isVertical: false };
    }

    // Exact container dimensions calculation based on ratio and chrome height
    function calculateContainerDimensions(ratio = 16 / 9, isVertical = false) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Exact measured header (61px) + footer (43px) = 104px
        const chromeHeight = 104;

        if (isVertical || ratio < 0.85) {
            const vertRatio = (ratio && ratio < 0.85) ? ratio : (9 / 16);
            const targetH = Math.min(viewportHeight * 0.85, 850);
            const playerAreaH = targetH - chromeHeight;
            const targetW = Math.max(290, Math.min(480, playerAreaH * vertRatio));
            return {
                width: Math.round(targetW),
                height: Math.round(targetH),
                isVertical: true,
                ratio: vertRatio
            };
        }

        const maxOuterWidth = Math.round(viewportWidth * 0.85);
        const maxOuterHeight = Math.round(viewportHeight * 0.85);

        const availableVideoHeight = maxOuterHeight - chromeHeight;
        const availableVideoWidth = maxOuterWidth;

        const safeRatio = (ratio && ratio > 0) ? ratio : (16 / 9);

        let videoW = availableVideoWidth;
        let videoH = videoW / safeRatio;

        if (videoH > availableVideoHeight) {
            videoH = availableVideoHeight;
            videoW = videoH * safeRatio;
        }

        return {
            width: Math.round(videoW),
            height: Math.round(videoH + chromeHeight),
            isVertical: false,
            ratio: safeRatio
        };
    }

    // Communication channel between iframe and main page
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'YT_CINEMA_RESIZE') {
            const { width, height } = event.data;
            const allOverlays = [activeModalOverlay, ...activeDockedOverlays].filter(Boolean);
            for (const ov of allOverlays) {
                const ifr = ov.querySelector('iframe');
                if (ifr && ifr.contentWindow === event.source) {
                    adjustContainerSize(width, height, ov);
                    break;
                }
            }
        }
    });

    function adjustContainerSize(videoWidth, videoHeight, targetOverlay = activeModalOverlay) {
        if (!targetOverlay) return;
        const container = targetOverlay.querySelector('.yt-cinema-container');
        if (!container || container.classList.contains('yt-cinema-docked')) return;
        if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) return;

        const newRatio = videoWidth / videoHeight;
        const isVertical = newRatio < 0.85 || container.classList.contains('yt-cinema-shorts');

        // Check if current container ratio is already within 3% of video ratio to prevent layout jank
        const currentRatio = parseFloat(container.dataset.aspectRatio) || (16 / 9);
        const ratioDiff = Math.abs(newRatio - currentRatio);
        const verticalMatches = isVertical === container.classList.contains('yt-cinema-shorts');

        if (ratioDiff < 0.03 && verticalMatches) {
            return; // Already accurate! Skip resize to prevent latency and visual jump.
        }

        const dims = calculateContainerDimensions(newRatio, isVertical);
        container.dataset.aspectRatio = newRatio.toString();

        if (dims.isVertical) {
            container.classList.add('yt-cinema-shorts');
            if (!container.querySelector('.yt-cinema-shorts-notch')) {
                const notch = document.createElement('div');
                notch.className = 'yt-cinema-shorts-notch';
                container.insertBefore(notch, container.firstChild);
            }
        } else {
            container.classList.remove('yt-cinema-shorts');
            const notch = container.querySelector('.yt-cinema-shorts-notch');
            if (notch) notch.remove();
        }

        container.style.width = `${dims.width}px`;
        container.style.height = `${dims.height}px`;

        const ambientLayer = targetOverlay.querySelector('.yt-cinema-ambient-layer');
        if (ambientLayer && settings.ambientFullScreen === false) {
            ambientLayer.style.width = `${dims.width}px`;
            ambientLayer.style.height = `${dims.height}px`;
        }
    }

    function clampDockedWithinViewport(container) {
        if (!container) return;
        const MARGIN = 16;
        let contW = container.offsetWidth || 540;
        let contH = container.offsetHeight || 340;

        const maxAllowedW = Math.max(300, window.innerWidth - MARGIN * 2);
        const maxAllowedH = Math.max(200, window.innerHeight - MARGIN * 2);
        if (contW > maxAllowedW) {
            contW = maxAllowedW;
            container.style.setProperty('--yt-dock-w', `${maxAllowedW}px`);
        }
        if (contH > maxAllowedH) {
            contH = maxAllowedH;
            container.style.setProperty('--yt-dock-h', `${maxAllowedH}px`);
        }

        const maxX = Math.max(MARGIN, window.innerWidth - contW - MARGIN);
        const maxY = Math.max(MARGIN, window.innerHeight - contH - MARGIN);

        let curX = parseFloat(container.dataset.dockX);
        let curY = parseFloat(container.dataset.dockY);
        if (isNaN(curX) || isNaN(curY)) return;

        curX = Math.max(MARGIN, Math.min(maxX, curX));
        curY = Math.max(MARGIN, Math.min(maxY, curY));

        container.style.setProperty('--yt-dock-x', `${curX}px`);
        container.style.setProperty('--yt-dock-y', `${curY}px`);
        container.dataset.dockX = curX.toString();
        container.dataset.dockY = curY.toString();
    }

    // Responsive window resize handling
    let resizeDebounceTimer = null;
    window.addEventListener('resize', () => {
        if (activeModalOverlay) {
            const cont = activeModalOverlay.querySelector('.yt-cinema-container');
            if (cont && !cont.classList.contains('yt-cinema-docked')) {
                if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
                resizeDebounceTimer = setTimeout(() => {
                    const ratio = parseFloat(cont.dataset.aspectRatio) || (16 / 9);
                    const isVertical = cont.classList.contains('yt-cinema-shorts') || ratio < 0.85;
                    const dims = calculateContainerDimensions(ratio, isVertical);
                    cont.style.width = `${dims.width}px`;
                    cont.style.height = `${dims.height}px`;
                    const ambientLayer = activeModalOverlay.querySelector('.yt-cinema-ambient-layer');
                    if (ambientLayer && settings.ambientFullScreen === false) {
                        ambientLayer.style.width = `${dims.width}px`;
                        ambientLayer.style.height = `${dims.height}px`;
                    }
                }, 100);
            }
        }

        // Keep all docked floating mini-players safely inside the viewport
        for (const dockedOv of activeDockedOverlays) {
            const cont = dockedOv.querySelector('.yt-cinema-container');
            if (cont && cont.classList.contains('yt-cinema-docked')) {
                clampDockedWithinViewport(cont);
            }
        }
    });

    try {
        const updateFromSettings = (cinemaSettings) => {
            if (cinemaSettings) {
                settings = { ...settings, ...cinemaSettings };
                updateHoverIndicatorHotkey();
                if (activeModalOverlay) {
                    applyBackdropSettings(activeModalOverlay);
                    if (typeof activeModalOverlay._updateAutoHide === 'function') {
                        activeModalOverlay._updateAutoHide();
                    }
                }
                for (const ov of activeDockedOverlays) {
                    if (typeof ov._updateAutoHide === 'function') {
                        ov._updateAutoHide();
                    }
                }
            }
        };
        const storageGet = api.storage.sync.get(['cinemaSettings'], (result) => {
            if (result && result.cinemaSettings) {
                updateFromSettings(result.cinemaSettings);
            }
        });
        if (storageGet && typeof storageGet.then === 'function') {
            storageGet.then((result) => {
                if (result && result.cinemaSettings) {
                    updateFromSettings(result.cinemaSettings);
                }
            }).catch(() => {});
        }
    } catch (e) {}

    try {
        api.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.cinemaSettings) {
                const newSettings = changes.cinemaSettings.newValue;
                if (newSettings) {
                    settings = { ...settings, ...newSettings };
                    if (!settings.showIndicator) {
                        hideHoverIndicator();
                    } else {
                        updateHoverIndicatorHotkey();
                    }
                    if (activeModalOverlay) {
                        applyBackdropSettings(activeModalOverlay);
                        if (typeof activeModalOverlay._updateAutoHide === 'function') {
                            activeModalOverlay._updateAutoHide();
                        }
                    }
                    for (const ov of activeDockedOverlays) {
                        if (typeof ov._updateAutoHide === 'function') {
                            ov._updateAutoHide();
                        }
                    }
                }
            }
        });
    } catch (e) {}

    function getVideoID(url) {
        if (!url) return null;
        const patterns = [
            /[?&]v=([^&]+)/,
            /\/shorts\/([^?&]+)/,
            /youtu\.be\/([^?&]+)/
        ];
        for (const pattern of patterns) {
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

    function getVideoTitle(element) {
        if (!element) return 'YouTube Video';

        // 1. Check title / aria-label on the element itself or inner anchor
        const directTitle = element.getAttribute('title') ||
            element.getAttribute('aria-label') ||
            element.querySelector('a[title]')?.getAttribute('title') ||
            element.querySelector('a[aria-label]')?.getAttribute('aria-label');
        if (directTitle && directTitle.trim()) {
            return directTitle.trim();
        }

        // 2. Check alt text on thumbnail image
        const imgAlt = element.querySelector('img[alt]')?.getAttribute('alt');
        if (imgAlt && imgAlt.trim()) {
            return imgAlt.trim();
        }

        // 3. Search closest video container (covers standard + newer YouTube web components)
        const container = element.closest(
            'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
            'ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ' +
            'yt-lockup-view-model, ytd-rich-grid-media'
        );
        if (container) {
            const titleEl = container.querySelector(
                '#video-title, #title, .yt-lockup-metadata-view-model-wiz__title, ' +
                'yt-formatted-string[title], h3 a, [id="video-title-link"]'
            );
            if (titleEl) {
                const text = titleEl.getAttribute('title') || titleEl.textContent;
                if (text && text.trim()) return text.trim();
            }
        }

        return 'YouTube Video';
    }

    let pageToastTimer = null;
    let pageToastEl = null;

    const pipIconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>';

    function showPageToast(message, iconSvg = pipIconSvg, onClick = null) {
        if (!pageToastEl) {
            pageToastEl = document.createElement('div');
            pageToastEl.className = 'yt-cinema-page-toast';
            pageToastEl.innerHTML = `<span class="yt-cinema-toast-icon"></span><span class="yt-cinema-toast-text"></span>`;
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

    function openDirectPictureInPicture(videoId, title = 'YouTube Video', timestamp = null) {
        if (!videoId) return;

        // 1. If currently on a watch page and triggering PiP for the currently active page video:
        const currentWatchId = getVideoID(window.location.href);
        const isCurrentPageVideo = (videoId === currentWatchId && window.location.pathname.startsWith('/watch'));

        if (isCurrentPageVideo) {
            const pageVideo = document.querySelector('video');
            if (pageVideo) {
                if (document.pictureInPictureEnabled || pageVideo.pictureInPictureEnabled) {
                    if (document.pictureInPictureElement) {
                        try { document.exitPictureInPicture(); } catch (_) {}
                        return;
                    }
                    if (typeof pageVideo.requestPictureInPicture === 'function') {
                        pageVideo.requestPictureInPicture().then(() => {
                            showPageToast(`Picture-in-Picture: ${title.slice(0, 45)}`, pipIconSvg);
                        }).catch(() => {
                            const aspectInfo = detectVideoAspectRatio(null);
                            createOverlay(videoId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio, true, true);
                        });
                        return;
                    }
                }

                const ytPipBtn = document.querySelector('.ytp-pip-button');
                if (ytPipBtn) {
                    ytPipBtn.click();
                    showPageToast(`Picture-in-Picture: ${title.slice(0, 45)}`, pipIconSvg);
                    return;
                }
            }
        }

        // 2. For hovered video thumbnails or general YouTube pages:
        // Open directly in floating PiP mode (startDocked = true, isDirectPiP = true).
        // This gives users the exact clean, lightweight floating player without the heavy dark overlay,
        // while guaranteeing the video is immediately visible on screen with zero invisible phantom audio!
        const aspectInfo = detectVideoAspectRatio(currentTarget);
        showPageToast(`Picture-in-Picture: ${title.slice(0, 45)}`, pipIconSvg);
        createOverlay(videoId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio, true /* startDocked */, true /* isDirectPiP */);
    }

    function createOverlay(videoId, title, initialTimestamp = null, isShort = false, initialRatio = null, startDocked = false, isDirectPiP = false) {
        if (!startDocked) {
            if (activeModalOverlay && typeof activeModalOverlay._close === 'function') {
                activeModalOverlay._close();
            }
        }
        hideHoverIndicator();

        const overlay = document.createElement('div');
        overlay.id = 'yt-cinema-overlay-' + Date.now();
        overlay.className = 'yt-cinema-overlay';
        if (!startDocked) {
            activeModalOverlay = overlay;
        } else {
            activeDockedOverlays.add(overlay);
            overlay.classList.add('yt-cinema-docked');
        }

        const container = document.createElement('div');
        container.className = 'yt-cinema-container';
        if (startDocked) {
            container.classList.add('yt-cinema-docked');
        }
        if (isDirectPiP) {
            container.classList.add('yt-cinema-pip-mode');
        }

        // Calculate exact initial dimensions INSTANTLY (0ms latency, no dummy size)
        const effectiveRatio = (initialRatio && initialRatio > 0) ? initialRatio : (isShort ? (9 / 16) : (16 / 9));
        const effectiveVertical = isShort || effectiveRatio < 0.85;
        const dims = calculateContainerDimensions(effectiveRatio, effectiveVertical);

        container.dataset.aspectRatio = dims.ratio.toString();
        container.style.width = `${dims.width}px`;
        container.style.height = `${dims.height}px`;

        if (dims.isVertical) {
            container.classList.add('yt-cinema-shorts');
            const notch = document.createElement('div');
            notch.className = 'yt-cinema-shorts-notch';
            container.appendChild(notch);
        }

        const header = document.createElement('div');
        header.className = 'yt-cinema-header';
        header.innerHTML = `
            <div class="yt-cinema-title">
                <div class="yt-cinema-drag-grip" title="Drag to reposition">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 3c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6-12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                    </svg>
                </div>
                <svg class="yt-cinema-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
                </svg>
                <span class="yt-cinema-shorts-badge" style="display: none;"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.49-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.92-2.67-2.22-3.25zM10 14.5v-5l4.5 2.5-4.5 2.5z"/></svg>Shorts</span>
                <span class="yt-cinema-title-text"></span>
            </div>
            <div class="yt-cinema-controls">
                <button class="yt-cinema-btn yt-cinema-prev-btn" title="Previous Video (P)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                <button class="yt-cinema-btn yt-cinema-next-btn" title="Next Video (N)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                </button>
                <button class="yt-cinema-btn yt-cinema-dock-btn" title="Mini-Player / Corner Dock (D)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-8v6h8v-6zm4-8H1v18h22V3zm-2 16H3V5h18v14z"/></svg>
                </button>
                <div class="yt-cinema-speed-container">
                    <button class="yt-cinema-speed-pill" title="Playback Speed ([ / ])">1x</button>
                    <div class="yt-cinema-speed-menu"></div>
                </div>
                <button class="yt-cinema-btn yt-cinema-screenshot-btn" title="Take Screenshot (S) • Shift+Click to Copy">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7-7.5h-3.17L14.41 4H9.59L8.17 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 14H5V8h3.88l1.42-2h3.4l1.42 2H19v12z"/></svg>
                </button>
                <button class="yt-cinema-btn yt-cinema-copy-btn" title="Copy Link at Current Time">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                </button>
                <button class="yt-cinema-btn yt-cinema-pip-btn" title="Picture-in-Picture">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>
                </button>
                <button class="yt-cinema-btn yt-cinema-newtab-btn" title="Open in New Tab">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                </button>
                <button class="yt-cinema-btn yt-cinema-close-btn" title="Close (ESC)">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            </div>
        `;
        const titleTextEl = header.querySelector('.yt-cinema-title-text');
        if (titleTextEl) {
            titleTextEl.textContent = title || 'YouTube Video';
            titleTextEl.setAttribute('title', title || 'YouTube Video');
        }
        if (isShort) {
            const badge = header.querySelector('.yt-cinema-shorts-badge');
            if (badge) badge.style.display = 'inline-flex';
        }

        const playerWrapper = document.createElement('div');
        playerWrapper.className = 'yt-cinema-player-wrapper';

        const iframe = document.createElement('iframe');
        iframe.className = 'yt-cinema-iframe';
        let iframeSrc = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&autoplay=1`;
        if (initialTimestamp) {
            iframeSrc += `&t=${encodeURIComponent(initialTimestamp)}`;
        }
        if (isShort) {
            iframeSrc += `&loop=1&playlist=${encodeURIComponent(videoId)}`;
        }
        iframe.src = iframeSrc;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups');

        const dragShield = document.createElement('div');
        dragShield.className = 'yt-cinema-drag-shield';

        const shutterFlash = document.createElement('div');
        shutterFlash.className = 'yt-cinema-shutter-flash';

        const toast = document.createElement('div');
        toast.className = 'yt-cinema-toast';
        toast.innerHTML = `<span class="yt-cinema-toast-icon"></span><span class="yt-cinema-toast-text"></span>`;

        const volumeHud = document.createElement('div');
        volumeHud.className = 'yt-cinema-volume-hud';
        volumeHud.innerHTML = `
            <span class="yt-cinema-volume-icon"></span>
            <div class="yt-cinema-volume-track">
                <div class="yt-cinema-volume-fill"></div>
            </div>
            <span class="yt-cinema-volume-text">100%</span>
        `;

        playerWrapper.appendChild(iframe);
        playerWrapper.appendChild(dragShield);
        playerWrapper.appendChild(shutterFlash);
        playerWrapper.appendChild(volumeHud);
        playerWrapper.appendChild(toast);

        const footer = document.createElement('div');
        footer.className = 'yt-cinema-footer';
        footer.innerHTML = `
            <div class="yt-cinema-hint">
                <span class="yt-cinema-key">ESC</span> Close
                <span class="yt-cinema-key">D</span> Dock
                <span class="yt-cinema-key">[</span><span class="yt-cinema-key">]</span> Speed
                <span class="yt-cinema-key">S</span> Screenshot
                <span class="yt-cinema-key">↑</span><span class="yt-cinema-key">↓</span> Vol
                <span class="yt-cinema-key">M</span> Mute
                <span class="yt-cinema-key">P</span> Prev
                <span class="yt-cinema-key">N</span> Next
                <span class="yt-cinema-key">F</span> Fullscreen
            </div>
            <div class="yt-cinema-branding">Cinema Mode</div>
        `;

        container.appendChild(header);
        container.appendChild(playerWrapper);
        container.appendChild(footer);

        const resizeHandles = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
        for (const dir of resizeHandles) {
            const handle = document.createElement('div');
            handle.className = `yt-cinema-resize-handle yt-cinema-resize-${dir}`;
            handle.dataset.direction = dir;
            container.appendChild(handle);
        }

        const resizeGrip = document.createElement('div');
        resizeGrip.className = 'yt-cinema-resize-grip';
        resizeGrip.dataset.direction = 'se';
        resizeGrip.setAttribute('title', 'Drag corner to resize');
        resizeGrip.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M10 2L2 10M10 6L6 10M10 10L10 10.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        `;
        container.appendChild(resizeGrip);

        const ambientLayer = document.createElement('div');
        ambientLayer.className = 'yt-cinema-ambient-layer';
        ambientLayer.style.width = `${dims.width}px`;
        ambientLayer.style.height = `${dims.height}px`;

        const ambientCanvas = document.createElement('canvas');
        ambientCanvas.className = 'yt-cinema-ambient-canvas';
        ambientCanvas.width = 32;
        ambientCanvas.height = 18;
        const ambientCtx = ambientCanvas.getContext('2d', { willReadFrequently: true });

        const ambientFallback = document.createElement('div');
        ambientFallback.className = 'yt-cinema-ambient-fallback';

        ambientLayer.appendChild(ambientFallback);
        ambientLayer.appendChild(ambientCanvas);
        overlay.appendChild(ambientLayer);

        overlay.appendChild(container);
        document.body.appendChild(overlay);

        if (!startDocked) {
            applyBackdropSettings(overlay);
            document.body.style.overflow = 'hidden';
        }
        pauseBackgroundVideo();

        requestAnimationFrame(() => {
            overlay.classList.add('yt-cinema-visible');
        });

        // Inject styles as soon as documentElement or head exists without waiting for iframe.onload
        overlay._earlyStyleInterval = setInterval(() => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (doc && (doc.head || doc.documentElement)) {
                    if (!doc.getElementById('yt-cinema-injected-styles')) {
                        injectPlayerStyles(iframe, videoId, overlay, ambientCtx, ambientCanvas);
                    }
                }
            } catch (e) {}
        }, 20);

        iframe.onload = () => {
            if (overlay._earlyStyleInterval) {
                clearInterval(overlay._earlyStyleInterval);
                overlay._earlyStyleInterval = null;
            }
            injectPlayerStyles(iframe, videoId, overlay, ambientCtx, ambientCanvas);
        };

        setupOverlayEvents(overlay, iframe, videoId, initialTimestamp, isShort, ambientCtx, ambientCanvas, ambientLayer, startDocked, isDirectPiP);
    }

    function injectPlayerStyles(iframe, videoId, overlayElement, ambientCtx, ambientCanvas) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!doc) return;

            if (overlayElement && overlayElement._earlyStyleInterval) {
                clearInterval(overlayElement._earlyStyleInterval);
                overlayElement._earlyStyleInterval = null;
            }

            let style = doc.getElementById('yt-cinema-injected-styles');
            if (!style) {
                style = doc.createElement('style');
                style.id = 'yt-cinema-injected-styles';
                style.textContent = `
                /* Hide all non-player UI elements */
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

                html, body, ytd-app, #content, #page-manager, #columns, #primary, #primary-inner, #player, ytd-watch-flexy { 
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

                ytd-watch-flexy {
                    --ytd-watch-flexy-panel-max-height: 100% !important;
                    --ytd-watch-flexy-space-below-player: 0px !important;
                    --ytd-watch-flexy-non-player-height: 0px !important;
                    display: flex !important;
                    flex-direction: column !important;
                }

                /* Make player fill the viewport without offsets */
                #player-container-outer,
                #player-container-inner,
                #player-container,
                #player-theater-container,
                #movie_player {
                    width: 100% !important;
                    height: 100% !important;
                    max-width: 100% !important;
                    max-height: 100% !important;
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

                /* Anchor video to 0,0 and eliminate YouTube inline left offset */
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

                body.yt-cinema-cursor-hidden,
                body.yt-cinema-cursor-hidden * {
                    cursor: none !important;
                }
            `;
                const target = doc.head || doc.documentElement || doc.body;
                if (target) {
                    target.appendChild(style);
                }
            }

            if (!overlayElement) return;

            // Clear any active polling timers on this overlay instance
            if (overlayElement._checkVideoInterval) {
                clearInterval(overlayElement._checkVideoInterval);
                overlayElement._checkVideoInterval = null;
            }
            if (overlayElement._playerReadyInterval) {
                clearInterval(overlayElement._playerReadyInterval);
                overlayElement._playerReadyInterval = null;
            }

            function startAmbientSampling(video) {
                if (!settings.ambientLighting || !ambientCtx || !ambientCanvas) return;
                let lastDraw = 0;

                function sampleFrame(timestamp) {
                    if (!overlayElement.isConnected || !settings.ambientLighting) {
                        overlayElement._ambientAnimFrameId = null;
                        return;
                    }

                    if (timestamp - lastDraw > 45) {
                        lastDraw = timestamp;
                        try {
                            if (video && !video.paused && !video.ended && video.readyState >= 2) {
                                ambientCtx.drawImage(video, 0, 0, ambientCanvas.width, ambientCanvas.height);
                                ambientCanvas.style.opacity = '0.85';
                            }
                        } catch (err) {
                            // Cross-origin restriction - fallback gradient provides the ambient glow
                        }
                    }

                    overlayElement._ambientAnimFrameId = requestAnimationFrame(sampleFrame);
                }

                if (overlayElement._ambientAnimFrameId) cancelAnimationFrame(overlayElement._ambientAnimFrameId);
                overlayElement._ambientAnimFrameId = requestAnimationFrame(sampleFrame);
            }

            // Poll for video element and dimensions
            overlayElement._checkVideoInterval = setInterval(() => {
                try {
                    const video = doc.querySelector('video');
                    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
                        adjustContainerSize(video.videoWidth, video.videoHeight, overlayElement);

                        video.addEventListener('resize', () => {
                            adjustContainerSize(video.videoWidth, video.videoHeight, overlayElement);
                        });

                        startAmbientSampling(video);
                        if (typeof overlayElement._applySpeed === 'function') {
                            overlayElement._applySpeed();
                        }

                        clearInterval(overlayElement._checkVideoInterval);
                        overlayElement._checkVideoInterval = null;
                    }
                } catch (e) {
                    // Cross-origin restriction
                }
            }, 300);

            // Timeout dimension check after 15 seconds
            setTimeout(() => {
                if (overlayElement && overlayElement._checkVideoInterval) {
                    clearInterval(overlayElement._checkVideoInterval);
                    overlayElement._checkVideoInterval = null;
                }
            }, 15000);

            // Observe / poll for player readiness to auto-theater and trigger playback
            let playerAttempts = 0;
            overlayElement._playerReadyInterval = setInterval(() => {
                playerAttempts++;
                try {
                    let theaterDone = !settings.autoTheater;
                    if (settings.autoTheater) {
                        const theaterBtn = doc.querySelector('.ytp-size-button');
                        if (theaterBtn) {
                            theaterBtn.click();
                            theaterDone = true;
                        }
                    }

                    const video = doc.querySelector('video');
                    const playBtn = doc.querySelector('.ytp-play-button');
                    if (video && video.paused && playBtn) {
                        playBtn.click();
                    }

                    if (video && typeof overlayElement._applySpeed === 'function') {
                        overlayElement._applySpeed();
                    }

                    if (video && !overlayElement._ambientAnimFrameId) {
                        startAmbientSampling(video);
                    }

                    if (theaterDone && video && !video.paused) {
                        clearInterval(overlayElement._playerReadyInterval);
                        overlayElement._playerReadyInterval = null;
                    }
                } catch (e) {}

                if (playerAttempts >= 20) {
                    if (overlayElement && overlayElement._playerReadyInterval) {
                        clearInterval(overlayElement._playerReadyInterval);
                        overlayElement._playerReadyInterval = null;
                    }
                }
            }, 500);

            // Watch for in-iframe video changes (autoplay / playlist navigation)
            try {
                const onNav = () => {
                    const newId = getVideoID(doc.location?.href);
                    if (newId) {
                        const titleEl = doc.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, yt-formatted-string.ytd-watch-metadata');
                        const newTitle = titleEl?.textContent?.trim() || doc.title?.replace(/ - YouTube$/, '').trim();
                        const isShort = isShortVideo(doc.location?.href);
                        if (overlayElement.isConnected) {
                            if (typeof overlayElement._recordNavigation === 'function') {
                                overlayElement._recordNavigation(newId, newTitle, isShort);
                            }
                            if (newTitle) {
                                const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
                                if (titleSpan) titleSpan.textContent = newTitle;
                                const existingBadge = overlayElement.querySelector('.yt-cinema-shorts-badge');
                                if (isShort && !existingBadge) {
                                    const titleContainer = overlayElement.querySelector('.yt-cinema-title');
                                    const badge = document.createElement('span');
                                    badge.className = 'yt-cinema-shorts-badge';
                                    badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.49-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.92-2.67-2.22-3.25zM10 14.5v-5l4.5 2.5-4.5 2.5z"/></svg>Shorts`;
                                    if (titleSpan && titleContainer) titleContainer.insertBefore(badge, titleSpan);
                                } else if (!isShort && existingBadge) {
                                    existingBadge.remove();
                                }
                            }
                        }
                    }
                };
                doc.addEventListener('yt-navigate-finish', onNav);
            } catch (e) {}

        } catch (err) {
            console.log('[Cinema Mode] Could not inject styles:', err.message);
        }
    }

    function getCurrentPlaybackSeconds(iframe, fallbackTimestamp) {
        try {
            const video = iframe.contentDocument?.querySelector('video');
            if (video && typeof video.currentTime === 'number' && video.currentTime > 0) {
                return Math.floor(video.currentTime);
            }
        } catch (e) {}

        if (fallbackTimestamp) {
            if (typeof fallbackTimestamp === 'number') return Math.floor(fallbackTimestamp);
            const str = String(fallbackTimestamp).trim();
            if (/^\d+s?$/i.test(str)) {
                return parseInt(str, 10);
            }
            let total = 0;
            const hMatch = str.match(/(\d+)h/i);
            const mMatch = str.match(/(\d+)m/i);
            const sMatch = str.match(/(\d+)s/i);
            if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
            if (mMatch) total += parseInt(mMatch[1], 10) * 60;
            if (sMatch) total += parseInt(sMatch[1], 10);
            if (total > 0) return total;
        }
        return 0;
    }

    function findNextRecommendation(currentId) {
        const candidates = document.querySelectorAll(
            'ytd-watch-next-secondary-results-renderer a#thumbnail[href*="watch?v="], ' +
            '#related a#thumbnail[href*="watch?v="], ' +
            'ytd-rich-item-renderer a#thumbnail[href*="watch?v="], ' +
            'ytd-compact-video-renderer a#thumbnail[href*="watch?v="], ' +
            'a[href*="/watch?v="], a[href*="/shorts/"]'
        );
        for (const link of candidates) {
            const vId = getVideoID(link.href);
            if (vId && vId !== currentId) {
                const title = getVideoTitle(link);
                const isShort = isShortVideo(link.href);
                return { videoId: vId, title, isShort };
            }
        }
        return null;
    }

    function setupOverlayEvents(overlayElement, iframe, videoId, initialTimestamp, isShort = false, ambientCtx = null, ambientCanvas = null, ambientLayer = null, startDocked = false, isDirectPiP = false) {
        let currentPlayingVideoId = videoId;
        let isDocked = Boolean(startDocked);
        const videoHistory = [];

        const container = overlayElement.querySelector('.yt-cinema-container');
        const header = overlayElement.querySelector('.yt-cinema-header');
        const footer = overlayElement.querySelector('.yt-cinema-footer');
        const closeBtn = overlayElement.querySelector('.yt-cinema-close-btn');
        const pipBtn = overlayElement.querySelector('.yt-cinema-pip-btn');
        const newTabBtn = overlayElement.querySelector('.yt-cinema-newtab-btn');
        const copyBtn = overlayElement.querySelector('.yt-cinema-copy-btn');
        const screenshotBtn = overlayElement.querySelector('.yt-cinema-screenshot-btn');
        const dockBtn = overlayElement.querySelector('.yt-cinema-dock-btn');
        const prevBtn = overlayElement.querySelector('.yt-cinema-prev-btn');
        const nextBtn = overlayElement.querySelector('.yt-cinema-next-btn');
        const speedContainer = overlayElement.querySelector('.yt-cinema-speed-container');
        const speedPill = overlayElement.querySelector('.yt-cinema-speed-pill');
        const speedMenu = overlayElement.querySelector('.yt-cinema-speed-menu');
        const shutterFlash = overlayElement.querySelector('.yt-cinema-shutter-flash');
        const volumeHud = overlayElement.querySelector('.yt-cinema-volume-hud');
        const toast = overlayElement.querySelector('.yt-cinema-toast');

        overlayElement._recordNavigation = (newId, newTitle, isShortVid) => {
            if (newId && newId !== currentPlayingVideoId) {
                const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
                const curTitle = titleSpan?.textContent?.trim() || 'YouTube Video';
                const curIsShort = container ? container.classList.contains('yt-cinema-shorts') : false;
                videoHistory.push({
                    videoId: currentPlayingVideoId,
                    title: curTitle,
                    isShort: curIsShort
                });
                currentPlayingVideoId = newId;
            }
        };

        // Draggable & Positioning State
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragInitialX = 0;
        let dragInitialY = 0;
        let currentDockX = 0;
        let currentDockY = 0;
        let isSnappedEdge = false;
        let dragRafId = null;

        const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
        let currentSpeed = (settings.rememberSpeed && typeof settings.savedSpeed === 'number' && settings.savedSpeed > 0)
            ? settings.savedSpeed
            : 1;
        let isSpeedMenuOpen = false;
        let isSettingSpeedInternally = false;
        const speedIconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.28-10.43zM10.59 15.41a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z"/></svg>';

        const formatSpeedText = (spd) => (spd === 1 ? '1x Normal' : `${spd}x`);
        const formatPillText = (spd) => `${spd}x`;

        const renderSpeedMenu = () => {
            if (!speedMenu) return;
            speedMenu.innerHTML = SPEED_PRESETS.map(spd => `
                <div class="yt-cinema-speed-item${spd === currentSpeed ? ' active' : ''}" data-speed="${spd}">
                    <span>${formatSpeedText(spd)}</span>
                    <svg class="yt-cinema-speed-check" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                </div>
            `).join('');
        };

        const updateSpeedUI = (speed) => {
            if (speedPill) {
                speedPill.textContent = formatPillText(speed);
                speedPill.setAttribute('title', `Playback Speed: ${formatPillText(speed)} ([ / ])`);
            }
            if (speedMenu) {
                const items = speedMenu.querySelectorAll('.yt-cinema-speed-item');
                items.forEach(item => {
                    const itemSpeed = parseFloat(item.dataset.speed);
                    if (Math.abs(itemSpeed - speed) < 0.01) {
                        item.classList.add('active');
                    } else {
                        item.classList.remove('active');
                    }
                });
            }
        };

        const applySpeedToPlayer = (speed) => {
            isSettingSpeedInternally = true;
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const video = doc?.querySelector('video');
                if (video) {
                    video.playbackRate = speed;
                    video.defaultPlaybackRate = speed;
                }
                const moviePlayer = doc?.getElementById('movie_player');
                const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                if (playerObj && typeof playerObj.setPlaybackRate === 'function') {
                    playerObj.setPlaybackRate(speed);
                }
            } catch (e) {}
            setTimeout(() => {
                isSettingSpeedInternally = false;
            }, 120);
        };

        const setPlaybackSpeed = (speed, showNotification = true) => {
            currentSpeed = speed;
            applySpeedToPlayer(speed);
            updateSpeedUI(speed);

            if (settings.rememberSpeed) {
                settings.savedSpeed = speed;
                try {
                    api.storage.sync.set({
                        cinemaSettings: {
                            ...settings,
                            savedSpeed: speed
                        }
                    });
                } catch (e) {}
            }

            if (showNotification) {
                showToast(`Speed: ${formatPillText(speed)}`, speedIconSvg);
            }
        };

        const changeSpeedByStep = (direction) => {
            let closestIdx = 0;
            let minDiff = Infinity;
            for (let i = 0; i < SPEED_PRESETS.length; i++) {
                const diff = Math.abs(SPEED_PRESETS[i] - currentSpeed);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = i;
                }
            }
            const nextIdx = Math.max(0, Math.min(SPEED_PRESETS.length - 1, closestIdx + direction));
            setPlaybackSpeed(SPEED_PRESETS[nextIdx], true);
        };

        const toggleSpeedMenu = (open) => {
            isSpeedMenuOpen = typeof open === 'boolean' ? open : !isSpeedMenuOpen;
            if (isSpeedMenuOpen) {
                speedMenu?.classList.add('yt-cinema-speed-menu-open');
                speedPill?.classList.add('active');
                resetAutoHideTimer();
            } else {
                speedMenu?.classList.remove('yt-cinema-speed-menu-open');
                speedPill?.classList.remove('active');
            }
        };

        renderSpeedMenu();
        updateSpeedUI(currentSpeed);

        const updateHeaderTitle = (newTitle, isShortVid) => {
            const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
            if (titleSpan) {
                titleSpan.textContent = newTitle;
                titleSpan.setAttribute('title', newTitle);
            }
            const existingBadge = overlayElement.querySelector('.yt-cinema-shorts-badge');
            if (isShortVid && !existingBadge) {
                const titleContainer = overlayElement.querySelector('.yt-cinema-title');
                const badge = document.createElement('span');
                badge.className = 'yt-cinema-shorts-badge';
                badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.49-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.92-2.67-2.22-3.25zM10 14.5v-5l4.5 2.5-4.5 2.5z"/></svg>Shorts`;
                if (titleSpan && titleContainer) titleContainer.insertBefore(badge, titleSpan);
            } else if (!isShortVid && existingBadge) {
                existingBadge.remove();
            }
        };

        const loadVideoInOverlay = (newId, newTitle, isShortVid, addToHistory = true) => {
            if (addToHistory && currentPlayingVideoId && currentPlayingVideoId !== newId) {
                const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
                const curTitle = titleSpan?.textContent?.trim() || 'YouTube Video';
                const curIsShort = container ? container.classList.contains('yt-cinema-shorts') : false;
                videoHistory.push({
                    videoId: currentPlayingVideoId,
                    title: curTitle,
                    isShort: curIsShort
                });
            }
            currentPlayingVideoId = newId;
            updateHeaderTitle(newTitle, isShortVid);

            const initialRatio = isShortVid ? (9 / 16) : (16 / 9);
            const dims = calculateContainerDimensions(initialRatio, isShortVid);
            container.dataset.aspectRatio = dims.ratio.toString();

            if (isShortVid) {
                container.classList.add('yt-cinema-shorts');
                if (!container.querySelector('.yt-cinema-shorts-notch')) {
                    const notch = document.createElement('div');
                    notch.className = 'yt-cinema-shorts-notch';
                    container.appendChild(notch);
                }
            } else {
                container.classList.remove('yt-cinema-shorts');
                const notch = container.querySelector('.yt-cinema-shorts-notch');
                if (notch) notch.remove();
            }

            if (!isDocked) {
                container.style.width = `${dims.width}px`;
                container.style.height = `${dims.height}px`;
                if (ambientLayer && settings.ambientFullScreen === false) {
                    ambientLayer.style.width = `${dims.width}px`;
                    ambientLayer.style.height = `${dims.height}px`;
                }
            }

            if (isShortVid) {
                iframe.src = `https://www.youtube.com/watch?v=${encodeURIComponent(newId)}&autoplay=1&loop=1&playlist=${encodeURIComponent(newId)}`;
            } else {
                iframe.src = `https://www.youtube.com/watch?v=${encodeURIComponent(newId)}&autoplay=1`;
            }

            applySpeedToPlayer(currentSpeed);

            if (overlayElement._earlyStyleInterval) clearInterval(overlayElement._earlyStyleInterval);
            overlayElement._earlyStyleInterval = setInterval(() => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (doc && (doc.head || doc.documentElement)) {
                        if (!doc.getElementById('yt-cinema-injected-styles')) {
                            injectPlayerStyles(iframe, newId, overlayElement, ambientCtx, ambientCanvas);
                        }
                    }
                } catch (e) {}
            }, 20);
        };

        let autoHideTimer = null;
        let isHoveringControls = false;
        const AUTOHIDE_DELAY = 2500; // 2.5 seconds

        const isVideoPlaying = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const video = doc?.querySelector('video');
                return video && !video.paused && !video.ended && video.readyState >= 2;
            } catch (e) {
                return false;
            }
        };

        const showControls = () => {
            if (container) {
                container.classList.remove('yt-cinema-controls-hidden');
            }
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                doc?.body?.classList.remove('yt-cinema-cursor-hidden');
            } catch (e) {}
        };

        const hideControls = () => {
            if (!settings.autoHideControls) return;
            if (isDocked) return;
            if (isHoveringControls) return;
            if (isSpeedMenuOpen) return;
            if (!isVideoPlaying()) return;

            if (container) {
                container.classList.add('yt-cinema-controls-hidden');
            }
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                doc?.body?.classList.add('yt-cinema-cursor-hidden');
            } catch (e) {}
        };

        const resetAutoHideTimer = () => {
            showControls();

            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }

            if (!settings.autoHideControls || isDocked) {
                return;
            }

            autoHideTimer = setTimeout(() => {
                hideControls();
            }, AUTOHIDE_DELAY);
        };

        const updateAutoHideState = () => {
            if (!settings.autoHideControls || isDocked) {
                if (autoHideTimer) {
                    clearTimeout(autoHideTimer);
                    autoHideTimer = null;
                }
                showControls();
            } else {
                resetAutoHideTimer();
            }
        };

        function positionDockedContainer(cont, ov) {
            const MARGIN = 16;
            const isVertical = cont.classList.contains('yt-cinema-shorts') || parseFloat(cont.dataset.aspectRatio) < 0.85;

            // Determine dimensions: restore saved size if available, otherwise default
            let targetW = isVertical ? 300 : 540;
            let targetH = isVertical ? 500 : 340;

            if (isVertical && savedDockedShortsSize && savedDockedShortsSize.width && savedDockedShortsSize.height) {
                targetW = savedDockedShortsSize.width;
                targetH = savedDockedShortsSize.height;
            } else if (!isVertical && savedDockedSize && savedDockedSize.width && savedDockedSize.height) {
                targetW = savedDockedSize.width;
                targetH = savedDockedSize.height;
            }

            targetW = Math.max(isVertical ? 240 : 360, Math.min(targetW, window.innerWidth - MARGIN * 2));
            targetH = Math.max(isVertical ? 380 : 220, Math.min(targetH, window.innerHeight - MARGIN * 2));

            cont.style.setProperty('--yt-dock-w', `${targetW}px`);
            cont.style.setProperty('--yt-dock-h', `${targetH}px`);

            const contW = targetW;
            const contH = targetH;
            const minX = MARGIN;
            const maxX = Math.max(MARGIN, window.innerWidth - contW - MARGIN);
            const minY = MARGIN;
            const maxY = Math.max(MARGIN, window.innerHeight - contH - MARGIN);

            let targetX = maxX;
            let targetY = maxY;

            if (savedDockedPos) {
                if (typeof savedDockedPos.xRatio === 'number' && typeof savedDockedPos.yRatio === 'number') {
                    const availW = Math.max(1, window.innerWidth - contW - MARGIN * 2);
                    const availH = Math.max(1, window.innerHeight - contH - MARGIN * 2);
                    targetX = Math.round(MARGIN + savedDockedPos.xRatio * availW);
                    targetY = Math.round(MARGIN + savedDockedPos.yRatio * availH);
                } else if (typeof savedDockedPos.x === 'number' && typeof savedDockedPos.y === 'number') {
                    targetX = savedDockedPos.x;
                    targetY = savedDockedPos.y;
                }
            }

            targetX = Math.max(minX, Math.min(maxX, targetX));
            targetY = Math.max(minY, Math.min(maxY, targetY));

            // Collision stagger: if another docked window occupies roughly this spot, shift it
            for (const other of activeDockedOverlays) {
                if (other === ov) continue;
                const otherCont = other.querySelector('.yt-cinema-container');
                if (!otherCont) continue;
                const ox = parseFloat(otherCont.dataset.dockX);
                const oy = parseFloat(otherCont.dataset.dockY);
                if (!isNaN(ox) && !isNaN(oy)) {
                    if (Math.abs(ox - targetX) < 45 && Math.abs(oy - targetY) < 45) {
                        targetX = Math.max(minX, targetX - 35);
                        targetY = Math.max(minY, targetY - 35);
                    }
                }
            }

            currentDockX = targetX;
            currentDockY = targetY;
            cont.style.setProperty('--yt-dock-x', `${targetX}px`);
            cont.style.setProperty('--yt-dock-y', `${targetY}px`);
            cont.dataset.dockX = targetX.toString();
            cont.dataset.dockY = targetY.toString();

            topZIndex++;
            ov.style.zIndex = topZIndex;
            cont.style.zIndex = topZIndex;
        }

        if (isDocked) {
            activeDockedOverlays.add(overlayElement);
            overlayElement.classList.add('yt-cinema-docked');
            container.classList.add('yt-cinema-docked');
            if (dockBtn) {
                dockBtn.setAttribute('title', 'Expand Cinema Mode (D)');
                dockBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
            }
            positionDockedContainer(container, overlayElement);
        }

        const onPointerDown = (e) => {
            if (!isDocked || isResizing) return;
            if (e.target.closest('button, .yt-cinema-speed-container, .yt-cinema-speed-pill, .yt-cinema-speed-menu, .yt-cinema-resize-handle, .yt-cinema-resize-grip')) {
                return;
            }
            if (e.button !== 0) return;

            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragInitialX = currentDockX;
            dragInitialY = currentDockY;

            topZIndex++;
            overlayElement.style.zIndex = topZIndex;
            container.style.zIndex = topZIndex;

            try {
                header.setPointerCapture(e.pointerId);
            } catch (_) {}

            container.classList.add('yt-cinema-dragging');
        };

        const onPointerMove = (e) => {
            if (!isDragging || !isDocked) return;

            const deltaX = e.clientX - dragStartX;
            const deltaY = e.clientY - dragStartY;

            let newX = dragInitialX + deltaX;
            let newY = dragInitialY + deltaY;

            const MARGIN = 16;
            const SNAP_THRESHOLD = 32;
            const contW = container.offsetWidth || 540;
            const contH = container.offsetHeight || 340;
            const minX = MARGIN;
            const maxX = Math.max(MARGIN, window.innerWidth - contW - MARGIN);
            const minY = MARGIN;
            const maxY = Math.max(MARGIN, window.innerHeight - contH - MARGIN);

            let snapped = false;

            // Horizontal magnetic edge snap
            if (newX <= minX + SNAP_THRESHOLD) {
                newX = minX;
                snapped = true;
            } else if (newX >= maxX - SNAP_THRESHOLD) {
                newX = maxX;
                snapped = true;
            } else {
                newX = Math.max(minX, Math.min(maxX, newX));
            }

            // Vertical magnetic edge snap
            if (newY <= minY + SNAP_THRESHOLD) {
                newY = minY;
                snapped = true;
            } else if (newY >= maxY - SNAP_THRESHOLD) {
                newY = maxY;
                snapped = true;
            } else {
                newY = Math.max(minY, Math.min(maxY, newY));
            }

            if (snapped !== isSnappedEdge) {
                isSnappedEdge = snapped;
                if (snapped) {
                    container.classList.add('yt-cinema-snap-edge');
                } else {
                    container.classList.remove('yt-cinema-snap-edge');
                }
            }

            currentDockX = newX;
            currentDockY = newY;

            if (!dragRafId) {
                dragRafId = requestAnimationFrame(() => {
                    container.style.setProperty('--yt-dock-x', `${currentDockX}px`);
                    container.style.setProperty('--yt-dock-y', `${currentDockY}px`);
                    container.dataset.dockX = currentDockX.toString();
                    container.dataset.dockY = currentDockY.toString();
                    dragRafId = null;
                });
            }
        };

        const onPointerUp = (e) => {
            if (!isDragging) return;
            isDragging = false;

            try {
                header.releasePointerCapture(e.pointerId);
            } catch (_) {}

            container.classList.remove('yt-cinema-dragging');
            container.classList.remove('yt-cinema-snap-edge');
            isSnappedEdge = false;

            if (dragRafId) {
                cancelAnimationFrame(dragRafId);
                dragRafId = null;
            }

            container.style.setProperty('--yt-dock-x', `${currentDockX}px`);
            container.style.setProperty('--yt-dock-y', `${currentDockY}px`);
            container.dataset.dockX = currentDockX.toString();
            container.dataset.dockY = currentDockY.toString();

            // Save persistent position with responsive ratio coordinates
            const MARGIN = 16;
            const contW = container.offsetWidth || 540;
            const contH = container.offsetHeight || 340;
            const availW = Math.max(1, window.innerWidth - contW - MARGIN * 2);
            const availH = Math.max(1, window.innerHeight - contH - MARGIN * 2);
            const xRatio = Math.max(0, Math.min(1, (currentDockX - MARGIN) / availW));
            const yRatio = Math.max(0, Math.min(1, (currentDockY - MARGIN) / availH));

            savedDockedPos = {
                x: currentDockX,
                y: currentDockY,
                xRatio,
                yRatio
            };

            try {
                api.storage.local.set({ ytCinemaDockedPos: savedDockedPos });
            } catch (_) {}
        };

        // Window Resizing Handlers (8 directions + corner grip)
        let isResizing = false;
        let resizeDirection = '';
        let resizeStartX = 0;
        let resizeStartY = 0;
        let resizeStartW = 0;
        let resizeStartH = 0;
        let resizeStartDockX = 0;
        let resizeStartDockY = 0;
        let resizeRafId = null;
        let currentResizeW = 0;
        let currentResizeH = 0;

        const onResizePointerMove = (e) => {
            if (!isResizing || !isDocked) return;
            e.preventDefault();

            const deltaX = e.clientX - resizeStartX;
            const deltaY = e.clientY - resizeStartY;

            const MARGIN = 16;
            const isVertical = container.classList.contains('yt-cinema-shorts') || parseFloat(container.dataset.aspectRatio) < 0.85;
            const minW = isVertical ? 240 : 360;
            const minH = isVertical ? 380 : 220;
            const maxW = Math.max(minW, window.innerWidth - MARGIN * 2);
            const maxH = Math.max(minH, window.innerHeight - MARGIN * 2);

            let newW = resizeStartW;
            let newH = resizeStartH;
            let newDockX = resizeStartDockX;
            let newDockY = resizeStartDockY;

            // Horizontal resizing
            if (resizeDirection.includes('e')) {
                newW = resizeStartW + deltaX;
                const maxAllowedRightW = window.innerWidth - MARGIN - resizeStartDockX;
                newW = Math.max(minW, Math.min(newW, Math.min(maxW, maxAllowedRightW)));
            } else if (resizeDirection.includes('w')) {
                newW = resizeStartW - deltaX;
                if (newW < minW) {
                    newW = minW;
                    newDockX = resizeStartDockX + (resizeStartW - minW);
                } else if (newW > maxW) {
                    newW = maxW;
                    newDockX = resizeStartDockX + (resizeStartW - maxW);
                } else {
                    newDockX = resizeStartDockX + deltaX;
                }
                if (newDockX < MARGIN) {
                    newW = Math.max(minW, (resizeStartDockX + resizeStartW) - MARGIN);
                    newDockX = MARGIN;
                }
            }

            // Vertical resizing
            if (resizeDirection.includes('s')) {
                newH = resizeStartH + deltaY;
                const maxAllowedBottomH = window.innerHeight - MARGIN - resizeStartDockY;
                newH = Math.max(minH, Math.min(newH, Math.min(maxH, maxAllowedBottomH)));
            } else if (resizeDirection.includes('n')) {
                newH = resizeStartH - deltaY;
                if (newH < minH) {
                    newH = minH;
                    newDockY = resizeStartDockY + (resizeStartH - minH);
                } else if (newH > maxH) {
                    newH = maxH;
                    newDockY = resizeStartDockY + (resizeStartH - maxH);
                } else {
                    newDockY = resizeStartDockY + deltaY;
                }
                if (newDockY < MARGIN) {
                    newH = Math.max(minH, (resizeStartDockY + resizeStartH) - MARGIN);
                    newDockY = MARGIN;
                }
            }

            currentResizeW = Math.round(newW);
            currentResizeH = Math.round(newH);
            currentDockX = Math.round(newDockX);
            currentDockY = Math.round(newDockY);

            if (!resizeRafId) {
                resizeRafId = requestAnimationFrame(() => {
                    container.style.setProperty('--yt-dock-w', `${currentResizeW}px`);
                    container.style.setProperty('--yt-dock-h', `${currentResizeH}px`);
                    container.style.setProperty('--yt-dock-x', `${currentDockX}px`);
                    container.style.setProperty('--yt-dock-y', `${currentDockY}px`);
                    container.dataset.dockX = currentDockX.toString();
                    container.dataset.dockY = currentDockY.toString();
                    resizeRafId = null;
                });
            }
        };

        const onResizePointerUp = (e) => {
            if (!isResizing) return;
            isResizing = false;

            try {
                if (e && e.target && typeof e.target.releasePointerCapture === 'function') {
                    e.target.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}

            window.removeEventListener('pointermove', onResizePointerMove);
            window.removeEventListener('pointerup', onResizePointerUp);
            window.removeEventListener('pointercancel', onResizePointerUp);

            container.classList.remove('yt-cinema-resizing');
            if (dragShield) {
                dragShield.style.removeProperty('cursor');
            }

            if (resizeRafId) {
                cancelAnimationFrame(resizeRafId);
                resizeRafId = null;
            }

            container.style.setProperty('--yt-dock-w', `${currentResizeW}px`);
            container.style.setProperty('--yt-dock-h', `${currentResizeH}px`);
            container.style.setProperty('--yt-dock-x', `${currentDockX}px`);
            container.style.setProperty('--yt-dock-y', `${currentDockY}px`);
            container.dataset.dockX = currentDockX.toString();
            container.dataset.dockY = currentDockY.toString();

            // Persist window size
            const isVertical = container.classList.contains('yt-cinema-shorts') || parseFloat(container.dataset.aspectRatio) < 0.85;
            if (isVertical) {
                savedDockedShortsSize = { width: currentResizeW, height: currentResizeH };
                try {
                    api.storage.local.set({ ytCinemaDockedShortsSize: savedDockedShortsSize });
                } catch (_) {}
            } else {
                savedDockedSize = { width: currentResizeW, height: currentResizeH };
                try {
                    api.storage.local.set({ ytCinemaDockedSize: savedDockedSize });
                } catch (_) {}
            }

            // Persist position with responsive ratio coordinates
            const MARGIN = 16;
            const availW = Math.max(1, window.innerWidth - currentResizeW - MARGIN * 2);
            const availH = Math.max(1, window.innerHeight - currentResizeH - MARGIN * 2);
            const xRatio = Math.max(0, Math.min(1, (currentDockX - MARGIN) / availW));
            const yRatio = Math.max(0, Math.min(1, (currentDockY - MARGIN) / availH));

            savedDockedPos = {
                x: currentDockX,
                y: currentDockY,
                xRatio,
                yRatio
            };

            try {
                api.storage.local.set({ ytCinemaDockedPos: savedDockedPos });
            } catch (_) {}
        };

        const onResizePointerDown = (e, dir) => {
            if (!isDocked) return;
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            resizeDirection = dir;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = container.offsetWidth;
            resizeStartH = container.offsetHeight;
            currentResizeW = resizeStartW;
            currentResizeH = resizeStartH;
            resizeStartDockX = currentDockX;
            resizeStartDockY = currentDockY;

            topZIndex++;
            overlayElement.style.zIndex = topZIndex;
            container.style.zIndex = topZIndex;

            try {
                e.target.setPointerCapture(e.pointerId);
            } catch (_) {}

            container.classList.add('yt-cinema-resizing');

            const cursorMap = {
                n: 'ns-resize',
                s: 'ns-resize',
                e: 'ew-resize',
                w: 'ew-resize',
                nw: 'nwse-resize',
                se: 'nwse-resize',
                ne: 'nesw-resize',
                sw: 'nesw-resize'
            };
            if (dragShield) {
                dragShield.style.cursor = cursorMap[dir] || 'nwse-resize';
            }

            window.addEventListener('pointermove', onResizePointerMove, { passive: false });
            window.addEventListener('pointerup', onResizePointerUp);
            window.addEventListener('pointercancel', onResizePointerUp);
        };

        const resizeElements = container.querySelectorAll('.yt-cinema-resize-handle, .yt-cinema-resize-grip');
        for (const el of resizeElements) {
            const dir = el.dataset.direction;
            if (dir) {
                el.addEventListener('pointerdown', (e) => onResizePointerDown(e, dir));
            }
        }

        if (header) {
            header.addEventListener('pointerdown', onPointerDown);
            header.addEventListener('pointermove', onPointerMove);
            header.addEventListener('pointerup', onPointerUp);
            header.addEventListener('pointercancel', onPointerUp);
            header.addEventListener('dblclick', (e) => {
                if (isDocked && !e.target.closest('button, .yt-cinema-speed-container, .yt-cinema-speed-pill, .yt-cinema-speed-menu')) {
                    toggleDockMode(false);
                }
            });
        }

        container.addEventListener('pointerdown', () => {
            if (isDocked) {
                topZIndex++;
                overlayElement.style.zIndex = topZIndex;
                container.style.zIndex = topZIndex;
            }
        });

        const toggleDockMode = (forceDock = null) => {
            const nextDocked = (typeof forceDock === 'boolean') ? forceDock : !isDocked;
            if (nextDocked === isDocked) return;
            isDocked = nextDocked;

            if (isDocked) {
                if (activeModalOverlay === overlayElement) {
                    activeModalOverlay = null;
                }
                activeDockedOverlays.add(overlayElement);

                overlayElement.classList.add('yt-cinema-docked');
                container.classList.add('yt-cinema-docked');
                showControls();
                if (autoHideTimer) {
                    clearTimeout(autoHideTimer);
                    autoHideTimer = null;
                }
                if (!activeModalOverlay) {
                    document.body.style.overflow = '';
                }
                if (dockBtn) {
                    dockBtn.setAttribute('title', 'Expand Cinema Mode (D)');
                    dockBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
                }

                positionDockedContainer(container, overlayElement);
            } else {
                if (activeModalOverlay && activeModalOverlay !== overlayElement) {
                    if (typeof activeModalOverlay._toggleDock === 'function') {
                        activeModalOverlay._toggleDock(true);
                    }
                }
                activeDockedOverlays.delete(overlayElement);
                activeModalOverlay = overlayElement;

                overlayElement.classList.remove('yt-cinema-docked');
                container.classList.remove('yt-cinema-docked');
                container.classList.remove('yt-cinema-dragging');
                container.classList.remove('yt-cinema-resizing');
                container.classList.remove('yt-cinema-snap-edge');
                container.style.removeProperty('--yt-dock-x');
                container.style.removeProperty('--yt-dock-y');
                container.style.removeProperty('--yt-dock-w');
                container.style.removeProperty('--yt-dock-h');
                document.body.style.overflow = 'hidden';

                if (dockBtn) {
                    dockBtn.setAttribute('title', 'Mini-Player / Corner Dock (D)');
                    dockBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 11h-8v6h8v-6zm4-8H1v18h22V3zm-2 16H3V5h18v14z"/></svg>`;
                }
                applyBackdropSettings(overlayElement);
                resetAutoHideTimer();
            }
        };

        const playPreviousVideo = () => {
            const prevIconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>';
            const infoIconSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

            if (videoHistory.length > 0) {
                const prevVideo = videoHistory.pop();
                loadVideoInOverlay(prevVideo.videoId, prevVideo.title, prevVideo.isShort, false);
                showToast(`Previous: ${prevVideo.title || 'Video'}`, prevIconSvg);
                return;
            }

            let triggered = false;
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const moviePlayer = doc?.getElementById('movie_player');
                const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                if (playerObj && typeof playerObj.previousVideo === 'function') {
                    playerObj.previousVideo();
                    triggered = true;
                } else {
                    const prevYtBtn = doc?.querySelector('.ytp-prev-button');
                    if (prevYtBtn && !prevYtBtn.disabled && prevYtBtn.getAttribute('aria-disabled') !== 'true') {
                        prevYtBtn.click();
                        triggered = true;
                    }
                }
            } catch (e) {}

            if (triggered) {
                showToast('Previous playlist video', prevIconSvg);
            } else {
                showToast('No previous video in session', infoIconSvg);
            }
        };

        let volumeHudTimer = null;

        const getPlayerVolumeState = () => {
            let vol = 100;
            let muted = false;
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const moviePlayer = doc?.getElementById('movie_player');
                const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                const video = doc?.querySelector('video');

                if (playerObj && typeof playerObj.getVolume === 'function') {
                    vol = Math.round(playerObj.getVolume());
                } else if (video && typeof video.volume === 'number') {
                    vol = Math.round(video.volume * 100);
                }

                if (playerObj && typeof playerObj.isMuted === 'function') {
                    muted = playerObj.isMuted();
                } else if (video && typeof video.muted === 'boolean') {
                    muted = video.muted;
                }
            } catch (e) {}

            if (isNaN(vol)) vol = 100;
            vol = Math.max(0, Math.min(100, vol));
            return { volume: vol, isMuted: muted };
        };

        const showVolumeHud = (volume, isMuted) => {
            if (!volumeHud) return;
            const volIcon = volumeHud.querySelector('.yt-cinema-volume-icon');
            const volFill = volumeHud.querySelector('.yt-cinema-volume-fill');
            const volText = volumeHud.querySelector('.yt-cinema-volume-text');

            const mutedSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.73 4.73H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
            const lowSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>';
            const highSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L9 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

            if (isMuted || volume === 0) {
                volumeHud.classList.add('is-muted');
                if (volIcon) volIcon.innerHTML = mutedSvg;
                if (volFill) volFill.style.width = '0%';
                if (volText) volText.textContent = 'Muted';
            } else {
                volumeHud.classList.remove('is-muted');
                if (volIcon) volIcon.innerHTML = volume > 50 ? highSvg : lowSvg;
                if (volFill) volFill.style.width = `${volume}%`;
                if (volText) volText.textContent = `${volume}%`;
            }

            volumeHud.classList.add('yt-cinema-volume-hud-visible');
            resetAutoHideTimer();

            if (volumeHudTimer) clearTimeout(volumeHudTimer);
            volumeHudTimer = setTimeout(() => {
                volumeHud.classList.remove('yt-cinema-volume-hud-visible');
            }, 1300);
        };

        const setPlayerVolume = (newVol) => {
            newVol = Math.max(0, Math.min(100, Math.round(newVol)));
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const moviePlayer = doc?.getElementById('movie_player');
                const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                const video = doc?.querySelector('video');

                if (playerObj && typeof playerObj.setVolume === 'function') {
                    playerObj.setVolume(newVol);
                }
                if (video) {
                    video.volume = newVol / 100;
                }

                if (newVol > 0) {
                    const isMuted = playerObj?.isMuted ? playerObj.isMuted() : (video?.muted ?? false);
                    if (isMuted) {
                        if (playerObj && typeof playerObj.unMute === 'function') playerObj.unMute();
                        if (video) video.muted = false;
                    }
                }
            } catch (e) {}
            return newVol;
        };

        const changeVolume = (delta) => {
            const state = getPlayerVolumeState();
            let targetVol;
            if (delta > 0) {
                targetVol = Math.ceil((state.volume + 0.1) / 5) * 5;
            } else {
                targetVol = Math.floor((state.volume - 0.1) / 5) * 5;
            }
            const newVol = Math.max(0, Math.min(100, targetVol));

            if (state.isMuted && delta > 0) {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow?.document;
                    const moviePlayer = doc?.getElementById('movie_player');
                    const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                    const video = doc?.querySelector('video');
                    if (playerObj && typeof playerObj.unMute === 'function') playerObj.unMute();
                    if (video) video.muted = false;
                } catch (e) {}
            }

            setPlayerVolume(newVol);
            showVolumeHud(newVol, newVol === 0);
        };

        const togglePlayerMute = () => {
            const state = getPlayerVolumeState();
            const shouldMute = !state.isMuted;
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const moviePlayer = doc?.getElementById('movie_player');
                const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                const video = doc?.querySelector('video');

                if (shouldMute) {
                    if (playerObj && typeof playerObj.mute === 'function') playerObj.mute();
                    if (video) video.muted = true;
                } else {
                    if (playerObj && typeof playerObj.unMute === 'function') playerObj.unMute();
                    if (video) video.muted = false;
                    if (state.volume === 0) {
                        setPlayerVolume(20);
                        state.volume = 20;
                    }
                }
            } catch (e) {}
            showVolumeHud(state.volume, shouldMute);
        };

        const togglePlayPause = () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const video = doc?.querySelector('video');
                if (video) {
                    if (video.paused) {
                        video.play().catch(() => {});
                    } else {
                        video.pause();
                    }
                    return;
                }
                const playBtn = doc?.querySelector('.ytp-play-button');
                if (playBtn) playBtn.click();
            } catch (e) {}
        };

        const seekBySeconds = (seconds) => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const video = doc?.querySelector('video');
                if (video && typeof video.currentTime === 'number') {
                    video.currentTime = Math.max(0, video.currentTime + seconds);
                    resetAutoHideTimer();
                }
            } catch (e) {}
        };

        const playNextVideo = () => {
            let triggered = false;
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const moviePlayer = doc?.getElementById('movie_player');
                const playerObj = moviePlayer?.wrappedJSObject || moviePlayer;
                if (playerObj && typeof playerObj.nextVideo === 'function') {
                    playerObj.nextVideo();
                    triggered = true;
                } else {
                    const nextYtBtn = doc?.querySelector('.ytp-next-button');
                    if (nextYtBtn) {
                        nextYtBtn.click();
                        triggered = true;
                    }
                }
            } catch (e) {}

            if (!triggered) {
                const nextRec = findNextRecommendation(currentPlayingVideoId);
                if (nextRec) {
                    loadVideoInOverlay(nextRec.videoId, nextRec.title, nextRec.isShort);
                }
            }
        };

        let toastTimer = null;
        const showToast = (message, iconSvg = '') => {
            if (!toast) return;
            const textEl = toast.querySelector('.yt-cinema-toast-text');
            const iconEl = toast.querySelector('.yt-cinema-toast-icon');
            if (textEl) textEl.textContent = message;
            if (iconEl) iconEl.innerHTML = iconSvg;
            toast.classList.add('yt-cinema-toast-visible');

            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toast.classList.remove('yt-cinema-toast-visible');
            }, 2400);
        };

        const triggerShutterFlash = () => {
            if (!shutterFlash) return;
            shutterFlash.classList.remove('flashing');
            void shutterFlash.offsetWidth;
            shutterFlash.classList.add('flashing');
            setTimeout(() => {
                shutterFlash.classList.remove('flashing');
            }, 40);
        };

        const triggerButtonSuccess = (btn, originalTitle, feedbackTitle) => {
            if (!btn) return;
            btn.classList.add('yt-cinema-copied');
            btn.setAttribute('title', feedbackTitle);
            const mainIcon = btn.querySelector('svg:not(.yt-cinema-copied-svg)');
            let checkIcon = btn.querySelector('.yt-cinema-copied-svg');
            if (!checkIcon) {
                checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                checkIcon.setAttribute('viewBox', '0 0 24 24');
                checkIcon.setAttribute('fill', 'currentColor');
                checkIcon.classList.add('yt-cinema-copied-svg');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
                checkIcon.appendChild(path);
                btn.appendChild(checkIcon);
            }
            if (mainIcon) mainIcon.style.display = 'none';
            checkIcon.style.display = 'inline-block';

            setTimeout(() => {
                btn.classList.remove('yt-cinema-copied');
                btn.setAttribute('title', originalTitle);
                checkIcon.style.display = 'none';
                if (mainIcon) mainIcon.style.display = 'inline-block';
            }, 1800);
        };

        const downloadBlob = (blob, filename) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                a.remove();
                URL.revokeObjectURL(url);
            }, 600);
        };

        const takeScreenshot = async (copyToClipboard = false) => {
            let video = null;
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                video = doc?.querySelector('video');
            } catch (e) {
                console.warn('[Cinema Mode] Video element query failed:', e);
            }

            const errorIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
            const successIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

            if (!video || video.readyState < 2) {
                showToast('Video not ready to capture', errorIcon);
                return;
            }

            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) {
                showToast('Unable to determine video resolution', errorIcon);
                return;
            }

            try {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('2D context unavailable');

                ctx.drawImage(video, 0, 0, width, height);
                triggerShutterFlash();

                const titleSpan = overlayElement.querySelector('.yt-cinema-title-text');
                const rawTitle = titleSpan?.textContent?.trim() || 'YouTube Video';
                const cleanTitle = rawTitle
                    .replace(/[/\\?%*:|"<>]/g, '-')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 60) || 'YouTube-Video';

                const curSeconds = Math.floor(video.currentTime || 0);
                const mins = Math.floor(curSeconds / 60);
                const secs = curSeconds % 60;
                const timeFormatted = `${mins.toString().padStart(2, '0')}m${secs.toString().padStart(2, '0')}s`;
                const filename = `${cleanTitle} - ${timeFormatted}.png`;

                canvas.toBlob(async (blob) => {
                    if (!blob) {
                        showToast('Failed to create image blob', errorIcon);
                        return;
                    }

                    if (copyToClipboard) {
                        let copied = false;
                        try {
                            if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                                await navigator.clipboard.write([
                                    new ClipboardItem({ 'image/png': blob })
                                ]);
                                copied = true;
                            }
                        } catch (clipErr) {
                            console.warn('[Cinema Mode] Clipboard write failed, falling back to download:', clipErr);
                        }

                        if (copied) {
                            showToast(`Copied frame to clipboard (${width}×${height})`, successIcon);
                            triggerButtonSuccess(screenshotBtn, 'Take Screenshot (S) • Shift+Click to Copy', 'Copied to clipboard!');
                            return;
                        }
                    }

                    downloadBlob(blob, filename);
                    showToast(`Screenshot saved (${width}×${height})`, successIcon);
                    triggerButtonSuccess(screenshotBtn, 'Take Screenshot (S) • Shift+Click to Copy', 'Screenshot saved!');
                }, 'image/png');

            } catch (err) {
                console.error('[Cinema Mode] Screenshot capture failed:', err);
                showToast('Error capturing frame', errorIcon);
            }
        };

        const closeOverlay = () => {
            if (!overlayElement.isConnected) return;

            activeDockedOverlays.delete(overlayElement);
            if (activeModalOverlay === overlayElement) {
                activeModalOverlay = null;
            }

            if (overlayElement._ambientAnimFrameId) {
                cancelAnimationFrame(overlayElement._ambientAnimFrameId);
                overlayElement._ambientAnimFrameId = null;
            }

            if (toastTimer) {
                clearTimeout(toastTimer);
                toastTimer = null;
            }

            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }
            showControls();
            toggleSpeedMenu(false);

            resumeBackgroundVideo();

            if (overlayElement._checkVideoInterval) {
                clearInterval(overlayElement._checkVideoInterval);
                overlayElement._checkVideoInterval = null;
            }
            if (overlayElement._playerReadyInterval) {
                clearInterval(overlayElement._playerReadyInterval);
                overlayElement._playerReadyInterval = null;
            }
            if (overlayElement._earlyStyleInterval) {
                clearInterval(overlayElement._earlyStyleInterval);
                overlayElement._earlyStyleInterval = null;
            }

            if (isResizing) {
                window.removeEventListener('pointermove', onResizePointerMove);
                window.removeEventListener('pointerup', onResizePointerUp);
                window.removeEventListener('pointercancel', onResizePointerUp);
                isResizing = false;
            }

            overlayElement.classList.remove('yt-cinema-visible');
            overlayElement.classList.remove('yt-cinema-docked');
            if (!activeModalOverlay) {
                document.body.style.overflow = '';
            }

            try {
                iframe.src = 'about:blank';
            } catch (e) {}

            window.removeEventListener('keydown', keyHandler, true);

            setTimeout(() => overlayElement.remove(), 300);
        };

        overlayElement._close = closeOverlay;
        overlayElement._toggleDock = toggleDockMode;
        overlayElement._updateAutoHide = updateAutoHideState;
        overlayElement._applySpeed = () => applySpeedToPlayer(currentSpeed);

        if (speedPill) {
            speedPill.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSpeedMenu();
            });
        }

        if (speedMenu) {
            speedMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.yt-cinema-speed-item');
                if (item && item.dataset.speed) {
                    const newSpeed = parseFloat(item.dataset.speed);
                    setPlaybackSpeed(newSpeed, true);
                    toggleSpeedMenu(false);
                }
            });
        }

        if (dockBtn) {
            dockBtn.addEventListener('click', () => toggleDockMode());
        }

        if (screenshotBtn) {
            screenshotBtn.addEventListener('click', (e) => {
                takeScreenshot(e.shiftKey);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', playPreviousVideo);
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', playNextVideo);
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const seconds = getCurrentPlaybackSeconds(iframe, initialTimestamp);
                const shareUrl = seconds > 0
                    ? `https://youtu.be/${currentPlayingVideoId}?t=${seconds}`
                    : `https://youtu.be/${currentPlayingVideoId}`;

                try {
                    await navigator.clipboard.writeText(shareUrl);
                } catch (err) {
                    const textarea = document.createElement('textarea');
                    textarea.value = shareUrl;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                }

                copyBtn.classList.add('yt-cinema-copied');
                const originalTitle = copyBtn.getAttribute('title') || 'Copy Link at Current Time';
                copyBtn.setAttribute('title', 'Copied to clipboard!');
                const linkIcon = copyBtn.querySelector('svg');
                let checkIcon = copyBtn.querySelector('.yt-cinema-copied-svg');
                if (!checkIcon) {
                    checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    checkIcon.setAttribute('viewBox', '0 0 24 24');
                    checkIcon.setAttribute('fill', 'currentColor');
                    checkIcon.classList.add('yt-cinema-copied-svg');
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
                    checkIcon.appendChild(path);
                    copyBtn.appendChild(checkIcon);
                }
                if (linkIcon) linkIcon.style.display = 'none';
                checkIcon.style.display = 'inline-block';

                setTimeout(() => {
                    copyBtn.classList.remove('yt-cinema-copied');
                    copyBtn.setAttribute('title', originalTitle);
                    checkIcon.style.display = 'none';
                    if (linkIcon) linkIcon.style.display = 'inline-block';
                }, 1800);
            });
        }

        closeBtn.addEventListener('click', closeOverlay);

        const toggleFullscreen = (el, fallbackEl) => {
            try {
                const isFs = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement;
                if (isFs) {
                    if (document.exitFullscreen) {
                        document.exitFullscreen();
                    } else if (document.mozCancelFullScreen) {
                        document.mozCancelFullScreen();
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                    }
                } else if (el) {
                    const req = el.requestFullscreen || el.mozRequestFullScreen || el.webkitRequestFullscreen;
                    if (req) {
                        const p = req.call(el);
                        if (p && typeof p.catch === 'function') {
                            p.catch(() => {
                                if (fallbackEl) {
                                    const reqFb = fallbackEl.requestFullscreen || fallbackEl.mozRequestFullScreen || fallbackEl.webkitRequestFullscreen;
                                    if (reqFb) reqFb.call(fallbackEl);
                                }
                            });
                        }
                    } else if (fallbackEl) {
                        const reqFb = fallbackEl.requestFullscreen || fallbackEl.mozRequestFullScreen || fallbackEl.webkitRequestFullscreen;
                        if (reqFb) reqFb.call(fallbackEl);
                    }
                }
            } catch (err) {}
        };

        pipBtn.addEventListener('click', async () => {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const video = doc?.querySelector('video');
                if (video && (document.pictureInPictureEnabled || doc?.pictureInPictureEnabled)) {
                    if (document.pictureInPictureElement) {
                        await document.exitPictureInPicture();
                        return;
                    }
                    await video.requestPictureInPicture();
                    return;
                }
            } catch (err) {}

            try {
                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                const ytPipBtn = doc?.querySelector('.ytp-pip-button');
                if (ytPipBtn) {
                    ytPipBtn.click();
                    return;
                }
            } catch (err) {}
            showToast('Click Firefox blue PiP icon or press Ctrl+Shift+]', pipIconSvg);
        });

        newTabBtn.addEventListener('click', () => {
            const seconds = getCurrentPlaybackSeconds(iframe, initialTimestamp);
            const targetUrl = seconds > 0
                ? `https://www.youtube.com/watch?v=${currentPlayingVideoId}&t=${seconds}s`
                : `https://www.youtube.com/watch?v=${currentPlayingVideoId}`;
            window.open(targetUrl, '_blank');
        });

        overlayElement.addEventListener('click', (e) => {
            if (isSpeedMenuOpen && !e.target.closest('.yt-cinema-speed-container')) {
                toggleSpeedMenu(false);
            }
            if (isDocked) return;
            if (e.target === overlayElement) closeOverlay();
        });

        if (header) {
            header.addEventListener('mouseenter', () => {
                isHoveringControls = true;
                resetAutoHideTimer();
            });
            header.addEventListener('mouseleave', () => {
                isHoveringControls = false;
                resetAutoHideTimer();
            });
        }

        if (footer) {
            footer.addEventListener('mouseenter', () => {
                isHoveringControls = true;
                resetAutoHideTimer();
            });
            footer.addEventListener('mouseleave', () => {
                isHoveringControls = false;
                resetAutoHideTimer();
            });
        }

        overlayElement.addEventListener('mousemove', () => {
            resetAutoHideTimer();
        }, { passive: true });

        function keyHandler(e) {
            if (!overlayElement.isConnected) {
                window.removeEventListener('keydown', keyHandler, true);
                return;
            }

            // If docked, only the active topmost docked overlay responds to global hotkeys
            if (isDocked) {
                if (activeModalOverlay && activeModalOverlay !== overlayElement) return;
                let highestZ = -1;
                let topOv = null;
                for (const ov of activeDockedOverlays) {
                    const z = parseInt(ov.style.zIndex, 10) || 0;
                    if (z > highestZ) {
                        highestZ = z;
                        topOv = ov;
                    }
                }
                if (topOv && topOv !== overlayElement) return;
            }

            resetAutoHideTimer();

            if (e.key === 'Escape') {
                if (isSpeedMenuOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSpeedMenu(false);
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                closeOverlay();
            } else if (e.key === 'ArrowUp' && !isInputFocused()) {
                e.preventDefault();
                changeVolume(5);
            } else if (e.key === 'ArrowDown' && !isInputFocused()) {
                e.preventDefault();
                changeVolume(-5);
            } else if (e.key.toLowerCase() === 'm' && !isInputFocused()) {
                e.preventDefault();
                togglePlayerMute();
            } else if (e.key.toLowerCase() === 'p' && !isInputFocused()) {
                e.preventDefault();
                playPreviousVideo();
            } else if (e.key.toLowerCase() === 'd' && !isInputFocused()) {
                e.preventDefault();
                toggleDockMode();
            } else if (e.key.toLowerCase() === 's' && !isInputFocused()) {
                e.preventDefault();
                takeScreenshot(e.shiftKey);
            } else if ((e.key === '[' || e.key === '<') && !isInputFocused()) {
                e.preventDefault();
                changeSpeedByStep(-1);
            } else if ((e.key === ']' || e.key === '>') && !isInputFocused()) {
                e.preventDefault();
                changeSpeedByStep(1);
            } else if (e.key.toLowerCase() === 'n' && !isInputFocused()) {
                e.preventDefault();
                playNextVideo();
            } else if ((e.key === ' ' || e.key.toLowerCase() === 'k') && !isInputFocused()) {
                e.preventDefault();
                togglePlayPause();
            } else if ((e.key === 'ArrowLeft' || e.key.toLowerCase() === 'j') && !isInputFocused()) {
                e.preventDefault();
                seekBySeconds(e.key.toLowerCase() === 'j' ? -10 : -5);
            } else if ((e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') && !isInputFocused()) {
                e.preventDefault();
                seekBySeconds(e.key.toLowerCase() === 'l' ? 10 : 5);
            } else if (e.key.toLowerCase() === 'f' && !isInputFocused()) {
                e.preventDefault();
                const cont = overlayElement.querySelector('.yt-cinema-container');
                toggleFullscreen(overlayElement, cont);
            } else if (e.key.toLowerCase() === 't' && !isInputFocused()) {
                try {
                    const theaterBtn = iframe.contentDocument?.querySelector('.ytp-size-button');
                    if (theaterBtn) theaterBtn.click();
                } catch (err) {}
            }
        };

        function isInputFocused() {
            const tag = document.activeElement?.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
        }

        window.addEventListener('keydown', keyHandler, true);

        const attachIframeListeners = () => {
            try {
                const iframeWin = iframe.contentWindow;
                const iframeDoc = iframe.contentDocument || iframeWin?.document;
                if (iframeWin) {
                    iframeWin.addEventListener('mousedown', () => {
                        if (isDocked) {
                            topZIndex++;
                            overlayElement.style.zIndex = topZIndex;
                            container.style.zIndex = topZIndex;
                        }
                        if (isSpeedMenuOpen) toggleSpeedMenu(false);
                    });
                    iframeWin.addEventListener('mousemove', () => {
                        resetAutoHideTimer();
                    }, { passive: true });
                    iframeWin.addEventListener('keydown', (e) => {
                        resetAutoHideTimer();
                        if (e.key === 'Escape') {
                            if (isSpeedMenuOpen) {
                                e.preventDefault();
                                toggleSpeedMenu(false);
                                return;
                            }
                            e.preventDefault();
                            closeOverlay();
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            changeVolume(5);
                        } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            changeVolume(-5);
                        } else if (e.key.toLowerCase() === 'm') {
                            e.preventDefault();
                            togglePlayerMute();
                        } else if (e.key.toLowerCase() === 'p') {
                            e.preventDefault();
                            playPreviousVideo();
                        } else if (e.key.toLowerCase() === 'd') {
                            e.preventDefault();
                            toggleDockMode();
                        } else if (e.key.toLowerCase() === 's') {
                            e.preventDefault();
                            takeScreenshot(e.shiftKey);
                        } else if (e.key === '[' || e.key === '<') {
                            e.preventDefault();
                            changeSpeedByStep(-1);
                        } else if (e.key === ']' || e.key === '>') {
                            e.preventDefault();
                            changeSpeedByStep(1);
                        } else if (e.key.toLowerCase() === 'n') {
                            e.preventDefault();
                            playNextVideo();
                        } else if (e.key.toLowerCase() === 'f') {
                            e.preventDefault();
                            const cont = overlayElement.querySelector('.yt-cinema-container');
                            toggleFullscreen(overlayElement, cont);
                        }
                    }, true);
                }
                if (iframeDoc) {
                    iframeDoc.addEventListener('mousemove', () => {
                        resetAutoHideTimer();
                    }, { passive: true });
                    const video = iframeDoc.querySelector('video');
                    if (video) {
                        applySpeedToPlayer(currentSpeed);
                        if (isDirectPiP && (document.pictureInPictureEnabled || iframeDoc?.pictureInPictureEnabled)) {
                            if (typeof video.requestPictureInPicture === 'function') {
                                video.requestPictureInPicture().catch(() => {});
                            }
                        }
                        video.addEventListener('play', () => {
                            resetAutoHideTimer();
                            applySpeedToPlayer(currentSpeed);
                        });
                        video.addEventListener('playing', () => resetAutoHideTimer());
                        video.addEventListener('pause', () => showControls());
                        video.addEventListener('ended', () => showControls());
                        video.addEventListener('loadedmetadata', () => {
                            applySpeedToPlayer(currentSpeed);
                            if (isDirectPiP && (document.pictureInPictureEnabled || iframeDoc?.pictureInPictureEnabled)) {
                                if (typeof video.requestPictureInPicture === 'function') {
                                    video.requestPictureInPicture().catch(() => {});
                                }
                            }
                        });
                        video.addEventListener('ratechange', () => {
                            if (isSettingSpeedInternally) return;
                            if (typeof video.playbackRate === 'number' && video.playbackRate > 0) {
                                if (Math.abs(video.playbackRate - currentSpeed) > 0.01) {
                                    currentSpeed = video.playbackRate;
                                    updateSpeedUI(currentSpeed);
                                    if (settings.rememberSpeed) {
                                        settings.savedSpeed = currentSpeed;
                                        try {
                                            api.storage.sync.set({
                                                cinemaSettings: {
                                                    ...settings,
                                                    savedSpeed: currentSpeed
                                                }
                                            });
                                        } catch (e) {}
                                    }
                                }
                            }
                        });
                    }
                }
            } catch (err) {}
        };

        attachIframeListeners();
        iframe.addEventListener('load', attachIframeListeners);
        resetAutoHideTimer();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatKeyDisplay(key) {
        if (!key) return 'H';
        if (key === ' ' || key.toLowerCase() === 'space') return 'Space';
        if (key.length === 1) return key.toUpperCase();
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function isHotkeyMatch(e, hotkey) {
        if (!hotkey) return false;
        const hk = hotkey.toLowerCase();
        if (hk === ' ' || hk === 'space') {
            return e.key === ' ' || e.code === 'Space';
        }
        return e.key.toLowerCase() === hk;
    }

    document.addEventListener('keydown', function (e) {
        if (e.repeat) return;

        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

        const isCtrl = e.ctrlKey || e.metaKey;
        const isDirectMini = settings.directMiniPlayer && isCtrl && !e.altKey && !e.shiftKey;
        const isStandardCinema = !isCtrl && !e.altKey && !e.metaKey && !e.shiftKey;

        if (isHotkeyMatch(e, settings.hotkey)) {
            if (isDirectMini) {
                if (currentTarget && currentTarget.href) {
                    const vidId = getVideoID(currentTarget.href);
                    if (vidId) {
                        e.preventDefault();
                        e.stopPropagation();
                        const title = getVideoTitle(currentTarget);
                        const timestamp = getVideoTimestamp(currentTarget.href);
                        const aspectInfo = detectVideoAspectRatio(currentTarget);
                        createOverlay(vidId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio, true);
                    }
                } else if (!activeModalOverlay) {
                    const vidId = getVideoID(window.location.href);
                    if (vidId) {
                        e.preventDefault();
                        e.stopPropagation();
                        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, yt-formatted-string.ytd-watch-metadata');
                        const pageTitle = titleEl?.textContent?.trim() || document.title.replace(/ - YouTube$/, '').trim() || 'YouTube Video';
                        let pageTimestamp = null;
                        const pageVideo = document.querySelector('video');
                        if (pageVideo && pageVideo.currentTime > 0) {
                            pageTimestamp = Math.floor(pageVideo.currentTime).toString();
                        } else {
                            pageTimestamp = getVideoTimestamp(window.location.href);
                        }
                        const aspectInfo = detectVideoAspectRatio(null);
                        createOverlay(vidId, pageTitle, pageTimestamp, aspectInfo.isVertical, aspectInfo.ratio, true);
                    }
                }
            } else if (isStandardCinema) {
                if (activeModalOverlay) return;
                if (settings.directPiP) {
                    if (currentTarget && currentTarget.href) {
                        const vidId = getVideoID(currentTarget.href);
                        if (vidId) {
                            e.preventDefault();
                            e.stopPropagation();
                            const title = getVideoTitle(currentTarget);
                            const timestamp = getVideoTimestamp(currentTarget.href);
                            openDirectPictureInPicture(vidId, title, timestamp);
                            return;
                        }
                    } else if (window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts/')) {
                        const vidId = getVideoID(window.location.href);
                        if (vidId) {
                            e.preventDefault();
                            e.stopPropagation();
                            const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1, yt-formatted-string.ytd-watch-metadata');
                            const pageTitle = titleEl?.textContent?.trim() || document.title.replace(/ - YouTube$/, '').trim() || 'YouTube Video';
                            const pageVideo = document.querySelector('video');
                            const pageTimestamp = (pageVideo && pageVideo.currentTime > 0) ? Math.floor(pageVideo.currentTime).toString() : null;
                            openDirectPictureInPicture(vidId, pageTitle, pageTimestamp);
                            return;
                        }
                    }
                } else {
                    if (currentTarget && currentTarget.href) {
                        const vidId = getVideoID(currentTarget.href);
                        if (vidId) {
                            e.preventDefault();
                            const title = getVideoTitle(currentTarget);
                            const timestamp = getVideoTimestamp(currentTarget.href);
                            const aspectInfo = detectVideoAspectRatio(currentTarget);
                            createOverlay(vidId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio, false);
                        }
                    }
                }
            }
        }
    });

    let hoverIndicator = null;

    function updateHoverIndicatorHotkey() {
        if (hoverIndicator) {
            const span = hoverIndicator.querySelector('span');
            if (span) {
                const hk = formatKeyDisplay(settings.hotkey || 'h');
                if (settings.directPiP) {
                    span.innerHTML = `Press ${escapeHtml(hk)} for PiP`;
                } else if (settings.directMiniPlayer) {
                    span.innerHTML = `Press ${escapeHtml(hk)} <span style="opacity:0.8;font-size:11px;margin-left:3px;">(Ctrl+${escapeHtml(hk)}: Mini)</span>`;
                } else {
                    span.textContent = `Press ${hk}`;
                }
            }
        }
    }

    function showHoverIndicator(element) {
        if (!settings.showIndicator) return;

        if (!hoverIndicator) {
            hoverIndicator = document.createElement('div');
            hoverIndicator.className = 'yt-cinema-hover-indicator';
            hoverIndicator.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
                <span></span>
            `;
            updateHoverIndicatorHotkey();
            document.body.appendChild(hoverIndicator);
        } else {
            updateHoverIndicatorHotkey();
        }

        const rect = element.getBoundingClientRect();
        hoverIndicator.style.top = `${rect.top + window.scrollY + 8}px`;
        hoverIndicator.style.left = `${rect.left + window.scrollX + 8}px`;
        hoverIndicator.classList.add('yt-cinema-hover-visible');
    }

    function hideHoverIndicator() {
        if (hoverIndicator) {
            hoverIndicator.classList.remove('yt-cinema-hover-visible');
        }
    }

    function findVideoLink(target) {
        if (!target || !target.closest) return null;

        // 1. Direct anchor match
        const link = target.closest('a[href*="watch?v="], a[href*="shorts/"]');
        if (link) {
            const isThumbnail = link.id === 'thumbnail' ||
                link.classList.contains('ytd-thumbnail') ||
                link.closest('ytd-thumbnail, ytd-rich-grid-media, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytd-rich-item-renderer') ||
                link.querySelector('img, yt-image, ytd-thumbnail, .yt-core-image');

            if (isThumbnail) return link;
        }

        // 2. Fallback: card container search for modern YouTube components
        const card = target.closest('ytd-thumbnail, yt-thumbnail-view-model, ytd-rich-item-renderer, ytd-rich-grid-media, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model');
        if (card) {
            const found = card.querySelector('a#thumbnail[href*="watch?v="], a#thumbnail[href*="shorts/"], a.yt-lockup-view-model__content-image, a[href*="watch?v="], a[href*="shorts/"]');
            if (found) return found;
        }

        return null;
    }

    // Prevent default browser actions for configured mouse triggers (e.g. Save As or autoscroll)
    document.addEventListener('mousedown', (e) => {
        if (activeModalOverlay) return;
        if ((settings.altClickTrigger && e.altKey && e.button === 0) ||
            (settings.middleClickTrigger && e.button === 1)) {
            const link = findVideoLink(e.target);
            if (link && link.href && getVideoID(link.href)) {
                e.preventDefault();
            }
        }
    }, true);

    // Alt + Click trigger
    document.addEventListener('click', (e) => {
        if (activeModalOverlay) return;
        if (settings.altClickTrigger && e.altKey && e.button === 0) {
            const link = findVideoLink(e.target);
            if (link && link.href) {
                const vidId = getVideoID(link.href);
                if (vidId) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const title = getVideoTitle(link);
                    const timestamp = getVideoTimestamp(link.href);
                    if (settings.directPiP) {
                        openDirectPictureInPicture(vidId, title, timestamp);
                    } else {
                        const aspectInfo = detectVideoAspectRatio(link);
                        createOverlay(vidId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio);
                    }
                }
            }
        }
    }, true);

    // Middle-Click trigger
    document.addEventListener('auxclick', (e) => {
        if (activeModalOverlay) return;
        if (settings.middleClickTrigger && e.button === 1) {
            const link = findVideoLink(e.target);
            if (link && link.href) {
                const vidId = getVideoID(link.href);
                if (vidId) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    const title = getVideoTitle(link);
                    const timestamp = getVideoTimestamp(link.href);
                    if (settings.directPiP) {
                        openDirectPictureInPicture(vidId, title, timestamp);
                    } else {
                        const aspectInfo = detectVideoAspectRatio(link);
                        createOverlay(vidId, title, timestamp, aspectInfo.isVertical, aspectInfo.ratio);
                    }
                }
            }
        }
    }, true);

    document.addEventListener('mouseover', (e) => {
        if (activeModalOverlay) return;
        const link = findVideoLink(e.target);
        if (link) {
            currentTarget = link;
            showHoverIndicator(link);
        }
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
        if (!currentTarget) return;
        if (!currentTarget.contains(e.relatedTarget)) {
            currentTarget = null;
            hideHoverIndicator();
        }
    }, { passive: true });

    window.addEventListener('scroll', () => {
        if (currentTarget) {
            if (!settings.showIndicator) {
                hideHoverIndicator();
                return;
            }
            const rect = currentTarget.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                hideHoverIndicator();
            } else if (hoverIndicator && hoverIndicator.classList.contains('yt-cinema-hover-visible')) {
                hoverIndicator.style.top = `${rect.top + window.scrollY + 8}px`;
                hoverIndicator.style.left = `${rect.left + window.scrollX + 8}px`;
            }
        }
    }, { passive: true });

    console.log('[YouTube Cinema Mode] Extension loaded. Press hotkey or Alt+Click thumbnail to activate.');
})();
