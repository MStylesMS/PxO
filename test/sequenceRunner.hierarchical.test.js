const SequenceRunner = require('../src/sequenceRunner');

describe('SequenceRunner Hierarchical Sequences', () => {
    let sequenceRunner;
    let mockDevice;
    let mockConfig;

    beforeEach(() => {
        mockDevice = {
            executeCommand: jest.fn().mockResolvedValue(true)
        };

        // Mock hierarchical config structure
        mockConfig = {
            sequences: {
                system: {
                    'reset-sequence': {
                        description: 'System reset sequence',
                        sequence: [
                            { deviceId: 'test', command: 'reset', duration: 1000 }
                        ]
                    },
                    'startup-sequence': {
                        description: 'System startup sequence',
                        sequence: [
                            { deviceId: 'test', command: 'start', duration: 2000 }
                        ]
                    }
                },
                'game-actions': {
                    'gameplay-start-sequence': {
                        description: 'Start gameplay sequence',
                        sequence: [
                            { deviceId: 'test', command: 'startGame', duration: 1500 }
                        ]
                    },
                    'solved': {
                        description: 'Puzzle solved sequence',
                        sequence: [
                            { deviceId: 'test', command: 'celebrate', duration: 3000 }
                        ]
                    },
                    'failed': {
                        description: 'Game failure sequence',
                        sequence: [
                            { deviceId: 'test', command: 'fail', duration: 2000 }
                        ]
                    }
                },
                'game-defaults': {
                    'default-hint-sequence': {
                        description: 'Default hint display',
                        sequence: [
                            { deviceId: 'test', command: 'showHint', duration: 1000 }
                        ]
                    }
                }
            }
        };

        sequenceRunner = new SequenceRunner(mockConfig);
        sequenceRunner.devices = { test: mockDevice };
    });

    describe('Legacy Name Mapping', () => {
        test('should map start-sequence to gameplay-start-sequence', () => {
            const mapped = sequenceRunner.mapLegacySequenceName('start-sequence');
            expect(mapped).toBe('gameplay-start-sequence');
        });

        test('should map solve-sequence to solved', () => {
            const mapped = sequenceRunner.mapLegacySequenceName('solve-sequence');
            expect(mapped).toBe('solved');
        });

        test('should map fail-sequence to failed', () => {
            const mapped = sequenceRunner.mapLegacySequenceName('fail-sequence');
            expect(mapped).toBe('failed');
        });

        test('should return original name if no mapping exists', () => {
            const mapped = sequenceRunner.mapLegacySequenceName('custom-sequence');
            expect(mapped).toBe('custom-sequence');
        });

        test('should handle null and undefined names', () => {
            expect(sequenceRunner.mapLegacySequenceName(null)).toBe(null);
            expect(sequenceRunner.mapLegacySequenceName(undefined)).toBe(undefined);
        });
    });

    describe('Hierarchical Sequence Resolution', () => {
        test('should find sequence in system category', () => {
            const sequence = sequenceRunner.resolveSequence('reset-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('System reset sequence');
            expect(sequence.sequence).toHaveLength(1);
            expect(sequence.sequence[0].command).toBe('reset');
        });

        test('should find sequence in game-actions category', () => {
            const sequence = sequenceRunner.resolveSequence('gameplay-start-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('Start gameplay sequence');
            expect(sequence.sequence[0].command).toBe('startGame');
        });

        test('should find sequence in game-defaults category', () => {
            const sequence = sequenceRunner.resolveSequence('default-hint-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('Default hint display');
            expect(sequence.sequence[0].command).toBe('showHint');
        });

        test('should find mapped legacy sequence names', () => {
            const sequence = sequenceRunner.resolveSequence('start-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('Start gameplay sequence');
            expect(sequence.sequence[0].command).toBe('startGame');
        });

        test('should find solve-sequence mapped to solved', () => {
            const sequence = sequenceRunner.resolveSequence('solve-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('Puzzle solved sequence');
            expect(sequence.sequence[0].command).toBe('celebrate');
        });

        test('should find fail-sequence mapped to failed', () => {
            const sequence = sequenceRunner.resolveSequence('fail-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('Game failure sequence');
            expect(sequence.sequence[0].command).toBe('fail');
        });

        test('should return null for non-existent sequences', () => {
            const sequence = sequenceRunner.resolveSequence('non-existent-sequence');
            expect(sequence).toBeNull();
        });

        test('should handle empty sequence categories', () => {
            mockConfig.sequences['empty-category'] = {};
            const sequence = sequenceRunner.resolveSequence('missing-sequence');
            expect(sequence).toBeNull();
        });
    });

    describe('Sequence Execution with Hierarchical Structure', () => {
        test('should execute system sequence successfully', async () => {
            const result = await sequenceRunner.runSequence('reset-sequence');
            expect(result.success).toBe(true);
            expect(mockDevice.executeCommand).toHaveBeenCalledWith('reset', 1000);
        });

        test('should execute game-action sequence successfully', async () => {
            const result = await sequenceRunner.runSequence('gameplay-start-sequence');
            expect(result.success).toBe(true);
            expect(mockDevice.executeCommand).toHaveBeenCalledWith('startGame', 1500);
        });

        test('should execute legacy sequence name through mapping', async () => {
            const result = await sequenceRunner.runSequence('start-sequence');
            expect(result.success).toBe(true);
            expect(mockDevice.executeCommand).toHaveBeenCalledWith('startGame', 1500);
        });

        test('should handle sequence not found error', async () => {
            const result = await sequenceRunner.runSequence('missing-sequence');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Sequence not found: missing-sequence');
        });
    });

    describe('Config Validation with Hierarchical Structure', () => {
        test('should validate sequences in all categories', () => {
            const validation = sequenceRunner.validateSequences();
            expect(validation.isValid).toBe(true);
            expect(validation.sequences).toEqual([
                'reset-sequence',
                'startup-sequence',
                'gameplay-start-sequence',
                'solved',
                'failed',
                'default-hint-sequence'
            ]);
        });

        test('should detect invalid sequence structure', () => {
            mockConfig.sequences.system['invalid-sequence'] = {
                description: 'Invalid sequence',
                sequence: 'not-an-array'  // Invalid: should be array
            };

            const validation = sequenceRunner.validateSequences();
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Sequence "invalid-sequence" must have a "sequence" array');
        });

        test('should handle missing sequence categories gracefully', () => {
            delete mockConfig.sequences;
            const validation = sequenceRunner.validateSequences();
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('No sequences configuration found');
        });
    });

    describe('Backward Compatibility', () => {
        test('should work with old flat system-sequences structure', () => {
            // Test fallback to old structure
            const oldConfig = {
                'system-sequences': {
                    'old-sequence': {
                        description: 'Old format sequence',
                        sequence: [
                            { deviceId: 'test', command: 'oldCommand', duration: 1000 }
                        ]
                    }
                }
            };

            const oldRunner = new SequenceRunner(oldConfig);
            oldRunner.devices = { test: mockDevice };

            const sequence = oldRunner.resolveSequence('old-sequence');
            expect(sequence).toBeDefined();
            expect(sequence.description).toBe('Old format sequence');
        });

        test('should prioritize new hierarchical structure over old flat structure', () => {
            // Config with both old and new structures
            const mixedConfig = {
                sequences: {
                    system: {
                        'test-sequence': {
                            description: 'New hierarchical sequence',
                            sequence: [{ deviceId: 'test', command: 'newCommand', duration: 1000 }]
                        }
                    }
                },
                'system-sequences': {
                    'test-sequence': {
                        description: 'Old flat sequence',
                        sequence: [{ deviceId: 'test', command: 'oldCommand', duration: 1000 }]
                    }
                }
            };

            const mixedRunner = new SequenceRunner(mixedConfig);
            const sequence = mixedRunner.resolveSequence('test-sequence');
            expect(sequence.description).toBe('New hierarchical sequence');
            expect(sequence.sequence[0].command).toBe('newCommand');
        });
    });
});