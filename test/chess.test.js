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
const square = name => (8 - Number(name[1])) * 8 + name.charCodeAt(0) - 97;
const san = (state, from, to, promotion) => Chess.sanForMove(state, { from, to, promotion: promotion || null });

const initial = Chess.initialState();
ok(initial.board.length === 64 && initial.turn === 0 && Chess.legalMoves(initial).length === 20, 'initial board has the standard 20 legal white moves');
ok(has(initial, 52, 36) && !has(initial, 52, 28), 'pawns may advance one or two from their start rank, not three');
let afterE4 = move(initial, 52, 36);
ok(afterE4.turn === 1 && afterE4.en_passant === 44 && afterE4.board[36] === 'P', 'double pawn move records the en-passant target and changes turn');
ok(san(initial, square('e2'), square('e4')) === 'e4', 'SAN omits the piece letter for a quiet pawn move');

let recorded = Chess.initialState();
const recordedSan = [];
for (const [from, to] of [[square('e2'), square('e4')], [square('e7'), square('e5')], [square('g1'), square('f3')]]) {
  recordedSan.push(san(recorded, from, to));
  recorded = move(recorded, from, to);
}
ok(recordedSan.join(' ') === 'e4 e5 Nf3', 'SAN uses piece letters and follows the actual side to move');
const fullHistory = Chess.movesFromPositionHistory(recorded);
ok(fullHistory.complete && fullHistory.moves.map(entry => entry.number + ':' + entry.color + ':' + entry.san).join('|') === '1:0:e4|1:1:e5|2:0:Nf3', 'complete server snapshots replay as numbered SAN plies');
const pgn = Chess.exportPgn(recorded, { red: 'Red Player', blue: 'Blue Player' });
ok(pgn.includes('[White "Red Player"]') && pgn.includes('[Black "Blue Player"]') && pgn.endsWith('1. e4 e5 2. Nf3 *\n'), 'PGN exports valid tags, move numbering, and the ongoing-game result');
ok(Chess.exportPgn(Chess.initialState()).endsWith('*\n'), 'a verified initial position exports an empty game with the ongoing result');

const fileAmbiguous = pos({ [square('e1')]: 'K', [square('e8')]: 'k', [square('b1')]: 'N', [square('f1')]: 'N' });
ok(san(fileAmbiguous, square('b1'), square('d2')) === 'Nbd2', 'SAN disambiguates same-kind pieces by file when possible');
const rankAmbiguous = pos({ [square('e1')]: 'K', [square('e8')]: 'k', [square('d2')]: 'N', [square('d4')]: 'N' });
ok(san(rankAmbiguous, square('d2'), square('f3')) === 'N2f3', 'SAN disambiguates same-file pieces by rank');
const fileAndRankAmbiguous = pos({ [square('a1')]: 'K', [square('h8')]: 'k', [square('f3')]: 'N', [square('f5')]: 'N', [square('b3')]: 'N' });
ok(san(fileAndRankAmbiguous, square('f3'), square('d4')) === 'Nf3d4', 'SAN uses both file and rank when neither alone disambiguates');

let mate = Chess.initialState();
mate = move(mate, 53, 45); // f3
mate = move(mate, 12, 28); // ... e5
mate = move(mate, 54, 38); // g4
ok(san(mate, 3, 39) === 'Qh4#', 'SAN marks checkmate with a hash suffix');
mate = move(mate, 3, 39);  // ... Qh4#
ok(mate.phase === 'over' && mate.result === 'checkmate' && mate.winner === 1 && mate.check, 'Scholar’s Mate ends with a black checkmate win');
ok(Chess.exportPgn(mate).endsWith('1. f3 e5 2. g4 Qh4# 0-1\n'), 'PGN records a checkmate result after the final SAN move');

let castle = pos({ 60: 'K', 63: 'R', 56: 'R', 4: 'k' }, 0, 'KQ');
ok(has(castle, 60, 62) && has(castle, 60, 58), 'both castling sides are legal when rights and paths are clear');
ok(san(castle, 60, 62) === 'O-O' && san(castle, 60, 58) === 'O-O-O', 'both castling directions use standard SAN notation');
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
ok(san(ep, 28, 19) === 'exd6', 'SAN formats en-passant captures as a pawn capture on the destination square');
ep = move(ep, 28, 19);
ok(ep.board[19] === 'P' && ep.board[27] === '.' && ep.halfmove === 0, 'en-passant removes the captured pawn and resets the halfmove clock');

