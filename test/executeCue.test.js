const GameStateMachine = require('../src/stateMachine');

describe('GameStateMachine fireCueByName', () => {
    let gsm, mqtt, mirrorAdapter, lightsAdapter;

    beforeEach(() => {
        mqtt = { publish: jest.fn() };
        // Minimal config with global cues
        gsm = new GameStateMachine({
            cfg: {
                global: {
                    mqtt: { zones: {} },
                    media: {
                        'logo-solved': 'images/Agent22-green-white.png'
                    },
                    cues: {
                        testcue: {
                            actions: [
                                { zone: 'mirror', play: { video: 'test.mp4' } },
                                { publish: { topic: 'paradox/test', payload: 'hello' } }
                            ]
                        },
                        imagecue: {
                            actions: [
                                { zone: 'mirror', command: 'setImage', file: 'logo-solved' }
                            ]
                        },
                        timelinecue: {
                            duration: 10,
                            timeline: [
                                { at: 10, actions: [{ zone: 'mirror', play: { video: 'start.mp4' } }] },
                                { at: 5, actions: [{ publish: { topic: 'paradox/mid', payload: 'midway' } }] },
                                { at: 0, actions: [{ zone: 'lights', scene: 'bright' }] }
                            ]
                        }
                    }
                }
            },
            mqtt
        });

        // Inject mock adapters via zones registry
        mirrorAdapter = { playVideo: jest.fn() };
        lightsAdapter = { scene: jest.fn() };
        gsm.zones.getZone = (zone) => {
            if (zone === 'mirror') return mirrorAdapter;
            if (zone === 'lights') return lightsAdapter;
            return null;
        };
        gsm.zones.execute = jest.fn();
    });

    it('should dispatch video and publish actions', () => {
        gsm.fireCueByName('testcue');
        expect(mirrorAdapter.playVideo).toHaveBeenCalledWith('test.mp4', { volumeAdjust: undefined });
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/test', 'hello');
    });

    it('should schedule and execute timeline actions', () => {
        jest.useFakeTimers();
        gsm.fireCueByName('timelinecue');
        // Run pending timers (delay 0ms for at=10)
        jest.runOnlyPendingTimers();
        expect(mirrorAdapter.playVideo).toHaveBeenCalledWith('start.mp4', { volumeAdjust: undefined });
        // Advance to 5s (5000ms delay for at=5)
        jest.advanceTimersByTime(5000);
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/mid', 'midway');
        // Advance to 10s (10000ms delay for at=0)
        jest.advanceTimersByTime(5000);
        expect(lightsAdapter.scene).toHaveBeenCalledWith('bright');
        jest.useRealTimers();
    });

    it('should resolve media aliases from global.media for command actions', () => {
        gsm.fireCueByName('imagecue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('mirror', 'setImage', {
            file: 'images/Agent22-green-white.png'
        });
    });
});
