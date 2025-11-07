# Implementation Plan: Manual Checklist System

**Feature**: Manual checklist system for game master room reset verification  
**Target**: PxO v1.x  
**Date**: November 2025  
**Status**: Planning

---

## Overview

Add a manual checklist system to PxO that allows game masters to verify and document physical prop readiness between games. The checklist is:
- Defined in EDN configuration (`checklist.edn`)
- Presented via a responsive popup web interface
- Coordinated through MQTT messaging
- Tracked using timestamped JSON log files
- Integrated into game state transitions (ready/notready)

This implementation is designed to support future automated checks while providing immediate value for manual verification workflows.

---

## Requirements

### Core Functionality

1. **Checklist Configuration (EDN)**
   - Define checklist items in `checklist.edn` per game/room
   - Each item has: key, short name, description, details (rich content)
   - Items can be enabled/disabled
   - Support for categorization and ordering

2. **Popup Checklist UI**
   - Responsive web page (mobile/tablet/desktop)
   - Inherits style and color scheme from parent control page
   - Dynamically populated from `checklist.edn` via MQTT
   - Read-only mode during active gameplay
   - Editable mode during ready/notready states
   - LocalStorage for draft persistence
   - Actions: Save, Done, Override

3. **Game Control Integration**
   - "Checklist" button always enabled on control pages
   - Opens popup window with checklist UI
   - Button reflects current game state

4. **MQTT Coordination**
   - PxO publishes checklist config and state
   - UI subscribes to config/state, publishes commands
   - Real-time synchronization across multiple users

5. **Game State Integration**
   - After game end, PxO sets state to `notready` if checklist exists
   - Checklist completion sets state to `ready`
   - Override allows game start despite incomplete items
   - Game start flow checks checklist and prompts if not ready

6. **Audit Logging (JSON)**
   - Timestamped JSON files in configurable log directory (e.g., `/opt/paradox/logs/checklists/`)
   - Log directory specified in `pxo.ini` config file
   - Log game starts with override information
   - Log checklist state changes
   - Track who, when, and what changed

### Future Extensibility

- Design MQTT topics and data structures to support automated checks
- Reserve fields in EDN schema for auto-monitoring configuration
- Ensure state management can handle both manual and automated items

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Game Control Page                        │
│  ┌──────────────┐                                           │
│  │  [Checklist] │ ← Always enabled, opens popup             │
│  └──────────────┘                                           │
└────────────────────────┬────────────────────────────────────┘
                         │ window.open()
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   Checklist Popup (HTML/JS)                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Room Reset Checklist                                │   │
│  │ ─────────────────────────────────────────────────── │   │
│  │ ☐ Handcuffs (prop_handcuffs)                       │   │
│  │ ☑ Locks reset (puzzle_locks) ✓ alice, 2:35pm       │   │
│  │ ☐ Lighting (lighting_check)                        │   │
│  │ ─────────────────────────────────────────────────── │   │
│  │ [Save] [Done] [Override]                           │   │
│  └─────────────────────────────────────────────────────┘   │
└────────┬────────────────────────────────────────────────────┘
         │ MQTT (pub/sub)
         ↓
┌─────────────────────────────────────────────────────────────┐
│                        MQTT Broker                           │
└────────┬────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────────┐
│                     PxO (Node.js)                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Checklist Module (src/checklist/)                    │  │
│  │  - config-loader.js   (load checklist.edn)          │  │
│  │  - state-manager.js   (track state, save logs)      │  │
│  │  - mqtt-handler.js    (pub/sub coordination)        │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ State Machine Integration                            │  │
│  │  - Game end → check if checklist exists             │  │
│  │  - Set notready if checklist incomplete              │  │
│  │  - Game start → verify checklist or prompt          │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ JSON Log Writer                                      │  │
│  │  logs/checklist/YYYY-MM-DD_HH-MM-SS_<event>.json    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Checklist Configuration (Startup)
```
1. PxO starts → load checklist.edn
2. Parse EDN into checklist config object
3. Publish to MQTT: paradox/{room}/checklist/config
4. UI subscribes and renders checklist items
```

#### Checklist Interaction (GM fills out checklist)
```
1. GM opens popup (clicks "Checklist" button)
2. UI subscribes to: paradox/{room}/checklist/state
3. PxO publishes current state (last saved state from JSON log)
4. GM checks items, adds notes
5. GM clicks "Save" → UI publishes command to paradox/{room}/checklist/command
6. PxO receives command → validates → saves to JSON log
7. PxO publishes updated state to paradox/{room}/checklist/state
8. UI receives update, shows confirmation
```

