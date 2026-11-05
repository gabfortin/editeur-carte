/* Lecture et écriture CSV (RFC 4180), sans bibliothèque.
   Gère les champs entre guillemets sur plusieurs lignes et les guillemets doublés (""),
   comme dans les exports Mapme où la description contient du HTML. */
(function (root) {
  'use strict';

  // Séparateur le plus fréquent sur la première ligne, hors guillemets
  function detectDelimiter(text) {
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (c === '\n' || c === '\r')) break;
      else if (!inQuotes && c in counts) counts[c]++;
    }
    var best = ',', max = 0;
    for (var d in counts) if (counts[d] > max) { best = d; max = counts[d]; }
    return best;
  }

  function parse(text, delimiter) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM d'Excel
    var d = delimiter || detectDelimiter(text);
    var rows = [], row = [], field = '', eol = null, inQuotes = false;
    var n = text.length;
    for (var i = 0; i < n; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === d) {
        row.push(field); field = '';
      } else if (c === '\r' || c === '\n') {
        var crlf = c === '\r' && text[i + 1] === '\n';
        if (!eol) eol = crlf ? '\r\n' : c;
        if (crlf) i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Lignes entièrement vides (fin de fichier, lignes blanches)
    rows = rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });

    var header = rows.shift() || [];
    var records = rows.map(function (r) {
      var obj = {};
      header.forEach(function (h, k) { obj[h] = r[k] !== undefined ? r[k] : ''; });
      return obj;
    });
    return { header: header, records: records, delimiter: d, eol: eol || '\n' };
  }

  // Même style que les exports Mapme : tout champ non vide entre guillemets, champ vide nu.
  function quote(v, d) {
    v = v == null ? '' : String(v);
    if (v === '') return '';
    return '"' + v.replace(/"/g, '""') + '"';
  }

  function serialize(header, records, opts) {
    opts = opts || {};
    var d = opts.delimiter || ',';
    var eol = opts.eol || '\n';
    var lines = [header.map(function (h) { return quote(h, d); }).join(d)];
    records.forEach(function (r) {
      lines.push(header.map(function (h) { return quote(r[h], d); }).join(d));
    });
    return lines.join(eol) + eol;
  }

  root.CSV = { parse: parse, serialize: serialize, detectDelimiter: detectDelimiter };
})(typeof window !== 'undefined' ? window : this);
