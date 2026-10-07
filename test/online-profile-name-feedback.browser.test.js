'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const root = path.resolve(__dirname, '..');
const webRoot = path.join(root, 'www');
const previewDir = path.join(root, 'docs', 'previews', 'online-profile-name-feedback');
const indexHtml = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
const accountCardMatch = indexHtml.match(/<section id="online-account-panel"[\s\S]*?<\/section>/);
if (!accountCardMatch) throw new Error('Could not find the production Online account card markup.');

const previewHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/css/style.css">
  <title>Online profile name feedback preview</title>
</head>
<body>
  <main class="online-screen" style="max-width:560px;margin:32px auto;padding:0 16px">
    ${accountCardMatch[0]}
  </main>
  <script src="/js/online-profile-name-feedback.js"></script>
</body>
</html>`;

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(previewHtml);
        return;
      }
      const file = path.resolve(webRoot, pathname.replace(/^\/+/, ''));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        const contentType = pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
        response.writeHead(200, { 'Content-Type': contentType }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function openPreviewPage(browser, url, viewport, pageErrors) {
  const page = await browser.newPage();
  const origin = new URL(url).origin;
  await page.setViewport(viewport);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).origin === origin) request.continue().catch(() => {});
    else request.abort().catch(() => {});
  });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.$eval('#online-account-panel', element => element.classList.remove('hidden'));
  await page.evaluate(() => window.OnlineProfileNameFeedback.setValue('Amina'));
  await page.$eval('#online-profile-handle', element => { element.textContent = '@amina'; });
  return page;
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const pageErrors = [];
  try {
    const page = await openPreviewPage(browser, local.url, { width: 390, height: 844, isMobile: true, hasTouch: true }, pageErrors);
    const initial = await page.evaluate(() => ({
      text: document.getElementById('online-profile-name-feedback').textContent,
      role: document.getElementById('online-profile-name-feedback').getAttribute('role'),
      live: document.getElementById('online-profile-name-feedback').getAttribute('aria-live'),
      atomic: document.getElementById('online-profile-name-feedback').getAttribute('aria-atomic'),
      describedBy: document.getElementById('online-profile-name').getAttribute('aria-describedby'),
      maxLength: document.getElementById('online-profile-name').maxLength
    }));
    assert.equal(initial.text, '5 of 32 characters.', 'the preview reflects its loaded profile value');
    assert.equal(initial.role, 'status');
    assert.equal(initial.live, 'polite');
    assert.equal(initial.atomic, 'true');
    assert.deepEqual(initial.describedBy.split(/\s+/), ['online-profile-name-guidance', 'online-profile-name-feedback']);
    assert.equal(initial.maxLength, 32, 'the existing input limit remains intact');

    await page.$eval('#online-profile-name', input => {
      input.value = ' \t ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.$eval('#online-profile-name-feedback', element => element.textContent), '0 of 32 characters. Enter a name after trimming.', 'whitespace-only entries are reported as blank');
    assert.equal(await page.$eval('#online-profile-name-feedback', element => element.getAttribute('data-valid')), 'false');

    await page.evaluate(() => window.OnlineProfileNameFeedback.setValue('  Amina  '));
    assert.equal(await page.$eval('#online-profile-name-feedback', element => element.textContent), '5 of 32 characters.', 'trimmed count ignores outer whitespace');
    assert.equal(await page.$eval('#online-profile-name-feedback', element => element.getAttribute('data-valid')), 'true');
    await page.evaluate(() => window.OnlineProfileNameFeedback.setValue('A'.repeat(32)));
    assert.equal(await page.$eval('#online-profile-name-feedback', element => element.textContent), '32 of 32 characters.', 'the full allowed length is reflected');
    await page.evaluate(() => window.OnlineProfileNameFeedback.setValue('Amina'));

    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(mobileOverflow, true, 'the account card fits a narrow mobile viewport');
    fs.mkdirSync(previewDir, { recursive: true });
    await page.$eval('#online-account-panel', element => element.scrollIntoView({ block: 'center' }));
    await page.$eval('#online-account-panel', element => element.setAttribute('data-preview-scope', 'profile-feedback'));
    const mobileCard = await page.$('[data-preview-scope="profile-feedback"]');
    const mobilePreview = path.join(previewDir, 'online-profile-name-feedback-mobile.png');
    await mobileCard.screenshot({ path: mobilePreview });

    const desktopPage = await openPreviewPage(browser, local.url, { width: 1440, height: 960, isMobile: false, deviceScaleFactor: 1 }, pageErrors);
    const desktopOverflow = await desktopPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(desktopOverflow, true, 'the profile card fits the desktop viewport');
    await desktopPage.$eval('#online-account-panel', element => element.setAttribute('data-preview-scope', 'profile-feedback'));
    const desktopPreview = path.join(previewDir, 'online-profile-name-feedback-desktop.png');
    await (await desktopPage.$('[data-preview-scope="profile-feedback"]')).screenshot({ path: desktopPreview });
    assert.deepEqual(pageErrors, [], 'the profile feedback UI has no uncaught browser errors');
    console.log('Online profile-name feedback browser test passed. Previews:', mobilePreview, desktopPreview);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
