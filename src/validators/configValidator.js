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
    }

    /**
     * Main validation entry point
     */
    validate(config) {
        this.errors = [];
        this.warnings = [];

        console.log('🔍 Validating configuration...');

        // Validate global configuration
        if (config.global) {
            this.validateGlobalConfig(config.global);
        }

        // Validate game modes
        if (config['game-modes']) {
            Object.entries(config['game-modes']).forEach(([modeKey, mode]) => {
                this.validateGameMode(mode, modeKey);
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

    /**
     * Validate global configuration section
     */
    validateGlobalConfig(global) {
        // Validate cues
        if (global.cues) {
            this.validateCues(global.cues, 'global');
        }

        // Validate sequences
        if (global.sequences) {
            this.validateSequences(global.sequences, 'global');
        }

        // Check for prohibited sections
        this.validateProhibitedSections(global, 'global');

        // Check for name conflicts between cues and sequences
        this.validateNameUniqueness(global, 'global');
    }

    /**
     * Validate game mode configuration
     */
    validateGameMode(mode, modeKey) {
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

        // Check for name conflicts within this mode
        this.validateNameUniqueness(mode, `game-mode.${modeKey}`);
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
        // Raw MQTT commands are allowed without zones
        if (cmd.type === 'mqtt') {
            // Validate MQTT command structure
            if (!cmd.topic) {
                this.addError(`Raw MQTT command in ${context} must specify 'topic'`);
            }
            if (!cmd.payload) {
                this.addError(`Raw MQTT command in ${context} must specify 'payload'`);
            }
            return; // Skip zone validation for MQTT commands
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
            this.addError(`Sequence step in ${context} must have a valid discriminator (zone+command, fire-cue, fire-seq, wait)`);
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
                this.addError(`Fire step in ${context} must reference a string cue/sequence name`);
            }
        }

        if (step['fire-cue']) {
            if (typeof step['fire-cue'] !== 'string') {
                this.addError(`Fire-cue step in ${context} must reference a string cue name`);
            }
        }

        if (step['fire-seq']) {
            if (typeof step['fire-seq'] !== 'string') {
                this.addError(`Fire-seq step in ${context} must reference a string sequence name`);
            }
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

    /**
     * Validate schedule entries
     */
    validateSchedule(schedule, context) {
        if (!Array.isArray(schedule)) {
            this.addError(`Schedule in ${context} must be an array`);
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
            this.addError(`Schedule entry in ${context} must have a valid discriminator (fire-cue, fire-seq, zone+command)`);
        } else if (discriminators.length > 1) {
            this.addError(`Schedule entry in ${context} has multiple discriminators: ${discriminators.join(', ')}`);
        }

        // Check for prohibited syntax
        this.validateScheduleProhibitedSyntax(command, context);

        // Validate command content
        if (command.fire) {
            if (typeof command.fire !== 'string') {
                this.addError(`Schedule entry ${context} fire must reference a string cue/sequence name`);
            }
        }

        if (command['fire-cue']) {
            if (typeof command['fire-cue'] !== 'string') {
                this.addError(`Schedule entry ${context} fire-cue must reference a string cue name`);
            }
        }

        if (command['fire-seq']) {
            if (typeof command['fire-seq'] !== 'string') {
                this.addError(`Schedule entry ${context} fire-seq must reference a string sequence name`);
            }
        }

        if (command.zone || command.zones) {
            this.validateCueCommand(command, context);
        }
    }

    /**
     * Check for prohibited syntax in schedules
     */
    validateScheduleProhibitedSyntax(command, context) {
        // Prohibited execution syntax that should generate errors
        const prohibited = [
            { key: 'cue', replacement: 'fire-cue' },
            { key: 'sequence', replacement: 'fire-seq' },
            { key: 'seq', replacement: 'fire-seq' }
        ];

        prohibited.forEach(({ key, replacement }) => {
            if (command[key] !== undefined) {
                this.addError(`Schedule entry ${context}: Use '${replacement}' instead of '${key}' for execution`);
            }
        });

        // Warn about deprecated :commands arrays
        if (command.commands) {
            if (Array.isArray(command.commands) && command.commands.length > 1) {
                this.addWarning(`Schedule entry ${context} has multiple commands - consider creating a sequence`);
            } else {
                this.addWarning(`Schedule entry ${context} uses deprecated :commands array - use inline command syntax`);
            }
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
     * - Checks that cues and sequences don't have duplicate names in the SAME scope
     * - Does NOT check cross-scope (e.g., global vs game-mode) - those are allowed overrides
     * 
     * Example of what this CATCHES (ERROR):
     *   global.cues.intro + global.sequences.intro = DUPLICATE (same scope)
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
                    `Cue and sequence names must be unique within the same scope (but can override across scopes).`
                );
            }
        });
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
        if (step['fire-cue']) discriminators.push('fire-cue');
        if (step['fire-seq']) discriminators.push('fire-seq');
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
        if (command['fire-cue']) discriminators.push('fire-cue');
        if (command['fire-seq']) discriminators.push('fire-seq');
        if (command.zone && command.command) discriminators.push('zone+command');
        if (command.zones && command.command) discriminators.push('zones+command');
        if (command.commands) discriminators.push('commands');
        if (command.end) discriminators.push('end');

        // Prohibited but counted for error detection
        if (command.cue) discriminators.push('cue (PROHIBITED)');
        if (command.sequence) discriminators.push('sequence (PROHIBITED)');
        if (command.seq) discriminators.push('seq (PROHIBITED)');

        return discriminators;
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