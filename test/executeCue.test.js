const GameStateMachine = require('../src/stateMachine');

describe('GameStateMachine fireCueByName', () => {
    let gsm, mqtt, mirrorAdapter, lightsAdapter, rawAdapter;

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
                        mqttcue: { command: 'publish', topic: 'paradox/test/raw', payload: { ok: true } },
                        rawzonecue: { zone: 'door-lock', payload: '1' },
                        imagecue: { zone: 'mirror', command: 'setImage', file: 'logo-solved' },
                        scenecue: { zone: 'lights', command: 'scene', name: 'bright' }
                    }
                }
            },
            mqtt
        });

        // Inject mock adapters via zones registry
        mirrorAdapter = { playVideo: jest.fn(), zoneType: 'pfx-media' };
        lightsAdapter = { scene: jest.fn(), zoneType: 'mqtt-lights' };
        rawAdapter = { zoneType: 'mqtt-raw' };
        gsm.zones.getZone = (zone) => {
            if (zone === 'mirror') return mirrorAdapter;
            if (zone === 'lights') return lightsAdapter;
            if (zone === 'door-lock') return rawAdapter;
            return null;
        };
        gsm.zones.validateZone = (zone) => {
            if (zone === 'mirror') return mirrorAdapter;
            if (zone === 'lights') return lightsAdapter;
            if (zone === 'door-lock') return rawAdapter;
            return null;
        };
        gsm.zones.execute = jest.fn();
    });

    it('should dispatch video and publish actions', async () => {
        await gsm.fireCueByName('testcue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('mirror', 'playVideo', { file: 'test.mp4' });
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/test', 'hello');
    });

    it('should dispatch raw mqtt cues declared with publish command', async () => {
        await gsm.fireCueByName('mqttcue');
        expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/raw', JSON.stringify({ ok: true }));
    });

    it('should resolve media aliases from global.media for command actions', async () => {
        await gsm.fireCueByName('imagecue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('mirror', 'setImage', {
            file: 'images/Agent22-green-white.png'
        });
    });

    it('should dispatch direct scene commands', async () => {
        await gsm.fireCueByName('scenecue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('lights', 'scene', { name: 'bright' });
    });

    it('should dispatch payload-only mqtt-raw zone cues without a command key', async () => {
        await gsm.fireCueByName('rawzonecue');
        expect(gsm.zones.execute).toHaveBeenCalledWith('door-lock', undefined, { payload: '1' });
    });
});
