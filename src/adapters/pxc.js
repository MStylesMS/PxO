const log = require('../logger');

class PxcAdapter {
  constructor(mqtt, topics, opts = {}) {
    this.mqtt = mqtt;
    this.commandTopic = `${topics.clock.baseTopic}/commands`;
    this.stateTopic = `${topics.clock.baseTopic}/state`;
    this.eventsTopic = `${topics.clock.baseTopic}/events`;
    this.warningsTopic = `${topics.clock.baseTopic}/warnings`;
    // Optional extras
    this.provider = opts.provider; // { getGameState, getRemaining, getResetRemaining, secondsToMMSS }
    this.defaultFadeMs = (opts.defaultFadeMs && Number(opts.defaultFadeMs)) || undefined;
    this.gameTopic = opts.gameTopic || null;
    this.mirrorUI = opts.mirrorUI === true;
  }

  /**
   * Generic execute method for unified command interface
   * @param {string} command - Command to execute
   * @param {object} options - Command options
   * @param {object} context - Adapter context (logger, mqtt, etc.)
   * @returns {Promise<any>} Command result
   */
  async execute(command, options = {}, context = {}) {
    const { logger } = context;

    try {
      switch (command) {
        case 'start':
          return this.start(options.time);
        case 'stop':
          return this.stop();
        case 'pause':
          return this.pause();
        case 'resume':
          return this.resume(options.time);
        case 'show':
          return this.show();
        case 'hide':
          return this.hide();
        case 'fade-in':
        case 'fadeIn':
          return this.fadeIn(options);
        case 'fade-out':
        case 'fadeOut':
          return this.fadeOut(options);
        case 'set-time':
        case 'setTime':
          return this.setTime(options.time || options.mmss);
        case 'hint':
          return this.hint(options.text, options.duration);
        case 'setDisplayColors':
          return this.setDisplayColors(options);
        case 'resetDisplayColors':
          return this.resetDisplayColors();
        default:
          throw new Error(`Unknown command '${command}' for PxcAdapter`);
      }
    } catch (error) {
      if (logger) {
        logger.error(`PxcAdapter command '${command}' failed:`, error.message);
      }
      throw error;
    }
  }

  /**
   * Get supported commands for this adapter
   * @returns {string[]} Array of supported command names
   */
  getCapabilities() {
    return ['start', 'stop', 'pause', 'resume', 'show', 'hide', 'fadeIn', 'fadeOut', 'setTime', 'hint', 'setDisplayColors', 'resetDisplayColors'];
  }

  // Helper to derive current mm:ss based on game state
  _deriveCurrentMMSS() {
    if (!this.provider) return null;
    try {
      const state = this.provider.getGameState && this.provider.getGameState();
      const toMMSS = this.provider.secondsToMMSS || ((s) => s);
      if (state === 'gameplay' || state === 'intro' || state === 'paused') {
        const sec = this.provider.getRemaining && this.provider.getRemaining();
        if (typeof sec === 'number') return toMMSS(sec);
      }
      if (state === 'solved' || state === 'failed') {
        const sec = this.provider.getResetRemaining && this.provider.getResetRemaining();
        if (typeof sec === 'number') return toMMSS(sec);
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  _publish(topic, payload) {
    try { this.mqtt.publish(topic, payload); } catch (_) { /* ignore */ }
  }

  setTime(mmss) {
    const time = mmss || this._deriveCurrentMMSS();
    const payload = time ? { command: 'setTime', time } : { command: 'setTime' };
    this._publish(this.commandTopic, payload);
  }

  _resolveFadeDuration(durationOrOptions) {
    if (typeof durationOrOptions === 'number') return durationOrOptions;

    if (durationOrOptions && typeof durationOrOptions === 'object') {
      if (durationOrOptions.duration !== undefined) return durationOrOptions.duration;
      if (durationOrOptions.fadeTime !== undefined) return durationOrOptions.fadeTime;
    }

    if (this.defaultFadeMs) return this.defaultFadeMs / 1000;
    return undefined;
  }

  command(cmd, mmss, extra = {}) {
    const payload = { command: cmd, ...extra };
    if (mmss) payload.time = mmss;
    this._publish(this.commandTopic, payload);
  }

  show() {
    this.command('show');
  }

  hide() {
    this.command('hide');
  }

  fadeIn(durationOrOptions) {
    const dur = this._resolveFadeDuration(durationOrOptions);
    this.command('fadeIn', null, dur !== undefined ? { duration: dur } : {});
  }

  fadeOut(durationOrOptions) {
    const dur = this._resolveFadeDuration(durationOrOptions);
    this.command('fadeOut', null, dur !== undefined ? { duration: dur } : {});
  }

  pause() {
    this.command('pause');
  }
  resume(time) {
    // time may be mm:ss string; if omitted, derive from engine
    const t = time || this._deriveCurrentMMSS();
    const payload = { command: 'resume' };
    if (t) payload.time = t;
    this._publish(this.commandTopic, payload);
  }
  start(time) {
    // time may be mm:ss string; if omitted, derive from engine
    const t = time || this._deriveCurrentMMSS();
    const payload = { command: 'start' };
    if (t) payload.time = t;
    this._publish(this.commandTopic, payload);
  }
  stop() {
    this.command('stop');
  }
  hint(text, duration) {
    const payload = { hint: text };
    if (duration) payload.duration = duration;
    this._publish(this.commandTopic, payload);
  }

  /**
   * Set display colors (backgroundColor, textColor, textAlpha, fadeTime)
   * Corresponds to PxC MQTT command: {"command":"setDisplayColors",...}
   */
  setDisplayColors(options = {}) {
    const payload = { command: 'setDisplayColors' };
    if (options.backgroundColor !== undefined) payload.backgroundColor = options.backgroundColor;
    if (options.textColor !== undefined) payload.textColor = options.textColor;
    if (options.textAlpha !== undefined) payload.textAlpha = options.textAlpha;
    if (options.fadeTime !== undefined) payload.fadeTime = options.fadeTime;
    this._publish(this.commandTopic, payload);
  }

  /**
   * Reset display colors to built-in defaults
   * Corresponds to PxC MQTT command: {"command":"resetDisplayColors"}
   */
  resetDisplayColors() {
    this._publish(this.commandTopic, { command: 'resetDisplayColors' });
  }
}

module.exports = PxcAdapter;
