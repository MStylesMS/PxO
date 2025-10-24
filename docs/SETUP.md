# Paradox Orchestrator (PxO) — Setup & Deployment Guide

**Version**: 1.0.0  
**Last Updated**: October 2025

## Overview

This guide covers installation, configuration, and deployment of Paradox Orchestrator (PxO) — a zone-based game engine for escape rooms and interactive experiences.

**Prerequisites**:
- Node.js 18+ or 20+ LTS
- MQTT broker (Mosquitto recommended)
- Linux/macOS/Windows (Raspberry Pi 4/5 supported)

---

## Quick Start

### 1. Install Dependencies

```bash
# Clone repository
git clone https://github.com/MStylesMS/paradox-orchestrator.git
cd paradox-orchestrator

# Install Node.js dependencies
npm install

# Verify installation
node src/game.js --version
```

### 2. Install MQTT Broker

**Mosquitto** (recommended):

```bash
# Debian/Ubuntu/Raspberry Pi OS
sudo apt update
sudo apt install -y mosquitto mosquitto-clients

# Enable and start service
sudo systemctl enable mosquitto
sudo systemctl start mosquitto

# Test connection
mosquitto_sub -h localhost -p 1883 -t 'test/#' -v
```

**macOS** (via Homebrew):

```bash
brew install mosquitto
brew services start mosquitto
```

**Windows**:

