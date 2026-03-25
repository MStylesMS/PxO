const ConfigValidator = require('../src/validators/configValidator');

describe('ConfigValidator hint directives', () => {
    test('accepts :hint in sequences and :play-hint in schedules', () => {
        const config = {
            global: {
                hints: {
                    'hint-01': { type: 'speech', file: 'hint-01.mp3', zone: 'tv' }
                },
                sequences: {
                    'hint-seq': [
                        { hint: 'hint-01' },
                        { wait: 1 }
                    ]
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    hints: ['hint-01'],
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                { at: 30, 'play-hint': 'hint-01' }
                            ]
                        },
                        abort: {
                            sequence: 'demo-abort'
                        },
                        reset: {
                            sequence: 'demo-reset'
                        }
                    }
                }
            }
        };

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    test('validates sequence hints against command-sequences and warns on unused fields', () => {
        const config = {
            global: {
                hints: {
                    'hint-seq-01': {
                        type: 'sequence',
                        sequence: 'hint-text-seq',
                        text: 'Follow the signal chain',
                        duration: 15,
                        extra: 'unused'
                    }
                },
                'command-sequences': {
                    'hint-text-seq': {
                        sequence: [
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        abort: { sequence: 'demo-abort' },
                        reset: { sequence: 'demo-reset' }
                    }
                }
            }
        };

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings.some(w => w.includes('unused field(s): extra'))).toBe(true);
    });

    test('sequence hint requires sequence defined in command-sequences', () => {
        const config = {
            global: {
                hints: {
                    'hint-seq-02': {
                        type: 'sequence',
                        sequence: 'does-not-exist',
                        text: 'x'
                    }
                },
                'command-sequences': {
                    'hint-text-seq': { sequence: [] }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        abort: { sequence: 'demo-abort' },
                        reset: { sequence: 'demo-reset' }
                    }
                }
            }
        };

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('not defined in global.command-sequences'))).toBe(true);
    });

    test('does not fall back to system-sequences for sequence hints', () => {
        const config = {
            global: {
                hints: {
                    'hint-seq-03': {
                        type: 'sequence',
                        sequence: 'hint-text-seq',
                        text: 'x',
                        duration: 10
                    }
                },
                'system-sequences': {
                    'hint-text-seq': {
                        sequence: [
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        abort: { sequence: 'demo-abort' },
                        reset: { sequence: 'demo-reset' }
                    }
                }
            }
        };

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes('not defined in global.command-sequences'))).toBe(true);
    });

    test('text hint requires sequence in command-sequences', () => {
        const config = {
            global: {
                hints: {
                    'hint-text-01': {
                        type: 'text',
                        text: 'Operator editable text'
                    }
                },
                'command-sequences': {
                    'hint-text-seq': {
                        sequence: [
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        abort: { sequence: 'demo-abort' },
                        reset: { sequence: 'demo-reset' }
                    }
                }
            }
        };

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.includes("Text hint 'hint-text-01' must specify string 'sequence' field"))).toBe(true);
    });

    test('sequence hint accepts scalar parameters and warns on missing placeholders', () => {
        const config = {
            global: {
                hints: {
                    'hint-seq-04': {
                        type: 'sequence',
                        sequence: 'fx-seq',
                        parameters: {
                            light: 'red',
                            speed: 'fast',
                            option: 7
                        }
                    }
                },
                'command-sequences': {
                    'fx-seq': {
                        sequence: [
                            { zone: 'lights', command: 'scene', name: '{{light}}' },
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        abort: { sequence: 'demo-abort' },
                        reset: { sequence: 'demo-reset' }
                    }
                }
            }
        };

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.warnings.some(w => w.includes('missing field(s) required by template placeholders: text, duration'))).toBe(true);
    });
});
