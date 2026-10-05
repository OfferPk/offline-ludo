/* Presentation-only community preview. Names, scores, referrals and outcomes are hardcoded demo fixtures. */
(function () {
  'use strict';

  var fixtures = window.CommunityFixtures;
  if (!fixtures) throw new Error('Community demo fixtures were not loaded.');
  var leaders = fixtures.leaderboardRows.concat([fixtures.currentUserRow]);
  var crownInstance = 0;
  var icons = {
    gem: '<svg class="leader-gem" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 22 9 18 22H6L2 9 12 2Z" fill="currentColor"/><path d="m2 9 10 4 10-4M12 13v9M7 5l5 8 5-8" fill="none" stroke="rgba(255,255,255,.62)" stroke-width="1.2"/></svg>',
    crown: '<svg class="crystal-crown" viewBox="0 0 32 32" aria-hidden="true"><path class="crown-base" d="M5 11.5 11 16l5-10 5 10 6-5.5L24 26H8L5 11.5Z"/><path class="crown-facet" d="m5 11.5 11 6 11-6M8 26l8-8.5L24 26M16 6v11.5"/><circle cx="5" cy="10" r="2.1"/><circle cx="16" cy="5" r="2.1"/><circle cx="27" cy="10" r="2.1"/></svg>'
  };

  var home = document.getElementById('home');
  var community = document.getElementById('community');
  var launcher = document.getElementById('btn-community');
  var back = document.getElementById('community-back');
  var boardTab = document.getElementById('community-tab-leaderboard');
  var referralTab = document.getElementById('community-tab-referrals');
  var themesTab = document.getElementById('community-tab-themes');
  var boardPanel = document.getElementById('community-panel-leaderboard');
  var referralPanel = document.getElementById('community-panel-referrals');
  var themesPanel = document.getElementById('community-panel-themes');
  var themeCardList = document.getElementById('theme-card-list');
  var themeBalanceLabel = document.getElementById('theme-demo-balance');
  var themePreviewBoard = document.getElementById('theme-preview-board');
  var themePreviewCard = document.querySelector('.theme-preview-card');
  var themePreviewTitle = document.getElementById('theme-preview-title');
  var themePreviewNote = document.getElementById('theme-preview-note');
  var themeShopStatus = document.getElementById('theme-shop-status');
  var modal = document.getElementById('community-claim-modal');
  var phone = document.getElementById('community-phone');
  var claimStatus = document.getElementById('community-claim-status');
  var claimOpener = document.getElementById('community-claim-open');
  var reviewCard = document.getElementById('referral-review-card');
  var reviewToggle = document.getElementById('referral-review-toggle');
  var reviewDetails = document.getElementById('referral-review-details');
  var reviewExpanded = true;
  var previousFocus = null;
  var modalCloseTimer = null;
  var countdownFixtureSeconds = null;
  var activeDemoState = 'in-progress';
  var demoStates = fixtures.uiScenarios.referrals;
  var activeWeekScenario = 'active';
  var themeCatalog = [
    { id: 'classic-obsidian', name: 'Classic Obsidian', cost: 0, finish: 'Smoked glass · silver facets' },
    { id: 'neon-frost', name: 'Neon Frost', cost: 500, finish: 'Glacial blue · electric lilac' },
    { id: 'royal-gold', name: 'Royal Gold', cost: 1000, finish: 'Champagne crystal · warm gold' },
    { id: 'deep-ocean', name: 'Deep Ocean', cost: 2000, finish: 'Abyssal teal · moonlit blue' }
  ];
  var themeDemoBalance = 750;
  var unlockedThemes = { 'classic-obsidian': true };
  var equippedTheme = 'classic-obsidian';
  var previewedTheme = 'classic-obsidian';

  function getTheme(id) {
    for (var i = 0; i < themeCatalog.length; i++) if (themeCatalog[i].id === id) return themeCatalog[i];
    return themeCatalog[0];
  }

  function setThemePreview(id) {
    var theme = getTheme(id);
    previewedTheme = theme.id;
    themePreviewBoard.setAttribute('data-theme-preview', theme.id);
    themePreviewBoard.setAttribute('aria-label', theme.name + ' demo board preview');
    themePreviewTitle.textContent = theme.name;
    var isEquipped = theme.id === equippedTheme;
    themePreviewNote.textContent = isEquipped
      ? 'Equipped demo theme · game board stays unchanged.'
      : 'Unlocked preview · not equipped · game board stays unchanged.';
    themePreviewCard.setAttribute('data-theme-equipped', equippedTheme);
  }

  function renderThemeShop() {
    themeBalanceLabel.textContent = themeDemoBalance.toLocaleString('en-US');
    themeBalanceLabel.parentNode.parentNode.setAttribute('aria-label', themeDemoBalance.toLocaleString('en-US') + ' demo crystals available');
    themeCardList.innerHTML = themeCatalog.map(function (theme) {
      var isUnlocked = !!unlockedThemes[theme.id];
      var isEquipped = theme.id === equippedTheme;
      var canUnlock = !isUnlocked && theme.cost <= themeDemoBalance;
      var state = isEquipped ? 'Equipped' : isUnlocked ? 'Unlocked' : canUnlock ? 'Available' : 'Locked (Not enough crystals)';
      var buttonText = isEquipped ? 'Equipped' : isUnlocked ? 'Equip theme' : canUnlock ? 'Unlock with Crystals' : 'Locked (Not enough crystals)';
      var action = isUnlocked ? 'equip' : 'unlock';
      var disabled = !isUnlocked && !canUnlock;
      var pressed = isUnlocked ? ' aria-pressed="' + String(isEquipped) + '"' : '';
      var price = theme.cost ? '<span class="theme-price">' + theme.cost.toLocaleString('en-US') + '<small> crystals</small></span>' : '<span class="theme-price theme-price-free">Included</span>';
      return '<article class="theme-card' + (theme.id === previewedTheme ? ' is-previewed' : '') + '" data-theme-card="' + theme.id + '" role="listitem">' +
        '<div class="theme-thumbnail theme-thumb-' + theme.id + '" data-theme-preview="' + theme.id + '" aria-hidden="true"><i></i><b></b><span></span></div>' +
        '<div class="theme-card-copy"><div class="theme-card-heading"><h3>' + theme.name + '</h3>' + price + '</div>' +
        '<p>' + theme.finish + '</p><div class="theme-card-state' + (isEquipped ? ' is-equipped' : canUnlock ? ' is-available' : isUnlocked ? ' is-unlocked' : ' is-locked') + '" aria-label="' + state + '">' + state + '</div>' +
        '<button class="theme-action-button" type="button" data-theme-id="' + theme.id + '" data-theme-action="' + action + '" aria-label="' + (isEquipped ? theme.name + ' is equipped' : isUnlocked ? 'Equip ' + theme.name : canUnlock ? 'Unlock ' + theme.name + ' for ' + theme.cost.toLocaleString('en-US') + ' demo crystals' : theme.name + ' locked because the demo balance is too low') + '"' + pressed + (disabled ? ' disabled' : '') + '>' + buttonText + '</button></div></article>';
    }).join('');
    setThemePreview(previewedTheme);
  }

  function selectThemeAction(themeId, action) {
    var theme = getTheme(themeId);
    if (action === 'unlock') {
      if (unlockedThemes[theme.id] || theme.cost > themeDemoBalance) return;
      themeDemoBalance -= theme.cost;
      unlockedThemes[theme.id] = true;
      setThemePreview(theme.id);
      themeShopStatus.textContent = theme.name + ' unlocked for ' + theme.cost.toLocaleString('en-US') + ' demo crystals. Preview only; equip it when you are ready.';
    } else {
      if (!unlockedThemes[theme.id] || equippedTheme === theme.id) return;
      equippedTheme = theme.id;
      setThemePreview(theme.id);
      themeShopStatus.textContent = theme.name + ' equipped in this demo. The real game board and saved progress are unchanged.';
    }
    renderThemeShop();
    var nextButton = themeCardList.querySelector('[data-theme-id="' + theme.id + '"]');
    if (nextButton) nextButton.focus({ preventScroll: true });
  }

  function ordinal(rank) {
    var lastTwo = rank % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return rank + 'th';
    if (rank % 10 === 1) return rank + 'st';
    if (rank % 10 === 2) return rank + 'nd';
    if (rank % 10 === 3) return rank + 'rd';
    return rank + 'th';
  }

  function crownMarkup(rank) {
    var tone = rank === 1 ? 'crown-gold' : rank === 2 ? 'crown-silver' : 'crown-rose';
    var colors = rank === 1 ? ['#fff5c8', '#f4cf72', '#b7771e']
      : rank === 2 ? ['#ffffff', '#c9d9eb', '#70869f'] : ['#ffe2cb', '#e5a47a', '#91563d'];
    var id = 'community-crown-gradient-' + (crownInstance++);
    var svg = icons.crown.replace('crystal-crown', 'crystal-crown ' + tone);
    var gradient = '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="' + colors[0] + '"/><stop offset="52%" stop-color="' + colors[1] + '"/><stop offset="100%" stop-color="' + colors[2] + '"/></linearGradient></defs>';
    return svg.replace('<path class="crown-base"', gradient + '<path class="crown-base" style="fill:url(#' + id + ')"');
  }

  function renderLeaderboard() {
    var list = document.getElementById('community-leaderboard-list');
    list.innerHTML = leaders.map(function (player) {
      var rank = player.rank;
      var place = ordinal(rank);
      var rankFace = rank <= 3
        ? '<span class="leader-rank-podium">' + crownMarkup(rank) + '<b>' + place + '</b></span>'
        : '<span class="leader-rank-number">' + place + '</span>';
      var initials = player.name === 'You' ? 'Y' : player.name.slice(0, 1);
      var youTag = player.isCurrentUser ? '<span class="leader-you-tag">YOU · DEMO</span>' : '';
      var tiedText = player.tieGroup ? ', tied place' : '';
      var a11y = ordinal(rank) + ' place' + tiedText + ', ' + player.name + ', ' + player.score.toLocaleString('en-US') + ' sample crystals' + (player.isCurrentUser ? ', outside Top 10, demo only' : '');
      return '<li class="leader-row' + (rank <= 3 ? ' leader-podium podium-' + rank : '') + (player.isCurrentUser ? ' leader-you' : '') + '" data-player-id="' + player.id + '" data-avatar-id="' + player.avatarId + '" data-skin-id="' + player.skinId + '" data-tie-group="' + (player.tieGroup || '') + '" data-current-user="' + String(!!player.isCurrentUser) + '" data-rank="' + rank + '" aria-label="' + a11y + '" title="' + player.name + ' · ' + place + (player.tieGroup ? ' tie' : '') + '">' +
        rankFace +
        '<span class="leader-avatar leader-avatar-' + ((rank - 1) % 4) + '" data-avatar-id="' + player.avatarId + '" data-skin-id="' + player.skinId + '" aria-hidden="true">' + initials + '</span>' +
        '<span class="leader-player"><b>' + player.name + youTag + '</b><small>' + player.note + '</small></span>' +
        '<span class="leader-score">' + icons.gem + '<b>' + player.score.toLocaleString('en-US') + '</b><small>DEMO CRYSTALS</small></span>' +
        '</li>';
    }).join('');
    document.getElementById('community-current-rank').textContent = '#' + fixtures.currentUserRow.rank;
    document.getElementById('community-current-progress').textContent = fixtures.currentUserRow.score.toLocaleString('en-US') + ' sample crystals · outside Top 10 · demo only';
  }

  function selectTab(tab, focusPanel) {
    var choices = [
      { id: 'leaderboard', tab: boardTab, panel: boardPanel },
      { id: 'referrals', tab: referralTab, panel: referralPanel },
      { id: 'themes', tab: themesTab, panel: themesPanel }
    ];
    var selected = choices.filter(function (choice) { return choice.id === tab; })[0] || choices[0];
    choices.forEach(function (choice) {
      var active = choice === selected;
      choice.tab.classList.toggle('is-active', active);
      choice.tab.setAttribute('aria-selected', String(active));
      choice.tab.tabIndex = active ? 0 : -1;
      choice.panel.classList.toggle('hidden', !active);
      choice.panel.setAttribute('aria-hidden', String(!active));
    });
    if (focusPanel) selected.panel.focus({ preventScroll: true });
  }

  function showCommunity() {
    home.classList.add('hidden');
    community.classList.remove('hidden');
    selectTab('leaderboard', false);
    boardTab.focus({ preventScroll: true });
  }

  function closeClaim() {
    if (modal.classList.contains('hidden') || modal.classList.contains('is-closing')) return;
    modal.classList.remove('is-open');
    modal.classList.add('is-closing');
    modal.setAttribute('aria-hidden', 'true');
    modal.inert = true;
    phone.value = '';
    claimStatus.textContent = '';
    claimStatus.classList.add('hidden');
    if (previousFocus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    if (modalCloseTimer) window.clearTimeout(modalCloseTimer);
    var duration = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
    modalCloseTimer = window.setTimeout(function () {
      modal.classList.add('hidden');
      modal.classList.remove('is-closing');
      modalCloseTimer = null;
    }, duration);
  }

  function openClaim() {
    if (modalCloseTimer) window.clearTimeout(modalCloseTimer);
    modalCloseTimer = null;
    previousFocus = document.activeElement;
    claimStatus.textContent = '';
    claimStatus.classList.add('hidden');
    phone.value = '';
    modal.inert = false;
    modal.classList.remove('is-closing', 'is-open');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    var enter = function () { if (!modal.classList.contains('hidden')) modal.classList.add('is-open'); };
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) enter();
    else window.requestAnimationFrame(function () { window.requestAnimationFrame(enter); });
    phone.focus({ preventScroll: true });
  }

  function setReviewExpanded(expanded) {
    reviewExpanded = expanded;
    reviewToggle.setAttribute('aria-expanded', String(expanded));
    reviewDetails.classList.toggle('hidden', !expanded);
    reviewCard.classList.toggle('is-collapsed', !expanded);
  }

  function updateReview(mode) {
    var title = document.getElementById('referral-review-title');
    var subtitle = document.getElementById('referral-review-subtitle');
    var copy = document.getElementById('referral-review-copy');
    var timeline = document.getElementById('referral-review-timeline');
    if (mode === 'active') {
      title.textContent = 'Pending 48h Manual Review';
      subtitle.textContent = 'Simulated review · no outcome promised';
      copy.textContent = 'This 48-hour review window is simulated. Its end does not imply approval or payout.';
      timeline.lastChild.textContent = ' Simulated · review window active';
    } else if (mode === 'ended') {
      title.textContent = 'Review window ended · outcome unknown';
      subtitle.textContent = 'Simulated end state · no approval implied';
      copy.textContent = 'The sample 48-hour window has ended, but the outcome is unknown. No approval or payout is implied.';
      timeline.lastChild.textContent = ' Simulated · ended, outcome unknown';
    } else {
      title.textContent = 'Pending >48h · review still pending';
      subtitle.textContent = 'Simulated delay · no automatic decision';
      copy.textContent = 'More than 48 hours elapsed in this fixture. The state remains pending; elapsed time never implies approval or payout.';
      timeline.lastChild.textContent = ' Simulated · pending beyond 48 hours';
    }
    reviewCard.classList.remove('hidden');
    setReviewExpanded(true);
  }

  function renderReferralRows() {
    var rows = fixtures.referralRows.filter(function (row) { return row.scenario === activeDemoState; });
    var list = document.getElementById('referral-stage-list');
    var labels = {
      shared: 'Link shared · demo',
      joined: 'Joined · demo',
      first_match_completed: 'First match completed · demo',
      simulated_review: 'Simulated 48-hour review',
      duplicate: 'Duplicate · excluded from demo count',
      self_referral: 'Self-referral · excluded from demo count'
    };
    list.innerHTML = rows.map(function (row) {
      return '<li data-referral-id="' + row.id + '" data-referral-state="' + row.state + '" data-demo-scenario="' + row.scenario + '">' +
        '<b>' + row.label + '</b><span>Fake ID: ' + row.id + '</span>' +
        '<span><time datetime="' + row.date + '">' + row.date + '</time> · ' + labels[row.state] + '</span></li>';
    }).join('');
  }

  function renderReferralProgress() {
    var state = demoStates[activeDemoState] || demoStates['in-progress'];
    var count = state.count;
    var shownCount = count === null ? 0 : count;
    var pct = shownCount * 10;
    var label = count === null ? '—/10' : count + '/10';
    document.getElementById('referral-count').textContent = label;
    document.getElementById('referral-goal-label').textContent = count === null ? 'Preview paused' : count === 10 ? '10/10 shown' : count === 0 ? 'Start preview' : (10 - count) + ' to go';
    var bar = document.getElementById('referral-progress');
    bar.setAttribute('aria-valuenow', String(shownCount));
    bar.setAttribute('aria-valuetext', count === null ? 'Demo preview paused; no count shown' : count + ' of 10 sample referrals counted in this preview');
    document.getElementById('referral-progress-fill').style.width = pct + '%';
    var toggle = document.getElementById('referral-preview-toggle');
    toggle.textContent = count === 10 ? 'Show 4/10 preview' : 'Preview 10/10';
    toggle.setAttribute('aria-pressed', String(count === 10));
    document.getElementById('referral-demo-note').textContent = state.note;
    Array.prototype.forEach.call(document.querySelectorAll('.referral-crystal-slot'), function (slot, index) {
      slot.classList.toggle('is-filled', index < shownCount);
    });

    var message = document.getElementById('referral-state-message');
    var retry = document.getElementById('referral-retry');
    var fixtures = document.getElementById('referral-stage-fixtures');
    var special = state.empty || state.loading || state.error || state.expired;
    message.textContent = state.empty ? 'No sample referrals to display. This empty state is part of the local demo.'
      : state.loading ? 'Loading sample fixtures… simulated on this device; no request is made.'
      : state.error ? 'Demo fixture error (simulated). Retry only resets this local preview.'
      : state.expired ? 'Demo preview expired (simulated). Restart only resets this local preview.' : '';
    message.classList.toggle('hidden', !special);
    retry.classList.toggle('hidden', !(state.error || state.expired));
    retry.textContent = state.expired ? 'Restart local demo' : 'Retry local demo';
    fixtures.classList.toggle('hidden', !!special);
    renderReferralRows();

    var review = state.review;
    reviewCard.classList.toggle('hidden', !review);
    if (review) updateReview(review);
    document.getElementById('referral-demo-state').value = activeDemoState;
  }

  var weekClockStartedAt = Date.now();
  var resetAt;
  var timeFormatter;
  var zoneId;
  var countdown = document.getElementById('community-countdown');

  function selectWeekScenario(id) {
    if (!fixtures.uiScenarios.week[id]) throw new RangeError('Unknown local week fixture.');
    activeWeekScenario = id;
    weekClockStartedAt = Date.now();
    countdownFixtureSeconds = null;
    var scenario = fixtures.uiScenarios.week[id];
    resetAt = new Date(scenario.resetAt);
    zoneId = scenario.timeZone;
    timeFormatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: zoneId
    });
    document.getElementById('community-week-scenario').value = id;
    document.getElementById('community-season-label').textContent = scenario.season;
    document.getElementById('community-week-label').textContent = scenario.label.split(' · ')[0];
    document.getElementById('community-week-chip').textContent = scenario.label;
    document.getElementById('community-week-status').textContent = scenario.ended
      ? 'Ended-week fixture · reset reached · demo only, not synced'
      : 'Demo preview · offline and not synced';
    countdown.dateTime = resetAt.toISOString();
    var resetLabel = document.getElementById('community-reset-at');
    resetLabel.textContent = (scenario.ended ? 'Ended ' : 'Ends ') + timeFormatter.format(resetAt) + ' · ' + zoneId;
    resetLabel.title = zoneId + ' · deterministic demo fixture, not synced';
    updateCountdown();
  }

  function updateCountdown() {
    var scenario = fixtures.uiScenarios.week[activeWeekScenario];
    var elapsed = Math.max(0, Math.floor((Date.now() - weekClockStartedAt) / 1000));
    var fixtureNow = Date.parse(scenario.demoNow) + elapsed * 1000;
    var totalSeconds = countdownFixtureSeconds === null
      ? scenario.ended ? 0 : Math.max(0, Math.floor((resetAt.getTime() - fixtureNow) / 1000))
      : countdownFixtureSeconds;
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    countdown.textContent = days + 'd ' + String(hours).padStart(2, '0') + 'h ' + String(minutes).padStart(2, '0') + 'm ' + String(seconds).padStart(2, '0') + 's';
    countdown.classList.toggle('is-under-hour', totalSeconds > 0 && totalSeconds < 3600);
    countdown.setAttribute('aria-label', (scenario.ended ? 'Ended demo week. ' : 'Demo countdown: ') + days + ' days, ' + hours + ' hours, ' + minutes + ' minutes, ' + seconds + ' seconds until ' + timeFormatter.format(resetAt) + ' (' + zoneId + ' fixture time; not synced)');
  }

  /* Deterministic, in-memory-only fixture for local browser tests and preview review. */
  window.__communityPreview = window.__communityPreview || {};
  window.__communityPreview.getFixtures = function () { return JSON.parse(JSON.stringify(fixtures)); };
  window.__communityPreview.getState = function () { return { week: activeWeekScenario, referral: activeDemoState, countdownFixtureSeconds: countdownFixtureSeconds }; };
  window.__communityPreview.setWeekScenario = selectWeekScenario;
  window.__communityPreview.setReferralScenario = function (id) {
    if (!demoStates[id]) throw new RangeError('Unknown local referral fixture.');
    activeDemoState = id;
    renderReferralProgress();
  };
  window.__communityPreview.resetLocalFixtures = function () {
    activeDemoState = 'in-progress';
    selectWeekScenario('active');
    renderReferralProgress();
  };
  window.__communityPreview.setCountdownFixture = function (seconds) {
    if (seconds === null) countdownFixtureSeconds = null;
    else if (Number.isFinite(seconds) && seconds >= 0) countdownFixtureSeconds = Math.floor(seconds);
    else throw new RangeError('Countdown fixture must be a non-negative number or null.');
    updateCountdown();
  };

  renderLeaderboard();
  renderThemeShop();
  for (var i = 0; i < 10; i++) {
    var crystal = document.createElement('span');
    crystal.className = 'referral-crystal-slot';
    crystal.setAttribute('aria-hidden', 'true');
    var gradientId = 'community-referral-gradient-' + i;
    crystal.innerHTML = '<svg viewBox="0 0 20 20"><defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e8fbff"/><stop offset="48%" stop-color="#75cdeb"/><stop offset="100%" stop-color="#8a72dc"/></linearGradient></defs><path class="milestone-crystal-fill" d="M10 1 18 7 15 18H5L2 7 10 1Z" fill="url(#' + gradientId + ')"/><path d="M10 1 18 7 15 18H5L2 7 10 1Z"/><path d="m2 7 8 3 8-3M10 10v8M6 4l4 6 4-6"/><path class="milestone-crystal-glint" d="m6 4 4 6 1-7"/></svg>';
    document.getElementById('referral-crystal-slots').appendChild(crystal);
  }
  renderReferralProgress();
  selectWeekScenario('active');
  updateCountdown();
  window.setInterval(updateCountdown, 1000);

  launcher.addEventListener('click', showCommunity);
  back.addEventListener('click', function () {
    if (!modal.classList.contains('hidden')) closeClaim();
    community.classList.add('hidden');
    home.classList.remove('hidden');
    launcher.focus({ preventScroll: true });
  });
  boardTab.addEventListener('click', function () { selectTab('leaderboard', false); });
  referralTab.addEventListener('click', function () { selectTab('referrals', false); });
  themesTab.addEventListener('click', function () { selectTab('themes', false); });
  document.querySelector('.community-tabs').addEventListener('keydown', function (event) {
    var tabButtons = [boardTab, referralTab, themesTab];
    var activeIndex = tabButtons.indexOf(document.activeElement);
    var nextIndex;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      nextIndex = (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
    } else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabButtons.length - 1;
    else return;
    event.preventDefault();
    var next = tabButtons[nextIndex];
    selectTab(next === boardTab ? 'leaderboard' : next === referralTab ? 'referrals' : 'themes', false);
    next.focus();
  });
  themeCardList.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('button[data-theme-id]');
    if (!button || button.disabled) return;
    selectThemeAction(button.getAttribute('data-theme-id'), button.getAttribute('data-theme-action'));
  });
  claimOpener.addEventListener('click', openClaim);
  document.getElementById('community-claim-close').addEventListener('click', closeClaim);
  document.getElementById('community-claim-cancel').addEventListener('click', closeClaim);
  document.getElementById('community-claim-preview').addEventListener('click', function () {
    phone.value = '';
    claimStatus.textContent = 'Preview only — no phone number was checked, sent, or saved. Reward claims are unavailable in this demo.';
    claimStatus.classList.remove('hidden');
  });
  modal.addEventListener('click', function (event) {
    if (event.target === modal) closeClaim();
  });
  document.getElementById('referral-preview-toggle').addEventListener('click', function () {
    activeDemoState = demoStates[activeDemoState] && demoStates[activeDemoState].count === 10 ? 'in-progress' : 'review-active';
    renderReferralProgress();
  });
  document.getElementById('referral-demo-state').addEventListener('change', function (event) {
    activeDemoState = event.target.value;
    renderReferralProgress();
  });
  document.getElementById('community-week-scenario').addEventListener('change', function (event) {
    selectWeekScenario(event.target.value);
  });
  document.getElementById('referral-retry').addEventListener('click', function () {
    activeDemoState = 'in-progress';
    renderReferralProgress();
    document.getElementById('referral-demo-state').focus();
  });
  reviewToggle.addEventListener('click', function () { setReviewExpanded(!reviewExpanded); });

  document.addEventListener('keydown', function (event) {
    if (!community.classList.contains('hidden') && !modal.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeClaim();
        return;
      }
      if (event.key === 'Tab') {
        var focusable = Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled]), input:not([disabled])'));
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (!community.classList.contains('hidden') && event.key === 'Escape') {
      event.preventDefault();
      back.click();
    }
  });
})();
