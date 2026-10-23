/**
 * YouTube Cinema Mode — background service worker / background script.
 *
 * Two jobs:
 *   1. Strip the anti-embedding headers from YouTube's /embed/ responses so
 *      videos can play inside the cinema overlay.
 *   2. Seed default settings on install and forward the toolbar hotkey.
 *
 * For (1) the manifest decides which path is live:
 *   - Chrome / Chromium MV3: `declarativeNetRequest` only. `webRequestBlocking`
 *     is policy-install-only under MV3, so requesting it earns an install
 *     warning and a Chrome Web Store rejection without buying anything.
 *   - Firefox MV3: Gecko still honours `webRequestBlocking`, so the blocking
 *     listeners below are registered as well (see manifest.firefox.json).
 * Both are attempted and each no-ops if its API is unavailable, so a single
 * background script serves both browsers.
 */
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const SETTINGS_KEY = 'cinemaSettings';

// ------------------------------------------------------- YouTube auth hash

const AUTH_ORIGIN = 'https://www.youtube.com';

/** The three cookie/scheme pairs YouTube itself sends in SAPISIDHASH. */
const AUTH_COOKIE_SCHEMES = [
    { scheme: 'SAPISIDHASH', cookies: ['SAPISID', '__Secure-3PAPISID'] },
    { scheme: 'SAPISID1PHASH', cookies: ['__Secure-1PAPISID'] },
    { scheme: 'SAPISID3PHASH', cookies: ['__Secure-3PAPISID'] }
];

async function readCookie(name) {
    if (!api.cookies || !api.cookies.get) return null;
    try {
        const cookie = await api.cookies.get({ url: AUTH_ORIGIN, name });
        return cookie && cookie.value ? cookie.value : null;
    } catch (_) {
        return null;
    }
}

async function sha1Hex(text) {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reproduce the Authorization header YouTube's web client builds:
 *
 *   SAPISIDHASH <ts>_<sha1(USER_SESSION_ID ts COOKIE origin)>_u
 *   SAPISID1PHASH ... SAPISID3PHASH ...
 *
 * The active account is selected separately with X-Goog-AuthUser, which is
 * SESSION_INDEX (not always 0 when several Google accounts are signed in).
 */
async function buildHistoryAuth(sessionIndex, userSessionId, delegatedSessionId) {
    if (!crypto || !crypto.subtle) return null;

    const timestamp = Math.floor(Date.now() / 1000);
    const userSession = userSessionId ? String(userSessionId) : '';
    const tokens = [];

    for (const entry of AUTH_COOKIE_SCHEMES) {
        let cookie = null;
        for (const name of entry.cookies) {
            cookie = await readCookie(name);
            if (cookie) break;
        }
        if (!cookie) continue;

        const input = userSession
            ? `${userSession} ${timestamp} ${cookie} ${AUTH_ORIGIN}`
            : `${timestamp} ${cookie} ${AUTH_ORIGIN}`;
        const hash = await sha1Hex(input);
        tokens.push(`${entry.scheme} ${timestamp}_${hash}${userSession ? '_u' : ''}`);
    }

    if (tokens.length === 0) return null;
    return {
        authorization: tokens.join(' '),
        authUser: String(sessionIndex ?? '0'),
        origin: AUTH_ORIGIN,
        pageId: delegatedSessionId ? String(delegatedSessionId) : null
    };
}

// --------------------------------------------------------------- embed rules

const RULE_ID_UNBLOCK_EMBED = 101;
const RULE_ID_UNBLOCK_NOCOOKIE = 102;

/** Rule ids we own; anything else is left alone. */
const OWNED_RULE_IDS = [RULE_ID_UNBLOCK_EMBED, RULE_ID_UNBLOCK_NOCOOKIE];

const EMBED_URL_FILTERS = ['youtube.com/embed/', 'youtube-nocookie.com/embed/'];

const EMBED_URL_MATCHES = [
    '*://*.youtube.com/embed/*',
    '*://youtube.com/embed/*',
    '*://*.youtube-nocookie.com/embed/*',
    '*://youtube-nocookie.com/embed/*'
];

/** Fake Referer some embeds require, plus the headers that block framing. */
const REFERER_VALUE = 'https://www.google.com/';
const STRIPPED_RESPONSE_HEADERS = ['x-frame-options', 'content-security-policy'];

function buildUnblockRule(id, urlFilter) {
    return {
        id,
        priority: 2,
        action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'Referer', operation: 'set', value: REFERER_VALUE }],
            responseHeaders: STRIPPED_RESPONSE_HEADERS.map((header) => ({ header, operation: 'remove' }))
        },
        condition: {
            urlFilter,
            resourceTypes: ['sub_frame']
        }
    };
}

async function setupDeclarativeRules() {
    if (!api.declarativeNetRequest || !api.declarativeNetRequest.updateDynamicRules) return;
    try {
        await api.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: OWNED_RULE_IDS,
            addRules: EMBED_URL_FILTERS.map((filter, index) =>
                buildUnblockRule(OWNED_RULE_IDS[index], filter))
        });
    } catch (err) {
        console.warn('[YouTube Cinema Mode] Could not register declarative rules:', err);
    }
}

