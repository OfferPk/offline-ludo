(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnlineClassicResultShare = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function seatNumber(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3) return value;
    if (typeof value === 'string' && /^[0-3]$/.test(value)) return Number(value);
    return -1;
  }

  function safeName(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var name = value
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 32);
    return name || fallback;
  }

  function ordinal(place) {
    var mod100 = place % 100;
    if (mod100 >= 11 && mod100 <= 13) return place + 'th';
    return place + ({ 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] || 'th');
  }

  function summarize(state, roster) {
    if (!state || state.phase !== 'over' || !Array.isArray(state.ranking)) return '';
    var names = {};
    (Array.isArray(roster) ? roster : []).forEach(function (member) {
      var seat = seatNumber(member && member.seat);
      if (seat < 0 || Object.prototype.hasOwnProperty.call(names, seat)) return;
      var fallback = 'Seat ' + (seat + 1);
      names[seat] = safeName(member.displayName, '') || safeName(member.handle, '') || fallback;
    });

    var ranked = [];
    var seen = {};
    state.ranking.forEach(function (value) {
      var seat = seatNumber(value);
      if (seat < 0 || seen[seat]) return;
      seen[seat] = true;
      ranked.push(seat);
    });
    if (!ranked.length) return '';

    var lines = ['Online Classic Ludo — final result'];
    ranked.forEach(function (seat, index) {
      lines.push(ordinal(index + 1) + ' — ' + (names[seat] || ('Seat ' + (seat + 1))));
    });

    var departed = [];
    var leftEarly = {};
    (Array.isArray(state.abandoned) ? state.abandoned : []).forEach(function (value) {
      var seat = seatNumber(value);
      if (seat < 0 || seen[seat] || leftEarly[seat]) return;
      leftEarly[seat] = true;
      departed.push(names[seat] || ('Seat ' + (seat + 1)));
    });
    if (departed.length) lines.push('Left early — ' + departed.join(', '));
    return lines.join('\n');
  }

  return { summarize: summarize };
});
