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
    async function resetPage(width = 390, height = 844) {
      if (context) await context.close();
      context = await browser.createBrowserContext();
      page = await context.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 640, hasTouch: width < 640 });
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

    async function startMatch(mode, width = 390, height = 844) {
      await resetPage(width, height);
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

    async function assertExitPlacement(width, height, mode) {
      await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 640, hasTouch: width < 640 });
      await page.waitForFunction(() => {
        const button = document.querySelector('#btn-exit-match');
        return button && button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0;
      });
      const placement = await page.evaluate(() => {
        const button = document.querySelector('#btn-exit-match');
        const box = button.getBoundingClientRect();
        const header = button.closest('.topbar');
        const headerBox = header.getBoundingClientRect();
        const style = getComputedStyle(button);
        const overlaps = selector => Array.from(document.querySelectorAll(selector)).some(el => {
          if (el === button || el.closest('.hidden')) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top;
        });
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        const actions = button.parentElement;
        const siblings = Array.from(actions.children).filter(el => el !== button);
        return {
          visible: style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0 && box.width >= 58 && box.height >= 36,
          inViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
          inTopbar: !!header && !!actions.classList.contains('topbar-actions') && header.contains(button),
          topRight: box.right >= innerWidth - 20 && siblings.every(el => box.left >= el.getBoundingClientRect().right),
          hitTarget: hit === button || button.contains(hit),
          accessible: button.tagName === 'BUTTON' && button.type === 'button' && button.tabIndex === 0 && button.getAttribute('aria-label') === 'Exit match' && button.textContent.trim() === 'Home' && !button.disabled,
          compact: box.width <= 68 && box.height <= 44,
          avoidsDiceAndTokens: !overlaps('.pdice, #pieces .pc'),
          headerClear: box.top >= headerBox.top && box.bottom <= headerBox.bottom
        };
      });
      ok(placement.visible && placement.inViewport, mode + ' ' + width + '×' + height + ': Home is visibly rendered inside the viewport');
      ok(placement.inTopbar && placement.topRight, mode + ' ' + width + '×' + height + ': compact Home action sits at the top-right of the match header');
      ok(placement.hitTarget && placement.accessible && placement.headerClear, mode + ' ' + width + '×' + height + ': Home is a clear, keyboard-focusable button with an accessible name');
      ok(placement.compact && placement.avoidsDiceAndTokens, mode + ' ' + width + '×' + height + ': Home stays compact and does not cover dice or tokens');
    }

    for (const mode of ['classic', 'mystery', 'lucky']) {
      const fixture = await startMatch(mode);
      await assertExitPlacement(390, 844, mode);
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

    for (const size of [[320, 568], [360, 640], [390, 844], [768, 1024], [1280, 800]]) {
      await startMatch('classic', size[0], size[1]);
      await assertExitPlacement(size[0], size[1], 'classic');
    }
    const finalFixture = await startMatch('classic');
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
    ok(held === finalFixture.rolls && await page.$eval('#confirm', el => !el.classList.contains('hidden')), 'open confirmation cannot trigger a stray auto-roll');

    await page.click('#confirm-no');
    await page.waitForFunction(() => !window.__cf.paused && document.querySelector('#confirm').classList.contains('hidden'));
    const active = await page.evaluate(seat => {
      const die = document.querySelector('.pod[data-seat="' + seat + '"] .pdice');
      return !die.disabled && document.querySelector('#game').classList.contains('hidden') === false;
    }, finalFixture.seat);
    ok(active, 'Cancel closes the dialog and resumes an enabled game');
    await page.click('.pod[data-seat="' + finalFixture.seat + '"] .pdice');
    await page.waitForFunction(start => window.__cf.game.st.rolls > start, { timeout: 3000 }, finalFixture.rolls);
    ok(await page.evaluate(start => window.__cf.game.st.rolls === start + 1, finalFixture.rolls), 'resumed play accepts a normal manual dice roll');

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
