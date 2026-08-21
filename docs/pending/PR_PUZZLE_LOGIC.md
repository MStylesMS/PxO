# PxO Feature: Puzzle Logic Architecture

## Status: Approved for Phase 1 implementation

This document is the architecture decision record. The node-type contract lives in [`PUZZLE_SHAPES.md`](PUZZLE_SHAPES.md). Copy-paste recipes: [`PUZZLE_RECIPE_BOOK.md`](PUZZLE_RECIPE_BOOK.md). AI Game Master / Adversary work is deferred to [`PR_AI_GAME_MASTER.md`](PR_AI_GAME_MASTER.md).

---

## Problem

PxO has **no puzzle support today**. There is no `:puzzles` (or `:logic`) key in source, no per-puzzle state, and no "all puzzles solved → win" evaluator. Win/lose is a single-shot event: a trigger, schedule, or operator command calls `_triggerEnd`.

That is too thin for rooms like SpyCatcher Moscow, which need:

1. **Game-flow expressiveness.** A **primary puzzle** (keypad) whose solve ends the room, plus **contributing puzzles** whose collective solved state drives a progress LED bar on the wall clock.
2. **Puzzle logic expressiveness.** Real puzzles take inputs from sensors, props, timers, and the outputs of *other* puzzles, then produce an output (boolean, number, string). Today the only reactive tool is `:triggers` with exact-match payload conditions.

What already exists and is the foundation:

- `:global :inputs` (named MQTT topics) + `:global :triggers` (condition → actions). This **is Option G**, already working.
- `_triggerEnd(outcome)` as the single win/lose funnel.
- Zone adapters (including generic `mqtt`) for outputs such as `wallclock` `announce`.

This is greenfield, not a migration. Existing rooms keep working: `:logic` is opt-in. Rooms without it behave exactly as they do now.

Throughout this document a "puzzle" is a generic **logic block**: named inputs, an evaluation rule, one output, optional actions on transition.

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| Architecture | **Option B** (declarative logic graph) is the umbrella. |
| Leaf types | **Option A** parametric node types live as `:type` values inside B. Spec: [`PUZZLE_SHAPES.md`](PUZZLE_SHAPES.md). |
| External services | **Option G** is documented, not new code. `:mqtt-input` is the graph-side leaf. |
| Managed helpers | **Option F** is Phase 2. |
| Sandboxed JS | **Option D** is a potential Phase 3, as **include files** in a dedicated directory — not inline scripts. |
| Expression languages | **Option C1 (JSONata) and C2 (JSON Logic) will not be implemented.** Same treatment as Option E (Lua): too much complexity given A+B, a second syntax for designers, and no sequences/timers (those stay in A). |
| Lua | **Option E — dropped.** No second runtime language. |
| AI Game Master | Separate deferred PR: [`PR_AI_GAME_MASTER.md`](PR_AI_GAME_MASTER.md). |
| Input addressing | Namespaced keyword = `:inputs` signal (`:gpio-events/F1`). Bare keyword = another node. Long-form map for overrides (`:value-key`, `:when`, `:active-low`). |
| Polarity | Logical on/off in `:target`. Coerce raw values, *then* invert. Precedence: binding > node > input source. |
| Outputs | **Both:** `:on-true` / `:on-false` / `:on-change` on nodes (same action vocabulary as triggers), **and** trigger `:source :logic/<node>` with synthetic payload `{:node "breaker" :output true :value 1 :previous 0}`. |
| Win condition | `{:end "win"}` as a node action. No `:gameplay :solve-on` key. |
| Latch | `:latch true` makes output sticky once truthy. Graph resets on `reset` / `ready`. |
| Enable / bypass | Shared node fields plus operator `enablePuzzle` / `disablePuzzle` / `bypassPuzzle`. Bypass counts as solved. `resetPuzzle` clears bypass. |
| Scoring | `:count-true`, `:count-false`, `:sum` (weighted, unbounded), `:clamp`, `:scale` (range map), `:time-bonus`. No action-side variable store. |
| Runtime graph patch | Structured for a future `rebuild(config)`; **not implemented** in Phase 1. |

---

## Implementation phases

### Phase 1 (this work)

