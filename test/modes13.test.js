// v1.3 modes: Quick (2 tokens), Team 2v2, Arrow tiles, Friendly (no capture).
const assert = require('assert');
const L = require('../www/js/logic.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', e.stack.split('\n').slice(0, 4).join('\n    ')); } }
const H = { type: 'human' }, A = (lv) => ({ type: 'ai', level: lv || 'medium' });
const GAMES = +(process.env.GAMES || 300);

t('Quick Ludo: 2 tokens, same track, 6 to leave, exact home', () => {
  const st = L.newGame([null, A(), null, H], {}, 3, 'quick');
  assert.strictEqual(st.nPieces, 2);
  assert.strictEqual(st.pieces[3].length, 2);
  assert.strictEqual(L.legalMoves(st, 3, 5).length, 0);
  assert.strictEqual(L.legalMoves(st, 3, 6).length, 2);
  st.pieces[3][0] = 56;
  const m = L.legalMoves(st, 3, 1)[0];
  assert.strictEqual(m.to, L.HOME);
  assert.strictEqual(L.legalMoves(st, 3, 2).length, 0, 'exact roll still required');
});

t('Arrow: each player starts with one token already on the start square', () => {
  const four = L.newGame([H, A(), A(), A()], {}, 4, 'arrow');
  assert.strictEqual(four.nPieces, 4);
  four.players.forEach(s => {
    assert.strictEqual(four.pieces[s][0], 0, 'token 0 starts on the start square');
    assert.ok(four.pieces[s].slice(1).every(p => p === -1), 'other tokens stay in base');
  });
  const withOne = L.legalMoves(four, 0, 1).find(m => m.piece === 0);
  assert.ok(withOne && withOne.from === 0 && withOne.to === 1, 'any roll 1-5 moves the starter token without a 6');
  assert.deepStrictEqual(L.legalMoves(four, 0, 1).find(m => m.from === -1), undefined, 'tokens still in base need a 6');
  const classic = L.newGame([H, A(), null, null], {}, 4, 'classic');
  assert.ok(classic.pieces[0].every(p => p === -1), 'classic still starts every token in base');
  const quick = L.newGame([H, A(), null, null], {}, 4, 'quick');
  assert.ok(quick.pieces[0].every(p => p === -1), 'quick still starts every token in base');
});

t('Arrow: distance-to-arrow — land jumps, overshoot does not', () => {
  const st = L.newGame([H, A(), null, null], {}, 4, 'arrow');
  // Arrow sits at relative 4. Place token N squares before it.
  function fromBefore(nBefore) {
    st.pieces[0][0] = 4 - nBefore;
    return st.pieces[0][0];
  }
  // N=4: from 0, roll 4 lands on arrow → jump; roll 5/6 pass
  fromBefore(4);
  const land = L.legalMoves(st, 0, 4).find(m => m.piece === 0);
  assert.ok(land.arrowJump, 'roll=distance lands on arrow and jumps');
  assert.strictEqual(land.to, 8);
  const p1 = L.legalMoves(st, 0, 5).find(m => m.piece === 0);
  assert.ok(!p1.arrowJump, 'roll=distance+1 must not jump');
  assert.strictEqual(p1.to, 5, 'ends on the normal 5th square past the arrow');
  const p2 = L.legalMoves(st, 0, 6).find(m => m.piece === 0);
  assert.ok(!p2.arrowJump, 'roll=distance+2 must not jump');
  assert.strictEqual(p2.to, 6);
  // N=3: from 1, roll 3 jumps; roll 4 ends on 5
  fromBefore(3);
  const l3 = L.legalMoves(st, 0, 3).find(m => m.piece === 0);
  assert.ok(l3.arrowJump);
  assert.strictEqual(l3.to, 8);
  const o4 = L.legalMoves(st, 0, 4).find(m => m.piece === 0);
  assert.ok(!o4.arrowJump);
  assert.strictEqual(o4.to, 5);
  // Apply move: roll 5 from 0 must leave token on 5 (no jump teleport)
  fromBefore(4);
  st.phase = 'roll'; st.turn = 0; st.queue = []; st.sixes = 0; st.bonus = 0;
  L.roll(st, 5);
  const mv = st.moves.find(m => m.piece === 0);
  assert.strictEqual(mv.to, 5);
  L.move(st, 0, 5);
  assert.strictEqual(st.pieces[0][0], 5, 'after applying roll 5, token sits past the arrow');
});

