/* Deterministic presentation-only fixture tables. No identity, network, storage, or reward authority. */
(function (root) {
  'use strict';

  var leaderboardRows = [
    { id: 'demo-player-nova', name: 'Nova', avatarId: 'avatar-nova', skinId: 'skin-crystal-gold', score: 2840, rank: 1, isCurrentUser: false, tieGroup: null, note: 'Crystal champion' },
    { id: 'demo-player-mira', name: 'Mira', avatarId: 'avatar-mira', skinId: 'skin-frost-silver', score: 2610, rank: 2, isCurrentUser: false, tieGroup: null, note: 'Faceted finisher' },
    { id: 'demo-player-kai', name: 'Kai', avatarId: 'avatar-kai', skinId: 'skin-rose-crystal', score: 2380, rank: 3, isCurrentUser: false, tieGroup: 'rank-3', note: 'Bright mover' },
    { id: 'demo-player-ari', name: 'Ari', avatarId: 'avatar-ari', skinId: 'skin-rose-crystal', score: 2380, rank: 3, isCurrentUser: false, tieGroup: 'rank-3', note: 'Tied for third' },
    { id: 'demo-player-sana', name: 'Sana', avatarId: 'avatar-sana', skinId: 'skin-jade-glass', score: 2190, rank: 5, isCurrentUser: false, tieGroup: null, note: 'Weekly climber' },
    { id: 'demo-player-elio', name: 'Elio', avatarId: 'avatar-elio', skinId: 'skin-sapphire-glass', score: 2040, rank: 6, isCurrentUser: false, tieGroup: null, note: 'Crystal seeker' },
    { id: 'demo-player-tali', name: 'Tali', avatarId: 'avatar-tali', skinId: 'skin-lilac-glass', score: 1810, rank: 7, isCurrentUser: false, tieGroup: null, note: 'New challenger' },
    { id: 'demo-player-alexandria', name: 'Alexandria of the Opal Garden', avatarId: 'avatar-alexandria', skinId: 'skin-opal-glass', score: 1530, rank: 8, isCurrentUser: false, tieGroup: null, note: 'Steady player' },
    { id: 'demo-player-zed', name: 'Zed', avatarId: 'avatar-zed', skinId: 'skin-amber-glass', score: 1280, rank: 10, isCurrentUser: false, tieGroup: 'rank-10', note: 'Tied for tenth' },
    { id: 'demo-player-uma', name: 'Uma', avatarId: 'avatar-uma', skinId: 'skin-amber-glass', score: 1280, rank: 10, isCurrentUser: false, tieGroup: 'rank-10', note: 'Tied for tenth' }
  ];

  var currentUserRow = {
    id: 'demo-player-current-user', name: 'You', avatarId: 'avatar-you', skinId: 'skin-current-demo',
    score: 420, rank: 14, isCurrentUser: true, tieGroup: null,
    note: 'Your separate demo row · outside Top 10'
  };

  var referralRows = [];
  function addReferral(scenario, id, label, date, state, counted) {
    referralRows.push({ scenario: scenario, id: id, label: label, date: date, state: state, counted: !!counted });
  }
  function addCompletions(scenario, prefix, count, startDate) {
    var firstDay = new Date(startDate + 'T00:00:00.000Z');
    for (var i = 0; i < count; i++) {
      var fixtureDay = new Date(firstDay.getTime());
      fixtureDay.setUTCDate(fixtureDay.getUTCDate() + i);
      addReferral(scenario, prefix + '-' + String(i + 1).padStart(2, '0'), 'Demo invite ' + String(i + 1).padStart(2, '0'), fixtureDay.toISOString().slice(0, 10), 'first_match_completed', true);
    }
  }

  addReferral('in-progress', 'demo-ref-001', 'Demo invite 01', '2026-09-28', 'shared', false);
  addReferral('in-progress', 'demo-ref-002', 'Demo invite 02', '2026-09-29', 'joined', false);
  addCompletions('in-progress', 'demo-ref', 4, '2026-09-30');
  addReferral('not-started', 'demo-zero-001', 'Demo invite A', '2026-09-28', 'shared', false);
  addReferral('not-started', 'demo-zero-002', 'Demo invite B', '2026-09-29', 'joined', false);
  addCompletions('almost', 'demo-nine', 9, '2026-09-20');
  addCompletions('review-active', 'demo-ten-active', 10, '2026-09-18');
  addReferral('review-active', 'demo-review-active', 'Review sample · active', '2026-10-03', 'simulated_review', false);
  addCompletions('review-ended', 'demo-ten-ended', 10, '2026-09-18');
  addReferral('review-ended', 'demo-review-ended', 'Review sample · ended', '2026-10-01', 'simulated_review', false);
  addCompletions('pending-overdue', 'demo-ten-pending', 10, '2026-09-18');
  addReferral('pending-overdue', 'demo-review-pending', 'Review sample · pending', '2026-09-29', 'simulated_review', false);
  addReferral('duplicate', 'demo-duplicate-001', 'Duplicate invite example', '2026-09-30', 'duplicate', false);
  addReferral('self-referral', 'demo-self-001', 'Self-referral example', '2026-10-01', 'self_referral', false);

  var uiScenarios = {
    week: {
      active: {
        id: 'active-week', eventId: 'crystal-league-demo-s01', weekLabel: 'WEEK 40', label: 'WEEK 40 · ACTIVE DEMO', season: 'SEASON 01',
        eventStartsAt: '2026-09-28T00:00:00.000Z', eventEndsAt: '2026-10-05T00:00:00.000Z',
        startsAt: '2026-09-28T00:00:00.000Z', endsAt: '2026-10-05T00:00:00.000Z',
        resetAt: '2026-10-05T00:00:00.000Z', timeZone: 'UTC', demoNow: '2026-10-03T09:00:00.000Z', ended: false,
        reward: { amount: 900, label: 'bonus crystals', previewOnly: true }
      },
      ended: {
        id: 'ended-week', eventId: 'crystal-league-demo-s01', weekLabel: 'WEEK 39', label: 'WEEK 39 · ENDED DEMO', season: 'SEASON 01',
        eventStartsAt: '2026-09-21T00:00:00.000Z', eventEndsAt: '2026-09-28T00:00:00.000Z',
        startsAt: '2026-09-21T00:00:00.000Z', endsAt: '2026-09-28T00:00:00.000Z',
        resetAt: '2026-09-28T00:00:00.000Z', timeZone: 'UTC', demoNow: '2026-10-03T09:00:00.000Z', ended: true,
        reward: { amount: 900, label: 'bonus crystals', previewOnly: true }
      }
    },
    referrals: {
      'in-progress': { id: 'in-progress', count: 4, note: '4/10 sample fixtures · demo/offline/not synced.' },
      'not-started': { id: 'not-started', count: 0, note: '0/10 in this sample fixture · no counts claimed.' },
      almost: { id: 'almost', count: 9, note: '9/10 sample fixtures · demo only, not synced.' },
      'review-active': { id: 'review-active', count: 10, review: 'active', note: '10/10 sample state · review is simulated only.' },
      'review-ended': { id: 'review-ended', count: 10, review: 'ended', note: '10/10 sample state · outcome remains unknown.' },
      'pending-overdue': { id: 'pending-overdue', count: 10, review: 'overdue', note: 'More than 48h in this fixture · still pending.' },
      duplicate: { id: 'duplicate', count: 0, note: 'Duplicate example · excluded from this demo count.' },
      'self-referral': { id: 'self-referral', count: 0, note: 'Self-referral example · excluded from this demo count.' },
      empty: { id: 'empty', count: 0, empty: true, note: 'Empty-state fixture · no sample entries shown.' },
      loading: { id: 'loading', count: 0, loading: true, note: 'Loading fixture · simulated locally, no request.' },
      error: { id: 'error', count: null, error: true, note: 'Error fixture · simulated locally, no request.' },
      expired: { id: 'expired', count: null, expired: true, note: 'Expired fixture · simulated locally, no account state.' }
    }
  };

  root.CommunityFixtures = Object.freeze({
    leaderboardRows: Object.freeze(leaderboardRows.map(Object.freeze)),
    currentUserRow: Object.freeze(currentUserRow),
    referralRows: Object.freeze(referralRows.map(Object.freeze)),
    uiScenarios: Object.freeze(uiScenarios)
  });
})(window);
