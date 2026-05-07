// Modular Configuration Adapter
// Transforms modular EDN input into the runtime configuration consumed by the game engine.

// Supports EDN game configuration input.

const log = require('./logger');
const EdnConfigLoader = require('./edn-config-loader');
const { expandTemplates } = require('./template-expander');

class ModularConfigAdapter {
  /**
   * Load configuration from EDN file.
   * @param {string} format - must be 'edn'
   * @param {string} configPath - Path to config file
  * @returns {Object} Runtime configuration
   */
  static loadConfig(format = 'edn', configPath = null) {
    if (format !== 'edn') {
      throw new Error('JSON game configuration is no longer supported. Use EDN input.');
    }

    const ednPath = configPath || './config/game.edn';
    log.debug(`Loading EDN configuration from: ${ednPath}`);
    let modular = EdnConfigLoader.load(ednPath);

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

    // Transform into the current runtime format expected by PxO.
    return this.transform(modular);
  }

  static transform(modular) {
    // Validate root keys
    if (!modular['game-modes']) throw new Error('Modular config missing game-modes section');

    // Helper: build the runtime game block for each game mode.
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

          if (p.schedule !== undefined && (typeof p.schedule === 'string' || Array.isArray(p.schedule))) {
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
        const abort = g.abort || phases.abort;
        const reset = g.reset || phases.reset;
        const additionalPhases = Array.isArray(g['additional-phases'])
          ? g['additional-phases'].slice()
          : (Array.isArray(g.additionalPhases) ? g.additionalPhases.slice() : []);

        const normalizedPhases = {
          intro: normalizePhase(intro),
          gameplay: normalizePhase(gameplay),
          solved: normalizePhase(solved),
          failed: normalizePhase(failed),
          abort: normalizePhase(abort),
          reset: normalizePhase(reset)
        };

        out[mode] = {
          shortLabel,
          gameLabel,
          hints: g.hints || [],

          // Prefer an explicit top-level schedule for the mode if present; else gameplay/game scoped schedule.
          schedule: (g.schedule) || (gameplay && gameplay.schedule) || [],
          durations: {
            intro: intro ? { seconds: intro.duration, timerPretext: intro['timer-pretext'] || intro.timerPretext } : undefined,
            solved: solved ? { seconds: solved.duration, timerPretext: solved['timer-pretext'] || solved.timerPretext } : undefined,
            failed: failed ? { seconds: failed.duration, timerPretext: failed['timer-pretext'] || failed.timerPretext } : undefined
          },
          media: {
            intro: intro ? mediaVideos[intro.media] || intro.media : undefined
          },
          // Preserve per-mode sequence overrides for resolver to find (e.g., start-sequence)
          sequences: g.sequences || undefined,
          // Pass through phase objects for state machine to execute sequences and schedules
          intro: normalizedPhases.intro,
          gameplay: normalizedPhases.gameplay,
          solved: normalizedPhases.solved,
          failed: normalizedPhases.failed,
          abort: normalizedPhases.abort,
          reset: normalizedPhases.reset,
          phases: Object.fromEntries(Object.entries(normalizedPhases).filter(([, value]) => value !== undefined)),
          additionalPhases,
          'additional-phases': additionalPhases
        };
      });
      return out;
    }

    // Media catalog removed in refactor. Provide empty map fallback.
    const videos = (modular.global.media && modular.global.media.videos) || {};

    // Global hints registry
    const hints = modular.global.hints || {};
    // Build media root from global media settings (non-hint assets)
    const mediaRoot = modular.global.media ? { ...modular.global.media } : {};
    if (mediaRoot.audio && mediaRoot.audio['hint-fx']) {
      mediaRoot.hintFx = mediaRoot.audio['hint-fx'];
    }

    const settings = modular.global.settings || {};

    function normalizeTriggerRules(triggerConfig) {
      if (!triggerConfig || typeof triggerConfig !== 'object') {
        return [];
      }

      if (Array.isArray(triggerConfig)) {
        return triggerConfig.filter(rule => rule && typeof rule === 'object');
      }

      if (Array.isArray(triggerConfig.escapeRoomRules)) {
        return triggerConfig.escapeRoomRules.filter(rule => rule && typeof rule === 'object');
      }

      return Object.entries(triggerConfig)
        .map(([name, definition]) => {
          if (!definition || typeof definition !== 'object') {
            return null;
          }

          const trigger = definition.trigger && typeof definition.trigger === 'object'
            ? { ...definition.trigger }
            : {
              topic: definition.topic,
              source: definition.source,
              condition: definition.condition
            };

          const actions = Array.isArray(definition.actions) ? definition.actions : [];
          const whenPhase = definition.whenPhase
            || definition.when_phase
            || definition['when-phase']
            || trigger.whenPhase
            || trigger.when_phase
            || trigger['when-phase']
            || null;

          return {
            name,
            ...(definition.description ? { description: definition.description } : {}),
            ...(whenPhase ? { whenPhase, 'when-phase': whenPhase } : {}),
            trigger,
            actions
          };
        })
        .filter(Boolean);
    }

    const triggerRules = normalizeTriggerRules(modular.global.triggers || {});
    const inputSources = modular.global.inputs
      || modular.global['trigger-sources']
      || modular.global.triggerSources
      || {};
    // Build derived topics consumed by the runtime and tests.
    const topics = { ...(modular.global.mqtt?.topics || {}) };
    const base = modular.global?.mqtt?.['game-topic'];
    if (!base) {
      throw new Error('Missing required config global.mqtt.game-topic');
    }
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
    const runtimeConfig = {
      global: {
        defaultMode: settings['default-mode'],
        showClockThresholdSec: settings['show-clock-threshold-sec'],
        clockFadeMs: settings['clock-fade-ms'],
        hintDefaultSec: settings['hint-default-sec'],
        gameHeartbeat: settings['game-heartbeat'],
        gameHeartbeatMs: settings['game-heartbeat-ms'],
        introDebounceMs: settings['intro-debounce-ms'],
        timeRemainingPretext: settings['time-remaining-pretext'],
        mqtt: { ...(modular.global.mqtt || {}), topics },
        media: Object.keys(mediaRoot).length > 0 ? {
          ...mediaRoot,
          fail: videos.fail_standard || 'fail.mp4',
          win: videos.win_standard || 'win_mm.mp4'
        } : undefined,
        cues: modular.global.cues,
        hints,
        colorScenes: modular.global.lights?.['color-scenes'] || modular.global.lights?.colorScenes || modular.global.colorScenes || modular.global['color-scenes'],
        sequences: modular.global.sequences || {},
        'system-sequences': modular.global['system-sequences'] || {},
        'additional-phases': modular.global['additional-phases'] || {},
        'command-sequences': modular.global['command-sequences'] || {},
        inputs: inputSources,
        triggers: {
          escapeRoomRules: triggerRules
        }
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
      if (runtimeConfig.global && runtimeConfig.global.mqtt && runtimeConfig.global.mqtt.topics) {
        // Keep underscores intact for base_topic expected by tests; only convert kebab-case keys
        runtimeConfig.global.mqtt.topics = kebabToCamelCase(runtimeConfig.global.mqtt.topics);
      }
    } catch (e) {
      log.warn('MQTT topic transformation failed:', e.message);
    }

    log.debug('[Adapter] Transformed configuration:', JSON.stringify(runtimeConfig, null, 2));
    log.debug('[Adapter] Fail video structure added:', runtimeConfig.global.media?.fail);
    return runtimeConfig;
  }
}

module.exports = ModularConfigAdapter;
