'use strict';

const {
  getField,
  normalizeName,
  coerceValue,
  isTruthy,
  valuesEqual,
  keysEqual,
  parseBinding,
  parseBindings
} = require('./bindings');

function nodeTypeName(node) {
  return normalizeName(getField(node || {}, 'type'));
}

function targetMap(node) {
  const target = getField(node, 'target');
  if (!target || typeof target !== 'object' || Array.isArray(target)) return {};
  const out = {};
  Object.entries(target).forEach(([key, value]) => {
    out[normalizeName(key)] = coerceValue(value);
  });
  return out;
}

function targetVector(node) {
  const target = getField(node, 'target');
  if (!Array.isArray(target)) return [];
  return target.map((item) => coerceValue(item));
}

function bindingSignalName(binding) {
  if (!binding) return '';
  if (binding.signal) return binding.signal;
  if (binding.node) return binding.node;
  if (binding.source) return binding.source;
  return '';
}

function readInput(ctx, binding) {
  if (!binding) return undefined;
  if (binding.kind === 'node') return ctx.getNodeOutput(binding.node);
  return ctx.getInput(binding);
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compareOp(op, actual, expected) {
  const a = numeric(actual);
  const b = numeric(expected);
  if (a === null || b === null) {
    if (op === 'eq') return valuesEqual(actual, expected);
    return false;
  }
  switch (op) {
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    case 'eq': return a === b;
    default: return a >= b;
  }
}

const NODE_TYPES = {};

NODE_TYPES.match = {
  kind: 'level',
  required: ['inputs', 'target'],
  evaluate(node, ctx) {
    const bindings = parseBindings(getField(node, 'inputs'), ctx.bindingDefaults);
    const target = targetMap(node);
    if (bindings.length === 0) return { output: false };
    let allSeen = true;
    let allMatch = true;
    for (const binding of bindings) {
      const key = bindingSignalName(binding);
      if (!(key in target)) {
        allMatch = false;
        break;
      }
      const current = readInput(ctx, binding);
      if (current === undefined) {
        allSeen = false;
        allMatch = false;
        break;
      }
      if (!valuesEqual(current, target[key])) {
        allMatch = false;
        break;
      }
    }
    return { output: allSeen && allMatch };
  }
};

NODE_TYPES.sequence = {
  kind: 'event',
  required: ['input', 'target'],
  createState() {
    return { buffer: [], lastTs: 0, matched: false };
  },
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const target = targetVector(node);
    const matchLast = Boolean(getField(node, 'match-last', 'matchLast'));
    const resetOnWrong = getField(node, 'reset-on-wrong', 'resetOnWrong');
    const shouldReset = resetOnWrong === undefined ? true : Boolean(resetOnWrong);
    const timeoutRaw = getField(node, 'timeout-ms', 'timeoutMs');
    const timeoutMs = timeoutRaw === undefined || timeoutRaw === null || timeoutRaw === ''
      ? 0
      : Number(timeoutRaw) || 0;
    const enter = getField(node, 'enter');
    const resetKey = getField(node, 'reset');
    const hasEnter = enter !== undefined && enter !== null && enter !== '';
    const hasReset = resetKey !== undefined && resetKey !== null && resetKey !== '';
    const state = ctx.state || { buffer: [], lastTs: 0, matched: false };
    const now = ctx.now || Date.now();

    let buffer = Array.isArray(state.buffer) ? state.buffer.slice() : [];
    let matched = Boolean(state.matched);
    if (timeoutMs > 0 && state.lastTs && (now - state.lastTs) > timeoutMs) {
      buffer = [];
      if (hasEnter) matched = false;
    }

    const sawEvent = ctx.event && binding && eventTargetsBinding(ctx.event, binding) && ctx.event.value !== undefined;
    if (sawEvent) {
      const value = coerceValue(ctx.event.value);
      if (hasReset && keysEqual(value, resetKey)) {
        buffer = [];
        matched = false;
      } else if (hasEnter && keysEqual(value, enter)) {
        matched = target.length > 0 && buffer.length === target.length && target.every((item, i) => valuesEqual(buffer[i], item));
        if (!matched && shouldReset) buffer = [];
        if (matched) buffer = [];
      } else if (matchLast && !hasEnter) {
        buffer.push(value);
        if (buffer.length > target.length) {
          buffer = buffer.slice(buffer.length - target.length);
        }
      } else if (hasEnter) {
        buffer.push(value);
        matched = false;
      } else if (target.length === 0) {
        buffer = [];
      } else {
        const expected = target[buffer.length];
        if (valuesEqual(value, expected)) {
          buffer.push(value);
        } else if (shouldReset) {
          buffer = valuesEqual(value, target[0]) ? [value] : [];
        }
      }
    }

    let output;
    if (hasEnter) {
      output = matched;
    } else {
      output = target.length > 0 && buffer.length === target.length && target.every((item, i) => valuesEqual(buffer[i], item));
    }

    return { output, state: { buffer, lastTs: sawEvent ? now : (state.lastTs || 0), matched } };
  }
};

