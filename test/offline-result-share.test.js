'use strict';

const assert = require('node:assert/strict');
const share = require('../www/js/offline-result-share.js');
const names = ['Coral', 'Jade', 'Saffron', 'Cobalt'];

assert.equal(share.summarize({ phase: 'roll', players: [0, 1], ranking: [0] }, names), '', 'active matches cannot be shared as completed results');
assert.equal(share.summarize({ phase: 'over', players: [0, 1], ranking: [] }, names), '', 'an empty ranking does not invent a winner');
assert.equal(share.summarize({ phase: 'over', players: [0, 1], ranking: null }, names), '', 'malformed rankings are ignored');

const completed = {
  phase: 'over', mode: 'quick', players: [3, 1, 3, 9], ranking: [3, 3, 1, 0, -1],
  seats: [null, { type: 'ai', level: 'hard' }, null, { type: 'human' }]
};
assert.equal(share.summarize(completed, names), [
  'Offline Ludo — final result',
  'Mode: Quick Ludo',
  '1st — You',
  '2nd — Jade (Hard computer)'
].join('\n'), 'only participating ranked seats appear, in game order, and a solo human is labeled You');

const named = {
  phase: 'over', mode: 'team', players: [0, 1], ranking: [0, 1],
  seats: [{ type: 'human', name: '  <Amina>\n\u202e ' }, { type: 'human', name: '' }]
};
assert.equal(share.summarize(named, names), [
  'Offline Ludo — final result',
  'Mode: Team Ludo',
  '1st — <Amina>',
  '2nd — Jade'
].join('\n'), 'names are plain text, control/bidi characters are stripped, and unnamed pass-and-play seats use a safe local label');

assert.equal(share.summarize({ phase: 'over', mode: 'unknown', players: ['1'], ranking: [1], seats: [] }, names), '', 'unexpected string seat indexes cannot fabricate participants');
assert.equal(share.summarize({ phase: 'over', players: [0], ranking: [3], seats: [] }, names), '', 'a ranking for a nonparticipant is ignored');
console.log('Offline result sharing unit tests passed.');
