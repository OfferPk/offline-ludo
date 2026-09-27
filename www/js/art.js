/* Crossfour original vector art: emote faces, event icons, avatars (inline SVG strings). */
(function () {
  'use strict';
  function sq(fill) { return '<rect x="3" y="3" width="34" height="34" rx="12" fill="' + fill + '"/><rect x="3" y="3" width="34" height="17" rx="12" fill="#fff" opacity=".12"/>'; }
  var INK = '#1b1e25';
  var EMOTES = {
    smile: { label: 'Smile', svg: sq('#2fc4a4') + '<circle cx="14.5" cy="17" r="2.4" fill="' + INK + '"/><circle cx="25.5" cy="17" r="2.4" fill="' + INK + '"/><path d="M13 24c4 4.2 10 4.2 14 0" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' },
    laugh: { label: 'Laugh', svg: sq('#f5b83d') + '<path d="M11.5 17.5l3-3 3 3M22.5 17.5l3-3 3 3" fill="none" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22h16c0 5-3.6 8-8 8s-8-3-8-8z" fill="' + INK + '"/><path d="M15 27.6c2.8 1.6 7.2 1.6 10 0" fill="none" stroke="#ff7b6b" stroke-width="2.4" stroke-linecap="round"/>' },
    wow: { label: 'Wow', svg: sq('#58a8ff') + '<circle cx="14.5" cy="16.5" r="3.4" fill="#fff"/><circle cx="25.5" cy="16.5" r="3.4" fill="#fff"/><circle cx="14.5" cy="16.8" r="1.8" fill="' + INK + '"/><circle cx="25.5" cy="16.8" r="1.8" fill="' + INK + '"/><ellipse cx="20" cy="27" rx="3.4" ry="4" fill="' + INK + '"/>' },
    sad: { label: 'Sad', svg: sq('#8193b2') + '<circle cx="14.5" cy="17.5" r="2.3" fill="' + INK + '"/><circle cx="25.5" cy="17.5" r="2.3" fill="' + INK + '"/><path d="M14 28c3.6-3.4 8.4-3.4 12 0" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/><path d="M27.5 21c-1.6 2.6-2.4 4-2.4 5.1a2.4 2.4 0 0 0 4.8 0c0-1.1-.8-2.5-2.4-5.1z" fill="#bfe3ff"/>' },
    angry: { label: 'Grr', svg: sq('#ff6b5b') + '<path d="M10.5 13l7 3M29.5 13l-7 3" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/><circle cx="15" cy="19" r="2.2" fill="' + INK + '"/><circle cx="25" cy="19" r="2.2" fill="' + INK + '"/><path d="M14 27.5h12" stroke="' + INK + '" stroke-width="2.8" stroke-linecap="round"/>' },
    cool: { label: 'Cool', svg: sq('#9b7bff') + '<path d="M9 14.5h22v3.2c0 2.6-2 4.3-4.6 4.3h-1.6c-2.2 0-3.6-1.6-4.8-3.6-1.2 2-2.6 3.6-4.8 3.6H13.6C11 22 9 20.3 9 17.7z" fill="' + INK + '"/><path d="M15 27.5c3 1.8 7 1.8 10-.6" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' },
    think: { label: 'Hmm', svg: sq('#7dcf5a') + '<path d="M11.5 13.5l5-1.5M23.5 14.5h5" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/><circle cx="14.5" cy="18" r="2.2" fill="' + INK + '"/><circle cx="26" cy="18.5" r="2.2" fill="' + INK + '"/><path d="M17 27.5l8-1.8" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' },
    love: { label: 'Love', svg: sq('#ff7fb3') + '<path d="M14.5 21.2l-4-3.9a2.4 2.4 0 1 1 4-2.4 2.4 2.4 0 1 1 4 2.4zM25.5 21.2l-4-3.9a2.4 2.4 0 1 1 4-2.4 2.4 2.4 0 1 1 4 2.4z" fill="#c8163f"/><path d="M13.5 25.5c4 4 9 4 13 0" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' }
  };
  function emote(id, size) { var e = EMOTES[id] || EMOTES.smile; return '<svg class="emote" viewBox="0 0 40 40" width="' + (size || 40) + '" height="' + (size || 40) + '" aria-label="' + e.label + '">' + e.svg + '</svg>'; }

  var S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  var ICONS = {
    shield: '<path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z" ' + S + '/><path d="M9 12l2.2 2.2L15.5 10" ' + S + '/>',
    jump3: '<path d="M4 17c2-7 9-10 15-6" ' + S + '/><path d="M19 7v4.5h-4.5" ' + S + '/><text x="8.5" y="22.5" font-size="8" font-weight="800" fill="currentColor" font-family="sans-serif">+3</text>',
    jump6: '<path d="M4 17c2-7 9-10 15-6" ' + S + '/><path d="M19 7v4.5h-4.5" ' + S + '/><text x="8.5" y="22.5" font-size="8" font-weight="800" fill="currentColor" font-family="sans-serif">+6</text>',
    extra: '<rect x="3.5" y="6.5" width="11" height="11" rx="3" ' + S + '/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><path d="M19 8v8M15 12h8" ' + S + '/>',
    double: '<text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="900" fill="currentColor" font-family="sans-serif">×2</text>',
    choose: '<rect x="4" y="4" width="16" height="16" rx="4" ' + S + '/><text x="12" y="15.5" text-anchor="middle" font-size="8.5" font-weight="900" fill="currentColor" font-family="sans-serif">1-6</text>',
    freeze: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" ' + S + '/>',
    back3: '<path d="M20 17c-2-7-9-10-15-6" ' + S + '/><path d="M5 7v4.5h4.5" ' + S + '/><text x="10" y="22.5" font-size="8" font-weight="800" fill="currentColor" font-family="sans-serif">-3</text>',
    swap: '<path d="M5 8h13l-3-3M19 16H6l3 3" ' + S + '/>',
    zap: '<path d="M13.5 2.5 5.5 13.5h6l-1.5 8 8.5-11.5h-6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
    frozen: '<rect x="5" y="10.5" width="14" height="10" rx="2.5" ' + S + '/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" ' + S + '/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/>',
    calm: '<path d="M3 12c2.2-3 4.3-3 6.5 0s4.3 3 6.5 0 4-3 5 -1" ' + S + '/>'
  };
  function icon(id, size) { return '<svg class="ico" viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) + '">' + (ICONS[id] || '') + '</svg>'; }

  var AVATARS = {
    human: '<circle cx="20" cy="15" r="6.5" fill="#fff"/><path d="M8.5 32c1.2-6.4 5.6-9.6 11.5-9.6S30.3 25.6 31.5 32z" fill="#fff"/>',
    ai: '<rect x="10" y="12" width="20" height="17" rx="6" fill="#fff"/><path d="M20 12V7.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="6.5" r="2.2" fill="#fff"/><circle cx="16" cy="20" r="2.2" fill="var(--pc)"/><circle cx="24" cy="20" r="2.2" fill="var(--pc)"/><path d="M16.5 25h7" stroke="var(--pc)" stroke-width="2" stroke-linecap="round"/>'
  };
  function avatar(kind) { return '<svg viewBox="0 0 40 40">' + (AVATARS[kind] || AVATARS.human) + '</svg>'; }

  window.ART = { EMOTES: EMOTES, emote: emote, ICONS: ICONS, icon: icon, avatar: avatar };
})();