NODE_TYPES.eq = {
  kind: 'level',
  required: ['input', 'value'],
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const expected = coerceValue(getField(node, 'value'));
    const current = readInput(ctx, binding);
    if (current === undefined) return { output: false };
    return { output: valuesEqual(current, expected) };
  }
};

NODE_TYPES['code-match'] = {
  kind: 'level',
  required: ['input', 'target'],
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const ignoreCase = Boolean(getField(node, 'ignore-case', 'ignoreCase'));
    const expected = String(getField(node, 'target') ?? '').trim();
    const current = readInput(ctx, binding);
    if (current === undefined || current === null) return { output: false };
    let actual = String(current).trim();
    let target = expected;
    if (ignoreCase) {
      actual = actual.toLowerCase();
      target = target.toLowerCase();
    }
    return { output: actual === target };
  }
};

NODE_TYPES['any-of'] = {
  kind: 'level',
  required: ['inputs'],
  evaluate(node, ctx) {
    const bindings = parseBindings(getField(node, 'inputs'), ctx.bindingDefaults);
    return { output: bindings.some((binding) => isTruthy(readInput(ctx, binding))) };
  }
};

NODE_TYPES['all-of'] = {
  kind: 'level',
  required: ['inputs'],
  evaluate(node, ctx) {
    const bindings = parseBindings(getField(node, 'inputs'), ctx.bindingDefaults);
    if (bindings.length === 0) return { output: false };
    return { output: bindings.every((binding) => isTruthy(readInput(ctx, binding))) };
  }
};

NODE_TYPES['none-of'] = {
  kind: 'level',
  required: ['inputs'],
  evaluate(node, ctx) {
    const bindings = parseBindings(getField(node, 'inputs'), ctx.bindingDefaults);
    return { output: bindings.every((binding) => !isTruthy(readInput(ctx, binding))) };
  }
};

NODE_TYPES['count-true'] = {
  kind: 'level',
  required: ['inputs'],
  evaluate(node, ctx) {
    const bindings = parseBindings(getField(node, 'inputs'), ctx.bindingDefaults);
    const count = bindings.reduce((sum, binding) => sum + (isTruthy(readInput(ctx, binding)) ? 1 : 0), 0);
    return { output: count };
  }
};

NODE_TYPES['count-false'] = {
  kind: 'level',
  required: ['inputs'],
  evaluate(node, ctx) {
    const bindings = parseBindings(getField(node, 'inputs'), ctx.bindingDefaults);
    const count = bindings.reduce((sum, binding) => sum + (isTruthy(readInput(ctx, binding)) ? 0 : 1), 0);
    return { output: count };
  }
};

function parseWeightedInputs(inputs, defaults = {}) {
  const list = Array.isArray(inputs) ? inputs : (inputs === undefined || inputs === null ? [] : [inputs]);
  return list.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && (getField(item, 'input') !== undefined || getField(item, 'weight') !== undefined)) {
      const binding = parseBinding(getField(item, 'input') !== undefined ? getField(item, 'input') : item, defaults);
      const weight = Number(getField(item, 'weight') ?? 1);
      return { binding, weight: Number.isFinite(weight) ? weight : 1 };
    }
    return { binding: parseBinding(item, defaults), weight: 1 };
  }).filter((entry) => entry.binding);
}

