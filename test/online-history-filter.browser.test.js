'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-history-mode-filter');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return response.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end('Not found');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

function addSampleRows() {
  const list = document.getElementById('online-history-list');
  [
    ['classic', 'Online Classic · completed', 'Started yesterday'],
    ['ludo_chess', 'Ludo Chess · completed', 'Started two days ago'],
    ['classic', 'Online Classic · active', 'Started today']
  ].forEach(([mode, titleText, detailText]) => {
    const item = document.createElement('li'); item.dataset.historyMode = mode;
    const title = document.createElement('b'); title.textContent = titleText;
    const detail = document.createElement('small'); detail.textContent = detailText;
    item.append(title, detail); list.appendChild(item);
  });
  document.getElementById('online-history-empty').classList.add('hidden');
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const pageErrors = [];
    const origin = new URL(local.url).origin;
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });

    await page.evaluate(() => {
      document.getElementById('home').classList.add('hidden');
      document.getElementById('online').classList.remove('hidden');
    });
    await page.evaluate(addSampleRows);
    await page.waitForFunction(() => document.getElementById('online-history-filter-status').textContent === 'Showing all 3 tables.');

    const accessible = await page.evaluate(() => ({
      groupRole: document.getElementById('online-history-filters').getAttribute('role'),
      groupLabel: document.getElementById('online-history-filters').getAttribute('aria-label'),
      buttons: Array.from(document.querySelectorAll('[data-history-filter]')).map(button => ({
        label: button.textContent.trim(), pressed: button.getAttribute('aria-pressed')
      }))
    }));
    assert.equal(accessible.groupRole, 'group');
    assert.equal(accessible.groupLabel, 'Filter match history');
    assert.deepEqual(accessible.buttons.map(button => button.label), ['All', 'Online Classic', 'Ludo Chess']);
    assert.deepEqual(accessible.buttons.map(button => button.pressed), ['true', 'false', 'false']);

    await page.click('#online-history-filter-classic');
    let state = await page.evaluate(() => ({
      visible: Array.from(document.querySelectorAll('#online-history-list > li')).filter(item => !item.hidden).map(item => item.textContent),
      hiddenCount: document.querySelectorAll('#online-history-list > li[hidden]').length,
      status: document.getElementById('online-history-filter-status').textContent,
      pressed: document.getElementById('online-history-filter-classic').getAttribute('aria-pressed')
    }));
    assert.deepEqual(state.visible, ['Online Classic · completedStarted yesterday', 'Online Classic · activeStarted today']);
    assert.equal(state.hiddenCount, 1);
    assert.equal(state.status, 'Showing 2 of 3 tables.');
    assert.equal(state.pressed, 'true');

    await page.click('#online-history-filter-chess');
    state = await page.evaluate(() => ({
      visible: Array.from(document.querySelectorAll('#online-history-list > li')).filter(item => !item.hidden).map(item => item.textContent),
      status: document.getElementById('online-history-filter-status').textContent
    }));
    assert.deepEqual(state.visible, ['Ludo Chess · completedStarted two days ago']);
    assert.equal(state.status, 'Showing 1 of 3 tables.');

    await page.evaluate(() => {
      const item = document.createElement('li'); item.dataset.historyMode = 'ludo_chess';
      const title = document.createElement('b'); title.textContent = 'Ludo Chess · cancelled';
      item.append(title); document.getElementById('online-history-list').appendChild(item);
    });
    await page.waitForFunction(() => document.getElementById('online-history-filter-status').textContent === 'Showing 2 of 4 tables.');
    assert.equal(await page.$$eval('#online-history-list > li:not([hidden])', items => items.length), 2, 'newly loaded rows respect the selected filter');

    await page.evaluate(() => {
      document.getElementById('online-history-list').replaceChildren();
      document.getElementById('online-history-empty').classList.remove('hidden');
    });
    await page.waitForFunction(() => document.getElementById('online-history-filters').classList.contains('hidden'));
    assert.equal(await page.$eval('#online-history-filter-all', button => button.getAttribute('aria-pressed')), 'true', 'clearing history resets the filter to All');
    assert.equal(await page.$eval('#online-history-filter-status', status => status.classList.contains('hidden')), true);

    await page.evaluate(() => {
      const list = document.getElementById('online-history-list');
      const item = document.createElement('li'); item.dataset.historyMode = 'classic'; list.appendChild(item);
      document.getElementById('online-history-empty').classList.add('hidden');
    });
    await page.waitForFunction(() => document.getElementById('online-history-filter-status').textContent === 'Showing all 1 table.');
    await page.evaluate(() => document.getElementById('online-history-list').replaceChildren());
    await page.waitForFunction(() => document.getElementById('online-history-filters').classList.contains('hidden'));
    await page.evaluate(addSampleRows);
    await page.waitForFunction(() => document.getElementById('online-history-filter-status').textContent === 'Showing all 3 tables.');
    await page.click('#online-history-filter-classic');

    const narrowLayout = await page.evaluate(() => {
      const group = document.getElementById('online-history-filters');
      const rect = group.getBoundingClientRect();
      const buttons = Array.from(group.querySelectorAll('button')).map(button => {
        const buttonRect = button.getBoundingClientRect();
        return { width: buttonRect.width, height: buttonRect.height };
      });
      return { width: rect.width, scrollWidth: group.scrollWidth, buttons };
    });
    assert.ok(narrowLayout.width > 0 && narrowLayout.scrollWidth <= narrowLayout.width + 1, 'filter controls fit without horizontal overflow on mobile');
    assert.ok(narrowLayout.buttons.every(button => button.width > 0 && button.height >= 40), 'all mode filters retain usable touch targets');

    fs.mkdirSync(previewDir, { recursive: true });
    await page.$eval('#online-history-heading', heading => heading.scrollIntoView({ block: 'center' }));
    await page.$eval('#online-history-heading', heading => heading.closest('.online-card').setAttribute('data-preview-scope', 'history-filter'));
    const card = await page.$('[data-preview-scope="history-filter"]');
    const mobilePreview = path.join(previewDir, 'online-history-mode-filter-mobile.png');
    await card.screenshot({ path: mobilePreview });
    await page.setViewport({ width: 1440, height: 960, isMobile: false, deviceScaleFactor: 1 });
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.waitForFunction(() => window.OnlineHistoryFilter && document.getElementById('online-history-list'));
    await page.evaluate(() => {
      document.getElementById('home').classList.add('hidden');
      document.getElementById('online').classList.remove('hidden');
    });
    await page.evaluate(addSampleRows);
    await page.waitForFunction(() => document.getElementById('online-history-filter-status').textContent === 'Showing all 3 tables.');
    await page.click('#online-history-filter-classic');
    await page.$eval('#online-history-heading', heading => heading.closest('.online-card').setAttribute('data-preview-scope', 'history-filter'));
    const desktopPreview = path.join(previewDir, 'online-history-mode-filter-desktop.png');
    const desktopCard = await page.$('[data-preview-scope="history-filter"]');
    await desktopCard.screenshot({ path: desktopPreview });

    assert.deepEqual(pageErrors, [], 'the Online page has no uncaught browser errors');
    console.log('Online match-history mode-filter browser checks passed. previews:', mobilePreview, desktopPreview);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
