# AI Agent Instructions - Paradox Orchestrator (PxO)

## System Overview

Paradox Orchestrator (PxO) is a **modular, MQTT-based game orchestration engine** for escape rooms and interactive experiences. It manages game state, executes timed sequences, coordinates multiple zones (lights, displays, audio), and provides a flexible configuration system using EDN and INI formats.

**Repository**: https://github.com/MStylesMS/paradox-orchestrator

## Architecture Principles

### State Machine Core

**States**: `ready` → `intro` → `gameplay` → `paused`/`solved`/`failed` → `sleeping`/`resetting`

- State transitions are explicit and logged
- Each state has entry/exit handlers and allowed transitions
- Pause/resume preserves timer state correctly
- State machine is implemented in `src/stateMachine.js`

### Three-Tier Configuration Model

```
Commands (atomic operations targeting zones)
    ↓
Cues (named shortcuts, fire-and-forget)
    ↓  
Sequences (timeline-based execution with blocking semantics)
```

**Tier 1: Commands** — Atomic operations that target specific zones:
```clojure
{:zone "mirror" :command "playVideo" :file "intro.mp4"}
{:zone "lights" :command "scene" :name "green"}
{:zones ["mirror" "audio"] :command "stopAudio"}
```

**Tier 2: Cues** — Named shortcuts for commands that execute immediately (fire-and-forget):
```clojure
:cues {
  :lights-red {:zone "lights" :command "scene" :name "red"}
  :show-clock {:zone "mirror" :command "showBrowser"}
  :stop-all [{:zones ["mirror" "audio"] :command "stopAudio"}]
}
```

**Tier 3: Sequences** — Timeline-based execution with timing control and blocking behavior:
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

### Zone-Based Architecture

Each zone is an independent adapter that communicates via MQTT:

**Core Zones**:
- `lights` — Lighting control and effects (PFX integration)
- `mirror` — Primary display (video/images)
- `picture` — Secondary display
- `audio` — Audio playback
- `clock` — Countdown clock display
- `system` — System-level commands (shutdown, restart)

**Zone Communication Pattern**:
```
{baseTopic}/commands    # Incoming commands to the zone
{baseTopic}/state       # Zone state updates  
{baseTopic}/status      # Zone status/health
{baseTopic}/warnings    # Zone warnings/errors
```

**Critical Pattern**: Direct zone communication — UI components can send commands directly to zones, bypassing the game engine for optimal performance. The engine coordinates sequences but doesn't gatekeep all zone interactions.

### Sequence Runner Semantics

Implemented in `src/sequenceRunner.js`:

- Sequences have explicit `:duration` (in seconds)
- Timeline items use `:at` (seconds from start, counting down)
- `:wait` at step level provides blocking delays
- Sequences are blocking — execution waits for completion unless explicitly non-blocking
- Cues within sequences are fire-and-forget (inherited Tier 2 behavior)
- Sequences can be paused/resumed with timer state preservation

## Development Workflows

### Adding a New Zone Adapter

1. **Create adapter file** `src/adapters/newzone.js`:
   ```javascript
   class NewZoneAdapter {
     constructor(mqttClient, baseTopic, logger) {
       this.mqtt = mqttClient;
       this.topic = baseTopic;
       this.log = logger;
     }
     
     async executeCommand(command) {
       // Validate command structure
       if (!command.command) {
         throw new Error('Command missing required "command" field');
       }
       
       // Transform to MQTT message
       const message = {
         command: command.command,
         ...command  // Include all other fields
       };
       
       // Publish to {baseTopic}/commands
       this.mqtt.publish(`${this.topic}/commands`, JSON.stringify(message));
       this.log.debug(`[newzone] Published: ${command.command}`, message);
     }
     
     handleStateUpdate(message) {
       // Handle incoming state updates from zone
       this.log.debug('[newzone] State update:', message);
     }
   }
   
   module.exports = NewZoneAdapter;
   ```