NODE_TYPES.sum = {
  kind: 'level',
  required: ['inputs'],
  extraBindings(node, defaults) {
    return parseWeightedInputs(getField(node, 'inputs'), defaults).map((entry) => entry.binding);
  },
  evaluate(node, ctx) {
    const entries = parseWeightedInputs(getField(node, 'inputs'), ctx.bindingDefaults);
    const total = entries.reduce((sum, entry) => {
      const raw = readInput(ctx, entry.binding);
      if (raw === undefined || raw === null) return sum;
      const n = numeric(raw);
      const value = n === null ? (isTruthy(raw) ? 1 : 0) : n;
      return sum + (value * entry.weight);
    }, 0);
    return { output: total };
  }
};

NODE_TYPES.clamp = {
  kind: 'level',
  required: ['input'],
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const minRaw = getField(node, 'min');
    const maxRaw = getField(node, 'max');
    const current = numeric(readInput(ctx, binding));
    if (current === null) return { output: minRaw !== undefined ? Number(minRaw) || 0 : 0 };
    let out = current;
    if (minRaw !== undefined && Number.isFinite(Number(minRaw))) out = Math.max(Number(minRaw), out);
    if (maxRaw !== undefined && Number.isFinite(Number(maxRaw))) out = Math.min(Number(maxRaw), out);
    return { output: out };
  }
};

NODE_TYPES.scale = {
  kind: 'level',
  required: ['input', 'in-max', 'out-max'],
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const inMin = Number(getField(node, 'in-min', 'inMin') ?? 0);
    const inMax = Number(getField(node, 'in-max', 'inMax'));
    const outMin = Number(getField(node, 'out-min', 'outMin') ?? 0);
    const outMax = Number(getField(node, 'out-max', 'outMax'));
    const current = numeric(readInput(ctx, binding));
    if (current === null || !Number.isFinite(inMax) || inMax === inMin || !Number.isFinite(outMax)) {
      return { output: outMin };
    }
    const ratio = (current - inMin) / (inMax - inMin);
    const scaled = ratio * (outMax - outMin) + outMin;
    const lo = Math.min(outMin, outMax);
    const hi = Math.max(outMin, outMax);
    const clamped = Math.max(lo, Math.min(hi, scaled));
    return { output: Math.floor(clamped) };
  }
};

NODE_TYPES.passthrough = {
  kind: 'level',
  required: ['input'],
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const current = readInput(ctx, binding);
    if (current === undefined) return { output: false };
    return { output: current };
  }
};

NODE_TYPES['mqtt-input'] = {
  kind: 'level',
  required: [],
  evaluate(node, ctx) {
    const binding = parseBinding({
      source: getField(node, 'source'),
      topic: getField(node, 'topic'),
      'value-key': getField(node, 'value-key', 'valueKey'),
      when: getField(node, 'when'),
      signal: getField(node, 'signal')
    }, ctx.bindingDefaults);
    const current = readInput(ctx, binding);
    if (current === undefined) return { output: false };
    return { output: current };
  }
};

NODE_TYPES.threshold = {
  kind: 'level',
  required: ['input'],
  createState() {
    return { since: 0 };
  },
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const holdMs = Number(getField(node, 'hold-ms', 'holdMs')) || 0;
    const current = readInput(ctx, binding);
    const minRaw = getField(node, 'min');
    const maxRaw = getField(node, 'max');
    const hasRange = minRaw !== undefined || maxRaw !== undefined;
    let met = false;
    if (current !== undefined) {
      if (hasRange) {
        const n = numeric(current);
        if (n !== null) {
          const minOk = minRaw === undefined || n >= Number(minRaw);
          const maxOk = maxRaw === undefined || n <= Number(maxRaw);
          met = minOk && maxOk;
          if (Boolean(getField(node, 'outside'))) met = !met;
        }
      } else {
        const op = normalizeName(getField(node, 'op') || 'gte') || 'gte';
        const expected = getField(node, 'value');
        met = compareOp(op, current, expected);
      }
    }
    const now = ctx.now || Date.now();
    const state = ctx.state || { since: 0 };
    if (!met) return { output: false, state: { since: 0 } };
    const since = state.since || now;
    const held = holdMs <= 0 || (now - since) >= holdMs;
    return { output: held, state: { since } };
  }
};

