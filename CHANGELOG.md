# Changelog

All notable changes to PxO are documented here.

---

## [2.1.1] — 2026-05-12

### Summary

Version alignment patch: bumps PxO to the `2.1.x` series to match PFx and PFxE following the `pfx-pfxe-sync` workstream. No behavioral changes from 2.1.0 work; this tag marks the end of the sync release.

---

## [2.1.0] — 2026-05-12

### Summary

Single `pfx` adapter for both PFx and PFxE runtimes, full removal of the `verifyBrowser` polling loop, EDN normalization for all room and example configs, and PFxE-vocabulary smoke tests.

### Added

- **PFxE-vocabulary smoke test** (`test/pfxe-vocabulary.smoke.test.js`) — exercises the full set of PFxE commands through a mocked MQTT responder; confirms no `enableBrowser` / `verifyBrowser` emissions.
- **PFx adapter browser tests** (`test/adapters/pfx.browser.test.js`) — unit coverage for `showBrowser`, `hideBrowser`, `moveBrowser` forwarding and the confirmed absence of removed command emission.
- **Adapter header comment** in `src/adapters/pfx.js` — documents that the adapter speaks PFxE-canonical vocabulary and that PFx accepts the same set.
- **Configuration path logging** — game startup now logs the resolved paths for `--edn` and `--config` arguments, easing deployment debugging.

### Removed

- **`verifyBrowser` polling loop** — the ~90-line browser-ready polling block in `src/adapters/pfx.js` is gone. PFx auto-enables its browser overlay at zone startup; PFxE never needed polling.
- **`enableBrowser` / `disableBrowser` / `verifyBrowser` emission** — adapter no longer emits these commands to the runtime. No aliases, no deprecated stubs.
- **Related test fixtures** — all test cases that asserted emission of the removed commands are removed.

### Changed

- **EDN normalization** — `agent22.edn`, `houdini.edn`, `houdini-analog.edn`, and the PxO example EDNs under `examples/` and `config/` no longer contain any `verifyBrowser`, `enableBrowser`, or `disableBrowser` command entries. Sequences that previously called `verifyBrowser` now rely on `showBrowser` directly.
- **`docs/MQTT_API.md`** — removed command families for `enableBrowser` / `disableBrowser` / `verifyBrowser`; added a "PFx ↔ PFxE differences" note covering `moveBrowser` warn-and-ignore behavior on PFx.
- **`docs/SPEC.md`**, **`docs/USER_GUIDE.md`**, **`docs/CONFIG_EDN.md`**, **`docs/README.md`** — lights/relays/inputs language and removed-command references purged throughout.
- **`src/sequenceRunner.js`** — removed browser-verification helper that was called from within sequence execution.
- **`src/engineUtils.js`**, **`src/game.js`**, **`src/mqttClient.js`**, **`src/stateMachine.js`** — minor cleanup aligned to the adapter contract change.
- **MQTT feedback-loop fix** — `mqttClient.js` now checks connection state before publishing warnings, preventing a publish-on-disconnect feedback loop.

### Tests

- All unit tests pass (`npm test`).
- Cross-runtime validation: Houdini and Agent22 EDNs run identically against PFx 2.1.x and PFxE 2.1.x.

---

## [2.0.0] — 2025-10-15

See git tag `v2.0.0` for the v2 major release notes (cleanup-pass merge).
