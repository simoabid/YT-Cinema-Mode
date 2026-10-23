/**
 * Tests for the watch-history reporter.
 *
 * The embed player is a WEB_EMBEDDED_PLAYER surface, which YouTube does not
 * count as a normal watch. The control mints a WEB player response and sends
 * the same playback/watchtime beacons the watch page sends (`el=detailpage`).
 */

const { loadExtension, createContext } = require('./harness');

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const YTCFG_SCRIPT = `ytcfg.set({
  "INNERTUBE_API_KEY": "test-api-key",
  "INNERTUBE_CLIENT_VERSION": "2.20261022.01.00",
  "STS": 20746,
  "LOGGED_IN": true,
  "SESSION_INDEX": "2",
  "USER_SESSION_ID": "test-user-session-id",
  "INNERTUBE_CONTEXT": {
    "client": {
      "hl": "en", "gl": "US", "visitorData": "test-visitor",
      "clientName": "WEB", "clientVersion": "2.20261022.01.00"
    },
    "user": { "lockedSafetyMode": false },
    "request": { "useSsl": true }
  }
});`;

function installYtcfg(env) {
    const script = env.document.createElement('script');
    script.textContent = YTCFG_SCRIPT;
    env.document.head.appendChild(script);
}

function trackingBase(kind, videoId) {
    return `https://s.youtube.com/api/stats/${kind}?cl=1&docid=${videoId}` +
        `&ei=test-ei&plid=test-plid&len=600&of=test-of&vm=test-vm&el=detailpage`;
}

function createFetchStub(requests) {
    return async (url, init = {}) => {
        url = String(url);
        requests.push({ url, init });

        if (url.includes('/youtubei/v1/player')) {
            let videoId = 'vid123';
            try { videoId = JSON.parse(init.body).videoId || videoId; } catch (_) {}
            const payload = {
                playbackTracking: {
                    videostatsPlaybackUrl: { baseUrl: trackingBase('playback', videoId) },
                    videostatsWatchtimeUrl: { baseUrl: trackingBase('watchtime', videoId) },
                    videostatsScheduledFlushWalltimeSeconds: [10, 20, 30],
                    videostatsDefaultFlushIntervalSeconds: 40
                },
                videoDetails: { lengthSeconds: '600' },
                responseContext: {
                    serviceTrackingParams: [
                        { service: 'GFEEDBACK', params: [{ key: 'logged_in', value: '1' }] }
                    ]
                }
            };
            return {
                ok: true,
                status: 200,
                json: async () => payload,
                text: async () => JSON.stringify(payload)
            };
        }

        return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    };
}

function setupHistory({ withYtcfg = true } = {}) {
    const requests = [];
    const authMessages = [];
    const env = loadExtension({ fetch: createFetchStub(requests) });
    if (withYtcfg) installYtcfg(env);
    env.chrome.runtime.sendMessage = async (message) => {
        authMessages.push(message);
        if (message.action !== 'yt-cinema-auth') return undefined;
        return {
            authorization: 'SAPISIDHASH 123_test_u SAPISID1PHASH 123_test_u SAPISID3PHASH 123_test_u',
            authUser: String(message.sessionIndex || '0'),
            origin: 'https://www.youtube.com',
            pageId: null
        };
    };

    const ctx = createContext(env);
    ctx.currentVideoId = 'vid123';
    ctx.overlayElement.dataset.videoId = 'vid123';
    ctx.embed.media.duration = 600;
    ctx.embed.media.currentTime = 30;
    ctx.embed.media.paused = false;
    ctx.embed.media.ended = false;
    ctx.embed.media.readyState = 4;

    const history = env.YTC.controls.history.createHistoryControl(ctx);
    const events = [];
    ctx.overlayElement.addEventListener('yt-cinema-history-status', (event) => events.push(event.detail));

    return { env, ctx, history, requests, events, authMessages };
}

function statsRequests(requests, kind) {
    return requests.filter((req) => req.url.includes(`/api/stats/${kind}`));
}

function lastStatsUrl(requests, kind) {
    const found = statsRequests(requests, kind);
    return found.length ? found[found.length - 1].url : null;
}

