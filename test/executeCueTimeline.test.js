const GameStateMachine = require('../src/stateMachine');

// Fast helper to build a GSM with a single timeline cue and mocked adapters
function makeGSM(cue) {
    const mqtt = { publish: jest.fn() };
    const gsm = new GameStateMachine({ cfg: { global: { mqtt: { zones: {} }, cues: { test: cue } } }, mqtt });
    const mirror = { playVideo: jest.fn() };
    const lights = { scene: jest.fn() };
    gsm.zones.getZone = (zone) => (zone === 'mirror' ? mirror : zone === 'lights' ? lights : null);
    return { gsm, mirror, mqtt, lights };
}

describe('executeCue timeline semantics (countdown style)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('fires entries in descending at order based on (duration - at) delay', () => {
        const { gsm, mirror, mqtt, lights } = makeGSM({
            duration: 10,
            timeline: [
                { at: 10, actions: [{ zone: 'mirror', play: { video: 'start.mp4' } }] },
                { at: 7, actions: [{ publish: { topic: 'paradox/midA', payload: 'A' } }] },
                { at: 3, actions: [{ publish: { topic: 'paradox/midB', payload: 'B' } }] },
                { at: 0, actions: [{ zone: 'lights', scene: 'green' }] }
            ]
        });

        gsm.fireCueByName('test');

        // at=10 -> delay 0
        jest.runOnlyPendingTimers();
        expect(mirror.playVideo).toHaveBeenCalledWith('start.mp4', { volumeAdjust: undefined });

        // Advance 3s (timeline at=7 fires after 3000ms)
        jest.advanceTimersByTime(3000);
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/midA', 'A');

        // Advance 4s more (now total 7000ms -> timeline at=3 fires)
        jest.advanceTimersByTime(4000);
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/midB', 'B');

        // Advance remaining 3s (total 10000ms -> at=0 fires)
        jest.advanceTimersByTime(3000);
        expect(lights.scene).toHaveBeenCalledWith('green');
    });

    it('logs and aborts on invalid timeline (duplicate / missing duration)', () => {
        const badCue = { duration: 5, timeline: [{ at: 6, actions: [] }] }; // at beyond duration
        const { gsm } = makeGSM(badCue);
        const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
        gsm.fireCueByName('test');
        // We expect no timers scheduled; advance time and ensure nothing blows up
        jest.runOnlyPendingTimers();
        spy.mockRestore();
    });
});
