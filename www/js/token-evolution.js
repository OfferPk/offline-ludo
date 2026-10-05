/* Token Evolution — offline cosmetic progression (Lv1–Lv5). No IAP; unlock with coins and/or match wins. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenEvolution = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LABELS = ['Basic', 'Polished', 'Elite', 'Mythic', 'Legendary'];
  var LEVELS = [
    { level: 1, id: 'basic', name: 'Basic', coinCost: 0, winsRequired: 0, gloss: 1, glow: 1, particles: 0, badge: false,
      blurb: 'Starter crystal — clean metallic rim and soft jugnu glow.' },
    { level: 2, id: 'polished', name: 'Polished', coinCost: 200, winsRequired: 3, gloss: 1.18, glow: 1.25, particles: 1, badge: false,
      blurb: 'Extra sheen and a brighter jugnu aura. Tiny sparkles on hops.' },
    { level: 3, id: 'elite', name: 'Elite', coinCost: 500, winsRequired: 12, gloss: 1.32, glow: 1.5, particles: 2, badge: false,
      blurb: 'Deeper gloss, stronger glow, and more hop particles.' },
    { level: 4, id: 'mythic', name: 'Mythic', coinCost: 1000, winsRequired: 30, gloss: 1.48, glow: 1.75, particles: 3, badge: true,
      blurb: 'Mythic sheen with a small Crossfour badge beside your tokens.' },
    { level: 5, id: 'legendary', name: 'Legendary', coinCost: 2000, winsRequired: 60, gloss: 1.65, glow: 2.05, particles: 5, badge: true,
      blurb: 'Max gloss, glow, particles, and the Legendary badge.' }
  ];

  function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function clampLevel(n) {
    var v = typeof n === 'number' && isFinite(n) ? Math.floor(n) : 1;
    if (v < 1) return 1;
    if (v > 5) return 5;
    return v;
  }
  function levelOf(n) {
    var lv = clampLevel(n);
    return LEVELS[lv - 1];
  }
  function winsOf(save) {
    return save && isRecord(save.stats) && Number.isSafeInteger(save.stats.won) && save.stats.won >= 0 ? save.stats.won : 0;
  }
  function coinsOf(save) {
    return save && Number.isSafeInteger(save.coins) && save.coins >= 0 ? save.coins : 0;
  }
  function normalize(save) {
    if (!save || !isRecord(save)) return { unlocked: 1, selected: 1 };
    var unlocked = clampLevel(save.tokenEvoUnlocked);
    var selected = clampLevel(save.tokenEvo);
    if (selected > unlocked) selected = unlocked;
    return { unlocked: unlocked, selected: selected };
  }
  function applyNormalize(save) {
    var n = normalize(save);
    save.tokenEvoUnlocked = n.unlocked;
    save.tokenEvo = n.selected;
    return n;
  }
  function canUnlockNext(save) {
    var n = normalize(save);
    if (n.unlocked >= 5) return { ok: false, reason: 'maxed', next: null };
    var next = LEVELS[n.unlocked]; // index = unlocked (0-based next is unlocked)
    var wins = winsOf(save);
    var coins = coinsOf(save);
    var byWins = wins >= next.winsRequired;
    var byCoins = coins >= next.coinCost;
    if (!byWins && !byCoins) {
      return {
        ok: false,
        reason: 'locked',
        next: next,
        byWins: false,
        byCoins: false,
        needWins: Math.max(0, next.winsRequired - wins),
        needCoins: Math.max(0, next.coinCost - coins)
      };
    }
    return { ok: true, next: next, byWins: byWins, byCoins: byCoins, free: byWins };
  }
  function state(level, save) {
    var meta = levelOf(level);
    var n = normalize(save);
    var owned = meta.level <= n.unlocked;
    var selected = meta.level === n.selected;
    var isNext = meta.level === n.unlocked + 1;
    var unlock = isNext ? canUnlockNext(save) : null;
    return {
      level: meta.level,
      id: meta.id,
      name: meta.name,
      owned: owned,
      selected: selected,
      isNext: isNext,
      meta: meta,
      unlock: unlock,
      canUnlock: !!(unlock && unlock.ok),
      canSelect: owned && !selected
    };
  }
  /** Unlock next level: free if wins met, else spend coins. Returns result object. */
  function unlockNext(save, persist) {
    if (!save || typeof persist !== 'function') return { ok: false, reason: 'invalid-action' };
    var gate = canUnlockNext(save);
    if (!gate.ok) return { ok: false, reason: gate.reason || 'locked', next: gate.next, needWins: gate.needWins, needCoins: gate.needCoins };
    var n = normalize(save);
    var next = gate.next;
    var previousCoins = save.coins;
    var previousUnlocked = n.unlocked;
    var previousSelected = n.selected;
    var spent = 0;
    if (!gate.free) {
      spent = next.coinCost;
      save.coins -= spent;
    }
    save.tokenEvoUnlocked = next.level;
    save.tokenEvo = next.level;
    var saved = false;
    try { saved = persist() === true; } catch (e) { saved = false; }
    if (!saved) {
      save.coins = previousCoins;
      save.tokenEvoUnlocked = previousUnlocked;
      save.tokenEvo = previousSelected;
      return { ok: false, reason: 'save-failed' };
    }
    return { ok: true, level: next.level, id: next.id, name: next.name, spent: spent, free: !!gate.free };
  }
  /** Select an already-unlocked level. */
  function select(save, level, persist) {
    if (!save || typeof persist !== 'function') return { ok: false, reason: 'invalid-action' };
    var lv = clampLevel(level);
    var n = normalize(save);
    if (lv > n.unlocked) return { ok: false, reason: 'not-unlocked' };
    if (lv === n.selected) return { ok: false, reason: 'already-selected' };
    var previous = n.selected;
    save.tokenEvo = lv;
    var saved = false;
    try { saved = persist() === true; } catch (e) { saved = false; }
    if (!saved) {
      save.tokenEvo = previous;
      return { ok: false, reason: 'save-failed' };
    }
    return { ok: true, level: lv, id: levelOf(lv).id, name: levelOf(lv).name };
  }
  /** Auto-grant free win unlocks (no coin spend). Call after match stats update. */
  function collectEligible(save) {
    if (!save) return [];
    var granted = [];
    applyNormalize(save);
    while (true) {
      var gate = canUnlockNext(save);
      if (!gate.ok || !gate.free) break;
      save.tokenEvoUnlocked = gate.next.level;
      if (save.tokenEvo < save.tokenEvoUnlocked) save.tokenEvo = save.tokenEvoUnlocked;
      granted.push({ level: gate.next.level, id: gate.next.id, name: gate.next.name });
    }
    return granted;
  }
  function cssVars(level) {
    var m = levelOf(level);
    return {
      gloss: m.gloss,
      glow: m.glow,
      particles: m.particles,
      badge: m.badge,
      label: m.name
    };
  }
  return {
    LABELS: LABELS,
    LEVELS: LEVELS,
    maxLevel: 5,
    clampLevel: clampLevel,
    levelOf: levelOf,
    normalize: normalize,
    applyNormalize: applyNormalize,
    canUnlockNext: canUnlockNext,
    state: state,
    unlockNext: unlockNext,
    select: select,
    collectEligible: collectEligible,
    cssVars: cssVars,
    winsOf: winsOf
  };
});
