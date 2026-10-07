/* Deduplicate Online Classic turn-start cues across realtime refreshes and reconnects. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OnlineClassicTurnCue = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  function create(onYourTurn) {
    var previous = null;
    return {
      update: function (roomId, version, state, mySeat) {
        var id = roomId == null ? '' : String(roomId);
        var nextVersion = Number(version);
        var seat = Number(mySeat);
        if (!id || !Number.isSafeInteger(nextVersion) || !state || typeof state !== 'object' ||
            mySeat == null || !Number.isInteger(seat) || seat < 0 || seat > 3) {
          previous = null;
          return false;
        }

        if (previous && previous.roomId === id && nextVersion <= previous.version) return false;

        var turn = Number(state.turn);
        var active = (state.phase === 'roll' || state.phase === 'move') && Number.isInteger(turn) && turn >= 0 && turn <= 3;
        var isMyTurn = active && turn === seat;
        var shouldCue = !!(previous && previous.roomId === id && nextVersion > previous.version &&
          previous.active && !previous.isMyTurn && active && isMyTurn);
        previous = { roomId: id, version: nextVersion, active: active, isMyTurn: isMyTurn };

        if (shouldCue && typeof onYourTurn === 'function') {
          try { onYourTurn(); } catch (_) { /* Audio must never block live match rendering. */ }
        }
        return shouldCue;
      },
      reset: function () { previous = null; }
    };
  }

  return { create: create };
});
