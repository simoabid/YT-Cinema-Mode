/**
 * Dock control — turns the full-screen cinema overlay into a floating,
 * draggable, resizable mini-player and back again. Also owns stacking order.
 */
(function (YTC) {
    'use strict';

    const state = YTC.state;
    const icons = YTC.icons;
    const layout = YTC.layout;

    const MARGIN = layout.DOCK_MARGIN;
    const SNAP_THRESHOLD = 32;
    const COLLISION_SLOP = 45;
    const COLLISION_SHIFT = 35;

    const DEFAULT_DOCK_SIZE = { width: 540, height: 340 };
    const DEFAULT_SHORTS_SIZE = { width: 300, height: 500 };
    const DEFAULT_MIN_SIZE = { width: 360, height: 220 };
    const DEFAULT_MIN_SHORTS_SIZE = { width: 240, height: 380 };

    const CURSOR_BY_DIRECTION = {
        n: 'ns-resize', s: 'ns-resize',
        e: 'ew-resize', w: 'ew-resize',
        nw: 'nwse-resize', se: 'nwse-resize',
        ne: 'nesw-resize', sw: 'nesw-resize'
    };

    function createDockControl(ctx) {
        const { overlayElement, els } = ctx;
        const { container, header } = els;

        // Live geometry, updated synchronously and flushed to the DOM per frame.
        let dockX = 0;
        let dockY = 0;

        // Drag state
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragInitialX = 0;
        let dragInitialY = 0;
        let isSnappedEdge = false;
        let dragRafId = null;
        let dragWidth = DEFAULT_DOCK_SIZE.width;
        let dragHeight = DEFAULT_DOCK_SIZE.height;

        // Resize state
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

        function minSize() {
            return layout.isContainerVertical(container) ? DEFAULT_MIN_SHORTS_SIZE : DEFAULT_MIN_SIZE;
        }

        function bringToFront() {
            state.topZIndex++;
            overlayElement.style.zIndex = state.topZIndex;
            container.style.zIndex = state.topZIndex;
        }

        function writeDockPosition() {
            container.style.setProperty('--yt-dock-x', `${dockX}px`);
            container.style.setProperty('--yt-dock-y', `${dockY}px`);
            container.dataset.dockX = dockX.toString();
            container.dataset.dockY = dockY.toString();
        }

        function writeDockSize(width, height) {
            container.style.setProperty('--yt-dock-w', `${width}px`);
            container.style.setProperty('--yt-dock-h', `${height}px`);
        }

        /** Persist the dock slot as a viewport ratio so it survives resizes. */
        function rememberPosition(width, height) {
            state.savedDockedPos = {
                x: dockX,
                y: dockY,
                xRatio: YTC.util.clamp((dockX - MARGIN) / Math.max(1, window.innerWidth - width - MARGIN * 2), 0, 1),
                yRatio: YTC.util.clamp((dockY - MARGIN) / Math.max(1, window.innerHeight - height - MARGIN * 2), 0, 1)
            };
            YTC.storage.setLocal(YTC.KEYS.dockedPos, state.savedDockedPos);
        }

        /** Place a docked container, restoring the saved size/position when possible. */
        function positionDockedContainer() {
            const isVertical = layout.isContainerVertical(container);
            const saved = isVertical ? state.savedDockedShortsSize : state.savedDockedSize;
            const fallback = isVertical ? DEFAULT_SHORTS_SIZE : DEFAULT_DOCK_SIZE;
            const min = minSize();

            let targetW = (saved && saved.width && saved.height) ? saved.width : fallback.width;
            let targetH = (saved && saved.width && saved.height) ? saved.height : fallback.height;
            targetW = YTC.util.clamp(targetW, min.width, window.innerWidth - MARGIN * 2);
            targetH = YTC.util.clamp(targetH, min.height, window.innerHeight - MARGIN * 2);

            writeDockSize(targetW, targetH);

            const maxX = Math.max(MARGIN, window.innerWidth - targetW - MARGIN);
            const maxY = Math.max(MARGIN, window.innerHeight - targetH - MARGIN);

            let targetX = maxX;
            let targetY = maxY;
            const savedPos = state.savedDockedPos;

            if (savedPos) {
                if (typeof savedPos.xRatio === 'number' && typeof savedPos.yRatio === 'number') {
                    targetX = Math.round(MARGIN + savedPos.xRatio * Math.max(1, window.innerWidth - targetW - MARGIN * 2));
                    targetY = Math.round(MARGIN + savedPos.yRatio * Math.max(1, window.innerHeight - targetH - MARGIN * 2));
                } else if (typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
                    targetX = savedPos.x;
                    targetY = savedPos.y;
                }
            }

            targetX = YTC.util.clamp(targetX, MARGIN, maxX);
            targetY = YTC.util.clamp(targetY, MARGIN, maxY);

            // Stagger windows that would otherwise land on top of each other.
            for (const other of state.activeDockedOverlays) {
                if (other === overlayElement) continue;
                const otherContainer = other.querySelector('.yt-cinema-container');
                if (!otherContainer) continue;
                const ox = parseFloat(otherContainer.dataset.dockX);
                const oy = parseFloat(otherContainer.dataset.dockY);
                if (!isNaN(ox) && !isNaN(oy) &&
                    Math.abs(ox - targetX) < COLLISION_SLOP && Math.abs(oy - targetY) < COLLISION_SLOP) {
                    targetX = Math.max(MARGIN, targetX - COLLISION_SHIFT);
                    targetY = Math.max(MARGIN, targetY - COLLISION_SHIFT);
                }
            }

            dockX = targetX;
            dockY = targetY;
            writeDockPosition();
            bringToFront();
        }

        function updateDockButton(expanded) {
            if (!els.dockBtn) return;
            els.dockBtn.setAttribute('title', expanded ? 'Expand Cinema Mode (D)' : 'Mini-Player / Corner Dock (D)');
            els.dockBtn.innerHTML = expanded ? icons.expand : icons.dock;
        }

        // ------------------------------------------------------------- drag

        /** Magnetic edge snapping; falls back to a plain clamp in between. */
        function snapCoordinate(value, viewportExtent, containerExtent) {
            const max = Math.max(MARGIN, viewportExtent - containerExtent - MARGIN);
            if (value <= MARGIN + SNAP_THRESHOLD) return { value: MARGIN, snapped: true };
            if (value >= max - SNAP_THRESHOLD) return { value: max, snapped: true };
            return { value: YTC.util.clamp(value, MARGIN, max), snapped: false };
        }

        function onPointerDown(e) {
            if (!ctx.isDocked || isResizing) return;
            if (e.target.closest('button, .yt-cinema-speed-container, .yt-cinema-speed-pill, .yt-cinema-speed-menu, .yt-cinema-comments-panel, .yt-cinema-resize-handle, .yt-cinema-resize-grip')) return;
            if (e.button !== 0) return;

            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragInitialX = dockX;
            dragInitialY = dockY;
            dragWidth = container.offsetWidth || DEFAULT_DOCK_SIZE.width;
            dragHeight = container.offsetHeight || DEFAULT_DOCK_SIZE.height;

            bringToFront();

            try {
                header.setPointerCapture(e.pointerId);
            } catch (_) {}

            container.classList.add('yt-cinema-dragging');
        }

        function onPointerMove(e) {
            if (!isDragging || !ctx.isDocked) return;

            const horiz = snapCoordinate(dragInitialX + (e.clientX - dragStartX), window.innerWidth, dragWidth);
            const vert = snapCoordinate(dragInitialY + (e.clientY - dragStartY), window.innerHeight, dragHeight);

            const snapped = horiz.snapped || vert.snapped;
            if (snapped !== isSnappedEdge) {
                isSnappedEdge = snapped;
                container.classList.toggle('yt-cinema-snap-edge', snapped);
            }

            dockX = horiz.value;
            dockY = vert.value;

            if (!dragRafId) {
                dragRafId = requestAnimationFrame(() => {
                    writeDockPosition();
                    dragRafId = null;
                });
            }
        }

        function onPointerUp(e) {
            if (!isDragging) return;
            isDragging = false;

            try {
                header.releasePointerCapture(e.pointerId);
            } catch (_) {}

            container.classList.remove('yt-cinema-dragging', 'yt-cinema-snap-edge');
            isSnappedEdge = false;

            if (dragRafId) {
                cancelAnimationFrame(dragRafId);
                dragRafId = null;
            }

            writeDockPosition();
            rememberPosition(dragWidth, dragHeight);
        }

        // ----------------------------------------------------------- resize

        function onResizePointerMove(e) {
            if (!isResizing || !ctx.isDocked) return;
            e.preventDefault();

            const deltaX = e.clientX - resizeStartX;
            const deltaY = e.clientY - resizeStartY;
            const min = minSize();
            const maxW = Math.max(min.width, window.innerWidth - MARGIN * 2);
            const maxH = Math.max(min.height, window.innerHeight - MARGIN * 2);

            let newW = resizeStartW;
            let newH = resizeStartH;
            let newX = resizeStartDockX;
            let newY = resizeStartDockY;

            if (resizeDirection.includes('e')) {
                newW = YTC.util.clamp(resizeStartW + deltaX, min.width,
                    Math.min(maxW, window.innerWidth - MARGIN - resizeStartDockX));
            } else if (resizeDirection.includes('w')) {
                newW = resizeStartW - deltaX;
                if (newW < min.width) {
                    newW = min.width;
                    newX = resizeStartDockX + (resizeStartW - min.width);
                } else if (newW > maxW) {
                    newW = maxW;
                    newX = resizeStartDockX + (resizeStartW - maxW);
                } else {
                    newX = resizeStartDockX + deltaX;
                }
                if (newX < MARGIN) {
                    newW = Math.max(min.width, (resizeStartDockX + resizeStartW) - MARGIN);
                    newX = MARGIN;
                }
            }

            if (resizeDirection.includes('s')) {
                newH = YTC.util.clamp(resizeStartH + deltaY, min.height,
                    Math.min(maxH, window.innerHeight - MARGIN - resizeStartDockY));
            } else if (resizeDirection.includes('n')) {
                newH = resizeStartH - deltaY;
                if (newH < min.height) {
                    newH = min.height;
                    newY = resizeStartDockY + (resizeStartH - min.height);
                } else if (newH > maxH) {
                    newH = maxH;
                    newY = resizeStartDockY + (resizeStartH - maxH);
                } else {
                    newY = resizeStartDockY + deltaY;
                }
                if (newY < MARGIN) {
                    newH = Math.max(min.height, (resizeStartDockY + resizeStartH) - MARGIN);
                    newY = MARGIN;
                }
            }

            currentResizeW = Math.round(newW);
            currentResizeH = Math.round(newH);
            dockX = Math.round(newX);
            dockY = Math.round(newY);

            if (!resizeRafId) {
                resizeRafId = requestAnimationFrame(() => {
                    writeDockSize(currentResizeW, currentResizeH);
                    writeDockPosition();
                    resizeRafId = null;
                });
            }
        }

        function removeResizeListeners() {
            window.removeEventListener('pointermove', onResizePointerMove);
            window.removeEventListener('pointerup', onResizePointerUp);
            window.removeEventListener('pointercancel', onResizePointerUp);
        }

        function onResizePointerUp(e) {
            if (!isResizing) return;
            isResizing = false;

            try {
                if (e && e.target && typeof e.target.releasePointerCapture === 'function') {
                    e.target.releasePointerCapture(e.pointerId);
                }
            } catch (_) {}

            removeResizeListeners();
            container.classList.remove('yt-cinema-resizing');
            els.dragShield?.style.removeProperty('cursor');

            if (resizeRafId) {
                cancelAnimationFrame(resizeRafId);
                resizeRafId = null;
            }

            writeDockSize(currentResizeW, currentResizeH);
            writeDockPosition();

            if (layout.isContainerVertical(container)) {
                state.savedDockedShortsSize = { width: currentResizeW, height: currentResizeH };
                YTC.storage.setLocal(YTC.KEYS.dockedShortsSize, state.savedDockedShortsSize);
            } else {
                state.savedDockedSize = { width: currentResizeW, height: currentResizeH };
                YTC.storage.setLocal(YTC.KEYS.dockedSize, state.savedDockedSize);
            }

            rememberPosition(currentResizeW, currentResizeH);
        }

        function onResizePointerDown(e, direction) {
            if (!ctx.isDocked || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            isResizing = true;
            resizeDirection = direction;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = container.offsetWidth;
            resizeStartH = container.offsetHeight;
            currentResizeW = resizeStartW;
            currentResizeH = resizeStartH;
            resizeStartDockX = dockX;
            resizeStartDockY = dockY;

            bringToFront();

            try {
                e.target.setPointerCapture(e.pointerId);
            } catch (_) {}

            container.classList.add('yt-cinema-resizing');
            if (els.dragShield) {
                els.dragShield.style.cursor = CURSOR_BY_DIRECTION[direction] || 'nwse-resize';
            }

            window.addEventListener('pointermove', onResizePointerMove, { passive: false });
            window.addEventListener('pointerup', onResizePointerUp);
            window.addEventListener('pointercancel', onResizePointerUp);
        }

        // ------------------------------------------------------ dock / undock

        function enterDockedMode() {
            ctx.ambient.stop();
            if (state.activeModalOverlay === overlayElement) {
                state.activeModalOverlay = null;
            }
            state.activeDockedOverlays.add(overlayElement);

            overlayElement.classList.add('yt-cinema-docked');
            container.classList.add('yt-cinema-docked');

            ctx.autohide.showControls();
            ctx.autohide.showVideoControls();
            ctx.autohide.clearTimers();

            if (!state.activeModalOverlay) YTC.unlockScroll();

            updateDockButton(true);
            positionDockedContainer();
        }

        function enterModalMode() {
            if (state.activeModalOverlay && state.activeModalOverlay !== overlayElement) {
                state.activeModalOverlay._toggleDock?.(true);
            }
            state.activeDockedOverlays.delete(overlayElement);
            state.activeModalOverlay = overlayElement;

            overlayElement.classList.remove('yt-cinema-docked');
            container.classList.remove('yt-cinema-docked', 'yt-cinema-dragging', 'yt-cinema-resizing', 'yt-cinema-snap-edge');
            container.style.removeProperty('--yt-dock-x');
            container.style.removeProperty('--yt-dock-y');
            container.style.removeProperty('--yt-dock-w');
            container.style.removeProperty('--yt-dock-h');
            YTC.lockScroll();

            updateDockButton(false);
            YTC.applyBackdropSettings(overlayElement);
            ctx.ambient.start();
            ctx.autohide.reset();
        }

        function toggle(forceDock = null) {
            const nextDocked = (typeof forceDock === 'boolean') ? forceDock : !ctx.isDocked;
            if (nextDocked === ctx.isDocked) return;
            ctx.isDocked = nextDocked;

            if (nextDocked) enterDockedMode();
            else enterModalMode();
        }

        /** Adopt docked styling for overlays created directly in mini-player mode. */
        function initDockedState() {
            if (!ctx.isDocked) return;
            state.activeDockedOverlays.add(overlayElement);
            overlayElement.classList.add('yt-cinema-docked');
            container.classList.add('yt-cinema-docked');
            updateDockButton(true);
            positionDockedContainer();
        }

        function cancelPendingFrames() {
            if (dragRafId) {
                cancelAnimationFrame(dragRafId);
                dragRafId = null;
            }
            if (resizeRafId) {
                cancelAnimationFrame(resizeRafId);
                resizeRafId = null;
            }
        }

        function bind() {
            els.dockBtn?.addEventListener('click', () => toggle());

            container.querySelectorAll('.yt-cinema-resize-handle, .yt-cinema-resize-grip').forEach(el => {
                const direction = el.dataset.direction;
                if (direction) el.addEventListener('pointerdown', (e) => onResizePointerDown(e, direction));
            });

            header?.addEventListener('pointerdown', onPointerDown);
            header?.addEventListener('pointermove', onPointerMove);
            header?.addEventListener('pointerup', onPointerUp);
            header?.addEventListener('pointercancel', onPointerUp);
            header?.addEventListener('dblclick', (e) => {
                if (ctx.isDocked && !e.target.closest('button, .yt-cinema-speed-container, .yt-cinema-speed-pill, .yt-cinema-speed-menu')) {
                    toggle(false);
                }
            });

            container.addEventListener('pointerdown', () => {
                if (ctx.isDocked) bringToFront();
            });
        }

        return {
            toggle,
            bringToFront,
            initDockedState,
            cancelPendingFrames,
            endResize() {
                if (!isResizing) return;
                isResizing = false;
                removeResizeListeners();
            },
            bind
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.dock = { createDockControl };
})(globalThis.YTC);
