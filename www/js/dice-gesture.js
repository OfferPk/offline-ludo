/* Pointer swipe/flick recognition for the dice button; clicks remain the accessible fallback. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiceGesture = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SWIPE_DISTANCE = 24;
  var FLICK_DISTANCE = 14;
  var FLICK_MAX_MS = 240;
  var FLICK_MIN_SPEED = 0.6;
  var CLICK_SUPPRESS_MS = 500;
  var CLICK_SUPPRESS_RADIUS = 48;

  function eventTime(event) {
    return typeof event.timeStamp === 'number' ? event.timeStamp : Date.now();
  }

  function bind(button, onTap, onSwipe) {
    var start = null;
    var suppressedClick = null;
    var suppressionTimer = null;

    function clearSuppression() {
      suppressedClick = null;
      if (suppressionTimer !== null) clearTimeout(suppressionTimer);
      suppressionTimer = null;
    }

    function down(event) {
      if (event.isPrimary === false || (event.button != null && event.button !== 0) || button.disabled) return;
      // A new pointer sequence is a fresh gesture; do not let an absent synthetic
      // click from an earlier swipe suppress this interaction.
      clearSuppression();
      start = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        at: eventTime(event)
      };
      if (button.setPointerCapture && event.pointerId != null) {
        try { button.setPointerCapture(event.pointerId); } catch (e) {}
      }
    }

    function up(event) {
      if (!start || (start.id != null && event.pointerId != null && start.id !== event.pointerId)) return;
      var origin = start;
      start = null;
      if (button.disabled) return;

      var dx = event.clientX - origin.x;
      var dy = event.clientY - origin.y;
      var distance = Math.hypot(dx, dy);
      var elapsed = Math.max(1, eventTime(event) - origin.at);
      var isSwipe = distance >= SWIPE_DISTANCE;
      var isFlick = distance >= FLICK_DISTANCE && elapsed <= FLICK_MAX_MS && distance / elapsed >= FLICK_MIN_SPEED;
      if (!isSwipe && !isFlick) return;

      if (event.preventDefault) event.preventDefault();
      suppressedClick = { x: event.clientX, y: event.clientY, at: eventTime(event) };
      suppressionTimer = setTimeout(clearSuppression, CLICK_SUPPRESS_MS);
      onSwipe(event);
    }

    function cancel(event) {
      if (!start || event.pointerId == null || start.id == null || start.id === event.pointerId) start = null;
    }

    function click(event) {
      if (suppressedClick && event.detail > 0 && eventTime(event) - suppressedClick.at <= CLICK_SUPPRESS_MS &&
          Math.hypot(event.clientX - suppressedClick.x, event.clientY - suppressedClick.y) <= CLICK_SUPPRESS_RADIUS) {
        clearSuppression();
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        return;
      }
      onTap(event);
    }

    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', cancel);
    // Browsers may release capture without a separate pointercancel when an
    // interaction is interrupted (for example, by a context or DOM change).
    button.addEventListener('lostpointercapture', cancel);
    button.addEventListener('click', click);

    return function unbind() {
      start = null;
      clearSuppression();
      button.removeEventListener('pointerdown', down);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', cancel);
      button.removeEventListener('lostpointercapture', cancel);
      button.removeEventListener('click', click);
    };
  }

  return { bind: bind };
});
