const PfxAdapter = require('./pfx');
const LightsAdapter = require('./lights');
const ClockAdapter = require('./clock');
const log = require('../logger');

/**
 * Registry for zone adapters with type-based routing and unified command execution
 * Supports the new zone format: {zone-name: {type: "adapter-type", base-topic: "topic"}}
 */
class AdapterRegistry {
    constructor(mqtt, zonesConfig = {}, options = {}) {
        this.mqtt = mqtt;
        this.adapters = new Map(); // zone-name -> adapter instance
        this.typeMap = new Map(); // adapter-type -> constructor
        this.eventTopics = new Map(); // zone-name -> events topic
        // Optional context/options for adapters (e.g., timing provider, gameTopic, defaults)
        this.options = options || {};
        // Correlation ID counter for command tracing
        this.correlationCounter = 0;

        // Register supported adapter types
        this.registerAdapterType('pfx-media', PfxAdapter);
        this.registerAdapterType('pfx-lights', LightsAdapter);
        this.registerAdapterType('houdini-clock', ClockAdapter);
        this.initializeZones(zonesConfig);
    }

    /**
     * Generate correlation ID for command tracing
     */
    generateCorrelationId() {
        return `cmd-${Date.now()}-${++this.correlationCounter}`;
    }

    /**
     * Create adapter context for command execution
     */
    createAdapterContext() {
        return {
            logger: log,
            mqtt: this.mqtt,
            provider: this.options.provider,
            gameTopic: this.options.gameTopic,
            defaultFadeMs: this.options.defaultFadeMs,
            mirrorUI: this.options.mirrorUI
        };
    }

    /**
     * Execute a command on a zone adapter with structured logging and error handling
     * @param {string} zone - Zone name
     * @param {string|symbol} command - Command to execute
     * @param {object} options - Command options/parameters
     * @returns {Promise<any>} Command result
     */
    async execute(zone, command, options = {}) {
        const commandStr = typeof command === 'symbol' ? command.toString() : command;

        log.debug(`AdapterRegistry.execute: zone='${zone}', command='${commandStr}', options=${JSON.stringify(options)}`);

        try {
            const adapter = this.validateZone(zone);
            log.debug(`AdapterRegistry.execute: found adapter type='${adapter.zoneType}' for zone='${zone}'`);
            const context = this.createAdapterContext();



            // Try adapter's execute method first, fall back to direct method calls
            let result;
            if (adapter.execute && typeof adapter.execute === 'function') {
                log.debug(`AdapterRegistry.execute: calling adapter.execute() for zone='${zone}'`);
                result = await adapter.execute(commandStr, options, context);
            } else {
                // Legacy adapter - map command to direct method calls
                result = await this._executeLegacyCommand(adapter, commandStr, options);
            }

            return result;
        } catch (error) {
            log.error('Command failed', { zone, command: commandStr, error: error.message, stack: error.stack });

            // Create structured error with context
            const structuredError = new Error(`Command '${commandStr}' failed on zone '${zone}': ${error.message}`);
            structuredError.zone = zone;
            structuredError.command = commandStr;
            structuredError.originalError = error;

            throw structuredError;
        }
    }

    /**
     * Check if a zone can execute a command
     * @param {string} zone - Zone name
     * @param {string|symbol} command - Command to check
     * @returns {boolean} True if command can be executed
     */
    canExecute(zone, command) {
        try {
            const adapter = this.getZone(zone);
            if (!adapter) return false;

            const commandStr = typeof command === 'symbol' ? command.toString() : command;

            // Check if adapter has getCapabilities method
            if (adapter.getCapabilities && typeof adapter.getCapabilities === 'function') {
                return adapter.getCapabilities().includes(commandStr);
            }

            // Fall back to checking if adapter has the method or generic execute
            if (adapter.execute && typeof adapter.execute === 'function') {
                return true; // Generic execute method can handle any command
            }

            // Check for specific method on legacy adapter
            return typeof adapter[commandStr] === 'function';
        } catch (error) {
            log.warn('canExecute check failed', { zone, command, error: error.message });
            return false;
        }
    }

    /**
     * Execute command on legacy adapter using direct method calls
     * @private
     */
    async _executeLegacyCommand(adapter, command, options) {
        // Map commands to adapter methods based on known patterns
        switch (command) {
            case 'start':
                return adapter.start ? adapter.start(options.time) : Promise.resolve();
            case 'pause':
                return adapter.pause ? adapter.pause() : Promise.resolve();
            case 'resume':
                return adapter.resume ? adapter.resume(options.time) : Promise.resolve();
            case 'fade-in':
            case 'fadeIn':
                return adapter.fadeIn ? adapter.fadeIn(options.duration) : Promise.resolve();
            case 'fade-out':
            case 'fadeOut':
                return adapter.fadeOut ? adapter.fadeOut(options.duration) : Promise.resolve();
            case 'set-time':
            case 'setTime':
                return adapter.setTime ? adapter.setTime(options.time || options.mmss) : Promise.resolve();
            case 'hint':
                return adapter.hint ? adapter.hint(options.text, options.duration) : Promise.resolve();
            case 'set-scene':
            case 'scene':
                // For lights adapters
                return adapter.setScene ? adapter.setScene(options.value || options.scene) : Promise.resolve();
            default:
                // Try direct method call
                if (adapter[command] && typeof adapter[command] === 'function') {
                    return adapter[command](options);
                }
                throw new Error(`Unknown command '${command}' for adapter type '${adapter.zoneType}'`);
        }
    }

