#!/usr/bin/env node
/* Config validation script for EDN-based game configuration. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const { loadConfig } = require(path.join(ROOT, 'src', 'config'));

function fail(msg) {
  console.error('CONFIG VALIDATION ERROR:', msg);
  process.exitCode = 1;
}

function main() {
  const ednPath = path.join(CONFIG_DIR, 'game.edn');
  if (!fs.existsSync(ednPath)) {
    fail('Missing game.edn');
    return;
  }
  const rawEdn = fs.readFileSync(ednPath, 'utf8');
  const cfg = loadConfig();

  // Collect issues
  const issues = [];

  // 1. Check raw EDN text for obsolete lowercase playAudioFx prefixes.
  if (rawEdn.includes('playAudioFx:')) {
    issues.push('EDN config contains disallowed playAudioFx: prefix; use playAudioFX:');
  }

  // 2. (Refactor) Media catalog removed; skip enforcing legacy videos.* assets.
  // Optionally warn if old structure still present but incomplete.
  if (cfg.global && cfg.global.media && cfg.global.media.videos) {
    const vids = cfg.global.media.videos;
    if (!vids['fail-standard'] || !vids['win-standard']) {
      console.warn('CONFIG WARNING: partial legacy videos catalog detected; consider removing videos map entirely.');
    }
  }

  if (issues.length) {
    issues.forEach(i => console.error(' -', i));
    fail(`${issues.length} validation issue(s) found.`);
  } else {
    console.log('Config validation passed.');
  }
}

main();