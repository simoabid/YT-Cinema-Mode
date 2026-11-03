/**
 * Test harness — loads the real content-script modules into a mocked browser
 * environment so control logic can be exercised without a browser.
 *
 * Modules are evaluated in the same order the manifest lists them, against a
 * shared `globalThis.YTC` exactly like the browser does.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createDomEnv, makeEvent } = require('./dom');

const ROOT = path.join(__dirname, '..');

/** Mirrors manifest.json's content_scripts[].js order. */
const MODULE_ORDER = [
    'content/modules/core.js',
    'content/modules/theme.js',
    'content/modules/icons.js',
    'content/modules/video.js',
    'content/modules/innertube.js',
    'content/modules/engagement.js',
    'content/modules/layout.js',
    'content/modules/player.js',
    'content/modules/overlay.js',
    'content/modules/launcher.js',
    'content/modules/controls/toast.js',
    'content/modules/controls/autohide.js',
    'content/modules/controls/speed.js',
    'content/modules/controls/quality.js',
    'content/modules/controls/transport.js',
    'content/modules/controls/history.js',
    'content/modules/controls/ambient.js',
    'content/modules/controls/screenshot.js',
    'content/modules/controls/dock.js',
    'content/modules/controls/navigation.js',
    'content/modules/controls/engagement.js',
    'content/modules/controls/keyboard.js',
    'content/modules/controller.js'
];

/** In-memory `chrome.*` stub covering the APIs the content script touches. */
function createApiStub() {
    const store = { sync: {}, local: {} };
    const changed = { listeners: [] };
    const messages = { listeners: [] };

    return {
        store,
        api: {
            storage: {
                sync: {
                    get(keys, cb) {
                        const out = {};
                        for (const k of [].concat(keys)) if (k in store.sync) out[k] = store.sync[k];
                        cb(out);
                    },
                    set(obj, cb) { Object.assign(store.sync, obj); cb && cb(); }
                },
                local: {
                    get(keys, cb) {
                        const out = {};
                        for (const k of [].concat(keys)) if (k in store.local) out[k] = store.local[k];
                        cb(out);
                    },
                    set(obj) { Object.assign(store.local, obj); }
                },
                onChanged: {
                    addListener(fn) { changed.listeners.push(fn); }
                }
            },
            runtime: {
                id: 'test-extension',
                onMessage: { addListener(fn) { messages.listeners.push(fn); } },
                sendMessage() { return Promise.resolve(); },
                getURL: (p) => `chrome-extension://test/${p}`
            }
        },
        _emitChange(area, changes) {
            for (const fn of changed.listeners) fn(changes, area);
        },
        _emitMessage(message) {
            for (const fn of messages.listeners) fn(message);
        }
    };
}

/**
 * Build a fresh sandbox with the content modules loaded.
 *
 * @param {object} overrides  extra sandbox globals
 * @param {object} [options]
 * @param {boolean} [options.boot] also load content/content.js, the page-level
 *                                 bouncer for hover, hotkeys and mouse triggers
 * @returns {{YTC:object, window:object, document:object, api:object}}
 */
function loadExtension(overrides = {}, { boot = false } = {}) {
    const { window, document } = createDomEnv();
    const apiStub = createApiStub();

    const sandbox = {
        window,
        document,
        chrome: apiStub.api,
        performance,
        console,
        URL,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame: window.requestAnimationFrame,
        cancelAnimationFrame: window.cancelAnimationFrame,
        navigator: { userAgent: 'test-agent', clipboard: { writeText: async () => {} } },
        fetch: async () => ({ ok: true, status: 204, json: async () => ({}), text: async () => '' }),
        cloneInto: (value) => value,
        URLSearchParams,
        CustomEvent: function CustomEvent(type, init) { return { type, detail: init?.detail }; },
        Promise,
        Array,
        Map,
        Set,
        Math,
        Date,
        JSON,
        WeakMap,
        Boolean,
        Number,
        String,
        Object,
        Error,
        isNaN,
        parseInt,
        parseFloat,
        ...overrides
    };
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);

    for (const rel of MODULE_ORDER) {
        const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        vm.runInContext(code, context, { filename: rel });
    }

    if (!boot) {
        // content.js normally installs these, but the harness loads only the
        // modules, so the overlay factory's dependency is stubbed here.
        sandbox.YTC.hover = { hideIndicator() {}, refreshHotkeyLabel() {} };
    } else {
        const code = fs.readFileSync(path.join(ROOT, 'content/content.js'), 'utf8');
        vm.runInContext(code, context, { filename: 'content/content.js' });
    }

    return {
        YTC: sandbox.YTC,
        window,
        document,
        chrome: apiStub.api,
        store: apiStub.store,
        emitChange: apiStub._emitChange,
        emitMessage: apiStub._emitMessage
    };
}

