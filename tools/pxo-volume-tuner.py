#!/usr/bin/env python3
"""
pxo-volume-tuner — Interactive audio/video volume tuner for PxO EDN game configs.

Scans an EDN file for all playable audio/video commands, plays each one via
MQTT, and lets you interactively adjust volumes.  Optionally writes changes
back to the EDN file using in-place line-level string substitution (no AI,
no external patch tools beyond Python's own str.replace on the specific line).

Usage:
    pxo-volume-tuner.py [options] <edn-file>

Examples:
    # Dry-run (review only, no file writes):
    python3 tools/pxo-volume-tuner.py config/agent22.edn

    # Write accepted changes back to EDN:
    python3 tools/pxo-volume-tuner.py --write config/agent22.edn

    # Override broker / topic base:
    python3 tools/pxo-volume-tuner.py --broker 192.168.1.10 --topic paradox/agent22/tv config/agent22.edn
"""

import argparse
import json
import os
import re
import select
import shutil
import subprocess
import sys
import termios
import tty
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLAY_COMMANDS = frozenset({
    "playVideo", "playBackground", "playAudioFX", "playSpeech", "playEffect",
})

# EDN keywords that look like cue names but aren't
_EDN_NON_CUE_KEYWORDS = frozenset({
    "zone", "command", "file", "type", "description", "at", "fire",
    "schedule", "sequence", "loop", "wait", "duration", "time", "text",
    "format", "version", "game-name", "create-date", "edit-date",
    "global", "game-modes", "mqtt", "media", "cues", "hints", "inputs",
    "triggers", "sequences", "system-sequences", "command-sequences",
    "zones", "settings", "phases", "intro", "gameplay", "solved",
    "failed", "abort", "reset", "repeat-seconds",
})

# Map each play command to its matching stop command
_STOP_BY_COMMAND: dict[str, dict] = {
    "playVideo":      {"command": "stopVideo"},
    "playBackground": {"command": "stopBackground"},
    "playSpeech":     {"command": "stopSpeech"},
    "playAudioFX":    {"command": "stopAudio"},
    "playEffect":     {"command": "stopAudio"},
}


def stop_payload_for(command: str) -> dict:
    """Return the appropriate stop command payload for a given play command."""
    return _STOP_BY_COMMAND.get(command, {"command": "stopAll"})


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class MediaItem:
    """One playable audio/video command found in the EDN file."""
    line_num: int           # 1-based line number in original EDN
    cue_name: str           # e.g. "start-ambient-music" or "line-42"
    zone: str               # e.g. "tv"
    command: str            # e.g. "playBackground"
    file_symbol: str        # e.g. "ambient-music" (the :keyword from EDN)
    file_path: str          # resolved path, e.g. "audio/music/American_Music.ogg"
    volume: Optional[int]   # explicit :volume value, or None
    adjust_volume: Optional[int]  # :adjustVolume value, or None
    topic: str              # full MQTT topic  e.g. "paradox/agent22/tv/commands"
    original_line: str      # raw EDN line (for display / write-back reference)

    # Set during interactive tuning:
    new_volume: Optional[int] = field(default=None)         # None = unchanged
    new_adjust_volume: Optional[int] = field(default=None)  # None = unchanged
    remove_volume: bool = field(default=False)              # True = revert to default
    skipped: bool = field(default=False)

    @property
    def changed(self) -> bool:
        if self.remove_volume:
            return self.volume is not None or self.adjust_volume is not None
        if self.new_volume is not None and self.new_volume != self.volume:
            return True
        if self.new_adjust_volume is not None and self.new_adjust_volume != self.adjust_volume:
            return True
        return False

    def vol_display(self, volume=None, adjust=None) -> str:
        v = volume if volume is not None else self.volume
        a = adjust if adjust is not None else self.adjust_volume
        if v is not None:
            return f"volume={v}"
        if a is not None:
            return f"adjustVolume={a:+d}"
        return "volume=default"

    def new_vol_display(self) -> str:
        if self.remove_volume:
            return "volume=default"
        return self.vol_display(self.new_volume, self.new_adjust_volume)


# ---------------------------------------------------------------------------
# EDN parsing
# ---------------------------------------------------------------------------

def _find_media_block_lines(lines: list[str]) -> list[str]:
    """Return the lines that belong to the :media {...} block."""
    result = []
    in_media = False
    depth = 0
    for line in lines:
        s = line.strip()
        if not in_media:
            if re.search(r':media\s*\{', s):
                in_media = True
                depth = s.count('{') - s.count('}')
                result.append(s)
        else:
            depth += s.count('{') - s.count('}')
            result.append(s)
            if depth <= 0:
                break
    return result


