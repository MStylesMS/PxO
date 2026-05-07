# Paradox Orchestrator (PxO) — MQTT API Reference

**Version**: 1.0.0  
**Last Updated**: October 2025

## Overview

Paradox Orchestrator (PxO) uses MQTT for all zone communication following standardized topic patterns and JSON message formats. This document describes the MQTT API for controlling the orchestrator and integrating zone devices.

### Communication Model

- **Commands**: Game orchestrator → Zones (`{baseTopic}/commands`)
- **Events**: Zones → Game orchestrator/consumers (`{baseTopic}/events`)
- **State**: Zones → Game orchestrator (`{baseTopic}/state`)
- **Warnings**: Zones → Monitoring systems (`{baseTopic}/warnings`)

PxO can also subscribe to external producer topics for gameplay triggers (for example PFx input events or Pio GPIO topics). These are configured in EDN trigger/source definitions, not hardcoded in the runtime topic list.

---

## Topic Structure

### Zone Topics

Each zone follows this pattern:

```
{baseTopic}/commands    # Incoming commands to zone
{baseTopic}/events      # Zone discrete events (published by zone)
{baseTopic}/state       # Zone state + health/status (published by zone)
{baseTopic}/warnings    # Zone error messages (published by zone)
{baseTopic}/scenes      # Retained zone metadata for operator scene registries (optional)
```

**Example**:
```
paradox/game/lights/commands   → PxO publishes commands here
paradox/game/lights/events     → Lights device publishes discrete events here
paradox/game/lights/state      → Lights device publishes state here
paradox/game/lights/state      → Lights device also publishes health here
paradox/game/lights/warnings   → Lights device publishes errors here
paradox/game/lights/scenes     → PxO publishes retained light scene registry here
```

### Game Control Topics

Game orchestrator uses these topics:

```
{baseTopic}/commands    # Commands to game orchestrator
{baseTopic}/state       # Game state + health/heartbeat (published by PxO)
{baseTopic}/events      # Game events (published by PxO)

{baseTopic}/discovery   # Retained: zones inventory (published on startup)
{baseTopic}/schema      # Retained: supported commands schema (published on startup)
```

**Example**:
```
paradox/game/commands   → External systems send commands here
paradox/game/state      → PxO publishes game state here
paradox/game/state      → PxO also publishes heartbeat here
paradox/game/events     → PxO publishes events here
paradox/game/discovery  → PxO publishes retained zone inventory here
paradox/game/schema     → PxO publishes retained command schema here
```

### External Trigger Source Topics

PxO trigger rules may subscribe to topics outside game control and zone adapter topics.

Recommended pattern:
- Prefer canonical producer event topics for repeatable gameplay integrations.
- Allow direct producer/raw topics when canonicalization adds little value.

Examples:
```
paradox/houdini/inputs/front-door/events   → PFx-produced normalized sensor events
paradox/houdini/pio/gpio/door              → Pio-produced direct GPIO state
```

PxO does not require PFx as a proxy for Pio or other producer apps. All integrations are broker-based.

### Gameplay Analytics Capture (JSONL)

When gameplay analytics logging is enabled, PxO captures selected MQTT-driven gameplay signals into a separate JSONL file stream.

Captured:

- Inbound commands to `{baseTopic}/commands` and their outcomes
- Phase transitions and top-level gameplay/control sequence lifecycle events
- Trigger/sensor topic changes used by gameplay triggers
- Optional PxT chat topics from INI (`chat_to_player`, `chat_from_player`)

Excluded:

- Periodic `{baseTopic}/state` snapshots
- `{baseTopic}/warnings` traffic
- Nested sequence internal command chatter

---

## Message Formats

### Command Message

All commands use JSON with required `command` field:

```json
{
  "command": "commandName",
  "param1": "value1",
  "param2": "value2"
}
```

### State Message

State updates include current zone state:

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "zone": "lights",
  "state": "active",
  "currentScene": "green",
  "brightness": 80
}
```

### Status/Heartbeat Message

Health and heartbeat information:

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "alive": true,
  "state": "gameplay",
  "uptime": 12345,
  "mode": "60min"
}
```

