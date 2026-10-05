// First-match tutorial integration test in a small touch browser.
// Usage: CHROME=/usr/bin/chromium node test/tutorial.browser.test.js <url>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function ok(condition, label) {
  if (!condition) throw new Error('FAILED: ' + label);
  checks++;
  console.log('  ok -', label);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.emulate({ viewport: { width: 360, height: 740, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => errors.push('request failed: ' + request.url()));
    page.on('response', response => { if (response.status() >= 400) errors.push('HTTP ' + response.status() + ': ' + response.url()); });
    const visible = selector => page.$eval(selector, el => !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0).catch(() => false);
    const waitVisible = async selector => page.waitForFunction(s => {
      const el = document.querySelector(s);
      return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    }, { timeout: 8000 }, selector);
    const home = async () => {
      await page.click('#btn-home');
      await page.click('#btn-m-home');
      await waitVisible('#home');
    };
    const newClassic = async () => {
      await page.click('#btn-vs-ai');
      await page.click('#btn-start');
      if (await visible('#confirm')) await page.click('#confirm-yes');
      await waitVisible('#game');
      await sleep(80);
    };

    await page.goto(URL, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle0' });

    // The basic Classic guide must not claim to teach either special mode.
    await page.click('#btn-mystery');
    await page.click('#btn-start');
    await waitVisible('#game');
    ok(!(await visible('#tutorial-intro')), 'Mystery mode starts without the Classic tutorial');
    await home();

    // The first Classic match offers a genuinely optional introduction.
    await newClassic();
    await waitVisible('#tutorial-intro');
    ok(await page.$eval('#tutorial-intro', el => el.getAttribute('aria-modal') === 'true'), 'first Classic match opens an accessible intro dialog');
    ok(await page.evaluate(() => window.__cf.game.st.rolls === 0), 'AI turns stay paused until the welcome dialog is acknowledged');
    await page.focus('#tutorial-start');
    await page.keyboard.press('Tab');
    ok(await page.evaluate(() => document.activeElement.id === 'tutorial-intro-skip'), 'keyboard focus cycles to the skip action');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    ok(await page.evaluate(() => document.activeElement.id === 'tutorial-start'), 'keyboard focus cycles back to the primary action');
    await page.click('#tutorial-intro-skip');
    ok(!(await visible('#tutorial-intro')) && await page.evaluate(() => localStorage.getItem('crossfour.tutorial.v1') === '1'), 'skip dismisses the coach and stores its local one-time marker');

    await home();
    await newClassic();
    ok(!(await visible('#tutorial-intro')), 'a skipped tutorial does not return on the next Classic match');

    // Clear only the one-time marker, then exercise the live guide against actual game actions.
    await home();
    await page.evaluate(() => localStorage.removeItem('crossfour.tutorial.v1'));
    await newClassic();
    await waitVisible('#tutorial-intro');
    await page.click('#tutorial-start');
    await waitVisible('#tutorial-coach');
    await page.evaluate(() => {
      const c = window.__cf;
      c.save.settings.auto = false;
      c.persist();
      c.edit(st => {
        st.turn = 3; st.phase = 'roll'; st.queue = []; st.moves = []; st.sixes = 0; st.bonus = 0; st.rollAgain = false;
        st.pieces[3][0] = 0;
      });
    });
    ok(await page.$eval('#tutorial-title', el => el.textContent === 'Roll your die'), 'live coach points to the current human die');
    ok(await page.$eval('.pod[data-seat="3"] .pdice', el => el.classList.contains('tutorial-target')), 'the active die receives a visible tutorial highlight');

    await page.evaluate(() => window.__cf.force([3]));
    await page.click('.pod[data-seat="3"] .pdice');
    await page.waitForFunction(() => {
      const c = window.__cf;
      return c.game.st.turn === 3 && c.game.st.phase === 'move' && !c.busy;
    }, { timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('#tutorial-title').textContent === 'Choose a move', { timeout: 8000 });
    ok(await visible('#tutorial-coach') && await page.$eval('.pod[data-seat="3"] .chip-v:not(.dim)', el => el.classList.contains('tutorial-target')), 'a legal roll advances the coach to the dice-chip choice');
    await page.click('.pod[data-seat="3"] .chip-v:not(.dim)');
    const point = await page.evaluate(() => window.__cf.piecePoint(3, 0));
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(() => document.querySelector('#tutorial-title').textContent === 'Nice first move!', { timeout: 8000 });
    ok(await visible('#tutorial-done'), 'the first real token move unlocks the short win-condition recap');
    await page.click('#tutorial-done');
    ok(!(await visible('#tutorial-coach')), 'the completed coach closes without interrupting the saved match');
    ok(errors.length === 0, 'tutorial flow produces no browser errors or failed requests: ' + errors.join(' | '));
    console.log(checks + ' tutorial browser checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
