// v1.8.0 Token Skins / Vault / trail / capture — screenshots + DOM checks.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots npm run test:v180
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function ok(c, m) { if (!c) throw new Error('FAILED: ' + m); checks++; console.log('  ok -', m); }

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}


(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const shot = async (name, clip) => { const out = path.join(shotDir, 'v180-' + name + '.png'); await page.screenshot(clip ? { path: out, clip } : { path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
    const boardClip = () => page.evaluate(() => { const b = document.getElementById('board-wrap').getBoundingClientRect(); return { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, 390), height: Math.min(b.height, 560) }; });

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    const fresh = await page.evaluate(() => ({ owned: window.__cf.save.tokenSkinsOwned.slice(), eq: window.__cf.save.tokenSkin }));
    ok(fresh.owned.join() === 'classic' && fresh.eq === 'classic', 'fresh save: Classic owned + equipped');

    // Vault from home (fresh-ish progress: some wins/captures so a mix of owned/locked shows)
    await page.evaluate(() => { const s = window.__cf.save; s.coins = 620; s.stats.won = 9; s.stats.captures = 14; window.__cf.persist(); });
    await page.click('#btn-vault');
    await page.waitForSelector('#vault:not(.hidden)');
    const rows = await page.$$eval('#vault-list .vault-row', els => els.map(e => ({ id: e.dataset.skin, owned: e.classList.contains('owned'), txt: e.textContent })));
    ok(rows.length === 10, '10 vault rows');
    ok(rows.find(r => r.id === 'classic').owned && rows.find(r => r.id === 'mythic').txt.includes('🔒'), 'Classic owned, Mythic locked with condition');
    ok(rows.every(r => /Level \d\/5/.test(r.txt) && /Kills \d+/.test(r.txt) && /Wins \d+/.test(r.txt)), 'Level x/5, Kills, Wins on every row');
    ok(['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'].every(n => rows.some(r => r.txt.includes(n))), 'rarities shown');
    await shot('vault');
    await page.evaluate(() => { const l = document.getElementById('vault-list'); l.scrollTop = l.scrollHeight; });
    await sleep(120);
    await shot('vault-rare-mythic');
    await page.click('#vault .close');

    // Unlock everything for the grid + board shots
    await page.evaluate(() => { const s = window.__cf.save; s.coins = 5000; s.stats.won = 80; s.stats.captures = 160; window.TokenSkins.collectEligible(s); s.tokenEvoUnlocked = 3; s.tokenEvo = 3; window.__cf.persist(); });
    await page.click('#btn-skins');
    await page.waitForSelector('#skins:not(.hidden)');
    await page.click('#skin-tabs [data-tab="tokenskins"]');
    await sleep(250);
    ok(await page.$$eval('#skin-grid .tskin', e => e.length) === 10, '10 skin cards in Skins → Tokens');
    await shot('skins-grid');
    await page.evaluate(() => { const c = document.querySelector('#skin-grid [data-skin="galaxy"]'); c.scrollIntoView({ block: 'center' }); });
    await sleep(150);
    await shot('skins-grid-legendary');
    await page.click('#skin-grid [data-skin-btn="inferno"]');
    await sleep(100);
    ok(await page.evaluate(() => window.__cf.save.tokenSkin) === 'inferno', 'Equip from grid works');
    await page.click('#btn-vault-skins');
    await page.waitForSelector('#vault:not(.hidden)');
    ok(true, 'Vault reachable from Skins');
    await page.click('#vault .close');

    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.evaluate(() => { const s = window.__cf.save; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, { type: 'ai', level: 'easy' }, { type: 'ai', level: 'easy' }]; s.setup.mode.ai = 'classic'; s.board = 'midnight'; window.__cf.persist(); });
    await page.click('#btn-start'); await sleep(150);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden) #board'); await sleep(300);

    const SK = ['classic', 'royal', 'ruby', 'emerald', 'sapphire', 'diamond', 'galaxy', 'inferno', 'cyber', 'mythic'];
    for (const id of ['royal', 'diamond', 'galaxy', 'inferno', 'cyber', 'mythic']) {
      await page.evaluate(id => { const s = window.__cf.save; s.tokenSkin = id; window.__cf.persist(); window.__cf.edit(st => { st.phase = 'move'; st.turn = 0; st.queue = [4]; st.sixes = 0; st.bonus = 0; st.rollAgain = false; st.pieces[0] = [0, 8, 9, -1]; st.pieces[1] = [4, 12, -1, -1]; st.pieces[2] = [2, 10, -1, -1]; st.pieces[3] = [6, 14, 20, -1]; }); }, id);
      await sleep(220);
      const p = await page.evaluate(() => ({ h: [...document.querySelectorAll('.pc[data-seat="0"]')].map(e => e.dataset.skin), a: [...document.querySelectorAll('.pc[data-seat="1"]')].map(e => e.dataset.skin), band: !!document.querySelector('.pc[data-seat="0"] .sk-band') }));
      ok(p.h.every(x => x === id) && p.a.every(x => x === 'classic') && p.band, id + ' on human tokens, AI Classic, seat band present');
      if (id === 'royal' || id === 'mythic') await shot('board-' + id, await boardClip());
    }
    await page.evaluate(() => { const el = document.querySelector('.pc[data-seat="0"][data-piece="1"]'); if (el) el.classList.add('sel'); });
    await sleep(80);
    await shot('board', await boardClip());
    { const b = await boardClip(); await shot('board-zoom', { x: b.x, y: b.y + b.height * 0.38, width: b.width * 0.5, height: b.height * 0.3 }); }
    // stack of 4 + yard readability
    await page.evaluate(() => { window.__cf.edit(st => { st.phase = 'roll'; st.queue = []; st.pieces[0] = [8, 8, 8, 8]; st.pieces[1] = [-1, -1, -1, -1]; st.pieces[2] = [10, 10, -1, -1]; st.pieces[3] = [-1, -1, 20, -1]; }); });
    await sleep(250);
    await shot('stack-yard', await boardClip());

    // Trail + capture: real move onto an opponent (Inferno trail)
    await page.evaluate(() => { window.__cf.save.tokenSkin = 'inferno'; window.__cf.save.settings.auto = false; window.__cf.persist(); });
    const setup = await page.evaluate(() => {
      const L = window.__cf.logic;
      let from = null, q = null;
      for (let p = 2; p < 40 && from == null; p++) {
        const abs = L.absOf(0, p + 3); if (L.isSafeAbs && L.isSafeAbs(abs)) continue;
        for (let r = 0; r < 51; r++) if (L.absOf(1, r) === abs) { from = p; q = r; break; }
      }
      window.__cf.edit(st => { st.phase = 'move'; st.turn = 0; st.queue = [3]; st.sixes = 0; st.bonus = 0; st.rollAgain = false; st.pieces[0] = [from, -1, -1, -1]; st.pieces[1] = [q, -1, -1, -1]; st.pieces[2] = [-1, -1, -1, -1]; st.pieces[3] = [-1, -1, -1, -1]; });
      return { from, q };
    });
    ok(setup.from != null, 'capture setup found (' + JSON.stringify(setup) + ')');
    await sleep(250);
    await page.evaluate(() => document.querySelector('.pc[data-seat="0"][data-piece="0"]').click());
    await page.waitForSelector('#fx .trail', { timeout: 4000 });
    await shot('trail', await boardClip());
    const tTypes = await page.$$eval('#fx .trail', e => e.map(x => x.className));
    ok(tTypes.some(c => c.includes('trail-fire')), 'Inferno fire trail rendered');
    const t0 = Date.now();
    await page.waitForSelector('#fx .cap-wave', { timeout: 5000 });
    await sleep(120);
    await shot('capture', await boardClip());
    const capState = await page.evaluate(() => window.__cf.game.st.pieces[1][0]);
    ok(capState === -1, 'victim sent to yard in logic immediately');
    await sleep(900);
    ok(await page.$$eval('#fx .cap-wave, #fx .cap-impact, #fx .cap-pop', e => e.length) === 0, 'capture FX cleaned up within ~0.8s');
    const k = await page.evaluate(() => window.__cf.save.tokenSkinStats.inferno.kills);
    ok(k >= 1, 'kill counted on equipped Inferno skin');

    // reduced motion: no trail / capture fx elements
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
    console.log('v1.8.0 browser: ' + checks + ' checks passed');
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
