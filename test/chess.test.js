'use strict';
const assert = require('node:assert/strict');
const Chess = require('../www/js/chess.js');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function move(state, from, to, promotion) { return Chess.applyMove(state, { from, to, promotion: promotion || null }); }
function pos(pieces, turn = 0, castling = '', ep = -1) {
  const state = Chess.initialState();
  state.board = '.'.repeat(64).split('');
  Object.entries(pieces).forEach(([sq, piece]) => { state.board[Number(sq)] = piece; });
  state.board = state.board.join('');
  state.turn = turn;
  state.castling = castling;
  state.en_passant = ep;
  state.position_history = [Chess.positionKey(state)];
  return state;
}
const has = (state, from, to, promotion) => Chess.legalMoves(state, from).some(m => m.to === to && (m.promotion || null) === (promotion || null));

const initial = Chess.initialState();
ok(initial.board.length === 64 && initial.turn === 0 && Chess.legalMoves(initial).length === 20, 'initial board has the standard 20 legal white moves');
ok(has(initial, 52, 36) && !has(initial, 52, 28), 'pawns may advance one or two from their start rank, not three');
let afterE4 = move(initial, 52, 36);
ok(afterE4.turn === 1 && afterE4.en_passant === 44 && afterE4.board[36] === 'P', 'double pawn move records the en-passant target and changes turn');

let mate = Chess.initialState();
mate = move(mate, 53, 45); // f3
mate = move(mate, 12, 28); // ... e5
mate = move(mate, 54, 38); // g4
mate = move(mate, 3, 39);  // ... Qh4#
ok(mate.phase === 'over' && mate.result === 'checkmate' && mate.winner === 1 && mate.check, 'Scholar’s Mate ends with a black checkmate win');

let castle = pos({ 60: 'K', 63: 'R', 56: 'R', 4: 'k' }, 0, 'KQ');
ok(has(castle, 60, 62) && has(castle, 60, 58), 'both castling sides are legal when rights and paths are clear');
castle = move(castle, 60, 62);
ok(castle.board[62] === 'K' && castle.board[61] === 'R' && castle.board[63] === '.' && !castle.castling, 'castling moves the rook and removes both white castling rights');
const attackedCastle = pos({ 60: 'K', 63: 'R', 4: 'k', 5: 'r' }, 0, 'K');
ok(!has(attackedCastle, 60, 62), 'castling through an attacked square is illegal');

let ep = Chess.initialState();
ep = move(ep, 52, 36); // e4
 ep = move(ep, 8, 16);  // ... a6
 ep = move(ep, 36, 28); // e5
 ep = move(ep, 11, 27); // ... d5
ok(ep.en_passant === 19 && has(ep, 28, 19), 'en-passant capture is offered only on the immediately following turn');
ep = move(ep, 28, 19);
ok(ep.board[19] === 'P' && ep.board[27] === '.' && ep.halfmove === 0, 'en-passant removes the captured pawn and resets the halfmove clock');

const promotion = pos({ 8: 'P', 7: 'k', 60: 'K' });
ok(['q', 'r', 'b', 'n'].every(p => has(promotion, 8, 0, p)) && !has(promotion, 8, 0, null), 'promotion requires a choice among queen, rook, bishop, and knight');
ok(move(promotion, 8, 0, 'n').board[0] === 'N', 'underpromotion changes the pawn into the selected piece');

const pinned = pos({ 60: 'K', 52: 'R', 4: 'r', 0: 'k' });
ok(!has(pinned, 52, 48), 'a pinned piece cannot expose its own king to check');
const stalemateBefore = pos({ 7: 'k', 13: 'K', 30: 'Q' });
ok(has(stalemateBefore, 30, 22), 'queen can move to the stalemate net');
const stalemated = move(stalemateBefore, 30, 22);
ok(stalemated.phase === 'over' && stalemated.result === 'stalemate' && stalemated.winner === null, 'a position with no legal moves and no check is a draw');

let repetition = Chess.initialState();
for (let cycle = 0; cycle < 2; cycle++) {
  repetition = move(repetition, 62, 45); // Nf3
  repetition = move(repetition, 6, 21);  // ... Nf6
  repetition = move(repetition, 45, 62); // Ng1
  repetition = move(repetition, 21, 6);  // ... Ng8
}
ok(Chess.repetitions(repetition) === 3 && Chess.canClaimDraw(repetition), 'threefold repetition permits a draw claim');
ok(Chess.claimDraw(repetition).result === 'draw_threefold_claim', 'the current player can claim threefold repetition');
const fiftyMove = Chess.initialState();
fiftyMove.halfmove = 100;
ok(Chess.canClaimDraw(fiftyMove) && Chess.claimDraw(fiftyMove).result === 'draw_fifty_move_claim', 'the 50-move rule allows a valid draw claim');
const seventyFive = Chess.initialState();
seventyFive.halfmove = 149;
const autoDraw = move(seventyFive, 62, 45);
ok(autoDraw.phase === 'over' && autoDraw.result === 'draw_seventy_five_moves', 'the 75-move rule ends the game automatically');
ok(Chess.insufficientMaterial(pos({ 60: 'K', 4: 'k' }).board), 'king versus king is insufficient material');
console.log('\nLudo Chess rules tests passed (' + checks + ' checks).');