#### Game Start Flow (with checklist check)
```
1. User clicks "Start Game" on control page
2. Control page publishes: paradox/{room}/game/commands {"command": "startGame"}
3. PxO receives startGame command
4. PxO checks if checklist exists (checklist.edn loaded?)
   - If no checklist → start game immediately
   - If checklist exists → check last saved state
5. If checklist incomplete:
   a. Build list of not-ready items
   b. Publish to: paradox/{room}/game/pre-start-check
   c. Control page shows modal: "Some items not ready: ..."
   d. Options: "Ignore and Start", "Review Checklist", "Cancel"
6. If "Ignore and Start":
   - Control page publishes: paradox/{room}/checklist/command {"action": "override"}
   - PxO logs override and starts game
7. If "Review Checklist":
   - Open checklist popup
8. If checklist complete or overridden → start game
```

#### Game End Flow (auto-reset prompt)
```
1. Game ends (state → solved/failed/timeout)
2. PxO transitions to resetting state
3. If checklist exists:
   - Set game state to notready
   - Publish: paradox/{room}/game/checklist-required true
4. Control page receives message, enables/highlights "Checklist" button
5. GM opens checklist, completes items, clicks "Done"
6. PxO receives "done" command → sets game state to ready
```

---

## File Structure

```
/opt/paradox/apps/PxO/
├── src/
│   ├── checklist/
│   │   ├── index.js              # Main module exports
│   │   ├── config-loader.js      # Load and parse checklist.edn
│   │   ├── state-manager.js      # Track state, load/save JSON logs
│   │   └── mqtt-handler.js       # MQTT pub/sub for checklist topics
│   ├── game.js                   # [MODIFY] Integrate checklist into game flow
│   └── stateMachine.js           # [MODIFY] Add checklist checks to transitions
├── public/
│   ├── checklist.html            # Popup UI
│   ├── checklist.js              # Popup logic (MQTT, rendering, interactions)
│   └── checklist.css             # Responsive styles
├── config/
│   └── checklist.edn             # [NEW] Checklist item definitions (per game)
├── logs/
│   └── checklists/               # [NEW] Timestamped JSON log files (path from pxo.ini)
│       ├── 2025-11-07_14-30-22_game-started.json
│       ├── 2025-11-07_14-35-10_game-checked.json
│       └── 2025-11-07_15-02-45_game-checked.json
└── docs/
    └── PR_CHECKLIST_MANUAL.md    # This document

/opt/paradox/rooms/{room}/html/
└── index.html                    # [MODIFY] Add "Checklist" button
```

---

## MQTT Topics

### Published by PxO

| Topic | Payload | Description |
|-------|---------|-------------|
| `paradox/{room}/checklist/config` | Checklist config JSON | Checklist items from `checklist.edn` and staff list |
| `paradox/{room}/checklist/state` | Current item states JSON | Latest state of all checklist items, including override flags |
| `paradox/{room}/game/state` | Game state JSON | Existing topic; includes ready/notready |

### Published by UI

| Topic | Payload | Description |
|-------|---------|-------------|
| `paradox/{room}/checklist/state` | Updated state JSON | UI publishes state updates (save/done/override handled via state fields) |

### Topic Details

#### `paradox/{room}/checklist/config`
Published on PxO startup and when config reloads.

```json
{
  "room": "houdinis-challenge",
  "timestamp": "2025-11-07T14:30:00Z",
  "enabled": true,
  "staff": ["alice", "bob", "charlie", "dana"],
  "items": [
    {
      "key": "prop_handcuffs",
      "shortName": "Handcuffs",
      "description": "Houdini's escape handcuffs on table",
      "details": "Check clasp is functional, key is in drawer. <a href='/media/handcuffs.jpg'>Photo</a>",
      "enabled": true,
      "ready": false,
      "category": "props",
      "autoMonitor": false
    },
    {
      "key": "puzzle_locks",
      "shortName": "Combination Locks",
      "description": "Three locks on cabinet, all set to 000",
      "details": "Reset all dials to 000. Check mechanism not jammed.",
      "enabled": true,
      "ready": false,
      "category": "puzzles",
      "autoMonitor": false
    }
  ]
}
```

#### `paradox/{room}/checklist/state`
Published whenever state changes (after save/done/override) or when requested by control page.
UI also publishes to this topic to update state.

```json
{
  "room": "houdinis-challenge",
  "timestamp": "2025-11-07T14:35:22Z",
  "overrideManual": false,
  "overrideAuto": false,
  "items": [
    {
      "key": "prop_handcuffs",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T14:35:00Z",
      "notes": ""
    },
    {
      "key": "puzzle_locks",
      "enabled": true,
      "ready": false,
      "checkedBy": null,
      "checkedAt": null,
      "notes": ""
    }
  ],
  "allReady": false,
  "lastModifiedBy": "alice",
  "lastModifiedAt": "2025-11-07T14:35:00Z"
}
```

