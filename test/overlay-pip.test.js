/**
 * Regression tests for the overlay.js direct-PiP path.
 *
 * The bug: `toggleNativePictureInPicture()` took no parameters but referenced
 * `title`, `videoId` and `timestamp`. Those threw ReferenceErrors, which (a)
 * killed the PiP->overlay fallback entirely and (b) escaped synchronously out
 * of the `ytp-pip-button` branch and aborted the caller's hotkey handler.
 */

const { loadExtension, buildOverlayDom } = require('./harness');

function setupPiPPage({ requestResult, hasPiPButton }) {
    const env = loadExtension();
    const { YTC, document, window } = env;

    const pageVideo = document.createElement('video');
    pageVideo.pictureInPictureEnabled = true;
    document.body.appendChild(pageVideo);
    pageVideo._connectedTo = true;

    if (hasPiPButton) {
        const btn = document.createElement('button');
        btn.className = 'ytp-pip-button';
        btn.clicked = 0;
        btn.click = () => { btn.clicked++; };
        document.body.appendChild(btn);
    }

    document.pictureInPictureEnabled = true;
    document.pictureInPictureElement = null;

    let pipCalls = 0;
    if (requestResult) {
        pageVideo.requestPictureInPicture = () => {
            pipCalls++;
            document.pictureInPictureElement = pageVideo;
            return requestResult;
        };
    }

    // Stand in for the page's own watch video so the "same page" branch is taken.
    window.location.href = 'https://www.youtube.com/watch?v=abc123';
    window.location.pathname = '/watch';

    return { env, YTC, document, window, pageVideo, getPipCalls: () => pipCalls };
}

describe('overlay direct PiP', () => {
    it('does not throw and shows a toast when native PiP succeeds', async () => {
        const { env, YTC, getPipCalls } = setupPiPPage({ requestResult: Promise.resolve(), hasPiPButton: false });

        YTC.overlay.openDirectPictureInPicture('abc123', 'My Video', '42');

        await new Promise((r) => setTimeout(r, 10));

        if (getPipCalls() !== 1) throw new Error(`expected 1 PiP request, got ${getPipCalls()}`);
        const toast = env.document.querySelector('.yt-cinema-page-toast');
        if (!toast) throw new Error('expected a page toast');
        if (!toast.textContent.includes('My Video')) throw new Error('toast missing the video title');
    });

    it('falls back to a docked overlay when PiP is rejected', async () => {
        const { YTC, document } = setupPiPPage({
            requestResult: Promise.reject(new Error('NotAllowedError')),
            hasPiPButton: false
        });

        YTC.overlay.openDirectPictureInPicture('abc123', 'Fallback Video', '99');
        await new Promise((r) => setTimeout(r, 10));

        const overlays = document.querySelectorAll('.yt-cinema-overlay');
        if (overlays.length !== 1) {
            throw new Error(`fallback overlay was never created (found ${overlays.length})`);
        }

        const overlay = overlays[0];
        if (overlay.dataset.videoId !== 'abc123') {
            throw new Error(`fallback overlay has wrong videoId: ${overlay.dataset.videoId}`);
        }
        if (!overlay.classList.contains('yt-cinema-docked')) {
            throw new Error('fallback overlay should be docked');
        }

        const title = overlay.querySelector('.yt-cinema-title-text');
        if (!title || title.textContent !== 'Fallback Video') {
            throw new Error(`fallback overlay has wrong title: ${title && title.textContent}`);
        }

        const iframe = overlay.querySelector('iframe');
        if (!iframe.src.includes('start=99')) {
            throw new Error(`timestamp was lost building the player URL: ${iframe.src}`);
        }
    });

    it('does not throw when falling back to the native YouTube PiP button', async () => {
        const { YTC, document } = setupPiPPage({ requestResult: null, hasPiPButton: true });

        YTC.overlay.openDirectPictureInPicture('abc123', 'Button Video', null);

        const btn = document.querySelector('.ytp-pip-button');
        if (btn.clicked !== 1) throw new Error(`expected the ytp button to be clicked once, got ${btn.clicked}`);

        const toast = document.querySelector('.yt-cinema-page-toast');
        if (!toast || !toast.textContent.includes('Button Video')) {
            throw new Error('toast should announce the title after clicking the PiP button');
        }
        if (document.querySelectorAll('.yt-cinema-overlay').length !== 0) {
            throw new Error('native PiP button path must not also open an overlay');
        }
    });

    it('opens a docked overlay for non-watch targets without touching PiP', async () => {
        const { YTC, window, document, getPipCalls } = setupPiPPage({
            requestResult: Promise.resolve(),
            hasPiPButton: false
        });
        window.location.href = 'https://www.youtube.com/';
        window.location.pathname = '/';

        YTC.overlay.openDirectPictureInPicture('xyz789', 'Hovered Thumb', null);

        if (getPipCalls() !== 0) throw new Error('hovered thumbnails must not hijack the page video for PiP');

        const overlays = document.querySelectorAll('.yt-cinema-overlay');
        if (overlays.length !== 1) {
            throw new Error(`hovered thumbnails should open a docked overlay (found ${overlays.length})`);
        }
        if (overlays[0].dataset.videoId !== 'xyz789') {
            throw new Error(`wrong videoId for hovered thumbnail: ${overlays[0].dataset.videoId}`);
        }
    });

    it('tolerates a null title in the PiP toast', async () => {
        const { YTC } = setupPiPPage({ requestResult: Promise.resolve(), hasPiPButton: false });
        YTC.overlay.openDirectPictureInPicture('abc123', null, null);
        await new Promise((r) => setTimeout(r, 10));
        // The old code did `title.slice(...)` and would have thrown here.
    });
});
