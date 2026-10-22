/**
 * Layout — container sizing, aspect-ratio corrections, docked-window clamping
 * and the global window-resize handler.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;
    const state = YTC.state;

    /** Measured YouTube chrome (header 61px + footer 43px) sitting around the player. */
    const CHROME_HEIGHT = 104;
    const DOCK_MARGIN = 16;
    const RESIZE_DEBOUNCE_MS = 100;

    const { VERTICAL_RATIO, HORIZONTAL_RATIO, VERTICAL_THRESHOLD } = YTC.video;

    /** True when the container currently represents a vertical (Shorts) video. */
    function isContainerVertical(container) {
        return container.classList.contains('yt-cinema-shorts') ||
            parseFloat(container.dataset.aspectRatio) < VERTICAL_THRESHOLD;
    }

    /** Exact container dimensions for a given ratio, fitting the current viewport. */
    function calculateContainerDimensions(ratio = HORIZONTAL_RATIO, isVertical = false) {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (isVertical || ratio < VERTICAL_THRESHOLD) {
            const vertRatio = (ratio && ratio < VERTICAL_THRESHOLD) ? ratio : VERTICAL_RATIO;
            const targetH = Math.min(viewportHeight * 0.85, 850);
            const playerAreaH = targetH - CHROME_HEIGHT;
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

        const availableVideoHeight = maxOuterHeight - CHROME_HEIGHT;
        const availableVideoWidth = maxOuterWidth;
        const safeRatio = (ratio && ratio > 0) ? ratio : HORIZONTAL_RATIO;

        let videoW = availableVideoWidth;
        let videoH = videoW / safeRatio;

        if (videoH > availableVideoHeight) {
            videoH = availableVideoHeight;
            videoW = videoH * safeRatio;
        }

        return {
            width: Math.round(videoW),
            height: Math.round(videoH + CHROME_HEIGHT),
            isVertical: false,
            ratio: safeRatio
        };
    }

    function setContainerBox(container, dims) {
        container.style.width = `${dims.width}px`;
        container.style.height = `${dims.height}px`;
    }

    /**
     * Toggle the Shorts class and its notch to match the current orientation.
     * `prependNotch` keeps the historical DOM position of the notch element.
     */
    function applyOrientation(container, isVertical, prependNotch = false) {
        if (isVertical) {
            container.classList.add('yt-cinema-shorts');
            if (!container.querySelector('.yt-cinema-shorts-notch')) {
                const notch = document.createElement('div');
                notch.className = 'yt-cinema-shorts-notch';
                if (prependNotch) {
                    container.insertBefore(notch, container.firstChild);
                } else {
                    container.appendChild(notch);
                }
            }
            return;
        }

        container.classList.remove('yt-cinema-shorts');
        const notch = container.querySelector('.yt-cinema-shorts-notch');
        if (notch) notch.remove();
    }

    /** Size + orient a container from freshly computed dimensions. */
    function sizeContainer(container, dims, { vertical, ratio, prependNotch = false } = {}) {
        if (ratio !== undefined) container.dataset.aspectRatio = ratio.toString();
        setContainerBox(container, dims);
        applyOrientation(container, vertical ?? dims.isVertical, prependNotch);
    }

    /** Mirror the container box onto a non-fullscreen ambient layer. */
    function syncAmbientToContainer(overlay, container) {
        if (settings.ambientFullScreen !== false) return;
        const ambientLayer = overlay?.querySelector('.yt-cinema-ambient-layer');
        if (!ambientLayer) return;
        ambientLayer.style.width = container.style.width;
        ambientLayer.style.height = container.style.height;
    }

    /**
     * Re-fit the overlay once the real video dimensions are known.
     * Skips work when the container is already within 3% to avoid layout jank.
     */
    function adjustContainerSize(videoWidth, videoHeight, targetOverlay = state.activeModalOverlay) {
        if (!targetOverlay) return;
        const container = targetOverlay.querySelector('.yt-cinema-container');
        if (!container || container.classList.contains('yt-cinema-docked')) return;
        if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) return;

        const newRatio = videoWidth / videoHeight;
        const isVertical = newRatio < VERTICAL_THRESHOLD || container.classList.contains('yt-cinema-shorts');

        const currentRatio = parseFloat(container.dataset.aspectRatio) || HORIZONTAL_RATIO;
        const verticalMatches = isVertical === container.classList.contains('yt-cinema-shorts');
        if (Math.abs(newRatio - currentRatio) < 0.03 && verticalMatches) return;

        sizeContainer(container, calculateContainerDimensions(newRatio, isVertical), {
            ratio: newRatio,
            vertical: isVertical,
            prependNotch: true
        });
        syncAmbientToContainer(targetOverlay, container);
    }

    /** Keep a docked mini-player fully inside the viewport. */
    function clampDockedWithinViewport(container) {
        if (!container) return;
        const maxAllowedW = Math.max(300, window.innerWidth - DOCK_MARGIN * 2);
        const maxAllowedH = Math.max(200, window.innerHeight - DOCK_MARGIN * 2);

        let contW = container.offsetWidth || 540;
        let contH = container.offsetHeight || 340;
        if (contW > maxAllowedW) {
            contW = maxAllowedW;
            container.style.setProperty('--yt-dock-w', `${maxAllowedW}px`);
        }
        if (contH > maxAllowedH) {
            contH = maxAllowedH;
            container.style.setProperty('--yt-dock-h', `${maxAllowedH}px`);
        }

        const maxX = Math.max(DOCK_MARGIN, window.innerWidth - contW - DOCK_MARGIN);
        const maxY = Math.max(DOCK_MARGIN, window.innerHeight - contH - DOCK_MARGIN);

        let curX = parseFloat(container.dataset.dockX);
        let curY = parseFloat(container.dataset.dockY);
        if (isNaN(curX) || isNaN(curY)) return;

        curX = YTC.util.clamp(curX, DOCK_MARGIN, maxX);
        curY = YTC.util.clamp(curY, DOCK_MARGIN, maxY);

        container.style.setProperty('--yt-dock-x', `${curX}px`);
        container.style.setProperty('--yt-dock-y', `${curY}px`);
        container.dataset.dockX = curX.toString();
        container.dataset.dockY = curY.toString();
    }

    function installWindowResizeHandler() {
        let resizeDebounceTimer = null;
        let windowResizeRaf = null;

        window.addEventListener('resize', () => {
            if (!windowResizeRaf) {
                windowResizeRaf = requestAnimationFrame(() => {
                    windowResizeRaf = null;
                    for (const dockedOverlay of state.activeDockedOverlays) {
                        const cont = dockedOverlay.querySelector('.yt-cinema-container');
                        if (cont && cont.classList.contains('yt-cinema-docked')) {
                            clampDockedWithinViewport(cont);
                        }
                    }
                });
            }

            const modal = state.activeModalOverlay;
            if (!modal) return;
            const container = modal.querySelector('.yt-cinema-container');
            if (!container || container.classList.contains('yt-cinema-docked')) return;

            if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
            resizeDebounceTimer = setTimeout(() => {
                const ratio = parseFloat(container.dataset.aspectRatio) || HORIZONTAL_RATIO;
                const isVertical = container.classList.contains('yt-cinema-shorts') || ratio < VERTICAL_THRESHOLD;
                setContainerBox(container, calculateContainerDimensions(ratio, isVertical));
                syncAmbientToContainer(modal, container);
            }, RESIZE_DEBOUNCE_MS);
        }, { passive: true });
    }

    YTC.layout = {
        DOCK_MARGIN,
        isContainerVertical,
        calculateContainerDimensions,
        setContainerBox,
        applyOrientation,
        sizeContainer,
        syncAmbientToContainer,
        adjustContainerSize,
        installWindowResizeHandler
    };
})(globalThis.YTC);
