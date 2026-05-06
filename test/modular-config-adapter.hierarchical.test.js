const ModularConfigAdapter = require('../src/modular-config-adapter');

describe('ModularConfigAdapter hierarchical sequences', () => {
    function createConfig(overrides = {}) {
        const { global: globalOverrides = {}, ...restOverrides } = overrides;

        return {
            global: {
                mqtt: { 'game-topic': 'paradox/test', zones: {} },
                settings: {},
                sequences: {
                    system: {
                        'reset-sequence': {
                            description: 'System reset',
                            sequence: [{ zone: 'mirror', command: 'setImage', file: 'black.png' }]
                        }
                    },
                    'game-actions': {
                        'gameplay-start-sequence': {
                            description: 'Start gameplay',
                            sequence: [{ zone: 'picture', command: 'playVideo', file: 'intro.mp4' }]
                        }
                    }
                },
                ...globalOverrides,
                mqtt: {
                    'game-topic': 'paradox/test',
                    zones: {},
                    ...(globalOverrides.mqtt || {})
                }
            },
            'game-modes': {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo Game',
                    gameplay: {
                        duration: 300,
                        schedule: []
                    }
                }
            },
            ...restOverrides
        };
    }

    test('promotes legacy global.sequences into the runtime shape expected by PxO', () => {
        const runtimeConfig = ModularConfigAdapter.transform(createConfig());

        expect(runtimeConfig.global['system-sequences']).toEqual({
            system: {
                'reset-sequence': {
                    description: 'System reset',
                    sequence: [{ zone: 'mirror', command: 'setImage', file: 'black.png' }]
                }
            },
            'game-actions': {
                'gameplay-start-sequence': {
                    description: 'Start gameplay',
                    sequence: [{ zone: 'picture', command: 'playVideo', file: 'intro.mp4' }]
                }
            }
        });
        expect(runtimeConfig.global['command-sequences']).toEqual({
            'gameplay-start-sequence': {
                description: 'Start gameplay',
                sequence: [{ zone: 'picture', command: 'playVideo', file: 'intro.mp4' }]
            }
        });
        expect(runtimeConfig.global.actions).toBeUndefined();
        expect(runtimeConfig.game.demo.shortLabel).toBe('Demo');
        expect(runtimeConfig.game.demo.durations.game).toBeUndefined();
    });

    test('prefers explicit top-level system-sequences over legacy global.sequences', () => {
        const runtimeConfig = ModularConfigAdapter.transform(createConfig({
            global: {
                'system-sequences': {
                    system: {
                        'reset-sequence': {
                            description: 'Top-level reset',
                            sequence: [{ zone: 'mirror', command: 'setImage', file: 'top-level.png' }]
                        }
                    }
                }
            }
        }));

        expect(runtimeConfig.global['system-sequences']).toEqual({
            system: {
                'reset-sequence': {
                    description: 'Top-level reset',
                    sequence: [{ zone: 'mirror', command: 'setImage', file: 'top-level.png' }]
                }
            }
        });
    });

    test('exposes trigger source registries only through global.inputs', () => {
        const runtimeConfig = ModularConfigAdapter.transform(createConfig({
            global: {
                inputs: {
                    'front-door': {
                        topic: 'paradox/test/front-door/events',
                        producer: 'pfx'
                    }
                }
            }
        }));

        expect(runtimeConfig.global.inputs).toEqual({
            'front-door': {
                topic: 'paradox/test/front-door/events',
                producer: 'pfx'
            }
        });
        expect(runtimeConfig.global['trigger-sources']).toBeUndefined();
        expect(runtimeConfig.global.triggerSources).toBeUndefined();
    });
});