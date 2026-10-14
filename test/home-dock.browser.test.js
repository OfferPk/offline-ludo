// Home wallet + pinned progress dock browser coverage.
// Usage: CHROME=/usr/bin/chromium node test/home-dock.browser.test.js
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
let checks = 0;
function ok(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  checks++;
  console.log('  ok -', message);
}
function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const sizes = [[320, 568], [360, 740], [390, 844], [768, 1024], [1280, 800]];
    for (const [width, height] of sizes) {
      await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 640, hasTouch: width < 640 });
      if (page.url() === 'about:blank') await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector('#home:not(.hidden)');
      const layout = await page.evaluate(() => {
        const dock = document.querySelector('.home-dock');
        const stats = document.getElementById('btn-stats');
        const wallet = document.getElementById('btn-coins');
        const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
        const d = r(dock), s = r(stats), w = r(wallet);
        const hit = el => { const b = el.getBoundingClientRect(); const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return at === el || el.contains(at); };
        return {
          fixed: getComputedStyle(dock).position === 'fixed',
          dockVisible: d.width > 0 && d.height > 0 && d.left >= 0 && d.right <= innerWidth && d.bottom <= innerHeight,
          statsVisible: s.width > 0 && s.height > 0 && s.top >= 0 && s.bottom <= innerHeight && hit(stats),
          walletVisible: w.width > 0 && w.height > 0 && w.left >= 0 && w.right <= innerWidth && hit(wallet),
          horizontalFit: document.documentElement.scrollWidth <= innerWidth,
          statsLabel: stats.getAttribute('aria-label'),
          walletLabel: wallet.getAttribute('aria-label')
        };
      });
      ok(layout.fixed && layout.dockVisible && layout.statsVisible, width + '×' + height + ': statistics and level-progress dock stays pinned, visible, and tappable');
      ok(layout.walletVisible && /coins/i.test(layout.walletLabel), width + '×' + height + ': coin wallet is visible, accessible, and tappable');
      ok(layout.horizontalFit, width + '×' + height + ': home wallet and dock fit without horizontal overflow');
    }

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    if (process.env.SHOT) {
      fs.mkdirSync(path.dirname(path.resolve(process.env.SHOT)), { recursive: true });
      await page.screenshot({ path: path.resolve(process.env.SHOT), fullPage: false });
      ok(fs.statSync(path.resolve(process.env.SHOT)).size > 10000, 'final home wallet/dock screenshot was saved');
    }
    await page.evaluate(() => {
      const save = window.__cf.save;
      save.stats.played = 10;
      save.stats.won = 4;
      save.coins = 1234;
      save.xp = 250;
      window.__cf.persist();
    });
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('#home:not(.hidden)');
    const saved = await page.evaluate(() => ({
      matches: document.getElementById('home-matches').textContent,
      wins: document.getElementById('home-wins').textContent,
      rate: document.getElementById('home-win-rate').textContent,
      wallet: document.getElementById('btn-coins').getAttribute('aria-label'),
      coins: Array.from(document.querySelectorAll('.coins-val')).map(el => el.textContent)
    }));
    ok(saved.matches === '10' && saved.wins === '4' && saved.rate === '40%', 'home summary restores saved match/win statistics and calculates win rate');
    ok(saved.coins.length >= 2 && (() => { const v = saved.coins[0]; return saved.coins.every(x => x === v) && saved.wallet.includes(v + ' '); })(), 'wallet and shop balance remain synchronized with the saved coin total');

    await page.click('#btn-stats');
    await page.waitForSelector('#stats:not(.hidden)');
    const detailRate = await page.$eval('#stats-body', el => Array.from(el.querySelectorAll('div')).find(cell => cell.textContent.includes('Win rate'))?.querySelector('b')?.textContent);
    ok(detailRate === '40%', 'bottom statistics button opens full details with the same win rate');
    await page.click('#stats [data-close="stats"]');
    await page.waitForSelector('#stats.hidden');
    await page.click('#btn-coins');
    await page.waitForSelector('#skins:not(.hidden)');
    ok(await page.$eval('#skins .coins-val', el => el.textContent) === saved.coins[0], 'tapping the coin balance opens the cosmetic shop with the current balance');
    ok(errors.length === 0, 'home wallet/dock flow produces no browser errors: ' + errors.join(' | '));
    console.log(checks + ' home wallet and stats dock browser checks passed');
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
