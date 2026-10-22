/**
 * Regression tests for core.js settings + overlay visuals.
 *
 * The bug: `applyAmbientSettings` branched on `settings.ambientBlur !== undefined`
 * first, and DEFAULTS always defines it, so the `ambientQuality` fallbacks below
 * were unreachable — the "Ambient Glow Quality" dropdown in the popup had no
 * effect on anything.
 */

const { loadExtension } = require('./harness');

function readCssVars(overlay) {
    return {
        blur: overlay.style.getPropertyValue('--yt-cinema-ambient-blur'),
        fsBlur: overlay.style.getPropertyValue('--yt-cinema-ambient-fs-blur'),
        opacity: overlay.style.getPropertyValue('--yt-cinema-ambient-opacity'),
        scale: overlay.style.getPropertyValue('--yt-cinema-ambient-scale')
    };
}

function setupCore(overrides = {}) {
    const env = loadExtension();
    const overlay = env.document.createElement('div');
    overlay.className = 'yt-cinema-overlay';
    overlay._startAmbient = () => {};
    overlay._stopAmbient = () => {};

    const ambientLayer = env.document.createElement('div');
    ambientLayer.className = 'yt-cinema-ambient-layer';
    const container = env.document.createElement('div');
    container.className = 'yt-cinema-container';
    container.style.width = '800px';
    container.style.height = '500px';
    overlay.appendChild(ambientLayer);
    overlay.appendChild(container);

    env.YTC.applySettings(overrides);
    return { env, overlay };
}

describe('ambient blur resolution', () => {
    it('honours an explicit ambientBlur', () => {
        const { env, overlay } = setupCore({ ambientLighting: true, ambientBlur: 55, ambientQuality: 'high' });
        env.YTC.applyAmbientSettings(overlay);

        const vars = readCssVars(overlay);
        if (vars.blur !== '55px') throw new Error(`expected blur 55px, got ${vars.blur}`);
        if (vars.fsBlur !== '69px') throw new Error(`expected fs blur 69px, got ${vars.fsBlur}`);
    });

    it('falls back to the named quality when no blur is stored', () => {
        const cases = [
            ['medium', '40px', '50px'],
            ['low', '0px', '0px'],
            ['high', '80px', '100px']
        ];

        for (const [quality, blur, fsBlur] of cases) {
            const { env, overlay } = setupCore({ ambientLighting: true, ambientQuality: quality });
            // Simulate a settings blob written before the blur slider existed.
            delete env.YTC.settings.ambientBlur;

            env.YTC.applyAmbientSettings(overlay);

            const vars = readCssVars(overlay);
            if (vars.blur !== blur) {
                throw new Error(`quality="${quality}": expected blur ${blur}, got ${vars.blur}`);
            }
            if (vars.fsBlur !== fsBlur) {
                throw new Error(`quality="${quality}": expected fs blur ${fsBlur}, got ${vars.fsBlur}`);
            }
        }
    });

    it('falls back to the named quality when the stored blur is malformed', () => {
        // A partially-written or hand-edited settings blob can leave a
        // non-numeric blur behind. It must degrade to the quality preset
        // rather than emitting `NaNpx` or silently forcing "high".
        const cases = [
            ['low', null, '0px'],
            ['low', 'auto', '0px'],
            ['medium', null, '40px'],
            ['medium', NaN, '40px'],
            ['medium', 'medium', '40px']
        ];

        for (const [quality, badBlur, expected] of cases) {
            const { env, overlay } = setupCore({
                ambientLighting: true,
                ambientQuality: quality,
                ambientBlur: badBlur
            });

            env.YTC.applyAmbientSettings(overlay);

            const vars = readCssVars(overlay);
            if (vars.blur !== expected) {
                throw new Error(
                    `quality="${quality}" blur=${JSON.stringify(badBlur)}: expected ${expected}, got ${vars.blur}`
                );
            }
        }
    });

    it('never emits a NaN blur radius', () => {
        for (const badBlur of [null, 'abc', NaN, {}]) {
            const { env, overlay } = setupCore({ ambientLighting: true, ambientBlur: badBlur });
            env.YTC.applyAmbientSettings(overlay);

            const { blur, fsBlur } = readCssVars(overlay);
            if (blur.includes('NaN') || fsBlur.includes('NaN')) {
                throw new Error(`blur=${JSON.stringify(badBlur)} produced ${blur} / ${fsBlur}`);
            }
        }
    });

    it('falls back to high for an unknown quality name', () => {
        const { env, overlay } = setupCore({ ambientLighting: true, ambientQuality: 'wobble' });
        delete env.YTC.settings.ambientBlur;

        env.YTC.applyAmbientSettings(overlay);

        const vars = readCssVars(overlay);
        if (vars.blur !== '80px') throw new Error(`expected the high default, got ${vars.blur}`);
    });

    it('scales glow opacity with the intensity slider', () => {
        const { env, overlay } = setupCore({ ambientLighting: true, ambientGlow: 100 });
        env.YTC.applyAmbientSettings(overlay);

        const vars = readCssVars(overlay);
        if (vars.opacity !== '0.90') throw new Error(`expected max opacity 0.90, got ${vars.opacity}`);
    });

    it('clamps glow intensity to the documented 20-100% range', () => {
        const { env, overlay } = setupCore({ ambientLighting: true, ambientGlow: 5 });
        env.YTC.applyAmbientSettings(overlay);

        const vars = readCssVars(overlay);
        if (vars.opacity !== '0.46') throw new Error(`expected clamped floor 0.46, got ${vars.opacity}`);
    });

    it('stops the ambient loop and hides the layer when ambient is off', () => {
        const env = loadExtension();
        const overlay = env.document.createElement('div');
        const ambientLayer = env.document.createElement('div');
        ambientLayer.className = 'yt-cinema-ambient-layer';
        overlay.appendChild(ambientLayer);

        let stopped = 0;
        overlay._startAmbient = () => {};
        overlay._stopAmbient = () => { stopped++; };

        env.YTC.applySettings({ ambientLighting: false });
        env.YTC.applyAmbientSettings(overlay);

        if (stopped !== 1) throw new Error(`expected the ambient loop to be stopped once, got ${stopped}`);
        if (ambientLayer.style.display !== 'none') throw new Error('ambient layer should be hidden');
    });
});

