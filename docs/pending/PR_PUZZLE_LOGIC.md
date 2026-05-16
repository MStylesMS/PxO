# PxO Feature: Puzzle Logic Architecture

## Status: Proposed (brainstorming — not yet a buildable plan)

## Problem

The current PxO game engine treats every puzzle listed in an EDN config as a required solve condition, and each puzzle is essentially a hardcoded boolean. This is too restrictive for two reasons:

1. **Game-flow expressiveness.** Rooms need richer outcomes than "all solved → win." SpyCatcher Moscow/Washington wants:
   - A **primary puzzle** (keypad) whose solve ends the room.
   - **Contributing puzzles** whose collective solved state drives a progress LED bar on the wall clock.
2. **Puzzle logic expressiveness.** Real puzzles take inputs from sensors, props, timers, and the outputs of *other* puzzles, then produce an output. The output is often a boolean ("solved"), but can also be a number, a string, a code, or even a command. PxO currently has no way to express this without adding a hardcoded handler in source.

This PR defines the design space for **puzzle logic** in PxO. It does **not** commit to a specific implementation. Once we agree on the shape, we will spin off narrow follow-up PRs for each piece.

Throughout this document, a "puzzle" is treated as a generic **logic block**: it has named inputs (sensor values, prop events, outputs of other puzzles), an evaluation rule, and one or more named outputs.

---

## Design Space

Seven candidate implementation styles are described below. Some can coexist; one of them is likely the umbrella under which the others live.

### Option A — Parametric Puzzle Types

A library of built-in puzzle "shapes" implemented in PxO source code. EDN selects a type and supplies parameters. No code is written by the room designer.

```edn
:puzzles
  {:breaker  {:type :match
              :inputs [:F1 :F2 :F3 :F4 :F5 :F6]
              :target {:F1 1 :F2 0 :F3 1 :F4 0 :F5 0 :F6 1}}

   :keypad   {:type :sequence
              :input :keypad/keys
              :target [2 7 5 3 8 3]
              :timeout-ms 15000
              :reset-on-wrong true}

   :map      {:type :match
              :inputs [:M1 :M2 :M3 :M4 :M5 :M6 :M7]
              :target {:M1 1 :M2 0 :M3 1 :M4 1 :M5 0 :M6 0 :M7 1}}

   :dial     {:type :combo-lock
              :input :rotary/position
              :target [12 34 22 7]
              :jitter-tolerance 2
              :direction-accuracy 1
              :debounce-ms 100}

   :enigma   {:type :code-match
              :input :enigma/code
              :target "582665"}}
```

**Representative types to ship in the initial parametric library:**

| Type | Description |
|---|---|
| `:match` | Set/map of input values must equal a target. Order does not matter. Used for parallel switches, RFID layouts, breaker panels. |
| `:sequence` | Ordered series of discrete events must match the target sequence. Optional `:timeout-ms`, `:reset-on-wrong`. Used for keypads, button sequences, Simon-style. |
| `:combo-lock` | Continuous analog input (rotary encoder, potentiometer, dial). Target is a list of integer positions. Detection logic: <br/>• **Direction changes** mark a "stop" — the player has reached an intended value and reversed.<br/>• **`:jitter-tolerance`** suppresses spurious direction changes within a small range; e.g. `1-2-3-4-3-4-5-6` with tolerance 2 collapses the `3-4-3-4` jitter, so the lock still sees `…-4-5-6`.<br/>• **`:direction-accuracy`** allows the recorded "stop" value to be within ±N of the target. e.g. target `4`, input `2-3-4-5-4` (player overshot slightly) registers as a 4 if accuracy ≥ 1, or as a 5 if accuracy is tighter. The recorded value is the actual peak/trough before the reversal, not the target — so the puzzle author can choose strictness. |
| `:combo-lock-discrete` | Like `:combo-lock` but for discrete-position dials (e.g. cipher rings, indexed knobs). Logic spec to follow in a later iteration. |
| `:code-match` | Input string/number equals a constant. Used for keypads that emit a complete code, MQTT-published codes from props like Enigma. |
| `:threshold` | Numeric input crosses (or stays above/below) a value, optionally for a duration. Used for proximity sensors, light levels, weight pads. |
| `:timeout` | Output becomes true after N seconds since `:start-event`. Used for "wait for X seconds of silence." |
| `:count` | Output = number of `true` values among named inputs. Used to drive progress bars without a separate logic graph. |
| `:any-of` / `:all-of` / `:none-of` | Boolean composition over named inputs. Cheap "glue." |

