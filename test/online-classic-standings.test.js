'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, ordinal } = require('../www/js/online-classic-standings.js');

const roster = [
  { seat: 0, user_id: 'user-a', displayName: 'Amina' },
  { seat: 1, user_id: 'user-b', displayName: 'Bilal' },
  { seat: 2, user_id: 'user-c', displayName: 'Clara' },
  { seat: 3, user_id: 'user-d', handle: 'dplayer' }
];

assert.deepEqual(build({ phase: 'roll', ranking: [], abandoned: [] }, roster, 'user-a'), [], 'active matches do not show final standings');
assert.deepEqual(build({ phase: 'over', ranking: [], abandoned: [] }, roster, 'user-a'), [], 'an empty result snapshot does not invent placements');

const final = build({ phase: 'over', ranking: [2, 0], abandoned: [1, 3] }, roster, 'user-a');
assert.deepEqual(final, [
  { seat: 2, place: '1st', name: 'Clara', note: 'Winner', status: 'ranked', isYou: false },
  { seat: 0, place: '2nd', name: 'Amina', note: 'You', status: 'ranked', isYou: true },
  { seat: 1, place: '—', name: 'Bilal', note: 'Left early', status: 'abandoned', isYou: false },
  { seat: 3, place: '—', name: 'dplayer', note: 'Left early', status: 'abandoned', isYou: false }
], 'the server ranking stays in order and abandoned seats are not assigned a place');

const sparse = build({ phase: 'over', ranking: [4, -1, '2', 2], abandoned: ['2', 3, 3] }, [], null);
assert.deepEqual(sparse, [
  { seat: 2, place: '1st', name: 'Seat 3', note: 'Winner', status: 'ranked', isYou: false },
  { seat: 3, place: '—', name: 'Seat 4', note: 'Left early', status: 'abandoned', isYou: false }
], 'invalid and duplicate seats are ignored, and missing roster names use seat labels');

assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);

const root = path.resolve(__dirname, '..');
const online = fs.readFileSync(path.join(root, 'www/js/online.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
assert.match(online, /OnlineClassicStandings\.render\(/, 'the room renderer wires final standings into live Online updates');
assert.match(online, /show && room\.mode !== 'ludo_chess' \? record\.state : null/, 'Chess and non-final states cannot show Classic standings');
assert.ok(html.indexOf('js/online-classic-standings.js') < html.indexOf('js/online.js'), 'the standings renderer loads before Online room code');
assert.match(html, /id="online-classic-standings"[^>]*aria-labelledby="online-classic-standings-title"/, 'the final-standings section has an accessible label');

console.log('Online Classic standings unit tests passed.');
