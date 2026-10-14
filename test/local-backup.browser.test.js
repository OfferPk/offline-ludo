'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(String(error && error.message || error)));
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    await page.evaluate(() => {
      window.__cf.save.coins = 321;
      window.__cf.save.xp = 654;
      window.__cf.save.stats.played = 12;
      window.__cf.persist();
      window.__offlineExportCapture = {};
      URL.createObjectURL = blob => { window.__offlineExportCapture.blob = blob; return 'blob:offline-save-test'; };
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function () {
        window.__offlineExportCapture.filename = this.download;
        window.__offlineExportCapture.href = this.href;
        window.__offlineExportCapture.clicked = true;
      };
    });
    await page.click('#btn-settings');
    await page.waitForSelector('#settings:not(.hidden)');
    assert.match(await page.$eval('#local-backup-title', element => element.textContent), /Offline save/);
    await page.click('#btn-export-backup');
    await page.waitForFunction(() => window.__offlineExportCapture.clicked && window.__offlineExportCapture.blob);
    const exported = await page.evaluate(async () => ({
      filename: window.__offlineExportCapture.filename,
      href: window.__offlineExportCapture.href,
      data: JSON.parse(await window.__offlineExportCapture.blob.text()),
      status: document.querySelector('#local-backup-status').textContent,
      coinsAfter: window.__cf.save.coins,
      xpAfter: window.__cf.save.xp
    }));

    assert.match(exported.filename, /^crossfour-offline-save-\d{4}-\d{2}-\d{2}\.json$/);
    assert.strictEqual(exported.href, 'blob:offline-save-test');
    assert.strictEqual(exported.data.schemaVersion, 3);
    assert.ok(Number.isFinite(exported.data.savedAt));
    assert.strictEqual(exported.data.payload.coins, 321);
    assert.strictEqual(exported.data.payload.xp, 654);
    assert.strictEqual(exported.data.payload.stats.played, 12);
    assert.strictEqual(exported.data.payload.game, null);
    assert.strictEqual(exported.coinsAfter, 321);
    assert.strictEqual(exported.xpAfter, 654);
    assert.match(exported.status, /exported/);
    assert.deepStrictEqual(errors, [], 'export should not produce browser errors');
    console.log('  ok - Settings exports a versioned offline snapshot as JSON');
    console.log('  ok - export includes profile/progression and leaves live save unchanged');
    console.log('\n2 local backup browser checks passed');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
