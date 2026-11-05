/* Éditeur de carte : interface.
   Dépend de Leaflet, CSV, Sanitize, Model, Store et ExportHtml (chargés avant). */
(function () {
  'use strict';
  var M = window.Model, S = window.Sanitize;
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };
  var desktopMQ = window.matchMedia('(min-width: 761px)');

  // ── État ──
  var project = null;
  var analysis = { issues: new Map() };
  var selectedUid = null;
  var mode = null;            // { type: 'add-point' | 'add-line' | 'add-area' | 'place' | 'extend' | 'attach', uid?, path? }
  var filter = { key: 'all', query: '' };
  var history = [];
  var MAX_HISTORY = 60;
  var layers = new Map();     // uid → marqueur ou polyligne
  var vertexHandles = [];
  var draft = null;           // polyligne en cours de tracé (segments déjà posés, trait plein)
  var ghost = null;           // aperçu en pointillé jusqu'au curseur (comme l'outil Mesurer de Google Maps)
  var ghostTip = null;        // longueur ou superficie si on cliquait au curseur
  var lastCursor = null;

  var ROLE_FIELDS = ['id', 'name', 'description', 'categories', 'address', 'lat', 'lng', 'actionText', 'actionUrl', 'geometry', 'parent'];
  var ISSUE_LABEL = { 'sans-position': 'Sans position', 'loin': 'À vérifier', 'sans-nom': 'Sans nom' };

  // ── Carte ──
  var map = L.map('map', { zoomControl: false, doubleClickZoom: true, boxZoom: false }).setView([45.5088, -73.5878], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  var featureGroup = L.layerGroup().addTo(map);
  var handleGroup = L.layerGroup().addTo(map);

  // ── Utilitaires ──
  function name(f) { return M.get(project, f, 'name').trim(); }
  function byUid(uid) { return project && project.features.find(function (f) { return f.uid === uid; }); }
  function fold(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function fmtNum(n) { return n.toLocaleString('fr-CA'); }
  function slug(s) {
    return fold(s || 'carte').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'carte';
  }
  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function isTyping(el) {
    el = el || document.activeElement;
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  // ── Notification ──
  var toastTimer;
  function toast(text, opts) {
    opts = opts || {};
    var el = $('#toast'), btn = $('#toast-action');
    $('#toast-text').textContent = text;
    el.dataset.tone = opts.tone || '';
    btn.hidden = !opts.action;
    if (opts.action) {
      btn.textContent = opts.action.label;
      btn.onclick = function () { el.classList.remove('show'); opts.action.run(); };
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, opts.duration || (opts.action ? 7000 : 3200));
  }

  // ── Historique (annuler) ──
  function snapshot() {
    return JSON.stringify({
      title: project.title, about: project.about, columns: project.columns, roles: project.roles,
      settings: project.settings, features: project.features
    });
  }
  function pushHistory(snap) {
    history.push(snap || snapshot());
    if (history.length > MAX_HISTORY) history.shift();
    $('#btn-undo').disabled = false;
  }
  function undo() {
    if (!history.length || !project) return;
    cancelMode();
    var s = JSON.parse(history.pop());
    Object.keys(s).forEach(function (k) { project[k] = s[k]; });
    fieldSnap = null; fieldDirty = false;
    $('#btn-undo').disabled = !history.length;
    touch();
    refreshAll();
    if (selectedUid && byUid(selectedUid)) select(selectedUid, { fly: false });
    else deselect();
    toast('Modification annulée');
  }

  // Applique une modification : historique, sauvegarde, rafraîchissement
  function mutate(fn, scope) {
    pushHistory();
    fn();
    touch();
    refresh(scope || {});
  }

  // ── Sauvegarde automatique ──
  var saveFailed = false;
  function setStatus(t) { $('#save-status').textContent = t; }
  var saveSoon = debounce(function () {
    if (!project) return;
    Store.save(project).then(function () {
      setStatus('enregistrée');
      saveFailed = false;
    }).catch(function () {
      setStatus('non enregistrée');
      if (!saveFailed) toast("Impossible d'enregistrer dans ce navigateur. Téléchargez le fichier de projet pour ne rien perdre.", { tone: 'error', duration: 8000 });
      saveFailed = true;
    });
  }, 500);
  function touch() {
    project.updatedAt = new Date().toISOString();
    setStatus('enregistrement…');
    saveSoon();
  }

  // ── Rendu ──
  function refresh(scope) {
    analysis = M.analyse(project);
    if (scope.all) return refreshAll();
    if (scope.uid) {
      updateLayer(scope.uid);
      // Les lignes rattachées à ce point prennent sa couleur : on les redessine aussi
      var sf = byUid(scope.uid);
      if (sf && M.kind(project, sf) === 'point') M.childrenOf(project, sf).forEach(function (c) { updateLayer(c.uid); });
    }
    if (scope.layers) rebuildLayers();
    refreshFilters();
    refreshList();
    refreshHeader();
  }

  function refreshAll() {
    analysis = M.analyse(project);
    M.assignColors(project);
    rebuildLayers();
    refreshFilters();
    refreshList();
    refreshHeader();
  }

  function refreshHeader() {
    $('#project-name').textContent = project ? project.title : 'Aucune carte';
    document.title = project ? project.title + ' · Éditeur de carte' : 'Éditeur de carte';
    $('#btn-publish').disabled = !project;
  }

  function markerIcon(f, selected) {
    var issue = analysis.issues.get(f.uid);
    return L.divIcon({
      className: 'ed-marker' + (issue === 'loin' ? ' issue' : '') + (selected ? ' selected' : ''),
      html: '<span class="ed-dot" style="--c:' + S.escape(M.colorOf(project, f)) + '">' + Icons.svg(M.iconOf(project, f)) + '</span>',
      iconSize: [26, 26], iconAnchor: [13, 13]
    });
  }

  function makeLayer(f) {
    var layer, selected = f.uid === selectedUid;
    var k = M.kind(project, f);
    if (k === 'area') {
      layer = L.polygon(M.getPath(project, f), {
        color: M.colorOf(project, f), weight: selected ? 4 : 2.5, opacity: 1, lineJoin: 'round',
        fillColor: M.colorOf(project, f), fillOpacity: selected ? .35 : .22, bubblingMouseEvents: false
      });
    } else if (k === 'line') {
      layer = L.polyline(M.getPath(project, f), {
        color: M.colorOf(project, f), weight: selected ? 7 : 5, opacity: selected ? 1 : .85, lineCap: 'round',
        bubblingMouseEvents: false
      });
    } else {
      var ll = M.getLatLng(project, f);
      if (!ll) return null;
      layer = L.marker(ll, { icon: markerIcon(f, selected), draggable: selected, keyboard: true, riseOnHover: true });
      layer.on('add', function () {
        var el = layer.getElement();
        if (el) { el.setAttribute('role', 'button'); el.setAttribute('aria-label', name(f) || 'Sans nom'); }
      });
      layer.on('dragstart', function () { layer._snap = snapshot(); });
      layer.on('dragend', function () {
        var p = layer.getLatLng();
        pushHistory(layer._snap);
        M.setLatLng(project, f, [p.lat, p.lng]);
        touch();
        refresh({});
        fillPosition(f);
      });
    }
    layer.bindTooltip(S.escape(name(f) || 'Sans nom'), { className: 'ed-tooltip', direction: 'top', offset: [0, -13] });
    layer.on('click', function (e) {
      // Rattacher une ligne : le clic sur un point le choisit
      if (mode && mode.type === 'attach') {
        if (M.kind(project, f) !== 'point') { toast('Choisissez un point, pas une ligne ou une zone.'); return; }
        var lineUid = mode.uid;
        cancelMode();
        attachLine(lineUid, f.uid);
        return;
      }
      // Pendant un ajout ou un tracé, un clic sur un lieu existant compte comme un clic sur la carte
      if (mode) { map.fire('click', { latlng: e.latlng }); return; }
      select(f.uid, { fly: false, from: 'map' });
    });
    layer.on('keypress', function (e) {
      if (e.originalEvent.key === 'Enter') select(f.uid, { fly: false, from: 'map' });
    });
    return layer;
  }

  function rebuildLayers() {
    featureGroup.clearLayers();
    layers.clear();
    project.features.forEach(function (f) {
      var layer = makeLayer(f);
      if (layer) layers.set(f.uid, layer);
    });
    applyVisibility();
    if (selectedUid) showHandles(byUid(selectedUid));
  }

  function updateLayer(uid) {
    var old = layers.get(uid);
    if (old) { featureGroup.removeLayer(old); layers.delete(uid); }
    var f = byUid(uid);
    if (!f) return;
    var layer = makeLayer(f);
    if (layer) { layers.set(uid, layer); if (matches(f)) featureGroup.addLayer(layer); }
  }

  function matches(f) {
    var k = filter.key;
    if (k === 'issues' && !analysis.issues.has(f.uid)) return false;
    if (k === 'lines' && M.kind(project, f) !== 'line') return false;
    if (k === 'areas' && M.kind(project, f) !== 'area') return false;
    if (k.indexOf('cat:') === 0 && M.getCategories(project, f).indexOf(k.slice(4)) === -1) return false;
    if (filter.query.trim()) {
      var hay = fold([name(f), M.get(project, f, 'address'), M.get(project, f, 'categories')].join(' '));
      return fold(filter.query).split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) !== -1; });
    }
    return true;
  }

  function applyVisibility() {
    layers.forEach(function (layer, uid) {
      var f = byUid(uid);
      var on = f && (matches(f) || uid === selectedUid);
      if (on && !featureGroup.hasLayer(layer)) featureGroup.addLayer(layer);
      if (!on && featureGroup.hasLayer(layer)) featureGroup.removeLayer(layer);
    });
  }

  function refreshFilters() {
    var stats = M.categoryStats(project);
    var lines = project.features.filter(function (f) { return M.kind(project, f) === 'line'; }).length;
    var areas = project.features.filter(function (f) { return M.kind(project, f) === 'area'; }).length;
    var chips = [{ key: 'all', label: 'Tous', n: project.features.length }];
    if (analysis.issues.size) chips.push({ key: 'issues', label: 'À vérifier', n: analysis.issues.size, warn: true });
    if (lines) chips.push({ key: 'lines', label: 'Lignes', n: lines });
    if (areas) chips.push({ key: 'areas', label: 'Zones', n: areas });
    Array.from(stats.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'fr'); }).forEach(function (e) {
      chips.push({ key: 'cat:' + e[0], label: e[0], n: e[1], color: project.settings.categoryColors[e[0]] });
    });
    if (!chips.some(function (c) { return c.key === filter.key; })) filter.key = 'all';
    $('#filters').innerHTML = chips.map(function (c) {
      return '<button type="button" class="chip' + (c.warn ? ' warn' : '') + '" data-key="' + S.escape(c.key) + '" aria-pressed="' + (c.key === filter.key) + '">' +
        (c.color ? '<i class="dot" style="--c:' + S.escape(c.color) + '" aria-hidden="true"></i>' : '') +
        '<span class="chip-label">' + S.escape(c.label) + '</span> <span class="n">' + c.n + '</span></button>';
    }).join('');
    $('#cat-options').innerHTML = Array.from(stats.keys()).sort(function (a, b) { return a.localeCompare(b, 'fr'); })
      .map(function (c) { return '<option value="' + S.escape(c) + '">'; }).join('');
  }

  function refreshList() {
    var shown = project.features.filter(matches);
    $('#list-count').textContent = '· ' + (shown.length === project.features.length ? fmtNum(shown.length) : fmtNum(shown.length) + ' sur ' + fmtNum(project.features.length));
    $('#list-status').textContent = plural(shown.length, 'lieu affiché', 'lieux affichés');
    applyVisibility();
    var list = $('#feature-list');
    if (!project.features.length) {
      list.innerHTML = '<li class="empty-state"><p>Aucun lieu pour l\'instant.</p><p>Ajoutez un point ou une ligne, ou importez un fichier CSV.</p></li>';
      return;
    }
    if (!shown.length) {
      list.innerHTML = '<li class="empty-state"><p>Aucun lieu ne correspond.</p><button type="button" class="gf-btn gf-btn-ghost small" data-reset>Afficher tous les lieux</button></li>';
      return;
    }
    list.innerHTML = shown.map(function (f) {
      var n = name(f), issue = analysis.issues.get(f.uid), k = M.kind(project, f), line = k !== 'point';
      var kindLabel = { line: 'Ligne', area: 'Zone' }[k];
      var cats = M.getCategories(project, f);
      var parent = line ? M.getParent(project, f) : null;
      var sub = parent
        ? kindLabel + ' rattachée à « ' + (name(parent) || 'Sans nom') + ' »'
        : [kindLabel || '', cats[0] || '', M.displayAddress(project, f)].filter(Boolean).join(' · ');
      return '<li><button type="button" class="item' + (line ? ' line' : '') + (f.uid === selectedUid ? ' active' : '') +
        '" data-uid="' + f.uid + '" style="--c:' + S.escape(M.colorOf(project, f)) + '">' +
        '<span class="item-main"><span class="item-name' + (n ? '' : ' empty') + '">' + S.escape(n || 'Sans nom') + '</span>' +
        (sub ? '<span class="item-sub">' + S.escape(sub) + '</span>' : '') + '</span>' +
        (issue && issue !== 'sans-nom' ? '<span class="flag">' + ISSUE_LABEL[issue] + '</span>' : '') +
        '</button></li>';
    }).join('');
  }

  // ── Panneaux ──
  function showPanel(id) {
    ['welcome', 'list', 'edit'].forEach(function (p) { $('#panel-' + p).hidden = p !== id; });
  }

  // ── Zone visible de la carte (hors bandeau et panneau) ──
  function sidebarDocked() { return desktopMQ.matches && !document.body.classList.contains('gf-sidebar-collapsed'); }
  function visiblePadding() {
    var header = $('.gf-header');
    var top = header.getBoundingClientRect().bottom + 16;
    var left = sidebarDocked() ? $('#gfSidebar').getBoundingClientRect().right + 16 : 24;
    return { tl: L.point(left, top), br: L.point(24, 24) };
  }
  function fitTo(bounds, maxZoom) {
    if (!bounds || !bounds.isValid()) return;
    var p = visiblePadding();
    map.fitBounds(bounds, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: maxZoom || 16 });
  }
  function featureBounds(f) {
    if (M.isShape(project, f)) return L.latLngBounds(M.getPath(project, f));
    var ll = M.getLatLng(project, f);
    return ll ? L.latLngBounds([ll, ll]) : null;
  }
  function fitProject() {
    var b = L.latLngBounds([]);
    project.features.forEach(function (f) {
      if (analysis.issues.get(f.uid) === 'loin') return;
      var fb = featureBounds(f);
      if (fb) b.extend(fb);
    });
    if (b.isValid()) fitTo(b, 16);
  }
  function flyToFeature(f) {
    var b = featureBounds(f);
    if (!b) return;
    var p = visiblePadding();
    var z = M.isShape(project, f) ? Math.min(map.getBoundsZoom(b, false, p.tl.add(p.br)), 17) : Math.max(map.getZoom(), 16);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      map.fitBounds(b, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: z, animate: false });
    } else {
      map.flyToBounds(b, { paddingTopLeft: p.tl, paddingBottomRight: p.br, maxZoom: z, duration: .5 });
    }
  }

  // ── Sélection ──
  function select(uid, opts) {
    opts = opts || {};
    var f = byUid(uid);
    if (!f) return;
    var prev = selectedUid;
    selectedUid = uid;
    if (prev && prev !== uid) updateLayer(prev);
    updateLayer(uid);
    showHandles(f);
    $$('.item.active').forEach(function (b) { b.classList.remove('active'); });
    fillForm(f);
    showPanel('edit');
    $('#panel-edit').scrollTop = 0;
    if (!desktopMQ.matches && opts.from === 'map') setSidebarOpenMobile(true);
    if (opts.fly !== false) flyToFeature(f);
  }

  function deselect() {
    var prev = selectedUid;
    selectedUid = null;
    clearHandles();
    if (prev && project) updateLayer(prev);
    if (project) {
      showPanel('list');
      refreshList();
      var item = $('.item[data-uid="' + prev + '"]');
      if (item) { item.classList.add('active'); item.scrollIntoView({ block: 'nearest' }); }
    }
  }

  // Poignées des sommets de la ligne sélectionnée
  function clearHandles() { handleGroup.clearLayers(); vertexHandles = []; }
  function showHandles(f) {
    clearHandles();
    if (!f || !M.isShape(project, f)) return;
    var path = M.getPath(project, f);
    var color = M.colorOf(project, f);
    // Le calque de la ligne peut être recréé pendant l'édition : toujours relire le courant
    var lineLayer = function () { return layers.get(f.uid); };
    path.forEach(function (ll, i) {
      var h = L.marker(ll, {
        draggable: true, keyboard: true, title: 'Sommet ' + (i + 1) + ' (glisser pour déplacer, clic droit pour retirer)',
        icon: L.divIcon({ className: 'ed-vertex', html: '<span style="--c:' + S.escape(color) + '"></span>', iconSize: [14, 14], iconAnchor: [7, 7] })
      });
      h.on('dragstart', function () { h._snap = snapshot(); });
      h.on('drag', function () {
        var line = lineLayer();
        if (!line) return;
        var pts = line.getLatLngs();
        var ring = Array.isArray(pts[0]) ? pts[0] : pts; // zone (polygone) : un anneau imbriqué
        ring[i] = h.getLatLng();
        line.setLatLngs(pts);
      });
      h.on('dragend', function () {
        var cur = M.getPath(project, f);
        var p = h.getLatLng();
        cur[i] = [p.lat, p.lng];
        pushHistory(h._snap);
        M.setPath(project, f, cur);
        touch();
        refresh({});
        fillPosition(f);
      });
      h.on('contextmenu', function (e) {
        L.DomEvent.preventDefault(e.originalEvent);
        var cur = M.getPath(project, f);
        var minPts = M.kind(project, f) === 'area' ? 3 : 2;
        if (cur.length <= minPts) { toast(minPts === 3 ? 'Une zone garde au moins trois sommets.' : 'Une ligne garde au moins deux sommets.'); return; }
        mutate(function () { cur.splice(i, 1); M.setPath(project, f, cur); }, { uid: f.uid });
        showHandles(f);
        fillPosition(f);
      });
      handleGroup.addLayer(h);
      vertexHandles.push(h);
    });
  }

  // ── Fiche d'un lieu ──
  function otherColumns() {
    var used = {};
    ROLE_FIELDS.forEach(function (r) { if (project.roles[r]) used[project.roles[r]] = 1; });
    return project.columns.filter(function (c) { return !used[c]; });
  }

  function fillForm(f) {
    var badge = $('#edit-kind');
    badge.textContent = { line: 'Ligne', area: 'Zone', point: 'Point' }[M.kind(project, f)];
    badge.style.setProperty('--c', M.colorOf(project, f));

    var issue = analysis.issues.get(f.uid), note = $('#edit-issue');
    note.hidden = !issue || issue === 'sans-nom';
    if (issue === 'sans-position') note.textContent = "Ce lieu n'a pas de position dans le fichier : il n'apparaîtra pas sur la carte publiée. Utilisez « Placer sur la carte ».";
    if (issue === 'loin') note.textContent = 'Ce lieu est à plus de 100 km des autres. Sa position vient peut-être d\'une adresse mal géocodée : vérifiez-la.';

    $$('#edit-form [data-role]').forEach(function (input) { input.value = M.get(project, f, input.dataset.role); });
    fillCats(f);
    var raw = M.get(project, f, 'description');
    $('#f-desc').innerHTML = S.html(raw);
    $('#f-desc-code').value = raw;
    setSourceMode(false);
    fillPosition(f);
    fillAttach(f);

    var others = otherColumns();
    $('#other-fields').hidden = !others.length;
    $('#other-fields-list').innerHTML = others.map(function (c, i) {
      return '<label><code>' + S.escape(c) + '</code><input type="text" data-col="' + S.escape(c) + '" value="' + S.escape(f.row[c] || '') + '"></label>';
    }).join('');
    var idCol = project.roles.id;
    if (idCol) {
      $('#other-fields-list').insertAdjacentHTML('afterbegin',
        '<label><code>' + S.escape(idCol) + '</code><input type="text" data-col="' + S.escape(idCol) + '" value="' + S.escape(f.row[idCol] || '') + '"></label>');
      $('#other-fields').hidden = false;
    }
  }

  function fillPosition(f) {
    var k = M.kind(project, f), line = k !== 'point';
    var txt;
    if (k === 'area') {
      var ring = M.getPath(project, f), m2 = M.areaM2(ring);
      txt = plural(ring.length, 'sommet', 'sommets') + ' · environ ' +
        (m2 < 10000 ? fmtNum(Math.round(m2)) + ' m²' : (m2 / 10000).toFixed(2).replace('.', ',') + ' ha');
    } else if (k === 'line') {
      var path = M.getPath(project, f), km = 0;
      for (var i = 1; i < path.length; i++) km += M.distanceKm(path[i - 1], path[i]);
      txt = plural(path.length, 'sommet', 'sommets') + ' · ' + (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(2).replace('.', ',') + ' km');
    } else {
      var ll = M.getLatLng(project, f);
      txt = ll ? ll[0].toFixed(6) + ', ' + ll[1].toFixed(6) + ' · glissez le point pour le déplacer' : 'Aucune position';
    }
    $('#position-text').textContent = txt;
    $('#btn-place').hidden = line;
    $('#btn-place').textContent = M.getLatLng(project, f) ? 'Placer ailleurs' : 'Placer sur la carte';
    $('#btn-zoom').hidden = !M.hasPosition(project, f);
    $('#btn-extend').hidden = !line;
    $('#btn-extend').textContent = k === 'area' ? 'Ajouter des sommets' : 'Prolonger la ligne';
  }

  // Ligne ou zone : lieu rattaché (choix sur la carte ou dans la liste). Point : ses tracés rattachés.
  function fillAttach(f) {
    var k = M.kind(project, f), line = k !== 'point';
    $('#attach-field').hidden = !line;
    var kids = line ? [] : M.childrenOf(project, f);
    $('#children-field').hidden = !kids.length;
    $('#children-list').innerHTML = kids.map(function (c) {
      var ck = M.kind(project, c) === 'area' ? 'Zone' : 'Ligne';
      return '<li><button type="button" data-goto="' + c.uid + '">' + ck + ' : ' + S.escape(name(c) || 'sans nom') + '</button></li>';
    }).join('');
    if (!line) return;
    var parent = M.getParent(project, f);
    $('#attach-text').textContent = parent
      ? 'Rattachée à « ' + (name(parent) || 'Sans nom') + ' ». Elle en prend la couleur et, sur la carte publiée, ouvre sa fiche.'
      : 'Aucun. Rattachez ' + (k === 'area' ? 'la zone' : 'la ligne') + ' à un point pour qu\'elle en prenne la couleur et ouvre sa fiche sur la carte publiée.';
    $('#btn-attach').textContent = parent ? 'Choisir un autre point' : 'Choisir un point sur la carte';
    $('#btn-goto-parent').hidden = !parent;
    $('#btn-detach').hidden = !parent;
    var points = project.features.filter(function (g) { return M.kind(project, g) === 'point' && M.getLatLng(project, g); })
      .sort(function (a, b) { return (name(a) || '~').localeCompare(name(b) || '~', 'fr'); });
    $('#f-parent').innerHTML = '<option value="">Aucun</option>' + points.map(function (g) {
      return '<option value="' + g.uid + '"' + (g === parent ? ' selected' : '') + '>' + S.escape(name(g) || 'Sans nom') + '</option>';
    }).join('');
  }

  function attachLine(lineUid, pointUid) {
    var f = byUid(lineUid), g = pointUid ? byUid(pointUid) : null;
    if (!f) return;
    mutate(function () { M.setParent(project, f, g); }, { uid: f.uid });
    select(f.uid, { fly: false });
    var what = M.kind(project, f) === 'area' ? 'Zone' : 'Ligne';
    toast(g ? what + ' rattachée à « ' + (name(g) || 'Sans nom') + ' ».' : what + ' détachée.', { tone: 'success' });
  }

  function fillCats(f) {
    var cats = M.getCategories(project, f);
    $('#cat-chips').innerHTML = cats.map(function (c, i) {
      return '<li class="cat-chip" style="--c:' + S.escape(project.settings.categoryColors[c] || project.settings.accent) + '">' + S.escape(c) +
        '<button type="button" data-remove-cat="' + i + '" aria-label="Retirer ' + S.escape(c) + '">✕</button></li>';
    }).join('');
  }

  function addCategory(value) {
    var f = byUid(selectedUid);
    value = value.replace(new RegExp(M.CAT_SEP, 'g'), ' ').trim();
    if (!f || !value) return;
    var cats = M.getCategories(project, f);
    if (cats.indexOf(value) !== -1) return;
    mutate(function () {
      cats.push(value);
      M.setCategories(project, f, cats);
      M.assignColors(project);
    }, { uid: f.uid });
    fillCats(f);
    $('#edit-kind').style.setProperty('--c', M.colorOf(project, f));
  }

  // Une seule entrée d'historique par session de saisie dans un champ
  var fieldSnap = null, fieldDirty = false;
  function beginField() { fieldSnap = snapshot(); fieldDirty = false; }
  function fieldChanged() {
    if (!fieldDirty) { pushHistory(fieldSnap || snapshot()); fieldDirty = true; }
    touch();
  }
  var refreshSoon = debounce(function () {
    if (!project) return;
    analysis = M.analyse(project);
    if (selectedUid) updateLayer(selectedUid);
    refreshFilters();
    refreshList();
  }, 300);

  function writeDescriptionFromEditor() {
    var f = byUid(selectedUid);
    if (!f) return;
    M.set(project, f, 'description', S.html($('#f-desc').innerHTML));
    $('#f-desc-code').value = M.get(project, f, 'description');
    fieldChanged();
  }

  function setSourceMode(on) {
    $('#rte-source').setAttribute('aria-pressed', String(on));
    $('#f-desc').hidden = on;
    $('#f-desc-code').hidden = !on;
    $$('.rte-bar [data-cmd]').forEach(function (b) { b.disabled = on; });
  }

  // ── Modes : ajouter un point, tracer une ligne, placer, prolonger ──
  function setMode(m) {
    cancelMode(true);
    mode = m;
    document.body.classList.add('placing');
    var text = {
      'add-point': 'Cliquez sur la carte pour placer le nouveau point.',
      'add-line': 'Cliquez pour ajouter des sommets. Double-clic ou Entrée pour terminer.',
      'place': 'Cliquez sur la carte pour placer ce lieu.',
      'extend': 'Cliquez pour ajouter des sommets au bout de la ligne.',
      'add-area': 'Cliquez pour placer les sommets de la zone. Double-clic ou Entrée pour la fermer.',
      'attach': 'Cliquez sur le point auquel rattacher ce tracé.'
    }[m.type];
    $('#mode-text').textContent = text;
    var drawing = m.type === 'add-line' || m.type === 'add-area' || m.type === 'extend';
    $('#mode-finish').hidden = !drawing;
    $('#mode-finish').textContent = { extend: 'Terminer', 'add-area': 'Fermer la zone' }[m.type] || 'Terminer la ligne';
    $('#mode-bar').hidden = false;
    if (drawing) {
      map.doubleClickZoom.disable();
      var base = m.type === 'extend' ? M.getPath(project, byUid(m.uid)) : [];
      m.path = base.slice();
      m.start = base.length;
      var areaDraft = m.type === 'add-area' || (m.type === 'extend' && M.kind(project, byUid(m.uid)) === 'area');
      draft = (areaDraft ? L.polygon : L.polyline)(m.path, {
        color: project.settings.accent, weight: 4, interactive: false,
        fillColor: project.settings.accent, fillOpacity: areaDraft ? .15 : 0
      }).addTo(map);
      m.area = areaDraft;
      ghost = L.polyline([], { color: project.settings.accent, weight: 3, opacity: .85, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(map);
      ghostTip = L.tooltip({ permanent: true, direction: 'right', offset: [14, 0], className: 'ed-tooltip ed-measure', interactive: false });
    }
    if (!desktopMQ.matches) setSidebarOpenMobile(false);
    updateFinishState();
  }

  // Aperçu pendant un tracé : pointillé du dernier sommet jusqu'au curseur (et, pour une zone,
  // du curseur jusqu'au premier sommet), avec la longueur ou la superficie qu'on obtiendrait.
  function updateGhost() {
    if (!ghost || !mode || !mode.path) return;
    var path = mode.path, cur = lastCursor;
    if (!cur || !path.length) {
      ghost.setLatLngs([]);
      if (ghostTip) map.removeLayer(ghostTip);
      return;
    }
    var last = path[path.length - 1];
    ghost.setLatLngs(mode.area && path.length >= 2 ? [last, cur, path[0]] : [last, cur]);
    var txt;
    if (mode.area) {
      if (path.length < 2) { txt = ''; }
      else {
        var m2 = M.areaM2(path.concat([cur]));
        txt = m2 < 10000 ? fmtNum(Math.round(m2)) + ' m²' : (m2 / 10000).toFixed(2).replace('.', ',') + ' ha';
      }
    } else {
      var km = M.distanceKm(last, cur);
      for (var i = 1; i < path.length; i++) km += M.distanceKm(path[i - 1], path[i]);
      txt = km < 1 ? fmtNum(Math.round(km * 1000)) + ' m' : km.toFixed(2).replace('.', ',') + ' km';
    }
    if (!txt) { map.removeLayer(ghostTip); return; }
    ghostTip.setLatLng(cur).setContent(txt);
    if (!map.hasLayer(ghostTip)) ghostTip.addTo(map);
  }

  map.on('mousemove', function (e) {
    if (!mode || !mode.path) return;
    lastCursor = [e.latlng.lat, e.latlng.lng];
    updateGhost();
  });
  map.on('mouseout', function () {
    if (!mode || !mode.path) return;
    lastCursor = null;
    updateGhost();
  });

  function updateFinishState() {
    if (!mode || !mode.path) return;
    $('#mode-finish').disabled = mode.path.length - (mode.start || 0) < ({ extend: 1, 'add-area': 3 }[mode.type] || 2);
  }

  function cancelMode(silent) {
    if (!mode) return;
    mode = null;
    document.body.classList.remove('placing');
    $('#mode-bar').hidden = true;
    if (draft) { map.removeLayer(draft); draft = null; }
    if (ghost) { map.removeLayer(ghost); ghost = null; }
    if (ghostTip) { map.removeLayer(ghostTip); ghostTip = null; }
    lastCursor = null;
    map.doubleClickZoom.enable();
  }

  function finishLine() {
    if (!mode || !mode.path) return;
    var m = mode, path = m.path.slice();
    if (m.type === 'add-line' || m.type === 'add-area') {
      var area = m.type === 'add-area';
      if (path.length < (area ? 3 : 2)) { toast(area ? 'Une zone a au moins trois sommets.' : 'Une ligne a au moins deux sommets.'); return; }
      cancelMode();
      var f;
      mutate(function () { f = M.newFeature(project, area ? 'area' : 'line', path); project.features.push(f); }, { layers: true });
      select(f.uid, { fly: false });
      $('#f-name').focus();
      toast(area ? 'Zone ajoutée.' : 'Ligne ajoutée.', { action: { label: 'Rattacher à un point', run: function () { setMode({ type: 'attach', uid: f.uid }); } } });
    } else {
      cancelMode();
      var g = byUid(m.uid);
      if (path.length > m.start) mutate(function () { M.setPath(project, g, path); }, { uid: g.uid });
      select(g.uid, { fly: false });
    }
  }

  map.on('click', function (e) {
    if (!project) return;
    var ll = [e.latlng.lat, e.latlng.lng];
    if (!mode) { if (selectedUid) deselect(); return; }
    if (mode.type === 'attach') { toast('Cliquez sur un point existant (ou Échap pour annuler).'); return; }
    if (mode.type === 'add-point') {
      cancelMode();
      var f;
      mutate(function () { f = M.newFeature(project, 'point', ll); project.features.push(f); }, { layers: true });
      select(f.uid, { fly: false });
      setSidebarOpenMobile(true);
      $('#f-name').focus();
    } else if (mode.type === 'place') {
      var g = byUid(mode.uid);
      cancelMode();
      mutate(function () { M.setLatLng(project, g, ll); }, { uid: g.uid });
      select(g.uid, { fly: false });
      toast('Lieu placé. Glissez-le pour ajuster.', { tone: 'success' });
    } else if (mode.path) {
      // Un double-clic envoie aussi deux clics : on ignore un sommet identique au précédent
      var last = mode.path[mode.path.length - 1];
      if (last && Math.abs(last[0] - ll[0]) < 1e-9 && Math.abs(last[1] - ll[1]) < 1e-9) return;
      mode.path.push(ll);
      draft.setLatLngs(mode.path);
      updateGhost();
      updateFinishState();
    }
  });
  map.on('dblclick', function () {
    if (mode && mode.path) setTimeout(finishLine, 0);
  });

  // ── Import ──
  function readFile(file) {
    return file.arrayBuffer().then(function (buf) {
      var text = new TextDecoder('utf-8').decode(buf);
      // Fichier enregistré par Excel en Windows-1252 : caractères de remplacement en UTF-8
      if (text.indexOf('�') !== -1) {
        try { text = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* garde l'UTF-8 */ }
      }
      return text;
    });
  }

  function importFile(file) {
    if (!file) return;
    readFile(file).then(function (text) {
      var lower = file.name.toLowerCase();
      var trimmed = text.trim();
      if (lower.endsWith('.json') || trimmed[0] === '{') {
        return openImportedProject(M.revive(JSON.parse(trimmed)));
      }
      if (/\.html?$/.test(lower) || /^<!doctype html|^<html/i.test(trimmed)) {
        return openImportedProject(M.revive(ExportHtml.extractProject(text)));
      }
      var parsed = CSV.parse(text);
      if (!parsed.header.length || parsed.header.length < 2) throw new Error("Ce fichier ne ressemble pas à un CSV : une seule colonne trouvée.");
      var p = M.projectFromCsv(parsed, file.name);
      openProject(p, { fresh: true });
      showReport(p);
    }).catch(function (err) {
      console.error(err);
      toast('Import impossible : ' + (err.message || 'fichier illisible.'), { tone: 'error', duration: 8000 });
    });
  }

  function openImportedProject(p) {
    return Store.load(p.id).catch(function () { return null; }).then(function (existing) {
      if (existing && !confirm('« ' + existing.title + ' » est déjà enregistrée dans ce navigateur.\n\nOK : remplacer la version enregistrée.\nAnnuler : ouvrir le fichier comme une nouvelle copie.')) {
        p.id = M.uid();
        p.title = p.title + ' (copie)';
      }
      openProject(p, { fresh: true });
      toast('Carte « ' + p.title + ' » ouverte.', { tone: 'success' });
    });
  }

  function showReport(p) {
    var total = p.features.length;
    var lines = 0, areas = 0, noPos = [], far = [], noName = 0;
    p.features.forEach(function (f) {
      if (M.kind(p, f) === 'line') lines++;
      if (M.kind(p, f) === 'area') areas++;
      var issue = analysis.issues.get(f.uid);
      if (issue === 'sans-position') noPos.push(f);
      if (issue === 'loin') far.push(f);
      if (!M.get(p, f, 'name').trim()) noName++;
    });
    var points = total - lines - areas - noPos.length;
    var cats = M.categoryStats(p).size;
    var roleNames = { name: 'nom', description: 'description', categories: 'catégories', address: 'adresse', lat: 'latitude', lng: 'longitude', actionText: 'texte du lien', actionUrl: 'lien', geometry: 'ligne ou zone (WKT)', id: 'identifiant' };
    var recognised = Object.keys(roleNames).filter(function (r) { return p.roles[r]; })
      .map(function (r) { return '<code>' + S.escape(p.roles[r]) + '</code> → ' + roleNames[r]; });
    var listNames = function (arr) {
      var names = arr.slice(0, 5).map(function (f) { return '« ' + S.escape(M.get(p, f, 'name') || 'sans nom') + ' »'; });
      return names.join(', ') + (arr.length > 5 ? ', …' : '');
    };
    var html = '<ul class="report-list">' +
      '<li><strong>' + fmtNum(total) + '</strong> lignes lues dans « ' + S.escape(p.source.fileName || '') + ' »</li>' +
      '<li><strong>' + fmtNum(points) + '</strong> points' + (lines ? ', <strong>' + lines + '</strong> lignes' : '') + (areas ? ', <strong>' + areas + '</strong> zones' : '') + ' placés sur la carte</li>' +
      (cats ? '<li><strong>' + cats + '</strong> catégories</li>' : '') +
      (noPos.length ? '<li><strong>' + noPos.length + '</strong> sans position : ' + listNames(noPos) + '. Filtre « À vérifier » pour les placer.</li>' : '') +
      (far.length ? '<li><strong>' + far.length + '</strong> à plus de 100 km des autres (adresse sans doute mal géocodée) : ' + listNames(far) + '.</li>' : '') +
      (noName ? '<li><strong>' + noName + '</strong> sans nom</li>' : '') +
      '</ul>' +
      (!p.roles.lat && !p.roles.geometry ? '<p class="issue-note">Aucune colonne de position reconnue (latitude/longitude ou geometry).</p>' : '') +
      '<p class="report-cols">Colonnes reconnues : ' + (recognised.join(', ') || 'aucune') + '. Les ' + p.columns.length +
      ' colonnes du fichier sont gardées telles quelles pour l\'export CSV. Rien n\'a été supprimé ni corrigé automatiquement.</p>';
    $('#report-body').innerHTML = html;
    $('#dlg-report').showModal();
  }

  // ── Ouvrir / créer ──
  function openProject(p, opts) {
    opts = opts || {};
    cancelMode();
    project = p;
    history = [];
    $('#btn-undo').disabled = true;
    selectedUid = null;
    clearHandles();
    filter = { key: 'all', query: '' };
    $('#search').value = '';
    refreshAll();
    showPanel('list');
    fitProject();
    if (opts.fresh) touch(); else setStatus('enregistrée');
  }

  function newProject() {
    var p = M.emptyProject('Nouvelle carte');
    openProject(p, { fresh: true });
    closeDialogs();
    openSettings({ creating: true });
    $('#s-title').select();
  }

  function closeDialogs() { $$('dialog[open]').forEach(function (d) { d.close(); }); }

  // ── Mes cartes ──
  function openMaps() {
    var list = $('#maps-list');
    list.innerHTML = '<li class="dlg-note">Chargement…</li>';
    $('#dlg-maps').showModal();
    Store.list().then(function (items) {
      if (!items.length) { list.innerHTML = '<li class="dlg-note">Aucune carte enregistrée dans ce navigateur.</li>'; return; }
      list.innerHTML = items.map(function (it) {
        var d = new Date(it.updatedAt);
        var when = isNaN(d) ? '' : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
        var current = project && project.id === it.id;
        return '<li class="map-row' + (current ? ' current' : '') + '">' +
          '<button type="button" class="map-row-main" data-open="' + it.id + '"><span class="map-row-title">' + S.escape(it.title) + (current ? ' (ouverte)' : '') + '</span>' +
          '<span class="map-row-meta">' + plural(it.count, 'lieu', 'lieux') + ' · modifiée le ' + when + '</span></button>' +
          '<button type="button" class="icon-btn danger" data-delete="' + it.id + '" aria-label="Supprimer « ' + S.escape(it.title) + ' »" title="Supprimer">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg></button></li>';
      }).join('');
    }).catch(function () {
      list.innerHTML = '<li class="dlg-note">Le stockage de ce navigateur est indisponible (navigation privée ?). Utilisez les fichiers de projet.</li>';
    });
  }

  $('#maps-list').addEventListener('click', function (e) {
    var open = e.target.closest('[data-open]'), del = e.target.closest('[data-delete]');
    if (open) {
      Store.load(open.dataset.open).then(function (p) {
        if (!p) return toast('Carte introuvable.', { tone: 'error' });
        openProject(M.revive(p));
        $('#dlg-maps').close();
      });
    } else if (del) {
      var row = del.closest('.map-row');
      var title = row.querySelector('.map-row-title').textContent;
      if (!confirm('Supprimer définitivement « ' + title + ' » de ce navigateur ?')) return;
      Store.remove(del.dataset.delete).then(function () {
        if (project && project.id === del.dataset.delete) { project = null; selectedUid = null; featureGroup.clearLayers(); clearHandles(); showPanel('welcome'); refreshHeader(); setStatus(''); }
        openMaps();
      });
    }
  });

  // ── Réglages ──
  // opts.creating : ouverte juste après « Nouvelle carte » (bouton « Créer la carte »)
  function openSettings(opts) {
    if (!project) return;
    opts = (opts && opts.creating !== undefined) ? opts : {};
    $('#s-done').textContent = opts.creating ? 'Créer la carte' : 'Terminé';
    $('#s-foot-note').textContent = opts.creating
      ? 'Vous pourrez changer ces réglages plus tard (« Réglages de la carte »).'
      : 'Les modifications sont enregistrées automatiquement.';
    settingsCreating = !!opts.creating;
    $('#s-title').value = project.title;
    $('#s-about').value = project.about || '';
    $('#s-accent').value = project.settings.accent;
    $('#s-bycat').checked = !!project.settings.colorByCategory;
    var stats = M.categoryStats(project);
    $('#cat-colors').innerHTML = stats.size ? Array.from(stats.keys()).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).map(function (c) {
      var e = S.escape(c);
      return '<li data-cat="' + e + '">' +
        '<input type="color" data-cat-color="' + e + '" value="' + S.escape(project.settings.categoryColors[c] || '#888888') + '" aria-label="Couleur de « ' + e + ' »">' +
        iconButton(c) +
        '<span class="name" title="' + e + '">' + e + '</span><span class="n">' + stats.get(c) + '</span></li>';
    }).join('') : '';
    $('#cat-section').hidden = !stats.size; // carte vide : rien à régler pour l'instant
    $('#dlg-settings').showModal();
  }

  // ── Icône d'une catégorie : bouton qui ouvre la grille des icônes (js/icons.js) ──
  function iconLabel(id) {
    var e = Icons.list.find(function (x) { return x.id === id; });
    return e ? e.label : 'Repère';
  }

  function iconButton(c) {
    var id = (project.settings.categoryIcons || {})[c] || M.DEFAULT_ICON;
    return '<button type="button" class="cat-icon-btn" data-icon-toggle aria-expanded="false" ' +
      'aria-label="Icône de « ' + S.escape(c) + ' » : ' + S.escape(iconLabel(id)) + '. Changer" ' +
      'style="--c:' + S.escape(project.settings.categoryColors[c] || project.settings.accent) + '">' + Icons.svg(id) + '</button>';
  }

  function closeIconGrids() {
    $('#cat-colors').querySelectorAll('li.open').forEach(function (li) {
      li.classList.remove('open');
      var g = li.querySelector('.icon-grid'); if (g) g.remove();
      li.querySelector('[data-icon-toggle]').setAttribute('aria-expanded', 'false');
    });
  }

  function openIconGrid(li) {
    var c = li.dataset.cat;
    var current = (project.settings.categoryIcons || {})[c] || M.DEFAULT_ICON;
    var grid = document.createElement('div');
    grid.className = 'icon-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Icône de « ' + c + ' »');
    grid.innerHTML = Icons.list.map(function (x) {
      return '<button type="button" data-icon="' + x.id + '" aria-pressed="' + (x.id === current) + '" title="' + S.escape(x.label) + '" aria-label="' + S.escape(x.label) + '">' +
        Icons.svg(x.id, 'currentColor') + '</button>';
    }).join('');
    li.appendChild(grid);
    li.classList.add('open');
    li.querySelector('[data-icon-toggle]').setAttribute('aria-expanded', 'true');
    (grid.querySelector('[aria-pressed="true"]') || grid.querySelector('button')).focus();
  }

  $('#cat-colors').addEventListener('click', function (e) {
    if (!project) return;
    var li = e.target.closest('li[data-cat]');
    if (!li) return;
    if (e.target.closest('[data-icon-toggle]')) {
      var wasOpen = li.classList.contains('open');
      closeIconGrids();
      if (!wasOpen) openIconGrid(li);
      return;
    }
    var pick = e.target.closest('[data-icon]');
    if (pick) {
      var c = li.dataset.cat, id = pick.dataset.icon;
      mutate(function () { project.settings.categoryIcons[c] = id; }, { layers: true });
      closeIconGrids();
      li.querySelector('[data-icon-toggle]').outerHTML = iconButton(c);
      li.querySelector('[data-icon-toggle]').focus();
    }
  });

  $('#cat-colors').addEventListener('keydown', function (e) {
    var li = e.target.closest('li.open');
    if (!li) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); // ne pas fermer la fenêtre Réglages
      closeIconGrids();
      li.querySelector('[data-icon-toggle]').focus();
      return;
    }
    // Flèches dans la grille
    var btns = Array.from(li.querySelectorAll('.icon-grid button'));
    var i = btns.indexOf(e.target);
    if (i === -1) return;
    var perRow = Math.max(1, Math.round(li.querySelector('.icon-grid').clientWidth / btns[0].offsetWidth));
    var next = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + perRow, ArrowUp: i - perRow }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    btns[Math.max(0, Math.min(btns.length - 1, next))].focus();
  });

  var settingsCreating = false;
  var dlgSettings = $('#dlg-settings');
  // Fermeture après « Créer la carte » (bouton, ✕ ou Échap) : on invite à ajouter un premier lieu
  dlgSettings.addEventListener('close', function () {
    if (!settingsCreating || !project) return;
    settingsCreating = false;
    toast('Carte « ' + project.title + ' » créée. Ajoutez un point, une ligne ou une zone.', { tone: 'success' });
    var first = $('#btn-add-point');
    if (first && desktopMQ.matches) first.focus();
  });
  dlgSettings.addEventListener('focusin', function (e) { if (e.target.matches('input, textarea')) beginField(); });
  dlgSettings.addEventListener('input', function (e) {
    if (!project) return;
    var t = e.target;
    if (t.id === 's-title') { project.title = t.value.trim() || 'Sans titre'; refreshHeader(); fieldChanged(); }
    else if (t.id === 's-about') { project.about = t.value; fieldChanged(); }
  });
  dlgSettings.addEventListener('change', function (e) {
    if (!project) return;
    var t = e.target;
    if (t.id === 's-accent') { mutate(function () { project.settings.accent = t.value; }, { layers: true }); }
    else if (t.id === 's-bycat') { mutate(function () { project.settings.colorByCategory = t.checked; }, { layers: true }); }
    else if (t.dataset.catColor) {
      mutate(function () { project.settings.categoryColors[t.dataset.catColor] = t.value; }, { layers: true });
      var ib = t.parentNode.querySelector('[data-icon-toggle]');
      if (ib) ib.style.setProperty('--c', t.value);
    }
  });

  // ── Exporter ──
  function openPublish() {
    if (!project) return;
    var file = slug(project.title) + '.html';
    $('#embed-code').value = '<iframe src="https://exemple.com/' + file + '" title="' + S.escape(project.title) +
      '" width="100%" height="600" style="border:0;border-radius:12px" loading="lazy" allowfullscreen></iframe>';
    $('#dlg-publish').showModal();
    ExportHtml.preload().catch(function () { /* l'erreur sera signalée au clic */ });
  }

  $('#btn-export-html').addEventListener('click', function () {
    ExportHtml.build(project).then(function (html) {
      download(slug(project.title) + '.html', html, 'text/html;charset=utf-8');
      toast('Page HTML téléchargée.', { tone: 'success' });
    }).catch(function (err) { toast('Export impossible : ' + err.message, { tone: 'error' }); });
  });
  $('#btn-preview').addEventListener('click', function () {
    var w = window.open('', '_blank'); // ouvert tout de suite, sinon bloqué comme fenêtre surgissante
    ExportHtml.build(project).then(function (html) {
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      if (w) w.location.href = url; else window.location.href = url;
    }).catch(function (err) { if (w) w.close(); toast('Aperçu impossible : ' + err.message, { tone: 'error' }); });
  });
  $('#btn-export-csv').addEventListener('click', function () {
    var name = project.source.fileName && /\.csv$/i.test(project.source.fileName) ? project.source.fileName : slug(project.title) + '.csv';
    download(name, M.toCsv(project), 'text/csv;charset=utf-8');
    toast('CSV téléchargé.', { tone: 'success' });
  });
  $('#btn-export-json').addEventListener('click', function () {
    download(slug(project.title) + '.carte.json', JSON.stringify(project, null, 1), 'application/json');
    toast('Fichier de projet téléchargé.', { tone: 'success' });
  });
  $('#btn-copy-embed').addEventListener('click', function () {
    var ta = $('#embed-code');
    (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () {
      toast('Code copié.', { tone: 'success' });
    }).catch(function () { ta.select(); document.execCommand('copy'); toast('Code copié.'); });
  });

  // ── Panneau latéral (MAP-DESIGN-SYSTEM.md) ──
  function setSidebarOpenMobile(open) {
    if (desktopMQ.matches) return;
    $('#gfSidebar').classList.toggle('open', open);
    $('#gfSidebarScrim').classList.toggle('open', open);
    $('#gfSidebarToggle').setAttribute('aria-expanded', String(open));
  }
  function toggleSidebar() {
    if (desktopMQ.matches) {
      var collapsed = document.body.classList.toggle('gf-sidebar-collapsed');
      $('#gfSidebarToggle').setAttribute('aria-expanded', String(!collapsed));
    } else {
      var open = !$('#gfSidebar').classList.contains('open');
      setSidebarOpenMobile(open);
      if (open) $('#gfSidebar').focus({ preventScroll: true });
    }
  }
  function syncLayout() {
    document.documentElement.style.setProperty('--gf-header-h', $('.gf-header').offsetHeight + 'px');
    var expanded = desktopMQ.matches ? !document.body.classList.contains('gf-sidebar-collapsed') : $('#gfSidebar').classList.contains('open');
    $('#gfSidebarToggle').setAttribute('aria-expanded', String(expanded));
  }

  // ── Modale « À propos » ──
  var infoOverlay = $('#gfInfoOverlay');
  function openInfo() { infoOverlay.classList.add('open'); $('#gfInfoClose').focus(); }
  function closeInfo() { if (infoOverlay.classList.contains('open')) { infoOverlay.classList.remove('open'); $('#gfInfoBtn').focus(); } }

  // ── Événements ──
  function bind() {
    var fileInput = $('#file-input');
    function pickFile() { fileInput.value = ''; fileInput.click(); }
    fileInput.addEventListener('change', function () { closeDialogs(); importFile(fileInput.files[0]); });
    $('#btn-import').addEventListener('click', pickFile);
    $('#btn-maps').addEventListener('click', openMaps);
    $('#btn-undo').addEventListener('click', undo);
    $('#btn-publish').addEventListener('click', openPublish);
    $('#btn-settings').addEventListener('click', openSettings);
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-action]');
      if (!a) return;
      if (a.dataset.action === 'import') pickFile();
      if (a.dataset.action === 'new') newProject();
    });

    // Glisser-déposer un fichier sur la page
    document.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      importFile(e.dataTransfer.files[0]);
    });

    $('#btn-add-point').addEventListener('click', function () { setMode({ type: 'add-point' }); });
    $('#btn-add-line').addEventListener('click', function () { setMode({ type: 'add-line' }); });
    $('#btn-add-area').addEventListener('click', function () { setMode({ type: 'add-area' }); });
    $('#mode-cancel').addEventListener('click', function () { cancelMode(); });
    $('#mode-finish').addEventListener('click', finishLine);

    $('#search').addEventListener('input', debounce(function (e) { filter.query = e.target.value; refreshList(); }, 150));
    $('#filters').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      filter.key = b.dataset.key;
      $$('#filters .chip').forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
      refreshList();
    });
    $('#feature-list').addEventListener('click', function (e) {
      if (e.target.closest('[data-reset]')) { filter = { key: 'all', query: '' }; $('#search').value = ''; refreshFilters(); refreshList(); return; }
      var item = e.target.closest('.item');
      if (!item) return;
      var f = byUid(item.dataset.uid);
      select(item.dataset.uid, { fly: true });
      if (!desktopMQ.matches && f && M.hasPosition(project, f)) setSidebarOpenMobile(false);
    });

    // Fiche
    $('#btn-back').addEventListener('click', deselect);
    var form = $('#edit-form');
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.addEventListener('focusin', function (e) {
      if (e.target.matches('input, textarea, [contenteditable]')) beginField();
    });
    form.addEventListener('input', function (e) {
      var f = byUid(selectedUid), t = e.target;
      if (!f) return;
      if (t.dataset.role) {
        M.set(project, f, t.dataset.role, t.value);
        fieldChanged();
        refreshSoon();
        if (t.dataset.role === 'name') { var l = layers.get(f.uid); if (l) l.setTooltipContent(S.escape(t.value || 'Sans nom')); }
      } else if (t.dataset.col) {
        f.row[t.dataset.col] = t.value;
        fieldChanged();
      } else if (t.id === 'f-desc') {
        descSoon();
      } else if (t.id === 'f-desc-code') {
        M.set(project, f, 'description', t.value);
        fieldChanged();
      }
    });
    var descSoon = debounce(writeDescriptionFromEditor, 400);
    $('#f-desc').addEventListener('paste', function (e) {
      // Collage en texte simple : évite d'importer les styles d'une page Web ou de Word
      var html = e.clipboardData && e.clipboardData.getData('text/html');
      if (!html) return;
      e.preventDefault();
      document.execCommand('insertHTML', false, S.html(html));
    });
    $$('.rte-bar [data-cmd]').forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // garde la sélection du texte
      b.addEventListener('click', function () {
        var cmd = b.dataset.cmd;
        $('#f-desc').focus();
        if (cmd === 'createLink') {
          var url = prompt('Adresse du lien (https://…)');
          if (!url) return;
          if (!S.safeHref(url)) { toast('Adresse invalide : elle doit commencer par https://', { tone: 'error' }); return; }
          document.execCommand('createLink', false, S.safeHref(url));
        } else {
          document.execCommand(cmd, false, null);
        }
        beginField();
        writeDescriptionFromEditor();
      });
    });
    $('#rte-source').addEventListener('click', function () {
      var on = $('#rte-source').getAttribute('aria-pressed') !== 'true';
      var f = byUid(selectedUid);
      if (!on && f) $('#f-desc').innerHTML = S.html(M.get(project, f, 'description'));
      setSourceMode(on);
    });

    var catInput = $('#f-cat');
    catInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCategory(catInput.value); catInput.value = ''; }
      else if (e.key === 'Backspace' && !catInput.value) {
        var last = $$('#cat-chips [data-remove-cat]').pop();
        if (last) last.click();
      }
    });
    catInput.addEventListener('change', function () {
      // Choix dans la liste déroulante (datalist)
      var opts = $$('#cat-options option').map(function (o) { return o.value; });
      if (opts.indexOf(catInput.value) !== -1) { addCategory(catInput.value); catInput.value = ''; }
    });
    catInput.addEventListener('blur', function () { if (catInput.value.trim()) { addCategory(catInput.value); catInput.value = ''; } });
    $('#cat-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-remove-cat]');
      var f = byUid(selectedUid);
      if (!b || !f) return;
      mutate(function () {
        var cats = M.getCategories(project, f);
        cats.splice(Number(b.dataset.removeCat), 1);
        M.setCategories(project, f, cats);
      }, { uid: f.uid });
      fillCats(f);
      $('#edit-kind').style.setProperty('--c', M.colorOf(project, f));
      catInput.focus();
    });

    $('#btn-place').addEventListener('click', function () { setMode({ type: 'place', uid: selectedUid }); });
    $('#btn-extend').addEventListener('click', function () { setMode({ type: 'extend', uid: selectedUid }); });
    $('#btn-attach').addEventListener('click', function () { setMode({ type: 'attach', uid: selectedUid }); });
    $('#btn-detach').addEventListener('click', function () { attachLine(selectedUid, null); });
    $('#btn-goto-parent').addEventListener('click', function () {
      var g = M.getParent(project, byUid(selectedUid));
      if (g) select(g.uid);
    });
    $('#f-parent').addEventListener('change', function (e) { attachLine(selectedUid, e.target.value || null); });
    $('#children-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-goto]');
      if (b) select(b.dataset.goto);
    });
    $('#btn-zoom').addEventListener('click', function () { var f = byUid(selectedUid); if (f) flyToFeature(f); });
    $('#btn-delete').addEventListener('click', function () {
      var f = byUid(selectedUid);
      if (!f) return;
      var label = name(f) || 'Sans nom';
      mutate(function () {
        M.childrenOf(project, f).forEach(function (c) { M.setParent(project, c, null); });
        project.features.splice(project.features.indexOf(f), 1);
      }, { layers: true });
      deselect();
      toast('« ' + label + ' » supprimé.', { action: { label: 'Annuler', run: undo } });
    });

    // Panneau, modale, clavier
    $('#gfSidebarToggle').addEventListener('click', toggleSidebar);
    $('#gfSidebarScrim').addEventListener('click', function () { setSidebarOpenMobile(false); });
    desktopMQ.addEventListener('change', syncLayout);
    new ResizeObserver(syncLayout).observe($('.gf-header'));
    $('#gfInfoBtn').addEventListener('click', openInfo);
    $('#gfInfoClose').addEventListener('click', closeInfo);
    infoOverlay.addEventListener('click', function (e) { if (e.target === infoOverlay) closeInfo(); });

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping()) {
        e.preventDefault(); undo(); return;
      }
      if (mode && mode.path && !isTyping()) {
        if (e.key === 'Enter') { e.preventDefault(); finishLine(); return; }
        if (e.key === 'Backspace' && mode.path.length > (mode.start || 0)) {
          e.preventDefault(); mode.path.pop(); draft.setLatLngs(mode.path); updateGhost(); updateFinishState(); return;
        }
      }
      if (e.key !== 'Escape') return;
      if (infoOverlay.classList.contains('open')) return closeInfo();
      if ($('dialog[open]')) return; // le dialogue natif gère Échap
      if (mode) return cancelMode();
      if (!desktopMQ.matches && $('#gfSidebar').classList.contains('open')) { setSidebarOpenMobile(false); return $('#gfSidebarToggle').focus(); }
      if (selectedUid && !isTyping()) deselect();
    });

    window.addEventListener('beforeunload', function (e) {
      // Sauvegarde en attente (500 ms) : on la force
      if (project && $('#save-status').textContent === 'enregistrement…') { Store.save(project); }
    });
  }

  // ── Démarrage ──
  bind();
  syncLayout();
  setSidebarOpenMobile(false);
  var last = Store.lastId();
  (last ? Store.load(last) : Promise.resolve(null)).catch(function () { return null; }).then(function (p) {
    if (p) {
      try { openProject(M.revive(p)); return; } catch (e) { console.error(e); }
    }
    showPanel('welcome');
    refreshHeader();
    setStatus('');
    if (!desktopMQ.matches) setSidebarOpenMobile(true);
  });
})();
