#!/usr/bin/env node
// Minimal runner to execute only unified-phases.test.js using the same ad-hoc harness
const path = require('path');
const testFile = path.join(__dirname, 'unified-phases.test.js');

let failures = 0;
function log(msg) { process.stdout.write(msg + '\n'); }

const _beforeEach = [];
const _afterEach = [];

global.beforeEach = (fn) => { _beforeEach.push(fn); };
global.afterEach = (fn) => { _afterEach.push(fn); };

global.describe = (name, fn) => { log(`\nSuite: ${name}`); try { fn(); } catch (e) { log(`Suite failed: ${e.message}`); failures++; } };

global.test = (name, fn) => {
    try {
        // run beforeEach hooks
        for (const h of _beforeEach) h();
        const maybePromise = fn();
        if (maybePromise && typeof maybePromise.then === 'function') {
            return maybePromise.then(() => {
                for (const h of _afterEach) h();
                log(`  ✓ ${name}`);
            }).catch(e => { failures++; log(`  ✗ ${name} -> ${e.message}`); });
        }
        for (const h of _afterEach) h();
        log(`  ✓ ${name}`);
    } catch (e) {
        failures++; log(`  ✗ ${name} -> ${e.message}`);
    }
};

require(testFile);

// If any async tests returned promises, wait a short tick to let them finish
setTimeout(() => {
    if (failures > 0) { log(`\n${failures} test(s) failed.`); process.exit(1); }
    else { log('\nAll unified tests passed.'); process.exit(0); }
}, 50);
