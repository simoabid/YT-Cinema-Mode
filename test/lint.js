#!/usr/bin/env node
/**
 * Lightweight project lint — zero dependencies, no bundler, no config file.
 *
 * These checks exist because of bugs that actually shipped in this project,
 * so they are all things that are cheap to detect mechanically:
 *
 *   1. Every file the manifest lists actually exists (and nothing is unlisted).
 *   2. Manifest versions agree with package.json.
 *   3. Chrome manifest requests no permission MV3 forbids.
 *   4. No `YTC.x` reference to a member that is never defined anywhere.
 *   5. Every CSS class used from JS has a rule in content/styles/.
 *   6. Every CSS custom property read is defined in CSS or set from JS.
 *   7. No exported member of a YTC.* namespace is dead.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const problems = [];
const warnings = [];

function fail(file, msg) { problems.push(`${file}: ${msg}`); }
function warn(file, msg) { warnings.push(`${file}: ${msg}`); }

function walk(dir, filter, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, filter, out);
        else if (!filter || filter(full)) out.push(full);
    }
    return out;
}

const jsFiles = (dir) => walk(path.join(ROOT, dir), (f) => f.endsWith('.js'));
const rel = (f) => path.relative(ROOT, f);

// ------------------------------------------------------------ 1-3. manifests

function checkManifest(name, file) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) { fail(file, 'manifest is missing'); return null; }

    let m;
    try {
        m = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
        fail(file, `is not valid JSON: ${err.message}`);
        return null;
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    if (m.version !== pkg.version) {
        fail(file, `version ${m.version} does not match package.json ${pkg.version}`);
    }
    if (m.manifest_version !== 3) {
        fail(file, `manifest_version must be 3, found ${m.manifest_version}`);
    }

    for (const cs of m.content_scripts || []) {
        for (const js of cs.js || []) {
            if (!fs.existsSync(path.join(ROOT, js))) fail(file, `content_scripts lists missing file: ${js}`);
        }
        for (const css of cs.css || []) {
            if (!fs.existsSync(path.join(ROOT, css))) fail(file, `content_scripts lists missing stylesheet: ${css}`);
        }
    }

    for (const p of m.permissions || []) {
        if (p === 'webRequestBlocking' && file === 'manifest.json') {
            fail(file, 'requests webRequestBlocking; MV3 Chrome reserves this for policy installs and it triggers a store rejection');
        }
    }

    // Chrome builds must not carry Gecko-only keys.
    if (file === 'manifest.json' && m.browser_specific_settings) {
        warn(file, 'carries browser_specific_settings, which Chromium ignores');
    }

    return m;
}

const chromeManifest = checkManifest('chrome', 'manifest.json');
checkManifest('firefox', 'manifest.firefox.json');

// Every source file under content/ should be reachable from a manifest entry.
const listedJs = new Set();
const listedCss = new Set();
for (const file of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const cs of m.content_scripts || []) {
        (cs.js || []).forEach((f) => listedJs.add(f));
        (cs.css || []).forEach((f) => listedCss.add(f));
    }
}
for (const f of jsFiles('content')) {
    if (!listedJs.has(rel(f))) fail(rel(f), 'is not listed in any manifest content_scripts (it would never load)');
}
for (const f of walk(path.join(ROOT, 'content/styles'), (x) => x.endsWith('.css'))) {
    if (!listedCss.has(rel(f))) fail(rel(f), 'is not listed in any manifest content_scripts (it would never load)');
}

// ------------------------------------------------- 4. YTC member references

const contentJs = jsFiles('content');
const allJsText = contentJs.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const buildJs = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
const popupJs = fs.readFileSync(path.join(ROOT, 'popup/popup.js'), 'utf8');
const allText = `${allJsText}\n${buildJs}\n${popupJs}`;

// Members attached to the YTC namespace, e.g. `YTC.video = {...}` / `YTC.foo =`
const defined = new Set();
for (const m of allText.matchAll(/\bYTC(?:\.controls)?\.([A-Za-z_$][\w$]*)\s*=/g)) {
    defined.add(m[1]);
}
// Members created dynamically as properties of an existing namespace.
for (const m of allText.matchAll(/\bYTC\.controls\.([A-Za-z_$][\w$]*)\s*=\s*\{/g)) defined.add(m[1]);
for (const name of ['api', 'KEYS', 'defaults', 'settings', 'state', 'util', 'storage', 'icons', 'video',
    'layout', 'player', 'overlay', 'launcher', 'controls', 'controller', 'hover', 'chapters', 'queue',
    'saveSpeed', 'saveQuality', 'applyAmbientSettings', 'applyBackdropSettings', 'lockScroll', 'unlockScroll',
    'pauseBackgroundVideo', 'resumeBackgroundVideo', 'applySettings', 'initSettings']) {
    defined.add(name);
}

for (const file of [...contentJs, path.join(ROOT, 'popup/popup.js')]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bYTC\.([A-Za-z_$][\w$]*)\b/g)) {
        if (!defined.has(m[1])) fail(rel(file), `references YTC.${m[1]}, which is never defined`);
    }
    for (const m of text.matchAll(/\bYTC\.controls\.([A-Za-z_$][\w$]*)\b/g)) {
        if (!defined.has(m[1])) fail(rel(file), `references YTC.controls.${m[1]}, which is never defined`);
    }
}

// ---------------------------------------------- 5. CSS classes used from JS

const cssFiles = walk(path.join(ROOT, 'content/styles'), (f) => f.endsWith('.css'));
const cssText = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const cssClasses = new Set();
for (const m of cssText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);

/**
 * Pull class names out of a fragment. Accepts both a selector
 * (`.a > .b`) and a bare class token (`a b`, as passed to classList.add).
 */
