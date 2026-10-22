/**
 * YouTube Cinema Mode - Build & Packaging Script
 * Cross-platform script to prepare clean distributions for:
 *   - Google Chrome / Chromium (Chrome Web Store) -> dist/chrome & dist/youtube-cinema-mode-chrome.zip
 *   - Mozilla Firefox (AMO / Add-ons)             -> dist/firefox & dist/youtube-cinema-mode-firefox.zip
 *
 * Usage: node build.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const CHROME_DIST = path.join(DIST_DIR, 'chrome');
const FIREFOX_DIST = path.join(DIST_DIR, 'firefox');

// Files and directories to copy into builds
const COMMON_ENTRIES = [
    'background',
    'content',
    'popup',
    'icons'
];

/**
 * Working assets that live in the source tree but must never reach a store
 * upload. The master icon is ~750KB of unused weight in the package.
 */
const EXCLUDE_FROM_PACKAGE = [/^icon-source\.png$/];

function rmDirRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        if (EXCLUDE_FROM_PACKAGE.some((re) => re.test(path.basename(dest)))) return;
        const parentDir = path.dirname(dest);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.copyFileSync(src, dest);
    }
}

// ---------------------------------------------------------------- zip writer

/**
 * Minimal store-only ZIP writer (no external tooling required).
 *
 * Store uploads need plain deflate or stored entries and forward-slash paths;
 * that is all this produces. Writing it here keeps `node build.js` working on
 * a bare machine instead of depending on python3 or the `zip` binary.
 */
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

/** Every file under `dir`, as paths relative to `dir` with `/` separators. */
function collectFiles(dir, prefix = '') {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...collectFiles(path.join(dir, entry.name), rel));
        } else if (entry.isFile()) {
            files.push(rel);
        }
    }
    return files;
}

function writeZip(sourceDir, zipPath) {
    const entries = collectFiles(sourceDir);
    if (entries.length === 0) throw new Error(`nothing to archive in ${sourceDir}`);

    const { time, day } = dosDateTime(new Date());
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const name of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const raw = fs.readFileSync(path.join(sourceDir, name));
        const deflated = zlib.deflateRawSync(raw, { level: 9 });
        const useDeflate = deflated.length < raw.length;
        const body = useDeflate ? deflated : raw;
        const method = useDeflate ? 8 : 0;
        const crc = crc32(raw);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);   // local file header signature
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(0x0800, 6);      // UTF-8 filename flag
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);          // extra field length

        localChunks.push(local, nameBuf, body);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); // central directory signature
        central.writeUInt16LE(20, 4);          // version made by
        central.writeUInt16LE(20, 6);          // version needed
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);         // extra field length
        central.writeUInt16LE(0, 32);         // comment length
        central.writeUInt16LE(0, 34);         // disk number start
        central.writeUInt16LE(0, 36);         // internal attrs
        central.writeUInt32LE(0, 38);         // external attrs
        central.writeUInt32LE(offset, 42);

        centralChunks.push(central, nameBuf);
        offset += local.length + nameBuf.length + body.length;
    }

    const centralBuf = Buffer.concat(centralChunks);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);         // end of central directory
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    fs.writeFileSync(zipPath, Buffer.concat([...localChunks, centralBuf, end]));
    return entries.length;
}

function buildTarget(targetName, targetDir, manifestSource) {
    console.log(`\n📦 Building ${targetName}...`);
    rmDirRecursive(targetDir);
    fs.mkdirSync(targetDir, { recursive: true });

    // Copy manifest
    const manifestDest = path.join(targetDir, 'manifest.json');
    fs.copyFileSync(path.join(ROOT_DIR, manifestSource), manifestDest);
    console.log(`  ✓ Copied ${manifestSource} -> manifest.json`);

    // Copy common entries
    for (const entry of COMMON_ENTRIES) {
        const srcPath = path.join(ROOT_DIR, entry);
        const destPath = path.join(targetDir, entry);
        if (fs.existsSync(srcPath)) {
            copyRecursive(srcPath, destPath);
            console.log(`  ✓ Copied ${entry}/`);
        } else {
            console.warn(`  ⚠ Entry not found: ${entry}`);
        }
    }

    // Create the store archive. A packaging failure is fatal: a build that
    // silently ships without an archive looks green and fails at upload time.
    const zipName = `youtube-cinema-mode-${targetName.toLowerCase()}.zip`;
    const zipPath = path.join(DIST_DIR, zipName);
    const count = writeZip(targetDir, zipPath);
    console.log(`  ✨ Packaged archive: dist/${zipName} (${count} files)`);
}

function main() {
    console.log('🚀 YouTube Cinema Mode Build Process');
    console.log('====================================');

    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    // 1. Chrome Distribution
    buildTarget('Chrome', CHROME_DIST, 'manifest.json');

    // 2. Firefox Distribution (AMO)
    buildTarget('Firefox', FIREFOX_DIST, 'manifest.firefox.json');

    console.log('\n✅ Build complete!');
    console.log('----------------------------------------------------');
    console.log('• Chrome extension build : dist/chrome/ (Load unpacked in chrome://extensions)');
    console.log('• Firefox extension build: dist/firefox/ (Load temporary add-on in about:debugging#/runtime/this-firefox)');
    console.log('----------------------------------------------------\n');
}

main();

