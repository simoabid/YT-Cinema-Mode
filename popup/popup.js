document.addEventListener('DOMContentLoaded', () => {
    const hotkeySelect = document.getElementById('hotkey');
    const autoTheaterCheck = document.getElementById('autoTheater');
    const showIndicatorCheck = document.getElementById('showIndicator');

    chrome.storage.sync.get(['cinemaSettings'], (result) => {
        const settings = result.cinemaSettings || {};
        
        if (settings.hotkey) {
            hotkeySelect.value = settings.hotkey;
        }
        if (settings.autoTheater !== undefined) {
            autoTheaterCheck.checked = settings.autoTheater;
        }
        if (settings.showIndicator !== undefined) {
            showIndicatorCheck.checked = settings.showIndicator;
        }
    });

    function saveSettings() {
        const settings = {
            hotkey: hotkeySelect.value,
            autoTheater: autoTheaterCheck.checked,
            showIndicator: showIndicatorCheck.checked
        };

        chrome.storage.sync.set({ cinemaSettings: settings }, () => {
            console.log('Settings saved');
        });
    }

    hotkeySelect.addEventListener('change', saveSettings);
    autoTheaterCheck.addEventListener('change', saveSettings);
    showIndicatorCheck.addEventListener('change', saveSettings);
});
