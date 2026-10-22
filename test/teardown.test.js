/**
 * Regression tests for overlay teardown.
 *
 * Three gaps: the quality menu was never closed on teardown (only the speed
 * menu was), so its open class and flag survived the whole close fade; and the
 * keyboard control's `dispose()` left the iframe `load` listener attached.
 */

const { loadExtension, buildOverlayDom, createEmbedDocument, createContext, makeEvent } = require('./harness');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CLOSE_FADE_MS = 300;

function setupOverlay() {
    const env = loadExtension();
    const base = createContext(env);

    // Go through the real controller so teardown runs the real closeOverlay
    // path, and use the context it builds (its own flags/controls, not stubs).
    const ctrl = env.YTC.controller.setupOverlayEvents(base.overlayElement, base.iframe, {
        videoId: 'testvid1',
        initialTimestamp: null,
        isShort: false,
        ambientCtx: null,
        ambientCanvas: null,
        ambientLayer: null,
        startDocked: false,
        isDirectPiP: false
    });

    return { env, ctx: ctrl, base };
}

describe('overlay teardown', () => {
    it('closes the quality menu as well as the speed menu', () => {
        const { env, ctx } = setupOverlay();

        ctx.flags.qualityMenuOpen = true;
        ctx.els.qualityMenu.classList.add('yt-cinema-quality-menu-open');
        ctx.flags.speedMenuOpen = true;
        ctx.els.speedMenu.classList.add('yt-cinema-speed-menu-open');

        ctx.overlayElement._close();

        if (ctx.flags.qualityMenuOpen) throw new Error('quality menu flag survived teardown');
        if (ctx.flags.speedMenuOpen) throw new Error('speed menu flag survived teardown');
        if (ctx.els.qualityMenu.classList.contains('yt-cinema-quality-menu-open')) {
            throw new Error('quality menu stayed open through the close fade');
        }
        if (ctx.els.speedMenu.classList.contains('yt-cinema-speed-menu-open')) {
            throw new Error('speed menu stayed open through the close fade');
        }
    });

    it('hides the toast instead of leaving it stuck during the fade', () => {
        const { ctx } = setupOverlay();

        ctx.toast.show('Something happened');

        ctx.overlayElement._close();

        if (ctx.els.toast.classList.contains('yt-cinema-toast-visible')) {
            throw new Error('toast stayed visible through the close fade');
        }
    });

    it('hides the volume HUD during teardown', () => {
        const { ctx } = setupOverlay();

        ctx.els.volumeHud.classList.add('yt-cinema-volume-hud-visible');

        ctx.overlayElement._close();

        if (ctx.els.volumeHud.classList.contains('yt-cinema-volume-hud-visible')) {
            throw new Error('volume HUD stayed visible through the close fade');
        }
    });

    it('detaches the window keydown listener', () => {
        const { env, ctx } = setupOverlay();
        const before = env.window.listenerCount('keydown');

        ctx.overlayElement._close();

        if (env.window.listenerCount('keydown') >= before) {
            throw new Error('the global keydown listener was not removed on teardown');
        }
    });

    it('detaches the iframe load listener', () => {
        const { env, ctx } = setupOverlay();
        const before = ctx.iframe.listenerCount('load');

        ctx.overlayElement._close();

        if (ctx.iframe.listenerCount('load') >= before) {
            throw new Error('the iframe load listener was not removed on teardown');
        }
    });

    it('removes the window message listener used by the quality bridge', () => {
        const { env, ctx } = setupOverlay();
        const before = env.window.listenerCount('message');

        ctx.overlayElement._close();

        if (env.window.listenerCount('message') >= before) {
            throw new Error('the quality message listener was not removed on teardown');
        }
    });

    it('removes the overlay from the document after the fade', async () => {
        const { ctx } = setupOverlay();
        const overlay = ctx.overlayElement;

        ctx.overlayElement._close();
        await wait(CLOSE_FADE_MS + 80);

        if (overlay.parentNode) {
            throw new Error('overlay was never removed from the document');
        }
    });

    it('tearing down twice is a no-op', async () => {
        const { ctx } = setupOverlay();

        ctx.overlayElement._close();
        ctx.overlayElement._close();

        await wait(CLOSE_FADE_MS + 80);
    });
});

describe('keyboard control', () => {
    it('dispose is safe to call more than once', () => {
        const { ctx } = setupOverlay();
        ctx.overlayElement._close();
    });

    it('stops reacting to keys after teardown', () => {
        const { env, ctx } = setupOverlay();

        ctx.close();

        let handled = false;
        env.window.dispatchEvent(makeEvent('keydown', { key: 'd', preventDefault() { handled = true; } }));

        if (handled) throw new Error('a keydown was still consumed after teardown');
    });
});
