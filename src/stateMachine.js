const EventEmitter = require('events');
const log = require('./logger');
const { secondsToMMSS } = require('./util');
const AdapterRegistry = require('./adapters/adapterRegistry');
const SequenceRunner = require('./sequenceRunner');
const Hints = require('./hints');
const {

  getCommandsTopic,
  publishExecuteHint,
  stopAllAcrossZones,
  VERIFY_BROWSER_TIMEOUT_MS,
  VERIFY_MEDIA_TIMEOUT_MS,
} = require('./engineUtils');

class GameStateMachine extends EventEmitter {
  constructor({ cfg, mqtt }) {
    super();
    this.cfg = cfg;
    this.mqtt = mqtt;
    // Legacy controllers removed – all routing goes through zone-based adapters

    // Initialize new zone-based adapter registry
    const zones = cfg.global?.mqtt?.zones || {};
    // Provide timing provider and options to adapters
    const provider = {
      getGameState: () => this.state,
      getRemaining: () => this.remaining,
      getResetRemaining: () => this.resetRemaining,
      secondsToMMSS
    };
    const gameTopic = cfg.global?.mqtt?.['game-topic'];
    this.zones = new AdapterRegistry(mqtt, zones, { provider, gameTopic, mirrorUI: true });


    log.info(`Initialized adapter registry with ${this.zones.getZoneNames().length} zones`);
    this.zones.getZoneNames().forEach(zoneName => {
      const adapter = this.zones.getZone(zoneName);
      log.debug(`  Zone '${zoneName}': ${adapter.zoneType} → ${adapter.zoneBaseTopic}`);
    });

    this.state = 'resetting'; // Start in resetting state during startup (initial, no logging)
    this.gameType = null; // dynamically chosen game mode key from cfg.game
    this.remaining = 0; // seconds
    this.disabledHints = new Map(); // Changed from Set to Map to store timestamps
    this.markedActions = new Set();
    this.startupProblems = []; // Track startup/reset problems

    // Unified timer system
    this._unifiedTimer = null;
    this.heartbeat = null;
    this.resetRemaining = 0;

    // Sequence concurrency control
    this._runningSequence = null; // tracks currently executing control sequence
    this._phaseTransitionToken = 0; // invalidates in-flight phase transitions when incremented

    this.resetPaused = false;


    // Initialize sequence runner (PR_MQTT_PURGE Phase 1)
    this.sequenceRunner = new SequenceRunner({ cfg, zones: this.zones, mqtt, stateMachine: this });
    this._idleLoopTimer = null;
    // Phase-scoped schedule registrations: { phaseKey: [ {entry, _idx, at, key} ] }
    this._phaseSchedules = new Map();
    // Prevent duplicate end-media cue execution in a single closing phase.
    this._closingOutcomeMediaFired = new Set();

    // --- PHASE ENGINE PROPERTIES ---
    this.phases = {}; // loaded from :phases config (map, not array)
    this.currentPhase = null; // current phase name (string)
    this.currentPhaseConfig = null; // current phase definition object
    this.globalSequences = {}; // flattened from canonical runtime sequence registries for reference resolution
    this.gameplayLogger = null;
  }

  setGameplayLogger(gameplayLogger) {
    this.gameplayLogger = gameplayLogger || null;
  }

  _normalizePhaseType(phaseType) {
    if (!phaseType) return null;
    return String(phaseType).replace(/^:/, '').toLowerCase();
  }

  _isClosingPhaseType(phaseType) {
    const normalized = this._normalizePhaseType(phaseType);
    return normalized === 'solved' || normalized === 'failed';
  }

  _getPhaseType(phaseName) {
    const phaseConfig = this.phases && this.phases[phaseName];
    const configuredType = phaseConfig && (phaseConfig['phase-type'] || phaseConfig.phaseType);
    if (configuredType) return this._normalizePhaseType(configuredType);
    return this._normalizePhaseType(phaseName);
  }

  _isClosingPhase(phaseName) {
    return this._isClosingPhaseType(this._getPhaseType(phaseName));
  }

  _resolveAdditionalPhasesForMode(gameConfig, gameType = 'unknown') {
    const modeAllowlist = Array.isArray(gameConfig?.['additional-phases'])
      ? gameConfig['additional-phases']
      : (Array.isArray(gameConfig?.additionalPhases) ? gameConfig.additionalPhases : []);

    if (modeAllowlist.length === 0) return {};

    const globalRegistry = this.cfg?.global?.['additional-phases'];
    if (!globalRegistry || typeof globalRegistry !== 'object') {
      this.publishWarning('additional_phases_registry_missing', {
        mode: gameType,
        requested: modeAllowlist
      });
      return {};
    }

    const resolved = {};
    modeAllowlist.forEach((phaseKeyRaw) => {
      const phaseKey = String(phaseKeyRaw || '').replace(/^:/, '');
      if (!phaseKey) return;

      const phaseDef = globalRegistry[phaseKey];
      if (!phaseDef || typeof phaseDef !== 'object') {
        const msg = `Game mode '${gameType}' enables additional phase '${phaseKey}' but no definition exists under :global :additional-phases.`;
        log.warn(`[PhaseEngine] ${msg}`);
        this.publishWarning('additional_phase_missing', { mode: gameType, phase: phaseKey });
        return;
      }

      resolved[phaseKey] = phaseDef;
    });

    return resolved;
  }

  resolveMediaReference(value, context = 'media') {
    if (typeof value !== 'string') {
      return value;
    }

    const mediaCatalog = this.cfg?.global?.media;
    if (!mediaCatalog || typeof mediaCatalog !== 'object') {
      return value;
    }

    if (!Object.prototype.hasOwnProperty.call(mediaCatalog, value)) {
      return value;
    }

    const resolvedValue = mediaCatalog[value];
    if (typeof resolvedValue !== 'string') {
      log.warn(`Media reference '${value}' in ${context} resolved to non-string value; using original reference`);
      return value;
    }

    log.debug(`Resolved media reference '${value}' in ${context} -> '${resolvedValue}'`);
    return resolvedValue;
  }

