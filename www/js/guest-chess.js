/* Local guest Chess. This screen is deliberately independent of Supabase rooms and cloud wallets. */
(function () {
  'use strict';

  var screen = document.getElementById('guest-chess-screen');
  if (!screen) return;
  var state = null;
  var selectedSquare = -1;
  var selectedMoves = [];
  var pendingPromotion = null;
  var computerThinking = false;
  var computerTimer = 0;
  var gameSerial = 0;

  function $(id) { return document.getElementById(id); }
  function chess() { return window.LudoChess; }
  function showStatus(message) { $('guest-chess-status').textContent = message; }
  function clearSelection() {
    selectedSquare = -1;
    selectedMoves = [];
    pendingPromotion = null;
  }
  function resultLabel() {
    if (!state) return '';
    if (state.result === 'checkmate') return state.winner === 0 ? 'Checkmate · you win' : 'Checkmate · the computer wins';
    if (state.result === 'stalemate') return 'Draw · stalemate';
    if (state.result === 'draw_seventy_five_moves') return 'Draw · 75-move rule';
    if (state.result === 'draw_fivefold_repetition') return 'Draw · fivefold repetition';
    if (state.result === 'draw_insufficient_material') return 'Draw · insufficient material';
    if (state.result === 'draw_fifty_move_claim') return 'Draw · 50-move claim';
    if (state.result === 'draw_threefold_claim') return 'Draw · threefold repetition claim';
    return 'Game complete';
  }
  function currentStatus() {
    if (!state) return 'Start a guest Chess game whenever you are ready.';
    if (state.phase === 'over') return resultLabel();
    if (computerThinking) return 'Computer is thinking…';
    var check = chess().inCheck(state, state.turn);
    return (state.turn === 0 ? 'Your move · Red' : 'Computer to move · Blue') + (check ? ' · Check' : '');
  }
  function renderHistory() {
    var list = $('guest-chess-history');
    list.replaceChildren();
    var history = chess().movesFromPositionHistory(state);
    var rows = [];
    history.moves.forEach(function (move) {
      var row = rows.find(function (candidate) { return candidate.number === move.number; });
      if (!row) { row = { number: move.number, red: '', blue: '' }; rows.push(row); }
      row[move.color === 0 ? 'red' : 'blue'] = move.san;
    });
    rows.forEach(function (row) {
      var item = document.createElement('li');
      var number = document.createElement('span'); number.textContent = row.number + '.';
      var red = document.createElement('span'); red.textContent = row.red;
      var blue = document.createElement('span'); blue.textContent = row.blue;
      item.append(number, red, blue);
      list.appendChild(item);
    });
    $('guest-chess-history-empty').classList.toggle('hidden', rows.length > 0);
  }
  function renderBoard() {
    if (!state || !chess()) return;
    var board = $('guest-chess-board');
    var focused = board.contains(document.activeElement) ? Number(document.activeElement.dataset.square) : -1;
    var focusIndex = Number.isInteger(focused) && focused >= 0 && focused < 64 ? focused : (selectedSquare >= 0 ? selectedSquare : 0);
    var glyphs = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚', P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔' };
    $('guest-chess-red').classList.toggle('is-turn', state.phase === 'active' && state.turn === 0 && !computerThinking);
    $('guest-chess-blue').classList.toggle('is-turn', state.phase === 'active' && state.turn === 1);
    $('guest-chess-status').textContent = currentStatus();
    $('guest-chess-claim-draw').classList.toggle('hidden', state.phase !== 'active' || state.turn !== 0 || computerThinking || !chess().canClaimDraw(state));
    $('guest-chess-promotion').classList.toggle('hidden', !pendingPromotion || computerThinking);
    board.replaceChildren();

    for (var row = 0; row < 8; row++) {
      var rowElement = document.createElement('div');
      rowElement.className = 'online-chess-row';
      rowElement.setAttribute('role', 'row');
      rowElement.setAttribute('aria-rowindex', String(row + 1));
      for (var col = 0; col < 8; col++) {
        var index = row * 8 + col;
        var piece = state.board[index];
        var cell = document.createElement('button');
        cell.type = 'button';
        cell.setAttribute('role', 'gridcell');
        cell.dataset.square = String(index);
        cell.tabIndex = index === focusIndex ? 0 : -1;
        cell.setAttribute('aria-colindex', String(col + 1));
        cell.setAttribute('aria-selected', String(selectedSquare === index));
        var canPlay = state.phase === 'active' && state.turn === 0 && !computerThinking;
        cell.setAttribute('aria-disabled', String(!canPlay));
        cell.className = 'online-chess-square ' + ((row + col) % 2 ? 'dark' : 'light');
        var checkedKing = state.check ? state.board.indexOf(state.turn === 0 ? 'K' : 'k') : -1;
        if (index === checkedKing) cell.classList.add('is-check');
        if (selectedSquare === index) cell.classList.add('is-selected');
        var legal = selectedMoves.find(function (move) { return move.to === index; });
        if (legal) {
          cell.classList.add('is-legal');
          if (state.board[index] !== '.' || legal.enPassant) cell.classList.add('is-capture');
        }
        if (state.last_move && (state.last_move.from === index || state.last_move.to === index)) {
          cell.classList.add(state.last_move.from === index ? 'last-from' : 'last-to');
        }
        var label = piece === '.' ? 'Empty square' : (chess().colorOf(piece) === 0 ? 'Red ' : 'Blue ') + chess().pieceName(piece);
        cell.setAttribute('aria-label', label + ' on ' + chess().coord(index) +
          (selectedSquare === index ? ', selected' : '') + (legal ? ', legal destination' : '') +
          (index === checkedKing ? ', in check' : ''));
        if (col === 0) {
          var rank = document.createElement('span');
          rank.className = 'square-coord rank-coord';
          rank.textContent = String(8 - row);
          cell.appendChild(rank);
        }
        if (row === 7) {
          var file = document.createElement('span');
          file.className = 'square-coord file-coord';
          file.textContent = String.fromCharCode(97 + col);
          cell.appendChild(file);
        }
        if (piece !== '.') {
          var token = document.createElement('span');
          token.className = 'online-chess-piece ' + (chess().colorOf(piece) === 0 ? 'red-piece' : 'blue-piece');
          token.textContent = glyphs[piece];
          token.setAttribute('aria-hidden', 'true');
          cell.appendChild(token);
        }
        cell.addEventListener('focus', function (focusedCell) { return function () {
          board.querySelectorAll('[data-square]').forEach(function (square) { square.tabIndex = square === focusedCell ? 0 : -1; });
        }; }(cell));
        cell.addEventListener('click', function (squareIndex) { return function () { chooseSquare(squareIndex); }; }(index));
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
    renderHistory();
  }
  function endScreen() {
    clearTimeout(computerTimer);
    computerTimer = 0;
    gameSerial++;
    computerThinking = false;
    screen.classList.add('hidden');
    screen.setAttribute('aria-hidden', 'true');
    document.getElementById('home').classList.remove('hidden');
    var backTarget = document.getElementById('btn-guest-chess') || document.getElementById('btn-online');
    if (backTarget) backTarget.focus({ preventScroll: true });
  }
  function scheduleComputerMove() {
    if (!state || state.phase !== 'active' || state.turn !== 1) return;
    computerThinking = true;
    clearSelection();
    renderBoard();
    var serial = gameSerial;
    computerTimer = window.setTimeout(function () {
      computerTimer = 0;
      if (serial !== gameSerial || !state || state.phase !== 'active' || state.turn !== 1) return;
      try {
        var move = chess().chooseComputerMove(state);
        if (!move) throw new Error('The computer could not find a legal move.');
        state = chess().applyMove(state, move);
        computerThinking = false;
        renderBoard();
      } catch (error) {
        computerThinking = false;
        renderBoard();
        showStatus('Computer move failed. Start a new guest game to try again.');
      }
    }, 320);
  }
  function commitHumanMove(move) {
    try {
      state = chess().applyMove(state, move);
      clearSelection();
      renderBoard();
      if (state.phase === 'active' && state.turn === 1) scheduleComputerMove();
    } catch (error) {
      clearSelection();
      renderBoard();
      showStatus('That move could not be applied. Select a legal move and try again.');
    }
  }
  function chooseSquare(index) {
    if (!state || computerThinking || state.phase !== 'active' || state.turn !== 0 || pendingPromotion) return;
    var destinationMoves = selectedMoves.filter(function (move) { return move.to === index; });
    if (selectedSquare >= 0 && destinationMoves.length) {
      if (destinationMoves.some(function (move) { return !!move.promotion; })) {
        pendingPromotion = { from: selectedSquare, to: index };
        renderBoard();
      } else {
        commitHumanMove(destinationMoves[0]);
      }
      return;
    }
    var piece = state.board[index];
    if (piece !== '.' && chess().colorOf(piece) === 0) {
      selectedSquare = index;
      selectedMoves = chess().legalMoves(state, index);
    } else {
      clearSelection();
    }
    renderBoard();
  }
  function start() {
    if (!chess()) return;
    clearTimeout(computerTimer);
    computerTimer = 0;
    gameSerial++;
    state = chess().initialState();
    computerThinking = false;
    clearSelection();
    document.getElementById('online').classList.add('hidden');
    document.getElementById('home').classList.add('hidden');
    screen.classList.remove('hidden');
    screen.setAttribute('aria-hidden', 'false');
    renderBoard();
    $('guest-chess-title').focus({ preventScroll: true });
  }
  function openOnlineRooms() {
    screen.classList.add('hidden');
    screen.setAttribute('aria-hidden', 'true');
    document.getElementById('home').classList.remove('hidden');
    var onlineMode = document.getElementById('online-mode');
    onlineMode.value = 'ludo_chess';
    onlineMode.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-online').click();
  }

  document.getElementById('btn-guest-chess').addEventListener('click', start);
  $('online-guest-chess').addEventListener('click', start);
  $('guest-chess-home').addEventListener('click', endScreen);
  $('guest-chess-new').addEventListener('click', start);
  $('guest-chess-online').addEventListener('click', openOnlineRooms);
  $('guest-chess-claim-draw').addEventListener('click', function () {
    if (!state || !chess().canClaimDraw(state)) return;
    state = chess().claimDraw(state);
    clearSelection();
    renderBoard();
  });
  $('guest-chess-promotion').querySelectorAll('[data-guest-promotion]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!pendingPromotion || computerThinking) return;
      var move = { from: pendingPromotion.from, to: pendingPromotion.to, promotion: button.dataset.guestPromotion };
      clearSelection();
      commitHumanMove(move);
    });
  });

  window.GuestChess = Object.freeze({
    start: start,
    snapshot: function () {
      return { state: state ? JSON.parse(JSON.stringify(state)) : null, computerThinking: computerThinking,
        pendingPromotion: pendingPromotion ? JSON.parse(JSON.stringify(pendingPromotion)) : null };
    }
  });
})();
