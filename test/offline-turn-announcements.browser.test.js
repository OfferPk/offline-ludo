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
let checks = 0;

function ok(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log('  ok - ' + message);
}

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
          'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream'
        });
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
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    const localOrigin = new URL(local.url).origin;
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });

    await page.goto(local.url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-pass');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#presets [data-p="4"]');
    await page.evaluate(() => {
      window.__cf.save.settings.auto = false;
      window.__cf.save.settings.sound = false;
    });
    await page.click('#btn-start');
    const confirmVisible = await page.$eval('#confirm', element => !element.classList.contains('hidden')).catch(() => false);
    if (confirmVisible) await page.click('#confirm-yes');
    await page.waitForFunction(() => window.__cf && window.__cf.game && !document.getElementById('game').classList.contains('hidden'));
    await page.waitForFunction(() => document.getElementById('offline-turn-announcement')?.textContent.length > 0);

    const initial = await page.evaluate(() => {
      const region = document.getElementById('offline-turn-announcement');
      const seat = window.__cf.game.st.turn;
      return {
        role: region.getAttribute('role'),
        live: region.getAttribute('aria-live'),
        atomic: region.getAttribute('aria-atomic'),
        width: region.getBoundingClientRect().width,
        height: region.getBoundingClientRect().height,
        name: document.querySelector('.pod[data-seat="' + seat + '"] .pname').textContent.trim(),
        text: region.textContent
      };
    });
    ok(initial.role === 'status' && initial.live === 'polite' && initial.atomic === 'true', 'turn updates use one polite atomic status region');
    ok(initial.width <= 1 && initial.height <= 1, 'the screen-reader status does not change the visible layout');
    ok(initial.text === initial.name + "'s turn. Roll the die.", 'pass-and-play announces the active human and the roll action');

    await page.evaluate(() => {
      window.__cf.edit(st => {
        st.pieces[st.turn][0] = 0;
        st.phase = 'move';
        st.queue = [1];
        st.sixes = 0;
        st.bonus = 0;
        st.rollAgain = false;
      });
    });
    await page.waitForFunction(() => /Choose a token to move\.$/.test(document.getElementById('offline-turn-announcement').textContent));
    const move = await page.evaluate(() => ({
      turn: window.__cf.game.st.turn,
      name: document.querySelector('.pod[data-seat="' + window.__cf.game.st.turn + '"] .pname').textContent.trim(),
      text: document.getElementById('offline-turn-announcement').textContent
    }));
    ok(move.text === move.name + "'s turn. Choose a token to move.", 'the move phase announces the next accessible action');

    await page.evaluate(() => {
      const region = document.getElementById('offline-turn-announcement');
      window.__turnAnnouncementMutations = 0;
      window.__turnAnnouncementObserver = new MutationObserver(records => { window.__turnAnnouncementMutations += records.length; });
      window.__turnAnnouncementObserver.observe(region, { childList: true, characterData: true, subtree: true });
    });
    await page.evaluate(() => window.__cf.edit(() => {}));
    await new Promise(resolve => setTimeout(resolve, 40));
    const redraw = await page.evaluate(() => window.__turnAnnouncementMutations);
    ok(redraw === 0, 'ordinary redraws do not repeat an unchanged announcement');

    const next = await page.evaluate(() => {
      const c = window.__cf;
      const state = c.game.st;
      const index = state.players.indexOf(state.turn);
      const nextSeat = state.players[(index + 1) % state.players.length];
      const nextName = document.querySelector('.pod[data-seat="' + nextSeat + '"] .pname').textContent.trim();
      c.edit(st => {
        st.turn = nextSeat;
        st.phase = 'roll';
        st.queue = [];
        st.moves = [];
        st.sixes = 0;
        st.bonus = 0;
        st.rollAgain = false;
      });
      return { name: nextName };
    });
    await page.waitForFunction(name => document.getElementById('offline-turn-announcement').textContent === name + "'s turn. Roll the die.", {}, next.name);
    ok(true, 'a changed pass-and-play turn announces the newly active player');

    await page.evaluate(() => { window.__turnAnnouncementMutations = 0; });
    await page.click('#btn-home');
    await page.waitForSelector('#menu:not(.hidden)');
    await page.click('#btn-m-resume');
    await page.waitForSelector('#menu.hidden');
    await new Promise(resolve => setTimeout(resolve, 40));
    const resumed = await page.evaluate(() => window.__turnAnnouncementMutations);
    ok(resumed > 0, 'resuming a paused match announces whose turn it is again');
    await page.evaluate(() => window.__turnAnnouncementObserver.disconnect());

    await page.evaluate(() => {
      window.__cf.game.online = true;
      window.__cf.edit(() => {});
    });
    await page.waitForFunction(() => document.getElementById('offline-turn-announcement').textContent === '');
    ok(true, 'the offline announcer clears and stays silent in Online mode');
    ok(pageErrors.length === 0, 'the game produces no browser exceptions: ' + pageErrors.join(' | '));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().then(() => {
  console.log('\n' + checks + ' offline turn-announcement browser checks passed');
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
