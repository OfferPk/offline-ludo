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
      metal: ['#fffbe8', '#f0c75e', '#7a5200'], core: '#ffe9a8', blurb: 'Sovereign Golden Age Architect Monarch pawn: laurel crown, seat-tinted glass. Captures sprint allies +2 and double match coins.' },
    // --- Sovereign Kings pack (L2): one pawn per unique monarch; perks are gameplay variety, never power for sale. ---
    { id: 'george-v', name: 'King George V', rarity: 'mythic', coins: 3000, wins: 60, kills: 50, trail: 'stars', fx: 'crown', gem: '#7fb2ff', perk: 'george-v',
      metal: ['#eaf2ff', '#8fb4e8', '#2a4a7a'], core: '#dbeaff', blurb: 'The Brilliant Restorer: star landings leap all allies +2 and set a minimum roll of 3 for two rounds.' },
    { id: 'george-xii', name: 'King George XII', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'crown', gem: '#c9a227', perk: 'george-xii',
      metal: ['#fff7d2', '#e8bf52', '#875c10'], core: '#fff0b8', blurb: 'The Last Crown: star landings rally allies +1 step and double match coins.' },
    { id: 'heraclius-ii', name: 'King Heraclius II', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'royal', gem: '#d4af37', perk: 'heraclius-ii',
      metal: ['#fff7d2', '#e8bf52', '#875c10'], core: '#fff0b8', blurb: 'Kartli Shield: any landing rallies allies +1 step and shields allies within 3 tiles from capture.' },
    { id: 'jesse', name: 'Jesse of Kakheti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#8a6d3b', perk: 'jesse',
      metal: ['#f4ead2', '#c9a86a', '#6b4f22'], core: '#f0e2c0', blurb: 'Dual Throne: star landings shield allies within 2 tiles from capture.' },
    { id: 'solomon-i', name: 'Solomon I of Imereti', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'stars', fx: 'crown', gem: '#2e8b74', perk: 'solomon-i',
      metal: ['#e2fff6', '#7fc9b4', '#1d5c4c'], core: '#d2f5ea', blurb: 'Imereti Awakening: captures free every base pawn onto the start square and sprint the captor +2.' },
    { id: 'vakhtang-vi', name: 'Vakhtang VI', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'royal', gem: '#5b7fb8', perk: 'vakhtang-vi',
      metal: ['#eaf0ff', '#93aede', '#2c4a72'], core: '#dbe6ff', blurb: 'Law-Giver: any landing shields allies within 2 tiles from capture.' },
    { id: 'erekle-i', name: 'Erekle I', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'star', gem: '#b8860b', perk: 'erekle-i',
      metal: ['#fff2cc', '#d9a441', '#7a5510'], core: '#ffedb8', blurb: 'Eagle Sprint: rolling 5 or 6 propels a nearby ally +2 tiles forward.' },
    { id: 'archil', name: 'Archil of Imereti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#7a5c9e', perk: 'archil',
      metal: ['#f1e8ff', '#a98fd0', '#4a2f6e'], core: '#e9dcff', blurb: 'Royal Summons: landing near the home stretch gives base pawns +2 on their next move.' },
    { id: 'teimuraz-i', name: 'Teimuraz I', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'fire', fx: 'royal', gem: '#a03030', perk: 'teimuraz-i',
      metal: ['#ffe2e2', '#d08a8a', '#6e2222'], core: '#ffd0d0', blurb: "Martyr's Rally: when an ally falls, the survivors gain +1 step." },
    { id: 'george-xi', name: 'George XI', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'crown', gem: '#c0c0c0', perk: 'george-xi',
      metal: ['#ffffff', '#c8ccd4', '#5a5e68'], core: '#f0f2f6', blurb: 'Shield Clash: landing near an ally lifts both paws +1 and arms both to repel attackers 1 tile.' },
    { id: 'rostom', name: 'Rostom of Kartli', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'gold', fx: 'brilliant', gem: '#cd7f32', perk: 'rostom',
      metal: ['#ffe8d2', '#d99a5b', '#7a4416'], core: '#ffdcb8', blurb: "Rostom's Bounty: star landings rally allies +1 step and add +50 match coins." },
    { id: 'giorgi-vii', name: 'Giorgi VII', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'fire', fx: 'royal', gem: '#8b0000', perk: 'giorgi-vii',
      metal: ['#ffe2e2', '#c97a7a', '#5e1010'], core: '#ffcccc', blurb: 'Nakhichevan Stand: entrenched stand — survives any strike, knocks the attacker back 2 and stuns them a turn.' },
    { id: 'luarsab-i', name: 'Luarsab I', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'star', gem: '#4a6741', perk: 'luarsab-i',
      metal: ['#e6f0e2', '#8fb48a', '#2c4a28'], core: '#d8ecd4', blurb: 'Mutual Clash: no one captures this pawn — attacker and defender both bounce back 1 tile.' },
    { id: 'levan', name: 'Levan of Kakheti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'stars', fx: 'star', gem: '#3d7a5c', perk: 'levan',
      metal: ['#e2fff2', '#8cc9ab', '#1e5c40'], core: '#d2f5e2', blurb: 'Kakheti Vision: star landings step +1 and add +25 match coins.' },
    { id: 'constantine-ii', name: 'Constantine II', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#2f4f6f', perk: 'constantine-ii',
      metal: ['#e2ecf5', '#8aa8c8', '#24405e'], core: '#d4e2f0', blurb: 'Corner Bastion: landing on a corner square shields allies within 2 tiles from capture.' },
    { id: 'george-ii-kakheti', name: 'George II of Kakheti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#6b7c93', perk: 'george-ii-kakheti',
      metal: ['#eef1f5', '#a8b4c4', '#46586e'], core: '#e2e8f0', blurb: 'Iron Counter-Bash: entrenched stand — survives any strike, knocks the attacker back 2 and stuns them a turn.' },
    { id: 'alexander-i-kakheti', name: 'Alexander I of Kakheti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'brilliant', gem: '#9e7b4f', perk: 'alexander-i-kakheti',
      metal: ['#f5ecd8', '#c4a271', '#6b4f22'], core: '#efe0c0', blurb: 'Diplomatic Sanctuary: any landing turns the square into a safe sanctuary for two rounds.' },
    { id: 'alexander-ii-imereti', name: 'Alexander II of Imereti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#1f6f5c', perk: 'alexander-ii-imereti',
      metal: ['#e2fff6', '#7fc9b4', '#1d5c4c'], core: '#d2f5ea', blurb: 'Imereti Bastion: landing on a corner square shields allies within 2 tiles from capture.' },
    { id: 'george-iv', name: 'George IV Lasha', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'fire', fx: 'crown', gem: '#e8b923', perk: 'george-iv',
      metal: ['#fff6cc', '#e8c95a', '#7a5e10'], core: '#ffedb8', blurb: 'Chivalric Charge: any landing rushes a capturable foe up to 3 tiles ahead and earns a bonus roll.' },
    { id: 'rusudan', name: 'Queen Rusudan', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'crown', gem: '#d94f70', perk: 'rusudan',
      metal: ['#ffe8ee', '#e89ab0', '#7a2440'], core: '#ffd4de', blurb: 'Golden Double: rolling 1 or 2 doubles the roll (to 2 or 4 tiles) via a pending bonus.' },
    { id: 'demetre-ii', name: 'Demetre II', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'fire', fx: 'royal', gem: '#7a1f1f', perk: 'demetre-ii',
      metal: ['#ffe2e2', '#c97a7a', '#5e1010'], core: '#ffcccc', blurb: "Martyr's Surge: when this pawn falls, the survivors surge +2 steps." },
    { id: 'bagrat-iii', name: 'Bagrat III', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'crown', gem: '#3a6ea5', perk: 'bagrat-iii',
      metal: ['#e2eefb', '#8ab4dd', '#24486e'], core: '#d4e6f8', blurb: "Unifier's Step: rolling a 6 or reaching home lifts all other allies +1 step." },
    { id: 'giorgi-vi', name: 'Giorgi VI the Minor', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'star', gem: '#5f7a61', perk: 'giorgi-vi',
      metal: ['#e8f0e8', '#93b496', '#2e4a30'], core: '#dceadc', blurb: "Minor's Aegis: a pawn standing beside an ally cannot be captured." },
    { id: 'david-iv', name: 'David IV the Builder', rarity: 'mythic', coins: 3000, wins: 60, kills: 50, trail: 'mythic', fx: 'crown', gem: '#f5d76e', perk: 'david-iv',
      metal: ['#fffbe8', '#f0c75e', '#7a5200'], core: '#fff3c0', blurb: "Builder's Edge: captures pierce single-layer shields and earn +50 match coins each." },
    { id: 'tamar', name: 'Queen Tamar the Great', rarity: 'mythic', coins: 3000, wins: 60, kills: 50, trail: 'stars', fx: 'crown', gem: '#c86dd7', perk: 'tamar',
      metal: ['#fbeaff', '#d29ae0', '#6e2f80'], core: '#f6dcff', blurb: "Tamar's Grace: star landings rally allies +1 step and open a window where fallen allies return to the nearest star." },
    { id: 'alexander-i-georgia', name: 'Alexander I of Georgia', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'brilliant', gem: '#e8dcc0', perk: 'alexander-i-georgia',
      metal: ['#fdf8ec', '#d8c89a', '#6e5a2a'], core: '#f8eeda', blurb: 'Holy Sanctuary: any landing turns the square into a safe sanctuary for two rounds.' },
    { id: 'vakhtang-v', name: 'Vakhtang V', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#7d9b76', perk: 'vakhtang-v',
      metal: ['#eef4ec', '#a3bfa0', '#3c5a38'], core: '#e2ecdf', blurb: "Peacemaker's Veto: any landing turns the square into a safe sanctuary for one round." },
    { id: 'simon-i', name: 'Simon I', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'fire', fx: 'star', gem: '#b03030', perk: 'simon-i',
      metal: ['#ffe2e2', '#d08a8a', '#6e2222'], core: '#ffd0d0', blurb: 'Arc Cleave: captures knock strictly-adjacent enemies back 2 tiles.' },
    { id: 'george-viii', name: 'George VIII', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#4f6d8c', perk: 'george-viii',
      metal: ['#e6eef5', '#8fb0cc', '#2c4a66'], core: '#d8e4f0', blurb: 'Boundary Barrier: landing on a quadrant divider shields allies within 3 tiles from capture.' },
    { id: 'constantine-i', name: 'Constantine I', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'fire', fx: 'royal', gem: '#93392e', perk: 'constantine-i',
      metal: ['#ffe4e0', '#cf8a80', '#6b211a'], core: '#ffd2cc', blurb: 'Reciprocal Strike: when this pawn falls, the killer falls too and the survivors gain +1 step.' },
    { id: 'david-vi', name: 'David VI', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'stars', fx: 'star', gem: '#6b8e23', perk: 'david-vi',
      metal: ['#f0f5e0', '#b5c98a', '#4a5e1a'], core: '#e6efd0', blurb: 'Eagle Vault: this pawn leaps over enemy blocks (landing on a block is still forbidden).' },
    { id: 'bagrat-iv', name: 'Bagrat IV', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'royal', gem: '#5a5a5a', perk: 'bagrat-iv',
      metal: ['#f0f0f0', '#b8bcc2', '#4a4e54'], core: '#e8eaec', blurb: 'Iron Chokepoint: entrenched stand — survives any strike and knocks the attacker back 1 tile.' },
    { id: 'archil-ii', name: 'Archil II of Kakheti', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'gold', fx: 'crown', gem: '#ffd700', perk: 'archil-ii',
      metal: ['#fffbe8', '#f0c75e', '#7a5200'], core: '#fff3c0', blurb: 'Relic Cross: when this pawn falls, its square keeps a relic — an odd next roll resurrects it there as a permanent sanctuary.' },
    { id: 'george-ii-georgia', name: 'George II of Georgia', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'gold', fx: 'crown', gem: '#a67c52', perk: 'george-ii-georgia',
      metal: ['#f7ecdc', '#c9a06a', '#6b4a22'], core: '#f0e0c0', blurb: 'Royal Transfer: once per match, a star landing lifts all on-track allies +2 steps.' },
    { id: 'george-i', name: 'George I of Georgia', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'star', gem: '#4682b4', perk: 'george-i',
      metal: ['#e2eefb', '#8ab4dd', '#24486e'], core: '#d4e6f8', blurb: 'Lane Pressure: any landing gives the mover +1 on its next move.' },
    { id: 'david-viii', name: 'David VIII', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'stars', fx: 'star', gem: '#2e5d43', perk: 'david-viii',
      metal: ['#e2f5ec', '#8cc9ab', '#1e5c40'], core: '#d2f0e2', blurb: 'Flank Ambush: any landing rushes a capturable foe up to 3 tiles ahead and earns a bonus roll.' },
    { id: 'bagrat-vi', name: 'Bagrat VI', rarity: 'epic', coins: 900, wins: 30, kills: 0, trail: 'default', fx: 'brilliant', gem: '#7b68ee', perk: 'bagrat-vi',
      metal: ['#eceaff', '#a89ee0', '#453a8e'], core: '#e0dcff', blurb: 'Sanctuary Breaker: landing in an enemy quadrant disables the nearest star square for two rounds.' },
    // --- First cross-volume heroes trio (L2) ---
    { id: 'scipio', name: 'Scipio Africanus', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'gold', fx: 'crown', gem: '#b22222', perk: 'scipio',
      metal: ['#ffe2e2', '#d08a8a', '#6e2222'], core: '#ffd0d0', blurb: 'Zama Envelopment: when a foe lands within 3 tiles, this pawn gains +2 and the foe is locked in place.' },
    { id: 'sitting-bull', name: 'Sitting Bull', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'stars', fx: 'star', gem: '#d2691e', perk: 'sitting-bull',
      metal: ['#ffe8d2', '#d99a5b', '#7a4416'], core: '#ffdcb8', blurb: 'Sun Dance Rally: star landings cleanse freezes and propel a nearby ally +2 tiles.' },
    { id: 'zenobia', name: 'Queen Zenobia', rarity: 'legendary', coins: 1500, wins: 50, kills: 0, trail: 'stars', fx: 'crown', gem: '#e6a817', perk: 'zenobia',
      metal: ['#fff6cc', '#e8c95a', '#7a5e10'], core: '#ffedb8', blurb: 'Palmyra Aura: any landing lifts every ally in the same quadrant +1 step.' }
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
