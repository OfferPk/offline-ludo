// Rules, AI and simulation tests. Run: node test/logic.test.js   (GAMES=200 for a quicker run)
const assert = require('assert');
const L = require('../www/js/logic.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); } }
const H = { type: 'human' }, AI = lv => ({ type: 'ai', level: lv });
const two = (rules) => L.newGame([H, null, AI('hard'), null], rules, 7);
const four = (rules) => L.newGame([H, AI('easy'), AI('medium'), AI('hard')], rules, 7);
const at = (st, seat, arr) => { st.pieces[seat] = arr.slice(); };
const turnOf = (st, seat) => { st.turn = seat; st.phase = 'roll'; st.sixes = 0; };

console.log('logic.test.js');

// ---------------- board geometry ----------------
t('track has 52 distinct squares and 4 home columns of 5', () => {
  assert.strictEqual(new Set(L.TRACK_CELLS.map(String)).size, 52);
  L.HOME_COLS.forEach(c => assert.strictEqual(c.length, 5));
  const all = new Set(L.TRACK_CELLS.map(String)); L.HOME_COLS.flat().forEach(c => assert.ok(!all.has(String(c)), 'home column overlaps track'));
});
t('each seat starts 13 squares after the previous one and its last track square is next to its home column', () => {
  for (let s = 0; s < 4; s++) {
    assert.strictEqual(L.absOf(s, 0), 13 * s);
    const last = L.cellOf(s, 50), first = L.cellOf(s, 51);
    assert.strictEqual(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]), 1);
  }
});
t('consecutive track squares are neighbours (orthogonal, or the diagonal corner step)', () => {
  for (let i = 0; i < 52; i++) { const a = L.TRACK_CELLS[i], b = L.TRACK_CELLS[(i + 1) % 52]; assert.ok(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1, 'gap at ' + i); }
});

// ---------------- move generation ----------------
t('needs a 6 to leave base', () => {
  const st = two();
  for (let v = 1; v <= 5; v++) assert.strictEqual(L.legalMoves(st, 0, v).length, 0);
  const m = L.legalMoves(st, 0, 6); assert.strictEqual(m.length, 4); m.forEach(x => { assert.strictEqual(x.to, 0); assert.ok(x.leave); });
});
t('pieces on the track move by the die value', () => {
  const st = two(); at(st, 0, [5, -1, 20, 56]);
  const m = L.legalMoves(st, 0, 4);
  assert.deepStrictEqual(m.map(x => [x.piece, x.from, x.to]), [[0, 5, 9], [2, 20, 24]]);
});
t('finished pieces never move', () => { const st = two(); at(st, 0, [56, 56, 56, 50]); assert.deepStrictEqual(L.legalMoves(st, 0, 6).map(x => x.piece), [3]); });
t('no legal move passes the turn to the next player', () => {
  const st = two(); const r = L.roll(st, 3);
  assert.ok(r.passed); assert.strictEqual(st.turn, 2); assert.strictEqual(st.phase, 'roll');
});

// ---------------- exact home entry ----------------
t('exact roll needed to reach home', () => {
  const st = two(); at(st, 0, [53, -1, -1, -1]);
  assert.strictEqual(L.legalMoves(st, 0, 4).length, 0, 'overshoot not allowed');
  assert.strictEqual(L.legalMoves(st, 0, 3)[0].to, 56);
  assert.ok(L.legalMoves(st, 0, 3)[0].finish);
  assert.strictEqual(L.legalMoves(st, 0, 2)[0].to, 55);
});
t('entering the home column from the last track square', () => {
  const st = two(); at(st, 0, [48, -1, -1, -1]);
  const m = L.legalMoves(st, 0, 4)[0]; assert.strictEqual(m.to, 52); assert.ok(m.entersHomeColumn);
});
t('pieces in the home column cannot be captured', () => {
  const st = two(); at(st, 0, [52, -1, -1, -1]);
  for (let p = 0; p <= 50; p++) for (let v = 1; v <= 6; v++) { at(st, 2, [p, -1, -1, -1]); L.legalMoves(st, 2, v).forEach(m => assert.strictEqual(m.captures.length, 0)); }
});
t('all four pieces home finishes the player and ends a 2-player match', () => {
  const st = two(); at(st, 0, [56, 56, 56, 54]);
  L.roll(st, 2); const r = L.move(st, 3);
  assert.ok(r.finishedPlayer); assert.ok(r.over); assert.strictEqual(st.phase, 'over'); assert.deepStrictEqual(st.ranking, [0, 2]);
});

