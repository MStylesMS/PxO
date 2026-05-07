const ConfigValidator = require('../src/validators/configValidator');

describe('ConfigValidator schedule entries', () => {
    test('rejects legacy commands arrays in schedule entries', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {}
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                {
                                    at: 30,
                                    commands: [
                                        { zone: 'picture', command: 'setImage', file: 'warning.png' }
                                    ]
                                }
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain('uses unsupported :commands array');
    });

    test('rejects camelCase playHint in schedule entries', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {
                    'hint-01': { type: 'speech', file: 'hint-01.mp3', zone: 'tv' }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                { at: 30, playHint: 'hint-01' }
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain('uses unsupported playHint key - use fire');
    });

    test('rejects fire-cue in schedule entries', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {}
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                { at: 30, 'fire-cue': 'demo-cue' }
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain("Use 'fire' instead of 'fire-cue'");
    });

    test('rejects fire-seq in schedule entries', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {}
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                { at: 30, 'fire-seq': 'demo-sequence' }
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain("Use 'fire' instead of 'fire-seq'");
    });

    test('rejects hint and play-hint in schedule entries', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {
                    'hint-01': { type: 'speech', file: 'hint-01.mp3', zone: 'tv' }
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                { at: 30, hint: 'hint-01' },
                                { at: 20, 'play-hint': 'hint-01' }
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain('uses unsupported hint key - use fire');
        expect(result.errors.join('\n')).toContain('uses unsupported play-hint key - use fire');
    });

    test('rejects nested schedules in schedule entries', () => {
        const validator = new ConfigValidator();
        const result = validator.validate({
            global: {
                hints: {}
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Mode',
                    phases: {
                        gameplay: {
                            duration: 60,
                            schedule: [
                                { at: 30, schedule: 'nested-warning' }
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
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.join('\n')).toContain('cannot execute nested schedules - schedules are phase-only');
    });
});