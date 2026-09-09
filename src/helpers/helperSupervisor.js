'use strict';

const { spawn } = require('child_process');
const path = require('path');

/**
 * PxO Option F — managed helper subprocess supervisor.
 *
 * EDN (under :global):
 *   :helpers
 *     [{:id :simon
 *       :cmd ["node" "/opt/paradox/rooms/tfd/helpers/simon.js"]
 *       :env {}
 *       :cwd "/opt/paradox/rooms/tfd"
 *       :topic "paradox/tfd/elevator/helpers/simon"
 *       :active-phases ["gameplay" "paused"]
 *       :restart-on-crash true
 *       :ready-event "ready"
 *       :stop-grace-ms 2000
 *       :max-restarts 5
 *       :restart-backoff-ms 1000}]
 *
 * Helpers talk to the suite over MQTT only. PxO owns lifecycle.
 */

function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function normalizeId(raw) {
  if (raw == null) return null;
  return String(raw).replace(/^:/, '').trim();
}

function normalizePhases(raw) {
  if (!raw) return ['gameplay', 'paused'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((p) => String(p).replace(/^:/, '').trim())
    .filter(Boolean);
}

function normalizeCmd(raw) {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((c) => String(c));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return ['/bin/sh', '-c', raw];
  }
  return null;
}

/** Flatten :global :settings into string keys (`simon-entry-window-s` → value). */
function flattenSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || typeof v === 'object') continue;
    out[String(k).replace(/^:/, '')] = v;
  }
  return out;
}

/**
 * Expand `{{setting-key}}` in helper :env values from :global :settings.
 * Unknown placeholders become empty strings.
 */
function expandHelperEnv(env, settings) {
  const src = env && typeof env === 'object' && !Array.isArray(env) ? env : {};
  const flat = flattenSettings(settings);
  const out = {};
  for (const [key, val] of Object.entries(src)) {
    if (typeof val !== 'string') {
      out[key] = val;
      continue;
    }
    out[key] = val.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, raw) => {
      const name = String(raw).replace(/^:/, '').trim();
      const found = flat[name];
      return found == null ? '' : String(found);
    });
  }
  return out;
}

function normalizeHelperDefs(definitions) {
  if (!definitions) return [];
  const list = Array.isArray(definitions) ? definitions : [definitions];
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const id = normalizeId(pick(raw, 'id', 'name'));
    const cmd = normalizeCmd(pick(raw, 'cmd', 'command'));
    if (!id || !cmd) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      cmd,
      env: pick(raw, 'env') && typeof pick(raw, 'env') === 'object' ? { ...pick(raw, 'env') } : {},
      cwd: pick(raw, 'cwd', 'workingDirectory', 'working-directory') || undefined,
      topic: pick(raw, 'topic') ? String(pick(raw, 'topic')) : null,
      activePhases: normalizePhases(pick(raw, 'activePhases', 'active-phases', 'startPhases', 'start-phases')),
      restartOnCrash: pick(raw, 'restartOnCrash', 'restart-on-crash') !== false,
      readyEvent: pick(raw, 'readyEvent', 'ready-event')
        ? String(pick(raw, 'readyEvent', 'ready-event')).replace(/^:/, '')
        : null,
      stopGraceMs: (() => {
        const n = Number(pick(raw, 'stopGraceMs', 'stop-grace-ms'));
        return Number.isFinite(n) && n >= 0 ? n : 2000;
      })(),
      maxRestarts: (() => {
        const n = Number(pick(raw, 'maxRestarts', 'max-restarts'));
        return Number.isFinite(n) && n >= 0 ? n : 5;
      })(),
      restartBackoffMs: (() => {
        const n = Number(pick(raw, 'restartBackoffMs', 'restart-backoff-ms'));
        return Number.isFinite(n) && n >= 0 ? n : 1000;
      })(),
    });
  }
  return out;
}

