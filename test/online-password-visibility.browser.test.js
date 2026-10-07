'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = process.env.PREVIEW_DIR || '';
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      url: 'http://127.0.0.1:' + server.address().port + '/'
    }));
  });
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const pageErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });"
        }).catch(() => {});
      } else if (url.origin === new URL(local.url).origin) {
        request.continue().catch(() => {});
      } else {
        request.abort().catch(() => {});
      }
    });
    await page.evaluateOnNewDocument(() => {
      window.__authListeners = [];
      window.supabase = {
        createClient() {
          return {
            auth: {
              onAuthStateChange(callback) {
                window.__authListeners.push(callback);
                return { data: { subscription: { unsubscribe() {} } } };
              },
              getSession() { return Promise.resolve({ data: { session: null }, error: null }); },
              signInWithPassword() { return Promise.resolve({ data: { session: null }, error: null }); },
              signUp() { return Promise.resolve({ data: { session: null }, error: null }); },
              updateUser() { return Promise.resolve({ error: null }); },
              signOut() { return Promise.resolve({ error: null }); }
            },
            from(table) {
              const builder = {
                select() { return builder; },
                eq() { return builder; },
                order() { return builder; },
                limit() { return builder; },
                maybeSingle() {
                  const data = table === 'profiles'
                    ? { handle: 'alice', display_name: 'Alice' }
                    : { coins: 0, diamonds: 0 };
                  return Promise.resolve({ data, error: null });
                },
                then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
              };
              return builder;
            }
          };
        }
      };
    });

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => !document.querySelector('#online').classList.contains('hidden') && !document.querySelector('#online-auth-panel').classList.contains('hidden'));
    await page.waitForFunction(() => document.querySelector('#online-signin').disabled === false);

    assert.deepEqual(await page.evaluate(() => [
      document.querySelector('#online-password').type,
      document.querySelector('#online-password-toggle').getAttribute('aria-pressed'),
      document.querySelector('#online-password-toggle').getAttribute('aria-controls'),
      document.querySelector('#online-new-password').type,
      document.querySelector('#online-new-password-toggle').getAttribute('aria-pressed')
    ]), ['password', 'false', 'online-password', 'password', 'false'], 'both fields start masked and each toggle exposes its controlled field and state');

    if (previewDir) {
      await fs.promises.mkdir(previewDir, { recursive: true });
      const authCard = await page.$('#online-auth-panel');
      await authCard.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await authCard.screenshot({ path: path.join(previewDir, 'online-password-visibility-mobile.png') });
      await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await new Promise(resolve => setTimeout(resolve, 100));
      const desktopCard = await page.$('#online-auth-panel');
      await desktopCard.screenshot({ path: path.join(previewDir, 'online-password-visibility-desktop.png') });
    }

    await page.$eval('#online-email', input => { input.value = 'alice@example.test'; });
    await page.$eval('#online-password', input => { input.value = 'synthetic-example-only'; });
    await page.click('#online-password-toggle');
    assert.deepEqual(await page.evaluate(() => ({
      type: document.querySelector('#online-password').type,
      value: document.querySelector('#online-password').value,
      pressed: document.querySelector('#online-password-toggle').getAttribute('aria-pressed'),
      text: document.querySelector('#online-password-toggle').textContent,
      label: document.querySelector('#online-password-toggle').getAttribute('aria-label'),
      otherType: document.querySelector('#online-new-password').type
    })), {
      type: 'text', value: 'synthetic-example-only', pressed: 'true', text: 'Hide',
      label: 'Password visibility for password', otherType: 'password'
    }, 'showing one field preserves its value and does not reveal another field');

    await page.focus('#online-password-toggle');
    await page.keyboard.press('Space');
    assert.deepEqual(await page.evaluate(() => ({
      type: document.querySelector('#online-password').type,
      pressed: document.querySelector('#online-password-toggle').getAttribute('aria-pressed'),
      text: document.querySelector('#online-password-toggle').textContent
    })), { type: 'password', pressed: 'false', text: 'Show' }, 'keyboard activation hides the password and updates the announced toggle state');

    await page.click('#online-password-toggle');
    assert.equal(await page.$eval('#online-password', input => input.type), 'text');
    await page.click('#online-signin');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Sign-in could not start a session'));
    assert.deepEqual(await page.evaluate(() => ({
      type: document.querySelector('#online-password').type,
      pressed: document.querySelector('#online-password-toggle').getAttribute('aria-pressed'),
      value: document.querySelector('#online-password').value
    })), { type: 'password', pressed: 'false', value: '' }, 'sign-in submission clears the field and masks it again');

    await page.$eval('#online-password', input => { input.value = 'synthetic-example-only'; });
    await page.click('#online-password-toggle');
    await page.click('#online-signup');
    await page.waitForFunction(() => document.querySelector('#online-status').textContent.includes('Account created, but automatic sign-in did not start'));
    assert.deepEqual(await page.evaluate(() => ({
      type: document.querySelector('#online-password').type,
      pressed: document.querySelector('#online-password-toggle').getAttribute('aria-pressed'),
      value: document.querySelector('#online-password').value
    })), { type: 'password', pressed: 'false', value: '' }, 'account submission clears the field and masks it again');

    await page.evaluate(() => window.__authListeners[0]('PASSWORD_RECOVERY', { user: { id: 'mock-recovery-user' } }));
    await page.waitForFunction(() => !document.querySelector('#online-recovery-panel').classList.contains('hidden'));
    await page.$eval('#online-new-password', input => { input.value = 'synthetic-new-password'; });
    await page.focus('#online-new-password-toggle');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => ({
      type: document.querySelector('#online-new-password').type,
      value: document.querySelector('#online-new-password').value,
      pressed: document.querySelector('#online-new-password-toggle').getAttribute('aria-pressed'),
      text: document.querySelector('#online-new-password-toggle').textContent
    })), { type: 'text', value: 'synthetic-new-password', pressed: 'true', text: 'Hide' }, 'keyboard activation reveals only the recovery password');
    await page.$eval('#online-recovery-form', form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.deepEqual(await page.evaluate(() => ({
      type: document.querySelector('#online-new-password').type,
      pressed: document.querySelector('#online-new-password-toggle').getAttribute('aria-pressed')
    })), { type: 'password', pressed: 'false' }, 'password update submission masks the recovery field again');

    await page.click('#online-back');
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    assert.deepEqual(pageErrors, [], 'visibility toggles and the offline entry flow have no uncaught browser errors');
    console.log('Online password visibility browser regression passed (mouse, keyboard, independent fields, auto-mask, and offline entry).');
    if (previewDir) console.log('Previews:', path.join(previewDir, 'online-password-visibility-mobile.png'), path.join(previewDir, 'online-password-visibility-desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
