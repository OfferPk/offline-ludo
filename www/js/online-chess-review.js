/* Read-only Online Chess timeline rebuilt only from verified server history. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OnlineChessReview = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function unavailable(reason) {
    return { complete: false, positions: [], moves: [], reason: reason || 'A complete, verified server move history is required for position review.' };
  }

  function createTimeline(state, chess) {
    if (!chess || typeof chess.initialState !== 'function' || typeof chess.applyMove !== 'function' ||
        typeof chess.movesFromPositionHistory !== 'function' || typeof chess.positionKey !== 'function') {
      return unavailable('Chess position review is unavailable in this build.');
    }
    var history = chess.movesFromPositionHistory(state);
    if (!history || !history.complete || !Array.isArray(history.moves) || !state || !Array.isArray(state.position_history)) {
      return unavailable(history && history.reason);
    }
    if (state.position_history.length !== history.moves.length + 1) {
      return unavailable('Server history does not contain a verifiable position for every move.');
    }

    try {
      var current = chess.initialState();
      var positions = [current];
      if (chess.positionKey(current) !== state.position_history[0]) {
        return unavailable('Server history does not begin at the standard starting position.');
      }
      history.moves.forEach(function (move, index) {
        current = chess.applyMove(current, { from: move.from, to: move.to, promotion: move.promotion || null });
        if (chess.positionKey(current) !== state.position_history[index + 1]) {
          throw new Error('A replayed position differs from its verified server snapshot.');
        }
        positions.push(current);
      });
      if (chess.positionKey(current) !== chess.positionKey(state) || current.turn !== state.turn || current.fullmove !== state.fullmove ||
          (Number.isInteger(state.halfmove) && current.halfmove !== state.halfmove) ||
          (typeof state.check === 'boolean' && current.check !== state.check)) {
        return unavailable('Replayed positions do not match the latest server state.');
      }
      return { complete: true, positions: positions, moves: history.moves.slice(), reason: '' };
    } catch (_) {
      return unavailable('A server move could not be replayed safely.');
    }
  }

  return { createTimeline: createTimeline };
});
