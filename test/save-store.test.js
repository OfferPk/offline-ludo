// Local save-store contract tests. Run: node test/save-store.test.js
const assert = require('assert');
const SaveStore = require('../www/js/save-store.js');
const L = require('../www/js/logic.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function defaults() { return { coins: 0, xp: 0, board: 'graphite', dice: 'ivory', settings: { sound: true, fast: false },
  rules: { safeSquares: true, bonusOnCapture: true }, setup: { ai: [null, { type: 'ai', level: 'hard' }, null, { type: 'ai', level: 'hard' }],
    pass: [null, { type: 'human' }, null, { type: 'human' }], mode: { ai: 'classic', pass: 'classic' } },
  stats: { played: 0, won: 0 }, ad: {}, game: null }; }
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = defaults();
  d.coins = Number.isSafeInteger(raw.coins) && raw.coins >= 0 ? raw.coins : 0;
  d.xp = Number.isSafeInteger(raw.xp) && raw.xp >= 0 ? raw.xp : 0;
  d.board = ['graphite', 'linen'].includes(raw.board) ? raw.board : d.board;
  d.dice = typeof raw.dice === 'string' ? raw.dice : d.dice;
  d.settings = { sound: typeof raw.settings?.sound === 'boolean' ? raw.settings.sound : true,
    fast: typeof raw.settings?.fast === 'boolean' ? raw.settings.fast : false };
  d.rules = { safeSquares: typeof raw.rules?.safeSquares === 'boolean' ? raw.rules.safeSquares : true,
    bonusOnCapture: typeof raw.rules?.bonusOnCapture === 'boolean' ? raw.rules.bonusOnCapture : true };
  if (raw.setup && typeof raw.setup === 'object') d.setup = clone(raw.setup);
  d.stats = { played: Number.isSafeInteger(raw.stats?.played) && raw.stats.played >= 0 ? raw.stats.played : 0,
    won: Number.isSafeInteger(raw.stats?.won) && raw.stats.won >= 0 ? raw.stats.won : 0 };
  d.ad = raw.ad && typeof raw.ad === 'object' ? clone(raw.ad) : {};
  d.game = raw.game && raw.game.st && raw.game.st.v === 2 ? clone(raw.game) : null;
  return d;
}
function validate(data) {
  return !!data && typeof data === 'object' && Number.isSafeInteger(data.coins) && data.coins >= 0 &&
    Number.isSafeInteger(data.xp) && data.xp >= 0 && typeof data.settings?.sound === 'boolean' &&
    Number.isSafeInteger(data.stats?.played) && (data.game === null || !!(data.game && data.game.st && data.game.st.v === 2));
}
class MemoryStorage {
  constructor() { this.values = new Map(); this.failKey = null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { if (this.failKey === key) throw new Error('quota exceeded'); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function make(storage, now) {
  return SaveStore.create(storage, { defaults, normalize, validate, now: now || (() => 1700000000000) });
}
let pass = 0;
function test(name, fn) { fn(); pass++; console.log('  ok -', name); }

console.log('save-store.test.js');
test('writes and validates a versioned primary snapshot with a checkpoint', () => {
  const storage = new MemoryStorage(), store = make(storage); const loaded = store.load();
  assert.strictEqual(loaded.status, 'defaults');
  const next = defaults(); next.coins = 12; next.xp = 40;
  assert.deepStrictEqual(store.save(next), { ok: true });
  const snapshot = JSON.parse(storage.getItem('crossfour.save.v3'));
  assert.strictEqual(snapshot.schemaVersion, 3); assert.strictEqual(snapshot.savedAt, 1700000000000);
  assert.strictEqual(snapshot.payload.coins, 12);
  assert.strictEqual(JSON.parse(storage.getItem('crossfour.save.checkpoint.v3')).schemaVersion, 3);
  assert.strictEqual(make(storage).load().data.xp, 40);
});
test('migrates the complete v2 payload without deleting its legacy key', () => {
  const storage = new MemoryStorage(), store = make(storage), legacy = defaults();
  legacy.coins = 245; legacy.xp = 890; legacy.board = 'linen'; legacy.settings.fast = true;
  legacy.stats = { played: 19, won: 7 }; legacy.ad.matchesCompleted = 6;
  legacy.game = { st: { v: 2, rng: 1234, rolls: 28 }, mode: 'mystery' };
  storage.setItem('crossfour.save.v2', JSON.stringify(legacy));
  const loaded = store.load();
  assert.strictEqual(loaded.status, 'migrated-v2');
  assert.strictEqual(loaded.data.coins, 245); assert.strictEqual(loaded.data.xp, 890);
  assert.strictEqual(loaded.data.stats.played, 19); assert.strictEqual(loaded.data.game.st.rng, 1234);
  store.save(loaded.data);
  assert.ok(storage.getItem('crossfour.save.v2'), 'legacy source remains available for recovery');
  assert.strictEqual(JSON.parse(storage.getItem('crossfour.save.v3')).payload.coins, 245);
});
test('migrates v1 profile, settings, stats and ad pacing while mapping legacy house rules', () => {
  const storage = new MemoryStorage(), old = { coins: 73, xp: 110, board: 'linen', dice: 'brass',
    settings: { sound: false, fast: true }, stats: { played: 8, won: 3 }, ad: { matchesCompleted: 5 },
    setup: { ai: [null, { type: 'ai', level: 'hard' }, null, { type: 'human' }], pass: [null, { type: 'human' }, null, { type: 'human' }],
      mode: { ai: 'lucky', pass: 'mystery' }, rules: { safeSquares: false, extraOnCapture: false } }, game: { incompatible: true } };
  storage.setItem('crossfour.save.v1', JSON.stringify(old));
  const loaded = make(storage).load();
  assert.strictEqual(loaded.status, 'migrated-v1');
  assert.strictEqual(loaded.data.coins, 73); assert.strictEqual(loaded.data.xp, 110);
  assert.deepStrictEqual(loaded.data.settings, { sound: false, fast: true });
  assert.deepStrictEqual(loaded.data.stats, { played: 8, won: 3 });
  assert.deepStrictEqual(loaded.data.setup.ai, old.setup.ai); assert.deepStrictEqual(loaded.data.setup.pass, old.setup.pass);
  assert.deepStrictEqual(loaded.data.setup.mode, { ai: 'lucky', pass: 'mystery' });
  assert.strictEqual(loaded.data.ad.matchesCompleted, 5);
  assert.deepStrictEqual(loaded.data.rules, { safeSquares: false, bonusOnCapture: false });
  assert.strictEqual(loaded.data.game, null, 'incompatible v1 match is not misinterpreted as a v2 game');
});
test('corrupt JSON and invalid snapshot values are rejected without trusting malformed progression', () => {
  const storage = new MemoryStorage();
  storage.setItem('crossfour.save.v3', '{not json');
  storage.setItem('crossfour.save.checkpoint.v3', JSON.stringify({ schemaVersion: 3, savedAt: 1, payload: { coins: -9, xp: 'lots', settings: {} } }));
  const loaded = make(storage).load();
  assert.strictEqual(loaded.status, 'defaults'); assert.strictEqual(loaded.data.coins, 0);
  assert.strictEqual(make(storage).save({ coins: -1 }).ok, false); // no write path is allowed to accept a corrupt object
});
test('normalizes invalid legacy values while preserving valid v2 progress', () => {
  const storage = new MemoryStorage();
  storage.setItem('crossfour.save.v2', JSON.stringify({ coins: -12, xp: 'bad', board: '<invalid>', settings: { sound: 1, fast: true }, stats: { played: -4, won: 2 } }));
  const loaded = make(storage).load();
  assert.strictEqual(loaded.status, 'migrated-v2');
  assert.strictEqual(loaded.data.coins, 0); assert.strictEqual(loaded.data.xp, 0);
  assert.strictEqual(loaded.data.board, 'graphite'); assert.strictEqual(loaded.data.settings.sound, true);
  assert.strictEqual(loaded.data.settings.fast, true); assert.strictEqual(loaded.data.stats.played, 0);
  assert.strictEqual(loaded.data.stats.won, 2);
});
test('recovers the last-known-good checkpoint when the newest primary becomes corrupt', () => {
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const first = defaults(); first.coins = 30; store.save(first);
  const second = defaults(); second.coins = 90; store.save(second);
  storage.setItem('crossfour.save.v3', 'corrupted after the newer write');
  const recovered = make(storage).load();
  assert.strictEqual(recovered.status, 'recovered'); assert.strictEqual(recovered.source, 'checkpoint');
  assert.strictEqual(recovered.data.coins, 30);
});
test('reports primary write failure, keeps the previous checkpoint, and retries safely', () => {
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const first = defaults(); first.coins = 21; store.save(first);
  const second = defaults(); second.coins = 55;
  storage.failKey = 'crossfour.save.v3';
  const failed = store.save(second);
  assert.strictEqual(failed.ok, false); assert.strictEqual(failed.reason, 'write-failed'); assert.strictEqual(failed.stage, 'primary');
  assert.strictEqual(JSON.parse(storage.getItem('crossfour.save.checkpoint.v3')).payload.coins, 21);
  storage.failKey = null;
  assert.strictEqual(store.save(second).ok, true);
  assert.strictEqual(make(storage).load().data.coins, 55);
});
test('does not overwrite a snapshot written by a newer schema', () => {
  const storage = new MemoryStorage();
  storage.setItem('crossfour.save.v3', JSON.stringify({ schemaVersion: 4, savedAt: 1, payload: { marker: 'future' } }));
  const store = make(storage), loaded = store.load();
  assert.strictEqual(loaded.status, 'unsupported'); assert.strictEqual(loaded.readOnly, true);
  assert.strictEqual(store.save(defaults()).reason, 'unsupported-version');
  assert.ok(storage.getItem('crossfour.save.v3').includes('future'));
});
test('confirmed reset replaces current data and removes all older recovery sources', () => {
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const old = defaults(); old.coins = 777; old.xp = 1500; store.save(old);
  storage.setItem('crossfour.save.v2', JSON.stringify(old)); storage.setItem('crossfour.save.v1', JSON.stringify(old));
  const fresh = defaults(); fresh.ad.matchesCompleted = 8;
  const reset = store.reset(fresh);
  assert.strictEqual(reset.ok, true); assert.strictEqual(reset.checkpointed, true);
  assert.strictEqual(storage.getItem('crossfour.save.v2'), null); assert.strictEqual(storage.getItem('crossfour.save.v1'), null);
  assert.strictEqual(JSON.parse(storage.getItem('crossfour.save.v3')).payload.coins, 0);
  assert.strictEqual(JSON.parse(storage.getItem('crossfour.save.checkpoint.v3')).payload.xp, 0);
  const reloaded = make(storage).load();
  assert.strictEqual(reloaded.status, 'loaded'); assert.strictEqual(reloaded.data.coins, 0);
  assert.strictEqual(reloaded.data.ad.matchesCompleted, 8, 'the app-selected ad pacing state remains local and intact');
});
test('JSON snapshot round-trip preserves match state and deterministic RNG continuation', () => {
  const seats = [{ type: 'human' }, { type: 'human' }, null, null];
  const original = L.newGame(seats, {}, 314159, 'classic');
  L.roll(original, 6); L.roll(original, 4); L.move(original, 0, 6); L.move(original, 0, 4);
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const save = defaults(); save.game = { st: original, mode: original.mode };
  assert.strictEqual(store.save(save).ok, true);
  const restored = JSON.parse(storage.getItem('crossfour.save.v3')).payload.game.st;
  assert.deepStrictEqual(restored, original);
  const expected = clone(original), continued = clone(restored);
  const rollA = L.roll(expected), rollB = L.roll(continued);
  assert.deepStrictEqual(rollA, rollB); assert.deepStrictEqual(continued, expected);
});
test('exports a detached validated snapshot without writing or mutating the save', () => {
  const storage = new MemoryStorage(), store = make(storage), source = defaults();
  source.coins = 74; source.settings.sound = false;
  const snapshot = store.exportSnapshot(source);
  assert.strictEqual(snapshot.schemaVersion, 3);
  assert.strictEqual(snapshot.payload.coins, 74);
  assert.strictEqual(snapshot.payload.settings.sound, false);
  snapshot.payload.coins = 999;
  assert.strictEqual(source.coins, 74, 'changing the export does not alter live data');
  assert.strictEqual(storage.getItem('crossfour.save.v3'), null, 'export does not write storage');
  assert.strictEqual(store.exportSnapshot({ invalid: true }), null, 'invalid payloads are not exported');
});

console.log(`\n${pass} save-store checks passed`);
