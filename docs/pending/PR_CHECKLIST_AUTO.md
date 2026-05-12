# Implementation Plan: Automated Checklist System (Phase 2)

**Feature**: Automated checklist system with MQTT-based device monitoring and prop alternative selection  
**Target**: PxO v1.x  
**Date**: November 2025  
**Status**: Planning  
**Prerequisite**: Phase 1 (Manual Checklist) must be completed

---

## Overview

Extend the manual checklist system with automated monitoring of props and software components via MQTT. The system will:
- Monitor device/prop states through MQTT topics
- Automatically update checklist items based on device state
- Support alternative prop configurations based on current state
- Provide automatic reset triggers for compatible devices
- Mix automated and manual items in a unified checklist
- Maintain full backward compatibility with Phase 1

This enables game masters to see the complete room readiness at a glance, with automated items self-updating and manual items requiring human verification.

---

## Requirements

### Core Functionality

1. **Automated State Monitoring**
   - Subscribe to MQTT state topics for devices/props
   - Parse state messages and map to ready/not-ready
   - Update checklist item state automatically
   - Track last-seen timestamp for each monitored device
   - Detect offline/unresponsive devices

2. **Auto-Reset Triggers**
   - Send reset commands to devices via MQTT
   - Verify device state after reset command
   - Retry logic for failed resets
   - Configurable timeout for reset operations

3. **Prop Alternative Selection**
   - Define multiple versions/states for a prop
   - Automatically select alternative based on current state
   - Update game config with selected alternative
   - Notify game master of automatic selections

4. **Mixed Checklist UI**
   - Display both manual and automated items
   - Visual distinction (auto items have status indicator)
   - Auto items update in real-time
   - Manual items still user-editable
   - Show last-updated timestamp for auto items

5. **Advanced Monitoring**
   - Health checks (ping/heartbeat)
   - State validation (expected vs actual)
   - Confidence scoring for auto checks
   - Manual override for false positives

### EDN Configuration Extensions

Add auto-monitoring config to checklist items:
- Monitor type (mqtt-state, mqtt-command, http-poll, script)
- Monitor parameters (topic, expected value, timeout)
- Reset command configuration
- Alternative prop definitions
- Confidence thresholds

---

## Architecture

### Component Additions

```
┌─────────────────────────────────────────────────────────────┐
│                     PxO (Node.js)                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Checklist Module (src/checklist/)                    │  │
│  │  - config-loader.js      [EXTENDED]                  │  │
│  │  - state-manager.js      [EXTENDED]                  │  │
│  │  - mqtt-handler.js       [EXTENDED]                  │  │
│  │  - auto-checks.js        [NEW]                       │  │
│  │  - device-monitor.js     [NEW]                       │  │
│  │  - reset-manager.js      [NEW]                       │  │
│  │  - prop-alternatives.js  [NEW]                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                         ↕ MQTT
┌─────────────────────────────────────────────────────────────┐
│                      MQTT Broker                             │
└─────────────────────────────────────────────────────────────┘
     ↕                    ↕                    ↕
┌──────────┐        ┌──────────┐        ┌──────────┐
│ Device A │        │ Device B │        │ Device C │
│ (Lights) │        │ (Lock)   │        │ (Display)│
└──────────┘        └──────────┘        └──────────┘
   publishes           publishes           publishes
   to /state           to /state           to /state
```

### Auto-Check Flow

```
1. PxO loads checklist with auto-monitor items
2. auto-checks.js subscribes to device state topics
3. Device publishes state update
4. device-monitor.js receives state, evaluates ready/not-ready
5. state-manager.js updates item state
6. mqtt-handler.js publishes updated checklist state
7. UI receives update, shows auto-item as ready/not-ready
```

### Auto-Reset Flow

```
1. Game ends, PxO triggers reset
2. reset-manager.js sends reset commands to auto-items
3. Devices execute reset, publish new state
4. device-monitor.js verifies state matches expected
5. If verified → item marked ready
6. If timeout/failed → item marked not-ready with error
7. state-manager.js saves results to JSON log
```

### Prop Alternative Selection Flow

```
1. Device state indicates prop variant/condition
2. prop-alternatives.js evaluates state against alternatives
3. Select best alternative based on rules
4. Update game config with selected alternative
5. Log selection decision
6. Publish notification to game/checklist-alternatives topic
7. UI shows selected alternative to game master
```

---

## File Structure

