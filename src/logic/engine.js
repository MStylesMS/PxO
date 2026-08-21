'use strict';

const {
  getField,
  normalizeName,
  parseBinding,
  bindingKey,
  signalStoreKey,
  extractBindingValue,
  extractSignalName,
  interpolate,
  isTruthy,
  coerceValue,
  matchesWhen
} = require('./bindings');
const { collectNodeBindings, eventTargetsBinding } = require('./nodes');
const { buildGraph, collectMqttTopics } = require('./graph');

function cloneState(state) {
  if (!state || typeof state !== 'object') return state;
  return JSON.parse(JSON.stringify(state));
}

function outputsEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  return false;
}

class LogicEngine {
  constructor(options = {}) {
    this.logicConfig = options.logicConfig || {};
    this.inputSources = options.inputSources instanceof Map
      ? options.inputSources
      : new Map(Object.entries(options.inputSources || {}));
    this.onAction = typeof options.onAction === 'function' ? options.onAction : async () => {};
    this.onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    this.nowFn = typeof options.now === 'function' ? options.now : () => Date.now();
    this.logger = options.logger || { info() {}, warn() {}, debug() {}, error() {} };

    const built = buildGraph(this.logicConfig, { inputSources: this.inputSources });
    this.graph = built;
    this.errors = built.errors || [];
    this.warnings = built.warnings || [];

    this.values = new Map();
    this.outputs = new Map();
    this.nodeState = new Map();
    this.latched = new Set();
    this.operatorDisabled = new Set();
    this.operatorBypassed = new Set();
    this.gateState = new Map();
    this.gameplayStartedAt = null;
    this.topics = collectMqttTopics(built, this.inputSources);

    this._initStates();
    this.logger.info && this.logger.info(`[logic] Graph loaded with ${built.size} node(s)`);
  }

  static fromConfig(cfg, options = {}) {
    const logicConfig = cfg?.global?.logic || {};
    const rawSources = cfg?.global?.inputs || {};
    const inputSources = rawSources instanceof Map ? rawSources : new Map(Object.entries(rawSources));
    return new LogicEngine({ ...options, logicConfig, inputSources });
  }

  rebuild(logicConfig) {
    this.logicConfig = logicConfig || {};
    const built = buildGraph(this.logicConfig, { inputSources: this.inputSources });
    this.graph = built;
    this.errors = built.errors || [];
    this.warnings = built.warnings || [];
    this.topics = collectMqttTopics(built, this.inputSources);
    this.reset();
    return built;
  }

  _initStates() {
    this.graph.nodes.forEach((node, name) => {
      if (typeof node.impl.createState === 'function') {
        this.nodeState.set(name, node.impl.createState());
      } else {
        this.nodeState.set(name, {});
      }
      this.outputs.set(name, false);
    });
  }

  reset() {
    this.values = new Map();
    this.outputs = new Map();
    this.nodeState = new Map();
    this.latched = new Set();
    this.operatorDisabled = new Set();
    this.operatorBypassed = new Set();
    this.gateState = new Map();
    this.gameplayStartedAt = null;
    this._initStates();
    this.evaluateAll();
    this.logger.info && this.logger.info('[logic] Graph reset');
  }

  getTopics() {
    return this.topics.slice();
  }

  markGameplayStart(ts) {
    this.gameplayStartedAt = ts != null ? ts : this.nowFn();
  }

  getSnapshot() {
    const snapshot = {};
    const now = this._now();
    this.graph.order.forEach((name) => {
      const node = this.graph.nodes.get(name);
      const gate = this._resolveGateMode(name, now, { touch: false });
      snapshot[name] = {
        type: node ? node.type : undefined,
        output: this.outputs.has(name) ? this.outputs.get(name) : false,
        enabled: gate !== 'disabled',
        bypassed: gate === 'bypass'
      };
    });
    return snapshot;
  }

  sourceDef(name) {
    return this.inputSources.get(name) || null;
  }

  bindingDefaultsFor(sourceName) {
    const def = this.sourceDef(sourceName) || {};
    return {
      valueKey: normalizeName(getField(def, 'value-key', 'valueKey')) || 'value',
      signalKey: normalizeName(getField(def, 'signal-key', 'signalKey')) || 'pin',
      activeLow: getField(def, 'active-low', 'activeLow')
    };
  }

