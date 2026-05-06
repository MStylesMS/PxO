const SequenceRunner = require('../src/sequenceRunner');

describe('SequenceRunner hierarchical sequences', () => {
    let zones;
    let runner;

    beforeEach(() => {
        zones = {
            execute: jest.fn().mockResolvedValue(true)
        };

        runner = new SequenceRunner({
            cfg: {
                global: {
                    mqtt: { 'game-topic': 'paradox/test' },
                    'system-sequences': {
                        system: {
                            'reset-sequence': {
                                description: 'System reset sequence',
                                sequence: [{ zone: 'mirror', command: 'setImage', file: 'black.png' }]
                            }
                        },
                        'game-actions': {
                            solved: {
                                description: 'Solved sequence',
                                sequence: [{ zone: 'lights', command: 'allOn' }]
                            }
                        }
                    },
                    'command-sequences': {
                        'gameplay-start-sequence': {
                            description: 'Gameplay start sequence',
                            sequence: [{ zone: 'mirror', command: 'playVideo', file: 'intro.mp4' }]
                        }
                    },
                    sequences: {
                        'game-actions': {
                            'legacy-custom-sequence': {
                                description: 'Legacy custom fallback',
                                sequence: [{ zone: 'mirror', command: 'setImage', file: 'legacy.png' }]
                            }
                        }
                    }
                }
            },
            zones,
            mqtt: { publish: jest.fn() }
        });
    });

    test('resolves canonical hierarchical and legacy-location fallback sequences through both lookup paths', () => {
        expect(runner.resolveSequence('reset-sequence')).toEqual(
            expect.objectContaining({ description: 'System reset sequence' })
        );
        expect(runner.resolveSequence('gameplay-start-sequence')).toEqual(
            expect.objectContaining({ description: 'Gameplay start sequence' })
        );
        expect(runner.resolveSequence('solved')).toEqual(
            expect.objectContaining({ description: 'Solved sequence' })
        );
        expect(runner.resolveSequence('solve-sequence')).toBeUndefined();
        expect(runner.resolveSequence('start-sequence')).toBeUndefined();

        expect(runner.resolveSequenceNew('gameplay-start-sequence')).toEqual([
            { zone: 'mirror', command: 'playVideo', file: 'intro.mp4' }
        ]);
        expect(runner.resolveSequenceNew('start-sequence')).toBeUndefined();
        expect(runner.resolveSequenceNew('legacy-custom')).toEqual([
            { zone: 'mirror', command: 'setImage', file: 'legacy.png' }
        ]);
    });

    test('returns undefined or sequence_not_found for missing sequences in current APIs', async () => {
        expect(runner.resolveSequence('missing-sequence')).toBeUndefined();
        expect(runner.resolveSequenceNew('missing-sequence')).toBeUndefined();
        await expect(runner.runSequence('missing-sequence')).resolves.toEqual({
            ok: false,
            error: 'sequence_not_found'
        });
    });

    test('executes hierarchical sequences through the adapter registry', async () => {
        const result = await runner.runSequence('reset-sequence');

        expect(result).toEqual({ ok: true });
        expect(zones.execute).toHaveBeenCalledWith('mirror', 'setImage', { file: 'black.png' });
    });

    test('validates current sequence definitions', () => {
        expect(
            runner.validateSequenceDefinition('valid-sequence', {
                sequence: [{ zone: 'mirror', command: 'setImage', file: 'black.png' }]
            })
        ).toEqual({ warnings: [], errors: [] });

        expect(
            runner.validateSequenceDefinition('invalid-sequence', {
                sequence: 'not-an-array'
            })
        ).toEqual({
            warnings: [],
            errors: ["Sequence invalid-sequence: missing or invalid 'sequence' array"]
        });
    });
});