#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const EdnConfigLoader = require('../src/edn-config-loader');
const ModularConfigAdapter = require('../src/modular-config-adapter');
const ConfigValidator = require('../src/validators/configValidator');
const { expandTemplates } = require('../src/template-expander');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG = path.join(ROOT, 'config', 'game.edn');

function countObjectKeys(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.keys(obj).length;
}

function countGameModes(gameModes) {
  if (!gameModes || typeof gameModes !== 'object') return 0;
  return Object.entries(gameModes).filter(([key, value]) => key !== 'comment' && value && typeof value === 'object').length;
}

function parseMessageContext(entry) {
  if (typeof entry !== 'string') {
    return { message: String(entry), context: '' };
  }

  if (!entry.endsWith(')')) {
    return { message: entry, context: '' };
  }

  const sepIndex = entry.lastIndexOf(' (');
  if (sepIndex === -1) {
    return { message: entry, context: '' };
  }

  return {
    message: entry.slice(0, sepIndex),
    context: entry.slice(sepIndex + 2, -1)
  };
}

function extractLineFromErrorText(text) {
  const raw = String(text || '');
  const patterns = [
    /line\s*[:=]?\s*(\d+)/i,
    /\bat\s+line\s+(\d+)\b/i,
    /\[(?:l|line)\s*(\d+)\]/i,
    /:(\d+):(\d+)/
  ];

  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (m && m[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
}

function normalizeToken(token) {
  return token
    .replace(/\[\d+\]/g, '')
    .replace(/^:+/, '')
    .trim();
}

function stripComments(line) {
  let inString = false;
  let escaped = false;
  let out = '';

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ';') {
      break;
    }

    out += ch;
  }

  return out;
}

function buildSearchIndex(lines) {
  const keywordLines = new Map();
  const bareLines = new Map();
  const cleanedLines = lines.map((line) => stripComments(line).toLowerCase());

  const addLine = (map, key, lineNo) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lineNo);
  };

  cleanedLines.forEach((line, i) => {
    const lineNo = i + 1;
    let m;

    const keywordRe = /:([a-z0-9_+*!?.<>\/-]+)/gi;
    while ((m = keywordRe.exec(line)) !== null) {
      addLine(keywordLines, m[1].toLowerCase(), lineNo);
    }

    const stringRe = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    while ((m = stringRe.exec(line)) !== null) {
      const token = m[1].trim().toLowerCase();
      if (token) addLine(bareLines, token, lineNo);
    }
  });

  return { keywordLines, bareLines, cleanedLines };
}

function scoreCandidateLine(lineNo, parts, index) {
  if (parts.length === 0) return 0;

  const windowStart = Math.max(1, lineNo - 80);
  const lineSlice = index.cleanedLines.slice(windowStart - 1, lineNo);
  let score = 0;

  parts.forEach((part, idx) => {
    const p = part.toLowerCase();
    const hit = lineSlice.some((line) => line.includes(`:${p}`) || line.includes(`"${p}"`) || line.includes(p));
    if (hit) {
      score += (idx + 1) * 4;
    }
  });

  return score;
}