  handleMessage(topic, payload) {
    const matchingSources = [];
    this.inputSources.forEach((def, name) => {
      if (def && def.topic === topic) matchingSources.push({ name, def });
    });

    const events = [];
    const dirty = new Set();

    matchingSources.forEach(({ name, def }) => {
      const defaults = this.bindingDefaultsFor(name);
      const signal = extractSignalName(payload, def, { signalKey: defaults.signalKey });
      const defaultBinding = parseBinding({ source: name, signal, 'value-key': defaults.valueKey }, defaults);
      const defaultValue = extractBindingValue(defaultBinding, payload, def, {});
      if (signal && defaultValue !== undefined) {
        this.values.set(signalStoreKey(name, signal), defaultValue);
      }

      this.graph.nodes.forEach((node, nodeName) => {
        node.bindings.forEach((binding) => {
          if (binding.kind !== 'source' || binding.source !== name) return;
          if (binding.signal && signal && binding.signal !== signal) return;
          if (binding.when && !matchesWhen(payload, binding.when)) return;
          const value = extractBindingValue(binding, payload, def, node.def);
          if (value === undefined && binding.constValue === undefined) return;
          this.values.set(bindingKey(binding), value);
          if (signal && !binding.signal) {
            this.values.set(signalStoreKey(name, signal), value);
          }
          dirty.add(nodeName);
          events.push({
            nodeName,
            binding,
            bindingKey: bindingKey(binding),
            source: name,
            signal: binding.signal || signal,
            value,
            payload,
            topic,
            ts: this.nowFn()
          });
        });
      });
    });

    this.graph.nodes.forEach((node, nodeName) => {
      node.bindings.forEach((binding) => {
        if (binding.kind !== 'topic' || binding.topic !== topic) return;
        if (binding.when && !matchesWhen(payload, binding.when)) return;
        let value;
        if (binding.constValue !== undefined) {
          value = binding.constValue;
        } else if (binding.valueKey) {
          value = extractBindingValue(binding, payload, {}, node.def);
        } else if (payload && typeof payload === 'object' && Object.keys(payload).length === 0) {
          value = true;
        } else if (payload === undefined || payload === null) {
          value = true;
        } else {
          const field = getField(node.def, 'value-key', 'valueKey');
          value = field ? extractBindingValue({ ...binding, valueKey: normalizeName(field) }, payload, {}, node.def) : payload;
        }
        if (value === undefined) value = true;
        this.values.set(bindingKey(binding), value);
        dirty.add(nodeName);
        events.push({
          nodeName,
          binding,
          bindingKey: bindingKey(binding),
          source: null,
          signal: binding.signal || null,
          value,
          payload,
          topic,
          ts: this.nowFn()
        });
      });
    });

    if (dirty.size === 0 && matchingSources.length > 0) {
      this.graph.nodes.forEach((node, nodeName) => {
        if (node.bindings.some((b) => b.kind === 'source' && matchingSources.some((s) => s.name === b.source))) {
          dirty.add(nodeName);
        }
      });
    }

    return this._evaluateDirty(dirty, events);
  }

  tick(now) {
    this._nowOverride = now;
    const dirty = new Set();
    this.graph.nodes.forEach((node, name) => {
      if (node.type === 'timeout' || node.type === 'threshold' || node.type === 'combo-lock-discrete' || node.type === 'time-bonus') {
        dirty.add(name);
      }
      if (getField(node.def, 'enable-after', 'enableAfter')
          || getField(node.def, 'enable-delay-ms', 'enableDelayMs')
          || getField(node.def, 'bypass-delay-ms', 'bypassDelayMs')
          || getField(node.def, 'disable-after', 'disableAfter')) {
        dirty.add(name);
      }
    });
    const changes = this._evaluateDirty(dirty, []);
    this._nowOverride = undefined;
    return changes;
  }

  async forceSolve(nodeName) {
    const name = normalizeName(nodeName);
    const node = this.graph.nodes.get(name);
    if (!node) return false;
    const previous = this.outputs.get(name);
    this.outputs.set(name, true);
    if (getField(node.def, 'latch') === true) this.latched.add(name);
    const changes = await this._propagateFrom(name, previous, true, true);
    return changes;
  }

  async forceReset(nodeName) {
    const name = normalizeName(nodeName);
    const node = this.graph.nodes.get(name);
    if (!node) return false;
    this.latched.delete(name);
    this.operatorDisabled.delete(name);
    this.operatorBypassed.delete(name);
    this.gateState.delete(name);
    if (typeof node.impl.createState === 'function') {
      this.nodeState.set(name, node.impl.createState());
    } else {
      this.nodeState.set(name, {});
    }
    const previous = this.outputs.get(name);
    this.outputs.set(name, false);
    return this._propagateFrom(name, previous, false, false);
  }

