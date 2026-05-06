# PR Plan: Gameplay Logging Stream (No Code Yet)

**Status**: Planning only (do not implement until reviewed)
**Target**: PxO
**Date**: 2026-04-19

## Purpose

Add a second, analytics-focused gameplay logging stream (JSONL) alongside the existing PxO logger, designed for timeline and player-progress analysis.

This document is the implementation contract and checklist for the future code PR.

## Locked Decisions From Review

1. Enable gameplay logging only when path + switch rules pass:
   - INI requires both:
     - `game_log_path` points to valid directory (create if missing)
     - `game_logging` is `true` or `on`
   - CLI override:
     - `--game_log_path <dir>` overrides INI and forces gameplay logging on.
2. If resolved gameplay log directory is invalid/unwritable, startup must **hard fail**.
3. Log file is created only when intro phase successfully completes and gameplay starts.
4. Start timestamp origin is when the accepted `start` command is received.
5. File naming format is strictly:
   - `<ednBase>-YYYYMMDD-HH-MM-SS.jsonl`
6. No run ID in filename. Instead, reject/ignore a second start within 2 seconds of first accepted start to avoid collisions.
7. Include malformed/unknown commands as rejected events in gameplay log.
8. Chat logging requires INI topics to be configured and stores full chat content.
9. Sensor deadband/ignore rules are EDN per-sensor settings:
   - deadband thresholds where applicable (for analog/noisy inputs)
   - `ignore_logging` support (`true`/`yes`)
10. Include player-identifying text if available.
11. Mode + EDN identity are logged at start and when they change, not in every record.

## Timestamp and Record Requirements

Each JSONL event record must include:

1. `wall_time` (24-hour time, no date, format `HH:MM:SS.hh`)
2. `game_time_remaining` (MM:SS.hh or integer milliseconds remaining; choose one and document)
3. `event_type`
4. `payload` (event-specific data)

Additional timing rules:

1. Treat accepted `start` command time as the run origin, but `game_time_remaining` starts at the configured gameplay phase duration (for example `60:00.00`) and counts down.
2. `game_time_remaining` must reflect pauses and manual time adjustments (not simple wall clock subtraction).

## File Layout and Header Records

When gameplay begins (intro complete), create file and write header/meta records first:

1. `session_header`
   - EDN base name
   - initial game mode
   - accepted start command info
2. `session_config`
   - logger version/schema version
   - key topic references used for capture (commands/chat/sensors)

Then append ongoing event records as JSONL.

## Event Capture Scope

### Must Capture

1. All inbound game commands, including:
   - start (initial), pause, resume, solve, fail, executeHint/hint, triggerPhase
   - external commands that cause light/prop actions via PxO command intake
2. Command outcomes:
   - accepted
   - rejected (with reason)
   - malformed payload details (bounded/truncated if needed)
3. Phase transitions (intro, gameplay, solved, failed, reset, etc.)
4. Game end trigger event (`win`/`fail` outcome)
5. Scheduled cues/sequences that belong to gameplay phase scheduling
6. Top-level gameplay/control sequence start/end events
7. Sensor input changes and prop triggers:
   - honor per-sensor deadband and `ignore_logging`
8. PxT two-way chat:
   - `chat_to_player`
   - `chat_from_player`
   - full message text

### Must Exclude

1. `/state` periodic heartbeat/state snapshots
2. `/warnings` stream events
3. Individual internal commands emitted by running sequences
4. Nested sequence internals, except gameplay-phase-defined top-level sequence lifecycle events

## Pending Technical Clarification to Lock Before Coding

`game_time_remaining` is locked to string format `MM:SS.hh`.

## Proposed JSONL Event Types (Initial Set)

1. `session_header`
2. `session_config`
3. `command_received`
4. `command_rejected`
5. `command_applied`
6. `phase_transition`
7. `sequence_started`
8. `sequence_completed`
9. `schedule_fired`
10. `hint_executed`
11. `sensor_changed`
12. `chat_to_player`
13. `chat_from_player`
14. `game_end_triggered`
15. `mode_changed`
16. `edn_identity_changed`
17. `session_summary`

## Implementation Task Checklist (Code)

### A. Bootstrap and Config

- [ ] Add CLI option `--game_log_path` in startup arg parsing.
- [ ] Extend INI loader to parse `game_logging`, `game_log_path`, `chat_to_player`, `chat_from_player`.
- [ ] Resolve effective gameplay log directory with precedence rules.
- [ ] Ensure path creation (`mkdir -p` behavior).
- [ ] Add hard-fail startup behavior for invalid/unwritable resolved gameplay log path.

### B. Gameplay Log Writer

- [ ] Add dedicated gameplay logger module (JSONL writer).
- [ ] Implement filename generation `<ednBase>-YYYYMMDD-HH-MM-SS.jsonl`.
- [ ] Add intro-buffer mode and delayed file creation until gameplay starts.
- [ ] Add buffered flush on gameplay start.
- [ ] Add discard behavior for false starts that never enter gameplay.
- [ ] Add 2-second start lockout logic to prevent duplicate starts/collision.

### C. Event Instrumentation

- [ ] Hook inbound command intake (accepted/rejected/malformed).
- [ ] Hook phase transitions and end triggers.
- [ ] Hook gameplay schedule firing points.
- [ ] Hook top-level gameplay/control sequence lifecycle start/end.
- [ ] Ensure nested sequence commands are not logged.
- [ ] Hook hints.
- [ ] Hook sensor/trigger input changes with deadband and ignore rules.
- [ ] Hook chat topics with full content capture.

