/* Bounded summaries of completed offline matches; never syncs or calls a service. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.OfflineMatchHistory = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ENTRIES = 20;
  var MAX_DATE = 8640000000000000;
  var MODES = ['classic', 'mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly'];
  var MODE_LABELS = {
    classic: 'Classic Ludo', mystery: 'Mystery Tiles', lucky: 'Lucky Chaos',
    quick: 'Quick Ludo', team: 'Team Ludo', arrow: 'Arrow Ludo', friendly: 'Friendly'
  };

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function validEntry(entry) {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.completedAt) || entry.completedAt < 0 || entry.completedAt > MAX_DATE ||
        MODES.indexOf(entry.mode) < 0 || !Array.isArray(entry.ranking) || entry.ranking.length < 1 || entry.ranking.length > 4) return false;
    var seen = {};
    return entry.ranking.every(function (seat) {
      if (!Number.isInteger(seat) || seat < 0 || seat > 3 || seen[seat]) return false;
      seen[seat] = true;
      return true;
    });
  }
  function copyEntry(entry) {
    return { completedAt: entry.completedAt, mode: entry.mode, ranking: entry.ranking.slice() };
  }
  function normalize(entries) {
    if (!Array.isArray(entries)) return [];
    var result = [];
    entries.slice(0, MAX_ENTRIES).forEach(function (entry) {
      if (validEntry(entry)) result.push(copyEntry(entry));
    });
    return result;
  }
  function isValid(entries) {
    return Array.isArray(entries) && entries.length <= MAX_ENTRIES && entries.every(validEntry);
  }
  function append(entries, entry) {
    var existing = normalize(entries);
    if (!validEntry(entry)) return existing;
    return [copyEntry(entry)].concat(existing).slice(0, MAX_ENTRIES);
  }
  function recordCompletedMatch(entries, state, isOnline, completedAt) {
    if (isOnline || !isRecord(state) || state.phase !== 'over') return normalize(entries);
    return append(entries, { completedAt: completedAt, mode: state.mode, ranking: state.ranking });
  }
  function modeLabel(mode) {
    return MODE_LABELS[mode] || 'Offline game';
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES,
    validEntry: validEntry,
    normalize: normalize,
    isValid: isValid,
    append: append,
    recordCompletedMatch: recordCompletedMatch,
    modeLabel: modeLabel
  };
});
