'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    var liveRegion = root.document.getElementById('online-room-roster-announcement');
    root.OnlineRoomRosterAnnouncements = api.create(function (message) {
      if (liveRegion) liveRegion.textContent = message;
    });
  }
})(typeof window === 'undefined' ? null : window, function () {
  function normalizedName(member, seat) {
    var candidates = [member.displayName, member.display_name, member.handle];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] == null) continue;
      var name = String(candidates[i]).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (name) return name.slice(0, 48);
    }
    return seat == null ? 'A player' : 'Player in seat ' + (seat + 1);
  }

  function sortedEntries(roster) {
    var snapshot = new Map();
    (Array.isArray(roster) ? roster : []).forEach(function (member) {
      if (!member || typeof member !== 'object') return;
      var userId = member.user_id == null ? '' : String(member.user_id);
      var seat = member.seat == null ? null : Number(member.seat);
      if (!Number.isFinite(seat)) seat = null;
      var key = userId ? 'user:' + userId : (seat == null ? '' : 'seat:' + seat);
      if (!key || snapshot.has(key)) return;
      snapshot.set(key, {
        key: key,
        userId: userId,
        seat: seat,
        name: normalizedName(member, seat),
        ready: !!member.ready
      });
    });
    return Array.from(snapshot.values()).sort(function (left, right) {
      if (left.seat != null && right.seat != null && left.seat !== right.seat) return left.seat - right.seat;
      if (left.seat != null && right.seat == null) return -1;
      if (left.seat == null && right.seat != null) return 1;
      return left.key.localeCompare(right.key);
    });
  }

  function create(announce) {
    var activeRoomId = null;
    var previous = null;

    function reset() {
      activeRoomId = null;
      previous = null;
      if (typeof announce === 'function') announce('');
    }

    function update(roomId, roster, currentUserId) {
      var normalizedRoomId = roomId == null ? '' : String(roomId);
      if (!normalizedRoomId) {
        reset();
        return [];
      }
      var nextEntries = sortedEntries(roster);
      var next = new Map(nextEntries.map(function (entry) { return [entry.key, entry]; }));
      if (previous === null || normalizedRoomId !== activeRoomId) {
        activeRoomId = normalizedRoomId;
        previous = next;
        return [];
      }

      var messages = [];
      Array.from(previous.values()).sort(function (left, right) {
        return (left.seat == null ? Infinity : left.seat) - (right.seat == null ? Infinity : right.seat) || left.key.localeCompare(right.key);
      }).forEach(function (member) {
        if (!next.has(member.key)) messages.push(member.name + ' left the room.');
      });

      var ownUserId = currentUserId == null ? '' : String(currentUserId);
      nextEntries.forEach(function (member) {
        var oldMember = previous.get(member.key);
        if (!oldMember) {
          messages.push(member.name + ' joined the room.');
          return;
        }
        if (member.seat != null && oldMember.seat != null && member.seat !== oldMember.seat) {
          messages.push(member.name + ' moved to seat ' + (member.seat + 1) + '.');
        }
        if (member.userId !== ownUserId && oldMember.ready !== member.ready) {
          messages.push(member.name + (member.ready ? ' is ready.' : ' is not ready.'));
        }
      });

      previous = next;
      if (messages.length && typeof announce === 'function') announce(messages.join(' '));
      return messages;
    }

    return { update: update, reset: reset };
  }

  return { create: create };
});
