// Catalog, local skin-shop transactions, migration helpers and deterministic gameplay checks.
const assert = require('assert');
const SK = require('../www/js/themes.js');
const Shop = require('../www/js/skin-shop.js');
const L = require('../www/js/logic.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }
function freshSave() {
  return { coins: 2000, owned: { boards: ['graphite', 'linen'], dice: ['ivory'] }, board: 'graphite', dice: 'ivory',
    stats: { won: 0, streak: 0 }, flags: { diamondCollection: false } };
}
function action(save, kind, id, persist) {
  const catalog = kind === 'boards' ? SK.BOARDS : SK.DICE;
  return Shop.act(save, kind, catalog.find(item => item.id === id), persist || (() => true));
}

console.log('skins.test.js');
test('keeps all original stable board IDs, names, prices and palettes', () => {
  const originals = {
    graphite: ['Graphite', 0, '#12151b', '#1f242d'],
    linen: ['Linen', 0, '#ece8e1', '#fbfaf7'],
    walnut: ['Walnut', 250, '#1b1410', '#5a3b26'],
    aurora: ['Aurora', 400, '#0a0f1f', '#121a33']
  };
  assert.strictEqual(SK.BOARDS.length, 20);
  for (const [id, expected] of Object.entries(originals)) {
    const item = SK.BOARDS.find(x => x.id === id);
    assert.ok(item, id); assert.deepStrictEqual([item.name, item.price, item.bg, item.board], expected);
  }
});
test('contains exactly the 12 priced boards with approved prices and four special boards', () => {
  const expected = { galaxy: 600, ocean: 450, forest: 450, desert: 400, candy: 500, crystal: 750,
    royal: 1000, neon: 900, sakura: 650, inferno: 800, frost: 700, cosmic: 1200 };
  const priced = SK.BOARDS.filter(x => Object.prototype.hasOwnProperty.call(expected, x.id));
  assert.strictEqual(priced.length, 12);
  for (const [id, price] of Object.entries(expected)) assert.strictEqual(SK.BOARDS.find(x => x.id === id).price, price, id);
  assert.deepStrictEqual(SK.BOARDS.filter(x => x.unlock).map(x => x.id), ['champion', 'streak-master', 'legendary', 'diamond']);
  assert.deepStrictEqual(SK.BOARDS.filter(x => x.unlock === 'wins').map(x => [x.id, x.threshold]), [['champion', 50], ['legendary', 100]]);
  assert.deepStrictEqual(SK.BOARDS.find(x => x.unlock === 'streak') && [SK.BOARDS.find(x => x.unlock === 'streak').id, SK.BOARDS.find(x => x.unlock === 'streak').threshold], ['streak-master', 10]);
  assert.strictEqual(SK.BOARDS.find(x => x.id === 'diamond').flag, 'diamondCollection');
});
test('keeps all original dice unchanged and adds exactly the 15 named styles/prices', () => {
  const originals = { ivory: ['Ivory', 0, '#fbfaf6'], onyx: ['Onyx', 150, '#23272f'], brass: ['Brass', 300, '#e3b857'], frost: ['Frost', 450, '#cfe6ff'], ember: ['Ember', 600, '#d9463b'] };
  assert.strictEqual(SK.DICE.length, 20);
  for (const [id, expected] of Object.entries(originals)) {
    const item = SK.DICE.find(x => x.id === id);
    assert.ok(item, id); assert.deepStrictEqual([item.name, item.price, item.face], expected);
  }
  const expected = {
    'classic-white': ['Classic White', 0], 'graphite-dice': ['Graphite Dice', 150], 'gold-dice': ['Gold Dice', 300],
    'crystal-dice': ['Crystal Dice', 750], 'neon-dice': ['Neon Dice', 900], 'galaxy-dice': ['Galaxy Dice', 600],
    'fire-dice': ['Fire Dice', 800], 'ice-dice': ['Ice Dice', 700], 'royal-dice': ['Royal Dice', 1000],
    'rainbow-dice': ['Rainbow Dice', 500], 'emerald-dice': ['Emerald Dice', 450], 'diamond-dice': ['Diamond Dice', 0],
    'floral-dice': ['Floral Dice', 550], 'honeycomb-bee': ['Bee & Honeycomb', 650], 'markhor-dice': ['Markhor Dice', 850]
  };
  assert.strictEqual(Object.keys(expected).length, 15);
  for (const [id, value] of Object.entries(expected)) assert.deepStrictEqual([SK.DICE.find(x => x.id === id).name, SK.DICE.find(x => x.id === id).price], value);
  assert.strictEqual(SK.DICE.find(x => x.id === 'classic-white').price, 0, 'free secondary option leaves Ivory as the starter');
  assert.strictEqual(SK.DICE.find(x => x.id === 'diamond-dice').flag, 'diamondCollection');
});
test('new floral, bee/honeycomb and markhor dice use high-contrast pips and the existing coin shop', () => {
  const added = [['floral-dice', 550], ['honeycomb-bee', 650], ['markhor-dice', 850]];
  function channel(v) { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }
  function luminance(hex) { const rgb = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16))); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; }
  for (const [id, price] of added) {
    const item = SK.DICE.find(x => x.id === id);
    assert.ok(item, id); assert.strictEqual(item.price, price);
    const base = item.face.match(/#[0-9a-f]{6}(?!.*#[0-9a-f]{6})/i)[0];
    const contrast = (Math.max(luminance(base), luminance(item.pip)) + .05) / (Math.min(luminance(base), luminance(item.pip)) + .05);
    assert.ok(contrast >= 4.5, id + ' pip contrast ' + contrast.toFixed(2));
  }
  const save = freshSave(); save.coins = 2600;
  for (const [id, price] of added) {
    const result = action(save, 'dice', id);
    assert.deepStrictEqual(result, { ok: true, newlyOwned: true, price, id });
    assert.strictEqual(save.dice, id); assert.ok(save.owned.dice.includes(id));
  }
  assert.strictEqual(save.coins, 550, 'all three motif dice unlock only through earned offline coins');
});
test('uses distinct, legible board palettes with red, green, yellow and blue player homes', () => {
  function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  for (const board of SK.BOARDS) {
    assert.strictEqual(board.seats.length, 4, board.id);
    const [red, green, yellow, blue] = board.seats.map(rgb);
    assert.ok(red[0] > red[1] * 1.15 && red[0] > red[2] * 1.15, board.id + ' red');
    assert.ok(green[1] > green[0] * 1.05 && green[1] > green[2] * 1.05, board.id + ' green');
    assert.ok(yellow[0] > yellow[2] * 1.2 && yellow[1] > yellow[2] * 1.2, board.id + ' yellow');
    assert.ok(blue[2] > blue[0] * 1.05 && blue[2] > blue[1] * 1.02, board.id + ' blue');
    for (const key of ['bg', 'page', 'board', 'cell', 'cellEdge', 'ink', 'muted', 'center']) assert.match(board[key], /^#[0-9a-f]{6}$/i, board.id + ' ' + key);
  }
  assert.strictEqual(new Set(SK.BOARDS.map(x => x.bg + x.board + x.cell)).size, SK.BOARDS.length);
});
test('normalizes duplicate and malformed ownership without dropping legacy or future IDs', () => {
  assert.deepStrictEqual(Shop.normalizeOwned(['linen', 'walnut', 'linen', null, 9, 'future-skin'], ['graphite', 'linen']), ['linen', 'walnut', 'future-skin', 'graphite']);
});
test('purchases once, deducts the exact cost, and selects the skin only after persistence succeeds', () => {
  const save = freshSave(); let writes = 0;
  const result = action(save, 'boards', 'galaxy', () => { writes++; return true; });
  assert.deepStrictEqual(result, { ok: true, newlyOwned: true, price: 600, id: 'galaxy' });
  assert.strictEqual(save.coins, 1400); assert.strictEqual(save.board, 'galaxy'); assert.strictEqual(save.owned.boards.filter(x => x === 'galaxy').length, 1); assert.strictEqual(writes, 1);
  const duplicate = action(save, 'boards', 'galaxy', () => { writes++; return true; });
  assert.strictEqual(duplicate.ok, false); assert.strictEqual(duplicate.reason, 'already-selected');
  assert.strictEqual(save.coins, 1400); assert.strictEqual(writes, 1);
});
test('rejects insufficient funds without changing coins, selection, ownership or storage', () => {
  const save = freshSave(); save.coins = 599; let writes = 0;
  const result = action(save, 'boards', 'galaxy', () => { writes++; return true; });
  assert.strictEqual(result.reason, 'insufficient-coins'); assert.strictEqual(save.coins, 599); assert.strictEqual(save.board, 'graphite');
  assert.ok(!save.owned.boards.includes('galaxy')); assert.strictEqual(writes, 0);
  assert.strictEqual(Shop.state(SK.BOARDS.find(x => x.id === 'royal'), save, 'boards').canUnlock, false);
});
test('rolls back purchase and equip state when a local storage write fails', () => {
  const save = freshSave();
  const failedPurchase = action(save, 'boards', 'ocean', () => false);
  assert.strictEqual(failedPurchase.reason, 'save-failed'); assert.strictEqual(save.coins, 2000); assert.strictEqual(save.board, 'graphite'); assert.ok(!save.owned.boards.includes('ocean'));
  save.owned.boards.push('walnut'); save.board = 'graphite';
  const failedEquip = action(save, 'boards', 'walnut', () => false);
  assert.strictEqual(failedEquip.reason, 'save-failed'); assert.strictEqual(save.board, 'graphite');
});
test('equips and reloads an already owned skin without another coin deduction', () => {
  const save = freshSave(); save.owned.boards.push('galaxy'); save.coins = 1400; save.board = 'linen';
  assert.deepStrictEqual(action(save, 'boards', 'galaxy'), { ok: true, newlyOwned: false, price: 0, id: 'galaxy' });
  const reloaded = JSON.parse(JSON.stringify(save));
  assert.strictEqual(reloaded.board, 'galaxy'); assert.ok(reloaded.owned.boards.includes('galaxy')); assert.strictEqual(reloaded.coins, 1400);
});
test('grants Champion, Streak Master and Legendary only at local gameplay thresholds and only once', () => {
  const save = freshSave();
  save.stats.won = 49; save.stats.streak = 9;
  assert.deepStrictEqual(Shop.collectEligible(save, SK), []);
  save.stats.won = 50;
  assert.deepStrictEqual(Shop.collectEligible(save, SK).map(x => x.id), ['champion']);
  assert.strictEqual(save.coins, 2000, 'achievement unlocks are free');
  save.stats.streak = 10;
  assert.deepStrictEqual(Shop.collectEligible(save, SK).map(x => x.id), ['streak-master']);
  save.stats.won = 100;
  assert.deepStrictEqual(Shop.collectEligible(save, SK).map(x => x.id), ['legendary']);
  assert.deepStrictEqual(Shop.collectEligible(save, SK), []);
  assert.strictEqual(save.owned.boards.filter(x => x === 'champion').length, 1);
});
test('keeps Diamond skins locked without a real flag and releases both only when it exists', () => {
  const save = freshSave(); const board = SK.BOARDS.find(x => x.id === 'diamond'), dice = SK.DICE.find(x => x.id === 'diamond-dice');
  assert.strictEqual(Shop.state(board, save, 'boards').canUnlock, false);
  assert.strictEqual(Shop.act(save, 'boards', board, () => true).reason, 'event-locked');
  assert.strictEqual(Shop.state(dice, save, 'dice').canUnlock, false);
  save.flags.diamondCollection = true;
  assert.deepStrictEqual(Shop.collectEligible(save, SK).map(x => x.id), ['diamond', 'diamond-dice']);
  assert.strictEqual(save.coins, 2000);
});
test('keeps the deterministic game engine independent of cosmetic catalog changes', () => {
  const seats = [{ type: 'human' }, { type: 'ai', level: 'hard' }, null, null];
  const a = L.newGame(seats, {}, 62021, 'classic'), b = L.newGame(seats, {}, 62021, 'classic');
  for (let i = 0; i < 12 && a.phase !== 'over' && b.phase !== 'over'; i++) {
    if (a.phase === 'roll' && b.phase === 'roll') {
      const ra = L.roll(a), rb = L.roll(b); assert.deepStrictEqual(ra, rb);
    } else if (a.phase === 'move' && b.phase === 'move') {
      const ma = L.chooseMove(a, 'hard'), mb = L.chooseMove(b, 'hard');
      if (!ma || !mb) break;
      assert.deepStrictEqual(L.move(a, ma.piece, ma.v), L.move(b, mb.piece, mb.v));
    } else break;
    assert.deepStrictEqual(a, b);
  }
  assert.deepStrictEqual(a, b);
});

console.log(`\n${passed} skin checks passed`);
