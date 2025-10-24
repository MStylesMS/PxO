const ModularConfigAdapter = require('../src/modular-config-adapter');

describe('ModularConfigAdapter Hierarchical Sequences', () => {
    let adapter;
    let mockConfig;

    beforeEach(() => {
        mockConfig = {
            global: {
                sequences: {
                    system: {
                        'reset-sequence': {
                            description: 'System reset',
                            sequence: [
                                { deviceId: 'mirror', command: 'reset', duration: 1000 }
                            ]
                        },
                        'startup-sequence': {
                            description: 'System startup',
                            sequence: [
                                { deviceId: 'audio', command: 'start', duration: 2000 }
                            ]
                        }
                    },
                    'game-actions': {
                        'gameplay-start-sequence': {
                            description: 'Start gameplay',
                            sequence: [
                                { deviceId: 'picture', command: 'showIntro', duration: 3000 }
                            ]
                        },
                        'solved': {
                            description: 'Puzzle solved',
                            sequence: [
                                { deviceId: 'lights', command: 'celebrate', duration: 2500 }
                            ]
                        },
                        'failed': {
                            description: 'Game failed',
                            sequence: [
                                { deviceId: 'audio', command: 'playFailSound', duration: 1500 }
                            ]
                        }
                    },
                    'game-defaults': {
                        'default-hint-sequence': {
                            description: 'Default hint',
                            sequence: [
                                { deviceId: 'picture', command: 'showHint', duration: 2000 }
                            ]
                        }
                    }
                }
            },
            rooms: [
                {
                    id: 'houdinis-challenge',
                    name: 'Houdini\'s Challenge',
                    devices: {
                        mirror: { type: 'display' },
                        picture: { type: 'display' },
                        audio: { type: 'sound' },
                        lights: { type: 'lighting' }
                    }
                }
            ]
        };

        adapter = new ModularConfigAdapter(mockConfig);
    });

    describe('Hierarchical Sequence Transformation', () => {
        test('should transform hierarchical sequences to legacy system-sequences', () => {
            const legacyConfig = adapter.toLegacyConfig();

            expect(legacyConfig['system-sequences']).toBeDefined();
            expect(legacyConfig['system-sequences']['reset-sequence']).toBeDefined();
            expect(legacyConfig['system-sequences']['startup-sequence']).toBeDefined();
            expect(legacyConfig['system-sequences']['gameplay-start-sequence']).toBeDefined();
            expect(legacyConfig['system-sequences']['solved']).toBeDefined();
            expect(legacyConfig['system-sequences']['failed']).toBeDefined();
            expect(legacyConfig['system-sequences']['default-hint-sequence']).toBeDefined();
        });

        test('should preserve sequence structure and metadata in transformation', () => {
            const legacyConfig = adapter.toLegacyConfig();
            const resetSequence = legacyConfig['system-sequences']['reset-sequence'];

            expect(resetSequence.description).toBe('System reset');
            expect(resetSequence.sequence).toHaveLength(1);
            expect(resetSequence.sequence[0].deviceId).toBe('mirror');
            expect(resetSequence.sequence[0].command).toBe('reset');
            expect(resetSequence.sequence[0].duration).toBe(1000);
        });

        test('should include sequences from all hierarchical categories', () => {
            const legacyConfig = adapter.toLegacyConfig();
            const systemSequences = legacyConfig['system-sequences'];

            // System category
            expect(systemSequences['reset-sequence']).toBeDefined();
            expect(systemSequences['startup-sequence']).toBeDefined();

            // Game-actions category
            expect(systemSequences['gameplay-start-sequence']).toBeDefined();
            expect(systemSequences['solved']).toBeDefined();
            expect(systemSequences['failed']).toBeDefined();

            // Game-defaults category
            expect(systemSequences['default-hint-sequence']).toBeDefined();
        });

        test('should handle empty sequence categories', () => {
            mockConfig.global.sequences['empty-category'] = {};
            const legacyConfig = adapter.toLegacyConfig();

            expect(legacyConfig['system-sequences']).toBeDefined();
            // Should still have sequences from other categories
            expect(Object.keys(legacyConfig['system-sequences']).length).toBe(6);
        });

        test('should handle missing sequences configuration gracefully', () => {
            delete mockConfig.global.sequences;
            const legacyConfig = adapter.toLegacyConfig();

            expect(legacyConfig['system-sequences']).toBeDefined();
            expect(Object.keys(legacyConfig['system-sequences']).length).toBe(0);
        });
    });

    describe('Sequence Name Conflicts', () => {
        test('should handle sequence name conflicts between categories', () => {
            // Add conflicting sequence name in different categories
            mockConfig.global.sequences.system['test-sequence'] = {
                description: 'System test',
                sequence: [{ deviceId: 'mirror', command: 'systemTest', duration: 1000 }]
            };

            mockConfig.global.sequences['game-actions']['test-sequence'] = {
                description: 'Game test',
                sequence: [{ deviceId: 'picture', command: 'gameTest', duration: 2000 }]
            };

            const legacyConfig = adapter.toLegacyConfig();

            // Should have one version (likely the last one processed)
            expect(legacyConfig['system-sequences']['test-sequence']).toBeDefined();

            // Should not duplicate sequences
            const sequenceKeys = Object.keys(legacyConfig['system-sequences']);
            const testSequences = sequenceKeys.filter(key => key === 'test-sequence');
            expect(testSequences).toHaveLength(1);
        });
    });

    describe('Integration with Legacy Code', () => {
        test('should produce config compatible with SequenceRunner', () => {
            const legacyConfig = adapter.toLegacyConfig();

            // Test that legacy SequenceRunner can process the output
            expect(legacyConfig['system-sequences']).toBeDefined();
            expect(typeof legacyConfig['system-sequences']).toBe('object');

            // Verify structure matches what SequenceRunner expects
            const sequences = legacyConfig['system-sequences'];
            Object.keys(sequences).forEach(sequenceKey => {
                const sequence = sequences[sequenceKey];
                expect(sequence).toHaveProperty('description');
                expect(sequence).toHaveProperty('sequence');
                expect(Array.isArray(sequence.sequence)).toBe(true);
            });
        });

        test('should preserve room and device configuration', () => {
            const legacyConfig = adapter.toLegacyConfig();

            expect(legacyConfig.rooms).toBeDefined();
            expect(legacyConfig.rooms).toHaveLength(1);
            expect(legacyConfig.rooms[0].id).toBe('houdinis-challenge');
            expect(legacyConfig.rooms[0].devices).toBeDefined();
            expect(legacyConfig.rooms[0].devices.mirror.type).toBe('display');
        });
    });

    describe('Validation and Error Handling', () => {
        test('should handle malformed sequence definitions', () => {
            mockConfig.global.sequences.system['malformed-sequence'] = {
                description: 'Missing sequence array'
                // No sequence property
            };

            const legacyConfig = adapter.toLegacyConfig();

            // Should not crash, but malformed sequence might be excluded
            expect(legacyConfig['system-sequences']).toBeDefined();

            // If included, should have some default structure
            if (legacyConfig['system-sequences']['malformed-sequence']) {
                expect(legacyConfig['system-sequences']['malformed-sequence']).toHaveProperty('description');
            }
        });

        test('should handle null and undefined sequence values', () => {
            mockConfig.global.sequences.system['null-sequence'] = null;
            mockConfig.global.sequences.system['undefined-sequence'] = undefined;

            expect(() => {
                adapter.toLegacyConfig();
            }).not.toThrow();
        });
    });

    describe('Performance and Structure', () => {
        test('should efficiently process large hierarchical structures', () => {
            // Add many sequences across categories
            for (let i = 0; i < 50; i++) {
                mockConfig.global.sequences.system[`system-seq-${i}`] = {
                    description: `System sequence ${i}`,
                    sequence: [{ deviceId: 'mirror', command: `cmd${i}`, duration: 1000 }]
                };

                mockConfig.global.sequences['game-actions'][`game-seq-${i}`] = {
                    description: `Game sequence ${i}`,
                    sequence: [{ deviceId: 'picture', command: `gameCmd${i}`, duration: 1000 }]
                };
            }

            const start = Date.now();
            const legacyConfig = adapter.toLegacyConfig();
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(100); // Should be fast
            expect(Object.keys(legacyConfig['system-sequences']).length).toBeGreaterThan(100);
        });
    });
});