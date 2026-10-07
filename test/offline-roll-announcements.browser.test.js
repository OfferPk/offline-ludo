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
  '.svg': 'image/svg+xml'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname.replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          response.writeHead(404).end('Not found');
          return;
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream'
        }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port + '/'
    }));
  });
}

async function main() {
  const local = await startLocalServer();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });

    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-pass');
    await page.click('#mode-seg button[data-mode="classic"]');
    await page.click('#presets button[data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'), { timeout: 15000 });

    const regionInfo = await page.$eval('#offline-roll-announcement', element => ({
      role: element.getAttribute('role'),
      live: element.getAttribute('aria-live'),
      atomic: element.getAttribute('aria-atomic'),
      className: element.className,
      bounds: element.getBoundingClientRect().toJSON()
    }));
    assert.equal(regionInfo.role, 'status');
    assert.equal(regionInfo.live, 'polite');
    assert.equal(regionInfo.atomic, 'true');
    assert.match(regionInfo.className, /\bsr-only\b/);
    assert.ok(regionInfo.bounds.width <= 1 && regionInfo.bounds.height <= 1, 'the announcement is available to assistive technology without changing the visual layout');

    async function setRollState(options) {
      return page.evaluate(options => {
        const controller = window.__cf;
        const seat = controller.game.st.players.find(player => controller.game.seats[player].type === 'human');
        controller.save.settings.auto = false;
        controller.force([options.face]);
        controller.edit(state => {
          state.turn = seat;
          state.phase = 'roll';
          state.queue = options.priorDice || [];
          state.moves = [];
          state.sixes = options.sixes || 0;
          state.bonus = 0;
          state.rollAgain = false;
          state.pending = null;
          state.boost[seat] = null;
          state.pieces[seat] = options.hasMove ? [0, -1, -1, -1] : [-1, -1, -1, -1];
        });
        return seat;
      }, options);
    }

    async function rollAndRead(options, expectation) {
      const seat = await setRollState(options);
      const previous = await page.$eval('#offline-roll-announcement', element => element.textContent);
      await page.waitForFunction(seatNumber => {
        const die = document.querySelector('.pod[data-seat="' + seatNumber + '"] .pdice');
        return die && !die.disabled;
      }, { timeout: 2500 }, seat);
      await page.click('.pod[data-seat="' + seat + '"] .pdice');
      await page.waitForFunction(previousText => document.querySelector('#offline-roll-announcement').textContent !== previousText, { timeout: 5000 }, previous);
      const message = await page.$eval('#offline-roll-announcement', element => element.textContent);
      for (const pattern of expectation) assert.match(message, pattern);
      return message;
    }

    const legalMove = await rollAndRead({ face: 2, hasMove: true }, [/rolled 2/i, /one token can move/i]);
    assert.doesNotMatch(legalMove, /dice available/i, 'a single die value is not repeated unnecessarily');
    await rollAndRead({ face: 3, hasMove: true, priorDice: [6, 6] }, [/rolled 3/i, /dice available: 6, 6, 3/i, /\d+ tokens? can move/i]);
    await rollAndRead({ face: 6, hasMove: true }, [/rolled 6/i, /roll again/i]);
    await rollAndRead({ face: 2, hasMove: false }, [/no token can move/i, /turn passes/i]);
    await rollAndRead({ face: 6, hasMove: false, sixes: 2 }, [/three sixes in a row/i, /forfeited/i]);
    assert.deepEqual(pageErrors, [], 'offline roll announcements produce no uncaught browser errors');
    console.log('Offline roll announcement browser tests passed.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