```
/opt/paradox/apps/PxO/
├── src/
│   ├── checklist/
│   │   ├── index.js              # [EXTENDED] Add auto-check initialization
│   │   ├── config-loader.js      # [EXTENDED] Parse auto-monitor fields
│   │   ├── state-manager.js      # [EXTENDED] Handle auto vs manual items
│   │   ├── mqtt-handler.js       # [EXTENDED] Subscribe to device topics
│   │   ├── auto-checks.js        # [NEW] Coordinate auto-check logic
│   │   ├── device-monitor.js     # [NEW] Monitor device states
│   │   ├── reset-manager.js      # [NEW] Send reset commands
│   │   └── prop-alternatives.js  # [NEW] Manage prop alternatives
├── public/
│   ├── checklist.html            # [EXTENDED] Show auto-item indicators
│   ├── checklist.js              # [EXTENDED] Handle auto-item updates
│   └── checklist.css             # [EXTENDED] Style auto-item badges
├── config/
│   └── checklist.edn             # [EXTENDED] Add auto-monitor config
└── docs/
    └── PR_CHECKLIST_AUTO.md      # This document
```

---

## EDN Schema Extensions

### Auto-Monitor Configuration

Add to checklist items in `checklist.edn`:

```clojure
{:checklist
 {:enabled true
  :items
  [
   ;; Automated item: Monitor MQTT state
   {:key "lights_ready"
    :short-name "Lighting System"
    :description "All lighting zones operational"
    :details "<p>Zones should respond to commands and report healthy state.</p>"
    :enabled true
    :category "technical"
    :auto-monitor true
    :monitor-config
    {:type :mqtt-state
     :topic "paradox/game/lights/state"
     :ready-condition {:state "idle" :connected true}
     :timeout-seconds 10
     :reset-command {:topic "paradox/game/lights/commands"
                     :payload {:command "reset"}}
     :alternatives nil}}
   
   ;; Automated item: HTTP polling
   {:key "clock_display"
    :short-name "Countdown Clock"
    :description "Clock display is reachable and showing correct time"
    :details "Clock should be at http://clock-display:3000/health"
    :enabled true
    :category "technical"
    :auto-monitor true
    :monitor-config
    {:type :http-poll
     :url "http://clock-display:3000/health"
     :method "GET"
     :ready-condition {:status 200 :body-contains "healthy"}
     :interval-seconds 30
     :timeout-seconds 5
     :reset-command {:type :http-post
                     :url "http://clock-display:3000/reset"
                     :payload {:action "reset"}}
     :alternatives nil}}
   
   ;; Automated item: Script execution
   {:key "audio_system"
    :short-name "Audio System"
    :description "Audio playback system ready"
    :details "Speaker channels active, volume at 70%"
    :enabled true
    :category "technical"
    :auto-monitor true
    :monitor-config
    {:type :script
     :check-script "/opt/paradox/scripts/check-audio.sh"
     :ready-condition {:exit-code 0}
     :timeout-seconds 15
     :reset-command {:type :script
                     :script "/opt/paradox/scripts/reset-audio.sh"}
     :alternatives nil}}
   
   ;; Automated item with alternatives
   {:key "magic_mirror"
    :short-name "Magic Mirror Display"
    :description "Display showing intro content or alternative"
    :details "<p>Mirror can operate in multiple modes. System will auto-select based on device state.</p>"
    :enabled true
    :category "technical"
    :auto-monitor true
    :monitor-config
    {:type :mqtt-state
     :topic "paradox/game/mirror/state"
     :ready-condition {:connected true}
     :timeout-seconds 10
     :reset-command {:topic "paradox/game/mirror/commands"
                     :payload {:command "reset"}}
     :alternatives
     [{:key "mirror-video"
       :name "Video Mode"
       :description "Show intro video on mirror display"
       :condition {:video-capable true}
       :config-updates {:mirror-mode "video"
                        :intro-media "intro.mp4"}}
      
      {:key "mirror-static"
       :name "Static Image Mode"
       :description "Show static image (fallback)"
       :condition {:connected true}
       :config-updates {:mirror-mode "image"
                        :intro-media "intro.jpg"}}
      
      {:key "mirror-disabled"
       :name "Mirror Disabled"
       :description "Skip mirror intro, use audio only"
       :condition {:connected false}
       :config-updates {:mirror-mode "disabled"
                        :intro-media nil
                        :audio-intro "intro-narration.mp3"}}]}}
   
   ;; Manual item (unchanged from Phase 1)
   {:key "prop_handcuffs"
    :short-name "Handcuffs"
    :description "Houdini's escape handcuffs on table"
    :details "Check clasp is functional, key is in drawer."
    :enabled true
    :category "props"
    :auto-monitor false}
  ]}}
```

