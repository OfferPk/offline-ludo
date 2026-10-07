'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

(async () => {
  const local = await startLocalServer();
  let browser = null;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://mock-project.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
        return;
      }
      if (url.origin === new URL(local.url).origin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });

    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(local.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#btn-howto-home', { visible: true, timeout: 15000 });
    await page.evaluate(() => {
      window.__howtoScrollCalls = [];
      const card = document.getElementById('howto-card');
      card.getBoundingClientRect = () => ({ bottom: window.innerHeight + 100 });
      card.scrollIntoView = options => window.__howtoScrollCalls.push(options);
    });

    await page.click('#btn-howto-home');
    let reduced = await page.evaluate(() => ({
      preference: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      expanded: document.getElementById('btn-howto-home').getAttribute('aria-expanded'),
      open: !document.getElementById('howto-panel').classList.contains('hidden'),
      call: window.__howtoScrollCalls[0]
    }));
    assert.equal(reduced.preference, true, 'the browser is emulating reduced motion');
    assert.equal(reduced.expanded, 'true', 'opening the guide updates its expanded state');
    assert.equal(reduced.open, true, 'opening the guide reveals its content');
    assert.deepEqual(reduced.call, { block: 'nearest', behavior: 'auto' }, 'the guide avoids smooth scrolling for reduced-motion users');

    await page.click('#btn-howto-home');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.click('#btn-howto-home');
    const normal = await page.evaluate(() => ({
      preference: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      expanded: document.getElementById('btn-howto-home').getAttribute('aria-expanded'),
      call: window.__howtoScrollCalls[1]
    }));
    assert.equal(normal.preference, false, 'the browser is emulating the normal motion preference');
    assert.equal(normal.expanded, 'true', 'the guide reopens after the first test case');
    assert.deepEqual(normal.call, { block: 'nearest', behavior: 'smooth' }, 'users without a reduced-motion preference keep the existing smooth scroll');
    assert.deepEqual(errors, [], 'the How to Play accessibility interaction has no browser errors');
    assert.deepEqual(externalRequests, [], 'the test stays fully local and makes no external requests');

    console.log('How to Play reduced-motion browser test passed: reduce uses auto scroll; no-preference remains smooth.');
  } finally {
    if (browser) await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
