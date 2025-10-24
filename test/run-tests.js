#!/usr/bin/env node
// Simple ad-hoc test runner (no jest) for quick assertions
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname);
let failures = 0;

// Ensure unexpected async errors are surfaced and do not hang the process
process.on('unhandledRejection', (reason) => {
  failures++;
  const msg = (reason && reason.stack) ? reason.stack : String(reason);
  process.stdout.write(`\n[TEST-RUNNER] UnhandledRejection: ${msg}\n`);
});
process.on('uncaughtException', (err) => {
  failures++;
  const msg = (err && err.stack) ? err.stack : String(err);
  process.stdout.write(`\n[TEST-RUNNER] UncaughtException: ${msg}\n`);
});

// Maintain a stack of hook contexts to emulate describe-scoped beforeEach/afterEach
// Each context: { beforeEach: [fn], afterEach: [fn] }
const hookStack = [];
function currentHooks() {
  if (hookStack.length === 0) hookStack.push({ beforeEach: [], afterEach: [] });
  return hookStack[hookStack.length - 1];
}

function log(msg) { process.stdout.write(msg + '\n'); }

global.describe = (name, fn) => {
  log(`\nSuite: ${name}`);
  // Push a new hook context for this describe block
  hookStack.push({ beforeEach: [], afterEach: [] });
  try {
    fn();
  } finally {
    // Pop context after suite finishes
    hookStack.pop();
  }
};

global.test = (name, fn) => {
  // Collect hooks from all active describe blocks (outer to inner)
  const allHooks = hookStack.slice();
  const runBefores = () => { for (const ctx of allHooks) { for (const h of ctx.beforeEach) { h(); } } };
  const runAfters = () => { for (let i = allHooks.length - 1; i >= 0; i--) { const ctx = allHooks[i]; for (const h of ctx.afterEach) { h(); } } };

  try {
    runBefores();
    fn();
    runAfters();
    log(`  ✓ ${name}`);
  } catch (e) {
    try { runAfters(); } catch (_) { /* swallow afterEach errors to not mask original */ }
    failures++; log(`  ✗ ${name} -> ${e.message}`);
  }
};

// Minimal mocha-like globals used by some tests
global.beforeEach = (fn) => { currentHooks().beforeEach.push(fn); };
global.afterEach = (fn) => { currentHooks().afterEach.push(fn); };
global.it = global.test;

// Minimal Jest-like expect implementation for common matchers used in our tests
global.expect = (received) => ({
  toBe: (expected) => { if (received !== expected) throw new Error(`Expected ${JSON.stringify(received)} to be ${JSON.stringify(expected)}`); },
  toEqual: (expected) => {
    const r = JSON.stringify(received);
    const e = JSON.stringify(expected);
    if (r !== e) throw new Error(`Expected ${r} to equal ${e}`);
  },
  toBeDefined: () => { if (typeof received === 'undefined') throw new Error('Expected value to be defined'); },
  toBeTruthy: () => { if (!received) throw new Error('Expected value to be truthy'); },
  toContain: (item) => {
    if (Array.isArray(received) || typeof received === 'string') {
      const ok = Array.isArray(received) ? received.includes(item) : received.indexOf(item) !== -1;
      if (!ok) throw new Error(`Expected ${JSON.stringify(received)} to contain ${JSON.stringify(item)}`);
    } else {
      throw new Error('toContain expects an array or string');
    }
  },
  toBeGreaterThan: (n) => {
    if (!(Number(received) > n)) throw new Error(`Expected ${received} to be > ${n}`);
  },
  some: (predicate) => { if (!Array.isArray(received) || !received.some(predicate)) throw new Error('Expected array.some(predicate) to be true'); },
  filter: (predicate) => { if (!Array.isArray(received)) throw new Error('Expected array'); return received.filter(predicate); },
  toHaveBeenCalledWith: (...args) => {
    const mock = received;
    if (!mock || !mock.mock || !Array.isArray(mock.mock.calls)) throw new Error('toHaveBeenCalledWith expects a jest.fn mock');
    const matched = mock.mock.calls.some(call => JSON.stringify(call) === JSON.stringify(args));
    if (!matched) throw new Error(`Expected mock to have been called with ${JSON.stringify(args)}; calls: ${JSON.stringify(mock.mock.calls)}`);
  },
  toHaveBeenCalledTimes: (n) => {
    const mock = received;
    if (!mock || !mock.mock || !Array.isArray(mock.mock.calls)) throw new Error('toHaveBeenCalledTimes expects a jest.fn mock');
    if (mock.mock.calls.length !== n) throw new Error(`Expected mock to have been called ${n} times; was called ${mock.mock.calls.length} times`);
  }
});

