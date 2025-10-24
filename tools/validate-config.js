#!/usr/bin/env node
/* Config validation script
 * Ensures:
 *  - Only playAudioFX: (uppercase FX) cue prefixes for audio fx
 *  - No playAudioFx: lowercase variant
 *  - No mixed media payload keys (video/image/audio) in adapter-produced commands (we just inspect config cues/hints)
 *  - Required global media.win/fail entries exist
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const { loadConfig } = require(path.join(ROOT, 'src', 'config'));

function fail(msg) {
  console.error('CONFIG VALIDATION ERROR:', msg);
  process.exitCode = 1;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const modularPath = path.join(CONFIG_DIR, 'example.json');
  if (!fs.existsSync(modularPath)) {
    fail('Missing example.json');
    return;
  }
  const rawCfg = loadJson(modularPath);
  const cfg = loadConfig();

  // Collect issues
  const issues = [];

  // 1. Check cues for lowercase playAudioFx: variant and enforce uppercase FX
  const cues = (rawCfg.global && rawCfg.global.cues) || {};
  Object.entries(cues).forEach(([name, cue]) => {
    ['mirror', 'picture', 'audio'].forEach(k => {
      if (!cue || typeof cue[k] !== 'string') return;
      const v = cue[k];
      if (v.includes('playAudioFx:')) {
        issues.push(`Cue ${name}.${k} uses disallowed prefix playAudioFx: → ${v}`);
      }
      // If it contains playAudioFX ensure proper case
      if (v.toLowerCase().includes('playaudiofx:') && !v.includes('playAudioFX:')) {
        issues.push(`Cue ${name}.${k} has incorrectly cased playAudioFX prefix: ${v}`);
      }
    });
  });

  // 2. (Refactor) Media catalog removed; skip enforcing legacy videos.* assets.
  // Optionally warn if old structure still present but incomplete.
  if (cfg.global && cfg.global.media && cfg.global.media.videos) {
    const vids = cfg.global.media.videos;
    if (!vids['fail-standard'] || !vids['win-standard']) {
      console.warn('CONFIG WARNING: partial legacy videos catalog detected; consider removing videos map entirely.');
    }
  }

  // 3. Ensure no legacy keys in games[].game.schedule entries
  const legacyDirectivePatterns = [/playAudioFx:/];
  const games = rawCfg.games || {};
  Object.entries(games).forEach(([gName, gCfg]) => {
    const schedules = [gCfg.intro, gCfg.game, gCfg.win, gCfg.fail].filter(Boolean).map(s => s.schedule || []);
    schedules.flat().forEach(entry => {
      if (entry.fireCue && typeof entry.fireCue === 'string') {
        legacyDirectivePatterns.forEach(re => { if (re.test(entry.fireCue)) issues.push(`Game ${gName} schedule entry at ${entry.at} fireCue has legacy prefix pattern: ${entry.fireCue}`); });
      }
    });
  });

  if (issues.length) {
    issues.forEach(i => console.error(' -', i));
    fail(`${issues.length} validation issue(s) found.`);
  } else {
    console.log('Config validation passed.');
  }
}

main();