/* Contract checks (node - no framework) */
const fs = require('fs');
const path = require('path');

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function grepFile(p, re) {
  return re.test(fs.readFileSync(p, 'utf8'));
}

describe('command contract', () => {
  test('keeps canonical audio command and media key usage', () => {
    const root = path.resolve(__dirname, '..');
    const ednPath = path.join(root, 'config', 'game.edn');
    const ednText = fs.readFileSync(ednPath, 'utf8');

    if (ednText.includes('playAudioFx:')) {
      throw new Error('EDN config contains lowercase playAudioFx variant');
    }

    if (/\:command\s+"play"\b/.test(ednText)) {
      throw new Error('EDN config contains legacy command "play"; use playAudioFX, playBackground, playSpeech, or playVideo');
    }

    const adapterPath = path.join(root, 'src', 'adapters', 'pfx.js');
    const adapterSrc = fs.readFileSync(adapterPath, 'utf8');
    assert(adapterSrc.includes("command: 'playAudioFX'"), 'Adapter missing playAudioFX command');

    ['video: file', 'audio: file', 'image: file'].forEach(s => {
      if (adapterSrc.includes(s)) {
        throw new Error(`Adapter appears to use legacy media key pattern: ${s}`);
      }
    });

    if (/playAudioFX'?,\s*audio:/.test(adapterSrc)) {
      throw new Error('Adapter still uses audio: key for playAudioFX');
    }
  });
});