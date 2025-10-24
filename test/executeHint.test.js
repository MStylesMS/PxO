const StateMachine = require('../src/stateMachine');
const { getCommandsTopic } = require('../src/engineUtils');

describe('fireHint publishes executeHint on commands topic', () => {
    test('publishes executeHint with id on the commands topic', () => {
        const cfg = { global: { mqtt: { 'game-topic': 'paradox/houdini' } } };
        const published = [];
        const mqtt = { publish: jest.fn((topic, payload) => published.push({ topic, payload })) };
        const sm = new StateMachine({ cfg, mqtt });
        const commandsTopic = getCommandsTopic(cfg);

        sm.fireHint('t1', 'test');
        expect(mqtt.publish).toHaveBeenCalledWith(commandsTopic, { command: 'executeHint', id: 't1' });
    });
});
