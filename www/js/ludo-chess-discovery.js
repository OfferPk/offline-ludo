(function () {
  'use strict';

  var home = document.getElementById('home');
  var homeActions = home && home.querySelector('.home-actions');
  if (!home || !homeActions || document.getElementById('btn-guest-chess')) return;

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  var card = document.createElement('button');
  card.id = 'btn-guest-chess';
  card.type = 'button';
  card.className = 'home-chess-launch home-chess-guest-launch';
  card.setAttribute('aria-labelledby', 'home-guest-chess-title');
  card.setAttribute('aria-describedby', 'home-guest-chess-description');
  card.setAttribute('data-home-entry', 'guest-chess');

  var mark = node('span', 'home-chess-launch-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.appendChild(node('span', '', '♟'));

  var copy = node('span', 'home-chess-launch-copy');
  copy.appendChild(node('b', '', 'Play Chess as Guest'));
  copy.lastChild.id = 'home-guest-chess-title';
  copy.appendChild(node('small', '', 'No email · Computer opponent · No coins'));
  copy.lastChild.id = 'home-guest-chess-description';

  var arrow = node('span', 'home-chess-launch-arrow', '›');
  arrow.setAttribute('aria-hidden', 'true');
  card.append(mark, copy, arrow);
  card.addEventListener('click', function () {
    if (window.GuestChess) window.GuestChess.start();
  });

  // The guest-first action is one tap. The separate signed-in human-room route
  // is offered on the guest screen so existing Ludo modes keep their first-screen layout.
  homeActions.parentNode.insertBefore(card, homeActions);
})();
