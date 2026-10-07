'use strict';
const assert = require('node:assert/strict');
const Chess = require('../www/js/chess.js');
const Review = require('../www/js/online-chess-review.js');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function move(state, from, to, promotion) { return Chess.applyMove(state, { from, to, promotion: promotion || null }); }

let state = Chess.initialState();
for (const [from, to] of [[52, 36], [12, 28], [62, 45]]) state = move(state, from, to);
const original = JSON.stringify(state);
const timeline = Review.createTimeline(state, Chess);
ok(timeline.complete, 'a complete, verified server history produces a review timeline');
ok(timeline.positions.length === 4 && timeline.moves.length === 3, 'the timeline includes the starting position and one position per ply');
ok(timeline.positions[0].board[52] === 'P' && timeline.positions[0].board[36] === '.', 'the first position is the standard starting board');
ok(timeline.positions[1].board[36] === 'P' && timeline.positions[1].board[52] === '.', 'the first reviewed position reflects Red e2–e4');
ok(timeline.positions[2].board[28] === 'p' && timeline.positions[2].board[12] === '.', 'the second reviewed position reflects Blue e7–e5');
ok(timeline.positions[3].board[45] === 'N' && timeline.positions[3].last_move.to === 45, 'the current timeline position reproduces the latest move');
ok(JSON.stringify(state) === original, 'building a review timeline never mutates authoritative match state');

let promoted = Chess.initialState();
for (const [from, to, promotion] of [[53, 37], [14, 22], [37, 29], [6, 21], [29, 22], [15, 23], [22, 14], [23, 31], [14, 6, 'q']]) {
  promoted = move(promoted, from, to, promotion || null);
}
const promotionTimeline = Review.createTimeline(promoted, Chess);
ok(promotionTimeline.complete && promotionTimeline.positions.at(-1).board[6] === 'Q' && promotionTimeline.moves.at(-1).promotion === 'q', 'verified review positions preserve a pawn promotion and its chosen piece');

const partial = JSON.parse(original);
partial.position_history = partial.position_history.slice(1);
const incomplete = Review.createTimeline(partial, Chess);
ok(!incomplete.complete && incomplete.positions.length === 0, 'partial server history never produces guessed review positions');

const corrupt = JSON.parse(original);
corrupt.board = '.' + corrupt.board.slice(1);
const invalid = Review.createTimeline(corrupt, Chess);
ok(!invalid.complete && invalid.positions.length === 0, 'a board that disagrees with its history is not reviewable');

const unavailable = Review.createTimeline(state, null);
ok(!unavailable.complete && unavailable.positions.length === 0, 'missing Chess support fails closed without creating a timeline');

console.log('\nOnline Chess review tests passed (' + checks + ' checks).');
