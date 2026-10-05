// Responsive, accessible home-screen mode-card browser coverage.
// Usage: CHROME=/usr/bin/chromium node test/home-mode-cards.browser.test.js <url>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const SIZES = [[320, 568], [360, 740], [390, 844], [768, 1024], [1280, 800]];
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
    async function newHome(width, height) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 640, hasTouch: width < 640 });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => errors.push('request failed: ' + request.url()));
      await page.goto(URL, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#home:not(.hidden)');
      return { context, page };
    }

    const ids = ['btn-vs-ai', 'btn-lucky', 'btn-mystery', 'btn-pass'];
    for (const [width, height] of SIZES) {
      const { context, page } = await newHome(width, height);
      const layout = await page.evaluate(ids => {
        const buttons = ids.map(id => document.getElementById(id));
        const rect = element => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const visible = element => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element);
          return s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        };
        const actions = document.querySelector('#home .home-actions');
        const utility = document.querySelector('#home .home-row');
        const community = document.querySelector('#btn-community');
        const buttonData = buttons.map(button => {
          const title = document.getElementById(button.getAttribute('aria-labelledby'));
          const subtitle = document.getElementById(button.getAttribute('aria-describedby'));
          const icon = button.querySelector('.mode-card-icon svg');
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            visible: visible(button),
            native: button.tagName === 'BUTTON' && button.type === 'button' && button.tabIndex === 0,
            title: title && title.textContent.trim(),
            subtitle: subtitle && subtitle.textContent.trim(),
            labelled: !!title && button.getAttribute('aria-labelledby') === title.id,
            described: !!subtitle && button.getAttribute('aria-describedby') === subtitle.id,
            boldTitle: !!title && Number(getComputedStyle(title).fontWeight) >= 700,
            subtleSubtitle: !!subtitle && getComputedStyle(subtitle).color !== getComputedStyle(title).color,
            distinctIcon: !!icon && icon.closest('.mode-card-icon')?.getAttribute('aria-hidden') === 'true' && icon.getAttribute('focusable') === 'false',
            hitTarget: hit === button || button.contains(hit),
            box: rect(button)
          };
        });
        const boxes = buttonData.map(item => item.box);
        const grid = getComputedStyle(actions);
        const utilityBox = rect(utility), communityBox = rect(community);
        const cardsBottom = Math.max(...boxes.map(box => box.bottom));
        return {
          grid: grid.display === 'grid' && grid.gridTemplateColumns.trim().split(/\s+/).length === 2,
          rows: Math.abs(boxes[0].top - boxes[1].top) < 2 && Math.abs(boxes[2].top - boxes[3].top) < 2 && boxes[2].top > boxes[0].top,
          distinctIcons: new Set(buttons.map(button => button.querySelector('.mode-card-icon svg').innerHTML)).size === 4,
          cards: buttonData,
          compact: boxes.every(box => box.width > 0 && box.height >= 88 && box.height <= 128),
          belowGrid: utilityBox.top >= cardsBottom && communityBox.top >= utilityBox.bottom,
          utilitiesVisible: ['btn-skins', 'btn-rules', 'btn-settings', 'btn-community'].every(id => visible(document.getElementById(id))),
          horizontalFit: document.documentElement.scrollWidth <= innerWidth,
          gridStyle: getComputedStyle(buttons[0]).backdropFilter
        };
      }, ids);
      ok(layout.grid && layout.rows, width + '×' + height + ': four mode cards render as a clear two-column, two-row grid');
      ok(layout.cards.every(card => card.visible && card.hitTarget), width + '×' + height + ': every card is visibly rendered and its center is clickable');
      ok(layout.cards.every(card => card.native && card.labelled && card.described && card.boldTitle && card.subtleSubtitle && card.distinctIcon), width + '×' + height + ': cards expose native button semantics, named titles, descriptions, distinct decorative icons, and clear text hierarchy');
      ok(layout.distinctIcons && layout.compact && layout.gridStyle.includes('blur'), width + '×' + height + ': crystal cards have four unique icons and compact frosted styling');
      ok(layout.belowGrid && layout.utilitiesVisible && layout.horizontalFit, width + '×' + height + ': Skins, Rules, Settings, and Leaderboard remain balanced below the grid without horizontal overflow');
      if (width === 390) {
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => ({ id: document.activeElement.id, outline: getComputedStyle(document.activeElement).outlineStyle }));
        ok(focused.id === 'btn-vs-ai' && focused.outline === 'solid', 'phone keyboard navigation reaches the first card with a visible focus ring');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#setup:not(.hidden)');
        ok(true, 'the focused Play vs Computer card activates the existing setup flow with Enter');
      }
      await context.close();
    }

    for (const entry of [
      { id: 'btn-vs-ai', mode: 'classic' },
      { id: 'btn-lucky', mode: 'lucky' },
      { id: 'btn-mystery', mode: 'mystery' },
      { id: 'btn-pass', mode: null }
    ]) {
      const { context, page } = await newHome(390, 844);
      await page.click('#' + entry.id);
      await page.waitForSelector('#setup:not(.hidden)');
      if (entry.mode) {
        const selected = await page.$eval('#mode-seg button.on', button => button.dataset.mode);
        ok(selected === entry.mode, entry.id + ' preserves its existing ' + entry.mode + ' setup action');
      } else {
        ok(await page.$eval('#setup', element => !element.classList.contains('hidden')), 'btn-pass preserves the existing pass-and-play setup action');
      }
      await context.close();
    }

    ok(errors.length === 0, 'home-card views produce no browser errors or failed requests: ' + errors.join(' | '));
    console.log(checks + ' home-card browser checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
