// v1.6.5: How to play placement on home — browser layout checks + before/after ship screenshots.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots node test/v165-howto.browser.test.js
// "Before" is the v1.6.4 tag (git archive) unless BEFORE_WWW points at another www/ folder.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { execSync } = require('node:child_process');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const repo = path.resolve(__dirname, '..');
const afterRoot = path.join(repo, 'www');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function ok(c, m) { if (!c) throw new Error('FAILED: ' + m); checks++; console.log('  ok -', m); }

function beforeRoot() {
  if (process.env.BEFORE_WWW) return path.resolve(process.env.BEFORE_WWW);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-v164-'));
  execSync('git archive v1.6.4 www | tar -x -C ' + JSON.stringify(dir), { cwd: repo, stdio: 'pipe' });
  return path.join(dir, 'www');
}
function serve(root) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.startsWith('/__shots/')) { const f = path.join(shotDir, path.basename(p)); return fs.readFile(f, (e, d) => e ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': 'image/png' }).end(d)); }
      const file = path.resolve(root, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
      if (!file.startsWith(root)) return res.writeHead(403).end();
      fs.readFile(file, (e, d) => { if (e) return res.writeHead(404).end(); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(d); });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

async function openHome(page, url, theme) {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(t => {
    localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1');
    const s = window.__cf.save; s.board = t; s.xp = 340; s.coins = 1250;
    if (s.owned.boards.indexOf(t) < 0) s.owned.boards.push(t);
    window.__cf.persist();
  }, theme);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#home:not(.hidden)');
  await sleep(350);
}

// Live geometry + contrast of the home mode group.
const measure = () => {
  const parse = s => s.match(/[\d.]+/g).map(Number).slice(0, 3);
  const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const A = lum(parse(a)), B = lum(parse(b)); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const probe = document.createElement('i'); probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--page').trim(); document.body.appendChild(probe);
  const pageRgb = getComputedStyle(probe).color; probe.remove();
  const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  const cards = ['btn-vs-ai', 'btn-lucky', 'btn-mystery', 'btn-pass'].map(r);
  const grid = document.querySelector('#home .mode-grid').getBoundingClientRect();
  const row = document.querySelector('#home .home-row').getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(document.querySelector('#home .home-actions')).rowGap);
  const title = document.querySelector('.howto-open-copy b'), sub = document.querySelector('.howto-open-copy small');
  return {
    light: document.body.classList.contains('light'),
    rowW: cards[1].r - cards[0].l, rowL: cards[0].l,
    cardsBottom: Math.max(cards[2].b, cards[3].b),
    grid: { l: grid.left, w: grid.width, t: grid.top, b: grid.bottom },
    howto: r('howto-card'), utilTop: row.top, gap,
    titleRatio: title ? ratio(getComputedStyle(title).color, pageRgb) : 0,
    subRatio: sub ? ratio(getComputedStyle(sub).color, pageRgb) : 0,
    expanded: document.getElementById('btn-howto-home').getAttribute('aria-expanded'),
    panelOpen: !document.getElementById('howto-panel').classList.contains('hidden'),
    rows: document.querySelectorAll('#howto-card tbody tr').length,
    vh: innerHeight, scrollW: document.documentElement.scrollWidth, vw: innerWidth
  };
};

async function compose(browser, url, name, pairs, title) {
  const page = await browser.newPage();
  await page.setViewport({ width: 860, height: 200, deviceScaleFactor: 1 });
  const cols = pairs.map(([label, file]) => `<figure style="margin:0;flex:1"><figcaption style="padding:0 0 6px">${label}</figcaption><img style="width:100%;border-radius:10px;display:block" src="${url}__shots/${path.basename(file)}"></figure>`).join('');
  await page.setContent(`<html><body style="margin:0;background:#20242c;font:600 15px system-ui;color:#eef1f5">
    <div style="padding:12px 16px 4px">${title}</div><div style="display:flex;gap:16px;padding:8px 16px 16px">${cols}</div></body></html>`, { waitUntil: 'load' });
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth));
  const file = path.join(shotDir, name);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

let local, before;
(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  local = await serve(afterRoot);
  before = await serve(beforeRoot());
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shots = [];
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const shot = async name => { const f = path.join(shotDir, name); await page.screenshot({ path: f }); shots.push(f); return f; };
    const focusModes = async () => { await page.evaluate(() => document.querySelector('#howto-card').scrollIntoView({ block: 'end' })); await sleep(250); };

    // ---- layout checks on common phone sizes, dark (Graphite) + light (Linen)
    for (const [w, h] of [[320, 568], [360, 740], [390, 844], [412, 915]]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      for (const theme of ['graphite', 'linen']) {
        await openHome(page, local.url, theme);
        const m = await page.evaluate(measure);
        const tag = `${w}×${h} ${theme}`;
        ok(Math.abs(m.howto.w - m.rowW) < 1.5 && Math.abs(m.howto.l - m.rowL) < 1.5, `${tag}: How to play spans the mode-card grid exactly (${m.howto.w.toFixed(0)} = ${m.rowW.toFixed(0)}px)`);
        ok(Math.abs(m.grid.w - m.rowW) < 1.5 && Math.abs(m.grid.l - m.rowL) < 1.5, `${tag}: quick-mode grid is full width too (no half-empty row)`);
        ok(m.howto.h >= 44 && m.howto.h <= 64, `${tag}: collapsed How to play is a compact row (${m.howto.h.toFixed(0)}px, was a 2-card-tall box)`);
        ok(Math.abs(m.grid.t - m.cardsBottom - m.gap) < 1.5 && Math.abs(m.howto.t - m.grid.b - m.gap) < 1.5, `${tag}: cards → quick modes → How to play keep the same ${m.gap}px rhythm`);
        ok(m.utilTop >= m.howto.b, `${tag}: Skins / Rules / Settings stay below the mode group`);
        ok(m.titleRatio >= 4.5 && m.subRatio >= 4.5, `${tag}: label ${m.titleRatio.toFixed(2)} / subtitle ${m.subRatio.toFixed(2)} >= 4.5:1`);
        ok(m.scrollW <= m.vw, `${tag}: no horizontal overflow`);
        ok(theme === 'linen' ? m.light : !m.light, `${tag}: ${theme === 'linen' ? 'light' : 'dark'} chrome active`);
      }
    }

    // ---- open/close behaviour (390×844, both themes)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    for (const theme of ['graphite', 'linen']) {
      await openHome(page, local.url, theme);
      await page.click('#btn-howto-home'); await sleep(500);
      const m = await page.evaluate(measure);
      ok(m.expanded === 'true' && m.panelOpen && m.rows === 11, `${theme}: tap opens Rule | Kaise (11 rows), aria-expanded=true`);
      ok(m.howto.h > 200 && m.howto.h < m.vh * 0.62, `${theme}: opened card is bounded (${m.howto.h.toFixed(0)}px), table scrolls inside`);
      ok(m.howto.b <= m.vh + 1, `${theme}: opened card is scrolled into view`);
      await page.click('#btn-howto-home'); await sleep(200);
      const c = await page.evaluate(measure);
      ok(c.expanded === 'false' && !c.panelOpen && c.howto.h <= 64, `${theme}: second tap collapses back to the compact row`);
    }

    // ---- ship screenshots (390×844 phone)
    for (const theme of ['graphite', 'linen']) {
      const t = theme === 'graphite' ? 'dark' : 'light';
      await openHome(page, before.url, theme); await shot(`v165-howto-${t}-home-before.png`);
      await focusModes(); await shot(`v165-howto-${t}-modes-before.png`);
      await openHome(page, local.url, theme); await shot(`v165-howto-${t}-home-after.png`);
      await focusModes(); await shot(`v165-howto-${t}-modes-after.png`);
      await page.click('#btn-howto-home'); await sleep(600); await shot(`v165-howto-${t}-open-after.png`);
    }
    // Other skins (after only): Frost (light), Classic Wood (cream on walnut), Midnight (dark)
    for (const theme of ['frost', 'timber', 'midnight']) {
      await openHome(page, local.url, theme); await focusModes(); await shot(`v165-howto-${theme}-modes-after.png`);
    }
    // Small phone 360×740
    await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await openHome(page, local.url, 'graphite'); await focusModes(); await shot('v165-howto-dark-360-after.png');

    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

    const p = n => path.join(shotDir, n);
    shots.push(await compose(browser, local.url, 'v165-howto-dark-compare.png', [['Before · v1.6.4', p('v165-howto-dark-modes-before.png')], ['After · v1.6.5', p('v165-howto-dark-modes-after.png')], ['After · opened', p('v165-howto-dark-open-after.png')]], 'Home · How to play placement · dark (Graphite)'));
    shots.push(await compose(browser, local.url, 'v165-howto-light-compare.png', [['Before · v1.6.4', p('v165-howto-light-modes-before.png')], ['After · v1.6.5', p('v165-howto-light-modes-after.png')], ['After · opened', p('v165-howto-light-open-after.png')]], 'Home · How to play placement · light (Linen)'));
    shots.push(await compose(browser, local.url, 'v165-howto-home-compare.png', [['Dark · before', p('v165-howto-dark-home-before.png')], ['Dark · after', p('v165-howto-dark-home-after.png')], ['Light · before', p('v165-howto-light-home-before.png')], ['Light · after', p('v165-howto-light-home-after.png')]], 'Home · first screen'));
    console.log(checks + ' v1.6.5 How to play browser checks passed');
    console.log(shots.map(s => '  ' + s).join('\n'));
  } finally {
    await browser.close(); before.server.close(); local.server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
