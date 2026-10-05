// YouTube Cinema Mode - Cross-Browser Background Service Worker / Script
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

api.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        try {
            const result = await api.storage.sync.get(['cinemaSettings']);
            if (!result || !result.cinemaSettings) {
                await api.storage.sync.set({
                    cinemaSettings: {
                        hotkey: 'h',
                        autoTheater: true,
                        showIndicator: true,
                        backdropStyle: 'glass',
                        overlayOpacity: 90,
                        ambientLighting: true,
                        ambientFullScreen: true,
                        ambientGlow: 75,
                        autoPause: true,
                        altClickTrigger: true,
                        middleClickTrigger: false,
                        autoHideControls: false,
                        rememberSpeed: false,
                        savedSpeed: 1,
                        directMiniPlayer: true,
                        directPiP: false
                    }
                });
            }
        } catch (e) {
            console.error('[YouTube Cinema Mode] Error initializing settings:', e);
        }
    }
});

api.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-cinema') {
        try {
            const tabs = await api.tabs.query({ active: true, currentWindow: true });
            const tab = tabs && tabs[0];
            if (tab && tab.id) {
                api.tabs.sendMessage(tab.id, { action: 'toggle-cinema' }).catch(() => {
                    // Content script may not be injected or ready on this tab
                });
            }
        } catch (err) {
            console.error('[YouTube Cinema Mode] Error handling command:', err);
        }
    }
});

