# Paradox Orchestrator (PxO)

> A modular, MQTT-based game orchestration engine for escape rooms and interactive experiences

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![MQTT](https://img.shields.io/badge/MQTT-v5-blue)](https://mqtt.org/)

## Features

- 🎮 **State Machine-Driven Game Flow** — Explicit state transitions (ready → intro → gameplay → solved/failed)
- ⚡ **Three-Tier Configuration Model** — Commands → Cues → Sequences for clean execution semantics
- 📡 **Zone-Based MQTT Architecture** — Independent zones (lights, displays, audio) communicate via standardized topics
- ⏱️ **Timeline-Based Sequence Execution** — Precise timing control with blocking semantics and `:wait` support
- 🔧 **EDN & INI Configuration** — Type-safe EDN for game logic, INI for system settings
- 💡 **Extensible Zone Adapters** — Easy integration with hardware controllers (ParadoxFX, custom devices)
- 🔌 **Direct Zone Communication** — UI components can send commands directly to zones for optimal performance
- 🎯 **Mode Support** — Multiple game modes (60min, 30min, demo) with per-mode overrides
- 📝 **Comprehensive Logging** — File rotation, configurable log levels, debugging support
- 🧪 **Test Coverage** — Unit, contract, and E2E tests included

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/MStylesMS/paradox-orchestrator.git
cd paradox-orchestrator

# Install dependencies
npm install

# Run tests
npm test
```

### Basic Usage

```bash
# Start with config file
node src/game.js --config /path/to/game.edn

# Or use environment variable
export PXO_CONFIG_PATH=/path/to/game.edn
node src/game.js

# Start in specific mode
node src/game.js --config game.edn --mode demo

# Debug mode (verbose logging)
LOG_LEVEL=debug node src/game.js --config game.edn
```

### Example Configuration

Create a simple game configuration (`example-game.edn`):

```clojure
{
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/game/lights"}
    :display {:type "pfx-media" :baseTopic "paradox/game/display"}
    :audio {:type "pfx-media" :baseTopic "paradox/game/audio"}
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
        {:at 25 :zone "audio" :command "playAudioFX" :file "intro-music.mp3"}
        {:at 5 :cue :lights-green}
      ]
    }
  }
  
  :phases {
    :intro [:intro]
  }
  
  :modes {
    :demo {:intro-duration 30 :game-duration 300}
  }
}
```

Run your game:

```bash
node src/game.js --config example-game.edn --mode demo
```

## Architecture Overview

### State Machine

```
ready → intro → gameplay → paused/solved/failed → sleeping/resetting
```

Each state has explicit entry/exit handlers and allowed transitions.

### Three-Tier Configuration Model

```
Commands (atomic operations)
    ↓
Cues (named shortcuts, fire-and-forget)
    ↓
Sequences (timeline-based execution with blocking semantics)
```

**Commands** target specific zones:
```clojure
{:zone "display" :command "playVideo" :file "intro.mp4"}
```

**Cues** are named shortcuts:
```clojure
:cues {
  :lights-red {:zone "lights" :command "scene" :name "red"}
}
```

**Sequences** provide timeline-based execution:
```clojure
:sequences {
  :intro {
    :duration 30
    :timeline [
      {:at 30 :cue :lights-red}
      {:at 25 :zone "audio" :command "playAudioFX" :file "music.mp3"}
    ]
  }
}
```

### Zone-Based Architecture

Each zone is an independent adapter that communicates via MQTT:

| Zone Type | Purpose | Example Topics |
|-----------|---------|----------------|
| `pfx-lights` | Lighting control | `paradox/game/lights/commands` |
| `pfx-media` | Video/audio playback | `paradox/game/display/commands` |
| `houdini-clock` | Countdown timer UI | `paradox/game/clock/commands` |
| `system` | System commands | `paradox/game/system/commands` |

**MQTT Communication Pattern**:
```
{baseTopic}/commands    # Incoming commands
{baseTopic}/state       # Zone state updates
{baseTopic}/status      # Health monitoring
{baseTopic}/warnings    # Error reporting
```

## Documentation

- **[Functional Specification](docs/SPEC.md)** — Detailed architecture, state machine, and configuration model
- **[MQTT API Reference](docs/MQTT_API.md)** — Complete MQTT topic and message format documentation
- **[EDN Configuration Guide](docs/CONFIG_EDN.md)** — Game configuration with EDN format
- **[INI Configuration Guide](docs/CONFIG_INI.md)** — System settings with INI format
- **[Setup Instructions](docs/SETUP.md)** — Installation and deployment guide
- **[User Guide](docs/USER_GUIDE.md)** — Tutorial: building your first game
- **[AI Agent Instructions](docs/AI_AGENT_INSTRUCTIONS.md)** — Development guidelines for AI coding agents

## Requirements

- **Node.js**: >= 18.0.0
- **MQTT Broker**: Mosquitto or compatible (for production use)
- **Operating System**: Linux (tested on Raspberry Pi OS, Debian, Ubuntu)

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:contract    # Command contract tests
npm run test:scheduler   # Timer and sequence tests
npm run test:e2e         # End-to-end smoke tests

# Validate config file
npm run validate -- /path/to/game.edn
```