def parse_media_refs(lines: list[str]) -> dict[str, str]:
    """Build a :symbol -> "file/path" mapping from the :media block."""
    media: dict[str, str] = {}
    for s in _find_media_block_lines(lines):
        for m in re.finditer(r':([\w-]+)\s+"([^"]+)"', s):
            media[m.group(1)] = m.group(2)
    return media


def parse_zone_topics(lines: list[str]) -> dict[str, str]:
    """
    Build a zone-name -> MQTT base-topic mapping from :zones entries.

    Using [^{}]* (exclude both brace types) ensures the pattern cannot leap
    over a nested opening brace, so :zones { :tv { ... } } on one line will
    match :tv correctly rather than :zones.
    """
    zones: dict[str, str] = {}
    # Zone entries always have both :type and :base-topic within a single-level map.
    # [^{}]* prevents crossing nested { } boundaries.
    _zone_re = re.compile(
        r':([\w-]+)\s+\{[^{}]*:type\s+"[^"]*"[^{}]*:base-topic\s+"([^"]+)"'
        r'|'
        r':([\w-]+)\s+\{[^{}]*:base-topic\s+"([^"]+)"[^{}]*:type\s+"[^"]*"'
    )
    for line in lines:
        for m in _zone_re.finditer(line):
            if m.group(1):
                zones[m.group(1)] = m.group(2)
            else:
                zones[m.group(3)] = m.group(4)
    return zones


def parse_audio_video_commands(
    lines: list[str],
    media_refs: dict[str, str],
    zone_topics: dict[str, str],
    topic_override: Optional[str],
) -> list[MediaItem]:
    """
    Scan every line for playable audio/video commands and return a list of
    MediaItem objects.  Each unique (line_num, command) is one item, so the
    same media file can appear multiple times with different volumes.
    """
    items: list[MediaItem] = []

    for line_num, raw_line in enumerate(lines, 1):
        line = raw_line.rstrip('\n')
        stripped = line.strip()

        # Skip comment lines
        if stripped.startswith(';'):
            continue

        # Must contain one of our play commands
        cmd_m = re.search(
            r':command\s+"(play(?:Video|Background|AudioFX|Speech|Effect))"',
            stripped,
        )
        if not cmd_m:
            continue

        command = cmd_m.group(1)

        # Zone
        zone_m = re.search(r':zone\s+"([\w-]+)"', stripped)
        zone = zone_m.group(1) if zone_m else "tv"

        # File reference  (:file :symbol  or  :file "path")
        file_sym_m = re.search(r':file\s+:([\w-]+)', stripped)
        if file_sym_m:
            file_symbol = file_sym_m.group(1)
            file_path = media_refs.get(file_symbol, f"<unresolved:{file_symbol}>")
        else:
            file_str_m = re.search(r':file\s+"([^"]+)"', stripped)
            file_symbol = file_str_m.group(1) if file_str_m else "unknown"
            file_path = file_symbol

        # Volume
        vol_m   = re.search(r':volume\s+(\d+)', stripped)
        adj_m   = re.search(r':adjustVolume\s+(-?\d+)', stripped)
        volume       = int(vol_m.group(1))  if vol_m  else None
        adjust_volume = int(adj_m.group(1)) if adj_m  else None

        # Cue / sequence name — the :keyword before the opening { of this entry
        cue_name = f"line-{line_num}"
        name_m = re.search(r':([\w-]+)\s+\{', stripped)
        if name_m and name_m.group(1) not in _EDN_NON_CUE_KEYWORDS:
            cue_name = name_m.group(1)

        # MQTT topic
        if topic_override:
            topic = topic_override.rstrip('/') + "/commands"
        elif zone in zone_topics:
            topic = zone_topics[zone] + "/commands"
        else:
            topic = f"paradox/game/{zone}/commands"

        items.append(MediaItem(
            line_num=line_num,
            cue_name=cue_name,
            zone=zone,
            command=command,
            file_symbol=file_symbol,
            file_path=file_path,
            volume=volume,
            adjust_volume=adjust_volume,
            topic=topic,
            original_line=line,
        ))

    return items


# ---------------------------------------------------------------------------
# MQTT helpers
# ---------------------------------------------------------------------------

def mqtt_pub(broker: str, port: int, topic: str, payload: dict) -> bool:
    """Fire an MQTT message via mosquitto_pub. Returns True on success."""
    result = subprocess.run(
        ["mosquitto_pub", "-h", broker, "-p", str(port), "-t", topic, "-m",
         json.dumps(payload)],
        capture_output=True, text=True,
    )
    return result.returncode == 0


