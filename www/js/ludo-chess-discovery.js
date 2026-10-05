(function () {
  'use strict';

  var home = document.getElementById('home');
  var homeActions = home && home.querySelector('.home-actions');
  var onlineLaunch = document.getElementById('btn-online');
  var onlineMode = document.getElementById('online-mode');
  if (!home || !homeActions || !onlineLaunch || !onlineMode || document.getElementById('btn-online-chess')) return;

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  var card = document.createElement('button');
  card.id = 'btn-online-chess';
  card.type = 'button';
  card.className = 'home-chess-launch';
  card.setAttribute('aria-labelledby', 'home-chess-launch-title');
  card.setAttribute('aria-describedby', 'home-chess-launch-description');
  card.setAttribute('data-home-entry', 'ludo-chess');

  var mark = node('span', 'home-chess-launch-mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.appendChild(node('span', '', '♞'));

  var copy = node('span', 'home-chess-launch-copy');
  copy.appendChild(node('b', '', 'Ludo Chess'));
  copy.lastChild.id = 'home-chess-launch-title';
  copy.appendChild(node('small', '', 'Online Rooms · Standard chess · 2 players'));
  copy.lastChild.id = 'home-chess-launch-description';

  var arrow = node('span', 'home-chess-launch-arrow', '›');
  arrow.setAttribute('aria-hidden', 'true');
  card.append(mark, copy, arrow);

  card.addEventListener('click', function () {
    onlineMode.value = 'ludo_chess';
    onlineMode.dispatchEvent(new Event('change', { bubbles: true }));
    onlineLaunch.click();
  });

  // Keep every existing Ludo mode and its order intact while making the online
  // Chess route a separate, first-screen action on phone-sized layouts.
  homeActions.parentNode.insertBefore(card, homeActions);
})();
