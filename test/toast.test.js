/**
 * Regression tests for the toast control and `flashSuccess`.
 *
 * Two bugs: `clear()` cancelled the timer but never removed the visible class,
 * so the last toast hung on screen through the whole 300ms close fade; and
 * `flashSuccess` scheduled an independent restore timer per call, so two rapid
 * flashes (screenshot.js hits both branches) let the first timer revert the
 * button while the second feedback was still meant to be showing.
 */

const { loadExtension, createContext } = require('./harness');

const SUCCESS_FEEDBACK_MS = 1800;
const TOAST_VISIBLE_MS = 2400;

function setupToast() {
    const env = loadExtension();
    const ctx = createContext(env);
    const toast = env.YTC.controls.toast.createToastControl(ctx);
    return { env, ctx, toast };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('toast lifecycle', () => {
    it('shows the message and marks the toast visible', () => {
        const { ctx, toast } = setupToast();

        toast.show('Speed: 1.5x', '<svg/>');

        const text = ctx.els.toast.querySelector('.yt-cinema-toast-text');
        if (text.textContent !== 'Speed: 1.5x') throw new Error(`wrong text: ${text.textContent}`);
        if (!ctx.els.toast.classList.contains('yt-cinema-toast-visible')) {
            throw new Error('toast should be visible');
        }
    });

    it('hides itself after the visible timeout', async () => {
        const { ctx, toast } = setupToast();

        toast.show('Transient');
        await wait(TOAST_VISIBLE_MS + 60);

        if (ctx.els.toast.classList.contains('yt-cinema-toast-visible')) {
            throw new Error('toast did not auto-hide');
        }
    });

    it('clear hides the toast immediately instead of only cancelling the timer', async () => {
        const { ctx, toast } = setupToast();

        toast.show('Stuck message');
        if (!ctx.els.toast.classList.contains('yt-cinema-toast-visible')) {
            throw new Error('precondition: toast should be visible');
        }

        toast.clear();

        if (ctx.els.toast.classList.contains('yt-cinema-toast-visible')) {
            throw new Error('clear() left the toast visible through the close fade');
        }

        // And the cancelled timer must not fire against a later toast.
        toast.show('Second message');
        await wait(TOAST_VISIBLE_MS + 60);
        if (ctx.els.toast.classList.contains('yt-cinema-toast-visible')) {
            throw new Error('a stale timer from before clear() hid the new toast early');
        }
    });

    it('clear is safe to call when nothing is showing', () => {
        const { toast } = setupToast();
        toast.clear();
        toast.clear();
    });
});

describe('flashSuccess', () => {
    function makeButton() {
        const env = loadExtension();
        const btn = env.document.createElement('button');
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
        btn.setAttribute('title', 'Original Tooltip');
        return { env, btn };
    }

    it('swaps in a check icon and restores afterwards', async () => {
        const { env, btn } = makeButton();
        const { flashSuccess } = env.YTC.controls.toast;

        flashSuccess(btn, 'Original Tooltip', 'Done!');

        if (!btn.classList.contains('yt-cinema-copied')) throw new Error('button not marked as copied');
        if (btn.getAttribute('title') !== 'Done!') throw new Error('tooltip not swapped');
        const mainIcon = btn.querySelectorAll('svg').find((s) => !s.classList.contains('yt-cinema-copied-svg'));
        if (mainIcon.style.display !== 'none') throw new Error('original icon should be hidden');

        await wait(SUCCESS_FEEDBACK_MS + 80);

        if (btn.classList.contains('yt-cinema-copied')) throw new Error('button not restored');
        if (btn.getAttribute('title') !== 'Original Tooltip') throw new Error('tooltip not restored');
    });

    it('uses the shared check path rather than a hardcoded copy', () => {
        const { env, btn } = makeButton();
        env.YTC.controls.toast.flashSuccess(btn, 'Original', 'Done!');

        const path = btn.querySelectorAll('path').find((p) => p.getAttribute('d') === env.YTC.icons.CHECK_PATH);
        if (!path) throw new Error('flash icon does not use icons.CHECK_PATH');
    });

    it('two rapid flashes do not restore early', async () => {
        const { env, btn } = makeButton();
        const { flashSuccess } = env.YTC.controls.toast;

        flashSuccess(btn, 'Original Tooltip', 'Screenshot saved!');
        await wait(900);
        flashSuccess(btn, 'Original Tooltip', 'Copied to clipboard!');

        // The first timer would fire at ~1800ms from the first call.
        await wait(1000);

        if (!btn.classList.contains('yt-cinema-copied')) {
            throw new Error('first restore timer fired while the second feedback was still showing');
        }
        if (btn.getAttribute('title') !== 'Copied to clipboard!') {
            throw new Error(`tooltip was reverted early: ${btn.getAttribute('title')}`);
        }

        // The second flash still expires on its own schedule.
        await wait(SUCCESS_FEEDBACK_MS);
        if (btn.classList.contains('yt-cinema-copied')) throw new Error('second flash never expired');
    });

    it('tolerates a null button', () => {
        const { env } = makeButton();
        env.YTC.controls.toast.flashSuccess(null, 'a', 'b');
    });
});
