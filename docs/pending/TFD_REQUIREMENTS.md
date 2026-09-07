# Cross-link: TFD requirements for PxO

TFD (1000 Feet Down) is the first room that needs:

1. **Managed helpers (Option F)** — Simon Says subprocess lifecycle  
2. **Group metadata** on start + game_log fields (passport; aggregation is PxM)  
3. Trigger/`inputs` documentation polish  

TFD will **not** wait on the full declarative puzzle graph: valve/fuse/patch logic stays on ESP props; matrices move to PxIO.

Canonical room-side list: `/opt/paradox/rooms/tfd/docs/PXO-TFD-REQUIREMENTS.md`  
Architecture brainstorm: [PR_PUZZLE_LOGIC.md](PR_PUZZLE_LOGIC.md) (Option F section)

When implementing, open PRs against PxO with TFD EDN/flow tests as the consumer.
