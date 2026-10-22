/**
 * Popup module — settings UI for the extension popup.
 *
 * The form is described once in `FIELDS`, which drives loading, saving and
 * event wiring. Adding a setting means adding one entry.
 */
(() => {
    'use strict';

    const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

    const SETTINGS_KEY = 'cinemaSettings';
    const DEFAULT_HOTKEY = ' ';

    /** Flavors shipped by styles/00-themes.css; anything else falls back. */
    const THEMES = ['latte', 'frappe', 'macchiato', 'mocha'];
    const DEFAULT_THEME = 'mocha';

    function applyTheme(themeId) {
        document.documentElement.setAttribute(
            'data-ytc-theme',
            THEMES.includes(themeId) ? themeId : DEFAULT_THEME
        );
    }

    /** Show the manifest version so the popup cannot drift from a release. */
    function applyVersion() {
        try {
            const version = api.runtime.getManifest?.().version;
            const el = document.getElementById('popupVersion');
            if (version && el) el.textContent = `v${version}`;
        } catch (_) {}
    }

    // Apply the saved flavor before the settings form loads so the popup does
    // not flash the default theme on open.
    try {
        api.storage.sync.get([SETTINGS_KEY], (result) => {
            applyTheme(result && result[SETTINGS_KEY] && result[SETTINGS_KEY].theme);
        });
    } catch (_) {}

    /** Blur radius presets implied by each named ambient quality. */
    const QUALITY_BLUR = { high: 80, medium: 40, low: 0 };

    /** Reverse lookup: blur radius -> quality name. */
    const BLUR_QUALITY = { 80: 'high', 40: 'medium', 0: 'low' };

    /** Keys ignored by the key recorder (they can't stand alone as a hotkey). */
    const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'];

    const formatKeyDisplay = (key) => {
        if (!key) return 'Space';
        if (key === ' ' || key.toLowerCase() === 'space') return 'Space';
        return key.toUpperCase();
    };

    /** The retired default profile (hotkey "h" + direct mini-player) maps to today's defaults. */
    function migrateLegacyDefaults(settings) {
        if (settings.hotkey !== 'h' || settings.directMiniPlayer !== true) return null;
        return {
            ...settings,
            hotkey: DEFAULT_HOTKEY,
            autoHideControls: true,
            rememberSpeed: true,
            directMiniPlayer: false,
            directPiP: false
        };
    }

    function readSettings() {
        return new Promise((resolve) => {
            try {
                api.storage.sync.get([SETTINGS_KEY], (result) => resolve((result && result[SETTINGS_KEY]) || {}));
            } catch (err) {
                console.error('[Cinema Mode] Storage get error:', err);
                resolve({});
            }
        });
    }

    function writeSettings(settings) {
        return new Promise((resolve) => {
            try {
                api.storage.sync.set({ [SETTINGS_KEY]: settings }, resolve);
            } catch (err) {
                console.error('[Cinema Mode] Storage set error:', err);
                resolve();
            }
        });
    }

    // ------------------------------------------------------------ field list

    /**
     * Field descriptors.
     *   input      element id
     *   default    value used when storage has nothing
     *   read       pull the value out of the DOM
     *   write      push a stored value into the DOM
     *   onChange   extra work before a change is saved
     *   onInput    extra work on every keystroke/drag
     */
    const FIELDS = [
        {
            key: 'theme', input: 'theme', default: DEFAULT_THEME,
            read: el => el.value, write: (el, v) => { el.value = v; },
            onChange: (ui) => ui.applyThemeField()
        },
        {
            key: 'backdropStyle', input: 'backdropStyle', default: 'glass',
            read: el => el.value, write: (el, v) => { el.value = v; }
        },
        {
            key: 'overlayOpacity', input: 'overlayOpacity', default: 90, type: 'number',
            read: el => parseInt(el.value, 10), write: (el, v) => { el.value = v; }
        },
        {
            key: 'ambientLighting', input: 'ambientLighting', default: true,
            read: el => el.checked, write: (el, v) => { el.checked = v; }
        },
        {
            key: 'ambientFullScreen', input: 'ambientFullScreen', default: true, requiresAmbient: true,
            read: el => el.checked, write: (el, v) => { el.checked = v; }
        },
        {
            key: 'ambientQuality', input: 'ambientQuality', default: 'high', requiresAmbient: true,
            read: el => el.value, write: (el, v) => { el.value = v; },
            onChange: (ui) => ui.applyQualityPreset()
        },
        {
            key: 'ambientBlur', input: 'ambientBlur', default: 80, type: 'number', requiresAmbient: true,
            read: el => parseInt(el.value, 10), write: (el, v) => { el.value = v; },
            onInput: (ui) => ui.syncQualityToBlur()
        },
        {
            key: 'ambientGlow', input: 'ambientGlow', default: 75, type: 'number', requiresAmbient: true,
            read: el => parseInt(el.value, 10), write: (el, v) => { el.value = v; }
        },
        { key: 'autoPause', input: 'autoPause', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'autoHideControls', input: 'autoHideControls', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'rememberSpeed', input: 'rememberSpeed', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'rememberQuality', input: 'rememberQuality', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; }, optional: true },
        { key: 'directMiniPlayer', input: 'directMiniPlayer', default: false, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'directPiP', input: 'directPiP', default: false, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'altClickTrigger', input: 'altClickTrigger', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'middleClickTrigger', input: 'middleClickTrigger', default: false, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'autoTheater', input: 'autoTheater', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; } },
        { key: 'showIndicator', input: 'showIndicator', default: true, read: el => el.checked, write: (el, v) => { el.checked = v; } }
    ];

    // ------------------------------------------------------------------- UI

    document.addEventListener('DOMContentLoaded', () => {
        applyVersion();
        const ui = createUi();

        ui.load();
        ui.initHotkeyRecorder(() => ui.save());
    });

    function createUi() {
        const els = {};
        for (const field of FIELDS) {
            if (!field.optional || document.getElementById(field.input)) {
                els[field.key] = document.getElementById(field.input);
            }
        }

        const ui = {
            currentHotkey: DEFAULT_HOTKEY,
            isRecordingKey: false,

            get hotkeyRecorder() { return document.getElementById('hotkeyRecorder'); },
            get hotkeyRecorderText() { return document.getElementById('hotkeyRecorderText'); },
            get opacityValue() { return document.getElementById('opacityValue'); },
            get ambientBlurValue() { return document.getElementById('ambientBlurValue'); },
            get ambientGlowValue() { return document.getElementById('ambientGlowValue'); }
        };

        // -------------------------------------------------------- presentation

        ui.updateHotkeyDisplay = (key) => {
            ui.currentHotkey = key || DEFAULT_HOTKEY;
            const display = formatKeyDisplay(ui.currentHotkey);
            if (ui.hotkeyRecorderText) ui.hotkeyRecorderText.textContent = display;
            document.querySelectorAll('.hotkey-kbd').forEach(el => { el.textContent = display; });
        };

        ui.updateOpacityUI = () => {
            ui.opacityValue.textContent = `${els.overlayOpacity.value}%`;
            setItemDisabled('opacitySettingItem', els.backdropStyle.value === 'oled');
        };

        /** Ambient sub-settings grey out whenever ambient lighting is off. */
        ui.updateAmbientUI = () => {
            const enabled = els.ambientLighting.checked;
            for (const field of FIELDS) {
                if (!field.requiresAmbient) continue;
                setItemDisabled(`${field.input}Item`, !enabled);
                if (els[field.key]) els[field.key].disabled = !enabled;
            }
            ui.ambientBlurValue.textContent = `${els.ambientBlur.value}px`;
            ui.ambientGlowValue.textContent = `${els.ambientGlow.value}%`;
        };

        function setItemDisabled(itemId, disabled) {
            document.getElementById(itemId)?.classList.toggle('disabled', disabled);
        }

        /** Named quality presets move the blur slider. */
        ui.applyQualityPreset = () => {
            const preset = QUALITY_BLUR[els.ambientQuality.value];
            if (preset === undefined) return;
            els.ambientBlur.value = preset;
            ui.ambientBlurValue.textContent = `${preset}px`;
        };

        /** Mirror the theme dropdown onto the document so tokens switch live. */
        ui.applyThemeField = () => {
            if (els.theme) applyTheme(els.theme.value);
        };

        /** Dragging the blur slider renames the quality to "custom". */
        ui.syncQualityToBlur = () => {
            const blur = parseInt(els.ambientBlur.value, 10);
            els.ambientQuality.value = BLUR_QUALITY[blur] ?? 'custom';
            ui.ambientBlurValue.textContent = `${blur}px`;
        };

        // --------------------------------------------------------- load/save

        ui.load = async () => {
            const settings = await readSettings();
            const migrated = migrateLegacyDefaults(settings);
            const effective = migrated || settings;

            // The migration is written back before the form is filled in, so it
            // persists today's defaults for the retired profile.
            if (migrated) await ui.save();

            ui.updateHotkeyDisplay(effective.hotkey);

            for (const field of FIELDS) {
                const el = els[field.key];
                if (!el) continue;
                const value = effective[field.key] !== undefined ? effective[field.key] : field.default;
                field.write(el, value);
            }

            ui.updateOpacityUI();
            ui.updateAmbientUI();
            ui.applyThemeField();
        };

        ui.save = async () => {
            const settings = { hotkey: ui.currentHotkey };
            for (const field of FIELDS) {
                const el = els[field.key];
                settings[field.key] = el ? field.read(el) : field.default;
            }

            ui.updateHotkeyDisplay(ui.currentHotkey);
            ui.updateOpacityUI();
            ui.updateAmbientUI();

            await writeSettings(settings);
            console.log('[Cinema Mode] Settings saved');
        };

        // ----------------------------------------------------- hotkey recorder

        ui.initHotkeyRecorder = (onRecorded) => {
            const recorder = ui.hotkeyRecorder;
            const hint = recorder.querySelector('.hotkey-record-hint');

            const stopRecording = () => {
                ui.isRecordingKey = false;
                recorder.classList.remove('recording');
                if (hint) hint.textContent = 'Click to change';
            };

            recorder.addEventListener('click', () => {
                if (ui.isRecordingKey) {
                    stopRecording();
                    return;
                }
                ui.isRecordingKey = true;
                recorder.classList.add('recording');
                if (hint) hint.textContent = 'Press key (ESC cancels)';
            });

            window.addEventListener('keydown', (e) => {
                if (!ui.isRecordingKey) return;

                e.preventDefault();
                e.stopPropagation();

                if (e.key === 'Escape') {
                    stopRecording();
                    return;
                }
                if (MODIFIER_KEYS.includes(e.key)) return;

                ui.currentHotkey = (e.key === ' ' || e.code === 'Space') ? DEFAULT_HOTKEY : e.key.toLowerCase();
                stopRecording();
                onRecorded();
            }, true);
        };

        // ------------------------------------------------------- event wiring

        for (const field of FIELDS) {
            const el = els[field.key];
            if (!el) continue;

            el.addEventListener('change', () => {
                if (field.onChange) field.onChange(ui);
                ui.save();
            });
            if (field.onInput) el.addEventListener('input', () => field.onInput(ui));
        }

        els.overlayOpacity.addEventListener('input', () => {
            ui.opacityValue.textContent = `${els.overlayOpacity.value}%`;
        });
        els.ambientGlow.addEventListener('input', () => {
            ui.ambientGlowValue.textContent = `${els.ambientGlow.value}%`;
        });
        els.ambientLighting.addEventListener('change', () => {
            ui.updateAmbientUI();
            ui.save();
        });

        return ui;
    }
})();
