'use strict';

const assert = require('node:assert/strict');
const { describe } = require('../www/js/online-classic-room-summary.js');

function room(overrides = {}) {
  return Object.assign({
    mode: 'classic',
    status: 'active',
    roster: [
      { user_id: 'alice', seat: 0, displayName: 'Alice' },
      { user_id: 'bob', seat: 1, displayName: 'Bob' }
    ],
    matchState: { state: { players: [0, 1], turn: 0, phase: 'roll' } }
  }, overrides);
}

assert.equal(describe(room(), 'alice'), 'Your turn: roll the dice.');
assert.equal(describe(room({ matchState: { state: { players: [0, 1], turn: 1, phase: 'move' } } }), 'alice'), "Bob's turn: choose a token.");
assert.equal(describe(room({ roster: [{ user_id: 'bob', seat: 1 }] , matchState: { state: { players: [0, 1], turn: 1, phase: 'roll' } } }), 'alice'), "Seat 2's turn: roll the dice.");
assert.equal(describe(room({ roster: [{ user_id: 'alice', seat: 0, displayName: '  ' , handle: '  alice123 ' }] }), 'alice'), 'Your turn: roll the dice.');
assert.equal(describe(room({ mode: 'ludo_chess' }), 'alice'), '', 'Chess uses its own match status');
assert.equal(describe(room({ status: 'waiting' }), 'alice'), '', 'waiting rooms do not show an active turn');
assert.equal(describe(room({ status: 'completed' }), 'alice'), '', 'completed rooms do not show a live turn');
assert.equal(describe(room({ matchState: { state: { players: [0, 1], turn: 0, phase: 'over' } } }), 'alice'), '', 'finished match states do not show an active turn');
assert.equal(describe(room({ matchState: { state: { players: [0, 1], turn: 4, phase: 'roll' } } }), 'alice'), '', 'out-of-range seats are rejected');
assert.equal(describe(room({ matchState: { state: { players: [0, 1], turn: 2, phase: 'roll' } } }), 'alice'), '', 'a turn must belong to a participating seat');
assert.equal(describe(room({ matchState: { state: { players: [0, 1], turn: 0, phase: 'unknown' } } }), 'alice'), '', 'unknown action phases are not guessed');
assert.equal(describe(room({ matchState: null }), 'alice'), '', 'older rooms without authoritative state remain unchanged');

console.log('Online Classic room turn-summary tests passed.');
