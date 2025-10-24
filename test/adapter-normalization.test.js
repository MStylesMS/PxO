const { loadConfig } = require('../src/config');

function assert(cond, msg){ if(!cond) throw new Error(msg); }

describe('Adapter normalization', () => {
  test('MQTT base_topic normalization present', () => {
    const cfg = loadConfig('edn');
    const topics = cfg.global.mqtt.topics;
    assert(topics.ui.base_topic, 'ui.base_topic missing');
    assert(topics.clock.base_topic, 'clock.base_topic missing');
    assert(topics.fx.mirror.base_topic, 'mirror.base_topic missing');
  });
});
