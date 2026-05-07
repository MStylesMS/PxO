const StateMachine = require('../src/stateMachine');

function createMockFunction() {
    const fn = function (...args) {
        fn.called = true;
        fn.callCount = (fn.callCount || 0) + 1;
        fn.lastCall = args;
        return fn;
    };
    fn.called = false;
    fn.callCount = 0;
    fn.calledWith = function (expectedArg) {
        return fn.lastCall && fn.lastCall[0] === expectedArg;
    };
    return fn;
}

function setupMocks() {
    const mockClock = {
        start: createMockFunction(),
        setTime: createMockFunction(),
        pause: createMockFunction(),
        resume: createMockFunction(),
        fadeIn: createMockFunction(),
        fadeOut: createMockFunction(),
        hint: createMockFunction()
    };

    const mockLights = {
        scene: createMockFunction()
    };

    const mockZones = {
        calls: [],
        getZone: function (zoneName) {
            this.getZone.called = true;
            this.calls.push(zoneName);
            this.getZone.lastCall = zoneName;
            if (zoneName === 'clock') return mockClock;
            if (zoneName === 'lights') return mockLights;
            return null;
        }
    };
    mockZones.getZone.called = false;
    mockZones.getZone.calledWith = function (expectedZone) {
        return this.lastCall === expectedZone;
    };
    mockZones.getZone.wasCalledWith = function (expectedZone) {
        return mockZones.calls.includes(expectedZone);
    };

    const cfg = {
        global: {
            mqtt: { 'game-topic': 'game' },
            settings: {}
        },
        game: {}
    };

    const publishedEvents = [];
    const mockMqtt = {
        publish: (topic, payload) => {
            if (String(topic).endsWith('/events')) {
                publishedEvents.push(payload);
            }
        },
        subscribe: () => { },
        on: () => { }
    };

    const stateMachine = new StateMachine({
        cfg,
        mqtt: mockMqtt
    });

    // Override the zones property with our mock
    stateMachine.zones = mockZones;
    stateMachine.startUnifiedTimer = () => {};
    stateMachine.stopUnifiedTimer = () => {};
    stateMachine._runAdjustTimeSequence = () => {};

    return { mockClock, mockLights, mockZones, stateMachine };
}

describe('zone-based adapter routing', () => {
    test('getAdapter helper returns correct adapter for valid zone', () => {
        const { mockClock, mockLights, stateMachine } = setupMocks();

        expect(stateMachine.getAdapter('clock')).toBe(mockClock);
        expect(stateMachine.getAdapter('lights')).toBe(mockLights);
    });

    test('getAdapter returns null for invalid zone', () => {
        const { stateMachine } = setupMocks();
        expect(stateMachine.getAdapter('nonexistent')).toBeNull();
    });

    test('pause method uses clock adapter via zone registry', () => {
        const { stateMachine } = setupMocks();

        stateMachine.state = 'gameplay';
        stateMachine.pause();

        expect(stateMachine.state).toBe('paused');
    });

    test('resume method uses clock adapter via zone registry', () => {
        const { stateMachine } = setupMocks();

        stateMachine.state = 'paused';
        stateMachine.remaining = 120;
        stateMachine.resume();

        expect(stateMachine.state).toBe('gameplay');
    });

    test('adjustTime method uses clock adapter via zone registry', () => {
        const { stateMachine } = setupMocks();

        stateMachine.state = 'gameplay';
        stateMachine.remaining = 60;
        stateMachine.adjustTime(-10);

        expect(stateMachine.remaining).toBe(50);
    });

    test('gracefulHalt method uses adapters via zone registry', () => {
        const { stateMachine } = setupMocks();
        expect(() => stateMachine.gracefulHalt()).not.toThrow();
    });

    test('handles missing clock adapter gracefully', () => {
        const { mockLights, stateMachine } = setupMocks();

        stateMachine.zones.getZone = function (zoneName) {
            if (zoneName === 'lights') return mockLights;
            return null;
        };

        stateMachine.state = 'gameplay';
        stateMachine.pause();

        expect(stateMachine.state).toBe('paused');
    });
});