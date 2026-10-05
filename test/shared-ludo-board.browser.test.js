'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || path.resolve(__dirname, '..', 'docs', 'previews', 'shared-ludo-board');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
let checks = 0;
function ok(value, label) { assert.ok(value, label); checks++; console.log('  ok - ' + label); }

function startLocalServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(webRoot, relative);
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}

function contrast(a, b) {
  function luminance(rgb) {
    const channels = rgb.map(value => { value /= 255; return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [], externalRequests = [];
  try {
    fs.mkdirSync(shotDir, { recursive: true });
    async function newIsolatedPage() {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setRequestInterception(true);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', request => {
        const url = request.url();
        if (!url.startsWith(local.url) && !url.startsWith('data:') && !url.startsWith('about:')) { externalRequests.push(url); request.abort(); }
        else request.continue();
      });
      return { context, page };
    }

    async function openMode(width, height, entry, capture) {
      const session = await newIsolatedPage(), page = session.page;
      try {
        await page.setViewport({ width, height, deviceScaleFactor: width < 640 ? 2 : 1, isMobile: width < 640, hasTouch: width < 640 });
        await page.goto(local.url, { waitUntil: 'networkidle0' });
        await page.evaluate(() => { localStorage.setItem('crossfour.tutorial.v1', '1'); });
        await page.reload({ waitUntil: 'networkidle0' });
        await page.click(entry.kind === 'pass' ? '#btn-pass' : '#btn-vs-ai');
        await page.waitForSelector('#setup:not(.hidden)');
        await page.click('#presets button[data-p="4"]');
        await page.click('#mode-seg button[data-mode="' + entry.mode + '"]');
        if (entry.kind !== 'pass') {
          for (const seat of [0, 1, 2, 3]) await page.click('#seat-list button[data-seat="' + seat + '"][data-v="human"]');
        }
        const setup = await page.$eval('#btn-start', button => ({ disabled: button.disabled, message: document.getElementById('setup-msg').textContent }));
        assert.equal(setup.disabled, false, entry.label + ' setup must be startable: ' + setup.message);
        await page.click('#btn-start');
        await page.waitForSelector('#game:not(.hidden) #board', { timeout: 10000 });
        await page.waitForFunction(() => window.__cf && window.__cf.game && document.querySelector('#board').getBoundingClientRect().width > 100);
        await page.evaluate(() => {
          const theme = window.SKINS.BOARDS.find(board => board.id === 'graphite');
          window.__cf.save.board = theme.id;
          document.body.classList.toggle('light', !theme.dark);
          window.__cf.layout();
        });
        if (capture) await page.screenshot({ path: path.join(shotDir, capture), fullPage: false });

      const result = await page.evaluate(() => {
        const c = window.__cf, logic = c.logic, game = c.game;
        const canvas = document.getElementById('board'), context = canvas.getContext('2d');
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const point = (rowCol, dx, dy) => {
          const rc = logic.rot(rowCol, game.view || 0), unit = canvas.width / 15;
          const pixel = context.getImageData(Math.round((rc[1] + 0.5 + (dx || 0)) * unit), Math.round((rc[0] + 0.5 + (dy || 0)) * unit), 1, 1).data;
          return [pixel[0], pixel[1], pixel[2]];
        };
        const normalIndex = logic.TRACK_CELLS.findIndex((_, index) => logic.STAR_SQUARES.indexOf(index) < 0 && logic.START_SQUARES.indexOf(index) < 0);
        const starRowCol = logic.TRACK_CELLS[logic.STAR_SQUARES[0]];
        const normalRowCol = logic.TRACK_CELLS[normalIndex];
        const startColors = logic.START_SQUARES.map(index => point(logic.TRACK_CELLS[index], -0.3, -0.3));
        const homeColor = point(logic.HOME_COLS[0][0], 0, 0);
        const normalColor = point(normalRowCol, 0, 0);
        const boardRect = rect(document.getElementById('board-wrap'));
        const layerRects = ['board', 'tiles', 'pieces', 'fx'].map(id => rect(document.getElementById(id)));
        const pods = [...document.querySelectorAll('#game .pod:not(.empty)')].map(rect);
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const token = document.querySelector('#pieces .pc');
        const tokenBox = rect(token);
        const digit = document.querySelector('#pieces .gem-num');
        const badge = document.querySelector('#pieces .gem-num-disc');
        return {
          mode: game.st.mode,
          players: game.st.players.length,
          pieceCount: document.querySelectorAll('#pieces .pc').length,
          expectedPieceCount: game.st.pieces.reduce((sum, pieces) => sum + (pieces ? pieces.length : 0), 0),
          board: boardRect,
          canvas: [canvas.width, canvas.height],
          canvasKind: canvas.tagName,
          layersAligned: layerRects.every(r => Math.abs(r.left - boardRect.left) < 0.5 && Math.abs(r.top - boardRect.top) < 0.5 && Math.abs(r.width - boardRect.width) < 0.5 && Math.abs(r.height - boardRect.height) < 0.5),
          podOverlap: pods.some(pod => overlap(pod, boardRect)),
          podBounds: pods.every(pod => pod.left >= -1 && pod.top >= -1 && pod.right <= innerWidth + 1 && pod.bottom <= innerHeight + 1),
          noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
          chessHidden: document.getElementById('online-chess-screen').classList.contains('hidden'),
          safeContrast: point(starRowCol, 0, 0),
          normalTrack: point(normalRowCol, 0, 0),
          startColors,
          homeColor,
          tokenWidth: tokenBox.width,
          tokenHeight: tokenBox.height,
          cell: boardRect.width / 15,
          tokenNumberSize: parseFloat(getComputedStyle(digit).fontSize),
          tokenBadgeFill: getComputedStyle(badge).fill,
          hasMysteryTiles: document.querySelectorAll('#tiles .tile').length > 0,
          screenSize: [innerWidth, innerHeight]
        };
      });
        return result;
      } finally {
        await session.context.close();
      }
    }

    const entries = [
      { label: 'Classic', kind: 'ai', mode: 'classic' },
      { label: 'Mystery', kind: 'ai', mode: 'mystery' },
      { label: 'Lucky Chaos', kind: 'ai', mode: 'lucky' },
      { label: 'Quick', kind: 'ai', mode: 'quick' },
      { label: 'Team', kind: 'ai', mode: 'team' },
      { label: 'Arrow', kind: 'ai', mode: 'arrow' },
      { label: 'Friendly', kind: 'ai', mode: 'friendly' },
      { label: 'Pass & Play', kind: 'pass', mode: 'classic' }
    ];

    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      let reference = null;
      for (const entry of entries) {
        const capture = viewport.width === 390 && entry.mode === 'classic' && entry.kind === 'ai' ? 'ludo-board-mobile.png' : viewport.width === 1280 && entry.mode === 'arrow' ? 'ludo-board-desktop.png' : null;
        const board = await openMode(viewport.width, viewport.height, entry, capture);
        ok(board.mode === entry.mode, viewport.width + '×' + viewport.height + ': ' + entry.label + ' uses the shared Ludo canvas renderer');
        ok(board.canvasKind === 'CANVAS' && board.layersAligned, viewport.width + '×' + viewport.height + ': ' + entry.label + ' preserves the canvas/layer geometry');
        ok(board.players === 4 && board.pieceCount === board.expectedPieceCount, viewport.width + '×' + viewport.height + ': ' + entry.label + ' renders each configured token');
        ok(!board.podOverlap && board.podBounds && board.noDocumentOverflow, viewport.width + '×' + viewport.height + ': ' + entry.label + ' has no board/pod overlap or viewport overflow');
        ok(board.chessHidden, viewport.width + '×' + viewport.height + ': ' + entry.label + ' remains on Ludo, not the separate Chess board');
        ok(board.tokenWidth > board.cell * 0.75 && board.tokenWidth < board.cell * 0.77 && Math.abs(board.tokenWidth - board.tokenHeight) < 0.5, viewport.width + '×' + viewport.height + ': ' + entry.label + ' keeps the original token touch-target size');
        ok(board.tokenNumberSize >= 7 && /rgba\(8, 14, 22, 0\.72\)/.test(board.tokenBadgeFill), viewport.width + '×' + viewport.height + ': ' + entry.label + ' exposes the higher-contrast token identity badge');
        if (entry.mode === 'mystery' || entry.mode === 'lucky') ok(board.hasMysteryTiles, viewport.width + '×' + viewport.height + ': ' + entry.label + ' keeps tile effects in the separate overlay');
        if (!reference) reference = board;
        else {
          ok(Math.abs(board.board.width - reference.board.width) < 0.5 && Math.abs(board.board.height - reference.board.height) < 0.5, viewport.width + '×' + viewport.height + ': ' + entry.label + ' uses the same board geometry as Classic');
          ok(contrast(board.safeContrast, board.normalTrack) >= 2.2, viewport.width + '×' + viewport.height + ': ' + entry.label + ' keeps safe-space markings distinct from ordinary track');
        }
        if (entry.mode === 'classic' && entry.kind === 'ai') {
          const uniqueStartColors = board.startColors.every((color, index) => board.startColors.slice(index + 1).every(other => Math.hypot(color[0] - other[0], color[1] - other[1], color[2] - other[2]) > 25));
          ok(uniqueStartColors, viewport.width + '×' + viewport.height + ': all four player entry colors remain visually distinct');
          ok(Math.hypot(board.homeColor[0] - board.normalTrack[0], board.homeColor[1] - board.normalTrack[1], board.homeColor[2] - board.normalTrack[2]) > 30, viewport.width + '×' + viewport.height + ': the home lane remains distinct from the main track');
        }
      }
    }

    // Check safe-star contrast on every shipped palette, including light cells on dark-page skins.
    const paletteSession = await newIsolatedPage(), page = paletteSession.page;
    try {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(local.url, { waitUntil: 'networkidle0' });
      await page.evaluate(() => { localStorage.setItem('crossfour.tutorial.v1', '1'); });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)');
      await page.click('#presets button[data-p="4"]');
      for (const seat of [0, 1, 2, 3]) await page.click('#seat-list button[data-seat="' + seat + '"][data-v="human"]');
      await page.click('#btn-start'); await page.waitForSelector('#game:not(.hidden) #board');
      const themeIds = await page.evaluate(() => window.SKINS.BOARDS.map(board => board.id));
      for (const themeId of themeIds) {
        await page.evaluate(id => {
          const theme = window.SKINS.BOARDS.find(board => board.id === id);
          window.__cf.save.board = id;
          document.body.classList.toggle('light', !theme.dark);
          window.__cf.layout();
        }, themeId);
        const colors = await page.evaluate(() => {
          const c = window.__cf, L = c.logic, cv = document.getElementById('board'), ctx = cv.getContext('2d');
          const rc = L.rot(L.TRACK_CELLS[L.STAR_SQUARES[0]], c.game.view || 0), unit = cv.width / 15;
          const star = ctx.getImageData(Math.round((rc[1] + 0.5) * unit), Math.round((rc[0] + 0.5) * unit), 1, 1).data;
          const normalIndex = L.TRACK_CELLS.findIndex((_, index) => L.STAR_SQUARES.indexOf(index) < 0 && L.START_SQUARES.indexOf(index) < 0);
          const nr = L.rot(L.TRACK_CELLS[normalIndex], c.game.view || 0), base = ctx.getImageData(Math.round((nr[1] + 0.5) * unit), Math.round((nr[0] + 0.5) * unit), 1, 1).data;
          return { star: [star[0], star[1], star[2]], base: [base[0], base[1], base[2]] };
        });
        ok(contrast(colors.star, colors.base) >= 2.2, 'safe spaces contrast on the ' + themeId + ' board palette');
      }
      const localBoard = await page.$eval('#board-wrap', element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; });
      await page.evaluate(() => {
        const L = window.__cf.logic, deadline = Date.now() + 45000;
        window.__cf.presentOnline({
          state: {
            protocol: 1, mode: 'classic', players: [0, 2],
            pieces: [[4, -1, -1, -1], null, [10, -1, -1, -1], null],
            turn: 0, phase: 'move', queue: [3], sixes: 0, bonus: 0, ranking: [],
            rules: Object.assign({}, L.DEFAULT_RULES), capd: [false, false, false, false],
            faces: [6, 1, 4, 1], turn_count: 1, turn_deadline: deadline,
            grace: { seat: 2, until: Date.now() + 20000 }
          },
          mySeat: 0,
          names: { 0: 'You', 2: 'Rival' },
          onMove: function () {}, onRoll: function () {}, onExpire: function () {}
        });
      });
      await page.waitForFunction(() => window.__cf && window.__cf.game && window.__cf.game.online && !document.getElementById('game').classList.contains('hidden'));
      const onlineBoard = await page.evaluate(() => {
        const rect = document.getElementById('board-wrap').getBoundingClientRect();
        return {
          canvas: document.getElementById('board').tagName,
          width: rect.width,
          height: rect.height,
          tokens: document.querySelectorAll('#pieces .pc').length,
          chessHidden: document.getElementById('online-chess-screen').classList.contains('hidden')
        };
      });
      ok(onlineBoard.canvas === 'CANVAS' && onlineBoard.tokens === 8 && onlineBoard.chessHidden, 'online Classic uses the same Ludo canvas, not the separate Chess board');
      ok(Math.abs(onlineBoard.width - localBoard.width) < 0.5 && Math.abs(onlineBoard.height - localBoard.height) < 0.5, 'online Classic preserves the local shared-board geometry');
    } finally {
      await paletteSession.context.close();
    }
    assert.deepEqual(errors, [], 'browser JavaScript and console errors');
    ok(externalRequests.length === 0, 'browser regression stays local and makes no external requests');
    console.log('\n' + checks + ' shared-board browser checks passed. Previews: ' + shotDir);
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