1. **Option G — documentation only.** External MQTT microservices already work via `:inputs` + `:triggers`. Document the pattern, the failure modes (no liveness check, no cleanup), and that `:mqtt-input` is the graph-side equivalent.
2. **Option B — graph engine.** `src/logic/` evaluator, validation, MQTT routing, state publication, `solvePuzzle` / `resetPuzzle` / `enablePuzzle` / `disablePuzzle` / `bypassPuzzle`.
3. **Option A — starter types needed by SpyCatcher Moscow:** `:match`, `:sequence` (with `:match-last`; also `:enter` / `:reset`), `:count-true`, `:scale`, `:passthrough`, `:mqtt-input`. Wire breakers, map, keypad, progress bar, and passthrough nodes for the already-working safe / enigma / terminal so all five contributors feed `:count-true`.
4. **Option A — rest of the library**, specified in `PUZZLE_SHAPES.md`:
   - Stateless: `:eq`, `:code-match`, `:any-of`, `:all-of`, `:none-of`, `:count-false`, `:sum`, `:clamp`
   - Stateful: `:threshold` (`:op`/`:value` or `:min`/`:max`), `:timeout`, `:time-bonus`, `:combo-lock`, `:combo-lock-discrete`
5. **Recipe book.** [`PUZZLE_RECIPE_BOOK.md`](PUZZLE_RECIPE_BOOK.md) — 5th-grader descriptions plus EDN. Update again after Phase 2 and 3.

First consumer: **SpyCatcher Moscow**. Live solutions are in `PUZZLE_SHAPES.md` §1 and `moscow.edn`.

### Phase 2

**Option F — managed subprocess helpers.** PxO spawns and supervises external programs declared in EDN (start, restart, health, shutdown) and consumes their MQTT output as `:mqtt-input` nodes. Powerful; likely needed for an upcoming game. Isolated follow-up PR. Not in this implementation.

### Potential Phase 3

**Option D — sandboxed JavaScript as include files.** If we do this, scripts are **referenced files** in a dedicated directory (for example `puzzles/` or `logic-scripts/` next to the game EDN), not inline strings in config. `isolated-vm` (real V8 isolate; `vm.Script` is not a security boundary). Behind an explicit trust flag. Only if Phase 1 + 2 prove insufficient for a concrete room.

### Do not implement

| Option | Reason |
|---|---|
| **C1 — JSONata** | Second syntax, ~100 KB dependency, stateless (cannot replace `:sequence` / timers), painful to debug. A+B already cover composition and conditions. |
| **C2 — JSON Logic** | Verbose JSON-AST, limited functions, still stateless. AI-friendly but unnecessary given explicit node types that are *more* AI-friendly (small closed schema). |
| **E — Lua** | Dropped earlier. No second runtime language. |

---

## Option B shape (what we are building)

```clojure
:logic {:breaker {:type :match
                  :inputs [:gpio-events/F1 :gpio-events/F2 :gpio-events/F3
                           :gpio-events/F4 :gpio-events/F5 :gpio-events/F6]
                  :target {:F1 1 :F2 0 :F3 0 :F4 1 :F5 1 :F6 0}
                  :latch true
                  :on-true [{:fire "seq-breaker-solved"}]}

        :keypad  {:type :sequence
                  :input {:source :gpio-events :signal "Keypad"
                          :value-key :key :when {:value "0"}}
                  :target ["1" "2" "3" "4" "pound"]
                  :match-last true
                  :latch true
                  :on-true [{:fire "seq-keypad-solved"} {:end "win"}]}

        :progress-count {:type :count-true
                         :inputs [:breaker :map :safe :enigma :terminal]}

        :progress-bars  {:type :scale
                         :input :progress-count
                         :in-max 5 :out-max 8
                         :on-change [{:zone "wallclock" :command "announce"
                                      :bars "{{value}}"}]}}
```

Full field reference: [`PUZZLE_SHAPES.md`](PUZZLE_SHAPES.md).

`transform()` in `src/modular-config-adapter.js` is an explicit allowlist. `:logic` must be passed through or it is silently dropped — that is the critical wiring point.

---

## Design space (kept for context)

The original seven options. B hosts the others; we are not revisiting the umbrella decision.