2. **Register in `src/game.js`**:
   ```javascript
   const NewZoneAdapter = require('./adapters/newzone');
   
   // In Game class constructor:
   this.adapters.newzone = new NewZoneAdapter(
     this.mqtt,
     config.zones.newzone.baseTopic,
     logger
   );
   
   // In setupSubscriptions():
   this.mqtt.subscribe(`${config.zones.newzone.baseTopic}/state`);
   ```

3. **Add command routing** in `executeCommand()`:
   ```javascript
   async executeCommand(cmd) {
     const zone = cmd.zone || (cmd.zones && cmd.zones[0]);
     
     if (zone === 'newzone' && this.adapters.newzone) {
       await this.adapters.newzone.executeCommand(cmd);
     }
     // ... existing zone handling
   }
   ```

4. **Add tests** in `test/command-contract.test.js`:
   ```javascript
   it('should handle newzone commands', async () => {
     const command = { zone: 'newzone', command: 'doSomething', param: 'value' };
     await game.executeCommand(command);
     // Assert MQTT publish was called with correct topic and payload
   });
   ```

### Modifying State Machine

**File**: `src/stateMachine.js`

**Adding a new state**:

1. Add to `STATES` constant:
   ```javascript
   const STATES = {
     READY: 'ready',
     INTRO: 'intro',
     GAMEPLAY: 'gameplay',
     NEW_STATE: 'newstate',  // Add here
     // ... existing states
   };
   ```

2. Define entry/exit handlers in `Game` class:
   ```javascript
   async onNewstateEnter() {
     this.log.info('[state] Entering newstate');
     // Entry logic
   }
   
   async onNewstateExit() {
     this.log.info('[state] Exiting newstate');
     // Exit logic
   }
   ```

3. Update `allowedTransitions` map:
   ```javascript
   const allowedTransitions = {
     ready: ['intro', 'sleeping'],
     intro: ['gameplay', 'paused'],
     gameplay: ['paused', 'solved', 'failed', 'newstate'],  // Add transition
     newstate: ['gameplay', 'paused'],  // Define allowed exits
     // ... existing transitions
   };
   ```

4. Add state transition logic in appropriate handlers:
   ```javascript
   async handleSomeEvent() {
     if (this.state === STATES.GAMEPLAY && someCondition) {
       await this.setState(STATES.NEW_STATE);
     }
   }
   ```

**Critical**: Always preserve allowed transitions graph — don't allow unreachable states or circular dependencies that could lock the game.

### Config Loader Changes

**EDN Config** (`src/edn-config-loader.js`):
- EDN files are primary game configuration format
- Supports keywords, vectors, maps, sets
- Keyword references resolve automatically (`:intro-video` → actual file path)
- Variable substitution with `{{variable}}` syntax

**INI Config** (`src/ini-config-loader.js`):
- System configuration only (MQTT broker, logging, zone base topics)
- NOT for game logic — use EDN for that

**Modular Config** (`src/modular-config-adapter.js`):
- Supports multi-file composition
- Mode-specific overrides (`:modes {:60min {...}}`)

**Adding new EDN keys**:

1. Update validator schema in `src/validators/`:
   ```javascript
   const schema = {
     // ... existing schema
     newKey: {
       type: 'object',
       required: false,
       properties: {
         // Define structure
       }
     }
   };
   ```

2. Document in `docs/CONFIG_EDN.md`

3. **Preserve backward compatibility** — use defaults for new optional fields:
   ```javascript
   const newValue = config.newKey || defaultValue;
   ```

### MQTT Client Patterns

**File**: `src/mqttClient.js`

**Wrapper pattern** — Never use raw MQTT client directly:

```javascript
// Good:
this.mqtt.publish(topic, JSON.stringify(payload));

// Bad:
this.mqttClient.publish(...);  // Don't bypass wrapper
```

