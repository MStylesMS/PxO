'use strict';

/**
 * Input addressing, value coercion, polarity, and {{template}} interpolation
 * for the Option B logic graph.
 */

function getField(obj, ...names) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const name of names) {
    if (obj[name] !== undefined) return obj[name];
  }
  return undefined;
}

function asString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.key === 'string') {
    return value.key.startsWith(':') ? value.key.slice(1) : value.key;
  }
  return String(value);
}

function normalizeName(value) {
  return asString(value).replace(/^:/, '').trim();
}

/**
 * Coerce raw payload values to logical 0/1 when they look boolean, otherwise
 * keep numbers/strings as-is (keypad keys stay strings).
 */
function coerceValue(raw) {
  if (raw === undefined || raw === null) return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw === 0 || raw === 1) return raw;
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const lower = trimmed.toLowerCase();
    if (['0', 'false', 'off', 'low', 'inactive', 'no'].includes(lower)) return 0;
    if (['1', 'true', 'on', 'high', 'active', 'yes'].includes(lower)) return 1;
    const asNum = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(asNum) && String(asNum) === trimmed) {
      return asNum;
    }
    return trimmed;
  }
  return raw;
}

function applyPolarity(value, activeLow) {
  if (!activeLow) return value;
  if (value === 0) return 1;
  if (value === 1) return 0;
  if (value === false) return 1;
  if (value === true) return 0;
  return value;
}

function isTruthy(value) {
  if (value === undefined || value === null) return false;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  const ca = coerceValue(a);
  const cb = coerceValue(b);
  if (ca === cb) return true;
  if (typeof ca === 'number' && typeof cb === 'number') return ca === cb;
  return String(ca) === String(cb);
}

function normalizeKeyToken(value) {
  const coerced = coerceValue(value);
  const s = String(coerced).toLowerCase();
  if (s === '#' || s === 'pound' || s === 'hash') return 'pound';
  if (s === '*' || s === 'asterik' || s === 'asterisk' || s === 'star') return 'asterik';
  return coerced;
}

function keysEqual(a, b) {
  if (b === undefined || b === null || b === '') return false;
  if (valuesEqual(a, b)) return true;
  return normalizeKeyToken(a) === normalizeKeyToken(b);
}

function parseBinding(ref, defaults = {}) {
  if (ref === undefined || ref === null || ref === '') return null;

  if (typeof ref === 'object' && !Array.isArray(ref)) {
    const source = normalizeName(getField(ref, 'source', 'input'));
    const signal = normalizeName(getField(ref, 'signal', 'pin', 'key')) || null;
    const node = normalizeName(getField(ref, 'node')) || (!source ? normalizeName(getField(ref, 'name')) : '');
    const topic = typeof ref.topic === 'string' ? ref.topic.trim() : '';
    const valueKey = getField(ref, 'value-key', 'valueKey');
    const signalKey = getField(ref, 'signal-key', 'signalKey');
    const when = getField(ref, 'when', 'condition') || null;
    const activeLow = getField(ref, 'active-low', 'activeLow');
    const constValue = getField(ref, 'const', 'constant');

    if (topic && !source) {
      return {
        kind: 'topic',
        topic,
        source: null,
        signal: signal || null,
        valueKey: valueKey !== undefined ? normalizeName(valueKey) : (defaults.valueKey || 'value'),
        signalKey: signalKey !== undefined ? normalizeName(signalKey) : (defaults.signalKey || null),
        when,
        activeLow: activeLow === undefined ? defaults.activeLow : Boolean(activeLow),
        constValue: constValue === undefined ? undefined : constValue,
        raw: ref
      };
    }

    if (source) {
      return {
        kind: 'source',
        source,
        signal,
        topic: topic || null,
        valueKey: valueKey !== undefined ? normalizeName(valueKey) : (defaults.valueKey || null),
        signalKey: signalKey !== undefined ? normalizeName(signalKey) : (defaults.signalKey || null),
        when,
        activeLow: activeLow === undefined ? defaults.activeLow : Boolean(activeLow),
        constValue: constValue === undefined ? undefined : constValue,
        raw: ref
      };
    }

    if (node) {
      return {
        kind: 'node',
        node,
        source: null,
        signal: null,
        when: null,
        activeLow: false,
        raw: ref
      };
    }

    return null;
  }

  const text = normalizeName(ref);
  if (!text) return null;

  const slash = text.indexOf('/');
  if (slash > 0) {
    const head = text.slice(0, slash);
    const tail = text.slice(slash + 1);
    if (head === 'logic') {
      return { kind: 'node', node: tail, source: null, signal: null, when: null, activeLow: false, raw: ref };
    }
    return {
      kind: 'source',
      source: head,
      signal: tail,
      topic: null,
      valueKey: defaults.valueKey || null,
      signalKey: defaults.signalKey || null,
      when: null,
      activeLow: defaults.activeLow,
      constValue: undefined,
      raw: ref
    };
  }

  return { kind: 'node', node: text, source: null, signal: null, when: null, activeLow: false, raw: ref };
}

