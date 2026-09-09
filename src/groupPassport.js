'use strict';

/**
 * Lean group passport helpers (PxM / multi-chamber).
 * Spec: rooms/tfd/docs/PxM-SPEC.md
 */

const CANONICAL_TYPES = Object.freeze([
  'friends',
  'family',
  'coworkers',
  'kids',
  'adults',
  'elderly',
  'novices',
  'experienced',
  'strangers',
]);

function randomGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Node < 19 / stripped crypto
  const { randomUUID } = require('crypto');
  return randomUUID();
}

function normalizeTypes(raw) {
  if (raw == null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') {
    list = raw.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const t = String(item).replace(/^:/, '').trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Build a lean passport from a start (or setPassport) command payload.
 * @param {object} cmd
 * @param {object} [opts]
 * @param {string} [opts.defaultGame] — room slug from INI / config
 * @param {boolean} [opts.generateId=true]
 */
function normalizePassport(cmd = {}, opts = {}) {
  const generateId = opts.generateId !== false;
  const src = cmd && typeof cmd === 'object' ? cmd : {};
  const nested = src.passport && typeof src.passport === 'object' ? src.passport : {};

  const pick = (...keys) => {
    for (const k of keys) {
      if (src[k] !== undefined && src[k] !== null && src[k] !== '') return src[k];
      if (nested[k] !== undefined && nested[k] !== null && nested[k] !== '') return nested[k];
    }
    return undefined;
  };

  let groupId = pick('groupId', 'group_id', 'groupID');
  if (!groupId && generateId) groupId = randomGroupId();
  if (groupId) groupId = String(groupId).trim();

  const gameRaw = pick('game', 'room', 'gameSlug', 'game_slug');
  const game = gameRaw != null && String(gameRaw).trim()
    ? String(gameRaw).trim()
    : (opts.defaultGame ? String(opts.defaultGame).trim() : null);

  const nameRaw = pick('name', 'groupName', 'group_name');
  const name = nameRaw != null && String(nameRaw).trim() ? String(nameRaw).trim() : undefined;
  const notesRaw = pick('notes', 'note');
  const notes = notesRaw != null && String(notesRaw).trim() ? String(notesRaw).trim() : undefined;
  const sizeRaw = pick('size', 'groupSize', 'group_size', 'players');
  let size = null;
  if (sizeRaw !== undefined && sizeRaw !== null && sizeRaw !== '') {
    const n = Number(sizeRaw);
    if (Number.isFinite(n) && n >= 0) size = n;
  }

  const types = normalizeTypes(pick('types', 'type', 'tags'));

  const hintRaw = pick('hintCount', 'hint_count');
  let hintCount = null;
  if (hintRaw !== undefined && hintRaw !== null && hintRaw !== '') {
    const n = Number(hintRaw);
    if (Number.isFinite(n) && n >= 0) hintCount = Math.floor(n);
  }

  const gameDuration = numberOrNull(pick('gameDuration', 'game_duration'));
  const gameTime = numberOrNull(pick('gameTime', 'game_time'));
  const startedAt = pick('startedAt', 'started_at') || null;

  const passport = {
    groupId: groupId || null,
    game: game || null,
  };
  if (name) passport.name = name;
  if (notes) passport.notes = notes;
  if (size != null) passport.size = size;
  if (types.length) passport.types = types;
  if (hintCount != null) passport.hintCount = hintCount;
  if (gameDuration != null) passport.gameDuration = gameDuration;
  if (gameTime != null) passport.gameTime = gameTime;
  if (startedAt) passport.startedAt = String(startedAt);

  return passport;
}

function numberOrNull(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Fields safe to put on every JSONL line / retained state. */
function passportLogFields(passport) {
  if (!passport || typeof passport !== 'object') return {};
  const out = {};
  if (passport.groupId) out.groupId = passport.groupId;
  if (passport.game) out.game = passport.game;
  if (passport.name != null) out.group_name = passport.name;
  if (passport.notes != null) out.notes = passport.notes;
  if (passport.size != null) out.group_size = passport.size;
  if (Array.isArray(passport.types) && passport.types.length) out.types = passport.types.slice();
  return out;
}

module.exports = {
  CANONICAL_TYPES,
  randomGroupId,
  normalizeTypes,
  normalizePassport,
  passportLogFields,
};
