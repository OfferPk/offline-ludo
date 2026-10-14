/* Local-only Daily Spin schedule. Rewards are cosmetic offline coins; never touches the cloud wallet. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DailySpin = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var COOLDOWN_MS = 24 * 60 * 60 * 1000;
  var PRIZES = [25, 50, 75, 100, 150, 250];
  function timestamp(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
  function remainingMs(lastAt, now) {
    now = timestamp(now);
    lastAt = timestamp(lastAt);
    if (!lastAt) return 0;
    return Math.max(0, lastAt + COOLDOWN_MS - now);
  }
  function available(lastAt, now) { return remainingMs(lastAt, now) === 0; }
  function segmentFor(randomValue) {
    var r = Number(randomValue);
    if (!Number.isFinite(r)) r = 0;
    r = Math.max(0, Math.min(0.999999999999, r));
    return Math.floor(r * PRIZES.length);
  }
  function claim(lastAt, now, randomValue) {
    now = timestamp(now);
    if (!now || !available(lastAt, now)) {
      return { ok: false, reason: 'cooldown', remainingMs: remainingMs(lastAt, now) };
    }
    var segment = segmentFor(randomValue);
    return { ok: true, lastAt: now, segment: segment, prize: PRIZES[segment] };
  }
  return { COOLDOWN_MS: COOLDOWN_MS, PRIZES: PRIZES.slice(), timestamp: timestamp,
    remainingMs: remainingMs, available: available, segmentFor: segmentFor, claim: claim };
});
