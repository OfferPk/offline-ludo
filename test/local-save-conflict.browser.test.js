// Same-origin two-tab regression for protecting newer offline saves.
// Usage: CHROME=/usr/bin/chromium node test/local-save-conflict.browser.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
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
  let context;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    context = await browser.createBrowserContext();
    const firstTab = await context.newPage();
    const secondTab = await context.newPage();
    const errors = [];
    for (const page of [firstTab, secondTab]) page.on('pageerror', error => errors.push(error.message));

    await firstTab.goto(local.url, { waitUntil: 'networkidle0' });
    await firstTab.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await firstTab.reload({ waitUntil: 'networkidle0' });
    await firstTab.waitForSelector('#home:not(.hidden)');
    await firstTab.waitForFunction(() => !!window.__cf && !!window.__cf.persist);

    await secondTab.goto(local.url, { waitUntil: 'networkidle0' });
    await secondTab.waitForSelector('#home:not(.hidden)');
    await secondTab.waitForFunction(() => !!window.__cf && !!window.__cf.persist);
    await secondTab.evaluate(() => {
      window.__cf.save.xp = 9876;
      if (!window.__cf.persist()) throw new Error('the current tab unexpectedly failed to save');
    });

    await firstTab.waitForFunction(() => {
      const warning = document.getElementById('save-warning');
      return warning && !warning.classList.contains('hidden') && /another tab saved newer progress/i.test(warning.textContent);
    });
    const outcome = await firstTab.evaluate(() => {
      window.__cf.save.xp = 12345;
      const saved = window.__cf.persist();
      const primary = JSON.parse(localStorage.getItem('crossfour.save.v3'));
      return {
        saved,
        storedXp: primary.payload.xp,
        warning: document.getElementById('save-warning').textContent,
        memoryXp: window.__cf.save.xp
      };
    });
    assert.equal(outcome.saved, false, 'the stale tab refuses a further save');
    assert.equal(outcome.storedXp, 9876, 'the newer tab snapshot remains the persisted value');
    assert.equal(outcome.memoryXp, 12345, 'the stale tab does not silently roll back its in-memory state');
    assert.match(outcome.warning, /reload this tab before continuing/i, 'the stale tab explains how to recover');
    assert.deepEqual(errors, [], 'both tabs run without uncaught browser errors');
    console.log('Two-tab local-save conflict browser regression passed.');
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
