const log = require('./logger');
const {
    getCommandsTopic,
    publishExecuteHint,
    stopAllAcrossZones,
    VERIFY_BROWSER_TIMEOUT_MS,
    VERIFY_MEDIA_TIMEOUT_MS,
} = require('./engineUtils');

/**
 * Sequence Runner (Phase 1 - PR_MQTT_PURGE)
 * Executes control (lifecycle) sequences defined under cfg.global.control-sequences
 * with optional per-mode overrides (future extension) at cfg.game[mode].sequences.
 *
 * Goals Phase 1:
 *  - Provide runControlSequence(name, ctx) returning { ok, durationEstimate, error }
 *  - Depth & cycle protection
 *  - Basic duration estimation: sum wait durations + 1s if at least one wait else 1s
 *  - Support simplified actions needed by initial stub sequences
 */
class SequenceRunner {
    constructor({ cfg, zones, mqtt, stateMachine = null }) {
        this.cfg = cfg;
        this.zones = zones; // AdapterRegistry
        this.mqtt = mqtt;
        this.stateMachine = stateMachine; // Reference to state machine for fire-cue/fire-seq execution
        this.maxDepthDefault = (cfg.global?.settings?.['sequence-max-depth']) || 3;
        // Cache events topic (may not exist early; recompute lazily if missing)
        this._eventsTopic = cfg.global?.mqtt?.['game-topic'] ? `${cfg.global.mqtt['game-topic']}/events` : null;
        // Cache commands topic for publishing playHint as executeHint
        this._commandsTopic = cfg.global?.mqtt?.['game-topic'] ? `${cfg.global.mqtt['game-topic']}/commands` : null;
    }

