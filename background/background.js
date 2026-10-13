// YouTube Cinema Mode - Cross-Browser Background Service Worker / Script
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const RULE_ID_UNBLOCK_EMBED = 101;
const RULE_ID_UNBLOCK_NOCOOKIE = 102;

async function setupDeclarativeRules() {
    if (!api.declarativeNetRequest || !api.declarativeNetRequest.updateDynamicRules) return;
    try {
        await api.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [RULE_ID_UNBLOCK_EMBED, RULE_ID_UNBLOCK_NOCOOKIE, 103],
            addRules: [
                {
                    id: RULE_ID_UNBLOCK_EMBED,
                    priority: 2,
                    action: {
                        type: 'modifyHeaders',
                        requestHeaders: [
                            { header: 'Referer', operation: 'set', value: 'https://www.google.com/' }
                        ],
                        responseHeaders: [
                            { header: 'x-frame-options', operation: 'remove' },
                            { header: 'content-security-policy', operation: 'remove' }
                        ]
                    },
                    condition: {
                        urlFilter: 'youtube.com/embed/',
                        resourceTypes: ['sub_frame']
                    }
                },
                {
                    id: RULE_ID_UNBLOCK_NOCOOKIE,
                    priority: 2,
                    action: {
                        type: 'modifyHeaders',
                        requestHeaders: [
                            { header: 'Referer', operation: 'set', value: 'https://www.google.com/' }
                        ],
                        responseHeaders: [
                            { header: 'x-frame-options', operation: 'remove' },
                            { header: 'content-security-policy', operation: 'remove' }
                        ]
                    },
                    condition: {
                        urlFilter: 'youtube-nocookie.com/embed/',
                        resourceTypes: ['sub_frame']
                    }
                }
            ]
        });
    } catch (err) {
        console.warn('[YouTube Cinema Mode] Could not register declarative rules:', err);
    }
}

function setupWebRequestListeners() {
    if (!api.webRequest || !api.webRequest.onBeforeSendHeaders) return;

    const sendHeadersSpec = ['blocking', 'requestHeaders'];
    if (typeof chrome !== 'undefined' && chrome.webRequest && chrome.webRequest.OnBeforeSendHeadersOptions && chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS) {
        sendHeadersSpec.push('extraHeaders');
    }

    const responseHeadersSpec = ['blocking', 'responseHeaders'];
    if (typeof chrome !== 'undefined' && chrome.webRequest && chrome.webRequest.OnHeadersReceivedOptions && chrome.webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS) {
        responseHeadersSpec.push('extraHeaders');
    }

    const embedTargetUrls = [
        '*://*.youtube.com/embed/*',
        '*://youtube.com/embed/*',
        '*://*.youtube-nocookie.com/embed/*',
        '*://youtube-nocookie.com/embed/*'
    ];

    try {
        api.webRequest.onBeforeSendHeaders.addListener(
            (details) => {
                if (details.type !== 'sub_frame' && !details.url.includes('/embed/')) return;

                const headers = details.requestHeaders || [];
                let refFound = false;
                for (let i = 0; i < headers.length; i++) {
                    const name = headers[i].name.toLowerCase();
                    if (name === 'referer') {
                        headers[i].value = 'https://www.google.com/';
                        refFound = true;
                        break;
                    }
                }
                if (!refFound) {
                    headers.push({ name: 'Referer', value: 'https://www.google.com/' });
                }
                return { requestHeaders: headers };
            },
            {
                urls: embedTargetUrls,
                types: ['sub_frame']
            },
            sendHeadersSpec
        );
    } catch (e) {
        console.warn('[YouTube Cinema Mode] webRequest onBeforeSendHeaders setup:', e);
    }

    if (api.webRequest.onHeadersReceived) {
        try {
            api.webRequest.onHeadersReceived.addListener(
                (details) => {
                    if (details.type !== 'sub_frame' && !details.url.includes('/embed/')) return;

                    const headers = (details.responseHeaders || []).filter(h => {
                        const name = h.name.toLowerCase();
                        return name !== 'x-frame-options' && name !== 'content-security-policy';
                    });
                    return { responseHeaders: headers };
                },
                {
                    urls: embedTargetUrls,
                    types: ['sub_frame']
                },
                responseHeadersSpec
            );
        } catch (e) {
            console.warn('[YouTube Cinema Mode] webRequest onHeadersReceived setup:', e);
        }
    }
}

api.runtime.onInstalled.addListener(async (details) => {
    setupDeclarativeRules();
    setupWebRequestListeners();
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

setupDeclarativeRules();
setupWebRequestListeners();

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
