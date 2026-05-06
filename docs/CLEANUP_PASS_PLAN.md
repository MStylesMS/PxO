# PxO Cleanup Pass Plan

## Purpose

This document defines a focused cleanup pass for PxO to improve maintainability, test reliability, internal design consistency, and documentation quality while preserving the external MQTT contract and intentionally removing pre-release legacy compatibility code before customer release.

This plan is intentionally phased so each step can be reviewed and shipped safely.

## Constraints

- Preserve the documented MQTT topic structure and command envelope.
- Remove legacy EDN/runtime compatibility paths that are no longer needed for the customer release baseline.
- Prefer cleanup that reduces complexity at the ownership boundary instead of broad rewrites.
- Update docs in the same change set whenever behavior or supported patterns change.
- Avoid speculative refactors that do not improve readability, correctness, or testability.

## Working Assumptions

- The documentation cleanup goal includes consolidating temporary planning notes, removing stale references, reducing overlap between docs, and adding any missing durable documentation needed by future contributors.
- This pass is centered on PxO, but it may include coordinated cleanup in PFx and PxB where their code or docs intersect directly with PxO behavior.
- No public contract changes should be made during this pass without an explicit doc update and approval.

## Approved Decisions

- This cleanup pass may touch PFx and PxB where they intersect with PxO.
- Completed PR documents and out-of-date planning material should be moved to `docs/archive/` during the documentation phase.
- Open PR documents may remain in place for now, but they should be updated if the underlying work has already landed.
- Jest is the canonical test runner for this repo going forward.
- No compatibility layers have been pre-designated as untouchable.
- PxO should ship as a clean build for customer release, using the two in-house games as migration and validation targets rather than preserving legacy compatibility shims.

## Current Observations

- The Jest baseline is now in place for `npm test`, `npm run test:unit`, and focused slice runs, and the supported commands are documented in `docs/TESTING.md`.
- Named dispatch has been simplified around `:fire` for cues, sequences, and hints, and trigger `:actions` now use the same executable action vocabulary instead of legacy typed trigger-only syntax.
- Schedules are now enforced as phase-only containers in runtime, validation, tests, and docs; nested schedules were intentionally deferred to a proposal document instead of being partially implemented.
- The remaining cleanup pressure is concentrated in oversized orchestrator modules and adapter/registry normalization rather than in the EDN execution contract.
- The docs folder still contains proposal and planning material that should be triaged into durable reference, active proposal, and archived history.

## Status Snapshot

- Completed: Jest is the default test runner, the test matrix is documented, and focused regression tests were added for trigger execution and config validation.
- Completed: legacy named-dispatch aliases were removed in favor of the clean `:fire` contract for cues, sequences, and hints.
- Completed: trigger actions were migrated to shared executable syntax, active room EDN files were updated, and the docs were aligned to the new contract.
- Completed: schedules are now consistently treated as phase-only, with direct schedule execution rejected in runtime and validation.
- In progress: broader orchestrator cleanup still needs to reduce duplication and complexity in `src/game.js`, `src/stateMachine.js`, and related helpers.
- In progress: documentation cleanup still needs a final archive pass for stale planning material and proposal docs that no longer reflect open work.
- Not started: adapter/registry normalization remains the largest untouched engineering cleanup slice.

## Goals

1. Remove dead or superseded code where support is no longer required.
2. Consolidate duplicated logic into shared helpers at the right abstraction boundary.
3. Improve code organization and internal contracts so behavior is easier to reason about and test.
4. Strengthen the test suite so default validation catches more regressions.
5. Tighten the documentation set so it is easier to navigate and more obviously current.

## Non-Goals

- Rewriting the engine architecture in one pass.
- Changing the MQTT contract, zone command envelope, or EDN schema unless separately approved.
- Large-scale stylistic churn with no maintenance benefit.
- Reintroducing compatibility shims for removed pre-release syntax that the clean-build release no longer supports.

## Workstreams

### 1. Test Harness And Coverage Baseline

Status: substantially complete

Objective: make the default validation path representative of the real suite.

Planned work:

- Audit the current suite for obvious blind spots around adapter behavior, sequence resolution, config validation, and runtime-only flows.
- Add targeted tests before refactoring high-risk code paths.

Acceptance criteria:

- `npm test` exercises the intended core suite, including nested tests where appropriate.
- The supported test commands are documented and match actual behavior.
- High-risk refactor targets have behavior-locking tests before cleanup lands.

### 2. Compatibility Surface Audit

Status: partially complete

Objective: identify and remove pre-release compatibility paths that are now dead weight.

Primary files:

- `src/stateMachine.js`
- `src/sequenceRunner.js`
- `src/modular-config-adapter.js`
- `src/game.js`
- `src/template-expander.js`