def build_play_payload(item: MediaItem, work_vol: Optional[int], work_adj: Optional[int]) -> dict:
    """Build the JSON payload for a play command."""
    payload: dict = {"command": item.command, "file": item.file_path}
    if item.command == "playBackground":
        payload["loop"] = True
    if work_vol is not None:
        payload["volume"] = work_vol
    elif work_adj is not None:
        payload["adjustVolume"] = work_adj
    return payload


# ---------------------------------------------------------------------------
# Terminal / keyboard helpers
# ---------------------------------------------------------------------------

def get_single_key(prompt: str, valid_chars: str) -> str:
    """
    Display prompt and return the first keypress that is in valid_chars,
    immediately — no Enter required.  Case-insensitive.  Ctrl-C raises
    KeyboardInterrupt.
    """
    valid = set(valid_chars.lower())
    print(prompt, end='', flush=True)
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        while True:
            ch = sys.stdin.read(1)
            if ch == '\x03':
                raise KeyboardInterrupt
            if ch.lower() in valid:
                print(ch.upper())  # echo the choice
                return ch.lower()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def wait_for_space_or_enter() -> str:
    """
    Wait until SPACE or ENTER is pressed.
    Returns 'space' or 'enter'.  Ctrl-C raises KeyboardInterrupt.
    """
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        while True:
            r, _, _ = select.select([sys.stdin], [], [], 0.05)
            if r:
                ch = sys.stdin.read(1)
                if ch == ' ':
                    return 'space'
                if ch in ('\r', '\n'):
                    return 'enter'
                if ch == '\x03':
                    raise KeyboardInterrupt
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def ask_line(prompt: str) -> str:
    """Read a line of input (restores cooked mode first)."""
    print(prompt, end='', flush=True)
    try:
        return input()
    except EOFError:
        return ''


# ---------------------------------------------------------------------------
# Interactive tuning loop
# ---------------------------------------------------------------------------

def tune_item(item: MediaItem, broker: str, port: int) -> bool:
    """
    Interactive tuning session for a single MediaItem.
    Returns True to continue to the next item, False to quit entirely.
    """
    bar = "─" * 72
    print(f"\n{bar}")
    print(f"  Cue     : :{item.cue_name}  (line {item.line_num})")
    print(f"  Command : {item.command}")
    print(f"  File    : {item.file_path}")
    print(f"  Volume  : {item.vol_display()}")
    print(f"  Topic   : {item.topic}")
    print()

    choice = get_single_key("  [P]lay  [S]kip  [Q]uit → ", "psq")

    if choice == 'q':
        return False
    if choice == 's':
        item.skipped = True
        return True

    # --- Play / volume-adjust loop -------------------------------------------
    work_vol = item.volume
    work_adj = item.adjust_volume
    manually_stopped = False
    needs_play = True   # play before showing the first volume prompt

    # Whether this cue uses :adjustVolume semantics (kept throughout the session)
    using_adjust = item.adjust_volume is not None and item.volume is None

    while True:
        if needs_play:
            payload = build_play_payload(item, work_vol, work_adj)
            print(f"\n  ▶ {json.dumps(payload)}")
            manually_stopped = False
            if not mqtt_pub(broker, port, item.topic, payload):
                print("  ✗ mosquitto_pub failed — check broker settings.")

            print(f"  Playing [{item.vol_display(work_vol, work_adj)}]"
                  "  — SPACE to stop, ENTER when done: ", end='', flush=True)
            action = wait_for_space_or_enter()
            print()

            if action == 'space':
                mqtt_pub(broker, port, item.topic, stop_payload_for(item.command))
                manually_stopped = True
                print("  ■ Stopped.")

        # --- Volume prompt ---------------------------------------------------
        cur_display = item.vol_display(work_vol, work_adj)
        if using_adjust:
            range_hint = "-50..+50"
            type_hint  = "adjustVolume"
        else:
            range_hint = "0-150"
            type_hint  = "volume"
        raw = ask_line(
            f"  {type_hint} {range_hint}, 'd'=default, 's'=skip item, ENTER=accept [{cur_display}]: "
        ).strip()

        if raw == '':
            # Accept current working value
            _apply_working_vol(item, work_vol, work_adj)
            break

        if raw.lower() == 's':
            # Abandon any changes and move on to next item
            item.skipped = True
            manually_stopped = True  # suppress auto-stop message
            break

        if raw.lower() == 'd':
            item.remove_volume = True
            item.new_volume = None
            item.new_adjust_volume = None
            print("  ✓ Will remove setting (revert to default).")
            break

        try:
            n = int(raw)
        except ValueError:
            print(f"  ! '{raw}' — enter {range_hint}, 'd', 's', or ENTER to accept.")
            needs_play = False  # re-ask without replaying
            continue

        if using_adjust:
            if not (-50 <= n <= 50):
                print(f"  ! {n} is out of range {range_hint}.")
                needs_play = False
                continue
            work_adj = n
            work_vol = None
        else:
            if not (0 <= n <= 150):
                print(f"  ! {n} is out of range {range_hint}.")
                needs_play = False
                continue
            work_vol = n
            work_adj = None

        # New valid value — replay before asking again
        needs_play = True
        print(f"  ↺ Replaying at {type_hint}={n}…")

    # Stop before moving to next item
    if not manually_stopped:
        stop = stop_payload_for(item.command)
        print(f"  ■ Stopping {item.command[4:].lower()} before next item…")
        mqtt_pub(broker, port, item.topic, stop)

    return True


