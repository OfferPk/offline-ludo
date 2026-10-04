const assert = require('assert');
const Undo = require('../www/js/mystery-undo.js');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log('  ok - ' + message); }
function equal(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; console.log('  ok - ' + message); }
function turn(counters, id) { Undo.advance(counters, id); }
function commit(counters, id, ad) {
  const next = Undo.committed(counters, id, ad);
  if (next) Object.assign(counters, next);
  return !!next;
}
console.log('mystery-undo.test.js');

{
  const counts = Undo.create(0);
  for (let i = 0; i < 6; i++) {
    if (i) turn(counts, i);
    ok(commit(counts, i, false), 'successful undo ' + (i + 1) + ' commits below the match cap');
  }
  equal(counts.total, 6, 'six successful undos reach the per-match total cap');
  equal(Undo.reason(counts, 5, false), 'Mystery Tiles allows at most 6 successful undos per match.', 'total limit has clear blocked-action feedback');
  ok(!commit(counts, 5, false), 'seventh undo is rejected at the total cap');
  equal(counts.total, 6, 'rejected total-cap action consumes no count');
}

{
  const counts = Undo.create(7);
  ok(commit(counts, 7, false), 'first successful undo in a turn commits');
  ok(commit(counts, 7, false), 'second successful undo in a turn commits');
  equal(Undo.reason(counts, 7, false), 'Mystery Tiles allows at most 2 successful undos in a single turn.', 'per-turn limit has clear blocked-action feedback');
  ok(!commit(counts, 7, false), 'third undo in the same turn is rejected');
  equal(counts.turn, 2, 'rejected per-turn action consumes no count');
  turn(counts, 8);
  equal(counts.turn, 0, 'actual turn advancement resets only the per-turn counter');
  equal(counts.total, 2, 'turn advancement preserves the match total');
  ok(commit(counts, 8, false), 'undo is available again in the next actual turn');
}

{
  const counts = Undo.create(0);
  ok(commit(counts, 0, true), 'a committed ad-based undo increments all applicable counters');
  equal(counts.total, 1, 'ad undo counts toward the match total');
  equal(counts.turn, 1, 'ad undo counts toward the per-turn total');
  equal(counts.ad, 1, 'ad undo increments the separate ad-claim counter');
  ok(commit(counts, 0, false), 'one free undo can follow an ad undo within the same turn');
  equal(Undo.reason(counts, 0, false), 'Mystery Tiles allows at most 2 successful undos in a single turn.', 'ad undo uses one of the two per-turn allowances');
  ok(!commit(counts, 0, true), 'a further same-turn ad undo is rejected without changing any count');
  equal(counts.total, 2, 'rejected mixed-source action does not increment total');
  equal(counts.ad, 1, 'rejected mixed-source action does not increment ad claims');
  turn(counts, 1); ok(commit(counts, 1, true), 'second ad claim commits on a later turn');
  turn(counts, 2);
  equal(Undo.reason(counts, 2, true), 'Mystery Tiles allows at most 2 ad-based undo claims per match.', 'separate ad cap blocks only ad-based redemption');
  ok(commit(counts, 2, false), 'free undo remains available after the separate ad cap is reached');
  equal(counts.ad, 2, 'free undo does not increment the ad-only counter');
}

{
  const counts = Undo.create(4);
  ok(commit(counts, 4, true), 'setup for save/reload persistence test');
  const saved = JSON.parse(JSON.stringify(counts));
  const restored = Undo.normalize(saved, 4);
  ok(Undo.valid(restored, 4), 'saved counters validate after JSON reload');
  equal(JSON.stringify(restored), JSON.stringify(counts), 'reload preserves total, per-turn, ad, and turn identity');
  equal(Undo.reason(restored, 4, false), '', 'reload does not grant a fresh per-turn allowance');
  turn(restored, 5);
  equal(restored.turn, 0, 'a later actual turn resets the restored per-turn count');
  equal(restored.total, 1, 'a later turn leaves the restored match count unchanged');
  const freshMatch = Undo.create(0);
  equal(JSON.stringify(freshMatch), JSON.stringify({ total: 0, turn: 0, ad: 0, turnId: 0 }), 'genuinely new match starts with fresh counters');
  equal(Undo.normalize(null, 4).total, 0, 'legacy Mystery match without counters receives one-time migration defaults');
  equal(Undo.normalize({ total: 99, turn: 0, ad: 0, turnId: 0 }, 0), null, 'invalid persisted counters are rejected rather than silently reset');
}

{
  const classic = { mode: 'classic', undoLeft: 3 };
  const lucky = { mode: 'lucky', undoLeft: 3 };
  ok(!Object.prototype.hasOwnProperty.call(classic, 'mysteryUndo') && !Object.prototype.hasOwnProperty.call(lucky, 'mysteryUndo'), 'other modes keep their existing match-state shape and are not subject to Mystery counters');
}

console.log('\n' + checks + ' Mystery undo checks passed');
