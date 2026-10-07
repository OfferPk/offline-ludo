/* Plain-text summaries for accessible offline Ludo move feedback. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root) root.OfflineMoveAnnouncements = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DESTINATIONS = {
    track: 'onto the track',
    'home-lane': 'into the home lane',
    home: 'home',
    base: 'back to the base'
  };

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/<[^>]*>/g, ' ')
      .replace(/[<>]/g, ' ')
      .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  }

  function tokenNumber(value) {
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value + 1 : null;
  }

  function captureLabel(capture) {
    if (!capture || typeof capture !== 'object') return '';
    var number = tokenNumber(capture.piece);
    if (number === null) return '';
    return (cleanName(capture.actor) || 'a rival') + "'s token " + number;
  }

  function format(move) {
    if (!move || typeof move !== 'object' || Array.isArray(move)) return '';
    var piece = tokenNumber(move.piece);
    if (piece === null) return '';
    var actor = cleanName(move.actor) || 'A player';
    var destination = Object.prototype.hasOwnProperty.call(DESTINATIONS, move.destination) ? move.destination : 'track';
    var action;

    if (move.fromBase) {
      action = 'moved token ' + piece + ' out of the base and ' + DESTINATIONS[destination];
    } else if (destination === 'home') {
      action = 'moved token ' + piece + ' home';
    } else if (destination === 'base') {
      action = 'moved token ' + piece + ' ' + DESTINATIONS[destination];
    } else {
      var spaces = Number.isInteger(move.spaces) && move.spaces > 0 && move.spaces <= 60 ? move.spaces : null;
      action = 'moved token ' + piece + (spaces ? ' ' + spaces + (spaces === 1 ? ' space' : ' spaces') : '') + ' ' + DESTINATIONS[destination];
    }

    var message = actor + ' ' + action + '.';
    var captures = Array.isArray(move.captures) ? move.captures.slice(0, 4).map(captureLabel).filter(Boolean) : [];
    if (captures.length === 1) message += ' Captured ' + captures[0] + '.';
    else if (captures.length > 1) message += ' Captured ' + captures.join(', ') + '.';
    if (move.finished) message += actor === 'You' ? ' You finished all your tokens.' : ' ' + actor + ' finished all their tokens.';
    if (move.event) message += ' A tile event followed.';
    return message.slice(0, 600);
  }

  return { format: format };
});
