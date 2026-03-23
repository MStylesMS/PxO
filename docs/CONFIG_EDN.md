# Paradox Orchestrator (PxO) — EDN Configuration Guide

**Version**: 1.0.0  
**Last Updated**: October 2025

## Overview

Paradox Orchestrator uses **EDN (Extensible Data Notation)** for game configuration. EDN provides type-safe, human-readable configuration with support for keywords, comments, and rich data structures.

### Why EDN?

- **Type Safety**: Keywords (`:keyword`) prevent typos
- **Comments**: Native comment support (`;` for line comments)
- **Rich Types**: Vectors `[]`, maps `{}`, sets `#{}`
- **Keyword References**: `:intro-video` → resolved to actual value
- **Readable**: Clean syntax, no quoting required for most values

---

## Basic EDN Syntax

### Data Types

```clojure
; Strings
"hello world"

; Numbers
42
3.14

; Keywords (symbols with colon prefix)
:keyword
:my-keyword

; Booleans
true
false

; Nil
nil

; Vectors (ordered lists)
[1 2 3]
["a" "b" "c"]

; Maps (key-value pairs)
{:key "value" :another-key 42}

; Sets (unique values)
#{1 2 3}
```

### Comments

```clojure
; Single line comment

{:key "value"  ; Inline comment
 :another-key 42}
```

---

## Configuration Structure

### Top-Level Keys

```clojure
{
  ;; Zone definitions
  :zones { ... }
  
  ;; Media file references
  :media { ... }
  
  ;; Reusable commands
  :commands { ... }
  
  ;; Named cues
  :cues { ... }
  
  ;; Timeline sequences
  :sequences { ... }
  
  ;; Phase execution mappings
  :phases { ... }
  
  ;; Game modes
  :modes { ... }
  
  ;; Hints
  :hints [ ... ]
  
  ;; Global settings
  :default-mode :60min
  :game-heartbeat-ms 1000
  :auto-reset-delay 300
}
```

---

## Zones

Define zone adapters and MQTT topics:

```clojure
:zones {
  :lights {
    :type "pfx-lights"
    :baseTopic "paradox/game/lights"
  }
  :mirror {
    :type "pfx-media"
    :baseTopic "paradox/game/mirror"
  }
  :audio {
    :type "pfx-media"
    :baseTopic "paradox/game/audio"
  }
  :clock {
    :type "houdini-clock"
    :baseTopic "paradox/game/clock"
  }
  :system {
    :type "system"
    :baseTopic "paradox/game/system"
  }
}
```

**Required Fields**:
- `:type`: Zone adapter type
- `:baseTopic`: MQTT base topic

**Zone Types**:
- `pfx-lights` — Lighting control (ParadoxFX)
- `pfx-media` — Video/audio playback (ParadoxFX)
- `houdini-clock` — Countdown timer UI
- `system` — System commands

---

## Media Files

Define reusable media file references:

```clojure
:media {
  :intro-video "media/video/intro/main-intro.mp4"
  :intro-music "media/audio/intro/intro-music.mp3"
  :hint-01-speech "media/audio/hints/hint-01.mp3"
  :hint-01-video "media/video/hints/hint-01.mp4"
  :victory-video "media/video/victory.mp4"
  :failure-video "media/video/failure.mp4"
}
```

**Usage**:
```clojure
; Reference by keyword
{:zone "mirror" :command "playVideo" :file :intro-video}

; Or use string directly
{:zone "mirror" :command "playVideo" :file "media/video/intro.mp4"}
```

---

## Commands

Define reusable atomic commands:

```clojure
:commands {
  :play-intro {
    :zone "mirror"
    :command "playVideo"
    :file :intro-video
  }
  :play-intro-music {
    :zone "audio"
    :command "playAudioFX"
    :file :intro-music
    :volume 60
  }
  :stop-all-media {
    :zones ["mirror" "audio"]
    :command "stopAudio"
  }
}
```

**Single Zone**:
```clojure
{:zone "zonename" :command "action" ...params}
```

**Multiple Zones**:
```clojure
{:zones ["zone1" "zone2"] :command "action" ...params}
```

---

## Cues

Named shortcuts that execute immediately (fire-and-forget):

