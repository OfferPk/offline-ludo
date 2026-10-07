'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { summarize } = require('../www/js/online-classic-result-share.js');

const roster = [
  { seat: 0, displayName: 'Amina' },
  { seat: 1, displayName: 'Bilal' },
  { seat: 2, handle: 'clara_player' },
  { seat: 3, displayName: '   ' }
];

assert.equal(summarize({ phase: 'roll', ranking: [0] }, roster), '', 'active matches cannot be shared as completed results');
assert.equal(summarize({ phase: 'over', ranking: [] }, roster), '', 'an empty ranking does not invent a winner');
assert.equal(summarize({ phase: 'over', ranking: null }, roster), '', 'malformed rankings are ignored');
assert.equal(summarize({ phase: 'over', ranking: [4, -1, null, '2', 2, 0], abandoned: ['1', 3, 3] }, roster), [
  'Online Classic Ludo — final result',
  '1st — clara_player',
  '2nd — Amina',
  'Left early — Bilal, Seat 4'
].join('\n'), 'valid server order is preserved, duplicate/out-of-range seats are ignored, and unranked departures are labelled');
assert.equal(summarize({ phase: 'over', ranking: [0], abandoned: [] }, [{ seat: 0, displayName: '  <img src=x>\nAmina\u202e  ' }]), [
  'Online Classic Ludo — final result',
  '1st — <img src=x> Amina'
].join('\n'), 'player names are plain text with control and bidi formatting removed');
assert.equal(summarize({ phase: 'over', ranking: ['0', '0', 1], abandoned: [] }, []), [
  'Online Classic Ludo — final result',
  '1st — Seat 1',
  '2nd — Seat 2'
].join('\n'), 'missing profiles use seat labels and duplicate rankings are not repeated');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const online = fs.readFileSync(path.join(root, 'www/js/online.js'), 'utf8');
assert.ok(html.indexOf('js/online-classic-result-share.js') < html.indexOf('js/online.js'), 'the result helper loads before Online room code');
assert.match(html, /id="online-classic-result-share-button"[^>]*>Share result</, 'the final-result action has a clear button label');
assert.match(online, /OnlineClassicResultShare\.summarize\(/, 'Online room rendering uses the tested summary helper');
assert.match(online, /navigator\.share/, 'the share sheet is user-triggered from the action handler');
assert.match(online, /navigator\.clipboard/, 'clipboard is available as a fallback');

console.log('Online Classic result-share tests passed.');
