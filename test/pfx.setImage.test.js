/* Minimal node-style test for PFX adapter setImage and playVideo */
const assert = require('assert');
const PfxAdapter = require('../src/adapters/pfx');

function makeMockMqtt() {
    const pub = [];
    return {
        published: pub,
        publish(topic, message) { pub.push({ topic, message }); },
        subscribe() { },
        on() { },
        removeListener() { }
    };
}

(function run() {
    const mqtt = makeMockMqtt();
    const pfx = new PfxAdapter(mqtt, { baseTopic: 'paradox/houdini/mirror' });

    // setImage should publish to {base}/commands with {command:'setImage', file:'...'}
    pfx.setImage('black_screen.png');
    assert.equal(mqtt.published.length, 1, 'expected one publish');
    assert.equal(mqtt.published[0].topic, 'paradox/houdini/mirror/commands');
    assert.deepEqual(mqtt.published[0].message, { command: 'setImage', file: 'black_screen.png' });

    // playVideo sanity
    pfx.playVideo('intro_demo.mp4', { volumeAdjust: -10 });
    assert.equal(mqtt.published.length, 2, 'expected second publish');
    assert.equal(mqtt.published[1].topic, 'paradox/houdini/mirror/commands');
    assert.deepEqual(mqtt.published[1].message, { command: 'playVideo', file: 'intro_demo.mp4', volumeAdjust: -10 });

    console.log('pfx.setImage.test.js PASS');
})();
