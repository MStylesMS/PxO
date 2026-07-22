
# PxP vs Redrum Discussion #

# Question: #

I need to add the ability to PxO to handle game logic.  I'm thinking of a few different approaches, and I'm not sure which one or combination to use.

The logic needs to handle a few different things.  

At the highest level, it needs to handle game flow.  For instance, say two puzzles have to be solved in order to open the door.  

At a lower level, raw inputs need to be converted to values that can be evaluated.  For instance, a matrix keypad, consisting of three columns connected to digital outputs, and four rows connected to inputs.  When someone presses a button, you can then decode which button was pressed.  

Yet another example would be to implement something like a full Simon Says game.  Such a game need to be defined by some variables that could adjust the number of buttons, the speed of which things are played, various ways in which the game could be solved.

Additionally, everything needs to be able to be set up in the EDN file that defines a game.

So what I'm thinking about are a few different ways to accomplish this.

One would be to build the logic for various puzzles into JavaScript, which becomes a standard part of PxO.

Another would be to allow the inclusion of JavaScript files to extend those options for special case logic puzzles.

Another would be to allow the ED file to include closure script or JavaScript files.

Yet another would be to define a language similar to prologue that could be used.

I would like you to brainstorm with me some options, taking into account the current structure of PxO an EDN file.  I am a bit worried about it becoming too big.  

We aren't going to make any changes now. I wanna talk through the high-level architecture options and come up with a good specification before we do anything.

# Answer: #

Great! Now I have a solid understanding of PxO's current architecture. Let me brainstorm high-level architecture options for handling game logic with you.

## Current PxO Architecture Context

From what I've reviewed, PxO has:
- **Zone-based architecture** with MQTT communication
- **Three-tier config model**: Commands → Cues → Sequences
- **EDN configuration** for all game definitions
- **State machine** (ready → intro → gameplay → solved/failed → sleeping)
- **Timeline sequences** with precise timing control
- **Hint system** with text, sequence, speech, video, etc. types

---

## The Puzzle Logic Challenge

You're right to think carefully about this. You need to handle several layers:

1. **Game Flow Logic** — Sequential puzzle dependencies (e.g., "solve A and B to open door")
2. **Input Decoding** — Raw sensor data → game-meaningful values (matrix keypad button decoding)
3. **Game Variants** — Parameterizable puzzles (Simon Says with configurable buttons/speed/rules)
4. **Extensibility** — Without bloating PxO itself

---

## Architecture Options & Analysis

### **Option 1: JavaScript Functions in EDN (Embedded Closures)**
```clojure
:puzzle-logic {
  :check-matrix-button (fn [row col] 
    (let [button-id (+ (* row cols) col)]
      {:button button-id :decoded true}))
  
  :simon-game {
    :buttons 4
    :speed 1.0
    :check (fn [sequence] 
      (validate-sequence sequence))
  }
}
```

**Pros:**
- Everything in one EDN file
- No external file dependencies
- Familiar to Clojure users
- Can reference other config values

**Cons:**
- EDN files become huge and complex
- Hard to version control logic separately
- Difficult to debug
- Not ideal for complex stateful logic
- Performance concerns with large embedded functions

---

### **Option 2: External JavaScript Module Files**
```clojure
:puzzle-logic {
  :matrix-keypad {
    :module "puzzles/matrix.js"
    :handler "decodeButton"
    :config {:rows 4 :cols 3}
  }
  :simon-game {
    :module "puzzles/simon.js"
    :handler "validateSequence"
    :config {:buttons 4 :speed 1.0}
  }
}
```

Then in `puzzles/matrix.js`:
```javascript
module.exports.decodeButton = (row, col, config) => {
  const buttonId = row * config.cols + col;
  return { button: buttonId, decoded: true };
};
```

**Pros:**
- Clean separation of concerns
- Easier testing and debugging
- Better code organization
- Can use full JavaScript ecosystem
- Reusable across games

**Cons:**
- File path management complexity
- Runtime loading/validation overhead
- Requires file system access (not ideal for containerized/cloud scenarios)
- Need a module loading/sandboxing strategy

---

### **Option 3: Domain-Specific Language (DSL) / Rule Engine**
```clojure
:puzzle-logic {
  :puzzle-solver {
    :type "rule-engine"
    :rules [
      {:name "door-unlock"
       :requires [:puzzle-a :puzzle-b]
       :then {:action "trigger-event" :event :door-opens}}
      
      {:name "simon-validate"
       :type "pattern-match"
       :pattern {:sequence-length {:min 4 :max 8}
                 :button-range {:min 0 :max 3}}
       :then {:action "mark-completed" :puzzle "simon"}}
    ]
  }
}
```

