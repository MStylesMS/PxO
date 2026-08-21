# Puzzle Shape Library

Status: Working reference for the Option A parametric node types hosted by the Option B logic graph.

Schema and semantics below are the implementation contract. Recipes: [`PUZZLE_RECIPE_BOOK.md`](PUZZLE_RECIPE_BOOK.md).

Related: [`PR_PUZZLE_LOGIC.md`](PR_PUZZLE_LOGIC.md) (architecture) · [`PR_AI_GAME_MASTER.md`](PR_AI_GAME_MASTER.md) (deferred AI GM).

---

## 1. Targets — SpyCatcher Moscow

These are the live values wired in `rooms/spycatcher/config/moscow.edn`. Logical 1 = ON / token present. PxIO is active-LOW; the `:gpio-events` source inverts after coerce.

| Node | Type | Live target |
|---|---|---|
| `:breaker` | `:match` | `010101` → `{:F1 0 :F2 1 :F3 0 :F4 1 :F5 0 :F6 1}` |
| `:map` | `:match` | `0101010` → `{:M1 0 :M2 1 :M3 0 :M4 1 :M5 0 :M6 1 :M7 0}` |
| `:keypad` | `:sequence` | `1234#` → `["1" "2" "3" "4" "pound"]` (`:match-last true`; `#` is part of the target, not `:enter`) |

Notes:

- Breaker and map targets are **logical** on/off. Never write raw pin strings in `:target`.
- Keypad keys are the PxIO `key` field: `"1"`–`"9"`, `"0"`, `"asterik"`, `"pound"`. Matching is a sliding window over the last N pressed keys. There is no timeout and no reset-on-wrong.
- Hardware caveat: `rooms/spycatcher/docs/KEYPAD-WIP.md` — the physical keypad may not yet scan correctly. Software can be verified by publishing synthetic MQTT events.

---

## 2. Shared node fields

Every node in `:global :logic` is a named map:

```clojure
:node-name {:type :match
            :description "optional human text"
            :latch false
            :on-true  []
            :on-false []
            :on-change []
            ;; type-specific fields...
            }
```

| Field | Default | Meaning |
|---|---|---|
| `:type` | required | Node type keyword. |
| `:description` | — | Operator-facing note. Ignored by the engine. |
| `:latch` | `false` | Once the output becomes truthy, it stays truthy until graph reset (`reset`/`ready`) or `resetPuzzle`. SpyCatcher contributing puzzles set this so the progress bar never runs backwards. |
| `:on-true` | `[]` | Actions fired on a false→truthy transition. Same vocabulary as trigger `:actions`. |
| `:on-false` | `[]` | Actions fired on a truthy→false transition. Not fired when latched. |
| `:on-change` | `[]` | Actions fired whenever the output value changes (including numeric/string changes). Template `{{value}}` / `{{output}}` / `{{previous}}` / `{{node}}` are substituted. An exact `{{value}}` token keeps the native type (number stays number). |
| `:active-low` | unset | Node-level polarity default. Binding > node > input source. |
| `:enabled` | `true` | Boolean, or a binding/node that must be truthy. When false, hardware is ignored; output is false unless already latched. |
| `:enable-after` | unset | Binding/node that must be truthy before this node accepts hardware. |
| `:enable-delay-ms` | `0` | Wait this long after `:enable-after` (or `:enabled`) becomes true. |
| `:disable-after` | unset | Binding/node that, when truthy, disables this node. |
| `:bypass` | `false` | Boolean, or a binding/node. When true, force output true, fire `:on-true` once, and count toward `:count-true` / `:sum`. This is the broken-prop path. |
| `:bypass-delay-ms` | `0` | Wait this long after bypass becomes wanted, then auto-solve. Operator `bypassPuzzle` is immediate. |

Truthy means: boolean `true`, number `!== 0`, non-empty string, or any other non-null/non-false value.

Graph reset happens on entry to `reset` and `ready`. Operator commands `solvePuzzle` / `resetPuzzle` / `enablePuzzle` / `disablePuzzle` / `bypassPuzzle` act on a single node. `resetPuzzle` and graph reset also clear bypass and operator disable.

---

## 3. Input addressing

Namespaced keyword = a signal from an `:inputs` source. Bare keyword = another node's output.

```clojure
:inputs {:gpio-events {:topic "paradox/spycatcher/moscow/gpio/events"
                       :producer :pxio
                       :signal-key :pin
                       :value-key :value
                       :active-low true}}
```

