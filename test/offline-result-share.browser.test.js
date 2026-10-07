'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const previewDir = process.env.PREVIEW_DIR || path.join(root, 'docs', 'previews', 'offline-result-share');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch (_) { response.writeHead(400).end('Bad request'); return; }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(webRoot, relative);
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end('Forbidden'); return; }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pageErrors = [];
  const externalRequests = [];
  let page;
  let desktopContext;
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      let origin = '';
      try { origin = new URL(request.url()).origin; } catch (_) {}
      if (origin === localOrigin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });

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
    await page.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'));
    await page.evaluate(() => {
      window.__cf.edit(state => {
        state.phase = 'over';
        state.turn = state.players[0];
        state.ranking = state.players.slice();
        state.queue = [];
        state.moves = [];
        state.pieces.forEach(pieces => { if (Array.isArray(pieces)) pieces.fill(57); });
      });
    });
    await page.waitForFunction(() => {
      const result = document.querySelector('#result');
      const control = document.querySelector('#offline-result-share');
      return result && !result.classList.contains('hidden') && control && !control.classList.contains('hidden');
    }, { timeout: 10000 });

    const initial = await page.evaluate(() => ({
      buttonLabel: document.querySelector('#btn-r-share').getAttribute('aria-label'),
      buttonHeight: document.querySelector('#btn-r-share').getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
      names: [...document.querySelectorAll('#r-rank > li')].map(row => row.querySelector('.pdot').nextSibling.nodeValue.trim()),
      mode: document.querySelector('#r-kicker').textContent,
      summaryBeforeClick: document.querySelector('#offline-result-share-status').textContent
    }));
    assert.equal(initial.buttonLabel, 'Share the completed offline match result');
    assert.ok(initial.buttonHeight >= 44, 'sharing control meets a comfortable mobile touch target');
    assert.equal(initial.overflow, false, 'the result dialog fits a narrow mobile viewport');
    assert.deepEqual(initial.summaryBeforeClick, '', 'no result is shared or copied automatically');
    await page.waitForFunction(() => document.querySelector('#toast').classList.contains('hidden'), { timeout: 6000 });
    await page.screenshot({ path: path.join(previewDir, 'offline-result-share-mobile.png'), fullPage: true });

    desktopContext = await browser.createBrowserContext();
    const desktopPage = await desktopContext.newPage();
    await desktopPage.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1, isMobile: false });
    await desktopPage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    desktopPage.on('pageerror', error => pageErrors.push(error.message));
    await desktopPage.setRequestInterception(true);
    desktopPage.on('request', request => {
      let origin = '';
      try { origin = new URL(request.url()).origin; } catch (_) {}
      if (origin === localOrigin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });
    await desktopPage.goto(local.url, { waitUntil: 'networkidle0' });
    await desktopPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await desktopPage.reload({ waitUntil: 'networkidle0' });
    await desktopPage.waitForSelector('#home:not(.hidden)');
    await desktopPage.click('#btn-vs-ai');
    await desktopPage.waitForSelector('#setup:not(.hidden)');
    await desktopPage.click('#btn-start');
    await desktopPage.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'));
    await desktopPage.evaluate(() => {
      window.__cf.edit(state => {
        state.phase = 'over';
        state.turn = state.players[0];
        state.ranking = state.players.slice();
        state.queue = [];
        state.moves = [];
        state.pieces.forEach(pieces => { if (Array.isArray(pieces)) pieces.fill(57); });
      });
    });
    await desktopPage.waitForFunction(() => {
      const result = document.querySelector('#result');
      const control = document.querySelector('#offline-result-share');
      return result && !result.classList.contains('hidden') && control && !control.classList.contains('hidden');
    }, { timeout: 10000 });
    await desktopPage.waitForFunction(() => document.querySelector('#toast').classList.contains('hidden'), { timeout: 6000 });
    await desktopPage.screenshot({ path: path.join(previewDir, 'offline-result-share-desktop.png'), fullPage: true });
    await desktopContext.close();
    desktopContext = null;

    await page.evaluate(() => {
      window.__offlineResultShareTest = { shares: [], copies: [], active: false };
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async payload => {
          window.__offlineResultShareTest.shares.push(payload);
          window.__offlineResultShareTest.active = !!(navigator.userActivation && navigator.userActivation.isActive);
        }
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__offlineResultShareTest.copies.push(text); } }
      });
    });
    const before = await page.evaluate(() => JSON.stringify({ save: window.__cf.save, state: window.__cf.game.st }));
    const requestsBeforeShare = externalRequests.length;
    await page.click('#btn-r-share');
    await page.waitForFunction(() => document.querySelector('#offline-result-share-status').textContent === 'Result shared.');
    await page.waitForFunction(() => !document.querySelector('#btn-r-share').disabled);
    const native = await page.evaluate(() => ({
      payload: window.__offlineResultShareTest.shares[0],
      active: window.__offlineResultShareTest.active,
      copies: window.__offlineResultShareTest.copies.slice(),
      summary: document.querySelector('#offline-result-share-status').textContent
    }));
    assert.equal(native.payload.title, 'Offline Ludo result');
    assert.equal(native.payload.text, [
      'Offline Ludo — final result',
      'Mode: Classic Ludo',
      '1st — ' + initial.names[0] + ' (Normal computer)',
      '2nd — ' + initial.names[1]
    ].join('\n'));
    assert.equal(native.active, true, 'native sharing keeps the tap user-activation');
    assert.deepEqual(native.copies, [], 'successful native sharing does not also copy');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => { throw new DOMException('Dismissed', 'AbortError'); }
      });
    });
    const copiesBeforeCancel = native.copies.length;
    await page.click('#btn-r-share');
    await page.waitForFunction(() => document.querySelector('#offline-result-share-status').textContent === 'Share cancelled.');
    await page.waitForFunction(() => !document.querySelector('#btn-r-share').disabled);
    assert.equal((await page.evaluate(() => window.__offlineResultShareTest.copies.length)), copiesBeforeCancel, 'cancelling the share sheet never copies unexpectedly');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => { throw new Error('Share unavailable'); }
      });
    });
    await page.click('#btn-r-share');
    await page.waitForFunction(() => document.querySelector('#offline-result-share-status').textContent === 'Result copied to clipboard.');
    await page.waitForFunction(() => !document.querySelector('#btn-r-share').disabled);
    const clipboard = await page.evaluate(() => window.__offlineResultShareTest.copies.at(-1));
    assert.equal(clipboard, native.payload.text, 'a failed share sheet falls back to the clipboard');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('Clipboard unavailable'); } }
      });
    });
    await page.click('#btn-r-share');
    await page.waitForFunction(() => {
      const field = document.querySelector('#offline-result-share-text');
      return field && !field.classList.contains('hidden') && field.value.length > 0;
    });
    const manual = await page.evaluate(() => {
      const field = document.querySelector('#offline-result-share-text');
      return {
        value: field.value,
        selected: document.activeElement === field && field.selectionStart === 0 && field.selectionEnd === field.value.length,
        status: document.querySelector('#offline-result-share-status').textContent
      };
    });
    assert.equal(manual.value, native.payload.text);
    assert.equal(manual.selected, true, 'when sharing and clipboard are unavailable, the full summary is selected for manual copying');
    assert.match(manual.status, /select and copy/i);

    const after = await page.evaluate(() => JSON.stringify({ save: window.__cf.save, state: window.__cf.game.st }));
    assert.equal(after, before, 'sharing and its fallbacks do not mutate the local save or match state');
    assert.equal(externalRequests.length, requestsBeforeShare, 'sharing makes no external network request');
    assert.deepEqual(pageErrors, [], 'the offline result-sharing UI produces no uncaught browser errors');
    console.log('Offline result sharing browser tests passed. Previews: ' + previewDir);
  } finally {
    if (page) await page.close().catch(() => {});
    if (desktopContext) await desktopContext.close().catch(() => {});
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