function parseBindings(refs, defaults = {}) {
  const list = Array.isArray(refs) ? refs : (refs === undefined || refs === null ? [] : [refs]);
  return list.map((ref) => parseBinding(ref, defaults)).filter(Boolean);
}

function bindingKey(binding) {
  if (!binding) return null;
  if (binding.kind === 'node') return `node:${binding.node}`;
  if (binding.kind === 'topic') {
    return `topic:${binding.topic}:${binding.signal || '*'}:${binding.valueKey || 'value'}`;
  }
  const signal = binding.signal || '*';
  const valueKey = binding.valueKey || 'default';
  return `source:${binding.source}:${signal}:${valueKey}`;
}

function signalStoreKey(sourceName, signal) {
  return `source:${sourceName}:${signal || '*'}:default`;
}

function payloadField(payload, key) {
  if (!payload || typeof payload !== 'object' || !key) return undefined;
  if (payload[key] !== undefined) return payload[key];
  const alt = String(key).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  if (alt !== key && payload[alt] !== undefined) return payload[alt];
  return undefined;
}

function matchesWhen(payload, when) {
  if (!when || typeof when !== 'object') return true;
  const entries = Object.entries(when);
  if (entries.length === 0) return true;
  for (const [key, expected] of entries) {
    const actual = payloadField(payload, key);
    if (Array.isArray(expected)) {
      if (!expected.some((candidate) => valuesEqual(actual, candidate))) return false;
    } else if (!valuesEqual(actual, expected)) {
      return false;
    }
  }
  return true;
}

function resolveActiveLow(binding, nodeDef, sourceDef) {
  if (binding && binding.activeLow !== undefined && binding.activeLow !== null) {
    return Boolean(binding.activeLow);
  }
  const nodeLevel = getField(nodeDef || {}, 'active-low', 'activeLow');
  if (nodeLevel !== undefined) return Boolean(nodeLevel);
  const sourceLevel = getField(sourceDef || {}, 'active-low', 'activeLow');
  if (sourceLevel !== undefined) return Boolean(sourceLevel);
  return false;
}

function extractBindingValue(binding, payload, sourceDef, nodeDef) {
  if (!binding) return undefined;
  if (!matchesWhen(payload, binding.when)) return undefined;
  if (binding.constValue !== undefined) {
    return binding.constValue;
  }

  const valueKey = binding.valueKey
    || normalizeName(getField(sourceDef || {}, 'value-key', 'valueKey'))
    || 'value';
  const raw = payloadField(payload, valueKey);
  if (raw === undefined && payload !== undefined && typeof payload !== 'object') {
    return applyPolarity(coerceValue(payload), resolveActiveLow(binding, nodeDef, sourceDef));
  }
  const coerced = coerceValue(raw);
  return applyPolarity(coerced, resolveActiveLow(binding, nodeDef, sourceDef));
}

function extractSignalName(payload, sourceDef, binding) {
  const signalKey = (binding && binding.signalKey)
    || normalizeName(getField(sourceDef || {}, 'signal-key', 'signalKey'))
    || 'pin';
  const raw = payloadField(payload, signalKey);
  return raw === undefined || raw === null ? null : asString(raw);
}

function interpolate(obj, context = {}) {
  if (typeof obj === 'string') {
    const exact = obj.match(/^\{\{(\w+)\}\}$/);
    if (exact && Object.prototype.hasOwnProperty.call(context, exact[1])) {
      return context[exact[1]];
    }
    return obj.replace(/\{\{(\w+)\}\}/g, (match, name) => {
      if (Object.prototype.hasOwnProperty.call(context, name)) {
        return String(context[name]);
      }
      return match;
    });
  }
  if (Array.isArray(obj)) return obj.map((item) => interpolate(item, context));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = interpolate(value, context);
    }
    return out;
  }
  return obj;
}

function isLogicSourceName(name) {
  const text = normalizeName(name);
  return text.startsWith('logic/');
}

function logicSourceNodeName(name) {
  const text = normalizeName(name);
  if (!text.startsWith('logic/')) return null;
  return text.slice('logic/'.length);
}

function virtualLogicTopic(nodeName) {
  return `__pxo/logic/${normalizeName(nodeName)}`;
}

module.exports = {
  getField,
  asString,
  normalizeName,
  coerceValue,
  applyPolarity,
  isTruthy,
  valuesEqual,
  normalizeKeyToken,
  keysEqual,
  parseBinding,
  parseBindings,
  bindingKey,
  signalStoreKey,
  payloadField,
  matchesWhen,
  resolveActiveLow,
  extractBindingValue,
  extractSignalName,
  interpolate,
  isLogicSourceName,
  logicSourceNodeName,
  virtualLogicTopic
};