    /**
     * Register an adapter type constructor
     */
    registerAdapterType(typeName, AdapterClass) {
        this.typeMap.set(typeName, AdapterClass);
        log.debug(`Registered adapter type: ${typeName}`);
    }

    /**
     * Initialize zones from configuration
     */
    initializeZones(zonesConfig) {
        Object.entries(zonesConfig).forEach(([zoneName, zoneConfig]) => {
            try {
                this.createZoneAdapter(zoneName, zoneConfig);
            } catch (error) {
                log.error(`Failed to initialize zone '${zoneName}':`, error.message);
                // Re-throw error to ensure proper validation during testing/startup
                throw error;
            }
        });
    }

    /**
     * Create adapter for a specific zone
     */
    createZoneAdapter(zoneName, zoneConfig) {
        const { type, 'base-topic': baseTopic } = zoneConfig;

        if (!type) {
            throw new Error(`Zone '${zoneName}' missing required 'type' field`);
        }

        if (!baseTopic) {
            throw new Error(`Zone '${zoneName}' missing required 'base-topic' field`);
        }

        const AdapterClass = this.typeMap.get(type);
        if (AdapterClass === undefined) {
            throw new Error(`Unknown adapter type '${type}' for zone '${zoneName}'`);
        }

        // All adapter types now require actual adapter classes
        if (AdapterClass === null) {
            throw new Error(`No adapter class registered for zone type '${zoneConfig.type}' (zone: ${zoneName})`);
        }

        // Create adapter with appropriate topic structure based on type
        let adapter;
        let topicsArg; switch (type) {
            case 'pfx-media':
                // PfxAdapter expects { baseTopic }
                topicsArg = { baseTopic };
                adapter = new AdapterClass(this.mqtt, topicsArg);
                break;

            case 'pfx-lights':
                // LightsAdapter expects { lights: { baseTopic } }
                topicsArg = { lights: { baseTopic } };
                adapter = new AdapterClass(this.mqtt, topicsArg);
                break;

            case 'houdini-clock':
                // ClockAdapter expects { clock: { baseTopic } } and can accept extra options
                topicsArg = { clock: { baseTopic } };
                adapter = new AdapterClass(this.mqtt, topicsArg, {
                    provider: this.options.provider,
                    gameTopic: this.options.gameTopic,
                    defaultFadeMs: this.options.defaultFadeMs,
                    mirrorUI: this.options.mirrorUI === true,
                });
                break;

            default:
                throw new Error(`Unhandled adapter type '${type}' for zone '${zoneName}'`);
        }

        // Set zone metadata on adapter
        adapter.zoneName = zoneName;
        adapter.zoneType = type;
        adapter.zoneBaseTopic = baseTopic;

        // Store adapter and event topic
        this.adapters.set(zoneName, adapter);
        this.eventTopics.set(zoneName, `${baseTopic}/events`);

        log.info(`Initialized ${type} adapter for zone '${zoneName}' on topic '${baseTopic}'`);
    }

    /**
     * Get adapter by zone name
     */
    getZone(zoneName) {
        const adapter = this.adapters.get(zoneName);
        if (!adapter) {
            log.warn(`No adapter found for zone '${zoneName}'`);
        }
        return adapter;
    }

    /**
     * Get all zones of a specific adapter type
     */
    getZonesByType(adapterType) {
        return Array.from(this.adapters.entries())
            .filter(([, adapter]) => adapter.zoneType === adapterType)
            .map(([zoneName, adapter]) => ({ zoneName, adapter }));
    }

    /**
     * Get all zone names
     */
    getZoneNames() {
        return Array.from(this.adapters.keys());
    }

    /**
     * Get all adapters
     */
    getAllAdapters() {
        return Array.from(this.adapters.values());
    }

    /**
     * Get event topics for all zones
     */
    getAllEventTopics() {
        return Array.from(this.eventTopics.values());
    }

    /**
     * Get mapping of event topic to zone name
     */
    getEventTopicToZoneMap() {
        const map = {};
        for (const [zoneName, eventTopic] of this.eventTopics) {
            map[eventTopic] = zoneName;
        }
        return map;
    }

    /**
     * Validate zone exists and return adapter
     */
    validateZone(zoneName) {
        const adapter = this.getZone(zoneName);
        if (!adapter) {
            throw new Error(`Invalid zone reference: '${zoneName}'`);
        }
        return adapter;
    }

    /**
     * Cleanup all adapters
     */
    cleanup() {
        this.getAllAdapters().forEach(adapter => {
            try {
                if (adapter.cleanup && typeof adapter.cleanup === 'function') {
                    adapter.cleanup();
                }
            } catch (error) {
                log.warn(`Error cleaning up adapter for zone '${adapter.zoneName}':`, error.message);
            }
        });
    }
}

module.exports = AdapterRegistry;
