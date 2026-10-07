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
  var ACCENT = { graphite: ['#f4b740', '#1c1504'], linen: ['#2b3140', '#ffffff'], walnut: ['#e0a232', '#231605'], aurora: ['#27e0b3', '#03261d'], midnight: ['#6aa8ff', '#071018'], timber: ['#c47a32', '#2a1808'],
    // v1.6.4 light-theme contrast: deep accents on pale skins (pale amber on cream was unreadable).
    desert: ['#8f5212', '#ffffff'], candy: ['#a3306b', '#ffffff'], sakura: ['#a3364b', '#ffffff'], frost: ['#28609f', '#ffffff'] };
  // v1.6.4 UI chrome tokens. The board canvas keeps each skin's own palette untouched; only page text/chrome changes.
  // Classic Wood has a light board on a dark walnut page, so its chrome (text, chips, cards) follows the dark styles.
  var UI_CHROME = { timber: { dark: true, ink: '#fdf5e6', muted: '#ead6b4' } };
  var LIGHT_MUTED_DEEPEN = 0.3; // light skins: pull --muted toward black for >= 4.5:1 subtitle contrast
  var CORE_LIGHTS = ['#ffd0c1', '#a0ffd2', '#ffe7a3', '#a9ddff'];
  /* Tall pawn token materials (original Crossfour art — no third-party names/assets).
   * Seat: 0 Coral/ruby+rose-gold, 1 Jade/emerald+silver-green, 2 Saffron/gold+golden, 3 Cobalt/sapphire+silver-blue.
   * Token Evolution Lv1 Basic→Lv5 Legendary multiplies gloss/glow/particles/badge (cosmetic only). */
  var TOKEN_MAT = [
    { id: 'ruby', rim0: '#ffe8de', rim1: '#e8a090', rim2: '#9a4034', glassHi: '#ffb0a0', glassMid: '#e85a48', glassLo: '#8a2820' },
    { id: 'emerald', rim0: '#f2fff8', rim1: '#b5dcc8', rim2: '#2f5e48', glassHi: '#a8ffe0', glassMid: '#1fc49a', glassLo: '#0a6a4c' },
    { id: 'gold', rim0: '#fff8d6', rim1: '#e8c050', rim2: '#8a6410', glassHi: '#ffe9a0', glassMid: '#f0b828', glassLo: '#9a6810' },
    { id: 'sapphire', rim0: '#eef4ff', rim1: '#a8c4e8', rim2: '#2a4e82', glassHi: '#b8d8ff', glassMid: '#3d7ef0', glassLo: '#143a78' }
  ];
  var TOKEN_EVOLUTION = window.TokenEvolution;
  var UNDO_MS = 2200, TIMER_MS = 20000, AUTO_ROLL_MS = 4000, MOVE_DECIDE_MS = 4000, FREE_UNDOS = 3;
  var PHRASES = ['Good luck!', 'Nice move!', 'Oops!', 'So close!', 'Well played!', "Let's go!", 'Not again…', 'Your turn!'];

  // ---------------- save ----------------
  function defaults() {
    return {
      coins: 0, xp: 0, tokenEvo: 1, tokenEvoUnlocked: 1, owned: { boards: ['graphite', 'linen', 'midnight', 'timber'], dice: ['ivory'] }, board: 'graphite', dice: 'ivory',
      settings: { sound: true, haptics: true, auto: true, fast: false, undo: true, timer: false, chat: true },
      rules: L.normRules({}),
      setup: {
        ai: [null, { type: 'ai', level: 'medium' }, null, { type: 'human' }],
        pass: [null, { type: 'human' }, null, { type: 'human' }],
        mode: { ai: 'classic', pass: 'classic' }
      },
      stats: { played: 0, won: 0, streak: 0, captures: 0, home: 0, sixes: 0, pass: 0, events: 0, vs: { easy: [0, 0], medium: [0, 0], hard: [0, 0] }, mystery: [0, 0], lucky: [0, 0], quick: [0, 0], team: [0, 0], arrow: [0, 0], friendly: [0, 0], duel: [0, 0], four: [0, 0] },
      flags: { diamondCollection: true }, game: null, ad: {}

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
    var st = g.st, modes = ['classic', 'mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly'], np = st.nPieces === 2 ? 2 : 4;
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
      return Array.isArray(pieces) && pieces.length === np && pieces.every(function (p) { return isInt(p, -1, L.HOME); }) &&
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
    if (TOKEN_EVOLUTION) {
      s.tokenEvoUnlocked = TOKEN_EVOLUTION.clampLevel(safeCounter(raw.tokenEvoUnlocked, d.tokenEvoUnlocked) || 1);
      s.tokenEvo = TOKEN_EVOLUTION.clampLevel(safeCounter(raw.tokenEvo, d.tokenEvo) || 1);
      if (s.tokenEvo > s.tokenEvoUnlocked) s.tokenEvo = s.tokenEvoUnlocked;
    } else { s.tokenEvo = 1; s.tokenEvoUnlocked = 1; }
    s.board = SK.BOARDS.some(function (x) { return x.id === raw.board; }) ? raw.board : d.board;
    s.dice = SK.DICE.some(function (x) { return x.id === raw.dice; }) ? raw.dice : d.dice;
    if (isRecord(raw.settings)) Object.keys(d.settings).forEach(function (k) { s.settings[k] = typeof raw.settings[k] === 'boolean' ? raw.settings[k] : d.settings[k]; });
    if (isRecord(raw.rules)) Object.keys(d.rules).forEach(function (k) {
      s.rules[k] = k === 'rollStyle' ? (raw.rules[k] === 'classic' || raw.rules[k] === 'star' ? raw.rules[k] : d.rules[k]) :
        (typeof raw.rules[k] === 'boolean' ? raw.rules[k] : d.rules[k]);
    });
    if (isRecord(raw.setup)) {
      s.setup.ai = normalizeSeats(raw.setup.ai, d.setup.ai); s.setup.pass = normalizeSeats(raw.setup.pass, d.setup.pass);
      if (isRecord(raw.setup.mode)) ['ai', 'pass'].forEach(function (k) { s.setup.mode[k] = ['classic', 'mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly'].indexOf(raw.setup.mode[k]) >= 0 ? raw.setup.mode[k] : d.setup.mode[k]; });
    }
    if (isRecord(raw.stats)) {
      Object.keys(d.stats).forEach(function (k) {
        if (k === 'vs') {
          if (isRecord(raw.stats.vs)) Object.keys(d.stats.vs).forEach(function (level) {
            var pair = raw.stats.vs[level]; if (Array.isArray(pair) && pair.length === 2) s.stats.vs[level] = [safeCounter(pair[0], 0), safeCounter(pair[1], 0)];
          });
        } else if (['mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly', 'duel', 'four'].indexOf(k) >= 0) {
          var p = raw.stats[k]; if (Array.isArray(p) && p.length === 2) s.stats[k] = [safeCounter(p[0], 0), safeCounter(p[1], 0)];
        } else s.stats[k] = safeCounter(raw.stats[k], d.stats[k]);
      });
    }
    if (isRecord(raw.flags)) Object.keys(d.flags).forEach(function (k) { s.flags[k] = raw.flags[k] === true; });
    s.flags.diamondCollection = true;
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
        !isInt(s.tokenEvo, 1, 5) || !isInt(s.tokenEvoUnlocked, 1, 5) || s.tokenEvo > s.tokenEvoUnlocked ||
        !SK.BOARDS.some(function (x) { return x.id === s.board; }) || !SK.DICE.some(function (x) { return x.id === s.dice; }) || !isRecord(s.settings) ||
        !isRecord(s.rules) || !isRecord(s.setup) || !isRecord(s.stats) || !isRecord(s.ad) || !(s.game === null || validGame(s.game))) return false;
    if (!Object.keys(defaults().settings).every(function (k) { return typeof s.settings[k] === 'boolean'; })) return false;
    if (s.flags !== undefined && (!isRecord(s.flags) || !Object.keys(s.flags).every(function (k) { return typeof s.flags[k] === 'boolean'; }))) return false;
    if (!Object.keys(defaults().rules).every(function (k) { return k === 'rollStyle' ? ['star', 'classic'].indexOf(s.rules[k]) >= 0 : typeof s.rules[k] === 'boolean'; })) return false;
    if (!validSeatList(s.setup.ai) || !validSeatList(s.setup.pass) || !isRecord(s.setup.mode) || !['ai', 'pass'].every(function (k) { return ['classic', 'mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly'].indexOf(s.setup.mode[k]) >= 0; })) return false;
    var ds = defaults().stats;
    if (!Object.keys(ds).every(function (k) {
      if (k === 'streak') return s.stats.streak === undefined || isCount(s.stats.streak);
      if (k === 'vs') return isRecord(s.stats.vs) && Object.keys(ds.vs).every(function (level) { return Array.isArray(s.stats.vs[level]) && s.stats.vs[level].length === 2 && s.stats.vs[level].every(isCount); });
      if (['mystery', 'lucky', 'quick', 'team', 'arrow', 'friendly', 'duel', 'four'].indexOf(k) >= 0) return Array.isArray(s.stats[k]) && s.stats[k].length === 2 && s.stats[k].every(isCount);
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
  if (TOKEN_EVOLUTION) TOKEN_EVOLUTION.applyNormalize(save);
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
  function alpha(rgbOrHex, a) {
    if (rgbOrHex && rgbOrHex.charAt(0) === '#') return rgba(rgbOrHex, a);
    var m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgbOrHex || '');
    return m ? 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')' : rgba('#888888', a);
  }
  function haptic(kind) {
    if (!save.settings.haptics) return;
    if (!native) {
      if (navigator.vibrate) { try { navigator.vibrate(kind === 'heavy' || kind === 'warn' ? 36 : kind === 'success' ? [16, 30, 16] : 12); } catch (e) {} }
      return;
    }
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
  function setLevel() { var l = L.levelFromXp(save.xp); $('lvl-badge').textContent = l.level; $('lvl-fill').style.width = Math.round(l.into / l.need * 100) + '%'; }
  function board() { for (var i = 0; i < SK.BOARDS.length; i++) if (SK.BOARDS[i].id === save.board) return SK.BOARDS[i]; return SK.BOARDS[0]; }
  function dice() { for (var i = 0; i < SK.DICE.length; i++) if (SK.DICE[i].id === save.dice) return SK.DICE[i]; return SK.DICE[0]; }
  function seatColor(s) { return board().seats[s]; }
  function stepMs() { return save.settings.fast ? 85 : 150; }
  function aiDelay() { return save.settings.fast ? 300 : 600; }

  // ---------------- skins ----------------
  function diceFaceSolid(d) {
    // WebView button needs an opaque solid; gradients go in --d-face-img only.
    var face = d && d.face;
    if (typeof face === 'string' && face.indexOf('gradient') >= 0) {
      var hexes = face.match(/#[0-9a-fA-F]{3,8}/g) || [];
      return hexes[1] || hexes[0] || d.edge || '#fbfaf6';
    }
    return (typeof face === 'string' && face.charAt(0) === '#') ? face : '#fbfaf6';
  }
  function applySkin() {
    var b = board(), d = dice(), r = document.documentElement.style;
    var ui = UI_CHROME[b.id] || {}, uiDark = ui.dark != null ? !!ui.dark : !!b.dark;
    var uiMuted = ui.muted || (uiDark ? b.muted : mix(b.muted, 'b', LIGHT_MUTED_DEEPEN));
    r.setProperty('--bg', b.bg); r.setProperty('--page', b.page); r.setProperty('--board', b.board); r.setProperty('--ink', ui.ink || b.ink); r.setProperty('--muted', uiMuted);
    b.seats.forEach(function (c, i) { r.setProperty('--s' + i, c); });
    var acc = ACCENT[b.id] || ACCENT.graphite; r.setProperty('--accent', acc[0]); r.setProperty('--accent-ink', acc[1]);
    var faceSolid = diceFaceSolid(d);
    var isGrad = typeof d.face === 'string' && d.face.indexOf('gradient') >= 0;
    r.setProperty('--d-face', faceSolid);
    r.setProperty('--d-face-hi', mix(faceSolid, 'w', 0.42));
    r.setProperty('--d-face-lo', mix(faceSolid, 'b', 0.14));
    r.setProperty('--d-edge', d.edge);
    r.setProperty('--d-pip', d.pip);
    r.setProperty('--d-pip-hi', mix(d.pip, 'w', 0.45));
    r.setProperty('--d-face-img', isGrad ? d.face : 'none');
    document.body.classList.toggle('light', !uiDark);
    document.body.setAttribute('data-skin', b.id);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', b.bg);
  }

  // ---------------- board drawing ----------------
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function star(ctx, cx, cy, R, r) { ctx.beginPath(); for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, rad = k % 2 ? r : R; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } ctx.closePath(); }
  var BASE_ORIGIN = [[0, 0], [0, 9], [9, 9], [9, 0]]; // [row, col] of each seat's 6x6 base
  function paintBoardTexture(ctx, sz, b, c) {
    var wood = b.id === 'timber' || b.id === 'walnut';
    var dark = !!b.dark;
    var g = ctx.createRadialGradient(sz * 0.28, sz * 0.22, c * 0.6, sz * 0.55, sz * 0.62, sz * 0.98);
    g.addColorStop(0, mix(b.board, 'w', wood ? 0.22 : (dark ? 0.14 : 0.12)));
    g.addColorStop(0.42, b.board);
    g.addColorStop(1, mix(b.board, 'b', wood ? 0.32 : (dark ? 0.26 : 0.16)));
    rr(ctx, 0, 0, sz, sz, c * 0.7); ctx.fillStyle = g; ctx.fill();
    ctx.save();
    rr(ctx, 0, 0, sz, sz, c * 0.7); ctx.clip();
    // soft key light from top-left (ambient)
    var amb = ctx.createRadialGradient(sz * 0.22, sz * 0.18, c * 0.2, sz * 0.45, sz * 0.4, sz * 0.85);
    amb.addColorStop(0, alpha(mix(b.board, 'w', 0.55), dark ? 0.14 : 0.12));
    amb.addColorStop(0.55, alpha(mix(b.board, 'w', 0.2), 0.03));
    amb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = amb; ctx.fillRect(0, 0, sz, sz);
    if (wood) {
      for (var i = 0; i < 34; i++) {
        var y = (i + 0.28) * (sz / 34);
        ctx.beginPath(); ctx.moveTo(0, y);
        ctx.bezierCurveTo(sz * 0.28, y + c * 0.12, sz * 0.55, y - c * 0.1, sz * 0.78, y + c * 0.06);
        ctx.bezierCurveTo(sz * 0.9, y + c * 0.1, sz * 0.96, y - c * 0.04, sz, y + c * 0.03);
        ctx.strokeStyle = alpha(mix(b.board, i % 2 ? 'b' : 'w', 0.26), i % 4 ? 0.1 : 0.18);
        ctx.lineWidth = Math.max(0.9, c * (0.035 + (i % 7) * 0.01)); ctx.stroke();
      }
      // secondary fine grain
      for (var g2 = 0; g2 < 18; g2++) {
        var yy = (g2 + 0.6) * (sz / 18) + c * 0.08;
        ctx.beginPath(); ctx.moveTo(sz * 0.05, yy); ctx.bezierCurveTo(sz * 0.4, yy - c * 0.05, sz * 0.7, yy + c * 0.07, sz * 0.95, yy);
        ctx.strokeStyle = alpha(mix(b.board, 'b', 0.35), 0.07); ctx.lineWidth = 0.8; ctx.stroke();
      }
      var sheen = ctx.createLinearGradient(0, 0, sz, sz * 0.4);
      sheen.addColorStop(0, alpha(mix(b.board, 'w', 0.5), 0.0));
      sheen.addColorStop(0.4, alpha(mix(b.board, 'w', 0.55), 0.13));
      sheen.addColorStop(1, alpha(mix(b.board, 'w', 0.35), 0.0));
      ctx.fillStyle = sheen; ctx.fillRect(0, 0, sz, sz);
    } else {
      for (var j = 0; j < 90; j++) {
        var px = ((j * 97) % 100) / 100 * sz, py = ((j * 53) % 100) / 100 * sz;
        ctx.beginPath(); ctx.arc(px, py, c * (0.05 + (j % 6) * 0.028), 0, Math.PI * 2);
        ctx.fillStyle = alpha(mix(b.board, j % 2 ? 'w' : 'b', dark ? 0.42 : 0.34), dark ? 0.07 : 0.055); ctx.fill();
      }
      // felt weave cross-hatch (subtle)
      ctx.save();
      ctx.globalAlpha = dark ? 0.045 : 0.04;
      ctx.strokeStyle = mix(b.board, dark ? 'w' : 'b', 0.35);
      ctx.lineWidth = 0.7;
      for (var hx = -sz; hx < sz * 2; hx += c * 0.55) {
        ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx + sz * 0.35, sz); ctx.stroke();
      }
      for (var hy = -sz; hy < sz * 2; hy += c * 0.55) {
        ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(sz, hy + sz * 0.22); ctx.stroke();
      }
      ctx.restore();
      var felt = ctx.createLinearGradient(0, 0, sz, sz);
      felt.addColorStop(0, alpha(mix(b.board, 'w', 0.3), dark ? 0.12 : 0.09));
      felt.addColorStop(0.5, alpha(mix(b.board, 'b', 0.12), 0.05));
      felt.addColorStop(1, alpha(mix(b.board, 'b', 0.35), dark ? 0.16 : 0.11));
      ctx.fillStyle = felt; ctx.fillRect(0, 0, sz, sz);
      var vig = ctx.createRadialGradient(sz * 0.5, sz * 0.5, sz * 0.18, sz * 0.5, sz * 0.5, sz * 0.74);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, alpha(mix(b.board, 'b', 0.58), dark ? 0.26 : 0.1));
      ctx.fillStyle = vig; ctx.fillRect(0, 0, sz, sz);
    }
    ctx.restore();
    // rim bevel — consistent light/dark on every theme
    rr(ctx, 1.5, 1.5, sz - 3, sz - 3, c * 0.68);
    ctx.lineWidth = Math.max(2.4, c * 0.1);
    ctx.strokeStyle = alpha(mix(b.board, 'w', dark ? 0.48 : 0.42), dark ? 0.48 : 0.5); ctx.stroke();
    rr(ctx, 3.4, 3.4, sz - 6.8, sz - 6.8, c * 0.62);
    ctx.lineWidth = Math.max(1.7, c * 0.06);
    ctx.strokeStyle = alpha(mix(b.board, 'b', 0.55), dark ? 0.58 : 0.42); ctx.stroke();
  }
  function drawBoard(cv, sz, b, rules, active, view) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(sz * dpr); cv.height = Math.round(sz * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = sz / 15, gap = Math.max(1.2, c * 0.08);
    ctx.clearRect(0, 0, sz, sz);
    // soft drop shadow under the board (drawn into canvas so canvas box-shadow can stay light)
    ctx.save();
    rr(ctx, c * 0.12, c * 0.22, sz - c * 0.24, sz - c * 0.18, c * 0.75);
    ctx.fillStyle = 'rgba(0,0,0,.36)'; ctx.shadowColor = 'rgba(0,0,0,.58)'; ctx.shadowBlur = c * 1.4; ctx.shadowOffsetY = c * 0.26; ctx.fill();
    ctx.restore();
    paintBoardTexture(ctx, sz, b, c);
    ctx.save(); ctx.translate(sz / 2, sz / 2); ctx.rotate((view || 0) * Math.PI / 2); ctx.translate(-sz / 2, -sz / 2);
    for (var s = 0; s < 4; s++) {
      var o = BASE_ORIGIN[s], x = o[1] * c, y = o[0] * c, col = b.seats[s];
      ctx.globalAlpha = active && !active[s] ? 0.3 : 1;
      // outer base plate shadow for consistent depth on Midnight/Wood/Graphite
      rr(ctx, x + gap * 1.6 + 1.2, y + gap * 1.6 + 2, 6 * c - gap * 3.2, 6 * c - gap * 3.2, c * 0.55);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fill();
      var g = ctx.createLinearGradient(x, y, x + 6 * c, y + 6 * c);
      g.addColorStop(0, mix(col, 'w', 0.22)); g.addColorStop(0.4, col); g.addColorStop(1, mix(col, 'b', 0.28));
      rr(ctx, x + gap * 1.6, y + gap * 1.6, 6 * c - gap * 3.2, 6 * c - gap * 3.2, c * 0.55);
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = Math.max(1.9, c * 0.075); ctx.strokeStyle = alpha(mix(col, 'w', 0.55), 0.62); ctx.stroke();
      rr(ctx, x + c * 0.88, y + c * 0.88, 4.24 * c, 4.24 * c, c * 0.5);
      var yard = ctx.createRadialGradient(x + 2.55 * c, y + 2.25 * c, c * 0.3, x + 3 * c, y + 3.1 * c, c * 3.35);
      yard.addColorStop(0, mix(b.center, 'w', 0.18)); yard.addColorStop(0.5, b.center); yard.addColorStop(1, mix(b.center, 'b', 0.18));
      ctx.fillStyle = yard; ctx.fill();
      ctx.lineWidth = Math.max(1.35, c * 0.055); ctx.strokeStyle = rgba(col, 0.5); ctx.stroke();
      // Yard pads: inset wells + seat rim light + numeral plates (original Crossfour style)
      L.BASE_SPOTS[s].forEach(function (p, spotIdx) {
        var cx = (p[1] + 0.5) * c, cy = (p[0] + 0.5) * c;
        var R = c * 0.54, num = spotIdx + 1;
        // soft contact shadow
        ctx.beginPath(); ctx.arc(cx + c * 0.015, cy + c * 0.09, R * 1.08, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,' + (b.dark ? '.45' : '.26') + ')'; ctx.fill();
        // seat-tinted outer halo (soft rim light)
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
        var halo = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.18);
        halo.addColorStop(0, 'rgba(0,0,0,0)');
        halo.addColorStop(0.5, rgba(col, b.dark ? 0.1 : 0.06));
        halo.addColorStop(1, rgba(col, b.dark ? 0.42 : 0.28));
        ctx.fillStyle = halo; ctx.fill();
        // recessed bowl (inset well) — deeper center, seat-tinted walls
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        var well = ctx.createRadialGradient(cx - R * 0.18, cy - R * 0.26, R * 0.02, cx, cy + R * 0.12, R);
        well.addColorStop(0, alpha(mix(b.center, 'b', b.dark ? 0.55 : 0.28), 0.98));
        well.addColorStop(0.35, alpha(mix(b.center, 'b', b.dark ? 0.42 : 0.2), 0.98));
        well.addColorStop(0.72, rgba(col, b.dark ? 0.34 : 0.24));
        well.addColorStop(1, alpha(mix(col, 'b', 0.38), 0.96));
        ctx.fillStyle = well; ctx.fill();
        // carved lip: dark bottom arc for depth
        ctx.beginPath(); ctx.arc(cx, cy + R * 0.04, R * 0.88, 0.08 * Math.PI, 0.92 * Math.PI);
        ctx.strokeStyle = 'rgba(0,0,0,' + (b.dark ? '.55' : '.32') + ')';
        ctx.lineWidth = Math.max(1.8, c * 0.075); ctx.stroke();
        // bright seat-colored rim ring
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2.4, c * 0.11);
        ctx.strokeStyle = alpha(mix(col, 'w', b.dark ? 0.5 : 0.32), 0.98); ctx.stroke();
        // thin inner highlight ring
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1.1, c * 0.045);
        ctx.strokeStyle = alpha(mix(col, 'w', 0.72), b.dark ? 0.42 : 0.32); ctx.stroke();
        // top sheen (WebView-safe arc; original Crossfour)
        ctx.beginPath(); ctx.arc(cx - R * 0.2, cy - R * 0.28, R * 0.28, 0, Math.PI * 2);
        var sheen = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.28, 0, cx - R * 0.2, cy - R * 0.28, R * 0.3);
        sheen.addColorStop(0, 'rgba(255,255,255,' + (b.dark ? '.38' : '.48') + ')');
        sheen.addColorStop(0.5, 'rgba(255,255,255,.1)');
        sheen.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen; ctx.fill();
        // numeral plate (high-contrast readable 1–4)
        var pr = R * 0.4;
        ctx.beginPath(); ctx.arc(cx, cy + R * 0.02, pr, 0, Math.PI * 2);
        var plate = ctx.createLinearGradient(cx - pr, cy - pr, cx + pr, cy + pr * 1.15);
        plate.addColorStop(0, alpha(mix(col, 'w', 0.28), b.dark ? 0.92 : 0.82));
        plate.addColorStop(0.42, alpha(mix(b.center, 'b', b.dark ? 0.62 : 0.4), 0.96));
        plate.addColorStop(1, alpha(mix(col, 'b', 0.28), 0.92));
        ctx.fillStyle = plate; ctx.fill();
        ctx.lineWidth = Math.max(1.3, c * 0.055);
        ctx.strokeStyle = alpha(mix(col, 'w', 0.65), 0.95); ctx.stroke();
        // plate micro-sheen
        ctx.beginPath(); ctx.arc(cx - pr * 0.28, cy - pr * 0.22, pr * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + (b.dark ? '.2' : '.28') + ')'; ctx.fill();
        // outlined numeral
        ctx.save();
        ctx.font = '900 ' + Math.max(12, Math.round(c * 0.46)) + 'px Inter, system-ui, "Segoe UI", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(2.6, c * 0.1);
        ctx.strokeStyle = 'rgba(6,8,12,.88)';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(String(num), cx, cy + R * 0.05);
        ctx.fillText(String(num), cx, cy + R * 0.05);
        ctx.restore();
      });
    }
    ctx.globalAlpha = 1;
    function cell(rc, fill, edge, raised) {
      var x = rc[1] * c + gap / 2, y = rc[0] * c + gap / 2, w = c - gap, h = c - gap;
      if (raised) {
        ctx.save();
        rr(ctx, x + 0.9, y + 1.7, w, h, c * 0.18); ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fill();
        ctx.restore();
      }
      rr(ctx, x, y, w, h, c * 0.16); ctx.fillStyle = fill; ctx.fill();
      if (edge) {
        ctx.lineWidth = Math.max(1.4, c * 0.065); ctx.strokeStyle = edge; ctx.stroke();
        ctx.save();
        rr(ctx, x + 0.85, y + 0.85, w - 1.7, h - 1.7, c * 0.12);
        ctx.strokeStyle = alpha(mix(fill.indexOf('rgb') === 0 ? b.cell : (fill[0] === '#' ? fill : b.cell), 'w', b.dark ? 0.6 : 0.52), b.dark ? 0.34 : 0.3);
        ctx.lineWidth = 1.15; ctx.stroke();
        // bottom lip for carved depth
        ctx.beginPath();
        ctx.moveTo(x + c * 0.12, y + h - 1.2); ctx.lineTo(x + w - c * 0.12, y + h - 1.2);
        ctx.strokeStyle = alpha(mix(b.cellEdge, 'b', 0.25), b.dark ? 0.35 : 0.28);
        ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
    }
    // Arrow danger (khatra) cells: permanent red on the 3 squares each arrow jump passes through.
    var DANGER_FILL = '#d23a30', DANGER_EDGE = '#7c1610';
    function dangerMark(rc, cx, cy) {
      var x = rc[1] * c + gap / 2, y = rc[0] * c + gap / 2, w = c - gap, h = c - gap;
      ctx.save();
      rr(ctx, x, y, w, h, c * 0.16); ctx.clip();
      // top-lit sheen so the red reads as a lacquered tile on wood / felt / dark themes
      var dg = ctx.createLinearGradient(x, y, x, y + h);
      dg.addColorStop(0, 'rgba(255,140,120,.42)'); dg.addColorStop(0.5, 'rgba(255,90,70,0)'); dg.addColorStop(1, 'rgba(60,0,0,.28)');
      ctx.fillStyle = dg; ctx.fillRect(x, y, w, h);
      // faint diagonal hazard stripes
      ctx.strokeStyle = 'rgba(90,0,0,.22)'; ctx.lineWidth = Math.max(1.2, c * 0.09);
      for (var k = -2; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x + k * c * 0.34, y + h); ctx.lineTo(x + k * c * 0.34 + h, y); ctx.stroke(); }
      ctx.restore();
      // small warning triangle with "!" (khatra)
      ctx.save(); ctx.translate(cx, cy + c * 0.02);
      var t = c * 0.2;
      ctx.beginPath(); ctx.moveTo(0, -t); ctx.lineTo(t * 1.1, t * 0.78); ctx.lineTo(-t * 1.1, t * 0.78); ctx.closePath();
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1.3, c * 0.06);
      ctx.fillStyle = 'rgba(255,244,236,.92)'; ctx.fill(); ctx.strokeStyle = 'rgba(90,8,4,.55)'; ctx.stroke();
      ctx.fillStyle = '#9c1c14';
      ctx.fillRect(-c * 0.022, -t * 0.42, c * 0.044, t * 0.68);
      ctx.beginPath(); ctx.arc(0, t * 0.5, c * 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    L.TRACK_CELLS.forEach(function (rc, a) {
      var startOf = L.START_SQUARES.indexOf(a), isStar = L.STAR_SQUARES.indexOf(a) >= 0;
      var isDanger = !!(rules && rules.arrows && L.ARROW_DANGER_SQUARES && L.ARROW_DANGER_SQUARES.indexOf(a) >= 0 && startOf < 0 && !isStar);
      if (startOf >= 0) cell(rc, b.seats[startOf], alpha(mix(b.seats[startOf], 'b', 0.25), 0.55), true);
      else if (isDanger) cell(rc, DANGER_FILL, DANGER_EDGE, true);
      else cell(rc, b.cell, b.cellEdge, true);
      var cx = (rc[1] + 0.5) * c, cy = (rc[0] + 0.5) * c;
      if (isDanger) dangerMark(rc, cx, cy);
      if (startOf >= 0) {
        ctx.save(); ctx.translate(cx, cy);
        var nx = L.TRACK_CELLS[(a + 1) % 52]; ctx.rotate(Math.atan2(nx[0] - rc[0], nx[1] - rc[1]));
        ctx.beginPath(); ctx.moveTo(-c * 0.16, -c * 0.22); ctx.lineTo(c * 0.14, 0); ctx.lineTo(-c * 0.16, c * 0.22);
        ctx.lineWidth = Math.max(1.8, c * 0.1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-c * 0.18, -c * 0.2); ctx.lineTo(c * 0.12, 0); ctx.lineTo(-c * 0.18, c * 0.2);
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke(); ctx.restore();
      } else if (isStar) {
        star(ctx, cx + 0.55, cy + 1.05, c * 0.36, c * 0.15);
        ctx.fillStyle = 'rgba(0,0,0,.36)'; ctx.fill();
        star(ctx, cx, cy, c * 0.36, c * 0.15);
        if (rules && rules.safeSquares) {
          var sg = ctx.createRadialGradient(cx - c * 0.1, cy - c * 0.12, c * 0.02, cx, cy, c * 0.36);
          sg.addColorStop(0, mix(b.muted, 'w', b.dark ? 0.88 : 0.8));
          sg.addColorStop(0.45, mix(b.muted, 'w', 0.42));
          sg.addColorStop(1, rgba(b.muted.length === 7 ? b.muted : '#888888', 0.98));
          ctx.fillStyle = sg; ctx.fill();
          ctx.lineWidth = Math.max(1.35, c * 0.055); ctx.strokeStyle = alpha(mix(b.muted, 'w', 0.65), 0.92); ctx.stroke();
          // inner cut highlight
          star(ctx, cx, cy, c * 0.22, c * 0.09);
          ctx.lineWidth = Math.max(1, c * 0.035); ctx.strokeStyle = alpha('#fff', b.dark ? 0.28 : 0.22); ctx.stroke();
        } else {
          ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(b.muted, 0.5); ctx.stroke();
        }
      }
      if (rules && rules.arrows && L.ARROW_SQUARES.indexOf(a) >= 0) {
        ctx.save(); ctx.translate(cx, cy);
        var nx2 = L.TRACK_CELLS[(a + 1) % 52]; ctx.rotate(Math.atan2(nx2[0] - rc[0], nx2[1] - rc[1]));
        // plate + amber chevron (readable on Midnight, Wood, Graphite)
        rr(ctx, -c * 0.38, -c * 0.34, c * 0.76, c * 0.68, c * 0.16);
        ctx.fillStyle = alpha(mix(b.cell, b.dark ? 'w' : 'b', b.dark ? 0.2 : 0.14), 0.9); ctx.fill();
        ctx.lineWidth = Math.max(1.3, c * 0.05); ctx.strokeStyle = alpha('#f5c04a', b.dark ? 0.62 : 0.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(c * 0.02, 0, c * 0.24, 0, Math.PI * 2);
        ctx.fillStyle = alpha('#f0b429', 0.22); ctx.fill();
        // shadow chevron
        ctx.beginPath();
        ctx.moveTo(-c * 0.22, -c * 0.2); ctx.lineTo(c * 0.28, 0.05); ctx.lineTo(-c * 0.22, c * 0.24);
        ctx.lineTo(-c * 0.02, 0.05); ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-c * 0.26, -c * 0.24); ctx.lineTo(c * 0.3, 0); ctx.lineTo(-c * 0.26, c * 0.24);
        ctx.lineTo(-c * 0.04, 0); ctx.closePath();
        var ag = ctx.createLinearGradient(-c * 0.24, -c * 0.2, c * 0.28, c * 0.14);
        ag.addColorStop(0, '#fff6c4'); ag.addColorStop(0.35, '#f0b429'); ag.addColorStop(1, '#a86808');
        ctx.fillStyle = ag; ctx.fill();
        ctx.lineWidth = Math.max(1.5, c * 0.065); ctx.strokeStyle = 'rgba(35,20,0,.88)'; ctx.stroke();
        // tip highlight
        ctx.beginPath(); ctx.moveTo(c * 0.08, -c * 0.06); ctx.lineTo(c * 0.26, 0); ctx.lineTo(c * 0.08, c * 0.06);
        ctx.strokeStyle = alpha('#fff', 0.45); ctx.lineWidth = Math.max(1, c * 0.04); ctx.stroke();
        ctx.restore();
      }
    });
    for (s = 0; s < 4; s++) L.HOME_COLS[s].forEach(function (rc, k) {
      cell(rc, rgba(b.seats[s], 0.48 + k * 0.12), alpha(mix(b.seats[s], 'b', 0.28), 0.55), true);
    });
    var m0 = 6 * c, m1 = 9 * c, mc = 7.5 * c;
    var tri = [[[m0, m0], [m0, m1]], [[m0, m0], [m1, m0]], [[m1, m0], [m1, m1]], [[m0, m1], [m1, m1]]];
    // soft well under the finish diamond
    ctx.beginPath(); ctx.arc(mc, mc, c * 2.05, 0, Math.PI * 2);
    var well = ctx.createRadialGradient(mc, mc, c * 0.4, mc, mc, c * 2.1);
    well.addColorStop(0, alpha(mix(b.board, 'b', 0.42), b.dark ? 0.42 : 0.28));
    well.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = well; ctx.fill();
    for (s = 0; s < 4; s++) {
      var t0 = tri[s][0], t1 = tri[s][1];
      // drop shadow under each home triangle
      ctx.beginPath(); ctx.moveTo(t0[0] + 1.2, t0[1] + 1.8); ctx.lineTo(t1[0] + 1.2, t1[1] + 1.8); ctx.lineTo(mc + 0.6, mc + 1.4); ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.lineTo(mc, mc); ctx.closePath();
      var mx = (t0[0] + t1[0]) / 2, my = (t0[1] + t1[1]) / 2;
      var gg = ctx.createLinearGradient(mx, my, mc, mc);
      gg.addColorStop(0, mix(b.seats[s], 'w', 0.34));
      gg.addColorStop(0.4, b.seats[s]);
      gg.addColorStop(1, mix(b.seats[s], 'b', 0.38));
      ctx.fillStyle = gg; ctx.fill();
      ctx.lineWidth = Math.max(1.8, gap * 1.15); ctx.strokeStyle = alpha(mix(b.seats[s], 'b', 0.45), 0.9); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.lineTo(mc, mc); ctx.closePath();
      ctx.clip();
      // edge highlight toward the outer rim
      ctx.strokeStyle = alpha(mix(b.seats[s], 'w', 0.7), 0.55);
      ctx.lineWidth = Math.max(1.4, c * 0.055);
      ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
      // finish chevron pointing into the hub
      var ax = mx * 0.55 + mc * 0.45, ay = my * 0.55 + mc * 0.45;
      var ang = Math.atan2(mc - my, mc - mx);
      ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(c * 0.22, 0); ctx.lineTo(-c * 0.12, -c * 0.16); ctx.lineTo(-c * 0.02, 0); ctx.lineTo(-c * 0.12, c * 0.16);
      ctx.closePath();
      ctx.fillStyle = alpha('#fff', 0.72); ctx.fill();
      ctx.lineWidth = Math.max(1, c * 0.035); ctx.strokeStyle = alpha(mix(b.seats[s], 'b', 0.5), 0.55); ctx.stroke();
      ctx.restore();
    }
    // concentric finish rings + hub badge
    ctx.beginPath(); ctx.arc(mc, mc, c * 0.72, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, c * 0.05); ctx.strokeStyle = alpha(mix(b.board, 'w', 0.25), 0.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(mc, mc, c * 0.52, 0, Math.PI * 2);
    var hub = ctx.createRadialGradient(mc - c * 0.12, mc - c * 0.14, c * 0.04, mc, mc, c * 0.52);
    hub.addColorStop(0, mix(b.board, 'w', 0.22));
    hub.addColorStop(0.55, b.board);
    hub.addColorStop(1, mix(b.board, 'b', 0.28));
    ctx.fillStyle = hub; ctx.fill();
    ctx.lineWidth = Math.max(2, c * 0.06); ctx.strokeStyle = alpha(mix(b.board, 'w', 0.45), 0.65); ctx.stroke();
    ctx.beginPath(); ctx.arc(mc, mc, c * 0.38, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.2, c * 0.04); ctx.strokeStyle = alpha('#fff', 0.18); ctx.stroke();
    ctx.save(); ctx.translate(mc, mc); ctx.rotate(Math.PI / 4);
    for (s = 0; s < 4; s++) {
      var q = c * 0.13;
      var bx = (s % 2 ? 0.06 : -1.06) * q * 1.55, by = (s < 2 ? -1.06 : 0.06) * q * 1.55;
      rr(ctx, bx, by, q * 1.45, q * 1.45, q * 0.28);
      var tg = ctx.createLinearGradient(bx, by, bx + q, by + q);
      tg.addColorStop(0, mix(b.seats[s], 'w', 0.35)); tg.addColorStop(1, mix(b.seats[s], 'b', 0.15));
      ctx.fillStyle = tg; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = alpha('#fff', 0.35); ctx.stroke();
    }
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
  function flatPipsHTML(v) {
    var n = Math.min(6, Math.max(1, v || 1)), h = '';
    for (var k = 0; k < n; k++) h += '<i></i>';
    return h;
  }
  function cubeHTML() {
    // Flat face only — 3D cube removed from paint path (Android WebView blank-tile bug)
    return '<div class="cube" aria-hidden="true" hidden></div><div class="pdice-flat f1" data-face="1">' + flatPipsHTML(1) + '</div>';
  }
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
      die.classList.add('show-flat');
      die.classList.remove('rolling');
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
      for (var i = 0; i < G.st.pieces[s].length; i++) {
        var el = document.createElement('button'); el.type = 'button'; el.className = 'pc';
        var tokNum = i + 1;
        /* Tall classic Ludo pawn (vertical body + rounded head + wider base).
         * Original Crossfour crystal materials. Token Evolution kept. No third-party game artwork. */
        var mat = TOKEN_MAT[s] || TOKEN_MAT[0];
        var evoLv = evoLevelForSeat(s);
        var evoMeta = TOKEN_EVOLUTION ? TOKEN_EVOLUTION.levelOf(evoLv) : { gloss: 1, glow: 1, particles: 0, badge: false, name: 'Basic' };
        var gid = s + '-' + i;
        var badgeHtml = evoMeta.badge
          ? '<span class="evo-badge" data-evo-badge="' + evoLv + '" title="' + evoMeta.name + '" aria-hidden="true">' + (evoLv >= 5 ? '★' : '✦') + '</span>'
          : '';
        /* Silhouette paths (viewBox 0 0 24 36): outer rim + inset crystal body. */
        var pawnOuter = 'M12 1.15C8.05 1.15 4.9 4.15 4.9 7.75c0 2.45 1.35 4.55 3.4 5.7C6.95 14.2 6.2 15.45 6.2 17v4.55c0 1.35-1.35 2.35-2.9 3.4C1.4 26.35.4 28 .6 30.15.85 32.55 4.2 33.9 12 33.9s11.15-1.35 11.4-3.75c.2-2.15-.8-3.8-2.7-5.05-1.55-1.05-2.9-2.05-2.9-3.4V17c0-1.55-.75-2.8-2.1-3.55 2.05-1.15 3.4-3.25 3.4-5.7C19.1 4.15 15.95 1.15 12 1.15Z';
        var pawnBody = 'M12 2.45C8.85 2.45 6.3 4.85 6.3 7.75c0 2.1 1.15 3.9 2.95 4.9-.95.55-1.55 1.55-1.55 2.75v4.35c0 1.05-.95 1.9-2.25 2.8-1.55 1.05-2.35 2.25-2.2 3.85.2 1.85 2.85 2.95 9.75 2.95s9.55-1.1 9.75-2.95c.15-1.6-.65-2.8-2.2-3.85-1.3-.9-2.25-1.75-2.25-2.8V15.4c0-1.2-.6-2.2-1.55-2.75 1.8-1 2.95-2.8 2.95-4.9C17.7 4.85 15.15 2.45 12 2.45Z';
        el.innerHTML = '<i class="jugnu" aria-hidden="true"></i>' + badgeHtml + '<svg class="gem-token" viewBox="0 0 24 36" aria-hidden="true" focusable="false">' +
          '<defs>' +
          '<linearGradient id="gem-metal-' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="var(--pcrim0)"/><stop offset=".42" stop-color="var(--pcrim1)"/><stop offset="1" stop-color="var(--pcrim2)"/></linearGradient>' +
          '<linearGradient id="gem-rim-lit-' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="var(--pcrim0)" stop-opacity=".55"/><stop offset="1" stop-color="var(--pcrim2)" stop-opacity=".9"/></linearGradient>' +
          '<radialGradient id="gem-body-' + gid + '" cx="38%" cy="22%" r="78%">' +
            '<stop offset="0" stop-color="#fff" stop-opacity=".92"/><stop offset=".16" stop-color="var(--pcglassHi)" stop-opacity=".98"/>' +
            '<stop offset=".52" stop-color="var(--pcglassMid)" stop-opacity=".96"/><stop offset="1" stop-color="var(--pcglassLo)" stop-opacity="1"/></radialGradient>' +
          '<linearGradient id="gem-sheen-' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#fff" stop-opacity=".78"/><stop offset=".28" stop-color="#fff" stop-opacity=".22"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>' +
          '<radialGradient id="gem-core-' + gid + '" cx="48%" cy="38%" r="58%">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".22" stop-color="var(--pccore)" stop-opacity="1"/><stop offset=".7" stop-color="var(--pccore)" stop-opacity=".45"/><stop offset="1" stop-color="var(--pccore)" stop-opacity="0"/></radialGradient>' +
          '<radialGradient id="gem-jugnu-' + gid + '" cx="50%" cy="36%" r="58%">' +
            '<stop offset="0" stop-color="#fff" stop-opacity=".88"/><stop offset=".32" stop-color="var(--pccore)" stop-opacity=".6"/><stop offset="1" stop-color="var(--pc)" stop-opacity="0"/></radialGradient>' +
          '<linearGradient id="gem-num-plate-' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="#0c0e12" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".74"/></linearGradient>' +
          '<linearGradient id="gem-collar-' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="var(--pcrim0)"/><stop offset=".5" stop-color="var(--pcrim1)"/><stop offset="1" stop-color="var(--pcrim2)"/></linearGradient>' +
          '</defs>' +
          '<ellipse class="gem-jugnu-glow" style="fill:url(#gem-jugnu-' + gid + ')" cx="12" cy="16" rx="11.4" ry="16.2"/>' +
          '<ellipse class="gem-pad" cx="12" cy="33.35" rx="10.2" ry="2.35"/>' +
          '<ellipse class="gem-shadow" cx="12" cy="33.85" rx="8.6" ry="1.45"/>' +
          '<path class="gem-rim-outer" style="fill:url(#gem-metal-' + gid + ')" d="' + pawnOuter + '"/>' +
          '<path class="gem-rim" style="stroke:url(#gem-rim-lit-' + gid + ')" fill="none" d="' + pawnOuter + '"/>' +
          '<path class="gem-bevel" style="stroke:url(#gem-metal-' + gid + ')" fill="none" d="' + pawnBody + '"/>' +
          '<path class="gem-body" style="fill:url(#gem-body-' + gid + ')" d="' + pawnBody + '"/>' +
          '<path class="gem-sheen" style="fill:url(#gem-sheen-' + gid + ')" d="' + pawnBody + '"/>' +
          '<ellipse class="gem-collar" style="fill:url(#gem-collar-' + gid + ')" cx="12" cy="13.35" rx="5.35" ry="1.55"/>' +
          '<ellipse class="gem-collar-lit" cx="12" cy="12.95" rx="4.55" ry=".85"/>' +
          '<ellipse class="gem-core" style="fill:url(#gem-core-' + gid + ')" cx="12" cy="7.35" rx="3.55" ry="3.7"/>' +
          '<ellipse class="gem-glint-soft" cx="9.6" cy="5.35" rx="2.85" ry="1.85"/>' +
          '<path class="gem-glint" d="M7.2 4.4C8.7 2.85 11.2 2.2 13.3 2.85c-1.55.15-2.9.95-3.8 2.25-.55.85-.8 1.75-.7 2.65L7.2 4.4Z"/>' +
          '<path class="gem-spec" d="M8.15 3.85 11.1 2.7 10.4 4.05 8.55 4.95Z"/>' +
          '<ellipse class="gem-num-disc" style="fill:url(#gem-num-plate-' + gid + ')" cx="12" cy="18.85" rx="3.35" ry="3.55"/>' +
          '<ellipse class="gem-num-bevel" cx="12" cy="18.85" rx="3.35" ry="3.55"/>' +
          '<text class="gem-num-shadow" x="12.35" y="20.45" text-anchor="middle">' + tokNum + '</text>' +
          '<text class="gem-num" x="12" y="20.1" text-anchor="middle">' + tokNum + '</text>' +
          '<text class="gem-num-hi" x="11.7" y="19.75" text-anchor="middle">' + tokNum + '</text>' +
          '<path class="gem-shield" d="' + pawnBody + '"/>' +
          '<path class="gem-shield-glint" d="M7.4 5.6c1.1-2.6 3.4-4 6.2-4.2"/>' +
          '<path class="gem-frost-wash" d="' + pawnBody + '"/>' +
          '<path class="gem-frost-crack" d="m13.9 4.6-1.5 2.4 1.15 1.15-1.7 1.85.95 2-1.65 1.65"/>' +
          '</svg><i class="crown">' + ART.icon('crown', 16) + '</i>';
        el.style.setProperty('--pc', col); el.style.setProperty('--pcl', mix(col, 'w', 0.55)); el.style.setProperty('--pcd', mix(col, 'b', 0.3)); el.style.setProperty('--pcdd', mix(col, 'b', 0.45)); el.style.setProperty('--pccore', CORE_LIGHTS[s]);
        el.style.setProperty('--pcrim0', mat.rim0); el.style.setProperty('--pcrim1', mat.rim1); el.style.setProperty('--pcrim2', mat.rim2);
        el.style.setProperty('--pcglassHi', mat.glassHi); el.style.setProperty('--pcglassMid', mat.glassMid); el.style.setProperty('--pcglassLo', mat.glassLo);
        el.style.setProperty('--evo-gloss', String(evoMeta.gloss));
        el.style.setProperty('--evo-glow', String(evoMeta.glow));
        el.dataset.mat = mat.id; el.dataset.evo = String(evoLv);
        el.style.setProperty('--jugnu-delay', ((s * 0.37 + i * 0.55) % 2.8).toFixed(2) + 's');
        el.dataset.seat = s; el.dataset.piece = i; el.dataset.num = String(tokNum);
        el.setAttribute('aria-label', NAMES[s] + ' token ' + tokNum);
        el.addEventListener('click', function (e) {
          if (e.detail !== 0 || !G || busy || paused || G.st.phase !== 'move' || !isHuman(G.st.turn)) return;
          var seat = +this.dataset.seat, piece = +this.dataset.piece;
          if (handleTokenTap(seat, piece, true)) return;
        });
        box.appendChild(el); pieceEls[s].push(el);
      }
    }
  }
  function center(rc) { var r = L.rot(rc, VIEW()); return { x: (r[1] + 0.5) * CELL, y: (r[0] + 0.5) * CELL }; }
  function place(el, x, y, sc) { el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + (sc || 1) + ')'; }
  function placeToken(s, i, p, sc) { var el = pieceEls[s][i]; if (!el) return; var c = center(L.cellOf(s, p, i)); place(el, c.x, c.y, sc || 1); piecePos[s + '-' + i] = c; }
  var CLUSTER = { 2: [[-0.36, 0.05], [0.36, -0.05]], 3: [[-0.36, -0.3], [0.36, -0.3], [0, 0.36]], 4: [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] };
  function layoutPieces(instant) {
    if (!G) return;
    var st = G.st, groups = {};
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s]) continue;
      for (var i = 0; i < st.pieces[s].length; i++) {
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
        var p = st.pieces[s][i], c = center(L.cellOf(s, p, i)), sc = p === L.HOME ? 1.08 : 1;
        var selected = G.sel != null && !!(G.st.moves || []).some(function (m) { return m.seat === s && m.piece === i && m.v === G.sel; });
        var canMove = !!(G.st.moves || []).some(function (m) { return m.seat === s && m.piece === i; });
        if (n > 1) {
          var off = CLUSTER[Math.min(n, 4)][Math.min(idx, 3)];
          c.x += off[0] * CELL; c.y += off[1] * CELL;
          /* front-most in a stack sits slightly above and higher z so clusters read clearly */
          c.y -= idx * CELL * 0.018;
          sc *= 1 - idx * 0.012;
          el.style.zIndex = String((selected ? 12 : canMove ? 8 : 3) + idx);
        } else {
          el.style.zIndex = '';
        }
        if (p === L.HOME) { c.x += (idx - (n - 1) / 2) * CELL * 0.032; c.y += (idx - (n - 1) / 2) * CELL * 0.032; }
        if (selected) { c.y -= CELL * 0.22; sc *= 1.12; }
        else if (canMove && st.phase === 'move' && st.turn === s) { c.y -= CELL * 0.09; sc *= 1.05; }
        if (instant) { el.style.transition = 'none'; place(el, c.x, c.y, sc); void el.offsetWidth; el.style.transition = ''; }
        else place(el, c.x, c.y, sc);
        el.classList.toggle('done', p === L.HOME);
        var shielded = L.isShielded(st, s, i), frozen = L.isFrozen(st, s, i), king = !!(st.lk && L.isKing(st, s, i));
        el.classList.toggle('shield', shielded); el.classList.toggle('is-shielded', shielded);
        el.classList.toggle('frozen', frozen); el.classList.toggle('is-frozen', frozen);
        el.classList.toggle('king', king); el.classList.toggle('is-king', king);
        el.classList.toggle('sel', selected);
        el.classList.toggle('last', !!(G.lastMove && G.lastMove.seat === s && G.lastMove.piece === i));
        el.classList.toggle('is-turn', !!(G && !G.st.over && G.st.turn === s && st.phase === 'move'));
        piecePos[id] = c;
      });
    });
    layoutTiles();
    layoutTrail();
    if (diePick) placeDiePick(diePick.seat, diePick.piece);
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
    layoutTrail();
  }
  function layoutTrail() {
    var box = $('trail'); if (!box) return;
    box.innerHTML = '';
    var lm = G && G.lastMove; if (!lm || !lm.cells) return;
    var col = seatColor(lm.seat), n = lm.cells.length;
    lm.cells.forEach(function (rc, i) {
      var c = center(rc), e = document.createElement('i');
      var t = (i + 1) / Math.max(1, n);
      e.className = 'trail';
      e.style.background = 'radial-gradient(circle at 32% 28%, ' + rgba(col, 0.88) + ' 0%, ' + rgba(col, 0.42) + ' 55%, ' + rgba(col, 0.1) + ' 100%)';
      e.style.boxShadow = 'inset 0 0 0 1.6px rgba(255,255,255,' + (0.35 + 0.25 * t).toFixed(2) + '), 0 0 12px ' + rgba(col, 0.35 + 0.2 * t) + ', 0 2px 4px rgba(0,0,0,.28)';
      e.style.animationDelay = (i * 0.045) + 's';
      e.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px) scale(' + (0.82 + 0.22 * t).toFixed(3) + ')';
      box.appendChild(e);
    });
  }

  // ---------------- flow control ----------------
  var runToken = 0, timers = [], busy = false, paused = false, keyboardRoll = false;
  var autoRollTk = null, autoRollKey = null, autoRollDeadline = 0, autoRollRemaining = null;
  var moveDecideTk = null, moveDecideTick = null, moveDecideLeft = 0, moveDecideKey = null;
  var diePick = null; // { seat, piece, values: number[] } when a multi-die token picker is open
  var lastTurnFx = -1;
  function later(fn, ms) { var tk = runToken; var id = setTimeout(function () { var k = timers.indexOf(id); if (k >= 0) timers.splice(k, 1); if (tk === runToken) fn(); }, ms); timers.push(id); return id; }
  function cancelFlow() { stopAutoRollTimer(false); stopMoveDecide(false); hideDiePick(); lastTurnFx = -1; runToken++; timers.forEach(function (id) { clearTimeout(id); clearInterval(id); }); timers = []; Object.keys(activeMotions).forEach(function (id) { var motion = activeMotions[id]; if (motion && motion.cancel) motion.cancel(); }); activeMotions = {}; moving = {}; busy = false; keyboardRoll = false; if (G) { G.undo = null; G.actor = null; } hide('wheel'); hide('picker'); hide('choice'); }
  function gameVisible() { return !$('game').classList.contains('hidden') && document.visibilityState === 'visible'; }
  function humans(st) { return st.players.filter(function (s) { return st.seats[s].type === 'human'; }); }
  function hasAI(st) { return st.players.some(function (s) { return st.seats[s].type === 'ai'; }); }
  function isHuman(s) { return G && G.st.seats[s] && G.st.seats[s].type === 'human'; }
  /** Cosmetics: evolution applies to human seats (online: local view only). AI stays Basic. */
  function evoLevelForSeat(s) {
    if (!TOKEN_EVOLUTION || !isHuman(s)) return 1;
    if (G && G.online && G.view != null && s !== G.view) return 1;
    return TOKEN_EVOLUTION.clampLevel(save.tokenEvo || 1);
  }
  function nameOf(s) { var st = G.st; var named = st.seats[s] && st.seats[s].name; if (named) return named; if (st.seats[s].type === 'human' && humans(st).length === 1) return 'You'; return NAMES[s]; }
  function levelOf(s) { var pl = G.st.seats[s]; if (pl.type === 'remote') return 'Online'; return pl.type === 'human' ? (humans(G.st).length === 1 ? 'Lv ' + L.levelFromXp(save.xp).level : 'P' + (humans(G.st).indexOf(s) + 1)) : LEVEL_NAMES[pl.level]; }
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
      var dots = ''; for (var k = 0; k < (st.nPieces || 4); k++) dots += '<i' + (k < home ? ' class="on"' : '') + '></i>';
      if (st.mode === 'team' && rank < 0) dots = '<b class="team t' + L.teamOf(s) + '">' + (L.teamOf(s) ? 'B' : 'A') + '</b>' + dots;
      var lk = st.lk;
      if (rank >= 0) el.querySelector('.plvl').innerHTML = '<span class="prank">' + ['1st', '2nd', '3rd', '4th'][rank] + '</span>';
      else if (lk) el.querySelector('.plvl').innerHTML = luckyMeter(st, s);
      else el.querySelector('.plvl').innerHTML = '<span class="hd">' + dots + '</span>' + levelOf(s);
      var lkb = el.querySelector('.lkb'); if (lkb) lkb.innerHTML = lk && rank < 0 ? luckyBadges(st, s) : '';
      var chips = el.querySelector('.chips'), html = '', selDone = false;
      if (lk && rank < 0 && !(active && st.phase === 'move')) html = luckyPowers(st, s, active);
      if (active) st.queue.forEach(function (v, qi) {
        var usable = st.phase === 'move' && chipMoves(v).length > 0, sel = usable && v === G.sel && !selDone;
        if (sel) selDone = true;
        html += '<button class="chip-v chip-in' + (usable ? '' : ' dim') + (sel ? ' sel' : '') + (v > 6 ? ' dbl' : '') + '" data-v="' + v + '" style="animation-delay:' + (qi * 45) + 'ms">' + v + '</button>';
      });
      chips.innerHTML = html;
      var humanRoll = active && st.phase === 'roll' && isHuman(s) && !busy;
      var dz = el.querySelector('.pdice'); dz.disabled = !humanRoll; dz.classList.toggle('ready', humanRoll);
      // Keep a visible face while idle (and for non-rolling seats during another player's roll)
      // Always keep a visible pip face on corner dice except mid-roll animation for the roller
      var rollingNow = busy && s === (G.actor != null ? G.actor : st.turn) && st.phase === 'roll' && dz.classList.contains('rolling');
      if (!rollingNow) {
        setDiceFace(s, st.faces && st.faces[s] ? st.faces[s] : 1, true);
        dz.classList.add('show-flat');
        dz.classList.remove('rolling');
      }
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
    var s = cur, lbl = $('turn-label'), banner = $('turn-banner');
    if (banner) {
      banner.style.setProperty('--turn-color', seatColor(s));
      banner.classList.toggle('is-live', !over);
      banner.classList.toggle('is-mine', !over && isHuman(s));
    }
    if (!over && !busy) turnChangeFx(s);
    if (over) lbl.innerHTML = 'Match over';
    else {
      var faceV = Math.min(6, Math.max(1, +(st.faces && st.faces[s]) || 1));
      var modeTag = st.mode === 'mystery' ? '<span class="mode-tag">Mystery</span>' : st.mode === 'lucky' ? '<span class="mode-tag lucky">Lucky Chaos</span>' : st.mode === 'quick' ? '<span class="mode-tag">Quick</span>' : st.mode === 'team' ? '<span class="mode-tag">Team</span>' : st.mode === 'arrow' ? '<span class="mode-tag">Arrows</span>' : st.mode === 'friendly' ? '<span class="mode-tag">Friendly</span>' : '';
      var who = isHuman(s) ? (nameOf(s) === 'You' ? 'Your turn' : NAMES[s] + "'s turn") : NAMES[s] + ' is playing';
      // Banner die: always show last/current face with pips (never a blank seat-color circle)
      lbl.innerHTML = '<span class="banner-die f' + faceV + '" data-face="' + faceV + '" style="--pc:' + seatColor(s) + '" aria-label="Die showing ' + faceV + '">' + flatPipsHTML(faceV) + '</span><span class="turn-who">' + who + '</span>' + modeTag;
    }
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
  function clearHighlights() { each(document.querySelectorAll('.pc.can, .pc.sel'), function (e) { e.classList.remove('can'); e.classList.remove('sel'); }); }
  function highlight() {
    clearHighlights();
    var st = G.st; if (st.phase !== 'move' || !isHuman(st.turn) || busy) return;
    var ms = G.sel != null ? chipMoves(G.sel) : st.moves;
    ms.forEach(function (m) { var el = pieceEls[m.seat][m.piece]; if (!el) return; el.classList.add('can'); if (G.sel != null && m.v === G.sel) el.classList.add('sel'); });
  }
  function focusTurnControl() {
    if (!G || busy || paused || !isHuman(G.st.turn)) return;
    var target = null;
    if (G.st.phase === 'roll') { var pod = podEl(G.st.turn); target = pod && pod.querySelector('.pdice'); }
    else if (G.st.phase === 'move') target = document.querySelector('#pieces .pc.can');
    if (target && !target.disabled) target.focus();
  }
  // ---------------- token die picker (multi stacked rolls) ----------------
  function tokenDieMoves(seat, piece) {
    var seen = {}, out = [];
    (G.st.moves || []).forEach(function (m) {
      if (m.seat !== seat || m.piece !== piece || seen[m.v]) return;
      seen[m.v] = 1; out.push(m);
    });
    out.sort(function (a, b) { return b.v - a.v; });
    return out;
  }
  function hideDiePick() {
    diePick = null;
    var el = $('token-die-pick');
    if (el) { el.classList.add('hidden'); el.innerHTML = ''; el.removeAttribute('data-seat'); el.removeAttribute('data-piece'); }
    each(document.querySelectorAll('.pc.picking'), function (e) { e.classList.remove('picking'); });
  }
  function placeDiePick(seat, piece) {
    var el = $('token-die-pick'), pos = piecePos[seat + '-' + piece];
    if (!el || !pos) return;
    el.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + (pos.y - CELL * 0.72).toFixed(1) + 'px)';
  }
  function showDiePick(seat, piece, moves) {
    var el = $('token-die-pick'); if (!el) return;
    hideDiePick();
    diePick = { seat: seat, piece: piece, values: moves.map(function (m) { return m.v; }) };
    var html = '<div class="token-die-card" role="group" aria-label="Choose die number for this token">';
    moves.forEach(function (m) {
      html += '<button type="button" class="token-die-v" data-v="' + m.v + '" aria-label="Move with ' + m.v + '">' + m.v + '</button>';
    });
    html += '<button type="button" class="token-die-x" aria-label="Cancel">×</button></div>';
    el.innerHTML = html;
    el.dataset.seat = seat; el.dataset.piece = piece;
    el.classList.remove('hidden');
    placeDiePick(seat, piece);
    var tok = pieceEls[seat] && pieceEls[seat][piece]; if (tok) tok.classList.add('picking');
    $('hint').textContent = 'Pick ' + moves.map(function (m) { return m.v; }).join(' or ') + ' for this token';
  }
  function handleTokenTap(seat, piece, keyboard) {
    if (!G || busy || paused || G.st.phase !== 'move' || !isHuman(G.st.turn) || G.online) return false;
    var opts = tokenDieMoves(seat, piece);
    if (!opts.length) return false;
    // Multi-die for this token: open the premium picker (overrides chip selection).
    if (opts.length > 1) {
      SFX.click();
      if (diePick && diePick.seat === seat && diePick.piece === piece) { hideDiePick(); return true; }
      showDiePick(seat, piece, opts);
      return true;
    }
    // Single legal value: spend the selected chip if it matches, otherwise that only value.
    if (G.sel != null && chipMoves(G.sel).some(function (m) { return m.seat === seat && m.piece === piece; })) {
      hideDiePick(); SFX.unlock(); doMove(piece, G.sel, !!keyboard); return true;
    }
    hideDiePick(); SFX.unlock(); doMove(opts[0].piece, opts[0].v, !!keyboard); return true;
  }

  // ---------------- 4s move decision countdown ----------------
  function setMoveCountdownVisual(n) {
    var el = $('move-countdown'); if (!el) return;
    if (n == null || n <= 0) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = String(n);
    el.classList.remove('hidden');
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  }
  function stopMoveDecide(keepVisual) {
    if (moveDecideTk) {
      clearTimeout(moveDecideTk);
      var k = timers.indexOf(moveDecideTk); if (k >= 0) timers.splice(k, 1);
      moveDecideTk = null;
    }
    if (moveDecideTick) {
      clearInterval(moveDecideTick);
      var k2 = timers.indexOf(moveDecideTick); if (k2 >= 0) timers.splice(k2, 1);
      moveDecideTick = null;
    }
    moveDecideLeft = 0; moveDecideKey = null;
    if (!keepVisual) setMoveCountdownVisual(null);
  }
  function autoPlayBestMove() {
    if (!G || busy || paused || G.online || G.st.phase !== 'move' || !isHuman(G.st.turn)) return;
    hideDiePick();
    var c = L.bestAutoMove(G.st, 'hard');
    if (!c) return;
    toast('Auto-play · ' + c.v, 900);
    doMove(c.piece, c.v);
  }
  function startMoveDecide() {
    var st = G && G.st;
    stopMoveDecide(false);
    if (!st || G.online || st.phase !== 'move' || !isHuman(st.turn) || busy || paused || tutorial.intro || !gameVisible() || isOpen('confirm')) return;
    var key = st.turn + ':' + st.rolls + ':' + st.turnCount + ':' + (st.queue || []).join(',');
    moveDecideKey = key;
    moveDecideLeft = 4;
    setMoveCountdownVisual(4);
    var tk = runToken;
    moveDecideTick = setInterval(function () {
      if (tk !== runToken || !G || busy || paused || G.st.phase !== 'move' || !isHuman(G.st.turn) || moveDecideKey !== key) { stopMoveDecide(false); return; }
      moveDecideLeft -= 1;
      if (moveDecideLeft >= 1) setMoveCountdownVisual(moveDecideLeft);
      else setMoveCountdownVisual(null);
    }, 1000);
    timers.push(moveDecideTick);
    moveDecideTk = later(function () {
      moveDecideTk = null;
      if (moveDecideTick) { clearInterval(moveDecideTick); var k = timers.indexOf(moveDecideTick); if (k >= 0) timers.splice(k, 1); moveDecideTick = null; }
      setMoveCountdownVisual(null);
      if (!G || busy || paused || !gameVisible() || isOpen('confirm') || G.st.phase !== 'move' || !isHuman(G.st.turn) || moveDecideKey !== key) return;
      moveDecideKey = null;
      autoPlayBestMove();
    }, MOVE_DECIDE_MS);
  }

  function offerMoves() {
    var st = G.st; if (st.phase !== 'move' || !isHuman(st.turn)) return;
    hideDiePick();
    render(); highlight();
    if (keyboardRoll) { var target = document.querySelector('#pieces .pc.can'); if (target) target.focus(); keyboardRoll = false; }
    var distinct = L.distinctMoves(st.moves);
    if (save.settings.auto && distinct.length === 1 && !undoActive()) { var m = distinct[0]; later(function () { doMove(m.piece, m.v); }, save.settings.fast ? 220 : 420); return; }
    startTimer(); // optional 20s setting (legacy); 4s decide always runs below for offline humans
    startMoveDecide();
  }

  // ---------------- turn timer (optional) ----------------
  function startTimer() {
    var st = G.st, s = st.turn, el = podEl(s);
    stopTimer();
    if (G.online || !save.settings.timer || !isHuman(s) || st.phase !== 'move' || !el) return;
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
    if (G.online) { render(); highlight(); paintOnlineChrome(); return; }
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
    var n = Math.min(6, Math.max(1, +v || 1)), pod = podEl(s), die = pod && pod.querySelector('.pdice'), flat = pod && pod.querySelector('.pdice-flat');
    if (!flat && !die) return;
    if (spins[s] > 20) spins[s] = spins[s] % 4;
    // Flat pips only — cream face is painted on .pdice itself (WebView-safe, no 3D/filter)
    if (flat) {
      flat.dataset.face = String(n);
      flat.className = 'pdice-flat f' + n;
      flat.innerHTML = flatPipsHTML(n);
    }
    if (die) {
      die.classList.add('show-flat');
      die.dataset.face = String(n);
      die.setAttribute('aria-label', 'Die showing ' + n + '. Tap or swipe to roll.');
    }
    if (pod) pod.dataset.face = String(n);
  }
  function prefersReducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function diceBtn(s) { var p = podEl(s); return p ? p.querySelector('.pdice') : null; }
  function animateDice(s, v, cb) {
    var die = diceBtn(s), reduced = prefersReducedMotion(), dur = reduced ? 0 : save.settings.fast ? 560 : 980;
    spins[s]++;
    // Classes MUST live on .pdice (CSS targets .pdice.rolling / .pdice.show-flat), never on .pod
    if (die) {
      die.classList.remove('rolling');
      die.classList.add('show-flat');
      if (!reduced) { void die.offsetWidth; die.classList.add('rolling'); }
    }
    // Flat-only tumble: flicker pips during toss, settle on final face (no 3D cube / filter on WebView)
    var flickId = null;
    if (!reduced) {
      var tick = 0;
      flickId = setInterval(function () {
        tick++;
        setDiceFace(s, 1 + ((tick * 3 + spins[s]) % 6), true);
      }, 72);
      timers.push(flickId);
    } else {
      setDiceFace(s, v, true);
    }
    SFX.roll();
    later(function () {
      if (flickId != null) {
        clearInterval(flickId);
        var k = timers.indexOf(flickId); if (k >= 0) timers.splice(k, 1);
      }
      if (die) { die.classList.remove('rolling'); die.classList.add('show-flat'); }
      setDiceFace(s, v, true);
      SFX.land(v === 6); haptic(v === 6 ? 'medium' : 'light');
      if (v === 6) sixFlourish(s);
      cb();
    }, dur);
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
    if (G.online) {
      if (isHuman(G.st.turn) && onlineHooks && onlineHooks.onRoll) onlineHooks.onRoll();
      return;
    }
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
    if (!save.settings.undo) return;
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

  // ---------------- effects (WebView-safe: transform/opacity; respects reduced motion) ----------------
  function fxOk() { return !prefersReducedMotion(); }
  function fxEl(cls, x, y) { var e = document.createElement('i'); e.className = cls; e.style.left = x + 'px'; e.style.top = y + 'px'; $('fx').appendChild(e); return e; }
  function burst(x, y, col, n) {
    if (!fxOk()) return;
    n = Math.min(n || 12, 22);
    for (var k = 0; k < n; k++) {
      var e = fxEl('burst', x, y), a = k / n * Math.PI * 2 + Math.random() * 0.35, d = CELL * (0.9 + Math.random() * 1.35);
      e.style.background = col; e.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px'); e.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      if (k % 3 === 0) e.classList.add('burst-star');
      setTimeout(function (el) { el.remove(); }.bind(null, e), 780);
    }
  }
  function ring(x, y, col, cls) {
    if (!fxOk()) return;
    var e = fxEl('ring' + (cls ? ' ' + cls : ''), x, y); e.style.setProperty('--rc', col);
    setTimeout(function () { e.remove(); }, 700);
  }
  function floatAt(x, y, txt, cls) {
    var e = document.createElement('div'); e.className = 'float' + (cls ? ' ' + cls : '');
    e.style.left = x + 'px'; e.style.top = y + 'px'; e.textContent = txt; $('fx').appendChild(e);
    setTimeout(function () { e.remove(); }, cls && cls.indexOf('big') >= 0 ? 1400 : 1100);
  }
  function bolt(x, y) { if (!fxOk()) return; var e = fxEl('bolt', x, y); e.innerHTML = ART.icon('zap', 40); setTimeout(function () { e.remove(); }, 700); }
  function iconPop(x, y, id, cls) { if (!fxOk()) return; var e = fxEl('iconpop ' + (cls || ''), x, y); e.innerHTML = ART.icon(id, 30); setTimeout(function () { e.remove(); }, 900); }
  function shake() { if (!fxOk()) return; var w = $('board-wrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }
  /** Stronger kill/capture FX (~0.5–0.8s): impact shockwave + settle glow; transform/opacity only. */
  function killBurst(x, y, attackerCol, victimCol) {
    if (!fxOk()) return;
    burst(x, y, victimCol || attackerCol, 26);
    burst(x, y, attackerCol, 16);
    for (var i = 0; i < 12; i++) {
      var drop = fxEl('burst burst-splash', x, y), a = i / 12 * Math.PI * 2 + 0.15, d = CELL * (0.75 + (i % 4) * 0.32);
      drop.style.background = i % 2 ? attackerCol : (victimCol || attackerCol);
      drop.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      drop.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      setTimeout(function (el) { el.remove(); }.bind(null, drop), 820);
    }
    ring(x, y, attackerCol, 'ring-shock');
    ring(x, y, '#fff', 'ring-shock ring-shock-outer');
    var flash = fxEl('kill-flash', x, y); flash.style.setProperty('--rc', attackerCol);
    var splash = fxEl('kill-splash', x, y); splash.style.setProperty('--rc', attackerCol);
    var settle = fxEl('kill-settle', x, y); settle.style.setProperty('--rc', attackerCol);
    setTimeout(function () { flash.remove(); }, 520);
    setTimeout(function () { splash.remove(); }, 700);
    setTimeout(function () { settle.remove(); }, 820);
  }
  /** Six-roll flourish: pop + glow on die, stack chips animate in via render. */
  function sixFlourish(seat) {
    if (!fxOk()) return;
    var die = diceBtn(seat), pod = podEl(seat);
    if (die) {
      die.classList.remove('six-pop', 'six-glow'); void die.offsetWidth;
      die.classList.add('six-pop', 'six-glow');
      later(function () { if (die) die.classList.remove('six-pop', 'six-glow'); }, 1600);
    }
    if (pod) {
      var r = pod.getBoundingClientRect(), br = $('board-wrap').getBoundingClientRect();
      var x = r.left + r.width / 2 - br.left, y = r.top + r.height / 2 - br.top;
      burst(x, y, seatColor(seat), 14);
      burst(x, y, '#ffd24a', 6);
      floatAt(x, y - 18, '6!', 'float-six');
    }
  }
  /** Safe-square landing pulse + sparkles under the token. */
  function safePulse(x, y, col) {
    if (!fxOk()) return;
    var c = col || '#fff';
    var e = fxEl('safe-pulse', x, y); e.style.setProperty('--rc', c);
    setTimeout(function () { e.remove(); }, 700);
    for (var k = 0; k < 7; k++) {
      var sp = fxEl('safe-spark', x, y), ang = k / 7 * Math.PI * 2, d = CELL * (0.45 + (k % 3) * 0.18);
      sp.style.setProperty('--rc', k % 2 ? c : '#fff6c8');
      sp.style.setProperty('--dx', (Math.cos(ang) * d).toFixed(1) + 'px');
      sp.style.setProperty('--dy', (Math.sin(ang) * d).toFixed(1) + 'px');
      setTimeout(function (el) { el.remove(); }.bind(null, sp), 750);
    }
  }
  /** Arrow jump whoosh + stronger trail along the jump path. */
  function arrowWhoosh(seat, piece, path) {
    if (!fxOk() || !path || path.length < 2) return;
    var jump = L.ARROW_JUMP || 4;
    var from = center(L.cellOf(seat, path[path.length - 1 - jump], piece));
    var to = center(L.cellOf(seat, path[path.length - 1], piece));
    var col = seatColor(seat), dx = to.x - from.x, dy = to.y - from.y;
    function streak(cls, delay) {
      var e = fxEl('arrow-whoosh' + (cls ? ' ' + cls : ''), from.x, from.y);
      e.style.setProperty('--rc', col);
      e.style.setProperty('--wx', dx.toFixed(1) + 'px');
      e.style.setProperty('--wy', dy.toFixed(1) + 'px');
      if (delay) e.style.animationDelay = delay + 'ms';
      setTimeout(function () { e.remove(); }, 700);
    }
    streak('', 0); streak('trail', 40);
    for (var t = 1; t <= 5; t++) {
      var u = t / 6, dot = fxEl('arrow-trail-dot', from.x + dx * u, from.y + dy * u);
      dot.style.setProperty('--rc', col);
      dot.style.setProperty('--dx', (dx * 0.12).toFixed(1) + 'px');
      dot.style.setProperty('--dy', (dy * 0.12).toFixed(1) + 'px');
      setTimeout(function (el) { el.remove(); }.bind(null, dot), 620);
    }
    ring(to.x, to.y, col, 'ring-whoosh');
    burst(to.x, to.y, col, 8);
  }
  /** Yard exit flourish when a token leaves base. */
  function yardExitFx(seat, at) {
    if (!fxOk() || !at) return;
    var col = seatColor(seat), x = at.x, y = at.y;
    var flash = fxEl('yard-burst', x, y); flash.style.setProperty('--rc', col);
    ring(x, y, col, 'ring-yard');
    burst(x, y, col, 10);
    floatAt(x, y - CELL * 0.55, 'Out!', 'float-yard');
    setTimeout(function () { flash.remove(); }, 650);
  }
  /** Tiny hop sparkles at each step landing. Extra particles scale with Token Evolution. */
  function hopStepFx(x, y, col, evoParticles) {
    if (!fxOk()) return;
    var extra = Math.max(0, Math.min(5, evoParticles | 0));
    var n = 3 + extra;
    for (var k = 0; k < n; k++) {
      var sp = fxEl('hop-spark' + (extra ? ' evo-spark' : ''), x, y);
      var a = -Math.PI / 2 + (k - (n - 1) / 2) * (0.55 + extra * 0.04);
      var d = CELL * (0.28 + (k % 3) * 0.04 + extra * 0.02);
      sp.style.setProperty('--rc', k % 3 === 1 ? '#fff' : (col || '#fff'));
      sp.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      sp.style.setProperty('--dy', (Math.sin(a) * d - 4).toFixed(1) + 'px');
      setTimeout(function (el) { el.remove(); }.bind(null, sp), 420 + extra * 40);
    }
  }
  /** Home-stretch / finish-lane sparkles while a token climbs the column. */
  function homeLaneFx(x, y, col, finish) {
    if (!fxOk()) return;
    var c = col || '#ffd24a', n = finish ? 10 : 5;
    for (var k = 0; k < n; k++) {
      var sp = fxEl('lane-spark', x, y), a = k / n * Math.PI * 2, d = CELL * (0.35 + (k % 3) * 0.12);
      sp.style.setProperty('--rc', k % 2 ? c : '#fff6c8');
      sp.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
      sp.style.setProperty('--dy', (Math.sin(a) * d - (finish ? 6 : 2)).toFixed(1) + 'px');
      setTimeout(function (el) { el.remove(); }.bind(null, sp), 780);
    }
    if (finish) ring(x, y, c, 'ring-home-gold');
  }
  /** Token reaches home — mini celebration. */
  function homeCelebrate(seat, at) {
    if (!fxOk()) return;
    var col = seatColor(seat), x = at ? at.x : 7.5 * CELL, y = at ? at.y : 7.5 * CELL;
    burst(x, y, col, 22);
    burst(x, y, '#ffd24a', 10);
    ring(x, y, col, 'ring-home');
    ring(x, y, '#ffd24a', 'ring-home-gold');
    floatAt(x, y - CELL * 0.7, 'Home!', 'float-home');
    homeLaneFx(x, y, col, true);
    for (var k = 0; k < 8; k++) {
      var sp = fxEl('home-spark', x, y);
      sp.style.setProperty('--dx', ((k % 2 ? 1 : -1) * (12 + k * 7)) + 'px');
      sp.style.setProperty('--dy', (-18 - k * 10) + 'px');
      sp.style.background = k % 2 ? col : '#ffe08a';
      setTimeout(function (el) { el.remove(); }.bind(null, sp), 900);
    }
  }
  /** Smooth turn-change flash on the turn banner / active seat pulse. */
  function turnChangeFx(seat) {
    if (!fxOk() || seat == null || seat === lastTurnFx) return;
    lastTurnFx = seat;
    var banner = $('turn-banner');
    if (banner) { banner.classList.remove('turn-swap'); void banner.offsetWidth; banner.classList.add('turn-swap'); later(function () { if (banner) banner.classList.remove('turn-swap'); }, 650); }
    var pod = podEl(seat);
    if (pod) {
      pod.classList.remove('turn-arrive', 'turn-pulse'); void pod.offsetWidth;
      pod.classList.add('turn-arrive', 'turn-pulse');
      pod.style.setProperty('--pc', seatColor(seat));
      later(function () { if (pod) pod.classList.remove('turn-arrive', 'turn-pulse'); }, 900);
      var av = pod.querySelector('.avatar');
      if (av) {
        var r = av.getBoundingClientRect(), br = $('board-wrap').getBoundingClientRect();
        ring(r.left + r.width / 2 - br.left, r.top + r.height / 2 - br.top, seatColor(seat), 'ring-seat');
      }
    }
  }

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
        el: el, start: origin, points: points, duration: stepMs(), arcHeight: CELL * 0.42,
        reducedMotion: prefersReducedMotion(),
        onStep: function (k) {
          piecePos[id] = points[k];
          if (!prefersReducedMotion()) {
            el.classList.remove('land'); void el.offsetWidth; el.classList.add('land');
            hopStepFx(points[k].x, points[k].y, seatColor(s), evoLevelForSeat(s) > 1 && TOKEN_EVOLUTION ? TOKEN_EVOLUTION.levelOf(evoLevelForSeat(s)).particles : 0);
            if (from < 0 && k === 0) yardExitFx(s, points[k]);
            var stepPos = path[k];
            if (stepPos >= L.COL0 && stepPos < L.HOME) homeLaneFx(points[k].x, points[k].y, seatColor(s), false);
          }
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
    caps.forEach(function (cp) { killBurst(at.x, at.y, seatColor(s), seatColor(cp.seat)); sendToBase(cp.seat, cp.piece); });
    floatAt(at.x, at.y - CELL * 0.6, caps.length > 1 ? 'Captures!' : 'Captured!', 'float-kill');
    shake();
    SFX.capture(); haptic('heavy');
  }

  function doMove(piece, v, keyboard) {
    if (!G || busy || G.st.phase !== 'move' || paused) return;
    if (G.online) {
      if (!isHuman(G.st.turn) || !onlineHooks || !onlineHooks.onMove) return;
      var q = G.st.queue || [], idx = q.indexOf(v);
      if (idx < 0) return;
      onlineHooks.onMove(piece, idx);
      return;
    }
    var st = G.st, s = st.turn, human = isHuman(s);
    if (!st.moves.some(function (m) { return m.piece === piece && (v == null || m.v === v); })) return;
    busy = true; G.actor = s; clearHighlights(); closeUndo(); stopTimer(); stopAutoRollTimer(false); stopMoveDecide(false); hideDiePick(); hide('chat');
    var res = L.move(st, piece, v, forcedEvents.length ? forcedEvents.shift() : undefined);
    if (human) { save.stats.captures += res.captures.length; if (res.finish) save.stats.home++; if (res.event) save.stats.events++; }
    G.sel = null;
    G.lastMove = { seat: s, piece: piece, cells: res.path.map(function (pp) { return L.cellOf(s, pp, piece); }) };
    render(); persist();
    animatePath(s, piece, res.from, res.path, function () {
      var c = piecePos[s + '-' + piece] || { x: 0, y: 0 }, pause = 260;
      if (res.arrowJump) { arrowWhoosh(s, piece, res.path); pause = Math.max(pause, 480); }
      if (res.entersHomeColumn || (res.to >= L.COL0 && res.to < L.HOME)) { homeLaneFx(c.x, c.y, seatColor(s), !!res.finish); pause = Math.max(pause, 360); }
      if (!res.finish && !res.captures.length && L.onTrack(res.to) && st.rules.safeSquares && L.isSafeAbs(L.absOf(s, res.to))) {
        safePulse(c.x, c.y, seatColor(s));
      }
      if (res.captures.length) {
        pause = 820; captureFx(s, res.captures, c);
        if (res.captures.some(function (cp) { return isHuman(cp.seat); }) && !human) setTimeout(function () { SFX.captured(); }, 250);
        aiReact('capture', s, res.captures);
      }
      if (res.finish) {
        pause = Math.max(pause, 900);
        homeCelebrate(s, { x: 7.5 * CELL, y: 7.5 * CELL });
        if (res.finishedPlayer) floatAt(7.5 * CELL, 6.2 * CELL, NAMES[s] + ' finished!', 'float-home big');
        SFX.home(); haptic('success'); if (!human) aiReact('home', s);
      }
      if (res.stride) floatAt(c.x, c.y + CELL * 0.7, 'King +1');
      if (res.kingCaptured) { pause = Math.max(pause, 900); toast(nameOf(s) + ' toppled a King! +2 Lucky Charge', 1600); later(function () { SFX.mega(); }, 300); }
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
    cancelFlow(); stopCelebration();
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
      if (st.mode === 'team') {
        var winT = L.teamOf(st.ranking[0]);
        best = hs.some(function (s) { return L.teamOf(s) === winT; }) ? 1 : 2;
      } else hs.forEach(function (s) { best = Math.min(best, st.ranking.indexOf(s) + 1); });
      G.moves = st.moveCount || 0; G.elapsed = Math.max(0, Date.now() - (G.started || Date.now()));
      var ai = st.players.filter(function (s) { return st.seats[s].type === 'ai'; }).map(function (s) { return st.seats[s].level; });
      G.place = best; G.coins = L.coinsFor(best, st.players.length, ai, st.mode); G.xp = L.xpFor(best, st.players.length);
      save.coins += G.coins; save.xp += G.xp;
      var S = save.stats; S.played++;
      if (best === 1) { S.won++; S.streak = safeCounter(S.streak, 0) + 1; } else S.streak = 0;
      if (ai.length) { var top = ai.indexOf('hard') >= 0 ? 'hard' : ai.indexOf('medium') >= 0 ? 'medium' : 'easy'; S.vs[top][0]++; if (best === 1) S.vs[top][1]++; } else S.pass++;
      if (st.mode === 'mystery') { S.mystery[0]++; if (best === 1) S.mystery[1]++; }
      if (st.mode === 'lucky') { S.lucky[0]++; if (best === 1) S.lucky[1]++; }
      ['quick', 'team', 'arrow', 'friendly'].forEach(function (m) { if (st.mode === m) { S[m][0]++; if (best === 1) S[m][1]++; } });
      if (st.players.length === 2) { S.duel[0]++; if (best === 1) S.duel[1]++; } else if (st.players.length === 4) { S.four[0]++; if (best === 1) S.four[1]++; }
      var previousBoards = save.owned.boards.slice(), previousDice = save.owned.dice.slice();
      var previousEvoU = save.tokenEvoUnlocked, previousEvo = save.tokenEvo;
      var newlyUnlocked = window.SkinShop.collectEligible(save, SK);
      var evoGranted = TOKEN_EVOLUTION ? TOKEN_EVOLUTION.collectEligible(save) : [];
      gate.matchCompleted();
      if (!persist()) {
        save.owned.boards = previousBoards; save.owned.dice = previousDice;
        save.tokenEvoUnlocked = previousEvoU; save.tokenEvo = previousEvo;
      } else {
        var notes = [];
        if (newlyUnlocked.length) notes.push('Achievement unlocked: ' + newlyUnlocked.map(function (x) { return x.name; }).join(', '));
        if (evoGranted.length) notes.push('Token Evolution: ' + evoGranted.map(function (x) { return 'Lv' + x.level + ' ' + x.name; }).join(', '));
        if (notes.length) toast(notes.join(' · '), 3200);
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
  /** v1.6.3 Gulaab Camel: an original cartoon camel trots to the winner's seat and showers rose petals (cosmetic only). */
  function celebrateWin(seat) {
    var C = window.CamelCelebration;
    if (!C || !G || seat == null || !G.st.seats[seat]) return;
    var pod = podEl(seat);
    if (!pod) return;
    try {
      C.play({ target: pod, anchor: pod.querySelector('.avatar') || pod, color: seatColor(seat), seat: seat, reduced: prefersReducedMotion() });
    } catch (error) {
      if (window.console && console.warn) console.warn('Win celebration skipped.', error);
    }
  }
  function stopCelebration() { if (window.CamelCelebration) window.CamelCelebration.stop(); }
  function showResult() {
    var st = G.st, hs = humans(st), single = hs.length === 1, winner = st.ranking[0];
    var entering = !isOpen('result');
    var teamWin = st.mode === 'team', tName = function (seat) { return L.teamOf(seat) ? 'Jade & Cobalt' : 'Coral & Saffron'; };
    $('r-title').textContent = teamWin ? (tName(winner) + ' win') : single ? (G.place === 1 ? 'You win!' : ['', '', '2nd place', '3rd place', '4th place'][G.place] || 'Match over') : NAMES[winner] + ' wins!';
    var MODE_KICK = { mystery: 'MYSTERY TILES · ', lucky: 'LUCKY CHAOS LUDO · ', quick: 'QUICK LUDO · ', team: 'TEAM LUDO · ', arrow: 'Arrow Ludo: 1 token starts on the board. Jump +4 only if the die move ends on an arrow — passing over is normal Ludo.', friendly: 'FRIENDLY · ' };
    $('r-kicker').textContent = (MODE_KICK[st.mode] || '') + (hasAI(st) ? 'VS COMPUTER' : 'PASS & PLAY');
    var sec = Math.round((G.elapsed || 0) / 1000), mm = Math.floor(sec / 60), ss = sec % 60;
    $('r-meta').textContent = (G.moves || 0) + ' moves · ' + mm + ':' + (ss < 10 ? '0' : '') + ss;
    $('r-rank').innerHTML = st.ranking.map(function (s, k) {
      return '<li class="rank-row ' + (isHuman(s) ? 'me ' : '') + (k === 0 ? 'winner' : '') + '" style="--winner-color:' + seatColor(s) + ';--rank-delay:' + (k * 90) + 'ms"><span class="medal m' + (k + 1) + '">' + (k + 1) + '</span><span class="pdot" style="background:' + seatColor(s) + '"></span>' + nameOf(s) +
        '<small>' + levelOf(s) + (st.seats[s].type === 'ai' ? ' AI' : '') + ' · ' + st.pieces[s].filter(function (p) { return p === L.HOME; }).length + '/' + (st.nPieces || 4) + ' home</small></li>';
    }).join('');
    $('r-coins').textContent = '+' + (G.coins * (G.doubled ? 2 : 1));
    $('r-xp').textContent = '+' + G.xp;
    var lv = L.levelFromXp(save.xp); $('r-lvl').textContent = 'Level ' + lv.level; $('r-lvl-fill').style.width = Math.round(lv.into / lv.need * 100) + '%';
    $('btn-r-double').classList.toggle('hidden', !G.coins || G.doubled);
    if (entering) { if (G.place === 1 || !single) SFX.win(); else SFX.lose(); haptic(G.place === 1 ? 'success' : 'light'); }
    render(); setCoins(); setLevel(); show('result');
    if (entering) { spotlightWinner(winner); celebrateWin(winner); }
  }
  /** The ONLY place an interstitial may appear: leaving the result screen after a finished match. */
  function leaveResult(dest) {
    if (!G || G.st.phase !== 'over') return;
    stopCelebration();
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
    cancelFlow(); stopTimer(); paused = false; stopCelebration();
    ['result', 'menu', 'chat'].forEach(hide);
    $('tutorial-intro').classList.add('hidden'); $('tutorial-coach').classList.add('hidden');
    screen('home'); updateHome(); setCoins(); setLevel();
  }
  function updateHome() {
    var cont = G && G.st.phase !== 'over';
    $('btn-continue').classList.toggle('hidden', !cont);
    if (cont) { var st = G.st; $('continue-sub').textContent = (st.mode === 'mystery' ? 'Mystery Tiles · ' : st.mode === 'lucky' ? 'Lucky Chaos Ludo · ' : st.mode === 'quick' ? 'Quick Ludo · ' : st.mode === 'team' ? 'Team Ludo · ' : st.mode === 'arrow' ? 'Arrow Ludo · ' : st.mode === 'friendly' ? 'Friendly · ' : '') + (hasAI(st) ? 'vs Computer' : 'Pass & Play') + ' · ' + st.players.length + ' players'; }
  }
  var setupKind = 'ai', setupMode = 'classic';
  function showSetup(kind, mode) {
    setupKind = kind; setupMode = mode || save.setup.mode[kind] || 'classic'; screen('setup');
    var TITLES = { mystery: 'Mystery Tiles', lucky: 'Lucky Chaos Ludo', quick: 'Quick Ludo', team: 'Team Ludo', arrow: 'Arrow Ludo', friendly: 'Friendly Ludo' };
    $('setup-title').textContent = TITLES[setupMode] || (kind === 'ai' ? 'Play vs Computer' : 'Pass & Play');
    renderSetup();
  }
  function rulesSummary() {
    var r = save.rules, out = [r.rollStyle === 'star' ? 'Star style: 6s stack' : 'Classic: move each 6 first'];
    out.push(r.safeSquares ? 'safe squares' : 'no safe squares');
    if (r.captureToEnter) out.push('capture to enter home');
    if (r.blocks) out.push('blocks');
    if (!r.bonusOnCapture) out.push('no capture bonus');
    if (!r.bonusOnHome) out.push('no home bonus');
    if (r.arrows) out.push('arrow tiles');
    if (r.noCapture) out.push('no captures');
    return out;
  }
  function renderSetup() {
    var seats = save.setup[setupKind], list = $('seat-list'); list.innerHTML = '';
    each($('mode-seg').children, function (b) { var selected = b.dataset.mode === setupMode; b.classList.toggle('on', selected); b.setAttribute('aria-pressed', selected ? 'true' : 'false'); });
    var NOTES = {
      mystery: 'Mystery Tiles: ? and ! tiles on the track spin a wheel of events (shield, jump, swap, zap, freeze…). No stakes: every match is free.',
      lucky: 'Lucky Chaos Ludo: Boost & Chaos wheels, Danger tiles, Lucky Streaks, Revenge, a Mega Wheel and King tokens. Pure fun, no stakes: every match is free.',
      quick: 'Quick Ludo: 2 tokens each on the normal board. Same rules (6 to leave base, exact home, safe squares) so matches finish much faster. 1 v 1 or more.',
      team: 'Team Ludo, 2v2. Partners sit opposite: Coral with Saffron, Jade with Cobalt. A team wins when both partners have every token home. You cannot capture your partner.',
      arrow: 'Arrow Ludo: 1 starter token out. Exact land on amber arrow → jump +4. The 3 red squares after each arrow are the danger zone: rivals there get hit by the jump. Passing over an arrow is normal movement.',
      friendly: 'Friendly: captures are off. It is a pure race home. The app stays 13+.'
    };
    $('mode-note').textContent = NOTES[setupMode] || 'Classic Ludo on a clean board.';
    $('btn-howto').classList.toggle('hidden', ['lucky', 'quick', 'team', 'arrow', 'friendly'].indexOf(setupMode) < 0);
    $('btn-howto').textContent = setupMode === 'lucky' ? 'How to play Lucky Chaos Ludo' : 'How to play this mode';
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
    var msg = setupMode === 'team' && n !== 4 ? 'Team Ludo needs all 4 corners. Partners sit opposite.' : n < 2 ? 'Choose at least 2 players.' : h < 1 ? 'At least one player must be human.' : setupMode === 'quick' && n > 4 ? '' : '';
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
  function openMenu() {
    if (!G) return;
    cancelFlow(); stopTimer(); paused = true; layoutPieces(true); render(); persist();
    var menu = $('menu'); menu.removeAttribute('aria-hidden'); menu.setAttribute('aria-modal', 'true');
    show('menu'); $('menu-title').focus({ preventScroll: true });
  }
  function resumeFromMenu() {
    hide('menu'); paused = false; layoutPieces(true); advance();
    $('btn-home').focus({ preventScroll: true });
  }
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
      ['Mystery wins', S.mystery[1] + ' / ' + S.mystery[0]], ['Lucky Chaos wins', (S.lucky||[0,0])[1] + ' / ' + (S.lucky||[0,0])[0]], ['Quick wins', (S.quick||[0,0])[1] + ' / ' + (S.quick||[0,0])[0]], ['Team wins', (S.team||[0,0])[1] + ' / ' + (S.team||[0,0])[0]], ['Arrow wins', (S.arrow||[0,0])[1] + ' / ' + (S.arrow||[0,0])[0]], ['Friendly wins', (S.friendly||[0,0])[1] + ' / ' + (S.friendly||[0,0])[0]], ['1 v 1 wins', S.duel[1] + ' / ' + S.duel[0]], ['4-player wins', S.four[1] + ' / ' + S.four[0]], ['Pass & Play', S.pass]];
    $('stats-body').innerHTML = cells.map(function (c) { return '<div><b>' + c[1] + '</b><span>' + c[0] + '</span></div>'; }).join('');
  }
  var skinTab = 'boards', rulesReturnFocus = null;
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
  function evoRequirement(meta, unlock) {
    if (meta.level === 1) return 'Included · starter crystal';
    if (unlock && unlock.ok && unlock.free) return 'Ready · ' + meta.winsRequired + ' wins reached (free)';
    if (unlock && unlock.ok) return 'Unlock · ' + meta.coinCost.toLocaleString('en-US') + ' coins (or ' + meta.winsRequired + ' wins free)';
    if (unlock && unlock.reason === 'locked') {
      return 'Need ' + unlock.needCoins.toLocaleString('en-US') + ' more coins or ' + unlock.needWins + ' more wins';
    }
    return 'Earn ' + meta.coinCost.toLocaleString('en-US') + ' coins or ' + meta.winsRequired + ' wins';
  }
  function renderTokenEvolution() {
    if (!TOKEN_EVOLUTION) return;
    var granted = TOKEN_EVOLUTION.collectEligible(save);
    if (granted.length) persist();
    var grid = $('skin-grid');
    var noteTop = document.createElement('p');
    noteTop.className = 'note evo-intro';
    noteTop.textContent = 'Token Evolution is cosmetic only. Unlock with match wins (free) or coins. Applies to your tokens in offline and online matches.';
    grid.appendChild(noteTop);
    TOKEN_EVOLUTION.LEVELS.forEach(function (meta) {
      var st = TOKEN_EVOLUTION.state(meta.level, save);
      var el = document.createElement('div');
      el.className = 'skin evo-card' + (st.selected ? ' on' : '') + (!st.owned && !st.isNext ? ' is-locked' : '');
      el.dataset.id = meta.id; el.dataset.evoLevel = String(meta.level);
      var prev = document.createElement('div');
      prev.className = 'evo-prev'; prev.setAttribute('role', 'img'); prev.setAttribute('aria-label', 'Lv' + meta.level + ' ' + meta.name);
      prev.dataset.evo = String(meta.level);
      prev.innerHTML = '<i class="jugnu" aria-hidden="true"></i>' +
        (meta.badge ? '<span class="evo-badge" data-evo-badge="' + meta.level + '" aria-hidden="true">' + (meta.level >= 5 ? '★' : '✦') + '</span>' : '') +
        '<span class="evo-prev-gem evo-prev-pawn" data-mat="ruby" aria-hidden="true"></span>' +
        '<span class="evo-prev-lvl">Lv' + meta.level + '</span>';
      prev.style.setProperty('--evo-gloss', String(meta.gloss));
      prev.style.setProperty('--evo-glow', String(meta.glow));
      prev.style.setProperty('--pc', '#e85a48');
      prev.style.setProperty('--pccore', '#ffd0c1');
      el.appendChild(prev);
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = 'Lv' + meta.level + ' · ' + meta.name; el.appendChild(nm);
      var note = document.createElement('small'); note.className = 'skin-note'; note.textContent = meta.blurb + ' · ' + evoRequirement(meta, st.unlock); el.appendChild(note);
      var b = document.createElement('button');
      b.className = 'btn ' + (st.selected ? 'plate' : st.owned || st.canUnlock ? 'primary' : 'plate');
      if (st.selected) { b.textContent = 'In use'; b.disabled = true; }
      else if (st.owned) b.textContent = 'Use';
      else if (st.canUnlock && st.unlock.free) b.textContent = 'Unlock free · ' + meta.winsRequired + ' wins';
      else if (st.canUnlock) b.textContent = 'Unlock · ' + meta.coinCost.toLocaleString('en-US') + ' coins';
      else if (st.isNext) { b.textContent = 'Need coins or wins'; b.disabled = true; }
      else { b.textContent = 'Locked'; b.disabled = true; }
      b.setAttribute('aria-label', meta.name + ': ' + b.textContent);
      b.addEventListener('click', function () {
        var result;
        if (st.owned) result = TOKEN_EVOLUTION.select(save, meta.level, persist);
        else if (st.canUnlock) result = TOKEN_EVOLUTION.unlockNext(save, persist);
        else return;
        if (!result.ok) {
          if (result.reason === 'save-failed') toast('Could not save Token Evolution. Check device storage.', 2600);
          else if (result.reason === 'locked') toast('Need more coins or wins for ' + meta.name + '.', 2200);
          return;
        }
        if (result.spent > 0) SFX.coin(); else SFX.unlock ? SFX.unlock() : SFX.click();
        renderSkins(); setCoins();
        if (!$('game').classList.contains('hidden')) { buildPods(); buildTiles(); buildPieces(); layout(); render(); }
        if (result.level && !st.owned) toast('Token Evolution Lv' + result.level + ' ' + result.name + (result.free ? ' (free)' : ''), 2400);
      });
      el.appendChild(b); grid.appendChild(el);
    });
  }
  function renderSkins() {
    setCoins();
    each($('skin-tabs').children, function (b) { b.classList.toggle('on', b.dataset.tab === skinTab); });
    var grid = $('skin-grid'); grid.innerHTML = '';
    if (skinTab === 'tokens') { renderTokenEvolution(); return; }
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
        var faceSolid = (typeof it.face === 'string' && it.face.indexOf('gradient') >= 0)
          ? ((it.face.match(/#[0-9a-fA-F]{3,8}/g) || [])[1] || it.edge || '#fbfaf6') : it.face;
        dp.style.background = it.face;
        dp.style.backgroundImage = (typeof it.face === 'string' && it.face.indexOf('gradient') >= 0)
          ? it.face
          : 'linear-gradient(152deg, rgba(255,255,255,.7) 0%, rgba(255,255,255,0) 45%), linear-gradient(160deg, ' + mix(faceSolid, 'w', 0.35) + ' 0%, ' + faceSolid + ' 50%, ' + it.edge + ' 100%)';
        dp.style.boxShadow = 'inset 0 2px 0 rgba(255,255,255,.9), inset 0 -5px 8px rgba(40,32,20,.18), 0 6px 14px rgba(0,0,0,.28)';
        dp.innerHTML = '<i></i><i></i><i></i>';
        each(dp.children, function (pip) {
          pip.style.background = it.pip;
          pip.style.backgroundImage = 'radial-gradient(circle at 32% 28%, ' + mix(it.pip, 'w', 0.45) + ' 0%, ' + it.pip + ' 55%, #07090c 100%)';
        });
        el.appendChild(dp);
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
  var RULE_KEYS = ['safeSquares', 'captureToEnter', 'blocks', 'bonusOnCapture', 'bonusOnHome', 'arrows', 'noCapture'];
  function syncSettingsUI() {
    var locked = !!(G && G.online);
    SETTINGS.forEach(function (k) { $('set-' + k).checked = !!save.settings[k]; });
    RULE_KEYS.forEach(function (k) { $('rule-' + k).checked = !!save.rules[k]; $('rule-' + k).disabled = locked; });
    each($('rule-style').children, function (b) { b.classList.toggle('on', b.dataset.v === save.rules.rollStyle); b.disabled = locked; });
    if ($('rule-lock-note')) $('rule-lock-note').classList.toggle('hidden', !locked);
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
    var alreadyOpen = isOpen('rules');
    if (!alreadyOpen) {
      rulesReturnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      if (isOpen('menu')) {
        var menu = $('menu');
        menu.setAttribute('aria-hidden', 'true'); menu.setAttribute('aria-modal', 'false');
        if (!rulesReturnFocus || !menu.contains(rulesReturnFocus)) rulesReturnFocus = $('btn-m-rules');
      } else if (!rulesReturnFocus) rulesReturnFocus = setupVisible() ? $('btn-howto') : $('btn-rules');
    }
    each($('rules-tabs').children, function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    each(document.querySelectorAll('.rules-page'), function (p) { p.classList.toggle('hidden', p.dataset.page !== tab); });
    show('rules');
    if (!alreadyOpen) $('rules-title').focus({ preventScroll: true });
  }
  function closeRules() {
    hide('rules');
    var menu = $('menu'), target = rulesReturnFocus;
    rulesReturnFocus = null;
    if (isOpen('menu')) { menu.removeAttribute('aria-hidden'); menu.setAttribute('aria-modal', 'true'); }
    if (!target || !target.isConnected || target.disabled || target.closest('.hidden') || target.closest('[aria-hidden="true"]')) {
      target = isOpen('menu') ? $('btn-m-rules') : setupVisible() ? $('btn-howto') : $('btn-rules');
    }
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }
  function handleGameDialogKeys(e) {
    var overlays = Array.prototype.slice.call(document.querySelectorAll('.overlay:not(.hidden)'));
    var dialog = overlays.length ? overlays[overlays.length - 1] : null;
    if (dialog !== $('menu') && dialog !== $('rules')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (dialog.id === 'menu') $('btn-m-resume').click();
      else { var close = dialog.querySelector('[data-close="rules"]'); if (close) close.click(); }
      return;
    }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (el) {
      return !el.closest('.hidden') && !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0;
    });
    if (!focusable.length) { e.preventDefault(); var title = dialog.querySelector('[tabindex="-1"]'); if (title) title.focus({ preventScroll: true }); return; }
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus({ preventScroll: true }); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.querySelector('[tabindex="-1"]'))) {
      e.preventDefault(); last.focus({ preventScroll: true });
    } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
  }
  document.addEventListener('keydown', handleGameDialogKeys);
  function setupVisible() { return !$('setup').classList.contains('hidden'); }

  // ---------------- input ----------------
  $('btn-continue').addEventListener('click', function () { SFX.unlock(); SFX.click(); if (G) showGame(); });
  $('btn-vs-ai').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai', 'classic'); });
  $('btn-mystery').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai', 'mystery'); });
  $('btn-lucky').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai', 'lucky'); });
  $('btn-howto').addEventListener('click', function () { SFX.click(); openRules(setupMode === 'lucky' ? 'lucky' : 'modes'); });
  [['btn-quick', 'quick'], ['btn-team', 'team'], ['btn-arrow', 'arrow'], ['btn-friendly', 'friendly']].forEach(function (x) {
    $(x[0]).addEventListener('click', function () {
      SFX.unlock(); SFX.click(); showSetup('ai', x[1]);
      if (x[1] === 'team' && save.setup.ai.filter(Boolean).length !== 4) applyPreset('4');
    });
  });
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
    if (e.target && e.target.closest && e.target.closest('#token-die-pick')) return; // die picker handles its own clicks
    var r = $('board-wrap').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = Infinity;
    var pool = G.st.moves || [];
    pool.forEach(function (m) { var p = piecePos[m.seat + '-' + m.piece]; if (!p) return; var d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = m; } });
    if (best && bd < CELL * 1.6) handleTokenTap(best.seat, best.piece, false);
  });
  // token die picker buttons
  $('board-wrap').addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('#token-die-pick .token-die-v, #token-die-pick .token-die-x') : null;
    if (!btn || !diePick || !G || busy || paused || G.st.phase !== 'move') return;
    e.preventDefault(); e.stopPropagation();
    if (btn.classList.contains('token-die-x')) { SFX.click(); hideDiePick(); return; }
    var v = +btn.dataset.v, seat = diePick.seat, piece = diePick.piece;
    if (!tokenDieMoves(seat, piece).some(function (m) { return m.v === v; })) { hideDiePick(); return; }
    SFX.unlock(); hideDiePick(); doMove(piece, v, true);
  });
  $('btn-undo').addEventListener('click', undoRoll);
  $('btn-chat').addEventListener('click', function () { SFX.click(); if (isOpen('chat')) hide('chat'); else show('chat'); });
  $('btn-home').addEventListener('click', function () { SFX.click(); hide('chat'); if (G && G.online) { $('game').classList.add('hidden'); return; } openMenu(); });
  $('btn-m-resume').addEventListener('click', function () { SFX.click(); resumeFromMenu(); });
  $('btn-m-rules').addEventListener('click', function () { SFX.click(); openRules(G && G.st.mode === 'mystery' ? 'mystery' : G && G.st.mode === 'lucky' ? 'lucky' : G && ['quick','team','arrow','friendly'].indexOf(G.st.mode) >= 0 ? 'modes' : 'basics'); });
  $('btn-m-home').addEventListener('click', function () { SFX.click(); hide('menu'); showHome(); });
  $('btn-m-restart').addEventListener('click', function () { SFX.click(); hide('menu'); askConfirm('Restart the match?', 'The current match starts again with the same players.', 'Restart', function () { startMatch(G.seats, G.mode); }); });
  $('btn-r-again').addEventListener('click', function () { leaveResult('again'); });
  $('btn-r-home').addEventListener('click', function () { leaveResult('home'); });
  $('btn-r-double').addEventListener('click', doubleCoins);
  $('btn-exit-match').addEventListener('click', function () { SFX.click(); openExitConfirmation(); });
  $('btn-stats').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderStats(); show('stats'); });
  $('btn-skins').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderSkins(); show('skins'); });
  $('btn-rules').addEventListener('click', function () { SFX.unlock(); SFX.click(); openRules('basics'); });
  if ($('btn-howto-home')) $('btn-howto-home').addEventListener('click', function () {
    SFX.click();
    var panel = $('howto-panel'); if (!panel) return;
    var open = panel.classList.toggle('hidden') === false;
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
    var card = $('howto-card'); if (card) card.classList.toggle('is-open', open);
    if (open && card && card.scrollIntoView) {
      var r = card.getBoundingClientRect();
      if (r.bottom > window.innerHeight) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  each($('rules-tabs').children, function (b) { b.addEventListener('click', function () { SFX.click(); openRules(b.dataset.tab); }); });
  $('btn-settings').addEventListener('click', function () { SFX.unlock(); SFX.click(); syncSettingsUI(); show('settings'); });
  $('btn-game-settings').addEventListener('click', function () { SFX.click(); syncSettingsUI(); show('settings'); });
  each($('skin-tabs').children, function (b) { b.addEventListener('click', function () { skinTab = b.dataset.tab; SFX.click(); renderSkins(); }); });
  each(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', function () { SFX.click(); if (b.dataset.close === 'rules') closeRules(); else hide(b.dataset.close); if (setupVisible()) renderSetup(); }); });
  SETTINGS.forEach(function (k) {
    $('set-' + k).addEventListener('change', function () {
      save.settings[k] = $('set-' + k).checked; persist();
      if (k === 'sound') { SFX.setEnabled(save.settings.sound); SFX.unlock(); }
      if (k === 'fast') document.documentElement.style.setProperty('--step-ms', stepMs() + 'ms');
      if (k === 'undo' && !save.settings.undo && G) { G.undo = null; }
      if (k === 'timer' && G && !$('game').classList.contains('hidden') && !busy) { if (save.settings.timer) startTimer(); else stopTimer(); }
      if (G) render();
      SFX.click();
    });
  });
  RULE_KEYS.forEach(function (k) { $('rule-' + k).addEventListener('change', function () { if (G && G.online) { $('rule-' + k).checked = !!save.rules[k]; return; } save.rules[k] = $('rule-' + k).checked; persist(); SFX.click(); if (setupVisible()) renderSetup(); }); });
  each($('rule-style').children, function (b) { b.addEventListener('click', function () { if (G && G.online) return; save.rules.rollStyle = b.dataset.v; persist(); SFX.click(); syncSettingsUI(); if (setupVisible()) renderSetup(); }); });
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
    } else if ((e.key === 'u' || e.key === 'U') && save.settings.undo) undoRoll();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') { if (G) { cancelFlow(); stopTimer(); layoutPieces(true); persist(); } }
    else if (G && !$('game').classList.contains('hidden') && !paused && !isOpen('result')) { layoutPieces(true); render(); advance(); }
  });
  window.addEventListener('resize', function () { layout(); });
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


  // ---------------- online Classic on the local board ----------------
  var onlineHooks = null;
  var parkedLocal = null;
  var onlineClock = null;
  var onlineExpireKey = '';
  var onlineCelebrated = '';
  function onlineNames(names, seat) { return names && names[seat] ? names[seat] : NAMES[seat]; }
  function serverToLocal(state, mySeat, names) {
    var players = (state.players || []).map(function (n) { return Number(n); });
    var seats = [null, null, null, null];
    var rules = {};
    var key;
    for (key in L.DEFAULT_RULES) if (Object.prototype.hasOwnProperty.call(L.DEFAULT_RULES, key)) rules[key] = L.DEFAULT_RULES[key];
    if (state.rules) for (key in state.rules) if (Object.prototype.hasOwnProperty.call(state.rules, key)) rules[key] = state.rules[key];
    players.forEach(function (seat) { seats[seat] = { type: seat === mySeat ? 'human' : 'remote', name: onlineNames(names, seat) }; });
    var pieces = state.pieces || [null, null, null, null];
    var st = {
      v: 2, mode: 'classic', nPieces: 4, seats: seats, players: players, pieces: pieces,
      turn: Number(state.turn) || 0, phase: state.phase || 'roll', queue: (state.queue || []).slice(),
      sixes: state.sixes || 0, bonus: state.bonus || 0, ranking: (state.ranking || []).slice(),
      rules: rules, capd: state.capd || [false, false, false, false], faces: state.faces || [1, 1, 1, 1],
      effects: [], tiles: [], lk: null, pending: null, boost: [null, null, null, null], moves: [],
      stats: seats.map(function (x) { return x ? { captures: 0, captured: 0, sixes: 0, home: 0, rolls: 0, events: 0 } : null; }),
      rolls: state.turn_count || 0, turnCount: state.turn_count || 0, rng: 1, rollAgain: !!state.roll_again, moveCount: 0
    };
    if (st.phase === 'move') st.moves = L.queueMoves(st);
    return st;
  }
  function hideClassicTextPanel() {
    ['online-match-dice', 'online-match-pieces', 'online-match-moves', 'online-classic-note', 'online-roll'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    var pieces = $('online-match-pieces'); if (pieces) pieces.replaceChildren();
    var moves = $('online-match-moves'); if (moves) moves.replaceChildren();
  }
  function paintOnlineChrome() {
    var timer = $('online-turn-timer'), meter = $('online-turn-meter'), fill = $('online-turn-fill');
    var grace = $('online-grace'), graceText = $('online-grace-text'), graceFill = $('online-grace-fill');
    if (!G || !G.online || !onlineHooks) {
      if (timer) timer.classList.add('hidden');
      if (meter) meter.classList.add('hidden');
      if (grace) grace.classList.add('hidden');
      return;
    }
    var deadline = Number(onlineHooks.deadline) || 0;
    var total = 45000;
    if (timer) {
      if (!deadline || G.st.phase === 'over') {
        timer.classList.add('hidden');
        if (meter) meter.classList.add('hidden');
      } else {
        var left = Math.max(0, deadline - Date.now());
        timer.classList.remove('hidden');
        timer.textContent = Math.ceil(left / 1000) + 's';
        if (meter) {
          meter.classList.remove('hidden');
          meter.classList.toggle('urgent', left < 8000);
          if (fill) fill.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
        }
        var key = String(deadline);
        if (left <= 0 && onlineExpireKey !== key && onlineHooks.onExpire) {
          onlineExpireKey = key;
          onlineHooks.onExpire();
        }
      }
    }
    var g = onlineHooks.grace;
    if (grace) {
      if (g && Number(g.until) > Date.now() && G.st.phase !== 'over') {
        var gLeft = Math.max(0, Number(g.until) - Date.now()), gTotal = 20000;
        grace.classList.remove('hidden');
        if (graceText) graceText.textContent = 'Reconnect window: seat ' + (Number(g.seat) + 1) + ' can rejoin for ' + Math.ceil(gLeft / 1000) + 's. No computer takes the seat.';
        else grace.textContent = 'Reconnect window: seat ' + (Number(g.seat) + 1) + ' can rejoin for ' + Math.ceil(gLeft / 1000) + 's. No computer takes the seat.';
        if (graceFill) graceFill.style.width = Math.max(0, Math.min(100, (gLeft / gTotal) * 100)) + '%';
      } else grace.classList.add('hidden');
    }
    var retry = $('online-board-retry');
    if (retry) retry.classList.toggle('hidden', !onlineHooks.pending);
  }
  function stopOnlineClock() { if (onlineClock) { clearInterval(onlineClock); onlineClock = null; } }
  function presentOnline(opts) {
    opts = opts || {};
    if (!G || !G.online) parkedLocal = G;
    onlineHooks = opts;
    hideClassicTextPanel();
    document.body.classList.add('online-classic-board');
    var mySeat = Number(opts.mySeat);
    var st = serverToLocal(opts.state || {}, mySeat, opts.names || null);
    G = { st: st, seats: st.seats, mode: 'classic', view: mySeat, online: true, undoLeft: 0, undo: null, sel: null, coins: 0, xp: 0, doubled: false, counted: true, started: Date.now() };
    screen('game'); paused = false;
    buildPods(); buildTiles(); buildPieces(); layout(); render(); highlight(); paintOnlineChrome();
    if (st.phase === 'over' && st.ranking.length) {
      // Online win: same Gulaab Camel celebration, once per finished match.
      var celebrateKey = st.players.join(',') + '|' + st.ranking.join(',') + '|' + (st.turnCount || 0);
      if (onlineCelebrated !== celebrateKey) { onlineCelebrated = celebrateKey; celebrateWin(st.ranking[0]); }
    }
    stopOnlineClock();
    onlineClock = setInterval(paintOnlineChrome, 250);
  }
  function showOnlineBoard() {
    if (!G || !G.online) return;
    $('game').classList.remove('hidden');
    layout(); render(); highlight();
  }
  function clearOnline() {
    stopOnlineClock();
    if (G && G.online) stopCelebration();
    onlineHooks = null;
    onlineExpireKey = '';
    if ($('online-turn-timer')) $('online-turn-timer').classList.add('hidden');
    if ($('online-turn-meter')) $('online-turn-meter').classList.add('hidden');
    if ($('online-grace')) $('online-grace').classList.add('hidden');
    if ($('online-board-retry')) $('online-board-retry').classList.add('hidden');
    document.body.classList.remove('online-classic-board');
    if (!G || !G.online) return;
    G = parkedLocal;
    parkedLocal = null;
    $('game').classList.add('hidden');
    if (G) { G.undo = null; G.sel = null; }
  }

  window.__cf = {
    get game() { return G; }, get save() { return save; }, get loadStatus() { return loadResult.status; }, logic: L, gate: gate,
    native: native, haptic: haptic,
    persist: persist, isValidGame: validGame, isValidSave: validSave, get lastSaveError() { return lastSaveError; },
    get busy() { return busy; }, get paused() { return paused; }, get idle() { return !busy && timers.length === 0 && !isOpen('wheel') && !isOpen('choice') && !diePick && (!($('move-countdown')) || $('move-countdown').classList.contains('hidden')); },
    get undoActive() { return undoActive(); },
    force: function (vals) { forced = vals.slice(); },
    bestAutoMove: function () { return G && G.st ? L.bestAutoMove(G.st, 'hard') : null; },
    get diePick() { return diePick; },
    get moveDecideLeft() { return moveDecideLeft; },

    forceEvent: function (evs) { forcedEvents = [].concat(evs); },
    forceMega: function (evs) { forcedMega = [].concat(evs); },
    mega: function (ev) { doMega(ev); },
    /** Test helper: edit the running match state, then redraw and continue. */
    edit: function (fn) { cancelFlow(); fn(G.st); G.st.moves = G.st.phase === 'move' ? L.queueMoves(G.st) : []; buildPods(); buildTiles(); buildPieces(); layout(); render(); advance(); },
    piecePoint: function (s, i) { var r = $('board-wrap').getBoundingClientRect(), p = piecePos[s + '-' + i]; return p ? { x: r.left + p.x, y: r.top + p.y } : null; },
    podOf: function (s) { var p = podEl(s); return p ? +p.dataset.slot : null; },
    layout: layout,
    presentOnline: presentOnline,
    clearOnline: clearOnline,
    showOnlineBoard: showOnlineBoard,
    celebrateWin: celebrateWin,
    get celebration() { return window.CamelCelebration ? window.CamelCelebration.state : 'idle'; }
  };
})();
