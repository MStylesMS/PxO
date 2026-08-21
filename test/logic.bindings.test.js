'use strict';

const {
  coerceValue,
  applyPolarity,
  isTruthy,
  valuesEqual,
  parseBinding,
  parseBindings,
  extractBindingValue,
  extractSignalName,
  matchesWhen,
  interpolate,
  isLogicSourceName,
  logicSourceNodeName,
  virtualLogicTopic
} = require('../src/logic/bindings');

describe('logic bindings', () => {
  test('coerces common on/off encodings to 0/1', () => {
    expect(coerceValue('0')).toBe(0);
    expect(coerceValue('1')).toBe(1);
    expect(coerceValue(false)).toBe(0);
    expect(coerceValue(true)).toBe(1);
    expect(coerceValue('off')).toBe(0);
    expect(coerceValue('ON')).toBe(1);
    expect(coerceValue('pound')).toBe('pound');
    expect(coerceValue('7')).toBe(7);
  });

  test('applies active-low after coerce', () => {
    expect(applyPolarity(0, true)).toBe(1);
    expect(applyPolarity(1, true)).toBe(0);
    expect(applyPolarity('pound', true)).toBe('pound');
  });

  test('parses short source/signal form and bare node names', () => {
    expect(parseBinding('gpio-events/F1')).toEqual(expect.objectContaining({
      kind: 'source',
      source: 'gpio-events',
      signal: 'F1'
    }));
    expect(parseBinding('breaker')).toEqual(expect.objectContaining({
      kind: 'node',
      node: 'breaker'
    }));
    expect(parseBinding('logic/map')).toEqual(expect.objectContaining({
      kind: 'node',
      node: 'map'
    }));
  });

  test('parses long-form keypad binding', () => {
    const binding = parseBinding({
      source: 'gpio-events',
      signal: 'Keypad',
      'value-key': 'key',
      when: { value: '0' },
      'active-low': false
    });
    expect(binding.kind).toBe('source');
    expect(binding.signal).toBe('Keypad');
    expect(binding.valueKey).toBe('key');
    expect(binding.when).toEqual({ value: '0' });
    expect(binding.activeLow).toBe(false);
  });

  test('extracts GPIO values with source-level active-low', () => {
    const binding = parseBinding('gpio-events/F1');
    const sourceDef = { topic: 't', 'signal-key': 'pin', 'value-key': 'value', 'active-low': true };
    expect(extractBindingValue(binding, { pin: 'F1', value: '0' }, sourceDef, {})).toBe(1);
    expect(extractBindingValue(binding, { pin: 'F1', value: '1' }, sourceDef, {})).toBe(0);
  });

  test('extracts keypad key when when-clause matches', () => {
    const binding = parseBinding({
      source: 'gpio-events',
      signal: 'Keypad',
      'value-key': 'key',
      when: { value: '0' },
      'active-low': false
    });
    const sourceDef = { 'value-key': 'value', 'active-low': true };
    expect(extractBindingValue(binding, { pin: 'Keypad', key: '7', value: '0' }, sourceDef, {})).toBe(7);
    expect(extractBindingValue(binding, { pin: 'Keypad', key: '7', value: '1' }, sourceDef, {})).toBeUndefined();
  });

  test('matchesWhen and extractSignalName', () => {
    expect(matchesWhen({ event: 'code_solved' }, { event: 'code_solved' })).toBe(true);
    expect(matchesWhen({ event: 'other' }, { event: 'code_solved' })).toBe(false);
    expect(extractSignalName({ pin: 'F3', value: '0' }, { 'signal-key': 'pin' }, {})).toBe('F3');
  });

  test('interpolates exact {{value}} as native type', () => {
    expect(interpolate({ bars: '{{value}}' }, { value: 3 })).toEqual({ bars: 3 });
    expect(interpolate('count {{value}}', { value: 3 })).toBe('count 3');
  });

  test('logic source helpers', () => {
    expect(isLogicSourceName('logic/breaker')).toBe(true);
    expect(logicSourceNodeName('logic/breaker')).toBe('breaker');
    expect(virtualLogicTopic('breaker')).toBe('__pxo/logic/breaker');
  });

  test('isTruthy and valuesEqual', () => {
    expect(isTruthy(0)).toBe(false);
    expect(isTruthy(1)).toBe(true);
    expect(isTruthy(3)).toBe(true);
    expect(valuesEqual('1', 1)).toBe(true);
    expect(valuesEqual('pound', 'pound')).toBe(true);
  });

  test('parseBindings accepts a single ref or vector', () => {
    expect(parseBindings(['gpio-events/F1', 'breaker'])).toHaveLength(2);
    expect(parseBindings('map')[0].node).toBe('map');
  });
});