**Subscription setup** in `setupSubscriptions()`:
```javascript
setupSubscriptions() {
  // Zone state topics
  this.mqtt.subscribe(`${this.config.zones.lights.baseTopic}/state`);
  this.mqtt.subscribe(`${this.config.zones.mirror.baseTopic}/state`);
  // ... all zone state topics
  
  // Game command topic
  this.mqtt.subscribe(`${this.config.baseTopic}/commands`);
}
```

**Message handling** in `handleMessage(topic, message)`:
```javascript
handleMessage(topic, message) {
  try {
    const payload = JSON.parse(message.toString());
    
    if (topic.endsWith('/commands')) {
      this.handleCommand(payload);
    } else if (topic.endsWith('/state')) {
      this.handleStateUpdate(topic, payload);
    }
  } catch (error) {
    this.log.error('[mqtt] Message parse error:', error);
  }
}
```

**QoS levels**:
- Use QoS 1 for critical commands (game control, state changes)
- Use QoS 0 for frequent updates (heartbeat, status)

**Connection/reconnection**:
- Handle `connect` event to set up subscriptions
- Handle `offline` event to pause game if needed
- Handle `reconnect` event to restore state

### Logging Patterns

**File**: `src/logger.js`

**Log levels**:
- `error` — Critical failures that prevent operation
- `warn` — Unexpected conditions that don't prevent operation
- `info` — Normal operational messages (state changes, commands)
- `debug` — Detailed diagnostic information (MQTT messages, sequence steps)

**Usage**:
```javascript
this.log.error('[component] Critical error:', error);
this.log.warn('[component] Unexpected condition:', details);
this.log.info('[component] Normal operation:', info);
this.log.debug('[component] Debug details:', data);
```

**File rotation**:
- Logs rotate automatically based on size/date
- Cleanup handled by `src/log-cleanup.js`
- Don't implement custom rotation — use existing infrastructure

**Performance**:
- Avoid excessive logging in tight loops
- Use `debug` level for verbose output (disabled in production)
- Don't log large objects unless necessary

## Critical: Avoid Regressions & Maintain Existing Patterns

### API & Protocol Compliance

**MQTT Topic Structure** — SACRED:
- `{baseTopic}/{commands|state|status|warnings}` is the contract
- Breaking this breaks ParadoxFX, Clock UI, and other integrations
- **Never** change topic structure without explicit approval

**Command Message Format** — MUST MAINTAIN:
```javascript
{
  zone: "zonename",       // or zones: ["zone1", "zone2"]
  command: "action",
  ...params               // Command-specific parameters
}
```

**Zone Adapter Contracts**:
- Other systems (PFX, Clock) depend on adapter behavior
- Changes to adapter APIs must be backward compatible
- Document breaking changes in CHANGELOG

**EDN Config Format**:
- Existing game configs must continue working
- New features must be opt-in (default to old behavior)
- Validate against existing configs in `test/` directory

### Code Reuse & Duplication Prevention

**Search before creating**:
```bash
# Search for similar implementations
grep -r "functionName" src/
# Or use semantic search in IDE
```

**Extend existing utilities**:
- Check `src/util.js` and `src/engineUtils.js` before duplicating
- Add to existing utility modules rather than creating new ones
- Follow established patterns for similar operations

**Zone adapter pattern**:
- All adapters follow same structure (constructor, executeCommand, handleStateUpdate)
- Don't create one-off adapter patterns
- Reuse MQTT publish/subscribe patterns

### Configuration vs Implementation Separation

**Keep engine generic**:
- Game-specific logic belongs in EDN files, NOT source code
- Don't hardcode game scenarios, sequences, or timings
- Use configuration to drive behavior

**Config-driven behavior**:
```javascript
// Good:
const duration = config.modes[currentMode].introDuration;

// Bad:
const duration = currentMode === '60min' ? 45 : 30;  // Hardcoded
```

**Preserve flexibility**:
- Support multiple games with same engine
- Don't assume specific zone configurations
- Use zone registry pattern, not hardcoded zone names

### Surgical Code Changes

