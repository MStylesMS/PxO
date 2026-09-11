'use strict';

const {
  normalizePassport,
  normalizeTypes,
  passportLogFields,
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

  test('normalizePassport stores valid mediaId 2', () => {
    const fromNumber = normalizePassport({ game: 'tfd', mediaId: 2 }, { generateId: false });
    expect(fromNumber.mediaId).toBe(2);

    const fromString = normalizePassport({
      passport: { groupId: 'abc', mediaId: '2' },
    }, { generateId: false });
    expect(fromString.mediaId).toBe(2);

    expect(passportLogFields(fromNumber).mediaId).toBe(2);
  });

  test('normalizePassport skips illegal mediaId', () => {
    const cases = [0, '0', 'v1', '02', '../etc', '', '1.5', -2];
    for (const mediaId of cases) {
      const p = normalizePassport({ game: 'tfd', mediaId }, { generateId: false });
      expect(p.mediaId).toBeUndefined();
    }
    expect(passportLogFields({ groupId: 'x', game: 'tfd' }).mediaId).toBeUndefined();
  });

  test('normalizePassport omit mediaId leaves passport unchanged', () => {
    const p = normalizePassport({
      game: 'tfd',
      name: 'Crew A',
      size: 4,
    }, { generateId: false });
    expect(p.mediaId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(p, 'mediaId')).toBe(false);
    expect(p.game).toBe('tfd');
    expect(p.name).toBe('Crew A');
    expect(p.size).toBe(4);
    expect(passportLogFields(p)).not.toHaveProperty('mediaId');
  });
});
