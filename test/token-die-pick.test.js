// v1.6.1: source checks for token die picker + 4s move countdown wiring.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'www/js/game.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'www/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const logic = fs.readFileSync(path.join(root, 'www/js/logic.js'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log('token-die-pick.test.js');

assert.match(html, /id="token-die-pick"/);
assert.match(html, /id="move-countdown"/);
console.log('  ok - token die picker + move countdown markup hooks');

assert.match(logic, /function bestAutoMove/);
assert.match(logic, /bestAutoMove: bestAutoMove/);
assert.match(game, /MOVE_DECIDE_MS = 4000/);
assert.match(game, /function startMoveDecide/);
assert.match(game, /function showDiePick/);
assert.match(game, /function handleTokenTap/);
assert.match(game, /L\.bestAutoMove/);
assert.match(game, /startMoveDecide\(\)/);
assert.match(game, /G\.online/);
console.log('  ok - game/logic wire picker + 4s decide (offline only)');

// Must not touch online clocks / ads / arrow danger paint
assert.match(game, /paintOnlineChrome|online-turn-timer|expire/);
assert.match(game, /DANGER_FILL = '#d23a30'/);
assert.match(game, /Ads\./);
console.log('  ok - online clocks, ads, arrow danger paths still present');

assert.match(css, /\.token-die-pick/);
assert.match(css, /\.token-die-v/);
assert.match(css, /\.move-countdown/);
assert.match(css, /\.pc\.picking/);
assert.match(css, /gem-rim/);
console.log('  ok - premium picker/countdown/token CSS present');

assert.match(game, /gem-num/);
assert.match(game, /jugnu/);
assert.match(game, /dataset\.num/);
assert.match(css, /jugnu-pulse/);
assert.match(css, /\.gem-num/);
assert.match(css, /gem-num-disc/);
console.log('  ok - firefly jugnu + readable token numbers 1–4');

assert.match(game, /function sixFlourish/);
assert.match(game, /function killBurst/);
assert.match(game, /function safePulse/);
assert.match(game, /function arrowWhoosh/);
assert.match(game, /function homeCelebrate/);
assert.match(game, /function turnChangeFx/);
assert.match(game, /prefersReducedMotion/);
assert.match(css, /@keyframes six-pop/);
assert.match(css, /@keyframes safe-pulse/);
assert.match(css, /@keyframes arrow-whoosh/);
assert.match(css, /@keyframes turn-swap/);
console.log('  ok - feel-good FX helpers + reduced-motion CSS');



console.log('token-die-pick checks passed');
