'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-grace-player');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return response.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end('Not found');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function presentGrace(page, names, seat) {
  await page.evaluate(({ playerNames, disconnectedSeat }) => {
    const L = window.__cf.logic;
    const now = Date.now();
    const grace = { seat: disconnectedSeat, until: now + 20000 };
    window.__cf.presentOnline({
      state: {
        protocol: 1, mode: 'classic', players: [0, 1, 2, 3],
        pieces: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
        turn: 0, phase: 'roll', queue: [], rules: Object.assign({}, L.DEFAULT_RULES),
        ranking: [], capd: [false, false, false, false], faces: [1, 1, 1, 1], grace
      },
      mySeat: 0, names: playerNames, grace, onMove: function () {}, onRoll: function () {}
    });
  }, { playerNames: names, disconnectedSeat: seat });
  await page.waitForFunction(() => !document.getElementById('game').classList.contains('hidden'));
  return page.$eval('#online-grace-text', element => element.textContent);
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pageErrors = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    for (const viewport of [
      { name: 'mobile', width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      { name: 'desktop', width: 1280, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
    ]) {
      const page = await browser.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.setViewport(viewport);
      await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector('#home:not(.hidden)');

      const named = await presentGrace(page, { 0: 'Amina', 1: 'Bilal', 2: 'Clara', 3: 'Danyal' }, 3);
      assert.match(named, /Danyal \(seat 4\) can rejoin for \d+s/, viewport.name + ' names the fourth disconnected player');
      assert.match(named, /No computer takes the seat\./, 'the message preserves the no-substitution rule');
      assert.equal(await page.$eval('#online-grace', element => element.getAttribute('role')), 'status', 'the countdown remains announced as a status region');
      await page.screenshot({ path: path.join(previewDir, viewport.name + '.png'), fullPage: true });

      if (viewport.name === 'mobile') {
        const hostileName = '<img src=x onerror=alert(1)>';
        const hostile = await presentGrace(page, { 0: 'Amina', 3: hostileName }, 3);
        assert.ok(hostile.includes(hostileName), 'profile names are rendered literally as text');
        assert.equal(await page.$eval('#online-grace', element => element.querySelectorAll('img').length), 0, 'profile names cannot inject markup into the status banner');

        const fallback = await presentGrace(page, {}, 3);
        assert.match(fallback, /Reconnect window: seat 4 can rejoin/, 'missing names fall back to the correct seat label');

        await presentGrace(page, {}, 8);
        assert.equal(await page.$eval('#online-grace', element => element.classList.contains('hidden')), true, 'out-of-range seat data never produces a misleading reconnect warning');
      }
      await page.close();
    }
    assert.deepEqual(pageErrors, [], 'the feature renders without uncaught browser errors');
    console.log('Online reconnect-player browser checks passed. Previews:', path.join(previewDir, 'mobile.png'), path.join(previewDir, 'desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
