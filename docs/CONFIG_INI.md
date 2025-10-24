# Paradox Orchestrator (PxO) — INI Configuration Guide

**Version**: 1.0.0  
**Last Updated**: October 2025

## Overview

Paradox Orchestrator uses **INI files** for system-level configuration. INI settings handle MQTT broker connection, logging, zone topic mappings, and runtime behavior.

**Configuration Hierarchy**:
1. **EDN** (game.edn) — Game logic, sequences, cues, commands
2. **INI** (pxo.ini) — System settings, MQTT, logging, zones
3. **CLI/ENV** — Runtime overrides (--mode, --config, --ini)

INI settings override EDN defaults. CLI/ENV flags override INI.

---

## File Location

Default INI locations (searched in order):
```
./pxo.ini
./config/pxo.ini
/etc/paradox/pxo.ini
```

Override with CLI flag:
```bash
node src/game.js --ini /path/to/custom.ini
```

---

## INI Syntax

```ini
# Comment lines start with #

[section]
key = value
another_key = value with spaces

[mqtt]
broker = localhost
port = 1883
client_id = pxo-game-engine

[logging]
level = info
directory = /opt/paradox/logs/pxo
```

**Rules**:
- Sections: `[section_name]`
- Keys: `key = value`
- Comments: `#` (full line only)
- Strings: No quotes needed
- Booleans: `true` / `false` (lowercase)
- Numbers: Integer or decimal

---

## Configuration Sections

### [mqtt]

MQTT broker connection settings:

```ini
[mqtt]
# Broker hostname or IP
broker = localhost

# Broker port
port = 1883

# Client ID (must be unique per connection)
client_id = pxo-game-engine

# Username (optional)
username = paradox

# Password (optional)
password = secret123

# Base topic prefix (optional)
base_topic = paradox/game

# Connection options
keepalive = 60
clean_session = true
reconnect_period = 5000
connect_timeout = 30000

# QoS for state/status publishing
qos = 1
retain = false
```

**Required**:
- `broker` — MQTT broker address
- `port` — MQTT broker port

**Optional**:
- `username` / `password` — Authentication
- `client_id` — Defaults to `pxo-<random>`
- `base_topic` — Global topic prefix
- Connection tuning: `keepalive`, `reconnect_period`, etc.

---

### [logging]

Logging configuration:

```ini
[logging]
# Log level: trace, debug, info, warn, error
level = info

# Log directory
directory = /opt/paradox/logs/pxo

# Log file name pattern
filename = pxo-%DATE%.log

# Maximum log files to keep
max_files = 10

# Maximum log file size (MB)
max_size_mb = 10

# Console logging
console = true
console_level = info

# Colorize console output
colorize = true

# Include timestamps
timestamps = true

# Timestamp format (ISO 8601)
timestamp_format = YYYY-MM-DD HH:mm:ss.SSS
```

**Log Levels** (least to most verbose):
- `error` — Errors only
- `warn` — Warnings + errors
- `info` — Info + warnings + errors (default)
- `debug` — Debug + info + warnings + errors
- `trace` — All messages

**File Rotation**:
- New file created daily (-%DATE% pattern)
- Old files deleted when `max_files` exceeded
- Files deleted when total size > `max_size_mb` * `max_files`

---

### [game]

Game engine settings:

```ini
[game]
# Default game mode
default_mode = 60min

# Game heartbeat interval (ms)
heartbeat_ms = 1000

# Auto-reset after game end
auto_reset_enabled = true
auto_reset_delay = 300

# Hint delivery delay (seconds)
hint_delay = 5

# Sequence execution timeout (seconds)
sequence_timeout = 300

# Enable state persistence
persist_state = false
state_file = /opt/paradox/data/pxo-state.json
```

**Heartbeat**:
- `heartbeat_ms` — Interval for state/status publishing to MQTT

**Auto-Reset**:
- `auto_reset_enabled` — Automatically reset game after completion
- `auto_reset_delay` — Delay (seconds) before reset

**State Persistence** (optional):
- `persist_state` — Save/restore state on restart
- `state_file` — JSON file for state storage

---

### [zones]

Zone-specific MQTT topic overrides:

```ini
[zones]
# Override base topics from EDN
lights = paradox/game/lights
mirror = paradox/game/mirror
audio = paradox/game/audio
clock = paradox/game/clock
system = paradox/game/system

# Zone-specific settings
lights.adapter = pfx-lights
mirror.adapter = pfx-media
audio.adapter = pfx-media
clock.adapter = houdini-clock
system.adapter = system
```

**Usage**:
- Override EDN zone `:baseTopic` values
- Set zone adapter types (if not in EDN)

