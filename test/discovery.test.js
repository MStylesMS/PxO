/**
 * Unit tests for _publishMqttMetadata (game.js)
 *
 * Runs within the PxO custom test runner (test/run-tests.js).
 * Uses global `describe`, `test`, `beforeEach`, `expect`, and `jest.fn()`.
 */

const { _publishMqttMetadata } = require('../src/game');

function makeStateMachine(zoneNames = [], zones = {}) {
    return {
        zones: {
            getZoneNames: jest.fn(() => zoneNames),
            getZone: jest.fn((name) => zones[name] || null),
        },
    };
}

function makeMqtt() {
    return { publish: jest.fn() };
}

function makeCfg(gameTopic) {
    if (!gameTopic) return { global: { mqtt: {} } };
    return { global: { mqtt: { 'game-topic': gameTopic } } };
}

describe('_publishMqttMetadata', () => {
    test('publishes retained discovery and schema when gameTopic is configured', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine(['lights', 'clock'], {
            lights: { zoneType: 'lights', zoneBaseTopic: 'paradox/test/lights' },
            clock:  { zoneType: 'clock',  zoneBaseTopic: 'paradox/test/clock' },
        });

        _publishMqttMetadata(mqtt, makeCfg('paradox/test'), sm);

        expect(mqtt.publish).toHaveBeenCalledTimes(2);
    });

    test('discovery topic is {gameTopic}/discovery', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine();

        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);

        const topics = mqtt.publish.mock.calls.map(c => c[0]);
        const hasDiscovery = topics.some(t => t === 'paradox/game/discovery');
        if (!hasDiscovery) throw new Error(`Expected paradox/game/discovery in topics: ${topics}`);
    });

    test('schema topic is {gameTopic}/schema', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine();

        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);

        const topics = mqtt.publish.mock.calls.map(c => c[0]);
        const hasSchema = topics.some(t => t === 'paradox/game/schema');
        if (!hasSchema) throw new Error(`Expected paradox/game/schema in topics: ${topics}`);
    });

    test('both publishes pass retain: true', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine();

        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);

        const allRetained = mqtt.publish.mock.calls.every(c => c[2] && c[2].retain === true);
        if (!allRetained) throw new Error('Expected all publishes to have retain: true');
    });

    test('discovery payload includes application, gameTopic, commandsTopic, stateTopic', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine(['lights'], {
            lights: { zoneType: 'lights', zoneBaseTopic: 'paradox/test/lights' },
        });

        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);

        const discoveryCall = mqtt.publish.mock.calls.find(c => c[0] === 'paradox/game/discovery');
        if (!discoveryCall) throw new Error('Discovery publish not found');
        const payload = discoveryCall[1];
        expect(payload.application).toBe('pxo');
        expect(payload.gameTopic).toBe('paradox/game');
        expect(payload.commandsTopic).toBe('paradox/game/commands');
        expect(payload.stateTopic).toBe('paradox/game/state');
        expect(payload.zones).toBeTruthy();
    });

    test('discovery payload zones array includes zone name and type', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine(['audio'], {
            audio: { zoneType: 'audio', zoneBaseTopic: 'paradox/test/audio' },
        });

        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);

        const discoveryCall = mqtt.publish.mock.calls.find(c => c[0] === 'paradox/game/discovery');
        const zone = discoveryCall[1].zones[0];
        expect(zone.name).toBe('audio');
        expect(zone.type).toBe('audio');
        expect(zone.baseTopic).toBe('paradox/test/audio');
    });

    test('schema payload includes application, commandsTopic, and commands array', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine();

        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);

        const schemaCall = mqtt.publish.mock.calls.find(c => c[0] === 'paradox/game/schema');
        if (!schemaCall) throw new Error('Schema publish not found');
        const payload = schemaCall[1];
        expect(payload.application).toBe('pxo');
        expect(payload.commandsTopic).toBe('paradox/game/commands');
        if (!Array.isArray(payload.commands) || payload.commands.length === 0) {
            throw new Error(`Expected non-empty commands array; got: ${JSON.stringify(payload.commands)}`);
        }
    });

    test('does not publish when gameTopic is absent', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine();

        _publishMqttMetadata(mqtt, makeCfg(null), sm);

        expect(mqtt.publish).toHaveBeenCalledTimes(0);
    });

    test('does not throw when cfg is null', () => {
        const mqtt = makeMqtt();
        const sm = makeStateMachine();

        // Should not throw — guarded by try/catch
        _publishMqttMetadata(mqtt, null, sm);

        expect(mqtt.publish).toHaveBeenCalledTimes(0);
    });

    test('does not throw when sm.zones is absent', () => {
        const mqtt = makeMqtt();
        const sm = {};

        // Should not throw — guarded by try/catch
        _publishMqttMetadata(mqtt, makeCfg('paradox/game'), sm);
    });
});
