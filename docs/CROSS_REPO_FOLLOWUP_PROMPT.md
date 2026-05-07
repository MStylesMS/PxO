# Cross-Repo Follow-Up Prompt For Post-Cleanup Compatibility

Use this prompt in a separate session against the relevant repositories after the recent PxO cleanup slices that already landed.

## Prompt

You are auditing downstream repos after a PxO cleanup pass. Work across these repos as needed:

- PFx: `/opt/paradox/apps/PFx`
- Agent22 room package: `/opt/paradox/rooms/agent22`
- Houdini room package: `/opt/paradox/rooms/houdinis-challenge`

## PxO cleanup context

The recent PxO cleanup already did all of the following:

- Collapsed duplicated sequence lookup/resolution paths in PxO so there is one clear sequence resolution contract.
- Removed modular-config compatibility bridges that mapped legacy `global.sequences` / `game-actions` shapes into `system-sequences` and `command-sequences`.
- Removed the `executeSchedule` compatibility wrapper that existed mainly for tests.
- Removed hint text execution fallbacks that treated `description` / `displayText` as runtime text for text hints.
- Straightened out the transitional `uiTopics` injection/fallback seam in PxO while preserving the documented MQTT topic structure.
- Removed orphaned dead code such as PxO `src/media/MediaController.js`.

Two compatibility surfaces are intentionally being kept for now and should NOT be migrated away in this task unless you find a concrete bug:

- Keep dual support for canonical game commands and `*Game` aliases at the PxO MQTT ingress.
- Keep `fadeTime` compatibility in adapter-facing clock/media commands.

## Known findings from the current repo scan

- Agent22 and Houdini operator UIs already publish canonical wire commands for emergency actions. In both UIs, `abortGame` is just an internal action key; the actual MQTT command published is `abort`.
- Both UIs subscribe directly to documented warnings/state topics, including room warnings and zone warnings.
- Both UIs normalize hint data using multiple metadata fields, especially `description`, `displayText`, `baseText`, and `text`.
- Agent22 and Houdini room EDN configs already define `system-sequences` and `command-sequences`, which lowered risk for the modular adapter bridge removal.
- Both room configs use `:description` heavily for operator-facing metadata.
- Both room configs appear to provide explicit `:text` for their text hints, but this should be verified carefully.
- PFx appears largely unaffected by the selected PxO internals, but warning/state topic behavior and file-based media command payloads should still be smoke-checked.

## High-priority files to inspect

Agent22:

- `/opt/paradox/rooms/agent22/config/agent22.edn`
- `/opt/paradox/rooms/agent22/html/index_files/scripts.js`

Houdini:

- `/opt/paradox/rooms/houdinis-challenge/config/houdini.edn`
- `/opt/paradox/rooms/houdinis-challenge/config/houdini-analog.edn`
- `/opt/paradox/rooms/houdinis-challenge/html/index_files/scripts.js`

PFx:

- `/opt/paradox/apps/PFx/lib/core/zone-manager.js`
- `/opt/paradox/apps/PFx/lib/zones/audio-zone.js`
- `/opt/paradox/apps/PFx/lib/zones/screen-zone.js`

## What to do

1. Audit Agent22 and Houdini EDN configs for any dependency on the PxO behaviors being removed.
2. Verify that text hints do not rely on `description` / `displayText` as fallback execution text.
3. Verify whether any room config still depends on legacy modular sequence grouping such as `global.sequences` or `game-actions` in ways that the landed PxO cleanup could now break.
4. Audit both room UIs for reliance on hint metadata fields that may need to be normalized differently now that PxO no longer supplies fallback text semantics.
5. Verify that the UIs still rely only on documented MQTT topics for commands, state, warnings, hints, and config.
6. Audit PFx only for real contract edges affected by this landed PxO cleanup, especially topic behavior and command payload expectations.
7. Identify exactly which changes are required in PFx, Agent22, and Houdini to remain compatible after the landed PxO cleanup.
8. If changes are clearly needed and low-risk, implement them with focused validation. Otherwise, produce a concrete change list and risk assessment.

## Important constraints

- Do not broaden scope into unrelated redesigns.
- Do not migrate away from `*Game` aliases just because they exist; those aliases are intentionally still supported by PxO.
- Do not remove `fadeTime` usage from room configs or adapters in this task; that compatibility is intentionally staying.
- Preserve documented MQTT topics unless you find a real mismatch between docs and code.

## Expected output

Return:

1. A concise list of required changes by repo.
2. Any changes that are optional but recommended.
3. Validation performed.
4. Any residual risks, especially around hints UI metadata and warnings/state topic handling.