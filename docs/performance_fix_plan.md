# YouTube Cinema Mode – Performance Audit & Step-by-Step Fix Plan

> [!NOTE]
> **Historical document.** This audit was written against the pre-split v1.0.0 layout,
> where `content.js` and `styles.css` were single files. Both have since been split into
> the modules listed under [Project Layout](#-project-layout); the line numbers below refer
> to the old files and no longer line up. The findings and the execution log are kept as-is
> because they record what was done and why.

## Goal Description

The extension feels heavy and laggy. I audited every source file ([content.js](../content/content.js) 3.2k lines, [styles.css](content/styles.css) 1.2k lines, [popup.js](../popup/popup.js), [background.js](../background/background.js), manifests, build script). `background.js` is clean. Nearly all the cost is in the content script and CSS that run inside every YouTube tab.

> [!NOTE]
> **Method / honesty note:** this is a *static* code audit, not a live profile. The ranking is based on how Chrome/Firefox render each pattern. Phase 0 of the plan captures a baseline trace so we can confirm the ranking and prove each fix helped. You're on Linux, where GPU rasterization is sometimes disabled; if so, the GPU-bound issues (#1, #2) will hurt even more.

## Findings (most → least important)

| # | Severity | Finding | Where | Symptom you feel |
|---|---|---|---|---|
| 1 | 🔴 Critical | **Full-viewport CSS `blur(40–60px)` filter on a canvas that is redrawn ~12×/s** (plus `saturate`/`brightness`, scaled 1.25–1.37×) | [styles.css L392-431](content/styles.css) | Constant GPU/raster load while video plays; stutter, fans, dropped frames |
| 2 | 🔴 High | **Stacked `backdrop-filter` blurs**: full-screen overlay `blur(20px)` (animated on open), docked container `blur(16px)` + header `blur(20px)` on near-opaque backgrounds (no visible effect), toast/volume-HUD/speed-menu `blur` sitting on top of live video | [styles.css L10, 477, 516, 869, 915, 1084](content/styles.css) | Janky open animation; every video frame re-blurs the region under a HUD/toast |
| 3 | 🟠 High | **Ambient render loop wastes work**: runs a 60 Hz `requestAnimationFrame` to do a 12 fps job; keeps drawing in **docked mode where the layer is `display:none`**; one loop per docked window; not restarted when the setting is re-enabled | [content.js L2346-2381](../content/content.js#L2346-L2381), [styles.css L664](content/styles.css) | Extra main-thread wakeups and invisible `drawImage` calls |
| 4 | 🟠 High | **Body scroll-lock causes a whole-page re-layout.** `body.style.overflow='hidden'` removes the scrollbar, changes viewport width, and YouTube's grid reflows on open *and* close | [content.js L845, 1944, 1970, 2444](../content/content.js#L845) | Visible hitch exactly when the overlay opens/closes |
| 5 | 🟠 High | **`storage.sync` write storm.** Every speed change *and every `ratechange` event* writes the entire settings object to `storage.sync` (quota: 120 writes/min) and fires `storage.onChanged` in **every open YouTube tab**, each re-applying backdrop/ambient. Also clobbers popup changes with stale `settings` | [content.js L1288-1298, 2849-2859, 431-455](../content/content.js#L1288-L1298) | Lag across all tabs when changing speed; settings randomly reverting; writes silently failing once quota is hit |
| 6 | 🟠 High | **Heavy hover pipeline on every `mouseover`** (fires at each element boundary: hundreds/sec). `findVideoLink` runs up to 3 `closest()` calls with attribute-substring selectors + 10-tag lists + `querySelector('img, yt-image, …')` *before* the `currentTarget === link` early-out | [content.js L3031-3053, 3116-3130](../content/content.js#L3031-L3053) | Scroll/mouse-move jank on the Home feed |
| 7 | 🟡 Medium | **Duplicate listeners / redundant work in the iframe wiring**: `initPlayerInIframe` and `attachIframeListeners` both bind `play/playing/pause/ended` on the same `<video>` (everything runs 2×); `attachIframeListeners` also runs once immediately on the blank initial document; `mousemove` is bound on iframe window **and** document **and** overlay → `resetAutoHideTimer` (clearTimeout+setTimeout) runs 2–3× per mouse event | [content.js L894-933, 2733-2870](../content/content.js#L2733-L2870) | Timer churn while moving the mouse over the player |
| 8 | 🟡 Medium | **Global `message` listener does `JSON.parse` on any string message** and allocates arrays per call, on a page that receives many postMessages; two separate `message` listeners | [content.js L283-295, 3169-3193](../content/content.js#L3169-L3193) | Small constant main-thread tax on every YouTube page |
| 9 | 🟡 Medium | **Layout thrash while dragging/resizing docked windows**: `offsetWidth/offsetHeight` (forced layout) read on *every* `pointermove`; window `resize` clamp isn't rAF-limited; live resize re-lays-out the entire YouTube player iframe each frame | [content.js L1596-1597, 376-403, 1774-1784](../content/content.js#L1585-L1648) | Choppy drag/resize of the mini-player |
| 10 | 🟡 Medium | **Watch-page fallback loads the *entire* YouTube watch app** in an iframe and only hides it with `display:none` (still downloads/executes comments, recommendations, etc.) | [content.js L861-866, 958-1075](../content/content.js#L861-L866) | Very slow load / high memory when a video isn't embeddable |
| 11 | 🟢 Low | **Always-on content script cost**: 142 KB unminified JS + 30 KB CSS parsed in every YouTube tab, 2 storage reads, ~12 permanent global listeners, even if the user never opens the overlay | [manifest.json L32-46](../manifest.json#L32-L46) | Slightly slower page start |
| 12 | 🟢 Low | **CSS hygiene**: `transition: all` ×2, 7 permanent `will-change` layers (incl. hover indicator on every YouTube page), dead `@keyframes` (`ambient-pulse`, `fadeIn`) | [styles.css L111, 1060, 18, 50, 260, 370, 401, 423, 484](content/styles.css) | Extra GPU memory, accidental transitions |
| 13 | 🟢 Low | **Code-quality issues that make perf bugs hard to see**: a ~1,700-line `setupOverlayEvents` closure; the full hotkey table is duplicated (parent window vs iframe); title lookup + timestamp parsing duplicated; many empty `catch {}`; two divergent settings-apply code paths (initial load vs `onChanged`) | throughout | Bugs & regressions |

### 🐞 Functional bug found along the way
In the `mouseover` handler, `if (activeModalOverlay || !settings.showIndicator) return;` means that **when "show indicator" is turned off, `currentTarget` is never set, so the hover hotkey (`H`, `Ctrl+H`, `Alt+H`) stops working.** Fixed as part of Phase 4.

---

## Open Questions

> [!IMPORTANT]
> 1. **Visual change OK?** Removing the huge CSS blur on the ambient glow relies on the tiny 32×18 canvas being smoothly upscaled by the browser. It should look almost identical, but may be slightly less "soft". I'll compare screenshots; if banding appears I'll use a 64×36 canvas with a 2-step upscale. Acceptable?
> 2. **Non-embeddable videos (finding #10):** default plan = keep the fallback but make it opt-in ("This video can't be embedded – Open full player / Open in new tab" button). Alternatively keep the current automatic full watch-page load. Which do you prefer?
> 3. **Scope:** do you also want Phase 6/7 (minified build, lazy loading, splitting `content.js` into modules)? It's the biggest code change and not required for the lag fixes.
> 4. **Primary browser** (Chrome vs Firefox) – affects which profiler I use for verification. I'll verify on both if possible.

## User Review Required

> [!WARNING]
> Two changes alter behaviour/appearance (not just speed): (a) docked/HUD blur removed (backgrounds become slightly more opaque), (b) `savedSpeed` moves from `storage.sync` to `storage.local` (existing saved speed is migrated automatically; it will no longer sync across devices).

---

## Proposed Changes (execution order = priority order)

### Phase 0 – Baseline measurement (no code changes)
1. Check `chrome://gpu` (Chrome) / `about:support` → *Graphics* (Firefox): confirm hardware acceleration is on. Note it in the walkthrough.
2. Load `dist/chrome` unpacked. Record Performance traces (DevTools → Performance, "Screenshots" on) for four scenarios, keeping each ~10 s:
   - **A.** Open modal overlay on a playing video with ambient ON (full-screen glow).
   - **B.** Same with ambient OFF.
   - **C.** Dock the mini-player and drag + resize it.
   - **D.** Scroll the Home feed and sweep the mouse over thumbnails.
3. Record: average FPS, GPU/Raster time per frame, scripting ms per second, forced-reflow warnings, long tasks (>50 ms). Save as the "before" numbers.

### Phase 1 – GPU/paint fixes (findings #1, #2, #4, #12) — biggest win

#### [MODIFY] styles.css
- **Ambient canvas:** delete the `filter: blur(...)` from `.yt-cinema-ambient-canvas` and `.yt-cinema-ambient-fallback` (both normal & fullscreen variants). The 32×18 canvas upscaled by the browser already acts as a blur.
  ```css
  .yt-cinema-ambient-canvas {
      position: absolute; width: 100%; height: 100%;
      image-rendering: auto;
      transform: scale(var(--yt-cinema-ambient-scale, 1.12));
      opacity: var(--yt-cinema-ambient-opacity, 0.75);
      pointer-events: none;
      /* filter: blur(...) saturate(...) brightness(...);  <- REMOVED */
  }
  ```
- **Overlay backdrop:** lower `blur(20px)` → `blur(8px)` (the ambient layer already covers most of the backdrop).
- **Docked mode:** remove `backdrop-filter` from `.yt-cinema-container.yt-cinema-docked` (L477-478) and its header (L516); background is already 96 % opaque.
- **HUD / toast / speed menu / page toast:** replace `backdrop-filter: blur()` with a solid `rgba(18,18,22,.96)` background.
- Replace `transition: all` with explicit properties; delete unused `@keyframes yt-cinema-ambient-pulse` / `yt-cinema-fadeIn`.
- Remove permanent `will-change` from `.yt-cinema-overlay`, `.yt-cinema-ambient-layer`, `.yt-cinema-ambient-canvas`, `.yt-cinema-ambient-fallback`, `.yt-cinema-hover-indicator`; keep only on the docked container *while* `.yt-cinema-dragging`/`.yt-cinema-resizing`.

#### [MODIFY] content.js – bake colour on the tiny canvas instead of the GPU layer
```js
const ambientCtx = ambientCanvas.getContext('2d');
if (ambientCtx && 'filter' in ambientCtx) {
    ambientCtx.filter = 'saturate(160%) brightness(110%)';   // 32x18 px -> negligible cost
}
ambientCtx.imageSmoothingQuality = 'high';
```
#### [MODIFY] content.js – scroll lock without reflow (L845, 1944, 1970, 2444)
```js
function lockScroll()   { document.documentElement.style.scrollbarGutter = 'stable'; document.body.style.overflow = 'hidden'; }
function unlockScroll() { document.body.style.overflow = ''; document.documentElement.style.scrollbarGutter = ''; }
```
Replace the four direct `body.style.overflow` writes with these helpers (the gutter keeps the viewport width constant, so YouTube doesn't re-layout).

### Phase 2 – Ambient loop (finding #3)
#### [MODIFY] content.js (L2346-2384)
Replace the rAF loop with a low-frequency timer that is explicitly gated:
```js
const AMBIENT_INTERVAL = 100; // 10 fps is plenty for a 32x18 glow
let ambientTimer = null;
const drawAmbient = () => {
    if (!overlayElement.isConnected) return stopAmbient();
    if (document.hidden) return;
    const { video } = getPlayerElements();
    if (video && !video.paused && !video.ended && video.readyState >= 2) {
        ambientCtx.drawImage(video, 0, 0, ambientCanvas.width, ambientCanvas.height);
    }
};
const startAmbient = () => {
    if (ambientTimer || isDocked || !settings.ambientLighting) return;   // no work when docked / disabled
    ambientTimer = setInterval(drawAmbient, AMBIENT_INTERVAL);
};
const stopAmbient = () => { clearInterval(ambientTimer); ambientTimer = null; };
overlayElement._startAmbient = startAmbient;
overlayElement._stopAmbient  = stopAmbient;
```
- Call `stopAmbient()` in `toggleDockMode(true)` and `startAmbient()` in `toggleDockMode(false)`.
- In `applyAmbientSettings` call `_startAmbient()` / `_stopAmbient()` so toggling the popup setting takes effect immediately (current bug: never restarts).

### Phase 3 – Storage & settings (finding #5)
#### [MODIFY] content.js
1. Move `savedSpeed` to `storage.local` (key `ytCinemaSavedSpeed`) and **debounce** writes:
   ```js
   const persistSpeed = debounce((s) => api.storage.local.set({ ytCinemaSavedSpeed: s }), 600);
   ```
   Use it in `setPlaybackSpeed` (L1288) and the `ratechange` handler (L2849); stop spreading `...settings` into `storage.sync`.
2. One-time migration: if `cinemaSettings.savedSpeed` exists and local key missing, copy it.
3. Merge the two settings paths (`updateFromSettings` L406 + `onChanged` L431) into a single `applySettings(newSettings)`; in `onChanged` only react to keys whose value actually changed.
#### [MODIFY] popup.js / background.js
Drop `savedSpeed` from the synced object (popup L26, 147-149, 180; background default L24).

### Phase 4 – Hover pipeline + bug fix (finding #6)
#### [MODIFY] content.js (L3031-3142)
```js
const CARD_SELECTOR = 'ytd-thumbnail, yt-thumbnail-view-model, ytd-rich-item-renderer, ytd-rich-grid-media, ' +
  'ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model';
let lastHoverEl = null;
document.addEventListener('mouseover', (e) => {
    if (activeModalOverlay) return;
    const el = e.target;
    if (el === lastHoverEl) return;
    lastHoverEl = el;
    if (currentTarget && currentTarget.contains(el)) return;   // still inside same thumbnail
    if (!el.closest(CARD_SELECTOR)) return;                    // 1 cheap tag-selector check for ~95% of events
    const link = findVideoLink(el);
    if (!link) return;
    currentTarget = link;                                       // always track (fixes hotkey bug)
    if (settings.showIndicator) scheduleIndicator(link);
}, { passive: true });
```
- Scroll handler: hide the indicator on scroll start and re-evaluate once on a 120 ms trailing debounce instead of reading `getBoundingClientRect` every frame.

### Phase 5 – Iframe wiring, messages, drag/resize (findings #7, #8, #9)
#### [MODIFY] content.js
1. **Single bind point** for player events: new `bindVideoEvents(video)` guarded by a `WeakSet`; call it from `initPlayerInIframe` only; delete the duplicate block in `attachIframeListeners` (L2797-2862, keep the `ratechange`/`loadedmetadata` logic inside the shared function). Don't call `attachIframeListeners()` before `load`.
2. **Mousemove**: bind once on `iframeDoc` (it bubbles to window; remove the window + duplicate doc listeners). Replace clear/set-timeout churn:
   ```js
   let lastActivity = 0, hideTimer = null;
   const noteActivity = () => {
       lastActivity = performance.now();
       if (!isControlsVisible) showControls();
       if (settings.autoHideControls && !isDocked && !hideTimer) armHide(AUTOHIDE_DELAY);
   };
   const armHide = (ms) => hideTimer = setTimeout(() => {
       hideTimer = null;
       const idle = performance.now() - lastActivity;
       idle >= AUTOHIDE_DELAY ? hideControls() : armHide(AUTOHIDE_DELAY - idle);
   }, ms);
   ```
3. **Hotkeys**: extract one `KEY_ACTIONS` map + `handleOverlayKey(e, fromIframe)` used by both the parent-window and iframe listeners (removes ~80 duplicated lines).
4. **Merge the two `message` listeners** into one with cheap guards:
   ```js
   window.addEventListener('message', (event) => {
       if (!activeModalOverlay && activeDockedOverlays.size === 0) return;
       if (event.origin !== location.origin) return;
       const ov = overlayForSource(event.source);   // loop, no array allocation
       if (!ov) return;
       /* then handle YT_CINEMA_RESIZE or parse JSON for onError */
   });
   ```
5. **Drag/resize**: cache `container.offsetWidth/Height` at `pointerdown`; rAF-limit the window `resize` clamp for docked windows; add `contain: layout paint` to `.yt-cinema-player-wrapper` so container resizes don't propagate relayout.

### Phase 6 – Fallback & startup cost (findings #10, #11) — *depends on your answers above*
- **#10:** `triggerWatchFallback` shows an in-overlay notice with "Open in new tab" instead of auto-loading the full watch app (or keep as opt-in).
- **#11 (optional):** add a minify step to [build.js](build.js) (esbuild/terser as a devDependency) → ~142 KB → ~60 KB; optionally lazy-load the overlay code on first hotkey/click via `scripting.executeScript` + `insertCSS` (needs the `scripting` permission) so idle YouTube tabs only run a tiny hover/hotkey stub.

### Phase 7 – Code-quality cleanup (finding #13)
Remove duplicated helpers (`getCurrentPlaybackSeconds` → reuse `parseTimestampToSeconds`; one `getPageTitle()`), replace empty `catch {}` with `console.debug`, remove the load-time `console.log`, and split `setupOverlayEvents` into small functions (speed, volume, dock/drag, keys). Pure refactor — done last, after perf fixes are verified.

---

## Verification Plan

### Automated Tests
```bash
cd /home/seemoo/Documents/Projects/YouTube-Cinema-Mode-Extension-v1.0.0
node --check content/content.js && node --check popup/popup.js && node --check background/background.js   # syntax
python3 -c "import json;[json.load(open(f)) for f in ('manifest.json','manifest.firefox.json')]"          # manifests valid
node build.js                                                                                              # regenerate dist/ + zips
grep -nE "filter: *blur|backdrop-filter|transition: *all" content/styles.css                               # confirm only intended blurs remain
```
If you approve Phase 7, I'll also extract the pure helpers (`getVideoID`, `parseTimestampToSeconds`, `calculateContainerDimensions`) and add small `node:test` unit tests.

### Manual Verification
Re-run the Phase 0 scenarios A–D and compare against the baseline:

| Scenario | Target after fixes |
|---|---|
| A. Modal + full-screen ambient | Steady 60 fps UI, raster/GPU time per frame roughly halved or better, no scripting spikes |
| B. Modal, ambient off | No regression |
| C. Dock + drag/resize | No "Forced reflow" warnings during `pointermove`; smooth drag |
| D. Feed scroll + thumbnail sweep | Scripting time per `mouseover` down sharply; no long tasks |

Functional regression checklist: hotkey with indicator **off** now works; Alt+Click and middle-click triggers; `D` dock/undock; ambient toggles live from the popup; speed persists and is not lost; no page layout shift on open/close; Escape/keyboard shortcuts work both with focus on page and inside the player; Firefox build loads and behaves the same.

---

## Execution Status & Verification Log

- [x] **Phase 1 – GPU / Paint fixes (Findings #1, #2, #4, #12):**
  - Removed full-viewport CSS `blur(40-60px)` filter from `.yt-cinema-ambient-canvas` and `.yt-cinema-ambient-fallback`.
  - Reduced overlay backdrop blur from `20px` to `8px`.
  - Replaced stacked `backdrop-filter: blur(...)` on docked container, docked header, HUD, speed menu, and toasts with performant opaque backgrounds.
  - Eliminated `transition: all`, removed dead `@keyframes`, and scoped `will-change: transform` only during active dragging/resizing.
  - Baked canvas color corrections (`ambientCtx.filter = 'saturate(160%) brightness(110%)'`) directly on the 32×18 2D canvas context.
  - Implemented `lockScroll()` / `unlockScroll()` using `scrollbarGutter = 'stable'` to prevent full-page layout reflows on overlay open/close.

- [x] **Phase 2 – Ambient loop (Finding #3):**
  - Replaced high-frequency 60 FPS rAF loop with ~10 FPS gated `setInterval` (`AMBIENT_INTERVAL = 100`).
  - Gated loop when hidden, paused, disconnected, docked, or lighting is disabled.
  - Bound `_startAmbient()` / `_stopAmbient()` into `toggleDockMode` and `applyAmbientSettings` so live popup changes take effect instantly.

- [x] **Phase 3 – Storage & settings (Finding #5):**
  - Migrated `savedSpeed` from `storage.sync` to `storage.local` (`ytCinemaSavedSpeed`) with 600ms trailing debounce.
  - Removed stale `savedSpeed` spreading in popup and background default settings.
  - Unified settings paths (`applySettings`) with per-key dirty checking to eliminate `storage.onChanged` churn across tabs.

- [x] **Phase 4 – Hover pipeline & hotkey bug fix (Finding #6):**
  - Added fast tag guard (`CARD_SELECTOR`) before deep thumbnail DOM traversal.
  - Fixed functional bug: `currentTarget` is now always tracked even when the visual hover indicator is disabled, preserving hotkey functionality (`H`, `Ctrl+H`, `Alt+H`).
  - Replaced per-frame `getBoundingClientRect` calls on scroll with immediate indicator hide and a 120ms trailing debounce.

- [x] **Phase 5 – Iframe wiring, messages, drag/resize (Findings #7, #8, #9):**
  - Unified duplicate `window.addEventListener('message')` listeners with early source origin checking.
  - Eliminated forced layout thrashing (`container.offsetWidth/offsetHeight`) during docked dragging by caching dimensions on `pointerdown`.
  - Added rAF throttling to docked window resize clamping.
  - Replaced timer churn with `noteActivity()` and deferred `armHide()`.
  - Consolidated video event bindings with `WeakSet` guard.
  - Extracted shared `handleOverlayKey(e, fromIframe)` to eliminate duplicate hotkey handlers.

- [x] **Phase 6 – Fallback & restricted embeds (Finding #10):**
  - Updated `triggerWatchFallback` to display a polite in-overlay fallback card with "Open in New Tab" and "Try Full Player" buttons rather than silently loading the heavy YouTube watch page.
  - Added responsive CSS in `styles.css` for `.yt-cinema-fallback-notice` and related classes.

- [x] **Phase 7 – Code-quality cleanup (Finding #13):**
  - Deduplicated timestamp parsing in `getCurrentPlaybackSeconds` to reuse `parseTimestampToSeconds`.
  - Deduplicated watch page title query into `getCurrentWatchPageTitle()`.
  - Removed startup `console.log` noise in content script.
  - Cleaned up empty `catch` blocks and migrated debug statements to `console.debug`.
  - Rebuilt Chrome and Firefox distributions (`node build.js`).
  - All automated checks passed (`node --check`, manifest validation, CSS blur grep, and build packaging).

