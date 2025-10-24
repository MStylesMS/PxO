#!/usr/bin/env node

const MqttClient = require('./mqttClient');
const { loadConfig } = require('./config');
const log = require('./logger');
const GameStateMachine = require('./stateMachine');
const { getUiTopics } = require('./engineUtils');
const { loadIniConfig } = require('./ini-config-loader');
const LogCleanup = require('./log-cleanup');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

async function main() {
  // Parse command line arguments
  const argv = minimist(process.argv.slice(2));
  
  // Check for --config option for INI file (infrastructure config)
  const iniConfigPath = argv.config || null;
  const iniConfig = loadIniConfig(iniConfigPath);

  // Set log level from INI config
  if (iniConfig.global.log_level) {
    process.env.LOG_LEVEL = iniConfig.global.log_level;
  }

  // Set up file logging if log_directory is configured
  let logStream = null;
  if (iniConfig.global.log_directory) {
    const logDir = path.resolve(iniConfig.global.log_directory);
    fs.mkdirSync(logDir, { recursive: true });

    // Clean up old logs on startup
    const cleanupResult = await LogCleanup.cleanup(logDir, {
      maxAgeDays: 30,
      maxSizeMB: 100,
      excludeFiles: ['game-latest.log']
    });
    if (cleanupResult.deleted > 0) {
      log.info(`Cleaned up ${cleanupResult.deleted} old log files (kept ${cleanupResult.kept}, total ${cleanupResult.totalSize}MB)`);
    }

    // Create timestamped log file for this session
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const logFile = path.join(logDir, `game-${timestamp}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Also create/update the latest log symlink
    const latestLogFile = path.join(logDir, 'game-latest.log');
    try {
      if (fs.existsSync(latestLogFile)) {
        fs.unlinkSync(latestLogFile);
      }
      fs.symlinkSync(path.basename(logFile), latestLogFile);
    } catch (err) {
      // Ignore symlink errors, just use timestamped file
    }

    // Redirect console output to log file
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args) => {
      origLog(...args);
      logStream.write(args.join(' ') + '\n');
    };
    console.error = (...args) => {
      origError(...args);
      logStream.write(args.join(' ') + '\n');
    };
    console.warn = (...args) => {
      origWarn(...args);
      logStream.write(args.join(' ') + '\n');
    };

    log.info(`Logging to: ${logFile}`);
  } else {
    log.info('File logging disabled (no log_directory configured in INI)');
  }

  // Check for config format from command line or environment (for EDN/JSON game config)
  const configFormat = argv.json || argv._.includes('--json') || process.env.CONFIG_FORMAT === 'json' ? 'json' : 'edn';
  
  // Check for --edn option for EDN file path (game content config)
  const ednConfigPath = argv.edn || null;

  log.info(`Loading configuration in ${configFormat.toUpperCase()} format`);
  const cfg = loadConfig(configFormat, ednConfigPath);
  
  // Override MQTT broker from INI config if provided
  if (iniConfig.mqtt && iniConfig.mqtt.broker) {
    log.info(`Overriding MQTT broker from INI: ${iniConfig.mqtt.broker}`);
    cfg.global.mqtt.broker = iniConfig.mqtt.broker;
  }
  
  // Ensure we have a valid broker URL
  if (!cfg.global.mqtt.broker) {
    log.error('No MQTT broker configured! Check INI file or EDN config.');
    process.exit(1);
  }
  
  log.info(`Connecting to MQTT broker: ${cfg.global.mqtt.broker}`);
  const mqtt = new MqttClient(cfg.global.mqtt.broker).connect();

  // Derive UI topics using shared helper (preserves prior defaults and shapes)
  const uiTopics = getUiTopics(cfg);

  // All adapters are now created dynamically by the AdapterRegistry.
  // The explicit instantiation of ClockAdapter and LightsAdapter is removed.

  // The new AdapterRegistry will handle all adapter instantiation.
  // Legacy media registry is no longer needed.
  // Store UI topics for any code that still needs them during transition
  cfg.global = cfg.global || {};
  cfg.global.mqtt = cfg.global.mqtt || {};
  cfg.global.mqtt.uiTopics = uiTopics;

  const sm = new GameStateMachine({ cfg, mqtt });
  sm.init();

  // Wire logger warn/error events to MQTT warnings topic so UI/operators can be notified
  try {
    const { getWarningsTopic } = require('./engineUtils');
    const warningsTopic = getWarningsTopic(cfg) || (cfg.global.mqtt && cfg.global.mqtt.uiTopics && cfg.global.mqtt.uiTopics.warnings);

    if (warningsTopic) {
      // Publish a human-readable warning when logger emits warn/error
      const publishWarningFromLog = (entry) => {
        try {
          const payload = {
            timestamp: entry.timestamp,
            level: entry.level,
            message: entry.message,
            source: 'logger'
          };
          mqtt.publish(warningsTopic, payload);
        } catch (e) {
          // Avoid throwing from log handlers
          // eslint-disable-next-line no-console
          console.error('[LOGGER-HOOK] Failed to publish warning to', warningsTopic, e && e.message);
        }
      };

      // Subscribe to logger events
      log.on('warn', publishWarningFromLog);
      log.on('error', publishWarningFromLog);
    }
  } catch (e) {
    log.warn('Failed to initialize logger->MQTT warnings bridge', e && e.message);
  }

  // All hint normalization and combination logic is now handled within the state machine
  // The functions normalizeGlobalHint, normalizeGameHint, and combineHints are removed.

  // Initialize trigger system
  const triggerRules = (cfg.global.triggers && cfg.global.triggers.escapeRoomRules) || [];

  function initializeTriggers() {
    triggerRules.forEach(rule => {
      log.info(`Subscribing to trigger: ${rule.name} on topic ${rule.trigger.topic}`);
      mqtt.subscribe(rule.trigger.topic);
    });
  }

  async function handleTrigger(topic, payload, rule) {
    log.info(`Evaluating trigger rule: ${rule.name}`);

    // Check if trigger condition matches
    const condition = rule.trigger.condition;
    let conditionMet = true;

    for (const [key, expectedValue] of Object.entries(condition)) {
      if (payload[key] !== expectedValue) {
        conditionMet = false;
        break;
      }
    }

    if (!conditionMet) {
      log.debug(`Trigger condition not met for ${rule.name}`);
      return;
    }

    log.info(`Trigger activated: ${rule.name} - executing ${rule.actions.length} actions`);

    // Execute all actions for this trigger
    for (const action of rule.actions) {
      try {
        await executeAction(action, rule.name);
      } catch (error) {
        log.error(`Failed to execute action for trigger ${rule.name}:`, error);
      }
    }
  }

  async function executeAction(action, triggerName) {
    log.info(`Executing action type: ${action.type} for trigger: ${triggerName}`);

    switch (action.type) {
      case 'mqtt':
        mqtt.publish(action.topic, action.payload);
        log.info(`Published MQTT: ${action.topic}`, action.payload);
        break;

      case 'game':
        await sm.handleCommand({ command: action.command });
        log.info(`Sent game command: ${action.command}`);
        break;

      // Removed device-specific action types; use generic zone/adapter commands via sequences or state machine

      case 'cue':
        // Fire a named cue via the state machine's cue dispatcher
        sm.fireCueByName(action.cue);
        log.info(`Fired cue: ${action.cue}`);
        break;

      case 'hint':
        // Hint trigger actions are not supported via this path; use a 'cue' or 'game' command instead.
        log.warn(`Unsupported 'hint' action type used in trigger: ${triggerName}. No action taken.`);
        break;

      default:
        log.warn(`Unknown action type: ${action.type}`);
    }
  }

  function publishHintsRegistry() {
    try {
      const gameModes = cfg['game-modes'] || cfg.game || {};
      const mode = sm.currentGameMode || Object.keys(gameModes)[0] || '';
      const gameHints = (gameModes?.[mode]?.hints) || [];
      const entries = sm.getCombinedHints(gameHints) || [];

      // Legacy compatibility: minimal list with id/type/label
      const legacyHints = entries.map(h => ({ id: h.id, type: h.type || 'text', label: (h.displayText || h.id) }));

      const payload = {
        mode,
        entries,
        hints: legacyHints,
        ts: Date.now()
      };
      mqtt.publish(uiTopics.hintsRegistry, payload, { retain: true });
    } catch (e) {
      log.warn('publishHintsRegistry failed', e.message);
    }
  }

  function publishUiConfig() {
    try {
      // Build UI-friendly game configuration from the transformed config
      const gamesForUI = {};
      const gameModes = cfg['game-modes'] || cfg.game || {};

      Object.entries(gameModes).forEach(([gameId, gameConfig]) => {
        const gameHints = gameConfig.hints || [];
        const combined = sm.getCombinedHints(gameHints);

        gamesForUI[gameId] = {
          shortLabel: gameConfig.shortLabel,
          gameLabel: gameConfig.gameLabel,
          description: gameConfig.description,
          hints: gameHints,
          combinedHints: combined
        };
      });

      const configToPublish = {
        games: gamesForUI
        // colorScenes removed - now hardcoded in UI
      };

      mqtt.publish(uiTopics.config, configToPublish, { retain: true });
    } catch (e) {
      log.warn('publishUiConfig failed', e.message);
    }
  }

  // Subscribe to incoming topics
  mqtt.on('message', (topic, payload) => {
    try {
      log.debug(`Received MQTT message on ${topic}:`, payload);

      // Check for trigger rules first
      const matchingRules = triggerRules.filter(rule => rule.trigger.topic === topic);
      if (matchingRules.length > 0) {
        matchingRules.forEach(async (rule) => {
          try {
            await handleTrigger(topic, payload, rule);
          } catch (error) {
            log.error(`Failed to handle trigger for rule ${rule.name}:`, error);
          }
        });
      }

      if (topic === uiTopics.commands) {
        // Validate command structure first
        if (typeof payload === 'string') {
          // Malformed JSON - publish event and warning
          const eventData = { topic, rawPayload: payload, error: 'malformed_json' };
          sm.publishEvent('command_validation_failed', eventData);
          sm.publishWarning('malformed_command', {
            message: `Received malformed JSON command on ${topic}: ${payload.substring(0, 100)}${payload.length > 100 ? '...' : ''}`,
            topic,
            rawPayload: payload
          });
          return;
        }

        if (!payload || typeof payload !== 'object' || !payload.command) {
          // Missing or invalid command field
          const eventData = { topic, payload, error: 'missing_command_field' };
          sm.publishEvent('command_validation_failed', eventData);
          sm.publishWarning('invalid_command', {
            message: `Received command without valid 'command' field on ${topic}`,
            topic,
            payload
          });
          return;
        }

        // Process valid commands (allow a few synonyms for compatibility)
        const cmdKey = String(payload.command || '').toLowerCase();

        if (cmdKey === 'listhints' || cmdKey === 'gethints' || cmdKey === 'hints') {
          log.info('Publishing hints registry');
          publishHintsRegistry();
          sm.publishEvent('command_processed', { command: payload.command, topic });
        } else if (cmdKey === 'getconfig' || cmdKey === 'config') {
          log.info('Publishing full configuration');
          publishUiConfig();
          sm.publishEvent('command_processed', { command: payload.command, topic });
        } else if (payload.command === 'executeHint') {
          const hintId = payload && (payload.id || payload.hintId || payload.hint);
          if (!hintId) {
            sm.publishEvent('command_validation_failed', { command: 'executeHint', payload, error: 'missing_hint_id' });
            sm.publishWarning('executeHint_missing_id', {
              message: 'executeHint command called without required id/hintId/hint parameter',
              payload
            });
            return;
          }
          (async () => {
            try {
              // The state machine now handles hint execution directly.
              sm.fireHint(hintId, 'manual');
              sm.publishEvent('command_processed', { command: 'executeHint', hintId, topic });
            } catch (e) {
              sm.publishEvent('command_execution_failed', { command: 'executeHint', hintId, error: e.message });
              sm.publishWarning('executeHint_failed', {
                message: `Failed to execute hint '${hintId}': ${e.message}`,
                hintId,
                error: e.message
              });
            }
          })();
        } else {
          log.info(`Delegating command to state machine: ${JSON.stringify(payload)}`);
          sm.handleCommand(payload).catch(error => {
            log.error('Error handling command:', error);
            sm.publishEvent('command_execution_failed', { command: payload.command, payload, error: error.message });
            sm.publishWarning('state_machine_command_failed', {
              message: `State machine failed to process command '${payload.command}': ${error.message}`,
              command: payload.command,
              error: error.message
            });
          });
        }
      } else if (topic === 'paradox/houdini/hints') {
        // New hints execution topic handler
        log.debug('Received hint execution request:', payload);
        
        // Validate payload structure
        if (!payload || typeof payload !== 'object') {
          sm.publishWarning('hint_execution_invalid_payload', {
            message: 'Hint execution request has invalid payload',
            topic,
            payload
          });
          return;
        }

        // Extract hint id and text (for ad-hoc or text hints)
        const hintId = payload.id;
        const hintText = payload.text;

        // Require at least one of id or text
        if (!hintId && !hintText) {
          sm.publishWarning('hint_execution_missing_data', {
            message: 'Hint execution request missing both id and text',
            payload
          });
          return;
        }

        (async () => {
          try {
            // Call state machine's hint execution with text override support
            await sm.fireHint(hintId, 'manual', hintText);
            sm.publishEvent('hint_executed', { hintId, text: hintText, topic });
            log.info(`Hint executed: ${hintId || 'ad-hoc'} ${hintText ? `"${hintText}"` : ''}`);
          } catch (e) {
            sm.publishEvent('hint_execution_failed', { hintId, text: hintText, error: e.message });
            sm.publishWarning('hint_execution_error', {
              message: `Failed to execute hint: ${e.message}`,
              hintId,
              text: hintText,
              error: e.message
            });
          }
        })();
      } else if (topic === uiTopics.events) {
        // React to mode changes to republish hints for the active game
        try {
          if (payload && payload.event === 'game_mode_changed') {
            publishHintsRegistry();
            publishUiConfig();
          }
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      log.error('Error handling message on', topic, e.message);
    }
  });

  mqtt.subscribe(uiTopics.commands);
  mqtt.subscribe(uiTopics.events);
  mqtt.subscribe('paradox/houdini/hints'); // Subscribe to new hints execution topic

  // Initialize trigger subscriptions
  initializeTriggers();

  // Publish hints registry on startup and after broker reconnect
  publishHintsRegistry();
  publishUiConfig();
  mqtt.on('connected', () => {
    publishHintsRegistry();
    publishUiConfig();
    initializeTriggers(); // Re-subscribe to triggers after reconnect
  });

  process.on('SIGINT', () => {
    log.info('SIGINT, cleaning up and exiting');
    mqtt.disconnect();
    setTimeout(() => process.exit(0), 100);
  });
  process.on('SIGTERM', () => {
    log.info('SIGTERM, cleaning up and exiting');
    mqtt.disconnect();
    setTimeout(() => process.exit(0), 100);
  });
}

module.exports = Object.assign(module.exports || {}, { main });

// --- Module-level helpers (exported for unit tests) -----------------
// All helpers are now handled within the state machine or are no longer necessary.


if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error starting game:', err);
    process.exit(1);
  });
}
