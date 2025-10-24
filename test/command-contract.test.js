/* Contract checks (node - no framework) */
const fs = require('fs');
const path = require('path');

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function grepFile(p, re) {
  return re.test(fs.readFileSync(p, 'utf8'));
}

function main() {
  const root = path.resolve(__dirname, '..');
  const configPath = path.join(root, '..', 'config', 'example.json');
  const modular = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // 1. Ensure no lowercase playAudioFx: prefix anywhere in cues
  const cues = modular.global.cues || {};
  Object.entries(cues).forEach(([name, c]) => {
    ['mirror', 'picture', 'audio'].forEach(k => {
      if (c && typeof c[k] === 'string') {
        if (c[k].includes('playAudioFx:')) throw new Error(`Cue ${name}.${k} contains lowercase playAudioFx variant`);
      }
    });
  });

  // 2. Ensure adapter pfx.js uses file key not video/audio/image
  const adapterPath = path.join(root, 'src', 'adapters', 'pfx.js');
  const adapterSrc = fs.readFileSync(adapterPath, 'utf8');
  assert(adapterSrc.includes("command: 'playAudioFX'"), 'Adapter missing playAudioFX command');
  ['video: file', 'audio: file', 'image: file'].forEach(s => {
    if (adapterSrc.includes(s)) throw new Error(`Adapter appears to use legacy media key pattern: ${s}`);
  });
  // Quick heuristic: ensure no '{ command: \"playAudioFX\", audio:'
  if (/playAudioFX'?,\s*audio:/.test(adapterSrc)) throw new Error('Adapter still uses audio: key for playAudioFX');

  console.log('command-contract.test.js PASS');
}

main();