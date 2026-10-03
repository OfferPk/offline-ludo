/* Optional Supabase account and room-lobby client. Offline game/save code is deliberately separate. */
(function () {
  'use strict';

  var config = window.CROSSFOUR_SUPABASE_CONFIG || {};
  var home = document.getElementById('home');
  var screen = document.getElementById('online');
  var statusLine = document.getElementById('online-status');
  var authPanel = document.getElementById('online-auth-panel');
  var accountPanel = document.getElementById('online-account-panel');
  var roomPanel = document.getElementById('online-room-panel');
  var currentRoomId = sessionStorage.getItem('crossfour.online.room') || '';
  var currentRoom = null;
  var currentUser = null;
  var roomChannel = null;
  var walletChannel = null;
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
    authPanel.classList.toggle('hidden', signedIn);
    accountPanel.classList.toggle('hidden', !signedIn);
    roomPanel.classList.toggle('hidden', !signedIn);
    $('online-signout').disabled = !signedIn;
    if (!client) {
      $('online-google').disabled = true;
      $('online-facebook').disabled = true;
      $('online-config-note').textContent = isConfigured()
        ? 'Open Online to connect securely to the configured service. Offline play remains available.'
        : 'Waiting for the new Supabase project URL and publishable key. Offline play remains available.';
    } else {
      $('online-google').disabled = false;
      $('online-facebook').disabled = false;
      $('online-config-note').textContent = 'Sign in with Google or Facebook to use cloud profiles and rooms.';
    }
    if (!signedIn) {
      $('online-wallet-coins').textContent = '—';
      $('online-wallet-diamonds').textContent = '—';
      if (client) announce('Sign in to create or join online rooms.');
      return;
    }
    $('online-profile-name').value = '';
    $('online-profile-handle').textContent = 'Loading profile…';
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
        // An empty history is expected until the first table is started.
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
  function doOAuth(provider) {
    if (!client) return announce('Online services are not configured yet.', true);
    var native = isNative();
    var redirectTo = native ? 'com.offerpk.offlineludo://auth-callback' : window.location.origin + window.location.pathname;
    client.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: redirectTo, skipBrowserRedirect: native }
    }).then(function (result) {
      if (result.error) throw result.error;
      if (!native) return;
      if (!result.data || !result.data.url) throw new Error('The provider did not return an authorization URL.');
      var browser = plugin('Browser');
      if (!browser || typeof browser.open !== 'function') throw new Error('The Android browser plugin is unavailable. Rebuild the app with the current dependencies.');
      return browser.open({ url: result.data.url });
    }).catch(function (error) {
      announce('Sign-in could not start: ' + errorText(error), true);
    });
  }
  function handleNativeCallback(url) {
    if (!url) return Promise.resolve();
    var parsed;
    try { parsed = new URL(url); } catch (_) { return Promise.resolve(); }
    if (parsed.protocol !== 'com.offerpk.offlineludo:' || parsed.host !== 'auth-callback') return Promise.resolve();
    var code = parsed.searchParams.get('code');
    var authError = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
    if (authError) {
      announce('Sign-in was cancelled or rejected by the provider.', true);
      return Promise.resolve();
    }
    if (!code) return Promise.resolve();
    return ensureClient().then(function () { return client.auth.exchangeCodeForSession(code); }).then(function (result) {
      if (result.error) throw result.error;
      var browser = plugin('Browser');
      if (browser && typeof browser.close === 'function') return browser.close();
    }).catch(function (error) {
      announce('Could not finish sign-in: ' + errorText(error), true);
    });
  }
  function bindEvents() {
    $('btn-online').addEventListener('click', openOnline);
    $('online-back').addEventListener('click', closeOnline);
    $('online-google').addEventListener('click', function () { doOAuth('google'); });
    $('online-facebook').addEventListener('click', function () { doOAuth('facebook'); });
    $('online-signout').addEventListener('click', function () {
      if (!client) return;
      client.auth.signOut().then(function (result) {
        if (result.error) throw result.error;
        if (roomChannel) client.removeChannel(roomChannel);
        if (walletChannel) client.removeChannel(walletChannel);
        roomChannel = null;
        walletChannel = null;
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
          refreshRoom();
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
    client.auth.onAuthStateChange(function (_event, session) {
      currentUser = session && session.user ? session.user : null;
      if (!currentUser) {
        if (roomChannel) client.removeChannel(roomChannel);
        if (walletChannel) client.removeChannel(walletChannel);
        roomChannel = null;
        walletChannel = null;
        currentRoom = null;
        renderRoom();
      }
      renderAccount();
      if (currentUser) {
        window.setTimeout(function () {
          refreshAccount();
          subscribeWallet();
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
      if (currentUser) {
        refreshAccount();
        subscribeWallet();
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
      announce('Online services are configured. Open this screen to connect.');
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
