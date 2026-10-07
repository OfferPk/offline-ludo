'use strict';

const assert = require('node:assert/strict');
const preferences = require('../www/js/online-room-preferences.js');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new MemoryStorage();
assert.deepEqual(preferences.load(storage), { mode: 'classic', classicCapacity: '2' }, 'a new player gets the existing default lobby choices');
assert.equal(preferences.save(storage, 'classic', 4), true, 'Classic seat preference is saved');
assert.deepEqual(preferences.load(storage), { mode: 'classic', classicCapacity: '4' }, 'Classic seat count survives a reload');
assert.equal(preferences.save(storage, 'ludo_chess', 4), true, 'Chess selection saves without losing the last Classic capacity');
assert.deepEqual(preferences.load(storage), { mode: 'ludo_chess', classicCapacity: '4' }, 'Chess restores with exactly two seats while retaining the prior Classic capacity');

storage.setItem(preferences.KEY, '{not json');
assert.deepEqual(preferences.load(storage), { mode: 'classic', classicCapacity: '2' }, 'corrupt stored data safely falls back to defaults');
storage.setItem(preferences.KEY, JSON.stringify({ mode: 'admin', classicCapacity: '99', userId: 'unexpected' }));
assert.deepEqual(preferences.load(storage), { mode: 'classic', classicCapacity: '2' }, 'unknown modes and seat counts are rejected without loading unrelated fields');
storage.setItem(preferences.KEY, JSON.stringify({ mode: 'ludo_chess', classicCapacity: 3 }));
assert.deepEqual(preferences.load(storage), { mode: 'ludo_chess', classicCapacity: '3' }, 'only the documented settings are normalized and restored');
assert.equal(preferences.save(storage, 'ludo_chess', 5), false, 'unsupported capacities are never persisted');
assert.equal(preferences.save(storage, 'unknown', 2), false, 'unsupported modes are never persisted');
assert.deepEqual(preferences.load(null), { mode: 'classic', classicCapacity: '2' }, 'unavailable storage does not block Online Ludo');
assert.equal(preferences.save(null, 'classic', 2), false, 'unavailable storage is a harmless no-op');
assert.deepEqual(preferences.load({ getItem() { throw new Error('blocked'); } }), { mode: 'classic', classicCapacity: '2' }, 'storage read errors are contained');
assert.equal(preferences.save({ setItem() { throw new Error('quota'); } }, 'classic', 2), false, 'storage write errors are contained');

console.log('Online room preference tests passed (defaults, validation, persistence, legacy-safe storage failures).');
