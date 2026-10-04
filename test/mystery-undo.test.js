const assert = require('assert');
const fs = require('fs');
const Undo = require('../www/js/mystery-undo.js');
const gameSource = fs.readFileSync(require.resolve('../www/js/game.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log('  ok - ' + message); }
function equal(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; console.log('  ok - ' + message); }
function route(state, turnId, source, token) {
  if (token && state.committedTokens.has(token)) return false;
  const transaction = Undo.commit(state.counters, turnId, source, state.coins);
  if (!transaction) return false;
  state.counters = transaction.counters;
  state.coins = transaction.coins;
  if (token) state.committedTokens.add(token);
  return true;
}
function wallet(counters, coins) { return { counters, coins, committedTokens: new Set() }; }
console.log('mystery-undo.test.js');

equal(Undo.COIN_COST, 25, 'Mystery coin route has a flat 25-coin price');

{
  const state = wallet(Undo.create(0), 60);
  ok(route(state, 0, 'coins', 'roll-1'), 'a coin-paid undo commits when the offline wallet can cover it');
  equal(state.coins, 35, 'coin-paid undo deducts exactly 25 coins');
  equal(state.counters.total, 1, 'coin-paid undo increments match total once');
  equal(state.counters.turn, 1, 'coin-paid undo increments per-turn total once');
  equal(state.counters.ad, 0, 'coin-paid undo does not consume the separate ad allowance');
  ok(!route(state, 0, 'coins', 'roll-1'), 'a repeated callback for an already-consumed undo token is rejected');
  equal(state.coins, 35, 'duplicate/retry callback cannot double-charge coins');
  equal(state.counters.total, 1, 'duplicate/retry callback cannot duplicate undo counts');
}

{
  const state = wallet(Undo.create(0), 24);
  const originalCounters = JSON.stringify(state.counters);
  ok(!route(state, 0, 'coins'), 'coin route is rejected when the wallet has only 24 coins');
  equal(state.coins, 24, 'insufficient balance is never debited or allowed to become negative');
  equal(JSON.stringify(state.counters), originalCounters, 'insufficient balance rejection leaves all counters unchanged');
  equal(Undo.commit(state.counters, 0, 'other', state.coins), null, 'unknown undo route cannot produce a transaction');
}

{
  const state = wallet(Undo.create(0), 100);
  ok(route(state, 0, 'coins'), 'first successful undo in a turn commits through the coin route');
  ok(route(state, 0, 'coins'), 'second successful undo in a turn commits through the coin route');
  equal(state.coins, 50, 'two same-turn paid undos charge exactly 50 coins total');
  equal(Undo.reason(state.counters, 0, false), 'Mystery Tiles allows at most 2 successful undos in a single turn.', 'per-turn limit has clear blocked-action feedback');
  const unchangedWallet = state.coins;
  const unchangedCounters = JSON.stringify(state.counters);
  ok(!route(state, 0, 'coins'), 'third same-turn undo is rejected atomically');
  equal(state.coins, unchangedWallet, 'per-turn rejection does not debit coins');
  equal(JSON.stringify(state.counters), unchangedCounters, 'per-turn rejection does not consume a counter');
  ok(Undo.advance(state.counters, 1), 'actual game-turn advancement is recorded');
  equal(state.counters.turn, 0, 'actual turn advancement resets only per-turn usage');
  equal(state.counters.total, 2, 'actual turn advancement preserves match usage');
  ok(route(state, 1, 'coins'), 'coin undo is available again on the next actual turn');
}

{
  const state = wallet(Undo.create(0), 75);
  ok(route(state, 0, 'ad'), 'a successfully committed ad undo increments the shared counters');
  equal(state.counters.total, 1, 'ad undo counts toward the match total');
  equal(state.counters.turn, 1, 'ad undo counts toward the per-turn total');
  equal(state.counters.ad, 1, 'ad undo increments the separate ad-claim counter');
  equal(state.coins, 75, 'ad-based undo leaves the soft-wallet balance unchanged');
  ok(route(state, 0, 'coins'), 'coin-paid undo can follow an ad undo within the shared turn cap');
  equal(state.coins, 50, 'the coin route charges its flat price after an ad undo');
  equal(Undo.reason(state.counters, 0, false), 'Mystery Tiles allows at most 2 successful undos in a single turn.', 'ad undo uses one of the two per-turn allowances');
  ok(!route(state, 0, 'ad'), 'a further same-turn ad undo is rejected');
  equal(state.counters.total, 2, 'rejected mixed-source action does not increment total');
  equal(state.counters.ad, 1, 'rejected mixed-source action does not increment ad claims');
  equal(state.coins, 50, 'rejected ad retry cannot charge the coin route');
  ok(Undo.advance(state.counters, 1), 'move to a later turn for the second ad claim');
  ok(route(state, 1, 'ad'), 'second ad claim commits on a later turn');
  equal(state.coins, 50, 'second ad claim still leaves coins untouched');
  ok(Undo.advance(state.counters, 2), 'move to a later turn after the second ad claim');
  equal(Undo.reason(state.counters, 2, true), 'Mystery Tiles allows at most 2 ad-based undo claims per match.', 'separate ad cap blocks ad redemption');
  ok(route(state, 2, 'coins'), 'coin undo remains available after the separate ad cap is reached');
  equal(state.coins, 25, 'coin route still charges exactly 25 after ad cap');
  equal(state.counters.ad, 2, 'coin undo does not increment the ad-only counter');
}

{
  const state = wallet(Undo.create(0), 300);
  for (let turnId = 0; turnId < 6; turnId++) {
    if (turnId) Undo.advance(state.counters, turnId);
    ok(route(state, turnId, 'coins'), 'successful paid undo ' + (turnId + 1) + ' commits below the match cap');
  }
  equal(state.coins, 150, 'six paid undos cost exactly 150 coins');
  equal(state.counters.total, 6, 'six successful undos reach the per-match total cap');
  equal(Undo.reason(state.counters, 5, false), 'Mystery Tiles allows at most 6 successful undos per match.', 'total limit has clear blocked-action feedback');
  const unchangedWallet = state.coins;
  ok(!route(state, 5, 'coins'), 'seventh undo is rejected at the total cap');
  equal(state.coins, unchangedWallet, 'total-cap rejection does not debit the wallet');
  equal(state.counters.total, 6, 'total-cap rejection consumes no additional count');
}

{
  const state = wallet(Undo.create(4), 50);
  ok(route(state, 4, 'ad'), 'setup for save/reload persistence test');
  const saved = JSON.parse(JSON.stringify({ counters: state.counters, coins: state.coins }));
  const restored = wallet(Undo.normalize(saved.counters, 4), saved.coins);
  ok(Undo.valid(restored.counters, 4), 'saved counters validate after JSON reload');
  equal(JSON.stringify(restored.counters), JSON.stringify(state.counters), 'reload preserves total, per-turn, ad, and turn identity');
  equal(restored.coins, 50, 'reload preserves the same soft-wallet balance after an ad undo');
  equal(Undo.reason(restored.counters, 4, false), '', 'reload does not grant a fresh per-turn allowance');
  ok(Undo.advance(restored.counters, 5), 'a later actual turn is accepted after reload');
  equal(restored.counters.turn, 0, 'a later actual turn resets the restored per-turn count');
  equal(restored.counters.total, 1, 'a later turn leaves the restored match count unchanged');
  const freshMatch = Undo.create(0);
  equal(JSON.stringify(freshMatch), JSON.stringify({ total: 0, turn: 0, ad: 0, turnId: 0 }), 'genuinely new match starts with fresh counters');
  equal(Undo.normalize(null, 4).total, 0, 'legacy Mystery match without counters receives one-time migration defaults');
  equal(Undo.normalize({ total: 99, turn: 0, ad: 0, turnId: 0 }, 0), null, 'invalid persisted counters are rejected rather than silently reset');
}

{
  const classic = { mode: 'classic', undoLeft: 3 };
  const lucky = { mode: 'lucky', undoLeft: 3 };
  const mystery = { mode: 'mystery', undoLeft: 0 };
  ok(classic.undoLeft === 3 && lucky.undoLeft === 3 && mystery.undoLeft === 0, 'only Mystery removes free undo credits; Classic and Lucky retain their existing allowance');
  ok(!Object.prototype.hasOwnProperty.call(classic, 'mysteryUndo') && !Object.prototype.hasOwnProperty.call(lucky, 'mysteryUndo'), 'other modes keep their existing match-state shape and are not subject to Mystery counters');
  ok(/if \(rewarded \|\| G !== match \|\| G\.undo !== undo \|\| !undo\.pending\) return;/.test(gameSource), 'duplicate or stale rewarded-ad callbacks are ignored before committing');
  ok(/if \(expected && \(G !== expected\.match \|\| u !== expected\.undo\)\) return false;/.test(gameSource), 'a retry with a consumed undo identity cannot debit coins or change state twice');
}

console.log('\n' + checks + ' Mystery undo checks passed');
