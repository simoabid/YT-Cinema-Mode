(function () {
    'use strict';

    let currentTarget = null;
    let overlay = null;
    let settings = {
        hotkey: 'h',
        overlayOpacity: 0.95,
        playerWidth: 85,
        autoTheater: true,
        showControls: true
    };

    // Communication channel between iframe and main page
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'YT_CINEMA_RESIZE') {
            const { width, height } = event.data;
            adjustContainerSize(width, height);
        }
    });

    function adjustContainerSize(videoWidth, videoHeight) {
        const container = document.querySelector('.yt-cinema-container');
        if (!container) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Max dimensions (85% of viewport)
        const maxWidth = viewportWidth * 0.85;
        const maxHeight = viewportHeight * 0.85;

        // Header + Footer height (approx 100px total)
        const chromeHeight = 100;

        // Available space for video
        const availableHeight = maxHeight - chromeHeight;

        let targetWidth, targetHeight;

        const videoRatio = videoWidth / videoHeight;

        // Try fitting by width first
        targetWidth = maxWidth;
        targetHeight = targetWidth / videoRatio;

        // If height exceeds available space, fit by height
        if (targetHeight > availableHeight) {
            targetHeight = availableHeight;
            targetWidth = targetHeight * videoRatio;
        }

        container.style.width = `${targetWidth}px`;
        container.style.height = `${targetHeight + chromeHeight}px`;

        // Center the wrapper content
        const wrapper = container.querySelector('.yt-cinema-player-wrapper');
        if (wrapper) {
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.justifyContent = 'center';
            wrapper.style.backgroundColor = '#000';
        }
    }

    chrome.storage.sync.get(['cinemaSettings'], (result) => {
        if (result.cinemaSettings) {
            settings = { ...settings, ...result.cinemaSettings };
        }
    });

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

    function getVideoTitle(element) {
        const titleEl = element.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer')
            ?.querySelector('#video-title, #title');
        return titleEl?.textContent?.trim() || 'YouTube Video';
    }

    function createOverlay(videoId, title) {
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'yt-cinema-overlay';
        overlay.className = 'yt-cinema-overlay';

        const container = document.createElement('div');
        container.className = 'yt-cinema-container';
        // Set initial standard aspect ratio (16:9) to prevent collapse
        container.style.width = '80vw';
        container.style.height = 'calc(80vw * 9 / 16 + 80px)'; // Approx 16:9 + header/footer

        const header = document.createElement('div');
        header.className = 'yt-cinema-header';
        header.innerHTML = `
            <div class="yt-cinema-title">
                <svg class="yt-cinema-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
                </svg>
                <span class="yt-cinema-title-text">${escapeHtml(title)}</span>
            </div>
            <div class="yt-cinema-controls">
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

        const playerWrapper = document.createElement('div');
        playerWrapper.className = 'yt-cinema-player-wrapper';

        const loader = document.createElement('div');
        loader.className = 'yt-cinema-loader';
        loader.innerHTML = `
            <div class="yt-cinema-spinner"></div>
            <span>Loading video...</span>
        `;

        const iframe = document.createElement('iframe');
        iframe.className = 'yt-cinema-iframe';
        iframe.src = `https://www.youtube.com/watch?v=${videoId}`;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        iframe.allowFullscreen = true;
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups');

        playerWrapper.appendChild(loader);
        playerWrapper.appendChild(iframe);

        const footer = document.createElement('div');
        footer.className = 'yt-cinema-footer';
        footer.innerHTML = `
            <div class="yt-cinema-hint">
                <span class="yt-cinema-key">ESC</span> Close
                <span class="yt-cinema-key">F</span> Fullscreen
                <span class="yt-cinema-key">T</span> Theater
            </div>
            <div class="yt-cinema-branding">Cinema Mode</div>
        `;

        container.appendChild(header);
        container.appendChild(playerWrapper);
        container.appendChild(footer);
        overlay.appendChild(container);
        document.body.appendChild(overlay);

        document.body.style.overflow = 'hidden';

        requestAnimationFrame(() => {
            overlay.classList.add('yt-cinema-visible');
        });

        iframe.onload = () => {
            loader.style.display = 'none';
            iframe.classList.add('yt-cinema-iframe-loaded');
            injectPlayerStyles(iframe, videoId);
        };

        setupOverlayEvents(overlay, iframe, videoId);
    }

    function injectPlayerStyles(iframe, videoId) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            const style = doc.createElement('style');
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

                html, body, ytd-app { 
                    background: #000 !important; 
                    overflow: hidden !important;
                    scrollbar-width: none !important;
                    width: 100% !important;
                    height: 100% !important;
                }

                html::-webkit-scrollbar, body::-webkit-scrollbar { 
                    display: none !important; 
                }

                #page-manager, #columns, #primary, #primary-inner { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    max-width: 100% !important;
                    width: 100% !important;
                    height: 100% !important;
                }

                ytd-watch-flexy {
                    --ytd-watch-flexy-panel-max-height: 100vh !important;
                    width: 100% !important;
                    height: 100% !important;
                    min-height: 0 !important;
                    display: flex !important;
                    flex-direction: column !important;
                }

                /* Make player fill the viewport */
                #player-container-outer,
                #player-container-inner,
                #player-container {
                    width: 100vw !important;
                    height: 100vh !important;
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    z-index: 0 !important;
                }

                #movie_player {
                    width: 100vw !important;
                    height: 100vh !important;
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    z-index: 1 !important;
                }

                #player-theater-container {
                    display: block !important;
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    z-index: 0 !important;
                }

                .html5-video-container {
                    width: 100% !important;
                    height: 100% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                }

                video {
                    object-fit: contain !important;
                    width: 100% !important;
                    height: 100% !important;
                    max-width: 100vw !important;
                    max-height: 100vh !important;
                }

                .ytp-chrome-bottom {
                    width: calc(100% - 24px) !important;
                    left: 12px !important;
                }
            `;
            doc.head.appendChild(style);

            // Poll for video element and dimensions
            const checkVideoInterval = setInterval(() => {
                const video = doc.querySelector('video');
                if (video && video.videoWidth > 0 && video.videoHeight > 0) {
                    window.parent.postMessage({
                        type: 'YT_CINEMA_RESIZE',
                        width: video.videoWidth,
                        height: video.videoHeight
                    }, '*');

                    // Keep checking for a short while in case resolution changes (quality switch)
                    // But we can clear it after a few stable checks if needed.
                    // For now, let's just listen to resize events if possible.

                    // Add listener for future changes (quality change often changes resolution)
                    video.addEventListener('resize', () => {
                        window.parent.postMessage({
                            type: 'YT_CINEMA_RESIZE',
                            width: video.videoWidth,
                            height: video.videoHeight
                        }, '*');
                    });

                    clearInterval(checkVideoInterval);
                }
            }, 500);



            setTimeout(() => {
                const theaterBtn = doc.querySelector('.ytp-size-button');
                if (theaterBtn && settings.autoTheater) theaterBtn.click();

                const playBtn = doc.querySelector('.ytp-play-button');
                const video = doc.querySelector('video');
                if (video && video.paused && playBtn) {
                    playBtn.click();
                }
            }, 1500);

        } catch (err) {
            console.log('[Cinema Mode] Could not inject styles:', err.message);
        }
    }

    function setupOverlayEvents(overlayElement, iframe, videoId) {
        const closeBtn = overlayElement.querySelector('.yt-cinema-close-btn');
        const pipBtn = overlayElement.querySelector('.yt-cinema-pip-btn');
        const newTabBtn = overlayElement.querySelector('.yt-cinema-newtab-btn');

        const closeOverlay = () => {
            if (!overlay) return;
            overlayElement.classList.remove('yt-cinema-visible');
            document.body.style.overflow = '';
            const elementToRemove = overlayElement;
            overlay = null; // Reset global FIRST
            // Remove all event listeners
            window.removeEventListener('keydown', keyHandler, true);
            window.removeEventListener('blur', blurHandler);
            clearInterval(escCheckInterval);
            setTimeout(() => elementToRemove.remove(), 300);
        };

        closeBtn.addEventListener('click', closeOverlay);

        pipBtn.addEventListener('click', () => {
            try {
                const video = iframe.contentDocument?.querySelector('video');
                if (video && document.pictureInPictureEnabled) {
                    video.requestPictureInPicture();
                }
            } catch (err) {
                console.log('[Cinema Mode] PiP not available');
            }
        });

        newTabBtn.addEventListener('click', () => {
            window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
        });

        overlayElement.addEventListener('click', (e) => {
            if (e.target === overlayElement) closeOverlay();
        });

        // Use capture phase to catch events before iframe
        const keyHandler = (e) => {
            if (!overlay) {
                window.removeEventListener('keydown', keyHandler, true);
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeOverlay();
            } else if (e.key.toLowerCase() === 'f' && !isInputFocused()) {
                try {
                    const container = overlayElement.querySelector('.yt-cinema-container');
                    if (document.fullscreenElement) {
                        document.exitFullscreen();
                    } else {
                        container.requestFullscreen();
                    }
                } catch (err) { }
            } else if (e.key.toLowerCase() === 't' && !isInputFocused()) {
                try {
                    const theaterBtn = iframe.contentDocument?.querySelector('.ytp-size-button');
                    if (theaterBtn) theaterBtn.click();
                } catch (err) { }
            }
        };

        function isInputFocused() {
            const tag = document.activeElement?.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
        }

        // Listen with capture phase
        window.addEventListener('keydown', keyHandler, true);

        // Fallback: Check for ESC when iframe has focus
        // When iframe has focus, we lose keyboard events, so we poll for them
        let escCheckInterval = null;
        const blurHandler = () => {
            // When main window loses focus (iframe gains it), start checking
            if (document.activeElement === iframe || document.activeElement?.tagName === 'IFRAME') {
                if (!escCheckInterval) {
                    escCheckInterval = setInterval(() => {
                        if (!overlay) {
                            clearInterval(escCheckInterval);
                            return;
                        }
                    }, 100);
                }
            }
        };
        window.addEventListener('blur', blurHandler);

        // Try to inject ESC listener inside iframe
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
                iframe.contentWindow.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        closeOverlay();
                    }
                }, true);
            }
        } catch (err) {
            // Cross-origin - can't inject
        }

        // Also try after iframe loads
        iframe.addEventListener('load', () => {
            try {
                const iframeWin = iframe.contentWindow;
                if (iframeWin) {
                    iframeWin.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            closeOverlay();
                        }
                    }, true);
                }
            } catch (err) {
                // Cross-origin - expected
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    document.addEventListener('keydown', function (e) {
        if (overlay) return;

        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;

        if (e.key.toLowerCase() === settings.hotkey) {
            if (currentTarget && currentTarget.href) {
                const vidId = getVideoID(currentTarget.href);
                if (vidId) {
                    const title = getVideoTitle(currentTarget);
                    createOverlay(vidId, title);
                    e.preventDefault();
                }
            }
        }
    });

    let hoverIndicator = null;

    function showHoverIndicator(element) {
        if (!hoverIndicator) {
            hoverIndicator = document.createElement('div');
            hoverIndicator.className = 'yt-cinema-hover-indicator';
            hoverIndicator.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>
                <span>Press H</span>
            `;
            document.body.appendChild(hoverIndicator);
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

    window.addEventListener('mousemove', (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) {
            currentTarget = null;
            hideHoverIndicator();
            return;
        }

        let link = el.closest('a[href*="/watch?v="], a[href*="/shorts/"]');

        if (!link) {
            let temp = el;
            for (let i = 0; i < 7; i++) {
                if (temp.parentElement) {
                    temp = temp.parentElement;
                    if (temp.tagName === 'A' && (temp.href?.includes('/watch?v=') || temp.href?.includes('/shorts/'))) {
                        link = temp;
                        break;
                    }
                } else break;
            }
        }

        if (link) {
            const isThumbnail = link.id === 'thumbnail' ||
                link.querySelector('img, yt-image, ytd-thumbnail') ||
                link.closest('ytd-thumbnail');
            if (isThumbnail) {
                currentTarget = link;
                showHoverIndicator(link);
                return;
            }
        }

        currentTarget = null;
        hideHoverIndicator();
    }, { passive: true });

    console.log('[YouTube Cinema Mode] Extension loaded. Hover over a thumbnail and press H.');
})();