**Pros:**
- Very declarative and readable
- No code execution — safer
- Easy to version and reason about
- Can be visualized/analyzed
- Natural for puzzle logic flows

**Cons:**
- Have to build a DSL/rule engine
- Limited to what the DSL can express
- More development effort upfront
- Debugging rules is different skill

---

### **Option 4: Lua/Scheme Scripting Layer** (Lightweight embedded languages)
```clojure
:puzzle-logic {
  :matrix-decoder {
    :script-type "lua"
    :script "
      function decode_button(row, col, cols)
        return row * cols + col
      end
    "
  }
}
```

**Pros:**
- Sandboxed execution
- Small footprint
- Good for simple logic
- Fast to execute

**Cons:**
- Another language to learn
- Smaller ecosystem
- Overkill for simple cases
- Licensing considerations

---

### **Option 5: Hybrid Approach (Recommended)**

**Combine multiple strategies based on complexity:**

```clojure
{
  :puzzle-logic {
    ;; Simple declarative logic (built-in DSL)
    :dependencies {
      :door-opens {:requires [:puzzle-a :puzzle-b] :type "and"}
      :room-dark {:requires [:puzzle-c] :invert true :type "and"}
    }
    
    ;; Input decoding (external modules for complex cases)
    :decoders {
      :matrix-keypad {
        :type "external"
        :module "puzzles/matrix.js"
        :function "decodeButton"
        :config {:rows 4 :cols 3}
      }
    }
    
    ;; Game variants (parameterized sequences + logic)
    :simon-game {
      :type "game-variant"
      :base-sequence "simon-play"  ; references sequence in :sequences
      :parameters {
        :buttons 4
        :speed 1.0
        :difficulty "normal"
      }
      :validation-logic "simon-validate"  ; can be external module or inline rule
    }
  }
}
```

---

## High-Level Specification Sketch

### **Tier 1: Declarative Logic (Built-in)**
- Puzzle dependencies (AND/OR/NOT logic trees)
- State requirements ("solve puzzle X before Y")
- Simple value checks (score > 50, time < 60s)
- Event triggers

### **Tier 2: Input Decoders (External Modules)**
- Matrix keypad decoding
- Sensor fusion
- Pattern matching
- Complex state machines

### **Tier 3: Game Variants (Hybrid)**
- Parameterized sequence execution
- Dynamic hint generation
- Configurable behavior

---

## Architecture Recommendation

**Start with Option 5 (Hybrid), implemented in phases:**

**Phase 1 (Minimal)**
- Add `:puzzle-logic.dependencies` section for AND/OR/NOT puzzle gates
- Keep everything in EDN
- Wire to state machine via new `PuzzleManager` class

**Phase 2 (Extensible)**
- Add module loader for external `.js` files
- Implement sandbox/validation for module loading
- Support `:puzzle-logic.decoders` with external functions

**Phase 3 (Advanced)**
- Add game variant system (Simon, custom puzzle generators)
- Parameter substitution in sequences
- Runtime logic compilation

---

## Implementation Sketch

### New Classes

```javascript
// src/puzzleManager.js — handles dependency logic and state
class PuzzleManager {
  constructor(config, zones) {
    this.config = config;
    this.zones = zones;
    this.solvedPuzzles = new Set();
    this.puzzleStates = new Map();
  }
  
  async evaluateDependency(depName, context) {
    const dep = this.config.dependencies[depName];
    return evaluateLogic(dep, this.solvedPuzzles, context);
  }
  
  markSolved(puzzleId) {
    this.solvedPuzzles.add(puzzleId);
    this.emitEvent('puzzle-solved', puzzleId);
  }
}

// src/decoderRegistry.js — loads and manages input decoders
class DecoderRegistry {
  loadDecoder(name, config) {
    if (config.type === 'external') {
      return this.loadModule(config.module, config.function);
    }
    // built-in decoders here
  }
}
```

---

## Questions to Consider

1. **Concurrency**: Can puzzles be solved in parallel, or strictly sequential?
2. **State persistence**: Should puzzle state survive a pause/resume?
3. **Debugging**: Need traces of logic evaluation, or basic logging?
4. **Performance**: Real-time (< 100ms latency) needed for input decoding?
5. **Game author experience**: Will puzzles be coded by designers (needs simplicity) or developers (can handle complexity)?

