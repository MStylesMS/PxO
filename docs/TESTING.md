# PxO Testing Guide

## Overview

PxO uses Jest as the canonical test runner. The default `npm test` command runs the Jest suite in-band so nested suites and focused slices behave consistently in local development and CI-style runs.

The repository also keeps one explicit E2E smoke script outside Jest for operational probing.

## Test Commands

```bash
# Full Jest suite
npm test

# Unit-oriented Jest suites only
npm run test:unit

# Integration smoke suites
npm run test:integration

# Focused Jest suites
npm run test:unified
npm run test:contract
npm run test:scheduler

# E2E smoke script (non-Jest)
npm run test:e2e
```

## Focused Runs

Use `--runTestsByPath` for the fastest local iteration on one file or a small slice.

```bash
# One test file
npm test -- --runTestsByPath test/discovery.test.js

# A small related slice
npm test -- --runTestsByPath \
  test/command-contract.test.js \
  test/scheduler.test.js \
  test/topic-standardization.test.js
```

You can pass any other standard Jest arguments after `npm test --`.

## Validation Commands

Configuration validation remains separate from the Jest suite.

```bash
# Main config validator
npm run validate -- /path/to/game.edn

# EDN-only validation
npm run validate:edn -- /path/to/game.edn

# INI-only validation
npm run validate:ini -- /path/to/pxo.ini

# Runtime entry-point validation path
node src/game.js --check --edn /path/to/game.edn
```

## Recommended Workflow

1. Run a focused Jest slice for the code you are changing.
2. Run `npm run test:unit` when a change touches shared runtime or adapter behavior.
3. Run `npm run test:integration` when changing config loading, hint handling, or orchestration helpers.
4. Run `npm test` before closing a cleanup or refactor batch.
5. Run the validation commands for EDN or INI changes.

## Notes

- `npm test` runs with `--runInBand` to keep behavior predictable for timer-heavy and stateful tests.
- Integration smoke suites should stay repository-local and must not depend on sibling workspaces or room repos.
- The E2E smoke script remains outside Jest because it behaves more like an operational probe than a unit/integration suite.