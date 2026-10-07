'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = process.env.PREVIEW_DIR || path.join(os.tmpdir(), 'offline-ludo-move-announcements');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (error) { res.writeHead(400).end('Bad request'); return; }
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
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

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#btn-start');
    await page.waitForFunction(() => {
      const c = window.__cf, g = c && c.game;
      return g && !c.busy && !c.paused && g.st.seats[g.st.turn].type === 'human' && g.st.phase === 'roll';
    }, { timeout: 20000 });

    const initial = await page.evaluate(() => {
      const region = document.getElementById('offline-move-announcement');
      const style = getComputedStyle(region), rect = region.getBoundingClientRect();
      return { seat: window.__cf.game.st.turn, role: region.getAttribute('role'), live: region.getAttribute('aria-live'), atomic: region.getAttribute('aria-atomic'), width: rect.width, height: rect.height, position: style.position };
    });
    assert.deepEqual({ role: initial.role, live: initial.live, atomic: initial.atomic, width: initial.width, height: initial.height, position: initial.position },
      { role: 'status', live: 'polite', atomic: 'true', width: 1, height: 1, position: 'absolute' },
      'the announcement is a polite live status and has no visible footprint');

    await page.evaluate(seat => {
      window.__cf.force([6]);
      const die = document.querySelector('.pod[data-seat="' + seat + '"] .pdice');
      if (!die) throw new Error('active player die is missing');
      die.click();
    }, initial.seat);
    await page.waitForFunction(seat => {
      const g = window.__cf.game;
      return g && g.st.turn === seat && g.st.phase === 'move' && g.st.moves.some(m => m.piece === 0);
    }, { timeout: 10000 }, initial.seat);
    const point = await page.evaluate(seat => window.__cf.piecePoint(seat, 0), initial.seat);
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(() => /moved token 1 out of the base/.test(document.getElementById('offline-move-announcement').textContent), { timeout: 12000 });

    const result = await page.evaluate(seat => ({
      message: document.getElementById('offline-move-announcement').textContent,
      position: window.__cf.game.st.pieces[seat][0],
      savedPosition: JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game.st.pieces[seat][0]
    }), initial.seat);
    assert.match(result.message, /moved token 1 out of the base and onto the track\./, 'a completed offline move is announced in plain language');
    assert.notEqual(result.position, -1, 'the chosen token moved in the game state');
    assert.equal(result.savedPosition, result.position, 'the existing local save still contains the actual game result');

    const mobilePath = path.join(previewDir, 'mobile.png');
    await page.screenshot({ path: mobilePath, fullPage: true });
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    desktopPage.on('pageerror', error => pageErrors.push(error.message));
    await desktopPage.goto(local.url, { waitUntil: 'networkidle0' });
    await desktopPage.waitForSelector('#btn-continue:not(.hidden)', { timeout: 10000 });
    await desktopPage.click('#btn-continue');
    await desktopPage.waitForSelector('#game:not(.hidden)');
    assert.notEqual(await desktopPage.evaluate(seat => window.__cf.game.st.pieces[seat][0], initial.seat), -1,
      'desktop reload resumes the same saved offline match');
    await desktopPage.screenshot({ path: path.join(previewDir, 'desktop.png'), fullPage: true });
    assert.deepEqual(pageErrors, [], 'the browser reports no uncaught JavaScript exceptions');
    console.log('Offline move-announcement browser test passed. Mobile preview: ' + mobilePath);
    await desktopPage.close();
    await page.close();
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
