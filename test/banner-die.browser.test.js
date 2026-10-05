// Banner die must show pips whenever a roll face exists (incl. AI turn).
// Optional local/CI-with-Chrome: PUPPETEER=/path CHROME=/usr/bin/google-chrome node test/banner-die.browser.test.js
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const root = path.join(__dirname, '..', 'www');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('missing'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
});

function listen() { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }

(async () => {
  const port = await listen();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#btn-arrow', { visible: true });
    await page.click('#btn-arrow');
    await new Promise(r => setTimeout(r, 400));
    await page.click('#btn-start');
    await new Promise(r => setTimeout(r, 1000));
    const result = await page.evaluate(() => {
      const L = window.__cf.logic;
      const st = window.__cf.game.st;
      const ai = st.players.find(s => st.seats[s].type === 'ai');
      window.__cf.edit(s => {
        s.turn = ai;
        s.phase = 'move';
        s.faces[ai] = 5;
        s.queue = [5];
        s.moves = L.queueMoves(s);
      });
      const die = document.querySelector('#turn-label .banner-die');
      const pips = die ? die.querySelectorAll('i').length : 0;
      const face = die && die.dataset.face;
      const style = die ? getComputedStyle(die) : null;
      return {
        hasDie: !!die,
        face,
        pips,
        opacity: style && style.opacity,
        label: document.getElementById('turn-label') && document.getElementById('turn-label').textContent
      };
    });
    assert.ok(result.hasDie, 'turn banner must contain .banner-die, got: ' + JSON.stringify(result));
    assert.strictEqual(result.face, '5', 'banner die data-face should be 5');
    assert.strictEqual(result.pips, 5, 'banner die must render 5 pip nodes');
    assert.ok(Number(result.opacity) > 0.5, 'banner die must be visible');
    console.log('  ok - banner die shows pips during AI turn (face ' + result.face + ')');
    console.log('banner-die browser check passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
