'use strict';
const assert = require('node:assert/strict');
const controls = require('../www/js/online-classic-controls.js');

const roll = controls.build({ phase: 'roll' }, 'Alice', true, true, false, []);
assert.equal(roll.visible, true);
assert.equal(roll.status, 'Your turn. Roll the server die to continue.');
assert.deepEqual(roll.actions, [{ key: 'roll', type: 'roll', label: 'Roll server die' }]);

const waiting = controls.build({ phase: 'move' }, 'Bob', false, true, false, [{ piece: 0, v: 6 }]);
assert.equal(waiting.actions.length, 0, 'opponents cannot receive active controls');
assert.match(waiting.status, /Bob is taking their turn/);

const reconnecting = controls.build({ phase: 'roll' }, 'Alice', true, false, false, []);
assert.equal(reconnecting.actions.length, 0, 'actions stay paused until room state is synchronized');
assert.match(reconnecting.status, /room reconnects/);

const pending = controls.build({ phase: 'roll' }, 'Alice', true, true, true, []);
assert.equal(pending.actions.length, 0, 'a second action is not offered while one is pending');
assert.match(pending.status, /Retry pending action/);

const moves = controls.build({ phase: 'move' }, 'Alice', true, true, false, [
  { piece: 0, v: 6 }, { piece: 0, v: 6 }, { piece: 2, v: 3 },
  { piece: 'bad', v: 5 }, { piece: 4, v: 2 }, { piece: 1, v: 9 }
]);
assert.equal(moves.actions.length, 2, 'legal actions are deduplicated and malformed moves are ignored');
assert.deepEqual(moves.actions.map(action => action.label), ['Move token 1 by 6', 'Move token 3 by 3']);

const complete = controls.build({ phase: 'over' }, 'Alice', true, true, false, []);
assert.equal(complete.visible, false, 'completed matches do not show actionable controls');
assert.equal(complete.actions.length, 0);

console.log('Online Classic accessible controls tests passed.');
