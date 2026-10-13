document.addEventListener('DOMContentLoaded', () => {
    const hotkeyRecorder = document.getElementById('hotkeyRecorder');
    const hotkeyRecorderText = document.getElementById('hotkeyRecorderText');
    const backdropStyleSelect = document.getElementById('backdropStyle');
    const overlayOpacityInput = document.getElementById('overlayOpacity');
    const opacityValueSpan = document.getElementById('opacityValue');
    const opacitySettingItem = document.getElementById('opacitySettingItem');
    const ambientLightingCheck = document.getElementById('ambientLighting');
    const ambientFullScreenCheck = document.getElementById('ambientFullScreen');
    const ambientFullScreenItem = document.getElementById('ambientFullScreenItem');
    const ambientQualitySelect = document.getElementById('ambientQuality');
    const ambientQualityItem = document.getElementById('ambientQualityItem');
    const ambientBlurInput = document.getElementById('ambientBlur');
    const ambientBlurValueSpan = document.getElementById('ambientBlurValue');
    const ambientBlurItem = document.getElementById('ambientBlurItem');
    const ambientGlowInput = document.getElementById('ambientGlow');
    const ambientGlowValueSpan = document.getElementById('ambientGlowValue');
    const ambientGlowItem = document.getElementById('ambientGlowItem');
    const autoPauseCheck = document.getElementById('autoPause');
    const autoHideControlsCheck = document.getElementById('autoHideControls');
    const rememberSpeedCheck = document.getElementById('rememberSpeed');
    const directMiniPlayerCheck = document.getElementById('directMiniPlayer');
    const directPiPCheck = document.getElementById('directPiP');
    const altClickCheck = document.getElementById('altClickTrigger');
    const middleClickCheck = document.getElementById('middleClickTrigger');
    const autoTheaterCheck = document.getElementById('autoTheater');
    const showIndicatorCheck = document.getElementById('showIndicator');

    let currentHotkey = ' ';
    let isRecordingKey = false;

    function formatKeyDisplay(key) {
        if (!key) return 'Space';
        if (key === ' ' || key.toLowerCase() === 'space') return 'Space';
        return key.toUpperCase();
    }

    function updateHotkeyDisplay(key) {
        currentHotkey = key || ' ';
        const display = formatKeyDisplay(currentHotkey);
        if (hotkeyRecorderText) {
            hotkeyRecorderText.textContent = display;
        }
        document.querySelectorAll('.hotkey-kbd').forEach(el => {
            el.textContent = display;
        });
    }

    function updateOpacityUI() {
        const val = overlayOpacityInput.value;
        opacityValueSpan.textContent = `${val}%`;

        if (backdropStyleSelect.value === 'oled') {
            opacitySettingItem.classList.add('disabled');
        } else {
            opacitySettingItem.classList.remove('disabled');
        }
    }

    function updateAmbientUI() {
        const isAmbient = ambientLightingCheck.checked;
        if (!isAmbient) {
            ambientFullScreenItem.classList.add('disabled');
            ambientFullScreenCheck.disabled = true;
            ambientQualityItem.classList.add('disabled');
            ambientQualitySelect.disabled = true;
            ambientBlurItem.classList.add('disabled');
            ambientBlurInput.disabled = true;
            ambientGlowItem.classList.add('disabled');
            ambientGlowInput.disabled = true;
        } else {
            ambientFullScreenItem.classList.remove('disabled');
            ambientFullScreenCheck.disabled = false;
            ambientQualityItem.classList.remove('disabled');
            ambientQualitySelect.disabled = false;
            ambientBlurItem.classList.remove('disabled');
            ambientBlurInput.disabled = false;
            ambientGlowItem.classList.remove('disabled');
            ambientGlowInput.disabled = false;
        }
        ambientBlurValueSpan.textContent = `${ambientBlurInput.value}px`;
        ambientGlowValueSpan.textContent = `${ambientGlowInput.value}%`;
    }

    const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

    function getSettings(callback) {
        try {
            api.storage.sync.get(['cinemaSettings'], (result) => {
                if (callback) callback(result || {});
            });
        } catch (e) {
            console.error('[Cinema Mode] Storage get error:', e);
            if (callback) callback({});
        }
    }

    function saveSettingsToStorage(settings, callback) {
        try {
            api.storage.sync.set({ cinemaSettings: settings }, () => {
                if (callback) callback();
            });
        } catch (e) {
            console.error('[Cinema Mode] Storage set error:', e);
            if (callback) callback();
        }
    }

    getSettings((result) => {
        let settings = (result && result.cinemaSettings) || {};

        // Migrate old default settings if user hasn't explicitly customized them
        if (settings.hotkey === 'h' && settings.directMiniPlayer === true) {
            settings = {
                ...settings,
                hotkey: ' ',
                autoHideControls: true,
                rememberSpeed: true,
                directMiniPlayer: false,
                directPiP: false
            };
            saveSettings();
        }

        if (settings.hotkey) {
            updateHotkeyDisplay(settings.hotkey);
        } else {
            updateHotkeyDisplay(' ');
        }

        if (settings.backdropStyle) {
            backdropStyleSelect.value = settings.backdropStyle;
        }
        if (settings.overlayOpacity !== undefined) {
            overlayOpacityInput.value = settings.overlayOpacity;
        }
        if (settings.ambientLighting !== undefined) {
            ambientLightingCheck.checked = settings.ambientLighting;
        }
        if (settings.ambientFullScreen !== undefined) {
            ambientFullScreenCheck.checked = settings.ambientFullScreen;
        } else {
            ambientFullScreenCheck.checked = true;
        }
        if (settings.ambientGlow !== undefined) {
            ambientGlowInput.value = settings.ambientGlow;
        } else {
            ambientGlowInput.value = 75;
        }
        if (settings.ambientQuality !== undefined) {
            ambientQualitySelect.value = settings.ambientQuality;
        } else {
            ambientQualitySelect.value = 'high';
        }
        if (settings.ambientBlur !== undefined) {
            ambientBlurInput.value = settings.ambientBlur;
        } else {
            ambientBlurInput.value = 80;
        }
        if (settings.autoPause !== undefined) {
            autoPauseCheck.checked = settings.autoPause;
        }
        if (settings.autoHideControls !== undefined) {
            autoHideControlsCheck.checked = settings.autoHideControls;
        } else {
            autoHideControlsCheck.checked = true;
        }
        if (settings.rememberSpeed !== undefined) {
            rememberSpeedCheck.checked = settings.rememberSpeed;
        } else {
            rememberSpeedCheck.checked = true;
        }
        if (settings.directMiniPlayer !== undefined) {
            directMiniPlayerCheck.checked = settings.directMiniPlayer;
        } else {
            directMiniPlayerCheck.checked = false;
        }
        if (settings.directPiP !== undefined) {
            directPiPCheck.checked = settings.directPiP;
        } else {
            directPiPCheck.checked = false;
        }
        if (settings.altClickTrigger !== undefined) {
            altClickCheck.checked = settings.altClickTrigger;
        }
        if (settings.middleClickTrigger !== undefined) {
            middleClickCheck.checked = settings.middleClickTrigger;
        }
        if (settings.autoTheater !== undefined) {
            autoTheaterCheck.checked = settings.autoTheater;
        }
        if (settings.showIndicator !== undefined) {
            showIndicatorCheck.checked = settings.showIndicator;
        }

        updateOpacityUI();
        updateAmbientUI();
    });

    function saveSettings() {
        const settings = {
            hotkey: currentHotkey,
            backdropStyle: backdropStyleSelect.value,
            overlayOpacity: parseInt(overlayOpacityInput.value, 10),
            ambientLighting: ambientLightingCheck.checked,
            ambientFullScreen: ambientFullScreenCheck.checked,
            ambientQuality: ambientQualitySelect.value,
            ambientBlur: parseInt(ambientBlurInput.value, 10),
            ambientGlow: parseInt(ambientGlowInput.value, 10),
            autoPause: autoPauseCheck.checked,
            autoHideControls: autoHideControlsCheck.checked,
            rememberSpeed: rememberSpeedCheck.checked,
            directMiniPlayer: directMiniPlayerCheck.checked,
            directPiP: directPiPCheck.checked,
            altClickTrigger: altClickCheck.checked,
            middleClickTrigger: middleClickCheck.checked,
            autoTheater: autoTheaterCheck.checked,
            showIndicator: showIndicatorCheck.checked
        };

        updateHotkeyDisplay(currentHotkey);
        updateOpacityUI();
        updateAmbientUI();

        saveSettingsToStorage(settings, () => {
            console.log('[Cinema Mode] Settings saved');
        });
    }

    // Hotkey Recorder
    hotkeyRecorder.addEventListener('click', () => {
        if (isRecordingKey) {
            stopRecording(false);
            return;
        }
        isRecordingKey = true;
        hotkeyRecorder.classList.add('recording');
        const hint = hotkeyRecorder.querySelector('.hotkey-record-hint');
        if (hint) hint.textContent = 'Press key (ESC cancels)';
    });

    function stopRecording(cancelled) {
        isRecordingKey = false;
        hotkeyRecorder.classList.remove('recording');
        const hint = hotkeyRecorder.querySelector('.hotkey-record-hint');
        if (hint) hint.textContent = 'Click to change';
    }

    window.addEventListener('keydown', (e) => {
        if (!isRecordingKey) return;

        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
            stopRecording(true);
            return;
        }

        // Ignore modifier-only presses
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) {
            return;
        }

        let recordedKey = e.key;
        if (recordedKey === ' ' || e.code === 'Space') {
            recordedKey = ' ';
        } else {
            recordedKey = recordedKey.toLowerCase();
        }

        currentHotkey = recordedKey;
        stopRecording(false);
        saveSettings();
    }, true);

    backdropStyleSelect.addEventListener('change', saveSettings);
    overlayOpacityInput.addEventListener('input', () => {
        opacityValueSpan.textContent = `${overlayOpacityInput.value}%`;
    });
    overlayOpacityInput.addEventListener('change', saveSettings);
    ambientLightingCheck.addEventListener('change', () => {
        updateAmbientUI();
        saveSettings();
    });
    ambientFullScreenCheck.addEventListener('change', saveSettings);
    ambientQualitySelect.addEventListener('change', () => {
        const val = ambientQualitySelect.value;
        if (val === 'high') {
            ambientBlurInput.value = 80;
        } else if (val === 'medium') {
            ambientBlurInput.value = 40;
        } else if (val === 'low') {
            ambientBlurInput.value = 0;
        }
        ambientBlurValueSpan.textContent = `${ambientBlurInput.value}px`;
        saveSettings();
    });
    ambientBlurInput.addEventListener('input', () => {
        const blur = parseInt(ambientBlurInput.value, 10);
        if (blur === 80) {
            ambientQualitySelect.value = 'high';
        } else if (blur === 40) {
            ambientQualitySelect.value = 'medium';
        } else if (blur === 0) {
            ambientQualitySelect.value = 'low';
        } else {
            ambientQualitySelect.value = 'custom';
        }
        ambientBlurValueSpan.textContent = `${blur}px`;
    });
    ambientBlurInput.addEventListener('change', saveSettings);
    ambientGlowInput.addEventListener('input', () => {
        ambientGlowValueSpan.textContent = `${ambientGlowInput.value}%`;
    });
    ambientGlowInput.addEventListener('change', saveSettings);
    autoPauseCheck.addEventListener('change', saveSettings);
    autoHideControlsCheck.addEventListener('change', saveSettings);
    rememberSpeedCheck.addEventListener('change', saveSettings);
    directMiniPlayerCheck.addEventListener('change', saveSettings);
    directPiPCheck.addEventListener('change', saveSettings);
    altClickCheck.addEventListener('change', saveSettings);
    middleClickCheck.addEventListener('change', saveSettings);
    autoTheaterCheck.addEventListener('change', saveSettings);
    showIndicatorCheck.addEventListener('change', saveSettings);
});
