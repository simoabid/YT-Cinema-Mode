/**
 * Loop control — A-B segment loop (B) and full-video seamless repeat (R).
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;
    const MIN_SEGMENT_SECONDS = 0.5;

    function formatSec(seconds) {
        if (YTC.chapters && typeof YTC.chapters.formatTimestamp === 'function') {
            return YTC.chapters.formatTimestamp(seconds);
        }
        return `${Math.floor(seconds || 0)}s`;
    }

    function createLoopControl(ctx) {
        const { els } = ctx;

        let mode = 'off'; // 'off' | 'point-a' | 'looping'
        let loopStart = null;
        let loopEnd = null;
        let repeatAll = false;

        let boundVideo = null;
        const onVideoTimeUpdate = () => checkLoop(boundVideo);

        function detachVideoListener() {
            if (boundVideo) {
                boundVideo.removeEventListener('timeupdate', onVideoTimeUpdate);
                boundVideo = null;
            }
        }

        function ensureVideoListener() {
            const { video } = ctx.getPlayerElements();
            if (!video) return null;
            if (boundVideo !== video) {
                detachVideoListener();
                boundVideo = video;
                boundVideo.addEventListener('timeupdate', onVideoTimeUpdate);
            }
            return video;
        }

        function render() {
            const btn = els.loopBtn;
            const bar = els.loopBar;
            const fill = els.loopFill;

            if (btn) {
                btn.classList.toggle('yt-cinema-loop-active', mode !== 'off');
                btn.classList.toggle('yt-cinema-repeat-active', repeatAll);
                btn.classList.toggle('active', mode !== 'off' || repeatAll);
                btn.setAttribute('aria-pressed', (mode !== 'off' || repeatAll) ? 'true' : 'false');

                const badgeEl = btn.querySelector('.yt-cinema-loop-badge');
                if (badgeEl) {
                    if (mode === 'point-a') badgeEl.textContent = 'A';
                    else if (mode === 'looping') badgeEl.textContent = 'A-B';
                    else if (repeatAll) badgeEl.textContent = '∞';
                    else badgeEl.textContent = '';
                }

                if (mode === 'point-a') {
                    btn.setAttribute('title', `Loop A set (${formatSec(loopStart)}) — Press B for end point`);
                } else if (mode === 'looping') {
                    btn.setAttribute('title', `Looping ${formatSec(loopStart)} – ${formatSec(loopEnd)} (B to clear)`);
                } else if (repeatAll) {
                    btn.setAttribute('title', 'Repeat video ON (R) • Press B for A-B loop');
                } else {
                    btn.setAttribute('title', 'A-B Loop (B) • Shift+Click or R to Repeat');
                }
            }

            if (bar) {
                bar.classList.toggle('yt-cinema-loop-bar-visible', mode !== 'off');
            }

            if (fill) {
                const { video } = ctx.getPlayerElements();
                const duration = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                if (mode === 'point-a' && loopStart !== null && duration > 0) {
                    fill.style.left = `${Math.min(98, (loopStart / duration) * 100)}%`;
                    fill.style.width = '2%';
                } else if (mode === 'looping' && loopStart !== null && loopEnd !== null && duration > 0) {
                    const leftPct = Math.max(0, Math.min(99, (loopStart / duration) * 100));
                    const widthPct = Math.max(1, Math.min(100 - leftPct, ((loopEnd - loopStart) / duration) * 100));
                    fill.style.left = `${leftPct}%`;
                    fill.style.width = `${widthPct}%`;
                } else {
                    fill.style.left = '';
                    fill.style.width = '';
                }
            }
        }

        function checkLoop(targetVideo) {
            const video = targetVideo || ctx.getPlayerElements().video;
            if (!video) return false;
            if (repeatAll && !video.loop) video.loop = true;

            if (mode !== 'looping' || loopStart === null || loopEnd === null) return false;
            if (typeof video.currentTime === 'number' && video.currentTime >= loopEnd) {
                video.currentTime = loopStart;
                return true;
            }
            return false;
        }

        function cycleABLoop() {
            const video = ensureVideoListener() || ctx.getPlayerElements().video;
            if (!video || typeof video.currentTime !== 'number') {
                ctx.toast?.show('Video player not ready for A-B loop', icons.loop);
                return getState();
            }

            if (mode === 'off') {
                loopStart = Math.max(0, video.currentTime);
                loopEnd = null;
                mode = 'point-a';
                render();
                ctx.toast?.show(`Loop point A set at ${formatSec(loopStart)}`, icons.loop);
                ctx.autohide?.reset();
                return getState();
            }

            if (mode === 'point-a') {
                const end = video.currentTime;
                if (end <= loopStart + MIN_SEGMENT_SECONDS) {
                    ctx.toast?.show('Move past Point A before setting Point B', icons.loop);
                    ctx.autohide?.reset();
                    return getState();
                }
                loopEnd = end;
                mode = 'looping';
                render();
                ctx.toast?.show(`Looping ${formatSec(loopStart)} – ${formatSec(loopEnd)}`, icons.loop);
                ctx.autohide?.reset();
                return getState();
            }

            mode = 'off';
            loopStart = null;
            loopEnd = null;
            render();
            ctx.toast?.show('A-B loop cleared', icons.loop);
            ctx.autohide?.reset();
            return getState();
        }

        function toggleRepeatAll(force) {
            repeatAll = typeof force === 'boolean' ? force : !repeatAll;
            const video = ensureVideoListener() || ctx.getPlayerElements().video;
            if (video) video.loop = repeatAll;
            render();
            ctx.toast?.show(repeatAll ? 'Repeat video: ON' : 'Repeat video: OFF', icons.loop);
            ctx.autohide?.reset();
            return repeatAll;
        }

        function getState() {
            return { mode, loopStart, loopEnd, repeatAll };
        }

        function resetForNewVideo() {
            mode = 'off';
            loopStart = null;
            loopEnd = null;
            repeatAll = false;
            const { video } = ctx.getPlayerElements();
            if (video) video.loop = false;
            detachVideoListener();
            render();
        }

        function onLoopClick(e) {
            e.stopPropagation();
            if (e.shiftKey) toggleRepeatAll();
            else cycleABLoop();
        }

        function bind() {
            els.loopBtn?.addEventListener('click', onLoopClick);
            ensureVideoListener();
            render();
        }

        function dispose() {
            els.loopBtn?.removeEventListener('click', onLoopClick);
            resetForNewVideo();
        }

        return { bind, cycleABLoop, toggleRepeatAll, checkLoop, getState, resetForNewVideo, dispose };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.loop = { createLoopControl };
})(globalThis.YTC);
