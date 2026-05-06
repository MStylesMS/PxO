# Paradox Orchestrator (PxO) — Functional Specification

**Version**: 1.0.0  
**Last Updated**: October 2025

## Overview

Paradox Orchestrator (PxO) is a modular, MQTT-based game orchestration engine designed for escape rooms and interactive experiences. It provides a state machine-driven framework for coordinating multiple zones (lights, displays, audio) through timeline-based sequences and flexible configuration.

### Design Principles

- **Generic Engine**: No game-specific logic in source code — all game behavior defined in configuration
- **Zone-Based Architecture**: Independent adapters for different device types (lights, media, controllers)
- **MQTT Communication**: Standardized topic structure for reliable, distributed control
- **Reliable Operation**: Designed for live entertainment environments with minimal downtime
- **Backward Compatibility**: Existing game configurations must continue working

### Key Features

- State machine with explicit transitions
- Three-tier configuration model (Commands → Cues → Sequences)
- Timeline-based sequence execution with precise timing
- EDN and INI configuration support
- Extensible zone adapter system
- Mode support for different game variations
- Comprehensive logging and error handling

---

## State Machine

### States

```
ready → intro → gameplay → paused → gameplay
                      ↓        ↓
                  solved   failed
                      ↓        ↓
                sleeping  sleeping
                      ↓        ↓
                  ready    ready
```

**State Definitions**:

| State | Description | Entry Actions | Exit Actions |
|-------|-------------|---------------|--------------|
| `ready` | Initial state, waiting for game start | Initialize timers, load config | Clear ready state |
| `intro` | Introduction/briefing phase | Start intro sequence, notify zones | Stop intro media |
| `gameplay` | Active gameplay phase | Start game timer, enable hints | Pause timer |
| `paused` | Game temporarily paused | Preserve timer state | Resume timer |
| `solved` | Game completed successfully | Execute victory sequence, celebrate | Prepare reset |
| `failed` | Time expired or critical failure | Execute failure sequence | Prepare reset |
| `sleeping` | Idle state after game end | Dim lights, show attract loop | Clean up |

### State Transitions

**Allowed transitions** (defined in `src/stateMachine.js`):

```javascript
const allowedTransitions = {
  ready: ['intro', 'sleeping'],
  intro: ['gameplay', 'paused'],
  gameplay: ['paused', 'solved', 'failed'],
  paused: ['gameplay', 'failed'],
  solved: ['sleeping', 'ready'],
  failed: ['sleeping', 'ready'],
  sleeping: ['ready']
};
```

**Transition Triggers**:

- `ready → intro`: `startGame()` command
- `intro → gameplay`: Intro sequence completes
- `gameplay → paused`: `pauseGame()` command
- `paused → gameplay`: `resumeGame()` command
- `gameplay → solved`: Puzzle completion or operator override
- `gameplay → failed`: Timer expires
- `solved/failed → sleeping`: Completion sequence finishes
- `sleeping → ready`: Auto-reset or operator command

### State Handler Methods

Each state has entry and exit handlers in the `Game` class:

```javascript
async onReadyEnter() { ... }
async onReadyExit() { ... }
async onIntroEnter() { ... }
async onIntroExit() { ... }
// ... etc
```

---

## Three-Tier Configuration Model

### Overview

```
Commands (Tier 1: Atomic Operations)
    ↓
Cues (Tier 2: Named Shortcuts)
    ↓
Sequences (Tier 3: Timeline-Based Execution)
```

### Tier 1: Commands

**Atomic operations** that target specific zones with parameters.

**Format**:
```clojure
{:zone "zonename" :command "action" ...params}
{:zones ["zone1" "zone2"] :command "action" ...params}  ; Multi-zone
```

**Examples**:
```clojure
{:zone "mirror" :command "playVideo" :file "intro.mp4"}
{:zone "lights" :command "scene" :name "green"}
{:zone "audio" :command "playAudioFX" :file "music.mp3" :volume 80}
{:zones ["mirror" "audio"] :command "stopAudio"}  ; Stop audio on multiple zones
{:zone "mirror" :command "enableBrowser" :url "http://localhost/clock/index.html"}
```

**Command Execution**:
- Routed to appropriate zone adapter
- Validated by adapter
- Transformed to MQTT message
- Published to `{baseTopic}/commands`

