'use strict';
const assert = require('node:assert/strict');
const SaveStore = require('../www/js/save-store.js');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function defaults() { return { coins: 0, xp: 0, settings: { sound: true, fast: false }, stats: { played: 0 }, game: null }; }
function normalize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    coins: value.coins,
    xp: value.xp,
    settings: value.settings && { sound: value.settings.sound, fast: value.settings.fast },
    stats: value.stats && { played: value.stats.played },
    game: value.game === null ? null : clone(value.game)
  };
}
function validate(value) {
  return !!value && Number.isSafeInteger(value.coins) && value.coins >= 0 &&
    Number.isSafeInteger(value.xp) && value.xp >= 0 &&
    !!value.settings && typeof value.settings.sound === 'boolean' && typeof value.settings.fast === 'boolean' &&
    !!value.stats && Number.isSafeInteger(value.stats.played) && value.stats.played >= 0 &&
    (value.game === null || !!(value.game && value.game.st && value.game.st.v === 2));
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
function backup(payload, savedAt) { return { schemaVersion: 3, savedAt: savedAt === undefined ? 1000 : savedAt, payload: clone(payload) }; }
function stored(storage, key) { const raw = storage.getItem(key); return raw == null ? null : JSON.parse(raw); }

let pass = 0;
function test(name, fn) { fn(); pass++; console.log('  ok -', name); }
console.log('save-store-restore.test.js');

test('inspects without mutation and imports a valid backup while preserving the current save as checkpoint', () => {
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const current = defaults(); current.coins = 31; current.xp = 72; current.stats.played = 4;
  assert.deepStrictEqual(store.save(current), { ok: true });
  const match = { st: { v: 2, rng: 18476, phase: 'roll' }, mode: 'classic' };
  const incoming = defaults(); incoming.coins = 987; incoming.xp = 1234; incoming.stats.played = 19; incoming.settings.fast = true; incoming.game = match;
  const file = backup(incoming, 42), before = JSON.stringify(file);
  const inspected = store.inspectSnapshot(file);
  assert.strictEqual(inspected.ok, true);
  assert.strictEqual(inspected.savedAt, 42);
  assert.deepStrictEqual(inspected.data, incoming);
  inspected.data.coins = 0;
  assert.strictEqual(JSON.stringify(file), before, 'inspection does not change the provided file');

  assert.deepStrictEqual(store.importSnapshot(file), { ok: true });
  assert.deepStrictEqual(stored(storage, 'crossfour.save.v3').payload, incoming);
  assert.strictEqual(stored(storage, 'crossfour.save.v3').savedAt, 1700000000000, 'restored data receives a fresh local save timestamp');
  assert.strictEqual(stored(storage, 'crossfour.save.checkpoint.v3').payload.coins, 31, 'the old valid save remains the recovery checkpoint');
  assert.deepStrictEqual(make(storage).load().data, incoming, 'a new app instance loads the imported payload');
});

test('rejects malformed, incompatible, future, and invalid-timestamp backups without writing', () => {
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const current = defaults(); current.coins = 66; store.save(current);
  const primaryBefore = storage.getItem('crossfour.save.v3');
  const checkpointBefore = storage.getItem('crossfour.save.checkpoint.v3');
  const bad = [
    null,
    { schemaVersion: 2, savedAt: 1, payload: current },
    { schemaVersion: 4, savedAt: 1, payload: current },
    { schemaVersion: 3, savedAt: Infinity, payload: current },
    backup(Object.assign(defaults(), { coins: -1 }))
  ];
  for (const item of bad) {
    assert.strictEqual(store.inspectSnapshot(item).ok, false);
    assert.strictEqual(store.importSnapshot(item).ok, false);
    assert.strictEqual(storage.getItem('crossfour.save.v3'), primaryBefore);
    assert.strictEqual(storage.getItem('crossfour.save.checkpoint.v3'), checkpointBefore);
  }
});

test('a storage failure during import keeps the current primary save and reports the failed stage', () => {
  const storage = new MemoryStorage(), store = make(storage); store.load();
  const current = defaults(); current.coins = 23; store.save(current);
  const primaryBefore = storage.getItem('crossfour.save.v3');
  const incoming = defaults(); incoming.coins = 99;
  storage.failKey = 'crossfour.save.v3';
  const failed = store.importSnapshot(backup(incoming));
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.reason, 'write-failed');
  assert.strictEqual(failed.stage, 'primary');
  assert.strictEqual(storage.getItem('crossfour.save.v3'), primaryBefore);
  assert.strictEqual(stored(storage, 'crossfour.save.checkpoint.v3').payload.coins, 23);
});

test('does not import over a newer schema already stored on the device', () => {
  const storage = new MemoryStorage();
  storage.setItem('crossfour.save.v3', JSON.stringify({ schemaVersion: 4, savedAt: 1, payload: { marker: 'future' } }));
  const store = make(storage); store.load();
  const rawBefore = storage.getItem('crossfour.save.v3');
  const incoming = defaults(); incoming.coins = 99;
  const result = store.importSnapshot(backup(incoming));
  assert.deepStrictEqual({ ok: result.ok, reason: result.reason, stage: result.stage }, { ok: false, reason: 'unsupported-version', stage: 'blocked' });
  assert.strictEqual(storage.getItem('crossfour.save.v3'), rawBefore);
});

console.log(`\n${pass} save-store-restore checks passed`);