**Edit only what's necessary**:
- Don't reformat files when making functional changes
- Avoid "while I'm here" improvements unless explicitly scoped
- Keep commits focused on single concerns

**Preserve existing imports**:
```javascript
// Don't reorganize unless necessary:
const util = require('./util');  // Keep existing style
```

**Maintain error handling**:
- Don't change log levels without reason
- Preserve error message formats (other tools may parse them)
- Keep existing error recovery patterns

**File structure**:
- Don't move functions between files without explicit need
- Keep related functionality together
- Maintain existing module boundaries

## Testing Requirements

### Unit Tests

**Location**: `test/*.test.js`

**Coverage requirements**:
- New zone adapters must have command transformation tests
- Config changes must have validation tests
- State machine changes must have transition tests

**Example test structure**:
```javascript
const assert = require('assert');
const Game = require('../src/game');

describe('NewZoneAdapter', () => {
  let game, mqttMock;
  
  beforeEach(() => {
    mqttMock = createMockMQTT();
    game = new Game(testConfig, mqttMock);
  });
  
  it('should publish correct MQTT message for command', async () => {
    const command = { zone: 'newzone', command: 'action', param: 'value' };
    await game.executeCommand(command);
    
    assert.strictEqual(mqttMock.publishedTopic, 'paradox/newzone/commands');
    assert.deepStrictEqual(mqttMock.publishedMessage, {
      command: 'action',
      param: 'value'
    });
  });
});
```

### Contract Tests

**File**: `test/command-contract.test.js`

- Tests that all command formats are correctly transformed
- Validates MQTT message structure
- Ensures zone routing works correctly

**Add tests for**:
- New command types
- New zone adapters
- Command parameter variations

### E2E Tests

**File**: `test/e2e-*.js`

- Tests full sequence execution
- Validates state machine transitions
- Tests timer behavior (pause/resume)

**Smoke test requirements**:
- Test each major game phase (intro, gameplay, solved, failed)
- Verify MQTT communication end-to-end
- Test config loading and validation

### Running Tests

```bash
# Run all tests
npm test

# Run specific test
npm run test:contract
npm run test:scheduler
npm run test:e2e

# Debug mode (verbose logging)
LOG_LEVEL=debug npm test
```

**Before pushing**:
- [ ] All tests pass: `npm test`
- [ ] Config validation passes: `npm run validate`
- [ ] No lint errors (if linter configured)
- [ ] Manual smoke test with real MQTT broker

## File Patterns to Know

**Core Engine**:
- `src/game.js` — Main entry point and state machine coordinator
- `src/stateMachine.js` — State definitions and transitions
- `src/sequenceRunner.js` — Timeline-based sequence execution
- `src/config.js` — Main config loader and validation

**Zone Adapters** (`src/adapters/*.js`):
- One file per zone type
- Follow consistent pattern: constructor, executeCommand, handleStateUpdate
- Example: `lights.js`, `mirror.js`, `audio.js`, `clock.js`, `system.js`

**Config Loaders**:
- `src/edn-config-loader.js` — EDN parsing and keyword resolution
- `src/ini-config-loader.js` — INI file parsing
- `src/modular-config-adapter.js` — Multi-file config composition
- `src/template-expander.js` — Variable substitution

**Utilities**:
- `src/util.js` — General utility functions
- `src/engineUtils.js` — Engine-specific utilities
- `src/logger.js` — Logging infrastructure
- `src/log-cleanup.js` — Log rotation and cleanup

**MQTT**:
- `src/mqttClient.js` — MQTT wrapper and connection management

**Validators** (`src/validators/*.js`):
- Config schema validation
- Command validation
- EDN structure validation

**Tests** (`test/*.js`):
- `test/command-contract.test.js` — Command transformation tests
- `test/scheduler.test.js` — Timer and sequence tests
- `test/e2e-*.js` — End-to-end smoke tests

**Media** (`src/media/*.js`):
- Media file path resolution
- Media validation utilities

