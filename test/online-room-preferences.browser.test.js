'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-lobby-preferences');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(webRoot, relative);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return response.writeHead(403).end('Forbidden');
      fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end('Not found');
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

function installMock(page) {
  return page.evaluateOnNewDocument(() => {
    const user = { id: 'preference-user', email: 'player@example.test' };
    const session = { user };
    const tables = {
      profiles: [{ id: user.id, handle: 'playerone', display_name: 'Player One' }],
      wallets: [{ user_id: user.id, coins: 500, diamonds: 2 }],
      room_members: [], rooms: [], room_invites: [], match_history: [], match_states: [], ludo_chess_matches: []
    };
    function queryBuilder(table) {
      const filters = [];
      let limit = null;
      function selectRows(single) {
        let rows = (tables[table] || []).filter(row => filters.every(filter => filter.kind === 'eq'
          ? String(row[filter.field]) === String(filter.value)
          : filter.values.some(value => String(value) === String(row[filter.field]))));
        if (limit != null) rows = rows.slice(0, limit);
        const data = rows.map(row => JSON.parse(JSON.stringify(row)));
        return { data: single ? (data[0] || null) : data, error: null };
      }
      const builder = {
        select() { return builder; },
        eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
        in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
        order() { return builder; },
        limit(value) { limit = value; return builder; },
        maybeSingle() { return Promise.resolve(selectRows(true)); },
        then(resolve, reject) { return Promise.resolve(selectRows(false)).then(resolve, reject); }
      };
      return builder;
    }
    function makeChannel(name) {
      const channel = { name, on() { return channel; }, subscribe(callback) { if (callback) setTimeout(() => callback('SUBSCRIBED'), 0); return channel; } };
      return channel;
    }
    window.supabase = {
      createClient() {
        return {
          auth: {
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            getSession() { return Promise.resolve({ data: { session }, error: null }); },
            signOut() { return Promise.resolve({ error: null }); }
          },
          from: queryBuilder,
          channel: makeChannel,
          removeChannel() { return Promise.resolve('ok'); },
          rpc() { return Promise.resolve({ data: {}, error: null }); }
        };
      }
    };
  });
}

function allowMockedLocalOnlyTraffic(page, origin) {
  return page.setRequestInterception(true).then(() => {
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({ status: 200, contentType: 'text/javascript', body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://example-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_browser_tests', emailPasswordEnabled: true });" }).catch(() => {});
      } else if (requestUrl.origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
  });
}

async function openLobby(page, url) {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.click('#btn-online');
  await page.waitForFunction(() => {
    const panel = document.querySelector('#online-room-panel');
    return panel && !panel.classList.contains('hidden') && !document.querySelector('#online-account-panel').classList.contains('hidden');
  }, { timeout: 15000 });
}

async function createLobbyPage(browser, url, width, height, mobile, pageErrors) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  page.on('pageerror', error => pageErrors.push(error.message));
  await allowMockedLocalOnlyTraffic(page, new URL(url).origin);
  await installMock(page);
  await openLobby(page, url);
  return page;
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  const pageErrors = [];
  try {
    fs.mkdirSync(previewDir, { recursive: true });
    const mobilePage = await createLobbyPage(browser, local.url, 390, 844, true, pageErrors);
    assert.equal(await mobilePage.$eval('#online-mode', element => element.value), 'classic', 'first use keeps the existing Classic default');
    assert.equal(await mobilePage.$eval('#online-capacity', element => element.value), '2', 'first use keeps the existing two-seat default');
    await mobilePage.select('#online-capacity', '4');
    await mobilePage.select('#online-mode', 'ludo_chess');
    assert.equal(await mobilePage.$eval('#online-capacity', element => element.value + ':' + element.disabled), '2:true', 'Chess remains fixed to two seats');
    const saved = await mobilePage.evaluate(() => JSON.parse(localStorage.getItem(window.OnlineRoomPreferences.KEY)));
    assert.deepEqual(saved, { mode: 'ludo_chess', classicCapacity: '4' }, 'only the selected mode and last Classic seat count are stored');
    await mobilePage.screenshot({ path: path.join(previewDir, 'mobile.png'), fullPage: true });

    const desktopPage = await createLobbyPage(browser, local.url, 1280, 900, false, pageErrors);
    assert.equal(await desktopPage.$eval('#online-mode', element => element.value), 'ludo_chess', 'desktop restores the same mode preference');
    await desktopPage.screenshot({ path: path.join(previewDir, 'desktop.png'), fullPage: true });
    await desktopPage.close();

    await mobilePage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await mobilePage.click('#btn-online');
    await mobilePage.waitForFunction(() => !document.querySelector('#online-room-panel').classList.contains('hidden'));
    assert.equal(await mobilePage.$eval('#online-mode', element => element.value), 'ludo_chess', 'mode selection is restored after reload');
    assert.equal(await mobilePage.$eval('#online-capacity', element => element.value + ':' + element.disabled), '2:true', 'the restored Chess mode still enforces its seat limit');
    await mobilePage.select('#online-mode', 'classic');
    assert.equal(await mobilePage.$eval('#online-capacity', element => element.value), '4', 'switching back to Classic restores the prior seat count after reload');

    await mobilePage.evaluate(() => localStorage.setItem(window.OnlineRoomPreferences.KEY, JSON.stringify({ mode: 'unknown', classicCapacity: '99' })));
    await mobilePage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    await mobilePage.click('#btn-online');
    await mobilePage.waitForFunction(() => !document.querySelector('#online-room-panel').classList.contains('hidden'));
    assert.equal(await mobilePage.$eval('#online-mode', element => element.value), 'classic', 'invalid saved modes safely fall back to Classic');
    assert.equal(await mobilePage.$eval('#online-capacity', element => element.value), '2', 'invalid saved seat counts safely fall back to two seats');
    assert.deepEqual(pageErrors, [], 'preference restore does not create browser errors');
    await mobilePage.close();
    console.log('Online room preferences browser checks passed. Previews:', path.join(previewDir, 'mobile.png'), path.join(previewDir, 'desktop.png'));
  } finally {
    await browser.close();
    await new Promise(resolve => local.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
