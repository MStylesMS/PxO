# Paradox Orchestrator (PxO)

**Zone-based game engine for escape rooms and interactive experiences**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/MStylesMS/PxO/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## Overview

Paradox Orchestrator (PxO) is a flexible, MQTT-based game engine designed for escape rooms and interactive entertainment. It provides a zone-based architecture that coordinates multiple devices (lights, displays, audio, timers) through a unified configuration system.

### Key Features

- 🎯 **Zone-Based Architecture** — Modular device control through standardized adapters
- ⏱️ **Timeline Sequences** — Precise timing control for synchronized effects
- 🎮 **State Machine** — Robust game flow management (intro → gameplay → solved/failed)
- 📡 **MQTT Communication** — Real-time, distributed device coordination
- 📝 **EDN Configuration** — Human-readable, type-safe game definitions
- 🔄 **Multi-Mode Support** — Different game durations (60min, 30min, demo)
- 💡 **Hint System** — Text, speech, video, audio, and action-based hints
- 🔧 **Validation Tools** — Pre-flight config checking before deployment

## Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/MStylesMS/PxO.git
cd PxO

# Install dependencies
npm install

# Verify installation
node src/game.js --version
```

### Prerequisites

- **Node.js** 18+ or 20+ LTS
- **MQTT Broker** (Mosquitto recommended)

```bash
# Install Mosquitto (Debian/Ubuntu/Raspberry Pi OS)
sudo apt install -y mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### Basic Usage

1. **Create a game configuration** (`game.edn`):

```clojure
{
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/game/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/game/mirror"}
  }
  
  :cues {
    :lights-red {:zone "lights" :command "scene" :name "red"}
  }
  
  :sequences {
    :intro {
      :duration 30
      :timeline [
        {:at 30 :cue :lights-red}
      ]
    }
  }
  
  :phases {
    :intro [:intro]
  }
  
  :modes {
    :demo {:intro-duration 30 :game-duration 300}
  }
  
  :hints []
  :default-mode :demo
}
```

2. **Run the game engine**:

```bash
node src/game.js --config game.edn --mode demo
```

3. **Control via MQTT**:

```bash
# Start game
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"startGame","mode":"demo"}'

# Pause game
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"pauseGame"}'

# Reset game
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"resetGame"}'
```

## Architecture

### Three-Tier Command Model

```
Commands (atomic) → Cues (fire-and-forget) → Sequences (timeline-based)
```

- **Commands**: Single atomic actions (e.g., play video, change lights)
- **Cues**: Named shortcuts that execute immediately
- **Sequences**: Timeline-based execution with precise timing

### State Machine

```
ready → intro → gameplay → paused/solved/failed → sleeping
```

### Zone Adapters

- **pfx-lights** — Lighting control (ParadoxFX)
- **pfx-media** — Video/audio playback (ParadoxFX)
- **houdini-clock** — Countdown timer UI
- **system** — System commands

## Documentation

- 📖 **[User Guide](docs/USER_GUIDE.md)** — Tutorial for building your first game
- 📋 **[Specification](docs/SPEC.md)** — Complete functional specification
- 🔌 **[MQTT API](docs/MQTT_API.md)** — MQTT topics and message formats
- ⚙️ **[EDN Configuration](docs/CONFIG_EDN.md)** — EDN config reference
- 🛠️ **[INI Configuration](docs/CONFIG_INI.md)** — System settings reference
- 🚀 **[Setup & Deployment](docs/SETUP.md)** — Installation and systemd services
- 🤖 **[AI Agent Instructions](docs/AI_AGENT_INSTRUCTIONS_PXO.md)** — Development patterns

## Configuration Example

### EDN (Game Logic)