### Tier 2: Cues

**Named shortcuts** for commands that execute immediately (fire-and-forget).

**Format**:
```clojure
:cues {
  :cue-name {:zone "name" :command "action" ...params}
  :multi-cue-name [command1 command2 ...]  ; Multiple commands
}
```

**Examples**:
```clojure
:cues {
  :lights-red {:zone "lights" :command "scene" :name "red"}
  :show-clock {:zone "mirror" :command "showBrowser"}
  :stop-all [
    {:zones ["mirror" "audio"] :command "stopAudio"}
    {:zone "lights" :command "scene" :name "dim"}
  ]
}
```

**Cue Execution**:
- Non-blocking — returns immediately
- All commands in array execute in parallel
- No timing control (use sequences for that)
- Can be triggered from sequences or commands

### Tier 3: Sequences

**Timeline-based execution** with explicit duration and step timing.

**Format**:
```clojure
:sequences {
  :sequence-name {
    :duration 30  ; Total duration in seconds
    :timeline [
      {:at 30 :fire :cue-name}  ; Execute named cue at T-30 seconds
      {:at 25 :zone "zone" :command "action" ...params}  ; Direct command
      {:at 20 :wait 5}  ; Block for 5 seconds
      {:at 15 :fire :other-sequence}  ; Execute another named sequence
    ]
  }
}
```

**Examples**:
```clojure
:sequences {
  :intro-sequence {
    :duration 45
    :timeline [
      {:at 45 :fire :lights-red}
      {:at 40 :zone "mirror" :command "playVideo" :file "intro.mp4"}
      {:at 40 :zone "audio" :command "playAudioFX" :file "intro-music.mp3" :volume 60}
      {:at 10 :wait 5}  ; Wait 5 seconds for synchronization
      {:at 5 :zone "mirror" :command "showBrowser"}
      {:at 3 :fire :lights-green}
    ]
  }
}
```

**Special Browser Verification Command**:

`verifyBrowser` is sequence-aware and blocking. It is resolved by PxO sequence execution (not forwarded as a raw zone MQTT command), and it:
- Requests current browser state
- Calls `enableBrowser` if browser is not running
- Corrects URL/visibility drift if needed
- Polls until desired state is reached or timeout occurs

Example:

```clojure
{:at 20 :zone "mirror" :command "verifyBrowser" :url "http://localhost/clock/index.html" :visible false :timeout 15000}
```

**Sequence Execution**:
- Blocking — caller waits for completion
- Timeline items execute at specified countdown times (`:at` counts down from `:duration`)
- `:wait` provides explicit blocking delays
- Can reference cues, sequences, and hints with `:fire`
- Pause/resume support with timer state preservation

**Timing Model**:
```
Duration: 30 seconds
:at 30 → Execute at start (T=0)
:at 25 → Execute after 5 seconds (T=5)
:at 20 → Execute after 10 seconds (T=10)
:at 15 → Execute after 15 seconds (T=15)
:at  5 → Execute after 25 seconds (T=25)
:at  0 → Execute at end (T=30)
```

---

## Zone-Based Architecture

### Zone Concept

A **zone** represents a controllable entity or group of entities:
- Physical device (light, display, speaker)
- Logical grouping (all lights in a room)
- Software component (clock UI, game state)

Each zone has:
- **Zone Adapter**: Code that transforms commands to MQTT messages
- **Base Topic**: MQTT topic prefix for the zone
- **Type**: Adapter type (`mqtt-lights`, `pfx-media`, `pxc-clock`, etc.)

### MQTT Topic Structure

All zones follow standardized topic pattern:

```
{baseTopic}/commands    # Incoming commands to zone
{baseTopic}/events      # Zone discrete events (published by zone)
{baseTopic}/state       # Zone state + health/status (published by zone)
{baseTopic}/warnings    # Zone error messages (published by zone)
```

**Example**:
```
Zone: "mirror" (type: pfx-media)
Base Topic: paradox/houdini/mirror

Topics:
  paradox/houdini/mirror/commands   → PxO publishes commands here
  paradox/houdini/mirror/events     → Mirror device publishes discrete events here
  paradox/houdini/mirror/state      → Mirror device publishes state here
  paradox/houdini/mirror/state      → Mirror device also publishes health here
  paradox/houdini/mirror/warnings   → Mirror device publishes errors here
```

