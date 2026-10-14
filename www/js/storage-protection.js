/* Opt-in browser storage persistence for local game saves. No data leaves this device. */
(function () {
  'use strict';

  var section = document.getElementById('storage-protection');
  var status = document.getElementById('storage-protection-status');
  var button = document.getElementById('btn-storage-protection');
  var settings = document.getElementById('settings');
  if (!section || !status || !button) return;

  var manager = navigator.storage;
  var supported = !!(manager && typeof manager.persisted === 'function' && typeof manager.persist === 'function');
  var pending = false;

  function setBusy(value) {
    section.setAttribute('aria-busy', value ? 'true' : 'false');
    pending = value;
  }

  function showProtected() {
    section.classList.add('is-protected');
    status.textContent = 'This browser protects local game data from automatic storage cleanup.';
    button.textContent = 'Protected';
    button.disabled = true;
  }

  function showUnprotected(message) {
    section.classList.remove('is-protected');
    status.textContent = message || 'Saves stay on this device; browser cleanup may remove them.';
    button.textContent = 'Protect saves';
    button.disabled = false;
  }

  function showUnavailable() {
    section.classList.remove('is-protected');
    status.textContent = 'This browser cannot protect storage. Saves remain on this device.';
    button.hidden = true;
    button.disabled = true;
    section.setAttribute('aria-busy', 'false');
  }

  function refresh() {
    if (pending) return;
    if (!supported) {
      showUnavailable();
      return;
    }
    button.hidden = false;
    button.disabled = true;
    button.textContent = 'Checking…';
    setBusy(true);
    Promise.resolve().then(function () { return manager.persisted(); }).then(function (persisted) {
      if (persisted) showProtected();
      else showUnprotected();
    }).catch(function () {
      showUnprotected('Could not check protection. You can still ask the browser to protect saves.');
      button.textContent = 'Try protection';
    }).finally(function () {
      setBusy(false);
    });
  }

  button.addEventListener('click', function () {
    if (!supported || pending || button.disabled) return;
    setBusy(true);
    button.disabled = true;
    button.textContent = 'Requesting…';
    status.textContent = 'Asking your browser to protect this site’s local game data…';

    // Call synchronously from the click handler so browsers that require a user
    // gesture can honor it; the request never reads or uploads the saved data.
    var request;
    try { request = manager.persist(); }
    catch (error) { request = Promise.reject(error); }

    Promise.resolve(request).then(function (granted) {
      if (granted) showProtected();
      else showUnprotected('Protection was not granted. Saves remain local and browser cleanup may remove them.');
    }).catch(function () {
      showUnprotected('The browser could not enable protection. Saves remain local and browser cleanup may remove them.');
    }).finally(function () {
      setBusy(false);
    });
  });

  if (settings && typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      if (!settings.classList.contains('hidden')) refresh();
    }).observe(settings, { attributes: true, attributeFilter: ['class'] });
  }
  if (!settings || !settings.classList.contains('hidden')) refresh();
})();
