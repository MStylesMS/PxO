# Paradox Orchestrator (PxO) — AI Detailed Overview

This document provides comprehensive guidance for AI coding agents working on PxO. For a quick-start summary, see [AI-INSTRUCTIONS.md](AI-INSTRUCTIONS.md).

## System Overview

PxO is the game orchestration engine for Paradox escape rooms. It manages game state through a state machine, executes timed sequences of commands, and coordinates multiple hardware zones via MQTT.

**Entry point**: `src/game.js`
**Service**: Runs as `pxo.service` or room-specific service (e.g., `houdini-game.service`)

## State Machine

**File**: `src/stateMachine.js`

**States**: `ready` → `intro` → `gameplay` → `paused`/`solved`/`failed` → `sleeping`/`resetting`

- State transitions are explicit and logged
- Each state has entry/exit handlers and allowed transitions
- Pause/resume preserves timer state correctly
- Always preserve the transitions graph — no unreachable states or cycles that lock the game

### Adding a New State

1. Add to `STATES` constant
2. Define `onNewstateEnter()` and `onNewstateExit()` handlers
3. Update `allowedTransitions` map
4. Add transition logic in appropriate event handlers

## Three-Tier Configuration Model

### Tier 1: Commands — Atomic zone operations
```clojure
{:zone "mirror" :command "playVideo" :file "intro.mp4"}
{:zone "lights" :command "scene" :name "green"}
{:zones ["mirror" "audio"] :command "stopAudio"}
```

### Tier 2: Cues — Named shortcuts (fire-and-forget)
```clojure
:cues {
  :lights-red {:zone "lights" :command "scene" :name "red"}
  :stop-all [{:zones ["mirror" "audio"] :command "stopAudio"}]
}
```

### Tier 3: Sequences — Timeline-based execution (blocking)
```clojure
:sequences {
  :hint-sequence {
    :duration 32
    :timeline [
      {:at 30 :zone "mirror" :command "hideBrowser"}
      {:at 25 :zone "mirror" :command "playVideo" :file "hint.mp4"}
      {:at 2 :zone "mirror" :command "showBrowser"}
    ]
  }
}
```

### Sequence Runner Semantics (`src/sequenceRunner.js`)

- `:duration` in seconds; `:at` counts down from duration
- `:wait` provides blocking delays at step level
- Sequences are **blocking** — execution waits for completion
- Cues within sequences are fire-and-forget
- Pause/resume preserves timer state

## Zone-Based Architecture

### Core Zones

| Zone | Adapter | Purpose |
|------|---------|---------|
| `lights` | PFX integration | Lighting control and effects |
| `mirror` | PFX media | Primary display (video/images) |
| `picture` | PFX media | Secondary display |
| `audio` | PFX media | Audio playback |
| `clock` | Houdini clock | Countdown display |
| `system` | Internal | Shutdown, restart commands |

### Zone Communication (Sacred — Do Not Change)
```
{baseTopic}/commands    # Incoming commands
{baseTopic}/state       # State updates
{baseTopic}/status      # Health/heartbeat
{baseTopic}/warnings    # Errors
```

### Direct Zone Communication
UI components can send commands directly to zones, bypassing PxO for performance. PxO coordinates sequences but doesn't gatekeep all zone interactions.

## Development Workflows

### Adding a New Zone Adapter

1. Create `src/adapters/newzone.js` following the pattern: constructor(mqtt, baseTopic, logger), executeCommand(cmd), handleStateUpdate(msg)
2. Register in `src/game.js` constructor and `setupSubscriptions()`
3. Add command routing in `executeCommand()`
4. Add tests in `test/command-contract.test.js`

### Config Loader Changes

- **EDN Config** (`src/edn-config-loader.js`) — Primary game config. Supports keywords, vectors, maps, sets. Keyword references resolve automatically. Variable substitution with `{{variable}}`.
- **INI Config** (`src/ini-config-loader.js`) — System config only (MQTT broker, logging, zone topics). NOT for game logic.
- **Modular Config** (`src/modular-config-adapter.js`) — Multi-file composition, mode-specific overrides.

When adding new EDN keys:
1. Update validator schema in `src/validators/`
2. Document in `docs/CONFIG_EDN.md`
3. Use defaults for backward compatibility: `config.newKey || defaultValue`

### MQTT Client Patterns (`src/mqttClient.js`)

- Always use the MQTT wrapper: `this.mqtt.publish(topic, JSON.stringify(payload))`
- Never bypass to raw client
- QoS 1 for critical commands, QoS 0 for frequent updates
- Handle connect/offline/reconnect events

### Logging (`src/logger.js`)

Levels: `error` > `warn` > `info` > `debug`
```javascript
this.log.error('[component] Critical error:', error);
this.log.info('[component] Normal operation:', info);
this.log.debug('[component] Debug details:', data);
```
- Logs auto-rotate (handled by `src/log-cleanup.js`)
- Avoid excessive logging in tight loops
- Don't log large objects unless necessary

### Running Tests
```bash
npm test                 # All tests
npm run test:contract    # Command transformation tests
npm run test:scheduler   # Timer and sequence tests
npm run test:e2e         # End-to-end smoke tests
LOG_LEVEL=debug npm test # Verbose
```

### Pre-Push Checklist
- [ ] All tests pass: `npm test`
- [ ] Config validation passes: `npm run validate`
- [ ] No lint errors
- [ ] Manual smoke test with real MQTT broker

## Regression Prevention

### Architecture Change Protocol

**Require explicit approval before**:
- Changing MQTT topic structure
- Modifying state machine transition graph
- Changing sequence execution semantics
- Breaking EDN config format compatibility
- Modifying zone adapter contracts

**Safe without approval**:
- Adding new zone adapters (following existing pattern)
- Adding new optional config keys (with defaults)
- Improving error messages and logging
- Adding tests
- Fixing bugs that don't change behavior

### Code Quality

- Search before creating new functions — check `src/util.js`, `src/engineUtils.js`
- All adapters follow the same structure — don't create one-off patterns
- Keep the engine generic — game logic belongs in EDN, not source code
- Edit only what's necessary — no reformatting unrelated code
- Preserve existing import organization and error handling

## File Map

**Core Engine**:
- `src/game.js` — Main entry point and state machine coordinator
- `src/stateMachine.js` — State definitions and transitions
- `src/sequenceRunner.js` — Timeline-based sequence execution
- `src/config.js` — Config loader and validation

**Zone Adapters** (`src/adapters/*.js`): One file per zone type (lights, mirror, audio, clock, system)

**Config Loaders**: `src/edn-config-loader.js`, `src/ini-config-loader.js`, `src/modular-config-adapter.js`, `src/template-expander.js`

**Utilities**: `src/util.js`, `src/engineUtils.js`, `src/logger.js`, `src/log-cleanup.js`

**MQTT**: `src/mqttClient.js`

**Validators**: `src/validators/*.js`

**Tests**: `test/command-contract.test.js`, `test/scheduler.test.js`, `test/e2e-*.js`

**Hints**: `src/hints.js` — Multi-type hint execution (text, speech, audio, video, action)

## Documentation-First Development

This repo follows the Paradox documentation-first standard:
1. Review docs before coding (SPEC.md, CONFIG_EDN.md, MQTT_API.md)
2. Propose doc updates before conflicting changes
3. Update docs alongside code
4. API/protocol changes require explicit approval
5. Use commit prefixes: `Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`