/** Build the DOM subtree the controller looks for, so a ctx can be assembled. */
function buildOverlayDom(document) {
    const overlay = document.createElement('div');
    overlay.id = 'yt-cinema-overlay-test';
    overlay.className = 'yt-cinema-overlay';

    const container = document.createElement('div');
    container.className = 'yt-cinema-container';

    const header = document.createElement('div');
    header.className = 'yt-cinema-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'yt-cinema-title-text';
    titleSpan.textContent = 'First Video';
    header.appendChild(titleSpan);
    const shortsBadge = document.createElement('span');
    shortsBadge.className = 'yt-cinema-shorts-badge';
    header.appendChild(shortsBadge);
    container.appendChild(header);

    const playerWrapper = document.createElement('div');
    playerWrapper.className = 'yt-cinema-player-wrapper';
    container.appendChild(playerWrapper);

    const footer = document.createElement('div');
    footer.className = 'yt-cinema-footer';
    container.appendChild(footer);

    for (const dir of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
        const handle = document.createElement('div');
        handle.className = `yt-cinema-resize-handle yt-cinema-resize-${dir}`;
        handle.dataset.direction = dir;
        container.appendChild(handle);
    }
    const grip = document.createElement('div');
    grip.className = 'yt-cinema-resize-grip';
    grip.dataset.direction = 'se';
    container.appendChild(grip);

    for (const name of ['close', 'pip', 'newtab', 'copy', 'screenshot', 'dock', 'prev', 'next']) {
        const btn = document.createElement('button');
        btn.className = `yt-cinema-${name}-btn`;
        container.appendChild(btn);
    }

    const speedPill = document.createElement('button');
    speedPill.className = 'yt-cinema-speed-pill';
    const speedMenu = document.createElement('div');
    speedMenu.className = 'yt-cinema-speed-menu';
    container.appendChild(speedPill);
    container.appendChild(speedMenu);

    const qualityPill = document.createElement('button');
    qualityPill.className = 'yt-cinema-quality-pill';
    const qualityMenu = document.createElement('div');
    qualityMenu.className = 'yt-cinema-quality-menu';
    container.appendChild(qualityPill);
    container.appendChild(qualityMenu);

    const subscribeBtn = document.createElement('button');
    subscribeBtn.className = 'yt-cinema-subscribe-btn';
    for (const cls of ['yt-cinema-subscribe-icon', 'yt-cinema-subscribe-label', 'yt-cinema-subscribe-count']) {
        subscribeBtn.appendChild(Object.assign(document.createElement('span'), { className: cls }));
    }
    container.appendChild(subscribeBtn);

    const likeBtn = document.createElement('button');
    likeBtn.className = 'yt-cinema-rating-btn yt-cinema-like-btn';
    likeBtn.appendChild(Object.assign(document.createElement('span'), {
        className: 'yt-cinema-rating-count'
    }));
    container.appendChild(likeBtn);

    const dislikeBtn = document.createElement('button');
    dislikeBtn.className = 'yt-cinema-rating-btn yt-cinema-dislike-btn';
    container.appendChild(dislikeBtn);

    const commentsBtn = document.createElement('button');
    commentsBtn.className = 'yt-cinema-btn yt-cinema-comments-btn';
    commentsBtn.appendChild(Object.assign(document.createElement('span'), {
        className: 'yt-cinema-comments-count'
    }));
    container.appendChild(commentsBtn);

    const commentsPanel = document.createElement('div');
    commentsPanel.className = 'yt-cinema-comments-panel';
    for (const cls of ['yt-cinema-comments-total', 'yt-cinema-comments-status',
        'yt-cinema-comments-list', 'yt-cinema-comments-more', 'yt-cinema-comments-close']) {
        commentsPanel.appendChild(Object.assign(document.createElement('div'), { className: cls }));
    }
    playerWrapper.appendChild(commentsPanel);

    for (const cls of ['yt-cinema-drag-shield', 'yt-cinema-shutter-flash']) {
        container.appendChild(document.createElement('div', cls));
    }

    const volumeHud = document.createElement('div');
    volumeHud.className = 'yt-cinema-volume-hud';
    volumeHud.innerHTML = `
        <span class="yt-cinema-volume-icon"></span>
        <div class="yt-cinema-volume-track">
            <div class="yt-cinema-volume-fill"></div>
        </div>
        <span class="yt-cinema-volume-text">100%</span>
    `;
    container.appendChild(volumeHud);

    const toast = document.createElement('div');
    toast.className = 'yt-cinema-toast';
    const toastIcon = document.createElement('span');
    toastIcon.className = 'yt-cinema-toast-icon';
    const toastText = document.createElement('span');
    toastText.className = 'yt-cinema-toast-text';
    toast.appendChild(toastIcon);
    toast.appendChild(toastText);
    container.appendChild(toast);

    overlay.appendChild(container);
    document.body.appendChild(overlay);
    overlay._connectedTo = true;

    const iframe = document.createElement('iframe');
    iframe.className = 'yt-cinema-iframe';
    iframe.contentWindow = { postMessage() {} };

    return { overlay, container, iframe, speedPill, speedMenu, qualityPill, qualityMenu, titleSpan,
        subscribeBtn, likeBtn, dislikeBtn, commentsBtn, commentsPanel };
}

