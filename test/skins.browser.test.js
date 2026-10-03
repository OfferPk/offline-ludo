// Local-only mobile browser coverage for the real skin shop. No remote requests are allowed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETE || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const OUT = process.argv[3] || '/tmp/crossfour-skin-screenshots';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function ok(condition, message) { assert.ok(condition, message); checks++; console.log('  ok -', message); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const origin = new URLCtor(URL).origin;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 320, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
  const errors = [], remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:') && !request.url().startsWith('about:')) {
      remoteRequests.push(request.url()); request.abort();
    } else request.continue();
  });
  await page.setRequestInterception(true);
  const reload = async () => { await page.reload({ waitUntil: 'networkidle0' }); await sleep(120); };
  const seedSave = async (key, value) => {
    await page.evaluate((k, v) => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); localStorage.setItem(k, JSON.stringify(v)); }, key, value);
    await reload();
  };

  try {
    console.log('Testing', URL, 'at 320px; screenshots:', OUT);
    await page.goto(URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); }); await reload();

    // v1 and v2 are migrated, while v3 primary/checkpoint snapshots are normalized in place.
    const v1 = { coins: 77, xp: 123, owned: { boards: ['linen'], dice: ['brass'] }, board: 'linen', dice: 'brass',
      stats: { played: 4, won: 2 }, settings: { sound: false, fast: true }, ad: { matchesCompleted: 3 } };
    await seedSave('crossfour.save.v1', v1);
    let migrated = await page.evaluate(() => ({ status: window.__cf.loadStatus, save: window.__cf.save }));
    ok(migrated.status === 'migrated-v1' && migrated.save.coins === 77 && migrated.save.board === 'linen' && migrated.save.dice === 'brass', 'v1 save migration retains coins and selected legacy skins');
    ok(migrated.save.stats.streak === 0 && migrated.save.flags.diamondCollection === false && migrated.save.owned.boards.includes('linen') && migrated.save.owned.dice.includes('brass'), 'v1 gains safe streak/event defaults without losing owned skins');

    const legacyV2 = await page.evaluate(() => {
      const s = JSON.parse(JSON.stringify(window.__cf.save));
      s.coins = 321; s.board = 'walnut'; s.dice = 'frost'; s.owned.boards.push('walnut'); s.owned.dice.push('frost');
      delete s.stats.streak; delete s.flags; return s;
    });
    await seedSave('crossfour.save.v2', legacyV2);
    migrated = await page.evaluate(() => ({ status: window.__cf.loadStatus, save: window.__cf.save }));
    ok(migrated.status === 'migrated-v2' && migrated.save.coins === 321 && migrated.save.board === 'walnut' && migrated.save.dice === 'frost', 'v2 save migration retains progression and selected legacy skins');
    ok(migrated.save.stats.streak === 0 && migrated.save.flags.diamondCollection === false, 'v2 receives backward-compatible achievement and event defaults');

    const legacyV3 = await page.evaluate(() => {
      const s = JSON.parse(JSON.stringify(window.__cf.save));
      s.coins = 432; s.board = 'aurora'; s.dice = 'ember'; s.owned.boards.push('aurora'); s.owned.dice.push('ember');
      delete s.stats.streak; delete s.flags;
      return { schemaVersion: 3, savedAt: 1700000000000, payload: s };
    });
    await page.evaluate(snapshot => {
      localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); localStorage.setItem('crossfour.save.v3', JSON.stringify(snapshot));
      localStorage.setItem('crossfour.save.checkpoint.v3', JSON.stringify(snapshot));
    }, legacyV3);
    await reload();
    migrated = await page.evaluate(() => ({ status: window.__cf.loadStatus, save: window.__cf.save }));
    ok(migrated.status === 'loaded' && migrated.save.coins === 432 && migrated.save.board === 'aurora' && migrated.save.dice === 'ember', 'old v3 primary snapshot is accepted and keeps its selected IDs');
    ok(migrated.save.stats.streak === 0 && migrated.save.flags.diamondCollection === false, 'old v3 primary/checkpoint are normalized without schema loss');

    // Start shop tests from a clean local-only profile.
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); }); await reload();
    await page.click('#btn-skins'); await page.waitForSelector('#skins:not(.hidden) #skin-grid [data-id="graphite"]');
    ok(await page.$$eval('#skin-grid [data-id]', nodes => nodes.length) === 20, 'real Boards tab renders all 20 boards');
    ok(await page.evaluate(() => {
      const box = document.getElementById('skins').querySelector('.panel');
      const grid = document.getElementById('skin-grid');
      return document.documentElement.scrollWidth <= innerWidth && box.scrollWidth <= box.clientWidth + 1 && grid.scrollWidth <= grid.clientWidth + 1;
    }), 'expanded two-column Board shop fits a 320px phone without horizontal overflow');
    await page.screenshot({ path: path.join(OUT, 'skins-boards-mobile.png') });
    await page.$eval('[data-id="galaxy"]', el => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(OUT, 'skins-boards-new-rows.png') });
    const galaxyCard = await page.$('[data-id="galaxy"]');
    await galaxyCard.screenshot({ path: path.join(OUT, 'skin-preview-galaxy.png') });
    ok(await page.$eval('[data-id="galaxy"] canvas', canvas => canvas.width > 0 && canvas.getAttribute('aria-label') === 'Galaxy board preview'), 'Galaxy board preview draws the actual board renderer');
    ok(await page.$eval('[data-id="diamond"] button', button => button.disabled && /future event/i.test(button.textContent)), 'Diamond board remains locked without an event flag');
    ok(await page.$eval('[data-id="champion"] small', note => /50 lifetime wins/i.test(note.textContent)), 'Champion card shows its real 50-win requirement');
    ok(await page.$eval('[data-id="streak-master"] small', note => /10 consecutive wins/i.test(note.textContent)), 'Streak Master card shows its real streak requirement');

    await page.evaluate(() => { window.__cf.save.coins = 2500; window.__cf.persist(); document.querySelector('#skin-tabs [data-tab="boards"]').click(); });
    await page.waitForFunction(() => !document.querySelector('[data-id="ocean"] button').disabled);
    const beforeFail = await page.evaluate(() => ({ coins: window.__cf.save.coins, board: window.__cf.save.board }));
    await page.evaluate(() => {
      const proto = Storage.prototype; window.__skinOriginalSetItem = proto.setItem;
      proto.setItem = function (key, value) { if (key === 'crossfour.save.v3') throw new DOMException('quota exceeded', 'QuotaExceededError'); return window.__skinOriginalSetItem.call(this, key, value); };
    });
    await page.$eval('[data-id="ocean"] button', button => button.click()); await sleep(80);
    let failedPurchase = await page.evaluate(() => ({ coins: window.__cf.save.coins, board: window.__cf.save.board, owned: window.__cf.save.owned.boards.slice(), warning: !document.getElementById('save-warning').classList.contains('hidden') }));
    ok(failedPurchase.coins === beforeFail.coins && failedPurchase.board === beforeFail.board && !failedPurchase.owned.includes('ocean') && failedPurchase.warning, 'storage failure rolls back coins, ownership and selection without a false success');
    await page.evaluate(() => { Storage.prototype.setItem = window.__skinOriginalSetItem; window.__cf.persist(); document.querySelector('#skin-tabs [data-tab="boards"]').click(); });

    await page.$eval('[data-id="galaxy"] button', button => button.click());
    let purchased = await page.evaluate(() => {
      const c = window.__cf, snapshot = JSON.parse(localStorage.getItem('crossfour.save.v3'));
      return { coins: c.save.coins, board: c.save.board, owned: c.save.owned.boards.filter(id => id === 'galaxy').length,
        diskCoins: snapshot.payload.coins, diskBoard: snapshot.payload.board, diskOwned: snapshot.payload.owned.boards.includes('galaxy'), bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
    });
    ok(purchased.coins === 1900 && purchased.board === 'galaxy' && purchased.owned === 1, 'Galaxy purchase deducts exactly 600 coins, owns once and equips');
    ok(purchased.diskCoins === 1900 && purchased.diskBoard === 'galaxy' && purchased.diskOwned && purchased.bg === '#0b0b1d', 'Galaxy ownership, selection and palette persist locally and apply to UI');
    await page.$eval('[data-id="linen"] button', button => button.click());
    await page.$eval('[data-id="galaxy"] button', button => button.click());
    ok(await page.evaluate(() => window.__cf.save.coins === 1900 && window.__cf.save.owned.boards.filter(id => id === 'galaxy').length === 1), 're-equipping an owned Board skin never charges a second time');
    await reload();
    ok(await page.evaluate(() => window.__cf.save.board === 'galaxy' && window.__cf.save.coins === 1900 && window.__cf.save.owned.boards.includes('galaxy')), 'equipped Board skin and coin balance survive reload');
    await page.click('#btn-skins'); await page.waitForSelector('[data-id="galaxy"]');

    await page.click('#skin-tabs button[data-tab="dice"]');
    ok(await page.$$eval('#skin-grid [data-id]', nodes => nodes.length) === 17, 'real Dice tab renders all 17 dice styles');
    ok(await page.evaluate(() => {
      const box = document.getElementById('skins').querySelector('.panel'), grid = document.getElementById('skin-grid');
      return document.documentElement.scrollWidth <= innerWidth && box.scrollWidth <= box.clientWidth + 1 && grid.scrollWidth <= grid.clientWidth + 1;
    }), 'expanded Dice shop and long coin labels fit at 320px without horizontal overflow');
    await page.screenshot({ path: path.join(OUT, 'skins-dice-mobile.png') });
    await page.$eval('[data-id="crystal-dice"]', el => el.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: path.join(OUT, 'skins-dice-new-rows.png') });
    const rainbowDice = await page.$('[data-id="rainbow-dice"] .dprev');
    await rainbowDice.screenshot({ path: path.join(OUT, 'skin-preview-rainbow-dice.png') });
    ok(await page.$eval('[data-id="ivory"] button', button => /In use/i.test(button.textContent)), 'original Ivory dice remain the unchanged starter selection');
    ok(await page.$eval('[data-id="diamond-dice"] button', button => button.disabled && /future event/i.test(button.textContent)), 'Diamond Dice remain event-locked without a real flag');
    ok(await page.$eval('[data-id="rainbow-dice"] .dprev', preview => preview.style.backgroundImage.includes('linear-gradient')), 'Rainbow Dice preview renders its distinct multi-colour finish');
    await page.$eval('[data-id="classic-white"] button', button => button.click());
    ok(await page.evaluate(() => window.__cf.save.dice === 'classic-white' && window.__cf.save.coins === 1900 && window.__cf.save.owned.dice.includes('classic-white')), 'Classic White is a free unlock while Ivory and coin balance remain unchanged');
    await page.$eval('[data-id="graphite-dice"] button', button => button.click());
    ok(await page.evaluate(() => window.__cf.save.dice === 'graphite-dice' && window.__cf.save.coins === 1750), 'Graphite Dice costs exactly 150 coins and equips');
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(120);
    ok(await page.evaluate(() => window.__cf.save.dice === 'graphite-dice' && window.__cf.save.coins === 1750), 'equipped Dice style and balance survive reload');

    // One synthetic, local match settlement checks the actual game-to-achievement integration.
    await page.evaluate(() => {
      const c = window.__cf; c.save.stats.won = 49; c.save.stats.streak = 9;
      c.save.setup.ai = [{ type: 'human' }, { type: 'ai', level: 'easy' }, null, null]; c.persist();
    });
    await page.click('#btn-vs-ai'); await page.click('#btn-start');
    await page.waitForSelector('#game:not(.hidden)');
    await page.evaluate(() => window.__cf.edit(st => { st.phase = 'over'; st.ranking = [0, 1]; }));
    await page.waitForFunction(() => window.__cf.save.stats.won === 50 && window.__cf.save.stats.streak === 10, { timeout: 5000 });
    let achievements = await page.evaluate(() => ({ boards: window.__cf.save.owned.boards.slice(), disk: JSON.parse(localStorage.getItem('crossfour.save.v3')).payload.owned.boards.slice() }));
    ok(achievements.boards.includes('champion') && achievements.boards.includes('streak-master') && !achievements.boards.includes('legendary'), 'settling the 50th win and 10th consecutive win grants only the two earned Board rewards');
    ok(achievements.disk.includes('champion') && achievements.disk.includes('streak-master'), 'achievement ownership is written to the local save');
    const statsAfterWin = await page.evaluate(() => ({ played: window.__cf.save.stats.played, won: window.__cf.save.stats.won, streak: window.__cf.save.stats.streak }));
    await page.evaluate(() => window.__cf.edit(st => { st.phase = 'over'; st.ranking = [0, 1]; })); await sleep(950);
    ok(await page.evaluate(before => window.__cf.save.stats.played === before.played && window.__cf.save.stats.won === before.won && window.__cf.save.stats.streak === before.streak, statsAfterWin), 'duplicate result settlement does not record a second match or unlock');

    // A subsequent non-win resets the minimal current streak counter.
    await page.click('#btn-r-home'); await page.waitForSelector('#home:not(.hidden)');
    await page.evaluate(() => { window.__cf.save.stats.streak = 4; window.__cf.persist(); });
    await page.click('#btn-vs-ai'); await page.click('#btn-start'); await page.waitForSelector('#game:not(.hidden)');
    await page.evaluate(() => window.__cf.edit(st => { st.phase = 'over'; st.ranking = [1, 0]; }));
    await page.waitForFunction(() => window.__cf.save.stats.streak === 0, { timeout: 5000 });
    ok(await page.evaluate(() => window.__cf.save.stats.won === 50 && window.__cf.save.stats.streak === 0), 'a settled non-win resets the consecutive-win counter without changing lifetime wins');

    ok(remoteRequests.length === 0, 'all browser interactions stayed local with no backend or external requests');
    ok(errors.length === 0, 'no browser JavaScript, console or network errors');
    console.log(`\n${checks} skin browser checks passed. Screenshots: ${OUT}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

function URLCtor(value) { return new (require('url').URL)(value); }
