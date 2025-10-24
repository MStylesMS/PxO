const fs = require('fs');
const path = require('path');
const log = require('./logger');
const ModularConfigAdapter = require('./modular-config-adapter');
const ConfigValidator = require('./validators/configValidator');

function loadConfig(format = 'edn', configPath = null) {
  if (format === 'edn') {
    return loadEdnConfig(configPath);
  } else if (format === 'json') {
    return loadJsonConfig();
  } else {
    // Default behavior: only try EDN, no JSON fallback to avoid confusion
    return loadEdnConfig(configPath);
  }
}

function loadEdnConfig(configPath = null) {
  // Load EDN configuration
  // Priority: 1) configPath argument (via --edn), 2) game.edn in config dir
  let ednFile;
  if (configPath) {
    ednFile = path.resolve(configPath);
    log.info(`Using specified EDN config file: ${ednFile}`);
  } else {
    // Default to game.edn in the game's config directory
    ednFile = path.resolve(__dirname, '..', '..', 'config', 'game.edn');
    log.info(`Using default EDN config file: ${ednFile}`);
  }
  
  // Check if file exists
  if (!fs.existsSync(ednFile)) {
    log.error(`EDN config file not found: ${ednFile}`);
    console.error('\n❌ CONFIGURATION ERROR ❌');
    console.error('═'.repeat(60));
    console.error(`EDN configuration file not found: ${ednFile}`);
    console.error('');
    console.error('Solutions:');
    console.error('  1. Create game.edn in the config directory, or');
    console.error('  2. Specify a config file with: --edn /path/to/config.edn');
    console.error('═'.repeat(60));
    console.error('');
    process.exit(1);
  }
  
  log.info(`Attempting to load EDN config file: ${ednFile}`);
  try {
    const cfg = ModularConfigAdapter.loadConfig('edn', ednFile);
    validateConfig(cfg);
    log.info(`✓ EDN config loaded successfully: ${ednFile}`);
    return cfg;
  } catch (e) {
    log.error(`✗ Failed to load EDN config (${ednFile}):`, e.message);
    console.error('\n❌ CONFIGURATION ERROR ❌');
    console.error('═'.repeat(60));
    console.error(`File: ${ednFile}`);
    console.error(`Error: ${e.message}`);
    console.error('═'.repeat(60));
    console.error('\nPlease fix the configuration file and restart the game.');
    console.error('Check the file for syntax errors such as:');
    console.error('  - Missing or extra brackets/braces');
    console.error('  - Typos in keywords (e.g., ::sequence instead of :sequence)');
    console.error('  - Malformed EDN structure');
    console.error('  - Missing required sections (:global, :game-modes)');
    console.error('');
    process.exit(1);
  }
}

function loadJsonConfig() {
  // Try to load modular configuration first (default)
  // Prefer room-level JSON mirror of EDN
  const roomJson = path.resolve(__dirname, '..', '..', 'config', 'houdini.json');
  const modularFile = fs.existsSync(roomJson)
    ? roomJson
    : path.resolve(__dirname, '..', '..', 'config', 'example.json');
  log.info(`Attempting to load default config file: ${modularFile}`);
  try {
    const raw = fs.readFileSync(modularFile, 'utf8');
    const modularConfig = JSON.parse(raw);
    log.info('Loading modular configuration format from default file');
    const cfg = ModularConfigAdapter.transform(modularConfig);
    validateConfig(cfg);
    log.info(`✓ Default modular config loaded successfully: ${modularFile}`);
    return cfg;
  } catch (e) {
    log.error(`✗ Failed to load default modular config (${modularFile}):`, e.message);
    log.info('Falling back to legacy configuration format');
  }

  // Fallback to legacy configuration
  const file = path.resolve(__dirname, '..', 'config', 'game.config.json');
  log.info(`Attempting to load legacy config file: ${file}`);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    // fallback to repo path
    const alt = path.resolve(__dirname, '..', 'config.json');
    log.info(`Primary legacy config not found, trying alternate path: ${alt}`);
    try {
      raw = fs.readFileSync(alt, 'utf8');
    } catch (e2) {
      throw new Error(`Failed to load config: ${file}`);
    }
  }
  const cfg = JSON.parse(raw);
  validateConfig(cfg);
  log.info(`✓ Legacy config loaded successfully: ${file}`);
  return cfg;
}

