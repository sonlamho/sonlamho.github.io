/* Shared behaviour for every page: the light/dark theme toggle. */
(function () {
  'use strict';

  var root = document.documentElement;
  var button = document.querySelector('.theme-toggle');
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function currentTheme() {
    var stamped = root.getAttribute('data-theme');
    if (stamped === 'light' || stamped === 'dark') return stamped;
    return darkQuery.matches ? 'dark' : 'light';
  }

  function updateButton() {
    if (!button) return;
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', 'Switch to ' + next + ' theme');
    button.setAttribute('title', 'Switch to ' + next + ' theme');
  }

  if (button) {
    button.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch (e) {
        /* storage unavailable: the choice simply lasts for this page view */
      }
      updateButton();
    });
  }

  if (darkQuery.addEventListener) {
    darkQuery.addEventListener('change', updateButton);
  }
  updateButton();
})();
