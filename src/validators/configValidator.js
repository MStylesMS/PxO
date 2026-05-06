/**
 * Configuration Validator for Three-Tier Model
 * 
 * Validates the new configuration format:
 * 1. Cues: Single commands or arrays with no timing/blocking
 * 2. Sequences: Ordered steps or timeline with timing/blocking  
 * 3. Schedules: Single discriminator per entry
 * 4. Name uniqueness within scopes
 * 5. Prohibited syntax detection
 */

class ConfigValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.globalHintIds = new Set();
    }

    /**
     * Main validation entry point
     */
    validate(config) {
        this.errors = [];
        this.warnings = [];
        this.globalHintIds = this.collectHintIds(config?.global?.hints);

        console.log('🔍 Validating configuration...');

        // Validate global configuration
        if (config.global) {
            this.validateGlobalConfig(config.global);
        }

        // Validate game modes
        if (config['game-modes']) {
            Object.entries(config['game-modes']).forEach(([modeKey, mode]) => {
                this.validateGameMode(mode, modeKey, config.global || {});
            });
        }

        // NOTE: Cross-scope duplicates (e.g., global.cues.intro and game-modes.hc-demo.cues.intro)
        // are ALLOWED - they represent local overrides, not errors.
        // The resolution system handles precedence: local scope wins over global scope.
        // We only validate for duplicates WITHIN each scope (cues vs sequences in same scope).

        // Report results
        this.printValidationReport();

        return {
            isValid: this.errors.length === 0,
            errors: [...this.errors],
            warnings: [...this.warnings]
        };
    }

    collectHintIds(hints) {
        if (!hints || typeof hints !== 'object' || Array.isArray(hints)) {
            return new Set();
        }

        return new Set(Object.keys(hints).filter(name => typeof name === 'string' && name.length > 0));
    }

    /**
     * Validate global configuration section
     */
    validateGlobalConfig(global) {
        if (global.hints) {
            this.validateGlobalHints(global.hints, global, 'global');
        }

        if (global.triggers) {
            this.validateTriggers(global.triggers, 'global.triggers');
        }

        // Validate cues
        if (global.cues) {
            this.validateCues(global.cues, 'global');
        }

        // Validate sequences
        if (global.sequences) {
            this.validateSequences(global.sequences, 'global');
        }

        if (global['additional-phases']) {
            this.validateAdditionalPhaseRegistry(global['additional-phases'], 'global.additional-phases');
        }

        // Check for prohibited sections
        this.validateProhibitedSections(global, 'global');

        // Check for name conflicts between cues and sequences
        this.validateNameUniqueness(global, 'global');
    }

    findCommandSequenceDefinition(commandSequences, sequenceName) {
        if (!commandSequences || typeof commandSequences !== 'object' || !sequenceName) {
            return undefined;
        }

        const raw = String(sequenceName);
        const normalized = raw.endsWith('-sequence') ? raw : `${raw}-sequence`;
        const base = normalized.replace(/-sequence$/, '');
        const variants = [raw, normalized, base, `${base}-sequence`].filter(Boolean);

        for (const key of variants) {
            if (commandSequences[key]) return commandSequences[key];
        }

        for (const value of Object.values(commandSequences)) {
            if (!value || typeof value !== 'object') continue;
            for (const key of variants) {
                if (value[key]) return value[key];
            }
        }

        return undefined;
    }

    extractTemplateKeys(value, out = new Set()) {
        if (typeof value === 'string') {
            const re = /\{\{(\w+)\}\}/g;
            let m;
            while ((m = re.exec(value)) !== null) {
                out.add(m[1]);
            }
            return out;
        }

        if (Array.isArray(value)) {
            value.forEach(v => this.extractTemplateKeys(v, out));
            return out;
        }

        if (value && typeof value === 'object') {
            Object.values(value).forEach(v => this.extractTemplateKeys(v, out));
        }

        return out;
    }

    validateGlobalHints(hints, globalConfig, context) {
        if (!hints || typeof hints !== 'object') return;

        const commandSequences = globalConfig['command-sequences'] || {};
        const isScalar = (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

        Object.entries(hints).forEach(([hintName, hintDef]) => {
            const hintContext = `${context}.hints.${hintName}`;
            if (!hintDef || typeof hintDef !== 'object') return;

            const type = String(hintDef.type || 'text').toLowerCase();
            const allowedTypes = new Set(['text', 'sequence', 'speech', 'audiofx', 'background', 'video', 'image', 'action']);
            if (type === 'audio') {
                this.addError(
                    `Hint '${hintName}' uses unsupported type 'audio'. Use 'audioFx' for sound effects, 'speech' for spoken audio, or 'background' for looping background audio.`,
                    hintContext
                );
            } else if (!allowedTypes.has(type)) {
                this.addError(
                    `Hint '${hintName}' uses unsupported type '${hintDef.type}'. Supported types: text, sequence, speech, audioFx, background, video, image, action.`,
                    hintContext
                );
            }

            if (type !== 'sequence' && type !== 'text') {
                if (hintDef.parameters && typeof hintDef.parameters === 'object') {
                    this.addWarning(
                        `Hint '${hintName}' defines 'parameters' but only sequence hints support parameters`,
                        hintContext
                    );
                }
                return;
            }

            const sequenceName = hintDef.sequence;
            if (!sequenceName || typeof sequenceName !== 'string') {
                this.addError(
                    `${type === 'text' ? 'Text' : 'Sequence'} hint '${hintName}' must specify string 'sequence' field`,
                    hintContext
                );
                return;
            }

            const sequenceDef = this.findCommandSequenceDefinition(commandSequences, sequenceName);
            if (!sequenceDef) {
                this.addError(
                    `${type === 'text' ? 'Text' : 'Sequence'} hint '${hintName}' references '${sequenceName}' but it is not defined in global.command-sequences`,
                    hintContext
                );
                return;
            }

            const parameters = hintDef.parameters;
            if (type === 'sequence' && parameters !== undefined) {
                if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
                    this.addError(
                        `Sequence hint '${hintName}' field 'parameters' must be a map/object when provided`,
                        hintContext
                    );
                    return;
                }

                const invalidParamKeys = Object.entries(parameters)
                    .filter(([, value]) => !isScalar(value))
                    .map(([key]) => key);

                if (invalidParamKeys.length > 0) {
                    this.addError(
                        `Sequence hint '${hintName}' has non-scalar parameter value(s): ${invalidParamKeys.join(', ')}`,
                        hintContext
                    );
                    return;
                }
            }

            if (type === 'text' && parameters !== undefined) {
                this.addWarning(
                    `Text hint '${hintName}' defines 'parameters' but text hints do not use parameters`,
                    hintContext
                );
            }

            const templateKeys = this.extractTemplateKeys(sequenceDef);
            // Allow UI metadata fields that are useful but not required as template placeholders.
            const reserved = new Set(['id', 'type', 'sequence', 'description', 'parameters', 'zone']);
            const providedKeys = Object.keys(hintDef).filter(k => !reserved.has(k));
            const providedParamKeys = (type === 'sequence' && parameters && typeof parameters === 'object')
                ? Object.keys(parameters)
                : [];
            const providedAll = [...providedKeys, ...providedParamKeys];

            const unused = providedAll.filter(k => !templateKeys.has(k));
            if (unused.length > 0) {
                this.addWarning(
                    `${type === 'text' ? 'Text' : 'Sequence'} hint '${hintName}' provides unused field(s): ${unused.join(', ')}`,
                    hintContext
                );
            }

            const missing = Array.from(templateKeys).filter(k => !providedAll.includes(k));
            if (missing.length > 0) {
                this.addWarning(
                    `${type === 'text' ? 'Text' : 'Sequence'} hint '${hintName}' is missing field(s) required by template placeholders: ${missing.join(', ')}`,
                    hintContext
                );
            }
        });
    }

    /**
     * Validate game mode configuration
     */
    validateGameMode(mode, modeKey, globalConfig = {}) {
        // Check for required labels for UI compatibility
        if (!mode['short-label'] && !mode.shortLabel) {
            this.addWarning(
                `Game mode '${modeKey}' is missing 'short-label' field. ` +
                `This will prevent the mode from appearing in the web control UI dropdown.`,
                `game-mode.${modeKey}`
            );
        }

        if (!mode['game-label'] && !mode.gameLabel) {
            this.addWarning(
                `Game mode '${modeKey}' is missing 'game-label' field. ` +
                `This will prevent proper display in the web control UI.`,
                `game-mode.${modeKey}`
            );
        }

        const hintsList = Array.isArray(mode.hints) ? mode.hints : [];
        const maxHintsValue = mode['max-hints'] ?? mode.maxHints;

        if (maxHintsValue !== undefined) {
            if (!Number.isInteger(maxHintsValue) || maxHintsValue < 0) {
                this.addError(
                    `Game mode '${modeKey}' has invalid max-hints '${maxHintsValue}'. Expected a non-negative integer.`,
                    `game-mode.${modeKey}.max-hints`
                );
            } else if (Array.isArray(mode.hints) && maxHintsValue > hintsList.length) {
                this.addWarning(
                    `Game mode '${modeKey}' max-hints (${maxHintsValue}) exceeds configured hints (${hintsList.length}).`,
                    `game-mode.${modeKey}.max-hints`
                );
            }
        }

        this.validateGameModeHintReferences(modeKey, hintsList, globalConfig);

        // Validate mode-specific cues
        if (mode.cues) {
            this.validateCues(mode.cues, `game-mode.${modeKey}`);
        }

        // Validate mode-specific sequences
        if (mode.sequences) {
            this.validateSequences(mode.sequences, `game-mode.${modeKey}`);
        }

        // Validate phases
        if (mode.phases) {
            Object.entries(mode.phases).forEach(([phaseKey, phase]) => {
                this.validatePhase(phase, `${modeKey}.${phaseKey}`);
            });
        }

        const modePhases = mode.phases && typeof mode.phases === 'object' ? mode.phases : {};
        if (!modePhases.abort && !mode.abort) {
            this.addError(
                `Game mode '${modeKey}' must define an :abort phase (immediate operator reset path)`,
                `game-mode.${modeKey}.phases.abort`
            );
        }
        if (!modePhases.reset && !mode.reset) {
            this.addError(
                `Game mode '${modeKey}' must define a :reset phase`,
                `game-mode.${modeKey}.phases.reset`
            );
        }

        const modeAdditional = mode['additional-phases'] || mode.additionalPhases;
        if (modeAdditional !== undefined) {
            if (!Array.isArray(modeAdditional)) {
                this.addError(
                    `Game mode '${modeKey}' additional-phases must be a vector/array of phase keys`,
                    `game-mode.${modeKey}.additional-phases`
                );
            } else {
                const registry = globalConfig['additional-phases'] || {};
                modeAdditional.forEach((phaseKey, idx) => {
                    if (typeof phaseKey !== 'string') {
                        this.addError(
                            `Game mode '${modeKey}' additional-phases[${idx}] must be a string key`,
                            `game-mode.${modeKey}.additional-phases[${idx}]`
                        );
                        return;
                    }
                    if (!registry[phaseKey]) {
                        this.addError(
                            `Game mode '${modeKey}' references additional phase '${phaseKey}' but it is not defined under global.additional-phases`,
                            `game-mode.${modeKey}.additional-phases[${idx}]`
                        );
                    }
                });
            }
        }

        // Check for name conflicts within this mode
        this.validateNameUniqueness(mode, `game-mode.${modeKey}`);
    }

    /**
     * Validate hint references in a game mode against globally defined hint ids.
     */
    validateGameModeHintReferences(modeKey, hintsList, globalConfig) {
        if (!Array.isArray(hintsList) || hintsList.length === 0) return;

        const globalHints = (globalConfig && globalConfig.hints) || {};
        const hasGlobalHints = globalHints && typeof globalHints === 'object';

        hintsList.forEach((hintEntry, index) => {
            if (typeof hintEntry !== 'string') return;

            const text = hintEntry.trim();
            if (!text) return;

            // Shorthand form (e.g., playVideo:file.mp4) is not a global id reference.
            if (/^[a-zA-Z]+:/.test(text)) return;

            // Hint names are fully unrestricted; check if this string exists in global hints.
            // If a game-mode hint is not found globally, it will be treated as ad-hoc text at runtime.
            const exists = hasGlobalHints && Object.prototype.hasOwnProperty.call(globalHints, text);
            if (!exists) {
                this.addWarning(
                    `Game mode '${modeKey}' references hint '${text}' that is not defined under global.hints. ` +
                    `It will be treated as ad-hoc text unless a global hint with this id exists.`,
                    `game-mode.${modeKey}.hints[${index}]`
                );
            }
        });
    }

    /**
     * Validate cues section
     */
    validateCues(cues, context) {
        Object.entries(cues).forEach(([cueName, cueDef]) => {
            this.validateCue(cueDef, cueName, context);
        });
    }

    /**
     * Validate individual cue
     */
    validateCue(cueDef, cueName, context) {
        const cueContext = `${context}.cues.${cueName}`;

        // Skip metadata fields
        if (cueName.startsWith('_')) return;

        if (Array.isArray(cueDef)) {
            // Array of commands - validate each command
            if (cueDef.length === 0) {
                this.addWarning(`Cue '${cueName}' in ${context} has empty command array`, cueContext);
                return;
            }

            cueDef.forEach((cmd, index) => {
                this.validateCueCommand(cmd, `${cueContext}[${index}]`);
            });

        } else if (typeof cueDef === 'object' && cueDef !== null) {
            // Single command object
            this.validateCueCommand(cueDef, cueContext);

        } else {
            this.addError(`Cue '${cueName}' in ${context} must be a command object or array of commands`, cueContext);
        }
    }

    /**
     * Validate individual cue command
     */
    validateCueCommand(cmd, context) {
        // Raw MQTT commands are allowed without zones.
        if (this.isRawMqttCommand(cmd)) {
            this.validateRawMqttCommand(cmd, context);
            return;
        }

        // Must have zone or zones for regular commands
        if (!cmd.zone && !cmd.zones) {
            this.addError(`Command in ${context} must specify 'zone' or 'zones'`);
            return;
        }

        // Must have command
        if (!cmd.command && !cmd.play && !cmd.scene) {
            this.addError(`Command in ${context} must specify 'command', 'play', or 'scene'`);
        }

        // Prohibited timing/blocking keywords in cues
        const isClockHint = (
            (cmd.zone === 'clock') || (Array.isArray(cmd.zones) && cmd.zones.includes('clock'))
        ) && cmd.command === 'hint';

        const prohibitedKeys = ['timeline', 'duration', 'wait', 'fire-cue', 'fire-seq', 'at'];
        prohibitedKeys.forEach(key => {
            if (cmd[key] !== undefined) {
                // Allow duration on clock hints; all other timing keys remain forbidden
                if (key === 'duration' && isClockHint) return;
                this.addError(`Cue command in ${context} cannot contain '${key}' - use sequences for timing/blocking`);
            }
        });
    }

    isRawMqttCommand(cmd) {
        return Boolean(
            cmd
            && typeof cmd === 'object'
            && (
                cmd.type === 'mqtt'
                || cmd.command === 'mqtt'
                || cmd.command === 'publish'
                || cmd.publish
            )
        );
    }

    validateRawMqttCommand(cmd, context) {
        const publish = cmd.publish && typeof cmd.publish === 'object' ? cmd.publish : null;
        const topic = publish ? publish.topic : cmd.topic;
        const payload = publish
            ? publish.payload
            : (cmd.payload !== undefined ? cmd.payload : cmd.message);

        if (!topic || typeof topic !== 'string') {
            this.addError(`Raw MQTT command in ${context} must specify string 'topic'`);
        }

        if (payload === undefined) {
            this.addError(`Raw MQTT command in ${context} must specify 'payload' or 'message'`);
        }
    }

    /**
     * Validate sequences section
     */
    validateSequences(sequences, context) {
        Object.entries(sequences).forEach(([seqName, seqDef]) => {
            this.validateSequence(seqDef, seqName, context);
        });
    }

    /**
     * Validate individual sequence
     */
    validateSequence(seqDef, seqName, context) {
        const seqContext = `${context}.sequences.${seqName}`;

        // Skip metadata fields
        if (seqName.startsWith('_')) return;

        if (Array.isArray(seqDef)) {
            // Vector sequence - validate steps
            if (seqDef.length === 0) {
                this.addWarning(`Sequence '${seqName}' in ${context} has no steps`, seqContext);
                return;
            }

            seqDef.forEach((step, index) => {
                this.validateSequenceStep(step, `${seqContext}[${index}]`);
            });

        } else if (seqDef && typeof seqDef === 'object') {
            if (seqDef.sequence && Array.isArray(seqDef.sequence)) {
                // Object-wrapped sequence with :sequence array - validate steps
                seqDef.sequence.forEach((step, index) => {
                    this.validateSequenceStep(step, `${seqContext}.sequence[${index}]`);
                });

            } else if (seqDef.timeline && Array.isArray(seqDef.timeline)) {
                // Timeline sequence - validate timeline entries
                if (typeof seqDef.duration !== 'number') {
                    this.addError(`Timeline sequence '${seqName}' in ${context} must have numeric duration`, seqContext);
                }

                seqDef.timeline.forEach((entry, index) => {
                    this.validateTimelineEntry(entry, `${seqContext}.timeline[${index}]`);
                });

            } else if (seqDef.schedule && Array.isArray(seqDef.schedule)) {
                // Schedule-based sequence - validate schedule entries  
                seqDef.schedule.forEach((entry, index) => {
                    this.validateSequenceStep(entry, `${seqContext}.schedule[${index}]`);
                });

            } else {
                this.addError(`Sequence '${seqName}' in ${context} must be an array, have :sequence array, :timeline array, or :schedule array`, seqContext);
            }
        } else {
            this.addError(`Sequence '${seqName}' in ${context} must be an array or object`, seqContext);
        }
    }

    /**
     * Validate sequence step
     */
    validateSequenceStep(step, context) {
        if (!step || typeof step !== 'object') {
            this.addError(`Sequence step in ${context} must be an object`);
            return;
        }

        // Check for prohibited :step numbering
        if (step.step !== undefined) {
            this.addError(`Sequence step in ${context} uses prohibited :step numbering - remove and use array order`);
        }

        // Validate step type
        const stepTypes = this.getStepDiscriminators(step);

        if (stepTypes.length === 0) {
            this.addError(`Sequence step in ${context} must have a valid discriminator (zone+command, fire, wait)`);
        } else if (stepTypes.length > 1) {
            this.addError(`Sequence step in ${context} has multiple discriminators: ${stepTypes.join(', ')}`);
        }

        // Validate specific step types
        if (step.wait !== undefined) {
            if (typeof step.wait !== 'number' || step.wait < 0) {
                this.addError(`Wait step in ${context} must have positive numeric duration`);
            }
        }

        if (step.fire) {
            if (typeof step.fire !== 'string') {
                this.addError(`Fire step in ${context} must reference a string named target`);
            }
        }

        if (step.hint !== undefined) {
            this.addError(`Sequence step in ${context} uses unsupported hint key - use fire`);
        }

        if (step['fire-cue'] !== undefined) {
            this.addError(`Sequence step in ${context} uses unsupported fire-cue key - use fire`);
        }

        if (step['fire-seq'] !== undefined) {
            this.addError(`Sequence step in ${context} uses unsupported fire-seq key - use fire`);
        }

        if (step.zone || step.zones) {
            this.validateCueCommand(step, context);
        }
    }

    /**
     * Validate timeline entry
     */
    validateTimelineEntry(entry, context) {
        if (!entry || typeof entry !== 'object') {
            this.addError(`Timeline entry in ${context} must be an object`);
            return;
        }

        // Must have :at timing
        if (typeof entry.at !== 'number') {
            this.addError(`Timeline entry in ${context} must have numeric 'at' timing`);
        }

        // Validate command part (remove :at for command validation)
        const { at, ...command } = entry;
        const commandTypes = this.getStepDiscriminators(command);

        if (commandTypes.length !== 1) {
            this.addError(`Timeline entry in ${context} must have exactly one command discriminator, found: ${commandTypes.join(', ')}`);
        }

        // Validate command syntax
        if (command.zone || command.zones) {
            this.validateCueCommand(command, context);
        }
    }

    /**
     * Validate phase configuration
     */
    validatePhase(phase, phaseContext) {
        if (phase.schedule) {
            this.validateSchedule(phase.schedule, phaseContext);
        }

        if (phase.sequence) {
            // Phase sequence reference - validate it exists
            if (typeof phase.sequence !== 'string') {
                this.addError(`Phase ${phaseContext} sequence reference must be a string`);
            }
        }
    }

    validateAdditionalPhaseRegistry(additionalPhases, context) {
        if (!additionalPhases || typeof additionalPhases !== 'object' || Array.isArray(additionalPhases)) {
            this.addError(`Additional phase registry at ${context} must be a map/object`, context);
            return;
        }

        Object.entries(additionalPhases).forEach(([phaseName, phaseDef]) => {
            const phaseContext = `${context}.${phaseName}`;
            if (!phaseDef || typeof phaseDef !== 'object' || Array.isArray(phaseDef)) {
                this.addError(`Additional phase '${phaseName}' must be an object`, phaseContext);
                return;
            }

            const phaseType = phaseDef['phase-type'] || phaseDef.phaseType;
            if (!phaseType || typeof phaseType !== 'string') {
                this.addError(`Additional phase '${phaseName}' must define string :phase-type`, phaseContext);
                return;
            }

            const normalized = String(phaseType).replace(/^:/, '').toLowerCase();
            if (!['solved', 'failed'].includes(normalized)) {
                this.addError(
                    `Additional phase '${phaseName}' has invalid phase-type '${phaseType}'. Supported values: :solved, :failed`,
                    phaseContext
                );
            }

            if (phaseDef.sequence === undefined && phaseDef.schedule === undefined) {
                this.addError(
                    `Additional phase '${phaseName}' must define either :sequence or :schedule`,
                    phaseContext
                );
            }

            this.validatePhase(phaseDef, phaseContext);
        });
    }

    validateTriggers(triggers, context) {
        if (Array.isArray(triggers)) {
            triggers.forEach((rule, index) => {
                this.validateTriggerRule(rule, `${context}[${index}]`, rule?.name || `trigger-${index}`);
            });
            return;
        }

        if (!triggers || typeof triggers !== 'object') {
            this.addError(`Triggers in ${context} must be an object or array`);
            return;
        }

        if (Array.isArray(triggers.escapeRoomRules)) {
            triggers.escapeRoomRules.forEach((rule, index) => {
                this.validateTriggerRule(rule, `${context}.escapeRoomRules[${index}]`, rule?.name || `trigger-${index}`);
            });
            return;
        }

        Object.entries(triggers).forEach(([triggerName, triggerDef]) => {
            if (triggerName.startsWith('_')) return;
            this.validateTriggerRule(triggerDef, `${context}.${triggerName}`, triggerName);
        });
    }

    validateTriggerRule(rule, context, triggerName) {
        if (!rule || typeof rule !== 'object') {
            this.addError(`Trigger '${triggerName}' in ${context} must be an object`);
            return;
        }

        const whenPhase = rule['when-phase'] ?? rule.whenPhase ?? rule.trigger?.['when-phase'] ?? rule.trigger?.whenPhase;
        if (whenPhase !== undefined) {
            const validWhenPhase = typeof whenPhase === 'string'
                || (Array.isArray(whenPhase) && whenPhase.every(phase => typeof phase === 'string'));
            if (!validWhenPhase) {
                this.addError(`Trigger '${triggerName}' in ${context} must use string or string-array when-phase guard`, `${context}.when-phase`);
            }
        }

        if (!Array.isArray(rule.actions)) {
            this.addError(`Trigger '${triggerName}' in ${context} must define :actions as an array`, `${context}.actions`);
            return;
        }

        if (rule.actions.length === 0) {
            this.addWarning(`Trigger '${triggerName}' in ${context} has no actions`, `${context}.actions`);
            return;
        }

        rule.actions.forEach((action, index) => {
            this.validateTriggerAction(action, `${context}.actions[${index}]`);
        });
    }

    validateTriggerAction(action, context) {
        if (!action || typeof action !== 'object') {
            this.addError(`Trigger action in ${context} must be an object`);
            return;
        }

        const discriminators = this.getTriggerActionDiscriminators(action);

        if (discriminators.length === 0) {
            this.addError(`Trigger action in ${context} must have a valid discriminator (fire, zone action, raw MQTT, end)`);
        } else if (discriminators.length > 1) {
            this.addError(`Trigger action in ${context} has multiple discriminators: ${discriminators.join(', ')}`);
        }

        this.validateTriggerActionProhibitedSyntax(action, context);

        if (action.fire !== undefined && typeof action.fire !== 'string') {
            this.addError(`Trigger action ${context} fire must reference a string named target`);
        }

        if (action.end !== undefined) {
            const normalized = String(action.end).trim().toLowerCase();
            const allowed = new Set(['win', 'solve', 'solved', 'sovled', 'fail', 'failed', 'lose', 'loss']);
            if (!allowed.has(normalized)) {
                this.addError(`Trigger action ${context} end must be one of: win, solve, fail`);
            }
        }

        if (this.isRawMqttCommand(action)) {
            this.validateRawMqttCommand(action, context);
        }

        const cueStyleAction = Boolean(
            action.zone
            || action.zones
            || action.play
            || action.scene
            || ((action.command || action.publish) && (action.zone || action.zones))
        );

        if (cueStyleAction) {
            this.validateCueCommand(action, context);
        }
    }

    /**
     * Validate schedule entries
     */
    validateSchedule(schedule, context) {
        // Support both inline schedules (arrays) and schedule references (strings)
        if (typeof schedule === 'string') {
            // Schedule reference - will be resolved at runtime
            return;
        }

        if (!Array.isArray(schedule)) {
            this.addError(`Schedule in ${context} must be an array or a string reference`);
            return;
        }

        schedule.forEach((entry, index) => {
            this.validateScheduleEntry(entry, `${context}.schedule[${index}]`);
        });
    }

    /**
     * Validate individual schedule entry
     */
    validateScheduleEntry(entry, context) {
        if (!entry || typeof entry !== 'object') {
            this.addError(`Schedule entry in ${context} must be an object`);
            return;
        }

        // Must have :at timing
        if (typeof entry.at !== 'number') {
            this.addError(`Schedule entry in ${context} must have numeric 'at' timing`);
        }

        // Check discriminators
        const { at, comment, ...command } = entry; // Remove metadata fields
        const discriminators = this.getScheduleDiscriminators(command);

        if (discriminators.length === 0) {
            this.addError(`Schedule entry in ${context} must have a valid discriminator (fire, zone+command, end)`);
        } else if (discriminators.length > 1) {
            this.addError(`Schedule entry in ${context} has multiple discriminators: ${discriminators.join(', ')}`);
        }

        // Check for prohibited syntax
        this.validateScheduleProhibitedSyntax(command, context);

        // Validate command content
        if (command.fire) {
            if (typeof command.fire !== 'string') {
                this.addError(`Schedule entry ${context} fire must reference a string named target`);
            }
        }

        if (command.hint !== undefined) {
            this.addError(`Schedule entry ${context} uses unsupported hint key - use fire`);
        }

        if (command.playHint !== undefined) {
            this.addError(`Schedule entry ${context} uses unsupported playHint key - use fire`);
        }

        if (command['play-hint'] !== undefined) {
            this.addError(`Schedule entry ${context} uses unsupported play-hint key - use fire`);
        }

        if (command.zone || command.zones) {
            this.validateCueCommand(command, context);
        }

        if (this.isRawMqttCommand(command)) {
            this.validateRawMqttCommand(command, context);
        }
    }

    /**
     * Check for prohibited syntax in schedules
     */
    validateScheduleProhibitedSyntax(command, context) {
        // Prohibited execution syntax that should generate errors
        const prohibited = [
            { key: 'cue', replacement: 'fire' },
            { key: 'sequence', replacement: 'fire' },
            { key: 'seq', replacement: 'fire' },
            { key: 'fireCue', replacement: 'fire' },
            { key: 'fireSeq', replacement: 'fire' },
            { key: 'fire-cue', replacement: 'fire' },
            { key: 'fire-seq', replacement: 'fire' }
        ];

        prohibited.forEach(({ key, replacement }) => {
            if (command[key] !== undefined) {
                this.addError(`Schedule entry ${context}: Use '${replacement}' instead of '${key}' for execution`);
            }
        });

        if (command.schedule !== undefined) {
            this.addError(`Schedule entry ${context} cannot execute nested schedules - schedules are phase-only`);
        }

        // Reject legacy :commands arrays in schedule entries.
        if (command.commands) {
            this.addError(`Schedule entry ${context} uses unsupported :commands array - use inline command syntax or a named sequence`);
        }
    }

    /**
     * Validate prohibited sections (old format)
     */
    validateProhibitedSections(config, context) {
        const prohibited = ['actions', 'commands'];

        prohibited.forEach(section => {
            if (config[section]) {
                this.addError(`Configuration ${context} contains prohibited section '${section}' - migrate to new format`);
            }
        });
    }

    /**
     * Validate name uniqueness within a single scope
     * 
     * IMPORTANT: This validates WITHIN-SCOPE uniqueness only.
    * - Checks that cues, sequences, and hints don't have duplicate names in the SAME scope
     * - Does NOT check cross-scope (e.g., global vs game-mode) - those are allowed overrides
     * 
     * Example of what this CATCHES (ERROR):
    *   global.cues.intro + global.sequences.intro = DUPLICATE (same scope)
    *   global.hints.intro + global.cues.intro = DUPLICATE (same scope)
     * 
     * Example of what this ALLOWS (valid override):
     *   global.cues.intro + game-modes.hc-demo.cues.intro = OK (different scopes, local wins)
     */
    validateNameUniqueness(config, context) {
        const nameRegistry = new Map(); // name -> array of locations within THIS scope

        const registerName = (name, location) => {
            if (!nameRegistry.has(name)) {
                nameRegistry.set(name, []);
            }
            nameRegistry.get(name).push(location);
        };

        // Check cue names in this scope
        if (config.cues) {
            Object.keys(config.cues).forEach(name => {
                registerName(name, `${context}.cues.${name}`);
            });
        }

        // Check hint names in this scope.
        if (config.hints) {
            this.collectHintNames(config.hints, `${context}.hints`, registerName);
        }

        // Check sequence names in this scope (may be nested or flat)
        if (config.sequences) {
            this.collectSequenceNames(config.sequences, `${context}.sequences`, registerName);
        }

        // Check system-sequences if at global level
        if (config['system-sequences']) {
            this.collectSequenceNames(config['system-sequences'], `${context}.system-sequences`, registerName);
        }

        // Check command-sequences if at global level
        if (config['command-sequences']) {
            this.collectSequenceNames(config['command-sequences'], `${context}.command-sequences`, registerName);
        }

        // Report duplicates within this scope only
        nameRegistry.forEach((locations, name) => {
            if (locations.length > 1) {
                this.addError(
                    `Duplicate name '${name}' within ${context} scope found at: ${locations.join(', ')}. ` +
                    `Cue, sequence, and hint names must be unique within the same scope (but can override across scopes).`
                );
            }
        });
    }

    collectHintNames(hints, basePath, registerName) {
        if (!hints) return;

        if (Array.isArray(hints)) {
            hints.forEach((hint, index) => {
                if (!hint || typeof hint !== 'object') return;
                const hintId = typeof hint.id === 'string' ? hint.id : null;
                if (hintId) {
                    registerName(hintId, `${basePath}[${index}].id`);
                }
            });
            return;
        }

        if (typeof hints === 'object') {
            Object.keys(hints).forEach(name => {
                registerName(name, `${basePath}.${name}`);
            });
        }
    }

    /**
     * Recursively collect sequence names from nested structures
     * Handles both flat maps and grouped/nested sequence definitions
     */
    collectSequenceNames(sequences, basePath, registerName) {
        if (!sequences || typeof sequences !== 'object') return;

        Object.entries(sequences).forEach(([key, value]) => {
            // Skip metadata fields
            if (key.startsWith('_')) return;

            if (!value || typeof value !== 'object') return;

            // Check if this looks like a sequence definition
            const isSequenceDef = Array.isArray(value)
                || Array.isArray(value.sequence)
                || Array.isArray(value.timeline)
                || Array.isArray(value.schedule);

            if (isSequenceDef) {
                // This is a sequence definition - register it
                registerName(key, `${basePath}.${key}`);
            } else {
                // This might be a category/group containing sequences - recurse
                this.collectSequenceNames(value, `${basePath}.${key}`, registerName);
            }
        });
    }

    /**
     * Get step discriminators for validation
     */
    getStepDiscriminators(step) {
        const discriminators = [];

        if (step.wait !== undefined) discriminators.push('wait');
        if (step.fire) discriminators.push('fire');
        if (step.hint !== undefined) discriminators.push('hint (PROHIBITED)');
        if (step['fire-cue']) discriminators.push('fire-cue (PROHIBITED)');
        if (step['fire-seq']) discriminators.push('fire-seq (PROHIBITED)');
        if (step.zone && step.command) discriminators.push('zone+command');
        if (step.zones && step.command) discriminators.push('zones+command');

        return discriminators;
    }

    /**
     * Get schedule discriminators for validation
     */
    getScheduleDiscriminators(command) {
        const discriminators = [];

        if (command.fire) discriminators.push('fire');
        if (this.isRawMqttCommand(command)) discriminators.push('raw-mqtt');
        if (command.hint !== undefined) discriminators.push('hint (PROHIBITED)');
        if (command.playHint !== undefined || command['play-hint'] !== undefined) discriminators.push('play-hint (PROHIBITED)');
        if (command['fire-cue']) discriminators.push('fire-cue (PROHIBITED)');
        if (command['fire-seq']) discriminators.push('fire-seq (PROHIBITED)');
        if ((command.zone || command.zones) && (command.command || command.play || command.scene)) discriminators.push('zone-action');
        if (command.commands) discriminators.push('commands');
        if (command.end) discriminators.push('end');

        // Prohibited but counted for error detection
        if (command.cue) discriminators.push('cue (PROHIBITED)');
        if (command.sequence) discriminators.push('sequence (PROHIBITED)');
        if (command.seq) discriminators.push('seq (PROHIBITED)');
        if (command.schedule !== undefined) discriminators.push('schedule (PROHIBITED)');

        return discriminators;
    }

    getTriggerActionDiscriminators(action) {
        const discriminators = [];

        if (action.fire) discriminators.push('fire');
        if (this.isRawMqttCommand(action)) discriminators.push('raw-mqtt');
        if ((action.zone || action.zones) && (action.command || action.play || action.scene)) discriminators.push('zone-action');
        if (action.end) discriminators.push('end');

        if (action.type !== undefined) discriminators.push('type (PROHIBITED)');
        if (action.cue !== undefined) discriminators.push('cue (PROHIBITED)');
        if (action.sequence !== undefined) discriminators.push('sequence (PROHIBITED)');
        if (action.seq !== undefined) discriminators.push('seq (PROHIBITED)');
        if (action.hint !== undefined) discriminators.push('hint (PROHIBITED)');
        if (action.playHint !== undefined || action['play-hint'] !== undefined) discriminators.push('play-hint (PROHIBITED)');
        if (action['fire-cue'] !== undefined) discriminators.push('fire-cue (PROHIBITED)');
        if (action['fire-seq'] !== undefined) discriminators.push('fire-seq (PROHIBITED)');
        if (action.schedule !== undefined) discriminators.push('schedule (PROHIBITED)');
        if (action.commands !== undefined) discriminators.push('commands (PROHIBITED)');

        return discriminators;
    }

    validateTriggerActionProhibitedSyntax(action, context) {
        const prohibited = [
            { key: 'cue', replacement: 'fire' },
            { key: 'sequence', replacement: 'fire' },
            { key: 'seq', replacement: 'fire' },
            { key: 'hint', replacement: 'fire' },
            { key: 'playHint', replacement: 'fire' },
            { key: 'play-hint', replacement: 'fire' },
            { key: 'fire-cue', replacement: 'fire' },
            { key: 'fire-seq', replacement: 'fire' }
        ];

        prohibited.forEach(({ key, replacement }) => {
            if (action[key] !== undefined) {
                this.addError(`Trigger action ${context}: Use '${replacement}' instead of '${key}' for execution`);
            }
        });

        if (action.type !== undefined) {
            this.addError(`Trigger action ${context} uses unsupported legacy 'type' syntax - use fire, end, inline zone actions, or raw MQTT publish`);
        }

        if (action.schedule !== undefined) {
            this.addError(`Trigger action ${context} cannot execute schedules directly - schedules are phase-only`);
        }

        if (action.commands !== undefined) {
            this.addError(`Trigger action ${context} uses unsupported :commands array - use inline action syntax or fire a named sequence`);
        }
    }

    /**
     * Utility methods for error/warning management
     */
    addError(message, context = '') {
        const fullMessage = context ? `${message} (${context})` : message;
        this.errors.push(fullMessage);
        console.error(`❌ ${fullMessage}`);
    }

    addWarning(message, context = '') {
        const fullMessage = context ? `${message} (${context})` : message;
        this.warnings.push(fullMessage);
        console.warn(`⚠️  ${fullMessage}`);
    }

    /**
     * Print validation report
     */
    printValidationReport() {
        console.log(`\n📊 Validation Results:`);
        console.log(`   - Errors: ${this.errors.length}`);
        console.log(`   - Warnings: ${this.warnings.length}`);

        if (this.errors.length === 0 && this.warnings.length === 0) {
            console.log(`\n✅ Configuration is valid!`);
        } else {
            if (this.errors.length > 0) {
                console.log(`\n❌ Configuration has errors and cannot be used:`);
                this.errors.forEach((error, i) => {
                    console.log(`   ${i + 1}. ${error}`);
                });
            }

            if (this.warnings.length > 0) {
                console.log(`\n⚠️  Warnings (review recommended):`);
                this.warnings.forEach((warning, i) => {
                    console.log(`   ${i + 1}. ${warning}`);
                });
            }
        }
    }
}

// CLI usage for standalone validation
if (require.main === module) {
    const fs = require('fs');
    const args = process.argv.slice(2);
    const configFile = args[0];

    if (!configFile) {
        console.error('Usage: node configValidator.js <config-file.json>');
        console.error('Note: Currently expects JSON format. EDN parsing to be added.');
        process.exit(1);
    }

    try {
        const configText = fs.readFileSync(configFile, 'utf8');
        const config = JSON.parse(configText);

        const validator = new ConfigValidator();
        const result = validator.validate(config);

        process.exit(result.isValid ? 0 : 1);

    } catch (error) {
        console.error(`❌ Failed to validate configuration: ${error.message}`);
        process.exit(1);
    }
}

module.exports = ConfigValidator;