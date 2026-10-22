/**
 * Zero-dependency test runner.
 *
 * Usage: node test/run.js [name-filter]
 */

const fs = require('fs');
const path = require('path');

const results = [];
let currentFile = null;

function describe(name, fn) { fn(); }
function it(name, fn) {
    const test = { file: currentFile, name, fn };
    results.push(test);
}

const GLOBALS = { describe, it };
Object.assign(globalThis, GLOBALS);

async function main() {
    const filter = process.argv[2] || '';
    const files = fs.readdirSync(__dirname)
        .filter((f) => f.endsWith('.test.js'))
        .sort();

    for (const file of files) {
        currentFile = file;
        require(path.join(__dirname, file));
    }

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const test of results) {
        if (filter && !`${test.file} ${test.name}`.toLowerCase().includes(filter.toLowerCase())) continue;
        try {
            await test.fn();
            passed++;
            process.stdout.write('.');
        } catch (err) {
            failed++;
            failures.push({ test, err });
            process.stdout.write('F');
        }
    }

    process.stdout.write('\n\n');
    for (const { test, err } of failures) {
        console.log(`FAIL  ${test.file} > ${test.name}`);
        console.log(`      ${err && err.message ? err.message : err}`);
        if (err && err.stack) {
            const frame = err.stack.split('\n').find((l) => l.includes('/test/') || l.includes('/content/'));
            if (frame) console.log(`      ${frame.trim()}`);
        }
        console.log('');
    }

    console.log(`${passed} passed, ${failed} failed, ${results.length} total`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('runner crashed:', err);
    process.exit(1);
});
