'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.OnlineProfileNameFeedback = api.init(root.document);
})(typeof window !== 'undefined' ? window : null, function () {
  var MAX_NAME_LENGTH = 32;

  function getFeedback(value) {
    var trimmed = String(value == null ? '' : value).trim();
    var count = trimmed.length;
    var valid = count >= 1 && count <= MAX_NAME_LENGTH;
    var message = count === 0
      ? '0 of 32 characters. Enter a name after trimming.'
      : count > MAX_NAME_LENGTH
        ? count + ' of 32 characters. Shorten the name to 32 or fewer.'
        : count + ' of 32 characters.';
    return { count: count, valid: valid, message: message };
  }

  function init(document) {
    if (!document || typeof document.getElementById !== 'function') return null;
    var input = document.getElementById('online-profile-name');
    var feedback = document.getElementById('online-profile-name-feedback');
    if (!input || !feedback) return null;

    function update() {
      var state = getFeedback(input.value);
      feedback.textContent = state.message;
      feedback.setAttribute('data-valid', String(state.valid));
      return state;
    }

    input.addEventListener('input', update);
    update();
    return {
      update: update,
      setValue: function (value) {
        input.value = value == null ? '' : String(value);
        return update();
      }
    };
  }

  return { MAX_NAME_LENGTH: MAX_NAME_LENGTH, getFeedback: getFeedback, init: init };
});