// ---------------- captures ----------------
t('landing on an opponent sends it back to base', () => {
  const st = two(); at(st, 0, [10, -1, -1, -1]);
  // seat 2's progress p is at absolute (p + 26) % 52; absolute 14 = seat 2 progress 40
  at(st, 2, [40, -1, -1, -1]);
  L.roll(st, 4); const r = L.move(st, 0);
  assert.strictEqual(r.captures.length, 1); assert.strictEqual(st.pieces[2][0], -1); assert.strictEqual(st.pieces[0][0], 14);
  assert.strictEqual(st.stats[0].captures, 1); assert.strictEqual(st.stats[2].captured, 1);
});
t('a capture gives an extra roll (rule on) and not when off', () => {
  let st = two(); at(st, 0, [10, -1, -1, -1]); at(st, 2, [40, -1, -1, -1]);
  L.roll(st, 4); let r = L.move(st, 0); assert.ok(r.extraTurn); assert.strictEqual(st.turn, 0);
  st = two({ extraOnCapture: false }); at(st, 0, [10, -1, -1, -1]); at(st, 2, [40, -1, -1, -1]);
  L.roll(st, 4); r = L.move(st, 0); assert.ok(!r.extraTurn); assert.strictEqual(st.turn, 2);
});
t('own pieces can share a square and are never captured by their owner', () => {
  const st = two(); at(st, 0, [10, 14, -1, -1]);
  const m = L.legalMoves(st, 0, 4).find(x => x.piece === 0); assert.strictEqual(m.captures.length, 0);
});
t('all opponent pieces on the landing square are captured (several colours)', () => {
  const st = four({ safeSquares: false }); at(st, 0, [10, -1, -1, -1]);
  at(st, 1, [1, -1, -1, -1]); at(st, 3, [27, -1, -1, -1]); // abs 14 for seat 1 (1+13) and seat 3 (27+39=66%52=14)
  const m = L.legalMoves(st, 0, 4)[0]; assert.strictEqual(m.captures.length, 2);
});

// ---------------- safe squares ----------------
t('safe squares: start squares and stars protect pieces (rule on)', () => {
  const st = two(); at(st, 0, [4, -1, -1, -1]);
  at(st, 2, [34, -1, -1, -1]); // abs (34+26)%52 = 8, a star
  assert.ok(L.isSafeAbs(8)); assert.strictEqual(L.legalMoves(st, 0, 4)[0].captures.length, 0);
  at(st, 2, [39, -1, -1, -1]); // abs 13 = seat 1's start square
  at(st, 0, [9, -1, -1, -1]); assert.strictEqual(L.legalMoves(st, 0, 4)[0].captures.length, 0);
});
t('safe squares off: the same landings capture', () => {
  const st = two({ safeSquares: false }); at(st, 0, [4, -1, -1, -1]); at(st, 2, [34, -1, -1, -1]);
  assert.strictEqual(L.legalMoves(st, 0, 4)[0].captures.length, 1);
});
t('leaving base captures a piece on the start square only when safe squares are off', () => {
  let st = two(); at(st, 2, [26, -1, -1, -1]); // abs 0 = seat 0 start
  assert.strictEqual(L.legalMoves(st, 0, 6).find(m => m.leave).captures.length, 0);
  st = two({ safeSquares: false }); at(st, 2, [26, -1, -1, -1]);
  assert.strictEqual(L.legalMoves(st, 0, 6).find(m => m.leave).captures.length, 1);
});
t('safe square list: 4 starts + 4 stars', () => {
  assert.deepStrictEqual([...Array(52).keys()].filter(L.isSafeAbs), [0, 8, 13, 21, 26, 34, 39, 47]);
});

// ---------------- sixes ----------------
t('a 6 gives another roll (rule on)', () => {
  const st = two(); L.roll(st, 6); const r = L.move(st, 0); assert.ok(r.extraTurn); assert.strictEqual(st.turn, 0); assert.strictEqual(st.phase, 'roll');
});
t('extra turn on 6 off: the turn passes after the move', () => {
  const st = two({ extraOnSix: false }); L.roll(st, 6); const r = L.move(st, 0); assert.ok(!r.extraTurn); assert.strictEqual(st.turn, 2);
});
t('three 6s in a row forfeit the turn (no move on the third)', () => {
  const st = two(); at(st, 0, [5, -1, -1, -1]);
  L.roll(st, 6); L.move(st, 0); L.roll(st, 6); L.move(st, 0);
  assert.strictEqual(st.pieces[0][0], 17);
  const r = L.roll(st, 6); assert.ok(r.forfeit); assert.strictEqual(st.turn, 2); assert.strictEqual(st.pieces[0][0], 17); assert.strictEqual(st.sixes, 0);
});
t('the six counter resets on a new turn', () => {
  const st = two(); at(st, 0, [5, -1, -1, -1]); L.roll(st, 6); L.move(st, 0); L.roll(st, 6); L.move(st, 0); L.roll(st, 2); L.move(st, 0);
  assert.strictEqual(st.turn, 2); assert.strictEqual(st.sixes, 0);
});
t('a 6 with no legal move still earns the extra roll', () => {
  const st = two(); at(st, 0, [56, 56, 56, 53]); const r = L.roll(st, 6); assert.ok(!r.passed); assert.strictEqual(st.turn, 0); assert.strictEqual(st.phase, 'roll');
});
t('with extra turn on 6 off, three 6s are just three normal turns', () => {
  const st = two({ extraOnSix: false }); at(st, 0, [5, -1, -1, -1]);
  for (let k = 0; k < 3; k++) { turnOf(st, 0); const r = L.roll(st, 6); assert.ok(!r.forfeit); L.move(st, 0); }
});