**Hint System**:
- `src/hints.js` — Multi-type hint execution (text, speech, audio, video, action)

## Architecture Change Protocol

**Require explicit approval before**:
- Changing MQTT topic structure
- Modifying state machine transition graph
- Changing sequence execution semantics
- Breaking EDN config format compatibility
- Modifying zone adapter contracts

**Safe to do without approval**:
- Adding new zone adapters (following existing pattern)
- Adding new optional config keys (with defaults)
- Improving error messages and logging
- Adding tests
- Fixing bugs that don't change behavior

**When in doubt**:
- Open an issue for discussion before implementing
- Provide example configs showing backward compatibility
- Document migration path if breaking change is necessary

## Performance Considerations

**Sequence Runner**:
- Blocking by design — long sequences delay state transitions
- Use `:wait` sparingly — prefer timeline-based timing
- Avoid deeply nested sequences (performance and complexity)

**MQTT Publishing**:
- Async operation — don't assume immediate delivery
- Don't publish in tight loops — batch if possible
- Use QoS 0 for high-frequency updates (heartbeat)

**Logger**:
- File writes are async but can accumulate
- Avoid excessive logging in production
- Use debug level for verbose output

**Config Loading**:
- Synchronous at startup — acceptable delay
- Don't reload during gameplay (performance impact)
- Cache parsed configs

**Timer Precision**:
- JavaScript timers are not perfectly precise
- Expect ~10ms variance in timing
- Design sequences with tolerance for timing drift

## Common Patterns and Recipes

### Execute Sequence After Delay

```javascript
// Use :wait in timeline
:sequences {
  :delayed-sequence {
    :duration 35
    :timeline [
      {:at 35 :wait 5}           ; Wait 5 seconds from start
      {:at 30 :cue :lights-red}  ; Then execute (5 seconds later)
    ]
  }
}
```

### Multi-Zone Coordination

```javascript
// Use zones array for simultaneous execution
:cues {
  :stop-all-media [{:zones ["mirror" "audio"] :command "stopAudio"}]
}
```

### Conditional Execution Based on State

```javascript
async handleCommand(cmd) {
  if (this.state === STATES.GAMEPLAY && cmd.command === 'pause') {
    await this.setState(STATES.PAUSED);
  }
}
```

### Mode-Specific Behavior

```javascript
const currentMode = this.config.currentMode || '60min';
const introDuration = this.config.modes[currentMode].introDuration;
```

### Variable Substitution in Commands

```javascript
// In EDN config:
:cues {
  :hint-speech {
    :zone "audio"
    :command "playAudioFX"
    :file "{{hint-file}}"
    :volume 80
  }
}

// In code (template-expander.js):
const expanded = expandTemplate(cue, { 'hint-file': 'media/hints/hint-01.mp3' });
```

## Questions or Issues

- **State machine questions**: See `docs/SPEC.md` for state diagram and semantics
- **MQTT protocol questions**: See `docs/MQTT_API.md` for topic and message formats
- **Config format questions**: See `docs/CONFIG_EDN.md` and `docs/CONFIG_INI.md`
- **Setup and installation**: See `docs/SETUP.md`
- **Building games**: See `docs/USER_GUIDE.md` for EDN tutorial

## Development Mindset

**You are building an engine, not a game**:
- Think in terms of zones, sequences, and states — not specific puzzles
- Design for flexibility and reusability
- Game designers will create content using your configuration system

**Reliability is paramount**:
- This runs live escape rooms — downtime is unacceptable
- Graceful degradation is better than crashes
- Log errors but keep running when possible

**Backward compatibility matters**:
- Existing games depend on this engine
- Breaking changes require coordination and migration plans
- Opt-in for new features, preserve old behavior by default

**Test thoroughly**:
- Unit tests for components
- Contract tests for APIs
- E2E tests for critical paths
- Manual testing with real MQTT broker

Always check existing patterns in similar components before implementing new features. The system prioritizes **reliability and backward compatibility** for live escape room environments.
