'use strict';

const assert = require('node:assert/strict');
const { create } = require('../www/js/online-room-roster-announcements.js');

const emitted = [];
const announcer = create(message => emitted.push(message));
const initial = [
  { user_id: 'user-one', seat: 0, displayName: 'Amina', ready: true },
  { user_id: 'user-two', seat: 1, handle: 'rafi', ready: false }
];
assert.deepEqual(announcer.update('room-one', initial, 'user-one'), [], 'opening snapshot is not read aloud as a burst of changes');
assert.deepEqual(announcer.update('room-one', initial, 'user-one'), [], 'unchanged Realtime refreshes stay silent');
assert.deepEqual(emitted, []);

const withNewPlayer = initial.concat([{ user_id: 'user-three', seat: 2, display_name: 'Sam', ready: false }]);
assert.deepEqual(announcer.update('room-one', withNewPlayer, 'user-one'), ['Sam joined the room.']);
assert.equal(emitted.at(-1), 'Sam joined the room.');

const opponentReady = withNewPlayer.map(member => member.user_id === 'user-two' ? { ...member, ready: true } : member);
assert.deepEqual(announcer.update('room-one', opponentReady, 'user-one'), ['rafi is ready.']);
const opponentNotReady = opponentReady.map(member => member.user_id === 'user-two' ? { ...member, ready: false } : member);
assert.deepEqual(announcer.update('room-one', opponentNotReady, 'user-one'), ['rafi is not ready.']);

const ownReadyChanged = opponentNotReady.map(member => member.user_id === 'user-one' ? { ...member, ready: false } : member);
assert.deepEqual(announcer.update('room-one', ownReadyChanged, 'user-one'), [], 'the focused Ready control already communicates the current user’s own toggle');

const moved = withNewPlayer.map(member => member.user_id === 'user-two' ? { ...member, seat: 3 } : member);
assert.deepEqual(announcer.update('room-one', moved, 'user-one'), ['rafi moved to seat 4.'], 'seat changes are described while the user’s own ready toggle remains quiet');

const withoutSam = moved.filter(member => member.user_id !== 'user-three');
assert.deepEqual(announcer.update('room-one', withoutSam, 'user-one'), ['Sam left the room.']);
assert.deepEqual(announcer.update('room-two', initial, 'user-one'), [], 'joining a different room establishes a new quiet baseline');

announcer.reset();
assert.equal(emitted.at(-1), '', 'reset clears the stale live-region message');
assert.deepEqual(announcer.update('room-three', [{ seat: 0, ready: false }], 'user-one'), [], 'reset begins with a fresh snapshot');
const anonymousPlayerJoined = announcer.update('room-three', [{ seat: 0, ready: false }, { seat: 1, ready: true }], 'user-one');
assert.deepEqual(anonymousPlayerJoined, ['Player in seat 2 joined the room.'], 'missing names fall back to a useful seat label');

console.log('Online room-roster announcement tests passed.');