// ---------------- turn order / match end ----------------
t('turns go clockwise through active seats only', () => {
  const st = L.newGame([H, null, AI('easy'), AI('easy')], {}, 3); const order = [];
  for (let k = 0; k < 6; k++) { order.push(st.turn); L.roll(st, 1); }
  assert.deepStrictEqual(order, [0, 2, 3, 0, 2, 3]);
});
t('match ends when every human has finished; the rest ranked by progress', () => {
  const st = L.newGame([H, AI('easy'), AI('easy'), AI('easy')], {}, 3);
  at(st, 0, [56, 56, 56, 55]); at(st, 1, [10, -1, -1, -1]); at(st, 2, [30, 20, -1, -1]); at(st, 3, [-1, -1, -1, -1]);
  L.roll(st, 1); const r = L.move(st, 3); assert.ok(r.over); assert.deepStrictEqual(st.ranking, [0, 2, 1, 3]);
});
t('pass & play: humans only, the match continues until one player is left', () => {
  const st = L.newGame([H, H, H, null], {}, 3); at(st, 0, [56, 56, 56, 55]);
  L.roll(st, 1); L.move(st, 3); assert.strictEqual(st.phase, 'roll'); assert.strictEqual(st.turn, 1);
});
t('newGame needs at least 2 players', () => { assert.throws(() => L.newGame([H, null, null, null], {}, 1)); });

// ---------------- AI ----------------
t('every AI level always returns a legal piece', () => {
  for (const lv of L.LEVELS) for (let seed = 1; seed <= 200; seed++) {
    const st = L.newGame([AI(lv), AI(lv), AI(lv), AI(lv)], {}, seed);
    for (let k = 0; k < 200 && st.phase !== 'over'; k++) {
      if (st.phase === 'roll') { L.roll(st); continue; }
      const p = L.chooseMove(st, lv); assert.ok(st.moves.some(m => m.piece === p)); L.move(st, p);
    }
  }
});
t('hard AI takes a capture', () => {
  const st = two(); turnOf(st, 2); at(st, 2, [2, 30, -1, -1]); at(st, 0, [5, -1, -1, -1]); // seat0 p5 = abs 5; seat2 p31 = abs 5
  L.roll(st, 1); assert.strictEqual(L.chooseMove(st, 'hard'), 1);
});
t('hard AI brings a piece home when it can', () => {
  const st = two(); turnOf(st, 2); at(st, 2, [53, 10, -1, -1]); L.roll(st, 3); assert.strictEqual(L.chooseMove(st, 'hard'), 0);
});
t('hard AI prefers a safe square over a square an opponent can hit', () => {
  const st = two(); turnOf(st, 2);
  // seat 2 pieces at progress 4 (abs 30) and 12 (abs 38); roll 4 -> abs 34 (star, safe) or abs 42 (seat-0 piece 3 behind at abs 39? no: put it at abs 40)
  at(st, 2, [4, 12, -1, -1]); at(st, 0, [40, -1, -1, -1]); // seat0 abs 40
  L.roll(st, 4); // piece 0 -> 8 (abs 34 star), piece 1 -> 16 (abs 42, 2 in front of the seat-0 piece)
  assert.strictEqual(L.chooseMove(st, 'hard'), 0);
});
t('hard AI moves a threatened piece out of danger', () => {
  const st = two(); turnOf(st, 2);
  at(st, 2, [20, 2, -1, -1]); // p20 = abs 46; p2 = abs 28
  at(st, 0, [43, -1, -1, -1]); // seat0 abs 43: 3 behind abs 46
  L.roll(st, 1); // piece 0 -> abs 47 (star) escapes; piece 1 -> abs 29 (nothing)
  assert.strictEqual(L.chooseMove(st, 'hard'), 0);
});
t('hard AI does not step right in front of an opponent when a quiet move exists', () => {
  const st = two({ safeSquares: false }); turnOf(st, 2);
  at(st, 2, [2, 30, -1, -1]); // abs 28 and abs 4
  at(st, 0, [30, -1, -1, -1]); // seat0 abs 30
  L.roll(st, 3); // piece 0 -> abs 31 (1 ahead of the opponent, exposed); piece 1 -> abs 7 (quiet)
  assert.strictEqual(L.chooseMove(st, 'hard'), 1);
});
t('hard AI leaves base on a 6 when nothing better is available', () => {
  const st = two(); turnOf(st, 2); at(st, 2, [-1, -1, -1, 3]); L.roll(st, 6); const p = L.chooseMove(st, 'hard'); assert.ok(st.pieces[2][p] === -1);
});
t('stronger AI wins more often (2-player, 600 games each)', () => {
  function duel(a, b, N) { let w = 0; for (let i = 0; i < N; i++) { const sw = i % 2; const st = L.simulate([AI(sw ? b : a), null, AI(sw ? a : b), null], {}, 5000 + i); if ((st.ranking[0] === 0) !== (sw === 1)) w++; } return w / N; }
  const he = duel('hard', 'easy', 600), hm = duel('hard', 'medium', 600), me = duel('medium', 'easy', 600);
  console.log('     win rates: hard>easy', he.toFixed(2), 'hard>medium', hm.toFixed(2), 'medium>easy', me.toFixed(2));
  assert.ok(he > 0.7 && hm > 0.55 && me > 0.55);
});
t('distinctMoves collapses identical moves (auto-move when only one real choice)', () => {
  const st = two(); const m = L.legalMoves(st, 0, 6); assert.strictEqual(m.length, 4); assert.strictEqual(L.distinctMoves(m).length, 1);
});