### Discovery Message

Published **retained** to `{baseTopic}/discovery` at startup. Describes the full zone inventory for external tools (Node-RED, dashboards).

```json
{
  "application": "pxo",
  "timestamp": "2025-10-24T10:30:00.000Z",
  "gameTopic": "paradox/game",
  "commandsTopic": "paradox/game/commands",
  "stateTopic": "paradox/game/state",
  "zones": [
    {
      "name": "lights",
      "type": "lights",
      "baseTopic": "paradox/game/lights"
    }
  ]
}
```

### Schema Message

Published **retained** to `{baseTopic}/schema` at startup. Describes all supported game-level commands.

```json
{
  "application": "pxo",
  "commandsTopic": "paradox/game/commands",
  "commands": [
    { "command": "start",       "description": "Start or resume the game" },
    { "command": "pause",       "description": "Pause the countdown timer" },
    { "command": "resume",      "description": "Resume the countdown timer" },
    { "command": "reset",       "description": "Reset game to ready state" },
    { "command": "solve",       "description": "Trigger win/solved outcome" },
    { "command": "fail",        "description": "Trigger fail outcome" },
    { "command": "abort",       "description": "Abort current game" },
    { "command": "setTime",     "description": "Set remaining time (seconds: number)" },
    { "command": "executeHint", "description": "Fire a hint by id (id: string)" },
    { "command": "listhints",   "description": "Publish hints registry to hintsRegistry topic" },
    { "command": "getconfig",   "description": "Publish full UI config to config topic" }
  ]
}
```

### Light Scenes Registry Message

Published **retained** to `{baseTopic}/lights/scenes` (or more generally `{zoneBaseTopic}/scenes`) for light zones that define `:global :light-scenes` in EDN. This topic is intended for operator UIs and other consumers that need a registry of scene ids and display metadata.

```json
{
  "zone": "lights",
  "scenes": [
    { "id": "red", "label": "Red", "swatch": "#FF0000" },
    { "id": "disco", "label": "Disco", "swatch": "rainbow", "type": "dynamic", "speed_ms": 120 },
    { "id": "uvGreen", "label": "UV Green", "swatch": "#39ff14", "type": "custom", "r": 0, "g": 180, "b": 0, "uv": 255 }
  ],
  "ts": 1760000000000
}
```

Semantics:

- PxO publishes scene objects as opaque metadata from EDN.
- PxO does not require a fixed schema for optional scene keys.
- Consumers should rely on `id`, `label`, and `swatch` for generic UI behavior.
- `type` is advisory and may be `static`, `dynamic`, `custom`, or any consumer-defined value.
- Additional keys are consumer-defined and may describe colors, timing, animation modes, or device-specific parameters.

---

## Game Control Commands

Publish to: `{baseTopic}/commands`

PxO accepts both modern short commands and legacy `*Game` aliases for compatibility.

Preferred commands:
- `start`
- `pause`
- `resume`
- `solve`
- `fail`
- `abort`
- `reset`
- `triggerPhase`
- `executeHint`
- `emergencyStop`
- `machineShutdown`
- `machineReboot`
- `restartAdapters`
- `halt`
- `shutdown`
- `reboot`
- `sleep`
- `wake`

Legacy ingress aliases such as `startGame`, `resetGame`, `solveGame`, `failGame`, and `abortGame` may still normalize internally for compatibility, but new integrations should use the canonical names below.

### Start Game

```json
{
  "command": "start",
  "mode": "60min"
}
```

**Parameters**:
- `mode` (optional): Game mode (`60min`, `30min`, `demo`). Uses default if omitted.

**Response**: Game transitions to `intro` state, publishes state update.

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"start","mode":"demo"}'
```

### Pause Game

```json
{
  "command": "pause"
}
```

**Parameters**: None

**Response**: Game transitions to `paused` state, timers pause.

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"pause"}'
```

### Resume Game

```json
{
  "command": "resume"
}
```

**Parameters**: None

**Response**: Game returns to `gameplay` state, timers resume.

### Reset Game

