/* Ludo Chess rules. Squares are 0=a8 through 63=h1; uppercase pieces belong to Red/White (seat 0). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LudoChess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PROMOTIONS = ['q', 'r', 'b', 'n'];
  var KNIGHT_STEPS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  var KING_STEPS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  var BISHOP_STEPS = [[-1,-1],[-1,1],[1,-1],[1,1]];
  var ROOK_STEPS = [[-1,0],[0,-1],[0,1],[1,0]];

  function initialState() {
    var board = 'rnbqkbnr' + 'pppppppp' + '.'.repeat(32) + 'PPPPPPPP' + 'RNBQKBNR';
    var state = { protocol: 1, mode: 'ludo_chess', board: board, turn: 0, phase: 'active', castling: 'KQkq', en_passant: -1,
      halfmove: 0, fullmove: 1, position_history: [], last_move: null, winner: null, result: null, check: false };
    state.position_history = [positionKey(state)];
    return state;
  }
  function colorOf(piece) {
    if (!piece || piece === '.') return null;
    return piece === piece.toUpperCase() ? 0 : 1;
  }
  function inside(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }
  function square(row, col) { return row * 8 + col; }
  function hasLegalEnPassant(state) {
    if (!state || typeof state.board !== 'string' || state.board.length !== 64) return false;
    var turn = Number(state.turn), target = Number(state.en_passant);
    if ((turn !== 0 && turn !== 1) || !Number.isInteger(target) || target < 0 || target > 63) return false;
    var targetRow = Math.floor(target / 8), targetCol = target % 8;
    var fromRow = targetRow + (turn === 0 ? 1 : -1);
    var pawn = turn === 0 ? 'P' : 'p';
    for (var dc of [-1, 1]) {
      var fromCol = targetCol + dc;
      if (!inside(fromRow, fromCol)) continue;
      var from = square(fromRow, fromCol);
      if (state.board[from] === pawn && legalMoves(state, from).some(function (move) { return move.to === target && move.enPassant; })) return true;
    }
    return false;
  }
  function positionKey(state) {
    var ep = hasLegalEnPassant(state) ? Number(state.en_passant) : -1;
    return state.board + '|' + state.turn + '|' + (state.castling || '-') + '|' + ep;
  }
  function normalizePositionKey(key) {
    var value = String(key), parts = value.split('|');
    if (parts.length !== 4 || parts[0].length !== 64) return value;
    var turn = Number(parts[1]), ep = Number(parts[3]);
    if ((turn !== 0 && turn !== 1) || !Number.isInteger(ep)) return value;
    return positionKey({ board: parts[0], turn: turn, phase: 'active', castling: parts[2] === '-' ? '' : parts[2], en_passant: ep });
  }
  function cloneState(state) { return JSON.parse(JSON.stringify(state)); }
  function findKing(board, color) { return board.indexOf(color === 0 ? 'K' : 'k'); }

  function isSquareAttacked(board, target, byColor) {
    var tr = Math.floor(target / 8), tc = target % 8;
    var pawn = byColor === 0 ? 'P' : 'p';
    var pawnRow = tr + (byColor === 0 ? 1 : -1);
    for (var dc of [-1, 1]) if (inside(pawnRow, tc + dc) && board[square(pawnRow, tc + dc)] === pawn) return true;
    var knight = byColor === 0 ? 'N' : 'n';
    for (var n of KNIGHT_STEPS) if (inside(tr + n[0], tc + n[1]) && board[square(tr + n[0], tc + n[1])] === knight) return true;
    var king = byColor === 0 ? 'K' : 'k';
    for (var k of KING_STEPS) if (inside(tr + k[0], tc + k[1]) && board[square(tr + k[0], tc + k[1])] === king) return true;
    var rays = [
      { dirs: BISHOP_STEPS, pieces: byColor === 0 ? 'BQ' : 'bq' },
      { dirs: ROOK_STEPS, pieces: byColor === 0 ? 'RQ' : 'rq' }
    ];
    for (var ray of rays) for (var d of ray.dirs) {
      var r = tr + d[0], c = tc + d[1];
      while (inside(r, c)) {
        var p = board[square(r, c)];
        if (p !== '.') { if (ray.pieces.indexOf(p) >= 0) return true; break; }
        r += d[0]; c += d[1];
      }
    }
    return false;
  }
  function inCheck(state, color) {
    var king = findKing(state.board, color);
    return king < 0 || isSquareAttacked(state.board, king, 1 - color);
  }
  function canLand(board, target, color) {
    var piece = board[target];
    return colorOf(piece) !== color && piece !== (color === 0 ? 'k' : 'K');
  }
  function addMove(out, state, from, to, promotion) {
    if (!canLand(state.board, to, state.turn)) return;
    out.push({ from: from, to: to, promotion: promotion || null });
  }
  function addPawnMove(out, state, from, to, color) {
    var lastRow = color === 0 ? 0 : 7;
    if (Math.floor(to / 8) === lastRow) PROMOTIONS.forEach(function (p) { addMove(out, state, from, to, p); });
    else addMove(out, state, from, to, null);
  }
  function pseudoMoves(state, from) {
    var board = state.board, piece = board[from], color = colorOf(piece), out = [];
    if (color == null || color !== state.turn || state.phase !== 'active') return out;
    var row = Math.floor(from / 8), col = from % 8, kind = piece.toLowerCase();
    if (kind === 'p') {
      var dir = color === 0 ? -1 : 1, nextRow = row + dir;
      if (inside(nextRow, col) && board[square(nextRow, col)] === '.') {
        addPawnMove(out, state, from, square(nextRow, col), color);
        var startRow = color === 0 ? 6 : 1, doubleRow = row + dir * 2;
        if (row === startRow && board[square(doubleRow, col)] === '.') out.push({ from: from, to: square(doubleRow, col), promotion: null });
      }
      for (var dc of [-1, 1]) if (inside(nextRow, col + dc)) {
        var to = square(nextRow, col + dc), target = board[to];
        if (target !== '.' && colorOf(target) === 1 - color && target.toLowerCase() !== 'k') addPawnMove(out, state, from, to, color);
        else if (to === state.en_passant && target === '.') {
          var captured = board[to - dir * 8];
          if (captured === (color === 0 ? 'p' : 'P')) out.push({ from: from, to: to, promotion: null, enPassant: true });
        }
      }
    } else if (kind === 'n' || kind === 'k') {
      var steps = kind === 'n' ? KNIGHT_STEPS : KING_STEPS;
      steps.forEach(function (d) { var r = row + d[0], c = col + d[1]; if (inside(r, c)) addMove(out, state, from, square(r, c), null); });
      if (kind === 'k' && !inCheck(state, color)) {
        var homeRow = color === 0 ? 7 : 0, kingHome = square(homeRow, 4), rights = state.castling || '';
        if (from === kingHome) {
          var kingRight = color === 0 ? 'K' : 'k', queenRight = color === 0 ? 'Q' : 'q';
          if (rights.indexOf(kingRight) >= 0 && board[square(homeRow, 7)] === (color === 0 ? 'R' : 'r') &&
              board[square(homeRow, 5)] === '.' && board[square(homeRow, 6)] === '.' &&
              !isSquareAttacked(board, square(homeRow, 5), 1 - color) && !isSquareAttacked(board, square(homeRow, 6), 1 - color)) {
            out.push({ from: from, to: square(homeRow, 6), promotion: null, castle: 'king' });
          }
          if (rights.indexOf(queenRight) >= 0 && board[square(homeRow, 0)] === (color === 0 ? 'R' : 'r') &&
              board[square(homeRow, 1)] === '.' && board[square(homeRow, 2)] === '.' && board[square(homeRow, 3)] === '.' &&
              !isSquareAttacked(board, square(homeRow, 3), 1 - color) && !isSquareAttacked(board, square(homeRow, 2), 1 - color)) {
            out.push({ from: from, to: square(homeRow, 2), promotion: null, castle: 'queen' });
          }
        }
      }
    } else {
      var dirs = kind === 'b' ? BISHOP_STEPS : kind === 'r' ? ROOK_STEPS : BISHOP_STEPS.concat(ROOK_STEPS);
      dirs.forEach(function (d) {
        var r = row + d[0], c = col + d[1];
        while (inside(r, c)) {
          var to = square(r, c), target = board[to];
          if (target === '.') addMove(out, state, from, to, null);
          else { if (colorOf(target) === 1 - color && target.toLowerCase() !== 'k') addMove(out, state, from, to, null); break; }
          r += d[0]; c += d[1];
        }
      });
    }
    return out;
  }
  function stripRights(rights, chars) { return rights.split('').filter(function (x) { return chars.indexOf(x) < 0; }).join(''); }
  function rawApply(state, move) {
    var next = cloneState(state), board = next.board.split(''), piece = board[move.from], color = colorOf(piece), capturedAt = move.to;
    if (move.enPassant) capturedAt = move.to + (color === 0 ? 8 : -8);
    var captured = board[capturedAt];
    board[move.from] = '.';
    if (move.enPassant) board[capturedAt] = '.';
    if (move.castle) {
      var row = color === 0 ? 7 : 0;
      if (move.castle === 'king') { board[square(row, 5)] = board[square(row, 7)]; board[square(row, 7)] = '.'; }
      else { board[square(row, 3)] = board[square(row, 0)]; board[square(row, 0)] = '.'; }
    }
    if (move.promotion) board[move.to] = color === 0 ? move.promotion.toUpperCase() : move.promotion.toLowerCase();
    else board[move.to] = piece;
    next.board = board.join('');
    var rights = next.castling || '';
    if (piece === 'K') rights = stripRights(rights, 'KQ');
    if (piece === 'k') rights = stripRights(rights, 'kq');
    if (move.from === 63 || capturedAt === 63) rights = stripRights(rights, 'K');
    if (move.from === 56 || capturedAt === 56) rights = stripRights(rights, 'Q');
    if (move.from === 7 || capturedAt === 7) rights = stripRights(rights, 'k');
    if (move.from === 0 || capturedAt === 0) rights = stripRights(rights, 'q');
    next.castling = rights;
    next.en_passant = piece.toLowerCase() === 'p' && Math.abs(move.to - move.from) === 16 ? (move.from + move.to) >> 1 : -1;
    next.halfmove = piece.toLowerCase() === 'p' || captured !== '.' ? 0 : next.halfmove + 1;
    if (color === 1) next.fullmove += 1;
    next.turn = 1 - color;
    next.last_move = { from: move.from, to: move.to, promotion: move.promotion || null, capture: captured !== '.', en_passant: !!move.enPassant, castle: move.castle || null };
    return next;
  }
  function legalMoves(state, from) {
    if (!state || typeof state.board !== 'string' || state.board.length !== 64 || state.phase !== 'active') return [];
    var sources = Number.isInteger(from) ? [from] : Array.from({ length: 64 }, function (_, i) { return i; });
    var out = [];
    sources.forEach(function (source) {
      pseudoMoves(state, source).forEach(function (move) {
        var next = rawApply(state, move);
        if (!inCheck(next, state.turn)) out.push(move);
      });
    });
    return out;
  }
  function insufficientMaterial(board) {
    var minors = [], heavy = 0;
    for (var i = 0; i < 64; i++) {
      var p = board[i];
      if (p === '.' || p.toLowerCase() === 'k') continue;
      if (p.toLowerCase() === 'b' || p.toLowerCase() === 'n') minors.push({ type: p.toLowerCase(), square: i });
      else heavy++;
    }
    if (heavy) return false;
    if (!minors.length || minors.length === 1) return true;
    if (minors.every(function (p) { return p.type === 'b'; })) {
      var colors = minors.map(function (p) { return (Math.floor(p.square / 8) + p.square % 8) % 2; });
      return colors.every(function (c) { return c === colors[0]; });
    }
    return false;
  }
  function repetitions(state) {
    var key = positionKey(state);
    return (state.position_history || []).filter(function (item) { return normalizePositionKey(item) === key; }).length;
  }
  function finish(state, result, winner) {
    state.phase = 'over'; state.result = result; state.winner = winner == null ? null : winner;
  }
  function applyMove(state, move) {
    var legal = legalMoves(state, move && move.from).find(function (item) {
      return item.to === move.to && (item.promotion || null) === (move.promotion || null);
    });
    if (!legal) throw new Error('That move is not legal.');
    var next = rawApply(state, legal);
    next.position_history = (state.position_history || []).slice();
    next.position_history.push(positionKey(next));
    next.check = inCheck(next, next.turn);
    var remaining = legalMoves(next);
    if (!remaining.length) finish(next, next.check ? 'checkmate' : 'stalemate', next.check ? state.turn : null);
    else if (next.halfmove >= 150) finish(next, 'draw_seventy_five_moves', null);
    else if (repetitions(next) >= 5) finish(next, 'draw_fivefold_repetition', null);
    else if (insufficientMaterial(next.board)) finish(next, 'draw_insufficient_material', null);
    return next;
  }
  function canClaimDraw(state) {
    return !!(state && state.phase === 'active' && (state.halfmove >= 100 || repetitions(state) >= 3));
  }
  function claimDraw(state) {
    if (!canClaimDraw(state)) throw new Error('A draw cannot be claimed in this position.');
    var next = cloneState(state);
    finish(next, next.halfmove >= 100 ? 'draw_fifty_move_claim' : 'draw_threefold_claim', null);
    return next;
  }
  function claimableDrawByMove(state, move) {
    if (!state || state.phase !== 'active' || !move) return null;
    var legal = legalMoves(state, move.from).find(function (item) {
      return item.to === move.to && (item.promotion || null) === (move.promotion || null);
    });
    if (!legal) return null;
    var next = applyMove(state, legal);
    if (!canClaimDraw(next)) return null;
    return next.halfmove >= 100 ? 'draw_fifty_move_claim' : 'draw_threefold_claim';
  }
  function coord(index) {
    return String.fromCharCode(97 + index % 8) + String(8 - Math.floor(index / 8));
  }
  function pieceName(piece) {
    return ({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[String(piece || '').toLowerCase()] || 'empty';
  }
  return {
    initialState: initialState,
    legalMoves: legalMoves,
    applyMove: applyMove,
    isSquareAttacked: isSquareAttacked,
    inCheck: inCheck,
    canClaimDraw: canClaimDraw,
    claimDraw: claimDraw,
    claimableDrawByMove: claimableDrawByMove,
    positionKey: positionKey,
    repetitions: repetitions,
    insufficientMaterial: insufficientMaterial,
    coord: coord,
    pieceName: pieceName,
    colorOf: colorOf
  };
});
