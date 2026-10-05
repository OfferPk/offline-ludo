// v1.6.4: light-theme contrast polish — WCAG contrast of UI tokens on every light skin + release markers.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const game = read('www/js/game.js');
const css = read('www/css/style.css');
const html = read('www/index.html');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
const SK = require(path.join(root, 'www/js/themes.js'));

console.log('light-contrast.test.js');

// Version moves forward with each release (v1.6.6 = versionCode 23); light contrast must remain.
const [lMaj, lMin, lPat] = pkg.version.split('.').map(Number);
assert.ok(lMaj > 1 || (lMaj === 1 && (lMin > 6 || (lMin === 6 && lPat >= 4))), 'version >= 1.6.4');
const lCode = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
assert.ok(lCode >= 21, 'versionCode >= 21');
const lEsc = pkg.version.replace(/\./g, '\\.');
assert.match(gradle, new RegExp('versionName "' + lEsc + '"'));
assert.match(html, new RegExp('Crossfour v' + lEsc));
assert.doesNotMatch(html, /\?v=1\.6\.3/);
assert.match(html, new RegExp('css/style\\.css\\?v=' + lEsc));
console.log('  ok - version ' + pkg.version + ' / versionCode ' + lCode + ' (>= 1.6.4 / 21), cache-busted assets');

// Pull the UI token tables straight out of game.js (applySkin) so the test tracks the shipped code.
const grab = (re, what) => { const m = re.exec(game); assert.ok(m, what + ' present in game.js'); return m[1]; };
const ACCENT = Function('return ' + grab(/var ACCENT = (\{[\s\S]*?\});/, 'ACCENT'))();
const UI_CHROME = Function('return ' + grab(/var UI_CHROME = (\{[\s\S]*?\});/, 'UI_CHROME'))();
const DEEPEN = Number(grab(/var LIGHT_MUTED_DEEPEN = ([\d.]+);/, 'LIGHT_MUTED_DEEPEN'));
assert.match(game, /document\.body\.classList\.toggle\('light', !uiDark\)/, 'body.light follows UI chrome darkness');

const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const toBlack = (h, f) => hex(h).map(v => Math.round(v + (0 - v) * f));
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
const rgb = c => (typeof c === 'string' ? hex(c) : c);

const light = SK.BOARDS.filter(b => !b.dark);
assert.ok(light.length >= 6, 'light skins present');
for (const b of light) {
  const ui = UI_CHROME[b.id] || {};
  const uiDark = ui.dark != null ? !!ui.dark : !!b.dark;
  const ink = rgb(ui.ink || b.ink);
  const muted = ui.muted ? rgb(ui.muted) : (uiDark ? rgb(b.muted) : toBlack(b.muted, DEEPEN));
  for (const bgKey of ['page', 'bg']) {
    const bg = rgb(b[bgKey]);
    const ri = ratio(ink, bg), rm = ratio(muted, bg);
    assert.ok(ri >= (uiDark ? 6 : 7), `${b.id} ink on ${bgKey} ${ri.toFixed(2)} >= ${uiDark ? 6 : 7}`);
    assert.ok(rm >= 4.5, `${b.id} muted on ${bgKey} ${rm.toFixed(2)} >= 4.5`);
  }
  // Subtitles also sit on near-white cards on light chrome.
  if (!uiDark) assert.ok(ratio(muted, [255, 255, 255]) >= 4.5, `${b.id} muted on white card`);
  const acc = ACCENT[b.id] || ACCENT.graphite;
  assert.ok(ratio(rgb(acc[0]), rgb(acc[1])) >= 4.5, `${b.id} accent text contrast`);
  if (!uiDark) assert.ok(ratio(rgb(acc[0]), rgb(b.page)) >= 3, `${b.id} accent (XP bar, switches) vs page >= 3`);
}
console.log('  ok - ' + light.length + ' light skins: ink >= 7:1 (6:1 on Classic Wood walnut), subtitles >= 4.5:1, accents readable');

// Classic Wood: light board on a dark walnut page -> chrome follows the dark styles with cream text.
const timber = SK.BOARDS.find(b => b.id === 'timber');
assert.equal(UI_CHROME.timber.dark, true);
assert.ok(ratio(rgb(UI_CHROME.timber.ink), rgb(timber.page)) >= 6, 'timber cream ink on walnut page');
assert.ok(ratio(rgb(timber.ink), rgb(timber.page)) < 3, 'old dark-on-walnut ink was unreadable (regression guard)');
assert.equal(timber.ink, '#2a1b10', 'timber board palette (canvas) untouched');
console.log('  ok - Classic Wood chrome readable (cream on walnut), board palette untouched');

// Dark skins keep their original tokens; no dark accent changed.
const graphite = SK.BOARDS.find(b => b.id === 'graphite');
assert.equal(graphite.muted, '#8a93a3'); assert.equal(graphite.ink, '#e8ebf1');
assert.deepEqual(ACCENT.graphite, ['#f4b740', '#1c1504']);
assert.deepEqual(ACCENT.midnight, ['#6aa8ff', '#071018']);
for (const b of SK.BOARDS.filter(x => x.dark)) assert.ok(!UI_CHROME[b.id], b.id + ' has no chrome override');

// Every rule in the v1.6.4 block is scoped to light skins (dark themes untouched).
const start = css.indexOf('v1.6.4 · Light theme contrast');
assert.ok(start > 0, 'v1.6.4 CSS block present');
const nextGlobalFeature = css.indexOf('/* ---- Token 2.0:', start);
const block = css.slice(css.indexOf('*/', start) + 2, nextGlobalFeature > start ? nextGlobalFeature : undefined);
const selectors = [];
block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').split('}').forEach(chunk => {
  const sel = chunk.split('{')[0].trim();
  if (sel && chunk.includes('{')) sel.split(',').forEach(s => selectors.push(s.trim()));
});
assert.ok(selectors.length > 60, 'light rules: ' + selectors.length);
for (const s of selectors) assert.ok(/^body\.light\b/.test(s), 'scoped to body.light: ' + s);
for (const needle of ['.mode-card-icon', '.mode-card-subtitle', '.lvl-bar', '.howto-card', '.howto-open', '.home-row .btn', '.home-chess-launch', '#mode-seg', '.presets button[aria-pressed="true"]', '.online-eyebrow', '.overlay.exit-confirm .panel', '.online-chess-screen']) {
  assert.ok(selectors.some(s => s.includes(needle)), 'light override for ' + needle);
}
console.log('  ok - ' + selectors.length + ' v1.6.4 selectors, all scoped to body.light');

// Unselected segment labels darken, the selected one keeps its inverted colours.
assert.match(block, /body\.light \.seg button:not\(\.on\)/);
// Online Ludo Chess surface stays dark on light skins.
assert.match(block, /body\.light \.online-chess-screen \{ --ink: #eef1f5;/);
// Original Crossfour wording only.
assert.doesNotMatch(css + html, /Ludo Star|Yalla/i);
console.log('light-contrast.test.js passed');
