const log = require('../logger');

class PfxAdapterBase {
  constructor(mqtt, base) {
    this.mqtt = mqtt;
    this.topics = base; // { baseTopic }
    this.commandTopic = `${base.baseTopic}/commands`;
    this.eventsTopic = `${base.baseTopic}/events`;
    this.stateTopic = `${base.baseTopic}/state`;
    // cache last received state message for this PFX zone
    this._lastState = null;

    // Subscribe to state updates so the game can make smart decisions
    try {
      if (this.mqtt && typeof this.mqtt.subscribe === 'function') {
        this.mqtt.subscribe(this.stateTopic);

        // Set up centralized message routing if not already done
        if (!this.mqtt._pfxMessageHandlerSetup) {
          this.mqtt._pfxAdapters = new Map();
          this.mqtt._pfxMessageHandlerSetup = true;

          log.debug('Setting up centralized MQTT message routing for PFX adapters');

          // Store the message handler reference for cleanup
          this.mqtt._pfxMessageHandler = (topic, payload) => {
            // Route messages to appropriate adapter based on topic
            for (const [stateTopic, adapter] of this.mqtt._pfxAdapters) {
              if (topic === stateTopic) {
                log.debug(`Routing message from ${topic} to adapter`);
                adapter._handleStateMessage(payload);
                break;
              }
            }
          };

          this.mqtt.on('message', this.mqtt._pfxMessageHandler);
        }

        // Register this adapter for its state topic
        this.mqtt._pfxAdapters.set(this.stateTopic, this);
        log.debug(`Registered PFX adapter for topic: ${this.stateTopic}`);
      }
    } catch (e) {
      // non-fatal if mqtt client doesn't support this usage
    }
  }

  execute(command, options = {}) {
    switch (command) {
      case 'playVideo':
        this.playVideo(options.file, options);
        break;

      case 'playBackground':
        this.playBackground(options.file, options.loop, options);
        break;

      case 'playAudioFX':
        this.playAudioFX(options.file, options);
        break;

      case 'playSpeech':
        this.playSpeech(options.file, options);
        break;

      case 'stopAll':
        this.stopAll(options.fadeTime);
        break;

      case 'stopBackground':
        this.stopBackground(options.fadeTime);
        break;

      case 'stopSpeech':
        this.stopSpeech(options.fadeTime);
        break;

      case 'stopAudio':
        this.stopAudio(options.fadeTime);
        break;

      case 'stopVideo':
        this.stopVideo();
        break;

      case 'setImage':
        this.setImage(options.file);
        break;

      case 'setVolume':
        this.setVolume(options.volume, options);
        break;

      case 'enableBrowser':
        this.enableBrowser(options.url);
        break;

      case 'disableBrowser':
        this.disableBrowser();
        break;

      case 'showBrowser':
        this.showBrowser();
        break;

      case 'hideBrowser':
        this.hideBrowser();
        break;

      case 'sleepScreen':
        this.sleepScreen();
        break;

      case 'wakeScreen':
        this.wakeScreen();
        break;

      case 'setBrowserUrl':
        this.setBrowserUrl(options.url);
        break;

      case 'setColorScene':
        this.setColorScene(options.scene || options.sceneId);
        break;

      case 'setColor':
        this.setColor(options.color);
        break;

      case 'shutdown':
        this.shutdown();
        break;

      case 'reboot':
        this.reboot();
        break;

      case 'poweroff':
        this.poweroff();
        break;

      case 'killPfx':
        this.killPfx();
        break;

      case 'restartPfx':
        this.restartPfx();
        break;

      case 'requestState':
        this.requestState();
        break;

      case 'verifyBrowser':
        return this.verifyBrowser(options.url, options.visible, options.timeout);

      case 'verifyImage':
        return this.verifyImage(options, options.timeout);

      default:
        console.warn(`PfxAdapter: Unknown command '${command}'`);
        break;
    }
  }

  getCapabilities() {
    return [
      'playVideo',
      'playBackground',
      'playAudioFX',
      'playSpeech',
      'stopAll',
      'stopBackground',
      'stopSpeech',
      'stopAudio',
      'stopVideo',
      'setImage',
      'setVolume',
      'enableBrowser',
      'disableBrowser',
      'showBrowser',
      'hideBrowser',
      'sleepScreen',
      'wakeScreen',
      'setBrowserUrl',
      'setColorScene',
      'setColor',
      'shutdown',
      'reboot',
      'poweroff',
      'killPfx',
      'restartPfx',
      'requestState',
      'verifyBrowser',
      'verifyImage'
    ];
  }