class HelperSupervisor {
  /**
   * @param {object} opts
   * @param {Array|object} opts.definitions
   * @param {object} [opts.mqtt] — optional; used for ready-event subscribe + warnings fan-in
   * @param {object} [opts.logger]
   * @param {function} [opts.publishWarning]
   * @param {function} [opts.publishEvent]
   * @param {function} [opts.spawnImpl] — inject for tests
   * @param {object} [opts.settings] — :global :settings; expands {{key}} in helper :env
   * @param {function} [opts.now] — inject clock for tests
   */
  constructor({
    definitions = [],
    mqtt = null,
    logger = console,
    publishWarning = null,
    publishEvent = null,
    spawnImpl = null,
    settings = null,
    now = null,
  } = {}) {
    this.defs = normalizeHelperDefs(definitions);
    this.settings = flattenSettings(settings);
    this.defsById = new Map(this.defs.map((d) => [d.id, d]));
    this.mqtt = mqtt;
    this.log = logger || console;
    this.publishWarning = typeof publishWarning === 'function' ? publishWarning : null;
    this.publishEvent = typeof publishEvent === 'function' ? publishEvent : null;
    this._spawn = spawnImpl || spawn;
    this._now = now || (() => Date.now());
    /** @type {Map<string, object>} */
    this._procs = new Map();
    this._ready = new Set();
    this._stoppingAll = false;
    this._phase = null;
  }

  listDefinitions() {
    return this.defs.slice();
  }

  isRunning(id) {
    const slot = this._procs.get(id);
    return !!(slot && slot.child && !slot.stopping);
  }

  isReady(id) {
    return this._ready.has(id);
  }

  /**
   * Start/stop helpers so only those whose activePhases include phaseName run.
   * @param {string} phaseName
   */
  syncForPhase(phaseName) {
    const phase = String(phaseName || '').replace(/^:/, '');
    this._phase = phase;
    for (const def of this.defs) {
      const shouldRun = def.activePhases.includes(phase);
      if (shouldRun) {
        this._ensureStarted(def);
      } else {
        this._ensureStopped(def.id, { reason: `phase:${phase}` });
      }
    }
  }

  /** Stop every helper (reset / shutdown / emergency). */
  async stopAll({ reason = 'stop_all' } = {}) {
    this._stoppingAll = true;
    const ids = [...this._procs.keys(), ...this.defs.map((d) => d.id)];
    const unique = [...new Set(ids)];
    await Promise.all(unique.map((id) => this._ensureStopped(id, { reason, wait: true })));
    this._stoppingAll = false;
    this._ready.clear();
  }

  _warn(code, details) {
    this.log.warn?.(`[helpers] ${code}`, details);
    if (this.publishWarning) {
      try {
        this.publishWarning(code, { ...(details || {}), source: 'helpers' });
      } catch (_) { /* ignore */ }
    }
  }

  _event(name, details) {
    if (this.publishEvent) {
      try {
        this.publishEvent(name, { ...(details || {}), source: 'helpers' });
      } catch (_) { /* ignore */ }
    }
  }

  _ensureStarted(def) {
    const existing = this._procs.get(def.id);
    if (existing && existing.child && !existing.stopping) {
      return;
    }
    this._spawnHelper(def, { restartCount: existing ? existing.restartCount : 0 });
  }

