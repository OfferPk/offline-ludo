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

    try {
      el.style.transition = 'none';
      el.classList.add('hop');
      apply(start, 0, 1, 1);
      runSegment();
    } catch (error) { fail(error); }

    function runSegment() {
      if (settled) return;
      if (index >= points.length) { complete(); return; }
      var from = index === 0 ? start : points[index - 1];
      var to = points[index], began = null;
      schedule(function frame(time) {
        frameId = null;
        if (settled) return;
        try {
          if (began == null) began = typeof time === 'number' ? time : Date.now();
          var now = typeof time === 'number' ? time : Date.now();
          var linear = Math.max(0, Math.min(1, (now - began) / duration));
          var eased = linear * linear * (3 - 2 * linear);
          var arc = Math.sin(Math.PI * eased);
          var point = { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
          apply(point, arcHeight * arc, 1 + 0.045 * arc, 1 - 0.055 * arc);
          if (linear < 1) { schedule(frame); return; }
          apply(to, 0, 1, 1);
          stepSound(index);
          index++;
          if (index >= points.length) complete();
          else runSegment();
        } catch (error) { fail(error); }
      });
    }
    return cancel;
  }

  return { animate: animate };
}));
