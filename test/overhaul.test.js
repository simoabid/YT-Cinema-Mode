/**
 * Tests for the YouTube Cinema Mode v2.0.0 overhaul:
 *   1. Manifest registration, version alignment & background/core defaults
 *   2. Expanded theme engine (OLED Crimson & Nord Arctic + tokens)
 *   3. A-B segment loop & seamless full-video repeat + keyboard bindings
 *   4. Interactive Chapters & Video Info drawer + InnerTube/description parsing
 *   5. Watch Queue store, persistence, hover/+Queue/Alt+Q triggers, drawer & auto-advance
 *   6. Visual grading filters & ultrawide zoom presets + autohide suppression
 *   7. Zen Focus Mode & Sleep Timer + expiration + cleanup
 *   8. Tabbed Popup UI (ARIA tabs, keyboard nav, v2.0 settings load/save)
 *   9. Controller full teardown & Escape priority chain
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadExtension, createContext, makeEvent, ROOT } = require('./harness');
const { createDomEnv, parseHTML } = require('./dom');

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

const CHAPTERS_NEXT_PAYLOAD = {
    contents: {
        twoColumnWatchNextResults: {
            results: {
                results: {
                    contents: [
                        {
                            videoPrimaryInfoRenderer: {
                                title: { runs: [{ text: 'Cinema Demo Video' }] },
                                viewCount: {
                                    videoViewCountRenderer: {
                                        shortViewCount: { simpleText: '42K views' }
                                    }
                                },
                                relativeDateText: { simpleText: '2 days ago' }
                            }
                        },
                        {
                            videoSecondaryInfoRenderer: {
                                owner: {
                                    videoOwnerRenderer: {
                                        title: { runs: [{ text: 'Cinema Channel' }] }
                                    }
                                },
                                attributedDescription: {
                                    content: 'Detailed video description that is long enough to test expand and collapse behavior in the chapters and video info panel. Let us make sure it exceeds one hundred eighty characters easily so clicking it toggles the expanded state.'
                                }
                            }
                        }
                    ]
                }
            }
        }
    },
    frameworkUpdates: {
        entityBatchUpdate: {
            mutations: [{
                payload: {
                    macroMarkersListEntity: {
                        markersList: {
                            markers: [
                                { title: 'Introduction', startMillis: '0' },
                                { title: 'Deep Dive', startMillis: '65000' },
                                { title: 'Finale', startMillis: '3723000' }
                            ]
                        }
                    }
                }
            }]
        }
    }
};

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function setupRealOverlay({ videoId = 'vidMain1', isShort = false, startDocked = false, initQueue = [] } = {}) {
    const env = loadExtension();
    for (const item of initQueue) {
        env.YTC.queue.add(item);
    }
    const base = createContext(env);
    const ctx = env.YTC.controller.setupOverlayEvents(base.overlayElement, base.iframe, {
        videoId,
        initialTimestamp: null,
        isShort,
        ambientCtx: null,
        ambientCanvas: null,
        ambientLayer: null,
        startDocked,
        isDirectPiP: false
    });
    return { env, ctx, base };
}

// -----------------------------------------------------------------------------
// 1. Version, manifests & defaults
// -----------------------------------------------------------------------------

describe('v2.0.0 manifests and defaults', () => {
    it('aligns version 2.0.0 and registers all new scripts and styles in both manifests', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        assert(pkg.version === '2.0.0', `expected package.json 2.0.0, got ${pkg.version}`);

        const expectedModules = [
            'content/modules/chapters.js',
            'content/modules/queue.js',
            'content/modules/controls/loop.js',
            'content/modules/controls/chapters.js',
            'content/modules/controls/queue.js',
            'content/modules/controls/filters.js',
            'content/modules/controls/zen.js'
        ];
        const expectedStyles = [
            'content/styles/09-loop-chapters.css',
            'content/styles/10-queue-filters.css'
        ];

        for (const manifestFile of ['manifest.json', 'manifest.firefox.json']) {
            const m = JSON.parse(fs.readFileSync(path.join(ROOT, manifestFile), 'utf8'));
            assert(m.version === '2.0.0', `${manifestFile} version should be 2.0.0, got ${m.version}`);
            const cs = m.content_scripts[0];
            const controllerIdx = cs.js.indexOf('content/modules/controller.js');
            assert(controllerIdx > 0, `${manifestFile} missing controller.js`);

            for (const mod of expectedModules) {
                const idx = cs.js.indexOf(mod);
                assert(idx >= 0, `${manifestFile} missing ${mod}`);
                assert(idx < controllerIdx, `${manifestFile}: ${mod} must load before controller.js`);
            }
            for (const css of expectedStyles) {
                assert(cs.css.includes(css), `${manifestFile} missing ${css}`);
            }
        }
    });

    it('includes v2.0 defaults in YTC.defaults and background/background.js', async () => {
        const env = loadExtension();
        assert(env.YTC.KEYS.queue === 'ytCinemaQueue', `wrong queue key: ${env.YTC.KEYS.queue}`);
        assert(env.YTC.defaults.defaultZenMode === false, 'defaultZenMode default should be false');
        assert(env.YTC.defaults.autoAdvanceQueue === true, 'autoAdvanceQueue default should be true');
        assert(Array.isArray(env.YTC.state.queue), 'YTC.state.queue should initialize as an array');

        let onInstalledCb = null;
        let seeded = null;
        const bgCode = fs.readFileSync(path.join(ROOT, 'background/background.js'), 'utf8');
        const bgSandbox = {
            console,
            crypto,
            TextEncoder,
            Uint8Array,
            chrome: {
                runtime: {
                    onInstalled: { addListener(fn) { onInstalledCb = fn; } },
                    onMessage: { addListener() {} }
                },
                commands: { onCommand: { addListener() {} } },
                declarativeNetRequest: { updateDynamicRules: async () => {} },
                storage: {
                    sync: {
                        get: async () => ({}),
                        set: async (obj) => { seeded = obj; }
                    }
                },
                tabs: { query: async () => [], sendMessage: async () => {} }
            }
        };
        vm.runInContext(bgCode, vm.createContext(bgSandbox), { filename: 'background/background.js' });
        assert(typeof onInstalledCb === 'function', 'background.js should register onInstalled');
        await onInstalledCb({ reason: 'install' });
        assert(seeded && seeded.cinemaSettings, 'install should seed cinemaSettings');
        assert(seeded.cinemaSettings.defaultZenMode === false, 'background defaultZenMode should be false');
        assert(seeded.cinemaSettings.autoAdvanceQueue === true, 'background autoAdvanceQueue should be true');
    });
});

// -----------------------------------------------------------------------------
// 2. Expanded Theme Engine
// -----------------------------------------------------------------------------

describe('expanded theme engine', () => {
    it('supports oled-crimson and nord in theme.js and 00-themes.css', () => {
        const env = loadExtension();

        for (const id of ['oled-crimson', 'nord']) {
            assert(env.YTC.theme.THEMES.includes(id), `THEMES missing ${id}`);
            env.YTC.theme.apply(id);
            assert(
                env.document.documentElement.getAttribute('data-ytc-theme') === id,
                `apply('${id}') did not update data-ytc-theme`
            );

            env.YTC.applySettings({ theme: id });
            assert(
                env.document.documentElement.getAttribute('data-ytc-theme') === id,
                `applySettings({ theme: '${id}' }) did not update data-ytc-theme`
            );
        }

        const css = fs.readFileSync(path.join(ROOT, 'content/styles/00-themes.css'), 'utf8');
        for (const id of ['oled-crimson', 'nord']) {
            assert(css.includes(`[data-ytc-theme="${id}"]`), `00-themes.css missing selector for ${id}`);
        }
        for (const token of ['--ytc-base', '--ytc-crust', '--ytc-mantle', '--ytc-text', '--ytc-sapphire',
            '--ytc-red', '--ytc-green', '--ytc-text-rgb', '--ytc-crust-rgb', '--ytc-sapphire-rgb']) {
            const count = css.split(token).length - 1;
            assert(count >= 6, `expected token ${token} in all 6 palette blocks, found ${count} occurrences`);
        }
    });
});

// -----------------------------------------------------------------------------
// 3. A-B Loop & Repeat
// -----------------------------------------------------------------------------

describe('loop control', () => {
    it('cycles A-B loop points, enforces >0.5s guard, rewinds on timeupdate and clears cleanly', () => {
        const env = loadExtension();
        const ctx = createContext(env);
        const loop = env.YTC.controls.loop.createLoopControl(ctx);
        loop.bind();

        ctx.embed.media.currentTime = 12;
        loop.cycleABLoop();
        assert(loop.getState().mode === 'point-a', 'expected point-a after first cycle');
        assert(loop.getState().loopStart === 12, 'expected loopStart=12');
        assert(ctx.els.loopBtn.classList.contains('yt-cinema-loop-active'), 'button should mark loop active');
        assert(ctx.els.loopBtn.querySelector('.yt-cinema-loop-badge').textContent === 'A', 'badge should show A');
        assert(ctx.els.loopBar.classList.contains('yt-cinema-loop-bar-visible'), 'loop bar should be visible');

        // Guard rejects point B too close to point A
        ctx.embed.media.currentTime = 12.2;
        loop.cycleABLoop();
        assert(loop.getState().mode === 'point-a', 'point B within 0.5s should stay at point-a');
        assert(ctx.toast.shown.some((t) => /Move past Point A/.test(t)), 'guard toast should fire');

        // Valid Point B
        ctx.embed.media.currentTime = 45;
        loop.cycleABLoop();
        assert(loop.getState().mode === 'looping', 'expected looping state');
        assert(loop.getState().loopEnd === 45, 'expected loopEnd=45');
        assert(ctx.els.loopBtn.querySelector('.yt-cinema-loop-badge').textContent === 'A-B', 'badge should show A-B');
        assert(ctx.els.loopFill.style.left === '2%', `expected 2% left, got ${ctx.els.loopFill.style.left}`);
        assert(ctx.els.loopFill.style.width === '5.5%', `expected 5.5% width, got ${ctx.els.loopFill.style.width}`);

        // Below loopEnd stays untouched
        ctx.embed.media.currentTime = 30;
        ctx.embed.media.dispatchEvent(makeEvent('timeupdate'));
        assert(ctx.embed.media.currentTime === 30, 'timeupdate below end should not seek');

        // At/past loopEnd rewinds to loopStart
        ctx.embed.media.currentTime = 46;
        ctx.embed.media.dispatchEvent(makeEvent('timeupdate'));
        assert(ctx.embed.media.currentTime === 12, `expected rewind to 12, got ${ctx.embed.media.currentTime}`);

        // Third cycle turns A-B loop off
        loop.cycleABLoop();
        assert(loop.getState().mode === 'off', 'third cycle should clear A-B loop');
        assert(!ctx.els.loopBar.classList.contains('yt-cinema-loop-bar-visible'), 'loop bar should hide');
        assert(ctx.els.loopFill.style.width === '', 'loop fill width should reset');
    });

    it('toggles seamless video repeat on button Shift+Click / R / toggleRepeatAll and resets per video', () => {
        const env = loadExtension();
        const ctx = createContext(env);
        const loop = env.YTC.controls.loop.createLoopControl(ctx);
        ctx.loop = loop;
        const keyboard = env.YTC.controls.keyboard.createKeyboardControl(ctx);
        loop.bind();
        keyboard.bind();

        ctx.els.loopBtn.dispatchEvent(makeEvent('click', { shiftKey: true }));
        assert(loop.getState().repeatAll === true, 'Shift+Click should enable repeatAll');
        assert(ctx.embed.media.loop === true, 'video.loop should become true');
        assert(ctx.els.loopBtn.classList.contains('yt-cinema-repeat-active'), 'repeat active class missing');
        assert(ctx.els.loopBtn.querySelector('.yt-cinema-loop-badge').textContent === '∞', 'badge should show ∞');

        // R shortcut toggles repeat off; modified Ctrl+R is ignored
        env.window.dispatchEvent(makeEvent('keydown', { key: 'r', ctrlKey: true, preventDefault() {} }));
        assert(loop.getState().repeatAll === true, 'Ctrl+R must not toggle repeat');

        env.window.dispatchEvent(makeEvent('keydown', { key: 'r', preventDefault() {} }));
        assert(loop.getState().repeatAll === false, 'R key should toggle repeat off');
        assert(ctx.embed.media.loop === false, 'video.loop should reset to false');

        // B shortcut triggers A-B loop; resetForNewVideo clears both
        ctx.embed.media.currentTime = 20;
        env.window.dispatchEvent(makeEvent('keydown', { key: 'b', preventDefault() {} }));
        assert(loop.getState().mode === 'point-a', 'B key should trigger cycleABLoop');
        loop.toggleRepeatAll(true);

        loop.resetForNewVideo();
        assert(loop.getState().mode === 'off' && loop.getState().repeatAll === false, 'resetForNewVideo must clear loop state');
        assert(ctx.embed.media.loop === false, 'resetForNewVideo must clear video.loop');

        keyboard.dispose();
        loop.dispose();
    });
});

// -----------------------------------------------------------------------------
// 4. Interactive Chapters & Video Info Drawer
// -----------------------------------------------------------------------------

describe('chapters and video info drawer', () => {
    it('formats and parses timestamps cleanly and falls back to description lines', () => {
        const env = loadExtension();
        const ch = env.YTC.chapters;

        assert(ch.formatTimestamp(0) === '0:00', '0s formatting');
        assert(ch.formatTimestamp(65) === '1:05', '65s formatting');
        assert(ch.formatTimestamp(3723) === '1:02:03', '3723s formatting');
        assert(ch.formatTimestamp(-5) === '0:00', 'negative clamp');

        const parsed = ch.parseTimestamps([
            '0:00 Intro',
            '1) [01:05] - Second Topic',
            'Wrap Up - 10:05',
            '0:00 Duplicate should be ignored',
            '99:99 Invalid seconds',
            '1:02:03 Long Chapter'
        ].join('\n'));

        assert(parsed.length === 4, `expected 4 parsed chapters, got ${parsed.length}`);
        assert(parsed[0].startSeconds === 0 && parsed[0].title === 'Intro', 'chapter 0 mismatch');
        assert(parsed[1].startSeconds === 65 && parsed[1].title === 'Second Topic', 'chapter 1 mismatch');
        assert(parsed[2].startSeconds === 605 && parsed[2].title === 'Wrap Up', 'chapter 2 mismatch');
        assert(parsed[3].startSeconds === 3723 && parsed[3].timeText === '1:02:03', 'chapter 3 mismatch');

        // extractFromNext with macroMarkersListEntity
        const structured = ch.extractFromNext(CHAPTERS_NEXT_PAYLOAD);
        assert(structured.meta.channelName === 'Cinema Channel', 'channel name missing');
        assert(structured.meta.viewCountText === '42K views', 'views missing');
        assert(structured.meta.publishedText === '2 days ago', 'published missing');
        assert(structured.chapters.length === 3, `expected 3 structured chapters, got ${structured.chapters.length}`);
        assert(structured.chapters[1].timeText === '1:05', 'structured chapter 1 timeText');

        // Fallback to description timestamps + chapterRenderer + macroMarkersListItemRenderer
        const fallback = ch.extractFromNext({
            videoSecondaryInfoRenderer: {
                description: { runs: [{ text: '0:00 Alpha\n02:30 Beta' }] }
            }
        });
        assert(fallback.chapters.length === 2 && fallback.chapters[1].startSeconds === 150, 'description fallback failed');

        const legacy = ch.extractFromNext({
            chapters: [
                { chapterRenderer: { title: { simpleText: 'Legacy One' }, timeRangeStartMillis: '15000' } },
                { macroMarkersListItemRenderer: { title: { simpleText: 'Item Two' }, timeDescription: { simpleText: '0:45' } } }
            ]
        });
        assert(legacy.chapters.length === 2 && legacy.chapters[0].startSeconds === 15 && legacy.chapters[1].startSeconds === 45, 'legacy chapter shapes failed');
    });

    it('renders chapters drawer, seeks on click, tracks active chapter, toggles description & mutually closes drawers', async () => {
        const env = loadExtension();
        const cfgScript = env.document.createElement('script');
        cfgScript.textContent = 'ytcfg.set({"INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"2.0","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.0"}}});';
        env.document.head.appendChild(cfgScript);

        env.YTC.innertube.post = async () => ({ ok: true, data: CHAPTERS_NEXT_PAYLOAD });

        const ctx = createContext(env);
        ctx.currentVideoId = 'chVid1';
        let commentsClosed = 0;
        let queueClosed = 0;
        ctx.engagement = { toggleComments(open) { if (open === false) { ctx.flags.commentsOpen = false; commentsClosed++; } } };
        ctx.queue = { togglePanel(open) { if (open === false) { ctx.flags.queueOpen = false; queueClosed++; } } };

        const chaptersCtrl = env.YTC.controls.chapters.createChaptersControl(ctx);
        ctx.chapters = chaptersCtrl;
        const keyboard = env.YTC.controls.keyboard.createKeyboardControl(ctx);
        chaptersCtrl.bind();
        keyboard.bind();

        await wait(15);

        assert(ctx.els.chaptersBtn.querySelector('.yt-cinema-chapters-count').textContent === '3', 'chapters badge count should be 3');
        const rows = ctx.els.chaptersList.querySelectorAll('.yt-cinema-chapter-item');
        assert(rows.length === 3, `expected 3 chapter rows, got ${rows.length}`);

        // Open comments and queue flags, then press O -> opens chapters and closes both
        ctx.flags.commentsOpen = true;
        ctx.flags.queueOpen = true;
        env.window.dispatchEvent(makeEvent('keydown', { key: 'o', preventDefault() {} }));
        assert(chaptersCtrl.isOpen() && ctx.flags.chaptersOpen, 'O key should open chapters drawer');
        assert(commentsClosed === 1 && queueClosed === 1, 'opening chapters must close comments & queue drawers');

        // Expand collapsible long description
        const descEl = ctx.els.chaptersMeta.querySelector('.yt-cinema-chapters-desc');
        assert(descEl && !descEl.classList.contains('yt-cinema-chapters-desc-expanded'), 'description starts collapsed');
        descEl.click();
        assert(descEl.classList.contains('yt-cinema-chapters-desc-expanded'), 'clicking description should expand it');

        // Click second chapter -> seeks to 65s & marks active
        rows[1].click();
        assert(ctx.transport.seeks[0] === 65, `expected seekToSeconds(65), got ${ctx.transport.seeks[0]}`);
        assert(rows[1].classList.contains('yt-cinema-chapter-active'), 'clicked chapter should become active');

        // syncActiveChapter moves highlight as time advances
        chaptersCtrl.syncActiveChapter(3725);
        assert(rows[2].classList.contains('yt-cinema-chapter-active'), 'chapter 2 should be active at 3725s');
        assert(!rows[1].classList.contains('yt-cinema-chapter-active'), 'chapter 1 should clear active class');

        // Escape while focused inside chapters panel closes it
        env.document.activeElement = rows[2];
        env.window.dispatchEvent(makeEvent('keydown', { key: 'Escape', preventDefault() {} }));
        assert(!chaptersCtrl.isOpen() && !ctx.flags.chaptersOpen, 'Escape should close chapters drawer');

        env.document.activeElement = null;
        keyboard.dispose();
        chaptersCtrl.dispose();
    });
});

// -----------------------------------------------------------------------------
// 5. Watch Queue & Auto-Advance
// -----------------------------------------------------------------------------

describe('watch queue and auto-advance', () => {
    it('adds, deduplicates, persists, removes, shifts, clears and reloads queue from storage.local', () => {
        const env = loadExtension();
        const events = [];
        const unsub = env.YTC.queue.subscribe((items) => events.push(items.length));

        assert(env.YTC.queue.add({ videoId: 'q1', title: 'First', isShort: false }) === true, 'first add should return true');
        assert(env.YTC.queue.add({ videoId: 'q1', title: 'Duplicate' }) === false, 'duplicate add should return false');
        assert(env.YTC.queue.add({ videoId: 'q2', title: 'Second', isShort: true }) === true, 'second add should return true');
        assert(env.YTC.queue.count() === 2, 'count should be 2');
        assert(env.store.local[env.YTC.KEYS.queue].length === 2, 'queue should persist to local storage');
        assert(JSON.stringify(events) === JSON.stringify([1, 2]), 'subscriber should receive lengths [1, 2]');

        const shifted = env.YTC.queue.shift();
        assert(shifted.videoId === 'q1' && env.YTC.queue.count() === 1, 'shift should pop first item');

        env.YTC.queue.remove('q2');
        assert(env.YTC.queue.count() === 0, 'remove should leave 0 items');

        env.YTC.queue.add({ videoId: 'q3', title: 'Third' });
        env.YTC.queue.clear();
        assert(env.YTC.queue.count() === 0, 'clear should empty queue');

        const beforeUnsub = events.length;
        unsub();
        env.YTC.queue.add({ videoId: 'q4', title: 'After Unsub' });
        assert(events.length === beforeUnsub && beforeUnsub === 6, `unsubscribed listener must not be notified (got ${events.length})`);

        // Pre-populated local storage reloads on YTC.initSettings()
        const env2 = loadExtension();
        env2.store.local[env2.YTC.KEYS.queue] = [{ videoId: 'stored1', title: 'Stored Vid', isShort: false }];
        env2.YTC.initSettings();
        assert(env2.YTC.queue.count() === 1 && env2.YTC.queue.getAll()[0].videoId === 'stored1', 'initSettings should load stored queue');
    });

    it('queues hovered video via + Queue button click and Alt+Q without opening overlay', async () => {
        const env = loadExtension({}, { boot: true });
        const { document } = env;

        const card = document.createElement('ytd-rich-item-renderer');
        const link = document.createElement('a');
        link.id = 'thumbnail';
        link.setAttribute('href', 'https://www.youtube.com/watch?v=queueVid1');
        const title = document.createElement('span');
        title.id = 'video-title';
        title.textContent = 'Queued From Hover';
        card.appendChild(link);
        card.appendChild(title);
        document.body.appendChild(card);

        document.dispatchEvent(makeEvent('mouseover', { target: link }));
        await wait(20);

        const queueBtn = document.querySelector('.yt-cinema-hover-queue-btn');
        assert(queueBtn, 'hover indicator should contain .yt-cinema-hover-queue-btn');

        queueBtn.dispatchEvent(makeEvent('click'));
        assert(!env.YTC.state.activeModalOverlay, 'clicking + Queue must NOT open the cinema overlay');
        assert(env.YTC.queue.count() === 1 && env.YTC.queue.getAll()[0].videoId === 'queueVid1', '+ Queue button should add video');

        const pageToast = document.querySelector('.yt-cinema-page-toast');
        assert(pageToast && pageToast.classList.contains('yt-cinema-toast-visible'), 'page toast should appear on queue');

        // Second video via Alt+Q
        const link2 = document.createElement('a');
        link2.id = 'thumbnail';
        link2.setAttribute('href', 'https://www.youtube.com/watch?v=queueVid2');
        env.YTC.state.currentTarget = link2;
        document.dispatchEvent(makeEvent('keydown', { key: 'q', altKey: true, repeat: false }));
        assert(env.YTC.queue.count() === 2 && env.YTC.queue.getAll()[1].videoId === 'queueVid2', 'Alt+Q should add video');
        assert(!env.YTC.state.activeModalOverlay, 'Alt+Q must NOT open overlay');
    });

    it('operates Queue drawer actions and auto-advances on video end except when repeatAll, disabled or Short', () => {
        const { env, ctx } = setupRealOverlay({
            videoId: 'initial1',
            initQueue: [
                { videoId: 'nextQ1', title: 'Next Queued 1', isShort: false },
                { videoId: 'nextQ2', title: 'Next Queued 2', isShort: false },
                { videoId: 'nextQ3', title: 'Next Queued 3', isShort: false }
            ]
        });

        // Open Queue drawer via U key; clicking title loads video & removes it
        env.window.dispatchEvent(makeEvent('keydown', { key: 'u', preventDefault() {} }));
        assert(ctx.queue.isOpen() && ctx.flags.queueOpen, 'U key should open queue drawer');
        assert(ctx.els.queueBtn.querySelector('.yt-cinema-queue-count').textContent === '3', 'queue badge count should show 3');

        const firstRowTitle = ctx.els.queueList.querySelector('.yt-cinema-queue-item-title');
        firstRowTitle.click();
        assert(ctx.currentVideoId === 'nextQ1', `expected load nextQ1, got ${ctx.currentVideoId}`);
        assert(env.YTC.queue.count() === 2, 'playing queue item should remove it from queue');

        // Remove nextQ2 via X remove button without switching video
        ctx.els.queueList.querySelector('.yt-cinema-queue-item-remove').click();
        assert(env.YTC.queue.count() === 1 && ctx.currentVideoId === 'nextQ1', 'remove button should drop item only');

        // Bind embed video and test ended auto-advance
        const media = ctx.iframe.contentDocument.querySelector('video');
        ctx.overlayElement._bindVideo(media);

        // Repeat ON prevents queue advance
        ctx.loop.toggleRepeatAll(true);
        media.dispatchEvent(makeEvent('ended'));
        assert(ctx.currentVideoId === 'nextQ1' && env.YTC.queue.count() === 1, 'repeatAll must block queue auto-advance');

        // autoAdvanceQueue: false blocks advance
        ctx.loop.toggleRepeatAll(false);
        env.YTC.applySettings({ autoAdvanceQueue: false });
        media.dispatchEvent(makeEvent('ended'));
        assert(ctx.currentVideoId === 'nextQ1' && env.YTC.queue.count() === 1, 'autoAdvanceQueue=false must block advance');

        // Short prevents advance
        env.YTC.applySettings({ autoAdvanceQueue: true });
        ctx.isShort = true;
        media.dispatchEvent(makeEvent('ended'));
        assert(ctx.currentVideoId === 'nextQ1' && env.YTC.queue.count() === 1, 'Shorts must not auto-advance queue');

        // Normal video with repeat OFF and autoAdvanceQueue ON advances cleanly
        ctx.isShort = false;
        media.dispatchEvent(makeEvent('ended'));
        assert(ctx.currentVideoId === 'nextQ3', `expected auto-advance to nextQ3, got ${ctx.currentVideoId}`);
        assert(env.YTC.queue.count() === 0, 'auto-advance should consume nextQ3 from queue');
        assert(ctx.els.queueClear.disabled === true, 'Clear button should be disabled when empty');

        ctx.els.queueClose.click();
        assert(!ctx.queue.isOpen(), 'queue close button should close drawer');
        ctx.overlayElement._close();
    });
});

// -----------------------------------------------------------------------------
// 6. Visual Filters, Ultrawide Zoom & Autohide Blocking
// -----------------------------------------------------------------------------

describe('visual filters and ultrawide zoom', () => {
    it('exports presets/zooms, applies CSS vars, mutually closes menus, handles V/Z/Escape and resets on dispose', () => {
        const env = loadExtension();
        const { PRESETS, ZOOM_LEVELS } = env.YTC.controls.filters;
        assert(Object.keys(PRESETS).join(',') === 'none,vivid,warm,dim,noir', 'unexpected PRESETS keys');
        assert(JSON.stringify(ZOOM_LEVELS) === '[1,1.15,1.34]', 'unexpected ZOOM_LEVELS');

        const ctx = createContext(env);
        const filters = env.YTC.controls.filters.createFiltersControl(ctx);
        ctx.filters = filters;
        const keyboard = env.YTC.controls.keyboard.createKeyboardControl(ctx);
        filters.bind();
        keyboard.bind();

        // Mutual menu exclusion when opening filters
        ctx.flags.speedMenuOpen = true;
        ctx.flags.qualityMenuOpen = true;
        env.window.dispatchEvent(makeEvent('keydown', { key: 'v', preventDefault() {} }));
        assert(ctx.flags.filtersMenuOpen && ctx.els.filtersMenu.classList.contains('yt-cinema-filters-menu-open'), 'V opens filters menu');
        assert(ctx.speed.closed === 1 && ctx.quality.closed === 1, 'opening filters closes speed/quality menus');

        // Clicking noir filter item updates CSS var & marks filters active button
        const noirRow = ctx.els.filtersMenu.querySelector('[data-filter-preset="noir"]');
        ctx.els.filtersMenu.dispatchEvent(makeEvent('click', { target: noirRow }));
        assert(
            ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-filter') === PRESETS.noir.filter,
            'noir CSS filter not applied'
        );
        assert(!ctx.flags.filtersMenuOpen, 'clicking menu item closes menu');
        assert(ctx.els.filtersBtn.classList.contains('yt-cinema-filters-active'), 'active badge should light up');

        // Cycle zoom via Z shortcut: 1 -> 1.15 -> 1.34 -> 1
        env.window.dispatchEvent(makeEvent('keydown', { key: 'z', preventDefault() {} }));
        assert(ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-zoom') === '1.15', 'zoom step 1.15 failed');
        env.window.dispatchEvent(makeEvent('keydown', { key: 'z', preventDefault() {} }));
        assert(ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-zoom') === '1.34', 'zoom step 1.34 failed');
        env.window.dispatchEvent(makeEvent('keydown', { key: 'z', preventDefault() {} }));
        assert(ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-zoom') === '1', 'zoom cycle back to 1 failed');

        // Escape closes open filters menu without closing overlay
        filters.toggleMenu(true);
        env.window.dispatchEvent(makeEvent('keydown', { key: 'Escape', preventDefault() {} }));
        assert(!ctx.flags.filtersMenuOpen && ctx._closed === 0, 'Escape should close filters menu before overlay');

        // Dispose restores none/1
        filters.dispose();
        assert(ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-filter') === 'none', 'dispose should reset filter');
        assert(ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-zoom') === '1', 'dispose should reset zoom');
        assert(!ctx.els.filtersBtn.classList.contains('yt-cinema-filters-active'), 'dispose should clear active class');

        keyboard.dispose();
    });

    it('suppresses autohide while filtersMenuOpen, chaptersOpen, or queueOpen are true', async () => {
        const scenarios = await Promise.all(['filtersMenuOpen', 'chaptersOpen', 'queueOpen', 'none'].map(async (flagName) => {
            const env = loadExtension();
            const ctx = createContext(env);
            ctx.embed.media.paused = false;
            ctx.embed.media.readyState = 4;
            if (flagName !== 'none') ctx.flags[flagName] = true;
            const autohide = env.YTC.controls.autohide.createAutoHideControl(ctx);
            autohide.noteActivity();
            await wait(550);
            const hidden = ctx.els.container.classList.contains('yt-cinema-controls-hidden');
            autohide.clearTimers();
            return { flagName, hidden };
        }));

        for (const { flagName, hidden } of scenarios) {
            if (flagName === 'none') {
                assert(hidden === true, 'baseline autohide should hide controls after 500ms idle');
            } else {
                assert(hidden === false, `autohide should stay visible while ${flagName} is true`);
            }
        }
    });
});

// -----------------------------------------------------------------------------
// 7. Zen Focus Mode & Sleep Timer
// -----------------------------------------------------------------------------

describe('zen focus mode and sleep timer', () => {
    it('exports SLEEP_PRESETS, honors defaultZenMode, handles X/Y shortcuts and pauses on timer expiry', async () => {
        const env = loadExtension();
        assert(JSON.stringify(env.YTC.controls.zen.SLEEP_PRESETS) === '[0,15,30,60]', 'unexpected SLEEP_PRESETS');

        env.YTC.applySettings({ defaultZenMode: true });
        const ctx = createContext(env);
        const zen = env.YTC.controls.zen.createZenControl(ctx);
        ctx.zen = zen;
        const keyboard = env.YTC.controls.keyboard.createKeyboardControl(ctx);

        zen.bind();
        keyboard.bind();

        assert(ctx.els.container.classList.contains('yt-cinema-zen-mode'), 'defaultZenMode should engage zen on bind');
        assert(ctx.els.zenBtn.classList.contains('active'), 'zen button should be active');

        // X toggles Zen off/on
        env.window.dispatchEvent(makeEvent('keydown', { key: 'x', preventDefault() {} }));
        assert(!ctx.els.container.classList.contains('yt-cinema-zen-mode'), 'X should toggle zen off');
        env.window.dispatchEvent(makeEvent('keydown', { key: 'x', preventDefault() {} }));
        assert(ctx.els.container.classList.contains('yt-cinema-zen-mode'), 'X should toggle zen on');

        // Y cycles sleep presets: 0 -> 15 -> 30 -> 60 -> 0
        env.window.dispatchEvent(makeEvent('keydown', { key: 'y', preventDefault() {} }));
        assert(zen.getState().sleepMinutes === 15, 'expected 15m preset');
        assert(ctx.els.zenBtn.querySelector('.yt-cinema-sleep-badge').textContent === '15m', 'badge should show 15m');
        assert(ctx.els.zenBtn.classList.contains('yt-cinema-sleep-active'), 'sleep active class missing');

        env.window.dispatchEvent(makeEvent('keydown', { key: 'y', preventDefault() {} }));
        assert(zen.getState().sleepMinutes === 30, 'expected 30m preset');
        env.window.dispatchEvent(makeEvent('keydown', { key: 'y', preventDefault() {} }));
        assert(zen.getState().sleepMinutes === 60, 'expected 60m preset');
        env.window.dispatchEvent(makeEvent('keydown', { key: 'y', preventDefault() {} }));
        assert(zen.getState().sleepMinutes === 0, 'expected sleep timer off after 60m');

        // Fast expiry test (0.001 min = 60ms) pauses playback and clears badge
        ctx.embed.media.paused = false;
        zen.setSleepTimer(0.001, true);
        await wait(110);
        assert(ctx.transport.pauses === 1 && ctx.embed.media.paused === true, 'sleep expiry should pause video');
        assert(ctx.els.zenBtn.querySelector('.yt-cinema-sleep-badge').textContent === '', 'badge should clear on expiry');
        assert(ctx.toast.shown.includes('Sleep timer paused playback'), 'sleep expiry toast missing');

        // Dispose cancels active timer cleanly before it fires
        ctx.embed.media.paused = false;
        zen.setSleepTimer(0.001, false);
        zen.dispose();
        await wait(110);
        assert(ctx.transport.pauses === 1 && ctx.embed.media.paused === false, 'disposed sleep timer must not fire');

        keyboard.dispose();
    });
});

// -----------------------------------------------------------------------------
// 8. Tabbed Popup UI
// -----------------------------------------------------------------------------

describe('tabbed popup UI', () => {
    it('ships accessible 4-tab layout, preserved field IDs, styles and working JS tab/settings bindings', async () => {
        const html = fs.readFileSync(path.join(ROOT, 'popup/popup.html'), 'utf8');
        const css = fs.readFileSync(path.join(ROOT, 'popup/popup.css'), 'utf8');
        const js = fs.readFileSync(path.join(ROOT, 'popup/popup.js'), 'utf8');

        assert(css.includes('[role="tab"][aria-selected="true"]::after'), 'popup.css missing active tab underline rule');
        assert(css.includes('border-block-end: 2px solid var(--ytc-accent)'), 'popup.css missing accent border-block-end');
        assert(css.includes(':focus-visible'), 'popup.css missing :focus-visible outline');
        assert(html.includes('v2.0.0'), 'popup.html fallback version should be v2.0.0');
        assert(html.includes('value="oled-crimson"') && html.includes('value="nord"'), 'popup.html missing new themes');

        const { window, document } = createDomEnv();
        const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
        assert(bodyMatch, 'failed to extract popup body');

        // Expand boolean HTML attributes so test/dom.js parseHTML captures checked & hidden
        const normalizedBody = bodyMatch[1].replace(/<([a-zA-Z0-9-]+)([^>]*)>/g, (full, tag, attrs) => {
            const expanded = attrs.replace(/\s+(checked|hidden)(?=[\s/]|$)/g, ' $1="$1"');
            return `<${tag}${expanded}>`;
        });
        const parsed = parseHTML(normalizedBody, document);
        for (const child of [...parsed.childNodes]) document.body.appendChild(child);

        for (const el of document.querySelectorAll('*')) {
            if (el.tagName === 'INPUT' && el.getAttribute('type') === 'checkbox') {
                el.checked = el.hasAttribute('checked');
            }
            if (el.tagName === 'INPUT' && el.getAttribute('type') === 'range') {
                el.value = el.getAttribute('value') || '0';
            }
            if (el.tagName === 'SELECT') {
                const firstOpt = el.querySelector('option');
                el.value = firstOpt ? (firstOpt.getAttribute('value') || '') : '';
            }
            if (el.getAttribute('role') === 'tabpanel') {
                el.hidden = el.hasAttribute('hidden');
            }
        }

        const stored = {
            cinemaSettings: {
                theme: 'nord',
                defaultZenMode: true,
                autoAdvanceQueue: false
            }
        };
        let savedWrites = 0;

        const popupSandbox = {
            window,
            document,
            console,
            Promise,
            chrome: {
                runtime: { getManifest: () => ({ version: '2.0.0' }) },
                storage: {
                    sync: {
                        get(keys, cb) { cb(stored); },
                        set(obj, cb) {
                            Object.assign(stored, obj);
                            savedWrites++;
                            cb && cb();
                        }
                    }
                }
            }
        };
        vm.runInContext(js, vm.createContext(popupSandbox), { filename: 'popup/popup.js' });
        document.dispatchEvent(makeEvent('DOMContentLoaded'));
        await wait(10);

        const tabs = document.querySelectorAll('[role="tab"]');
        const panels = document.querySelectorAll('[role="tabpanel"]');
        assert(tabs.length === 4 && panels.length === 4, 'popup must expose 4 tabs and 4 panels');
        assert(panels.every((p) => p.querySelector('.popup-tabpanel-inner')), 'every tabpanel needs .popup-tabpanel-inner');

        assert(document.getElementById('popupVersion').textContent === 'v2.0.0', 'popup version text mismatch');
        assert(document.documentElement.getAttribute('data-ytc-theme') === 'nord', 'popup did not apply loaded nord theme');
        assert(document.getElementById('defaultZenMode').checked === true, 'defaultZenMode did not load');
        assert(document.getElementById('autoAdvanceQueue').checked === false, 'autoAdvanceQueue did not load');

        // Verify tab click + keyboard ArrowRight/ArrowLeft/Home/End navigation
        tabs[1].click();
        assert(tabs[1].getAttribute('aria-selected') === 'true' && panels[1].hidden === false && panels[0].hidden === true, 'click tab activation failed');

        const tablist = document.querySelector('[role="tablist"]');
        tablist.dispatchEvent(makeEvent('keydown', { key: 'ArrowRight', preventDefault() {} }));
        assert(tabs[2].getAttribute('aria-selected') === 'true' && panels[2].hidden === false, 'ArrowRight tab navigation failed');

        tablist.dispatchEvent(makeEvent('keydown', { key: 'End', preventDefault() {} }));
        assert(tabs[3].getAttribute('aria-selected') === 'true' && panels[3].hidden === false, 'End tab navigation failed');

        tablist.dispatchEvent(makeEvent('keydown', { key: 'Home', preventDefault() {} }));
        assert(tabs[0].getAttribute('aria-selected') === 'true' && panels[0].hidden === false, 'Home tab navigation failed');

        // Change theme to oled-crimson and verify live attribute + save
        const themeSelect = document.getElementById('theme');
        themeSelect.value = 'oled-crimson';
        themeSelect.dispatchEvent(makeEvent('change'));
        await wait(10);
        assert(document.documentElement.getAttribute('data-ytc-theme') === 'oled-crimson', 'theme dropdown did not apply oled-crimson');
        assert(stored.cinemaSettings.theme === 'oled-crimson' && savedWrites >= 1, 'theme change was not saved');
    });
});

// -----------------------------------------------------------------------------
// 9. Controller Full Teardown
// -----------------------------------------------------------------------------

describe('controller v2.0 full teardown', () => {
    it('closes filters, chapters, queue, zen mode and resets state flags on overlay close', async () => {
        const { env, ctx, base } = setupRealOverlay({
            videoId: 'teardown1',
            initQueue: [{ videoId: 'queuedAfter', title: 'Stay in Queue' }]
        });

        let sleepPausesAfterClose = 0;
        ctx.filters.toggleMenu(true);
        ctx.filters.setPreset('dim', false);
        ctx.chapters.togglePanel(true);
        ctx.queue.togglePanel(true);
        ctx.zen.toggleZen(true, false);
        ctx.zen.setSleepTimer(0.001, false);

        ctx.overlayElement._close();
        base.embed.media.pause = () => { sleepPausesAfterClose++; };

        assert(!ctx.flags.filtersMenuOpen, 'filtersMenuOpen survived teardown');
        assert(!ctx.flags.chaptersOpen, 'chaptersOpen survived teardown');
        assert(!ctx.flags.queueOpen, 'queueOpen survived teardown');
        assert(!ctx.els.filtersMenu.classList.contains('yt-cinema-filters-menu-open'), 'filters menu open class survived');
        assert(!ctx.els.chaptersPanel.classList.contains('yt-cinema-chapters-open'), 'chapters panel open class survived');
        assert(!ctx.els.queuePanel.classList.contains('yt-cinema-queue-open'), 'queue panel open class survived');
        assert(!ctx.els.container.classList.contains('yt-cinema-zen-mode'), 'zen class survived teardown');
        assert(ctx.els.playerWrapper.style.getPropertyValue('--yt-cinema-video-filter') === 'none', 'filter CSS var survived');

        await wait(110);
        assert(sleepPausesAfterClose === 0, 'sleep timer must be cleared on overlay teardown');
        // Ensure queue subscription was cleanly unsubscribed without throwing
        env.YTC.queue.add({ videoId: 'postCloseVid', title: 'Safe' });
        assert(env.YTC.queue.count() === 2, 'global queue remains intact after overlay teardown');
    });
});
