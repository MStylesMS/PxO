#!/usr/bin/env node

const MqttClient = require('./mqttClient');
const { loadConfig } = require('./config');
const log = require('./logger');
const GameStateMachine = require('./stateMachine');
const { getUiTopics } = require('./engineUtils');
const { loadIniConfig } = require('./ini-config-loader');
const LogCleanup = require('./log-cleanup');
const { GameplayLogger } = require('./gameplay-logger');
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

/**
 * Publish retained MQTT discovery and schema messages for external integrations.
 * Topics: {gameTopic}/discovery and {gameTopic}/schema (both retained).
 */
function _publishMqttMetadata(mqtt, cfg, sm) {
  try {
    const gameTopic = cfg?.global?.mqtt?.['game-topic'];
    if (!gameTopic) {
      log.debug('No game-topic configured; skipping discovery/schema publish');
      return;
    }

    const zoneNames = sm.zones ? sm.zones.getZoneNames() : [];
    const zones = zoneNames.map(name => {
      const adapter = sm.zones.getZone(name);
      return {
        name,
        type: adapter ? adapter.zoneType : 'unknown',
        baseTopic: adapter ? adapter.zoneBaseTopic : null
      };
    });

    const discoveryPayload = {
      application: 'pxo',
      timestamp: new Date().toISOString(),
      gameTopic,
      commandsTopic: `${gameTopic}/commands`,
      stateTopic: `${gameTopic}/state`,
      zones
    };
    mqtt.publish(`${gameTopic}/discovery`, discoveryPayload, { retain: true });

    const schemaPayload = {
      application: 'pxo',
      commandsTopic: `${gameTopic}/commands`,
      commands: [
        { command: 'start', description: 'Start or resume the game' },
        { command: 'pause', description: 'Pause the countdown timer' },
        { command: 'resume', description: 'Resume the countdown timer' },
        { command: 'reset', description: 'Reset game to ready state' },
        { command: 'solve', description: 'Trigger win/solved outcome' },
        { command: 'fail', description: 'Trigger fail outcome' },
        { command: 'abort', description: 'Abort current game' },
        { command: 'setTime', description: 'Set remaining time (seconds: number)' },
        { command: 'executeHint', description: 'Fire a hint by id (id: string)' },
        { command: 'listhints', description: 'Publish hints registry to hintsRegistry topic' },
        { command: 'getconfig', description: 'Publish full UI config to config topic' }
      ]
    };
    mqtt.publish(`${gameTopic}/schema`, schemaPayload, { retain: true });

    log.info(`Published discovery and schema to ${gameTopic}/discovery and ${gameTopic}/schema`);
  } catch (e) {
    log.warn('Failed to publish MQTT metadata', e && e.message);
  }
}

function ensureWritableDirectory(dirPath) {
  const resolved = path.resolve(dirPath);
  fs.mkdirSync(resolved, { recursive: true });
  fs.accessSync(resolved, fs.constants.W_OK);
  return resolved;
}

function getEdnBaseName(ednPath) {
  const base = path.basename(ednPath || 'game.edn');
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return stem || 'game';
}

function getConfiguredGameplayDurationSeconds(cfg, mode) {
  const game = cfg?.game?.[mode];
  if (!game) return 0;

  const direct = Number(game?.gameplay?.duration);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);

  const phaseDuration = Number(game?.durations?.gameplay?.seconds);
  if (Number.isFinite(phaseDuration) && phaseDuration > 0) return Math.round(phaseDuration);

  const legacyDuration = Number(game?.durations?.game);
  if (Number.isFinite(legacyDuration) && legacyDuration > 0) return Math.round(legacyDuration);

  return 0;
}

function normalizeCommand(payload) {
  return String(payload?.command || '').trim();
}

function isStartCommand(commandName) {
  const c = String(commandName || '').toLowerCase();
  return c === 'start' || c === 'startgame' || c === 'startmode' || c.startsWith('start:');
}

function inferStartMode(commandName, payload, cfg, sm) {
  const normalized = String(commandName || '').trim();
  if (normalized.toLowerCase().startsWith('start:')) {
    return normalized.split(':', 2)[1] || null;
  }

  const explicit = payload?.mode || payload?.value || payload?.gameType;
  if (explicit) return String(explicit);

  if (sm?.currentGameMode) return sm.currentGameMode;
  if (sm?.gameType) return sm.gameType;

  const gameModes = Object.keys(cfg?.game || {});
  return gameModes.length > 0 ? gameModes[0] : null;
}

