// v1.9.1 token move speed, Recent matches (Practice label), effect budget under CPU throttling.
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
  const shot = async name => { const out = path.join(shotDir, 'v191-' + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
  const go = async () => { await page.click('#btn-start'); await sleep(200);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden)'); await sleep(400); };
  const finish = async () => { await page.evaluate(() => window.__cf.edit(st => { const w = st.players[0]; st.pieces[w] = Array(st.nPieces || 4).fill(window.__cf.logic.HOME); st.phase = 'over'; st.ranking = st.players.slice(); }));
    await page.waitForSelector('#result:not(.hidden)'); await sleep(500); };
  try {
    // 1) Move speed setting
    await fresh();
    ok(await page.evaluate(() => window.__cf.save.moveSpeed === 'normal' && window.__cf.stepMs === 150), 'default move speed Normal = 150 ms per square');
    await page.click('#btn-settings'); await page.waitForSelector('#settings:not(.hidden)');
    await page.evaluate(() => document.getElementById('move-speed').scrollIntoView({ block: 'center' }));
    await page.click('#move-speed [data-speed="relaxed"]'); await sleep(150);
    ok(await page.evaluate(() => window.__cf.stepMs === 210 && getComputedStyle(document.documentElement).getPropertyValue('--step-ms').trim() === '210ms' && document.querySelector('#move-speed [data-speed="relaxed"]').getAttribute('aria-pressed') === 'true'), 'Relaxed = 210 ms, pressed state + CSS var');
    await page.click('#move-speed [data-speed="quick"]'); await sleep(150);
    ok(await page.evaluate(() => window.__cf.stepMs === 100), 'Quick = 100 ms');
    await shot('settings-move-speed');
    await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('#home:not(.hidden)');
    ok(await page.evaluate(() => window.__cf.save.moveSpeed === 'quick' && window.__cf.stepMs === 100), 'move speed survives reload');
    await page.click('#btn-settings'); await page.waitForSelector('#settings:not(.hidden)');
    await page.evaluate(() => document.getElementById('set-fast').click()); await sleep(120);
    ok(await page.evaluate(() => window.__cf.stepMs === 85 && document.querySelector('#move-speed button').disabled), 'Fast animations overrides and locks the speed picker');
    await page.evaluate(() => document.getElementById('set-fast').click()); await page.evaluate(() => document.getElementById('btn-settings-close').click()); await sleep(200);
    // 2) Recent matches with Practice label
    await page.click('#btn-pass'); await page.waitForSelector('#setup:not(.hidden)'); await page.click('#presets button[data-p="1v1"]'); await go();
    await finish(); await page.click('#btn-r-home'); await sleep(500);
    await page.evaluate(() => { const s = window.__cf.save; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; });
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await go();
    await finish(); await page.click('#btn-r-home'); await sleep(500);
    const hist = await page.evaluate(() => window.__cf.save.history);
    ok(hist.length === 2 && hist[0].vsAi && !hist[0].practice && hist[1].practice && !hist[1].vsAi && hist[1].coins === 0 && hist[1].xp === 10, 'history stores newest first; Pass & Play is practice with 0 coins / 10 XP');
    await page.click('#btn-stats'); await page.waitForSelector('#stats:not(.hidden)');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#history-list .history-item')].map(li => ({ practice: li.classList.contains('practice'), tag: !!li.querySelector('.history-tag'), label: li.getAttribute('aria-label') })));
    ok(rows.length === 2 && !rows[0].tag && rows[1].tag && rows[1].practice && /^Practice match/.test(rows[1].label), 'Recent matches shows a Practice label on the Pass & Play row');
    ok(await page.evaluate(() => document.getElementById('history-empty').classList.contains('hidden')), 'empty note hidden once matches exist');
    await page.evaluate(() => document.getElementById('history-title').scrollIntoView({ block: 'start' })); await sleep(150);
    await shot('history-practice');
    await page.reload({ waitUntil: 'networkidle0' });
    ok(await page.evaluate(() => window.__cf.save.history.length === 2), 'history survives reload');
    await page.evaluate(() => { window.__cf.save.history = [{ at: 1, mode: 'nope', place: 9 }, 'x']; window.__cf.persist(); });
    await page.reload({ waitUntil: 'networkidle0' });
    ok(await page.evaluate(() => Array.isArray(window.__cf.save.history) && window.__cf.save.history.length === 0), 'malformed history entries are dropped on load');
    // 3) Effect budget under throttling
    await page.evaluate(() => { const s = window.__cf.save; s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; window.__cf.persist(); });
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await go();
    const cdp = await page.createCDPSession(); const runs = {};
    for (const rate of [1, 4, 6]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate }); await sleep(250);
      runs[rate + 'x'] = await page.evaluate(() => new Promise(res => {
        const fx = window.__cf.fxBench, d = []; let last = null, live = true, peak = 0;
        const box = document.getElementById('board-wrap').getBoundingClientRect(), cx = box.width / 2, cy = box.height / 2;
        (function t(n) { if (last != null) d.push(n - last); last = n; peak = Math.max(peak, fx.live); if (live) requestAnimationFrame(t); })(performance.now());
        for (let k = 0; k < 12; k++) setTimeout(() => fx.hop(cx - 120 + k * 20, cy + 40, k), k * 150);
        [300, 900, 1500].forEach(ms => setTimeout(() => fx.capture(cx, cy), ms));
        setTimeout(() => { live = false; const s = d.slice().sort((a, b) => a - b); res({ frames: d.length, p95: +s[Math.floor(s.length * .95)].toFixed(1), max: +s[s.length - 1].toFixed(1), over34ms: d.filter(x => x > 34).length, peakLive: peak }); }, 2600);
      }));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('   fx', JSON.stringify(runs));
    fs.writeFileSync(path.join(shotDir, 'v191-fx-frame-times.json'), JSON.stringify(runs, null, 2));
    ok(Object.values(runs).every(r => r.peakLive <= 49 + 2), 'live particles stay within the effect budget (peak ' + runs['4x'].peakLive + ')');
    ok(runs['4x'].p95 <= 34, '4x throttle: 95% of frames within 2 vsyncs during hops + captures (p95 ' + runs['4x'].p95 + ' ms)');
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log('v191 checks:', checks);
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