Short form:

```clojure
:inputs [:gpio-events/F1 :gpio-events/F2]
:input  :breaker          ; another node's output
```

Long form (overrides per binding):

```clojure
:input {:source :gpio-events
        :signal "Keypad"
        :value-key :key
        :when {:value "0"}
        :active-low false
        :const true}       ; optional: when :when matches, use this constant instead of the payload field
```

| Binding field | Meaning |
|---|---|
| `:source` | Name of an `:inputs` entry, or another node name. |
| `:signal` | Payload field value that identifies this channel (for GPIO, the pin name). |
| `:value-key` | Payload field carrying the value. Defaults to the source's `:value-key`, else `:value`. |
| `:when` | Extra payload match (same equality rules as trigger `:condition`). Event is ignored if it fails. |
| `:active-low` | Invert after coerce. Binding > node > source. |
| `:const` | If set, the binding's value is this constant whenever the event is accepted. |
| `:topic` | (`:mqtt-input` only) Subscribe directly to this topic, bypassing `:inputs`. |

**Coercion then invert.** Raw values coerce (`"0"` / `0` / `false` / `"off"` / `"false"` → `0`; `"1"` / `1` / `true` / `"on"` / `"true"` → `1`; other strings stay strings) and *then* invert if active-low. `:target` is always written in logical terms.

Trigger `:source :logic/<node>` is also supported. The synthetic payload is `{:node "breaker" :output true :value 1 :previous 0}`.

---

## 4. Node types

Implementation status in this table is the contract for the current PR.

| Type | Kind | Status |
|---|---|---|
| `:match` | level | Phase 1 / SpyCatcher |
| `:sequence` | event | Phase 1 / SpyCatcher |
| `:count-true` | level | Phase 1 / SpyCatcher |
| `:scale` | level | Phase 1 / SpyCatcher |
| `:passthrough` | level/event | Phase 1 / SpyCatcher |
| `:mqtt-input` | level/event | Phase 1 (Option G leaf) |
| `:eq` | level | Phase 1 library |
| `:code-match` | level | Phase 1 library |
| `:any-of` | level | Phase 1 library |
| `:all-of` | level | Phase 1 library |
| `:none-of` | level | Phase 1 library |
| `:count-false` | level | Phase 1 library |
| `:sum` | level | Phase 1 library |
| `:clamp` | level | Phase 1 library |
| `:time-bonus` | level | Phase 1 library (locks when `:input` goes true) |
| `:threshold` | level | Phase 1 library (stateful; `:op`/`:value` or `:min`/`:max`) |
| `:timeout` | event | Phase 1 library (stateful) |
| `:combo-lock` | event | Phase 1 library (stateful) — review spec before relying on it |
| `:combo-lock-discrete` | event | Phase 1 library (stateful) — review spec before relying on it |

### 4.1 `:match`

Set/map of input values must equal a target. Order does not matter. Used for parallel switches, RFID layouts, breaker panels, magnet maps.

```clojure
{:type :match
 :inputs [:gpio-events/F1 :gpio-events/F2 :gpio-events/F3
          :gpio-events/F4 :gpio-events/F5 :gpio-events/F6]
 :target {:F1 1 :F2 0 :F3 0 :F4 1 :F5 1 :F6 0}}
```

| Field | Required | Meaning |
|---|---|---|
| `:inputs` | yes | Vector of bindings. |
| `:target` | yes | Map of signal-name → logical value. Keys are the signal leaf (`F1`), not the full `gpio-events/F1`. |

Output is boolean. Unknown / not-yet-seen inputs count as not matching (output false). Missing target keys are an error at startup.

### 4.2 `:sequence`

Ordered series of discrete events. Used for keypads, button sequences, Simon-style.

```clojure
{:type :sequence
 :input {:source :gpio-events :signal "Keypad"
         :value-key :key :when {:value "0"}}
 :target ["1" "2" "3" "4"]
 :enter "pound"
 :reset "asterik"
 :timeout-ms 0}
```

SpyCatcher Moscow uses last-N matching with `#` **inside** the target (not `:enter`):

```clojure
{:type :sequence
 :input {:source :gpio-events :signal "Keypad"
         :value-key :key :when {:value "0"}}
 :target ["1" "2" "3" "4" "pound"]
 :match-last true}
```

