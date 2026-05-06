const ConfigValidator = require('../src/validators/configValidator');

describe('ConfigValidator sequence steps', () => {
    test('accepts payload-only sequence steps for mqtt-raw zones', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                mqtt: {
                    zones: {
                        'door-lock': { type: 'mqtt-raw', 'base-topic': 'paradox/houdini/door-lock' }
                    }
                },
                sequences: {
                    'demo-seq': [
                        { zone: 'door-lock', payload: '1' }
                    ]
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

    test('rejects hint, fire-cue, and fire-seq sequence step aliases', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {
                    'hint-01': { type: 'speech', file: 'hint-01.mp3', zone: 'tv' }
                },
                sequences: {
                    'demo-seq': [
                        { hint: 'hint-01' },
                        { 'fire-cue': 'demo-cue' },
                        { 'fire-seq': 'nested-seq' }
                    ],
                    'nested-seq': [
                        { wait: 1 }
                    ]
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
        expect(result.errors.join('\n')).toContain('uses unsupported hint key - use fire');
        expect(result.errors.join('\n')).toContain('uses unsupported fire-cue key - use fire');
        expect(result.errors.join('\n')).toContain('uses unsupported fire-seq key - use fire');
    });

    test('rejects payload-only sequence steps for non-mqtt-raw zones', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                mqtt: {
                    zones: {
                        'mirror': { type: 'pfx-media', 'base-topic': 'paradox/houdini/mirror' }
                    }
                },
                sequences: {
                    'demo-seq': [
                        { zone: 'mirror', payload: '1' }
                    ]
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
        expect(result.errors.join('\n')).toContain("must specify 'command'");
    });
});