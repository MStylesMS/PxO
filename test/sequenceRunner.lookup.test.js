const SequenceRunner = require('../src/sequenceRunner');

describe('SequenceRunner lookup helpers', () => {
  test('uses canonical names across modern and compatibility sequence lookup paths', () => {
    const cfg = {
      global: {
        'system-sequences': {
          system: {
            'software-halt-sequence': {
              sequence: [{ wait: 1 }]
            }
          },
          misc: {
            'legacy-custom-sequence': {
              sequence: [{ wait: 3 }]
            }
          }
        },
        'command-sequences': {
          'gameplay-start-sequence': {
            sequence: [{ wait: 2 }]
          }
        }
      }
    };

    const runner = new SequenceRunner({ cfg, zones: null, mqtt: null });

    expect(runner.resolveSequenceNew('gameplay-start-sequence')).toEqual([{ wait: 2 }]);
    expect(runner.resolveSequence('gameplay-start-sequence')).toEqual({ sequence: [{ wait: 2 }] });
    expect(runner.resolveSequenceNew('start-sequence')).toBeUndefined();
    expect(runner.resolveSequence('start-sequence')).toBeUndefined();

    expect(runner.resolveSequenceNew('software-halt-sequence')).toEqual([{ wait: 1 }]);
    expect(runner.resolveSequence('software-halt-sequence')).toEqual({ sequence: [{ wait: 1 }] });
    expect(runner.resolveSequenceNew('halt-sequence')).toBeUndefined();
    expect(runner.resolveSequence('halt-sequence')).toBeUndefined();

    expect(runner.resolveSequenceNew('legacy-custom')).toEqual([{ wait: 3 }]);
    expect(runner.resolveSequence('legacy-custom')).toEqual({ sequence: [{ wait: 3 }] });
  });
});