### Field Descriptions (New/Extended)

- `:auto-monitor` — Boolean; if `true`, item state is automatically monitored
- `:monitor-config` — Map with monitoring configuration (only if `:auto-monitor true`)
  - `:type` — Monitor type: `:mqtt-state`, `:http-poll`, `:script`, `:mqtt-command`
  - `:topic` — MQTT topic to subscribe (for mqtt-state)
  - `:url` — HTTP endpoint (for http-poll)
  - `:check-script` — Path to check script (for script type)
  - `:ready-condition` — Map defining when item is ready (varies by type)
  - `:timeout-seconds` — Max time to wait for state/response
  - `:interval-seconds` — Polling interval (for http-poll)
  - `:reset-command` — Optional; command to send for automatic reset
  - `:alternatives` — Optional; list of alternative configurations

- `:alternatives` — Vector of alternative prop configurations
  - `:key` — Unique identifier for alternative
  - `:name` — Display name
  - `:description` — Description shown to GM
  - `:condition` — Map defining when this alternative applies
  - `:config-updates` — Map of game config keys to update when selected

### Monitor Types

#### :mqtt-state
Subscribe to MQTT topic, check device state.

```clojure
:monitor-config
{:type :mqtt-state
 :topic "paradox/game/lights/state"
 :ready-condition {:state "idle" :connected true}
 :timeout-seconds 10}
```

**Ready Condition**: All key-value pairs in `:ready-condition` must match fields in received JSON.

#### :http-poll
Poll HTTP endpoint at regular interval.

```clojure
:monitor-config
{:type :http-poll
 :url "http://device:3000/health"
 :method "GET"
 :interval-seconds 30
 :ready-condition {:status 200 :body-contains "OK"}
 :timeout-seconds 5}
```

**Ready Condition**:
- `:status` — Expected HTTP status code
- `:body-contains` — String that must be in response body
- `:body-json` — Expected JSON fields (alternative to body-contains)

#### :script
Execute shell script, check exit code.

```clojure
:monitor-config
{:type :script
 :check-script "/opt/paradox/scripts/check-device.sh"
 :ready-condition {:exit-code 0}
 :timeout-seconds 15}
```

**Ready Condition**:
- `:exit-code` — Expected script exit code (0 = success)
- Optionally check stdout/stderr for specific strings

#### :mqtt-command
Send command to device and wait for response.

```clojure
:monitor-config
{:type :mqtt-command
 :command-topic "paradox/game/device/commands"
 :response-topic "paradox/game/device/response"
 :command {:command "status"}
 :ready-condition {:status "ready"}
 :timeout-seconds 5}
```

**Ready Condition**: Match fields in response message.

---

## MQTT Topics (Extended)

### New Topics (Phase 2)

| Topic | Payload | Description |
|-------|---------|-------------|
| `paradox/{room}/checklist/auto-state` | Auto-item states JSON | Real-time updates for auto-monitored items |
| `paradox/{room}/checklist/alternatives` | Selected alternatives JSON | Notifications of auto-selected alternatives |
| `paradox/{room}/checklist/reset-status` | Reset operation status JSON | Status of auto-reset operations |

### Extended Topics

| Topic | Changes | Description |
|-------|---------|-------------|
| `paradox/{room}/checklist/state` | Add `type` field | Distinguish manual vs auto items |
| `paradox/{room}/checklist/config` | Add `autoMonitor` fields | Include monitor config in published config |

---

## MQTT Message Formats (Phase 2)

### paradox/{room}/checklist/auto-state

Published whenever an auto-monitored item state changes.

```json
{
  "timestamp": "2025-11-07T15:30:00Z",
  "room": "houdinis-challenge",
  "items": [
    {
      "key": "lights_ready",
      "type": "auto",
      "ready": true,
      "lastChecked": "2025-11-07T15:29:58Z",
      "confidence": 1.0,
      "source": "mqtt-state",
      "deviceState": {"state": "idle", "connected": true}
    },
    {
      "key": "clock_display",
      "type": "auto",
      "ready": false,
      "lastChecked": "2025-11-07T15:29:55Z",
      "confidence": 0.0,
      "source": "http-poll",
      "error": "Connection timeout"
    }
  ]
}
```

**Fields**:
- `type` — Always `"auto"` for automated items
- `confidence` — 0.0 to 1.0; how confident the system is in the ready state
- `source` — Monitor type that determined state
- `deviceState` — Raw device state (for debugging)
- `error` — Error message if check failed

### paradox/{room}/checklist/alternatives

