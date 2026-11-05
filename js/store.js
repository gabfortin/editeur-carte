/* Sauvegarde des cartes dans le navigateur (IndexedDB).
   Rien ne quitte l'appareil. IndexedDB plutôt que localStorage : un projet avec ses
   descriptions HTML dépasse vite les ~5 Mo de localStorage. */
(function (root) {
  'use strict';

  var DB_NAME = 'editeur-carte';
  var STORE = 'projets';
  var LAST_KEY = 'editeur-carte:dernier-projet';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('IndexedDB indisponible'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('Base bloquée par un autre onglet')); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var result;
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaction annulée')); };
        result = fn(t.objectStore(STORE));
      });
    });
  }

  function requestValue(req) {
    var holder = {};
    req.onsuccess = function () { holder.value = req.result; };
    return holder;
  }

  function save(project) {
    return tx('readwrite', function (s) { s.put(project); }).then(function () {
      try { localStorage.setItem(LAST_KEY, project.id); } catch (e) { /* stockage bloqué */ }
    });
  }

  function load(id) {
    var h;
    return tx('readonly', function (s) { h = requestValue(s.get(id)); }).then(function () { return h.value || null; });
  }

  function remove(id) {
    return tx('readwrite', function (s) { s.delete(id); });
  }

  // Résumé de chaque carte (sans charger les lieux dans l'interface)
  function list() {
    var h;
    return tx('readonly', function (s) { h = requestValue(s.getAll()); }).then(function () {
      return (h.value || []).map(function (p) {
        return { id: p.id, title: p.title, updatedAt: p.updatedAt, count: (p.features || []).length };
      }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    });
  }

  function lastId() {
    try { return localStorage.getItem(LAST_KEY); } catch (e) { return null; }
  }

  root.Store = { save: save, load: load, remove: remove, list: list, lastId: lastId };
})(window);
