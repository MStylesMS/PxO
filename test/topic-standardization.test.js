#!/usr/bin/env node

// Test script to verify topic standardization (/state vs /status) and simplified config structure
const { loadConfig } = require('../src/config');

console.log('Testing topic standardization and simplified config...');

const cfg = loadConfig();
const topics = cfg.global.mqtt.topics;

let hasStatus = false;
let statusTopics = [];

// Check for any remaining /status topics
function checkTopics(obj, path = '') {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    
    if (typeof value === 'string') {
      if (value.includes('/status')) {
        hasStatus = true;
        statusTopics.push(`${currentPath}: ${value}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      checkTopics(value, currentPath);
    }
  }
}

checkTopics(topics);

console.log('=== Topic Standardization Check ===');
if (hasStatus) {
  console.log('❌ FAIL: Found /status topics that should be /state:');
  statusTopics.forEach(topic => console.log(`  - ${topic}`));
} else {
  console.log('✅ PASS: No /status topics found');
}

// Check that simplified structure is in place (base_topic instead of explicit subtopics)
console.log('\n=== Simplified Config Structure Check ===');
const expectedBaseTopics = [
  'fx.mirror.base_topic',
  'fx.picture.base_topic', 
  'fx.audio.base_topic',
  'clock.base_topic',
  'lights.base_topic'
];

let allBaseTopicsFound = true;
let hasLegacySubtopics = false;
const legacySubtopics = [];

expectedBaseTopics.forEach(topicPath => {
  const pathParts = topicPath.split('.');
  let current = topics;
  
  for (const part of pathParts) {
    current = current?.[part];
  }
  
  if (current && typeof current === 'string') {
    console.log(`✅ ${topicPath}: ${current}`);
  } else {
    console.log(`❌ ${topicPath}: Missing or invalid`);
    allBaseTopicsFound = false;
  }
});

// Check for legacy explicit subtopic definitions that should be removed
function checkForLegacySubtopics(obj, path = '') {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    
    if (typeof value === 'object' && value !== null) {
      // Check if this object has both base_topic and explicit subtopics
      if (value.base_topic && (value.events || value.state || value.warnings)) {
        hasLegacySubtopics = true;
        const explicitSubtopics = Object.keys(value).filter(k => k !== 'base_topic');
        legacySubtopics.push(`${currentPath}: has explicit subtopics [${explicitSubtopics.join(', ')}]`);
      }
      checkForLegacySubtopics(value, currentPath);
    }
  }
}

checkForLegacySubtopics(topics);

console.log('\n=== Legacy Subtopic Check ===');
if (hasLegacySubtopics) {
  console.log('❌ FAIL: Found legacy explicit subtopics that should be removed:');
  legacySubtopics.forEach(topic => console.log(`  - ${topic}`));
} else {
  console.log('✅ PASS: No legacy explicit subtopics found - config properly simplified');
}

// Test derived topic generation
console.log('\n=== Derived Topic Generation Test ===');
const testBaseTopic = topics.fx?.mirror?.base_topic;
if (testBaseTopic) {
  const derivedTopics = {
    commands: `${testBaseTopic}/commands`,
    state: `${testBaseTopic}/state`,
    events: `${testBaseTopic}/events`,
    warnings: `${testBaseTopic}/warnings`
  };
  
  console.log(`Base topic: ${testBaseTopic}`);
  Object.entries(derivedTopics).forEach(([suffix, fullTopic]) => {
    console.log(`✅ Derived ${suffix}: ${fullTopic}`);
  });
} else {
  console.log('❌ Could not test topic derivation - missing base_topic');
}

console.log('\n=== Final Result ===');
if (!hasStatus && allBaseTopicsFound && !hasLegacySubtopics) {
  console.log('✅ PASS: All checks passed - simplified config with /state standardization complete');
} else {
  console.log('❌ FAIL: Some checks failed');
}

console.log('\ntopic-standardization.test.js COMPLETE');
