/* Minimal scheduler smoke tests (node - no framework) */
const Game = require('../src/stateMachine');
const { loadConfig } = require('../src/config');

describe('scheduler smoke tests', () => {
  test('fires immediate cues and suppresses duplicate scheduled hints', () => {
    const cfg = loadConfig();
    const sm = new Game({ cfg, mqtt: { publish: () => {}, subscribe: () => {}, on: () => {} } });

    sm.gameType = Object.keys(cfg.game)[0];
    sm.currentGameMode = sm.gameType;
    sm.remaining = 120;

    const phaseKey = 'gameplay';
    const schedule = [{ at: 120, fire: 'fade-in-clock' }];
    let seenFadeIn = false;
    const origFireCue = sm.fireCueByName.bind(sm);
    sm.fireCueByName = (name) => {
      if (name === 'fade-in-clock') seenFadeIn = true;
      return origFireCue(name);
    };

    sm.registerPhaseSchedule(phaseKey, schedule, 120);
    expect(seenFadeIn).toBe(true);

  sm.disabledHints.clear();
  sm.disabledHints.set('hint-box2', Date.now());

    const schedule2 = [{ at: 60, fire: 'hint_box2' }];
    sm.remaining = 60;
    sm.registerPhaseSchedule(phaseKey, schedule2, 120);

    let scheduledPlayed = false;
    const origFireHint = sm.fireHint.bind(sm);
    sm.fireHint = (id, src) => {
      if (src === 'scheduled') scheduledPlayed = true;
      return origFireHint(id, src);
    };

    schedule2.forEach(item => {
      if (item.at === sm.remaining && !sm.isScheduledHintSuppressed(item.fire)) {
        sm.fireHint(item.fire, 'scheduled');
      }
    });

    expect(scheduledPlayed).toBe(false);
  });
});