Published when an alternative prop configuration is selected.

```json
{
  "timestamp": "2025-11-07T15:30:00Z",
  "room": "houdinis-challenge",
  "item": "magic_mirror",
  "selectedAlternative": {
    "key": "mirror-static",
    "name": "Static Image Mode",
    "description": "Show static image (fallback)",
    "reason": "Video capability not detected",
    "configUpdates": {
      "mirror-mode": "image",
      "intro-media": "intro.jpg"
    }
  }
}
```

### paradox/{room}/checklist/reset-status

Published during auto-reset operations.

```json
{
  "timestamp": "2025-11-07T15:32:00Z",
  "room": "houdinis-challenge",
  "operation": "auto-reset",
  "status": "in-progress",
  "items": [
    {
      "key": "lights_ready",
      "status": "success",
      "resetAt": "2025-11-07T15:31:58Z",
      "verifiedAt": "2025-11-07T15:32:00Z"
    },
    {
      "key": "clock_display",
      "status": "failed",
      "resetAt": "2025-11-07T15:31:58Z",
      "error": "Reset command timeout"
    }
  ],
  "summary": {
    "total": 3,
    "success": 2,
    "failed": 1,
    "pending": 0
  }
}
```

---

## JSON Log Format (Extended)

### New Event Types

#### auto-reset
Logged when automatic reset is triggered.

```json
{
  "event": "auto-reset",
  "timestamp": "2025-11-07T15:31:58Z",
  "room": "houdinis-challenge",
  "triggeredBy": "game-end",
  "items": [
    {
      "key": "lights_ready",
      "type": "auto",
      "resetCommand": {"topic": "paradox/game/lights/commands", "payload": {"command": "reset"}},
      "status": "success",
      "verifiedAt": "2025-11-07T15:32:00Z"
    },
    {
      "key": "clock_display",
      "type": "auto",
      "resetCommand": {"type": "http-post", "url": "http://clock-display:3000/reset"},
      "status": "failed",
      "error": "Connection timeout"
    }
  ],
  "summary": {
    "total": 2,
    "success": 1,
    "failed": 1
  }
}
```

#### alternative-selected
Logged when a prop alternative is automatically selected.

```json
{
  "event": "alternative-selected",
  "timestamp": "2025-11-07T15:30:00Z",
  "room": "houdinis-challenge",
  "item": "magic_mirror",
  "deviceState": {"connected": true, "video-capable": false},
  "selectedAlternative": {
    "key": "mirror-static",
    "name": "Static Image Mode",
    "reason": "Device does not support video playback",
    "configUpdates": {
      "mirror-mode": "image",
      "intro-media": "intro.jpg"
    }
  },
  "previousAlternative": "mirror-video"
}
```

#### auto-state-change
Logged when auto-monitored item changes state.

```json
{
  "event": "auto-state-change",
  "timestamp": "2025-11-07T15:29:58Z",
  "room": "houdinis-challenge",
  "item": "lights_ready",
  "previousState": "not-ready",
  "newState": "ready",
  "confidence": 1.0,
  "source": "mqtt-state",
  "deviceState": {"state": "idle", "connected": true}
}
```

---

## Implementation Plan

### Phase 2.1: Auto-Check Infrastructure (Week 1)

**Goal**: Build core auto-monitoring framework.

#### Tasks

1. **Create auto-checks.js**
   - Initialize auto-check coordinator
   - Load auto-monitor items from config
   - Start monitors for each auto item
   - Coordinate state updates
   - Handle monitor lifecycle (start/stop/restart)

2. **Create device-monitor.js**
   - Base monitor class with common logic
   - MQTT state monitor implementation
   - HTTP poll monitor implementation
   - Script monitor implementation
   - MQTT command monitor implementation
   - State evaluation (ready condition matching)
   - Confidence scoring
   - Error handling and retries

3. **Extend config-loader.js**
   - Parse `:auto-monitor` and `:monitor-config` fields
   - Validate monitor config schema
   - Support all monitor types
   - Parse alternatives config

4. **Extend state-manager.js**
   - Track both manual and auto item states
   - Add `type` field (manual/auto) to state
   - Add confidence and source fields for auto items
   - Separate update methods for manual vs auto

5. **Write unit tests**
   - Test each monitor type (mqtt, http, script)
   - Test ready condition evaluation
   - Test confidence scoring
   - Test error handling

**Deliverables**:
- `src/checklist/auto-checks.js`
- `src/checklist/device-monitor.js`
- Extended `src/checklist/config-loader.js`
- Extended `src/checklist/state-manager.js`
- Unit tests

