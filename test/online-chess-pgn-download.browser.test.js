'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const previewDir = path.resolve(__dirname, '..', 'docs', 'previews', 'online-chess-pgn-download');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon'
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
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
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
    await page.setViewport({ width: 390, height: 844, isMobile: false, deviceScaleFactor: 1 });
    const errors = [];
    const origin = new URL(local.url).origin;
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith('/js/supabase-config.js')) {
        request.respond({
          status: 200,
          contentType: 'text/javascript',
          body: "window.CROSSFOUR_SUPABASE_CONFIG = Object.freeze({ url: 'https://pgn-test.supabase.co', publishableKey: 'sb_publishable_mock_only_for_pgn_download_browser_test', emailPasswordEnabled: true });"
        }).catch(() => {});
        return;
      }
      if (requestUrl.origin === origin) request.continue().catch(() => {});
      else request.abort().catch(() => {});
    });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__mockClipboardText = text; } }
      });
      const state = window.__mockOnlinePgn = {
        session: null,
        authListeners: [],
        channels: [],
        rpcCalls: [],
        clientCreated: false,
        tables: {
          profiles: [], wallets: [], rooms: [], room_members: [], room_invites: [],
          match_history: [], match_states: [], ludo_chess_matches: []
        }
      };
      state.emit = function (table, event) {
        state.channels.filter(channel => !channel.removed).forEach(channel => {
          channel.handlers.forEach(handler => {
            const filter = handler.filter || {};
            if (filter.table !== table) return;
            if (filter.event && filter.event !== '*' && event.event && filter.event !== event.event) return;
            if (filter.filter) {
              const match = /^([a-z_]+)=eq\.(.+)$/.exec(filter.filter);
              const row = event.new || event.old || {};
              if (match && String(row[match[1]]) !== match[2]) return;
            }
            handler.callback(event);
          });
        });
      };
      function queryBuilder(table) {
        let operation = 'select';
        let patch = null;
        let filters = [];
        let maxRows = null;
        function matches(row) {
          return filters.every(filter => filter.kind === 'eq'
            ? String(row[filter.field]) === String(filter.value)
            : filter.values.some(value => String(value) === String(row[filter.field])));
        }
        function execute(single) {
          const rows = (state.tables[table] || []).filter(matches);
          if (operation === 'update') {
            rows.forEach(row => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null });
          }
          const selected = rows.map(row => JSON.parse(JSON.stringify(row)));
          const limited = maxRows === null ? selected : selected.slice(0, maxRows);
          return Promise.resolve({ data: single ? (limited[0] || null) : limited, error: null });
        }
        const builder = {
          select() { operation = 'select'; return builder; },
          update(values) { operation = 'update'; patch = values; return builder; },
          eq(field, value) { filters.push({ kind: 'eq', field, value }); return builder; },
          in(field, values) { filters.push({ kind: 'in', field, values }); return builder; },
          order() { return builder; },
          limit(value) { maxRows = value; return builder; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return builder;
      }
      function makeChannel(name) {
        const channel = {
          name, handlers: [], removed: false,
          on(_type, filter, callback) { channel.handlers.push({ filter, callback }); return channel; },
          subscribe(callback) {
            state.channels.push(channel);
            if (callback) callback('SUBSCRIBED');
            return channel;
          }
        };
        return channel;
      }
      const client = {
        auth: {
          onAuthStateChange(callback) {
            state.authListeners.push(callback);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          getSession() { return Promise.resolve({ data: { session: state.session }, error: null }); }
        },
        from: queryBuilder,
        rpc(name, args) {
          state.rpcCalls.push({ name, args });
          return Promise.resolve({ data: null, error: { message: 'Unexpected RPC in PGN download test.' } });
        },
        channel: makeChannel,
        removeChannel(channel) { if (channel) channel.removed = true; }
      };
      window.supabase = { createClient() { state.clientCreated = true; return client; } };
    });

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('#btn-online');
    await page.waitForFunction(() => window.__mockOnlinePgn && window.__mockOnlinePgn.clientCreated);
    await page.evaluate(() => {
      const backend = window.__mockOnlinePgn;
      const roomId = 'pgn-download-room';
      backend.tables.profiles = [
        { id: 'user-one', handle: 'alice123', display_name: 'Alice' },
        { id: 'user-two', handle: 'bob123', display_name: 'Bobby' }
      ];
      backend.tables.wallets = [{ user_id: 'user-one', coins: 0, diamonds: 0 }];
      backend.tables.rooms = [{ id: roomId, created_by: 'user-one', mode: 'ludo_chess', capacity: 2, status: 'active', updated_at: '2026-10-07T00:00:00.000Z' }];
      backend.tables.room_members = [
        { room_id: roomId, user_id: 'user-one', seat: 0, role: 'host', ready: true },
        { room_id: roomId, user_id: 'user-two', seat: 1, role: 'member', ready: true }
      ];
      backend.tables.room_invites = [{ room_id: roomId, invite_code: 'PGNDOWNLOAD123456' }];
      const state = window.LudoChess.applyMove(window.LudoChess.initialState(), { from: 52, to: 36 });
      backend.tables.ludo_chess_matches = [{ room_id: roomId, version: 1, state, draw_offer: null, updated_at: '2026-10-07T00:00:00.000Z' }];
      backend.session = { user: { id: 'user-one', email: 'alice@example.test' } };
      backend.authListeners.forEach(listener => listener('SIGNED_IN', backend.session));
    });
    await page.waitForFunction(() => {
      const screen = document.querySelector('#online-chess-screen');
      const button = document.querySelector('#online-chess-download-pgn');
      return screen && !screen.classList.contains('hidden') && button && !button.disabled;
    }, { timeout: 15000 });

    const initialState = await page.evaluate(() => ({
      copyDisabled: document.querySelector('#online-chess-copy-pgn').disabled,
      downloadDisabled: document.querySelector('#online-chess-download-pgn').disabled,
      copyLabel: document.querySelector('#online-chess-copy-pgn').getAttribute('aria-label'),
      downloadLabel: document.querySelector('#online-chess-download-pgn').getAttribute('aria-label'),
      historyComplete: document.querySelector('#online-chess-pgn-status').textContent
    }));
    assert.equal(initialState.copyDisabled, false, 'copy remains enabled for a verified complete history');
    assert.equal(initialState.downloadDisabled, false, 'download is enabled for a verified complete history');
    assert.match(initialState.copyLabel, /copy.*PGN/i);
    assert.match(initialState.downloadLabel, /download.*PGN/i);
    assert.match(initialState.historyComplete, /PGN ready/i);

    fs.mkdirSync(previewDir, { recursive: true });
    const mobilePreview = path.join(previewDir, 'online-chess-pgn-download-mobile.png');
    const desktopPreview = path.join(previewDir, 'online-chess-pgn-download-desktop.png');
    await page.evaluate(() => {
      const screen = document.querySelector('#online-chess-screen');
      screen.scrollTop = screen.scrollHeight;
    });
    await page.screenshot({ path: mobilePreview });
    await page.evaluate(() => { document.querySelector('#online-chess-screen').scrollTop = 0; });
    const chessScreen = await page.$('#online-chess-screen');
    await page.setViewport({ width: 1440, height: 960, isMobile: false, deviceScaleFactor: 1 });
    const desktopChessScreen = await page.$('#online-chess-screen');
    await desktopChessScreen.screenshot({ path: desktopPreview });
    await page.setViewport({ width: 320, height: 780, isMobile: false, deviceScaleFactor: 1 });
    const narrow = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      actionsWidth: document.querySelector('.chess-pgn-actions').getBoundingClientRect().width,
      copy: (function () { const rect = document.querySelector('#online-chess-copy-pgn').getBoundingClientRect(); return { width: rect.width, height: rect.height }; })(),
      download: (function () { const rect = document.querySelector('#online-chess-download-pgn').getBoundingClientRect(); return { width: rect.width, height: rect.height }; })()
    }));
    assert.equal(narrow.overflow, false, 'Chess PGN actions fit a narrow phone viewport without horizontal overflow');
    assert.ok(narrow.copy.width > 0 && narrow.copy.height >= 44 && narrow.download.width > 0 && narrow.download.height >= 44, 'both PGN actions retain visible 44px touch targets on a narrow phone');

    await page.evaluate(() => {
      window.__mockDownloads = [];
      window.__mockDownloadedBlob = null;
      window.__mockRevokedUrl = '';
      URL.createObjectURL = blob => { window.__mockDownloadedBlob = blob; return 'blob:mock-online-chess-pgn'; };
      URL.revokeObjectURL = url => { window.__mockRevokedUrl = url; };
      HTMLAnchorElement.prototype.click = function () {
        window.__mockDownloads.push({ href: this.href, download: this.download });
      };
    });
    await page.click('#online-chess-download-pgn');
    await page.waitForFunction(() => window.__mockDownloads && window.__mockDownloads.length === 1);
    const download = await page.evaluate(async () => ({
      events: window.__mockDownloads,
      pgn: await window.__mockDownloadedBlob.text(),
      clipboard: window.__mockClipboardText,
      status: document.querySelector('#online-chess-pgn-status').textContent
    }));
    assert.equal(download.events[0].download, 'ludo-chess-pgn-download-room.pgn', 'the action downloads a room-named .pgn file');
    assert.equal(download.events[0].href, 'blob:mock-online-chess-pgn');
    assert.match(download.pgn, /\[Event "Ludo Chess"\]/);
    assert.match(download.pgn, /\[White "Alice"\]/);
    assert.match(download.pgn, /\[Black "Bobby"\]/);
    assert.match(download.pgn, /\[Result "\*"\]/);
    assert.match(download.pgn, /\n\n1\. e4 \*\n/, 'the downloaded file contains verified SAN movetext');
    assert.equal(download.clipboard, undefined, 'direct download does not depend on clipboard access');
    assert.equal(download.status, 'PGN file downloaded.');
    await page.click('#online-chess-copy-pgn');
    await page.waitForFunction(() => document.querySelector('#online-chess-pgn-status').textContent === 'PGN copied to clipboard.');
    assert.match(await page.evaluate(() => window.__mockClipboardText), /\n\n1\. e4 \*\n/, 'the existing clipboard action still copies the complete PGN');
    assert.equal(await page.evaluate(() => window.__mockDownloads.length), 1, 'copying does not trigger a second file download');

    await page.evaluate(() => {
      const backend = window.__mockOnlinePgn;
      const match = backend.tables.ludo_chess_matches[0];
      match.version += 1;
      match.state.position_history = [];
      backend.emit('ludo_chess_matches', { event: 'UPDATE', new: match });
    });
    await page.waitForFunction(() => document.querySelector('#online-chess-download-pgn').disabled);
    assert.equal(await page.$eval('#online-chess-copy-pgn', button => button.disabled), true, 'incomplete histories disable both export actions');
    await page.$eval('#online-chess-download-pgn', button => { button.disabled = false; button.click(); });
    await page.waitForFunction(() => /history|complete/i.test(document.querySelector('#online-chess-pgn-status').textContent));
    assert.equal(await page.evaluate(() => window.__mockDownloads.length), 1, 'a stale or programmatically re-enabled action cannot download an unverified history');
    assert.deepEqual(await page.evaluate(() => window.__mockOnlinePgn.rpcCalls), [], 'PGN export performs no backend RPC');
    assert.deepEqual(errors, [], 'the page has no uncaught browser errors');

    console.log('Online Chess PGN download checks passed. previews:', mobilePreview, desktopPreview);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