/** A minimal fake YouTube <video> + movie_player pair. */
function createEmbedDocument(document) {
    const embedDoc = new (require('./dom').Document)();

    const media = embedDoc.createElement('video');
    media.videoWidth = 1280;
    media.videoHeight = 720;
    media.volume = 1;
    media.muted = false;
    media.paused = false;
    media.ended = false;
    media.readyState = 4;
    media.playbackRate = 1;
    media.currentTime = 0;
    media.play = () => { media.paused = false; return Promise.resolve(); };
    media.pause = () => { media.paused = true; };

    const player = embedDoc.createElement('div');
    player.id = 'movie_player';
    player.className = 'html5-video-player ytp-autohide';
    player.getAvailableQualityLevels = () => ['auto', 'hd1080', 'hd720'];
    player.getAvailableQualityData = () => [
        { quality: 'hd1080', qualityLabel: '1080p HD', isHd: true },
        { quality: 'hd720', qualityLabel: '720p HD', isHd: true }
    ];
    player.getPlaybackQuality = () => 'hd1080';
    player.setPlaybackQuality = () => {};
    player.setPlaybackQualityRange = () => {};
    player.setVolume = () => {};
    player.getVolume = () => 100;
    player.mute = () => { media.muted = true; };
    player.unMute = () => { media.muted = false; };
    player.isMuted = () => media.muted;
    player.setPlaybackRate = () => {};

    embedDoc.body.appendChild(player);
    embedDoc.body.appendChild(media);
    media._connectedTo = true;
    player._connectedTo = true;
    embedDoc.body._connectedTo = true;

    return { embedDoc, media, player };
}

/**
 * Assemble a control context close enough to the real one for unit tests:
 * same element map, same shared flags object, same getPlayerElements contract.
 */
