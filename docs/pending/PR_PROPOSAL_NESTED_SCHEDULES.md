# Nested Schedules Proposal

## Status

Deferred proposal. This document captures the future work required if PxO later adopts nested schedules with parent-relative timing.

## Problem

PxO currently treats schedules as phase-only timed containers. That keeps the runtime simple and predictable, but it means reusable timed subflows must be modeled as sequences rather than schedules. If future room-authoring needs demand timed subflows that can be reused from triggers, hints, sequences, or other schedules, the runtime will need a first-class nested schedule model.

## Goal

Allow a schedule to run relative to its immediate parent container instead of only relative to a gameplay phase countdown.

Parent containers that could eventually host nested schedules:

- phases
- sequences
- hints
- schedules

Cues remain excluded because they are intended to stay atomic and immediate.

## Non-Goals

- Changing the MQTT topic contract
- Reworking cue semantics
- Adding implicit backward compatibility for legacy trigger action syntax
- Allowing unbounded recursive timing graphs

## Proposed Authoring Model

The current phase-only model would remain valid. Additional nested usage would allow schedules to appear as executable entries inside a parent container.

Illustrative direction only:

```clojure
:sequences {
  :warning-sequence {
    :sequence [
      {:fire "show-warning"}
      {:schedule "countdown-warning-schedule"}
    ]
  }

  :countdown-warning-schedule {
    :duration 15
    :schedule [
      {:at 15 :fire "warning-start"}
      {:at 5 :fire "warning-final"}
    ]
  }
}
```

This proposal deliberately does not commit to final EDN shape. The important behavior is that each nested schedule uses a countdown relative to the immediate parent that invoked it.

## Runtime Requirements

### 1. Nested Clock Contexts

PxO would need a generalized timer context instead of the current phase-owned `_phaseSchedules` model.

Each active schedule instance would need:

- a stable runtime id
- a parent runtime id, if nested
- a resolved duration
- a current remaining time
- a registry of pending entries
- a termination reason on completion or cancellation

### 2. Parent-Relative Time

When a nested schedule starts, its countdown begins relative to the parent invocation point, not the outer gameplay phase clock.

Examples:

- a schedule fired from a trigger starts immediately at its own duration
- a schedule fired from a sequence starts when that sequence step executes
- a schedule fired from another schedule starts when the parent entry fires

### 3. Lifecycle Cleanup

The runtime must define what happens when a parent container ends early.

Questions that need explicit answers:

- Does a child schedule cancel automatically when the parent sequence fails?
- Does a child schedule survive phase transitions?
- What happens when an abort or reset interrupts active nested schedules?

The likely safe default is parent-owned cleanup: when a parent ends, all descendant schedules are canceled.

### 4. Blocking Semantics

Nested schedule invocation needs a consistent rule:

- fire-and-forget
- blocking until the nested schedule completes

This decision changes sequence behavior materially. A blocking model is more predictable for sequencing, but a non-blocking model may be more natural for trigger-driven background timers. This needs an explicit contract decision before implementation.

### 5. Recursion Protection

The current sequence runner already has depth and cycle protection. Nested schedules would need an equivalent protection model across all executable container types.

The runtime must detect:

- direct schedule self-reference
- indirect schedule cycles through sequences or hints
- excessive depth even without an explicit cycle

## Validation Requirements

The validator would need to expand from simple shape validation to graph-aware validation for schedule references.

Minimum checks:

- reject direct recursive schedule nesting
- reject indirect cycles across schedules, sequences, and hints
- enforce maximum nesting depth
- validate that nested schedule targets resolve to actual schedule definitions
- validate blocking versus non-blocking usage rules once that contract is chosen

Validation must continue collecting all detected errors before failing startup, consistent with current PxO validation behavior.

## Code Areas Likely Impacted

- `src/stateMachine.js`
- `src/sequenceRunner.js`
- `src/validators/configValidator.js`
- `src/game.js`
- `docs/CONFIG_EDN.md`
- `docs/SPEC.md`
- `docs/USER_GUIDE.md`

## Testing Requirements

Minimum test coverage for a future implementation:

- validator tests for direct and indirect recursive nesting
- runtime tests for parent-relative time calculations
- runtime tests for cancellation on abort/reset/phase transition
- blocking versus non-blocking behavior tests for sequences invoking nested schedules
- room-config validation tests for both in-house games
- full unit baseline and targeted integration coverage

## Migration Considerations

The current phase-only schedule model is simpler and already documented. If nested schedules are added later, the migration should be additive at first, not a forced rewrite.

Recommended migration posture:

1. Preserve current phase-only schedules unchanged.
2. Add nested schedule support behind a clearly documented contract.
3. Expand validator guidance and examples before encouraging adoption in shipped room configs.

## Risks

- Higher runtime complexity in the orchestration core
- Harder debugging when multiple short-lived schedule contexts are active
- Increased chance of hidden recursion or leaked timers
- More subtle operator-facing behavior during abort/reset flows
- Larger test surface and more maintenance cost than the current phase-only model

## Recommendation

Do not implement nested schedules as part of the current trigger-action cleanup. Keep schedules phase-only for now, and revisit this proposal only if room-authoring needs clearly justify the added runtime complexity.