---

### Phase 2.2: MQTT Integration & State Sync (Week 1)

**Goal**: Integrate auto-checks with MQTT and state publishing.

#### Tasks

1. **Extend mqtt-handler.js**
   - Subscribe to device state topics for auto items
   - Publish auto-state updates to `checklist/auto-state`
   - Route device messages to appropriate monitors
   - Handle dynamic topic subscriptions

2. **Integrate auto-checks with game flow**
   - Start auto-monitoring on PxO startup
   - Subscribe to all configured device topics
   - Update checklist state when device states change
   - Publish combined state (manual + auto) to `checklist/state`

3. **Add state aggregation**
   - Combine manual and auto item states
   - Calculate overall readiness (all items)
   - Track separate ready counts for manual vs auto
   - Include in game status heartbeat

4. **Test MQTT monitoring**
   - Publish test device states
   - Verify auto items update correctly
   - Test multiple monitor types simultaneously
   - Verify state aggregation

**Deliverables**:
- Extended `src/checklist/mqtt-handler.js`
- Integration with `src/game.js`
- MQTT integration tests
- State aggregation logic

---

### Phase 2.3: Auto-Reset System (Week 2)

**Goal**: Implement automatic reset commands and verification.

#### Tasks

1. **Create reset-manager.js**
   - `executeReset(item)` — Send reset command to device
   - Support MQTT, HTTP, and script reset types
   - Timeout and retry logic
   - Verify state after reset
   - Track reset operation status
   - Publish reset status to MQTT

2. **Integrate with game end flow**
   - Modify game end handler to trigger auto-reset
   - Execute reset for all auto items with reset config
   - Wait for verification or timeout
   - Log reset results
   - Set game state based on reset success

3. **Add reset command types**
   - MQTT reset: publish command to topic
   - HTTP reset: POST to endpoint
   - Script reset: execute shell script
   - Verify each type works correctly

4. **Add manual reset trigger**
   - Add "Retry Auto Reset" button to UI
   - Publish command to trigger reset
   - Show reset progress in UI
   - Display success/failure per item

5. **Test reset operations**
   - Test each reset command type
   - Test verification after reset
   - Test timeout and retry logic
   - Test parallel resets

**Deliverables**:
- `src/checklist/reset-manager.js`
- Integration with game end flow
- Reset UI controls
- Reset operation tests

---

### Phase 2.4: Prop Alternatives System (Week 2)

**Goal**: Implement automatic prop alternative selection.

#### Tasks

1. **Create prop-alternatives.js**
   - `evaluateAlternatives(item, deviceState)` — Select best alternative
   - Match conditions against device state
   - Priority/fallback logic (first match wins)
   - Return selected alternative with config updates
   - Log selection decision

2. **Integrate with device monitoring**
   - When device state changes, check for alternatives
   - If alternatives defined, evaluate and select
   - Apply config updates to game config
   - Publish selection to `checklist/alternatives`
   - Log alternative-selected event

3. **Game config updates**
   - Apply config-updates to game.edn in memory
   - Persist changes to disk (optional, may be per-game decision)
   - Reload affected game components
   - Notify game master of config change

4. **UI for alternatives**
   - Show selected alternative in checklist UI
   - Display reason for selection
   - Allow manual override (GM can choose different alternative)
   - Show config updates applied

5. **Test alternative selection**
   - Test condition matching
   - Test config updates applied correctly
   - Test fallback logic
   - Test manual override

**Deliverables**:
- `src/checklist/prop-alternatives.js`
- Integration with device-monitor
- Game config update logic
- Alternatives UI
- Alternative selection tests

---

### Phase 2.5: UI Enhancements (Week 3)

**Goal**: Update popup UI to display auto items and real-time updates.

#### Tasks

1. **Extend checklist.html**
   - Add visual distinction for auto vs manual items
   - Badge/icon for auto items
   - Real-time status indicator (updating...)
   - Show last-checked timestamp for auto items
   - Show confidence score (if < 1.0)
   - Display device state (expandable)
   - Show selected alternative (if applicable)

2. **Extend checklist.js**
   - Subscribe to `checklist/auto-state`
   - Update auto items in real-time
   - Animate state changes
   - Show device state in details section
   - Handle alternative notifications
   - Display reset status during auto-reset

3. **Extend checklist.css**
   - Style auto-item badges (e.g., "AUTO" badge)
   - Color coding: green=ready, red=not-ready, yellow=checking
   - Pulsing/loading animation for items being checked
   - Distinct styles for auto vs manual items
   - Responsive design maintained

