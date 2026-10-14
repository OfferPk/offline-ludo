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
  let page;
  const fresh = async (prep) => {
    if (page) await page.close();
    page = await (await browser.createBrowserContext()).newPage();
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => { localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.evaluate(prep || (() => {}));
    await page.evaluate(() => window.__cf.persist());
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
  };
  const shot = async name => { const out = path.join(shotDir, 'v185-' + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
  const start = async () => { await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); };
  const go = async () => { await page.click('#btn-start'); await sleep(150);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden)'); await sleep(300); };
  const win = async (humanWins = true) => { await page.evaluate(hw => window.__cf.edit(st => { const h = st.players.find(x => st.seats[x].type === 'human'), o = st.players.find(x => x !== h), w = hw ? h : o;
    st.pieces[w] = Array(st.nPieces || 4).fill(window.__cf.logic.HOME); st.phase = 'over'; st.ranking = [w].concat(st.players.filter(x => x !== w)); }), humanWins);
    await page.waitForSelector('#result:not(.hidden)'); };
  try {
    // 1) tally survives resume
    await fresh(() => { const s = window.__cf.save; s.coins = 1000; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; });
    await start(); await go();
    await page.evaluate(() => { const t = window.__cf.game.tally; t.capture = 4; t.six = 2; window.__cf.persist(); });
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('#home:not(.hidden)');
    ok(await page.evaluate(() => !document.getElementById('btn-continue').classList.contains('hidden')), 'continue offered after reload');
    await page.click('#btn-continue'); await page.waitForSelector('#game:not(.hidden)');
    ok(await page.evaluate(() => JSON.stringify(window.__cf.game.tally)) === JSON.stringify({ capture: 4, six: 2, arrow: 0, home: 0 }), 'per-match tally survives resume');
    await win(); await sleep(2600);
    const cam = await page.evaluate(() => { const w = document.querySelector('.camel-cel .cc-walker') || document.querySelector('.camel-cel'), a = document.querySelector('#result .panel-actions').getBoundingClientRect();
      if (!w) return { none: true }; const r = w.getBoundingClientRect(); return { bottom: r.bottom, top: r.top, act: a.top }; });
    ok(cam.none || cam.bottom <= cam.act + 4, 'camel stays above the result buttons ' + JSON.stringify(cam));
    ok(await page.evaluate(() => document.querySelector('#r-summary .r-chip b').textContent === '4'), 'result shows resumed captures');
    await shot('result-camel');
    // 2) offline wager flow
    await fresh(() => { const s = window.__cf.save; s.coins = 1000; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; });
    await start();
    await page.select('#entry-fee', '100'); await sleep(150);
    await page.evaluate(() => { const d = document.querySelector('#setup .fee-explainer'); d.open = true; d.scrollIntoView({ block: 'center' }); }); await sleep(200);
    ok(await page.evaluate(() => /refund|returned/i.test(document.querySelector('#setup .fee-explainer').textContent)), 'setup has entry-fee explainer');
    await shot('setup-fee-explainer');
    const before = await page.evaluate(() => window.__cf.save.coins);
    await go();
    ok(await page.evaluate(() => window.__cf.save.coins) === before - 100, 'entry fee 100 charged');
    await win(); await sleep(400);
    const wag = await page.evaluate(() => ({ t: document.getElementById('r-wager').textContent, c: window.__cf.save.coins, vis: !document.getElementById('r-wager').classList.contains('hidden') }));
    ok(wag.vis && /pool won \+200/.test(wag.t), 'wager result line: ' + wag.t);
    await shot('result-wager');
    // 3) championship dialog + QF
    await fresh(() => { window.__cf.save.coins = 1000; });
    await page.click('#btn-championship'); await sleep(300);
    await page.evaluate(() => { const d = document.querySelector('#championship .fee-explainer'); d.open = true; }); await sleep(150);
    await shot('championship-dialog');
    await page.click('#championship-start'); await sleep(300);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 }); await sleep(300);
    await win(); await sleep(600);
    const ch = await page.evaluate(() => ({ t: document.getElementById('r-championship').textContent, again: document.getElementById('btn-r-again').textContent, fit: document.querySelector('#result .panel').scrollHeight <= innerHeight }));
    ok(/next up/i.test(ch.t) && /Continue/.test(ch.again), 'QF win advances: ' + ch.t + ' / ' + ch.again);
    await shot('result-championship');
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log('v185 checks:', checks);
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
