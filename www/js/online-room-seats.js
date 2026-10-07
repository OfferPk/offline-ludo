/* Deterministic Online room roster rows; vacancy placeholders are for waiting rooms only. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OnlineRoomSeats = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  function listSeats(capacity, roster, includeOpenSeats) {
    var members = Array.isArray(roster) ? roster : [];
    var maxSeat = -1;
    members.forEach(function (member) {
      var seat = Number(member && member.seat);
      if (Number.isInteger(seat) && seat >= 0 && seat < 4 && seat > maxSeat) maxSeat = seat;
    });

    var total = Number(capacity);
    if (!Number.isInteger(total) || total < 1 || total > 4) total = Math.min(4, maxSeat + 1);

    var bySeat = Object.create(null);
    members.forEach(function (member) {
      if (!member || typeof member !== 'object') return;
      var seat = Number(member.seat);
      if (!Number.isInteger(seat) || seat < 0 || seat >= total || seat >= 4) return;
      if (!Object.prototype.hasOwnProperty.call(bySeat, seat)) bySeat[seat] = member;
    });

    var rows = [];
    for (var seat = 0; seat < total; seat++) {
      var occupied = Object.prototype.hasOwnProperty.call(bySeat, seat);
      if (occupied) rows.push({ seat: seat, member: bySeat[seat] });
      else if (includeOpenSeats) rows.push({ seat: seat, member: null });
    }
    return rows;
  }

  return Object.freeze({ listSeats: listSeats });
});