function findLineForContext(lines, context, fallbackMessage, lineHint = null) {
  if (Number.isFinite(lineHint) && lineHint > 0) return lineHint;

  const msgLine = extractLineFromErrorText(fallbackMessage);
  if (msgLine) return msgLine;

  const index = buildSearchIndex(lines);

  const generic = new Set([
    'global', 'game', 'game-mode', 'game-modes', 'settings', 'mqtt', 'zones',
    'cues', 'sequences', 'timeline', 'schedule', 'commands', 'hints',
    'intro', 'gameplay', 'solved', 'failed', 'abort', 'reset', 'durations'
  ]);

  const parts = String(context || '')
    .split('.')
    .map(normalizeToken)
    .filter(Boolean);

  const specificTokens = parts.filter((p) => !generic.has(p)).map((p) => p.toLowerCase());
  const searchTokens = specificTokens.length ? specificTokens : parts.map((p) => p.toLowerCase());

  const tail = searchTokens[searchTokens.length - 1];
  let candidateLines = [];

  if (tail) {
    candidateLines = [
      ...(index.keywordLines.get(tail) || []),
      ...(index.bareLines.get(tail) || [])
    ];
  }

  if (candidateLines.length === 0) {
    for (const token of searchTokens.slice().reverse()) {
      candidateLines = [
        ...(index.keywordLines.get(token) || []),
        ...(index.bareLines.get(token) || [])
      ];
      if (candidateLines.length) break;
    }
  }

  if (candidateLines.length > 0) {
    let bestLine = candidateLines[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    candidateLines.forEach((lineNo) => {
      const score = scoreCandidateLine(lineNo, parts, index) - lineNo * 0.0001;
      if (score > bestScore) {
        bestScore = score;
        bestLine = lineNo;
      }
    });

    return bestLine;
  }

  const msg = String(fallbackMessage || '').toLowerCase();
  const quoted = [...msg.matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase());
  for (const q of quoted) {
    const candidates = [
      ...(index.keywordLines.get(q) || []),
      ...(index.bareLines.get(q) || [])
    ];
    if (candidates.length) {
      return candidates[0];
    }
  }

  return Number.MAX_SAFE_INTEGER;
}

function detectLikelySyntaxIssue(lines) {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const cleaned = stripComments(lines[i]);

    if (/(^|[\s\{\[\(])\.(?=$|[\s\}\]\),])/.test(cleaned)) {
      return {
        line: lineNo,
        message: 'Found standalone dot token in EDN form. This is usually invalid EDN syntax.'
      };
    }

    let inString = false;
    let escaped = false;

    for (let j = 0; j < cleaned.length; j += 1) {
      const ch = cleaned[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') braceDepth += 1;
      if (ch === '}') braceDepth -= 1;
      if (ch === '[') bracketDepth += 1;
      if (ch === ']') bracketDepth -= 1;
      if (ch === '(') parenDepth += 1;
      if (ch === ')') parenDepth -= 1;

      if (braceDepth < 0 || bracketDepth < 0 || parenDepth < 0) {
        return {
          line: lineNo,
          message: 'Found unmatched closing delimiter in EDN content.'
        };
      }
    }
  }

  if (braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) {
    return {
      line: lines.length,
      message: 'Unbalanced delimiters detected in EDN content.'
    };
  }

  return null;
}

function orderIssuesByFilePosition(issues, lines) {
  return issues
    .map((issue, idx) => {
      const line = findLineForContext(lines, issue.context, issue.message, issue.lineHint);
      return {
        ...issue,
        line,
        _idx: idx
      };
    })
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a._idx - b._idx;
    });
}

function addIssue(list, level, message, context = '', lineHint = null) {
  list.push({ level, message, context, lineHint });
}

function extractEntityFromContext(context) {
  const ctx = String(context || '');
  if (!ctx) return { kind: 'general', name: 'general' };

  let m = ctx.match(/^global\.hints\.([^.\s]+)/);
  if (m) return { kind: 'hint', name: m[1] };

  m = ctx.match(/^global\.cues\.([^.\s]+)/);
  if (m) return { kind: 'cue', name: m[1] };

  m = ctx.match(/^global\.(?:command-sequences|sequences|system-sequences)\.([^.\s]+)/);
  if (m) return { kind: 'sequence', name: m[1] };

  m = ctx.match(/^global\.mqtt\.zones\.([^.\s]+)/);
  if (m) return { kind: 'zone', name: m[1] };

  m = ctx.match(/^game-mode\.([^.\s]+)\.phases\.([^.\s]+)/);
  if (m) return { kind: 'phase', name: `${m[1]}.${m[2]}` };

  m = ctx.match(/^game-modes\.([^.\s]+)\.phases\.([^.\s]+)/);
  if (m) return { kind: 'phase', name: `${m[1]}.${m[2]}` };

  m = ctx.match(/^game-mode\.([^.\s]+)\.([^.\s]+)/);
  if (m) return { kind: m[2], name: `${m[1]}.${m[2]}` };

  m = ctx.match(/^game-modes\.([^.\s]+)\.([^.\s]+)/);
  if (m) return { kind: m[2], name: `${m[1]}.${m[2]}` };

  if (ctx.includes('additional-phases')) {
    const segs = ctx.split('.');
    return { kind: 'additional-phase', name: segs[segs.length - 1] || 'additional-phases' };
  }

  return { kind: 'general', name: ctx };
}

