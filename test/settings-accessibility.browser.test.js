'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = process.env.PREVIEW_DIR || '/workspace/offline-ludo-review/previews/settings-accessibility';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, rel);
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
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port + '/'
    }));
  });
}

async function main() {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const pageErrors = [];
  const externalRequests = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    const localOrigin = new URL(local.url).origin;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });

    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    const initial = await page.evaluate(() => ({
      settings: Object.assign({}, window.__cf.save.settings),
      rules: Object.assign({}, window.__cf.save.rules),
      stored: localStorage.getItem('crossfour.save.v3')
    }));
    await page.click('#btn-settings');
    await page.waitForSelector('#settings:not(.hidden)');
    const dialog = await page.evaluate(() => ({
      role: document.querySelector('#settings').getAttribute('role'),
      modal: document.querySelector('#settings').getAttribute('aria-modal'),
      labelledBy: document.querySelector('#settings').getAttribute('aria-labelledby'),
      title: document.querySelector('#settings-title').textContent.trim(),
      focused: document.activeElement.id
    }));
    assert.deepEqual(dialog, {
      role: 'dialog', modal: 'true', labelledBy: 'settings-title', title: 'Settings', focused: 'settings-title'
    }, 'opening Settings presents a named modal and focuses its heading');

    await page.screenshot({ path: path.join(previewDir, 'settings-mobile.png'), fullPage: true });
    assert.ok(fs.statSync(path.join(previewDir, 'settings-mobile.png')).size > 5000, 'mobile Settings preview is rendered');
    await page.$eval('#settings .panel', panel => { panel.scrollTop = panel.scrollHeight; });
    await page.screenshot({ path: path.join(previewDir, 'settings-mobile-bottom.png'), fullPage: true });
    assert.ok(fs.statSync(path.join(previewDir, 'settings-mobile-bottom.png')).size > 5000, 'mobile Settings lower-section preview is rendered');
    await page.$eval('#settings .panel', panel => { panel.scrollTop = 0; });

    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-settings-close', 'Tab enters Settings at its Close control');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'set-sound', 'custom settings toggles remain keyboard-focusable');
    const switchFocus = await page.$eval('#set-sound + .sw', el => ({
      outline: getComputedStyle(el).outlineStyle,
      width: getComputedStyle(el).outlineWidth
    }));
    assert.deepEqual(switchFocus, { outline: 'solid', width: '3px' }, 'focused custom toggle has a visible 3px focus ring');

    const soundBefore = await page.$eval('#set-sound', el => el.checked);
    await page.keyboard.press('Space');
    const soundChanged = await page.evaluate(() => ({
      checked: document.querySelector('#set-sound').checked,
      setting: window.__cf.save.settings.sound,
      stored: JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.settings.sound
    }));
    assert.deepEqual(soundChanged, { checked: !soundBefore, setting: !soundBefore, stored: !soundBefore }, 'Space toggles and persists a custom Settings checkbox');
    await page.keyboard.press('Space');
    assert.equal(await page.$eval('#set-sound', el => el.checked), soundBefore, 'the toggle can be restored with the keyboard');

    await page.evaluate(() => document.querySelector('#btn-reset').focus());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-settings-close', 'Tab wraps from the final Settings action to the first');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-reset', 'Shift+Tab wraps from the first Settings control to the final action');
    await page.evaluate(() => document.querySelector('#settings-title').focus());
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-reset', 'Shift+Tab from the dialog heading stays inside Settings');
    await page.evaluate(() => document.querySelector('#btn-settings').focus());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-settings-close', 'Tab returns focus to Settings when it was programmatically moved outside');

    const afterKeyboardTest = await page.evaluate(() => ({
      settings: Object.assign({}, window.__cf.save.settings),
      rules: Object.assign({}, window.__cf.save.rules),
      stored: localStorage.getItem('crossfour.save.v3')
    }));
    assert.deepEqual(afterKeyboardTest.settings, initial.settings, 'opening and keyboard navigation preserve all settings values');
    assert.deepEqual(afterKeyboardTest.rules, initial.rules, 'opening and keyboard navigation preserve all house rules');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settings.hidden');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-settings', 'Escape closes Settings and restores focus to the Home opener');
    assert.equal(await page.evaluate(() => localStorage.getItem('crossfour.save.v3')), afterKeyboardTest.stored, 'closing Settings does not rewrite the local save');

    await page.click('#btn-pass');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#btn-edit-rules');
    await page.waitForSelector('#settings:not(.hidden)');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-title', 'opening Settings from setup focuses the dialog heading');
    await page.click('#btn-settings-close');
    await page.waitForSelector('#settings.hidden');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-edit-rules', 'Close restores focus to the setup Rules opener');

    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'));
    const gameBefore = await page.evaluate(() => ({
      phase: window.__cf.game.st.phase,
      turn: window.__cf.game.st.turn,
      rolls: window.__cf.game.st.rolls,
      pieces: JSON.stringify(window.__cf.game.st.pieces),
      savedGame: JSON.stringify(JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game)
    }));
    await page.click('#btn-game-settings');
    await page.waitForSelector('#settings:not(.hidden)');
    await page.keyboard.press('Enter');
    const gameDuring = await page.evaluate(() => ({
      phase: window.__cf.game.st.phase,
      turn: window.__cf.game.st.turn,
      rolls: window.__cf.game.st.rolls,
      pieces: JSON.stringify(window.__cf.game.st.pieces)
    }));
    assert.deepEqual(gameDuring, {
      phase: gameBefore.phase, turn: gameBefore.turn, rolls: gameBefore.rolls, pieces: gameBefore.pieces
    }, 'keyboard input inside Settings cannot trigger a hidden game action');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#settings.hidden');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-game-settings', 'Escape restores focus to the in-game Settings opener');
    const gameAfter = await page.evaluate(() => ({
      phase: window.__cf.game.st.phase,
      turn: window.__cf.game.st.turn,
      rolls: window.__cf.game.st.rolls,
      pieces: JSON.stringify(window.__cf.game.st.pieces),
      savedGame: JSON.stringify(JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game)
    }));
    assert.deepEqual(gameAfter, gameBefore, 'opening and closing Settings preserves the active game and local save');

    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    desktopPage.on('pageerror', error => pageErrors.push(error.message));
    await desktopPage.setRequestInterception(true);
    desktopPage.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else { externalRequests.push(request.url()); request.abort().catch(() => {}); }
    });
    await desktopPage.goto(local.url, { waitUntil: 'networkidle0' });
    await desktopPage.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await desktopPage.reload({ waitUntil: 'networkidle0' });
    await desktopPage.waitForSelector('#home:not(.hidden)');
    await desktopPage.click('#btn-settings');
    await desktopPage.waitForSelector('#settings:not(.hidden)');
    await desktopPage.evaluate(() => document.body.classList.add('light'));
    await desktopPage.keyboard.press('Tab');
    await desktopPage.keyboard.press('Tab');
    assert.equal(await desktopPage.evaluate(() => document.activeElement.id), 'set-sound', 'desktop keyboard navigation reaches a Settings toggle');
    const lightRing = await desktopPage.$eval('#set-sound + .sw', el => getComputedStyle(el).outlineColor);
    assert.equal(lightRing, 'rgb(29, 95, 150)', 'light theme uses a contrasting Settings focus ring');
    await desktopPage.screenshot({ path: path.join(previewDir, 'settings-desktop.png'), fullPage: true });
    assert.ok(fs.statSync(path.join(previewDir, 'settings-desktop.png')).size > 5000, 'desktop Settings preview is rendered');
    await desktopPage.keyboard.press('Escape');
    assert.equal(await desktopPage.evaluate(() => document.activeElement.id), 'btn-settings', 'desktop Escape restores focus to the Home opener');
    await desktopPage.close();

    assert.deepEqual(pageErrors, [], 'the browser reports no uncaught JavaScript exceptions');
    console.log('Settings accessibility browser tests passed. Previews: ' + previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
