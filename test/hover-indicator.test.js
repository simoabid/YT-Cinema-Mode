/**
 * Structural guard for the hover badge hit-testing fix.
 *
 * The badge fades by opacity and keeps its last position, so without a
 * `pointer-events: none` rule it keeps swallowing clicks on the thumbnail
 * underneath. The mock DOM cannot compute styles, so the stylesheet rule is
 * asserted directly.
 */

const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '../content/styles/01-overlay.css'), 'utf8');

describe('hover badge hit-testing', () => {
    it('ignores pointer events while faded out', () => {
        const hiddenRule = /\.yt-cinema-hover-indicator:not\(\.yt-cinema-hover-visible\)\s*\{[^}]*pointer-events:\s*none/;
        if (!hiddenRule.test(CSS)) {
            throw new Error('faded hover badge must set pointer-events: none');
        }
    });

    it('stays clickable while visible', () => {
        const visibleRule = /\.yt-cinema-hover-indicator\.yt-cinema-hover-visible\s*\{[^}]*opacity:\s*1/;
        if (!visibleRule.test(CSS)) {
            throw new Error('visible hover badge rule is missing');
        }
    });
});
