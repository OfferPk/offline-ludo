/* Surface browser connectivity changes in Online Ludo without coupling to local games or saves. */
(function () {
  'use strict';

  var screen = document.getElementById('online');
  var statusAnchor = document.getElementById('online-status');
  if (!screen || !statusAnchor || !statusAnchor.parentNode || typeof window.addEventListener !== 'function' || typeof navigator === 'undefined') return;

  var notice = document.getElementById('online-connectivity-status');
  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'online-connectivity-status';
    notice.className = 'online-limit-note online-connectivity-notice hidden';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.setAttribute('aria-atomic', 'true');
    statusAnchor.parentNode.insertBefore(notice, statusAnchor);
  }

  var restoreTimer = null;
  var state = 'unknown';
  var offlineMessage = 'Your device appears to be offline. Online sign-in and rooms need a network connection; local games and saves remain available on this device.';
  var restoredMessage = 'Your device reports that network access is back. Online services may still be reconnecting.';

  function clearRestoreTimer() {
    if (restoreTimer !== null) {
      window.clearTimeout(restoreTimer);
      restoreTimer = null;
    }
  }

  function show(message, nextState) {
    state = nextState;
    notice.dataset.state = nextState;
    notice.textContent = message;
    notice.classList.remove('hidden');
  }

  function hide() {
    state = 'online';
    notice.textContent = '';
    notice.classList.add('hidden');
  }

  function showOffline() {
    clearRestoreTimer();
    show(offlineMessage, 'offline');
  }

  function showRestored() {
    clearRestoreTimer();
    show(restoredMessage, 'restored');
    restoreTimer = window.setTimeout(function () {
      restoreTimer = null;
      if (navigator.onLine !== false && state === 'restored') hide();
    }, 5000);
  }

  window.addEventListener('offline', showOffline);
  window.addEventListener('online', showRestored);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (navigator.onLine === false) showOffline();
    else if (state === 'offline') showRestored();
  });

  if (navigator.onLine === false) showOffline();
})();
