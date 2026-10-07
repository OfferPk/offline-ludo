/* Synthesized SFX with WebAudio (no audio files): dice rattle, token steps, captures, chimes. */
(function () {
  'use strict';
  var ctx = null, master = null, enabled = true;
  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  var noiseBuf = null;
  function noise(c) {
    if (noiseBuf) return noiseBuf;
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.35, c.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function tick(t, freq, vol, dur) {
    var c = ctx, src = c.createBufferSource(); src.buffer = noise(c);
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 9;
    var g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
  }
  function ting(t, base, vol, dur) {
    var c = ctx, ratios = [1, 2.76, 5.4, 8.93];
    ratios.forEach(function (r, i) {
      var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = base * r;
      var g = c.createGain(); var v = vol / (i + 1.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + i * 0.55));
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  function thud(t, vol) {
    var c = ctx, o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    var g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
  }
  function softTap(t, freq, vol) {
    var c = ctx, o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    var g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.05);
  }
  var S = {
    setEnabled: function (v) { enabled = !!v; },
    unlock: function () { if (enabled) ac(); },
    roll: function () {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime;
      for (var i = 0; i < 9; i++) tick(t + i * 0.048 + Math.random() * 0.018, 900 + Math.random() * 1800, 0.24 - i * 0.018, 0.04);
      thud(t + 0.38, 0.18);
    },
    land: function (six) {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime; thud(t, 0.34); tick(t, 1700, 0.22, 0.045);
      if (six) { ting(t + 0.04, 1175, 0.16, 0.55); ting(t + 0.11, 1568, 0.14, 0.65); softTap(t + 0.18, 2093, 0.05); }
    },
    step: function (i) {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime, n = (i || 0) % 6;
      tick(t, 1050 + n * 115, 0.18, 0.028);
      softTap(t + 0.01, 620 + n * 40, 0.04);
    },
    crystal: function (i) { if (!enabled || !ac()) return; ting(ctx.currentTime, 1760 + (i || 0) % 3 * 110, 0.032, 0.15); },
    leave: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; ting(t, 660, 0.15, 0.42); ting(t + 0.05, 990, 0.13, 0.48); softTap(t + 0.1, 1320, 0.05); },
    capture: function () {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime; thud(t, 0.55); tick(t + 0.015, 520, 0.32, 0.13);
      ting(t + 0.04, 349, 0.14, 0.45); ting(t + 0.1, 277, 0.1, 0.4);
    },
    captured: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [440, 370, 294].forEach(function (f, i) { ting(t + i * 0.08, f, 0.12, 0.5); }); },
    home: function () {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime;
      [784, 988, 1175, 1480, 1760].forEach(function (f, i) { ting(t + i * 0.055, f, 0.14, 0.75); });
      softTap(t + 0.28, 2093, 0.06);
    },
    forfeit: function () { if (!enabled || !ac()) return; thud(ctx.currentTime, 0.45); },
    turn: function () { if (!enabled || !ac()) return; ting(ctx.currentTime, 1320, 0.09, 0.32); },
    incomingChessMove: function (previous, next, room, userId) {
      if (!previous || !next || !room || room.mode !== 'ludo_chess' || !Array.isArray(room.roster) ||
          typeof previous.board !== 'string' || previous.board.length !== 64 || typeof next.board !== 'string' || next.board.length !== 64 ||
          previous.phase !== 'active' || (next.phase !== 'active' && next.phase !== 'over') || previous.board === next.board) return false;
      var move = next.last_move, nextTurn = Number(next.turn), previousTurn = Number(previous.turn);
      if (!move || !Number.isInteger(move.from) || !Number.isInteger(move.to) || move.from < 0 || move.from > 63 || move.to < 0 || move.to > 63 ||
          (nextTurn !== 0 && nextTurn !== 1) || (previousTurn !== 0 && previousTurn !== 1) || previousTurn === nextTurn) return false;
      if (typeof userId !== 'string' || !userId) return false;
      var member = room.roster.find(function (candidate) { return candidate.user_id === userId; });
      if (!member || Number(member.seat) !== nextTurn) return false;
      if (enabled && ac()) {
        var t = ctx.currentTime;
        if (move.capture || move.en_passant) {
          softTap(t, 660, 0.055); softTap(t + 0.045, 880, 0.04);
        } else {
          softTap(t, 1175, 0.035); softTap(t + 0.035, 1568, 0.025);
        }
      }
      return true;
    },
    win: function () {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime;
      [523, 659, 784, 1046, 1318, 1568].forEach(function (f, i) { ting(t + i * 0.09, f, 0.2, 1.25); });
      thud(t + 0.05, 0.2);
    },
    lose: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [523, 440, 349].forEach(function (f, i) { ting(t + i * 0.16, f, 0.2, 1.0); }); },
    click: function () {
      if (!enabled || !ac()) return;
      var t = ctx.currentTime; softTap(t, 2400, 0.07); tick(t, 3400, 0.1, 0.018);
    },
    coin: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; ting(t, 1760, 0.18, 0.3); ting(t + 0.07, 2350, 0.16, 0.35); },
    spinTick: function (i) { if (!enabled || !ac()) return; tick(ctx.currentTime, 2400 + (i % 3) * 200, 0.12, 0.02); },
    good: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [880, 1109, 1319].forEach(function (f, i) { ting(t + i * 0.07, f, 0.13, 0.55); }); },
    bad: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; thud(t, 0.35); ting(t + 0.03, 247, 0.14, 0.5); ting(t + 0.12, 208, 0.12, 0.5); },
    zap: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; for (var i = 0; i < 5; i++) tick(t + i * 0.03, 3000 - i * 400, 0.25, 0.05); thud(t + 0.1, 0.4); },
    freeze: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [2093, 2637, 3136].forEach(function (f, i) { ting(t + i * 0.05, f, 0.07, 0.6); }); },
    pop: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; tick(t, 900, 0.2, 0.04); ting(t + 0.02, 1568, 0.06, 0.18); },
    bomb: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; thud(t, 0.7); thud(t + 0.05, 0.5); for (var i = 0; i < 6; i++) tick(t + i * 0.025, 300 + i * 90, 0.35 - i * 0.04, 0.14); },
    mega: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [392, 523, 659, 784, 1046].forEach(function (f, i) { ting(t + i * 0.07, f, 0.16, 0.9); }); },
    crown: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [659, 831, 988, 1319].forEach(function (f, i) { ting(t + i * 0.09, f, 0.16, 1.1); }); },
    revenge: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; thud(t, 0.35); [330, 392, 494].forEach(function (f, i) { ting(t + 0.05 + i * 0.07, f, 0.12, 0.5); }); },
    danger: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; [0, 0.16].forEach(function (d) { ting(t + d, 880, 0.12, 0.2); ting(t + d + 0.08, 660, 0.12, 0.2); }); },
    undo: function () { if (!enabled || !ac()) return; var t = ctx.currentTime; tick(t, 900, 0.2, 0.06); tick(t + 0.06, 1400, 0.16, 0.05); }
  };
  window.SFX = S;
})();
