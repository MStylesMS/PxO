const SequenceRunner = require('../src/sequenceRunner');

function makeMockMqtt() {
    const published = [];
    return {
        published,
        publish(topic, payload) {
            published.push({ topic, payload });
        },
        subscribe() { },
        on() { },
        removeListener() { }
    };
}

function makeCfg() {
    return {
        global: {
            mqtt: { 'game-topic': 'paradox/houdini' },
            settings: { 'sequence-max-depth': 3 }
        },
        game: {}
    };
}

describe('SequenceRunner publish integration', () => {
    test('executes publish steps with the canonical command key', async () => {
        const mqtt = makeMockMqtt();
        const runner = new SequenceRunner({ cfg: makeCfg(), clock: {}, zones: null, mqtt, lights: {} });
        const seq = {
            meta: { description: 'test' },
            sequence: [{ command: 'publish', topic: 'paradox/test', payload: { ok: true } }]
        };

        const res = await runner.runInlineSequence('inline-publish', seq, { gameMode: 'hc-demo' });

        expect(res.ok).toBe(true);
        expect(mqtt.published).toEqual(expect.arrayContaining([
            { topic: 'paradox/test', payload: JSON.stringify({ ok: true }) }
        ]));
        expect(mqtt.published.filter(entry => entry.topic === 'paradox/test')).toHaveLength(1);
    });

    test('executes mqtt-raw zone steps without requiring a command key', async () => {
        const mqtt = makeMockMqtt();
        const zones = {
            getZone: jest.fn().mockReturnValue({ zoneType: 'mqtt-raw' }),
            execute: jest.fn().mockResolvedValue(undefined)
        };
        const runner = new SequenceRunner({ cfg: makeCfg(), clock: {}, zones, mqtt, lights: {} });
        const seq = {
            meta: { description: 'mqtt-raw test' },
            sequence: [{ zone: 'door-lock', payload: '1' }]
        };

        const res = await runner.runInlineSequence('inline-raw-zone', seq, { gameMode: 'hc-demo' });

        expect(res.ok).toBe(true);
        expect(zones.execute).toHaveBeenCalledWith('door-lock', undefined, { payload: '1' });
    });
});