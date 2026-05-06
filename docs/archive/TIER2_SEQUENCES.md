# Tier 2 Sequences — Future & Deferred

This document catalogs sequences that were identified during the sequence audit but are **not yet
implemented as runnable EDN sequences**. Each entry explains the intended behaviour and the
recommended implementation path.

Naming note:
- Canonical lifecycle sequence names are:
  - `software-halt-sequence`, `software-shutdown-sequence`, `software-restart-sequence`
  - `machine-shutdown-sequence`, `machine-reboot-sequence`
  - `props-sleep-sequence`, `props-wake-sequence`

---

## hint-delivered

**Status:** Deferred — handled by existing event infrastructure.

**Original intent:** Fire a sequence when a hint is delivered to the players.

**Decision:** This is NOT a sequencer sequence. Hint delivery is already a first-class event in the
PxO engine. When any hint fires successfully, `stateMachine.fireHint()` publishes the MQTT event
`hint_executed` with the hint id, type, and source:

```js
this.publishEvent('hint_executed', { id: hintId, type: effectiveHint.type, source });
```

Operators and integrations that need to react to hint delivery should subscribe to the game MQTT
topic and listen for `hint_executed` events. Implementing a parallel EDN sequence for this would
create a duplicate notification path and risk double-firing side effects.

**Action required:** None. If a game EDN is found to reference `hint-delivered-sequence`, the
engine will log a warning and skip it — that is the correct behaviour.

---

## prop-event

**Status:** Future feature — not yet implemented.

**Intended purpose:** Allow in-room props (physical puzzle devices) to trigger custom sequences
when their state changes. For example: bomb defused → fire celebration sequence; safe door opened
→ trigger next-puzzle lights.

**Design sketch:**
```edn
;; In :command-sequences
:prop-bomb-defused {:description "Sequence fired when bomb prop reports defused state"
                    :sequence [{:fire :lights-green}
                               {:fire :play-dramatic-impact}]}
```

The trigger mechanism would live in `:global :triggers :escapeRoomRules` using an MQTT topic
subscription on the prop's status topic, matching a payload condition, and then firing the
appropriate sequence.

**Prerequisites:**
1. Prop must publish structured MQTT status messages.
2. A trigger rule must be configured in `:global :triggers`.
3. The target sequence must be defined in `:command-sequences`.

**Action required:** Implement when physical prop MQTT integration is ready.

---

## game-solved-sequence / game-failed-sequence

**Status:** Deferred — currently handled inline via phase sequences.

**Intended purpose:** A dedicated hook sequence that runs when the game outcome is determined
(win or loss), before the closing phase sequence.

**Current state:** Solved/failed outcomes are handled by the `solved` and `failed` phase entries
in each game mode (`:phases :solved :sequence` and `:phases :failed :sequence`). Adding a global
hook here would allow cross-mode outcome effects without duplicating them in every game mode.

**Action required:** Add to `:command-sequences` and wire `_triggerEnd()` in `stateMachine.js`
when cross-mode outcome hooks are needed.

---

## player-panic / player-help-request

**Status:** Future feature — not yet designed.

**Intended purpose:** Triggered when a player activates the in-room help/emergency buzzer.
Could flash lights, pause the clock, and notify the game master.

**Action required:** Design trigger mechanism and operator notification path first.
