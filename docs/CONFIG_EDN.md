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

Multi-type hint system:

```clojure
:hints [
  ; Text only
  {
    :id 1
    :name "First Hint"
    :type "text"
    :text "Look for the hidden key"
  }
  
  ; Speech (audio + text)
  {
    :id 2
    :name "Speech Hint"
    :type "speech"
    :text "Check under the desk"
    :speech-file "media/audio/hints/hint-02.mp3"
    :delay 5
  }
  
  ; Video
  {
    :id 3
    :name "Video Clue"
    :type "video"
    :text "Watch the screen carefully"
    :video-file "media/video/hints/hint-03.mp4"
    :video-zone "mirror"
    :delay 10
  }
  
  ; Background audio
  {
    :id 4
    :name "Ambient Music"
    :type "audio"
    :audio-file "media/audio/hints/hint-music.mp3"
    :volume 40
    :loop true
  }
  
  ; Action (execute sequence)
  {
    :id 5
    :name "Light Flash"
    :type "action"
    :text "Watch the lights"
    :sequence :hint-flash-sequence
  }
  
  ; Combined (speech + video)
  {
    :id 6
    :name "Combined Hint"
    :type "speech"
    :text "Listen and watch"
    :speech-file "media/audio/hints/hint-06.mp3"
    :video-file "media/video/hints/hint-06.mp4"
    :video-zone "mirror"
    :delay 3
  }
]
```

**Required Fields**:
- `:id` — Unique hint ID
- `:name` — Hint name (for logging)
- `:type` — Hint type (`text`, `speech`, `audio`, `video`, `action`)

**Type-Specific Fields**:

| Type | Required | Optional |
|------|----------|----------|
| `text` | `:text` | |
| `speech` | `:text`, `:speech-file` | `:delay`, `:volume` |
| `audio` | `:audio-file` | `:volume`, `:loop` |
| `video` | `:video-file`, `:video-zone` | `:text`, `:delay` |
| `action` | `:sequence` | `:text` |

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

:hints [
  {
    :id 7
    :type "speech"
    :text "The code is {{puzzle-code}}"
    :speech-file "media/hints/hint-{{hint-number}}.mp3"
  }
]
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
  :hints [
    {:id 1 :type "text" :text "Look for the key"}
  ]
  
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
- Duplicate hint IDs
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
