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

t('Arrow: landing or passing both ride one extra clockwise square', () => {
  const st = L.newGame([H, A(), null, null], {}, 4, 'arrow');
  assert.ok(st.rules.arrows);
  assert.strictEqual(st.pieces[0][0], 0);
  assert.deepStrictEqual(L.legalMoves(st, 0, 1).find(m => m.from === -1), undefined);
  assert.deepStrictEqual(L.ARROW_SQUARES, [4, 17, 30, 43]);
  st.pieces[0][0] = 3;
  const land = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.deepStrictEqual(land.path, [4, 5], 'landing on board number 4 rides to 5');
  st.pieces[0][0] = 2;
  const pass = L.legalMoves(st, 0, 2).find(m => m.piece === 0);
  assert.deepStrictEqual(pass.path, [3, 4, 5], 'passing through board number 4 also rides to 5');
  const classic = L.newGame([H, A(), null, null], { arrows: true }, 4, 'classic');
  classic.pieces[0][0] = 3;
  assert.deepStrictEqual(L.legalMoves(classic, 0, 1)[0].path, [4, 5], 'arrow house rule works in classic');
});


t('Arrow fair play: forced ride never captures; arrow tiles are safe; trailing leaves on 5', () => {
  const st = L.newGame([H, A(), null, null], {}, 4, 'arrow');
  // Place rival on the square after seat 0 arrow (abs 4 -> ride to abs 5)
  const afterArrowAbs = 5;
  st.pieces[0][0] = 3; // one step from own relative arrow at 4
  st.pieces[1][0] = L.posFromAbs(1, afterArrowAbs);
  const dump = L.legalMoves(st, 0, 1).find(m => m.piece === 0);
  assert.ok(dump, 'move still legal');
  assert.deepStrictEqual(dump.path, [4], 'ride cancelled — stay on arrow instead of capturing');
  assert.strictEqual(dump.to, 4);
  assert.strictEqual(dump.captures.length, 0, 'no capture from forced ride');
  // Token resting on arrow is safe
  st.pieces[0][0] = 4;
  st.pieces[1][0] = L.posFromAbs(1, L.absOf(0, 3)); // rival one behind arrow
  // rival at abs of seat0 pos 3 — better: put attacker on abs just before arrow
  const arrowAbs = 4;
  st.pieces[1][0] = L.posFromAbs(1, (arrowAbs - 1 + 52) % 52);
  const ontoArrow = L.legalMoves(st, 1, 1).find(m => m.piece === 0);
  assert.ok(ontoArrow);
  assert.strictEqual(ontoArrow.captures.length, 0, 'cannot capture a token resting on an arrow tile');
  // Classic + arrows house rule still captures on ride (unchanged)
  const classic = L.newGame([H, A(), null, null], { arrows: true }, 4, 'classic');
  classic.pieces[0][0] = 3;
  classic.pieces[1][0] = L.posFromAbs(1, afterArrowAbs);
  const classicRide = L.legalMoves(classic, 0, 1).find(m => m.piece === 0);
  assert.deepStrictEqual(classicRide.path, [4, 5], 'classic house-rule arrows still ride');
  assert.ok(classicRide.captures.length >= 1, 'classic house-rule ride may still capture');
  // Trailing: make seat 0 clearly behind so comebackLevel >= 1
  const behind = L.newGame([H, A(), null, null], {}, 11, 'arrow');
  behind.pieces[0] = [0, -1, -1, -1];
  behind.pieces[1] = [40, 35, 30, 25]; // leader far ahead
  assert.ok(L.comebackLevel(behind, 0) >= 1, 'seat 0 is behind');
  assert.ok(L.legalMoves(behind, 0, 5).some(m => m.leave), 'trailing Arrow player leaves base on a 5');
  assert.ok(!L.legalMoves(behind, 1, 5).some(m => m.leave), 'leader still needs a 6');
  const even = L.newGame([H, A(), null, null], {}, 4, 'classic');
  even.pieces[0] = [-1, -1, -1, -1];
  assert.strictEqual(L.legalMoves(even, 0, 5).length, 0, 'classic unchanged: 5 never leaves');
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
t('Arrow fair play: Hard still beats Easy in a short series', () => {
  const N = Math.min(80, GAMES);
  let hardWins = 0;
  for (let i = 0; i < N; i++) {
    const st = L.simulate([null, A('hard'), null, A('easy')], {}, 90000 + i * 31, 80000, 'arrow');
    assert.strictEqual(st.phase, 'over');
    if (st.ranking[0] === 1) hardWins++;
  }
  console.log('     arrow Hard vs Easy: Hard won', hardWins, '/', N);
  assert.ok(hardWins >= Math.ceil(N * 0.55), 'Hard should still win a clear majority vs Easy under Arrow fair play');
});
t(GAMES + ' Friendly games all end with zero captures', () => {
  const r = sims('friendly', [A('easy'), A('hard'), null, A('medium')], GAMES);
  console.log('     friendly avg', r.rolls.toFixed(0), 'rolls, max', r.max);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
