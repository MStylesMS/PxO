'use strict';

const ConfigValidator = require('../src/validators/configValidator');

function baseConfig(logic) {
  return {
    global: {
      hints: {},
      inputs: {
        'gpio-events': { topic: 'paradox/room/gpio/events' }
      },
      logic,
      mqtt: {
        zones: {
          wallclock: { type: 'mqtt', 'base-topic': 'paradox/room/wallclock' }
        }
      }
    },
    'game-modes': {
      demo: {
        'short-label': 'Demo',
        'game-label': 'Demo Mode',
        phases: {
          gameplay: { duration: 60, sequence: 'demo-seq' },
          abort: { sequence: 'demo-abort' },
          reset: { sequence: 'demo-reset' }
        }
      }
    }
  };
}

describe('ConfigValidator logic graph', () => {
  test('accepts a valid match / sequence / scale graph', () => {
    const validator = new ConfigValidator();
    const result = validator.validate(baseConfig({
      breaker: {
        type: 'match',
        inputs: ['gpio-events/F1', 'gpio-events/F2'],
        target: { F1: 1, F2: 0 },
        latch: true,
        'on-true': [{ fire: 'seq-breaker-solved' }]
      },
      keypad: {
        type: 'sequence',
        input: { source: 'gpio-events', signal: 'Keypad', 'value-key': 'key', when: { value: '0' } },
        target: ['1', '3', '5', '7', 'pound'],
        'match-last': true,
        'on-true': [{ end: 'win' }]
      },
      count: { type: 'count-true', inputs: ['breaker'] },
      bars: {
        type: 'scale',
        input: 'count',
        'in-max': 1,
        'out-max': 8,
        'on-change': [{ zone: 'wallclock', command: 'announce', bars: '{{value}}' }]
      }
    }));
    expect(result.isValid).toBe(true);
  });

  test('rejects unknown types, cycles, and bad actions', () => {
    const validator = new ConfigValidator();
    const result = validator.validate(baseConfig({
      a: { type: 'passthrough', input: 'b' },
      b: { type: 'mystery', input: 'a', 'on-true': [{ type: 'game', command: 'solve' }] }
    }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => /unknown type/.test(e))).toBe(true);
  });

  test('rejects a logic node name that collides with a cue', () => {
    const validator = new ConfigValidator();
    const config = baseConfig({
      'clock-start': { type: 'passthrough', input: 'gpio-events/F1' }
    });
    config.global.cues = {
      'clock-start': { zone: 'wallclock', command: 'start' }
    };
    const result = validator.validate(config);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => /Duplicate name 'clock-start'/.test(e))).toBe(true);
  });

  test('rejects sequence match-last plus enter', () => {
    const validator = new ConfigValidator();
    const result = validator.validate(baseConfig({
      keypad: {
        type: 'sequence',
        input: { source: 'gpio-events', signal: 'Keypad', 'value-key': 'key' },
        target: ['1', '2', '3', '4'],
        'match-last': true,
        enter: 'pound'
      }
    }));
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => /match-last/.test(e) && /enter/.test(e))).toBe(true);
  });
});
