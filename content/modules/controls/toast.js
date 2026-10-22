/**
 * Toast control — in-overlay notifications plus the shared "action succeeded"
 * button flash used by Copy Link and Screenshot.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;

    const SUCCESS_FEEDBACK_MS = 1800;
    const TOAST_VISIBLE_MS = 2400;

    function createToastControl(ctx) {
        const toast = ctx.els.toast;
        let timer = null;

        function show(message, iconSvg = '') {
            if (!toast) return;
            const textEl = toast.querySelector('.yt-cinema-toast-text');
            const iconEl = toast.querySelector('.yt-cinema-toast-icon');
            if (textEl) textEl.textContent = message;
            if (iconEl) iconEl.innerHTML = iconSvg;
            toast.classList.add('yt-cinema-toast-visible');

            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                toast.classList.remove('yt-cinema-toast-visible');
            }, TOAST_VISIBLE_MS);
        }

        function clear() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            toast?.classList.remove('yt-cinema-toast-visible');
        }

        return { show, clear };
    }

    /** One pending restore per button, so a second flash cancels the first. */
    const flashTimers = new WeakMap();

    /**
     * Swap a button's icon for a check mark, then restore it.
     * Shared by Copy Link and Screenshot so the feedback looks identical.
     */
    function flashSuccess(btn, originalTitle, feedbackTitle) {
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
            path.setAttribute('d', icons.CHECK_PATH);
            checkIcon.appendChild(path);
            btn.appendChild(checkIcon);
        }
        if (mainIcon) mainIcon.style.display = 'none';
        checkIcon.style.display = 'inline-block';

        // Re-entrant calls (screenshot.js flashes on both branches) must not
        // let the earlier timer restore the button mid-feedback.
        if (flashTimers.has(btn)) clearTimeout(flashTimers.get(btn));
        flashTimers.set(btn, setTimeout(() => {
            flashTimers.delete(btn);
            btn.classList.remove('yt-cinema-copied');
            btn.setAttribute('title', originalTitle);
            checkIcon.style.display = 'none';
            if (mainIcon) mainIcon.style.display = 'inline-block';
        }, SUCCESS_FEEDBACK_MS));
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.toast = { createToastControl, flashSuccess };
})(globalThis.YTC);
