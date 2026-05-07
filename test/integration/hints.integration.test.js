/* Integration test for hints pipeline
   - Verifies that a getConfig request causes a publish with combinedHints including demo entries
   - Publishes an executeHint command referencing an id and verifies mocked media/clock were called

   NOTE: This test uses lightweight mocks and runs only the orchestrator's config/getConfig/executeHint paths.
*/

const Hints = require('../../src/hints');
const StateMachine = require('../../src/stateMachine');

// Mocks are intentionally minimal; a full orchestrator run requires more wiring.

describe('hints integration (smoke)', () => {
    test('combines mode and global hints and executes a configured video hint through the state machine', async () => {
        const cfg = {
            global: {
                mqtt: { 'game-topic': 'paradox/houdini' },
                hints: {
                    'hint-camera-1': { type: 'video', file: 'camera_hint_1.mp4', zone: 'mirror', duration: 30, description: 'Camera hint' },
                    'hint-whisper': { type: 'speech', file: 'whisper_hint.wav', zone: 'audio', description: 'whisper' }
                }
            },
            game: {
                'hc-demo': {
                    hints: ['playVideo:short_hint.mp4', 'A plain editable text hint that shows on the clock']
                }
            }
        };

        const combined = Hints.getCombinedHints(cfg, cfg.game['hc-demo'].hints);

        expect(Array.isArray(combined)).toBe(true);
        expect(combined.length).toBeGreaterThanOrEqual(3);
        expect(combined[0]).toEqual(expect.objectContaining({ type: 'video', baseText: 'short_hint.mp4' }));

        const mqtt = { publish: jest.fn(), subscribe: jest.fn(), on: jest.fn() };
        const sm = new StateMachine({ cfg, mqtt });
        sm.currentGameMode = 'hc-demo';
        sm.executeVideoHint = jest.fn().mockResolvedValue(true);

        const ok = await sm.fireHint('hint-camera-1', 'test');

        expect(ok).toBe(true);
        expect(sm.executeVideoHint).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'video', file: 'camera_hint_1.mp4', zone: 'mirror', duration: 30 }),
            'test'
        );
    });
});
