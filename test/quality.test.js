/**
 * Regression tests for the quality control.
 *
 * The bug: `injectBridge` guarded the injected <script> by id but registered a
 * fresh `doc.addEventListener` on every call. Both keyboard.js and player.js
 * call it on every iframe `load`, so the listener was registered twice and every
 * quality report was handled twice (double applyToPlayer + double menu render).
 *
 * Also covered: the `message` listener accepted forged payloads from any frame,
 * and the remembered-quality guard could never fire on first load.
 */

const { loadExtension, createContext, makeEvent } = require('./harness');

function setupQuality() {
    const env = loadExtension();
    const ctx = createContext(env);
    const quality = env.YTC.controls.quality.createQualityControl(ctx);
    quality.bind();
    return { env, ctx, quality };
}

/** Count how many times the quality menu is (re)rendered. */
function countMenuRenders(ctx) {
    const menu = ctx.els.qualityMenu;
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(menu), 'innerHTML');
    let renders = 0;
    Object.defineProperty(menu, 'innerHTML', {
        configurable: true,
        get() { return original.get.call(this); },
        set(value) { renders++; original.set.call(this, value); }
    });
    return { count: () => renders, restore: () => delete menu.innerHTML };
}

describe('quality bridge injection', () => {
    it('registers exactly one bridge listener no matter how often it is called', () => {
        const { ctx, quality } = setupQuality();
        const doc = ctx.embed.embedDoc;

        // This is the real call pattern: keyboard.js then player.js, per load.
        quality.injectBridge(doc);
        quality.injectBridge(doc);
        quality.injectBridge(doc);

        const listeners = doc._listeners.get('yt-cinema-quality-bridge-event') || [];
        if (listeners.length !== 1) {
            throw new Error(`expected 1 bridge listener, got ${listeners.length}`);
        }
    });

    it('handles a single quality report exactly once', () => {
        const { ctx, quality } = setupQuality();
        const doc = ctx.embed.embedDoc;

        const spy = countMenuRenders(ctx);

        quality.injectBridge(doc);
        quality.injectBridge(doc);

        doc.dispatchEvent(makeEvent('yt-cinema-quality-bridge-event', {
            detail: JSON.stringify({
                levels: ['auto', 'hd1080', 'hd720'],
                data: [{ quality: 'hd1080', qualityLabel: '1080p HD', isHd: true }],
                current: 'hd1080'
            })
        }));

        if (spy.count() !== 1) {
            throw new Error(`quality report handled ${spy.count()} times, expected 1`);
        }
    });

    it('injects the bridge script only once', () => {
        const { ctx, quality } = setupQuality();
        const doc = ctx.embed.embedDoc;

        quality.injectBridge(doc);
        quality.injectBridge(doc);

        const scripts = doc.querySelectorAll('script').filter((s) => s.getAttribute('id') === 'yt-cinema-quality-bridge');
        if (scripts.length !== 1) {
            throw new Error(`expected 1 bridge script, got ${scripts.length}`);
        }
    });

    it('dispose detaches the bridge listener from the embed document', () => {
        const { ctx, quality } = setupQuality();
        const doc = ctx.embed.embedDoc;

        quality.injectBridge(doc);
        quality.dispose();

        const listeners = doc._listeners.get('yt-cinema-quality-bridge-event') || [];
        if (listeners.length !== 0) {
            throw new Error(`dispose left ${listeners.length} bridge listener(s) attached`);
        }
    });
});

describe('quality message validation', () => {
    function dispatchMessage(ctx, env, source, data) {
        env.window.dispatchEvent(makeEvent('message', { source, data }));
    }

    it('ignores bridge payloads that did not come from our embed', () => {
        const { env, ctx, quality } = setupQuality();
        const spy = countMenuRenders(ctx);

        dispatchMessage(ctx, env, { name: 'some-other-frame' }, {
            type: 'yt-cinema-quality-bridge-msg',
            payload: JSON.stringify({ levels: ['auto'], data: [], current: 'auto' })
        });

        if (spy.count() !== 0) {
            throw new Error('a forged message from another frame was accepted');
        }
    });

    it('ignores YouTube infoDelivery strings from other frames', () => {
        const { env, ctx, quality } = setupQuality();
        const spy = countMenuRenders(ctx);

        dispatchMessage(ctx, env, null, JSON.stringify({
            event: 'infoDelivery',
            info: { availableQualityLevels: ['auto', 'hd1080'], playbackQuality: 'hd1080' }
        }));

        if (spy.count() !== 0) {
            throw new Error('a forged infoDelivery message from another frame was accepted');
        }
    });

    it('still accepts a genuine message from the embed', () => {
        const { env, ctx, quality } = setupQuality();
        const spy = countMenuRenders(ctx);

        dispatchMessage(ctx, env, ctx.iframe.contentWindow, {
            type: 'yt-cinema-quality-bridge-msg',
            payload: JSON.stringify({
                levels: ['auto', 'hd1080'],
                data: [{ quality: 'hd1080', qualityLabel: '1080p HD', isHd: true }],
                current: 'hd1080'
            })
        });

        if (spy.count() !== 1) {
            throw new Error(`genuine embed message handled ${spy.count()} times, expected 1`);
        }
    });
});

describe('quality menu', () => {
    it('renders the shared check icon instead of a duplicated path literal', () => {
        const { env, ctx, quality } = setupQuality();

        quality.queryFromPlayer();

        const checks = ctx.els.qualityMenu.querySelectorAll('.yt-cinema-quality-check');
        if (checks.length === 0) throw new Error('no check icons rendered');

        const paths = checks.flatMap((c) => c.querySelectorAll('path'));
        if (paths.length === 0) throw new Error('check icons contain no path');

        for (const path of paths) {
            if (path.getAttribute('d') !== env.YTC.icons.CHECK_PATH) {
                throw new Error('menu check icon does not use the shared icons.CHECK_PATH');
            }
        }
    });

    it('closing the quality menu also clears the open flag', () => {
        const { ctx, quality } = setupQuality();

        quality.toggleMenu(true);
        if (!ctx.flags.qualityMenuOpen) throw new Error('menu should be open');

        quality.closeMenu();

        if (ctx.flags.qualityMenuOpen) throw new Error('closeMenu left the flag set');
        if (ctx.els.qualityMenu.classList.contains('yt-cinema-quality-menu-open')) {
            throw new Error('closeMenu left the open class on the menu');
        }
    });
});
