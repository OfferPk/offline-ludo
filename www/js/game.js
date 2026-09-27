/* Crossfour - offline Ludo. UI, animation, AI turns, persistence, skins, ads hooks. */
(function () {
  'use strict';
  var L = window.LudoLogic, SK = window.SKINS, CFG = window.ADS_CONFIG || {};
  var SFX = window.SFX, Ads = window.Ads;
  var $ = function (id) { return document.getElementById(id); };
  var native = !!(Ads && Ads.isNative());
  var SAVE_KEY = 'crossfour.save.v1';
  var NAMES = SK.SEAT_NAMES;
  var LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  var ACCENT = { graphite: ['#f4b740', '#1c1504'], linen: ['#2b3140', '#ffffff'], walnut: ['#e0a232', '#231605'], aurora: ['#27e0b3', '#03261d'] };

  // ---------------- save ----------------
  function defaults() {
    return {
      coins: 0, owned: { boards: ['graphite', 'linen'], dice: ['ivory'] }, board: 'graphite', dice: 'ivory',
      settings: { sound: true, haptics: true, auto: true, fast: false },
      setup: {
        ai: [null, { type: 'ai', level: 'medium' }, null, { type: 'human' }],
        pass: [null, { type: 'human' }, null, { type: 'human' }],
        rules: { safeSquares: true, extraOnSix: true, extraOnCapture: true }
      },
      stats: { played: 0, won: 0, captures: 0, home: 0, sixes: 0, pass: 0, vs: { easy: [0, 0], medium: [0, 0], hard: [0, 0] } },
      game: null, ad: {}
    };
  }
  function load() {
    var d = defaults(), s;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') return d;
    Object.keys(d).forEach(function (k) { if (s[k] === undefined || s[k] === null && k !== 'game') s[k] = d[k]; });
    ['settings', 'stats'].forEach(function (k) { Object.keys(d[k]).forEach(function (j) { if (s[k][j] === undefined) s[k][j] = d[k][j]; }); });
    if (!s.setup || !Array.isArray(s.setup.ai) || !Array.isArray(s.setup.pass)) s.setup = d.setup;
    if (!s.owned || !Array.isArray(s.owned.boards) || !Array.isArray(s.owned.dice)) s.owned = d.owned;
    if (typeof s.coins !== 'number' || !isFinite(s.coins) || s.coins < 0) s.coins = 0;
    return s;
  }
  var save = load();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
  var gate = window.AdGate.create(CFG, save.ad); save.ad = gate.state;
  gate.sessionStarted();
  persist();

  function validGame(g) {
    return g && g.st && Array.isArray(g.st.pieces) && g.st.pieces.length === 4 && Array.isArray(g.st.players) && g.st.players.length >= 2 &&
      ['roll', 'move', 'over'].indexOf(g.st.phase) >= 0 && g.st.seats && g.st.seats[g.st.turn];
  }
  var G = validGame(save.game) ? save.game : null;
  if (!G) save.game = null;

  // ---------------- helpers ----------------
  function hex2rgb(h) { h = h.replace('#', ''); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function mix(h, to, f) { var a = hex2rgb(h), b = to === 'w' ? [255, 255, 255] : [0, 0, 0]; return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * f); }).join(',') + ')'; }
  function rgba(h, a) { var c = hex2rgb(h); return 'rgba(' + c.join(',') + ',' + a + ')'; }
  function haptic(kind) {
    if (!save.settings.haptics || !native) return;
    var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
    if (!H) return;
    try {
      if (kind === 'success') H.notification({ type: 'SUCCESS' });
      else if (kind === 'warn') H.notification({ type: 'WARNING' });
      else H.impact({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
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
  function setCoins() { Array.prototype.forEach.call(document.querySelectorAll('.coins-val'), function (e) { e.textContent = save.coins; }); }
  function board() { for (var i = 0; i < SK.BOARDS.length; i++) if (SK.BOARDS[i].id === save.board) return SK.BOARDS[i]; return SK.BOARDS[0]; }
  function dice() { for (var i = 0; i < SK.DICE.length; i++) if (SK.DICE[i].id === save.dice) return SK.DICE[i]; return SK.DICE[0]; }
  function seatColor(s) { return board().seats[s]; }
  function stepMs() { return save.settings.fast ? 85 : 150; }
  function aiDelay() { return save.settings.fast ? 280 : 560; }

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
  function drawBoard(cv, sz, b, rules, active) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(sz * dpr); cv.height = Math.round(sz * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c = sz / 15, gap = Math.max(1, c * 0.07);
    ctx.clearRect(0, 0, sz, sz);
    rr(ctx, 0, 0, sz, sz, c * 0.7); ctx.fillStyle = b.board; ctx.fill();
    // bases
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
        // direction chevron + shield when safe
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
    // centre: four triangles pointing at the middle
    var m0 = 6 * c, m1 = 9 * c, mc = 7.5 * c;
    var tri = [[[m0, m0], [m0, m1]], [[m0, m0], [m1, m0]], [[m1, m0], [m1, m1]], [[m0, m1], [m1, m1]]];
    for (s = 0; s < 4; s++) {
      ctx.beginPath(); ctx.moveTo(tri[s][0][0], tri[s][0][1]); ctx.lineTo(tri[s][1][0], tri[s][1][1]); ctx.lineTo(mc, mc); ctx.closePath();
      var gg = ctx.createLinearGradient(tri[s][0][0], tri[s][0][1], mc, mc); gg.addColorStop(0, b.seats[s]); gg.addColorStop(1, mix(b.seats[s], 'b', 0.25));
      ctx.fillStyle = gg; ctx.fill(); ctx.lineWidth = gap; ctx.strokeStyle = b.board; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(mc, mc, c * 0.42, 0, Math.PI * 2); ctx.fillStyle = b.board; ctx.fill();
    ctx.save(); ctx.translate(mc, mc); ctx.rotate(Math.PI / 4);
    for (s = 0; s < 4; s++) { ctx.fillStyle = b.seats[[0, 1, 2, 3][s]]; var q = c * 0.13; ctx.fillRect((s % 2 ? 0.02 : -1.02) * q * 1.6, (s < 2 ? -1.02 : 0.02) * q * 1.6, q * 1.5, q * 1.5); }
    ctx.restore();
    if (b.glow) { ctx.save(); rr(ctx, 1, 1, sz - 2, sz - 2, c * 0.7); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(120,160,255,.35)'; ctx.shadowColor = 'rgba(120,160,255,.6)'; ctx.shadowBlur = 12; ctx.stroke(); ctx.restore(); }
  }

  // ---------------- layout & pieces ----------------
  var BS = 320, CELL = BS / 15;
  var pieceEls = [[], [], [], []];
  var piecePos = {};           // "s-i" -> {x, y}
  var moving = {};             // pieces being animated
  function buildPieces() {
    var box = $('pieces'); box.innerHTML = ''; pieceEls = [[], [], [], []];
    if (!G) return;
    for (var s = 0; s < 4; s++) {
      if (!G.st.pieces[s]) continue;
      var col = seatColor(s);
      for (var i = 0; i < 4; i++) {
        var el = document.createElement('div'); el.className = 'pc';
        el.style.setProperty('--pc', col); el.style.setProperty('--pcl', mix(col, 'w', 0.55)); el.style.setProperty('--pcd', mix(col, 'b', 0.3)); el.style.setProperty('--pcdd', mix(col, 'b', 0.45));
        el.dataset.seat = s; el.dataset.piece = i;
        box.appendChild(el); pieceEls[s].push(el);
      }
    }
  }
  function center(rc) { return { x: (rc[1] + 0.5) * CELL, y: (rc[0] + 0.5) * CELL }; }
  function place(el, x, y, sc) { el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + (sc || 1) + ')'; }
  var CLUSTER = { 2: [[-0.2, 0], [0.2, 0]], 3: [[-0.2, -0.17], [0.2, -0.17], [0, 0.2]], 4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] };
  function layoutPieces(instant) {
    if (!G) return;
    var st = G.st, groups = {};
    for (var s = 0; s < 4; s++) {
      if (!st.pieces[s]) continue;
      for (var i = 0; i < 4; i++) {
        var p = st.pieces[s][i];
        var key = (p < 0 || p === L.HOME) ? 's' + s + 'p' + i + 'b' + p : (p <= L.LAST_TRACK ? 'a' + L.absOf(s, p) : 'h' + s + '-' + p);
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
        piecePos[id] = c;
      });
    });
  }
  function layout() {
    var stage = $('stage'); if (!stage || $('game').classList.contains('hidden')) return;
    var r = stage.getBoundingClientRect();
    var w = Math.min(r.width - 16, 560), h = r.height - (44 * 2 + 92 + 8 * 3 + 6);
    var bs = Math.floor(Math.max(210, Math.min(w, h)));
    BS = bs; CELL = bs / 15;
    var root = document.documentElement.style; root.setProperty('--bs', bs + 'px'); root.setProperty('--cell', CELL + 'px'); root.setProperty('--step-ms', stepMs() + 'ms');
    drawBoard($('board'), bs, board(), G ? G.st.rules : L.DEFAULT_RULES, G ? G.st.seats : null);
    layoutPieces(true);
  }

  // ---------------- flow control ----------------
  var runToken = 0, timers = [], busy = false, paused = false;
  function later(fn, ms) { var tk = runToken; var id = setTimeout(function () { timers.splice(timers.indexOf(id), 1); if (tk === runToken) fn(); }, ms); timers.push(id); }
  function cancelFlow() { runToken++; timers.forEach(clearTimeout); timers = []; busy = false; moving = {}; }
  function gameVisible() { return !$('game').classList.contains('hidden') && document.visibilityState === 'visible'; }
  function humans(st) { return st.players.filter(function (s) { return st.seats[s].type === 'human'; }); }
  function hasAI(st) { return st.players.some(function (s) { return st.seats[s].type === 'ai'; }); }
  function isHuman(s) { return G && G.st.seats[s] && G.st.seats[s].type === 'human'; }
  function nameOf(s) {
    var st = G.st, pl = st.seats[s];
    if (pl.type === 'human') return humans(st).length === 1 ? 'You' : NAMES[s];
    return NAMES[s];
  }
  function levelOf(s) { var pl = G.st.seats[s]; return pl.type === 'human' ? (humans(G.st).length === 1 ? 'Player' : 'Player ' + (humans(G.st).indexOf(s) + 1)) : LEVEL_NAMES[pl.level] + ' AI'; }

  var forced = []; // test hook: queued die values
  function render() {
    if (!G) return;
    var st = G.st;
    Array.prototype.forEach.call(document.querySelectorAll('.pp'), function (el) {
      var s = +el.dataset.seat;
      if (!st.seats[s]) { el.className = 'pp empty'; el.innerHTML = ''; return; }
      var home = st.pieces[s].filter(function (p) { return p === L.HOME; }).length, rank = st.ranking.indexOf(s);
      el.className = 'pp' + (st.phase !== 'over' && st.turn === s ? ' active' : '') + (rank >= 0 ? ' done' : '');
      el.style.setProperty('--pc', seatColor(s)); el.style.setProperty('--pca', rgba(seatColor(s), 0.22));
      var dots = ''; for (var k = 0; k < 4; k++) dots += '<i' + (k < home ? ' style="background:' + seatColor(s) + '"' : '') + '></i>';
      el.innerHTML = '<span class="pdot" style="background:' + seatColor(s) + '"></span><span class="pinfo"><span class="pname">' + nameOf(s) + '</span><span class="plvl">' +
        (rank >= 0 && st.phase !== 'over' ? '<span class="prank">' + ['1st', '2nd', '3rd', '4th'][rank] + ' place</span>' : levelOf(s)) + '</span></span><span class="phome">' + dots + '</span>';
    });
    var s = st.turn, lbl = $('turn-label');
    if (st.phase === 'over') lbl.innerHTML = 'Match over';
    else lbl.innerHTML = '<span class="dot" style="background:' + seatColor(s) + '"></span>' + (isHuman(s) ? (nameOf(s) === 'You' ? 'Your turn' : nameOf(s) + "'s turn") : nameOf(s) + ' is playing');
    var humanRoll = st.phase === 'roll' && isHuman(s) && !busy;
    var d = $('dice'); d.disabled = !humanRoll; d.classList.toggle('ready', humanRoll); d.style.setProperty('--tc', seatColor(s));
    $('dice-hint').textContent = st.phase === 'over' ? '' : humanRoll ? 'Tap to roll' : (st.phase === 'move' && isHuman(s) && !busy ? 'Pick a piece' : '');
    Array.prototype.forEach.call($('sixes').children, function (e, k) { e.classList.toggle('on', st.sixes > k); });
    var u = $('btn-undo'), showUndo = hasAI(st) && humans(st).length > 0;
    u.classList.toggle('hidden', !showUndo);
    u.disabled = !(G.snap && G.undoLeft > 0 && st.phase !== 'over');
  }
  function clearHighlights() { Array.prototype.forEach.call(document.querySelectorAll('.pc.can'), function (e) { e.classList.remove('can'); }); }
  function offerMoves() {
    var st = G.st; if (st.phase !== 'move' || !isHuman(st.turn)) return;
    var distinct = L.distinctMoves(st.moves);
    render();
    if (save.settings.auto && distinct.length === 1) { later(function () { doMove(distinct[0].piece); }, save.settings.fast ? 200 : 380); return; }
    clearHighlights();
    st.moves.forEach(function (m) { var el = pieceEls[m.seat][m.piece]; if (el) el.classList.add('can'); });
  }

  function advance() {
    if (!G) return;
    var st = G.st;
    render(); persist();
    if (st.phase === 'over') { later(finishMatch, 700); return; }
    if (paused || !gameVisible() || busy) return;
    var s = st.turn, pl = st.seats[s];
    if (pl.type === 'ai') {
      if (st.phase === 'roll') later(doRoll, aiDelay());
      else later(function () { doMove(L.chooseMove(st, pl.level)); }, aiDelay() * 0.5);
    } else if (st.phase === 'move') offerMoves();
  }

  var FACE = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  var spin = 0;
  function animateDice(v, cb) {
    var cube = $('cube'), f = FACE[v], dur = save.settings.fast ? 420 : 700;
    spin++;
    cube.style.transitionDuration = dur + 'ms';
    cube.style.transform = 'rotateX(' + (f[0] + 720 * spin) + 'deg) rotateY(' + (f[1] + 360 * spin) + 'deg) rotateZ(' + (spin % 2 ? 0 : 0) + 'deg)';
    SFX.roll();
    later(function () { SFX.land(v === 6); haptic('light'); cb(); }, dur);
  }
  function setDiceFace(v) { var f = FACE[v || 1], cube = $('cube'); cube.style.transitionDuration = '0ms'; cube.style.transform = 'rotateX(' + (f[0] + 720 * spin) + 'deg) rotateY(' + (f[1] + 360 * spin) + 'deg)'; }

  function doRoll() {
    if (!G || busy || G.st.phase !== 'roll') return;
    var st = G.st, s = st.turn, human = isHuman(s);
    busy = true; clearHighlights();
    if (human) G.snap = null; // undo only reaches back to the latest human move
    var r = L.roll(st, forced.length ? forced.shift() : undefined);
    save.stats.sixes += (human && r.value === 6) ? 1 : 0;
    render(); persist();
    animateDice(r.value, function () {
      busy = false;
      if (r.forfeit) { SFX.forfeit(); haptic('warn'); toast(nameOf(s) === 'You' ? 'Three 6s in a row: turn lost' : nameOf(s) + ' rolled three 6s: turn lost'); later(advance, 900); return; }
      if (!r.moves.length) {
        if (human) toast(r.passed ? 'No move possible' : 'No move possible: roll again');
        later(advance, human ? 800 : 500); return;
      }
      if (human) offerMoves(); else advance();
    });
  }

  function burst(x, y, col, n) {
    var fx = $('fx');
    for (var k = 0; k < n; k++) {
      var e = document.createElement('i'); e.className = 'burst'; var a = k / n * Math.PI * 2 + Math.random() * 0.4, d = CELL * (1 + Math.random() * 1.2);
      e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.background = col;
      e.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px'); e.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
      fx.appendChild(e); setTimeout(function (el) { el.remove(); }.bind(null, e), 700);
    }
  }
  function ring(x, y, col) { var e = document.createElement('i'); e.className = 'ring'; e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.setProperty('--rc', col); $('fx').appendChild(e); setTimeout(function () { e.remove(); }, 600); }
  function floatText(x, y, txt) { var e = document.createElement('div'); e.className = 'float'; e.style.left = x + 'px'; e.style.top = y + 'px'; e.textContent = txt; $('fx').appendChild(e); setTimeout(function () { e.remove(); }, 950); }

  function animateMove(s, i, from, to, cb) {
    var id = s + '-' + i, el = pieceEls[s][i], path = [];
    if (from < 0) path.push(0); else for (var p = from + 1; p <= to; p++) path.push(p);
    moving[id] = true;
    var k = 0, ms = stepMs();
    el.classList.add('hop');
    (function step() {
      if (k >= path.length) { delete moving[id]; el.classList.remove('hop'); cb(); return; }
      var pp = path[k], c = center(L.cellOf(s, pp, i));
      place(el, c.x, c.y, 1.12); piecePos[id] = c;
      if (from < 0) SFX.leave(); else SFX.step(k);
      k++; later(step, ms);
    })();
  }

  function doMove(piece) {
    if (!G || busy || G.st.phase !== 'move') return;
    var st = G.st, s = st.turn, human = isHuman(s);
    if (!st.moves.some(function (m) { return m.piece === piece; })) return;
    busy = true; clearHighlights();
    if (human && hasAI(st)) G.snap = L.clone(st);
    var from = st.pieces[s][piece];
    var res = L.move(st, piece);
    if (human) { save.stats.captures += res.captures.length; if (res.finish) save.stats.home++; }
    render(); persist();
    animateMove(s, piece, from, res.to, function () {
      var c = piecePos[s + '-' + piece] || { x: 0, y: 0 }, pause = 260;
      if (res.captures.length) {
        pause = 750;
        res.captures.forEach(function (cp) { burst(c.x, c.y, seatColor(cp.seat), 14); var el = pieceEls[cp.seat][cp.piece]; if (el) { el.style.transition = 'transform .5s cubic-bezier(.3,.7,.3,1), opacity .25s'; setTimeout(function () { el.style.transition = ''; }, 600); } });
        ring(c.x, c.y, seatColor(s)); floatText(c.x, c.y - CELL * 0.6, 'Captured!');
        $('board-wrap').classList.remove('shake'); void $('board-wrap').offsetWidth; $('board-wrap').classList.add('shake');
        SFX.capture(); haptic('heavy');
        if (res.captures.some(function (cp) { return isHuman(cp.seat); }) && !human) setTimeout(function () { SFX.captured(); }, 250);
      }
      if (res.finish) { pause = Math.max(pause, 520); ring(7.5 * CELL, 7.5 * CELL, seatColor(s)); floatText(7.5 * CELL, 6.8 * CELL, res.finishedPlayer ? NAMES[s] + ' finished!' : 'Home!'); SFX.home(); haptic('success'); }
      layoutPieces();
      busy = false;
      if (res.extraTurn && human && !res.over) toast(res.captures.length && st.rules.extraOnCapture ? 'Capture bonus: roll again' : 'Rolled a 6: roll again', 1100);
      render();
      later(advance, pause);
    });
  }

  // ---------------- match lifecycle ----------------
  function seatsFor(mode) { return save.setup[mode].map(function (x) { return x ? { type: x.type, level: x.level } : null; }); }
  function startMatch(seats) {
    cancelFlow();
    var st = L.newGame(seats, save.setup.rules, (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    G = { st: st, seats: seats, undoLeft: 3, snap: null, coins: 0, doubled: false, counted: false, started: Date.now() };
    save.game = G; persist();
    spin = 0; setDiceFace(1);
    showGame();
  }
  function finishMatch() {
    if (!G || G.st.phase !== 'over') return;
    var st = G.st;
    if (!G.counted) {
      G.counted = true;
      var hs = humans(st), best = 99;
      hs.forEach(function (s) { best = Math.min(best, st.ranking.indexOf(s) + 1); });
      var ai = st.players.filter(function (s) { return st.seats[s].type === 'ai'; }).map(function (s) { return st.seats[s].level; });
      G.place = best; G.coins = L.coinsFor(best, st.players.length, ai);
      save.coins += G.coins;
      var S = save.stats; S.played++; if (best === 1) S.won++;
      if (ai.length) { var top = ai.indexOf('hard') >= 0 ? 'hard' : ai.indexOf('medium') >= 0 ? 'medium' : 'easy'; S.vs[top][0]++; if (best === 1) S.vs[top][1]++; } else S.pass++;
      gate.matchCompleted();
      persist();
      if (gate.canShow(Date.now())) Ads.prepareInterstitial();
    }
    showResult();
  }
  function showResult() {
    var st = G.st, hs = humans(st), single = hs.length === 1;
    var winner = st.ranking[0];
    $('r-title').textContent = single ? (G.place === 1 ? 'You win!' : ['', '', '2nd place', '3rd place', '4th place'][G.place] || 'Match over') : NAMES[winner] + ' wins!';
    $('r-kicker').textContent = hasAI(st) ? 'MATCH OVER · VS COMPUTER' : 'MATCH OVER · PASS & PLAY';
    $('r-rank').innerHTML = st.ranking.map(function (s, k) {
      return '<li class="' + (isHuman(s) ? 'me' : '') + '"><b>' + (k + 1) + '.</b><span class="pdot" style="background:' + seatColor(s) + '"></span>' + nameOf(s) +
        '<small>' + levelOf(s) + ' · ' + st.pieces[s].filter(function (p) { return p === L.HOME; }).length + '/4 home</small></li>';
    }).join('');
    $('r-coins').textContent = '+' + (G.coins * (G.doubled ? 2 : 1));
    $('btn-r-double').classList.toggle('hidden', !G.coins || G.doubled);
    if (!isOpen('result')) { if (G.place === 1 || !single) SFX.win(); else SFX.lose(); haptic(G.place === 1 ? 'success' : 'light'); }
    render(); setCoins(); show('result');
  }
  /** The ONLY place an interstitial may appear: leaving the result screen after a finished match. */
  function leaveResult(dest) {
    if (!G || G.st.phase !== 'over') return;
    hide('result');
    var seats = G.seats;
    G = null; save.game = null; persist();
    Ads.maybeInterstitial(gate).then(function () {
      persist();
      if (dest === 'again') startMatch(seats); else showHome();
    });
  }
  function doubleCoins() {
    if (!G || G.doubled || !G.coins || G.st.phase !== 'over') return;
    SFX.click();
    Ads.showRewarded(function () {
      save.coins += G.coins; G.doubled = true; persist(); SFX.coin(); showResult(); toast('Coins doubled');
    }, function () { toast('No ad available right now. Try again later.'); });
  }
  function undoMove() {
    if (!G || !G.snap || G.undoLeft <= 0 || G.st.phase === 'over') return;
    cancelFlow(); paused = true; SFX.click();
    var rewarded = false;
    Ads.showRewarded(function () {
      rewarded = true;
      G.st = G.snap; G.snap = null; G.undoLeft--; save.game = G;
      paused = false; buildPieces(); layoutPieces(true); setDiceFace(G.st.dice); SFX.undo();
      toast('Move undone. Pick again (' + G.undoLeft + ' left)');
      advance();
    }, function () { toast('No ad available right now. Try again later.'); }).then(function () {
      if (!rewarded) { paused = false; layoutPieces(true); advance(); }
    });
  }

  // ---------------- screens ----------------
  function screen(id) { ['home', 'setup', 'game'].forEach(function (k) { $(k).classList.toggle('hidden', k !== id); }); }
  function showHome() {
    cancelFlow(); paused = false;
    ['result', 'menu'].forEach(hide);
    screen('home'); updateHome(); setCoins();
  }
  function updateHome() {
    var cont = G && G.st.phase !== 'over';
    $('btn-continue').classList.toggle('hidden', !cont);
    if (cont) {
      var st = G.st;
      $('continue-sub').textContent = (hasAI(st) ? 'vs Computer' : 'Pass & Play') + ' · ' + st.players.length + ' players';
    }
  }
  var setupMode = 'ai';
  function showSetup(mode) {
    setupMode = mode; screen('setup');
    $('setup-title').textContent = mode === 'ai' ? 'Play vs Computer' : 'Pass & Play';
    renderSetup();
  }
  function renderSetup() {
    var seats = save.setup[setupMode], list = $('seat-list'); list.innerHTML = '';
    var order = [0, 1, 3, 2], pos = ['top left', 'top right', 'bottom right', 'bottom left'];
    order.forEach(function (s) {
      var x = seats[s], cur = !x ? 'off' : x.type === 'human' ? 'human' : x.level;
      var row = document.createElement('div'); row.className = 'seat';
      row.innerHTML = '<span class="sw-dot" style="background:' + seatColor(s) + '"></span><span class="sname">' + NAMES[s] + '<br><small style="color:var(--muted);font-weight:500;font-size:10px">' + pos[s] + '</small></span><div class="seg"></div>';
      var seg = row.querySelector('.seg');
      [['off', 'Off'], ['human', 'Human'], ['easy', 'Easy'], ['medium', 'Med'], ['hard', 'Hard']].forEach(function (o) {
        var b = document.createElement('button'); b.textContent = o[1]; b.dataset.v = o[0]; b.dataset.seat = s; if (o[0] === cur) b.className = 'on';
        b.addEventListener('click', function () {
          SFX.click();
          seats[s] = o[0] === 'off' ? null : o[0] === 'human' ? { type: 'human' } : { type: 'ai', level: o[0] };
          persist(); renderSetup();
        });
        seg.appendChild(b);
      });
      list.appendChild(row);
    });
    var n = seats.filter(Boolean).length, h = seats.filter(function (x) { return x && x.type === 'human'; }).length;
    var msg = n < 2 ? 'Choose at least 2 players.' : h < 1 ? 'At least one player must be human.' : '';
    $('setup-msg').textContent = msg; $('btn-start').disabled = !!msg;
    $('rule-safe').checked = save.setup.rules.safeSquares; $('rule-six').checked = save.setup.rules.extraOnSix; $('rule-cap').checked = save.setup.rules.extraOnCapture;
  }
  function showGame() {
    ['result', 'menu'].forEach(hide);
    screen('game'); paused = false;
    buildPieces(); layout(); setDiceFace(G.st.dice || 1); render();
    if (G.st.phase === 'over') { finishMatch(); return; }
    advance();
  }
  function openMenu() { if (!G) return; cancelFlow(); paused = true; layoutPieces(true); render(); persist(); show('menu'); }
  function resumeFromMenu() { hide('menu'); paused = false; layoutPieces(true); advance(); }

  function askConfirm(title, text, yes, onYes) {
    $('confirm-title').textContent = title; $('confirm-text').textContent = text; $('confirm-yes').textContent = yes;
    $('confirm-yes').onclick = function () { hide('confirm'); onYes(); };
    show('confirm');
  }

  // ---------------- stats / skins / settings ----------------
  function renderStats() {
    var S = save.stats, rate = S.played ? Math.round(S.won / S.played * 100) + '%' : '–';
    var cells = [['Matches', S.played], ['Wins', S.won], ['Win rate', rate], ['Captures', S.captures], ['Pieces home', S.home], ['Sixes rolled', S.sixes],
      ['Wins vs Easy', S.vs.easy[1] + ' / ' + S.vs.easy[0]], ['Wins vs Medium', S.vs.medium[1] + ' / ' + S.vs.medium[0]], ['Wins vs Hard', S.vs.hard[1] + ' / ' + S.vs.hard[0]], ['Pass & Play', S.pass]];
    $('stats-body').innerHTML = cells.map(function (c) { return '<div><b>' + c[1] + '</b><span>' + c[0] + '</span></div>'; }).join('');
  }
  var skinTab = 'boards';
  function renderSkins() {
    setCoins();
    Array.prototype.forEach.call($('skin-tabs').children, function (b) { b.classList.toggle('on', b.dataset.tab === skinTab); });
    var grid = $('skin-grid'); grid.innerHTML = '';
    var list = skinTab === 'boards' ? SK.BOARDS : SK.DICE, owned = save.owned[skinTab], cur = skinTab === 'boards' ? save.board : save.dice;
    list.forEach(function (it) {
      var el = document.createElement('div'); el.className = 'skin' + (it.id === cur ? ' on' : ''); el.dataset.id = it.id;
      if (skinTab === 'boards') { var cv = document.createElement('canvas'); el.appendChild(cv); drawBoard(cv, 150, it, L.DEFAULT_RULES); }
      else { var dp = document.createElement('div'); dp.className = 'dprev'; dp.style.background = it.face; dp.style.boxShadow = 'inset 0 -4px 0 ' + it.edge; dp.innerHTML = '<i></i><i></i><i></i>'; Array.prototype.forEach.call(dp.children, function (i) { i.style.background = it.pip; }); el.appendChild(dp); }
      var nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.name + (it.dark === false ? ' (light)' : ''); el.appendChild(nm);
      var b = document.createElement('button'); b.className = 'btn ' + (it.id === cur ? 'plate' : owned.indexOf(it.id) >= 0 ? 'primary' : 'plate');
      if (it.id === cur) { b.textContent = 'In use'; b.disabled = true; }
      else if (owned.indexOf(it.id) >= 0) b.textContent = 'Use';
      else { b.innerHTML = '<span class="coin-ico"></span>' + it.price; if (save.coins < it.price) b.disabled = true; }
      b.addEventListener('click', function () {
        if (owned.indexOf(it.id) < 0) {
          if (save.coins < it.price) return;
          save.coins -= it.price; owned.push(it.id); SFX.coin();
        } else SFX.click();
        if (skinTab === 'boards') save.board = it.id; else save.dice = it.id;
        persist(); applySkin(); renderSkins(); setCoins();
        if (!$('game').classList.contains('hidden')) { buildPieces(); layout(); render(); }
      });
      el.appendChild(b); grid.appendChild(el);
    });
  }
  var SETTINGS = ['sound', 'haptics', 'auto', 'fast'];
  function syncSettingsUI() {
    SETTINGS.forEach(function (k) { $('set-' + k).checked = !!save.settings[k]; });
    $('btn-privacy-options').classList.toggle('hidden', !(native && Ads.privacyOptionsRequired()));
  }

  // ---------------- input ----------------
  $('btn-continue').addEventListener('click', function () { SFX.unlock(); SFX.click(); if (G) showGame(); });
  $('btn-vs-ai').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('ai'); });
  $('btn-pass').addEventListener('click', function () { SFX.unlock(); SFX.click(); showSetup('pass'); });
  $('btn-setup-back').addEventListener('click', function () { SFX.click(); showHome(); });
  $('btn-start').addEventListener('click', function () {
    SFX.unlock(); SFX.click();
    var seats = seatsFor(setupMode);
    if (G && G.st.phase !== 'over') askConfirm('Start a new match?', 'Your saved match will be replaced.', 'Start', function () { startMatch(seats); });
    else startMatch(seats);
  });
  [['rule-safe', 'safeSquares'], ['rule-six', 'extraOnSix'], ['rule-cap', 'extraOnCapture']].forEach(function (p) {
    $(p[0]).addEventListener('change', function () { save.setup.rules[p[1]] = $(p[0]).checked; SFX.click(); persist(); });
  });
  $('dice').addEventListener('click', function () { SFX.unlock(); if (G && isHuman(G.st.turn)) doRoll(); });
  // tap near a movable piece (pieces are small on phones, so pick the nearest highlighted one)
  $('board-wrap').addEventListener('pointerdown', function (e) {
    if (!G || busy || G.st.phase !== 'move' || !isHuman(G.st.turn)) return;
    var r = $('board-wrap').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = -1, bd = Infinity;
    G.st.moves.forEach(function (m) { var p = piecePos[m.seat + '-' + m.piece]; if (!p) return; var d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = m.piece; } });
    if (best >= 0 && bd < CELL * 1.6) { SFX.unlock(); doMove(best); }
  });
  $('btn-undo').addEventListener('click', undoMove);
  $('btn-home').addEventListener('click', function () { SFX.click(); openMenu(); });
  $('btn-m-resume').addEventListener('click', function () { SFX.click(); resumeFromMenu(); });
  $('btn-m-home').addEventListener('click', function () { SFX.click(); hide('menu'); showHome(); });
  $('btn-m-restart').addEventListener('click', function () { SFX.click(); hide('menu'); askConfirm('Restart the match?', 'The current match starts again with the same players.', 'Restart', function () { startMatch(G.seats); }); });
  $('btn-r-again').addEventListener('click', function () { leaveResult('again'); });
  $('btn-r-home').addEventListener('click', function () { leaveResult('home'); });
  $('btn-r-double').addEventListener('click', doubleCoins);
  $('confirm-no').addEventListener('click', function () { SFX.click(); hide('confirm'); if (G && !$('game').classList.contains('hidden') && paused) show('menu'); });
  $('btn-stats').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderStats(); show('stats'); });
  $('btn-skins').addEventListener('click', function () { SFX.unlock(); SFX.click(); renderSkins(); show('skins'); });
  $('btn-rules').addEventListener('click', function () { SFX.unlock(); SFX.click(); show('rules'); });
  $('btn-settings').addEventListener('click', function () { SFX.unlock(); SFX.click(); syncSettingsUI(); show('settings'); });
  $('btn-game-settings').addEventListener('click', function () { SFX.click(); syncSettingsUI(); show('settings'); });
  Array.prototype.forEach.call($('skin-tabs').children, function (b) { b.addEventListener('click', function () { skinTab = b.dataset.tab; SFX.click(); renderSkins(); }); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', function () { SFX.click(); hide(b.dataset.close); }); });
  SETTINGS.forEach(function (k) {
    $('set-' + k).addEventListener('change', function () {
      save.settings[k] = $('set-' + k).checked; persist();
      if (k === 'sound') { SFX.setEnabled(save.settings.sound); SFX.unlock(); }
      if (k === 'fast') document.documentElement.style.setProperty('--step-ms', stepMs() + 'ms');
      SFX.click();
    });
  });
  $('btn-privacy-options').addEventListener('click', function () { Ads.showPrivacyOptions(); });
  $('btn-reset').addEventListener('click', function () {
    hide('settings');
    askConfirm('Reset progress?', 'Coins, skins, statistics and the saved match will be deleted.', 'Reset', function () {
      var ad = save.ad; save = defaults(); save.ad = ad; persist(); location.reload();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (!G || $('game').classList.contains('hidden') || paused) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (isHuman(G.st.turn)) doRoll(); }
    else if (/^[1-4]$/.test(e.key) && G.st.phase === 'move' && isHuman(G.st.turn)) doMove(+e.key - 1);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') { if (G) { cancelFlow(); layoutPieces(true); persist(); } }
    else if (G && !$('game').classList.contains('hidden') && !paused && !isOpen('result')) { layoutPieces(true); advance(); }
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
  applySkin(); setCoins(); updateHome();
  // consent + SDK init only: no interstitial is ever shown on launch; the banner sits on the menu / game screens
  if (Ads) Ads.init().then(function () { syncSettingsUI(); Ads.showBanner(); });

  window.__cf = {
    get game() { return G; }, get save() { return save; }, logic: L, gate: gate,
    get busy() { return busy; }, get paused() { return paused; }, get idle() { return !busy && timers.length === 0; },
    force: function (vals) { forced = vals.slice(); },
    piecePoint: function (s, i) { var r = $('board-wrap').getBoundingClientRect(), p = piecePos[s + '-' + i]; return p ? { x: r.left + p.x, y: r.top + p.y } : null; },
    layout: layout
  };
})();
