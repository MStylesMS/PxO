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
                        testcue: [
                            { zone: 'mirror', command: 'playVideo', file: 'test.mp4' },
                            { command: 'publish', topic: 'paradox/test', payload: 'hello' }
                        ],
                        imagecue: { zone: 'mirror', command: 'setImage', file: 'logo-solved' },
                        scenecue: { zone: 'lights', command: 'setScene', scene: 'bright' }
                    }
                }
            },
            mqtt
        });

        // Inject mock adapters via zones registry
        mirrorAdapter = { playVideo: jest.fn() };
        lightsAdapter = { setScene: jest.fn() };
        gsm.zones.getZone = (zone) => {
            if (zone === 'mirror') return mirrorAdapter;
            if (zone === 'lights') return lightsAdapter;
            return null;
        };
        gsm.zones.validateZone = (zone) => {
            if (zone === 'mirror') return mirrorAdapter;
            if (zone === 'lights') return lightsAdapter;
            return null;
        };
        gsm.zones.execute = jest.fn();
    });

    it('should dispatch video and publish actions', async () => {
        await gsm.fireCueByName('testcue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('mirror', 'playVideo', { file: 'test.mp4' });
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/test', 'hello');
    });

    it('should resolve media aliases from global.media for command actions', async () => {
        await gsm.fireCueByName('imagecue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('mirror', 'setImage', {
            file: 'images/Agent22-green-white.png'
        });
    });

    it('should dispatch direct scene commands', async () => {
        await gsm.fireCueByName('scenecue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('lights', 'setScene', { scene: 'bright' });
    });
});
