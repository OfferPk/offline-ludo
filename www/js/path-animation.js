/* Per-square token motion. Kept separate from game rules so the sequence can be tested without a browser. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PathAnimation = api;
}(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  function animate(options) {
    options = options || {};
    var el = options.el, points = Array.isArray(options.points) ? options.points : [];
    var start = options.start || points[0] || { x: 0, y: 0 };
    var duration = Math.max(1, Number(options.duration) || 140);
    var arcHeight = Math.max(0, Number(options.arcHeight) || 0);
    var reduced = !!options.reducedMotion;
    var request = options.requestAnimationFrame || root.requestAnimationFrame;
    var cancelRequest = options.cancelAnimationFrame || root.cancelAnimationFrame;
    var settled = false, frameId = null, frameIsTimeout = false, index = 0;
    var originalTransition = el && el.style ? el.style.transition : '';

    function report(error) {
      try { if (typeof options.onError === 'function') options.onError(error); } catch (ignored) {}
    }
    function removeFrame() {
      if (frameId == null) return;
      try {
        if (frameIsTimeout) root.clearTimeout(frameId);
        else if (typeof cancelRequest === 'function') cancelRequest.call(root, frameId);
      } catch (error) { report(error); }
      frameId = null;
    }
    function cleanup() {
      removeFrame();
      if (!el) return;
      try { el.classList.remove('hop'); } catch (error) { report(error); }
      try { el.style.transition = originalTransition; } catch (error) { report(error); }
    }
    function complete() {
      if (settled) return;
      settled = true;
      cleanup();
      try { if (typeof options.onComplete === 'function') options.onComplete(); } catch (error) { report(error); }
    }
    function apply(point, lift, sx, sy) {
      if (!el || !el.style) return;
      var x = Number(point.x), y = Number(point.y) - (lift || 0);
      if (!isFinite(x) || !isFinite(y)) throw new Error('Invalid token animation point');
      el.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + (sx == null ? 1 : sx).toFixed(3) + ',' + (sy == null ? 1 : sy).toFixed(3) + ')';
    }
    function finishAtEndpoint() {
      try { if (el && points.length) apply(points[points.length - 1], 0, 1, 1); } catch (error) { report(error); }
    }
    function fail(error) {
      if (settled) return;
      report(error);
      finishAtEndpoint();
      complete();
    }
    function cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      try { if (typeof options.onCancel === 'function') options.onCancel(); } catch (error) { report(error); }
    }
    function schedule(fn) {
      try {
        if (typeof request === 'function') {
          frameIsTimeout = false;
          frameId = request.call(root, fn);
        } else {
          frameIsTimeout = true;
          frameId = root.setTimeout(function () { fn(Date.now()); }, 16);
        }
      } catch (error) { fail(error); }
    }
    function stepSound(step) {
      if (typeof options.onStep === 'function') options.onStep(step);
    }

    if (!el || !points.length) { complete(); return cancel; }
    if (reduced) {
      try {
        for (var r = 0; r < points.length; r++) {
          apply(points[r], 0, 1, 1);
          stepSound(r);
        }
        complete();
      } catch (error) { fail(error); }
      return cancel;
    }

    // v1.9.0: one continuous timeline. Leftover time carries into the next hop, so a late frame never
    // adds a pause between squares, and several squares can settle in one slow frame without drifting.
    var began = null;
    try {
      el.style.transition = 'none';
      el.style.willChange = 'transform';
      el.classList.add('hop');
      apply(start, 0, 1, 1);
      schedule(frame);
    } catch (error) { fail(error); }

    function frame(time) {
      frameId = null;
      if (settled) return;
      try {
        var now = typeof time === 'number' ? time : Date.now();
        if (began == null) began = now;
        var elapsed = Math.max(0, now - began);
        var target = Math.min(points.length, Math.floor(elapsed / duration));
        while (index < target) { apply(points[index], 0, 1, 1); stepSound(index); index++; }
        if (index >= points.length) { apply(points[points.length - 1], 0, 1, 1); try { el.style.willChange = ''; } catch (e) {} complete(); return; }
        var from = index === 0 ? start : points[index - 1], to = points[index];
        var linear = Math.max(0, Math.min(1, (elapsed - index * duration) / duration));
        var eased = linear < 0.5 ? 4 * linear * linear * linear : 1 - Math.pow(-2 * linear + 2, 3) / 2;
        var arc = 4 * linear * (1 - linear);
        apply({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased }, arcHeight * arc,
          1 + 0.07 * arc, 1 - 0.09 * arc);
        schedule(frame);
      } catch (error) { fail(error); }
    }
    return cancel;
  }

  return { animate: animate };
}));
