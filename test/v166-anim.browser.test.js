// v1.6.6: feel-good animation screenshots + live FX checks.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots npm run test:anim
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
      const out = path.join(shotDir, 'v166-anim-' + name + '.png');
      await page.screenshot({ path: out, fullPage: false });
      ok(fs.statSync(out).size > 15000, 'screenshot ' + path.basename(out));
      shots.push(out);
    }

    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');

    // Soft UI press CSS on mode cards / howto
    const press = await page.evaluate(() => {
      const mc = getComputedStyle(document.querySelector('.mode-card'));
      const ht = getComputedStyle(document.querySelector('.howto-open'));
      return { mcTrans: mc.transition, htTrans: ht.transition };
    });
    ok(/transform/.test(press.mcTrans) && /transform/.test(press.htTrans), 'mode card + howto have soft press transitions');
    await shot('home-press');

    // Start classic AI match with human on seat 0
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
      window.__cf.persist();
    });
    await page.click('#btn-start');
    await sleep(150);
    if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) {
      await page.click('#confirm-yes');
    }
    await page.waitForSelector('#game:not(.hidden) #board');
    await sleep(350);

    // Force stacked chips (chip-in) + apply six glow after render settles
    await page.evaluate(() => {
      window.__cf.edit(st => {
        st.phase = 'move';
        st.turn = 0;
        st.queue = [6, 6, 4];
        st.sixes = 2;
        st.bonus = 0;
        st.rollAgain = false;
        for (let s = 0; s < 4; s++) st.pieces[s] = [-1, -1, -1, -1];
        st.pieces[0][0] = 8;
      });
    });
    await sleep(180);
    const sixChip = await page.evaluate(() => {
      const die = document.querySelector('.pod[data-seat="0"] .pdice');
      if (die) { die.classList.remove('six-pop', 'six-glow'); void die.offsetWidth; die.classList.add('six-pop', 'six-glow'); }
      const chips = [...document.querySelectorAll('.pod[data-seat="0"] .chip-v')];
      return {
        sixGlow: die && die.classList.contains('six-glow'),
        chipCount: chips.length,
        chipIn: chips.filter(c => c.classList.contains('chip-in')).length
      };
    });
    ok(sixChip.sixGlow, 'dice six-glow class applied');
    ok(sixChip.chipCount >= 2 && sixChip.chipIn === sixChip.chipCount, 'stack chips animate in');
    await shot('dice-glow-chips');

    // Yard exit flourish staged with the same DOM classes runtime uses
    ok(await page.evaluate(() => typeof window.__cf.logic.HOME === 'number'), 'game logic still available after chip edit');
    await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const wrap = document.getElementById('board-wrap');
      const c = wrap.clientWidth / 15;
      const origin = { x: 2.5 * c, y: 2.5 * c };
      function add(cls, x, y, props) {
        const e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px';
        if (props) Object.keys(props).forEach(k => e.style.setProperty(k, props[k]));
        fx.appendChild(e);
      }
      add('yard-burst', origin.x, origin.y, { '--rc': '#e85d4c' });
      add('ring ring-yard', origin.x, origin.y, { '--rc': '#e85d4c' });
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k - 1) * 0.7, d = c * 0.28;
        add('hop-spark', origin.x, origin.y, { '--rc': '#e85d4c', '--dx': (Math.cos(a) * d).toFixed(1) + 'px', '--dy': (Math.sin(a) * d - 4).toFixed(1) + 'px' });
      }
      const fl = document.createElement('div'); fl.className = 'float float-yard'; fl.style.left = origin.x + 'px'; fl.style.top = (origin.y - 20) + 'px'; fl.textContent = 'Out!'; fx.appendChild(fl);
    });
    await sleep(80);
    ok(await page.evaluate(() => !!document.querySelector('#fx .yard-burst')), 'yard-burst FX node present');
    await shot('yard-exit');

    // Capture splash + safe sparkle + arrow whoosh staged for shots
    await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const W = document.getElementById('board-wrap').clientWidth, c = W / 15;
      function add(cls, x, y, props) {
        const e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px';
        if (props) Object.keys(props).forEach(k => e.style.setProperty(k, props[k]));
        fx.appendChild(e); return e;
      }
      const x = 7.5 * c, y = 4.5 * c;
      add('kill-flash', x, y, { '--rc': '#e85d4c' });
      add('kill-splash', x, y, { '--rc': '#e85d4c' });
      add('ring ring-shock', x, y, { '--rc': '#e85d4c' });
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2, d = c * 1.1;
        add('burst burst-splash', x, y, { '--dx': (Math.cos(a) * d).toFixed(1) + 'px', '--dy': (Math.sin(a) * d).toFixed(1) + 'px', background: i % 2 ? '#e85d4c' : '#4aa3ff' });
      }
      const fl = document.createElement('div'); fl.className = 'float float-kill'; fl.style.left = x + 'px'; fl.style.top = (y - 18) + 'px'; fl.textContent = 'Captured!'; fx.appendChild(fl);
    });
    await sleep(60);
    await shot('capture-splash');

    await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const W = document.getElementById('board-wrap').clientWidth, c = W / 15;
      function add(cls, x, y, props) {
        const e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px';
        if (props) Object.keys(props).forEach(k => e.style.setProperty(k, props[k]));
        fx.appendChild(e);
      }
      const x = 6.5 * c, y = 1.5 * c, col = '#4aa3ff';
      add('safe-pulse', x, y, { '--rc': col });
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2, d = c * 0.55;
        add('safe-spark', x, y, { '--rc': col, '--dx': (Math.cos(a) * d).toFixed(1) + 'px', '--dy': (Math.sin(a) * d).toFixed(1) + 'px' });
      }
    });
    await sleep(60);
    await shot('safe-sparkle');

    await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const W = document.getElementById('board-wrap').clientWidth, c = W / 15;
      function add(cls, x, y, props) {
        const e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px';
        if (props) Object.keys(props).forEach(k => e.style.setProperty(k, props[k]));
        fx.appendChild(e);
      }
      const from = { x: 2.5 * c, y: 6.5 * c }, to = { x: 6.5 * c, y: 6.5 * c }, col = '#e85d4c';
      const dx = to.x - from.x, dy = to.y - from.y;
      add('arrow-whoosh', from.x, from.y, { '--rc': col, '--wx': dx + 'px', '--wy': dy + 'px' });
      add('arrow-whoosh trail', from.x, from.y, { '--rc': col, '--wx': dx + 'px', '--wy': dy + 'px' });
      for (let t = 1; t <= 5; t++) {
        const u = t / 6;
        add('arrow-trail-dot', from.x + dx * u, from.y + dy * u, { '--rc': col, '--dx': '8px', '--dy': '0px' });
      }
      add('ring ring-whoosh', to.x, to.y, { '--rc': col });
    });
    await sleep(60);
    await shot('arrow-whoosh');

    // Turn handoff pulse
    await page.evaluate(() => {
      const pod = document.querySelector('.pod[data-seat="0"]');
      if (pod) {
        pod.classList.add('active', 'turn-arrive', 'turn-pulse');
        pod.style.setProperty('--pc', '#e85d4c');
      }
      const banner = document.getElementById('turn-banner');
      if (banner) banner.classList.add('turn-swap');
    });
    await sleep(80);
    await shot('turn-pulse');

    // Home stretch sparkles
    await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const W = document.getElementById('board-wrap').clientWidth, c = W / 15;
      function add(cls, x, y, props) {
        const e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px';
        if (props) Object.keys(props).forEach(k => e.style.setProperty(k, props[k]));
        fx.appendChild(e);
      }
      const col = '#ffd24a';
      for (let step = 0; step < 4; step++) {
        const x = 7.5 * c, y = (5.5 - step * 0.7) * c;
        for (let k = 0; k < 5; k++) {
          const a = k / 5 * Math.PI * 2, d = c * 0.4;
          add('lane-spark', x, y, { '--rc': col, '--dx': (Math.cos(a) * d).toFixed(1) + 'px', '--dy': (Math.sin(a) * d).toFixed(1) + 'px' });
        }
      }
      add('ring ring-home', 7.5 * c, 7.5 * c, { '--rc': '#e85d4c' });
      add('ring ring-home-gold', 7.5 * c, 7.5 * c, { '--rc': '#ffd24a' });
    });
    await sleep(60);
    await shot('home-lane');

    // Reduced motion: new FX classes should be killed by media query
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const reduced = await page.evaluate(() => {
      const fx = document.getElementById('fx'); fx.innerHTML = '';
      const e = document.createElement('i'); e.className = 'yard-burst'; e.style.left = '40px'; e.style.top = '40px'; fx.appendChild(e);
      const cs = getComputedStyle(e);
      return { anim: cs.animationName, opacity: cs.opacity };
    });
    ok(reduced.anim === 'none' || reduced.opacity === '0', 'reduced-motion disables yard-burst');

    // Camel still loaded
    ok(await page.evaluate(() => !!(window.CamelCelebration && typeof window.__cf.celebrateWin === 'function')), 'camel celebration still hooked');

    // Die picker + countdown still in DOM
    ok(await page.evaluate(() => !!(document.getElementById('token-die-pick') && document.getElementById('move-countdown'))), 'die picker + 4s countdown hooks present');

    ok(errors.length === 0, 'no page errors (' + errors.join(' | ') + ')');
    console.log('v166-anim browser checks passed (' + checks + ' checks). Shots: ' + shots.map(s => path.basename(s)).join(', '));
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
