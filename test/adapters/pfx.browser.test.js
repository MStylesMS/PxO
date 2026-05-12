/**
 * pfx.browser.test.js
 *
 * Verifies that the pfx adapter speaks the PFxE-canonical browser vocabulary:
 *   - showBrowser / hideBrowser / moveBrowser are forwarded as MQTT commands
 *   - enableBrowser, disableBrowser, verifyBrowser are NOT in capabilities
 *     and NOT dispatched (regression guard for pfx-pfxe-sync cleanup)
 */
const PfxAdapter = require('../../src/adapters/pfx');

function makeMockMqtt() {
  const pub = [];
  return {
    published: pub,
    publish(topic, message) { pub.push({ topic, message }); },
    subscribe() {},
    on() {},
    removeListener() {},
  };
}

describe('PfxAdapter browser command vocabulary', () => {
  let mqtt;
  let pfx;

  beforeEach(() => {
    mqtt = makeMockMqtt();
    pfx = new PfxAdapter(mqtt, { baseTopic: 'paradox/test/mirror' });
  });

  describe('retained commands', () => {
    test('showBrowser publishes {command:"showBrowser"} to the command topic', () => {
      pfx.showBrowser();
      expect(mqtt.published).toHaveLength(1);
      expect(mqtt.published[0].topic).toBe('paradox/test/mirror/commands');
      expect(mqtt.published[0].message).toEqual({ command: 'showBrowser' });
    });

    test('hideBrowser publishes {command:"hideBrowser"} to the command topic', () => {
      pfx.hideBrowser();
      expect(mqtt.published).toHaveLength(1);
      expect(mqtt.published[0].message).toEqual({ command: 'hideBrowser' });
    });

    test('moveBrowser forwards geometry options to the command topic', () => {
      pfx.moveBrowser({ x: 0, y: 0, width: 1920, height: 1080 });
      expect(mqtt.published).toHaveLength(1);
      expect(mqtt.published[0].message).toMatchObject({ command: 'moveBrowser', x: 0, y: 0, width: 1920, height: 1080 });
    });

    test('execute("showBrowser") dispatches correctly', () => {
      pfx.execute('showBrowser');
      expect(mqtt.published).toHaveLength(1);
      expect(mqtt.published[0].message).toEqual({ command: 'showBrowser' });
    });

    test('execute("hideBrowser") dispatches correctly', () => {
      pfx.execute('hideBrowser');
      expect(mqtt.published).toHaveLength(1);
      expect(mqtt.published[0].message).toEqual({ command: 'hideBrowser' });
    });

    test('execute("moveBrowser") dispatches with options', () => {
      pfx.execute('moveBrowser', { x: 100, y: 200, width: 800, height: 600 });
      expect(mqtt.published).toHaveLength(1);
      expect(mqtt.published[0].message).toMatchObject({ command: 'moveBrowser' });
    });
  });

  describe('removed commands (regression guard)', () => {
    test('getCapabilities() does not include enableBrowser', () => {
      expect(pfx.getCapabilities()).not.toContain('enableBrowser');
    });

    test('getCapabilities() does not include disableBrowser', () => {
      expect(pfx.getCapabilities()).not.toContain('disableBrowser');
    });

    test('getCapabilities() does not include verifyBrowser', () => {
      expect(pfx.getCapabilities()).not.toContain('verifyBrowser');
    });

    test('getCapabilities() includes showBrowser, hideBrowser, moveBrowser', () => {
      const caps = pfx.getCapabilities();
      expect(caps).toContain('showBrowser');
      expect(caps).toContain('hideBrowser');
      expect(caps).toContain('moveBrowser');
    });

    test('execute("enableBrowser") logs a warning and publishes nothing', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      pfx.execute('enableBrowser', { url: 'http://localhost/' });
      expect(mqtt.published).toHaveLength(0);
      warnSpy.mockRestore();
    });

    test('execute("disableBrowser") logs a warning and publishes nothing', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      pfx.execute('disableBrowser');
      expect(mqtt.published).toHaveLength(0);
      warnSpy.mockRestore();
    });

    test('execute("verifyBrowser") logs a warning and publishes nothing', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      pfx.execute('verifyBrowser', { url: 'http://localhost/', visible: true });
      expect(mqtt.published).toHaveLength(0);
      warnSpy.mockRestore();
    });

    test('adapter source does not reference enableBrowser command string', () => {
      // Regression guard: read the adapter source and confirm the removed
      // MQTT command strings are not emitted anywhere.
      const fs = require('fs');
      const path = require('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../src/adapters/pfx.js'),
        'utf8'
      );
      // Should not appear as a command value (allow it in comments/strings that explain the contract)
      expect(src).not.toMatch(/command:\s*['"]enableBrowser['"]/);
      expect(src).not.toMatch(/command:\s*['"]disableBrowser['"]/);
      expect(src).not.toMatch(/command:\s*['"]verifyBrowser['"]/);
    });
  });
});
