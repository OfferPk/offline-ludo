// Contract: turn banner uses a pip die (never a blank seat-color circle).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const game = fs.readFileSync(path.join(__dirname, '..', 'www/js/game.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'www/css/style.css'), 'utf8');

assert.ok(game.includes('function flatPipsHTML'), 'flatPipsHTML helper required');
assert.ok(game.includes('banner-die'), 'turn label must render .banner-die');
assert.ok(!game.includes("lbl.innerHTML = '<span class=\"dot\""), 'seat-color .dot must not be the turn banner indicator');
assert.ok(game.includes('flatPipsHTML(faceV)'), 'banner die must inject pip HTML from the face value');
assert.ok(css.includes('.turn-label .banner-die'), 'CSS styles .banner-die');
assert.ok(css.includes('.turn-label .banner-die i'), 'CSS styles pip nodes');

const m = game.match(/function flatPipsHTML\(v\) \{([\s\S]*?)\n  \}\n/);
assert.ok(m, 'flatPipsHTML body found');
const flatPipsHTML = vm.runInNewContext('function flatPipsHTML(v) {' + m[1] + '}; flatPipsHTML');
for (const n of [1, 2, 3, 4, 5, 6]) {
  const html = flatPipsHTML(n);
  const pips = (html.match(/<i>/g) || []).length;
  assert.strictEqual(pips, n, 'flatPipsHTML(' + n + ') must emit ' + n + ' pips');
}
console.log('  ok - banner die contract: no seat .dot; face-based pips 1–6');
console.log('banner-die unit checks passed');
