const PxcAdapter = require('../src/adapters/pxc');

describe('PxcAdapter clock commands', () => {
  let mqtt;

  beforeEach(() => {
    mqtt = {
      publish: jest.fn(),
    };
  });

  test('advertises canonical clock capabilities', () => {
    const adapter = new PxcAdapter(mqtt, { clock: { baseTopic: 'paradox/test/clock' } });
    const capabilities = adapter.getCapabilities();

    expect(capabilities.includes('show')).toBe(true);
    expect(capabilities.includes('hide')).toBe(true);
    expect(capabilities.includes('fadeIn')).toBe(true);
    expect(capabilities.includes('fadeOut')).toBe(true);
    expect(capabilities.includes('setTime')).toBe(true);
    expect(capabilities.includes('fade-in')).toBe(false);
    expect(capabilities.includes('set-time')).toBe(false);
  });

  test('show and hide publish only canonical commands', async () => {
    const adapter = new PxcAdapter(
      mqtt,
      { clock: { baseTopic: 'paradox/test/clock' } },
      { gameTopic: 'paradox/test/game', mirrorUI: true }
    );

    await adapter.execute('show');
    await adapter.execute('hide');

    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'show' });
    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'hide' });
    expect(mqtt.publish).toHaveBeenCalledTimes(2);
  });

  test('does not publish legacy action payloads for timer and hint commands', async () => {
    const adapter = new PxcAdapter(
      mqtt,
      { clock: { baseTopic: 'paradox/test/clock' } },
      { gameTopic: 'paradox/test', mirrorUI: true }
    );

    await adapter.execute('show');
    await adapter.execute('start', { time: '01:00' });
    await adapter.execute('hint', { text: 'Warning', duration: 15 });

    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'show' });
    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'start', time: '01:00' });
    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { hint: 'Warning', duration: 15 });
    expect(mqtt.publish).not.toHaveBeenCalledWith('paradox/test/clock', { action: 'show' });
    expect(mqtt.publish).not.toHaveBeenCalledWith('paradox/test/game/clock', { action: 'show' });
    expect(mqtt.publish).not.toHaveBeenCalledWith('paradox/test/clock', { action: 'start', time: '01:00' });
    expect(mqtt.publish).not.toHaveBeenCalledWith('paradox/test/game/clock', { action: 'start', time: '01:00' });
    expect(mqtt.publish).not.toHaveBeenCalledWith('paradox/test/clock', { action: 'hint', text: 'Warning', duration: 15 });
    expect(mqtt.publish).not.toHaveBeenCalledWith('paradox/test/game/clock', { action: 'hint', text: 'Warning', duration: 15 });
  });

  test('fade commands preserve explicit zero duration and accept legacy fadeTime', async () => {
    const adapter = new PxcAdapter(mqtt, { clock: { baseTopic: 'paradox/test/clock' } });

    adapter.fadeIn(0);
    await adapter.execute('fade-in', { fadeTime: 3 });
    await adapter.execute('fadeOut', { duration: 2 });

    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'fadeIn', duration: 0 });
    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'fadeIn', duration: 3 });
    expect(mqtt.publish).toHaveBeenCalledWith('paradox/test/clock/commands', { command: 'fadeOut', duration: 2 });
  });
});