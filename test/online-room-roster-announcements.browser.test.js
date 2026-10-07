'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const previewDir = path.join(root, 'docs', 'previews', 'online-room-roster-announcements');
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const liveRegionMatch = indexHtml.match(/<p id="online-room-roster-announcement"[^>]*><\/p>/);
if (!liveRegionMatch) throw new Error('Production room-roster live-region markup was not found.');

const previewHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/css/style.css">
  <title>Online room roster accessibility preview</title>
</head>
<body>
  <main class="online-screen" style="max-width:560px;margin:32px auto;padding:0 16px">
    <section id="online-room-card" class="online-room-card" aria-labelledby="online-room-heading">
      <div class="online-card-head"><div><span class="online-eyebrow">TABLE</span><h3 id="online-room-heading">Your room</h3><small>Classic · 4 seats</small></div></div>
      <p class="online-room-state">Waiting for players to join and ready up.</p>
      ${liveRegionMatch[0]}
      <h4>Players</h4>
      <ul id="online-room-roster" class="online-room-roster">
        <li><b>Amina</b><small>Seat 1 · Ready · Host</small></li>
        <li><b>Rafi</b><small>Seat 2 · Not ready</small></li>
      </ul>
      <div class="online-provider-actions"><button class="btn plate" type="button" aria-pressed="true">Mark not ready</button><button class="btn primary" type="button">Start table</button></div>
    </section>
  </main>
  <script src="/js/online-room-roster-announcements.js"></script>
</body>
</html>`;

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(previewHtml);
        return;
      }
      const file = path.resolve(webRoot, pathname.replace(/^\/+/, ''));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        const contentType = pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
        response.writeHead(200, { 'Content-Type': contentType }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function openPreviewPage(browser, url, viewport, pageErrors) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  return page;
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const pageErrors = [];
  try {
    const page = await openPreviewPage(browser, local.url, { width: 390, height: 844, isMobile: true, hasTouch: true }, pageErrors);
    const liveRegion = await page.evaluate(() => {
      const element = document.getElementById('online-room-roster-announcement');
      const style = getComputedStyle(element);
      return {
        role: element.getAttribute('role'),
        live: element.getAttribute('aria-live'),
        atomic: element.getAttribute('aria-atomic'),
        className: element.className,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        position: style.position,
        clipPath: style.clipPath
      };
    });
    assert.equal(liveRegion.role, 'status');
    assert.equal(liveRegion.live, 'polite');
    assert.equal(liveRegion.atomic, 'true');
    assert.equal(liveRegion.className, 'online-room-sr-only');
    assert.equal(liveRegion.width, 1, 'the announcement region is available to assistive technology without taking visual space');
    assert.equal(liveRegion.height, 1);
    assert.equal(liveRegion.position, 'absolute');
    assert.equal(liveRegion.clipPath, 'inset(50%)');

    const output = await page.evaluate(() => {
      const announcements = window.OnlineRoomRosterAnnouncements;
      const starting = [
        { user_id: 'user-one', seat: 0, displayName: 'Amina', ready: true },
        { user_id: 'user-two', seat: 1, displayName: 'Rafi', ready: false }
      ];
      const initial = announcements.update('room-one', starting, 'user-one');
      const joined = announcements.update('room-one', starting.concat([{ user_id: 'user-three', seat: 2, displayName: 'Sam', ready: false }]), 'user-one');
      const messageAfterJoin = document.getElementById('online-room-roster-announcement').textContent;
      const afterReady = [
        { user_id: 'user-one', seat: 0, displayName: 'Amina', ready: true },
        { user_id: 'user-two', seat: 1, displayName: 'Rafi', ready: true },
        { user_id: 'user-three', seat: 2, displayName: 'Sam', ready: false }
      ];
      const ready = announcements.update('room-one', afterReady, 'user-one');
      const afterOwnReady = [
        { user_id: 'user-one', seat: 0, displayName: 'Amina', ready: false },
        { user_id: 'user-two', seat: 1, displayName: 'Rafi', ready: true },
        { user_id: 'user-three', seat: 2, displayName: 'Sam', ready: false }
      ];
      const silent = announcements.update('room-one', afterOwnReady, 'user-one');
      const afterOwnReadyToggle = document.getElementById('online-room-roster-announcement').textContent;
      const withoutSam = afterOwnReady.slice(0, 2);
      const left = announcements.update('room-one', withoutSam, 'user-one');
      const messageAfterLeave = document.getElementById('online-room-roster-announcement').textContent;
      const unsafeName = '<b>Sam</b>';
      const safe = announcements.update('room-one', withoutSam.concat([{ user_id: 'user-four', seat: 3, displayName: unsafeName, ready: false }]), 'user-one');
      const safeRegion = document.getElementById('online-room-roster-announcement');
      const noInjectedMarkup = safeRegion.querySelector('b') === null;
      const newRoom = announcements.update('room-two', starting, 'user-one');
      return { initial, joined, messageAfterJoin, ready, silent, afterOwnReadyToggle, left, messageAfterLeave, safe, noInjectedMarkup, newRoom };
    });
    assert.deepEqual(output.initial, [], 'the first snapshot is a quiet baseline');
    assert.deepEqual(output.joined, ['Sam joined the room.']);
    assert.equal(output.messageAfterJoin, 'Sam joined the room.');
    assert.deepEqual(output.ready, ['Rafi is ready.']);
    assert.deepEqual(output.silent, [], 'a current player’s own Ready change does not duplicate the button state');
    assert.equal(output.afterOwnReadyToggle, 'Rafi is ready.');
    assert.deepEqual(output.left, ['Sam left the room.']);
    assert.equal(output.messageAfterLeave, 'Sam left the room.');
    assert.deepEqual(output.safe, ['<b>Sam</b> joined the room.']);
    assert.equal(output.noInjectedMarkup, true, 'display names are announced as text, never parsed as markup');
    assert.deepEqual(output.newRoom, [], 'switching rooms resets the announcement baseline');

    fs.mkdirSync(previewDir, { recursive: true });
    const mobileCard = await page.$('#online-room-card');
    const mobilePreview = path.join(previewDir, 'online-room-roster-announcements-mobile.png');
    await mobileCard.screenshot({ path: mobilePreview });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the room card fits a mobile viewport');

    const desktopPage = await openPreviewPage(browser, local.url, { width: 1440, height: 960, isMobile: false, deviceScaleFactor: 1 }, pageErrors);
    const desktopCard = await desktopPage.$('#online-room-card');
    const desktopPreview = path.join(previewDir, 'online-room-roster-announcements-desktop.png');
    await desktopCard.screenshot({ path: desktopPreview });
    assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the room card fits a desktop viewport');
    assert.deepEqual(pageErrors, [], 'the room-roster announcement preview has no uncaught browser errors');
    console.log('Online room-roster announcement browser test passed. Previews:', mobilePreview, desktopPreview);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
