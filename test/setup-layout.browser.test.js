// Responsive match-setup cards, accessibility, and fit across phone/tablet/desktop widths.
// Usage: CHROME=/usr/bin/chromium node test/setup-layout.browser.test.js <url>
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const SIZES = [[320, 568], [360, 740], [390, 844], [768, 1024], [1280, 800]];
const FLOWS = [
  { id: 'btn-vs-ai', mode: 'classic', label: 'Play vs Computer' },
  { id: 'btn-mystery', mode: 'mystery', label: 'Mystery Tiles' },
  { id: 'btn-lucky', mode: 'lucky', label: 'Lucky Chaos Ludo' },
  { id: 'btn-pass', mode: 'classic', label: 'Pass & Play' }
];
let checks = 0;
function ok(condition, message) {
  if (!condition) throw new Error('FAILED: ' + message);
  checks++;
  console.log('  ok -', message);
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox'] });
  try {
    const errors = [];
    let homeCheckDone = false;
    for (const [width, height] of SIZES) {
      for (const flow of FLOWS) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 640, hasTouch: width < 640 });
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('requestfailed', request => errors.push('request failed: ' + request.url()));
        await page.goto(URL, { waitUntil: 'networkidle0' });
        await page.waitForSelector('#home:not(.hidden)');
        if (!homeCheckDone) {
          const cards = await page.$$eval('#home .mode-card', buttons => buttons.map(button => {
            const style = getComputedStyle(button), r = button.getBoundingClientRect();
            return { id: button.id, visible: r.width > 0 && style.display !== 'none', border: style.borderTopWidth !== '0px', glass: style.backdropFilter.includes('blur'), glow: style.boxShadow.includes('rgba') };
          }));
          ok(cards.length === 4 && cards.every(card => card.visible && card.border && card.glass && card.glow), 'all four home modes retain consistent frosted cards with visible neon borders/glows');
          homeCheckDone = true;
        }
        await page.click('#' + flow.id);
        await page.waitForSelector('#setup:not(.hidden)');
        const initial = await page.evaluate(() => ({
          mode: document.querySelector('#mode-seg button[aria-pressed="true"]')?.dataset.mode,
          title: document.querySelector('#setup-title').textContent,
          setupWidth: document.querySelector('.setup-body').clientWidth,
          modePressed: [...document.querySelectorAll('#mode-seg button')].filter(button => button.getAttribute('aria-pressed') === 'true').length,
          presetPressed: [...document.querySelectorAll('#presets button')].filter(button => button.getAttribute('aria-pressed') === 'true').length,
          cards: [...document.querySelectorAll('.seat')].map(card => ({
            name: card.querySelector('.sname').childNodes[0].textContent.trim(),
            position: card.querySelector('.sname small').textContent,
            group: card.getAttribute('aria-label'),
            box: (() => { const r = card.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; })(),
            controls: [...card.querySelectorAll('.seat-options button')].map(button => {
              const r = button.getBoundingClientRect();
              return { label: button.textContent.trim(), width:r.width, height:r.height, left:r.left, right:r.right, top:r.top, bottom:r.bottom, fit:button.scrollWidth <= button.clientWidth + 1, native:button.tagName === 'BUTTON' && button.type === 'button', pressed:['true','false'].includes(button.getAttribute('aria-pressed')) };
            })
          })),
          columns: getComputedStyle(document.querySelector('.seat-list')).gridTemplateColumns.trim().split(/\s+/).length,
          horizontalFit: document.documentElement.scrollWidth <= innerWidth && document.querySelector('.setup-body').scrollWidth <= document.querySelector('.setup-body').clientWidth + 1,
          modeFits: [...document.querySelectorAll('#mode-seg button')].every(button => button.scrollWidth <= button.clientWidth + 1),
          countFits: [...document.querySelectorAll('#presets button')].every(button => button.scrollWidth <= button.clientWidth + 1)
        }));
        ok(initial.title === flow.label && initial.mode === flow.mode, width + '×' + height + ' ' + flow.label + ': opens the expected setup flow and selected mode');
        ok(initial.modePressed === 1 && initial.presetPressed === 1, width + '×' + height + ' ' + flow.label + ': mode and player-count cards expose one selected pressed state');
        ok(initial.cards.length === 4 && initial.cards.map(card => card.name).join(',') === 'Coral,Jade,Cobalt,Saffron' && initial.cards.map(card => card.position).join(',') === 'top left,top right,bottom left,bottom right', width + '×' + height + ' ' + flow.label + ': all four seats keep their names and board positions');
        ok(initial.cards.every(card => card.group && card.controls.length === 5 && card.controls.every(control => control.native && control.pressed && control.height >= 34 && control.fit)), width + '×' + height + ' ' + flow.label + ': seat cards provide five accessible, fitting, touch-sized options apiece');
        ok(initial.cards.every(card => card.box.width > 0 && card.box.left >= 0 && card.box.right <= width + 1 && card.controls.every(control => control.left >= card.box.left && control.right <= card.box.right + 1 && control.top >= card.box.top && control.bottom <= card.box.bottom + 1)), width + '×' + height + ' ' + flow.label + ': player cards and controls stay inside their card bounds');
        ok(initial.columns === (width >= 1024 ? 4 : 2) && initial.horizontalFit && initial.modeFits && initial.countFits, width + '×' + height + ' ' + flow.label + ': responsive grid/pills fit without horizontal clipping');
        await page.click('#presets [data-p="4"]');
        const four = await page.evaluate(() => ({
          selected: document.querySelector('#presets [data-p="4"]').getAttribute('aria-pressed'),
          enabled: !document.getElementById('btn-start').disabled,
          active: [...document.querySelectorAll('.seat')].filter(card => [...card.querySelectorAll('.seat-options button[aria-pressed="true"]')].some(button => button.dataset.v !== 'off')).length,
          bodyWidth: document.querySelector('.setup-body').clientWidth
        }));
        ok(four.selected === 'true' && four.enabled && four.active === 4, width + '×' + height + ' ' + flow.label + ': the four-player preset updates all seats and keeps Start match available');
        await page.click('.seat-options button[data-seat="1"][data-v="hard"]');
        ok(await page.$eval('.seat-options button[data-seat="1"][data-v="hard"]', button => button.getAttribute('aria-pressed') === 'true'), width + '×' + height + ' ' + flow.label + ': tapping an option selects it without breaking the card grid');
        if (width === 360 && flow.id === 'btn-vs-ai') {
          await page.focus('.seat-options button[data-seat="3"][data-v="human"]');
          await page.keyboard.press('Enter');
          const keyboard = await page.evaluate(() => ({
            focused: document.activeElement.matches('.seat-options button[data-seat="3"][data-v="human"]'),
            focusRing: getComputedStyle(document.activeElement).outlineStyle,
            selected: document.activeElement.getAttribute('aria-pressed')
          }));
          ok(keyboard.focused && keyboard.focusRing === 'solid' && keyboard.selected === 'true', '360px phone: keyboard activation keeps focus, exposes selection, and shows a visible focus ring');
        }
        await page.$eval('.setup-body', element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
        const end = await page.evaluate(() => {
          const footer = document.querySelector('.setup-foot').getBoundingClientRect();
          const start = document.getElementById('btn-start').getBoundingClientRect();
          const summary = document.getElementById('rules-sum').getBoundingClientRect();
          const chips = [...document.querySelectorAll('.rule-chip')];
          return {
            footer: footer.bottom <= innerHeight + 1 && footer.top >= 0,
            start: start.bottom <= footer.bottom + 1 && start.top >= footer.top - 1 && start.width > 0,
            summaryAboveFooter: summary.bottom <= footer.top + 2,
            ruleChips: chips.length >= 2 && chips.every(chip => chip.textContent.trim().length > 0 && chip.getBoundingClientRect().width > 0)
          };
        });
        ok(end.footer && end.start && end.summaryAboveFooter, width + '×' + height + ' ' + flow.label + ': scrolling leaves house rules clear of the fixed Start match footer');
        ok(end.ruleChips, width + '×' + height + ' ' + flow.label + ': house-rule summaries remain compact, readable chips');
        await context.close();
      }
    }
    ok(errors.length === 0, 'setup layouts produce no browser errors or failed requests: ' + errors.join(' | '));
    console.log(checks + ' setup-layout browser checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
