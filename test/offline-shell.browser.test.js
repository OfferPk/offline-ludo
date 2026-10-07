'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const basePath = '/offline-ludo/';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  let fixtureVersion = 'first';
  const requests = [];
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      requests.push(pathname);
      if (!pathname.startsWith(basePath)) {
        response.writeHead(404).end('Not found');
        return;
      }
      const relative = pathname.slice(basePath.length) || 'index.html';
      if (relative === 'sw-fixture.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('window.__offlineShellFixture = ' + JSON.stringify(fixtureVersion) + ';');
        return;
      }
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, {
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const url = 'http://localhost:' + server.address().port + basePath;
      resolve({ server, url, requests, setFixtureVersion(value) { fixtureVersion = value; } });
    });
  });
}

(async () => {
  const local = await startLocalServer();
  let browser = null;
  let page = null;
  const pageErrors = [];
  const externalRequests = [];
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else {
        externalRequests.push(request.url());
        request.abort().catch(() => {});
      }
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => 'serviceWorker' in navigator && navigator.serviceWorker.controller, { timeout: 15000 });

    const cacheState = await page.evaluate(async () => {
      const names = await caches.keys();
      const name = names.find(item => item.startsWith('crossfour-shell-'));
      if (!name) return { name: null, assets: [] };
      const cache = await caches.open(name);
      const paths = [
        'index.html', 'privacy.html', 'css/style.css', 'css/ludo-chess-discovery.css',
        'js/logic.js', 'js/game.js', 'js/save-store.js', 'js/online.js', 'icon.png'
      ];
      const assets = await Promise.all(paths.map(async asset => [asset,
        !!await cache.match(new URL(asset + '?v=1.7.2', location.href).href, { ignoreSearch: true })]));
      return { name, assets };
    });
    assert.equal(cacheState.name, 'crossfour-shell-v1', 'the offline shell cache is installed');
    assert.deepEqual(cacheState.assets.filter(([, found]) => !found).map(([name]) => name), [],
      'the document, local game engine, app scripts, styles, and icon are pre-cached');

    await page.addScriptTag({ url: local.url + 'sw-fixture.js?refresh=first' });
    assert.equal(await page.evaluate(() => window.__offlineShellFixture), 'first', 'same-origin scripts load through the active worker');
    local.setFixtureVersion('updated');
    await page.addScriptTag({ url: local.url + 'sw-fixture.js?refresh=updated' });
    assert.equal(await page.evaluate(() => window.__offlineShellFixture), 'updated', 'online requests refresh cached assets');

    await page.setOfflineMode(true);
    await page.addScriptTag({ url: local.url + 'sw-fixture.js?offline=1' });
    assert.equal(await page.evaluate(() => window.__offlineShellFixture), 'updated',
      'offline asset requests receive the most recently cached response');
    await page.goto(local.url + '?offline-launch=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#btn-vs-ai', { visible: true, timeout: 10000 });
    assert.equal(await page.evaluate(() => !!window.LudoLogic), true, 'the local Ludo rules engine loads offline');
    assert.deepEqual(pageErrors, [], 'offline loading produces no uncaught browser errors');
    assert.deepEqual(externalRequests, [], 'the regression uses only local resources');

    await page.click('#btn-vs-ai');
    await page.waitForFunction(() => !document.querySelector('#setup').classList.contains('hidden'));
    await page.click('#btn-start');
    await page.waitForFunction(() => !document.querySelector('#game').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => !!document.querySelector('#board')), true,
      'a new local match can be started after opening the site offline');

    console.log('Offline web-shell browser regression passed: scope-relative assets cache, update online, reload offline, and start a local match.');
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