### Adding a New Zone Adapter

1. Create `src/adapters/newzone.js`
2. Implement `executeCommand()` and `handleStateUpdate()` methods
3. Register adapter in `src/game.js`
4. Add tests in `test/command-contract.test.js`

See [AI Agent Instructions](docs/AI_AGENT_INSTRUCTIONS.md) for detailed development patterns.

## Deployment

### Systemd Service

Example systemd service file:

```ini
[Unit]
Description=Paradox Orchestrator (PxO)
After=network.target mosquitto.service

[Service]
Type=simple
User=paradox
WorkingDirectory=/opt/paradox/games/your-game
Environment="PXO_CONFIG_PATH=/opt/paradox/games/your-game/config/game.edn"
ExecStart=/usr/bin/node /opt/paradox/engines/paradox-orchestrator/src/game.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

See [SETUP.md](docs/SETUP.md) for complete deployment instructions.

## Example Games

- **[Houdini's Challenge](https://github.com/MStylesMS/houdinis-challenge)** — Full escape room game using PxO

## Integration with Hardware

PxO is designed to work with:

- **[ParadoxFX](https://github.com/MStylesMS/ParadoxFX)** — Multi-zone media controller for audio/video/lights
- **[HoudiniClock](https://github.com/MStylesMS/houdiniclock)** — React-based countdown timer UI
- Custom MQTT-enabled hardware controllers

## MQTT Broker Setup

### Install Mosquitto (Ubuntu/Debian)

```bash
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
```

### Test MQTT Communication

```bash
# Terminal 1: Subscribe to all topics
mosquitto_sub -h localhost -t 'paradox/#' -v

# Terminal 2: Start PxO
node src/game.js --config game.edn

# Terminal 3: Send a command
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"startGame","mode":"demo"}'
```

## Configuration Examples

### Multi-Zone Coordination

```clojure
:cues {
  :victory-celebration [
    {:zone "lights" :command "scene" :name "rainbow"}
    {:zone "audio" :command "playAudioFX" :file "victory.mp3" :volume 90}
    {:zone "display" :command "playVideo" :file "victory.mp4"}
  ]
}
```

### Mode-Specific Overrides

```clojure
:modes {
  :60min {
    :intro-duration 45
    :game-duration 3600
    :sequences {
      :intro {:duration 45 :timeline [...]}  ; Override for 60min mode
    }
  }
  :30min {
    :intro-duration 30
    :game-duration 1800
    ; Inherits global sequences
  }
}
```

### Hint System

```clojure
:hints [
  {
    :id 1
    :name "First Hint"
    :type "speech"
    :text "Look for the key"
    :speech-file "hints/hint-01.mp3"
    :delay 5
  }
  {
    :id 2
    :name "Video Hint"
    :type "video"
    :video-file "hints/hint-02.mp4"
    :video-zone "display"
  }
]
```

## Troubleshooting

### Engine won't start

```bash
# Check MQTT broker is running
sudo systemctl status mosquitto

# Check config file syntax
npm run validate -- config/game.edn

# Run in debug mode
LOG_LEVEL=debug node src/game.js --config config/game.edn
```

### Commands not reaching zones

```bash
# Monitor MQTT traffic
mosquitto_sub -h localhost -t '#' -v

# Check zone base topics in config
# Verify zone adapters are registered
```

### Sequence timing issues

- JavaScript timers have ~10ms variance
- Use `:wait` for critical synchronization
- Account for media file duration in timeline

See [SETUP.md](docs/SETUP.md) for more troubleshooting guidance.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

See [AI Agent Instructions](docs/AI_AGENT_INSTRUCTIONS.md) for development patterns and guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Authors

- **Mark Styles** - [Paradox Rooms](https://paradoxrooms.com)

## Acknowledgments

- Built for the escape room community
- Inspired by modular, event-driven game engines
- Designed for reliability in live entertainment environments

## Support

- **Issues**: [GitHub Issues](https://github.com/MStylesMS/paradox-orchestrator/issues)
- **Documentation**: [docs/](docs/)
- **Example Games**: [Houdini's Challenge](https://github.com/MStylesMS/houdinis-challenge)

---

**Paradox Orchestrator** — Power your interactive experiences with confidence.
