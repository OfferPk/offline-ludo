// Corner die must stay a readable flat face (no filter+3D blank on WebView).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'www/css/style.css'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'www/js/game.js'), 'utf8');

assert.ok(/\.pdice\s*\{[^}]*appearance:\s*none/s.test(css) || css.includes('appearance: none !important'),
  '.pdice must reset native button appearance');
assert.ok(!/\.pdice\s*\{[^}]*filter\s*:\s*(?!none)/s.test(css.split('/* Corner die')[1].split('.pdice.ready')[0]) ||
  /filter:\s*none\s*!important/.test(css),
  '.pdice must not use decorative CSS filter');
assert.ok(/display:\s*none\s*!important/.test(css), '3D cube must be display:none');
assert.ok(/background(?:-color)?:\s*(?:var\(--d-face,?\s*)?#fbfaf6/.test(css) || /#fbfaf6/.test(css.split('.pdice')[1].split('.pdice:disabled')[0]),
  'cream face / --d-face ivory fallback on .pdice');
assert.ok(/filter:\s*none\s*!important/.test(css), '.pdice keeps filter:none');
assert.ok(/@keyframes toss/.test(css) && /translateY\(-24px\)/.test(css), 'longer physics-like toss keyframes');
assert.ok(game.includes("die.classList.add('rolling')"), 'rolling class on die button');
assert.ok(!/pod\.classList\.add\('rolling'\)/.test(game), 'must not put rolling on .pod');
const logic = fs.readFileSync(path.join(__dirname, '..', 'www/js/logic.js'), 'utf8');
assert.ok(logic.includes('ARROW_JUMP'), 'arrow jump constant stays');
assert.match(logic, /for \(var k = 0; k < n; k\+\+\)/, 'pathOf still walks die steps before jump check');
console.log('  ok - corner die WebView-safe contract');
console.log('corner-die unit checks passed');
