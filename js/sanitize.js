/* Nettoyage du HTML des descriptions avant affichage.
   Les descriptions viennent de fichiers importés (ex. Mapme) : elles peuvent contenir n'importe
   quoi. On garde la mise en forme simple (gras, listes, liens), on retire le reste (styles en
   ligne, <font>, scripts, images de tiers). La donnée d'origine n'est jamais modifiée :
   ce nettoyage ne sert qu'à l'affichage. Partagé par l'éditeur et la carte exportée. */
(function (root) {
  'use strict';

  var KEEP = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, A: 1, UL: 1, OL: 1, LI: 1,
    H2: 1, H3: 1, H4: 1, SUP: 1, SUB: 1, MARK: 1, HR: 1, BLOCKQUOTE: 1 };
  // Conteneurs de bloc : deviennent <p> s'ils ne contiennent que du texte, sinon sont déballés
  var BLOCK = { DIV: 1, ARTICLE: 1, SECTION: 1, MAIN: 1, TABLE: 1, TBODY: 1, THEAD: 1, TR: 1,
    TD: 1, TH: 1, H1: 1, H5: 1, H6: 1, HEADER: 1, FOOTER: 1, FIGURE: 1, FIGCAPTION: 1 };
  // Retirés avec leur contenu
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1,
    SVG: 1, MATH: 1, IMG: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, FORM: 1, INPUT: 1, BUTTON: 1,
    SELECT: 1, TEXTAREA: 1, LINK: 1, META: 1, COLGROUP: 1, COL: 1, HEAD: 1, TITLE: 1 };
  var BLOCK_CHILD = { P: 1, UL: 1, OL: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1, HR: 1 };

  var URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]»]/g;

  function safeHref(href) {
    href = (href || '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
    if (/^www\./i.test(href)) return 'https://' + href;
    return null;
  }

  function hasBlockChild(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (BLOCK_CHILD[c.tagName] || BLOCK[c.tagName]) return true;
    }
    return false;
  }

  function appendText(parent, text, inLink) {
    if (inLink) { parent.appendChild(document.createTextNode(text)); return; }
    var last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.href = m[0]; a.textContent = m[0];
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      parent.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function walk(src, dest, inLink) {
    for (var node = src.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3) { appendText(dest, node.nodeValue, inLink); continue; }
      if (node.nodeType !== 1) continue;
      var tag = node.tagName.toUpperCase();
      if (DROP[tag]) continue;
      if (KEEP[tag]) {
        if (tag === 'A') {
          var href = safeHref(node.getAttribute('href'));
          if (!href || inLink) { walk(node, dest, inLink); continue; }
          var a = document.createElement('a');
          a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          walk(node, a, true);
          dest.appendChild(a);
          continue;
        }
        var el = document.createElement(tag === 'B' ? 'STRONG' : tag === 'I' ? 'EM' : tag);
        walk(node, el, inLink);
        dest.appendChild(el);
      } else if (BLOCK[tag] && !hasBlockChild(node) && dest.tagName !== 'P' && dest.tagName !== 'LI') {
        var p = document.createElement('P');
        walk(node, p, inLink);
        dest.appendChild(p);
      } else {
        walk(node, dest, inLink); // <span>, <font>, conteneurs : déballés
      }
    }
  }

  function isEmptyNode(n) {
    if (n.nodeType === 3) return !n.nodeValue.replace(/[\s ]/g, '');
    if (n.nodeType !== 1) return true;
    if (n.tagName === 'BR') return true;
    if (n.tagName === 'P' || n.tagName === 'LI') {
      for (var c = n.firstChild; c; c = c.nextSibling) if (!isEmptyNode(c)) return false;
      return true;
    }
    return false;
  }

  // Retire les <br>, paragraphes vides et espaces en début et en fin, et les vides entre blocs
  function tidy(root) {
    while (root.firstChild && isEmptyNode(root.firstChild)) root.removeChild(root.firstChild);
    while (root.lastChild && isEmptyNode(root.lastChild)) root.removeChild(root.lastChild);
    root.querySelectorAll('p, li').forEach(function (el) {
      while (el.firstChild && el.firstChild.nodeName === 'BR') el.removeChild(el.firstChild);
      while (el.lastChild && el.lastChild.nodeName === 'BR') el.removeChild(el.lastChild);
      if (el.tagName === 'P' && isEmptyNode(el)) el.remove();
    });
    // Plus de deux <br> de suite → deux
    root.querySelectorAll('br + br + br').forEach(function (br) { br.remove(); });
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    var tpl = document.createElement('template'); // inerte : rien ne s'exécute ni ne se charge
    tpl.innerHTML = String(html);
    var out = document.createElement('div');
    walk(tpl.content, out, false);
    tidy(out);
    return out.innerHTML;
  }

  function htmlToText(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    return (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  root.Sanitize = { html: sanitizeHtml, text: htmlToText, escape: escapeHtml, safeHref: safeHref };
})(typeof window !== 'undefined' ? window : this);
