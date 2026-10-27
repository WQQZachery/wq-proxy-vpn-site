// WQ's Proxy VPN site — progressive enhancement only. Every feature degrades gracefully without JS.
(function () {
  'use strict';
  var KEY = 'wqvpn-lang';
  function getPref() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setPref(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked */ } }

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mobileMq = window.matchMedia('(max-width: 860px)');

  // Header: slightly shrinks once the page scrolls (main site .nav.solid).
  // Perf: reads scrollY at most once per animation frame and only writes the class when the state flips,
  // so a scroll gesture costs one cheap callback per frame and two class writes in total.
  var header = document.querySelector('.site-header');
  if (header) {
    var solid = null, queued = false;
    var update = function () {
      queued = false;
      var s = window.scrollY > 8;
      if (s !== solid) { solid = s; header.classList.toggle('solid', s); }
    };
    window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // Mobile navigation: drop-down glass panel with the main site's dialog motion
  // (open: opacity .22s + transform .32s cubic-bezier(.22,1,.36,1); close waits for the exit transition).
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var timer = 0;
    var EXIT_MS = 280;
    var setInert = function (on) {
      if (on) { nav.setAttribute('inert', ''); nav.setAttribute('aria-hidden', 'true'); }
      else { nav.removeAttribute('inert'); nav.removeAttribute('aria-hidden'); }
    };
    var isOpen = function () { return nav.classList.contains('is-open'); };
    var open = function () {
      clearTimeout(timer);
      setInert(false);
      nav.setAttribute('data-state', 'opening');
      // force a style flush so the entry transition runs from the closed state
      void nav.offsetWidth;
      nav.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      timer = setTimeout(function () { nav.setAttribute('data-state', 'open'); }, reduceMotion.matches ? 0 : 340);
      var first = nav.querySelector('a');
      if (first) first.focus({ preventScroll: true });
    };
    var close = function (returnFocus) {
      if (!isOpen()) return;
      clearTimeout(timer);
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      if (returnFocus) toggle.focus();
      var done = function () { nav.setAttribute('data-state', 'closed'); if (mobileMq.matches) setInert(true); };
      if (reduceMotion.matches) done();
      else { nav.setAttribute('data-state', 'closing'); timer = setTimeout(done, EXIT_MS); }
    };
    var reset = function () {
      clearTimeout(timer);
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      nav.setAttribute('data-state', 'closed');
      setInert(mobileMq.matches);
    };
    reset();
    toggle.addEventListener('click', function () { if (isOpen()) close(false); else open(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(true); }
    });
    document.addEventListener('click', function (e) {
      if (isOpen() && !nav.contains(e.target) && !toggle.contains(e.target)) close(false);
    });
    var onMq = function () { reset(); };
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', onMq); else mobileMq.addListener(onMq);
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

  // Liquid glass lens — ported from the main site (wqzachery.dpdns.org index.html).
  // Chromium only (backdrop-filter: url() works there); Safari/Firefox keep the frosted .lg fallback.
  // A per-element SVG filter: canvas-rendered rounded-rect SDF displacement map (smoothstep bezel) fed to
  // three feDisplacementMap passes for a slight chromatic split.
  // Perf budget: the filter re-samples and displaces the backdrop on EVERY frame the element is on screen, so
  // it is applied only to elements marked [data-lens] (the header pill). Enabled on all Chromium devices incl.
  // phones at the owner's request (2026-10-27); cards stay frosted-free for scroll performance.
  (function () {
    var ua = navigator.userAgent;
    var chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/CriOS|EdgiOS|FxiOS/.test(ua) && !/Firefox\//.test(ua);
    if (!chromium || !window.CSS || !CSS.supports('backdrop-filter', 'url(#x)')) return;
    if (window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more)').matches) return;
    var NS = 'http://www.w3.org/2000/svg';
    var defs = document.querySelector('#lgdefs defs');
    if (!defs) return;
    var MAX_AREA = 600000;
    var n = 0;
    function mapURL(w, h, r, bezel) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
      var hw = w / 2, hh = h / 2, ix = hw - r, iy = hh - r;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var px = x + 0.5 - hw, py = y + 0.5 - hh, ax = Math.abs(px), ay = Math.abs(py);
        var qx = ax - ix, qy = ay - iy;
        var ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        var sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
        var nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { var l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; } else if (qx > qy) nx = 1; else ny = 1;
        nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
        var dist = -sdf, m = 0;
        if (dist < bezel) { var t = 1 - Math.max(dist, 0) / bezel; m = t * t * (3 - 2 * t); }
        var i = (y * w + x) * 4;
        d[i] = 128 - nx * m * 127; d[i + 1] = 128 - ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0); return c.toDataURL();
    }
    function prim(tag, attrs) {
      var e = document.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }
    function drop(el) {
      el.classList.remove('lens'); el.style.removeProperty('--lens');
      if (el.dataset.lid) { var f = document.getElementById(el.dataset.lid); if (f) f.remove(); }
      delete el.dataset.lk; delete el.dataset.lid;
    }
    function build(el) {
      var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (w < 8 || h < 8 || w * h > MAX_AREA) { drop(el); return; }
      var key = w + 'x' + h; if (el.dataset.lk === key) return; el.dataset.lk = key;
      var cs = getComputedStyle(el), r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
      var bezel = Math.min(Math.max(h * 0.32, 14), 28, Math.min(w, h) / 2);
      var scale = Math.min(bezel * 1.6, 42);
      var id = el.dataset.lid || ('lgl' + (n++)); el.dataset.lid = id;
      var f = document.getElementById(id); if (f) f.remove();
      f = prim('filter', { id: id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
      f.appendChild(prim('feImage', { href: mapURL(w, h, r, bezel), x: 0, y: 0, width: w, height: h, result: 'm', preserveAspectRatio: 'none' }));
      var ch = [['r', 1, '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'], ['g', 0.975, '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'], ['b', 0.95, '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0']];
      ch.forEach(function (c) {
        f.appendChild(prim('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'm', scale: scale * c[1], xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + c[0] }));
        f.appendChild(prim('feColorMatrix', { 'in': 'd' + c[0], type: 'matrix', values: c[2], result: c[0] }));
      });
      f.appendChild(prim('feBlend', { 'in': 'r', in2: 'g', mode: 'screen', result: 'rg' }));
      f.appendChild(prim('feBlend', { 'in': 'rg', in2: 'b', mode: 'screen' }));
      defs.appendChild(f);
      el.style.setProperty('--lens', 'url(#' + id + ')');
      if (el.__vis !== false) el.classList.add('lens');
    }
    var els = Array.prototype.slice.call(document.querySelectorAll('.lg[data-lens]'));
    if (!els.length) return;
    var run = function () { els.forEach(build); };
    // refraction only for glass that is on screen; off-screen surfaces drop the SVG filter
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
      es.forEach(function (e) { var el = e.target; el.__vis = e.isIntersecting; if (el.dataset.lid) el.classList.toggle('lens', e.isIntersecting); });
    }, { rootMargin: '120px' }) : null;
    var ro = 'ResizeObserver' in window ? new ResizeObserver(function () { clearTimeout(run.t); run.t = setTimeout(run, 120); }) : null;
    var watch = function (on) {
      els.forEach(function (e) {
        if (io) { if (on) io.observe(e); else io.unobserve(e); }
        if (ro) { if (on) ro.observe(e); else ro.unobserve(e); }
      });
    };
    watch(true);
    // background tab: stop observing (no layout/intersection work while hidden), resume when visible again
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearTimeout(run.t); watch(false); } else { watch(true); }
    });
    requestAnimationFrame(run);
  })();
})();
