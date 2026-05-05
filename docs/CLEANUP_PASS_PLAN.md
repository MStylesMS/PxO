# PxO Cleanup Pass Plan

## Purpose

This document defines a focused cleanup pass for PxO to improve maintainability, test reliability, internal design consistency, and documentation quality without changing the external MQTT contract or breaking existing EDN configurations.

This plan is intentionally phased so each step can be reviewed and shipped safely.

## Constraints

- Preserve the documented MQTT topic structure and command envelope.
- Preserve EDN backward compatibility unless a change is explicitly approved and documented.
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

## Current Observations

- The default test runner in `test/run-tests.js` only discovers top-level `test/*.test.js` files, so nested suites are easy to miss.
- The repo has strong functional docs, but the docs folder also contains temporary PR-oriented and parking-lot documents that should be separated from durable product documentation.
- There is visible transitional compatibility code across `src/stateMachine.js`, `src/sequenceRunner.js`, `src/modular-config-adapter.js`, and `src/game.js`, which likely contains the highest concentration of dead branches, duplication, and maintenance cost.
- Adapter behavior is not fully normalized across the registry and individual adapter implementations.
- Some documentation references appear stale or incomplete relative to the current docs tree.

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
- Replacing stable, working compatibility behavior without first proving it is unused or redundant.

## Workstreams

### 1. Test Harness And Coverage Baseline

Objective: make the default validation path representative of the real suite.

Planned work:

- Standardize the repo on Jest as the primary test entry point.
- Replace `test/run-tests.js` as the default path so nested tests are discovered consistently.
- Add a clear testing document covering default, focused, contract, integration, and validation commands.
- Audit the current suite for obvious blind spots around adapter behavior, sequence resolution, config validation, and runtime-only flows.
- Add targeted tests before refactoring high-risk code paths.

Acceptance criteria:

- `npm test` exercises the intended core suite, including nested tests where appropriate.
- The supported test commands are documented and match actual behavior.
- High-risk refactor targets have behavior-locking tests before cleanup lands.

### 2. Compatibility Surface Audit

Objective: identify which legacy compatibility paths are still required and which are now dead weight.

Primary files:

- `src/stateMachine.js`
- `src/sequenceRunner.js`
- `src/modular-config-adapter.js`
- `src/game.js`
- `src/template-expander.js`

Planned work:

- Inventory each legacy fallback and classify it as required, deprecated-but-supported, or removable.
- Remove dead branches only when backed by tests or explicit confirmation that the path is obsolete.
- Consolidate repeated normalization and fallback logic into shared helpers where it improves clarity.
- Replace comment-only deprecations with enforceable code paths, warnings, or removal.

Acceptance criteria:

- Legacy support behavior is intentionally documented instead of spread across implicit fallbacks.
- Removable branches are deleted rather than left commented or half-supported.
- Remaining compatibility logic is centralized and covered by tests.

### 3. Adapter And Command Execution Cleanup

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

Objective: reduce complexity in oversized modules without destabilizing behavior.

Primary files:

- `src/game.js`
- `src/stateMachine.js`
- `src/engineUtils.js`
- `src/sequenceRunner.js`

Planned work:

- Extract tightly related helper functions from long classes or modules where ownership is currently mixed.
- Consolidate repeated publish/log/guard patterns in `src/game.js`.
- Review large methods for smaller seams that can be tested independently.
- Remove stale comments that describe previous implementations rather than current behavior.

Acceptance criteria:

- Module boundaries are easier to explain and test.
- Repeated control-flow and publication logic is reduced.
- Method length and branching complexity trend down in the highest-risk files.

### 5. Documentation Cleanup And Information Architecture

Objective: make the durable docs easier to trust and easier to navigate.

Planned work:

- Review the docs folder and classify documents as durable reference, active proposal, or parking-lot material.
- Move completed PR documents and stale planning material into `docs/archive/`.
- Keep open PR documents in place for now, but refresh them when implementation has already moved past the document.
- Add a missing testing/developer workflow document if needed.
- Reconcile README claims with the actual docs tree and command behavior.
- Tighten cross-links between `README.md`, `docs/README.md`, `docs/SPEC.md`, `docs/CONFIG_EDN.md`, `docs/MQTT_API.md`, and setup material.
- Remove stale references to documents that no longer exist.

Acceptance criteria:

- Durable docs are clearly separated from one-off planning notes.
- The docs index reflects the current repo.
- A new contributor can find how to run, validate, test, and extend PxO without reverse-engineering the code.

## Proposed Execution Order

1. Lock down the testing baseline and document the real test matrix.
2. Audit and classify compatibility code before deleting or consolidating it.
3. Refactor adapter execution and command normalization with tests in place.
4. Clean up core orchestrator duplication and oversized local control paths.
5. Finish with documentation consolidation and final consistency checks.

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

1. Switch the default test path to Jest and document the supported test commands.
2. Use the stronger test baseline to drive compatibility cleanup in PxO, with PFx and PxB adjustments only where the contracts intersect.
3. Archive stale documentation in `docs/archive/` during Phase 5 and update any open PR documents that no longer match the code.
