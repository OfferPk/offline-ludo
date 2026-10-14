// v1.9.0 smoother token hops (frame timing under CPU throttling), Reset tips, Pass & Play practice note.
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
  const shot = async name => { const out = path.join(shotDir, 'v190-' + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
  const go = async () => { await page.click('#btn-start'); await sleep(200);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
    await page.waitForSelector('#game:not(.hidden)'); await sleep(400); };
  const finish = async () => { await page.evaluate(() => window.__cf.edit(st => { const w = st.players[0]; st.pieces[w] = Array(st.nPieces || 4).fill(window.__cf.logic.HOME); st.phase = 'over'; st.ranking = st.players.slice(); }));
    await page.waitForSelector('#result:not(.hidden)'); await sleep(500); };
  const oldAnim = fs.readFileSync(process.env.OLD_PATH_ANIM || '/dev/null', 'utf8');
  // Animate a real board token across 12 squares and sample every animation frame.
  const measure = async (variant) => page.evaluate((variant, oldSrc) => new Promise(resolve => {
    let api = window.PathAnimation;
    if (variant === 'old') { const m = { exports: {} }; new Function('module', 'self', oldSrc)(m, window); api = m.exports; }
    const el = document.querySelector('#game [data-seat][data-piece]');
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform || '') || [0, 40, 40];
    const x0 = +m[1], y0 = +m[2], cell = 26, dur = 150, points = [];
    for (let k = 1; k <= 12; k++) points.push({ x: x0 + (k % 7) * cell, y: y0 + Math.floor(k / 7) * cell });
    const deltas = []; let last = null, live = true;
    (function tick(t) { if (last != null) deltas.push(t - last); last = t; if (live) requestAnimationFrame(tick); })(performance.now());
    const t0 = performance.now();
    api.animate({ el, start: { x: x0, y: y0 }, points, duration: dur, arcHeight: 11, onComplete() {
      live = false; const total = performance.now() - t0; const sorted = deltas.slice().sort((a, b) => a - b);
      resolve({ total, ideal: points.length * dur, frames: deltas.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted[sorted.length - 1], long: deltas.filter(d => d > 50).length });
    } });
  }), variant, oldAnim);
  try {
    // 1) Pass & Play setup: practice note only for all-human tables
    await fresh();
    await page.click('#btn-pass'); await page.waitForSelector('#setup:not(.hidden)'); await page.click('#presets button[data-p="1v1"]'); await sleep(200);
    ok(await page.evaluate(() => !document.getElementById('practice-note').classList.contains('hidden')), 'practice note on all-human Pass & Play setup');
    await page.evaluate(() => document.getElementById('practice-note').scrollIntoView({ block: 'center' })); await sleep(150);
    await shot('setup-practice-note');
    await page.evaluate(() => document.querySelector('.seat[data-seat="1"] .seat-options button[data-v="easy"]').click()); await sleep(150);
    ok(await page.evaluate(() => document.getElementById('practice-note').classList.contains('hidden')), 'note hides once a computer seat is added');
    await page.evaluate(() => document.querySelector('.seat[data-seat="1"] .seat-options button[data-v="human"]').click()); await sleep(100);
    // 2) frame timing under 4x CPU throttling
    await go(); await page.evaluate(() => window.__cf.dismissTip && window.__cf.tipShowing && window.__cf.dismissTip());
    const cdp = await page.createCDPSession();
    const runs = {};
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const v of ['old', 'new']) { if (v === 'old' && !oldAnim) continue; await sleep(200); runs[v + '@' + rate + 'x'] = await measure(v); }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const [k, r] of Object.entries(runs)) console.log('   ', k, 'total', r.total.toFixed(0) + 'ms / ideal ' + r.ideal + 'ms', 'frames', r.frames, 'p50', r.p50.toFixed(1), 'p95', r.p95.toFixed(1), 'max', r.max.toFixed(1), 'long>50ms', r.long);
    fs.writeFileSync(path.join(shotDir, 'v190-frame-times.json'), JSON.stringify(runs, null, 2));
    const n = runs['new@4x'];
    ok(n.total < n.ideal + 3 * Math.max(n.p95, 17), 'new hops keep to the timeline under 4x throttling (no per-square drift): ' + n.total.toFixed(0) + 'ms for ' + n.ideal + 'ms');
    if (runs['old@4x']) ok(n.total <= runs['old@4x'].total + 5, 'new timeline is no slower than the old per-square timers');
    // 3) Reset tips in Settings
    await page.click('#btn-r-home').catch(() => {});
    await fresh(() => localStorage.setItem('crossfour.tips.v1', JSON.stringify({ arrow: 1, danger: 1, practice: 1, fee: 1, championship: 1 })));
    await page.click('#btn-settings'); await page.waitForSelector('#settings:not(.hidden)');
    await page.evaluate(() => document.getElementById('btn-reset-tips').scrollIntoView({ block: 'center', inline: 'nearest' }));
    await page.click('#btn-reset-tips'); await sleep(200);
    ok(await page.evaluate(() => localStorage.getItem('crossfour.tips.v1') === null && /reset/i.test(document.getElementById('reset-tips-status').textContent)), 'Reset tips clears seen tips and confirms');
    await shot('settings-reset-tips');
    await page.evaluate(() => document.getElementById('btn-settings-close').click()); await sleep(300);
    await page.click('#btn-championship'); await sleep(300);
    ok(await page.evaluate(() => window.__cf.tipShowing) === 'championship', 'tips show again after reset');
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log('v190 checks:', checks);
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
