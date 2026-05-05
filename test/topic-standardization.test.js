#!/usr/bin/env node

// Test script to verify topic standardization (/state vs /status) and simplified config structure
const { loadConfig } = require('../src/config');

function checkTopics(obj, path = '') {
  const matches = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof value === 'string') {
      if (value.includes('/status')) {
        matches.push(`${currentPath}: ${value}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      matches.push(...checkTopics(value, currentPath));
    }
  }

  return matches;
}

function collectLegacySubtopics(obj, path = '') {
  const matches = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof value === 'object' && value !== null) {
      if (value.base_topic && (value.events || value.state || value.warnings)) {
        const explicitSubtopics = Object.keys(value).filter(k => k !== 'base_topic');
        matches.push(`${currentPath}: has explicit subtopics [${explicitSubtopics.join(', ')}]`);
      }
      matches.push(...collectLegacySubtopics(value, currentPath));
    }
  }

  return matches;
}

describe('topic standardization', () => {
  const topics = loadConfig().global.mqtt.topics;
  const expectedBaseTopics = [
    'fx.mirror.base_topic',
    'fx.picture.base_topic',
    'fx.audio.base_topic',
    'clock.base_topic',
    'lights.base_topic'
  ];

  test('does not contain /status topics', () => {
    expect(checkTopics(topics)).toEqual([]);
  });

  test('keeps expected base topics in simplified structure', () => {
    expectedBaseTopics.forEach(topicPath => {
      const pathParts = topicPath.split('.');
      let current = topics;

      for (const part of pathParts) {
        current = current?.[part];
      }

      expect(typeof current).toBe('string');
      expect(current.length).toBeGreaterThan(0);
    });
  });

  test('does not keep legacy explicit subtopics alongside base topics', () => {
    expect(collectLegacySubtopics(topics)).toEqual([]);
  });

  test('derives standard command/state/event/warning topics from base topic', () => {
    const testBaseTopic = topics.fx?.mirror?.base_topic;
    expect(typeof testBaseTopic).toBe('string');

    expect({
      commands: `${testBaseTopic}/commands`,
      state: `${testBaseTopic}/state`,
      events: `${testBaseTopic}/events`,
      warnings: `${testBaseTopic}/warnings`
    }).toEqual({
      commands: 'paradox/houdini/mirror/commands',
      state: 'paradox/houdini/mirror/state',
      events: 'paradox/houdini/mirror/events',
      warnings: 'paradox/houdini/mirror/warnings'
    });
  });
});
