'use strict';
const assert = require('node:assert/strict');
const Evolution = require('../www/js/token-evolution.js');
let checks = 0;
function test(name, run) { run(); checks++; console.log('  ok - ' + name); }
function save(progress, coins = 17) { return { tokenEvo: 1, tokenEvoUnlocked: 1, tokenProgress: { completed: progress, roomCompletions: [] }, coins }; }

console.log('token-evolution.test.js');
test('defines the five free levels and documents match-completion milestones only', () => {
  assert.deepEqual(Evolution.LEVELS.map(level => level.name), ['Basic', 'Polished', 'Elite', 'Mythic', 'Legendary']);
  assert.deepEqual(Evolution.LEVELS.map(level => level.matchesRequired), [0, 2, 5, 10, 20]);
  assert.equal(Evolution.maxLevel, 5);
  assert.equal(/coinCost|coins|diamonds|purchase|wins/i.test(JSON.stringify(Evolution.LEVELS)), false);
});
test('requires two completed matches for Polished and reports the next free milestone', () => {
  const state = save(1), gate = Evolution.canUnlockNext(state);
  assert.equal(gate.ok, false); assert.equal(gate.needMatches, 1); assert.equal(gate.next.name, 'Polished');
  state.tokenProgress.completed = 2; assert.equal(Evolution.canUnlockNext(state).ok, true);
});
test('unlocks and selects the next evolution for free without changing coins', () => {
  const state = save(2), before = state.coins, result = Evolution.unlockNext(state, () => true);
  assert.equal(result.ok, true); assert.equal(result.free, true); assert.equal(result.spent, 0);
  assert.equal(state.tokenEvo, 2); assert.equal(state.tokenEvoUnlocked, 2); assert.equal(state.coins, before);
});
test('selection is persisted and rolls back safely when local storage fails', () => {
  const state = save(5); state.tokenEvoUnlocked = 3;
  assert.equal(Evolution.select(state, 3, () => true).ok, true); assert.equal(state.tokenEvo, 3);
  const failed = Evolution.select(state, 2, () => false);
  assert.equal(failed.reason, 'save-failed'); assert.equal(state.tokenEvo, 3);
  assert.equal(Evolution.select(state, 5, () => true).reason, 'not-unlocked');
});
test('completed-match progress collects every earned tier while leaving coin balance unchanged', () => {
  const state = save(20), before = state.coins, tiers = Evolution.collectEligible(state);
  assert.deepEqual(tiers.map(item => item.name), ['Polished', 'Elite', 'Mythic', 'Legendary']);
  assert.equal(state.tokenEvoUnlocked, 5); assert.equal(state.tokenEvo, 5); assert.equal(state.coins, before);
});
test('keeps existing valid selections and bounded visual-level variables', () => {
  const state = save(0); state.tokenEvoUnlocked = 4; state.tokenEvo = 3;
  assert.deepEqual(Evolution.normalize(state), { unlocked: 4, selected: 3 });
  assert.equal(Evolution.cssVars(5).label, 'Legendary'); assert.equal(Evolution.cssVars(5).particles, 5);
});
test('invalid levels normalize without exceeding Legendary', () => {
  assert.deepEqual(Evolution.normalize({ tokenEvoUnlocked: 999, tokenEvo: -7 }), { unlocked: 5, selected: 1 });
  assert.equal(Evolution.clampLevel(100), 5); assert.equal(Evolution.clampLevel('3'), 1);
});
console.log('\n' + checks + ' Token Evolution checks passed.');
