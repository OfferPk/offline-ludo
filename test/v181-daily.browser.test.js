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
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const shot = async name => { const out = path.join(shotDir, 'v181-' + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    const sizes = await page.evaluate(() => { const a = document.getElementById('btn-daily').getBoundingClientRect(), b = document.getElementById('btn-vs-ai').getBoundingClientRect(); return { ah: a.height, bh: b.height }; });
    ok(Math.abs(sizes.ah - sizes.bh) <= 1, 'Daily card same height as mode cards (' + sizes.ah + ' vs ' + sizes.bh + ')');
    ok(await page.evaluate(() => !document.getElementById('daily-dot').classList.contains('hidden')), 'ready dot visible on fresh save');
    await page.evaluate(() => document.getElementById('btn-daily').scrollIntoView({ block: 'center' }));
    await shot('home-daily-card');
    await page.click('#btn-daily'); await sleep(350);
    await shot('daily-panel');
    const c0 = await page.evaluate(() => window.__cf.save.coins);
    await page.click('#daily-claim'); await sleep(300);
    const c1 = await page.evaluate(() => window.__cf.save.coins);
    ok(c1 - c0 === 50, 'Day 1 claim pays 50 coins');
    ok(await page.evaluate(() => document.getElementById('daily-claim').disabled), 'claim disabled after claim');
    ok(await page.evaluate(() => !document.getElementById('daily-2x').classList.contains('hidden')), '2x button offered after claim');
    await page.click('#daily-2x'); await sleep(300);
    ok(await page.evaluate(() => window.__cf.save.coins) - c1 === 50, '2x (browser stub reward) pays once more');
    ok(await page.evaluate(() => document.getElementById('daily-2x').classList.contains('hidden')), '2x hidden after use');
    // Simulate a 6-day streak and challenge completion.
    await page.evaluate(() => { const d = window.__cf.save.daily, t = window.Daily.localDate(new Date()); const y = new Date(); y.setDate(y.getDate() - 1); d.last = window.Daily.localDate(y); d.streak = 6; d.dblDay = null; const c = window.Daily.challengeFor(t); d.cDate = t; d.cProg = c.goal; d.cClaimed = false; });
    await page.click('[data-close="daily"]'); await page.click('#btn-daily'); await sleep(350);
    ok(await page.evaluate(() => /Claim 500/.test(document.getElementById('daily-claim').textContent)), 'Day 7 big reward 500');
    ok(await page.evaluate(() => !document.getElementById('chal-claim').disabled), 'challenge claimable when done');
    await shot('daily-day7-challenge');
    await page.click('#chal-claim'); await page.click('#daily-claim'); await sleep(300);
    await shot('daily-claimed');
    const btnCss = await page.evaluate(() => ['btn-daily', 'daily-claim', 'daily-2x'].map(id => { const cs = getComputedStyle(document.getElementById(id)); return cs.filter + '|' + cs.transform; }));
    ok(btnCss.every(v => /^none\|(none|matrix\([^)]*\))$/.test(v)), 'no CSS filter / 3D transform on daily buttons');
    await page.click('[data-close="daily"]');
    await page.evaluate(() => document.body.classList.add('light'));
    await page.evaluate(() => { const s = document.querySelector('[data-skin], #btn-settings'); });
    ok(errors.length === 0, 'no page errors ' + errors.join(';'));
  } finally { await browser.close(); local.server.close(); }
  console.log('\n' + checks + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
