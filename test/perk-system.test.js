// Sovereign pawn perk system (Phase L1): Demetrius star rally + vine reflect, George capture sprint + coin double.
// Run: node test/perk-system.test.js
'use strict';
const assert = require('assert');
const L = require('../www/js/logic.js');
const TS = require('../www/js/token-skins.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', String(e.stack || e).split('\n').slice(0, 3).join('\n    ')); } }
const H = { type: 'human' }, AI = (level) => ({ type: 'ai', level });
// Seats 0 (human) and 2 (AI): seat 0 abs == rel pos; seat 2 abs == (rel + 26) % 52.
const two = (perks) => L.newGame([H, null, AI('hard'), null], {}, 42, 'classic', perks);
function setup(st, pieces) { pieces.forEach((p, s) => { if (p && st.pieces[s]) st.pieces[s] = p.slice(); }); return st; }
// Drive one move without going through rolls: set the turn, offer exactly value v, move the piece.
function forceMove(st, seat, piece, v) {
  st.turn = seat; st.phase = 'move'; st.queue = [v]; st.moves = L.queueMoves(st);
  const m = st.moves.find(x => x.piece === piece && x.v === v);
  assert.ok(m, 'expected a legal move for piece ' + piece + ' with ' + v);
  return L.move(st, piece, v);
}

console.log('perk-system.test.js');
// ---------- registry ----------
t('perk registry: Demetrius (star) and George (capture) defined; Classic has no perk', () => {
  assert.ok(L.PERK_DEFS.demetrius && L.PERK_DEFS.george);
  assert.deepStrictEqual(L.PERK_DEFS.demetrius.onStar, ['allyStep1', 'vineAdjacent']);
  assert.deepStrictEqual(L.PERK_DEFS.george.onCapture, ['sprint2', 'coinDouble']);
  const st = two();
  assert.strictEqual(L.perkOf(st, 0), null);
  assert.strictEqual(L.coinMultiplier(st, 0), 1);
  L.setPerkSkin(st, 0, 'nope');
  assert.strictEqual(L.perkOf(st, 0), null, 'unknown perk ids never activate');
});

// ---------- Demetrius: star landing ----------
t('Demetrius star landing: allies gain +1 step, adjacent ally gets a vine shield', () => {
  const st = setup(two(['demetrius', null, null, null]), [[7, 9, 20, -1]]);
  const res = forceMove(st, 0, 0, 1); // 7 -> 8, absolute star square 8
  assert.strictEqual(st.pieces[0][0], 8);
  assert.ok(res.perk && res.perk.id === 'demetrius' && res.perk.trigger === 'star', 'perk fired on star landing');
  assert.strictEqual(res.perk.banner, 'VINEYARD SHIELD');
  assert.deepStrictEqual(res.perk.stepBonus, [0, 1, 2], 'every on-track ally gains +1 (base pawn excluded)');
  assert.deepStrictEqual(res.perk.vineShield, [1], 'only the adjacent ally (abs 9, distance 1) is vine-shielded');
  assert.ok(L.isVineShielded(st, 0, 1));
  assert.ok(!L.isVineShielded(st, 0, 2), 'far ally is not shielded');
  assert.ok(L.perkStepActive(st, 0, 0) && L.perkStepActive(st, 0, 1) && L.perkStepActive(st, 0, 2));
});
t('Demetrius step bonus: the next move of a bonused pawn goes one square further, then the flag is spent', () => {
  const st = setup(two(['demetrius', null, null, null]), [[7, 9, 20, -1]]);
  forceMove(st, 0, 0, 1); // star landing grants the bonus
  const res = forceMove(st, 0, 1, 2); // 9 -> 12 (2 + 1 bonus), not 11
  assert.strictEqual(st.pieces[0][1], 12);
  assert.ok(res.perkStep, 'move reports the bonus was used');
  assert.ok(!L.perkStepActive(st, 0, 1), 'bonus spent after one move');
  assert.ok(L.perkStepActive(st, 0, 0), 'other allies keep their bonus');
});
t('Demetrius vine shield REFLECTS an enemy attack: attacker goes home, vine pawn stays', () => {
  const st = setup(two(['demetrius', null, null, null]), [[9, -1, -1, -1], null, [34, -1, -1, -1]]);
  st.effects.push({ type: 'vine', seat: 0, piece: 0, at: st.turnCount }); // seat 0 pawn on abs 9
  const res = forceMove(st, 2, 0, 1); // seat 2: 34 -> 35, abs 9, onto the vine pawn
  assert.ok(res.perk && res.perk.trigger === 'reflect' && res.perk.banner === 'VINEYARD SHIELD');
  assert.deepStrictEqual(res.captures, [], 'vine pawn is never captured');
  assert.strictEqual(st.pieces[2][0], -1, 'attacker is reflected home');
  assert.strictEqual(st.pieces[0][0], 9, 'vine pawn stays put');
  assert.strictEqual(st.stats[0].captures, 1, 'reflect counts as a capture for the vine owner');
});