function extractEntityFromMessage(message) {
  const msg = String(message || '');
  if (!msg) return { kind: 'general', name: 'general' };

  // Combined mode+phase diagnostics from free-text messages.
  let m = msg.match(/\b[Gg]ame mode '([^']+)'\s+phase '([^']+)'/);
  if (m) return { kind: 'phase', name: `${m[1]}.${m[2]}` };

  // Bracketed form used in some validators, e.g. [demo.failed] <message>
  m = msg.match(/^\[([^\].\s]+)\.([^\].\s]+)\]/);
  if (m) return { kind: 'phase', name: `${m[1]}.${m[2]}` };

  m = msg.match(/\b[Tt]ext hint '([^']+)'\b|\b[Ss]equence hint '([^']+)'\b|\b[Hh]int '([^']+)'\b/);
  if (m) return { kind: 'hint', name: m[1] || m[2] || m[3] };

  m = msg.match(/\b[Cc]ue '([^']+)'\b/);
  if (m) return { kind: 'cue', name: m[1] };

  m = msg.match(/\b[Ss]equence '([^']+)'\b|\breferences missing sequence '([^']+)'\b/);
  if (m) return { kind: 'sequence', name: m[1] || m[2] };

  m = msg.match(/\b[Pp]hase '([^']+)'\b/);
  if (m) return { kind: 'phase', name: m[1] };

  m = msg.match(/\b[Gg]ame mode '([^']+)'\b/);
  if (m) return { kind: 'game-mode', name: m[1] };

  m = msg.match(/\b[Zz]one '([^']+)'\b/);
  if (m) return { kind: 'zone', name: m[1] };

  m = msg.match(/\b[Aa]dditional phase '([^']+)'\b/);
  if (m) return { kind: 'additional-phase', name: m[1] };

  return { kind: 'general', name: 'general' };
}

function isGeneralEntity(entity) {
  return !entity || entity.kind === 'general';
}

function decorateIssue(issue) {
  const contextEntity = extractEntityFromContext(issue.context);
  const messageEntity = extractEntityFromMessage(issue.message);
  const entity = isGeneralEntity(contextEntity) ? messageEntity : contextEntity;
  return { ...issue, entity };
}

function groupIssuesByEntity(issues) {
  const groups = new Map();
  issues.forEach((issue) => {
    const key = `${issue.entity.kind}:${issue.entity.name}`;
    if (!groups.has(key)) {
      groups.set(key, { entity: issue.entity, items: [] });
    }
    groups.get(key).items.push(issue);
  });
  return Array.from(groups.values());
}

