// Rules, Mystery Tiles events, AI and simulation tests. Run: node test/logic.test.js   (GAMES=200 for a quicker run)
const assert = require('assert');
const L = require('../www/js/logic.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok -', name); } catch (e) { fail++; console.log('  FAIL -', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); } }
const H = { type: 'human' }, AI = (level) => ({ type: 'ai', level });
const two = (rules, mode) => L.newGame([H, null, AI('hard'), null], rules, 42, mode);
const four = (rules, mode) => L.newGame([H, AI('easy'), AI('medium'), AI('hard')], rules, 42, mode);
function setup(st, pieces) { pieces.forEach((p, s) => { if (p && st.pieces[s]) st.pieces[s] = p.slice(); }); return st; }
const pos = (st, seat, abs) => L.posFromAbs(seat, abs);

console.log('logic.test.js');
// ---------- basics ----------
t('track geometry: 52 unique track cells, 4 home columns of 5, start/star squares safe', () => {
  const k = new Set(L.TRACK_CELLS.map(c => c.join(','))); assert.strictEqual(k.size, 52);
  L.HOME_COLS.forEach(c => assert.strictEqual(c.length, 5));
  [0, 13, 26, 39, 8, 21, 34, 47].forEach(a => assert.ok(L.isSafeAbs(a))); assert.ok(!L.isSafeAbs(5));
  assert.strictEqual(L.absOf(1, 0), 13); assert.strictEqual(L.posFromAbs(1, 13), 0); assert.strictEqual(L.posFromAbs(3, 2), 15);
});
t('default rules: Star style, safe squares on, capture-to-enter off, blocks off, capture & home bonus on', () => {
  assert.deepStrictEqual(L.normRules({}), { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true });
  assert.strictEqual(L.normRules({ rollStyle: 'x' }).rollStyle, 'star');
});
t('needs at least two players', () => { assert.throws(() => L.newGame([H, null, null, null], {}, 1)); });
t('a token leaves base only on a 6', () => {
  const st = two();
  for (let v = 1; v <= 5; v++) assert.strictEqual(L.legalMoves(st, 0, v).length, 0);
  const m = L.legalMoves(st, 0, 6); assert.strictEqual(m.length, 4); assert.ok(m.every(x => x.leave && x.to === 0));
});
t('no 6 with everything in base: the turn passes', () => {
  const st = two(); const r = L.roll(st, 3); assert.strictEqual(r.next, 'pass'); assert.strictEqual(st.turn, 2); assert.strictEqual(st.phase, 'roll');
});
// ---------- Star style roll queue ----------
t('Star style: a 6 gives another roll immediately and values stack (6, 6, 3)', () => {
  const st = two();
  let r = L.roll(st, 6); assert.ok(r.again); assert.strictEqual(st.phase, 'roll'); assert.deepStrictEqual(st.queue, [6]);
  r = L.roll(st, 6); assert.strictEqual(st.phase, 'roll'); assert.deepStrictEqual(st.queue, [6, 6]);
  r = L.roll(st, 3); assert.strictEqual(st.phase, 'move'); assert.deepStrictEqual(st.queue, [6, 6, 3]);
  // 3 can't be used yet (all in base), only the 6s
  assert.ok(st.moves.every(m => m.v === 6));
  L.move(st, 0, 6); assert.deepStrictEqual(st.queue, [6, 3]);
  assert.ok(st.moves.some(m => m.v === 3 && m.piece === 0 && m.to === 3), 'the 3 is now usable on the new token');
  L.move(st, 0, 3); assert.deepStrictEqual(st.queue, [6]); assert.strictEqual(st.pieces[0][0], 3);
  L.move(st, 1, 6); assert.strictEqual(st.pieces[0][1], 0); assert.strictEqual(st.turn, 2, 'queue spent, turn passes');
});
t('Star style: the player picks which token uses which value (any order)', () => {
  const st = setup(two(), [[5, 20, -1, -1]]);
  L.roll(st, 6); L.roll(st, 2);
  const opts = st.moves.map(m => m.piece + ':' + m.v).sort();
  assert.deepStrictEqual(opts, ['0:2', '0:6', '1:2', '1:6', '2:6', '3:6']);
  L.move(st, 1, 2); assert.strictEqual(st.pieces[0][1], 22); assert.deepStrictEqual(st.queue, [6]);
  L.move(st, 0, 6); assert.strictEqual(st.pieces[0][0], 11);
});
t('Star style: unusable values in the queue are dropped', () => {
  const st = setup(two(), [[54, -1, -1, -1]]); // token needs exactly 3
  L.roll(st, 6); L.roll(st, 5); // 5 overshoots, 6 can leave base
  L.move(st, 1, 6); // 5 still usable on the new token
  assert.ok(st.moves.some(m => m.v === 5)); L.move(st, 1, 5); assert.strictEqual(st.turn, 2);
});
t('three 6s in a row forfeit the whole turn and the queue', () => {
  const st = setup(two(), [[10, -1, -1, -1]]);
  L.roll(st, 6); L.roll(st, 6); const r = L.roll(st, 6);
  assert.ok(r.forfeit); assert.deepStrictEqual(r.lost, [6, 6]); assert.strictEqual(st.turn, 2); assert.strictEqual(st.pieces[0][0], 10); assert.deepStrictEqual(st.queue, []);
});
t('Classic style: each roll is moved first; a 6 gives another roll after moving', () => {
  const st = two({ rollStyle: 'classic' });
  const r = L.roll(st, 6); assert.strictEqual(st.phase, 'move'); assert.deepStrictEqual(st.queue, [6]); assert.ok(r.again);
  L.move(st, 0); assert.strictEqual(st.phase, 'roll'); assert.strictEqual(st.turn, 0, 'rolls again');
  L.roll(st, 4); L.move(st, 0); assert.strictEqual(st.turn, 2);
});
t('Classic style: three 6s in a row also forfeit the turn', () => {
  const st = setup(two({ rollStyle: 'classic' }), [[10, -1, -1, -1]]);
  L.roll(st, 6); L.move(st, 0); L.roll(st, 6); L.move(st, 0); const r = L.roll(st, 6);
  assert.ok(r.forfeit); assert.strictEqual(st.turn, 2); assert.strictEqual(st.pieces[0][0], 22);
});
t('a 6 with no possible move still gives the extra roll (classic)', () => {
  const st = setup(two({ rollStyle: 'classic' }), [[53, 57, 57, 57]]); // needs 4 exactly
  const r = L.roll(st, 6); assert.strictEqual(r.next, 'again'); assert.strictEqual(st.turn, 0); assert.strictEqual(st.phase, 'roll');
});
// ---------- captures, bonuses, safe squares ----------
t('capture sends the rival token to base and grants a bonus roll', () => {
  const st = setup(two(), [[10, -1, -1, -1], null, [pos(null, 2, 14), -1, -1, -1]]);
  L.roll(st, 4); assert.strictEqual(st.moves[0].captures.length, 1);
  const r = L.move(st, 0, 4); assert.strictEqual(r.captures.length, 1); assert.strictEqual(st.pieces[2][0], -1);
  assert.strictEqual(st.turn, 0); assert.strictEqual(st.phase, 'roll', 'bonus roll'); assert.strictEqual(st.stats[0].captures, 1);
});
t('capture bonus can be switched off', () => {
  const st = setup(two({ bonusOnCapture: false }), [[10, -1, -1, -1], null, [pos(null, 2, 14), -1, -1, -1]]);
  L.roll(st, 4); L.move(st, 0, 4); assert.strictEqual(st.turn, 2);
});
t('bonus rolls wait until the queue is spent (capture with the first value)', () => {
  const st = setup(two(), [[10, 30, -1, -1], null, [pos(null, 2, 16), -1, -1, -1]]);
  L.roll(st, 6); L.roll(st, 2);
  L.move(st, 0, 6); assert.strictEqual(st.pieces[2][0], -1); assert.strictEqual(st.bonus, 1); assert.strictEqual(st.phase, 'move');
  L.move(st, 1, 2); assert.strictEqual(st.phase, 'roll'); assert.strictEqual(st.turn, 0); assert.strictEqual(st.sixes, 0, 'bonus roll starts a fresh 6 count');
});
t('a token reaching home grants a bonus roll (toggle)', () => {
  let st = setup(two(), [[54, 10, -1, -1]]); L.roll(st, 3); const r = L.move(st, 0, 3);
  assert.ok(r.finish); assert.strictEqual(st.pieces[0][0], 57); assert.strictEqual(st.turn, 0); assert.strictEqual(st.phase, 'roll');
  st = setup(two({ bonusOnHome: false }), [[54, 10, -1, -1]]); L.roll(st, 3); L.move(st, 0, 3); assert.strictEqual(st.turn, 2);
});
t('safe squares: no capture on start or star squares; tokens share the square', () => {
  const st = setup(two(), [[4, -1, -1, -1], null, [pos(null, 2, 8), -1, -1, -1]]);
  L.roll(st, 4); assert.strictEqual(st.moves[0].captures.length, 0); L.move(st, 0, 4);
  assert.strictEqual(st.pieces[2][0], pos(null, 2, 8)); assert.strictEqual(st.turn, 2);
});
t('safe squares off: captures happen on stars too', () => {
  const st = setup(two({ safeSquares: false }), [[4, -1, -1, -1], null, [pos(null, 2, 8), -1, -1, -1]]);
  L.roll(st, 4); assert.strictEqual(st.moves[0].captures.length, 1);
});
t('leaving base onto a rival on your start square: safe by default, captured with safe squares off', () => {
  let st = setup(two({ rollStyle: 'classic' }), [[-1, -1, -1, -1], null, [pos(null, 2, 0), -1, -1, -1]]);
  L.roll(st, 6); assert.strictEqual(st.moves[0].captures.length, 0);
  st = setup(two({ safeSquares: false, rollStyle: 'classic' }), [[-1, -1, -1, -1], null, [pos(null, 2, 0), -1, -1, -1]]);
  L.roll(st, 6); assert.strictEqual(st.moves[0].captures.length, 1);
});
// ---------- home column ----------
t('exact roll needed to reach home', () => {
  const st = setup(two(), [[53, 57, 57, 57]]);
  for (let v = 1; v <= 6; v++) { const m = L.legalMoves(st, 0, v); if (v <= 4) assert.strictEqual(m.length, 1); else assert.strictEqual(m.length, 0); }
  assert.ok(L.legalMoves(st, 0, 4)[0].finish);
});
t('home column entry: from the last track square, 2 lands on the 2nd home-column square and 6 reaches home', () => {
  const st = setup(two(), [[50, -1, -1, -1]]);
  const m = L.legalMoves(st, 0, 2)[0]; assert.strictEqual(m.to, 53); assert.ok(m.entersHomeColumn);
  assert.ok(L.legalMoves(st, 0, 6)[0].finish); assert.strictEqual(L.legalMoves(st, 0, 7).length, 0);
});
t('capture-to-enter rule: without a capture the token keeps circling, after a capture it may enter', () => {
  const st = setup(two({ captureToEnter: true }), [[49, -1, -1, -1]]);
  const m = L.legalMoves(st, 0, 3)[0]; assert.deepStrictEqual(m.path, [50, 51, 0]); assert.strictEqual(m.to, 0);
  st.capd[0] = true; assert.strictEqual(L.legalMoves(st, 0, 3)[0].to, 53);
});
// ---------- blocks ----------
t('blocks rule: two tokens of one colour block rivals from passing or landing', () => {
  const blk = pos(null, 2, 12);
  const st = setup(two({ blocks: true }), [[10, -1, -1, -1], null, [blk, blk, -1, -1]]);
  assert.strictEqual(L.legalMoves(st, 0, 1).length, 1, 'stop before the block');
  assert.strictEqual(L.legalMoves(st, 0, 2).length, 0, 'cannot land on the block');
  assert.strictEqual(L.legalMoves(st, 0, 5).length, 0, 'cannot pass the block');
  const st2 = setup(two({ blocks: false }), [[10, -1, -1, -1], null, [blk, blk, -1, -1]]);
  assert.strictEqual(L.legalMoves(st2, 0, 5).length, 1); assert.strictEqual(L.legalMoves(st2, 0, 2)[0].captures.length, 2, 'without blocks both are captured');
});
t('blocks rule: a block on your start square stops you leaving base', () => {
  const s0 = pos(null, 2, 0);
  const st = setup(two({ blocks: true }), [[-1, -1, -1, -1], null, [s0, s0, -1, -1]]);
  assert.strictEqual(L.legalMoves(st, 0, 6).length, 0);
});
// ---------- finishing / ranking ----------
t('finishing all four tokens ranks the player and ends a 2-player match', () => {
  const st = setup(two(), [[55, 57, 57, 57]]); L.roll(st, 2); const r = L.move(st, 0, 2);
  assert.ok(r.finishedPlayer); assert.ok(r.over); assert.deepStrictEqual(st.ranking, [0, 2]);
});
t('4 players: the match goes on after the first finisher; ends when every human is done', () => {
  const st = setup(four(), [[57, 57, 57, 55]]); L.roll(st, 2); L.move(st, 3, 2);
  assert.strictEqual(st.phase, 'over', 'only human finished, the rest are ranked by progress'); assert.strictEqual(st.ranking.length, 4); assert.strictEqual(st.ranking[0], 0);
  const all = L.newGame([AI('hard'), AI('hard'), AI('hard'), AI('hard')], {}, 5);
  setup(all, [[57, 57, 57, 55]]); L.roll(all, 2); L.move(all, 3, 2); assert.strictEqual(all.phase, 'roll'); assert.strictEqual(all.turn, 1);
});
t('illegal moves are rejected', () => {
  const st = two({ rollStyle: 'classic' }); assert.throws(() => L.move(st, 0)); L.roll(st, 6); assert.throws(() => L.move(st, 0, 3)); assert.throws(() => L.roll(st));
});
// ---------- Mystery Tiles ----------
function mystery(rules) { return L.newGame([H, AI('hard'), AI('hard'), AI('hard')], rules, 7, 'mystery'); }
function trigger(ev, pieces, token, kind) {
  // token of seat 0 lands on a tile (abs 4 boost / 10 chaos) with a 2 from abs 2 / 8
  const st = setup(mystery(), pieces || [[kind === 'chaos' ? 8 : 2, -1, -1, -1]]);
  L.roll(st, 2); const r = L.move(st, token || 0, 2, ev); return { st, r };
}
t('mystery mode: 4 Boost (?) and 4 Chaos (!) tiles, never on safe squares; classic mode has none', () => {
  const st = mystery(); assert.strictEqual(st.tiles.length, 8); assert.ok(st.tiles.every(x => !L.isSafeAbs(x.abs)));
  assert.strictEqual(two().tiles.length, 0);
});
t('landing on a tile spins its wheel; the tile then recharges for two rounds', () => {
  const { st, r } = trigger('extra');
  assert.ok(r.event); assert.strictEqual(r.event.kind, 'boost'); assert.strictEqual(r.event.event, 'extra'); assert.strictEqual(r.event.index, L.WHEELS.boost.indexOf('extra'));
  assert.strictEqual(L.tileAt(st, 4, 0), null, 'tile is recharging');
  st.turnCount += 8; assert.ok(L.tileAt(st, 4, 0));
});
t('passing over a tile does nothing; only ending on it counts', () => {
  const st = setup(mystery(), [[2, -1, -1, -1]]); L.roll(st, 3); const r = L.move(st, 0, 3); assert.strictEqual(r.event, null);
});
t('event Extra roll: one more roll this turn', () => { const { st } = trigger('extra'); assert.strictEqual(st.turn, 0); assert.strictEqual(st.phase, 'roll'); });
t('event Shield: token cannot be captured until the end of its owner\'s next turn', () => {
  const { st } = trigger('shield'); assert.ok(L.isShielded(st, 0, 0)); assert.strictEqual(st.turn, 1);
  const s1 = L.posFromAbs(1, 1); st.pieces[1][0] = s1; L.roll(st, 3); assert.strictEqual(st.moves.find(m => m.piece === 0).captures.length, 0, 'no capture on a shielded token');
  // shield survives rivals' turns and ends after seat 0's next turn
  while (st.turn !== 0) { if (st.phase === 'roll') L.roll(st, 1); else L.move(st, st.moves[0].piece, st.moves[0].v); }
  assert.ok(L.isShielded(st, 0, 0)); L.roll(st, 1); if (st.phase === 'move') L.move(st, st.moves[0].piece, st.moves[0].v);
  assert.ok(!L.isShielded(st, 0, 0));
});
t('event Jump +3: token jumps 3 forward (and captures on landing)', () => {
  const victim = L.posFromAbs(1, 7); const { st, r } = trigger('jump3', [[2, -1, -1, -1], [victim, -1, -1, -1]]);
  assert.strictEqual(st.pieces[0][0], 7); assert.strictEqual(r.event.captures.length, 1); assert.strictEqual(st.pieces[1][0], -1);
});
t('event Double die: next roll counts double (a 3 moves 6)', () => {
  const { st } = trigger('double'); assert.strictEqual(st.boost[0], 'double');
  st.phase = 'roll'; st.turn = 0; st.queue = []; const r = L.roll(st, 3); assert.strictEqual(r.value, 6); assert.ok(st.moves.some(m => m.v === 6 && m.to === 10));
});
t('event Pick a number: next roll is chosen (1..6); AI picks sensibly', () => {
  const { st } = trigger('choose'); assert.strictEqual(st.boost[0], 'choose');
  st.phase = 'roll'; st.turn = 0; st.queue = []; assert.ok(L.mustChoose(st));
  const v = L.chooseDieValue(st, 0, 'hard'); assert.ok(v >= 1 && v <= 6);
  const r = L.roll(st, 5); assert.strictEqual(r.raw, 5); assert.ok(r.chosen); assert.strictEqual(st.boost[0], null);
  // AI picks the capture
  const st2 = setup(mystery(), [[10, 57, 57, 57], [L.posFromAbs(1, 14), -1, -1, -1]]); st2.boost[0] = 'choose';
  assert.strictEqual(L.chooseDieValue(st2, 0, 'hard'), 4);
});
t('event Freeze: nearest rival token ahead cannot move on its next turn, then thaws', () => {
  const tgt = L.posFromAbs(1, 9); const { st, r } = trigger('freeze', [[2, -1, -1, -1], [tgt, -1, -1, -1]]);
  assert.deepStrictEqual(r.event.target, { seat: 1, piece: 0 }); assert.ok(L.isFrozen(st, 1, 0));
  assert.strictEqual(st.turn, 1); L.roll(st, 3); assert.ok(!st.moves.some(m => m.piece === 0), 'frozen token has no moves');
  assert.ok(!L.isFrozen(st, 1, 0), 'thawed after its turn');
});
t('event Back 3: token slides back 3 squares', () => { const { st } = trigger('back3', null, 0, 'chaos'); assert.strictEqual(st.pieces[0][0], 7); });
t('event Swap: token swaps with the nearest rival token', () => {
  const rv = L.posFromAbs(3, 12); const { st, r } = trigger('swap', [[8, -1, -1, -1], null, null, [rv, -1, -1, -1]], 0, 'chaos');
  assert.strictEqual(st.pieces[0][0], 12); assert.strictEqual(st.pieces[3][0], L.posFromAbs(3, 10)); assert.strictEqual(r.event.to, 12);
});
t('event Zap: nearest rival within 3 squares goes back to base, never on a safe square', () => {
  let rv = L.posFromAbs(3, 12); let o = trigger('zap', [[8, -1, -1, -1], null, null, [rv, -1, -1, -1]], 0, 'chaos');
  assert.strictEqual(o.st.pieces[3][0], -1); assert.strictEqual(o.r.event.event, 'zap');
  rv = L.posFromAbs(3, 8); o = trigger('zap', [[8, -1, -1, -1], null, null, [rv, -1, -1, -1]], 0, 'chaos'); // rival on a star: zap not possible
  assert.notStrictEqual(o.r.event.event, 'zap'); assert.strictEqual(o.st.pieces[3][0], rv);
});
t('event Stuck: own token cannot move during the next turn', () => {
  const { st } = trigger('frozen', [[8, 30, -1, -1]], 0, 'chaos'); assert.ok(L.isFrozen(st, 0, 0));
  while (st.turn !== 0) { if (st.phase === 'roll') L.roll(st, 1); else L.move(st, st.moves[0].piece, st.moves[0].v); }
  L.roll(st, 2); assert.ok(st.moves.every(m => m.piece !== 0));
});
t('event Jump +6 and Calm', () => {
  let o = trigger('jump6', null, 0, 'chaos'); assert.strictEqual(o.st.pieces[0][0], 16);
  o = trigger('calm', null, 0, 'chaos'); assert.strictEqual(o.st.pieces[0][0], 10); assert.strictEqual(o.st.turn, 1);
});
t('events without a valid target are never picked (wheel lands on a valid one)', () => {
  for (let seed = 1; seed < 200; seed++) {
    const st = L.newGame([H, AI('hard'), null, null], {}, seed, 'mystery'); st.pieces[0][0] = 8; L.roll(st, 2); const r = L.move(st, 0, 2);
    assert.ok(['freeze', 'zap', 'swap'].indexOf(r.event.event) < 0, r.event.event + ' had no target');
  }
});
t('every event can come up; wheels have 6 segments', () => {
  assert.strictEqual(L.WHEELS.boost.length, 6); assert.strictEqual(L.WHEELS.chaos.length, 6);
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const g = L.simulate([AI('hard'), AI('medium'), AI('easy'), AI('hard')], {}, 900 + i, 30000, 'mystery');
    void g;
  }
  // count via direct spins with targets available
  for (let seed = 1; seed < 400; seed++) {
    const st = setup(L.newGame([H, AI('hard'), null, null], {}, seed, 'mystery'), [[8, -1, -1, -1], [L.posFromAbs(1, 11), -1, -1, -1]]);
    L.roll(st, 2); seen.add(L.move(st, 0, 2).event.event);
    const st2 = setup(L.newGame([H, AI('hard'), null, null], {}, seed, 'mystery'), [[2, -1, -1, -1], [L.posFromAbs(1, 9), -1, -1, -1]]);
    L.roll(st2, 2); seen.add(L.move(st2, 0, 2).event.event);
  }
  assert.deepStrictEqual([...seen].sort(), [...L.WHEELS.boost, ...L.WHEELS.chaos].sort());
});
// ---------- AI ----------
t('AI always returns a legal move (all levels, random positions, both styles, mystery)', () => {
  for (let i = 0; i < 400; i++) {
    const st = L.newGame([AI('easy'), AI('medium'), AI('hard'), AI('hard')], { rollStyle: i % 2 ? 'classic' : 'star', blocks: i % 3 === 0 }, i + 1, i % 2 ? 'mystery' : 'classic');
    for (let s = 0; s < 4; s++) for (let k = 0; k < 4; k++) st.pieces[s][k] = [-1, 5, 20, 33, 49, 53, 57][(i * 7 + s * 3 + k * 5) % 7];
    L.roll(st, 6); if (st.phase === 'roll') L.roll(st, 1 + (i % 5));
    if (st.phase !== 'move') continue;
    for (const lv of L.LEVELS) { const c = L.chooseMove(st, lv); assert.ok(st.moves.some(m => m.piece === c.piece && m.v === c.v), lv); }
  }
});
t('Hard AI prefers a capture', () => {
  const st = setup(two(), [[10, 30, -1, -1], null, [L.posFromAbs(2, 14), -1, -1, -1]]); st.turn = 0;
  L.roll(st, 4); assert.deepStrictEqual(L.chooseMove(st, 'hard'), { piece: 0, v: 4 });
});
t('Hard AI prefers bringing a token home', () => {
  const st = setup(two(), [[53, 20, -1, -1]]); L.roll(st, 4); assert.strictEqual(L.chooseMove(st, 'hard').piece, 0);
});
t('Hard AI moves to a safe square instead of into danger', () => {
  // token A at 4 can reach star 8 with 4; token B at 25 with 4 lands 2 in front of a rival
  const st = setup(two(), [[4, 25, -1, -1], null, [L.posFromAbs(2, 27), -1, -1, -1]]);
  L.roll(st, 4); assert.strictEqual(L.chooseMove(st, 'hard').piece, 0);
});
t('Hard AI escapes a token under threat', () => {
  const st = setup(two(), [[20, 40, -1, -1], null, [L.posFromAbs(2, 17), -1, -1, -1]]);
  L.roll(st, 1); assert.strictEqual(L.chooseMove(st, 'hard').piece, 0, 'moves the threatened token onto the star at 21');
});
t('Hard AI forms a protective block when blocks are on', () => {
  // both tokens are threatened by the rival 2 behind; joining them makes a block that protects both
  const st = setup(two({ blocks: true, rollStyle: 'classic' }), [[15, 18, -1, -1], null, [L.posFromAbs(2, 13), -1, -1, -1]]);
  L.roll(st, 3); assert.strictEqual(L.chooseMove(st, 'hard').piece, 0);
});
t('Hard AI heads for a Boost tile when nothing better is on', () => {
  const st = setup(mystery(), [[1, 30, -1, -1]]); st.pieces[1] = [-1, -1, -1, -1]; st.pieces[2] = [-1, -1, -1, -1]; st.pieces[3] = [-1, -1, -1, -1];
  L.roll(st, 3); assert.strictEqual(L.chooseMove(st, 'hard').piece, 0);
});
function duel(a, b, n, rules, mode) {
  let w = 0;
  for (let i = 0; i < n; i++) { const sw = i % 2, seats = [null, null, null, null]; seats[0] = AI(sw ? b : a); seats[2] = AI(sw ? a : b); const st = L.simulate(seats, rules, 1000 + i, 30000, mode); if ((st.ranking[0] === 0) !== !!sw) w++; }
  return w / n;
}
t('stronger AI wins more often (2-player, 400 games each, classic + mystery)', () => {
  const he = duel('hard', 'easy', 400, {}), hm = duel('hard', 'medium', 400, {}), me = duel('medium', 'easy', 400, {}), hmy = duel('hard', 'easy', 400, {}, 'mystery');
  console.log('     win rates: hard>easy', he.toFixed(2), 'hard>normal', hm.toFixed(2), 'normal>easy', me.toFixed(2), 'hard>easy (mystery)', hmy.toFixed(2));
  assert.ok(he > 0.7 && hm > 0.6 && me > 0.55 && hmy > 0.65);
});
t('Mystery Tiles is fair between seats (4 equal Hard AIs, 400 games)', () => {
  const wins = [0, 0, 0, 0];
  for (let i = 0; i < 400; i++) wins[L.simulate([AI('hard'), AI('hard'), AI('hard'), AI('hard')], {}, 5000 + i, 30000, 'mystery').ranking[0]]++;
  console.log('     seat wins', wins.join(' / '));
  assert.ok(wins.every(w => w > 60 && w < 150));
});
// ---------- full simulations ----------
const GAMES = +process.env.GAMES || 1000;
t(GAMES + ' full AI-vs-AI games (both modes, 2-4 players, all levels, all rule combinations) always end with a winner', () => {
  const lv = L.LEVELS; let rolls = 0, maxRolls = 0, events = 0;
  const byMode = { classic: 0, mystery: 0 }, byN = { 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < GAMES; i++) {
    const n = 2 + (i % 3), seats = [null, null, null, null];
    const idx = n === 2 ? (i % 2 ? [1, 3] : [0, 2]) : n === 3 ? [0, 1, 3] : [0, 1, 2, 3];
    idx.forEach((s, k) => { seats[s] = AI(lv[(i + k) % 3]); });
    const rules = { rollStyle: (i >> 1) % 2 ? 'classic' : 'star', safeSquares: i % 5 !== 0, captureToEnter: i % 7 === 0, blocks: i % 4 === 0, bonusOnCapture: i % 6 !== 0, bonusOnHome: i % 9 !== 0 };
    const mode = (i >> 2) % 2 ? 'mystery' : 'classic';
    const st = L.simulate(seats, rules, 7919 * (i + 1), 30000, mode);
    assert.strictEqual(st.phase, 'over', 'game ' + i + ' did not finish');
    assert.strictEqual(st.ranking.length, n); assert.strictEqual(new Set(st.ranking).size, n);
    const w = st.ranking[0]; assert.ok(st.pieces[w].every(p => p === L.HOME), 'winner has all tokens home');
    st.pieces.forEach(pc => pc && pc.forEach(p => assert.ok(p >= -1 && p <= L.HOME)));
    rolls += st.rolls; maxRolls = Math.max(maxRolls, st.rolls); byMode[mode]++; byN[n]++;
    events += st.stats.reduce((a, s) => a + (s ? s.events : 0), 0);
  }
  console.log('     avg rolls', (rolls / GAMES).toFixed(0), 'max', maxRolls, '| classic', byMode.classic, 'mystery', byMode.mystery, '| 2p', byN[2], '3p', byN[3], '4p', byN[4], '| events', events);
});
t('dice are fair (60k rolls)', () => {
  const st = two(), c = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60000; i++) c[L.rollDie(st)]++;
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(c[f] / 60000 - 1 / 6) < 0.01, 'face ' + f);
});
t('state survives a JSON round trip mid-game (save/resume)', () => {
  const st = L.newGame([H, AI('hard'), AI('hard'), AI('hard')], {}, 99, 'mystery');
  for (let k = 0; k < 150 && st.phase !== 'over'; k++) { if (st.phase === 'roll') L.roll(st); else { const c = L.chooseMove(st, 'hard'); L.move(st, c.piece, c.v); } }
  const c = L.clone(st); assert.deepStrictEqual(c, st); if (c.phase === 'roll') { L.roll(c, 3); L.roll(st, 3); assert.deepStrictEqual(c, st); }
});
t('coins are cosmetic rewards by place; XP levels', () => {
  assert.strictEqual(L.coinsFor(1, 4, ['hard']), 50); assert.strictEqual(L.coinsFor(2, 2, ['easy']), 10); assert.strictEqual(L.coinsFor(1, 2, ['medium'], 'mystery'), 50);
  assert.deepStrictEqual(L.levelFromXp(0), { level: 1, into: 0, need: 100 }); assert.strictEqual(L.levelFromXp(100).level, 2); assert.ok(L.xpFor(1, 4) > L.xpFor(2, 4));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