// ---------------- simulations ----------------
const GAMES = +process.env.GAMES || 1000;
t(GAMES + ' full AI-vs-AI games (2-4 players, all levels, all rule combinations) always terminate', () => {
  let rolls = 0, maxRolls = 0;
  for (let i = 0; i < GAMES; i++) {
    const n = 2 + (i % 3), seats = [0, 1, 2, 3].map(s => AI(L.LEVELS[(i + s * 7) % 3]));
    if (n === 2) { seats[1 + (i % 2)] = null; seats[3 - (i % 2)] = null; }
    if (n === 3) seats[i % 4] = null;
    const rules = { safeSquares: !!(i & 1), extraOnSix: !!(i & 2), extraOnCapture: !!(i & 4) };
    const st = L.simulate(seats, rules, 1 + i * 7919, 20000);
    assert.strictEqual(st.phase, 'over', 'game ' + i + ' did not end');
    const players = seats.map((x, k) => x ? k : -1).filter(k => k >= 0);
    assert.deepStrictEqual([...st.ranking].sort(), players.sort(), 'ranking lists every player once');
    const w = st.ranking[0]; assert.ok(st.pieces[w].every(p => p === 56), 'winner has all pieces home');
    // no piece in an impossible place
    st.pieces.forEach(pc => pc && pc.forEach(p => assert.ok(p >= -1 && p <= 56)));
    rolls += st.rolls; maxRolls = Math.max(maxRolls, st.rolls);
  }
  console.log('     avg rolls', (rolls / GAMES).toFixed(0), 'max', maxRolls);
});
t('simulations are deterministic for a seed', () => {
  const seats = [AI('hard'), AI('easy'), null, AI('medium')];
  assert.deepStrictEqual(L.simulate(seats, {}, 99).pieces, L.simulate(seats, {}, 99).pieces);
});
t('game state survives a JSON round trip mid-game (save / resume)', () => {
  const st = L.newGame([H, AI('hard'), AI('easy'), null], {}, 42);
  for (let k = 0; k < 60 && st.phase !== 'over'; k++) { if (st.phase === 'roll') L.roll(st); else L.move(st, L.chooseMove(st, 'medium')); }
  const copy = JSON.parse(JSON.stringify(st)); const a = L.simulate, b = st;
  const finish = s => { while (s.phase !== 'over' && s.rolls < 20000) { if (s.phase === 'roll') L.roll(s); else L.move(s, L.chooseMove(s, 'medium')); } return s; };
  assert.deepStrictEqual(finish(copy).ranking, finish(b).ranking); void a;
});
t('dice are fair-ish (60k rolls, each face 16.7% +/- 1%)', () => {
  const st = { rng: 12345 }, c = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60000; i++) c[L.rollDie(st)]++;
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(c[f] / 60000 - 1 / 6) < 0.01, 'face ' + f);
});
t('coins are cosmetic rewards by placement', () => {
  assert.strictEqual(L.coinsFor(1, 4, ['easy']), 40); assert.strictEqual(L.coinsFor(1, 2, ['hard']), 50); assert.strictEqual(L.coinsFor(2, 2, ['hard']), 10); assert.strictEqual(L.coinsFor(4, 4, []), 6);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