Download from [https://mosquitto.org/download/](https://mosquitto.org/download/)

### 3. Create Configuration

**Copy example config**:

```bash
cp config/pxo.ini.example config/pxo.ini
```

**Edit `config/pxo.ini`**:

```ini
[mqtt]
broker = localhost
port = 1883

[logging]
level = info
directory = /opt/paradox/logs/pxo

[game]
default_mode = demo
```

### 4. Create Game Configuration

**Create `game.edn`** (see [USER_GUIDE.md](USER_GUIDE.md) for tutorial):

```clojure
{
  :zones {
    :lights {:type "pfx-lights" :baseTopic "paradox/game/lights"}
    :mirror {:type "pfx-media" :baseTopic "paradox/game/mirror"}
  }
  
  :cues {
    :lights-red {:zone "lights" :command "scene" :name "red"}
  }
  
  :sequences {
    :intro {
      :duration 30
      :timeline [
        {:at 30 :cue :lights-red}
      ]
    }
  }
  
  :phases {
    :intro [:intro]
  }
  
  :modes {
    :demo {:intro-duration 30 :game-duration 300}
  }
  
  :hints []
  :default-mode :demo
}
```

### 5. Validate Configuration

```bash
npm run validate -- game.edn
```

### 6. Run Game Engine

```bash
node src/game.js --config game.edn --mode demo
```

---

## Installation Details

### System Requirements

**Minimum**:
- CPU: 1 GHz single-core
- RAM: 512 MB
- Storage: 100 MB (+ media files)
- Network: Ethernet or Wi-Fi

**Recommended** (Raspberry Pi 4/5):
- CPU: 1.5 GHz quad-core (Pi 4B/5)
- RAM: 2 GB+
- Storage: 8 GB+ SD card
- Network: Gigabit Ethernet

### Node.js Installation

**Debian/Ubuntu/Raspberry Pi OS**:

```bash
# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # v20.x.x
npm --version   # 10.x.x
```

**macOS**:

```bash
# Via Homebrew
brew install node@20

# Or via Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
```

**Windows**:

Download from [https://nodejs.org/](https://nodejs.org/) (20.x LTS)

### PxO Installation

**From Git**:

```bash
git clone https://github.com/MStylesMS/paradox-orchestrator.git /opt/paradox/pxo
cd /opt/paradox/pxo
npm install
```

**From NPM** (when published):

```bash
npm install -g paradox-orchestrator
pxo --version
```

---

## Configuration

### Directory Structure

```
/opt/paradox/pxo/
├── src/                    # Source code
├── config/                 # Configuration files
│   ├── pxo.ini            # System settings (local, not in git)
│   └── pxo.ini.example    # Example config
├── game.edn               # Game configuration (or in /rooms/...)
├── media/                 # Media files
├── logs/                  # Log files
└── package.json           # Dependencies
```

### INI Configuration

**Location**: `./config/pxo.ini` or `--ini /path/to/pxo.ini`

**Example**:

```ini
[mqtt]
broker = localhost
port = 1883
client_id = pxo-game-engine

[logging]
level = info
directory = /opt/paradox/logs/pxo
max_files = 10
max_size_mb = 10

[game]
default_mode = 60min
heartbeat_ms = 1000
auto_reset_enabled = true
auto_reset_delay = 300

[zones]
lights = paradox/game/lights
mirror = paradox/game/mirror
audio = paradox/game/audio
clock = paradox/game/clock
```

See [CONFIG_INI.md](CONFIG_INI.md) for complete reference.

### EDN Configuration

**Location**: `./game.edn` or `--config /path/to/game.edn`

**Minimal Example**:

```clojure
{
  :zones { ... }
  :sequences { ... }
  :phases { ... }
  :modes { ... }
  :hints []
  :default-mode :60min
}
```

See [CONFIG_EDN.md](CONFIG_EDN.md) for complete reference.

---

## Running PxO

### Command Line

**Basic**:

```bash
node src/game.js
```

**With Options**:

```bash
# Specify config files
node src/game.js --config /path/to/game.edn --ini /path/to/pxo.ini

# Override mode
node src/game.js --mode demo

# Enable debug logging
LOG_LEVEL=debug node src/game.js

# Override MQTT broker
MQTT_BROKER=192.168.1.100 node src/game.js
```

**CLI Flags**:

| Flag | Description | Example |
|------|-------------|---------|
| `--config` | EDN config file | `--config game.edn` |
| `--ini` | INI config file | `--ini config/pxo.ini` |
| `--mode` | Game mode | `--mode demo` |
| `--version` | Show version | `--version` |
| `--help` | Show help | `--help` |

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GAME_MODE` | Default mode | `GAME_MODE=demo` |
| `MQTT_BROKER` | MQTT broker | `MQTT_BROKER=192.168.1.100` |
| `MQTT_PORT` | MQTT port | `MQTT_PORT=1883` |
| `LOG_LEVEL` | Log level | `LOG_LEVEL=debug` |
| `LOG_DIRECTORY` | Log directory | `LOG_DIRECTORY=/tmp/logs` |

### NPM Scripts

```bash
# Run with default config
npm start

# Run validation
npm run validate -- game.edn

# Run tests
npm test

# Run with specific mode
npm run start:demo    # Demo mode
npm run start:60min   # 60-minute mode
```

---

## Systemd Service Deployment

### Create Service File

**File**: `/etc/systemd/system/pxo.service`

```ini
[Unit]
Description=Paradox Orchestrator (PxO)
Documentation=https://github.com/MStylesMS/paradox-orchestrator
After=network.target mosquitto.service
Requires=mosquitto.service

[Service]
Type=simple
User=paradox
Group=paradox
WorkingDirectory=/opt/paradox/pxo
ExecStart=/usr/bin/node src/game.js --config /opt/paradox/rooms/my-room/game.edn --ini /etc/paradox/pxo.ini
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Environment
Environment="NODE_ENV=production"
Environment="LOG_LEVEL=info"

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Install Service

```bash
# Copy service file
sudo cp pxo.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable pxo.service

# Start service
sudo systemctl start pxo.service

# Check status
sudo systemctl status pxo.service
```

### Service Management

```bash
# Start
sudo systemctl start pxo.service

# Stop
sudo systemctl stop pxo.service

# Restart
sudo systemctl restart pxo.service

# View logs
sudo journalctl -u pxo.service -f

# View recent logs
sudo journalctl -u pxo.service -n 100

# Disable auto-start
sudo systemctl disable pxo.service
```

---

## Raspberry Pi Deployment

### Pi 4/5 Optimization

**1. Expand Swap (if needed)**:

```bash
# Create 4GB swapfile
sudo /opt/paradox/scripts/setup-swapfile.sh 4096

# Or install zram (2GB compressed in-RAM swap)
sudo cp /opt/paradox/config/zram-swap.service /etc/systemd/system/
sudo systemctl enable zram-swap.service
sudo systemctl start zram-swap.service
```

**2. Disable Unused Services**:

```bash
# Disable Bluetooth
sudo systemctl disable bluetooth.service

# Disable Wi-Fi (if using Ethernet)
sudo systemctl disable wpa_supplicant.service
```

**3. Auto-Start on Boot**:

```bash
# Enable PxO service
sudo systemctl enable pxo.service
```

### Headless Operation

**SSH Access**:

```bash
# Enable SSH
sudo systemctl enable ssh
sudo systemctl start ssh
```

**Remote Logging**:

```ini
[logging]
# Send logs to remote syslog server
remote_syslog = 192.168.1.50:514
```

---

## MQTT Configuration

### Mosquitto Setup

**Config**: `/etc/mosquitto/mosquitto.conf` or `/etc/mosquitto/conf.d/paradox.conf`

```conf
# Listener
listener 1883 0.0.0.0

# Logging
log_dest file /var/log/mosquitto/mosquitto.log
log_type all

# Persistence
persistence true
persistence_location /var/lib/mosquitto/

# Authentication (optional)
allow_anonymous false
password_file /etc/mosquitto/passwd

# ACL (optional)
acl_file /etc/mosquitto/acl
```

### Create User (Optional)

```bash
# Create password file
sudo mosquitto_passwd -c /etc/mosquitto/passwd paradox

# Add additional users
sudo mosquitto_passwd /etc/mosquitto/passwd guest

# Restart Mosquitto
sudo systemctl restart mosquitto
```

### Test MQTT

```bash
# Subscribe to all topics
mosquitto_sub -h localhost -p 1883 -t 'paradox/#' -v

# Publish test message
mosquitto_pub -h localhost -p 1883 -t 'paradox/test' -m 'Hello'

# With authentication
mosquitto_sub -h localhost -p 1883 -u paradox -P password -t 'paradox/#' -v
```

---

## Zone Adapter Setup

### ParadoxFX (Lights & Media)

**Install**:

```bash
cd /opt/paradox/apps/ParadoxFX
npm install
```

**Config**: `config/pfx.ini`

```ini
[mqtt]
broker = localhost
port = 1883

[zones.lights]
baseTopic = paradox/game/lights
type = lights

[zones.mirror]
baseTopic = paradox/game/mirror
type = media
media_root = /opt/paradox/media
```

**Run**:

```bash
node pfx.js --config config/pfx.ini
```

**Systemd Service**: `/etc/systemd/system/pfx.service`

```ini
[Unit]
Description=ParadoxFX Media & Lighting
After=network.target mosquitto.service

[Service]
Type=simple
User=paradox
WorkingDirectory=/opt/paradox/apps/ParadoxFX
ExecStart=/usr/bin/node pfx.js --config /opt/paradox/config/pfx.ini
Restart=always

[Install]
WantedBy=multi-user.target
```

### Houdini Clock UI

**Install**:

```bash
cd /opt/paradox/apps/houdiniclock
npm install
npm run build
```

**Serve** (with nginx or built-in server):

```bash
# Built-in server
npm start  # http://localhost:3000

# Or use nginx
sudo cp config/nginx.conf /etc/nginx/sites-available/houdiniclock
sudo ln -s /etc/nginx/sites-available/houdiniclock /etc/nginx/sites-enabled/
sudo systemctl reload nginx
```

**Config**: `config/clock.ini`

```ini
[mqtt]
broker = localhost
port = 1883
baseTopic = paradox/game/clock
```

---

## Validation & Testing

### Configuration Validation

```bash
# Validate EDN
npm run validate -- game.edn

# Validate INI
npm run validate:ini -- config/pxo.ini
```

### MQTT Monitoring

```bash
# Monitor all game topics
mosquitto_sub -h localhost -p 1883 -t 'paradox/game/#' -v

# Monitor specific zone
mosquitto_sub -h localhost -p 1883 -t 'paradox/game/lights/#' -v
```

### Manual Testing

```bash
# Start game
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' -m '{"command":"startGame","mode":"demo"}'

# Pause game
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' -m '{"command":"pauseGame"}'

# Resume game
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' -m '{"command":"resumeGame"}'

# Reset game
mosquitto_pub -h localhost -p 1883 -t 'paradox/game/commands' -m '{"command":"resetGame"}'
```

---

## Troubleshooting

### PxO Won't Start

**Check logs**:

```bash
# If running via systemd
sudo journalctl -u pxo.service -f

# If running manually
tail -f /opt/paradox/logs/pxo/pxo-*.log
```

**Common issues**:
- MQTT broker not running → `sudo systemctl start mosquitto`
- Config file not found → Check `--config` and `--ini` paths
- Invalid EDN syntax → Run `npm run validate -- game.edn`
- Permission denied → Check file permissions and user

### MQTT Connection Failed

**Test broker**:

```bash
# Check if Mosquitto is running
sudo systemctl status mosquitto

# Test connection
mosquitto_pub -h localhost -p 1883 -t 'test' -m 'hello'
```

**Check firewall**:

```bash
# Allow MQTT port
sudo ufw allow 1883/tcp
```

### Zone Commands Not Working

**Check zone adapter**:

```bash
# ParadoxFX
sudo systemctl status pfx.service

# Clock UI
curl http://localhost:3000/health
```

**Monitor MQTT**:

```bash
# Watch zone topics
mosquitto_sub -h localhost -p 1883 -t 'paradox/game/lights/#' -v
```

**Verify config**:

```clojure
; In game.edn, check zone definition
:zones {
  :lights {
    :type "pfx-lights"
    :baseTopic "paradox/game/lights"  ; Must match adapter topic
  }
}
```

### Sequence Timing Issues

**Enable debug logging**:

```bash
LOG_LEVEL=debug node src/game.js
```

**Check sequence definition**:

```clojure
:sequences {
  :intro {
    :duration 30  ; Total duration
    :timeline [
      {:at 30 :cue :lights-red}  ; T=0 (30-30)
      {:at 25 :cue :lights-green}  ; T=5 (30-25)
      {:at 5 :cue :lights-blue}  ; T=25 (30-5)
    ]
  }
}
```

---

## Production Checklist

- [ ] Node.js 18+ installed
- [ ] MQTT broker (Mosquitto) installed and running
- [ ] PxO installed in `/opt/paradox/pxo`
- [ ] Config files created (`pxo.ini`, `game.edn`)
- [ ] Configuration validated (`npm run validate`)
- [ ] Zone adapters installed (ParadoxFX, Clock UI)
- [ ] Systemd service created (`pxo.service`)
- [ ] Service enabled (`systemctl enable pxo.service`)
- [ ] Logs directory created (`/opt/paradox/logs/pxo`)
- [ ] Media files deployed (`/opt/paradox/media`)
- [ ] MQTT topics tested (`mosquitto_sub`)
- [ ] Auto-start on boot verified (reboot test)
- [ ] Backup strategy configured

---

## Backup & Recovery

### Backup Configuration

```bash
# Backup config files
tar -czf pxo-config-backup.tar.gz \
  /opt/paradox/pxo/game.edn \
  /opt/paradox/pxo/config/pxo.ini \
  /etc/systemd/system/pxo.service

# Backup logs
tar -czf pxo-logs-backup.tar.gz /opt/paradox/logs/pxo
```

### Restore Configuration

```bash
# Extract backup
tar -xzf pxo-config-backup.tar.gz -C /

# Reload systemd
sudo systemctl daemon-reload

# Restart service
sudo systemctl restart pxo.service
```

---

## Upgrade Guide

### Update PxO

```bash
cd /opt/paradox/pxo
git pull origin main
npm install
sudo systemctl restart pxo.service
```

### Breaking Changes

Check [CHANGELOG.md](CHANGELOG.md) before upgrading.

---

## Additional Resources

- **Configuration**: [CONFIG_EDN.md](CONFIG_EDN.md), [CONFIG_INI.md](CONFIG_INI.md)
- **API Reference**: [MQTT_API.md](MQTT_API.md)
- **User Guide**: [USER_GUIDE.md](USER_GUIDE.md)
- **Specification**: [SPEC.md](SPEC.md)
- **GitHub**: https://github.com/MStylesMS/paradox-orchestrator

---

**Document Version**: 1.0.0  
**PxO Version**: 1.0.0  
**Last Updated**: October 2025
