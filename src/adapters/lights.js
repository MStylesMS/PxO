const log = require('../logger');

class LightsAdapter {
  constructor(mqtt, topics) {
    this.mqtt = mqtt;
    this.commandTopic = `${topics.lights.baseTopic}/commands`;
    this.stateTopic = `${topics.lights.baseTopic}/state`;
    this._lastScene = undefined;
    log.debug(`LightsAdapter initialized with commandTopic: ${this.commandTopic}`);
  }

  execute(command, options = {}) {
    log.debug(`LightsAdapter.execute: command='${command}', options=${JSON.stringify(options)}`);
    switch (command) {
      case 'scene':
        log.debug(`LightsAdapter.execute: calling scene with name='${options.name || options.scene}'`);
        this.scene(options.name || options.scene);
        break;

      default:
        log.warn(`LightsAdapter: Unknown command '${command}'`);
        break;
    }
  }

  getCapabilities() {
    return ['scene'];
  }

  scene(name) {
    if (!name) {
      log.warn(`LightsAdapter.scene() called with empty name`);
      return;
    }
    if (this._lastScene === name) {
      log.debug(`LightsAdapter: Skipping duplicate scene '${name}'`);
      return; // dedupe identical scenes
    }
    this._lastScene = name;
    const command = { command: "setColorScene", scene: name };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }
}

module.exports = LightsAdapter;
