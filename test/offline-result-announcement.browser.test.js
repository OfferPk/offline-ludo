// Screen-reader announcement coverage for completed local matches.
// Usage: CHROME=/usr/bin/chromium node test/offline-result-announcement.browser.test.js
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
let checks = 0;

function ok(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log('  ok - ' + message);
}

function startLocalServer() {
  return new Promise(resolve => {
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
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    const initial = await page.$eval('#result-announcement', node => ({
      role: node.getAttribute('role'),
      live: node.getAttribute('aria-live'),
      atomic: node.getAttribute('aria-atomic'),
      text: node.textContent,
      className: node.className,
      display: getComputedStyle(node).display,
      visibility: getComputedStyle(node).visibility,
      ariaHidden: node.getAttribute('aria-hidden'),
      availableBeforeOpening: !node.closest('.hidden')
    }));
    ok(initial.role === 'status' && initial.live === 'polite' && initial.atomic === 'true',
      'a persistent, polite atomic status region is ready before play');
    ok(initial.text === '' && initial.className.split(/\s+/).includes('visually-hidden') &&
      initial.display !== 'none' && initial.visibility === 'visible' && initial.ariaHidden === null &&
      initial.availableBeforeOpening,
      'the empty live region is visually hidden and exposed before the result overlay opens');

    await page.click('#btn-pass');
    await page.click('#presets button[data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf && window.__cf.game &&
      !document.getElementById('game').classList.contains('hidden'));
    await page.evaluate(() => {
      const c = window.__cf;
      const winner = c.game.st.players[0];
      c.edit(st => {
        st.phase = 'over';
        st.ranking = [winner].concat(st.players.filter(seat => seat !== winner));
        st.queue = [];
        st.moves = [];
        st.pending = null;
      });
    });
    await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'));
    const expected = await page.$eval('#r-title', title => 'Match over. ' + title.textContent);
    await page.waitForFunction(text => document.getElementById('result-announcement').textContent === text,
      {}, expected);
    const result = await page.evaluate(() => ({
      message: document.getElementById('result-announcement').textContent,
      title: document.getElementById('r-title').textContent,
      visible: !document.getElementById('result').classList.contains('hidden'),
      phase: window.__cf.game.st.phase
    }));
    ok(result.visible && result.phase === 'over' && result.message === 'Match over. ' + result.title,
      'the completed offline match announces the displayed winner or placement');

    await page.click('#btn-r-home');
    await page.waitForSelector('#home:not(.hidden)');
    await page.waitForFunction(() => document.getElementById('result-announcement').textContent === '');
    ok(true, 'leaving the result clears the live region so an identical later result can be announced again');
    ok(errors.length === 0, 'the local game completes without browser page errors: ' + (errors.join('; ') || 'none'));
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
  console.log('\n' + checks + ' offline result-announcement browser checks passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
