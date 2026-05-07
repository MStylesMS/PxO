const { parseCliArgs } = require('../src/game');

describe('game CLI parsing', () => {
  test('--validate aliases to the early-exit check path', () => {
    const argv = parseCliArgs(['--validate', '--edn', 'custom.edn']);

    expect(argv.validate).toBe(true);
    expect(argv.check).toBe(true);
    expect(argv.edn).toBe('custom.edn');
  });

  test('-c still enables the check path', () => {
    const argv = parseCliArgs(['-c']);

    expect(argv.check).toBe(true);
  });

  test('--game-log-path normalizes to game_log_path', () => {
    const argv = parseCliArgs(['--game-log-path', '/tmp/pxo-gameplay']);

    expect(argv.game_log_path).toBe('/tmp/pxo-gameplay');
  });
});