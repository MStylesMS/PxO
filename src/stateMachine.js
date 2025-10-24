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

    this.resetPaused = false;


    // Initialize sequence runner (PR_MQTT_PURGE Phase 1)
    this.sequenceRunner = new SequenceRunner({ cfg, zones: this.zones, mqtt, stateMachine: this });
    this._idleLoopTimer = null;
    // Phase-scoped schedule registrations: { phaseKey: [ {entry, _idx, at, key} ] }
    this._phaseSchedules = new Map();

    // --- PHASE ENGINE PROPERTIES ---
    this.phases = {}; // loaded from :phases config (map, not array)
    this.currentPhase = null; // current phase name (string)
    this.currentPhaseConfig = null; // current phase definition object
    this.globalSequences = {}; // loaded from :global :sequences for reference resolution
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
      switch (effectiveHint.type || 'text') {
        case 'text':
          await this.executeTextHint(effectiveHint, source);
          break;
        case 'speech':
          await this.executeSpeechHint(effectiveHint, source);
          break;
        case 'audio':
        case 'audioFx':  // Accept both 'audio' and 'audioFx' for backward compatibility
          await this.executeAudioHint(effectiveHint, source);
          break;
        case 'video':
          await this.executeVideoHint(effectiveHint, source);
          break;
        case 'action':
          await this.executeActionHint(effectiveHint, source);
          break;
        default:
          log.warn(`Unknown hint type: ${effectiveHint.type}`);
          this.publishWarning('hint_unknown_type', { id: hintId, type: effectiveHint.type });
          return false;
      }
      this.publishEvent('hint_executed', { id: hintId, type: effectiveHint.type, source });
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
    const hint = combined.find(h => h.id === hintId);
    if (!hint) {
      // Don't log here - this is called for every :fire check
      return null;
    }

    // Return the hint data
    return hint.data || hint;
  }

  // Execute text hint using :hint-text-seq sequence
  async executeTextHint(hint, source = 'direct') {
    const text = hint.text || hint.displayText || '';
    if (!text) {
      log.warn('Text hint has no text');
      return false;
    }

    log.info(`Executing text hint: "${text}"`);

    // Run the :hint-text-seq with hintText variable
    const ctx = { hintText: text };
    const result = await this.sequenceRunner.runControlSequence('hint-text-seq', ctx);

    if (!result.ok) {
      log.warn(`Text hint sequence failed: ${result.error}`);
      this.publishWarning('hint_text_sequence_failed', { text, error: result.error });
      return false;
    }

    return true;
  }

  // Execute speech hint with playSpeech command (audio files only, no TTS)
  async executeSpeechHint(hint, source = 'direct') {
    const file = hint.file;
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
    const file = hint.file || hint.audio;
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

  // Execute video hint with playVideo command
  async executeVideoHint(hint, source = 'direct') {
    const file = hint.file || hint.video;
    const zone = hint.zone || 'mirror';

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

  // Helper to stop all media across all zones via adapters (delegates to utils)
  stopAllMediaAcrossZones() { // legacy wrapper retained for minimal change surface
    stopAllAcrossZones(this.zones);
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

    // Handle both nested phases structure and flattened phase structure
    let phasesConfig = gameConfig.phases;
    if (!phasesConfig) {
      // Try flattened structure where phases are direct properties (EDN loader behavior)
      const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'reset'];
      const flattenedPhases = {};
      let foundPhases = false;

      for (const phaseName of standardPhases) {
        if (gameConfig.hasOwnProperty(phaseName) && gameConfig[phaseName] !== undefined) {
          flattenedPhases[phaseName] = gameConfig[phaseName];
          foundPhases = true;
        }
      }

      if (foundPhases) {
        phasesConfig = flattenedPhases;
      }
    }

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
    // Support both legacy :global :sequences and new promoted keys :system-sequences and :command-sequences
    // Merge and flatten available locations into a single lookup map for reference resolution.
    const legacySeqs = this.cfg.global?.sequences || {};
    const systemSeqs = this.cfg.global?.['system-sequences'] || {};
    // command-sequences are the new location for game action sequences (previously under game-actions inside sequences)
    const commandSeqs = this.cfg.global?.['command-sequences'] || (legacySeqs['game-actions'] || {});

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

    // Combine with precedence: legacy (explicit global.sequences) -> system -> command
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
        const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'reset'];
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
        const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'reset'];
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

    // Helper to extract :fire-seq references from schedule/sequence arrays
    const extractFireSeqRefs = (arr) => {
      if (!Array.isArray(arr)) return [];
      const refs = [];
      arr.forEach(entry => {
        if (entry?.['fire-seq']) refs.push(entry['fire-seq']);
        if (entry?.fireSeq) refs.push(entry.fireSeq);
        // Recursively check nested sequences
        if (entry?.sequence) refs.push(...extractFireSeqRefs(entry.sequence));
      });
      return refs;
    };

    // Validate sequence references in all game modes
    const gameModes = this.cfg.game || {};
    for (const [gameType, gameConfig] of Object.entries(gameModes)) {
      // Handle both nested and flattened phase structures
      let phasesConfig = gameConfig.phases;
      if (!phasesConfig) {
        // Try flattened structure
        const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'reset'];
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

        // Check :fire-seq references in phase schedules
        if (phaseConfig?.schedule) {
          const fireSeqRefs = extractFireSeqRefs(phaseConfig.schedule);
          fireSeqRefs.forEach(seqName => {
            if (this.globalSequences[seqName]) {
              referencedGlobalSequences.add(seqName);
            }
          });
        }
      }
    }

    // Check :fire-seq references inside global sequence definitions
    Object.values(this.globalSequences).forEach(seqDef => {
      const seqArray = seqDef?.sequence || [];
      const fireSeqRefs = extractFireSeqRefs(seqArray);
      fireSeqRefs.forEach(seqName => {
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
    // - Sequences used in :fire commands (not just :fire-seq)
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
   * Validates the structure of a single phase configuration.
   * A phase must have exactly one of :sequence or :schedule.
   * @param {object} phaseConfig The configuration object for the phase.
   * @param {string} phaseName The name of the phase for error reporting.
   * @param {string} gameType The game mode for error reporting.
   * @returns {{errors: string[], warnings: string[]}} Validation results.
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
    }

    // Rule 2: Validate sequence reference if it's a string (named reference)
    if (hasSequence && typeof phaseConfig.sequence === 'string') {
      const sequenceName = phaseConfig.sequence;
      const resolved = this.sequenceRunner?.resolveSequence(sequenceName, gameType);
      if (!resolved) {
        errors.push(`Phase '${phaseName}' references missing sequence '${sequenceName}'. Check global sequences or sequence name.`);
      }
    }

    // Rule 3: Validate sequence array if it's inline
    if (hasSequence && Array.isArray(phaseConfig.sequence)) {
      if (phaseConfig.sequence.length === 0) {
        warnings.push(`Phase '${phaseName}' has empty sequence array.`);
      } else {
        // Basic validation of sequence steps
        for (let i = 0; i < phaseConfig.sequence.length; i++) {
          const step = phaseConfig.sequence[i];
          if (!step || typeof step !== 'object') {
            errors.push(`Phase '${phaseName}' sequence step ${i + 1} must be an object.`);
            continue;
          }
          const hasCommand = typeof step.command === 'string';
          const hasAction = typeof step.action === 'string';
          const hasFire = step.fire !== undefined;
          const hasFireCue = step['fire-cue'] !== undefined;
          const hasFireSeq = step['fire-seq'] !== undefined;
          const hasWait = step.wait !== undefined || step.command === 'wait';

          if (!hasCommand && !hasAction && !hasFire && !hasFireCue && !hasFireSeq && !hasWait) {
            errors.push(`Phase '${phaseName}' sequence step ${i + 1} missing 'command', 'action', 'fire', 'fire-cue', or 'fire-seq' field.`);
          }
        }
      }
    }

    // Rule 4: Validate schedule array if present
    if (hasSchedule) {
      if (!Array.isArray(phaseConfig.schedule)) {
        errors.push(`Phase '${phaseName}' schedule must be an array if present.`);
      } else if (phaseConfig.schedule.length === 0) {
        warnings.push(`Phase '${phaseName}' has empty schedule array.`);
      } else {
        for (let i = 0; i < phaseConfig.schedule.length; i++) {
          const scheduleItem = phaseConfig.schedule[i];
          if (!scheduleItem || typeof scheduleItem !== 'object') {
            errors.push(`Phase '${phaseName}' schedule item ${i + 1} must be an object.`);
            continue;
          }
          if (typeof scheduleItem.at !== 'number' || scheduleItem.at < 0) {
            errors.push(`Phase '${phaseName}' schedule item ${i + 1} must have valid 'at' time (non-negative number).`);
          }
        }
      }

      const hasDuration = typeof phaseConfig.duration === 'number' || typeof phaseConfig.seconds === 'number';
      if (!hasDuration) {
        warnings.push(`Phase '${phaseName}' defines a schedule but no numeric duration. Schedule entries may not execute.`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Transitions the state machine to a new phase.
   * @param {string} phaseName The name of the phase to transition to (e.g., 'intro', 'gameplay').
   */
  async transitionToPhase(phaseName) {
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

    // Setup for new phase
    this.currentPhase = phaseName;
    this.currentPhaseConfig = phaseConfig;

    const duration = this.calculatePhaseDuration(phaseConfig);
    if (phaseName === 'gameplay') {
      this.remaining = duration;
    } else if (['solved', 'failed'].includes(phaseName)) {
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
    // - solved/failed: use `resetRemaining`
    if (['intro', 'gameplay', 'solved', 'failed'].includes(phaseName)) {
      this.startUnifiedTimer();
    }

    // Execute the new phase's logic
    await this.executePhase(phaseName, phaseConfig);

    // Post-execution logic (e.g., auto-transition)
    if (phaseName === 'intro') {
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
    if (['solved', 'failed'].includes(this.state)) {
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
    const { zone, zones, play, command, scene, volume } = action;

    // Determine target zones: single zone or array of zones
    const targetZones = zones ? (Array.isArray(zones) ? zones : [zones]) : (zone ? [zone] : []);

    try {
      if (play) {
        // Route media commands to appropriate zone adapter(s)
        if (targetZones.length > 0) {
          for (const zoneName of targetZones) {
            let adapter = null;
            try { adapter = this.zones.validateZone(zoneName); } catch (_) { adapter = null; }
            // Prefer 'file' key; support legacy 'video' as alias
            if (adapter) {
              if (play.file || play.video) adapter.playVideo(play.file || play.video, { volumeAdjust: volume });
              if (play.speech) adapter.playSpeech(play.speech, { volumeAdjust: volume });
              if (play.fx) adapter.playAudioFX(play.fx, { volumeAdjust: volume });
              if (play.background) {
                const loop = (action.loop !== undefined) ? !!action.loop : true;
                adapter.playBackground(play.background, loop, { volumeAdjust: volume });
              }
              // Prefer 'file' key; support legacy 'image' as alias
              if (play.file || play.image) adapter.setImage(play.file || play.image);
            }
          }
        } else {
          log.warn(`Play action in cue ${cueKey} missing required 'zone' or 'zones' field`);
        }
      } else if (command) {
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
              if (action.file) options.file = action.file;

              // Handle fadeTime parameter for audio commands
              if (action.fadeTime !== undefined) options.fadeTime = action.fadeTime;

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
              this.zones.execute(zoneName, command, options);
            } catch (error) {
              log.warn(`Failed to execute command '${command}' on zone '${zoneName}' in cue ${cueKey}:`, error.message);
            }
          }
        } else {
          log.warn(`Command '${command}' specified but no target zones found in cue ${cueKey}`);
        }
      } else if (scene && targetZones.length > 0) {
        // Handle scene commands on target zones
        for (const zoneName of targetZones) {
          try {
            const adapter = this.zones.validateZone(zoneName);
            adapter.setScene(scene);
          } catch (error) {
            log.warn(`Failed to execute scene '${scene}' on zone '${zoneName}' in cue ${cueKey}:`, error.message);
          }
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

    // Resolve cue: game-mode override first, then global cues, then legacy fallbacks
    const cue = gameModeCue
      || (this.cfg.global?.cues && this.cfg.global.cues[cueName])
      || (this.cfg.cues && this.cfg.cues[cueName])
      || (this.cfg.global?.actions && this.cfg.global.actions[cueName]); // Legacy fallback

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
    if (cue.zone || cue.zones || cue.command || cue.play || cue.scene) {
      // Direct command object - execute and await (blocking for commands like verifyImage)
      try {
        await this.executeCueAction(cue, cueName);
      } catch (e) {
        log.warn(`executeCueAction failed for cue ${cueName}: ${e.message}`);
      }
      return;
    }

    // LEGACY: Handle timeline-based cues (should be migrated to sequences)
    if (cue && Array.isArray(cue.timeline) && typeof cue.duration === 'number') {
      log.warn(`LEGACY: Cue '${cueName}' uses timeline format - should be migrated to sequence`);
      // Validate cue timeline before scheduling
      const { errors } = this.validateCueTimeline(cue, cueName) || { errors: [] };
      if (errors && errors.length) {
        try { console.error(`[CueValidation] Invalid timeline for '${cueName}': ${errors.join('; ')}`); } catch (_) { }
        return;
      }
      // Schedule timeline actions relative to cue.duration
      try { await this.scheduleCueTimeline(cue, cueName); } catch (e) { log.warn(`scheduleCueTimeline failed for ${cueName}: ${e.message}`); }
      return;
    }

    // LEGACY: Handle old commands/actions array format
    if (cue && (Array.isArray(cue.commands) || Array.isArray(cue.actions))) {
      log.warn(`LEGACY: Cue '${cueName}' uses :commands array format - should be migrated to new format`);
      try {
        const actions = cue.commands || cue.actions || [];
        for (const action of actions) {
          await this.executeCueAction(action, cueName);
        }
      } catch (e) { log.warn(`executeCueAction failed for cue ${cueName}: ${e.message}`); }
      return;
    }

    // Final fallback to sequence runner (shouldn't happen in new model)
    log.warn(`FALLBACK: Cue '${cueName}' format not recognized, trying sequence runner`);
    try { await this.sequenceRunner.runCue(cueName, { gameMode: this.gameType }); } catch (e) { log.warn(`runCue failed for ${cueName}: ${e.message}`); }
  }

  /**
   * Fire a sequence by name - supports global sequence lookup with three-tier model
   * @param {string} seqName - Name of the sequence to fire
   * @returns {Promise} Promise that resolves when sequence completes
   */
  async fireSequenceByName(seqName) {
    if (!seqName) return;
    // Try new-format resolver first (order / namespace agnostic)
    let resolved = null;
    try {
      resolved = this.sequenceRunner.resolveSequenceNew(seqName, this.gameType);
    } catch (_) { /* ignore */ }

    // Fallback to legacy / multi-namespace resolver
    if (!resolved) {
      try { resolved = this.sequenceRunner.resolveSequence(seqName, this.gameType); } catch (_) { /* ignore */ }
    }

    if (!resolved) {
      // Delegate to sequenceRunner's own missing-sequence handling for consistent messaging
      log.warn(`fireSequenceByName: sequence '${seqName}' not resolved via resolvers – delegating to runSequence for detailed warning`);
      try { await this.sequenceRunner.runSequence(seqName, { gameMode: this.gameType }); } catch (_) { }
      return;
    }

    // If resolver returned array or object with timeline/sequence we normalize behavior similar to runSequenceDefNew
    if (Array.isArray(resolved)) {
      // Treat as simple step array (vector). Pass raw array to runner (Fix A) instead of wrapping.
      log.info(`Executing resolved vector sequence '${seqName}' (${resolved.length} steps)`);
      await this.sequenceRunner.runSequenceDefNew(seqName, resolved, { gameMode: this.gameType });
      return;
    }

    if (resolved && Array.isArray(resolved.timeline) && typeof resolved.duration === 'number') {
      log.info(`Executing resolved timeline sequence '${seqName}' (duration=${resolved.duration}s)`);
      // Use existing scheduling helper if present
      try { await this.scheduleSequenceTimeline(resolved, seqName); } catch (e) { log.warn(`scheduleSequenceTimeline failed for ${seqName}: ${e.message}`); }
      return;
    }

    if (resolved && Array.isArray(resolved.sequence)) {
      log.info(`Executing legacy style resolved sequence '${seqName}' (array format)`);
      try { await this.sequenceRunner.runControlSequence(seqName, { gameMode: this.gameType }); } catch (e) { log.warn(`runControlSequence failed for ${seqName}: ${e.message}`); }
      return;
    }

    log.warn(`fireSequenceByName: resolved definition for '${seqName}' has unrecognized structure`);
  }

  /**
   * Fire a cue or sequence by name with automatic type detection
   * Unified :fire command - checks if name is a cue (fire-and-forget) or sequence (blocking)
   * Also detects hints with deprecation warning (use :hint directive instead)
   * @param {string} name - Name of the cue, sequence, or hint to fire
   * @returns {Promise} Promise that resolves immediately (cues) or when complete (sequences/hints)
   */
  async fireByName(name) {
    if (!name) return;
    
    // Check if this is a hint first (DEPRECATED usage)
    const hintCheck = this.lookupHint(name);
    if (hintCheck) {
      log.warn(`⚠️  DEPRECATED: Hint '${name}' triggered via :fire - use :hint directive instead`);
      this.publishWarning('deprecated_fire_for_hint', {
        hint: name,
        message: 'Using :fire for hints is deprecated. Use :hint directive for clarity.',
        migration: `Change {:fire :${name}} to {:hint :${name}}`,
        documentation: 'See docs/CONFIG.md for :hint directive usage'
      });
      await this.fireHint(name, 'fire-deprecated');
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
    
    // Check if this is a sequence (try multiple namespaces)
    let resolved = null;
    try {
      resolved = this.sequenceRunner.resolveSequenceNew(name, this.gameType);
    } catch (_) { /* ignore */ }
    
    if (!resolved) {
      try { 
        resolved = this.sequenceRunner.resolveSequence(name, this.gameType); 
      } catch (_) { /* ignore */ }
    }
    
    if (resolved) {
      log.debug(`fireByName: '${name}' resolved as SEQUENCE (blocking)`);
      await this.fireSequenceByName(name);
      return;
    }
    
    // Not found in either - log warning
    log.warn(`fireByName: '${name}' not found in cues or sequences`);
  }

  // --- No legacy method aliases ---

  // Simple adapter getter for tests
  getAdapter(zoneName) {
    try { return this.zones?.getZone(zoneName) || null; } catch (_) { return null; }
  }

  // Process a schedule entry with the new three-tier model
  // Note: Schedules are fire-and-forget (don't wait), but we don't await here
  // to maintain non-blocking schedule behavior
  processScheduleEntry(entry, context) {
    // Handle unified fire command (v2.3.0+)
    if (entry.fire) {
      // Don't await - schedules are truly fire-and-forget
      this.fireByName(entry.fire);
    }

    // Handle cue execution (fire-and-forget from schedule perspective) - backwards compatibility
    if (entry.fireCue || entry['fire-cue']) {
      const cueName = entry.fireCue || entry['fire-cue'];
      // Don't await - schedules are truly fire-and-forget
      this.fireCueByName(cueName);
    }

    // Handle sequence execution (fire-and-forget from schedule perspective) - backwards compatibility
    if (entry['fire-seq']) {
      const seqName = entry['fire-seq'];
      try {
        // Don't await - schedules are truly fire-and-forget
        this.sequenceRunner.runSequence(seqName, { gameMode: this.gameType });
      } catch (e) {
        log.warn(`runSequence failed for ${seqName}: ${e.message}`);
      }
    }

    // Handle inline commands (immediate execution) - NEW
    if (entry.zone || entry.zones) {
      try {
        this.executeCueAction(entry, context);
      } catch (e) {
        log.warn(`Inline command failed at ${context}: ${e.message}`);
      }
    }

    // DEPRECATED: Support legacy commands array with warning
    if (Array.isArray(entry.commands)) {
      log.warn(`DEPRECATED: Schedule entry at ${context} uses :commands array - migrate to inline syntax or sequences`);
      try { entry.commands.forEach(a => this.executeCueAction(a, context)); } catch (_) { }
    }

    // Handle hint firing (unchanged)
    if (entry.playHint || entry['play-hint']) {
      const hintId = entry.playHint || entry['play-hint'];
      if (!this.isScheduledHintSuppressed(hintId)) this.fireHint(hintId, 'scheduled');
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


  // Validate cue timeline per rules in PR_CUE_REFACTOR.md
  validateCueTimeline(cue, cueKey) {
    const errors = [];
    const warnings = [];
    const { duration, timeline } = cue;

    if (!duration || typeof duration !== 'number' || duration <= 0 || !Number.isInteger(duration)) {
      errors.push(`duration must be positive integer, got ${duration}`);
      return { errors, warnings }; // Early return if no duration
    }

    if (!Array.isArray(timeline)) {
      errors.push('timeline must be an array');
      return { errors, warnings };
    }

    const ats = new Set();
    let hasZero = false;
    let hasDuration = false;

    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i];
      if (!entry || typeof entry !== 'object') {
        errors.push(`timeline[${i}] must be an object`);
        continue;
      }
      const { at, actions } = entry;
      if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at > duration) {
        errors.push(`timeline[${i}].at must be integer 0 <= at <= ${duration}, got ${at}`);
      }
      if (ats.has(at)) {
        warnings.push(`timeline[${i}].at ${at} appears multiple times`);
      }
      ats.add(at);
      if (at === 0) hasZero = true;
      if (at === duration) hasDuration = true;
      if (!Array.isArray(actions)) {
        errors.push(`timeline[${i}].actions must be an array`);
      }
    }

    if (!hasZero) warnings.push('timeline missing entry at :at 0');
    if (!hasDuration) warnings.push(`timeline missing entry at :at ${duration}`);

    return { errors, warnings };
  }

  // Schedule timeline entries with setTimeout
  scheduleCueTimeline(cue, cueKey) {
    const { duration, timeline } = cue;
    // Sort by descending :at for countdown semantics
    const sortedTimeline = [...timeline].sort((a, b) => b.at - a.at);

    sortedTimeline.forEach(entry => {
      const delayMs = (duration - entry.at) * 1000;
      if (delayMs <= 0) {
        // Execute immediately for entries at the start
        log.info(`Executing timeline action for cue ${cueKey} at ${entry.at}s remaining`);
        (entry.actions || []).forEach(a => this.executeCueAction(a, cueKey));
      } else {
        setTimeout(() => {
          log.info(`Executing timeline action for cue ${cueKey} at ${entry.at}s remaining`);
          (entry.actions || []).forEach(a => this.executeCueAction(a, cueKey));
        }, delayMs);
      }
    });
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

      if (delayMs <= 0) {
        // Execute immediately
        log.info(`Executing sequence timeline action for ${seqKey} at ${entry.at}s`);
        this.executeSequenceCommands(entry.commands || [], seqKey);
      } else {
        setTimeout(() => {
          log.info(`Executing sequence timeline action for ${seqKey} at ${entry.at}s`);
          this.executeSequenceCommands(entry.commands || [], seqKey);
        }, delayMs);
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
          this.fireByName(cmd.fire);
          return;
        }

        // Handle fire-cue references (backwards compatibility)
        if (cmd['fire-cue']) {
          this.fireCueByName(cmd['fire-cue']);
          return;
        }

        // Handle fire-seq references (backwards compatibility)
        if (cmd['fire-seq']) {
          this.fireSequenceByName(cmd['fire-seq']);
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
    // New EDN layout exposes sequences either as top-level maps
    // (:system-sequences, :command-sequences) or legacy nested under
    // :global :sequences {:system {} :game-actions {}}. Support both.
    const missingCategories = [];
    const validationIssues = [];

    const legacySeqs = this.cfg.global?.sequences || {};
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

    // Validate 'system' category: prefer top-level system-sequences, fall back to legacy.global.sequences.system
    let systemMap = Object.keys(topSystemSeqs).length ? topSystemSeqs : (legacySeqs.system || {});
    if (!systemMap || Object.keys(systemMap).length === 0) {
      log.warn(`Required sequence category missing at startup: system`);
      this.publishEvent('sequence_missing_core', { category: 'system' });
      missingCategories.push('system');
    } else {
      validateSeqMap(systemMap, 'system');
    }

    // Validate 'game-actions' / command sequences: prefer top-level command-sequences, fall back to legacy.global.sequences.game-actions
    let gameActionsMap = Object.keys(topCommandSeqs).length ? topCommandSeqs : (legacySeqs['game-actions'] || {});
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

    // Execute reset sequence on initialization
    this._runResetSequence();
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
        // Other states show 00:00
        timeLeft = '00:00';
        break;
    }

    const statePayload = {
      gameState: this.state,
      timeLeft: timeLeft,
      gameType: this.gameType || '',
      currentGameMode: this.currentGameMode || '',
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

    // Fallback: check old structure for backward compatibility
    // Map phase names: 'game' -> 'gameplay' 
    const phaseKey = phase === 'game' ? 'gameplay' : phase;
    if (gameConfig[phaseKey] && gameConfig[phaseKey].duration !== undefined) {
      const n = Number(gameConfig[phaseKey].duration);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
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

    // Handle :hint directive (v2.3.1+) - Trigger hint system
    if (entry.hint) {
      const hintId = entry.hint;
      const textOverride = entry.text; // Optional text override
      log.info(`Triggering hint '${hintId}' at ${atLabel}s${contextSuffix}`);
      try {
        // Fire hint without awaiting (fire-and-forget for schedule execution)
        this.fireHint(hintId, 'scheduled', textOverride).catch(e => {
          log.warn(`Hint trigger failed at ${atLabel}s: ${e.message}`);
        });
      } catch (e) {
        log.warn(`Hint trigger setup failed at ${atLabel}s: ${e.message}`);
      }
      primaryLogged = true;
      actionsTriggered = true;
    }

    // Handle unified fire command (v2.3.0+)
    if (entry.fire) {
      log.info(`Firing '${entry.fire}' at ${atLabel}s${contextSuffix}`);
      this.fireByName(entry.fire);
      primaryLogged = true;
      actionsTriggered = true;
    }

    // Handle cue execution - backwards compatibility
    const cueName = entry.fireCue || entry['fire-cue'];
    if (cueName) {
      log.info(`Firing cue '${cueName}' at ${atLabel}s${contextSuffix}`);
      this.fireCueByName(cueName);
      primaryLogged = true;
      actionsTriggered = true;
    }

    // Handle sequence execution - backwards compatibility
    const seqName = entry.fireSeq || entry['fire-seq'];
    if (seqName) {
      log.info(`Firing sequence '${seqName}' at ${atLabel}s${contextSuffix}`);
      try {
        this.sequenceRunner.runSequence(seqName, { gameMode: this.gameType });
      } catch (e) {
        log.warn(`runSequence failed for ${seqName}: ${e.message}`);
      }
      primaryLogged = true;
      actionsTriggered = true;
    }

    if (entry.zone || entry.zones) {
      actionsTriggered = true;
      try {
        this.executeCueAction(entry, `${phaseLabel}@${atLabel}`);
      } catch (e) {
        log.warn(`Inline command failed at ${phaseLabel}@${atLabel}: ${e.message}`);
      }
    }

    if (Array.isArray(entry.commands)) {
      actionsTriggered = true;
      log.warn(`DEPRECATED: Schedule entry at ${phaseLabel}@${atLabel} uses :commands array - migrate to inline syntax or sequences`);
      try { entry.commands.forEach(a => this.executeCueAction(a, `${phaseLabel}@${atLabel}`)); } catch (_) { }
    }

    const hintId = entry.playHint || entry['play-hint'];
    const shouldCheckSuppression = options.checkHintSuppression !== false;
    if (hintId) {
      actionsTriggered = true;
      const suppressed = shouldCheckSuppression && typeof this.isScheduledHintSuppressed === 'function'
        ? this.isScheduledHintSuppressed(hintId)
        : false;
      if (!suppressed) {
        this.fireHint(hintId, 'scheduled');
      }
    }

    if (entry.end) {
      actionsTriggered = true;
      if (entry.end === 'fail') this._triggerEnd('fail');
      if (entry.end === 'win') this._triggerEnd('win');
    }

    if (entry.log) {
      actionsTriggered = true;
      try { log.info(`[SCHED LOG] ${String(entry.log)}`); } catch (_) { }
    }

    if (!primaryLogged) {
      if (actionsTriggered) {
        log.info(`Executing schedule entry at ${atLabel}s${contextSuffix}`);
      } else {
        log.info(`Schedule entry at ${atLabel}s${contextSuffix} had no executable actions`);
      }
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

  // Compatibility wrapper: executeSchedule can be stubbed by tests. By default
  // it registers the schedule non-blocking with the unified timer.
  async executeSchedule(schedule, duration, phaseKey = 'phase') {
    this.registerPhaseSchedule(phaseKey, schedule, duration);
    return;
  }

  // Calculate phase duration from explicit duration or sequence estimate
  calculatePhaseDuration(phaseConfig) {
    if (!phaseConfig) return 0;
    // Handle transformed config structure where duration is stored as 'seconds'
    if (phaseConfig.seconds !== undefined) {
      const n = Number(phaseConfig.seconds);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
    // Fallback to original structure for backward compatibility
    if (phaseConfig.duration !== undefined) {
      const n = Number(phaseConfig.duration);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
    if (phaseConfig.sequence) {
      // If sequence is a name, resolve it first
      const seqRef = phaseConfig.sequence;
      let seqDef;
      try {
        seqDef = this.sequenceRunner.resolveSequence(seqRef, this.gameType);
      } catch (_) { seqDef = undefined; }
      if (seqDef) return this.sequenceRunner.estimateDuration(seqDef);
    }
    return 0;
  }

  // Execute a phase: run sequence first (if present), then schedule, otherwise wait for duration
  async executePhase(phaseKey, phaseConfig) {
    // Run sequence first if present
    if (phaseConfig && phaseConfig.sequence) {
      try {
        if (typeof phaseConfig.sequence === 'string') {
          await this.sequenceRunner.runControlSequence(phaseConfig.sequence, { gameMode: this.gameType });
        } else if (Array.isArray(phaseConfig.sequence) || typeof phaseConfig.sequence === 'object') {
          const seqDef = Array.isArray(phaseConfig.sequence) ? { sequence: phaseConfig.sequence } : phaseConfig.sequence;
          await this.sequenceRunner.runInlineSequence(`${this.gameType}:${phaseKey}`, seqDef, { gameMode: this.gameType });
        }
      } catch (e) {
        log.warn(`executePhase: sequence execution failed for ${phaseKey}: ${e.message}`);
      }
    }

    // Then register schedule with unified timer if present (non-blocking)
    if (phaseConfig && phaseConfig.schedule) {
      let scheduleDuration = typeof phaseConfig.duration === 'number' ? phaseConfig.duration : undefined;
      if (scheduleDuration === undefined && typeof phaseConfig.seconds === 'number') {
        scheduleDuration = phaseConfig.seconds;
      }
      if (scheduleDuration === undefined) {
        scheduleDuration = this.calculatePhaseDuration(phaseConfig);
      }

      if (typeof scheduleDuration === 'number' && scheduleDuration > 0) {
        await this.executeSchedule(phaseConfig.schedule, scheduleDuration, phaseKey);
        return;
      }
    }

    // If no schedule but has duration - wait (blocking) for the phase to complete
    if (phaseConfig) {
      const waitDuration = typeof phaseConfig.duration === 'number'
        ? phaseConfig.duration
        : (typeof phaseConfig.seconds === 'number' ? phaseConfig.seconds : undefined);
      if (typeof waitDuration === 'number' && waitDuration > 0) {
        await this.wait(waitDuration * 1000);
      }
    }
  }

  // Legacy reset schedule system removed - replaced with sequences

  async handleCommand(cmd) {
    let name = cmd && cmd.command ? cmd.command : cmd;
    // Pattern: start:<mode> maps directly to startMode
    if (typeof name === 'string' && name.startsWith('start:')) {
      const mode = name.split(':', 2)[1];
      return await this._startViaSequences(mode);
    }
    log.info(`Received command: ${name}`, cmd);
    switch (name) {
      case 'reset': {
        return await this._runResetSequence();
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
        return await this._startViaSequences(this.currentGameMode || (Object.keys(this.cfg.game || {})[0]));
      }
      case 'solve':
      case 'win': {
        this._triggerEnd('win');
        return true;
      }
      case 'fail': {
        this._triggerEnd('fail');
        return true;
      }
      case 'startMode': { // generic explicit start with provided mode
        const mode = cmd && (cmd.mode || cmd.value || cmd.gameType);
        return await this._startViaSequences(mode);
      }
      case 'pause':
        return this._pauseViaSequence();
      case 'resume':
        return this._resumeViaSequence();
      case 'shutdown': {
        const result = await this.sequenceRunner.runControlSequence('shutdown-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('shutdown-sequence failed, falling back to imperative shutdown');
          this._fallbackShutdown();
        }
        return result.ok;
      }
      case 'reboot': {
        const result = await this.sequenceRunner.runControlSequence('reboot-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('reboot-sequence failed, falling back to imperative reboot');
          this._fallbackReboot();
        }
        return result.ok;
      }
      case 'halt': {
        const result = await this.sequenceRunner.runControlSequence('halt-sequence', { gameMode: this.gameType });
        if (!result.ok) {
          log.warn('halt-sequence failed, falling back to graceful halt');
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
      case 'sleep':
        return await this.sequenceRunner.runControlSequence('sleep-sequence', { gameMode: this.gameType });
      case 'wake':
        return await this.sequenceRunner.runControlSequence('wake-sequence', { gameMode: this.gameType });
      case 'resetting':
        return this.resetting();
      case 'adjustTime':
        return this.adjustTime((cmd && (cmd.delta ?? cmd.seconds)) || 0);
      case 'playHint': {
        const id = cmd && (cmd.id || cmd.value);
        // Route hint execution via commands topic for consistency
        return this.fireHint(id, 'command');
      }
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
        // Convenience command to stop all media across all configured zones outside setup context
        this.stopAllMediaAcrossZones();
        this.publishEvent('all_stopped');
        return true;
      case 'listModes': {
        const modes = Object.keys(this.cfg.game || {});
        this.publishEvent('modes_list', { modes });
        return modes;
      }
      case 'setGameMode': {
        const newMode = cmd && (cmd.mode || cmd.value || cmd.gameMode);
        return this.setGameMode(newMode);
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

  setGameMode(newMode) {
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

    // Trigger full reset to apply new mode
    this.reset();

    this.publishEvent('game_mode_changed', { oldMode, newMode });

    return true;
  }

  _getPhasesForMode(gameMode) {
    const gameConfig = this.cfg.game?.[gameMode];
    if (!gameConfig || typeof gameConfig !== 'object') return null;

    if (gameConfig.phases && typeof gameConfig.phases === 'object') {
      return gameConfig.phases;
    }

    const standardPhases = ['intro', 'gameplay', 'solved', 'failed', 'reset'];
    const flattened = {};
    let found = false;
    for (const phaseName of standardPhases) {
      if (Object.prototype.hasOwnProperty.call(gameConfig, phaseName) && gameConfig[phaseName] !== undefined) {
        flattened[phaseName] = gameConfig[phaseName];
        found = true;
      }
    }
    return found ? flattened : null;
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
    this.changeState('resetting', { reason: 'reset_sequence_initiated', gameMode });
    this.publishEvent('resetting');

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

  _pauseViaSequence() {
    if (this.state !== 'gameplay') return false;

    // Check concurrency (allow pause during other sequences for safety)
    if (this._runningSequence && !['start-sequence', 'intro-sequence'].includes(this._runningSequence)) {
      log.warn(`Pause sequence rejected: ${this._runningSequence} running (not pausable)`);
      this.publishEvent('sequence_rejected_busy', {
        requested: 'pause-sequence',
        runningSequence: this._runningSequence
      });
      return false;
    }

    // Run pause-sequence if present (fire and then pause timers)
    (async () => {
      const result = await this.sequenceRunner.runControlSequence('pause-sequence', { gameMode: this.gameType });
      this.publishEvent('pause_sequence_complete', { ok: result.ok, est: result.durationEstimate });
    })();

    this.changeState('paused', { reason: 'pause_requested' });
    this.stopUnifiedTimer();
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
      const result = await this.sequenceRunner.runControlSequence('resume-sequence', { gameMode: this.gameType });
      this.publishEvent('resume_sequence_complete', { ok: result.ok, est: result.durationEstimate });
    })();

    this.changeState('gameplay', { reason: 'resume_requested' });

    // Resume is adapter-first: sequences handle adapter commands; no direct adapter calls here
    this.startUnifiedTimer();
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
      } else if (['solved', 'failed'].includes(this.state) && !this.resetPaused) {
        // Closing phases (solved/failed): countdown resetRemaining and fire any phase-scoped schedules
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
          // Auto-advance to explicit reset phase if defined; otherwise fallback to reset sequence
          if (this.phases && this.phases['reset']) {
            this.transitionToPhase('reset');
          } else {
            this._runResetSequence();
          }
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
    this.publishEvent('paused');
    this.publishState();
  }

  resume() {
    if (this.state !== 'paused') return;
    log.info('Resuming game');
    this.changeState('gameplay', { reason: 'direct_resume_method' });

    // Adapter commands are handled via sequences/config; no direct clock calls
    this.startUnifiedTimer();
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





  completeReset() {
    this.stopUnifiedTimer();
    this.changeState('ready', { reason: 'complete_reset_method' });
    this.idleCounter = 0;
    this.publishEvent('reset_completed');
    this.publishState();
  }



  adjustTime(deltaSeconds) {
    if (!['gameplay', 'paused'].includes(this.state)) return;
    const before = this.remaining;
    this.remaining = Math.max(1, this.remaining + (deltaSeconds || 0));
    if (this.remaining !== before) {
      // Adapter updates (e.g., clock) should be driven by sequences or external listeners
      this.publishEvent('time_adjusted', { delta: deltaSeconds });
      this.publishState();
    }
  }

  // Graceful halt: best-effort stop using adapters via zone registry
  gracefulHalt() {
    try {
      // Stop all media across zones first
      this.stopAllMediaAcrossZones();
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
