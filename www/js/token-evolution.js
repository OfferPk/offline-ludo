/* Token Evolution — free Token 2.0 progression. Unlocks use completed matches only; legacy selection fields remain readable. */
(function (root, factory) {
  var tokenSystem = root && root.TokenSystem;
  if (typeof module === 'object' && module.exports) {
    tokenSystem = require('./token-system.js');
    module.exports = factory(tokenSystem);
  } else root.TokenEvolution = factory(tokenSystem);
})(typeof self !== 'undefined' ? self : this, function (TokenSystem) {
  'use strict';

  if (!TokenSystem || !Array.isArray(TokenSystem.LEVELS)) throw new Error('TokenSystem must load before TokenEvolution.');
  var LABELS = TokenSystem.LEVELS.map(function (item) { return item.name; });
  var VISUALS = [
    { gloss: 1, glow: 1, particles: 0, badge: false, blurb: 'Starter crystal — clean metallic rim and soft jugnu glow.' },
    { gloss: 1.18, glow: 1.25, particles: 1, badge: false, blurb: 'Extra sheen and a brighter jugnu aura. Tiny sparkles on hops.' },
    { gloss: 1.32, glow: 1.5, particles: 2, badge: false, blurb: 'Deeper gloss, stronger glow, and more hop particles.' },
    { gloss: 1.48, glow: 1.75, particles: 3, badge: true, blurb: 'Mythic sheen with a small Crossfour badge beside your tokens.' },
    { gloss: 1.65, glow: 2.05, particles: 5, badge: true, blurb: 'Max gloss, glow, particles, and the Legendary badge.' }
  ];
  var LEVELS = TokenSystem.LEVELS.map(function (item, index) {
    var visual = VISUALS[index];
    return { level: item.id, id: item.name.toLowerCase(), name: item.name, matchesRequired: item.at,
      gloss: visual.gloss, glow: visual.glow, particles: visual.particles, badge: visual.badge, blurb: visual.blurb };
  });

  function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
  function clampLevel(value) {
    var level = typeof value === 'number' && isFinite(value) ? Math.floor(value) : 1;
    return Math.max(1, Math.min(5, level));
  }
  function levelOf(value) { return LEVELS[clampLevel(value) - 1]; }
  function completedOf(save) { return save && isRecord(save.tokenProgress) ? count(save.tokenProgress.completed) : 0; }
  function normalize(save) {
    if (!save || !isRecord(save)) return { unlocked: 1, selected: 1 };
    var unlocked = clampLevel(save.tokenEvoUnlocked), selected = clampLevel(save.tokenEvo);
    if (selected > unlocked) selected = unlocked;
    return { unlocked: unlocked, selected: selected };
  }
  function applyNormalize(save) {
    var normalized = normalize(save);
    save.tokenEvoUnlocked = normalized.unlocked;
    save.tokenEvo = normalized.selected;
    return normalized;
  }
  function canUnlockNext(save) {
    var normalized = normalize(save);
    if (normalized.unlocked >= 5) return { ok: false, reason: 'maxed', next: null };
    var next = LEVELS[normalized.unlocked], completed = completedOf(save), needed = next.matchesRequired;
    var ready = completed >= needed;
    return { ok: ready, reason: ready ? null : 'locked', next: next, free: true, byMatches: ready,
      needMatches: Math.max(0, needed - completed) };
  }
  function state(level, save) {
    var meta = levelOf(level), normalized = normalize(save), owned = meta.level <= normalized.unlocked;
    var selected = meta.level === normalized.selected, isNext = meta.level === normalized.unlocked + 1;
    var unlock = isNext ? canUnlockNext(save) : null;
    return { level: meta.level, id: meta.id, name: meta.name, owned: owned, selected: selected,
      isNext: isNext, meta: meta, unlock: unlock, canUnlock: !!(unlock && unlock.ok), canSelect: owned && !selected };
  }
  function unlockNext(save, persist) {
    if (!save || typeof persist !== 'function') return { ok: false, reason: 'invalid-action' };
    var gate = canUnlockNext(save);
    if (!gate.ok) return { ok: false, reason: gate.reason || 'locked', next: gate.next, needMatches: gate.needMatches };
    var normalized = normalize(save), next = gate.next;
    save.tokenEvoUnlocked = next.level;
    save.tokenEvo = next.level;
    var saved = false;
    try { saved = persist() === true; } catch (error) { saved = false; }
    if (!saved) {
      save.tokenEvoUnlocked = normalized.unlocked;
      save.tokenEvo = normalized.selected;
      return { ok: false, reason: 'save-failed' };
    }
    return { ok: true, level: next.level, id: next.id, name: next.name, spent: 0, free: true };
  }
  function select(save, level, persist) {
    if (!save || typeof persist !== 'function') return { ok: false, reason: 'invalid-action' };
    var selected = clampLevel(level), normalized = normalize(save);
    if (selected > normalized.unlocked) return { ok: false, reason: 'not-unlocked' };
    if (selected === normalized.selected) return { ok: false, reason: 'already-selected' };
    save.tokenEvo = selected;
    var saved = false;
    try { saved = persist() === true; } catch (error) { saved = false; }
    if (!saved) { save.tokenEvo = normalized.selected; return { ok: false, reason: 'save-failed' }; }
    var meta = levelOf(selected);
    return { ok: true, level: selected, id: meta.id, name: meta.name };
  }
  function collectEligible(save) {
    if (!save) return [];
    var granted = [];
    applyNormalize(save);
    while (true) {
      var gate = canUnlockNext(save);
      if (!gate.ok) break;
      save.tokenEvoUnlocked = gate.next.level;
      if (save.tokenEvo < save.tokenEvoUnlocked) save.tokenEvo = save.tokenEvoUnlocked;
      granted.push({ level: gate.next.level, id: gate.next.id, name: gate.next.name });
    }
    return granted;
  }
  function cssVars(level) {
    var meta = levelOf(level);
    return { gloss: meta.gloss, glow: meta.glow, particles: meta.particles, badge: meta.badge, label: meta.name };
  }
  return { LABELS: LABELS, LEVELS: LEVELS, maxLevel: 5, clampLevel: clampLevel, levelOf: levelOf,
    normalize: normalize, applyNormalize: applyNormalize, canUnlockNext: canUnlockNext, state: state,
    unlockNext: unlockNext, select: select, collectEligible: collectEligible, cssVars: cssVars,
    completedOf: completedOf };
});
