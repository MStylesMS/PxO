const { getCombinedHints } = require('../src/hints');

describe('getCombinedHints shorthand parsing', () => {
    test('parses playVideo and playSpeech shorthand and respects game-mode-first ordering', () => {
        const cfg = {
            global: {
                hints: {
                    'g1': { type: 'speech', file: 'global_speech.wav', target: 'audio', description: 'Global speak' }
                }
            }
        };
        const gameHints = ['playVideo:hint1.mp4', 'playSpeech:hint2.wav', 'A plain hint'];

        const out = getCombinedHints(cfg, gameHints);
        // Expect first two entries to reflect shorthand normalization
        expect(out[0].type).toBe('video');
        expect(out[0].displayText).toContain('hint1.mp4');
        expect(out[1].type).toBe('speech');
        expect(out[1].displayText).toContain('hint2.wav');
        // game hints first, then global
        const globalIdx = out.findIndex(h => h.id === 'g1');
        expect(globalIdx).toBeGreaterThan(1);
        // dedupe should not trigger for distinct texts
        const texts = out.map(e => e.displayText);
        expect(texts.length).toBe(new Set(texts).size);
    });

    test('parses playAudioFX shorthand as audioFx', () => {
        const cfg = { global: { hints: {} } };
        const out = getCombinedHints(cfg, ['playAudioFX:bell.wav']);

        expect(out[0].type).toBe('audioFx');
        expect(out[0].displayText).toContain('bell.wav');
        expect(out[0].data.type).toBe('audioFx');
    });

    test('parses playBackground and setImage shorthand using canonical media types', () => {
        const cfg = { global: { hints: {} } };
        const out = getCombinedHints(cfg, ['playBackground:ambient.mp3', 'setImage:poster.png']);

        expect(out[0].type).toBe('background');
        expect(out[0].data.type).toBe('background');
        expect(out[1].type).toBe('image');
        expect(out[1].data.type).toBe('image');
    });
});
