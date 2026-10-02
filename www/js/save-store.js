/* Local-only snapshot boundary for Crossfour. This module performs no network or sync work. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaveStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 3;

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function validSnapshot(value, version, validate) {
    if (!isRecord(value) || value.schemaVersion !== version || typeof value.savedAt !== 'number' ||
        !isFinite(value.savedAt) || value.savedAt < 0 || !Object.prototype.hasOwnProperty.call(value, 'payload')) return false;
    try { return !!validate(value.payload); } catch (e) { return false; }
  }

  function create(storageProvider, options) {
    options = options || {};
    var version = options.version || VERSION;
    var primaryKey = options.key || 'crossfour.save.v' + version;
    var checkpointKey = options.checkpointKey || 'crossfour.save.checkpoint.v' + version;
    var legacyV2Key = options.legacyV2Key || 'crossfour.save.v2';
    var legacyV1Key = options.legacyV1Key || 'crossfour.save.v1';
    var validate = options.validate || isRecord;
    var normalize = options.normalize || function (value) { return isRecord(value) ? clone(value) : null; };
    var defaults = options.defaults || {};
    var clock = options.now || function () { return Date.now(); };
    var lastGood = null;
    var writeBlocked = null;

    function freshDefaults() {
      var value = typeof defaults === 'function' ? defaults() : defaults;
      return clone(value);
    }
    function makeSnapshot(payload) {
      return { schemaVersion: version, savedAt: clock(), payload: clone(payload) };
    }
    function parse(storage, key) {
      var raw;
      try { raw = storage.getItem(key); }
      catch (e) { return { error: e }; }
      if (raw == null) return { missing: true };
      try { return { value: JSON.parse(raw) }; }
      catch (e) { return { corrupt: true }; }
    }
    function legacyV2(value) {
      if (!isRecord(value)) return null;
      var source = value.schemaVersion === 2 && isRecord(value.payload) ? value.payload : value;
      try {
        var data = normalize(clone(source));
        return validate(data) ? data : null;
      } catch (e) { return null; }
    }
    function legacyV1(value) {
      if (!isRecord(value)) return null;
      var source = value.schemaVersion === 1 && isRecord(value.payload) ? value.payload : value;
      var migrated = {};
      ['coins', 'xp', 'owned', 'board', 'dice', 'settings', 'stats', 'ad', 'rules'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(source, key)) migrated[key] = source[key];
      });
      if (isRecord(source.setup)) migrated.setup = source.setup;
      // v1 match data used an incompatible shape. Keep the user's progression and preferences,
      // but only resume a match if a later schema explicitly validates it.
      if (source.setup && isRecord(source.setup.rules)) {
        migrated.rules = {
          safeSquares: source.setup.rules.safeSquares !== false,
          bonusOnCapture: source.setup.rules.extraOnCapture !== false
        };
      }
      try {
        var data = normalize(migrated);
        return validate(data) ? data : null;
      } catch (e) { return null; }
    }
    function result(data, status, source, readonly, reason) {
      return { data: data, status: status, source: source || null, readOnly: !!readonly, reason: reason || null };
    }

    function load() {
      var empty;
      try { empty = freshDefaults(); }
      catch (e) { empty = {}; }
      lastGood = null;
      writeBlocked = null;
      var storage;
      try { storage = typeof storageProvider === 'function' ? storageProvider() : storageProvider; }
      catch (e) { storage = null; }
      if (!storage || typeof storage.getItem !== 'function') {
        writeBlocked = 'storage-unavailable';
        return result(empty, 'unavailable', null, true, writeBlocked);
      }

      var entries = {};
      var readFailed = false;
      [primaryKey, checkpointKey, legacyV2Key, legacyV1Key].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(entries, key)) return;
        entries[key] = parse(storage, key);
        if (entries[key].error) readFailed = true;
      });
      if (readFailed) {
        writeBlocked = 'storage-unavailable';
        return result(empty, 'unavailable', null, true, writeBlocked);
      }

      var primary = entries[primaryKey].value;
      var checkpoint = entries[checkpointKey].value;
      var primaryFuture = isRecord(primary) && typeof primary.schemaVersion === 'number' && primary.schemaVersion > version;
      var checkpointFuture = isRecord(checkpoint) && typeof checkpoint.schemaVersion === 'number' && checkpoint.schemaVersion > version;
      var readonly = primaryFuture || checkpointFuture;
      if (readonly) writeBlocked = 'unsupported-version';

      if (validSnapshot(primary, version, validate)) {
        lastGood = clone(primary);
        return result(clone(primary.payload), 'loaded', 'primary', readonly, writeBlocked);
      }
      if (validSnapshot(checkpoint, version, validate)) {
        lastGood = clone(checkpoint);
        return result(clone(checkpoint.payload), 'recovered', 'checkpoint', readonly, writeBlocked);
      }
      if (readonly) return result(empty, 'unsupported', null, true, writeBlocked);

      var old2 = entries[legacyV2Key].value;
      if (old2 !== undefined) {
        var fromV2 = legacyV2(old2);
        if (fromV2) {
          lastGood = makeSnapshot(fromV2);
          return result(fromV2, 'migrated-v2', 'legacy-v2', false, null);
        }
      }
      var old1 = entries[legacyV1Key].value;
      if (old1 !== undefined) {
        var fromV1 = legacyV1(old1);
        if (fromV1) {
          lastGood = makeSnapshot(fromV1);
          return result(fromV1, 'migrated-v1', 'legacy-v1', false, null);
        }
      }

      lastGood = makeSnapshot(empty);
      return result(empty, 'defaults', null, false, null);
    }

    function save(payload) {
      if (writeBlocked) return { ok: false, reason: writeBlocked, stage: 'blocked' };
      var storage;
      try { storage = typeof storageProvider === 'function' ? storageProvider() : storageProvider; }
      catch (e) { storage = null; }
      if (!storage || typeof storage.setItem !== 'function') return { ok: false, reason: 'storage-unavailable', stage: 'access' };
      try {
        if (!validate(payload)) return { ok: false, reason: 'invalid-snapshot', stage: 'validate' };
        var next = makeSnapshot(payload);
        if (!validSnapshot(next, version, validate)) return { ok: false, reason: 'invalid-snapshot', stage: 'validate' };
        var previous = lastGood || next;
        var stage = 'checkpoint';
        storage.setItem(checkpointKey, JSON.stringify(previous));
        stage = 'primary';
        storage.setItem(primaryKey, JSON.stringify(next));
        lastGood = clone(next);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'write-failed', stage: typeof stage === 'string' ? stage : 'serialize', error: e };
      }
    }

    function reset(payload) {
      if (writeBlocked) return { ok: false, reason: writeBlocked, stage: 'blocked' };
      var storage;
      try { storage = typeof storageProvider === 'function' ? storageProvider() : storageProvider; }
      catch (e) { storage = null; }
      if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') return { ok: false, reason: 'storage-unavailable', stage: 'access' };
      var stage = 'validate';
      try {
        if (!validate(payload)) return { ok: false, reason: 'invalid-snapshot', stage: 'validate' };
        var next = makeSnapshot(payload), serialized = JSON.stringify(next);
        stage = 'cleanup';
        storage.removeItem(checkpointKey);
        storage.removeItem(legacyV2Key);
        storage.removeItem(legacyV1Key);
        stage = 'primary';
        storage.setItem(primaryKey, serialized);
        lastGood = clone(next);
      } catch (e) {
        return { ok: false, reason: 'write-failed', stage: stage, error: e };
      }
      try {
        storage.setItem(checkpointKey, serialized);
        return { ok: true, checkpointed: true };
      } catch (e) {
        // Primary is already the reset snapshot and stale recovery sources are gone.
        return { ok: true, checkpointed: false, reason: 'checkpoint-write-failed', error: e };
      }
    }

    return {
      load: load,
      save: save,
      reset: reset,
      get lastKnownGood() { return lastGood ? clone(lastGood) : null; },
      keys: { primary: primaryKey, checkpoint: checkpointKey, legacyV2: legacyV2Key, legacyV1: legacyV1Key },
      version: version
    };
  }

  return { VERSION: VERSION, create: create };
});
