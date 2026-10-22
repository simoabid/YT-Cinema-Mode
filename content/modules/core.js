/**
 * Core — namespace root, shared state, settings and page-level helpers.
 *
 * Must be the FIRST file listed in the manifest's content_scripts[].js array:
 * every other module receives `YTC` from here.
 */
globalThis.YTC = globalThis.YTC || {};

(function (YTC) {
    'use strict';

    const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

    const KEYS = {
        settings: 'cinemaSettings',
        dockedPos: 'ytCinemaDockedPos',
        dockedSize: 'ytCinemaDockedSize',
        dockedShortsSize: 'ytCinemaDockedShortsSize',
        speed: 'ytCinemaSavedSpeed',
        quality: 'ytCinemaSavedQuality'
    };

    const DEFAULTS = {
        hotkey: ' ',
        theme: 'mocha',
        overlayOpacity: 90,
        backdropStyle: 'glass',
        ambientLighting: true,
        ambientFullScreen: true,
        ambientGlow: 75,
        ambientQuality: 'high',
        ambientBlur: 80,
        autoPause: true,
        autoHideControls: true,
        rememberSpeed: true,
        savedSpeed: 1,
        rememberQuality: true,
        savedQuality: 'auto',
        directMiniPlayer: false,
        directPiP: false,
        altClickTrigger: true,
        middleClickTrigger: false,
        autoTheater: true,
        showIndicator: true
    };

    /**
     * Settings are mutated in place (never reassigned) so that every module can
     * hold a live reference to `YTC.settings` and always read current values.
     */
    const settings = { ...DEFAULTS };

    /** Registry of live overlays, stacking order and persisted dock geometry. */
    const state = {
        currentTarget: null,
        activeModalOverlay: null,
        activeDockedOverlays: new Set(),
        topZIndex: 2147483640,
        savedDockedPos: null,
        savedDockedSize: null,
        savedDockedShortsSize: null
    };

    let wasBackgroundPlaying = false;
    let backgroundVideoElement = null;

    // ---------------------------------------------------------------- utils

    function debounce(fn, wait) {
        let timer = null;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), wait);
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function setLocal(key, value) {
        try {
            api.storage.local.set({ [key]: value });
        } catch (_) {}
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatKeyDisplay(key) {
        if (!key) return 'Space';
        if (key === ' ' || key.toLowerCase() === 'space') return 'Space';
        if (key.length === 1) return key.toUpperCase();
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function isHotkeyMatch(event, hotkey) {
        if (!hotkey) return false;
        const hk = hotkey.toLowerCase();
        if (hk === ' ' || hk === 'space') {
            return event.key === ' ' || event.code === 'Space';
        }
        return event.key.toLowerCase() === hk;
    }

    // ----------------------------------------------------------- persistence

    const saveSpeed = debounce((speed) => setLocal(KEYS.speed, speed), 600);
    const saveQuality = debounce((quality) => setLocal(KEYS.quality, quality), 600);

    // -------------------------------------------------------- overlay visuals

    /** Named ambient-quality presets, used when no explicit blur radius is stored. */
    const AMBIENT_BLUR_PRESETS = { high: 80, medium: 40, low: 0 };

    /**
     * An explicit `ambientBlur` always wins; otherwise fall back to the named
     * quality so a settings blob written before the slider existed still works.
     */
    function resolveAmbientBlur() {
        const blur = parseInt(settings.ambientBlur, 10);
        if (!isNaN(blur)) return blur;
        return AMBIENT_BLUR_PRESETS[settings.ambientQuality] ?? AMBIENT_BLUR_PRESETS.high;
    }

    function applyAmbientSettings(targetOverlay) {
        if (!targetOverlay) return;
        const ambientLayer = targetOverlay.querySelector('.yt-cinema-ambient-layer');
        if (!ambientLayer) return;

        ambientLayer.style.display = settings.ambientLighting ? 'flex' : 'none';
        if (!settings.ambientLighting) {
            if (typeof targetOverlay._stopAmbient === 'function') {
                targetOverlay._stopAmbient();
            }
            return;
        } else {
            if (typeof targetOverlay._startAmbient === 'function') {
                targetOverlay._startAmbient();
            }
        }

        if (settings.ambientFullScreen !== false) {
            ambientLayer.classList.add('yt-cinema-ambient-fullscreen');
            ambientLayer.style.width = '100vw';
            ambientLayer.style.height = '100vh';
        } else {
            ambientLayer.classList.remove('yt-cinema-ambient-fullscreen');
            const container = targetOverlay.querySelector('.yt-cinema-container');
            if (container) {
                ambientLayer.style.width = container.style.width;
                ambientLayer.style.height = container.style.height;
            }
        }

        const glowVal = typeof settings.ambientGlow === 'number' ? settings.ambientGlow : 75;
        const normalized = clamp(glowVal / 100, 0.2, 1.0);

        const haloScale = (1.04 + normalized * 0.12).toFixed(2);
        const fsScale = (1.12 + normalized * 0.25).toFixed(2);
        const opacity = (0.35 + normalized * 0.55).toFixed(2);

        targetOverlay.style.setProperty('--yt-cinema-ambient-scale', haloScale);
        targetOverlay.style.setProperty('--yt-cinema-ambient-fs-scale', fsScale);
        targetOverlay.style.setProperty('--yt-cinema-ambient-opacity', opacity);

        let blurVal = resolveAmbientBlur();
        const fsBlurVal = blurVal > 0 ? Math.round(blurVal * 1.25) : 0;
        targetOverlay.style.setProperty('--yt-cinema-ambient-blur', `${blurVal}px`);
        targetOverlay.style.setProperty('--yt-cinema-ambient-fs-blur', `${fsBlurVal}px`);
    }

    function applyBackdropSettings(targetOverlay) {
        if (!targetOverlay) return;
        if (settings.backdropStyle === 'oled') {
            targetOverlay.classList.add('yt-cinema-oled');
            targetOverlay.style.removeProperty('--yt-cinema-backdrop-opacity');
            targetOverlay.style.removeProperty('--yt-cinema-backdrop-blur');
        } else {
            targetOverlay.classList.remove('yt-cinema-oled');
            const opacity = settings.overlayOpacity !== undefined ? settings.overlayOpacity : 90;
            targetOverlay.style.setProperty('--yt-cinema-backdrop-opacity', `${opacity}%`);
            targetOverlay.style.setProperty('--yt-cinema-backdrop-blur', 'blur(20px)');
        }

        applyAmbientSettings(targetOverlay);
    }

    // ------------------------------------------------------- page behaviour

    function lockScroll() {
        document.documentElement.style.scrollbarGutter = 'stable';
        document.body.style.overflow = 'hidden';
    }

    function unlockScroll() {
        document.body.style.overflow = '';
        document.documentElement.style.scrollbarGutter = '';
    }

    function pauseBackgroundVideo() {
        if (!settings.autoPause) return;
        try {
            const videos = document.querySelectorAll('video');
            for (const vid of videos) {
                // Ignore any video inside any of our cinema overlays
                if (vid.closest('.yt-cinema-overlay')) continue;
                if (!vid.paused && !vid.ended && vid.readyState > 1) {
                    backgroundVideoElement = vid;
                    wasBackgroundPlaying = true;
                    vid.pause();
                    break;
                }
            }
        } catch (err) {
            console.debug('[Cinema Mode] Could not pause background video:', err);
        }
    }

    function resumeBackgroundVideo() {
        if (state.activeModalOverlay || state.activeDockedOverlays.size > 0) return;
        if (wasBackgroundPlaying && backgroundVideoElement) {
            try {
                backgroundVideoElement.play().catch(() => {});
            } catch (_) {}
        }
        wasBackgroundPlaying = false;
        backgroundVideoElement = null;
    }

    // -------------------------------------------------------------- settings

    const BACKDROP_KEYS = [
        'overlayOpacity',
        'backdropStyle',
        'ambientLighting',
        'ambientFullScreen',
        'ambientGlow',
        'ambientQuality',
        'ambientBlur'
    ];

    function applySettings(incoming) {
        if (!incoming) return;
        let next = incoming;

        // Migrate the retired default profile (hotkey "h" + direct mini-player).
        if (next.hotkey === 'h' && next.directMiniPlayer === true) {
            next = {
                ...next,
                hotkey: ' ',
                autoHideControls: true,
                rememberSpeed: true,
                directMiniPlayer: false,
                directPiP: false
            };
        }

        const previous = { ...settings };
        Object.assign(settings, next);

        if (YTC.theme) {
            YTC.theme.apply(settings.theme);
        }

        if (settings.showIndicator !== previous.showIndicator || settings.hotkey !== previous.hotkey) {
            if (!settings.showIndicator) {
                YTC.hover.hideIndicator();
            } else {
                YTC.hover.refreshHotkeyLabel();
            }
        }

        const backdropChanged = BACKDROP_KEYS.some((key) => settings[key] !== previous[key]);
        if (backdropChanged && state.activeModalOverlay) {
            applyBackdropSettings(state.activeModalOverlay);
        }

        if (settings.autoHideControls !== previous.autoHideControls) {
            if (state.activeModalOverlay && typeof state.activeModalOverlay._updateAutoHide === 'function') {
                state.activeModalOverlay._updateAutoHide();
            }
            for (const overlay of state.activeDockedOverlays) {
                if (typeof overlay._updateAutoHide === 'function') {
                    overlay._updateAutoHide();
                }
            }
        }
    }

    function loadStoredDockGeometry() {
        try {
            api.storage.local.get([KEYS.dockedPos, KEYS.dockedSize, KEYS.dockedShortsSize], (res) => {
                if (!res) return;
                if (res[KEYS.dockedPos]) state.savedDockedPos = res[KEYS.dockedPos];
                if (res[KEYS.dockedSize]) state.savedDockedSize = res[KEYS.dockedSize];
                if (res[KEYS.dockedShortsSize]) state.savedDockedShortsSize = res[KEYS.dockedShortsSize];
            });
        } catch (_) {}
    }

    function loadStoredSettings() {
        try {
            api.storage.sync.get([KEYS.settings], (syncRes) => {
                const syncSettings = syncRes && syncRes[KEYS.settings];
                if (syncSettings) {
                    applySettings(syncSettings);
                }
                loadStoredSpeedAndQuality(syncSettings);
            });
        } catch (_) {}

        try {
            api.storage.onChanged.addListener((changes, area) => {
                if (area === 'sync' && changes[KEYS.settings] && changes[KEYS.settings].newValue) {
                    applySettings(changes[KEYS.settings].newValue);
                } else if (area === 'local' && changes[KEYS.speed] && typeof changes[KEYS.speed].newValue === 'number') {
                    settings.savedSpeed = changes[KEYS.speed].newValue;
                } else if (area === 'local' && changes[KEYS.quality] && typeof changes[KEYS.quality].newValue === 'string') {
                    settings.savedQuality = changes[KEYS.quality].newValue;
                }
            });
        } catch (_) {}
    }

    /** Saved speed/quality live in local storage, with a one-time migration from sync. */
    function loadStoredSpeedAndQuality(syncSettings) {
        try {
            api.storage.local.get([KEYS.speed, KEYS.quality], (localRes) => {
                const localSpeed = localRes && localRes[KEYS.speed];
                const localQuality = localRes && localRes[KEYS.quality];
                const syncSpeed = syncSettings && syncSettings.savedSpeed;
                const syncQuality = syncSettings && syncSettings.savedQuality;

                if (typeof localSpeed === 'number') {
                    settings.savedSpeed = localSpeed;
                } else if (typeof syncSpeed === 'number') {
                    settings.savedSpeed = syncSpeed;
                    setLocal(KEYS.speed, syncSpeed);
                }

                if (typeof localQuality === 'string') {
                    settings.savedQuality = localQuality;
                } else if (typeof syncQuality === 'string') {
                    settings.savedQuality = syncQuality;
                    setLocal(KEYS.quality, syncQuality);
                }
            });
        } catch (_) {}
    }

    // --------------------------------------------------------------- exports

    YTC.api = api;
    YTC.KEYS = KEYS;
    YTC.defaults = DEFAULTS;
    YTC.settings = settings;
    YTC.state = state;

    YTC.util = { clamp, escapeHtml, formatKeyDisplay, isHotkeyMatch };
    YTC.storage = { setLocal };

    YTC.saveSpeed = saveSpeed;
    YTC.saveQuality = saveQuality;

    YTC.applyAmbientSettings = applyAmbientSettings;
    YTC.applyBackdropSettings = applyBackdropSettings;

    YTC.lockScroll = lockScroll;
    YTC.unlockScroll = unlockScroll;
    YTC.pauseBackgroundVideo = pauseBackgroundVideo;
    YTC.resumeBackgroundVideo = resumeBackgroundVideo;

    YTC.applySettings = applySettings;
    YTC.initSettings = function () {
        loadStoredDockGeometry();
        loadStoredSettings();
    };
})(globalThis.YTC);
