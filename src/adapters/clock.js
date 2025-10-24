const log = require('../logger');

class ClockAdapter {
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
        case 'pause':
          return this.pause();
        case 'resume':
          return this.resume(options.time);
        case 'fade-in':
        case 'fadeIn':
          return this.fadeIn(options.duration);
        case 'fade-out':
        case 'fadeOut':
          return this.fadeOut(options.duration);
        case 'set-time':
        case 'setTime':
          return this.setTime(options.time || options.mmss);
        case 'hint':
          return this.hint(options.text, options.duration);
        default:
          throw new Error(`Unknown command '${command}' for ClockAdapter`);
      }
    } catch (error) {
      if (logger) {
        logger.error(`ClockAdapter command '${command}' failed:`, error.message);
      }
      throw error;
    }
  }

  /**
   * Get supported commands for this adapter
   * @returns {string[]} Array of supported command names
   */
  getCapabilities() {
    return ['start', 'pause', 'resume', 'fade-in', 'fadeIn', 'fade-out', 'fadeOut', 'set-time', 'setTime', 'hint'];
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

  _mirrorUI(payload) {
    if (!this.mirrorUI || !this.gameTopic) return;
    try { this.mqtt.publish(`${this.gameTopic}/clock`, payload); } catch (_) { /* ignore */ }
  }

  setTime(mmss) {
    const time = mmss || this._deriveCurrentMMSS();
    const payload = time ? { command: 'setTime', time } : { command: 'setTime' };
    this._publish(this.commandTopic, payload);
    this._mirrorUI({ action: 'setTime', time });
  }

  command(cmd, mmss, extra = {}) {
    const payload = { command: cmd, ...extra };
    if (mmss) payload.time = mmss;
    this._publish(this.commandTopic, payload);
    // Mirror only fade and start/resume/setTime as UI actions
    if (cmd === 'fadeIn' || cmd === 'fadeOut') this._mirrorUI({ action: cmd, ...extra });
    if (cmd === 'start' || cmd === 'resume' || cmd === 'setTime') this._mirrorUI({ action: cmd, time: payload.time });
  }

  fadeIn(duration) {
    const dur = duration ?? (this.defaultFadeMs ? this.defaultFadeMs / 1000 : undefined);
    this.command('fadeIn', null, dur ? { duration: dur } : {});
  }
  fadeOut(duration) {
    const dur = duration ?? (this.defaultFadeMs ? this.defaultFadeMs / 1000 : undefined);
    this.command('fadeOut', null, dur ? { duration: dur } : {});
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
    this._mirrorUI({ action: 'resume', time: t });
  }
  start(time) {
    // time may be mm:ss string; if omitted, derive from engine
    const t = time || this._deriveCurrentMMSS();
    const payload = { command: 'start' };
    if (t) payload.time = t;
    this._publish(this.commandTopic, payload);
    this._mirrorUI({ action: 'start', time: t });
  }
  hint(text, duration) {
    const payload = { hint: text };
    if (duration) payload.duration = duration;
    this._publish(this.commandTopic, payload);
    this._mirrorUI({ action: 'hint', text, duration });
  }
}

module.exports = ClockAdapter;
