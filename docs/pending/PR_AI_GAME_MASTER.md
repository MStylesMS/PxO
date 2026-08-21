# PR: AI Game Master (deferred)

Status: Future consideration. **Do not implement in the current puzzle-logic work.** This document captures the design so it is not lost, and records capabilities added since the original puzzle-logic brainstorm that make an AI GM more practical.

Related: [`PR_PUZZLE_LOGIC.md`](PR_PUZZLE_LOGIC.md) (graph architecture this service would consume) · [`PUZZLE_SHAPES.md`](PUZZLE_SHAPES.md).

---

## Why this is its own PR

An AI Game Master is a **service**, not a puzzle node type. It watches game state, decides when to hint, when to surface narrative, when to tighten or relax difficulty, and what to do when players go off-rails. Wiring it into PxO as part of the logic-graph implementation would mix two scopes and delay SpyCatcher Moscow.

The logic graph (Option B) is the right consumption surface: the GM subscribes to `{game-topic}/state` and `{game-topic}/events`, including the `logic` snapshot, and publishes ordinary PxO commands (`hint`, `solvePuzzle`, zone actions). No special "AI mode" in PxO is required.

Lifecycle belongs to **Option F** (PxO-managed subprocess) or **Option G** (external MQTT microservice, already supported). Choose F if the GM must be alive before gameplay starts and must shut down on reset; choose G if it is a cloud/always-on service.

---

## Use case 1 — AI Game Master

A service that watches game state and acts as a second operator.

**Best fit:** Option F or Option G, depending on whether PxO should own the process.

- Subscribe to `…/state`, `…/events`, and helper outputs.
- Publish commands on `…/commands` — the same surface the operator UI uses today. No new command vocabulary is required for v1.
- For hint generation, publish `command: hint` (or `executeHint`) with a text payload; PxO routes to the existing hint system (PxT, wall clock, audio, video — see below).
- For dynamic puzzle changes, a future Option B capability is publishing a graph fragment to a reserved `…/logic/patch` topic. That patch API is **not** in the current implementation; the engine is structured so a later `rebuild(config)` is possible.
- Latency is generous (seconds). MQTT round trips are fine.

## Use case 2 — AI Adversary (real-time competition)

A service that plays against the humans on a specific puzzle — racing them, reacting to their moves, or providing live opposition.

**Best fit:** Option F, tightly coupled to the puzzle it competes on.

- Lifecycle matters: the adversary must be alive *before* the puzzle starts, and shutdown is part of the phase transition. PxO-managed (F) gives that guarantee.
- From PxO's perspective the adversary is just another logic input: its MQTT output feeds an `:mqtt-input` (or G-style `:inputs` + trigger) node.
- Latency budget is tighter (sub-second). Colocated process + QoS 0 is the first attempt. Option D (sandboxed JS include files) remains a later escape hatch if MQTT is too slow; it is not committed.

## Dynamic / generated puzzles

Option B (declarative graph) + Option F or G (a service that produces config) is what unlocks AI-generated rooms. The AI should generate **graph fragments**, not executable code. PxO validates and links them. Safer than letting the model write JavaScript that the engine will run.

Two early decisions in the puzzle-logic PR that keep this door open:

1. The engine is a discrete module (`src/logic/`) with a `rebuild`-shaped constructor, even though runtime patching is not implemented yet.
2. Helpers / external services publish to the existing zone topic convention. An AI service is "just another helper."

---

## Enablers added since the original brainstorm

These landed in the suite after the first puzzle-logic draft. An AI GM implementation should use them rather than inventing parallel channels.

### Paradox Speech (PxS) — STT and TTS

PxS is the room-host speech app: **STT** over in-room camera / go2rtc audio, **TTS** (Piper and/or cloud) for GM and game-originated speak. Lifecycle is already tied to PxO phases (STT only during gameplay / pause / solved / failed; stop on reset/abort). Archives share the gameplay JSONL stem.

For an AI GM this means:

- The GM can **hear** players (STT transcript over MQTT / WebSocket) without a custom capture pipeline.
- The GM can **speak** into the room through the same TTS path operators use.
- Background noise and overlapping speakers are a known limitation of in-room mics. A later **phone or walkie-talkie** channel (player-held, closer mic, push-to-talk) is the likely way past that — treat it as a PxS input option, not a PxO feature.

### Terminal-style chat (SpyCatcher, 1,000 Feet Down)

Some games already have a player-facing terminal chat window (PxT `help` component). Topics are `{terminal-base}/chat/to-players` and `{terminal-base}/chat/from-players`. The operator UI has a matching pane.

An AI GM can use this as a **text GM↔player channel** with no new PxO work: subscribe to `from-players`, publish to `to-players` (and/or let PxO's existing chat archival stay in the loop). SpyCatcher Moscow is the live example; 1,000 Feet Down is the other intended consumer (not yet ported to PxO).

### Existing PxO hint system

PxO already delivers hints as text on screen, audio, video, and clock overlays. Named hints live in EDN (`:hints`) and fire through the same `fireByName` path as cues/sequences. An AI GM should **issue existing hints** (and optional free-text `sendHint`) rather than inventing a parallel hint channel. The logic graph's per-puzzle state (`logic` on the state topic) is the right feature for "which hint is still relevant."

---

## Suggested shape when this PR is picked up

1. Document the GM's MQTT contract (subscribe/publish list) against a real room — SpyCatcher Moscow is the obvious first consumer.
2. Decide F vs G for that room (local process vs cloud).
3. Wire PxS transcript + TTS and/or PxT chat as the player-facing channels.
4. Drive hints and optional `solvePuzzle` through existing commands.
5. Only then consider `logic/patch` hot-swap, and only if a room actually needs generated puzzles mid-game.

No PxO source changes are required to start a prototype GM against today's topics plus the new `logic` snapshot.