describe('history tracking mint', () => {
    it('requests a WEB player response and sends playback + watchtime beacons', async () => {
        const { history, requests, events, authMessages } = setupHistory();

        history.onPlaying();
        const ok = await history.flush();

        if (!ok) throw new Error('the first report did not succeed');

        const player = requests.find((req) => req.url.includes('/youtubei/v1/player'));
        if (!player) throw new Error('player tracking was never requested');
        if (player.init.method !== 'POST') throw new Error('player request must be a POST');
        if (player.init.credentials !== 'include') throw new Error('player request must include cookies');

        const body = JSON.parse(player.init.body);
        if (body.videoId !== 'vid123') throw new Error(`wrong video: ${body.videoId}`);
        if (body.context.client.clientName !== 'WEB') throw new Error('context is not a WEB client');
        if (body.playbackContext.contentPlaybackContext.el !== 'detailpage') {
            throw new Error('tracking was not minted for a detail-page watch');
        }
        if (body.playbackContext.contentPlaybackContext.signatureTimestamp !== 20746) {
            throw new Error('signature timestamp was not forwarded');
        }
        if (!/^[A-Za-z0-9_-]{16}$/.test(body.cpn)) throw new Error(`bad cpn: ${body.cpn}`);

        if (!authMessages.length) throw new Error('the auth helper was never asked for a signature');
        if (authMessages[0].sessionIndex !== '2') {
            throw new Error(`wrong session index: ${authMessages[0].sessionIndex}`);
        }
        if (authMessages[0].userSessionId !== 'test-user-session-id') {
            throw new Error('USER_SESSION_ID was not forwarded to the background');
        }
        if (player.init.headers.Authorization !== 'SAPISIDHASH 123_test_u SAPISID1PHASH 123_test_u SAPISID3PHASH 123_test_u') {
            throw new Error('player request is missing the authorization header');
        }
        if (player.init.headers['X-Goog-AuthUser'] !== '2') {
            throw new Error(`player request targets the wrong account: ${player.init.headers['X-Goog-AuthUser']}`);
        }
        if (player.init.headers['X-Origin'] !== 'https://www.youtube.com') {
            throw new Error('player request is missing X-Origin');
        }

        const playback = lastStatsUrl(requests, 'playback');
        const watchtime = lastStatsUrl(requests, 'watchtime');
        if (!playback || !watchtime) throw new Error('both videostats beacons must fire');
        if (!playback.startsWith('https://www.youtube.com/api/stats/playback')) {
            throw new Error(`playback beacon was not made same-origin: ${playback}`);
        }
        if (!watchtime.startsWith('https://www.youtube.com/api/stats/watchtime')) {
            throw new Error(`watchtime beacon was not made same-origin: ${watchtime}`);
        }
        for (const url of [playback, watchtime]) {
            if (!url.includes('el=detailpage')) throw new Error('beacon lost el=detailpage');
            if (url.includes('el=embedded')) throw new Error('beacon is attributed to an embedded watch');
            if (!url.includes('c=WEB')) throw new Error('beacon lost c=WEB');
            if (!url.includes(`cpn=${body.cpn}`)) throw new Error('beacon cpn does not match the mint');
            if (!url.includes('state=playing')) throw new Error('beacon is not marked as playing');
        }

        const statReq = requests.find((req) => req.url.includes('/api/stats/watchtime'));
        if (!statReq.init.headers || statReq.init.headers.Authorization !== player.init.headers.Authorization) {
            throw new Error('watchtime beacon is missing the authorization header');
        }
        if (statReq.init.headers['X-Goog-AuthUser'] !== '2') {
            throw new Error('watchtime beacon targets the wrong account');
        }
        if (statReq.init.headers['X-Goog-Visitor-Id'] !== 'test-visitor') {
            throw new Error('watchtime beacon is missing the visitor id');
        }
        if (!watchtime.includes('st=30') || !watchtime.includes('et=30')) {
            throw new Error(`watchtime window is wrong: ${watchtime}`);
        }

        if (events.length !== 1) throw new Error(`expected one status event, got ${events.length}`);
        if (events[0].status.some((status) => status !== 204)) {
            throw new Error(`unexpected beacon statuses: ${events[0].status}`);
        }
    });

    it('reuses one cpn and a progressing st/et window across pings', async () => {
        const { ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        const cpn = /cpn=([^&]+)/.exec(lastStatsUrl(requests, 'watchtime'))[1];

        ctx.embed.media.currentTime = 40;
        await history.flush();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch.includes(`cpn=${cpn}`)) throw new Error('a second cpn was minted mid-session');
        if (!watch.includes('st=30') || !watch.includes('et=40')) {
            throw new Error(`progress did not chain: ${watch}`);
        }
        if (requests.filter((req) => req.url.includes('/youtubei/v1/player')).length !== 1) {
            throw new Error('tracking was re-minted instead of reusing the session pair');
        }
    });

    it('does not report a skipped range as watch time after a seek', async () => {
        const { ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        requests.length = 0;

        ctx.embed.media.currentTime = 120;
        history.onSeeking();
        await history.flush();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch.includes('st=120') || !watch.includes('et=120')) {
            throw new Error(`seeked range was reported as watched: ${watch}`);
        }
    });

    it('saves local progress while reporting', async () => {
        const { env, ctx, history } = setupHistory();

        history.onPlaying();
        ctx.embed.media.currentTime = 42;
        await history.flush();

        const entry = env.YTC.progress.get('vid123');
        if (!entry || entry.position !== 42000) {
            throw new Error(`local progress not saved: ${JSON.stringify(entry)}`);
        }
    });
});

