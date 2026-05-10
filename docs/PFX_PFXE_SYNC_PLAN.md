# PxO — PFx/PFxE Sync Plan (2.1.0)

**Branch:** `pfx-pfxe-sync` (on PxO)
**Room edits:** committed directly on `main` for `agent22` and `houdinis-challenge`
**Version target:** `2.0.0 → 2.1.0`
**Parent plan:** [/opt/paradox/portfolio/PFX_PFXE_SYNC.md](../../../portfolio/PFX_PFXE_SYNC.md)

PxO keeps **one `pfx` adapter**. The adapter must work transparently against both PFx and PFxE runtimes. The browser-verification polling loop is removed. EDN files are normalized to the PFxE vocabulary. PFx accepts the normalized vocabulary (see PFx plan).

## Scope summary

| Area | Action |
|---|---|
| Adapter name | Stays `pfx` / `pfx-media` — no new adapter |
| `verifyBrowser` polling | Fully removed from adapter (the ~90-line loop) |
| `enableBrowser` / `disableBrowser` / `verifyBrowser` emission | Fully removed from adapter and all EDN-driven sequences. No alias, no "deprecated" stub. |
| `moveBrowser` | Forwarded as-is to the target runtime. PFx will warn-and-ignore (full-screen). PFxE animates. Document as a known difference. |
| EDN normalization | `agent22.edn`, `houdini.edn`, and PxO example EDN files |
| Tests | Update fixtures; add a "PFxE-mode" smoke test against a PFxE running locally |

## Phase 1 — Adapter cleanup

**Model: Sonnet 4.6 - High**

- [ ] Locate the `verifyBrowser` polling loop in `src/adapters/pfx.js` (~lines 495–570 per earlier audit)
- [ ] Delete it. Remove `verifyBrowser`-related helpers and state tracking
- [ ] Delete `enableBrowser` / `disableBrowser` emission helpers and any callers
- [ ] Remove all related test fixtures and any references in PxO source/docs (clean break — no deprecated placeholders)
- [ ] Keep `showBrowser` / `hideBrowser` / `moveBrowser` forwarding
- [ ] Add a one-paragraph comment at the top of `pfx.js` explaining that the adapter speaks PFxE-canonical vocabulary; PFx accepts the same set
- [ ] Confirm `getStatus` parsing still works against PFx (no shape change expected)
- [ ] Update `docs/MQTT_API.md` (PxO) to reflect the removed commands and the `moveBrowser` PFx-vs-PFxE difference

## Phase 2 — EDN normalization

**Model: Sonnet 4.6 - High**

The two room EDNs and PxO example EDNs all reference now-removed commands.

### Files

- `/opt/paradox/rooms/agent22/config/agent22.edn` (symlinked from `config/agent22.edn`)
- `/opt/paradox/rooms/houdinis-challenge/config/houdini.edn` (symlinked from `config/houdini.edn`)
- PxO example EDNs under `apps/PxO/examples/` and `apps/PxO/config/example.*`

### Edits

- [ ] Remove all `verifyBrowser`, `enableBrowser`, `disableBrowser` command entries
- [ ] Remove `:verify-browser-hidden` / `:verify-browser-shown` sequences (agent22) and equivalent in houdini
- [ ] Re-point any sequence that currently calls `verifyBrowser` to use `showBrowser` directly (PFxE handles the rest; PFx auto-enables on init)
- [ ] Audit reset and intro sequences for assumptions that browser must be explicitly enabled
- [ ] Validate each EDN with `node src/game.js --edn <path> --validate`

### Commit policy

- agent22 and houdinis-challenge: commits on `main` (per portfolio plan)
- PxO example EDNs: on `pfx-pfxe-sync` branch with the rest of PxO

## Phase 3 — Test updates

**Model: Sonnet 4.6 - High**

- [ ] Update unit tests for the `pfx` adapter — remove `verifyBrowser` test cases, keep state-update parsing tests
- [ ] Add a smoke test that runs a synthetic EDN against a mocked PFxE-vocabulary MQTT responder (no `enableBrowser`, no `verifyBrowser`)
- [ ] Update existing integration fixtures that referenced the old commands

## Phase 4 — Cross-runtime validation

**Model: Sonnet 4.6 - High**

Goal: same EDN drives both runtimes.

- [ ] Run Houdini EDN against PFx (current branch `pfx-pfxe-sync` from PFx workstream) — full intro → win sequence
- [ ] Run Houdini EDN against two PFxE instances on a Pi5 — full intro → win sequence
- [ ] Run Agent22 EDN against PFx
- [ ] Run Agent22 EDN against PFxE
- [ ] Capture any drift in a "PFx-vs-PFxE behavior delta" appendix to the adapter comment

## Phase 5 — Version bump + release notes

**Model: Sonnet 4.6 - Medium**

- [ ] `CHANGELOG.md` entry for 2.1.0
- [ ] `package.json` version → `2.1.0`
- [ ] `npm test` clean
- [ ] PR title: `Release: PxO 2.1.0 — single adapter for PFx + PFxE, browser-lifecycle simplification, EDN normalization`

## Merge order (across repos)

1. PFx `pfx-pfxe-sync` merges first (PFxE-vocabulary acceptance must be live before PxO normalizes EDN)
2. PFxE `pfx-pfxe-sync` merges second (doc cleanup, version)
3. PxO `pfx-pfxe-sync` merges last (EDN normalization assumes step 1 is live)
4. Room EDN commits to `main` go in the same window as the PxO merge

## Acceptance criteria

- No `verifyBrowser`, `enableBrowser`, `disableBrowser` strings in PxO source or any EDN under `rooms/` or `apps/PxO/examples/`
- Both rooms run identically against PFx and PFxE
- PxO `--validate` is clean on every example EDN

## Risks

- EDN edits in rooms commit to `main` while PFx changes are still on `pfx-pfxe-sync`. Sequencing matters — do not push room EDN changes until PFx merge is live.
- A subtle behavior delta (e.g., browser ready timing) between runtimes could cause races. The cross-runtime validation phase exists to catch these.
