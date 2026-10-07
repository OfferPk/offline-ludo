// Android system-back navigation regression. The Capacitor App plugin is mocked so this
// runs without a device, account, or live service; any save stays in the isolated browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};
let checks = 0;
function ok(value, message) {
  if (!value) throw new Error('FAILED: ' + message);
  checks++;
  console.log('  ok -', message);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
    catch (e) { res.writeHead(400).end(); return; }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(webRoot, '.' + pathname);
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = 'http://127.0.0.1:' + address.port;
  let browser;
  const blockedExternalRequests = [];
  const completedExternalRequests = [];
  const pageErrors = [];
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME || '/usr/bin/chromium',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    await page.evaluateOnNewDocument(() => {
      window.__nativeBackEvents = [];
      window.__nativeBackExitCount = 0;
      window.__nativeBackListener = null;
      window.Capacitor = { Plugins: { App: {
        addListener(name, listener) {
          window.__nativeBackEvents.push(name);
          if (name === 'backButton') window.__nativeBackListener = listener;
          return Promise.resolve({ remove() {} });
        },
        exitApp() { window.__nativeBackExitCount++; return Promise.resolve(); }
      } } };
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).origin !== origin) {
        blockedExternalRequests.push(request.url());
        request.abort().catch(() => {});
      } else request.continue().catch(() => {});
    });
    page.on('requestfinished', request => {
      if (new URL(request.url()).origin !== origin) completedExternalRequests.push(request.url());
    });
    await page.goto(origin + '/', { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.setItem('crossfour.tutorial.v1', '1'));
    await page.waitForFunction(() => typeof window.__nativeBackListener === 'function');
    const back = async canGoBack => {
      await page.evaluate(value => window.__nativeBackListener({ canGoBack: !!value }), canGoBack);
      await sleep(100);
    };
    const visible = selector => page.$eval(selector, element => !element.classList.contains('hidden'));
    const exitCount = () => page.evaluate(() => window.__nativeBackExitCount);

    ok((await page.evaluate(() => window.__nativeBackEvents.join(','))) === 'backButton', 'registers exactly one Capacitor Android back-button listener');
    await page.click('#btn-howto-home');
    ok(await page.$eval('#btn-howto-home', element => element.getAttribute('aria-expanded') === 'true'), 'home How to Play panel opens before back handling');
    await back(false);
    ok(await page.$eval('#btn-howto-home', element => element.getAttribute('aria-expanded') === 'false') && await exitCount() === 0, 'back collapses the expanded home guide instead of exiting');

    await page.click('#btn-vs-ai');
    ok(await visible('#setup'), 'setup screen opens');
    await back(false);
    ok(await visible('#home') && !(await visible('#setup')), 'back from setup returns home');

    await page.click('#btn-stats');
    ok(await visible('#stats'), 'statistics overlay opens');
    await back(false);
    ok(!(await visible('#stats')) && await visible('#home'), 'back closes the current dismissible overlay');

    await page.click('#btn-online');
    ok(await visible('#online'), 'Online screen opens without connecting to a service');
    await back(false);
    ok(await visible('#home') && !(await visible('#online')), 'back from Online returns home without creating a room');

    await page.click('#btn-vs-ai');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__cf && window.__cf.game && !document.getElementById('game').classList.contains('hidden'));
    ok(await visible('#game'), 'offline match starts');
    await back(false);
    ok(await visible('#menu') && await visible('#game') && await page.evaluate(() => !!window.__cf.game), 'back pauses the offline match through its existing save-and-pause menu');
    ok(await page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('crossfour.save.v3'));
      return !!snapshot && !!snapshot.payload.game;
    }), 'pausing preserves the in-progress offline save');
    await back(false);
    ok(!(await visible('#menu')) && await visible('#game'), 'back from the pause menu resumes the same match');

    await page.click('#btn-exit-match');
    ok(await visible('#confirm'), 'exit confirmation is shown before leaving the match');
    await back(false);
    ok(!(await visible('#confirm')) && await visible('#game') && await page.evaluate(() => !!window.__cf.game && !window.__cf.paused), 'back cancels a destructive exit confirmation and resumes the same match');
    await back(false);
    ok(await visible('#menu') && await visible('#game'), 'the resumed match can still be safely paused again');
    await back(false);
    ok(await visible('#game') && !(await visible('#menu')), 'back from the pause menu resumes the same match');

    await page.click('#btn-home');
    await page.click('#btn-m-home');
    ok(await visible('#home'), 'existing save-and-go-home control returns to root');
    await page.evaluate(() => history.pushState({ nativeBackTest: true }, '', '#native-back-test'));
    await back(true);
    await page.waitForFunction(() => location.hash === '');
    ok(await exitCount() === 0, 'uses browser history when Capacitor reports a history entry');
    await back(false);
    ok(await exitCount() === 1, 'exits the native app only from the root screen');

    ok(blockedExternalRequests.every(url => url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/')), 'the optional Supabase SDK download is blocked by the local test');
    ok(completedExternalRequests.length === 0, 'no external request reaches a live service');
    ok(pageErrors.length === 0, 'no browser runtime errors occur');
    console.log('\n' + checks + ' native-back checks passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
