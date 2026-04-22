const ConfigValidator = require('../src/validators/configValidator');

describe('ConfigValidator audio hint types', () => {
    test('rejects deprecated audio hint type with useful guidance', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {
                    badHint: { type: 'audio', file: 'boom.wav', zone: 'audio' }
                }
            },
            'game-modes': {}
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain("unsupported type 'audio'");
        expect(result.errors.join('\n')).toContain("Use 'audioFx'");
    });
});