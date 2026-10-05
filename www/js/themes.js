/* Cosmetic skins: board skins and dice skins. Coins are earned in offline matches; no purchases or sync. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SKINS = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // seat colours: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left
  var SEAT_NAMES = ['Coral', 'Jade', 'Saffron', 'Cobalt'];
  var BOARDS = [
    // Original IDs and palettes are kept intact for existing saves.
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
      seats: ['#ff5d8f', '#27e0b3', '#ffd166', '#5c8bff'], glow: true },
    { id: 'midnight', name: 'Midnight', price: 0, dark: true,
      bg: '#06080f', page: '#0b0e16', board: '#121722', cell: '#1e2636', cellEdge: '#3a4458', ink: '#f5f8fc', muted: '#9aa6bb', center: '#171d2a',
      seats: ['#ff5f52', '#22d4a8', '#ffc453', '#6aa8ff'] },
    { id: 'timber', name: 'Classic Wood', price: 0, dark: false,
      bg: '#5f4328', page: '#745334', board: '#b9844f', cell: '#f7e8cb', cellEdge: '#9a6b38', ink: '#2a1b10', muted: '#6f5436', center: '#e4c693',
      seats: ['#c23c2e', '#1f8051', '#d68c14', '#215394'] },
    { id: 'galaxy', name: 'Galaxy', price: 600, dark: true,
      bg: '#0b0b1d', page: '#12132a', board: '#1b1d3b', cell: '#25294d', cellEdge: '#454976', ink: '#f0efff', muted: '#a5a8d1', center: '#202448', glow: true,
      seats: ['#ff675f', '#34d7a0', '#ffd166', '#5a91ff'] },
    { id: 'ocean', name: 'Ocean', price: 450, dark: true,
      bg: '#071c28', page: '#0c2633', board: '#123747', cell: '#1b4b5b', cellEdge: '#327080', ink: '#e8f8ff', muted: '#91b8c5', center: '#164152',
      seats: ['#ff695f', '#40d7a0', '#ffd166', '#52a4ff'] },
    { id: 'forest', name: 'Forest', price: 450, dark: true,
      bg: '#101d16', page: '#17271d', board: '#263b2b', cell: '#36523a', cellEdge: '#526e4e', ink: '#f0f5e8', muted: '#a6b69a', center: '#304733',
      seats: ['#ef5e50', '#4bd18b', '#f3bd4e', '#5992f0'] },
    { id: 'desert', name: 'Desert', price: 400, dark: false,
      bg: '#e6d4b5', page: '#f0e1c7', board: '#f7ead2', cell: '#fff7e9', cellEdge: '#d8c29d', ink: '#3a2b1a', muted: '#8d795b', center: '#ead8b8',
      seats: ['#d84d3f', '#16875e', '#cf8619', '#315fc7'] },
    { id: 'candy', name: 'Candy', price: 500, dark: false,
      bg: '#f2ddea', page: '#fbf0f6', board: '#fff8fc', cell: '#ffffff', cellEdge: '#e6c8db', ink: '#35233b', muted: '#90758f', center: '#f6e5f1',
      seats: ['#df4d58', '#159b71', '#d99b19', '#426bd1'] },
    { id: 'crystal', name: 'Crystal', price: 750, dark: true,
      bg: '#151628', page: '#1d2037', board: '#272c49', cell: '#e8efff', cellEdge: '#b7c8e6', ink: '#f5f7ff', muted: '#b2bdd7', center: '#323956', glow: true,
      seats: ['#e95050', '#159c73', '#d29516', '#3869df'] },
    { id: 'royal', name: 'Royal', price: 1000, dark: true,
      bg: '#1c1027', page: '#261633', board: '#392148', cell: '#513160', cellEdge: '#725181', ink: '#fbf2df', muted: '#c5a9d4', center: '#48275b', glow: true,
      seats: ['#ff665d', '#32c78e', '#f1bf53', '#5f8fff'] },
    { id: 'neon', name: 'Neon', price: 900, dark: true,
      bg: '#080d18', page: '#0d1421', board: '#121e2d', cell: '#1b2e3d', cellEdge: '#2c6470', ink: '#f0fdff', muted: '#8babb5', center: '#152837', glow: true,
      seats: ['#ff5e62', '#28dfa1', '#f4d43c', '#54a4ff'] },
    { id: 'sakura', name: 'Sakura', price: 650, dark: false,
      bg: '#f0dfe2', page: '#f8ecec', board: '#fff7f6', cell: '#ffffff', cellEdge: '#e5c9cc', ink: '#39272d', muted: '#987f83', center: '#f3e0e2',
      seats: ['#df4f50', '#179469', '#d2951c', '#416bd3'] },
    { id: 'inferno', name: 'Inferno', price: 800, dark: true,
      bg: '#1c0d0b', page: '#28120f', board: '#3c1c17', cell: '#54261e', cellEdge: '#814033', ink: '#fff1e9', muted: '#c4988a', center: '#4c2119', glow: true,
      seats: ['#ff6550', '#29c98c', '#f7c24f', '#508cff'] },
    { id: 'frost', name: 'Frost', price: 700, dark: false,
      bg: '#dce8f1', page: '#eaf2f7', board: '#f4faff', cell: '#ffffff', cellEdge: '#c4d8e8', ink: '#243443', muted: '#71889a', center: '#e5f0f7',
      seats: ['#d94e48', '#168e67', '#cd8c19', '#315fc7'] },
    { id: 'cosmic', name: 'Cosmic', price: 1200, dark: true,
      bg: '#090918', page: '#111127', board: '#191a38', cell: '#232649', cellEdge: '#383d70', ink: '#f4f1ff', muted: '#a3a5c9', center: '#1c2043', glow: true,
      seats: ['#ff5f64', '#27d59b', '#ffd05a', '#5e8fff'] },

    { id: 'champion', name: 'Champion', price: 0, unlock: 'wins', threshold: 50, dark: true,
      bg: '#21170a', page: '#2d2110', board: '#46361d', cell: '#5f4a26', cellEdge: '#927641', ink: '#fff5d9', muted: '#d1b779', center: '#56411f', glow: true,
      seats: ['#ff655a', '#39d398', '#ffcf58', '#6095ff'] },
    { id: 'streak-master', name: 'Streak Master', price: 0, unlock: 'streak', threshold: 10, dark: true,
      bg: '#1d1110', page: '#291817', board: '#40221f', cell: '#592c26', cellEdge: '#874439', ink: '#fff2eb', muted: '#d0a296', center: '#4a2520', glow: true,
      seats: ['#ff685c', '#31cf91', '#f3c34f', '#5d91ff'] },
    { id: 'legendary', name: 'Legendary', price: 0, unlock: 'wins', threshold: 100, dark: true,
      bg: '#171126', page: '#211a35', board: '#302746', cell: '#40345f', cellEdge: '#66558b', ink: '#f8f1ff', muted: '#baa9d5', center: '#392c55', glow: true,
      seats: ['#ff625f', '#39d59c', '#f8c65b', '#6a91ff'] },
    { id: 'diamond', name: 'Diamond', price: 0, unlock: 'event', flag: 'diamondCollection', dark: true,
      bg: '#0d1c2b', page: '#14283a', board: '#1d3a50', cell: '#28536b', cellEdge: '#4a8098', ink: '#effaff', muted: '#a3c9d8', center: '#214459', glow: true,
      seats: ['#ff625a', '#31d394', '#f4c34f', '#60a2ff'] }
  ];
  var DICE = [
    // Original IDs, prices and palettes are preserved unchanged.
    { id: 'ivory', name: 'Ivory', price: 0, face: '#fbfaf6', edge: '#d8d3c8', pip: '#1f232b' },
    { id: 'onyx', name: 'Onyx', price: 150, face: '#23272f', edge: '#0f1116', pip: '#f2f4f8' },
    { id: 'brass', name: 'Brass', price: 300, face: '#e3b857', edge: '#a67a24', pip: '#3a2a0c' },
    { id: 'frost', name: 'Frost', price: 450, face: '#cfe6ff', edge: '#8fb4de', pip: '#1b3a66' },
    { id: 'ember', name: 'Ember', price: 600, face: '#d9463b', edge: '#8f2119', pip: '#fff4ea' },

    { id: 'classic-white', name: 'Classic White', price: 0, face: '#ffffff', edge: '#d8dee8', pip: '#202a38' },
    { id: 'graphite-dice', name: 'Graphite Dice', price: 150, face: '#333a45', edge: '#161b23', pip: '#f5f7fb' },
    { id: 'gold-dice', name: 'Gold Dice', price: 300, face: '#e5bd63', edge: '#a47a28', pip: '#382708' },
    { id: 'crystal-dice', name: 'Crystal Dice', price: 750, face: '#e2eeff', edge: '#9ab8df', pip: '#19385e' },
    { id: 'neon-dice', name: 'Neon Dice', price: 900, face: '#162433', edge: '#23c7d5', pip: '#f3ff6b' },
    { id: 'galaxy-dice', name: 'Galaxy Dice', price: 600, face: '#282344', edge: '#7566c2', pip: '#f5eeff' },
    { id: 'fire-dice', name: 'Fire Dice', price: 800, face: '#df4b30', edge: '#8f2119', pip: '#fff4e9' },
    { id: 'ice-dice', name: 'Ice Dice', price: 700, face: '#d9f0ff', edge: '#91c4e6', pip: '#153958' },
    { id: 'royal-dice', name: 'Royal Dice', price: 1000, face: '#514069', edge: '#d0ad58', pip: '#fff5d2' },
    { id: 'rainbow-dice', name: 'Rainbow Dice', price: 500, face: 'linear-gradient(135deg, #ffb3b3, #ffe49b 35%, #b9f0ca 67%, #bacdff)', edge: '#8795b9', pip: '#252544' },
    { id: 'emerald-dice', name: 'Emerald Dice', price: 450, face: '#17815d', edge: '#0b4e39', pip: '#fff6d8' },
    { id: 'diamond-dice', name: 'Diamond Dice', price: 0, unlock: 'event', flag: 'diamondCollection', face: '#b9edff', edge: '#6ca9c8', pip: '#173d5b' }
  ];
  return { BOARDS: BOARDS, DICE: DICE, SEAT_NAMES: SEAT_NAMES };
});
