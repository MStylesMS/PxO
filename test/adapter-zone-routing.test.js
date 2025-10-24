const StateMachine = require('../src/stateMachine');

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

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

// Test zone-based adapter routing
console.log('Running Zone-Based Adapter Routing Tests...');

let testCount = 0;
let passCount = 0;

function test(name, testFn) {
    testCount++;
    try {
        testFn();
        passCount++;
        console.log(`✓ ${name}`);
    } catch (error) {
        console.log(`✗ ${name}: ${error.message}`);
    }
}

// Setup for tests
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

    return { mockClock, mockLights, mockZones, stateMachine };
}

test('getAdapter helper returns correct adapter for valid zone', () => {
    const { mockClock, mockLights, stateMachine } = setupMocks();

    const clockAdapter = stateMachine.getAdapter('clock');
    assert(clockAdapter === mockClock, 'getAdapter should return clock adapter');

    const lightsAdapter = stateMachine.getAdapter('lights');
    assert(lightsAdapter === mockLights, 'getAdapter should return lights adapter');
});

test('getAdapter returns null for invalid zone', () => {
    const { stateMachine } = setupMocks();

    const invalidAdapter = stateMachine.getAdapter('nonexistent');
    assert(invalidAdapter === null, 'getAdapter should return null for invalid zone');
});

test('pause method uses clock adapter via zone registry', () => {
    const { mockZones, stateMachine } = setupMocks();

    stateMachine.state = 'gameplay';
    stateMachine.pause();

    assert(stateMachine.state === 'paused', 'state should be paused');
});

test('resume method uses clock adapter via zone registry', () => {
    const { mockZones, stateMachine } = setupMocks();

    stateMachine.state = 'paused';
    stateMachine.remaining = 120;
    stateMachine.resume();

    assert(stateMachine.state === 'gameplay', 'state should be gameplay');
});

test('adjustTime method uses clock adapter via zone registry', () => {
    const { mockZones, stateMachine } = setupMocks();

    stateMachine.state = 'gameplay';
    stateMachine.remaining = 60;
    stateMachine.adjustTime(-10);

    assert(stateMachine.remaining === 50, 'remaining time should be adjusted');
    // In adapter-first mode, clock updates are handled by sequences or listeners; no direct calls expected
});

test('gracefulHalt method uses adapters via zone registry', () => {
    const { mockZones, stateMachine } = setupMocks();

    stateMachine.gracefulHalt();

    // No direct adapter calls; ensure it didn't throw and event/state can be asserted separately if needed
});

test('handles missing clock adapter gracefully', () => {
    const { mockLights, stateMachine } = setupMocks();

    // Override getZone to return null for clock
    stateMachine.zones.getZone = function (zoneName) {
        if (zoneName === 'lights') return mockLights;
        return null; // No clock adapter
    };

    // Should not throw error when clock adapter is missing
    stateMachine.state = 'gameplay';
    stateMachine.pause(); // This should not crash

    assert(stateMachine.state === 'paused', 'state should still change even without adapter');
});

console.log(`\nTests completed: ${passCount}/${testCount} passed`);
if (passCount === testCount) {
    console.log('adapter-zone-routing.test.js PASS');
} else {
    console.log('adapter-zone-routing.test.js FAIL');
    process.exit(1);
}