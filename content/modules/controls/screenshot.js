/**
 * Screenshot control — captures the current video frame to a PNG, either as a
 * download or straight into the clipboard (Shift+click / Shift+S).
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;
    const flashSuccess = YTC.controls.toast.flashSuccess;

    const SHUTTER_FLASH_MS = 40;
    const DOWNLOAD_CLEANUP_MS = 600;
    const BUTTON_FEEDBACK_TITLE = 'Take Screenshot (S) • Shift+Click to Copy';
    const TITLE_MAX_LENGTH = 60;
    const MIN_READY_STATE = 2;

    function sanitizeFilename(title) {
        return title
            .replace(/[/\\?%*:|"<>]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, TITLE_MAX_LENGTH) || 'YouTube-Video';
    }

    function formatTimestamp(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
    }

    function createScreenshotControl(ctx) {
        const { overlayElement, els } = ctx;

        function flashShutter() {
            if (!els.shutterFlash) return;
            els.shutterFlash.classList.remove('flashing');
            void els.shutterFlash.offsetWidth; // restart the CSS animation
            els.shutterFlash.classList.add('flashing');
            setTimeout(() => els.shutterFlash.classList.remove('flashing'), SHUTTER_FLASH_MS);
        }

        function downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                link.remove();
                URL.revokeObjectURL(url);
            }, DOWNLOAD_CLEANUP_MS);
        }

        async function copyToClipboard(blob) {
            try {
                if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    return true;
                }
            } catch (err) {
                console.warn('[Cinema Mode] Clipboard write failed, falling back to download:', err);
            }
            return false;
        }

        async function takeScreenshot(copyToClipboardOnly = false) {
            let video = null;
            try {
                video = ctx.getPlayerElements().video;
            } catch (err) {
                console.warn('[Cinema Mode] Video element query failed:', err);
            }

            if (!video || video.readyState < MIN_READY_STATE) {
                ctx.toast.show('Video not ready to capture', icons.alertSmall);
                return;
            }

            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!width || !height) {
                ctx.toast.show('Unable to determine video resolution', icons.alertSmall);
                return;
            }

            try {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('2D context unavailable');

                context.drawImage(video, 0, 0, width, height);
                flashShutter();

                const rawTitle = overlayElement.querySelector('.yt-cinema-title-text')?.textContent?.trim() || 'YouTube Video';
                const filename = `${sanitizeFilename(rawTitle)} - ${formatTimestamp(Math.floor(video.currentTime || 0))}.png`;

                canvas.toBlob(async (blob) => {
                    if (!blob) {
                        ctx.toast.show('Failed to create image blob', icons.alertSmall);
                        return;
                    }

                    if (copyToClipboardOnly && await copyToClipboard(blob)) {
                        ctx.toast.show(`Copied frame to clipboard (${width}×${height})`, icons.successSmall);
                        flashSuccess(els.screenshotBtn, BUTTON_FEEDBACK_TITLE, 'Copied to clipboard!');
                        return;
                    }

                    downloadBlob(blob, filename);
                    ctx.toast.show(`Screenshot saved (${width}×${height})`, icons.successSmall);
                    flashSuccess(els.screenshotBtn, BUTTON_FEEDBACK_TITLE, 'Screenshot saved!');
                }, 'image/png');
            } catch (err) {
                console.error('[Cinema Mode] Screenshot capture failed:', err);
                ctx.toast.show('Error capturing frame', icons.alertSmall);
            }
        }

        function bind() {
            els.screenshotBtn?.addEventListener('click', (e) => takeScreenshot(e.shiftKey));
        }

        return { takeScreenshot, bind };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.screenshot = { createScreenshotControl };
})(globalThis.YTC);
