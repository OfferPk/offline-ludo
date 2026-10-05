// v1.7.2 Tall pawn tokens — board/material/evolution screenshots + DOM checks.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots npm run test:tall
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function ok(c, m) { if (!c) throw new Error('FAILED: ' + m); checks++; console.log('  ok -', m); }

function startLocalServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(webRoot, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

const LEVEL_NAMES = ['basic', 'polished', 'elite', 'mythic', 'legendary'];

(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const local = await startLocalServer();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const shots = [];
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    async function shot(name) {
      const out = path.join(shotDir, 'v172-tall-' + name + '.png');
      await page.screenshot({ path: out, fullPage: false });
      ok(fs.statSync(out).size > 10000, 'screenshot ' + path.basename(out));
      shots.push(out);
    }

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    // Unlock all levels via coins path for preview shots
    await page.evaluate(() => {
      const s = window.__cf.save;
      s.coins = 10000;
      s.stats.won = 100;
      s.tokenEvoUnlocked = 1;
      s.tokenEvo = 1;
      window.TokenEvolution.collectEligible(s);
      window.__cf.persist();
    });

    await page.click('#btn-skins');
    await page.waitForSelector('#skins:not(.hidden)');
    await page.click('#skin-tabs [data-tab="tokens"]');
    await sleep(200);
    const evoCards = await page.$$eval('#skin-grid .evo-card', els => els.length);
    ok(evoCards === 5, '5 evolution cards in Skins → Tokens');
    await shot('skins-tokens');

    await page.click('#skins .close');
    await sleep(100);

    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    await page.evaluate(() => {
      window.__cf.save.setup.ai = [
        { type: 'human' },
        { type: 'ai', level: 'easy' },
        { type: 'ai', level: 'easy' },
        { type: 'ai', level: 'easy' }
      ];
      window.__cf.save.setup.mode.ai = 'classic';
      window.__cf.save.board = 'midnight';
      window.__cf.persist();
    });
    await page.click('#btn-start');
    await sleep(150);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) {
      await page.click('#confirm-yes');
    }
    await page.waitForSelector('#game:not(.hidden) #board');
    await sleep(250);

    for (let lv = 1; lv <= 5; lv++) {
      await page.evaluate(level => {
        window.__cf.save.tokenEvo = level;
        window.__cf.save.tokenEvoUnlocked = 5;
        window.__cf.persist();
        window.__cf.edit(st => {
          st.phase = 'move';
          st.turn = 0;
          st.queue = [4];
          st.sixes = 0;
          st.bonus = 0;
          st.rollAgain = false;
          st.pieces[0] = [0, 8, 16, 24];
          st.pieces[1] = [0, 6, 14, -1];
          st.pieces[2] = [2, 10, -1, -1];
          st.pieces[3] = [4, 12, 20, -1];
        });
      }, lv);
      await sleep(200);

      const probe = await page.evaluate(() => {
        const humans = [...document.querySelectorAll('.pc[data-seat="0"]')];
        const ai = [...document.querySelectorAll('.pc[data-seat="1"]')];
        return {
          humanEvo: humans.map(e => e.dataset.evo),
          aiEvo: ai.map(e => e.dataset.evo),
          badge: !!document.querySelector('.pc[data-seat="0"] .evo-badge'),
          gloss: getComputedStyle(humans[0]).getPropertyValue('--evo-gloss').trim()
        };
      });
      ok(probe.humanEvo.every(e => e === String(lv)), 'human tokens data-evo=' + lv);
      const shape = await page.evaluate(() => {
        const svg = document.querySelector('.pc[data-seat="0"] .gem-token');
        const body = svg && svg.querySelector('.gem-body');
        const rim = svg && svg.querySelector('.gem-rim-outer');
        const collar = svg && svg.querySelector('.gem-collar');
        return {
          vb: svg ? svg.getAttribute('viewBox') : null,
          bodyTag: body ? body.tagName.toLowerCase() : null,
          rimTag: rim ? rim.tagName.toLowerCase() : null,
          hasCollar: !!collar,
          hasPathD: !!(body && body.getAttribute('d'))
        };
      });
      ok(shape.vb === '0 0 24 36', 'viewBox tall 24x36 at Lv' + lv);
      ok(shape.bodyTag === 'path' && shape.rimTag === 'path' && shape.hasPathD, 'path silhouette (not circle) at Lv' + lv);
      ok(shape.hasCollar, 'collar present at Lv' + lv);
      ok(probe.aiEvo.every(e => e === '1'), 'AI tokens stay Basic at Lv' + lv);
      if (lv >= 4) ok(probe.badge, 'badge present at Lv' + lv);
      else ok(!probe.badge, 'no badge below Mythic at Lv' + lv);

      // Select a human token for clearer crop
      await page.evaluate(() => {
        document.querySelectorAll('.pc.sel,.pc.can,.pc.is-turn').forEach(e => e.classList.remove('sel', 'can', 'is-turn'));
        const el = document.querySelector('.pc[data-seat="0"][data-piece="1"]');
        if (el) el.classList.add('sel', 'is-turn');
      });
      await sleep(80);

      const box = await page.evaluate(() => {
        const board = document.getElementById('board-wrap').getBoundingClientRect();
        return {
          x: Math.max(0, board.x),
          y: Math.max(0, board.y),
          width: Math.min(board.width, 390),
          height: Math.min(board.height, 520)
        };
      });
      const name = LEVEL_NAMES[lv - 1];
      const out = path.join(shotDir, 'v172-tall-' + name + '.png');
      await page.screenshot({ path: out, clip: box });
      ok(fs.statSync(out).size > 8000, 'level shot ' + path.basename(out));
      shots.push(out);
    }

    // Full match board at Legendary
    await shot('legendary-full');
    // Per-color materials on board (rename alias shots)
    await page.evaluate(() => {
      window.__cf.save.tokenEvo = 3;
      window.__cf.persist();
      window.__cf.edit(st => {
        st.phase = 'move'; st.turn = 0; st.queue = [5];
        st.pieces[0] = [0, 8, 16, 24];
        st.pieces[1] = [4, 12, 20, 28];
        st.pieces[2] = [2, 10, 18, 26];
        st.pieces[3] = [6, 14, 22, 30];
      });
    });
    await sleep(220);
    await shot('board-mix');
    await shot('yard-pawns');

    ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
    console.log('v172 tall-pawn browser checks passed (' + checks + ' checks).');
    console.log('shots:', shots.map(s => path.basename(s)).join(', '));
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
