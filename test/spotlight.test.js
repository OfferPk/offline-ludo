// Focused headless-browser coverage for the visual-only match-end spotlight.
// Usage: PUPPETEER=puppeteer-core CHROME=/usr/bin/chromium node test/spotlight.test.js [url]
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const URL = (process.argv[2] || 'http://localhost:8781/').replace(/\/?$/, '/');
const scenarios = [
  { label: 'Classic vs AI', entry: '#btn-vs-ai', mode: 'classic', players: '1v1', ai: true },
  { label: 'Mystery Tiles vs AI', entry: '#btn-mystery', mode: 'mystery', players: '1v1', ai: true },
  { label: 'Lucky Chaos vs AI', entry: '#btn-lucky', mode: 'lucky', players: '1v1', ai: true },
  { label: 'Classic pass & play with reduced motion', entry: '#btn-pass', mode: 'classic', players: '4', ai: false, reduced: true }
];
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
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle0' });

  for (const scenario of scenarios) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: scenario.reduced ? 'reduce' : 'no-preference' }]);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('crossfour.tutorial.v1', '1'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#home:not(.hidden)');
    await page.click(scenario.entry);
    await page.waitForSelector('#setup:not(.hidden)');
    await page.click('#mode-seg button[data-mode="' + scenario.mode + '"]');
    await page.click('#presets button[data-p="' + scenario.players + '"]');
    if (scenario.ai) await page.click('#seat-list button[data-seat="1"][data-v="hard"]');
    await page.click('#btn-start');
    await page.waitForFunction(mode => window.__cf && window.__cf.game && window.__cf.game.st.mode === mode, { timeout: 8000 }, scenario.mode);

    const fixture = await page.evaluate(() => {
      const c = window.__cf;
      const game = c.game;
      const ranking = game.st.players.slice().reverse();
      const winner = ranking[0];
      c.save.settings.sound = false;
      c.edit(st => {
        st.phase = 'over';
        st.turn = winner;
        st.ranking = ranking;
        st.queue = [];
        st.moves = [];
        st.pieces.forEach(pieces => { if (pieces) pieces.fill(57); });
      });
      return { mode: game.st.mode, players: game.st.players.slice(), ranking, winner, hasAI: game.st.players.some(s => game.st.seats[s].type === 'ai') };
    });
    ok(fixture.mode === scenario.mode, scenario.label + ': selected game mode is retained');
    ok(fixture.hasAI === scenario.ai, scenario.label + ': AI/pass-and-play seats are configured as intended');

    await page.waitForFunction(() => {
      const result = document.getElementById('result');
      return result && !result.classList.contains('hidden');
    }, { timeout: 8000 });

    const result = await page.evaluate(() => {
      const c = window.__cf;
      const rows = [...document.querySelectorAll('#r-rank li')];
      const winner = rows[0];
      const normalized = document.createElement('i');
      normalized.style.color = winner.style.getPropertyValue('--winner-color');
      document.body.appendChild(normalized);
      const expectedColor = getComputedStyle(normalized).color;
      normalized.remove();
      const piece = document.querySelector('#winner-confetti .confetti-piece');
      return {
        mode: c.game.st.mode,
        ranking: c.game.st.ranking.slice(),
        rows: rows.length,
        firstPlace: winner && winner.querySelector('.medal').textContent.trim(),
        firstIsWinner: winner && winner.classList.contains('winner'),
        onlyFirstIsWinner: rows.filter(row => row.classList.contains('winner')).length === 1,
        winnerColorMatchesPlayer: winner && getComputedStyle(winner.querySelector('.pdot')).backgroundColor === expectedColor,
        rowAnimation: winner && getComputedStyle(winner).animationName,
        confettiCount: document.querySelectorAll('#winner-confetti .confetti-piece').length,
        confettiAnimation: piece && getComputedStyle(piece).animationName,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        kicker: document.getElementById('r-kicker').textContent
      };
    });
    ok(result.mode === fixture.mode && result.ranking.join() === fixture.ranking.join(), scenario.label + ': visual result leaves mode and ranking unchanged');
    ok(result.rows === fixture.players.length && result.firstPlace === '1' && result.firstIsWinner && result.onlyFirstIsWinner, scenario.label + ': only the unchanged first-place row receives the podium highlight');
    ok(result.winnerColorMatchesPlayer, scenario.label + ': podium highlight uses the winner’s player color');
    ok(result.kicker.includes(scenario.ai ? 'VS COMPUTER' : 'PASS & PLAY'), scenario.label + ': result identifies AI or pass-and-play correctly');
    if (scenario.reduced) {
      ok(result.reduced && result.confettiCount === 0 && result.rowAnimation === 'none', scenario.label + ': reduced motion suppresses burst and row animation');
    } else {
      ok(!result.reduced && result.confettiCount === 28 && result.confettiAnimation === 'winner-confetti' && result.rowAnimation === 'winner-row-pop', scenario.label + ': winner-color burst and podium pop are present');
    }
  }

  await browser.close();
  console.log('\n' + checks + ' spotlight checks passed');
})().catch(async error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
