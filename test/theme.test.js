/**
 * Theme tests — the Catppuccin flavor selector.
 *
 * Every extension surface resolves its colours through the tokens in
 * styles/00-themes.css; these tests pin down which flavor id reaches the
 * document element, including the fallback for unknown or corrupt ids.
 */

const { loadExtension } = require('./harness');

const ATTRIBUTE = 'data-ytc-theme';

describe('theme selection', () => {
    it('ships all six themes (4 Catppuccin + oled-crimson + nord) with mocha as the default', () => {
        const env = loadExtension();
        const theme = env.YTC.theme;

        const expected = ['latte', 'frappe', 'macchiato', 'mocha', 'oled-crimson', 'nord'];
        if (JSON.stringify(theme.THEMES) !== JSON.stringify(expected)) {
            throw new Error(`unexpected flavors: ${JSON.stringify(theme.THEMES)}`);
        }
        if (theme.DEFAULT_THEME !== 'mocha') {
            throw new Error(`unexpected default flavor: ${theme.DEFAULT_THEME}`);
        }
    });

    it('defaults fresh settings to mocha', () => {
        const env = loadExtension();

        if (env.YTC.defaults.theme !== 'mocha') {
            throw new Error(`defaults.theme should be mocha, got ${JSON.stringify(env.YTC.defaults.theme)}`);
        }
        if (env.YTC.settings.theme !== 'mocha') {
            throw new Error(`initial settings.theme should be mocha, got ${JSON.stringify(env.YTC.settings.theme)}`);
        }
    });

    it('mirrors the flavor onto the document element', () => {
        const env = loadExtension();
        env.YTC.theme.apply('latte');

        const actual = env.document.documentElement.getAttribute(ATTRIBUTE);
        if (actual !== 'latte') throw new Error(`expected latte, got ${actual}`);
    });

    it('falls back to the default for unknown or missing ids', () => {
        const env = loadExtension();

        for (const bad of [undefined, null, '', 'solarized', 42, {}]) {
            env.YTC.theme.apply('latte');
            env.YTC.theme.apply(bad);

            const actual = env.document.documentElement.getAttribute(ATTRIBUTE);
            if (actual !== 'mocha') {
                throw new Error(`flavor ${JSON.stringify(bad)} produced attribute "${actual}"`);
            }
        }
    });

    it('applies the stored flavor whenever settings change', () => {
        const env = loadExtension();

        env.YTC.applySettings({ theme: 'frappe' });
        let actual = env.document.documentElement.getAttribute(ATTRIBUTE);
        if (actual !== 'frappe') throw new Error(`expected frappe, got ${actual}`);

        // Unrelated setting changes must not reset the flavor.
        env.YTC.applySettings({ overlayOpacity: 55 });
        actual = env.document.documentElement.getAttribute(ATTRIBUTE);
        if (actual !== 'frappe') throw new Error(`unrelated settings changed the flavor to ${actual}`);
    });

    it('normalizes a corrupt stored flavor', () => {
        const env = loadExtension();
        env.YTC.applySettings({ theme: 'wobble' });

        const actual = env.document.documentElement.getAttribute(ATTRIBUTE);
        if (actual !== 'mocha') throw new Error(`expected the mocha fallback, got ${actual}`);
    });
});