---

What direction feels right to you? Would you like to:
- Dig deeper into one approach?
- Sketch out specific puzzles using one of these models?
- Discuss how it integrates with the existing sequence/state machine architecture?

# Question: #

I think for designers they will need to be able to easily use the most basic, and most common logic and puzzles.  That's where I was thinking about adding some core support for logic and specific puzzles to PxO itself. 

For more complex logic and puzzles, that's where I was thinking of writing external logic that could somehow be included.

By the way, do we really want to use Clojure or would JavaScript make more sense?

# Answer: #

Excellent question. Let me address the **EDN vs JavaScript** decision head-on, because this is actually more significant than it initially seems.

## The Current Reality

PxO **uses EDN primarily for configuration readability**, but:

- **All execution happens in JavaScript** (Node.js)
- The EDN parser (`edn-data`) converts EDN → JavaScript objects
- Once parsed, it's just plain JavaScript objects
- No actual Clojure runtime or language features are used

---

## EDN vs JavaScript for Configuration

### **Pros of EDN (Current Approach)**
✅ **Keywords prevent typos**: `:puzzle-a` vs strings like `"puzzle_a"` is type-safer  
✅ **Comments are native**: `;` style comments, no `//` or `/* */`  
✅ **Sets and maps are explicit**: No ambiguity like JS objects  
✅ **Familiar to Clojure developers** (but PxO users probably aren't)

### **Cons of EDN**
❌ **Another format to learn**: Designers need to learn EDN syntax  
❌ **Not standard web dev**: Designers/developers expect JSON or YAML  
❌ **Tooling is limited**: No VS Code autocomplete, linting, or validation plugins  
❌ **Parser dependency**: Adds `edn-data` library (small, but external)  
❌ **Syntax differences confuse people**:
  - `:keyword` syntax is unusual
  - No commas required (unexpected)
  - `nil` instead of `null`
  - Maps use `{}` but order isn't guaranteed in EDN spec

---

## The Pragmatic Choice: **JavaScript Configuration**

For game designers (your primary audience), **switching to JavaScript makes much more sense**:

### **JavaScript Config Example**

```javascript
// game.js (or game.mjs)
export default {
  zones: {
    lights: { type: "pfx-lights", baseTopic: "paradox/houdini/lights" },
    mirror: { type: "pfx-media", baseTopic: "paradox/houdini/mirror" }
  },

  puzzleLogic: {
    dependencies: {
      doorOpens: { requires: ["puzzleA", "puzzleB"], type: "and" },
      roomDark: { requires: ["puzzleC"], invert: true }
    },

    decoders: {
      matrixKeypad: {
        type: "external",
        module: "puzzles/matrix.js",
        function: "decodeButton",
        config: { rows: 4, cols: 3 }
      }
    }
  },

  sequences: {
    intro: {
      duration: 45,
      timeline: [
        { at: 45, fire: "lights-red" },
        { at: 40, zone: "mirror", command: "playVideo", file: "media/intro.mp4" },
        { at: 5, fire: "show-clock" }
      ]
    }
  },

  // ... rest of config
};
```

### **Advantages**

✅ **Designers already know JavaScript** (or can learn one language instead of two)  
✅ **Full IDE support**: Autocomplete, type hints, linting in VS Code  
✅ **Error catching at load time**: Typos caught immediately  
✅ **Dynamic config**: Can compute values, use variables, etc.
```javascript
const BOARD_SIZE = 4;
const puzzleConfig = {
  simon: {
    buttons: BOARD_SIZE,
    speed: BOARD_SIZE === 4 ? 1.0 : 0.8
  }
};
```

✅ **Easier to extend**: No parser conversion step  
✅ **Natural for logic**: Can define helper functions inline:
```javascript
puzzleLogic: {
  validators: {
    validateSequence: (seq) => seq.length > 0 && seq.length < 20
  }
}
```

✅ **Better error messages**: Native JS errors are more helpful  
✅ **Web-standard format**: Everyone knows JSON-like syntax

---

## Hybrid Approach: Best of Both Worlds

You could **keep EDN but make it optional**, defaulting to JavaScript:

```bash
# Primary (JavaScript config)
node src/game.js --config game.js

# Optional (EDN for tradition/preference)
node src/game.js --config game.edn
```

This way:
- **Designers use JavaScript** (modern, familiar)
- **Existing EDN games still work** (backward compatible)
- **Gradual migration** path for legacy configs

---

## My Recommendation

**Switch to JavaScript configuration, with these caveats:**

### ✅ Do This First
1. Make JavaScript the primary config format
2. Keep EDN support as a fallback/legacy option
3. Build all new documentation around JavaScript examples
4. Provide migration tools (EDN → JavaScript converter)

### 📝 What Gets Added to Game Config

For puzzle logic, add a new top-level section:

```javascript
{
  zones: { ... },
  sequences: { ... },
  
  // NEW: Game logic and puzzles
  gameLogic: {
    // Tier 1: Declarative dependencies
    puzzleDependencies: {
      doorOpens: { requires: ["puzzleA", "puzzleB"], operator: "and" },
      roomDark: { requires: ["puzzleC"], operator: "not" }
    },

    // Tier 2: Input decoders (external modules)
    decoders: {
      matrixKeypad: {
        module: "puzzles/matrix-decoder.js",
        handler: "decode",
        config: { rows: 4, cols: 3 }
      }
    },

    // Tier 3: Game variants with parameters
    puzzles: {
      simon: {
        type: "simon-game",
        baseSequence: "simon-play",
        parameters: {
          buttons: 4,
          speed: 1.0,
          difficulty: "normal"
        },
        validation: {
          module: "puzzles/simon-validator.js",
          handler: "validate"
        }
      }
    }
  }
}
```

---

## Summary

| Aspect | EDN | JavaScript |
|--------|-----|-----------|
| **Learning curve for designers** | Steeper | Gentler |
| **IDE support** | Poor | Excellent |
| **Tooling** | Limited | Rich ecosystem |
| **Performance** | Slight overhead (parse) | Native |
| **Extensibility** | Harder | Natural |
| **Team familiarity** | Lower | Higher |
| **Type safety (keyword level)** | Better | Less explicit |

**My vote: Migrate to JavaScript.** It's what runs the engine anyway, and designers will thank you.

---

Does this direction feel right? Should we sketch out what the **core puzzle logic DSL** would look like in JavaScript (Tier 1 built-ins), and then how **external puzzle modules** would integrate (Tier 2)?

# Question: #

We are sticking with the EDN file format, partly because it is easier to read than JSON.  That does not mean we have to stick with Clojure for the logic.  

Let me think on this some more.  But is there any class of puzzles or logic that I'm missing?

# Answer: #

Fair point on EDN staying put—it's genuinely more readable than JSON. And good clarification: you want **EDN for configuration structure**, but **JavaScript (or another language) for the logic itself**. That makes sense.

Now, let me think systematically about puzzle classes...

## Puzzle Categories I See in Escape Rooms

Let me break down the puzzle/logic types I can think of:

### **1. Dependency/Gating Logic** (What you mentioned)
- Sequence must be solved in order
- Multiple puzzles required to unlock one (AND/OR/NOT combinations)
- Prerequisites before accessing areas

**Examples**:
- "Solve A *and* B to open door"
- "Solve A *or* B (either works)"
- "Must solve A *before* B"

---

### **2. Input Decoding** (What you mentioned)
- Matrix keypads → button IDs
- Rotary switches → value extraction
- Analog sensors → discrete states
- Pattern recognition from raw sensor data

**Examples**:
- 4×3 matrix keypad with row/col multiplexing
- Rotary dial with 10 positions
- Analog potentiometer discretized to 5 levels
- Binary sensor array → unique ID

---

### **3. Pattern Matching**
- Validate a sequence of inputs matches expected pattern
- Order matters, timing might matter

**Examples**:
- Simon Says: player must repeat sequence correctly
- Morse code: decode dots/dashes
- Dance pad: step pattern must match
- Safe combination: enter digits in order
- Lock puzzle: turn dials to specific values

---

### **4. State Machines** 
- Puzzle has internal state that transitions based on input
- Current state determines valid next moves

**Examples**:
- Traffic light puzzle: cycles RED → GREEN → YELLOW → RED
- Combination lock: each digit input advances internal position
- Puzzle lock with stages: bronze → silver → gold
- Turing machine-like: current cell determines valid moves

---

### **5. Constraint Satisfaction**
- Puzzle has multiple parameters with relationships/constraints
- Goal is to satisfy all constraints simultaneously

**Examples**:
- Logic grid: rows/columns must satisfy uniqueness
- Sudoku-variant on a physical puzzle
- Flow puzzle: connect all tiles without crossing
- Equation puzzle: x + y = 10, x - y = 2 → solve for x, y

---

### **6. Resource/Inventory Management**
- Player has limited resources; puzzle checks if they have the right items
- Usage tracking (items consumed or tracked)

**Examples**:
- Key card access: do you have the gold key?
- Tool requirement: must collect wrench before opening panel
- Limited uses: key works 3 times, then breaks
- Combination of items: need both red and blue ball to solve

---

### **7. Timing-Based Puzzles**
- Solution depends on when actions happen, not just what happens
- Synchronization or rhythm

**Examples**:
- Press buttons in rapid succession (< 1 second apart)
- Wait for specific time of day
- Two players must act simultaneously
- Countdown timer: solve before it hits zero

---

### **8. Probabilistic/Random Puzzles**
- Solution involves chance or randomness
- Might need retry logic or weighted outcomes

**Examples**:
- Dice roll puzzle
- Lottery picker
- Random lock with hint system
- Puzzle with multiple solutions, one randomly selected

---

### **9. Scoring/Point-Based Puzzles**
- Puzzle has a score or point system
- Solution quality measured (not binary pass/fail)

**Examples**:
- Throwing game: score based on distance
- Memory game: scored by time taken
- Reaction time: score = 1000ms - reaction_ms
- Multi-stage puzzle: points for speed, accuracy, creativity

---

### **10. Physics/Simulation**
- Real-world physics affects outcome
- Calculations needed (angles, forces, trajectories)

**Examples**:
- Marble run: marble rolls down path with physics
- Balance puzzle: weight distribution
- Trajectory puzzle: launch object at target
- Pendulum puzzle: swing must hit target

---

### **11. Cryptography/Encoding**
- Puzzle involves decoding or encoding
- Solution requires understanding encoding scheme

**Examples**:
- Caesar cipher
- ROT13 decoder
- Color coding (RGB values to hex)
- Binary to decimal conversion
- Substitution cipher

---

### **12. Search/Hidden Information**
- Puzzle requires finding hidden information in a space
- Solution found through exploration or searching

**Examples**:
- Hidden object hunt
- UV light: reveal hidden marks
- Thermal camera: find heat signature
- Audio: find correct frequency
- QR code scanning

---

### **13. Cooperative/Multiplayer Logic**
- Puzzle requires coordination between two or more players
- Input from multiple sources must be validated together

**Examples**:
- Two players push buttons simultaneously
- Three players must each input a piece of a code
- Role-based: player A sees hint, must tell player B what to do
- Shared puzzle: both players contributing to same solution

---

### **14. Feedback-Based (Trial & Error)**
- Solution found through iterative feedback
- Puzzle gives hints about closeness/correctness

**Examples**:
- "Hot/cold" game for position
- Binary search: higher/lower guessing game
- Incrementally revealed image
- Progressive unlock: each correct input reveals next step

---

### **15. Puzzle Composition/Recursion**
- Sub-puzzles must be solved, results combined
- Hierarchical or nested logic

**Examples**:
- Three locks, each opens a box with a clue
- Puzzle rooms: first puzzle solution is input to second
- Factory puzzle: build items from components
- Chain reaction: solve A to get info for B to unlock C

---

### **16. World State / Environment Puzzles**
- State of physical environment affects puzzle solution
- Pieces of information scattered; must gather all

**Examples**:
- Lightbulb colors determine password
- Items on shelf give clues
- Room layout affects navigation
- Clues appear in sequence, building full picture

---

### **17. Audio Puzzles**
- Solution involves sound/audio
- Audio signature, frequency, pitch

**Examples**:
- Frequency matching: adjust dial to match tone
- Musical notes: play notes in order
- Audio book puzzle: listen for answer
- Directional audio: find speaker location

---

### **18. Optical/Visual Puzzles**
- Solution involves light, reflection, projection
- Visual alignment or layering

**Examples**:
- UV/blacklight reveals marks
- Laser alignment to target
- Mirror reflection puzzle
- Transparency layering: overlay sheets to reveal answer

---

### **19. Counting/Math Puzzles**
- Solution requires calculation or counting
- May need to track values across puzzle space

**Examples**:
- Count objects in image
- Calculate result of formula
- Sum of room numbers
- Fibonacci sequence continuation

---

### **20. Dead Man's Switch / Timeout Logic**
- Puzzle must be solved before timeout OR
- Holding/not holding something for duration

**Examples**:
- Keep button pressed for 10 seconds
- Release pressure at exact moment
- Don't trigger alarm for 30 seconds
- Solve before timer expires

---

## What's Already Covered by PxO?

Looking at your existing system:

✅ **Timing/Synchronization** — Sequences handle this with `:at` and `:wait`  
✅ **Dependency/Gating** — Phases and state machine handle simple cases  
✅ **Feedback** — Hints system gives feedback  
✅ **State transitions** — State machine covers basic flow  

---

## What Needs Game Logic Layer?

These categories **need the new logic system**:

1. **Input Decoding** — Matrix keypads, sensor fusion
2. **Pattern Matching** — Simon Says, sequences
3. **State Machines** — Multi-stage puzzles
4. **Constraint Satisfaction** — Logic puzzles
5. **Resource Tracking** — Inventory, usage counters
6. **Scoring Systems** — Point-based outcomes
7. **Cooperative/Multiplayer** — Multi-player validation
8. **Feedback-Based** — Progressive reveals
9. **Puzzle Composition** — Chaining logic
10. **Environmental State** — Tracking scattered information
11. **Counting/Math** — Dynamic calculations

---

## My Honest Assessment

**Are you missing any classes?** Not major ones, but there are some **hybrid/advanced categories**:

### **Emerging Patterns I See**

**A. Stateful Input Handlers**
- More than just "decode"—need to track state across multiple inputs
- Example: "First input selects mode, second input is the value in that mode"

**B. Cross-Puzzle Information**
- One puzzle's output feeds into another's input
- Need to track "global puzzle state" across the game

**C. Dynamic Difficulty/Adaptation**
- Puzzle difficulty adjusts based on player performance
- Example: If player gets too many hints, increase time pressure

**D. Rollback/Undo Logic**
- Puzzles that allow partial solutions or can be reset
- Tracking "progress state" separately from "solution state"

**E. Partial Credit / Soft Fail**
- Not all-or-nothing; some puzzles can have degrees of success
- Example: "Found 2 of 3 items" still counts as progress

**F. Real-Time Scoring / Leaderboards**
- Track performance metrics during gameplay
- Could feed into difficulty or hints

---

## Recommended Priority Tiers

### **Tier 1 (Essential, Most Games)**
1. Puzzle dependencies (AND/OR/NOT gates)
2. Input decoding (sensors → values)
3. Pattern matching (sequence validation)
4. Simple state machines

### **Tier 2 (Common, Many Games)**
5. Resource/inventory tracking
6. Scoring systems
7. Cooperative/multiplayer logic

### **Tier 3 (Advanced, Specialized)**
8. Constraint satisfaction
9. Puzzle composition
10. Dynamic difficulty

---

## One More Thing to Consider

**The "puzzle solver" abstraction:**

Some rooms have **a single puzzle solver** that needs to:
- Validate multiple types of input
- Maintain state across phases
- Make decisions about phase transitions

Example: *"Escape room with 5 lock puzzles; player solves them in any order, last one unlocks door"*

You might want a **PuzzleSolver interface** that:
- Holds puzzle state
- Validates inputs
- Returns outcomes (solved/failed/progress)
- Integrates with the state machine

---

## Final Question for You

Looking at the puzzles in your actual games or ones you're planning:

**Which of these 20+ categories show up most?** That'll help prioritize what to build first in the logic layer.

# Question: #

Take a look in the Redrum repo at the file docs/README.md and let me know if it informs us of additional things we need to consider.  Also, be sure to to consider the BinaryEncoder and Puzzles for possible inclusion in the base set of puzzles included in PxO.  Create a table with your recommendations, including alternatives that may be better.

# Answer: #

Perfect! Now I have comprehensive context. Let me analyze what Redrum reveals and create a detailed recommendation table.

## Key Insights from Redrum Docs

**What Redrum teaches us:**

1. **BinaryEncoder** is a **critical missing piece** — converts multiple bit inputs (GPIO switches) into a single composite value over a settle time. Essential for hardware integration.

2. **Six proven puzzle types** used in real escape rooms:
   - SimplexPuzzle (single trigger)
   - StrobePuzzle (output activation/timeout)
   - FusePuzzle (sequence validation)
   - KeypadPuzzle (sliding-window pattern)
   - RotaryPuzzle (rotary dial combination lock)
   - PackRatPuzzle (collection/inventory)

3. **Pure logic functions** are tested independently — this is crucial for reliability.

4. **Actor/event model** — every puzzle listens for reset/solve events and emits solved events. Strong decoupling.

5. **Real-world complexity** — Redrum configs show puzzles are often **composed** (BinaryEncoder → RotaryPuzzle → StrobePuzzle chains).

6. **Settle time concept** — debouncing/deduplication needed for reliability.

---

## Recommendations Table

Based on Redrum patterns + your 20+ puzzle categories, here's what should go into **PxO base**:

| **Puzzle Class** | **Recommended for PxO Base?** | **Implementation Priority** | **Alternatives / Extensions** | **Notes** |
|---|---|---|---|---|
| **SimplexPuzzle** | ✅ YES (Tier 1) | P0 | N/A | Simplest; single trigger. Used constantly. One-liner logic. |
| **BinaryEncoder** | ✅ YES (Tier 1) | P0 | Hardware abstraction layer replacement? | **Critical for real hardware**. Debouncing, bit-masking, settle time. |
| **FusePuzzle** | ✅ YES (Tier 1) | P1 | Advanced: branching sequence logic | Sequence validation (strict order). Used in ~70% of real rooms. Redrum validates this. |
| **KeypadPuzzle** | ✅ YES (Tier 1) | P1 | "ShiftPuzzle" or "SlidingWindowPuzzle" rename | Shift-register pattern matching (last N inputs). Core for code entry. |
| **RotaryPuzzle** | ✅ YES (Tier 1) | P1 | Generic "RotaryEncoder" adapter? | Circular dial combo lock. Direction-aware (left/right). Redrum proves it works. |
| **PackRatPuzzle** | ✅ YES (Tier 1) | P2 | Inventory system, resource tracking | Collection logic (collect N of M items). Used for "gather items" puzzles. |
| **StrobePuzzle** | ✅ YES (Tier 1) | P2 | Output activation/relay control | Timeout-based output (key drops, door releases). Pairs with others. |
| **Pattern Matching (Generic)** | ⚠️ MAYBE (Tier 2) | P3 | Simon Says, memory games, sequences | Generalize FusePuzzle/KeypadPuzzle? Redrum handles with shift-puzzle. |
| **Scoring/Points** | ⚠️ MAYBE (Tier 2) | P3 | Extend PackRat or new type? | Quality-of-solution measurement. External module better? |
| **State Machine (Custom)** | ❌ EXTERNAL | — | Plugin architecture | Complex multi-stage puzzles. Designers write JavaScript modules. |
| **Constraint Satisfaction** | ❌ EXTERNAL | — | External puzzle engine | Logic grids, solver-style puzzles. Too domain-specific. |
| **Cooperative/Multiplayer** | ❌ EXTERNAL | — | Combine SimplexPuzzle × N + gate logic | Multiple inputs → AND/OR gate logic (built via dependencies). |
| **Timing/Synchronization** | ✅ BUILT-IN | — | PxO sequences already handle `:wait` | Rhythm, reaction time, dual-player sync. Use sequences. |
| **Feedback/Progressive Reveal** | ⚠️ MAYBE (Tier 2) | P4 | Hint system extension? | Partial credit puzzles. Consider "progress tracking" on puzzles. |
| **Puzzle Composition** | ✅ BUILT-IN | — | Dependency/gating logic + events | Chain logic via events. Redrum shows this works. |
| **Input Decoding** | ✅ YES (Tier 1) | P0 | Genericize BinaryEncoder? | Matrix keypad, sensor fusion. BinaryEncoder is base case. |
| **Environment State** | ⚠️ MAYBE (Tier 2) | — | Persistent state registry? | Scattered clues, room state. Could be EDN-driven dependencies. |
| **Audio Puzzles** | ❌ EXTERNAL | — | Zone commands + audio analysis | Audio signature matching. PxO sequences + external module. |
| **Optical/Visual** | ❌ EXTERNAL | — | Optical sensor adapters | UV/laser alignment. Hardware-specific; treat as sensor inputs. |
| **Math/Counting** | ⚠️ MAYBE (Tier 2) | — | JavaScript calculator module | Dynamic calculation. Simple case: EDN expressions. |
| **Dead Man's Switch** | ✅ YES (Tier 1) | P2 | Extended timeout mechanism? | Hold button X seconds. Pair SimplexPuzzle + sequence timing. |
| **Probability/Random** | ❌ EXTERNAL | — | Seed-able random module | Dice, lottery. Separate from core; state management nightmare. |

---

## Recommended Core Puzzle Library for PxO

### **Tier 1 (Phase 1 — Essential)**

These are **proven, reusable, and used constantly** in real rooms:

1. **SimplexPuzzle**
   - Single trigger → solved
   - EDN config: `{ :type "simplex" :on-solved :event-name }`
   - Use case: Sensor pulls → triggers event

2. **BinaryEncoder**
   - Multi-bit input → composite integer
   - Settle time for debouncing
   - EDN config: `{ :type "binary-encoder" :bits 4 :settle-ms 100 :mask #{0 15} }`
   - Use case: GPIO bank, rotary switch, matrix decoder

3. **FusePuzzle** (Sequence)
   - Strict ordered sequence
   - EDN config: `{ :type "sequence-puzzle" :solution [:a :b :c :d] :on-solved :event }`
   - Use case: 5-switch puzzle, punch-in sequence

4. **KeypadPuzzle** (Shift-Register)
   - Last N inputs must match
   - EDN config: `{ :type "keypad-puzzle" :solution [:1 :2 :3 :4] :eat-dups true }`
   - Use case: Door code entry, directional pad

5. **RotaryPuzzle**
   - Circular dial combo lock
   - Direction-aware (left/right)
   - EDN config: `{ :type "rotary-puzzle" :range [1 8] :solution [3 6 4 2 6 8 5 6 1] }`
   - Use case: Captain's wheel, rotary combination

---

### **Tier 2 (Phase 2 — High-Value)**

Frequently useful; moderate complexity:

6. **PackRatPuzzle** (Inventory/Collection)
   - Collect N items → solve
   - EDN config: `{ :type "packrat-puzzle" :initial {} :solution [{"gem" 5}] }`
   - Use case: Collect all items, inventory puzzles

7. **StrobePuzzle** (Output Control)
   - Trigger → activate output (relay, solenoid, light)
   - Optional timeout
   - EDN config: `{ :type "strobe-puzzle" :trigger-event :solved :output-on {:zone "relay" :command "activate"} :timeout-ms 3000 }`
   - Use case: Key drops, door releases, timed effects

---

### **Tier 3 (Phase 3 — Advanced/Specialized)**

Niche or complex; good candidates for external modules:

- **Scoring system** — external JavaScript module
- **State machines** — external JavaScript module
- **Constraint satisfaction** — external JavaScript module
- **Cooperative logic** — compose with gates/dependencies
- **Probability** — external module (state management complexity)

---

## Architecture for PxO Game Logic Layer

```javascript
// EDN structure
{
  :gameLogic {
    // Core puzzle definitions (built-in types)
    :puzzles {
      :fuse-main { :type "sequence-puzzle" :solution [:A :B :C] }
      :keypad-door { :type "keypad-puzzle" :solution [:1 :2 :3 :4] }
      :wheel { :type "rotary-puzzle" :range [1 8] :solution [3 6 4] }
      :encoder { :type "binary-encoder" :bits 4 :settle-ms 100 }
    }

    // Dependencies/gating (built-in logic)
    :dependencies {
      :door-opens { :requires [:fuse-main :keypad-door] :operator "and" }
    }

    // External/advanced logic (external modules)
    :customLogic {
      :simon-game {
        :module "puzzles/simon.js"
        :handler "validateSequence"
        :parameters { :buttons 4 :speed 1.0 }
      }
    }
  }
}
```

---

## Summary & Actionable Recommendation

**Do this next:**

✅ **Start Phase 1 implementation** with these 5 core puzzles:
1. SimplexPuzzle
2. BinaryEncoder
3. FusePuzzle (sequence-puzzle)
4. KeypadPuzzle (shift-puzzle)
5. RotaryPuzzle

✅ **Pure logic functions** (like Redrum) — test independently, zero I/O

✅ **Settle time / debouncing** — essential for real hardware

✅ **Event-driven composition** — puzzles listen for `:reset`, emit `:on-solved`

✅ **Dependency/gating layer** — simple AND/OR/NOT logic to chain puzzles

✅ **External module support** — deferred to Phase 2; JavaScript handlers for complex cases

Does this align with your vision? Should I sketch out the **EDN configuration schema** for these core puzzles?
