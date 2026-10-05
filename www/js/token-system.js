/* Token 2.0: original procedural token art, free match-completion progression, and identity helpers. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenSystem = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SKINS = [
    { id: 'classic', name: 'Classic', material: 'Polished crystal', numberStyle: 'standard', unlockAt: 0, description: 'The original circular crystal with a bright metal rim.' },
    { id: 'royal', name: 'Royal', material: 'Crown gold', numberStyle: 'roman', unlockAt: 1, description: 'Gold accents and a tiny crown engraving.' },
    { id: 'dragon', name: 'Dragon', material: 'Carved metal', numberStyle: 'carved', unlockAt: 3, description: 'A dragon-carved number with ember glints.' },
    { id: 'cyber', name: 'Cyber', material: 'Neon alloy', numberStyle: 'digital', unlockAt: 5, description: 'A bright circuit sheen and digital numerals.' },
    { id: 'galaxy', name: 'Galaxy', material: 'Nebula glass', numberStyle: 'ancient', unlockAt: 7, description: 'A soft nebula core with ancient engraved glyphs.' },
    { id: 'fire', name: 'Fire', material: 'Molten crystal', numberStyle: 'standard', unlockAt: 9, description: 'Warm ember facets and a flame engraving.' },
    { id: 'ice', name: 'Ice', material: 'Frost crystal', numberStyle: 'standard', unlockAt: 11, description: 'Cool frosted glass and fine ice etching.' },
    { id: 'shadow', name: 'Shadow', material: 'Obsidian', numberStyle: 'ancient', unlockAt: 13, description: 'Deep obsidian glass with a violet edge light.' },
    { id: 'diamond', name: 'Diamond', material: 'Clear diamond', numberStyle: 'standard', unlockAt: 16, description: 'Clear layered crystal with precise highlights.' },
    { id: 'legendary', name: 'Legendary', material: 'Prismatic crystal', numberStyle: 'carved', unlockAt: 20, description: 'The fully evolved, richly detailed token.' }
  ];
  var SETS = [
    { id: 'inferno', name: 'Inferno', unlockAt: 0, pieces: ['Fire', 'Flame', 'Lava', 'Phoenix'], description: 'Fire · Flame · Lava · Phoenix' },
    { id: 'frost', name: 'Frost', unlockAt: 3, pieces: ['Ice', 'Frostflake', 'Glacier', 'Aurora'], description: 'Ice · Frostflake · Glacier · Aurora' },
    { id: 'galaxy', name: 'Galaxy', unlockAt: 8, pieces: ['Planet', 'Nebula', 'Star', 'Black hole'], description: 'Planet · Nebula · Star · Black hole' },
    { id: 'royal', name: 'Royal', unlockAt: 12, pieces: ['Gold', 'Sapphire', 'Ruby', 'Diamond'], description: 'Gold · Sapphire · Ruby · Diamond' }
  ];
  var LEVELS = [
    { id: 1, name: 'Basic', at: 0 },
    { id: 2, name: 'Polished', at: 2 },
    { id: 3, name: 'Elite', at: 5 },
    { id: 4, name: 'Mythic', at: 10 },
    { id: 5, name: 'Legendary', at: 20 }
  ];
  var SEAT_SHAPES = ['circle', 'triangle', 'square', 'diamond'];
  var NUMBERS = {
    standard: ['1', '2', '3', '4'],
    roman: ['I', 'II', 'III', 'IV'],
    digital: ['01', '02', '03', '04'],
    carved: ['1', '2', '3', '4'],
    ancient: ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ']
  };
  var MOTIFS = {
    inferno: [
      'M12 3.2c.2 1.8-.5 2.6-1.4 3.6C9.8 7.6 9 8.3 9 9.5a3 3 0 0 0 6 0c0-1-.4-1.8-1.3-2.8-.5 1.1-1 1.4-1.7 1.7.5-2.2-.2-3.6 0-5.2Z',
      'M12 3.1 13.2 5.9 16 7.1 13.2 8.3 12 11.1 10.8 8.3 8 7.1 10.8 5.9Z',
      'M7.1 9.9 10 8.7l2 1.4 2-1.4 2.9 1.2-2 2.2-2.9-.8-2.9.8Z',
      'M5.1 8.3c2.5.2 4.2 1.1 5.6 2.5L12 12l1.3-1.2c1.4-1.4 3.1-2.3 5.6-2.5-1.2 2.2-2.4 3.3-4.2 4.1l-2.7 2-2.7-2c-1.8-.8-3-1.9-4.2-4.1Z'
    ],
    frost: [
      'M12 3.1v8.9m0 0 6.3 3.7M12 12l-6.3 3.7m6.3-3.7-6.3-3.7M12 12l6.3-3.7M12 3.1l-1.2 2m1.2-2 1.2 2M5.7 15.7l2.2-.2m-2.2.2.9 2m11.7-2-2.2-.2m2.2.2-.9 2M5.7 8.3l2.2.2m-2.2-.2.9-2m11.7 2-2.2.2m2.2-.2-.9-2',
      'M12 3.2 13.4 7l3.8 1.4-3.8 1.4-1.4 3.8-1.4-3.8L6.8 8.4 10.6 7Z',
      'M7.2 7.4h9.6v6.8H7.2zM9.2 5.4v2m5.6-2v2m-5.6 6.8v2m5.6-2v2',
      'M12 3.1l1.4 4.4 4.5 1.4-4.5 1.4-1.4 4.5-1.4-4.5-4.5-1.4 4.5-1.4Z'
    ],
    galaxy: [
      'M12 7.1a4.1 1.7-25 1 0 0 .1M12 4.6a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z',
      'M12 3.1 13.4 7l3.9 1.4-3.9 1.4-1.4 3.9-1.4-3.9-3.9-1.4L10.6 7Z',
      'M12 3.3 13 7l3.7 1-3.7 1-1 3.7-1-3.7-3.7-1 3.7-1Z',
      'M12 4.1a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0 1.4a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z'
    ],
    royal: [
      'M6.1 10.7 5.2 6.1l3 2.1L12 4.1l3.8 4.1 3-2.1-.9 4.6Z M6.1 12h11.8v1.2H6.1z',
      'M12 3.5 17 7.4 15 13.1H9L7 7.4Z M7 7.4h10M12 7.4v5.7',
      'M12 3.8 17 6.7 15.5 12 12 14.4 8.5 12 7 6.7Z M8.5 7.1 12 9l3.5-1.9',
      'M12 3.4 17.2 7.1 15 13.4H9L6.8 7.1Z M6.8 7.1H17.2M12 7.1v6.3'
    ]
  };
  var TRAILS = {
    classic: ['#fff2de', '#c8edff'],
    royal: ['#ffe5a0', '#fff8dc', '#dca83f'], dragon: ['#ff7547', '#ffc36b', '#e43b2f'],
    cyber: ['#75f5ff', '#50bfff', '#e3ffff'], galaxy: ['#c9a4ff', '#7bdcff', '#fff0aa'],
    fire: ['#ff7248', '#ffcf62', '#e83d29'], ice: ['#d9fbff', '#73d9ff', '#ffffff'],
    shadow: ['#a58bff', '#5636b9', '#e3d9ff'], diamond: ['#dffbff', '#a3d4ff', '#ffffff'],
    legendary: ['#ffd47b', '#e0a9ff', '#8de8ff'], inferno: ['#ff7248', '#ffcf62'],
    frost: ['#d9fbff', '#73d9ff'], setgalaxy: ['#c9a4ff', '#7bdcff'], setroyal: ['#ffe5a0', '#fff8dc']
  };
  var SKIN_BY_ID = Object.create(null), SET_BY_ID = Object.create(null);
  SKINS.forEach(function (skin) { SKIN_BY_ID[skin.id] = skin; });
  SETS.forEach(function (set) { SET_BY_ID[set.id] = set; });

  function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
  function levelFor(completed) {
    var n = count(completed), level = LEVELS[0], next = null;
    LEVELS.forEach(function (item, index) { if (n >= item.at) level = item; if (!next && index > 0 && n < item.at) next = item; });
    return { id: level.id, name: level.name, at: level.at, completed: n, next: next, progress: next ? Math.max(0, Math.min(1, (n - level.at) / (next.at - level.at))) : 1 };
  }
  function skin(id) { return SKIN_BY_ID[id] || SKIN_BY_ID.classic; }
  function tokenSet(id) { return SET_BY_ID[id] || SET_BY_ID.inferno; }
  function isSkinUnlocked(id, completed) { var item = SKIN_BY_ID[id]; return !!item && count(completed) >= item.unlockAt; }
  function isSetUnlocked(id, completed) { var item = SET_BY_ID[id]; return !!item && count(completed) >= item.unlockAt; }
  function normalizeProgress(raw, fallbackCompleted) {
    var rooms = raw && Array.isArray(raw.roomCompletions) ? raw.roomCompletions.filter(function (id) {
      return typeof id === 'string' && id.length >= 8 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
    }).slice(-64) : [];
    var rawCount = raw && raw.completed;
    var completed = Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : count(fallbackCompleted);
    return { completed: completed, roomCompletions: rooms };
  }
  function normalizeIdentity(raw, completed) {
    var progress = count(completed), skinId = raw && typeof raw.skin === 'string' ? raw.skin : 'classic';
    var setId = raw && typeof raw.set === 'string' ? raw.set : 'inferno';
    return {
      skin: isSkinUnlocked(skinId, progress) ? skinId : 'classic',
      set: isSetUnlocked(setId, progress) ? setId : 'inferno'
    };
  }
  function normalizeProfileIdentity(raw) {
    if (!raw || typeof raw !== 'object') return { skin: 'classic', set: 'inferno', level: 1 };
    var skinId = typeof raw.skin === 'string' ? raw.skin : typeof raw.token_skin === 'string' ? raw.token_skin : 'classic';
    var setId = typeof raw.set === 'string' ? raw.set : typeof raw.token_set === 'string' ? raw.token_set : 'inferno';
    var levelId = Number(raw.level != null ? raw.level : raw.token_level);
    return {
      skin: SKIN_BY_ID[skinId] ? skinId : 'classic',
      set: SET_BY_ID[setId] ? setId : 'inferno',
      level: Number.isInteger(levelId) && levelId >= 1 && levelId <= 5 ? levelId : 1
    };
  }
  function profileIdentity(identity, completed, selectedLevel) {
    var chosen = normalizeIdentity(identity, completed), earned = levelFor(completed);
    var requested = selectedLevel != null ? Number(selectedLevel) : Number(identity && identity.level);
    var level = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested : earned.id;
    return { token_skin: chosen.skin, token_set: chosen.set, token_level: level };
  }
  function numberFor(style, index) {
    var list = NUMBERS[style] || NUMBERS.standard;
    return list[Math.max(0, Math.min(3, Number(index) || 0))];
  }
  function motif(setId, pieceIndex) {
    var list = MOTIFS[SET_BY_ID[setId] ? setId : 'inferno'];
    return list[Math.max(0, Math.min(3, Number(pieceIndex) || 0))];
  }
  function svgMarkup(options) {
    options = options || {};
    var id = String(options.idPrefix || 'token').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'token';
    var skinItem = skin(options.skin), setItem = tokenSet(options.set), pieceIndex = Math.max(0, Math.min(3, Number(options.pieceIndex) || 0));
    var style = skinItem.numberStyle, n = numberFor(style, pieceIndex);
    var seatShape = SEAT_SHAPES[Math.max(0, Math.min(3, Number(options.seat) || 0))];
    var seatMark = [
      '<circle cx="12" cy="3.8" r=".82"/>',
      '<path d="m12 2.85 1.05 1.82h-2.1Z"/>',
      '<rect x="11.05" y="2.9" width="1.9" height="1.9" rx=".18"/>',
      '<path d="m12 2.78 1.08 1.03L12 4.88l-1.08-1.07Z"/>'
    ][Math.max(0, Math.min(3, Number(options.seat) || 0))];
    return '<svg class="gem-token" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-material="' + (options.material || 'crystal') + '" data-set-piece="' + setItem.pieces[pieceIndex].toLowerCase().replace(/[^a-z0-9]+/g, '-') + '">' +
      '<defs>' +
      '<linearGradient id="' + id + '-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--pcl,#ffd8c8)"/><stop offset=".48" stop-color="var(--pcd,#b83d50)"/><stop offset="1" stop-color="var(--pcdd,#71263a)"/></linearGradient>' +
      '<linearGradient id="' + id + '-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--token-rim-light,#fff)"/><stop offset=".42" stop-color="var(--token-rim,#d8ba75)"/><stop offset="1" stop-color="var(--token-rim-dark,#765a33)"/></linearGradient>' +
      '<linearGradient id="' + id + '-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".36" stop-color="#fff" stop-opacity=".17"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="' + id + '-core" cx="45%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".2" stop-color="var(--pccore,#ffe7a3)" stop-opacity=".78"/><stop offset="1" stop-color="var(--pccore,#ffe7a3)" stop-opacity="0"/></radialGradient>' +
      '<clipPath id="' + id + '-clip"><circle cx="12" cy="10.5" r="8.25"/></clipPath>' +
      '</defs>' +
      '<ellipse class="gem-ground" cx="12" cy="20.75" rx="9.15" ry="2.05"/>' +
      '<ellipse class="gem-pad" cx="12" cy="19.25" rx="7.2" ry="1.2"/>' +
      '<ellipse class="gem-shadow" cx="12" cy="20.2" rx="6.1" ry="1.05"/>' +
      '<circle class="gem-rim-outer" cx="12" cy="10.5" r="9.45" fill="url(#' + id + '-rim)"/>' +
      '<circle class="gem-rim-inner" cx="12" cy="10.5" r="8.56"/>' +
      '<circle class="gem-body" cx="12" cy="10.5" r="7.95" fill="url(#' + id + '-body)"/>' +
      '<g clip-path="url(#' + id + '-clip)">' +
      '<path class="gem-facet gem-facet-light" d="M4.1 4.3 12 2.2 12 12.1 4.2 9.8Z"/>' +
      '<path class="gem-facet gem-facet-dark" d="m12 2.2 7.9 2.1-1.7 5.5-6.2 2.3Z"/>' +
      '<path class="gem-facet gem-facet-base" d="m4.2 9.8 7.8 2.3 7.8-2.3-2.5 7.1-5.3 2.1-5.3-2.1Z"/>' +
      '<ellipse class="gem-core" cx="12" cy="8.05" rx="5.4" ry="5.8" fill="url(#' + id + '-core)"/>' +
      '<ellipse class="gem-glint-soft" cx="8.3" cy="5.15" rx="3.25" ry="1.75"/>' +
      '<path class="gem-glint" d="m5.1 5.1 4.2-2.2-1.75 3.85-1.8.66Z"/>' +
      '<path class="gem-spec" d="m6.25 4.1 3.2-1.55-.65 1.12-2.05 1.28Z"/>' +
      '<circle class="gem-sheen" cx="12" cy="10.5" r="7.93" fill="url(#' + id + '-sheen)"/>' +
      '</g>' +
      '<circle class="gem-rim" cx="12" cy="10.5" r="8.3"/>' +
      '<circle class="gem-bevel" cx="12" cy="10.5" r="7.65"/>' +
      '<circle class="gem-seat-bezel" cx="12" cy="3.8" r="1.34"/>' +
      '<g class="gem-seat-mark gem-seat-mark--' + seatShape + '" data-seat-shape="' + seatShape + '">' + seatMark + '</g>' +
      '<g class="gem-set-mark" data-set="' + setItem.id + '" data-piece-name="' + setItem.pieces[pieceIndex] + '"><path d="' + motif(setItem.id, pieceIndex) + '"/></g>' +
      '<circle class="gem-num-rim" cx="12" cy="12.35" r="4.55"/>' +
      '<circle class="gem-num-disc" cx="12" cy="12.35" r="3.96"/>' +
      '<text class="gem-num number-' + style + '" x="12" y="14.05" text-anchor="middle" data-number-style="' + style + '">' + n + '</text>' +
      '<circle class="gem-shield" cx="12" cy="10.5" r="8.2"/>' +
      '<path class="gem-shield-glint" d="M6.1 7.1c1.2-3.4 4-5.1 7.3-5.3"/>' +
      '<path class="gem-frost-wash" d="M12 2.55a7.95 7.95 0 1 1 0 15.9 7.95 7.95 0 0 1 0-15.9Z"/>' +
      '<path class="gem-frost-crack" d="m14.4 4.6-2 3.2 1.5 1.6-2.2 2.3 1.2 2.6-2.1 2.1"/>' +
      '</svg>';
  }
  function trailColors(identity) {
    identity = normalizeProfileIdentity(identity);
    var key = identity.skin !== 'classic' ? identity.skin : identity.set === 'galaxy' ? 'setgalaxy' : identity.set === 'royal' ? 'setroyal' : identity.set === 'inferno' ? 'classic' : identity.set;
    return (TRAILS[key] || TRAILS.inferno).slice();
  }
  function increment(progress) {
    var normalized = normalizeProgress(progress);
    normalized.completed = Math.min(Number.MAX_SAFE_INTEGER, normalized.completed + 1);
    return normalized;
  }
  function recordRoomCompletion(progress, roomId) {
    var normalized = normalizeProgress(progress);
    if (typeof roomId !== 'string' || roomId.length < 8 || roomId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(roomId) || normalized.roomCompletions.indexOf(roomId) >= 0) {
      return { updated: false, progress: normalized };
    }
    normalized = increment(normalized);
    normalized.roomCompletions.push(roomId);
    normalized.roomCompletions = normalized.roomCompletions.slice(-64);
    return { updated: true, progress: normalized };
  }
  function unlockedSince(before, after) {
    var oldCount = count(before && before.completed), newCount = count(after && after.completed), unlocked = [];
    SKINS.forEach(function (item) { if (oldCount < item.unlockAt && newCount >= item.unlockAt) unlocked.push({ kind: 'skin', id: item.id, name: item.name }); });
    SETS.forEach(function (item) { if (oldCount < item.unlockAt && newCount >= item.unlockAt) unlocked.push({ kind: 'set', id: item.id, name: item.name + ' set' }); });
    var oldLevel = levelFor(oldCount), newLevel = levelFor(newCount);
    if (newLevel.id > oldLevel.id) unlocked.push({ kind: 'level', id: newLevel.id, name: 'Level ' + newLevel.id + ' ' + newLevel.name });
    return unlocked;
  }
  function label(identity, completed, selectedLevel) {
    var normalized = normalizeIdentity(identity, completed), requested = selectedLevel != null ? Number(selectedLevel) : Number(identity && identity.level);
    var currentLevel = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? LEVELS[requested - 1] : levelFor(completed);
    return skin(normalized.skin).name + ' ' + tokenSet(normalized.set).name + ' Set · ' + currentLevel.name;
  }

  return {
    SKINS: SKINS, SETS: SETS, LEVELS: LEVELS, SEAT_SHAPES: SEAT_SHAPES,
    skin: skin, set: tokenSet, levelFor: levelFor, normalizeProgress: normalizeProgress,
    normalizeIdentity: normalizeIdentity, normalizeProfileIdentity: normalizeProfileIdentity,
    profileIdentity: profileIdentity, isSkinUnlocked: isSkinUnlocked, isSetUnlocked: isSetUnlocked,
    numberFor: numberFor, motif: motif, svgMarkup: svgMarkup, trailColors: trailColors,
    increment: increment, recordRoomCompletion: recordRoomCompletion, unlockedSince: unlockedSince, label: label
  };
});
