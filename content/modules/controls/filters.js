/**
 * Visual Filters & Ultrawide Zoom control — CSS filter grading presets and 21:9 crop zoom.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;

    const PRESETS = {
        none: { label: 'Standard', filter: 'none' },
        vivid: { label: 'Vivid Cinema', filter: 'contrast(1.12) saturate(1.22)' },
        warm: { label: 'Warm Eye-Care', filter: 'sepia(0.22) contrast(1.04) brightness(0.96)' },
        dim: { label: 'Late Night Dim', filter: 'brightness(0.75) contrast(0.95)' },
        noir: { label: 'Noir B&W', filter: 'grayscale(1) contrast(1.18)' }
    };

    const ZOOM_LEVELS = [1, 1.15, 1.34];

    const ZOOM_LABELS = {
        1: '1x Standard',
        1.15: '1.15x Subtle Fill',
        1.34: '1.34x Ultrawide'
    };

    function createFiltersControl(ctx) {
        const { els, flags } = ctx;

        let currentPreset = 'none';
        let zoomIndex = 0;

        function renderMenu() {
            if (!els.filtersMenu) return;
            const check = icons.checkSvg('yt-cinema-filters-check');

            const presetRows = Object.entries(PRESETS).map(([id, def]) => `
                <div class="yt-cinema-filters-item${id === currentPreset ? ' active' : ''}" data-filter-preset="${id}">
                    <span>${def.label}</span>
                    ${check}
                </div>
            `).join('');

            const zoomRows = ZOOM_LEVELS.map((level, idx) => `
                <div class="yt-cinema-filters-item${idx === zoomIndex ? ' active' : ''}" data-zoom-index="${idx}">
                    <span>${ZOOM_LABELS[level] || `${level}x`}</span>
                    ${check}
                </div>
            `).join('');

            els.filtersMenu.innerHTML = `
                <div class="yt-cinema-filters-section-label">Cinema Filters</div>
                ${presetRows}
                <div class="yt-cinema-filters-divider"></div>
                <div class="yt-cinema-filters-section-label">Aspect Zoom</div>
                ${zoomRows}
            `;
        }

        function updateMenuUI() {
            const zoom = ZOOM_LEVELS[zoomIndex] || 1;
            const isModified = currentPreset !== 'none' || zoom !== 1;
            els.filtersBtn?.classList.toggle('yt-cinema-filters-active', isModified);

            if (!els.filtersMenu) return;
            els.filtersMenu.querySelectorAll('[data-filter-preset]').forEach((item) => {
                item.classList.toggle('active', item.dataset.filterPreset === currentPreset);
            });
            els.filtersMenu.querySelectorAll('[data-zoom-index]').forEach((item) => {
                item.classList.toggle('active', parseInt(item.dataset.zoomIndex, 10) === zoomIndex);
            });
        }

        function applyVisuals() {
            const preset = PRESETS[currentPreset] || PRESETS.none;
            const zoom = ZOOM_LEVELS[zoomIndex] || 1;
            els.playerWrapper?.style.setProperty('--yt-cinema-video-filter', preset.filter);
            els.playerWrapper?.style.setProperty('--yt-cinema-video-zoom', String(zoom));
            updateMenuUI();
        }

        function setPreset(presetId, showNotification = true) {
            currentPreset = PRESETS[presetId] ? presetId : 'none';
            applyVisuals();
            if (showNotification) {
                ctx.toast?.show(`Filter: ${PRESETS[currentPreset].label}`, icons.filters);
            }
            ctx.autohide?.reset();
        }

        function setZoom(level, showNotification = true) {
            let nextIdx = ZOOM_LEVELS.findIndex((z) => Math.abs(z - Number(level)) < 0.01);
            if (nextIdx < 0) nextIdx = 0;
            zoomIndex = nextIdx;
            const activeZoom = ZOOM_LEVELS[zoomIndex];
            applyVisuals();
            if (showNotification) {
                ctx.toast?.show(`Zoom: ${ZOOM_LABELS[activeZoom] || `${activeZoom}x`}`, icons.filters);
            }
            ctx.autohide?.reset();
        }

        function cycleZoom(showNotification = true) {
            const nextIdx = (zoomIndex + 1) % ZOOM_LEVELS.length;
            setZoom(ZOOM_LEVELS[nextIdx], showNotification);
        }

        function toggleMenu(open) {
            flags.filtersMenuOpen = typeof open === 'boolean' ? open : !flags.filtersMenuOpen;

            if (!flags.filtersMenuOpen) {
                els.filtersMenu?.classList.remove('yt-cinema-filters-menu-open');
                els.filtersBtn?.classList.remove('active');
                return;
            }

            if (flags.speedMenuOpen) ctx.speed?.closeMenu?.();
            if (flags.qualityMenuOpen) ctx.quality?.closeMenu?.();

            els.filtersMenu?.classList.add('yt-cinema-filters-menu-open');
            els.filtersBtn?.classList.add('active');
            ctx.autohide?.reset();
        }

        function onBtnClick(e) {
            e.stopPropagation();
            toggleMenu();
        }

        function onMenuClick(e) {
            e.stopPropagation();
            const item = e.target.closest('.yt-cinema-filters-item');
            if (!item) return;

            if (item.dataset.filterPreset) {
                setPreset(item.dataset.filterPreset, true);
                toggleMenu(false);
            } else if (item.dataset.zoomIndex !== undefined) {
                const idx = parseInt(item.dataset.zoomIndex, 10);
                if (Number.isInteger(idx) && ZOOM_LEVELS[idx] !== undefined) {
                    setZoom(ZOOM_LEVELS[idx], true);
                }
                toggleMenu(false);
            }
        }

        function bind() {
            renderMenu();
            applyVisuals();
            els.filtersBtn?.addEventListener('click', onBtnClick);
            els.filtersMenu?.addEventListener('click', onMenuClick);
        }

        function dispose() {
            els.filtersBtn?.removeEventListener('click', onBtnClick);
            els.filtersMenu?.removeEventListener('click', onMenuClick);
            toggleMenu(false);
            currentPreset = 'none';
            zoomIndex = 0;
            applyVisuals();
        }

        return {
            bind,
            setPreset,
            setZoom,
            cycleZoom,
            toggleMenu,
            closeMenu: () => toggleMenu(false),
            getState: () => ({ preset: currentPreset, zoom: ZOOM_LEVELS[zoomIndex] }),
            dispose
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.filters = { createFiltersControl, PRESETS, ZOOM_LEVELS };
})(globalThis.YTC);
