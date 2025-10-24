# Paradox Orchestrator (PxO) — User Guide

**Version**: 1.0.0  
**Last Updated**: October 2025

## Introduction

Welcome to **Paradox Orchestrator (PxO)** — a zone-based game engine for escape rooms and interactive experiences.

This guide will walk you through building your first game, from basic concepts to advanced features.

---

## Tutorial: Building Your First Game

We'll build a simple 5-minute demo game with:
- Intro sequence with lighting and video
- Countdown timer
- Two hints
- Victory sequence

**Prerequisites**:
- PxO installed (see [SETUP.md](SETUP.md))
- MQTT broker running
- Zone adapters configured (lights, media, clock)

---

## Step 1: Define Zones

Create `demo-game.edn`:

```clojure
{
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
  }
}
```

**What are zones?**
- Zones represent controllable devices (lights, screens, audio, timers)
- Each zone has a **type** (adapter) and **MQTT topic**
- Zone adapters translate PxO commands to device-specific actions

---

## Step 2: Define Media Files

Add media references:

```clojure
{
  :zones { ... }
  
  :media {
    :intro-video "media/video/intro.mp4"
    :intro-music "media/audio/intro-music.mp3"
    :victory-video "media/video/victory.mp4"
    :victory-music "media/audio/victory-music.mp3"
    :hint-01-audio "media/audio/hints/hint-01.mp3"
    :hint-02-audio "media/audio/hints/hint-02.mp3"
  }
}
```

**Best Practice**: Use keywords (`:intro-video`) instead of hardcoding paths. This makes config more maintainable.

---

## Step 3: Create Reusable Commands

Define atomic actions:

```clojure
{
  :zones { ... }
  :media { ... }
  
  :commands {
    :play-intro-video {
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
    :show-clock {
      :zone "mirror"
      :command "showBrowser"
    }
  }
}
```

**Commands**:
- Single zone: `:zone "zonename"`
- Multiple zones: `:zones ["zone1" "zone2"]`
- Can be referenced by keyword later

---

## Step 4: Create Named Cues

Cues are fire-and-forget shortcuts:

```clojure
{
  :zones { ... }
  :media { ... }
  :commands { ... }
  
  :cues {
    ; Simple cues (lighting scenes)
    :lights-dim {:zone "lights" :command "scene" :name "dim"}
    :lights-red {:zone "lights" :command "scene" :name "red"}
    :lights-green {:zone "lights" :command "scene" :name "green"}
    :lights-blue {:zone "lights" :command "scene" :name "blue"}
    
    ; Reference commands
    :play-intro :play-intro-video
    :stop-all :stop-all-media
    
    ; Multi-command cues (parallel execution)
    :victory-celebration [
      {:zone "lights" :command "scene" :name "rainbow"}
      {:zone "audio" :command "playAudioFX" :file :victory-music :volume 90}
      {:zone "mirror" :command "playVideo" :file :victory-video}
    ]
  }
}
```

**Cue Types**:
1. **Direct command**: `{:zone "..." :command "..."}`
2. **Command reference**: `:play-intro` → resolves to `:play-intro-video`
3. **Multi-command**: `[{...} {...}]` → all execute in parallel

---

## Step 5: Build Intro Sequence

Sequences execute timeline-based actions:

```clojure
{
  :zones { ... }
  :media { ... }
  :commands { ... }
  :cues { ... }
  
  :sequences {
    :intro-sequence {
      :duration 30
      :timeline [
        ; T=0: Dim lights
        {:at 30 :cue :lights-dim}
        
        ; T=3: Start intro video & music
        {:at 27 :zone "mirror" :command "playVideo" :file :intro-video}
        {:at 27 :zone "audio" :command "playAudioFX" :file :intro-music :volume 60}
        
        ; T=10: Lights transition to red
        {:at 20 :cue :lights-red}
        
        ; T=25: Show countdown clock
        {:at 5 :cue :show-clock}
        
        ; T=27: Lights green (ready)
        {:at 3 :cue :lights-green}
      ]
    }
  }
}
```