### Standard Zone Types

| Zone Type | Purpose | Adapter | Example Commands |
|-----------|---------|---------|------------------|
| `mqtt-lights` | Lighting control | `src/adapters/lights.js` | `scene`, `setColor`, `setBrightness` |
| `mqtt` | Generic Paradox MQTT command envelope | `src/adapters/genericMqtt.js` | `arm`, `unlock`, `showPattern` |
| `mqtt-raw` | Raw payload publish to a single topic | `src/adapters/genericMqttRaw.js` | payload-only action, e.g. `{:zone "door-lock" :payload "1"}` |

Light zones may also expose retained scene-registry metadata on `{zoneBaseTopic}/scenes` when the room EDN defines `:global :light-scenes`. PxO republishes these scene objects as opaque metadata for operator UIs and other consumers. Only display-oriented keys such as `id`, `label`, and `swatch` are assumed generically; `type` and any additional keys are consumer-defined.
| `pfx-media` | Video/audio playback | `src/adapters/mirror.js`, `audio.js` | `playVideo`, `playAudioFX`, `stopAudio` |
| `pxc-clock` | Countdown timer UI | `src/adapters/pxc.js` | `show`, `hide`, `setTime` |

### Zone Adapter Interface

All adapters implement:

```javascript
class ZoneAdapter {
  constructor(mqttClient, baseTopic, logger) {
    this.mqtt = mqttClient;
    this.topic = baseTopic;
    this.log = logger;
  }
  
  async executeCommand(command) {
    // Validate command
    // Transform to MQTT message
    // Publish to {baseTopic}/commands
  }
  
  handleStateUpdate(message) {
    // Process incoming state updates from zone
  }
}
```

### Zone Registration

Zones are registered in `src/game.js`:

```javascript
// Load zone config from EDN
const zoneConfig = config.zones.lights;

// Create adapter instance
this.adapters.lights = new LightsAdapter(
  this.mqtt,
  zoneConfig.baseTopic,
  this.logger
);

// Subscribe to zone state topic
this.mqtt.subscribe(`${zoneConfig.baseTopic}/state`);
```

---

## Configuration System

### Configuration Files

**EDN Files** (Primary):
- Game logic: sequences, cues, commands, hints
- Zone definitions
- Mode configurations
- Type-safe with keyword references

**INI Files** (System):
- MQTT broker settings
- Logging configuration
- Zone base topics (can override EDN)
- System-level settings

### EDN Configuration Structure

```clojure
{
  ;; Zone definitions
  :zones {
    :lights {:type "mqtt-lights" :baseTopic "paradox/game/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/game/mirror"}
    :audio {:type "pfx-media" :baseTopic "paradox/game/audio"}
    :clock {:type "houdini-clock" :baseTopic "paradox/game/clock"}
  }
  
  ;; Media file references
  :media {
    :intro-video "media/video/intro.mp4"
    :hint-01-audio "media/audio/hint-01.mp3"
  }
  
  ;; Reusable commands
  :commands {
    :play-intro {:zone "mirror" :command "playVideo" :file :intro-video}
  }
  
  ;; Named cues (fire-and-forget)
  :cues {
    :lights-red {:zone "lights" :command "scene" :name "red"}
    :lights-green {:zone "lights" :command "scene" :name "green"}
    :stop-all [{:zones ["mirror" "audio"] :command "stopAudio"}]
  }
  
  ;; Timeline sequences
  :sequences {
    :intro {:duration 45 :timeline [...]}
    :gameplay {:duration 3600 :timeline [...]}
  }
  
  ;; Phase execution mappings
  :phases {
    :intro [:intro]
    :gameplay [:gameplay]
    :solved [:solved-celebration]
    :failed [:failed-message]
  }
  
  ;; Game modes with overrides
  :modes {
    :60min {:intro-duration 45 :game-duration 3600}
    :30min {:intro-duration 30 :game-duration 1800}
    :demo {:intro-duration 15 :game-duration 300}
  }
  
  ;; Hints
  :hints [
    {:id 1 :name "First Hint" :type "speech" :text "..." :speech-file "..."}
  ]
  
  ;; Global settings
  :default-mode :60min
  :game-heartbeat-ms 1000
  :auto-reset-delay 300
}
```