**Key Fields**:
- `overrideManual` — Boolean (default `false`); set to `true` when user chooses "Ignore and Start" for manual items; reset to `false` on any check operation
- `overrideAuto` — Boolean (default `false`); set to `true` when user chooses to override auto checks (Phase 2); reset to `false` on any check operation
- `items[].enabled` — Boolean; item is visible and active in checklist
- `items[].ready` — Boolean; item has been checked and is ready

**Filtering Not-Ready Items**:
Control pages and PxO can filter `items` where `ready === false` and `enabled === true` to build the not-ready list on-the-fly.

**Note**: The `paradox/{room}/checklist/command` topic has been removed. UI actions (Save, Done, Override, Cancel) are handled via UI logic that updates and publishes to `paradox/{room}/checklist/state`. The `overrideManual` and `overrideAuto` fields in the state payload handle override semantics.

**UI Button Actions**:
- **Save** — UI updates item states (ready, notes, checkedBy, checkedAt), publishes updated state; if any manual items not ready, sets `overrideManual: false`
- **Done** — UI marks all items ready, publishes state; PxO sets game state to `ready`
- **Override** — UI sets `overrideManual: true` (or `overrideAuto: true` for auto items in Phase 2), publishes state; game start proceeds despite incomplete items
- **Cancel** — UI discards changes, does not publish

---

## EDN Schema

### checklist.edn

File location: `/opt/paradox/apps/PxO/config/checklist.edn` (or per-room in `/opt/paradox/rooms/{room}/config/checklist.edn`)

```clojure
{:checklist
 {:enabled true
  
  ;; Staff list: Load from external file or define inline
  ;; If :staff-file is specified, load names from that file (one name per line)
  ;; Otherwise use :staff vector
  :staff-file "config/staff.txt"  ; Optional: load staff from file
  ;; :staff ["alice" "bob" "charlie" "dana"]  ; Alternative: inline staff list
  
  ;; Optional: Categories for grouping items in UI
  :categories ["props" "puzzles" "technical" "audio-visual"]
  
  ;; Checklist items
  :items
  [
   ;; Manual check item (Phase 1)
   {:key "prop_handcuffs"
    :short-name "Handcuffs"
    :description "Houdini's escape handcuffs on table"
    :details "Check clasp is functional, key is in drawer. <a href='/media/handcuffs.jpg' target='_blank'>Photo</a>"
    :enabled true
    :ready false
    :category "props"
    :auto-monitor false}  ; Reserved for Phase 2
   
   {:key "puzzle_locks"
    :short-name "Combination Locks"
    :description "Three locks on cabinet, all set to 000"
    :details "Reset all dials to 000. Check mechanism not jammed. <img src='/media/locks.jpg' style='max-width: 300px;'>"
    :enabled true
    :ready false
    :category "puzzles"
    :auto-monitor false}
   
   {:key "lighting_check"
    :short-name "Room Lighting"
    :description "All lights functional"
    :details "<p>Turn on all zones, check for burnt bulbs.</p><ul><li>Zone 1: Main overhead</li><li>Zone 2: Cabinet</li><li>Zone 3: UV lights</li></ul>"
    :enabled true
    :ready false
    :category "technical"
    :auto-monitor false}
   
   {:key "audio_system"
    :short-name "Audio System"
    :description "Speakers and audio playback working"
    :details "Play test track, verify all speakers active. Volume at 70%."
    :enabled true
    :ready false
    :category "audio-visual"
    :auto-monitor false}
   
   ;; Item can be disabled/enabled by user (always visible)
   {:key "optional_prop"
    :short-name "Optional Prop"
    :description "This prop can be enabled or disabled"
    :enabled false
    :ready false
    :category "props"
    :auto-monitor false}
  ]}}
```

**Example staff.txt**:
```
alice
bob
charlie
dana
```

**Field Descriptions**:
- `:key` — Unique identifier (kebab-case recommended)
- `:short-name` — Display name (few words)
- `:description` — One-sentence description
- `:details` — Rich HTML content (paragraphs, images, links, videos)
- `:enabled` — Boolean; item is visible and active in checklist (always visible to user, can be toggled)
- `:ready` — Boolean; item has been checked and is ready (user toggles this)
- `:category` — Optional category for grouping
- `:auto-monitor` — Reserved for Phase 2 (automated checks)

**Staff List**:
The checklist config can optionally load a staff list from `staff.txt` (one name per line) or define staff inline in EDN. This list populates a dropdown for the "checked by" field in the UI.

---

## JSON Log Format

