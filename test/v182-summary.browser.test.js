// v1.8.1 Daily reward + challenge — screenshots + DOM checks.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots npm run test:v180
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


(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [];
  try {
    let page;
    const shot = async name => { const out = path.join(shotDir, (process.env.SHOT_PREFIX || 'v182-') + name + '.png'); await page.screenshot({ path: out }); ok(fs.statSync(out).size > 8000, 'screenshot ' + path.basename(out)); };
    const setup = async board => {
      if (page) await page.close();
      const ctx = await browser.createBrowserContext(); page = await ctx.newPage();
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.evaluate(b => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); }, board);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate(b => { const c = window.__cf, s = c.save; s.stats.won = 2; s.stats.captures = 9; s.coins = 400; if (b) { s.board = b; if (s.owned.boards.indexOf(b) < 0) s.owned.boards.push(b); }
        s.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; c.persist(); }, board);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#home:not(.hidden)');
      await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await page.click('#btn-start'); await sleep(150);
      if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
      await page.waitForSelector('#game:not(.hidden)');
      await page.evaluate(() => { const t = window.__cf.game.tally; t.capture = 2; t.six = 3; t.arrow = 1; });
      await page.evaluate(() => window.__cf.edit(st => { const h = st.players.find(x => st.seats[x].type === 'human'); st.pieces[h] = Array(st.nPieces || 4).fill(window.__cf.logic.HOME); st.phase = 'over'; st.ranking = [h].concat(st.players.filter(x => x !== h)); }));
      await page.waitForSelector('#result:not(.hidden)'); await sleep(1400);
    };
    for (const board of [null, 'linen']) {
      await setup(board);
      const r = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#r-summary .r-chip b')].map(b => +b.textContent), unlock: [...document.querySelectorAll('.r-unlock')].map(e => e.textContent).join(' | '),
        goal: document.querySelector('.r-goal') && document.querySelector('.r-goal').textContent, daily: !!document.getElementById('btn-r-daily'), light: document.body.classList.contains('light'),
        fit: document.querySelector('#result .panel').scrollWidth <= document.querySelector('#result .panel').clientWidth + 1 }));
      ok(r.chips.join() === '2,3,1,0', String(board) + ': summary chips show match tally ' + r.chips);
      ok(/Ruby/.test(r.unlock || ''), board + ': 3rd win unlock shown (' + r.unlock + ')');
      ok(/Emerald/.test(r.goal || ''), board + ': next skin goal shown (' + r.goal + ')');
      ok(r.daily && r.fit, board + ': daily row present, no overflow');
      await page.evaluate(() => document.querySelector('#r-progress').scrollIntoView({ block: 'center' }));
      await shot('result-' + (r.light ? 'light' : 'dark'));
      if (r.light) {
        await page.click('#btn-r-daily'); await sleep(400); await shot('daily-light');
        ok(await page.evaluate(() => getComputedStyle(document.querySelector('.dcell')).color) !== 'rgb(255, 255, 255)', 'light daily cells use dark text');
        await page.evaluate(() => document.querySelector('[data-close="daily"]').click()); await sleep(250);
        await page.evaluate(() => { document.getElementById('result').classList.add('hidden'); window.__cf.openVault(); }); await sleep(400); await shot('vault-light');
        ok(await page.evaluate(() => document.querySelectorAll('.vault-mastery .m-stars').length === 2 && document.querySelectorAll('.vault-row')[0].querySelectorAll('.m-stars i.on').length === 1), 'vault shows mastery stars; Classic Bronze after a win');
      }
    }
    ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
    console.log('v182 browser checks:', checks);
  } finally { await browser.close(); local.server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