### D. Sensor Logging Rules

- [ ] Add EDN schema fields per sensor:
  - [ ] `ignore_logging`
  - [ ] deadband config for analog/noisy values
- [ ] Implement deadband evaluator and suppression logic.
- [ ] Implement no-log behavior when `ignore_logging` is enabled.

### E. End-of-Session

- [ ] Emit `session_summary` on run completion/reset path.
- [ ] Include player-identifying text when available in payloads.

## Document Update Checklist

- [ ] Update [docs/CONFIG_INI.md](docs/CONFIG_INI.md):
  - [ ] `game_logging`
  - [ ] `game_log_path`
  - [ ] `chat_to_player`
  - [ ] `chat_from_player`
  - [ ] CLI precedence and hard-fail behavior
- [ ] Update [docs/CLI.md](docs/CLI.md):
  - [ ] `--game_log_path`
  - [ ] precedence examples
  - [ ] startup failure conditions
- [ ] Update [docs/CONFIG_EDN.md](docs/CONFIG_EDN.md):
  - [ ] per-sensor `ignore_logging`
  - [ ] per-sensor deadband settings and examples
- [ ] Update [docs/MQTT_API.md](docs/MQTT_API.md):
  - [ ] chat topic requirements for logging
  - [ ] what gameplay logger consumes vs ignores
- [ ] Update [docs/SPEC.md](docs/SPEC.md):
  - [ ] gameplay logging scope
  - [ ] include/exclude rules
  - [ ] timing semantics
- [ ] Add a new operator-facing section in [docs/USER_GUIDE.md](docs/USER_GUIDE.md):
  - [ ] where files are written
  - [ ] how to read JSONL entries
  - [ ] false-start behavior

## Automated Test Checklist

### Unit Tests

- [ ] INI parsing tests for gameplay logging keys and booleans (`true/on`, `false/off`).
- [ ] CLI parsing tests for `--game_log_path` precedence.
- [ ] Path validation tests for hard-fail cases.
- [ ] Filename format tests (EDN base + timestamp).
- [ ] 2-second start lockout tests.
- [ ] JSONL record serializer tests (`wall_time`, `game_time_remaining`, payload schema).
- [ ] Deadband evaluator tests (analog threshold, edge transitions, ignore flag).

### Integration Tests

- [ ] Start -> intro -> gameplay creates log file and flushes buffered start events.
- [ ] Start -> abort/reset during intro does not create gameplay log file.
- [ ] Malformed command generates `command_rejected` record.
- [ ] Unknown command generates `command_rejected` record.
- [ ] Pause/resume/time adjust produce correct `game_time_remaining` progression.
- [ ] Gameplay schedule firing recorded; nested/internal sequence commands excluded.
- [ ] Chat topics logged only when INI chat topics configured.

### Regression/Safety Tests

- [ ] Existing plain PxO logger behavior unchanged.
- [ ] Existing warnings/state MQTT behavior unchanged.
- [ ] No duplicate event amplification from shared MQTT listeners.

## Manual Test Checklist (Post-Implementation)

Use this checklist at final validation time.

### Setup

- [ ] Configure INI with valid `game_logging=true` and `game_log_path`.
- [ ] Configure chat topics (`chat_to_player`, `chat_from_player`).
- [ ] Verify EDN has at least one gameplay schedule cue/sequence and one sensor with deadband config.

### Startup and Validation

- [ ] Start PxO with invalid gameplay path and confirm startup hard-fails.
- [ ] Start PxO with valid path and confirm no gameplay file exists before game start.

### Start and Intro Behavior

- [ ] Send start command and confirm timing origin is set.
- [ ] Confirm no gameplay log file is created during intro.
- [ ] Trigger second start within 2 seconds and confirm lockout behavior.

### Gameplay Commit

- [ ] Let intro complete and transition to gameplay.
- [ ] Confirm file is created with format `<ednBase>-YYYYMMDD-HH-MM-SS.jsonl`.
- [ ] Confirm first lines include mode + EDN identity headers.

### Event Content

- [ ] Send commands: pause, resume, solve/fail, executeHint, triggerPhase.
- [ ] Confirm command accepted/rejected records are present with reasons.
- [ ] Confirm phase transition records exist.
- [ ] Confirm gameplay schedule events exist.
- [ ] Confirm nested sequence internal commands are absent.
- [ ] Confirm warnings/state heartbeat entries are absent.

### Sensor and Trigger Logging

- [ ] Exercise boolean/discrete sensor changes and verify records.
- [ ] Exercise analog noisy sensor and verify deadband suppression behavior.
- [ ] Set one sensor `ignore_logging=true` and confirm no records for it.

### Chat Logging

- [ ] Send player-bound and player-originated chat messages.
- [ ] Confirm full message content is captured in JSONL.

### Timing Semantics

- [ ] During pause, verify wall time advances while game time remaining does not decrement.
- [ ] Perform time adjustment and verify remaining game time shifts correctly.

### End of Session

- [ ] End game with solve/fail and confirm session summary record exists.
- [ ] Confirm player-identifying text (if present in events) is retained.

## Acceptance Criteria

1. Behavior matches all locked decisions in this document.
2. No gameplay file is created for false starts that do not reach gameplay.
3. No state/warning/noisy sequence-internal events in gameplay JSONL.
4. Timing fields are consistent under pause and time adjustment.
5. Docs and tests are updated and passing.

## Out of Scope for This PR

1. External analytics pipeline ingestion.
2. Database storage for gameplay logs.
3. UI dashboards for gameplay log visualization.