function validateConfig(cfg) {
  // Basic structural validation
  if (!cfg.global || !cfg.global.mqtt || !cfg.global.mqtt.broker) throw new Error('Config.global.mqtt.broker required');

  // Provide legacy topics tree if missing for backward compatibility tests
  if (!cfg.global.mqtt.topics) {
    const base = cfg.global.mqtt['game-topic'] || 'paradox/houdini';
    cfg.global.mqtt.topics = {
      ui: { base_topic: base },
      clock: { base_topic: `${base}/clock` },
      fx: {
        mirror: { base_topic: `${base}/mirror` },
        picture: { base_topic: `${base}/picture` },
        audio: { base_topic: `${base}/audio` }
      }
    };
  }
  if (!cfg.game) throw new Error('Config.game required');

  // Check for prohibited sections from old format
  validateProhibitedSections(cfg);

  // Run comprehensive three-tier model validation
  const validator = new ConfigValidator();
  const validationResult = validator.validate(cfg);

  if (!validationResult.isValid) {
    console.error('\n❌ Configuration validation failed!');
    console.error('The configuration contains errors that must be fixed before the game can run.');
    console.error('Please run the migration script or manually update the configuration.');
    console.error('\nTo migrate automatically:');
    console.error('  node scripts/migrate-config.js config/game.edn');
    process.exit(1);
  }

  if (validationResult.warnings.length > 0) {
    console.warn(`\n⚠️  Configuration loaded with ${validationResult.warnings.length} warnings.`);
    console.warn('Consider reviewing and addressing these warnings for optimal configuration.');
  }
  // Media catalog was removed in refactor; optional now.
  // if (!cfg.global || !cfg.global.media) throw new Error('Config.global.media required');

  // Color scenes validation removed - now hardcoded in UI

  // Validate new zone format if present (supports both legacy and new formats during transition)
  if (cfg.global.mqtt.zones) {
    validateZoneFormat(cfg.global.mqtt.zones);
  }

  // Validate games have required UI fields
  if (cfg['game-modes']) {
    Object.keys(cfg['game-modes']).forEach(gameId => {
      const game = cfg['game-modes'][gameId];
      if (!game.shortLabel) {
        log.warn(`Game ${gameId} missing shortLabel, using gameId`);
        game.shortLabel = gameId;
      }
      if (!game.gameLabel) {
        log.warn(`Game ${gameId} missing gameLabel, using description`);
        game.gameLabel = game.description || gameId;
      }
      if (!game.hints || !Array.isArray(game.hints)) {
        log.warn(`Game ${gameId} missing hints array, using empty array`);
        game.hints = [];
      }
    });
  }
}

function validateZoneFormat(zones) {
  const supportedTypes = ['pfx-media', 'pfx-lights', 'houdini-clock'];

  Object.entries(zones).forEach(([zoneName, zoneConfig]) => {
    if (!zoneConfig || typeof zoneConfig !== 'object') {
      throw new Error(`Zone '${zoneName}' must be an object`);
    }

    if (!zoneConfig.type) {
      throw new Error(`Zone '${zoneName}' missing required 'type' field`);
    }

    if (!supportedTypes.includes(zoneConfig.type)) {
      throw new Error(`Zone '${zoneName}' has unsupported type '${zoneConfig.type}'. Supported types: ${supportedTypes.join(', ')}`);
    }

    if (!zoneConfig['base-topic']) {
      throw new Error(`Zone '${zoneName}' missing required 'base-topic' field`);
    }

    if (typeof zoneConfig['base-topic'] !== 'string') {
      throw new Error(`Zone '${zoneName}' 'base-topic' must be a string`);
    }
  });

  log.info(`Validated ${Object.keys(zones).length} zones in new format`);
}

function validateProhibitedSections(cfg) {
  const errors = [];

  // Check global sections
  if (cfg.global) {
    if (cfg.global.actions) {
      errors.push('CONFIG ERROR: Global :actions section found - must be migrated to :cues');
    }
    if (cfg.global.commands) {
      errors.push('CONFIG ERROR: Global :commands section found - must be migrated to :sequences');
    }
  }

  // Check game-mode sections
  if (cfg['game-modes']) {
    Object.entries(cfg['game-modes']).forEach(([modeKey, mode]) => {
      if (mode.actions) {
        errors.push(`CONFIG ERROR: Game mode '${modeKey}' has :actions section - must be migrated to :cues`);
      }
      if (mode.commands) {
        errors.push(`CONFIG ERROR: Game mode '${modeKey}' has :commands section - must be migrated to :sequences`);
      }
    });
  }

  if (errors.length > 0) {
    console.error('\n❌ PROHIBITED SECTIONS DETECTED:');
    errors.forEach(error => console.error(`   ${error}`));
    console.error('\n🔧 MIGRATION REQUIRED:');
    console.error('   Run: node scripts/migrate-config.js config/game.edn');
    console.error('   This will automatically convert your configuration to the new three-tier model.');
    throw new Error('Configuration uses prohibited sections - migration required');
  }
}

module.exports = { loadConfig };
