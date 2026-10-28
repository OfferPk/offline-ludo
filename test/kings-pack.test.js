// Sovereign Kings + Heroes pawn pack (Phase L2): 37 Georgian monarchs + Scipio, Sitting Bull, Zenobia.
// Run: node test/kings-pack.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const L = require('../www/js/logic.js');
const TS = require('../www/js/token-skins.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', String(e.stack || e).split('\n').slice(0, 3).join('\n    ')); } }
const H = { type: 'human' }, AI = (level) => ({ type: 'ai', level });
// Seats 0 (human) and 2 (AI): seat 0 abs == rel pos; seat 2 abs == (rel + 26) % 52.
const two = (perks) => L.newGame([H, null, AI('hard'), null], {}, 42, 'classic', perks);
const twoB = (perks) => L.newGame([H, null, AI('hard'), null], { blocks: true }, 42, 'classic', perks);
function setup(st, pieces) { pieces.forEach((p, s) => { if (p && st.pieces[s]) st.pieces[s] = p.slice(); }); return st; }
// Drive one move without going through rolls: set the turn, offer exactly value v, move the piece.
function forceMove(st, seat, piece, v) {
  st.turn = seat; st.phase = 'move'; st.queue = [v]; st.moves = L.queueMoves(st);
  const m = st.moves.find(x => x.piece === piece && x.v === v);
  assert.ok(m, 'expected a legal move for piece ' + piece + ' with ' + v);
  return L.move(st, piece, v);
}
function hasGrant(res, trigger, effect) {
  return (res.perks || []).some(p => p.trigger === trigger && p.grants.some(g => g.e === effect));
}

console.log('kings-pack.test.js');
// ---------- catalog ----------
const NEW = ['george-v', 'george-xii', 'heraclius-ii', 'jesse', 'solomon-i', 'vakhtang-vi', 'erekle-i',
  'archil', 'teimuraz-i', 'george-xi', 'rostom', 'giorgi-vii', 'luarsab-i', 'levan', 'constantine-ii',
  'george-ii-kakheti', 'alexander-i-kakheti', 'alexander-ii-imereti', 'george-iv', 'rusudan', 'demetre-ii',
  'bagrat-iii', 'giorgi-vi', 'david-iv', 'tamar', 'alexander-i-georgia', 'vakhtang-v', 'simon-i',
  'george-viii', 'constantine-i', 'david-vi', 'bagrat-iv', 'archil-ii', 'george-ii-georgia', 'george-i',
  'david-viii', 'bagrat-vi', 'scipio', 'sitting-bull', 'zenobia'];
const LEGENDARY = ['george-xii', 'heraclius-ii', 'vakhtang-vi', 'solomon-i', 'george-xi', 'scipio', 'zenobia',
  'sitting-bull', 'george-iv', 'rusudan', 'bagrat-iii', 'teimuraz-i'];
t('catalog: all 40 L2 pawns registered, skinned, priced, milestone-unlocked, seat band kept', () => {
  assert.strictEqual(NEW.length, 40, '37 Georgian monarchs + 3 heroes');
  NEW.forEach(id => {
    assert.ok(L.PERK_DEFS[id], 'def ' + id);
    const s = TS.byId(id);
    assert.ok(s, 'skin ' + id);
    assert.strictEqual(s.perk, id, 'skin points at its own perk');
    assert.ok(s.coins > 0 && (s.wins > 0 || s.kills > 0), 'coin price + free milestone, no cash value');
    assert.strictEqual(TS.material(id, '#e85a48').band, '#e85a48', 'seat band kept for ' + id);
  });
  assert.strictEqual(TS.SKINS.length, 52, '10 original + Demetrius + George III + 40 new');
  ['tamar', 'david-iv', 'george-v'].forEach(id => assert.strictEqual(TS.byId(id).rarity, 'mythic', id + ' mythic'));
  LEGENDARY.forEach(id => { assert.strictEqual(TS.byId(id).rarity, 'legendary', id + ' legendary'); assert.strictEqual(TS.byId(id).coins, 1500); });
  NEW.filter(id => ['tamar', 'david-iv', 'george-v'].indexOf(id) < 0 && LEGENDARY.indexOf(id) < 0)
    .forEach(id => { assert.strictEqual(TS.byId(id).rarity, 'epic', id + ' epic'); assert.strictEqual(TS.byId(id).coins, 900); });
  const game = fs.readFileSync('www/js/game.js', 'utf8');
  assert.ok(/sk0 && sk0\.perk/.test(game), 'perk skins without an explicit case share the crown + laurel mark');
  assert.ok(/case 'demetrius'/.test(game) && /case 'george'/.test(game), 'L1 kings keep their own art cases');
});

