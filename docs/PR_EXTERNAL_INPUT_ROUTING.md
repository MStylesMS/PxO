# PR: External Input Routing and Source Registry (PxO)

Status: Draft implementation plan with initial code slice started.

## Goal
Enable PxO to consume external gameplay-driving inputs from multiple producer apps (PFx, Pio, and others) using a consistent, maintainable EDN model.

The runtime should support both:
- Canonical room topics (preferred)
- Direct raw producer topics (allowed)

without requiring PxO to route through PFx.

## Architecture Boundary
- PxO is the gameplay consumer and router.
- PFx, Pio, and other apps are peer producer/consumer interfaces to the external world.
- All interactions flow through MQTT (or WS bridge), not app-to-app direct coupling.

## Deliverable 1: Topic Contract for Producer Apps
Producer topic family:
- `{baseTopic}/events`
- `{baseTopic}/state`
- `{baseTopic}/commands`
- `{baseTopic}/warnings`
- `{baseTopic}/schema`

Contract semantics:
- `/events`:
  - Only device-origin data as observed by the producer
  - Piecemeal updates are expected
  - Publish at receipt time
  - Non-retained by default
- `/state`:
  - Retained last-known summary
  - Publish on startup and when tracked values change
  - Capability-scoped: include only fields device can report
  - Per-field timestamps to assess staleness
- `/commands`:
  - Producer command/config surface
- `/warnings`:
  - Derived/operator-facing warnings and failures
- `/schema`:
  - Retained metadata for tooling and integrations
  - Not a gameplay runtime dependency

## Deliverable 2: Proposed EDN Source Registry
Add a top-level registry so triggers can reference named sources.

Proposed shape:

```clojure
:inputs {
  :front-door {:topic "paradox/houdini/inputs/front-door/events"
               :producer :pfx
               :kind :event
               :description "Front door contact"}

  :gpio-door {:topic "paradox/houdini/pio/gpio/door"
              :producer :pio
              :kind :raw
              :description "Direct GPIO reed"}
}

:triggers {
  :door-open {:source :front-door
              :condition {:event "open"}
              :actions [{:type :cue :cue :door-open-cue}
                        {:type :game :command "executeHint" :id "hint-door"}]}

  :gpio-open {:topic "paradox/houdini/pio/gpio/door"
              :condition {:value "1"}
              :actions [{:type :game :command "solve"}]}
}
```

Runtime policy:
- Prefer `:source` + named registry
- Keep direct `:topic` support for backward compatibility and raw-topic opt-in

## Deliverable 3: Canonical vs Raw Policy
Recommended policy:
- Canonical topics are preferred for recurring gameplay integrations.
- Raw producer topics are allowed for one-off, producer-specific, or low-value normalization cases.

Rationale:
- Preserves flexibility and avoids forced proxy layers.
- Maintains config hygiene and portability by default.

## Current Implementation Slice (Started)
Implemented in `src/game.js`:
- Trigger rules now support topic resolution from source registry names.
- Source registries recognized from:
  - `global.inputs`
  - `global.trigger-sources`
  - `global.triggerSources`
- Existing explicit `trigger.topic` behavior is fully preserved.
- Rules with unresolved topic/source are skipped with warning logs.

## Next PxO Code Phases
### Phase 1: Finalize Source Resolution
- [x] Resolve trigger topic from source registry or explicit topic
- [x] Add source metadata into trigger activation event payload
- [x] Add config-level validation for duplicate/invalid source names

### Phase 2: EDN and Docs
- [ ] Document `:inputs` in `docs/CONFIG_EDN.md`
- [ ] Document external input consumption policy in `docs/MQTT_API.md`
- [ ] Add complete working examples for PFx canonical and Pio raw paths

### Phase 3: Trigger Tooling
- [x] Add startup diagnostics listing active trigger subscriptions and source bindings
- [x] Add optional strict mode (warn or fail) for unknown `:source`
- [ ] Keep exact-match condition behavior for now

### Phase 4: Optional Enhancements
- [ ] Add richer condition operators only after real-world need is proven
- [ ] Add trigger source defaults (logging policy, deadband defaults)

## Integration Order Across Repos
1. PxO first
   - Implement source registry and trigger routing
   - This unlocks gameplay behavior immediately
2. PFx second
   - Align producer event/state/schema payload discipline
   - Improve capability-scoped retained state for sensors and outputs
3. Pio last (likely minimal)
   - Pio already has usable MQTT bridge topics and contracts
   - Optional only: schema richness, canonical aliases, metadata alignment

## Pio Impact Assessment
Expected requirement: minimal to none for initial rollout.

Optional future alignment:
- Add richer schema payload metadata
- Add canonical room-level alias topics if desired
- Keep existing Pio IO topic model compatible with PxO raw subscriptions

## Risks and Mitigations
- Risk: Trigger config sprawl with raw topics.
  - Mitigation: prefer named `:inputs` and canonical topics by policy.
- Risk: Unknown source names silently break rules.
  - Mitigation: warn loudly now, optional strict mode later.
- Risk: Backward compatibility regression.
  - Mitigation: explicit `trigger.topic` remains supported.

## Definition of Done (PxO Portion)
- Source registry and direct topic triggers both work.
- Existing trigger configs continue to work unchanged.
- New EDN examples validated in docs.
- Trigger subscription/binding logs are clear for operators.