```json
{
  "command": "reset"
}
```

**Parameters**: None

**Response**: Game transitions to `ready` state, all timers reset.

### Abort Game (Immediate)

```json
{
  "command": "abort"
}
```

**Parameters**: None

**Response**: Runs the current mode `abort` phase immediately (stop media/timers/safe state), then operator can proceed through reset flow.

### Emergency Stop (Any Active State)

```json
{
  "command": "emergencyStop"
}
```

**Parameters**: None

**Response**: Immediately preempts active phase flow, clears timers/schedules, performs hard cleanup, runs `emergency-stop-sequence`, and forces reset cleanup back to a safe ready state.

### Solve Game

```json
{
  "command": "solve"
}
```

**Parameters**: None

**Response**: Game transitions to `solved` state (operator override).

### Trigger Named Phase

```json
{
  "command": "triggerPhase",
  "phase": "operator-hold"
}
```

**Parameters**:
- `phase` (required): phase key defined in the active mode's phase map (including allowed global additional phases).

**Response**: Transitions directly to the requested phase when valid.

### Execute Hint

```json
{
  "command": "executeHint",
  "id": "hint-01"
}
```

**Parameters**:
- `id` (required): Hint ID from configuration

**Response**: Executes hint (text/speech/video/action), publishes event.

### Shutdown

```json
{
  "command": "shutdown"
}
```

**Parameters**: None

**Response**: Graceful shutdown, publishes final status.

### Reboot (Software Restart)

```json
{
  "command": "reboot"
}
```

**Parameters**: None

**Response**: Executes software restart sequence (or fallback reboot behavior if sequence fails).

### Halt (Software Halt)

```json
{
  "command": "halt"
}
```

**Parameters**: None

**Response**: Executes graceful software halt sequence.

### Sleep Props

```json
{
  "command": "sleep"
}
```

**Parameters**: None

**Response**: Executes `props-sleep-sequence`.

### Wake Props

```json
{
  "command": "wake"
}
```

**Parameters**: None

**Response**: Executes `props-wake-sequence`.

### Controller OS Shutdown

```json
{
  "command": "machineShutdown"
}
```

**Parameters**: None

**Response**: Executes `machine-shutdown-sequence`.

### Controller OS Reboot

```json
{
  "command": "machineReboot"
}
```

**Parameters**: None

**Response**: Executes `machine-reboot-sequence`.

### Restart Adapters

```json
{
  "command": "restartAdapters"
}
```

**Parameters**: None

**Response**: Executes `restart-adapters` sequence.

---

## Game State Messages

Published to: `{baseTopic}/state`

### State Update

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "state": "gameplay",
  "phaseType": "gameplay",
  "isClosingPhase": false,
  "mode": "60min",
  "timeRemaining": 3245,
  "hintsDelivered": 2,
  "sequencesRunning": ["gameplay-sequence"]
}
```

**Fields**:
- `timestamp`: ISO 8601 timestamp
- `state`: Current state (`ready`, `intro`, `gameplay`, `paused`, `solved`, `failed`, `sleeping`)
- `phaseType`: normalized phase family (`intro`, `gameplay`, `solved`, `failed`, etc.)
- `isClosingPhase`: `true` for solved/failed-family closing phases (including additional phases with matching `phase-type`)
- `mode`: Active game mode
- `timeRemaining`: Seconds remaining (if in timed phase)
- `hintsDelivered`: Number of hints delivered
- `sequencesRunning`: Array of currently executing sequence names

---

## Zone Commands

### Generic Command Format

Published to: `{zoneBaseTopic}/commands`

```json
{
  "command": "commandName",
  "param1": "value1"
}
```

Zone adapters transform these into zone-specific formats.

---

## Zone-Specific Commands

### Lights Zone (`mqtt-lights`)

**Set Scene**:
```json
{
  "command": "scene",
  "name": "green"
}
```

**Parameters**:
- `name`: Scene name (`red`, `green`, `blue`, `white`, `dim`, `off`, etc.)

Scene names are commonly listed in the retained `{baseTopic}/scenes` registry for operator UIs, but the command contract remains the same regardless of whether a registry is published.

**Set Color (RGB)**:
```json
{
  "command": "setColor",
  "red": 255,
  "green": 0,
  "blue": 0
}
```

**Parameters**:
- `red`, `green`, `blue`: RGB values (0-255)

**Set Brightness**:
```json
{
  "command": "setBrightness",
  "brightness": 80
}
```

**Parameters**:
- `brightness`: Percentage (0-100)

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/lights/commands' \
  -m '{"command":"scene","name":"green"}'
```

