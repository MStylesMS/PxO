// Modular Configuration Adapter
// Transforms the new modular building-block configuration format to the legacy format expected by existing game code

// Supports both JSON and EDN configuration formats

const fs = require('fs');
const log = require('./logger');
const EdnConfigLoader = require('./edn-config-loader');
const { expandTemplates } = require('./template-expander');

class ModularConfigAdapter {
  /**
   * Load configuration from file with automatic format detection
   * @param {string} format - 'json' or 'edn' (defaults to 'json')
   * @param {string} configPath - Path to config file
   * @returns {Object} Legacy format configuration
   */
  static loadConfig(format = 'json', configPath = null) {
    let modular;

    if (format === 'edn') {
      // Load EDN configuration
      const ednPath = configPath || './config/houdini.edn';
      log.info(`Loading EDN configuration from: ${ednPath}`);
      modular = EdnConfigLoader.load(ednPath);
      // Phase 1: template expansion (EDN only)
      try {
        modular = expandTemplates(modular);
      } catch (e) {
        log.error('Template expansion failed:', e.message);
        throw e;
      }

      // Validate EDN structure using our loader
      try {
        EdnConfigLoader.validateConfig(modular);
        log.info('EDN configuration validation passed');
      } catch (error) {
        log.error('EDN configuration validation failed:', error.message);
        throw error;
      }
    } else {
      // Load JSON configuration
      let jsonPath = configPath || './config/houdini.json';
      if (!configPath && !fs.existsSync(jsonPath)) {
        // Fallback to historical path used by tests/fixtures
        jsonPath = './config/example.json';
      }
      log.info(`Loading JSON configuration from: ${jsonPath}`);
      modular = require(jsonPath);
    }

    // Transform to legacy format
    return this.transform(modular);
  }