### INI Configuration Structure

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pxo-game-engine

[logging]
level = info
directory = /opt/paradox/logs/pxo
max_files = 10
max_size_mb = 10

[zones]
lights_base_topic = paradox/game/lights
mirror_base_topic = paradox/game/mirror
audio_base_topic = paradox/game/audio

[game]
heartbeat_interval_ms = 1000
auto_reset_enabled = true
auto_reset_delay_seconds = 300
```

### Configuration Loading Order

1. Load INI file (system settings)
2. Load EDN file (game logic)
3. Merge configurations (EDN overrides INI where applicable)
4. Validate combined configuration
5. Resolve keyword references

### Configuration Path Resolution

```javascript
// Priority order:
1. --config CLI flag
2. PXO_CONFIG_PATH environment variable
3. ./config/game.edn (relative to CWD)
4. ../config/game.edn (development fallback)
```

---

## Sequence Execution

### SequenceRunner

Implemented in `src/sequenceRunner.js`.

**Responsibilities**:
- Parse sequence timeline
- Execute steps at specified times
- Handle `:wait` delays
- Support pause/resume
- Track execution state

**Execution Flow**:

```javascript
async function runSequence(sequenceDef, context) {
  const duration = sequenceDef.duration;
  const timeline = sequenceDef.timeline;
  
  // Sort timeline by :at (descending, since it counts down)
  timeline.sort((a, b) => b.at - a.at);
  
  let elapsed = 0;
  for (const step of timeline) {
    const targetTime = duration - step.at;
    const delay = targetTime - elapsed;
    
    if (delay > 0) {
      await sleep(delay * 1000);
      elapsed += delay;
    }
    
    // Execute step based on type
    if (step.fire) {
      await runByName(step.fire, context);
    } else if (step.zone) {
      await executeCommand(step);
    } else if (step.wait) {
      await sleep(step.wait * 1000);
      elapsed += step.wait;
    }
  }
}
```

### Pause/Resume Support

Sequences can be paused and resumed:

```javascript
class SequenceRunner {
  pause() {
    this.paused = true;
    this.pausedAt = Date.now();
  }
  
  resume() {
    const pauseDuration = Date.now() - this.pausedAt;
    this.elapsed += pauseDuration / 1000;
    this.paused = false;
  }
}
```

### Timing Precision

- JavaScript timers have ~10ms variance
- Sequences compensate for accumulated drift
- Use `:wait` for critical synchronization points
- Design sequences with tolerance for timing variation

---

## Hint System

### Hint Types

| Type | Description | Required Fields | Optional Fields |
|------|-------------|-----------------|-----------------|
| `text` | User-editable text hint executed through a command sequence | `sequence` | `text`, `duration` |
| `speech` | Play speech asset | `file` | `zone` |
| `audioFx` | Play sound effect | `file` | `zone` |
| `background` | Play looping background audio | `file` | `zone`, `loop` |
| `video` | Show video | `file` | `zone` |
| `image` | Show still image | `file` | `zone` |
| `action` | Future action-hint hook (currently warning/no-op) | `sequence` | `text` |
| `sequence` | Execute command-sequence template | `sequence` | `parameters`, template fields |

### Hint Configuration

```clojure
:hints {
  :hint-01 {:type "speech" :zone "tv" :file :hint-01-audio}
  :hint-02 {:type "video" :zone "tv" :file :hint-02-video}
  :hint-03 {:type "text" :sequence "hint-text-seq" :text "Follow the signal chain" :duration 15}
  :hint-04 {:type "sequence" :sequence "hint-scene-seq" :parameters {:light "red" :speed "fast" :option 7}}
}

:command-sequences {
  :hint-text-seq {:sequence [{:zone "tv" :command "playAudioFX" :file :hint-bell}
                             {:zone "clock" :command "hint" :text "{{text}}" :duration "{{duration}}"}]}
  :hint-scene-seq {:sequence [{:zone "lights" :command "scene" :name "{{light}}"}]}
}

