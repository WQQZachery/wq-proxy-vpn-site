// WQ's Proxy VPN site — progressive enhancement only. Every feature degrades gracefully without JS.
(function () {
  'use strict';
  var KEY = 'wqvpn-lang';
  function getPref() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setPref(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked */ } }

  // Mobile navigation toggle
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var close = function () { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', function () {
      var open = !nav.classList.contains('is-open');
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var first = nav.querySelector('a'); if (first) first.focus(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { close(); toggle.focus(); }
    });
    window.matchMedia('(min-width: 861px)').addEventListener('change', function (m) { if (m.matches) close(); });
  }

  // Language preference: remembered when the user explicitly switches. No automatic redirects.
  Array.prototype.forEach.call(document.querySelectorAll('[data-set-lang]'), function (a) {
    a.addEventListener('click', function () { setPref(a.getAttribute('data-set-lang')); });
  });
  var banner = document.getElementById('lang-suggest');
  if (banner && document.body.getAttribute('data-lang') === 'zh') {
    var pref = getPref();
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
    var prefersEn = /^en\b/i.test(String(langs[0] || ''));
    if (pref === 'en' || (!pref && prefersEn)) banner.hidden = false;
    var dismiss = banner.querySelector('[data-dismiss-suggest]');
    if (dismiss) dismiss.addEventListener('click', function () { setPref('zh'); banner.hidden = true; });
  }

  // Copy buttons for checksums (the value stays selectable text without JS).
  function selectText(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function flash(btn, state) {
    var label = btn.getAttribute(state === 'done' ? 'data-label-done' : 'data-label-fail');
    btn.textContent = label;
    btn.setAttribute('data-state', state);
    setTimeout(function () { btn.textContent = btn.getAttribute('data-label'); btn.removeAttribute('data-state'); }, 2000);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.copy-btn[data-copy-target]'), function (btn) {
    var target = document.getElementById(btn.getAttribute('data-copy-target'));
    if (!target) return;
    btn.hidden = false;
    btn.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', function () {
      var text = target.textContent.trim();
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { flash(btn, 'done'); }, function () { selectText(target); flash(btn, 'fail'); });
      } else {
        selectText(target);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        flash(btn, ok ? 'done' : 'fail');
      }
    });
  });
})();