describe('backdrop style', () => {
    it('OLED mode clears the glass background variables', () => {
        const { env, overlay } = setupCore({ backdropStyle: 'oled' });
        env.YTC.applyBackdropSettings(overlay);

        if (!overlay.classList.contains('yt-cinema-oled')) throw new Error('OLED class not applied');
        if (overlay.style.getPropertyValue('--yt-cinema-backdrop-opacity') !== '') {
            throw new Error('OLED mode should clear the glass background');
        }
    });

    it('glass mode applies the configured opacity', () => {
        const { env, overlay } = setupCore({ backdropStyle: 'glass', overlayOpacity: 75 });
        env.YTC.applyBackdropSettings(overlay);

        const opacity = overlay.style.getPropertyValue('--yt-cinema-backdrop-opacity');
        if (opacity !== '75%') throw new Error(`wrong backdrop opacity: ${opacity}`);
    });
});

describe('settings migration', () => {
    it('migrates the retired h + direct-mini-player profile', () => {
        const env = loadExtension();
        env.YTC.applySettings({ hotkey: 'h', directMiniPlayer: true, overlayOpacity: 42 });

        if (env.YTC.settings.hotkey !== ' ') throw new Error(`hotkey should migrate to Space, got "${env.YTC.settings.hotkey}"`);
        if (env.YTC.settings.directMiniPlayer !== false) throw new Error('directMiniPlayer should migrate to false');
        if (env.YTC.settings.overlayOpacity !== 42) throw new Error('migration clobbered unrelated user settings');
    });

    it('leaves a deliberate h hotkey alone when directMiniPlayer is off', () => {
        const env = loadExtension();
        env.YTC.applySettings({ hotkey: 'h', directMiniPlayer: false });

        if (env.YTC.settings.hotkey !== 'h') {
            throw new Error('a deliberate "h" hotkey was wrongly migrated');
        }
    });

    it('no longer carries the dead playerWidth/showControls defaults', () => {
        const env = loadExtension();
        if ('playerWidth' in env.YTC.defaults) throw new Error('dead default "playerWidth" still present');
        if ('showControls' in env.YTC.defaults) throw new Error('dead default "showControls" still present');
    });
});