4. **Add "Retry Auto Reset" button**
   - Show button when auto items not ready
   - Publish reset command
   - Show progress spinner
   - Display results

5. **Test UI on devices**
   - Verify real-time updates work smoothly
   - Test on mobile, tablet, desktop
   - Verify animations not janky
   - Test with mix of manual and auto items

**Deliverables**:
- Extended `public/checklist.html`
- Extended `public/checklist.js`
- Extended `public/checklist.css`
- UI testing checklist

---

### Phase 2.6: Testing & Documentation (Week 3)

**Goal**: Comprehensive testing and documentation.

#### Tasks

1. **Unit tests**
   - auto-checks.js tests
   - device-monitor.js tests (each monitor type)
   - reset-manager.js tests (each reset type)
   - prop-alternatives.js tests (condition matching, config updates)

2. **Integration tests**
   - Full game flow with mixed checklist
   - Auto-reset on game end
   - Alternative selection during device state change
   - Multi-monitor concurrent operation
   - Network interruption recovery

3. **Manual QA checklist**
   - [ ] Auto items load correctly from EDN
   - [ ] MQTT state monitoring works
   - [ ] HTTP polling works
   - [ ] Script monitoring works
   - [ ] Auto items update in real-time in UI
   - [ ] Auto-reset triggers on game end
   - [ ] Reset verification works
   - [ ] Reset retry logic works
   - [ ] Alternative selection works
   - [ ] Config updates applied correctly
   - [ ] Manual override of alternatives works
   - [ ] Mixed checklist (manual + auto) displays correctly
   - [ ] Confidence scores shown in UI
   - [ ] Device state expandable in details
   - [ ] Reset status shows in UI

4. **Write operator documentation**
   - How to configure auto-monitor items
   - Monitor types and when to use each
   - How to define alternatives
   - Troubleshooting auto-checks
   - Understanding confidence scores
   - Manual override procedures

5. **Write developer documentation**
   - Auto-check architecture
   - Adding new monitor types
   - Alternative selection logic
   - Config update mechanisms
   - API reference for new modules

**Deliverables**:
- Unit test suite (extended)
- Integration test suite (extended)
- Manual QA checklist (completed)
- `CHECKLIST_AUTO_USER_GUIDE.md`
- `CHECKLIST_AUTO_DEVELOPER_GUIDE.md`

---

## API Reference (New Modules)

### src/checklist/auto-checks.js

```javascript
module.exports = {
  // Initialize auto-check system
  async initialize(mqttClient, config, logger) { },
  
  // Start monitoring all auto items
  async startMonitoring() { },
  
  // Stop all monitors
  async stopMonitoring() { },
  
  // Get current auto-item states
  getAutoStates() { },
  
  // Manually trigger check for specific item
  async checkItem(itemKey) { },
  
  // Execute auto-reset for all items
  async executeAutoReset() { }
};
```

### src/checklist/device-monitor.js

```javascript
// Base Monitor class
class Monitor {
  constructor(itemKey, config, logger) { }
  
  // Start monitoring
  async start() { }
  
  // Stop monitoring
  async stop() { }
  
  // Get current state
  getState() { }
  
  // Evaluate ready condition
  evaluateReady(deviceState) { }
  
  // Calculate confidence score
  calculateConfidence(deviceState) { }
}

// MQTT State Monitor
class MqttStateMonitor extends Monitor {
  // Subscribe to MQTT topic, evaluate state
}

// HTTP Poll Monitor
class HttpPollMonitor extends Monitor {
  // Poll HTTP endpoint at interval
}

// Script Monitor
class ScriptMonitor extends Monitor {
  // Execute shell script
}

// MQTT Command Monitor
class MqttCommandMonitor extends Monitor {
  // Send command, wait for response
}

module.exports = {
  Monitor,
  MqttStateMonitor,
  HttpPollMonitor,
  ScriptMonitor,
  MqttCommandMonitor,
  
  // Factory function
  createMonitor(type, itemKey, config, logger) { }
};
```

### src/checklist/reset-manager.js

```javascript
module.exports = {
  // Initialize reset manager
  initialize(mqttClient, logger) { },
  
  // Execute reset for single item
  async resetItem(item) { },
  
  // Execute reset for all auto items
  async resetAll(items) { },
  
  // Verify state after reset
  async verifyReset(item, timeoutSeconds) { },
  
  // Get reset status
  getResetStatus() { }
};
```

### src/checklist/prop-alternatives.js

