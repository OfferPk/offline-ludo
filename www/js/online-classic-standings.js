/* Render final Online Classic placements from the authoritative room snapshot. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OnlineClassicStandings = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  function seatNumber(value) {
    if (value == null || String(value).trim() === '') return null;
    var seat = Number(value);
    return Number.isInteger(seat) && seat >= 0 && seat <= 3 ? seat : null;
  }

  function ordinal(place) {
    var lastTwo = place % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return place + 'th';
    if (place % 10 === 1) return place + 'st';
    if (place % 10 === 2) return place + 'nd';
    if (place % 10 === 3) return place + 'rd';
    return place + 'th';
  }

  function playerInfo(roster, currentUserId) {
    var bySeat = {};
    (Array.isArray(roster) ? roster : []).forEach(function (member) {
      if (!member || typeof member !== 'object') return;
      var seat = seatNumber(member.seat);
      if (seat == null || bySeat[seat]) return;
      var name = typeof member.displayName === 'string' && member.displayName.trim()
        ? member.displayName.trim()
        : typeof member.handle === 'string' && member.handle.trim() ? member.handle.trim() : 'Seat ' + (seat + 1);
      bySeat[seat] = {
        name: name,
        isYou: currentUserId != null && String(currentUserId) !== '' && String(member.user_id) === String(currentUserId)
      };
    });
    return bySeat;
  }

  function build(state, roster, currentUserId) {
    if (!state || state.phase !== 'over') return [];
    var members = playerInfo(roster, currentUserId);
    var used = {};
    var entries = [];
    (Array.isArray(state.ranking) ? state.ranking : []).forEach(function (value) {
      var seat = seatNumber(value);
      if (seat == null || used[seat]) return;
      used[seat] = true;
      var member = members[seat] || { name: 'Seat ' + (seat + 1), isYou: false };
      var place = entries.length + 1;
      entries.push({
        seat: seat,
        place: ordinal(place),
        name: member.name,
        note: (place === 1 ? 'Winner' : '') + (place === 1 && member.isYou ? ' · You' : member.isYou ? 'You' : ''),
        status: 'ranked',
        isYou: member.isYou
      });
    });
    (Array.isArray(state.abandoned) ? state.abandoned : []).forEach(function (value) {
      var seat = seatNumber(value);
      if (seat == null || used[seat]) return;
      used[seat] = true;
      var member = members[seat] || { name: 'Seat ' + (seat + 1), isYou: false };
      entries.push({ seat: seat, place: '—', name: member.name, note: 'Left early' + (member.isYou ? ' · You' : ''), status: 'abandoned', isYou: member.isYou });
    });
    return entries;
  }

  function render(section, state, roster, currentUserId) {
    if (!section || typeof section.querySelector !== 'function') return [];
    var list = section.querySelector('.online-classic-standings-list');
    if (!list || !list.ownerDocument || typeof list.replaceChildren !== 'function') return [];
    var entries = build(state, roster, currentUserId);
    list.replaceChildren();
    entries.forEach(function (entry) {
      var document = list.ownerDocument;
      var item = document.createElement('li');
      item.className = 'online-classic-standing' + (entry.place === '1st' ? ' is-winner' : '') + (entry.status === 'abandoned' ? ' is-abandoned' : '');
      item.dataset.seat = String(entry.seat);
      item.dataset.status = entry.status;
      item.setAttribute('aria-label', (entry.status === 'ranked' ? entry.place + ' place' : 'Not ranked') + ', ' + entry.name + (entry.note ? ', ' + entry.note : ''));
      var place = document.createElement('span');
      place.className = 'online-classic-standing-place';
      place.textContent = entry.place;
      var name = document.createElement('span');
      name.className = 'online-classic-standing-name';
      name.textContent = entry.name;
      item.append(place, name);
      if (entry.note) {
        var note = document.createElement('small');
        note.className = 'online-classic-standing-note';
        note.textContent = entry.note;
        item.appendChild(note);
      }
      list.appendChild(item);
    });
    section.classList.toggle('hidden', entries.length === 0);
    return entries;
  }

  return { build: build, ordinal: ordinal, render: render };
});