Planned work:

- Continue inventorying remaining legacy fallbacks outside the already-cleaned named-dispatch and trigger paths.
- Use the in-house games and focused tests to validate migrated behavior instead of preserving compatibility shims.
- Consolidate repeated normalization and fallback logic into shared helpers where it improves clarity.
- Replace comment-only deprecations with removal.

Acceptance criteria:

- Removed compatibility branches are deleted rather than left commented or half-supported.
- Remaining supported behavior matches the intended release baseline and is covered by tests.

### 3. Adapter And Command Execution Cleanup

Status: not started

Objective: make command execution consistent across adapters and registry layers.

Primary files:

- `src/adapters/adapterRegistry.js`
- `src/adapters/*`
- `src/mqttClient.js`

Planned work:

- Standardize adapter execution shape and error handling expectations.
- Normalize command naming and translation in one place instead of scattering case and alias handling.
- Remove duplicate registry logic where direct method dispatch and adapter execution overlap unnecessarily.
- Add or clarify capability reporting for adapters that currently behave inconsistently.

Acceptance criteria:

- Adapter execution follows one clear contract.
- Errors and capability checks behave consistently across adapter types.
- Command normalization has a single obvious ownership point.

### 4. Core Orchestrator Refactor For Local Clarity

Status: in progress

Objective: reduce complexity in oversized modules without destabilizing behavior.

Primary files:

- `src/game.js`
- `src/stateMachine.js`
- `src/engineUtils.js`
- `src/sequenceRunner.js`

Planned work:

- Extract tightly related helper functions from long classes or modules where ownership is currently mixed.
- Consolidate repeated publish/log/guard patterns in `src/game.js`.
- Consolidate the remaining named-dispatch normalization and command-routing seams that still straddle `src/game.js`, `src/stateMachine.js`, and `src/sequenceRunner.js`.
- Review large methods for smaller seams that can be tested independently.
- Remove stale comments that describe previous implementations rather than current behavior.

Acceptance criteria:

- Module boundaries are easier to explain and test.
- Repeated control-flow and publication logic is reduced.
- Method length and branching complexity trend down in the highest-risk files.

### 5. Documentation Cleanup And Information Architecture

Status: in progress

Objective: make the durable docs easier to trust and easier to navigate.

Planned work:

- Review the docs folder and classify documents as durable reference, active proposal, or parking-lot material.
- Move completed PR documents and stale planning material into `docs/archive/`.
- Keep open PR documents in place for now, but refresh them when implementation has already moved past the document.
- Reconcile README claims with the actual docs tree and command behavior.
- Tighten cross-links between `README.md`, `docs/README.md`, `docs/SPEC.md`, `docs/CONFIG_EDN.md`, `docs/MQTT_API.md`, and setup material.
- Remove stale references to documents that no longer exist.

Acceptance criteria:

- Durable docs are clearly separated from one-off planning notes.
- The docs index reflects the current repo.
- A new contributor can find how to run, validate, test, and extend PxO without reverse-engineering the code.

## Proposed Execution Order

1. Finish the remaining compatibility audit outside the already-cleaned `:fire` and trigger execution paths.
2. Refactor adapter execution and command normalization with focused tests in place.
3. Clean up the remaining oversized orchestrator control paths in `src/game.js`, `src/stateMachine.js`, and `src/sequenceRunner.js`.
4. Finish with documentation consolidation, archive triage, and final consistency checks.

## Validation Strategy

- Run focused tests for each touched slice before widening scope.
- Keep behavior-locking tests close to any compatibility path being simplified.
- Use config validation and selected runtime smoke checks for sequence and adapter changes.
- Do at least one full repo test pass before closing the cleanup pass.
- Review doc changes for contract drift against `docs/SPEC.md`, `docs/CONFIG_EDN.md`, and `docs/MQTT_API.md`.

## Likely Deliverables

- Updated test entry points and improved default coverage.
- Removed dead or redundant compatibility code where safe.
- Shared helpers for repeated publish, normalization, and validation logic.
- More consistent adapter execution behavior.
- Cleaned and reorganized documentation set, including a dedicated testing/workflow doc if warranted.

## Immediate Next Steps

1. Finish the compatibility audit in the remaining runtime paths, especially `src/modular-config-adapter.js`, `src/template-expander.js`, and any leftover normalization branches in `src/stateMachine.js` and `src/sequenceRunner.js`.
2. Start the adapter/registry cleanup with behavior-locking tests around command normalization, capability checks, and error handling.
3. Do a docs triage pass to move completed proposal material into `docs/archive/` and update any still-open PR docs so they match the code that now exists.