**Timing Model**:
- `:duration 30` → sequence lasts 30 seconds
- `:at 30` → execute at T=0 (30-30=0)
- `:at 27` → execute at T=3 (30-27=3)
- `:at 5` → execute at T=25 (30-5=25)

**Think countdown**: `:at` counts down from `:duration`.

---

## Step 6: Build Gameplay Sequence

```clojure
{
  :sequences {
    :intro-sequence { ... }
    
    :gameplay-sequence {
      :duration 300
      :timeline [
        ; T=0: Start countdown
        {:at 300 :zone "clock" :command "startCountdown" :duration 300}
        {:at 300 :cue :lights-green}
        
        ; T=30: Ambient music starts
        {:at 270 :zone "audio" :command "playAudioFX" :file "ambient.mp3" :loop true :volume 40}
        
        ; T=240 (1 minute left): Warning lights
        {:at 60 :cue :lights-red}
        {:at 60 :zone "audio" :command "playAudioFX" :file "warning.mp3" :volume 70}
      ]
    }
  }
}
```

---

## Step 7: Build Victory & Failure Sequences

```clojure
{
  :sequences {
    :intro-sequence { ... }
    :gameplay-sequence { ... }
    
    :victory-sequence {
      :duration 15
      :timeline [
        {:at 15 :cue :stop-all}
        {:at 15 :cue :victory-celebration}
        {:at 10 :zone "clock" :command "showMessage" :text "YOU WIN!" :color "green"}
      ]
    }
    
    :failure-sequence {
      :duration 10
      :timeline [
        {:at 10 :cue :stop-all}
        {:at 10 :cue :lights-red}
        {:at 10 :zone "mirror" :command "playVideo" :file "failure.mp4"}
        {:at 5 :zone "clock" :command "showMessage" :text "TIME'S UP!" :color "red"}
      ]
    }
  }
}
```

---

## Step 8: Map Phases to Sequences

```clojure
{
  :sequences { ... }
  
  :phases {
    :intro [:intro-sequence]
    :gameplay [:gameplay-sequence]
    :solved [:victory-sequence]
    :failed [:failure-sequence]
  }
}
```

**Phase Names** (must match state machine):
- `:intro` — Introduction/briefing
- `:gameplay` — Active gameplay
- `:solved` — Victory
- `:failed` — Failure/timeout

---

## Step 9: Add Hints

```clojure
{
  :phases { ... }
  
  :hints [
    {
      :id 1
      :name "First Hint"
      :type "text"
      :text "Look for the hidden key under the desk"
    }
    {
      :id 2
      :name "Speech Hint"
      :type "speech"
      :text "The code is hidden in the painting"
      :speech-file :hint-01-audio
      :delay 5
    }
  ]
}
```

**Hint Types**:
- `text` — Text only (sent to MQTT, displayed by UI)
- `speech` — Audio + text (plays audio, shows text)
- `audio` — Background audio (music/ambient)
- `video` — Video playback
- `action` — Execute sequence

---

## Step 10: Configure Game Mode

```clojure
{
  :hints [ ... ]
  
  :modes {
    :demo {
      :intro-duration 30
      :game-duration 300
      :hint-interval 60
    }
  }
  
  :default-mode :demo
  :game-heartbeat-ms 1000
}
```

**Mode Settings**:
- `:intro-duration` — Intro sequence duration override
- `:game-duration` — Gameplay duration override
- `:hint-interval` — Seconds between automatic hints

---

## Step 11: Complete Configuration

**Final `demo-game.edn`**:

```clojure
{
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/game/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/game/mirror"}
    :audio {:type "pfx-media" :baseTopic "paradox/game/audio"}
    :clock {:type "houdini-clock" :baseTopic "paradox/game/clock"}
  }
  
  :media {
    :intro-video "media/video/intro.mp4"
    :intro-music "media/audio/intro-music.mp3"
    :victory-video "media/video/victory.mp4"
    :victory-music "media/audio/victory-music.mp3"
    :hint-01-audio "media/audio/hints/hint-01.mp3"
  }
  
  :commands {
    :play-intro-video {:zone "mirror" :command "playVideo" :file :intro-video}
    :play-intro-music {:zone "audio" :command "playAudioFX" :file :intro-music :volume 60}
    :stop-all-media {:zones ["mirror" "audio"] :command "stopAudio"}
    :show-clock {:zone "mirror" :command "showBrowser"}
  }
  
  :cues {
    :lights-dim {:zone "lights" :command "scene" :name "dim"}
    :lights-red {:zone "lights" :command "scene" :name "red"}
    :lights-green {:zone "lights" :command "scene" :name "green"}
    :stop-all :stop-all-media
    :victory-celebration [
      {:zone "lights" :command "scene" :name "rainbow"}
      {:zone "audio" :command "playAudioFX" :file :victory-music :volume 90}
      {:zone "mirror" :command "playVideo" :file :victory-video}
    ]
  }
  
  :sequences {
    :intro-sequence {
      :duration 30
      :timeline [
        {:at 30 :cue :lights-dim}
        {:at 27 :zone "mirror" :command "playVideo" :file :intro-video}
        {:at 27 :zone "audio" :command "playAudioFX" :file :intro-music :volume 60}
        {:at 20 :cue :lights-red}
        {:at 5 :cue :show-clock}
        {:at 3 :cue :lights-green}
      ]
    }
    
    :gameplay-sequence {
      :duration 300
      :timeline [
        {:at 300 :zone "clock" :command "startCountdown" :duration 300}
        {:at 300 :cue :lights-green}
        {:at 270 :zone "audio" :command "playAudioFX" :file "ambient.mp3" :loop true :volume 40}
        {:at 60 :cue :lights-red}
        {:at 60 :zone "audio" :command "playAudioFX" :file "warning.mp3" :volume 70}
      ]
    }
    
    :victory-sequence {
      :duration 15
      :timeline [
        {:at 15 :cue :stop-all}
        {:at 15 :cue :victory-celebration}
        {:at 10 :zone "clock" :command "showMessage" :text "YOU WIN!" :color "green"}
      ]
    }
    
    :failure-sequence {
      :duration 10
      :timeline [
        {:at 10 :cue :stop-all}
        {:at 10 :cue :lights-red}
        {:at 10 :zone "mirror" :command "playVideo" :file "failure.mp4"}
        {:at 5 :zone "clock" :command "showMessage" :text "TIME'S UP!" :color "red"}
      ]
    }
  }
  
  :phases {
    :intro [:intro-sequence]
    :gameplay [:gameplay-sequence]
    :solved [:victory-sequence]
    :failed [:failure-sequence]
  }
  
  :hints [
    {:id 1 :type "text" :text "Look for the hidden key under the desk"}
    {:id 2 :type "speech" :text "The code is hidden in the painting" :speech-file :hint-01-audio :delay 5}
  ]
  
  :modes {
    :demo {:intro-duration 30 :game-duration 300 :hint-interval 60}
  }
  
  :default-mode :demo
  :game-heartbeat-ms 1000
}
```

---

## Step 12: Validate & Run

**Validate**:

```bash
npm run validate -- demo-game.edn
```

**Run**:

```bash
node src/game.js --config demo-game.edn --mode demo
```

**Monitor MQTT**:

```bash
mosquitto_sub -h localhost -p 1883 -t 'paradox/game/#' -v
```

---

## Step 13: Control Game via MQTT

**Start Game**:

```bash
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' \
  -m '{"command":"startGame","mode":"demo"}'
```

**Deliver Hint**:

```bash
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' \
  -m '{"command":"deliverHint","hintId":1}'
```

