/**
 * Theme — selects the Catppuccin flavor used by every extension surface.
 *
 * The palette itself lives in styles/00-themes.css; this module only decides
 * which flavor attribute the document carries, so any stylesheet (overlay,
 * menus, toasts, hover badge) inherits the right tokens for free.
 */
(function (YTC) {
    'use strict';

    const THEMES = ['latte', 'frappe', 'macchiato', 'mocha'];
    const DEFAULT_THEME = 'mocha';
    const ATTRIBUTE = 'data-ytc-theme';

    /** Unknown or missing ids must degrade to the default rather than emit a naked attribute. */
    function normalize(themeId) {
        return THEMES.includes(themeId) ? themeId : DEFAULT_THEME;
    }

    function apply(themeId) {
        document.documentElement.setAttribute(ATTRIBUTE, normalize(themeId));
    }

    YTC.theme = { THEMES, DEFAULT_THEME, apply };
})(globalThis.YTC);
