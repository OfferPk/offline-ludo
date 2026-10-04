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
  var pendingChessDrawClaim = null;
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
    pendingChessDrawClaim = null;
    if (clearStoredState) {
      sessionStorage.removeItem('crossfour.online.pending-match-action');
      sessionStorage.removeItem('crossfour.online.room');
    }
    setRoomConnectionState('idle', '');
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
    if (!room) return;
    if (room.status === 'completed' || room.status === 'cancelled' || (room.matchState && room.matchState.state && room.matchState.state.phase === 'over')) setRoomConnectionState('ended');
    $('online-room-mode').textContent = modeLabel(room.mode) + ' · ' + room.capacity + ' seats';
    $('online-room-status').textContent = room.status === 'active'
      ? (room.matchState ? (room.mode === 'ludo_chess' ? 'Ludo Chess is active. Legal moves and match state are validated by the server.' : 'Online Classic match is active. Dice and moves are validated by the server.') : 'This table predates the current online gameplay update. Create a new table to play online.')
      : room.status === 'completed' ? 'This table is complete.' : room.status === 'cancelled' ? 'This table was cancelled.' : 'Waiting for players to join and ready up.';
    $('online-invite-code').value = room.inviteCode || '';
    $('online-start-room').classList.toggle('hidden', room.status !== 'waiting' || room.created_by !== (currentUser && currentUser.id));
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
    renderMatch();
  }
  function chessSeatName(room, seat) {
    var member = room.roster.find(function (candidate) { return Number(candidate.seat) === Number(seat); });
    return (Number(seat) === 0 ? 'Red' : 'Blue') + ' · ' + ((member && (member.displayName || member.handle)) || 'Player');
  }
  function chessResultLabel(state, room) {
    var labels = {
      checkmate: 'Checkmate', stalemate: 'Stalemate · draw', draw_seventy_five_moves: 'Draw · 75-move rule',
      draw_fivefold_repetition: 'Draw · fivefold repetition', draw_insufficient_material: 'Draw · insufficient material',
      draw_fifty_move_claim: 'Draw · 50-move claim', draw_threefold_claim: 'Draw · threefold repetition claim', resignation: 'Resignation'
    };
    var text = labels[state.result] || 'Game complete';
    return state.winner === 0 || state.winner === 1 ? text + ' · ' + chessSeatName(room, state.winner) + ' wins' : text;
  }
  function stageDrawClaimByMove(move, state, isMyTurn) {
    if (!window.LudoChess || window.LudoChess.canClaimDraw(state) || !currentRoom || !currentRoom.matchState) return false;
    var result = window.LudoChess.claimableDrawByMove(state, move);
    if (!result) return false;
    pendingChessDrawClaim = {
      roomId: currentRoomId,
      version: Number(currentRoom.matchState.version),
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      result: result
    };
    renderChessBoard(state, currentRoom, isMyTurn);
    announce('This move would allow a ' + (result === 'draw_fifty_move_claim' ? '50-move' : 'threefold-repetition') + ' draw claim. Claim the draw or play the move instead.');
    return true;
  }
  function chooseChessSquare(index, state, isMyTurn) {
    if (!isMyTurn || state.phase !== 'active' || pendingMatchAction || pendingChessPromotion || roomConnectionState !== 'connected' || !window.LudoChess) return;
    pendingChessDrawClaim = null;
    var matching = selectedChessMoves.find(function (move) { return move.to === index; });
    if (selectedChessSquare >= 0 && matching) {
      if (matching.promotion) {
        pendingChessPromotion = { from: selectedChessSquare, to: index };
        renderChessBoard(state, currentRoom, isMyTurn);
      } else {
        if (stageDrawClaimByMove({ from: selectedChessSquare, to: index, promotion: matching.promotion || null }, state, isMyTurn)) return;
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
  function renderChessBoard(state, room, isMyTurn) {
    var chess = window.LudoChess;
    if (!chess || !state || typeof state.board !== 'string' || state.board.length !== 64) return;
    if (pendingChessDrawClaim && (!room || pendingChessDrawClaim.roomId !== room.id || !room.matchState || pendingChessDrawClaim.version !== Number(room.matchState.version))) pendingChessDrawClaim = null;
    var board = $('online-chess-board');
    var chars = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' };
    if (!isMyTurn || state.phase !== 'active' || pendingMatchAction) {
      selectedChessSquare = -1; selectedChessMoves = []; pendingChessPromotion = null;
    }
    $('online-chess-red').classList.toggle('is-turn', state.phase === 'active' && Number(state.turn) === 0);
    $('online-chess-blue').classList.toggle('is-turn', state.phase === 'active' && Number(state.turn) === 1);
    var redName = chessSeatName(room, 0), blueName = chessSeatName(room, 1);
    $('online-chess-red').querySelector('b').textContent = redName;
    $('online-chess-blue').querySelector('b').textContent = blueName;
    $('online-chess-status').textContent = state.phase === 'over'
      ? chessResultLabel(state, room)
      : chessSeatName(room, state.turn) + (isMyTurn ? ' · your move' : ' · waiting for their move') + (state.check ? ' · Check!' : '') + (pendingChessDrawClaim ? ' · choose whether to claim or play the intended move' : '');
    $('online-chess-result').textContent = state.phase === 'over'
      ? chessResultLabel(state, room) + '. Match saved to online history.'
      : pendingChessDrawClaim
        ? 'This intended move reaches a claimable draw. Claiming ends the game before the move; choose Play intended move to continue instead.'
        : 'Standard chess rules · Red pieces move first · Select a piece, then a highlighted square.';
    var claimButton = $('online-chess-claim-draw');
    claimButton.textContent = pendingChessDrawClaim ? 'Claim draw by intended move' : 'Claim draw';
    claimButton.classList.toggle('hidden', state.phase !== 'active' || !isMyTurn || pendingMatchAction || (!pendingChessDrawClaim && !chess.canClaimDraw(state)));
    $('online-chess-play-claimable-move').classList.toggle('hidden', state.phase !== 'active' || !isMyTurn || pendingMatchAction || !pendingChessDrawClaim);
    $('online-chess-resign').classList.toggle('hidden', state.phase !== 'active' || !isMyTurn || !!pendingMatchAction);
    $('online-chess-promotion').classList.toggle('hidden', !pendingChessPromotion || !!pendingMatchAction);
    board.replaceChildren();
    for (var index = 0; index < 64; index++) {
      var row = Math.floor(index / 8), col = index % 8, piece = state.board[index];
      var cell = document.createElement('button');
      cell.type = 'button'; cell.role = 'gridcell'; cell.dataset.square = String(index);
      cell.className = 'online-chess-square ' + ((row + col) % 2 ? 'dark' : 'light');
      if (selectedChessSquare === index) cell.classList.add('is-selected');
      var legal = selectedChessMoves.find(function (move) { return move.to === index; });
      if (legal) { cell.classList.add('is-legal'); if (state.board[index] !== '.' || legal.enPassant) cell.classList.add('is-capture'); }
      if (state.last_move && (state.last_move.from === index || state.last_move.to === index)) cell.classList.add(state.last_move.from === index ? 'last-from' : 'last-to');
      var label = piece === '.' ? 'empty' : (window.LudoChess.colorOf(piece) === 0 ? 'Red ' : 'Blue ') + chess.pieceName(piece);
      cell.setAttribute('aria-label', label + ' on ' + chess.coord(index) + ((selectedChessSquare === index) ? ', selected' : '') + (legal ? ', legal destination' : ''));
      if ((row === 7 || col === 0) && piece === '.') {
        var coord = document.createElement('span'); coord.className = 'square-coord'; coord.textContent = (col === 0 ? String(8 - row) : '') + (row === 7 ? String.fromCharCode(97 + col) : ''); cell.appendChild(coord);
      }
      if (piece !== '.') {
        var glyph = document.createElement('span'); glyph.className = 'online-chess-piece ' + (window.LudoChess.colorOf(piece) === 0 ? 'red-piece' : 'blue-piece');
        glyph.textContent = chars[piece]; glyph.setAttribute('aria-hidden', 'true'); cell.appendChild(glyph);
      }
      cell.disabled = !isMyTurn || state.phase !== 'active' || !!pendingMatchAction;
      cell.addEventListener('click', function (squareIndex) { return function () { chooseChessSquare(squareIndex, state, isMyTurn); }; }(index));
      board.appendChild(cell);
    }
  }
  function renderMatch() {
    var room = currentRoom;
    var panel = $('online-match-panel');
    var record = room && room.matchState;
    var show = !!(room && (room.status === 'active' || room.status === 'completed') && record && record.state);
    panel.classList.toggle('hidden', !show);
    if (!show) { $('online-chess-play').classList.add('hidden'); return; }
    var state = record.state;
    var isChess = room.mode === 'ludo_chess';
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
    ['online-match-dice', 'online-match-pieces', 'online-match-moves', 'online-classic-note'].forEach(function (id) { $(id).classList.toggle('hidden', isChess); });
    $('online-roll').classList.toggle('hidden', isChess || !(isMyTurn && state.phase === 'roll' && !pendingMatchAction));
    $('online-roll').disabled = !isSynchronized;
    $('online-match-retry').classList.toggle('hidden', !pendingMatchAction || pendingMatchAction.room_id !== currentRoomId);
    $('online-match-retry').disabled = !isSynchronized;
    $('online-chess-claim-draw').disabled = !isSynchronized;
    $('online-chess-play-claimable-move').disabled = !isSynchronized;
    $('online-chess-resign').disabled = !isSynchronized;
    $('online-chess-promotion').querySelectorAll('[data-promotion]').forEach(function (button) { button.disabled = !isSynchronized; });
    if (isChess) {
      renderChessBoard(state, room, isMyTurn);
      return;
    }
    var lastRoll = state.last_roll;
    var queue = Array.isArray(state.queue) ? state.queue : [];
    $('online-match-dice').textContent = (lastRoll ? 'Last server die: seat ' + (Number(lastRoll.seat) + 1) + ' rolled ' + lastRoll.face + '. ' : '') +
      (queue.length ? 'Dice to use: ' + queue.join(' · ') : 'No pending dice.');
    var pieces = $('online-match-pieces');
    pieces.replaceChildren();
    (state.players || []).forEach(function (seat) {
      var member = room.roster.find(function (candidate) { return Number(candidate.seat) === Number(seat); });
      var values = (state.pieces && state.pieces[seat]) || [];
      var item = document.createElement('li');
      var name = document.createElement('b');
      name.textContent = 'Seat ' + (Number(seat) + 1) + ' · ' + ((member && (member.displayName || member.handle)) || 'Player');
      var positions = document.createElement('small');
      positions.textContent = values.map(function (position, index) { return 'T' + (index + 1) + ' ' + (position < 0 ? 'base' : position === 57 ? 'home' : position >= 52 ? 'home lane ' + (position - 51) : 'track ' + position); }).join(' · ');
      item.append(name, positions); pieces.appendChild(item);
    });
    var moves = $('online-match-moves');
    moves.replaceChildren();
    if (isMyTurn && state.phase === 'move' && !pendingMatchAction && window.LudoLogic && typeof window.LudoLogic.queueMoves === 'function') {
      var localView = { mode: 'classic', players: state.players, pieces: state.pieces, rules: state.rules, turn: Number(state.turn), phase: 'move', queue: queue, ranking: state.ranking || [], effects: [], capd: [false, false, false, false], lk: null };
      window.LudoLogic.queueMoves(localView).forEach(function (move) {
        var action = document.createElement('button'); action.type = 'button'; action.className = 'btn plate'; action.textContent = 'Use ' + move.v + ' to move token ' + (move.piece + 1);
        action.disabled = roomConnectionState !== 'connected';
        action.addEventListener('click', function () { submitMatchAction('move_match', { p_piece: move.piece, p_queue_index: queue.indexOf(move.v) }); });
        moves.appendChild(action);
      });
      if (!moves.childElementCount) moves.textContent = 'No legal moves are available; the server will pass the turn.';
    }
    if (pendingMatchAction && pendingMatchAction.room_id === currentRoomId) moves.textContent = 'A match action is awaiting confirmation. Retry the same request safely if your connection dropped.';
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
      client.from('ludo_chess_matches').select('room_id,version,state,updated_at').eq('room_id', requestedRoomId).maybeSingle()
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
        currentRoom.matchState = { room_id: pending.room_id, version: result.version, state: result.state };
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
      pendingChessDrawClaim = null;
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
      $('online-mode-note').textContent = 'Classic Ludo and Ludo Chess are playable online. Mystery and Lucky Chaos remain offline modes.';
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
    $('online-create-room').addEventListener('click', function () {
      if (!client) return;
      callRpc('create_room', { p_mode: $('online-mode').value, p_capacity: Number($('online-capacity').value) })
        .then(attachRoom)
        .catch(function (error) { announce('Room could not be created: ' + errorText(error), true); });
    });
    $('online-quick-match').addEventListener('click', function () {
      if (!client) return;
      callRpc('quick_match', { p_mode: $('online-mode').value, p_capacity: Number($('online-capacity').value) })
        .then(attachRoom)
        .catch(function (error) { announce('Matchmaking failed: ' + errorText(error), true); });
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
      $('online-chess-promotion').querySelectorAll('[data-promotion]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (!pendingChessPromotion || pendingMatchAction) return;
          var move = pendingChessPromotion; pendingChessPromotion = null;
          if (stageDrawClaimByMove({ from: move.from, to: move.to, promotion: button.dataset.promotion }, currentRoom && currentRoom.matchState && currentRoom.matchState.state, true)) return;
          selectedChessSquare = -1; selectedChessMoves = [];
          submitMatchAction('ludo_chess_move', { p_from: move.from, p_to: move.to, p_promotion: button.dataset.promotion });
        });
      });
    $('online-chess-claim-draw').addEventListener('click', function () {
      var claim = pendingChessDrawClaim;
      if (!claim) return submitMatchAction('claim_ludo_chess_draw', {});
      if (!currentRoom || !currentRoom.matchState || claim.roomId !== currentRoomId || claim.version !== Number(currentRoom.matchState.version)) {
        pendingChessDrawClaim = null;
        renderMatch();
        return announce('The position changed before the draw claim. Review the latest board and try again.', true);
      }
      pendingChessDrawClaim = null;
      selectedChessSquare = -1; selectedChessMoves = [];
      submitMatchAction('claim_ludo_chess_draw_by_move', { p_from: claim.from, p_to: claim.to, p_promotion: claim.promotion });
    });
    $('online-chess-play-claimable-move').addEventListener('click', function () {
      var move = pendingChessDrawClaim;
      if (!move || !currentRoom || !currentRoom.matchState || move.roomId !== currentRoomId || move.version !== Number(currentRoom.matchState.version)) {
        pendingChessDrawClaim = null;
        renderMatch();
        return announce('The position changed before the move. Review the latest board and try again.', true);
      }
      pendingChessDrawClaim = null;
      selectedChessSquare = -1; selectedChessMoves = [];
      submitMatchAction('ludo_chess_move', { p_from: move.from, p_to: move.to, p_promotion: move.promotion });
    });
    $('online-chess-resign').addEventListener('click', function () { submitMatchAction('resign_ludo_chess', {}); });
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
      refreshRoom();
    }
    window.addEventListener('online', refreshAfterReconnect);
    window.addEventListener('offline', function () {
      if (currentRoomId && currentUser) {
        setRoomConnectionState('reconnecting');
        announce('Connection lost. The room will resynchronize before match actions resume.', true);
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
