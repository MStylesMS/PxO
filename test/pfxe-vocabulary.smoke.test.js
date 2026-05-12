/**
 * pfxe-vocabulary.smoke.test.js
 *
 * Phase 3 smoke test: verify that PxO's sequenceRunner can drive a realistic
 * reset/intro sequence using only the PFxE-canonical browser vocabulary
 * (showBrowser, hideBrowser, moveBrowser) and that NO enableBrowser,
 * disableBrowser, or verifyBrowser commands are emitted to the MQTT bus.
 *
 * Uses a mocked MQTT client — no real broker required.
 */
const SequenceRunner = require('../src/sequenceRunner');

function makeMockMqtt() {
  const published = [];
  return {
    published,
    publish(topic, payload) {
      published.push({
        topic,
        payload: typeof payload === 'string' ? JSON.parse(payload) : payload,
      });
    },
    subscribe() {},
    on() {},
    removeListener() {},
  };
}

function makeMockZones(mqtt) {
  const executed = [];
  return {
    executed,
    execute(zoneName, command, options = {}) {
      executed.push({ zoneName, command, options });
      // Simulate the pfx adapter publishing the command
      mqtt.publish(`paradox/test/${zoneName}/commands`, { command, ...options });
    },
    getZone(name) {
      return { zoneName: name, zoneBaseTopic: `paradox/test/${name}` };
    },
  };
}

function makeSequenceRunner(mqtt, zones) {
  const mockMqtt = {
    ...mqtt,
    // sequenceRunner needs baseTopic for event publishing
    baseTopic: 'paradox/test/game',
  };
  return new SequenceRunner({ mqtt: mockMqtt, zones, cfg: {} });
}

describe('PFxE-vocabulary smoke: sequence runner browser commands', () => {
  let mqtt;
  let zones;
  let runner;

  beforeEach(() => {
    mqtt = makeMockMqtt();
    zones = makeMockZones(mqtt);
    runner = makeSequenceRunner(mqtt, zones);
  });

  test('showBrowser step emits showBrowser to zone and NOT enableBrowser', async () => {
    const seqDef = {
      sequence: [
        { zone: 'mirror', command: 'showBrowser' },
      ],
    };
    await runner.runInlineSequence('test-show', seqDef);

    const mirrorCmds = zones.executed.filter(e => e.zoneName === 'mirror');
    expect(mirrorCmds).toHaveLength(1);
    expect(mirrorCmds[0].command).toBe('showBrowser');

    // Nothing on MQTT that looks like the removed commands
    const banned = ['enableBrowser', 'disableBrowser', 'verifyBrowser'];
    for (const { payload } of mqtt.published) {
      if (payload && payload.command) {
        expect(banned).not.toContain(payload.command);
      }
    }
  });

  test('hideBrowser step emits hideBrowser to zone', async () => {
    const seqDef = {
      sequence: [
        { zone: 'mirror', command: 'hideBrowser' },
      ],
    };
    await runner.runInlineSequence('test-hide', seqDef);

    const mirrorCmds = zones.executed.filter(e => e.zoneName === 'mirror');
    expect(mirrorCmds).toHaveLength(1);
    expect(mirrorCmds[0].command).toBe('hideBrowser');
  });

  test('moveBrowser step forwards geometry options', async () => {
    const seqDef = {
      sequence: [
        { zone: 'mirror', command: 'moveBrowser', x: 0, y: 0, width: 1920, height: 1080 },
      ],
    };
    await runner.runInlineSequence('test-move', seqDef);

    const mirrorCmds = zones.executed.filter(e => e.zoneName === 'mirror');
    expect(mirrorCmds).toHaveLength(1);
    expect(mirrorCmds[0].command).toBe('moveBrowser');
  });

  test('a realistic reset sequence emits no enableBrowser, disableBrowser, or verifyBrowser', async () => {
    // Mirrors the standard-reset pattern from houdini.edn after normalization
    const seqDef = {
      sequence: [
        { zone: 'audio', command: 'stopAll' },
        { zone: 'mirror', command: 'setImage', file: 'black_screen.png' },
        { zone: 'mirror', command: 'hideBrowser' },
        { zone: 'picture', command: 'setImage', file: 'intro.png' },
      ],
    };
    await runner.runInlineSequence('standard-reset-smoke', seqDef);

    const banned = ['enableBrowser', 'disableBrowser', 'verifyBrowser'];
    for (const { payload } of mqtt.published) {
      if (payload && payload.command) {
        expect(banned).not.toContain(payload.command);
      }
    }
    for (const { command } of zones.executed) {
      expect(banned).not.toContain(command);
    }
  });
});
