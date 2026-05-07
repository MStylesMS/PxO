/* Test SequenceRunner executes setImage steps using PFX adapter */
const assert = require('assert');
const SequenceRunner = require('../src/sequenceRunner');
const AdapterRegistry = require('../src/adapters/adapterRegistry');

function makeMockMqtt() {
    return { publish() { }, subscribe() { }, on() { }, removeListener() { } };
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

describe('SequenceRunner setImage integration', () => {
    test('executes setImage steps through the PFX adapter', async () => {
        const mqtt = makeMockMqtt();
        const zonesCfg = {
            mirror: { type: 'pfx-media', 'base-topic': 'paradox/houdini/mirror' }
        };
        const registry = new AdapterRegistry(mqtt, zonesCfg);

        const calls = [];
        const mirror = registry.getZone('mirror');
        const orig = mirror.setImage.bind(mirror);
        mirror.setImage = (img) => {
            calls.push(img);
            orig(img);
        };

        const runner = new SequenceRunner({ cfg: makeCfg(), clock: {}, zones: registry, mqtt, lights: {} });
        const seq = {
            meta: { description: 'test' },
            sequence: [{ zone: 'mirror', command: 'setImage', file: 'black.png' }]
        };

        const res = await runner.runInlineSequence('inline-setImage', seq, { gameMode: 'hc-demo' });
        expect(res.ok).toBe(true);
        assert.equal(calls.length, 1, 'mirror.setImage should be called once');
        assert.equal(calls[0], 'black.png');
    });
});
