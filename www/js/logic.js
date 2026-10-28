/*
 * Crossfour rules engine v2: pure Ludo logic (no DOM), shared by the game and the Node tests.
 *
 * Seats (clockwise): 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
 * A token's position p:
 *   -1      in base
 *   0..50   on the shared 52-square track (0 = its own start square)
 *   51      the square just behind its start (only used while circling: "capture to enter home" rule)
 *   52..56  its own home column
 *   57      home (finished)
 * Absolute track square of a token on the track = (p + 13 * seat) % 52.
 *
 * Roll styles:
 *   'star'    (default) a 6 gives another roll straight away; rolls stack in a queue (e.g. 6, 6, 3)
 *             and are spent after the first non-6, one value per token move, in any order.
 *   'classic' every roll is moved before the next one; a 6 gives another roll after moving.
 * Both: three 6s in a row forfeit the whole turn (the unused queue is lost), a capture and a token
 * reaching home each give a bonus roll (toggles), 6 to leave base, exact roll to reach home.
 *
 * Modes: 'classic', 'mystery', 'lucky' (Lucky Chaos Ludo), 'quick' (2 tokens), 'team' (2v2, partners
 *        opposite), 'arrow' (exact land on arrow → jump 4, path captures) and 'friendly' (no captures).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TRACK = 52, LAST_TRACK = 50, CIRCLE = 51, COL0 = 52, HOME = 57, PIECES = 4;
  var START_SQUARES = [0, 13, 26, 39];
  var STAR_SQUARES = [8, 21, 34, 47];
  var ARROW_SQUARES = [4, 17, 30, 43]; // board number 4 on each side (absolute index 4, then +13). Not the old 2/7 squares.
  var ARROW_JUMP = 4; // land on arrow → advance exactly this many squares (no chaining)
  // Danger (khatra) zone: the 3 track squares the jump passes THROUGH (between the arrow and the stop).
  // Arrow 4 → 5, 6, 7 (stop on 8 = star). Visual only: a token sitting here can be captured by an arrow jump.
  var ARROW_DANGER = ARROW_JUMP - 1;
  var ARROW_DANGER_SQUARES = [];
  ARROW_SQUARES.forEach(function (a) { for (var d = 1; d <= ARROW_DANGER; d++) ARROW_DANGER_SQUARES.push((a + d) % 52); });
  var DEFAULT_RULES = { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true, arrows: false, noCapture: false };
  var LEVELS = ['easy', 'medium', 'hard'];
  var MODES = ['classic', 'mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly'];
  var MAX_SIXES = 3;

  // Mystery Tiles: fixed tiles on the track (absolute squares, never a start or star square)
  var BOOST_TILES = [4, 17, 30, 43];   // "?" tiles: Boost wheel (always helpful)
  var CHAOS_TILES = [10, 23, 36, 49];  // "!" tiles: Chaos wheel (half good, half bad)
  var WHEELS = {
    boost: ['shield', 'jump3', 'extra', 'double', 'choose', 'freeze'],
    chaos: ['back3', 'swap', 'zap', 'frozen', 'jump6', 'calm']
  };
  var EVENT_INFO = {
    shield: { name: 'Shield', text: 'This token cannot be captured until the end of your next turn.', good: true },
    jump3: { name: 'Jump +3', text: 'This token jumps 3 squares forward.', good: true },
    extra: { name: 'Extra roll', text: 'You get one more roll this turn.', good: true },
    double: { name: 'Double die', text: 'Your next roll counts double.', good: true },
    choose: { name: 'Pick a number', text: 'Your next roll: choose any number from 1 to 6.', good: true },
    freeze: { name: 'Freeze', text: 'The nearest rival token ahead is frozen for its next turn.', good: true },
    back3: { name: 'Back 3', text: 'This token slides 3 squares back.', good: false },
    swap: { name: 'Swap', text: 'This token swaps places with the nearest rival token.', good: null },
    zap: { name: 'Zap', text: 'The nearest rival within 3 squares goes back to base (not on a safe square).', good: true },
    frozen: { name: 'Stuck', text: 'This token cannot move during your next turn.', good: false },
    jump6: { name: 'Jump +6', text: 'This token jumps 6 squares forward.', good: true },
    calm: { name: 'Calm', text: 'Nothing happens.', good: null }
  };

  // ---------- Sovereign pawn perks (Phase L1: data-driven registry) ----------
  // Token skins are cosmetic by default. A skin whose catalog entry carries a `perk`
  // id opts its seat into gameplay perks; Classic (no perk id) plays exactly the
  // classic rules — every hook below is a no-op when perkOf() returns null.
  // Later kings are added as DATA: a new PERK_DEFS entry reusing these effect
  // functions (or adding one), plus a skin entry pointing at it — no engine change.
  // State (all JSON-safe, so save/load carries them; legacy states without these
  // fields keep working because every reader defaults them):
  //   st.perkSkin[seat]  perk id equipped by that seat, or null
  //   st.perkStep[seat]  per-piece pending +1 step bonus flags (Demetrius star)
  //   st.perkCoin[seat]  sticky match flag: a George capture doubled this seat's coins
  // Phase L2 adds a generic trigger/effect system on top of the L1 engine.
  // A perk def is DATA: trigger lists (onStar, onLand, onCapture, onSix,
  // onHome, onCorner, onDivider, onHomeApproach, onHighRoll, onLowRoll,
  // onProximity, onApproach, onAllyCaptured) plus passive traits (endure,
  // mutual, vault, pierce, aegis, once). Effects are generic functions in
  // PERK_EFFECTS; dispatch (applyTrigger) passes (st, seat, piece, abs,
  // entry, extra) so no perk needs a one-off hook in move().
  // Fair readings (documented per pawn in the phase report): durations
  // written as "for 2 turns" become either a turnCount window checked at
  // use time (rollFloor, relocate, disableStar, tileSanctuary) or an
  // until-consumed aura (zoneEndure), because the effect system has no
  // per-piece turn expiry; coin effects are match-end bonuses, not cash.
  // State (all JSON-safe, so save/load carries them; legacy states without
  // these fields keep working because every reader defaults them):
  //   st.perkSkin[seat]  perk id equipped by that seat, or null
  //   st.perkStep[seat]  per-piece pending step bonus (number, 0 = none)
  //   st.perkCoin[seat]  sticky match flag: a George capture doubled this seat's coins
  //   st.perkBonusCoins[seat]  flat match-end coin bonus (Rostom +50, Levan +25, David IV +50/capture)
  //   st.perkRollFloor[seat]  turnCount until which rolls below 3 count as 3 (George V)
  //   st.perkRelocate[seat]  turnCount until which a captured ally returns to the nearest star (Tamar)
  //   st.perkRelic[seat]  { abs, piece } left by a captured Archil II, resolved on the next roll
  //   st.perkUnsafe[]  { abs, until } star squares disabled by Bagrat VI (capturable while active)
  //   st.perkSafeTiles[]  { abs, until|null } sanctuary squares (Alexander I x2, Vakhtang V, Archil relic)
  //   st.perkOnceFired[seat]  { perkId: true } for once-per-match perks (George II of Georgia)
  //   st.perkEndureSpent[seat]  per-piece flag: a consumed endure stand does not reform until recaptured
  var DIVIDER_SQUARES = [0, 12, 13, 25, 26, 38, 39, 51]; // quadrant seams (start squares double as dividers)
  function quadrant(abs) { return Math.floor(abs / 13); }
  var PERK_DEFS = {
    demetrius: { id: 'demetrius', name: 'King Demetrius I of Georgia', banner: 'VINEYARD SHIELD',
      onStar: ['allyStep1', 'vineAdjacent'] },
    george: { id: 'george', name: 'King George III of Georgia', banner: 'GOLDEN AGE SPRINT',
      onCapture: ['sprint2', 'coinDouble'] },
    // --- Sovereign Kings pack (L2): one pawn per unique monarch, latest/most-specific V6 wording ---
    'george-v': { id: 'george-v', name: 'King George V of Georgia', banner: 'BRILLIANT RESTORER',
      onStar: ['allyLeap2', { e: 'rollFloor', turns: 2 }] },
    'george-xii': { id: 'george-xii', name: 'King George XII of Georgia', banner: 'LAST CROWN',
      onStar: ['allyStep1', 'coinDouble'] },
    'heraclius-ii': { id: 'heraclius-ii', name: 'King Heraclius II of Georgia', banner: 'KARTLI SHIELD',
      onLand: ['allyStep1', { e: 'zoneEndure', r: 3 }] },
    jesse: { id: 'jesse', name: 'Jesse of Kakheti and Kartli', banner: 'DUAL THRONE',
      onStar: [{ e: 'zoneEndure', r: 2 }] },
    'solomon-i': { id: 'solomon-i', name: 'Solomon I of Imereti', banner: 'IMERETI AWAKENING',
      onCapture: ['breakout', 'selfSprint2'] },
    'vakhtang-vi': { id: 'vakhtang-vi', name: 'Vakhtang VI of Kartli', banner: 'LAW-GIVER',
      onLand: [{ e: 'zoneEndure', r: 2 }] },
    'erekle-i': { id: 'erekle-i', name: 'Erekle I of Kakheti and Kartli', banner: 'EAGLE SPRINT',
      onHighRoll: [{ e: 'allyPropel2', r: 2 }] },
    archil: { id: 'archil', name: 'Archil of Imereti and Kakheti', banner: 'ROYAL SUMMONS',
      onHomeApproach: ['homeSummon2'] },
    'teimuraz-i': { id: 'teimuraz-i', name: 'Teimuraz I of Kakheti', banner: "MARTYR'S RALLY",
      onAllyCaptured: ['allyStep1'] },
    'george-xi': { id: 'george-xi', name: 'George XI of Kartli', banner: 'SHIELD CLASH',
      onProximity: ['proxStep', { e: 'repel', r: 2 }] },
    rostom: { id: 'rostom', name: 'Rostom of Kartli', banner: "ROSTOM'S BOUNTY",
      onStar: ['allyStep1', { e: 'coinBonus', amt: 50 }] },
    'giorgi-vii': { id: 'giorgi-vii', name: 'Giorgi VII of Georgia', banner: 'NAKHICHEVAN STAND',
      endure: { knock: 2, stun: true } },
    'luarsab-i': { id: 'luarsab-i', name: 'Luarsab I of Kartli', banner: 'MUTUAL CLASH',
      mutual: true },
    levan: { id: 'levan', name: 'Levan of Kakheti', banner: 'KAKHETI VISION',
      onStar: ['selfStep1', { e: 'coinBonus', amt: 25 }] },
    'constantine-ii': { id: 'constantine-ii', name: 'Constantine II of Georgia', banner: 'CORNER BASTION',
      onCorner: [{ e: 'zoneEndure', r: 2 }] },
    'george-ii-kakheti': { id: 'george-ii-kakheti', name: 'George II of Kakheti', banner: 'IRON COUNTER-BASH',
      endure: { knock: 2, stun: true } },
    'alexander-i-kakheti': { id: 'alexander-i-kakheti', name: 'Alexander I of Kakheti', banner: 'DIPLOMATIC SANCTUARY',
      onLand: [{ e: 'tileSanctuary', turns: 2 }] },
    'alexander-ii-imereti': { id: 'alexander-ii-imereti', name: 'Alexander II of Imereti', banner: 'IMERETI BASTION',
      onCorner: [{ e: 'zoneEndure', r: 2 }] },
    'george-iv': { id: 'george-iv', name: 'George IV Lasha', banner: 'CHIVALRIC CHARGE',
      onLand: [{ e: 'charge3', n: 3 }] },
    rusudan: { id: 'rusudan', name: 'Queen Rusudan of Georgia', banner: 'GOLDEN DOUBLE',
      onLowRoll: ['selfStepV'] },
    'demetre-ii': { id: 'demetre-ii', name: 'Demetre II the Self-Sacrificer', banner: "MARTYR'S SURGE",
      onAllyCaptured: ['allyStep2'] },
    'bagrat-iii': { id: 'bagrat-iii', name: 'Bagrat III of Georgia', banner: "UNIFIER'S STEP",
      onSix: ['allyStep1'], onHome: ['allyStep1'] },
    'giorgi-vi': { id: 'giorgi-vi', name: 'Giorgi VI the Minor', banner: "MINOR'S AEGIS",
      aegis: true },
    'david-iv': { id: 'david-iv', name: 'David IV the Builder', banner: "BUILDER'S EDGE",
      pierce: true, onCapture: [{ e: 'coinBonus', amt: 50 }] },
    tamar: { id: 'tamar', name: 'Queen Tamar the Great', banner: "TAMAR'S GRACE",
      onStar: ['allyStep1', { e: 'relocate', turns: 2 }] },
    'alexander-i-georgia': { id: 'alexander-i-georgia', name: 'Alexander I of Georgia', banner: 'HOLY SANCTUARY',
      onLand: [{ e: 'tileSanctuary', turns: 2 }] },
    'vakhtang-v': { id: 'vakhtang-v', name: 'Vakhtang V of Kartli', banner: "PEACEMAKER'S VETO",
      onLand: [{ e: 'tileSanctuary', turns: 1 }] },
    'simon-i': { id: 'simon-i', name: 'Simon I of Kartli', banner: 'ARC CLEAVE',
      onCapture: [{ e: 'cleave', n: 2 }] },
    'george-viii': { id: 'george-viii', name: 'George VIII of Georgia', banner: 'BOUNDARY BARRIER',
      onDivider: [{ e: 'zoneEndure', r: 3 }] },
    'constantine-i': { id: 'constantine-i', name: 'Constantine I of Georgia', banner: 'RECIPROCAL STRIKE',
      onAllyCaptured: ['allyStep1', 'reciprocalKill'] },
    'david-vi': { id: 'david-vi', name: 'David VI of Georgia', banner: 'EAGLE VAULT',
      vault: true },
    'bagrat-iv': { id: 'bagrat-iv', name: 'Bagrat IV of Georgia', banner: 'IRON CHOKEPOINT',
      endure: { knock: 1 } },
    'archil-ii': { id: 'archil-ii', name: 'Archil II of Kakheti', banner: 'RELIC CROSS',
      onAllyCaptured: ['relic'] },
    'george-ii-georgia': { id: 'george-ii-georgia', name: 'George II of Georgia', banner: 'ROYAL TRANSFER',
      onStar: ['allyStep2'], once: true },
    'george-i': { id: 'george-i', name: 'George I of Georgia', banner: 'LANE PRESSURE',
      onLand: ['selfStep1'] },
    'david-viii': { id: 'david-viii', name: 'David VIII of Georgia', banner: 'FLANK AMBUSH',
      onLand: [{ e: 'charge3', n: 3 }] },
    'bagrat-vi': { id: 'bagrat-vi', name: 'Bagrat VI of Georgia', banner: 'SANCTUARY BREAKER',
      onLand: [{ e: 'disableStar', turns: 2 }] },
    // --- First cross-volume heroes trio (L2) ---
    scipio: { id: 'scipio', name: 'Scipio Africanus', banner: 'ZAMA ENVELOPMENT',
      onApproach: ['approachStep', 'approachFreeze'] },
    'sitting-bull': { id: 'sitting-bull', name: 'Sitting Bull', banner: 'SUN DANCE RALLY',
      onStar: ['cleanse', { e: 'allyPropel2', r: 2 }] },
    zenobia: { id: 'zenobia', name: 'Queen Zenobia', banner: 'PALMYRA AURA',
      onLand: ['quadrantStep1'] }
  };
  function perkOf(st, seat) { var a = st.perkSkin; var id = Array.isArray(a) ? a[seat] : null; return (id && PERK_DEFS[id]) || null; }
  function setPerkSkin(st, seat, perkId) {
    if (!Array.isArray(st.perkSkin) || st.perkSkin.length !== 4) st.perkSkin = [null, null, null, null];
    st.perkSkin[seat] = PERK_DEFS[perkId] ? perkId : null;
  }
  function perkStepArr(st, seat) {
    if (!Array.isArray(st.perkStep) || st.perkStep.length !== 4) st.perkStep = [null, null, null, null];
    if (!Array.isArray(st.perkStep[seat]) || st.perkStep[seat].length !== nPieces(st)) {
      var a = []; for (var k = 0; k < nPieces(st); k++) a.push(0); st.perkStep[seat] = a;
    }
    return st.perkStep[seat];
  }
  function perkStepValue(st, seat, piece) {
    return (Array.isArray(st.perkStep) && Array.isArray(st.perkStep[seat]) && st.perkStep[seat][piece]) || 0;
  }
  function perkStepActive(st, seat, piece) { return perkStepValue(st, seat, piece) > 0; }
  function perkCoinArr(st) { if (!Array.isArray(st.perkCoin) || st.perkCoin.length !== 4) st.perkCoin = [false, false, false, false]; return st.perkCoin; }
  function coinMultiplier(st, seat) { return (Array.isArray(st.perkCoin) && st.perkCoin[seat]) ? 2 : 1; }
  function perkBonusArr(st) { if (!Array.isArray(st.perkBonusCoins) || st.perkBonusCoins.length !== 4) st.perkBonusCoins = [0, 0, 0, 0]; return st.perkBonusCoins; }
  function perkBonusTotal(st, seat) { return (Array.isArray(st.perkBonusCoins) && st.perkBonusCoins[seat]) || 0; }
  function perkUnsafeArr(st) { if (!Array.isArray(st.perkUnsafe)) st.perkUnsafe = []; return st.perkUnsafe; }
  function perkSafeArr(st) { if (!Array.isArray(st.perkSafeTiles)) st.perkSafeTiles = []; return st.perkSafeTiles; }
  function perkOnceFired(st, seat, id) { return !!(st.perkOnceFired && st.perkOnceFired[seat] && st.perkOnceFired[seat][id]); }
  function markPerkOnce(st, seat, id) {
    if (!Array.isArray(st.perkOnceFired) || st.perkOnceFired.length !== 4) st.perkOnceFired = [null, null, null, null];
    if (!st.perkOnceFired[seat]) st.perkOnceFired[seat] = {};
    st.perkOnceFired[seat][id] = true;
  }
  function perkEndureSpentArr(st, seat) {
    if (!Array.isArray(st.perkEndureSpent) || st.perkEndureSpent.length !== 4) st.perkEndureSpent = [null, null, null, null];
    if (!Array.isArray(st.perkEndureSpent[seat]) || st.perkEndureSpent[seat].length !== nPieces(st)) {
      var a = []; for (var k = 0; k < nPieces(st); k++) a.push(false); st.perkEndureSpent[seat] = a;
    }
    return st.perkEndureSpent[seat];
  }
  function perkEndureSpent(st, seat, piece) { return !!(Array.isArray(st.perkEndureSpent) && Array.isArray(st.perkEndureSpent[seat]) && st.perkEndureSpent[seat][piece]); }
  function markEndureSpent(st, seat, piece) { perkEndureSpentArr(st, seat)[piece] = true; }
  function isVineShielded(st, seat, piece) { return hasEffect(st, 'vine', seat, piece); }
  function circDistAbs(a, b) { var d = Math.abs(a - b) % TRACK; return Math.min(d, TRACK - d); }
  function nearestStarAbs(abs) { var best = STAR_SQUARES[0], bd = 99; STAR_SQUARES.forEach(function (s) { var d = circDistAbs(s, abs); if (d < bd) { bd = d; best = s; } }); return best; }
  function isUnsafe(st, abs) { return perkUnsafeArr(st).some(function (e) { return e.abs === abs && st.turnCount <= e.until; }); }
  /** A square is safe by geometry (start/star), by sanctuary, and never when disabled. */
  function isSafeSquare(st, abs) {
    if (isUnsafe(st, abs)) return false;
    if (isSafeAbs(abs)) return true;
    return perkSafeArr(st).some(function (e) { return e.abs === abs && (e.until == null || st.turnCount <= e.until); });
  }
  function hasEndure(st, seat, piece) { return hasEffect(st, 'endure', seat, piece); }
  function endureEffect(st, seat, piece) { for (var i = 0; i < st.effects.length; i++) { var e = st.effects[i]; if (e.type === 'endure' && e.seat === seat && e.piece === piece) return e; } return null; }
  function endureTargets(st, seat, abs) { return tokensAt(st, abs, seat).filter(function (t) { return hasEndure(st, t.seat, t.piece); }); }
  function consumeEndure(st, seat, piece) { st.effects = st.effects.filter(function (e) { return !(e.type === 'endure' && e.seat === seat && e.piece === piece); }); }
  function isMutual(st, seat, piece) { var def = perkOf(st, seat); return !!(def && def.mutual); }
  function mutualTargets(st, seat, abs) { return tokensAt(st, abs, seat).filter(function (t) { return isMutual(st, t.seat, t.piece); }); }
  function hasAllyWithin(st, seat, abs, r, exceptPiece) {
    for (var i = 0; i < nPieces(st); i++) { if (i === exceptPiece) continue; var p = st.pieces[seat][i]; if (onTrack(p) && circDistAbs(absOf(seat, p), abs) <= r) return true; }
    return false;
  }
  /** Slide a main-track piece `n` squares back (clamped at the start square). */
  function knockBack(st, seat, piece, n) {
    var from = st.pieces[seat][piece]; if (!onTrack(from)) return null;
    var c = from;
    for (var k = 0; k < n; k++) { if (c === CIRCLE) c = LAST_TRACK; else c = Math.max(0, c - 1); }
    st.pieces[seat][piece] = c;
    return { piece: piece, from: from, to: c };
  }
  // Effect implementations, one per registry effect name. Signature:
  //   fn(st, seat, piece, abs, entry, extra)
  // where `piece` is the triggering piece (or the victim for onAllyCaptured),
  // `abs` the landing/capture square, `entry` the registry entry (params),
  // and `extra` trigger context ({ v } for roll triggers, { attacker } for
  // ally-captured, { moverSeat, moverPiece } for approach).
  function fxAllyStep1(st, seat) {
    var granted = [];
    for (var i = 0; i < nPieces(st); i++) if (onTrack(st.pieces[seat][i])) { perkStepArr(st, seat)[i] = Math.max(perkStepArr(st, seat)[i], 1); granted.push(i); }
    return granted;
  }
  function fxAllyStep2(st, seat) {
    var granted = [];
    for (var i = 0; i < nPieces(st); i++) if (onTrack(st.pieces[seat][i])) { perkStepArr(st, seat)[i] = Math.max(perkStepArr(st, seat)[i], 2); granted.push(i); }
    return granted;
  }
  function fxVineAdjacent(st, seat, piece, abs) {
    var shielded = [];
    for (var i = 0; i < nPieces(st); i++) {
      if (i === piece) continue;
      var p = st.pieces[seat][i];
      if (!onTrack(p) || isVineShielded(st, seat, i)) continue;
      if (circDistAbs(absOf(seat, p), abs) <= 1) { st.effects.push({ type: 'vine', seat: seat, piece: i, at: st.turnCount }); shielded.push(i); }
    }
    return shielded;
  }
  function sprintPath(st, seat, from) {
    var path = [], c = from, enter = canEnter(st, seat);
    for (var k = 0; k < 2; k++) {
      var nx = stepFwd(c, enter);
      if (nx === null || !onTrack(nx)) break; // sprint stays on the main track (never into the home column)
      if (opponentBlockAt(st, seat, absOf(seat, nx))) break;
      path.push(nx); c = nx;
    }
    return path;
  }
  function fxSprint2(st, seat) {
    var moved = [];
    for (var i = 0; i < nPieces(st); i++) {
      var p = st.pieces[seat][i];
      if (!onTrack(p) || isFrozen(st, seat, i)) continue;
      var path = sprintPath(st, seat, p);
      if (!path.length) continue;
      st.pieces[seat][i] = path[path.length - 1];
      moved.push({ piece: i, from: p, to: path[path.length - 1] });
    }
    return moved;
  }
  function fxAllyLeap2(st, seat) { // George V: every on-track ally leaps +2 now (not a pending bonus)
    var moved = [];
    for (var i = 0; i < nPieces(st); i++) {
      var p = st.pieces[seat][i];
      if (!onTrack(p) || isFrozen(st, seat, i)) continue;
      var path = sprintPath(st, seat, p);
      if (!path.length) continue;
      st.pieces[seat][i] = path[path.length - 1];
      moved.push({ piece: i, from: p, to: path[path.length - 1] });
    }
    return moved;
  }
  function fxSelfStep1(st, seat, piece) { if (!onTrack(st.pieces[seat][piece])) return false; perkStepArr(st, seat)[piece] = Math.max(perkStepArr(st, seat)[piece], 1); return true; }
  function fxSelfStep2(st, seat, piece) { if (!onTrack(st.pieces[seat][piece])) return false; perkStepArr(st, seat)[piece] = Math.max(perkStepArr(st, seat)[piece], 2); return true; }
  function fxSelfStepV(st, seat, piece, abs, ent, extra) { // Rusudan: pending += the roll just made (total becomes 2x)
    if (!onTrack(st.pieces[seat][piece]) || !extra || !extra.v) return false;
    perkStepArr(st, seat)[piece] = perkStepArr(st, seat)[piece] + extra.v; return extra.v;
  }
  function fxSelfSprint2(st, seat, piece) {
    var p = st.pieces[seat][piece];
    if (!onTrack(p) || isFrozen(st, seat, piece)) return null;
    var path = sprintPath(st, seat, p);
    if (!path.length) return null;
    st.pieces[seat][piece] = path[path.length - 1];
    return { piece: piece, from: p, to: path[path.length - 1] };
  }
  function fxCoinDouble(st, seat) { perkCoinArr(st)[seat] = true; return true; }
  function fxCoinBonus(st, seat, piece, abs, ent) { var amt = (ent && ent.amt) || 0; perkBonusArr(st)[seat] += amt; return amt; }
  function fxZoneEndure(st, seat, piece, abs, ent) { // aura: allies within r of the square survive the next strike each
    var r = (ent && ent.r) || 2, granted = [];
    for (var i = 0; i < nPieces(st); i++) {
      var p = st.pieces[seat][i];
      if (!onTrack(p) || hasEndure(st, seat, i)) continue;
      if (circDistAbs(absOf(seat, p), abs) <= r) { st.effects.push({ type: 'endure', seat: seat, piece: i, knock: 0 }); granted.push(i); }
    }
    return granted;
  }
  function fxBreakout(st, seat) { // Solomon: every base pawn steps out onto the start square at once
    var out = [];
    for (var i = 0; i < nPieces(st); i++) if (st.pieces[seat][i] === -1) { st.pieces[seat][i] = 0; out.push(i); }
    return out;
  }
  function fxQuadrantStep1(st, seat, piece, abs) {
    var q = quadrant(abs), granted = [];
    for (var i = 0; i < nPieces(st); i++) { var p = st.pieces[seat][i]; if (onTrack(p) && quadrant(absOf(seat, p)) === q) { perkStepArr(st, seat)[i] = Math.max(perkStepArr(st, seat)[i], 1); granted.push(i); } }
    return granted;
  }
  function fxHomeSummon2(st, seat, piece, abs) { // Archil: landing near the home stretch summons base pawns with +2
    var rel = posFromAbs(seat, abs), granted = [];
    if (rel < 49 || rel > 51) return granted;
    for (var i = 0; i < nPieces(st); i++) if (st.pieces[seat][i] === -1) { perkStepArr(st, seat)[i] = Math.max(perkStepArr(st, seat)[i], 2); granted.push(i); }
    return granted;
  }
  function fxDisableStar(st, seat, piece, abs, ent) { // Bagrat VI: nearest star in an enemy quadrant stops being safe
    if (quadrant(abs) === seat) return null;
    var star = nearestStarAbs(abs), until = st.turnCount + ((ent && ent.turns) || 2) * activeLeft(st).length;
    var arr = perkUnsafeArr(st), found = false;
    arr.forEach(function (e) { if (e.abs === star) { e.until = until; found = true; } });
    if (!found) arr.push({ abs: star, until: until });
    return star;
  }
  function fxTileSanctuary(st, seat, piece, abs, ent) { // Alexander I x2, Vakhtang V: the landing square becomes safe
    var until = st.turnCount + ((ent && ent.turns) || 2) * activeLeft(st).length;
    var arr = perkSafeArr(st), found = false;
    arr.forEach(function (e) { if (e.abs === abs) { e.until = until; found = true; } });
    if (!found) arr.push({ abs: abs, until: until });
    return abs;
  }
  function fxRollFloor(st, seat, piece, abs, ent) { // George V: rolls below 3 count as 3 while the window holds
    if (!Array.isArray(st.perkRollFloor) || st.perkRollFloor.length !== 4) st.perkRollFloor = [null, null, null, null];
    st.perkRollFloor[seat] = st.turnCount + ((ent && ent.turns) || 2) * activeLeft(st).length;
    return true;
  }
  function fxRelocate(st, seat, piece, abs, ent) { // Tamar: a captured ally returns to the nearest star, not the yard
    if (!Array.isArray(st.perkRelocate) || st.perkRelocate.length !== 4) st.perkRelocate = [null, null, null, null];
    st.perkRelocate[seat] = st.turnCount + ((ent && ent.turns) || 2) * activeLeft(st).length;
    return true;
  }
  function fxRelic(st, seat, piece, abs) { // Archil II: the capture square keeps a relic cross for the next roll
    if (!Array.isArray(st.perkRelic) || st.perkRelic.length !== 4) st.perkRelic = [null, null, null, null];
    st.perkRelic[seat] = { abs: abs, piece: piece };
    return st.perkRelic[seat];
  }
  function fxAllyPropel2(st, seat, piece, abs, ent) { // Erekle / Sitting Bull: nearest ally within r sprints +2 now
    var r = (ent && ent.r) || 2, best = -1, bd = 99;
    for (var i = 0; i < nPieces(st); i++) {
      if (i === piece) continue;
      var p = st.pieces[seat][i];
      if (!onTrack(p) || isFrozen(st, seat, i)) continue;
      var d = circDistAbs(absOf(seat, p), abs);
      if (d <= r && d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    var from = st.pieces[seat][best], path = sprintPath(st, seat, from);
    if (!path.length) return null;
    st.pieces[seat][best] = path[path.length - 1];
    return { piece: best, from: from, to: path[path.length - 1] };
  }
  function fxCleave(st, seat, piece, abs, ent) { // Simon: strictly-adjacent enemies (not the captured one) slide back
    var n = (ent && ent.n) || 2, out = [];
    if (abs == null) return out;
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat) continue;
      for (var i = 0; i < nPieces(st); i++) {
        var p = st.pieces[o][i];
        if (!onTrack(p)) continue;
        var a = absOf(o, p);
        if (circDistAbs(a, abs) !== 1) continue;
        if (st.rules.safeSquares && isSafeSquare(st, a)) continue;
        if (isShielded(st, o, i) || isVineShielded(st, o, i) || hasEndure(st, o, i) || isMutual(st, o, i)) continue;
        var kb = knockBack(st, o, i, n);
        if (kb) out.push({ seat: o, piece: i, from: kb.from, to: kb.to });
      }
    }
    return out;
  }
  function fxRepel(st, seat, piece, abs, ent) { // George XI: mover + nearest ally within r repel attackers 1 tile
    var r = (ent && ent.r) || 2, granted = [];
    function arm(i) { if (onTrack(st.pieces[seat][i]) && !hasEndure(st, seat, i)) { st.effects.push({ type: 'endure', seat: seat, piece: i, knock: 1 }); granted.push(i); } }
    arm(piece);
    var best = -1, bd = 99;
    for (var i = 0; i < nPieces(st); i++) {
      if (i === piece) continue;
      var p = st.pieces[seat][i];
      if (!onTrack(p)) continue;
      var d = circDistAbs(absOf(seat, p), abs);
      if (d <= r && d < bd) { bd = d; best = i; }
    }
    if (best >= 0) arm(best);
    return granted;
  }
  function fxProxStep(st, seat, piece, abs) { // George XI: landing near an ally lifts both paws' next move by +1
    var out = { mover: false, ally: null };
    if (onTrack(st.pieces[seat][piece])) { perkStepArr(st, seat)[piece] = Math.max(perkStepArr(st, seat)[piece], 1); out.mover = true; }
    var best = -1, bd = 99;
    for (var i = 0; i < nPieces(st); i++) {
      if (i === piece) continue;
      var p = st.pieces[seat][i];
      if (!onTrack(p)) continue;
      var d = circDistAbs(absOf(seat, p), abs);
      if (d <= 2 && d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { perkStepArr(st, seat)[best] = Math.max(perkStepArr(st, seat)[best], 1); out.ally = best; }
    return out;
  }
  function fxCleanse(st, seat) { // Sitting Bull: the rally lifts freezes off the whole seat
    var before = st.effects.length;
    st.effects = st.effects.filter(function (e) { return !(e.type === 'freeze' && e.seat === seat); });
    return before - st.effects.length;
  }
  function fxApproachStep(st, seat, piece, abs, ent) { // Scipio: the approached piece gains +2 on its next move
    if (!onTrack(st.pieces[seat][piece])) return false;
    perkStepArr(st, seat)[piece] = Math.max(perkStepArr(st, seat)[piece], (ent && ent.v) || 2);
    return true;
  }
  function fxApproachFreeze(st, seat, piece, abs, ent, extra) { // Scipio: the bypassing enemy token is locked in place
    if (!extra || extra.moverSeat == null) return false;
    if (isFrozen(st, extra.moverSeat, extra.moverPiece)) return false;
    st.effects.push({ type: 'freeze', seat: extra.moverSeat, piece: extra.moverPiece, at: st.turnCount });
    return true;
  }
  function fxCharge(st, seat, piece, abs, ent) { // George IV / David VIII: rush a capturable foe up to n ahead
    var n = (ent && ent.n) || 3;
    if (abs == null || st.pieces[seat][piece] !== posFromAbs(seat, abs)) return null; // mover no longer on the square
    for (var d = 1; d <= n; d++) {
      var a2 = (abs + d) % TRACK;
      var caps = capturesAt(st, seat, a2).filter(function (t) { return !(st.rules.blocks && countOwnAt(st, t.seat, a2) >= 2); });
      if (!caps.length) continue;
      var t = caps[0], from = st.pieces[seat][piece];
      st.pieces[seat][piece] = posFromAbs(seat, a2);
      sendHome(st, seat, t, piece);
      st.bonus++; // the charge earns the extra turn the chronicle promises
      return { target: t, from: from, to: st.pieces[seat][piece] };
    }
    return null;
  }
  var PERK_EFFECTS = { allyStep1: fxAllyStep1, allyStep2: fxAllyStep2, vineAdjacent: fxVineAdjacent,
    sprint2: fxSprint2, allyLeap2: fxAllyLeap2, selfStep1: fxSelfStep1, selfStep2: fxSelfStep2, selfStepV: fxSelfStepV,
    selfSprint2: fxSelfSprint2, coinDouble: fxCoinDouble, coinBonus: fxCoinBonus, zoneEndure: fxZoneEndure,
    breakout: fxBreakout, quadrantStep1: fxQuadrantStep1, homeSummon2: fxHomeSummon2, disableStar: fxDisableStar,
    tileSanctuary: fxTileSanctuary, rollFloor: fxRollFloor, relocate: fxRelocate, relic: fxRelic,
    allyPropel2: fxAllyPropel2, cleave: fxCleave, repel: fxRepel, proxStep: fxProxStep, cleanse: fxCleanse,
    approachStep: fxApproachStep, approachFreeze: fxApproachFreeze, charge3: fxCharge };
  /** Generic trigger dispatch: runs every effect in def[key], collecting grants. */
  function applyTrigger(st, seat, piece, abs, key, extra) {
    var def = perkOf(st, seat); if (!def || !def[key]) return null;
    if (def.once && perkOnceFired(st, seat, def.id)) return null;
    var out = { id: def.id, trigger: key, banner: def.banner, grants: [] };
    def[key].forEach(function (ent) {
      var name = typeof ent === 'string' ? ent : ent.e;
      if (name === 'reciprocalKill') { out.grants.push({ e: name, r: 'deferred' }); return; } // needs the attacker: see applyAllyCapturedPerk
      var fn = PERK_EFFECTS[name]; if (!fn) return;
      out.grants.push({ e: name, r: fn(st, seat, piece, abs, ent, extra) });
    });
    if (def.once) markPerkOnce(st, seat, def.id);
    return out;
  }
  function applyStarPerk(st, seat, piece, abs) { // L1 shape preserved: trigger 'star', stepBonus + vineShield fields
    var out = applyTrigger(st, seat, piece, abs, 'onStar');
    if (!out) return null;
    out.trigger = 'star'; out.stepBonus = []; out.vineShield = [];
    out.grants.forEach(function (g) { if (g.e === 'allyStep1') out.stepBonus = g.r; if (g.e === 'vineAdjacent') out.vineShield = g.r; });
    return out;
  }
  function applyCapturePerk(st, seat, piece, abs) { // L1 shape preserved: trigger 'capture', sprint + coinDouble fields
    var out = applyTrigger(st, seat, piece, abs, 'onCapture');
    if (!out) return null;
    out.trigger = 'capture'; out.sprint = []; out.coinDouble = false;
    out.grants.forEach(function (g) { if (g.e === 'sprint2') out.sprint = g.r; if (g.e === 'coinDouble') out.coinDouble = !!g.r; });
    return out;
  }
  /** Defender-side triggers for a captured pawn (victim seat, victim piece, capture square). */
  function applyAllyCapturedPerk(st, seat, piece, abs, attacker) {
    var def = perkOf(st, seat); if (!def || !def.onAllyCaptured) return null;
    var out = applyTrigger(st, seat, piece, abs, 'onAllyCaptured', { attacker: attacker });
    if (!out) return null;
    out.trigger = 'allyCaptured';
    if (def.onAllyCaptured.indexOf('reciprocalKill') >= 0 && attacker && onTrack(st.pieces[attacker.seat][attacker.piece])) {
      sendHome(st, seat, { seat: attacker.seat, piece: attacker.piece }, piece);
      out.reciprocal = { seat: attacker.seat, piece: attacker.piece };
    }
    return out;
  }
  /** Vine-shielded enemies sitting on `abs` that an attack just landed on: the attack reflects. */
  function vineReflectTargets(st, seat, abs) {
    return tokensAt(st, abs, seat).filter(function (t) { return isVineShielded(st, t.seat, t.piece); });
  }

  // ---------- RNG (mulberry32 with serialisable state) ----------
  function rngNext(state) {
    state.rng = (state.rng + 0x6D2B79F5) >>> 0;
    var t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function rollDie(state) { return 1 + Math.floor(rngNext(state) * 6); }

  // ---------- geometry (15 x 15 grid; [row, col]) ----------
  function rot(rc, times) { var r = rc[0], c = rc[1]; for (var k = 0; k < ((times % 4) + 4) % 4; k++) { var t = r; r = c; c = 14 - t; } return [r, c]; }
  var SEG = [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8]];
  var TRACK_CELLS = [];
  for (var q = 0; q < 4; q++) for (var j = 0; j < SEG.length; j++) TRACK_CELLS.push(rot(SEG[j], q));
  var HOME_COLS = [], BASE_SPOTS = [], HOME_SPOTS = [];
  for (var s = 0; s < 4; s++) {
    var col = []; for (var k = 1; k <= 5; k++) col.push(rot([7, k], s)); HOME_COLS.push(col);
    BASE_SPOTS.push([[1.9, 1.9], [1.9, 3.1], [3.1, 1.9], [3.1, 3.1]].map(function (p) { return rot(p, s); }));
    HOME_SPOTS.push([[6.55, 6.1], [7.45, 6.1], [6.1, 6.55], [7.9, 6.55]].map(function (p) { return rot(p, s); }));
  }
  /** Board cell ([row, col], may be fractional) for a token of `seat` at position p (token index i for base/home spots). */
  function cellOf(seat, p, i) {
    if (p < 0) return BASE_SPOTS[seat][i || 0];
    if (p <= CIRCLE) return TRACK_CELLS[(p + 13 * seat) % TRACK];
    if (p < HOME) return HOME_COLS[seat][p - COL0];
    return HOME_SPOTS[seat][i || 0];
  }
  function onTrack(p) { return p >= 0 && p <= CIRCLE; }
  function absOf(seat, p) { return (p + 13 * seat) % TRACK; }
  function posFromAbs(seat, a) { return ((a - 13 * seat) % TRACK + TRACK) % TRACK; }
  function isSafeAbs(a) { return START_SQUARES.indexOf(a) >= 0 || STAR_SQUARES.indexOf(a) >= 0; }
  /** Progress score used for ranking and AI (base 0 ... home 58). */
  function advance(p) { if (p < 0) return 0; if (p <= LAST_TRACK) return p + 1; if (p === CIRCLE) return 0.5; if (p < HOME) return p; return 58; }

  // ---------- setup ----------
  function normRules(rules) {
    var r = {};
    Object.keys(DEFAULT_RULES).forEach(function (k) {
      var v = rules && rules[k] != null ? rules[k] : DEFAULT_RULES[k];
      r[k] = k === 'rollStyle' ? (v === 'classic' ? 'classic' : 'star') : !!v;
    });
    return r;
  }
  /**
   * seats: array of 4 entries, each null (empty seat) or { type: 'human' | 'ai', level?: 'easy'|'medium'|'hard' }.
   * Needs at least 2 players. mode: 'classic' | 'mystery'.
   * perks (optional): array of 4 perk ids (or null) equipped by each seat; unknown ids are ignored.
   */
  function nPieces(st) { return (st && st.nPieces) || PIECES; }
  /** Team Ludo: partners sit opposite. Team 0 is seats 0 and 2, team 1 is seats 1 and 3. */
  function teamOf(seat) { return seat % 2; }
  function partnerOf(seat) { return (seat + 2) % 4; }
  function arrowsOn(st) { return !!(st && st.rules && (st.mode === 'arrow' || st.rules.arrows)); }
  function newGame(seats, rules, seed, mode, perks) {
    var players = [];
    for (var i = 0; i < 4; i++) if (seats[i]) players.push(i);
    var md = MODES.indexOf(mode) >= 0 ? mode : 'classic';
    if (md === 'team') { if (players.length !== 4) throw new Error('Team Ludo needs all 4 seats'); }
    else if (players.length < 2) throw new Error('need at least 2 players');
    var np = md === 'quick' ? 2 : PIECES;
    var rr = normRules(rules);
    if (md === 'arrow') rr.arrows = true;
    if (md === 'friendly') rr.noCapture = true;
    var blank = function () { var a = []; for (var k = 0; k < np; k++) a.push(-1); return a; };
    // Arrow mode: each player begins with token 0 already on their start square (no 6 needed to get moving).
    var startPieces = function () {
      var a = blank();
      if (md === 'arrow') a[0] = 0;
      return a;
    };
    var st = {
      v: 2,
      mode: md,
      nPieces: np,
      seats: seats.map(function (x) { return x ? { type: x.type === 'ai' ? 'ai' : 'human', level: LEVELS.indexOf(x.level) >= 0 ? x.level : 'medium' } : null; }),
      players: players,
      pieces: seats.map(function (x) { return x ? startPieces() : null; }),
      rules: rr,
      perkSkin: [null, null, null, null],
      perkStep: [null, null, null, null],
      perkCoin: [false, false, false, false],
      perkBonusCoins: [0, 0, 0, 0],
      perkRollFloor: [null, null, null, null],
      perkRelocate: [null, null, null, null],
      perkRelic: [null, null, null, null],
      perkUnsafe: [],
      perkSafeTiles: [],
      perkOnceFired: [null, null, null, null],
      perkEndureSpent: [null, null, null, null],
      moveCount: 0,
      turn: players[0],
      phase: 'roll',        // 'roll' | 'move' | 'over'
      queue: [],            // die values waiting to be moved
      sixes: 0,             // consecutive 6s this turn
      rollAgain: false,     // classic style: roll again after moving a 6
      bonus: 0,             // bonus rolls earned (capture / home / event), taken after the queue
      moves: [],
      faces: [1, 1, 1, 1],  // last raw die face per seat (for the per-player dice)
      ranking: [],          // seats in finishing order
      capd: [false, false, false, false], // has captured at least once (capture-to-enter rule)
      boost: [null, null, null, null],    // 'double' | 'choose' for the seat's next roll
      effects: [],          // { type: 'shield' | 'freeze', seat, piece, at }
      tiles: md === 'mystery' ? BOOST_TILES.map(function (a) { return { abs: a, kind: 'boost', until: 0 }; }).concat(CHAOS_TILES.map(function (a) { return { abs: a, kind: 'chaos', until: 0 }; })) : md === 'lucky' ? luckyTiles() : [],
      lk: md === 'lucky' ? newLucky() : null,
      pending: null,        // Lucky Chaos: a decision waiting for the current player (phase 'choose')
      stats: seats.map(function (x) { return x ? { captures: 0, captured: 0, sixes: 0, home: 0, rolls: 0, events: 0 } : null; }),
      rolls: 0, turnCount: 0,
      rng: (seed >>> 0) || 1,
      last: null
    };
    if (Array.isArray(perks)) perks.forEach(function (p, s) { if (s < 4 && PERK_DEFS[p]) st.perkSkin[s] = p; });
    // Passive endure: Sovereign pieces that start on the track (arrow mode) stand entrenched from the first turn.
    for (var s0 = 0; s0 < 4; s0++) { var d0 = st.perkSkin[s0] && PERK_DEFS[st.perkSkin[s0]]; if (d0 && d0.endure && st.pieces[s0]) for (var i0 = 0; i0 < np; i0++) if (onTrack(st.pieces[s0][i0])) st.effects.push({ type: 'endure', seat: s0, piece: i0, knock: d0.endure.knock || 0, stun: !!d0.endure.stun }); }
    return st;
  }

  function canEnter(st, seat) { return !st.rules.captureToEnter || st.capd[seat]; }
  function hasEffect(st, type, seat, piece) { for (var i = 0; i < st.effects.length; i++) { var e = st.effects[i]; if (e.type === type && e.seat === seat && e.piece === piece) return true; } return false; }
  function isShielded(st, seat, piece) { return hasEffect(st, 'shield', seat, piece); }
  function isFrozen(st, seat, piece) { return hasEffect(st, 'freeze', seat, piece); }
  function clearEffects(st, seat, piece) {
    st.effects = st.effects.filter(function (e) { return !(e.seat === seat && e.piece === piece); });
    if (st.lk) st.lk.kings = st.lk.kings.filter(function (k) { return !(k.seat === seat && k.piece === piece); });
  }

  function tokensAt(st, abs, exceptSeat) {
    var out = [];
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s] || s === exceptSeat) continue;
      for (var i = 0; i < nPieces(st); i++) { var p = st.pieces[s][i]; if (onTrack(p) && absOf(s, p) === abs) out.push({ seat: s, piece: i }); }
    }
    return out;
  }
  function countOwnAt(st, seat, abs) { var n = 0; for (var i = 0; i < nPieces(st); i++) { var p = st.pieces[seat][i]; if (onTrack(p) && absOf(seat, p) === abs) n++; } return n; }
  /** Is there a block of another seat on track square abs (blocks rule on, 2+ tokens of one colour)? */
  function opponentBlockAt(st, seat, abs) {
    if (!st.rules.blocks) return false;
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat) continue;
      if (st.mode === 'team' && teamOf(o) === teamOf(seat)) continue; // a partner never blocks you
      if (countOwnAt(st, o, abs) >= 2) return true;
    }
    return false;
  }
  function inBlock(st, seat, piece) {
    var p = st.pieces[seat][piece];
    return st.rules.blocks && onTrack(p) && countOwnAt(st, seat, absOf(seat, p)) >= 2;
  }
  /** Tokens that would be captured by `seat` landing on track square abs. */
  function capturesAt(st, seat, abs) {
    if (st.mode === 'friendly' || st.rules.noCapture) return [];
    if (st.rules.safeSquares && isSafeSquare(st, abs)) return [];
    var pierce = !!(perkOf(st, seat) && perkOf(st, seat).pierce); // David IV: capture through single-layer shields
    return tokensAt(st, abs, seat).filter(function (t) {
      if (!pierce) {
        if (isShielded(st, t.seat, t.piece)) return false;
        if (isVineShielded(st, t.seat, t.piece)) return false; // vine aura: shielded, and the attack reflects (see move())
        if (hasEndure(st, t.seat, t.piece)) return false; // entrenched Sovereign: the strike is absorbed
        if (isMutual(st, t.seat, t.piece)) return false; // Luarsab clash: no capture, both bounce (see move())
        var tdef = perkOf(st, t.seat);
        if (tdef && tdef.aegis && hasAllyWithin(st, t.seat, abs, 1, t.piece)) return false; // Giorgi VI: an adjacent ally guards the victim
      }
      if (st.mode === 'team' && teamOf(t.seat) === teamOf(seat)) return false; // partners are not captured
      return true;
    });
  }

  function stepFwd(p, enter) {
    if (p < 0 || p >= HOME) return null;
    if (p < LAST_TRACK) return p + 1;
    if (p === LAST_TRACK) return enter ? COL0 : CIRCLE;
    if (p === CIRCLE) return 0;
    return p + 1;
  }
  /** Exact 4-square forward path from an arrow square. Null if the jump cannot complete (overshoot home or block). No arrow chaining inside the jump. */
  function arrowJumpPath(st, seat, fromArrow, enter) {
    var path = [], c = fromArrow;
    for (var k = 0; k < ARROW_JUMP; k++) {
      c = stepFwd(c, enter);
      if (c === null) return null;
      if (onTrack(c) && opponentBlockAt(st, seat, absOf(seat, c))) return null;
      path.push(c);
    }
    return path;
  }
  /** Squares visited moving `n` forward from p (null if it would overshoot home).
   *  Arrow jump ONLY if the die move ENDS exactly on an arrow (passing over an arrow mid-path does nothing). */
  function pathOf(p, n, enter, st, seat) {
    var out = [], c = p;
    for (var k = 0; k < n; k++) {
      c = stepFwd(c, enter); if (c === null) return null; out.push(c);
    }
    if (st && arrowsOn(st) && onTrack(c) && ARROW_SQUARES.indexOf(absOf(seat, c)) >= 0) {
      var jump = arrowJumpPath(st, seat, c, enter);
      if (jump) {
        for (var j = 0; j < jump.length; j++) out.push(jump[j]);
      }
      // if jump blocked/overshoot: remain on the arrow (already last square of out)
    }
    return out;
  }
  /** Captures: normal landing, or arrow-land + jump path when a jump was appended (path longer by ARROW_JUMP after an arrow). */
  function capturesOnPath(st, seat, path) {
    var caps = [], seen = {};
    function add(abs) {
      capturesAt(st, seat, abs).forEach(function (t) {
        var id = t.seat + ':' + t.piece;
        if (!seen[id]) { seen[id] = 1; caps.push(t); }
      });
    }
    if (!path || !path.length) return caps;
    if (st && arrowsOn(st) && path.length > ARROW_JUMP) {
      var landIdx = path.length - 1 - ARROW_JUMP;
      if (landIdx >= 0 && onTrack(path[landIdx]) && ARROW_SQUARES.indexOf(absOf(seat, path[landIdx])) >= 0) {
        for (var j = landIdx; j < path.length; j++) if (onTrack(path[j])) add(absOf(seat, path[j]));
        return caps;
      }
    }
    var to = path[path.length - 1];
    if (onTrack(to)) add(absOf(seat, to));
    return caps;
  }

  /** Legal move for token `piece` of `seat` with die value v (or null). */
  function moveFor(st, seat, piece, v) {
    var p = st.pieces[seat][piece], path, to;
    if (p === HOME || isFrozen(st, seat, piece)) return null;
    if (p < 0) { if (v !== 6) return null; path = [0]; }
    else {
      var kg = st.lk && isKing(st, seat, piece);  // King's stride: +1 square when it fits
      var sb = perkStepValue(st, seat, piece); // Sovereign step bonus: +N when it fits (else the plain die value)
      var steps = v + (kg ? 1 : 0) + sb;
      path = pathOf(p, steps, canEnter(st, seat), st, seat) || ((kg || sb) && pathOf(p, v, canEnter(st, seat), st, seat)); if (!path) return null; // exact roll needed to reach home
    }
    to = path[path.length - 1];
    // Blocks can't be landed on; intermediate blocks can only be vaulted over (David VI).
    var vault = !!(perkOf(st, seat) && perkOf(st, seat).vault);
    for (var k = 0; k < path.length; k++) if (onTrack(path[k]) && opponentBlockAt(st, seat, absOf(seat, path[k]))) { if (k === path.length - 1 || !vault) return null; }
    var caps = capturesOnPath(st, seat, path);
    var tile = tileAt(st, to, seat);
    var dieLen = p < 0 ? 1 : v + ((st.lk && isKing(st, seat, piece)) ? 1 : 0) + perkStepValue(st, seat, piece);
    var jumped = !!(st && arrowsOn(st) && path.length === (p < 0 ? 1 : dieLen) + ARROW_JUMP);
    if (jumped) {
      var landAt = path[path.length - 1 - ARROW_JUMP];
      if (!(onTrack(landAt) && ARROW_SQUARES.indexOf(absOf(seat, landAt)) >= 0)) jumped = false;
    }
    var usedLen = jumped ? path.length - ARROW_JUMP : path.length;
    var usedBonus = p >= 0 && perkStepActive(st, seat, piece) && usedLen === dieLen && dieLen > v;
    return { seat: seat, piece: piece, v: v, from: p, to: to, path: path, captures: caps, leave: p < 0, finish: to === HOME,
      entersHomeColumn: p <= CIRCLE && to >= COL0 && to < HOME, tile: tile ? tile.kind : null,
      stride: !!(st.lk && isKing(st, seat, piece) && p >= 0 && usedLen === v + 1 + (usedBonus ? 1 : 0)),
      perkStep: usedBonus, arrowJump: jumped };
  }
  /** Legal moves for `seat` with die value v. */
  function legalMoves(st, seat, v) {
    var out = [];
    if (!st.pieces[seat]) return out;
    for (var i = 0; i < nPieces(st); i++) { var m = moveFor(st, seat, i, v); if (m) out.push(m); }
    return out;
  }
  /** All legal moves for the current player, one per (distinct queue value, token). */
  function queueMoves(st) {
    var seen = {}, out = [];
    st.queue.forEach(function (v) { if (seen[v]) return; seen[v] = 1; out = out.concat(legalMoves(st, st.turn, v)); });
    return out;
  }
  function tileAt(st, p, seat) {
    if ((st.mode !== 'mystery' && st.mode !== 'lucky') || !onTrack(p)) return null;
    var a = absOf(seat, p);
    for (var i = 0; i < st.tiles.length; i++) if (st.tiles[i].abs === a && st.turnCount >= st.tiles[i].until) return st.tiles[i];
    return null;
  }

  function activeLeft(st) { return st.players.filter(function (s) { return st.ranking.indexOf(s) < 0; }); }
  function hasHuman(st) { return st.players.some(function (s) { return st.seats[s].type === 'human'; }); }
  function progressOf(st, s) { return st.pieces[s].reduce(function (a, p) { return a + advance(p); }, 0); }

  /** Is the match over? Ends when one player is left, or when every human has finished (the rest are ranked by progress). */
  function teamSeats(t) { return t === 0 ? [0, 2] : [1, 3]; }
  function allHome(st, seat) { return !!(st.pieces[seat] && st.pieces[seat].length && st.pieces[seat].every(function (p) { return p === HOME; })); }
  /** Team Ludo ends only when both partners of one team have every token home. Both winners share the win. */
  function checkTeamOver(st) {
    var win = allHome(st, 0) && allHome(st, 2) ? 0 : allHome(st, 1) && allHome(st, 3) ? 1 : -1;
    if (win < 0) return false;
    // Winners share the win and are listed first, even if an opponent finished their own tokens earlier.
    function orderTeam(t) {
      var out = st.ranking.filter(function (s) { return teamOf(s) === t; });
      teamSeats(t).forEach(function (s) { if (out.indexOf(s) < 0) out.push(s); });
      return out;
    }
    st.ranking = orderTeam(win).concat(orderTeam(1 - win));
    st.phase = 'over'; st.moves = []; st.queue = [];
    return true;
  }
  function checkOver(st) {
    if (st.mode === 'team') return checkTeamOver(st);
    var left = activeLeft(st);
    var humansLeft = left.filter(function (s) { return st.seats[s].type === 'human'; }).length;
    if (left.length <= 1 || (hasHuman(st) && humansLeft === 0)) {
      left.sort(function (a, b) { return progressOf(st, b) - progressOf(st, a); }).forEach(function (s) { st.ranking.push(s); });
      st.phase = 'over'; st.moves = []; st.queue = [];
      return true;
    }
    return false;
  }

  function nextTurn(st) {
    var out = st.turn;
    // shields / freezes last until the end of the owner's next turn
    st.effects = st.effects.filter(function (e) { return !(e.seat === out && st.turnCount > e.at); });
    if (st.lk) { // Kings last for 3 of their owner's turns after the one they were crowned in
      st.lk.kings = st.lk.kings.filter(function (k) { if (k.seat === out && st.turnCount > k.at) k.left--; return k.left > 0; });
      st.lk.used = null; st.lk.forceSix = false; st.pending = null; st.lk.tg = false;
    }
    st.sixes = 0; st.queue = []; st.moves = []; st.bonus = 0; st.rollAgain = false; st.turnCount++;
    if (checkOver(st)) return;
    var idx = st.players.indexOf(out);
    for (var k = 1; k <= st.players.length; k++) {
      var s = st.players[(idx + k) % st.players.length];
      if (st.ranking.indexOf(s) < 0) { st.turn = s; break; }
    }
    st.phase = 'roll';
  }
  /** Queue spent (or unusable): roll again for a classic 6, then bonus rolls, else the turn passes. */
  function afterQueue(st) {
    st.queue = []; st.moves = [];
    if (st.rollAgain) { st.rollAgain = false; st.phase = 'roll'; return 'again'; }
    if (st.bonus > 0) { st.bonus--; st.sixes = 0; st.phase = 'roll'; return 'bonus'; }
    nextTurn(st);
    return 'pass';
  }
  function resolveQueue(st) {
    st.moves = queueMoves(st);
    if (st.moves.length) { st.phase = 'move'; return 'move'; }
    return afterQueue(st);
  }

  /** Does the current player have to pick the value of the next roll (Pick a number event)? */
  function mustChoose(st) { return st.phase === 'roll' && st.boost[st.turn] === 'choose'; }

  /**
   * Roll the die for the current player (value optional, for tests / replays / the Pick-a-number event).
   * Returns { raw, value, forfeit, again, next } where next is 'roll' | 'move' | 'again' | 'bonus' | 'pass'.
   */
  function roll(st, value) {
    if (st.phase !== 'roll') throw new Error('not in roll phase');
    var seat = st.turn, boost = st.boost[seat];
    if (boost === 'choose' && !value) value = chooseDieValue(st, seat, 'hard');
    var free = !!(st.lk && st.lk.forceSix); // Lucky 6 power: a 6 that never counts toward three 6s
    if (free) { value = 6; st.lk.forceSix = false; }
    if (st.lk) st.lk.used = null;
    var raw = value || rollDie(st), v = raw;
    if (boost === 'double') v = raw * 2;
    // George V floor: while the window holds, a roll below 3 counts as 3.
    var floored = false;
    if (Array.isArray(st.perkRollFloor) && st.perkRollFloor[seat] != null && st.turnCount <= st.perkRollFloor[seat] && v < 3) { v = 3; floored = true; }
    // Archil II relic: an odd roll resurrects the pawn on its cross tile (now a permanent sanctuary).
    var relic = null;
    if (st.perkRelic && st.perkRelic[seat]) {
      var rc = st.perkRelic[seat]; st.perkRelic[seat] = null;
      if (v % 2 === 1) {
        st.pieces[seat][rc.piece] = posFromAbs(seat, rc.abs);
        if (!perkSafeArr(st).some(function (e) { return e.abs === rc.abs; })) perkSafeArr(st).push({ abs: rc.abs, until: null });
        relic = { restored: true, piece: rc.piece, abs: rc.abs };
      } else { relic = { restored: false, piece: rc.piece, abs: rc.abs }; }
    }
    st.boost[seat] = null;
    st.faces[seat] = floored ? v : raw; st.rolls++; st.stats[seat].rolls++;
    if (raw === 6) { st.stats[seat].sixes++; if (!free) st.sixes++; }
    var res = { seat: seat, raw: raw, value: v, doubled: boost === 'double', chosen: boost === 'choose', lucky6: free, forfeit: false, again: false, next: null, perkRollFloor: floored, relic: relic };
    if (raw === 6 && st.sixes >= MAX_SIXES) {
      st.last = { type: 'forfeit', seat: seat, lost: st.queue.slice() };
      res.forfeit = true; res.lost = st.queue.slice();
      nextTurn(st); res.next = 'pass';
      return res;
    }
    st.queue.push(v);
    if (st.rules.rollStyle === 'star') {
      if (raw === 6) { res.again = true; res.next = 'roll'; st.last = { type: 'six', seat: seat }; return res; }
      res.next = resolveQueue(st);
    } else {
      st.rollAgain = raw === 6;
      res.again = raw === 6;
      res.next = resolveQueue(st);
    }
    if (res.next !== 'move') st.last = { type: 'nomove', seat: seat, value: v };
    return res;
  }

  function removeQueueValue(st, v) { var i = st.queue.indexOf(v); if (i >= 0) st.queue.splice(i, 1); }
  function sendHome(st, byseat, t, bypiece) {
    var wasKing = isKing(st, t.seat, t.piece);
    st.pieces[t.seat][t.piece] = -1; clearEffects(st, t.seat, t.piece);
    if (Array.isArray(st.perkStep) && Array.isArray(st.perkStep[t.seat])) st.perkStep[t.seat][t.piece] = 0; // a captured pawn loses its pending step bonus
    perkEndureSpentArr(st, t.seat)[t.piece] = false; // a recaptured stand reforms when the pawn re-enters
    if (byseat != null) { st.stats[byseat].captures++; st.stats[t.seat].captured++; st.capd[byseat] = true; }
    if (st.lk) {
      st.lk.kills[t.seat][t.piece] = 0;
      if (byseat != null) {
        st.lk.revenge[t.seat] = true; st.lk.streak[t.seat] = 0; // Revenge Charge; Lucky Streak resets
        addCharge(st, byseat, 1);
        if (wasKing) { addCharge(st, byseat, 2); st.lk.kingFall = { by: byseat, seat: t.seat, piece: t.piece, at: st.turnCount }; }
        if (bypiece != null) st.lk.kills[byseat][bypiece]++;
      }
    }
  }

  // ---------- Mystery Tiles events ----------
  function nearestRival(st, seat, abs, maxD, dir, filter) {
    var best = null, bd = Infinity;
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat || st.ranking.indexOf(o) >= 0) continue;
      for (var i = 0; i < nPieces(st); i++) {
        var p = st.pieces[o][i]; if (!onTrack(p)) continue;
        var a = absOf(o, p), fwd = (a - abs + TRACK) % TRACK, back = (abs - a + TRACK) % TRACK;
        var d = dir > 0 ? fwd : dir < 0 ? back : Math.min(fwd, back);
        if (d === 0 || d > maxD) continue;
        var t = { seat: o, piece: i, abs: a, d: d };
        if (filter && !filter(t)) continue;
        if (d < bd || (d === bd && fwd < (best ? (best.abs - abs + TRACK) % TRACK : Infinity))) { bd = d; best = t; }
      }
    }
    return best;
  }
  function eventTarget(st, ev, seat, piece) {
    var p = st.pieces[seat][piece], abs = absOf(seat, p);
    if (ev === 'freeze') return nearestRival(st, seat, abs, 12, 1, function (t) { return !isFrozen(st, t.seat, t.piece); });
    if (ev === 'zap') return nearestRival(st, seat, abs, 3, 0, function (t) { return !(st.rules.safeSquares && isSafeSquare(st, t.abs)) && !isShielded(st, t.seat, t.piece) && !isVineShielded(st, t.seat, t.piece) && !inBlock(st, t.seat, t.piece); });
    if (ev === 'swap') return nearestRival(st, seat, abs, 26, 0, function (t) {
      return !isShielded(st, t.seat, t.piece) && !isVineShielded(st, t.seat, t.piece) && !inBlock(st, t.seat, t.piece) && posFromAbs(seat, t.abs) <= LAST_TRACK && posFromAbs(t.seat, abs) <= LAST_TRACK && st.pieces[t.seat][t.piece] <= LAST_TRACK;
    });
    return null;
  }
  function jumpDest(st, seat, piece, n) {
    var p = st.pieces[seat][piece], path = [], c = p, enter = canEnter(st, seat);
    for (var k = 0; k < n; k++) {
      var nx = stepFwd(c, enter); if (nx === null) break; path.push(nx); c = nx;
    }
    while (path.length && onTrack(path[path.length - 1]) && opponentBlockAt(st, seat, absOf(seat, path[path.length - 1]))) path.pop();
    return path;
  }
  function eventValid(st, ev, seat, piece) {
    if (ev === 'freeze' || ev === 'zap' || ev === 'swap') return !!eventTarget(st, ev, seat, piece);
    if (ev === 'jump3') return jumpDest(st, seat, piece, 3).length > 0;
    if (ev === 'jump6') return jumpDest(st, seat, piece, 6).length > 0;
    if (ev === 'back3') return st.pieces[seat][piece] > 0;
    if (ev === 'shield') return !isShielded(st, seat, piece);
    return true;
  }
  /**
   * Spin the wheel of `tile` for token (seat, piece) and apply the event (ev may be forced for tests).
   * Returns { tile, kind, event, wheel, index, target, from, to, path, captures, finish }.
   */
  function applyEvent(st, tile, seat, piece, forced) {
    var wheel = WHEELS[tile.kind];
    var valid = wheel.filter(function (e) { return eventValid(st, e, seat, piece); });
    var ev = forced && valid.indexOf(forced) >= 0 ? forced : valid[Math.floor(rngNext(st) * valid.length)];
    tile.until = st.turnCount + 2 * activeLeft(st).length; // tile recharges after two full rounds
    st.stats[seat].events++;
    var p = st.pieces[seat][piece];
    var out = { tile: tile.abs, kind: tile.kind, event: ev, wheel: wheel, index: wheel.indexOf(ev), seat: seat, piece: piece, from: p, to: p, path: [], captures: [], finish: false, target: null };
    var t;
    switch (ev) {
      case 'shield': st.effects.push({ type: 'shield', seat: seat, piece: piece, at: st.turnCount }); break;
      case 'extra': st.bonus++; break;
      case 'double': st.boost[seat] = 'double'; break;
      case 'choose': st.boost[seat] = 'choose'; break;
      case 'frozen': st.effects.push({ type: 'freeze', seat: seat, piece: piece, at: st.turnCount }); break;
      case 'freeze':
        t = eventTarget(st, 'freeze', seat, piece); out.target = { seat: t.seat, piece: t.piece };
        st.effects.push({ type: 'freeze', seat: t.seat, piece: t.piece, at: st.turnCount }); break;
      case 'zap':
        t = eventTarget(st, 'zap', seat, piece); out.target = { seat: t.seat, piece: t.piece, from: st.pieces[t.seat][t.piece] };
        sendHome(st, seat, t); break;
      case 'swap':
        t = eventTarget(st, 'swap', seat, piece);
        var myAbs = absOf(seat, p);
        out.target = { seat: t.seat, piece: t.piece, from: st.pieces[t.seat][t.piece], to: posFromAbs(t.seat, myAbs) };
        st.pieces[seat][piece] = posFromAbs(seat, t.abs); st.pieces[t.seat][t.piece] = out.target.to;
        out.to = st.pieces[seat][piece]; break;
      case 'back3':
        var b = p === CIRCLE ? LAST_TRACK - 2 : Math.max(0, p - 3), bp = [];
        for (var c = p; c !== b;) { c = c === CIRCLE ? LAST_TRACK : c - 1; bp.push(c); }
        st.pieces[seat][piece] = b; out.to = b; out.path = bp; break;
      case 'jump3': case 'jump6':
        var path = jumpDest(st, seat, piece, ev === 'jump3' ? 3 : 6), to = path[path.length - 1];
        st.pieces[seat][piece] = to; out.to = to; out.path = path;
        if (onTrack(to)) { out.captures = capturesAt(st, seat, absOf(seat, to)); out.captures.forEach(function (x) { sendHome(st, seat, x); }); if (out.captures.length && st.rules.bonusOnCapture) st.bonus++; }
        if (to === HOME) { out.finish = true; st.stats[seat].home++; clearEffects(st, seat, piece); if (st.rules.bonusOnHome) st.bonus++; }
        break;
      default: break; // calm
    }
    return out;
  }

  /**
   * Move token `piece` of the current player using queue value v (optional when only one value fits).
   * Returns { seat, piece, v, from, to, path, captures, finish, event, finishedPlayer, over, next }.
   */
  function move(st, piece, v, forcedEvent) {
    if (st.phase !== 'move') throw new Error('not in move phase');
    var m = null;
    for (var i = 0; i < st.moves.length; i++) { var c = st.moves[i]; if (c.piece === piece && (v == null || c.v === v)) { if (!m || (v == null && c.v > m.v)) m = c; } }
    if (!m) throw new Error('illegal move');
    var seat = st.turn;
    st.pieces[seat][piece] = m.to;
    // Passive endure reforms on the track: a Sovereign stand is entrenched again after re-entering.
    var mdef0 = perkOf(st, seat);
    if (mdef0 && mdef0.endure && onTrack(m.to) && !hasEndure(st, seat, piece) && !perkEndureSpent(st, seat, piece)) st.effects.push({ type: 'endure', seat: seat, piece: piece, knock: mdef0.endure.knock || 0, stun: !!mdef0.endure.stun });
    st.moveCount = (st.moveCount || 0) + 1;
    removeQueueValue(st, m.v);
    var kingCaps = m.captures.filter(function (t) { return isKing(st, t.seat, t.piece); });
    // Defender-side triggers run as each victim is sent home (relocate, ally-captured rally, reciprocal kill).
    var perkDefender = null, perkRelocated = [];
    m.captures.forEach(function (t) {
      var victimAbs = absOf(t.seat, st.pieces[t.seat][t.piece]); // read before sendHome clears the square
      sendHome(st, seat, t, piece);
      if (Array.isArray(st.perkRelocate) && st.perkRelocate[t.seat] != null && st.turnCount <= st.perkRelocate[t.seat]) {
        var star = nearestStarAbs(victimAbs);
        st.pieces[t.seat][t.piece] = posFromAbs(t.seat, star);
        perkRelocated.push({ seat: t.seat, piece: t.piece, to: star });
      }
      var d = applyAllyCapturedPerk(st, t.seat, t.piece, victimAbs, { seat: seat, piece: piece });
      if (d) perkDefender = d;
    });
    if (m.captures.length && st.rules.bonusOnCapture) st.bonus++;
    if (m.finish) { st.stats[seat].home++; clearEffects(st, seat, piece); if (st.rules.bonusOnHome) st.bonus++; }
    // Sovereign perk hooks (all no-ops when the seat has no perk skin equipped).
    // Firing order: vine reflect, endure absorb, mutual clash, star, land, capture,
    // six, corner, divider, home-approach, high/low roll, proximity, approach, home.
    var perksFired = [], perkKnock = null, perkMutual = null;
    if (m.perkStep) perkStepArr(st, seat)[piece] = 0; // step bonus spent on this move
    if (!m.finish && onTrack(m.to)) {
      var landAbs = absOf(seat, m.to);
      var reflectFired = false;
      var vines = vineReflectTargets(st, seat, landAbs);
      if (vines.length) {
        // The attack reflects off the golden vine aura: the attacker goes home instead.
        sendHome(st, vines[0].seat, { seat: seat, piece: piece }, vines[0].piece);
        perksFired.push({ id: 'demetrius', trigger: 'reflect', banner: PERK_DEFS.demetrius.banner, reflect: { by: vines[0] } });
        reflectFired = true;
      }
      // Entrenched enemies absorb the strike (safe squares never trigger combat).
      if (!reflectFired && st.pieces[seat][piece] === m.to && !(st.rules.safeSquares && isSafeSquare(st, landAbs))) {
        var endures = endureTargets(st, seat, landAbs);
        if (endures.length) {
          var maxKnock = 0, stunHit = false, eowner = null;
          endures.forEach(function (t) { var e = endureEffect(st, t.seat, t.piece); if (e) { if (e.knock) maxKnock = Math.max(maxKnock, e.knock); if (e.stun) stunHit = true; if (!eowner) eowner = t; } consumeEndure(st, t.seat, t.piece); markEndureSpent(st, t.seat, t.piece); });
          if (maxKnock > 0) perkKnock = knockBack(st, seat, piece, maxKnock);
          if (stunHit && onTrack(st.pieces[seat][piece])) st.effects.push({ type: 'freeze', seat: seat, piece: piece, at: st.turnCount });
          if (eowner) { var edef = perkOf(st, eowner.seat); perksFired.push({ id: edef ? edef.id : null, trigger: 'endure', banner: edef ? edef.banner : 'ENDURE', endure: { by: eowner, knock: maxKnock, stun: stunHit } }); }
        }
      }
      // Mutual clash: both pieces bounce back 1, no capture, no bonus roll.
      if (!reflectFired && st.pieces[seat][piece] === m.to && !(st.rules.safeSquares && isSafeSquare(st, landAbs))) {
        var mutuals = mutualTargets(st, seat, landAbs);
        if (mutuals.length) {
          var mb = knockBack(st, seat, piece, 1);
          var md = knockBack(st, mutuals[0].seat, mutuals[0].piece, 1);
          perkMutual = { attacker: mb, defender: md, by: mutuals[0] };
          var mdef = perkOf(st, mutuals[0].seat);
          perksFired.push({ id: mdef ? mdef.id : null, trigger: 'mutual', banner: mdef ? mdef.banner : 'MUTUAL CLASH', mutual: perkMutual });
        }
      }
      if (!reflectFired) {
        var fired;
        if (STAR_SQUARES.indexOf(landAbs) >= 0) { fired = applyStarPerk(st, seat, piece, landAbs); if (fired) perksFired.push(fired); }
        fired = applyTrigger(st, seat, piece, landAbs, 'onLand'); if (fired) perksFired.push(fired);
        if (m.captures.length) { fired = applyCapturePerk(st, seat, piece, landAbs); if (fired) perksFired.push(fired); }
        if (m.v === 6) { fired = applyTrigger(st, seat, piece, landAbs, 'onSix'); if (fired) perksFired.push(fired); }
        if (START_SQUARES.indexOf(landAbs) >= 0) { fired = applyTrigger(st, seat, piece, landAbs, 'onCorner'); if (fired) perksFired.push(fired); }
        if (DIVIDER_SQUARES.indexOf(landAbs) >= 0) { fired = applyTrigger(st, seat, piece, landAbs, 'onDivider'); if (fired) perksFired.push(fired); }
        if (m.to >= 49 && m.to <= 51) { fired = applyTrigger(st, seat, piece, landAbs, 'onHomeApproach'); if (fired) perksFired.push(fired); }
        if (m.v >= 5) { fired = applyTrigger(st, seat, piece, landAbs, 'onHighRoll', { v: m.v }); if (fired) perksFired.push(fired); }
        if (m.v <= 2) { fired = applyTrigger(st, seat, piece, landAbs, 'onLowRoll', { v: m.v }); if (fired) perksFired.push(fired); }
        fired = applyTrigger(st, seat, piece, landAbs, 'onProximity'); if (fired) perksFired.push(fired);
        // Approach: enemy Sovereign pieces near the landing square react to the bypass.
        for (var s = 0; s < 4; s++) {
          if (s === seat || !st.pieces[s]) continue;
          var adef = perkOf(st, s);
          if (!adef || !adef.onApproach) continue;
          var best = -1, bestD = 99;
          for (var i = 0; i < nPieces(st); i++) { var ap = st.pieces[s][i]; if (!onTrack(ap)) continue; var dd = circDistAbs(absOf(s, ap), landAbs); if (dd >= 1 && dd <= 3 && dd < bestD) { bestD = dd; best = i; } }
          if (best >= 0) { fired = applyTrigger(st, s, best, landAbs, 'onApproach', { moverSeat: seat, moverPiece: piece }); if (fired) perksFired.push(fired); }
        }
      }
    }
    if (m.finish) { var hp = applyTrigger(st, seat, piece, null, 'onHome'); if (hp) perksFired.push(hp); }
    var perk = perksFired.length ? perksFired[0] : null;
    var res = { seat: seat, piece: piece, v: m.v, from: m.from, to: m.to, path: m.path, captures: m.captures, finish: m.finish, event: null, finishedPlayer: false, over: false, next: null,
      stride: !!m.stride, crowned: null, kingCaptured: kingCaps.length > 0, perk: perk, perks: perksFired, perkDefender: perkDefender, perkRelocated: perkRelocated, perkKnock: perkKnock, perkMutual: perkMutual, perkStep: !!m.perkStep,
      leave: !!m.leave, entersHomeColumn: !!m.entersHomeColumn, arrowJump: !!m.arrowJump };
    if (st.lk && m.captures.length && checkKing(st, seat, piece)) res.crowned = { seat: seat, piece: piece };
    var tile = !m.finish ? tileAt(st, m.to, seat) : null;
    if (tile) res.event = st.mode === 'lucky' ? luckyActivate(st, tile, seat, piece, forcedEvent) : applyEvent(st, tile, seat, piece, forcedEvent);
    st.last = { type: 'move', seat: seat, piece: piece, from: m.from, to: st.pieces[seat][piece], captures: m.captures.length, finish: m.finish, event: res.event ? res.event.event : null };
    if (st.phase === 'choose') { res.next = 'choose'; return res; }
    var t = continueTurn(st, seat);
    res.finishedPlayer = t.finishedPlayer; res.next = t.next;
    res.over = st.phase === 'over';
    return res;
  }
  /** After a move (or a resolved Lucky choice): finished player, remaining queue, bonus rolls or next player. */
  function continueTurn(st, seat) {
    var out = { finishedPlayer: false, next: null };
    if (st.pieces[seat].every(function (p) { return p === HOME; }) && st.ranking.indexOf(seat) < 0) {
      st.ranking.push(seat); out.finishedPlayer = true;
      nextTurn(st); out.next = 'pass';
    } else {
      st.moves = st.queue.length ? queueMoves(st) : [];
      if (st.moves.length) { st.phase = 'move'; out.next = 'move'; }
      else out.next = afterQueue(st);
    }
    return out;
  }


  // ================= Lucky Chaos Ludo (mode 'lucky') =================
  // 8 Lucky Tiles (4 Boost "?" + 4 Chaos "!") and 4 Danger Tiles ("High Risk / High Reward": 50/50 Boost or Chaos,
  // stronger outcomes). Lucky Streak, Revenge Charge, Lucky Charge meter + Mega Wheel, King tokens, stored powers.
  var LUCKY_BOOST = [4, 17, 30, 43], LUCKY_CHAOS = [10, 23, 36, 49], DANGER_TILES = [6, 19, 32, 45];
  var LWHEELS = {
    boost: ['shield', 'jump3', 'dbl', 'extra', 'six', 'escape'],
    chaos: ['bomb', 'swapc', 'zapc', 'freeze', 'back3', 'wild'],
    mega: ['rocket', 'free', 'guard', 'turn2', 'storm', 'crown']
  };
  var POWERS = ['dbl', 'six', 'escape'];
  var MAX_CHARGE = 5, MAX_POWERS = 2, KING_TURNS = 3, KING_KILLS = 2, ZAP_CAP = 40, MAX_STREAK = 3;
  var LUCKY_INFO = {
    dbl: { name: 'Double Roll', text: 'Stored power: use it before a roll to make that roll count double.', good: true },
    six: { name: 'Lucky 6', text: 'Stored power: use it instead of rolling to get a 6 (it never counts toward three 6s).', good: true },
    escape: { name: 'Safe Escape', text: 'Stored power: your most threatened token dashes to the next safe square (up to 8 ahead).', good: true },
    bomb: { name: 'Bomb', text: 'Every other token within 2 squares (yours too!) slides back 3. Safe squares, shields and Kings are immune.', good: null },
    swapc: { name: 'Swap', text: 'You may swap this token with the nearest rival token up to 12 squares ahead.', good: true },
    zapc: { name: 'Zap', text: 'The nearest rival within 3 squares goes back to base (tokens 40+ squares along only slide back 6).', good: true },
    wild: { name: 'Wild Jump', text: 'A random 1-6 is drawn: jump this token that far, or stay.', good: null },
    rocket: { name: 'Rocket', text: 'Your best token blasts up to 8 squares forward.', good: true },
    free: { name: 'Free Token', text: 'A token leaves your base onto your start square.', good: true },
    guard: { name: 'Royal Guard', text: 'All your tokens on the track get a Shield until the end of your next turn.', good: true },
    turn2: { name: 'Double Turn', text: 'You get two extra rolls this turn.', good: true },
    storm: { name: 'Storm', text: 'Rival tokens up to 6 squares behind your tokens slide back 3.', good: true },
    crown: { name: 'Crown', text: 'Your most advanced token becomes King for 3 turns.', good: true }
  };
  Object.keys(LUCKY_INFO).forEach(function (k) { EVENT_INFO[k] = LUCKY_INFO[k]; });
  var DANGER_INFO = {
    jump3: { name: 'Jump +5', text: 'Danger bonus: this token jumps 5 squares forward.' },
    extra: { name: '2 Extra rolls', text: 'Danger bonus: you get two more rolls this turn.' },
    bomb: { name: 'Big Bomb', text: 'Every other token within 3 squares (yours too!) slides back 3.' },
    back3: { name: 'Back 5', text: 'Danger! This token slides 5 squares back.' }
  };
  /** Name/text for an event result (Danger tiles make some outcomes stronger). */
  function eventLabel(ev, danger) {
    var b = EVENT_INFO[ev] || { name: ev, text: '' }, d = danger && DANGER_INFO[ev];
    return { name: d ? d.name : b.name, text: d ? d.text : b.text, good: b.good };
  }

  function isLucky(st) { return st.mode === 'lucky' && !!st.lk; }
  function newLucky() {
    return { charge: [0, 0, 0, 0], streak: [0, 0, 0, 0], revenge: [false, false, false, false], powers: [[], [], [], []],
      kills: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], kings: [], used: null, forceSix: false, kingFall: null, tg: false };
  }
  function luckyTiles() {
    return LUCKY_BOOST.map(function (a) { return { abs: a, kind: 'boost', until: 0 }; })
      .concat(LUCKY_CHAOS.map(function (a) { return { abs: a, kind: 'chaos', until: 0 }; }))
      .concat(DANGER_TILES.map(function (a) { return { abs: a, kind: 'danger', until: 0 }; }));
  }
  function isKing(st, seat, piece) {
    if (!st.lk) return false;
    for (var i = 0; i < st.lk.kings.length; i++) { var k = st.lk.kings[i]; if (k.seat === seat && k.piece === piece) return true; }
    return false;
  }
  function kingOf(st, seat, piece) { if (!st.lk) return null; for (var i = 0; i < st.lk.kings.length; i++) { var k = st.lk.kings[i]; if (k.seat === seat && k.piece === piece) return k; } return null; }
  /** Immune to Chaos effects (shielded tokens, vine-shielded tokens and Kings). */
  function immune(st, seat, piece) { return isShielded(st, seat, piece) || isVineShielded(st, seat, piece) || isKing(st, seat, piece); }
  function onMainTrack(p) { return p >= 0 && (p <= LAST_TRACK || p === CIRCLE); }
  /** Comeback level 0..2 from the progress gap to the leader (capped). */
  function comebackLevel(st, seat) {
    var lead = 0; activeLeft(st).forEach(function (s) { lead = Math.max(lead, progressOf(st, s)); });
    var gap = (lead - progressOf(st, seat)) / (nPieces(st) * 58);
    return gap >= 0.3 ? 2 : gap >= 0.15 ? 1 : 0;
  }
  function addCharge(st, seat, n) { st.lk.charge[seat] = Math.min(MAX_CHARGE, st.lk.charge[seat] + n); }
  function canStore(st, seat, id) { var pw = st.lk.powers[seat]; return pw.length < MAX_POWERS && pw.indexOf(id) < 0; }
  function canMega(st, seat) { return isLucky(st) && st.phase === 'roll' && st.turn === seat && st.lk.charge[seat] >= MAX_CHARGE; }
  function backPos(p, n) { return p === CIRCLE ? LAST_TRACK - (n - 1) : Math.max(0, p - n); }
  function backPath(p, to) { var out = [], c = p; while (c !== to) { c = c === CIRCLE ? LAST_TRACK : c - 1; out.push(c); } return out; }
  function circDist(a, b) { var d = Math.abs(a - b) % TRACK; return Math.min(d, TRACK - d); }
  function safeHere(st, abs) { return st.rules.safeSquares && isSafeAbs(abs); }

  /** Called when a token becomes King-eligible after its captures. */
  function checkKing(st, seat, piece) {
    if (!isLucky(st) || !onTrack(st.pieces[seat][piece]) && !(st.pieces[seat][piece] >= COL0 && st.pieces[seat][piece] < HOME)) return false;
    if (st.lk.kills[seat][piece] >= KING_KILLS && !isKing(st, seat, piece)) {
      st.lk.kings.push({ seat: seat, piece: piece, left: KING_TURNS, at: st.turnCount });
      st.lk.kills[seat][piece] = 0;
      return true;
    }
    return false;
  }
  function crown(st, seat, piece) {
    var k = kingOf(st, seat, piece);
    if (k) { k.left = KING_TURNS; k.at = st.turnCount; } else st.lk.kings.push({ seat: seat, piece: piece, left: KING_TURNS, at: st.turnCount });
  }

  function jumpCapture(st, seat, piece, path, out) {
    if (!path.length) return;
    var from = st.pieces[seat][piece], to = path[path.length - 1];
    st.pieces[seat][piece] = to;
    out.moves.push({ seat: seat, piece: piece, from: from, to: to, path: path });
    if (onTrack(to)) {
      var caps = capturesAt(st, seat, absOf(seat, to));
      caps.forEach(function (x) { sendHome(st, seat, x, piece); out.captures.push(x); });
      if (caps.length && st.rules.bonusOnCapture) st.bonus++;
      if (caps.length && checkKing(st, seat, piece)) out.crowned = { seat: seat, piece: piece };
    }
    if (to === HOME) { out.finish = true; st.stats[seat].home++; clearEffects(st, seat, piece); if (st.rules.bonusOnHome) st.bonus++; }
  }
  function slideBack(st, t, n, out) {
    var p = st.pieces[t.seat][t.piece], to = backPos(p, n);
    if (to === p) return;
    st.pieces[t.seat][t.piece] = to;
    out.moves.push({ seat: t.seat, piece: t.piece, from: p, to: to, path: backPath(p, to), back: true });
  }
  function bombTargets(st, seat, piece, r) {
    var a = absOf(seat, st.pieces[seat][piece]), out = [];
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s]) continue;
      for (var i = 0; i < nPieces(st); i++) {
        if (s === seat && i === piece) continue;
        var p = st.pieces[s][i]; if (!onMainTrack(p) || p === 0) continue;
        var b = absOf(s, p);
        if (circDist(a, b) > r || safeHere(st, b) || immune(st, s, i)) continue;
        out.push({ seat: s, piece: i });
      }
    }
    return out;
  }
  function luckyTarget(st, ev, seat, piece) {
    var p = st.pieces[seat][piece], abs = absOf(seat, p);
    if (ev === 'freeze') return nearestRival(st, seat, abs, 12, 1, function (t) { return !isFrozen(st, t.seat, t.piece) && !isKing(st, t.seat, t.piece) && !isShielded(st, t.seat, t.piece); });
    if (ev === 'zapc') return nearestRival(st, seat, abs, 3, 0, function (t) { return !safeHere(st, t.abs) && !immune(st, t.seat, t.piece) && !inBlock(st, t.seat, t.piece) && onMainTrack(st.pieces[t.seat][t.piece]); });
    if (ev === 'swapc') return nearestRival(st, seat, abs, 12, 1, function (t) {
      return !immune(st, t.seat, t.piece) && !inBlock(st, t.seat, t.piece) && !safeHere(st, t.abs) && st.pieces[t.seat][t.piece] <= LAST_TRACK &&
        p <= LAST_TRACK && posFromAbs(seat, t.abs) <= LAST_TRACK && posFromAbs(seat, t.abs) > p && posFromAbs(t.seat, abs) <= LAST_TRACK;
    });
    return null;
  }
  function escapeTarget(st, seat) {
    var best = null, bs = -Infinity;
    for (var i = 0; i < nPieces(st); i++) {
      var p = st.pieces[seat][i]; if (p < 0 || p > LAST_TRACK || isFrozen(st, seat, i)) continue;
      if (isSafeAbs(absOf(seat, p))) continue;
      for (var d = 1; d <= 8 && p + d <= LAST_TRACK; d++) {
        var a = absOf(seat, p + d);
        if (opponentBlockAt(st, seat, a)) break;
        if (isSafeAbs(a)) {
          var sc = threatsTo(st, seat, absOf(seat, p)) * 100 + p;
          if (sc > bs) { bs = sc; best = { piece: i, to: p + d, threat: threatsTo(st, seat, absOf(seat, p)) }; }
          break;
        }
      }
    }
    return best;
  }
  function eventValidL(st, ev, seat, piece, danger) {
    var p = st.pieces[seat][piece];
    switch (ev) {
      case 'shield': return !isShielded(st, seat, piece);
      case 'jump3': return jumpDest(st, seat, piece, danger ? 5 : 3).length > 0;
      case 'extra': return true;
      case 'dbl': case 'six': case 'escape': return canStore(st, seat, ev);
      case 'bomb': return bombTargets(st, seat, piece, danger ? 3 : 2).length > 0;
      case 'swapc': case 'zapc': case 'freeze': return !!luckyTarget(st, ev, seat, piece);
      case 'back3': return onMainTrack(p) && p > 0;
      case 'wild': return jumpDest(st, seat, piece, 1).length > 0;
    }
    return false;
  }
  var EV_VALUE = { shield: 2, jump3: 3, dbl: 2.5, extra: 3, six: 2.5, escape: 2, bomb: 1, swapc: 2.5, zapc: 4, freeze: 2, back3: -3, wild: 1.5 };
  /** Wheel spin. Lucky Streak and comeback add a capped "lucky nudge": a second spin, keeping the better result. */
  function spinLucky(st, ctx, forced, exclude) {
    var list = LWHEELS[ctx.kind].filter(function (e) { return e !== exclude && eventValidL(st, e, ctx.seat, ctx.piece, ctx.danger); });
    if (!list.length) return exclude ? null : 'extra';
    if (forced && list.indexOf(forced) >= 0) return forced;
    var pick = list[Math.floor(rngNext(st) * list.length)];
    var nudge = nudgeChance(st, ctx.seat);
    if (nudge > 0 && list.length > 1 && rngNext(st) < nudge) {
      var alt = list[Math.floor(rngNext(st) * list.length)];
      if (EV_VALUE[alt] > EV_VALUE[pick]) { pick = alt; ctx.nudged = true; }
    }
    return pick;
  }
  function nudgeChance(st, seat) { return Math.min(0.5, 0.15 * st.lk.streak[seat] + 0.1 * comebackLevel(st, seat)); }

  function luckyOut(ctx, ev) {
    return { tile: ctx.tile, tileKind: ctx.tileKind, kind: ctx.kind, danger: ctx.danger, seat: ctx.seat, piece: ctx.piece, wheel: LWHEELS[ctx.kind],
      index: LWHEELS[ctx.kind].indexOf(ev), event: ev, gain: ctx.gain, nudged: !!ctx.nudged, revenge: !!ctx.revenge, streak: ctx.streak,
      moves: [], sent: [], captures: [], finish: false, crowned: null, target: null, stored: null, choice: null, amount: 0, lucky: true };
  }
  /** Landing exactly on an active Lucky/Danger tile. May leave a pending choice (st.phase 'choose'). */
  function luckyActivate(st, tile, seat, piece, forced) {
    var lk = st.lk, danger = tile.kind === 'danger';
    var fo = typeof forced === 'string' ? { event: forced } : (forced || {});
    var kind = danger ? (fo.kind || (rngNext(st) < 0.5 ? 'boost' : 'chaos')) : tile.kind;
    tile.until = st.turnCount + 2 * activeLeft(st).length; // inactive for 2 rounds
    st.stats[seat].events++;
    // Lucky Charge: +1 per activation, +1 on a Danger tile, +1 when far behind. Capped at 2 so one spin cannot fill Mega.
    var gain = 1 + (danger ? 1 : 0) + (comebackLevel(st, seat) >= 2 ? 1 : 0);
    if (gain > 2) gain = 2;
    if (lk.tg) gain = 0; // charge from tiles: once per turn (captures still add +1 each)
    lk.tg = true;
    addCharge(st, seat, gain);
    var ctx = { tile: tile.abs, tileKind: tile.kind, kind: kind, danger: danger, seat: seat, piece: piece, gain: gain, streak: lk.streak[seat] };
    var ev;
    if (lk.revenge[seat]) {
      lk.revenge[seat] = false;
      var a = spinLucky(st, ctx, fo.event), b = spinLucky(st, ctx, fo.alt, a);
      lk.streak[seat] = Math.min(MAX_STREAK, lk.streak[seat] + 1);
      if (b) {
        ctx.revenge = true;
        var out = luckyOut(ctx, a);
        out.choice = { type: 'revenge', options: [a, b] };
        st.pending = { type: 'revenge', seat: seat, options: [a, b], ctx: ctx, fo: fo };
        st.phase = 'choose';
        return out;
      }
      ev = a;
    } else {
      ev = spinLucky(st, ctx, fo.event);
      lk.streak[seat] = Math.min(MAX_STREAK, lk.streak[seat] + 1);
    }
    return resolveLucky(st, ctx, ev, fo);
  }
  function resolveLucky(st, ctx, ev, fo) {
    if (ev === 'swapc') {
      var out = luckyOut(ctx, ev), t = luckyTarget(st, 'swapc', ctx.seat, ctx.piece);
      out.target = { seat: t.seat, piece: t.piece };
      out.choice = { type: 'swap', options: ['swap', 'stay'] };
      st.pending = { type: 'swap', seat: ctx.seat, options: ['swap', 'stay'], ctx: ctx, ev: ev };
      st.phase = 'choose';
      return out;
    }
    if (ev === 'wild') {
      var n = (fo && fo.wild) || rollDie(st), o2 = luckyOut(ctx, ev);
      o2.amount = n; o2.choice = { type: 'wild', options: ['jump', 'stay'], n: n };
      st.pending = { type: 'wild', seat: ctx.seat, options: ['jump', 'stay'], n: n, ctx: ctx, ev: ev };
      st.phase = 'choose';
      return o2;
    }
    return applyLucky(st, ctx, ev, null);
  }
  function applyLucky(st, ctx, ev, arg) {
    var seat = ctx.seat, piece = ctx.piece, out = luckyOut(ctx, ev), t, p = st.pieces[seat][piece];
    switch (ev) {
      case 'shield': st.effects.push({ type: 'shield', seat: seat, piece: piece, at: st.turnCount }); break;
      case 'jump3': jumpCapture(st, seat, piece, jumpDest(st, seat, piece, ctx.danger ? 5 : 3), out); break;
      case 'extra': st.bonus += ctx.danger ? 2 : 1; break;
      case 'dbl': case 'six': case 'escape': st.lk.powers[seat].push(ev); out.stored = ev; break;
      case 'bomb': bombTargets(st, seat, piece, ctx.danger ? 3 : 2).forEach(function (x) { slideBack(st, x, 3, out); }); break;
      case 'swapc':
        if (arg) {
          t = luckyTarget(st, 'swapc', seat, piece); if (!t) break;
          var mine = absOf(seat, p), tp = st.pieces[t.seat][t.piece], np = posFromAbs(seat, t.abs), tn = posFromAbs(t.seat, mine);
          st.pieces[seat][piece] = np; st.pieces[t.seat][t.piece] = tn;
          out.target = { seat: t.seat, piece: t.piece };
          out.moves.push({ seat: seat, piece: piece, from: p, to: np, swap: true }, { seat: t.seat, piece: t.piece, from: tp, to: tn, swap: true });
        }
        break;
      case 'zapc':
        t = luckyTarget(st, 'zapc', seat, piece); if (!t) break;
        out.target = { seat: t.seat, piece: t.piece };
        var zp = st.pieces[t.seat][t.piece];
        if (zp >= ZAP_CAP) slideBack(st, t, 6, out); // near-home cap: never all the way to base
        else { sendHome(st, seat, t); out.sent.push({ seat: t.seat, piece: t.piece, from: zp }); }
        break;
      case 'freeze':
        t = luckyTarget(st, 'freeze', seat, piece); if (!t) break;
        out.target = { seat: t.seat, piece: t.piece };
        st.effects.push({ type: 'freeze', seat: t.seat, piece: t.piece, at: st.turnCount }); break;
      case 'back3': slideBack(st, { seat: seat, piece: piece }, ctx.danger ? 5 : 3, out); break;
      case 'wild': out.amount = arg || 0; if (arg) jumpCapture(st, seat, piece, jumpDest(st, seat, piece, arg), out); break;
    }
    st.last = { type: 'lucky', seat: seat, event: ev };
    return out;
  }
  /** Resolve the pending choice without continuing the turn (used by choose() and by the AI look-ahead). */
  function applyChoice(st, idx) {
    var pd = st.pending; st.pending = null; st.phase = 'move';
    if (pd.type === 'revenge') return resolveLucky(st, pd.ctx, pd.options[idx] || pd.options[0], pd.fo);
    if (pd.type === 'swap') return applyLucky(st, pd.ctx, 'swapc', idx === 0);
    return applyLucky(st, pd.ctx, 'wild', idx === 0 ? pd.n : 0);
  }
  /** Player's decision for the pending Lucky choice (option index). */
  function choose(st, idx) {
    if (st.phase !== 'choose' || !st.pending) throw new Error('nothing to choose');
    var seat = st.pending.seat, r = applyChoice(st, idx);
    if (st.pending) { st.phase = 'choose'; return { event: r, next: 'choose', finishedPlayer: false, over: false }; }
    var t = continueTurn(st, seat);
    return { event: r, next: t.next, finishedPlayer: t.finishedPlayer, over: st.phase === 'over' };
  }
  /** Position score used by the AI and as the auto-pick when a decision window times out. */
  function scoreState(st, seat) {
    var me = progressOf(st, seat) * 2, riv = 0, n = 0;
    st.players.forEach(function (o) { if (o !== seat && st.ranking.indexOf(o) < 0) { riv += progressOf(st, o); n++; } });
    var sc = me - (n ? riv / n : 0) * 1.2;
    for (var i = 0; i < nPieces(st); i++) {
      var p = st.pieces[seat][i];
      if (p >= 0 && p <= LAST_TRACK && !immune(st, seat, i)) sc -= threatsTo(st, seat, absOf(seat, p)) * (6 + p * 0.35);
    }
    if (st.turn === seat) sc += st.bonus * 7;
    if (st.lk) sc += st.lk.powers[seat].length * 6 + st.lk.charge[seat] * 1.5;
    if (st.boost[seat] === 'double') sc += 5;
    return sc;
  }
  /** Best option for the pending choice (AI decision and the default when the decision window runs out). */
  function defaultChoice(st) {
    var pd = st.pending; if (!pd) return 0;
    var best = 0, bs = -Infinity;
    for (var i = 0; i < pd.options.length; i++) {
      var c = clone(st); applyChoice(c, i);
      var sc = c.pending ? Math.max.apply(null, c.pending.options.map(function (_, j) { var d = clone(c); applyChoice(d, j); return scoreState(d, pd.seat); })) : scoreState(c, pd.seat);
      if (sc > bs + 1e-9) { bs = sc; best = i; }
    }
    return best;
  }
  function aiChoose(st, level) { return level === 'easy' ? Math.floor(rngNext(st) * st.pending.options.length) : defaultChoice(st); }

  // ---- stored powers (max 2, no duplicates; one power per roll) ----
  function powerValid(st, seat, id) {
    if (!isLucky(st) || st.phase !== 'roll' || st.turn !== seat || st.lk.used || st.lk.powers[seat].indexOf(id) < 0) return false;
    if (id === 'dbl') return !st.boost[seat] && !st.lk.forceSix;
    if (id === 'six') return !st.boost[seat] && !st.lk.forceSix;
    if (id === 'escape') return !!escapeTarget(st, seat);
    return false;
  }
  function usePower(st, id) {
    var seat = st.turn;
    if (!powerValid(st, seat, id)) throw new Error('power not usable');
    st.lk.powers[seat].splice(st.lk.powers[seat].indexOf(id), 1);
    st.lk.used = id;
    var out = { power: id, seat: seat, moves: [], sent: [], captures: [], finish: false, crowned: null };
    if (id === 'dbl') st.boost[seat] = 'double';
    else if (id === 'six') st.lk.forceSix = true;
    else {
      var e = escapeTarget(st, seat), from = st.pieces[seat][e.piece];
      out.piece = e.piece;
      jumpCapture(st, seat, e.piece, pathOf(from, e.to - from, true), out);
    }
    return out;
  }

  // ---- Mega Wheel (5/5 charge, activated manually before a roll) ----
  function rocketPick(st, seat) {
    var best = null, bs = -Infinity;
    for (var i = 0; i < nPieces(st); i++) {
      var p = st.pieces[seat][i]; if (p < 0 || p === HOME || isFrozen(st, seat, i)) continue;
      var path = jumpDest(st, seat, i, 8); if (!path.length) continue;
      var to = path[path.length - 1];
      var m = { seat: seat, piece: i, v: path.length, from: p, to: to, path: path, captures: onTrack(to) ? capturesAt(st, seat, absOf(seat, to)) : [], leave: false, finish: to === HOME, entersHomeColumn: p <= CIRCLE && to >= COL0 && to < HOME, tile: null };
      var sc = evalHard(st, m);
      if (sc > bs) { bs = sc; best = { piece: i, path: path }; }
    }
    return best;
  }
  function stormTargets(st, seat) {
    var mine = [], out = [];
    for (var i = 0; i < nPieces(st); i++) { var p = st.pieces[seat][i]; if (onMainTrack(p)) mine.push(absOf(seat, p)); }
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat) continue;
      for (var j = 0; j < nPieces(st); j++) {
        var q = st.pieces[o][j]; if (!onMainTrack(q) || q === 0) continue;
        var b = absOf(o, q);
        if (safeHere(st, b) || immune(st, o, j)) continue;
        if (mine.some(function (a) { var d = (a - b + TRACK) % TRACK; return d >= 1 && d <= 6; })) out.push({ seat: o, piece: j });
      }
    }
    return out;
  }
  function crownPick(st, seat) {
    var best = -1, bp = -1;
    for (var i = 0; i < nPieces(st); i++) { var p = st.pieces[seat][i]; if (onMainTrack(p) && !isKing(st, seat, i) && advance(p) > bp) { bp = advance(p); best = i; } }
    return best;
  }
  function megaValid(st, seat, ev) {
    switch (ev) {
      case 'rocket': return !!rocketPick(st, seat);
      case 'free': return st.pieces[seat].some(function (p) { return p < 0; }) && !opponentBlockAt(st, seat, absOf(seat, 0));
      case 'guard': return st.pieces[seat].some(function (p, i) { return onMainTrack(p) && !isShielded(st, seat, i); });
      case 'turn2': return true;
      case 'storm': return stormTargets(st, seat).length > 0;
      case 'crown': return crownPick(st, seat) >= 0;
    }
    return false;
  }
  function mega(st, forced) {
    var seat = st.turn;
    if (!canMega(st, seat)) throw new Error('Mega Wheel not ready');
    var list = LWHEELS.mega.filter(function (e) { return megaValid(st, seat, e); });
    var ev = forced && list.indexOf(forced) >= 0 ? forced : list[Math.floor(rngNext(st) * list.length)];
    st.lk.charge[seat] = 0; st.stats[seat].events++;
    var out = { mega: true, kind: 'mega', seat: seat, piece: null, wheel: LWHEELS.mega, index: LWHEELS.mega.indexOf(ev), event: ev,
      moves: [], sent: [], captures: [], finish: false, crowned: null, target: null, lucky: true, finishedPlayer: false, over: false };
    var i;
    switch (ev) {
      case 'rocket': var r = rocketPick(st, seat); out.piece = r.piece; jumpCapture(st, seat, r.piece, r.path, out); break;
      case 'free':
        for (i = 0; i < nPieces(st); i++) if (st.pieces[seat][i] < 0) break;
        out.piece = i; jumpCapture(st, seat, i, [0], out); break;
      case 'guard': st.pieces[seat].forEach(function (p, k) { if (onMainTrack(p) && !isShielded(st, seat, k)) { st.effects.push({ type: 'shield', seat: seat, piece: k, at: st.turnCount }); out.moves.push({ seat: seat, piece: k, from: p, to: p, shield: true }); } }); break;
      case 'turn2': st.bonus += 2; break;
      case 'storm': stormTargets(st, seat).forEach(function (x) { slideBack(st, x, 3, out); }); break;
      case 'crown': i = crownPick(st, seat); out.piece = i; crown(st, seat, i); out.crowned = { seat: seat, piece: i }; break;
    }
    if (st.pieces[seat].every(function (p) { return p === HOME; })) { st.ranking.push(seat); out.finishedPlayer = true; nextTurn(st); }
    out.over = st.phase === 'over';
    st.last = { type: 'mega', seat: seat, event: ev };
    return out;
  }
  /** AI: use the Mega Wheel / a stored power before rolling? Returns { type: 'mega' } | { type: 'power', id } | null. */
  function aiPreRoll(st, level) {
    if (!isLucky(st) || st.phase !== 'roll') return null;
    var seat = st.turn;
    if (canMega(st, seat) && (level !== 'easy' || rngNext(st) < 0.5)) return { type: 'mega' };
    var pw = st.lk.powers[seat].filter(function (id) { return powerValid(st, seat, id); });
    if (!pw.length) return null;
    if (level === 'easy') return rngNext(st) < 0.25 ? { type: 'power', id: pw[Math.floor(rngNext(st) * pw.length)] } : null;
    var pcs = st.pieces[seat], inBase = pcs.filter(function (p) { return p < 0; }).length;
    var onBoard = pcs.filter(function (p) { return p >= 0 && p < HOME; }).length;
    var maxTrack = Math.max.apply(null, pcs.map(function (p) { return onMainTrack(p) ? p : -1; }));
    if (pw.indexOf('escape') >= 0) { var e = escapeTarget(st, seat); if (e && e.threat >= (level === 'hard' ? 1 : 1.5)) return { type: 'power', id: 'escape' }; }
    if (pw.indexOf('six') >= 0 && inBase > 0 && st.sixes === 0 && (onBoard === 0 || (level === 'hard' && inBase >= 2))) return { type: 'power', id: 'six' };
    if (pw.indexOf('dbl') >= 0 && onBoard > 0 && maxTrack >= 0 && maxTrack <= 38 && (level === 'hard' || onBoard >= 2)) return { type: 'power', id: 'dbl' };
    return null;
  }

  // ---------- AI ----------
  /** How dangerous is track square abs for `seat` (weighted count of rival tokens that could land there next)? */
  function threatsTo(st, seat, abs) {
    if (st.rules.safeSquares && isSafeAbs(abs)) return 0;
    var n = 0, star = st.rules.rollStyle === 'star';
    for (var o = 0; o < 4; o++) {
      if (!st.pieces[o] || o === seat || st.ranking.indexOf(o) >= 0) continue;
      for (var i = 0; i < nPieces(st); i++) {
        var p = st.pieces[o][i];
        if (isFrozen(st, o, i)) continue;
        if (p >= 0 && p <= LAST_TRACK) {
          var d = (abs - absOf(o, p) + TRACK) % TRACK;
          if (p + d > LAST_TRACK && canEnter(st, o)) continue;
          if (d >= 1 && d <= 6) n += 1; else if (star && d >= 7 && d <= 12) n += 0.25;
        } else if (p < 0 && abs === absOf(o, 0)) n += 0.4; // could come out with a 6
      }
    }
    return n;
  }
  function tileValue(st, m, level) {
    if (!m.tile) return 0;
    if (st.mode === 'lucky') {
      var hv = { boost: 16, chaos: 9, danger: 10 }, mv = { boost: 12, chaos: 7, danger: 8 };
      return (level === 'hard' ? hv : mv)[m.tile] + (st.lk.revenge[m.seat] ? 4 : 0);
    }
    if (m.tile === 'boost') return level === 'hard' ? 26 : 16;
    return level === 'hard' ? 9 - m.to * 0.15 : 3; // chaos: small upside, risky for advanced tokens
  }
  function evalHard(st, m) {
    var seat = m.seat, sc = 0, star = st.rules.rollStyle === 'star';
    if (m.finish) sc += 120;
    m.captures.forEach(function (c) { sc += 95 + advance(st.pieces[c.seat][c.piece]) * 1.2 + (isKing(st, c.seat, c.piece) ? 45 : 0); });
    if (st.lk && m.captures.length && !isKing(st, seat, m.piece) && st.lk.kills[seat][m.piece] + m.captures.length >= KING_KILLS) sc += 20; // becomes King
    if (m.captures.length && st.rules.captureToEnter && !st.capd[seat]) sc += 40;
    if (m.leave) sc += 55 + 5 * st.pieces[seat].filter(function (p) { return p < 0; }).length;
    if (m.entersHomeColumn) sc += 45;
    var shielded = isShielded(st, seat, m.piece);
    var fromThreat = onTrack(m.from) && !shielded && !inBlock(st, seat, m.piece) ? threatsTo(st, seat, absOf(seat, m.from)) : 0;
    if (onTrack(m.to)) {
      var a = absOf(seat, m.to);
      if (st.rules.safeSquares && isSafeAbs(a)) sc += 30;
      // danger check on the board after the move (captured tokens are gone)
      var saved = m.captures.map(function (c) { var v = st.pieces[c.seat][c.piece]; st.pieces[c.seat][c.piece] = -1; return v; });
      var old = st.pieces[seat][m.piece]; st.pieces[seat][m.piece] = m.to;
      var formsBlock = st.rules.blocks && countOwnAt(st, seat, a) >= 2;
      var t = shielded || formsBlock ? 0 : threatsTo(st, seat, a);
      // chase value: rival tokens 1..6 ahead that we could hit next roll
      var chase = 0;
      for (var o = 0; o < 4; o++) { if (!st.pieces[o] || o === seat) continue; for (var i = 0; i < nPieces(st); i++) { var p = st.pieces[o][i]; if (!onTrack(p)) continue; var d = (absOf(o, p) - a + TRACK) % TRACK; if (d >= 1 && d <= 6 && !(st.rules.safeSquares && isSafeAbs(absOf(o, p))) && m.to + d <= LAST_TRACK) chase++; } }
      st.pieces[seat][m.piece] = old;
      m.captures.forEach(function (c, k) { st.pieces[c.seat][c.piece] = saved[k]; });
      if (t > 0) sc -= (40 + m.to * 0.9) * Math.min(t, 2.5);
      if (formsBlock && !isSafeAbs(a)) {
        sc += 18;
        // the partner token already there was exposed: the block now protects it too
        var pt = threatsTo(st, seat, a); if (pt > 0) sc += (25 + m.to * 0.7) * Math.min(pt, 2);
      }
      sc += Math.min(chase, 2) * 6;
      if (m.to === CIRCLE) sc -= 30;
    }
    if (fromThreat > 0 && m.from >= 0) sc += (25 + m.from * 0.7) * Math.min(fromThreat, 2); // escape danger
    if (onTrack(m.from) && st.rules.safeSquares && isSafeAbs(absOf(seat, m.from)) && onTrack(m.to) && !m.captures.length) sc -= 8; // leaving shelter
    if (inBlock(st, seat, m.piece) && !m.captures.length) sc -= 10; // breaking a block
    sc += tileValue(st, m, 'hard');
    // star style: keep a 6 for leaving base if that is still useful later in the queue
    if (star && m.v === 6 && !m.leave && st.pieces[seat].some(function (p) { return p < 0; }) && st.queue.filter(function (x) { return x === 6; }).length === 1) sc -= 25;
    sc += (advance(m.to) - advance(m.from)) * 0.4 + advance(m.from) * 0.05;
    return sc;
  }
  function evalMedium(st, m) {
    var sc = 0;
    if (m.captures.length) sc += 60 + (m.captures.some(function (c) { return isKing(st, c.seat, c.piece); }) ? 25 : 0);
    if (m.finish) sc += 50;
    if (m.leave) sc += 40;
    if (m.entersHomeColumn) sc += 25;
    if (onTrack(m.to) && st.rules.safeSquares && isSafeAbs(absOf(m.seat, m.to))) sc += 10;
    sc += tileValue(st, m, 'medium');
    sc += (advance(m.to) - advance(m.from)) * 0.5;
    return sc;
  }
  function scoreMove(st, m, level) { return level === 'hard' ? evalHard(st, m) : evalMedium(st, m); }
  /** Pick a move { piece, v } for the current AI player. Optional `pool` limits the candidate moves. */
  function chooseMove(st, level, rnd, pool) {
    var moves = pool || st.moves;
    if (!moves.length) return null;
    var r = rnd || function () { return rngNext(st); };
    if (moves.length === 1) return { piece: moves[0].piece, v: moves[0].v };
    var pick;
    if (level === 'easy') {
      var obvious = moves.filter(function (m) { return m.captures.length || m.finish; });
      pick = obvious.length && r() < 0.5 ? obvious[Math.floor(r() * obvious.length)] : moves[Math.floor(r() * moves.length)];
      return { piece: pick.piece, v: pick.v };
    }
    var best = null, bs = -Infinity;
    moves.forEach(function (m) { var v = scoreMove(st, m, level) + r() * (level === 'hard' ? 0.01 : 6); if (v > bs) { bs = v; best = m; } });
    return { piece: best.piece, v: best.v };
  }
  /**
   * Offline human decision timeout — prefer kill (any die), else open from yard with a 6,
   * else the hard AI heuristic. Used by the 4-second move countdown auto-play.
   */
  function bestAutoMove(st, level, rnd) {
    var moves = st.moves;
    if (!moves || !moves.length) return null;
    var lv = level || 'hard';
    var kills = moves.filter(function (m) { return m.captures && m.captures.length; });
    if (kills.length) return chooseMove(st, lv, rnd, kills);
    var leaves = moves.filter(function (m) { return m.leave && m.v === 6; });
    if (leaves.length) return chooseMove(st, lv, rnd, leaves);
    return chooseMove(st, lv, rnd);
  }
  /** Pick-a-number event: which value (1..6) should the AI take? */
  function chooseDieValue(st, seat, level) {
    if (level === 'easy') return 6;
    var bestV = 6, bs = -Infinity;
    for (var v = 1; v <= 6; v++) {
      var ms = legalMoves(st, seat, v), sc = ms.length ? -Infinity : -200;
      ms.forEach(function (m) { sc = Math.max(sc, scoreMove(st, m, level === 'hard' ? 'hard' : 'medium')); });
      if (v === 6 && st.sixes < 2) sc += 22; // a 6 also rolls again
      if (sc > bs) { bs = sc; bestV = v; }
    }
    return bestV;
  }

  /** Moves whose outcome is identical (same token path) collapse to one choice, e.g. for auto-move. */
  function distinctMoves(moves) {
    var seen = {}, out = [];
    moves.forEach(function (m) { var k = m.from + '>' + m.to + '>' + m.v; if (!seen[k]) { seen[k] = 1; out.push(m); } });
    // same value on two tokens at the same square is the same outcome
    return out.filter(function (m, i) { return !out.some(function (o, j) { return j < i && o.from === m.from && o.to === m.to; }); });
  }

  /** Coins for the best-placed human (cosmetic currency only). */
  function coinsFor(place, nPlayers, aiLevels, mode) {
    var base = [0, 40, 20, 12, 6][place] || 0;
    if (nPlayers === 2 && place === 2) base = 10;
    var bonus = (aiLevels || []).indexOf('hard') >= 0 ? 10 : (aiLevels || []).indexOf('medium') >= 0 ? 5 : 0;
    return base + (place === 1 ? bonus : 0) + ((mode === 'mystery' || mode === 'lucky') && place === 1 ? 5 : 0);
  }
  /** Experience points (cosmetic level on the home screen). */
  function xpFor(place, nPlayers) { return place === 1 ? 40 + 10 * nPlayers : Math.max(10, 30 - place * 5); }
  function levelFromXp(xp) { var lv = 1, need = 100, x = xp; while (x >= need) { x -= need; lv++; need = 100 + (lv - 1) * 25; } return { level: lv, into: x, need: need }; }

  /** Plays a whole game with AI for every seat (used by the tests). */
  /** One AI action for the current player (roll, pre-roll power / Mega, choice or move). */
  function aiStep(st) {
    var lv = st.seats[st.turn].level;
    if (st.phase === 'roll') {
      var a = aiPreRoll(st, lv);
      if (a) return a.type === 'mega' ? { mega: mega(st) } : { power: usePower(st, a.id) };
      return { roll: roll(st, mustChoose(st) ? chooseDieValue(st, st.turn, lv) : undefined) };
    }
    if (st.phase === 'choose') return { choice: choose(st, aiChoose(st, lv)) };
    var c = chooseMove(st, lv); return { move: move(st, c.piece, c.v) };
  }
  function simulate(seats, rules, seed, maxRolls, mode) {
    var st = newGame(seats, rules, seed, mode), cap = maxRolls || 30000, guard = 0;
    while (st.phase !== 'over' && st.rolls < cap && guard++ < cap * 6) aiStep(st);
    return st;
  }

  function clone(st) { return JSON.parse(JSON.stringify(st)); }

  return {
    TRACK: TRACK, LAST_TRACK: LAST_TRACK, CIRCLE: CIRCLE, COL0: COL0, HOME: HOME, PIECES: PIECES, START_SQUARES: START_SQUARES, STAR_SQUARES: STAR_SQUARES, ARROW_SQUARES: ARROW_SQUARES, ARROW_JUMP: ARROW_JUMP, ARROW_DANGER: ARROW_DANGER, ARROW_DANGER_SQUARES: ARROW_DANGER_SQUARES,
    DEFAULT_RULES: DEFAULT_RULES, LEVELS: LEVELS, MODES: MODES, BOOST_TILES: BOOST_TILES, CHAOS_TILES: CHAOS_TILES, WHEELS: WHEELS, EVENT_INFO: EVENT_INFO,
    TRACK_CELLS: TRACK_CELLS, HOME_COLS: HOME_COLS, BASE_SPOTS: BASE_SPOTS, HOME_SPOTS: HOME_SPOTS, rot: rot,
    cellOf: cellOf, absOf: absOf, posFromAbs: posFromAbs, onTrack: onTrack, isSafeAbs: isSafeAbs, advance: advance, rngNext: rngNext, rollDie: rollDie,
    normRules: normRules, newGame: newGame, nPieces: nPieces, teamOf: teamOf, partnerOf: partnerOf, arrowsOn: arrowsOn, legalMoves: legalMoves, queueMoves: queueMoves, moveFor: moveFor, pathOf: pathOf, roll: roll, move: move, mustChoose: mustChoose,
    nextTurn: nextTurn, activeLeft: activeLeft, progressOf: progressOf, canEnter: canEnter, isShielded: isShielded, isFrozen: isFrozen, opponentBlockAt: opponentBlockAt,
    PERK_DEFS: PERK_DEFS, perkOf: perkOf, setPerkSkin: setPerkSkin, isVineShielded: isVineShielded, coinMultiplier: coinMultiplier, perkStepActive: perkStepActive,
    perkStepValue: perkStepValue, perkBonusTotal: perkBonusTotal, isSafeSquare: isSafeSquare, nearestStarAbs: nearestStarAbs, DIVIDER_SQUARES: DIVIDER_SQUARES,
    tileAt: tileAt, applyEvent: applyEvent, eventValid: eventValid, eventTarget: eventTarget,
    threatsTo: threatsTo, evalHard: evalHard, chooseMove: chooseMove, bestAutoMove: bestAutoMove, chooseDieValue: chooseDieValue, distinctMoves: distinctMoves,
    coinsFor: coinsFor, xpFor: xpFor, levelFromXp: levelFromXp, simulate: simulate, clone: clone, aiStep: aiStep, continueTurn: continueTurn,
    // Lucky Chaos Ludo
    LUCKY_BOOST: LUCKY_BOOST, LUCKY_CHAOS: LUCKY_CHAOS, DANGER_TILES: DANGER_TILES, LWHEELS: LWHEELS, POWERS: POWERS, MAX_CHARGE: MAX_CHARGE, MAX_POWERS: MAX_POWERS,
    KING_TURNS: KING_TURNS, KING_KILLS: KING_KILLS, ZAP_CAP: ZAP_CAP, MAX_STREAK: MAX_STREAK, eventLabel: eventLabel, isKing: isKing, kingOf: kingOf, immune: immune,
    comebackLevel: comebackLevel, nudgeChance: nudgeChance, luckyActivate: luckyActivate, applyLucky: applyLucky, eventValidL: eventValidL, spinLucky: spinLucky, luckyTarget: luckyTarget,
    bombTargets: bombTargets, escapeTarget: escapeTarget, choose: choose, defaultChoice: defaultChoice, aiChoose: aiChoose, scoreState: scoreState,
    powerValid: powerValid, usePower: usePower, canMega: canMega, mega: mega, megaValid: megaValid, stormTargets: stormTargets, aiPreRoll: aiPreRoll, canStore: canStore, checkKing: checkKing
  };
});
