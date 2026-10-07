(function (root, factory) {
  var preferences = factory();
  if (typeof module === 'object' && module.exports) module.exports = preferences;
  if (root) root.OnlineRoomPreferences = preferences;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  var KEY = 'crossfour.online.lobby-preferences';
  var MODES = ['classic', 'ludo_chess'];
  var CLASSIC_CAPACITIES = ['2', '3', '4'];

  function defaults() {
    return { mode: 'classic', classicCapacity: '2' };
  }

  function load(storage) {
    var result = defaults();
    if (!storage || typeof storage.getItem !== 'function') return result;
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return result;
      var stored = JSON.parse(raw);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result;
      if (MODES.indexOf(stored.mode) >= 0) result.mode = stored.mode;
      var capacity = String(stored.classicCapacity);
      if (CLASSIC_CAPACITIES.indexOf(capacity) >= 0) result.classicCapacity = capacity;
    } catch (_) {
      return defaults();
    }
    return result;
  }

  function save(storage, mode, classicCapacity) {
    var capacity = String(classicCapacity);
    if (!storage || typeof storage.setItem !== 'function' || MODES.indexOf(mode) < 0 || CLASSIC_CAPACITIES.indexOf(capacity) < 0) return false;
    try {
      storage.setItem(KEY, JSON.stringify({ mode: mode, classicCapacity: capacity }));
      return true;
    } catch (_) {
      return false;
    }
  }

  return Object.freeze({ KEY: KEY, defaults: defaults, load: load, save: save });
});