;; Future action hint syntax (not yet executed at runtime)
:hints {
  :hint-action-sample {:type "action" :sequence "flash-lights-seq" :text "Optional UI text"}
}
```

### Hint Delivery

Hints are triggered via MQTT command:

```json
{
  "command": "executeHint",
  "id": "hint-01"
}
```

Execution flow:
1. Look up hint by ID (map key)
2. Publish text to UI (if present)
3. Execute type-specific actions:
   - `speech`: Play audio file after delay
   - `video`: Show video on specified zone
   - `action`: Future feature; currently publishes warning `hint_action_not_implemented` and performs no action
  - `text`: Resolve only from `global.command-sequences`, substitute `{{text}}`/`{{duration}}`, and allow operator text override
  - `sequence`: Resolve only from `global.command-sequences`, substitute `{{field}}` values from direct fields and `parameters` map, then execute sequence
4. Log hint delivery

Schedule execution remains phase-scoped in the current contract:

- Named schedules are valid phase targets only.
- Schedules cannot be fired directly from triggers, sequences, or hints.
- Nested schedules are validation errors; authors should use a named sequence when non-phase logic needs ordered multi-step behavior.

Placeholder policy:
- Missing placeholders are warning-only and substituted with empty values at runtime.
- Reserved built-ins are `text` and `duration` (not overridden by `parameters`).

---

## MQTT Communication

### Message Format

All MQTT messages use JSON:

```json
{
  "command": "commandName",
  "param1": "value1",
  "param2": "value2"
}
```

### Game Control Commands

Published to: `{baseTopic}/commands`

| Command | Parameters | Description |
|---------|------------|-------------|
| `startGame` | `mode` (optional) | Start game in specified mode |
| `pauseGame` | none | Pause gameplay |
| `resumeGame` | none | Resume from pause |
| `resetGame` | none | Reset to ready state |
| `solveGame` | none | Mark game as solved (operator override) |
| `executeHint` | `id` | Execute specific hint |
| `shutdown` | none | Graceful engine shutdown |
| `reboot` | none | Graceful PxO software restart |
| `halt` | none | Graceful PxO software halt |
| `sleep` | none | Put props/adapters into sleep mode |
| `wake` | none | Wake props/adapters |
| `machineShutdown` | none | Shutdown host OS/controller |
| `machineReboot` | none | Reboot host OS/controller |
| `restartAdapters` | none | Restart prop/media adapters |

Control command sequence hooks (resolved from `global.system-sequences`):
- `shutdown` → `software-shutdown-sequence` (fallback: imperative software shutdown)
- `reboot` → `software-restart-sequence` (fallback: imperative software reboot/restart)
- `halt` → `software-halt-sequence` (fallback: graceful halt)
- `sleep` → `props-sleep-sequence`
- `wake` → `props-wake-sequence`
- `machineShutdown` → `machine-shutdown-sequence` (OS-level shutdown)
- `machineReboot` → `machine-reboot-sequence` (OS-level reboot)
- `restartAdapters`/`restart-adapters` → `restart-adapters`

### Game State Publishing

Published to: `{baseTopic}/state`

```json
{
  "state": "gameplay",
  "mode": "60min",
  "timeRemaining": 3245,
  "hintsDelivered": 2,
  "timestamp": 1234567890
}
```

### Heartbeat

Published to: `{baseTopic}/state` at regular intervals (default 1Hz):

```json
{
  "alive": true,
  "state": "gameplay",
  "uptime": 12345,
  "timestamp": 1234567890
}
```

---

## Mode System

### Mode Configuration

```clojure
:modes {
  :60min {
    :intro-duration 45
    :game-duration 3600
    :hint-interval 300
    :sequences {
      ;; Override specific sequences for this mode
      :intro {:duration 45 :timeline [...]}
    }
  }
  :30min {
    :intro-duration 30
    :game-duration 1800
    :hint-interval 180
  }
  :demo {
    :intro-duration 15
    :game-duration 300
    :hint-interval 60
    :sequences {
      :intro {:duration 15 :timeline [...]}
      :gameplay {:duration 300 :timeline [...]}
    }
  }
}
```

### Mode Selection

```bash
# CLI flag
node src/game.js --config game.edn --mode demo

# Environment variable
GAME_MODE=demo node src/game.js --config game.edn