### PFX Media Zone (`pfx-media`)

**Play Video**:
```json
{
  "command": "playVideo",
  "file": "media/video/intro.mp4",
  "loop": false
}
```

**Parameters**:
- `file`: Path to video file (relative to media root)
- `loop` (optional): Loop playback (default: false)

**Play Audio FX**:
```json
{
  "command": "playAudioFX",
  "file": "media/audio/music.mp3",
  "volume": 80,
  "loop": false
}
```

**Parameters**:
- `file`: Path to audio file
- `volume` (optional): Volume percentage (0-100)
- `loop` (optional): Loop playback (default: false)

**Stop Audio**:
```json
{
  "command": "stopAudio"
}
```

**Show Browser**:
```json
{
  "command": "showBrowser"
}
```

Shows overlaid web browser (for clock UI, etc.).

**Hide Browser**:
```json
{
  "command": "hideBrowser"
}
```

**Enable Browser**:
```json
{
  "command": "enableBrowser",
  "url": "http://localhost/clock/index.html"
}
```

Starts browser process in the background (does not force visibility).

**Disable Browser**:
```json
{
  "command": "disableBrowser"
}
```

Stops browser process.

**Important**: `verifyBrowser` is not a direct MQTT zone command. It is a PxO sequence-runner command that performs state polling and corrective actions (`enableBrowser`, URL update, show/hide) until the browser matches requested state or times out.

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/mirror/commands' \
  -m '{"command":"enableBrowser","url":"http://localhost/clock/index.html"}'
```

### Clock Zone (`pxc-clock`)

**Show Clock**:
```json
{
  "command": "show"
}
```

Shows clock instantly (equivalent to `fadeIn` with duration `0`).

**Hide Clock**:
```json
{
  "command": "hide"
}
```

Hides clock instantly (equivalent to `fadeOut` with duration `0`).

**Fade In Clock**:
```json
{
  "command": "fadeIn",
  "duration": 2
}
```

**Parameters**:
- `duration` (optional): Fade-in duration in seconds. If omitted, the clock app default is used.

**Fade Out Clock**:
```json
{
  "command": "fadeOut",
  "duration": 2
}
```

**Parameters**:
- `duration` (optional): Fade-out duration in seconds. If omitted, the clock app default is used.

**Set Time**:
```json
{
  "command": "setTime",
  "seconds": 3600
}
```

**Parameters**:
- `seconds`: Time in seconds

**Start Countdown**:
```json
{
  "command": "start"
}
```

**Pause Countdown**:
```json
{
  "command": "pause"
}
```

**Resume Countdown**:
```json
{
  "command": "resume"
}
```

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/clock/commands' \
  -m '{"command":"setTime","seconds":3600}'
```

### System Zone (`system`)

**Shutdown**:
```json
{
  "command": "shutdown"
}
```

Graceful system shutdown.

**Restart**:
```json
{
  "command": "restart"
}
```

System restart.

---

## Multi-Zone Commands

Commands can target multiple zones simultaneously:

**Example in EDN**:
```clojure
{:zones ["mirror" "audio"] :command "stopAudio"}
```

PxO publishes the command to each zone's `/commands` topic.

---

## Heartbeat and Health Monitoring

### Heartbeat Message

Published to: `{baseTopic}/state` at regular intervals (default: 1Hz)

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "alive": true,
  "state": "gameplay",
  "uptime": 12345,
  "mode": "60min",
  "zonesConnected": ["lights", "mirror", "audio", "clock"]
}
```

**Fields**:
- `alive`: Boolean, always true (message presence indicates alive)
- `state`: Current game state
- `uptime`: Seconds since start
- `mode`: Active game mode
- `zonesConnected`: Array of zones with recent state updates

### Zone Health Monitoring

Zones should publish status at regular intervals:

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "zone": "lights",
  "healthy": true,
  "lastCommand": "scene",
  "uptime": 54321
}
```

