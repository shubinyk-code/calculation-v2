/* Работа с Word-шаблоном: подстановка {{МЕТОК}}, размножение строк таблицы, предпросмотр, чтение текста.
   Весь файл шаблона копируется как есть; меняется только word/document.xml и только текст в метках. */
(function (g) {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';
  var TOKEN = /\{\{([A-Z0-9_]+)\}\}/g;

  function ln(el, name) { return el.getElementsByTagNameNS(W, name); }
  function child(el, name) {
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.namespaceURI === W && c.localName === name) return c;
    }
    return null;
  }
  function children(el, name) {
    var out = [];
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.namespaceURI === W && c.localName === name) out.push(c);
    }
    return out;
  }
  function wval(el) { return el ? el.getAttributeNS(W, 'val') : null; }

  function parseXml(str) {
    var doc = new DOMParser().parseFromString(str, 'application/xml');
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error('XML шаблона не читается: ' + err.textContent.slice(0, 200));
    return doc;
  }

  function setT(t, text) {
    t.textContent = text;
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  }

  function paraText(p) {
    var s = '';
    var ts = ln(p, 't');
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  /* --- 1. Приводим метки к виду «метка целиком в своём w:t» --- */

  function isolateTokens(p, doc) {
    for (var guard = 0; guard < 200; guard++) {
      var ts = Array.prototype.slice.call(ln(p, 't'));
      var full = '', starts = [];
      ts.forEach(function (t) { starts.push(full.length); full += t.textContent; });
      var m, found = null;
      TOKEN.lastIndex = 0;
      while ((m = TOKEN.exec(full))) {
        var s = m.index, e = s + m[0].length;
        var first = -1, last = -1;
        for (var i = 0; i < ts.length; i++) {
          var a = starts[i], b = a + ts[i].textContent.length;
          if (b > s && a < e) { if (first < 0) first = i; last = i; }
        }
        var single = first === last && ts[first].textContent === m[0];
        if (!single) { found = { s: s, e: e, first: first, last: last }; break; }
      }
      if (!found) return;
      var f = found;
      if (f.first === f.last) {
        var t = ts[f.first], txt = t.textContent, off = f.s - starts[f.first];
        splitRun(t, txt.slice(0, off), txt.slice(off, off + (f.e - f.s)), txt.slice(off + (f.e - f.s)), doc);
      } else {
        // метка разорвана между несколькими w:t — склеиваем её в первый, форматирование берём у первого
        var tf = ts[f.first], offF = f.s - starts[f.first];
        var keep = tf.textContent.slice(0, offF);
        var tl = ts[f.last], endOff = f.e - starts[f.last];
        var tail = tl.textContent.slice(endOff);
        setT(tf, keep + full.slice(f.s, f.e));
        for (var k = f.first + 1; k <= f.last; k++) setT(ts[k], k === f.last ? tail : '');
      }
    }
    throw new Error('Не удалось разобрать метки в абзаце: ' + paraText(p).slice(0, 80));
  }

  /* Делит w:r с одним w:t на «до / метка / после». Прочие дочерние элементы (tab, br) остаются в первой части. */
  function splitRun(t, pre, mid, post, doc) {
    var run = t.parentNode;
    var parent = run.parentNode;
    function mk(text) {
      var r = run.cloneNode(false);
      var rpr = child(run, 'rPr');
      if (rpr) r.appendChild(rpr.cloneNode(true));
      var nt = doc.createElementNS(W, 'w:t');
      setT(nt, text);
      r.appendChild(nt);
      return r;
    }
    var midRun = mk(mid);
    var postRun = post ? mk(post) : null;
    if (pre) {
      setT(t, pre);
      parent.insertBefore(midRun, run.nextSibling);
    } else {
      // pre пусто: метка остаётся в исходном run (вместе с tab, если он был)
      setT(t, mid);
      midRun = run;
    }
    if (postRun) parent.insertBefore(postRun, midRun.nextSibling);
  }

  /* --- 2. Подстановка --- */

  function applyTokens(p, vals, mark, meta) {
    var ts = Array.prototype.slice.call(ln(p, 't'));
    ts.forEach(function (t) {
      var m = /^\{\{([A-Z0-9_]+)\}\}$/.exec(t.textContent);
      if (!m) return;
      var key = m[1];
      if (!Object.prototype.hasOwnProperty.call(vals, key)) return; // неизвестная метка остаётся — её поймает проверка
      var v = vals[key] == null ? '' : String(vals[key]);
      setT(t, v);
      if (mark) {
        t.setAttribute('data-k', key);
        if (meta && meta.i != null) t.setAttribute('data-i', meta.i);
        if (meta && meta.j != null) t.setAttribute('data-j', meta.j);
      }
    });
  }

  function hasToken(node, name) { return node.textContent.indexOf('{{' + name + '}}') >= 0; }
  function anyItemToken(node) { return /\{\{(ITEM_[A-Z]+|OBJECT)\}\}/.test(node.textContent); }

  /**
   * @param {string} docXml  word/document.xml шаблона
   * @param {{vals:Object, items:Array<{vals:Object,lines:string[],object:string}>}} model
   * @param {boolean} mark   пометить подставленные места атрибутами data-* (только для предпросмотра)
   * @returns {Document}
   */
  function fill(docXml, model, mark) {
    var doc = parseXml(docXml);
    // 1) метки — в отдельные w:t
    Array.prototype.slice.call(ln(doc, 'p')).forEach(function (p) {
      if (paraText(p).indexOf('{{') >= 0) isolateTokens(p, doc);
    });
    // 2) строки таблицы с позициями — размножаем
    Array.prototype.slice.call(ln(doc, 'tr')).forEach(function (tr) {
      if (!anyItemToken(tr)) return;
      var parent = tr.parentNode;
      var marker = tr.nextSibling;
      parent.removeChild(tr);
      model.items.forEach(function (item, idx) {
        var row = tr.cloneNode(true);
        fillItemRow(row, item, idx, mark, doc);
        parent.insertBefore(row, marker);
      });
    });
    // 3) остальные метки документа
    Array.prototype.slice.call(ln(doc, 'p')).forEach(function (p) {
      applyTokens(p, model.vals, mark, null);
    });
    return doc;
  }

  function fillItemRow(row, item, idx, mark, doc) {
    var vals = item.vals;
    Array.prototype.slice.call(ln(row, 'p')).forEach(function (p) {
      var txt = paraText(p);
      if (txt.indexOf('{{ITEM_LINE}}') >= 0) {
        var parent = p.parentNode, next = p.nextSibling;
        parent.removeChild(p);
        item.lines.forEach(function (line, j) {
          var np = p.cloneNode(true);
          var ov = {}; for (var k in vals) ov[k] = vals[k];
          ov.ITEM_LINE = line;
          applyTokens(np, ov, mark, { i: idx, j: j });
          parent.insertBefore(np, next);
        });
        return;
      }
      if (txt.indexOf('{{OBJECT}}') >= 0 && !item.object) { p.parentNode.removeChild(p); return; }
      var ov2 = {}; for (var k2 in vals) ov2[k2] = vals[k2];
      ov2.OBJECT = item.object;
      applyTokens(p, ov2, mark, { i: idx });
    });
    // в ячейке не должно остаться ни одного абзаца без содержимого — Word требует хотя бы один w:p
    Array.prototype.slice.call(ln(row, 'tc')).forEach(function (tc) {
      if (!child(tc, 'p')) {
        tc.appendChild(doc.createElementNS(W, 'w:p'));
      }
    });
  }

  function serialize(doc) {
    var s = new XMLSerializer().serializeToString(doc);
    s = s.replace(/^<\?xml[^>]*\?>\s*/, '');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
  }

  /** Собирает итоговый .docx: все части шаблона как есть, кроме document.xml. */
  function buildDocx(entries, docXmlFilled) {
    var enc = new TextEncoder();
    var out = entries.map(function (e) {
      return e.name === 'word/document.xml' ? { name: e.name, data: enc.encode(docXmlFilled) } : e;
    });
    out.sort(function (a, b) {
      if (a.name === '[Content_Types].xml') return -1;
      if (b.name === '[Content_Types].xml') return 1;
      return 0;
    });
    return Zip.write(out);
  }

  /* --- 3. Чтение текста готового файла (для проверки) --- */

  function docParagraphs(doc) {
    var out = [];
    Array.prototype.slice.call(ln(doc, 'p')).forEach(function (p) {
      var s = '';
      (function walk(n) {
        for (var c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
          if (c.localName === 't') s += c.textContent;
          else if (c.localName === 'tab') s += '\t';
          else if (c.localName === 'br') s += '\n';
          else walk(c);
        }
      })(p);
      out.push(s);
    });
    return out;
  }

  /* --- 4. Предпросмотр: тот же документ, показанный как страница --- */

  var PX = 1 / 15; // twip → px при 96 dpi

  function borderCss(b) {
    if (!b) return null;
    var v = wval(b);
    if (!v || v === 'nil' || v === 'none') return null;
    var sz = parseInt(b.getAttributeNS(W, 'sz') || '4', 10);
    return Math.max(1, Math.round(sz / 8 * 96 / 72)) + 'px solid #000';
  }

  function renderRun(r, doc) {
    var frag = [];
    var rpr = child(r, 'rPr');
    var st = [];
    if (rpr) {
      if (child(rpr, 'b') && wval(child(rpr, 'b')) !== '0') st.push('font-weight:700');
      if (child(rpr, 'i') && wval(child(rpr, 'i')) !== '0') st.push('font-style:italic');
      if (child(rpr, 'u') && wval(child(rpr, 'u')) !== 'none') st.push('text-decoration:underline');
      var sz = child(rpr, 'sz');
      if (sz) st.push('font-size:' + (parseInt(wval(sz), 10) / 2) + 'pt');
    }
    for (var c = r.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'tab') {
        var tab = document.createElement('span');
        tab.className = 'tab';
        tab.innerHTML = '&nbsp;';
        frag.push(tab);
      } else if (c.localName === 'br') {
        frag.push(document.createElement('br'));
      } else if (c.localName === 't') {
        var sp = document.createElement('span');
        if (st.length) sp.setAttribute('style', st.join(';'));
        var k = c.getAttribute('data-k');
        if (k) {
          sp.className = 'fld';
          sp.setAttribute('data-k', k);
          if (c.hasAttribute('data-i')) sp.setAttribute('data-i', c.getAttribute('data-i'));
          if (c.hasAttribute('data-j')) sp.setAttribute('data-j', c.getAttribute('data-j'));
        }
        sp.textContent = c.textContent;
        frag.push(sp);
      }
    }
    return frag;
  }

  function renderPara(p) {
    var d = document.createElement('div');
    d.className = 'p';
    var ppr = child(p, 'pPr');
    var jc = ppr ? wval(child(ppr, 'jc')) : null;
    if (jc === 'center') d.style.textAlign = 'center';
    else if (jc === 'right' || jc === 'end') d.style.textAlign = 'right';
    else if (jc === 'both') d.style.textAlign = 'justify';
    var any = false;
    for (var c = p.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && c.namespaceURI === W && c.localName === 'r') {
        renderRun(c).forEach(function (n) { d.appendChild(n); any = true; });
      }
    }
    if (!any) d.innerHTML = '&nbsp;';
    return d;
  }

  function renderTable(tbl) {
    var table = document.createElement('table');
    table.className = 'wtbl';
    var grid = child(tbl, 'tblGrid');
    var cols = grid ? children(grid, 'gridCol') : [];
    var total = 0;
    var cg = document.createElement('colgroup');
    cols.forEach(function (gc) {
      var w = parseInt(gc.getAttributeNS(W, 'w'), 10) * PX;
      total += w;
      var col = document.createElement('col');
      col.style.width = w + 'px';
      cg.appendChild(col);
    });
    table.style.width = total + 'px';
    table.appendChild(cg);
    var tb = document.createElement('tbody');
    children(tbl, 'tr').forEach(function (tr) {
      var row = document.createElement('tr');
      children(tr, 'tc').forEach(function (tc) {
        var td = document.createElement('td');
        var pr = child(tc, 'tcPr');
        if (pr) {
          var gs = child(pr, 'gridSpan');
          if (gs) td.colSpan = parseInt(wval(gs), 10);
          var va = child(pr, 'vAlign');
          if (va && wval(va) === 'bottom') td.style.verticalAlign = 'bottom';
          else if (va && wval(va) === 'center') td.style.verticalAlign = 'middle';
          var bs = child(pr, 'tcBorders');
          if (bs) {
            [['top', 'borderTop'], ['left', 'borderLeft'], ['bottom', 'borderBottom'], ['right', 'borderRight']].forEach(function (pair) {
              var css = borderCss(child(bs, pair[0]));
              if (css) td.style[pair[1]] = css;
            });
          }
        }
        children(tc, 'p').forEach(function (p) { td.appendChild(renderPara(p)); });
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    table.appendChild(tb);
    return table;
  }

  function renderPage(doc) {
    var body = ln(doc, 'body')[0];
    var page = document.createElement('div');
    page.className = 'wpage';
    for (var c = body.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'tbl') page.appendChild(renderTable(c));
      else if (c.localName === 'p') page.appendChild(renderPara(c));
    }
    return page;
  }

  g.Docx = {
    fill: fill, serialize: serialize, buildDocx: buildDocx, parseXml: parseXml,
    docParagraphs: docParagraphs, renderPage: renderPage, paraText: paraText, ln: ln
  };
})(window);
