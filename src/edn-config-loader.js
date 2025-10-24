const fs = require('fs');
const path = require('path');
const edn = require('edn-data');

/**
 * EDN Configuration Loader
 * Loads and parses EDN (Extensible Data Notation) configuration files
 * Uses proper EDN parser library for accurate parsing
 */
class EdnConfigLoader {
  /**
  * Load EDN configuration from file
  * @param {string} configPath - Path to EDN config file (defaults to './config/houdini.edn')
   * @returns {Object} JavaScript object representation of EDN config
   */
  static load(configPath = './config/houdini.edn') {
    try {
      const fullPath = path.resolve(configPath);
      const ednText = fs.readFileSync(fullPath, 'utf8');
      const config = this.parseEdn(ednText, fullPath);
      const jsConfig = this.convertToJavaScript(config);

      // Expand templates if they exist
      const expandedConfig = this.expandTemplates(jsConfig);

      return expandedConfig;
    } catch (error) {
      // If the error has detailed info, preserve it
      if (error.ednParseError) {
        throw error;
      }
      
      console.error(`Failed to load EDN config from ${configPath}:`, error.message);
      console.log('Falling back to JSON configuration...');

      // Fallback to JSON configuration
      try {
        // Prefer room-level JSON mirror of the EDN
        const jsonPath = path.isAbsolute(configPath)
          ? path.join(path.dirname(path.dirname(configPath)), 'config', 'houdini.json')
          : path.join(process.cwd(), 'config', 'houdini.json');
        const jsonText = fs.readFileSync(jsonPath, 'utf8');
        const config = JSON.parse(jsonText);
        console.log('Successfully loaded JSON configuration as fallback');
        return this.convertToJavaScript(config);
      } catch (jsonError) {
        console.error('JSON fallback also failed:', jsonError.message);
        throw error; // Throw original EDN error
      }
    }
  }

  /**
   * Simple EDN parser - uses proper EDN library
   * @param {string} ednText - EDN formatted text
   * @param {string} filePath - Path to file being parsed (for error messages)
   * @returns {Object} JavaScript object representation
   */
  static parseEdn(ednText, filePath = '') {
    try {
      // Use proper EDN parser library
      const parsedEdn = edn.parseEDNString(ednText);
      return this.convertToJavaScript(parsedEdn);
    } catch (error) {
      // Provide helpful error message with context
      const errorLines = this.getErrorContext(ednText, error);
      const errorMsg = `EDN parsing failed in ${filePath || 'configuration file'}:\n${error.message}\n${errorLines}`;
      
      const enhancedError = new Error(errorMsg);
      enhancedError.ednParseError = true;
      enhancedError.originalError = error;
      
      throw enhancedError;
    }
  }

  /**
   * Extract context around parse error
   * @param {string} text - Full text
   * @param {Error} error - Parse error
   * @returns {string} Formatted error context
   */
  static getErrorContext(text, error) {
    // Try to extract line/column info from error if available
    const lines = text.split('\n');
    
    // Simple context: show first few lines where error likely occurred
    const contextLines = lines.slice(0, Math.min(20, lines.length));
    const preview = contextLines.join('\n');
    
    return `\nFirst 20 lines of file:\n${preview.substring(0, 500)}${preview.length > 500 ? '...' : ''}`;
  }

