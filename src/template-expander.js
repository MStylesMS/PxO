// Phase 1 Template Expansion for EDN modular configs
// Expands top-level templates referenced inside game schedules.
// Only integer :offset supported. Placeholders use :$paramName (after naive EDN parse these
// should arrive as strings beginning with '$' or remain as raw tokens depending on parser).
// We operate on already-parsed JS object form (produced by EdnConfigLoader).

const log = require('./logger');

function isInt(n) { return Number.isInteger(n); }

/**
 * Perform in-place Phase 1 template expansion (pure function w/ return clone for safety)
 * Structure expectations (post naive EDN -> JS conversion):
 * {
 *   templates: {
 *     countdown_block: {
 *       params: [ 'cue', 'video_duration' ],
 *       steps: [ { offset: -5, fire_cue: ':$cue' }, ... ]
 *     }
 *   },
 *   games: {
 *     hc_60: { game: { schedule: [ { at: 2700, template: 'countdown_block', params: { cue: '45min', video_duration: 24 } } ]}}
 *   }
 * }
 * NOTE: Key naming after naive EDN parse will have hyphenated names preserved as-is (e.g. 'fire-cue').
 */
function expandTemplates(modular) {
  if (!modular || typeof modular !== 'object') return modular;
  // Support both :templates (EDN) and templates (JS) forms
  const templates = modular.templates || modular['templates'] || modular.TEMPLATES || modular[':templates'] || null;
  if (!templates) return modular; // nothing to do

  // Shallow clone root so caller can diff if desired
  const root = { ...modular };
  let totalInvocations = 0;
  let totalExpandedSteps = 0;

  function normalizeName(name) {
    if (!name) return name;
    return String(name).replace(/^:/,'').replace(/^[.]/,'');
  }

  // Support both new 'game-modes' with 'gameplay' and legacy 'games' with 'game'
  const gameEntries = root['game-modes']
    ? Object.entries(root['game-modes']).map(([k,v]) => ({ key: k, def: v, kind: 'new' }))
    : Object.entries(root.games || {}).map(([k,v]) => ({ key: k, def: v, kind: 'legacy' }));

  gameEntries.forEach(({ key: gameKey, def: gameDef, kind }) => {
    const sched = kind === 'new' ? gameDef?.gameplay?.schedule : gameDef?.game?.schedule;
    if (!Array.isArray(sched) || sched.length === 0) return;
    let expanded = [];
    sched.forEach(entry => {
      if (entry && Object.prototype.hasOwnProperty.call(entry, 'template')) {
        const tmplNameRaw = entry.template;
        const tmplName = normalizeName(tmplNameRaw);
        const tmpl = templates[tmplName] || templates[normalizeName(':'+tmplName)] || templates[':'+tmplName];
        if (!tmpl) {
          throw new Error(`Template '${tmplNameRaw}' not found for game ${gameKey}`);
        }
        const requiredParams = Array.isArray(tmpl.params) ? tmpl.params.map(p => normalizeName(p)) : [];
        const provided = entry.params || {};
        // Validate presence
        requiredParams.forEach(p => {
          if (provided[p] === undefined && provided[':'+p] === undefined) {
            throw new Error(`Missing required param '${p}' for template '${tmplName}' in game ${gameKey}`);
          }
        });
        // Warn on unused provided params
        Object.keys(provided).forEach(k => {
          const kn = normalizeName(k);
            if (!requiredParams.includes(kn)) {
              log.warn(`[templates] Unused param '${k}' passed to template '${tmplName}' (game ${gameKey})`);
            }
        });
        const baseAt = entry.at;
        if (!isInt(baseAt)) {
          throw new Error(`Template invocation base 'at' must be integer (game ${gameKey}, template ${tmplName})`);
        }
        totalInvocations++;
        (tmpl.steps || []).forEach((step, idx) => {
          if (step.template) {
            throw new Error(`Nested template reference found inside template '${tmplName}' step ${idx}; nesting not supported in Phase 1.`);
          }
          if (!Object.prototype.hasOwnProperty.call(step, 'offset')) {
            throw new Error(`Template '${tmplName}' step ${idx} missing required 'offset' field.`);
          }
          let off = step.offset;
          // Support object offset form: { param: :duration :add 2 }
          if (off && typeof off === 'object' && !Array.isArray(off)) {
            const paramNameRaw = off.param || off[':param'];
            if (!paramNameRaw) {
              throw new Error(`Template '${tmplName}' step ${idx} offset object missing :param`);
            }
            const paramName = normalizeName(String(paramNameRaw).replace(/^:/,''));
            const baseVal = provided[paramName] !== undefined ? provided[paramName] : provided[':'+paramName];
            if (baseVal === undefined) {
              throw new Error(`Template '${tmplName}' step ${idx} offset references param '${paramName}' not provided.`);
            }
            const add = off.add !== undefined ? off.add : off[':add'];
            if (add !== undefined && !isInt(add)) {
              throw new Error(`Template '${tmplName}' step ${idx} offset :add must be integer if present.`);
            }
            if (!isInt(baseVal)) {
              throw new Error(`Template '${tmplName}' step ${idx} offset param '${paramName}' must resolve to integer.`);
            }
            off = baseVal + (add || 0);
          }
          if (!isInt(off)) {
            throw new Error(`Template '${tmplName}' step ${idx} offset must be integer (got ${JSON.stringify(off)}).`);
          }
          const absAt = baseAt + off;
          if (absAt < 0) {
            throw new Error(`Expanded schedule time became negative (template '${tmplName}' step ${idx} => at ${absAt}).`);
          }
          // Clone without offset
          const clone = { ...step };
          delete clone.offset;
          // Placeholder substitution: values exactly equal to placeholder tokens
          Object.entries(clone).forEach(([k,v]) => {
            // Recurse shallow object values (one level) for param tokens
            function subst(val) {
              if (typeof val === 'string') {
                // Keyword style values beginning with ':'
                if (/^:\$/.test(val)) { // :$param placeholder
                  const paramKey = normalizeName(val.substring(2));
                  const providedVal = provided[paramKey] !== undefined ? provided[paramKey] : provided[':'+paramKey];
                  if (providedVal === undefined) {
                    throw new Error(`Template '${tmplName}' step ${idx} references param '${paramKey}' not provided.`);
                  }
                  return providedVal;
                }
                if (/^\$[A-Za-z0-9_\-]+$/.test(val)) { // $param placeholder
                  const paramKey = normalizeName(val.substring(1));
                  const providedVal = provided[paramKey] !== undefined ? provided[paramKey] : provided[':'+paramKey];
                  if (providedVal === undefined) {
                    throw new Error(`Template '${tmplName}' step ${idx} references param '${paramKey}' not provided.`);
                  }
                  return providedVal;
                }
                // Convert EDN keyword literals like ':show-clock' to bare value 'show-clock'
                if (/^:[A-Za-z].+/.test(val)) {
                  return val.substring(1);
                }
              } else if (val && typeof val === 'object' && !Array.isArray(val)) {
                const inner = { ...val };
                Object.entries(inner).forEach(([ik,iv]) => { inner[ik] = subst(iv); });
                return inner;
              }
              return val;
            }
            clone[k] = subst(v);
          });
          clone.at = absAt;
          clone._fromTemplate = { name: tmplName, baseAt };
          expanded.push(clone);
          totalExpandedSteps++;
        });
      } else {
        expanded.push(entry);
      }
    });
    // Sort by at ascending, stable (Node sort is stable since v12+)
    expanded.sort((a,b) => (a.at ?? 0) - (b.at ?? 0));
    // Validation: duplicate identical maps warning (shallow stringify)
    const seen = new Set();
    expanded.forEach(e => {
      if (e && e.at !== undefined) {
        const sig = `${e.at}|${Object.keys(e).filter(k=>k!=='_fromTemplate').sort().map(k=>`${k}=${JSON.stringify(e[k])}`).join(';')}`;
        if (seen.has(sig)) {
          log.warn(`[templates] Duplicate schedule entry at ${e.at} detected after expansion in game ${gameKey}`);
        } else {
          seen.add(sig);
        }
      }
    });
  if (kind === 'new') gameDef.gameplay.schedule = expanded;
  else gameDef.game.schedule = expanded;
  });

  if (totalInvocations > 0) {
    const ratio = totalExpandedSteps && totalInvocations ? (totalExpandedSteps / totalInvocations).toFixed(2) : '1.00';
    log.info(`[templates] Expanded ${totalInvocations} template invocation(s) into ${totalExpandedSteps} schedule step(s). Avg steps/invocation=${ratio}`);
  }
  return root;
}

module.exports = { expandTemplates };
