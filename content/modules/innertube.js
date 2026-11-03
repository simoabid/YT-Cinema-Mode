/**
 * InnerTube — the client for YouTube's own internal web API.
 *
 * The engagement feature (engagement.js) reads like counts and comments, and
 * rates videos, through the same web client the watch page uses. That needs
 * three things, and they live here once:
 *
 *   1. the Web client config YouTube inlines into every page
 *      (INNERTUBE_API_KEY, INNERTUBE_CONTEXT, STS, session index),
 *   2. the SAPISIDHASH Authorization header, which the background builds from
 *      the session cookies (see background/background.js),
 *   3. a fetch that runs in the page's own realm where Firefox exposes it, so
 *      requests carry the page's origin, referrer and first-party cookies.
 */
(function (YTC) {
    'use strict';

    const CONFIG_CACHE_MS = 5 * 60 * 1000;

    let configCache = null;
    let configCachedAt = 0;

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
     * Read the values a WEB InnerTube request needs out of YouTube's inline
     * `ytcfg.set({...})` script. Content scripts cannot touch the page's
     * `ytcfg` variable, but they can read the script text it came from.
     */
    function readConfig() {
        const now = Date.now();
        if (configCache && now - configCachedAt < CONFIG_CACHE_MS) return configCache;

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

            if (context && apiKey && sts !== null && clientVersion && (sessionIndex !== null || userSessionId || loggedIn === false)) break;
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

        configCache = {
            context,
            apiKey,
            sts,
            clientVersion,
            loggedIn,
            sessionIndex,
            userSessionId,
            delegatedSessionId
        };
        configCachedAt = now;
        return configCache;
    }

    /** Ask the background to sign YouTube requests with the session cookies. */
    function requestAuth(cfg) {
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
    function buildHeaders(auth, cfg) {
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

    /**
     * Firefox exposes the page's own fetch through Xray. Using it makes the
     * requests indistinguishable from ones the page itself sends (page origin,
     * referrer and first-party cookies). Chrome has no wrappedJSObject, so the
     * content-script fetch is the fallback there.
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

    /**
     * POST a WEB InnerTube endpoint.
     *
     * @param {string} endpoint e.g. '/youtubei/v1/next'
     * @param {object} body
     * @param {object} [options]
     * @param {object} [options.cfg]    config to reuse instead of re-reading ytcfg
     * @param {object} [options.auth]   pre-built auth (skips the background call)
     * @param {boolean} [options.signed] sign the request with the session cookies
     * @returns {Promise<{ok:boolean, status:number, data:object|null, error:string|null, auth:boolean}>}
     */
    async function post(endpoint, body, options = {}) {
        const cfg = options.cfg || readConfig();
        if (!cfg) return { ok: false, status: 0, data: null, error: 'no-config', auth: false };

        let auth = options.auth || null;
        if (!auth && options.signed) auth = await requestAuth(cfg);

        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${endpoint}${separator}prettyPrint=false&key=${encodeURIComponent(cfg.apiKey)}`;

        try {
            const res = await performFetch(url, {
                method: 'POST',
                credentials: 'include',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    ...buildHeaders(auth, cfg)
                },
                body: JSON.stringify(body)
            });
            if (!res) return { ok: false, status: 0, data: null, error: 'network', auth: Boolean(auth) };

            const text = await res.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (_) {}

            const ok = res.ok !== false && res.status >= 200 && res.status < 300;
            return { ok, status: res.status, data, error: ok ? null : 'http', auth: Boolean(auth) };
        } catch (err) {
            console.debug('[Cinema Mode] InnerTube request failed:', err);
            return { ok: false, status: 0, data: null, error: 'network', auth: Boolean(auth) };
        }
    }

    YTC.innertube = { readConfig, requestAuth, buildHeaders, performFetch, post };
})(globalThis.YTC);
