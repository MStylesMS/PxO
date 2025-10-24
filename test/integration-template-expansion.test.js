/* Integration test: load full EDN via adapter and verify template expansion */
const path = require('path');
const Adapter = require('../src/modular-config-adapter');

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function expectedTimes(base, dur) {
  return [base - 5, base - 2, base, base + dur + 2, base + dur + 4];
}

function run() {
  const cfgPath = path.join(__dirname, '..', '..', 'houdini.edn');
  const legacy = Adapter.loadConfig('edn', cfgPath);
  const game = legacy.game['hc-60'];
  assert(game, 'hc-60 game missing');
  const sched = game.schedule;
  assert(Array.isArray(sched) && sched.length > 0, 'schedule empty');

  const invocations = [
    { at: 3300, dur: 14 },
    { at: 2700, dur: 14 },
    { at: 2160, dur: 12 },
    { at: 1800, dur: 15 },
    { at: 1380, dur: 12 },
    { at: 900,  dur: 17 },
    { at: 300,  dur: 23 }
  ];

  invocations.forEach(({ at, dur }) => {
    const times = expectedTimes(at, dur);
    times.forEach(t => {
      const entry = sched.find(e => e.at === t);
      assert(entry, `Missing expanded step at ${t} (base ${at})`);
      if (t !== at) { // The base invocation itself is removed; all are expanded steps
        assert(entry._fromTemplate, `Expanded step at ${t} missing _fromTemplate`);
        assert(entry._fromTemplate.name === 'houdini-mm-video', `Wrong template name at ${t}`);
        assert(entry._fromTemplate.baseAt === at, `Wrong baseAt for ${t} (expected ${at}, got ${entry._fromTemplate.baseAt})`);
      }
    });
  });

  // Ensure no raw template invocation objects remain
  const leftover = sched.filter(e => e.template);
  assert(leftover.length === 0, 'Found unexpanded template invocation entries');

  console.log('integration-template-expansion.test.js PASS');
}

run();
