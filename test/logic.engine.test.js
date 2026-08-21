'use strict';

const { LogicEngine } = require('../src/logic/engine');

describe('logic engine', () => {
  const inputSources = {
    'gpio-events': {
      topic: 'paradox/room/gpio/events',
      'signal-key': 'pin',
      'value-key': 'value',
      'active-low': true
    }
  };

  function makeEngine(logic, onAction) {
    const actions = [];
    const engine = new LogicEngine({
      logicConfig: logic,
      inputSources,
      onAction: async (action, meta) => {
        actions.push({ action, meta });
        if (onAction) await onAction(action, meta);
      }
    });
    return { engine, actions };
  }

  test('match node goes true when the logical pattern is met and fires on-true', async () => {
    const { engine, actions } = makeEngine({
      breaker: {
        type: 'match',
        inputs: ['gpio-events/F1', 'gpio-events/F2'],
        target: { F1: 1, F2: 0 },
        latch: true,
        'on-true': [{ fire: 'seq-breaker-solved' }]
      }
    });

    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F1', value: '0' });
    expect(engine.getSnapshot().breaker.output).toBe(false);
    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F2', value: '1' });
    expect(engine.getSnapshot().breaker.output).toBe(true);
    expect(actions.some((a) => a.action.fire === 'seq-breaker-solved')).toBe(true);

    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F1', value: '1' });
    expect(engine.getSnapshot().breaker.output).toBe(true);
  });

  test('sequence match-last keypad plus scale on-change interpolates bars', async () => {
    const { engine, actions } = makeEngine({
      keypad: {
        type: 'sequence',
        input: { source: 'gpio-events', signal: 'Keypad', 'value-key': 'key', when: { value: '0' }, 'active-low': false },
        target: ['1', '3', '5', '7', 'pound'],
        'match-last': true,
        latch: true,
        'on-true': [{ end: 'win' }]
      },
      count: { type: 'count-true', inputs: ['keypad'] },
      bars: {
        type: 'scale',
        input: 'count',
        'in-max': 1,
        'out-max': 8,
        'on-change': [{ zone: 'wallclock', command: 'announce', bars: '{{value}}' }]
      }
    });

    for (const key of ['1', '3', '5', '7', 'pound']) {
      await engine.handleMessage('paradox/room/gpio/events', { pin: 'Keypad', key, value: '0' });
    }
    expect(engine.getSnapshot().keypad.output).toBe(true);
    expect(actions.some((a) => a.action.end === 'win')).toBe(true);
    const announces = actions.filter((a) => a.action.command === 'announce');
    expect(announces[announces.length - 1].action.bars).toBe(8);
  });

  test('reset clears latch; forceSolve sets a node true', async () => {
    const { engine } = makeEngine({
      breaker: {
        type: 'match',
        inputs: ['gpio-events/F1'],
        target: { F1: 1 },
        latch: true
      }
    });
    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F1', value: '0' });
    expect(engine.getSnapshot().breaker.output).toBe(true);
    engine.reset();
    expect(engine.getSnapshot().breaker.output).toBe(false);
    await engine.forceSolve('breaker');
    expect(engine.getSnapshot().breaker.output).toBe(true);
  });

  test('passthrough latches an event pulse via :const', async () => {
    const inputSources2 = {
      'terminal-events': { topic: 'paradox/room/terminal/events', 'value-key': 'event' }
    };
    const engine = new LogicEngine({
      logicConfig: {
        terminal: {
          type: 'passthrough',
          input: {
            source: 'terminal-events',
            when: { event: 'passwordAttempt', which: 'main', success: true },
            const: true
          },
          latch: true
        }
      },
      inputSources: inputSources2
    });
    await engine.handleMessage('paradox/room/terminal/events', {
      event: 'passwordAttempt', which: 'main', success: true
    });
    expect(engine.getSnapshot().terminal.output).toBe(true);
    await engine.handleMessage('paradox/room/terminal/events', {
      event: 'stateChange', to: 'loggedin'
    });
    expect(engine.getSnapshot().terminal.output).toBe(true);
  });

  test('disable ignores hardware; bypass fires on-true and counts toward count-true', async () => {
    const { engine, actions } = makeEngine({
      keypad: {
        type: 'passthrough',
        input: 'gpio-events/F1',
        latch: true,
        'on-true': [{ fire: 'seq-k' }]
      },
      count: { type: 'count-true', inputs: ['keypad'] }
    });

    await engine.forceDisable('keypad');
    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F1', value: '0' });
    expect(engine.getSnapshot().keypad.output).toBe(false);
    expect(engine.getSnapshot().keypad.enabled).toBe(false);

    await engine.forceBypass('keypad');
    expect(engine.getSnapshot().keypad.output).toBe(true);
    expect(engine.getSnapshot().keypad.bypassed).toBe(true);
    expect(engine.getSnapshot().count.output).toBe(1);
    expect(actions.some((a) => a.action.fire === 'seq-k')).toBe(true);

    await engine.forceReset('keypad');
    expect(engine.getSnapshot().keypad.bypassed).toBe(false);
    expect(engine.getSnapshot().keypad.output).toBe(false);
  });

  test('enable-after delay then accepts hardware', async () => {
    let now = 1000;
    const engine = new LogicEngine({
      now: () => now,
      logicConfig: {
        breaker: {
          type: 'passthrough',
          input: 'gpio-events/F2'
        },
        keypad: {
          type: 'passthrough',
          input: 'gpio-events/F1',
          'enable-after': 'breaker',
          'enable-delay-ms': 2000
        }
      },
      inputSources
    });

    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F1', value: '0' });
    expect(engine.getSnapshot().keypad.output).toBe(false);

    await engine.handleMessage('paradox/room/gpio/events', { pin: 'F2', value: '0' });
    expect(engine.getSnapshot().keypad.enabled).toBe(false);

    now = 3500;
    engine.tick(now);
    expect(engine.getSnapshot().keypad.enabled).toBe(true);
    expect(engine.getSnapshot().keypad.output).toBeTruthy();
  });
});