### Option A — Parametric puzzle types

Built-in shapes in PxO source. EDN selects `:type` and supplies parameters. Lowest footprint, startup-validated, easiest for non-developers and for AI generation. New shapes require a PxO release.

**Role:** leaf node types inside B. See `PUZZLE_SHAPES.md`.

### Option B — Declarative logic graph

Pure-EDN directed graph of named nodes. Reactive evaluation when inputs change. Composes A's types. Cycle detection at startup. This is the architecture.

A standalone B with no parametric leaves would push complexity onto the author. A standalone A with no graph would force every composition into game-phase / trigger glue.

### Option C — Embedded expression language (not implementing)

**C1 JSONata** and **C2 JSON Logic** were considered as a `:type :expression` fallback. Both are stateless, add a second syntax, and are unnecessary once A+B exist. **Decision: do not implement**, same as Option E.

### Option D — Sandboxed JavaScript (potential Phase 3)

Maximum expressiveness short of a subprocess. If implemented, **file-referenced only** (include files in a dedicated directory), executed in `isolated-vm`, gated by a developer trust flag. Not inline scripts in EDN.

### ~~Option E — Embedded Lua~~

Dropped. No second runtime language.

### Option F — PxO-managed subprocess (Phase 2)

PxO spawns helper programs, MQTT under a dedicated subtree, restart/health/shutdown. Catch-all for anything A–D cannot express and for anything with its own deployable lifecycle (including a future AI GM). Non-trivial process supervisor; isolated PR.

### Option G — MQTT microservice (already supported)

An external service connects to the broker independently. PxO has no knowledge of it beyond the topic it publishes on. No EDN lifecycle. **This already works** via `:inputs` + `:triggers`, and inside the graph via `:mqtt-input`. Documented, not a new feature. Failure modes (no liveness, no cleanup) are the operator's.

---

## Summary comparison

| Option | Style | Stateful? | Phase | Role |
|---|---|---|---|---|
| A — Parametric | Built-in types | Yes (sequence, combo-lock, timer) | 1 | Leaf types inside B |
| B — Logic graph | Reactive EDN graph | Via A-type nodes | 1 | **Architecture foundation** |
| ~~C1 — JSONata~~ | Expression language | No | — | **Not implementing** |
| ~~C2 — JSON Logic~~ | JSON-AST rules | No | — | **Not implementing** |
| D — Sandboxed JS | `isolated-vm` include files | Yes | Potential 3 | Escape hatch; dedicated directory |
| ~~E — Lua~~ | Embedded language | — | — | **Dropped** |
| F — Subprocess | Managed external process | Yes | 2 | Catch-all / upcoming game |
| G — MQTT service | External, unmanaged | Yes | 1 (docs) | Self-managed external services |

---

## Affected rooms

- **SpyCatcher Moscow** — first consumer. Breakers (`:sequence` ON order `265143`), map (`:match` M1+M2+M4 present; Shiraz GPIO TBD / assumed solved), keypad (`:sequence` last-N `1234#`), progress bar (`:count-true` + `:scale` → wallclock `announce`), keypad `:end "win"`. Safe / enigma / terminal stay on existing triggers and are also exposed as latched `:passthrough` nodes so progress counts them.
- SpyCatcher Washington — Phase 2 consumer of the same graph.
- Houdini's Challenge, Agent22, existing rooms: zero impact until they add a `:logic` block.

## Out of scope for this PR

- Option F process supervisor.
- Option D include-file runner.
- Runtime hot-patch of the graph (`…/logic/patch`).
- MQTT `:inputs` payload profiles (JSON field vs raw scalar vs topic-leaf). Puzzle types consume already-coerced values.
- Action-side variable store (`A = A + 1`). Use `:sum` / `:count-true` / `:time-bonus` nodes instead. Trigger variables remain a separate placeholder: [`PR_TRIGGER_VARIABLES_AND_EXPRESSIONS.md`](PR_TRIGGER_VARIABLES_AND_EXPRESSIONS.md).
- AI Game Master — see [`PR_AI_GAME_MASTER.md`](PR_AI_GAME_MASTER.md).
- Physical keypad repair (`KEYPAD-WIP.md`); software is verified with synthetic MQTT events.