### Log File Naming

Log directory configured in `pxo.ini` (e.g., `/opt/paradox/logs/checklists/`)

Pattern: `YYYY-MM-DD_HH-MM-SS_<event-type>.json`

Examples:
- `2025-11-07_14-30-22_game-started.json`
- `2025-11-07_14-35-10_game-checked.json`
- `2025-11-07_15-02-45_game-checked.json`

### Event Types

#### game-started
Logged when game is allowed to proceed. Contains full checklist state at game start time, including any overrides.

```json
{
  "event": "game-started",
  "timestamp": "2025-11-07T15:02:45Z",
  "room": "houdinis-challenge",
  "gm": "alice",
  "overrideManual": true,
  "overrideAuto": false,
  "items": [
    {
      "key": "prop_handcuffs",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T15:02:30Z",
      "notes": ""
    },
    {
      "key": "puzzle_locks",
      "enabled": true,
      "ready": false,
      "checkedBy": null,
      "checkedAt": null,
      "notes": "Key missing from drawer"
    },
    {
      "key": "lighting_check",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T15:02:35Z",
      "notes": ""
    },
    {
      "key": "audio_system",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T15:02:40Z",
      "notes": ""
    }
  ],
  "allReady": false
}
```

#### game-checked
Logged whenever automatic or manual checklist state is updated (save, end-of-game check, etc.). Contains full state snapshot.

```json
{
  "event": "game-checked",
  "timestamp": "2025-11-07T14:35:10Z",
  "room": "houdinis-challenge",
  "gm": "alice",
  "trigger": "manual-save",
  "overrideManual": false,
  "overrideAuto": false,
  "items": [
    {
      "key": "prop_handcuffs",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T14:35:05Z",
      "notes": ""
    },
    {
      "key": "puzzle_locks",
      "enabled": true,
      "ready": false,
      "checkedBy": null,
      "checkedAt": null,
      "notes": "Key missing from drawer"
    },
    {
      "key": "lighting_check",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T14:35:08Z",
      "notes": ""
    },
    {
      "key": "audio_system",
      "enabled": true,
      "ready": true,
      "checkedBy": "alice",
      "checkedAt": "2025-11-07T14:35:09Z",
      "notes": ""
    }
  ],
  "allReady": false
}
```

**Trigger Values**:
- `manual-save` — GM clicked Save in UI
- `game-end` — Automatic check at end of game
- `auto-check` — Automated monitoring update (Phase 2)

---

## Implementation Plan

### Phase 1.1: Core Infrastructure (Week 1)

**Goal**: Set up checklist module structure and EDN loading.

#### Tasks

1. **Create checklist module structure**
   - Create `src/checklist/` directory
   - Create `src/checklist/index.js` (main exports)
   - Create `src/checklist/config-loader.js`
   - Create `src/checklist/state-manager.js`
   - Create `src/checklist/mqtt-handler.js`

2. **Implement config-loader.js**
   - Load `checklist.edn` using existing EDN parser
   - Parse and validate schema
   - Load staff list from `staff.txt` if `:staff-file` specified, otherwise use inline `:staff` vector
   - Export config object with staff list
   - Add error handling for missing/invalid files

3. **Implement state-manager.js**
   - Initialize empty state structure
   - Read log directory path from `pxo.ini` config
   - `loadLatestState()` — read most recent JSON log
   - `saveState(event, gm, items, overrides, trigger)` — write timestamped JSON log to configured directory
   - `getState()` — return current state including override flags
   - `isAllReady()` — check if all enabled items are ready
   - `updateOverrideFlags(items)` — set `overrideManual`/`overrideAuto` based on not-ready items
   - Create log directory if not exists (e.g., `/opt/paradox/logs/checklists/`)

4. **Create sample checklist.edn**
   - Create example config for Houdini's Challenge
   - Include 4-6 sample items with rich details
   - Test EDN parsing

5. **Write unit tests**
   - Test config loading (valid, invalid, missing files)
   - Test state persistence (save/load JSON)
   - Test state queries (isAllReady, getState)

**Deliverables**:
- `src/checklist/index.js`
- `src/checklist/config-loader.js`
- `src/checklist/state-manager.js`
- `config/checklist.edn` (sample)
- Unit tests in `test/checklist/`

---

### Phase 1.2: MQTT Integration (Week 1)

**Goal**: Enable MQTT communication for checklist coordination.

#### Tasks

1. **Implement mqtt-handler.js**
   - Initialize MQTT topics (config, state, command, response)
   - `publishConfig(config)` — publish checklist config
   - `publishState(state)` — publish current state
   - `subscribeToCommands(callback)` — listen for UI commands
   - `publishResponse(result)` — send ack/error