NODE_TYPES.timeout = {
  kind: 'level',
  required: ['start', 'duration-ms'],
  createState() {
    return { startedAt: 0 };
  },
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'start', 'start-event', 'startEvent'), ctx.bindingDefaults);
    const durationMs = Number(getField(node, 'duration-ms', 'durationMs'));
    const resetOnFalse = getField(node, 'reset-on-false', 'resetOnFalse');
    const shouldReset = resetOnFalse === undefined ? true : Boolean(resetOnFalse);
    const armed = isTruthy(readInput(ctx, binding));
    const now = ctx.now || Date.now();
    const state = ctx.state || { startedAt: 0 };

    if (!armed) {
      if (shouldReset) return { output: false, state: { startedAt: 0 } };
      if (!state.startedAt) return { output: false, state };
      return { output: (now - state.startedAt) >= durationMs, state };
    }

    const startedAt = state.startedAt || now;
    return { output: Number.isFinite(durationMs) && (now - startedAt) >= durationMs, state: { startedAt } };
  }
};

NODE_TYPES['time-bonus'] = {
  kind: 'level',
  required: ['input', 'max', 'decay-ms'],
  createState() {
    return { locked: null, startAt: 0 };
  },
  extraBindings(node, defaults) {
    const bindings = [];
    const input = parseBinding(getField(node, 'input'), defaults);
    if (input) bindings.push(input);
    const start = getField(node, 'start');
    const startName = normalizeName(start || 'gameplay');
    if (startName && startName !== 'gameplay') {
      const parsed = parseBinding(start, defaults);
      if (parsed) bindings.push(parsed);
    }
    return bindings;
  },
  evaluate(node, ctx) {
    const inputBinding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const startName = normalizeName(getField(node, 'start') || 'gameplay') || 'gameplay';
    const max = Number(getField(node, 'max'));
    const decayMs = Number(getField(node, 'decay-ms', 'decayMs')) || 1;
    const state = ctx.state || { locked: null, startAt: 0 };
    const now = ctx.now || Date.now();

    let startAt = state.startAt || 0;
    if (startName === 'gameplay') {
      if (ctx.gameplayStartedAt == null) {
        return { output: 0, state: { locked: null, startAt: 0 } };
      }
      startAt = ctx.gameplayStartedAt;
    } else if (isTruthy(ctx.getNodeOutput(startName) || readInput(ctx, parseBinding(getField(node, 'start'), ctx.bindingDefaults)))) {
      startAt = startAt || now;
    } else {
      startAt = 0;
    }

    if (state.locked !== null && state.locked !== undefined) {
      return { output: state.locked, state: { locked: state.locked, startAt } };
    }

    const started = startName === 'gameplay' ? ctx.gameplayStartedAt != null : startAt > 0;
    if (!isTruthy(readInput(ctx, inputBinding)) || !started) {
      return { output: 0, state: { locked: null, startAt } };
    }

    const elapsed = Math.max(0, now - startAt);
    const bonus = (Number.isFinite(max) ? max : 0) * Math.max(0, 1 - (elapsed / decayMs));
    const locked = Number.isInteger(max) ? Math.round(bonus) : bonus;
    return { output: locked, state: { locked, startAt } };
  }
};

