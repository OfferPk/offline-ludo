/* Optional Supabase account and room-lobby client. Offline game/save code is deliberately separate. */
(function () {
  'use strict';

  var config = window.CROSSFOUR_SUPABASE_CONFIG || {};
  var home = document.getElementById('home');
  var screen = document.getElementById('online');
  var statusLine = document.getElementById('online-status');
  var authPanel = document.getElementById('online-auth-panel');
  var recoveryPanel = document.getElementById('online-recovery-panel');
  var accountPanel = document.getElementById('online-account-panel');
  var roomPanel = document.getElementById('online-room-panel');
  var currentRoomId = sessionStorage.getItem('crossfour.online.room') || '';
  var currentRoom = null;
  var currentUser = null;
  var pendingMatchAction = null;
  var selectedChessSquare = -1;
  var selectedChessMoves = [];
  var pendingChessPromotion = null;
  var chessPlayViewDismissed = false;
  var chessMoveHistoryCache = { roomId: '', version: null, rows: [], captures: [] };
  var chessAnnouncementRoomId = '';
  var chessAnnouncementVersion = null;
  var chessAnnouncementState = null;
  var chessAnnouncementDrawOffer = null;
  var capacityBeforeChess = '2';
  var recoveryMode = false;
  var roomChannel = null;
  var roomChannelStatus = 'idle';
  var roomConnectionState = 'idle';
  var roomRefreshSequence = 0;
  var roomRestoreSequence = 0;
  var roomRestorePromise = null;
  var roomRestoreUserId = '';
  var roomRestoreRoomId = '';
  var walletChannel = null;
  var profileChannel = null;
  var historyChannel = null;
  var client = null;
  var sdkLoading = null;
  var nativeCallbackConfigured = false;
  var pendingInvite = new URLSearchParams(window.location.search).get('room') || sessionStorage.getItem('crossfour.online.pending-invite') || '';
  var handlingPendingInvite = false;
  if (pendingInvite) sessionStorage.setItem('crossfour.online.pending-invite', pendingInvite);
  try { pendingMatchAction = JSON.parse(sessionStorage.getItem('crossfour.online.pending-match-action') || 'null'); } catch (_) { pendingMatchAction = null; }

  function $(id) { return document.getElementById(id); }
  function isNative() {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  }
  function plugin(name) {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  }
  function isConfigured() {
    return typeof config.url === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) &&
      typeof config.publishableKey === 'string' && config.publishableKey.length > 20 &&
      config.publishableKey.indexOf('YOUR_') !== 0;
  }
  function emailPasswordEnabled() { return config.emailPasswordEnabled === true; }
  function authRedirectUrl() {
    return isNative() ? 'com.offerpk.offlineludo://auth-callback' : window.location.origin + window.location.pathname;
  }
  function announce(message, isError) {
    if (!statusLine) return;
    statusLine.textContent = message;
    statusLine.classList.toggle('is-error', !!isError);
  }
  function errorText(error) {
    var message = error && typeof error.message === 'string' ? error.message : '';
    return message || 'The request could not be completed. Please try again.';
  }
  function rpcObject(data) {
    return Array.isArray(data) ? (data[0] || {}) : (data || {});
  }
  function modeLabel(mode) {
    return mode === 'ludo_chess' ? 'Ludo Chess' : String(mode || 'classic').charAt(0).toUpperCase() + String(mode || 'classic').slice(1);
  }
  function setRoomConnectionState(state, message) {
    roomConnectionState = state;
    var line = $('online-room-connection');
    if (!line) return;
    line.dataset.state = state;
    line.textContent = message || ({
      connecting: 'Restoring the latest server match state…',
      connected: 'Connected · server match state is up to date.',
      reconnecting: 'Reconnecting · actions are paused until the latest server state is restored.',
      ended: 'Room ended · final authoritative match state is available.'
    }[state] || '');
    if (currentRoom) renderMatch();
  }
  function removeRealtimeChannel(channel) {
    if (client && channel) client.removeChannel(channel);
  }
  function clearRoomChannel() {
    var channel = roomChannel;
    roomChannel = null;
    roomChannelStatus = 'idle';
    removeRealtimeChannel(channel);
  }
  function clearAccountChannels() {
    clearRoomChannel();
    removeRealtimeChannel(walletChannel);
    removeRealtimeChannel(profileChannel);
    removeRealtimeChannel(historyChannel);
    walletChannel = null;
    profileChannel = null;
    historyChannel = null;
  }
  function clearRoomSelection(clearStoredState) {
    roomRestoreSequence++;
    roomRestorePromise = null;
    roomRestoreUserId = '';
    roomRestoreRoomId = '';
    roomRefreshSequence++;
    clearRoomChannel();
    currentRoomId = '';
    currentRoom = null;
    pendingMatchAction = null;
    selectedChessSquare = -1;
    selectedChessMoves = [];
    pendingChessPromotion = null;
    chessPlayViewDismissed = false;
    chessMoveHistoryCache = { roomId: '', version: null, rows: [], captures: [] };
    chessAnnouncementRoomId = ''; chessAnnouncementVersion = null;
    chessAnnouncementState = null; chessAnnouncementDrawOffer = null;
    if (clearStoredState) {
      sessionStorage.removeItem('crossfour.online.pending-match-action');
      sessionStorage.removeItem('crossfour.online.room');
    }
    setRoomConnectionState('idle', '');
    if (window.__cf && window.__cf.clearOnline) window.__cf.clearOnline();
    renderRoom();
  }
  function callRpc(name, args) {
    if (!client) return Promise.reject(new Error('Online services are not configured yet.'));
    return client.rpc(name, args).then(function (result) {
      if (result.error) throw result.error;
      return rpcObject(result.data);
    });
  }
  function openOnline() {
    home.classList.add('hidden');
    screen.classList.remove('hidden');
    $('online-back').focus({ preventScroll: true });
    if (!isConfigured()) {
      announce('Online setup is pending: this build has no configured Supabase project.', true);
      return;
    }
    if (!client) {
      announce('Connecting to the online sign-in service…');
      ensureClient().then(function () {
        if (currentUser) refreshAccount();
        if (pendingInvite && currentUser) joinInvite(pendingInvite);
      }).catch(function (error) { announce('Online sign-in could not load: ' + errorText(error), true); });
    } else if (currentUser) {
      refreshAccount();
      if (!pendingInvite) restoreActiveRoom();
    }
    if (pendingInvite && currentUser) joinInvite(pendingInvite);
  }
  function closeOnline() {
    screen.classList.add('hidden');
    home.classList.remove('hidden');
    $('btn-online').focus({ preventScroll: true });
  }
  function renderAccount() {
    var signedIn = !!currentUser;
    var recovering = !!recoveryMode;
    authPanel.classList.toggle('hidden', signedIn || recovering);
    recoveryPanel.classList.toggle('hidden', !recovering);
    accountPanel.classList.toggle('hidden', !signedIn || recovering);
    roomPanel.classList.toggle('hidden', !signedIn || recovering);
    $('online-signout').disabled = !signedIn;
    ['online-signin', 'online-signup', 'online-reset-request'].forEach(function (id) {
      $(id).disabled = !client || !emailPasswordEnabled();
    });
    $('online-recovery-submit').disabled = !client || !recovering;
    if (!isConfigured()) {
      $('online-config-note').textContent = 'Waiting for the Online Ludo Supabase URL and publishable key. Offline play remains available.';
    } else if (!emailPasswordEnabled()) {
      $('online-config-note').textContent = 'Email/password sign-in is disabled for this project. Offline play remains available.';
    } else {
      $('online-config-note').textContent = 'Sign in with email/password or create an account for immediate access. Password-reset email is available if you need it.';
    }
    if (recovering) {
      $('online-wallet-coins').textContent = '—';
      $('online-wallet-diamonds').textContent = '—';
      announce('Choose a new password to finish account recovery.');
      return;
    }
    if (!signedIn) {
      $('online-wallet-coins').textContent = '—';
      $('online-wallet-diamonds').textContent = '—';
      if (client && emailPasswordEnabled()) announce('Sign in to create or join online rooms.');
      else if (client) announce('Online Ludo email/password authentication is not enabled.', true);
      return;
    }
    $('online-profile-name').value = '';
    $('online-profile-handle').textContent = 'Loading profile…';
  }
  function readCredentials() {
    var emailField = $('online-email');
    var passwordField = $('online-password');
    if (!emailField.checkValidity()) { emailField.reportValidity(); return null; }
    if (!passwordField.value) {
      passwordField.focus();
      announce('Enter your password to continue.', true);
      return null;
    }
    var credentials = { email: emailField.value.trim(), password: passwordField.value };
    passwordField.value = '';
    return credentials;
  }
  function signInWithPassword() {
    if (!client || !emailPasswordEnabled()) return announce('Email/password sign-in is unavailable.', true);
    var credentials = readCredentials();
    if (!credentials) return;
    announce('Signing in…');
    client.auth.signInWithPassword(credentials).then(function (result) {
      if (result.error) throw result.error;
      var session = result.data && result.data.session;
      if (!session || !session.user) return announce('Sign-in could not start a session. Please try again.', true);
      recoveryMode = false;
      currentUser = session.user;
      renderAccount();
      announce('Signed in. Your online account is ready.');
      return refreshAccount();
    }).catch(function (error) { announce('Sign-in failed: ' + errorText(error), true); });
  }
  function signUpWithPassword() {
    if (!client || !emailPasswordEnabled()) return announce('Email/password account creation is unavailable.', true);
    var credentials = readCredentials();
    if (!credentials) return;
    announce('Creating your account…');
    client.auth.signUp({ email: credentials.email, password: credentials.password }).then(function (result) {
      if (result.error) throw result.error;
      var session = result.data && result.data.session;
      if (session && session.user) {
        currentUser = session.user;
        renderAccount();
        announce('Account created and signed in.');
        return refreshAccount();
      }
      announce('Account created, but automatic sign-in did not start. Sign in with the same email and password.', true);
    }).catch(function (error) { announce('Account creation failed: ' + errorText(error), true); });
  }
  function requestPasswordReset() {
    if (!client || !emailPasswordEnabled()) return announce('Password reset is unavailable.', true);
    var emailField = $('online-email');
    if (!emailField.checkValidity()) { emailField.reportValidity(); return; }
    announce('Requesting a password reset…');
    client.auth.resetPasswordForEmail(emailField.value.trim(), { redirectTo: authRedirectUrl() }).then(function (result) {
      if (result.error) throw result.error;
      announce('If an account exists for that address, a reset link will be sent. Supabase default email only reaches project-team addresses; if this address is not on the team, the link will not arrive until custom SMTP is configured.');
    }).catch(function (error) { announce('Password reset could not be requested: ' + errorText(error), true); });
  }
  function updateRecoveredPassword(event) {
    event.preventDefault();
    if (!client || !recoveryMode) return;
    var passwordField = $('online-new-password');
    if (!passwordField.value) { passwordField.focus(); return announce('Enter a new password.', true); }
    var password = passwordField.value;
    passwordField.value = '';
    $('online-recovery-submit').disabled = true;
    announce('Updating your password…');
    client.auth.updateUser({ password: password }).then(function (result) {
      if (result.error) throw result.error;
      recoveryMode = false;
      renderAccount();
      announce('Password updated. You are signed in.');
      return refreshAccount();
    }).catch(function (error) { announce('Password could not be updated: ' + errorText(error), true); })
      .finally(function () { $('online-recovery-submit').disabled = !client || !recoveryMode; });
  }
  function refreshAccount() {
    if (!client || !currentUser) return Promise.resolve();
    var requestedUserId = currentUser.id;
    return Promise.all([
      client.from('profiles').select('handle,display_name').eq('id', currentUser.id).maybeSingle(),
      client.from('wallets').select('coins,diamonds').eq('user_id', currentUser.id).maybeSingle()
    ]).then(function (results) {
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      if (!currentUser || currentUser.id !== requestedUserId) return;
      var profile = results[0].data;
      var wallet = results[1].data;
      if (profile) {
        $('online-profile-name').value = profile.display_name || '';
        $('online-profile-handle').textContent = '@' + (profile.handle || 'player');
      } else {
        $('online-profile-handle').textContent = 'Profile is being created…';
      }
      $('online-wallet-coins').textContent = wallet ? Number(wallet.coins).toLocaleString() : '0';
      $('online-wallet-diamonds').textContent = wallet ? Number(wallet.diamonds).toLocaleString() : '0';
      return refreshHistory();
    }).catch(function (error) {
      announce('Account data could not be loaded: ' + errorText(error), true);
    });
  }
  function refreshHistory() {
    if (!client || !currentUser) return Promise.resolve();
    var requestedUserId = currentUser.id;
    return client.from('match_history')
      .select('id,mode,status,winner_id,started_at,finished_at')
      .order('started_at', { ascending: false })
      .limit(10)
      .then(function (result) {
        if (result.error) throw result.error;
        if (!currentUser || currentUser.id !== requestedUserId) return;
        var list = $('online-history-list');
        list.replaceChildren();
        (result.data || []).forEach(function (match) {
          var item = document.createElement('li');
          var title = document.createElement('b');
          title.textContent = modeLabel(match.mode) + ' · ' + match.status;
          var detail = document.createElement('small');
          detail.textContent = new Date(match.started_at).toLocaleString();
          item.append(title, detail);
        list.appendChild(item);
      });
      $('online-history-empty').classList.toggle('hidden', !!(result.data && result.data.length));
      }).catch(function () {
        announce('Match history could not be refreshed. Try again when your connection is stable.', true);
      });
  }
  function renderRoom() {
    var room = currentRoom;
    var card = $('online-room-card');
    card.classList.toggle('hidden', !room);
    if (!room) { $('online-start-room').disabled = true; $('online-chess-resume').classList.add('hidden'); renderMatch(); return; }
    if (room.status === 'completed' || room.status === 'cancelled' || (room.matchState && room.matchState.state && room.matchState.state.phase === 'over')) setRoomConnectionState('ended');
    $('online-room-mode').textContent = modeLabel(room.mode) + ' · ' + room.capacity + ' seats';
    var roster = Array.isArray(room.roster) ? room.roster : [];
    var readyCount = roster.filter(function (member) { return !!member.ready; }).length;
    var unreadyCount = roster.length - readyCount;
    var isHost = room.created_by === (currentUser && currentUser.id);
    var canStart = room.status === 'waiting' && isHost && roster.length >= 2 && unreadyCount === 0;
    $('online-room-status').textContent = room.status === 'active'
      ? (room.matchState ? (room.mode === 'ludo_chess' ? 'Ludo Chess is active. Legal moves and match state are validated by the server.' : 'Online Classic match is active. Dice and moves are validated by the server.') : 'This table predates the current online gameplay update. Create a new table to play online.')
      : room.status === 'completed' ? 'This table is complete.' : room.status === 'cancelled' ? 'This table was cancelled.'
        : roster.length < 2 ? 'Waiting for players · ' + roster.length + '/2 minimum players joined; ' + readyCount + ' ready.'
          : unreadyCount ? roster.length + ' players joined · ' + readyCount + '/' + roster.length + ' ready. The host can start when everyone is ready.'
            : roster.length + ' players joined · everyone is ready. The host can start the table.';
    $('online-invite-code').value = room.inviteCode || '';
    var startButton = $('online-start-room');
    startButton.classList.toggle('hidden', room.status !== 'waiting' || !isHost);
    startButton.disabled = !canStart;
    startButton.title = canStart ? 'Start the table.' : room.status !== 'waiting' ? '' : roster.length < 2 ? 'At least two players must join before the match can start.' : unreadyCount ? 'Every player must be ready before the match can start.' : '';
    startButton.setAttribute('aria-describedby', 'online-room-status');
    $('online-ready').classList.toggle('hidden', room.status !== 'waiting');
    $('online-ready').textContent = room.myReady ? 'Mark not ready' : 'Ready';
    $('online-ready').setAttribute('aria-pressed', String(!!room.myReady));
    $('online-room-roster').replaceChildren();
    room.roster.forEach(function (member) {
      var item = document.createElement('li');
      var playerName = document.createElement('b');
      playerName.textContent = member.displayName || member.handle || 'Player';
      var playerState = document.createElement('small');
      playerState.textContent = 'Seat ' + (member.seat + 1) + ' · ' + (member.ready ? 'Ready' : 'Not ready') + (member.role === 'host' ? ' · Host' : '');
      item.append(playerName, playerState);
      $('online-room-roster').appendChild(item);
    });
    $('online-chess-resume').classList.toggle('hidden', !(room.mode === 'ludo_chess' && room.matchState && room.matchState.state && chessPlayViewDismissed));
    renderMatch();
  }
  function chessPlayerName(room, seat) {
    var member = room.roster.find(function (candidate) { return Number(candidate.seat) === Number(seat); });
    return (member && (member.displayName || member.handle)) || 'Player';
  }
  function chessSeatName(room, seat) {
    return (Number(seat) === 0 ? 'Red' : 'Blue') + ' · ' + chessPlayerName(room, seat);
  }
  function renderChessDrawControls(state, room, isSynchronized) {
    var offer = room.matchState && room.matchState.draw_offer || null;
    var member = room.roster.find(function (candidate) { return candidate.user_id === (currentUser && currentUser.id); });
    var isActive = room.status === 'active' && state.phase === 'active';
    var isOfferer = !!(offer && member && Number(offer.offered_by) === Number(member.seat));
    var hasOffer = !!offer;
    var canAct = isActive && isSynchronized && !pendingMatchAction;
    $('online-chess-offer-draw').classList.toggle('hidden', !isActive || hasOffer || !!pendingMatchAction);
    $('online-chess-withdraw-draw').classList.toggle('hidden', !isActive || !isOfferer);
    $('online-chess-accept-draw').classList.toggle('hidden', !isActive || !hasOffer || isOfferer);
    $('online-chess-decline-draw').classList.toggle('hidden', !isActive || !hasOffer || isOfferer);
    ['online-chess-offer-draw', 'online-chess-withdraw-draw', 'online-chess-accept-draw', 'online-chess-decline-draw']
      .forEach(function (id) { $(id).disabled = !canAct; });
    var message;
    if (!isActive) message = 'Draw offers are available only while the game is active.';
    else if (!hasOffer) message = 'Either player may offer a draw. A completed move clears any pending offer.';
    else if (isOfferer) message = 'Your draw offer is pending. You may withdraw it; either player may also continue with a move.';
    else message = chessSeatName(room, Number(offer.offered_by)) + ' offered a draw. Accept, decline, or make a move; a completed move clears the offer.';
    $('online-chess-draw-status').textContent = message;
  }
  function chessResultLabel(state, room) {
    var labels = {
      checkmate: 'Checkmate', stalemate: 'Stalemate · draw', draw_seventy_five_moves: 'Draw · 75-move rule',
      draw_fivefold_repetition: 'Draw · fivefold repetition', draw_insufficient_material: 'Draw · insufficient material',
      draw_fifty_move_claim: 'Draw · 50-move claim', draw_threefold_claim: 'Draw · threefold repetition claim',
      draw_agreement: 'Draw · by agreement', resignation: 'Resignation'
    };
    var text = labels[state.result] || 'Game complete';
    return state.winner === 0 || state.winner === 1 ? text + ' · ' + chessSeatName(room, state.winner) + ' wins' : text;
  }
  function chessStateAnnouncement(state, room, previousState, previousOffer, currentOffer) {
    if (state.phase === 'over') return chessResultLabel(state, room);
    if (currentOffer && !previousOffer) return 'Draw offer from ' + chessSeatName(room, Number(currentOffer.offered_by)) + '. ' + chessSeatName(room, state.turn) + ' to move.';
    if (previousOffer && !currentOffer && previousState && JSON.stringify(previousState.last_move) === JSON.stringify(state.last_move)) {
      return 'The draw offer was withdrawn or declined. ' + chessSeatName(room, state.turn) + ' to move.';
    }
    var last = state.last_move;
    if (!last || !window.LudoChess) return chessSeatName(room, state.turn) + ' to move.';
    var chess = window.LudoChess;
    var mover = 1 - Number(state.turn);
    var message = chessSeatName(room, mover) + ' moved from ' + chess.coord(Number(last.from)) + ' to ' + chess.coord(Number(last.to));
    if (last.capture) message += ' and captured a piece';
    if (last.promotion) message += ' and promoted a pawn';
    if (state.check) message += ' and gave check';
    message += '. ' + chessSeatName(room, state.turn) + ' to move.';
    return message;
  }
  function chessMoveHistory(state, room, version) {
    var roomId = room && room.id || '';
    if (chessMoveHistoryCache.roomId === roomId && chessMoveHistoryCache.version === version) return chessMoveHistoryCache;
    var chess = window.LudoChess, derived = chess && chess.movesFromPositionHistory ? chess.movesFromPositionHistory(state) : { complete: false, moves: [], reason: 'Complete server move history is unavailable.' };
    var rows = [], captures = [];
    derived.moves.forEach(function (entry) {
      var row = rows.find(function (candidate) { return candidate.number === entry.number; });
      if (!row) { row = { number: entry.number, red: '', blue: '' }; rows.push(row); }
      row[entry.color === 0 ? 'red' : 'blue'] = derived.complete ? entry.san : entry.coordinate;
      if (entry.capture && entry.capturedPiece) captures.push({ by: entry.color, piece: entry.capturedPiece });
    });
    if (!derived.moves.length && state && state.last_move && chess) {
      var last = state.last_move, lastMover = 1 - Number(state.turn);
      var lastNumber = Math.max(1, (Number(state.fullmove) || 1) - (lastMover === 1 ? 1 : 0));
      var fallback = { number: lastNumber, red: '', blue: '' };
      fallback[lastMover === 0 ? 'red' : 'blue'] = chess.coord(Number(last.from)) + (last.capture || last.en_passant ? '×' : '–') + chess.coord(Number(last.to)) + (last.promotion ? '=' + String(last.promotion).toUpperCase() : '') + (state.result === 'checkmate' ? '#' : state.check ? '+' : '');
      rows.push(fallback);
    }
    rows.sort(function (a, b) { return a.number - b.number; });
    chessMoveHistoryCache = { roomId: roomId, version: version, rows: rows, captures: captures, complete: !!derived.complete, reason: derived.reason || '' };
    return chessMoveHistoryCache;
  }
  function renderChessMoveHistory(state, room, version) {
    var list = $('online-chess-move-list'), empty = $('online-chess-move-empty'), history = chessMoveHistory(state, room, version), rows = history.rows;
    var count = rows.reduce(function (total, row) { return total + (row.red ? 1 : 0) + (row.blue ? 1 : 0); }, 0);
    $('online-chess-history-notation').textContent = history.complete ? 'Standard algebraic notation (SAN)' : 'Coordinate notation · incomplete server history';
    list.setAttribute('aria-label', history.complete ? 'Move list in standard algebraic chess notation' : 'Verified coordinate moves; the full move history is unavailable');
    $('online-chess-copy-pgn').disabled = !history.complete;
    $('online-chess-copy-pgn').title = history.complete ? 'Copy the verified complete game as PGN; download it if clipboard access is unavailable.' : 'PGN export requires a complete, verifiable server move history.';
    $('online-chess-pgn-status').textContent = history.complete
      ? (count ? 'PGN ready · full server history verified.' : 'PGN ready · Red moves first.')
      : (history.reason || 'PGN unavailable because the server did not provide a complete move history.');
    list.replaceChildren();
    rows.forEach(function (row, index) {
      if (!row || (!row.red && !row.blue)) return;
      var item = document.createElement('li'); item.className = index === rows.length - 1 ? 'is-latest' : '';
      var number = document.createElement('span'); number.className = 'chess-move-number'; number.textContent = String(row.number) + '.';
      var red = document.createElement('span'); red.className = 'red-move'; red.textContent = row.red || '—';
      var blue = document.createElement('span'); blue.className = 'blue-move'; blue.textContent = row.blue || '—';
      item.append(number, red, blue);
      if (index === rows.length - 1) item.setAttribute('aria-current', 'step');
      list.appendChild(item);
    });
    $('online-chess-move-count').textContent = count + (count === 1 ? ' move' : ' moves');
    if (!count) empty.textContent = history.complete ? 'No moves yet. Red makes the first move.' : 'No complete move could be verified. PGN export is unavailable.';
    empty.classList.toggle('hidden', count > 0);
    if (count > 0) list.scrollTop = list.scrollHeight;
  }
  function downloadChessPgn(pgn) {
    if (typeof Blob !== 'function' || !window.URL || typeof window.URL.createObjectURL !== 'function') throw new Error('File export is unavailable in this browser.');
    var blob = new Blob([pgn], { type: 'application/vnd.chess-pgn; charset=utf-8' });
    var url = window.URL.createObjectURL(blob), link = document.createElement('a');
    var roomName = String(currentRoomId || 'game').replace(/[^a-z0-9_-]/gi, '-');
    link.href = url; link.download = 'ludo-chess-' + roomName + '.pgn'; link.hidden = true;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 1000);
    $('online-chess-pgn-status').textContent = 'Clipboard access was unavailable; the PGN file was downloaded.';
  }
  function copyChessPgn() {
    if (!currentRoom || !currentRoom.matchState || !currentRoom.matchState.state || !window.LudoChess) return;
    try {
      var state = currentRoom.matchState.state;
      var pgn = window.LudoChess.exportPgn(state, { red: chessPlayerName(currentRoom, 0), blue: chessPlayerName(currentRoom, 1) });
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return downloadChessPgn(pgn);
      navigator.clipboard.writeText(pgn).then(function () {
        $('online-chess-pgn-status').textContent = 'PGN copied to clipboard.';
      }).catch(function () { try { downloadChessPgn(pgn); } catch (error) { $('online-chess-pgn-status').textContent = 'PGN could not be copied or downloaded: ' + errorText(error); } });
    } catch (error) {
      $('online-chess-pgn-status').textContent = 'PGN export unavailable: ' + errorText(error);
    }
  }
  function renderCapturedPieces(captures, capturingSeat, targetId) {
    var target = $(targetId), glyphs = { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }, counts = {}, total = 0;
    target.replaceChildren();
    (captures || []).forEach(function (capture) {
      if (Number(capture.by) !== Number(capturingSeat)) return;
      var piece = String(capture.piece || ''), type = piece.toLowerCase();
      if (!glyphs[type]) return;
      var key = (piece === piece.toUpperCase() ? 'red-' : 'blue-') + type;
      counts[key] = (counts[key] || 0) + 1; total++;
    });
    ['red-', 'blue-'].forEach(function (side) {
      ['q', 'r', 'b', 'n', 'p'].forEach(function (type) {
        var count = counts[side + type];
        if (!count) return;
        var colorName = side === 'red-' ? 'Red' : 'Blue';
        var token = document.createElement('span'); token.className = 'chess-captured-piece ' + (side === 'red-' ? 'red-piece' : 'blue-piece');
        token.textContent = glyphs[type] + (count > 1 ? ' ×' + count : '');
        token.setAttribute('aria-label', count + ' captured ' + colorName.toLowerCase() + ' ' + (count === 1 ? window.LudoChess.pieceName(type) : window.LudoChess.pieceName(type) + 's'));
        target.appendChild(token);
      });
    });
    if (!total) target.textContent = '—';
    target.setAttribute('aria-label', total ? total + ' captured pieces' : 'No pieces captured yet');
  }
  function setChessPlayScreen(open) {
    var playScreen = $('online-chess-screen'), roomCard = $('online-room-card'), panel = $('online-match-panel');
    var connection = $('online-room-connection'), leave = $('online-leave-room'), retry = $('online-match-retry');
    var network = $('online-chess-network'), headerActions = $('online-chess-header-actions'), roomHeaderActions = roomCard.querySelector('.online-room-actions');
    var onlineBody = playScreen.parentNode.querySelector('.online-body'), onlineTopbar = playScreen.parentNode.querySelector('.online-topbar');
    var entering = open && playScreen.classList.contains('hidden');
    if (open) {
      playScreen.appendChild(panel); network.appendChild(connection); headerActions.appendChild(leave); $('online-chess-actions').appendChild(retry);
      playScreen.classList.remove('hidden'); playScreen.setAttribute('aria-hidden', 'false');
      onlineBody.setAttribute('aria-hidden', 'true'); onlineTopbar.setAttribute('aria-hidden', 'true');
      if (entering) $('online-chess-screen-title').focus({ preventScroll: true });
    } else {
      roomCard.appendChild(panel); roomCard.insertBefore(connection, $('online-invite-code').parentNode);
      roomHeaderActions.appendChild(leave); $('online-match-actions').appendChild(retry);
      playScreen.classList.add('hidden'); playScreen.setAttribute('aria-hidden', 'true');
      onlineBody.removeAttribute('aria-hidden'); onlineTopbar.removeAttribute('aria-hidden');
    }
  }
  function chooseChessSquare(index, state, isMyTurn) {
    if (!isMyTurn || state.phase !== 'active' || pendingMatchAction || pendingChessPromotion || roomConnectionState !== 'connected' || !window.LudoChess) return;
    var matching = selectedChessMoves.find(function (move) { return move.to === index; });
    if (selectedChessSquare >= 0 && matching) {
      if (matching.promotion) {
        pendingChessPromotion = { from: selectedChessSquare, to: index };
        renderChessBoard(state, currentRoom, isMyTurn);
      } else {
        var args = { p_from: selectedChessSquare, p_to: index, p_promotion: null };
        selectedChessSquare = -1; selectedChessMoves = [];
        submitMatchAction('ludo_chess_move', args);
      }
      return;
    }
    var piece = state.board[index];
    if (piece !== '.' && window.LudoChess.colorOf(piece) === Number(state.turn)) {
      selectedChessSquare = index;
      selectedChessMoves = window.LudoChess.legalMoves(state, index);
    } else {
      selectedChessSquare = -1;
      selectedChessMoves = [];
    }
    renderChessBoard(state, currentRoom, isMyTurn);
  }
  var chessCelebrated = '';
  /** v1.6.3: the Gulaab Camel trots to the winning chess player's card (decisive results only). */
  function celebrateChessWin(state, room) {
    if (!window.CamelCelebration || state.phase !== 'over' || (state.winner !== 0 && state.winner !== 1)) return;
    var key = (room && room.id) + '|' + state.winner + '|' + (state.fullmove || 0) + '|' + (state.result || '');
    if (chessCelebrated === key) return;
    chessCelebrated = key;
    setTimeout(function () {
      var card = $(state.winner === 0 ? 'online-chess-red' : 'online-chess-blue');
      if (!card) return;
      try {
        window.CamelCelebration.play({ target: card, anchor: card.querySelector('.chess-player-mark') || card, color: state.winner === 0 ? '#e5484d' : '#3b82f6', seat: 'chess-' + state.winner });
      } catch (error) { /* cosmetic only */ }
    }, 60);
  }
  function renderChessBoard(state, room, isMyTurn) {
    var chess = window.LudoChess;
    if (!chess || !state || typeof state.board !== 'string' || state.board.length !== 64) return;
    var board = $('online-chess-board');
    var activeSquare = board.contains(document.activeElement) ? Number(document.activeElement.dataset.square) : -1;
    var restoreFocus = Number.isInteger(activeSquare) && activeSquare >= 0 && activeSquare < 64;
    var focusIndex = restoreFocus ? activeSquare : (selectedChessSquare >= 0 ? selectedChessSquare : (state.last_move && Number.isInteger(state.last_move.to) ? state.last_move.to : 0));
    var chars = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' };
    if (!isMyTurn || state.phase !== 'active' || pendingMatchAction) {
      selectedChessSquare = -1; selectedChessMoves = []; pendingChessPromotion = null;
    }
    $('online-chess-red').classList.toggle('is-turn', state.phase === 'active' && Number(state.turn) === 0);
    $('online-chess-blue').classList.toggle('is-turn', state.phase === 'active' && Number(state.turn) === 1);
    var redName = chessPlayerName(room, 0), blueName = chessPlayerName(room, 1);
    var myMember = room.roster.find(function (member) { return member.user_id === (currentUser && currentUser.id); });
    $('online-chess-red-name').textContent = redName;
    $('online-chess-blue-name').textContent = blueName;
    $('online-chess-red-role').textContent = 'Red pieces · ' + (myMember && Number(myMember.seat) === 0 ? 'you' : 'opponent');
    $('online-chess-blue-role').textContent = 'Blue pieces · ' + (myMember && Number(myMember.seat) === 1 ? 'you' : 'opponent');
    $('online-chess-status').textContent = state.phase === 'over'
      ? chessResultLabel(state, room)
      : chessSeatName(room, state.turn) + (isMyTurn ? ' · your move' : ' · waiting for their move') + (state.check ? ' · Check!' : '');
    $('online-chess-result').textContent = state.phase === 'over'
      ? chessResultLabel(state, room) + '. Match saved to online history.'
      : 'Standard chess rules · Red pieces move first · Select a piece, then a highlighted square.';
    celebrateChessWin(state, room);
    $('online-chess-claim-draw').classList.toggle('hidden', state.phase !== 'active' || !isMyTurn || pendingMatchAction || !chess.canClaimDraw(state));
    $('online-chess-resign').classList.toggle('hidden', state.phase !== 'active' || !isMyTurn || !!pendingMatchAction);
    $('online-chess-promotion').classList.toggle('hidden', !pendingChessPromotion || !!pendingMatchAction);
    board.replaceChildren();
    for (var row = 0; row < 8; row++) {
      var rowElement = document.createElement('div');
      rowElement.className = 'online-chess-row';
      rowElement.setAttribute('role', 'row'); rowElement.setAttribute('aria-rowindex', String(row + 1));
      for (var col = 0; col < 8; col++) {
        var index = row * 8 + col, piece = state.board[index];
        var cell = document.createElement('button');
        cell.type = 'button'; cell.setAttribute('role', 'gridcell'); cell.dataset.square = String(index);
        cell.tabIndex = index === focusIndex ? 0 : -1;
        cell.setAttribute('aria-colindex', String(col + 1));
        cell.setAttribute('aria-selected', String(selectedChessSquare === index));
        cell.setAttribute('aria-disabled', String(!isMyTurn || state.phase !== 'active' || !!pendingMatchAction || roomConnectionState !== 'connected'));
        cell.className = 'online-chess-square ' + ((row + col) % 2 ? 'dark' : 'light');
        var checkedKing = state.check ? state.board.indexOf(Number(state.turn) === 0 ? 'K' : 'k') : -1;
        if (index === checkedKing) cell.classList.add('is-check');
        if (selectedChessSquare === index) cell.classList.add('is-selected');
        var legal = selectedChessMoves.find(function (move) { return move.to === index; });
        if (legal) { cell.classList.add('is-legal'); if (state.board[index] !== '.' || legal.enPassant) cell.classList.add('is-capture'); }
        if (state.last_move && (state.last_move.from === index || state.last_move.to === index)) cell.classList.add(state.last_move.from === index ? 'last-from' : 'last-to');
        var label = piece === '.' ? 'Empty square' : (window.LudoChess.colorOf(piece) === 0 ? 'Red ' : 'Blue ') + chess.pieceName(piece);
        cell.setAttribute('aria-label', label + ' on ' + chess.coord(index) + ((selectedChessSquare === index) ? ', selected' : '') + (legal ? ', legal destination' : '') + (index === checkedKing ? ', in check' : ''));
        if (col === 0) {
          var rank = document.createElement('span'); rank.className = 'square-coord rank-coord'; rank.textContent = String(8 - row); cell.appendChild(rank);
        }
        if (row === 7) {
          var file = document.createElement('span'); file.className = 'square-coord file-coord'; file.textContent = String.fromCharCode(97 + col); cell.appendChild(file);
        }
        if (piece !== '.') {
          var glyph = document.createElement('span'); glyph.className = 'online-chess-piece ' + (window.LudoChess.colorOf(piece) === 0 ? 'red-piece' : 'blue-piece');
          glyph.textContent = chars[piece]; glyph.setAttribute('aria-hidden', 'true'); cell.appendChild(glyph);
        }
        cell.addEventListener('focus', function (focusedCell) { return function () {
          board.querySelectorAll('[data-square]').forEach(function (square) { square.tabIndex = square === focusedCell ? 0 : -1; });
        }; }(cell));
        cell.addEventListener('click', function (squareIndex) { return function () { chooseChessSquare(squareIndex, state, isMyTurn); }; }(index));
        cell.addEventListener('keydown', function (squareRow, squareCol) { return function (event) {
          var directions = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
          var delta = directions[event.key];
          if (!delta) return;
          event.preventDefault();
          var nextRow = squareRow + delta[0], nextCol = squareCol + delta[1];
          if (nextRow < 0 || nextRow > 7 || nextCol < 0 || nextCol > 7) return;
          var nextCell = board.querySelector('[data-square="' + (nextRow * 8 + nextCol) + '"]');
          if (nextCell) nextCell.focus();
        }; }(row, col));
        rowElement.appendChild(cell);
      }
      board.appendChild(rowElement);
    }
    if (restoreFocus) {
      var focusTarget = board.querySelector('[data-square="' + focusIndex + '"]');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  }
  function expireOnlineTurn() {
    if (!currentRoomId || !client || roomConnectionState !== 'connected') return;
    callRpc('expire_turn', { p_room_id: currentRoomId }).then(function () { return refreshRoom(); }).catch(function (error) {
      if (!/expire_turn|schema cache|Could not find the function|PGRST202/i.test(errorText(error))) announce('Turn timer could not be applied: ' + errorText(error), true);
    });
  }
  function renderMatch() {
    var room = currentRoom;
    var panel = $('online-match-panel');
    var record = room && room.matchState;
    var show = !!(room && (room.status === 'active' || room.status === 'completed') && record && record.state);
    panel.classList.toggle('hidden', !show);
    if (!show) {
      $('online-chess-play').classList.add('hidden');
      $('online-chess-resume').classList.add('hidden');
      panel.classList.remove('is-chess-match');
      setChessPlayScreen(false);
      chessAnnouncementRoomId = ''; chessAnnouncementVersion = null; chessAnnouncementState = null; chessAnnouncementDrawOffer = null; $('online-chess-announcement').textContent = '';
      if (window.__cf && window.__cf.clearOnline) window.__cf.clearOnline();
      return;
    }
    var state = record.state;
    var isChess = room.mode === 'ludo_chess';
    if (isChess) {
      var nextChessVersion = Number(record.version);
      var nextDrawOffer = record.draw_offer || null;
      if (chessAnnouncementRoomId !== room.id) {
        chessAnnouncementRoomId = room.id; chessAnnouncementVersion = nextChessVersion; $('online-chess-announcement').textContent = '';
      } else if (Number.isFinite(nextChessVersion) && nextChessVersion > Number(chessAnnouncementVersion)) {
        $('online-chess-announcement').textContent = chessStateAnnouncement(state, room, chessAnnouncementState, chessAnnouncementDrawOffer, nextDrawOffer);
        chessAnnouncementVersion = nextChessVersion;
      }
      chessAnnouncementState = state;
      chessAnnouncementDrawOffer = nextDrawOffer;
    } else {
      chessAnnouncementRoomId = ''; chessAnnouncementVersion = null; $('online-chess-announcement').textContent = '';
      chessAnnouncementState = null; chessAnnouncementDrawOffer = null;
    }
    panel.classList.toggle('is-chess-match', isChess);
    $('online-chess-resume').classList.toggle('hidden', !isChess || !chessPlayViewDismissed);
    setChessPlayScreen(isChess && !chessPlayViewDismissed);
    var isSynchronized = roomConnectionState === 'connected';
    var myMember = room.roster.find(function (member) { return member.user_id === (currentUser && currentUser.id); });
    var turnMember = room.roster.find(function (member) { return Number(member.seat) === Number(state.turn); });
    var isMyTurn = !!(myMember && Number(myMember.seat) === Number(state.turn));
    $('online-match-version').textContent = 'Version ' + record.version;
    $('online-match-eyebrow').textContent = isChess ? 'LUDO CHESS · LIVE STATE' : 'ONLINE CLASSIC · LIVE STATE';
    $('online-match-heading').textContent = isChess ? (state.phase === 'over' ? 'Game complete' : 'Move ' + (state.fullmove || 1)) : (state.phase === 'over' ? 'Match complete' : 'Turn ' + ((state.turn_count || 0) + 1));
    $('online-match-turn').textContent = isChess
      ? (state.phase === 'over' ? chessResultLabel(state, room) : chessSeatName(room, state.turn) + (isMyTurn ? ' · your move' : ' · waiting for their move') + (state.check ? ' · check' : ''))
      : (state.phase === 'over' ? 'Match complete. Winner: ' + ((room.roster.find(function (member) { return member.seat === Number((state.ranking || [])[0]); }) || {}).displayName || '—')
        : (turnMember ? turnMember.displayName || turnMember.handle || 'Player' : 'Player') + (isMyTurn ? ' · your turn' : ' · waiting for their turn') + (state.phase === 'move' ? ' · choose a legal token move' : ' · roll phase'));
    $('online-chess-play').classList.toggle('hidden', !isChess);
    ['online-match-dice', 'online-match-pieces', 'online-match-moves', 'online-classic-note', 'online-roll'].forEach(function (id) { $(id).classList.toggle('hidden', true); });
    if (!isChess) $('online-roll').classList.add('hidden');
    $('online-roll').disabled = !isSynchronized;
    $('online-match-retry').classList.toggle('hidden', !pendingMatchAction || pendingMatchAction.room_id !== currentRoomId);
    $('online-match-retry').disabled = !isSynchronized;
    $('online-chess-claim-draw').disabled = !isSynchronized;
    $('online-chess-resign').disabled = !isSynchronized;
    $('online-chess-promotion').querySelectorAll('[data-promotion]').forEach(function (button) { button.disabled = !isSynchronized; });
    if (isChess) {
      if (window.__cf && window.__cf.clearOnline) window.__cf.clearOnline();
      renderChessDrawControls(state, room, isSynchronized);
      renderChessMoveHistory(state, room, record.version);
      renderCapturedPieces(chessMoveHistoryCache.captures, 0, 'online-chess-red-captured');
      renderCapturedPieces(chessMoveHistoryCache.captures, 1, 'online-chess-blue-captured');
      renderChessBoard(state, room, isMyTurn);
      return;
    }
    var lastRoll = state.last_roll;
    var queue = Array.isArray(state.queue) ? state.queue : [];
    $('online-match-dice').textContent = (lastRoll ? 'Last server die: seat ' + (Number(lastRoll.seat) + 1) + ' rolled ' + lastRoll.face + '. ' : '') +
      (queue.length ? 'Dice to use: ' + queue.join(' · ') : 'No pending dice.');
    if (isMyTurn && state.phase === 'move' && !pendingMatchAction && window.LudoLogic && typeof window.LudoLogic.queueMoves === 'function') {
      var localView = { mode: 'classic', players: state.players, pieces: state.pieces, rules: state.rules, turn: Number(state.turn), phase: 'move', queue: queue, ranking: state.ranking || [], effects: [], capd: state.capd || [false, false, false, false], lk: null };
      window.LudoLogic.queueMoves(localView);
    }
    var names = {};
    (room.roster || []).forEach(function (member) { names[Number(member.seat)] = member.displayName || member.handle || ('Seat ' + (Number(member.seat) + 1)); });
    if (window.__cf && window.__cf.presentOnline) {
      window.__cf.presentOnline({
        state: state,
        mySeat: myMember ? Number(myMember.seat) : Number(state.turn),
        names: names,
        deadline: Number(state.turn_deadline) || 0,
        grace: state.grace || null,
        pending: !!(pendingMatchAction && pendingMatchAction.room_id === currentRoomId),
        onRoll: function () { submitMatchAction('roll_match', {}); },
        onMove: function (piece, queueIndex) { submitMatchAction('move_match', { p_piece: piece, p_queue_index: queueIndex }); },
        onExpire: function () { expireOnlineTurn(); },
        onRetry: runPendingMatchAction
      });
    }
  }
  function discoverActiveRoom(userId, restoreToken) {
    if (!client || !currentUser || currentUser.id !== userId) return Promise.resolve(null);
    return client.from('room_members').select('room_id').eq('user_id', userId).then(function (membershipResult) {
      if (membershipResult.error) throw membershipResult.error;
      if (restoreToken !== roomRestoreSequence || !currentUser || currentUser.id !== userId) return null;
      var roomIds = Array.from(new Set((membershipResult.data || []).map(function (member) { return member.room_id; }).filter(Boolean)));
      if (!roomIds.length) return { rooms: [] };
      return client.from('rooms').select('id,created_by,mode,capacity,status,updated_at').in('id', roomIds).then(function (roomResult) {
        if (roomResult.error) throw roomResult.error;
        return { rooms: roomResult.data || [] };
      });
    }).then(function (result) {
      if (!result || restoreToken !== roomRestoreSequence || !currentUser || currentUser.id !== userId) return null;
      var active = result.rooms.filter(function (room) {
        return room.status === 'active' && (room.mode === 'classic' || room.mode === 'ludo_chess');
      }).sort(function (a, b) { return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); })[0];
      if (!active) return null;
      currentRoomId = active.id;
      roomRestoreRoomId = active.id;
      currentRoom = null;
      sessionStorage.setItem('crossfour.online.room', currentRoomId);
      subscribeRoom();
      setRoomConnectionState('reconnecting');
      return refreshRoom();
    }).catch(function (error) {
      if (restoreToken === roomRestoreSequence && currentUser && currentUser.id === userId) {
        setRoomConnectionState(currentRoom ? 'reconnecting' : 'idle', currentRoom ? undefined : 'Could not check for an active room. Try again when your connection is stable.');
        announce('Active online room could not be restored: ' + errorText(error), true);
      }
      return null;
    });
  }
  function restoreActiveRoom() {
    if (!client || !currentUser || recoveryMode) return Promise.resolve(null);
    var userId = currentUser.id;
    var roomId = currentRoomId;
    if (roomRestorePromise && roomRestoreUserId === userId && roomRestoreRoomId === roomId) return roomRestorePromise;
    var restoreToken = ++roomRestoreSequence;
    roomRestoreUserId = userId;
    roomRestoreRoomId = roomId;
    if (!roomId) {
      roomRestorePromise = discoverActiveRoom(userId, restoreToken);
    } else {
      subscribeRoom();
      setRoomConnectionState('reconnecting');
      roomRestorePromise = refreshRoom().then(function (result) {
        if (result && result.unavailable && restoreToken === roomRestoreSequence) return discoverActiveRoom(userId, restoreToken);
        return result;
      });
    }
    var promise = roomRestorePromise;
    return promise.finally(function () {
      if (roomRestorePromise === promise) {
        roomRestorePromise = null;
        roomRestoreUserId = '';
        roomRestoreRoomId = '';
      }
    });
  }
  function refreshRoom() {
    if (!client || !currentRoomId || !currentUser) return Promise.resolve(null);
    var requestedRoomId = currentRoomId;
    var userId = currentUser.id;
    var requestSequence = ++roomRefreshSequence;
    return Promise.all([
      client.from('rooms').select('id,created_by,mode,capacity,status,updated_at').eq('id', requestedRoomId).maybeSingle(),
      client.from('room_members').select('user_id,seat,role,ready').eq('room_id', requestedRoomId),
      client.from('room_invites').select('invite_code').eq('room_id', requestedRoomId).limit(1).maybeSingle(),
      client.from('match_states').select('room_id,version,state,updated_at').eq('room_id', requestedRoomId).maybeSingle(),
      client.from('ludo_chess_matches').select('room_id,version,state,draw_offer,updated_at').eq('room_id', requestedRoomId).maybeSingle()
    ]).then(function (results) {
      if (results.some(function (result) { return result.error; })) throw results.filter(function (result) { return result.error; })[0].error;
      if (!results[0].data) {
        var unavailable = new Error('This room ended or your membership is no longer active.');
        unavailable.code = 'ROOM_UNAVAILABLE';
        throw unavailable;
      }
      var roster = results[1].data || [];
      if (!roster.some(function (member) { return member.user_id === userId; })) {
        var notMember = new Error('Your room membership is no longer active.');
        notMember.code = 'ROOM_UNAVAILABLE';
        throw notMember;
      }
      var ids = roster.map(function (member) { return member.user_id; });
      return client.from('profiles').select('id,display_name,handle').in('id', ids).then(function (profileResult) {
        if (profileResult.error) throw profileResult.error;
        if (requestSequence !== roomRefreshSequence || currentRoomId !== requestedRoomId || !currentUser || currentUser.id !== userId) return null;
        var profiles = {};
        (profileResult.data || []).forEach(function (profile) { profiles[profile.id] = profile; });
        var existingRoom = currentRoom && currentRoom.id === requestedRoomId ? currentRoom : null;
        var serverMatchState = results[0].data.mode === 'ludo_chess' ? (results[4].data || null) : (results[3].data || null);
        if (existingRoom && existingRoom.matchState && serverMatchState && Number(existingRoom.matchState.version) > Number(serverMatchState.version)) serverMatchState = existingRoom.matchState;
        var roomStatus = results[0].data.status;
        if (existingRoom && (existingRoom.status === 'completed' || existingRoom.status === 'cancelled') && roomStatus === 'active') roomStatus = existingRoom.status;
        currentRoom = Object.assign({}, results[0].data, {
          status: roomStatus,
          inviteCode: results[2].data ? results[2].data.invite_code : '',
          matchState: serverMatchState,
          roster: roster.map(function (member) {
            var profile = profiles[member.user_id] || {};
            return Object.assign({}, member, { displayName: profile.display_name, handle: profile.handle });
          })
        });
        var mine = roster.filter(function (member) { return member.user_id === userId; })[0];
        currentRoom.myReady = !!mine.ready;
        if (roomStatus === 'completed' || roomStatus === 'cancelled' || (serverMatchState && serverMatchState.state && serverMatchState.state.phase === 'over')) {
          setRoomConnectionState('ended');
        } else if (roomChannelStatus === 'SUBSCRIBED') {
          var wasReconnecting = roomConnectionState === 'reconnecting';
          setRoomConnectionState('connected');
          if (wasReconnecting) announce('Room reconnected. Latest server state restored.');
        }
        renderRoom();
        return refreshHistory().then(function () { return currentRoom; });
      });
    }).catch(function (error) {
      if (requestSequence !== roomRefreshSequence || currentRoomId !== requestedRoomId || !currentUser || currentUser.id !== userId) return null;
      if (error && error.code === 'ROOM_UNAVAILABLE') {
        clearRoomChannel();
        currentRoomId = '';
        currentRoom = null;
        pendingMatchAction = null;
        sessionStorage.removeItem('crossfour.online.pending-match-action');
        sessionStorage.removeItem('crossfour.online.room');
        setRoomConnectionState('idle', 'Room ended or membership ended. Find or join another table.');
        renderRoom();
        announce('The saved room is no longer available. Checking for another active match.');
        return { unavailable: true };
      }
      setRoomConnectionState('reconnecting');
      announce('Room reconnecting. Your saved room and pending action are preserved: ' + errorText(error), true);
      return null;
    });
  }
  function subscribeRoom() {
    if (!client || !currentRoomId || !currentUser) return null;
    if (roomChannel && roomChannel.roomId === currentRoomId && roomChannel.userId === currentUser.id) return roomChannel;
    clearRoomChannel();
    var roomId = currentRoomId;
    var userId = currentUser.id;
    setRoomConnectionState('connecting');
    var channel = client.channel('crossfour-room-' + roomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + roomId }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: 'room_id=eq.' + roomId }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_states', filter: 'room_id=eq.' + roomId }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ludo_chess_matches', filter: 'room_id=eq.' + roomId }, refreshRoom);
    channel.roomId = roomId;
    channel.userId = userId;
    roomChannel = channel;
    roomChannelStatus = 'joining';
    channel.subscribe(function (state) {
      if (roomChannel !== channel || currentRoomId !== roomId || !currentUser || currentUser.id !== userId) return;
      roomChannelStatus = state;
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        setRoomConnectionState('reconnecting');
        announce('Live room updates are reconnecting. Match actions are paused until the room is synchronized.', true);
      } else if (state === 'SUBSCRIBED') {
        refreshRoom();
      }
    });
    return channel;
  }
  function makeActionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') throw new Error('Secure action IDs are unavailable in this browser.');
    return Array.from(window.crypto.getRandomValues(new Uint8Array(16))).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }
  function submitMatchAction(rpc, values) {
    if (!currentRoomId || !currentRoom || !currentRoom.matchState || pendingMatchAction) return;
    if (roomConnectionState !== 'connected') return announce('Reconnect to the room before sending a match action.', true);
    try {
      pendingMatchAction = {
        room_id: currentRoomId,
        actor_id: currentUser && currentUser.id,
        rpc: rpc,
        args: Object.assign({ p_room_id: currentRoomId, p_expected_version: currentRoom.matchState.version, p_action_id: makeActionId() }, values)
      };
      sessionStorage.setItem('crossfour.online.pending-match-action', JSON.stringify(pendingMatchAction));
      renderMatch();
      runPendingMatchAction();
    } catch (error) { announce('Online action could not start: ' + errorText(error), true); }
  }
  function runPendingMatchAction() {
    var pending = pendingMatchAction;
    if (!client || !pending || pending.room_id !== currentRoomId) return;
    if (roomConnectionState !== 'connected' || !currentUser || (pending.actor_id && pending.actor_id !== currentUser.id)) return announce('Reconnect to the room before retrying this action.', true);
    announce('Sending the validated match action…');
    callRpc(pending.rpc, pending.args).then(function (result) {
      if (pendingMatchAction !== pending) return;
      pendingMatchAction = null;
      sessionStorage.removeItem('crossfour.online.pending-match-action');
      if (currentRoomId === pending.room_id && currentRoom && (!currentRoom.matchState || Number(result.version) > Number(currentRoom.matchState.version))) {
        currentRoom.matchState = { room_id: pending.room_id, version: result.version, state: result.state, draw_offer: typeof result.draw_offer === 'undefined' ? null : result.draw_offer };
        renderMatch();
      }
      announce(result.duplicate ? 'The server confirmed this was already applied.' : 'Match state updated by the server.');
      return refreshRoom();
    }).catch(function (error) {
      refreshRoom();
      var code = error && error.code;
      if (code && ['40001', '22023', '42501', '55000', 'P0002', '23505'].indexOf(code) >= 0) {
        pendingMatchAction = null;
        sessionStorage.removeItem('crossfour.online.pending-match-action');
      }
      renderMatch();
      announce('Match action was not confirmed: ' + errorText(error) + (pendingMatchAction ? ' Retry uses the same action ID.' : ' Refresh the state and try again.'), true);
    });
  }
  function subscribeWallet() {
    if (!client || !currentUser) return;
    if (walletChannel && walletChannel.userId === currentUser.id) return;
    if (walletChannel) client.removeChannel(walletChannel);
    walletChannel = client.channel('crossfour-wallet-' + currentUser.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: 'user_id=eq.' + currentUser.id }, refreshAccount)
      .subscribe(function (state) {
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') announce('Cloud balance updates are reconnecting.', true);
      });
    walletChannel.userId = currentUser.id;
  }
  function subscribeProfile() {
    if (!client || !currentUser) return;
    if (profileChannel && profileChannel.userId === currentUser.id) return;
    if (profileChannel) client.removeChannel(profileChannel);
    var userId = currentUser.id;
    profileChannel = client.channel('crossfour-profile-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, function (change) {
        if (!currentUser || currentUser.id !== userId) return;
        var row = change && (change.new || change.old) || {};
        if (row.id === userId) refreshAccount();
        if (currentRoom && currentRoom.roster.some(function (member) { return member.user_id === row.id; })) refreshRoom();
      })
      .subscribe(function (state) {
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') announce('Live profile updates are reconnecting.', true);
      });
    profileChannel.userId = userId;
  }
  function subscribeHistory() {
    if (!client || !currentUser) return;
    if (historyChannel && historyChannel.userId === currentUser.id) return;
    if (historyChannel) client.removeChannel(historyChannel);
    var userId = currentUser.id;
    historyChannel = client.channel('crossfour-history-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_history' }, refreshHistory)
      .subscribe(function (state) {
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') announce('Live match-history updates are reconnecting.', true);
      });
    historyChannel.userId = userId;
  }
  function attachRoom(result) {
    if (!result.room_id) throw new Error('The server did not return a room ID.');
    if (currentRoomId !== result.room_id) {
      roomRestoreSequence++;
      roomRestorePromise = null;
      roomRestoreUserId = '';
      roomRestoreRoomId = '';
      selectedChessSquare = -1; selectedChessMoves = []; pendingChessPromotion = null;
    }
    if (pendingMatchAction && pendingMatchAction.room_id !== result.room_id) {
      pendingMatchAction = null;
      sessionStorage.removeItem('crossfour.online.pending-match-action');
    }
    currentRoomId = result.room_id;
    currentRoom = null;
    sessionStorage.setItem('crossfour.online.room', currentRoomId);
    setRoomConnectionState('connecting');
    announce(result.status === 'waiting' ? 'Room ready. Share the code to invite another player.' : 'Joined the waiting room.');
    subscribeRoom();
    return refreshRoom();
  }
  function joinInvite(code) {
    if (!client || !currentUser || !code) return Promise.resolve();
    pendingInvite = '';
    sessionStorage.removeItem('crossfour.online.pending-invite');
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    return callRpc('join_room', { p_invite_code: code.trim().toUpperCase() })
      .then(attachRoom)
      .catch(function (error) { announce('Could not join room: ' + errorText(error), true); });
  }
  function handleNativeCallback(url) {
    if (!url) return Promise.resolve();
    var parsed;
    try { parsed = new URL(url); } catch (_) { return Promise.resolve(); }
    if (parsed.protocol !== 'com.offerpk.offlineludo:' || parsed.host !== 'auth-callback') return Promise.resolve();
    var code = parsed.searchParams.get('code');
    var isRecovery = parsed.searchParams.get('type') === 'recovery';
    var authError = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
    if (authError) {
      announce('This email confirmation or password-reset link was rejected or expired.', true);
      return Promise.resolve();
    }
    if (!code) return Promise.resolve();
    return ensureClient().then(function () { return client.auth.exchangeCodeForSession(code); }).then(function (result) {
      if (result.error) throw result.error;
      if (isRecovery) {
        recoveryMode = true;
        renderAccount();
        announce('Choose a new password to finish account recovery.');
      }
    }).catch(function (error) {
      announce('Could not finish email authentication: ' + errorText(error), true);
    });
  }
  function updateRoomModeOptions() {
    var chessMode = $('online-mode').value === 'ludo_chess';
    var capacity = $('online-capacity');
    if (chessMode) {
      if (capacity.value !== '2') capacityBeforeChess = capacity.value;
      capacity.value = '2';
      capacity.disabled = true;
      $('online-mode-note').textContent = 'Ludo Chess uses standard chess rules and exactly two players. Classic Ludo keeps its existing 2–4 player rooms.';
    } else {
      capacity.disabled = false;
      if (capacityBeforeChess && Array.prototype.some.call(capacity.options, function (option) { return option.value === capacityBeforeChess; })) capacity.value = capacityBeforeChess;
      $('online-mode-note').textContent = 'Classic Ludo plays on the same board as offline. House rules lock when the room is created. Mystery and Lucky Chaos remain offline modes.';
    }
  }
  function bindEvents() {
    $('btn-online').addEventListener('click', openOnline);
    $('online-back').addEventListener('click', closeOnline);
    $('online-auth-form').addEventListener('submit', function (event) {
      event.preventDefault();
      signInWithPassword();
    });
    $('online-signup').addEventListener('click', signUpWithPassword);
    $('online-reset-request').addEventListener('click', requestPasswordReset);
    $('online-recovery-form').addEventListener('submit', updateRecoveredPassword);
    $('online-mode').addEventListener('change', updateRoomModeOptions);
    $('online-capacity').addEventListener('change', function () { if ($('online-mode').value !== 'ludo_chess') capacityBeforeChess = $('online-capacity').value; });
    updateRoomModeOptions();
    $('online-signout').addEventListener('click', function () {
      if (!client) return;
      client.auth.signOut().then(function (result) {
        if (result.error) throw result.error;
        clearAccountChannels();
        clearRoomSelection(true);
      }).catch(function (error) { announce('Sign-out failed: ' + errorText(error), true); });
    });
    $('online-profile-form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (!client || !currentUser) return;
      var displayName = $('online-profile-name').value.trim();
      if (!displayName || displayName.length > 32) return announce('Choose a display name from 1 to 32 characters.', true);
      client.from('profiles').update({ display_name: displayName }).eq('id', currentUser.id)
        .then(function (result) {
          if (result.error) throw result.error;
          announce('Display name saved to your online profile.');
          return refreshAccount().then(function () { return refreshRoom(); });
        }).catch(function (error) { announce('Profile update failed: ' + errorText(error), true); });
    });
    function classicRulesPayload() {
      var rules = window.__cf && window.__cf.save && window.__cf.save.rules;
      if (!rules) return { rollStyle: 'star', safeSquares: true, captureToEnter: false, blocks: false, bonusOnCapture: true, bonusOnHome: true, arrows: false, noCapture: false };
      return {
        rollStyle: rules.rollStyle === 'classic' ? 'classic' : 'star',
        safeSquares: !!rules.safeSquares, captureToEnter: !!rules.captureToEnter, blocks: !!rules.blocks,
        bonusOnCapture: !!rules.bonusOnCapture, bonusOnHome: !!rules.bonusOnHome, arrows: !!rules.arrows, noCapture: !!rules.noCapture
      };
    }
    function roomRpcArgs() {
      var args = { p_mode: $('online-mode').value, p_capacity: Number($('online-capacity').value) };
      if (args.p_mode === 'classic') args.p_rules = classicRulesPayload();
      return args;
    }
    function missingRulesRpc(error) {
      var text = errorText(error);
      return /create_room|quick_match|schema cache|Could not find the function|PGRST202/i.test(text);
    }
    $('online-create-room').addEventListener('click', function () {
      if (!client) return;
      var args = roomRpcArgs();
      callRpc('create_room', args).then(attachRoom).catch(function (error) {
        if (args.p_rules && missingRulesRpc(error)) {
          announce('This server has not applied the v1.4.0 rules migration, so house rules cannot be locked yet. Creating the room with the previous server rules.', true);
          return callRpc('create_room', { p_mode: args.p_mode, p_capacity: args.p_capacity }).then(attachRoom);
        }
        announce('Room could not be created: ' + errorText(error), true);
      });
    });
    $('online-quick-match').addEventListener('click', function () {
      if (!client) return;
      var args = roomRpcArgs();
      callRpc('quick_match', args).then(attachRoom).catch(function (error) {
        if (args.p_rules && missingRulesRpc(error)) {
          announce('This server has not applied the v1.4.0 rules migration, so quick match cannot lock house rules yet. Searching with the previous server rules.', true);
          return callRpc('quick_match', { p_mode: args.p_mode, p_capacity: args.p_capacity }).then(attachRoom);
        }
        announce('Matchmaking failed: ' + errorText(error), true);
      });
    });
    $('online-join-room').addEventListener('click', function () { joinInvite($('online-join-code').value); });
    $('online-join-code').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); joinInvite($('online-join-code').value); }
    });
    $('online-copy-invite').addEventListener('click', function () {
      if (!currentRoom || !currentRoom.inviteCode) return;
      var url = new URL(isNative() ? 'https://offerpk.github.io/offline-ludo/' : window.location.href);
      url.search = '?room=' + encodeURIComponent(currentRoom.inviteCode);
      url.hash = '';
      var text = url.toString();
      var copy = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error('Clipboard access is unavailable.'));
      copy.then(function () { announce('Invite link copied. Share it with a friend.'); })
        .catch(function () { $('online-invite-code').focus(); $('online-invite-code').select(); announce('Copy is unavailable; select the invite code and share it manually.'); });
    });
    $('online-ready').addEventListener('click', function () {
      if (!currentRoomId || !currentRoom) return;
      callRpc('set_room_ready', { p_room_id: currentRoomId, p_ready: !currentRoom.myReady })
        .then(refreshRoom)
        .catch(function (error) { announce('Ready status could not be changed: ' + errorText(error), true); });
    });
    $('online-start-room').addEventListener('click', function () {
      if (!currentRoomId) return;
      callRpc('start_room', { p_room_id: currentRoomId })
        .then(function () {
          announce(currentRoom && currentRoom.mode === 'ludo_chess' ? 'Ludo Chess table started. The server owns legal-move validation and match state.' : 'Online Classic table started. The server owns dice, turn validation and match state.');
          return refreshRoom();
        })
        .catch(function (error) { announce('Table could not be started: ' + errorText(error), true); });
    });
    $('online-roll').addEventListener('click', function () { submitMatchAction('roll_match', {}); });
    $('online-match-retry').addEventListener('click', runPendingMatchAction);
    if ($('online-board-retry')) $('online-board-retry').addEventListener('click', runPendingMatchAction);
    $('online-chess-promotion').querySelectorAll('[data-promotion]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!pendingChessPromotion || pendingMatchAction) return;
        var move = pendingChessPromotion; pendingChessPromotion = null;
        selectedChessSquare = -1; selectedChessMoves = [];
        submitMatchAction('ludo_chess_move', { p_from: move.from, p_to: move.to, p_promotion: button.dataset.promotion });
      });
    });
    $('online-chess-claim-draw').addEventListener('click', function () { submitMatchAction('claim_ludo_chess_draw', {}); });
    $('online-chess-offer-draw').addEventListener('click', function () { submitMatchAction('offer_ludo_chess_draw', {}); });
    $('online-chess-accept-draw').addEventListener('click', function () { submitMatchAction('respond_ludo_chess_draw', { p_response: 'accept' }); });
    $('online-chess-decline-draw').addEventListener('click', function () { submitMatchAction('respond_ludo_chess_draw', { p_response: 'decline' }); });
    $('online-chess-withdraw-draw').addEventListener('click', function () { submitMatchAction('respond_ludo_chess_draw', { p_response: 'withdraw' }); });
    $('online-chess-resign').addEventListener('click', function () { submitMatchAction('resign_ludo_chess', {}); });
    $('online-chess-copy-pgn').addEventListener('click', copyChessPgn);
    $('online-chess-back').addEventListener('click', function () {
      chessPlayViewDismissed = true;
      renderMatch();
      $('online-chess-resume').focus({ preventScroll: true });
    });
    $('online-chess-resume').addEventListener('click', function () {
      chessPlayViewDismissed = false;
      renderMatch();
      $('online-chess-screen-title').focus({ preventScroll: true });
    });
    $('online-leave-room').addEventListener('click', function () {
      if (!currentRoomId) return;
      callRpc('leave_room', { p_room_id: currentRoomId })
        .then(function () {
          clearRoomSelection(true);
          announce('You left the room.');
          return refreshHistory();
        })
        .catch(function (error) { announce('Could not leave room: ' + errorText(error), true); });
    });
    function refreshAfterReconnect() {
      if (!currentUser || !client || screen.classList.contains('hidden')) return;
      if (!currentRoomId) { restoreActiveRoom(); return; }
      if (roomChannel && ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].indexOf(roomChannelStatus) >= 0) clearRoomChannel();
      subscribeRoom();
      var rejoin = currentRoom && currentRoom.mode === 'classic' && currentRoom.status === 'active'
        ? callRpc('rejoin_match', { p_room_id: currentRoomId }).catch(function (error) {
          if (!/rejoin_match|schema cache|Could not find the function|PGRST202/i.test(errorText(error))) announce('Rejoin failed: ' + errorText(error), true);
          return null;
        })
        : Promise.resolve(null);
      rejoin.then(function () { return refreshRoom(); });
    }
    window.addEventListener('online', refreshAfterReconnect);
    window.addEventListener('offline', function () {
      if (currentRoomId && currentUser) {
        setRoomConnectionState('reconnecting');
        announce('Connection lost. You have a short reconnect window to rejoin the same seat. No computer takes your place.', true);
        if (currentRoom && currentRoom.mode === 'classic' && currentRoom.status === 'active') {
          callRpc('note_disconnect', { p_room_id: currentRoomId }).catch(function () {});
        }
      }
    });
    window.addEventListener('focus', refreshAfterReconnect);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshAfterReconnect();
    });
  }
  function configureNativeCallback() {
    if (!isNative() || nativeCallbackConfigured) return;
    var app = plugin('App');
    if (app && typeof app.addListener === 'function') {
      nativeCallbackConfigured = true;
      app.addListener('appUrlOpen', function (event) { handleNativeCallback(event && event.url); });
      if (typeof app.getLaunchUrl === 'function') {
        app.getLaunchUrl().then(function (event) { if (event && event.url) handleNativeCallback(event.url); })
          .catch(function (error) { announce('Could not read the sign-in return link: ' + errorText(error), true); });
      }
    }
  }
  function startUserSession() {
    if (!currentUser || recoveryMode) return;
    var userId = currentUser.id;
    refreshAccount();
    subscribeWallet();
    subscribeProfile();
    subscribeHistory();
    if (pendingInvite && !handlingPendingInvite) {
      handlingPendingInvite = true;
      joinInvite(pendingInvite).finally(function () { handlingPendingInvite = false; });
    } else {
      restoreActiveRoom();
    }
    return userId;
  }
  function applyAuthSession(event, session) {
    var nextUser = session && session.user ? session.user : null;
    var oldUserId = currentUser && currentUser.id;
    var nextUserId = nextUser && nextUser.id;
    var identityChanged = oldUserId !== nextUserId;
    if (event === 'PASSWORD_RECOVERY') recoveryMode = true;
    else if (event === 'SIGNED_OUT') recoveryMode = false;
    if (oldUserId && oldUserId !== nextUserId) {
      clearAccountChannels();
      clearRoomSelection(true);
    }
    if (!nextUser) {
      recoveryMode = false;
      clearAccountChannels();
      clearRoomSelection(true);
    }
    currentUser = nextUser;
    renderAccount();
    if (currentUser && !recoveryMode && (identityChanged || event === 'GET_SESSION' || event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      var userId = currentUser.id;
      window.setTimeout(function () {
        if (currentUser && currentUser.id === userId && !recoveryMode) startUserSession();
      }, 0);
    }
  }
  function initializeClient() {
    if (client) return Promise.resolve(client);
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return Promise.reject(new Error('The Supabase sign-in client did not load.'));
    }
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: !isNative() }
    });
    renderAccount();
    client.auth.onAuthStateChange(applyAuthSession);
    client.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      applyAuthSession('GET_SESSION', result.data.session);
    }).catch(function (error) { announce('Could not check your online session: ' + errorText(error), true); });
    return Promise.resolve(client);
  }
  function ensureClient() {
    if (client) return Promise.resolve(client);
    if (!isConfigured()) return Promise.reject(new Error('No Supabase project is configured.'));
    if (sdkLoading) return sdkLoading;
    sdkLoading = new Promise(function (resolve, reject) {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        initializeClient().then(resolve, reject);
        return;
      }
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js';
      script.integrity = 'sha384-WgXwGL6fUsYJWNaKJgVbrJKGRQwc1vieh2oy4kw9nXqpNDz3tdSsqEYUgeHD/NuF';
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = function () { initializeClient().then(resolve, reject); };
      script.onerror = function () { script.remove(); reject(new Error('The online sign-in client could not be downloaded.')); };
      document.head.appendChild(script);
    }).catch(function (error) {
      sdkLoading = null;
      throw error;
    });
    return sdkLoading;
  }
  function initialize() {
    bindEvents();
    renderAccount();
    configureNativeCallback();
    if (!isConfigured()) {
      $('online-config-note').textContent = 'Online rooms and cloud balances are inactive until the approved Supabase project is configured.';
    } else {
      announce('Online Ludo backend is configured. Open Online rooms to sign in with email and password.');
    }
  }

  if (!home || !screen || !statusLine) return;
  initialize();
  window.__crossfourOnline = {
    isConfigured: isConfigured,
    open: openOnline,
    close: closeOnline
  };
})();
