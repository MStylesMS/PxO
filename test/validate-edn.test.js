const path = require('path');

const { validateEdnFile } = require('../tools/validate-edn');

describe('validateEdnFile', () => {
  test('accepts the runtime zone adapter types used by the shipped EDN config', () => {
    const configPath = path.join(__dirname, '..', 'config', 'game.edn');

    expect(validateEdnFile(configPath)).toBe(true);
  });
});