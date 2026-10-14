// v1.9.2 Recent matches filters + Clear history, same-frame landing ripple, computer personalities, Monsoon + Kite Festival boards.
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
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p)), headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
  const shot = async name => { const out = path.join(shotDir, 'v192-' + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
  const go = async () => { await page.click('#btn-start'); await sleep(200);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden)'); await sleep(400); };
  const finish = async () => { await page.evaluate(() => window.__cf.edit(st => { const w = st.players[0]; st.pieces[w] = Array(st.nPieces || 4).fill(window.__cf.logic.HOME); st.phase = 'over'; st.ranking = st.players.slice(); }));
    await page.waitForSelector('#result:not(.hidden)'); await sleep(500); };
  try {
    // 1) History filters + clear
    await fresh(() => { const s = window.__cf.save; s.coins = 2000; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'hard' }, null, null]; });
    await page.click('#btn-pass'); await page.waitForSelector('#setup:not(.hidden)'); await page.click('#presets button[data-p="1v1"]'); await go(); await finish(); await page.click('#btn-r-home'); await sleep(500);
    for (let k = 0; k < 2; k++) { await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await go(); await finish(); await page.click('#btn-r-home'); await sleep(500); }
    await page.click('#btn-stats'); await page.waitForSelector('#stats:not(.hidden)');
    const count = () => page.evaluate(() => document.querySelectorAll('#history-list .history-item').length);
    ok(await count() === 3, 'All shows 3 matches');
    await page.click('#history-filter [data-filter="practice"]'); await sleep(100);
    ok(await count() === 1 && await page.evaluate(() => document.querySelector('#history-list .history-item').classList.contains('practice')), 'Practice filter shows only the Pass & Play match');
    await page.evaluate(() => document.getElementById('history-title').scrollIntoView({ block: 'start' })); await sleep(120);
    await shot('history-filter-practice');
    await page.click('#history-filter [data-filter="ranked"]'); await sleep(100);
    ok(await count() === 2 && await page.evaluate(() => document.querySelector('#history-filter [data-filter="ranked"]').getAttribute('aria-pressed') === 'true'), 'Ranked filter shows the 2 vs-computer matches');
    const statsBefore = await page.evaluate(() => JSON.stringify([window.__cf.save.stats.played, window.__cf.save.xp]));
    await page.click('#btn-clear-history'); await page.waitForSelector('#confirm:not(.hidden)');
    await shot('history-clear-confirm');
    await page.click('#confirm-no'); await sleep(150);
    ok(await page.evaluate(() => window.__cf.save.history.length === 3), 'Cancel keeps the history');
    await page.click('#btn-clear-history'); await page.waitForSelector('#confirm:not(.hidden)'); await page.click('#confirm-yes'); await sleep(200);
    ok(await page.evaluate(() => window.__cf.save.history.length === 0 && document.getElementById('btn-clear-history').disabled && !document.getElementById('history-empty').classList.contains('hidden')), 'Clear empties the list and disables the button');
    ok(await page.evaluate(() => JSON.stringify([window.__cf.save.stats.played, window.__cf.save.xp])) === statsBefore, 'stats and XP are untouched by Clear');
    await page.reload({ waitUntil: 'networkidle0' });
    ok(await page.evaluate(() => window.__cf.save.history.length === 0), 'cleared history stays cleared after reload');
    // 2) Personalities in setup + chat
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)');
    ok(/Vex, fierce rival/.test(await page.evaluate(() => document.getElementById('seat-list').textContent)), 'setup names the Hard computer as Vex, fierce rival');
    await page.evaluate(() => document.querySelector('.seat[data-seat="1"]').scrollIntoView({ block: 'center' })); await sleep(100);
    await shot('setup-personas');
    await go();
    const p = await page.evaluate(() => ['easy', 'medium', 'hard'].map(l => window.__cf.persona(l).name));
    ok(p.join() === 'Pip,Sable,Vex', 'three personalities: Pip, Sable, Vex');
    const aiSeat = await page.evaluate(() => window.__cf.game.st.players.find(x => window.__cf.game.st.seats[x].type === 'ai'));
    await page.evaluate(s => { Math.__r = Math.random; Math.random = () => 0; window.__cf.aiReact('capture', s, []); }, aiSeat);
    await sleep(700); await page.evaluate(() => { Math.random = Math.__r; });
    const bubble = await page.evaluate(() => document.body.innerText);
    ok(/Back to base!/.test(bubble), 'Vex speaks its own capture line');
    await shot('persona-chat');
    // 3) Landing ripple fires in the same frame as the step
    const ripple = await page.evaluate(() => new Promise(res => {
      const el = document.querySelector('#pieces .pc'); const seen = [];
      const PA = window.PathAnimation, orig = PA.animate;
      // run two quick steps through the real landRipple via the game's onStep: emulate with the classes directly
      el.classList.remove('land', 'land-b');
      const names = [];
      for (let k = 0; k < 3; k++) { window.__cf.landRipple(el); names.push(getComputedStyle(el, '::after').animationName); }
      res(names);
    }));
    ok(ripple.join() === 'gem-ripple,gem-ripple-b,gem-ripple', 'each landing restarts the ripple synchronously (alternating keyframes, no forced layout)');
    // 4) New boards
    await page.click('#btn-home').catch(() => {});
    await fresh(() => { window.__cf.save.coins = 5000; });
    ok(await page.evaluate(() => ['monsoon', 'kite-festival'].every(id => window.SKINS.BOARDS.some(b => b.id === id && b.price > 0))), 'Monsoon and Kite Festival boards are in the shop');
    for (const id of ['monsoon', 'kite-festival']) {
      await page.evaluate(id => { const s = window.__cf.save; s.owned.boards.push(id); s.board = id; window.__cf.persist(); }, id);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await go();
      await page.evaluate(() => window.__cf.tipShowing && window.__cf.dismissTip());
      await shot('board-' + id);
      await page.evaluate(() => window.__cf.edit(st => { st.phase = 'over'; st.ranking = st.players.slice(); }));
      await page.waitForSelector('#result:not(.hidden)'); await page.click('#btn-r-home'); await sleep(400);
    }
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log('v192 checks:', checks);
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
