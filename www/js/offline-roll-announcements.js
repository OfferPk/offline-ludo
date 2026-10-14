(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OfflineRollAnnouncements = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function text(value, limit) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit || 80);
  }

  function validInteger(value, min, max) {
    var number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : null;
  }

  function format(result) {
    if (!result || typeof result !== 'object') return '';
    var raw = validInteger(result.raw, 1, 6);
    if (raw === null) return '';

    var actor = text(result.actor, 80) || 'Player';
    var verb = result.chosen ? 'selected' : 'rolled';
    var message = actor + ' ' + verb + ' ' + raw + '.';
    var value = validInteger(result.value, 1, 12);
    if (result.doubled && value !== null && value !== raw) {
      message += ' The move value is doubled to ' + value + '.';
    }

    if (result.forfeit) {
      message += actor === 'You'
        ? ' Three sixes in a row; your turn is forfeited.'
        : ' Three sixes in a row; this turn is forfeited.';
      return message;
    }

    if (result.next === 'move') {
      var dice = Array.isArray(result.queue)
        ? result.queue.map(function (item) { return validInteger(item, 1, 12); }).filter(function (item) { return item !== null; }).slice(0, 12)
        : [];
      if (dice.length > 1) message += ' Dice available: ' + dice.join(', ') + '.';
      var count = validInteger(result.legalTokenCount, 0, 16);
      if (count === 1) message += ' One token can move.';
      else if (count !== null && count > 1) message += ' ' + count + ' tokens can move.';
      else message += ' Choose a highlighted token.';
    } else if (result.next === 'roll') {
      message += ' Roll again.';
    } else if (result.next === 'again' || result.next === 'bonus') {
      message += ' No token can move; roll again.';
    } else if (result.next === 'pass') {
      message += ' No token can move; the turn passes.';
    }
    return message;
  }

  return { format: format };
});