```clojure
:cues {
  ; Single command
  :lights-red {:zone "lights" :command "scene" :name "red"}
  :lights-green {:zone "lights" :command "scene" :name "green"}
  :lights-blue {:zone "lights" :command "scene" :name "blue"}
  :lights-dim {:zone "lights" :command "scene" :name "dim"}
  
  ; Command reference
  :play-intro :play-intro-video  ; Reference from :commands
  
  ; Multiple commands (parallel execution)
  :stop-all [
    {:zones ["mirror" "audio"] :command "stopAudio"}
    {:zone "lights" :command "scene" :name "dim"}
  ]
  
  :victory-celebration [
    {:zone "lights" :command "scene" :name "rainbow"}
    {:zone "audio" :command "playAudioFX" :file "victory-music.mp3" :volume 90}
    {:zone "mirror" :command "playVideo" :file "victory.mp4"}
  ]
}
```

**Execution**: Non-blocking, returns immediately.

### Browser Commands In Cues

Use `enableBrowser` in cues when you want fire-and-forget browser startup:

```clojure
:cues {
  :enable-clock-browser {
    :zone "mirror"
    :command "enableBrowser"
    :url "http://localhost/clock/index.html"
  }
  :show-clock-browser {:zone "mirror" :command "showBrowser"}
  :hide-clock-browser {:zone "mirror" :command "hideBrowser"}
}
```

`verifyBrowser` is not a direct zone MQTT command. It is handled by PxO sequence execution and should be used inside sequence steps (see below), not as a raw command sent to a media zone.

---

## Sequences

Timeline-based execution with explicit duration:

```clojure
:sequences {
  :intro-sequence {
    :duration 45
    :timeline [
      ; Execute at T-45 seconds (start)
      {:at 45 :cue :lights-red}
      
      ; Execute at T-40 seconds
      {:at 40 :zone "mirror" :command "playVideo" :file :intro-video}
      {:at 40 :zone "audio" :command "playAudioFX" :file :intro-music :volume 60}
      
      ; Wait 5 seconds for synchronization
      {:at 30 :wait 5}
      
      ; Execute at T-5 seconds
      {:at 5 :zone "mirror" :command "showBrowser"}
      
      ; Execute at T-3 seconds (near end)
      {:at 3 :cue :lights-green}
    ]
  }
  
  :gameplay-sequence {
    :duration 3600
    :timeline [
      {:at 3600 :cue :lights-green}
      {:at 3300 :zone "audio" :command "playAudioFX" :file "ambient.mp3" :loop true}
      ; ... more steps
    ]
  }
}
```

**Required Fields**:
- `:duration` — Total sequence duration in seconds
- `:timeline` — Array of timed steps

**Timeline Step Types**:

**1. Cue Execution**:
```clojure
{:at 30 :cue :cue-name}
```

**2. Direct Command**:
```clojure
{:at 25 :zone "zonename" :command "action" ...params}
```

**3. Wait/Delay**:
```clojure
{:at 20 :wait 5}  ; Wait 5 seconds
```

**4. Sub-Sequence**:
```clojure
{:at 15 :fire-seq :other-sequence}
```

**5. Browser Verification (Blocking)**:
```clojure
{:at 20 :zone "mirror" :command "verifyBrowser" :url "http://localhost/clock/index.html" :visible false :timeout 15000}
```

`verifyBrowser` behavior:
- Requests adapter state and verifies browser readiness
- Calls `enableBrowser` if browser is not running
- Updates URL/visibility if they differ
- Polls until state matches or timeout is reached
- Blocks sequence progress until complete (or timeout/failure)

**Timing Model**:
- `:at` counts down from `:duration`
- `:at 30` with `:duration 45` executes 15 seconds after start (45-30=15)

**Execution**: Blocking — caller waits for sequence completion.

---

## Phases

Map game phases to sequence arrays:

```clojure
:phases {
  :intro [:intro-sequence]
  :gameplay [:gameplay-sequence]
  :solved [:victory-sequence]
  :failed [:failure-sequence]
}
```

**Phase Names** (must match state machine):
- `:intro` — Introduction/briefing phase
- `:gameplay` — Active gameplay phase
- `:solved` — Victory phase
- `:failed` — Failure phase

**Execution**: Sequences run in array order (blocking).

---

## System/Control Sequence Naming (Canonical)

PxO distinguishes software lifecycle, machine lifecycle, and prop lifecycle controls using explicit
sequence names in `:system-sequences`:

```clojure
:system-sequences {
  :software-halt-sequence {:timeline []}        ; halt PxO process flow (no OS shutdown)
  :software-shutdown-sequence {:timeline []}    ; graceful PxO software shutdown
  :software-restart-sequence {:timeline []}     ; graceful PxO software restart

  :machine-shutdown-sequence {:timeline []}     ; OS/machine shutdown
  :machine-reboot-sequence {:timeline []}       ; OS/machine reboot

  :props-sleep-sequence {:timeline []}          ; put props/adapters into sleep/standby mode
  :props-wake-sequence {:timeline []}           ; wake props/adapters from standby mode
}
```

