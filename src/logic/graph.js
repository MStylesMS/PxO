'use strict';

const { getField, normalizeName } = require('./bindings');
const { getNodeType, nodeTypeName, collectNodeBindings, listNodeTypes } = require('./nodes');

function nodeNamesFromConfig(logicConfig) {
  if (!logicConfig || typeof logicConfig !== 'object' || Array.isArray(logicConfig)) return [];
  return Object.keys(logicConfig).filter((name) => name && !name.startsWith('_') && logicConfig[name] && typeof logicConfig[name] === 'object');
}

function dependencyNames(node, defaults) {
  const names = new Set();
  collectNodeBindings(node, defaults).forEach((binding) => {
    if (binding.kind === 'node' && binding.node) names.add(binding.node);
  });
  return [...names];
}

function buildGraph(logicConfig, options = {}) {
  const inputSources = options.inputSources || {};
  const errors = [];
  const warnings = [];
  const nodes = new Map();
  const names = nodeNamesFromConfig(logicConfig);

  names.forEach((name) => {
    const def = logicConfig[name];
    const type = nodeTypeName(def);
    const impl = getNodeType(type);
    if (!type) {
      errors.push({ node: name, message: `Logic node '${name}' is missing :type` });
      return;
    }
    if (!impl) {
      errors.push({
        node: name,
        message: `Logic node '${name}' has unknown type '${type}'. Supported: ${listNodeTypes().join(', ')}`
      });
      return;
    }

    const required = impl.required || [];
    required.forEach((field) => {
      if (getField(def, field, field.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())) === undefined) {
        errors.push({ node: name, message: `Logic node '${name}' of type '${type}' requires :${field}` });
      }
    });

    if ((type === 'any-of' || type === 'all-of' || type === 'none-of' || type === 'count-true' || type === 'count-false' || type === 'sum' || type === 'match')
        && (!Array.isArray(getField(def, 'inputs')) || getField(def, 'inputs').length === 0)) {
      errors.push({ node: name, message: `Logic node '${name}' requires a non-empty :inputs vector` });
    }

    if (type === 'sequence') {
      const matchLast = Boolean(getField(def, 'match-last', 'matchLast'));
      const enter = getField(def, 'enter');
      if (matchLast && enter !== undefined && enter !== null && enter !== '') {
        errors.push({
          node: name,
          message: `Logic node '${name}' cannot combine :match-last with :enter`
        });
      }
    }

    if (type === 'clamp') {
      if (getField(def, 'min') === undefined && getField(def, 'max') === undefined) {
        errors.push({ node: name, message: `Logic node '${name}' of type clamp requires :min and/or :max` });
      }
    }

    if (type === 'threshold') {
      if (getField(def, 'value') === undefined && getField(def, 'min') === undefined && getField(def, 'max') === undefined) {
        errors.push({ node: name, message: `Logic node '${name}' of type threshold requires :value or :min/:max` });
      }
    }

    if (type === 'mqtt-input' && !getField(def, 'topic') && !getField(def, 'source')) {
      errors.push({ node: name, message: `Logic node '${name}' of type mqtt-input requires :topic or :source` });
    }

    if (type === 'scale') {
      const inMin = Number(getField(def, 'in-min', 'inMin') ?? 0);
      const inMax = Number(getField(def, 'in-max', 'inMax'));
      if (!Number.isFinite(inMax) || inMax === inMin) {
        errors.push({ node: name, message: `Logic node '${name}' :in-max must differ from :in-min` });
      }
    }

    const bindings = collectNodeBindings(def, options.bindingDefaults || {});
    bindings.forEach((binding) => {
      if (binding.kind === 'source' && binding.source && inputSources && typeof inputSources === 'object') {
        const known = inputSources instanceof Map
          ? inputSources.has(binding.source)
          : Object.prototype.hasOwnProperty.call(inputSources, binding.source);
        if (!known) {
          warnings.push({
            node: name,
            message: `Logic node '${name}' references unknown input source '${binding.source}'`
          });
        }
      }
      if (binding.kind === 'node' && binding.node && !names.includes(binding.node)) {
        errors.push({
          node: name,
          message: `Logic node '${name}' references unknown node '${binding.node}'`
        });
      }
    });

    if (type === 'match') {
      const target = getField(def, 'target');
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        errors.push({ node: name, message: `Logic node '${name}' :target must be a map of signal → value` });
      } else {
        const targetKeys = new Set(Object.keys(target).map(normalizeName));
        bindings.forEach((binding) => {
          const leaf = binding.signal || binding.node || '';
          if (leaf && !targetKeys.has(leaf)) {
            errors.push({
              node: name,
              message: `Logic node '${name}' input '${leaf}' has no matching :target key`
            });
          }
        });
      }
    }

    nodes.set(name, {
      name,
      type,
      impl,
      def,
      bindings,
      deps: dependencyNames(def, options.bindingDefaults || {})
    });
  });

  const { order, cycle } = topologicalSort(nodes);
  if (cycle) {
    errors.push({ node: cycle[0], message: `Logic graph cycle detected: ${cycle.join(' → ')}` });
  }

  return {
    nodes,
    order,
    errors,
    warnings,
    size: nodes.size
  };
}

function topologicalSort(nodes) {
  const incoming = new Map();
  const outgoing = new Map();
  nodes.forEach((node, name) => {
    incoming.set(name, 0);
    outgoing.set(name, []);
  });

  nodes.forEach((node, name) => {
    node.deps.forEach((dep) => {
      if (!nodes.has(dep)) return;
      outgoing.get(dep).push(name);
      incoming.set(name, incoming.get(name) + 1);
    });
  });

  const queue = [];
  incoming.forEach((count, name) => {
    if (count === 0) queue.push(name);
  });

  const order = [];
  while (queue.length > 0) {
    const name = queue.shift();
    order.push(name);
    (outgoing.get(name) || []).forEach((next) => {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    });
  }

  if (order.length !== nodes.size) {
    const remaining = [...nodes.keys()].filter((name) => !order.includes(name));
    return { order, cycle: remaining.concat(remaining[0]) };
  }

  return { order, cycle: null };
}

function collectMqttTopics(graph, inputSources) {
  const topics = new Set();
  const sourceLookup = inputSources instanceof Map
    ? inputSources
    : new Map(Object.entries(inputSources || {}));

  graph.nodes.forEach((node) => {
    node.bindings.forEach((binding) => {
      if (binding.kind === 'topic' && binding.topic) topics.add(binding.topic);
      if (binding.kind === 'source' && binding.source) {
        const def = sourceLookup.get(binding.source);
        const topic = def && (def.topic || def);
        if (typeof topic === 'string' && topic) topics.add(topic);
        if (binding.topic) topics.add(binding.topic);
      }
    });
  });

  return [...topics];
}

module.exports = {
  buildGraph,
  nodeNamesFromConfig,
  collectMqttTopics,
  topologicalSort
};
