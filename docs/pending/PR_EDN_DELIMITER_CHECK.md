# PR Plan: Delimiter and Structure Diagnostics for EDN Validation

## Goal

Improve EDN validation diagnostics so users can quickly find missing or misplaced delimiters with line-level guidance and structural context.

## Background

Current validation catches syntax/shape issues and reports many line-context warnings, but delimiter errors can still be hard to localize when one missing brace causes downstream parse failures.

This plan introduces layered diagnostics that preserve current behavior while producing better localization and confidence-ranked suggestions.

## Scope

In scope:

- Add better delimiter localization in validator tooling.
- Add structure-aware hints based on expected EDN section layout.
- Improve output formatting for actionable diagnostics.
- Keep runtime behavior unchanged unless explicitly running check/validator mode.

Out of scope:

- EDN schema redesign.
- Runtime state-machine behavior changes.
- Auto-fix/rewrite of user EDN files.

## Desired User Experience

When delimiter issues occur, output should include:

- Primary suspected location (line and column).
- Why it is suspected (unclosed map, unexpected key scope, unmatched closer).
- Confidence level (high/medium/low).
- One to two alternate candidates when confidence is lower.
- Suggested manual fix pattern (for example, add closing brace before a sibling section).

## Design Overview

### Layer 1: Lexical Delimiter Scanner

Implement a scan that:

- Tracks delimiters: {}, [], ().
- Ignores comments and delimiters inside strings.
- Records stack entries with line/column and lightweight context.
- Produces:
  - first unmatched closer,
  - last unmatched opener,
  - net balance summary.

Output object example:

- delimiterType: curly|square|paren
- issueType: unmatched_opener|unmatched_closer
- line, column
- openerPathContext (if available)

### Layer 2: Structural Scope Heuristics

Build a scope tracker around known EDN keys to improve localization:

- top-level expected keys: game-name, game-description, gameplay-by, automation-by, version, format, create-date, edit-date, global, game-modes.
- global expected keys: settings, mqtt, media, cues, command-sequences, hints, sequences, additional-phases.
- game-modes expected shape: map of mode keys each containing phases and metadata.

Heuristic examples:

- If scanner is still inside global.media and sees game-modes, probable missing } before game-modes.
- If a sibling key appears at incorrect nesting depth, report likely closure needed above that line.

### Layer 3: Parse + Semantic Correlation

Correlate scanner findings with parser and validator messages:

- If parser provides line/column, raise confidence.
- If parser fails without location, use lexical + structural candidates.
- Merge duplicate candidates and sort by confidence.

### Layer 4: User-Facing Report

Add a diagnostics section to validator output:

- Primary suspect:
  - line/column
  - reason
  - confidence
- Secondary suspects (optional)
- Suggested manual checks

## Implementation Plan

### Phase 1: Foundation

- Add reusable tokenizer utilities:
  - strip comments preserving strings
  - iterate chars with line/column
- Implement delimiter stack collector.
- Add unit tests for comments/strings/escaped quotes.

### Phase 2: Structural Heuristics

- Add expected-key maps for top/global/game-modes scopes.
- Implement scope transition checks.
- Emit structural anomalies as candidate diagnostics.
- Add tests with intentionally malformed fixtures.

### Phase 3: Correlation and Scoring

- Add confidence scoring model:
  - High: parser line + delimiter signal agree.
  - Medium: structural + delimiter agreement.
  - Low: delimiter-only with EOF imbalance.
- Deduplicate and rank candidates.
- Add report formatting.

### Phase 4: Integration and UX

- Integrate into validate-edn flow.
- Ensure check mode output remains concise by default.
- Optional verbose mode for full candidate dump.

## Test Plan

### Unit Tests

- Unmatched opener at EOF.
- Unmatched closer in middle.
- Delimiters inside strings/comments ignored.
- Mixed delimiters with nested maps/vectors.

### Fixture Tests

- Missing brace before game-modes.
- Missing brace in global.media.
- Extra brace near sequences block.
- Correct file with heavy comments and quoted braces.

### Regression Tests

- Existing valid configs still pass.
- Existing warning/error counts unchanged except improved line localization.

## Acceptance Criteria

- Validator identifies at least one primary candidate line for delimiter issues in malformed fixtures.
- For known malformed fixtures, primary candidate is at or near true fault line.
- Diagnostics include line, reason, and confidence.
- No runtime behavior changes outside explicit check/validation execution.

## Risks and Mitigations

Risk: Heuristics flag wrong line in heavily nested maps.
Mitigation: show confidence and alternate candidates.

Risk: Performance impact on very large EDN files.
Mitigation: single-pass scanner, avoid expensive backtracking.

Risk: False positives due to uncommon EDN constructs.
Mitigation: expand fixture coverage and keep heuristics conservative.

## Rollout Strategy

- Step 1: Merge lexical scanner with non-invasive reporting.
- Step 2: Enable structural hints behind optional verbose switch.
- Step 3: Promote structural hints to default after fixture validation.

## Open Questions

- Should confidence values be numeric or categorical only?
- Should verbose diagnostics be gated behind a separate CLI flag?
- Should we persist diagnostics to logs for operator support?

## Estimated Effort

- Phase 1: 0.5 to 1 day
- Phase 2: 1 day
- Phase 3: 0.5 to 1 day
- Phase 4 + polish: 0.5 day

Total: ~2.5 to 3.5 days including tests and tuning.