  /**
   * Convert EDN data structures to JavaScript objects
   * Handles proper conversion of EDN keywords, maps, vectors, etc.
   * @param {*} ednData - EDN data structure
   * @returns {*} JavaScript equivalent
   */
  static convertToJavaScript(ednData) {
    if (ednData === null || ednData === undefined) {
      return ednData;
    }

    // Handle EDN keywords - they come as objects with a 'key' property
    if (ednData && typeof ednData === 'object' && ednData.key && typeof ednData.key === 'string' && Object.keys(ednData).length === 1) {
      return ednData.key.startsWith(':') ? ednData.key.substring(1) : ednData.key;
    }

    // Handle EDN maps - they come as objects with a 'map' property containing array of [key, value] pairs
    if (ednData && typeof ednData === 'object' && ednData.map && Array.isArray(ednData.map)) {
      const result = {};
      for (const [key, value] of ednData.map) {
        const jsKey = this.convertToJavaScript(key);
        const jsValue = this.convertToJavaScript(value);
        result[jsKey] = jsValue;
      }
      return result;
    }

    // Handle EDN sets - they come as objects with a 'set' property containing an array
    if (ednData && typeof ednData === 'object' && ednData.set && Array.isArray(ednData.set)) {
      return ednData.set.map(item => this.convertToJavaScript(item));
    }

    // Handle arrays (vectors are already arrays, or could be map entries if structure is unexpected)
    if (Array.isArray(ednData)) {
      // Check if this is an array of [key, value] pairs (which might be a map parsed differently)
      if (ednData.length > 0 && Array.isArray(ednData[0]) && ednData[0].length === 2) {
        // This looks like map entries - convert to object
        const result = {};
        for (const [key, value] of ednData) {
          const jsKey = this.convertToJavaScript(key);
          const jsValue = this.convertToJavaScript(value);
          result[jsKey] = jsValue;
        }
        return result;
      }
      // Regular array - convert items
      return ednData.map(item => this.convertToJavaScript(item));
    }

    // Handle plain objects
    if (ednData && typeof ednData === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(ednData)) {
        const jsKey = this.convertToJavaScript(key);
        const jsValue = this.convertToJavaScript(value);
        result[jsKey] = jsValue;
      }
      return result;
    }

