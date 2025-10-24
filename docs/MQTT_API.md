# Paradox Orchestrator (PxO) — MQTT API Reference

**Version**: 1.0.0  
**Last Updated**: October 2025

## Overview

Paradox Orchestrator (PxO) uses MQTT for all zone communication following standardized topic patterns and JSON message formats. This document describes the MQTT API for controlling the orchestrator and integrating zone devices.

### Communication Model

- **Commands**: Game orchestrator → Zones (`{baseTopic}/commands`)
- **State**: Zones → Game orchestrator (`{baseTopic}/state`)
- **Status**: Zones → Monitoring systems (`{baseTopic}/status`)
- **Warnings**: Zones → Monitoring systems (`{baseTopic}/warnings`)

---

## Topic Structure

### Zone Topics

Each zone follows this pattern:

```
{baseTopic}/commands    # Incoming commands to zone
{baseTopic}/state       # Zone state updates (published by zone)
{baseTopic}/status      # Zone health/status (published by zone)
{baseTopic}/warnings    # Zone error messages (published by zone)
```

**Example**:
```
paradox/game/lights/commands   → PxO publishes commands here
paradox/game/lights/state      → Lights device publishes state here
paradox/game/lights/status     → Lights device publishes health here
paradox/game/lights/warnings   → Lights device publishes errors here
```

### Game Control Topics

Game orchestrator uses these topics:

```
{baseTopic}/commands    # Commands to game orchestrator
{baseTopic}/state       # Game state (published by PxO)
{baseTopic}/status      # Game health/heartbeat (published by PxO)
{baseTopic}/events      # Game events (published by PxO)
```

**Example**:
```
paradox/game/commands   → External systems send commands here
paradox/game/state      → PxO publishes game state here
paradox/game/status     → PxO publishes heartbeat here
paradox/game/events     → PxO publishes events here
```

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

---

## Game Control Commands

Publish to: `{baseTopic}/commands`

### Start Game

```json
{
  "command": "startGame",
  "mode": "60min"
}
```

**Parameters**:
- `mode` (optional): Game mode (`60min`, `30min`, `demo`). Uses default if omitted.

**Response**: Game transitions to `intro` state, publishes state update.

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"startGame","mode":"demo"}'
```

### Pause Game

```json
{
  "command": "pauseGame"
}
```

**Parameters**: None

**Response**: Game transitions to `paused` state, timers pause.

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/commands' \
  -m '{"command":"pauseGame"}'
```

### Resume Game

```json
{
  "command": "resumeGame"
}
```

**Parameters**: None

**Response**: Game returns to `gameplay` state, timers resume.

### Reset Game

```json
{
  "command": "resetGame"
}
```

**Parameters**: None

**Response**: Game transitions to `ready` state, all timers reset.

### Solve Game

```json
{
  "command": "solveGame"
}
```

**Parameters**: None

**Response**: Game transitions to `solved` state (operator override).

### Deliver Hint

```json
{
  "command": "deliverHint",
  "hintId": 1
}
```

**Parameters**:
- `hintId` (required): Hint ID from configuration

**Response**: Executes hint (text/speech/video/action), publishes event.

### Shutdown

```json
{
  "command": "shutdown"
}
```

**Parameters**: None

**Response**: Graceful shutdown, publishes final status.

---

## Game State Messages

Published to: `{baseTopic}/state`

### State Update

```json
{
  "timestamp": "2025-10-24T10:30:00.000Z",
  "state": "gameplay",
  "mode": "60min",
  "timeRemaining": 3245,
  "hintsDelivered": 2,
  "sequencesRunning": ["gameplay-sequence"]
}
```

**Fields**:
- `timestamp`: ISO 8601 timestamp
- `state`: Current state (`ready`, `intro`, `gameplay`, `paused`, `solved`, `failed`, `sleeping`)
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

### PFX Lights Zone (`pfx-lights`)

**Set Scene**:
```json
{
  "command": "scene",
  "name": "green"
}
```

**Parameters**:
- `name`: Scene name (`red`, `green`, `blue`, `white`, `dim`, `off`, etc.)

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

**Example**:
```bash
mosquitto_pub -h localhost -t 'paradox/game/mirror/commands' \
  -m '{"command":"playVideo","file":"media/video/intro.mp4"}'
```

### Houdini Clock Zone (`houdini-clock`)

**Show Clock**:
```json
{
  "command": "show"
}
```

**Hide Clock**:
```json
{
  "command": "hide"
}
```

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

Published to: `{baseTopic}/status` at regular intervals (default: 1Hz)

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
  -m '{"command":"startGame","mode":"demo"}'
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
               '{"command":"startGame","mode":"60min"}')

# Pause game
client.publish("paradox/game/commands", 
               '{"command":"pauseGame"}')

# Deliver hint
client.publish("paradox/game/commands", 
               '{"command":"deliverHint","hintId":1}')
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
| `startGame` | `mode` (optional) | Start game |
| `pauseGame` | none | Pause game |
| `resumeGame` | none | Resume game |
| `resetGame` | none | Reset to ready |
| `solveGame` | none | Mark solved |
| `deliverHint` | `hintId` | Deliver hint |
| `shutdown` | none | Shutdown |

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
