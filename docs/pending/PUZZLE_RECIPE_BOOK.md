# Puzzle Recipe Book

Copy-paste EDN for common room puzzles. Each recipe is a 5th-grader description plus the node(s) to drop under `:global :logic`.

Field-by-field contract: [`PUZZLE_SHAPES.md`](PUZZLE_SHAPES.md). Architecture: [`PR_PUZZLE_LOGIC.md`](PR_PUZZLE_LOGIC.md).

Update this file again after Phase 2 (managed helpers) and Phase 3 (include-file scripts).

---

## Breaker panel / magnet map (`:match`)

Six switches. They all have to be in the right on/off pattern at the same time. Order does not matter.

```clojure
:breaker {:type :match
          :inputs [:gpio-events/F1 :gpio-events/F2 :gpio-events/F3
                   :gpio-events/F4 :gpio-events/F5 :gpio-events/F6]
          :target {:F1 0 :F2 1 :F3 0 :F4 1 :F5 0 :F6 1}
          :latch true
          :on-true [{:fire "seq-breaker-solved"}]}
```

Write `:target` in **logical** on/off (`1` = ON). If the GPIO source is `:active-low true`, `"0"` on the wire already became `1` before compare.

---

## Last-N keypad (`:sequence` + `:match-last`)

Players mash keys. Whenever the last N keys equal the code (including `#`), it solves. No enter key, no timeout.

SpyCatcher Moscow uses this: `1234#`.

```clojure
:keypad {:type :sequence
         :input {:source :gpio-events :signal "Keypad"
                 :value-key :key :when {:value "0"} :active-low false}
         :target ["1" "2" "3" "4" "pound"]
         :match-last true
         :latch true
         :on-true [{:fire "seq-keypad-solved"} {:end "win"}]}
```

PxIO key names: `"1"`–`"9"`, `"0"`, `"asterik"`, `"pound"`.

---

## Enter / reset keypad (`:sequence` + `:enter` + `:reset`)

Type digits, then press `#` to check. `*` clears. `#` is **not** part of the code.

Do not set `:match-last` here — startup will error.

```clojure
:keypad {:type :sequence
         :input {:source :gpio-events :signal "Keypad"
                 :value-key :key :when {:value "0"} :active-low false}
         :target ["1" "2" "3" "4"]
         :enter "pound"
         :reset "asterik"
         :timeout-ms 0
         :latch true
         :on-true [{:end "win"}]}
```

`"#"`, `"pound"`, and `"hash"` all mean `#`. `"*"`, `"asterik"`, and `"asterisk"` all mean `*`. Unset or `0` `:timeout-ms` means no timeout.

---

## Gated keypad (`:enable-after`)

The pad does nothing until another puzzle is solved. Optional delay.

```clojure
:keypad {:type :sequence
         :input {:source :gpio-events :signal "Keypad"
                 :value-key :key :when {:value "0"} :active-low false}
         :target ["1" "2" "3" "4" "pound"]
         :match-last true
         :enable-after :breaker
         :enable-delay-ms 2000
         :latch true
         :on-true [{:end "win"}]}
```

While disabled, keys are ignored. If the node was already latched true, it stays true.

---

## Broken prop (`:bypass` / `bypassPuzzle`)

A prop is dead. Treat it as solved so the rest of the room still works. Bypass fires `:on-true` once and counts toward `:count-true` / `:sum`.

In EDN (always bypassed, or auto-solve after a delay):

```clojure
:safe {:type :passthrough
       :input :gpio-events/safe
       :latch true
       :bypass true
       :bypass-delay-ms 0}
```

From the operator UI, publish `{ "command": "bypassPuzzle", "id": "safe" }`. `resetPuzzle` clears bypass.

If you bypass SpyCatcher's `:keypad`, the room **wins** (`{:end "win"}` on that node).

---

## Weighted score + LED bar (`:sum` + `:scale`)

Harder puzzles are worth more points. The wall clock still only has 8 LEDs, so scale the total.

```clojure
:points {:type :sum
         :inputs [{:input :breaker :weight 2}
                  :map
                  {:input :terminal :weight 3}]}

:bars {:type :scale
       :input :points
       :in-min 0 :in-max 6
       :out-min 0 :out-max 8
       :on-change [{:zone "wallclock" :command "announce" :bars "{{value}}"}]}
```

`:sum` is unbounded. Put `:clamp` in between if you need a cap. `:scale` is only a range mapper (floor + clamp to the out range).

---

## Speed bonus (`:time-bonus`)

The faster they solve after gameplay starts, the more points they lock in. After it locks, it never changes.

```clojure
:keypad-bonus {:type :time-bonus
               :start :gameplay
               :input :keypad
               :max 100
               :decay-ms 60000}
```

Formula: `max * max(0, 1 - elapsed / decay-ms)`. `:start` can also be another node name instead of `:gameplay`.

---

## Weight pad in a range (`:threshold`)

Stay between 10 and 40 kg for 1.5 seconds.

```clojure
:pad {:type :threshold
      :input :weight-pad/kg
      :min 10
      :max 40
      :hold-ms 1500
      :latch true}
```

Single crossing: `:op :gte` `:value 40`. `:outside true` means “not in the range.”