```clojure
{
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/game/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/game/mirror"}
    :audio {:type "pfx-media" :baseTopic "paradox/game/audio"}
    :clock {:type "houdini-clock" :baseTopic "paradox/game/clock"}
  }
  
  :media {
    :intro-video "media/video/intro.mp4"
    :intro-music "media/audio/intro-music.mp3"
  }
  
  :cues {
    :lights-red {:zone "lights" :command "scene" :name "red"}
    :lights-green {:zone "lights" :command "scene" :name "green"}
  }
  
  :sequences {
    :intro {
      :duration 30
      :timeline [
        {:at 30 :cue :lights-red}
        {:at 25 :zone "mirror" :command "playVideo" :file :intro-video}
        {:at 5 :cue :lights-green}
      ]
    }
  }
  
  :phases {
    :intro [:intro]
    :gameplay [:gameplay-sequence]
    :solved [:victory-sequence]
    :failed [:failure-sequence]
  }
  
  :hints [
    {:id 1 :type "text" :text "Look for the hidden key"}
  ]
  
  :modes {
    :60min {:game-duration 3600}
    :30min {:game-duration 1800}
    :demo {:game-duration 300}
  }
  
  :default-mode :demo
}
```

### INI (System Settings)

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pxo-game-engine

[logging]
level = info
directory = /opt/paradox/logs/pxo
max_files = 10

[game]
default_mode = 60min
heartbeat_ms = 1000
auto_reset_enabled = true
```

## Validation

Validate configuration before deployment:

```bash
# Validate EDN
npm run validate -- /path/to/game.edn

# Validate INI
npm run validate:ini -- /path/to/pxo.ini
```

## Deployment

### Systemd Service

```ini
[Unit]
Description=Paradox Orchestrator (PxO)
After=network.target mosquitto.service

[Service]
Type=simple
User=paradox
WorkingDirectory=/opt/paradox/pxo
ExecStart=/usr/bin/node src/game.js --config /path/to/game.edn
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable pxo.service
sudo systemctl start pxo.service
```

See [SETUP.md](docs/SETUP.md) for complete deployment instructions.

## MQTT Topics

### Game Control

```
paradox/game/commands      # Game control commands (startGame, pauseGame, etc.)
paradox/game/state         # Current game state (ready, intro, gameplay, etc.)
paradox/game/status        # Game status updates
```

### Zone Topics (example: lights)

```
paradox/game/lights/commands    # Send commands to lights zone
paradox/game/lights/state       # Current lights state
paradox/game/lights/status      # Lights status updates
```

See [MQTT_API.md](docs/MQTT_API.md) for complete API reference.

## Testing

```bash
# Monitor MQTT topics
mosquitto_sub -h localhost -t 'paradox/game/#' -v

# Test game flow
node src/game.js --config examples/demo-game.edn --mode demo
```

## Raspberry Pi Support

Optimized for Raspberry Pi 4/5:

- Swap configuration (zram + swapfile)
- Systemd service templates
- Headless operation
- Remote logging

See [SETUP.md](docs/SETUP.md) for Pi-specific instructions.

## Example Projects

- **[Houdini's Challenge](https://gitlab.gnurdle.com/paradox/houdinis-challenge)** — 60-minute escape room game

## Development

### Project Structure

```
PxO/
├── src/                    # Game engine source code
│   ├── game.js            # Main entry point
│   ├── state-machine.js   # State machine logic
│   ├── config-loader.js   # EDN/INI config loading
│   ├── mqtt-client.js     # MQTT communication
│   └── zones/             # Zone adapters
├── config/                # Configuration templates
├── docs/                  # Documentation
├── tools/                 # Validation scripts
├── package.json          # Dependencies
└── README.md             # This file
```

### Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details

## Author

**Mark Stevens**  
Paradox Rooms  
mark@paradoxrooms.com

## Links

- **GitHub**: https://github.com/MStylesMS/PxO
- **GitLab Mirror**: https://gitlab.gnurdle.com/paradox/pxo (coming soon)
- **Issues**: https://github.com/MStylesMS/PxO/issues
- **Documentation**: https://github.com/MStylesMS/PxO/tree/main/docs

---

**Version**: 1.0.0  
**Last Updated**: October 2025
