// Headless phone: corner die is cream with dark pips (not a blank dark native button tile).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
function start() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.join(webRoot, url === '/' ? 'index.html' : url);
      if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('x'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'text/plain' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
function luminance(rgb) {
  const m = String(rgb).match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
(async () => {
  const { server, port } = await start();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => { try { localStorage.setItem('crossfour.tutorial.v1', '1'); } catch (e) {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btn-vs-ai', { visible: true });
    await page.click('#btn-vs-ai');
    await new Promise(r => setTimeout(r, 300));
    await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden) .pdice');
    await page.evaluate(() => {
      document.getElementById('tutorial-intro')?.classList.add('hidden');
      document.getElementById('tutorial-coach')?.classList.add('hidden');
    });
    await new Promise(r => setTimeout(r, 400));
    await page.evaluate(() => {
      window.__cf.edit(st => {
        st.turn = st.players.find(s => st.seats[s].type === 'human');
        st.phase = 'roll';
        st.faces[st.turn] = 5;
        st.queue = [];
      });
      document.getElementById('tutorial-intro')?.classList.add('hidden');
    });
    await new Promise(r => setTimeout(r, 200));
    const result = await page.evaluate(() => {
      const pods = [...document.querySelectorAll('.pod:not(.empty)')];
      const you = pods.find(p => (p.querySelector('.pname') || {}).textContent === 'You');
      const die = you && you.querySelector('.pdice');
      const flat = die && die.querySelector('.pdice-flat');
      const dcs = die && getComputedStyle(die);
      const overlay = document.getElementById('tutorial-intro');
      return {
        ok: !!(die && flat),
        appearance: dcs && dcs.appearance,
        filter: dcs && dcs.filter,
        bg: dcs && dcs.backgroundColor,
        cubeDisplay: die && getComputedStyle(die.querySelector('.cube')).display,
        pips: flat ? flat.querySelectorAll('i').length : 0,
        face: flat && flat.dataset.face,
        overlayHidden: !overlay || overlay.classList.contains('hidden'),
        hit: (() => {
          const r = die.getBoundingClientRect();
          const top = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0];
          return top && (top.classList.contains('pdice') || top.classList.contains('pdice-flat') || top.tagName === 'I');
        })()
      };
    });
    assert.ok(result.ok, 'corner die present');
    assert.ok(result.overlayHidden, 'tutorial overlay must not cover the die');
    assert.ok(result.hit, 'die must be topmost at its center');
    assert.ok(result.appearance === 'none' || result.appearance === 'button', 'appearance got ' + result.appearance);
    // Prefer none; if browser reports button, still require cream bg
    assert.ok(!result.filter || result.filter === 'none', 'no filter');
    assert.strictEqual(result.cubeDisplay, 'none');
    assert.strictEqual(result.pips, 5, 'face 5 has 5 pips');
    assert.ok(luminance(result.bg) > 200, 'cream button face, bg=' + result.bg);
    console.log('  ok - corner die cream + 5 pips, overlay clear', result.bg);
    console.log('corner-die browser check passed');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
