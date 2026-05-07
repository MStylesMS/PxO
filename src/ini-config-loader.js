/**
 * INI Configuration Loader for Game Engine
 * 
 * Loads infrastructure configuration from pxo.ini
 * (Separate from EDN game logic configuration)
 */

const fs = require('fs');
const path = require('path');
const ini = require('ini');

function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value !== 'string') return false;

    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
}

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
 * @param {string} configPath - Path to INI file (optional)
 * @returns {Object} Parsed configuration
 */
function loadIniConfig(configPath) {
    // Search only documented pxo.ini defaults.
    if (!configPath) {
        const candidates = [
            path.resolve(process.cwd(), 'pxo.ini'),
            path.resolve(process.cwd(), 'config', 'pxo.ini'),
            '/etc/paradox/pxo.ini'
        ];
        configPath = candidates.find(candidate => fs.existsSync(candidate)) || candidates[candidates.length - 1];
    }

    // Return defaults if file doesn't exist
    if (!fs.existsSync(configPath)) {
        return {
            global: {
                log_directory: null,
                log_level: 'info',
                game_logging: false,
                game_log_path: null,
                chat_to_player: null,
                chat_from_player: null
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
        const gameLogging = parseBoolean(config.global?.game_logging ?? config.logging?.game_logging ?? false);
        const gameLogPath = config.global?.game_log_path || config.logging?.game_log_path || null;
        const chatToPlayer = config.global?.chat_to_player || config.logging?.chat_to_player || null;
        const chatFromPlayer = config.global?.chat_from_player || config.logging?.chat_from_player || null;

        // Normalize configuration
        return {
            global: {
                log_directory: logDirectory,
                log_level: logLevel,
                game_logging: gameLogging,
                game_log_path: gameLogPath,
                chat_to_player: chatToPlayer,
                chat_from_player: chatFromPlayer
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
                log_level: 'info',
                game_logging: false,
                game_log_path: null,
                chat_to_player: null,
                chat_from_player: null
            },
            mqtt: {
                broker: null,
                port: null
            }
        };
    }
}

module.exports = { loadIniConfig };
