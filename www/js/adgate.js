/*
 * AdGate: the single place that decides whether an interstitial may be shown.
 * Pure logic (no DOM, no SDK) so it runs in Node tests as well.
 *
 * Rules:
 *  - never in the player's first session (first app launch)
 *  - never before INTERSTITIAL_MIN_MATCHES completed matches AND INTERSTITIAL_MIN_PLAY_MS of play time
 *  - afterwards at most one every INTERSTITIAL_EVERY_N_MATCHES completed matches
 *  - and at most one per INTERSTITIAL_MIN_INTERVAL_MS
 *  - it is only ever asked after a match has ended (see game.js: leaveResult), never mid-match,
 *    never on launch, exit or back press.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdGate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULTS = {
    INTERSTITIAL_MIN_SESSIONS: 2,
    INTERSTITIAL_MIN_MATCHES: 5,
    INTERSTITIAL_MIN_PLAY_MS: 180000,
    INTERSTITIAL_EVERY_N_MATCHES: 2,
    INTERSTITIAL_MIN_INTERVAL_MS: 120000
  };

  function create(cfg, state) {
    var c = {};
    Object.keys(DEFAULTS).forEach(function (k) { c[k] = (cfg && cfg[k] != null) ? cfg[k] : DEFAULTS[k]; });
    var s = state || {};
    ['sessions', 'matchesSince', 'lastTs', 'playMs', 'matchesCompleted'].forEach(function (k) { if (typeof s[k] !== 'number' || !isFinite(s[k])) s[k] = 0; });

    return {
      state: s,
      config: c,
      /** Call once per app launch (the first launch is session 1). */
      sessionStarted: function () { s.sessions++; },
      addPlayTime: function (ms) { if (ms > 0 && ms < 60000) s.playMs += ms; },
      matchCompleted: function () { s.matchesSince++; s.matchesCompleted++; },
      /** May an interstitial be shown right now (asked only after a match has ended)? */
      canShow: function (now) {
        if (s.sessions < c.INTERSTITIAL_MIN_SESSIONS) return false;
        if (s.matchesCompleted < c.INTERSTITIAL_MIN_MATCHES) return false;
        if (s.playMs < c.INTERSTITIAL_MIN_PLAY_MS) return false;
        if (s.matchesSince < c.INTERSTITIAL_EVERY_N_MATCHES) return false;
        if (s.lastTs > now) s.lastTs = now; // clock moved backwards: restart the interval
        if (s.lastTs && now - s.lastTs < c.INTERSTITIAL_MIN_INTERVAL_MS) return false;
        return true;
      },
      shown: function (now) { s.matchesSince = 0; s.lastTs = now; }
    };
  }
  return { create: create, DEFAULTS: DEFAULTS };
});