  _handleStateMessage(payload) {
    try {
      // The payload could be a string, Buffer, or already parsed object
      let p;
      if (typeof payload === 'string') {
        p = JSON.parse(payload);
      } else if (Buffer.isBuffer(payload)) {
        p = JSON.parse(payload.toString());
      } else {
        // Assume it's already a parsed object (e.g., from VS Code's MQTT client)
        p = payload;
      }

      // New schema expected: keep the parsed object as-is
      this._lastState = p;
      log.debug(`[PFX-${this.topics.baseTopic}] State message received:`, { zone: p.zone, status: p.current_state?.status });
    } catch (e) {
      log.warn(`[PFX-${this.topics.baseTopic}] Failed to parse state message:`, e.message);
    }
  }
  playVideo(file, options = {}) {
    const command = { command: 'playVideo', file };
    // Absolute volume takes priority over relative adjustments
    if (options.volume !== undefined) {
      command.volume = options.volume;
    } else if (options.adjustVolume !== undefined) {
      command.volumeAdjust = options.adjustVolume;
    } else if (options.volumeAdjust !== undefined) {
      command.volumeAdjust = options.volumeAdjust;
    }
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }
  playBackground(file, loop = true, options = {}) {
    const command = { command: 'playBackground', file };
    if (loop !== undefined) command.loop = !!loop;
    // Absolute volume takes priority over relative adjustments
    if (options.volume !== undefined) {
      command.volume = options.volume;
    } else if (options.adjustVolume !== undefined) {
      command.volumeAdjust = options.adjustVolume;
    } else if (options.volumeAdjust !== undefined) {
      command.volumeAdjust = options.volumeAdjust;
    }
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }
  playAudioFX(file, options = {}) {
    const command = { command: 'playAudioFX', audio: file };
    // Absolute volume takes priority over relative adjustments
    if (options.volume !== undefined) {
      command.volume = options.volume;
    } else if (options.adjustVolume !== undefined) {
      command.volumeAdjust = options.adjustVolume;
    } else if (options.volumeAdjust !== undefined) {
      command.volumeAdjust = options.volumeAdjust;
    }
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }
  playSpeech(file, options = {}) {
    const command = { command: 'playSpeech', audio: file };
    // Absolute volume takes priority over relative adjustments
    if (options.volume !== undefined) {
      command.volume = options.volume;
    } else if (options.adjustVolume !== undefined) {
      command.volumeAdjust = options.adjustVolume;
    } else if (options.volumeAdjust !== undefined) {
      command.volumeAdjust = options.volumeAdjust;
    }
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }
  shutdown() {
    const command = { command: 'shutdown' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }
  reboot() {
    const command = { command: 'reboot' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  poweroff() {
    // For full machine shutdown on the device; PFX should implement handling
    const command = { command: 'poweroff' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Startup sequence methods
  stopAll(fadeTime) {
    const command = { command: 'stopAll' };
    if (fadeTime !== undefined) command.fadeTime = fadeTime;
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  stopBackground(fadeTime) {
    const command = { command: 'stopBackground' };
    if (fadeTime !== undefined) command.fadeTime = fadeTime;
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  stopSpeech(fadeTime) {
    const command = { command: 'stopSpeech' };
    if (fadeTime !== undefined) command.fadeTime = fadeTime;
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  stopAudio(fadeTime) {
    const command = { command: 'stopAudio' };
    if (fadeTime !== undefined && fadeTime !== 0) {
      command.fadeTime = fadeTime;
    }
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  stopVideo() {
    const command = { command: 'stopVideo' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  setImage(file) {
    // Use 'file' key consistently for all media commands
    const command = { command: 'setImage', file };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Browser management methods (only applicable to screen zones)
  enableBrowser(url) {
    const command = { command: 'enableBrowser', url: url };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  disableBrowser() {
    const command = { command: 'disableBrowser' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  showBrowser() {
    const command = { command: 'showBrowser' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  hideBrowser() {
    const command = { command: 'hideBrowser' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Screen power management
  sleepScreen() {
    const command = { command: 'sleepScreen' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  wakeScreen() {
    const command = { command: 'wakeScreen' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Extended browser control
  setBrowserUrl(url) {
    const command = { command: 'setBrowserUrl', url: url };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  setBrowserKeepAlive(enabled = true, interval = 30000) {
    const command = {
      command: 'setBrowserKeepAlive',
      enabled: enabled,
      interval: interval
    };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Video playback control - LIMITED: Only basic playback supported
  // Note: pauseVideo, resumeVideo not implemented in current PFX

  // Comprehensive media control - LIMITED: Not implemented in current PFX
  // Note: pauseAll, resumeAll not implemented in current PFX

  // Audio management - LIMITED: Basic audio control only
  // Note: pauseAudio, resumeAudio not implemented in current PFX

  // Zone volume control

  // Generic volume control with type specification
  setVolume(volume, options = {}) {
    const { zone, media, background, speech } = options;
    let command;

    if (media) {
      command = { command: 'setMediaVolume', volume: volume };
    } else if (background) {
      command = { command: 'setBackgroundVolume', volume: volume };
    } else if (speech) {
      command = { command: 'setSpeechVolume', volume: volume };
    } else {
      // Default to zone volume if no specific type specified
      command = { command: 'setZoneVolume', volume: volume };
    }

    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // System control
  killPfx() {
    const command = { command: 'killPfx' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Add restart command for full PFX restart
  restartPfx() {
    const command = { command: 'restartPfx' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Color scene control methods for UI
  setColorScene(sceneId) {
    const command = { command: 'setColorScene', scene: sceneId };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  setColor(color) {
    const command = { command: 'setColor', color: color };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Return the last cached state message (may be null)
  getLastState() {
    return this._lastState;
  }

  // Request immediate state update from PFX
  requestState() {
    const command = { command: 'getState' };
    log.info(`[MQTT] ${this.commandTopic} → ${JSON.stringify(command)}`);
    this.mqtt.publish(this.commandTopic, command);
  }

  // Verify browser state and update as needed
  async verifyBrowser(desiredUrl, desiredVisible = null, timeout = 15000) {
    log.info(`[PFX-${this.topics.baseTopic}] Verifying browser state - URL: ${desiredUrl}, Visible: ${desiredVisible}`);

    const startTime = Date.now();
    const pollInterval = 2000; // Check every 2 seconds
    let changes = { restarted: false, urlChanged: false, visibilityChanged: false };

    while (Date.now() - startTime < timeout) {
      // Request fresh state
      this.requestState();
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for state response

      const state = this.getLastState();
      if (!state) {
        log.warn(`[PFX-${this.topics.baseTopic}] No state received, continuing to poll...`);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        continue;
      }

      // Accept either modern flattened state or nested current_state
      const cs = state.current_state || state;
      const browserState = cs.browser || {};
      let allRequirementsMet = true;

      // Check if browser needs to be enabled
      if (!browserState.enabled) {
        log.info(`[PFX-${this.topics.baseTopic}] Browser not enabled, enabling with URL: ${desiredUrl}`);
        this.enableBrowser(desiredUrl);
        changes.restarted = true;
        allRequirementsMet = false;
      } else {
        // Browser is enabled, check URL if provided
        if (desiredUrl) {
          const currentUrl = String(browserState.url || '').trim();
          const targetUrl = String(desiredUrl || '').trim();
          if (currentUrl !== targetUrl) {
            log.info(`[PFX-${this.topics.baseTopic}] URL mismatch - Current: ${currentUrl}, Desired: ${targetUrl}`);
            this.setBrowserUrl(desiredUrl);
            changes.urlChanged = true;
            allRequirementsMet = false;
          }
        }

        // Check visibility if specified. Support multiple possible fields from PFX
        if (desiredVisible !== null) {
          const currentlyVisible = !!(browserState.visible || browserState.focused || browserState.foreground);
          if (currentlyVisible !== !!desiredVisible) {
            log.info(`[PFX-${this.topics.baseTopic}] Visibility mismatch - Current: ${currentlyVisible}, Desired: ${desiredVisible}`);
            if (desiredVisible) {
              this.showBrowser();
            } else {
              this.hideBrowser();
            }
            changes.visibilityChanged = true;
            allRequirementsMet = false;
          }
        }
      }

      if (allRequirementsMet) {
        log.info(`[PFX-${this.topics.baseTopic}] Browser verification complete`);
        return { ...changes, success: true, timeElapsed: Date.now() - startTime };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    log.warn(`[PFX-${this.topics.baseTopic}] Browser verification timeout after ${timeout}ms`);
    return { ...changes, success: false, timeElapsed: Date.now() - startTime, timedOut: true };
  }

  // Enhanced media verification with automatic setImage and retry logic
  async verifyImage(options = {}, timeout = 15000) {
    const { file } = options;
    if (!file) {
      log.warn(`[PFX-${this.topics.baseTopic}] verifyImage missing file`);
      return { success: false, error: 'missing_file' };
    }
    log.info(`[PFX-${this.topics.baseTopic}] verifyImage check file='${file}'`);

    const start = Date.now();
    const maxDuration = 10000; // Maximum 10 seconds as requested
    const checkInterval = 1000; // Check every 1 second
    let setImageAttempts = 0;

    while (Date.now() - start < maxDuration) {
      // Step 1: Call getState and check if zone already has correct media loaded and showing
      this.requestState();
      await new Promise(r => setTimeout(r, 300)); // Brief wait for state response

      const state = this.getLastState();
      if (state) {
        // Support both nested and flattened state shapes
        const cs = state.current_state || state;
        // Canonical media file - prefer cs.file (single-name regardless of image/video),
        // then cs.video.file, then older currentImage/currentVideo, then mpv_instances files
        const mediaFile = (cs.file) || (cs.video && cs.video.file) || cs.currentImage || cs.currentVideo ||
          (state.mpv_instances && state.mpv_instances.media && state.mpv_instances.media.file) ||
          (state.mpv_instances && state.mpv_instances.background && state.mpv_instances.background.file) || null;

        if (mediaFile === file) {
          log.info(`[PFX-${this.topics.baseTopic}] verifyImage success: file '${file}' verified after ${Date.now() - start}ms`);
          return { success: true, matched: true, timeElapsed: Date.now() - start, setImageAttempts };
        }
      }

      // Step 2: If not correct media, send setImage command
      setImageAttempts++;
      log.info(`[PFX-${this.topics.baseTopic}] verifyImage sending setImage attempt ${setImageAttempts} for file '${file}'`);

      try {
        await this.setImage(file);
      } catch (error) {
        log.warn(`[PFX-${this.topics.baseTopic}] verifyImage setImage failed: ${error.message}`);
      }      // Step 3: Wait about 1 second before checking again
      await new Promise(r => setTimeout(r, checkInterval));
    }

    // Step 4: Maximum 10 seconds exceeded - send warning to /warnings topic
    const warningMessage = `Zone '${this.topics.baseTopic}' failed to verify image after ${maxDuration}ms. Command: setImage, File: '${file}', Attempts: ${setImageAttempts}`;
    log.warn(`[PFX-${this.topics.baseTopic}] ${warningMessage}`);

    // Send warning to game's /warnings topic
    const warningsTopic = this.topics.baseTopic.replace(/\/[^\/]+$/, '') + '/warnings';
    // Publish a warning payload. The in-repo MqttClient provides publish(topic, payloadObj)
    // which is callback-based; wrap it into a Promise so we can await it here.
    const publishWarning = (topic, payload) => {
      return new Promise((resolve) => {
        try {
          if (this.mqtt && typeof this.mqtt.publish === 'function') {
            // mqtt.publish accepts (topic, payloadObj, opts)
            this.mqtt.publish(topic, payload);
            // We don't have a callback for success, resolve immediately
            resolve();
          } else if (this.mqtt && this.mqtt.client && typeof this.mqtt.client.publish === 'function') {
            // Underlying mqtt client may be exposed; use it with callback
            const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
            this.mqtt.client.publish(topic, data, {}, (err) => {
              if (err) log.error(`[PFX-${this.topics.baseTopic}] Publish error to ${topic}: ${err.message}`);
              resolve();
            });
          } else {
            log.warn(`[PFX-${this.topics.baseTopic}] No mqtt publish method available to send warning`);
            resolve();
          }
        } catch (err) {
          log.error(`[PFX-${this.topics.baseTopic}] Exception while publishing warning: ${err.message}`);
          resolve();
        }
      });
    };

    try {
      await publishWarning(warningsTopic, {
        timestamp: new Date().toISOString(),
        zone: this.topics.baseTopic,
        command: 'setImage',
        file: file,
        attempts: setImageAttempts,
        duration: maxDuration,
        message: warningMessage
      });
    } catch (error) {
      log.error(`[PFX-${this.topics.baseTopic}] Failed to publish warning: ${error.message}`);
    }

    return { success: false, timedOut: true, file, setImageAttempts, timeElapsed: Date.now() - start };
  }

  // Cleanup method to remove event listeners and subscriptions
  cleanup() {
    try {
      if (this.mqtt && this.mqtt._pfxAdapters) {
        this.mqtt._pfxAdapters.delete(this.stateTopic);

        // If this was the last adapter, clean up the message handler
        if (this.mqtt._pfxAdapters.size === 0 && this.mqtt._pfxMessageHandler) {
          this.mqtt.removeListener('message', this.mqtt._pfxMessageHandler);
          this.mqtt._pfxMessageHandler = null;
          this.mqtt._pfxMessageHandlerSetup = false;
          log.debug('Cleaned up PFX message routing');
        }
      }
    } catch (e) {
      log.warn('Error during PFX adapter cleanup:', e.message);
    }
  }
}

module.exports = PfxAdapterBase;
