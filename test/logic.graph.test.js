'use strict';

const { buildGraph } = require('../src/logic/graph');

describe('logic graph', () => {
  const inputs = {
    'gpio-events': { topic: 'paradox/room/gpio/events', 'signal-key': 'pin', 'value-key': 'value', 'active-low': true }
  };

  test('topological order puts dependencies first', () => {
    const built = buildGraph({
      breaker: { type: 'match', inputs: ['gpio-events/F1'], target: { F1: 1 } },
      count: { type: 'count-true', inputs: ['breaker'] },
      bars: { type: 'scale', input: 'count', 'in-max': 1, 'out-max': 8 }
    }, { inputSources: inputs });

    expect(built.errors).toEqual([]);
    expect(built.order.indexOf('breaker')).toBeLessThan(built.order.indexOf('count'));
    expect(built.order.indexOf('count')).toBeLessThan(built.order.indexOf('bars'));
  });

  test('detects cycles', () => {
    const built = buildGraph({
      a: { type: 'passthrough', input: 'b' },
      b: { type: 'passthrough', input: 'a' }
    });
    expect(built.errors.some((e) => /cycle/i.test(e.message))).toBe(true);
  });

  test('rejects unknown node references and unknown types', () => {
    const built = buildGraph({
      a: { type: 'passthrough', input: 'missing' },
      b: { type: 'not-a-type', input: 'a' }
    });
    expect(built.errors.some((e) => /unknown node 'missing'/.test(e.message))).toBe(true);
    expect(built.errors.some((e) => /unknown type/.test(e.message))).toBe(true);
  });

  test('warns on unknown input sources', () => {
    const built = buildGraph({
      breaker: { type: 'match', inputs: ['nope/F1'], target: { F1: 1 } }
    }, { inputSources: inputs });
    expect(built.warnings.some((e) => /unknown input source 'nope'/.test(e.message))).toBe(true);
  });

  test('rejects :match-last combined with :enter', () => {
    const built = buildGraph({
      keypad: {
        type: 'sequence',
        input: { source: 'gpio-events', signal: 'Keypad' },
        target: ['1', '2', '3', '4'],
        'match-last': true,
        enter: 'pound'
      }
    }, { inputSources: inputs });
    expect(built.errors.some((e) => /match-last/.test(e.message) && /enter/.test(e.message))).toBe(true);
  });
});
