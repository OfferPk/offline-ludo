(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OnlineClassicLastAction = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  function isIntInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
  }

  function playerName(names, seat) {
    var value = names && Object.prototype.hasOwnProperty.call(names, String(seat)) ? names[seat] : '';
    if (typeof value === 'string' && value.trim()) return value.trim();
    return 'Player ' + (seat + 1);
  }

  function format(action, names) {
    if (!action || typeof action !== 'object' || !isIntInRange(action.seat, 0, 3)) return '';
    var player = playerName(names, action.seat);

    if (action.type === 'roll' && isIntInRange(action.face, 1, 6)) {
      return player + ' rolled ' + action.face + '.';
    }
    if (action.type === 'forfeit' && action.face === 6) {
      return player + ' rolled a third 6; the turn was forfeited.';
    }
    if (action.type !== 'move' || !isIntInRange(action.piece, 0, 3) || !isIntInRange(action.die, 1, 6)) return '';

    var details = [];
    var captures = Array.isArray(action.captures)
      ? action.captures.filter(function (capture) {
        return capture && isIntInRange(capture.seat, 0, 3) && isIntInRange(capture.piece, 0, 3);
      }).length
      : 0;
    if (captures) details.push('captured ' + captures + ' token' + (captures === 1 ? '' : 's'));
    if (action.finish === true) details.push('reached home');

    return player + ' moved token ' + (action.piece + 1) + ' by ' + action.die +
      (details.length ? '; ' + details.join(' and ') : '') + '.';
  }

  return Object.freeze({ format: format });
});