---

### [zones.<zonename>]

Per-zone configuration sections:

```ini
[zones.lights]
base_topic = paradox/game/lights
adapter = pfx-lights
enabled = true
timeout = 10000

[zones.mirror]
base_topic = paradox/game/mirror
adapter = pfx-media
enabled = true
media_root = /opt/paradox/media
default_volume = 80

[zones.clock]
base_topic = paradox/game/clock
adapter = houdini-clock
enabled = true
ui_url = http://localhost:3000
```

**Common Settings**:
- `base_topic` — MQTT base topic
- `adapter` — Zone adapter type
- `enabled` — Enable/disable zone
- `timeout` — Command timeout (ms)

**Adapter-Specific Settings**:
- `pfx-media`: `media_root`, `default_volume`
- `houdini-clock`: `ui_url`

---

### [server]

HTTP/WebSocket server (optional):

```ini
[server]
# Enable HTTP server
enabled = true

# Server port
port = 4000

# WebSocket support
websocket = true

# CORS origins (comma-separated)
cors_origins = http://localhost:3000,http://localhost:4000

# API key authentication
api_key = your-secret-api-key-here
```

**Usage**:
- Enables HTTP API for game control
- WebSocket for real-time state updates
- Optional API key for authentication

---

## Complete Example

```ini
# Paradox Orchestrator (PxO) Configuration
# Version: 1.0.0

[mqtt]
broker = localhost
port = 1883
client_id = pxo-game-engine
username = paradox
password = secret123
keepalive = 60
qos = 1

[logging]
level = info
directory = /opt/paradox/logs/pxo
max_files = 10
max_size_mb = 10
console = true
colorize = true

[game]
default_mode = 60min
heartbeat_ms = 1000
auto_reset_enabled = true
auto_reset_delay = 300
hint_delay = 5
sequence_timeout = 300

[zones]
lights = paradox/game/lights
mirror = paradox/game/mirror
audio = paradox/game/audio
clock = paradox/game/clock
system = paradox/game/system

[zones.lights]
adapter = pfx-lights
enabled = true
timeout = 10000

[zones.mirror]
adapter = pfx-media
enabled = true
media_root = /opt/paradox/media
default_volume = 80

[zones.audio]
adapter = pfx-media
enabled = true
media_root = /opt/paradox/media
default_volume = 70

[zones.clock]
adapter = houdini-clock
enabled = true
ui_url = http://localhost:3000
timeout = 5000

[zones.system]
adapter = system
enabled = true

[server]
enabled = false
port = 4000
websocket = false
```

---

## Configuration Precedence

Settings are resolved in this order (highest priority first):

1. **CLI Flags** — `--mode demo`, `--config game.edn`, `--ini custom.ini`
2. **Environment Variables** — `GAME_MODE=demo`, `MQTT_BROKER=192.168.1.100`
3. **INI File** — `pxo.ini` or `--ini` specified file
4. **EDN File** — `game.edn` or `--config` specified file
5. **Defaults** — Hardcoded defaults in code

**Example**:
```bash
# Override mode and MQTT broker
MQTT_BROKER=192.168.1.50 node src/game.js --mode demo

# Use custom INI
node src/game.js --ini /etc/paradox/production.ini

# Override config location
node src/game.js --config /opt/paradox/rooms/my-room/game.edn
```

---

## Environment Variables

All INI settings can be overridden via environment variables:

| INI Setting | Environment Variable | Example |
|------------|----------------------|---------|
| `[mqtt] broker` | `MQTT_BROKER` | `MQTT_BROKER=localhost` |
| `[mqtt] port` | `MQTT_PORT` | `MQTT_PORT=1883` |
| `[mqtt] username` | `MQTT_USERNAME` | `MQTT_USERNAME=user` |
| `[mqtt] password` | `MQTT_PASSWORD` | `MQTT_PASSWORD=pass` |
| `[logging] level` | `LOG_LEVEL` | `LOG_LEVEL=debug` |
| `[logging] directory` | `LOG_DIRECTORY` | `LOG_DIRECTORY=/tmp/logs` |
| `[game] default_mode` | `GAME_MODE` | `GAME_MODE=demo` |
| `[game] heartbeat_ms` | `GAME_HEARTBEAT_MS` | `GAME_HEARTBEAT_MS=2000` |

**Usage**:
```bash
# Set via shell
export MQTT_BROKER=192.168.1.100
export LOG_LEVEL=debug
node src/game.js

# Or inline
MQTT_BROKER=192.168.1.100 LOG_LEVEL=debug node src/game.js
```

---

## Systemd Service Integration

INI files work well with systemd services:

