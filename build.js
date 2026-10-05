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
const { execSync } = require('child_process');

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
        const parentDir = path.dirname(dest);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.copyFileSync(src, dest);
    }
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

    // Create clean zip archive
    const zipName = `youtube-cinema-mode-${targetName.toLowerCase()}.zip`;
    const zipPath = path.join(DIST_DIR, zipName);
    if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
    }
    const doubleZip = path.join(DIST_DIR, `${zipName}.zip`);
    if (fs.existsSync(doubleZip)) {
        fs.unlinkSync(doubleZip);
    }

    try {
        const pyPack = `import zipfile, os; zf = zipfile.ZipFile('${zipPath}', 'w', zipfile.ZIP_DEFLATED); [zf.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), '${targetDir}')) for r, d, files in os.walk('${targetDir}') for f in files]; zf.close()`;
        execSync(`python3 -c "${pyPack}"`);
        console.log(`  ✨ Packaged archive: dist/${zipName}`);
    } catch (err) {
        console.warn(`  ⚠ Packaging failed for ${zipName}:`, err.message);
    }
}

function main() {
    console.log('🚀 YouTube Cinema Mode Build Process');
    console.log('====================================');

    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    // 1. Chrome Distribution
    buildTarget('Chrome', CHROME_DIST, 'manifest.json');

    // 2. Firefox Distribution (AMO / Firefox 109+ & ESR 115)
    buildTarget('Firefox', FIREFOX_DIST, 'manifest.firefox.json');

    console.log('\n✅ Build complete!');
    console.log('----------------------------------------------------');
    console.log('• Chrome extension build : dist/chrome/ (Load unpacked in chrome://extensions)');
    console.log('• Firefox extension build: dist/firefox/ (Load temporary add-on in about:debugging#/runtime/this-firefox)');
    console.log('----------------------------------------------------\n');
}

main();