  resolveMediaFields(data, fields, context) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const resolved = { ...data };
    for (const field of fields) {
      if (resolved[field] !== undefined) {
        resolved[field] = this.resolveMediaReference(resolved[field], `${context}.${field}`);
      }
    }
    return resolved;
  }

  // Execute a hint by id with optional text override
  async fireHint(hintId, source = 'direct', textOverride = null) {
    // Handle ad-hoc text hints (no id, only text)
    if (!hintId && textOverride) {
      log.info(`Executing ad-hoc text hint: "${textOverride}"`);
      return this.executeTextHint({ text: textOverride }, source);
    }

    if (!hintId) {
      this.publishWarning('hint_missing_id', { source });
      return false;
    }

    // Record early/manual hints to optionally suppress scheduled duplicates shortly after
    try {
      if (source === 'early' || source === 'manual') {
        const id = this.normalizeHintId(hintId);
        this.disabledHints.set(id, Date.now());
      }
    } catch (_) { /* ignore */ }

    // Look up the hint
    const hint = this.lookupHint(hintId);
    if (!hint) {
      this.publishWarning('hint_not_found', { id: hintId, source });
      return false;
    }

    // If textOverride provided for a text hint, override the text
    const effectiveHint = (textOverride && (hint.type === 'text' || !hint.type))
      ? { ...hint, text: textOverride }
      : hint;

    // Execute based on type
    try {
      const hintType = String(effectiveHint.type || 'text').toLowerCase();
      switch (hintType) {
        case 'text':
          await this.executeTextHint(effectiveHint, source);
          break;
        case 'sequence':
          await this.executeSequenceHint(effectiveHint, source);
          break;
        case 'speech':
          await this.executeSpeechHint(effectiveHint, source);
          break;
        case 'audio': {
          const message = "Unsupported hint type 'audio'. Use 'audioFx' for sound effects, 'speech' for spoken audio, or 'background' for looping background audio.";
          log.warn(message);
          this.publishWarning('hint_invalid_type', { id: hintId, type: effectiveHint.type, message });
          return false;
        }
        case 'audiofx':
          await this.executeAudioHint(effectiveHint, source);
          break;
        case 'background':
          await this.executeBackgroundHint(effectiveHint, source);
          break;
        case 'video':
          await this.executeVideoHint(effectiveHint, source);
          break;
        case 'image':
          await this.executeImageHint(effectiveHint, source);
          break;
        case 'action':
          await this.executeActionHint(effectiveHint, source);
          break;
        default:
          log.warn(`Unknown hint type: ${effectiveHint.type}`);
          this.publishWarning('hint_unknown_type', { id: hintId, type: effectiveHint.type });
          return false;
      }
      this.publishEvent('hint_executed', { id: hintId, type: hintType === 'audiofx' ? 'audioFx' : hintType, source });
      return true;
    } catch (e) {
      log.error(`Failed to execute hint ${hintId}:`, e.message);
      this.publishWarning('hint_execution_failed', { id: hintId, source, error: e.message });
      return false;
    }
  }

  // Look up a hint by id from combined game+global hints
  lookupHint(hintId) {
    if (!hintId) return null;

    // Get hints for current game mode
    const gameModes = this.cfg['game-modes'] || this.cfg.game || {};
    const mode = this.currentGameMode || Object.keys(gameModes)[0] || '';
    const gameHints = (gameModes?.[mode]?.hints) || [];
    const combined = this.getCombinedHints(gameHints);

    // Find hint by id
    const normalizedHintId = this.normalizeHintId(hintId);
    const hint = combined.find(h => {
      if (!h || !h.id) return false;
      return h.id === hintId || this.normalizeHintId(h.id) === normalizedHintId;
    });
    if (!hint) {
      // Don't log here - this is called for every :fire check
      return null;
    }

    // Return the hint data
    return hint.data || hint;
  }

  // Execute text hint using :hint-text-seq sequence
  async executeTextHint(hint, source = 'direct') {
    const text = typeof hint?.text === 'string' ? hint.text.trim() : '';
    if (!text) {
      log.warn('Text hint has no text');
      return false;
    }

    log.info(`Executing text hint: "${text}"`);

    // Preferred path: text hints use an explicit sequence in global.command-sequences.
    if (hint.sequence && typeof hint.sequence === 'string') {
      return this.executeSequenceHint({ ...hint, type: 'text', text }, source);
    }

    // Run the :hint-text-seq with hintText variable
    const ctx = {
      hintText: text,
      text,
      duration: hint.duration
    };
    const result = await this.sequenceRunner.runControlSequence('hint-text-seq', ctx);

    if (!result.ok) {
      log.warn(`Text hint sequence failed: ${result.error}`);
      this.publishWarning('hint_text_sequence_failed', { text, error: result.error });
      return false;
    }

    return true;
  }

  getCommandSequenceDefinition(sequenceName) {
    if (!sequenceName) return undefined;
    const all = this.cfg?.global?.['command-sequences'];
    if (!all || typeof all !== 'object') return undefined;

    const normalizeName = (name) => {
      if (!name) return [];
      const raw = String(name);
      const norm = this.sequenceRunner?.normalizeName ? this.sequenceRunner.normalizeName(raw) : raw;
      const base = String(norm).replace(/-sequence$/, '');
      return [raw, norm, base, `${base}-sequence`].filter(Boolean);
    };

    const variants = normalizeName(sequenceName);
    for (const key of variants) {
      if (all[key]) return all[key];
    }

    for (const group of Object.values(all)) {
      if (!group || typeof group !== 'object') continue;
      for (const key of variants) {
        if (group[key]) return group[key];
      }
    }
    return undefined;
  }

  extractTemplateKeys(obj) {
    const keys = new Set();
    const visit = (value) => {
      if (typeof value === 'string') {
        const re = /\{\{(\w+)\}\}/g;
        let match;
        while ((match = re.exec(value)) !== null) {
          keys.add(match[1]);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value).forEach(visit);
      }
    };
    visit(obj);
    return keys;
  }

  async executeSequenceHint(hint, source = 'direct') {
    const sequenceName = hint.sequence;
    if (!sequenceName || typeof sequenceName !== 'string') {
      this.publishWarning('hint_sequence_missing_name', {
        id: hint.id,
        source,
        message: 'Sequence hint missing required string field: sequence'
      });
      return false;
    }

    const seqDef = this.getCommandSequenceDefinition(sequenceName);
    if (!seqDef) {
      this.publishWarning('hint_sequence_not_found', {
        id: hint.id,
        source,
        sequence: sequenceName,
        message: 'Sequence hint target must exist under global.command-sequences'
      });
      return false;
    }

    const hintType = String(hint.type || 'sequence').toLowerCase();
    const reserved = new Set(['id', 'type', 'sequence', 'description', 'parameters']);
    const context = {};
    Object.entries(hint || {}).forEach(([key, value]) => {
      if (!reserved.has(key) && value !== undefined) context[key] = value;
    });

    if (hintType === 'text' && !Object.prototype.hasOwnProperty.call(context, 'text')) {
      const fallbackText = hint.text || hint.description;
      if (fallbackText !== undefined) context.text = fallbackText;
    }

    if (hintType === 'sequence' && hint.parameters !== undefined) {
      if (!hint.parameters || typeof hint.parameters !== 'object' || Array.isArray(hint.parameters)) {
        this.publishWarning('hint_sequence_invalid_parameters', {
          id: hint.id,
          source,
          sequence: sequenceName,
          message: 'Sequence hint parameters must be an object map'
        });
      } else {
        Object.entries(hint.parameters).forEach(([key, value]) => {
          // Keep text/duration as reserved built-ins.
          if (key === 'text' || key === 'duration') return;
          if (value !== undefined) context[key] = value;
        });
      }
    }

    const templateKeys = this.extractTemplateKeys(seqDef);
    const providedKeys = Object.keys(context);
    const allowedUnusedKeys = new Set(['zone']);
    const unusedKeys = providedKeys.filter(k => !templateKeys.has(k) && !allowedUnusedKeys.has(k));
    if (unusedKeys.length > 0) {
      this.publishWarning('hint_sequence_unused_fields', {
        id: hint.id,
        source,
        sequence: sequenceName,
        unused: unusedKeys
      });
    }

    const missingKeys = Array.from(templateKeys).filter(k => !Object.prototype.hasOwnProperty.call(context, k));
    if (missingKeys.length > 0) {
      this.publishWarning('hint_sequence_missing_fields', {
        id: hint.id,
        source,
        sequence: sequenceName,
        missing: missingKeys
      });
      // Option A behavior: warn and continue with empty substitutions.
      missingKeys.forEach((key) => {
        context[key] = '';
      });
    }

    const result = await this.sequenceRunner.runSequence(sequenceName, {
      gameMode: this.currentGameMode,
      ...context
    });

    if (!result?.ok) {
      this.publishWarning('hint_sequence_failed', {
        id: hint.id,
        source,
        sequence: sequenceName,
        message: `Hint sequence '${sequenceName}' failed: ${result?.error || 'unknown_error'}`,
        error: result?.error || 'unknown_error'
      });
      return false;
    }

    return true;
  }

  // Execute speech hint with playSpeech command (audio files only, no TTS)
  async executeSpeechHint(hint, source = 'direct') {
    const file = this.resolveMediaReference(hint.file, `hint:${hint.id || 'speech'}.file`);
    const zone = hint.zone || 'audio';

    if (!file) {
      log.warn('Speech hint has no file - speech hints require audio files (TTS not supported)');
      return false;
    }

    log.info(`Executing speech hint: "${file}" on zone ${zone}`);
    try {
      await this.zones.execute(zone, 'playSpeech', { file });
      return true;
    } catch (e) {
      log.warn(`Failed to execute speech hint:`, e.message);
      this.publishWarning('hint_speech_failed', { file, zone, error: e.message });
      return false;
    }
  }

  // Execute audioFx hint with playAudioFX command
  async executeAudioHint(hint, source = 'direct') {
    const file = this.resolveMediaReference(hint.file || hint.audio, `hint:${hint.id || 'audio'}.file`);
    const zone = hint.zone || 'audio';

    if (!file) {
      log.warn('AudioFx hint has no file');
      return false;
    }

    log.info(`Executing audioFx hint: "${file}" on zone ${zone}`);

    try {
      await this.zones.execute(zone, 'playAudioFX', { file });
      return true;
    } catch (e) {
      log.warn(`Failed to execute audioFx hint:`, e.message);
      this.publishWarning('hint_audiofx_failed', { file, zone, error: e.message });
      return false;
    }
  }

  async executeBackgroundHint(hint, source = 'direct') {
    const file = this.resolveMediaReference(hint.file || hint.audio, `hint:${hint.id || 'background'}.file`);
    const zone = hint.zone || 'audio';

    if (!file) {
      log.warn('Background hint has no file');
      return false;
    }

    log.info(`Executing background hint: "${file}" on zone ${zone}`);

    try {
      await this.zones.execute(zone, 'playBackground', { file, loop: hint.loop });
      return true;
    } catch (e) {
      log.warn('Failed to execute background hint:', e.message);
      this.publishWarning('hint_background_failed', { file, zone, error: e.message });
      return false;
    }
  }

  // Execute video hint with playVideo command
  async executeVideoHint(hint, source = 'direct') {
    const file = this.resolveMediaReference(hint.file || hint.video, `hint:${hint.id || 'video'}.file`);
    const zone = hint.zone || 'video';

    if (!file) {
      log.warn('Video hint has no file');
      return false;
    }

    log.info(`Executing video hint: "${file}" on zone ${zone}`);

    try {
      await this.zones.execute(zone, 'playVideo', { file });
      return true;
    } catch (e) {
      log.warn(`Failed to execute video hint:`, e.message);
      this.publishWarning('hint_video_failed', { file, zone, error: e.message });
      return false;
    }
  }

  async executeImageHint(hint, source = 'direct') {
    const file = this.resolveMediaReference(hint.file || hint.image, `hint:${hint.id || 'image'}.file`);
    const zone = hint.zone || 'picture';

    if (!file) {
      log.warn('Image hint has no file');
      return false;
    }

    log.info(`Executing image hint: "${file}" on zone ${zone}`);

    try {
      await this.zones.execute(zone, 'setImage', { file });
      return true;
    } catch (e) {
      log.warn('Failed to execute image hint:', e.message);
      this.publishWarning('hint_image_failed', { file, zone, error: e.message });
      return false;
    }
  }

  // Execute action hint (future-proofed stub)
  async executeActionHint(hint, source = 'direct') {
    const action = hint.action || hint.sequence;

    log.info(`Action hint requested: ${action} (not yet implemented)`);
    this.publishWarning('hint_action_not_implemented', {
      action,
      message: 'Action hints are not yet implemented. Use sequences or cues instead.'
    });

    // Future: could execute a named sequence or cue
    // For now, just log and return false
    return false;
  }

  // --- PHASE ENGINE METHODS ---

  /**
   * Loads and validates the :phases map for a given game mode.
   * @param {string} gameType The key for the game mode (e.g., 'hc-60').
   * @returns {boolean} True if phases were loaded successfully, false otherwise.
   */
  loadPhases(gameType) {
    const gameConfig = this.cfg.game?.[gameType];
    if (!gameConfig) {
      const availableGameModes = Object.keys(this.cfg.game || {}).join(', ');
      log.error(`[PhaseEngine] Game mode '${gameType}' not found in configuration. Available game modes: ${availableGameModes || 'none'}`);
      this.phases = {};
      return false;
    }

    // Resolve phases from nested/flattened mode definitions and merge enabled global additional phases.
    const phasesConfig = this._getPhasesForMode(gameType);

    if (!phasesConfig || typeof phasesConfig !== 'object') {
      log.error(`[PhaseEngine] No phases found for game mode '${gameType}'. Expected object with phase definitions.`);
      this.phases = {};
      return false;
    }

    // Validate each phase with enhanced validation
    let hasErrors = false;
    const validatedPhases = {};

    for (const [phaseName, phaseConfig] of Object.entries(phasesConfig)) {
      const { errors, warnings } = this.validatePhaseStructure(phaseConfig, phaseName, gameType);

      if (errors.length > 0) {
        log.error(`[PhaseEngine] Invalid phase '${phaseName}' in game mode '${gameType}':`);
        errors.forEach(error => log.error(`  - ${error}`));
        this.publishWarning('phase_validation_error', { mode: gameType, phase: phaseName, errors });
        hasErrors = true;
      } else {
        validatedPhases[phaseName] = phaseConfig;
        if (warnings.length > 0) {
          log.warn(`[PhaseEngine] Phase '${phaseName}' in game mode '${gameType}' has warnings:`);
          warnings.forEach(warning => log.warn(`  - ${warning}`));
        }
      }
    }

    if (hasErrors) {
      log.error(`[PhaseEngine] Game mode '${gameType}' has validation errors. Game may not function correctly.`);
      // Still load valid phases to allow partial functionality
    }

    this.phases = validatedPhases;
    log.info(`[PhaseEngine] Loaded ${Object.keys(this.phases).length} phases for game mode '${gameType}'.`);
    return !hasErrors; // Return false if there were validation errors
  }

  /**
   * Loads global sequences from the configuration.
   */
  loadGlobalSequences() {
    // Merge and flatten all runtime sequence registries into a single lookup map.
    // Room configs define gameplay sequences/schedules under :global :sequences.
    // Control lifecycle hooks live under :system-sequences and :command-sequences.
    const legacySeqs = this.cfg.global?.sequences || {};
    const systemSeqs = this.cfg.global?.['system-sequences'] || {};
    const commandSeqs = this.cfg.global?.['command-sequences'] || {};

    const collectSeqs = (src) => {
      const out = {};
      if (!src || typeof src !== 'object') return out;

      Object.entries(src).forEach(([k, v]) => {
        if (!v || typeof v !== 'object') return;

        // If v looks like a sequence definition, add it directly
        // Sequence indicators: array form, has :sequence array, has :timeline array, or has :schedule array
        const isSeqDef = Array.isArray(v)
          || Array.isArray(v.sequence)
          || (Array.isArray(v.timeline) && typeof v.duration === 'number')
          || Array.isArray(v.schedule);

        if (isSeqDef) {
          out[k] = v;
          return;
        }

        // Don't recurse into command/cue/timeline structures that look like they contain commands/actions
        // These have :timeline/:command/:zone fields but are NOT sequence groups
        if (v.timeline || v.command || v.zone || v.at !== undefined) {
          return;
        }

        // Otherwise assume v is a group (category) containing named sequences; recursively merge children
        const childSeqs = collectSeqs(v);
        Object.assign(out, childSeqs);
      });

      return out;
    };

    const flatLegacy = collectSeqs(legacySeqs);
    const flatSystem = collectSeqs(systemSeqs);
    const flatCommand = collectSeqs(commandSeqs);

    // Legacy gameplay sequences are the base; control registries take priority on name collisions.
    this.globalSequences = { ...flatLegacy, ...flatSystem, ...flatCommand };

    log.info(`[PhaseEngine] Loaded ${Object.keys(this.globalSequences).length} global sequences.`);
  }

  /**
   * Performs comprehensive validation of the entire game configuration.
   * Validates all game modes, their phases, and sequence references.
   * @returns {{valid: boolean, errors: Array, warnings: Array}} Validation results.
   */
  validateGameConfiguration() {
    const allErrors = [];
    const allWarnings = [];

    // Validate global structure
    if (!this.cfg.game || typeof this.cfg.game !== 'object') {
      allErrors.push('Configuration missing :game section or it is not an object.');
      return { valid: false, errors: allErrors, warnings: allWarnings };
    }

    const gameModes = Object.keys(this.cfg.game);
    if (gameModes.length === 0) {
      allErrors.push('No game modes defined in configuration.');
      return { valid: false, errors: allErrors, warnings: allWarnings };
    }

    // Validate each game mode
    for (const [gameType, gameConfig] of Object.entries(this.cfg.game)) {
      if (!gameConfig || typeof gameConfig !== 'object') {
        allErrors.push(`Game mode '${gameType}' is not a valid object.`);
        continue;
      }

      // Check for required phases structure
      // Handle both nested and flattened phase structures
      let phasesConfig = gameConfig.phases;
      if (!phasesConfig) {
        // Try flattened structure
        const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'abort', 'reset'];
        const flattenedPhases = {};
        for (const phaseName of standardPhases) {
          if (gameConfig[phaseName]) {
            flattenedPhases[phaseName] = gameConfig[phaseName];
          }
        }
        if (Object.keys(flattenedPhases).length > 0) {
          phasesConfig = flattenedPhases;
        }
      }

      if (!phasesConfig || typeof phasesConfig !== 'object') {
        allErrors.push(`Game mode '${gameType}' missing phases. Expected object with phase definitions.`);
        continue;
      }

      const phases = Object.keys(phasesConfig);
      if (phases.length === 0) {
        allWarnings.push(`Game mode '${gameType}' has no phases defined.`);
      }

      // Validate each phase in the game mode
      for (const [phaseName, phaseConfig] of Object.entries(phasesConfig)) {
        const { errors, warnings } = this.validatePhaseStructure(phaseConfig, phaseName, gameType);

        errors.forEach(error => allErrors.push(`[${gameType}.${phaseName}] ${error}`));
        warnings.forEach(warning => allWarnings.push(`[${gameType}.${phaseName}] ${warning}`));
      }
    }

    // Check for common required phases
    for (const gameType of gameModes) {
      const gameConfig = this.cfg.game[gameType];
      // Handle both nested and flattened phase structures
      let phases = gameConfig.phases;
      if (!phases) {
        // Try flattened structure
        const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'abort', 'reset'];
        const flattenedPhases = {};
        for (const phaseName of standardPhases) {
          if (gameConfig[phaseName]) {
            flattenedPhases[phaseName] = gameConfig[phaseName];
          }
        }
        phases = flattenedPhases;
      }
      phases = phases || {};
      const phaseNames = Object.keys(phases);

      // These are commonly expected phases - warn if missing
      const expectedPhases = ['intro', 'gameplay', 'solved', 'failed'];
      for (const expectedPhase of expectedPhases) {
        if (!phaseNames.includes(expectedPhase)) {
          allWarnings.push(`Game mode '${gameType}' missing recommended phase '${expectedPhase}'.`);
        }
      }

      const requiredPhases = ['abort', 'reset'];
      for (const requiredPhase of requiredPhases) {
        if (!phaseNames.includes(requiredPhase)) {
          allErrors.push(`Game mode '${gameType}' missing required phase '${requiredPhase}'.`);
        }
      }
    }

    const valid = allErrors.length === 0;

    if (allErrors.length > 0) {
      log.error(`[ConfigValidation] Found ${allErrors.length} configuration errors:`);
      allErrors.forEach(error => log.error(`  - ${error}`));
    }

    if (allWarnings.length > 0) {
      log.warn(`[ConfigValidation] Found ${allWarnings.length} configuration warnings:`);
      allWarnings.forEach(warning => log.warn(`  - ${warning}`));
    }

    return { valid, errors: allErrors, warnings: allWarnings };
  }

  /**
   * Pre-validates all sequence references in the configuration.
   * This should be called after loadGlobalSequences() to ensure all referenced sequences exist.
   * @returns {{valid: boolean, errors: Array, warnings: Array}} Validation results.
   */
  validateAllSequenceReferences() {
    const errors = [];
    const warnings = [];

    if (!this.sequenceRunner) {
      errors.push('SequenceRunner not available for sequence reference validation.');
      return { valid: false, errors, warnings };
    }

    // Track all referenced sequences to find unused global sequences
    const referencedGlobalSequences = new Set();

    // Helper to extract named :fire references that resolve to sequences.
    const extractFireRefs = (arr) => {
      if (!Array.isArray(arr)) return [];
      const refs = [];
      arr.forEach(entry => {
        if (typeof entry?.fire === 'string') refs.push(entry.fire);
        // Recursively check nested sequences
        if (entry?.sequence) refs.push(...extractFireRefs(entry.sequence));
      });
      return refs;
    };

    // Validate sequence references in all game modes
    const gameModes = this.cfg.game || {};
    for (const [gameType, gameConfig] of Object.entries(gameModes)) {
      const phasesConfig = this._getPhasesForMode(gameType);

      if (!phasesConfig) continue;

      for (const [phaseName, phaseConfig] of Object.entries(phasesConfig)) {
        // Check direct phase sequence reference
        if (phaseConfig?.sequence && typeof phaseConfig.sequence === 'string') {
          const sequenceName = phaseConfig.sequence;
          const resolved = this.sequenceRunner.resolveSequence(sequenceName, gameType);

          if (!resolved) {
            errors.push(`Game mode '${gameType}' phase '${phaseName}' references missing sequence '${sequenceName}'. Check global sequences in :global :sequences.`);
          } else if (this.globalSequences[sequenceName]) {
            referencedGlobalSequences.add(sequenceName);
          }
        }

        // Check named phase schedule references
        if (phaseConfig?.schedule && typeof phaseConfig.schedule === 'string') {
          const scheduleName = phaseConfig.schedule;
          const resolvedSchedule = this.sequenceRunner.resolveSequence(scheduleName, gameType);
          if (!resolvedSchedule) {
            errors.push(`Game mode '${gameType}' phase '${phaseName}' references missing schedule '${scheduleName}'.`);
          } else {
            if (this.globalSequences[scheduleName]) referencedGlobalSequences.add(scheduleName);
            const fireRefs = extractFireRefs(resolvedSchedule.schedule || []);
            fireRefs.forEach(seqName => {
              if (this.globalSequences[seqName]) {
                referencedGlobalSequences.add(seqName);
              }
            });
          }
        }
      }
    }

    // Check named :fire references inside global sequence definitions.
    Object.values(this.globalSequences).forEach(seqDef => {
      const seqArray = seqDef?.sequence || [];
      const fireRefs = extractFireRefs(seqArray);
      fireRefs.forEach(seqName => {
        if (this.globalSequences[seqName]) {
          referencedGlobalSequences.add(seqName);
        }
      });
    });

    // Find unused global sequences (likely system/command sequences or truly unused)
    const globalSequenceNames = Object.keys(this.globalSequences);
    for (const globalSeqName of globalSequenceNames) {
      if (!referencedGlobalSequences.has(globalSeqName)) {
        // Only warn about sequences that look like they should be used (not system/command sequences)
        if (!globalSeqName.includes('-sequence') && !globalSeqName.endsWith('-seq')) {
          warnings.push(`Global sequence '${globalSeqName}' is defined but never referenced by any game mode.`);
        }
      }
    }

    const valid = errors.length === 0;

    if (errors.length > 0) {
      log.error(`[SequenceValidation] Found ${errors.length} sequence reference errors:`);
      errors.forEach(error => log.error(`  - ${error}`));
    }

    // Don't log sequence reference warnings - too many false positives for:
    // - Library sequences called by other sequences
    // - Sequences used in :fire commands
    // - Reset/solved/failed handler sequences
    // - Indirectly referenced utility sequences
    // Only actual errors (missing sequences) are important.

    return { valid, errors, warnings };
  }

  /**
   * Runs comprehensive startup validation of the entire configuration.
   * This includes phase structure validation and sequence reference validation.
   * Should be called during initialization after loading global sequences.
   * @returns {{valid: boolean, errors: Array, warnings: Array}} Combined validation results.
   */
  runStartupValidation() {
    log.info('[ConfigValidation] Running comprehensive configuration validation...');

    const configValidation = this.validateGameConfiguration();
    const sequenceValidation = this.validateAllSequenceReferences();

    const combinedErrors = [...configValidation.errors, ...sequenceValidation.errors];
    const combinedWarnings = [...configValidation.warnings, ...sequenceValidation.warnings];
    const overallValid = configValidation.valid && sequenceValidation.valid;

    log.info(`[ConfigValidation] Validation complete: ${overallValid ? 'PASSED' : 'FAILED'} (${combinedErrors.length} errors, ${combinedWarnings.length} warnings)`);

    if (combinedErrors.length > 0) {
      log.error('[ConfigValidation] Configuration has errors that may prevent proper game operation.');
    }

    return {
      valid: overallValid,
      errors: combinedErrors,
      warnings: combinedWarnings
    };
  }

  /**
   * Validates strict phase structure.
   * Rules:
   * - Exactly one of :sequence or :schedule must be defined.
   * - :sequence must be a string name and phase must define numeric :duration/:seconds.
   * - :schedule must be a string name that resolves to a schedule definition with its own duration.
   * - When :schedule is used, phase-level :duration/:seconds is invalid.
   */
  validatePhaseStructure(phaseConfig, phaseName = 'unknown', gameType = 'unknown') {
    const errors = [];
    const warnings = [];

    if (!phaseConfig || typeof phaseConfig !== 'object') {
      errors.push(`Phase '${phaseName}' config must be an object.`);
      return { errors, warnings };
    }

    const hasSequence = phaseConfig.sequence !== undefined;
    const hasSchedule = phaseConfig.schedule !== undefined;

    if (!hasSequence && !hasSchedule) {
      warnings.push(`Phase '${phaseName}' has neither :sequence nor :schedule. It will do nothing.`);
      return { errors, warnings };
    }

    if (hasSequence && hasSchedule) {
      errors.push(`Phase '${phaseName}' defines both :sequence and :schedule. Exactly one is allowed.`);
      return { errors, warnings };
    }

    const phaseDurationRaw = phaseConfig.seconds !== undefined ? phaseConfig.seconds : phaseConfig.duration;
    const phaseDurationNum = Number(phaseDurationRaw);
    const hasPhaseDuration = phaseDurationRaw !== undefined && Number.isFinite(phaseDurationNum) && phaseDurationNum >= 0;

    if (hasSequence) {
      if (typeof phaseConfig.sequence !== 'string') {
        errors.push(`Phase '${phaseName}' must set :sequence to a string sequence name.`);
        return { errors, warnings };
      }

      const sequenceName = phaseConfig.sequence;
      const resolved = this.sequenceRunner?.resolveSequence(sequenceName, gameType);
      if (!resolved) {
        errors.push(`Phase '${phaseName}' references missing sequence '${sequenceName}'. Check global sequences or sequence name.`);
      } else if (Array.isArray(resolved.schedule)) {
        errors.push(`Phase '${phaseName}' sequence '${sequenceName}' resolves to a schedule. Use :schedule "${sequenceName}" instead.`);
      }

      if (!hasPhaseDuration) {
        errors.push(`Phase '${phaseName}' uses :sequence and must define numeric :duration (or :seconds).`);
      }

      return { errors, warnings };
    }

    // hasSchedule
    if (typeof phaseConfig.schedule !== 'string') {
      errors.push(`Phase '${phaseName}' must set :schedule to a string schedule name.`);
      return { errors, warnings };
    }

    if (phaseConfig.duration !== undefined || phaseConfig.seconds !== undefined) {
      errors.push(`Phase '${phaseName}' uses :schedule and must not define :duration/:seconds. Duration is inherited from the schedule definition.`);
    }

    const scheduleName = phaseConfig.schedule;
    const resolvedSchedule = this.sequenceRunner?.resolveSequence(scheduleName, gameType);
    if (!resolvedSchedule) {
      errors.push(`Phase '${phaseName}' references missing schedule '${scheduleName}'.`);
      return { errors, warnings };
    }

    if (!Array.isArray(resolvedSchedule.schedule)) {
      errors.push(`Phase '${phaseName}' schedule '${scheduleName}' must resolve to a definition containing :schedule [].`);
      return { errors, warnings };
    }

    const scheduleDurationRaw = resolvedSchedule.seconds !== undefined ? resolvedSchedule.seconds : resolvedSchedule.duration;
    const scheduleDuration = Number(scheduleDurationRaw);
    if (!(Number.isFinite(scheduleDuration) && scheduleDuration >= 0)) {
      errors.push(`Phase '${phaseName}' schedule '${scheduleName}' must define numeric :duration (or :seconds).`);
    }

    return { errors, warnings };
  }

  resolvePhaseScheduleDefinition(phaseConfig, phaseName = 'unknown') {
    if (!phaseConfig || typeof phaseConfig.schedule !== 'string') {
      return { ok: false, error: 'invalid_schedule_reference' };
    }

    const scheduleName = phaseConfig.schedule;
    let resolved;
    try {
      resolved = this.sequenceRunner.resolveSequence(scheduleName, this.gameType);
    } catch (_) {
      resolved = undefined;
    }

    if (!resolved) {
      return { ok: false, error: 'schedule_not_found', scheduleName };
    }

    if (!Array.isArray(resolved.schedule)) {
      return { ok: false, error: 'schedule_definition_invalid', scheduleName };
    }

    const raw = resolved.seconds !== undefined ? resolved.seconds : resolved.duration;
    const duration = Number(raw);
    if (!(Number.isFinite(duration) && duration >= 0)) {
      return { ok: false, error: 'schedule_duration_invalid', scheduleName };
    }

    if (phaseConfig.duration !== undefined || phaseConfig.seconds !== undefined) {
      const message = `Phase '${phaseName}' uses schedule '${scheduleName}' and also defines :duration/:seconds; phase duration is invalid in schedule mode.`;
      log.error(message);
      this.publishWarning('phase_schedule_duration_conflict', {
        phase: phaseName,
        schedule: scheduleName,
        message
      });
      return { ok: false, error: 'phase_duration_with_schedule', scheduleName };
    }

    return {
      ok: true,
      scheduleName,
      schedule: resolved.schedule,
      duration: Math.round(duration)
    };
  }

  /**
   * Transitions the state machine to a new phase.
   * @param {string} phaseName The name of the phase to transition to (e.g., 'intro', 'gameplay').
   */
  async transitionToPhase(phaseName) {
    const transitionToken = ++this._phaseTransitionToken;

    if (this.currentPhase === phaseName) {
      log.warn(`[PhaseEngine] Already in phase '${phaseName}'. Ignoring transition.`);
      return;
    }

    const phaseConfig = this.phases[phaseName];
    if (!phaseConfig) {
      const availablePhases = Object.keys(this.phases).join(', ');
      log.error(`[PhaseEngine] Attempted to transition to unknown phase '${phaseName}'. Available phases for game mode '${this.gameType}': ${availablePhases || 'none'}`);
      this.publishWarning('unknown_phase', {
        phase: phaseName,
        gameType: this.gameType,
        availablePhases: Object.keys(this.phases)
      });
      return;
    }

    const prevPhase = this.currentPhase || 'none';
    log.info(`[PhaseEngine] Transitioning from phase '${prevPhase}' to '${phaseName}'.`);

    // Cleanup from previous phase
    this.stopUnifiedTimer();
    this.clearAllPhaseSchedules();
    this._closingOutcomeMediaFired.clear();

    // Setup for new phase
    this.currentPhase = phaseName;
    this.currentPhaseConfig = phaseConfig;

    const duration = this.calculatePhaseDuration(phaseConfig, phaseName);
    if (phaseName === 'gameplay') {
      this.remaining = duration;
    } else if (this._isClosingPhase(phaseName)) {
      this.resetRemaining = duration;
    } else {
      this.remaining = duration;
    }

    // Change state with logging and MQTT event
    this.changeState(phaseName, {
      phase: phaseName,
      duration,
      previousPhase: prevPhase
    });

    this.publishEvent('phase_transition', { from: prevPhase, to: phaseName, duration });
    this.publishState();

    // Start unified timer for phases that have visible countdowns or scheduled events
    // - intro/gameplay: use `remaining`
    // - solved/failed/additional closing phases: use `resetRemaining`
    if (phaseName === 'intro' || phaseName === 'gameplay' || this._isClosingPhase(phaseName)) {
      this.startUnifiedTimer();
    }

    // Execute the new phase's logic
    await this.executePhase(phaseName, phaseConfig);

    // Transition was superseded/cancelled while phase logic was executing.
    if (transitionToken !== this._phaseTransitionToken || this.state !== phaseName) {
      return;
    }

    // Post-execution logic (e.g., auto-transition)
    if (phaseName === 'intro') {
      const bridgeResult = await this.sequenceRunner.runControlSequence('intro-to-gameplay-sequence', { gameMode: this.gameType });
      if (!bridgeResult.ok && bridgeResult.error !== 'sequence_not_found') {
        this.publishWarning('intro_to_gameplay_sequence_failed', {
          message: `intro-to-gameplay-sequence failed: ${bridgeResult.error || 'unknown_error'}`,
          error: bridgeResult.error || 'unknown_error'
        });
      }
      this.transitionToPhase('gameplay');
    } else if (phaseName === 'reset') {
      // If we ever enter an explicit 'reset' phase, complete to ready afterwards
      this.changeState('ready', { reason: 'reset_phase_completed' });
      this.publishEvent('reset_completed');
      this.publishState();
    }
  }

  // Trigger end-of-game outcomes and route to proper closing phase
  _triggerEnd(outcome) {
    const out = (outcome || '').toLowerCase();
    const targetPhase = out === 'win' ? 'solved' : 'failed';
    if (this._isClosingPhase(this.state)) {
      log.warn(`[PhaseEngine] End already triggered (current state: ${this.state}); ignoring duplicate '${out}'.`);
      return;
    }
    log.info(`[PhaseEngine] Triggering end: '${out}' → phase '${targetPhase}'`);
    try {
      this.publishEvent('game_end_trigger', { outcome: out, phase: targetPhase });
    } catch (_) { /* non-fatal */ }
    this.transitionToPhase(targetPhase);
  }

  // Dispatcher for individual cue actions with zone-based routing
  async executeCueAction(action, cueKey) {
    const { zone, zones } = action;
    const command = action.command;
    const isRawMqtt = action.publish || command === 'publish';

    // Determine target zones: single zone or array of zones
    const targetZones = zones ? (Array.isArray(zones) ? zones : [zones]) : (zone ? [zone] : []);
    const isMqttRawZoneAction = !isRawMqtt && this.isMqttRawZoneSelection(targetZones);

    try {
      if (isRawMqtt) {
          try {
            const topic = action.topic;
            const payload = (action.payload !== undefined) ? action.payload : action.message;
            if (topic && payload !== undefined) {
              const body = (typeof payload === 'string') ? payload : JSON.stringify(payload);
              this.mqtt.publish(topic, body);
            } else {
              log.warn(`Raw MQTT cue '${cueKey}' missing topic or payload/message`);
            }
          } catch (error) {
            log.warn(`Failed raw MQTT publish in cue ${cueKey}:`, error.message);
          }
          return;
      }

      if (isMqttRawZoneAction) {
        const options = {};
        if (action.payload !== undefined) options.payload = action.payload;
        if (action.message !== undefined) options.message = action.message;
        if (action.qos !== undefined) options.qos = action.qos;
        if (action.retain !== undefined) options.retain = action.retain;

        for (const zoneName of targetZones) {
          try {
            await this.zones.execute(zoneName, undefined, options);
          } catch (error) {
            log.warn(`Failed to execute mqtt-raw payload on zone '${zoneName}' in cue ${cueKey}:`, error.message);
          }
        }
        return;
      }

      if (command) {

        // Route commands to appropriate zone adapter(s)
        log.debug(`executeCueAction: command='${command}', targetZones=[${targetZones.join(', ')}], cueKey='${cueKey}'`);
        if (targetZones.length > 0) {
          for (const zoneName of targetZones) {
            // Route ALL commands through adapter registry for consistent handling
            try {
              // Prepare options from action fields
              const options = {};

              // Handle duration options
              const durSec = Number(action.duration ?? (action.ms !== undefined ? action.ms / 1000 : undefined));
              if (Number.isFinite(durSec)) options.duration = durSec;

              // Handle text options
              const text = action.text || action.message || action.hint;
              if (text) options.text = text;

              // Handle time options - accept explicit time fields: time or mm/ss
              let time = action.time;
              if (!time && (action.mm !== undefined || action.ss !== undefined)) {
                const mm = Number(action.mm || 0);
                const ss = Number(action.ss || 0);
                const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
                time = `${pad(mm)}:${pad(ss)}`;
              }
              if (time) options.time = time;

              // Handle other common options
              if (action.seconds !== undefined || action.sec !== undefined) {
                const seconds = Number(action.seconds ?? action.sec);
                if (Number.isFinite(seconds)) options.duration = seconds;
              }

              // Handle file parameter for media commands
              if (action.file) options.file = this.resolveMediaReference(action.file, `cue:${cueKey}.file`);

              // Handle fadeTime parameter for audio commands
              if (action.fadeTime !== undefined) options.fadeTime = action.fadeTime;

              // Handle display color parameters for clock setDisplayColors command
              if (action.backgroundColor !== undefined) options.backgroundColor = action.backgroundColor;
              if (action.textColor !== undefined) options.textColor = action.textColor;
              if (action.textAlpha !== undefined) options.textAlpha = action.textAlpha;

              // Handle volume parameters for media commands
              if (action.volumeAdjust !== undefined) options.volumeAdjust = action.volumeAdjust;
              if (action.adjustVolume !== undefined) options.adjustVolume = action.adjustVolume;
              if (action.volume !== undefined) options.volume = action.volume;

              // Handle media control parameters
              if (action.loop !== undefined) options.loop = action.loop;
              if (action.autoPlay !== undefined) options.autoPlay = action.autoPlay;

              // Add name/scene to options for lights commands
              if (action.name) options.name = action.name;
              if (action.scene) options.scene = action.scene;

              // Execute command through adapter registry
              log.debug(`executeCueAction: calling zones.execute(zone='${zoneName}', command='${command}', options=${JSON.stringify(options)})`);
              await this.zones.execute(zoneName, command, options);
            } catch (error) {
              log.warn(`Failed to execute command '${command}' on zone '${zoneName}' in cue ${cueKey}:`, error.message);
            }
          }
        } else {
          log.warn(`Command '${command}' specified but no target zones found in cue ${cueKey}`);
        }
      } else if (action.publish) {
        // Handle raw MQTT publish commands (no zone targeting required)
        try {
          const { topic, payload } = action.publish;
          if (topic && payload !== undefined) {
            this.mqtt.publish(topic, payload);
          } else {
            log.warn(`Raw MQTT command in cue ${cueKey} missing topic or payload`);
          }
        } catch (error) {
          log.warn(`Failed to publish MQTT message in cue ${cueKey}:`, error.message);
        }
      }
    } catch (e) {
      log.error(`Cue action failed for ${cueKey}:`, e.message);
    }
  }

  // Fire a cue by name - NEW THREE-TIER MODEL
  async fireCueByName(cueName) {
    if (!cueName) return;

    // Check game-mode specific cues first (priority override)
    const gameModeCue = this.gameType && this.cfg['game-modes']?.[this.gameType]?.cues?.[cueName];

    // Resolve cue: game-mode override first, then global cues
    const cue = gameModeCue
      || (this.cfg.global?.cues && this.cfg.global.cues[cueName]);

    if (!cue) {
      log.warn(`Cue '${cueName}' not found in configuration`);
      return;
    }

    // NEW: Handle direct cue format (single command or command array)
    if (Array.isArray(cue)) {
      // Array of commands - execute all sequentially (await each for blocking commands)
      try {
        for (let index = 0; index < cue.length; index++) {
          await this.executeCueAction(cue[index], `${cueName}[${index}]`);
        }
      } catch (e) {
        log.warn(`executeCueAction failed for cue array ${cueName}: ${e.message}`);
      }
      return;
    }

    // NEW: Handle single command object 
    if (cue.zone || cue.zones || cue.command || cue.publish) {
      // Direct command object - execute and await (blocking for commands like verifyImage)
      try {
        await this.executeCueAction(cue, cueName);
      } catch (e) {
        log.warn(`executeCueAction failed for cue ${cueName}: ${e.message}`);
      }
      return;
    }

    // Sequence-style cues remain supported through the shared sequence runner.
    if (cue && Array.isArray(cue.sequence)) {
      try { await this.sequenceRunner.runCue(cueName, { gameMode: this.gameType }); } catch (e) { log.warn(`runCue failed for ${cueName}: ${e.message}`); }
      return;
    }

    log.warn(`Cue '${cueName}' has unsupported format; use a direct command object, direct command array, or sequence-style cue.`);
  }

  /**
   * Resolve a named sequence using the active runtime lookup order.
   * Returns either the canonical new-format result or the older wrapped shape.
   */
  resolveNamedSequence(name) {
    if (!name) return null;

    try {
      return this.sequenceRunner.resolveSequence(name, this.gameType);
    } catch (_) { /* ignore */ }

    return null;
  }

  /**
   * Fire a sequence by name - supports global sequence lookup with three-tier model
   * @param {string} seqName - Name of the sequence to fire
   * @returns {Promise} Promise that resolves when sequence completes
   */
  async fireSequenceByName(seqName, sequenceContext = {}) {
    if (!seqName) return;
    const resolved = this.resolveNamedSequence(seqName);

    if (!resolved) {
      // Delegate to sequenceRunner's own missing-sequence handling for consistent messaging
      log.warn(`fireSequenceByName: sequence '${seqName}' not resolved via resolvers – delegating to runSequence for detailed warning`);
      try { await this.sequenceRunner.runSequence(seqName, { gameMode: this.gameType, ...(sequenceContext || {}) }); } catch (_) { }
      return;
    }

    // Normalize the resolver output into the appropriate execution path.
    if (Array.isArray(resolved)) {
      // Treat as a simple step array and pass it straight to the runner.
      log.info(`Executing resolved vector sequence '${seqName}' (${resolved.length} steps)`);
      await this.sequenceRunner.runSequenceDefNew(seqName, resolved, { gameMode: this.gameType, ...(sequenceContext || {}) });
      return;
    }

    if (resolved && Array.isArray(resolved.timeline) && typeof resolved.duration === 'number') {
      log.info(`Executing resolved timeline sequence '${seqName}' (duration=${resolved.duration}s)`);
      // Use existing scheduling helper if present
      try { await this.scheduleSequenceTimeline(resolved, seqName); } catch (e) { log.warn(`scheduleSequenceTimeline failed for ${seqName}: ${e.message}`); }
      return;
    }

    if (resolved && Array.isArray(resolved.schedule)) {
      log.warn(`fireSequenceByName: '${seqName}' resolves to a schedule and cannot be fired directly; use :schedule on a phase`);
      return;
    }

    if (resolved && Array.isArray(resolved.sequence)) {
      log.info(`Executing resolved object sequence '${seqName}' (${resolved.sequence.length} steps)`);
      try { await this.sequenceRunner.runSequenceDefNew(seqName, resolved, { gameMode: this.gameType, ...(sequenceContext || {}) }); } catch (e) { log.warn(`runSequenceDefNew failed for ${seqName}: ${e.message}`); }
      return;
    }

    log.warn(`fireSequenceByName: resolved definition for '${seqName}' has unrecognized structure`);
  }

  /**
   * Fire a cue, sequence, or hint by name with automatic type detection.
   * Unified :fire resolves the target by unique name within the active scope.
   * @param {string} name - Name of the cue, sequence, or hint to fire
   * @returns {Promise} Promise that resolves immediately (cues) or when complete (sequences/hints)
   */
  async fireByName(name, fireContext = {}) {
    if (!name) return;

    // Check if this is a hint first.
    const hintCheck = this.lookupHint(name);
    if (hintCheck) {
      await this.fireHint(name, 'fire', fireContext.text ?? null);
      return;
    }

    // Check if this is a cue (try current scope first, then global)
    const scopedCues = this.currentPhaseConfig?.cues || {};
    const globalCues = this.cfg.global?.cues || {};

    if (scopedCues[name] || globalCues[name]) {
      log.debug(`fireByName: '${name}' resolved as CUE (non-blocking)`);
      this.fireCueByName(name);
      return; // Fire-and-forget
    }

    // Check if this is a sequence using the active resolver order.
    const resolved = this.resolveNamedSequence(name);

    if (resolved) {
      if (Array.isArray(resolved.schedule)) {
        log.warn(`fireByName: '${name}' resolves to a schedule and cannot be fired directly; use :schedule on a phase`);
        return;
      }

      log.debug(`fireByName: '${name}' resolved as SEQUENCE (blocking)`);
      const runtimeContext = {};
      if (typeof this.remaining === 'number') {
        runtimeContext.remaining = this.remaining;
        runtimeContext.gameTime = secondsToMMSS(this.remaining);
      }
      if (typeof this.resetRemaining === 'number') {
        runtimeContext.resetRemaining = this.resetRemaining;
        runtimeContext.resetTime = secondsToMMSS(this.resetRemaining);
      }
      try {
        const activeGameMode = this.gameType || this.currentGameMode;
        const phases = activeGameMode ? this._getPhasesForMode(activeGameMode) : null;
        const gameplayPhase = phases && phases.gameplay;
        if (gameplayPhase) {
          const gameplayDuration = this.calculatePhaseDuration(gameplayPhase, 'gameplay');
          if (Number.isFinite(gameplayDuration) && gameplayDuration >= 0) {
            runtimeContext.gameplayDuration = gameplayDuration;
            runtimeContext.selectedGameTime = secondsToMMSS(gameplayDuration);
          }
        }
      } catch (_) { /* ignore */ }
      runtimeContext.gameState = this.state;
      await this.fireSequenceByName(name, { ...runtimeContext, ...fireContext });
      return;
    }

    // Not found in either - log warning
    log.warn(`fireByName: '${name}' not found in cues, sequences, or hints`);
  }

  _buildFireContext(action = {}) {
    const fireContext = {};
    const excludedKeys = new Set([
      'fire', 'hint', 'wait', 'zone', 'zones',
      'command', 'at', 'step', '_comment', 'comment', 'description'
    ]);

    Object.entries(action).forEach(([key, value]) => {
      if (excludedKeys.has(key)) return;
      if (value !== undefined) fireContext[key] = value;
    });

    return fireContext;
  }

  // --- No legacy method aliases ---

  // Simple adapter getter for tests
  getAdapter(zoneName) {
    try { return this.zones?.getZone(zoneName) || null; } catch (_) { return null; }
  }

  isMqttRawZoneSelection(zoneNames = []) {
    return Array.isArray(zoneNames)
      && zoneNames.length > 0
      && zoneNames.every(zoneName => this.getAdapter(zoneName)?.zoneType === 'mqtt-raw');
  }

  // Process a schedule entry with the new three-tier model
  // Note: Schedules are fire-and-forget (don't wait), but we don't await here
  // to maintain non-blocking schedule behavior
  processScheduleEntry(entry, context) {
    // Handle unified fire command (v2.3.0+)
    if (entry.fire) {
      const fireContext = this._buildFireContext(entry);
      // Don't await - schedules are truly fire-and-forget
      this.fireByName(entry.fire, fireContext).catch(e => log.warn(`fireByName '${entry.fire}' failed: ${e.message}`));
    }

    // Handle inline commands (immediate execution) - NEW
    if (entry.zone || entry.zones) {
      this.executeCueAction(entry, context).catch(e => log.warn(`Inline command failed at ${context}: ${e.message}`));
    }

    // Handle game end triggers (unchanged)
    if (entry.end) {
      if (entry.end === 'fail') this._triggerEnd('fail');
      if (entry.end === 'win') this._triggerEnd('win');
    }

    // Developer debug hook (unchanged)
    if (entry.log) {
      try { log.info(`[SCHED LOG] ${String(entry.log)}`); } catch (_) { }
    }
  }

  // Mark an action (e.g., 'box1_opened') which can disable scheduled hints
  markAction(action) {
    if (!action) return false;
    this.markedActions.add(String(action));
    this.publishEvent?.('action_marked', { action: String(action) });
    return true;
  }

  // Normalize hint id to kebab-case-ish used in config
  normalizeHintId(id) { return String(id).trim().replace(/_/g, '-'); }

  // Determine if a scheduled hint should be suppressed due to prior actions/hints
  isScheduledHintSuppressed(hintId) {
    const id = this.normalizeHintId(hintId);
    // Suppress if recently disabled by early/manual firing
    if (this.disabledHints?.has(id)) return true;
    // Heuristic: if an action like 'box1_opened' is marked, suppress hints containing 'box1'
    for (const act of (this.markedActions || [])) {
      const m = String(act).match(/^(.*?)(_opened|_solved|_done|_complete)$/);
      const base = m ? m[1] : String(act);
      const baseHyphen = base.replace(/_/g, '-');
      if (id.includes(baseHyphen)) return true;
    }
    return false;
  }
  /**
   * Schedule a sequence timeline - executes commands at specified times
   * @param {Object} sequence - Sequence definition with timeline array
   * @param {string} seqKey - Sequence name for logging
   */
  scheduleSequenceTimeline(sequence, seqKey) {
    const { duration, timeline } = sequence;

    if (!Array.isArray(timeline)) {
      log.warn(`Sequence ${seqKey} has invalid timeline`);
      return;
    }

    // Sort by descending :at for countdown semantics (or ascending for forward time)
    const sortedTimeline = [...timeline].sort((a, b) => b.at - a.at);

    sortedTimeline.forEach(entry => {
      const delayMs = duration ? (duration - entry.at) * 1000 : entry.at * 1000;
      log.info(`Executing sequence timeline action for ${seqKey} at ${entry.at}s`);
      const execute = () => this.executeSequenceCommands(entry.commands || [], seqKey);
      if (delayMs <= 0) {
        execute();
      } else {
        setTimeout(execute, delayMs);
      }
    });
  }

  /**
   * Execute an array of commands from a sequence timeline entry
   * @param {Array} commands - Array of command objects
   * @param {string} context - Context for logging
   */
  executeSequenceCommands(commands, context) {
    if (!Array.isArray(commands)) return;

    commands.forEach((cmd, index) => {
      try {
        // Handle unified fire command (v2.3.0+)
        if (cmd.fire) {
          this.fireByName(cmd.fire, this._buildFireContext(cmd));
          return;
        }

        // Handle direct commands
        this.executeCueAction(cmd, `${context}[${index}]`);
      } catch (e) {
        log.warn(`Failed to execute command ${index} in sequence ${context}: ${e.message}`);
      }
    });
  }

  // Dynamically list configured media zones from config
  // (removed legacy zones() helper to avoid conflict with adapter registry)


  init() {
    // Alias config sections if EDN used game-modes -> game for internal consumers
    if (!this.cfg.game && this.cfg['game-modes']) {
      this.cfg.game = this.cfg['game-modes'];
    }

    // Enhanced validation of core control sequence categories
    // Runtime validation operates on the canonical transformed sequence registries.
    const missingCategories = [];
    const validationIssues = [];

    const topSystemSeqs = this.cfg.global?.['system-sequences'] || {};
    const topCommandSeqs = this.cfg.global?.['command-sequences'] || {};

    const validateSeqMap = (mapObj, label) => {
      if (!mapObj || typeof mapObj !== 'object') return;
      Object.entries(mapObj).forEach(([seqName, seqDef]) => {
        if (!seqDef || typeof seqDef !== 'object') {
          log.warn(`Sequence '${seqName}' in category '${label}' is not an object; skipping validation`);
          return;
        }

        // If it's not an array-based control sequence, allow timeline/new formats silently
        if (!Array.isArray(seqDef.sequence)) return;

        const validation = this.sequenceRunner.validateSequenceDefinition(seqName, seqDef);
        if (validation.errors.length > 0) {
          log.error(`Sequence ${label}/${seqName} validation errors:`, validation.errors);
          validationIssues.push({ sequence: `${label}/${seqName}`, errors: validation.errors });
          this.publishEvent('sequence_validation_error', { sequence: `${label}/${seqName}`, errors: validation.errors });
        }
        if (validation.warnings.length > 0) {
          log.warn(`Sequence ${label}/${seqName} validation warnings:`, validation.warnings);
          this.publishEvent('sequence_validation_warning', { sequence: `${label}/${seqName}`, warnings: validation.warnings });
        }
      });
    };

    // Validate the canonical system registry.
    let systemMap = topSystemSeqs;
    if (!systemMap || Object.keys(systemMap).length === 0) {
      log.warn(`Required sequence category missing at startup: system`);
      this.publishEvent('sequence_missing_core', { category: 'system' });
      missingCategories.push('system');
    } else {
      validateSeqMap(systemMap, 'system');
    }

    // Validate the canonical command sequence registry.
    let gameActionsMap = topCommandSeqs;
    if (!gameActionsMap || Object.keys(gameActionsMap).length === 0) {
      log.warn(`Required sequence category missing at startup: game-actions`);
      this.publishEvent('sequence_missing_core', { category: 'game-actions' });
      missingCategories.push('game-actions');
    } else {
      validateSeqMap(gameActionsMap, 'game-actions');
    }

    if (missingCategories.length) {
      log.warn(`Missing required sequence categories (${missingCategories.length}): ${missingCategories.join(', ')}`);
    }
    if (validationIssues.length) {
      log.warn(`Sequence validation issues found in ${validationIssues.length} required sequence definitions`);
    }

    // Validate phase-level named sequence references across all game modes
    try {
      const gameModes = this.cfg.game || {};
      Object.entries(gameModes).forEach(([modeKey, modeCfg]) => {
        if (!modeCfg || typeof modeCfg !== 'object') return;

        // Check the new :phases structure
        const phases = modeCfg.phases;
        if (phases && typeof phases === 'object') {
          Object.entries(phases).forEach(([phaseKey, phaseConfig]) => {
            if (!phaseConfig || typeof phaseConfig !== 'object') return;

            const seqRef = phaseConfig.sequence;
            if (seqRef && typeof seqRef === 'string') {
              const resolved = this.sequenceRunner.resolveSequence(seqRef, modeKey);
              if (!resolved) {
                log.warn(`Game mode '${modeKey}' phase '${phaseKey}' references missing sequence '${seqRef}'`);
                this.publishEvent('sequence_missing_phase_reference', { mode: modeKey, phase: phaseKey, sequence: seqRef });
              }
            }
          });
        }
      });
    } catch (e) {
      log.warn('Phase-level sequence validation failed', e.message);
    }

    // Set default game mode (first game in config or defaultMode)
    const gameKeys = Object.keys(this.cfg.game || {});
    this.currentGameMode = (this.cfg.global.defaultMode && this.cfg.game[this.cfg.global.defaultMode])
      ? this.cfg.global.defaultMode
      : (gameKeys.length > 0 ? gameKeys[0] : null);

    log.info(`Default game mode set to: ${this.currentGameMode}`);

    // Execute startup hook before the initial reset to allow install-wide startup behavior.
    (async () => {
      const startupResult = await this.sequenceRunner.runControlSequence('startup-sequence', { gameMode: this.currentGameMode });
      if (!startupResult.ok && startupResult.error !== 'sequence_not_found') {
        this.publishWarning('startup_sequence_failed', {
          message: `startup-sequence failed: ${startupResult.error || 'unknown_error'}`,
          error: startupResult.error || 'unknown_error'
        });
      }

      await this._runResetSequence();
    })().catch((e) => {
      this.publishWarning('startup_bootstrap_failed', {
        message: `Startup bootstrap failed: ${e.message}`,
        error: e.message
      });
    });

    this.startHeartbeat();
  }

  publishState() {
    const gameTopic = this.cfg.global?.mqtt?.['game-topic'];
    if (!gameTopic) {
      log.warn('publishState: game-topic missing in configuration');
      return;
    }

    let timeLeft = secondsToMMSS(this.remaining);

    // Determine time display based on current state
    switch (this.state) {
      case 'intro':
        // During intro, show the intro countdown
        timeLeft = secondsToMMSS(this.remaining);
        break;
      case 'solved':
        timeLeft = secondsToMMSS(this.resetRemaining);
        break;
      case 'failed':
        timeLeft = secondsToMMSS(this.resetRemaining);
        break;
      case 'gameplay':
      case 'paused':
        // timeLeft already set to game time remaining
        break;
      default:
        if (this._isClosingPhase(this.state)) {
          timeLeft = secondsToMMSS(this.resetRemaining);
          break;
        }
        // Other states show 00:00
        timeLeft = '00:00';
        break;
    }

    const statePayload = {
      gameState: this.state,
      timeLeft: timeLeft,
      gameType: this.gameType || '',
      currentGameMode: this.currentGameMode || '',
      phaseType: this._getPhaseType(this.state),
      isClosingPhase: this._isClosingPhase(this.state),
      operatorControl: this._isClosingPhase(this.state)
        ? {
          label: 'Reset',
          command: 'reset',
          style: 'warning',
          confirm: false,
          confirmText: ''
        }
        : {
          label: 'Abort',
          command: 'abort',
          style: 'danger',
          confirm: true,
          confirmText: 'Are you sure?'
        },
    };
    this.mqtt.publish(`${gameTopic}/state`, statePayload);
  }

  publishEvent(event, data = {}) {
    const gameTopic = this.cfg.global?.mqtt?.['game-topic'];
    if (!gameTopic) return; // guard misconfig
    this.mqtt.publish(`${gameTopic}/events`, { event, t: Date.now(), data });
  }

  publishWarning(warning, data = {}) {
    const gameTopic = this.cfg.global?.mqtt?.['game-topic'];
    if (!gameTopic) return; // guard misconfig
    const details = (data && Object.keys(data).length) ? ` ${JSON.stringify(data)}` : '';
    log.warn(`[warnings] ${warning}${details}`);
    this.mqtt.publish(`${gameTopic}/warnings`, { warning, t: Date.now(), data });
  }

  // Helper method to change state with logging and MQTT event
  changeState(newState, context = {}) {
    const oldState = this.state;
    if (oldState === newState) return; // No change needed

    this.state = newState;

    // Build enhanced single-line log with optional context
    try {
      const details = [];
      const gm = this.currentGameMode ? this.currentGameMode.replace(/-/g, '_') : null;
      if (gm) details.push(`gamemode=${gm}`);
      if (context && context.phase) details.push(`phase=${context.phase}`);
      if (context && typeof context.duration === 'number') details.push(`duration=${context.duration}`);
      const suffix = details.length ? ' ' + details.join(' ') : '';
      log.info(`State changed: \"${oldState}\" → \"${newState}\"${suffix}`);
    } catch (_) {
      log.info(`State changed: ${oldState} -> ${newState}`);
    }

    // Publish MQTT event for state change
    this.publishEvent('state_changed', {
      from: oldState,
      to: newState,
      context
    });
  }

  getPhaseDuration(phase) {
    if (!this.gameType || !this.cfg.game || !this.cfg.game[this.gameType]) {
      return 0; // default fallback (no duration known)
    }

    const gameConfig = this.cfg.game[this.gameType];

    // Check transformed config structure: durations are now in gameConfig.durations
    if (gameConfig.durations && gameConfig.durations[phase] !== undefined) {
      if (typeof gameConfig.durations[phase] === 'number') {
        const n = Number(gameConfig.durations[phase]);
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      } else if (gameConfig.durations[phase] && gameConfig.durations[phase].seconds !== undefined) {
        const n = Number(gameConfig.durations[phase].seconds);
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      }
    }

    return 0; // default fallback (no duration configured)
  }

  // New helper: wait for milliseconds
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Register a phase-scoped schedule with the unified timer (non-blocking)
  registerPhaseSchedule(phaseKey, schedule, duration) {
    if (!Array.isArray(schedule) || typeof duration !== 'number' || duration <= 0) return;
    // Normalize entries and attach phase-scoped keys so they can be removed later
    const registered = (schedule || []).map((entry, idx) => {
      const key = `${this.gameType}:${phaseKey}:${idx}:${entry.at}`;
      return { entry: { ...entry, _idx: idx }, key, at: entry.at };
    });
    this._phaseSchedules.set(phaseKey, { entries: registered, duration });
    log.info(`Registered ${registered.length} schedule entries for phase ${phaseKey} (duration ${duration}s)`);

    // Immediately execute any entries scheduled exactly at the phase start (at === duration)
    try {
      registered.forEach(item => {
        if (item.at === duration) {
          this._executeScheduleEntry(phaseKey, item.entry, item.at, {
            contextLabel: 'start',
            checkHintSuppression: false
          });
        }
      });
    } catch (e) { log.warn('phase schedule immediate-fire error', e.message); }
  }

  _executeScheduleEntry(phaseKey, entry, atSeconds, options = {}) {
    if (!entry || typeof entry !== 'object') return;

    const phaseLabel = phaseKey || this.state || 'unknown';
    const atLabel = Number.isFinite(atSeconds) ? `${atSeconds}` : String(atSeconds ?? 'n/a');
    const contextParts = [];
    if (phaseLabel) contextParts.push(`phase ${phaseLabel}`);
    if (options.contextLabel) contextParts.push(options.contextLabel);
    const contextSuffix = contextParts.length ? ` (${contextParts.join(', ')})` : '';

    let primaryLogged = false;
    let actionsTriggered = false;
    const firedActions = [];

    // Handle unified fire command (v2.3.0+)
    if (entry.fire) {
      const fireContext = this._buildFireContext(entry);
      if (this._isClosingPhase(this.state) && (entry.fire === 'win-video' || entry.fire === 'fail-video')) {
        const onceKey = `${this.state}:${entry.fire}`;
        if (this._closingOutcomeMediaFired.has(onceKey)) {
          log.warn(`Skipping duplicate closing media cue '${entry.fire}' in phase '${this.state}'`);
        } else {
          this._closingOutcomeMediaFired.add(onceKey);
          log.info(`Firing '${entry.fire}' at ${atLabel}s${contextSuffix}`);
          this.fireByName(entry.fire, fireContext).catch(e => log.warn(`fireByName '${entry.fire}' failed: ${e.message}`));
          firedActions.push({ type: 'fire', value: entry.fire });
          primaryLogged = true;
          actionsTriggered = true;
        }
      } else {
        log.info(`Firing '${entry.fire}' at ${atLabel}s${contextSuffix}`);
        this.fireByName(entry.fire, fireContext).catch(e => log.warn(`fireByName '${entry.fire}' failed: ${e.message}`));
        firedActions.push({ type: 'fire', value: entry.fire });
        primaryLogged = true;
        actionsTriggered = true;
      }
    }

    if (entry.zone || entry.zones) {
      actionsTriggered = true;
      firedActions.push({ type: 'zone-command' });
      this.executeCueAction(entry, `${phaseLabel}@${atLabel}`).catch(e => log.warn(`Inline command failed at ${phaseLabel}@${atLabel}: ${e.message}`));
    }

    if (entry.end) {
      actionsTriggered = true;
      firedActions.push({ type: 'end', value: entry.end });
      if (entry.end === 'fail') this._triggerEnd('fail');
      if (entry.end === 'win') this._triggerEnd('win');
    }

    if (entry.log) {
      actionsTriggered = true;
      firedActions.push({ type: 'log' });
      try { log.info(`[SCHED LOG] ${String(entry.log)}`); } catch (_) { }
    }

    if (!primaryLogged) {
      if (actionsTriggered) {
        log.info(`Executing schedule entry at ${atLabel}s${contextSuffix}`);
      } else {
        log.info(`Schedule entry at ${atLabel}s${contextSuffix} had no executable actions`);
      }
    }

    if (phaseLabel === 'gameplay' && this.gameplayLogger && firedActions.length > 0) {
      this.gameplayLogger.event('schedule_fired', {
        phase: phaseLabel,
        at_seconds: Number.isFinite(atSeconds) ? atSeconds : null,
        actions: firedActions
      });
    }
  }

  clearPhaseSchedule(phaseKey) {
    if (this._phaseSchedules.has(phaseKey)) {
      this._phaseSchedules.delete(phaseKey);
      log.info(`Cleared phase schedule for ${phaseKey}`);
    }
  }

  // Clear all phase-scoped schedules (useful on phase transitions)
  clearAllPhaseSchedules() {
    if (!this._phaseSchedules || this._phaseSchedules.size === 0) return;
    for (const k of Array.from(this._phaseSchedules.keys())) this._phaseSchedules.delete(k);
    log.info('Cleared all phase-scoped schedules');
  }

  // Calculate phase duration based on strict mode rules.
  calculatePhaseDuration(phaseConfig, phaseName = 'unknown') {
    if (!phaseConfig) return 0;

    if (phaseConfig.schedule !== undefined) {
      const resolved = this.resolvePhaseScheduleDefinition(phaseConfig, phaseName);
      if (resolved.ok) return resolved.duration;
      return 0;
    }

    if (phaseConfig.sequence !== undefined) {
      const raw = phaseConfig.seconds !== undefined ? phaseConfig.seconds : phaseConfig.duration;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.round(n);
      return 0;
    }

    return 0;
  }

  // Execute a phase in strict mode.
  async executePhase(phaseKey, phaseConfig) {
    if (!phaseConfig) return;

    // Sequence mode
    if (phaseConfig.sequence !== undefined) {
      try {
        if (typeof phaseConfig.sequence !== 'string') {
          const message = `Phase '${phaseKey}' must use :sequence "name" syntax in strict mode.`;
          log.error(message);
          this.publishWarning('phase_sequence_invalid_type', { phase: phaseKey, message });
          return;
        }
        await this.sequenceRunner.runControlSequence(phaseConfig.sequence, { gameMode: this.gameType });
      } catch (e) {
        log.warn(`executePhase: sequence execution failed for ${phaseKey}: ${e.message}`);
      }

      // Sequence phase duration comes from phase-level :duration/:seconds
      const waitDurationRaw = phaseConfig.seconds !== undefined ? phaseConfig.seconds : phaseConfig.duration;
      const waitDuration = Number(waitDurationRaw);
      if (Number.isFinite(waitDuration) && waitDuration > 0) {
        await this.wait(waitDuration * 1000);
      }
      return;
    }

    // Schedule mode
    if (phaseConfig.schedule !== undefined) {
      const resolved = this.resolvePhaseScheduleDefinition(phaseConfig, phaseKey);
      if (!resolved.ok) {
        const message = `Phase '${phaseKey}' has invalid schedule configuration (${resolved.error}).`;
        log.error(message);
        this.publishWarning('phase_schedule_invalid', {
          phase: phaseKey,
          schedule: resolved.scheduleName,
          error: resolved.error,
          message
        });
        return;
      }

      this.registerPhaseSchedule(phaseKey, resolved.schedule, resolved.duration);
      return;
    }
  }

  // Legacy reset schedule system removed - replaced with sequences

  async handleCommand(cmd) {
    let name = cmd && cmd.command ? cmd.command : cmd;
    log.info(`Received command: ${name}`, cmd);
    switch (name) {
      case 'reset': {
        return await this._runResetSequence();
      }
      case 'abort': {
        return await this._runAbortSequence({ source: 'command', force: true });
      }
      case 'debugLog': {
        // Developer helper: print a debug/info line via commands topic
        try {
          const msg = (cmd && (cmd.message || cmd.msg || cmd.text || cmd.value)) || '';
          const tag = (cmd && (cmd.tag || cmd.scope || cmd.category)) || 'debug';
          const out = String(msg).trim();
          if (out.length === 0) {
            this.publishWarning('debug_log_empty', { payload: cmd });
            return false;
          }
          const formatted = `[${tag}] ${out}`;
          log.info(formatted);
          this.publishEvent('debug_log', { message: out, tag });
          return true;
        } catch (e) {
          log.warn('debugLog command failed', e.message);
          this.publishWarning('debug_log_failed', { error: e.message, payload: cmd });
          return false;
        }
      }
      case 'start': {
        const mode = cmd && (cmd.mode || cmd.value || cmd.gameType);
        return await this._startViaSequences(mode || this.currentGameMode || (Object.keys(this.cfg.game || {})[0]));
      }
      case 'solve': {
        this._triggerEnd('win');
        return true;
      }
      case 'fail': {
        this._triggerEnd('fail');
        return true;
      }
      case 'triggerPhase': {
        const requestedPhase = cmd && (cmd.phase || cmd.name || cmd.value);
        const phaseName = String(requestedPhase || '').trim();
        if (!phaseName) {
          this.publishWarning('trigger_phase_missing_name', { payload: cmd });
          return false;
        }
        if (!this.phases || !this.phases[phaseName]) {
          this.publishWarning('trigger_phase_unknown', {
            phase: phaseName,
            available: Object.keys(this.phases || {})
          });
          return false;
        }
        await this.transitionToPhase(phaseName);
        return true;
      }
      case 'pause':
        return this._pauseViaSequence();
      case 'resume':
        return this._resumeViaSequence();
      case 'shutdown': {
        const result = await this.sequenceRunner.runControlSequence('software-shutdown-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('software-shutdown-sequence failed, falling back to imperative shutdown');
          this._fallbackShutdown();
        }
        return result.ok;
      }
      case 'reboot': {
        const result = await this.sequenceRunner.runControlSequence('software-restart-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('software-restart-sequence failed, falling back to imperative reboot');
          this._fallbackReboot();
        }
        return result.ok;
      }
      case 'halt': {
        const result = await this.sequenceRunner.runControlSequence('software-halt-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('software-halt-sequence failed, falling back to graceful halt');
          this.gracefulHalt();
        }
        return result.ok;
      }
      case 'machineShutdown': {
        const result = await this.sequenceRunner.runControlSequence('machine-shutdown-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('machine-shutdown-sequence failed, falling back to imperative machine shutdown');
          this.machineShutdown();
        }
        return result.ok;
      }
      case 'machineReboot': {
        const result = await this.sequenceRunner.runControlSequence('machine-reboot-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('machine-reboot-sequence failed, falling back to imperative machine reboot');
          this._fallbackReboot();
        }
        return result.ok;
      }
      case 'sleep':
        return await this.sequenceRunner.runControlSequence('props-sleep-sequence', { gameMode: this.gameType });
      case 'wake':
        return await this.sequenceRunner.runControlSequence('props-wake-sequence', { gameMode: this.gameType });
      case 'restartAdapters':
        return await this.sequenceRunner.runControlSequence('restart-adapters', { gameMode: this.gameType });
      case 'resetting':
        return this.resetting();
      case 'adjustTime':
        return this.adjustTime((cmd && (cmd.delta ?? cmd.seconds)) || 0);
      case 'sendHint': {
        const text = cmd && cmd.text;
        const duration = cmd && (cmd.duration || this.cfg.global.hintDefaultSec || 10);
        const queue = cmd && cmd.queue;

        if (!text) {
          this.publishWarning('sendHint_no_text', { msg: 'sendHint: No text provided' });
          return false;
        }

        log.info(`Sending direct hint: "${text}" (${duration}s)`);

        this.publishEvent('hint_sent', { text, duration, queue });
        return true;
      }
      case 'markAction': {
        const action = cmd && (cmd.action || cmd.value);
        return this.markAction(action);
      }
      case 'pauseResetTimer':
        return this.pauseResetTimer();
      case 'resumeResetTimer':
        return this.resumeResetTimer();
      case 'getState':
        // Immediately publish current state snapshot
        this.publishState();
        this.publishEvent('state_requested');
        return true;
      case 'stopAll':
        {
          const result = await this.sequenceRunner.runControlSequence('stopAll-sequence', { gameMode: this.gameType });
          if (!result.ok && result.error !== 'sequence_not_found') {
            this.publishWarning('stopall_sequence_failed', {
              message: `stopAll-sequence failed: ${result.error || 'unknown_error'}`,
              error: result.error || 'unknown_error'
            });
          }

          // Always hard-stop media as fallback/safety behavior.
          stopAllAcrossZones(this.zones);
          this.publishEvent('all_stopped');
          return true;
        }
      case 'listModes': {
        const modes = Object.keys(this.cfg.game || {});
        this.publishEvent('modes_list', { modes });
        return modes;
      }
      case 'setGameMode': {
        const newMode = cmd && (cmd.mode || cmd.value || cmd.gameMode);
        return await this.setGameMode(newMode);
      }
      case 'emergencyStop': {
        return await this.emergencyStop({ source: 'command' });
      }
      default:
        log.warn('Unknown command', cmd);
        this.publishEvent('command_validation_failed', {
          command: name,
          payload: cmd,
          error: 'unknown_command'
        });
        this.publishWarning('unknown_command', {
          message: `Received unknown command '${name}' - command not recognized by state machine`,
          command: name,
          payload: cmd
        });
        return false;
    }
  }

  async _startViaSequences(gameType) {
    if (!gameType || typeof gameType !== 'string') {
      log.warn('[PhaseEngine] Start command missing valid gameType.');
      return false;
    }
    if (!this.cfg.game[gameType]) {
      this.publishWarning('unknown_game_mode', { mode: gameType });
      log.warn(`[PhaseEngine] Unknown game mode: ${gameType}`);
      return false;
    }
    if (this.state !== 'ready') {
      this.publishWarning('start_ignored_not_ready', { state: this.state });
      log.warn(`[PhaseEngine] Start ignored; not ready (current state: ${this.state})`);
      return false;
    }

    this.gameType = gameType;
    this.loadPhases(gameType);
    this.loadGlobalSequences();

    // Run comprehensive startup validation
    const validationResult = this.runStartupValidation();
    if (!validationResult.valid) {
      log.warn(`Game configuration validation failed for mode '${gameType}'. Some features may not work correctly.`);
    }

    // Start the game by transitioning to the 'intro' phase.
    // The phase engine will handle the rest of the flow.
    await this.transitionToPhase('intro');
    return true;
  }

  _enterGameplayFromStartSequence() {
    this.transitionToPhase('gameplay');
  }

  async setGameMode(newMode) {
    if (!newMode) {
      this.publishEvent('warn', { msg: 'setGameMode: No mode specified' });
      return false;
    }

    // Validate mode exists in configuration
    if (!this.cfg.game[newMode]) {
      this.publishEvent('warn', { msg: `setGameMode: Unknown game mode: ${newMode}` });
      log.warn(`setGameMode ignored: unknown mode '${newMode}'`);
      return false;
    }

    // Check state restrictions - can only change mode during ready or resetting states
    const allowedStates = ['ready', 'resetting'];
    if (!allowedStates.includes(this.state)) {
      this.publishEvent('warn', {
        msg: `setGameMode ignored: cannot change mode during ${this.state} state. Must be in ready or resetting state.`
      });
      log.warn(`setGameMode ignored: game in restricted state '${this.state}'. Allowed states: ${allowedStates.join(', ')}`);
      return false;
    }

    // If mode is already set to the requested mode, no change needed
    if (this.currentGameMode === newMode) {
      log.info(`setGameMode: Mode already set to '${newMode}'`);
      return true;
    }

    // Prevent duplicate reset sequences if one is already running
    if (this._runningSequence) {
      log.warn(`setGameMode ignored: sequence '${this._runningSequence}' already running. Wait for completion.`);
      this.publishEvent('warn', {
        msg: `setGameMode ignored: ${this._runningSequence} sequence in progress`
      });
      return false;
    }

    const oldMode = this.currentGameMode;
    log.info(`Changing game mode from '${oldMode}' to '${newMode}'`);

    // Set new mode
    this.currentGameMode = newMode;
    this.gameType = newMode;

    const modeChangedResult = await this.sequenceRunner.runControlSequence('game-mode-changed-sequence', {
      gameMode: this.gameType,
      oldMode,
      newMode
    });
    if (!modeChangedResult.ok && modeChangedResult.error !== 'sequence_not_found') {
      this.publishWarning('game_mode_changed_sequence_failed', {
        message: `game-mode-changed-sequence failed: ${modeChangedResult.error || 'unknown_error'}`,
        oldMode,
        newMode,
        error: modeChangedResult.error || 'unknown_error'
      });
    }

    // Trigger full reset to apply new mode
    this.reset();

    this.publishEvent('game_mode_changed', { oldMode, newMode });

    return true;
  }

  _getPhasesForMode(gameMode) {
    const gameConfig = this.cfg.game?.[gameMode];
    if (!gameConfig || typeof gameConfig !== 'object') return null;

    const normalized = {};

    if (gameConfig.phases && typeof gameConfig.phases === 'object') {
      Object.entries(gameConfig.phases).forEach(([phaseName, phaseDef]) => {
        if (phaseDef !== undefined) normalized[phaseName] = phaseDef;
      });
    }

    const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'abort', 'reset'];
    for (const phaseName of standardPhases) {
      if (Object.prototype.hasOwnProperty.call(gameConfig, phaseName) && gameConfig[phaseName] !== undefined) {
        normalized[phaseName] = gameConfig[phaseName];
      }
    }

    const additionalPhases = this._resolveAdditionalPhasesForMode(gameConfig, gameMode);
    Object.assign(normalized, additionalPhases);

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  _resolveResetDefinition(gameMode) {
    if (!gameMode) return { config: null, type: null };
    const phases = this._getPhasesForMode(gameMode);
    const gameConfig = this.cfg.game?.[gameMode];
    const resetConfig = (phases && phases.reset) || (gameConfig && gameConfig.reset) || null;

    if (!resetConfig || typeof resetConfig !== 'object') {
      return { config: null, type: null };
    }

    const seq = resetConfig.sequence;
    if (typeof seq === 'string' && seq.trim().length > 0) {
      const resolved = this.sequenceRunner?.resolveSequence?.(seq, gameMode);
      if (resolved) {
        return { config: resetConfig, type: 'named', name: seq, resolved };
      }
      log.info(`[PhaseEngine] Reset sequence '${seq}' not found for mode '${gameMode}'. Skipping.`);
      return { config: resetConfig, type: null };
    }

    if (Array.isArray(seq)) {
      return { config: resetConfig, type: 'inline', inline: { sequence: seq } };
    }

    if (seq && typeof seq === 'object') {
      return { config: resetConfig, type: 'inline', inline: seq };
    }

    return { config: resetConfig, type: null };
  }

  async _runResetSequence() {
    const gameMode = this.gameType || this.currentGameMode;
    const resetDefinition = this._resolveResetDefinition(gameMode);
    const hasExecutableReset = resetDefinition.type === 'named' || resetDefinition.type === 'inline';

    if (this._runningSequence) {
      const requested = resetDefinition.type === 'named'
        ? resetDefinition.name
        : `${gameMode || 'global'}:reset:inline`;
      log.warn(`Reset sequence rejected: ${this._runningSequence} already running`);
      this.publishEvent('sequence_rejected_busy', {
        requested,
        running: this._runningSequence
      });
      return false;
    }

    this.stopUnifiedTimer();
    if (this.clearAllPhaseSchedules) this.clearAllPhaseSchedules();
    this._closingOutcomeMediaFired.clear();
    this.changeState('resetting', { reason: 'reset_sequence_initiated', gameMode });
    this.publishEvent('resetting');

    const globalResetResult = await this.sequenceRunner.runControlSequence('reset-sequence', { gameMode: gameMode || this.gameType });
    if (!globalResetResult.ok && globalResetResult.error !== 'sequence_not_found') {
      this.publishWarning('reset_sequence_global_failed', {
        message: `reset-sequence failed: ${globalResetResult.error || 'unknown_error'}`,
        mode: gameMode,
        error: globalResetResult.error || 'unknown_error'
      });
    }

    if (!hasExecutableReset) {
      log.info(`[PhaseEngine] No reset sequence defined for mode '${gameMode || 'unknown'}'; skipping.`);
      this.changeState('ready', { reason: 'reset_sequence_skipped', gameMode });
      this.idleCounter = 0;
      this.publishEvent('reset_sequence_skipped', { mode: gameMode });
      this.publishState();
      return true;
    }

    this._runningSequence = resetDefinition.type === 'named'
      ? resetDefinition.name
      : `${gameMode || 'global'}:reset:inline`;
    try {
      let result = { ok: true };
      if (resetDefinition.type === 'named') {
        result = await this.sequenceRunner.runControlSequence(resetDefinition.name, { gameMode: this.gameType });
      } else if (resetDefinition.type === 'inline') {
        result = await this.sequenceRunner.runInlineSequence(this._runningSequence, resetDefinition.inline, { gameMode: this.gameType });
      }

      if (result && result.ok) {
        this.changeState('ready', {
          reason: 'reset_sequence_complete',
          sequence: this._runningSequence,
          type: resetDefinition.type
        });
        this.idleCounter = 0;
        this.publishEvent('reset_sequence_complete', {
          est: result.durationEstimate,
          sequence: this._runningSequence,
          type: resetDefinition.type
        });
        this.publishState();
        return true;
      }
      this.publishEvent('reset_sequence_failed', {
        error: result ? result.error : 'unknown',
        sequence: this._runningSequence,
        type: resetDefinition.type
      });
      return false;
    } finally {
      this._runningSequence = null;
    }
  }

  _getPrimaryClockZoneName() {
    if (!this.zones) return null;

    // Prefer explicit "clock" zone name when present.
    if (this.zones.getZone('clock')) {
      return 'clock';
    }

    const clockZones = this.zones.getZonesByType('pxc-clock');
    if (Array.isArray(clockZones) && clockZones.length > 0) {
      return clockZones[0].zoneName;
    }

    return null;
  }

  async _forwardGameClockControl(commandName) {
    const zoneName = this._getPrimaryClockZoneName();
    if (!zoneName) return false;

    try {
      await this.zones.execute(zoneName, commandName, {});
      return true;
    } catch (error) {
      log.warn(`Failed to forward '${commandName}' to clock zone '${zoneName}': ${error.message}`);
      return false;
    }
  }

  _pauseViaSequence() {
    if (this.state !== 'gameplay') return false;

    // Check concurrency (allow pause during other sequences for safety)
    if (this._runningSequence && !['gameplay-start-sequence', 'intro-sequence', 'intro-to-gameplay-sequence'].includes(this._runningSequence)) {
      log.warn(`Pause sequence rejected: ${this._runningSequence} running (not pausable)`);
      this.publishEvent('sequence_rejected_busy', {
        requested: 'pause-sequence',
        runningSequence: this._runningSequence
      });
      return false;
    }

    // Run pause-sequence if present (fire and then pause timers)
    (async () => {
      await this._forwardGameClockControl('pause');
      const result = await this.sequenceRunner.runControlSequence('pause-sequence', { gameMode: this.gameType });
      this.publishEvent('pause_sequence_complete', { ok: result.ok, est: result.durationEstimate });
    })();

    this.changeState('paused', { reason: 'pause_requested' });
    this.stopUnifiedTimer();
    this._runAdjustTimeSequence('pause');
    this.publishEvent('paused');
    this.publishState();
    return true;
  }

  _resumeViaSequence() {
    if (this.state !== 'paused') return false;

    // Check concurrency
    if (this._runningSequence) {
      log.warn(`Resume sequence rejected: ${this._runningSequence} already running`);
      this.publishEvent('sequence_rejected_busy', {
        requested: 'resume-sequence',
        runningSequence: this._runningSequence
      });
      return false;
    }

    (async () => {
      await this._forwardGameClockControl('resume');
      const result = await this.sequenceRunner.runControlSequence('resume-sequence', { gameMode: this.gameType });
      this.publishEvent('resume_sequence_complete', { ok: result.ok, est: result.durationEstimate });
    })();

    this.changeState('gameplay', { reason: 'resume_requested' });

    // Resume is adapter-first: sequences handle adapter commands; no direct adapter calls here
    this.startUnifiedTimer();
    this._runAdjustTimeSequence('resume');
    this.publishEvent('resumed');
    this.publishState();
    return true;
  }

  startUnifiedTimer() {
    this.stopUnifiedTimer();
    this._unifiedTimer = setInterval(() => {
      // DEBUG: Basic timer tick (disabled for production)
      // if (this.state === 'gameplay' && this.remaining % 10 === 0) {
      //   log.info(`[DEBUG] Timer tick: state=${this.state}, remaining=${this.remaining}`);
      // }

      // Handle different states in single unified timer
      if (this.state === 'intro') {
        // Countdown for intro phase (display only; transition handled by sequence completion)
        this.remaining = Math.max(0, this.remaining - 1);
        // Fire any phase-scoped schedules registered for intro at matching remaining values
        try {
          for (const [phaseKey, data] of this._phaseSchedules) {
            if (phaseKey !== 'intro') continue;
            const entries = data.entries || [];
            entries.forEach(item => {
              if (item.at === this.remaining) {
                this._executeScheduleEntry(phaseKey, item.entry, item.at);
              }
            });
          }
        } catch (e) { log.warn('intro phase schedule tick error', e.message); }
      } else if (this.state === 'gameplay') {
        this.remaining = Math.max(0, this.remaining - 1);

        // DEBUG: Log every 10 seconds to track timer progress (disabled for production)
        // if (this.remaining % 10 === 0) {
        //   log.info(`[DEBUG] Gameplay timer: ${this.remaining}s remaining (state: ${this.state})`);
        // }

        // Also check phase-scoped schedules and fire any entries matching remaining
        try {
          for (const [phaseKey, data] of this._phaseSchedules) {
            if (phaseKey !== this.state) continue; // only process current gameplay phase

            // DEBUG: Log schedule details every 10 seconds (disabled for production)
            // if (this.remaining % 10 === 0) {
            //   const entries = data.entries || [];
            //   log.info(`[DEBUG] Checking phase ${phaseKey}, ${entries.length} entries, looking for time ${this.remaining}`);
            //   entries.slice(0, 3).forEach(item => {
            //     log.info(`[DEBUG] Entry: at=${item.at}, entry=${JSON.stringify(item.entry)}`);
            //   });
            // }

            const entries = data.entries || [];
            entries.forEach(item => {
              if (item.at === this.remaining) {
                this._executeScheduleEntry(phaseKey, item.entry, item.at);
              }
            });
          }
        } catch (e) { log.warn('phase schedule tick error', e.message); }
        if (this.remaining === 0) {
          this._triggerEnd('fail');
        }
      } else if (this.state === 'ready') {
        const idleCfg = this.cfg.sequences.idle;
        if (idleCfg && idleCfg.enabled) {
          const intervalSeconds = idleCfg.interval || 300;
          this.idleCounter++;
          if (this.idleCounter >= intervalSeconds) {
            this.idleCounter = 0;
            this.sequenceRunner.runControlSequence('idle');
          }
        }
      } else if (this._isClosingPhase(this.state) && !this.resetPaused) {
        // Closing phases (solved/failed/additional): countdown resetRemaining and fire any phase-scoped schedules
        this.resetRemaining = Math.max(0, this.resetRemaining - 1);

        // Fire any registered phase schedule entries that match remaining time
        try {
          for (const [phaseKey, data] of this._phaseSchedules) {
            if (phaseKey !== this.state) continue; // only process current closing phase
            const entries = data.entries || [];
            entries.forEach(item => {
              if (item.at === this.resetRemaining) {
                this._executeScheduleEntry(phaseKey, item.entry, item.at, { checkHintSuppression: false });
              }
            });
          }
        } catch (e) { log.warn('closing phase schedule tick error', e.message); }

        if (this.resetRemaining === 0) {
          this.stopUnifiedTimer();

          (async () => {
            const closingResult = await this.sequenceRunner.runControlSequence('closing-complete-sequence', { gameMode: this.gameType, phase: this.state });
            if (!closingResult.ok && closingResult.error !== 'sequence_not_found') {
              this.publishWarning('closing_complete_sequence_failed', {
                message: `closing-complete-sequence failed: ${closingResult.error || 'unknown_error'}`,
                phase: this.state,
                error: closingResult.error || 'unknown_error'
              });
            }

            // Auto-advance to explicit reset phase if defined; otherwise fallback to reset sequence
            if (this.phases && this.phases['reset']) {
              this.transitionToPhase('reset');
            } else {
              this._runResetSequence();
            }
          })();
        }
      }
      // per-second state publication handled by heartbeat
    }, 1000);
  }
  stopUnifiedTimer() { if (this._unifiedTimer) { clearInterval(this._unifiedTimer); this._unifiedTimer = null; } }

  // Legacy method aliases removed - now using unified timer methods directly

  pauseResetTimer() {
    this.resetPaused = true;
    this.publishEvent('reset_timer_paused');
  }

  resumeResetTimer() {
    this.resetPaused = false;
    this.publishEvent('reset_timer_resumed');
  }

  startHeartbeat() {
    this.stopHeartbeat();
    // Use canonical camelCase form only - no fallback chains
    let interval = this.cfg?.global?.settings?.gameHeartbeatMs ?? 1000;
    // Ensure numeric and reasonable
    interval = Number(interval) || 1000;
    if (interval < 50) interval = 50; // protect against absurdly small values
    this.heartbeat = setInterval(() => {
      this.publishState();
      // Clean up expired disabled hints every 10 seconds
      if (Date.now() % 10000 < interval) {
        this.cleanupExpiredHints();
      }
    }, interval);
  }
  stopHeartbeat() { if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; } }

  cleanupExpiredHints() {
    const now = Date.now();
    const timeoutMs = 2000; // 2 seconds
    const expiredHints = [];

    for (const [hintId, disabledTime] of this.disabledHints) {
      if (now - disabledTime >= timeoutMs) {
        expiredHints.push(hintId);
      }
    }

    expiredHints.forEach(hintId => {
      this.disabledHints.delete(hintId);
      log.debug(`Cleaned up expired disabled hint: ${hintId}`);
    });

    if (expiredHints.length > 0) {
      log.info(`Cleaned up ${expiredHints.length} expired disabled hints`);
    }
  }

  pause() {
    if (this.state !== 'gameplay') return;
    log.info('Pausing game');
    this.changeState('paused', { reason: 'direct_pause_method' });

    this.stopUnifiedTimer();
    this._runAdjustTimeSequence('pause');
    this.publishEvent('paused');
    this.publishState();
  }

  resume() {
    if (this.state !== 'paused') return;
    log.info('Resuming game');
    this.changeState('gameplay', { reason: 'direct_resume_method' });

    // Adapter commands are handled via sequences/config; no direct clock calls
    this.startUnifiedTimer();
    this._runAdjustTimeSequence('resume');
    this.publishEvent('resumed');
    this.publishState();
  }

  reset(version = 'default') {
    this.stopUnifiedTimer();
    this.changeState('resetting', { reason: 'direct_reset_method', version });
    this.mode = null;
    this.remaining = 0;

    this.publishEvent('reset_started', { version });
    this.publishState();

    // Execute reset sequence (replaces legacy setup sequence)
    this._runResetSequence();
  }

  async _runAbortSequence({ source = 'command', force = false } = {}) {
    if (!force && !['intro', 'gameplay', 'paused', 'solved', 'failed'].includes(this.state)) {
      return false;
    }

    this._phaseTransitionToken++;
    this.stopUnifiedTimer();
    this.clearAllPhaseSchedules();

    if (this.phases && this.phases.abort) {
      await this.transitionToPhase('abort');
      return true;
    }

    this.publishWarning('abort_phase_missing', {
      message: 'Abort command received but no abort phase is defined; falling back to reset sequence',
      source
    });
    return await this._runResetSequence();
  }

  async runErrorSequence(reason = 'unknown_error', details = {}) {
    const result = await this.sequenceRunner.runControlSequence('error-sequence', {
      gameMode: this.gameType,
      reason,
      ...details
    });

    if (!result.ok && result.error !== 'sequence_not_found') {
      this.publishWarning('error_sequence_failed', {
        message: `error-sequence failed: ${result.error || 'unknown_error'}`,
        reason,
        error: result.error || 'unknown_error'
      });
    }

    return result.ok;
  }

  async emergencyStop({ source = 'command' } = {}) {
    // Preempt in-flight transitions and scheduled phase actions.
    this._phaseTransitionToken++;
    this.stopUnifiedTimer();
    this.clearAllPhaseSchedules();

    // Immediate hard cleanup first.
    stopAllAcrossZones(this.zones);

    const emergencyResult = await this.sequenceRunner.runControlSequence('emergency-stop-sequence', {
      gameMode: this.gameType,
      source,
      state: this.state
    });

    if (!emergencyResult.ok && emergencyResult.error !== 'sequence_not_found') {
      this.publishWarning('emergency_stop_sequence_failed', {
        message: `emergency-stop-sequence failed: ${emergencyResult.error || 'unknown_error'}`,
        error: emergencyResult.error || 'unknown_error'
      });
    }

    const resetOk = await this._runResetSequence();
    if (!resetOk) {
      this.stopUnifiedTimer();
      this.clearAllPhaseSchedules();
      stopAllAcrossZones(this.zones);
      this.changeState('ready', { reason: 'emergency_stop_fallback_ready' });
      this.publishState();
    }

    this.publishEvent('emergency_stop_complete', {
      source,
      emergencySequenceOk: emergencyResult.ok,
      resetOk
    });
    return true;
  }





  completeReset() {
    this.stopUnifiedTimer();
    this.changeState('ready', { reason: 'complete_reset_method' });
    this.idleCounter = 0;
    this.publishEvent('reset_completed');
    this.publishState();
  }



  adjustTime(deltaSeconds) {
    if (!['gameplay', 'paused'].includes(this.state)) return;
    const parsedDelta = Number(deltaSeconds);
    const delta = Number.isFinite(parsedDelta) ? Math.trunc(parsedDelta) : 0;
    if (delta === 0) return;

    const before = this.remaining;
    this.remaining = Math.max(0, this.remaining + delta);
    if (this.remaining !== before) {
      // Fire adjust-time-sequence for adapter side effects (clock sync, etc.)
      this._runAdjustTimeSequence('adjust_time');
      this.publishEvent('time_adjusted', { delta, remaining: this.remaining });
      this.publishState();
    }
  }

  _runAdjustTimeSequence(reason = 'unspecified') {
    // Keep clock synchronization behavior centralized for pause/resume/adjustTime flows.
    (async () => {
      const result = await this.sequenceRunner.runControlSequence('adjust-time-sequence', { gameMode: this.gameType });
      this.publishEvent('adjust_time_sequence_complete', { ok: result.ok, reason });
    })();
  }

  // Graceful halt: best-effort stop using adapters via zone registry
  gracefulHalt() {
    try {
      // Stop all media across zones first
      stopAllAcrossZones(this.zones);
    } catch (_) { }

    // No direct adapter calls; sequences/config should manage clock/lights behavior if needed

    this.publishEvent('graceful_halt');
    return true;
  }

  // --- Hint Management ---

  hintEmoji(type) { return Hints.hintEmoji(type); }

  normalizeGlobalHint(key, h) { return Hints.normalizeGlobalHint(key, h); }

  normalizeGameHint(idx, h) { return Hints.normalizeGameHint(idx, h); }

  getCombinedHints(gameHintsArray) { return Hints.getCombinedHints(this.cfg, gameHintsArray); }

  /**
   * Check and process scheduled entries for the current state and remaining time.
   * Primarily used for testing to manually trigger schedule processing.
   */
  checkSchedule() {
    if (this.state === 'gameplay') {
      try {
        for (const [phaseKey, data] of this._phaseSchedules) {
          if (phaseKey !== this.state) continue; // only process current gameplay phase

          const entries = data.entries || [];
          entries.forEach(item => {
            if (item.at === this.remaining) {
              this._executeScheduleEntry(phaseKey, item.entry, item.at, {
                contextLabel: 'manual-check'
              });
            }
          });
        }
      } catch (e) {
        log.warn('Schedule check error:', e.message);
      }
    }
  }
}

module.exports = GameStateMachine;
