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
- Keep dual support for canonical MQTT game commands and `*Game` aliases for now (`start`/`startGame`, `reset`/`resetGame`, etc.).
- Keep `fadeTime` compatibility in adapter-facing clock/media command payloads for now.

## Current Observations

- The Jest baseline is now in place for `npm test`, `npm run test:unit`, and focused slice runs, and the supported commands are documented in `docs/TESTING.md`.
- Named dispatch has been simplified around `:fire` for cues, sequences, and hints, and trigger `:actions` now use the same executable action vocabulary instead of legacy typed trigger-only syntax.
- Schedules are now enforced as phase-only containers in runtime, validation, tests, and docs; nested schedules were intentionally deferred to a proposal document instead of being partially implemented.
- Recent runtime cleanup removed the gameplay-duration fallback, the deprecated PFx audio `audio` payload field, and the legacy `game.ini` INI auto-discovery path.
- The primary docs/contract sweep is complete: canonical command names, `--edn` vs `--config`, and `pxo.ini` lookup order are now aligned in the core docs.
- The remaining cleanup pressure is concentrated in duplicated sequence resolution, modular config normalization bridges, a few test-era compatibility wrappers, and transitional hint/topic plumbing rather than in the EDN execution contract.
- Agent22 and Houdini room configs already use `system-sequences` and `command-sequences`, which lowers risk for removing some older modular adapter bridges.
- Agent22 and Houdini operator UIs already publish canonical wire commands for emergency actions, but both still normalize hint metadata through `description`, `displayText`, `baseText`, and `text`, so the hint contract remains the main cross-repo compatibility edge.
- The docs folder still contains proposal and planning material that should be triaged into durable reference, active proposal, and archived history.

## Status Snapshot

- Completed: Jest is the default test runner, the test matrix is documented, and focused regression tests were added for trigger execution and config validation.
- Completed: legacy named-dispatch aliases were removed in favor of the clean `:fire` contract for cues, sequences, and hints.
- Completed: trigger actions were migrated to shared executable syntax, active room EDN files were updated, and the docs were aligned to the new contract.
- Completed: schedules are now consistently treated as phase-only, with direct schedule execution rejected in runtime and validation.
- Completed: ingress command cleanup now normalizes public aliases once at MQTT ingress while keeping the aliases intentionally supported.
- Completed: legacy gameplay-duration fallback was removed from `src/game.js`.
- Completed: PFx adapter audio payloads now publish canonical `file`-based commands only.
- Completed: legacy `game.ini` INI auto-discovery fallback was removed and the loader/docs were aligned to `pxo.ini`.
- Completed: the core command/config documentation set was reconciled with the current runtime contract.
- Completed: duplicated sequence lookup now resolves through one shared runner path, with `resolveSequence()` retained only as a compatibility wrapper.
- Completed: modular config no longer promotes legacy `global.sequences` / `game-actions` into canonical runtime registries.
- Completed: the `executeSchedule` compatibility wrapper was removed in favor of direct phase schedule registration.
- Completed: text hint execution now requires explicit `text` instead of falling back to `description` / `displayText` metadata.
- Completed: the transitional `cfg.global.mqtt.uiTopics` backfill/fallback seam was removed from `src/game.js`.
- Completed: orphaned dead code in `src/media/MediaController.js` was removed.
- In progress: broader orchestrator cleanup still needs to reduce duplication and complexity in `src/game.js`, `src/stateMachine.js`, `src/sequenceRunner.js`, and related helpers.
- In progress: documentation cleanup still needs a final archive pass for stale planning material and proposal docs that no longer reflect open work.
- Not started: adapter/registry normalization remains the largest untouched engineering cleanup slice.

## Approved Follow-On Scope

Selected by current review:

- Deferred: keep dual support for canonical game commands and `*Game` aliases.
- Completed: collapsed the duplicated sequence lookup/resolution path in `src/sequenceRunner.js` and removed the fallback seam in `src/stateMachine.js`.
- Completed: removed modular config compatibility bridges that mapped legacy `global.sequences` / `game-actions` shapes into `system-sequences` and `command-sequences`.
- Completed: removed the `executeSchedule` compatibility wrapper that existed primarily for tests.
- Deferred: keep `fadeTime` compatibility.
- Completed: removed hint text fallbacks that treated `description` / `displayText` as runtime text for text-hint execution.
- Completed: straightened out the transitional `uiTopics` injection/fallback path in `src/game.js` so topic helpers own that logic directly.
- Completed: removed the orphaned dead code in `src/media/MediaController.js`.
- Remaining coordination item: use the saved follow-up prompt to audit PFx, Agent22, and Houdini for any changes needed after these PxO cleanups.

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
- Keep the externally visible `*Game` command aliases for now, but remove internal legacy bridges that are no longer needed for room configs or tests.
- Continue auditing any remaining legacy config bridges after the modular adapter `global.sequences` / `game-actions` promotion path removal.
- Keep text-hint runtime execution pinned to explicit `text` while leaving descriptive metadata available for UIs.

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
- Preserve the now-unified sequence resolution contract and avoid reintroducing parallel lookup paths.
- Keep shared topic helpers as the single source of truth for warnings/config topic derivation.
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

1. Run the saved cross-repo follow-up prompt against PFx and the room/web-ui repos now that the approved PxO cleanup slices have landed.
2. Continue the broader adapter/registry normalization work with focused tests in place.
3. Finish with documentation consolidation, archive triage, and final consistency checks.

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

1. Run the saved cross-repo follow-up prompt for PFx, Agent22, and Houdini before making any coordinated repo changes.
2. Start the next adapter/registry normalization slice with behavior-locking tests first.
3. Do the remaining docs triage pass to move completed proposal material into `docs/archive/` and update any still-open PR docs so they match the code that now exists.
