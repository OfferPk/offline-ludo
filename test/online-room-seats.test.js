'use strict';

const assert = require('node:assert/strict');
const { listSeats } = require('../www/js/online-room-seats.js');

const bob = { seat: 2, user_id: 'bob' };
const alice = { seat: 0, user_id: 'alice' };

assert.deepEqual(listSeats(4, [bob, alice], true), [
  { seat: 0, member: alice },
  { seat: 1, member: null },
  { seat: 2, member: bob },
  { seat: 3, member: null }
], 'waiting rooms sort occupied seats and show each vacancy in place');

assert.deepEqual(listSeats(4, [bob, alice], false), [
  { seat: 0, member: alice },
  { seat: 2, member: bob }
], 'active rooms keep seat ordering without suggesting vacant seats can be joined');

assert.deepEqual(listSeats(2, [alice, { seat: 9, user_id: 'outside' }, null], true), [
  { seat: 0, member: alice },
  { seat: 1, member: null }
], 'invalid and out-of-range members do not create extra lobby rows');

assert.deepEqual(listSeats(99, [bob, alice], true), [
  { seat: 0, member: alice },
  { seat: 1, member: null },
  { seat: 2, member: bob }
], 'invalid capacity falls back to the highest valid occupied seat');

assert.deepEqual(listSeats(undefined, [], true), [], 'an empty invalid roster does not invent capacity');

console.log('Online room seat-list tests passed.');
