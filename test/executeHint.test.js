const StateMachine = require('../src/stateMachine');

describe('fireHint behavior', () => {
    test('publishes warning when hint id is not found', async () => {
        const cfg = { global: { mqtt: { 'game-topic': 'paradox/houdini' } } };
        const mqtt = { publish: jest.fn() };
        const sm = new StateMachine({ cfg, mqtt });

        const ok = await sm.fireHint('t1', 'test');
        expect(ok).toBe(false);
        expect(mqtt.publish).toHaveBeenCalledWith(
            'paradox/houdini/warnings',
            expect.objectContaining({ warning: 'hint_not_found' })
        );
    });

    test('executes sequence-type hint via sequence runner and passes hint fields as context', async () => {
        const cfg = {
            global: {
                mqtt: { 'game-topic': 'paradox/houdini' },
                'command-sequences': {
                    'hint-text-seq': {
                        sequence: [
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            }
        };
        const mqtt = { publish: jest.fn() };
        const sm = new StateMachine({ cfg, mqtt });
        sm.sequenceRunner.runSequence = jest.fn().mockResolvedValue({ ok: true });

        const ok = await sm.executeSequenceHint({
            id: 'hint-03',
            type: 'sequence',
            sequence: 'hint-text-seq',
            text: 'Follow the signal chain',
            duration: 15,
            extra: 'unused'
        }, 'test');

        expect(ok).toBe(true);
        expect(sm.sequenceRunner.runSequence).toHaveBeenCalledWith(
            'hint-text-seq',
            expect.objectContaining({ text: 'Follow the signal chain', duration: 15 })
        );
        expect(mqtt.publish).toHaveBeenCalledWith(
            'paradox/houdini/warnings',
            expect.objectContaining({ warning: 'hint_sequence_unused_fields' })
        );
    });

    test('does not fall back to system-sequences for sequence hints at runtime', async () => {
        const cfg = {
            global: {
                mqtt: { 'game-topic': 'paradox/houdini' },
                'system-sequences': {
                    'hint-text-seq': {
                        sequence: [
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            }
        };
        const mqtt = { publish: jest.fn() };
        const sm = new StateMachine({ cfg, mqtt });

        const ok = await sm.executeSequenceHint({
            id: 'hint-03',
            type: 'sequence',
            sequence: 'hint-text-seq',
            text: 'Follow the signal chain',
            duration: 15
        }, 'test');

        expect(ok).toBe(false);
        expect(mqtt.publish).toHaveBeenCalledWith(
            'paradox/houdini/warnings',
            expect.objectContaining({ warning: 'hint_sequence_not_found' })
        );
    });

    test('text hint executes configured sequence with fixed duration', async () => {
        const cfg = {
            global: {
                mqtt: { 'game-topic': 'paradox/houdini' },
                'command-sequences': {
                    'hint-text-seq': {
                        sequence: [
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            }
        };
        const mqtt = { publish: jest.fn() };
        const sm = new StateMachine({ cfg, mqtt });
        sm.sequenceRunner.runSequence = jest.fn().mockResolvedValue({ ok: true });

        const ok = await sm.executeTextHint({
            id: 'hint-04',
            type: 'text',
            sequence: 'hint-text-seq',
            text: 'Custom operator text',
            duration: 15
        }, 'test');

        expect(ok).toBe(true);
        expect(sm.sequenceRunner.runSequence).toHaveBeenCalledWith(
            'hint-text-seq',
            expect.objectContaining({ text: 'Custom operator text', duration: 15 })
        );
    });

    test('sequence hint uses parameters and warns for missing placeholders only', async () => {
        const cfg = {
            global: {
                mqtt: { 'game-topic': 'paradox/houdini' },
                'command-sequences': {
                    'fx-seq': {
                        sequence: [
                            { zone: 'lights', command: 'scene', name: '{{light}}' },
                            { zone: 'clock', command: 'hint', text: '{{text}}', duration: '{{duration}}' }
                        ]
                    }
                }
            }
        };
        const mqtt = { publish: jest.fn() };
        const sm = new StateMachine({ cfg, mqtt });
        sm.sequenceRunner.runSequence = jest.fn().mockResolvedValue({ ok: true });

        const ok = await sm.executeSequenceHint({
            id: 'hint-seq-05',
            type: 'sequence',
            sequence: 'fx-seq',
            parameters: { light: 'red', speed: 'fast', option: 7 }
        }, 'test');

        expect(ok).toBe(true);
        expect(sm.sequenceRunner.runSequence).toHaveBeenCalledWith(
            'fx-seq',
            expect.objectContaining({ light: 'red', speed: 'fast', option: 7, text: '', duration: '' })
        );
        expect(mqtt.publish).toHaveBeenCalledWith(
            'paradox/houdini/warnings',
            expect.objectContaining({ warning: 'hint_sequence_missing_fields' })
        );
    });
});