function runConfigValidator(legacyConfig) {
  const validator = new ConfigValidator();

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = () => { };
  console.warn = () => { };
  console.error = () => { };

  try {
    return validator.validate(legacyConfig);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

function validateProhibitedSections(legacyConfig, issues) {
  const cfg = legacyConfig;

  if (cfg.global && cfg.global.actions) {
    addIssue(issues, 'error', 'Global :actions section found - must be migrated to :cues', 'global.actions');
  }
  if (cfg.global && cfg.global.commands) {
    addIssue(issues, 'error', 'Global :commands section found - must be migrated to :sequences', 'global.commands');
  }

  if (cfg['game-modes']) {
    Object.entries(cfg['game-modes']).forEach(([modeKey, mode]) => {
      if (mode && mode.actions) {
        addIssue(issues, 'error', `Game mode '${modeKey}' has :actions section - must be migrated to :cues`, `game-modes.${modeKey}.actions`);
      }
      if (mode && mode.commands) {
        addIssue(issues, 'error', `Game mode '${modeKey}' has :commands section - must be migrated to :sequences`, `game-modes.${modeKey}.commands`);
      }
    });
  }
}

function validateZoneFormat(legacyConfig, issues) {
  const zones = legacyConfig && legacyConfig.global && legacyConfig.global.mqtt && legacyConfig.global.mqtt.zones;
  if (!zones) return;

  const supportedTypes = new Set(['pfx-media', 'pfx-lights', 'pfx-clock']);

  Object.entries(zones).forEach(([zoneName, zoneConfig]) => {
    const contextRoot = `global.mqtt.zones.${zoneName}`;

    if (!zoneConfig || typeof zoneConfig !== 'object') {
      addIssue(issues, 'error', `Zone '${zoneName}' must be an object`, contextRoot);
      return;
    }

    if (!zoneConfig.type) {
      addIssue(issues, 'error', `Zone '${zoneName}' missing required 'type' field`, `${contextRoot}.type`);
    } else if (!supportedTypes.has(zoneConfig.type)) {
      addIssue(
        issues,
        'error',
        `Zone '${zoneName}' has unsupported type '${zoneConfig.type}'. Supported types: pfx-media, pfx-lights, pfx-clock`,
        `${contextRoot}.type`
      );
    }

    if (!zoneConfig['base-topic']) {
      addIssue(issues, 'error', `Zone '${zoneName}' missing required 'base-topic' field`, `${contextRoot}.base-topic`);
    } else if (typeof zoneConfig['base-topic'] !== 'string') {
      addIssue(issues, 'error', `Zone '${zoneName}' 'base-topic' must be a string`, `${contextRoot}.base-topic`);
    }
  });
}

function printSummary({ filePath, stats, errors, warnings }) {
  const pass = errors.length === 0;

  console.log('EDN Validation Summary');
  console.log('======================');
  console.log(`File: ${filePath}`);
  console.log('');
  console.log('Basic Statistics');
  console.log('----------------');
  console.log(`- Lines: ${stats.lines}`);
  console.log(`- Bytes: ${stats.bytes}`);
  console.log(`- Game Modes: ${stats.gameModes}`);
  console.log(`- Zones: ${stats.zones}`);
  console.log(`- Global Cues: ${stats.globalCues}`);
  console.log(`- Global Sequences: ${stats.globalSequences}`);
  console.log(`- Global Hints: ${stats.globalHints}`);
  console.log('');
  console.log('Validation Totals');
  console.log('-----------------');
  console.log(`- Warnings (informational): ${warnings.length}`);
  console.log(`- Errors (must fix): ${errors.length}`);
  console.log(`- Result: ${pass ? 'PASS' : 'FAIL'}`);
  console.log('');

  console.log('Errors (must be fixed)');
  console.log('----------------------');
  if (errors.length === 0) {
    console.log('None');
  } else {
    errors.forEach((e, i) => {
      const lineText = Number.isFinite(e.line) && e.line !== Number.MAX_SAFE_INTEGER ? `L${e.line}` : 'L?';
      const contextText = e.context ? ` (${e.context})` : '';
      const entityText = e.entity ? ` [${e.entity.kind}:${e.entity.name}]` : '';
      console.log(`${i + 1}. [${lineText}]${entityText} ${e.message}${contextText}`);
    });
  }
  console.log('');

  console.log('Warnings (informational)');
  console.log('------------------------');
  if (warnings.length === 0) {
    console.log('None');
  } else {
    warnings.forEach((w, i) => {
      const lineText = Number.isFinite(w.line) && w.line !== Number.MAX_SAFE_INTEGER ? `L${w.line}` : 'L?';
      const contextText = w.context ? ` (${w.context})` : '';
      const entityText = w.entity ? ` [${w.entity.kind}:${w.entity.name}]` : '';
      console.log(`${i + 1}. [${lineText}]${entityText} ${w.message}${contextText}`);
    });
  }

  const combined = [...errors, ...warnings];
  if (combined.length > 0) {
    const grouped = groupIssuesByEntity(combined);
    console.log('');
    console.log('Issues by Entity');
    console.log('----------------');
    grouped.forEach((group, idx) => {
      const errCount = group.items.filter((i) => i.level === 'error').length;
      const warnCount = group.items.filter((i) => i.level === 'warning').length;
      console.log(`${idx + 1}. ${group.entity.kind}:${group.entity.name} — errors: ${errCount}, warnings: ${warnCount}`);
    });
  }
}

function validateEdnFile(filePathInput) {
  const resolvedPath = path.resolve(filePathInput || DEFAULT_CONFIG);
  const issues = [];

  if (!fs.existsSync(resolvedPath)) {
    addIssue(issues, 'error', `File not found: ${resolvedPath}`);
    printSummary({
      filePath: resolvedPath,
      stats: { lines: 0, bytes: 0, gameModes: 0, zones: 0, globalCues: 0, globalSequences: 0, globalHints: 0 },
      errors: orderIssuesByFilePosition(issues.filter((i) => i.level === 'error'), []),
      warnings: []
    });
    return false;
  }

  const text = fs.readFileSync(resolvedPath, 'utf8');
  const lines = text.split(/\r?\n/);

  let modularConfig = null;
  let legacyConfig = null;

  try {
    modularConfig = EdnConfigLoader.parseEdn(text, resolvedPath);
    if (!modularConfig || typeof modularConfig !== 'object' || Array.isArray(modularConfig)) {
      const lexical = detectLikelySyntaxIssue(lines);
      if (lexical) {
        addIssue(issues, 'error', lexical.message, '', lexical.line);
      }
      throw new Error('EDN parser did not return a valid root map/object. Check file syntax and ensure the top-level form is a single EDN map.');
    }
    modularConfig = expandTemplates(modularConfig);
    EdnConfigLoader.validateConfig(modularConfig);
  } catch (error) {
    const message = error && (error.message || String(error));
    const lineHint = extractLineFromErrorText(message);
    addIssue(issues, 'error', message, '', lineHint);
  }

  if (modularConfig) {
    try {
      legacyConfig = ModularConfigAdapter.transform(modularConfig);
    } catch (error) {
      addIssue(issues, 'error', error.message || String(error));
    }
  }

  if (legacyConfig) {
    validateProhibitedSections(legacyConfig, issues);
    validateZoneFormat(legacyConfig, issues);

    const result = runConfigValidator(legacyConfig);
    result.errors.forEach((entry) => {
      const parsed = parseMessageContext(entry);
      addIssue(issues, 'error', parsed.message, parsed.context);
    });
    result.warnings.forEach((entry) => {
      const parsed = parseMessageContext(entry);
      addIssue(issues, 'warning', parsed.message, parsed.context);
    });
  }

  const dedupe = new Set();
  const uniqueIssues = issues.filter((issue) => {
    const key = `${issue.level}|${issue.message}|${issue.context}|${issue.lineHint || ''}`;
    if (dedupe.has(key)) return false;
    dedupe.add(key);
    return true;
  });

  const orderedErrors = orderIssuesByFilePosition(uniqueIssues.filter((i) => i.level === 'error'), lines).map(decorateIssue);
  const orderedWarnings = orderIssuesByFilePosition(uniqueIssues.filter((i) => i.level === 'warning'), lines).map(decorateIssue);

  const stats = {
    lines: lines.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    gameModes: countGameModes(modularConfig && modularConfig['game-modes']),
    zones: countObjectKeys(modularConfig && modularConfig.global && modularConfig.global.mqtt && modularConfig.global.mqtt.zones),
    globalCues: countObjectKeys(modularConfig && modularConfig.global && modularConfig.global.cues),
    globalSequences: countObjectKeys(modularConfig && modularConfig.global && modularConfig.global.sequences),
    globalHints: countObjectKeys(modularConfig && modularConfig.global && modularConfig.global.hints)
  };

  printSummary({
    filePath: resolvedPath,
    stats,
    errors: orderedErrors,
    warnings: orderedWarnings
  });

  return orderedErrors.length === 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run validate:edn -- [path/to/file.edn]');
    console.log('Default file: config/game.edn');
    process.exit(0);
  }

  const fileArg = args[0] || DEFAULT_CONFIG;
  const ok = validateEdnFile(fileArg);
  process.exit(ok ? 0 : 1);
}

module.exports = { validateEdnFile };
