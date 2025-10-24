// Simple logger with levels and timestamps
const EventEmitter = require('events');
const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const level = process.env.LOG_LEVEL || 'info';
const emitter = new EventEmitter();

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// Color mapping for log levels
const levelColors = {
  error: colors.red,
  warn: colors.yellow,
  info: colors.green,
  debug: colors.cyan
};

function ts() {
  return new Date().toISOString();
}

function formatMessageForLevel(l, args) {
  if (l === 'info') {
    return args.map(arg => {
      if (typeof arg === 'string') {
        return arg.replace(/\n/g, ' ').replace(/\s+/g, ' ');
      }
      try { return JSON.stringify(arg); } catch (_) { return String(arg); }
    }).join(' ');
  }
  // For non-info levels allow more detail but flatten objects
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    try { return JSON.stringify(arg); } catch (_) { return String(arg); }
  }).join(' ');
}

function log(l, ...args) {
  if (levels[l] <= levels[level]) {
    const levelUpper = l.toUpperCase();
    const color = levelColors[l] || colors.reset;
    const timestamp = `[${ts()}] ${color}[${levelUpper}]${colors.reset}`;
    const message = formatMessageForLevel(l, args);

    if (l === 'info') {
      console.log(`${timestamp} ${message}`);
    } else {
      // Preserve multi-arg formatting for stderr-like levels
      console.log(timestamp, ...args);
    }

    // Emit structured event for consumers (e.g., MQTT publishing hooks)
    try {
      emitter.emit(l, { timestamp: new Date().toISOString(), level: levelUpper, message, raw: args });
      emitter.emit('log', { timestamp: new Date().toISOString(), level: levelUpper, message, raw: args });
    } catch (_) { /* swallow emitter errors */ }
  }
}

const api = {
  error: (...a) => log('error', ...a),
  warn: (...a) => log('warn', ...a),
  info: (...a) => log('info', ...a),
  debug: (...a) => log('debug', ...a),
  // Expose EventEmitter-style subscriptions for external hooks
  on: emitter.on.bind(emitter),
  once: emitter.once.bind(emitter),
  off: emitter.removeListener.bind(emitter),
};

module.exports = api;
