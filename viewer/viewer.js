/* Carte publiée : lit le projet intégré à la page (#editeur-carte-projet) et l'affiche.
   Dépend de Leaflet, Sanitize et Model, intégrés dans la même page à l'export. */
(function () {
  'use strict';
  var M = window.Model, S = window.Sanitize;
  var $ = function (s) { return document.querySelector(s); };

  var project = M.revive(JSON.parse($('#editeur-carte-projet').textContent));
  var desktop = window.matchMedia('(min-width: 761px)');

  // Lieux affichables : ceux qui ont une position
  var feats = project.features.filter(function (f) { return M.hasPosition(project, f); });
  var byUid = new Map(feats.map(function (f) { return [f.uid, f]; }));

  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  var renderer = L.svg({ padding: 0.5 });

  function name(f) { return M.get(project, f, 'name').trim() || 'Sans nom'; }

  // ── Calques ──
  var layers = new Map();
  feats.forEach(function (f) {
    var c = M.colorOf(project, f);
    // Point : disque de la couleur de la catégorie avec son icône blanche (js/icons.js)
    var layer = M.kind(project, f) === 'line'
      ? L.polyline(M.getPath(project, f), { color: c, weight: 6, opacity: .9, lineCap: 'round', renderer: renderer })
      : L.marker(M.getLatLng(project, f), {
        icon: L.divIcon({
          className: 'vw-pin', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12],
          html: '<span class="vw-disc" style="--c:' + S.escape(c) + '">' + Icons.svg(M.iconOf(project, f)) + '</span>'
        }),
        keyboard: false, riseOnHover: true
      });
    layer.bindPopup(function () { return popupHtml(f); }, { maxWidth: 320, autoPanPaddingTopLeft: [24, 90], autoPanPaddingBottomRight: [24, 24] });
    layer.on('click', function () { select(f.uid, false); });
    layer.on('popupclose', function () { if (selected === f.uid) setActive(null); });
    layer.on('add', function () {
      var el = layer.getElement && layer.getElement();
      if (!el) return;
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', name(f));
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(f.uid, false); layer.openPopup(); }
      });
    });
    layers.set(f.uid, layer);
  });

  function popupHtml(f) {
    var cats = M.getCategories(project, f);
    var addr = M.displayAddress(project, f);
    var desc = S.html(M.get(project, f, 'description'));
    var url = S.safeHref(M.get(project, f, 'actionUrl'));
    var text = M.get(project, f, 'actionText') || 'En savoir plus';
    return '<div class="pop" tabindex="-1">' +
      (cats.length ? '<div class="pop-cats">' + cats.map(function (c) {
        return '<span class="pop-cat" style="--c:' + S.escape(project.settings.categoryColors[c] || project.settings.accent) + '">' + S.escape(c) + '</span>';
      }).join('') + '</div>' : '') +
      '<h2>' + S.escape(name(f)) + '</h2>' +
      (addr ? '<p class="pop-addr">' + S.escape(addr) + '</p>' : '') +
      (desc ? '<div class="pop-desc">' + desc + '</div>' : '') +
      (url ? '<a class="pop-btn" href="' + S.escape(url) + '" target="_blank" rel="noopener noreferrer">' + S.escape(text) + '</a>' : '') +
      '</div>';
  }

  // ── Filtres ──
  var activeCat = null, query = '';
  var stats = M.categoryStats(project);
  var chips = $('#chips');
  if (stats.size) {
    var html = '<button type="button" class="chip" data-cat="" aria-pressed="true">Toutes <span class="n">' + feats.length + '</span></button>';
    Array.from(stats.keys()).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).forEach(function (c) {
      html += '<button type="button" class="chip" data-cat="' + S.escape(c) + '" aria-pressed="false">' +
        '<i class="dot dot-icon" style="--c:' + S.escape(project.settings.categoryColors[c] || project.settings.accent) + '" aria-hidden="true">' +
        Icons.svg((project.settings.categoryIcons || {})[c]) + '</i>' +
        '<span class="chip-label">' + S.escape(c) + '</span> <span class="n">' + stats.get(c) + '</span></button>';
    });
    chips.innerHTML = html;
  } else {
    chips.hidden = true;
  }
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    activeCat = b.dataset.cat || null;
    chips.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    render();
  });
  var searchTimer;
  $('#search').addEventListener('input', function (e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { query = e.target.value; render(); }, 120);
  });

  function fold(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var textCache = new Map();
  function haystack(f) {
    if (!textCache.has(f.uid)) {
      textCache.set(f.uid, fold([name(f), M.get(project, f, 'address'), M.getCategories(project, f).join(' '),
        S.text(M.get(project, f, 'description'))].join(' ')));
    }
    return textCache.get(f.uid);
  }

  function visible(f) {
    if (activeCat && M.getCategories(project, f).indexOf(activeCat) === -1) return false;
    if (query.trim()) {
      var words = fold(query).split(/\s+/).filter(Boolean);
      var h = haystack(f);
      return words.every(function (w) { return h.indexOf(w) !== -1; });
    }
    return true;
  }

  function render() {
    var shown = feats.filter(visible);
    layers.forEach(function (layer, uid) {
      var on = shown.indexOf(byUid.get(uid)) !== -1;
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    });
    $('#count').textContent = shown.length + (shown.length > 1 ? ' lieux' : ' lieu');
    var list = $('#list');
    if (!shown.length) {
      list.innerHTML = '<li class="empty">Aucun lieu ne correspond à ces critères.</li>';
      return;
    }
    list.innerHTML = shown.slice().sort(function (a, b) { return name(a).localeCompare(name(b), 'fr'); }).map(function (f) {
      var cats = M.getCategories(project, f);
      var sub = M.displayAddress(project, f) || cats.join(' · ');
      return '<li><button type="button" class="item' + (selected === f.uid ? ' active' : '') + '" data-uid="' + f.uid +
        '" style="--c:' + S.escape(M.colorOf(project, f)) + '"><span class="item-name">' + S.escape(name(f)) + '</span>' +
        (sub ? '<span class="item-sub">' + S.escape(sub) + '</span>' : '') + '</button></li>';
    }).join('');
  }

  // ── Sélection ──
  var selected = null;
  function setActive(uid) {
    selected = uid;
    document.querySelectorAll('.item.active').forEach(function (b) { b.classList.remove('active'); });
    if (uid) {
      var b = document.querySelector('.item[data-uid="' + uid + '"]');
      if (b) { b.classList.add('active'); b.scrollIntoView({ block: 'nearest' }); }
      try { history.replaceState(null, '', '#lieu=' + uid); } catch (e) { /* iframe sandbox */ }
    }
  }

  function select(uid, fly) {
    var f = byUid.get(uid), layer = layers.get(uid);
    if (!f || !layer) return;
    setActive(uid);
    if (!fly) return;
    if (!desktop.matches) setSidebar(false);
    var target = layer.getBounds ? layer.getBounds() : L.latLngBounds([layer.getLatLng()]);
    var opts = { maxZoom: 17, paddingTopLeft: [desktop.matches && sidebarOpen() ? 360 : 24, 100], paddingBottomRight: [24, 24] };
    var opened = false;
    function open() {
      if (opened || selected !== uid) return;
      opened = true;
      if (!map.hasLayer(layer)) layer.addTo(map);
      layer.openPopup(layer.getBounds ? target.getCenter() : undefined);
      var pop = document.querySelector('.leaflet-popup .pop');
      if (pop && usingKeyboard) pop.focus();
    }
    if (reduceMotion.matches) {
      map.fitBounds(target, Object.assign({ animate: false }, opts));
      open();
    } else {
      map.flyToBounds(target, Object.assign({ duration: .6 }, opts));
      map.once('moveend', open);
      setTimeout(open, 1200); // au cas où l'animation est interrompue (onglet en arrière-plan)
    }
  }
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  $('#list').addEventListener('click', function (e) {
    var b = e.target.closest('.item');
    if (b) select(b.dataset.uid, true);
  });

  var usingKeyboard = false;
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab' || e.key === 'Enter') usingKeyboard = true; }, true);
  document.addEventListener('pointerdown', function () { usingKeyboard = false; }, true);

  // ── Panneau ──
  function sidebarOpen() { return document.body.classList.contains('sidebar-open'); }
  function setSidebar(open) {
    document.body.classList.toggle('sidebar-open', open);
    $('#gfSidebarToggle').setAttribute('aria-expanded', String(open));
  }
  $('#gfSidebarToggle').addEventListener('click', function () { setSidebar(!sidebarOpen()); });
  $('#gfSidebarScrim').addEventListener('click', function () { setSidebar(false); });

  function syncHeader() {
    document.documentElement.style.setProperty('--gf-header-h', $('.gf-header').offsetHeight + 'px');
  }
  new ResizeObserver(syncHeader).observe($('.gf-header'));

  // ── Modale « À propos » ──
  var overlay = $('#gfInfoOverlay');
  function closeInfo() { if (overlay.classList.contains('open')) { overlay.classList.remove('open'); $('#gfInfoBtn').focus(); } }
  $('#gfInfoBtn').addEventListener('click', function () { overlay.classList.add('open'); $('#gfInfoClose').focus(); });
  $('#gfInfoClose').addEventListener('click', closeInfo);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeInfo(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (overlay.classList.contains('open')) closeInfo();
    else if (!desktop.matches && sidebarOpen()) setSidebar(false);
  });

  // ── Démarrage ──
  setSidebar(desktop.matches && window.innerHeight > 420);
  syncHeader();
  render();
  var analysis = M.analyse(project);
  var core = feats.filter(function (f) { return analysis.issues.get(f.uid) !== 'loin'; });
  var bounds = L.latLngBounds([]);
  (core.length ? core : feats).forEach(function (f) {
    var l = layers.get(f.uid);
    bounds.extend(l.getBounds ? l.getBounds() : l.getLatLng());
  });
  if (bounds.isValid()) {
    map.fitBounds(bounds, { paddingTopLeft: [sidebarOpen() ? 360 : 30, 90], paddingBottomRight: [30, 30], maxZoom: 16 });
  } else {
    map.setView([45.5088, -73.5878], 11);
  }
  var m = /lieu=([\w-]+)/.exec(location.hash);
  if (m && byUid.has(m[1])) select(m[1], true);
})();