Guidelines:
- Use `software-*` names for PxO process lifecycle hooks.
- Use `machine-*` names for host OS power-state actions.
- Use `props-*` names for room hardware/adapters lifecycle controls.

---

## Modes

Game mode variations with duration overrides:

```clojure
:modes {
  :60min {
    :intro-duration 45
    :game-duration 3600
    :hint-interval 300
    :sequences {
      ; Override specific sequences for this mode
      :intro-sequence {
        :duration 45
        :timeline [ ... ]
      }
    }
  }
  
  :30min {
    :intro-duration 30
    :game-duration 1800
    :hint-interval 180
    ; Inherits global sequences unless overridden
  }
  
  :demo {
    :intro-duration 15
    :game-duration 300
    :hint-interval 60
    :sequences {
      ; Shorter sequences for demo
      :intro-sequence {
        :duration 15
        :timeline [ ... ]
      }
      :gameplay-sequence {
        :duration 300
        :timeline [ ... ]
      }
    }
  }
}

:default-mode :60min  ; Default mode if not specified
```

**Mode Selection**:
```bash
# CLI flag
node src/game.js --config game.edn --mode demo

# Environment variable
GAME_MODE=demo node src/game.js

# Default from config
:default-mode :60min
```

---

## Hints

Current hint model (map-based IDs):

```clojure
:hints {
  :hint-01 {:type "speech" :zone "tv" :file :hint-01-audio}
  :hint-02 {:type "audioFx" :zone "tv" :file :hint-02-audio}
  :hint-03 {:type "text" :sequence "hint-text-seq" :text "Follow the signal chain" :duration 15}
  :hint-04 {:type "sequence" :sequence "hint-scene-seq" :parameters {:light "red" :speed "fast" :option 7}}
}

:command-sequences {
  :hint-text-seq {:description "Send text hint to clock display"
                  :sequence [{:zone "tv" :command "playAudioFX" :file :hint-bell}
                             {:zone "clock" :command "hint" :text "{{text}}" :duration "{{duration}}"}]}
  :hint-scene-seq {:description "Sequence hint using parameters"
                   :sequence [{:zone "lights" :command "scene" :name "{{light}}"}]}
}
```

Canonical hint source:
- Global hint definitions are loaded from `global.hints`.

Game-mode hint list behavior (`game-modes.<mode>.hints`):
- Entries are processed in the order listed.
- If an entry is a string matching a global hint id, it references that global hint.
- If an entry is an object with `id` matching a global hint id, the mode-local object overrides that global hint for the current mode.
- After mode entries, remaining global hints are appended.
- The final list is deduplicated by normalized display/base text.

**Required Fields**:
- Hint ID is the map key (example `:hint-03`)
- `:type` — Hint type (`text`, `speech`, `audio`, `audioFx`, `video`, `action`, `sequence`)

**Type-Specific Fields**:

| Type | Required | Optional |
|------|----------|----------|
| `text` | `:sequence` (must be in `:command-sequences`) | `:text` (default UI/edit value), `:duration` |
| `speech` | `:file` | `:zone` |
| `audio` / `audioFx` | `:file` | `:zone` |
| `video` | `:file` | `:zone` |
| `action` | `:sequence` | `:text` |
| `sequence` | `:sequence` (must be in `:command-sequences`) | `:parameters {}`, direct template fields |

Notes:
- `action` hints are reserved for a future feature. Current runtime behavior is warning-only (`hint_action_not_implemented`) and no action is executed.
- Action hint syntax (future): `:my-action-hint {:type "action" :sequence "some-sequence" :text "Optional UI text"}`
- Text and sequence hints resolve only from `:command-sequences` (no fallback to `:system-sequences`).
- Sequence hints may provide template values either directly on the hint or under `:parameters {}`.
- Reserved built-ins for template substitution are `text` and `duration`.
- Unknown placeholders are warning-only at validation/runtime and resolve to empty strings during invocation.
- UI list format is `emoji type zone: description` (zone omitted when not provided).

---

## Global Settings