/** Chrome needs extraHeaders to touch security-relevant headers. */
function headerSpec(type) {
    const spec = ['blocking', type];
    const options = type === 'requestHeaders'
        ? api.webRequest?.OnBeforeSendHeadersOptions
        : api.webRequest?.OnHeadersReceivedOptions;
    if (typeof chrome !== 'undefined' && options && options.EXTRA_HEADERS) {
        spec.push('extraHeaders');
    }
    return spec;
}

function isEmbedRequest(details) {
    return details.type === 'sub_frame' || details.url.includes('/embed/');
}

function rewriteReferer(details) {
    if (!isEmbedRequest(details)) return;

    const headers = details.requestHeaders || [];
    const referer = headers.find((h) => h.name.toLowerCase() === 'referer');
    if (referer) {
        referer.value = REFERER_VALUE;
    } else {
        headers.push({ name: 'Referer', value: REFERER_VALUE });
    }
    return { requestHeaders: headers };
}

function stripFrameBlockingHeaders(details) {
    if (!isEmbedRequest(details)) return;

    const headers = (details.responseHeaders || []).filter(
        (h) => !STRIPPED_RESPONSE_HEADERS.includes(h.name.toLowerCase())
    );
    return { responseHeaders: headers };
}

function setupWebRequestListeners() {
    if (!api.webRequest || !api.webRequest.onBeforeSendHeaders) return;

    const filter = { urls: EMBED_URL_MATCHES, types: ['sub_frame'] };

    try {
        api.webRequest.onBeforeSendHeaders.addListener(
            rewriteReferer,
            filter,
            headerSpec('requestHeaders')
        );
    } catch (err) {
        console.warn('[YouTube Cinema Mode] webRequest onBeforeSendHeaders setup:', err);
    }

    if (!api.webRequest.onHeadersReceived) return;
    try {
        api.webRequest.onHeadersReceived.addListener(
            stripFrameBlockingHeaders,
            filter,
            headerSpec('responseHeaders')
        );
    } catch (err) {
        console.warn('[YouTube Cinema Mode] webRequest onHeadersReceived setup:', err);
    }
}

// ------------------------------------------------------------------ settings

/** The retired default profile (hotkey "h" + direct mini-player) maps to today's defaults. */
const LEGACY_DEFAULTS = {
    hotkey: 'h',
    directMiniPlayer: true
};

const CURRENT_DEFAULTS = {
    hotkey: ' ',
    autoHideControls: true,
    rememberSpeed: true,
    directMiniPlayer: false,
    directPiP: false
};

const DEFAULT_SETTINGS = {
    hotkey: ' ',
    theme: 'mocha',
    autoTheater: true,
    showIndicator: true,
    backdropStyle: 'glass',
    overlayOpacity: 90,
    ambientLighting: true,
    ambientFullScreen: true,
    ambientGlow: 75,
    ambientQuality: 'high',
    ambientBlur: 80,
    autoPause: true,
    altClickTrigger: true,
    middleClickTrigger: false,
    autoHideControls: true,
    rememberSpeed: true,
    rememberQuality: true,
    savedQuality: 'auto',
    directMiniPlayer: false,
    directPiP: false
};

async function seedSettingsOnInstall() {
    try {
        const result = await api.storage.sync.get([SETTINGS_KEY]);
        const existing = result && result[SETTINGS_KEY];

        if (!existing) {
            await api.storage.sync.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
            return;
        }

        if (existing.hotkey === LEGACY_DEFAULTS.hotkey && existing.directMiniPlayer === LEGACY_DEFAULTS.directMiniPlayer) {
            await api.storage.sync.set({ [SETTINGS_KEY]: { ...existing, ...CURRENT_DEFAULTS } });
        }
    } catch (err) {
        console.error('[YouTube Cinema Mode] Error initializing settings:', err);
    }
}

// ------------------------------------------------------------------ commands

async function toggleCinemaInActiveTab() {
    try {
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) return;

        await api.tabs.sendMessage(tab.id, { action: 'toggle-cinema' }).catch(() => {
            // Content script may not be injected or ready on this tab.
        });
    } catch (err) {
        console.error('[YouTube Cinema Mode] Error handling command:', err);
    }
}

function registerListeners() {
    api.runtime.onInstalled.addListener(async (details) => {
        setupDeclarativeRules();
        setupWebRequestListeners();
        if (details.reason === 'install') {
            await seedSettingsOnInstall();
        }
    });

    api.commands.onCommand.addListener((command) => {
        if (command === 'toggle-cinema') toggleCinemaInActiveTab();
    });

    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.action !== 'yt-cinema-auth') return undefined;

        buildHistoryAuth(message.sessionIndex, message.userSessionId, message.delegatedSessionId)
            .then((auth) => sendResponse(auth))
            .catch((err) => {
                console.warn('[YouTube Cinema Mode] Could not build history auth:', err);
                sendResponse(null);
            });
        return true;
    });
}

// Apply the header rules right away too, so they survive service-worker restarts.
setupDeclarativeRules();
setupWebRequestListeners();
registerListeners();
