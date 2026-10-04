// Responsive, accessible home-screen navigation and Statistics browser coverage.
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

    const modeIds = ['btn-vs-ai', 'btn-lucky', 'btn-mystery', 'btn-pass'];
    const navIds = ['btn-skins', 'btn-rules', 'btn-settings', 'btn-community'];
    for (const [width, height] of SIZES) {
      const { context, page } = await newHome(width, height);
      const layout = await page.evaluate(({ modeIds, navIds }) => {
        const rect = element => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const rendered = element => {
          const r = element.getBoundingClientRect(), s = getComputedStyle(element);
          return s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
        };
        const modes = modeIds.map(id => document.getElementById(id));
        const nav = navIds.map(id => document.getElementById(id));
        const utility = document.querySelector('.home-nav-grid');
        const utilityStyle = getComputedStyle(utility);
        const modeStyle = getComputedStyle(document.querySelector('#home .home-actions'));
        const online = document.getElementById('btn-online'), stats = document.getElementById('btn-stats');
        const statsBox = rect(stats), onlineBox = rect(online), navBox = rect(utility);
        const navData = nav.map(button => {
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const title = button.querySelector('[id$="-title"], .community-launch-copy b');
          const subtitle = button.querySelector('[id$="-note"], .community-launch-copy small');
          const icon = button.querySelector('.home-nav-icon svg');
          return {
            id: button.id,
            rendered: rendered(button),
            native: button.tagName === 'BUTTON' && button.type === 'button' && button.tabIndex === 0,
            title: title && title.textContent.trim(),
            subtitle: subtitle && subtitle.textContent.trim(),
            labelled: button.id === 'btn-community' ? button.getAttribute('aria-label') === 'Open leaderboard and referrals' : !!title && button.getAttribute('aria-labelledby') === title.id,
            described: button.id === 'btn-community' || (!!subtitle && button.getAttribute('aria-describedby') === subtitle.id),
            decorativeIcon: !!icon && icon.closest('.home-nav-icon').getAttribute('aria-hidden') === 'true' && icon.getAttribute('focusable') === 'false',
            hitTarget: hit === button || button.contains(hit),
            box: rect(button),
            blur: getComputedStyle(button).backdropFilter.includes('blur'),
            border: getComputedStyle(button).borderTopWidth !== '0px'
          };
        });
        const navBoxes = navData.map(item => item.box);
        const modeBoxes = modes.map(rect);
        const modeTitles = modes.map(button => document.getElementById(button.getAttribute('aria-labelledby')));
        const modeSubtitles = modes.map(button => document.getElementById(button.getAttribute('aria-describedby')));
        const modeIcons = modes.map(button => button.querySelector('.mode-card-icon svg'));
        return {
          modes: modes.map((button, i) => ({
            rendered: rendered(button), native: button.tagName === 'BUTTON' && button.type === 'button' && button.tabIndex === 0,
            labelled: !!modeTitles[i] && button.getAttribute('aria-labelledby') === modeTitles[i].id,
            described: !!modeSubtitles[i] && button.getAttribute('aria-describedby') === modeSubtitles[i].id,
            title: modeTitles[i] && modeTitles[i].textContent.trim(),
            subtitle: modeSubtitles[i] && modeSubtitles[i].textContent.trim(),
            box: modeBoxes[i]
          })),
          modeGrid: modeStyle.display === 'grid' && modeStyle.gridTemplateColumns.trim().split(/\s+/).length === 2,
          modeRows: Math.abs(modeBoxes[0].top - modeBoxes[1].top) < 2 && Math.abs(modeBoxes[2].top - modeBoxes[3].top) < 2 && modeBoxes[2].top > modeBoxes[0].top,
          modeIcons: new Set(modeIcons.map(icon => icon.innerHTML)).size === 4,
          utilityGrid: utilityStyle.display === 'grid' && utilityStyle.gridTemplateColumns.trim().split(/\s+/).length === 2,
          utilityRows: Math.abs(navBoxes[0].top - navBoxes[1].top) < 2 && Math.abs(navBoxes[2].top - navBoxes[3].top) < 2 && navBoxes[2].top > navBoxes[0].top,
          navData,
          labels: nav.map(button => button.id === 'btn-community' ? button.querySelector('.community-launch-copy b').textContent.trim() : button.querySelector('[id$="-title"]').textContent.trim()),
          stats: {
            directAfterOnline: online.nextElementSibling === stats,
            directBeforeNav: stats.nextElementSibling === utility,
            gapAfterOnline: statsBox.top - onlineBox.bottom,
            rendered: rendered(stats), native: stats.tagName === 'BUTTON' && stats.type === 'button' && stats.tabIndex === 0,
            label: stats.getAttribute('aria-label'),
            blur: getComputedStyle(stats).backdropFilter.includes('blur'),
            metrics: [document.getElementById('home-stat-played').textContent.trim(), document.getElementById('home-stat-won').textContent.trim()],
            progressbar: stats.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
            box: statsBox
          },
          widths: { root: document.documentElement.scrollWidth, main: document.querySelector('.home-main').scrollWidth, mainClient: document.querySelector('.home-main').clientWidth },
          homeMain: { overflowY: getComputedStyle(document.querySelector('.home-main')).overflowY, scrollHeight: document.querySelector('.home-main').scrollHeight, clientHeight: document.querySelector('.home-main').clientHeight },
          navBounds: navBox,
          viewport: { width: innerWidth, height: innerHeight },
          iconsUnique: new Set(nav.map(button => button.querySelector('.home-nav-icon svg').innerHTML)).size === 4
        };
      }, { modeIds, navIds });

      ok(layout.modeGrid && layout.modeRows, width + '×' + height + ': four game modes stay in a clear 2×2 grid');
      ok(layout.modes.every(card => card.rendered && card.native && card.labelled && card.described && card.box.height >= 88), width + '×' + height + ': mode cards retain native semantics, descriptions, and comfortable hit areas');
      ok(layout.modeIcons && layout.utilityGrid && layout.utilityRows, width + '×' + height + ': utility destinations render as a consistent 2×2 card grid with distinct icons');
      ok(layout.navData.every(card => card.rendered && card.native && card.labelled && card.described && card.decorativeIcon && card.box.height >= 44 && card.blur && card.border), width + '×' + height + ': every utility card has a clear accessible label, decorative icon, glass styling, and a touch-sized target');
      ok(layout.labels.join('|') === 'Skins|Rules|Settings|Leaderboard & referrals', width + '×' + height + ': existing Skins, Rules, Settings, and Leaderboard labels are unchanged');
      ok(layout.stats.directAfterOnline && layout.stats.directBeforeNav && layout.stats.gapAfterOnline >= 0 && layout.stats.gapAfterOnline <= 20, width + '×' + height + ': compact Statistics card sits directly below Online rooms and above the utility grid');
      ok(layout.stats.rendered && layout.stats.native && layout.stats.label === 'Open Statistics' && layout.stats.blur && layout.stats.box.height >= 72 && layout.stats.box.height <= 96, width + '×' + height + ': Statistics is a polished frosted-glass card with a native accessible action');
      ok(layout.stats.metrics[0] === '0' && layout.stats.metrics[1] === '0' && layout.stats.progressbar !== null, width + '×' + height + ': the summary shows live matches/wins and an accessible level-progress indicator');
      ok(layout.widths.root <= width && layout.widths.main <= layout.widths.mainClient + 1, width + '×' + height + ': home content has no horizontal overflow');

      for (const id of navIds) {
        await page.$eval('#' + id, element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        const target = await page.$eval('#' + id, element => {
          const r = element.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && (hit === element || element.contains(hit));
        });
        ok(target, width + '×' + height + ': ' + id + ' remains reachable and clickable, including below the fold on compact screens');
      }
      if (width === 390) {
        const { context: keyboardContext, page: keyboardPage } = await newHome(width, height);
        await keyboardPage.keyboard.press('Tab');
        const first = await keyboardPage.evaluate(() => ({ id: document.activeElement.id, outline: getComputedStyle(document.activeElement).outlineStyle }));
        ok(first.id === 'btn-vs-ai' && first.outline === 'solid', 'phone keyboard navigation reaches the first game card with a visible focus ring');
        await keyboardPage.keyboard.press('Enter');
        await keyboardPage.waitForSelector('#setup:not(.hidden)');
        ok(true, 'the focused Play vs Computer card activates its existing setup flow with Enter');
        await keyboardContext.close();

        const { context: navContext, page: navPage } = await newHome(width, height);
        for (let i = 0; i < 7; i++) await navPage.keyboard.press('Tab');
        const utilityFocus = await navPage.evaluate(() => ({ id: document.activeElement.id, outline: getComputedStyle(document.activeElement).outlineStyle }));
        ok(utilityFocus.id === 'btn-skins' && utilityFocus.outline === 'solid', 'keyboard navigation reaches the first utility card with a visible focus ring');
        await navPage.keyboard.press('Enter');
        await navPage.waitForSelector('#skins:not(.hidden)');
        ok(true, 'the focused Skins card opens the existing skin collection with Enter');
        await navContext.close();
      }
      await context.close();
    }

    const routes = [
      { id: 'btn-stats', selector: '#stats:not(.hidden)', name: 'Statistics', check: page => page.$eval('#stats-body.stats-grid', el => el.children.length >= 10) },
      { id: 'btn-skins', selector: '#skins:not(.hidden)', name: 'Skins', check: page => page.$eval('#skins h3', el => el.textContent.trim() === 'Skins') },
      { id: 'btn-rules', selector: '#rules:not(.hidden)', name: 'Rules', check: page => page.$eval('#rules h3', el => el.textContent.trim() === 'Rules') },
      { id: 'btn-settings', selector: '#settings:not(.hidden)', name: 'Settings', check: page => page.$eval('#settings h3', el => el.textContent.trim() === 'Settings') },
      { id: 'btn-community', selector: '#community:not(.hidden)', name: 'Leaderboard & referrals', check: page => page.$eval('#community h1', el => el.textContent.trim() === 'Crystal League') }
    ];
    for (const route of routes) {
      const { context, page } = await newHome(390, 844);
      await page.click('#' + route.id);
      await page.waitForSelector(route.selector);
      ok(await route.check(page), route.id + ' preserves its existing ' + route.name + ' destination and behavior');
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
        ok(await page.$eval('#setup-title', element => element.textContent.trim() === 'Pass & Play'), 'btn-pass preserves the existing pass-and-play setup action');
      }
      await context.close();
    }

    const { context: savedStatsContext, page: savedStatsPage } = await newHome(390, 844);
    await savedStatsPage.evaluate(() => {
      window.__cf.save.stats.played = 12;
      window.__cf.save.stats.won = 5;
      window.__cf.save.xp = 145;
      window.__cf.persist();
    });
    await savedStatsPage.reload({ waitUntil: 'networkidle0' });
    const savedStats = await savedStatsPage.evaluate(() => ({
      played: document.getElementById('home-stat-played').textContent.trim(),
      won: document.getElementById('home-stat-won').textContent.trim(),
      progress: Number(document.querySelector('.stats-launch [role="progressbar"]').getAttribute('aria-valuenow')),
      width: parseFloat(document.getElementById('lvl-fill').style.width)
    }));
    ok(savedStats.played === '12' && savedStats.won === '5', 'Statistics card reflects saved match and win totals after reloading');
    ok(Number.isFinite(savedStats.progress) && savedStats.progress >= 0 && savedStats.progress <= 100 && savedStats.width === savedStats.progress, 'level progress width and accessible progress value stay synchronized');
    await savedStatsContext.close();

    ok(errors.length === 0, 'home views produce no browser errors or failed requests: ' + errors.join(' | '));
    console.log(checks + ' home-navigation browser checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
