// v1.6.1: token die picker + 4s move countdown screenshots and behavior.
// Usage: CHROME=/usr/bin/google-chrome SHOT_DIR=/workspace/offline-ludo-shots node test/v161-picker-countdown.browser.test.js <url>
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const URL = (process.argv[2] || 'http://127.0.0.1:8761/').replace(/\/?$/, '/');
const shotDir = process.env.SHOT_DIR || '/workspace/offline-ludo-shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function ok(c, m) { if (!c) throw new Error('FAILED: ' + m); checks++; console.log('  ok -', m); }

(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const shots = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('crossfour.tutorial.v1', '1');
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click('#btn-vs-ai');
    await page.waitForSelector('#setup:not(.hidden)');
    // Default 1v1 puts the human on seat 3; pin human on seat 0 so fixtures match.
    await page.evaluate(() => {
      window.__cf.save.setup.ai = [
        { type: 'human' },
        { type: 'ai', level: 'easy' },
        { type: 'ai', level: 'easy' },
        { type: 'ai', level: 'easy' }
      ];
      window.__cf.persist();
    });
    await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden)');
    await sleep(400);

    const tokenMeta = await page.evaluate(() => {
      const pcs = [...document.querySelectorAll('#pieces .pc')].slice(0, 8);
      return pcs.map(el => ({
        num: el.dataset.num,
        label: el.getAttribute('aria-label'),
        hasJugnu: !!el.querySelector('.jugnu'),
        hasNum: !!(el.querySelector('.gem-num') && el.querySelector('.gem-num').textContent),
        numText: el.querySelector('.gem-num') && el.querySelector('.gem-num').textContent
      }));
    });
    ok(tokenMeta.length >= 4, 'tokens rendered');
    ok(tokenMeta.every(t => t.hasJugnu), 'every token has soft jugnu/firefly glow');
    ok(tokenMeta.every(t => t.hasNum && t.numText === t.num), 'every token shows its own number glyph');
    const seat0 = tokenMeta.filter((_, i) => true); // all seats
    const nums = [...new Set(tokenMeta.map(t => t.num))].sort();
    ok(nums.join(',') === '1,2,3,4' || nums.every(n => ['1','2','3','4'].includes(n)), 'token numbers are 1–4');

    // Force a multi-die move phase: queue 6+4, one token that can use both (on track with room).
    await page.evaluate(() => {
      window.__cf.edit(st => {
        st.phase = 'move';
        st.turn = 0;
        st.queue = [6, 4];
        st.sixes = 0;
        st.bonus = 0;
        st.rollAgain = false;
        for (let s = 0; s < 4; s++) if (st.pieces[s]) st.pieces[s] = st.pieces[s].map(() => -1);
        st.pieces[0][0] = 10; // can take 4 or 6
        st.pieces[0][1] = -1;
        st.pieces[0][2] = -1;
        st.pieces[0][3] = -1;
        // rival far away so neither is forced kill for the picker shot
        if (st.pieces[2]) st.pieces[2][0] = 40;
        st.moves = window.LudoLogic.queueMoves(st);
        st.faces[0] = 4;
      });
    });
    await sleep(300);

    const vals = await page.evaluate(() => {
      const st = window.__cf.game.st;
      const ms = st.moves.filter(m => m.piece === 0);
      return { phase: st.phase, vs: ms.map(m => m.v).sort((a,b)=>a-b), cd: document.getElementById('move-countdown').textContent, cdHidden: document.getElementById('move-countdown').classList.contains('hidden') };
    });
    ok(vals.phase === 'move', 'fixture is in move phase');
    ok(vals.vs.join(',') === '4,6', 'token 0 has legal 4 and 6');
    ok(!vals.cdHidden && vals.cd === '4', '4s countdown shows 4 at start of decision');

    const board = await page.$('#board-wrap');
    const f1 = path.join(shotDir, 'v161-countdown-4.png');
    await board.screenshot({ path: f1 }); shots.push(f1);

    // Tap the movable token → die picker
    await page.evaluate(() => {
      const el = document.querySelector('#pieces .pc[data-seat="0"][data-piece="0"]');
      el.click();
    });
    await sleep(200);
    const pick = await page.evaluate(() => {
      const el = document.getElementById('token-die-pick');
      const btns = [...el.querySelectorAll('.token-die-v')].map(b => +b.dataset.v);
      return { hidden: el.classList.contains('hidden'), btns, diePick: window.__cf.diePick };
    });
    ok(!pick.hidden && pick.btns.join(',') === '6,4', 'token die picker shows only legal 6 and 4');
    ok(pick.diePick && pick.diePick.piece === 0, 'diePick state tracks the token');

    const f2 = path.join(shotDir, 'v161-die-picker.png');
    await board.screenshot({ path: f2 }); shots.push(f2);

    // Choose 4
    await page.click('#token-die-pick .token-die-v[data-v="4"]');
    await page.waitForFunction(() => window.__cf.busy || window.__cf.game.st.queue.indexOf(4) < 0, { timeout: 4000 });
    await sleep(900);
    const after = await page.evaluate(() => ({
      q: window.__cf.game.st.queue.slice(),
      pos: window.__cf.game.st.pieces[0][0],
      pickHidden: document.getElementById('token-die-pick').classList.contains('hidden')
    }));
    ok(after.pickHidden, 'picker closes after choosing a die');
    ok(after.pos === 14, 'token advanced by 4');
    ok(after.q.indexOf(4) < 0, 'spent the chosen die value');

    // Fresh decide: set kill+leave fixture and let countdown auto-play kill
    await page.evaluate(() => {
      window.__cf.edit(st => {
        const L = window.LudoLogic;
        st.phase = 'move';
        st.turn = 0;
        st.queue = [6, 4];
        for (let s = 0; s < 4; s++) if (st.pieces[s]) st.pieces[s] = st.pieces[s].map(() => -1);
        st.pieces[0][0] = 10;
        st.pieces[0][1] = -1; // yard — 6 can open
        st.pieces[2][0] = L.posFromAbs(2, L.absOf(0, 10) + 4); // kill with 4
        st.moves = L.queueMoves(st);
      });
    });
    await sleep(200);
    const before = await page.evaluate(() => ({
      pos: window.__cf.game.st.pieces[0][0],
      victim: window.__cf.game.st.pieces[2][0],
      best: window.__cf.bestAutoMove()
    }));
    ok(before.best && before.best.v === 4, 'bestAutoMove prefers the kill (4) over yard 6');

    // Wait for auto-play (~4s)
    await page.waitForFunction(prev => {
      const g = window.__cf.game;
      return g && (g.st.pieces[0][0] !== prev.pos || window.__cf.busy);
    }, { timeout: 7000 }, before);
    await sleep(1200);
    const auto = await page.evaluate(() => ({
      pos: window.__cf.game.st.pieces[0][0],
      victim: window.__cf.game.st.pieces[2][0]
    }));
    ok(auto.pos === 14, 'auto-play used the kill die (landed +4)');
    ok(auto.victim < 0, 'auto-play capture sent rival home');

    const f3 = path.join(shotDir, 'v161-tokens-polish.png');
    await board.screenshot({ path: f3 }); shots.push(f3);

    // Yard crop: numbered tokens with jugnu glow
    await page.evaluate(() => {
      window.__cf.edit(st => {
        st.phase = 'roll';
        st.turn = 0;
        st.queue = [];
        st.moves = [];
        for (let s = 0; s < 4; s++) if (st.pieces[s]) st.pieces[s] = st.pieces[s].map(() => -1);
      });
    });
    await sleep(350);
    const f3b = path.join(shotDir, 'v161-token-numbers.png');
    await board.screenshot({ path: f3b }); shots.push(f3b);

    // Full stage shot
    const f4 = path.join(shotDir, 'v161-match.png');
    await page.screenshot({ path: f4 }); shots.push(f4);

    console.log(checks + ' v1.6.1 browser checks passed');
    console.log('shots:', shots.join(', '));
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