2. **Integrate with PxO startup**
   - Modify `src/game.js` to load checklist module
   - Load checklist config on startup
   - Publish config to MQTT
   - Subscribe to checklist commands
   - Add logging for checklist events

3. **Implement state update handlers**
   - Subscribe to `checklist/state` topic (published by UI)
   - Validate incoming state updates
   - Check for not-ready items and update `overrideManual`/`overrideAuto` flags
   - Save state to JSON log (`game-checked` event)
   - Trigger game state changes (e.g., set to `ready` when all items ready)
   - Re-publish validated state to MQTT

4. **Test MQTT communication**
   - Use MQTT client (e.g., MQTT Explorer) to verify topics
   - Publish test commands, verify responses
   - Check JSON log creation

**Deliverables**:
- `src/checklist/mqtt-handler.js`
- Modified `src/game.js` with checklist integration
- MQTT topic documentation
- Integration tests

---

### Phase 1.3: Popup UI (Week 2)

**Goal**: Build responsive checklist popup interface.

#### Tasks

1. **Create checklist.html**
   - Responsive layout (mobile-first)
   - **Inherit style and color scheme from parent control page** (via CSS variables or link to parent stylesheet)
   - Header with room name and timestamp
   - Checklist items grid/list
   - Staff dropdown (populated from config)
   - Action buttons: Save, Done, Override, Cancel
   - Status indicator (ready/not ready)
   - Read-only mode styling

2. **Create checklist.css**
   - **Inherit parent control page CSS variables for colors, fonts, spacing**
   - Mobile-friendly styles (touch targets 44px+)
   - Tablet and desktop responsive breakpoints
   - Item cards with checkboxes for `enabled` and `ready`, name, description
   - Expandable details section (click to expand)
   - Button states (enabled/disabled/loading)
   - Color coding (ready=green, not-ready=red, partial=yellow)

3. **Create checklist.js**
   - MQTT.js integration (WebSocket connection)
   - Subscribe to `checklist/config` and render items (including staff dropdown)
   - Subscribe to `checklist/state` and update UI
   - **Publish updated state to `checklist/state`** (no separate command topic)
   - LocalStorage for draft state (preserve across popup close/reopen)
   - Handle read-only vs editable modes based on game state
   - Show last checked user and timestamp per item
   - Notes field per item
   - Filter not-ready items on-the-fly from state

4. **Implement UI interactions**
   - Toggle `enabled` and `ready` checkboxes per item
   - Select staff member from dropdown
   - Add notes to items
   - Expand/collapse details
   - **Save button** → update item states, set `overrideManual: false` if any manual items not ready, publish to `checklist/state`, log `game-checked`
   - **Done button** → mark all enabled items ready, set `overrideManual: false`, publish state, PxO sets game state to `ready`
   - **Override button** → set `overrideManual: true`, publish state, log `game-started` (if game starting)
   - **Cancel button** → discard changes, close popup
   - Show loading spinner during state publish
   - Show success/error messages

5. **Test on devices**
   - Test on iPad (Safari)
   - Test on iPhone (Safari)
   - Test on desktop (Chrome, Firefox)
   - Verify touch interactions
   - Verify MQTT reconnection on network loss

**Deliverables**:
- `public/checklist.html`
- `public/checklist.js`
- `public/checklist.css`
- UI testing checklist

---

### Phase 1.4: Game State Integration (Week 2)

**Goal**: Integrate checklist into game state machine.

#### Tasks

1. **Modify stateMachine.js**
   - Add checklist check to state transitions
   - After game end → check if checklist exists
   - If checklist exists → set state to `notready`
   - If no checklist or all ready → set state to `ready`
   - Add `checklist-ready` event trigger

2. **Implement pre-game-start check**
   - Modify game start handler in `src/game.js`
   - Before starting game, check checklist state
   - If incomplete items:
     - Build not-ready list
     - Publish to `game/pre-start-check`
     - Wait for override or checklist completion
   - If override received → log and start game
   - If all ready → start game immediately

3. **Add checklist state queries to game status**
   - Include checklist ready/not-ready in game status MQTT messages
   - Publish `game/checklist-required` when checklist needs attention
   - Add checklist summary to game heartbeat

4. **Test state transitions**
   - Test game end with checklist → should go to notready
   - Test game end without checklist → should go to ready
   - Test game start with incomplete checklist → should prompt
   - Test override flow → should start game and log
   - Test done flow → should set ready and allow start

**Deliverables**:
- Modified `src/stateMachine.js`
- Modified `src/game.js`
- State transition tests
- Integration testing document

---

### Phase 1.5: Control Page Integration (Week 3)

**Goal**: Add "Checklist" button to game control pages.

