// v1.8.1 Daily reward + challenge — screenshots + DOM checks.
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
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || ['/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => fs.existsSync(p)), headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = []; let page;
  const fresh = async prep => {
    if (page) await page.close();
    page = await (await browser.createBrowserContext()).newPage();
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => localStorage.setItem('crossfour.tutorial.v1', '1'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(prep || (() => {})); await page.evaluate(() => window.__cf.persist());
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('#home:not(.hidden)');
  };
  const shot = async name => { const out = path.join(shotDir, 'v189-' + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
  const go = async () => { await page.click('#btn-start'); await sleep(200);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden)'); await sleep(400); };
  const finish = async () => { await page.evaluate(() => window.__cf.edit(st => { const w = st.players[0]; st.pieces[w] = Array(st.nPieces || 4).fill(window.__cf.logic.HOME); st.phase = 'over'; st.ranking = st.players.slice(); }));
    await page.waitForSelector('#result:not(.hidden)'); await sleep(500); };
  try {
    // 1) all-human Pass & Play: no coins, no win, flat XP, practice tip + note
    await fresh(() => { window.__cf.save.coins = 300; });
    await page.click('#btn-pass'); await page.waitForSelector('#setup:not(.hidden)'); await page.click('#presets button[data-p="1v1"]'); await go();
    ok(await page.evaluate(() => window.__cf.tipShowing) === 'practice', 'friendly Pass & Play tip shown');
    await shot('tip-practice');
    const b = await page.evaluate(() => ({ c: window.__cf.save.coins, w: window.__cf.save.stats.won, x: window.__cf.save.xp, sk: JSON.stringify(window.__cf.save.tokenSkinStats) }));
    await finish();
    const a = await page.evaluate(() => ({ c: window.__cf.save.coins, w: window.__cf.save.stats.won, x: window.__cf.save.xp, sk: JSON.stringify(window.__cf.save.tokenSkinStats), note: !document.getElementById('r-practice').classList.contains('hidden'), dbl: document.getElementById('btn-r-double').classList.contains('hidden') }));
    ok(a.c === b.c && a.w === b.w && a.sk === b.sk, 'all-human match pays no coins and no win/skin progress');
    ok(a.x - b.x === 10 && a.note && a.dbl, 'flat 10 XP, friendly note shown, no 2x ad button');
    await shot('result-practice');
    // 2) vs AI arrow mode: tips arrow then danger; coins paid
    await fresh(() => { const s = window.__cf.save; s.coins = 300; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; });
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await page.click('#mode-seg [data-mode="arrow"]'); await sleep(150); await go();
    ok(await page.evaluate(() => window.__cf.tipShowing) === 'arrow', 'Arrow tip on first Arrow match');
    await shot('tip-arrow');
    await page.click('#tip-ok'); await sleep(200);
    ok(await page.evaluate(() => window.__cf.tipShowing) === 'danger', 'danger-cell tip follows');
    await shot('tip-danger');
    await page.click('#tip-ok'); await sleep(200);
    ok(await page.evaluate(() => window.__cf.tipShowing === null && document.getElementById('tip-card').classList.contains('hidden')), 'tips dismissed');
    const c0 = await page.evaluate(() => window.__cf.save.coins); await finish();
    ok(await page.evaluate(() => window.__cf.save.coins) > c0, 'vs-computer match still pays coins');
    await page.click('#btn-r-home'); await sleep(600);
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await go();
    ok(await page.evaluate(() => window.__cf.tipShowing) === null, 'seen tips do not repeat');
    // 3) entry fee + championship tips
    await fresh(() => { const s = window.__cf.save; s.coins = 1000; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; });
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await page.select('#entry-fee', '50'); await sleep(250);
    ok(await page.evaluate(() => window.__cf.tipShowing) === 'fee', 'entry-fee tip on first paid selection');
    await shot('tip-fee'); await page.click('#tip-ok');
    await page.evaluate(() => document.getElementById('btn-setup-back').click()); await sleep(300);
    await page.click('#btn-championship'); await sleep(300);
    ok(await page.evaluate(() => window.__cf.tipShowing) === 'championship', 'Championship tip on first open');
    await shot('tip-championship');
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log('v189 checks:', checks);
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
