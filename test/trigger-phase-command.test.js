const StateMachine = require('../src/stateMachine');

describe('triggerPhase command routing', () => {
    function createStateMachine(options = {}) {
        const mockTransition = options.mockTransition !== false;
        const cfg = {
            global: {
                mqtt: { 'game-topic': 'paradox/test' },
                settings: {},
                sequences: {
                    'noop-sequence': { sequence: [] }
                },
                'additional-phases': {
                    'operator-hold': {
                        'phase-type': 'failed',
                        duration: 0,
                        sequence: 'noop-sequence'
                    }
                }
            },
            game: {
                demo: {
                    'short-label': 'Demo',
                    'game-label': 'Demo',
                    'additional-phases': ['operator-hold'],
                    phases: {
                        intro: { duration: 10, sequence: 'noop-sequence' },
                        gameplay: { duration: 60, sequence: 'noop-sequence' },
                        solved: { duration: 10, sequence: 'noop-sequence' },
                        failed: { duration: 10, sequence: 'noop-sequence' },
                        abort: { duration: 0, sequence: 'noop-sequence' },
                        reset: { duration: 0, sequence: 'noop-sequence' }
                    }
                }
            }
        };

        const mqtt = {
            publish: jest.fn(),
            subscribe: () => { },
            on: () => { }
        };

        const sm = new StateMachine({ cfg, mqtt });
        sm.currentGameMode = 'demo';
        sm.gameType = 'demo';
        sm.loadPhases('demo');
        sm.publishWarning = jest.fn();
        if (mockTransition) {
            sm.transitionToPhase = jest.fn(() => Promise.resolve(true));
        } else {
            sm.startUnifiedTimer = jest.fn();
            sm.stopUnifiedTimer = jest.fn();
            sm.clearAllPhaseSchedules = jest.fn();
        }
        return sm;
    }

    test('triggerPhase transitions to allowlisted additional phase operator-hold', () => {
        const sm = createStateMachine();

        expect(!!sm.phases['operator-hold']).toBe(true);
        sm.handleCommand({ command: 'triggerPhase', phase: 'operator-hold' });

        expect(sm.transitionToPhase).toHaveBeenCalledWith('operator-hold');
        expect(sm.publishWarning.mock.calls.length).toBe(0);
    });

    test('triggerPhase warns when phase does not exist', () => {
        const sm = createStateMachine();

        sm.handleCommand({ command: 'triggerPhase', phase: 'not-a-real-phase' });

        expect(sm.transitionToPhase.mock.calls.length).toBe(0);
        expect(sm.publishWarning.mock.calls.length).toBe(1);
        expect(sm.publishWarning.mock.calls[0][0]).toBe('trigger_phase_unknown');
        expect(sm.publishWarning.mock.calls[0][1].phase).toBe('not-a-real-phase');
    });

    test('triggerPhase warns when phase parameter is missing', () => {
        const sm = createStateMachine();

        sm.handleCommand({ command: 'triggerPhase' });

        expect(sm.transitionToPhase.mock.calls.length).toBe(0);
        expect(sm.publishWarning.mock.calls.length).toBe(1);
        expect(sm.publishWarning.mock.calls[0][0]).toBe('trigger_phase_missing_name');
    });

    test('operator-hold transition publishes closing metadata in state payload', () => {
        const sm = createStateMachine({ mockTransition: false });

        expect(!!sm.phases['operator-hold']).toBe(true);
        sm.transitionToPhase('operator-hold');

        const stateCalls = sm.mqtt.publish.mock.calls.filter((call) => call[0] === 'paradox/test/state');
        expect(stateCalls.length > 0).toBe(true);

        const payload = stateCalls[stateCalls.length - 1][1];
        expect(payload.gameState).toBe('operator-hold');
        expect(payload.phaseType).toBe('failed');
        expect(payload.isClosingPhase).toBe(true);
        expect(payload.operatorControl && payload.operatorControl.command).toBe('reset');
    });
});