**Solve Game**:

```bash
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' \
  -m '{"command":"solveGame"}'
```

**Reset Game**:

```bash
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' \
  -m '{"command":"resetGame"}'
```

---

## Advanced Topics

### Multi-Sequence Phases

Run multiple sequences in order:

```clojure
:phases {
  :intro [:briefing-sequence :rules-sequence :countdown-sequence]
}
```

Sequences execute sequentially (blocking).

---

### Sub-Sequences

Trigger sequences from within sequences:

```clojure
:sequences {
  :hint-flash-sequence {
    :duration 5
    :timeline [
      {:at 5 :cue :lights-red}
      {:at 4 :cue :lights-blue}
      {:at 3 :cue :lights-red}
      {:at 2 :cue :lights-blue}
      {:at 1 :cue :lights-green}
    ]
  }
  
  :gameplay-sequence {
    :duration 300
    :timeline [
      {:at 200 :fire-seq :hint-flash-sequence}  ; Execute sub-sequence
    ]
  }
}
```

---

### Wait/Delay Steps

Add explicit delays:

```clojure
:sequences {
  :intro-sequence {
    :duration 30
    :timeline [
      {:at 30 :cue :lights-red}
      {:at 25 :wait 5}  ; Wait 5 seconds
      {:at 20 :cue :lights-green}
    ]
  }
}
```

**Note**: Delays are implicit in timeline. `:wait` is rarely needed.

---

### Mode-Specific Sequence Overrides

```clojure
:sequences {
  :intro-sequence {
    :duration 45
    :timeline [ ... ]  ; Default (60min mode)
  }
}

:modes {
  :demo {
    :sequences {
      :intro-sequence {
        :duration 15  ; Shorter for demo
        :timeline [
          {:at 15 :cue :lights-red}
          {:at 5 :cue :lights-green}
        ]
      }
    }
  }
}
```

Modes inherit global sequences unless overridden.

---

### Variable Substitution

Use `{{variable}}` syntax:

```clojure
:cues {
  :play-hint {
    :zone "audio"
    :command "playAudioFX"
    :file "media/hints/{{hint-file}}"
  }
}

:hints [
  {
    :id 3
    :type "action"
    :sequence :play-hint
    :hint-file "hint-03.mp3"  ; Substituted into {{hint-file}}
  }
]
```

---

### Complex Hint Types

**Combined Speech + Video**:

```clojure
{
  :id 4
  :type "speech"
  :text "Watch and listen carefully"
  :speech-file "media/hints/hint-04.mp3"
  :video-file "media/video/hints/hint-04.mp4"
  :video-zone "mirror"
  :delay 3
}
```

**Action Hint** (executes sequence):

```clojure
{
  :id 5
  :type "action"
  :text "Watch the lights"
  :sequence :hint-flash-sequence
}
```

---

## Testing Tips

### 1. Start Simple

Test zones independently:

```bash
# Test lights
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/lights/commands' \
  -m '{"command":"scene","name":"red"}'

# Test media
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/mirror/commands' \
  -m '{"command":"playVideo","file":"media/test.mp4"}'
```

### 2. Use Demo Mode

Create short sequences for testing:

```clojure
:modes {
  :test {
    :intro-duration 10
    :game-duration 30
    :sequences {
      :intro-sequence {:duration 10 :timeline [{:at 10 :cue :lights-red}]}
    }
  }
}
```

### 3. Enable Debug Logging

```bash
LOG_LEVEL=debug node src/game.js
```

### 4. Monitor MQTT

```bash
# Watch all topics
mosquitto_sub -h localhost -p 1883 -t 'paradox/#' -v

# Watch specific zone
mosquitto_sub -h localhost -p 1883 -t 'paradox/game/lights/#' -v
```

### 5. Use Validation

```bash
npm run validate -- game.edn
```

---

## Common Patterns

### Fade-In/Fade-Out

