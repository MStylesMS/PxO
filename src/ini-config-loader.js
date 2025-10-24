/**
 * INI Configuration Loader for Game Engine
 * 
 * Loads infrastructure configuration from game.ini file
 * (Separate from EDN game logic configuration)
 */

const fs = require('fs');
const path = require('path');
const ini = require('ini');

/**
 * Load INI configuration file
 * @param {string} configPath - Path to INI file (default: game.ini in app directory)
 * @returns {Object} Parsed configuration
 */
function loadIniConfig(configPath) {
    // Default to game.ini in application directory if not specified
    if (!configPath) {
        configPath = path.join(__dirname, '..', 'game.ini');
    }

    // Return defaults if file doesn't exist
    if (!fs.existsSync(configPath)) {
        return {
            global: {
                log_directory: null,
                log_level: 'info'
            },
            mqtt: {
                broker: null,
                port: null
            }
        };
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = ini.parse(content);

        // Normalize configuration
        return {
            global: {
                log_directory: config.global?.log_directory || null,
                log_level: config.global?.log_level || 'info'
            },
            mqtt: {
                broker: config.mqtt?.broker || null,
                port: config.mqtt?.port ? parseInt(config.mqtt.port) : null
            }
        };
    } catch (err) {
        console.error(`Failed to load INI config from ${configPath}:`, err.message);
        // Return defaults on error
        return {
            global: {
                log_directory: null,
                log_level: 'info'
            },
            mqtt: {
                broker: null,
                port: null
            }
        };
    }
}

module.exports = { loadIniConfig };