t('Arrow: exact land jumps +4; passing over does not', () => {
  const st = L.newGame([H, A(), null, null], {}, 4, 'arrow');
  assert.ok(st.rules.arrows);
  assert.strictEqual(L.ARROW_JUMP, 4);
  assert.deepStrictEqual(L.ARROW_SQUARES, [4, 17, 30, 43]);
  st.pieces[0][0] = 0;
  const land4 = L.legalMoves(st, 0, 4).find(m => m.piece === 0);
  assert.deepStrictEqual(land4.path, [1, 2, 3, 4, 5, 6, 7, 8], 'roll 4 lands on arrow then jumps +4');
  assert.strictEqual(land4.to, 8);
  const pass5 = L.legalMoves(st, 0, 5).find(m => m.piece === 0);
  assert.deepStrictEqual(pass5.path, [1, 2, 3, 4, 5], 'roll 5 passes over arrow — normal stop on 5');
  assert.strictEqual(pass5.to, 5);
  const pass6 = L.legalMoves(st, 0, 6).find(m => m.piece === 0);
  assert.deepStrictEqual(pass6.path, [1, 2, 3, 4, 5, 6], 'roll 6 passes over arrow — normal stop on 6');
  assert.strictEqual(pass6.to, 6);
  st.pieces[0][0] = 3;
  const land1 = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.deepStrictEqual(land1.path, [4, 5, 6, 7, 8], 'exact land from one square behind jumps');
  const classic = L.newGame([H, A(), null, null], { arrows: true }, 4, 'classic');
  classic.pieces[0][0] = 0;
  assert.deepStrictEqual(L.legalMoves(classic, 0, 5)[0].path, [1, 2, 3, 4, 5], 'house-rule arrows also require exact land');
  assert.deepStrictEqual(L.legalMoves(classic, 0, 4)[0].path, [1, 2, 3, 4, 5, 6, 7, 8], 'house-rule exact land still jumps');
});

t('Arrow: jump captures on path; safe stop protects; starter still out', () => {
  const st = L.newGame([H, A(), null, null], {}, 4, 'arrow');
  assert.strictEqual(st.pieces[0][0], 0, 'starter token already on start');
  st.pieces[0][0] = 3;
  st.pieces[1][0] = L.posFromAbs(1, 6);
  const mid = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.ok(mid.captures.some(c => c.seat === 1 && c.piece === 0), 'captures rival on jump path');
  st.pieces[1][0] = L.posFromAbs(1, 8);
  const stopSafe = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.strictEqual(stopSafe.captures.length, 0, 'safe square on stop protects');
  const unsafe = L.newGame([H, A(), null, null], { safeSquares: false }, 4, 'arrow');
  unsafe.pieces[0][0] = 3;
  unsafe.pieces[1][0] = L.posFromAbs(1, 8);
  const stopHit = L.legalMoves(unsafe, 0, 1).find(m => m.piece === 0);
  assert.ok(stopHit.captures.some(c => c.seat === 1), 'stop captures when safe squares are off');
  st.pieces[1][0] = L.posFromAbs(1, 4);
  const onArrow = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.ok(onArrow.captures.some(c => c.seat === 1), 'landing on arrow captures a rival sitting there');
  // Pass-over must NOT capture via jump
  st.pieces[0][0] = 0;
  st.pieces[1][0] = L.posFromAbs(1, 6);
  const noJumpCap = L.legalMoves(st, 0, 5).find(m => m.piece === 0);
  assert.strictEqual(noJumpCap.to, 5);
  assert.strictEqual(noJumpCap.captures.length, 0, 'passing over arrow does not jump-capture');
});

t('Friendly and the noCapture rule never capture', () => {
  const st = L.newGame([null, A(), null, H], {}, 5, 'friendly');
  assert.ok(st.rules.noCapture);
  const abs = L.absOf(3, 6);
  st.pieces[3][0] = 5;
  st.pieces[1][0] = L.posFromAbs(1, abs);
  const m = L.legalMoves(st, 3, 1).find(x => x.piece === 0);
  assert.ok(m && m.to === 6);
  assert.strictEqual(m.captures.length, 0);
  const off = L.newGame([null, A(), null, H], { noCapture: true }, 5, 'classic');
  off.pieces[3][0] = 5; off.pieces[1][0] = L.posFromAbs(1, abs);
  assert.strictEqual(L.legalMoves(off, 3, 1)[0].captures.length, 0);
});

