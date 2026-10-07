'use strict';

const assert = require('node:assert/strict');
const { format } = require('../www/js/offline-roll-announcements.js');

assert.equal(format(null), '', 'missing results do not produce an announcement');
assert.equal(format({ raw: 0, next: 'move' }), '', 'invalid die faces are ignored');
assert.equal(format({ actor: 'You', raw: 2, value: 2, next: 'move', queue: [2], legalTokenCount: 1 }),
  'You rolled 2. One token can move.', 'a single die outcome announces the playable-token count');
assert.equal(format({ actor: 'Coral', raw: 3, value: 3, next: 'move', queue: [6, 6, 3], legalTokenCount: 2 }),
  'Coral rolled 3. Dice available: 6, 6, 3. 2 tokens can move.', 'stacked dice and duplicate values remain in their turn order');
assert.equal(format({ actor: 'You', raw: 4, value: 8, doubled: true, next: 'move', queue: [8], legalTokenCount: 1 }),
  'You rolled 4. The move value is doubled to 8. One token can move.', 'Lucky double values distinguish the physical roll from the move value');
assert.equal(format({ actor: 'You', raw: 5, value: 5, chosen: true, next: 'pass' }),
  'You selected 5. No token can move; the turn passes.', 'forced number choices and no-move turn passes are explicit');
assert.equal(format({ actor: 'Jade', raw: 6, value: 6, next: 'roll' }),
  'Jade rolled 6. Roll again.', 'an extra roll is announced');
assert.equal(format({ actor: 'You', raw: 6, value: 6, forfeit: true, next: 'pass' }),
  'You rolled 6. Three sixes in a row; your turn is forfeited.', 'the third six explains the forfeiture');
assert.equal(format({ actor: '<img>\u202eGuest\n', raw: 2, value: 2, next: 'again' }),
  '<img> Guest rolled 2. No token can move; roll again.', 'control and bidi characters are removed from player labels while plain text remains intact');
assert.equal(format({ actor: 'Player', raw: 2, value: 2, next: 'move', queue: [13, 2, -1], legalTokenCount: '99' }),
  'Player rolled 2. Choose a highlighted token.', 'invalid queue entries and impossible token counts are not announced');

console.log('Offline roll announcement unit tests passed.');
