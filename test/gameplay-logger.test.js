const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    GameplayLogger,
    formatRemaining,
    formatElapsedSec,
    formatFileTimestamp
} = require('../src/gameplay-logger');

describe('GameplayLogger', () => {
    test('formats game time remaining as MM:SS.hh', () => {
        expect(formatRemaining(3600000)).toBe('60:00.00');
        expect(formatRemaining(90540)).toBe('01:30.54');
    });

    test('formatElapsedSec rounds to one decimal', () => {
        const start = 1_000_000;
        expect(formatElapsedSec(start, start)).toBe(0);
        expect(formatElapsedSec(start, start + 12400)).toBe(12.4);
        expect(formatElapsedSec(start, start + 5000)).toBe(5);
    });

    test('buffers pending events and writes on gameplay commit', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxo-gameplay-'));
        const fixedStart = new Date('2026-04-19T13:22:33.450Z').getTime();

        const logger = new GameplayLogger({
            logDir: tmpDir,
            ednBase: 'houdini',
            gameName: "Houdini's Challenge",
            getClockState: () => ({ remainingMs: 3600000 }),
            getCurrentMode: () => '60min',
            logger: { info: () => { } }
        });

        logger.beginPendingRun({
            startCommand: 'start',
            mode: '60min',
            gameplayDurationSec: 3600,
            topic: 'paradox/houdini/commands',
            tsMs: fixedStart
        });

        logger.event('phase_transition', { from: 'intro', to: 'gameplay' }, fixedStart + 5000);
        logger.commitPendingRun({ mode: '60min' });
        logger.endSession({ reason: 'test_complete' });

        const files = fs.readdirSync(tmpDir).filter((name) => name.endsWith('.jsonl'));
        expect(files.length).toBe(1);
        // Stem pairs with PxS `{edn}_{yyyy-mm-dd_HH-mm-ss}.speech.jsonl`
        const expectedStem = `houdini_${formatFileTimestamp(fixedStart)}`;
        expect(files[0]).toBe(`${expectedStem}.jsonl`);

        const lines = fs
            .readFileSync(path.join(tmpDir, files[0]), 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));

        expect(lines.length > 0).toBeTruthy();
        expect(lines[0].event_type).toBe('session_header');
        expect(lines[0].game_time_remaining).toBe('60:00.00');
        expect(lines[0].t_sec).toBe(0);
        expect(lines[0].payload.game_name).toBe("Houdini's Challenge");
        expect(lines[0].payload.edn_base).toBe('houdini');
        expect(lines[0].payload.mode).toBe('60min');
        expect(lines[0].payload.gameplay_started_at).toBe(new Date(fixedStart).toISOString());
        // Internal buffer timestamp must not leak to disk
        expect(lines[0]._tsMs).toBeUndefined();

        const phase = lines.find((line) => line.event_type === 'phase_transition');
        expect(phase).toBeTruthy();
        expect(phase.t_sec).toBe(5);
        expect(phase._tsMs).toBeUndefined();

        const summary = lines.find((line) => line.event_type === 'session_summary');
        expect(summary).toBeTruthy();
        expect(typeof summary.t_sec).toBe('number');

        const hasStartApplied = lines.some((line) => line.event_type === 'command_applied' && line.payload.command === 'start');
        expect(hasStartApplied).toBe(true);
    });

    test('enforces two-second start lockout', () => {
        const logger = new GameplayLogger({
            logDir: '/tmp',
            ednBase: 'houdini',
            getClockState: () => ({ remainingMs: 0 }),
            getCurrentMode: () => 'demo',
            logger: { info: () => { } }
        });

        const startTs = 10000;
        logger.beginPendingRun({ startCommand: 'start', mode: 'demo', gameplayDurationSec: 300, tsMs: startTs });

        expect(logger.canAcceptStart(startTs + 1500)).toBe(false);
        expect(logger.canAcceptStart(startTs + 2100)).toBe(true);
    });
});