#### Tasks

1. **Add button to control page**
   - Modify `/opt/paradox/rooms/houdinis-challenge/html/index.html`
   - Add "Checklist" button (always enabled)
   - Add JavaScript to open popup: `window.open('/checklist.html?room=houdinis-challenge', 'checklist', 'width=800,height=600')`

2. **Subscribe to game state in control page**
   - Subscribe to `paradox/{room}/game/state`
   - When state is `ready` or `notready` → enable edit mode hint
   - When state is other → show read-only hint
   - Optional: Highlight button when `checklist-required` is true

3. **Implement pre-start-check modal**
   - Subscribe to `paradox/{room}/checklist/state`
   - **Filter not-ready items on-the-fly** (where `ready === false` and `enabled === true`)
   - Show modal when game start requested and not-ready items exist
   - Display list of not-ready items
   - Buttons: "Ignore and Start", "Review Checklist", "Cancel"
   - **"Ignore and Start"** → update state with `overrideManual: true`, publish to `checklist/state`, PxO logs `game-started` and starts game
   - "Review Checklist" → open checklist popup
   - "Cancel" → close modal, do not start game

4. **Test control page integration**
   - Verify button always enabled
   - Verify popup opens correctly
   - Verify pre-start modal shows when expected
   - Test override flow from modal
   - Test review flow from modal

**Deliverables**:
- Modified control page HTML
- Control page JavaScript updates
- User testing checklist

---

### Phase 1.6: Testing & Documentation (Week 3)

**Goal**: Comprehensive testing and operator documentation.

#### Tasks

1. **Unit tests**
   - config-loader tests (valid/invalid/missing EDN)
   - state-manager tests (save/load/query)
   - mqtt-handler tests (publish/subscribe/commands)

2. **Integration tests**
   - Full game flow with checklist (start, play, end, reset)
   - Override flow
   - Multi-user scenarios (two GMs editing simultaneously)
   - Network interruption recovery

3. **Manual QA checklist**
   - [ ] Checklist loads correctly from EDN
   - [ ] Popup UI renders all items
   - [ ] Items can be checked/unchecked
   - [ ] Notes can be added
   - [ ] Details expand/collapse
   - [ ] Save button saves state
   - [ ] Done button marks ready and updates game state
   - [ ] Override button logs override and allows game start
   - [ ] Read-only mode works during gameplay
   - [ ] Editable mode works during ready/notready
   - [ ] Control page button opens popup
   - [ ] Pre-start modal shows incomplete items
   - [ ] JSON logs created with correct timestamps
   - [ ] MQTT sync works across multiple devices
   - [ ] LocalStorage preserves drafts

4. **Write operator documentation**
   - How to edit checklist.edn
   - How to add/remove/disable items
   - How to use the checklist UI
   - How to interpret JSON logs
   - Troubleshooting guide

5. **Write developer documentation**
   - MQTT topic reference
   - EDN schema reference
   - JSON log format reference
   - API documentation for checklist module
   - Extension points for Phase 2

**Deliverables**:
- Unit test suite
- Integration test suite
- Manual QA checklist (completed)
- `CHECKLIST_USER_GUIDE.md`
- `CHECKLIST_DEVELOPER_GUIDE.md`

---

## API Reference (Module Exports)

### src/checklist/index.js

```javascript
const checklistModule = {
  // Initialize checklist system
  async initialize(mqttClient, config, logger) { },
  
  // Get current checklist config
  getConfig() { },
  
  // Get current checklist state
  getState() { },
  
  // Check if all items ready
  isAllReady() { },
  
  // Get not-ready items
  getNotReadyItems() { },
  
  // Handle command from UI
  async handleCommand(command) { },
  
  // Reload config from disk
  async reloadConfig() { }
};
```

### src/checklist/config-loader.js

```javascript
module.exports = {
  // Load and parse checklist.edn
  loadConfig(filePath) { },
  
  // Validate config schema
  validateConfig(config) { },
  
  // Get enabled items only
  getEnabledItems(config) { }
};
```

### src/checklist/state-manager.js

```javascript
module.exports = {
  // Initialize state manager with log directory from pxo.ini
  initialize(logDirectory) { },
  
  // Load latest state from JSON logs
  loadLatestState() { },
  
  // Save state to JSON log (game-started or game-checked)
  async saveState(event, gm, items, overrideManual, overrideAuto, trigger) { },
  
  // Get current state (includes override flags)
  getState() { },
  
  // Update item state
  updateItem(key, enabled, ready, notes, checkedBy) { },
  
  // Check if all enabled items ready
  isAllReady() { },
  
  // Get not-ready items (filter enabled=true, ready=false)
  getNotReadyItems() { },
  
  // Update override flags based on not-ready items
  updateOverrideFlags(items) { }
};
```