// ---------- George V: star leap + roll floor ----------
t('George V star: all allies leap +2 now, and rolls below 3 count as 3 for two rounds', () => {
  const st = setup(two(['george-v', null, null, null]), [[7, 20, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // 7 -> 8 (star)
  assert.ok(res.perk && res.perk.id === 'george-v' && res.perk.trigger === 'star');
  assert.strictEqual(res.perk.banner, 'BRILLIANT RESTORER');
  assert.ok(hasGrant(res, 'star', 'allyLeap2'), 'leap grant present');
  assert.strictEqual(st.pieces[0][1], 22, 'ally leaps 20 -> 22 immediately');
  assert.strictEqual(st.pieces[0][0], 10, 'the mover leaps too (8 -> 10), like the George III sprint');
  st.turn = 0; st.phase = 'roll';
  const r1 = L.roll(st, 1);
  assert.strictEqual(r1.raw, 1); assert.strictEqual(r1.value, 3, 'a 1 counts as 3');
  assert.strictEqual(r1.perkRollFloor, true); assert.strictEqual(st.faces[0], 3, 'the shown face is the floored value');
  st.turn = 0; st.phase = 'roll';
  assert.strictEqual(L.roll(st, 4).value, 4, 'a 4 is untouched by the floor');
});
t('George V floor expires after its window', () => {
  const st = setup(two(['george-v', null, null, null]), [[7, -1, -1, -1]]);
  forceMove(st, 0, 0, 1);
  st.turnCount = 999; st.turn = 0; st.phase = 'roll';
  assert.strictEqual(L.roll(st, 2).value, 2, 'past the window a 2 stays a 2');
});

// ---------- George XII, Heraclius, Jesse ----------
t('George XII star: allies +1 step and match coins double', () => {
  const st = setup(two(['george-xii', null, null, null]), [[7, 20, -1, -1]]);
  const res = forceMove(st, 0, 0, 1);
  assert.strictEqual(res.perk.banner, 'LAST CROWN');
  assert.ok(L.perkStepActive(st, 0, 1), 'ally gains +1 step');
  assert.strictEqual(L.coinMultiplier(st, 0), 2, 'match coins doubled');
});
t('Heraclius II land: allies +1 step, allies within 3 tiles shielded from capture', () => {
  const st = setup(two(['heraclius-ii', null, null, null]), [[10, 12, 20, -1]]);
  const res = forceMove(st, 0, 0, 1); // 10 -> 11 (not a star)
  assert.ok(hasGrant(res, 'onLand', 'allyStep1') && hasGrant(res, 'onLand', 'zoneEndure'));
  assert.ok(L.perkStepActive(st, 0, 1) && L.perkStepActive(st, 0, 2), 'every on-track ally gains +1');
  assert.ok(L.isVineShielded(st, 0, 1) === false && hasEndure(st, 0, 1), 'ally at distance 1 is endure-shielded');
  assert.ok(!hasEndure(st, 0, 2), 'ally at distance 9 is not shielded');
});
function hasEndure(st, seat, piece) { return st.effects.some(e => e.type === 'endure' && e.seat === seat && e.piece === piece); }
t('Jesse star: allies within 2 tiles shielded, farther allies not', () => {
  const st = setup(two(['jesse', null, null, null]), [[7, 9, 12, -1]]);
  forceMove(st, 0, 0, 1); // 7 -> 8 (star)
  assert.ok(hasEndure(st, 0, 1), 'ally at distance 1 shielded');
  assert.ok(!hasEndure(st, 0, 2), 'ally at distance 4 not shielded');
});

// ---------- Solomon, Vakhtang VI ----------
t('Solomon I capture: every base pawn breaks out, captor sprints +2', () => {
  const st = setup(two(['solomon-i', null, null, null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // captures seat 2 pawn on abs 11
  assert.deepStrictEqual(res.captures, [{ seat: 2, piece: 0 }]);
  assert.strictEqual(st.pieces[0][1], 0); assert.strictEqual(st.pieces[0][2], 0); assert.strictEqual(st.pieces[0][3], 0);
  assert.strictEqual(st.pieces[0][0], 13, 'captor sprints 11 -> 13');
  assert.ok(hasGrant(res, 'capture', 'breakout') && hasGrant(res, 'capture', 'selfSprint2'));
});
t('Vakhtang VI land: allies within 2 shielded, and the shield absorbs a strike without knockback', () => {
  const st = setup(two(['vakhtang-vi', null, null, null]), [[10, 12, 20, -1], null, [36, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // 10 -> 11, ally at 12 shielded
  assert.ok(hasEndure(st, 0, 1) && !hasEndure(st, 0, 2));
  const res = forceMove(st, 2, 0, 2); // seat 2: abs 10 -> 12 (via 11), onto the shielded ally
  assert.deepStrictEqual(res.captures, [], 'shielded ally is never captured');
  assert.strictEqual(st.pieces[0][1], 12, 'shielded ally stays');
  assert.strictEqual(st.pieces[2][0], 38, 'attacker lands and stays (knock 0)');
  assert.ok(!hasEndure(st, 0, 1), 'the shield is consumed by the blocked strike');
});

// ---------- Erekle, Archil, Teimuraz, George XI, Rostom ----------
t('Erekle I: rolling 5+ propels a nearby ally +2; rolling 4 does nothing', () => {
  const st = setup(two(['erekle-i', null, null, null]), [[10, 16, -1, -1]]);
  const res = forceMove(st, 0, 0, 5); // 10 -> 15, ally at 16 within 2
  assert.ok(hasGrant(res, 'onHighRoll', 'allyPropel2'));
  assert.strictEqual(st.pieces[0][1], 18, 'ally propelled 16 -> 18');
  const st2 = setup(two(['erekle-i', null, null, null]), [[10, 16, -1, -1]]);
  forceMove(st2, 0, 0, 4);
  assert.strictEqual(st2.pieces[0][1], 16, 'a 4 does not propel');
});
t('Archil home approach: landing within 3 of the home stretch summons base pawns with +2', () => {
  const st = setup(two(['archil', null, null, null]), [[48, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // 48 -> 49
  assert.strictEqual(L.perkStepValue(st, 0, 1), 2, 'base pawns gain +2');
  const st2 = setup(two(['archil', null, null, null]), [[40, -1, -1, -1]]);
  forceMove(st2, 0, 0, 1); // 40 -> 41, too far from home
  assert.strictEqual(L.perkStepValue(st2, 0, 1), 0, 'no summons far from home');
});
t('Teimuraz I: when an ally falls, survivors gain +1 step', () => {
  const st = setup(two([null, null, 'teimuraz-i', null]), [[10, -1, -1, -1], null, [37, 10, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // captures seat 2 piece 0
  assert.ok(res.perkDefender && res.perkDefender.id === 'teimuraz-i' && res.perkDefender.trigger === 'allyCaptured');
  assert.strictEqual(L.perkStepValue(st, 2, 1), 1, 'surviving ally gains +1');
  assert.strictEqual(st.pieces[0][0], 11, 'attacker is not reciprocally killed');
});
t('George XI proximity: landing near an ally lifts both +1 and arms both to repel 1', () => {
  const st = setup(two(['george-xi', null, null, null]), [[10, 12, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // 10 -> 11, ally at 12 within 2
  assert.ok(hasGrant(res, 'onProximity', 'proxStep') && hasGrant(res, 'onProximity', 'repel'));
  assert.strictEqual(L.perkStepValue(st, 0, 0), 1); assert.strictEqual(L.perkStepValue(st, 0, 1), 1);
  assert.ok(hasEndure(st, 0, 0) && hasEndure(st, 0, 1), 'mover and ally both repel-armed');
});
t('Rostom star: allies +1 step and +50 match coins', () => {
  const st = setup(two(['rostom', null, null, null]), [[7, 20, -1, -1]]);
  forceMove(st, 0, 0, 1);
  assert.ok(L.perkStepActive(st, 0, 1));
  assert.strictEqual(L.perkBonusTotal(st, 0), 50);
});

// ---------- Giorgi VII endure, Luarsab mutual, Levan, corners ----------
t('Giorgi VII endure: strike absorbed, attacker knocked back 2 and stunned, spent stand falls next time', () => {
  const st = setup(two([null, null, 'giorgi-vii', null]), [[10, 10, -1, -1], null, [37, -1, -1, -1]]);
  forceMove(st, 2, 0, 6); // victim leaves base first: the stand forms on the track
  assert.ok(hasEndure(st, 2, 0), 'stand formed on base-leave');
  setup(st, [[10, 10, -1, -1], null, [37, -1, -1, -1]]); // victim onto abs 11, two attackers on rel 10
  const res = forceMove(st, 0, 0, 1); // 10 -> 11, onto the entrenched pawn
  assert.deepStrictEqual(res.captures, [], 'entrenched pawn is never captured');
  assert.strictEqual(st.pieces[2][0], 37, 'defender stays');
  assert.strictEqual(st.pieces[0][0], 9, 'attacker knocked back 2 (11 -> 9)');
  assert.ok(L.isFrozen(st, 0, 0), 'attacker stunned a turn');
  assert.ok(res.perk && res.perk.trigger === 'endure' && res.perk.endure.knock === 2 && res.perk.endure.stun === true);
  assert.ok(!hasEndure(st, 2, 0), 'the stand is spent');
  const res2 = forceMove(st, 0, 1, 1); // second attacker, stand spent
  assert.deepStrictEqual(res2.captures, [{ seat: 2, piece: 0 }], 'a spent stand falls');
  assert.strictEqual(st.pieces[2][0], -1);
});
t('Luarsab I mutual clash: no capture, both bounce back 1, no bonus roll', () => {
  const st = setup(two([null, null, 'luarsab-i', null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // 10 -> 11, onto the mutual pawn
  assert.deepStrictEqual(res.captures, [], 'mutual pawns are never captured');
  assert.strictEqual(st.pieces[0][0], 10, 'attacker bounces back 1');
  assert.strictEqual(st.pieces[2][0], 36, 'defender bounces back 1');
  assert.ok(res.perk && res.perk.trigger === 'mutual' && res.perk.banner === 'MUTUAL CLASH');
  assert.strictEqual(res.next, 'pass', 'no bonus roll for a clash');
});
t('Levan star: mover +1 step and +25 match coins', () => {
  const st = setup(two(['levan', null, null, null]), [[7, 20, -1, -1]]);
  forceMove(st, 0, 0, 1);
  assert.strictEqual(L.perkStepValue(st, 0, 0), 1, 'mover gains +1');
  assert.strictEqual(L.perkBonusTotal(st, 0), 25);
});
t('Constantine II corner: landing on a corner square shields allies within 2', () => {
  const st = setup(two(['constantine-ii', null, null, null]), [[12, 14, -1, -1]]);
  forceMove(st, 0, 0, 1); // 12 -> 13 (start/corner square)
  assert.ok(hasEndure(st, 0, 1), 'ally at distance 1 shielded');
});
t('George II of Kakheti endure: strike absorbed, attacker knocked back 2 and stunned', () => {
  const st = setup(two([null, null, 'george-ii-kakheti', null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  st.effects.push({ type: 'endure', seat: 2, piece: 0, knock: 2, stun: true });
  const res = forceMove(st, 0, 0, 1);
  assert.deepStrictEqual(res.captures, []);
  assert.strictEqual(st.pieces[0][0], 9);
  assert.ok(L.isFrozen(st, 0, 0));
  assert.ok(res.perk && res.perk.trigger === 'endure');
});

// ---------- Sanctuaries ----------
t('Alexander I of Kakheti: landing sanctifies the square for two rounds, then it opens again', () => {
  const st = setup(two(['alexander-i-kakheti', null, null, null]), [[10, -1, -1, -1], null, [36, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // 10 -> 11, sanctuary until turnCount 4
  assert.ok(st.perkSafeTiles.some(e => e.abs === 11), 'square sanctified');
  const res = forceMove(st, 2, 0, 1); // seat 2: abs 10 -> 11, onto the sanctuary
  assert.deepStrictEqual(res.captures, [], 'sanctuary cannot be captured on');
  assert.strictEqual(st.pieces[2][0], 37, 'attacker stacks safely on the sanctuary');
  const st2 = setup(two(['alexander-i-kakheti', null, null, null]), [[10, -1, -1, -1], null, [36, -1, -1, -1]]);
  forceMove(st2, 0, 0, 1);
  st2.turnCount = 999; // past the window
  const res2 = forceMove(st2, 2, 0, 1);
  assert.deepStrictEqual(res2.captures, [{ seat: 0, piece: 0 }], 'an expired sanctuary captures normally');
});
t('Alexander II of Imereti corner: landing on a corner square shields allies within 2', () => {
  const st = setup(two(['alexander-ii-imereti', null, null, null]), [[25, 27, -1, -1]]);
  forceMove(st, 0, 0, 1); // 25 -> 26 (corner square)
  assert.ok(hasEndure(st, 0, 1), 'ally at distance 1 shielded');
});
t('Alexander I of Georgia: landing sanctifies the square', () => {
  const st = setup(two(['alexander-i-georgia', null, null, null]), [[10, -1, -1, -1]]);
  forceMove(st, 0, 0, 1);
  assert.ok(st.perkSafeTiles.some(e => e.abs === 11));
});
t('Vakhtang V: landing sanctifies the square for one round only', () => {
  const st = setup(two(['vakhtang-v', null, null, null]), [[10, -1, -1, -1]]);
  forceMove(st, 0, 0, 1);
  const e = st.perkSafeTiles.find(x => x.abs === 11);
  assert.ok(e && e.until === 2, 'one-round window (turnCount 0 + 1 round of 2 players)');
});

// ---------- Charge, double, surge, six/home, aegis, pierce, relocate ----------
t('George IV charge: landing rushes a foe up to 3 ahead, captures it, earns a bonus roll', () => {
  const st = setup(two(['george-iv', null, null, null]), [[10, -1, -1, -1], null, [38, -1, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // lands 11, foe on abs 12 one ahead
  assert.ok(hasGrant(res, 'onLand', 'charge3'));
  assert.strictEqual(st.pieces[0][0], 12, 'charger teleports onto the foe square');
  assert.strictEqual(st.pieces[2][0], -1, 'foe eliminated');
  assert.strictEqual(res.next, 'bonus', 'charge earns the extra turn');
  assert.deepStrictEqual(res.captures, [], 'the charge is not a landing capture');
});
t('George IV charge skips safe squares and enemy blocks', () => {
  const safe = setup(two(['george-iv', null, null, null]), [[10, -1, -1, -1], null, [47, -1, -1, -1]]);
  forceMove(safe, 0, 0, 1); // foe on star abs 21, within 3 ahead of nothing reachable: squares 12,13,14 hold no foe
  assert.strictEqual(safe.pieces[0][0], 11, 'no charge at a safe foe');
  assert.strictEqual(safe.pieces[2][0], 47);
  const blocked = setup(twoB(['george-iv', null, null, null]), [[10, -1, -1, -1], null, [38, 38, -1, -1]]);
  forceMove(blocked, 0, 0, 1); // foe block on abs 12
  assert.strictEqual(blocked.pieces[0][0], 11, 'no charge into a block square');
  assert.strictEqual(blocked.pieces[2][0], 38);
});
t('Rusudan low roll: a 1 or 2 doubles via a pending bonus; a 3 does nothing', () => {
  const st = setup(two(['rusudan', null, null, null]), [[10, -1, -1, -1]]);
  forceMove(st, 0, 0, 2); // 10 -> 12, pending += 2
  assert.strictEqual(L.perkStepValue(st, 0, 0), 2);
  const res = forceMove(st, 0, 0, 1); // 12 + 1 + 2 = 15
  assert.strictEqual(st.pieces[0][0], 15, 'the doubled roll travels 3 squares on a 1');
  assert.ok(res.perkStep, 'bonus spent');
  const st2 = setup(two(['rusudan', null, null, null]), [[10, -1, -1, -1]]);
  forceMove(st2, 0, 0, 3);
  assert.strictEqual(L.perkStepValue(st2, 0, 0), 0, 'a 3 is not a low roll');
});
t('Demetre II: when this pawn falls, survivors surge +2 steps', () => {
  const st = setup(two([null, null, 'demetre-ii', null]), [[10, -1, -1, -1], null, [37, 10, -1, -1]]);
  const res = forceMove(st, 0, 0, 1);
  assert.ok(res.perkDefender && res.perkDefender.id === 'demetre-ii');
  assert.strictEqual(L.perkStepValue(st, 2, 1), 2, 'surviving ally surges +2');
});
t('Bagrat III: a 6 or reaching home lifts all other allies +1 step', () => {
  const st = setup(two(['bagrat-iii', null, null, null]), [[10, 20, -1, -1]]);
  forceMove(st, 0, 0, 6); // 10 -> 16
  assert.strictEqual(L.perkStepValue(st, 0, 1), 1, 'ally gains +1 on a six');
  const st2 = setup(two(['bagrat-iii', null, null, null]), [[56, 20, -1, -1]]);
  const res2 = forceMove(st2, 0, 0, 1); // 56 -> HOME
  assert.ok(res2.finish, 'mover reaches home');
  assert.strictEqual(L.perkStepValue(st2, 0, 1), 1, 'ally gains +1 on a home finish');
});
t('Giorgi VI aegis: a pawn beside an ally cannot be captured; a lone pawn can', () => {
  const guarded = setup(two([null, null, 'giorgi-vi', null]), [[10, -1, -1, -1], null, [37, 38, -1, -1]]);
  const r1 = forceMove(guarded, 0, 0, 1); // victim abs 11, guard abs 12 within 1
  assert.deepStrictEqual(r1.captures, [], 'guarded pawn survives');
  assert.strictEqual(guarded.pieces[2][0], 37);
  const lone = setup(two([null, null, 'giorgi-vi', null]), [[10, -1, -1, -1], null, [37, 20, -1, -1]]);
  const r2 = forceMove(lone, 0, 0, 1); // guard abs 46, far away
  assert.deepStrictEqual(r2.captures, [{ seat: 2, piece: 0 }], 'lone pawn falls normally');
});
t('David IV pierce: captures through shields and entrenched stands, +50 coins per capture', () => {
  const shielded = setup(two(['david-iv', null, null, null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  shielded.effects.push({ type: 'shield', seat: 2, piece: 0, at: shielded.turnCount });
  const r1 = forceMove(shielded, 0, 0, 1);
  assert.deepStrictEqual(r1.captures, [{ seat: 2, piece: 0 }], 'shield pierced');
  assert.strictEqual(L.perkBonusTotal(shielded, 0), 50);
  const entrenched = setup(two(['david-iv', null, 'giorgi-vii', null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  entrenched.effects.push({ type: 'endure', seat: 2, piece: 0, knock: 2, stun: true });
  const r2 = forceMove(entrenched, 0, 0, 1);
  assert.deepStrictEqual(r2.captures, [{ seat: 2, piece: 0 }], 'entrenched stand pierced');
  assert.strictEqual(entrenched.pieces[0][0], 11, 'piercing attacker is not knocked back');
});
t('Tamar relocate: a fallen ally returns to the nearest star instead of the yard', () => {
  const st = setup(two(['tamar', null, null, null]), [[7, 20, -1, -1], null, [45, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // 7 -> 8 (star): rally + relocate window
  const res = forceMove(st, 2, 0, 1); // seat 2: abs 19 -> 20, captures seat 0 piece 1
  assert.deepStrictEqual(res.captures, [{ seat: 0, piece: 1 }], 'the capture still counts');
  assert.strictEqual(st.pieces[0][1], 21, 'victim relocates to the nearest star (abs 21)');
  assert.ok(res.perkRelocated.some(r => r.seat === 0 && r.piece === 1 && r.to === 21));
});

// ---------- Cleave, divider, reciprocal, vault, chokepoint, relic, once, lane, ambush, breaker ----------
t('Simon I cleave: captures knock strictly-adjacent enemies back 2, safe ones are spared', () => {
  const st = setup(two(['simon-i', null, null, null]), [[10, -1, -1, -1], null, [37, 38, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // captures abs 11, secondary on abs 12
  assert.deepStrictEqual(res.captures, [{ seat: 2, piece: 0 }]);
  assert.strictEqual(st.pieces[2][1], 36, 'secondary slides back 2 (38 -> 36)');
  assert.ok(hasGrant(res, 'capture', 'cleave'));
  const safe = setup(two(['simon-i', null, null, null]), [[11, -1, -1, -1], null, [38, 39, -1, -1]]);
  forceMove(safe, 0, 0, 1); // captures abs 12, secondary on start square abs 13
  assert.strictEqual(safe.pieces[2][1], 39, 'a safe secondary is not cleaved');
});
t('George VIII divider: landing on a quadrant divider shields allies within 3', () => {
  const st = setup(two(['george-viii', null, null, null]), [[11, 14, -1, -1]]);
  forceMove(st, 0, 0, 1); // 11 -> 12 (divider)
  assert.ok(hasEndure(st, 0, 1), 'ally at distance 2 shielded');
  const st2 = setup(two(['george-viii', null, null, null]), [[10, 14, -1, -1]]);
  forceMove(st2, 0, 0, 1); // 10 -> 11 (not a divider)
  assert.ok(!hasEndure(st2, 0, 1), 'no barrier off a divider');
});
t('Constantine I reciprocal: the killer falls too, survivors gain +1', () => {
  const st = setup(two([null, null, 'constantine-i', null]), [[10, -1, -1, -1], null, [37, 10, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // captures seat 2 piece 0
  assert.ok(res.perkDefender && res.perkDefender.id === 'constantine-i');
  assert.deepStrictEqual(res.perkDefender.reciprocal, { seat: 0, piece: 0 }, 'attacker reciprocally killed');
  assert.strictEqual(st.pieces[0][0], -1, 'attacker goes home');
  assert.strictEqual(L.perkStepValue(st, 2, 1), 1, 'surviving ally gains +1');
});
t('David VI vault: intermediate blocks are leapt over, landing on a block stays forbidden', () => {
  const plain = setup(twoB([null, null, null, null]), [[10, -1, -1, -1], null, [37, 37, -1, -1]]);
  assert.strictEqual(L.moveFor(plain, 0, 0, 3), null, 'no vault: a block in the path forbids the move');
  const st = setup(twoB(['david-vi', null, null, null]), [[10, -1, -1, -1], null, [37, 37, -1, -1]]);
  const m = L.moveFor(st, 0, 0, 3);
  assert.ok(m && m.to === 13, 'vault leaps the block at abs 11 and lands on 13');
  forceMove(st, 0, 0, 3);
  assert.strictEqual(st.pieces[0][0], 13);
  const landing = setup(twoB(['david-vi', null, null, null]), [[10, -1, -1, -1], null, [37, 37, -1, -1]]);
  assert.strictEqual(L.moveFor(landing, 0, 0, 1), null, 'vault or not, landing ON a block is forbidden');
});
t('Bagrat IV chokepoint: strike absorbed, attacker knocked back 1, no stun', () => {
  const st = setup(two([null, null, 'bagrat-iv', null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  st.effects.push({ type: 'endure', seat: 2, piece: 0, knock: 1 });
  const res = forceMove(st, 0, 0, 1);
  assert.deepStrictEqual(res.captures, []);
  assert.strictEqual(st.pieces[0][0], 10, 'attacker knocked back 1 (11 -> 10)');
  assert.ok(!L.isFrozen(st, 0, 0), 'no stun on a chokepoint recoil');
  assert.ok(res.perk && res.perk.trigger === 'endure' && res.perk.endure.knock === 1);
});
t('Archil II relic: an odd next roll resurrects the pawn on a permanent sanctuary; an even roll loses it', () => {
  const st = setup(two([null, null, 'archil-ii', null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // captures seat 2 piece 0 on abs 11
  assert.deepStrictEqual(st.perkRelic[2], { abs: 11, piece: 0 }, 'relic cross left on the capture square');
  st.turn = 2; st.phase = 'roll';
  const r = L.roll(st, 3);
  assert.ok(r.relic && r.relic.restored === true, 'odd roll resurrects');
  assert.strictEqual(st.pieces[2][0], 37, 'pawn returns to its capture square');
  assert.ok(st.perkSafeTiles.some(e => e.abs === 11 && e.until === null), 'the cross square is a permanent sanctuary');
  const res = forceMove(st, 0, 0, 1); // seat 0 attacks the sanctuary square
  assert.deepStrictEqual(res.captures, [], 'the sanctuary cannot be captured on');
  const st2 = setup(two([null, null, 'archil-ii', null]), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  forceMove(st2, 0, 0, 1);
  st2.turn = 2; st2.phase = 'roll';
  const r2 = L.roll(st2, 2);
  assert.ok(r2.relic && r2.relic.restored === false, 'even roll loses the relic');
  assert.strictEqual(st2.pieces[2][0], -1);
  assert.strictEqual(st2.perkRelic[2], null);
});
t('George II of Georgia once: a star landing lifts allies +2, a second star landing grants nothing', () => {
  const st = setup(two(['george-ii-georgia', null, null, null]), [[7, 20, -1, -1]]);
  forceMove(st, 0, 0, 1); // 7 -> 8 (star)
  assert.strictEqual(L.perkStepValue(st, 0, 1), 2, 'ally gains +2');
  const res = forceMove(st, 0, 1, 1); // 20 + 1 + 2 = 23
  assert.strictEqual(st.pieces[0][1], 23, 'the +2 bonus spends on the next move');
  const st2 = setup(two(['george-ii-georgia', null, null, null]), [[7, 20, -1, -1]]);
  forceMove(st2, 0, 0, 1); // consumes the once-per-match grant
  st2.perkStep[0] = [0, 0, 0, 0]; // clear pending so the second landing is a plain star landing
  const res2 = forceMove(st2, 0, 1, 1); // 20 -> 21 (star)
  assert.strictEqual(res2.perk, null, 'the once-per-match perk does not fire twice');
  assert.strictEqual(L.perkStepValue(st2, 0, 0), 0, 'no new grant on the second star');
});
t('George I lane pressure: any landing gives the mover +1 on its next move', () => {
  const st = setup(two(['george-i', null, null, null]), [[10, -1, -1, -1]]);
  forceMove(st, 0, 0, 1);
  assert.strictEqual(L.perkStepValue(st, 0, 0), 1);
});
t('David VIII flank ambush: landing rushes a foe up to 3 ahead like the chivalric charge', () => {
  const st = setup(two(['david-viii', null, null, null]), [[10, -1, -1, -1], null, [38, -1, -1, -1]]);
  const res = forceMove(st, 0, 0, 1);
  assert.ok(hasGrant(res, 'onLand', 'charge3'));
  assert.strictEqual(res.perk.banner, 'FLANK AMBUSH');
  assert.strictEqual(st.pieces[0][0], 12);
  assert.strictEqual(st.pieces[2][0], -1);
});
t('Bagrat VI sanctuary breaker: landing in an enemy quadrant disables the nearest star', () => {
  const st = setup(two(['bagrat-vi', null, null, null]), [[20, -1, -1, -1], null, [46, -1, -1, -1]]);
  forceMove(st, 0, 0, 1); // 20 -> 21 (star, enemy quadrant 1): disables star 21 itself
  assert.ok(st.perkUnsafe.some(e => e.abs === 21), 'star 21 disabled');
  const res = forceMove(st, 2, 0, 1); // seat 2: abs 20 -> 21, onto the disabled star
  assert.deepStrictEqual(res.captures, [{ seat: 0, piece: 0 }], 'a disabled star captures normally');
  const st2 = setup(two(['bagrat-vi', null, null, null]), [[10, -1, -1, -1]]);
  forceMove(st2, 0, 0, 1); // 10 -> 11, own quadrant 0
  assert.strictEqual(st2.perkUnsafe.length, 0, 'no breaker in the home quadrant');
});

// ---------- Heroes trio ----------
t('Scipio approach: a foe landing within 3 tiles grants Scipio +2 and locks the foe in place', () => {
  const st = setup(two([null, null, 'scipio', null]), [[10, -1, -1, -1], null, [38, -1, -1, -1]]);
  const res = forceMove(st, 0, 0, 1); // lands abs 11, Scipio on abs 12 within 3
  assert.ok(res.perks.some(p => p.id === 'scipio' && p.trigger === 'onApproach'), 'approach fires');
  assert.strictEqual(L.perkStepValue(st, 2, 0), 2, 'Scipio gains +2');
  assert.ok(L.isFrozen(st, 0, 0), 'the bypassing foe is locked in place');
  st.turn = 0; st.phase = 'move'; st.queue = [1]; st.moves = L.queueMoves(st);
  assert.ok(!st.moves.some(m => m.piece === 0), 'the frozen foe cannot move next turn');
  assert.strictEqual(L.moveFor(st, 0, 0, 1), null, 'frozen means no legal move at all');
  const far = setup(two([null, null, 'scipio', null]), [[10, -1, -1, -1], null, [41, -1, -1, -1]]);
  forceMove(far, 0, 0, 1); // Scipio on abs 15, distance 4
  assert.strictEqual(L.perkStepValue(far, 2, 0), 0, 'no approach beyond 3 tiles');
  assert.ok(!L.isFrozen(far, 0, 0));
});
t('Sitting Bull rally: star landings cleanse freezes and propel a nearby ally +2', () => {
  const st = setup(two(['sitting-bull', null, null, null]), [[7, 9, -1, -1]]);
  st.effects.push({ type: 'freeze', seat: 0, piece: 1, at: st.turnCount });
  const res = forceMove(st, 0, 0, 1); // 7 -> 8 (star)
  assert.ok(hasGrant(res, 'star', 'cleanse') && hasGrant(res, 'star', 'allyPropel2'));
  assert.ok(!L.isFrozen(st, 0, 1), 'freeze cleansed');
  assert.strictEqual(st.pieces[0][1], 11, 'ally propelled 9 -> 11');
});
t('Zenobia aura: landing lifts every ally in the same quadrant +1, others untouched', () => {
  const st = setup(two(['zenobia', null, null, null]), [[10, 12, 20, -1]]);
  forceMove(st, 0, 0, 1); // 10 -> 11, quadrant 0
  assert.strictEqual(L.perkStepValue(st, 0, 1), 1, 'same-quadrant ally lifted');
  assert.strictEqual(L.perkStepValue(st, 0, 2), 0, 'other-quadrant ally untouched');
});

// ---------- Classic regression + legacy ----------
t('Classic regression: no perk equipped means base rules, no perk state, no bonus coins', () => {
  const st = setup(two(), [[7, -1, -1, -1], null, [37, -1, -1, -1]]);
  const r1 = forceMove(st, 0, 0, 1); // star landing, no perk
  assert.strictEqual(r1.perk, null, 'no perk fires on a classic star landing');
  const st2 = setup(two(), [[10, -1, -1, -1], null, [37, -1, -1, -1]]);
  const r2 = forceMove(st2, 0, 0, 1); // classic capture
  assert.deepStrictEqual(r2.captures, [{ seat: 2, piece: 0 }]);
  assert.strictEqual(r2.perk, null, 'no perk fires on a classic capture');
  assert.strictEqual(L.perkBonusTotal(st2, 0), 0);
  assert.deepStrictEqual(st2.perkUnsafe, []);
  assert.deepStrictEqual(st2.perkSafeTiles, []);
  const st3 = setup(two(), [[56, -1, -1, -1]]);
  const r3 = forceMove(st3, 0, 0, 1); // classic home finish
  assert.ok(r3.finish && r3.perk === null, 'no perk fires on a classic finish');
});
t('Legacy states without L2 perk fields keep working (backward-compatible defaults)', () => {
  const st = setup(two(['george-v', null, null, null]), [[7, 20, -1, -1]]);
  delete st.perkBonusCoins; delete st.perkRollFloor; delete st.perkRelocate; delete st.perkRelic;
  delete st.perkUnsafe; delete st.perkSafeTiles; delete st.perkOnceFired; delete st.perkEndureSpent;
  const res = forceMove(st, 0, 0, 1); // star landing still works, fields re-initialise lazily
  assert.ok(res.perk && res.perk.id === 'george-v');
  assert.strictEqual(st.pieces[0][1], 22, 'ally still leaps');
  assert.ok(Array.isArray(st.perkRollFloor) && st.perkRollFloor[0] !== null, 'roll floor window re-initialised');
});

console.log('\nkings-pack: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
