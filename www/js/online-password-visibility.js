/* Accessible show/hide controls for Online account password fields. */
(function () {
  'use strict';

  var controls = [];

  function setVisible(control, visible) {
    control.input.type = visible ? 'text' : 'password';
    control.button.setAttribute('aria-pressed', String(visible));
    control.button.textContent = visible ? 'Hide' : 'Show';
  }

  function conceal(control) {
    if (control) setVisible(control, false);
  }

  function concealAll() {
    controls.forEach(conceal);
  }

  function bind(inputId, buttonId) {
    var input = document.getElementById(inputId);
    var button = document.getElementById(buttonId);
    if (!input || !button) return null;

    var control = { input: input, button: button };
    controls.push(control);
    button.addEventListener('click', function () {
      setVisible(control, input.type === 'password');
    });
    return control;
  }

  var password = bind('online-password', 'online-password-toggle');
  bind('online-new-password', 'online-new-password-toggle');

  ['online-auth-form', 'online-recovery-form'].forEach(function (formId) {
    var form = document.getElementById(formId);
    if (form) form.addEventListener('submit', concealAll, true);
  });

  var signUp = document.getElementById('online-signup');
  if (signUp) signUp.addEventListener('click', function () { conceal(password); }, true);

  var back = document.getElementById('online-back');
  if (back) back.addEventListener('click', concealAll, true);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) concealAll();
  });
})();