### src/checklist/mqtt-handler.js

```javascript
module.exports = {
  // Initialize MQTT handler
  initialize(mqttClient, baseTopic, logger) { },
  
  // Publish checklist config (includes staff list)
  publishConfig(config) { },
  
  // Publish current state (includes override flags)
  publishState(state) { },
  
  // Subscribe to state updates from UI
  subscribeToStateUpdates(callback) { },
  
  // Filter not-ready items from state
  getNotReadyItems(state) { }
};
```

---

## Testing Strategy

### Unit Tests (Jest)

**config-loader.test.js**:
- Load valid EDN config
- Handle missing file gracefully
- Handle invalid EDN syntax
- Filter disabled items
- Validate required fields

**state-manager.test.js**:
- Initialize empty state
- Save state to JSON log
- Load state from JSON log
- Update individual items
- Check all-ready logic
- Get not-ready items

**mqtt-handler.test.js**:
- Publish config to correct topic
- Publish state with correct format
- Subscribe to command topic
- Handle command callbacks
- Publish responses

### Integration Tests

**game-flow.test.js**:
1. Start PxO with checklist enabled
2. Load checklist config
3. Verify MQTT config published
4. Submit save command via MQTT
5. Verify state updated and logged
6. End game, verify state → notready
7. Submit done command
8. Verify state → ready

**override-flow.test.js**:
1. Start game with incomplete checklist
2. Verify pre-start-check published
3. Submit override command
4. Verify game starts and override logged

**multi-user.test.js**:
1. Two simulated UI clients
2. Both subscribe to state
3. Client A updates item
4. Verify Client B receives update
5. Client B updates different item
6. Verify Client A receives update

### Manual QA Checklist

Performed by human tester on real devices:

- [ ] **Config Loading**
  - [ ] Valid EDN loads without errors
  - [ ] Invalid EDN shows error message
  - [ ] Disabled items not shown in UI

- [ ] **Popup UI**
  - [ ] Opens in popup window
  - [ ] Renders all enabled items
  - [ ] Responsive on phone (320px width)
  - [ ] Responsive on tablet (768px width)
  - [ ] Responsive on desktop (1920px width)

- [ ] **Item Interactions**
  - [ ] Check/uncheck toggles state
  - [ ] Notes field saves text
  - [ ] Details expand on click
  - [ ] Details collapse on second click
  - [ ] Timestamp updates when checked

- [ ] **Action Buttons**
  - [ ] Save button saves draft
  - [ ] Done button enables only when all checked
  - [ ] Override button shows confirmation
  - [ ] Buttons disabled during processing

- [ ] **Game State Integration**
  - [ ] Read-only mode during gameplay
  - [ ] Editable mode during ready/notready
  - [ ] Control page button always enabled
  - [ ] Pre-start modal shows incomplete items
  - [ ] Override from modal starts game

- [ ] **Logging**
  - [ ] JSON files created in configured log directory (from pxo.ini)
  - [ ] Timestamps correct
  - [ ] Event types correct (game-started, game-checked)
  - [ ] All fields populated (including overrideManual/overrideAuto)
  - [ ] Staff list loaded from staff.txt or inline EDN

- [ ] **MQTT Sync**
  - [ ] Changes sync across devices
  - [ ] Reconnects after network loss
  - [ ] No duplicate messages

- [ ] **LocalStorage**
  - [ ] Draft saved when popup closed
  - [ ] Draft restored when popup reopened
  - [ ] Draft cleared after submission

---

## Future Extensions (Phase 2 Preview)

This implementation is designed to support automated checks in Phase 2:

### Reserved Fields
- `:auto-monitor` in EDN (currently always `false`)
- `type` field in JSON logs (`"manual"` or `"auto"`)
- `autoMonitor` in MQTT config

### Extension Points
- `auto-checks.js` module (to be created in Phase 2)
- MQTT state subscriptions for device monitoring
- Automated state polling logic
- Prop alternative selection based on device state

### Compatibility
- All Phase 1 code is forward-compatible with Phase 2
- Manual items continue to work unchanged
- Automated items will be mixed into the same checklist
- UI will distinguish manual vs auto items visually

---

## Success Criteria

### Functional Requirements
- ✅ Checklist items defined in EDN
- ✅ Popup UI displays all enabled items
- ✅ Items can be checked/unchecked with notes
- ✅ Save/Done/Override actions work correctly
- ✅ Read-only mode during active gameplay
- ✅ Game state transitions to notready after game end
- ✅ Pre-start check prompts when checklist incomplete
- ✅ JSON logs created with correct data
- ✅ MQTT synchronization across devices

