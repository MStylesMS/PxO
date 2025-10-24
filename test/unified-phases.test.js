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
            global: { mqtt: { 'game-topic': 'game' }, sequences: { 'test-sequence': { sequence: [{ step: 1, command: 'showBrowser' }] } } },
            game: {}
        };
        const sm = new StateMachine({ cfg: config, mqtt: { publish: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { } }, lights: { scene: () => { } } });
        const seq = sm.sequenceRunner.resolveSequence('test-sequence', null);
        assert(seq, 'expected sequence to be resolved');
        assert(seq.sequence && seq.sequence[0].command === 'showBrowser', 'unexpected command');
    });

    test('handles inline sequence array', () => {
        const inline = [{ step: 1, command: 'showBrowser' }];
        const resolved = stateMachine.sequenceRunner.resolveSequence(inline, null);
        assert(Array.isArray(resolved.sequence) && resolved.sequence.length === 1, 'inline resolution failed');
    });

    test('executes step with wait property', async () => {
        const seqDef = { sequence: [{ step: 1, command: 'fadeInClock', duration: 0.01, wait: true }] };
        const res = await stateMachine.sequenceRunner.runInlineSequence('inline-test', seqDef, {});
        assert(res.ok === true, 'sequence did not complete successfully');
    });

    test('stateMachine.executePhase runs named sequence then schedule', async () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { } }, lights: { scene: () => { } }, media: {} });
        // Monkeypatch sequenceRunner
        let ranNamed = false;
        sm.sequenceRunner.runControlSequence = async (name, ctx) => { ranNamed = name; };
        let ranSchedule = false;
        sm.executeSchedule = async (schedule, duration) => { ranSchedule = true; };

        await sm.executePhase('phase-1', { sequence: 'global-test-seq', schedule: [{ at: 0 }], duration: 1 });
        assert(ranNamed === 'global-test-seq');
        assert(ranSchedule === true);
    });

    test('stateMachine.executePhase runs inline sequence then waits when only duration present', async () => {
        const sm = new StateMachine({ cfg, mqtt: { publish: () => { }, subscribe: () => { }, on: () => { } }, clock: { fadeIn: () => { }, fadeOut: () => { }, pause: () => { }, resume: () => { }, setTime: () => { }, hint: () => { } }, lights: { scene: () => { } }, media: {} });
        let ranInline = false;
        sm.sequenceRunner.runInlineSequence = async (name, seqDef, ctx) => { ranInline = name; };
        let waited = false;
        sm.wait = async (ms) => { waited = ms; };

        // ensure a predictable gameType for sequence name formatting
        sm.gameType = 'test';
        await sm.executePhase('phase-2', { sequence: [{ command: 'noop', duration: 0.1 }], duration: 1 });
        assert(ranInline && ranInline.indexOf(':phase-2') !== -1, `expected inline run name to contain ':phase-2', got ${ranInline}`);
        // Also verify calculatePhaseDuration returns an estimate for the inline sequence
        const d = sm.calculatePhaseDuration({ sequence: [{ command: 'noop', duration: 0.5 }] });
        assert(typeof d === 'number');

        // Now call executePhase with only duration
        await sm.executePhase('phase-3', { duration: 0.2 });
        // our overridden wait records ms
        assert(waited === 200);
    });
});