t('Team Ludo: partners opposite, shared win, partner is not captured', () => {
  assert.throws(() => L.newGame([null, A(), null, H], {}, 1, 'team'));
  const st = L.newGame([A('hard'), A('easy'), A('medium'), H], {}, 9, 'team');
  assert.strictEqual(L.partnerOf(0), 2);
  assert.strictEqual(L.teamOf(1), L.teamOf(3));
  const abs = 5;
  st.pieces[0][0] = L.posFromAbs(0, abs - 1);
  st.pieces[2][0] = L.posFromAbs(2, abs);
  const onto = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.strictEqual(onto.captures.length, 0, 'cannot capture a partner');
  st.pieces[0] = [L.HOME, L.HOME, L.HOME, L.HOME];
  st.pieces[2] = [L.HOME, L.HOME, L.HOME, 56];
  st.pieces[1][0] = L.HOME; st.pieces[1][1] = L.HOME; st.pieces[1][2] = L.HOME; st.pieces[1][3] = L.HOME;
  st.ranking = [1];
  st.turn = 2; st.phase = 'roll'; st.queue = []; st.sixes = 0; st.bonus = 0;
  const r = L.roll(st, 1);
  assert.strictEqual(r.next, 'move');
  const done = L.move(st, 3, 1);
  assert.strictEqual(done.over, true);
  assert.strictEqual(L.teamOf(st.ranking[0]), 0);
  assert.strictEqual(L.teamOf(st.ranking[1]), 0);
  assert.ok(st.ranking.indexOf(1) > 1, 'an opponent who finished earlier is not the winner');
});

function sims(mode, seats, n) {
  let rolls = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const st = L.simulate(seats, {}, 20000 + i * 17, 80000, mode);
    assert.strictEqual(st.phase, 'over', mode + ' game ' + i + ' did not finish');
    assert.strictEqual(st.ranking.length, seats.filter(Boolean).length);
    rolls += st.rolls; max = Math.max(max, st.rolls);
    if (mode === 'friendly') st.players.forEach(s => assert.strictEqual(st.stats[s].captures, 0));
    if (mode === 'team') assert.strictEqual(L.teamOf(st.ranking[0]), L.teamOf(st.ranking[1]));
    if (mode === 'quick') assert.strictEqual(st.nPieces, 2);
  }
  return { rolls: rolls / n, max };
}

t(GAMES + ' Quick games (1v1) all end', () => {
  const r = sims('quick', [null, A('hard'), null, A('easy')], GAMES);
  console.log('     quick avg', r.rolls.toFixed(0), 'rolls, max', r.max);
  assert.ok(r.rolls < 140, 'quick matches should be clearly shorter than 4-token games');
});
t(GAMES + ' Team games all end with a shared team win', () => {
  const r = sims('team', [A('hard'), A('medium'), A('easy'), A('hard')], GAMES);
  console.log('     team avg', r.rolls.toFixed(0), 'rolls, max', r.max);
});
t(GAMES + ' Arrow games all end', () => {
  const r = sims('arrow', [null, A('medium'), null, A('hard')], GAMES);
  console.log('     arrow avg', r.rolls.toFixed(0), 'rolls, max', r.max);
});
t('Arrow: Hard still beats Easy in a short series', () => {
  const N = Math.min(80, GAMES);
  let hardWins = 0;
  for (let i = 0; i < N; i++) {
    const st = L.simulate([null, A('hard'), null, A('easy')], {}, 90000 + i * 31, 80000, 'arrow');
    assert.strictEqual(st.phase, 'over');
    if (st.ranking[0] === 1) hardWins++;
  }
  console.log('     arrow Hard vs Easy: Hard won', hardWins, '/', N);
  assert.ok(hardWins >= Math.ceil(N * 0.55), 'Hard should still win a clear majority vs Easy with Arrow jumps');
});
t(GAMES + ' Friendly games all end with zero captures', () => {
  const r = sims('friendly', [A('easy'), A('hard'), null, A('medium')], GAMES);
  console.log('     friendly avg', r.rolls.toFixed(0), 'rolls, max', r.max);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