function normalizeTriggerStrictMode(value) {
  if (value === undefined || value === null || value === '') return 'warn';
  const normalized = String(value).trim().toLowerCase();
  if (['off', 'false', '0', 'no'].includes(normalized)) return 'off';
  if (['warn', 'warning'].includes(normalized)) return 'warn';
  if (['fail', 'error', 'strict', 'true', '1', 'yes'].includes(normalized)) return 'fail';
  return 'warn';
}

function buildInputSourceMap(cfg) {
  const sourceMap = new Map();
  const diagnostics = {
    invalidSources: [],
    duplicateSources: []
  };

  const candidates = cfg?.global?.inputs
    || cfg?.global?.['trigger-sources']
    || cfg?.global?.triggerSources
    || {};

  if (Array.isArray(candidates)) {
    candidates.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;

      const sourceNameRaw = entry.name || entry.id;
      const sourceName = typeof sourceNameRaw === 'string' ? sourceNameRaw.trim() : '';
      if (!sourceName) {
        diagnostics.invalidSources.push({ index, reason: 'missing_name' });
        return;
      }

      const topic = typeof entry.topic === 'string' ? entry.topic.trim() : '';
      if (!topic) {
        diagnostics.invalidSources.push({ index, source: sourceName, reason: 'missing_topic' });
        return;
      }

      if (sourceMap.has(sourceName)) {
        diagnostics.duplicateSources.push({ source: sourceName, index });
        return;
      }

      sourceMap.set(sourceName, { ...entry, topic });
    });

    return { sourceMap, diagnostics };
  }

  Object.entries(candidates).forEach(([name, definition]) => {
    if (!definition || typeof definition !== 'object') return;
    const sourceName = typeof name === 'string' ? name.trim() : '';
    if (!sourceName) {
      diagnostics.invalidSources.push({ source: String(name), reason: 'invalid_name' });
      return;
    }

    const topic = typeof definition.topic === 'string' ? definition.topic.trim() : '';
    if (!topic) {
      diagnostics.invalidSources.push({ source: sourceName, reason: 'missing_topic' });
      return;
    }

    sourceMap.set(sourceName, { ...definition, topic });
  });

  return { sourceMap, diagnostics };
}

function buildTriggerRules(rawTriggerRules, inputSources) {
  const diagnostics = {
    unresolvedRules: [],
    unknownSourceRules: []
  };

  const triggerRules = rawTriggerRules
    .map((rule, index) => {
      if (!rule || typeof rule !== 'object') return null;

      const trigger = { ...(rule.trigger || {}) };
      let resolvedTopic = typeof trigger.topic === 'string' ? trigger.topic.trim() : '';
      const sourceNameRaw = trigger.source || rule.source;
      const sourceName = typeof sourceNameRaw === 'string' ? sourceNameRaw.trim() : '';

      if (!resolvedTopic && sourceName && inputSources.has(sourceName)) {
        resolvedTopic = inputSources.get(sourceName).topic;
      }

      if (!resolvedTopic) {
        diagnostics.unresolvedRules.push({
          name: rule.name || `rule-${index + 1}`,
          index,
          source: sourceName || null
        });
        return null;
      }

      if (sourceName && !inputSources.has(sourceName)) {
        diagnostics.unknownSourceRules.push({
          name: rule.name || `rule-${index + 1}`,
          index,
          source: sourceName,
          topic: resolvedTopic
        });
      }

      return {
        ...rule,
        actions: Array.isArray(rule.actions) ? rule.actions : [],
        trigger: {
          ...trigger,
          condition: (trigger.condition && typeof trigger.condition === 'object') ? trigger.condition : {},
          topic: resolvedTopic,
          source: sourceName || trigger.source
        }
      };
    })
    .filter(Boolean);

  return { triggerRules, diagnostics };
}

