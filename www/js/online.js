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
  var recoveryMode = false;
  var roomChannel = null;
  var walletChannel = null;
  var profileChannel = null;
  var historyChannel = null;
  var client = null;
  var sdkLoading = null;
  var nativeCallbackConfigured = false;
  var pendingInvite = new URLSearchParams(window.location.search).get('room') || sessionStorage.getItem('crossfour.online.pending-invite') || '';
  var handlingPendingInvite = false;
  if (pendingInvite) sessionStorage.setItem('crossfour.online.pending-invite', pendingInvite);

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
    } else if (currentUser) refreshAccount();
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
      $('online-config-note').textContent = 'Sign in with email and password or create an account. Email confirmation may be required.';
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
    client.auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: { emailRedirectTo: authRedirectUrl() }
    }).then(function (result) {
      if (result.error) throw result.error;
      var session = result.data && result.data.session;
      if (session && session.user) {
        currentUser = session.user;
        renderAccount();
        announce('Account created and signed in.');
        return refreshAccount();
      }
      announce('Account created. Check your email for a confirmation link before signing in. If no message arrives, email delivery may need configuration.');
    }).catch(function (error) { announce('Account creation failed: ' + errorText(error), true); });
  }
  function requestPasswordReset() {
    if (!client || !emailPasswordEnabled()) return announce('Password reset is unavailable.', true);
    var emailField = $('online-email');
    if (!emailField.checkValidity()) { emailField.reportValidity(); return; }
    announce('Requesting a password reset…');
    client.auth.resetPasswordForEmail(emailField.value.trim(), { redirectTo: authRedirectUrl() }).then(function (result) {
      if (result.error) throw result.error;
      announce('If an account exists for that address, a reset link will be sent. If no message arrives, email delivery may need configuration.');
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
    return Promise.all([
      client.from('profiles').select('handle,display_name').eq('id', currentUser.id).maybeSingle(),
      client.from('wallets').select('coins,diamonds').eq('user_id', currentUser.id).maybeSingle()
    ]).then(function (results) {
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
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
    return client.from('match_history')
      .select('id,mode,status,winner_id,started_at,finished_at')
      .order('started_at', { ascending: false })
      .limit(10)
      .then(function (result) {
        if (result.error) throw result.error;
        var list = $('online-history-list');
        list.replaceChildren();
        (result.data || []).forEach(function (match) {
          var item = document.createElement('li');
          var title = document.createElement('b');
          title.textContent = match.mode.charAt(0).toUpperCase() + match.mode.slice(1) + ' · ' + match.status;
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
    $('online-room-mode').textContent = room.mode.charAt(0).toUpperCase() + room.mode.slice(1) + ' · ' + room.capacity + ' seats';
    $('online-room-status').textContent = room.status === 'active'
      ? 'Table started. The online Ludo board and turn sync are not enabled in this build.'
      : room.status === 'cancelled' ? 'This table was cancelled.' : 'Waiting for players to join and ready up.';
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
  }
  function refreshRoom() {
    if (!client || !currentRoomId || !currentUser) return Promise.resolve();
    return Promise.all([
      client.from('rooms').select('id,created_by,mode,capacity,status,updated_at').eq('id', currentRoomId).maybeSingle(),
      client.from('room_members').select('user_id,seat,role,ready').eq('room_id', currentRoomId),
      client.from('room_invites').select('invite_code').eq('room_id', currentRoomId).limit(1).maybeSingle()
    ]).then(function (results) {
      if (results[0].error) throw results[0].error;
      if (!results[0].data) throw new Error('You no longer have access to this room.');
      if (results[1].error) throw results[1].error;
      if (results[2].error) throw results[2].error;
      var roster = results[1].data || [];
      var ids = roster.map(function (member) { return member.user_id; });
      return client.from('profiles').select('id,display_name,handle').in('id', ids).then(function (profileResult) {
        if (profileResult.error) throw profileResult.error;
        var profiles = {};
        (profileResult.data || []).forEach(function (profile) { profiles[profile.id] = profile; });
        currentRoom = Object.assign({}, results[0].data, {
          inviteCode: results[2].data ? results[2].data.invite_code : '',
          roster: roster.map(function (member) {
            var profile = profiles[member.user_id] || {};
            return Object.assign({}, member, { displayName: profile.display_name, handle: profile.handle });
          })
        });
        var mine = roster.filter(function (member) { return member.user_id === currentUser.id; })[0];
        currentRoom.myReady = !!(mine && mine.ready);
        renderRoom();
        return refreshHistory();
      });
    }).catch(function (error) {
      currentRoom = null;
      currentRoomId = '';
      sessionStorage.removeItem('crossfour.online.room');
      renderRoom();
      announce('Room could not be loaded: ' + errorText(error), true);
    });
  }
  function subscribeRoom() {
    if (!client || !currentRoomId) return;
    if (roomChannel) client.removeChannel(roomChannel);
    roomChannel = client.channel('crossfour-room-' + currentRoomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + currentRoomId }, refreshRoom)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: 'room_id=eq.' + currentRoomId }, refreshRoom)
      .subscribe(function (state) {
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') announce('Live room updates are reconnecting.', true);
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
    currentRoomId = result.room_id;
    currentRoom = null;
    sessionStorage.setItem('crossfour.online.room', currentRoomId);
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
    $('online-signout').addEventListener('click', function () {
      if (!client) return;
      client.auth.signOut().then(function (result) {
        if (result.error) throw result.error;
        if (roomChannel) client.removeChannel(roomChannel);
        if (walletChannel) client.removeChannel(walletChannel);
        if (profileChannel) client.removeChannel(profileChannel);
        if (historyChannel) client.removeChannel(historyChannel);
        roomChannel = null;
        walletChannel = null;
        profileChannel = null;
        historyChannel = null;
        currentRoomId = '';
        currentRoom = null;
        sessionStorage.removeItem('crossfour.online.room');
        renderRoom();
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
          announce('Table started. This repository currently syncs the lobby only; online Ludo turns and board state are not enabled.');
          return refreshRoom();
        })
        .catch(function (error) { announce('Table could not be started: ' + errorText(error), true); });
    });
    $('online-leave-room').addEventListener('click', function () {
      if (!currentRoomId) return;
      callRpc('leave_room', { p_room_id: currentRoomId })
        .then(function () {
          if (roomChannel) client.removeChannel(roomChannel);
          roomChannel = null;
          currentRoomId = '';
          currentRoom = null;
          sessionStorage.removeItem('crossfour.online.room');
          renderRoom();
          announce('You left the room.');
          return refreshHistory();
        })
        .catch(function (error) { announce('Could not leave room: ' + errorText(error), true); });
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
  function initializeClient() {
    if (client) return Promise.resolve(client);
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return Promise.reject(new Error('The Supabase sign-in client did not load.'));
    }
    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: !isNative() }
    });
    renderAccount();
    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') recoveryMode = true;
      else if (event === 'SIGNED_OUT') recoveryMode = false;
      currentUser = session && session.user ? session.user : null;
      if (!currentUser) {
        recoveryMode = false;
        if (roomChannel) client.removeChannel(roomChannel);
        if (walletChannel) client.removeChannel(walletChannel);
        if (profileChannel) client.removeChannel(profileChannel);
        if (historyChannel) client.removeChannel(historyChannel);
        roomChannel = null;
        walletChannel = null;
        profileChannel = null;
        historyChannel = null;
        currentRoomId = '';
        sessionStorage.removeItem('crossfour.online.room');
        currentRoom = null;
        renderRoom();
      }
      renderAccount();
      if (currentUser && !recoveryMode) {
        window.setTimeout(function () {
          refreshAccount();
          subscribeWallet();
          subscribeProfile();
          subscribeHistory();
          if (currentRoomId) { subscribeRoom(); refreshRoom(); }
          if (pendingInvite && !handlingPendingInvite) {
            handlingPendingInvite = true;
            joinInvite(pendingInvite).finally(function () { handlingPendingInvite = false; });
          }
        }, 0);
      }
    });
    client.auth.getSession().then(function (result) {
      if (result.error) throw result.error;
      currentUser = result.data.session && result.data.session.user ? result.data.session.user : null;
      renderAccount();
      if (currentUser && !recoveryMode) {
        refreshAccount();
        subscribeWallet();
        subscribeProfile();
        subscribeHistory();
        if (currentRoomId) { subscribeRoom(); refreshRoom(); }
        if (pendingInvite) joinInvite(pendingInvite);
      }
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
