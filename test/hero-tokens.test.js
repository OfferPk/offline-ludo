// Tall pawn tokens (v1.7.2); Token Evolution covered in token-evolution.test.js.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('www/index.html');
const css = read('www/css/style.css');
const game = read('www/js/game.js');
const celebration = read('www/js/celebration.js');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ok -', m); };

console.log('hero-tokens.test.js');

ok(pkg.version === '1.7.2', 'package version 1.7.2');
ok(/versionCode 26/.test(gradle) && /versionName "1\.7\.2"/.test(gradle), 'gradle versionCode 26 / 1.7.2');
ok(/Crossfour v1\.7\.2/.test(html) && /css\/style\.css\?v=1\.7\.2/.test(html), 'footer + asset cache-bust 1.7.2');

// Tall classic Ludo pawn SVG (not flat/bowl circle).
ok(/Tall classic Ludo pawn/.test(game), 'tall pawn comment present');
ok(/TOKEN_MAT/.test(game) && /id: 'ruby'/.test(game) && /id: 'emerald'/.test(game) && /id: 'gold'/.test(game) && /id: 'sapphire'/.test(game), 'per-color materials ruby/emerald/gold/sapphire');
ok(/gem-rim-outer/.test(game) && /gem-bevel/.test(game) && /gem-body/.test(game) && /gem-num-hi/.test(game), 'rim + bevel + crystal body + embossed numeral layers');
ok(/pawnOuter/.test(game) && /pawnBody/.test(game) && /viewBox="0 0 24 36"/.test(game), 'tall pawn paths + viewBox 24x36');
ok(/<path class="gem-body"/.test(game) && /<path class="gem-rim-outer"/.test(game), 'path silhouette body + rim (not flat circle)');
ok(/gem-collar/.test(game), 'collar band between head and body');
ok(/gem-num-shadow/.test(game) && /gem-num-bevel/.test(game), 'embossed raised 3D number layers');
ok(/--pcrim0|--pcrim1|--pcglassHi/.test(game) && /dataset\.mat/.test(game), 'material CSS vars + dataset.mat');
ok(/TOKEN_EVOLUTION/.test(game) && /evoLevelForSeat/.test(game), 'Token Evolution wired');

// CSS materials + emboss + jugnu tasteful.
ok(/Tall classic Ludo pawn tokens/.test(css), 'tall pawn CSS banner');
ok(/\.pc \.gem-rim-outer/.test(css) && /\.pc \.gem-num-hi/.test(css) && /\.pc \.gem-num-shadow/.test(css), 'rim + emboss numeral CSS');
ok(/jugnu-pulse/.test(css) && /tasteful pulse|Soft firefly/.test(css), 'jugnu pulse kept');
ok(/data-evo/.test(css), 'data-evo CSS present');

// Stronger kill FX ~0.5–0.8s with impact shockwave + settle glow.
ok(/kill-settle/.test(game) && /ring-shock-outer/.test(game), 'kill settle glow + outer shockwave wired');
ok(/@keyframes kill-settle/.test(css) && /\.kill-settle/.test(css), 'kill-settle CSS');
ok(/animation-duration: \.62s/.test(css) || /kill-splash \.68s/.test(css), 'capture FX duration in 0.5–0.8s range');
ok(/prefers-reduced-motion: reduce/.test(css) && /kill-settle/.test(css), 'reduced-motion covers kill-settle');

// Must not regress die picker / 4s timer / Arrow / camel / ads / online.
ok(/MOVE_DECIDE_MS = 4000/.test(game) && /function showDiePick/.test(game), 'die picker + 4s timer intact');
ok(/CamelCelebration|celebrateWin/.test(game) && /function play\(/.test(celebration), 'camel celebration kept');
ok(/Ads\./.test(game) && /DANGER_FILL = '#d23a30'/.test(game), 'ads + arrow danger intact');
ok(/G\.online/.test(game) && /paintOnlineChrome|online-turn-timer/.test(game), 'online paths intact');
ok(!/Ludo Star|Yalla|yalla|ludostar/i.test(game + css), 'no Ludo Star / Yalla asset names');

ok(/renderTokenEvolution/.test(game) && /evo-badge/.test(game), 'Token Evolution UI + badge shipped');

console.log('hero-tokens checks passed (' + checks + ' checks).');
