'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
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
  const origin = new URL(local.url).origin;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).origin === origin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#btn-guest-chess');

    const guestEntry = await page.$eval('#btn-guest-chess', button => {
      const rect = button.getBoundingClientRect();
      const title = document.getElementById(button.getAttribute('aria-labelledby'));
      const description = document.getElementById(button.getAttribute('aria-describedby'));
      return { title: title && title.textContent.trim(), description: description && description.textContent.trim(),
        visible: getComputedStyle(button).display !== 'none' && rect.width > 0 && rect.height >= 44 && rect.top >= 0 && rect.bottom <= innerHeight,
        hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(guestEntry.title, 'Play Chess as Guest', 'the direct home action clearly offers guest Chess');
    assert.match(guestEntry.description, /No email.*Computer opponent.*No coins/i, 'the home action discloses the no-email computer path and no currency');
    assert.equal(guestEntry.visible, true, 'the guest action is visible above the fold on a phone');
    assert.equal(guestEntry.hit, true, 'the guest action has a working mobile tap target');
    assert.equal(guestEntry.overflow, false, 'the home screen has no horizontal overflow');
    assert.equal(await page.evaluate(() => typeof window.supabase), 'undefined', 'offline-first startup does not initialize Supabase');

    await page.click('#btn-guest-chess');
    await page.waitForFunction(() => !document.querySelector('#guest-chess-screen').classList.contains('hidden'));
    assert.equal(await page.$eval('#home', el => el.classList.contains('hidden')), true, 'guest play opens its own screen');
    assert.equal(await page.$eval('#online', el => !el.classList.contains('hidden')), false, 'guest play does not open the email-auth panel');
    assert.equal(await page.$eval('#guest-chess-board', el => el.querySelectorAll('[data-square]').length), 64, 'the guest board renders all 64 squares');
    assert.match(await page.$eval('#guest-chess-local-note', el => el.textContent), /does not use online rooms, accounts, coins, or cloud wallets/i, 'the guest match is explicitly isolated from membership and currency');
    assert.match(await page.$eval('#guest-chess-local-note', el => el.textContent), /cannot replace the computer/i, 'the UI does not promise unsupported live human takeover');

    await page.click('#guest-chess-board [data-square="52"]');
    await page.waitForFunction(() => document.querySelector('#guest-chess-board [data-square="36"]').classList.contains('is-legal'));
    await page.click('#guest-chess-board [data-square="36"]');
    await page.waitForFunction(() => {
      const snapshot = window.GuestChess.snapshot();
      return snapshot.state && snapshot.state.fullmove === 2 && snapshot.state.turn === 0 && !snapshot.computerThinking;
    }, { timeout: 10000 });
    const afterPair = await page.evaluate(() => window.GuestChess.snapshot().state);
    assert.equal(afterPair.position_history.length, 3, 'a human move and the computer reply are both applied to the local game state');
    assert.equal(afterPair.phase, 'active', 'the guest game remains active after an ordinary opening pair');
    assert.match(await page.$eval('#guest-chess-history', el => el.textContent), /e4/, 'guest move history uses verified Chess notation');
    assert.equal(await page.evaluate(() => typeof window.supabase), 'undefined', 'playing against the computer never creates an Auth session or Supabase client');
    assert.deepEqual(externalRequests, [], 'the local guest flow makes no external requests');

    for (const viewport of [
      { width: 360, height: 740, mobile: true },
      { width: 390, height: 844, mobile: true },
      { width: 1366, height: 900, mobile: false }
    ]) {
      await page.setViewport({ width: viewport.width, height: viewport.height, isMobile: viewport.mobile, hasTouch: viewport.mobile });
      await page.waitForFunction(() => window.GuestChess && document.querySelector('#guest-chess-screen'));
      await page.evaluate(() => {
        const screen = document.querySelector('#guest-chess-screen');
        screen.scrollTop = 0;
        window.GuestChess.start();
      });
      const layout = await page.$eval('#guest-chess-screen', screen => {
        const board = document.querySelector('#guest-chess-board').getBoundingClientRect();
        return { visible: !screen.classList.contains('hidden'), boardWidth: board.width, boardHeight: board.height,
          boardLeft: board.left, boardRight: board.right, viewportWidth: innerWidth,
          scrollWidth: document.documentElement.scrollWidth, columns: getComputedStyle(document.querySelector('.guest-chess-stage')).gridTemplateColumns };
      });
      assert.equal(layout.visible, true, viewport.width + 'px: guest board screen remains visible');
      assert.ok(layout.boardWidth > 0 && Math.abs(layout.boardWidth - layout.boardHeight) < 1, viewport.width + 'px: board remains square');
      assert.ok(layout.boardLeft >= 0 && layout.boardRight <= viewport.width + 1, viewport.width + 'px: board stays within viewport width');
      assert.ok(layout.scrollWidth <= viewport.width + 1, viewport.width + 'px: no horizontal overflow');
      if (viewport.mobile) {
        const controls = await page.evaluate(() => {
          const screen = document.querySelector('#guest-chess-screen');
          screen.scrollTop = screen.scrollHeight;
          const button = document.querySelector('#guest-chess-online').getBoundingClientRect();
          return { scrollTop: screen.scrollTop, scrollRange: screen.scrollHeight - screen.clientHeight,
            buttonReachable: button.width > 0 && button.top >= 0 && button.bottom <= innerHeight };
        });
        assert.ok(controls.scrollRange > 0 && controls.scrollTop > 0, viewport.width + 'px: guest screen supports vertical scrolling for lower controls');
        assert.equal(controls.buttonReachable, true, viewport.width + 'px: the human-online action is reachable after scrolling');
        await page.evaluate(() => { document.querySelector('#guest-chess-screen').scrollTop = 0; });
      }
      if (!viewport.mobile) assert.match(layout.columns, /\s/, 'desktop layout retains a multi-column board and information panel');
    }
    assert.deepEqual(errors, [], 'guest Chess produces no uncaught browser errors');
    console.log('Guest Chess browser checks passed (no-email entry, local computer reply, non-member/currency isolation, explicit no-takeover boundary, mobile and desktop layouts).');
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
