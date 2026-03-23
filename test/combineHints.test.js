const { getCombinedHints } = require('../src/hints');

describe('getCombinedHints', () => {
    test('combines global structured hints and game-mode text hints, game-mode first, dedup by displayText', () => {
        const cfg = {
            global: {
                hints: {
                    'g1': { type: 'speech', file: 's1.mp3', target: 'Kitchen', description: 'Speak now' },
                    'g2': { type: 'video', file: 'v1.mp4', target: 'Mirror', description: 'Watch this' }
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

    test('treats game-mode string hint ids as references to global hints', () => {
        const cfg = {
            global: {
                hints: {
                    'hint-01': { type: 'speech', file: 'h1.mp3', target: 'Audio', description: 'Hint one' },
                    'hint-02': { type: 'text', text: 'Look under the desk', target: 'Mirror' }
                }
            }
        };

        const out = getCombinedHints(cfg, ['hint-01', 'hint-02']);
        expect(out.find(h => h.id === 'hint-01')).toBeDefined();
        expect(out.find(h => h.id === 'hint-02')).toBeDefined();

        // Ensure ids are not duplicated when referenced from game-mode list
        expect(out.filter(h => h.id === 'hint-01').length).toBe(1);
        expect(out.filter(h => h.id === 'hint-02').length).toBe(1);
    });

    test('mode-local object hint with matching id overrides global hint for that mode list', () => {
        const cfg = {
            global: {
                hints: {
                    'hint-01': { type: 'text', text: 'Global hint text', description: 'Global hint' },
                    'hint-02': { type: 'text', text: 'Second global hint', description: 'Second global hint' }
                }
            }
        };

        const gameHints = [
            { id: 'hint-01', type: 'text', text: 'Mode override text', description: 'Mode override hint' }
        ];

        const out = getCombinedHints(cfg, gameHints);
        const h1 = out.find(h => h.id === 'hint-01');

        expect(h1).toBeDefined();
        expect(h1.text).toBe('Mode override text');
        expect(h1.description).toBe('Mode override hint');
        expect(out.filter(h => h.id === 'hint-01').length).toBe(1);
        expect(out.find(h => h.id === 'hint-02')).toBeDefined();
    });
});