describe('history lifecycle', () => {
    it('sends a paused beacon without finalizing the session', async () => {
        const { ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        requests.length = 0;

        ctx.embed.media.paused = true;
        history.onPaused();
        await wait();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch) throw new Error('pause did not report');
        if (!watch.includes('state=paused')) throw new Error(`wrong pause state: ${watch}`);
        if (watch.includes('final=1')) throw new Error('a pause must not commit the entry as finished');
        if (!history.isActive()) throw new Error('pause ended the session instead of keeping it');
    });

    it('sends a final beacon at the duration and clears progress on end', async () => {
        const { env, ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        requests.length = 0;

        ctx.embed.media.currentTime = 600;
        ctx.embed.media.ended = true;
        history.onEnded();
        await wait();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch) throw new Error('end did not report');
        if (!watch.includes('state=ended')) throw new Error(`wrong end state: ${watch}`);
        if (!watch.includes('final=1')) throw new Error('the final watchtime marker is missing');
        if (!watch.includes('cmt=599')) throw new Error(`end should target the last second: ${watch}`);
        if (!watch.includes('st=0') || !watch.includes('et=599')) {
            throw new Error(`end is not marked like a completed watch: ${watch}`);
        }
        if (env.YTC.progress.get('vid123')) throw new Error('finished video should not offer resume progress');
        if (history.isActive()) throw new Error('session survived the end');
    });

    it('does not recreate resume progress after an end with no known duration', async () => {
        const { env, ctx, history } = setupHistory();

        ctx.embed.media.duration = NaN;
        history.onPlaying();
        await history.flush();
        if (!env.YTC.progress.get('vid123')) throw new Error('precondition: progress should be saved');

        ctx.embed.media.currentTime = 120;
        ctx.embed.media.ended = true;
        history.onEnded();
        await wait();

        if (env.YTC.progress.get('vid123')) {
            throw new Error('a finished video got a resume point again from the final beacon');
        }
    });

    it('keeps a looping Short in one reporting session at its end', async () => {
        const { ctx, history } = setupHistory();
        ctx.isShort = true;

        history.onPlaying();
        await history.flush();
        ctx.embed.media.ended = true;
        history.onEnded();

        if (!history.isActive()) throw new Error('a looping Short was finalized at its loop point');
        history.stop();
    });

    it('commits the current position when the overlay is closed', async () => {
        const { env, ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        requests.length = 0;

        ctx.embed.media.currentTime = 120;
        history.stop();
        await wait();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch) throw new Error('close did not send a final beacon');
        if (!watch.includes('state=ended')) throw new Error('close beacon is not final');
        if (!watch.includes('cmt=120')) throw new Error(`close reported the wrong position: ${watch}`);
        if (!watch.includes('st=30') || !watch.includes('et=120')) {
            throw new Error(`mid-video close lost its progress window: ${watch}`);
        }

        const entry = env.YTC.progress.get('vid123');
        if (!entry || entry.position !== 120000) {
            throw new Error(`close did not save local progress: ${JSON.stringify(entry)}`);
        }
        if (history.isActive()) throw new Error('session survived close');
    });

    it('marks a nearly finished video as completed on close', async () => {
        const { env, ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        requests.length = 0;

        ctx.embed.media.currentTime = 590;
        history.stop();
        await wait();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch) throw new Error('close did not send a final beacon');
        if (!watch.includes('cmt=599') || !watch.includes('st=0') || !watch.includes('et=599')) {
            throw new Error(`near-end close was not marked completed: ${watch}`);
        }
        if (env.YTC.progress.get('vid123')) {
            throw new Error('a completed video should not keep a local resume point');
        }
    });

    it('commits the old video when the embed navigates to another one', async () => {
        const { ctx, history, requests } = setupHistory();

        history.onPlaying();
        await history.flush();
        requests.length = 0;

        ctx.currentVideoId = 'vid456';
        history.onVideoChanged('vid456');
        await wait();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch) throw new Error('navigation did not commit the old video');
        if (!watch.includes('docid=vid123')) throw new Error(`committed the wrong video: ${watch}`);
        if (!watch.includes('state=ended')) throw new Error('navigation commit is not final');

        ctx.embed.media.currentTime = 5;
        history.onPlaying();
        await history.flush();

        const playerCalls = requests.filter((req) => req.url.includes('/youtubei/v1/player'));
        if (!playerCalls.some((req) => JSON.parse(req.init.body).videoId === 'vid456')) {
            throw new Error('the new video was never tracked');
        }
    });

    it('does not report ads', async () => {
        const { ctx, history, requests } = setupHistory();

        ctx.embed.player.classList.add('ad-showing');
        history.onPlaying();
        if (history.isActive()) throw new Error('an ad started a history session');

        const ok = await history.flush();
        if (ok) throw new Error('an ad was reported');
        if (requests.length !== 0) throw new Error('an ad triggered network requests');

        ctx.embed.player.classList.remove('ad-showing');
        history.onPlaying();
        if (!await history.flush()) throw new Error('playback did not resume reporting after the ad');
    });
});

