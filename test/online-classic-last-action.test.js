'use strict';

const assert = require('node:assert/strict');
const { format } = require('../www/js/online-classic-last-action.js');

assert.equal(format({ type: 'roll', seat: 1, face: 6 }, { 1: 'Bob' }), 'Bob rolled 6.');
assert.equal(format({ type: 'forfeit', seat: 0, face: 6 }, { 0: 'Alice' }), 'Alice rolled a third 6; the turn was forfeited.');
assert.equal(format({
  type: 'move', seat: 0, piece: 2, die: 4,
  captures: [{ seat: 1, piece: 0 }, { seat: 1, piece: 3 }], finish: true
}, { 0: 'Alice' }), 'Alice moved token 3 by 4; captured 2 tokens and reached home.');
assert.equal(format({ type: 'move', seat: 2, piece: 0, die: 3, captures: [], finish: false }, {}), 'Player 3 moved token 1 by 3.');
assert.equal(format({ type: 'move', seat: 0, piece: 9, die: 3 }, { 0: 'Alice' }), '', 'invalid piece indices are ignored');
assert.equal(format({ type: 'roll', seat: 0, face: 8 }, { 0: 'Alice' }), '', 'invalid die values are ignored');
assert.equal(format({ type: 'unknown', seat: 0 }, { 0: 'Alice' }), '', 'unknown server actions are ignored');
assert.equal(format(null, {}), '');

console.log('Online Classic last-action formatter tests passed.');