Each type has a documented schema; PxO validates at startup. Each emits at least an `output` value (boolean or value-typed) and may emit a `state` map for diagnostics.

**Pros**
- Easiest for non-developers; everything is data.
- Lowest CPU/memory footprint; no interpreter, no sandbox.
- Highest safety: invalid configs are caught at startup.
- Easiest to unit-test in PxO itself.
- Naturally describable to an AI ("generate a `:sequence` puzzle with target …") — schema is small and explicit.

**Cons**
- New shapes require a PxO release.
- Truly novel logic ("count distinct sensor activations within a sliding window across two zones") may need many parameters or just doesn't fit.

---

### Option B — Declarative Logic Graph

Pure-EDN directed graph of named nodes. Each node has a `:type`, a set of inputs (referencing other node outputs or raw sensor topics), and produces an output. PxO evaluates the graph reactively whenever an input changes; outputs propagate to downstream nodes.

```edn
:logic
  {:breaker-pattern {:type :match
                     :inputs [:gpio/F1 :gpio/F2 :gpio/F3 :gpio/F4 :gpio/F5 :gpio/F6]
                     :target {:F1 1 :F2 0 :F3 1 :F4 0 :F5 0 :F6 1}}

   :keypad-correct  {:type :sequence
                     :input :gpio/keypad-keys
                     :target [2 7 5 3 8 3]}

   :map-correct     {:type :match
                     :inputs [:gpio/M1 :gpio/M2 :gpio/M3 :gpio/M4 :gpio/M5 :gpio/M6 :gpio/M7]
                     :target {:M1 1 :M2 0 :M3 1 :M4 1 :M5 0 :M6 0 :M7 1}}

   :enigma-correct  {:type :eq
                     :input :enigma/last-code
                     :value "582665"}

   :progress-count  {:type :count-true
                     :inputs [:breaker-pattern :map-correct :enigma-correct
                              :terminal-correct :safe-correct]}

   :progress-bars   {:type :scale
                     :input :progress-count
                     :in-max 5 :out-max 8}

   :game-won        {:type :passthrough
                     :input :keypad-correct}}
```

The "puzzles" section is replaced (or augmented) by named outputs in the graph. Game-phase rules then reference these names:

```edn
:gameplay {:solve-on :game-won
           :progress :progress-bars
           :progress-zone :wallclock}
```

**Pros**
- Composable: progress, derived states, multi-stage puzzles all fall out naturally.
- Reactive evaluation is cheap when inputs change rarely (escape-room reality).
- Same data-only safety story as Option A.
- Serialisable, version-controllable, and **mutable at runtime** — an AI service could publish a new graph fragment over MQTT and PxO would re-link it. This is the strongest single argument for B.
- Naturally handles the "primary puzzle vs. contributing puzzles" pattern with no special-case code.

**Cons**
- More moving parts than A; designer must understand node references.
- Cycle detection and incremental re-evaluation must be implemented carefully.
- Stateful puzzles (sequences, combo-locks, timers) still need to be implemented somewhere — usually as a node type, which means B *contains* A's logic, not replaces it.

#### Comparison: A vs. B

| Aspect | A — Parametric | B — Logic Graph |
|---|---|---|
| Where puzzles live | Top-level `:puzzles` map | Named nodes in `:logic` graph |
| Composition | Limited; relies on game-phase glue | First-class via node references |
| Output type | Usually boolean | Any: bool / num / string / map |
| Reusing one puzzle's output as input to another | Awkward (must be added explicitly to game-phase logic) | Native (just reference the name) |
| Progress / derived state | Requires bespoke code in PxO | Just another node |
| Cycle / dependency risk | None | Real; must validate |
| Learning curve | Lowest | Slight step up |
| AI-mutability at runtime | Limited (replace whole puzzle) | High (patch a subgraph) |
| Implementation overlap | — | **B *needs* A's node types to be useful.** |

**Net:** A and B are not really alternatives; B is the connective-tissue layer that uses A as its leaf node types. A standalone B with no parametric leaves would just push the complexity into the user. A standalone A with no graph would force every composition into game-phase config.

---

### Option C — Embedded Expression Language

Short expressions in EDN strings, evaluated against current game state by a standard, well-known library. No code execution; just expression evaluation.

Two mainstream candidates:

#### C1 — JSONata

JSONata is a query and transformation language for JSON, originally inspired by XPath and SQL. It is the standard expression language in Node-RED, IBM App Connect, and several other dataflow tools.

```jsonata
$count(puzzles[$=`solved`])                            /* 3 */
gpio.F1=1 and gpio.F2=0 and gpio.F3=1                  /* true/false */
$sum(rfid.readers[active=true].weight)                 /* number */
$lookup(codes, enigma.entered) = "primary"             /* string compare */
```