const promotion = pos({ 8: 'P', 7: 'k', 60: 'K' });
const promotionChoices = ['q', 'r', 'b', 'n'];
for (const scenario of [
  { color: 0, from: square('a7'), to: square('a8'), pieces: { [square('a7')]: 'P', [square('e1')]: 'K', [square('e8')]: 'k' }, coord: 'a8' },
  { color: 1, from: square('h2'), to: square('h1'), pieces: { [square('h2')]: 'p', [square('e1')]: 'K', [square('e8')]: 'k' }, coord: 'h1' }
]) {
  const promotionState = pos(scenario.pieces, scenario.color);
  ok(promotionChoices.every(piece => has(promotionState, scenario.from, scenario.to, piece)) && !has(promotionState, scenario.from, scenario.to, null), `${scenario.color === 0 ? 'Red' : 'Blue'} promotion requires an explicit choice among all four pieces`);
  for (const choice of promotionChoices) {
    const promoted = move(promotionState, scenario.from, scenario.to, choice);
    const expectedPiece = scenario.color === 0 ? choice.toUpperCase() : choice;
    ok(promoted.board[scenario.to] === expectedPiece && promoted.last_move.promotion === choice, `${scenario.color === 0 ? 'Red' : 'Blue'} can promote to ${choice.toUpperCase()} with the correct board color and recorded choice`);
    ok(san(promotionState, scenario.from, scenario.to, choice).startsWith(scenario.coord + '=' + choice.toUpperCase()), `SAN records ${scenario.coord}=${choice.toUpperCase()} for ${scenario.color === 0 ? 'Red' : 'Blue'}`);
  }
}
assert.throws(() => move(promotion, 8, 0), /not legal/, 'promotion cannot silently default to a queen');
assert.throws(() => move(promotion, 8, 0, 'king'), /not legal/, 'promotion rejects a piece outside queen, rook, bishop, and knight');
assert.throws(() => move(Chess.initialState(), square('e2'), square('e4'), 'n'), /not legal/, 'non-promotion moves reject an extraneous promotion choice');
checks += 3;

function verifyPromotionReplay(color, choice) {
  const line = color === 0
    ? [[53, 37], [14, 22], [37, 29], [6, 21], [29, 22], [15, 23], [22, 14], [23, 31], [14, 6, choice]]
    : [[55, 39], [14, 30], [39, 30], [15, 31], [62, 45], [31, 39], [54, 38], [39, 47], [63, 62], [47, 55], [52, 44], [55, 63, choice]];
  let replay = Chess.initialState();
  for (const [from, to, promotionChoice] of line) replay = move(replay, from, to, promotionChoice || null);
  const history = Chess.movesFromPositionHistory(replay);
  const expectedSan = (color === 0 ? 'g8=' : 'h1=') + choice.toUpperCase();
  ok(history.complete, `${color === 0 ? 'Red' : 'Blue'} ${choice.toUpperCase()} promotion replays as complete verified server history`);
  ok(history.moves.at(-1).san.startsWith(expectedSan), `replayed SAN preserves ${expectedSan}`);
  const pgn = Chess.exportPgn(replay);
  ok(pgn.includes(history.moves.at(-1).san) && pgn.endsWith('*\n'), `PGN preserves the ${color === 0 ? 'Red' : 'Blue'} ${choice.toUpperCase()} promotion without inventing a result`);
}
for (const choice of promotionChoices) {
  verifyPromotionReplay(0, choice);
  verifyPromotionReplay(1, choice);
}

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

const openingReply = Chess.chooseComputerMove(Chess.initialState());
ok(openingReply && Chess.legalMoves(Chess.initialState(), openingReply.from).some(candidate => candidate.to === openingReply.to && (candidate.promotion || null) === (openingReply.promotion || null)), 'the local computer chooses a legal opening move from the shared Chess rules');
const hangingQueen = pos({ 0: 'r', 7: 'k', 56: 'Q', 63: 'K' }, 1);
const tacticalReply = Chess.chooseComputerMove(hangingQueen);
ok(tacticalReply && tacticalReply.from === 0 && tacticalReply.to === 56, 'the local computer takes a safely capturable queen');
ok(Chess.chooseComputerMove(mate) === null, 'the local computer does not move after checkmate');

let partial = move(move(Chess.initialState(), square('e2'), square('e4')), square('e7'), square('e5'));
partial.position_history = partial.position_history.slice(1);
const partialHistory = Chess.movesFromPositionHistory(partial);
ok(!partialHistory.complete && partialHistory.moves.length === 1 && partialHistory.moves[0].number === 1 && partialHistory.moves[0].coordinate === 'e7–e5', 'partial snapshots retain only verified coordinate history with correct move numbering');
assert.throws(() => Chess.exportPgn(partial), /Complete server move history is unavailable/, 'PGN export refuses incomplete history instead of guessing');
checks++;

console.log('\nLudo Chess rules tests passed (' + checks + ' checks).');
