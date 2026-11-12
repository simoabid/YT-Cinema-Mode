/**
 * Zen Focus Mode & Sleep Timer control.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;
    const SLEEP_PRESETS = [0, 15, 30, 60];
    const MINUTE_MS = 60 * 1000;

    function createZenControl(ctx) {
        const { els } = ctx;

        let isZen = false;
        let sleepMinutes = 0;
        let remainingMinutes = 0;
        let sleepTimerId = null;

        function clearSleepTimer() {
            if (sleepTimerId !== null) {
                clearInterval(sleepTimerId);
                sleepTimerId = null;
            }
        }

        function applyZenUI() {
            els.container?.classList.toggle('yt-cinema-zen-mode', isZen);
            els.zenBtn?.classList.toggle('active', isZen);
            els.zenBtn?.setAttribute('aria-pressed', isZen ? 'true' : 'false');
        }

        function updateSleepUI() {
            const btn = els.zenBtn;
            if (!btn) return;
            btn.classList.toggle('yt-cinema-sleep-active', remainingMinutes > 0);
            const badge = btn.querySelector('.yt-cinema-sleep-badge');
            if (badge) {
                badge.textContent = remainingMinutes > 0 ? `${remainingMinutes}m` : '';
            }
            btn.setAttribute('title', remainingMinutes > 0
                ? `Zen Mode (X) • Sleep in ${remainingMinutes}m (Y)`
                : 'Zen Focus Mode (X) • Sleep Timer (Y / Shift+Click)');
        }

        function toggleZen(force, showNotification = true) {
            isZen = typeof force === 'boolean' ? force : !isZen;
            applyZenUI();
            if (showNotification) {
                ctx.toast?.show(isZen ? 'Zen Focus Mode: ON' : 'Zen Focus Mode: OFF', icons.zen);
            }
            ctx.autohide?.reset();
            return isZen;
        }

        function expireSleepTimer() {
            clearSleepTimer();
            sleepMinutes = 0;
            remainingMinutes = 0;
            updateSleepUI();
            if (ctx.transport && typeof ctx.transport.pause === 'function') {
                ctx.transport.pause();
            } else {
                try {
                    const { video } = ctx.getPlayerElements();
                    if (video && !video.paused) video.pause();
                } catch (_) {}
            }
            ctx.toast?.show('Sleep timer paused playback', icons.zen);
        }

        function setSleepTimer(minutes, showNotification = true) {
            clearSleepTimer();

            const num = Number(minutes);
            if (!Number.isFinite(num) || num <= 0) {
                sleepMinutes = 0;
                remainingMinutes = 0;
                updateSleepUI();
                if (showNotification) {
                    ctx.toast?.show('Sleep timer: OFF', icons.zen);
                }
                ctx.autohide?.reset();
                return 0;
            }

            sleepMinutes = num;
            remainingMinutes = Math.max(1, Math.ceil(num));
            updateSleepUI();

            const tickMs = num < 1 ? Math.max(10, Math.round(num * MINUTE_MS)) : MINUTE_MS;
            sleepTimerId = setInterval(() => {
                remainingMinutes -= 1;
                if (remainingMinutes <= 0) {
                    expireSleepTimer();
                } else {
                    updateSleepUI();
                }
            }, tickMs);

            if (showNotification) {
                ctx.toast?.show(`Sleep timer: ${remainingMinutes}m`, icons.zen);
            }
            ctx.autohide?.reset();
            return sleepMinutes;
        }

        function cycleSleepTimer(showNotification = true) {
            const idx = SLEEP_PRESETS.indexOf(sleepMinutes);
            const next = SLEEP_PRESETS[(idx + 1) % SLEEP_PRESETS.length];
            return setSleepTimer(next, showNotification);
        }

        function onZenClick(e) {
            e.stopPropagation();
            if (e.shiftKey) cycleSleepTimer(true);
            else toggleZen();
        }

        function bind() {
            els.zenBtn?.addEventListener('click', onZenClick);
            if (YTC.settings.defaultZenMode) {
                toggleZen(true, false);
            } else {
                applyZenUI();
            }
            updateSleepUI();
        }

        function dispose() {
            clearSleepTimer();
            els.zenBtn?.removeEventListener('click', onZenClick);
            isZen = false;
            sleepMinutes = 0;
            remainingMinutes = 0;
            applyZenUI();
            updateSleepUI();
        }

        return {
            bind,
            toggleZen,
            setSleepTimer,
            cycleSleepTimer,
            getState: () => ({ isZen, sleepMinutes, remainingMinutes }),
            dispose
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.zen = { createZenControl, SLEEP_PRESETS };
})(globalThis.YTC);
