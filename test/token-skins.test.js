// v1.8.7 Token Skins + Token Vault + trails + capture FX (offline cosmetic only).
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const TS = require('../www/js/token-skins.js');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let n = 0; function ok(c, m) { assert.ok(c, m); n++; console.log('  ok -', m); }

const pkg = JSON.parse(read('package.json')), gradle = read('android/app/build.gradle'), html = read('www/index.html');
const game = read('www/js/game.js'), css = read('www/css/v180.css'), src = read('www/js/token-skins.js');
ok(pkg.version === '1.8.7' && /versionCode 34/.test(gradle) && /versionName "1\.8\.7"/.test(gradle), 'version 1.8.7 / versionCode 34');
ok(/js\/token-skins\.js\?v=1\.8\.7/.test(html) && /css\/v180\.css\?v=1\.8\.7/.test(html), 'token-skins.js + v180.css wired');
ok(html.indexOf('token-skins.js') < html.indexOf('js/game.js'), 'token-skins loads before game.js');
ok(/id="btn-vault"/.test(html) && /id="vault"/.test(html) && /id="vault-list"/.test(html) && /data-tab="tokenskins"/.test(html), 'Vault reachable from home + skins tab');
ok(/btn-vault-skins/.test(game), 'Vault button inside Skins → Tokens');

const want = ['classic', 'royal', 'ruby', 'emerald', 'sapphire', 'diamond', 'galaxy', 'inferno', 'cyber', 'mythic'];
ok(TS.SKINS.length === 10 && want.every(id => TS.byId(id)), '10 skins present');
ok(['common', 'rare', 'epic', 'legendary', 'mythic'].every(r => TS.SKINS.some(s => s.rarity === r)), 'all 5 rarities used');
ok(TS.SKINS.filter(s => s.coins === 0 && !s.starter).length === 0 && TS.SKINS.every(s => s.starter || s.wins || s.kills), 'every non-starter skin has a free milestone and a coin price');
ok(TS.byId('royal').trail === 'gold' && TS.byId('inferno').trail === 'fire' && TS.byId('diamond').trail === 'frost' && TS.byId('cyber').trail === 'electric' && TS.byId('galaxy').trail === 'stars', 'trail per signature skin');
for (const id of want) ok(new RegExp("case '" + id + "'").test(game) || id === 'classic', 'skin layer drawn: ' + id);

