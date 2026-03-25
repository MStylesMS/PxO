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

  test('restart-adapters alias routes to restart-adapters sequence', () => {
    const sm = createStateMachine();
    sm.handleCommand({ command: 'restart-adapters' });

    const calls = sm.sequenceRunner.runControlSequence.mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('restart-adapters');
  });
});
