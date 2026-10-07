/* Client-side mode filters for the loaded Online match-history rows. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.OnlineHistoryFilter = api;
    api.init(root.document);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  var FILTER_LABELS = {
    classic: 'Online Classic',
    ludo_chess: 'Ludo Chess'
  };

  function init(document) {
    var list = document.getElementById('online-history-list');
    var group = document.getElementById('online-history-filters');
    var status = document.getElementById('online-history-filter-status');
    if (!list || !group || !status) return null;

    var buttons = Array.prototype.slice.call(group.querySelectorAll('[data-history-filter]'));
    if (!buttons.length) return null;
    var activeFilter = 'all';

    function getRows() {
      return Array.prototype.filter.call(list.children, function (item) {
        return item && item.dataset && Object.prototype.hasOwnProperty.call(item.dataset, 'historyMode');
      });
    }

    function render() {
      var rows = getRows();
      if (!rows.length) activeFilter = 'all';
      var visible = 0;
      rows.forEach(function (item) {
        var matches = activeFilter === 'all' || item.dataset.historyMode === activeFilter;
        item.hidden = !matches;
        if (matches) visible++;
      });

      group.classList.toggle('hidden', rows.length === 0);
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.dataset.historyFilter === activeFilter));
      });

      if (!rows.length) {
        status.textContent = '';
        status.classList.add('hidden');
        return;
      }
      if (activeFilter === 'all') {
        status.textContent = 'Showing all ' + rows.length + ' table' + (rows.length === 1 ? '' : 's') + '.';
      } else if (!visible) {
        status.textContent = 'No ' + (FILTER_LABELS[activeFilter] || 'matching') + ' tables in the loaded history.';
      } else {
        status.textContent = 'Showing ' + visible + ' of ' + rows.length + ' tables.';
      }
      status.classList.remove('hidden');
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var requested = button.dataset.historyFilter;
        if (requested === 'all' || Object.prototype.hasOwnProperty.call(FILTER_LABELS, requested)) {
          activeFilter = requested;
          render();
        }
      });
    });

    var Observer = document.defaultView && document.defaultView.MutationObserver;
    var observer = Observer ? new Observer(render) : null;
    if (observer) observer.observe(list, { childList: true });
    render();

    return {
      render: render,
      getActiveFilter: function () { return activeFilter; },
      disconnect: function () { if (observer) observer.disconnect(); }
    };
  }

  return { init: init };
});
