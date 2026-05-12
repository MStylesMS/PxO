# PR: Trigger Variables and Boolean Expressions (Placeholder)

Status: Placeholder for future implementation.

## Why This Exists

Current trigger behavior in PxO supports:
- exact-match payload conditions (`key === value`)
- optional phase guard (`when-phase`)
- action execution on match

This is intentionally simple and stable. More advanced trigger logic is not implemented yet.

## Requested Capabilities

1. Trigger enable/disable by game mode and phase with richer guards.
2. Variable store for gameplay state derived from commands/events.
3. Boolean expression support for trigger conditions:
- comparisons (`==`, `!=`, `>`, `<`, `>=`, `<=`)
- logical operators (`and`, `or`, `not`)
- optional time/window operators.

## Proposed Scope

### Phase 1: Variable Store
- Add in-memory variable registry under state machine ownership.
- Support explicit set/unset commands from cues/sequences.
- Publish variable changes to events topic for observability.

### Phase 2: Expression Engine
- Add a safe, declarative expression evaluator (no dynamic eval).
- Extend trigger schema with expression clauses.
- Keep exact-match map syntax as default for backward compatibility.

### Phase 3: Diagnostics and Tooling
- Startup validation for malformed expressions and unknown variable references.
- Runtime diagnostics for expression failures and short-circuit outcomes.
- Documentation and migration examples.

## Compatibility Constraints

- Existing `:condition { ... }` exact-match rules must remain valid and unchanged.
- Existing trigger actions and source routing behavior must remain unchanged.
- Advanced expressions must be opt-in.

## Open Design Questions

1. Should variables live in state machine only, or be mirrored in a retained MQTT topic?
2. Should expression syntax be native EDN maps, or a constrained DSL string?
3. Do we need persistence of variables across restart/reset boundaries?
4. Should variable writes be restricted to specific command contexts for safety?