describe('history failure handling', () => {
    it('skips reporting when ytcfg is unavailable', async () => {
        const { history, requests } = setupHistory({ withYtcfg: false });

        history.onPlaying();
        const ok = await history.flush();

        if (ok) throw new Error('reported without a client context');
        if (requests.length !== 0) throw new Error('made requests without ytcfg');
        history.stop();
    });

    it('skips reporting when the player response has no tracking', async () => {
        const requests = [];
        const env = loadExtension({
            fetch: async (url, init = {}) => {
                requests.push({ url: String(url), init });
                const payload = { playabilityStatus: { status: 'OK' } };
                return {
                    ok: true,
                    status: 200,
                    json: async () => payload,
                    text: async () => JSON.stringify(payload)
                };
            }
        });
        installYtcfg(env);
        const ctx = createContext(env);
        ctx.currentVideoId = 'vid123';
        ctx.embed.media.duration = 600;
        ctx.embed.media.currentTime = 30;
        ctx.embed.media.paused = false;
        ctx.embed.media.readyState = 4;

        const history = env.YTC.controls.history.createHistoryControl(ctx);
        history.onPlaying();
        const ok = await history.flush();

        if (ok) throw new Error('reported without tracking URLs');
        if (statsRequests(requests, 'playback').length) throw new Error('sent a beacon without tracking');
        history.stop();
    });
});

describe('history request realm', () => {
    it('uses the page fetch when Firefox exposes it', async () => {
        const pageRequests = [];
        const contentRequests = [];
        const env = loadExtension({
            fetch: async (url, init) => {
                contentRequests.push({ url: String(url), init });
                return { ok: true, status: 500, text: async () => '' };
            }
        });
        installYtcfg(env);
        env.window.wrappedJSObject = { fetch: createFetchStub(pageRequests) };

        const ctx = createContext(env);
        ctx.currentVideoId = 'vid123';
        ctx.embed.media.duration = 600;
        ctx.embed.media.currentTime = 30;
        ctx.embed.media.paused = false;
        ctx.embed.media.readyState = 4;

        const history = env.YTC.controls.history.createHistoryControl(ctx);
        history.onPlaying();
        const ok = await history.flush();

        if (!ok) throw new Error('page-realm report did not succeed');
        if (contentRequests.length !== 0) {
            throw new Error('content-script fetch was used despite wrappedJSObject');
        }
        if (!pageRequests.some((req) => req.url.includes('/youtubei/v1/player'))) {
            throw new Error('player tracking did not use the page realm');
        }
        if (!pageRequests.some((req) => req.url.includes('/api/stats/watchtime'))) {
            throw new Error('watchtime beacon did not use the page realm');
        }
    });
});

describe('history teardown wiring', () => {
    it('the controller commits the session when the overlay closes', async () => {
        const requests = [];
        const env = loadExtension({ fetch: createFetchStub(requests) });
        installYtcfg(env);
        const base = createContext(env);
        base.embed.media.duration = 600;
        base.embed.media.currentTime = 90;
        base.embed.media.paused = false;
        base.embed.media.readyState = 4;

        const ctrl = env.YTC.controller.setupOverlayEvents(base.overlayElement, base.iframe, {
            videoId: 'vid123',
            initialTimestamp: null,
            isShort: false,
            ambientCtx: null,
            ambientCanvas: null,
            ambientLayer: null,
            startDocked: false,
            isDirectPiP: false
        });

        ctrl.overlayElement._bindVideo(base.embed.media);
        const ok = await ctrl.history.flush();
        if (!ok) throw new Error('precondition: history reporting did not start');

        requests.length = 0;
        base.embed.media.currentTime = 150;
        ctrl.overlayElement._close();
        await wait();

        const watch = lastStatsUrl(requests, 'watchtime');
        if (!watch) throw new Error('overlay close did not send a final history beacon');
        if (!watch.includes('cmt=150') || !watch.includes('state=ended')) {
            throw new Error(`overlay close beacon is wrong: ${watch}`);
        }
    });
});