```clojure
{
  ; Game configuration
  :default-mode :60min
  :game-heartbeat-ms 1000
  :auto-reset-enabled true
  :auto-reset-delay 300
  
  ; MQTT (can be overridden by INI)
  :mqtt-broker "localhost"
  :mqtt-port 1883
  :mqtt-client-id "pxo-game-engine"
  
  ; Logging (can be overridden by INI)
  :log-level "info"
  :log-directory "/opt/paradox/logs/pxo"
  :log-max-files 10
  :log-max-size-mb 10
}
```

---

## Variable Substitution

Use `{{variable}}` syntax for dynamic values:

```clojure
:cues {
  :hint-speech {
    :zone "audio"
    :command "playAudioFX"
    :file "media/hints/{{hint-file}}"
    :volume 80
  }
}

:hints {
  :dynamic-hint {:type "sequence" :sequence "hint-text-seq" :text "The code is {{puzzle-code}}" :duration 15}
}
```

Variables are expanded at runtime from context (hint parameters, sequence parameters, etc.).

---

## Complete Example

```clojure
{
  ;; Zone definitions
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/game/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/game/mirror"}
    :audio {:type "pfx-media" :baseTopic "paradox/game/audio"}
    :clock {:type "houdini-clock" :baseTopic "paradox/game/clock"}
  }
  
  ;; Media files
  :media {
    :intro-video "media/video/intro.mp4"
    :intro-music "media/audio/intro-music.mp3"
    :victory-video "media/video/victory.mp4"
  }
  
  ;; Cues
  :cues {
    :lights-red {:zone "lights" :command "scene" :name "red"}
    :lights-green {:zone "lights" :command "scene" :name "green"}
    :show-clock {:zone "mirror" :command "showBrowser"}
  }
  
  ;; Sequences
  :sequences {
    :intro {
      :duration 30
      :timeline [
        {:at 30 :cue :lights-red}
        {:at 25 :zone "mirror" :command "playVideo" :file :intro-video}
        {:at 5 :cue :show-clock}
        {:at 3 :cue :lights-green}
      ]
    }
  }
  
  ;; Phases
  :phases {
    :intro [:intro]
  }
  
  ;; Modes
  :modes {
    :demo {:intro-duration 30 :game-duration 300}
  }
  
  ;; Hints
  :hints {
    :hint-01 {:type "text" :text "Look for the key"}
  }
  
  ;; Settings
  :default-mode :demo
  :game-heartbeat-ms 1000
}
```

---

## Validation

Validate configuration before running:

```bash
npm run validate -- /path/to/game.edn
```

Common validation errors:
- Missing required fields (`:zones`, `:phases`)
- Invalid zone types
- Invalid phase names
- Timeline steps without `:at` field
- Duplicate hint names within same map scope
- Invalid keyword references

---

## Best Practices

### Use Keywords for References

```clojure
; Good
:media {:intro :intro-video}
{:file :intro-video}

; Avoid
{:file "media/video/intro.mp4"}  ; Duplicated path
```

### Comment Complex Sequences

```clojure
:sequences {
  :intro {
    :duration 45
    :timeline [
      ; Phase 1: Lights dim (T=0)
      {:at 45 :cue :lights-dim}
      
      ; Phase 2: Intro video starts (T=5)
      {:at 40 :zone "mirror" :command "playVideo" :file :intro-video}
      
      ; Phase 3: Show clock UI (T=40)
      {:at 5 :cue :show-clock}
    ]
  }
}
```

### Use Cues for Repeated Patterns

```clojure
; Good
:cues {
  :stop-all [{:zones ["mirror" "audio"] :command "stopAudio"}]
}
:sequences {
  :intro {:timeline [{:at 10 :cue :stop-all}]}
  :gameplay {:timeline [{:at 5 :cue :stop-all}]}
}

; Avoid (duplicated)
:sequences {
  :intro {:timeline [{:at 10 :zones ["mirror" "audio"] :command "stopAudio"}]}
  :gameplay {:timeline [{:at 5 :zones ["mirror" "audio"] :command "stopAudio"}]}
}
```

### Mode Inheritance

```clojure
; Good (modes inherit global sequences)
:sequences {:intro {...}}
:modes {
  :60min {}  ; Inherits global :intro
  :demo {:sequences {:intro {...}}}  ; Overrides only for demo
}

; Avoid (duplicated sequences)
:modes {
  :60min {:sequences {:intro {...}}}
  :30min {:sequences {:intro {...}}}  ; Same sequence, duplicated
}
```

---

## Appendix: EDN Resources

- **EDN Specification**: https://github.com/edn-format/edn
- **Parser**: https://www.npmjs.com/package/edn-data
- **Validator**: `npm run validate`

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
