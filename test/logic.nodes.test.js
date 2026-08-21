'use strict';

const { getNodeType } = require('../src/logic/nodes');
const { parseBinding, parseBindings } = require('../src/logic/bindings');

function evalType(type, node, values = {}, event = null, state = undefined, now = 1000, extra = {}) {
  const impl = getNodeType(type);
  const ctx = {
    bindingDefaults: {},
    getInput: (binding) => {
      if (!binding) return undefined;
      if (binding.kind === 'node') return values[binding.node];
      const key = binding.signal || binding.source;
      return values[key];
    },
    getNodeOutput: (name) => values[name],
    state,
    event,
    now,
    gameplayStartedAt: extra.gameplayStartedAt
  };
  return impl.evaluate(node, ctx);
}

describe('logic node types', () => {
  test(':match is true only when every target signal is present and equal', () => {
    const node = {
      type: 'match',
      inputs: ['gpio-events/F1', 'gpio-events/F2'],
      target: { F1: 1, F2: 0 }
    };
    expect(evalType('match', node, { F1: 1 }).output).toBe(false);
    expect(evalType('match', node, { F1: 1, F2: 0 }).output).toBe(true);
    expect(evalType('match', node, { F1: 1, F2: 1 }).output).toBe(false);
  });

  test(':sequence match-last is a sliding window over recent keys', () => {
    const node = {
      type: 'sequence',
      input: { source: 'gpio-events', signal: 'Keypad', 'value-key': 'key' },
      target: ['1', '3', '5', '7', 'pound'],
      'match-last': true
    };
    const binding = parseBinding(node.input);
    let state;
    const keys = ['9', '1', '3', '5', '7', 'pound'];
    let output = false;
    keys.forEach((key) => {
      const result = evalType('sequence', node, {}, {
        binding,
        bindingKey: 'source:gpio-events:Keypad:key',
        source: 'gpio-events',
        signal: 'Keypad',
        value: key
      }, state);
      state = result.state;
      output = result.output;
    });
    expect(output).toBe(true);
    expect(state.buffer).toEqual([1, 3, 5, 7, 'pound']);
  });

  test(':sequence without match-last resets on wrong when configured', () => {
    const node = {
      type: 'sequence',
      input: { source: 'gpio-events', signal: 'Keypad' },
      target: [1, 2, 3],
      'match-last': false,
      'reset-on-wrong': true
    };
    const binding = parseBinding(node.input);
    const feed = (value, state) => evalType('sequence', node, {}, {
      binding, source: 'gpio-events', signal: 'Keypad', value
    }, state);
    let r = feed(1, undefined);
    r = feed(9, r.state);
    expect(r.output).toBe(false);
    expect(r.state.buffer).toEqual([]);
    r = feed(1, r.state);
    r = feed(2, r.state);
    r = feed(3, r.state);
    expect(r.output).toBe(true);
  });

  test(':count-true and :scale map contributing puzzles onto LED bars', () => {
    const count = evalType('count-true', { inputs: ['a', 'b', 'c'] }, { a: true, b: false, c: 1 });
    expect(count.output).toBe(2);
    const bars = evalType('scale', { input: 'progress-count', 'in-max': 5, 'out-max': 8 }, { 'progress-count': 2 });
    expect(bars.output).toBe(3);
    const full = evalType('scale', { input: 'progress-count', 'in-max': 5, 'out-max': 8 }, { 'progress-count': 5 });
    expect(full.output).toBe(8);
  });

  test(':passthrough, :eq, :code-match, composition nodes', () => {
    expect(evalType('passthrough', { input: 'gpio-events/safe' }, { safe: 1 }).output).toBe(1);
    expect(evalType('eq', { input: 'enigma', value: 'code_solved' }, { enigma: 'code_solved' }).output).toBe(true);
    expect(evalType('code-match', { input: 'code', target: 582665 }, { code: '582665' }).output).toBe(true);
    expect(evalType('any-of', { inputs: ['a', 'b'] }, { a: false, b: true }).output).toBe(true);
    expect(evalType('all-of', { inputs: ['a', 'b'] }, { a: true, b: true }).output).toBe(true);
    expect(evalType('all-of', { inputs: ['a', 'b'] }, { a: true, b: false }).output).toBe(false);
    expect(evalType('none-of', { inputs: ['a', 'b'] }, { a: false, b: 0 }).output).toBe(true);
  });

  test(':threshold hold-ms and :timeout', () => {
    const tNode = { input: 'weight', op: 'gte', value: 40, 'hold-ms': 1500 };
    let r = evalType('threshold', tNode, { weight: 50 }, null, undefined, 1000);
    expect(r.output).toBe(false);
    r = evalType('threshold', tNode, { weight: 50 }, null, r.state, 2600);
    expect(r.output).toBe(true);
    r = evalType('threshold', tNode, { weight: 10 }, null, r.state, 2700);
    expect(r.output).toBe(false);

    const to = { start: 'door', 'duration-ms': 8000 };
    r = evalType('timeout', to, { door: true }, null, undefined, 1000);
    expect(r.output).toBe(false);
    r = evalType('timeout', to, { door: true }, null, r.state, 9000);
    expect(r.output).toBe(true);
    r = evalType('timeout', to, { door: false }, null, r.state, 9100);
    expect(r.output).toBe(false);
  });

  test(':combo-lock records stops on reversal beyond jitter', () => {
    const node = {
      input: 'rotary/position',
      target: [4, 0],
      'jitter-tolerance': 2,
      'direction-accuracy': 1,
      'reset-on-wrong': true
    };
    const binding = parseBinding('rotary/position');
    let state;
    const feed = (value) => {
      const result = evalType('combo-lock', node, {}, {
        binding, source: 'rotary', signal: 'position', value
      }, state, 1000);
      state = result.state;
      return result.output;
    };
    [0, 1, 2, 3, 4].forEach(feed);
    expect(feed(1)).toBe(false);
    expect(state.nextIndex).toBe(1);
    expect(feed(0)).toBe(false);
    expect(feed(3)).toBe(true);
  });

  test(':sequence enter/reset does not test until enter; # aliases pound', () => {
    const node = {
      type: 'sequence',
      input: { source: 'gpio-events', signal: 'Keypad' },
      target: ['1', '2', '3', '4'],
      enter: '#',
      reset: '*'
    };
    const binding = parseBinding(node.input);
    const feed = (value, state) => evalType('sequence', node, {}, {
      binding, source: 'gpio-events', signal: 'Keypad', value
    }, state);
    let r = feed('1', undefined);
    r = feed('2', r.state);
    r = feed('3', r.state);
    r = feed('4', r.state);
    expect(r.output).toBe(false);
    r = feed('pound', r.state);
    expect(r.output).toBe(true);
    expect(r.state.buffer).toEqual([]);

    r = feed('1', r.state);
    expect(r.output).toBe(false);
    r = feed('asterik', r.state);
    expect(r.state.buffer).toEqual([]);
    r = feed('9', r.state);
    r = feed('pound', r.state);
    expect(r.output).toBe(false);
    expect(r.state.buffer).toEqual([]);
  });

  test(':count-false, :sum weights, :clamp, :time-bonus', () => {
    expect(evalType('count-false', { inputs: ['a', 'b', 'c'] }, { a: true }).output).toBe(2);

    const sum = evalType('sum', {
      inputs: [
        { input: 'breaker', weight: 2 },
        'map',
        { input: 'terminal', weight: 3 }
      ]
    }, { breaker: true, map: true, terminal: false });
    expect(sum.output).toBe(3);

    expect(evalType('clamp', { input: 'n', min: 0, max: 8 }, { n: 12 }).output).toBe(8);
    expect(evalType('clamp', { input: 'n', min: 0, max: 8 }, { n: -3 }).output).toBe(0);

    const bonusNode = { input: 'keypad', max: 100, 'decay-ms': 60000, start: 'gameplay' };
    const early = evalType('time-bonus', bonusNode, { keypad: true }, null, undefined, 10000, { gameplayStartedAt: 0 });
    expect(early.output).toBe(83);
    const locked = evalType('time-bonus', bonusNode, { keypad: true }, null, early.state, 50000, { gameplayStartedAt: 0 });
    expect(locked.output).toBe(83);
  });

  test(':threshold min/max and outside', () => {
    const node = { input: 'lux', min: 10, max: 80 };
    expect(evalType('threshold', node, { lux: 40 }).output).toBe(true);
    expect(evalType('threshold', node, { lux: 9 }).output).toBe(false);
    expect(evalType('threshold', { ...node, outside: true }, { lux: 9 }).output).toBe(true);
    expect(evalType('threshold', { ...node, outside: true }, { lux: 40 }).output).toBe(false);
  });
});
