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
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
      catch (e) { res.writeHead(400).end('Bad request'); return; }
      const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}
async function chooseFile(page, text, name) {
  await page.evaluate(() => document.querySelector('#btn-restore-backup').scrollIntoView({ block: 'center' }));
  await new Promise(resolve => setTimeout(resolve, 120));
  await page.evaluate(() => {
    const input = document.querySelector('#local-restore-file');
    input.click = () => { window.__restorePickerRequested = true; };
    window.__restorePickerRequested = false;
  });
  await page.click('#btn-restore-backup');
  assert.strictEqual(await page.evaluate(() => window.__restorePickerRequested), true, 'the Settings button opens the file picker');
  await page.evaluate(({ text, name }) => {
    const input = document.querySelector('#local-restore-file');
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], name, { type: 'application/json' }));
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { text, name });
}
async function waitForStatus(page, fragment) {
  await page.waitForFunction(text => document.querySelector('#local-restore-status').textContent.includes(text), { timeout: 5000 }, fragment);
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
    page.on('pageerror', error => errors.push(String(error && error.message || error)));
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => !!window.__cf, { timeout: 10000 });
    await page.evaluate(() => localStorage.setItem('crossfour.tutorial.v1', '1'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    const fixtures = await page.evaluate(() => {
      const app = window.__cf;
      app.save.coins = 321; app.save.xp = 654; app.save.stats.played = 12;
      if (!app.persist()) throw new Error('Could not create the current-save fixture');
      const current = JSON.parse(localStorage.getItem('crossfour.save.v3'));
      const backup = JSON.parse(JSON.stringify(current));
      backup.savedAt = Date.now() - 3600000;
      backup.payload.coins = 987; backup.payload.xp = 1234; backup.payload.stats.played = 19;
      backup.payload.settings.fast = true;
      return { currentRaw: JSON.stringify(current), backup: JSON.stringify(backup) };
    });
    await page.click('#btn-settings');
    await page.waitForSelector('#settings:not(.hidden)');
    assert.match(await page.$eval('#local-restore-title', el => el.textContent), /Restore offline save/);
    assert.strictEqual(await page.$eval('#btn-restore-backup', el => el.disabled), false);
    await page.evaluate(() => {
      const panel = document.querySelector('#settings .panel');
      panel.scrollTop = panel.scrollHeight;
    });
    await new Promise(resolve => setTimeout(resolve, 250));

    const previewDir = process.env.SAVE_RESTORE_PREVIEW_DIR;
    if (previewDir) {
      fs.mkdirSync(previewDir, { recursive: true });
      await page.screenshot({ path: path.join(previewDir, 'mobile-settings.png'), fullPage: true });
      const desktopContext = await browser.createBrowserContext();
      const desktopPage = await desktopContext.newPage();
      desktopPage.on('pageerror', error => errors.push(String(error && error.message || error)));
      await desktopPage.setViewport({ width: 1280, height: 900, isMobile: false });
      await desktopPage.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await desktopPage.waitForFunction(() => !!window.__cf, { timeout: 10000 });
      await desktopPage.click('#btn-settings');
      await desktopPage.waitForSelector('#settings:not(.hidden)');
      await desktopPage.evaluate(() => { const panel = document.querySelector('#settings .panel'); panel.scrollTop = panel.scrollHeight; });
      await new Promise(resolve => setTimeout(resolve, 250));
      await desktopPage.screenshot({ path: path.join(previewDir, 'desktop-settings.png'), fullPage: true });
      await chooseFile(desktopPage, fixtures.backup, 'valid-backup.json');
      await desktopPage.waitForSelector('#confirm:not(.hidden)');
      await new Promise(resolve => setTimeout(resolve, 300));
      await desktopPage.screenshot({ path: path.join(previewDir, 'desktop-confirm.png'), fullPage: true });
      await desktopContext.close();
    }

    await chooseFile(page, '{not valid JSON', 'broken.json');
    await waitForStatus(page, 'not valid JSON');
    assert.strictEqual(await page.$eval('#confirm', el => el.classList.contains('hidden')), true);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('crossfour.save.v3')), fixtures.currentRaw);

    const incompatible = JSON.parse(fixtures.backup); incompatible.schemaVersion = 4;
    await chooseFile(page, JSON.stringify(incompatible), 'future.json');
    await waitForStatus(page, 'not a valid backup');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('crossfour.save.v3')), fixtures.currentRaw);

    await chooseFile(page, 'x'.repeat(1024 * 1024 + 1), 'oversized.json');
    await waitForStatus(page, 'too large');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('crossfour.save.v3')), fixtures.currentRaw);

    await chooseFile(page, fixtures.backup, 'valid-backup.json');
    await page.waitForSelector('#confirm:not(.hidden)');
    const confirmation = await page.$eval('#confirm-text', el => el.textContent);
    assert.match(confirmation, /replace the offline profile/);
    assert.match(confirmation, /checkpointed before replacement/);
    assert.match(confirmation, /Online account data is not affected/);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('crossfour.save.v3')), fixtures.currentRaw, 'validation and confirmation do not overwrite the current save');

    if (previewDir) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(previewDir, 'mobile-confirm.png'), fullPage: true });
    }
    await page.click('#confirm-no');
    await waitForStatus(page, 'Restore cancelled');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('crossfour.save.v3')), fixtures.currentRaw);

    await chooseFile(page, fixtures.backup, 'valid-backup.json');
    await page.waitForSelector('#confirm:not(.hidden)');
    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.click('#confirm-yes');
    await navigation;
    await page.waitForFunction(() => window.__cf && window.__cf.save.coins === 987 && window.__cf.save.xp === 1234, { timeout: 10000 });
    const restored = await page.evaluate(() => ({
      loadStatus: window.__cf.loadStatus,
      coins: window.__cf.save.coins,
      xp: window.__cf.save.xp,
      played: window.__cf.save.stats.played,
      fast: window.__cf.save.settings.fast,
      snapshotVersion: JSON.parse(localStorage.getItem('crossfour.save.v3')).schemaVersion
    }));
    assert.strictEqual(restored.loadStatus, 'loaded');
    assert.strictEqual(restored.coins, 987);
    assert.strictEqual(restored.xp, 1234);
    assert.strictEqual(restored.played, 19);
    assert.strictEqual(restored.fast, true);
    assert.strictEqual(restored.snapshotVersion, 3);
    assert.deepStrictEqual(errors, [], 'restore should not produce browser errors');
    console.log('  ok - invalid JSON, incompatible schema, and oversized files leave local progress unchanged');
    console.log('  ok - restore requires explicit confirmation and cancel preserves the current save');
    console.log('  ok - confirmed restore reloads the validated versioned offline profile');
    if (previewDir) console.log('  previews written to ' + previewDir);
    console.log('\n3 local save restore browser checks passed');
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
