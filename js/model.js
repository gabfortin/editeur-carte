/* Modèle d'un projet de carte.
   Principe : le projet EST la table du CSV d'origine. Chaque lieu garde sa ligne telle quelle
   (toutes les colonnes, valeurs en texte, même ordre). L'éditeur ne réécrit une valeur que si
   on la modifie (ex. latitude/longitude après un déplacement). L'export CSV redonne donc le
   fichier de départ, plus les modifications.
   Les lignes et les zones sont stockées en WKT dans une colonne « geometry » (LINESTRING, POLYGON). */
(function (root) {
  'use strict';

  var FORMAT = 'editeur-carte';
  var VERSION = 1;

  // Colonnes reconnues automatiquement (comparaison sans accents, espaces ni casse)
  var ROLE_ALIASES = {
    id: ['mapmeid', 'id', 'identifiant', 'uuid'],
    name: ['name', 'nom', 'titre', 'title'],
    description: ['description', 'desc', 'texte'],
    categories: ['categories', 'categorie', 'category', 'tags', 'theme', 'themes'],
    address: ['address', 'adresse'],
    lat: ['latitude', 'lat'],
    lng: ['longitude', 'lng', 'lon', 'long'],
    actionText: ['actiontext', 'textedulien', 'lientexte'],
    actionUrl: ['actionurl', 'lien', 'url', 'link'],
    geometry: ['geometry', 'geometrie', 'wkt', 'geom'],
    parent: ['parentid', 'parent', 'lieuparent', 'rattachea']
  };

  // Colonnes d'une carte créée de zéro : celles de Mapme, pour rester compatible
  var DEFAULT_COLUMNS = ['id', 'name', 'description', 'categories', 'address', 'latitude', 'longitude', 'actionText', 'actionUrl'];

  var PALETTE = ['#0f766e', '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#15803d', '#b45309',
    '#0369a1', '#9333ea', '#dc2626', '#4d7c0f', '#0e7490', '#a16207', '#6d28d9', '#475569'];

  var CAT_SEP = ';';

  // Style proposé d'office à une catégorie selon son nom (icône de js/icons.js + couleur),
  // dans l'esprit des cartes Mapme. Testé dans l'ordre, sur le nom sans accents ni casse.
  // Ce n'est qu'un point de départ : chaque catégorie se change dans « Réglages ».
  // Une catégorie sans règle reçoit le repère et une couleur de PALETTE.
  var C = {
    vert: '#2f9e44', vertFonce: '#0b6e4f', sarcelle: '#0c8599', bleu: '#1c7ed6',
    rouge: '#e03131', orange: '#e8590c', violet: '#7048e8', gris: '#495057'
  };
  var STYLE_RULES = [
    [/espaces? verts?/, 'trees', C.vert],
    [/verdissement|parcs?\b/, 'tree-deciduous', C.vert],
    [/agriculture/, 'sprout', C.vert],
    [/alimentaire/, 'apple', C.vert],
    [/animal/, 'paw-print', C.vert],
    [/transition ecologique|climat/, 'leaf', C.vertFonce],
    [/electrification/, 'zap', C.vertFonce],
    [/matieres residuelles|recyclage/, 'recycle', C.gris],
    [/proprete/, 'trash-2', C.gris],
    [/acces a l.eau|baignade/, 'waves', C.sarcelle],
    [/^eau$|\beau\b/, 'droplet', C.sarcelle],
    [/\bvelo|bixi|mobilite active/, 'bike', C.vert],
    [/pieton/, 'footprints', C.sarcelle],
    [/securisation|vision zero|securite routiere/, 'shield-check', C.orange],
    [/amenagement des rues|rues?\b/, 'traffic-cone', C.sarcelle],
    [/stationnement/, 'circle-parking', C.gris],
    [/marchandises/, 'truck', C.gris],
    [/transport|voies reservees|autobus/, 'bus', C.bleu],
    [/echelle humaine/, 'person-standing', C.sarcelle],
    [/qualite de vie/, 'sun', C.sarcelle],
    [/loisirs/, 'ferris-wheel', C.bleu],
    [/familles|enfants/, 'baby', C.bleu],
    [/jeunesse|jeunes/, 'sparkles', C.bleu],
    [/aine/, 'hand-helping', C.bleu],
    [/ecoles?/, 'school', C.bleu],
    [/sports?/, 'dumbbell', C.bleu],
    [/accesslogis|logement|habitation/, 'house', C.rouge],
    [/communautaire|social/, 'users', C.bleu],
    [/accessibilite/, 'accessibility', C.bleu],
    [/services? aux citoyen/, 'info', C.bleu],
    [/interculturel|immigration/, 'earth', C.bleu],
    [/propriete/, 'key-round', C.rouge],
    [/itinerance|pauvrete/, 'hand-heart', C.rouge],
    [/culture/, 'palette', C.orange],
    [/patrimoine/, 'landmark', C.orange],
    [/tourisme/, 'camera', C.orange],
    [/autochtone/, 'feather', C.orange],
    [/budget participatif/, 'piggy-bank', C.violet],
    [/democratie|participation citoyenne/, 'vote', C.violet],
    [/inegalites|ads\+/, 'scale', C.violet],
    [/femmes/, 'star', C.violet],
    [/economique|commerce/, 'briefcase', C.violet],
    [/metropole/, 'globe', C.violet],
    [/infrastructures?/, 'construction', C.gris],
    [/industrie/, 'factory', C.gris],
    [/urbanisme/, 'building-2', C.gris],
    [/administration|arrondissement/, 'landmark', C.gris]
  ];
  var DEFAULT_ICON = 'map-pin';

  function defaultStyle(category) {
    var n = String(category).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (var i = 0; i < STYLE_RULES.length; i++) {
      if (STYLE_RULES[i][0].test(n)) return { icon: STYLE_RULES[i][1], color: STYLE_RULES[i][2] };
    }
    return null;
  }

  function norm(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s_\-.]/g, '');
  }

  function detectRoles(columns) {
    var roles = {};
    Object.keys(ROLE_ALIASES).forEach(function (role) {
      var aliases = ROLE_ALIASES[role];
      for (var i = 0; i < aliases.length; i++) {
        var col = columns.find(function (c) { return norm(c) === aliases[i]; });
        if (col !== undefined) { roles[role] = col; break; }
      }
    });
    return roles;
  }

  function uid() {
    if (root.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function emptyProject(title) {
    var now = new Date().toISOString();
    return {
      format: FORMAT, version: VERSION, id: uid(),
      title: title || 'Nouvelle carte', about: '',
      createdAt: now, updatedAt: now,
      source: { fileName: null, delimiter: ',', eol: '\n' },
      columns: DEFAULT_COLUMNS.slice(),
      roles: detectRoles(DEFAULT_COLUMNS),
      settings: { accent: '#0f766e', colorByCategory: true, categoryColors: {}, categoryIcons: {} },
      features: []
    };
  }

  function projectFromCsv(parsed, fileName) {
    var p = emptyProject(fileName ? fileName.replace(/\.(csv|txt)$/i, '') : 'Carte importée');
    p.source = { fileName: fileName || null, delimiter: parsed.delimiter, eol: parsed.eol };
    p.columns = parsed.header.slice();
    p.roles = detectRoles(p.columns);
    p.features = parsed.records.map(function (row) { return { uid: uid(), row: row }; });
    assignColors(p);
    return p;
  }

  // ── Accès aux champs selon leur rôle ──
  function get(p, f, role) {
    var col = p.roles[role];
    return col ? (f.row[col] || '') : '';
  }

  // Écrit une valeur ; crée la colonne au besoin (en fin de tableau, pour ne rien décaler)
  function set(p, f, role, value) {
    var col = p.roles[role];
    if (!col) {
      col = { geometry: 'geometry', lat: 'latitude', lng: 'longitude', parent: 'parentId' }[role] || role;
      while (p.columns.indexOf(col) !== -1 && p.roles[role] !== col) col += '_';
      p.columns.push(col);
      p.roles[role] = col;
      p.features.forEach(function (g) { if (!(col in g.row)) g.row[col] = ''; });
    }
    f.row[col] = value == null ? '' : String(value);
  }

  function num(s) {
    if (s == null) return NaN;
    s = String(s).trim().replace(',', '.');
    return s === '' ? NaN : Number(s);
  }

  function fmt(n) { return String(Math.round(n * 1e7) / 1e7); }

  // ── Géométrie ──
  // Colonne geometry, en WKT : LINESTRING pour une ligne, POLYGON (un seul anneau, sans trou)
  // pour une zone. GeoJSON LineString / Polygon accepté à l'import. En mémoire, le contour d'une
  // zone est gardé SANS répéter le premier sommet à la fin (Leaflet le ferme lui-même) ; le WKT,
  // lui, le répète comme l'exige le format.
  function wktPoints(body) {
    return body.split(',').map(function (pair) {
      var xy = pair.trim().split(/\s+/).map(Number);
      return [xy[1], xy[0]]; // WKT : longitude latitude
    }).filter(function (ll) { return isFinite(ll[0]) && isFinite(ll[1]); });
  }

  function openRing(pts) {
    var a = pts[0], z = pts[pts.length - 1];
    return pts.length > 1 && a[0] === z[0] && a[1] === z[1] ? pts.slice(0, -1) : pts;
  }

  // → { type: 'line' | 'area', path: [[lat, lng], …] } ou null
  function parseGeometry(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var m = /^LINESTRING\s*\(([^()]*)\)$/i.exec(s);
    if (m) {
      var pts = wktPoints(m[1]);
      return pts.length >= 2 ? { type: 'line', path: pts } : null;
    }
    m = /^POLYGON\s*\(\s*\(([^()]*)\)/i.exec(s); // anneau extérieur ; les trous éventuels sont ignorés
    if (m) {
      var ring = openRing(wktPoints(m[1]));
      return ring.length >= 3 ? { type: 'area', path: ring } : null;
    }
    if (s[0] === '{') {
      try {
        var g = JSON.parse(s);
        if (g.type === 'Feature') g = g.geometry;
        var ll = function (c) { return [c[1], c[0]]; };
        if (g && g.type === 'LineString' && g.coordinates.length >= 2) return { type: 'line', path: g.coordinates.map(ll) };
        if (g && g.type === 'Polygon' && g.coordinates[0]) {
          var r = openRing(g.coordinates[0].map(ll));
          if (r.length >= 3) return { type: 'area', path: r };
        }
      } catch (e) { /* ignoré */ }
    }
    return null;
  }

  // Compatibilité : chemin seul (ligne ou contour de zone)
  function parseWkt(s) { var g = parseGeometry(s); return g ? g.path : null; }

  function toWkt(path, type) {
    var pts = path.map(function (ll) { return fmt(ll[1]) + ' ' + fmt(ll[0]); });
    if (type === 'area') return 'POLYGON ((' + pts.concat(pts[0]).join(', ') + '))';
    return 'LINESTRING (' + pts.join(', ') + ')';
  }

  // 'point', 'line' ou 'area' (zone)
  function kind(p, f) {
    var g = parseGeometry(get(p, f, 'geometry'));
    return g ? g.type : 'point';
  }

  // Ligne ou zone : a un tracé dans geometry
  function isShape(p, f) { return kind(p, f) !== 'point'; }

  // Superficie approximative d'une zone, en m² (projection locale, suffisant à l'échelle d'une ville)
  function areaM2(path) {
    if (!path || path.length < 3) return 0;
    var R = 6371000, toRad = Math.PI / 180, lat0 = path[0][0] * toRad, sum = 0;
    var xy = path.map(function (ll) { return [ll[1] * toRad * R * Math.cos(lat0), ll[0] * toRad * R]; });
    for (var i = 0; i < xy.length; i++) {
      var a = xy[i], b = xy[(i + 1) % xy.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum) / 2;
  }

  function getLatLng(p, f) {
    var lat = num(get(p, f, 'lat')), lng = num(get(p, f, 'lng'));
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lat, lng];
  }

  function setLatLng(p, f, ll) {
    set(p, f, 'lat', fmt(ll[0]));
    set(p, f, 'lng', fmt(ll[1]));
  }

  function getPath(p, f) { return parseWkt(get(p, f, 'geometry')); }
  // Garde le type existant (ligne ou zone) sauf si `type` est donné
  function setPath(p, f, path, type) { set(p, f, 'geometry', toWkt(path, type || kind(p, f))); }

  function hasPosition(p, f) {
    return isShape(p, f) || !!getLatLng(p, f);
  }

  // Adresse à afficher : Mapme met parfois des coordonnées (« -73.5737,45.50951 ») dans la
  // colonne address pour les points placés à la main. On ne les affiche pas ; la donnée reste.
  var COORDS_RE = /^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/;
  function displayAddress(p, f) {
    var a = get(p, f, 'address').trim();
    return COORDS_RE.test(a) ? '' : a;
  }

  // ── Ligne ou zone rattachée à un point ──
  // Une ligne ou une zone peut appartenir à un point existant (ex. le tracé d'un projet dont le point porte
  // la fiche). Lien stocké dans la colonne « parentId » de la ligne (créée en fin de tableau
  // au premier rattachement) : l'identifiant du point (colonne id, ex. mapmeId de Mapme).
  // La ligne garde sa propre rangée ; elle prend la couleur et l'icône du point, et sur la
  // carte publiée elle ouvre la fiche du point.
  function idOf(p, f) { return get(p, f, 'id').trim(); }

  function findById(p, id) {
    if (!id) return null;
    for (var i = 0; i < p.features.length; i++) if (idOf(p, p.features[i]) === id) return p.features[i];
    return null;
  }

  // Point auquel la ligne est rattachée, ou null (pas de lien, ou point supprimé)
  function getParent(p, f) {
    if (!p.roles.parent) return null;
    var g = findById(p, get(p, f, 'parent').trim());
    return g && g !== f && kind(p, g) === 'point' ? g : null;
  }

  // Rattache la ligne f au point g (ou détache si g est null). Un point sans identifiant en
  // reçoit un (UUID), sinon le lien serait impossible ; c'est la seule écriture sur le point.
  function setParent(p, f, g) {
    if (!g) { if (p.roles.parent) set(p, f, 'parent', ''); return; }
    if (!idOf(p, g)) set(p, g, 'id', uid());
    set(p, f, 'parent', idOf(p, g));
  }

  function childrenOf(p, g) {
    var id = idOf(p, g);
    if (!id || !p.roles.parent) return [];
    return p.features.filter(function (f) { return f !== g && get(p, f, 'parent').trim() === id && isShape(p, f); });
  }

  // ── Catégories ──
  function getCategories(p, f) {
    return get(p, f, 'categories').split(CAT_SEP).map(function (c) { return c.trim(); }).filter(Boolean);
  }
  function setCategories(p, f, cats) {
    set(p, f, 'categories', cats.join(CAT_SEP));
  }

  // Catégories dans l'ordre de première apparition, avec leur nombre de lieux
  function categoryStats(p) {
    var stats = new Map();
    p.features.forEach(function (f) {
      getCategories(p, f).forEach(function (c) { stats.set(c, (stats.get(c) || 0) + 1); });
    });
    return stats;
  }

  // Donne une couleur et une icône aux catégories qui n'en ont pas encore (règles de
  // STYLE_RULES, sinon PALETTE et le repère). Ne remplace jamais un choix existant.
  function assignColors(p) {
    var colors = p.settings.categoryColors;
    var icons = p.settings.categoryIcons || (p.settings.categoryIcons = {});
    var used = Object.keys(colors).length;
    categoryStats(p).forEach(function (n, c) {
      var d = defaultStyle(c);
      if (!colors[c]) colors[c] = d ? d.color : PALETTE[used++ % PALETTE.length];
      if (!icons[c]) icons[c] = d ? d.icon : DEFAULT_ICON;
    });
  }

  // Icône d'un lieu : celle de sa première catégorie
  function iconOf(p, f) {
    f = getParent(p, f) || f;
    var cats = getCategories(p, f);
    return (cats.length && (p.settings.categoryIcons || {})[cats[0]]) || DEFAULT_ICON;
  }

  function colorOf(p, f) {
    if (!p.settings.colorByCategory) return p.settings.accent;
    f = getParent(p, f) || f; // une ligne rattachée prend la couleur de son point
    var cats = getCategories(p, f);
    return (cats.length && p.settings.categoryColors[cats[0]]) || p.settings.accent;
  }

  // ── Lieux à vérifier : sans position, ou très loin des autres (géocodage raté) ──
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function distanceKm(a, b) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toRad, dLng = (b[1] - a[1]) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  var FAR_KM = 100;

  function analyse(p) {
    var pts = [];
    p.features.forEach(function (f) {
      var ll = isShape(p, f) ? getPath(p, f)[0] : getLatLng(p, f);
      if (ll) pts.push(ll);
    });
    var centre = pts.length ? [median(pts.map(function (x) { return x[0]; })), median(pts.map(function (x) { return x[1]; }))] : null;
    var issues = new Map(); // uid → 'sans-position' | 'loin' | 'sans-nom'
    p.features.forEach(function (f) {
      var k = kind(p, f);
      var ll = k !== 'point' ? getPath(p, f)[0] : getLatLng(p, f);
      if (!ll) issues.set(f.uid, 'sans-position');
      else if (centre && distanceKm(centre, ll) > FAR_KM) issues.set(f.uid, 'loin');
      else if (!get(p, f, 'name').trim()) issues.set(f.uid, 'sans-nom');
    });
    return { centre: centre, issues: issues };
  }

  function newFeature(p, kindName, geom) {
    var f = { uid: uid(), row: {} };
    p.columns.forEach(function (c) { f.row[c] = ''; });
    if (p.roles.id) f.row[p.roles.id] = uid();
    if (kindName === 'line' || kindName === 'area') setPath(p, f, geom, kindName);
    else setLatLng(p, f, geom);
    return f;
  }

  function toCsv(p) {
    return root.CSV.serialize(p.columns, p.features.map(function (f) { return f.row; }), {
      delimiter: p.source.delimiter || ',', eol: p.source.eol || '\n'
    });
  }

  // Vérifie et complète un projet relu (fichier .json, page exportée, IndexedDB)
  function revive(obj) {
    if (!obj || obj.format !== FORMAT || !Array.isArray(obj.features) || !Array.isArray(obj.columns)) {
      throw new Error("Ce fichier n'est pas un projet de l'éditeur de carte.");
    }
    var p = emptyProject(obj.title);
    Object.keys(obj).forEach(function (k) { p[k] = obj[k]; });
    p.settings = Object.assign(emptyProject().settings, obj.settings || {});
    p.settings.categoryColors = Object.assign({}, (obj.settings || {}).categoryColors);
    p.settings.categoryIcons = Object.assign({}, (obj.settings || {}).categoryIcons);
    p.roles = Object.assign(detectRoles(p.columns), obj.roles || {});
    p.features.forEach(function (f) { if (!f.uid) f.uid = uid(); if (!f.row) f.row = {}; });
    assignColors(p);
    return p;
  }

  root.Model = {
    FORMAT: FORMAT, VERSION: VERSION, PALETTE: PALETTE, CAT_SEP: CAT_SEP,
    emptyProject: emptyProject, projectFromCsv: projectFromCsv, revive: revive,
    detectRoles: detectRoles, get: get, set: set, kind: kind,
    getLatLng: getLatLng, setLatLng: setLatLng, getPath: getPath, setPath: setPath,
    hasPosition: hasPosition, parseWkt: parseWkt, parseGeometry: parseGeometry, toWkt: toWkt, isShape: isShape, areaM2: areaM2,
    getCategories: getCategories, displayAddress: displayAddress, setCategories: setCategories, categoryStats: categoryStats,
    assignColors: assignColors, colorOf: colorOf, iconOf: iconOf, defaultStyle: defaultStyle, DEFAULT_ICON: DEFAULT_ICON, analyse: analyse, distanceKm: distanceKm,
    newFeature: newFeature, getParent: getParent, setParent: setParent, childrenOf: childrenOf, idOf: idOf, toCsv: toCsv, uid: uid
  };
})(typeof window !== 'undefined' ? window : this);
