# Command Line Interface (CLI) Reference

## Basic Usage

```bash
node src/game.js [options]
```

Or if installed globally:

```bash
pxo [options]
```

---

## Command Line Options

### Configuration Files

#### `--edn <path>` (Game Configuration)

Specifies the path to the EDN game configuration file.

**Purpose**: Game logic, sequences, cues, commands, hints, modes

**Example**:
```bash
node src/game.js --edn /path/to/game.edn
```

**Default**: `../config/game.edn` (relative to PxO directory)

**When to use**: 
- Specifying a custom game configuration
- Running different game scenarios
- Testing new game content

---

#### `--config <path>` (System Configuration)

Specifies the path to the INI system configuration file.

**Purpose**: MQTT broker, logging, system settings

**Example**:
```bash
node src/game.js --config /etc/paradox/pxo.ini
```

**Default**: Searches in order:
1. `./pxo.ini`
2. `./config/pxo.ini`
3. `/etc/paradox/pxo.ini`

**When to use**:
- Custom MQTT broker settings
- Different logging configuration
- Production vs development environments

---

### Game Modes

#### `--mode <mode>`

Specifies the game mode to run.

**Example**:
```bash
node src/game.js --mode demo
```

**Common modes**:
- `60min` — Full 60-minute game
- `30min` — Shorter 30-minute game
- `demo` — Quick demo (5-10 minutes)

**Default**: Defined by `:default-mode` in EDN config

**When to use**:
- Testing different game durations
- Running demos for visitors
- Override default mode at runtime

---

### Configuration Format

#### `--json`

Forces JSON configuration format instead of EDN.

**Example**:
```bash
node src/game.js --json
```

**Default**: EDN format

**When to use**:
- Legacy configurations
- Systems that can't parse EDN

**Note**: EDN is recommended for new projects

---

### Other Options

#### `--help`

Display help information.

```bash
node src/game.js --help
```

#### `--version`

Display PxO version.

```bash
node src/game.js --version
```

---

## Environment Variables

Environment variables can override configuration settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `MQTT_BROKER` | MQTT broker address | `MQTT_BROKER=192.168.1.100` |
| `MQTT_PORT` | MQTT broker port | `MQTT_PORT=1883` |
| `LOG_LEVEL` | Logging level | `LOG_LEVEL=debug` |
| `LOG_DIRECTORY` | Log file directory | `LOG_DIRECTORY=/var/log/pxo` |
| `GAME_MODE` | Default game mode | `GAME_MODE=demo` |
| `CONFIG_FORMAT` | Config format (json/edn) | `CONFIG_FORMAT=edn` |

**Example**:
```bash
MQTT_BROKER=192.168.1.50 LOG_LEVEL=debug node src/game.js --mode demo
```

---

## Complete Examples

### Basic Usage (Defaults)

```bash
# Uses default config files and mode
node src/game.js
```

**Loads**:
- EDN: `../config/game.edn`
- INI: `./config/pxo.ini` or `/etc/paradox/pxo.ini`
- Mode: Defined in EDN config (`:default-mode`)

---

### Custom Game Configuration

```bash
# Run specific game with demo mode
node src/game.js --edn /opt/paradox/rooms/my-game/game.edn --mode demo
```

---

### Production Deployment

```bash
# Production INI with custom game
node src/game.js \
  --config /etc/paradox/pxo-production.ini \
  --edn /opt/paradox/rooms/houdini/game.edn \
  --mode 60min
```

---

### Development/Testing

```bash
# Debug logging with demo mode
LOG_LEVEL=debug node src/game.js --edn test-game.edn --mode test
```

---

### Override MQTT Broker

```bash
# Use remote MQTT broker
MQTT_BROKER=192.168.1.100 node src/game.js
```

---

## Configuration Precedence

Settings are resolved in this order (highest priority first):

1. **Environment variables** — `MQTT_BROKER=...`, `LOG_LEVEL=...`
2. **Command line flags** — `--mode demo`, `--config custom.ini`
3. **INI file** — System settings (MQTT, logging)
4. **EDN file** — Game configuration (sequences, modes)
5. **Built-in defaults** — Hardcoded fallbacks

**Example**:
```bash
# INI file says: log_level = info
# But environment overrides:
LOG_LEVEL=debug node src/game.js
# → Logs at DEBUG level
```

---

## Common Scenarios

### Scenario 1: Testing New Game Content

```bash
# Test with demo mode, debug logging
LOG_LEVEL=debug node src/game.js \
  --edn my-new-game.edn \
  --mode demo
```

### Scenario 2: Production Deployment

```bash
# Use systemd service with production configs
# In /etc/systemd/system/pxo.service:
ExecStart=/usr/bin/node /opt/paradox/pxo/src/game.js \
  --config /etc/paradox/pxo.ini \
  --edn /opt/paradox/rooms/houdini/game.edn
```

### Scenario 3: Remote MQTT Broker

```bash
# Connect to broker on different server
MQTT_BROKER=192.168.1.50 MQTT_PORT=1883 node src/game.js
```

### Scenario 4: Multiple Games on Same Server

```bash
# Game 1 (port 1883)
node src/game.js --edn /opt/paradox/rooms/game1/game.edn &

# Game 2 (port 1884)
MQTT_PORT=1884 node src/game.js --edn /opt/paradox/rooms/game2/game.edn &
```

---

## Troubleshooting

### "Config missing required sections"

**Problem**: EDN config is missing `:global` or `:game-modes`

**Solution**: Use modular config format:
```clojure
{
  :global {
    :settings {:default-mode :demo}
    :zones { ... }
    :cues { ... }
  }
  :game-modes {
    :demo { ... }
  }
}
```

### "Cannot find module"

**Problem**: Running from wrong directory

**Solution**: Run from PxO root or use absolute paths:
```bash
cd /opt/paradox/pxo
node src/game.js
```

### "MQTT connection failed"

**Problem**: MQTT broker not running or wrong address

**Solution**: Check broker and override if needed:
```bash
# Check if Mosquitto is running
systemctl status mosquitto

# Override broker address
MQTT_BROKER=localhost node src/game.js
```

---

## See Also

- [CONFIG_EDN.md](CONFIG_EDN.md) — EDN configuration reference
- [CONFIG_INI.md](CONFIG_INI.md) — INI system settings reference
- [SETUP.md](SETUP.md) — Installation and deployment
- [USER_GUIDE.md](USER_GUIDE.md) — Tutorial for building games

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
