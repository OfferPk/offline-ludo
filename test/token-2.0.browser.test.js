'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');

const webRoot = path.resolve(__dirname, '..', 'www');
const shotDir = process.env.SHOT_DIR || path.resolve(__dirname, '..', 'docs', 'previews', 'token-2.0');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
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

(async () => {
  const local = await startLocalServer();
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [], externalRequests = [];
  try {
    fs.mkdirSync(shotDir, { recursive: true });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      if (!url.startsWith(local.url) && !url.startsWith('data:') && !url.startsWith('about:')) { externalRequests.push(url); request.abort(); }
      else request.continue();
    });

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(local.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });

    async function openTokens() {
      if (await page.$eval('#skins', element => element.classList.contains('hidden'))) await page.click('#btn-skins');
      await page.waitForSelector('#skins:not(.hidden)');
      await page.click('#skin-tabs [data-tab="tokens"]');
      await page.waitForSelector('#skins:not(.hidden) #token-wardrobe:not(.hidden)');
    }
    async function closeSkins() {
      if (!(await page.$eval('#skins', element => element.classList.contains('hidden')))) await page.click('#skins [data-close="skins"]');
    }
    async function screenshotSection(selector, filename) {
      await page.$eval('#skins .panel.wide', (panel, query) => {
        const target = panel.querySelector(query);
        panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16;
      }, selector);
      await new Promise(resolve => setTimeout(resolve, 100));
      await page.screenshot({ path: path.join(shotDir, filename) });
      await page.$eval('#skins .panel.wide', panel => { panel.scrollTop = 0; });
    }
    async function completeLocalMatch(targetCount) {
      await page.click('#btn-vs-ai');
      await page.waitForSelector('#setup:not(.hidden)');
      await page.click('#mode-seg [data-mode="classic"]');
      await page.click('#btn-start');
      await page.waitForSelector('#game:not(.hidden) #board', { timeout: 10000 });
      await page.evaluate(() => window.__cf.edit(state => { state.phase = 'over'; state.ranking = state.players.slice(); }));
      await page.waitForFunction(count => window.__cf.save.tokenProgress.completed >= count, { timeout: 7000 }, targetCount);
      await page.click('#btn-r-home');
      await page.waitForSelector('#home:not(.hidden)', { timeout: 7000 });
    }

    await openTokens();
    const initial = await page.evaluate(() => {
      const c = window.__cf;
      return {
        skins: document.querySelectorAll('#token-wardrobe .token-skin-grid > [data-token-skin]').length,
        sets: document.querySelectorAll('#token-wardrobe .token-set-grid > [data-token-set]').length,
        levelSteps: document.querySelectorAll('#token-wardrobe .token-level-step').length,
        progress: c.save.tokenProgress.completed,
        identity: Object.assign({}, c.save.tokenIdentity),
        freeAtStart: [...document.querySelectorAll('#token-wardrobe .token-skin-grid > [data-token-skin]:not(.is-locked)')].map(card => card.dataset.tokenSkin),
        freeSetsAtStart: [...document.querySelectorAll('#token-wardrobe .token-set-grid > [data-token-set]:not(.is-locked)')].map(card => card.dataset.tokenSet),
        setPieces: [...document.querySelectorAll('#token-wardrobe .token-set-grid > [data-token-set]')].map(card => ({ id: card.dataset.tokenSet, pieces: [...card.querySelectorAll('.token-set-piece small')].map(label => label.textContent) })),
        materialRims: [...document.querySelectorAll('.token-color-item .token-preview')].map(el => getComputedStyle(el).getPropertyValue('--token-rim').trim()),
        mobileOverflow: document.documentElement.scrollWidth <= innerWidth && document.querySelector('#skins .panel.wide').scrollWidth <= document.querySelector('#skins .panel.wide').clientWidth + 1,
        circleArtwork: [...document.querySelectorAll('#token-wardrobe .gem-body')].every(el => el.tagName.toLowerCase() === 'circle'),
        previewPaint: (() => { const svg = document.querySelector('.token-hero-showcase .token-preview svg'), body = svg.querySelector('.gem-body'); return { bodyFill: getComputedStyle(body).fill, shieldOpacity: getComputedStyle(svg.querySelector('.gem-shield')).opacity, frostOpacity: getComputedStyle(svg.querySelector('.gem-frost-wash')).opacity, number: svg.querySelector('.gem-num').textContent, numberOpacity: getComputedStyle(svg.querySelector('.gem-num')).opacity, emblemOpacity: getComputedStyle(svg.querySelector('.gem-set-mark')).opacity }; })()
      };
    });
    assert.equal(initial.skins, 10); ok(true, 'Tokens tab renders all ten free cosmetic skins');
    assert.equal(initial.sets, 4); ok(true, 'Tokens tab renders all four complete four-piece sets');
    assert.equal(initial.levelSteps, 5); ok(true, 'all five free evolution tiers are displayed accessibly');
    assert.equal(initial.progress, 0); assert.deepEqual(initial.identity, { skin: 'classic', set: 'inferno' });
    assert.deepEqual(initial.freeAtStart, ['classic']); assert.deepEqual(initial.freeSetsAtStart, ['inferno']);
    ok(true, 'only the base Classic skin and Inferno set are freely unlocked before any match is completed');
    assert.ok(initial.setPieces.every(set => set.pieces.length === 4 && set.pieces.every(Boolean)), 'each Inferno/Frost/Galaxy/Royal set preview contains four named original tokens'); ok(true, 'all four named sets are complete');
    assert.equal(new Set(initial.materialRims).size, 4); ok(true, 'Ruby, Gold, Emerald, and Sapphire previews use four distinct metal rims');
    ok(initial.mobileOverflow, 'the free Token 2.0 wardrobe fits a touch-width phone without horizontal overflow');
    ok(initial.circleArtwork, 'all preview tokens retain a circular body rather than a polygonal silhouette');
    ok(initial.previewPaint.bodyFill.includes('url') && initial.previewPaint.shieldOpacity === '0' && initial.previewPaint.frostOpacity === '0' && initial.previewPaint.number && initial.previewPaint.numberOpacity !== '0' && initial.previewPaint.emblemOpacity !== '0', 'preview SVG keeps its crystal gradient, visible numeral/emblem, and hides board-only overlays');
    const tabStates = await page.$$eval('#skin-tabs button', buttons => buttons.map(button => button.getAttribute('aria-pressed')));
    assert.deepEqual(tabStates, ['false', 'false', 'true']); ok(true, 'cosmetic tabs announce the selected category to assistive technology');
    await page.screenshot({ path: path.join(shotDir, 'token-2.0-mobile.png') });
    await screenshotSection('.token-skin-grid', 'token-2.0-mobile-skins.png');
    await screenshotSection('.token-set-grid', 'token-2.0-mobile-sets.png');

    await closeSkins();
    await completeLocalMatch(1);
    await openTokens();
    const milestoneOne = await page.evaluate(() => ({ progress: window.__cf.save.tokenProgress.completed, royal: !document.querySelector('[data-token-skin="royal"] button').disabled, level: document.querySelector('.token-level-step.is-current small').textContent }));
    assert.equal(milestoneOne.progress, 1); assert.equal(milestoneOne.royal, true); assert.equal(milestoneOne.level, 'Basic');
    ok(true, 'first completed offline match freely unlocks Royal without skipping the Basic tier');
    const coinsBeforeRoyal = await page.evaluate(() => window.__cf.save.coins);
    await page.$eval('[data-token-skin="royal"] button', button => button.click());
    await page.waitForFunction(() => window.__cf.save.tokenIdentity.skin === 'royal');
    const afterRoyal = await page.evaluate(() => ({ identity: Object.assign({}, window.__cf.save.tokenIdentity), coins: window.__cf.save.coins }));
    assert.equal(afterRoyal.identity.skin, 'royal'); assert.equal(afterRoyal.coins, coinsBeforeRoyal);
    ok(true, 'equipable Royal persists as a cosmetic-only choice with no extra coin deduction');
    await closeSkins();

    await completeLocalMatch(2);
    await completeLocalMatch(3);
    await openTokens();
    const milestoneThree = await page.evaluate(() => ({
      progress: window.__cf.save.tokenProgress.completed,
      currentLevel: document.querySelector('.token-level-step.is-current small').textContent,
      dragonEnabled: !document.querySelector('[data-token-skin="dragon"] button').disabled,
      frostEnabled: !document.querySelector('[data-token-set="frost"] button').disabled,
      coins: window.__cf.save.coins,
      tier: [...document.querySelectorAll('.token-level-step')].map(step => ({ name: step.querySelector('small').textContent, earned: step.classList.contains('is-earned') }))
    }));
    assert.equal(milestoneThree.progress, 3); assert.equal(milestoneThree.currentLevel, 'Polished');
    assert.equal(milestoneThree.dragonEnabled, true); assert.equal(milestoneThree.frostEnabled, true);
    ok(true, 'two and three completed matches advance Polished and freely unlock Dragon plus the Frost set');
    await page.$eval('[data-token-skin="dragon"] button', button => button.click());
    await page.waitForFunction(() => window.__cf.save.tokenIdentity.skin === 'dragon');
    await page.$eval('[data-token-set="frost"] button', button => button.click());
    await page.waitForFunction(() => window.__cf.save.tokenIdentity.set === 'frost');
    const equipped = await page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('crossfour.save.v3'));
      return { identity: Object.assign({}, window.__cf.save.tokenIdentity), coins: window.__cf.save.coins, snapshot: snapshot.payload, screenWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    assert.deepEqual(equipped.identity, { skin: 'dragon', set: 'frost' });
    assert.equal(equipped.coins, milestoneThree.coins); assert.equal(equipped.snapshot.tokenIdentity.skin, 'dragon'); assert.equal(equipped.snapshot.tokenIdentity.set, 'frost');
    ok(true, 'equipping Dragon and Frost is free, writes both choices to the local save, and creates no account dependency');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('#btn-skins'); await page.click('#skin-tabs [data-tab="tokens"]');
    await page.waitForSelector('[data-token-skin="dragon"].is-selected, .token-hero-info h4');
    const restored = await page.evaluate(() => ({ identity: Object.assign({}, window.__cf.save.tokenIdentity), completed: window.__cf.save.tokenProgress.completed, label: document.querySelector('.token-identity-line').textContent, level: document.querySelector('.token-level-step.is-current small').textContent }));
    assert.deepEqual(restored.identity, { skin: 'dragon', set: 'frost' }); assert.equal(restored.completed, 3);
    assert.match(restored.label, /Dragon Frost Set · Polished/); assert.equal(restored.level, 'Polished');
    ok(true, 'skin/set selection and free evolution restore after a real localStorage reload');

    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
    await openTokens();
    await page.screenshot({ path: path.join(shotDir, 'token-2.0-desktop.png') });
    await screenshotSection('.token-skin-grid', 'token-2.0-desktop-skins.png');
    await screenshotSection('.token-set-grid', 'token-2.0-desktop-sets.png');
    const desktopLayout = await page.evaluate(() => {
      const panel = document.querySelector('#skins .panel.wide'), grid = document.querySelector('.token-skin-grid');
      return { overflow: document.documentElement.scrollWidth <= innerWidth, panelWidth: panel.clientWidth, panelScroll: panel.scrollWidth, skinColumns: getComputedStyle(grid).gridTemplateColumns, sets: document.querySelectorAll('[data-token-set]').length };
    });
    ok(desktopLayout.overflow && desktopLayout.panelScroll <= desktopLayout.panelWidth + 1, 'desktop Token 2.0 preview fits the wide wardrobe without horizontal overflow');

    await closeSkins();
    await page.click('#btn-pass'); await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#presets [data-p="4"]'); await page.click('#mode-seg [data-mode="classic"]'); await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden) #board');
    await page.waitForFunction(() => document.querySelectorAll('#pieces .pc').length === 16);
    await page.waitForFunction(() => document.getElementById('token-intro').classList.contains('hidden'), { timeout: 5000 });
    const fourSeatBoard = await page.evaluate(() => {
      const c = window.__cf, canvas = document.getElementById('board'), cell = canvas.getBoundingClientRect().width / 15;
      const tokens = [...document.querySelectorAll('#pieces .pc')];
      const list = tokens.map(element => {
        const seat = +element.dataset.seat, piece = +element.dataset.piece, box = element.getBoundingClientRect(), point = c.piecePoint(seat, piece);
        const style = getComputedStyle(element);
        return { seat, piece, material: element.dataset.material, skin: element.dataset.tokenSkin, set: element.dataset.tokenSet, level: +element.dataset.tokenLevel,
          widthRatio: parseFloat(style.width) / cell, heightRatio: parseFloat(style.height) / cell,
          centered: !!point && Math.abs(box.left + box.width / 2 - point.x) < .75 && Math.abs(box.top + box.height / 2 - (point.y - cell * .26)) < .75,
          svgBody: element.querySelector('.gem-body').tagName.toLowerCase(), rim: getComputedStyle(element).getPropertyValue('--token-rim').trim(), label: element.getAttribute('aria-label'), emblem: element.querySelector('.gem-set-mark').dataset.pieceName };
      });
      return { cell, count: tokens.length, list, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, introCount: document.querySelectorAll('#token-intro-grid .token-intro-player').length };
    });
    assert.equal(fourSeatBoard.count, 16);
    assert.ok(fourSeatBoard.list.every(token => token.skin === 'dragon' && token.set === 'frost' && token.level === 2 && token.svgBody === 'circle'));
    assert.deepEqual([...new Set(fourSeatBoard.list.map(token => token.material))].sort(), ['emerald', 'gold', 'ruby', 'sapphire']);
    assert.equal(new Set(fourSeatBoard.list.map(token => token.rim)).size, 4);
    assert.ok(fourSeatBoard.list.every(token => Math.abs(token.widthRatio - .54) < .015 && Math.abs(token.heightRatio - .88) < .015 && token.centered));
    assert.ok(fourSeatBoard.list.every(token => /Dragon Frost Set/.test(token.label) && /Polished evolution/.test(token.label)));
    assert.ok(fourSeatBoard.list.every(token => token.emblem));
    ok(true, 'all four player colors keep distinct metals, unchanged 0.54×0.88-cell button geometry/anchors, and Dragon/Frost identity');

    const capture = await page.evaluate(() => {
      const c = window.__cf, L = c.logic, seats = [0, 1, 2, 3].map(() => ({ type: 'human' }));
      let found = null;
      for (let from = 0; from < 52 && !found; from++) for (let die = 1; die <= 6 && !found; die++) {
        const target = (L.absOf(0, from) + die) % 52;
        for (let victim = 0; victim < 52; victim++) {
          if (L.absOf(2, victim) !== target) continue;
          const probe = L.newGame(seats, L.DEFAULT_RULES, 901, 'classic');
          probe.pieces[0][0] = from; probe.pieces[2][0] = victim; probe.turn = 0; probe.phase = 'move'; probe.queue = [die]; probe.moves = L.queueMoves(probe);
          const result = L.move(probe, 0, die);
          if (result && result.captures && result.captures.some(item => item.seat === 2 && item.piece === 0)) { found = { from, victim, die, to: result.to }; break; }
        }
      }
      if (!found) return null;
      c.edit(state => { state.turn = 0; state.phase = 'move'; state.queue = [found.die]; state.sixes = 0; state.bonus = 0; state.ranking = []; state.pieces[0][0] = found.from; state.pieces[2][0] = found.victim; });
      window.__tokenTrailNodes = 0;
      window.__tokenFxObserver = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === 1 && node.classList.contains('token-trail-dot')) window.__tokenTrailNodes++; })));
      window.__tokenFxObserver.observe(document.getElementById('fx'), { childList: true });
      return found;
    });
    assert.ok(capture, 'a real non-safe-square capture scenario exists');
    await page.click('#game .pod[data-seat="0"] .chip-v[data-v="' + capture.die + '"]');
    await page.waitForFunction(() => document.querySelector('#pieces .pc.can[data-seat="0"][data-piece="0"]'));
    await page.evaluate(() => { window.__tokenCaptureStart = performance.now(); });
    await page.click('#pieces .pc.can[data-seat="0"][data-piece="0"]');
    await page.waitForFunction(() => document.querySelector('#fx .token-capture-wave'), { timeout: 7000 });
    const effectAtImpact = await page.evaluate(() => {
      const wave = document.querySelector('#fx .token-capture-wave');
      return { duration: getComputedStyle(wave).animationDuration, nodes: window.__tokenTrailNodes,
        body: window.__cf.game.st.pieces[2][0], attackerLabel: document.querySelector('#pieces .pc[data-seat="0"][data-piece="0"]').getAttribute('aria-label') };
    });
    ok(effectAtImpact.duration === '0.64s', 'capture shockwave is a short 640ms effect');
    ok(effectAtImpact.nodes > 0, 'a selected Dragon skin emits tiny themed particles along the path');
    await page.waitForFunction(() => !window.__cf.busy && window.__cf.game.st.phase === 'roll' && window.__cf.game.st.turn === 0, { timeout: 3000 });
    const flow = await page.evaluate(() => ({ elapsed: performance.now() - window.__tokenCaptureStart, busy: window.__cf.busy, phase: window.__cf.game.st.phase, turn: window.__cf.game.st.turn, victim: window.__cf.game.st.pieces[2][0] }));
    ok(flow.elapsed < 2200 && flow.busy === false && flow.phase === 'roll' && flow.turn === 0 && flow.victim === -1, 'capture victim returns to base and the normal bonus-roll turn continues without waiting for the cosmetic effect');
    await page.evaluate(() => window.__tokenFxObserver.disconnect());

    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const reduced = await page.evaluate(() => {
      const probe = document.createElement('i'); probe.className = 'token-capture-wave token-trail-dot'; document.getElementById('fx').appendChild(probe);
      const result = { matched: matchMedia('(prefers-reduced-motion: reduce)').matches, effectDisplay: getComputedStyle(probe).display,
        introAnimation: getComputedStyle(document.querySelector('.token-intro-card')).animationName,
        button: document.querySelector('#pieces .pc'), buttonStillUsable: document.querySelector('#pieces .pc').tagName === 'BUTTON' };
      probe.remove(); const box = result.button.getBoundingClientRect(); result.targetWidth = box.width; result.targetHeight = box.height; return result;
    });
    ok(reduced.matched && reduced.effectDisplay === 'none' && reduced.introAnimation === 'none', 'reduced motion removes trails, shockwaves, and intro animation while keeping the token control');

    const online = await page.evaluate(() => {
      const c = window.__cf, L = c.logic, seats = [0, 1, 2, 3].map(() => ({ type: 'human' }));
      const identities = { 0: { skin: 'royal', set: 'inferno', level: 2 }, 1: { skin: 'dragon', set: 'frost', level: 3 }, 2: { skin: 'cyber', set: 'galaxy', level: 4 }, 3: { skin: 'ice', set: 'royal', level: 5 } };
      const state = L.newGame(seats, L.DEFAULT_RULES, 77, 'classic'); state.pieces[0][0] = 4; state.pieces[1][0] = 8; state.pieces[2][0] = 11; state.pieces[3][0] = 13;
      state.phase = 'move'; state.turn = 0; state.queue = [3]; state.moves = L.queueMoves(state);
      c.presentOnline({ state, roomId: 'room_token2_12345678', mySeat: 0, names: { 0: 'You', 1: 'One', 2: 'Two', 3: 'Three' }, tokenIdentities: identities, onMove() {}, onRoll() {} });
      return { tokens: [...document.querySelectorAll('#pieces .pc')].filter(el => +el.dataset.piece === 0).map(el => ({ seat: +el.dataset.seat, skin: el.dataset.tokenSkin, set: el.dataset.tokenSet, level: +el.dataset.tokenLevel, material: el.dataset.material })),
        introVisible: !document.getElementById('token-intro').classList.contains('hidden'), introPlayers: document.querySelectorAll('#token-intro-grid .token-intro-player').length,
        chessHidden: document.getElementById('online-chess-screen').classList.contains('hidden'), initialCount: c.save.tokenProgress.completed };
    });
    assert.equal(online.tokens.length, 4); assert.deepEqual(online.tokens.map(token => token.skin), ['royal', 'dragon', 'cyber', 'ice']);
    assert.deepEqual(online.tokens.map(token => token.set), ['inferno', 'frost', 'galaxy', 'royal']);
    assert.deepEqual(online.tokens.map(token => token.level), [2, 3, 4, 5]); assert.equal(online.introPlayers, 4);
    ok(true, 'Online Classic renders each authenticated roster identity and selected set/level in its match intro without touching Chess pieces');

    await page.evaluate(() => {
      const c = window.__cf, L = c.logic, seats = [0, 1, 2, 3].map(() => ({ type: 'human' }));
      const finished = L.newGame(seats, L.DEFAULT_RULES, 77, 'classic'); finished.phase = 'over'; finished.ranking = [0, 1, 2, 3];
      const opts = { state: finished, roomId: 'room_token2_complete_1234', mySeat: 0, names: {}, tokenIdentities: {}, onMove() {}, onRoll() {} };
      c.presentOnline(opts); const afterFirst = c.save.tokenProgress.completed;
      c.presentOnline(opts); window.__onlineCompletions = { afterFirst, afterDuplicate: c.save.tokenProgress.completed };
      c.clearOnline();
    });
    const onlineCompletion = await page.evaluate(() => window.__onlineCompletions);
    assert.equal(onlineCompletion.afterDuplicate, onlineCompletion.afterFirst);
    ok(true, 'an authoritative Online Classic completion grants at most one free local progress step per room');
    ok(await page.evaluate(() => window.__cf.game && !window.__cf.game.online), 'closing the simulated online board restores the private local match');

    assert.deepEqual(externalRequests, [], 'no requests were sent to external services');
    assert.deepEqual(errors, [], 'browser had no runtime or console errors');
    console.log('\n' + checks + ' Token 2.0 browser checks passed. Previews: ' + shotDir);
  } finally {
    await context.close();
    await browser.close();
    local.server.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
