'use strict';
const assert = require('node:assert/strict');
const Announcements = require('../www/js/offline-move-announcements.js');
let checks = 0;
function check(actual, expected, description) {
  assert.equal(actual, expected, description);
  checks++;
  console.log('  ok - ' + description);
}

check(Announcements.format({ actor: 'You', piece: 0, fromBase: true, destination: 'track', spaces: 1 }),
  'You moved token 1 out of the base and onto the track.', 'announces a token leaving its base');
check(Announcements.format({ actor: 'Coral', piece: 2, destination: 'track', spaces: 1 }),
  'Coral moved token 3 1 space onto the track.', 'uses singular wording for a one-space move');
check(Announcements.format({ actor: 'Jade', piece: 1, destination: 'home-lane', spaces: 4 }),
  'Jade moved token 2 4 spaces into the home lane.', 'announces entry into the home lane');
check(Announcements.format({ actor: 'You', piece: 3, destination: 'home', finished: true }),
  'You moved token 4 home. You finished all your tokens.', 'announces reaching home and completing all tokens');
check(Announcements.format({ actor: 'Coral', piece: 0, destination: 'base', captures: [{ actor: 'Jade', piece: 2 }] }),
  "Coral moved token 1 back to the base. Captured Jade's token 3.", 'announces a captured token');
check(Announcements.format({ actor: 'You', piece: 0, destination: 'track', spaces: 3, captures: [{ actor: 'Red', piece: 0 }, { actor: 'Blue', piece: 1 }] }),
  "You moved token 1 3 spaces onto the track. Captured Red's token 1, Blue's token 2.", 'announces multiple captures without losing their owners');
check(Announcements.format({ actor: 'You', piece: 1, destination: 'track', spaces: 2, event: true }),
  'You moved token 2 2 spaces onto the track. A tile event followed.', 'marks a follow-up tile event without guessing its outcome');
check(Announcements.format({ actor: '<img src=x> Guest\u202e', piece: 0, destination: 'track', spaces: 2 }),
  'Guest moved token 1 2 spaces onto the track.', 'strips markup and bidi controls from player labels');
check(Announcements.format({ actor: 'A'.repeat(100), piece: 0, destination: 'track', spaces: 2 }).length <= 600,
  true, 'bounds the length of player-generated announcement text');
check(Announcements.format({ actor: 'Red', piece: 4, destination: 'track', spaces: 2 }),
  '', 'rejects an invalid token index');
check(Announcements.format(null), '', 'ignores an invalid move payload');

console.log('\nOffline move announcement unit tests passed (' + checks + ' checks).');
