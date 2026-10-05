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
  function positionKey(state) { return state.board + '|' + state.turn + '|' + (state.castling || '-') + '|' + (state.en_passant == null ? -1 : state.en_passant); }
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
    return (state.position_history || []).filter(function (item) { return item === key; }).length;
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
  function coord(index) {
    return String.fromCharCode(97 + index % 8) + String(8 - Math.floor(index / 8));
  }
  function sanForMove(state, move, after, legal) {
    var moves = legal || legalMoves(state);
    var selected = moves.find(function (candidate) {
      return candidate.from === move.from && candidate.to === move.to && (candidate.promotion || null) === (move.promotion || null);
    });
    if (!selected) throw new Error('That move is not legal.');
    after = after || rawApply(state, selected);
    var piece = state.board[selected.from], kind = piece.toLowerCase(), capture = !!selected.enPassant || state.board[selected.to] !== '.';
    var notation = '';
    if (selected.castle) notation = selected.castle === 'king' ? 'O-O' : 'O-O-O';
    else {
      if (kind !== 'p') {
        notation = kind.toUpperCase();
        var rivals = moves.filter(function (candidate) {
          return candidate.from !== selected.from && candidate.to === selected.to &&
            state.board[candidate.from] !== '.' && state.board[candidate.from].toLowerCase() === kind;
        });
        if (rivals.length) {
          var file = selected.from % 8, rank = Math.floor(selected.from / 8);
          var sharesFile = rivals.some(function (candidate) { return candidate.from % 8 === file; });
          var sharesRank = rivals.some(function (candidate) { return Math.floor(candidate.from / 8) === rank; });
          if (!sharesFile) notation += String.fromCharCode(97 + file);
          else if (!sharesRank) notation += String(8 - rank);
          else notation += coord(selected.from);
        }
      } else if (capture) notation += String.fromCharCode(97 + selected.from % 8);
      if (capture) notation += 'x';
      notation += coord(selected.to);
      if (selected.promotion) notation += '=' + selected.promotion.toUpperCase();
    }
    var check = inCheck(after, after.turn);
    if (check) notation += legalMoves(after).length === 0 ? '#' : '+';
    return notation;
  }
  function positionFromKey(key, fullmove) {
    if (typeof key !== 'string') return null;
    var parts = key.split('|');
    if (parts.length !== 4 || !/^[prnbqkPRNBQK.]{64}$/.test(parts[0]) || (parts[1] !== '0' && parts[1] !== '1')) return null;
    if ((parts[0].match(/K/g) || []).length !== 1 || (parts[0].match(/k/g) || []).length !== 1) return null;
    if (parts[2] !== '-' && (!/^[KQkq]+$/.test(parts[2]) || new Set(parts[2]).size !== parts[2].length)) return null;
    if (!/^-?\d+$/.test(parts[3])) return null;
    var enPassant = Number(parts[3]);
    if (!Number.isInteger(enPassant) || enPassant < -1 || enPassant > 63) return null;
    return { protocol: 1, mode: 'ludo_chess', board: parts[0], turn: Number(parts[1]), phase: 'active',
      castling: parts[2] === '-' ? '' : parts[2], en_passant: enPassant, halfmove: 0, fullmove: fullmove,
      position_history: [key], last_move: null, winner: null, result: null, check: false };
  }
  function movesFromPositionHistory(state) {
    var result = { complete: false, moves: [], reason: 'Complete server move history is unavailable.' };
    if (!state || typeof state.board !== 'string' || state.board.length !== 64 ||
        (state.turn !== 0 && state.turn !== 1) || !Number.isInteger(state.fullmove) || state.fullmove < 1 ||
        !Array.isArray(state.position_history) || !state.position_history.length) return result;
    var keys = state.position_history, positions = keys.map(function (key) { return positionFromKey(key, 1); });
    if (positions.some(function (position) { return !position; })) {
      result.reason = 'Server position history contains an invalid snapshot.';
      return result;
    }
    if (positionKey(state) !== keys[keys.length - 1]) {
      result.reason = 'Server position history does not end at the current position.';
      return result;
    }
    var blackMoves = 0;
    for (var turnIndex = 0; turnIndex < keys.length - 1; turnIndex++) {
      if (positions[turnIndex].turn === 1) blackMoves++;
      if (positions[turnIndex + 1].turn !== 1 - positions[turnIndex].turn) {
        result.reason = 'Server position history is missing or reorders a ply.';
        return result;
      }
    }
    var firstMoveNumber = state.fullmove - blackMoves;
    if (firstMoveNumber < 1) {
      result.reason = 'Server position history has inconsistent move numbering.';
      return result;
    }
    var coordinateMoves = [], moveNumber = firstMoveNumber;
    for (var ply = 0; ply < keys.length - 1; ply++) {
      var before = positionFromKey(keys[ply], moveNumber), targetKey = keys[ply + 1];
      var legal = legalMoves(before), matches = [];
      legal.forEach(function (candidate) {
        if (positionKey(rawApply(before, candidate)) === targetKey) matches.push(candidate);
      });
      if (matches.length !== 1) {
        result.reason = 'A server position transition cannot be verified as one legal move.';
        return result;
      }
      var selected = matches[0], after = rawApply(before, selected);
      after.check = inCheck(after, after.turn);
      var capture = !!selected.enPassant || before.board[selected.to] !== '.';
      var capturedAt = selected.enPassant ? selected.to + (before.turn === 0 ? 8 : -8) : selected.to;
      coordinateMoves.push({ number: moveNumber, color: before.turn, from: selected.from, to: selected.to,
        promotion: selected.promotion || null, capture: capture, enPassant: !!selected.enPassant, castle: selected.castle || null,
        san: sanForMove(before, selected, after, legal),
        coordinate: coord(selected.from) + (capture ? '×' : '–') + coord(selected.to) + (selected.promotion ? '=' + selected.promotion.toUpperCase() : ''),
        capturedPiece: capture ? before.board[capturedAt] : null });
      if (before.turn === 1) moveNumber++;
    }
    var startKey = positionKey(initialState());
    var expectedPlies = (state.fullmove - 1) * 2 + state.turn;
    var complete = keys[0] === startKey && keys.length === expectedPlies + 1;
    if (complete) {
      var replay = initialState(), sanMoves = [];
      for (var index = 1; index < keys.length; index++) {
        var beforeReplay = replay, candidates = legalMoves(beforeReplay).filter(function (candidate) {
          return positionKey(rawApply(beforeReplay, candidate)) === keys[index];
        });
        if (candidates.length !== 1) { complete = false; break; }
        var next = applyMove(beforeReplay, candidates[0]);
        if (positionKey(next) !== keys[index]) { complete = false; break; }
        var historyMove = coordinateMoves[index - 1];
        sanMoves.push(Object.assign({}, historyMove, { san: sanForMove(beforeReplay, candidates[0], next, legalMoves(beforeReplay)) }));
        replay = next;
      }
      if (complete && (positionKey(replay) !== positionKey(state) || replay.fullmove !== state.fullmove || replay.turn !== state.turn ||
          (Number.isInteger(state.halfmove) && replay.halfmove !== state.halfmove) ||
          (typeof state.check === 'boolean' && replay.check !== state.check) ||
          (state.last_move && (!replay.last_move || state.last_move.from !== replay.last_move.from || state.last_move.to !== replay.last_move.to ||
            (state.last_move.promotion || null) !== (replay.last_move.promotion || null) || !!state.last_move.capture !== !!replay.last_move.capture ||
            !!state.last_move.en_passant !== !!replay.last_move.en_passant || (state.last_move.castle || null) !== (replay.last_move.castle || null))) ||
          (replay.phase === 'over' && state.phase !== 'over') ||
          (state.result === 'checkmate' && replay.result !== 'checkmate') ||
          (replay.result === 'checkmate' && state.result !== 'checkmate'))) complete = false;
      if (complete) {
        result.complete = true;
        result.moves = sanMoves;
        result.reason = '';
        return result;
      }
    }
    result.moves = coordinateMoves;
    result.reason = 'Complete server move history is unavailable; only verified coordinate moves are shown.';
    return result;
  }
  function pgnResult(state) {
    if (!state || state.phase !== 'over') return '*';
    if (state.winner === 0) return '1-0';
    if (state.winner === 1) return '0-1';
    return '1/2-1/2';
  }
  function pgnTag(value) {
    return String(value == null || value === '' ? '?' : value).replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  function exportPgn(state, players) {
    var history = movesFromPositionHistory(state);
    if (!history.complete) throw new Error(history.reason || 'Complete server move history is unavailable.');
    players = players || {};
    var result = pgnResult(state), tags = [
      ['Event', 'Ludo Chess'], ['Site', 'Online room'], ['Date', '????.??.??'], ['Round', '?'],
      ['White', players.red || 'Red'], ['Black', players.blue || 'Blue'], ['Result', result]
    ];
    var tokens = [];
    history.moves.forEach(function (move) {
      if (move.color === 0) tokens.push(String(move.number) + '. ' + move.san);
      else if (tokens.length && tokens[tokens.length - 1].indexOf(String(move.number) + '.') === 0) tokens[tokens.length - 1] += ' ' + move.san;
      else tokens.push(String(move.number) + '... ' + move.san);
    });
    tokens.push(result);
    var lines = [], line = '';
    tokens.forEach(function (token) {
      if (line && line.length + token.length + 1 > 80) { lines.push(line); line = token; }
      else line += (line ? ' ' : '') + token;
    });
    if (line) lines.push(line);
    return tags.map(function (tag) { return '[' + tag[0] + ' "' + pgnTag(tag[1]) + '"]'; }).join('\n') + '\n\n' + lines.join('\n') + '\n';
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
    positionKey: positionKey,
    repetitions: repetitions,
    insufficientMaterial: insufficientMaterial,
    coord: coord,
    sanForMove: sanForMove,
    movesFromPositionHistory: movesFromPositionHistory,
    exportPgn: exportPgn,
    pieceName: pieceName,
    colorOf: colorOf
  };
});
