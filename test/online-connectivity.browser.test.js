'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

(async () => {
  const { server, url } = await startLocalServer();
  const origin = new URL(url).origin;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const pages = [];
  try {
    async function openOnlineScreen(viewport) {
      const page = await browser.newPage();
      pages.push(page);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport(viewport);
      await page.setRequestInterception(true);
      page.on('request', request => {
        const requestUrl = new URL(request.url());
        if (requestUrl.origin !== origin) { request.abort().catch(() => {}); return; }
        if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
          request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: '', publishableKey: '', emailPasswordEnabled: false });" }).catch(() => {});
          return;
        }
        request.continue().catch(() => {});
      });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#online-connectivity-status');
      await page.click('#btn-online');
      await page.waitForFunction(() => !document.getElementById('online').classList.contains('hidden'));
      return { page, errors };
    }

    async function assertConnectivityStates(page) {
      await page.setOfflineMode(true);
      await page.waitForFunction(() => {
        const notice = document.getElementById('online-connectivity-status');
        return navigator.onLine === false && notice && notice.dataset.state === 'offline' && !notice.classList.contains('hidden');
      });
      const message = await page.$eval('#online-connectivity-status', node => node.textContent);
      assert.match(message, /online sign-in and rooms/i);
      assert.match(message, /local games and saves remain available/i);
      assert.equal(await page.$eval('#online-connectivity-status', node => node.getAttribute('role')), 'status');

      await page.setOfflineMode(false);
      await page.waitForFunction(() => navigator.onLine === true);
      // Dispatch explicitly after the browser's connectivity flip so this regression test
      // exercises the UI handler deterministically across Chromium versions.
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => {
        const notice = document.getElementById('online-connectivity-status');
        return notice && notice.dataset.state === 'restored' && /network access is back/i.test(notice.textContent);
      });
      return message;
    }

    const mobile = await openOnlineScreen({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await assertConnectivityStates(mobile.page);
    const desktop = await openOnlineScreen({ width: 1440, height: 960 });
    await assertConnectivityStates(desktop.page);

    if (process.argv.includes('--preview')) {
      const previewDir = path.join(__dirname, '..', 'docs', 'previews', 'online-connectivity');
      fs.mkdirSync(previewDir, { recursive: true });
      await mobile.page.setOfflineMode(true);
      await mobile.page.waitForFunction(() => document.getElementById('online-connectivity-status').dataset.state === 'offline');
      await mobile.page.screenshot({ path: path.join(previewDir, 'online-connectivity-mobile.png'), fullPage: false });
      await desktop.page.setOfflineMode(true);
      await desktop.page.waitForFunction(() => document.getElementById('online-connectivity-status').dataset.state === 'offline');
      await desktop.page.screenshot({ path: path.join(previewDir, 'online-connectivity-desktop.png'), fullPage: false });
      console.log('UI previews saved to ' + previewDir);
    }

    for (const result of [mobile, desktop]) assert.deepEqual(result.errors, [], 'the Online screen should render connectivity states without page errors');
    console.log('Online connectivity browser test passed.');
  } finally {
    await Promise.all(pages.map(page => page.close().catch(() => {})));
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
