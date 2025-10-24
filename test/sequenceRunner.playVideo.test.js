/* Test SequenceRunner executes playVideo steps using PFX adapter */
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

(function run() {
    const mqtt = makeMockMqtt();
    const zonesCfg = {
        picture: { type: 'pfx-media', 'base-topic': 'paradox/houdini/picture' }
    };
    const registry = new AdapterRegistry(mqtt, zonesCfg);

    const calls = [];
    // Monkey-patch picture.playVideo to capture calls and args
    const picture = registry.getZone('picture');
    const orig = picture.playVideo.bind(picture);
    picture.playVideo = (file, opts) => { calls.push({ file, opts }); orig(file, opts); };

    const runner = new SequenceRunner({ cfg: makeCfg(), clock: {}, zones: registry, mqtt, lights: {} });

    const seq = {
        meta: { description: 'test' }, sequence: [
            { step: 1, command: 'playVideo', targets: [{ zone: 'picture', file: 'intro.mp4', volumeAdjust: -5 }] }
        ]
    };

    runner.runInlineSequence('inline-playVideo', seq, { gameMode: 'hc-demo' }).then(res => {
        if (!res.ok) throw new Error('sequence failed');
        assert.equal(calls.length, 1, 'picture.playVideo should be called once');
        assert.equal(calls[0].file, 'intro.mp4');
        assert.equal(calls[0].opts.volumeAdjust, -5);
        console.log('sequenceRunner.playVideo.test.js PASS');
    }).catch(err => { console.error(err); process.exit(1); });
})();
