/* Local two-device Classic Ludo controller. Signaling is exchanged by QR/text; game state is host-authoritative. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('local-room'), peer = null, isHost = false, gameState = null, revision = 0;
  var home = $('home'), game = $('game'), busy = false, failureText = '';
  if (!dialog || !window.LocalPeer || !window.__cf || !window.__cf.logic) return;
  var L = window.__cf.logic;

  function setStatus(text, kind) {
    var el = $('local-peer-status');
    el.textContent = text;
    el.dataset.state = kind || 'info';
  }
  function openPanel() { dialog.classList.remove('hidden'); }
  function closePanel() { dialog.classList.add('hidden'); }
  function showOutput(signal) {
    $('local-signal-output').value = signal;
    $('local-copy-signal').disabled = !signal;
    var qrBox = $('local-signal-qr');
    qrBox.replaceChildren();
    qrBox.classList.add('hidden');
    if (!signal || typeof window.qrcode !== 'function') return;
    try {
      var qr = window.qrcode(0, 'L');
      qr.addData(signal, 'Byte');
      qr.make();
      qrBox.innerHTML = qr.createSvgTag(3, 8, 'Offline WebRTC room signal');
      qrBox.classList.remove('hidden');
    } catch (_) {
      var note = document.createElement('small');
      note.textContent = 'This signal is too long for one QR code. Copy the text and transfer it with an offline nearby-share method.';
      qrBox.appendChild(note);
      qrBox.classList.remove('hidden');
    }
  }
  function setRoomActive(active) {
    $('local-peer-open').classList.toggle('hidden', !active);
    $('local-close-room').disabled = !active;
    document.body.classList.toggle('local-peer-active', !!active);
  }
  function renderBoard(state, rev) {
    revision = rev;
    window.__cf.presentOnline({
      state: state,
      mySeat: isHost ? 0 : 1,
      names: ['Host', 'Guest'],
      deadline: 0,
      pending: false,
      onRoll: function () {
        if (isHost) submitAction({ action: 'roll', queueIndex: 0, revision: revision }, 0);
        else sendAction({ action: 'roll', queueIndex: 0, revision: revision });
      },
      onMove: function (piece, queueIndex) {
        if (isHost) submitAction({ action: 'move', piece: piece, queueIndex: queueIndex, revision: revision }, 0);
        else sendAction({ action: 'move', piece: piece, queueIndex: queueIndex, revision: revision });
      }
    });
    if (state.phase === 'over') {
      var winner = (state.ranking && state.ranking.length) ? state.ranking[0] : null;
      setStatus('Match complete · ' + (winner === 0 ? 'Host' : winner === 1 ? 'Guest' : 'No winner') + ' wins. Local peer rooms do not use cloud coins.', 'complete');
      $('local-start-match').disabled = true;
    }
  }
  function snapshot() {
    return JSON.parse(JSON.stringify(gameState));
  }
  function broadcastState() {
    if (!peer || !gameState) return;
    try { peer.send({ kind: 'state', revision: revision, state: snapshot() }); }
    catch (error) { setStatus('Could not send the latest board: ' + error.message, 'error'); }
    renderBoard(gameState, revision);
  }
  function sendAction(action) {
    if (!peer || !gameState) return setStatus('Wait for the host to start the match.', 'error');
    try { peer.send(Object.assign({ kind: 'action' }, action)); }
    catch (error) { setStatus('Action was not sent: ' + error.message, 'error'); }
  }
  function submitAction(action, actorSeat) {
    if (!isHost || !gameState || busy) return;
    if (!window.LocalPeer.validateAction(Object.assign({ kind: 'action' }, action))) return;
    if (action.revision !== revision || gameState.turn !== actorSeat) {
      setStatus('A stale action was ignored. The host board remains authoritative.', 'warning');
      return;
    }
    try {
      if (action.action === 'roll') {
        if (gameState.phase !== 'roll') return;
        L.roll(gameState);
      } else {
        if (gameState.phase !== 'move') return;
        var value = gameState.queue[action.queueIndex];
        if (!Number.isInteger(value)) return;
        L.move(gameState, action.piece, value);
      }
      revision++;
      broadcastState();
    } catch (error) {
      setStatus('Illegal move ignored by host: ' + error.message, 'warning');
      broadcastState();
    }
  }
  function onMessage(message) {
    if (isHost) {
      if (message.kind === 'action') submitAction(message, 1);
      return;
    }
    if (message.kind === 'state') {
      renderBoard(message.state, message.revision);
      setStatus(message.state.phase === 'over' ? $('local-peer-status').textContent : 'Connected · waiting for your turn or the host to start.', message.state.phase === 'over' ? 'complete' : 'connected');
    }
  }
  function onPeerStatus(status, detail) {
    if (status === 'connected') {
      failureText = '';
      setStatus(isHost ? 'Connected · you can start the two-player Classic match.' : 'Connected · waiting for the host to start Classic Ludo.', 'connected');
      $('local-start-match').disabled = !isHost || !!gameState;
      $('local-close-room').disabled = false;
      if (isHost && gameState) broadcastState();
    } else if (status === 'connecting') {
      setStatus('Connecting directly to the other device on the local network…', 'connecting');
    } else if (status === 'failed') {
      failureText = 'Connection failed (' + String(detail || 'unknown') + '). Check both devices are on the same Wi-Fi/hotspot and that the hotspot allows device-to-device traffic.';
      setStatus(failureText, 'error');
      $('local-start-match').disabled = true;
    } else if (status === 'rejected') {
      setStatus('Rejected an invalid or mismatched local message: ' + String(detail || ''), 'warning');
    } else if (status === 'stale') {
      setStatus('Ignored a stale board update.', 'warning');
    } else if (status === 'closed' && !failureText) {
      setStatus('Local data channel closed. Reconnection is not supported; end this room and create a new one.', 'warning');
      $('local-start-match').disabled = true;
    }
  }
  function disposePeer() {
    var old = peer;
    peer = null;
    if (old) old.close();
  }
  function resetRoom() {
    disposePeer();
    isHost = false; gameState = null; revision = 0; busy = false; failureText = '';
    $('local-signal-input').value = '';
    showOutput('');
    $('local-host-offer').disabled = false;
    $('local-join-offer').disabled = false;
    $('local-accept-answer').disabled = true;
    $('local-start-match').disabled = true;
    $('local-close-room').disabled = true;
    $('local-start-match').textContent = 'Start Classic Ludo';
    setRoomActive(false);
    setStatus('No local room yet. Create an offer on one device.', 'info');
  }
  function makePeer(role) {
    disposePeer();
    peer = new window.LocalPeer({ role: role, onStatus: onPeerStatus, onMessage: onMessage });
    isHost = role === 'host';
    gameState = null; revision = 0; failureText = '';
    $('local-start-match').disabled = true;
    $('local-close-room').disabled = false;
    setRoomActive(true);
    return peer;
  }
  $('btn-local-room').addEventListener('click', function () {
    openPanel();
    if (!peer) setStatus('Create an offer on one device, or paste an offer on the joining device.', 'info');
  });
  $('local-peer-open').addEventListener('click', openPanel);
  $('local-host-offer').addEventListener('click', async function () {
    try {
      var p = makePeer('host');
      setStatus('Preparing a local offer… keep this screen open.', 'connecting');
      var offer = await p.createOffer();
      showOutput(offer);
      $('local-accept-answer').disabled = false;
      setStatus('Offer ready · show this QR to the joiner, or copy the signal text. No signaling server is used.', 'info');
    } catch (error) {
      setStatus('Could not create an offer: ' + error.message, 'error');
      $('local-start-match').disabled = true;
    }
  });
  $('local-join-offer').addEventListener('click', async function () {
    var signal = $('local-signal-input').value.trim();
    if (!signal) return setStatus('Paste or scan the host offer first.', 'error');
    try {
      var p = makePeer('joiner');
      setStatus('Reading offer and preparing a local answer…', 'connecting');
      var answer = await p.acceptOffer(signal);
      showOutput(answer);
      $('local-start-match').disabled = true;
      setStatus('Answer ready · show this QR to the host, or copy the signal text. The host must accept it to connect.', 'info');
    } catch (error) {
      disposePeer(); setRoomActive(false);
      setStatus('Could not create an answer: ' + error.message, 'error');
    }
  });
  $('local-accept-answer').addEventListener('click', async function () {
    if (!peer || !isHost) return setStatus('Create the host offer first.', 'error');
    var signal = $('local-signal-input').value.trim();
    if (!signal) return setStatus('Paste or scan the joiner answer first.', 'error');
    try {
      await peer.acceptAnswer(signal);
      setStatus('Answer accepted · connecting over the local network…', 'connecting');
    } catch (error) {
      setStatus('Could not accept the answer: ' + error.message, 'error');
    }
  });
  $('local-copy-signal').addEventListener('click', async function () {
    var text = $('local-signal-output').value;
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else { $('local-signal-output').select(); document.execCommand('copy'); }
      setStatus('Signal copied. Transfer it only to the other device in this room.', 'info');
    } catch (_) {
      $('local-signal-output').focus(); $('local-signal-output').select();
      setStatus('Select the signal text and copy it manually.', 'warning');
    }
  });
  $('local-start-match').addEventListener('click', function () {
    if (!peer || !isHost || !peer.channel || peer.channel.readyState !== 'open') return setStatus('Wait until the local peer is connected.', 'error');
    var seed = 1;
    try { var random = new Uint32Array(1); crypto.getRandomValues(random); seed = random[0] || 1; } catch (_) { seed = (Math.random() * 4294967295) >>> 0 || 1; }
    gameState = L.newGame([{ type: 'human' }, { type: 'human' }, null, null], L.DEFAULT_RULES, seed, 'classic');
    revision = 1;
    $('local-start-match').disabled = true;
    broadcastState();
    closePanel();
  });
  $('local-close-room').addEventListener('click', function () {
    resetRoom();
    window.__cf.clearOnline();
    game.classList.add('hidden');
    home.classList.remove('hidden');
    closePanel();
  });
  $('local-room').addEventListener('click', function (event) { if (event.target === dialog) closePanel(); });
  document.querySelectorAll('[data-close="local-room"]').forEach(function (button) { button.addEventListener('click', closePanel); });
  resetRoom();
  window.LocalRoom = { open: openPanel, close: resetRoom, get active() { return !!peer; } };
})();
