# AI Agent Instructions - Houdini's Challenge Game Configuration

## System Overview

Houdini's Challenge is a **game configuration and asset repository** for an escape room experience, powered by [Paradox Orchestrator (PxO)](https://github.com/MStylesMS/paradox-orchestrator).

This repository contains:
- **EDN configuration files** (`/config/*.edn`) — game logic, sequences, cues, commands
- **Media assets** (`/media/`) — audio, video, image files for the game
- **Archive** (`/archive/`) — legacy code preserved for reference (not actively maintained)

## Role of This Repository

**This is NOT an engine repository** — the game engine lives in [paradox-orchestrator](https://github.com/MStylesMS/paradox-orchestrator).

Your role here is to:
- Design and modify game sequences and flows in EDN files
- Organize and reference media assets
- Configure game modes (60min, 30min, demo)
- Define hints and puzzle interactions
- Test game configurations with PxO

**Do NOT**:
- Modify engine code (that's in PxO repo)
- Change MQTT topics or adapter behavior (that's PxO)
- Edit state machine logic (that's PxO)
- Modify config loaders (that's PxO)

## EDN Configuration Patterns

### Three-Tier Model (Defined by PxO)

**Commands** (atomic operations):
```clojure
{:zone "mirror" :command "playVideo" :file "intro.mp4"}
{:zone "lights" :command "scene" :name "green"}
```

**Cues** (named shortcuts, fire-and-forget):
```clojure
:cues {
  :lights-red {:zone "lights" :command "scene" :name "red"}
  :play-intro {:zone "mirror" :command "playVideo" :file "media/intro.mp4"}
  :stop-all [{:zones ["mirror" "audio"] :command "stopAudio"}]
}
```

**Sequences** (timeline-based, blocking):
```clojure
:sequences {
  :intro-sequence {
    :duration 45
    :timeline [
      {:at 45 :cue :lights-red}
      {:at 40 :zone "mirror" :command "playVideo" :file "media/intro.mp4"}
      {:at 5 :zone "mirror" :command "showBrowser"}
      {:at 3 :cue :lights-green}
    ]
  }
}
```

### Game Configuration Structure

**Main file**: `config/houdini.edn`

**Sections**:
```clojure
{
  ;; Zone definitions (MQTT base topics)
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/houdini/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/houdini/mirror"}
    :audio {:type "pfx-media" :baseTopic "paradox/houdini/audio"}
    :clock {:type "houdini-clock" :baseTopic "paradox/houdini/clock"}
  }
  
  ;; Media file references
  :media {
    :intro-video "media/video/intro/intro-sequence.mp4"
    :hint-01-speech "media/audio/hints/hint-01.mp3"
  }
  
  ;; Reusable commands
  :commands {
    :play-intro {:zone "mirror" :command "playVideo" :file :intro-video}
  }
  
  ;; Named cues (fire-and-forget)
  :cues {
    :lights-red {:zone "lights" :command "scene" :name "red"}
    :lights-green {:zone "lights" :command "scene" :name "green"}
    :show-clock {:zone "mirror" :command "showBrowser"}
    :hide-clock {:zone "mirror" :command "hideBrowser"}
  }
  
  ;; Timeline sequences
  :sequences {
    :intro-sequence { :duration 45 :timeline [...] }
    :gameplay-sequence { :duration 3600 :timeline [...] }
    :solved-sequence { :duration 30 :timeline [...] }
  }
  
  ;; Game modes with sequence overrides
  :modes {
    :60min { :intro-duration 45 :game-duration 3600 ... }
    :30min { :intro-duration 30 :game-duration 1800 ... }
    :demo { :intro-duration 15 :game-duration 300 ... }
  }
  
  ;; Phase execution mappings
  :phases {
    :intro [:intro-sequence]
    :gameplay [:gameplay-sequence]
    :solved [:solved-sequence]
    :failed [:failed-sequence]
  }
  
  ;; Hints system
  :hints [
    {:id 1 :name "First Hint" :type "speech" :text "..." :speech-file "..." :delay 5}
  ]
}
```

### Variable Substitution

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
```

Variables are expanded at runtime from hint context or sequence parameters.

## Media Asset Organization

**Directory structure**:
```
/media/
  /audio/           - Sound effects, music, voiceovers
    /intro/         - Intro phase audio
    /hints/         - Hint audio files
    /ambient/       - Background/ambient sounds
    /effects/       - Sound effects
  /video/           - Video sequences
    /intro/         - Intro phase videos
    /hints/         - Hint videos
    /solved/        - Victory sequence videos
  /images/          - Static images
    /backgrounds/   - Background images
    /hints/         - Hint images
```

**File naming conventions**:
- Use lowercase, hyphens for spaces: `intro-sequence.mp4`
- Include content type: `hint-01-speech.mp3`, `hint-01-video.mp4`
- Version if needed: `intro-v2.mp4`
- Group by purpose: `/intro/`, `/hints/`, `/solved/`

**Reference in EDN**:
```clojure
;; Option 1: Define in :media section, reference by keyword
:media {
  :intro-video "media/video/intro/intro-sequence.mp4"
  :hint-01-speech "media/audio/hints/hint-01.mp3"
}

;; Then use keyword reference:
{:zone "mirror" :command "playVideo" :file :intro-video}

;; Option 2: Use direct path string
{:zone "mirror" :command "playVideo" :file "media/video/intro/intro-sequence.mp4"}
```

**Recommendation**: Use `:media` section for frequently referenced files, direct paths for one-off uses.

## Game Modes Configuration

Each mode defines duration overrides and sequence variations:

```clojure
:modes {
  :60min {
    :intro-duration 45
    :game-duration 3600
    :hint-interval 300
    :sequences {
      ;; Override global sequences if needed
      :intro-sequence { :duration 45 :timeline [...] }
    }
  }
  
  :30min {
    :intro-duration 30
    :game-duration 1800
    :hint-interval 180
    ;; Inherits global sequences unless overridden
  }
  
  :demo {
    :intro-duration 15
    :game-duration 300
    :hint-interval 60
    :sequences {
      ;; Shorter, simplified sequences for demo
      :intro-sequence { :duration 15 :timeline [...] }
      :gameplay-sequence { :duration 300 :timeline [...] }
    }
  }
}
```

**Mode selection**:
- Default mode: specified in EDN `:default-mode` key
- Runtime override: `--mode demo` CLI flag
- Environment variable: `GAME_MODE=demo`

## Hint System Configuration

Hints support multiple execution types: `text`, `speech`, `audio`, `video`, `action`.

**Hint structure**:
```clojure
:hints [
  {
    :id 1
    :name "First Hint"
    :type "speech"
    :text "Look for the key under the table"
    :speech-file "media/audio/hints/hint-01.mp3"
    :delay 5  ; Delay in seconds before playing audio
  }
  
  {
    :id 2
    :name "Video Hint"
    :type "video"
    :text "Watch the video for a clue"
    :video-file "media/video/hints/hint-02.mp4"
    :video-zone "mirror"  ; Which display to use
    :delay 10
  }
  
  {
    :id 3
    :name "Action Hint"
    :type "action"
    :text "Lights will flash green three times"
    :sequence :hint-flash-green  ; Named sequence to execute
  }
  
  {
    :id 4
    :name "Combined Hint"
    :type "speech"
    :text "Listen carefully and watch the screen"
    :speech-file "media/audio/hints/hint-04.mp3"
    :video-file "media/video/hints/hint-04.mp4"  ; Can combine speech + video
    :video-zone "mirror"
    :delay 3
  }
]
```

**Hint types**:
- `text` — Display text only (UI shows message)
- `speech` — Play audio file, optionally show text
- `audio` — Play background audio/music
- `video` — Show video on specified zone
- `action` — Execute named sequence (for complex effects)

**Variable substitution in hints**:
```clojure
{
  :id 5
  :name "Dynamic Hint"
  :type "speech"
  :text "The code is {{puzzle-code}}"
  :speech-file "media/audio/hints/hint-{{hint-number}}.mp3"
}
```

## Testing Game Configurations

### Validation

```bash
# Validate EDN syntax and schema
cd /opt/paradox/engines/paradox-orchestrator
npm run validate -- /opt/paradox/rooms/houdinis-challenge/config/houdini.edn
```

### Running the Game

```bash
# Start with default config
cd /opt/paradox/rooms/houdinis-challenge
npm start

# Or with PxO directly
node /opt/paradox/engines/paradox-orchestrator/src/game.js --config config/houdini.edn

# Test specific mode
node /opt/paradox/engines/paradox-orchestrator/src/game.js --config config/houdini.edn --mode demo

# Debug mode (verbose logging)
LOG_LEVEL=debug node /opt/paradox/engines/paradox-orchestrator/src/game.js --config config/houdini.edn
```

### MQTT Monitoring

```bash
# Subscribe to all game topics
mosquitto_sub -h localhost -t 'paradox/houdini/#' -v

# Test specific zone commands manually
mosquitto_pub -h localhost -t 'paradox/houdini/mirror/commands' -m '{"command":"playVideo","file":"media/video/test.mp4"}'

# Trigger hint manually
mosquitto_pub -h localhost -t 'paradox/houdini/game/commands' -m '{"command":"deliverHint","hintId":1}'

# Control game state
mosquitto_pub -h localhost -t 'paradox/houdini/game/commands' -m '{"command":"startGame","mode":"demo"}'
mosquitto_pub -h localhost -t 'paradox/houdini/game/commands' -m '{"command":"pauseGame"}'
mosquitto_pub -h localhost -t 'paradox/houdini/game/commands' -m '{"command":"resumeGame"}'
```

## Development Workflows

### Adding a New Sequence

1. **Define the sequence** in `config/houdini.edn`:
   ```clojure
   :sequences {
     :new-sequence {
       :duration 30
       :timeline [
         {:at 30 :cue :lights-blue}
         {:at 25 :zone "audio" :command "playAudioFX" :file "media/audio/new-sound.mp3"}
         {:at 20 :wait 5}  ; Wait 5 seconds
         {:at 15 :zone "mirror" :command "playVideo" :file "media/video/new-video.mp4"}
         {:at 5 :cue :lights-green}
       ]
     }
   }
   ```

2. **Reference in phase mapping** if needed:
   ```clojure
   :phases {
     :intro [:intro-sequence :new-sequence]  ; Run both in order
   }
   ```

3. **Test the sequence**:
   - Validate EDN syntax: `npm run validate`
   - Run game and trigger the phase
   - Monitor MQTT for correct command publishing
   - Verify timing and zone coordination
   - Check logs for errors: `tail -f /opt/paradox/logs/game/game-latest.log`

### Adding a New Hint

1. **Create media file** and add to `/media/audio/hints/` or `/media/video/hints/`

2. **Add hint to `:hints` array** in `config/houdini.edn`:
   ```clojure
   {
     :id 4
     :name "New Hint"
     :type "speech"
     :text "This is the hint text for UI display"
     :speech-file "media/audio/hints/hint-04.mp3"
     :delay 5
   }
   ```

3. **Test hint delivery**:
   ```bash
   # Start game
   npm start
   
   # In another terminal, trigger hint
   mosquitto_pub -h localhost -t paradox/houdini/game/commands \
     -m '{"command":"deliverHint","hintId":4}'
   ```

4. **Verify**:
   - Audio plays correctly
   - Text displays in UI (if applicable)
   - Video shows on correct display (if video hint)
   - Timing is correct (delay parameter)

### Modifying Game Mode

1. **Edit mode configuration** in `config/houdini.edn`:
   ```clojure
   :modes {
     :60min {
       :intro-duration 50    ; Changed from 45
       :game-duration 3600
       ;; Add mode-specific sequence override
       :sequences {
         :intro-sequence {
           :duration 50
           :timeline [
             {:at 50 :cue :lights-red}
             {:at 45 :zone "mirror" :command "playVideo" :file :intro-video}
             {:at 5 :zone "mirror" :command "showBrowser"}
             {:at 3 :cue :lights-green}
           ]
         }
       }
     }
   }
   ```

2. **Test mode selection**:
   ```bash
   # Start with specific mode
   npm start -- --mode 60min
   
   # Verify durations are correct
   # Check logs for sequence execution
   ```

### Creating a Complex Multi-Phase Sequence

**Scenario**: Intro sequence that coordinates lights, video, and audio with precise timing.

```clojure
:sequences {
  :complex-intro {
    :duration 60
    :timeline [
      ;; Phase 1: Lights fade down
      {:at 60 :cue :lights-dim}
      {:at 58 :wait 2}
      
      ;; Phase 2: Start ambient audio
      {:at 58 :zone "audio" :command "playAudioFX"
       :file "media/audio/ambient/intro-ambient.mp3"
       :volume 40
       :loop true}
      
      ;; Phase 3: Show intro video
      {:at 55 :zone "mirror" :command "playVideo"
       :file "media/video/intro/main-intro.mp4"}
      
      ;; Phase 4: Lights animate during video
      {:at 45 :cue :lights-pulse-blue}
      {:at 30 :cue :lights-pulse-red}
      
      ;; Phase 5: Stop ambient, fade to game lights
      {:at 15 :zone "audio" :command "stopAudio"}
      {:at 12 :cue :lights-game-ready}
      
      ;; Phase 6: Show clock UI
      {:at 10 :zone "mirror" :command "showBrowser"}
      {:at 8 :wait 2}
      
      ;; Phase 7: Final lights and ready
      {:at 5 :cue :lights-green}
      {:at 3 :zone "clock" :command "show"}
    ]
  }
}
```

**Best practices for complex sequences**:
- Use `:wait` for critical timing synchronization
- Add comments for each phase: `; Phase 1: Lights fade down`
- Test timing with real media files (not placeholders)
- Account for video/audio duration — don't trigger next step too early
- Use named cues for repeated patterns (`:lights-dim`, `:lights-game-ready`)

## Critical: Configuration Guidelines

### Do's

✅ **Use keyword references for media files**:
```clojure
:media {:intro-video "media/video/intro.mp4"}
{:zone "mirror" :command "playVideo" :file :intro-video}
```

✅ **Keep sequences modular and reusable**:
```clojure
:sequences {
  :lights-flash-green { :duration 3 :timeline [...] }
  :lights-flash-red { :duration 3 :timeline [...] }
}
```

✅ **Use cues for repeated command patterns**:
```clojure
:cues {
  :stop-all-media [{:zones ["mirror" "audio"] :command "stopAudio"}]
  :game-ready [:lights-green :show-clock]
}
```

✅ **Document complex sequences** with EDN comments:
```clojure
:sequences {
  :intro-sequence {
    :duration 45
    :timeline [
      ; Start with red lights for dramatic effect
      {:at 45 :cue :lights-red}
      ; ... rest of timeline
    ]
  }
}
```

✅ **Test configurations before committing**:
```bash
npm run validate
npm start -- --mode demo  # Quick test with demo mode
```

✅ **Use mode overrides for variations**, not duplicate configs:
```clojure
:modes {
  :60min { :sequences { :intro-sequence {...} } }  ; Override for 60min
  :30min { }  ; Inherit global sequences
}
```

### Don'ts

❌ **Hardcode zone base topics** — use `:zones` section:
```clojure
; Bad:
{:zone "mirror" :baseTopic "paradox/houdini/mirror" :command "..."}

; Good:
:zones {:mirror {:baseTopic "paradox/houdini/mirror"}}
{:zone "mirror" :command "..."}
```

❌ **Duplicate sequence logic** — extract to named sequences:
```clojure
; Bad:
:sequences {
  :intro-60min { :duration 45 :timeline [...]  ; Duplicated logic
  :intro-30min { :duration 30 :timeline [...]  ; Same steps, different duration
}

; Good:
:sequences {
  :intro-base { :duration 45 :timeline [...] }
}
:modes {
  :60min { :sequences { :intro { :duration 45 :timeline [...] } } }
  :30min { :sequences { :intro { :duration 30 :timeline [...] } } }
}
```

❌ **Use absolute file paths** — relative to repo root or `:media` section:
```clojure
; Bad:
{:file "/opt/paradox/rooms/houdinis-challenge/media/video/intro.mp4"}

; Good:
{:file "media/video/intro.mp4"}
; Or:
:media {:intro-video "media/video/intro.mp4"}
{:file :intro-video}
```

❌ **Modify engine behavior in config** — that's PxO's job:
```clojure
; Bad (this won't work):
:engine-config {:override-state-machine true}

; Good (use config as intended):
:sequences { ... }  ; Define game flow using sequences
```

❌ **Break existing MQTT command formats** — maintained by PxO:
```clojure
; Bad (wrong format):
{:zone "mirror" :action "play" :media "intro.mp4"}

; Good (correct PxO format):
{:zone "mirror" :command "playVideo" :file "intro.mp4"}
```

❌ **Create mode-specific EDN files** — use `:modes` section instead:
```clojure
; Bad: houdini-60min.edn, houdini-30min.edn (duplicate files)

; Good: One houdini.edn with :modes section
:modes {
  :60min { ... }
  :30min { ... }
}
```

## Archive Content

`/archive/` contains legacy code from before PxO extraction:
- Old HTML control UI (may be rebuilt using modern frameworks)
- Legacy scripts and tools
- Original game engine code (now in PxO repo)
- Old documentation (migrated to PxO)

**Do not modify archive content** — it's preserved for reference only. If you need functionality from archived code, extract the pattern and implement it in current config or request engine feature in PxO repo.

## Common Patterns and Recipes

### Synchronized Multi-Zone Effects

```clojure
:cues {
  :victory-celebration [
    {:zone "lights" :command "scene" :name "rainbow-chase"}
    {:zone "audio" :command "playAudioFX" :file "media/audio/victory.mp3" :volume 90}
    {:zone "mirror" :command "playVideo" :file "media/video/victory.mp4"}
  ]
}
```

### Looped Background Music

```clojure
{:zone "audio"
 :command "playAudioFX"
 :file "media/audio/ambient/background.mp3"
 :volume 30
 :loop true}
 
; Later, stop it:
{:zone "audio" :command "stopAudio"}
```

### Countdown Timer with Voice Announcements

```clojure
:sequences {
  :countdown-with-voice {
    :duration 60
    :timeline [
      {:at 60 :zone "audio" :command "playAudioFX" :file "media/audio/voice/60-seconds.mp3"}
      {:at 30 :zone "audio" :command "playAudioFX" :file "media/audio/voice/30-seconds.mp3"}
      {:at 10 :zone "audio" :command "playAudioFX" :file "media/audio/voice/10-seconds.mp3"}
      {:at 5 :zone "audio" :command "playAudioFX" :file "media/audio/voice/5-seconds.mp3"}
    ]
  }
}
```

### Hint with Video and Speech

```clojure
:hints [
  {
    :id 5
    :name "Combined Hint"
    :type "speech"
    :text "Watch the screen and listen carefully"
    :speech-file "media/audio/hints/hint-05-speech.mp3"
    :video-file "media/video/hints/hint-05-video.mp4"
    :video-zone "mirror"
    :delay 3
  }
]
```

### Dramatic Pause Effect

```clojure
:sequences {
  :dramatic-reveal {
    :duration 15
    :timeline [
      {:at 15 :cue :lights-dim}
      {:at 13 :zone "audio" :command "stopAudio"}
      {:at 12 :wait 3}  ; 3 seconds of silence
      {:at 9 :zone "audio" :command "playAudioFX" :file "media/audio/dramatic-hit.mp3"}
      {:at 8 :cue :lights-flash-white}
      {:at 7 :zone "mirror" :command "playVideo" :file "media/video/reveal.mp4"}
    ]
  }
}
```

## Questions or Issues

- **EDN configuration questions**: See [PxO User Guide](https://github.com/MStylesMS/paradox-orchestrator/blob/main/docs/USER_GUIDE.md)
- **Engine behavior questions**: See [PxO Spec](https://github.com/MStylesMS/paradox-orchestrator/blob/main/docs/SPEC.md)
- **MQTT API questions**: See [PxO MQTT API](https://github.com/MStylesMS/paradox-orchestrator/blob/main/docs/MQTT_API.md)
- **Zone adapter commands**: See [PxO MQTT API](https://github.com/MStylesMS/paradox-orchestrator/blob/main/docs/MQTT_API.md)
- **Configuration bugs**: Report in PxO repo (engine) or houdinis-challenge repo (game-specific)

## Your Role

**You are a game designer**, not an engine developer.

Focus on:
- Creating compelling game experiences using PxO's configuration system
- Designing puzzle sequences and interactions
- Coordinating media (audio/video/lights) for maximum impact
- Optimizing game timing and flow
- Testing and refining game configurations

Refer to PxO documentation for:
- Engine capabilities and limitations
- Available commands and zones
- Sequence execution semantics
- MQTT protocol details

**When to ask for engine changes**:
- If you need a command type that doesn't exist
- If sequence timing behavior doesn't match expectations
- If zone adapters don't support required functionality
- If you encounter bugs in sequence execution

**Keep it simple**:
- Start with basic sequences and build complexity gradually
- Test frequently with real hardware
- Use comments liberally in EDN files
- Document your design decisions for future maintainers

Your creativity makes the game compelling — PxO provides the tools, you create the experience.