def _apply_working_vol(item: MediaItem, work_vol: Optional[int], work_adj: Optional[int]):
    """Store the current working volume on the item if it differs from original."""
    if work_vol != item.volume:
        item.new_volume = work_vol
    if work_adj != item.adjust_volume:
        item.new_adjust_volume = work_adj


def run_interactive(
    items: list[MediaItem],
    broker: str,
    port: int,
) -> None:
    """Run the interactive tuning session over all discovered items."""
    total = len(items)
    print(f"\nFound {total} audio/video command(s).  Starting tuner…")
    print("(Ctrl-C at any time to abort without writing changes)\n")

    for idx, item in enumerate(items, 1):
        print(f"\n[{idx}/{total}]", end='')
        keep_going = tune_item(item, broker, port)
        if not keep_going:
            print("\n  Quit requested — stopping early.")
            break


# ---------------------------------------------------------------------------
# EDN write-back
# ---------------------------------------------------------------------------

def _replace_volume_on_line(line: str, old_vol: Optional[int], old_adj: Optional[int],
                             new_vol: Optional[int], new_adj: Optional[int],
                             remove: bool) -> str:
    """
    Return a new version of an EDN line with the volume updated.
    Uses plain string replacement — no regex ambiguity.
    """
    if remove:
        # Strip :volume N or :adjustVolume N from the line
        line = re.sub(r'\s*:volume\s+\d+', '', line)
        line = re.sub(r'\s*:adjustVolume\s+-?\d+', '', line)
        return line

    if old_vol is not None and new_vol is not None:
        return line.replace(f":volume {old_vol}", f":volume {new_vol}", 1)

    if old_adj is not None and new_adj is not None:
        return line.replace(f":adjustVolume {old_adj}", f":adjustVolume {new_adj}", 1)

    if old_vol is None and old_adj is None and new_vol is not None:
        # Insert :volume N before the closing } of the cue
        return re.sub(r'\}(\s*(?:;;.*)?)$', f' :volume {new_vol}}}\\1', line, count=1)

    return line  # no actionable change


