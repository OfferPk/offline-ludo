/* v1.8.2 Match Summary — pure helpers for the result screen (cosmetic progress only). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MatchSummary = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KINDS = ['capture', 'six', 'arrow', 'home'];
  var LABELS = { capture: 'Captures', six: 'Sixes', arrow: 'Arrows', home: 'Home' };
  function blank() { return { capture: 0, six: 0, arrow: 0, home: 0 }; }
  function normalize(t) { var o = blank(); if (t && typeof t === 'object') KINDS.forEach(function (k) { var v = t[k]; if (typeof v === 'number' && v >= 0 && v < 10000 && Math.floor(v) === v) o[k] = v; }); return o; }
  function add(t, kind, n) { if (!t || KINDS.indexOf(kind) < 0) return t; t[kind] += (typeof n === 'number' && n > 0 && n < 100) ? Math.floor(n) : 1; return t; }
  function chips(t) { t = t || blank(); return KINDS.map(function (k) { return { kind: k, label: LABELS[k], value: t[k] || 0 }; }); }
  /** Closest not-owned skin by free milestone progress (0..1). Returns null when every milestone skin is owned. */
  function nextGoal(save, TS) {
    if (!TS || !save) return null;
    var owned = save.tokenSkinsOwned || [], best = null;
    TS.SKINS.forEach(function (s) {
      if (s.starter || owned.indexOf(s.id) >= 0 || (!s.wins && !s.kills)) return;
      var st = TS.state(s.id, save), parts = [];
      if (s.wins) parts.push(st.progressWins / s.wins);
      if (s.kills) parts.push(st.progressKills / s.kills);
      var pct = Math.min.apply(null, parts);
      if (!best || pct > best.pct) best = { id: s.id, name: s.name, rarity: s.rarity, pct: pct,
        text: (s.wins ? st.progressWins + '/' + s.wins + ' wins' : '') + (s.wins && s.kills ? ' · ' : '') + (s.kills ? st.progressKills + '/' + s.kills + ' captures' : '') };
    });
    return best;
  }
  return { KINDS: KINDS, blank: blank, normalize: normalize, add: add, chips: chips, nextGoal: nextGoal };
});
