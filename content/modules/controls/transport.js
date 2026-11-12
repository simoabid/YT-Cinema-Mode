/**
 * Transport control — volume, mute, play/pause and seeking, plus the
 * floating volume HUD that mirrors the current level.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;

    const VOLUME_STEP = 5;
    const DEFAULT_UNMUTE_VOLUME = 20;
    const HUD_VISIBLE_MS = 1300;

    function createTransportControl(ctx) {
        const { iframe, els } = ctx;
        let hudTimer = null;

        function getEmbedPlayer() {
            const { player } = ctx.getPlayerElements();
            return player?.wrappedJSObject || player;
        }

        function getVolumeState() {
            let volume = 100;
            let muted = false;
            try {
                const { video } = ctx.getPlayerElements();
                const playerObj = getEmbedPlayer();

                if (playerObj && typeof playerObj.getVolume === 'function') {
                    volume = Math.round(playerObj.getVolume());
                } else if (video && typeof video.volume === 'number') {
                    volume = Math.round(video.volume * 100);
                }

                if (playerObj && typeof playerObj.isMuted === 'function') {
                    muted = playerObj.isMuted();
                } else if (video && typeof video.muted === 'boolean') {
                    muted = video.muted;
                }
            } catch (_) {}

            if (isNaN(volume)) volume = 100;
            return { volume: YTC.util.clamp(volume, 0, 100), isMuted: muted };
        }

        function unmute() {
            try {
                const { video } = ctx.getPlayerElements();
                const playerObj = getEmbedPlayer();
                if (playerObj && typeof playerObj.unMute === 'function') playerObj.unMute();
                if (video) video.muted = false;
            } catch (_) {}
        }

        function showVolumeHud(volume, isMuted) {
            const hud = els.volumeHud;
            if (!hud) return;

            const volIcon = hud.querySelector('.yt-cinema-volume-icon');
            const volFill = hud.querySelector('.yt-cinema-volume-fill');
            const volText = hud.querySelector('.yt-cinema-volume-text');

            if (isMuted || volume === 0) {
                hud.classList.add('is-muted');
                if (volIcon) volIcon.innerHTML = icons.volumeMuted;
                if (volFill) volFill.style.width = '0%';
                if (volText) volText.textContent = 'Muted';
            } else {
                hud.classList.remove('is-muted');
                if (volIcon) volIcon.innerHTML = volume > 50 ? icons.volumeHigh : icons.volumeLow;
                if (volFill) volFill.style.width = `${volume}%`;
                if (volText) volText.textContent = `${volume}%`;
            }

            hud.classList.add('yt-cinema-volume-hud-visible');
            ctx.autohide.reset();

            if (hudTimer) clearTimeout(hudTimer);
            hudTimer = setTimeout(() => {
                hud.classList.remove('yt-cinema-volume-hud-visible');
            }, HUD_VISIBLE_MS);
        }

        /**
         * Pure setter: sets the level and nothing else.
         *
         * Mute is deliberately NOT touched here — raising the volume should not
         * silently unmute, so that decision lives with the caller that knows the
         * user's intent (`changeVolume` unmutes only when `delta > 0`).
         */
        function setVolume(newVolume) {
            const target = YTC.util.clamp(Math.round(newVolume), 0, 100);
            try {
                const { video } = ctx.getPlayerElements();
                const playerObj = getEmbedPlayer();

                if (playerObj && typeof playerObj.setVolume === 'function') {
                    playerObj.setVolume(target);
                }
                if (video) video.volume = target / 100;
            } catch (_) {}
            return target;
        }

        function changeVolume(delta) {
            const state = getVolumeState();
            const target = delta > 0
                ? Math.ceil((state.volume + 0.1) / VOLUME_STEP) * VOLUME_STEP
                : Math.floor((state.volume - 0.1) / VOLUME_STEP) * VOLUME_STEP;

            if (state.isMuted && delta > 0) unmute();

            const applied = setVolume(target);
            showVolumeHud(applied, applied === 0);
        }

        function toggleMute() {
            const state = getVolumeState();
            const shouldMute = !state.isMuted;

            try {
                const { video } = ctx.getPlayerElements();
                const playerObj = getEmbedPlayer();

                if (shouldMute) {
                    if (playerObj && typeof playerObj.mute === 'function') playerObj.mute();
                    if (video) video.muted = true;
                } else {
                    if (playerObj && typeof playerObj.unMute === 'function') playerObj.unMute();
                    if (video) video.muted = false;
                    if (state.volume === 0) {
                        state.volume = setVolume(DEFAULT_UNMUTE_VOLUME);
                    }
                }
            } catch (_) {}

            showVolumeHud(state.volume, shouldMute);
        }

        function togglePlayPause() {
            try {
                const { video } = ctx.getPlayerElements();
                if (video) {
                    if (video.paused) {
                        video.play().catch(() => {});
                    } else {
                        video.pause();
                    }
                    return;
                }
                YTC.player.getEmbedDocument(iframe)?.querySelector('.ytp-play-button')?.click();
            } catch (_) {}
        }

        function seekBySeconds(seconds) {
            try {
                const { video } = ctx.getPlayerElements();
                if (video && typeof video.currentTime === 'number') {
                    video.currentTime = Math.max(0, video.currentTime + seconds);
                    ctx.autohide.reset();
                }
            } catch (_) {}
        }

        function seekToSeconds(seconds) {
            try {
                const target = Math.max(0, Number(seconds) || 0);
                const { video } = ctx.getPlayerElements();
                const playerObj = getEmbedPlayer();
                if (playerObj && typeof playerObj.seekTo === 'function') {
                    playerObj.seekTo(target, true);
                }
                if (video && typeof video.currentTime === 'number') {
                    video.currentTime = target;
                }
                ctx.autohide.reset();
            } catch (_) {}
        }

        function pause() {
            try {
                const { video } = ctx.getPlayerElements();
                const playerObj = getEmbedPlayer();
                if (video && typeof video.pause === 'function') {
                    video.pause();
                } else if (playerObj && typeof playerObj.pauseVideo === 'function') {
                    playerObj.pauseVideo();
                }
            } catch (_) {}
        }

        /** Hide the HUD immediately as well as cancelling its timer. */
        function clearTimers() {
            if (hudTimer) {
                clearTimeout(hudTimer);
                hudTimer = null;
            }
            els.volumeHud?.classList.remove('yt-cinema-volume-hud-visible');
        }

        return {
            changeVolume,
            toggleMute,
            togglePlayPause,
            seekBySeconds,
            seekToSeconds,
            pause,
            clearTimers
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.transport = { createTransportControl };
})(globalThis.YTC);