// ---------- George: capture ----------
t('George capture: all friendly track pawns sprint +2, match coins double', () => {
  const st = setup(two(['george', null, null, null]), [[10, 5, 50, -1], null, [37, -1, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // 10 -> 11 (abs 11), captures seat 2 pawn (rel 37 == abs 11)
  assert.deepStrictEqual(res.captures, [{ seat: 2, piece: 0 }]);
  assert.strictEqual(st.pieces[2][0], -1);
  assert.ok(res.perk && res.perk.id === 'george' && res.perk.trigger === 'capture');
  assert.strictEqual(res.perk.banner, 'GOLDEN AGE SPRINT');
  assert.ok(res.perk.coinDouble);
  assert.strictEqual(L.coinMultiplier(st, 0), 2, 'double coins from this seat\'s moves');
  assert.deepStrictEqual(res.perk.sprint, [
    { piece: 0, from: 11, to: 13 },
    { piece: 1, from: 5, to: 7 }
  ], 'capturer and ally sprint +2; pawn at 50 stays (sprint never leaves the track)');
  assert.strictEqual(st.pieces[0][0], 13);
  assert.strictEqual(st.pieces[0][1], 7);
  assert.strictEqual(st.pieces[0][2], 50);
});

// ---------- Classic regression ----------
t('Classic skin: star landing and capture change nothing (base rules unchanged)', () => {
  const star = setup(two(), [[7, 9, 20, -1]]);
  const r1 = forceMove(star, 0, 0, 1);
  assert.strictEqual(r1.perk, null);
  assert.deepStrictEqual(star.effects, []);
  assert.ok(!L.perkStepActive(star, 0, 1));
  const cap = setup(two(), [[10, 5, 50, -1], null, [37, -1, -1, -1]]);
  const r2 = forceMove(cap, 0, 0, 1);
  assert.strictEqual(r2.perk, null);
  assert.deepStrictEqual([cap.pieces[0][0], cap.pieces[0][1], cap.pieces[0][2]], [11, 5, 50], 'no sprint without a perk');
  assert.strictEqual(L.coinMultiplier(cap, 0), 1);
});

// ---------- save round-trip + legacy states ----------
t('perk state survives a JSON save round-trip (save-store clones the whole state)', () => {
  const st = setup(two(['george', null, null, null]), [[10, 5, 50, -1], null, [37, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // George capture: sprint + coin flag
  const c = L.clone(st);
  assert.deepStrictEqual(c, st);
  assert.strictEqual(L.coinMultiplier(c, 0), 2);
  assert.strictEqual(c.pieces[0][0], 13);
  const d = setup(two(['demetrius', null, null, null]), [[7, 9, 20, -1]]);
  forceMove(d, 0, 0, 1); // star: step flags + vine effect
  const e = L.clone(d);
  assert.ok(L.isVineShielded(e, 0, 1) && L.perkStepActive(e, 0, 1));
});
t('legacy states without perk fields keep working (backward-compatible defaults)', () => {
  const st = setup(two(['demetrius', null, null, null]), [[7, 9, 20, -1]]);
  const old = L.clone(st);
  delete old.perkSkin; delete old.perkStep; delete old.perkCoin;
  const res = forceMove(old, 0, 0, 1);
  assert.strictEqual(res.perk, null, 'no perk fields means classic rules');
  assert.strictEqual(old.pieces[0][0], 8);
});

// ---------- skin catalog ----------
t('king skins in the catalog: tiers, coin prices, perk links, seat colour readable', () => {
  const d = TS.byId('demetrius'), g = TS.byId('george');
  assert.ok(d && g);
  assert.strictEqual(d.rarity, 'epic'); assert.strictEqual(d.coins, 900); assert.strictEqual(d.perk, 'demetrius');
  assert.strictEqual(g.rarity, 'legendary'); assert.strictEqual(g.coins, 1500); assert.strictEqual(g.perk, 'george');
  assert.strictEqual(TS.byId('classic').perk, undefined, 'Classic has no perk');
  const md = TS.material('demetrius', '#e33', null), mg = TS.material('george', '#e33', null);
  assert.strictEqual(md.band, '#e33'); assert.strictEqual(mg.band, '#e33', 'seat colour stays on the base band');
  assert.ok(md.gem === '#3fae5a' && mg.gem === '#ffd34d');
});
t('king skins unlock with earned coins only (no cash value, no purchase)', () => {
  const save = { coins: 1000, stats: { won: 0, captures: 0 } }; TS.applyNormalize(save);
  const persist = () => true;
  const r = TS.unlock(save, 'demetrius', persist);
  assert.ok(r.ok && r.spent === 900 && save.coins === 100 && save.tokenSkin === 'demetrius');
  assert.strictEqual(TS.unlock(save, 'george', persist).reason, 'locked', '1500 needed, only 100 left');
  const fresh = { coins: 0, stats: { won: 0, captures: 0 } };
  assert.ok(TS.normalize(fresh).stats.demetrius && TS.normalize(fresh).stats.george, 'new skins tracked in per-skin stats');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