    // Return primitive values as-is
    return ednData;
  }

  /**
   * Validate EDN configuration structure
   * @param {*} config - Parsed EDN configuration
   * @throws {Error} If configuration structure is invalid
   */
  static validateConfig(config) {
    // Validate structure
    if (!config.global || !config['game-modes']) {
      throw new Error('Config missing required sections: global or game-modes');
    }

    // Validate global section has expected structure
    if (!config.global.settings) {
      throw new Error('Global section missing settings');
    }

    return true;
  }

  /**
   * Expand templates in configuration
   * Generic template expansion system that works with any template structure
   * @param {Object} config - Configuration object with potential templates
   * @returns {Object} Configuration with templates expanded
   */
  static expandTemplates(config) {
    // Skip if no templates defined
    if (!config.global || !config.global.sequenceTemplates) {
      return config;
    }

    const templates = config.global.sequenceTemplates;
    const expanded = { ...config };

    // Process templates in any nested structure that has schedules
    this.processScheduleTemplates(expanded, templates);

    return expanded;
  }

  /**
   * Recursively process schedules in any part of the configuration
   * @param {Object} obj - Object to process
   * @param {Object} templates - Template definitions
   */
  static processScheduleTemplates(obj, templates) {
    if (!obj || typeof obj !== 'object') return;

    // If this object has a schedule array, process it
    if (Array.isArray(obj.schedule)) {
      obj.schedule = obj.schedule.flatMap(entry => {
        if (entry.type === 'sequence' && entry.template) {
          return this.expandSequenceTemplate(entry, templates);
        }
        return entry;
      });
    }

    // Recursively process all properties
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
        this.processScheduleTemplates(obj[key], templates);
      }
    }
  }

  /**
   * Expand a single sequence template into multiple schedule entries
   * @param {Object} entry - Template reference entry
   * @param {Object} templates - Template definitions
   * @returns {Array} Expanded schedule entries
   */
  static expandSequenceTemplate(entry, templates) {
    const templateName = entry.template;
    const template = templates[templateName];

    if (!template) {
      console.warn(`Template '${templateName}' not found, skipping expansion`);
      return [entry]; // Return original entry if template not found
    }

    const startTime = entry.at;
    const duration = entry.duration || 0;
    const expanded = [];

    // Process pre-sequence actions
    if (template.preVideo || template.preSequence) {
      const preActions = template.preVideo || template.preSequence;
      preActions.forEach(step => {
        const expandedEntry = this.createExpandedEntry(entry, step, startTime, 0);
        if (expandedEntry) expanded.push(expandedEntry);
      });
    }

    // Add main sequence action
    const mainEntry = {
      at: startTime,
      type: entry.mainType || 'standard',
      comment: entry.comment || `Template ${templateName} main action`
    };

    // Copy template-specific properties
    Object.keys(entry).forEach(key => {
      if (!['at', 'type', 'template', 'duration', 'mainType', 'comment'].includes(key)) {
        mainEntry[key] = entry[key];
      }
    });

    expanded.push(mainEntry);

    // Process post-sequence actions
    if (template.postVideo || template.postSequence) {
      const postActions = template.postVideo || template.postSequence;
      postActions.forEach(step => {
        const expandedEntry = this.createExpandedEntry(entry, step, startTime, duration);
        if (expandedEntry) expanded.push(expandedEntry);
      });
    }

    return expanded;
  }

  /**
   * Create an expanded entry from a template step
   * @param {Object} originalEntry - Original template reference
   * @param {Object} step - Template step definition
   * @param {number} baseTime - Base time for calculations
   * @param {number} duration - Duration offset for post-sequence actions
   * @returns {Object} Expanded schedule entry
   */
  static createExpandedEntry(originalEntry, step, baseTime, duration) {
    const expandedEntry = {
      at: baseTime + duration + (step.offset || 0),
      type: step.type || 'standard',
      comment: step.comment || `Template ${originalEntry.template} action`
    };

    // Merge actions using configurable strategy
    if (step.actions) {
      step.actions.forEach(action => {
        this.mergeAction(expandedEntry, action);
      });
    }

    // Copy any direct properties from step
    Object.keys(step).forEach(key => {
      if (!['offset', 'actions', 'type', 'comment'].includes(key)) {
        expandedEntry[key] = step[key];
      }
    });

    return expandedEntry;
  }

  /**
   * Merge an action into an expanded entry
   * Uses configurable merge strategies for different action types
   * @param {Object} entry - Target entry
   * @param {Object} action - Action to merge
   */
  static mergeAction(entry, action) {
    // Default merge strategies (can be overridden by config)
    const mergeStrategies = {
      // These properties get merged as objects
      clock: 'merge',
      lights: 'override',
      // Zone keys (any configured media zone) are handled by the default 'override'

      // Special cases
      fireCue: 'override',
      playHint: 'override',
      disableWhen: 'override'
    };

    Object.keys(action).forEach(key => {
      const strategy = mergeStrategies[key] || 'override';

      if (strategy === 'merge' && typeof action[key] === 'object' && typeof entry[key] === 'object') {
        entry[key] = { ...entry[key], ...action[key] };
      } else {
        entry[key] = action[key];
      }
    });
  }

  /**
   * Configure merge strategies for template actions
   * @param {Object} strategies - Custom merge strategies
   */
  static configureMergeStrategies(strategies) {
    this.customMergeStrategies = strategies;
  }

  /**
   * Convert JavaScript object back to EDN string
   * @param {Object} jsObject - JavaScript object to convert
   * @returns {string} EDN formatted string
   */
  static stringify(jsObject) {
    function convertToEdn(obj, indent = 0) {
      const spaces = ' '.repeat(indent);

      if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        const items = obj.map(item => convertToEdn(item, indent + 2)).join('\n' + ' '.repeat(indent + 2));
        return `[\n${' '.repeat(indent + 2)}${items}\n${spaces}]`;
      }

      if (obj && typeof obj === 'object') {
        const entries = Object.entries(obj).map(([key, value]) => {
          const ednKey = key.includes('-') ? `:${key}` : `:${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
          return `${' '.repeat(indent + 2)}${ednKey} ${convertToEdn(value, indent + 2)}`;
        }).join('\n');
        return `{\n${entries}\n${spaces}}`;
      }

      if (typeof obj === 'string') {
        return `"${obj}"`;
      }

      return String(obj);
    }

    return convertToEdn(jsObject);
  }
  static stringify(jsObject) {
    function convertToEdn(obj, indent = 0) {
      const spaces = ' '.repeat(indent);

      if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        const items = obj.map(item => convertToEdn(item, indent + 2)).join('\n' + ' '.repeat(indent + 2));
        return `[\n${' '.repeat(indent + 2)}${items}\n${spaces}]`;
      }

      if (obj && typeof obj === 'object') {
        const entries = Object.entries(obj).map(([key, value]) => {
          const ednKey = key.includes('-') ? `:${key}` : `:${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
          return `${' '.repeat(indent + 2)}${ednKey} ${convertToEdn(value, indent + 2)}`;
        }).join('\n');
        return `{\n${entries}\n${spaces}}`;
      }

      if (typeof obj === 'string') {
        return `"${obj}"`;
      }

      return String(obj);
    }

    return convertToEdn(jsObject);
  }
}

module.exports = EdnConfigLoader;
