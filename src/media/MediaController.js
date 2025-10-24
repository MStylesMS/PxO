const log = require('../logger');

class MediaController {
  constructor(registry) {
    this.registry = registry;
    this._rebuildCapabilityIndex();
  }

  _rebuildCapabilityIndex() {
    this.capIndex = {}; // capability -> [ids]
    this.registry.getAll().forEach(p => {
      (p.capabilities || []).forEach(cap => {
        if (!this.capIndex[cap]) this.capIndex[cap] = [];
        this.capIndex[cap].push(p.id);
      });
    });
  }

  idsWith(capability) { return this.capIndex[capability] || []; }
  get(targetId) { return this.registry.get(targetId); }

  _pick(cap) {
    const ids = this.idsWith(cap);
    return ids.length ? this.get(ids[0]) : undefined;
  }

  // High-level operations with optional explicit target
  playVideo(file, { target, ...opts } = {}) {
    const player = target ? this.get(target) : this._pick('video');
    if (!player || !player.playVideo) { log.warn('playVideo: no suitable player'); return; }
    return player.playVideo(file, opts);
  }
  setImage(file, { target, ...opts } = {}) {
    const player = target ? this.get(target) : this._pick('image');
    if (!player || !player.setImage) { log.warn('setImage: no suitable player'); return; }
    return player.setImage(file, opts);
  }
  showBrowser({ target } = {}) {
    const player = target ? this.get(target) : this._pick('browser');
    if (!player || !player.showBrowser) { log.warn('showBrowser: no suitable player'); return; }
    return player.showBrowser();
  }
  hideBrowser({ target } = {}) {
    const player = target ? this.get(target) : this._pick('browser');
    if (!player || !player.hideBrowser) { log.warn('hideBrowser: no suitable player'); return; }
    return player.hideBrowser();
  }
  playBackground(file, { target, loop = true, ...opts } = {}) {
    // Prefer audio background, then screen
    let player = target ? this.get(target) : (this._pick('background-audio') || this._pick('video'));
    if (!player || !player.playBackground) { log.warn('playBackground: no suitable player'); return; }
    return player.playBackground(file, loop, opts);
  }
  playAudioFX(file, { target, ...opts } = {}) {
    const player = target ? this.get(target) : this._pick('audio-fx');
    if (!player || !player.playAudioFX) { log.warn('playAudioFX: no suitable player'); return; }
    return player.playAudioFX(file, opts);
  }
  playSpeech(file, { target, ...opts } = {}) {
    const player = target ? this.get(target) : (this._pick('speech') || this._pick('audio-fx'));
    if (!player || !player.playSpeech) { log.warn('playSpeech: no suitable player'); return; }
    return player.playSpeech(file, opts);
  }
  // Stop all media across all players, or a single target if provided
  stopAll({ target, fadeTime } = {}) {
    if (target) {
      const p = this.get(target);
      if (p && p.stopAll) return p.stopAll(fadeTime);
      return Promise.resolve();
    }
    return Promise.all(this.registry.getAll().map(p => p.stopAll ? p.stopAll(fadeTime) : Promise.resolve()));
  }

  stopBackground({ target, fadeTime } = {}) {
    const p = target ? this.get(target) : this._pick('background-audio');
    if (!p || !p.stopBackground) { log.warn('stopBackground: no suitable player'); return; }
    return p.stopBackground(fadeTime);
  }

  stopSpeech({ target, fadeTime } = {}) {
    const p = target ? this.get(target) : this._pick('speech');
    if (!p || !p.stopSpeech) { log.warn('stopSpeech: no suitable player'); return; }
    return p.stopSpeech(fadeTime);
  }

  stopVideo({ target } = {}) {
    const p = target ? this.get(target) : this._pick('video');
    if (!p || !p.stopVideo) { log.warn('stopVideo: no suitable player'); return; }
    return p.stopVideo();
  }

  enableBrowser(url, { target } = {}) {
    const p = target ? this.get(target) : this._pick('browser');
    if (!p || !p.enableBrowser) { log.warn('enableBrowser: no suitable player'); return; }
    return p.enableBrowser(url);
  }

  disableBrowser({ target } = {}) {
    const p = target ? this.get(target) : this._pick('browser');
    if (!p || !p.disableBrowser) { log.warn('disableBrowser: no suitable player'); return; }
    return p.disableBrowser();
  }

  setBrowserUrl(url, { target } = {}) {
    const p = target ? this.get(target) : this._pick('browser');
    if (!p || !p.setBrowserUrl) { log.warn('setBrowserUrl: no suitable player'); return; }
    return p.setBrowserUrl(url);
  }

  setBrowserKeepAlive(enabled = true, interval = 30000, { target } = {}) {
    const p = target ? this.get(target) : this._pick('browser');
    if (!p || !p.setBrowserKeepAlive) { log.warn('setBrowserKeepAlive: no suitable player'); return; }
    return p.setBrowserKeepAlive(enabled, interval);
  }

  setZoneVolume(volume, { target } = {}) {
    const p = target ? this.get(target) : this._pick('background-audio');
    if (!p || !p.setZoneVolume) { log.warn('setZoneVolume: no suitable player'); return; }
    return p.setZoneVolume(volume);
  }

  sleepScreen({ target } = {}) {
    const p = target ? this.get(target) : this._pick('browser');
    if (!p || !p.sleepScreen) { log.warn('sleepScreen: no suitable player'); return; }
    return p.sleepScreen();
  }

  wakeScreen({ target } = {}) {
    const p = target ? this.get(target) : this._pick('browser');
    if (!p || !p.wakeScreen) { log.warn('wakeScreen: no suitable player'); return; }
    return p.wakeScreen();
  }

  killPfx({ target } = {}) {
    const p = target ? this.get(target) : undefined;
    if (!p || !p.killPfx) { log.warn('killPfx: target missing or not supported'); return; }
    return p.killPfx();
  }

  restartPfx({ target } = {}) {
    const p = target ? this.get(target) : undefined;
    if (!p || !p.restartPfx) { log.warn('restartPfx: target missing or not supported'); return; }
    return p.restartPfx();
  }

  shutdown({ target } = {}) {
    const p = target ? this.get(target) : undefined;
    if (!p || !p.shutdown) { log.warn('shutdown: target missing or not supported'); return; }
    return p.shutdown();
  }

  reboot({ target } = {}) {
    const p = target ? this.get(target) : undefined;
    if (!p || !p.reboot) { log.warn('reboot: target missing or not supported'); return; }
    return p.reboot();
  }
}

module.exports = MediaController;
