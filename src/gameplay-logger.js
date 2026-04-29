const fs = require('fs');
const path = require('path');

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatWallTime(tsMs) {
    const d = new Date(tsMs);
    const hh = pad2(d.getHours());
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const hund = pad2(Math.floor(d.getMilliseconds() / 10));
    return `${hh}:${mm}:${ss}.${hund}`;
}

function formatFileTimestamp(tsMs) {
    const d = new Date(tsMs);
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function formatRemaining(remainingMs) {
    const safeMs = Math.max(0, Number.isFinite(remainingMs) ? remainingMs : 0);
    const totalHund = Math.floor(safeMs / 10);
    const minutes = Math.floor(totalHund / 6000);
    const seconds = Math.floor((totalHund % 6000) / 100);
    const hund = totalHund % 100;
    return `${pad2(minutes)}:${pad2(seconds)}.${pad2(hund)}`;
}

function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
}

class GameplayLogger {
    constructor({
        logDir,
        ednBase,
        getClockState,
        getCurrentMode,
        logger
    }) {
        this.logDir = logDir;
        this.ednBase = ednBase || 'game';
        this.getClockState = getClockState;
        this.getCurrentMode = getCurrentMode;
        this.log = logger || console;

        this.pending = null;
        this.session = null;
        this.lastAcceptedStartMs = 0;
        this.lastMode = null;
        this.lastEdnIdentity = this.ednBase;
    }

    static isTruthy(value) {
        return toBoolean(value);
    }

    canAcceptStart(tsMs = Date.now()) {
        if (!this.lastAcceptedStartMs) return true;
        return (tsMs - this.lastAcceptedStartMs) >= 2000;
    }

    beginPendingRun({ startCommand, mode, gameplayDurationSec, topic, tsMs = Date.now() }) {
        this.lastAcceptedStartMs = tsMs;
        this.pending = {
            startTsMs: tsMs,
            gameplayDurationMs: Math.max(0, Math.round((Number(gameplayDurationSec) || 0) * 1000)),
            mode: mode || null,
            startCommand: startCommand || 'start',
            topic: topic || null,
            buffer: []
        };
        this.lastMode = this.pending.mode || this.lastMode;

        this._append('command_received', {
            command: this.pending.startCommand,
            topic: this.pending.topic,
            accepted: true,
            source: 'mqtt'
        }, tsMs, { forcePending: true });

        this._append('command_applied', {
            command: this.pending.startCommand,
            accepted: true,
            source: 'state_machine'
        }, tsMs, { forcePending: true });
    }

    discardPending(reason = 'discarded') {
        if (!this.pending) return;
        this.log.info(`[GAMEPLAY-LOG] Discarding pending run before gameplay start (${reason})`);
        this.pending = null;
    }

    commitPendingRun({ mode, reason = 'gameplay_started' } = {}) {
        if (!this.pending || this.session) return false;

        const startTsMs = this.pending.startTsMs;
        const fileTimestamp = formatFileTimestamp(startTsMs);
        const fileName = `${this.ednBase}_${fileTimestamp}.jsonl`;
        const filePath = path.join(this.logDir, fileName);
        fs.writeFileSync(filePath, '', { flag: 'a' });

        this.session = {
            filePath,
            startedAtMs: startTsMs,
            gameplayDurationMs: this.pending.gameplayDurationMs,
            mode: mode || this.pending.mode || this.getCurrentMode?.() || null
        };

        const headerMode = this.session.mode || null;
        this._writeLine({
            event_type: 'session_header',
            wall_time: formatWallTime(startTsMs),
            game_time_remaining: formatRemaining(this.pending.gameplayDurationMs),
            payload: {
                reason,
                edn_base: this.ednBase,
                mode: headerMode,
                file_name: path.basename(filePath),
                start_command: this.pending.startCommand
            }
        });

        this._writeLine({
            event_type: 'session_config',
            wall_time: formatWallTime(startTsMs),
            game_time_remaining: formatRemaining(this.pending.gameplayDurationMs),
            payload: {
                schema_version: 1,
                timing_reference: 'game_time_remaining',
                game_time_format: 'MM:SS.hh',
                wall_time_format: 'HH:MM:SS.hh'
            }
        });

        this.lastMode = headerMode;
        this.lastEdnIdentity = this.ednBase;

        for (const entry of this.pending.buffer) {
            this._writeLine(entry);
        }

        this.pending = null;
        this.log.info(`[GAMEPLAY-LOG] Started gameplay session log: ${filePath}`);
        return true;
    }

    endSession(payload = {}) {
        if (!this.session) return;

        this._append('session_summary', payload, Date.now(), { forceActive: true });
        this.log.info(`[GAMEPLAY-LOG] Closed gameplay session log: ${this.session.filePath}`);
        this.session = null;
    }

    noteModeChange(mode) {
        if (!mode || mode === this.lastMode) return;
        this.lastMode = mode;
        this._append('mode_changed', { mode }, Date.now());
    }

    noteEdnIdentityChange(ednBase) {
        if (!ednBase || ednBase === this.lastEdnIdentity) return;
        this.lastEdnIdentity = ednBase;
        this._append('edn_identity_changed', { edn_base: ednBase }, Date.now());
    }

    commandReceived(command, payload, topic, extra = {}) {
        this._append('command_received', {
            command,
            topic,
            payload,
            ...extra
        }, Date.now());
    }

    commandRejected(command, reason, payload, topic, extra = {}) {
        this._append('command_rejected', {
            command,
            reason,
            topic,
            payload,
            ...extra
        }, Date.now(), { allowDuringPendingStartGap: true });
    }

    commandApplied(command, payload, topic, extra = {}) {
        this._append('command_applied', {
            command,
            topic,
            payload,
            ...extra
        }, Date.now());
    }

    event(eventType, payload = {}, tsMs = Date.now()) {
        this._append(eventType, payload, tsMs);
    }

    chat(direction, topic, payload) {
        this._append(direction, {
            topic,
            message: payload
        }, Date.now());
    }

    sensorChanged(payload) {
        this._append('sensor_changed', payload, Date.now());
    }

    _append(eventType, payload, tsMs = Date.now(), options = {}) {
        const record = {
            event_type: eventType,
            wall_time: formatWallTime(tsMs),
            game_time_remaining: formatRemaining(this._getRemainingMs()),
            payload: payload || {}
        };

        if (this.session) {
            this._writeLine(record);
            return;
        }

        if (this.pending) {
            this.pending.buffer.push(record);
            return;
        }

        if (options.forcePending) {
            // If requested to force pending but no pending exists, do nothing.
            return;
        }

        // no active run
    }

    _getRemainingMs() {
        if (this.session && this.getClockState) {
            const clock = this.getClockState() || {};
            if (Number.isFinite(clock.remainingMs)) {
                return Math.max(0, clock.remainingMs);
            }
            if (Number.isFinite(clock.remainingSeconds)) {
                return Math.max(0, Math.round(clock.remainingSeconds * 1000));
            }
        }

        if (this.pending) {
            return this.pending.gameplayDurationMs;
        }

        return 0;
    }

    _writeLine(record) {
        if (!this.session || !this.session.filePath) return;
        fs.appendFileSync(this.session.filePath, `${JSON.stringify(record)}\n`);
    }
}

module.exports = {
    GameplayLogger,
    formatWallTime,
    formatRemaining,
    formatFileTimestamp
};
