# Paradox Orchestrator (PxO) — AI Instructions

PxO is a **modular, MQTT-based game orchestration engine** for escape rooms and interactive experiences. It manages game state, executes timed sequences, coordinates multiple zones (lights, displays, audio), and provides a flexible configuration system using EDN and INI formats.

**Repository**: [GitHub (MStylesMS/PxO)](https://github.com/MStylesMS/PxO)

## Tech Stack

- **Runtime**: Node.js 18+
- **Game Config**: EDN (Extensible Data Notation)
- **System Config**: INI format
- **Communication**: MQTT (zone-based topics)
- **State Machine**: `ready → intro → gameplay → paused/solved/failed → sleeping/resetting`

## Architecture Summary

PxO uses a **three-tier command model**: Commands (atomic zone operations) → Cues (named shortcuts, fire-and-forget) → Sequences (timeline-based with blocking semantics). Each zone (lights, mirror, picture, audio, clock, system) is an independent adapter communicating via MQTT. The state machine manages game flow with explicit transitions, entry/exit handlers, and timer preservation on pause/resume.

## Paradox Family

PxO is the game engine in a seven-product family. Commands flow PxO → PFx (media) and PxO → PZB (radio devices) over MQTT; inputs flow from PFx / PZB / Pio / PxT → PxO.

- **PFx** — media/audio/lights/relays controller
- **PxO** — this project (game orchestration engine)
- **PxC** — configurable clock app framework
- **PxT** — player terminal kiosk
- **Pio** — GPIO-to-MQTT bridge (C++)
- **PZB** — Z-Wave / Zigbee / Thread to MQTT bridge (Node.js)
- Rooms: `agent22`, `houdinis-challenge` — EDN game packages consumed by this engine

Z-Wave and Zigbee sensor events reach PxO via PZB node event topics (schema identical to PFx InputZone events), not from PFx.

## Critical Constraints

- **MQTT topic structure is sacred**: `{baseTopic}/{commands|events|state|warnings}`
- **Command format**: `{"zone": "name", "command": "action", ...params}`
- **EDN backward compatibility**: existing game configs must continue working; new features must be opt-in with defaults
- **Sequence runner is blocking by design** — long sequences delay state transitions
- **Zone adapter contract**: constructor, executeCommand, handleStateUpdate — all adapters follow this pattern
- **Never bypass the MQTT wrapper** — use `this.mqtt.publish()`, not raw client

## Documentation-First Development

Before significant changes, review relevant docs. If a change conflicts with documented design, propose doc updates first. Update docs alongside code. API/protocol changes require explicit approval. Use commit prefixes: `Docs:`, `Implement:`, `Fix:`, `Test:`, `Refactor:`, `Chore:`.

## Key References

| Document | Purpose |
|----------|---------|
| [AI-DETAILED-OVERVIEW.md](AI-DETAILED-OVERVIEW.md) | Full architecture, code patterns, all development workflows |
| [docs/SPEC.md](docs/SPEC.md) | Complete functional specification |
| [docs/CONFIG_EDN.md](docs/CONFIG_EDN.md) | EDN configuration reference |
| [docs/CONFIG_INI.md](docs/CONFIG_INI.md) | INI system settings reference |
| [docs/MQTT_API.md](docs/MQTT_API.md) | MQTT topics and message formats |
| [docs/CLI.md](docs/CLI.md) | Command-line options |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Tutorial for building games |
| [docs/SETUP.md](docs/SETUP.md) | Installation and deployment |
| [README.md](README.md) | User-facing overview and quick start |
| Parent system: [/opt/paradox/AI-INSTRUCTIONS.md](/opt/paradox/AI-INSTRUCTIONS.md) | System-wide context (when in Paradox workspace) |