  static transform(modular) {
    // Validate root keys
    if (!modular['game-modes']) throw new Error('Modular config missing game-modes section');

    // Helper: build legacy game block for each game mode
    function buildGameModes(games, mediaVideos) {
      const out = {};
      Object.entries(games).forEach(([mode, g]) => {
        // Skip non-game properties like "comment"
        if (mode === 'comment' || typeof g !== 'object' || !g) return;
        if (!g['short-label'] && !g.shortLabel) return; // require short label in either raw or camel form
        const shortLabel = g.shortLabel || g['short-label'];
        const gameLabel = g.gameLabel || g['game-label'];

        // Helper to normalize a phase object with optional duration, sequence, and schedule
        const normalizePhase = (p) => {
          if (!p || typeof p !== 'object') return undefined;
          const phase = {};

          if (typeof p.duration === 'number') {
            phase.duration = p.duration;
          }

          if (p.sequence !== undefined) {
            if (Array.isArray(p.sequence) || typeof p.sequence === 'string') {
              phase.sequence = p.sequence;
            } else if (p.sequence && typeof p.sequence === 'object') {
              phase.sequence = { ...p.sequence };
            }
          }

          if (Array.isArray(p.schedule)) {
            phase.schedule = p.schedule;
          }

          return Object.keys(phase).length ? phase : undefined;
        };

        // Extract phases from nested :phases structure if present
        const phases = g.phases || {};
        const intro = g.intro || phases.intro;
        const gameplay = g.gameplay || g.game || phases.gameplay;
        const solved = g.solved || g.win || phases.solved;
        const failed = g.failed || g.fail || phases.failed;
        const reset = g.reset || phases.reset;

        out[mode] = {
          // UI properties for the control interface
          shortLabel,
          gameLabel,
          hints: g.hints || [],

          // Legacy game properties for the state machine
          // Prefer an explicit top-level schedule for the mode if present; else gameplay/game scoped schedule
          schedule: (g.schedule) || (gameplay && gameplay.schedule) || [],
          durations: {
            game: (gameplay && gameplay.duration) || g.game?.duration,
            intro: intro ? { seconds: intro.duration, timerPretext: intro['timer-pretext'] || intro.timerPretext } : undefined,
            solved: solved ? { seconds: solved.duration, timerPretext: solved['timer-pretext'] || solved.timerPretext } : undefined,
            failed: failed ? { seconds: failed.duration, timerPretext: failed['timer-pretext'] || failed.timerPretext } : undefined,
            // Legacy mappings for backward compatibility
            win: (solved || g.win) ? { seconds: (solved || g.win).duration, timerPretext: (solved || g.win)['timer-pretext'] || (solved || g.win).timerPretext } : undefined,
            fail: (failed || g.fail) ? { seconds: (failed || g.fail).duration, timerPretext: (failed || g.fail)['timer-pretext'] || (failed || g.fail).timerPretext } : undefined
          },
          media: {
            intro: intro ? mediaVideos[intro.media] || intro.media : undefined
          },
          setup: g.setup,
          // Preserve per-mode sequence overrides for resolver to find (e.g., start-sequence)
          sequences: g.sequences || undefined,
          // Pass through phase objects for state machine to execute sequences and schedules
          intro: normalizePhase(intro),
          gameplay: normalizePhase(gameplay),
          solved: normalizePhase(solved),
          failed: normalizePhase(failed),
          reset: normalizePhase(reset)
        };
      });
      return out;
    }

    function transformStartupSequences(modular) {
      // Setup sequences are now handled by reset-sequence in unified sequence system
      // Return empty object to maintain compatibility
      return {};
    }

    // Media catalog removed in refactor. Provide empty map fallback.
    const videos = (modular.global.media && modular.global.media.videos) || {};

    // Map hints into legacy location (cfg.global.media.hints) expected by state machine
    const hints = modular.global.hints || {};
    // Build media root only if legacy consumers still expect it; otherwise minimal stub
    const mediaRoot = modular.global.media ? { ...modular.global.media } : {};
    if (mediaRoot.audio && mediaRoot.audio['hint-fx']) {
      mediaRoot.hintFx = mediaRoot.audio['hint-fx'];
    }
    mediaRoot.hints = hints;

    const settings = modular.global.settings || {};
    // Build topics required by legacy tests: ui.base_topic, clock.base_topic, fx.<zone>.base_topic
    const topics = { ...(modular.global.mqtt?.topics || {}) };
    const base = modular.global?.mqtt?.['game-topic'] || 'paradox/houdini';
    topics.ui = topics.ui || { base_topic: base };
    topics.clock = topics.clock || { base_topic: `${base}/clock` };
    topics.lights = topics.lights || { base_topic: `${base}/lights` };
    const zones = modular.global?.mqtt?.zones || {};
    topics.fx = topics.fx || {};
    Object.entries(zones).forEach(([zone, zcfg]) => {
      const zbase = zcfg && (zcfg['base-topic'] || zcfg.baseTopic) || `${base}/${zone}`;
      topics.fx[zone] = topics.fx[zone] || {};
      topics.fx[zone].base_topic = zbase;
    });
    const legacy = {
      global: {
        // Preserve expected camelCase property names but read from raw hyphenated keys
        defaultMode: settings['default-mode'],
        showClockThresholdSec: settings['show-clock-threshold-sec'],
        clockFadeMs: settings['clock-fade-ms'],
        hintDefaultSec: settings['hint-default-sec'],
        gameHeartbeat: settings['game-heartbeat'],
        // Canonical ms-suffixed form for runtime intervals (kebab-case EDN -> camelCase runtime)
        gameHeartbeatMs: settings['game-heartbeat-ms'],
        introDebounceMs: settings['intro-debounce-ms'],
        timeRemainingPretext: settings['time-remaining-pretext'],
        mqtt: { ...(modular.global.mqtt || {}), topics },
        media: Object.keys(mediaRoot).length > 0 ? {
          ...mediaRoot,
          fail: videos.fail_standard || 'fail.mp4',
          win: videos.win_standard || 'win_mm.mp4'
        } : undefined,
        // Preserve both legacy 'cues' and new 'actions' naming for cue registry
        cues: modular.global.cues,
        actions: modular.global.actions,
        // Expose hints registry directly under global for state machine consumption
        hints,
        setup: transformStartupSequences(modular),
        colorScenes: modular.global.lights?.['color-scenes'] || modular.global.lights?.colorScenes || modular.global.colorScenes || modular.global['color-scenes'],
        // System sequences for core game operations (Phase 3) - support both old and new structure
        // The EDN schema has evolved: sequences that used to live under
        // :global :sequences {:system {}} and :global :sequences {:game-actions {}}
        // are now promoted to top-level keys :system-sequences and :command-sequences.
        // Preserve both locations for backward compatibility.
        'system-sequences': modular.global['system-sequences'] || modular.global.sequences || {},
        // Expose command-sequences for newer EDN layout and fall back to legacy nested game-actions
        'command-sequences': modular.global['command-sequences'] || (modular.global.sequences && modular.global.sequences['game-actions']) || {},
        // Also expose sequences directly for backward compatibility with code expecting cfg.global.sequences
        sequences: modular.global.sequences || {}
      },
      game: buildGameModes(modular['game-modes'], videos)
    };

    // Clean transformation: convert all kebab-case keys to camelCase in MQTT topics
    function kebabToCamelCase(obj) {
      if (!obj || typeof obj !== 'object') return obj;

      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        // Convert kebab-case to camelCase
        const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        result[camelKey] = typeof value === 'object' && value !== null
          ? kebabToCamelCase(value)
          : value;
      }
      return result;
    }

    try {
      if (legacy.global && legacy.global.mqtt && legacy.global.mqtt.topics) {
        // Keep underscores intact for base_topic expected by tests; only convert kebab-case keys
        legacy.global.mqtt.topics = kebabToCamelCase(legacy.global.mqtt.topics);
      }
    } catch (e) {
      log.warn('MQTT topic transformation failed:', e.message);
    }

    // Legacy alias removed (pruned) to encourage use of cfg.global.mqtt only

    log.debug('[Adapter] Transformed configuration:', JSON.stringify(legacy, null, 2));
    log.debug('[Adapter] Fail video structure added:', legacy.global.media.fail);
    return legacy;
  }
}

module.exports = ModularConfigAdapter;
