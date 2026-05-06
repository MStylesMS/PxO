/* Integration test: load full EDN via adapter and verify template expansion */
const path = require('path');
const Adapter = require('../src/modular-config-adapter');

describe('modular config adapter integration', () => {
  test('loads the local EDN config and exposes the expected runtime shape', () => {
    const cfgPath = path.join(__dirname, '..', 'config', 'game.edn');
    const legacy = Adapter.loadConfig('edn', cfgPath);

    expect(Object.keys(legacy.game)).toEqual(expect.arrayContaining(['hc-60', 'hc-30', 'hc-demo']));
    expect(legacy.global.mqtt['game-topic']).toBe('paradox/houdini');

    const fullGame = legacy.game['hc-60'];
    expect(fullGame).toBeDefined();
    expect(Array.isArray(fullGame.schedule)).toBe(true);
    expect(fullGame.schedule.length).toBeGreaterThan(0);
    expect(fullGame.schedule).toEqual(expect.arrayContaining([
      expect.objectContaining({ at: 3600, fire: 'start-clock' }),
      expect.objectContaining({ at: 2700, fire: 'hint-mm-45' }),
      expect.objectContaining({ at: 300, fire: 'hint-mm-5' })
    ]));
    expect(fullGame.gameplay).toEqual(expect.objectContaining({ duration: 3600 }));
    expect(fullGame.intro).toEqual(expect.objectContaining({ duration: 147, sequence: 'standard-intro' }));
    expect(fullGame.reset).toEqual(expect.objectContaining({ sequence: 'standard-reset' }));
  });
});