function logTriggerDiagnostics({ strictMode, rawTriggerRules, inputSources, triggerRules, sourceDiagnostics, triggerDiagnostics }) {
  const report = {
    strictMode,
    configuredRules: rawTriggerRules.length,
    activeRules: triggerRules.length,
    skippedRules: triggerDiagnostics.unresolvedRules.length,
    sources: inputSources.size,
    invalidSources: sourceDiagnostics.invalidSources.length,
    duplicateSources: sourceDiagnostics.duplicateSources.length,
    unknownSourceRules: triggerDiagnostics.unknownSourceRules.length
  };

  log.info(`Trigger startup diagnostics: ${JSON.stringify(report)}`);

  if (sourceDiagnostics.invalidSources.length > 0) {
    sourceDiagnostics.invalidSources.forEach((entry) => {
      log.warn(`Trigger source ignored (${entry.reason}): ${JSON.stringify(entry)}`);
    });
  }

  if (sourceDiagnostics.duplicateSources.length > 0) {
    sourceDiagnostics.duplicateSources.forEach((entry) => {
      log.warn(`Duplicate trigger source ignored: ${entry.source} (entry index ${entry.index})`);
    });
  }

  if (triggerDiagnostics.unresolvedRules.length > 0) {
    triggerDiagnostics.unresolvedRules.forEach((entry) => {
      log.warn(`Skipping trigger rule '${entry.name}': missing trigger topic and unresolved source '${entry.source || 'none'}'`);
    });
  }

  if (triggerDiagnostics.unknownSourceRules.length > 0) {
    triggerDiagnostics.unknownSourceRules.forEach((entry) => {
      log.warn(`Trigger rule '${entry.name}' references unknown source '${entry.source}', using explicit topic '${entry.topic}'`);
    });
  }

  if (triggerRules.length > 0) {
    triggerRules.forEach((rule) => {
      const sourceLabel = rule?.trigger?.source ? ` source=${rule.trigger.source}` : ' source=topic-only';
      log.info(`Trigger binding: ${rule.name || 'unnamed'} topic=${rule.trigger.topic}${sourceLabel}`);
    });
  }
}

function shouldFailForTriggerDiagnostics(strictMode, sourceDiagnostics, triggerDiagnostics) {
  if (strictMode !== 'fail') return false;
  return sourceDiagnostics.invalidSources.length > 0
    || sourceDiagnostics.duplicateSources.length > 0
    || triggerDiagnostics.unresolvedRules.length > 0
    || triggerDiagnostics.unknownSourceRules.length > 0;
}

function getRulePhaseConstraint(rule) {
  const phaseRaw = rule?.whenPhase
    || rule?.when_phase
    || rule?.['when-phase']
    || rule?.trigger?.whenPhase
    || rule?.trigger?.when_phase
    || rule?.trigger?.['when-phase'];

  if (!phaseRaw) return null;

  const values = Array.isArray(phaseRaw) ? phaseRaw : [phaseRaw];
  const phases = values
    .map(v => String(v || '').trim())
    .filter(Boolean);

  return phases.length > 0 ? phases : null;
}

function getValueByPath(obj, pathExpr) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (!pathExpr || typeof pathExpr !== 'string') return undefined;
  const parts = pathExpr.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  let cursor = obj;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function normalizeEventToken(value) {
  const token = String(value || '').trim().toLowerCase();
  const aliases = {
    opened: 'open',
    open: 'open',
    closed: 'close',
    close: 'close',
    activated: 'activate',
    activate: 'activate',
    deactivated: 'deactivate',
    deactivate: 'deactivate',
    pressed: 'press',
    press: 'press',
    released: 'release',
    release: 'release'
  };
  return aliases[token] || token;
}

function conditionEntryMatches(actualValue, expectedValue, key) {
  if (Array.isArray(expectedValue)) {
    return expectedValue.some((candidate) => conditionEntryMatches(actualValue, candidate, key));
  }

  if (typeof actualValue === 'string' && typeof expectedValue === 'string') {
    const keyName = String(key || '').trim().toLowerCase();
    const keyLeaf = keyName.includes('.') ? keyName.split('.').pop() : keyName;
    if (keyLeaf === 'event') {
      return normalizeEventToken(actualValue) === normalizeEventToken(expectedValue);
    }
  }

  return actualValue === expectedValue;
}

