'use strict';
const assert = require('node:assert/strict');
const history = require('../www/js/offline-match-history.js');

function entry(completedAt, mode, ranking) {
  return { completedAt, mode: mode || 'classic', ranking: ranking || [3, 1] };
}

assert.equal(history.MAX_ENTRIES, 20);
assert.deepEqual(history.normalize(null), []);
assert.deepEqual(history.normalize([entry(10), { completedAt: 'bad', mode: 'classic', ranking: [3, 1] }]), [entry(10)]);
assert.equal(history.isValid([entry(10)]), true);
assert.equal(history.isValid([entry(10), { ...entry(11), ranking: [3, 3] }]), false);
assert.equal(history.isValid([entry(10, 'online_chess')]), false);
assert.equal(history.isValid([entry(10, 'classic', [4, 1])]), false);
assert.equal(history.isValid([entry(8640000000000001)]), false);

const source = [entry(20), entry(10)];
const appended = history.append(source, entry(30, 'quick', [1, 3]));
assert.deepEqual(appended, [entry(30, 'quick', [1, 3]), ...source]);
assert.deepEqual(source, [entry(20), entry(10)], 'append leaves the source untouched');
appended[0].ranking[0] = 0;
assert.deepEqual(source[0].ranking, [3, 1], 'history copies ranking arrays');

const newestFirst = Array.from({ length: 25 }, (_, index) => entry(100 - index));
const bounded = history.normalize(newestFirst);
assert.equal(bounded.length, history.MAX_ENTRIES);
assert.equal(bounded[0].completedAt, 100, 'newest entries stay first');
assert.equal(bounded[19].completedAt, 81, 'old entries are dropped at the fixed limit');
assert.equal(history.append(bounded, entry(101)).length, history.MAX_ENTRIES);
assert.equal(history.append(bounded, entry(101))[0].completedAt, 101);

assert.deepEqual(history.recordCompletedMatch([], { phase: 'over', mode: 'classic', ranking: [3, 1] }, false, 500), [entry(500)]);
assert.deepEqual(history.recordCompletedMatch([entry(10)], { phase: 'over', mode: 'classic', ranking: [3, 1] }, true, 500), [entry(10)], 'Online matches never enter local offline history');
assert.deepEqual(history.recordCompletedMatch([], { phase: 'move', mode: 'classic', ranking: [3, 1] }, false, 500), [], 'unfinished games are ignored');
assert.equal(history.modeLabel('mystery'), 'Mystery Tiles');
assert.equal(history.modeLabel('<unknown>'), 'Offline game');

console.log('offline-match-history.test.js: all assertions passed');