# Default from config
:default-mode :60min
```

### Mode Overrides

Modes can override:
- Durations (intro, gameplay)
- Sequences (per-mode variations)
- Timing intervals
- Any top-level config value

Inheritance: Modes inherit from global config, overriding only specified keys.

---

## Error Handling and Logging

### Log Levels

- `error` — Critical failures requiring immediate attention
- `warn` — Unexpected conditions that don't prevent operation
- `info` — Normal operational messages (state changes, commands)
- `debug` — Detailed diagnostic information

### Log Files

Location: `/opt/paradox/logs/pxo/` (configurable in INI)

Files:
- `pxo-YYYY-MM-DD.log` — Daily log file
- `pxo-latest.log` — Symlink to current log
- Automatic rotation and cleanup

### Gameplay Analytics JSONL Log

When enabled, PxO writes a second gameplay-focused JSONL stream for run analysis.

Behavior:

- Enabled by INI `game_logging` + `game_log_path`, or forced by CLI `--game_log_path`.
- Startup hard-fails if the resolved gameplay log path is invalid/unwritable.
- File is created only after intro completes and gameplay begins (false starts are discarded).
- File name format: `<ednBase>-YYYYMMDD-HH-MM-SS.jsonl`.
- Time fields include:
  - `wall_time` in `HH:MM:SS.hh`
  - `game_time_remaining` in `MM:SS.hh` (countdown from configured gameplay duration)

Included event classes (non-exhaustive):

- Inbound commands and outcomes (accepted/rejected/malformed)
- Phase transitions and game-end trigger events
- Gameplay schedule firings
- Top-level gameplay/control sequence lifecycle events
- Sensor input changes with optional deadband filtering
- PxT chat events when both chat topics are configured

Excluded event classes:

- Periodic `/state` heartbeat snapshots
- `/warnings` stream records
- Nested sequence internal command chatter

### Error Recovery

**MQTT Connection Lost**:
- Pause game timers
- Attempt reconnection
- Resume when connection restored
- Log disconnect/reconnect events

**Command Execution Failure**:
- Log error with context
- Continue with next step (fail gracefully)
- Publish warning to `{baseTopic}/warnings`

**Config Validation Failure**:
- Refuse to start
- Log detailed validation errors
- Exit with non-zero status

---

## Performance Considerations

### Timer Precision

JavaScript timers (setTimeout/setInterval) have ~10ms variance:
- Sequences account for accumulated drift
- Critical timing uses `:wait` for synchronization
- Media playback duration should be factored into timeline

### MQTT Publishing

- Async operation — no blocking
- QoS 1 for critical commands
- QoS 0 for frequent updates (heartbeat)
- Don't assume immediate delivery

### Sequence Execution

- Blocking by design — long sequences delay state transitions
- Avoid deeply nested sequences
- Use cues for parallel, fire-and-forget operations

---

## Extension Points

### Adding Zone Adapters

1. Create `src/adapters/newzone.js`
2. Implement `executeCommand()` and `handleStateUpdate()`
3. Register in `src/game.js`
4. Add to config `:zones` section
5. Add tests

### Adding Command Types

1. Update zone adapter's `executeCommand()`
2. Add to MQTT API documentation
3. Add validation
4. Add tests

### Adding State Machine States

1. Add to `STATES` constant
2. Define entry/exit handlers (`on{State}Enter()`, `on{State}Exit()`)
3. Update `allowedTransitions` map
4. Add transition logic
5. Update documentation

---

## Testing

### Test Suites

- **Unit Tests**: Individual components (adapters, config loaders)
- **Contract Tests**: Command transformation and MQTT publishing
- **E2E Tests**: Full sequence execution with mock MQTT broker

### Running Tests

```bash
npm test                # All tests
npm run test:contract   # Command contracts
npm run test:scheduler  # Sequence timing
npm run test:e2e        # End-to-end smoke tests
```

### Test Coverage Requirements

- New zone adapters: command transformation tests
- Config changes: validation tests
- State machine changes: transition tests

---

## Appendix: Command Reference

See [MQTT_API.md](MQTT_API.md) for complete command reference.

## Appendix: Configuration Schema

See [CONFIG_EDN.md](CONFIG_EDN.md) for complete EDN schema.

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
