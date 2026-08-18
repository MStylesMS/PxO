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
        sm.registerPhaseSchedule = (phaseKey, schedule, duration) => { executedSchedule = { phaseKey, schedule, duration }; };

        await sm.executePhase('phase-2', { schedule: 'test-schedule' });
        assert(!!executedSchedule, 'expected schedule to execute');
        assert(executedSchedule.phaseKey === 'phase-2', 'expected schedule to register against the phase key');
        assert(executedSchedule.duration === 3, 'expected schedule duration to come from schedule definition');
        assert(Array.isArray(executedSchedule.schedule), 'expected schedule array');
    });

    test('fireByName does not execute schedule definitions directly', async () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
        sm.gameType = 'test';
        sm.sequenceRunner.resolveSequence = () => ({ duration: 5, schedule: [{ at: 5, fire: 'x' }] });
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

    function createIntroMachine({ intro }) {
        const localCfg = {
            global: {
                mqtt: { 'game-topic': 'game' },
                settings: {}
            },
            game: {
                test: {
                    phases: {
                        intro,
                        gameplay: { duration: 60, sequence: 'noop' },
                        abort: { duration: 0, sequence: 'noop' },
                        reset: { duration: 0, sequence: 'noop' }
                    }
                }
            }
        };
        const sm = new StateMachine({
            cfg: localCfg,
            mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }
        });
        sm.gameType = 'test';
        sm.currentGameMode = 'test';
        sm.state = 'ready';
        sm.phases = {
            intro,
            gameplay: { duration: 60, sequence: 'noop' },
            abort: { duration: 0, sequence: 'noop' },
            reset: { duration: 0, sequence: 'noop' }
        };
        sm.startUnifiedTimer = () => { };
        sm.stopUnifiedTimer = () => { };
        sm.sequenceRunner.runControlSequence = async () => ({ ok: true });
        sm.sequenceRunner.resolveSequence = (name) => {
            if (name === 'intro-sched') {
                return {
                    duration: 2,
                    schedule: [
                        { at: 2, fire: 'start-intro' },
                        { at: 1, fire: 'mid-intro' },
                        { at: 0, fire: 'end-intro' }
                    ]
                };
            }
            if (name === 'intro-seq') return { sequence: [{ fire: 'start-intro' }] };
            if (name === 'noop') return { sequence: [] };
            return undefined;
        };
        sm.fireByName = jest.fn(async () => { });
        sm.wait = async () => { };
        return sm;
    }

    async function tickIntro(sm) {
        sm.remaining = Math.max(0, sm.remaining - 1);
        const data = sm._phaseSchedules.get('intro');
        (data?.entries || []).forEach(item => {
            if (item.at === sm.remaining) {
                sm._executeScheduleEntry('intro', item.entry, item.at);
            }
        });
        if (sm.remaining === 0) {
            await sm._completeIntroPhase();
        }
    }

    test('schedule intro does not auto-advance until remaining hits 0', async () => {
        const sm = createIntroMachine({ intro: { schedule: 'intro-sched' } });
        const fired = [];
        sm.fireByName = jest.fn(async (name) => { fired.push(name); });

        await sm.transitionToPhase('intro');
        assert(sm.state === 'intro', 'expected schedule intro to remain in intro after start');
        assert(sm.remaining === 2, 'expected intro remaining from schedule duration');
        assert(fired.includes('start-intro'), 'expected start-at-duration cue to fire immediately');
        assert(!fired.includes('mid-intro'), 'did not expect mid-intro cue before first tick');

        await tickIntro(sm);
        assert(sm.state === 'intro', 'expected intro to hold after first tick');
        assert(sm.remaining === 1, 'expected remaining to tick down during intro');
        assert(fired.includes('mid-intro'), 'expected mid-intro schedule cue at remaining=1');

        await tickIntro(sm);
        assert(fired.includes('end-intro'), 'expected :at 0 cue before leaving intro');
        assert(sm.state === 'gameplay', 'expected schedule intro to advance when remaining hits 0');
    });

    test('sequence intro still waits phase duration then advances', async () => {
        const sm = createIntroMachine({ intro: { duration: 2, sequence: 'intro-seq' } });
        const waits = [];
        sm.wait = async (ms) => { waits.push(ms); };

        await sm.transitionToPhase('intro');
        assert(waits[0] === 2000, 'expected sequence intro to wait phase duration');
        assert(sm.state === 'gameplay', 'expected sequence intro to advance after wait');
    });

    test('aborted schedule intro does not later jump to gameplay', async () => {
        const sm = createIntroMachine({ intro: { schedule: 'intro-sched' } });

        await sm.transitionToPhase('intro');
        assert(sm.state === 'intro', 'expected to start in intro');
        sm._phaseTransitionToken += 1;
        sm.state = 'abort';
        sm.currentPhase = 'abort';
        await sm._completeIntroPhase();
        assert(sm.state !== 'gameplay', 'expected abort to cancel later intro-to-gameplay advance');
    });

    test('completePhase intro advances a schedule intro before remaining hits 0', async () => {
        const sm = createIntroMachine({ intro: { schedule: 'intro-sched' } });

        await sm.transitionToPhase('intro');
        assert(sm.state === 'intro', 'expected to start in intro');
        assert(sm.remaining === 2, 'expected intro remaining from schedule duration');

        const ok = await sm.completePhase('intro');
        assert(ok === true, 'expected completePhase intro to succeed');
        assert(sm.state === 'gameplay', 'expected intro to advance to gameplay before remaining hits 0');
    });

    test('completePhase intro is ignored when not in intro', async () => {
        const sm = createIntroMachine({ intro: { schedule: 'intro-sched' } });
        sm.state = 'gameplay';
        sm.currentPhase = 'gameplay';

        const ok = await sm.completePhase('intro');
        assert(ok === false, 'expected completePhase intro to no-op outside intro');
        assert(sm.state === 'gameplay', 'expected gameplay state to be unchanged');
    });

    test('completePhase closing advances solved toward reset', async () => {
        const sm = createIntroMachine({ intro: { duration: 1, sequence: 'noop' } });
        sm.phases.solved = { duration: 5, sequence: 'noop' };
        sm.state = 'solved';
        sm.currentPhase = 'solved';

        const ok = await sm.completePhase('closing');
        assert(ok === true, 'expected completePhase closing to succeed from solved');
        assert(sm.state !== 'solved', 'expected to leave the solved closing phase');
    });

    test('completePhase reset returns to ready', async () => {
        const sm = createIntroMachine({ intro: { duration: 1, sequence: 'noop' } });
        sm.state = 'reset';
        sm.currentPhase = 'reset';

        const ok = await sm.completePhase('reset');
        assert(ok === true, 'expected completePhase reset to succeed');
        assert(sm.state === 'ready', 'expected reset to complete to ready');
    });

    test('completePhase rejects unknown targets and wrong-phase closing', async () => {
        const sm = createIntroMachine({ intro: { duration: 1, sequence: 'noop' } });
        sm.state = 'intro';
        sm.currentPhase = 'intro';

        assert(await sm.completePhase('gameplay') === false, 'expected unknown complete target to fail');
        assert(await sm.completePhase('closing') === false, 'expected complete closing to no-op in intro');
        assert(sm.state === 'intro', 'expected intro state to be unchanged');
    });
});