```javascript
module.exports = {
  // Evaluate alternatives for an item
  evaluateAlternatives(item, deviceState) { },
  
  // Apply config updates
  async applyConfigUpdates(updates) { },
  
  // Get currently selected alternative
  getSelectedAlternative(itemKey) { },
  
  // Manual override to select specific alternative
  async selectAlternative(itemKey, alternativeKey) { }
};
```

---

## Testing Strategy (Phase 2)

### Unit Tests

**auto-checks.test.js**:
- Initialize with config
- Start/stop monitoring
- Get auto states
- Manual item check trigger

**device-monitor.test.js**:
- MQTT state monitor: subscribe, evaluate, confidence
- HTTP poll monitor: polling, timeout, ready condition
- Script monitor: execute, exit code check
- MQTT command monitor: send command, parse response

**reset-manager.test.js**:
- MQTT reset command
- HTTP reset command
- Script reset command
- Verify after reset
- Timeout handling
- Parallel resets

**prop-alternatives.test.js**:
- Condition matching
- Priority/fallback selection
- Config updates
- Manual override

### Integration Tests

**auto-monitoring.test.js**:
1. Start PxO with auto-monitor items
2. Publish device states to MQTT
3. Verify auto items update
4. Verify checklist state aggregation
5. Verify UI receives updates

**auto-reset.test.js**:
1. End game
2. Verify auto-reset triggered
3. Publish device states (simulated)
4. Verify items marked ready
5. Verify game state updated

**alternatives.test.js**:
1. Device state changes
2. Alternative evaluated and selected
3. Config updates applied
4. Notification published
5. UI shows selected alternative

### Manual QA

**Auto-Item Monitoring**:
- [ ] MQTT state monitor updates in real-time
- [ ] HTTP poll monitor updates at interval
- [ ] Script monitor executes and updates
- [ ] Offline device detected and marked not-ready
- [ ] Confidence score displayed for uncertain states

**Auto-Reset**:
- [ ] Reset commands sent to all auto items
- [ ] Device responses received and verified
- [ ] Failed resets marked with error
- [ ] Manual retry works
- [ ] Reset status shown in UI

**Prop Alternatives**:
- [ ] Alternative selected based on device state
- [ ] Config updates applied to game
- [ ] Notification shows in UI
- [ ] Manual override allows GM to pick alternative
- [ ] Fallback logic works when primary unavailable

**Mixed Checklist**:
- [ ] Auto and manual items shown together
- [ ] Visual distinction clear
- [ ] Auto items auto-update, manual items editable
- [ ] Overall ready state correct (both types considered)

---

## Success Criteria

### Functional Requirements
- ✅ Auto-monitor items defined in EDN
- ✅ MQTT, HTTP, and script monitoring work
- ✅ Auto items update in real-time
- ✅ Auto-reset commands execute correctly
- ✅ Reset verification works with timeout
- ✅ Prop alternatives auto-selected based on device state
- ✅ Config updates applied automatically
- ✅ Mixed checklist displays correctly
- ✅ Manual items still work as in Phase 1

### Non-Functional Requirements
- ✅ Auto-check latency < 2 seconds
- ✅ HTTP poll interval configurable (default 30s)
- ✅ Reset timeout configurable (default 10s)
- ✅ Handles 10+ concurrent monitors without performance degradation
- ✅ Device offline detection within 30 seconds
- ✅ UI updates smoothly (no jank)

### User Experience
- ✅ Clear visual distinction between auto and manual items
- ✅ Real-time updates feel responsive
- ✅ Auto-reset status visible and understandable
- ✅ Alternative selection reasons clear to GM
- ✅ Manual override of auto-checks available

---

## Backward Compatibility

### Phase 1 Compatibility
- All Phase 1 manual items work unchanged
- EDN files without `:auto-monitor` field default to `false`
- Existing MQTT topics unchanged
- JSON log format extended but backward-compatible
- UI gracefully handles checklist with no auto items

### Migration Path
- Existing checklists continue to work
- Add `:auto-monitor` and `:monitor-config` incrementally
- No breaking changes to Phase 1 APIs
- Optional feature: disable auto-checks via config flag

---

## Risk Mitigation

### Risk: Device MQTT topics change
**Mitigation**: Monitor config in EDN; easy to update; validate topic subscriptions on startup.

### Risk: False positives from auto-checks
**Mitigation**: Confidence scoring; manual override; log all auto-state changes; GM can review history.

### Risk: Reset commands fail or timeout
**Mitigation**: Retry logic; manual retry button; mark item not-ready with error message; GM can investigate.