def write_changes(edn_file: str, items: list[MediaItem]) -> int:
    """
    Apply volume changes back to the EDN file in-place.
    Creates a .bak backup first.
    Returns the count of lines modified.
    """
    changed = [i for i in items if i.changed and not i.skipped]
    if not changed:
        return 0

    # Read all lines
    with open(edn_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Apply each change by line number (1-based)
    modified = 0
    for item in changed:
        idx = item.line_num - 1  # 0-based
        if idx < 0 or idx >= len(lines):
            print(f"  ✗ Line {item.line_num} out of range — skipping :{item.cue_name}")
            continue

        new_line = _replace_volume_on_line(
            lines[idx],
            item.volume, item.adjust_volume,
            item.new_volume, item.new_adjust_volume,
            item.remove_volume,
        )

        if new_line != lines[idx]:
            lines[idx] = new_line
            modified += 1
        else:
            print(f"  ✗ No change applied at line {item.line_num} for :{item.cue_name}"
                  " — pattern mismatch, skipping.")

    if modified:
        # Backup original
        backup = edn_file + ".bak"
        shutil.copy2(edn_file, backup)
        print(f"\n  Backup written → {backup}")

        with open(edn_file, 'w', encoding='utf-8') as f:
            f.writelines(lines)

    return modified


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def print_summary(items: list[MediaItem], write_mode: bool) -> None:
    print(f"\n{'═' * 72}")
    print("  SUMMARY")
    print(f"{'═' * 72}")

    col_cue  = max((len(i.cue_name) for i in items), default=10)
    col_file = max((len(os.path.basename(i.file_path)) for i in items), default=14)
    col_cue  = max(col_cue,  8)
    col_file = max(col_file, 14)

    hdr = (f"  {'Cue':<{col_cue}}  {'File':<{col_file}}  "
           f"{'Old Vol':<12}  {'New Vol':<12}  Status")
    print(hdr)
    print(f"  {'-'*col_cue}  {'-'*col_file}  {'-'*12}  {'-'*12}  {'-'*8}")

    for item in items:
        old_v = item.vol_display()
        if item.skipped:
            status  = "skipped"
            new_v   = "—"
        elif item.changed:
            status  = "✓ written" if write_mode else "✓ changed (not saved)"
            new_v   = item.new_vol_display()
        else:
            status  = "unchanged"
            new_v   = "—"

        fname = os.path.basename(item.file_path)
        print(f"  {item.cue_name:<{col_cue}}  {fname:<{col_file}}  "
              f"{old_v:<12}  {new_v:<12}  {status}")

    changed_count = sum(1 for i in items if i.changed and not i.skipped)
    print(f"\n  {changed_count} change(s)  |  "
          f"{sum(1 for i in items if i.skipped)} skipped  |  "
          f"{len(items)} total items scanned")
    print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(
        description="Interactive audio/video volume tuner for PxO EDN game configs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("edn_file", metavar="EDN_FILE",
                   help="Path to the PxO EDN game config file")
    p.add_argument("-b", "--broker", default="127.0.0.1",
                   help="MQTT broker host (default: 127.0.0.1)")
    p.add_argument("-p", "--port", type=int, default=1883,
                   help="MQTT broker port (default: 1883)")
    p.add_argument("-n", "--no-write", action="store_true",
                   help="Do not write changes back to the EDN file (review / dry-run only)")
    p.add_argument("-w", "--write", action="store_true",
                   help="Write changes without prompting (for scripted / automated use)")
    p.add_argument("-t", "--topic",
                   help="Override MQTT base topic for zone (e.g. paradox/agent22/tv)")
    p.add_argument("--dry-run", action="store_true",
                   help="Show what would be sent without publishing MQTT messages")
    return p.parse_args()


def check_prerequisites():
    if shutil.which("mosquitto_pub") is None:
        print("ERROR: mosquitto_pub not found in PATH.", file=sys.stderr)
        print("Install mosquitto-clients:  sudo apt install mosquitto-clients",
              file=sys.stderr)
        sys.exit(1)


def main():
    args = parse_args()

    if not args.dry_run:
        check_prerequisites()

    edn_file = os.path.abspath(args.edn_file)
    if not os.path.isfile(edn_file):
        print(f"ERROR: File not found: {edn_file}", file=sys.stderr)
        sys.exit(1)

    with open(edn_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    print(f"\nScanning: {edn_file}")

    media_refs  = parse_media_refs(lines)
    zone_topics = parse_zone_topics(lines)
    items       = parse_audio_video_commands(lines, media_refs, zone_topics, args.topic)

    if not items:
        print("No audio/video play commands found.")
        sys.exit(0)

    print(f"Resolved {len(media_refs)} media reference(s), "
          f"{len(zone_topics)} zone topic(s).")

    if args.dry_run:
        print("\n[DRY RUN — no MQTT messages will be sent]\n")
        for item in items:
            payload = build_play_payload(item, item.volume, item.adjust_volume)
            print(f"  line {item.line_num:4d}  :{item.cue_name:<30}  "
                  f"{item.topic}  {json.dumps(payload)}")
        sys.exit(0)

    try:
        run_interactive(items, args.broker, args.port)
    except KeyboardInterrupt:
        print("\n\n  Interrupted — no changes written.")
        print_summary(items, write_mode=False)
        sys.exit(0)

    # Write-back
    written = 0
    changed_count = sum(1 for i in items if i.changed and not i.skipped)

    do_write = False
    if args.write:
        do_write = True
    elif args.no_write:
        do_write = False
    elif changed_count:
        print(f"\n  {changed_count} change(s) made.")
        answer = ask_line(f"  Save changes to {os.path.basename(edn_file)}? [Y/n] ").strip().lower()
        do_write = answer in ('', 'y', 'yes')

    if do_write:
        written = write_changes(edn_file, items)
        if written:
            print(f"  {written} line(s) updated in {edn_file}")
        else:
            print("  No lines needed updating (pattern mismatch — check output above).")
    elif changed_count and not args.no_write and not args.write:
        print("  Changes not saved.  Re-run with --write to save without the prompt.")

    print_summary(items, write_mode=do_write and written > 0)


if __name__ == "__main__":
    main()