  async forceDisable(nodeName) {
    const name = normalizeName(nodeName);
    if (!this.graph.nodes.has(name)) return false;
    this.operatorDisabled.add(name);
    this.operatorBypassed.delete(name);
    const previous = this.outputs.get(name);
    const output = this.latched.has(name) ? previous : false;
    return this._propagateFrom(name, previous, output, false);
  }

  async forceEnable(nodeName) {
    const name = normalizeName(nodeName);
    if (!this.graph.nodes.has(name)) return false;
    this.operatorDisabled.delete(name);
    return this._evaluateDirty(new Set([name]), []);
  }

  async forceBypass(nodeName) {
    const name = normalizeName(nodeName);
    const node = this.graph.nodes.get(name);
    if (!node) return false;
    this.operatorDisabled.delete(name);
    this.operatorBypassed.add(name);
    const previous = this.outputs.get(name);
    if (getField(node.def, 'latch') === true) this.latched.add(name);
    return this._propagateFrom(name, previous, true, true);
  }

  evaluateAll() {
    return this._evaluateDirty(new Set(this.graph.order), []);
  }

  _now() {
    return this._nowOverride !== undefined ? this._nowOverride : this.nowFn();
  }

  _getInput(binding) {
    if (!binding) return undefined;
    if (binding.kind === 'node') return this.outputs.get(binding.node);
    const key = bindingKey(binding);
    if (this.values.has(key)) return this.values.get(key);
    if (binding.kind === 'source' && binding.signal) {
      const fallback = signalStoreKey(binding.source, binding.signal);
      if (this.values.has(fallback)) return this.values.get(fallback);
    }
    return undefined;
  }

  _getGateState(name) {
    if (!this.gateState.has(name)) {
      this.gateState.set(name, { enableSince: 0, bypassSince: 0 });
    }
    return this.gateState.get(name);
  }

  _resolveRef(val) {
    if (val === undefined || val === null || typeof val === 'boolean') return val;
    const binding = parseBinding(val);
    if (!binding) return undefined;
    if (binding.kind === 'node') return this.outputs.get(binding.node);
    return this._getInput(binding);
  }

  _resolveGateMode(name, now, options = {}) {
    const touch = options.touch !== false;
    const node = this.graph.nodes.get(name);
    if (!node) return 'active';
    const def = node.def;
    const gs = this._getGateState(name);
    const delayEnable = Number(getField(def, 'enable-delay-ms', 'enableDelayMs')) || 0;
    const delayBypass = Number(getField(def, 'bypass-delay-ms', 'bypassDelayMs')) || 0;

    if (this.operatorDisabled.has(name)) {
      if (touch) gs.enableSince = 0;
      return 'disabled';
    }

    const disableAfter = getField(def, 'disable-after', 'disableAfter');
    if (disableAfter !== undefined && isTruthy(this._resolveRef(disableAfter))) {
      return 'disabled';
    }

    const enabledField = getField(def, 'enabled');
    if (enabledField === false) {
      if (touch) gs.enableSince = 0;
      return 'disabled';
    }
    if (enabledField !== undefined && enabledField !== true && !isTruthy(this._resolveRef(enabledField))) {
      if (touch) gs.enableSince = 0;
      return 'disabled';
    }

    const enableAfter = getField(def, 'enable-after', 'enableAfter');
    if (enableAfter !== undefined) {
      if (!isTruthy(this._resolveRef(enableAfter))) {
        if (touch) gs.enableSince = 0;
        return 'disabled';
      }
      if (touch && !gs.enableSince) gs.enableSince = now;
      const since = gs.enableSince || now;
      if ((now - since) < delayEnable) return 'disabled';
    }

    const bypassField = getField(def, 'bypass');
    let bypassWanted = this.operatorBypassed.has(name);
    if (!bypassWanted && bypassField === true) bypassWanted = true;
    if (!bypassWanted && bypassField !== undefined && bypassField !== false && bypassField !== true) {
      bypassWanted = isTruthy(this._resolveRef(bypassField));
    }
    if (bypassWanted) {
      if (this.operatorBypassed.has(name)) return 'bypass';
      if (touch && !gs.bypassSince) gs.bypassSince = now;
      const since = gs.bypassSince || now;
      if ((now - since) >= delayBypass) return 'bypass';
    } else if (touch) {
      gs.bypassSince = 0;
    }

    return 'active';
  }

