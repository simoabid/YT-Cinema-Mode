/**
 * Tests for content/content.js — the page-level trigger layer.
 *
 * These load the real bootstrap on top of the modules and drive it through the
 * DOM, covering the flows that previously had no coverage: hover tracking,
 * the hotkey, both mouse triggers, the typing guard, the global command, and
 * background video pause/resume around an overlay's lifetime.
 */

const { loadExtension, makeEvent } = require('./harness');

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function setupPage() {
    const env = loadExtension({}, { boot: true });
    const { document } = env;

    const card = document.createElement('ytd-rich-item-renderer');
    const link = document.createElement('a');
    link.id = 'thumbnail';
    link.setAttribute('href', 'https://www.youtube.com/watch?v=abc123');
    const title = document.createElement('span');
    title.id = 'video-title';
    title.textContent = 'Test Video';
    card.appendChild(link);
    card.appendChild(title);
    document.body.appendChild(card);

    return { env, document, card, link };
}

function hover(document, link) {
    document.dispatchEvent(makeEvent('mouseover', { target: link }));
}

function pressKey(target, key, props = {}) {
    target.dispatchEvent(makeEvent('keydown', {
        key,
        code: key === ' ' ? 'Space' : '',
        repeat: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        ...props
    }));
}

function openOverlays(document) {
    return document.querySelectorAll('.yt-cinema-overlay');
}

describe('hover and hotkey', () => {
    it('opens the hovered video with the configured hotkey', () => {
        const { env, document, link } = setupPage();

        hover(document, link);
        if (env.YTC.state.currentTarget !== link) throw new Error('hover did not track the thumbnail');

        pressKey(document, ' ');

        const overlay = env.YTC.state.activeModalOverlay;
        if (!overlay) throw new Error('the hotkey did not open an overlay');
        if (overlay.dataset.videoId !== 'abc123') {
            throw new Error(`opened the wrong video: ${overlay.dataset.videoId}`);
        }
        if (openOverlays(document).length !== 1) throw new Error('expected exactly one overlay');
    });

    it('still tracks the thumbnail when the indicator is disabled', () => {
        const { env, document, link } = setupPage();
        env.YTC.applySettings({ showIndicator: false });

        hover(document, link);

        if (env.YTC.state.currentTarget !== link) {
            throw new Error('hotkey target was not tracked with the indicator off');
        }
        if (document.querySelector('.yt-cinema-hover-indicator')) {
            throw new Error('the hover badge was created while disabled');
        }

        pressKey(document, ' ');

        if (!env.YTC.state.activeModalOverlay) throw new Error('the hotkey stopped working');
    });

    it('ignores the hotkey while typing in an input', () => {
        const { env, document, link } = setupPage();

        const input = document.createElement('input');
        document.body.appendChild(input);
        document.activeElement = input;

        hover(document, link);
        pressKey(document, ' ');

        if (env.YTC.state.activeModalOverlay) throw new Error('hotkey fired while typing');
    });

    it('ignores auto-repeat keydowns', () => {
        const { env, document, link } = setupPage();

        hover(document, link);
        pressKey(document, ' ', { repeat: true });

        if (env.YTC.state.activeModalOverlay) throw new Error('a repeat keydown opened the overlay');
    });

    it('opens from a click on the hover badge', async () => {
        const { env, document, link } = setupPage();

        hover(document, link);
        await wait();

        const badge = document.querySelector('.yt-cinema-hover-indicator');
        if (!badge) throw new Error('hover badge was never created');
        if (!badge.classList.contains('yt-cinema-hover-visible')) {
            throw new Error('hover badge should be visible while hovering');
        }

        badge.dispatchEvent(makeEvent('click'));

        if (!env.YTC.state.activeModalOverlay) throw new Error('clicking the badge did not open an overlay');
    });
});

describe('mouse triggers', () => {
    it('opens an alt-clicked thumbnail', () => {
        const { env, document, link } = setupPage();

        document.dispatchEvent(makeEvent('click', { altKey: true, button: 0, target: link }));

        if (!env.YTC.state.activeModalOverlay) throw new Error('Alt+Click did not open an overlay');
    });

    it('ignores alt-clicks when the trigger is disabled', () => {
        const { env, document, link } = setupPage();
        env.YTC.applySettings({ altClickTrigger: false });

        document.dispatchEvent(makeEvent('click', { altKey: true, button: 0, target: link }));

        if (env.YTC.state.activeModalOverlay) throw new Error('disabled Alt+Click still fired');
    });

    it('opens a middle-clicked thumbnail only when enabled', () => {
        const disabled = setupPage();
        disabled.document.dispatchEvent(makeEvent('auxclick', { button: 1, target: disabled.link }));
        if (disabled.env.YTC.state.activeModalOverlay) {
            throw new Error('middle-click fired while disabled');
        }

        const enabled = setupPage();
        enabled.env.YTC.applySettings({ middleClickTrigger: true });
        enabled.document.dispatchEvent(makeEvent('auxclick', { button: 1, target: enabled.link }));

        if (!enabled.env.YTC.state.activeModalOverlay) throw new Error('middle-click did not open an overlay');
    });
});

describe('global command', () => {
    it('opens the hovered video and closes the overlay again', () => {
        const { env, document, link } = setupPage();

        hover(document, link);
        env.emitMessage({ action: 'toggle-cinema' });

        if (!env.YTC.state.activeModalOverlay) throw new Error('the command did not open an overlay');

        env.emitMessage({ action: 'toggle-cinema' });

        if (env.YTC.state.activeModalOverlay) throw new Error('the command did not close the overlay');
    });
});

describe('overlay lifetime', () => {
    it('pauses the page video on open and resumes it on close', () => {
        const { env, document, link } = setupPage();

        let plays = 0;
        const pageVideo = document.createElement('video');
        pageVideo.paused = false;
        pageVideo.ended = false;
        pageVideo.readyState = 4;
        pageVideo.pause = () => { pageVideo.paused = true; };
        pageVideo.play = () => {
            plays++;
            pageVideo.paused = false;
            return Promise.resolve();
        };
        document.body.appendChild(pageVideo);

        hover(document, link);
        pressKey(document, ' ');

        if (!pageVideo.paused) throw new Error('background video was not paused');

        env.window.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));

        if (env.YTC.state.activeModalOverlay) throw new Error('Escape did not close the overlay');
        if (plays !== 1) throw new Error(`background video should have resumed once, got ${plays}`);
    });

    it('closes when the backdrop outside the container is clicked', () => {
        const { env, document, link } = setupPage();

        hover(document, link);
        pressKey(document, ' ');

        const overlay = env.YTC.state.activeModalOverlay;
        if (!overlay) throw new Error('precondition: overlay should be open');

        overlay.dispatchEvent(makeEvent('click', { target: overlay }));

        if (env.YTC.state.activeModalOverlay) throw new Error('backdrop click did not close the overlay');
    });
});
