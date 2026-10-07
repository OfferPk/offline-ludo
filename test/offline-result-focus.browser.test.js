'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function startLocalServer() {
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
    catch (error) { response.writeHead(400).end('Bad request'); return; }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(webRoot, '.' + pathname);
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream'
      });
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
  const externalRequests = [];
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });

    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    await page.click('#btn-pass');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#presets button[data-p="1v1"]');
    await page.click('#btn-start');
    const confirmVisible = await page.$eval('#confirm', element => !element.classList.contains('hidden')).catch(() => false);
    if (confirmVisible) await page.click('#confirm-yes');
    await page.waitForFunction(() => window.__cf && window.__cf.game &&
      !document.getElementById('game').classList.contains('hidden'));

    await page.evaluate(() => {
      const c = window.__cf;
      const winner = c.game.st.players[0];
      c.game.coins = 0;
      c.edit(state => {
        state.phase = 'over';
        state.ranking = [winner].concat(state.players.filter(seat => seat !== winner));
        state.queue = [];
        state.moves = [];
        state.pending = null;
      });
    });
    await page.waitForSelector('#result:not(.hidden)');

    const semantics = await page.evaluate(() => {
      const dialog = document.getElementById('result');
      const title = document.getElementById('r-title');
      return {
        role: dialog.getAttribute('role'),
        modal: dialog.getAttribute('aria-modal'),
        labelledBy: dialog.getAttribute('aria-labelledby'),
        describedBy: dialog.getAttribute('aria-describedby'),
        titleTabIndex: title.getAttribute('tabindex'),
        focusId: document.activeElement && document.activeElement.id
      };
    });
    assert.deepEqual(semantics, {
      role: 'dialog', modal: 'true', labelledBy: 'r-title', describedBy: 'r-meta',
      titleTabIndex: '-1', focusId: 'r-title'
    }, 'the result is a named modal dialog and receives focus on its heading');

    const focusables = await page.$$eval('#result button:not([disabled]):not(.hidden)', buttons => buttons.map(button => button.id));
    assert.ok(focusables.length >= 2, 'the result dialog has multiple available actions');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.id), focusables[focusables.length - 1],
      'Shift+Tab from the focused result heading remains inside the dialog');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), focusables[0], 'Tab wraps from the last action to the first');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.id), focusables[focusables.length - 1], 'Shift+Tab wraps from the first action to the last');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), focusables[0], 'Tab wraps back to the first action');

    const rollingBefore = await page.evaluate(() => window.__cf.game.st.moveCount);
    await page.keyboard.press('Space');
    await page.keyboard.press('1');
    assert.equal(await page.evaluate(() => window.__cf.game.st.moveCount), rollingBefore,
      'game keyboard shortcuts do not leak through the modal result screen');

    await page.click('#btn-r-home');
    await page.waitForFunction(() => !document.getElementById('home').classList.contains('hidden') &&
      document.activeElement === document.getElementById('btn-vs-ai'));
    assert.deepEqual(pageErrors, [], 'the result flow completes without browser errors');
    assert.deepEqual(externalRequests, [], 'the result focus flow makes no external requests');
    console.log('offline-result-focus.browser.test.js: dialog semantics, focus containment, shortcut isolation, and Home focus passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