// Minimal Jest-like mocking utilities including fake timers
(function setupJestShim() {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  let useFake = false;
  let currentTime = 0;
  let timerIdSeq = 1;
  const scheduled = new Map(); // id -> {time, fn, type: 'timeout'|'interval', interval?: number}

  function fakeSetTimeout(fn, ms) {
    const id = timerIdSeq++;
    scheduled.set(id, { time: currentTime + (ms || 0), fn, type: 'timeout' });
    return id;
  }
  function fakeClearTimeout(id) { scheduled.delete(id); }
  function fakeSetInterval(fn, ms) {
    const id = timerIdSeq++;
    const interval = Math.max(0, ms || 0);
    scheduled.set(id, { time: currentTime + interval, fn, type: 'interval', interval });
    return id;
  }
  function fakeClearInterval(id) { scheduled.delete(id); }
  function runDue() {
    // Run all scheduled with time <= currentTime in order
    const entries = Array.from(scheduled.entries()).sort((a, b) => a[1].time - b[1].time);
    for (const [id, rec] of entries) {
      if (rec.time <= currentTime) {
        if (rec.type === 'timeout') {
          scheduled.delete(id);
          try { rec.fn(); } catch (e) { throw e; }
        } else if (rec.type === 'interval') {
          // For intervals, execute and reschedule
          try { rec.fn(); } catch (e) { throw e; }
          rec.time = currentTime + rec.interval;
          scheduled.set(id, rec);
        }
      }
    }
  }

  global.jest = {
    fn: (impl) => {
      const mockFn = function (...args) {
        mockFn.mock.calls.push(args);
        return impl ? impl.apply(this, args) : undefined;
      };
      mockFn.mock = { calls: [] };
      mockFn.mockResolvedValue = (val) => { impl = () => Promise.resolve(val); return mockFn; };
      mockFn.mockImplementation = (newImpl) => { impl = newImpl; return mockFn; };
      return mockFn;
    },
    useFakeTimers: () => {
      if (!useFake) {
        useFake = true;
        currentTime = 0;
        global.setTimeout = fakeSetTimeout;
        global.clearTimeout = fakeClearTimeout;
        global.setInterval = fakeSetInterval;
        global.clearInterval = fakeClearInterval;
      }
    },
    useRealTimers: () => {
      if (useFake) {
        useFake = false;
        scheduled.clear();
        global.setTimeout = realSetTimeout;
        global.clearTimeout = realClearTimeout;
        global.setInterval = realSetInterval;
        global.clearInterval = realClearInterval;
      }
    },
    runOnlyPendingTimers: () => {
      // Execute timers scheduled for current time (e.g., delay 0)
      const entries = Array.from(scheduled.entries());
      for (const [id, rec] of entries) {
        if (rec.time <= currentTime) {
          if (rec.type === 'timeout') {
            scheduled.delete(id);
            rec.fn();
          } else if (rec.type === 'interval') {
            rec.fn();
            rec.time = currentTime + rec.interval;
            scheduled.set(id, rec);
          }
        }
      }
    },
    advanceTimersByTime: (ms) => {
      currentTime += ms;
      runDue();
    },
    spyOn: (obj, method) => {
      const original = obj[method];
      const mock = global.jest.fn();
      obj[method] = mock;
      mock.mockRestore = () => { obj[method] = original; };
      return mock;
    }
  };
})();

// Default to fake timers before loading any tests to prevent modules that set up
// intervals on import from running real timers during the suite. Individual tests
// can opt back to real timers with jest.useRealTimers() if needed.
jest.useFakeTimers();

// Load all *.test.js files (skip integration/e2e/hierarchical heavy suites)
for (const f of fs.readdirSync(testDir)) {
  if (!f.endsWith('.test.js')) continue;
  if (f.includes('integration') || f.includes('e2e') || f.includes('hierarchical')) continue;
  require(path.join(testDir, f));
}

if (failures > 0) {
  log(`\n${failures} test(s) failed.`);
  // Exit immediately to prevent any lingering timers/intervals from keeping the process alive
  process.exit(1);
} else {
  log('\nAll tests passed.');
  // Exit immediately to prevent lingering app intervals (e.g., heartbeats) from keeping the process alive
  process.exit(0);
}