  _spawnHelper(def, { restartCount = 0 } = {}) {
    if (this._stoppingAll) return;

    const [bin, ...args] = def.cmd;
    const env = {
      ...process.env,
      ...expandHelperEnv(def.env, this.settings),
      PXO_HELPER_ID: def.id,
      PXO_HELPER_TOPIC: def.topic || '',
      PXO_HELPER_PHASE: this._phase || '',
    };

    let child;
    try {
      child = this._spawn(bin, args, {
        cwd: def.cwd ? path.resolve(def.cwd) : undefined,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this._warn('helper_spawn_failed', {
        id: def.id,
        message: err && err.message ? err.message : String(err),
      });
      return;
    }

    const slot = {
      def,
      child,
      restartCount,
      stopping: false,
      startedAt: this._now(),
      exitHandled: false,
    };
    this._procs.set(def.id, slot);
    this._ready.delete(def.id);

    this.log.info?.(`[helpers] started id=${def.id} pid=${child.pid} cmd=${JSON.stringify(def.cmd)}`);
    this._event('helper_started', { id: def.id, pid: child.pid, restartCount });

    const tag = (stream, chunk) => {
      const text = chunk.toString().trimEnd();
      if (!text) return;
      for (const line of text.split(/\r?\n/)) {
        this.log.info?.(`[helper:${def.id}:${stream}] ${line}`);
      }
    };
    if (child.stdout) child.stdout.on('data', (c) => tag('out', c));
    if (child.stderr) child.stderr.on('data', (c) => tag('err', c));

    if (def.topic && def.readyEvent && this.mqtt && typeof this.mqtt.subscribe === 'function') {
      const eventsTopic = `${def.topic.replace(/\/$/, '')}/events`;
      try {
        this.mqtt.subscribe(eventsTopic);
      } catch (_) { /* ignore */ }
      if (!this._mqttHooked) {
        this._mqttHooked = true;
        this.mqtt.on?.('message', (topic, payload) => this._onMqtt(topic, payload));
      }
    }

    child.on('exit', (code, signal) => {
      if (slot.exitHandled) return;
      slot.exitHandled = true;
      this._onExit(def, slot, code, signal);
    });
    child.on('error', (err) => {
      this._warn('helper_process_error', {
        id: def.id,
        message: err && err.message ? err.message : String(err),
      });
    });
  }

  _onMqtt(topic, payload) {
    let msg = payload;
    if (Buffer.isBuffer(payload)) {
      try {
        msg = JSON.parse(payload.toString());
      } catch {
        return;
      }
    } else if (typeof payload === 'string') {
      try {
        msg = JSON.parse(payload);
      } catch {
        return;
      }
    }
    if (!msg || typeof msg !== 'object') return;
    const eventName = msg.event || msg.type;
    if (!eventName) return;

    for (const def of this.defs) {
      if (!def.topic || !def.readyEvent) continue;
      const eventsTopic = `${def.topic.replace(/\/$/, '')}/events`;
      if (topic !== eventsTopic) continue;
      if (String(eventName) === def.readyEvent) {
        this._ready.add(def.id);
        this.log.info?.(`[helpers] ready id=${def.id}`);
        this._event('helper_ready', { id: def.id });
      }
    }
  }

  _onExit(def, slot, code, signal) {
    const intentional = slot.stopping || this._stoppingAll;
    this.log.info?.(
      `[helpers] exited id=${def.id} code=${code} signal=${signal || ''} intentional=${intentional}`
    );
    this._event('helper_exited', {
      id: def.id,
      code,
      signal: signal || null,
      intentional,
      restartCount: slot.restartCount,
    });
    this._ready.delete(def.id);

    const current = this._procs.get(def.id);
    if (current && current.child === slot.child) {
      this._procs.delete(def.id);
    }

    if (intentional) return;
    if (!def.restartOnCrash) return;

    // Only restart if this helper should still be active for the current phase.
    if (!this._phase || !def.activePhases.includes(this._phase)) return;

    if (slot.restartCount >= def.maxRestarts) {
      this._warn('helper_crash_loop', {
        id: def.id,
        restarts: slot.restartCount,
        maxRestarts: def.maxRestarts,
        exitCode: code,
        signal: signal || null,
      });
      return;
    }

    const next = slot.restartCount + 1;
    const delay = def.restartBackoffMs * next;
    this.log.warn?.(`[helpers] restarting id=${def.id} attempt=${next} in ${delay}ms`);
    setTimeout(() => {
      if (this._stoppingAll) return;
      if (!this._phase || !def.activePhases.includes(this._phase)) return;
      if (this.isRunning(def.id)) return;
      this._spawnHelper(def, { restartCount: next });
    }, delay);
  }

  _ensureStopped(id, { reason = 'stop', wait = false } = {}) {
    const slot = this._procs.get(id);
    if (!slot || !slot.child) {
      this._procs.delete(id);
      this._ready.delete(id);
      return wait ? Promise.resolve() : undefined;
    }

    slot.stopping = true;
    const def = slot.def || this.defsById.get(id);
    const grace = def ? def.stopGraceMs : 2000;
    const child = slot.child;

    this.log.info?.(`[helpers] stopping id=${id} reason=${reason} graceMs=${grace}`);
    this._event('helper_stopping', { id, reason });

    const done = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this._procs.delete(id);
        this._ready.delete(id);
        resolve();
      };

      const onExit = () => finish();
      child.once('exit', onExit);

      try {
        child.kill('SIGTERM');
      } catch (_) {
        finish();
        return;
      }

      const killer = setTimeout(() => {
        try {
          if (!slot.exitHandled) {
            this.log.warn?.(`[helpers] SIGKILL id=${id} after grace`);
            child.kill('SIGKILL');
          }
        } catch (_) { /* ignore */ }
        // Give a moment for exit handler; resolve anyway.
        setTimeout(finish, 50);
      }, grace);

      child.once('exit', () => clearTimeout(killer));
    });

    return wait ? done : undefined;
  }
}

module.exports = {
  HelperSupervisor,
  normalizeHelperDefs,
  flattenSettings,
  expandHelperEnv,
};