function createContext(env, options = {}) {
    const dom = buildOverlayDom(env.document);
    const embed = options.embed || createEmbedDocument(env.document);

    dom.iframe.contentDocument = embed.embedDoc;

    const flags = { speedMenuOpen: false, qualityMenuOpen: false, commentsOpen: false };

    const ctx = {
        overlayElement: dom.overlay,
        container: dom.container,
        iframe: dom.iframe,
        dom,
        embed,
        flags,
        isDocked: false,
        initialTimestamp: null,
        isDirectPiP: false,
        els: {
            container: dom.container,
            playerWrapper: dom.container.querySelector('.yt-cinema-player-wrapper'),
            header: dom.container.querySelector('.yt-cinema-header'),
            footer: dom.container.querySelector('.yt-cinema-footer'),
            closeBtn: dom.container.querySelector('.yt-cinema-close-btn'),
            pipBtn: dom.container.querySelector('.yt-cinema-pip-btn'),
            newTabBtn: dom.container.querySelector('.yt-cinema-newtab-btn'),
            copyBtn: dom.container.querySelector('.yt-cinema-copy-btn'),
            screenshotBtn: dom.container.querySelector('.yt-cinema-screenshot-btn'),
            dockBtn: dom.container.querySelector('.yt-cinema-dock-btn'),
            prevBtn: dom.container.querySelector('.yt-cinema-prev-btn'),
            nextBtn: dom.container.querySelector('.yt-cinema-next-btn'),
            subscribeBtn: dom.subscribeBtn,
            likeBtn: dom.likeBtn,
            dislikeBtn: dom.dislikeBtn,
            commentsBtn: dom.commentsBtn,
            commentsPanel: dom.commentsPanel,
            commentsList: dom.commentsPanel.querySelector('.yt-cinema-comments-list'),
            commentsTotal: dom.commentsPanel.querySelector('.yt-cinema-comments-total'),
            commentsMore: dom.commentsPanel.querySelector('.yt-cinema-comments-more'),
            commentsClose: dom.commentsPanel.querySelector('.yt-cinema-comments-close'),
            commentsStatus: dom.commentsPanel.querySelector('.yt-cinema-comments-status'),
            speedPill: dom.speedPill,
            speedMenu: dom.speedMenu,
            qualityPill: dom.qualityPill,
            qualityMenu: dom.qualityMenu,
            dragShield: dom.container.querySelector('.yt-cinema-drag-shield'),
            shutterFlash: dom.container.querySelector('.yt-cinema-shutter-flash'),
            volumeHud: dom.container.querySelector('.yt-cinema-volume-hud'),
            toast: dom.container.querySelector('.yt-cinema-toast')
        },
        getPlayerElements() {
            return { video: embed.media, player: embed.player };
        }
    };

    ctx.ambient = { start() {}, stop() {} };

    ctx.autohide = {
        resets: 0,
        reset() { this.resets++; },
        noteActivity() {},
        noteVideoActivity() {},
        leaveVideoFrame() {},
        showControls() {},
        showVideoControls() {},
        hideVideoControls() {},
        clearTimers() {},
        syncVideoControls() {},
        isHoveringVideoFrame: () => false,
        update() {}
    };

    ctx.toast = {
        shown: [],
        show(message) { this.shown.push(message); },
        clear() {}
    };

    ctx._closed = 0;
    ctx.close = () => { ctx._closed++; };

    ctx.quality = {
        resets: 0,
        closed: 0,
        resetForNewVideo() { this.resets++; },
        closeMenu() { this.closed++; flags.qualityMenuOpen = false; },
        handleMenuKey: () => false,
        toggleMenu() {},
        applyToPlayer() {},
        queryFromPlayer() {},
        injectBridge() {}
    };

    ctx.speed = {
        closed: 0,
        closeMenu() { this.closed++; flags.speedMenuOpen = false; },
        changeByStep() {},
        applyToPlayer() {},
        syncFromPlayer() {}
    };

    ctx.dock = { toggles: 0, toggle() { this.toggles++; }, bringToFront() {}, initDockedState() {}, cancelPendingFrames() {}, endResize() {}, bind() {} };
    ctx.screenshot = { takes: 0, takeScreenshot() { this.takes++; }, bind() {} };
    ctx.history = {
        changed: 0,
        stops: 0,
        onPlaying() {},
        onPaused() {},
        onEnded() {},
        onSeeking() {},
        onVideoChanged() { this.changed++; },
        stop() { this.stops++; },
        flush() {},
        isActive: () => false
    };

    return ctx;
}

module.exports = { loadExtension, buildOverlayDom, createEmbedDocument, createContext, makeEvent, MODULE_ORDER, ROOT };
