'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-classic-standings');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

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

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).origin === new URL(local.url).origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    assert.equal(await page.evaluate(() => typeof window.OnlineClassicStandings), 'object', 'the standings renderer loads with the real app page');

    const roster = [
      { seat: 0, user_id: 'me', displayName: 'Amina' },
      { seat: 1, user_id: 'b', displayName: '<img src=x onerror=alert(1)>Bilal' },
      { seat: 2, user_id: 'c', displayName: 'Clara' },
      { seat: 3, user_id: 'd', handle: 'dplayer' }
    ];
    const previewRoster = roster.map(member => Object.assign({}, member, { displayName: member.seat === 1 ? 'Bilal' : member.displayName }));
    await page.evaluate(rosterArg => {
      document.querySelectorAll('.screen').forEach(element => {
        if (element.id === 'online') element.classList.remove('hidden');
        else element.classList.add('hidden');
      });
      const screen = document.getElementById('online');
      const roomPanel = document.getElementById('online-room-panel');
      const roomCard = document.getElementById('online-room-card');
      const matchPanel = document.getElementById('online-match-panel');
      [screen, roomPanel, roomCard, matchPanel].forEach(element => element.classList.remove('hidden'));
      document.getElementById('online-match-heading').textContent = 'Match complete';
      document.getElementById('online-match-turn').textContent = 'Match complete. Winner: Clara';
      ['online-match-dice', 'online-match-pieces', 'online-match-moves', 'online-match-actions', 'online-classic-note', 'online-chess-play']
        .forEach(id => document.getElementById(id).classList.add('hidden'));
      window.OnlineClassicStandings.render(
        document.getElementById('online-classic-standings'),
        { phase: 'over', ranking: [2, 0], abandoned: [1, 3] },
        rosterArg,
        'me'
      );
    }, roster);

    const rows = await page.$$eval('#online-classic-standings-list > li', items => items.map(item => ({
      text: item.textContent.replace(/\s+/g, ' ').trim(),
      label: item.getAttribute('aria-label'),
      seat: item.dataset.seat,
      status: item.dataset.status,
      imageCount: item.querySelectorAll('img').length
    })));
    assert.deepEqual(rows, [
      { text: '1stClaraWinner', label: '1st place, Clara, Winner', seat: '2', status: 'ranked', imageCount: 0 },
      { text: '2ndAminaYou', label: '2nd place, Amina, You', seat: '0', status: 'ranked', imageCount: 0 },
      { text: '—<img src=x onerror=alert(1)>BilalLeft early', label: 'Not ranked, <img src=x onerror=alert(1)>Bilal, Left early', seat: '1', status: 'abandoned', imageCount: 0 },
      { text: '—dplayerLeft early', label: 'Not ranked, dplayer, Left early', seat: '3', status: 'abandoned', imageCount: 0 }
    ], 'the authoritative finish order and unranked departures render as text, never as markup');
    assert.equal(await page.$eval('#online-classic-standings', section => section.getAttribute('aria-labelledby')), 'online-classic-standings-title');

    const layout = await page.evaluate(() => {
      const section = document.getElementById('online-classic-standings');
      return { page: document.documentElement.scrollWidth, viewport: innerWidth, section: section.getBoundingClientRect().width, scroll: section.scrollWidth, client: section.clientWidth };
    });
    assert.ok(layout.page <= 390, 'mobile standings do not create horizontal page overflow');
    assert.ok(layout.scroll <= layout.client + 1, 'long player names stay within the standings panel');
    fs.mkdirSync(previewDir, { recursive: true });
    await page.evaluate(rosterArg => window.OnlineClassicStandings.render(
      document.getElementById('online-classic-standings'), { phase: 'over', ranking: [2, 0], abandoned: [1, 3] }, rosterArg, 'me'
    ), previewRoster);
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(element => {
        if (element.id === 'online') element.classList.remove('hidden');
        else element.classList.add('hidden');
      });
      for (let element = document.getElementById('online-match-panel'); element; element = element.parentElement) element.classList.remove('hidden');
      document.getElementById('online-match-heading').textContent = 'Match complete';
      document.getElementById('online-match-turn').textContent = 'Match complete. Winner: Clara';
      ['online-match-dice', 'online-match-pieces', 'online-match-moves', 'online-match-actions', 'online-classic-note', 'online-chess-play']
        .forEach(id => document.getElementById(id).classList.add('hidden'));
    });
    await page.$eval('#online-classic-standings', element => element.scrollIntoView({ block: 'center' }));
    await (await page.$('#online-match-panel')).screenshot({ path: path.join(previewDir, 'online-classic-standings-mobile.png') });

    await page.evaluate(() => window.OnlineClassicStandings.render(
      document.getElementById('online-classic-standings'), { phase: 'move', ranking: [], abandoned: [] }, [], 'me'
    ));
    assert.equal(await page.$eval('#online-classic-standings', section => section.classList.contains('hidden')), true, 'the final panel disappears again for a live state');
    assert.equal(await page.$$eval('#online-classic-standings-list > li', items => items.length), 0, 'live-state transitions clear stale placements');

    await page.setViewport({ width: 1440, height: 960, isMobile: false, deviceScaleFactor: 1 });
    await page.evaluate(rosterArg => {
      window.OnlineClassicStandings.render(
        document.getElementById('online-classic-standings'), { phase: 'over', ranking: [2, 0], abandoned: [1, 3] }, rosterArg, 'me'
      );
    }, previewRoster);
    assert.equal(await page.$eval('#online-classic-standings', section => section.classList.contains('hidden')), false, 'the desktop completion view is visible');
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(element => {
        if (element.id === 'online') element.classList.remove('hidden');
        else element.classList.add('hidden');
      });
      for (let element = document.getElementById('online-match-panel'); element; element = element.parentElement) element.classList.remove('hidden');
      document.getElementById('online-match-heading').textContent = 'Match complete';
      document.getElementById('online-match-turn').textContent = 'Match complete. Winner: Clara';
      ['online-match-dice', 'online-match-pieces', 'online-match-moves', 'online-match-actions', 'online-classic-note', 'online-chess-play']
        .forEach(id => document.getElementById(id).classList.add('hidden'));
    });
    await (await page.$('#online-match-panel')).screenshot({ path: path.join(previewDir, 'online-classic-standings-desktop.png') });

    assert.deepEqual(pageErrors, [], 'standings render without uncaught browser errors');
    console.log('Online Classic standings browser checks passed. Previews:', previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
