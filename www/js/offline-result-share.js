(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.OfflineResultShare = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var MODE_NAMES = {
    classic: 'Classic Ludo', mystery: 'Mystery Tiles', lucky: 'Lucky Chaos Ludo',
    quick: 'Quick Ludo', team: 'Team Ludo', arrow: 'Arrow Ludo', friendly: 'Friendly Ludo'
  };
  var LEVEL_NAMES = { easy: 'Easy', medium: 'Normal', hard: 'Hard' };

  function seatIndex(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 3 ? value : -1;
  }
  function safeName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 48);
  }
  function ordinal(place) {
    var lastTwo = place % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return place + 'th';
    return place + ({ 1: 'st', 2: 'nd', 3: 'rd' }[place % 10] || 'th');
  }
  function summarize(state, seatNames) {
    if (!state || state.phase !== 'over' || !Array.isArray(state.players) || !Array.isArray(state.ranking)) return '';
    var players = [];
    var participating = Object.create(null);
    state.players.forEach(function (value) {
      var seat = seatIndex(value);
      if (seat < 0 || participating[seat]) return;
      participating[seat] = true;
      players.push(seat);
    });
    if (!players.length) return '';

    var ranking = [];
    var ranked = Object.create(null);
    state.ranking.forEach(function (value) {
      var seat = seatIndex(value);
      if (seat < 0 || !participating[seat] || ranked[seat]) return;
      ranked[seat] = true;
      ranking.push(seat);
    });
    if (!ranking.length) return '';

    var seats = Array.isArray(state.seats) ? state.seats : [];
    var humanCount = players.filter(function (seat) { return seats[seat] && seats[seat].type === 'human'; }).length;
    function labelFor(seat) {
      var entry = seats[seat] || {};
      var name = safeName(entry.name);
      var fallback = safeName(Array.isArray(seatNames) ? seatNames[seat] : '') || ('Seat ' + (seat + 1));
      if (!name) name = entry.type === 'human' && humanCount === 1 ? 'You' : fallback;
      if (entry.type === 'ai') {
        var level = LEVEL_NAMES[entry.level];
        name += level ? ' (' + level + ' computer)' : ' (computer)';
      }
      return name;
    }
    var mode = MODE_NAMES[state.mode] || 'Ludo';
    var lines = ['Offline Ludo — final result', 'Mode: ' + mode];
    ranking.forEach(function (seat, index) {
      lines.push(ordinal(index + 1) + ' — ' + labelFor(seat));
    });
    return lines.join('\n');
  }

  return { summarize: summarize };
});
