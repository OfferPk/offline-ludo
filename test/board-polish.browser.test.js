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
    assert.equal(await page.evaluate(() => !!document.getElementById('btn-howto-home') && document.getElementById('btn-howto-home').parentElement.id === 'howto-card'), true);
    await page.click('#btn-arrow');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden) #board');
    await page.evaluate(() => {
      window.__cf.edit(function (st) {
        st.pieces[0] = [4, 0, -1, -1];
        st.pieces[2] = [17, 10, -1, -1];
        st.rules.arrows = true;
        st.rules.safeSquares = true;
        st.phase = 'move';
        st.queue = [3];
        st.moves = window.__cf.logic.queueMoves(st);
      });
    });
    fs.mkdirSync(shotDir, { recursive: true });
    async function capture(themeId, file) {
      await page.evaluate(id => {
        window.__cf.save.board = id;
        window.__cf.layout();
        document.body.classList.toggle('light', !window.SKINS.BOARDS.find(b => b.id === id).dark);
      }, themeId);
      const box = await page.evaluate(() => {
        const b = document.querySelector('#board-wrap').getBoundingClientRect();
        return { x: Math.max(0, b.left - 4), y: Math.max(0, b.top - 4), width: b.width + 8, height: b.height + 8 };
      });
      await page.screenshot({ path: file, clip: box });
      assert.ok(fs.statSync(file).size > 5000, file);
    }
    const def = path.join(shotDir, 'v150-board-default.png');
    const wood = path.join(shotDir, 'v150-board-wood.png');
    await capture('graphite', def);
    await capture('timber', wood);
    assert.deepEqual(errors, []);
    console.log('Board polish shots', def, wood);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
