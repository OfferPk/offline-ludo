// v1.7.2 Tall classic Ludo pawn tokens (not flat/bowl circles).
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
const ads = read('www/js/ads-config.js');
const rules = read('RULES.md');
const gradle = read('android/app/build.gradle');
const pkg = JSON.parse(read('package.json'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; console.log('  ok -', m); };

console.log('tall-pawns.test.js');

ok(pkg.version === '1.7.2', 'package version 1.7.2');
ok(/versionCode 26/.test(gradle) && /versionName "1\.7\.2"/.test(gradle), 'gradle versionCode 26 / 1.7.2');
ok(/Crossfour v1\.7\.2/.test(html) && /css\/style\.css\?v=1\.7\.2/.test(html), 'footer + asset cache-bust 1.7.2');

ok(/Tall classic Ludo pawn/.test(game), 'tall pawn comment in game.js');
ok(/Tall classic Ludo pawn tokens/.test(css), 'tall pawn CSS banner');
ok(/tall classic \*\*Ludo pawn pieces\*\*/.test(rules) || /tall classic \*\*Ludo pawn/.test(rules), 'RULES describe tall pawns');
ok(/pawnOuter/.test(game) && /pawnBody/.test(game), 'pawnOuter + pawnBody silhouette paths');
ok(/viewBox="0 0 24 36"/.test(game), 'tall viewBox 24×36');
ok(/<path class="gem-rim-outer"/.test(game) && /<path class="gem-body"/.test(game), 'path-based rim + body (not circle bowl)');
ok(!/<circle class="gem-body"/.test(game) && !/<circle class="gem-rim-outer"/.test(game), 'no circular bowl body/rim');
ok(/gem-collar/.test(game) && /\.pc \.gem-collar/.test(css), 'collar band wired in SVG + CSS');
ok(/height: calc\(var\(--cell\) \* \.88\)/.test(css) && /width: calc\(var\(--cell\) \* \.54\)/.test(css), 'tall hit-box aspect on .pc');
ok(/TOKEN_MAT/.test(game) && /id: 'ruby'/.test(game) && /id: 'sapphire'/.test(game), 'crystal per-color materials kept');
ok(/gem-num-hi/.test(game) && /gem-num-shadow/.test(game), 'embossed 1–4 kept');
ok(/TOKEN_EVOLUTION/.test(game) && /data-evo/.test(css) && /evo-badge/.test(game), 'evolution visuals kept');
ok(/evo-prev-pawn/.test(game) && /evo-prev-pawn/.test(css), 'Skins → Tokens preview uses pawn shape');
ok(!/Ludo Star|Yalla|yalla|ludostar/i.test(game + css), 'no Ludo Star / Yalla asset names');

ok(/MOVE_DECIDE_MS = 4000/.test(game) && /function showDiePick/.test(game), 'die picker + 4s timer intact');
ok(/CamelCelebration|celebrateWin/.test(game) && /function play\(/.test(celebration), 'camel celebration kept');
ok(/ca-app-pub-3940256099942544/.test(ads) && /IS_TESTING: true/.test(ads), 'ads test IDs intact');
ok(/DANGER_FILL = '#d23a30'/.test(game), 'arrow danger intact');
ok(/G\.online/.test(game) && /paintOnlineChrome|online-turn-timer/.test(game), 'online paths intact');

console.log('tall-pawns checks passed (' + checks + ' checks).');
