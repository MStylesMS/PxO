const ModularConfigAdapter = require('../src/modular-config-adapter');
const {
  normalizeTriggerStrictMode,
  buildInputSourceMap,
  buildTriggerRules,
  getRulePhaseConstraint,
  doesTriggerConditionMatch,
  normalizeEventToken,
  getValueByPath
} = require('../src/game');

describe('trigger source routing helpers', () => {
  test('normalizes strict mode values', () => {
    expect(normalizeTriggerStrictMode(undefined)).toBe('warn');
    expect(normalizeTriggerStrictMode('off')).toBe('off');
    expect(normalizeTriggerStrictMode('warn')).toBe('warn');
    expect(normalizeTriggerStrictMode('true')).toBe('fail');
    expect(normalizeTriggerStrictMode('fail')).toBe('fail');
  });

  test('buildInputSourceMap reports invalid and duplicate array entries', () => {
    const cfg = {
      global: {
        inputs: [
          { id: 'spell-box', topic: 'paradox/houdini/inputs/spell-box/events' },
          { id: 'spell-box', topic: 'paradox/houdini/inputs/spell-box/duplicate' },
          { id: 'missing-topic' }
        ]
      }
    };

    const { sourceMap, diagnostics } = buildInputSourceMap(cfg);

    expect(sourceMap.size).toBe(1);
    expect(sourceMap.has('spell-box')).toBe(true);
    expect(diagnostics.duplicateSources).toHaveLength(1);
    expect(diagnostics.invalidSources).toHaveLength(1);
  });

  test('buildTriggerRules resolves sources and records unresolved/unknown rules', () => {
    const inputSources = new Map([
      ['spell-box', { topic: 'paradox/houdini/inputs/spell-box/events' }]
    ]);

    const rawRules = [
      {
        name: 'solve-on-spell-box-open',
        trigger: { source: 'spell-box', condition: { event: 'opened' } },
        actions: [{ end: 'win' }]
      },
      {
        name: 'unknown-source-with-topic',
        trigger: { source: 'unknown-source', topic: 'paradox/custom/topic', condition: { event: 'opened' } },
        actions: []
      },
      {
        name: 'unresolved-no-topic',
        trigger: { source: 'unknown-source', condition: { event: 'opened' } },
        actions: []
      }
    ];

    const { triggerRules, diagnostics } = buildTriggerRules(rawRules, inputSources);

    expect(triggerRules).toHaveLength(2);
    expect(triggerRules[0].trigger.topic).toBe('paradox/houdini/inputs/spell-box/events');
    expect(diagnostics.unknownSourceRules).toHaveLength(1);
    expect(diagnostics.unresolvedRules).toHaveLength(1);
  });

  test('getRulePhaseConstraint supports string and array forms', () => {
    expect(getRulePhaseConstraint({ whenPhase: 'gameplay' })).toEqual(['gameplay']);
    expect(getRulePhaseConstraint({ trigger: { 'when-phase': ['gameplay', 'paused'] } })).toEqual(['gameplay', 'paused']);
    expect(getRulePhaseConstraint({})).toBe(null);
  });

  test('normalizeEventToken handles common event synonyms', () => {
    expect(normalizeEventToken('opened')).toBe('open');
    expect(normalizeEventToken('open')).toBe('open');
    expect(normalizeEventToken('closed')).toBe('close');
    expect(normalizeEventToken('pressed')).toBe('press');
  });

  test('getValueByPath resolves nested payload fields', () => {
    const payload = { input_event: { event: 'open', input: '0' } };
    expect(getValueByPath(payload, 'input_event.event')).toBe('open');
    expect(getValueByPath(payload, 'input_event.missing')).toBe(undefined);
  });

  test('doesTriggerConditionMatch supports nested keys and event aliases', () => {
    const payload = {
      event: 'open',
      input_event: {
        event: 'opened',
        input: '0'
      }
    };

    expect(doesTriggerConditionMatch(payload, { event: 'opened' })).toBe(true);
    expect(doesTriggerConditionMatch(payload, { 'input_event.event': 'open' })).toBe(true);
    expect(doesTriggerConditionMatch(payload, { input: '0' })).toBe(true);
    expect(doesTriggerConditionMatch(payload, { event: ['closed', 'opened'] })).toBe(true);
    expect(doesTriggerConditionMatch(payload, { event: 'closed' })).toBe(false);
  });
});

describe('modular trigger transformation', () => {
  test('transforms EDN-style :inputs and :triggers into legacy runtime shape', () => {
    const config = {
      global: {
        settings: {
          'default-mode': 'demo',
          'game-heartbeat-ms': 1000
        },
        mqtt: {
          broker: 'localhost',
          'game-topic': 'paradox/houdini/game'
        },
        inputs: {
          'spell-box': {
            topic: 'paradox/houdini/inputs/spell-box/events',
            producer: 'pfx'
          }
        },
        triggers: {
          'spell-box-opened-solve': {
            description: 'Solve on spell-box open',
            source: 'spell-box',
            'when-phase': 'gameplay',
            condition: { event: 'opened' },
            actions: [{ end: 'win' }]
          }
        },
        sequences: {},
        cues: {},
        hints: {}
      },
      'game-modes': {
        demo: {
          'short-label': 'Demo',
          'game-label': 'Demo',
          phases: {
            intro: { duration: 5, sequence: 'noop' },
            gameplay: { duration: 60, sequence: 'noop' },
            solved: { duration: 5, sequence: 'noop' },
            failed: { duration: 5, sequence: 'noop' },
            abort: { sequence: 'noop' },
            reset: { sequence: 'noop' }
          }
        }
      }
    };

    const transformed = ModularConfigAdapter.transform(config);

    expect(transformed.global.inputs['spell-box'].topic).toBe('paradox/houdini/inputs/spell-box/events');
    expect(Array.isArray(transformed.global.triggers.escapeRoomRules)).toBe(true);
    expect(transformed.global.triggers.escapeRoomRules[0].name).toBe('spell-box-opened-solve');
    expect(transformed.global.triggers.escapeRoomRules[0].trigger.source).toBe('spell-box');
    expect(transformed.global.triggers.escapeRoomRules[0]['when-phase']).toBe('gameplay');
    expect(transformed.global.triggers.escapeRoomRules[0].whenPhase).toBe('gameplay');
  });
});
