const log = require('../logger');

/**
 * Generic MQTT zone adapter.
 *
 * Forwards arbitrary commands to {baseTopic}/commands as-is:
 *   { command: "<name>", ...options }
 *
 * Use zone type "mqtt" in EDN config for any device that speaks the
 * standard Paradox command envelope but has no dedicated PxO adapter.
 * Example: ESP32 prop devices such as the Paradox Bomb Prop (suitcase).
 */
class GenericMqttAdapter {
  constructor(mqtt, topics) {
    this.mqtt = mqtt;
    this.commandTopic = `${topics.baseTopic}/commands`;
    log.debug(`GenericMqttAdapter initialized with commandTopic: ${this.commandTopic}`);
  }

  execute(command, options = {}) {
    log.debug(`GenericMqttAdapter.execute: command='${command}', options=${JSON.stringify(options)}`);
    const payload = { command, ...options };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(payload)}`);
    this.mqtt.publish(this.commandTopic, payload);
  }
}

module.exports = GenericMqttAdapter;