---

## Error Handling

### Warning Messages

Published to: `{baseTopic}/warnings`

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "level": "warn",
  "message": "Zone 'audio' not responding",
  "details": {
    "zone": "audio",
    "lastSeen": "2025-10-24T10:28:00.000Z"
  }
}
```

**Levels**:
- `info`: Informational
- `warn`: Warning (recoverable)
- `error`: Error (may affect operation)
- `fatal`: Fatal error (requires restart)

---

## QoS Recommendations

| Message Type | QoS | Rationale |
|--------------|-----|-----------|
| Game control commands | 1 | Ensure delivery |
| Zone commands | 1 | Ensure delivery |
| State updates | 0 | Frequent, idempotent |
| Heartbeat | 0 | Frequent, presence-based |
| Warnings | 1 | Important for monitoring |

---

## Testing and Debugging

### Subscribe to All Topics

```bash
mosquitto_sub -h localhost -t 'paradox/#' -v
```

### Publish Test Command

```bash
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"start","mode":"demo"}'
```

### Monitor Game State

```bash
mosquitto_sub -h localhost -t 'paradox/game/state' -v
```

### Monitor Zone Commands

```bash
mosquitto_sub -h localhost -t 'paradox/game/+/commands' -v
```

---

## Integration Examples

### External Control System

```python
import paho.mqtt.client as mqtt

client = mqtt.Client()
client.connect("localhost", 1883, 60)

# Start game
client.publish("paradox/game/commands", 
               '{"command":"start","mode":"60min"}')

# Pause game
client.publish("paradox/game/commands", 
               '{"command":"pause"}')

# Execute hint
client.publish("paradox/game/commands", 
               '{"command":"executeHint","id":"hint-01"}')
```

### Web Dashboard

```javascript
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  // Subscribe to game state
  client.subscribe('paradox/game/state');
  
  // Subscribe to all zone states
  client.subscribe('paradox/game/+/state');
});

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log(`${topic}: ${JSON.stringify(data)}`);
  
  // Update UI based on state
  if (topic === 'paradox/game/state') {
    updateGameState(data);
  }
});
```

---

## Appendix: Complete Command Reference

### Game Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `start` | `mode` (optional) | Start game |
| `pause` | none | Pause game |
| `resume` | none | Resume game |
| `reset` | none | Reset to ready |
| `solve` | none | Mark solved |
| `fail` | none | Mark failed |
| `abort` | none | Immediate abort phase |
| `triggerPhase` | `phase` | Transition to named phase |
| `executeHint` | `id` | Execute hint by id |
| `emergencyStop` | none | Preemptive full cleanup + reset |
| `shutdown` | none | Shutdown |
| `reboot` | none | Restart PxO software |
| `halt` | none | Halt PxO software |
| `sleep` | none | Sleep props/adapters |
| `wake` | none | Wake props/adapters |
| `machineShutdown` | none | Shutdown controller OS |
| `machineReboot` | none | Reboot controller OS |
| `restartAdapters` | none | Restart adapters |

### PFX Lights Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `scene` | `name` | Set scene |
| `setColor` | `red`, `green`, `blue` | Set RGB color |
| `setBrightness` | `brightness` | Set brightness (0-100) |

### PFX Media Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `playVideo` | `file`, `loop` (opt) | Play video |
| `playAudioFX` | `file`, `volume` (opt), `loop` (opt) | Play audio |
| `stopAudio` | none | Stop audio |
| `showBrowser` | none | Show browser overlay |
| `hideBrowser` | none | Hide browser overlay |

### Clock Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `show` | none | Show clock |
| `hide` | none | Hide clock |
| `setTime` | `seconds` | Set countdown time |
| `start` | none | Start countdown |
| `pause` | none | Pause countdown |
| `resume` | none | Resume countdown |

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
