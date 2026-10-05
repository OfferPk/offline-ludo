// v1.7.0 Phase 1: circular hero token screenshots + DOM/material checks.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots npm run test:hero
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
      const out = path.join(shotDir, 'v170-token-' + name + '.png');
      await page.screenshot({ path: out, fullPage: false });
      ok(fs.statSync(out).size > 12000, 'screenshot ' + path.basename(out));
      shots.push(out);
    }

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

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
    await sleep(300);

    // Spread tokens on board for clear hero-token shots
    await page.evaluate(() => {
      window.__cf.edit(st => {
        st.phase = 'move';
        st.turn = 0;
        st.queue = [4];
        st.sixes = 0;
        st.bonus = 0;
        st.rollAgain = false;
        // seat 0 Coral on track, 1 Jade, 2 Saffron, 3 Cobalt — mix yard + track
        st.pieces[0] = [0, 8, 16, 24];
        st.pieces[1] = [0, 6, 14, -1];
        st.pieces[2] = [2, 10, -1, -1];
        st.pieces[3] = [4, 12, 20, -1];
      });
    });
    await sleep(250);

    const probe = await page.evaluate(() => {
      const pcs = [...document.querySelectorAll('#pieces .pc')];
      const bySeat = {};
      for (const el of pcs) {
        const s = el.dataset.seat;
        const svg = el.querySelector('.gem-token');
        const body = svg && svg.querySelector('.gem-body');
        bySeat[s] = bySeat[s] || {
          mat: el.dataset.mat,
          evo: el.dataset.evo,
          rim: !!(svg && svg.querySelector('.gem-rim-outer')),
          circle: body && body.tagName === 'circle',
          r: body && body.getAttribute('r'),
          num: el.querySelector('.gem-num') && el.querySelector('.gem-num').textContent,
          emboss: !!(el.querySelector('.gem-num-hi') && el.querySelector('.gem-num-shadow')),
          jugnu: !!el.querySelector('.jugnu'),
          rim0: getComputedStyle(el).getPropertyValue('--pcrim0').trim(),
          glass: getComputedStyle(el).getPropertyValue('--pcglassMid').trim()
        };
      }
      return {
        count: pcs.length,
        mats: Object.fromEntries(Object.entries(bySeat).map(([k, v]) => [k, v.mat])),
        sample: bySeat['0'],
        allCircular: Object.values(bySeat).every(v => v.circle && Number(v.r) >= 7 && v.rim && v.emboss && v.jugnu),
        allEvo1: Object.values(bySeat).every(v => v.evo === '1')
      };
    });
    ok(probe.count === 16, '16 tokens on 4-player board');
    ok(probe.mats['0'] === 'ruby' && probe.mats['1'] === 'emerald' && probe.mats['2'] === 'gold' && probe.mats['3'] === 'sapphire', 'per-seat materials');
    ok(probe.allCircular && probe.allEvo1, 'circular rim/crystal/emboss/jugnu; evo hook at Lv1');
    ok(!!probe.sample.rim0 && !!probe.sample.glass, 'material CSS vars applied');

    await shot('board');
    await shot('yard-mix');

    // Crop-style close-ups via clip of board-wrap regions — full board + selected token
    await page.evaluate(() => {
      const el = document.querySelector('.pc[data-seat="0"][data-piece="1"]');
      if (el) el.classList.add('sel', 'can', 'is-turn');
    });
    await sleep(120);
    await shot('selected');

    // Stage kill FX for a capture splash shot
    await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const wrap = document.getElementById('board-wrap').getBoundingClientRect();
      const t = document.querySelector('.pc[data-seat="1"][data-piece="0"]');
      const r = t.getBoundingClientRect();
      const x = r.left + r.width / 2 - wrap.left, y = r.top + r.height / 2 - wrap.top;
      // call internal killBurst via temporary DOM FX matching runtime classes
      function el(cls) {
        const e = document.createElement('div'); e.className = cls;
        e.style.left = x + 'px'; e.style.top = y + 'px'; fx.appendChild(e); return e;
      }
      el('kill-flash').style.setProperty('--rc', '#ff6f61');
      el('kill-splash').style.setProperty('--rc', '#ff6f61');
      el('kill-settle').style.setProperty('--rc', '#ff6f61');
      el('ring ring-shock').style.setProperty('--rc', '#ff6f61');
      el('ring ring-shock ring-shock-outer').style.setProperty('--rc', '#fff');
    });
    await sleep(180);
    await shot('kill-fx');

    // Per-color crops: screenshot full then also verify docs copies later
    for (const [seat, name] of [['0', 'ruby'], ['1', 'emerald'], ['2', 'gold'], ['3', 'sapphire']]) {
      await page.evaluate(s => {
        document.querySelectorAll('.pc.sel,.pc.can,.pc.is-turn').forEach(e => e.classList.remove('sel', 'can', 'is-turn'));
        const el = document.querySelector('.pc[data-seat="' + s + '"][data-piece="0"]');
        if (el) el.classList.add('sel');
      }, seat);
      await sleep(80);
      const box = await page.evaluate(s => {
        const el = document.querySelector('.pc[data-seat="' + s + '"][data-piece="0"]');
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.x - 24), y: Math.max(0, r.y - 24), width: r.width + 48, height: r.height + 48 };
      }, seat);
      const out = path.join(shotDir, 'v170-token-' + name + '.png');
      await page.screenshot({ path: out, clip: { x: box.x, y: box.y, width: Math.min(box.width, 390), height: Math.min(box.height, 200) } });
      ok(fs.statSync(out).size > 2000, 'crop ' + path.basename(out));
      shots.push(out);
    }

    ok(errors.length === 0, 'no page errors (' + errors.join('; ') + ')');
    console.log('v170 hero token browser checks passed (' + checks + ' checks).');
    console.log('shots:', shots.map(s => path.basename(s)).join(', '));
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