function classesInSelector(selector) {
    const found = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    if (found.length === 0) {
        // Nothing dot-prefixed: the tokens are bare class names.
        for (const token of selector.split(/\s+/).filter(Boolean)) {
            if (/^-?[A-Za-z_][\w-]*$/.test(token)) found.push(token);
        }
    }
    return found;
}

// Classes deliberately owned by the stylesheet injected into the embed iframe.
const EMBED_ONLY = /^yt-cinema-(cursor-hidden|video-controls-(hidden|visible))$/;

/** Only genuine class usages, not CSS variable names or custom event names. */
function classUsages(text) {
    const applied = new Set();
    const queried = new Set();
    // Whole class="..." attribute values, kept so modifier hooks shipped next to
    // a styled base class can be recognised as such.
    const groups = [];

    const add = (set, s) => { for (const c of classesInSelector(s)) set.add(c); };

    // classList.add/remove/toggle(...) and className = '...'
    for (const m of text.matchAll(/\.classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
        for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) add(applied, q[1]);
    }
    for (const m of text.matchAll(/\.classList\.contains\(\s*['"]([^'"]+)['"]\s*\)/g)) add(queried, m[1]);
    for (const m of text.matchAll(/\.className\s*=\s*['"]([^'"]+)['"]/g)) add(applied, m[1]);

    // class="..." inside markup templates. Skip interpolated template values,
    // which can contain unrelated dots (e.g. `item.badge`).
    for (const m of text.matchAll(/\bclass="([^"$]*)"/g)) {
        groups.push(m[1].split(/\s+/).filter(Boolean));
    }

    // Selector arguments are JS hooks, not styling.
    for (const m of text.matchAll(/\.(?:closest|querySelector|querySelectorAll|matches)\(\s*['"]([^'"]+)['"]/g)) add(queried, m[1]);

    return { applied, queried, groups };
}

// Only our own namespace is ours to style. `.ytp-*`, `.html5-video-player` and
// friends belong to YouTube's page and the stylesheet injected into the embed.
const OWN_PREFIX = 'yt-cinema-';

function isOurs(cls) {
    return cls.startsWith(OWN_PREFIX) && !EMBED_ONLY.test(cls);
}

