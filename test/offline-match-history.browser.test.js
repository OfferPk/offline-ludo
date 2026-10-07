'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'offline-match-history');
const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function startLocalServer() {
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch (error) { response.writeHead(400).end('Bad request'); return; }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(webRoot, '.' + pathname);
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      response.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' });
  }));
}

(async () => {
  const local = await startLocalServer();
  let browser;
  const pageErrors = [];
  const supabaseRequests = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const origin = new URL(local.url).origin;
    page.on('request', request => {
      const url = request.url();
      if (/supabase\.(co|com)/i.test(url)) supabaseRequests.push(url);
      if (new URL(url).origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });

    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
      if (!window.__cf.persist()) throw new Error('could not seed an initial local save');
      ['crossfour.save.v3', 'crossfour.save.checkpoint.v3'].forEach(key => {
        const snapshot = JSON.parse(localStorage.getItem(key));
        if (snapshot && snapshot.payload) {
          delete snapshot.payload.recentMatches;
          localStorage.setItem(key, JSON.stringify(snapshot));
        }
      });
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    const legacyLoad = await page.evaluate(() => ({ status: window.__cf.loadStatus, history: window.__cf.save.recentMatches }));
    assert.equal(legacyLoad.status, 'loaded', 'a pre-history v3 save remains loadable');
    assert.deepEqual(legacyLoad.history, [], 'old saves start with an empty local history');

    await page.click('#btn-stats');
    await page.waitForSelector('#stats:not(.hidden)');
    assert.match(await page.$eval('#recent-match-list', el => el.textContent), /No completed offline matches yet/);
    await page.click('#stats [data-close="stats"]');

    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden) #board');
    await page.waitForFunction(() => window.__cf && window.__cf.game && !window.__cf.game.online);
    await page.evaluate(() => window.__cf.edit(state => {
      state.phase = 'over';
      state.ranking = state.players.slice().reverse();
      state.queue = [];
      state.moves = [];
      state.pieces.forEach(pieces => { if (pieces) pieces.fill(57); });
    }));
    await page.waitForSelector('#result:not(.hidden)');
    const firstFinish = await page.evaluate(() => ({
      count: window.__cf.save.recentMatches.length,
      entry: window.__cf.save.recentMatches[0],
      gameCounted: window.__cf.game.counted
    }));
    assert.equal(firstFinish.count, 1, 'one completed offline match creates one summary');
    assert.equal(firstFinish.entry.mode, 'classic');
    assert.ok(Number.isSafeInteger(firstFinish.entry.completedAt));
    assert.deepEqual(firstFinish.entry.ranking, await page.evaluate(() => window.__cf.game.st.ranking));
    assert.equal(firstFinish.gameCounted, true);

    await page.evaluate(() => window.__cf.edit(() => {}));
    assert.equal(await page.evaluate(() => window.__cf.save.recentMatches.length), 1, 're-rendering an already-counted result does not duplicate it');
    await page.click('#btn-r-home');
    await page.waitForSelector('#home:not(.hidden)');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-stats');
    await page.waitForSelector('#stats:not(.hidden)');
    const rendered = await page.$eval('#recent-match-list', list => ({
      count: list.querySelectorAll('li[data-match-history-entry]').length,
      text: list.textContent,
      usesTime: !!list.querySelector('time[datetime]')
    }));
    assert.equal(rendered.count, 1, 'the completed result is still present after reload');
    assert.match(rendered.text, /Classic Ludo/);
    assert.match(rendered.text, /Finish order:/);
    assert.equal(rendered.usesTime, true, 'result dates use semantic time markup');
    await page.screenshot({ path: path.join(previewDir, 'mobile.png'), fullPage: false });

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await page.waitForSelector('#home:not(.hidden)');
    const statsStillOpen = await page.$eval('#stats', element => !element.classList.contains('hidden'));
    if (!statsStillOpen) await page.click('#btn-stats');
    await page.waitForSelector('#stats:not(.hidden)');
    await new Promise(resolve => setTimeout(resolve, 450));
    await page.screenshot({ path: path.join(previewDir, 'desktop.png'), fullPage: false });

    await page.click('#stats [data-close="stats"]');
    await page.click('#btn-settings');
    await page.waitForSelector('#settings:not(.hidden)');
    await page.click('#btn-reset');
    await page.waitForSelector('#confirm:not(.hidden)');
    await page.click('#confirm-yes');
    await page.waitForFunction(() => document.querySelector('#home') && !document.querySelector('#home').classList.contains('hidden'));
    await page.waitForFunction(() => window.__cf && window.__cf.save && Array.isArray(window.__cf.save.recentMatches));
    const afterReset = await page.evaluate(() => ({
      entries: window.__cf.save.recentMatches,
      stored: JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.recentMatches,
      played: window.__cf.save.stats.played
    }));
    assert.deepEqual(afterReset.entries, []);
    assert.deepEqual(afterReset.stored, [], 'confirmed Reset progress clears local match summaries');
    assert.equal(afterReset.played, 0);
    assert.deepEqual(pageErrors, [], 'the browser flow has no uncaught errors');
    assert.deepEqual(supabaseRequests, [], 'the local history flow makes no Supabase requests');
    console.log('offline-match-history.browser.test.js: old-save load, offline completion, reload, reset, and mobile/desktop previews passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
