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
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname); }
      catch (error) { response.writeHead(400).end('Bad request'); return; }
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
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

function maxMilliseconds(value) {
  return Math.max(...value.split(',').map(part => {
    const duration = parseFloat(part.trim());
    return part.trim().endsWith('ms') ? duration : duration * 1000;
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
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#btn-vs-ai', { visible: true, timeout: 15000 });

    const normal = await page.evaluate(() => {
      const modeCard = document.querySelector('.mode-card');
      const turnBanner = document.getElementById('turn-banner');
      turnBanner.classList.add('turn-swap');
      const camel = document.createElement('div');
      camel.innerHTML = '<svg class="cc-camel-svg"><g class="cc-leg"></g></svg>';
      document.body.appendChild(camel);
      const leg = camel.querySelector('.cc-leg');
      const transition = getComputedStyle(modeCard);
      const turn = getComputedStyle(turnBanner);
      const loop = getComputedStyle(leg);
      return {
        transitionDuration: transition.transitionDuration,
        turnDuration: turn.animationDuration,
        turnIterations: turn.animationIterationCount,
        loopDuration: loop.animationDuration,
        loopIterations: loop.animationIterationCount
      };
    });
    assert.ok(maxMilliseconds(normal.transitionDuration) > 0.01, 'normal motion keeps the mode-card transition');
    assert.ok(maxMilliseconds(normal.turnDuration) > 100, 'normal motion keeps the turn-change animation');
    assert.equal(normal.loopIterations, 'infinite', 'normal motion keeps the decorative loop');

    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const reduced = await page.evaluate(() => {
      const modeCard = document.querySelector('.mode-card');
      const turnBanner = document.getElementById('turn-banner');
      const leg = document.querySelector('.cc-camel-svg .cc-leg');
      return {
        preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
        transitionDuration: getComputedStyle(modeCard).transitionDuration,
        transitionDelay: getComputedStyle(modeCard).transitionDelay,
        turnDuration: getComputedStyle(turnBanner).animationDuration,
        turnDelay: getComputedStyle(turnBanner).animationDelay,
        turnIterations: getComputedStyle(turnBanner).animationIterationCount,
        loopDuration: getComputedStyle(leg).animationDuration,
        loopIterations: getComputedStyle(leg).animationIterationCount,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
      };
    });
    assert.equal(reduced.preference, true, 'the browser emulates the reduced-motion preference');
    assert.ok(maxMilliseconds(reduced.transitionDuration) <= 0.01, 'interface transitions are shortened to a negligible duration');
    assert.equal(maxMilliseconds(reduced.transitionDelay), 0, 'interface transition delays are removed');
    assert.ok(maxMilliseconds(reduced.turnDuration) <= 0.01, 'board and turn animations are shortened');
    assert.equal(maxMilliseconds(reduced.turnDelay), 0, 'turn-animation delays are removed');
    assert.equal(reduced.turnIterations, '1', 'turn animations do not repeat');
    assert.ok(maxMilliseconds(reduced.loopDuration) <= 0.01, 'decorative animation loops are shortened');
    assert.equal(reduced.loopIterations, '1', 'infinite decorative animations are limited to one iteration');
    assert.equal(reduced.scrollBehavior, 'auto', 'scrolling remains immediate for reduced-motion users');

    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)', { visible: true, timeout: 5000 });
    await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden) #board', { visible: true, timeout: 10000 });
    assert.equal(await page.evaluate(() => !!window.__cf.game), true, 'a local match remains playable with reduced motion enabled');
    assert.deepEqual(pageErrors, [], 'the game produces no browser runtime errors');
    assert.deepEqual(externalRequests, [], 'the regression remains local and reaches no external service');

    console.log('Reduced-motion browser test passed: UI, turn and loop animations are reduced; local play still works.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