// fresh save
const fresh = { coins: 0, stats: { won: 0, captures: 0 } };
const nf = TS.normalize(fresh);
ok(nf.owned.join() === 'classic' && nf.equipped === 'classic', 'Classic owned + equipped at start');
ok(!TS.state('royal', fresh).canUnlock, 'Royal locked on fresh save');
// coin unlock
const save = { coins: 500, stats: { won: 0, captures: 0 } }; TS.applyNormalize(save);
const persist = () => true;
let r = TS.unlock(save, 'royal', persist);
ok(r.ok && r.spent === 450 && save.coins === 50 && save.tokenSkin === 'royal', 'coin unlock spends + equips');
ok(TS.unlock(save, 'royal', persist).reason === 'owned', 'no double unlock');
ok(TS.unlock(save, 'mythic', persist).reason === 'locked' && save.coins === 50, 'cannot unlock without coins/milestone');
// milestone unlock (free)
const vet = { coins: 0, stats: { won: 40, captures: 100 } }; TS.applyNormalize(vet);
const granted = TS.collectEligible(vet).map(x => x.id);
ok(['galaxy', 'inferno', 'diamond', 'royal', 'cyber', 'sapphire', 'ruby', 'emerald'].every(id => granted.includes(id)) && !granted.includes('mythic'), 'milestones grant free skins, Mythic still needs 75 wins + 150 captures');
ok(vet.tokenSkin === 'classic', 'collectEligible does not change equip');
// save failure rolls back
const s2 = { coins: 999, stats: {} }; TS.applyNormalize(s2);
ok(!TS.unlock(s2, 'royal', () => false).ok && s2.coins === 999 && s2.tokenSkinsOwned.length === 1, 'failed persist rolls back');
// per-skin stats only while equipped
TS.equip(save, 'classic', persist); TS.recordKills(save, 2); TS.recordMatch(save, true);
TS.equip(save, 'royal', persist); TS.recordKills(save, 1); TS.recordMatch(save, false);
ok(save.tokenSkinStats.classic.kills === 2 && save.tokenSkinStats.classic.wins === 1 && save.tokenSkinStats.royal.kills === 1 && save.tokenSkinStats.royal.wins === 0, 'kills/wins counted for equipped skin only');
ok(TS.isValid(save), 'save validates');
ok(!TS.isValid({ tokenSkinsOwned: ['royal'], tokenSkin: 'royal', tokenSkinStats: {} }), 'save without Classic rejected');
ok(TS.normalize({ tokenSkinsOwned: ['hax', 'royal'], tokenSkin: 'hax' }).equipped === 'classic', 'unknown ids dropped');
// seat colour preserved
for (const id of want) { const m = TS.material(id, '#e85a48'); ok(m.band === '#e85a48', 'seat band kept for ' + id); }
ok(/sk-band/.test(game) && /\.sk-band \{ fill: var\(--pcband/.test(css), 'seat-colour base band rendered');
// remote/AI seats classic
ok(/function skinForSeat[\s\S]{0,200}!isHuman\(s\)\) return 'classic'/.test(game), 'AI seats stay Classic');
ok(/G\.online && G\.view != null && s !== G\.view\) return 'classic'/.test(game), 'online opponents stay Classic');
// WebView safety + reduced motion
const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/filter:(?!\s*none)/.test(noComments), 'no CSS filter in v1.8.7 styles (only filter:none)');
ok(!/perspective|rotateX|rotateY|translateZ|preserve-3d/.test(noComments), 'no 3D transforms');
ok(/prefers-reduced-motion: reduce[\s\S]*\.trail[\s\S]*\.cap-impact/.test(css), 'reduced-motion disables trails + capture FX');
ok(/function trailFx[\s\S]{0,80}if \(!fxOk\(\)/.test(game) && /function captureImpactFx[\s\S]{0,80}if \(!fxOk\(\)/.test(game), 'JS FX gated on reduced motion');
const durs = [...css.matchAll(/animation: cap-[a-z]+ ([\d.]+)s/g)].map(m => +m[1]);
ok(durs.length >= 4 && durs.every(d => d <= 0.8), 'capture animations <= 0.8s: ' + durs.join(','));
ok(/captureImpactFx\(s, caps, at\);\n    caps\.forEach\(function \(cp\) \{ killBurst/.test(game), 'capture FX is fire-and-forget (sendToBase runs immediately)');
// selection halo calmer
ok(/\.pc\.sel::before \{[^}]*box-shadow: 0 0 0 2px var\(--accent\), 0 3px 6px/.test(css), 'selection ring subtle (no 22px glow)');
// originality / no gambling
const all = (src + game + html + css).toLowerCase();
ok(!/ludo star|yalla|ludo king/.test(all.replace(/no ludo star\/yalla/g, '')), 'no third-party game names');
ok(/can't be bought, bet or cashed out/.test(html), 'coins cosmetic disclaimer in Vault');
ok(!/billing|purchase\(|inapp/i.test(src), 'no IAP in token skins');
// unchanged features
ok(/MOVE_DECIDE_MS = 4000/.test(game) && /showDiePick/.test(game) && /celebration\.js/.test(html), 'die picker + 4s timer + camel kept');
const adsCfg = read('www/js/ads-config.js');
ok(/ca-app-pub-3940256099942544/.test(adsCfg), 'AdMob test IDs unchanged');
console.log('token-skins: ' + n + ' checks passed');