Strengths:
- Full expression language: arithmetic, string ops, regex, array filters, sums, counts, aggregates, joins.
- Single self-contained library (`jsonata` on npm), ~100 KB.
- Operates directly on the current state object — no glue.
- Used heavily in IoT/automation; documented and stable.

Weaknesses:
- Syntax is its own dialect; a designer must learn it.
- Stateless: cannot remember history without PxO exposing state explicitly.
- Some operators (path navigation with `*`, `.`) are non-obvious to non-programmers.

#### C2 — JSON Logic

JSON Logic represents boolean / arithmetic expressions as nested JSON arrays. Designed to be safe, portable, and trivially serialisable.

```json
{ "and": [
    { "==": [ {"var": "gpio.F1"}, 1 ] },
    { "==": [ {"var": "gpio.F2"}, 0 ] },
    { "==": [ {"var": "gpio.F3"}, 1 ] }
] }
```

Strengths:
- Pure JSON — same data shape as everything else, no second syntax.
- Tiny (~15 KB), no parser surprises.
- Ports exist in every major language, so any tool (or AI) can produce/consume it.
- Trivial for an LLM to generate correctly.

Weaknesses:
- Verbose. Anything beyond a one-liner becomes hard to read.
- Limited built-in functions; complex aggregation requires several nested calls or an extension.

#### When C makes sense

C is best suited to **per-puzzle conditions** that are too varied to fit a parametric type but don't need real procedural logic. E.g.:

```edn
{:puzzles
  {:custom-thing {:type :expression
                  :engine :jsonata
                  :expr "gpio.F1=1 and (timer.elapsed > 60 or rfid.tag='red')"
                  :output :solved}}}
```

In other words, C is a **fallback node type** for both A and B — a parametric type whose "parameter" happens to be an expression.

**Pros**
- Bridge between safe parametric config and arbitrary logic.
- Stateless evaluation is cheap.
- JSON Logic in particular is the most AI-friendly format we have.

