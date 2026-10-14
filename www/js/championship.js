/* Eight-entrant offline Championship. The player plays QF, SF, and Final; other bracket matches are locally simulated. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Championship = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var STAGES = ['Quarter-final', 'Semi-final', 'Final'];
  var FEES = [50, 100, 500];
  var BOTS = ['Ruby', 'Jade', 'Saffron', 'Cobalt', 'Pearl', 'Onyx', 'Amber'];
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function rng(seed) {
    var x = seed >>> 0 || 0x9e3779b9;
    return function () { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  }
  function create(entryFee, seed, now) {
    entryFee = Number(entryFee);
    if (FEES.indexOf(entryFee) < 0) return null;
    var random = rng(Number(seed) || Date.now());
    var otherWinners = [];
    for (var i = 0; i < 3; i++) {
      var a = BOTS[i * 2], b = BOTS[i * 2 + 1];
      otherWinners.push(random() < 0.5 ? a : b);
    }
    var finalOpponent = random() < 0.5 ? otherWinners[1] : otherWinners[2];
    return { v: 1, id: 'offline-' + (Number(now) || Date.now()).toString(36) + '-' + Math.floor(random() * 0xffffff).toString(36),
      status: 'active', stage: 0, wins: 0, entryFee: entryFee, jackpot: entryFee * 8, createdAt: Number(now) || Date.now(),
      opponent: BOTS[0], opponents: [BOTS[0], otherWinners[0], finalOpponent], results: [], bracketWinners: otherWinners };
  }
  function record(tournament, won, now) {
    if (!valid(tournament) || tournament.status !== 'active' || typeof won !== 'boolean') return { ok: false, reason: 'invalid-tournament', tournament: null };
    var next = clone(tournament);
    next.results.push({ stage: next.stage, opponent: next.opponents[next.stage], won: won, at: Number(now) || Date.now() });
    if (!won) next.status = 'eliminated';
    else {
      next.wins++;
      if (next.stage === 2) next.status = 'champion';
      else next.stage++;
    }
    return { ok: true, tournament: next, completed: next.status === 'champion', eliminated: next.status === 'eliminated',
      nextStage: next.status === 'active' ? STAGES[next.stage] : null, jackpot: next.status === 'champion' ? next.jackpot : 0 };
  }
  function valid(value) {
    return !!value && value.v === 1 && typeof value.id === 'string' && value.id.length <= 64 &&
      ['active', 'eliminated', 'champion'].indexOf(value.status) >= 0 && Number.isInteger(value.stage) && value.stage >= 0 && value.stage <= 2 &&
      Number.isInteger(value.wins) && value.wins >= 0 && value.wins <= 3 && FEES.indexOf(value.entryFee) >= 0 && value.jackpot === value.entryFee * 8 &&
      Number.isSafeInteger(value.createdAt) && Array.isArray(value.opponents) && value.opponents.length === 3 && value.opponents.every(function (x) { return typeof x === 'string' && x.length <= 24; }) &&
      Array.isArray(value.results) && value.results.length <= 3 && Array.isArray(value.bracketWinners) && value.bracketWinners.length === 3 &&
      value.results.every(function (r, i) { return !!r && r.stage === i && typeof r.opponent === 'string' && typeof r.won === 'boolean' && Number.isSafeInteger(r.at); });
  }
  function label(stage) { return STAGES[stage] || ''; }
  return { STAGES: STAGES.slice(), FEES: FEES.slice(), create: create, record: record, valid: valid, label: label };
});