    // Resolve template variables in strings and objects
    // Supports {{variableName}} syntax for variable substitution
    resolveVariables(obj, context = {}) {
        if (typeof obj === 'string') {
            // Replace all {{variableName}} patterns with context values
            return obj.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
                if (context.hasOwnProperty(varName)) {
                    return String(context[varName]);
                }
                // If variable not found, leave placeholder as-is
                log.debug(`Variable not found in context: ${varName}`);
                return match;
            });
        }

        if (Array.isArray(obj)) {
            // Recursively resolve variables in array elements
            return obj.map(item => this.resolveVariables(item, context));
        }

        if (obj && typeof obj === 'object') {
            // Recursively resolve variables in object properties
            const resolved = {};
            for (const [key, value] of Object.entries(obj)) {
                resolved[key] = this.resolveVariables(value, context);
            }
            return resolved;
        }

        // Return primitive values as-is
        return obj;
    }

    // Map legacy sequence names to new semantic names
    mapLegacySequenceName(name) {
        const legacyMappings = {
            'start-sequence': 'gameplay-start-sequence'
            // Removed solve-sequence and fail-sequence mappings - no longer supported
        };
        return legacyMappings[name] || name;
    }

    // NEW: Resolve sequence from new :sequences section
    resolveSequenceNew(name, gameMode) {
        if (!name) return undefined;
        const convertSequence = (seqDef) => {
            if (!seqDef) return undefined;
            if (Array.isArray(seqDef)) return seqDef;
            if (Array.isArray(seqDef.timeline) && typeof seqDef.duration === 'number') {
                return { duration: seqDef.duration, timeline: seqDef.timeline };
            }
            if (Array.isArray(seqDef.sequence)) {
                return seqDef.sequence;
            }
            return undefined;
        };

        // Prepare name variants for tolerant lookup (raw, normalized, base forms)
        const mapped = this.mapLegacySequenceName(name);
        const normalized = this.normalizeName(mapped || name);
        const base = String(normalized).replace(/-sequence$/, '');
        const variants = [name, mapped, normalized, base, `${base}-sequence`].filter(Boolean);

        const tryLookupIn = (root, key) => {
            if (!root || typeof root !== 'object') return undefined;
            for (const v of variants) {
                if (!v) continue;
                const hit = root[v];
                const conv = convertSequence(hit);
                if (conv) return conv;
            }
            return undefined;
        };

        // 1) Per-mode sequences (overrides)
        if (gameMode && this.cfg['game-modes']?.[gameMode]?.sequences) {
            const perModeRoot = this.cfg['game-modes'][gameMode].sequences;
            const perModeHit = tryLookupIn(perModeRoot);
            if (perModeHit) return perModeHit;
        }

        // 2) Global direct sequences (legacy :global :sequences)
        const globalSeqRoot = this.cfg.global?.sequences;
        const directGlobal = tryLookupIn(globalSeqRoot);
        if (directGlobal) return directGlobal;

        // 3) Top-level system-sequences (may be flat map or grouped map)
        const systemSeqs = this.cfg.global?.['system-sequences'];
        const directSystem = tryLookupIn(systemSeqs);
        if (directSystem) return directSystem;

        // If system-sequences is grouped by category, search nested groups
        if (systemSeqs && typeof systemSeqs === 'object') {
            for (const group of Object.values(systemSeqs)) {
                const nested = tryLookupIn(group);
                if (nested) return nested;
            }
        }

        // 4) Command-sequences (new name replacing game-actions) and legacy nested game-actions
        const cmdSeqRoot = this.cfg.global?.['command-sequences'] || (this.cfg.global?.sequences && this.cfg.global.sequences['game-actions']);
        const cmdHit = tryLookupIn(cmdSeqRoot);
        if (cmdHit) return cmdHit;

        return undefined;
    }

    // NEW: Run sequence definition with new format support
    async runSequenceDefNew(name, seqDef, context = {}) {
        const { gameMode } = context;
        const stack = context._stack || [];
        const depth = stack.length;

        if (depth >= this.maxDepthDefault) {
            log.warn(`SequenceRunner: depth exceeded for ${name} (depth=${depth})`);
            return { ok: false, error: 'sequence_depth_exceeded' };
        }

        if (stack.includes(name)) {
            log.warn(`SequenceRunner: cycle detected attempting to run ${name}`);
            return { ok: false, error: 'sequence_cycle' };
        }

        const newStack = [...stack, name];
        const newContext = { ...context, _stack: newStack };

        try {
            if (Array.isArray(seqDef)) {
                // Vector sequence - execute steps in order
                await this.executeSequenceSteps(seqDef, newContext);
            } else if (seqDef && Array.isArray(seqDef.sequence)) {
                // Wrapper object containing a sequence array (Fix B: accept {sequence:[...]})
                await this.executeSequenceSteps(seqDef.sequence, newContext);
            } else if (seqDef && seqDef.timeline && Array.isArray(seqDef.timeline)) {
                // Timeline sequence - execute with timing
                await this.executeTimelineSequence(seqDef, newContext);
            } else {
                throw new Error(`Invalid sequence format for '${name}'`);
            }

            return { ok: true };

        } catch (error) {
            log.error(`SequenceRunner: error in sequence '${name}': ${error.message}`);
            return { ok: false, error: error.message };
        }
    }

    // NEW: Execute sequence steps (array format)
    async executeSequenceSteps(steps, context) {
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            await this.executeSequenceStep(step, context, i);
        }
    }

    // NEW: Execute timeline sequence
    async executeTimelineSequence(seqDef, context) {
        const { timeline, duration } = seqDef;
        if (typeof duration !== 'number') {
            throw new Error('Timeline sequence must have numeric duration');
        }

        // Sort timeline entries by timing (descending - from future to now)
        const sortedEntries = timeline
            .filter(entry => entry.at !== undefined)
            .sort((a, b) => b.at - a.at);

        // Execute timeline entries at their scheduled times
        // Note: This is a simplified implementation
        // Full implementation would use setTimeout for proper timing
        for (const entry of sortedEntries) {
            const { at, ...command } = entry;
            log.info(`Executing timeline entry at ${at}s`);
            await this.executeSequenceStep(command, context, `timeline@${at}`);
        }
    }

    // NEW: Execute individual sequence step with new syntax support
    async executeSequenceStep(step, context, index) {
        if (!step || typeof step !== 'object') {
            throw new Error(`Step ${index} must be an object`);
        }

        // Resolve template variables in the step using the context
        const resolvedStep = this.resolveVariables(step, context);

        // Handle :wait command
        if (resolvedStep.wait !== undefined) {
            const duration = typeof resolvedStep.wait === 'number' ? resolvedStep.wait : 1;
            log.info(`Waiting ${duration} seconds`);
            await new Promise(resolve => setTimeout(resolve, duration * 1000));
            return;
        }

        // Handle :hint directive (v2.3.1+) - Trigger hint system
        if (resolvedStep.hint) {
            const hintId = resolvedStep.hint;
            const textOverride = resolvedStep.text; // Optional text override
            log.info(`Triggering hint: ${hintId}${textOverride ? ' (with override)' : ''}`);

            if (this.stateMachine && this.stateMachine.fireHint) {
                try {
                    await this.stateMachine.fireHint(hintId, 'sequence', textOverride);
                    log.debug(`Hint execution completed: ${hintId}`);
                } catch (error) {
                    log.error(`Unexpected error triggering hint '${hintId}': ${error.message}`);
                    log.warn(`Continuing sequence execution despite hint error`);
                }
            } else {
                log.warn(`Cannot trigger hint '${hintId}' - stateMachine.fireHint not available`);
            }
            return;
        }

        // Handle unified :fire command (v2.3.0+)
        if (resolvedStep.fire) {
            const name = resolvedStep.fire;
            log.info(`Firing: ${name}`);

            if (this.stateMachine && this.stateMachine.fireByName) {
                try {
                    await this.stateMachine.fireByName(name);
                    log.debug(`Fire execution completed: ${name}`);
                } catch (error) {
                    log.error(`Unexpected error firing '${name}': ${error.message}`);
                    log.warn(`Continuing sequence execution despite fire error`);
                }
            } else {
                log.warn(`Cannot fire '${name}' - stateMachine.fireByName not available`);
            }
            return;
        }

        // Handle :fire-cue (non-blocking cue execution) - backwards compatibility
        if (resolvedStep['fire-cue']) {
            const cueName = resolvedStep['fire-cue'];
            log.info(`Firing cue: ${cueName}`);

            if (this.stateMachine && this.stateMachine.fireCueByName) {
                try {
                    // fireCueByName handles missing cues gracefully (logs warning and returns)
                    // so we don't need to throw errors for missing cues
                    await this.stateMachine.fireCueByName(cueName);
                    log.debug(`Cue execution completed: ${cueName}`);
                } catch (error) {
                    // Only catch actual execution errors, not missing cue warnings
                    log.error(`Unexpected error firing cue '${cueName}': ${error.message}`);
                    // Continue execution - don't fail the whole sequence for cue issues
                    log.warn(`Continuing sequence execution despite cue error`);
                }
            } else {
                log.warn(`Cannot fire cue '${cueName}' - stateMachine not available`);
                // Fallback to event publishing for backward compatibility
                this.publishEvent('fire_cue', { cue: cueName, context: 'sequence' });
            }
            return;
        }

        // Handle :fire-seq (nested sequence execution) - backwards compatibility
        if (resolvedStep['fire-seq']) {
            const seqName = resolvedStep['fire-seq'];
            log.info(`Firing sequence: ${seqName}`);

            if (this.stateMachine && this.stateMachine.fireSequenceByName) {
                try {
                    // fireSequenceByName handles missing sequences gracefully (logs warning and returns)
                    // so we don't need to throw errors for missing sequences
                    await this.stateMachine.fireSequenceByName(seqName);
                    log.debug(`Sequence execution completed: ${seqName}`);
                } catch (error) {
                    // Only catch actual execution errors, not missing sequence warnings
                    log.error(`Unexpected error firing sequence '${seqName}': ${error.message}`);
                    // Continue execution - don't fail the whole sequence for sequence issues
                    log.warn(`Continuing sequence execution despite nested sequence error`);
                }
            } else {
                log.warn(`Cannot fire sequence '${seqName}' - stateMachine not available`);
                // Fallback to local sequence execution
                const result = await this.runSequence(seqName, context);
                if (!result.ok) {
                    log.error(`Nested sequence '${seqName}' failed: ${result.error}`);
                    // For fallback execution, we still continue rather than failing
                    log.warn(`Continuing sequence execution despite nested sequence failure`);
                }
            }
            return;
        }

        const command = resolvedStep.command;

        if (command === 'verifyBrowser') {
            const url = resolvedStep.url;
            const visible = resolvedStep.visible !== undefined ? resolvedStep.visible : null;
            const browserTimeout = resolvedStep.timeout || VERIFY_BROWSER_TIMEOUT_MS;
            const zones = this.extractZones(resolvedStep);
            if (zones.length === 0) {
                log.warn('verifyBrowser step missing :zone or :zones');
                return;
            }
            for (const z of zones) {
                try {
                    const result = await this.zones.execute(z, 'verifyBrowser', { url, visible, timeout: browserTimeout });
                    if (result && result.success === false) {
                        const errorMsg = `Browser verification failed on zone '${z}' after ${browserTimeout}ms timeout`;
                        log.warn(errorMsg);
                        this.publishWarning('browser_verification_failed', errorMsg, { zone: z, timeout: browserTimeout });
                        throw new Error(errorMsg);
                    }
                    this.publishEvent('sequence_verify_browser_ok', { zone: z, url, visible });
                } catch (e) {
                    const errorMsg = `SequenceRunner: verifyBrowser failed on ${z}: ${e.message}`;
                    log.warn(errorMsg);
                    this.publishWarning('browser_verification_error', errorMsg, { zone: z, error: e.message });
                    throw e;
                }
            }
            return;
        }

        if (command === 'verifyImage') {
            const zones = this.extractZones(resolvedStep);
            if (zones.length === 0) { log.warn('verifyImage step missing :zone or :zones'); return; }
            if (!resolvedStep.file) { log.warn('verifyImage step missing :file'); return; }
            const timeout = resolvedStep.timeout || VERIFY_MEDIA_TIMEOUT_MS;
            for (const z of zones) {
                try {
                    const result = await this.zones.execute(z, 'verifyImage', { file: resolvedStep.file, timeout });
                    if (result) {
                        log.info(`SequenceRunner: verifyImage on ${z} - success: ${result.success}, changes: ${JSON.stringify(result)}`);
                        this.publishEvent('sequence_verify_media_ok', { zone: z, result });
                    }
                } catch (e) {
                    const msg = `SequenceRunner: verifyImage failed on ${z}: ${e.message}`;
                    log.warn(msg);
                    this.publishWarning('media_verification_error', msg, { zone: z, error: e.message });
                }
            }
            return;
        }

        // Handle direct zone commands
        if (resolvedStep.zone || resolvedStep.zones) {
            const zones = resolvedStep.zones || [resolvedStep.zone];
            const { zone, zones: zonesField, ...options } = resolvedStep;

            for (const zoneName of zones) {
                try {
                    await this.zones.execute(zoneName, resolvedStep.command, options);
                } catch (error) {
                    log.warn(`Zone command failed on ${zoneName}: ${error.message}`);
                }
            }
            return;
        }

        // Handle legacy :step format (warn and process)
        if (resolvedStep.step !== undefined) {
            log.warn(`DEPRECATED: Step ${index} uses :step numbering - remove :step and use array order`);
            // Remove step number and process the rest
            const { step: stepNum, ...cleanStep } = resolvedStep;
            await this.executeSequenceStep(cleanStep, context, index);
            return;
        }

        log.warn(`Unknown step format at index ${index}:`, resolvedStep);
    }

    // Resolve sequence definition by name considering future per-mode override
    resolveSequence(name, gameMode) {
        if (!name) return undefined;
        // Accept inline sequence arrays or sequence objects directly
        if (Array.isArray(name)) return { sequence: name };
        if (typeof name === 'object') return name;

    // Map legacy sequence names to new semantic names
        const mappedName = this.mapLegacySequenceName(name);

        // Accept both with and without -sequence suffix; search multiple namespaces.
        const normalized = this.normalizeName(mappedName);
        const base = normalized.replace(/-sequence$/, '');

        // QUICK WIN: If the state machine has already flattened global sequences,
        // consult that map first for a fast, authoritative lookup. This ensures
        // validation and runtime checks resolve names regardless of grouping.
        if (this.stateMachine && this.stateMachine.globalSequences) {
            const gm = this.stateMachine.globalSequences;
            const candidates = [normalized, base, name];
            for (const c of candidates) {
                if (!c) continue;
                if (gm[c]) return gm[c];
            }
        }

        // Per-mode overrides (cfg.game[mode].sequences)
        const perModeRoot = gameMode && this.cfg.game && this.cfg.game[gameMode];
        if (perModeRoot && perModeRoot.sequences) {
            const hit = perModeRoot.sequences[normalized] || perModeRoot.sequences[base] || perModeRoot.sequences[`${base}-sequence`];
            if (hit) return hit;
        }

        // PRIMARY: If stateMachine provided a flattened globalSequences map, consult it first
        if (this.stateMachine && this.stateMachine.globalSequences) {
            const gs = this.stateMachine.globalSequences;
            const primaryHit = gs[normalized] || gs[base] || gs[`${base}-sequence`] || gs[name];
            if (primaryHit) return primaryHit;
        }

        // Primary global sequences (NEW hierarchical structure)
        const globalRoot = this.cfg.global || {};

        // NEW: Search in hierarchical system-sequences structure (mapped from :sequences in EDN)  
        const systemSeqs = globalRoot['system-sequences'] || {};

        const searchInCategory = (category) => {
            const categorySeqs = systemSeqs[category] || {};
            return categorySeqs[normalized] || categorySeqs[base] || categorySeqs[`${base}-sequence`];
        };

        // Try system sequences first (halt, wake, sleep, etc.)
        const systemSeq = searchInCategory('system');
        if (systemSeq) return systemSeq;

    // Try command-sequences (new name; replaces 'game-actions') or legacy nested game-actions
    // Priority: explicit top-level 'command-sequences' -> hierarchical 'system-sequences' group 'game-actions' -> legacy nested under global.sequences
    const cmdSeqsRoot = globalRoot['command-sequences'] || {};
    const cmdHit = cmdSeqsRoot[normalized] || cmdSeqsRoot[base] || cmdSeqsRoot[`${base}-sequence`];
    if (cmdHit) return cmdHit;

    const gameActionSeq = searchInCategory('game-actions');
    if (gameActionSeq) return gameActionSeq;

    // Legacy nested: global.sequences.game-actions[name]
    const legacyGameActions = globalRoot.sequences && globalRoot.sequences['game-actions'] ? globalRoot.sequences['game-actions'] : {};
    const legacyHit = legacyGameActions[normalized] || legacyGameActions[base] || legacyGameActions[`${base}-sequence`];
    if (legacyHit) return legacyHit;

        // LEGACY FALLBACK: Direct system-sequences access (old flat structure)
        const systemDirect = systemSeqs[normalized] || systemSeqs[base] || systemSeqs[`${base}-sequence`];
        if (systemDirect) return systemDirect;

        // LEGACY FALLBACK: Old global sequences location
        const globalSeqs = globalRoot.sequences || {};
        const directGlobal = globalSeqs[normalized] || globalSeqs[base] || globalSeqs[`${base}-sequence`];
        if (directGlobal) return directGlobal;

        // LEGACY FALLBACK: Primary global location (spec original)
        const direct = globalRoot['control-sequences'] && (globalRoot['control-sequences'][normalized] || globalRoot['control-sequences'][base]);
        if (direct) return direct;

        // LEGACY FALLBACK: Nested under old system-sequences structure  
        const controlGroup = systemSeqs['control-sequences'] || {};
        const fromControlGroup = controlGroup[normalized] || controlGroup[base] || controlGroup[`${base}-sequence`];
        if (fromControlGroup) return fromControlGroup; return undefined;
    }

    resolveCue(name, gameMode) {
        if (!name) return undefined;
        // Only resolve cues that are actually defined as sequences.
        // EDN action-style cues with `commands` should be handled by the state machine directly.
        const cueDef = this.cfg.cues?.[name]
            || this.cfg.global?.cues?.[name]
            || this.cfg.global?.actions?.[name];
        if (!cueDef) return undefined;

        // If it is a sequence-style cue, normalize and return; otherwise skip.
        if (Array.isArray(cueDef.sequence)) {
            return { sequence: cueDef.sequence };
        }
        if (Array.isArray(cueDef)) {
            // Some configs may define cues directly as an array of steps
            return { sequence: cueDef };
        }
        // Not a sequence (likely an action cue with `commands` or a timeline cue) -> let caller handle it.
        return undefined;
    }

    normalizeName(name) {
        if (!name) return name;
        // accept variants like 'reset-sequence' or 'resetSequence' or 'reset'
        const s = String(name);
        if (s.endsWith('-sequence')) return s;
        if (s.endsWith('Sequence')) return s.replace(/Sequence$/, '-sequence');
        // map base forms
        if (!s.includes('-sequence')) return `${s}-sequence`;
        return s;
    }

    estimateDuration(seqDef) {
        if (!seqDef || !Array.isArray(seqDef.sequence)) return 0;
        let sum = 0;
        for (const s of seqDef.sequence) {
            // explicit wait command
            if (s.command === 'wait' && typeof s.duration === 'number') sum += s.duration;
            // steps that asked to wait after executing: wait: true -> use step.duration, wait: <number> -> use that
            if (s.wait) {
                if (typeof s.wait === 'number') sum += s.wait;
                else if (typeof s.duration === 'number') sum += s.duration;
            }
            // Device-agnostic: avoid special-casing device actions here
        }
        return (sum > 0 ? sum + 1 : 1);
    }

    // Timer safety validation
    validateTimerDuration(name, duration, source = 'estimate') {
        if (typeof duration !== 'number' || duration <= 0) {
            log.warn(`SequenceRunner: invalid timer duration for ${name}: ${duration} (${source})`);
            this.publishEvent('sequence_timer_invalid', { name, duration, source });
            return false;
        }
        return true;
    }

    publishEvent(event, data = {}) {
        if (!this._eventsTopic) {
            this._eventsTopic = this.cfg.global?.mqtt?.['game-topic'] ? `${this.cfg.global.mqtt['game-topic']}/events` : null;
        }
        if (!this.mqtt || !this._eventsTopic) return;
        try { this.mqtt.publish(this._eventsTopic, { event, t: Date.now(), data }); } catch (_) { }
    }

    publishWarning(warning, message, extra = {}) {
        const gameTopic = this.cfg?.global?.mqtt?.['game-topic'];
        if (!gameTopic || !this.mqtt) return;
        try {
            this.mqtt.publish(`${gameTopic}/warnings`, { warning, message, timestamp: Date.now(), ...extra });
        } catch (_) { /* ignore */ }
    }

    getCommandsTopic() {
        if (!this._commandsTopic) {
            this._commandsTopic = getCommandsTopic(this.cfg);
        }
        return this._commandsTopic;
    }

    extractZones(zonesSpec) {
        // Accept patterns:
        //  - array of zone names (strings)
        //  - array of objects with {zone}
        //  - object with :zones (array)
        //  - object with :zone (single)
        //  - primitive string (single zone)
        if (!zonesSpec) return [];
        if (Array.isArray(zonesSpec)) {
            return zonesSpec.map(z => (typeof z === 'string') ? z : (z && z.zone)).filter(Boolean);
        }
        if (typeof zonesSpec === 'string') return [zonesSpec];
        if (typeof zonesSpec === 'object') {
            if (Array.isArray(zonesSpec.zones)) return zonesSpec.zones.filter(z => typeof z === 'string');
            if (zonesSpec.zone && typeof zonesSpec.zone === 'string') return [zonesSpec.zone];
            // legacy fallbacks: allow targets for transitional period (won't be produced once refactor complete)
            if (Array.isArray(zonesSpec.targets)) {
                return zonesSpec.targets.map(z => (typeof z === 'string') ? z : (z && z.zone)).filter(Boolean);
            }
        }
        return [];
    }

    async executeOnZones(command, options = {}, zonesSpec) {
        const zones = this.extractZones(zonesSpec);
        for (const z of zones) {
            try { await this.zones.execute(z, command, options); } catch (_) { /* suppress per-zone errors */ }
        }
    }

    async runControlSequence(name, context = {}) {
        const seqDef = this.resolveSequence(name, context.gameMode);
        return await this.runSequenceDef(name, seqDef, context, true);
    }

    // NEW: Run sequence by name (blocking execution with timing)
    async runSequence(name, context = {}) {
        const seqDef = this.resolveSequenceNew(name, context.gameMode);
        if (!seqDef) {
            log.warn(`Sequence '${name}' not found in new format`);
            return { ok: false, error: 'sequence_not_found' };
        }
        return await this.runSequenceDefNew(name, seqDef, context);
    }

    async runCue(name, context = {}) {
        const cueDef = this.resolveCue(name, context.gameMode);
        return await this.runSequenceDef(name, cueDef, context, true);
    }

    // Enhanced validation for sequence definitions
    validateSequenceDefinition(name, seqDef) {
        const warnings = [];
        const errors = [];

        if (!seqDef || typeof seqDef !== 'object') {
            errors.push(`Sequence ${name}: definition must be an object`);
            return { warnings, errors };
        }

        if (!Array.isArray(seqDef.sequence)) {
            errors.push(`Sequence ${name}: missing or invalid 'sequence' array`);
            return { warnings, errors };
        }

        // Validate each step
        seqDef.sequence.forEach((step, idx) => {
            if (!step || typeof step !== 'object') {
                errors.push(`Sequence ${name}[${idx}]: step must be an object`);
                return;
            }

            const { command } = step;
            if (!command || typeof command !== 'string') {
                errors.push(`Sequence ${name}[${idx}]: missing or invalid 'command' field`);
                return;
            }

            // Skip validation for zone-specific commands - zone adapters will handle them
            const zones = this.extractZones(step);
            if (zones.length > 0) {
                // This is a zone command - zone adapter will validate at runtime
                // Just validate optional wait property if present
                if ('wait' in step) {
                    if (!(typeof step.wait === 'boolean' || typeof step.wait === 'number')) {
                        warnings.push(`Sequence ${name}[${idx}]: 'wait' should be boolean or numeric seconds`);
                    } else if (typeof step.wait === 'number' && step.wait <= 0) {
                        warnings.push(`Sequence ${name}[${idx}]: 'wait' numeric value should be positive`);
                    }
                }
                return; // Skip further validation for zone commands
            }

            // Command-specific validation for non-zone commands
            switch (command) {
                case 'wait':
                    if (typeof step.duration !== 'number' || step.duration <= 0) {
                        errors.push(`Sequence ${name}[${idx}]: wait command requires positive numeric 'duration'`);
                    }
                    break;
                case 'publish':
                case 'mqtt': {
                    if (!step.topic || typeof step.topic !== 'string') {
                        errors.push(`Sequence ${name}[${idx}]: ${command} command requires string 'topic'`);
                    }
                    const hasMsg = (step.message !== undefined);
                    const hasPayload = (step.payload !== undefined);
                    if (!hasMsg && !hasPayload) {
                        errors.push(`Sequence ${name}[${idx}]: ${command} requires 'message' (string/object) or 'payload' (string/object)`);
                    } else {
                        const val = hasPayload ? step.payload : step.message;
                        const t = typeof val;
                        if (!(t === 'string' || t === 'object')) {
                            errors.push(`Sequence ${name}[${idx}]: ${command} payload must be string or object (got ${t})`);
                        }
                    }
                    break;
                }
                case 'runSequence':
                    if (!step.sequence && !step.name) {
                        errors.push(`Sequence ${name}[${idx}]: runSequence command requires 'sequence' or 'name' field`);
                    }
                    break;
                case 'setImage':
                case 'startImage': {
                    const zones = this.extractZones(step);
                    if (zones.length === 0) warnings.push(`Sequence ${name}[${idx}]: ${command} requires :zone or :zones`);
                    if (!step.file && !step.image) warnings.push(`Sequence ${name}[${idx}]: ${command} requires :file or :image`);
                    break;
                }
                case 'playVideo':
                case 'startVideo': {
                    const zones = this.extractZones(step);
                    if (zones.length === 0) warnings.push(`Sequence ${name}[${idx}]: ${command} requires :zone or :zones`);
                    if (!step.file && !step.video) warnings.push(`Sequence ${name}[${idx}]: ${command} requires :file or :video`);
                    break;
                }
                case 'setZoneVolume': {
                    const zones = this.extractZones(step);
                    if (zones.length === 0) warnings.push(`Sequence ${name}[${idx}]: setZoneVolume requires :zone or :zones`);
                    if (typeof step.volume !== 'number') warnings.push(`Sequence ${name}[${idx}]: setZoneVolume requires numeric :volume`);
                    break;
                }
                // Valid actions that need no specific validation
                case 'stopAll':
                case 'hideBrowser':
                case 'showBrowser':
                case 'enableBrowser':
                case 'disableBrowser':
                case 'stopAudio':
                case 'verifyBrowser':
                    break;
                case 'verifyImage':
                    if (!step.file) warnings.push(`Sequence ${name}[${idx}]: verifyImage requires :file`);
                    break;
                case 'playHint':
                    break;
                default:
                    warnings.push(`Sequence ${name}[${idx}]: unknown action '${command}' (will be ignored)`);
            }
            // Validate optional wait property (outside switch)
            if ('wait' in step) {
                if (!(typeof step.wait === 'boolean' || typeof step.wait === 'number')) {
                    warnings.push(`Sequence ${name}[${idx}]: 'wait' should be boolean or numeric seconds`);
                } else if (typeof step.wait === 'number' && step.wait <= 0) {
                    warnings.push(`Sequence ${name}[${idx}]: 'wait' numeric value should be positive`);
                }
            }
        });

        // Validate metadata
        if (seqDef.meta) {
            if (typeof seqDef.meta !== 'object') {
                warnings.push(`Sequence ${name}: meta should be an object`);
            } else {
                if ('duration' in seqDef.meta && (typeof seqDef.meta.duration !== 'number' || seqDef.meta.duration <= 0)) {
                    warnings.push(`Sequence ${name}: meta.duration should be positive number`);
                }
                if ('max-depth' in seqDef.meta && (typeof seqDef.meta['max-depth'] !== 'number' || seqDef.meta['max-depth'] < 1)) {
                    warnings.push(`Sequence ${name}: meta.max-depth should be positive integer`);
                }
            }
        }

        return { warnings, errors };
    }

    async runInlineSequence(name, seqDef, context = {}) {
        return await this.runSequenceDef(name, seqDef, context, false);
    }

    async runSequenceDef(name, seqDef, context = {}, isResolvedReference = false) {
        const { gameMode } = context;
        const stack = context._stack || [];
        const depth = stack.length;
        if (!seqDef) {
            // Provide helpful guidance about where to define sequences
            const globalSeqs = Object.keys(this.cfg.global?.sequences || {});
            const systemSeqs = Object.keys(this.cfg.global?.['system-sequences'] || {}).join(', ');
            const commandSeqs = Object.keys(this.cfg.global?.['command-sequences'] || {}).join(', ');
            const gameModeSeqs = gameMode && this.cfg.game?.[gameMode]?.sequences ?
                Object.keys(this.cfg.game[gameMode].sequences) : [];

            let suggestion = `Check sequence definitions in:`;
            if (globalSeqs.length > 0) suggestion += ` :global :sequences [${globalSeqs.join(', ')}]`;
            if (systemSeqs) suggestion += ` :system-sequences [${systemSeqs}]`;
            if (commandSeqs) suggestion += ` :command-sequences [${commandSeqs}]`;
            if (gameModeSeqs.length > 0) suggestion += ` game-mode sequences [${gameModeSeqs.join(', ')}]`;

            log.warn(`SequenceRunner: sequence not found: '${name}'. ${suggestion}`);
            this.publishEvent('sequence_missing', { name, gameMode, suggestion });
            return { ok: false, error: 'sequence_missing' };
        }

        const maxDepth = seqDef.meta?.['max-depth'] || this.maxDepthDefault;
        if (depth >= maxDepth) {
            log.warn(`SequenceRunner: depth exceeded for ${name} (depth=${depth} max=${maxDepth})`);
            this.publishEvent('sequence_depth_exceeded', { name, depth, maxDepth });
            return { ok: false, error: 'sequence_depth_exceeded' };
        }
        if (stack.includes(name)) {
            log.warn(`SequenceRunner: cycle detected attempting to run ${name} stack=${stack.join('>')}`);
            this.publishEvent('sequence_cycle_detected', { name, stack });
            return { ok: false, error: 'sequence_cycle' };
        }

        const newStack = [...stack, name];
        const durationEstimate = this.estimateDuration(seqDef);
        const override = (seqDef.meta && typeof seqDef.meta.duration === 'number') ? seqDef.meta.duration : undefined;
        if (override && Math.abs(override - durationEstimate) > 0.5) {
            log.warn(`SequenceRunner: duration mismatch for ${name} override=${override}s estimate=${durationEstimate}s`);
            this.publishEvent('sequence_duration_mismatch', { name, override, estimate: durationEstimate });
        }
        log.info(`SequenceRunner: running ${name} (depth ${depth}) estimated ${durationEstimate}s`);
        this.publishEvent('sequence_start', { name, depth, estimate: durationEstimate, override });

        let elapsed = 0; // logical elapsed based on waits

        for (const step of (seqDef.sequence || [])) {
            // Cut-off logic if override present
            if (override !== undefined) {
                // predicted elapsed after executing this step (wait adds duration, others ~0)
                const add = (step.command === 'wait' && typeof step.duration === 'number') ? step.duration : 0;
                if ((elapsed + add) > override) {
                    log.warn(`SequenceRunner: skipping step ${step.step || '?'} in ${name} beyond override duration (${override}s)`);
                    this.publishEvent('sequence_step_skipped_over_duration', { name, step: step.step, action: step.command, elapsed, override });
                    continue;
                }
            }
            try {
                this.publishEvent('sequence_step_start', { name, step: step.step, action: step.command });
                // Preserve original context variables (like hintText) while adding stack tracking
                const stepContext = { ...context, gameMode, _stack: newStack };
                await this.executeSequenceStep(step, stepContext, step.step || 'legacy');
                // Track logical time for explicit wait steps
                if (step.command === 'wait' && typeof step.duration === 'number') {
                    elapsed += step.duration;
                } else if (step.wait) {
                    // Honor optional post-step wait: boolean -> use step.duration; number -> use that value
                    const waitDuration = (typeof step.wait === 'number')
                        ? step.wait
                        : (typeof step.duration === 'number' ? step.duration : 0);
                    if (waitDuration > 0) {
                        await this.waitSeconds(waitDuration);
                        elapsed += waitDuration;
                    }
                }
                this.publishEvent('sequence_step_complete', { name, step: step.step, action: step.command });
            } catch (e) {
                log.error(`SequenceRunner: step failed in ${name} step=${step.step || '?'} action=${step.command}: ${e.message}`);
                this.publishEvent('sequence_step_failed', { name, step: step.step, action: step.command, error: e.message });
                this.publishEvent('sequence_failed', { name, error: 'step_failed', step: step.step, action: step.command });
                return { ok: false, error: 'step_failed', step: step.step, action: step.command };
            }
        }
        this.publishEvent('sequence_complete', { name, estimate: durationEstimate, override });
        return { ok: true, durationEstimate, override };
    }

    async executeStep(step, ctx) {
        const action = step.command;
        switch (action) {
            // Use zone-based actions or sequences only
            case 'log':
                // Developer debugging helper: prints message to console
                if (step.message || step.msg || step.text) {
                    const msg = step.message || step.msg || step.text;
                    log.info(`[SEQ LOG] ${msg}`);
                } else {
                    log.info(`[SEQ LOG] step ${step.step || ''}`);
                }
                return;
            case 'wait':
                await this.waitSeconds(step.duration);
                return;
            case 'stopAll':
                stopAllAcrossZones(this.zones);
                return;
            case 'hideBrowser':
                await this.executeOnZones('hideBrowser', {}, step);
                return;
            case 'showBrowser':
                await this.executeOnZones('showBrowser', {}, step);
                return;
            case 'enableBrowser':
                if (step.url) {
                    await this.executeOnZones('enableBrowser', { url: step.url }, step);
                } else {
                    log.warn('enableBrowser step missing required url parameter');
                }
                return;
            case 'disableBrowser':
                await this.executeOnZones('disableBrowser', {}, step);
                return;
            case 'stopAudio': {
                const fadeTime = step.fadeTime;
                await this.executeOnZones('stopAudio', { fadeTime }, step);
                return;
            }
            case 'verifyBrowser': {
                const url = step.url;
                const visible = step.visible !== undefined ? step.visible : null;
                const browserTimeout = step.timeout || VERIFY_BROWSER_TIMEOUT_MS; // standardized default
                for (const z of this.extractZones(step)) {
                    try {
                        const result = await this.zones.execute(z, 'verifyBrowser', { url, visible, timeout: browserTimeout });
                        if (result && result.success === false) {
                            const errorMsg = `Browser verification failed on zone '${z}' after ${browserTimeout}ms timeout`;
                            log.warn(errorMsg);
                            this.publishWarning('browser_verification_failed', errorMsg, { zone: z, timeout: browserTimeout });
                            throw new Error(errorMsg);
                        }
                        // success path: emit a light-weight event for observability
                        this.publishEvent('sequence_verify_browser_ok', { zone: z, url, visible });
                    } catch (e) {
                        const errorMsg = `SequenceRunner: verifyBrowser failed on ${z}: ${e.message}`;
                        log.warn(errorMsg);
                        this.publishWarning('browser_verification_error', errorMsg, { zone: z, error: e.message });
                        throw e;
                    }
                }
                return;
            }
            case 'verifyImage': {
                const timeout = step.timeout || VERIFY_MEDIA_TIMEOUT_MS;
                const file = step.file;
                if (!file) {
                    log.warn('verifyImage step missing :file');
                    return;
                }
                for (const z of this.extractZones(step)) {
                    try {
                        const result = await this.zones.execute(z, 'verifyImage', { file, timeout });
                        if (result) {
                            log.info(`SequenceRunner: verifyImage on ${z} - success: ${result.success}, changes: ${JSON.stringify(result)}`);
                            this.publishEvent('sequence_verify_media_ok', { zone: z, result });
                        }
                    } catch (e) {
                        const msg = `SequenceRunner: verifyImage failed on ${z}: ${e.message}`;
                        log.warn(msg);
                        this.publishWarning('media_verification_error', msg, { zone: z, error: e.message });
                    }
                }
                return;
            }
            case 'setImage':
            case 'startImage': {
                const zones = this.extractZones(step);
                const file = step.file || step.image;
                for (const z of zones) {
                    if (!file) continue;
                    try { this.zones.execute(z, 'setImage', { file }); } catch (_) { }
                }
                return;
            }
            case 'playVideo':
            case 'startVideo': {
                const zones = this.extractZones(step);
                const file = step.file || step.video;
                const va = (step.volumeAdjust !== undefined ? step.volumeAdjust : step.volume);
                const options = {};
                if (va !== undefined) options.volumeAdjust = va;
                for (const z of zones) {
                    if (!file) continue;
                    try { this.zones.execute(z, 'playVideo', { file, ...options }); } catch (_) { }
                }
                return;
            }

            case 'playHint': {
                // Publish executeHint on the game commands topic, preserving existing command shape
                const hintId = step.id || step.hint || step.hintId;
                if (!hintId) {
                    const msg = 'playHint step missing required id/hint/hintId';
                    log.warn(`SequenceRunner: ${msg}`);
                    this.publishEvent('sequence_step_validation_failed', { action: 'playHint', error: 'missing_hint_id' });
                    return;
                }
                const res = publishExecuteHint(this.mqtt, this.cfg, hintId, 'sequenceRunner');
                if (res.ok) this.publishEvent('hint_command_published', { id: hintId });
                else this.publishEvent('sequence_step_failed', { action: 'playHint', error: res.error || 'publish_failed' });
                return;
            }
            case 'publish':
            case 'mqtt': {
                const topic = step.topic;
                const payload = (step.payload !== undefined) ? step.payload : step.message;
                if (!topic) throw new Error(`${action} action requires :topic`);
                if (payload === undefined) throw new Error(`${action} action requires :message or :payload`);
                try {
                    const body = (typeof payload === 'string') ? payload : JSON.stringify(payload);
                    this.mqtt.publish(topic, body);
                } catch (e) { throw new Error(`${action} failed: ${e.message}`); }
                return;
            }
            case 'runSequence': {
                const target = step.sequence || step.name;
                if (!target) throw new Error('runSequence requires :sequence');
                const res = await this.runControlSequence(target, { gameMode: ctx.gameMode, _stack: ctx._stack });
                if (!res.ok) throw new Error(`nested sequence failed: ${res.error}`);
                return;
            }
            case 'setZoneVolume': {
                const zones = this.extractZones(step);
                if (typeof step.volume !== 'number') {
                    log.warn('setZoneVolume missing numeric :volume');
                    return;
                }
                for (const z of zones) {
                    try { this.zones.execute(z, 'setVolume', { volume: step.volume, zone: true }); } catch (error) { log.warn(`setZoneVolume failed for zone ${z}: ${error.message}`); }
                }
                return;
            }
            default:
                // Check for zone commands: if step has 'zone' and 'command', route through adapter registry
                if (step.zone && step.command) {
                    try {
                        // Extract options from step, excluding zone and command
                        const { zone, command, ...options } = step;
                        return this.zones.execute(zone, command, options);
                    } catch (error) {
                        throw new Error(`Zone command '${step.command}' on '${step.zone}' failed: ${error.message}`);
                    }
                }

                // Generic multi-zone dispatch: if step defines zone(s) with an adapter command name that isn't explicitly handled above
                const genericZones = this.extractZones(step);
                if (genericZones.length > 0 && step.command) {
                    const { zone, zones, targets, command, ...options } = step; // exclude legacy keys
                    for (const z of genericZones) {
                        try { await this.zones.execute(z, command, options); } catch (error) { throw new Error(`Zone command '${command}' on '${z}' failed: ${error.message}`); }
                    }
                    return;
                }

                log.warn(`SequenceRunner: unknown action '${action}' in step:`, step, '(ignored)');
                return;
        }
    }

    waitSeconds(sec) {
        const ms = Math.max(0, (sec || 0) * 1000);
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = SequenceRunner;
