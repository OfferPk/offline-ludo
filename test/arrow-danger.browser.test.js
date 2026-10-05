'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, rel);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}
(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-arrow');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden) #board');
    fs.mkdirSync(shotDir, { recursive: true });
    // sample the board canvas at track cell `abs` (left-middle of the cell, away from the glyph/tokens)
    async function sample(abs) {
      return page.evaluate(a => {
        const L = window.__cf.logic, cv = document.getElementById('board'), ctx = cv.getContext('2d');
        const W = cv.width, c = W / 15, th = ((window.__cf.game.view || 0) * Math.PI) / 2;
        const rc = L.TRACK_CELLS[a], X = (rc[1] + 0.22) * c, Y = (rc[0] + 0.5) * c, m = W / 2;
        const px = m + (X - m) * Math.cos(th) - (Y - m) * Math.sin(th), py = m + (X - m) * Math.sin(th) + (Y - m) * Math.cos(th);
        const d = ctx.getImageData(Math.round(px) - 2, Math.round(py) - 2, 5, 5).data; let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        return [r / 25, g / 25, b / 25].map(Math.round);
      }, abs);
    }
    const isRed = p => p[0] > 140 && p[0] - p[1] > 60 && p[0] - p[2] > 60;
    async function setTheme(id) {
      await page.evaluate(id => {
        window.__cf.save.board = id;
        window.__cf.layout();
        document.body.classList.toggle('light', !window.SKINS.BOARDS.find(b => b.id === id).dark);
      }, id);
    }
    async function capture(file) {
      const box = await page.evaluate(() => {
        const b = document.querySelector('#board-wrap').getBoundingClientRect();
        return { x: Math.max(0, b.left - 4), y: Math.max(0, b.top - 4), width: b.width + 8, height: b.height + 8 };
      });
      await page.screenshot({ path: file, clip: box });
      assert.ok(fs.statSync(file).size > 5000, file);
    }
    const L = await page.evaluate(() => ({ danger: window.__cf.logic.ARROW_DANGER_SQUARES, arrows: window.__cf.logic.ARROW_SQUARES }));
    assert.equal(L.danger.length, 12);
    // empty board (no tokens on the track) so every red cell is visible
    await page.evaluate(() => window.__cf.edit(function (st) {
      st.players.forEach(function (s) { st.pieces[s] = st.pieces[s].map(function () { return -1; }); });
      st.phase = 'roll'; st.queue = [];
    }));
    const shots = [];
    for (const theme of ['timber', 'forest', 'graphite', 'linen', 'midnight', 'walnut']) {
      await setTheme(theme);
      for (const a of L.danger) assert.ok(isRed(await sample(a)), theme + ': cell ' + a + ' red ' + (await sample(a)));
      for (const a of [1, 2, 3, 9, 10, 11, 14, 22, 27, 35, 40, 48]) assert.ok(!isRed(await sample(a)), theme + ': cell ' + a + ' must stay plain');
      const f = path.join(shotDir, 'v160-arrow-danger-' + theme + '.png'); await capture(f); shots.push(f);
    }
    // in play: tokens approaching / sitting on red cells (wood theme)
    await setTheme('timber');
    await page.evaluate(() => window.__cf.edit(function (st) {
      st.pieces[0] = [1, 6, -1, -1];
      st.pieces[2] = [-1, -1, -1, -1];
      if (st.pieces[1]) st.pieces[1] = [((19 - 13) + 52) % 52, -1, -1, -1];
      if (st.pieces[3]) st.pieces[3] = [((45 - 39) + 52) % 52, -1, -1, -1];
      st.phase = 'move'; st.queue = [3];
    }));
    const play = path.join(shotDir, 'v160-arrow-danger-play.png'); await capture(play); shots.push(play);
    // classic mode: no red danger cells
    await page.evaluate(() => window.__cf.edit(function (st) { st.rules.arrows = false; st.mode = 'classic'; }));
    for (const a of L.danger) assert.ok(!isRed(await sample(a)), 'classic: cell ' + a + ' not red');
    const classic = path.join(shotDir, 'v160-arrow-danger-classic-off.png'); await capture(classic); shots.push(classic);
    assert.deepEqual(errors, []);
    console.log('Arrow danger shots\n' + shots.join('\n'));
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