NODE_TYPES['combo-lock'] = {
  kind: 'event',
  required: ['input', 'target'],
  createState() {
    return {
      lastValue: undefined,
      lastTs: 0,
      direction: 0,
      extreme: undefined,
      nextIndex: 0
    };
  },
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const target = targetVector(node).map((item) => numeric(item)).filter((n) => n !== null);
    const jitter = Number(getField(node, 'jitter-tolerance', 'jitterTolerance') ?? 2);
    const accuracy = Number(getField(node, 'direction-accuracy', 'directionAccuracy') ?? 1);
    const debounceMs = Number(getField(node, 'debounce-ms', 'debounceMs')) || 0;
    const resetOnWrong = getField(node, 'reset-on-wrong', 'resetOnWrong');
    const shouldReset = resetOnWrong === undefined ? true : Boolean(resetOnWrong);
    const state = { ...(ctx.state || NODE_TYPES['combo-lock'].createState()) };
    const now = ctx.now || Date.now();

    if (ctx.event && binding && eventTargetsBinding(ctx.event, binding)) {
      const value = numeric(ctx.event.value);
      if (value !== null) {
        if (debounceMs > 0 && state.lastTs && (now - state.lastTs) < debounceMs) {
          return { output: state.nextIndex >= target.length && target.length > 0, state };
        }
        if (state.lastValue === undefined) {
          state.lastValue = value;
          state.extreme = value;
          state.lastTs = now;
        } else {
          const delta = value - state.lastValue;
          if (delta !== 0) {
            const newDir = delta > 0 ? 1 : -1;
            if (state.direction === 0) {
              state.direction = newDir;
              state.extreme = value;
            } else if (newDir === state.direction) {
              state.extreme = newDir > 0
                ? Math.max(state.extreme, value)
                : Math.min(state.extreme, value);
            } else {
              const excursion = Math.abs(value - state.extreme);
              if (excursion > jitter) {
                const stop = state.extreme;
                const expected = target[state.nextIndex];
                if (expected !== undefined && Math.abs(stop - expected) <= accuracy) {
                  state.nextIndex += 1;
                } else if (shouldReset) {
                  state.nextIndex = 0;
                }
                state.direction = newDir;
                state.extreme = value;
              }
            }
            state.lastValue = value;
            state.lastTs = now;
          }
        }
      }
    }

    return {
      output: target.length > 0 && state.nextIndex >= target.length,
      state
    };
  }
};

NODE_TYPES['combo-lock-discrete'] = {
  kind: 'event',
  required: ['input', 'target'],
  createState() {
    return {
      lastValue: undefined,
      lastTs: 0,
      heldSince: 0,
      pending: undefined,
      pendingDir: 0,
      lastStop: undefined,
      lastDir: 0,
      nextIndex: 0
    };
  },
  evaluate(node, ctx) {
    const binding = parseBinding(getField(node, 'input'), ctx.bindingDefaults);
    const target = targetVector(node).map((item) => numeric(item)).filter((n) => n !== null);
    const dwellMs = Number(getField(node, 'dwell-ms', 'dwellMs') ?? 400);
    const debounceMs = Number(getField(node, 'debounce-ms', 'debounceMs') ?? 80);
    const resetOnWrong = getField(node, 'reset-on-wrong', 'resetOnWrong');
    const shouldReset = resetOnWrong === undefined ? true : Boolean(resetOnWrong);
    const requireDirection = Boolean(getField(node, 'require-direction', 'requireDirection'));
    const accuracy = Number(getField(node, 'direction-accuracy', 'directionAccuracy') ?? 0);
    const state = { ...(ctx.state || NODE_TYPES['combo-lock-discrete'].createState()) };
    const now = ctx.now || Date.now();

    const commitPending = (leavingValue, leavingDir) => {
      if (state.pending === undefined) return;
      const held = state.heldSince && (now - state.heldSince) >= dwellMs;
      if (!held) {
        state.pending = undefined;
        return;
      }
      const stop = state.pending;
      const dir = leavingDir || state.pendingDir || 0;
      if (requireDirection && state.lastStop !== undefined && dir === state.lastDir && dir !== 0) {
        if (shouldReset) state.nextIndex = 0;
      } else {
        const expected = target[state.nextIndex];
        if (expected !== undefined && Math.abs(stop - expected) <= accuracy) {
          state.nextIndex += 1;
          state.lastStop = stop;
          state.lastDir = dir;
        } else if (shouldReset) {
          state.nextIndex = 0;
          state.lastStop = stop;
          state.lastDir = dir;
        }
      }
      state.pending = undefined;
    };

    if (ctx.event && binding && eventTargetsBinding(ctx.event, binding)) {
      const value = numeric(ctx.event.value);
      if (value !== null) {
        if (debounceMs > 0 && state.lastTs && (now - state.lastTs) < debounceMs && value === state.lastValue) {
          return { output: state.nextIndex >= target.length && target.length > 0, state };
        }
        if (state.lastValue === undefined) {
          state.lastValue = value;
          state.pending = value;
          state.heldSince = now;
          state.lastTs = now;
        } else if (value === state.lastValue) {
          if (state.pending === undefined) {
            state.pending = value;
            state.heldSince = now;
          }
          state.lastTs = now;
        } else {
          const dir = value > state.lastValue ? 1 : -1;
          commitPending(state.lastValue, dir);
          state.pending = value;
          state.pendingDir = dir;
          state.heldSince = now;
          state.lastValue = value;
          state.lastTs = now;
        }
      }
    } else if (state.pending !== undefined && dwellMs > 0 && state.heldSince && (now - state.heldSince) >= dwellMs) {
      // dwell reached but we commit on leave; nothing to do until they move
    }

    return {
      output: target.length > 0 && state.nextIndex >= target.length,
      state
    };
  }
};

