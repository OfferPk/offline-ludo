/* Local level milestones. Cosmetic unlocks and offline-only coins; no cloud writes. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProgressionRewards = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var REWARDS = [
    { level: 2, kind: 'coins', amount: 100, title: '100 coins', detail: 'A small coin boost' },
    { level: 5, kind: 'dice', id: 'gold-dice', title: 'Gold Dice', detail: 'A special cosmetic dice skin' },
    { level: 10, kind: 'frame', id: 'crown', title: 'Crown Frame', detail: 'A crowned level badge' }
  ];
  function collect(save, fromLevel, toLevel, persist) {
    if (!save || !Number.isSafeInteger(fromLevel) || !Number.isSafeInteger(toLevel) || fromLevel < 0 || toLevel < fromLevel ||
        !Array.isArray(save.rewardClaims) || !Array.isArray(save.owned && save.owned.dice) || !save.flags || typeof persist !== 'function') {
      return { ok: false, reason: 'invalid-save', rewards: [] };
    }
    var before = { coins: save.coins, dice: save.owned.dice.slice(), claims: save.rewardClaims.slice(), crownFrame: save.flags.crownFrame };
    var unlocked = [];
    REWARDS.forEach(function (reward) {
      if (reward.level <= fromLevel || reward.level > toLevel || save.rewardClaims.indexOf(reward.level) >= 0) return;
      if (reward.kind === 'coins') save.coins += reward.amount;
      else if (reward.kind === 'dice' && save.owned.dice.indexOf(reward.id) < 0) save.owned.dice.push(reward.id);
      else if (reward.kind === 'frame') save.flags.crownFrame = true;
      save.rewardClaims.push(reward.level);
      unlocked.push({ level: reward.level, kind: reward.kind, id: reward.id || null, amount: reward.amount || 0, title: reward.title });
    });
    if (!unlocked.length) return { ok: true, rewards: [] };
    var saved = false;
    try { saved = persist() === true; } catch (error) { saved = false; }
    if (!saved) {
      save.coins = before.coins;
      save.owned.dice = before.dice;
      save.rewardClaims = before.claims;
      if (typeof before.crownFrame === 'undefined') delete save.flags.crownFrame;
      else save.flags.crownFrame = before.crownFrame;
      return { ok: false, reason: 'save-failed', rewards: [] };
    }
    return { ok: true, rewards: unlocked };
  }
  function eligible(level, claims) {
    claims = Array.isArray(claims) ? claims : [];
    return REWARDS.map(function (reward) {
      return { level: reward.level, kind: reward.kind, id: reward.id || null, amount: reward.amount || 0,
        title: reward.title, unlocked: claims.indexOf(reward.level) >= 0, reached: level >= reward.level };
    });
  }
  return { REWARDS: REWARDS.map(function (item) { return Object.assign({}, item); }), collect: collect, eligible: eligible };
});
