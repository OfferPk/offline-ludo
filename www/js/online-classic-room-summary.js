(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnlineClassicRoomSummary = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function describe(room, currentUserId) {
    if (!room || room.mode !== 'classic' || room.status !== 'active') return '';
    var matchState = room.matchState && room.matchState.state;
    if (!matchState || matchState.phase === 'over') return '';

    var action = matchState.phase === 'roll' ? 'roll the dice' : matchState.phase === 'move' ? 'choose a token' : '';
    var turn = Number(matchState.turn);
    if (!action || !Number.isInteger(turn) || turn < 0 || turn > 3) return '';
    if (!Array.isArray(matchState.players) || !matchState.players.some(function (seat) { return Number(seat) === turn; })) return '';

    var roster = Array.isArray(room.roster) ? room.roster : [];
    var member = roster.find(function (candidate) { return Number(candidate.seat) === turn; });
    if (!member) return '';
    if (currentUserId !== null && typeof currentUserId !== 'undefined' && String(member.user_id) === String(currentUserId)) {
      return 'Your turn: ' + action + '.';
    }

    var name = typeof member.displayName === 'string' && member.displayName.trim()
      ? member.displayName.trim()
      : typeof member.handle === 'string' && member.handle.trim()
        ? member.handle.trim()
        : 'Seat ' + (turn + 1);
    return name + "'s turn: " + action + '.';
  }

  return { describe: describe };
});
