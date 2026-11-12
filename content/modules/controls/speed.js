/**
 * Speed control — playback-rate presets, the dropdown menu and persistence.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;
    const icons = YTC.icons;

    const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    const INTERNAL_CHANGE_WINDOW_MS = 120;

    const formatPillText = (speed) => `${speed}x`;
    const formatMenuText = (speed) => (speed === 1 ? '1x Normal' : `${speed}x`);

    function createSpeedControl(ctx) {
        const { els, flags } = ctx;

        let currentSpeed = (settings.rememberSpeed && typeof settings.savedSpeed === 'number' && settings.savedSpeed > 0)
            ? settings.savedSpeed
            : 1;
        let isSettingSpeedInternally = false;

        function renderMenu() {
            if (!els.speedMenu) return;
            const check = icons.checkSvg('yt-cinema-speed-check');
            els.speedMenu.innerHTML = SPEED_PRESETS.map(speed => `
                <div class="yt-cinema-speed-item${speed === currentSpeed ? ' active' : ''}" data-speed="${speed}">
                    <span>${formatMenuText(speed)}</span>
                    ${check}
                </div>
            `).join('');
        }

        function updateUI(speed) {
            if (els.speedPill) {
                els.speedPill.textContent = formatPillText(speed);
                els.speedPill.setAttribute('title', `Playback Speed: ${formatPillText(speed)} ([ / ])`);
            }
            if (!els.speedMenu) return;
            els.speedMenu.querySelectorAll('.yt-cinema-speed-item').forEach(item => {
                item.classList.toggle('active', Math.abs(parseFloat(item.dataset.speed) - speed) < 0.01);
            });
        }

        function applyToPlayer(speed) {
            isSettingSpeedInternally = true;
            try {
                const { video, player } = ctx.getPlayerElements();
                if (video) {
                    video.playbackRate = speed;
                    video.defaultPlaybackRate = speed;
                }
                const playerObj = player?.wrappedJSObject || player;
                if (playerObj && typeof playerObj.setPlaybackRate === 'function') {
                    playerObj.setPlaybackRate(speed);
                }
            } catch (_) {}
            setTimeout(() => {
                isSettingSpeedInternally = false;
            }, INTERNAL_CHANGE_WINDOW_MS);
        }

        function remember(speed) {
            if (!settings.rememberSpeed) return;
            settings.savedSpeed = speed;
            YTC.saveSpeed(speed);
        }

        function set(speed, showNotification = true) {
            currentSpeed = speed;
            applyToPlayer(speed);
            updateUI(speed);
            remember(speed);
            if (showNotification) {
                ctx.toast.show(`Speed: ${formatPillText(speed)}`, icons.speed);
            }
        }

        function changeByStep(direction) {
            let closestIdx = 0;
            let minDiff = Infinity;
            for (let i = 0; i < SPEED_PRESETS.length; i++) {
                const diff = Math.abs(SPEED_PRESETS[i] - currentSpeed);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = i;
                }
            }
            const nextIdx = YTC.util.clamp(closestIdx + direction, 0, SPEED_PRESETS.length - 1);
            set(SPEED_PRESETS[nextIdx], true);
        }

        function toggleMenu(open) {
            flags.speedMenuOpen = typeof open === 'boolean' ? open : !flags.speedMenuOpen;

            if (!flags.speedMenuOpen) {
                els.speedMenu?.classList.remove('yt-cinema-speed-menu-open');
                els.speedPill?.classList.remove('active');
                return;
            }

            // Mirrors quality.toggleMenu: only one menu is ever open.
            if (flags.qualityMenuOpen) ctx.quality.closeMenu();
            if (flags.filtersMenuOpen) ctx.filters?.closeMenu?.();

            els.speedMenu?.classList.add('yt-cinema-speed-menu-open');
            els.speedPill?.classList.add('active');
            ctx.autohide.reset();
        }

        /** The embed changed its own rate (e.g. via the native YouTube menu). */
        function syncFromPlayer(playbackRate) {
            if (isSettingSpeedInternally) return;
            if (typeof playbackRate !== 'number' || playbackRate <= 0) return;
            if (Math.abs(playbackRate - currentSpeed) <= 0.01) return;

            currentSpeed = playbackRate;
            updateUI(currentSpeed);
            remember(currentSpeed);
        }

        function bind() {
            els.speedPill?.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMenu();
            });

            els.speedMenu?.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.yt-cinema-speed-item');
                if (item && item.dataset.speed) {
                    set(parseFloat(item.dataset.speed), true);
                    toggleMenu(false);
                }
            });
        }

        renderMenu();
        updateUI(currentSpeed);

        return {
            set,
            changeByStep,
            toggleMenu,
            closeMenu: () => toggleMenu(false),
            applyToPlayer: () => applyToPlayer(currentSpeed),
            syncFromPlayer,
            bind
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.speed = { createSpeedControl };
})(globalThis.YTC);
