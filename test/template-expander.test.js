/* Phase 1 Template Expansion Tests (no framework) */
const { expandTemplates } = require('../src/template-expander');

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function testBasicExpansion() {
  const modular = {
    templates: {
      countdown_block: {
        params: ['cue','video_duration'],
        steps: [
          { offset: -5, 'fire-cue': ':$cue', note: 'prep' },
          { offset: 0,  'fire-cue': ':$cue', note: 'play' },
          { offset: 4,  'fire-cue': ':show-clock', note: 'return clock' }
        ]
      }
    },
    global: { settings: {} },
    games: {
      'hc-60': {
        game: {
          schedule: [
            { at: 2700, template: 'countdown_block', params: { cue: '45min', video_duration: 24 } },
            { at: 0, end: 'fail' }
          ]
        }
      }
    }
  };
  const expanded = expandTemplates(modular);
  const sched = expanded.games['hc-60'].game.schedule;
  assert(sched.length === 4, 'Expected 3 expanded + 1 original = 4 entries');
  const ats = sched.map(e => e.at).join(',');
  assert(ats === '0,2695,2700,2704', 'Incorrect absolute times: ' + ats);
  const playIdx = sched.findIndex(e => e.note === 'play');
  assert(playIdx >= 0, 'Missing play step');
  assert(sched[playIdx]['fire-cue'] === '45min', 'Cue substitution failed got '+sched[playIdx]['fire-cue']);
  const prov = sched.find(e => e._fromTemplate);
  assert(prov && prov._fromTemplate.name === 'countdown_block', 'Missing provenance');
}

function testErrors() {
  // Missing template
  try {
    expandTemplates({ templates: {}, games: { g1: { game: { schedule: [{ at: 10, template: 'nope', params: {} }] } } } });
    throw new Error('Expected error for missing template');
  } catch(e) {
    if (!/Template 'nope' not found/.test(e.message)) throw e;
  }

  // Missing param
  try {
    expandTemplates({ templates: { t1: { params:['x'], steps:[{ offset: 0, value: ':$x'}] } }, games: { g1: { game: { schedule: [{ at: 5, template: 't1', params: {} }] } } } });
    throw new Error('Expected error for missing param');
  } catch(e) {
    if (!/Missing required param 'x'/.test(e.message)) throw e;
  }

  // Negative result time
  try {
    expandTemplates({ templates: { t1: { params:['x'], steps:[{ offset: -10, value: ':$x'}] } }, games: { g1: { game: { schedule: [{ at: 5, template: 't1', params: { x: 1 } }] } } } });
    throw new Error('Expected error for negative time');
  } catch(e) {
    if (!/became negative/.test(e.message)) throw e;
  }
}

function run() {
  testBasicExpansion();
  testErrors();
  // Param-based offset object test
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
    games: { g1: { game: { schedule: [ { at: 10, template: 'block', params: { dur: 3 } } ] } } }
  };
  const expanded = expandTemplates(modular);
  const sched = expanded.games.g1.game.schedule;
  assert(sched.some(e => e.note === 'pre' && e.at === 9), 'Param offset pre step wrong');
  assert(sched.some(e => e.note === 'after' && e.at === 15), 'Param offset after step wrong');
  console.log('template-expander.test.js PASS');
}

run();