const reportedClasses = new Set();
const reportUnstyled = (file, cls) => {
    if (!isOurs(cls) || cssClasses.has(cls)) return;
    const key = `${rel(file)}|${cls}`;
    if (reportedClasses.has(key)) return;
    reportedClasses.add(key);
    fail(rel(file), `applies class "${cls}" but no rule in content/styles defines it`);
};

for (const file of contentJs) {
    const text = fs.readFileSync(file, 'utf8');
    const { applied, groups } = classUsages(text);

    for (const cls of applied) reportUnstyled(file, cls);

    // A BEM-style modifier that always ships alongside a styled base class
    // (`class="yt-cinema-btn yt-cinema-prev-btn"`) is a JS hook, not a styling
    // gap — only flag groups where *nothing* in the attribute is styled.
    for (const group of groups) {
        if (group.some((cls) => cssClasses.has(cls))) continue;
        for (const cls of group) reportUnstyled(file, cls);
    }
}

// ------------------------------------------- 6. CSS custom property coverage

const definedVars = new Set();
for (const m of cssText.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(m[1]);
for (const m of allJsText.matchAll(/setProperty\(\s*['"](--[\w-]+)['"]/g)) definedVars.add(m[1]);

for (const file of cssFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!definedVars.has(m[1])) {
            fail(rel(file), `reads var(${m[1]}) but nothing defines or sets it`);
        }
    }
}

// ------------------------------------------------------ 7. dead exports

const exported = new Map();
for (const file of contentJs) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /YTC(?:\.controls)?\.[A-Za-z_$][\w$]*\s*=\s*\{([^}]*)\}/g;
    for (const m of text.matchAll(re)) {
        for (const name of m[1].split(',')) {
            const key = name.trim().split(':')[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(key)) {
                if (!exported.has(key)) exported.set(key, []);
                exported.get(key).push(rel(file));
            }
        }
    }
}

for (const [name, files] of exported) {
    // Count references outside the definition line itself.
    let uses = 0;
    for (const file of [...contentJs, path.join(ROOT, 'popup/popup.js'), path.join(ROOT, 'background/background.js')]) {
        const text = fs.readFileSync(file, 'utf8');
        const matches = text.match(new RegExp(`\\b${name}\\b`, 'g'));
        if (matches) uses += matches.length;
    }
    // One occurrence = the export itself.
    if (uses <= files.length) {
        warn(files[0], `exports "${name}" but nothing consumes it`);
    }
}

// ----------------------------------------------------- 8. README TOC links

/**
 * GitHub's heading slug: lowercase, drop everything that is not a letter,
 * digit, space, hyphen or underscore (this is what eats emoji and stray
 * variation selectors), then turn spaces into hyphens.
 */
function githubSlug(title) {
    const text = title
        .trim()
        .toLowerCase()
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    let out = '';
    for (const ch of text) {
        if (ch === ' ' || ch === '-' || ch === '_') { out += ch; continue; }
        if (/[\p{L}\p{N}]/u.test(ch)) out += ch;
    }
    return out.replace(/ /g, '-');
}

const readmePath = path.join(ROOT, 'README.md');
if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const headings = new Set();
    for (const m of readme.matchAll(/^#{2,4} (.+)$/gm)) headings.add(githubSlug(m[1]));

    for (const m of readme.matchAll(/^- \[.+?\]\(#(.+?)\)\s*$/gm)) {
        if (!headings.has(m[1])) {
            fail('README.md', `table-of-contents link "](#${m[1]})" matches no heading`);
        }
    }
}

// ------------------------------------------------------------------ report
console.log('lint: manifests, namespace refs, CSS coverage, dead exports\n');

if (warnings.length) {
    console.log(`${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  warn  ${w}`);
    console.log('');
}

if (problems.length) {
    console.log(`${problems.length} error(s):`);
    for (const p of problems) console.log(`  FAIL  ${p}`);
    process.exit(1);
}

console.log('no errors');
