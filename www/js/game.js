/* Crossfour - offline Ludo. UI, per-player dice, stacked rolls, Mystery Tiles, AI turns, chat, persistence, skins, ads hooks. */
(function () {
  'use strict';
  var L = window.LudoLogic, SK = window.SKINS, CFG = window.ADS_CONFIG || {}, ART = window.ART;
  var SFX = window.SFX, Ads = window.Ads;
  var $ = function (id) { return document.getElementById(id); };
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };
  var native = !!(Ads && Ads.isNative());
  var SAVE_KEY = 'crossfour.save.v3', CHECKPOINT_KEY = 'crossfour.save.checkpoint.v3';
  var V2_KEY = 'crossfour.save.v2', OLD_KEY = 'crossfour.save.v1';
  var TUTORIAL_KEY = 'crossfour.tutorial.v1';
  var tutorial = { active: false, intro: false, firstMove: false };
  var NAMES = SK.SEAT_NAMES;
  var LEVEL_NAMES = { easy: 'Easy', medium: 'Normal', hard: 'Hard' };
  var ACCENT = { graphite: ['#f4b740', '#1c1504'], linen: ['#2b3140', '#ffffff'], walnut: ['#e0a232', '#231605'], aurora: ['#27e0b3', '#03261d'] };
  var CORE_LIGHTS = ['#ffd0c1', '#a0ffd2', '#ffe7a3', '#a9ddff'];
  var UNDO_MS = 2200, TIMER_MS = 20000, AUTO_ROLL_MS = 4000, FREE_UNDOS = 3;
  var PHRASES = ['Good luck!', 'Nice move!', 'Oops!', 'So close!', 'Well played!', "Let's go!", 'Not again…', 'Your turn!'];

  // ---------------- save ----------------
  function defaults() {
    return {
      coins: 0, xp: 0, owned: { boards: ['graphite', 'linen'], dice: ['ivory'] }, board: 'graphite', dice: 'ivory',
      settings: { sound: true, haptics: true, auto: true, fast: false, undo: true, timer: false, chat: true },
      rules: L.normRules({}),
      setup: {
        ai: [null, { type: 'ai', level: 'medium' }, null, { type: 'human' }],
        pass: [null, { type: 'human' }, null, { type: 'human' }],
        mode: { ai: 'classic', pass: 'classic' }
      },
      stats: { played: 0, won: 0, streak: 0, captures: 0, home: 0, sixes: 0, pass: 0, events: 0, vs: { easy: [0, 0], medium: [0, 0], hard: [0, 0] }, mystery: [0, 0], lucky: [0, 0], duel: [0, 0], four: [0, 0] },
      flags: { diamondCollection: false }, game: null, ad: {}
    };
  }
  function isRecord(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
  function isInt(x, min, max) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x && x >= min && x <= max; }
  function isCount(x) { return isInt(x, 0, 9007199254740991); }
  function validSeatList(a) {
    return Array.isArray(a) && a.length === 4 && a.every(function (x) {
      return x === null || (isRecord(x) && (x.type === 'human' || (x.type === 'ai' && ['easy', 'medium', 'hard'].indexOf(x.level) >= 0)));
    });
  }
  function sameSeats(a, b) {
    return a.every(function (x, i) { return x === null ? b[i] === null : !!b[i] && x.type === b[i].type && (x.type !== 'ai' || x.level === b[i].level); });
  }
  function validGame(g) {
    if (!isRecord(g) || !isRecord(g.st)) return false;
    var st = g.st, modes = ['classic', 'mystery', 'lucky'];
    if (st.v !== 2 || modes.indexOf(st.mode) < 0 || g.mode !== st.mode || !validSeatList(st.seats) || !validSeatList(g.seats) || !sameSeats(g.seats, st.seats)) return false;
    if (!Array.isArray(st.players) || st.players.length < 2 || st.players.length > 4 || !Array.isArray(st.pieces) || st.pieces.length !== 4 ||
        !Array.isArray(st.stats) || st.stats.length !== 4 || !Array.isArray(st.ranking) || !Array.isArray(st.queue) || !Array.isArray(st.moves) ||
        !Array.isArray(st.faces) || st.faces.length !== 4 || !Array.isArray(st.capd) || st.capd.length !== 4 || !Array.isArray(st.boost) || st.boost.length !== 4 ||
        !Array.isArray(st.effects) || !Array.isArray(st.tiles) || !isRecord(st.rules) || !isInt(st.turn, 0, 3) || !isInt(st.rng, 0, 4294967295) ||
        !isCount(st.rolls) || !isCount(st.turnCount) || !isInt(st.sixes, 0, 3) || !isCount(st.bonus) || typeof st.rollAgain !== 'boolean' ||
        ['roll', 'move', 'over', 'choose'].indexOf(st.phase) < 0 || !st.seats[st.turn]) return false;
    if (st.players.length !== st.seats.filter(Boolean).length || !st.players.every(function (s, i) { return isInt(s, 0, 3) && !!st.seats[s] && st.players.indexOf(s) === i; }) || st.players.indexOf(st.turn) < 0) return false;
    if (!st.ranking.every(function (s, i) { return isInt(s, 0, 3) && st.players.indexOf(s) >= 0 && st.ranking.indexOf(s) === i; })) return false;
    if (!st.queue.every(function (v) { return isInt(v, 1, 6); }) || !st.faces.every(function (v) { return isInt(v, 1, 6); }) ||
        !st.capd.every(function (v) { return typeof v === 'boolean'; }) || !st.boost.every(function (v) { return v === null || v === 'double' || v === 'choose'; })) return false;
    if (!st.pieces.every(function (pieces, s) {
      if (!st.seats[s]) return pieces === null && st.stats[s] === null;
      return Array.isArray(pieces) && pieces.length === 4 && pieces.every(function (p) { return isInt(p, -1, L.HOME); }) &&
        isRecord(st.stats[s]) && ['captures', 'captured', 'sixes', 'home', 'rolls', 'events'].every(function (k) { return isCount(st.stats[s][k]); });
    })) return false;
    var ruleKeys = Object.keys(L.normRules({}));
    if (!ruleKeys.every(function (k) { return k === 'rollStyle' ? (st.rules[k] === 'star' || st.rules[k] === 'classic') : typeof st.rules[k] === 'boolean'; })) return false;
    if (!st.effects.every(function (e) { return isRecord(e) && ['shield', 'freeze'].indexOf(e.type) >= 0 && isInt(e.seat, 0, 3) && isInt(e.piece, 0, 3) && isCount(e.at); })) return false;
    if (!st.tiles.every(function (t) { return isRecord(t) && isInt(t.abs, 0, 51) && ['boost', 'chaos', 'danger'].indexOf(t.kind) >= 0 && isCount(t.until); })) return false;
    if (st.phase === 'choose' && (!isRecord(st.pending) || ['revenge', 'swap', 'wild'].indexOf(st.pending.type) < 0 || !isInt(st.pending.seat, 0, 3) || !Array.isArray(st.pending.options))) return false;
    if (st.phase !== 'choose' && st.pending != null) return false;
    if (st.mode === 'lucky') {
      var lk = st.lk;
      if (!isRecord(lk) || !Array.isArray(lk.charge) || lk.charge.length !== 4 || !lk.charge.every(function (x) { return isInt(x, 0, 5); }) ||
          !Array.isArray(lk.streak) || lk.streak.length !== 4 || !lk.streak.every(function (x) { return isInt(x, 0, 3); }) ||
          !Array.isArray(lk.revenge) || lk.revenge.length !== 4 || !lk.revenge.every(function (x) { return typeof x === 'boolean'; }) ||
          !Array.isArray(lk.powers) || lk.powers.length !== 4 || !lk.powers.every(function (x) { return Array.isArray(x) && x.length <= 2 && x.every(function (id) { return ['dbl', 'six', 'escape'].indexOf(id) >= 0; }); }) ||
          !Array.isArray(lk.kills) || lk.kills.length !== 4 || !lk.kills.every(function (x) { return Array.isArray(x) && x.length === 4 && x.every(function (n) { return isInt(n, 0, 1); }); }) ||
          !Array.isArray(lk.kings) || !lk.kings.every(function (k) { return isRecord(k) && isInt(k.seat, 0, 3) && isInt(k.piece, 0, 3) && isInt(k.left, 1, 3) && isCount(k.at); }) ||
          !(lk.used === null || ['dbl', 'six', 'escape'].indexOf(lk.used) >= 0) || typeof lk.forceSix !== 'boolean' || typeof lk.tg !== 'boolean') return false;
    } else if (st.lk !== null) return false;
    if (!isInt(g.view, 0, 3) || !isInt(g.undoLeft, 0, 3) || !isCount(g.coins) || !isCount(g.xp) ||
        typeof g.doubled !== 'boolean' || typeof g.counted !== 'boolean' || !isCount(g.started)) return false;
    return true;
  }
  function normalizeSeat(x) {
    if (!isRecord(x)) return null;
    if (x.type === 'human') return { type: 'human' };
    if (x.type === 'ai') return { type: 'ai', level: ['easy', 'medium', 'hard'].indexOf(x.level) >= 0 ? x.level : 'medium' };
    return null;
  }
  function normalizeSeats(a, fallback) {
    if (!Array.isArray(a) || a.length !== 4) return fallback.map(function (x) { return x ? normalizeSeat(x) : null; });
    return a.map(function (x) { return x === null ? null : normalizeSeat(x); });
  }
  function safeCounter(x, fallback) { return isCount(x) ? x : fallback; }
  function normalizeSave(raw) {
    if (!isRecord(raw)) return null;
    var d = defaults(), s = d;
    s.coins = safeCounter(raw.coins, d.coins); s.xp = safeCounter(raw.xp, d.xp);
    if (isRecord(raw.owned)) {
      ['boards', 'dice'].forEach(function (kind) { s.owned[kind] = window.SkinShop.normalizeOwned(raw.owned[kind], d.owned[kind]); });
    }
    s.board = SK.BOARDS.some(function (x) { return x.id === raw.board; }) ? raw.board : d.board;
    s.dice = SK.DICE.some(function (x) { return x.id === raw.dice; }) ? raw.dice : d.dice;
    if (isRecord(raw.settings)) Object.keys(d.settings).forEach(function (k) { s.settings[k] = typeof raw.settings[k] === 'boolean' ? raw.settings[k] : d.settings[k]; });
    if (isRecord(raw.rules)) Object.keys(d.rules).forEach(function (k) {
      s.rules[k] = k === 'rollStyle' ? (raw.rules[k] === 'classic' || raw.rules[k] === 'star' ? raw.rules[k] : d.rules[k]) :
        (typeof raw.rules[k] === 'boolean' ? raw.rules[k] : d.rules[k]);
    });
    if (isRecord(raw.setup)) {
      s.setup.ai = normalizeSeats(raw.setup.ai, d.setup.ai); s.setup.pass = normalizeSeats(raw.setup.pass, d.setup.pass);
      if (isRecord(raw.setup.mode)) ['ai', 'pass'].forEach(function (k) { s.setup.mode[k] = ['classic', 'mystery', 'lucky'].indexOf(raw.setup.mode[k]) >= 0 ? raw.setup.mode[k] : d.setup.mode[k]; });
    }
    if (isRecord(raw.stats)) {
      Object.keys(d.stats).forEach(function (k) {
        if (k === 'vs') {
          if (isRecord(raw.stats.vs)) Object.keys(d.stats.vs).forEach(function (level) {
            var pair = raw.stats.vs[level]; if (Array.isArray(pair) && pair.length === 2) s.stats.vs[level] = [safeCounter(pair[0], 0), safeCounter(pair[1], 0)];
          });
        } else if (['mystery', 'lucky', 'duel', 'four'].indexOf(k) >= 0) {
          var p = raw.stats[k]; if (Array.isArray(p) && p.length === 2) s.stats[k] = [safeCounter(p[0], 0), safeCounter(p[1], 0)];
        } else s.stats[k] = safeCounter(raw.stats[k], d.stats[k]);
      });
    }
    if (isRecord(raw.flags)) Object.keys(d.flags).forEach(function (k) { s.flags[k] = raw.flags[k] === true; });
    if (isRecord(raw.ad)) ['sessions', 'matchesSince', 'lastTs', 'playMs', 'matchesCompleted'].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(raw.ad, k)) s.ad[k] = safeCounter(raw.ad[k], 0);
    });
    if (validGame(raw.game)) {
      s.game = JSON.parse(JSON.stringify(raw.game));
      delete s.game.timerTk; delete s.game.actor; s.game.undo = null; s.game.sel = null;
      s.game.st.moves = s.game.st.phase === 'move' ? L.queueMoves(s.game.st) : [];
    } else s.game = null;
    return s;
  }
  function validSave(s) {
    if (!isRecord(s) || !Object.prototype.hasOwnProperty.call(s, 'game') || !isCount(s.coins) || !isCount(s.xp) || !isRecord(s.owned) || !Array.isArray(s.owned.boards) || !Array.isArray(s.owned.dice) ||
        !s.owned.boards.every(function (id) { return typeof id === 'string' && id.length <= 32; }) || !s.owned.dice.every(function (id) { return typeof id === 'string' && id.length <= 32; }) ||
        !SK.BOARDS.some(function (x) { return x.id === s.board; }) || !SK.DICE.some(function (x) { return x.id === s.dice; }) || !isRecord(s.settings) ||
        !isRecord(s.rules) || !isRecord(s.setup) || !isRecord(s.stats) || !isRecord(s.ad) || !(s.game === null || validGame(s.game))) return false;
    if (!Object.keys(defaults().settings).every(function (k) { return typeof s.settings[k] === 'boolean'; })) return false;
    if (s.flags !== undefined && (!isRecord(s.flags) || !Object.keys(s.flags).every(function (k) { return typeof s.flags[k] === 'boolean'; }))) return false;
    if (!Object.keys(defaults().rules).every(function (k) { return k === 'rollStyle' ? ['star', 'classic'].indexOf(s.rules[k]) >= 0 : typeof s.rules[k] === 'boolean'; })) return false;
    if (!validSeatList(s.setup.ai) || !validSeatList(s.setup.pass) || !isRecord(s.setup.mode) || !['ai', 'pass'].every(function (k) { return ['classic', 'mystery', 'lucky'].indexOf(s.setup.mode[k]) >= 0; })) return false;
    var ds = defaults().stats;
    if (!Object.keys(ds).every(function (k) {
      if (k === 'streak') return s.stats.streak === undefined || isCount(s.stats.streak);
      if (k === 'vs') return isRecord(s.stats.vs) && Object.keys(ds.vs).every(function (level) { return Array.isArray(s.stats.vs[level]) && s.stats.vs[level].length === 2 && s.stats.vs[level].every(isCount); });
      if (['mystery', 'lucky', 'duel', 'four'].indexOf(k) >= 0) return Array.isArray(s.stats[k]) && s.stats[k].length === 2 && s.stats[k].every(isCount);
      return isCount(s.stats[k]);
    })) return false;
    return ['sessions', 'matchesSince', 'lastTs', 'playMs', 'matchesCompleted'].every(function (k) { return s.ad[k] === undefined || isCount(s.ad[k]); });
  }
  var saveStore = window.SaveStore.create(function () { return window.localStorage; }, {
    key: SAVE_KEY, checkpointKey: CHECKPOINT_KEY, legacyV2Key: V2_KEY, legacyV1Key: OLD_KEY,
    defaults: defaults, normalize: normalizeSave, validate: validSave
  });
  var loadResult = saveStore.load();
  var save = normalizeSave(loadResult.data) || defaults();
  loadResult.data = save;
  var saveWriteFailed = false;
  var lastSaveError = null;
  function persist() {
    var result;
    try {
      var snapshotData = JSON.parse(JSON.stringify(save));
      if (snapshotData.game) { delete snapshotData.game.timerTk; delete snapshotData.game.actor; snapshotData.game.undo = null; snapshotData.game.sel = null; }
      result = saveStore.save(snapshotData);
    } catch (e) { result = { ok: false, reason: 'invalid-snapshot' }; }
    if (!result.ok) {
      lastSaveError = { reason: result.reason, stage: result.stage };
      if (!saveWriteFailed) {
        var warning = $('save-warning');
        warning.textContent = 'Save failed. Your latest progress may not be saved on this device. Keep the app open and check device storage.';
        warning.classList.remove('hidden');
      }
      saveWriteFailed = true;
      return false;
    }
    lastSaveError = null;
    if (saveWriteFailed) {
      saveWriteFailed = false;
      $('save-warning').classList.add('hidden');
      if (typeof toast === 'function') toast('Saving has resumed', 1800);
    }
    return true;
  }
  var gate = window.AdGate.create(CFG, save.ad); save.ad = gate.state;
  gate.sessionStarted();
  persist();

  var G = validGame(save.game) ? save.game : null;
  if (!G) save.game = null;
  if (G) {
    G.undo = null; G.sel = null; delete G.timerTk; delete G.actor;
    G.st.moves = G.st.phase === 'move' ? L.queueMoves(G.st) : [];
  }

  // ---------------- helpers ----------------
  function hex2rgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function mix(h, to, f) { var a = hex2rgb(h), b = to === 'w' ? [255, 255, 255] : [0, 0, 0]; return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * f); }).join(',') + ')'; }
  function rgba(h, a) { var c = hex2rgb(h); return 'rgba(' + c.join(',') + ',' + a + ')'; }
  function haptic(kind) {
    if (!save.settings.haptics || !native) return;
    var Hp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (!Hp) return;
    try {
      var task;
      if (kind === 'success') task = Hp.notification({ type: 'SUCCESS' });
      else if (kind === 'warn') task = Hp.notification({ type: 'WARNING' });
      else task = Hp.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      if (task && typeof task.catch === 'function') task.catch(function () {});
    } catch (e) {}
  }
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 1600);
  }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function isOpen(id) { return !$(id).classList.contains('hidden'); }
  function setCoins() { each(document.querySelectorAll('.coins-val'), function (e) { e.textContent = save.coins; }); }
  function setLevel() { var l = L.levelFromXp(save.xp), progress = Math.round(l.into / l.need * 100); $('lvl-badge').textContent = l.level; $('lvl-fill').style.width = progress + '%'; $('lvl-fill').parentNode.setAttribute('aria-valuenow', progress); $('home-stat-played').textContent = save.stats.played; $('home-stat-won').textContent = save.stats.won; }
  function board() { for (var i = 0; i < SK.BOARDS.length; i++) if (SK.BOARDS[i].id === save.board) return SK.BOARDS[i]; return SK.BOARDS[0]; }
  function dice() { for (var i = 0; i < SK.DICE.length; i++) if (SK.DICE[i].id === save.dice) return SK.DICE[i]; return SK.DICE[0]; }
  function seatColor(s) { return board().seats[s]; }
  function stepMs() { return save.settings.fast ? 85 : 150; }
  function aiDelay() { return save.settings.fast ? 300 : 600; }

  // ---------------- skins ----------------
  function applySkin() {
    var b = board(), d = dice(), r = document.documentElement.style;
    r.setProperty('--bg', b.bg); r.setProperty('--page', b.page); r.setProperty('--board', b.board); r.setProperty('--ink', b.ink); r.setProperty('--muted', b.muted);
    b.seats.forEach(function (c, i) { r.setProperty('--s' + i, c); });
    var acc = ACCENT[b.id] || ACCENT.graphite; r.setProperty('--accent', acc[0]); r.setProperty('--accent-ink', acc[1]);
    r.setProperty('--d-face', d.face); r.setProperty('--d-edge', d.edge); r.setProperty('--d-pip', d.pip);
    document.body.classList.toggle('light', !b.dark);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', b.bg);
  }

  // ---------------- board drawing ----------------
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function star(ctx, cx, cy, R, r) { ctx.beginPath(); for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? r : R; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } ctx.closePath(); }
  var BASE_ORIGIN = [[0, 0], [0, 9], [9, 9], [9, 0]]; // [row, col] of each seat's 6x6 base
  function drawBoard(cv, sz, b, rules, active, view) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(sz * dpr); cv.height = Math.round(sz * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = sz / 15, gap = Math.max(1, c * 0.07);
    ctx.clearRect(0, 0, sz, sz);
    rr(ctx, 0, 0, sz, sz, c * 0.7); ctx.fillStyle = b.board; ctx.fill();
    ctx.save(); ctx.translate(sz / 2, sz / 2); ctx.rotate((view || 0) * Math.PI / 2); ctx.translate(-sz / 2, -sz / 2);
    for (var s = 0; s < 4; s++) {
      var o = BASE_ORIGIN[s], x = o[1] * c, y = o[0] * c, col = b.seats[s];
      ctx.globalAlpha = active && !active[s] ? 0.3 : 1;
      var g = ctx.createLinearGradient(x, y, x + 6 * c, y + 6 * c); g.addColorStop(0, mix(col, 'w', 0.08)); g.addColorStop(1, mix(col, 'b', 0.18));
      rr(ctx, x + gap * 2, y + gap * 2, 6 * c - gap * 4, 6 * c - gap * 4, c * 0.6); ctx.fillStyle = g; ctx.fill();
      rr(ctx, x + c * 0.85, y + c * 0.85, 4.3 * c, 4.3 * c, c * 0.5); ctx.fillStyle = b.center; ctx.fill();
      L.BASE_SPOTS[s].forEach(function (p) {
        var cx = (p[1] + 0.5) * c, cy = (p[0] + 0.5) * c;
        ctx.beginPath(); ctx.arc(cx, cy, c * 0.52, 0, Math.PI * 2); ctx.fillStyle = rgba(col, 0.22); ctx.fill();
        ctx.lineWidth = Math.max(1.5, c * 0.08); ctx.strokeStyle = rgba(col, 0.9); ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
    function cell(rc, fill, edge) {
      var x = rc[1] * c + gap / 2, y = rc[0] * c + gap / 2;
      rr(ctx, x, y, c - gap, c - gap, c * 0.2); ctx.fillStyle = fill; ctx.fill();
      if (edge) { ctx.lineWidth = 1; ctx.strokeStyle = edge; ctx.stroke(); }
    }
    L.TRACK_CELLS.forEach(function (rc, a) {
      var startOf = L.START_SQUARES.indexOf(a), isStar = L.STAR_SQUARES.indexOf(a) >= 0;
      if (startOf >= 0) cell(rc, b.seats[startOf], null); else cell(rc, b.cell, b.cellEdge);
      var cx = (rc[1] + 0.5) * c, cy = (rc[0] + 0.5) * c;
      if (startOf >= 0) {
        ctx.save(); ctx.translate(cx, cy);
        var nx = L.TRACK_CELLS[(a + 1) % 52]; ctx.rotate(Math.atan2(nx[0] - rc[0], nx[1] - rc[1]));
        ctx.beginPath(); ctx.moveTo(-c * 0.16, -c * 0.22); ctx.lineTo(c * 0.12, 0); ctx.lineTo(-c * 0.16, c * 0.22);
        ctx.lineWidth = Math.max(1.5, c * 0.09); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke(); ctx.restore();
      } else if (isStar) {
        star(ctx, cx, cy, c * 0.3, c * 0.13);
        if (rules.safeSquares) { ctx.fillStyle = rgba(b.muted.length === 7 ? b.muted : '#888888', 0.9); ctx.fill(); }
        else { ctx.lineWidth = 1; ctx.strokeStyle = rgba(b.muted, 0.35); ctx.stroke(); }
      }
    });
    for (s = 0; s < 4; s++) L.HOME_COLS[s].forEach(function (rc, k) { cell(rc, rgba(b.seats[s], 0.55 + k * 0.08), null); });
    var m0 = 6 * c, m1 = 9 * c, mc = 7.5 * c;
    var tri = [[[m0, m0], [m0, m1]], [[m0, m0], [m1, m0]], [[m1, m0], [m1, m1]], [[m0, m1], [m1, m1]]];
    for (s = 0; s < 4; s++) {
      ctx.beginPath(); ctx.moveTo(tri[s][0][0], tri[s][0][1]); ctx.lineTo(tri[s][1][0], tri[s][1][1]); ctx.lineTo(mc, mc); ctx.closePath();
      var gg = ctx.createLinearGradient(tri[s][0][0], tri[s][0][1], mc, mc); gg.addColorStop(0, b.seats[s]); gg.addColorStop(1, mix(b.seats[s], 'b', 0.25));
      ctx.fillStyle = gg; ctx.fill(); ctx.lineWidth = gap; ctx.strokeStyle = b.board; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(mc, mc, c * 0.42, 0, Math.PI * 2); ctx.fillStyle = b.board; ctx.fill();
    ctx.save(); ctx.translate(mc, mc); ctx.rotate(Math.PI / 4);
    for (s = 0; s < 4; s++) { ctx.fillStyle = b.seats[s]; var q = c * 0.13; ctx.fillRect((s % 2 ? 0.02 : -1.02) * q * 1.6, (s < 2 ? -1.02 : 0.02) * q * 1.6, q * 1.5, q * 1.5); }
    ctx.restore();
    ctx.restore();
    if (b.glow) { ctx.save(); rr(ctx, 1, 1, sz - 2, sz - 2, c * 0.7); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(120,160,255,.35)'; ctx.shadowColor = 'rgba(120,160,255,.6)'; ctx.shadowBlur = 12; ctx.stroke(); ctx.restore(); }
  }

  // ---------------- view (the first human sits bottom-left) ----------------
  function viewOf(st) { var h = -1; for (var i = 0; i < st.players.length; i++) if (st.seats[st.players[i]].type === 'human') { h = st.players[i]; break; } return h < 0 ? 0 : (3 - h + 4) % 4; }
  function VIEW() { return G ? G.view || 0 : 0; }
  function slotOf(seat) { return (seat + VIEW()) % 4; }
  function seatAt(slot) { return (slot - VIEW() + 8) % 4; }

  // ---------------- layout, pods, tiles & pieces ----------------
  var BS = 320, CELL = BS / 15;
  var pieceEls = [[], [], [], []];
  var piecePos = {};
  var moving = {};
  var activeMotions = {};
  function cubeHTML() { var h = '<div class="cube">'; for (var f = 1; f <= 6; f++) { h += '<div class="face f' + f + '">'; for (var k = 0; k < f; k++) h += '<i></i>'; h += '</div>'; } return h + '</div>'; }
  function podEl(seat) { return document.querySelector('.pod[data-slot="' + slotOf(seat) + '"]'); }
  function buildPods() {
    each(document.querySelectorAll('.pod'), function (el) {
      var slot = +el.dataset.slot, s = seatAt(slot), side = (slot === 1 || slot === 2 ? ' right' : '') + (slot < 2 ? ' top' : ' bottom');
      el.dataset.seat = s;
      if (!G || !G.st.seats[s]) { el.className = 'pod empty' + side; el.innerHTML = ''; return; }
      var pl = G.st.seats[s];
      el.className = 'pod' + side;
      el.style.setProperty('--pc', seatColor(s)); el.style.setProperty('--pca', rgba(seatColor(s), 0.25));
      el.innerHTML = '<div class="avatar"><svg class="tring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20"/></svg><span class="av">' + ART.avatar(pl.type) + '</span>' +
        (pl.type === 'ai' ? '<span class="lvtag">' + LEVEL_NAMES[pl.level].charAt(0) + '</span>' : '') + '<span class="lkb"></span></div>' +
        '<div class="pmeta"><b class="pname"></b><small class="plvl"></small><div class="chips"></div></div>' +
        '<button class="pdice" aria-label="Roll the die for ' + NAMES[s] + ' (tap or swipe)">' + cubeHTML() + '<i class="roll-countdown" aria-hidden="true"></i><em class="boost-tag hidden"></em></button>' +
        '<div class="bubble hidden"></div>';
      var die = el.querySelector('.pdice');
      window.DiceGesture.bind(die, function (e) {
        SFX.unlock();
        if (G && G.st.turn === s && isHuman(s)) { keyboardRoll = e.detail === 0; doRoll(); }
      }, function () {
        SFX.unlock(); keyboardRoll = false;
        if (G && G.st.turn === s && isHuman(s)) doRoll();
      });
      setDiceFace(s, G.st.faces ? G.st.faces[s] : 1, true);
    });
  }
  function hasTiles() { return G && (G.st.mode === 'mystery' || G.st.mode === 'lucky'); }
  function buildTiles() {
    var box = $('tiles'); box.innerHTML = '';
    if (!hasTiles()) return;
    var lucky = G.st.mode === 'lucky';
    G.st.tiles.forEach(function (t, i) {
      var e = document.createElement('div'); e.className = 'tile ' + t.kind + (lucky ? ' lk' : ''); e.dataset.i = i;
      e.innerHTML = '<span>' + (t.kind === 'boost' ? '?' : t.kind === 'chaos' ? '!' : '!!') + '</span>' + (lucky ? '<i class="cd"></i>' : '');
      e.title = t.kind === 'danger' ? 'Danger tile: High Risk / High Reward' : t.kind === 'boost' ? 'Boost tile' : 'Chaos tile';
      box.appendChild(e);
    });
  }
  function layoutTiles() {
    if (!hasTiles()) return;
    var st = G.st, n = Math.max(1, L.activeLeft(st).length);
    each($('tiles').children, function (e) {
      var t = st.tiles[+e.dataset.i], c = center(L.TRACK_CELLS[t.abs]), rest = st.turnCount < t.until;
      e.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px)';
      e.classList.toggle('rest', rest);
      var cd = e.querySelector('.cd'); if (cd) cd.textContent = rest ? Math.ceil((t.until - st.turnCount) / n) : ''; // rounds left
    });
  }
  function buildPieces() {
    var box = $('pieces'); box.innerHTML = ''; pieceEls = [[], [], [], []];
    if (!G) return;
    for (var s = 0; s < 4; s++) {
      if (!G.st.pieces[s]) continue;
      var col = seatColor(s);
      for (var i = 0; i < 4; i++) {
        var el = document.createElement('button'); el.type = 'button'; el.className = 'pc';
        el.innerHTML = '<svg class="gem-token" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<defs><linearGradient id="gem-body-' + s + '-' + i + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pcl)" stop-opacity=".92"/><stop offset=".48" stop-color="var(--pcd)" stop-opacity=".94"/><stop offset="1" stop-color="var(--pcdd)" stop-opacity=".98"/></linearGradient>' +
          '<radialGradient id="gem-core-' + s + '-' + i + '" cx="50%" cy="46%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".2" stop-color="var(--pccore)" stop-opacity=".98"/><stop offset=".58" stop-color="var(--pccore)" stop-opacity=".78"/><stop offset="1" stop-color="var(--pccore)" stop-opacity="0"/></radialGradient></defs>' +
          '<ellipse class="gem-ground" cx="12" cy="20" rx="10" ry="3.1"/>' +
          '<path class="gem-pad" d="M5.2 17.1 18.8 17.1 17.2 22.5 6.8 22.5Z"/>' +
          '<ellipse class="gem-shadow" cx="12" cy="21.1" rx="7.8" ry="1.5"/>' +
          '<path class="gem-body" style="fill:url(#gem-body-' + s + '-' + i + ')" d="M12 1.1 19.2 5 17 12.6 12 18.7 7 12.6 4.8 5Z"/>' +
          '<path class="gem-facet gem-facet-light" d="M12 1.1 12 13.6 7 12.6 4.8 5Z"/>' +
          '<path class="gem-facet gem-facet-dark" d="M12 1.1 19.2 5 17 12.6 12 13.6Z"/>' +
          '<path class="gem-facet gem-facet-side" d="M7 12.6 12 13.6 9.5 16.3Z"/>' +
          '<path class="gem-facet gem-facet-base" d="M7 12.6 12 13.6 17 12.6 12 18.7Z"/>' +
          '<ellipse class="gem-core" style="fill:url(#gem-core-' + s + '-' + i + ')" cx="12" cy="9.2" rx="3.1" ry="4.1"/>' +
          '<path class="gem-glint" d="M6.1 5.2 10.4 2.8 8.2 6.8 6.8 7.5Z"/>' +
          '<circle class="gem-shield" cx="12" cy="10.2" r="9.3"/>' +
          '<path class="gem-shield-glint" d="M6.1 8.2c1.2-3.4 4-5.1 7.3-5.3"/>' +
          '<path class="gem-frost-wash" d="M12 1.1 19.2 5 17 12.6 12 18.7 7 12.6 4.8 5Z"/>' +
          '<path class="gem-frost-crack" d="m14.4 4.6-2 3.2 1.5 1.6-2.2 2.3 1.2 2.6-2.1 2.1"/>' +
          '</svg><i class="crown">' + ART.icon('crown', 16) + '</i>';
        el.style.setProperty('--pc', col); el.style.setProperty('--pcl', mix(col, 'w', 0.55)); el.style.setProperty('--pcd', mix(col, 'b', 0.3)); el.style.setProperty('--pcdd', mix(col, 'b', 0.45)); el.style.setProperty('--pccore', CORE_LIGHTS[s]);
        el.dataset.seat = s; el.dataset.piece = i;
        el.addEventListener('click', function (e) {
          if (e.detail !== 0 || !G || busy || paused || G.st.phase !== 'move' || !isHuman(G.st.turn)) return;
          var seat = +this.dataset.seat, piece = +this.dataset.piece;
          var pool = G.sel != null && chipMoves(G.sel).length ? chipMoves(G.sel) : G.st.moves;
          var m = pool.filter(function (x) { return x.seat === seat && x.piece === piece; })[0];
          if (m) { SFX.unlock(); doMove(m.piece, m.v, true); }
        });
        box.appendChild(el); pieceEls[s].push(el);
      }
    }
  }
  function center(rc) { var r = L.rot(rc, VIEW()); return { x: (r[1] + 0.5) * CELL, y: (r[0] + 0.5) * CELL }; }
  function place(el, x, y, sc) { el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + (sc || 1) + ')'; }
  function placeToken(s, i, p, sc) { var el = pieceEls[s][i]; if (!el) return; var c = center(L.cellOf(s, p, i)); place(el, c.x, c.y, sc || 1); piecePos[s + '-' + i] = c; }
  var CLUSTER = { 2: [[-0.2, 0], [0.2, 0]], 3: [[-0.2, -0.17], [0.2, -0.17], [0, 0.2]], 4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] };
  function layoutPieces(instant) {
    if (!G) return;
    var st = G.st, groups = {};
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s]) continue;
      for (var i = 0; i < 4; i++) {
        var p = st.pieces[s][i];
        var key = (p < 0 || p === L.HOME) ? 's' + s + 'p' + i + 'b' + p : (L.onTrack(p) ? 'a' + L.absOf(s, p) : 'h' + s + '-' + p);
        (groups[key] = groups[key] || []).push([s, i]);
      }
    }
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], n = g.length;
      g.forEach(function (si, idx) {
        var s = si[0], i = si[1], id = s + '-' + i, el = pieceEls[s][i];
        if (!el || moving[id]) return;
        var p = st.pieces[s][i], c = center(L.cellOf(s, p, i)), sc = p === L.HOME ? 0.72 : 1;
        if (n > 1) { var off = CLUSTER[Math.min(n, 4)][Math.min(idx, 3)]; c.x += off[0] * CELL; c.y += off[1] * CELL; sc = 0.78; }
        if (instant) { el.style.transition = 'none'; place(el, c.x, c.y, sc); void el.offsetWidth; el.style.transition = ''; }
        else place(el, c.x, c.y, sc);
        el.classList.toggle('done', p === L.HOME);
        var shielded = L.isShielded(st, s, i), frozen = L.isFrozen(st, s, i), king = !!(st.lk && L.isKing(st, s, i));
        el.classList.toggle('shield', shielded); el.classList.toggle('is-shielded', shielded);
        el.classList.toggle('frozen', frozen); el.classList.toggle('is-frozen', frozen);
        el.classList.toggle('king', king); el.classList.toggle('is-king', king);
        piecePos[id] = c;
      });
    });
    layoutTiles();
  }
  function layout() {
    var stage = $('stage'); if (!stage || $('game').classList.contains('hidden')) return;
    var r = stage.getBoundingClientRect();
    var podH = 58, tool = 46;
    var w = Math.min(r.width - 12, 560), h = r.height - (podH * 2 + tool + 6 * 3 + 4);
    var bs = Math.floor(Math.max(210, Math.min(w, h)));
    BS = bs; CELL = bs / 15;
    var root = document.documentElement.style; root.setProperty('--bs', bs + 'px'); root.setProperty('--cell', CELL + 'px'); root.setProperty('--step-ms', stepMs() + 'ms');
    drawBoard($('board'), bs, board(), G ? G.st.rules : L.DEFAULT_RULES, G ? G.st.seats : null, VIEW());
    layoutPieces(true);
  }

  // ---------------- flow control ----------------
  var runToken = 0, timers = [], busy = false, paused = false, keyboardRoll = false;
  var autoRollTk = null, autoRollKey = null, autoRollDeadline = 0, autoRollRemaining = null;
  function later(fn, ms) { var tk = runToken; var id = setTimeout(function () { var k = timers.indexOf(id); if (k >= 0) timers.splice(k, 1); if (tk === runToken) fn(); }, ms); timers.push(id); return id; }
  function cancelFlow() { stopAutoRollTimer(false); runToken++; timers.forEach(clearTimeout); timers = []; Object.keys(activeMotions).forEach(function (id) { var motion = activeMotions[id]; if (motion && motion.cancel) motion.cancel(); }); activeMotions = {}; moving = {}; busy = false; keyboardRoll = false; if (G) { G.undo = null; G.actor = null; } hide('wheel'); hide('picker'); hide('choice'); }
  function gameVisible() { return !$('game').classList.contains('hidden') && document.visibilityState === 'visible'; }
  function humans(st) { return st.players.filter(function (s) { return st.seats[s].type === 'human'; }); }
  function hasAI(st) { return st.players.some(function (s) { return st.seats[s].type === 'ai'; }); }
  function isHuman(s) { return G && G.st.seats[s] && G.st.seats[s].type === 'human'; }
  function nameOf(s) { var st = G.st; if (st.seats[s].type === 'human' && humans(st).length === 1) return 'You'; return NAMES[s]; }
  function levelOf(s) { var pl = G.st.seats[s]; return pl.type === 'human' ? (humans(G.st).length === 1 ? 'Lv ' + L.levelFromXp(save.xp).level : 'P' + (humans(G.st).indexOf(s) + 1)) : LEVEL_NAMES[pl.level]; }
  function undoActive() { return !!(G && G.undo && G.undo.until > Date.now()); }

  var forced = [], forcedEvents = [], forcedMega = []; // test hooks
  function chipMoves(v) { return G.st.moves.filter(function (m) { return m.v === v; }); }
  function ensureSel() {
    var st = G.st;
    if (st.phase !== 'move') { G.sel = null; return; }
    if (G.sel != null && chipMoves(G.sel).length) return;
    G.sel = null;
    for (var i = 0; i < st.queue.length; i++) if (chipMoves(st.queue[i]).length) { G.sel = st.queue[i]; break; }
  }
  function tutorialSeen() {
    try { return window.localStorage.getItem(TUTORIAL_KEY) === '1'; }
    catch (e) { return false; }
  }
  function markTutorialSeen() {
    try { window.localStorage.setItem(TUTORIAL_KEY, '1'); }
    catch (e) { /* The tutorial still works if device storage is unavailable. */ }
  }
  function updateTutorial() {
    var intro = $('tutorial-intro'), coach = $('tutorial-coach');
    if (!tutorial.active || !G || G.mode !== 'classic' || $('game').classList.contains('hidden')) {
      intro.classList.add('hidden'); coach.classList.add('hidden');
      each(document.querySelectorAll('.tutorial-target'), function (el) { el.classList.remove('tutorial-target'); });
      return;
    }
    if (tutorial.intro) { intro.classList.remove('hidden'); coach.classList.add('hidden'); return; }
    intro.classList.add('hidden');
    var st = G.st;
    var stage = tutorial.firstMove || st.phase === 'over' ? 'finish' : !isHuman(st.turn) ? 'wait' : st.phase === 'move' ? 'move' : 'roll';
    var title, copy, kicker, progress;
    if (stage === 'wait') {
      kicker = 'FIRST MATCH · GET READY'; title = 'Your turn is coming up';
      copy = 'Watch the board. When it’s your turn, tap or swipe the highlighted die. You need a 6 to bring a token out of base.';
      progress = 1;
    } else if (stage === 'roll') {
      kicker = 'FIRST MATCH · STEP 1 OF 2'; title = 'Roll your die';
      if (st.queue.length || st.sixes || st.bonus) copy = save.rules.rollStyle === 'star' ? 'A 6 earns another roll. Your dice stay as chips in your corner until it’s time to move.' : 'Roll again when you’re ready. A 6 gives you another roll after you move it.';
      else copy = 'Tap or swipe the die in your corner. You need a 6 to bring a token out of base.';
      progress = 1;
    } else if (stage === 'move') {
      kicker = 'FIRST MATCH · STEP 2 OF 2'; title = 'Choose a move';
      copy = save.settings.auto ? 'Tap a dice chip, then a glowing token. If only one move is possible, Auto-move may play it for you.' : 'Tap a dice chip, then tap one of your glowing tokens to move it.';
      progress = 2;
    } else {
      kicker = 'FIRST MATCH · ALL SET'; title = 'Nice first move!';
      var bonusCopy = save.rules.bonusOnCapture && save.rules.bonusOnHome ? ' Captures and reaching home each earn a bonus roll.' :
        save.rules.bonusOnCapture ? ' Captures earn a bonus roll.' : save.rules.bonusOnHome ? ' Reaching home earns a bonus roll.' : '';
      copy = 'Roll a 6 to launch tokens and move clockwise.' + bonusCopy + ' You need an exact roll to reach home; first to bring all 4 tokens home wins.';
      progress = 3;
    }
    $('tutorial-kicker').textContent = kicker;
    $('tutorial-title').textContent = title;
    $('tutorial-copy').textContent = copy;
    $('tutorial-done').classList.toggle('hidden', stage !== 'finish');
    each(document.querySelectorAll('.tutorial-progress i'), function (el, i) { el.classList.toggle('on', i < progress); });
    coach.classList.remove('hidden');
    each(document.querySelectorAll('.tutorial-target'), function (el) { el.classList.remove('tutorial-target'); });
    var target = null, anchorTarget = null, pod = podEl(st.turn);
    if (stage === 'roll' && pod) target = pod.querySelector('.pdice');
    else if (stage === 'move' && pod) {
      target = pod.querySelector('.chip-v:not(.dim)') || document.querySelector('#pieces .pc.can');
      anchorTarget = document.querySelector('#pieces .pc.can') || target;
    } else target = $('turn-label');
    if (!anchorTarget) anchorTarget = target;
    if (target) target.classList.add('tutorial-target');
    var card = coach.querySelector('.tutorial-card'), anchor = anchorTarget && anchorTarget.getBoundingClientRect();
    if (!anchor || !anchor.width) anchor = $('turn-label').getBoundingClientRect();
    var cardRect = card.getBoundingClientRect(), pad = 12, minTop = Math.max(58, (window.visualViewport ? window.visualViewport.offsetTop : 0) + 8);
    var left = Math.max(pad, Math.min(window.innerWidth - cardRect.width - pad, anchor.left + anchor.width / 2 - cardRect.width / 2));
    var top = anchor.top < window.innerHeight / 2 ? anchor.bottom + 12 : anchor.top - cardRect.height - 12;
    top = Math.max(minTop, Math.min(window.innerHeight - cardRect.height - pad, top));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }
  function closeTutorial() {
    markTutorialSeen(); tutorial.active = false; tutorial.intro = false; tutorial.firstMove = false;
    $('tutorial-intro').classList.add('hidden'); $('tutorial-coach').classList.add('hidden');
    each(document.querySelectorAll('.tutorial-target'), function (el) { el.classList.remove('tutorial-target'); });
    if (G && !$('game').classList.contains('hidden') && !paused) { render(); advance(); }
  }
  function beginTutorial() {
    if (!tutorial.active || !tutorial.intro) return;
    markTutorialSeen(); tutorial.intro = false;
    $('tutorial-intro').classList.add('hidden'); updateTutorial();
    advance(); focusTurnControl();
  }
  // ---- Lucky Chaos pod widgets: charge meter, streak, revenge, stored powers, Mega button ----
  var POWER_NAMES = { dbl: 'Double Roll', six: 'Lucky 6', escape: 'Safe Escape' };
  function luckyMeter(st, s) {
    var lk = st.lk, c = lk.charge[s], h = '<span class="chg' + (c >= L.MAX_CHARGE ? ' full' : '') + '" title="Lucky Charge ' + c + '/5">';
    for (var k = 0; k < L.MAX_CHARGE; k++) h += '<i' + (k < c ? ' class="on"' : '') + '></i>';
    return h + '</span>';
  }
  function luckyBadges(st, s) {
    var lk = st.lk, h = '';
    if (lk.streak[s]) h += '<span class="stk" title="Lucky Streak ×' + lk.streak[s] + '">' + ART.icon('flame', 10) + lk.streak[s] + '</span>';
    if (lk.revenge[s]) h += '<span class="rev" title="Revenge Charge">' + ART.icon('revenge', 10) + '</span>';
    return h;
  }
  function luckyPowers(st, s, active) {
    var lk = st.lk, mine = active && isHuman(s) && st.phase === 'roll' && !busy, h = '';
    if (mine && L.canMega(st, s)) h += '<button class="mega-btn" data-mega="1" aria-label="Spin the Mega Wheel">' + ART.icon('mega', 12) + 'MEGA</button>';
    lk.powers[s].forEach(function (id) {
      var ok = mine && L.powerValid(st, s, id);
      h += '<button class="pw' + (ok ? ' ok' : '') + (lk.used === id ? ' used' : '') + '" data-pw="' + id + '" ' + (ok ? '' : 'disabled ') + 'aria-label="' + POWER_NAMES[id] + '" title="' + POWER_NAMES[id] + '">' + ART.icon(id, 13) + '</button>';
    });
    if (st.boost[s] === 'double' && st.turn === s) h += '<span class="pw-on">×2</span>';
    if (lk.forceSix && st.turn === s) h += '<span class="pw-on">6!</span>';
    return h;
  }
  function render() {
    if (!G) return;
    var st = G.st, over = st.phase === 'over';
    ensureSel();
    var cur = busy && G.actor != null ? G.actor : st.turn; // keep the mover highlighted while their move/wheel animates
    each(document.querySelectorAll('.pod'), function (el) {
      var s = +el.dataset.seat;
      if (!st.seats[s] || el.classList.contains('empty')) return;
      var home = st.pieces[s].filter(function (p) { return p === L.HOME; }).length, rank = st.ranking.indexOf(s), active = !over && cur === s;
      el.classList.toggle('active', active); el.classList.toggle('done', rank >= 0);
      el.querySelector('.pname').textContent = nameOf(s);
      var dots = ''; for (var k = 0; k < 4; k++) dots += '<i' + (k < home ? ' class="on"' : '') + '></i>';
      var lk = st.lk;
      if (rank >= 0) el.querySelector('.plvl').innerHTML = '<span class="prank">' + ['1st', '2nd', '3rd', '4th'][rank] + '</span>';
      else if (lk) el.querySelector('.plvl').innerHTML = luckyMeter(st, s);
      else el.querySelector('.plvl').innerHTML = '<span class="hd">' + dots + '</span>' + levelOf(s);
      var lkb = el.querySelector('.lkb'); if (lkb) lkb.innerHTML = lk && rank < 0 ? luckyBadges(st, s) : '';
      var chips = el.querySelector('.chips'), html = '', selDone = false;
      if (lk && rank < 0 && !(active && st.phase === 'move')) html = luckyPowers(st, s, active);
      if (active) st.queue.forEach(function (v) {
        var usable = st.phase === 'move' && chipMoves(v).length > 0, sel = usable && v === G.sel && !selDone;
        if (sel) selDone = true;
        html += '<button class="chip-v' + (usable ? '' : ' dim') + (sel ? ' sel' : '') + (v > 6 ? ' dbl' : '') + '" data-v="' + v + '">' + v + '</button>';
      });
      chips.innerHTML = html;
      var humanRoll = active && st.phase === 'roll' && isHuman(s) && !busy;
      var dz = el.querySelector('.pdice'); dz.disabled = !humanRoll; dz.classList.toggle('ready', humanRoll);
      var bt = el.querySelector('.boost-tag'), b = st.boost[s];
      bt.classList.toggle('hidden', !b); bt.innerHTML = b === 'double' ? '×2' : b === 'choose' ? '1-6' : '';
      var pieceMoves = !over && active && isHuman(s) && st.phase === 'move' && !busy ? (G.sel != null && chipMoves(G.sel).length ? chipMoves(G.sel) : st.moves) : [];
      each(pieceEls[s], function (pc, i) {
        var pos = st.pieces[s][i], place = pos < 0 ? 'in base' : pos === L.HOME ? 'home' : pos >= 52 ? 'in home lane' : 'on the track';
        var canMove = pieceMoves.some(function (m) { return m.seat === s && m.piece === i; });
        pc.disabled = !canMove;
        pc.classList.toggle('is-turn', canMove);
        pc.setAttribute('aria-label', nameOf(s) + ' token ' + (i + 1) + ', ' + place + (canMove ? ', select to move' : ''));
      });
    });
    var s = cur, lbl = $('turn-label');
    if (over) lbl.innerHTML = 'Match over';
    else lbl.innerHTML = '<span class="dot" style="background:' + seatColor(s) + '"></span>' + (isHuman(s) ? (nameOf(s) === 'You' ? 'Your turn' : NAMES[s] + "'s turn") : NAMES[s] + ' is playing') +
      (st.mode === 'mystery' ? '<span class="mode-tag">Mystery</span>' : st.mode === 'lucky' ? '<span class="mode-tag lucky">Lucky Chaos</span>' : '');
    var hint = '';
    if (!over && st.phase === 'choose') hint = isHuman(st.turn) ? 'Make your choice' : NAMES[st.turn] + ' is choosing…';
    else if (!over && isHuman(s) && !busy) {
      if (st.phase === 'roll') hint = L.mustChoose(st) ? 'Tap your die and pick a number' : st.queue.length ? 'Six! Roll again' : (st.bonus || st.sixes) ? 'Roll again' : 'Tap your die to roll or swipe it';
      else if (st.phase === 'move') hint = st.queue.length > 1 ? 'Pick a chip, then a token' : 'Pick a token';
    } else if (!over && !isHuman(s)) hint = NAMES[s] + ' is thinking…';
    $('hint').textContent = hint;
    var u = $('btn-undo'), showU = save.settings.undo && humans(st).length > 0 && !over;
    u.classList.toggle('hidden', !showU);
    var act = undoActive();
    u.disabled = !act; u.classList.toggle('live', act);
    $('undo-label').textContent = G.undoLeft > 0 ? 'Undo (' + G.undoLeft + ')' : 'Undo';
    $('undo-ad').classList.toggle('hidden', G.undoLeft > 0);
    updateTutorial();
  }
  function clearHighlights() { each(document.querySelectorAll('.pc.can'), function (e) { e.classList.remove('can'); }); }
  function highlight() {
    clearHighlights();
    var st = G.st; if (st.phase !== 'move' || !isHuman(st.turn) || busy) return;
    var ms = G.sel != null ? chipMoves(G.sel) : st.moves;
    ms.forEach(function (m) { var el = pieceEls[m.seat][m.piece]; if (el) el.classList.add('can'); });
  }
  function focusTurnControl() {
    if (!G || busy || paused || !isHuman(G.st.turn)) return;
    var target = null;
    if (G.st.phase === 'roll') { var pod = podEl(G.st.turn); target = pod && pod.querySelector('.pdice'); }
    else if (G.st.phase === 'move') target = document.querySelector('#pieces .pc.can');
    if (target && !target.disabled) target.focus();
  }
  function offerMoves() {
    var st = G.st; if (st.phase !== 'move' || !isHuman(st.turn)) return;
    render(); highlight();
    if (keyboardRoll) { var target = document.querySelector('#pieces .pc.can'); if (target) target.focus(); keyboardRoll = false; }
    var distinct = L.distinctMoves(st.moves);
    if (save.settings.auto && distinct.length === 1 && !undoActive()) { var m = distinct[0]; later(function () { doMove(m.piece, m.v); }, save.settings.fast ? 220 : 420); return; }
    startTimer();
  }

  // ---------------- turn timer (optional) ----------------
  function startTimer() {
    var st = G.st, s = st.turn, el = podEl(s);
    stopTimer();
    if (!save.settings.timer || !isHuman(s) || st.phase !== 'move' || !el) return;
    el.style.setProperty('--tdur', TIMER_MS + 'ms'); void el.offsetWidth; el.classList.add('timing');
    G.timerTk = later(function () {
      G.timerTk = null;
      if (!G || busy || G.st.turn !== s || G.st.phase !== 'move' || !isHuman(s)) return;
      toast('Time is up: playing for you', 1200);
      var c = L.chooseMove(G.st, 'medium'); if (c) doMove(c.piece, c.v);
    }, TIMER_MS);
  }
  function stopTimer() {
    each(document.querySelectorAll('.pod.timing'), function (e) { e.classList.remove('timing'); });
    if (G && G.timerTk) { clearTimeout(G.timerTk); var k = timers.indexOf(G.timerTk); if (k >= 0) timers.splice(k, 1); G.timerTk = null; }
  }

  function clearAutoRollVisual() {
    each(document.querySelectorAll('.pdice.counting'), function (die) { die.classList.remove('counting'); });
  }
  function stopAutoRollTimer(preserveRemaining) {
    if (autoRollTk) {
      if (preserveRemaining) autoRollRemaining = Math.max(0, autoRollDeadline - Date.now());
      clearTimeout(autoRollTk);
      var k = timers.indexOf(autoRollTk); if (k >= 0) timers.splice(k, 1);
      autoRollTk = null;
    }
    clearAutoRollVisual();
    if (!preserveRemaining) { autoRollKey = null; autoRollDeadline = 0; autoRollRemaining = null; }
  }
  function startAutoRollTimer() {
    var st = G && G.st;
    if (!st || st.phase !== 'roll' || !isHuman(st.turn) || busy || paused || tutorial.intro || !gameVisible() || isOpen('confirm')) {
      if (autoRollTk) stopAutoRollTimer(true);
      return;
    }
    var s = st.turn, key = s + ':' + st.rolls + ':' + st.turnCount;
    if (autoRollKey !== key) { stopAutoRollTimer(false); autoRollKey = key; autoRollRemaining = AUTO_ROLL_MS; }
    if (autoRollTk) return;
    if (autoRollRemaining == null) autoRollRemaining = AUTO_ROLL_MS;
    var duration = Math.max(0, autoRollRemaining), diePod = podEl(s), die = diePod && diePod.querySelector('.pdice');
    autoRollDeadline = Date.now() + duration;
    if (die) { die.style.setProperty('--roll-countdown-ms', duration + 'ms'); die.classList.remove('counting'); void die.offsetWidth; die.classList.add('counting'); }
    autoRollTk = later(function () {
      autoRollTk = null; autoRollKey = null; autoRollDeadline = 0; autoRollRemaining = null; clearAutoRollVisual();
      if (!G || busy || paused || !gameVisible() || isOpen('confirm') || G.st.turn !== s || G.st.phase !== 'roll' || !isHuman(s)) return;
      doRoll(L.mustChoose(G.st) ? L.chooseDieValue(G.st, s, G.st.seats[s].level) : undefined);
    }, duration);
  }

  function advance() {
    if (!G) return;
    var st = G.st;
    render(); persist();
    if (st.phase === 'over') { later(finishMatch, 800); return; }
    if (paused || tutorial.intro || !gameVisible() || busy) return;
    if (undoActive() && !isHuman(st.turn)) return; // waiting for the undo window after a human roll that passed the turn
    var s = st.turn, pl = st.seats[s];
    highlight();
    if (st.phase === 'choose') { busy = true; G.actor = st.pending.seat; resolveFlow(null, function () { busy = false; G.actor = null; layoutPieces(); render(); later(advance, 300); }); return; }
    if (pl.type === 'ai') {
      if (st.phase === 'roll') later(function () {
        var pre = st.lk ? L.aiPreRoll(G.st, pl.level) : null;
        if (pre && pre.type === 'mega') doMega(); else if (pre) doPower(pre.id); else doRoll();
      }, aiDelay());
      else later(aiMove, aiDelay() * 0.6);
    } else if (st.phase === 'move') offerMoves();
    else startAutoRollTimer();
  }
  function aiMove() { if (!G || busy || G.st.phase !== 'move') return; var c = L.chooseMove(G.st, G.st.seats[G.st.turn].level); if (c) doMove(c.piece, c.v); }

  // ---------------- dice ----------------
  var FACE = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  var spins = [0, 0, 0, 0];
  function cubeOf(s) { var p = podEl(s); return p ? p.querySelector('.cube') : null; }
  function setDiceFace(s, v, instant) {
    var f = FACE[Math.min(6, Math.max(1, v || 1))], cube = cubeOf(s); if (!cube) return;
    if (instant) cube.style.transitionDuration = '0ms';
    cube.style.transform = 'rotateX(' + (f[0] + 720 * spins[s]) + 'deg) rotateY(' + (f[1] + 360 * spins[s]) + 'deg)';
  }
  function prefersReducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function animateDice(s, v, cb) {
    var cube = cubeOf(s), reduced = prefersReducedMotion(), dur = reduced ? 0 : save.settings.fast ? 420 : 700;
    spins[s]++;
    if (cube) { cube.style.transitionDuration = dur + 'ms'; setDiceFace(s, v); var pd = cube.parentNode; pd.classList.remove('rolling'); if (!reduced) { void pd.offsetWidth; pd.classList.add('rolling'); } }
    SFX.roll();
    later(function () { SFX.land(v === 6); haptic('light'); cb(); }, dur);
  }

  function openPicker() {
    var row = $('picker-row'); row.innerHTML = '';
    for (var v = 1; v <= 6; v++) {
      var b = document.createElement('button'); b.className = 'pick'; b.textContent = v; b.dataset.v = v;
      b.addEventListener('click', function (e) { var val = +e.currentTarget.dataset.v; hide('picker'); SFX.click(); doRoll(val); });
      row.appendChild(b);
    }
    show('picker');
  }

  function doRoll(chosen) {
    if (!G || busy || G.st.phase !== 'roll' || paused) return;
    var st = G.st, s = st.turn, human = isHuman(s);
    stopAutoRollTimer(false);
    if (L.mustChoose(st) && chosen == null) {
      if (human) { stopTimer(); openPicker(); return; }
      chosen = L.chooseDieValue(st, s, st.seats[s].level);
    }
    busy = true; clearHighlights(); stopTimer();
    var snap = human && save.settings.undo ? L.clone(st) : null;
    G.undo = null;
    var r = L.roll(st, chosen != null ? chosen : forced.length ? forced.shift() : undefined);
    if (human && r.raw === 6) save.stats.sixes++;
    render(); persist();
    animateDice(s, r.raw, function () {
      busy = false;
      if (snap) { G.undo = { snap: snap, until: Date.now() + UNDO_MS, seat: s }; startUndoBar(); later(expireUndo, UNDO_MS + 30); }
      if (r.doubled) { var pc = podEl(s), pr = pc.getBoundingClientRect(), br = $('board-wrap').getBoundingClientRect(); floatAt(pr.left + pr.width / 2 - br.left, slotOf(s) < 2 ? 8 : BS - 8, '×2 → ' + r.value); }
      if (r.forfeit) {
        SFX.forfeit(); haptic('warn');
        toast(nameOf(s) === 'You' ? 'Three 6s in a row: turn lost' : NAMES[s] + ' rolled three 6s: turn lost');
        if (!human) aiReact('forfeit', s);
        render(); later(advance, 900); return;
      }
      if (r.next === 'roll') { if (human) toast('Six! Roll again', 900); render(); later(advance, human ? 0 : 250); return; }
      if (r.next === 'move') { if (human) offerMoves(); else advance(); return; }
      if (human) toast(r.next === 'pass' ? 'No move possible' : 'No move possible: roll again', 1000);
      render(); later(advance, human ? 750 : 450);
    });
  }

  // ---------------- undo dice roll ----------------
  function startUndoBar() { var b = $('undo-bar'); b.style.transition = 'none'; b.style.width = '100%'; void b.offsetWidth; b.style.transition = 'width ' + UNDO_MS + 'ms linear'; b.style.width = '0%'; render(); }
  function expireUndo() {
    if (!G || !G.undo || G.undo.hold) return;
    if (G.undo.until > Date.now()) { later(expireUndo, G.undo.until - Date.now() + 20); return; }
    G.undo = null; render(); if (!busy) advance();
  }
  function closeUndo() { if (G) G.undo = null; }
  function applyUndo() {
    var u = G.undo; if (!u) return;
    var rng = G.st.rng;
    cancelFlow(); paused = false;
    G.st = u.snap; G.st.rng = rng; // keep the random stream moving: the re-roll is a fresh roll
    G.undo = null; save.game = G;
    buildPods(); layoutPieces(true); SFX.undo(); haptic('light');
    toast(G.undoLeft > 0 ? 'Roll undone: roll again (' + G.undoLeft + ' free left)' : 'Roll undone: roll again', 1300);
    advance();
  }
  function undoRoll() {
    if (!G || !undoActive() || busy) return;
    SFX.click();
    if (G.undoLeft > 0) { G.undoLeft--; applyUndo(); return; }
    // no free undos left: an optional rewarded ad (player's tap) gives one more
    G.undo.hold = true; G.undo.until = Date.now() + 600000; paused = true;
    var rewarded = false;
    Ads.showRewarded(function () {
      rewarded = true; applyUndo();
    }, function () { toast('No ad available right now. Try again later.'); }).then(function () {
      if (!rewarded) { paused = false; if (G) G.undo = null; render(); advance(); }
    });
  }

  // ---------------- effects ----------------
  function fxEl(cls, x, y) { var e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px'; $('fx').appendChild(e); return e; }
  function burst(x, y, col, n) {
    for (var k = 0; k < n; k++) {
      var e = fxEl('burst', x, y), a = k / n * Math.PI * 2 + Math.random() * 0.4, d = CELL * (1 + Math.random() * 1.2);
      e.style.background = col; e.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px'); e.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      setTimeout(function (el) { el.remove(); }.bind(null, e), 700);
    }
  }
  function ring(x, y, col) { var e = fxEl('ring', x, y); e.style.setProperty('--rc', col); setTimeout(function () { e.remove(); }, 600); }
  function floatAt(x, y, txt) { var e = document.createElement('div'); e.className = 'float'; e.style.left = x + 'px'; e.style.top = y + 'px'; e.textContent = txt; $('fx').appendChild(e); setTimeout(function () { e.remove(); }, 1000); }
  function bolt(x, y) { var e = fxEl('bolt', x, y); e.innerHTML = ART.icon('zap', 40); setTimeout(function () { e.remove(); }, 700); }
  function iconPop(x, y, id, cls) { var e = fxEl('iconpop ' + (cls || ''), x, y); e.innerHTML = ART.icon(id, 30); setTimeout(function () { e.remove(); }, 900); }
  function shake() { var w = $('board-wrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }

  function animatePath(s, i, from, path, cb) {
    var id = s + '-' + i, el = pieceEls[s][i];
    if (!el || !path || !path.length) { cb(); return; }
    var run = runToken, origin = piecePos[id] || center(L.cellOf(s, from, i));
    var points = path.map(function (p) { return center(L.cellOf(s, p, i)); });
    var entry = {}, settled = false;
    moving[id] = true;
    activeMotions[id] = entry;
    function release(clearEffects) {
      if (settled) return;
      settled = true;
      delete moving[id];
      if (activeMotions[id] === entry) delete activeMotions[id];
      if (el) { el.classList.remove('hop'); if (clearEffects) el.classList.remove('land'); }
    }
    function complete() {
      if (settled) return;
      release();
      if (run === runToken) cb();
    }
    function interrupted() { release(true); }
    try {
      entry.cancel = PathAnimation.animate({
        el: el, start: origin, points: points, duration: stepMs(), arcHeight: CELL * 0.27,
        reducedMotion: prefersReducedMotion(),
        onStep: function (k) {
          piecePos[id] = points[k];
          if (!prefersReducedMotion()) { el.classList.remove('land'); void el.offsetWidth; el.classList.add('land'); }
          if (from < 0 && k === 0) SFX.leave(); else SFX.step(k);
          if (SFX.crystal) SFX.crystal(k);
        },
        onComplete: complete,
        onCancel: interrupted,
        onError: function (error) { piecePos[id] = points[points.length - 1]; if (window.console && console.warn) console.warn('Token movement animation failed; completing at its legal destination.', error); }
      });
    } catch (error) {
      if (window.console && console.warn) console.warn('Token movement animation failed; completing at its legal destination.', error);
      piecePos[id] = points[points.length - 1];
      place(el, piecePos[id].x, piecePos[id].y, 1);
      complete();
    }
  }
  function sendToBase(seat, piece) {
    var el = pieceEls[seat][piece]; if (!el) return;
    el.style.transition = 'transform .5s cubic-bezier(.3,.7,.3,1), opacity .25s'; placeToken(seat, piece, -1);
    setTimeout(function () { el.style.transition = ''; }, 600);
  }
  function captureFx(s, caps, at) {
    caps.forEach(function (cp) { burst(at.x, at.y, seatColor(cp.seat), 14); sendToBase(cp.seat, cp.piece); });
    ring(at.x, at.y, seatColor(s)); floatAt(at.x, at.y - CELL * 0.6, 'Captured!'); shake();
    SFX.capture(); haptic('heavy');
  }

  function doMove(piece, v, keyboard) {
    if (!G || busy || G.st.phase !== 'move' || paused) return;
    var st = G.st, s = st.turn, human = isHuman(s);
    if (!st.moves.some(function (m) { return m.piece === piece && (v == null || m.v === v); })) return;
    busy = true; G.actor = s; clearHighlights(); closeUndo(); stopTimer(); stopAutoRollTimer(false); hide('chat');
    var res = L.move(st, piece, v, forcedEvents.length ? forcedEvents.shift() : undefined);
    if (human) { save.stats.captures += res.captures.length; if (res.finish) save.stats.home++; if (res.event) save.stats.events++; }
    G.sel = null;
    render(); persist();
    animatePath(s, piece, res.from, res.path, function () {
      var c = piecePos[s + '-' + piece] || { x: 0, y: 0 }, pause = 260;
      if (res.captures.length) {
        pause = 750; captureFx(s, res.captures, c);
        if (res.captures.some(function (cp) { return isHuman(cp.seat); }) && !human) setTimeout(function () { SFX.captured(); }, 250);
        aiReact('capture', s, res.captures);
      }
      if (res.finish) { pause = Math.max(pause, 520); ring(7.5 * CELL, 7.5 * CELL, seatColor(s)); floatAt(7.5 * CELL, 6.8 * CELL, res.finishedPlayer ? NAMES[s] + ' finished!' : 'Home!'); SFX.home(); haptic('success'); if (!human) aiReact('home', s); }
      if (res.stride) floatAt(c.x, c.y + CELL * 0.7, 'King +1');
      if (res.kingCaptured) { pause = Math.max(pause, 900); toast(nameOf(s) + ' toppled a King! Mega Wheel charged (5/5)', 1600); later(function () { SFX.mega(); }, 300); }
      if (res.crowned) { pause = Math.max(pause, 900); later(function () { crownFx(res.crowned); }, res.captures.length ? 420 : 0); }
      var done = function () {
        if (human && tutorial.active && !tutorial.intro) tutorial.firstMove = true;
        layoutPieces(); busy = false; G.actor = null;
        if (human && !res.over && st.turn === s && st.phase === 'roll') toast(st.boost[s] === 'choose' ? 'Pick a number for your next roll' : 'Bonus roll!', 1000);
        render();
        if (keyboard) { highlight(); focusTurnControl(); }
        later(advance, pause);
      };
      if (res.event && res.event.lucky) later(function () { showWheel(res.event, function () { resolveFlow(res.event, done); }); }, res.captures.length || res.crowned ? 700 : 150);
      else if (res.event) later(function () { showWheel(res.event, function () { animateEvent(res.event, done); }); }, res.captures.length ? 500 : 150);
      else done();
    });
  }

  // ---------------- Mystery Tiles: wheel & events ----------------
  var WHEEL_SHORT = { shield: 'Shield', jump3: '+3', extra: 'Extra', double: '×2', choose: 'Pick', freeze: 'Freeze', back3: 'Back 3', swap: 'Swap', zap: 'Zap', frozen: 'Frozen', jump6: '+6', calm: 'Calm',
    dbl: 'Double', six: 'Lucky 6', escape: 'Escape', bomb: 'Bomb', swapc: 'Swap', zapc: 'Zap', wild: 'Wild', rocket: 'Rocket', free: 'Free', guard: 'Guard', turn2: '+2 Rolls', storm: 'Storm', crown: 'Crown' };
  var DANGER_SHORT = { jump3: '+5', extra: '+2 Rolls', bomb: 'Big Bomb', back3: 'Back 5' };
  var WHEEL_COL = { boost: ['#2a86e0', '#18b3b8'], chaos: ['#8e3fe0', '#e0407a'], mega: ['#e0a21c', '#c2571a'] };
  function wheelSVG(kind, list, danger) {
    list = list || L.WHEELS[kind];
    var n = list.length, out = '', cols = WHEEL_COL[kind];
    for (var i = 0; i < n; i++) {
      var a0 = (i - 0.5) / n * Math.PI * 2 - Math.PI / 2, a1 = (i + 0.5) / n * Math.PI * 2 - Math.PI / 2, R = 96;
      out += '<path d="M0 0 L' + (Math.cos(a0) * R).toFixed(2) + ' ' + (Math.sin(a0) * R).toFixed(2) + ' A' + R + ' ' + R + ' 0 0 1 ' + (Math.cos(a1) * R).toFixed(2) + ' ' + (Math.sin(a1) * R).toFixed(2) + 'Z" fill="' + cols[i % 2] + '" stroke="rgba(0,0,0,.25)" stroke-width="1"/>';
      var info = L.EVENT_INFO[list[i]];
      out += '<g transform="rotate(' + (i / n * 360) + ') translate(0 -60)" color="#fff"><g transform="translate(-13 -18)">' + ART.icon(list[i], 26) + '</g>' +
        '<text y="22" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" font-family="Inter, system-ui, sans-serif">' + ((danger && DANGER_SHORT[list[i]]) || WHEEL_SHORT[list[i]] || info.name) + '</text></g>';
    }
    out += '<circle r="96" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="3"/>';
    out += '<circle r="19" fill="#12151b" stroke="#fff" stroke-width="3"/><text y="7.5" text-anchor="middle" font-size="21" font-weight="900" fill="#fff" font-family="Inter, system-ui, sans-serif">' + (kind === 'boost' ? '?' : kind === 'mega' ? 'M' : '!') + '</text>';
    return out;
  }
  function showWheel(ev, cb) {
    var w = $('wheel'), svg = $('wheel-svg'), fast = save.settings.fast, dur = fast ? 1100 : 1800;
    var n = ev.wheel ? ev.wheel.length : 6, wname = ev.kind === 'boost' ? 'Boost wheel' : ev.kind === 'mega' ? 'MEGA WHEEL' : 'Chaos wheel';
    $('wheel-title').innerHTML = (ev.danger ? '<span class="danger-tag">' + ART.icon('danger', 14) + 'DANGER · High Risk / High Reward</span>' : '') + wname + ' · ' + NAMES[ev.seat];
    w.className = 'wheel ' + ev.kind + (ev.danger ? ' danger' : '');
    var res = $('wheel-result'); res.innerHTML = '&nbsp;'; res.className = 'wheel-result';
    var note = $('wheel-note'); note.innerHTML = ev.revenge ? ART.icon('revenge', 14) + ' Revenge Charge: two results, you pick one!' : ev.nudged ? ART.icon('flame', 14) + ' Lucky Streak nudge: better result!' : ev.lucky && !ev.mega && ev.streak ? ART.icon('flame', 14) + ' Lucky Streak ×' + ev.streak : '';
    svg.innerHTML = wheelSVG(ev.kind, ev.wheel, ev.danger);
    svg.style.transition = 'none'; svg.style.transform = 'rotate(0deg)'; void svg.getBoundingClientRect();
    if (ev.mega) SFX.mega(); else if (ev.danger) SFX.danger(); else if (ev.revenge) SFX.revenge();
    var target = -(ev.index * 360 / n) - 360 * (fast ? 3 : 5) + (Math.random() * 24 - 12);
    later(function () { svg.style.transition = 'transform ' + dur + 'ms cubic-bezier(.12,.72,.2,1)'; svg.style.transform = 'rotate(' + target + 'deg)'; }, 30);
    var ticks = 0, tk = setInterval(function () { SFX.spinTick(ticks++); if (ticks > (fast ? 10 : 16)) clearInterval(tk); }, dur / 22);
    later(function () {
      clearInterval(tk);
      var info = ev.lucky ? L.eventLabel(ev.event, ev.danger) : L.EVENT_INFO[ev.event];
      if (ev.choice && ev.choice.type === 'revenge') { var o2 = L.eventLabel(ev.choice.options[1], ev.danger); res.innerHTML = '<b>' + info.name + ' or ' + o2.name + '?</b><span>Revenge Charge: choose one of the two results.</span>'; }
      else res.innerHTML = '<b>' + info.name + '</b><span>' + info.text + '</span>';
      res.className = 'wheel-result on ' + (info.good === true ? 'good' : info.good === false ? 'bad' : 'meh');
      if (info.good === false) { SFX.bad(); haptic('warn'); } else { SFX.good(); haptic('medium'); }
      later(function () { hide('wheel'); cb(); }, fast ? 900 : 1500);
    }, dur + 90);
    show('wheel');
  }
  function animateEvent(ev, cb) {
    var s = ev.seat, i = ev.piece, at = piecePos[s + '-' + i] || { x: 0, y: 0 }, t = ev.target;
    switch (ev.event) {
      case 'jump3': case 'jump6': case 'back3':
        animatePath(s, i, ev.from, ev.path, function () {
          var c = piecePos[s + '-' + i];
          if (ev.captures && ev.captures.length) captureFx(s, ev.captures, c);
          if (ev.finish) { ring(7.5 * CELL, 7.5 * CELL, seatColor(s)); SFX.home(); }
          later(cb, ev.captures && ev.captures.length ? 650 : 250);
        }); return;
      case 'swap':
        [[s, i, ev.to], [t.seat, t.piece, t.to]].forEach(function (x) { var el = pieceEls[x[0]][x[1]]; if (!el) return; el.style.transition = 'transform .45s cubic-bezier(.3,.7,.3,1)'; placeToken(x[0], x[1], x[2]); setTimeout(function () { el.style.transition = ''; }, 500); });
        SFX.leave(); later(cb, 520); return;
      case 'zap':
        var tp = piecePos[t.seat + '-' + t.piece] || at; bolt(tp.x, tp.y); SFX.zap(); shake(); haptic('heavy');
        later(function () { burst(tp.x, tp.y, seatColor(t.seat), 12); sendToBase(t.seat, t.piece); aiReact('capture', s, [t]); later(cb, 550); }, 280);
        return;
      case 'freeze': var fp = piecePos[t.seat + '-' + t.piece] || at; iconPop(fp.x, fp.y, 'freeze', 'ice'); SFX.freeze(); layoutPieces(); later(cb, 600); return;
      case 'frozen': iconPop(at.x, at.y, 'frozen', 'bad'); SFX.freeze(); layoutPieces(); later(cb, 600); return;
      case 'shield': iconPop(at.x, at.y, 'shield', 'good'); ring(at.x, at.y, '#6fd3ff'); layoutPieces(); later(cb, 550); return;
      case 'extra': case 'double': case 'choose': iconPop(at.x, at.y, ev.event, 'good'); render(); later(cb, 550); return;
      default: later(cb, 200);
    }
  }

  // ---------------- Lucky Chaos: decision window, effect animations, Mega Wheel, powers ----------------
  var CHOICE_MS = 3000;
  function choiceOptions(pd) {
    var st = G.st, dg = pd.ctx && pd.ctx.danger;
    if (pd.type === 'revenge') return pd.options.map(function (e) { var l = L.eventLabel(e, dg); return { icon: e, name: l.name, text: l.text }; });
    if (pd.type === 'swap') {
      var t = L.luckyTarget(st, 'swapc', pd.seat, pd.ctx.piece);
      return [{ icon: 'swapc', name: 'Swap', text: t ? 'Trade places with ' + NAMES[t.seat] + "'s token ahead" : 'Trade places' }, { icon: 'shield', name: 'Stay', text: 'Keep your token where it is' }];
    }
    return [{ icon: 'wild', name: 'Jump ' + pd.n, text: 'Move this token ' + pd.n + ' squares forward' }, { icon: 'shield', name: 'Stay', text: 'Stay on this square' }];
  }
  /** Shows the 3-second decision window. Humans tap (or the best option is auto-picked); computer players decide instantly. */
  function openChoice(cb) {
    var st = G.st, pd = st.pending, seat = pd.seat, human = isHuman(seat), opts = choiceOptions(pd), best = L.defaultChoice(st), tk = runToken;
    var title = pd.type === 'revenge' ? 'Revenge Charge: pick your result' : pd.type === 'swap' ? 'Chaos: Swap?' : 'Wild Jump: rolled ' + pd.n;
    $('choice-title').textContent = title + ' · ' + NAMES[seat];
    var row = $('choice-row'); row.innerHTML = '';
    var done = false;
    function pick(i, how) {
      if (done || tk !== runToken) return; done = true;
      clearTimeout(timer); hide('choice');
      if (how === 'auto') toast('Auto-picked: ' + opts[i].name, 1100); else if (how === 'ai') toast(NAMES[seat] + ' chose ' + opts[i].name, 1000);
      SFX.click(); cb(i);
    }
    opts.forEach(function (o, i) {
      var b = document.createElement('button'); b.className = 'copt' + (i === best ? ' best' : ''); b.dataset.i = i;
      b.innerHTML = '<span class="ci">' + ART.icon(o.icon, 26) + '</span><b>' + o.name + '</b><small>' + o.text + '</small>' + (i === best ? '<em>best</em>' : '');
      b.disabled = !human;
      b.addEventListener('click', function () { pick(i, 'tap'); });
      row.appendChild(b);
    });
    var bar = $('choice-bar'); bar.style.transition = 'none'; bar.style.width = '100%';
    show('choice'); void bar.offsetWidth;
    var timer;
    if (!human) { var ai = L.aiChoose(st, st.seats[seat].level); timer = setTimeout(function () { pick(ai, 'ai'); }, save.settings.fast ? 350 : 700); return; }
    bar.style.transition = 'width ' + CHOICE_MS + 'ms linear'; bar.style.width = '0%';
    timer = setTimeout(function () { pick(best, 'auto'); }, CHOICE_MS + 60);
  }
  /** Resolve any pending choice (possibly nested: Revenge → Swap/Wild), then animate the final effect. */
  function resolveFlow(ev, cb) {
    var st = G.st;
    if (st.phase === 'choose' && st.pending) {
      render();
      openChoice(function (i) { var r = L.choose(G.st, i); persist(); resolveFlow(r.event, cb); });
      return;
    }
    animateLucky(ev, cb);
  }
  function slideTo(seat, piece, pos) {
    var el = pieceEls[seat][piece]; if (!el) return;
    el.style.transition = 'transform .45s cubic-bezier(.3,.7,.3,1)'; placeToken(seat, piece, pos);
    setTimeout(function () { el.style.transition = ''; }, 520);
  }
  function crownFx(c) {
    var p = piecePos[c.seat + '-' + c.piece] || { x: 7.5 * CELL, y: 7.5 * CELL };
    layoutPieces(); iconPop(p.x, p.y, 'crown', 'gold'); ring(p.x, p.y, '#ffd24a'); floatAt(p.x, p.y - CELL * 0.8, 'KING!');
    SFX.crown(); haptic('success');
    toast((nameOf(c.seat) === 'You' ? 'Your token' : NAMES[c.seat] + "'s token") + ' is King for ' + L.KING_TURNS + ' turns: +1 stride, Chaos-proof', 1700);
  }
  function animateLucky(ev, cb) {
    if (!ev || !ev.event) { layoutPieces(); render(); later(cb, 60); return; }
    var s = ev.seat, id = ev.event, lab = L.eventLabel(id, ev.danger);
    var pp = ev.piece != null ? piecePos[s + '-' + ev.piece] : null, at = pp || { x: 7.5 * CELL, y: 7.5 * CELL };
    var tp = ev.target ? piecePos[ev.target.seat + '-' + ev.target.piece] : null;
    var human = isHuman(s);
    if (human && ev.stored) toast(lab.name + ' stored: tap it next to your die before a roll', 1500);
    floatAt(at.x, at.y - CELL * 0.8, lab.name);
    switch (id) {
      case 'bomb': iconPop(at.x, at.y, 'bomb', 'bad'); ring(at.x, at.y, '#ff8a3d'); burst(at.x, at.y, '#ffb03d', 18); SFX.bomb(); shake(); haptic('heavy'); break;
      case 'storm': iconPop(at.x, at.y, 'storm', 'gold'); shake(); SFX.zap(); haptic('heavy'); break;
      case 'zapc': if (tp) bolt(tp.x, tp.y); SFX.zap(); shake(); haptic('heavy'); break;
      case 'freeze': var fp = tp || at; iconPop(fp.x, fp.y, 'freeze', 'ice'); SFX.freeze(); break;
      case 'shield': iconPop(at.x, at.y, 'shield', 'good'); ring(at.x, at.y, '#6fd3ff'); SFX.good(); break;
      case 'guard': ev.moves.forEach(function (m) { var q = piecePos[m.seat + '-' + m.piece]; if (q) ring(q.x, q.y, '#6fd3ff'); }); iconPop(at.x, at.y, 'guard', 'good'); SFX.good(); break;
      case 'back3': iconPop(at.x, at.y, 'back3', 'bad'); SFX.bad(); haptic('warn'); break;
      case 'crown': break;
      default: iconPop(at.x, at.y, id, lab.good === false ? 'bad' : ev.mega ? 'gold' : 'good'); SFX.pop();
    }
    var fwd = ev.moves.filter(function (m) { return m.path && !m.back && !m.swap && !m.shield; });
    var rest = ev.moves.filter(function (m) { return (m.back || m.swap) && !m.shield; });
    var k = 0, last = null;
    later(function nextFwd() {
      if (k < fwd.length) { var m = fwd[k++]; last = m; animatePath(m.seat, m.piece, m.from, m.path, nextFwd); return; }
      var pause = 450;
      rest.forEach(function (m) { slideTo(m.seat, m.piece, m.to); });
      if (rest.length) { pause = 650; if (id === 'swapc') SFX.leave(); }
      ev.sent.forEach(function (x) { var q = piecePos[x.seat + '-' + x.piece] || at; burst(q.x, q.y, seatColor(x.seat), 12); sendToBase(x.seat, x.piece); pause = 750; aiReact('capture', s, [x]); });
      if (ev.captures.length) { var c = last ? piecePos[last.seat + '-' + last.piece] : at; captureFx(s, ev.captures, c || at); pause = 800; aiReact('capture', s, ev.captures); }
      if (ev.crowned) { later(function () { crownFx(ev.crowned); }, ev.captures.length ? 400 : 0); pause = Math.max(pause, 950); }
      if (ev.finish) { ring(7.5 * CELL, 7.5 * CELL, seatColor(s)); SFX.home(); pause = Math.max(pause, 600); }
      later(function () { layoutPieces(); render(); cb(); }, pause);
    }, 380);
  }
  function doMega(forcedEv) {
    if (!G || busy || paused) return;
    var st = G.st, s = st.turn;
    if (!L.canMega(st, s)) return;
    busy = true; G.actor = s; closeUndo(); stopTimer(); clearHighlights(); hide('chat');
    var r = L.mega(st, forcedEv || (forcedMega.length ? forcedMega.shift() : undefined));
    if (isHuman(s)) save.stats.events++;
    render(); persist();
    showWheel(r, function () {
      animateLucky(r, function () { busy = false; G.actor = null; render(); later(advance, 250); });
    });
  }
  function doPower(id) {
    if (!G || busy || paused) return;
    var st = G.st, s = st.turn;
    if (!L.powerValid(st, s, id)) return;
    busy = true; G.actor = s; closeUndo(); stopTimer();
    var out = L.usePower(st, id), lab = L.eventLabel(id), pc = podEl(s), br = $('board-wrap').getBoundingClientRect();
    var pr = pc ? pc.getBoundingClientRect() : br, px = pr.left + pr.width / 2 - br.left, py = slotOf(s) < 2 ? 10 : BS - 10;
    iconPop(Math.max(20, Math.min(BS - 20, px)), py, id, 'good'); SFX.good(); haptic('medium');
    toast((nameOf(s) === 'You' ? 'You used ' : NAMES[s] + ' used ') + lab.name + (id === 'dbl' ? ': next roll counts double' : id === 'six' ? ': the next roll is a 6' : ''), 1300);
    render(); persist();
    var fin = function () { busy = false; G.actor = null; render(); later(advance, isHuman(s) ? 0 : 300); };
    if (id === 'escape') { var m = out.moves[0]; animatePath(s, m.piece, m.from, m.path, function () { var c = piecePos[s + '-' + m.piece]; iconPop(c.x, c.y, 'escape', 'good'); if (out.captures.length) captureFx(s, out.captures, c); later(fin, 450); }); }
    else later(fin, 500);
  }

  // ---------------- quick chat & emotes (cosmetic, offline) ----------------
  var lastChat = [0, 0, 0, 0];
  function bubble(seat, html, isEmote) {
    var p = podEl(seat); if (!p) return;
    var b = p.querySelector('.bubble'); if (!b) return;
    b.innerHTML = html; b.className = 'bubble on' + (isEmote ? ' emo' : '');
    clearTimeout(b._t); b._t = setTimeout(function () { b.className = 'bubble hidden'; }, 2600);
    SFX.pop();
  }
  function say(seat, item) { if (!item) return; if (item.charAt(0) === ':') bubble(seat, ART.emote(item.slice(1), 38), true); else bubble(seat, item.replace(/</g, '&lt;')); }
  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
  /** Computer players react now and then (rate-limited; can be switched off in Settings). */
  function aiReact(kind, s, caps) {
    if (!G || !save.settings.chat) return;
    var now = Date.now(), st = G.st;
    function speak(seat, list, chance) {
      if (!st.seats[seat] || st.seats[seat].type !== 'ai' || now - lastChat[seat] < 6000 || Math.random() > chance) return;
      lastChat[seat] = now; setTimeout(function () { if (G) say(seat, pickOne(list)); }, 350);
    }
    if (kind === 'capture') {
      speak(s, ['Gotcha!', ':laugh', ':cool', 'Sorry!', ':smile'], 0.55);
      (caps || []).forEach(function (c) { speak(c.seat, [':angry', ':sad', 'Not again…', 'Oops!', ':wow'], 0.5); });
    } else if (kind === 'home') speak(s, ["Let's go!", ':cool', ':love'], 0.3);
    else if (kind === 'forfeit') speak(s, [':sad', 'Oops!', ':think'], 0.5);
    else if (kind === 'win') speak(s, ['Well played!', ':cool', ':smile'], 0.9);
    else if (kind === 'reply') {
      var ais = st.players.filter(function (x) { return st.seats[x].type === 'ai'; }); if (!ais.length) return;
      var map = { 'Good luck!': ['Good luck!', ':smile'], 'Nice move!': [':cool', 'Thanks!'], 'Oops!': [':laugh', ':think'], 'So close!': [':wow', 'So close!'], 'Well played!': ['Well played!', ':smile'], "Let's go!": [':cool', "Let's go!"], 'Not again…': [':laugh', ':sad'], 'Your turn!': [':think', 'Hmm…'] };
      speak(pickOne(ais), map[caps] || [':smile', ':wow', ':laugh', ':love'], 0.6);
    }
  }
  function chatSender() { var st = G.st; if (isHuman(st.turn)) return st.turn; var h = humans(st); return h.length ? h[0] : -1; }
  function buildChat() {
    $('chat-phrases').innerHTML = PHRASES.map(function (p) { return '<button data-say="' + p + '">' + p + '</button>'; }).join('');
    $('chat-emotes').innerHTML = Object.keys(ART.EMOTES).map(function (k) { return '<button data-say=":' + k + '" aria-label="' + ART.EMOTES[k].label + '">' + ART.emote(k, 34) + '</button>'; }).join('');
    each(document.querySelectorAll('#chat [data-say]'), function (b) {
      b.addEventListener('click', function () {
        if (!G) return; var s = chatSender(); if (s < 0) return;
        hide('chat'); say(s, b.dataset.say);
        setTimeout(function () { aiReact('reply', s, b.dataset.say); }, 900);
      });
    });
  }

  // ---------------- match lifecycle ----------------
  function startMatch(seats, mode, offerTutorial) {
    cancelFlow();
    tutorial.active = offerTutorial === true && mode === 'classic' && !tutorialSeen();
    tutorial.intro = tutorial.active; tutorial.firstMove = false;
    var st = L.newGame(seats, save.rules, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, mode);
    G = { st: st, seats: seats, mode: st.mode, view: viewOf(st), undoLeft: FREE_UNDOS, undo: null, sel: null, coins: 0, xp: 0, doubled: false, counted: false, started: Date.now() };
    save.game = G; persist();
    spins = [0, 0, 0, 0];
    showGame();
    if (tutorial.intro) $('tutorial-start').focus(); else focusTurnControl();
  }
  function finishMatch() {
    if (!G || G.st.phase !== 'over') return;
    var st = G.st;
    if (!G.counted) {
      G.counted = true;
      var hs = humans(st), best = 99;
      hs.forEach(function (s) { best = Math.min(best, st.ranking.indexOf(s) + 1); });
      var ai = st.players.filter(function (s) { return st.seats[s].type === 'ai'; }).map(function (s) { return st.seats[s].level; });
      G.place = best; G.coins = L.coinsFor(best, st.players.length, ai, st.mode); G.xp = L.xpFor(best, st.players.length);
      save.coins += G.coins; save.xp += G.xp;
      var S = save.stats; S.played++;
      if (best === 1) { S.won++; S.streak = safeCounter(S.streak, 0) + 1; } else S.streak = 0;
      if (ai.length) { var top = ai.indexOf('hard') >= 0 ? 'hard' : ai.indexOf('medium') >= 0 ? 'medium' : 'easy'; S.vs[top][0]++; if (best === 1) S.vs[top][1]++; } else S.pass++;
      if (st.mode === 'mystery') { S.mystery[0]++; if (best === 1) S.mystery[1]++; }
      if (st.mode === 'lucky') { S.lucky[0]++; if (best === 1) S.lucky[1]++; }
      if (st.players.length === 2) { S.duel[0]++; if (best === 1) S.duel[1]++; } else if (st.players.length === 4) { S.four[0]++; if (best === 1) S.four[1]++; }
      var previousBoards = save.owned.boards.slice(), previousDice = save.owned.dice.slice();
      var newlyUnlocked = window.SkinShop.collectEligible(save, SK);
      gate.matchCompleted();
      if (!persist()) {
        save.owned.boards = previousBoards; save.owned.dice = previousDice;
      } else if (newlyUnlocked.length) {
        toast('Achievement unlocked: ' + newlyUnlocked.map(function (x) { return x.name; }).join(', '), 3000);
      }
      if (!isHuman(st.ranking[0])) aiReact('win', st.ranking[0]);
      if (gate.canShow(Date.now())) Ads.prepareInterstitial();
    }
    showResult();
  }
  function spotlightWinner(seat) {
    var layer = $('winner-confetti');
    if (!layer) return;
    layer.textContent = '';
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = [seatColor(seat), seatColor(seat), '#f4b740', '#ffffff'];
    for (var i = 0; i < 28; i++) {
      var piece = document.createElement('i');
      var spread = 44 + (i * 37 % 150);
      piece.className = 'confetti-piece';
      piece.style.setProperty('--confetti-color', colors[i % colors.length]);
      piece.style.setProperty('--confetti-x', (i % 2 ? spread : -spread) + 'px');
      piece.style.setProperty('--confetti-y', (62 + i * 29 % 152) + 'px');
      piece.style.setProperty('--confetti-spin', ((i * 71 % 720) - 360) + 'deg');
      piece.style.setProperty('--confetti-delay', (i % 4 * 24) + 'ms');
      layer.appendChild(piece);
    }
  }
  function showResult() {
    var st = G.st, hs = humans(st), single = hs.length === 1, winner = st.ranking[0];
    var entering = !isOpen('result');
    $('r-title').textContent = single ? (G.place === 1 ? 'You win!' : ['', '', '2nd place', '3rd place', '4th place'][G.place] || 'Match over') : NAMES[winner] + ' wins!';
    $('r-kicker').textContent = (st.mode === 'mystery' ? 'MYSTERY TILES · ' : st.mode === 'lucky' ? 'LUCKY CHAOS LUDO · ' : '') + (hasAI(st) ? 'VS COMPUTER' : 'PASS & PLAY');
    $('r-rank').innerHTML = st.ranking.map(function (s, k) {
      return '<li class="' + (isHuman(s) ? 'me ' : '') + (k === 0 ? 'winner' : '') + '" style="--winner-color:' + seatColor(s) + '"><span class="medal m' + (k + 1) + '">' + (k + 1) + '</span><span class="pdot" style="background:' + seatColor(s) + '"></span>' + nameOf(s) +
        '<small>' + levelOf(s) + (st.seats[s].type === 'ai' ? ' AI' : '') + ' · ' + st.pieces[s].filter(function (p) { return p === L.HOME; }).length + '/4 home</small></li>';
    }).join('');
    $('r-coins').textContent = '+' + (G.coins * (G.doubled ? 2 : 1));
    $('r-xp').textContent = '+' + G.xp;
    var lv = L.levelFromXp(save.xp); $('r-lvl').textContent = 'Level ' + lv.level; $('r-lvl-fill').style.width = Math.round(lv.into / lv.need * 100) + '%';
    $('btn-r-double').classList.toggle('hidden', !G.coins || G.doubled);
    if (entering) { if (G.place === 1 || !single) SFX.win(); else SFX.lose(); haptic(G.place === 1 ? 'success' : 'light'); }
    render(); setCoins(); setLevel(); show('result');
    if (entering) spotlightWinner(winner);
  }
  /** The ONLY place an interstitial may appear: leaving the result screen after a finished match. */
  function leaveResult(dest) {
    if (!G || G.st.phase !== 'over') return;
    hide('result');
    var seats = G.seats, mode = G.mode;
    G = null; save.game = null; persist();
    Ads.maybeInterstitial(gate).then(function () {
      persist();
      if (dest === 'again') startMatch(seats, mode); else showHome();
    });
  }
  function doubleCoins() {
    if (!G || G.doubled || !G.coins || G.st.phase !== 'over') return;
    SFX.click();
    Ads.showRewarded(function () {
      save.coins += G.coins; G.doubled = true; persist(); SFX.coin(); showResult(); toast('Coins doubled');
    }, function () { toast('No ad available right now. Try again later.'); });
  }

  // ---------------- screens ----------------
  function screen(id) { ['home', 'setup', 'game'].forEach(function (k) { $(k).classList.toggle('hidden', k !== id); }); }
  function showHome() {
    cancelFlow(); stopTimer(); paused = false;
    ['result', 'menu', 'chat'].forEach(hide);
    $('tutorial-intro').classList.add('hidden'); $('tutorial-coach').classList.add('hidden');
    screen('home'); updateHome(); setCoins(); setLevel();
  }
  function updateHome() {
    var cont = G && G.st.phase !== 'over';
    $('btn-continue').classList.toggle('hidden', !cont);
    if (cont) { var st = G.st; $('continue-sub').textContent = (st.mode === 'mystery' ? 'Mystery Tiles · ' : st.mode === 'lucky' ? 'Lucky Chaos Ludo · ' : '') + (hasAI(st) ? 'vs Computer' : 'Pass & Play') + ' · ' + st.players.length + ' players'; }
  }
  var setupKind = 'ai', setupMode = 'classic';
  function showSetup(kind, mode) {
    setupKind = kind; setupMode = mode || save.setup.mode[kind] || 'classic'; screen('setup');
    $('setup-title').textContent = kind === 'ai' ? (setupMode === 'mystery' ? 'Mystery Tiles' : setupMode === 'lucky' ? 'Lucky Chaos Ludo' : 'Play vs Computer') : 'Pass & Play';
    renderSetup();
  }
  function rulesSummary() {
    var r = save.rules, out = [r.rollStyle === 'star' ? 'Star style: 6s stack' : 'Classic: move each 6 first'];
    out.push(r.safeSquares ? 'safe squares' : 'no safe squares');
    if (r.captureToEnter) out.push('capture to enter home');
    if (r.blocks) out.push('blocks');
    if (!r.bonusOnCapture) out.push('no capture bonus');
    if (!r.bonusOnHome) out.push('no home bonus');
    return out;
  }
  function renderSetup() {
    var seats = save.setup[setupKind], list = $('seat-list'); list.innerHTML = '';
    each($('mode-seg').children, function (b) { var selected = b.dataset.mode === setupMode; b.classList.toggle('on', selected); b.setAttribute('aria-pressed', selected ? 'true' : 'false'); });
    $('mode-note').textContent = setupMode === 'mystery' ? 'Mystery Tiles: ? and ! tiles on the track spin a wheel of events (shield, jump, swap, zap, freeze…). No stakes: every match is free.' :
      setupMode === 'lucky' ? 'Lucky Chaos Ludo: Boost & Chaos wheels, Danger tiles, Lucky Streaks, Revenge, a Mega Wheel and King tokens. Pure fun, no stakes: every match is free.' : 'Classic Ludo on a clean board.';
    $('btn-howto').classList.toggle('hidden', setupMode !== 'lucky');
    var order = [0, 1, 3, 2], pos = ['top left', 'top right', 'bottom right', 'bottom left'];
    order.forEach(function (s) {
      var x = seats[s], cur = !x ? 'off' : x.type === 'human' ? 'human' : x.level;
      var row = document.createElement('div'); row.className = 'seat'; row.dataset.seat = s;
      row.setAttribute('role', 'group'); row.setAttribute('aria-label', NAMES[s] + ' seat, ' + pos[s]);
      var head = document.createElement('div'); head.className = 'seat-head';
      var dot = document.createElement('span'); dot.className = 'sw-dot'; dot.style.background = seatColor(s); dot.setAttribute('aria-hidden', 'true');
      var name = document.createElement('span'); name.className = 'sname'; name.textContent = NAMES[s];
      var position = document.createElement('small'); position.textContent = pos[s]; name.appendChild(position); head.appendChild(dot); head.appendChild(name); row.appendChild(head);
      var seg = document.createElement('div'); seg.className = 'seg seat-options'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', NAMES[s] + ' player type');
      [['off', 'Off'], ['human', 'Human'], ['easy', 'Easy'], ['medium', 'Normal'], ['hard', 'Hard']].forEach(function (o) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = o[1]; b.dataset.v = o[0]; b.dataset.seat = s;
        var selected = o[0] === cur; b.setAttribute('aria-pressed', selected ? 'true' : 'false'); if (selected) b.className = 'on';
        b.addEventListener('click', function (e) {
          var keyboard = e.detail === 0;
          SFX.click();
          seats[s] = o[0] === 'off' ? null : o[0] === 'human' ? { type: 'human' } : { type: 'ai', level: o[0] };
          persist(); renderSetup();
          if (keyboard) {
            var next = list.querySelector('.seat-options button[data-seat="' + s + '"][data-v="' + o[0] + '"]');
            if (next) next.focus({ preventScroll: true });
          }
        });
        seg.appendChild(b);
      });
      row.appendChild(seg);
      list.appendChild(row);
    });
    var n = seats.filter(Boolean).length, h = seats.filter(function (x) { return x && x.type === 'human'; }).length;
    var msg = n < 2 ? 'Choose at least 2 players.' : h < 1 ? 'At least one player must be human.' : '';
    $('setup-msg').textContent = msg; $('btn-start').disabled = !!msg;
    each($('presets').children, function (b) { var selected = (b.dataset.p === '1v1' && n === 2) || (b.dataset.p === '3' && n === 3) || (b.dataset.p === '4' && n === 4); b.setAttribute('aria-pressed', selected ? 'true' : 'false'); });
    var summary = $('rules-sum'); summary.innerHTML = '';
    rulesSummary().forEach(function (text) { var chip = document.createElement('span'); chip.className = 'rule-chip'; chip.textContent = text; summary.appendChild(chip); });
  }
  function applyPreset(p) {
    var seats = save.setup[setupKind], lvl = 'medium';
    seats.forEach(function (x) { if (x && x.type === 'ai') lvl = x.level; });
    var A = function () { return setupKind === 'ai' ? { type: 'ai', level: lvl } : { type: 'human' }; };
    save.setup[setupKind] = p === '1v1' ? [null, A(), null, { type: 'human' }] : p === '3' ? [A(), A(), null, { type: 'human' }] : [A(), A(), A(), { type: 'human' }];
    persist(); renderSetup();
  }
  function showGame() {
    ['result', 'menu', 'chat'].forEach(hide);
    screen('game'); paused = false;
    if (G.view == null) G.view = viewOf(G.st);
    buildPods(); buildTiles(); buildPieces(); layout(); render();
    if (G.st.phase === 'over') { finishMatch(); return; }
    advance();
  }
  function openMenu() { if (!G) return; cancelFlow(); stopTimer(); paused = true; layoutPieces(true); render(); persist(); show('menu'); }
  function resumeFromMenu() { hide('menu'); paused = false; layoutPieces(true); advance(); }
  function askConfirm(title, text, yes, onYes, onNo) {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-yes').textContent = yes;
    $('confirm').classList.toggle('exit-confirm', title === 'Exit match?');
    $('confirm-yes').onclick = function () { hide('confirm'); onYes(); };
    $('confirm-no').onclick = function () {
      SFX.click(); hide('confirm');
      if (onNo) { onNo(); return; }
      if (G && !$('game').classList.contains('hidden') && paused) show('menu');
    };
    show('confirm');
  }
  function openExitConfirmation() {
    if (!G || G.st.phase === 'over') return;
    cancelFlow(); stopTimer(); paused = true; hide('chat');
    layoutPieces(true); render(); persist();
    askConfirm('Exit match?', 'Are you sure you want to exit the match? Progress will be lost.', 'Exit', function () {
      cancelFlow(); stopTimer(); G = null; save.game = null; persist(); showHome();
    }, function () {
      hide('menu'); paused = false;
      if (G) { buildPods(); buildTiles(); buildPieces(); layout(); render(); advance(); }
    });
  }

  // ---------------- stats / skins / settings / rules ----------------
  function renderStats() {
    var S = save.stats, rate = S.played ? Math.round(S.won / S.played * 100) + '%' : '–', lv = L.levelFromXp(save.xp);
    var cells = [['Level', lv.level], ['XP', save.xp], ['Matches', S.played], ['Wins', S.won], ['Win rate', rate], ['Captures', S.captures], ['Tokens home', S.home], ['Sixes rolled', S.sixes],
      ['Wins vs Easy', S.vs.easy[1] + ' / ' + S.vs.easy[0]], ['Wins vs Normal', S.vs.medium[1] + ' / ' + S.vs.medium[0]], ['Wins vs Hard', S.vs.hard[1] + ' / ' + S.vs.hard[0]], ['Mystery events', S.events],
      ['Mystery wins', S.mystery[1] + ' / ' + S.mystery[0]], ['Lucky Chaos wins', S.lucky[1] + ' / ' + S.lucky[0]], ['1 v 1 wins', S.duel[1] + ' / ' + S.duel[0]], ['4-player wins', S.four[1] + ' / ' + S.four[0]], ['Pass & Play', S.pass]];
    $('stats-body').innerHTML = cells.map(function (c) { return '<div><b>' + c[1] + '</b><span>' + c[0] + '</span></div>'; }).join('');
  }
  var skinTab = 'boards';
  function skinRequirement(it) {
    if (it.unlock === 'wins') return 'Unlock at ' + it.threshold + ' lifetime wins';
    if (it.unlock === 'streak') return 'Unlock with ' + it.threshold + ' consecutive wins';
    if (it.unlock === 'event') return 'Future event reward · not available yet';
    if (!it.price) return it.id === 'classic-white' ? 'Free option · Ivory remains unchanged' : 'Included';
    return 'Earn ' + it.price.toLocaleString('en-US') + ' coins in matches';
  }
  function skinLockedLabel(it) {
    if (it.unlock === 'event') return 'Locked · future event';
    if (it.unlock === 'streak') return 'Locked · ' + it.threshold + '-win streak';
    if (it.unlock === 'wins') return 'Locked · ' + it.threshold + ' wins';
    return 'Locked';
  }
  function renderSkins() {
    setCoins();
    each($('skin-tabs').children, function (b) { b.classList.toggle('on', b.dataset.tab === skinTab); });
    var grid = $('skin-grid'); grid.innerHTML = '';
    var list = skinTab === 'boards' ? SK.BOARDS : SK.DICE;
    list.forEach(function (it) {
      var state = window.SkinShop.state(it, save, skinTab);
      var el = document.createElement('div');
      el.className = 'skin' + (state.selected ? ' on' : '') + (!state.owned && !state.meetsCondition ? ' is-locked' : '');
      el.dataset.id = it.id; el.dataset.skinPreview = it.id;
      if (skinTab === 'boards') {
        var cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', it.name + ' board preview');
        el.appendChild(cv); drawBoard(cv, 150, it, L.DEFAULT_RULES);
      } else {
        var dp = document.createElement('div'); dp.className = 'dprev'; dp.setAttribute('role', 'img'); dp.setAttribute('aria-label', it.name + ' dice preview');
        dp.style.background = it.face; dp.style.boxShadow = 'inset 0 -4px 0 ' + it.edge;
        dp.innerHTML = '<i></i><i></i><i></i>'; each(dp.children, function (pip) { pip.style.background = it.pip; }); el.appendChild(dp);
      }
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name + (it.dark === false ? ' (light)' : ''); el.appendChild(nm);
      var note = document.createElement('small'); note.className = 'skin-note'; note.textContent = skinRequirement(it); el.appendChild(note);
      var b = document.createElement('button');
      b.className = 'btn ' + (state.selected ? 'plate' : state.owned || state.canUnlock ? 'primary' : 'plate');
      if (state.selected) { b.textContent = 'In use'; b.disabled = true; }
      else if (state.owned) b.textContent = 'Use';
      else if (!state.meetsCondition) { b.textContent = skinLockedLabel(it); b.disabled = true; }
      else if (!state.affordable) { b.textContent = 'Need ' + state.price.toLocaleString('en-US') + ' coins'; b.disabled = true; }
      else if (it.unlock) b.textContent = 'Unlock reward';
      else if (!state.price) b.textContent = 'Get free';
      else b.textContent = 'Unlock · ' + state.price.toLocaleString('en-US') + ' coins';
      b.setAttribute('aria-label', it.name + ': ' + b.textContent);
      b.addEventListener('click', function () {
        var result = window.SkinShop.act(save, skinTab, it, persist);
        if (!result.ok) {
          if (result.reason === 'save-failed') toast('Skin not unlocked. Check device storage and try again.', 2600);
          else if (result.reason === 'insufficient-coins') toast('Not enough coins for ' + it.name + '.', 2000);
          else if (result.reason === 'event-locked') toast('Diamond skins are reserved for a future event.', 2400);
          return;
        }
        if (result.newlyOwned && result.price > 0) SFX.coin(); else SFX.click();
        applySkin(); renderSkins(); setCoins();
        if (!$('game').classList.contains('hidden')) { buildPods(); buildTiles(); buildPieces(); layout(); render(); }
      });
      el.appendChild(b); grid.appendChild(el);
    });
  }
  var SETTINGS = ['sound', 'haptics', 'auto', 'undo', 'timer', 'chat', 'fast'];
  var RULE_KEYS = ['safeSquares', 'captureToEnter', 'blocks', 'bonusOnCapture', 'bonusOnHome'];
  function syncSettingsUI() {
    SETTINGS.forEach(function (k) { $('set-' + k).checked = !!save.settings[k]; });
    RULE_KEYS.forEach(function (k) { $('rule-' + k).checked = !!save.rules[k]; });
    each($('rule-style').children, function (b) { b.classList.toggle('on', b.dataset.v === save.rules.rollStyle); });
    $('btn-privacy-options').classList.toggle('hidden', !(native && Ads.privacyOptionsRequired()));
  }
  function buildRulesEvents() {
    ['boost', 'chaos'].forEach(function (k) {
      $('ev-' + k).innerHTML = L.WHEELS[k].map(function (e) { var i = L.EVENT_INFO[e]; return '<div class="ev ' + k + '"><span class="ev-ico">' + ART.icon(e, 22) + '</span><b>' + i.name + '</b><small>' + i.text + '</small></div>'; }).join('');
    });
    [['lboost', 'boost'], ['lchaos', 'chaos'], ['mega', 'mega']].forEach(function (x) {
      $('ev-' + x[0]).innerHTML = L.LWHEELS[x[1]].map(function (e) {
        var i = L.eventLabel(e), d = L.eventLabel(e, true), extra = d.name !== i.name ? ' <em>Danger: ' + d.name + '</em>' : '';
        return '<div class="ev ' + x[1] + '"><span class="ev-ico">' + ART.icon(e, 22) + '</span><b>' + i.name + extra + '</b><small>' + i.text + '</small></div>';
      }).join('');
    });
  }
  function openRules(tab) {
    each($('rules-tabs').children, function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    each(document.querySelectorAll('.rules-page'), function (p) { p.classList.toggle('hidden', p.dataset.page !== tab); });
    show('rules');
  }
  function setupVisible() { return !$('setup').classList.contains('hidden'); }

  // ---------------- input ----------------
  $('btn-continue').addEventListener('click', function () { SFX.unlock(); SFX.click(); if (G) showGame(); });
  $('btn-vs-ai').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai', 'classic'); });
  $('btn-mystery').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai', 'mystery'); });
  $('btn-lucky').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai', 'lucky'); });
  $('btn-howto').addEventListener('click', function () { SFX.click(); openRules('lucky'); });
  // Lucky Chaos: stored powers and the Mega Wheel (buttons live in the active player's pod)
  $('stage').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.pw, .mega-btn') : null;
    if (!b || !G || busy || paused || G.st.phase !== 'roll' || !isHuman(G.st.turn)) return;
    SFX.unlock();
    if (b.dataset.mega) doMega(); else doPower(b.dataset.pw);
  });
  $('btn-pass').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('pass'); });
  $('btn-setup-back').addEventListener('click', function () { SFX.click(); showHome(); });
  each($('mode-seg').children, function (b) { b.addEventListener('click', function () { SFX.click(); setupMode = b.dataset.mode; save.setup.mode[setupKind] = setupMode; persist(); renderSetup(); }); });
  each($('presets').children, function (b) { b.addEventListener('click', function () { SFX.click(); applyPreset(b.dataset.p); }); });
  $('btn-edit-rules').addEventListener('click', function () { SFX.click(); syncSettingsUI(); show('settings'); });
  $('btn-start').addEventListener('click', function () {
    SFX.unlock(); SFX.click();
    var seats = save.setup[setupKind].map(function (x) { return x ? { type: x.type, level: x.level } : null; }), mode = setupMode;
    var offerTutorial = mode === 'classic' && !tutorialSeen();
    save.setup.mode[setupKind] = mode;
    if (G && G.st.phase !== 'over') askConfirm('Start a new match?', 'Your saved match will be replaced.', 'Start', function () { startMatch(seats, mode, offerTutorial); });
    else startMatch(seats, mode, offerTutorial);
  });
  $('tutorial-start').addEventListener('click', function () { SFX.click(); beginTutorial(); });
  $('tutorial-intro-skip').addEventListener('click', function () { SFX.click(); closeTutorial(); });
  $('tutorial-skip').addEventListener('click', function () { SFX.click(); closeTutorial(); });
  $('tutorial-done').addEventListener('click', function () { SFX.click(); closeTutorial(); });
  // chips: pick which value to move next
  $('stage').addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.chip-v') : null;
    if (!c || !G || busy || G.st.phase !== 'move' || !isHuman(G.st.turn)) return;
    var v = +c.dataset.v; if (!chipMoves(v).length) return;
    var keyboard = e.detail === 0;
    SFX.click(); G.sel = v; render(); highlight(); $('hint').textContent = 'Dice chip ' + v + ' selected. Choose a highlighted token.';
    if (keyboard) { var target = document.querySelector('#pieces .pc.can'); if (target) target.focus(); }
  });
  // tap near a movable token (tokens are small on phones, so pick the nearest highlighted one)
  $('board-wrap').addEventListener('pointerdown', function (e) {
    if (!G || busy || paused || G.st.phase !== 'move' || !isHuman(G.st.turn)) return;
    var r = $('board-wrap').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = Infinity;
    var pool = G.sel != null && chipMoves(G.sel).length ? chipMoves(G.sel) : G.st.moves;
    pool.forEach(function (m) { var p = piecePos[m.seat + '-' + m.piece]; if (!p) return; var d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = m; } });
    if (best && bd < CELL * 1.6) { SFX.unlock(); doMove(best.piece, best.v); }
  });
  $('btn-undo').addEventListener('click', undoRoll);
  $('btn-chat').addEventListener('click', function () { SFX.click(); if (isOpen('chat')) hide('chat'); else show('chat'); });
  $('btn-home').addEventListener('click', function () { SFX.click(); hide('chat'); openMenu(); });
  $('btn-m-resume').addEventListener('click', function () { SFX.click(); resumeFromMenu(); });
  $('btn-m-rules').addEventListener('click', function () { SFX.click(); openRules(G && G.st.mode === 'mystery' ? 'mystery' : G && G.st.mode === 'lucky' ? 'lucky' : 'basics'); });
  $('btn-m-home').addEventListener('click', function () { SFX.click(); hide('menu'); showHome(); });
  $('btn-m-restart').addEventListener('click', function () { SFX.click(); hide('menu'); askConfirm('Restart the match?', 'The current match starts again with the same players.', 'Restart', function () { startMatch(G.seats, G.mode); }); });
  $('btn-r-again').addEventListener('click', function () { leaveResult('again'); });
  $('btn-r-home').addEventListener('click', function () { leaveResult('home'); });
  $('btn-r-double').addEventListener('click', doubleCoins);
  $('btn-exit-match').addEventListener('click', function () { SFX.click(); openExitConfirmation(); });
  $('btn-stats').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderStats(); show('stats'); });
  $('btn-skins').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderSkins(); show('skins'); });
  $('btn-rules').addEventListener('click', function () { SFX.unlock(); SFX.click(); openRules('basics'); });
  each($('rules-tabs').children, function (b) { b.addEventListener('click', function () { SFX.click(); openRules(b.dataset.tab); }); });
  $('btn-settings').addEventListener('click', function () { SFX.unlock(); SFX.click(); syncSettingsUI(); show('settings'); });
  $('btn-game-settings').addEventListener('click', function () { SFX.click(); syncSettingsUI(); show('settings'); });
  each($('skin-tabs').children, function (b) { b.addEventListener('click', function () { skinTab = b.dataset.tab; SFX.click(); renderSkins(); }); });
  each(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', function () { SFX.click(); hide(b.dataset.close); if (setupVisible()) renderSetup(); }); });
  SETTINGS.forEach(function (k) {
    $('set-' + k).addEventListener('change', function () {
      save.settings[k] = $('set-' + k).checked; persist();
      if (k === 'sound') { SFX.setEnabled(save.settings.sound); SFX.unlock(); }
      if (k === 'fast') document.documentElement.style.setProperty('--step-ms', stepMs() + 'ms');
      if (k === 'timer' && G && !$('game').classList.contains('hidden') && !busy) { if (save.settings.timer) startTimer(); else stopTimer(); }
      if (G) render();
      SFX.click();
    });
  });
  RULE_KEYS.forEach(function (k) { $('rule-' + k).addEventListener('change', function () { save.rules[k] = $('rule-' + k).checked; persist(); SFX.click(); if (setupVisible()) renderSetup(); }); });
  each($('rule-style').children, function (b) { b.addEventListener('click', function () { save.rules.rollStyle = b.dataset.v; persist(); SFX.click(); syncSettingsUI(); if (setupVisible()) renderSetup(); }); });
  $('btn-privacy-options').addEventListener('click', function () { Ads.showPrivacyOptions(); });
  $('btn-reset').addEventListener('click', function () {
    hide('settings');
    askConfirm('Reset progress?', 'Coins, XP, skins, statistics and the saved match will be deleted.', 'Reset', function () {
      var resetData = defaults(); resetData.ad = save.ad;
      var resetResult = saveStore.reset(resetData);
      if (!resetResult.ok) {
        lastSaveError = { reason: resetResult.reason, stage: resetResult.stage };
        saveWriteFailed = true;
        var warning = $('save-warning');
        warning.textContent = 'Reset failed. Your existing progress was not cleared. Check device storage and try again.';
        warning.classList.remove('hidden');
        toast('Progress was not reset', 2400);
        return;
      }
      save = resetData;
      try { window.localStorage.removeItem(TUTORIAL_KEY); } catch (e) { /* The main progress reset succeeded. */ }
      location.reload();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (tutorial.intro && e.key === 'Escape') { e.preventDefault(); closeTutorial(); return; }
    if (tutorial.intro && e.key === 'Tab') {
      var dialogButtons = document.querySelectorAll('#tutorial-intro button:not([disabled])');
      if (!dialogButtons.length) return;
      var firstDialogButton = dialogButtons[0], lastDialogButton = dialogButtons[dialogButtons.length - 1];
      if (e.shiftKey && document.activeElement === firstDialogButton) { e.preventDefault(); lastDialogButton.focus(); }
      else if (!e.shiftKey && document.activeElement === lastDialogButton) { e.preventDefault(); firstDialogButton.focus(); }
      return;
    }
    if (!G || $('game').classList.contains('hidden') || paused) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      e.preventDefault(); if (isHuman(G.st.turn)) doRoll();
    }
    else if (/^[1-4]$/.test(e.key) && G.st.phase === 'move' && isHuman(G.st.turn)) {
      var p = +e.key - 1, ms = G.st.moves.filter(function (x) { return x.piece === p; }), m = ms.filter(function (x) { return x.v === G.sel; })[0] || ms[0];
      if (m) doMove(m.piece, m.v, true);
    } else if (e.key === 'u' || e.key === 'U') undoRoll();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') { if (G) { cancelFlow(); stopTimer(); layoutPieces(true); persist(); } }
    else if (G && !$('game').classList.contains('hidden') && !paused && !isOpen('result')) { layoutPieces(true); render(); advance(); }
  });
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe($('stage'));

  // play time for the ad gate (only while a match is on screen and running)
  var lastTick = Date.now();
  setInterval(function () {
    var now = Date.now(), dt = now - lastTick; lastTick = now;
    if (!G || G.st.phase === 'over' || paused || !gameVisible() || isOpen('menu')) return;
    if (dt > 0 && dt < 5000) gate.addPlayTime(dt);
    if (Math.floor(now / 1000) % 10 === 0) persist();
  }, 1000);

  // ---------------- boot ----------------
  SFX.setEnabled(save.settings.sound);
  applySkin(); setCoins(); setLevel(); updateHome(); buildChat(); buildRulesEvents();
  if (loadResult.status === 'recovered') toast('Recovered your last safe save. Some recent moves may be missing.', 5000);
  // consent + SDK init only: no interstitial is ever shown on launch; the banner sits on the menu / game screens
  if (Ads) Ads.init().then(function () { syncSettingsUI(); Ads.showBanner(); });

  window.__cf = {
    get game() { return G; }, get save() { return save; }, get loadStatus() { return loadResult.status; }, logic: L, gate: gate,
    native: native, haptic: haptic,
    persist: persist, isValidGame: validGame, isValidSave: validSave, get lastSaveError() { return lastSaveError; },
    get busy() { return busy; }, get paused() { return paused; }, get idle() { return !busy && timers.length === 0 && !isOpen('wheel') && !isOpen('choice'); },
    get undoActive() { return undoActive(); },
    force: function (vals) { forced = vals.slice(); },
    forceEvent: function (evs) { forcedEvents = [].concat(evs); },
    forceMega: function (evs) { forcedMega = [].concat(evs); },
    mega: function (ev) { doMega(ev); },
    /** Test helper: edit the running match state, then redraw and continue. */
    edit: function (fn) { cancelFlow(); fn(G.st); G.st.moves = G.st.phase === 'move' ? L.queueMoves(G.st) : []; buildPods(); buildTiles(); buildPieces(); layout(); render(); advance(); },
    piecePoint: function (s, i) { var r = $('board-wrap').getBoundingClientRect(), p = piecePos[s + '-' + i]; return p ? { x: r.left + p.x, y: r.top + p.y } : null; },
    podOf: function (s) { var p = podEl(s); return p ? +p.dataset.slot : null; },
    layout: layout
  };
})();
