# Managed helpers (Option F)

PxO can **spawn and supervise** external helper processes declared in EDN under `:global :helpers`. First consumer: TFD Elevator **Simon**.

Room requirements: `/opt/paradox/rooms/tfd/docs/PXO-TFD-REQUIREMENTS.md`  
Architecture note: [`pending/PR_PUZZLE_LOGIC.md`](pending/PR_PUZZLE_LOGIC.md) (Option F).

**Status:** Implemented in tree; **real-life / on-device testing still pending.**

---

## Why

Some puzzles are stateful loops that do not belong inside EDN (Simon sequence scoring, custom hardware protocols). Option **G** (unmanaged MQTT microservice) already works but can orphan processes on reset. Option **F** ties helper lifetime to the game.

---

## Lifecycle

| Event | Behaviour |
|-------|-----------|
| Enter phase in helper `:active-phases` | `spawn` if not running |
| Leave those phases | `SIGTERM`, then `SIGKILL` after `:stop-grace-ms` |
| Crash while still in an active phase | Restart with backoff until `:max-restarts` → `helper_crash_loop` warning |
| `reset` / emergency stop / SIGINT / SIGTERM | Stop all helpers |

Default `:active-phases`: `["gameplay" "paused"]`.

### Pause does **not** pause the helper

PxO **paused** means the **game clock** is frozen so players get more wall time. Helpers that drive live puzzles (Simon, etc.) must **keep running** through pause: no `SIGSTOP`, no “pause” MQTT to the child, no teardown.

Including `"paused"` in `:active-phases` keeps the process alive across pause/resume. Omitting `"paused"` would stop the helper when the GM pauses — almost never what you want for puzzle helpers.

Stdout/stderr are forwarded to PxO logs tagged `[helper:<id>:out|err]`.

Optional `:ready-event` — when the helper publishes `{ "event": "<name>" }` on `{topic}/events`, PxO marks it ready and emits `helper_ready`.

Environment injected: `PXO_HELPER_ID`, `PXO_HELPER_TOPIC`, `PXO_HELPER_PHASE`.

Helper `:env` string values may include `{{setting-key}}` placeholders. At spawn, PxO substitutes from `:global :settings` (e.g. `"SIMON_ENTRY_WINDOW_S" "{{simon-entry-window-s}}"`). Unknown keys become empty strings.

---

## EDN example

```clojure
:global {
  :helpers [{:id :simon
             :cmd ["node" "/opt/paradox/rooms/tfd/helpers/simon-stub.js"]
             :topic "paradox/tfd/elevator/helpers/simon"
             :active-phases ["gameplay" "paused"]
             :restart-on-crash true
             :ready-event "ready"
             :stop-grace-ms 2000}]
}
```

---

## Implementation

- Code: `src/helpers/helperSupervisor.js`
- Wired from `GameStateMachine` phase transitions, pause/resume, reset, emergency stop, and process signal handlers in `game.js`
- Tests: `test/helperSupervisor.test.js`

Helpers must not be used for media, GPIO, or anything a zone adapter already covers.
