// Focused browser coverage for the 4-second turn auto-roll and exit confirmation.
// Usage: CHROME=/usr/bin/chromium node test/turn-controls.browser.test.js <url>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function ok(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  checks++;
  console.log('  ok -', message);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox']
  });
  try {
    const errors = [];
    let context = null, page = null;
    async function resetPage() {
      if (context) await context.close();
      context = await browser.createBrowserContext();
      page = await context.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => errors.push('request failed: ' + request.url()));
      await page.goto(URL, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('crossfour.tutorial.v1', '1');
      });
      await page.reload({ waitUntil: 'networkidle0' });
    }

    async function startMatch(mode) {
      await resetPage();
      await page.waitForSelector('#home:not(.hidden)');
      await page.click('#btn-pass');
      await page.click('#mode-seg button[data-mode="' + mode + '"]');
      await page.click('#presets button[data-p="1v1"]');
      await page.click('#btn-start');
      await page.waitForFunction(() => window.__cf && window.__cf.game && !document.querySelector('#game').classList.contains('hidden'));
      const fixture = await page.evaluate(() => {
        const c = window.__cf;
        const seat = c.game.st.players.find(s => c.game.seats[s].type === 'human');
        c.save.settings.auto = false;
        c.force([1]);
        c.edit(st => {
          st.turn = seat;
          st.phase = 'roll';
          st.queue = [];
          st.moves = [];
          st.sixes = 0;
          st.bonus = 0;
          st.rollAgain = false;
          st.pending = null;
        });
        return { seat, rolls: c.game.st.rolls, startedAt: Date.now() };
      });
      return fixture;
    }

    for (const mode of ['classic', 'mystery', 'lucky']) {
      const fixture = await startMatch(mode);
      await page.waitForFunction(seat => {
        const die = document.querySelector('.pod[data-seat="' + seat + '"] .pdice');
        return die && die.classList.contains('counting') && die.querySelector('.roll-countdown');
      }, { timeout: 3000 }, fixture.seat);
      const timer = await page.$eval('.pod[data-seat="' + fixture.seat + '"] .pdice', die => ({
        durationMs: (() => {
          const duration = getComputedStyle(die.querySelector('.roll-countdown'), '::after').animationDuration;
          const value = parseFloat(duration);
          return duration.endsWith('ms') ? value : value * 1000;
        })(),
        label: die.getAttribute('aria-label')
      }));
      ok(timer.durationMs === 4000, mode + ': active die displays the full four-second countdown');
      ok(/tap or swipe/i.test(timer.label), mode + ': countdown retains the accessible roll action');
      await sleep(700);
      const beforeDeadline = await page.evaluate(() => window.__cf.game.st.rolls);
      ok(beforeDeadline === fixture.rolls, mode + ': no roll fires early');
      await page.waitForFunction(start => window.__cf.game.st.rolls > start, { timeout: 7000 }, fixture.rolls);
      const rolled = await page.evaluate(seat => ({
        rolls: window.__cf.game.st.rolls,
        face: window.__cf.game.st.faces[seat],
        paused: window.__cf.paused
      }), fixture.seat);
      const elapsed = await page.evaluate(start => Date.now() - start, fixture.startedAt);
      ok(rolled.rolls === fixture.rolls + 1 && rolled.face === 1, mode + ': timeout performs exactly one normal forced dice roll');
      ok(elapsed >= 3800 && elapsed < 7000 && !rolled.paused, mode + ': automatic roll begins after approximately four seconds while play is active');
    }

    const fixture = await startMatch('classic');
    await page.waitForSelector('#btn-exit-match');
    await page.click('#btn-exit-match');
    await page.waitForSelector('#confirm:not(.hidden)');
    const dialog = await page.evaluate(() => ({
      text: document.querySelector('#confirm-text').textContent,
      yes: document.querySelector('#confirm-yes').textContent,
      no: document.querySelector('#confirm-no').textContent,
      styled: document.querySelector('#confirm').classList.contains('exit-confirm'),
      paused: window.__cf.paused
    }));
    ok(dialog.text === 'Are you sure you want to exit the match? Progress will be lost.', 'exit dialog uses the exact requested warning');
    ok(dialog.yes === 'Exit' && dialog.no === 'Cancel' && dialog.styled, 'exit dialog offers Exit and Cancel with the crystal styling');
    ok(dialog.paused, 'opening the exit dialog pauses the match');
    await sleep(4300);
    const held = await page.evaluate(() => window.__cf.game.st.rolls);
    ok(held === fixture.rolls && await page.$eval('#confirm', el => !el.classList.contains('hidden')), 'open confirmation cannot trigger a stray auto-roll');

    await page.click('#confirm-no');
    await page.waitForFunction(() => !window.__cf.paused && document.querySelector('#confirm').classList.contains('hidden'));
    const active = await page.evaluate(seat => {
      const die = document.querySelector('.pod[data-seat="' + seat + '"] .pdice');
      return !die.disabled && document.querySelector('#game').classList.contains('hidden') === false;
    }, fixture.seat);
    ok(active, 'Cancel closes the dialog and resumes an enabled game');
    await page.click('.pod[data-seat="' + fixture.seat + '"] .pdice');
    await page.waitForFunction(start => window.__cf.game.st.rolls > start, { timeout: 3000 }, fixture.rolls);
    ok(await page.evaluate(start => window.__cf.game.st.rolls === start + 1, fixture.rolls), 'resumed play accepts a normal manual dice roll');

    await page.click('#btn-exit-match');
    await page.waitForSelector('#confirm:not(.hidden)');
    await page.click('#confirm-yes');
    await page.waitForSelector('#home:not(.hidden)');
    const discarded = await page.evaluate(() => ({
      current: window.__cf.game,
      saved: window.__cf.save.game,
      continueVisible: !document.querySelector('#btn-continue').classList.contains('hidden')
    }));
    ok(discarded.current === null && discarded.saved === null && !discarded.continueVisible, 'Exit discards the match and returns to the main menu');
    ok(errors.length === 0, 'turn controls produce no browser errors or failed requests: ' + errors.join(' | '));
    console.log(checks + ' turn-control browser checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
