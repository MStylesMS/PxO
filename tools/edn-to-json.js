#!/usr/bin/env node

/**
 * edn-to-json.js
 * Usage: node edn-to-json.js <input.edn> [output.json]
 * If output.json is omitted, uses input filename prefix + .json
 */

const fs = require('fs');
const path = require('path');
const EdnConfigLoader = require('../game/src/edn-config-loader');

function usage() {
    console.log('Usage: node tools/edn-to-json.js <input.edn> [output.json]');
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1) usage();

const inPath = path.resolve(args[0]);
let outPath = args[1] ? path.resolve(args[1]) : path.join(path.dirname(inPath), path.basename(inPath, path.extname(inPath)) + '.json');

try {
    const cfg = EdnConfigLoader.load(inPath);
    fs.writeFileSync(outPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log(`Wrote JSON to: ${outPath}`);
} catch (e) {
    console.error('Failed to convert EDN to JSON:', e.message);
    process.exit(2);
}
