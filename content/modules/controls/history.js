/**
 * History control — records playback in the signed-in account's real YouTube
 * watch history.
 *
 * The embed player is a "WEB_EMBEDDED_PLAYER" surface and YouTube does not
 * treat it as a normal watch, no matter which cookies the iframe carries. So
 * this control reproduces what the watch page itself does, from the parent
 * page (which is signed in and has the session cookies):
 *
 *   1. mint a WEB `/youtubei/v1/player` response for the video (it returns
 *      playback tracking URLs signed with `el=detailpage`),
 *   2. send that session's `videostatsPlaybackUrl` and `videostatsWatchtimeUrl`
 *      beacons with `ver=2`, a stable `cpn`, `st`/`et`/`cmt` progress windows
 *      and `state=playing|paused|ended`.
 *
 * This is the same portable technique used by yt-dlp's `_mark_watched` and
 * third-party clients: the playback beacon creates the history entry, the
 * watchtime beacons make progress/resume position accumulate instead of
 * looking like repeated restarts.
 */
(function (YTC) {
    'use strict';

    const FIRST_PING_DELAY_MS = 1200;
    const FIRST_PING_RETRY_MS = 600;
    const FIRST_PING_MAX_ATTEMPTS = 10;
    const FAST_HEARTBEAT_MS = 10000;
    const SLOW_HEARTBEAT_MS = 40000;
    const FAST_HEARTBEAT_PINGS = 3;
    const NAV_SETTLE_MS = 1500;
    const MIN_WATCH_MS = 8000;
    const COMPLETION_MARGIN_MS = 30000;
    const THROTTLE_COOLDOWN_MS = 60000;
    const YTCFG_CACHE_MS = 5 * 60 * 1000;

    // ------------------------------------------------------------ ytcfg

    let ytcfgCache = null;
    let ytcfgCachedAt = 0;

    /** Extract one balanced `{...}` JSON object starting at `start`. */
    function extractJsonObject(text, start) {
        let depth = 0;
        let quote = null;
        let escaped = false;

        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (quote) {
                if (escaped) { escaped = false; continue; }
                if (ch === '\\') { escaped = true; continue; }
                if (ch === quote) quote = null;
                continue;
            }
            if (ch === '"') { quote = ch; continue; }
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return text.slice(start, i + 1);
            }
        }
        return null;
    }

    /** Firefox can read the page's own ytcfg directly; Chrome falls back to DOM. */
    function readPageYtcfgValue(key) {
        try {
            const pageWindow = window.wrappedJSObject;
            const pageYtcfg = pageWindow && pageWindow.ytcfg;
            if (pageYtcfg && typeof pageYtcfg.get === 'function') {
                const value = pageYtcfg.get(key);
                if (value !== undefined && value !== null) return String(value);
            }
        } catch (_) {}
        return null;
    }

    /**
     * Read the values the WEB player request needs out of YouTube's inline
     * `ytcfg.set({...})` script. Content scripts cannot touch the page's
     * `ytcfg` variable, but they can read the script text it came from.
     */
    function readYtcfg() {
        const now = Date.now();
        if (ytcfgCache && now - ytcfgCachedAt < YTCFG_CACHE_MS) return ytcfgCache;

        let context = null;
        let apiKey = null;
        let sts = null;
        let clientVersion = null;
        let visitorData = null;
        let hl = null;
        let gl = null;
        let loggedIn = null;
        let sessionIndex = null;
        let userSessionId = null;
        let delegatedSessionId = null;

        for (const script of document.querySelectorAll('script')) {
            const text = script.textContent;
            if (!text || (!text.includes('INNERTUBE_CONTEXT') && !text.includes('INNERTUBE_API_KEY'))) continue;

            if (!context) {
                const keyMatch = /"INNERTUBE_CONTEXT"\s*:\s*\{/.exec(text);
                const brace = keyMatch ? keyMatch.index + keyMatch[0].lastIndexOf('{') : -1;
                const json = brace >= 0 ? extractJsonObject(text, brace) : null;
                if (json) {
                    try {
                        const parsed = JSON.parse(json);
                        if (parsed && parsed.client) context = parsed;
                    } catch (_) {}
                }
            }
            if (!apiKey) {
                const match = text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
                if (match) apiKey = match[1];
            }
            if (sts === null) {
                const match = text.match(/"STS"\s*:\s*(\d+)/);
                if (match) sts = parseInt(match[1], 10);
            }
            if (!clientVersion) {
                const match = text.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
                if (match) clientVersion = match[1];
            }
            if (!visitorData) {
                const match = text.match(/"visitorData"\s*:\s*"([^"]+)"/);
                if (match) visitorData = match[1];
            }
            if (!hl) {
                const match = text.match(/"hl"\s*:\s*"([^"]+)"/);
                if (match) hl = match[1];
            }
            if (!gl) {
                const match = text.match(/"gl"\s*:\s*"([^"]+)"/);
                if (match) gl = match[1];
            }
            if (loggedIn === null) {
                const match = text.match(/"LOGGED_IN"\s*:\s*(true|false)/);
                if (match) loggedIn = match[1] === 'true';
            }
            if (sessionIndex === null) {
                const match = text.match(/"SESSION_INDEX"\s*:\s*"?(\d+)"?/);
                if (match) sessionIndex = match[1];
            }
            if (!userSessionId) {
                const match = text.match(/"USER_SESSION_ID"\s*:\s*"([^"]+)"/);
                if (match) userSessionId = match[1];
            }
            if (!delegatedSessionId) {
                const match = text.match(/"DELEGATED_SESSION_ID"\s*:\s*"([^"]+)"/);
                if (match) delegatedSessionId = match[1];
            }

            if (context && apiKey && sts !== null && clientVersion && sessionIndex !== null &&
                userSessionId && delegatedSessionId !== null) break;
        }

        if (sessionIndex === null) sessionIndex = readPageYtcfgValue('SESSION_INDEX');
        if (!userSessionId) userSessionId = readPageYtcfgValue('USER_SESSION_ID');
        if (!delegatedSessionId) delegatedSessionId = readPageYtcfgValue('DELEGATED_SESSION_ID');

        if (!apiKey || !clientVersion) return null;

        if (!context) {
            if (!visitorData) return null;
            context = {
                client: {
                    clientName: 'WEB',
                    clientVersion,
                    visitorData,
                    hl: hl || 'en',
                    gl: gl || 'US',
                    originalUrl: window.location.href,
                    userAgent: navigator.userAgent || '',
                    platform: 'DESKTOP',
                    clientFormFactor: 'UNKNOWN_FORM_FACTOR'
                },
                user: { lockedSafetyMode: false },
                request: { useSsl: true }
            };
        } else {
            context.client.clientName = 'WEB';
            context.client.clientVersion = clientVersion;
            if (visitorData) context.client.visitorData = visitorData;
            if (hl) context.client.hl = hl;
            if (gl) context.client.gl = gl;
            context.client.originalUrl = window.location.href;
            context.client.userAgent = navigator.userAgent || '';
            delete context.thirdParty;
        }

        ytcfgCache = {
            context,
            apiKey,
            sts,
            clientVersion,
            loggedIn,
            sessionIndex,
            userSessionId,
            delegatedSessionId
        };
        ytcfgCachedAt = now;
        return ytcfgCache;
    }

    // ------------------------------------------------------------- auth

    /** Ask the background to sign YouTube requests with the session cookies. */
    function requestHistoryAuth(cfg) {
        if (!cfg) return Promise.resolve(null);
        return new Promise((resolve) => {
            try {
                const result = YTC.api.runtime.sendMessage({
                    action: 'yt-cinema-auth',
                    sessionIndex: cfg.sessionIndex,
                    userSessionId: cfg.userSessionId,
                    delegatedSessionId: cfg.delegatedSessionId
                });
                if (result && typeof result.then === 'function') {
                    result.then((auth) => resolve(auth && auth.authorization ? auth : null),
                        () => resolve(null));
                } else {
                    resolve(null);
                }
            } catch (_) {
                resolve(null);
            }
        });
    }

    /** Headers the watch page's own InnerTube/stats requests carry. */
    function buildRequestHeaders(auth, cfg) {
        const headers = {
            'X-Goog-Visitor-Id': (cfg && cfg.context && cfg.context.client.visitorData) || '',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': (cfg && cfg.clientVersion) || '',
            'X-Origin': 'https://www.youtube.com'
        };

        const authUser = auth ? auth.authUser : (cfg && cfg.sessionIndex);
        if (authUser !== null && authUser !== undefined && authUser !== '') {
            headers['X-Goog-AuthUser'] = String(authUser);
        }
        if (auth) {
            headers.Authorization = auth.authorization;
            if (auth.pageId) headers['X-Goog-PageId'] = auth.pageId;
        }
        return headers;
    }

    // ---------------------------------------------------------- requests

    function generateCpn() {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
        let out = '';
        for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
        return out;
    }

    function parseLengthSeconds(url) {
        const match = /[?&]len=([^&]+)/.exec(url || '');
        return match ? (parseFloat(match[1]) || 0) : 0;
    }

    /** Keep the signed tracking query intact; only redirect the host. */
    function normalizeStatsUrl(baseUrl) {
        try {
            const url = new URL(baseUrl, window.location.href);
            if (url.hostname === 's.youtube.com') {
                url.protocol = 'https:';
                url.hostname = 'www.youtube.com';
            }
            return url.toString();
        } catch (_) {
            return baseUrl;
        }
    }

    /**
     * Firefox exposes the page's own fetch through Xray. Using it makes the
     * history beacons indistinguishable from requests the watch page itself
     * sends (page origin, referrer and first-party cookies). Chrome has no
     * wrappedJSObject, so the content-script fetch is the fallback there.
     */
    function performFetch(url, init) {
        const pageWindow = window.wrappedJSObject;
        if (pageWindow && typeof pageWindow.fetch === 'function' && typeof cloneInto === 'function') {
            try {
                return pageWindow.fetch(url, cloneInto(init, pageWindow));
            } catch (err) {
                console.debug('[Cinema Mode] Page-realm fetch unavailable, using content-script fetch:', err);
            }
        }
        return fetch(url, init);
    }

    function withStatsParams(baseUrl, opts) {
        let url = baseUrl + (baseUrl.includes('?') ? '&' : '?');
        url += `ver=2&cpn=${encodeURIComponent(opts.cpn)}&c=WEB&cmt=${opts.cmt}&el=detailpage`;
        if (opts.watchtime) url += `&st=${opts.st}&et=${opts.cmt}`;
        if (opts.rt > 0) url += `&rt=${opts.rt}`;
        if (opts.rtn >= 0 && !opts.watchtime) url += `&rtn=${opts.rtn}`;
        if (opts.final) url += '&state=ended';
        else if (opts.paused) url += '&state=paused';
        else url += '&state=playing';
        if (opts.final && opts.watchtime) url += '&final=1';
        return url;
    }

    async function pingStats(baseUrl, opts) {
        const url = withStatsParams(normalizeStatsUrl(baseUrl), opts);
        const init = {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            keepalive: true,
            headers: opts.headers,
            referrer: `https://www.youtube.com/watch?v=${encodeURIComponent(opts.videoId)}`,
            referrerPolicy: 'strict-origin-when-cross-origin'
        };
        try {
            const res = await performFetch(url, init);
            return res ? res.status : 0;
        } catch (_) {
            // Some browsers reject a scripted referrer; the stats endpoint
            // accepts the page's own referrer just as well.
            try {
                delete init.referrer;
                delete init.referrerPolicy;
                const res = await performFetch(url, init);
                return res ? res.status : 0;
            } catch (_) {
                return 0;
            }
        }
    }

    /**
     * Mint the playback-tracking pair once per playback session. The returned
     * URLs are signed for a normal WEB watch (`el=detailpage`), which is what
     * makes the subsequent beacons count toward history.
     */
    async function requestPlaybackTracking(videoId, cpn) {
        const cfg = readYtcfg();
        if (!cfg) return null;

        const playbackContext = {
            contentPlaybackContext: {
                referer: `https://www.youtube.com/watch?v=${videoId}`,
                el: 'detailpage',
                vis: 0,
                splay: false,
                lactMilliseconds: '-1',
                html5Preference: 'HTML5_PREF_WANTS'
            }
        };
        if (cfg.sts !== null) {
            playbackContext.contentPlaybackContext.signatureTimestamp = cfg.sts;
        }

        cfg.context.client.originalUrl = window.location.href;
        const auth = await requestHistoryAuth(cfg);
        if (!auth) {
            console.warn('[Cinema Mode] Watch-history auth unavailable ' +
                '(cookies permission or active session missing); requests will be anonymous.');
        }
        const body = {
            context: cfg.context,
            videoId,
            cpn,
            playbackContext,
            contentCheckOk: true,
            racyCheckOk: true
        };

        try {
            const res = await performFetch(
                `/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(cfg.apiKey)}`,
                {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: {
                        'Content-Type': 'application/json',
                        ...buildRequestHeaders(auth, cfg)
                    },
                    body: JSON.stringify(body)
                }
            );
            if (!res || res.ok === false) {
                console.debug('[Cinema Mode] Watch-history player request failed:', res && res.status);
                return null;
            }

            const data = JSON.parse(await res.text());
            const tracking = data && data.playbackTracking;
            const playbackUrl = tracking && tracking.videostatsPlaybackUrl &&
                tracking.videostatsPlaybackUrl.baseUrl;
            if (!playbackUrl) {
                console.debug('[Cinema Mode] Watch-history tracking unavailable for', videoId);
                return null;
            }

            const watchtimeUrl = tracking.videostatsWatchtimeUrl &&
                tracking.videostatsWatchtimeUrl.baseUrl || null;
            const lengthSeconds = parseLengthSeconds(watchtimeUrl || playbackUrl) ||
                parseFloat(data.videoDetails && data.videoDetails.lengthSeconds) || 0;

            let loggedIn = null;
            try {
                const service = (data.responseContext && data.responseContext.serviceTrackingParams) || [];
                const feedback = service.find((entry) => entry.service === 'GFEEDBACK');
                const param = feedback && feedback.params &&
                    feedback.params.find((item) => item.key === 'logged_in');
                loggedIn = param ? param.value : null;
            } catch (_) {}

            if (loggedIn === '0') {
                console.warn('[Cinema Mode] Watch-history requests reached YouTube signed out. ' +
                    'Sign in to youtube.com in this browser (or allow the extension\'s session cookies) to sync history.');
            } else if (loggedIn !== null) {
                console.info(`[Cinema Mode] Watch-history tracking is authenticated (logged_in=${loggedIn}).`);
            }

            return { playbackUrl, watchtimeUrl, lengthSeconds, loggedIn };
        } catch (err) {
            console.debug('[Cinema Mode] Watch-history player request threw:', err);
            return null;
        }
    }

    // ----------------------------------------------------------- control

    function createHistoryControl(ctx) {
        const { overlayElement } = ctx;

        let session = null;
        let firstTimer = null;
        let heartbeatTimer = null;
        let firstAttempts = 0;

        function clearTimers() {
            if (firstTimer) {
                clearTimeout(firstTimer);
                firstTimer = null;
            }
            if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
                heartbeatTimer = null;
            }
        }

        function readPlayback() {
            try {
                const { video } = ctx.getPlayerElements();
                if (!video) return null;
                const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                const position = Number.isFinite(video.currentTime) && video.currentTime > 0 ? video.currentTime : 0;
                return {
                    video,
                    positionMs: Math.round(position * 1000),
                    durationMs: Math.round(duration * 1000),
                    paused: Boolean(video.paused),
                    ended: Boolean(video.ended)
                };
            } catch (_) {
                return null;
            }
        }

        function isAdPlaying() {
            try {
                const { player } = ctx.getPlayerElements();
                const playerEl = (player && player.wrappedJSObject) || player;
                if (playerEl && playerEl.classList && playerEl.classList.contains('ad-showing')) return true;

                const doc = YTC.player.getEmbedDocument(ctx.iframe);
                const mp = doc && doc.getElementById('movie_player');
                return Boolean(mp && mp.classList && mp.classList.contains('ad-showing'));
            } catch (_) {
                return false;
            }
        }

        function ensureTracking(current) {
            if (current.tracking) return Promise.resolve(current.tracking);
            if (current.trackingPromise) return current.trackingPromise;

            current.trackingPromise = requestPlaybackTracking(current.videoId, current.cpn)
                .then((tracking) => {
                    if (session === current) current.tracking = tracking;
                    return tracking;
                })
                .catch(() => null)
                .finally(() => {
                    current.trackingPromise = null;
                });
            return current.trackingPromise;
        }

        async function sendPing(current, positionMs, {
            final = false,
            paused = false,
            skipProgress = false,
            completion = false
        } = {}) {
            if (!current) return false;

            const duration = current.durationMs || 0;
            if (completion) {
                YTC.progress.clear(current.videoId);
            } else if (!skipProgress) {
                YTC.progress.save(current.videoId, positionMs, duration);
            }

            const tracking = await ensureTracking(current);
            if (!tracking) return false;
            if (session !== current && !final) return false;

            const maxMs = tracking.lengthSeconds > 1 ? tracking.lengthSeconds * 1000 - 1000 : positionMs;
            const clamped = Math.max(0, Math.min(positionMs, maxMs));
            const cmt = completion && tracking.lengthSeconds > 1
                ? Math.max(0, Math.floor(tracking.lengthSeconds) - 1)
                : Math.max(0, Math.round(clamped / 1000));
            const st = completion ? 0
                : Math.max(0, Math.min(cmt, Math.round(current.lastReportedMs / 1000)));
            const rt = Math.max(0, Math.round((Date.now() - current.startedAt) / 1000));
            const cfg = readYtcfg();
            const auth = cfg ? await requestHistoryAuth(cfg) : null;
            const common = {
                videoId: current.videoId,
                cpn: current.cpn,
                cmt,
                st,
                rt,
                rtn: current.pingCount,
                final,
                paused,
                headers: buildRequestHeaders(auth, cfg)
            };

            const targets = [{ url: tracking.playbackUrl, watchtime: false }];
            if (tracking.watchtimeUrl) targets.push({ url: tracking.watchtimeUrl, watchtime: true });

            const statuses = await Promise.all(
                targets.map((target) => pingStats(target.url, { ...common, watchtime: target.watchtime }))
            );
            const ok = statuses.some((status) => status >= 200 && status < 300);

            if (ok) {
                current.lastReportedMs = Math.max(current.lastReportedMs, clamped);
                if (!final) current.pingCount++;
                if (!current.reportedOnce) {
                    current.reportedOnce = true;
                    console.info(`[Cinema Mode] Watch-history beacon accepted for ${current.videoId} ` +
                        `(logged_in=${tracking.loggedIn}, position=${cmt}s).`);
                }
                overlayElement.dispatchEvent(new CustomEvent('yt-cinema-history-status', {
                    detail: {
                        videoId: current.videoId,
                        position: clamped,
                        status: statuses,
                        final,
                        paused
                    }
                }));
                return true;
            }

            if (statuses.some((status) => status === 401 || status === 403)) {
                console.warn('[Cinema Mode] Watch-history sync was rejected (401/403). ' +
                    'Sign in to youtube.com or retry later.');
                if (session === current) {
                    session = null;
                    clearTimers();
                }
            } else if (statuses.some((status) => status === 429)) {
                current.cooldownUntil = Date.now() + THROTTLE_COOLDOWN_MS;
            }
            return false;
        }

        function scheduleHeartbeat(current, overrideDelay = 0) {
            if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (!current || session !== current) return;

            const fast = current.pingCount <= FAST_HEARTBEAT_PINGS;
            const base = overrideDelay || (fast ? FAST_HEARTBEAT_MS : SLOW_HEARTBEAT_MS);
            const jitter = fast ? 1 : 0.85 + Math.random() * 0.3;
            let delay = Math.round(base * jitter);
            if (current.cooldownUntil > Date.now()) {
                delay = Math.max(delay, current.cooldownUntil - Date.now());
            }

            heartbeatTimer = setTimeout(() => {
                heartbeatTimer = null;
                runHeartbeat(current);
            }, delay);
        }

        async function runHeartbeat(current) {
            if (session !== current) return;
            const info = readPlayback();
            if (!info || info.paused || info.ended || isAdPlaying()) return;

            current.durationMs = info.durationMs || current.durationMs;
            await sendPing(current, info.positionMs, {});
            if (session === current) scheduleHeartbeat(current);
        }

        function scheduleFirstPing(current) {
            if (firstTimer) clearTimeout(firstTimer);
            firstTimer = setTimeout(() => {
                firstTimer = null;
                runFirstPing(current);
            }, FIRST_PING_DELAY_MS);
        }

        async function runFirstPing(current) {
            if (session !== current) return;
            const info = readPlayback();
            if (!info || info.paused || info.ended || isAdPlaying()) {
                if (session === current && !current.firstSent && ++firstAttempts < FIRST_PING_MAX_ATTEMPTS) {
                    firstTimer = setTimeout(() => {
                        firstTimer = null;
                        runFirstPing(current);
                    }, FIRST_PING_RETRY_MS);
                }
                return;
            }

            current.durationMs = info.durationMs || current.durationMs;
            const ok = await sendPing(current, info.positionMs, {});
            if (session !== current) return;

            if (ok) {
                current.firstSent = true;
                scheduleHeartbeat(current);
            } else if (++firstAttempts < FIRST_PING_MAX_ATTEMPTS) {
                firstTimer = setTimeout(() => {
                    firstTimer = null;
                    runFirstPing(current);
                }, FIRST_PING_RETRY_MS * 2);
            }
        }

        function startSession(info) {
            clearTimers();
            firstAttempts = 0;
            session = {
                videoId: ctx.currentVideoId,
                cpn: generateCpn(),
                startedAt: Date.now(),
                tracking: null,
                trackingPromise: null,
                lastReportedMs: info.positionMs,
                durationMs: info.durationMs,
                pingCount: 0,
                firstSent: false,
                cooldownUntil: 0
            };
            scheduleFirstPing(session);
            return session;
        }

        /** Near the end and mostly watched — worth committing as completed. */
        function isCompleted(current, positionMs, ended) {
            if (ended) return true;
            const duration = current.durationMs || 0;
            if (duration <= 0) return false;
            const threshold = Math.max(duration * 0.9, duration - COMPLETION_MARGIN_MS);
            return positionMs >= threshold;
        }

        function finishSession(current, positionMs, opts) {
            if (!current) return;
            if (session === current) session = null;
            clearTimers();
            const position = Math.max(0, Math.round(Number(positionMs) || current.lastReportedMs || 0));
            if (current.firstSent || position >= MIN_WATCH_MS) {
                sendPing(current, position, opts).catch(() => {});
            }
        }

        function onPlaying() {
            if (!ctx.currentVideoId) return;
            if (isAdPlaying()) return;

            const info = readPlayback();
            if (!info || info.paused || info.ended) return;

            if (session && session.videoId !== ctx.currentVideoId) {
                finishSession(session, session.lastReportedMs, { final: true });
            }

            if (!session) {
                startSession(info);
                return;
            }

            session.durationMs = info.durationMs || session.durationMs;
            if (!session.firstSent && !firstTimer) scheduleFirstPing(session);
            if (!heartbeatTimer) scheduleHeartbeat(session);
        }

        /** Pause is not final: report the position, then resume the session on play. */
        function onPaused() {
            const current = session;
            if (!current) return;
            if (firstTimer) {
                clearTimeout(firstTimer);
                firstTimer = null;
            }
            if (heartbeatTimer) {
                clearTimeout(heartbeatTimer);
                heartbeatTimer = null;
            }

            const info = readPlayback();
            if (!info || isAdPlaying()) return;

            const position = info.positionMs;
            if (!current.firstSent && position < MIN_WATCH_MS) return;
            sendPing(current, position, { paused: true }).catch(() => {});
        }

        function onEnded() {
            const current = session;
            if (!current) return;
            // A looping Short ends/restarts repeatedly; keep one session for it.
            if (ctx.isShort) return;
            const info = readPlayback();
            const position = info && info.durationMs > 0 ? info.durationMs : current.lastReportedMs;
            YTC.progress.clear(current.videoId);
            // yt-dlp's proven completion form: cmt at the last second, st=0.
            finishSession(current, position, { final: true, skipProgress: true, completion: true });
        }

        /**
         * Start the next watchtime window at the seek target: a skipped range
         * must not be reported as watched, and a backward seek must not make
         * st > et.
         */
        function onSeeking() {
            if (!session) return;
            const info = readPlayback();
            if (info) session.lastReportedMs = info.positionMs;
        }

        function onVideoChanged(newId) {
            const current = session;
            if (!current || current.videoId === newId) return;

            // The old iframe document is often already gone by the time
            // yt-navigate-finish fires, so the last heartbeat is the safest
            // position to commit.
            const completed = isCompleted(current, current.lastReportedMs, false);
            finishSession(current, current.lastReportedMs, { final: true, completion: completed });

            setTimeout(() => {
                if (!session) onPlaying();
            }, NAV_SETTLE_MS);
        }

        function stop() {
            const current = session;
            if (!current) {
                clearTimers();
                return;
            }
            const info = readPlayback();
            const position = Math.max(info ? info.positionMs : 0, current.lastReportedMs);
            if (info && info.durationMs) current.durationMs = info.durationMs;
            const completed = isCompleted(current, position, Boolean(info && info.ended));
            finishSession(current, position, { final: true, completion: completed });
        }

        /** Explicit flush (also used by tests to avoid waiting for the first delay). */
        async function flush() {
            const current = session;
            if (!current) return false;
            const info = readPlayback();
            if (!info || info.paused || info.ended || isAdPlaying()) return false;

            const ok = await sendPing(current, info.positionMs, {});
            if (ok && session === current) {
                current.firstSent = true;
                scheduleHeartbeat(current);
            }
            return ok;
        }

        return {
            onPlaying,
            onPaused,
            onEnded,
            onSeeking,
            onVideoChanged,
            stop,
            flush,
            isActive: () => Boolean(session),
            debugState: () => (session ? {
                videoId: session.videoId,
                cpn: session.cpn,
                pingCount: session.pingCount,
                lastReportedMs: session.lastReportedMs,
                tracking: Boolean(session.tracking)
            } : null)
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.history = { createHistoryControl };
})(globalThis.YTC);