| Field | Default | Meaning |
|---|---|---|
| `:input` | required | Event binding. |
| `:target` | required | Vector of expected values, in order. Compared after coerce (so `1` matches `"1"`). Enter/reset keys are **not** in the target when those fields are set. |
| `:match-last` | `false` | If true, output is true whenever the last N accepted events equal `:target` (sliding window). If false, events accumulate from the start; a mismatch resets the buffer when `:reset-on-wrong` is true. **Cannot be combined with `:enter`** (startup error). |
| `:enter` | unset | Optional commit key. Digits accumulate until this key; then the whole buffer is compared to `:target`. The enter key is not stored. `"#"` / `"pound"` / `"hash"` are aliases; `"*"` / `"asterik"` / `"asterisk"` are aliases. |
| `:reset` | unset | Optional clear key. Never stored as a digit. Same aliases as `:enter`. |
| `:reset-on-wrong` | `true` | Prefix mode: mismatch clears (or restarts if the key equals `target[0]`). Enter mode: a wrong enter clears the buffer. Unused for `:match-last`. |
| `:timeout-ms` | unset / `0` | In-progress buffer clears when this many ms elapse between events. **Unset and `0` both mean off.** |

Output is boolean. SpyCatcher keypad uses `:match-last true` with no timeout and no `:enter`.

### 4.3 `:eq`

Single input equals a constant.

```clojure
{:type :eq
 :input {:source :enigma-events :value-key :event}
 :value "code_solved"}
```

| Field | Required | Meaning |
|---|---|---|
| `:input` | yes | One binding. |
| `:value` | yes | Expected value. Compared after coerce. |

Output is boolean.

### 4.4 `:code-match`

String/number code equals a target. Both sides are coerced to trimmed strings.

```clojure
{:type :code-match
 :input :enigma/last-code
 :target "582665"
 :ignore-case false}
```

| Field | Default | Meaning |
|---|---|---|
| `:input` | required | One binding. |
| `:target` | required | String or number. |
| `:ignore-case` | `false` | Lowercase both sides before compare. |

Output is boolean. Prefer `:eq` for non-code values; prefer `:code-match` when the input may arrive as either `"582665"` or `582665`.

### 4.5 `:any-of` / `:all-of` / `:none-of`

Boolean composition over named inputs (typically other nodes).

```clojure
{:type :all-of :inputs [:breaker :map :enigma]}
{:type :any-of :inputs [:path-a :path-b]}
{:type :none-of :inputs [:tamper :alarm]}
```

| Field | Required | Meaning |
|---|---|---|
| `:inputs` | yes | Vector of bindings or node names. |

Output is boolean. Empty `:inputs` is a startup error.

### 4.6 `:count-true`

Number of truthy inputs. Used to drive progress without a separate graph language.

```clojure
{:type :count-true
 :inputs [:breaker :map :safe :enigma :terminal]}
```

Output is an integer `0..n`. Unseen inputs count as false.

### 4.7 `:count-false`

Number of non-truthy inputs. Unseen inputs count as false.

```clojure
{:type :count-false
 :inputs [:tamper-a :tamper-b]}
```

### 4.8 `:sum`

Weighted numeric sum. Unbounded. A bare name has weight 1. Boolean true counts as 1.

```clojure
{:type :sum
 :inputs [{:input :breaker :weight 2}
          :map
          {:input :terminal :weight 3}]}
```

### 4.9 `:clamp`

Clamp a number to an optional min and/or max. No scaling.

```clojure
{:type :clamp :input :points :min 0 :max 100}
```

### 4.10 `:scale`

Linear map from an input range to an output range, then floor.

```clojure
{:type :scale
 :input :progress-count
 :in-min 0 :in-max 5
 :out-min 0 :out-max 8}
```

`out = floor((in - in-min) / (in-max - in-min) * (out-max - out-min) + out-min)`, clamped to `[out-min, out-max]`.

| Field | Default | Meaning |
|---|---|---|
| `:input` | required | Numeric input. |
| `:in-min` | `0` | |
| `:in-max` | required | Must be `>` `:in-min`. |
| `:out-min` | `0` | |
| `:out-max` | required | |

SpyCatcher wall clock: 5 contributing puzzles → 8 LED segments, `floor(solved / 5 * 8)`.

### 4.11 `:passthrough`