### Non-Functional Requirements
- ✅ UI responsive on mobile/tablet/desktop
- ✅ MQTT messages < 10KB
- ✅ JSON log files < 50KB each
- ✅ UI loads in < 2 seconds
- ✅ Command processing < 500ms
- ✅ Works offline (LocalStorage fallback)

### User Experience
- ✅ Game masters can complete checklist in < 2 minutes
- ✅ Checklist button always accessible
- ✅ Clear visual feedback for ready/not-ready
- ✅ Intuitive action buttons
- ✅ No data loss on network interruption

---

## Risk Mitigation

### Risk: MQTT broker unavailable
**Mitigation**: UI uses LocalStorage as fallback; shows warning banner; retries connection.

### Risk: Concurrent edits by multiple GMs
**Mitigation**: Last-write-wins; show last editor and timestamp; MQTT broadcasts keep all UIs in sync.

### Risk: JSON log directory fills disk
**Mitigation**: Implement log rotation (archive logs older than 30 days); document in operator guide.

### Risk: EDN config syntax errors
**Mitigation**: Validate on load; log errors; gracefully disable checklist if invalid; provide sample config.

### Risk: Large details field (images/video) in EDN
**Mitigation**: Use external URLs, not inline base64; lazy-load images in UI; document best practices.

---

## Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | 1.1 + 1.2 | Core module, MQTT integration |
| 2 | 1.3 + 1.4 | Popup UI, game state integration |
| 3 | 1.5 + 1.6 | Control page integration, testing, docs |

**Total Duration**: 3 weeks (1 developer)

---

## Appendix

### Sample MQTT Message Flows

#### Startup Flow
```
1. PxO → paradox/houdinis-challenge/checklist/config
   {config with items and staff list}

2. UI subscribes and renders items (including staff dropdown)

3. PxO → paradox/houdinis-challenge/checklist/state
   {last saved state or empty, includes overrideManual/overrideAuto flags}

4. UI displays current state
```

#### Save Flow
```
1. GM checks items, adds notes, selects staff, clicks Save

2. UI updates local state, checks for not-ready items
   - If any manual items not ready → set overrideManual: false

3. UI → paradox/houdinis-challenge/checklist/state
   {updated state with items, overrideManual, overrideAuto, gm, timestamp}

4. PxO receives state update, validates, saves JSON log (game-checked event)

5. PxO → paradox/houdinis-challenge/checklist/state
   {validated state re-published}

6. UI receives confirmation, shows success message
```

#### Game Start Flow (Incomplete Checklist)
```
1. Control page → paradox/houdinis-challenge/game/commands
   {"command": "startGame"}

2. PxO subscribes to checklist/state, filters not-ready items on-the-fly
   (items where enabled=true and ready=false)

3. If not-ready items exist and overrideManual=false:
   Control page detects not-ready items, shows modal with options

4a. User clicks "Ignore and Start":
    Control page updates state: overrideManual = true
    Control page → paradox/houdinis-challenge/checklist/state
    
    PxO logs game-started (with override) and starts game

4b. User clicks "Review Checklist":
    Control page opens checklist popup

4c. User clicks "Cancel":
    Close modal, do not start game
```

### Sample JSON Log Files

**logs/checklists/2025-11-07_14-30-22_game-started.json**:
```json
{
  "event": "game-started",
  "timestamp": "2025-11-07T14:30:22.123Z",
  "room": "houdinis-challenge",
  "gm": "alice",
  "overrideManual": false,
  "overrideAuto": false,
  "items": [
    {"key": "prop_handcuffs", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:30:10Z"},
    {"key": "puzzle_locks", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:30:15Z"},
    {"key": "lighting_check", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:30:18Z"},
    {"key": "audio_system", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:30:20Z"}
  ],
  "allReady": true
}
```

**logs/checklists/2025-11-07_14-35-10_game-checked.json**:
```json
{
  "event": "game-checked",
  "timestamp": "2025-11-07T14:35:10.456Z",
  "room": "houdinis-challenge",
  "gm": "alice",
  "trigger": "manual-save",
  "overrideManual": false,
  "overrideAuto": false,
  "items": [
    {"key": "prop_handcuffs", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:35:05Z"},
    {"key": "puzzle_locks", "enabled": true, "ready": false, "notes": "Key missing", "checkedBy": null, "checkedAt": null},
    {"key": "lighting_check", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:35:08Z"},
    {"key": "audio_system", "enabled": true, "ready": true, "notes": "", "checkedBy": "alice", "checkedAt": "2025-11-07T14:35:09Z"}
  ],
  "allReady": false
}
```

---

**END OF DOCUMENT**
