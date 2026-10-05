// Unit tests + balance simulations for Lucky Chaos Ludo (mode 'lucky'). Run: node test/lucky.test.js  (GAMES=n to shorten)
const assert = require('assert');
const L = require('../www/js/logic.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); } }
const A = l => ({ type: 'ai', level: l || 'hard' });
const ME = 3;
const rel = (seat, abs) => L.posFromAbs(seat, abs);
// 4 players; seat 0 positions equal absolute squares, "me" is seat 3 (bottom-left)
function game(seed) { const st = L.newGame([A(), A(), A(), A()], {}, seed || 7, 'lucky'); st.pieces = [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]; return st; }
function setMove(st, seat, v) { st.turn = seat; st.phase = 'move'; st.queue = [v]; st.moves = L.queueMoves(st); }
function setRoll(st, seat) { st.turn = seat; st.phase = 'roll'; st.queue = []; st.moves = []; st.sixes = 0; st.bonus = 0; }
function land(st, abs, ev, extra) { // move my token 0 onto square abs (from 3 behind) with a forced event
  st.pieces[ME][0] = rel(ME, abs) - 3; setMove(st, ME, 3); return L.move(st, 0, 3, ev);
}
const tileOf = (st, abs) => st.tiles.find(x => x.abs === abs);

console.log('lucky.test.js');
t('board: 4 Boost + 4 Chaos Lucky Tiles and 4 Danger Tiles, distinct, never on start/star squares', () => {
  const st = game();
  assert.strictEqual(st.tiles.length, 12);
  assert.deepStrictEqual(['boost', 'chaos', 'danger'].map(k => st.tiles.filter(x => x.kind === k).length), [4, 4, 4]);
  assert.strictEqual(new Set(st.tiles.map(x => x.abs)).size, 12);
  st.tiles.forEach(x => assert.ok(!L.isSafeAbs(x.abs)));
  assert.ok(st.lk && st.lk.charge.every(c => c === 0) && st.lk.powers.every(p => p.length === 0));
});
t('only EXACT landing triggers a tile; passing over does nothing', () => {
  const st = game(); st.pieces[ME][0] = 14; setMove(st, ME, 4); // passes abs 4 (Boost) to abs 5
  const r = L.move(st, 0, 4); assert.strictEqual(r.event, null); assert.strictEqual(st.lk.charge[ME], 0);
  const st2 = game(); const r2 = land(st2, 4, 'shield'); assert.ok(r2.event && r2.event.kind === 'boost' && r2.event.event === 'shield');
});
t('tile cooldown: inactive for 2 rounds after it triggers, then active again', () => {
  const st = game(); land(st, 4, 'extra');
  const tl = tileOf(st, 4); assert.strictEqual(tl.until, st.turnCount + 2 * 4);
  const st2 = L.clone(st); st2.pieces[ME][1] = rel(ME, 4) - 2; setMove(st2, ME, 2); assert.strictEqual(L.move(st2, 1, 2).event, null, 'resting tile');
  const st3 = L.clone(st); st3.turnCount = tl.until; st3.pieces[ME][1] = rel(ME, 4) - 2; setMove(st3, ME, 2); assert.ok(L.move(st3, 1, 2, 'extra').event, 'active again');
});
// ---- Boost wheel ----
t('Boost: Shield blocks captures and Chaos effects until the end of my next turn', () => {
  const st = game(); land(st, 4, 'shield');
  assert.ok(L.isShielded(st, ME, 0) && L.immune(st, ME, 0));
  st.pieces[0][0] = 1; setMove(st, 0, 3); const m = st.moves.find(x => x.piece === 0); assert.strictEqual(m.captures.length, 0);
});
t('Boost: Jump +3 (Danger: +5) and it can capture', () => {
  let st = game(); st.pieces[0][0] = 7; let r = land(st, 4, 'jump3');
  assert.strictEqual(st.pieces[ME][0], rel(ME, 7)); assert.strictEqual(r.event.captures.length, 1); assert.strictEqual(st.pieces[0][0], -1);
  st = game(); r = land(st, 6, { kind: 'boost', event: 'jump3' }); assert.strictEqual(st.pieces[ME][0], rel(ME, 11)); assert.strictEqual(L.eventLabel('jump3', true).name, 'Jump +5');
});
t('Boost: Extra Roll gives a roll (Danger: two)', () => {
  let st = game(); let r = land(st, 4, 'extra'); assert.strictEqual(r.next, 'bonus'); assert.strictEqual(st.turn, ME);
  st = game(); r = land(st, 6, { kind: 'boost', event: 'extra' }); assert.strictEqual(r.next, 'bonus'); assert.strictEqual(st.bonus, 1);
});
t('Boost: Double Roll is stored and doubles the next roll when used', () => {
  const st = game(); land(st, 4, 'dbl'); assert.deepStrictEqual(st.lk.powers[ME], ['dbl']);
  setRoll(st, ME); assert.ok(L.powerValid(st, ME, 'dbl')); L.usePower(st, 'dbl'); const r = L.roll(st, 3);
  assert.strictEqual(r.value, 6); assert.strictEqual(st.lk.powers[ME].length, 0);
});
t('Boost: Lucky 6 is stored; using it rolls a 6 that does not count toward three 6s', () => {
  const st = game(); land(st, 4, 'six'); setRoll(st, ME); st.sixes = 2;
  L.usePower(st, 'six'); const r = L.roll(st); assert.strictEqual(r.raw, 6); assert.ok(r.lucky6 && !r.forfeit); assert.strictEqual(st.sixes, 2);
});
t('Boost: Safe Escape is stored; it dashes the most threatened token to the next safe square', () => {
  const st = game(); land(st, 4, 'escape');
  st.pieces[ME][1] = rel(ME, 44); st.pieces[0][0] = 41; // rival 3 behind my token at abs 44 -> next safe square ahead: star 47
  setRoll(st, ME); const e = L.escapeTarget(st, ME); assert.strictEqual(e.piece, 1);
  const r = L.usePower(st, 'escape'); assert.strictEqual(st.pieces[ME][1], rel(ME, 47)); assert.ok(r.moves.length === 1);
  assert.ok(!L.powerValid(st, ME, 'dbl'), 'one power per roll');
});
// ---- Chaos wheel ----
t('Chaos: Bomb slides every other token within 2 squares back 3 (mine too), safe/shield/King immune, never to base', () => {
  const st = game();
  st.pieces[0][0] = 9; st.pieces[0][1] = 12; st.pieces[0][2] = 8; /* star */ st.pieces[ME][1] = rel(ME, 11); st.pieces[0][3] = 13; // abs 13 = start square
  const r = land(st, 10, 'bomb');
  assert.strictEqual(st.pieces[0][0], 6); assert.strictEqual(st.pieces[0][1], 9); assert.strictEqual(st.pieces[0][2], 8); assert.strictEqual(st.pieces[0][3], 13);
  assert.strictEqual(st.pieces[ME][1], rel(ME, 8)); assert.strictEqual(r.event.moves.length, 3); assert.strictEqual(r.event.sent.length, 0);
  const s2 = game(); s2.pieces[1][0] = 1; s2.pieces[ME][0] = 0; assert.strictEqual(L.bombTargets(s2, ME, 0, 3).length, 0, 'tokens on their own start never pushed');
});
t('Chaos: Swap is a choice (swap with the nearest rival ahead, or stay)', () => {
  let st = game(); st.pieces[0][0] = 16; let r = land(st, 10, 'swapc');
  assert.strictEqual(st.phase, 'choose'); assert.strictEqual(r.next, 'choose'); assert.deepStrictEqual(st.pending.options, ['swap', 'stay']);
  const c = L.choose(st, 0); assert.strictEqual(st.pieces[ME][0], rel(ME, 16)); assert.strictEqual(st.pieces[0][0], 10); assert.ok(c.next);
  st = game(); st.pieces[0][0] = 16; land(st, 10, 'swapc'); L.choose(st, 1); assert.strictEqual(st.pieces[ME][0], rel(ME, 10)); assert.strictEqual(st.pieces[0][0], 16);
});
t('Chaos: Zap sends the nearest rival within 3 to base; near-home cap (40+) only slides it back 6; safe squares immune', () => {
  let st = game(); st.pieces[0][0] = 12; let r = land(st, 10, 'zapc'); assert.strictEqual(st.pieces[0][0], -1); assert.strictEqual(r.event.sent.length, 1);
  st = game(); st.pieces[0][0] = 50; land(st, 49, 'zapc'); assert.strictEqual(st.pieces[0][0], 44, 'capped');
  st = game(); st.pieces[0][0] = 8; st.pieces[ME][0] = rel(ME, 10); assert.strictEqual(L.luckyTarget(st, 'zapc', ME, 0), null, 'star square is safe');
});
t('Chaos: Freeze stops the nearest rival ahead for its next turn, then it thaws', () => {
  const st = game(); st.pieces[0][0] = 15; land(st, 10, 'freeze'); assert.ok(L.isFrozen(st, 0, 0));
  assert.strictEqual(st.turn, 0, 'turn passed to the frozen token\'s owner');
  assert.strictEqual(L.legalMoves(st, 0, 2).filter(m => m.piece === 0).length, 0);
  L.nextTurn(st); assert.ok(!L.isFrozen(st, 0, 0));
});
t('Chaos: Back 3 moves this token back (Danger: Back 5)', () => {
  let st = game(); land(st, 10, 'back3'); assert.strictEqual(st.pieces[ME][0], rel(ME, 10) - 3);
  st = game(); land(st, 6, { kind: 'chaos', event: 'back3' }); assert.strictEqual(st.pieces[ME][0], rel(ME, 6) - 5);
});
t('Chaos: Wild Jump draws 1-6 and offers jump or stay', () => {
  let st = game(); let r = land(st, 10, { event: 'wild', wild: 4 }); assert.strictEqual(st.pending.type, 'wild'); assert.strictEqual(r.event.amount, 4);
  L.choose(st, 0); assert.strictEqual(st.pieces[ME][0], rel(ME, 14));
  st = game(); land(st, 10, { event: 'wild', wild: 4 }); L.choose(st, 1); assert.strictEqual(st.pieces[ME][0], rel(ME, 10));
});
t('wheels only land on outcomes that can happen now', () => {
  const st = game(); st.pieces[ME][0] = rel(ME, 10);
  for (let i = 0; i < 300; i++) { st.rng = i + 1; const e = L.spinLucky(st, { kind: 'chaos', seat: ME, piece: 0, danger: false }); assert.ok(L.eventValidL(st, e, ME, 0, false), e); assert.ok(['back3', 'wild'].includes(e), e); }
});
// ---- Streak / revenge / danger ----
t('Lucky Streak grows with each activation (max 3), resets when one of my tokens is captured', () => {
  const st = game(); land(st, 4, 'extra'); assert.strictEqual(st.lk.streak[ME], 1);
  st.lk.tg = false; st.pieces[ME][1] = rel(ME, 17) - 2; setMove(st, ME, 2); L.move(st, 1, 2, 'extra'); assert.strictEqual(st.lk.streak[ME], 2);
  st.lk.streak[ME] = 3; st.pieces[ME][2] = rel(ME, 30) - 1; setMove(st, ME, 1); L.move(st, 2, 1, 'extra'); assert.strictEqual(st.lk.streak[ME], 3, 'capped');
  st.pieces[0][0] = L.absOf(ME, st.pieces[ME][2]) - 2; setMove(st, 0, 2); L.move(st, 0, 2);
  assert.strictEqual(st.lk.streak[ME], 0); assert.strictEqual(st.lk.revenge[ME], true);
});
t('Lucky Streak improves wheel odds (nudge): fewer self-hurting Back 3 on the Chaos wheel at streak 3', () => {
  const st = game(); st.pieces[ME][0] = rel(ME, 10); st.pieces[0][0] = 12; st.pieces[0][1] = 16; st.pieces[1][0] = rel(1, 20);
  const count = streak => { let b = 0; st.lk.streak[ME] = streak; for (let i = 0; i < 6000; i++) { st.rng = 99 + i * 7; if (L.spinLucky(st, { kind: 'chaos', seat: ME, piece: 0, danger: false }) === 'back3') b++; } return b / 6000; };
  const s0 = count(0), s3 = count(3); assert.ok(s0 > 0.13 && s3 < s0 * 0.8, s0 + ' ' + s3);
  const nc = L.nudgeChance(st, ME); assert.ok(nc >= 0.449 && nc <= 0.5, 'capped at 50%: ' + nc);
});
t('Revenge Charge: next activation shows 2 results to choose from, then it is used up', () => {
  const st = game(); st.lk.revenge[ME] = true; st.pieces[0][0] = 12;
  const r = land(st, 10, { event: 'zapc', alt: 'back3' });
  assert.strictEqual(st.pending.type, 'revenge'); assert.deepStrictEqual(r.event.choice.options, ['zapc', 'back3']); assert.strictEqual(st.lk.revenge[ME], false);
  assert.strictEqual(L.defaultChoice(st), 0, 'auto-pick prefers Zap over Back 3');
  L.choose(st, 1); assert.strictEqual(st.pieces[ME][0], rel(ME, 10) - 3); assert.strictEqual(st.pieces[0][0], 12);
});
t('Danger Tiles: 50/50 Boost or Chaos wheel (4000 activations), +2 charge, stronger outcomes', () => {
  let boost = 0; const N = 4000;
  for (let i = 0; i < N; i++) {
    const st = game(); st.rng = 1 + i * 2654435761 >>> 0; st.pieces[ME][0] = rel(ME, 6) - 3; setMove(st, ME, 3);
    const r = L.move(st, 0, 3); if (r.event.kind === 'boost') boost++;
    if (i === 0) assert.strictEqual(st.lk.charge[ME], 2);
    assert.ok(r.event.danger);
  }
  assert.ok(Math.abs(boost / N - 0.5) < 0.03, 'boost share ' + boost / N);
});
// ---- Charge meter and Mega Wheel ----
t('one tile spin grants at most 2 charge even when Danger, streak and a comeback would stack', () => {
  const st = game(); st.lk.streak[ME] = 3; st.pieces[0] = [40, 40, 40, 40]; st.pieces[1] = [40, 40, 40, 40]; st.pieces[2] = [40, 40, 40, 40];
  st.pieces[ME][0] = rel(ME, 6) - 3; setMove(st, ME, 3);
  L.move(st, 0, 3); assert.ok(st.lk.charge[ME] <= 2, 'charge ' + st.lk.charge[ME]);
});
t('Lucky Charge: +1 per capture, +1 per tile (once per turn), capped at 5; Mega only at 5/5 before a roll', () => {
  const st = game(); land(st, 4, 'extra'); assert.strictEqual(st.lk.charge[ME], 1);
  st.pieces[ME][1] = rel(ME, 17) - 2; setMove(st, ME, 2); L.move(st, 1, 2, 'extra'); assert.strictEqual(st.lk.charge[ME], 1, 'once per turn');
  st.pieces[0][0] = 30; st.pieces[ME][2] = rel(ME, 30) - 4; setMove(st, ME, 4); L.move(st, 2, 4); assert.strictEqual(st.lk.charge[ME], 2, 'capture +1');
  st.lk.charge[ME] = 4; setRoll(st, ME); assert.ok(!L.canMega(st, ME)); st.lk.charge[ME] = 9; st.lk.charge[ME] = Math.min(5, st.lk.charge[ME]);
  assert.ok(L.canMega(st, ME)); setMove(st, ME, 3); assert.ok(!L.canMega(st, ME), 'not during a move');
});
t('Mega Wheel outcomes: Rocket, Free Token, Royal Guard, Double Turn, Storm, Crown (charge resets to 0)', () => {
  const base = () => { const st = game(); st.pieces[ME] = [rel(ME, 20), -1, -1, -1]; st.pieces[0][0] = 18; setRoll(st, ME); st.lk.charge[ME] = 5; return st; };
  let st = base(); let r = L.mega(st, 'rocket'); assert.strictEqual(st.pieces[ME][0], rel(ME, 28)); assert.strictEqual(st.lk.charge[ME], 0); assert.strictEqual(st.phase, 'roll');
  st = base(); L.mega(st, 'free'); assert.strictEqual(st.pieces[ME][1], 0);
  st = base(); L.mega(st, 'guard'); assert.ok(L.isShielded(st, ME, 0));
  st = base(); L.mega(st, 'turn2'); assert.strictEqual(st.bonus, 2);
  st = base(); r = L.mega(st, 'storm'); assert.strictEqual(st.pieces[0][0], 15); assert.strictEqual(r.moves.length, 1);
  st = base(); r = L.mega(st, 'crown'); assert.ok(L.isKing(st, ME, 0)); assert.deepStrictEqual(r.crowned, { seat: ME, piece: 0 });
  st = base(); assert.throws(() => { st.lk.charge[ME] = 4; L.mega(st); });
});
// ---- King token ----
t('King: a token with 2 captures is crowned; King moves +1 and is immune to Zap/Swap/Bomb/Freeze', () => {
  const st = game(); st.pieces[0][0] = 20; st.pieces[0][1] = 25; st.pieces[ME][0] = rel(ME, 18);
  setMove(st, ME, 2); let r = L.move(st, 0, 2); assert.ok(!r.crowned);
  setMove(st, ME, 5); r = L.move(st, 0, 5); assert.deepStrictEqual(r.crowned, { seat: ME, piece: 0 }); assert.ok(L.isKing(st, ME, 0));
  setMove(st, ME, 3); const m = st.moves.find(x => x.piece === 0); assert.strictEqual(m.to, rel(ME, 29), 'King stride +1'); assert.ok(m.stride);
  assert.ok(L.immune(st, ME, 0));
  st.pieces[0][2] = 23; assert.strictEqual(L.luckyTarget(st, 'zapc', 0, 2), null);
  assert.strictEqual(L.bombTargets(st, 0, 2, 3).filter(x => x.seat === ME).length, 0);
});
t('King lasts 3 of its owner\'s turns after being crowned, then expires', () => {
  const st = game(); st.pieces[ME][0] = rel(ME, 20); st.turn = ME; st.lk.kills[ME][0] = 2; L.checkKing(st, ME, 0);
  L.nextTurn(st); // end of the crowning turn: does not count
  for (let k = 0; k < 3; k++) { assert.ok(L.isKing(st, ME, 0), 'still King ' + k); while (st.turn !== ME) L.nextTurn(st); L.nextTurn(st); }
  assert.ok(!L.isKing(st, ME, 0));
});
t('capturing a King adds +2 charge on top of the capture and removes the crown, without filling Mega', () => {
  const st = game(); st.pieces[ME][0] = rel(ME, 20); st.lk.kills[ME][0] = 2; L.checkKing(st, ME, 0);
  st.pieces[0][0] = 17; setMove(st, 0, 3); const r = L.move(st, 0, 3);
  assert.ok(r.kingCaptured); assert.strictEqual(st.lk.charge[0], 3); assert.ok(!L.canMega(st, 0)); assert.ok(!L.isKing(st, ME, 0)); assert.strictEqual(st.pieces[ME][0], -1);
});
// ---- powers cap ----
t('stored powers: max 2 per player, never two of the same', () => {
  const st = game(); st.pieces[ME][0] = rel(ME, 4);
  st.lk.powers[ME] = ['dbl']; assert.ok(!L.eventValidL(st, 'dbl', ME, 0)); assert.ok(L.eventValidL(st, 'six', ME, 0));
  st.lk.powers[ME] = ['dbl', 'six']; ['dbl', 'six', 'escape'].forEach(p => assert.ok(!L.eventValidL(st, p, ME, 0)));
  for (let i = 0; i < 300; i++) { st.rng = i + 5; const e = L.spinLucky(st, { kind: 'boost', seat: ME, piece: 0, danger: false }); assert.ok(!L.POWERS.includes(e)); }
});
// ---- near-home protection ----
t('near home: home-column tokens are never targeted; Zap never sends a 40+ token to base; no effect moves a token below its start', () => {
  const st = game(); st.pieces[0] = [52, 54, 50, 3]; st.pieces[ME][0] = rel(ME, 51);
  const bt = L.bombTargets(st, ME, 0, 3); assert.ok(bt.every(x => st.pieces[x.seat][x.piece] <= 50));
  assert.ok(L.stormTargets(st, ME).every(x => st.pieces[x.seat][x.piece] <= 51));
  const s2 = game(); s2.pieces[0][0] = 2; land(s2, 4, 'extra'); s2.lk.tg = false; s2.pieces[ME][1] = rel(ME, 4) - 3; s2.tiles.forEach(x => x.until = 0);
  const r = L.applyLucky(s2, { tile: 4, tileKind: 'chaos', kind: 'chaos', seat: 0, piece: 0, danger: true }, 'back3');
  assert.strictEqual(s2.pieces[0][0], 0, 'Back 5 from square 2 stops at the start square');
});
// ---- decisions ----
t('decision window default: Swap when it is clearly good, Stay when it only gains 1 square but exposes the token', () => {
  let st = game(); st.pieces[0][0] = 22; land(st, 10, 'swapc'); assert.strictEqual(L.defaultChoice(st), 0, 'swap 12 ahead');
  st = game(); st.pieces[0][0] = 11; land(st, 10, 'swapc'); assert.strictEqual(L.defaultChoice(st), 1, 'stay: rival would sit 1 behind me');
});
t('decision window default: Wild Jump jumps when it captures', () => {
  const st = game(); st.pieces[0][0] = 13 + 1; land(st, 10, { event: 'wild', wild: 4 }); assert.strictEqual(L.defaultChoice(st), 0);
});
t('AI decides instantly and legally at every level (choices, Mega, powers)', () => {
  ['easy', 'medium', 'hard'].forEach(lv => {
    const st = game(3); st.pieces[0][0] = 16; land(st, 10, 'swapc'); const i = L.aiChoose(st, lv); assert.ok(i === 0 || i === 1);
    const s2 = game(4); setRoll(s2, ME); s2.pieces[ME][0] = 5; s2.lk.charge[ME] = 5; if (lv !== 'easy') assert.deepStrictEqual(L.aiPreRoll(s2, lv), { type: 'mega' });
  });
  const s3 = game(); setRoll(s3, ME); s3.lk.powers[ME] = ['six']; assert.deepStrictEqual(L.aiPreRoll(s3, 'hard'), { type: 'power', id: 'six' }, 'all tokens in base: Lucky 6');
});

// ---- simulations ----
const GAMES = +process.env.GAMES || 1000;
function playTracked(seats, mode, seed, rules, checks) {
  const st = L.newGame(seats, rules || {}, seed, mode); let leader = null, guard = 0, megas = 0, kings = 0;
  while (st.phase !== 'over' && guard++ < 60000) {
    if (leader === null) { let b = -1, bs = -1; st.players.forEach(s => { const p = L.progressOf(st, s); if (p > bs) { bs = p; b = s; } }); if (bs >= 116) leader = b; }
    const before = checks ? st.pieces.map(a => a && a.slice()) : null;
    const r = L.aiStep(st);
    if (r.mega) megas++; if ((r.move && r.move.crowned) || (r.mega && r.mega.crowned)) kings++;
    if (checks) {
      st.players.forEach(s => st.pieces[s].forEach((p, i) => { const b = before[s][i]; if (b >= L.COL0 && b <= L.HOME) assert.ok(p >= b, 'home-column token moved back'); }));
      const ev = (r.move && r.move.event) || (r.choice && r.choice.event);
      if (ev && ev.sent) ev.sent.forEach(x => assert.ok(x.from < L.ZAP_CAP, 'zap sent a 40+ token to base'));
      st.lk.powers.forEach(p => { assert.ok(p.length <= 2); assert.strictEqual(new Set(p).size, p.length); });
      st.lk.charge.forEach(c => assert.ok(c >= 0 && c <= 5)); st.lk.kings.forEach(k => assert.ok(k.left >= 1 && k.left <= 3));
    }
  }
  return { st, leader, megas, kings };
}
const RULESETS = [{}, { rollStyle: 'classic' }, { blocks: true }, { captureToEnter: true }, { safeSquares: false }, { bonusOnCapture: false, bonusOnHome: false }];
const LV = ['easy', 'medium', 'hard'];
[2, 3, 4].forEach(np => t(`${GAMES} Lucky Chaos games with ${np} players (all levels, all rule sets) always end with a winner; invariants hold`, () => {
  let rolls = 0, max = 0;
  for (let i = 0; i < GAMES; i++) {
    const seats = [null, null, null, null], order = np === 2 ? [1, 3] : np === 3 ? [0, 1, 3] : [0, 1, 2, 3];
    order.forEach((s, k) => { seats[s] = A(LV[(i + k) % 3]); });
    const r = playTracked(seats, 'lucky', 10000 + i, RULESETS[i % RULESETS.length], i % 5 === 0);
    assert.strictEqual(r.st.phase, 'over', 'game ' + i + ' did not finish'); assert.strictEqual(r.st.ranking.length, np);
    rolls += r.st.rolls; max = Math.max(max, r.st.rolls);
  }
  console.log(`     ${np}p: avg ${(rolls / GAMES).toFixed(0)} rolls, max ${max}`);
}));
t('balance: skill still matters and luck does not decide games', () => {
  const N = Math.max(200, Math.min(GAMES, 1000));
  function duel(a, b, mode) { let w = 0; for (let i = 0; i < N; i++) { const sw = i % 2, seats = [null, null, null, null]; seats[sw ? 1 : 3] = A(a); seats[sw ? 3 : 1] = A(b); if (playTracked(seats, mode, 50000 + i).st.ranking[0] === (sw ? 1 : 3)) w++; } return w / N; }
  const he = duel('hard', 'easy', 'lucky'), hm = duel('hard', 'medium', 'lucky'), me = duel('medium', 'easy', 'lucky');
  const heS = duel('hard', 'easy', 'classic');
  console.log(`     Lucky Chaos 1v1 win rates (${N} games each): hard>easy ${he.toFixed(3)}, hard>normal ${hm.toFixed(3)}, normal>easy ${me.toFixed(3)} (Star mode hard>easy ${heS.toFixed(3)})`);
  assert.ok(he > 0.75, 'hard beats easy clearly'); assert.ok(hm > 0.55); assert.ok(me > 0.55);
  // 4 players: one stronger computer vs three weaker ones (seat rotates); fair share would be 25%
  function table(top, rest, mode) { let w = 0; for (let i = 0; i < N; i++) { const seats = [A(rest), A(rest), A(rest), A(rest)], k = i % 4; seats[k] = A(top); if (playTracked(seats, mode, 90000 + i).st.ranking[0] === k) w++; } return w / N; }
  const t4he = table('hard', 'easy', 'lucky'), t4hm = table('hard', 'medium', 'lucky'), t4me = table('medium', 'easy', 'lucky'), t4heS = table('hard', 'easy', 'classic');
  console.log(`     Lucky Chaos 4p win share of the single stronger AI (${N} games each, fair share 25%): hard vs 3 easy ${t4he.toFixed(3)}, hard vs 3 normal ${t4hm.toFixed(3)}, normal vs 3 easy ${t4me.toFixed(3)} (Star mode hard vs 3 easy ${t4heS.toFixed(3)})`);
  assert.ok(t4he > 0.45 && t4hm > 0.3 && t4me > 0.3, 'skill matters in 4-player games too');
  [2, 4].forEach(np => {
    const agg = { lucky: [0, 0, 0, 0, 0, 0], classic: [0, 0, 0, 0, 0, 0] };
    ['lucky', 'classic'].forEach(mode => { for (let i = 0; i < N; i++) {
      const seats = np === 2 ? [null, A(), null, A()] : [A('hard'), A('medium'), A('easy'), A('hard')];
      const r = playTracked(seats, mode, 70000 + i); const a = agg[mode];
      a[0] += r.st.rolls; a[1] += r.st.turnCount; if (r.leader !== null) { a[2]++; if (r.st.ranking[0] === r.leader) a[3]++; } a[4] += r.megas; a[5] += r.kings;
    } });
    const L1 = agg.lucky, S1 = agg.classic, lw = L1[3] / L1[2], sw = S1[3] / S1[2];
    console.log(`     ${np}p avg length: Lucky Chaos ${(L1[0] / N).toFixed(0)} rolls / ${(L1[1] / N).toFixed(0)} turns vs Star ${(S1[0] / N).toFixed(0)} rolls / ${(S1[1] / N).toFixed(0)} turns; leader at 50% progress wins: Lucky ${(lw * 100).toFixed(1)}% vs Star ${(sw * 100).toFixed(1)}%; per game: ${(L1[4] / N).toFixed(1)} Mega spins, ${(L1[5] / N).toFixed(2)} Kings`);
    assert.ok(lw > (np === 2 ? 0.6 : 0.4), 'leader at halfway still usually wins');
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
