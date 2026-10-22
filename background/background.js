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
}

// Apply the header rules right away too, so they survive service-worker restarts.
setupDeclarativeRules();
setupWebRequestListeners();
registerListeners();
