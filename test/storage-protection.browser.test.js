'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'storage-protection');
const mime = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
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

async function newScenario(browser, url, config) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  const origin = new URL(url).origin;
  page.on('request', request => {
    if (new URL(request.url()).origin === origin) request.continue().catch(() => {});
    else { remoteRequests.push(request.url()); request.abort().catch(() => {}); }
  });
  await page.evaluateOnNewDocument(config => {
    if (config.unsupported) {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
      return;
    }
    const state = { persisted: !!config.initial, persistCalls: 0, persistedReads: 0 };
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: function () { state.persistedReads += 1; return Promise.resolve(state.persisted); },
        persist: function () {
          state.persistCalls += 1;
          if (config.failure === 'reject') return Promise.reject(new Error('mock request failure'));
          if (config.failure === 'throw') throw new Error('mock synchronous failure');
          if (config.result) state.persisted = true;
          return Promise.resolve(!!config.result);
        }
      }
    });
    window.__storageMock = state;
  }, config);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#home:not(.hidden)', { timeout: 15000 });
  await page.click('#btn-settings');
  await page.waitForFunction(() => {
    const status = document.getElementById('storage-protection-status');
    return status && status.textContent !== 'Checking browser storage…';
  }, { timeout: 8000 });
  return { page, errors, remoteRequests };
}

(async () => {
  const local = await startLocalServer();
  let browser;
  const scenarios = [];
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const granted = await newScenario(browser, local.url, { initial: false, result: true });
    scenarios.push(granted);
    const beforeGrantedSave = await granted.page.evaluate(() => localStorage.getItem('crossfour.save.v3'));
    assert.equal(await granted.page.$eval('#btn-storage-protection', button => button.disabled), false,
      'an unprotected site offers an explicit protection action');
    assert.match(await granted.page.$eval('#storage-protection-status', node => node.textContent), /browser cleanup may remove them/i,
      'the initial state explains the local-storage eviction risk');
    await fs.promises.mkdir(previewDir, { recursive: true });
    await granted.page.screenshot({ path: path.join(previewDir, 'mobile.png'), fullPage: false });
    const requestsBeforeClick = granted.remoteRequests.length;
    await granted.page.click('#btn-storage-protection');
    await granted.page.waitForFunction(() => document.getElementById('storage-protection-status').textContent.includes('protects local game data'), { timeout: 5000 });
    assert.equal(await granted.page.$eval('#btn-storage-protection', button => button.disabled), true,
      'a granted request changes the action into a disabled protected state');
    assert.equal(await granted.page.evaluate(() => window.__storageMock.persistCalls), 1,
      'the browser request occurs only after the explicit click');
    assert.equal(await granted.page.evaluate(() => localStorage.getItem('crossfour.save.v3')), beforeGrantedSave,
      'requesting browser protection does not read or change the local game save');
    assert.equal(granted.remoteRequests.length, requestsBeforeClick,
      'the protection action makes no network request');

    const denied = await newScenario(browser, local.url, { initial: false, result: false });
    scenarios.push(denied);
    const beforeDeniedSave = await denied.page.evaluate(() => localStorage.getItem('crossfour.save.v3'));
    await denied.page.click('#btn-storage-protection');
    await denied.page.waitForFunction(() => document.getElementById('storage-protection-status').textContent.includes('Protection was not granted'), { timeout: 5000 });
    assert.equal(await denied.page.$eval('#btn-storage-protection', button => button.disabled), false,
      'a denied request leaves the retry action available');
    assert.match(await denied.page.$eval('#storage-protection-status', node => node.textContent), /remain local/i,
      'denial clearly preserves the local-only boundary');
    assert.equal(await denied.page.evaluate(() => localStorage.getItem('crossfour.save.v3')), beforeDeniedSave,
      'a denied request does not disturb local progress');

    const alreadyProtected = await newScenario(browser, local.url, { initial: true, result: false });
    scenarios.push(alreadyProtected);
    assert.equal(await alreadyProtected.page.$eval('#btn-storage-protection', button => button.disabled), true,
      'already-persisted storage is shown as protected without another request');
    assert.equal(await alreadyProtected.page.$eval('#btn-storage-protection', button => button.textContent), 'Protected');
    assert.equal(await alreadyProtected.page.evaluate(() => window.__storageMock.persistCalls), 0,
      'the browser is not prompted again when storage is already protected');

    const unsupported = await newScenario(browser, local.url, { unsupported: true });
    scenarios.push(unsupported);
    assert.equal(await unsupported.page.$eval('#btn-storage-protection', button => button.hidden), true,
      'unsupported browsers do not show a nonfunctional action');
    assert.match(await unsupported.page.$eval('#storage-protection-status', node => node.textContent), /cannot protect storage/i,
      'unsupported browsers receive an accurate fallback explanation');

    for (const failure of ['reject', 'throw']) {
      const failed = await newScenario(browser, local.url, { initial: false, failure });
      scenarios.push(failed);
      await failed.page.click('#btn-storage-protection');
      await failed.page.waitForFunction(() => document.getElementById('storage-protection-status').textContent.includes('could not enable protection'), { timeout: 5000 });
      assert.equal(await failed.page.$eval('#btn-storage-protection', button => button.disabled), false,
        'failed requests restore a usable retry action (' + failure + ')');
    }

    for (const scenario of scenarios) {
      assert.deepEqual(scenario.errors, [], 'scenario has no uncaught browser errors');
    }
    console.log('Storage-protection browser regression passed: opt-in grant, denial, existing grant, unsupported API, synchronous/asynchronous failures, local-save preservation, and no request on click.');
  } finally {
    for (const scenario of scenarios) await scenario.page.close().catch(() => {});
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
