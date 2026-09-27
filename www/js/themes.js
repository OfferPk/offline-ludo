/* Cosmetic skins: board skins and dice skins. Unlocked with coins earned in matches (never bought). */
(function () {
  'use strict';
  // seat colours: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
  var SEAT_NAMES = ['Coral', 'Jade', 'Saffron', 'Cobalt'];
  var BOARDS = [
    { id: 'graphite', name: 'Graphite', price: 0, dark: true,
      bg: '#12151b', page: '#171b22', board: '#1f242d', cell: '#2a303b', cellEdge: '#353d4a', ink: '#e8ebf1', muted: '#8a93a3', center: '#262c36',
      seats: ['#ff6f61', '#2fc49d', '#f4b740', '#4d82ff'] },
    { id: 'linen', name: 'Linen', price: 0, dark: false,
      bg: '#ece8e1', page: '#f3f0ea', board: '#fbfaf7', cell: '#ffffff', cellEdge: '#ddd6cb', ink: '#23262c', muted: '#7d7a73', center: '#f1ede6',
      seats: ['#e9574b', '#1fa883', '#e9a42c', '#3a6ee8'] },
    { id: 'walnut', name: 'Walnut', price: 250, dark: true,
      bg: '#1b1410', page: '#221914', board: '#5a3b26', cell: '#e9dcc6', cellEdge: '#b89c78', ink: '#f5ead8', muted: '#bda88b', center: '#6b4930',
      seats: ['#d9533f', '#2f9a6f', '#e0a232', '#3a67c9'] },
    { id: 'aurora', name: 'Aurora', price: 400, dark: true,
      bg: '#0a0f1f', page: '#0e1428', board: '#121a33', cell: '#1a2446', cellEdge: '#2b3a6a', ink: '#e6ecff', muted: '#8f9bc4', center: '#16204a',
      seats: ['#ff5d8f', '#27e0b3', '#ffd166', '#5c8bff'], glow: true }
  ];
  var DICE = [
    { id: 'ivory', name: 'Ivory', price: 0, face: '#fbfaf6', edge: '#d8d3c8', pip: '#1f232b' },
    { id: 'onyx', name: 'Onyx', price: 150, face: '#23272f', edge: '#0f1116', pip: '#f2f4f8' },
    { id: 'brass', name: 'Brass', price: 300, face: '#e3b857', edge: '#a67a24', pip: '#3a2a0c' },
    { id: 'frost', name: 'Frost', price: 450, face: '#cfe6ff', edge: '#8fb4de', pip: '#1b3a66' },
    { id: 'ember', name: 'Ember', price: 600, face: '#d9463b', edge: '#8f2119', pip: '#fff4ea' }
  ];
  window.SKINS = { BOARDS: BOARDS, DICE: DICE, SEAT_NAMES: SEAT_NAMES };
})();
