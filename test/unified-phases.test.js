const StateMachine = require('../src/stateMachine');
const SequenceRunner = require('../src/sequenceRunner');

describe('Unified Sequence and Schedule System', () => {
    let stateMachine, cfg;
    beforeEach(() => {
        cfg = { global: { mqtt: { 'game-topic': 'game' }, settings: {} }, game: {} };
        stateMachine = new StateMachine({ cfg, mqtt: { publish: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
    });

    function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

    test('resolves global sequence reference', () => {
        const config = {
            global: { mqtt: { 'game-topic': 'game' }, 'system-sequences': { 'test-sequence': { sequence: [{ command: 'showBrowser' }] } } },
            game: {}
        };
        const sm = new StateMachine({ cfg: config, mqtt: { publish: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { } }, lights: { scene: () => { } } });
        const seq = sm.sequenceRunner.resolveSequence('test-sequence', null);
        assert(seq, 'expected sequence to be resolved');
        assert(seq.sequence && seq.sequence[0].command === 'showBrowser', 'unexpected command');
    });

    test('handles inline sequence array', () => {
        const inline = [{ command: 'showBrowser' }];
        const resolved = stateMachine.sequenceRunner.resolveSequence(inline, null);
        assert(Array.isArray(resolved.sequence) && resolved.sequence.length === 1, 'inline resolution failed');
    });

    test('executes step with wait property', async () => {
        const seqDef = { sequence: [{ command: 'fadeInClock', duration: 0.01, wait: true }] };
        const res = await stateMachine.sequenceRunner.runInlineSequence('inline-test', seqDef, {});
        assert(res.ok === true, 'sequence did not complete successfully');
    });

    test('stateMachine.executePhase runs named sequence and waits using phase duration', async () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
        let ranNamed = false;
        sm.sequenceRunner.runControlSequence = async (name, ctx) => { ranNamed = name; };
        let waited = 0;
        sm.wait = async (ms) => { waited = ms; };

        await sm.executePhase('phase-1', { sequence: 'global-test-seq', duration: 1 });
        assert(ranNamed === 'global-test-seq');
        assert(waited === 1000);
    });

    test('stateMachine.executePhase runs named schedule by reference and uses schedule duration', async () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { }, hint: () => { } }, lights: { scene: () => { } }, media: {} });
        sm.gameType = 'test';
        sm.sequenceRunner.resolveSequence = () => ({ duration: 3, schedule: [{ at: 3, fire: 'x' }] });
        let executedSchedule = null;
        sm.executeSchedule = async (schedule, duration) => { executedSchedule = { schedule, duration }; };

        await sm.executePhase('phase-2', { schedule: 'test-schedule' });
        assert(!!executedSchedule, 'expected schedule to execute');
        assert(executedSchedule.duration === 3, 'expected schedule duration to come from schedule definition');
        assert(Array.isArray(executedSchedule.schedule), 'expected schedule array');
    });

    test('fireByName does not execute schedule definitions directly', async () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
        sm.gameType = 'test';
        sm.sequenceRunner.resolveSequenceNew = () => ({ duration: 5, schedule: [{ at: 5, fire: 'x' }] });
        sm.fireSequenceByName = jest.fn();

        await sm.fireByName('phase-only-schedule');

        assert(sm.fireSequenceByName.mock.calls.length === 0, 'expected schedule definitions to be rejected by fireByName');
    });

    test('calculatePhaseDuration enforces strict source of duration', () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
        sm.gameType = 'test';
        sm.sequenceRunner.resolveSequence = (name) => {
            if (name === 'sched-ok') return { duration: 42, schedule: [{ at: 42, fire: 'x' }] };
            return undefined;
        };

        const seqDuration = sm.calculatePhaseDuration({ sequence: 'intro-seq', duration: 15 }, 'intro');
        assert(seqDuration === 15, 'expected sequence phase duration from phase definition');

        const schedDuration = sm.calculatePhaseDuration({ schedule: 'sched-ok' }, 'gameplay');
        assert(schedDuration === 42, 'expected schedule phase duration from schedule definition');
    });

    test('getPhaseDuration only reads canonical durations map', () => {
        const localCfg = {
            global: { mqtt: { 'game-topic': 'game' }, settings: {} },
            game: {
                test: {
                    durations: { gameplay: 60 },
                    gameplay: { duration: 999 }
                },
                legacyOnly: {
                    gameplay: { duration: 999 }
                }
            }
        };

        const sm = new StateMachine({ cfg: localCfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });

        sm.gameType = 'test';
        assert(sm.getPhaseDuration('gameplay') === 60, 'expected canonical durations map to be used');

        sm.gameType = 'legacyOnly';
        assert(sm.getPhaseDuration('gameplay') === 0, 'expected legacy per-phase duration fallback to be ignored');
    });

    test('validatePhaseStructure flags forbidden sequence/schedule combinations and missing duration', () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
        sm.sequenceRunner.resolveSequence = () => ({ sequence: [{ fire: 'x' }] });

        const both = sm.validatePhaseStructure({ sequence: 'a', schedule: 'b', duration: 1 }, 'p1', 'gm');
        assert(both.errors.length > 0, 'expected error when both sequence and schedule are set');

        const missingDuration = sm.validatePhaseStructure({ sequence: 'a' }, 'p2', 'gm');
        assert(missingDuration.errors.length > 0, 'expected error when sequence phase is missing duration');
    });
});
