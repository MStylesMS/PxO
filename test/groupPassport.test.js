'use strict';

const {
  normalizePassport,
  normalizeTypes,
  CANONICAL_TYPES,
} = require('../src/groupPassport');

describe('groupPassport', () => {
  test('canonical types include strangers', () => {
    expect(CANONICAL_TYPES).toContain('strangers');
    expect(CANONICAL_TYPES).toContain('family');
  });

  test('normalizeTypes accepts array and multi-select string', () => {
    expect(normalizeTypes(['Family', 'kids', 'family'])).toEqual(['family', 'kids']);
    expect(normalizeTypes('coworkers, strangers')).toEqual(['coworkers', 'strangers']);
  });

  test('normalizePassport generates groupId and keeps fields', () => {
    const p = normalizePassport({
      game: 'tfd',
      name: 'Crew A',
      size: 4,
      types: ['family', 'novices'],
    }, { defaultGame: 'other' });
    expect(p.groupId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(p.game).toBe('tfd');
    expect(p.name).toBe('Crew A');
    expect(p.size).toBe(4);
    expect(p.types).toEqual(['family', 'novices']);
  });

  test('normalizePassport keeps spaced names and notes; drops blank name', () => {
    const named = normalizePassport({
      game: 'tfd',
      name: 'Group 1 on 09/09/2026',
      notes: ' birthday ',
    });
    expect(named.name).toBe('Group 1 on 09/09/2026');
    expect(named.notes).toBe('birthday');

    const blank = normalizePassport({ game: 'tfd', name: '   ' }, { generateId: false });
    expect(blank.name).toBeUndefined();
  });

  test('nested passport object and defaultGame', () => {
    const p = normalizePassport({
      passport: { groupId: 'abc-123', types: ['experienced'] },
    }, { defaultGame: 'tfd', generateId: false });
    expect(p.groupId).toBe('abc-123');
    expect(p.game).toBe('tfd');
    expect(p.types).toEqual(['experienced']);
  });
});
