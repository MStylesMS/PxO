const AdapterRegistry = require('../../src/adapters/adapterRegistry');
const PfxAdapter = require('../../src/adapters/pfx');
const LightsAdapter = require('../../src/adapters/lights');
const ClockAdapter = require('../../src/adapters/clock');

describe('AdapterRegistry', () => {
    let mockMqtt;
    let registry;

    beforeEach(() => {
        mockMqtt = {
            publish: jest.fn(),
            subscribe: jest.fn(),
            on: jest.fn()
        };
    });

    afterEach(() => {
        if (registry) {
            registry.cleanup();
        }
    });

    describe('Zone Initialization', () => {
        test('should initialize pfx-media zones correctly', () => {
            const zonesConfig = {
                'mirror': {
                    'type': 'pfx-media',
                    'base-topic': 'paradox/houdini/mirror'
                }
            };

            registry = new AdapterRegistry(mockMqtt, zonesConfig);

            const adapter = registry.getZone('mirror');
            expect(adapter).toBeInstanceOf(PfxAdapter);
            expect(adapter.zoneName).toBe('mirror');
            expect(adapter.zoneType).toBe('pfx-media');
            expect(adapter.zoneBaseTopic).toBe('paradox/houdini/mirror');
        });

        test('should initialize pfx-lights zones correctly', () => {
            const zonesConfig = {
                'study-lights': {
                    'type': 'pfx-lights',
                    'base-topic': 'paradox/houdini/study-lights'
                }
            };

            registry = new AdapterRegistry(mockMqtt, zonesConfig);

            const adapter = registry.getZone('study-lights');
            expect(adapter).toBeInstanceOf(LightsAdapter);
            expect(adapter.zoneName).toBe('study-lights');
            expect(adapter.zoneType).toBe('pfx-lights');
        });

        test('should initialize houdini-clock zones correctly', () => {
            const zonesConfig = {
                'clock': {
                    'type': 'houdini-clock',
                    'base-topic': 'paradox/houdini/clock'
                }
            };

            registry = new AdapterRegistry(mockMqtt, zonesConfig);

            const adapter = registry.getZone('clock');
            expect(adapter).toBeInstanceOf(ClockAdapter);
            expect(adapter.zoneName).toBe('clock');
            expect(adapter.zoneType).toBe('houdini-clock');
        });

        test('should handle multiple zones of different types', () => {
            const zonesConfig = {
                'mirror': { 'type': 'pfx-media', 'base-topic': 'mirror' },
                'picture': { 'type': 'pfx-media', 'base-topic': 'picture' },
                'lights': { 'type': 'pfx-lights', 'base-topic': 'lights' },
                'clock': { 'type': 'houdini-clock', 'base-topic': 'clock' }
            };

            registry = new AdapterRegistry(mockMqtt, zonesConfig);

            expect(registry.getZoneNames()).toHaveLength(4);
            expect(registry.getZoneNames()).toEqual(expect.arrayContaining(['mirror', 'picture', 'lights', 'clock']));

            const mediaZones = registry.getZonesByType('pfx-media');
            expect(mediaZones).toHaveLength(2);
            expect(mediaZones.map(z => z.zoneName)).toEqual(expect.arrayContaining(['mirror', 'picture']));
        });
    });

    describe('Error Handling', () => {
        test('should throw error for missing type field', () => {
            const zonesConfig = {
                'invalid': {
                    'base-topic': 'some/topic'
                }
            };

            expect(() => {
                registry = new AdapterRegistry(mockMqtt, zonesConfig);
            }).toThrow("Zone 'invalid' missing required 'type' field");
        });

        test('should throw error for missing base-topic field', () => {
            const zonesConfig = {
                'invalid': {
                    'type': 'pfx-media'
                }
            };

            expect(() => {
                registry = new AdapterRegistry(mockMqtt, zonesConfig);
            }).toThrow("Zone 'invalid' missing required 'base-topic' field");
        });

        test('should throw error for unknown adapter type', () => {
            const zonesConfig = {
                'invalid': {
                    'type': 'unknown-adapter',
                    'base-topic': 'some/topic'
                }
            };

            expect(() => {
                registry = new AdapterRegistry(mockMqtt, zonesConfig);
            }).toThrow("Unknown adapter type 'unknown-adapter' for zone 'invalid'");
        });

        test('should return undefined for non-existent zone', () => {
            registry = new AdapterRegistry(mockMqtt, {});

            const adapter = registry.getZone('nonexistent');
            expect(adapter).toBeUndefined();
        });

        test('should throw error when validating non-existent zone', () => {
            registry = new AdapterRegistry(mockMqtt, {});

            expect(() => {
                registry.validateZone('nonexistent');
            }).toThrow("Invalid zone reference: 'nonexistent'");
        });
    });

    describe('Registry Operations', () => {
        beforeEach(() => {
            const zonesConfig = {
                'mirror': { 'type': 'pfx-media', 'base-topic': 'mirror' },
                'lights': { 'type': 'pfx-lights', 'base-topic': 'lights' },
                'clock': { 'type': 'houdini-clock', 'base-topic': 'clock' }
            };
            registry = new AdapterRegistry(mockMqtt, zonesConfig);
        });

        test('should return all zone names', () => {
            const names = registry.getZoneNames();
            expect(names).toHaveLength(3);
            expect(names).toEqual(expect.arrayContaining(['mirror', 'lights', 'clock']));
        });

        test('should return all adapters', () => {
            const adapters = registry.getAllAdapters();
            expect(adapters).toHaveLength(3);
            expect(adapters.every(a => a.zoneName && a.zoneType)).toBe(true);
        });

        test('should return event topics', () => {
            const eventTopics = registry.getAllEventTopics();
            expect(eventTopics).toHaveLength(3);
            expect(eventTopics).toEqual(expect.arrayContaining([
                'mirror/events',
                'lights/events',
                'clock/events'
            ]));
        });

        test('should return event topic to zone mapping', () => {
            const mapping = registry.getEventTopicToZoneMap();
            expect(mapping).toEqual({
                'mirror/events': 'mirror',
                'lights/events': 'lights',
                'clock/events': 'clock'
            });
        });

        test('should filter zones by type', () => {
            const mediaZones = registry.getZonesByType('pfx-media');
            expect(mediaZones).toHaveLength(1);
            expect(mediaZones[0].zoneName).toBe('mirror');

            const lightZones = registry.getZonesByType('pfx-lights');
            expect(lightZones).toHaveLength(1);
            expect(lightZones[0].zoneName).toBe('lights');

            const clockZones = registry.getZonesByType('houdini-clock');
            expect(clockZones).toHaveLength(1);
            expect(clockZones[0].zoneName).toBe('clock');
        });
    });
});
