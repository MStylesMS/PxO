const mqtt = require('mqtt');
const EventEmitter = require('events');
const log = require('./logger');

class MqttClient extends EventEmitter {
  constructor(brokerUrl, options = {}) {
    super();
    this.brokerUrl = brokerUrl;
    this.options = { reconnectPeriod: 2000, ...options };
    this.client = null;
    this.subscriptions = new Set();
    
    // Increase max listeners to prevent warnings
    this.setMaxListeners(0); // 0 = unlimited
  }

  connect() {
    // Clean up any existing connection first
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }

    this.client = mqtt.connect(this.brokerUrl, this.options);

    this.client.on('connect', () => {
      log.info('MQTT connected:', this.brokerUrl);
      // resubscribe
      for (const topic of this.subscriptions) {
        this.client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) log.warn('Resubscribe error for', topic, err.message);
        });
      }
      this.emit('connected');
    });

    this.client.on('reconnect', () => log.debug('MQTT reconnecting...'));
    this.client.on('close', () => log.warn('MQTT connection closed'));
    this.client.on('error', (err) => log.error('MQTT error:', err.message));

    this.client.on('message', (topic, payload) => {
      const str = payload ? payload.toString() : '';
      let json = null;
      try {
        json = str ? JSON.parse(str) : null;
      } catch (e) {
        // leave as string
      }
      this.emit('message', topic, json ?? str);
    });

    return this;
  }

  subscribe(topic) {
    if (!this.client) throw new Error('MQTT not connected');
    this.subscriptions.add(topic);
    this.client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) log.error('Subscribe error for', topic, err.message);
    });
  }

  disconnect() {
    if (this.client) {
      log.info('Disconnecting MQTT client');
      this.client.end(true); // Force disconnect
      this.client = null;
    }
  }

  publish(topic, payloadObj, opts = {}) {
    if (!this.client) throw new Error('MQTT not connected');
    const data = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
    const options = { qos: 0, retain: false, ...opts };
    this.client.publish(topic, data, options, (err) => {
      if (err) log.error('Publish error to', topic, err.message);
    });
  }
}

module.exports = MqttClient;
