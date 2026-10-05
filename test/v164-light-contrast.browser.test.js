// v1.6.4: light-theme contrast — browser checks + before/after ship screenshots.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots node test/v164-light-contrast.browser.test.js
// "Before" is the v1.6.3 tag (git archive) unless BEFORE_WWW points at another www/ folder.
'use strict';
const assert = require('node:assert/strict');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-v163-'));
  execSync('git archive v1.6.3 www | tar -x -C ' + JSON.stringify(dir), { cwd: repo, stdio: 'pipe' });
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
  return page.evaluate(contrastFn); // also installs window.__ratio for later probes
}

// Contrast of an element's text colour against the page colour, measured in the live DOM.
const contrastFn = () => {
  const parse = s => { const m = s.match(/[\d.]+/g).map(Number); return m.slice(0, 3); };
  const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  window.__ratio = (a, b) => { const A = lum(parse(a)), B = lum(parse(b)); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  const probe = document.createElement('i'); probe.style.color = page; document.body.appendChild(probe);
  const pageRgb = getComputedStyle(probe).color; probe.remove();
  const q = sel => getComputedStyle(document.querySelector(sel));
  return {
    light: document.body.classList.contains('light'),
    subtitle: window.__ratio(q('#mode-computer-subtitle').color, pageRgb),
    tag: window.__ratio(q('.logo .tag').color, pageRgb),
    chessSub: window.__ratio(q('.home-chess-launch-copy small').color, pageRgb),
    icon: Math.min.apply(null, ['.mode-computer', '.mode-lucky', '.mode-mystery', '.mode-pass'].map(s => window.__ratio(q(s + ' .mode-card-icon').color, 'rgb(255,255,255)'))),
    xpFill: window.__ratio(q('#lvl-fill').backgroundColor === 'rgba(0, 0, 0, 0)' ? q('.lvl-badge').backgroundColor : q('#lvl-fill').backgroundColor, pageRgb),
    howto: window.__ratio(q('.howto-open').color, 'rgb(255,255,255)'),
    quickSmall: window.__ratio(q('#btn-quick small').color, 'rgb(255,255,255)')
  };
};

async function compose(browser, name, pairs, title) {
  const page = await browser.newPage();
  await page.setViewport({ width: 860, height: 960, deviceScaleFactor: 1 });
  const cols = pairs.map(([label, file]) => `<figure><figcaption>${label}</figcaption><img src="${local.url}__shots/${path.basename(file)}"></figure>`).join('');
  await page.setContent(`<html><body style="margin:0;background:#20242c;font:600 15px system-ui;color:#eef1f5">
    <div style="padding:12px 16px 4px">${title}</div><div style="display:flex;gap:16px;padding:8px 16px 16px">${cols}</div>
    <style>figure{margin:0;flex:1}figcaption{padding:4px 0 8px;color:#c9d2de}img{width:100%;border-radius:14px;box-shadow:0 6px 18px rgba(0,0,0,.4)}</style></body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  const out = path.join(shotDir, name);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  ok(fs.statSync(out).size > 30000, 'screenshot ' + name);
  return out;
}

let local;
(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const before = await serve(beforeRoot());
  local = await serve(afterRoot);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shots = [];
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const shot = async name => { const f = path.join(shotDir, name); await page.screenshot({ path: f }); shots.push(f); return f; };
    const scrollBottom = async () => { await page.evaluate(() => document.querySelector('#btn-online').scrollIntoView({ block: 'end' })); await sleep(200); };

    // ---- before (v1.6.3) vs after (v1.6.4) on light skins
    const measured = {};
    for (const theme of ['linen', 'frost', 'desert', 'timber']) {
      await openHome(page, before.url, theme);
      const b = await page.evaluate(contrastFn);
      await shot(`v164-light-${theme}-home-before.png`);
      if (theme === 'linen') { await scrollBottom(); await shot('v164-light-linen-home-bottom-before.png'); }
      await openHome(page, local.url, theme);
      const a = await page.evaluate(contrastFn);
      await shot(`v164-light-${theme}-home-after.png`);
      if (theme === 'linen') { await scrollBottom(); await shot('v164-light-linen-home-bottom-after.png'); }
      measured[theme] = { b, a };
      console.log(`  ${theme}: subtitle ${b.subtitle.toFixed(2)} -> ${a.subtitle.toFixed(2)}, chess subtitle ${b.chessSub.toFixed(2)} -> ${a.chessSub.toFixed(2)}, icons ${b.icon.toFixed(2)} -> ${a.icon.toFixed(2)}, tag ${b.tag.toFixed(2)} -> ${a.tag.toFixed(2)}`);
    }
    for (const theme of ['linen', 'frost', 'desert']) {
      const { b, a } = measured[theme];
      ok(a.light, theme + ' uses light chrome');
      ok(a.subtitle >= 4.5 && a.subtitle > b.subtitle, `${theme} card subtitle contrast ${a.subtitle.toFixed(2)} >= 4.5 (was ${b.subtitle.toFixed(2)})`);
      ok(a.chessSub >= 4.5 && a.chessSub > b.chessSub, `${theme} Ludo Chess subtitle ${a.chessSub.toFixed(2)} >= 4.5 (was ${b.chessSub.toFixed(2)})`);
      ok(a.tag >= 4.5, `${theme} tagline ${a.tag.toFixed(2)} >= 4.5`);
      ok(a.icon >= 3 && a.icon > b.icon, `${theme} card icons ${a.icon.toFixed(2)} >= 3:1 (was ${b.icon.toFixed(2)})`);
      ok(a.howto >= 4.5, `${theme} How to play label ${a.howto.toFixed(2)} >= 4.5`);
      ok(a.quickSmall >= 4.5, `${theme} quick-mode subtitles ${a.quickSmall.toFixed(2)} >= 4.5`);
      ok(a.xpFill >= 3, `${theme} XP bar fill vs page ${a.xpFill.toFixed(2)} >= 3`);
    }
    ok(!measured.timber.a.light && measured.timber.a.tag >= 4.5 && measured.timber.a.tag > measured.timber.b.tag * 2,
      `Classic Wood tagline ${measured.timber.b.tag.toFixed(2)} -> ${measured.timber.a.tag.toFixed(2)} (cream on walnut)`);

    // ---- dark skins untouched: graphite home renders identically before/after (before any match is saved)
    await openHome(page, before.url, 'graphite'); const gb = await page.screenshot({ encoding: 'base64' });
    await openHome(page, local.url, 'graphite'); const ga = await page.screenshot({ encoding: 'base64' });
    ok(gb === ga, 'Graphite (dark) home is pixel-identical to v1.6.3');
    await shot('v164-light-graphite-home-after.png');
    // ---- after: How to play open, setup, online, settings, in-game (linen)
    await openHome(page, local.url, 'linen');
    await page.click('#btn-howto-home'); await sleep(250);
    await page.evaluate(() => document.querySelector('#howto-card').scrollIntoView({ block: 'center' })); await sleep(150);
    await shot('v164-light-linen-howto-after.png');
    await openHome(page, before.url, 'linen');
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await sleep(300);
    await shot('v164-light-linen-setup-before.png');
    await openHome(page, local.url, 'linen');
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)'); await sleep(300);
    const pressed = await page.evaluate(() => { const b = document.querySelector('.presets button[aria-pressed="true"]'); return b ? window.__ratio(getComputedStyle(b).color, 'rgb(255,255,255)') : 99; });
    ok(pressed >= 4.5, `selected player-count label ${pressed.toFixed(2)} >= 4.5`);
    await shot('v164-light-linen-setup-after.png');
    await openHome(page, before.url, 'linen');
    await page.click('#btn-online'); await sleep(500); await shot('v164-light-linen-online-before.png');
    await openHome(page, local.url, 'linen');
    await page.click('#btn-online'); await sleep(500);
    const eyebrow = await page.evaluate(() => { const e = document.querySelector('.online-eyebrow'); return e ? window.__ratio(getComputedStyle(e).color, 'rgb(255,255,255)') : 99; });
    ok(eyebrow >= 4.5, `online eyebrow ${eyebrow.toFixed(2)} >= 4.5`);
    await shot('v164-light-linen-online-after.png');
    await openHome(page, local.url, 'linen');
    await page.click('#btn-settings'); await sleep(350);
    const segOn = await page.evaluate(() => { const b = document.querySelector('#settings .seg button.on'); return b ? window.__ratio(getComputedStyle(b).color, getComputedStyle(b).backgroundColor) : 99; });
    ok(segOn >= 7, `selected segment keeps inverted colours (${segOn.toFixed(2)})`);
    await shot('v164-light-linen-settings-after.png');
    await openHome(page, local.url, 'linen');
    await page.click('#btn-vs-ai'); await page.waitForSelector('#setup:not(.hidden)');
    await page.evaluate(() => { window.__cf.save.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, { type: 'ai', level: 'easy' }, { type: 'ai', level: 'easy' }]; window.__cf.persist(); });
    await page.click('#btn-start'); await page.waitForSelector('#game:not(.hidden) #board'); await sleep(900);
    await shot('v164-light-linen-game-after.png');

    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

    // ---- side-by-side comparisons
    const p = n => path.join(shotDir, n);
    shots.push(await compose(browser, 'v164-light-home-compare.png', [['Before · v1.6.3 (Linen)', p('v164-light-linen-home-before.png')], ['After · v1.6.4 (Linen)', p('v164-light-linen-home-after.png')]], 'Home · light theme contrast'));
    shots.push(await compose(browser, 'v164-light-home-bottom-compare.png', [['Before · v1.6.3', p('v164-light-linen-home-bottom-before.png')], ['After · v1.6.4', p('v164-light-linen-home-bottom-after.png')]], 'Home (scrolled) · How to play, quick modes, secondary buttons'));
    shots.push(await compose(browser, 'v164-light-setup-compare.png', [['Before · v1.6.3', p('v164-light-linen-setup-before.png')], ['After · v1.6.4', p('v164-light-linen-setup-after.png')]], 'Setup · mode/players segments, seat options, rule chips'));
    shots.push(await compose(browser, 'v164-light-online-compare.png', [['Before · v1.6.3', p('v164-light-linen-online-before.png')], ['After · v1.6.4', p('v164-light-linen-online-after.png')]], 'Online rooms · links, eyebrows, inputs, cards'));
    shots.push(await compose(browser, 'v164-light-skins-compare.png', [['Frost · before', p('v164-light-frost-home-before.png')], ['Frost · after', p('v164-light-frost-home-after.png')], ['Desert · before', p('v164-light-desert-home-before.png')], ['Desert · after', p('v164-light-desert-home-after.png')]], 'Other light skins'));
    shots.push(await compose(browser, 'v164-light-timber-compare.png', [['Classic Wood · before', p('v164-light-timber-home-before.png')], ['Classic Wood · after', p('v164-light-timber-home-after.png')]], 'Classic Wood (light board on walnut page) · cream chrome text'));
    console.log(checks + ' v1.6.4 light-contrast browser checks passed');
    console.log(shots.map(s => '  ' + s).join('\n'));
  } finally {
    await browser.close(); before.server.close(); local.server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
