const GameStateMachine = require('../src/stateMachine');

function makeMqtt() {
    return {
        published: [],
        subscribe() {},
        on() {},
        publish(topic, message) {
            this.published.push({ topic, message });
        }
    };
}

describe('GameStateMachine hint media type execution', () => {
    test('routes background and image hints to the correct pfx-media commands and rejects audio', async () => {
        const mqtt = makeMqtt();
        const cfg = {
            global: {
                mqtt: {
                    'game-topic': 'paradox/test',
                    zones: {
                        audio: { type: 'pfx-media', 'base-topic': 'paradox/test/audio' },
                        picture: { type: 'pfx-media', 'base-topic': 'paradox/test/picture' }
                    }
                },
                hints: {
                    bg: { type: 'background', zone: 'audio', file: 'ambient.mp3' },
                    img: { type: 'image', zone: 'picture', file: 'poster.png' },
                    bad: { type: 'audio', zone: 'audio', file: 'boom.wav' }
                }
            },
            'game-modes': {}
        };

        const stateMachine = new GameStateMachine({ cfg, mqtt });
        stateMachine.publishWarning = jest.fn();
        stateMachine.publishEvent = jest.fn();

        await expect(stateMachine.fireHint('bg')).resolves.toBe(true);
        await expect(stateMachine.fireHint('img')).resolves.toBe(true);
        await expect(stateMachine.fireHint('bad')).resolves.toBe(false);

        expect(mqtt.published.some(entry => entry.message.command === 'playBackground' && entry.message.file === 'ambient.mp3')).toBe(true);
        expect(mqtt.published.some(entry => entry.message.command === 'setImage' && entry.message.file === 'poster.png')).toBe(true);
        expect(stateMachine.publishWarning).toHaveBeenCalledWith('hint_invalid_type', expect.objectContaining({ type: 'audio' }));
    });
});