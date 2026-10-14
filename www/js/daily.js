/* v1.8.1 Daily reward + Daily challenge — offline, local-date based, cosmetic coins only.
 * No cash-out, wagering or loot boxes. Rewards are fixed and shown up-front. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Daily = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var REWARDS = [50, 75, 100, 125, 150, 200, 500];
  var CHALLENGES = [
    { id: 'win1', kind: 'win', goal: 1, coins: 150, title: 'Win a match' },
    { id: 'capture3', kind: 'capture', goal: 3, coins: 120, title: 'Capture 3 tokens' },
    { id: 'arrow1', kind: 'arrow', goal: 1, coins: 100, title: 'Land on an Arrow once' },
    { id: 'six4', kind: 'six', goal: 4, coins: 90, title: 'Roll four 6s' },
    { id: 'home2', kind: 'home', goal: 2, coins: 120, title: 'Bring 2 tokens home' },
    { id: 'play2', kind: 'play', goal: 2, coins: 100, title: 'Finish 2 matches' },
    { id: 'capture5', kind: 'capture', goal: 5, coins: 180, title: 'Capture 5 tokens' }
  ];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function localDate(now) { var d = now instanceof Date ? now : new Date(now == null ? Date.now() : now); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayNum(s) { var p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function dayDiff(a, b) { return dayNum(b) - dayNum(a); }
  function isInt(x, lo, hi) { return typeof x === 'number' && Math.floor(x) === x && x >= lo && x <= hi; }
  function isDate(x) { return typeof x === 'string' && DATE_RE.test(x); }
  function normalize(raw) {
    var r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      last: isDate(r.last) ? r.last : null,
      streak: isInt(r.streak, 0, 7) ? r.streak : 0,
      cDate: isDate(r.cDate) ? r.cDate : null,
      cProg: isInt(r.cProg, 0, 999) ? r.cProg : 0,
      cClaimed: r.cClaimed === true,
      total: isInt(r.total, 0, 1e9) ? r.total : 0,
      lastCoins: isInt(r.lastCoins, 0, 1e6) ? r.lastCoins : 0,
      dblDay: isDate(r.dblDay) ? r.dblDay : null,
      dblChal: isDate(r.dblChal) ? r.dblChal : null
    };
  }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  function challengeFor(date) { return CHALLENGES[hash('cf-daily-' + date) % CHALLENGES.length]; }
  /** Streak status for today. A missed day (gap > 1) resets to day 1. */
  function status(d, today) {
    var claimedToday = d.last === today;
    var gap = d.last ? dayDiff(d.last, today) : null;
    var base = claimedToday ? d.streak : (gap === 1 && d.streak < 7 ? d.streak : 0);
    var day = claimedToday ? d.streak : base + 1;
    return { today: today, canClaim: !claimedToday && (gap === null || gap > 0), claimedToday: claimedToday, day: day, streak: base, reward: REWARDS[day - 1], broken: gap !== null && gap > 1 && d.streak > 0 };
  }
  function claim(d, today, mult) {
    var st = status(d, today);
    if (!st.canClaim) return { ok: false, coins: 0 };
    var coins = st.reward * (mult === 2 ? 2 : 1);
    d.last = today; d.streak = st.day; d.total += coins; d.lastCoins = coins; if (mult === 2) d.dblDay = today;
    return { ok: true, coins: coins, day: st.day };
  }
  function syncChallenge(d, today) { if (d.cDate !== today) { d.cDate = today; d.cProg = 0; d.cClaimed = false; } return challengeFor(today); }
  function challengeStatus(d, today) {
    var c = syncChallenge(d, today);
    return { id: c.id, title: c.title, goal: c.goal, coins: c.coins, progress: Math.min(d.cProg, c.goal), done: d.cProg >= c.goal, claimed: d.cClaimed };
  }
  /** kind: win|capture|arrow|six|home|play. Returns true if this event completed the challenge. */
  function record(d, today, kind, n) {
    var c = syncChallenge(d, today);
    if (c.kind !== kind || d.cClaimed || d.cProg >= c.goal) return false;
    d.cProg = Math.min(c.goal, d.cProg + (isInt(n, 1, 99) ? n : 1));
    return d.cProg >= c.goal;
  }
  function claimChallenge(d, today, mult) {
    var cs = challengeStatus(d, today);
    if (!cs.done || cs.claimed) return { ok: false, coins: 0 };
    var coins = cs.coins * (mult === 2 ? 2 : 1);
    d.cClaimed = true; d.total += coins; if (mult === 2) d.dblChal = today;
    return { ok: true, coins: coins };
  }
  /** Optional 2x after a normal claim (rewarded ad, tap only). Pays the base amount once more. */
  function canDouble(d, today, which) {
    if (which === 'challenge') return d.cDate === today && d.cClaimed && d.dblChal !== today;
    return d.last === today && d.dblDay !== today && d.lastCoins > 0;
  }
  function double(d, today, which) {
    if (!canDouble(d, today, which)) return 0;
    var extra = which === 'challenge' ? challengeFor(today).coins : d.lastCoins;
    if (which === 'challenge') d.dblChal = today; else d.dblDay = today;
    d.total += extra; return extra;
  }
  function hasPending(d, today) { return status(d, today).canClaim || (function (c) { return c.done && !c.claimed; })(challengeStatus(d, today)); }
  return { REWARDS: REWARDS, CHALLENGES: CHALLENGES, localDate: localDate, dayDiff: dayDiff, normalize: normalize, challengeFor: challengeFor,
    status: status, claim: claim, challengeStatus: challengeStatus, record: record, claimChallenge: claimChallenge, canDouble: canDouble, double: double, hasPending: hasPending };
});