function doesTriggerConditionMatch(payload, condition = {}) {
  const entries = Object.entries(condition || {});
  if (entries.length === 0) return true;

  for (const [key, expectedValue] of entries) {
    let actualValue = payload ? payload[key] : undefined;

    // Support nested key paths, e.g. input_event.event
    if (actualValue === undefined && key.includes('.')) {
      actualValue = getValueByPath(payload, key);
    }

    // Backward-compatible convenience: if key is flat and absent, probe common nested input event envelope.
    if (actualValue === undefined && payload && payload.input_event && typeof payload.input_event === 'object') {
      actualValue = payload.input_event[key];
    }

    if (!conditionEntryMatches(actualValue, expectedValue, key)) {
      return false;
    }
  }

  return true;
}

async function main() {
  // Parse command line arguments
  const argv = minimist(process.argv.slice(2), {
    alias: {
      c: 'check'
    },
    boolean: ['check'],
    string: ['game_log_path']
  });

  if (argv.check) {
    const { validateEdnFile } = require('../tools/validate-edn');
    const checkPath = argv.edn || path.join(__dirname, '..', 'config', 'game.edn');
    const ok = validateEdnFile(checkPath);
    process.exit(ok ? 0 : 1);
  }

  // Check for --config option for INI file (infrastructure config)
  const iniConfigPath = argv.config || null;
  const iniConfig = loadIniConfig(iniConfigPath);

  const cliGameLogPath = argv.game_log_path || argv['game-log-path'] || null;
  let gameplayLogDirectory = null;

  try {
    if (cliGameLogPath) {
      gameplayLogDirectory = ensureWritableDirectory(cliGameLogPath);
      log.info(`Gameplay logging enabled via CLI path override: ${gameplayLogDirectory}`);
    } else if (iniConfig.global?.game_logging) {
      if (!iniConfig.global?.game_log_path) {
        throw new Error('INI global.game_logging is enabled but global.game_log_path is missing');
      }
      gameplayLogDirectory = ensureWritableDirectory(iniConfig.global.game_log_path);
      log.info(`Gameplay logging enabled via INI: ${gameplayLogDirectory}`);
    }
  } catch (err) {
    log.error(`Gameplay logging configuration error: ${err.message}`);
    process.exit(1);
  }

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
      excludeFiles: ['pxo-latest.log', 'game-latest.log']
    });
    if (cleanupResult.deleted > 0) {
      log.info(`Cleaned up ${cleanupResult.deleted} old log files (kept ${cleanupResult.kept}, total ${cleanupResult.totalSize}MB)`);
    }

    // Create timestamped log file for this session
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const logFile = path.join(logDir, `pxo-${timestamp}.log`);
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Also create/update the latest log symlink
    const latestLogFile = path.join(logDir, 'pxo-latest.log');
    try {
      // Remove existing path even if it's a dangling symlink.
      try {
        fs.lstatSync(latestLogFile);
        fs.unlinkSync(latestLogFile);
      } catch (_) {
        // Path does not exist; nothing to remove.
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

  // Check for --edn option for EDN file path (game content config)
  const ednConfigPath = argv.edn || null;
  const resolvedEdnPath = ednConfigPath
    ? path.resolve(ednConfigPath)
    : path.resolve(__dirname, '..', 'config', 'game.edn');
  const ednBase = getEdnBaseName(resolvedEdnPath);

  log.info('Loading configuration in EDN format');
  const cfg = loadConfig('edn', ednConfigPath);

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

  const gameplayLogger = gameplayLogDirectory
    ? new GameplayLogger({
      logDir: gameplayLogDirectory,
      ednBase,
      logger: log,
      getCurrentMode: () => sm.currentGameMode || sm.gameType || null,
      getClockState: () => {
        const state = sm.state;
        if (state === 'gameplay' || state === 'paused' || state === 'intro') {
          return { remainingSeconds: sm.remaining };
        }
        if (state === 'solved' || state === 'failed' || state === 'abort' || state === 'resetting' || state === 'ready') {
          return { remainingSeconds: sm.resetRemaining };
        }
        return { remainingSeconds: sm.remaining };
      }
    })
    : null;

  if (gameplayLogger) {
    sm.setGameplayLogger(gameplayLogger);
  }

  // Publish MQTT discovery and schema for external integrations (Node-RED, etc.)
  _publishMqttMetadata(mqtt, cfg, sm);

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
  const rawTriggerRules = (cfg.global.triggers && cfg.global.triggers.escapeRoomRules) || [];
  const strictMode = normalizeTriggerStrictMode(
    argv['trigger-source-strict']
      || argv.trigger_source_strict
      || iniConfig.global?.trigger_source_strict
      || process.env.PXO_TRIGGER_SOURCE_STRICT
  );
  const { sourceMap: inputSources, diagnostics: sourceDiagnostics } = buildInputSourceMap(cfg);
  const { triggerRules, diagnostics: triggerDiagnostics } = buildTriggerRules(rawTriggerRules, inputSources);

  logTriggerDiagnostics({
    strictMode,
    rawTriggerRules,
    inputSources,
    triggerRules,
    sourceDiagnostics,
    triggerDiagnostics
  });

  if (shouldFailForTriggerDiagnostics(strictMode, sourceDiagnostics, triggerDiagnostics)) {
    log.error('Trigger startup validation failed in strict mode. Set trigger_source_strict=warn|off to continue while fixing config issues.');
    process.exit(1);
  }

  const sensorTopicConfig = new Map();
  const sensorTopicState = new Map();

  triggerRules.forEach((rule) => {
    const topic = rule?.trigger?.topic;
    if (!topic) return;
    const existing = sensorTopicConfig.get(topic) || {
      ignoreLogging: false,
      deadband: null,
      minIntervalMs: 0,
      field: 'value'
    };

    const ignore = GameplayLogger.isTruthy(rule?.trigger?.ignore_logging) || GameplayLogger.isTruthy(rule?.ignore_logging);
    if (ignore) existing.ignoreLogging = true;

    const deadband = rule?.trigger?.deadband;
    if (typeof deadband === 'number' && Number.isFinite(deadband) && deadband > 0) {
      existing.deadband = deadband;
    } else if (deadband && typeof deadband === 'object') {
      if (Number.isFinite(deadband.threshold) && deadband.threshold > 0) {
        existing.deadband = Number(deadband.threshold);
      }
      if (Number.isFinite(deadband.min_interval_ms) && deadband.min_interval_ms >= 0) {
        existing.minIntervalMs = Number(deadband.min_interval_ms);
      }
      if (typeof deadband.field === 'string' && deadband.field.trim().length > 0) {
        existing.field = deadband.field;
      }
    }

    sensorTopicConfig.set(topic, existing);
  });

  function maybeLogSensorInput(topic, payload) {
    if (!gameplayLogger || (!gameplayLogger.pending && !gameplayLogger.session)) return;
    if (!sensorTopicConfig.has(topic)) return;

    const cfgForTopic = sensorTopicConfig.get(topic);
    if (cfgForTopic.ignoreLogging) return;

    const now = Date.now();
    const previous = sensorTopicState.get(topic);
    let shouldLog = true;
    let suppressionReason = null;

    if (cfgForTopic.minIntervalMs > 0 && previous && (now - previous.tsMs) < cfgForTopic.minIntervalMs) {
      shouldLog = false;
      suppressionReason = 'min_interval';
    }

    if (shouldLog && cfgForTopic.deadband && payload && typeof payload === 'object') {
      const field = cfgForTopic.field || 'value';
      const currentValue = Number(payload[field]);
      const previousValue = previous && previous.valueByField ? Number(previous.valueByField[field]) : null;
      if (Number.isFinite(currentValue) && Number.isFinite(previousValue)) {
        if (Math.abs(currentValue - previousValue) < cfgForTopic.deadband) {
          shouldLog = false;
          suppressionReason = 'deadband';
        }
      }
    }

    sensorTopicState.set(topic, {
      tsMs: now,
      payload,
      valueByField: payload && typeof payload === 'object' ? payload : {}
    });

    if (!shouldLog) {
      log.debug(`Gameplay sensor log suppressed for ${topic} (${suppressionReason})`);
      return;
    }

    gameplayLogger.sensorChanged({
      topic,
      payload,
      deadband: cfgForTopic.deadband,
      field: cfgForTopic.field
    });
  }

  function initializeTriggers() {
    triggerRules.forEach(rule => {
      const sourceLabel = rule?.trigger?.source ? ` (source ${rule.trigger.source})` : '';
      log.info(`Subscribing to trigger: ${rule.name} on topic ${rule.trigger.topic}${sourceLabel}`);
      mqtt.subscribe(rule.trigger.topic);
    });
  }

  async function handleTrigger(topic, payload, rule) {
    log.debug(`Evaluating trigger rule: ${rule.name}`);

    const allowedPhases = getRulePhaseConstraint(rule);
    if (allowedPhases && !allowedPhases.includes(sm.state)) {
      log.debug(`Trigger ${rule.name} ignored: current phase '${sm.state}' not in [${allowedPhases.join(', ')}]`);
      return;
    }

    // Check if trigger condition matches
    const condition = (rule.trigger && typeof rule.trigger.condition === 'object') ? rule.trigger.condition : {};
    const conditionMet = doesTriggerConditionMatch(payload, condition);

    if (!conditionMet) {
      log.debug(`Trigger condition not met for ${rule.name}`);
      return;
    }

    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    log.info(`Trigger activated: ${rule.name} - executing ${actions.length} actions`);
    if (gameplayLogger) {
      gameplayLogger.event('trigger_activated', {
        name: rule.name,
        source: rule?.trigger?.source || null,
        topic,
        payload,
        actions_count: actions.length
      });
    }

    // Execute all actions for this trigger
    for (const action of actions) {
      try {
        await executeAction(action, rule.name);
      } catch (error) {
        log.error(`Failed to execute action for trigger ${rule.name}:`, error);
      }
    }
  }

  async function executeAction(action, triggerName) {
    log.debug(`Executing action type: ${action.type} for trigger: ${triggerName}`);

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
        const additionalPhases = Array.isArray(gameConfig['additional-phases'])
          ? gameConfig['additional-phases']
          : (Array.isArray(gameConfig.additionalPhases) ? gameConfig.additionalPhases : []);

        gamesForUI[gameId] = {
          shortLabel: gameConfig.shortLabel,
          gameLabel: gameConfig.gameLabel,
          description: gameConfig.description,
          hints: gameHints,
          combinedHints: combined,
          additionalPhases
        };
      });

      const configToPublish = {
        games: gamesForUI,
        hintTopic: uiTopics.hint,
        operatorControlDefaults: {
          nonClosing: {
            label: 'Abort',
            command: 'abort',
            style: 'danger',
            confirm: true,
            confirmText: 'Are you sure?'
          },
          closing: {
            label: 'Reset',
            command: 'reset',
            style: 'warning',
            confirm: false,
            confirmText: ''
          }
        }
        // colorScenes removed - now hardcoded in UI
      };

      mqtt.publish(uiTopics.config, configToPublish, { retain: true });
    } catch (e) {
      log.warn('publishUiConfig failed', e.message);
    }
  }

  const chatToPlayerTopic = iniConfig.global?.chat_to_player || null;
  const chatFromPlayerTopic = iniConfig.global?.chat_from_player || null;
  const chatLoggingEnabled = !!(chatToPlayerTopic && chatFromPlayerTopic);
  if ((chatToPlayerTopic || chatFromPlayerTopic) && !chatLoggingEnabled) {
    log.warn('Gameplay chat logging disabled: both INI fields chat_to_player and chat_from_player are required');
  }

  const gameplayControlSequenceAllowlist = new Set([
    'intro-to-gameplay-sequence',
    'pause-sequence',
    'resume-sequence',
    'reset-sequence',
    'closing-complete-sequence',
    'adjust-time-sequence',
    'game-mode-changed-sequence',
    'emergency-stop-sequence'
  ]);

  function shouldLogSequenceEvent(sequenceData = {}) {
    const depth = Number(sequenceData.depth);
    const name = String(sequenceData.name || '');
    if (!Number.isFinite(depth) || depth !== 0) return false;
    if (sm.state === 'gameplay') return true;
    return gameplayControlSequenceAllowlist.has(name);
  }

  // Subscribe to incoming topics
  mqtt.on('message', (topic, payload) => {
    try {
      log.debug(`Received MQTT message on ${topic}:`, payload);

      if (chatLoggingEnabled && gameplayLogger) {
        if (topic === chatToPlayerTopic) {
          gameplayLogger.chat('chat_to_player', topic, payload);
        } else if (topic === chatFromPlayerTopic) {
          gameplayLogger.chat('chat_from_player', topic, payload);
        }
      }

      maybeLogSensorInput(topic, payload);

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
          if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
            gameplayLogger.commandRejected('unknown', 'malformed_json', payload, topic, { source: 'mqtt' });
          }
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
          if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
            gameplayLogger.commandRejected('unknown', 'missing_command_field', payload, topic, { source: 'mqtt' });
          }
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
        const commandName = normalizeCommand(payload);
        const cmdKey = commandName.toLowerCase();
        const startCommand = isStartCommand(commandName);

        if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session || !startCommand)) {
          gameplayLogger.commandReceived(commandName, payload, topic, { source: 'mqtt' });
        }

        if (startCommand && gameplayLogger && !gameplayLogger.canAcceptStart()) {
          gameplayLogger.commandRejected(commandName, 'start_lockout_2s', payload, topic, { source: 'lockout' });
          sm.publishEvent('command_validation_failed', {
            command: commandName,
            payload,
            error: 'start_lockout_2s'
          });
          sm.publishWarning('start_lockout_2s', {
            message: 'Start command ignored due to 2-second lockout window',
            command: commandName
          });
          return;
        }

        if (cmdKey === 'listhints' || cmdKey === 'gethints' || cmdKey === 'hints') {
          log.info('Publishing hints registry');
          publishHintsRegistry();
          sm.publishEvent('command_processed', { command: payload.command, topic });
          if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
            gameplayLogger.commandApplied(commandName, payload, topic, { source: 'ui-helper' });
          }
        } else if (cmdKey === 'getconfig' || cmdKey === 'config') {
          log.info('Publishing full configuration');
          publishUiConfig();
          sm.publishEvent('command_processed', { command: payload.command, topic });
          if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
            gameplayLogger.commandApplied(commandName, payload, topic, { source: 'ui-helper' });
          }
        } else if (payload.command === 'executeHint') {
          const hintId = payload && (payload.id || payload.hintId || payload.hint);
          if (!hintId) {
            if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
              gameplayLogger.commandRejected(commandName, 'missing_hint_id', payload, topic, { source: 'validation' });
            }
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
              if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
                gameplayLogger.commandApplied(commandName, payload, topic, { hintId });
              }
            } catch (e) {
              if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
                gameplayLogger.commandRejected(commandName, e.message || 'execute_hint_failed', payload, topic, { hintId });
              }
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
          (async () => {
            try {
              const result = await sm.handleCommand(payload);
              if (result === false) {
                if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
                  gameplayLogger.commandRejected(commandName, 'state_machine_rejected', payload, topic, { result });
                }
                return;
              }

              if (startCommand && gameplayLogger) {
                const mode = inferStartMode(commandName, payload, cfg, sm);
                const gameplayDurationSec = getConfiguredGameplayDurationSeconds(cfg, mode);
                gameplayLogger.beginPendingRun({
                  startCommand: commandName,
                  mode,
                  topic,
                  gameplayDurationSec,
                  tsMs: Date.now()
                });
              } else if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session)) {
                gameplayLogger.commandApplied(commandName, payload, topic, { source: 'state_machine' });
              }
            } catch (error) {
              if (gameplayLogger && (gameplayLogger.pending || gameplayLogger.session || startCommand)) {
                gameplayLogger.commandRejected(commandName, error.message || 'state_machine_command_failed', payload, topic, { source: 'state_machine' });
              }

              log.error('Error handling command:', error);
              sm.publishEvent('command_execution_failed', { command: payload.command, payload, error: error.message });
              sm.publishWarning('state_machine_command_failed', {
                message: `State machine failed to process command '${payload.command}': ${error.message}`,
                command: payload.command,
                error: error.message
              });
              sm.runErrorSequence('command_execution_failed', {
                command: payload.command,
                error: error.message
              }).catch(() => { /* best effort */ });
            }
          })();
        }
      } else if (topic === uiTopics.hint) {
        // Hints execution topic handler
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
          const eventName = payload && payload.event;
          const eventData = payload && payload.data ? payload.data : {};

          if (eventName === 'game_mode_changed') {
            publishHintsRegistry();
            publishUiConfig();
            if (gameplayLogger) {
              gameplayLogger.noteModeChange(eventData.newMode || sm.currentGameMode || sm.gameType);
            }
          }

          if (gameplayLogger && eventName) {
            if (eventName === 'phase_transition') {
              gameplayLogger.event('phase_transition', eventData);
              if (eventData.to === 'gameplay') {
                gameplayLogger.commitPendingRun({ mode: sm.currentGameMode || sm.gameType });
              }
              if (gameplayLogger.pending && eventData.from === 'intro' && eventData.to !== 'gameplay') {
                gameplayLogger.discardPending('intro_ended_without_gameplay');
              }
              if (gameplayLogger.session && eventData.to === 'ready') {
                gameplayLogger.endSession({ reason: 'phase_ready' });
              }
            } else if (eventName === 'game_end_trigger') {
              gameplayLogger.event('game_end_triggered', eventData);
            } else if (eventName === 'hint_executed') {
              gameplayLogger.event('hint_executed', eventData);
            } else if (eventName === 'time_adjusted') {
              gameplayLogger.event('time_adjusted', eventData);
            } else if ((eventName === 'sequence_start' || eventName === 'sequence_complete') && shouldLogSequenceEvent(eventData)) {
              const mapped = eventName === 'sequence_start' ? 'sequence_started' : 'sequence_completed';
              gameplayLogger.event(mapped, eventData);
            } else if (eventName === 'reset_sequence_complete' && gameplayLogger.session) {
              gameplayLogger.event('reset_sequence_complete', eventData);
              gameplayLogger.endSession({ reason: 'reset_sequence_complete' });
            }
          }
        } catch (_) { /* ignore */ }
      }
    } catch (e) {
      log.error('Error handling message on', topic, e.message);
    }
  });

  mqtt.subscribe(uiTopics.commands);
  mqtt.subscribe(uiTopics.events);
  mqtt.subscribe(uiTopics.hint); // Subscribe to hints execution topic
  if (chatLoggingEnabled) {
    mqtt.subscribe(chatToPlayerTopic);
    mqtt.subscribe(chatFromPlayerTopic);
  }

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

  mqtt.on('disconnected', () => {
    sm.publishWarning('mqtt_disconnected', {
      message: 'MQTT broker disconnected',
      broker: cfg.global?.mqtt?.broker
    });
    sm.sequenceRunner.runControlSequence('mqtt-disconnected-sequence', {
      gameMode: sm.gameType,
      broker: cfg.global?.mqtt?.broker
    }).catch(() => { /* best effort */ });
  });

  mqtt.on('reconnected', () => {
    sm.publishEvent('mqtt_reconnected', {
      broker: cfg.global?.mqtt?.broker
    });
    sm.sequenceRunner.runControlSequence('mqtt-reconnected-sequence', {
      gameMode: sm.gameType,
      broker: cfg.global?.mqtt?.broker
    }).catch(() => { /* best effort */ });
  });

  mqtt.on('mqtt-error', (err) => {
    sm.publishWarning('mqtt_error', {
      message: `MQTT error: ${err && err.message ? err.message : 'unknown error'}`,
      error: err && err.message ? err.message : 'unknown_error'
    });
    sm.runErrorSequence('mqtt_error', {
      error: err && err.message ? err.message : 'unknown_error'
    }).catch(() => { /* best effort */ });
  });

  process.on('SIGINT', () => {
    log.info('SIGINT, cleaning up and exiting');
    if (gameplayLogger) gameplayLogger.endSession({ reason: 'sigint' });
    mqtt.disconnect();
    setTimeout(() => process.exit(0), 100);
  });
  process.on('SIGTERM', () => {
    log.info('SIGTERM, cleaning up and exiting');
    if (gameplayLogger) gameplayLogger.endSession({ reason: 'sigterm' });
    mqtt.disconnect();
    setTimeout(() => process.exit(0), 100);
  });
}

module.exports = Object.assign(module.exports || {}, {
  main,
  _publishMqttMetadata,
  normalizeTriggerStrictMode,
  buildInputSourceMap,
  buildTriggerRules,
  getRulePhaseConstraint,
  doesTriggerConditionMatch,
  conditionEntryMatches,
  normalizeEventToken,
  getValueByPath
});

// --- Module-level helpers (exported for unit tests) -----------------
// All helpers are now handled within the state machine or are no longer necessary.


if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error starting game:', err);
    process.exit(1);
  });
}
