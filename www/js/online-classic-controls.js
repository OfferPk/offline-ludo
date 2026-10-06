(function (root, factory) {
  var controls = factory();
  if (typeof module === 'object' && module.exports) module.exports = controls;
  if (root) root.OnlineClassicControls = controls;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  function build(state, turnName, isMyTurn, isConnected, hasPendingAction, legalMoves) {
    state = state || {};
    var model = { visible: state.phase !== 'over', status: '', actions: [] };
    if (!model.visible) {
      model.status = 'Match complete.';
      return model;
    }
    if (!isMyTurn) {
      model.status = (turnName || 'The other player') + ' is taking their turn. The controls are disabled for you.';
      return model;
    }
    if (!isConnected) {
      model.status = 'Your turn is paused while the room reconnects. Actions will be available after the latest server state is restored.';
      return model;
    }
    if (hasPendingAction) {
      model.status = 'Your previous action is still being confirmed. Use Retry pending action if needed.';
      return model;
    }
    if (state.phase === 'roll') {
      model.status = 'Your turn. Roll the server die to continue.';
      model.actions.push({ key: 'roll', type: 'roll', label: 'Roll server die' });
      return model;
    }
    if (state.phase === 'move') {
      var seen = Object.create(null);
      (Array.isArray(legalMoves) ? legalMoves : []).forEach(function (move) {
        if (!move || !Number.isInteger(Number(move.piece)) || !Number.isInteger(Number(move.v))) return;
        var piece = Number(move.piece), value = Number(move.v);
        if (piece < 0 || piece > 3 || value < 1 || value > 6) return;
        var key = 'move-' + piece + '-' + value;
        if (seen[key]) return;
        seen[key] = true;
        model.actions.push({ key: key, type: 'move', piece: piece, value: value, label: 'Move token ' + (piece + 1) + ' by ' + value });
      });
      model.status = model.actions.length
        ? 'Your turn. Choose one of the legal token moves.'
        : 'No legal token moves are available in the current server state.';
      return model;
    }
    model.status = 'Match controls are unavailable for this turn phase.';
    return model;
  }

  return Object.freeze({ build: build });
});
