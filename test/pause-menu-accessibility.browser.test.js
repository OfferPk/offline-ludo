'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = process.env.PREVIEW_DIR || path.resolve(__dirname, '../docs/previews/pause-menu-accessibility');
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
  const page = await browser.newPage();
  const pageErrors = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    const localOrigin = new URL(local.url).origin;
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });

    await page.goto(local.url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-rules');
    await page.waitForSelector('#rules:not(.hidden)');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'rules-title', 'Rules opened from home focuses its dialog heading');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#rules.hidden');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-rules', 'closing home Rules returns focus to its opener');
    await page.click('#btn-pass');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#presets button[data-p="1v1"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'));

    const before = await page.evaluate(() => ({
      turn: window.__cf.game.st.turn,
      rolls: window.__cf.game.st.rolls,
      pieces: JSON.stringify(window.__cf.game.st.pieces),
      saved: !!JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game
    }));
    assert.equal(before.saved, true, 'the match has a local save before opening the pause menu');

    await page.click('#btn-home');
    await page.waitForSelector('#menu:not(.hidden)');
    const menuState = await page.evaluate(() => {
      const menu = document.querySelector('#menu');
      return {
        role: menu.getAttribute('role'),
        modal: menu.getAttribute('aria-modal'),
        labelledBy: menu.getAttribute('aria-labelledby'),
        description: menu.getAttribute('aria-describedby'),
        focused: document.activeElement.id,
        paused: window.__cf.paused
      };
    });
    assert.deepEqual(menuState, {
      role: 'dialog', modal: 'true', labelledBy: 'menu-title', description: 'menu-note',
      focused: 'menu-title', paused: true
    }, 'opening the pause menu presents a named modal and focuses its heading');

    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-m-resume', 'Tab moves from the dialog heading to its first action');
    const focusStyle = await page.$eval('#btn-m-resume', button => ({ outline: getComputedStyle(button).outlineStyle, width: getComputedStyle(button).outlineWidth }));
    assert.equal(focusStyle.outline, 'solid', 'keyboard focus is visibly outlined');
    assert.equal(focusStyle.width, '3px', 'keyboard focus outline has a clear 3px width');

    await page.screenshot({ path: path.join(previewDir, 'pause-menu-mobile.png'), fullPage: true });

    await page.evaluate(() => document.querySelector('#btn-m-home').focus());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-m-resume', 'Tab wraps from the last pause-menu action to the first');
    await page.evaluate(() => document.querySelector('#menu-title').focus());
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-m-home', 'Shift+Tab from the dialog heading wraps to its last action');
    await page.evaluate(() => document.querySelector('#btn-home').focus());
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-m-resume', 'keyboard focus cannot escape behind the pause dialog');

    await page.keyboard.press('Escape');
    await page.waitForSelector('#menu.hidden');
    const resumed = await page.evaluate(() => ({
      paused: window.__cf.paused,
      focused: document.activeElement.id,
      visible: !document.querySelector('#game').classList.contains('hidden'),
      rolls: window.__cf.game.st.rolls,
      turn: window.__cf.game.st.turn,
      pieces: JSON.stringify(window.__cf.game.st.pieces),
      saved: !!JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.game
    }));
    assert.equal(resumed.paused, false, 'Escape resumes the paused match');
    assert.equal(resumed.focused, 'btn-home', 'closing the dialog returns focus to its opener');
    assert.equal(resumed.visible, true, 'the same game screen remains visible');
    assert.equal(resumed.rolls, before.rolls, 'closing the menu does not roll or change game state');
    assert.equal(resumed.turn, before.turn, 'closing the menu preserves the active player');
    assert.equal(resumed.pieces, before.pieces, 'closing the menu preserves all token positions');
    assert.equal(resumed.saved, true, 'the in-progress local save remains available');

    await page.click('#btn-home');
    await page.waitForSelector('#menu:not(.hidden)');
    await page.click('#btn-m-rules');
    await page.waitForSelector('#rules:not(.hidden)');
    const nested = await page.evaluate(() => ({
      menuHiddenFromAT: document.querySelector('#menu').getAttribute('aria-hidden'),
      menuModal: document.querySelector('#menu').getAttribute('aria-modal'),
      rulesRole: document.querySelector('#rules').getAttribute('role'),
      rulesModal: document.querySelector('#rules').getAttribute('aria-modal'),
      rulesLabel: document.querySelector('#rules').getAttribute('aria-labelledby'),
      focus: document.activeElement.id
    }));
    assert.deepEqual(nested, {
      menuHiddenFromAT: 'true', menuModal: 'false', rulesRole: 'dialog', rulesModal: 'true',
      rulesLabel: 'rules-title', focus: 'rules-title'
    }, 'Rules becomes the named modal and hides the paused dialog underneath');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-close')), 'rules', 'Tab enters the Rules dialog at its close action');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('#rules button')).filter(button => !button.closest('.hidden') && button.getClientRects().length);
      buttons[buttons.length - 1].focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === Array.from(document.querySelectorAll('#rules button')).find(button => !button.closest('.hidden') && button.getClientRects().length)), true, 'Tab wraps within Rules instead of escaping into the paused game');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#rules.hidden');
    const returned = await page.evaluate(() => ({
      menuHiddenFromAT: document.querySelector('#menu').getAttribute('aria-hidden'),
      menuModal: document.querySelector('#menu').getAttribute('aria-modal'),
      menuVisible: !document.querySelector('#menu').classList.contains('hidden'),
      focus: document.activeElement.id,
      paused: window.__cf.paused
    }));
    assert.deepEqual(returned, {
      menuHiddenFromAT: null, menuModal: 'true', menuVisible: true,
      focus: 'btn-m-rules', paused: true
    }, 'closing Rules restores the pause dialog and returns focus to its opener');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#menu.hidden');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-home', 'the nested flow returns to the original game control');
    const desktopContext = await browser.createBrowserContext();
    try {
      const desktopPage = await desktopContext.newPage();
      await desktopPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
      desktopPage.on('pageerror', error => pageErrors.push(error.message));
      const localOrigin = new URL(local.url).origin;
      await desktopPage.setRequestInterception(true);
      desktopPage.on('request', request => {
        if (new URL(request.url()).origin === localOrigin) request.continue().catch(() => {});
        else request.abort().catch(() => {});
      });
      await desktopPage.goto(local.url, { waitUntil: 'networkidle0' });
      await desktopPage.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('crossfour.tutorial.v1', '1');
      });
      await desktopPage.reload({ waitUntil: 'networkidle0' });
      await desktopPage.waitForSelector('#home:not(.hidden)');
      await desktopPage.click('#btn-pass');
      await desktopPage.waitForSelector('#setup:not(.hidden)');
      await desktopPage.click('#presets button[data-p="1v1"]');
      await desktopPage.click('#btn-start');
      await desktopPage.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'));
      await desktopPage.click('#btn-home');
      await desktopPage.waitForSelector('#menu:not(.hidden)');
      await desktopPage.keyboard.press('Tab');
      assert.equal(await desktopPage.evaluate(() => document.activeElement.id), 'btn-m-resume', 'desktop Tab navigation also enters the first pause-menu action');
      await desktopPage.screenshot({ path: path.join(previewDir, 'pause-menu-desktop.png'), fullPage: true });
      await desktopPage.keyboard.press('Escape');
      await desktopPage.waitForSelector('#menu.hidden');
      assert.equal(await desktopPage.evaluate(() => document.activeElement.id), 'btn-home', 'desktop Escape returns focus to the game control');
    } finally {
      await desktopContext.close();
    }
    assert.deepEqual(pageErrors, [], 'the browser reports no uncaught JavaScript exceptions');
    console.log('Pause-menu accessibility browser tests passed. Previews: ' + previewDir);
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
