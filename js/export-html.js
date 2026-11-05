/* Export de la carte en une page HTML autonome.
   Tout est intégré dans le fichier (Leaflet, styles, code, données) : on peut le téléverser
   n'importe où ou l'afficher dans un <iframe>. Seules les tuiles OpenStreetMap viennent du réseau.
   Le projet complet est intégré tel quel (#editeur-carte-projet) : la page exportée peut être
   rouverte dans l'éditeur pour la modifier. */
(function (root) {
  'use strict';
  var S = root.Sanitize;

  var PARTS = {
    leafletCss: 'vendor/leaflet-1.9.4/leaflet.css',
    leafletJs: 'vendor/leaflet-1.9.4/leaflet.js',
    viewerCss: 'viewer/viewer.css',
    viewerJs: 'viewer/viewer.js',
    sanitizeJs: 'js/sanitize.js',
    modelJs: 'js/model.js'
  };
  var cache = null;

  function loadParts() {
    if (cache) return cache;
    var v = (document.querySelector('meta[name="app-version"]') || {}).content || '';
    var keys = Object.keys(PARTS);
    cache = Promise.all(keys.map(function (k) {
      return fetch((root.__base || '') + PARTS[k] + '?v=' + encodeURIComponent(v)).then(function (r) {
        if (!r.ok) throw new Error('Fichier introuvable : ' + PARTS[k]);
        return r.text();
      });
    })).then(function (texts) {
      var out = {};
      keys.forEach(function (k, i) { out[k] = texts[i]; });
      return out;
    });
    cache.catch(function () { cache = null; });
    return cache;
  }

  function inlineJs(s) { return s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'); }
  function inlineCss(s) { return s.replace(/<\/style/gi, '<\\/style'); }
  function inlineJson(obj) {
    // U+2028 et U+2029 sont des fins de ligne pour les vieux moteurs JS : on les échappe aussi
    return JSON.stringify(obj).replace(/</g, '\\u003c')
      .split(String.fromCharCode(0x2028)).join('\\u2028')
      .split(String.fromCharCode(0x2029)).join('\\u2029');
  }

  function build(project) {
    return loadParts().then(function (p) {
      var title = S.escape(project.title || 'Carte');
      var about = (project.about || '').trim();
      var count = project.features.filter(function (f) { return root.Model.hasPosition(project, f); }).length;
      var accent = /^#[0-9a-f]{6}$/i.test(project.settings.accent) ? project.settings.accent : '#0f766e';
      var updated = new Date(project.updatedAt || Date.now()).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
      var description = S.escape(about ? about.slice(0, 200) : 'Carte interactive : ' + (project.title || ''));

      return '<!DOCTYPE html>\n<html lang="fr-CA">\n<head>\n' +
        '<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n' +
        '<title>' + title + '</title>\n' +
        '<meta name="description" content="' + description + '">\n' +
        '<meta name="generator" content="Éditeur de carte (gabfortin.com)">\n' +
        '<meta name="theme-color" content="#eef1ea" media="(prefers-color-scheme: light)">\n' +
        '<meta name="theme-color" content="#0b1310" media="(prefers-color-scheme: dark)">\n' +
        '<style>\n' + inlineCss(p.leafletCss) + '\n</style>\n' +
        '<style>\n' + inlineCss(p.viewerCss) + '\n:root { --brand: ' + accent + '; }\n</style>\n' +
        '</head>\n<body>\n' +
        '<a class="skip-link" href="#map">Passer à la carte</a>\n' +
        '<a class="skip-link" href="#gfSidebar">Passer à la liste des lieux</a>\n' +
        '<div id="map" role="region" aria-label="Carte : ' + title + '" tabindex="0"></div>\n' +
        '<header class="gf-header glass">\n' +
        '  <div class="gf-brand"><h1>' + title + '</h1><p>' + count + (count > 1 ? ' lieux' : ' lieu') + '</p></div>\n' +
        '  <button class="gf-info-btn" id="gfInfoBtn" type="button" aria-label="À propos de cette carte" aria-haspopup="dialog">' +
        '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="7.6" r="1.4" fill="currentColor"/><path d="M12 11v6.2" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg></button>\n' +
        '</header>\n' +
        '<div class="gf-info-overlay" id="gfInfoOverlay" role="dialog" aria-modal="true" aria-labelledby="gfInfoTitle">\n' +
        '  <div class="gf-info-panel glass">\n' +
        '    <button class="gf-info-close" id="gfInfoClose" type="button" aria-label="Fermer">✕</button>\n' +
        '    <h2 id="gfInfoTitle">' + title + '</h2>\n' +
        (about ? '    <p>' + S.escape(about) + '</p>\n' : '') +
        '    <p class="small">' + count + (count > 1 ? ' lieux' : ' lieu') + ' · mise à jour le ' + S.escape(updated) +
        '. Fond de carte © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>.</p>\n' +
        '  </div>\n</div>\n' +
        '<button class="gf-sidebar-toggle glass" id="gfSidebarToggle" type="button" aria-label="Liste des lieux" aria-expanded="false" aria-controls="gfSidebar">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 6h16M7 12h10M10 18h4"/></svg></button>\n' +
        '<aside class="gf-sidebar glass" id="gfSidebar" aria-label="Liste des lieux" tabindex="-1">\n' +
        '  <div class="sb-top">\n' +
        '    <div class="sb-search"><label class="sr-only" for="search">Rechercher un lieu</label>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="search" type="search" placeholder="Rechercher" autocomplete="off"></div>\n' +
        '    <div class="chips" id="chips" role="group" aria-label="Filtrer par catégorie"></div>\n' +
        '  </div>\n' +
        '  <p class="sb-count" id="count" aria-live="polite"></p>\n' +
        '  <ul class="sb-list" id="list"></ul>\n' +
        '</aside>\n' +
        '<div class="gf-sidebar-scrim" id="gfSidebarScrim"></div>\n' +
        '<noscript><p style="position:fixed;inset:0;display:grid;place-items:center;margin:0">Cette carte requiert JavaScript.</p></noscript>\n' +
        '<script type="application/json" id="editeur-carte-projet">' + inlineJson(project) + '</script>\n' +
        '<script>\n' + inlineJs(p.leafletJs) + '\n</script>\n' +
        '<script>\n' + inlineJs(p.sanitizeJs) + '\n</script>\n' +
        '<script>\n' + inlineJs(p.modelJs) + '\n</script>\n' +
        '<script>\n' + inlineJs(p.viewerJs) + '\n</script>\n' +
        '</body>\n</html>\n';
    });
  }

  // Relit le projet intégré dans une page exportée
  function extractProject(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var node = doc.getElementById('editeur-carte-projet');
    if (!node) throw new Error("Cette page n'a pas été exportée par l'éditeur de carte.");
    return JSON.parse(node.textContent);
  }

  root.ExportHtml = { build: build, extractProject: extractProject, preload: loadParts };
})(window);
