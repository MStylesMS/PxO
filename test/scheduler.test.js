/* Minimal scheduler smoke tests (node - no framework) */
const assert = (cond, msg) => { if (!cond) { throw new Error(msg); } };
const Game = require('../src/stateMachine');
const { loadConfig } = require('../src/config');

function run() {
  const cfg = loadConfig();
  const sm = new Game({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } } });
  sm.init();
  if (sm.stopHeartbeat) sm.stopHeartbeat();

  // Register a synthetic schedule entry in gameplay phase at start time to fade in clock via cue
  sm.gameType = Object.keys(cfg.game)[0];
  sm.remaining = 120; // arbitrary
  const phaseKey = 'gameplay';
  const schedule = [
    { at: 120, fireCue: 'fade-in-clock' }
  ];
  // Patch before registration to capture the immediate at===duration firing
  let seenFadeIn = false;
  const origFireCue = sm.fireCueByName.bind(sm);
  sm.fireCueByName = (name) => { if (name === 'fade-in-clock') seenFadeIn = true; return origFireCue(name); };
  sm.registerPhaseSchedule(phaseKey, schedule, 120);

  // Unified timer doesn't tick here; immediate entries at start are fired by registerPhaseSchedule
  assert(seenFadeIn, 'Expected fade-in-clock cue at phase start');

  // Early hint suppresses scheduled duplicate shortly after
  sm.disabledHints.clear();
  sm.fireHint('hint_box2', 'early');
  const schedule2 = [{ at: 60, 'play-hint': 'hint_box2' }];
  sm.remaining = 60;
  sm.registerPhaseSchedule(phaseKey, schedule2, 120);

  // fireHint is invoked during register on at===duration only; here we test suppression by invoking scheduled later
  // Simulate timer tick firing a scheduled entry
  let scheduledPlayed = false;
  const origFireHint = sm.fireHint.bind(sm);
  sm.fireHint = (id, src) => { if (src === 'scheduled') scheduledPlayed = true; return origFireHint(id, src); };
  // Manually invoke the logic analogous to the timer with remaining already equal to 60
  schedule2.forEach(item => { if (item.at === sm.remaining && !sm.isScheduledHintSuppressed(item['play-hint'])) sm.fireHint(item['play-hint'], 'scheduled'); });
  assert(!scheduledPlayed, 'Early hint should suppress scheduled firing');

  console.log('scheduler.test.js PASS');
}

run();