```ini
[Unit]
Description=Paradox Orchestrator (PxO)
After=network.target mosquitto.service

[Service]
Type=simple
User=paradox
WorkingDirectory=/opt/paradox/pxo
ExecStart=/usr/bin/node src/game.js --config /opt/paradox/rooms/my-room/game.edn --ini /etc/paradox/pxo.ini
Restart=always
RestartSec=5

# Environment overrides
Environment="LOG_LEVEL=info"
Environment="MQTT_BROKER=localhost"

[Install]
WantedBy=multi-user.target
```

---

## Best Practices

### 1. Separate Concerns

- **EDN**: Game logic (sequences, cues, commands, hints)
- **INI**: System settings (MQTT, logging, zones)

### 2. Use Environment Variables for Secrets

```ini
# Bad: Hardcoded credentials
[mqtt]
username = admin
password = secret123

# Good: Environment variables
[mqtt]
username = ${MQTT_USERNAME}
password = ${MQTT_PASSWORD}
```

```bash
export MQTT_USERNAME=admin
export MQTT_PASSWORD=secret123
node src/game.js
```

### 3. Version Control

- ✅ **Commit**: `pxo.ini.example` (template with defaults)
- ❌ **Don't commit**: `pxo.ini` (local settings)
- ❌ **Don't commit**: Files with credentials

### 4. Development vs Production

```ini
# Development (pxo-dev.ini)
[mqtt]
broker = localhost
[logging]
level = debug
console = true

# Production (pxo-prod.ini)
[mqtt]
broker = 192.168.1.100
[logging]
level = info
console = false
directory = /var/log/paradox/pxo
```

```bash
# Development
node src/game.js --ini config/pxo-dev.ini

# Production
node src/game.js --ini /etc/paradox/pxo-prod.ini
```

### 5. Use Comments

```ini
[mqtt]
# Production MQTT broker (on Raspberry Pi 5)
broker = 192.168.1.100
port = 1883

# Authentication (set via environment variables)
# username = ${MQTT_USERNAME}
# password = ${MQTT_PASSWORD}

[logging]
# Rotate daily, keep 10 days of logs
max_files = 10
max_size_mb = 10
```

---

## Validation

Validate INI configuration:

```bash
npm run validate:ini -- /path/to/pxo.ini
```

Common validation errors:
- Invalid section names
- Missing required keys (`mqtt.broker`, `mqtt.port`)
- Invalid boolean values (use `true`/`false`)
- Invalid log level (must be `trace`, `debug`, `info`, `warn`, `error`)
- Invalid file paths

---

## Troubleshooting

### MQTT Connection Issues

```ini
[mqtt]
broker = localhost  # Try IP address if DNS fails
port = 1883
keepalive = 60
reconnect_period = 5000  # Retry every 5 seconds
```

**Test MQTT manually**:
```bash
mosquitto_sub -h localhost -p 1883 -t 'paradox/game/#' -v
```

### Logging Not Working

```ini
[logging]
level = info
directory = /opt/paradox/logs/pxo  # Ensure directory exists and is writable
console = true  # Enable console for debugging
```

**Check permissions**:
```bash
mkdir -p /opt/paradox/logs/pxo
chmod 755 /opt/paradox/logs/pxo
```

### Zone Commands Not Executing

```ini
[zones.lights]
base_topic = paradox/game/lights  # Must match zone adapter topic
enabled = true  # Check if zone is enabled
timeout = 10000  # Increase if commands timeout
```

**Verify zone adapter is running**:
```bash
# Check ParadoxFX service
systemctl status pfx.service

# Check clock UI
curl http://localhost:3000/health
```

---

## Appendix: Default Values

If INI settings are omitted, these defaults apply:

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pxo-<random>
keepalive = 60
clean_session = true
reconnect_period = 5000
connect_timeout = 30000
qos = 1
retain = false

[logging]
level = info
directory = ./logs
filename = pxo-%DATE%.log
max_files = 10
max_size_mb = 10
console = true
colorize = true
timestamps = true

[game]
default_mode = 60min
heartbeat_ms = 1000
auto_reset_enabled = false
auto_reset_delay = 300
hint_delay = 5
sequence_timeout = 300
persist_state = false

[server]
enabled = false
port = 4000
websocket = false
```

---

## Appendix: INI Parser

PxO uses `ini` package for parsing:

```bash
npm install ini
```

```javascript
const ini = require('ini');
const fs = require('fs');

const config = ini.parse(fs.readFileSync('./pxo.ini', 'utf-8'));
console.log(config.mqtt.broker);  // "localhost"
console.log(config.logging.level);  // "info"
```

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
