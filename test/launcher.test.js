/**
 * Tests for the launcher — the single decision point every trigger calls.
 */

const { loadExtension } = require('./harness');

function makeLink(env, href, title = null) {
    const link = env.document.createElement('a');
    link.setAttribute('href', href);
    if (title) link.setAttribute('title', title);
    return link;
}

function captureOverlayCalls(env) {
    const calls = [];
    env.YTC.overlay.createOverlay = (...args) => calls.push(args);
    return calls;
}

describe('launcher openFromLink', () => {
    it('rejects links that carry no video id', () => {
        const env = loadExtension();

        for (const href of ['', 'https://www.youtube.com/feed/subscriptions']) {
            const launched = env.YTC.launcher.openFromLink(makeLink(env, href));
            if (launched) throw new Error(`launched a non-video link: ${href}`);
        }
        if (env.YTC.launcher.openFromLink(null)) throw new Error('launched a null link');
    });

    it('passes the video id, title, timestamp and aspect data through', () => {
        const env = loadExtension();
        const calls = captureOverlayCalls(env);

        const launched = env.YTC.launcher.openFromLink(
            makeLink(env, 'https://www.youtube.com/watch?v=vid123&t=1m30s', 'My Clip')
        );

        if (!launched) throw new Error('a valid watch link was rejected');
        const [videoId, title, timestamp, isVertical, ratio, startDocked] = calls[0];
        if (videoId !== 'vid123') throw new Error(`wrong video id: ${videoId}`);
        if (title !== 'My Clip') throw new Error(`wrong title: ${title}`);
        if (timestamp !== '1m30s') throw new Error(`wrong timestamp: ${timestamp}`);
        if (isVertical !== false) throw new Error('a horizontal video was marked vertical');
        if (typeof ratio !== 'number') throw new Error('aspect ratio was not passed');
        if (startDocked !== false) throw new Error('link launches should default to modal');
    });

    it('routes direct-PiP launches to the PiP entry point', () => {
        const env = loadExtension();
        const calls = [];
        env.YTC.overlay.openDirectPictureInPicture = (...args) => calls.push(args);

        env.YTC.launcher.openFromLink(
            makeLink(env, 'https://www.youtube.com/watch?v=vid123', 'Clip'),
            { useDirectPiP: true }
        );

        if (calls.length !== 1) throw new Error('direct PiP was not selected');
        if (calls[0][0] !== 'vid123') throw new Error(`wrong PiP video: ${calls[0][0]}`);
    });

    it('resumes from locally saved progress when the link has no timestamp', () => {
        const env = loadExtension();
        const calls = captureOverlayCalls(env);
        env.YTC.progress.save('vid123', 65000, 600000);

        env.YTC.launcher.openFromLink(
            makeLink(env, 'https://www.youtube.com/watch?v=vid123', 'Clip')
        );

        if (calls[0][2] !== '65') {
            throw new Error(`expected resume timestamp 65, got ${calls[0][2]}`);
        }
    });

    it('lets an explicit link timestamp win over saved progress', () => {
        const env = loadExtension();
        const calls = captureOverlayCalls(env);
        env.YTC.progress.save('vid123', 65000, 600000);

        env.YTC.launcher.openFromLink(
            makeLink(env, 'https://www.youtube.com/watch?v=vid123&t=30s', 'Clip')
        );

        if (calls[0][2] !== '30s') {
            throw new Error(`link timestamp was replaced: ${calls[0][2]}`);
        }
    });

    it('honours the startDocked option', () => {
        const env = loadExtension();
        const calls = captureOverlayCalls(env);

        env.YTC.launcher.openFromLink(
            makeLink(env, 'https://www.youtube.com/watch?v=vid123', 'Clip'),
            { startDocked: true }
        );

        if (calls[0][5] !== true) throw new Error('startDocked was not forwarded');
    });
});

describe('launcher openFromPage', () => {
    it('returns false when the page is not showing a video', () => {
        const env = loadExtension();
        const calls = captureOverlayCalls(env);

        if (env.YTC.launcher.openFromPage()) throw new Error('launched from a non-video page');
        if (calls.length !== 0) throw new Error('created an overlay without a video id');
    });

    it('uses the current playback position as the timestamp', () => {
        const env = loadExtension();
        const { window, document } = env;
        window.location.href = 'https://www.youtube.com/watch?v=vid123';
        window.location.pathname = '/watch';

        const pageVideo = document.createElement('video');
        pageVideo.currentTime = 42;
        document.body.appendChild(pageVideo);

        const calls = captureOverlayCalls(env);
        const launched = env.YTC.launcher.openFromPage();

        if (!launched) throw new Error('failed to launch from a watch page');
        if (calls[0][0] !== 'vid123') throw new Error(`wrong video id: ${calls[0][0]}`);
        if (calls[0][2] !== '42') throw new Error(`wrong timestamp: ${calls[0][2]}`);
    });

    it('can require a watch-like path', () => {
        const env = loadExtension();
        const { window } = env;
        window.location.href = 'https://www.youtube.com/';
        window.location.pathname = '/';

        if (env.YTC.launcher.openFromPage({ requireWatchPath: true })) {
            throw new Error('requireWatchPath accepted the home page');
        }
    });

    it('recognizes watch and shorts paths', () => {
        const env = loadExtension();
        const { window } = env;

        window.location.pathname = '/watch';
        if (!env.YTC.launcher.isWatchLikePath()) throw new Error('/watch was not recognized');

        window.location.pathname = '/shorts/abc';
        if (!env.YTC.launcher.isWatchLikePath()) throw new Error('/shorts was not recognized');

        window.location.pathname = '/feed/subscriptions';
        if (env.YTC.launcher.isWatchLikePath()) throw new Error('/feed was treated as a watch page');
    });
});
