/**
 * Regression tests for the navigation control.
 *
 * The bug: `recordNavigation` updated only `ctx.currentVideoId`, while
 * `loadVideo` also mirrored onto `overlayElement.dataset.videoId`,
 * `_currentVideoId` and `_isShort`. player.js builds the restricted-embed
 * fallback URL from `_currentVideoId`, so after an embed-side autoplay jump the
 * "Playback Restricted" card offered the previous video's link.
 */

const { loadExtension, createContext } = require('./harness');

function setupNavigation() {
    const env = loadExtension();
    const ctx = createContext(env);
    const navigation = env.YTC.controls.navigation.createNavigationControl(ctx);

    // Stand in for the identity mirrors createOverlay writes.
    ctx.overlayElement.dataset.videoId = 'first111';
    ctx.overlayElement._currentVideoId = 'first111';
    ctx.overlayElement._isShort = false;
    ctx.currentVideoId = 'first111';
    ctx.overlayElement._isWatchFallback = true;

    return { env, ctx, navigation };
}

describe('navigation recordNavigation', () => {
    it('mirrors the new id onto the overlay, not just the ctx', () => {
        const { ctx, navigation } = setupNavigation();

        navigation.recordNavigation('second22', 'Second Video', false);

        if (ctx.currentVideoId !== 'second22') throw new Error('ctx.currentVideoId not updated');
        if (ctx.overlayElement._currentVideoId !== 'second22') {
            throw new Error(`overlayElement._currentVideoId is stale: ${ctx.overlayElement._currentVideoId}`);
        }
        if (ctx.overlayElement.dataset.videoId !== 'second22') {
            throw new Error(`dataset.videoId is stale: ${ctx.overlayElement.dataset.videoId}`);
        }
    });

    it('builds the restricted-embed fallback from the CURRENT video', () => {
        const { env, ctx, navigation } = setupNavigation();

        navigation.recordNavigation('third333', 'Third Video', false);

        // This is exactly what player.js passes to buildPlayerUrl.
        const url = env.YTC.video.buildPlayerUrl(
            ctx.overlayElement._currentVideoId,
            ctx.overlayElement._isShort,
            null,
            false
        );

        if (!url.includes('v=third333')) {
            throw new Error(`fallback URL points at the wrong video: ${url}`);
        }
    });

    it('tracks the vertical flag so the Shorts badge and layout stay in sync', () => {
        const { ctx, navigation } = setupNavigation();

        navigation.recordNavigation('short444', 'A Short', true);

        if (ctx.overlayElement._isShort !== true) {
            throw new Error('_isShort was not mirrored');
        }

        const badge = ctx.overlayElement.querySelector('.yt-cinema-shorts-badge');
        if (!badge) throw new Error('Shorts badge should have been added');
    });

    it('updates the header title and its tooltip', () => {
        const { ctx, navigation } = setupNavigation();

        navigation.recordNavigation('fourth55', 'Brand New Title', false);

        const title = ctx.overlayElement.querySelector('.yt-cinema-title-text');
        if (title.textContent !== 'Brand New Title') {
            throw new Error(`title not updated: ${title.textContent}`);
        }
        if (title.getAttribute('title') !== 'Brand New Title') {
            throw new Error('title tooltip not updated');
        }
    });

    it('never reassigns iframe.src (that would restart the navigation)', () => {
        const { ctx, navigation } = setupNavigation();
        const before = ctx.iframe.src;

        navigation.recordNavigation('fifth666', 'Fifth', false);

        if (ctx.iframe.src !== before) {
            throw new Error(`iframe.src was reassigned: ${before} -> ${ctx.iframe.src}`);
        }
    });

    it('ignores a re-navigation to the video already playing', () => {
        const { ctx, navigation } = setupNavigation();
        const before = ctx.overlayElement.querySelector('.yt-cinema-title-text').textContent;

        navigation.recordNavigation('first111', 'Should Be Ignored', false);

        const title = ctx.overlayElement.querySelector('.yt-cinema-title-text');
        if (title.textContent !== before) {
            throw new Error(`a no-op navigation must not touch the header: ${title.textContent}`);
        }
    });

    it('ignores an empty id', () => {
        const { ctx, navigation } = setupNavigation();

        navigation.recordNavigation(null, 'Nothing', false);
        navigation.recordNavigation(undefined, 'Nothing', false);

        if (ctx.currentVideoId !== 'first111') throw new Error('empty id overwrote currentVideoId');
    });

    it('tells the history control that the video changed', () => {
        const { ctx, navigation } = setupNavigation();
        const before = ctx.history.changed;

        navigation.recordNavigation('second22', 'Second Video', false);

        if (ctx.history.changed !== before + 1) {
            throw new Error(`expected one history change, got ${ctx.history.changed - before}`);
        }
    });

    it('resets the quality control so the saved quality applies to each new video', () => {
        const { ctx, navigation } = setupNavigation();
        const before = ctx.quality.resets;

        navigation.recordNavigation('second22', 'Second Video', false);

        if (ctx.quality.resets !== before + 1) {
            throw new Error(`expected one quality reset, got ${ctx.quality.resets - before}`);
        }
    });

    it('does not reset quality when the navigation is a no-op', () => {
        const { ctx, navigation } = setupNavigation();
        const before = ctx.quality.resets;

        navigation.recordNavigation('first111', 'Same Video', false);
        navigation.recordNavigation(null, 'Nothing', false);

        if (ctx.quality.resets !== before) {
            throw new Error('no-op navigation reset the quality control');
        }
    });

    it('pushes the previous video onto history so Prev still works', () => {
        const { ctx, navigation } = setupNavigation();

        navigation.recordNavigation('sixth888', 'Sixth', false);
        navigation.recordNavigation('seventh99', 'Seventh', false);
        navigation.playPrevious();

        if (ctx.currentVideoId !== 'sixth888') {
            throw new Error(`Prev went to ${ctx.currentVideoId}, expected sixth888`);
        }
        if (!ctx.iframe.src.includes('/embed/sixth888')) {
            throw new Error(`Prev should load the previous video: ${ctx.iframe.src}`);
        }
    });
});
