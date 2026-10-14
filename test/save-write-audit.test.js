'use strict';
// v1.8.9 audit: every write to the offline save goes through SaveStore (so the #109 stale-tab guard only blocks real conflicts).
const assert = require('node:assert'); const fs = require('node:fs'); const path = require('node:path');
const dir = path.join(__dirname, '..', 'www', 'js');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'save-store.js');
let creates = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  creates += (src.match(/SaveStore\.create\(/g) || []).length;
  const writes = src.match(/localStorage\.(setItem|removeItem|clear)\([^)]*\)/g) || [];
  for (const w of writes) assert.ok(/TUTORIAL_KEY|TIPS_KEY/.test(w), f + ' writes localStorage outside SaveStore: ' + w);
  assert.ok(!/crossfour\.save\.(v\d|checkpoint)/.test(src) || f === 'game.js', f + ' references the save keys directly');
}
assert.strictEqual(creates, 1, 'exactly one SaveStore instance');
const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
assert.strictEqual(new Set(srcs).size, srcs.length, 'no script is loaded twice');
console.log('save-write audit ok (' + files.length + ' files, ' + srcs.length + ' scripts)');