Output equals the input. Used to re-expose an MQTT/GPIO signal as a named node (so other nodes and `:count-true` can reference it), and to latch event pulses.

```clojure
{:type :passthrough
 :input :gpio-events/safe
 :latch true}

{:type :passthrough
 :input {:source :terminal-events
         :when {:event "passwordAttempt" :which "main" :success true}
         :const true}
 :latch true}
```

If the input has not yet been seen, output is `false`.

### 4.12 `:mqtt-input`

Subscribe to an arbitrary MQTT topic (Option G leaf). PxO does not manage the publisher.

```clojure
{:type :mqtt-input
 :topic "paradox/spycatcher/moscow/external/safe/state"
 :value-key :solved}

{:type :mqtt-input
 :source :enigma-events
 :value-key :event}
```

| Field | Default | Meaning |
|---|---|---|
| `:topic` or `:source` | one required | Direct topic, or named `:inputs` source. |
| `:value-key` | unset | If set, output is that payload field; otherwise the whole payload (or `true` if the payload is empty). |
| `:when` | unset | Ignore messages that fail this match. |

Output type follows the extracted value. Combine with `:eq` / `:code-match` downstream if you need a boolean.

Payload-shape translation (JSON field vs raw scalar vs topic-leaf keypad) lives on `:inputs` later, not inside puzzle types.

### 4.13 `:threshold`

Numeric input crosses (or stays beyond) a value, or stays inside/outside a range, optionally for a hold duration.

```clojure
{:type :threshold
 :input :weight-pad/kg
 :op :gte
 :value 40
 :hold-ms 1500}

{:type :threshold
 :input :light/lux
 :min 10
 :max 80
 :outside false}
```

| Field | Default | Meaning |
|---|---|---|
| `:input` | required | Numeric. Non-numeric input → not met. |
| `:op` | `:gte` | `:gt` `:gte` `:lt` `:lte` `:eq`. Unused when `:min` and/or `:max` are set. |
| `:value` | required unless range | Single threshold. |
| `:min` / `:max` | unset | Inclusive range. Either or both. When set, `:op` / `:value` are unused. |
| `:outside` | `false` | If true, output is true when the value is **outside** `[min, max]`. |
| `:hold-ms` | `0` | Condition must remain true this long. `0` = immediate. |

Output is boolean. Crossing back below the threshold (or leaving the range) clears the hold timer and, unless latched, the output.

**Open question for editors:** is `:eq` on a float useful, or should we add `:tolerance`? Leave unset for now; add later if a room needs it.

### 4.14 `:timeout`

Output becomes true `duration-ms` after a start condition becomes truthy.

```clojure
{:type :timeout
 :start :gpio-events/door-closed
 :duration-ms 8000
 :reset-on-false true}
```

| Field | Default | Meaning |
|---|---|---|
| `:start` | required | Binding or node that arms the timer when truthy. |
| `:duration-ms` | required | |
| `:reset-on-false` | `true` | If the start input goes false before expiry, cancel and output false. |

Output is boolean. Evaluated on input events and on engine ticks (the 1 Hz unified timer is sufficient for room-pace timeouts).

### 4.15 `:time-bonus`

When `:input` goes true, lock `max * max(0, 1 - elapsed / decay-ms)`. Output is 0 until then. `:start` is `:gameplay` (elapsed from gameplay start) or another node name (elapsed from that node becoming truthy). Integer `:max` rounds to an integer.

```clojure
{:type :time-bonus
 :start :gameplay
 :input :keypad
 :max 100
 :decay-ms 60000}
```

There is no action-side variable store. Accumulators are nodes (`:sum`, `:count-true`, `:time-bonus`).

### 4.16 `:combo-lock`

Continuous analog input (rotary encoder, potentiometer, dial). Target is an ordered list of integer positions. Direction changes mark a "stop."

```clojure
{:type :combo-lock
 :input :rotary/position
 :target [12 34 22 7]
 :jitter-tolerance 2
 :direction-accuracy 1
 :debounce-ms 100
 :reset-on-wrong true}
```

