const log = require('../logger');

/**
 * Generic raw MQTT zone adapter.
 *
 * Publishes the provided payload directly to the configured base topic with no
 * Paradox command envelope. Use zone type "mqtt-raw" for devices that expect
 * a bare string/number/object payload on a single topic.
 */
class GenericMqttRawAdapter {
  constructor(mqtt, topics) {
    this.mqtt = mqtt;
    this.publishTopic = topics.baseTopic;
    log.debug(`GenericMqttRawAdapter initialized with publishTopic: ${this.publishTopic}`);
  }

  execute(_command, options = {}) {
    const payload = options.payload !== undefined ? options.payload : options.message;
    if (payload === undefined) {
      throw new Error('mqtt-raw zone requires payload or message');
    }

    const publishOptions = {};
    if (options.qos !== undefined) publishOptions.qos = options.qos;
    if (options.retain !== undefined) publishOptions.retain = options.retain;

    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    log.info(`[MQTT-RAW] ${this.publishTopic} → ${body}`);
    this.mqtt.publish(this.publishTopic, payload, publishOptions);
  }
}

module.exports = GenericMqttRawAdapter;