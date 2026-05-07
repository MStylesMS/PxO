const StateMachine = require('../src/stateMachine');

describe('System sequence command routing', () => {
  function createStateMachine() {
    const cfg = {
      global: {
        mqtt: { 'game-topic': 'game' },
        settings: {}
      },
      game: {}
    };

    const mqtt = {
      publish: () => { },
      subscribe: () => { },
      on: () => { }
    };

    const sm = new StateMachine({ cfg, mqtt });
    sm.sequenceRunner.runControlSequence = jest.fn(() => ({ ok: true }));
    return sm;
  }

  test('machineReboot command routes to machine-reboot-sequence', () => {
    const sm = createStateMachine();
    sm.handleCommand({ command: 'machineReboot' });

    const calls = sm.sequenceRunner.runControlSequence.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('machine-reboot-sequence');
  });

  test('restartAdapters command routes to restart-adapters sequence', () => {
    const sm = createStateMachine();
    sm.handleCommand({ command: 'restartAdapters' });

    const calls = sm.sequenceRunner.runControlSequence.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('restart-adapters');
  });

  test('restart-adapters alias is rejected by the state machine', async () => {
    const sm = createStateMachine();
    sm.publishWarning = jest.fn();

    const result = await sm.handleCommand({ command: 'restart-adapters' });

    expect(result).toBe(false);
    expect(sm.sequenceRunner.runControlSequence.mock.calls.length).toBe(0);
    expect(sm.publishWarning).toHaveBeenCalledWith('unknown_command', expect.objectContaining({ command: 'restart-adapters' }));
  });
});
