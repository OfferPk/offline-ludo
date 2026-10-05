'use strict';
const assert = require('node:assert/strict');
const Token = require('../www/js/token-system.js');

let checks = 0;
function test(name, run) { run(); checks++; console.log('  ok - ' + name); }

console.log('token-system.test.js');
test('exposes the ten requested skins in their original order and the four complete named sets', () => {
  assert.deepEqual(Token.SKINS.map(item => item.name), ['Classic', 'Royal', 'Dragon', 'Cyber', 'Galaxy', 'Fire', 'Ice', 'Shadow', 'Diamond', 'Legendary']);
  assert.deepEqual(Token.SETS.map(item => item.name), ['Inferno', 'Frost', 'Galaxy', 'Royal']);
  for (const set of Token.SETS) assert.equal(set.pieces.length, 4, set.name);
});
test('keeps every Token 2.0 skin and set locked/unlocked solely by completed matches', () => {
  assert.equal(Token.isSkinUnlocked('classic', 0), true);
  assert.equal(Token.isSkinUnlocked('royal', 0), false);
  assert.equal(Token.isSkinUnlocked('royal', 1), true);
  assert.equal(Token.isSkinUnlocked('legendary', 19), false);
  assert.equal(Token.isSkinUnlocked('legendary', 20), true);
  assert.equal(Token.isSetUnlocked('frost', 2), false);
  assert.equal(Token.isSetUnlocked('frost', 3), true);
  assert.equal(Token.isSetUnlocked('royal', 12), true);
});
test('advances the five free evolution levels at the documented match-completion thresholds', () => {
  const milestones = [[0, 'Basic'], [2, 'Polished'], [5, 'Elite'], [10, 'Mythic'], [20, 'Legendary']];
  for (const [completed, name] of milestones) assert.equal(Token.levelFor(completed).name, name);
  assert.equal(Token.levelFor(1).next.at, 2);
  assert.equal(Token.levelFor(4).progress, 2 / 3);
  assert.equal(Token.levelFor(20).next, null);
  const next = Token.increment({ completed: 4 });
  assert.deepEqual(next, { completed: 5, roomCompletions: [] });
  assert.equal(Token.levelFor(next.completed).name, 'Elite');
});
test('normalizes corrupted progress and prevents selecting rewards before their free unlock thresholds', () => {
  assert.deepEqual(Token.normalizeProgress({ completed: -4 }), { completed: 0, roomCompletions: [] });
  assert.deepEqual(Token.normalizeProgress({ completed: Number.MAX_SAFE_INTEGER + 1 }), { completed: 0, roomCompletions: [] });
  assert.deepEqual(Token.normalizeIdentity({ skin: 'diamond', set: 'royal' }, 0), { skin: 'classic', set: 'inferno' });
  assert.deepEqual(Token.normalizeIdentity({ skin: 'dragon', set: 'frost' }, 3), { skin: 'dragon', set: 'frost' });
  assert.deepEqual(Token.normalizeProfileIdentity({ token_skin: '../unknown', token_set: 'not-a-set', token_level: 99 }), { skin: 'classic', set: 'inferno', level: 1 });
});
test('reports only freely reached unlocks and level changes at match milestones', () => {
  const unlocks = Token.unlockedSince({ completed: 2 }, { completed: 3 });
  assert.deepEqual(unlocks, [{ kind: 'skin', id: 'dragon', name: 'Dragon' }, { kind: 'set', id: 'frost', name: 'Frost set' }]);
  assert.deepEqual(Token.unlockedSince({ completed: 19 }, { completed: 20 }).map(item => item.name), ['Legendary', 'Level 5 Legendary']);
});
test('grants at most one local free reward for a completed authoritative online room', () => {
  const first = Token.recordRoomCompletion({ completed: 2 }, 'room_12345678');
  assert.equal(first.updated, true);
  assert.equal(first.progress.completed, 3);
  assert.deepEqual(first.progress.roomCompletions, ['room_12345678']);
  const duplicate = Token.recordRoomCompletion(first.progress, 'room_12345678');
  assert.equal(duplicate.updated, false);
  assert.equal(duplicate.progress.completed, 3);
  assert.equal(Token.recordRoomCompletion(first.progress, 'not safe/for storage').updated, false);
});
test('provides Royal, Cyber, Ancient, and Dragon-specific number treatments', () => {
  assert.equal(Token.skin('royal').numberStyle, 'roman');
  assert.equal(Token.numberFor('roman', 3), 'IV');
  assert.equal(Token.skin('cyber').numberStyle, 'digital');
  assert.equal(Token.numberFor('digital', 0), '01');
  assert.equal(Token.skin('galaxy').numberStyle, 'ancient');
  assert.equal(Token.skin('dragon').numberStyle, 'carved');
  assert.equal(Token.numberFor('carved', 2), '3');
});
test('renders a circular layered original SVG with a colored rim, crystal facets, number, seat marker, and four set emblems', () => {
  const markup = Token.svgMarkup({ idPrefix: 'test-token', skin: 'dragon', set: 'royal', pieceIndex: 2, seat: 3, material: 'sapphire' });
  assert.match(markup, /viewBox="0 0 24 24"/);
  assert.match(markup, /<circle class="gem-body" cx="12" cy="10\.5" r="7\.95"/);
  assert.match(markup, /<circle class="gem-rim-outer"/);
  assert.match(markup, /linearGradient id="test-token-rim"/);
  assert.match(markup, /class="gem-num number-carved"/);
  assert.match(markup, /data-seat-shape="diamond"/);
  assert.match(markup, /data-material="sapphire"/);
  assert.match(markup, /data-piece-name="Ruby"/);
  assert.doesNotMatch(markup, /<script|https?:\/\//i);
  assert.match(Token.svgMarkup({ idPrefix: 'frost', set: 'frost', pieceIndex: 1 }), /data-set="frost"/);
  assert.match(Token.svgMarkup({ idPrefix: 'galaxy', set: 'galaxy', pieceIndex: 3 }), /data-set="galaxy"/);
  assert.match(Token.svgMarkup({ idPrefix: 'inferno', set: 'inferno', pieceIndex: 0 }), /data-set="inferno"/);
});
test('adds only tiny skin/set-themed trails after evolution or an explicit non-Classic skin is selected', () => {
  assert.deepEqual(Token.trailColors({ skin: 'classic', set: 'inferno', level: 1 }), ['#fff2de', '#c8edff']);
  assert.deepEqual(Token.trailColors({ skin: 'classic', set: 'inferno', level: 2 }), ['#fff2de', '#c8edff']);
  assert.deepEqual(Token.trailColors({ skin: 'classic', set: 'frost', level: 1 }), ['#d9fbff', '#73d9ff']);
  assert.deepEqual(Token.trailColors({ skin: 'ice', set: 'inferno', level: 1 }), ['#d9fbff', '#73d9ff', '#ffffff']);
  assert.ok(Token.trailColors({ skin: 'legendary', set: 'royal', level: 5 }).length <= 3);
});

test('keeps profile identity payload to selected skin/set/level and not wallet or currency fields', () => {
  assert.deepEqual(Token.profileIdentity({ skin: 'royal', set: 'frost' }, 3), { token_skin: 'royal', token_set: 'frost', token_level: 2 });
});

console.log('\n' + checks + ' Token 2.0 checks passed');
