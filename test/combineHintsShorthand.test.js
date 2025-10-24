const { getCombinedHints } = require('../src/hints');

describe('getCombinedHints shorthand parsing', () => {
    test('parses playVideo and playSpeech shorthand and respects game-mode-first ordering', () => {
        const cfg = {
            global: {
                media: {
                    hints: {
                        'g1': { type: 'speech', file: 'global_speech.wav', target: 'audio', description: 'Global speak' }
                    }
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
});
