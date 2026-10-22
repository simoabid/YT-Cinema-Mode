/**
 * Quality control — reads the available qualities from the embed player
 * (direct API, a page-level bridge script and the iframe's own messages),
 * then applies the user's choice.
 */
(function (YTC) {
    'use strict';

    const settings = YTC.settings;
    const icons = YTC.icons;

    const QUALITY_RANK = {
        highres: 4320, hd2880: 2880, hd2160: 2160, '4k': 2160, '2160p': 2160,
        hd1440: 1440, '1440p': 1440,
        hd1080: 1080, '1080p': 1080,
        hd720: 720, '720p': 720,
        large: 480, '480p': 480,
        medium: 360, '360p': 360,
        small: 240, '240p': 240,
        tiny: 144, '144p': 144,
        auto: 0
    };

    /** Thresholds are highest-first; each entry yields [label, pill, badge]. */
    const QUALITY_TIERS = [
        [4320, '4320p (8K)', '8K', '8K'],
        [2880, '2880p (5K)', '5K', '5K'],
        [2160, '2160p (4K)', '4K', '4K'],
        [1440, '1440p (2K)', '1440p', 'HD'],
        [1080, '1080p HD', '1080p', 'HD'],
        [720, '720p HD', '720p', 'HD'],
        [480, '480p', '480p', ''],
        [360, '360p', '360p', ''],
        [240, '240p', '240p', ''],
        [144, '144p', '144p', '']
    ];

    function getQualityRank(qualityKey) {
        if (!qualityKey) return 0;
        const lower = String(qualityKey).toLowerCase();
        if (QUALITY_RANK[lower] !== undefined) return QUALITY_RANK[lower];
        const match = lower.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    }

    function createQualityControl(ctx) {
        const { iframe, els, flags } = ctx;

        let currentQuality = (settings.rememberQuality && typeof settings.savedQuality === 'string')
            ? settings.savedQuality
            : 'auto';
        let currentPlayingQuality = 'auto';
        let availableQualities = [];
        let focusedQualityIndex = -1;
        let savedQualityApplied = false;

        // ------------------------------------------------------- presentation

        function getDisplayInfo(qualityKey, customLabel, isHd) {
            const rank = getQualityRank(qualityKey);

            if (qualityKey === 'auto') {
                const playingPill = (currentPlayingQuality && currentPlayingQuality !== 'auto')
                    ? getDisplayInfo(currentPlayingQuality, null, false).pill
                    : null;
                return { label: playingPill ? `Auto (${playingPill})` : 'Auto', pill: playingPill || 'Auto', badge: '', rank };
            }

            const tier = QUALITY_TIERS.find(([minRank]) => rank >= minRank);
            const label = customLabel || (tier ? tier[1] : qualityKey);
            const pill = tier ? tier[2] : qualityKey;
            let badge = tier ? tier[3] : '';

            if (isHd && !badge) badge = 'HD';
            return { label, pill, badge, rank };
        }

        function autoLabel() {
            return getDisplayInfo('auto', null, false).label;
        }

        function renderMenu() {
            if (!els.qualityMenu) return;

            const check = icons.checkSvg('yt-cinema-quality-check');

            if (availableQualities.length === 0) {
                els.qualityMenu.innerHTML = `
                    <div class="yt-cinema-quality-item active" data-quality="auto">
                        <span class="yt-cinema-quality-text">Auto</span>
                        ${check}
                    </div>
                `;
                return;
            }

            els.qualityMenu.innerHTML = availableQualities.map((item, idx) => {
                const classes = [
                    'yt-cinema-quality-item',
                    item.quality === currentQuality ? 'active' : '',
                    idx === focusedQualityIndex ? 'keyboard-focus' : ''
                ].filter(Boolean).join(' ');

                const displayLabel = item.quality === 'auto' ? autoLabel() : item.label;
                const badgeHtml = item.badge
                    ? `<span class="yt-cinema-quality-badge${item.badge === '4K' || item.badge === '8K' ? ' yt-cinema-quality-badge-4k' : ''}">${item.badge}</span>`
                    : '';

                return `
                    <div class="${classes}" data-quality="${item.quality}">
                        <span class="yt-cinema-quality-text">${displayLabel}</span>
                        ${badgeHtml}
                        ${check}
                    </div>
                `;
            }).join('');
        }

        function updateUI(qualityId, activePlayingQuality) {
            if (activePlayingQuality) currentPlayingQuality = activePlayingQuality;
            if (!els.qualityPill) return;

            const info = getDisplayInfo(qualityId, null, false);
            if (qualityId === 'auto' && currentPlayingQuality && currentPlayingQuality !== 'auto') {
                const playingInfo = getDisplayInfo(currentPlayingQuality, null, false);
                els.qualityPill.textContent = playingInfo.pill;
                els.qualityPill.setAttribute('title', `Video Quality: Auto (${playingInfo.pill}) (Q)`);
            } else {
                els.qualityPill.textContent = qualityId === 'auto' ? 'Auto' : info.pill;
                els.qualityPill.setAttribute('title', qualityId === 'auto'
                    ? 'Video Quality: Auto (Q)'
                    : `Video Quality: ${info.label} (Q)`);
            }

            if (!els.qualityMenu) return;
            els.qualityMenu.querySelectorAll('.yt-cinema-quality-item').forEach((item, idx) => {
                item.classList.toggle('active', item.dataset.quality === qualityId);
                item.classList.toggle('keyboard-focus', idx === focusedQualityIndex);
            });
        }

        // ------------------------------------------------------ player bridge

        function getEmbedPlayer() {
            const { player } = ctx.getPlayerElements();
            return player?.wrappedJSObject || player;
        }

        function sendBridgeCommand(action, quality) {
            const doc = YTC.player.getEmbedDocument(iframe);
            doc?.dispatchEvent(new CustomEvent('yt-cinema-quality-bridge-cmd', {
                detail: JSON.stringify({ action, quality })
            }));
        }

        function applyToPlayer(qualityId) {
            const playerObj = getEmbedPlayer();
            if (playerObj) {
                const range = qualityId === 'auto' ? 'default' : qualityId;
                if (typeof playerObj.setPlaybackQualityRange === 'function') {
                    playerObj.setPlaybackQualityRange(range, range);
                }
                if (typeof playerObj.setPlaybackQuality === 'function') {
                    playerObj.setPlaybackQuality(qualityId);
                }
            }

            try {
                sendBridgeCommand('setQuality', qualityId);
            } catch (_) {}

            try {
                if (!iframe.contentWindow) return;
                iframe.contentWindow.postMessage(JSON.stringify({
                    event: 'command',
                    func: 'setPlaybackQuality',
                    args: [qualityId]
                }), '*');
                if (qualityId !== 'auto') {
                    iframe.contentWindow.postMessage(JSON.stringify({
                        event: 'command',
                        func: 'setPlaybackQualityRange',
                        args: [qualityId, qualityId]
                    }), '*');
                }
            } catch (_) {}
        }

        function queryFromPlayer() {
            const playerObj = getEmbedPlayer();
            if (playerObj) {
                const levels = typeof playerObj.getAvailableQualityLevels === 'function' ? playerObj.getAvailableQualityLevels() : null;
                const data = typeof playerObj.getAvailableQualityData === 'function' ? playerObj.getAvailableQualityData() : null;
                const current = typeof playerObj.getPlaybackQuality === 'function' ? playerObj.getPlaybackQuality() : null;
                if (levels || data || current) {
                    handleQualityData(levels, data, current);
                }
            }

            try {
                sendBridgeCommand('query');
            } catch (_) {}

            try {
                iframe.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
            } catch (_) {}
        }

        /**
         * Injected into the embed document's own realm so quality data can be
         * read across the Firefox Xray boundary.
         */
        const BRIDGE_SCRIPT = `(${function () {
            function getMp() {
                return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            }
            function report() {
                const mp = getMp();
                if (!mp) return;
                try {
                    const levels = typeof mp.getAvailableQualityLevels === 'function' ? mp.getAvailableQualityLevels() : [];
                    const data = typeof mp.getAvailableQualityData === 'function' ? mp.getAvailableQualityData() : [];
                    const current = typeof mp.getPlaybackQuality === 'function' ? mp.getPlaybackQuality() : 'auto';
                    const payload = JSON.stringify({
                        levels: Array.isArray(levels) ? Array.from(levels) : [],
                        data: Array.isArray(data) ? Array.from(data).map(d => ({
                            quality: d.quality,
                            qualityLabel: d.qualityLabel,
                            isHd: !!d.isHd
                        })) : [],
                        current: current
                    });
                    document.dispatchEvent(new CustomEvent('yt-cinema-quality-bridge-event', { detail: payload }));
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: 'yt-cinema-quality-bridge-msg', payload: payload }, '*');
                    }
                } catch (_) {}
            }
            document.addEventListener('yt-cinema-quality-bridge-cmd', (e) => {
                try {
                    const cmd = JSON.parse(e.detail);
                    const mp = getMp();
                    if (!mp) return;
                    if (cmd.action === 'setQuality') {
                        const target = cmd.quality;
                        const range = target === 'auto' ? 'default' : target;
                        if (typeof mp.setPlaybackQualityRange === 'function') mp.setPlaybackQualityRange(range, range);
                        if (typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(target);
                        setTimeout(report, 250);
                    } else if (cmd.action === 'query') {
                        report();
                    }
                } catch (_) {}
            });
            let attempts = 0;
            const checkInt = setInterval(() => {
                attempts++;
                const mp = getMp();
                if (mp) {
                    clearInterval(checkInt);
                    try {
                        if (typeof mp.addEventListener === 'function') {
                            mp.addEventListener('onPlaybackQualityChange', () => setTimeout(report, 100));
                            mp.addEventListener('onStateChange', () => setTimeout(report, 200));
                        }
                    } catch (_) {}
                    report();
                    setTimeout(report, 800);
                    setTimeout(report, 2000);
                } else if (attempts > 30) {
                    clearInterval(checkInt);
                }
            }, 200);
        }})();`;

        function handleBridgeEvent(e) {
            try {
                const info = JSON.parse(e.detail);
                handleQualityData(info.levels, info.data, info.current);
            } catch (_) {}
        }

        function injectBridge(doc) {
            if (!doc) return;
            try {
                if (!doc.getElementById('yt-cinema-quality-bridge')) {
                    const script = doc.createElement('script');
                    script.id = 'yt-cinema-quality-bridge';
                    script.textContent = BRIDGE_SCRIPT;
                    (doc.head || doc.documentElement || doc.body).appendChild(script);
                }

                // Both keyboard.js and player.js call this on every iframe
                // `load`, so the listener is removed and re-added rather than
                // stacked — otherwise every report is handled twice and the
                // menu is re-rendered twice per report.
                if (doc._ytCinemaBridgeListener) {
                    doc.removeEventListener('yt-cinema-quality-bridge-event', doc._ytCinemaBridgeListener);
                }
                doc._ytCinemaBridgeListener = handleBridgeEvent;
                doc.addEventListener('yt-cinema-quality-bridge-event', handleBridgeEvent);
            } catch (_) {}
        }

        // --------------------------------------------------------- data flow

        function toMenuItem(qualityKey, customLabel, isHd) {
            const info = getDisplayInfo(qualityKey, customLabel, isHd);
            return { quality: qualityKey, label: info.label, pill: info.pill, badge: info.badge, rank: info.rank };
        }

        function handleQualityData(levels, data, current) {
            if (typeof current === 'string') currentPlayingQuality = current;

            const itemsMap = new Map();

            (Array.isArray(data) ? data : []).forEach(d => {
                if (!d || !d.quality) return;
                const key = String(d.quality).toLowerCase();
                itemsMap.set(key, toMenuItem(key, d.qualityLabel, d.isHd));
            });

            (Array.isArray(levels) ? levels : []).forEach(level => {
                if (!level) return;
                const key = String(level).toLowerCase();
                if (!itemsMap.has(key)) itemsMap.set(key, toMenuItem(key, null, false));
            });

            if (!itemsMap.has('auto')) {
                itemsMap.set('auto', toMenuItem('auto', 'Auto', false));
            }

            availableQualities = Array.from(itemsMap.values()).sort((a, b) => {
                if (a.quality === 'auto') return 1;
                if (b.quality === 'auto') return -1;
                return b.rank - a.rank;
            });

            applySavedQualityIfNeeded();
            renderMenu();
            updateUI(currentQuality, currentPlayingQuality);
        }

        /**
         * Apply the remembered quality once we know this video actually offers it.
         *
         * `currentQuality` starts out equal to the saved value, so it cannot be
         * used to detect "not applied yet" — the one-shot flag is what makes this
         * run exactly once per video.
         */
        function applySavedQualityIfNeeded() {
            if (savedQualityApplied) return;
            if (!settings.rememberQuality || !settings.savedQuality || settings.savedQuality === 'auto') return;

            const saved = settings.savedQuality.toLowerCase();
            const offered = availableQualities.some(q => String(q.quality).toLowerCase() === saved);
            if (!offered) return;

            savedQualityApplied = true;
            currentQuality = settings.savedQuality;
            applyToPlayer(settings.savedQuality);
        }

        // ------------------------------------------------------------- menu

        function set(qualityId, showNotification = true) {
            currentQuality = qualityId;
            savedQualityApplied = true;
            applyToPlayer(qualityId);
            updateUI(qualityId);

            if (settings.rememberQuality) {
                settings.savedQuality = qualityId;
                YTC.saveQuality(qualityId);
            }

            if (showNotification) {
                ctx.toast.show(`Quality: ${getDisplayInfo(qualityId, null, false).label}`, icons.quality);
            }
        }

        function toggleMenu(open) {
            flags.qualityMenuOpen = typeof open === 'boolean' ? open : !flags.qualityMenuOpen;

            if (!flags.qualityMenuOpen) {
                els.qualityMenu?.classList.remove('yt-cinema-quality-menu-open');
                els.qualityPill?.classList.remove('active');
                focusedQualityIndex = -1;
                return;
            }

            if (flags.speedMenuOpen) ctx.speed.closeMenu();
            els.qualityMenu?.classList.add('yt-cinema-quality-menu-open');
            els.qualityPill?.classList.add('active');
            focusedQualityIndex = availableQualities.findIndex(q => q.quality === currentQuality);
            if (focusedQualityIndex < 0) focusedQualityIndex = 0;
            renderMenu();
            queryFromPlayer();
            ctx.autohide.reset();
        }

        /** Arrow / Enter navigation inside the open menu. */
        function handleMenuKey(event) {
            if (!flags.qualityMenuOpen) return false;
            if (event.key === 'Escape') {
                toggleMenu(false);
                return true;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (availableQualities.length === 0) return true;
                focusedQualityIndex = event.key === 'ArrowDown'
                    ? (focusedQualityIndex + 1) % availableQualities.length
                    : (focusedQualityIndex - 1 + availableQualities.length) % availableQualities.length;
                renderMenu();
                els.qualityMenu?.querySelectorAll('.yt-cinema-quality-item')[focusedQualityIndex]
                    ?.scrollIntoView({ block: 'nearest' });
                return true;
            }
            if (event.key === 'Enter') {
                const focused = availableQualities[focusedQualityIndex];
                if (focused) {
                    set(focused.quality, true);
                    toggleMenu(false);
                }
                return true;
            }
            return false;
        }

        /** Called when a new video loads into this overlay. */
        function resetForNewVideo() {
            currentQuality = (settings.rememberQuality && typeof settings.savedQuality === 'string')
                ? settings.savedQuality
                : 'auto';
            currentPlayingQuality = 'auto';
            availableQualities = [];
            savedQualityApplied = false;
            renderMenu();
            updateUI(currentQuality, 'auto');
        }

        /** Only the embed is allowed to drive this control. */
        function isFromEmbed(event) {
            try {
                return Boolean(iframe.contentWindow) && event.source === iframe.contentWindow;
            } catch (_) {
                return false;
            }
        }

        function handleWindowMessage(event) {
            if (!isFromEmbed(event)) return;

            if (event.data && event.data.type === 'yt-cinema-quality-bridge-msg') {
                try {
                    const info = JSON.parse(event.data.payload);
                    handleQualityData(info.levels, info.data, info.current);
                } catch (_) {}
                return;
            }
            if (!event.data || typeof event.data !== 'string') return;

            try {
                const parsed = JSON.parse(event.data);
                if (parsed.event === 'infoDelivery' && parsed.info) {
                    const { availableQualityLevels, playbackQuality } = parsed.info;
                    if (availableQualityLevels || playbackQuality) {
                        handleQualityData(availableQualityLevels, null, playbackQuality);
                    }
                }
            } catch (_) {}
        }

        function bind() {
            els.qualityPill?.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMenu();
            });

            els.qualityMenu?.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.yt-cinema-quality-item');
                if (item && item.dataset.quality) {
                    set(item.dataset.quality, true);
                    toggleMenu(false);
                }
            });

            window.addEventListener('message', handleWindowMessage);
        }

        function dispose() {
            window.removeEventListener('message', handleWindowMessage);
            try {
                const doc = YTC.player.getEmbedDocument(iframe);
                if (doc?._ytCinemaBridgeListener) {
                    doc.removeEventListener('yt-cinema-quality-bridge-event', doc._ytCinemaBridgeListener);
                    doc._ytCinemaBridgeListener = null;
                }
            } catch (_) {}
        }

        renderMenu();
        updateUI(currentQuality, currentPlayingQuality);

        return {
            set,
            toggleMenu,
            closeMenu: () => toggleMenu(false),
            handleMenuKey,
            resetForNewVideo,
            applyToPlayer: () => applyToPlayer(currentQuality),
            queryFromPlayer: queryFromPlayer,
            injectBridge,
            bind,
            dispose
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.quality = { createQualityControl };
})(globalThis.YTC);
