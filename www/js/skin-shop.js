/* Data-driven local-only cosmetic shop helpers. No networking, currency purchase, or gameplay effects. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkinShop = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function normalizeOwned(raw, defaults) {
    var out = [];
    function add(id) {
      if (typeof id === 'string' && id.length <= 32 && out.indexOf(id) < 0 && out.length < 32) out.push(id);
    }
    if (Array.isArray(raw)) raw.forEach(add);
    (defaults || []).forEach(add);
    return out;
  }
  function list(save, kind) {
    return save && save.owned && Array.isArray(save.owned[kind]) ? save.owned[kind] : [];
  }
  function conditionMet(item, save) {
    if (!item || !item.unlock) return true;
    var stats = save && save.stats || {};
    if (item.unlock === 'wins') return Number.isSafeInteger(stats.won) && stats.won >= item.threshold;
    if (item.unlock === 'streak') return Number.isSafeInteger(stats.streak) && stats.streak >= item.threshold;
    if (item.unlock === 'event') return !!(save && isRecord(save.flags) && item.flag && save.flags[item.flag] === true);
    return false;
  }
  function state(item, save, kind) {
    var owned = list(save, kind).indexOf(item.id) >= 0;
    var selectedKey = kind === 'boards' ? 'board' : 'dice';
    var selected = !!save && save[selectedKey] === item.id;
    var meetsCondition = conditionMet(item, save);
    var price = Number.isSafeInteger(item.price) && item.price >= 0 ? item.price : 0;
    return {
      owned: owned,
      selected: selected,
      meetsCondition: meetsCondition,
      affordable: !!save && Number.isSafeInteger(save.coins) && save.coins >= price,
      price: price,
      canUnlock: !owned && meetsCondition && !!save && Number.isSafeInteger(save.coins) && save.coins >= price
    };
  }
  function act(save, kind, item, persist) {
    if (!save || (kind !== 'boards' && kind !== 'dice') || !item || typeof item.id !== 'string' || typeof persist !== 'function') {
      return { ok: false, reason: 'invalid-action' };
    }
    if (!save.owned || !Array.isArray(save.owned[kind])) return { ok: false, reason: 'invalid-ownership' };
    var selectedKey = kind === 'boards' ? 'board' : 'dice';
    var owned = save.owned[kind];
    var wasOwned = owned.indexOf(item.id) >= 0;
    if (!wasOwned) {
      var current = state(item, save, kind);
      if (!current.meetsCondition) return { ok: false, reason: item.unlock === 'event' ? 'event-locked' : 'achievement-locked' };
      if (!current.affordable) return { ok: false, reason: 'insufficient-coins' };
    } else if (save[selectedKey] === item.id) return { ok: false, reason: 'already-selected' };

    var previousCoins = save.coins;
    var previousSelection = save[selectedKey];
    var previousOwned = owned.slice();
    if (!wasOwned) {
      save.coins -= state(item, save, kind).price;
      owned.push(item.id);
    }
    save[selectedKey] = item.id;
    var saved = false;
    try { saved = persist() === true; } catch (e) { saved = false; }
    if (!saved) {
      save.coins = previousCoins;
      save[selectedKey] = previousSelection;
      save.owned[kind] = previousOwned;
      return { ok: false, reason: 'save-failed' };
    }
    return { ok: true, newlyOwned: !wasOwned, price: wasOwned ? 0 : state(item, save, kind).price, id: item.id };
  }
  function collectEligible(save, catalogs) {
    if (!save || !save.owned || !catalogs) return [];
    var unlocked = [];
    ['boards', 'dice'].forEach(function (kind) {
      var owned = save.owned[kind];
      var items = catalogs[kind] || catalogs[kind === 'boards' ? 'BOARDS' : 'DICE'] || [];
      if (!Array.isArray(owned)) return;
      items.forEach(function (item) {
        if (item.unlock && conditionMet(item, save) && owned.indexOf(item.id) < 0) {
          owned.push(item.id);
          unlocked.push({ kind: kind, id: item.id, name: item.name });
        }
      });
    });
    return unlocked;
  }
  return { normalizeOwned: normalizeOwned, conditionMet: conditionMet, state: state, act: act, collectEligible: collectEligible };
});
