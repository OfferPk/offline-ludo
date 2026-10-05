// v1.6.1: bestAutoMove prefers kill → open yard with 6 → AI heuristic.
'use strict';
const assert = require('node:assert/strict');
const L = require('../www/js/logic.js');

const H = { type: 'human' };
const AI = { type: 'ai', level: 'hard' };

function base() {
  const st = L.newGame([H, null, AI, null], {}, 7, 'classic');
  for (let s = 0; s < 4; s++) if (st.pieces[s]) st.pieces[s] = st.pieces[s].map(() => -1);
  return st;
}

console.log('best-auto-move.test.js');

// 1. Prefer a capture over a non-capturing advance when both dice are legal.
{
  const st = base();
  // Seat 0 token on track; seat 2 victim 4 ahead → die 4 kills. Also a 6 that only advances.
  st.pieces[0][0] = 10;
  st.pieces[2][0] = L.posFromAbs(2, L.absOf(0, 10) + 4);
  st.phase = 'move';
  st.queue = [6, 4];
  st.moves = L.queueMoves(st);
  assert.ok(st.moves.some(m => m.v === 4 && m.captures.length), '4-kill available');
  assert.ok(st.moves.some(m => m.v === 6 && !m.captures.length), '6 advance available');
  const c = L.bestAutoMove(st, 'hard', () => 0);
  assert.equal(c.v, 4, 'auto-play prefers the kill die');
  assert.ok(st.moves.find(m => m.piece === c.piece && m.v === c.v).captures.length, 'chosen move captures');
  console.log('  ok - prefers kill with either die');
}

// 2. Prefer opening from yard with a 6 when no kills exist.
{
  const st = base();
  st.pieces[0][0] = -1; // in yard
  st.pieces[0][1] = 8;  // on track
  st.phase = 'move';
  st.queue = [6, 3];
  st.moves = L.queueMoves(st);
  assert.ok(st.moves.some(m => m.leave && m.v === 6), '6 can leave yard');
  assert.ok(!st.moves.some(m => m.captures.length), 'no kills in this fixture');
  const c = L.bestAutoMove(st, 'hard', () => 0);
  assert.equal(c.v, 6);
  assert.ok(st.moves.find(m => m.piece === c.piece && m.v === c.v).leave, 'opens from yard');
  console.log('  ok - prefers open from yard with 6');
}

// 3. Falls back to chooseMove heuristic when neither kill nor yard-6 applies.
{
  const st = base();
  st.pieces[0][0] = 5;
  st.pieces[0][1] = 12;
  st.phase = 'move';
  st.queue = [2, 3];
  st.moves = L.queueMoves(st);
  assert.ok(st.moves.length >= 2);
  assert.ok(!st.moves.some(m => m.captures.length || (m.leave && m.v === 6)));
  const c = L.bestAutoMove(st, 'hard', () => 0);
  const expected = L.chooseMove(st, 'hard', () => 0);
  assert.deepEqual(c, expected, 'falls back to hard AI choice');
  console.log('  ok - falls back to AI heuristic');
}

// 4. chooseMove accepts an optional pool without mutating st.moves
{
  const st = base();
  st.pieces[0][0] = 5;
  st.phase = 'move';
  st.queue = [2, 4];
  st.moves = L.queueMoves(st);
  const before = st.moves.slice();
  const only = st.moves.filter(m => m.v === 2);
  const c = L.chooseMove(st, 'hard', () => 0, only);
  assert.equal(c.v, 2);
  assert.equal(st.moves.length, before.length, 'st.moves unchanged');
  console.log('  ok - chooseMove pool arg leaves st.moves intact');
}

console.log('best-auto-move checks passed');
