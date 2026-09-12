'use strict';

const StateMachine = require('../src/stateMachine');
const { LogicEngine } = require('../src/logic/engine');

describe('logic graph reset at auto reset / new-game boundaries', () => {
  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
  }

  function createMachine({ now }) {
    const localCfg = {
      global: {
        mqtt: { 'game-topic': 'game' },
        settings: {},
        logic: {
          arm: {
            type: 'passthrough',
            input: { const: false },
            latch: true
          },
          hurry: {
            type: 'timeout',
            start: 'arm',
            'duration-ms': 5_000,
            'reset-on-false': true,
            'on-true': [{ fire: 'hurry-vo' }]
          }
        }
      },
      game: {
        test: {
          phases: {
            intro: { duration: 0, sequence: 'noop' },
            gameplay: { duration: 60, sequence: 'noop' },
            solved: { duration: 0, sequence: 'noop' },
            failed: { duration: 0, sequence: 'noop' },
            abort: { duration: 0, sequence: 'noop' },
            reset: { duration: 0, sequence: 'noop' }
          }
        }
      }
    };

    const sm = new StateMachine({
      cfg: localCfg,
      mqtt: { publish: () => {}, subscribe: () => {}, on: () => {} }
    });

    // Rebuild with controllable clock (constructor already built once).
    sm.logicEngine = new LogicEngine({
      logicConfig: localCfg.global.logic,
      inputSources: {},
      now,
      logger: { info() {}, warn() {}, debug() {}, error() {} },
      onAction: async () => {}
    });

    sm.gameType = 'test';
    sm.currentGameMode = 'test';
    sm.state = 'ready';
    sm.phases = { ...localCfg.game.test.phases };
    sm.startUnifiedTimer = () => {};
    sm.stopUnifiedTimer = () => {};
    sm.clearAllPhaseSchedules = () => {};
    sm.publishState = () => {};
    sm.publishEvent = () => {};
    sm.publishWarning = () => {};
    sm.changeState = (next) => { sm.state = next; };
    sm.sequenceRunner.runControlSequence = async () => ({ ok: true });
    sm.sequenceRunner.resolveSequence = () => ({ sequence: [] });
    sm.runStartupValidation = () => ({ valid: true });
    sm.loadPhases = () => {};
    sm.loadGlobalSequences = () => {};
    sm.wait = async () => {};

    return sm;
  }

  test('auto reset phase clears timeout startedAt before ready', async () => {
    let now = 1_000;
    const sm = createMachine({ now: () => now });

    await sm.logicEngine.forceSolve('arm');
    now = 7_000;
    await sm.logicEngine.tick(now);
    assert(sm.logicEngine.getSnapshot().hurry.output === true, 'expected hurry true after duration');
    assert(sm.logicEngine.nodeState.get('hurry').startedAt === 1_000, 'expected stale startedAt before reset');

    sm.state = 'solved';
    sm.currentPhase = 'solved';
    const ok = await sm.completePhase('closing');
    assert(ok === true, 'expected closing to complete');
    assert(sm.state === 'ready', 'expected auto path to land in ready');
    assert(sm.logicEngine.getSnapshot().hurry.output === false, 'expected hurry cleared after auto reset');
    assert(sm.logicEngine.getSnapshot().arm.output === false, 'expected arm latch cleared after auto reset');
    assert(sm.logicEngine.nodeState.get('hurry').startedAt === 0, 'expected startedAt cleared after auto reset');
  });

  test('new-game start clears stale timeout before intro and re-arm is fresh', async () => {
    let now = 1_000;
    const sm = createMachine({ now: () => now });
    const transitions = [];
    const originalTransition = sm.transitionToPhase.bind(sm);
    sm.transitionToPhase = async (phaseName) => {
      transitions.push({
        phase: phaseName,
        hurryStartedAt: sm.logicEngine.nodeState.get('hurry').startedAt,
        hurryOutput: sm.logicEngine.getSnapshot().hurry.output,
        armOutput: sm.logicEngine.getSnapshot().arm.output
      });
      return originalTransition(phaseName);
    };

    await sm.logicEngine.forceSolve('arm');
    now = 7_000;
    await sm.logicEngine.tick(now);
    assert(sm.logicEngine.getSnapshot().hurry.output === true, 'expected hurry fired in prior game');

    // Simulate ready with leftover latches (bug path before this fix).
    sm.state = 'ready';
    sm.currentPhase = null;

    const started = await sm._startViaSequences('test');
    assert(started === true, 'expected start to succeed');
    assert(transitions[0] && transitions[0].phase === 'intro', 'expected intro transition');
    assert(transitions[0].hurryStartedAt === 0, 'expected graph cleared before intro');
    assert(transitions[0].hurryOutput === false, 'expected hurry false before intro');
    assert(transitions[0].armOutput === false, 'expected arm false before intro');

    now = 8_000;
    await sm.logicEngine.forceSolve('arm');
    assert(sm.logicEngine.nodeState.get('hurry').startedAt === 8_000, 'expected fresh startedAt after re-arm');
    assert(sm.logicEngine.getSnapshot().hurry.output === false, 'expected hurry not immediately true');

    now = 10_000;
    await sm.logicEngine.tick(now);
    assert(sm.logicEngine.getSnapshot().hurry.output === false, 'expected hurry still waiting');

    now = 13_500;
    await sm.logicEngine.tick(now);
    assert(sm.logicEngine.getSnapshot().hurry.output === true, 'expected hurry after fresh duration');
  });

  test('operator _runResetSequence still clears the graph (idempotent with phase reset)', async () => {
    let now = 1_000;
    const sm = createMachine({ now: () => now });
    sm._resolveResetDefinition = () => ({ config: null, type: null });

    await sm.logicEngine.forceSolve('arm');
    now = 7_000;
    await sm.logicEngine.tick(now);
    assert(sm.logicEngine.getSnapshot().hurry.output === true, 'expected hurry true before operator reset');

    const ok = await sm._runResetSequence();
    assert(ok === true, 'expected operator reset to succeed');
    assert(sm.logicEngine.getSnapshot().hurry.output === false, 'expected hurry cleared');
    assert(sm.logicEngine.nodeState.get('hurry').startedAt === 0, 'expected startedAt cleared');
    assert(sm.state === 'ready', 'expected operator reset to ready');
  });
});
