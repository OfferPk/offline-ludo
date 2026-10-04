/* Mystery Tiles-only undo limits. Counters live beside the match, never inside an undo snapshot. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MysteryUndo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LIMITS = Object.freeze({ total: 6, perTurn: 2, ad: 2 });
  function isCount(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;
  }
  function create(turnId) {
    return { total: 0, turn: 0, ad: 0, turnId: isCount(turnId) ? turnId : 0 };
  }
  function valid(value, currentTurnId) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      isCount(value.total) && value.total <= LIMITS.total &&
      isCount(value.turn) && value.turn <= LIMITS.perTurn && value.turn <= value.total &&
      isCount(value.ad) && value.ad <= LIMITS.ad && value.ad <= value.total &&
      isCount(value.turnId) && (!isCount(currentTurnId) || value.turnId <= currentTurnId);
  }
  function normalize(value, turnId) {
    if (value == null) return create(turnId);
    return valid(value, turnId) ? { total: value.total, turn: value.turn, ad: value.ad, turnId: value.turnId } : null;
  }
  // Call only when a turn is irrevocably advanced (undo expired/replaced or a move committed).
  function advance(counters, turnId) {
    if (!valid(counters) || !isCount(turnId)) return false;
    if (turnId > counters.turnId) {
      counters.turnId = turnId;
      counters.turn = 0;
      return true;
    }
    return false;
  }
  function usedThisTurn(counters, turnId) {
    return counters && counters.turnId === turnId ? counters.turn : 0;
  }
  function reason(counters, turnId, adBased) {
    if (!valid(counters) || !isCount(turnId)) return 'Undo limits are unavailable for this match.';
    if (turnId !== counters.turnId) return 'This undo no longer belongs to the active turn.';
    if (counters.total >= LIMITS.total) return 'Mystery Tiles allows at most 6 successful undos per match.';
    if (counters.turn >= LIMITS.perTurn) return 'Mystery Tiles allows at most 2 successful undos in a single turn.';
    if (adBased && counters.ad >= LIMITS.ad) return 'Mystery Tiles allows at most 2 ad-based undo claims per match.';
    return '';
  }
  // Returns a new counter object only when the undo can be committed; never mutates on rejection.
  function committed(counters, turnId, adBased) {
    if (reason(counters, turnId, !!adBased)) return null;
    return {
      total: counters.total + 1,
      turn: counters.turn + 1,
      ad: counters.ad + (adBased ? 1 : 0),
      turnId: counters.turnId
    };
  }
  function remaining(counters, turnId) {
    var turnUsed = usedThisTurn(counters, turnId);
    return {
      total: Math.max(0, LIMITS.total - counters.total),
      turn: Math.max(0, LIMITS.perTurn - turnUsed),
      ad: Math.max(0, LIMITS.ad - counters.ad),
      totalUsed: counters.total,
      turnUsed: turnUsed,
      adUsed: counters.ad
    };
  }
  return { LIMITS: LIMITS, create: create, valid: valid, normalize: normalize, advance: advance,
    usedThisTurn: usedThisTurn, reason: reason, committed: committed, remaining: remaining };
});