### Risk: Alternative selection incorrect
**Mitigation**: Log selection reasons; manual override; condition matching transparent; GM notified of selection.

### Risk: Too many concurrent monitors degrade performance
**Mitigation**: Configurable polling intervals; stagger HTTP polls; monitor resource usage; limit max concurrent monitors.

### Risk: Network partition between PxO and devices
**Mitigation**: Detect offline devices via heartbeat; mark as not-ready; retry connection; log network errors.

---

## Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | 2.1 + 2.2 | Auto-check infra, MQTT integration |
| 2 | 2.3 + 2.4 | Auto-reset, prop alternatives |
| 3 | 2.5 + 2.6 | UI enhancements, testing, docs |

**Total Duration**: 3 weeks (1 developer)

---

## Appendix

### Sample Monitor Configurations

#### MQTT State Monitor (Lights)
```clojure
:monitor-config
{:type :mqtt-state
 :topic "paradox/game/lights/state"
 :ready-condition {:state "idle" :connected true :brightness [:> 0]}
 :timeout-seconds 10
 :reset-command {:topic "paradox/game/lights/commands"
                 :payload {:command "reset" :scene "default"}}}
```

#### HTTP Poll Monitor (Clock Display)
```clojure
:monitor-config
{:type :http-poll
 :url "http://192.168.1.100:3000/health"
 :method "GET"
 :interval-seconds 30
 :ready-condition {:status 200 :body-json {:healthy true :time-sync true}}
 :timeout-seconds 5
 :reset-command {:type :http-post
                 :url "http://192.168.1.100:3000/reset"
                 :payload {:action "reset"}}}
```

#### Script Monitor (Audio System)
```clojure
:monitor-config
{:type :script
 :check-script "/opt/paradox/scripts/check-audio.sh"
 :ready-condition {:exit-code 0 :stdout-contains "All channels active"}
 :timeout-seconds 15
 :reset-command {:type :script
                 :script "/opt/paradox/scripts/reset-audio.sh"
                 :args ["--full-reset"]}}
```

### Sample Alternative Configurations

#### Magic Mirror with Video/Image/Disabled Fallback
```clojure
:alternatives
[{:key "mirror-video"
  :name "Video Mode"
  :description "Play intro video on mirror"
  :priority 1
  :condition {:connected true :video-capable true}
  :config-updates {:mirror-mode "video"
                   :intro-media "intro.mp4"}}
 
 {:key "mirror-static"
  :name "Static Image Mode"
  :description "Show static image"
  :priority 2
  :condition {:connected true}
  :config-updates {:mirror-mode "image"
                   :intro-media "intro.jpg"}}
 
 {:key "mirror-disabled"
  :name "No Mirror (Audio Only)"
  :description "Skip mirror, use audio narration"
  :priority 3
  :condition {}  ; Always matches (fallback)
  :config-updates {:mirror-mode "disabled"
                   :intro-media nil
                   :audio-intro "intro-narration.mp3"}}]
```

#### Lock System with Multiple Locks or Keypad Fallback
```clojure
:alternatives
[{:key "all-locks"
  :name "All Three Locks"
  :description "Standard game with 3 combination locks"
  :condition {:locks-connected 3}
  :config-updates {:lock-mode "triple"
                   :puzzle-difficulty "hard"}}
 
 {:key "two-locks"
  :name "Two Locks (Easier)"
  :description "One lock offline, use 2 locks"
  :condition {:locks-connected 2}
  :config-updates {:lock-mode "double"
                   :puzzle-difficulty "medium"}}
 
 {:key "keypad-fallback"
  :name "Electronic Keypad"
  :description "Locks offline, use electronic keypad"
  :condition {:keypad-connected true}
  :config-updates {:lock-mode "keypad"
                   :puzzle-difficulty "medium"
                   :keypad-code "1234"}}]
```

### Sample Auto-State JSON Log
```json
{
  "event": "auto-state-change",
  "timestamp": "2025-11-07T15:29:58.123Z",
  "room": "houdinis-challenge",
  "item": "lights_ready",
  "type": "auto",
  "previousState": {
    "ready": false,
    "confidence": 0.0,
    "lastChecked": "2025-11-07T15:29:28Z",
    "error": "Connection timeout"
  },
  "newState": {
    "ready": true,
    "confidence": 1.0,
    "lastChecked": "2025-11-07T15:29:58Z",
    "source": "mqtt-state",
    "deviceState": {
      "state": "idle",
      "connected": true,
      "brightness": 80,
      "scene": "default"
    }
  }
}
```

---

**END OF DOCUMENT**
