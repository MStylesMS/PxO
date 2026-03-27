/**
 * INI Configuration Loader for Game Engine
 * 
 * Loads infrastructure configuration from game.ini file
 * (Separate from EDN game logic configuration)
 */

const fs = require('fs');
const path = require('path');
const ini = require('ini');

function normalizeBrokerUrl(broker, port) {
    if (!broker) return null;

    const trimmed = String(broker).trim();
    if (!trimmed) return null;

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
        return trimmed;
    }

    const numericPort = Number.isInteger(port) ? port : null;
    if (numericPort) {
        return `mqtt://${trimmed}:${numericPort}`;
    }

    return `mqtt://${trimmed}`;
}

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
        const mqttPort = config.mqtt?.port ? parseInt(config.mqtt.port, 10) : null;
        const mqttBroker = normalizeBrokerUrl(config.mqtt?.broker || null, mqttPort);
        const logDirectory = config.global?.log_directory || config.logging?.directory || null;
        const logLevel = config.global?.log_level || config.logging?.level || 'info';

        // Normalize configuration
        return {
            global: {
                log_directory: logDirectory,
                log_level: logLevel
            },
            mqtt: {
                broker: mqttBroker,
                port: mqttPort
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
