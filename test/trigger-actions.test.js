const { executeTriggerAction, normalizeTriggerEndCommand } = require('../src/game');

describe('trigger action executor', () => {
  let sm;
  let logger;

  beforeEach(() => {
    sm = {
      _buildFireContext: jest.fn((action) => ({ text: action.text })),
      fireByName: jest.fn(),
      handleCommand: jest.fn(),
      executeCueAction: jest.fn()
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn()
    };
  });

  test('fires named targets through state-machine fireByName', async () => {
    await executeTriggerAction({ fire: 'unlock-door', text: 'now' }, 'spell-box-opened', { sm, log: logger });

    expect(sm._buildFireContext).toHaveBeenCalledWith({ fire: 'unlock-door', text: 'now' });
    expect(sm.fireByName).toHaveBeenCalledWith('unlock-door', { text: 'now' });
  });

  test('maps end aliases to solve and fail commands', async () => {
    await executeTriggerAction({ end: 'win' }, 'spell-box-opened', { sm, log: logger });
    await executeTriggerAction({ end: 'failed' }, 'spell-box-closed', { sm, log: logger });

    expect(sm.handleCommand).toHaveBeenNthCalledWith(1, { command: 'solve' });
    expect(sm.handleCommand).toHaveBeenNthCalledWith(2, { command: 'fail' });
  });

  test('routes zone commands and raw publish actions through executeCueAction', async () => {
    await executeTriggerAction({ zone: 'mirror', command: 'setImage', file: 'spell.png' }, 'image-trigger', { sm, log: logger });
    await executeTriggerAction({ command: 'publish', topic: 'paradox/test', payload: { ok: true } }, 'publish-trigger', { sm, log: logger });

    expect(sm.executeCueAction).toHaveBeenNthCalledWith(1, { zone: 'mirror', command: 'setImage', file: 'spell.png' }, 'trigger:image-trigger');
    expect(sm.executeCueAction).toHaveBeenNthCalledWith(2, { command: 'publish', topic: 'paradox/test', payload: { ok: true } }, 'trigger:publish-trigger');
  });

  test('rejects deprecated mqtt raw-publish alias', async () => {
    const result = await executeTriggerAction({ command: 'mqtt', topic: 'paradox/test', payload: { ok: true } }, 'deprecated-trigger', { sm, log: logger });

    expect(result).toBe(false);
    expect(sm.executeCueAction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Unsupported trigger action'));
  });

  test('rejects unsupported trigger action shapes', async () => {
    const result = await executeTriggerAction({ schedule: 'not-allowed' }, 'bad-trigger', { sm, log: logger });

    expect(result).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Unsupported trigger action'));
  });
});

describe('normalizeTriggerEndCommand', () => {
  test('normalizes win/fail aliases', () => {
    expect(normalizeTriggerEndCommand('win')).toBe('solve');
    expect(normalizeTriggerEndCommand('solved')).toBe('solve');
    expect(normalizeTriggerEndCommand('sovled')).toBe('solve');
    expect(normalizeTriggerEndCommand('fail')).toBe('fail');
    expect(normalizeTriggerEndCommand('failed')).toBe('fail');
    expect(normalizeTriggerEndCommand('unknown')).toBeNull();
  });
});