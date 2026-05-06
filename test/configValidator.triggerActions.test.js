const ConfigValidator = require('../src/validators/configValidator');

describe('ConfigValidator trigger actions', () => {
    test('accepts fire, end, and raw MQTT trigger actions', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {},
                triggers: {
                    'spell-box-opened': {
                        source: 'spell-box',
                        condition: { event: 'opened' },
                        'when-phase': ['gameplay', 'paused'],
                        actions: [
                            { fire: 'unlock-door', text: 'Open sesame' },
                            { end: 'sovled' },
                            { command: 'publish', topic: 'paradox/test', payload: { ok: true } }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            sequence: 'demo-seq'
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
        });

        expect(result.isValid).toBe(true);
    });

    test('rejects legacy type-based trigger actions', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {},
                triggers: {
                    'legacy-trigger': {
                        source: 'spell-box',
                        condition: { event: 'opened' },
                        actions: [
                            { type: 'game', command: 'solve' }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            sequence: 'demo-seq'
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain("unsupported legacy 'type' syntax");
    });

    test('rejects direct schedule execution in trigger actions', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {},
                triggers: {
                    'bad-trigger': {
                        source: 'spell-box',
                        condition: { event: 'opened' },
                        actions: [
                            { schedule: 'countdown-warning' }
                        ]
                    }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            sequence: 'demo-seq'
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain('cannot execute schedules directly - schedules are phase-only');
    });
});