| Field | Default | Meaning |
|---|---|---|
| `:input` | required | Numeric position. |
| `:target` | required | Vector of integer stop positions, in order. |
| `:jitter-tolerance` | `2` | Reversals whose excursion from the current extreme is `<=` this many units are ignored (they do not record a stop). Example: `1-2-3-4-3-4-5-6` with tolerance 2 collapses the `3-4-3-4` jitter, so the lock still sees `…-4-5-6`. |
| `:direction-accuracy` | `1` | A recorded stop matches the next target if `abs(stop - target) <= direction-accuracy`. The recorded value is the actual peak/trough before the reversal, not the target. Example: target `4`, input `2-3-4-5-4` (slight overshoot) registers as a 4 if accuracy ≥ 1, or as a 5 if accuracy is 0. |
| `:debounce-ms` | `0` | Ignore samples closer than this. |
| `:reset-on-wrong` | `true` | A real stop that does not match the next target clears progress. |

**Detection logic (implementation contract):**

1. Track committed direction (`+1` / `-1`) and the extreme (peak/trough) of the current run.
2. Samples that continue in the committed direction update the extreme.
3. A reversal whose distance from the extreme is `<= :jitter-tolerance` is noise: do not record a stop, keep the original direction and extreme.
4. A reversal beyond the jitter band records a stop equal to the extreme, then starts a new run in the new direction.
5. Compare that stop to `target[nextIndex]` within `:direction-accuracy`. Match → advance index. Miss → reset if `:reset-on-wrong`.
6. Output true when `nextIndex === target.length`.

**Please review this spec before depending on `:combo-lock` in a live room.** If a real dial behaves differently (e.g. must reverse a minimum distance, or first number is "pass any direction"), note it here.

### 4.17 `:combo-lock-discrete`

Like `:combo-lock` but for indexed knobs / cipher rings whose input is already a discrete integer.

```clojure
{:type :combo-lock-discrete
 :input :cipher-ring/position
 :target [3 8 1 4]
 :dwell-ms 400
 :debounce-ms 80
 :reset-on-wrong true
 :require-direction false}
```

| Field | Default | Meaning |
|---|---|---|
| `:input` | required | Integer position. |
| `:target` | required | Vector of integer positions. |
| `:dwell-ms` | `400` | A position is a candidate stop after it has been held this long. The stop is committed when the player *leaves* that position (so a pause-and-continue on the correct number counts). |
| `:debounce-ms` | `80` | Ignore chatter shorter than this. |
| `:reset-on-wrong` | `true` | A committed stop that is not the next target clears progress. |
| `:require-direction` | `false` | If true, consecutive stops must reverse direction (classic combination lock). If false, only the position sequence matters. |
| `:direction-accuracy` | `0` | Discrete slack. Default is exact. |

**Please review this spec** if you have a specific discrete dial in mind; dwell-then-leave is the assumed gesture.

---

## 5. Actions

`:on-true` / `:on-false` / `:on-change` reuse the trigger action vocabulary:

- `{:fire "seq-breaker-solved"}` — named cue, sequence, or hint
- `{:zone "wallclock" :command "announce" :bars "{{value}}"}` — inline zone action
- `{:end "win"}` / `{:end "fail"}`
- `{:complete "intro"}` / `"closing"` / `"reset"`
- `{:command "publish" :topic "…" :payload {…}}`

Because `{:end "win"}` is an action, there is no `:gameplay :solve-on` key. The primary-puzzle pattern is a `:sequence` node whose `:on-true` includes `{:end "win"}`.

Logic nodes are also usable as trigger sources (`:source :logic/breaker`) for anything more complex than the three action lists.

---

## 6. Operator commands

Published on `{game-topic}/commands`:

```json
{ "command": "solvePuzzle", "id": "breaker" }
{ "command": "resetPuzzle", "id": "breaker" }
{ "command": "enablePuzzle", "id": "keypad" }
{ "command": "disablePuzzle", "id": "keypad" }
{ "command": "bypassPuzzle", "id": "keypad" }
```

`id` / `puzzle` / `name` are accepted. `solvePuzzle` forces the node output true, honors `:latch`, and fires `:on-true`. `resetPuzzle` clears that node's internal state, output, and bypass. `disablePuzzle` ignores hardware; output stays false unless already latched. `bypassPuzzle` forces true, fires `:on-true` once, and counts toward `:count-true` / `:sum`. Bypassing the SpyCatcher keypad will end the game (`{:end "win"}`).

Game state `{game-topic}/state` includes a `logic` object:

```json
{
  "logic": {
    "breaker": { "type": "match", "output": true, "enabled": true, "bypassed": false },
    "progress-bars": { "type": "scale", "output": 3, "enabled": true, "bypassed": false }
  }
}
```
