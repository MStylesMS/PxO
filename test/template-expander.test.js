/* Phase 1 Template Expansion Tests (no framework) */
const { expandTemplates } = require('../src/template-expander');

describe('template expander', () => {
  test('expands template invocations into absolute schedule entries', () => {
    const modular = {
      templates: {
        countdown_block: {
          params: ['cue', 'video_duration'],
          steps: [
            { offset: -5, fire: ':$cue', note: 'prep' },
            { offset: 0, fire: ':$cue', note: 'play' },
            { offset: 4, fire: ':show-clock', note: 'return clock' }
          ]
        }
      },
      global: { settings: {} },
      'game-modes': {
        'hc-60': {
          gameplay: {
            schedule: [
              { at: 2700, template: 'countdown_block', params: { cue: '45min', video_duration: 24 } },
              { at: 0, end: 'fail' }
            ]
          }
        }
      }
    };

    const expanded = expandTemplates(modular);
  const sched = expanded['game-modes']['hc-60'].gameplay.schedule;

    expect(sched).toHaveLength(4);
    expect(sched.map(e => e.at)).toEqual([0, 2695, 2700, 2704]);
    expect(sched.find(e => e.note === 'play')?.fire).toBe('45min');
    expect(sched.find(e => e._fromTemplate)?._fromTemplate.name).toBe('countdown_block');
  });

  test('throws useful errors for missing templates, params, and negative times', () => {
    expect(() => expandTemplates({ templates: {}, 'game-modes': { g1: { gameplay: { schedule: [{ at: 10, template: 'nope', params: {} }] } } } }))
      .toThrow("Template 'nope' not found");

    expect(() => expandTemplates({ templates: { t1: { params: ['x'], steps: [{ offset: 0, value: ':$x' }] } }, 'game-modes': { g1: { gameplay: { schedule: [{ at: 5, template: 't1', params: {} }] } } } }))
      .toThrow("Missing required param 'x'");

    expect(() => expandTemplates({ templates: { t1: { params: ['x'], steps: [{ offset: -10, value: ':$x' }] } }, 'game-modes': { g1: { gameplay: { schedule: [{ at: 5, template: 't1', params: { x: 1 } }] } } } }))
      .toThrow(/became negative/);
  });

  test('supports parameter-based offset objects', () => {
    const modular = {
      templates: {
        block: {
          params: ['dur'],
          steps: [
            { offset: -1, note: 'pre' },
            { offset: { param: ':dur', add: 2 }, note: 'after' }
          ]
        }
      },
      'game-modes': { g1: { gameplay: { schedule: [{ at: 10, template: 'block', params: { dur: 3 } }] } } }
    };

    const expanded = expandTemplates(modular);
    const sched = expanded['game-modes'].g1.gameplay.schedule;

    expect(sched).toEqual(expect.arrayContaining([
      expect.objectContaining({ note: 'pre', at: 9 }),
      expect.objectContaining({ note: 'after', at: 15 })
    ]));
  });
});
