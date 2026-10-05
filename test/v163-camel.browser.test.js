// v1.6.3: Gulaab Camel win celebration — browser checks + ship screenshots.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots node test/v163-camel.browser.test.js
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  const shots = [];
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    ok(await page.evaluate(() => !!window.CamelCelebration && typeof window.__cf.celebrateWin === 'function'), 'CamelCelebration module + hook loaded');

    async function shot(name) {
      const out = path.join(shotDir, 'v163-camel-' + name + '.png');
      await page.screenshot({ path: out });
      ok(fs.statSync(out).size > 20000, 'screenshot ' + path.basename(out));
      shots.push(out);
    }
    async function newMatch(seats, mode) {
      await page.evaluate((seats, mode) => {
        localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1');
      }, seats, mode);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.evaluate((seats, mode) => { window.__cf.save.setup.ai = seats; window.__cf.save.setup.mode.ai = mode; window.__cf.persist(); }, seats, mode);
      await page.click('#btn-vs-ai');
      await page.waitForSelector('#setup:not(.hidden)');
      await page.click('#btn-start');
      await sleep(150);
      if (await page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden'))) await page.click('#confirm-yes');
      await page.waitForSelector('#game:not(.hidden) #board');
      await sleep(400);
    }
    async function forceWin(seat, extra) {
      await page.evaluate((seat, extra) => {
        window.__cf.edit(st => {
          const n = st.nPieces || 4;
          st.pieces[seat] = Array(n).fill(window.__cf.logic.HOME);
          if (extra === 'team') st.pieces[(seat + 2) % 4] = Array(n).fill(window.__cf.logic.HOME);
          st.phase = 'over';
          st.ranking = [seat].concat(st.players.filter(s => s !== seat));
        });
      }, seat, extra);
      await page.waitForSelector('#result:not(.hidden)', { timeout: 5000 });
      await page.waitForSelector('#camel-celebration', { timeout: 3000 });
    }
    const info = () => page.evaluate(() => {
      const l = document.getElementById('camel-celebration');
      if (!l) return null;
      const w = l.querySelector('.cc-walker'), g = l.querySelector('.cc-garland');
      const seat = +l.dataset.seat, pod = document.querySelector('.pod[data-seat="' + seat + '"] .avatar');
      const pr = pod ? pod.getBoundingClientRect() : null, wr = w ? w.getBoundingClientRect() : null;
      return { seat, state: l.dataset.state, side: l.dataset.side, pe: getComputedStyle(l).pointerEvents, z: getComputedStyle(l).zIndex,
        faceLeft: !!l.querySelector('.cc-flip.face-left'), petals: l.querySelectorAll('.cc-petal').length,
        walker: wr && { l: wr.left, r: wr.right, t: wr.top, b: wr.bottom }, av: pr && { cx: pr.left + pr.width / 2, cy: pr.top + pr.height / 2, l: pr.left, r: pr.right },
        garland: g && { x: parseFloat(g.style.left), y: parseFloat(g.style.top) }, slot: window.__cf.podOf(seat) };
    });
    const FOUR = [{ type: 'human' }, { type: 'ai', level: 'easy' }, { type: 'ai', level: 'medium' }, { type: 'ai', level: 'hard' }];

    // 1) Human (You, bottom-left) wins a 4-player classic match vs AI
    await newMatch(FOUR, 'classic');
    const you = await page.evaluate(() => window.__cf.game.st.players.find(s => window.__cf.game.st.seats[s].type === 'human'));
    await forceWin(you);
    await sleep(900);
    let i1 = await info();
    ok(i1 && i1.state === 'walking' && i1.slot === 3, 'You (slot 3, bottom-left) win → camel walking');
    ok(i1.pe === 'none' && +i1.z > 50, 'overlay is pointer-events:none and above the result backdrop');
    ok(i1.side === 'left' && i1.faceLeft, 'camel faces left toward the bottom-left seat');
    await shot('walk');
    await page.waitForFunction(() => window.__cf.celebration === 'arrived', { timeout: 4000 });
    await sleep(1100);
    i1 = await info();
    ok(i1.walker.l >= i1.av.r && i1.walker.l - i1.av.r < 20, 'camel stopped right beside the winner avatar');
    ok(Math.abs(i1.garland.x - i1.av.cx) < 1.5 && Math.abs(i1.garland.y - i1.av.cy) < 1.5, 'rose garland centred on the winner avatar');
    ok(i1.petals >= 24, 'rose petals showering');
    await shot('you-win');
    // stats counted exactly once; buttons still usable during the celebration
    const st1 = await page.evaluate(() => ({ won: window.__cf.save.stats.won, played: window.__cf.save.stats.played }));
    ok(st1.played === 1 && st1.won === 1, 'match counted once (played 1, won 1)');
    await sleep(600);
    const st1b = await page.evaluate(() => ({ won: window.__cf.save.stats.won, played: window.__cf.save.stats.played }));
    ok(st1b.played === 1 && st1b.won === 1, 'celebration does not re-count the match');
    await page.click('#btn-r-again');
    await sleep(300);
    ok(await page.evaluate(() => !document.getElementById('camel-celebration') && window.__cf.celebration === 'idle'), 'Play again (clickable through overlay) clears the celebration');
    await page.waitForFunction(() => window.__cf.game && window.__cf.game.st.phase !== 'over', { timeout: 8000 });
    ok(true, 'new match started normally after the celebration');

    // 2) AI (Jade, top-right) wins a 1v1
    await newMatch([{ type: 'human' }, null, { type: 'ai', level: 'medium' }, null], 'classic');
    const ai2 = await page.evaluate(() => window.__cf.game.st.players.find(s => window.__cf.game.st.seats[s].type === 'ai'));
    const before2 = await page.evaluate(() => ({ won: window.__cf.save.stats.won, played: window.__cf.save.stats.played }));
    await forceWin(ai2);
    await page.waitForFunction(() => window.__cf.celebration === 'arrived', { timeout: 4000 });
    await sleep(1100);
    const i2 = await info();
    ok(i2.slot === 1 && i2.side === 'right' && !i2.faceLeft, 'AI (top-right Jade-style seat) win → camel walks right to it');
    ok(i2.walker.r <= i2.av.l + 1 && i2.av.l - i2.walker.r < 20, 'camel stopped just left of the AI avatar');
    const after2 = await page.evaluate(() => ({ won: window.__cf.save.stats.won, played: window.__cf.save.stats.played }));
    ok(after2.played === before2.played + 1 && after2.won === before2.won, 'AI win counted once, as a loss for the human');
    await shot('ai-win');

    // 3) 4-player: top-left and bottom-right seats
    await newMatch(FOUR, 'classic');
    const bySlot = await page.evaluate(() => [0, 1, 2, 3].map(sl => +document.querySelector('.pod[data-slot="' + sl + '"]').dataset.seat));
    await forceWin(bySlot[0]);
    await page.waitForFunction(() => window.__cf.celebration === 'arrived', { timeout: 4000 });
    await sleep(1000);
    const i3 = await info();
    ok(i3.slot === 0 && i3.side === 'left', 'top-left seat win → camel goes top-left');
    await shot('top-left');
    await page.click('#btn-r-home');
    await newMatch(FOUR, 'classic');
    await forceWin(bySlot[2]);
    await page.waitForFunction(() => window.__cf.celebration === 'arrived', { timeout: 4000 });
    await sleep(1000);
    const i4 = await info();
    ok(i4.slot === 2 && i4.side === 'right', 'bottom-right seat win → camel goes bottom-right');
    await shot('bottom-right');

    // 4) Other modes share the same result path: Team, Quick, Lucky
    for (const mode of ['team', 'quick', 'lucky']) {
      await page.evaluate(() => window.CamelCelebration.stop());
      await newMatch(FOUR, mode);
      const w = await page.evaluate(() => window.__cf.game.st.players.find(s => window.__cf.game.st.seats[s].type === 'ai'));
      await forceWin(w, mode === 'team' ? 'team' : '');
      const im = await info();
      ok(im && im.seat === w, mode + ' mode win → celebration toward seat ' + w);
      if (mode === 'team') { await page.waitForFunction(() => window.__cf.celebration === 'arrived', { timeout: 4000 }); await sleep(1000); await shot('team'); }
    }

    // 5) Online classic (shared board): opponent wins on the server state
    await page.evaluate(() => { window.CamelCelebration.stop(); document.getElementById('result').classList.add('hidden'); });
    await page.evaluate(() => window.__cf.presentOnline({
      state: { players: [0, 2], pieces: [[10, 22, -1, -1], null, [57, 57, 57, 57], null], phase: 'over', ranking: [2, 0], turn: 2, queue: [], faces: [3, 1, 6, 1], turn_count: 88 },
      mySeat: 0, names: { 0: 'You', 2: 'Rival' }, deadline: 0
    }));
    await page.waitForSelector('#camel-celebration', { timeout: 3000 });
    const i5 = await info();
    ok(i5.seat === 2, 'online classic: opponent win → camel toward their seat');
    await page.waitForFunction(() => window.__cf.celebration === 'arrived', { timeout: 4000 });
    await sleep(1000);
    await shot('online');
    // a repeat server push of the same finished state does not restart it
    await page.evaluate(() => window.__cf.presentOnline({
      state: { players: [0, 2], pieces: [[10, 22, -1, -1], null, [57, 57, 57, 57], null], phase: 'over', ranking: [2, 0], turn: 2, queue: [], faces: [3, 1, 6, 1], turn_count: 88 },
      mySeat: 0, names: { 0: 'You', 2: 'Rival' }, deadline: 0
    }));
    ok(await page.evaluate(() => window.__cf.celebration) !== 'walking', 'repeat online push does not replay the camel');
    await page.evaluate(() => window.__cf.clearOnline());
    ok(await page.evaluate(() => window.__cf.celebration === 'idle'), 'leaving the online board clears the celebration');

    // 6) prefers-reduced-motion: short static roses, no camel / falling petals
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await newMatch([{ type: 'human' }, null, { type: 'ai', level: 'easy' }, null], 'classic');
    const h6 = await page.evaluate(() => window.__cf.game.st.players.find(s => window.__cf.game.st.seats[s].type === 'human'));
    await forceWin(h6);
    const i6 = await page.evaluate(() => { const l = document.getElementById('camel-celebration'); return { state: l.dataset.state, walker: !!l.querySelector('.cc-walker'), petals: l.querySelectorAll('.cc-petal').length, roses: l.querySelectorAll('.cc-garland-rose').length }; });
    ok(i6.state === 'static' && !i6.walker && i6.petals === 0 && i6.roses === 10, 'reduced motion → static rose garland only');
    await sleep(300);
    await shot('reduced-motion');
    await sleep(1800);
    ok(await page.evaluate(() => !document.getElementById('camel-celebration')), 'reduced-motion roses clear after a short moment');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    // 7) Art close-up (both directions)
    const art = await browser.newPage();
    await art.setViewport({ width: 560, height: 260, deviceScaleFactor: 2 });
    await art.goto(local.url, { waitUntil: 'networkidle0' });
    await art.evaluate(() => {
      document.body.innerHTML = '<div id="art" style="position:fixed;inset:0;background:radial-gradient(circle at 50% 30%,#2b3a52,#121822);display:flex;gap:24px;align-items:center;justify-content:center"><div style="width:250px;height:219px">' + window.CamelCelebration.camelSVG() + '</div><div style="width:250px;height:219px;transform:scaleX(-1)">' + window.CamelCelebration.camelSVG() + '</div></div>';
      document.querySelectorAll('#art .cc-leg,#art .cc-bob,#art .cc-head,#art .cc-wave,#art .cc-shadow').forEach(e => { e.style.animation = 'none'; });
    });
    const artOut = path.join(shotDir, 'v163-camel-art.png');
    await art.screenshot({ path: artOut });
    ok(fs.statSync(artOut).size > 20000, 'screenshot v163-camel-art.png'); shots.push(artOut);

    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    console.log(checks + ' v1.6.3 camel celebration browser checks passed');
    console.log('shots:\n  ' + shots.join('\n  '));
  } finally {
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
