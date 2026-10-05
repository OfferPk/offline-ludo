// v1.6.2: premium yard/home pads — inset wells, seat rim light, numeral plates.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'www/js/game.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log('yard-pads.test.js');

// Version moves forward with each release (v1.6.4 = versionCode 21); yard pads must remain.
const [maj, min, pat] = pkg.version.split('.').map(Number);
assert.ok(maj > 1 || (maj === 1 && (min > 6 || (min === 6 && pat >= 2))), 'version >= 1.6.2');
const code = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
assert.ok(code >= 19, 'versionCode >= 19');
assert.match(gradle, new RegExp('versionName "' + pkg.version.replace(/\./g, '\\.') + '"'));
assert.match(html, new RegExp('Crossfour v' + pkg.version.replace(/\./g, '\\.')));
console.log('  ok - version ' + pkg.version + ' / versionCode ' + code + ' (>= 1.6.2 / 19)');

assert.match(game, /Yard pads: inset wells/);
assert.match(game, /numeral plate/);
assert.match(game, /seat-tinted outer halo/);
assert.match(game, /recessed bowl \(inset well\)/);
assert.match(game, /L\.BASE_SPOTS\[s\]\.forEach\(function \(p, spotIdx\)/);
assert.match(game, /strokeText\(String\(num\)/);
assert.match(game, /fillText\(String\(num\)/);
console.log('  ok - yard pad wells + rim light + numeral plates in drawBoard');

// Must not regress rules / arrow / die picker / timer / ads / online hooks
assert.match(game, /DANGER_FILL = '#d23a30'/);
assert.match(game, /function showDiePick/);
assert.match(game, /MOVE_DECIDE_MS = 4000/);
assert.match(game, /Ads\./);
assert.match(game, /G\.online/);
assert.match(game, /paintOnlineChrome|online-turn-timer/);
console.log('  ok - arrow danger, die picker, timer, ads, online still present');

// Original style markers (not Ludo Star / Yalla copy cues)
assert.doesNotMatch(game, /ludo\s*star|yalla/i);
console.log('  ok - no Ludo Star / Yalla art references');

console.log('yard-pads checks passed');
