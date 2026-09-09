'use strict';

const { EventEmitter } = require('events');
const { HelperSupervisor, normalizeHelperDefs, expandHelperEnv } = require('../src/helpers/helperSupervisor');

function mockChild({ exitAfterMs = null, exitCode = 0 } = {}) {
  const ee = new EventEmitter();
  ee.pid = Math.floor(Math.random() * 10000) + 1000;
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.killed = false;
  ee.kill = jest.fn((sig) => {
    ee.killed = true;
    setImmediate(() => ee.emit('exit', sig === 'SIGKILL' ? null : 0, sig));
  });
  if (exitAfterMs != null) {
    setTimeout(() => ee.emit('exit', exitCode, null), exitAfterMs);
  }
  return ee;
}

describe('normalizeHelperDefs', () => {
  test('normalizes kebab and camel fields', () => {
    const defs = normalizeHelperDefs([
      {
        id: ':simon',
        cmd: ['node', 'simon.js'],
        'active-phases': [':gameplay'],
        'restart-on-crash': true,
        'stop-grace-ms': 1500,
        topic: 'paradox/tfd/elevator/helpers/simon',
        'ready-event': 'ready',
      },
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe('simon');
    expect(defs[0].activePhases).toEqual(['gameplay']);
    expect(defs[0].stopGraceMs).toBe(1500);
    expect(defs[0].readyEvent).toBe('ready');
  });

  test('skips incomplete entries and duplicates', () => {
    const defs = normalizeHelperDefs([
      { id: 'a', cmd: ['true'] },
      { id: 'a', cmd: ['true'] },
      { id: 'b' },
      { cmd: ['true'] },
    ]);
    expect(defs.map((d) => d.id)).toEqual(['a']);
  });
});

describe('HelperSupervisor', () => {
  test('starts on gameplay and stops on reset', async () => {
    const spawned = [];
    const spawnImpl = jest.fn((bin, args) => {
      const child = mockChild();
      spawned.push({ bin, args, child });
      return child;
    });

    const warnings = [];
    const sup = new HelperSupervisor({
      definitions: [{
        id: 'simon',
        cmd: ['node', 'simon.js'],
        'active-phases': ['gameplay', 'paused'],
        'stop-grace-ms': 20,
      }],
      spawnImpl,
      publishWarning: (code, d) => warnings.push({ code, d }),
      logger: { info() {}, warn() {}, error() {} },
    });

    expect(sup.isRunning('simon')).toBe(false);
    sup.syncForPhase('gameplay');
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(sup.isRunning('simon')).toBe(true);

    await sup.stopAll({ reason: 'reset' });
    expect(spawned[0].child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(sup.isRunning('simon')).toBe(false);
  });

  test('does not start helpers outside active phases', () => {
    const spawnImpl = jest.fn(() => mockChild());
    const sup = new HelperSupervisor({
      definitions: [{ id: 'simon', cmd: ['node', 'x'], 'active-phases': ['gameplay'] }],
      spawnImpl,
      logger: { info() {}, warn() {} },
    });
    sup.syncForPhase('intro');
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(sup.isRunning('simon')).toBe(false);
  });

  test('restarts on crash with backoff until max', () => {
    jest.useFakeTimers();
    const children = [];
    const spawnImpl = jest.fn(() => {
      const child = mockChild();
      children.push(child);
      return child;
    });

    const warnings = [];
    const sup = new HelperSupervisor({
      definitions: [{
        id: 'simon',
        cmd: ['node', 'x'],
        'active-phases': ['gameplay'],
        'restart-on-crash': true,
        'max-restarts': 2,
        'restart-backoff-ms': 100,
      }],
      spawnImpl,
      publishWarning: (code, d) => warnings.push({ code, ...d }),
      logger: { info() {}, warn() {} },
    });

    expect(sup.listDefinitions()[0].maxRestarts).toBe(2);

    sup.syncForPhase('gameplay');
    expect(children).toHaveLength(1);

    children[0].emit('exit', 1, null);
    jest.runOnlyPendingTimers();
    expect(children).toHaveLength(2);

    children[1].emit('exit', 1, null);
    jest.runOnlyPendingTimers();
    expect(children).toHaveLength(3);

    children[2].emit('exit', 1, null);
    jest.runOnlyPendingTimers();
    expect(children).toHaveLength(3);
    expect(warnings.map((w) => w.code)).toContain('helper_crash_loop');

    jest.useRealTimers();
  });

  test('marks ready from MQTT ready-event', () => {
    const mqtt = new EventEmitter();
    mqtt.subscribe = jest.fn();
    const child = mockChild();
    const spawnImpl = jest.fn(() => child);

    const sup = new HelperSupervisor({
      definitions: [{
        id: 'simon',
        cmd: ['node', 'x'],
        topic: 'paradox/tfd/elevator/helpers/simon',
        'ready-event': 'ready',
        'active-phases': ['gameplay'],
      }],
      mqtt,
      spawnImpl,
      logger: { info() {}, warn() {} },
    });

    sup.syncForPhase('gameplay');
    expect(mqtt.subscribe).toHaveBeenCalledWith('paradox/tfd/elevator/helpers/simon/events');
    expect(sup.isReady('simon')).toBe(false);

    mqtt.emit('message', 'paradox/tfd/elevator/helpers/simon/events', Buffer.from(JSON.stringify({ event: 'ready' })));
    expect(sup.isReady('simon')).toBe(true);
  });

  test('expands {{setting-key}} from :global :settings into helper env', () => {
    expect(expandHelperEnv(
      { SIMON_ENTRY_WINDOW_S: '{{simon-entry-window-s}}', LITERAL: 'x' },
      { 'simon-entry-window-s': 10 }
    )).toEqual({ SIMON_ENTRY_WINDOW_S: '10', LITERAL: 'x' });

    const spawnImpl = jest.fn(() => mockChild());
    const sup = new HelperSupervisor({
      definitions: [{
        id: 'simon',
        cmd: ['node', 'x'],
        env: { SIMON_ROUNDS: '{{simon-rounds}}' },
        'active-phases': ['gameplay'],
      }],
      settings: { 'simon-rounds': 3 },
      spawnImpl,
      logger: { info() {}, warn() {} },
    });
    sup.syncForPhase('gameplay');
    const env = spawnImpl.mock.calls[0][2].env;
    expect(env.SIMON_ROUNDS).toBe('3');
    expect(env.PXO_HELPER_ID).toBe('simon');
  });
});