```clojure
:sequences {
  :fade-in {
    :duration 5
    :timeline [
      {:at 5 :zone "lights" :command "scene" :name "dim"}
      {:at 4 :zone "lights" :command "brightness" :level 20}
      {:at 3 :zone "lights" :command "brightness" :level 40}
      {:at 2 :zone "lights" :command "brightness" :level 60}
      {:at 1 :zone "lights" :command "brightness" :level 80}
    ]
  }
}
```

### Synchronized Media

```clojure
:cues {
  :sync-intro [
    {:zone "mirror" :command "playVideo" :file :intro-video}
    {:zone "audio" :command "playAudioFX" :file :intro-music :volume 60}
    {:zone "lights" :command "scene" :name "dim"}
  ]
}
```

### Looping Ambient Audio

```clojure
{:at 300 :zone "audio" :command "playAudioFX" :file "ambient.mp3" :loop true :volume 30}
```

### Emergency Stop

```clojure
:cues {
  :emergency-stop [
    {:zones ["mirror" "audio"] :command "stopAudio"}
    {:zone "lights" :command "scene" :name "red"}
    {:zone "clock" :command "pauseTimer"}
  ]
}
```

---

## Best Practices

### 1. Use Keywords for Reusability

```clojure
; Good
:media {:intro :intro-video}
{:file :intro}

; Avoid
{:file "media/video/intro.mp4"}
```

### 2. Comment Complex Logic

```clojure
:sequences {
  :intro {
    :duration 45
    :timeline [
      ; Phase 1: Lights dim (T=0)
      {:at 45 :cue :lights-dim}
      
      ; Phase 2: Video starts (T=5)
      {:at 40 :zone "mirror" :command "playVideo" :file :intro-video}
    ]
  }
}
```

### 3. Test in Isolation

Build and test sequences independently before combining.

### 4. Use Modes for Variations

Don't duplicate sequences — use modes:

```clojure
:modes {
  :60min {:game-duration 3600}
  :30min {:game-duration 1800}
  :demo {:game-duration 300}
}
```

### 5. Version Control

- ✅ Commit: `game.edn`, `pxo.ini.example`
- ❌ Don't commit: `pxo.ini` (local settings)

---

## Troubleshooting

### Sequences Don't Run

- Check phase mapping: `:phases {:intro [:intro-sequence]}`
- Validate timeline `:at` values (must be ≤ `:duration`)
- Enable debug logging: `LOG_LEVEL=debug`

### Zone Commands Ignored

- Verify zone adapter is running (`systemctl status pfx.service`)
- Check MQTT topic matches: `baseTopic` in EDN = adapter topic
- Monitor MQTT: `mosquitto_sub -t 'paradox/game/#' -v`

### Timing Issues

- Timing model: `:at` counts down from `:duration`
- `:at 30` with `:duration 45` → executes at T=15 seconds

### Hints Not Delivered

- Check hint ID exists in `:hints` array
- Verify hint type is valid (`text`, `speech`, `audio`, `video`, `action`)
- Check media files exist for `speech`/`video` hints

---

## Next Steps

- Read [SPEC.md](SPEC.md) for detailed architecture
- Explore [MQTT_API.md](MQTT_API.md) for API reference
- Check [CONFIG_EDN.md](CONFIG_EDN.md) and [CONFIG_INI.md](CONFIG_INI.md) for full config options
- Review [AI_AGENT_INSTRUCTIONS_PXO.md](AI_AGENT_INSTRUCTIONS_PXO.md) for development patterns

---

## Example Projects

### Houdini's Challenge

See `/opt/paradox/rooms/houdinis-challenge/config/game.edn` for a complete 60-minute escape room game.

**Features**:
- 45-second intro with video briefing
- 60-minute gameplay with puzzle zones
- 5 hint types (text, speech, video, audio, action)
- Victory/failure sequences
- 3 game modes (60min, 30min, demo)

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
