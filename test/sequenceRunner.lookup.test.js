const SequenceRunner = require('../src/sequenceRunner');

describe('SequenceRunner lookup helpers', () => {
  test('uses the same legacy name variants across modern and compatibility sequence lookup paths', () => {
    const cfg = {
      global: {
        'system-sequences': {
          system: {
            'software-halt-sequence': {
              sequence: [{ wait: 1 }]
            }
          }
        },
        'command-sequences': {
          'gameplay-start-sequence': {
            sequence: [{ wait: 2 }]
          }
        },
        sequences: {
          'game-actions': {
            'legacy-custom-sequence': {
              sequence: [{ wait: 3 }]
            }
          }
        }
      }
    };

    const runner = new SequenceRunner({ cfg, zones: null, mqtt: null });

    expect(runner.resolveSequenceNew('start-sequence')).toEqual([{ wait: 2 }]);
    expect(runner.resolveSequence('start-sequence')).toEqual({ sequence: [{ wait: 2 }] });

    expect(runner.resolveSequenceNew('halt-sequence')).toEqual([{ wait: 1 }]);
    expect(runner.resolveSequence('halt-sequence')).toEqual({ sequence: [{ wait: 1 }] });

    expect(runner.resolveSequenceNew('legacy-custom')).toEqual([{ wait: 3 }]);
    expect(runner.resolveSequence('legacy-custom')).toEqual({ sequence: [{ wait: 3 }] });
  });
});