  _evaluateNode(name, event) {
    const node = this.graph.nodes.get(name);
    if (!node) return this.outputs.get(name);
    const now = this._now();
    const gate = this._resolveGateMode(name, now);
    if (gate === 'disabled') {
      if (this.latched.has(name)) return this.outputs.get(name);
      return false;
    }
    if (gate === 'bypass') {
      if (getField(node.def, 'latch') === true) this.latched.add(name);
      return true;
    }
    const defaults = {};
    const ctx = {
      name,
      node: node.def,
      bindingDefaults: defaults,
      getInput: (binding) => this._getInput(binding),
      getNodeOutput: (other) => this.outputs.get(other),
      state: this.nodeState.get(name),
      event: event || null,
      now,
      gameplayStartedAt: this.gameplayStartedAt
    };
    const result = node.impl.evaluate(node.def, ctx) || { output: false };
    if (result.state !== undefined) this.nodeState.set(name, result.state);
    let output = result.output;
    if (this.latched.has(name) && !isTruthy(output)) {
      output = this.outputs.get(name);
    }
    if (getField(node.def, 'latch') === true && isTruthy(output)) {
      this.latched.add(name);
    }
    return output;
  }

  async _evaluateDirty(dirty, events) {
    const changes = [];
    const eventByNode = new Map();
    events.forEach((event) => {
      if (!eventByNode.has(event.nodeName)) eventByNode.set(event.nodeName, []);
      eventByNode.get(event.nodeName).push(event);
    });

    const pending = new Set(dirty);
    this.graph.order.forEach((name) => {
      const node = this.graph.nodes.get(name);
      if (!node) return;
      if (node.deps.some((dep) => pending.has(dep))) pending.add(name);
    });

    for (const name of this.graph.order) {
      if (!pending.has(name)) continue;
      const nodeEvents = eventByNode.get(name) || [];
      const previous = this.outputs.has(name) ? this.outputs.get(name) : false;
      let output = previous;
      if (nodeEvents.length > 0) {
        for (const event of nodeEvents) {
          output = this._evaluateNode(name, event);
        }
      } else {
        output = this._evaluateNode(name, null);
      }

      const node = this.graph.nodes.get(name);
      if (getField(node.def, 'latch') === true && this.latched.has(name)) {
        output = isTruthy(output) ? output : previous;
        if (!isTruthy(output)) output = previous;
      }

      if (!outputsEqual(previous, output)) {
        this.outputs.set(name, output);
        const change = {
          node: name,
          type: node.type,
          previous,
          output,
          value: output
        };
        changes.push(change);
        await this._dispatch(node, change);
        this.onChange(change);
      } else {
        this.outputs.set(name, output);
      }
    }

    return changes;
  }

  async _propagateFrom(name, previous, output, fireTrue) {
    this.outputs.set(name, output);
    const node = this.graph.nodes.get(name);
    const change = { node: name, type: node.type, previous, output, value: output };
    if (fireTrue && !outputsEqual(previous, output)) {
      await this._dispatch(node, change);
      this.onChange(change);
    } else if (!outputsEqual(previous, output)) {
      await this._dispatch(node, change);
      this.onChange(change);
    }
    const dirty = new Set();
    this.graph.nodes.forEach((other, otherName) => {
      if (other.deps.includes(name)) dirty.add(otherName);
    });
    const downstream = await this._evaluateDirty(dirty, []);
    return [change, ...downstream];
  }

  async _dispatch(node, change) {
    const becameTrue = !isTruthy(change.previous) && isTruthy(change.output);
    const becameFalse = isTruthy(change.previous) && !isTruthy(change.output);
    const context = {
      value: change.output,
      output: change.output,
      previous: change.previous,
      node: change.node
    };

    const run = async (list, label) => {
      const actions = Array.isArray(list) ? list : [];
      for (const action of actions) {
        try {
          await this.onAction(interpolate(action, context), {
            node: change.node,
            reason: label,
            ...context
          });
        } catch (err) {
          this.logger.error && this.logger.error(`[logic] Action failed for ${change.node} (${label}): ${err.message}`);
        }
      }
    };

    if (becameTrue) await run(getField(node.def, 'on-true', 'onTrue'), 'on-true');
    if (becameFalse) await run(getField(node.def, 'on-false', 'onFalse'), 'on-false');
    await run(getField(node.def, 'on-change', 'onChange'), 'on-change');
  }
}

function sourceUsesTopic(engine, topic) {
  let found = false;
  engine.inputSources.forEach((def) => {
    if (def && def.topic === topic) found = true;
  });
  return found;
}

module.exports = {
  LogicEngine,
  sourceUsesTopic,
  collectNodeBindings,
  eventTargetsBinding
};