function eventTargetsBinding(event, binding) {
  if (!event || !binding) return false;
  if (event.bindingKey && event.binding && event.binding.kind === binding.kind) {
    if (binding.kind === 'node') return event.binding.node === binding.node;
    if (binding.kind === 'topic') return event.binding.topic === binding.topic;
    if (binding.source && event.binding.source !== binding.source) return false;
    if (binding.signal && event.signal && binding.signal !== event.signal) return false;
    if (binding.signal && !event.signal && event.binding.signal && binding.signal !== event.binding.signal) return false;
    return true;
  }
  if (binding.kind === 'source') {
    if (event.source && event.source !== binding.source) return false;
    if (binding.signal && event.signal && binding.signal !== event.signal) return false;
    return true;
  }
  if (binding.kind === 'topic') {
    return event.topic === binding.topic;
  }
  return false;
}

function getNodeType(typeName) {
  const name = normalizeName(typeName);
  return NODE_TYPES[name] || null;
}

function listNodeTypes() {
  return Object.keys(NODE_TYPES);
}

function collectGateBindings(node, defaults = {}) {
  const bindings = [];
  const maybe = (val) => {
    if (val === undefined || val === null || typeof val === 'boolean') return;
    const parsed = parseBinding(val, defaults);
    if (parsed) bindings.push(parsed);
  };
  maybe(getField(node, 'enabled'));
  maybe(getField(node, 'enable-after', 'enableAfter'));
  maybe(getField(node, 'disable-after', 'disableAfter'));
  const bypass = getField(node, 'bypass');
  maybe(bypass);
  return bindings;
}

function collectNodeBindings(node, defaults = {}) {
  const type = nodeTypeName(node);
  const impl = getNodeType(type);
  const bindings = [];
  const inputs = getField(node, 'inputs');
  const input = getField(node, 'input');
  const start = getField(node, 'start', 'start-event', 'startEvent');
  if (type === 'sum') {
    bindings.push(...parseWeightedInputs(inputs, defaults).map((entry) => entry.binding));
  } else if (inputs !== undefined) {
    bindings.push(...parseBindings(inputs, defaults));
  }
  if (input !== undefined) {
    const parsed = parseBinding(input, defaults);
    if (parsed) bindings.push(parsed);
  }
  if (start !== undefined && !(type === 'time-bonus' && normalizeName(start) === 'gameplay')) {
    const parsed = parseBinding(start, defaults);
    if (parsed) bindings.push(parsed);
  }
  if (type === 'mqtt-input') {
    const parsed = parseBinding({
      source: getField(node, 'source'),
      topic: getField(node, 'topic'),
      'value-key': getField(node, 'value-key', 'valueKey'),
      when: getField(node, 'when'),
      signal: getField(node, 'signal')
    }, defaults);
    if (parsed) bindings.push(parsed);
  }
  bindings.push(...collectGateBindings(node, defaults));
  if (impl && typeof impl.extraBindings === 'function') {
    bindings.push(...impl.extraBindings(node, defaults));
  }
  return bindings.filter(Boolean);
}

module.exports = {
  NODE_TYPES,
  getNodeType,
  listNodeTypes,
  nodeTypeName,
  collectNodeBindings,
  eventTargetsBinding
};
