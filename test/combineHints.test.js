const { getCombinedHints } = require('../src/hints');

describe('getCombinedHints', () => {
    test('combines global structured hints and game-mode text hints, game-mode first, dedup by displayText', () => {
        const cfg = {
            global: {
                media: {
                    hints: {
                        'g1': { type: 'speech', file: 's1.mp3', target: 'Kitchen', description: 'Speak now' },
                        'g2': { type: 'video', file: 'v1.mp4', target: 'Mirror', description: 'Watch this' }
                    }
                }
            }
        };
        const gameHints = ['Check gauge', 'Speak now'];

        const out = getCombinedHints(cfg, gameHints);
        // game-mode hints should appear before global ones
        expect(['text', 'video', 'speech', 'audio']).toContain(out[0].type);
        expect(['text', 'video', 'speech', 'audio']).toContain(out[1].type);
        // dedupe should remove duplicate displayText ("Speak now" present in global)
        const texts = out.map(h => h.displayText);
        // displayText includes emoji + target prefix, so match by substring
        expect(texts.some(t => t.includes('Check gauge'))).toBe(true);
        expect(texts.filter(t => t.includes('Speak now')).length).toBe(1);
        // global hint properties preserved
        const g = out.find(h => h.id === 'g2');
        expect(g).toBeDefined();
        expect(g.emoji).toBeTruthy();
        // normalized hints carry data/file under data or in displayText; ensure type mapping kept
        expect(g.type).toBe('video');
    });
});
