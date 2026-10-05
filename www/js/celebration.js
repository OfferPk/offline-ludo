/*
 * Crossfour v1.6.3 · Gulaab Camel win celebration.
 * An original cartoon camel (two humps, truck-art saddle blanket, pompom bridle,
 * a basket of roses and a tiny topi-wearing rider) trots onto the screen toward the
 * winning player's seat/profile, bows, rings the avatar with a rose garland (haar)
 * and showers rose petals down over it.
 *
 * Pure DOM + inline SVG + CSS keyframes (transform / opacity only) on a fixed,
 * pointer-events:none overlay, so it is WebView-safe and never touches game state.
 * prefers-reduced-motion: no walking or falling; a short static rose garland + bouquet.
 */
(function (root) {
  'use strict';

  var LAYER_ID = 'camel-celebration';
  var CAMEL_VB_W = 128, CAMEL_VB_H = 112;
  var PETAL_COLORS = ['#e11d48', '#be123c', '#f43f5e', '#fb7185', '#ff8fab', '#9f1239'];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function rectOf(r) {
    if (!r) return null;
    var left = num(r.left, num(r.x, 0)), top = num(r.top, num(r.y, 0));
    var width = num(r.width, num(r.right, left) - left), height = num(r.height, num(r.bottom, top) - top);
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }

  /**
   * Geometry for one celebration (pure; unit-tested in node).
   * rect   = the winner's seat/profile box (viewport px), anchor = its avatar box (optional).
   * The camel enters from the far side of the screen and stops with its head beside the
   * avatar: winners on the left half get a camel walking left (entering from the right edge),
   * winners on the right half get one walking right (entering from the left edge).
   */
  function plan(rect, anchor, vw, vh) {
    var r = rectOf(rect), a = rectOf(anchor) || r;
    vw = Math.max(200, num(vw, 390)); vh = Math.max(200, num(vh, 844));
    var W = clamp(Math.round(vw * 0.34), 108, 170), H = Math.round(W * CAMEL_VB_H / CAMEL_VB_W);
    var acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    var leftSide = acx < vw / 2;
    var dir = leftSide ? -1 : 1;
    var gap = 4;
    var x1 = leftSide ? a.right + gap : a.left - W - gap;
    x1 = clamp(x1, 4, Math.max(4, vw - W - 4));
    var x0 = leftSide ? vw + 12 : -W - 12;
    var upper = acy < vh / 2;
    var y = upper ? Math.max(4, r.top - H * 0.42) : Math.min(vh - H - 4, r.bottom - H * 0.58);
    y = clamp(y, 4, Math.max(4, vh - H - 4));
    var spreadPx = clamp(r.width * 0.45, 60, 110);
    var walkMs = Math.round(clamp(Math.abs(x1 - x0) / 160 * 1000, 1500, 2800));
    var petalTop = Math.max(-30, a.top - 150);
    var petalFall = Math.max(180, Math.min(vh + 40, a.bottom + 130) - petalTop);
    return {
      w: W, h: H, dir: dir, side: leftSide ? 'left' : 'right', upper: upper,
      x0: Math.round(x0), x1: Math.round(x1), y: Math.round(y), walkMs: walkMs,
      cx: Math.round(acx), cy: Math.round(acy),
      ring: Math.round(Math.max(a.width, a.height) / 2 + 8),
      petalTop: Math.round(petalTop), petalFall: Math.round(petalFall),
      petalSpread: Math.round(clamp(r.width * 0.45, 60, 110)),
      petalCx: Math.round(clamp(acx, Math.min(vw / 2, spreadPx + 6), Math.max(vw / 2, vw - spreadPx - 6)))
    };
  }

  function roseSVG(cls) {
    return '<svg class="' + (cls || 'cc-rose') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 15 C10 18 9 20 9 23" stroke="#2f8f4e" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '<path d="M10.4 19.5 C7.5 18.6 6.6 20.5 6 21.6 C8.2 21.8 9.6 21 10.4 19.5Z" fill="#3fae5f"/>' +
      '<circle cx="12" cy="10" r="7" fill="#e11d48"/>' +
      '<path d="M5.6 9.2 C6.6 13.8 10 15.6 12 15.6 C14 15.6 17.4 13.8 18.4 9.2 C16.4 12 14 12.6 12 12.6 C10 12.6 7.6 12 5.6 9.2Z" fill="#be123c"/>' +
      '<path d="M12 6.2 C14.6 6.2 15.6 8.4 14.6 10 C13.6 11.6 10.8 11.4 10.4 9.6 C10.1 8.4 11.2 7.8 12 8.4" stroke="#9f1239" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
      '<circle cx="9.4" cy="7.4" r="1.2" fill="#fff" opacity=".45"/></svg>';
  }

  // Small rose head used inside the camel art (cx, cy, scale).
  function miniRose(x, y, s, c1, c2) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')">' +
      '<circle r="4.2" fill="' + c1 + '"/><path d="M-3.6 -0.4 C-3 2.6 -1 3.6 0 3.6 C1 3.6 3 2.6 3.6 -0.4 C2.4 1.4 1 1.8 0 1.8 C-1 1.8 -2.4 1.4 -3.6 -0.4Z" fill="' + c2 + '"/>' +
      '<path d="M0 -2.2 C1.6 -2.2 2.2 -0.8 1.6 0.2 C1 1 -0.6 0.9 -0.8 -0.1" stroke="#7f1d3a" stroke-width=".8" fill="none" stroke-linecap="round"/></g>';
  }

  function leg(x, y, cls, fill, hoof) {
    return '<g transform="translate(' + x + ' ' + y + ')"><g class="cc-leg ' + cls + '">' +
      '<path d="M-4.2 0 H4.2 L3.4 13 Q3.2 15 4 16.5 L3.2 27 H-3.2 L-4 16.5 Q-3.2 15 -3.4 13 Z" fill="' + fill + '"/>' +
      '<ellipse cx="0" cy="16" rx="3.6" ry="2.2" fill="' + fill + '" opacity=".9"/>' +
      '<path d="M-4.6 26 H4.6 Q5.4 30 3.6 30.5 H-3.6 Q-5.4 30 -4.6 26Z" fill="' + hoof + '"/></g></g>';
  }

  /** Original cartoon camel art (faces right in its own coordinates). */
  function camelSVG(withRider) {
    var body = '#e2ab62', shade = '#c98c45', light = '#f3cf92', near = '#d9a058', far = '#bb7f3d', hoof = '#6b4423';
    var s = '<svg class="cc-camel-svg" viewBox="0 0 ' + CAMEL_VB_W + ' ' + CAMEL_VB_H + '" aria-hidden="true" focusable="false">';
    s += '<ellipse class="cc-shadow" cx="62" cy="106" rx="42" ry="4.5" fill="rgba(0,0,0,.25)"/>';
    // far legs (darker, behind the body)
    s += leg(44, 72, 'cc-leg-b', far, '#4f321a') + leg(86, 72, 'cc-leg-a', far, '#4f321a');
    s += '<g class="cc-bob">';
    // tail with tuft
    s += '<path d="M27 58 C20 60 18 68 20 76" stroke="' + shade + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M20 74 C16 78 18 84 21 85 C23 82 24 78 20 74Z" fill="#8a5a2b"/>';
    // body with two humps
    s += '<path d="M26 64 C24 52 30 44 35 42 C35 22 54 12 57 38 C60 20 78 14 79 42 C88 44 96 50 96 60 C96 72 86 80 72 80 L42 80 C32 80 27 74 26 64 Z" fill="' + body + '"/>' +
      '<path d="M39 32 C41 25 46 22 50 24" stroke="' + light + '" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>' +
      '<path d="M63 32 C65 26 69 24 73 26" stroke="' + light + '" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>' +
      '<ellipse cx="60" cy="74" rx="26" ry="5.5" fill="' + light + '" opacity=".55"/>' +
      '<path d="M30 70 C34 78 42 80 50 80" stroke="' + shade + '" stroke-width="2" fill="none" opacity=".55"/>';
    // truck-art saddle blanket between the humps, with tassels
    s += '<path d="M47 41 Q57 33 66 41 L70 64 Q57 71 44 64 Z" fill="#d62f4b"/>' +
      '<path d="M46.4 47 Q57 40 67 47" stroke="#2fa36b" stroke-width="3" fill="none"/>' +
      '<path d="M45.4 55 Q57 49 68.6 55" stroke="#f4b740" stroke-width="2.2" fill="none"/>' +
      '<path d="M44 64 Q57 71 70 64" stroke="#f4b740" stroke-width="1.6" fill="none"/>' +
      '<circle cx="57" cy="59" r="2.2" fill="#fff4c2"/><circle cx="51" cy="60" r="1.3" fill="#7dd3fc"/><circle cx="63" cy="60" r="1.3" fill="#7dd3fc"/>';
    ['46,66', '51,68.4', '57,69.4', '63,68.4', '68,66'].forEach(function (p, i) {
      var xy = p.split(',');
      s += '<circle cx="' + xy[0] + '" cy="' + (+xy[1] + 2.4) + '" r="1.7" fill="' + (i % 2 ? '#2fa36b' : '#f4b740') + '"/>';
    });
    // rose basket hanging on the side
    s += '<path d="M60 63 L82 63 L79 77 Q71 80 63 77 Z" fill="#a8743a" stroke="#7a5026" stroke-width="1"/>' +
      '<path d="M61.6 67.5 H80.6 M62.6 72 H79.6" stroke="#7a5026" stroke-width=".9" opacity=".8"/>' +
      '<path d="M66 63 V77 M71 63 V79 M76 63 V77" stroke="#7a5026" stroke-width=".7" opacity=".55"/>' +
      '<path d="M63 62 C62 58 64 56 66 57 M79 62 C81 58 78 56 76 57" stroke="#2f8f4e" stroke-width="1.4" fill="none"/>' +
      '<ellipse cx="62.5" cy="60" rx="3" ry="1.6" fill="#3fae5f" transform="rotate(-30 62.5 60)"/>' +
      '<ellipse cx="80" cy="60" rx="3" ry="1.6" fill="#3fae5f" transform="rotate(30 80 60)"/>' +
      miniRose(66, 60, 1, '#e11d48', '#be123c') + miniRose(72, 58.5, 1.08, '#f43f5e', '#e11d48') + miniRose(77.5, 60.5, 0.95, '#be123c', '#9f1239') + miniRose(69, 62.5, 0.8, '#fb7185', '#f43f5e');
    // neck + head (bows on arrival)
    s += '<g class="cc-head">' +
      '<path d="M84 52 C92 46 96 36 99 26 L111 30 C107 42 103 54 95 64 Z" fill="' + body + '"/>' +
      '<path d="M90 50 C95 44 98 38 100 32" stroke="' + light + '" stroke-width="2" fill="none" opacity=".6" stroke-linecap="round"/>' +
      // pompom bridle (original decoration)
      '<path d="M93 40 C98 42 104 42 110 36" stroke="#f4b740" stroke-width="1.6" fill="none"/>' +
      '<circle cx="95" cy="43" r="2.3" fill="#e11d48"/><circle cx="100.5" cy="44" r="2.3" fill="#2fa36b"/><circle cx="106" cy="41.6" r="2.3" fill="#f4b740"/>' +
      '<ellipse cx="103" cy="15.5" rx="2.4" ry="4" fill="' + shade + '" transform="rotate(-24 103 15.5)"/>' +
      '<ellipse cx="108" cy="24" rx="12" ry="9.2" fill="' + body + '"/>' +
      '<ellipse cx="117.5" cy="27.5" rx="7.6" ry="6.6" fill="' + light + '"/>' +
      '<path d="M121.6 25.2 Q123 25.6 123.2 27" stroke="#6b4423" stroke-width="1" fill="none" stroke-linecap="round"/>' +
      '<path d="M113 31 Q117.5 34.6 122 31.4" stroke="#6b4423" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
      '<circle cx="110.5" cy="28.6" r="2.6" fill="#ff8fab" opacity=".55"/>' +
      '<ellipse cx="108.6" cy="20.6" rx="2.6" ry="3" fill="#2a1a10"/><circle cx="109.5" cy="19.6" r="1" fill="#fff"/>' +
      '<path d="M105.6 17.6 L104.2 16.2 M107.4 16.9 L106.8 15.2 M109.4 16.9 L109.6 15.2" stroke="#2a1a10" stroke-width=".8" stroke-linecap="round"/>' +
      // a rose held in the mouth
      '<path d="M121 32 C124 34 125 37 125 40" stroke="#2f8f4e" stroke-width="1.3" fill="none"/>' + miniRose(125, 41.5, 0.75, '#e11d48', '#be123c') +
      '</g>';
    if (withRider !== false) {
      // tiny original rider: topi cap, kurta, waving a rose
      s += '<g class="cc-rider">' +
        '<path d="M53 40 L50 52 M61 40 L63 51" stroke="#2c3e75" stroke-width="3.2" stroke-linecap="round"/>' +
        '<circle cx="50" cy="53" r="1.8" fill="#6b4423"/><circle cx="63" cy="52" r="1.8" fill="#6b4423"/>' +
        '<path d="M50.5 26 Q57 22 63.5 26 L64.5 42 Q57 45 49.5 42 Z" fill="#3c7be0"/>' +
        '<path d="M57 26 V42" stroke="#fff" stroke-width=".8" opacity=".6"/>' +
        '<path d="M51 30 C47 32 46 36 48 38" stroke="#f2c196" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<g class="cc-wave"><path d="M63 29 C67 26 69 20 70 15" stroke="#f2c196" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
        '<path d="M70 15 C70.5 12 71 10 71.4 8" stroke="#2f8f4e" stroke-width="1.1" fill="none"/>' + miniRose(71.6, 6.2, 0.82, '#f43f5e', '#e11d48') + '</g>' +
        '<circle cx="57" cy="18" r="7" fill="#f2c196"/>' +
        '<path d="M50 16.6 Q57 6.4 64 16.6 Z" fill="#f4b740"/><path d="M50.2 16.4 H63.8" stroke="#d62f4b" stroke-width="2"/>' +
        '<circle cx="54.6" cy="11.6" r=".9" fill="#2fa36b"/><circle cx="58.6" cy="10.6" r=".9" fill="#d62f4b"/>' +
        '<circle cx="54.6" cy="19.2" r="1" fill="#2a1a10"/><circle cx="59.6" cy="19.2" r="1" fill="#2a1a10"/>' +
        '<path d="M55 22.2 Q57.2 24 59.4 22.2" stroke="#8a3b2b" stroke-width=".9" fill="none" stroke-linecap="round"/>' +
        '<circle cx="53" cy="21.4" r="1.2" fill="#ff8fab" opacity=".6"/><circle cx="61.2" cy="21.4" r="1.2" fill="#ff8fab" opacity=".6"/>' +
        '</g>';
    }
    s += '</g>';
    // near legs (in front of the body)
    s += leg(36, 72, 'cc-leg-a', near, hoof) + leg(92, 72, 'cc-leg-b', near, hoof);
    s += '</svg>';
    return s;
  }

  var current = null;

  function clearTimers(c) { (c.timers || []).forEach(function (t) { clearTimeout(t); }); c.timers = []; }
  function stop() {
    if (!current) return;
    clearTimers(current);
    if (current.layer && current.layer.parentNode) current.layer.parentNode.removeChild(current.layer);
    current = null;
  }

  function prefersReduced() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function boxOf(el) {
    if (!el) return null;
    if (typeof el.getBoundingClientRect === 'function') return rectOf(el.getBoundingClientRect());
    return rectOf(el);
  }

  /**
   * Plays the celebration toward opts.target (seat/profile element or rect).
   * opts: { target, anchor, color, seat, reduced, rider, parent }
   * Returns the plan, or null when there is nothing visible to celebrate.
   */
  function play(opts) {
    opts = opts || {};
    var doc = root.document;
    if (!doc || !doc.body) return null;
    var rect = boxOf(opts.target), anchor = boxOf(opts.anchor) || rect;
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    stop();
    var vw = root.innerWidth || doc.documentElement.clientWidth || 390;
    var vh = root.innerHeight || doc.documentElement.clientHeight || 844;
    var p = plan(rect, anchor, vw, vh);
    var reduced = opts.reduced == null ? prefersReduced() : !!opts.reduced;
    var color = opts.color || '#f4b740';

    var layer = doc.createElement('div');
    layer.id = LAYER_ID;
    layer.className = 'camel-cel' + (reduced ? ' reduced' : '');
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.seat = opts.seat == null ? '' : String(opts.seat);
    layer.dataset.side = p.side;
    layer.dataset.state = reduced ? 'static' : 'walking';
    layer.style.setProperty('--cc-color', color);

    var c = { layer: layer, plan: p, timers: [] };
    current = c;

    // rose garland (haar) around the winner's avatar
    var garland = doc.createElement('div');
    garland.className = 'cc-garland';
    garland.style.left = p.cx + 'px'; garland.style.top = p.cy + 'px';
    garland.style.setProperty('--cc-ring', p.ring + 'px');
    var halo = doc.createElement('i'); halo.className = 'cc-halo'; garland.appendChild(halo);
    var nRoses = 10;
    for (var g = 0; g < nRoses; g++) {
      var ang = g / nRoses * Math.PI * 2 - Math.PI / 2;
      var gr = doc.createElement('span');
      gr.className = 'cc-garland-rose';
      gr.style.setProperty('--gx', Math.round(Math.cos(ang) * p.ring) + 'px');
      gr.style.setProperty('--gy', Math.round(Math.sin(ang) * p.ring) + 'px');
      gr.style.setProperty('--gd', (g * 45) + 'ms');
      gr.innerHTML = roseSVG();
      garland.appendChild(gr);
    }
    layer.appendChild(garland);

    // bouquet popping above the avatar
    var bouquet = doc.createElement('div');
    bouquet.className = 'cc-bouquet';
    bouquet.style.left = p.cx + 'px';
    bouquet.style.top = (p.upper ? p.cy + p.ring + 10 : p.cy - p.ring - 40) + 'px';
    bouquet.innerHTML = roseSVG('cc-rose b1') + roseSVG('cc-rose b2') + roseSVG('cc-rose b3');
    layer.appendChild(bouquet);

    if (reduced) {
      layer.classList.add('arrived');
      (opts.parent || doc.body).appendChild(layer);
      c.timers.push(setTimeout(function () { if (current === c) stop(); }, 1800));
      return p;
    }

    // the camel
    var walker = doc.createElement('div');
    walker.className = 'cc-walker';
    walker.style.width = p.w + 'px'; walker.style.height = p.h + 'px';
    walker.style.setProperty('--x0', p.x0 + 'px');
    walker.style.setProperty('--x1', p.x1 + 'px');
    walker.style.setProperty('--y', p.y + 'px');
    walker.style.setProperty('--walk', p.walkMs + 'ms');
    var flip = doc.createElement('div');
    flip.className = 'cc-flip' + (p.dir < 0 ? ' face-left' : '');
    flip.innerHTML = camelSVG(opts.rider !== false);
    walker.appendChild(flip);
    layer.appendChild(walker);

    // rose petal shower over the winner's seat
    var petals = doc.createElement('div');
    petals.className = 'cc-petals';
    var nPetals = 30;
    for (var i = 0; i < nPetals; i++) {
      var pe = doc.createElement('i');
      pe.className = 'cc-petal' + (i % 5 === 0 ? ' wide' : i % 3 === 0 ? ' small' : '');
      var spread = ((i * 47) % 100) / 100 * 2 - 1; // -1..1, deterministic
      pe.style.left = Math.round(p.petalCx + spread * p.petalSpread) + 'px';
      pe.style.top = p.petalTop + 'px';
      pe.style.setProperty('--fall', (p.petalFall - (i * 13 % 60)) + 'px');
      pe.style.setProperty('--sway', ((i % 2 ? 1 : -1) * (14 + i * 7 % 26)) + 'px');
      pe.style.setProperty('--rot', ((i * 83 % 540) - 270) + 'deg');
      pe.style.setProperty('--pd', (i * 53 % 1600) + 'ms');
      pe.style.setProperty('--pdur', (1700 + i * 37 % 800) + 'ms');
      pe.style.setProperty('--pc', PETAL_COLORS[i % PETAL_COLORS.length]);
      petals.appendChild(pe);
    }
    layer.appendChild(petals);

    (opts.parent || doc.body).appendChild(layer);

    var T = p.walkMs;
    c.timers.push(setTimeout(function () { if (current !== c) return; layer.classList.add('showering'); }, Math.max(0, T - 150)));
    c.timers.push(setTimeout(function () { if (current !== c) return; layer.classList.add('arrived'); layer.dataset.state = 'arrived'; }, T));
    c.timers.push(setTimeout(function () { if (current !== c) return; layer.classList.add('leaving'); layer.dataset.state = 'leaving'; }, T + 2900));
    c.timers.push(setTimeout(function () { if (current === c) stop(); }, T + 4200));
    return p;
  }

  var api = {
    plan: plan, play: play, stop: stop, camelSVG: camelSVG, roseSVG: roseSVG,
    get active() { return !!current; },
    get state() { return current ? current.layer.dataset.state : 'idle'; }
  };
  root.CamelCelebration = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