**Cons**
- Adds a runtime dependency and a second syntax for designers to learn.
- Stateless — no sequences, no timers (those stay in A's parametric types).
- Debugging a complex expression is painful.

---

### Option D — Sandboxed JavaScript

Inline or file-referenced JS, executed in a real sandbox. The only safe sandbox in Node.js is `isolated-vm` (a true V8 isolate); `vm.Script` is **not** a security boundary and should not be used for untrusted config.

```edn
{:puzzles
  {:custom {:type :script
            :engine :js
            :file "puzzles/custom.js"
            :inputs [:gpio :timer :state]
            :outputs [:solved :hint]}}}
```

```js
// puzzles/custom.js
export function evaluate({ gpio, timer, state }) {
  const elapsed = timer.elapsed;
  const goodPins = gpio.F1 === 1 && gpio.F3 === 1;
  return { solved: goodPins && elapsed > 60, hint: elapsed > 120 ? "hurry" : null };
}
```

**Pros**
- Maximum expressiveness short of running a separate process.
- Stateful logic is trivial (closures, module-scoped variables).
- Excellent fit for AI-generated logic; LLMs write good JS.
- Same language as PxO itself; debugging is familiar.

**Cons**
- `isolated-vm` requires native compilation; adds deployment friction on Raspberry Pi.
- Even with a sandbox, code-in-config is a security and review burden for non-developer operators.
- Encourages drifting away from the "config is data" principle.
- Failure modes (infinite loops, memory growth) need careful policing.
- Two ways to express puzzle logic (parametric and JS) doubles the cognitive load.

D is best treated as a **rare escape hatch**, not the everyday tool.

---

### ~~Option E — Embedded Lua~~

Dropped at user direction. No second runtime language.

---

### Option F — PxO-Managed Subprocess (catch-all)

PxO spawns and supervises external helper programs declared in EDN. Helpers can be written in any language. Communication is via MQTT under a dedicated subtree. PxO is responsible for start, restart, health-check, and shutdown.

```edn
{:helpers
  [{:id :safe-logic
    :cmd ["node" "helpers/safe-logic.js"]
    :topic "paradox/spycatcher/moscow/helpers/safe"
    :restart-on-crash true
    :ready-event "helpers/safe/ready"
    :stop-grace-ms 2000}]

 :logic
  {:safe-correct {:type :mqtt-input
                  :topic "paradox/spycatcher/moscow/helpers/safe/output"}}}
```

**Pros**
- Unlimited flexibility — any language, any library, any external service or hardware.
- Strong fault isolation: a helper crash does not crash PxO.
- The AI game master, AI adversary, dynamic generator, or any large external service is just a helper.
- Helpers can be authored independently and reused across rooms.

**Cons**
- Process lifecycle adds genuine complexity to PxO (spawn, watch, restart with backoff, health timeout, shutdown semantics, log forwarding).
- Extra memory on Pi3.
- MQTT round-trip latency is fine for game-pace logic but not for tight real-time control.
- Helpers can drift in behavior and version independently of PxO; requires versioning discipline.

F is the natural home for anything Option A through D can't easily express, and especially for anything that wants its own deployable lifecycle.

---

### Option G — MQTT Microservice (zero-cost; already supported)

An external service connects to the broker independently. PxO has no knowledge of it beyond the topic it publishes on. No EDN changes, no lifecycle.

```
Service publishes:  paradox/spycatcher/moscow/external/safe/state
PxO consumes that topic as a logic input via Option B's :mqtt-input node.
```

**Pros**
- Effectively free — already works today.
- Decouples deployment timelines.
- Works across machines.
- Suits cloud-hosted services (AI inference, weather, telemetry).

**Cons**
- No coordination — PxO has no idea if the service is alive at game start.
- No automatic cleanup.
- Failure modes are entirely the room operator's problem.

G is what F becomes if you skip the lifecycle work. It is documented as a supported pattern, not an implemented feature.

---

## Is one option a natural umbrella?

**Yes — Option B (Declarative Logic Graph) is the only option that can host the others.**

- A's parametric types fit as node `:type`s inside B.
- C's expressions fit as a `:type :expression` node.
- D's scripts fit as a `:type :script` node.
- F's subprocess outputs and G's external services fit as `:type :mqtt-input` nodes.

This means PxO can adopt B as the **architecture** and add A's types, C's engines, D's escape hatch, and F's process supervisor as separate, narrowly scoped follow-up PRs. Each delivers value independently and stacks coherently.

The current "all puzzles required to win" behavior becomes a special case: one node of type `:all-of` whose inputs are the puzzle outputs, wired into `:gameplay :solve-on`.

---

## Suggested Overall Approach (proposed for discussion)

A layered model rooted in Option B, prioritized by value-per-implementation-cost:

1. **B + a starter library of A types** (must-have). Implement the graph evaluator with these initial node types: `:match`, `:sequence`, `:code-match`, `:eq`, `:any-of`, `:all-of`, `:count-true`, `:scale`, `:passthrough`, `:mqtt-input`. This covers SpyCatcher Moscow end-to-end and gives every future room a working baseline.
2. **A's stateful types** (next): `:combo-lock`, `:combo-lock-discrete`, `:threshold`, `:timeout`. Each is one focused PR.
3. **F — managed subprocess** (high value, isolated work). The catch-all. Lifecycle management is non-trivial but is a one-time implementation cost.
4. **C — expression node (JSON Logic first, JSONata second)** (medium value). JSON Logic is small, safe, and AI-friendly; ship it first. JSONata is added only if it earns its keep.
5. **D — sandboxed JS** (last, and only if needed). Implement via `isolated-vm` behind an explicit `:trust-level :developer` flag in EDN. Most rooms never touch it.
6. **G — MQTT microservice** is documented, not implemented. The `:mqtt-input` node from step 1 is the only PxO-side piece it needs.

This sequence ships value at every step and lets us defer or skip the risky pieces.

---

## AI Integration

We expect two distinct AI use cases in the near future and should design so both are first-class consumers of the architecture above without requiring a special "AI mode" in PxO.

### Use case 1 — AI Game Master

A service that watches game state, decides when to issue hints, when to surface narrative beats, when to tighten or relax difficulty, and what to do when players go off-rails.

**Best fit:** Option F (managed subprocess) or Option G (external MQTT service), depending on whether we want PxO to own its lifecycle.

- The AI subscribes to `…/state`, `…/events`, and all `…/helpers/*` outputs.
- It publishes commands back through standard PxO command topics — exactly as the operator UI does today. No new command surface needed.
- For "hint generation," it publishes to PxO's `command: hint` with a text payload; PxO routes to PxT.
- For "dynamic puzzle changes," it publishes a new logic graph fragment to a reserved `…/logic/patch` topic and PxO hot-swaps the affected nodes (this is the future capability that Option B uniquely enables).
- Latency is generous (seconds), so MQTT round trips are fine.

### Use case 2 — AI Adversary (real-time competition)

A service that plays against the human players in real time on a specific puzzle — racing them, reacting to their moves, or providing live opposition.

**Best fit:** Option F (managed subprocess), tightly coupled to the puzzle it competes on.

- Lifecycle matters more here — the adversary must be alive *before* the puzzle starts, and shutdown is part of the game phase transition. PxO-managed (F) gives us that guarantee.
- The adversary is a logic node from PxO's perspective: its outputs feed the graph (Option B) like any other input.
- Latency budget is tighter (sub-second). MQTT QoS 0 plus colocated process keeps this acceptable; if it isn't, the adversary can be moved into PxO via Option D (sandboxed JS) without changing the architecture.

### Dynamic / generated puzzles

The combination of Option B (mutable graph) + Option F or G (AI service that produces config) is what unlocks AI-generated rooms. The AI doesn't generate code; it generates **declarative graph fragments** that PxO validates and links in. This is dramatically safer than letting the AI write JavaScript that PxO will execute, and it slots naturally into the architecture proposed above.

### Implication for this design

To make AI integration smooth later, two early decisions matter:

1. **The logic graph must be patchable at runtime**, not only at startup. Adding nodes, replacing nodes, and removing nodes via MQTT must be a first-class operation, gated behind an authentication/authorization mechanism.
2. **Helpers must publish to a stable, documented schema** (the existing zone topic convention is fine). AI services then become "just another helper" with no special integration code in PxO.

Neither of these is hard if we design for them now. Retrofitting either later is painful.

---

## Summary Comparison

| Option | Style | Stateful? | Config complexity | Pi footprint | AI-friendly | PxO changes | Recommended role |
|---|---|---|---|---|---|---|---|
| A — Parametric | Built-in types | Yes (sequence, combo-lock, timer) | Low — name a type, supply params | Minimal | High — small, explicit schema | Add node types | Leaf types inside B |
| B — Logic Graph | Reactive node graph (EDN) | Via A-type nodes | Medium — understand references | Minimal | High — graph is serialisable JSON/EDN | Graph evaluator | **Architecture foundation** |
| C1 — JSONata | Expression language | No | Medium — learn JSONata syntax | ~100 KB library | Moderate — readable but non-trivial | Expression node type | Fallback for complex conditions |
| C2 — JSON Logic | JSON-AST rules | No | Low-medium — verbose but obvious | ~15 KB library | Very high — trivial for LLMs | Expression node type | **Second-wave fallback node** |
| D — Sandboxed JS | `isolated-vm` isolate | Yes (closures) | High — JS in config | Native compile | High — LLMs write good JS | Script node type | Escape hatch only |
| ~~E — Lua~~ | ~~Embedded language~~ | — | — | — | — | — | Dropped |
| F — Subprocess | Managed external process | Yes | Medium — lifecycle in EDN | Process + MQTT | High — any language | Process supervisor | Catch-all for complex/external logic |
| G — MQTT Service | External, unmanaged | Yes | None in PxO | None | High — standard MQTT | Docs only | Self-managed external services |

---

## Tentative Implementation Plan

This is directional only. Full task breakdown and EDN schema commitments happen in the narrow follow-up PRs.

### Wave 1 — Base Implementation

- **Option B** is the foundation. All other options plug into it.
- **Option A** — full parametric type library, including the stateful types (`:combo-lock`, `:combo-lock-discrete`, etc.). Stateful type specs will be defined in more detail as part of the Wave 1 PR.
- **Option F** — managed subprocess. Covers everything outside parametric reach for now.
- **Option G** — no PxO changes. Document the pattern in the developer's guide and other applicable PxO docs (CONFIG_EDN.md, architecture docs).

### Wave 2

- **Option C — JSON Logic** (specifically JSON Logic; JSONata deferred). Small footprint, AI-friendly, ships as a `:type :expression` node in the B graph.

### Wave 3 (may not happen)

- **Option D — Sandboxed JS**. Only if Wave 1 + 2 prove insufficient. Requires `isolated-vm` native compilation and a security review; defer until there is a concrete use case that cannot be served by F or C.

---

## Affected Rooms

- SpyCatcher Moscow (first consumer — needs the basics from steps 1–2).
- SpyCatcher Washington (Phase 2 consumer — likely adds a few more node types).
- Houdini's Challenge, Agent22, and existing rooms: zero impact while in legacy mode; can opt-in incrementally.

## Out of Scope for This PR

- A buildable plan or task breakdown. That comes in the narrow follow-up PRs.
- Concrete EDN schema commitments. The examples above are illustrative.
- Security model for hot-patching the logic graph and for any sandboxed-JS feature.
- Per-puzzle weighting in progress calculations.
