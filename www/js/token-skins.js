/* Token Skins + Token Vault — offline cosmetic token materials (v1.8.0).
 * Original Crossfour art only. No IAP, no betting, no cash value: coins are a cosmetic soft currency earned in matches.
 * Every skin keeps the seat colour readable (seat-tinted glass / base band / pad), and Token Evolution Lv1–5 layers on top. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenSkins = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RARITIES = [
    { id: 'common', name: 'Common', color: '#aab6c4', rank: 1 },
    { id: 'rare', name: 'Rare', color: '#4fa8ff', rank: 2 },
    { id: 'epic', name: 'Epic', color: '#b678ff', rank: 3 },
    { id: 'legendary', name: 'Legendary', color: '#ffb02e', rank: 4 },
    { id: 'mythic', name: 'Mythic', color: '#ff6fb5', rank: 5 }
  ];

  /* unlock: coins (spend any time) OR free milestone (lifetime wins / captures; both required when both are set). */
  var SKINS = [
    { id: 'classic', name: 'Classic', rarity: 'common', coins: 0, wins: 0, kills: 0, starter: true, trail: 'default', fx: 'none',
      metal: null, blurb: 'Seat-coloured crystal with a polished metal rim. Starter skin.' },
    { id: 'ruby', name: 'Ruby', rarity: 'common', coins: 150, wins: 3, kills: 0, trail: 'default', fx: 'brilliant', gem: '#e0263f',
      metal: ['#ffe9de', '#e6a58f', '#8c4636'], core: '#ff9aa8', blurb: 'Brilliant-cut facets, rose-gold rim and a ruby inlay with warm inner fire.' },
    { id: 'emerald', name: 'Emerald', rarity: 'common', coins: 150, wins: 0, kills: 10, trail: 'default', fx: 'step', gem: '#14a86a',
      metal: ['#f4fff8', '#bcd9c9', '#3a604e'], core: '#a4ffd4', blurb: 'Step-cut emerald facets, white-gold rim and a green inlay.' },
    { id: 'sapphire', name: 'Sapphire', rarity: 'rare', coins: 300, wins: 8, kills: 0, trail: 'default', fx: 'star', gem: '#2a5ef0',
      metal: ['#f5f8ff', '#b8c6dc', '#46567a'], core: '#bcd2ff', blurb: 'Star-sapphire asterism in the head, platinum rim, blue inlay.' },
    { id: 'royal', name: 'Royal', rarity: 'rare', coins: 450, wins: 15, kills: 0, trail: 'gold', fx: 'royal', gem: '#ffd34d',
      metal: ['#fff7d2', '#e8bf52', '#875c10'], core: '#fff0b8', blurb: 'Solid gold rim, gold crown emblem and a filigree base. Golden trail.' },
    { id: 'diamond', name: 'Diamond', rarity: 'epic', coins: 800, wins: 0, kills: 40, trail: 'frost', fx: 'diamond', gem: '#e8fbff', clear: 0.62,
      metal: ['#ffffff', '#cfd9e6', '#6d7d94'], core: '#ffffff', blurb: 'Clear faceted diamond, seat-tinted base band, prism sparkles. Frost trail.' },
    { id: 'cyber', name: 'Cyber', rarity: 'epic', coins: 900, wins: 25, kills: 0, trail: 'electric', fx: 'cyber', dark: '#0a111d',
      metal: ['#e6f0ff', '#7f8ca3', '#1b222e'], core: null, blurb: 'Smoked black glass with seat-colour neon circuits. Electric trail.' },
    { id: 'galaxy', name: 'Galaxy', rarity: 'legendary', coins: 1500, wins: 40, kills: 0, trail: 'stars', fx: 'galaxy', dark: '#120c34', gem: '#a46bff',
      metal: ['#eee8ff', '#9c90cc', '#352d62'], core: '#e6dcff', blurb: 'A seat-coloured nebula and twinkling stars inside the glass. Star trail.' },
    { id: 'inferno', name: 'Inferno', rarity: 'legendary', coins: 1500, wins: 0, kills: 100, trail: 'fire', fx: 'inferno', dark: '#2a0904', gem: '#ff7a1a',
      metal: ['#ffd9a8', '#c4642a', '#3a1306'], core: '#ffd27a', blurb: 'Blackened bronze rim with a living flame inside. Fire trail.' },
    { id: 'mythic', name: 'Mythic', rarity: 'mythic', coins: 3000, wins: 75, kills: 150, trail: 'mythic', fx: 'mythic', gem: '#ff9ae6',
      metal: ['#ffffff', '#f2c6ff', '#7b4bc4'], core: '#fff4ff', blurb: 'Iridescent premium glass with an animated light sweep and crest. Prism trail.' },
    { id: 'demetrius', name: 'King Demetrius I', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'gold', fx: 'vine', gem: '#3fae5a', perk: 'demetrius',
      metal: ['#fff7d2', '#e8bf52', '#875c10'], core: '#eafff0', blurb: 'Sovereign Royal Hymnodist King pawn: golden vine inlay, seat-tinted glass. Star landings rally allies (+1 step, vine shield).' },
    { id: 'george', name: 'King George III', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'crown', gem: '#ffd34d', perk: 'george',
      metal: ['#fffbe8', '#f0c75e', '#7a5200'], core: '#ffe9a8', blurb: 'Sovereign Golden Age Architect Monarch pawn: laurel crown, seat-tinted glass. Captures sprint allies +2 and double match coins.' }
  ];

  var IDS = SKINS.map(function (s) { return s.id; });
  function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isCount(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= 0 && x <= 9007199254740991; }
  function byId(id) { for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i]; return null; }
  function rarityOf(id) { var s = byId(id); var r = s ? s.rarity : 'common'; for (var i = 0; i < RARITIES.length; i++) if (RARITIES[i].id === r) return RARITIES[i]; return RARITIES[0]; }
  function winsOf(save) { return save && isRecord(save.stats) && isCount(save.stats.won) ? save.stats.won : 0; }
  function killsOf(save) { return save && isRecord(save.stats) && isCount(save.stats.captures) ? save.stats.captures : 0; }
  function coinsOf(save) { return save && isCount(save.coins) ? save.coins : 0; }
  function blankStats() { return { kills: 0, wins: 0, played: 0 }; }

  /** Normalise raw save fields into { owned, equipped, stats } (never throws). */
  function normalize(raw) {
    var owned = ['classic'];
    if (raw && Array.isArray(raw.tokenSkinsOwned)) raw.tokenSkinsOwned.forEach(function (id) { if (IDS.indexOf(id) >= 0 && owned.indexOf(id) < 0) owned.push(id); });
    owned.sort(function (a, b) { return IDS.indexOf(a) - IDS.indexOf(b); });
    var equipped = raw && typeof raw.tokenSkin === 'string' && owned.indexOf(raw.tokenSkin) >= 0 ? raw.tokenSkin : 'classic';
    var stats = {};
    var rs = raw && isRecord(raw.tokenSkinStats) ? raw.tokenSkinStats : {};
    IDS.forEach(function (id) {
      var r = isRecord(rs[id]) ? rs[id] : {};
      stats[id] = { kills: isCount(r.kills) ? r.kills : 0, wins: isCount(r.wins) ? r.wins : 0, played: isCount(r.played) ? r.played : 0 };
    });
    return { owned: owned, equipped: equipped, stats: stats };
  }
  function applyNormalize(save) {
    var n = normalize(save);
    save.tokenSkinsOwned = n.owned; save.tokenSkin = n.equipped; save.tokenSkinStats = n.stats;
    return n;
  }
  function isValid(save) {
    if (!save || !Array.isArray(save.tokenSkinsOwned) || typeof save.tokenSkin !== 'string' || !isRecord(save.tokenSkinStats)) return false;
    if (save.tokenSkinsOwned.indexOf('classic') < 0 || save.tokenSkinsOwned.indexOf(save.tokenSkin) < 0) return false;
    if (!save.tokenSkinsOwned.every(function (id) { return IDS.indexOf(id) >= 0; })) return false;
    return Object.keys(save.tokenSkinStats).every(function (id) {
      var r = save.tokenSkinStats[id];
      return IDS.indexOf(id) >= 0 && isRecord(r) && isCount(r.kills) && isCount(r.wins) && isCount(r.played);
    });
  }
  function milestoneMet(skin, save) {
    if (!skin) return false;
    if (skin.starter) return true;
    if (!skin.wins && !skin.kills) return false;
    return winsOf(save) >= (skin.wins || 0) && killsOf(save) >= (skin.kills || 0);
  }
  function milestoneText(skin) {
    if (!skin || skin.starter) return 'Starter';
    var parts = [];
    if (skin.wins) parts.push(skin.wins + ' wins');
    if (skin.kills) parts.push(skin.kills + ' captures');
    return parts.join(' + ');
  }
  function unlockText(skin) {
    if (!skin || skin.starter) return 'Starter · owned';
    return skin.coins.toLocaleString('en-US') + ' coins or ' + milestoneText(skin) + ' (free)';
  }
  function state(id, save) {
    var skin = byId(id);
    var n = normalize(save);
    var owned = n.owned.indexOf(id) >= 0;
    var free = milestoneMet(skin, save);
    var coins = coinsOf(save);
    return {
      id: id, skin: skin, rarity: rarityOf(id), owned: owned, equipped: n.equipped === id,
      milestone: free, affordable: !!skin && coins >= skin.coins,
      canUnlock: !owned && !!skin && (free || coins >= skin.coins),
      needCoins: skin ? Math.max(0, skin.coins - coins) : 0,
      needWins: skin ? Math.max(0, (skin.wins || 0) - winsOf(save)) : 0,
      needKills: skin ? Math.max(0, (skin.kills || 0) - killsOf(save)) : 0,
      progressWins: Math.min(winsOf(save), skin ? skin.wins || 0 : 0),
      progressKills: Math.min(killsOf(save), skin ? skin.kills || 0 : 0),
      stats: n.stats[id] || blankStats()
    };
  }
  /* v1.8.4 Skin Mastery: 0-3 stars per skin, derived only from that skin's own Kills/Wins (cosmetic, no save change). */
  var MASTERY = [{ wins: 1, kills: 5, name: 'Bronze' }, { wins: 5, kills: 25, name: 'Silver' }, { wins: 15, kills: 75, name: 'Gold' }];
  function mastery(stats) {
    var r = stats && typeof stats === 'object' ? stats : blankStats(), w = r.wins || 0, k = r.kills || 0, stars = 0;
    MASTERY.forEach(function (t, i) { if (w >= t.wins || k >= t.kills) stars = i + 1; });
    var next = MASTERY[stars] || null;
    return { stars: stars, name: stars ? MASTERY[stars - 1].name : 'None', next: next,
      pct: next ? Math.min(1, Math.max(w / next.wins, k / next.kills)) : 1,
      text: next ? 'next: ' + next.wins + ' wins or ' + next.kills + ' kills' : 'Mastered' };
  }
  function commit(save, persist, mutate) {
    var snap = { coins: save.coins, owned: (save.tokenSkinsOwned || []).slice(), eq: save.tokenSkin };
    mutate();
    var saved = false;
    try { saved = persist() === true; } catch (e) { saved = false; }
    if (!saved) { save.coins = snap.coins; save.tokenSkinsOwned = snap.owned; save.tokenSkin = snap.eq; }
    return saved;
  }
  /** Unlock (free via milestone, else spend coins) and equip. */
  function unlock(save, id, persist) {
    if (!save || typeof persist !== 'function' || !byId(id)) return { ok: false, reason: 'invalid-action' };
    applyNormalize(save);
    var st = state(id, save);
    if (st.owned) return { ok: false, reason: 'owned' };
    if (!st.canUnlock) return { ok: false, reason: 'locked', needCoins: st.needCoins, needWins: st.needWins, needKills: st.needKills };
    var spent = st.milestone ? 0 : st.skin.coins;
    var ok = commit(save, persist, function () {
      save.coins -= spent;
      save.tokenSkinsOwned.push(id);
      save.tokenSkinsOwned.sort(function (a, b) { return IDS.indexOf(a) - IDS.indexOf(b); });
      save.tokenSkin = id;
    });
    if (!ok) return { ok: false, reason: 'save-failed' };
    return { ok: true, id: id, name: st.skin.name, spent: spent, free: spent === 0 };
  }
  function equip(save, id, persist) {
    if (!save || typeof persist !== 'function' || !byId(id)) return { ok: false, reason: 'invalid-action' };
    applyNormalize(save);
    if (save.tokenSkinsOwned.indexOf(id) < 0) return { ok: false, reason: 'not-owned' };
    if (save.tokenSkin === id) return { ok: false, reason: 'already-equipped' };
    var ok = commit(save, persist, function () { save.tokenSkin = id; });
    if (!ok) return { ok: false, reason: 'save-failed' };
    return { ok: true, id: id, name: byId(id).name };
  }
  /** Grant every skin whose free milestone is reached (no coin spend, equip unchanged). Caller persists. */
  function collectEligible(save) {
    if (!save) return [];
    applyNormalize(save);
    var granted = [];
    SKINS.forEach(function (s) {
      if (save.tokenSkinsOwned.indexOf(s.id) < 0 && milestoneMet(s, save)) { save.tokenSkinsOwned.push(s.id); granted.push({ id: s.id, name: s.name }); }
    });
    save.tokenSkinsOwned.sort(function (a, b) { return IDS.indexOf(a) - IDS.indexOf(b); });
    return granted;
  }
  /** Per-skin stats: increment for the skin that is equipped right now. */
  function recordKills(save, n) {
    if (!save || !(n > 0)) return;
    applyNormalize(save);
    save.tokenSkinStats[save.tokenSkin].kills += Math.floor(n);
  }
  function recordMatch(save, won) {
    if (!save) return;
    applyNormalize(save);
    var r = save.tokenSkinStats[save.tokenSkin];
    r.played += 1; if (won) r.wins += 1;
  }

  // ---- colour helpers (pure) ----
  function hex2rgb(h) { h = String(h || '#888888').replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function toHex(c) { return '#' + c.map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  function blend(a, b, f) { var x = hex2rgb(a), y = hex2rgb(b); return toHex(x.map(function (v, i) { return v + (y[i] - v) * f; })); }

  /**
   * Material for one token: seat colour stays the dominant read (glass tint / band / pad), skin adds metal, cut and inner FX.
   * classicMat = the seat's classic crystal { rim0, rim1, rim2, glassHi, glassMid, glassLo }.
   */
  function material(id, seatHex, classicMat, coreLight) {
    var s = byId(id) || SKINS[0];
    var m = classicMat || { rim0: '#ffffff', rim1: '#cccccc', rim2: '#555555', glassHi: blend(seatHex, '#ffffff', 0.5), glassMid: seatHex, glassLo: blend(seatHex, '#000000', 0.45) };
    var out = {
      rim0: m.rim0, rim1: m.rim1, rim2: m.rim2, glassHi: m.glassHi, glassMid: m.glassMid, glassLo: m.glassLo,
      core: coreLight || blend(seatHex, '#ffffff', 0.65), band: seatHex, bandHi: blend(seatHex, '#ffffff', 0.45), bandLo: blend(seatHex, '#000000', 0.42),
      neon: blend(seatHex, '#ffffff', 0.28), gem: s.gem || seatHex
    };
    if (s.metal) { out.rim0 = s.metal[0]; out.rim1 = s.metal[1]; out.rim2 = s.metal[2]; }
    if (s.core) out.core = s.core;
    if (s.id === 'diamond') {
      out.glassHi = '#ffffff'; out.glassMid = blend(seatHex, '#ffffff', s.clear); out.glassLo = blend(seatHex, '#ffffff', 0.22);
    } else if (s.id === 'cyber') {
      out.glassHi = blend(seatHex, s.dark, 0.62); out.glassMid = blend(seatHex, s.dark, 0.84); out.glassLo = s.dark; out.core = out.neon;
    } else if (s.id === 'galaxy') {
      out.glassHi = blend(seatHex, s.dark, 0.35); out.glassMid = blend(seatHex, s.dark, 0.7); out.glassLo = blend(s.dark, '#000000', 0.35);
    } else if (s.id === 'inferno') {
      out.glassHi = blend(seatHex, s.dark, 0.38); out.glassMid = blend(seatHex, s.dark, 0.66); out.glassLo = s.dark;
    } else if (s.id === 'royal') {
      out.glassHi = blend(seatHex, '#fff4cc', 0.5); out.glassMid = seatHex; out.glassLo = blend(seatHex, '#2a1600', 0.5);
    } else if (s.id === 'demetrius') {
      out.glassHi = blend(seatHex, '#eafff0', 0.35); out.glassMid = seatHex; out.glassLo = blend(seatHex, '#0d2b12', 0.5);
    } else if (s.id === 'george') {
      out.glassHi = blend(seatHex, '#fff4cc', 0.55); out.glassMid = seatHex; out.glassLo = blend(seatHex, '#2a1600', 0.45);
    } else if (s.id === 'mythic') {
      out.glassHi = blend(seatHex, '#ffffff', 0.62); out.glassMid = blend(seatHex, '#f3d9ff', 0.18); out.glassLo = blend(seatHex, '#2a0f4a', 0.45);
    }
    return out;
  }

  return {
    RARITIES: RARITIES, SKINS: SKINS, IDS: IDS,
    byId: byId, rarityOf: rarityOf, normalize: normalize, applyNormalize: applyNormalize, isValid: isValid,
    milestoneMet: milestoneMet, milestoneText: milestoneText, unlockText: unlockText,
    state: state, unlock: unlock, equip: equip, collectEligible: collectEligible,
    recordKills: recordKills, recordMatch: recordMatch, MASTERY: MASTERY, mastery: mastery, material: material, blend: blend
  };
});
