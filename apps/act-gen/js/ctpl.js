/* Шаблон договора из образца: поиск изменяемых данных, замена на {{МЕТКИ}} с сохранением оформления Word,
   подстановка значений, предпросмотр с правкой. Любой текст меняется только внутри w:t — разметка абзацев и таблиц не трогается. */
(function (g) {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';
  var SP = String.fromCharCode(32);
  var NB = String.fromCharCode(160);
  var TOK = /\{\{([A-Z0-9_]+)\}\}/g;

  function ln(el, n) { return el.getElementsByTagNameNS(W, n); }
  function child(el, n) {
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === W && c.localName === n) return c;
    return null;
  }
  function children(el, n) {
    var o = [];
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.namespaceURI === W && c.localName === n) o.push(c);
    return o;
  }
  function wval(el) { return el ? el.getAttributeNS(W, 'val') : null; }
  function nz(s) { return String(s).replace(/[\s  ]+/g, SP).trim(); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

  function setT(t, text) {
    t.textContent = text;
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  }
  function paras(doc) { return Array.prototype.slice.call(ln(doc, 'p')); }
  function tlist(p) { return Array.prototype.slice.call(ln(p, 't')); }
  function ptext(p) {
    var s = '', ts = ln(p, 't');
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }

  /** Заменяет символы [s,e) текста абзаца на str, не трогая оформление остальных кусков. */
  function replaceRange(p, s, e, str) {
    var ts = tlist(p);
    if (!ts.length) {
      var doc = p.ownerDocument, r = doc.createElementNS(W, 'w:r'), t = doc.createElementNS(W, 'w:t');
      r.appendChild(t); p.appendChild(r); ts = [t];
    }
    var pos = 0, carrier = -1, starts = [], ends = [];
    ts.forEach(function (t, i) {
      var a = pos, b = a + t.textContent.length;
      starts.push(a); ends.push(b); pos = b;
      if (carrier < 0) {
        if (s < e ? b > s : b >= s) carrier = i;
      }
    });
    if (carrier < 0) carrier = ts.length - 1;
    ts.forEach(function (t, i) {
      var a = starts[i], b = ends[i], txt = t.textContent;
      if (i === carrier) {
        var left = txt.slice(0, Math.max(0, Math.min(s - a, txt.length)));
        var right = txt.slice(Math.max(0, Math.min(e - a, txt.length)));
        if (s < a) left = '';
        setT(t, left + str + right);
      } else if (i > carrier && a < e) {
        setT(t, txt.slice(Math.max(0, Math.min(e - a, txt.length))));
      }
    });
  }

  /** Весь текст абзаца заменить на str; форматирование берётся у самого длинного куска. */
  function replaceAll(p, str) {
    var ts = tlist(p);
    if (!ts.length) { replaceRange(p, 0, 0, str); return; }
    var best = 0;
    ts.forEach(function (t, i) { if (t.textContent.length > ts[best].textContent.length) best = i; });
    ts.forEach(function (t, i) { setT(t, i === best ? str : ''); });
  }

  /* ---------- поиск по образцу ---------- */

  function litText(v) {
    return nz(v).split(SP).map(esc).join('[\\s\\u00a0]+');
  }
  function litDigits(v) {
    return String(v).replace(/\D/g, '').split('').join('[\\s\\u00a0]?');
  }
  function litLoose(v) {
    return nz(v).replace(/[\s ]/g, '').split('').map(esc).join('[\\s\\u00a0]*');
  }

  var MONEY = /(\d{1,3}(?:[\s ]\d{3})+|\d+)([.,]\d{1,2})?([\s ]*\(([^)]{3,200})\))?([\s ]*(?:руб\S*|₽|р\.))(,?[\s ]*(\d{1,2})[\s ]*коп\S*)?/gi;
  function moneyVal(m) {
    var rub = parseInt(m[1].replace(/[\s ]/g, ''), 10);
    if (m[7] != null) return rub * 100 + parseInt(m[7], 10);
    return parseMoneyStr(m[1], m[2]);
  }
  var REQ_WORD = /инн|огрн|кпп|р\/с|к\/с|бик|(?<![а-яё])тел(?![а-яё])|почт|e-?mail|адрес|банк|филиал|сч[её]т|паспорт|снилс|факс/i;

  function parseMoneyStr(g1, g2) {
    return RU.parseMoney(g1.replace(/[\s ]/g, '') + (g2 ? g2.replace(',', '.') : ''));
  }

  function stemOf(word) { return word.slice(0, Math.max(3, word.length - 2)); }

  /**
   * @param {string} docXml   document.xml образца
   * @param {Array} lines     Extract.readLines(docXml)
   * @param {Object} parsed   Extract.parseContract(lines)
   * @returns {{xml:string, samples:Object, counts:Object, init:Object, notes:string[], meta:Object}}
   */
  function analyze(docXml, lines, parsed) {
    var doc = Docx.parseXml(docXml);
    var P = paras(doc);
    var T = P.map(ptext);
    var occ = P.map(function () { return []; });
    var edits = P.map(function () { return []; });
    var ops = [];
    var samples = {}, counts = {}, notes = [];
    var meta = { roleC: 'Заказчик', roleE: 'Подрядчик', nbsp: false, vatMode: 'pct', spaced: false };
    var init = { common: {}, ov: {}, tab: {}, exec: null };
    var inTable = P.map(function (p) { for (var n = p.parentNode; n; n = n.parentNode) if (n.localName === 'tc') return true; return false; });

    function free(pi, s, e) {
      var o = occ[pi];
      for (var i = 0; i < o.length; i++) if (s < o[i].e && e > o[i].s) return false;
      return true;
    }
    function add(pi, s, e, key, sample) {
      if (e <= s || !free(pi, s, e)) return false;
      occ[pi].push({ s: s, e: e });
      edits[pi].push({ s: s, e: e, key: key });
      counts[key] = (counts[key] || 0) + 1;
      if (samples[key] == null) samples[key] = sample == null ? T[pi].slice(s, e) : sample;
      return true;
    }
    function block(pi) { occ[pi].push({ s: 0, e: 1e9 }); }
    function each(re, cb, from, to) {
      for (var pi = from || 0; pi < (to == null ? P.length : Math.min(P.length, to)); pi++) {
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(T[pi]))) {
          cb(pi, m);
          if (m[0].length === 0) re.lastIndex++;
        }
      }
    }
    function literal(val, key, mode, sample, from, to) {
      if (!val || String(val).length < 2) return 0;
      var src = mode === 'digits' ? litDigits(val) : mode === 'loose' ? litLoose(val) : litText(val);
      var re = new RegExp(src, 'g'), n = 0;
      each(re, function (pi, m) { if (add(pi, m.index, m.index + m[0].length, key, sample == null ? nz(m[0]) : sample)) n++; }, from, to == null ? null : to + 1);
      return n;
    }

    var found = parsed.found || {};
    var blocks = parsed.blocks || {};

    /* --- стороны: вводная часть --- */
    var execFromIntro = null, custLongRange = null;
    var roleRe = /именуем\S*\s+в\s+дальнейшем\s+[«"“]\s*(Заказчик|Исполнитель|Подрядчик|Проектировщик|Генпроектировщик|Субподрядчик|Генеральный проектировщик)\s*[»"”]/ig;
    for (var pi0 = 0; pi0 < Math.min(P.length, 40); pi0++) {
      var txt = T[pi0], rm;
      roleRe.lastIndex = 0;
      while ((rm = roleRe.exec(txt))) {
        var role = rm[1], isCust = /^заказчик$/i.test(role);
        if (isCust) {
          meta.roleC = role;
          var before = txt.slice(0, rm.index).replace(/[\s,]+$/, '');
          var bm = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(before);
          var longEnd = before.length, longStart = 0;
          // начало — после предыдущей «с одной стороны, и», если есть
          var prevSide = /с\s+(?:одной|другой)\s+стороны\s*,?\s*(?:и\s+)?/ig, pm, lastEnd = 0;
          while ((pm = prevSide.exec(before))) lastEnd = pm.index + pm[0].length;
          longStart = lastEnd;
          if (bm && bm[1].length > longStart) {
            add(pi0, longStart, bm[1].length, 'CUST_LONG', nz(txt.slice(longStart, bm[1].length)));
            var ns = before.lastIndexOf('(') + 1;
            add(pi0, ns, ns + bm[2].length, 'CUST_NAME', bm[2]);
          } else add(pi0, longStart, longEnd, 'CUST_LONG', nz(txt.slice(longStart, longEnd)));
          var aft = txt.slice(rm.index + rm[0].length);
          var base = rm.index + rm[0].length;
          var rep = /^\s*,?\s*в\s+лице\s+(.+?)\s+([А-ЯЁ][а-яё\-]+\s+[А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁ][а-яё\-]+)?)\s*,\s*(действующ\S*\s+на\s+основании\s+.+?)(?=\s*,?\s*с\s+(?:одной|другой)\s+стороны|\s*$)/.exec(aft);
          if (rep) {
            var postS = base + aft.search(/в\s+лице/) + (/в\s+лице\s+/.exec(aft)[0].length);
            add(pi0, postS, postS + rep[1].length, 'CUST_REP_POST', rep[1]);
            var fioS = base + aft.indexOf(rep[2], postS - base + rep[1].length);
            add(pi0, fioS, fioS + rep[2].length, 'CUST_FIO_GEN', rep[2]);
            var bS = base + aft.indexOf(rep[3], fioS - base);
            add(pi0, bS, bS + rep[3].length, 'CUST_REP_BASIS', rep[3]);
            init.fioGen = rep[2];
          }
        } else {
          meta.roleE = role;
          var prevS = /с\s+одной\s+стороны\s*,?\s*(?:и\s+)?/ig, pm2, st = 0;
          var head = txt.slice(0, rm.index);
          while ((pm2 = prevS.exec(head))) st = pm2.index + pm2[0].length;
          var endRe = /\s*,?\s*с\s+(?:другой|одной)\s+стороны/ig;
          endRe.lastIndex = rm.index + rm[0].length;
          var em = endRe.exec(txt), en;
          if (em) en = em.index;
          else {
            en = rm.index + rm[0].length;
            var tail = /^\s*,?\s*в\s+лице\s+[^,]+,\s*действующ\S*\s+на\s+основании\s+[^,.;]+/.exec(txt.slice(en));
            if (tail) en += tail[0].length;
          }
          var intro = txt.slice(st, en);
          if (add(pi0, st, en, 'EXEC_INTRO', nz(intro))) {
            execFromIntro = intro;
            var dm = /в\s+лице\s+[а-яё\s]*?([А-ЯЁ][а-яё\-]+\s+[А-ЯЁ][а-яё\-]+\s+[А-ЯЁ][а-яё\-]+)/.exec(intro);
            if (dm) init.execDirGen = dm[1];
          }
        }
      }
    }
    if (!samples.CUST_LONG) notes.push('Вводная часть: не нашёл фразу «именуемое в дальнейшем «Заказчик»» — наименование и представителя Заказчика отметьте вручную.');
    if (!samples.EXEC_INTRO) notes.push('Вводная часть: описание Исполнителя не распознано — отметьте его выделением и кнопкой «Сделать полем».');

    /* --- реквизиты --- */
    function personOf(blockLines, fallbackName) {
      var r = Person.parse(blockLines.join('\n'));
      var p = r.party;
      return p;
    }
    var cust = null, exec = null;
    if (blocks.customer && blocks.customer.length) {
      cust = Person.parse(blocks.customer.join('\n')).party;
      if (!cust.name) cust.name = blocks.customer.filter(function (l) { return !/^(самозанят|индивидуальный предприниматель$|заказчик)/i.test(l); })[0] || '';
    } else if (found.customer) cust = { name: found.customer.name, inn: found.customer.inn || '', kpp: found.customer.kpp || '', address: found.customer.address || '', rs: found.customer.rs || '', ks: found.customer.ks || '', bik: found.customer.bik || '', bank: found.customer.bank || '', phone: found.customer.phone || '', email: '' };
    if (blocks.executor && blocks.executor.length) exec = Person.parse(blocks.executor.join('\n')).party;
    if (!exec && found.executor) { exec = Person.empty(); exec.fio = found.executor.name || ''; exec.inn = found.executor.inn || ''; exec.type = 'ip'; }

    if (cust && blocks.customer) {
      var cn = /((?:ООО|АО|ПАО|ЗАО|НАО|ИП)\s*(?:[А-ЯЁA-Z]{1,6}\s+)?[«"“][^»"”\n]{1,80}[»"”])/.exec(blocks.customer.join('\n'));
      if (cn) cust.name = cn[1];
    }
    /* --- блок реквизитов исполнителя: заменяем целиком (набор строк зависит от вида исполнителя) --- */
    var blockDone = false;
    if (exec && blocks.executor && blocks.executor.length) {
      var N = T.map(nz), b = blocks.executor, idx = [], pi, k;
      var last = 0;
      for (k = 0; k < b.length; k++) if (REQ_WORD.test(b[k]) || /\d{9,}/.test(b[k])) last = k;
      if (last < 1) last = Math.min(1, b.length - 1);
      for (pi = 0; pi < P.length && !blockDone; pi++) {
        if (N[pi] !== b[0] || occ[pi].length) continue;
        idx = [pi]; var q = pi + 1, ok = true;
        for (k = 1; k <= last; k++) {
          while (q < P.length && N[q] === '') q++;
          if (q < P.length && N[q] === b[k]) { idx.push(q); q++; } else { ok = false; break; }
        }
        if (ok) {
          var use = idx.slice(0, last + 1);
          ops.push({ t: 'set', p: P[use[0]], text: '{{EXEC_REQ_NAME}}' });
          if (use.length > 1) {
            ops.push({ t: 'set', p: P[use[1]], text: '{{EXEC_REQ_LINES}}' });
            for (k = 2; k < use.length; k++) ops.push({ t: 'del', p: P[use[k]] });
          } else ops.push({ t: 'after', p: P[use[0]], text: '{{EXEC_REQ_LINES}}' });
          use.forEach(function (u) { block(u); });
          counts.EXEC_REQ_NAME = 1; counts.EXEC_REQ_LINES = 1;
          samples.EXEC_REQ_NAME = b[0]; samples.EXEC_REQ_LINES = b.slice(1, last + 1).join('; ');
          blockDone = true;
        }
      }
      if (!blockDone) notes.push('Блок реквизитов Исполнителя не удалось заменить целиком — заменены отдельные поля (ИНН, счёт и т. п.). Строки, которых нет в образце, надо добавить вручную.');
    }

    /* --- номер и дата договора --- */
    var cno = found.contractNo;
    if (cno) {
      each(new RegExp('(?<![A-Za-zА-Яа-яЁё0-9])' + litText(cno) + '(?![A-Za-zА-Яа-яЁё0-9])', 'g'), function (pi, m) {
        add(pi, m.index, m.index + m[0].length, 'CNO', cno);
      });
      init.tab.CNO = cno;
    }
    var cd = found.contractDate;
    if (cd) {
      var sameDate = function (d, mo, y) { return +d === cd.d && mo === cd.m && +y === cd.y; };
      each(/[«"“]\s*(\d{1,2})\s*[»"”]\s*([а-яё]+)\s*(\d{4})/gi, function (pi, m) {
        if (sameDate(m[1], RU.monthIndex(m[2]), m[3])) add(pi, m.index, m.index + m[0].length, 'CDATE_Q', m[0]);
      });
      each(/(?<![«"“\d])(\d{1,2})[\s ]+([а-яё]+)[\s ]+(\d{4})/gi, function (pi, m) {
        if (RU.monthIndex(m[2]) >= 0 && sameDate(m[1], RU.monthIndex(m[2]), m[3])) add(pi, m.index, m.index + m[0].length, 'CDATE_L', m[0]);
      });
      each(/(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/g, function (pi, m) {
        if (sameDate(m[1], +m[2] - 1, m[3])) add(pi, m.index, m.index + m[0].length, 'CDATE_D', m[0]);
      });
      init.tab.CDATE = RU.dateIso(cd);
    }

    /* --- цена и НДС --- */
    var price = null;
    each(MONEY, function (pi, m) {
      if (price || inTable[pi]) return;
      var pre = T[pi].slice(0, m.index);
      if (/(стоимост|цена)/i.test(pre) && /(составляет|равна|определ|является|в\s+размере)/i.test(pre)) {
        var v = moneyVal(m);
        if (v) price = { v: v, pi: pi };
      }
    });
    if (!price && parsed.total) price = { v: parsed.total.value };
    var vatPct = null;
    if (price) {
      init.tab.PRICE = RU.fmtMoney(price.v);
      // составляющие цены: подряд идущие суммы в тексте, дающие в сумме цену договора
      var cand = [];
      each(MONEY, function (pi, m) {
        if (inTable[pi] || (price.pi != null && (pi < price.pi || pi > price.pi + 16))) return;
        var v = moneyVal(m);
        if (v && v !== price.v && !/НДС/.test(T[pi])) cand.push({ pi: pi, idx: m.index, v: v });
      });
      var partsList = null, payN = 0;
      for (var a0 = 0; a0 < cand.length && !partsList; a0++) {
        var sum = 0;
        for (var b0 = a0; b0 < cand.length; b0++) {
          sum += cand[b0].v;
          if (sum === price.v && b0 > a0) { partsList = cand.slice(a0, b0 + 1); break; }
          if (sum > price.v) break;
        }
      }
      if (partsList) meta.parts = partsList.map(function (c) { return c.v; });
      each(MONEY, function (pi, m) {
        var v = moneyVal(m);
        var key = null;
        if (v === price.v) key = 'PRICE';
        else if (/НДС/.test(T[pi])) {
          var pm = /НДС[^\d]{0,12}(\d{1,2})\s*%/.exec(T[pi]);
          if (pm) {
            var n = +pm[1];
            if (v === Math.round(price.v * n / 100)) { key = 'VATAMT'; meta.vatMode = 'pct'; }
            else if (v === Math.round(price.v * n / (100 + n))) { key = 'VATAMT'; meta.vatMode = 'incl'; }
          }
        }
        if (!key && partsList) {
          for (var pj = 0; pj < partsList.length; pj++) if (partsList[pj].pi === pi && partsList[pj].idx === m.index) key = 'PART' + (pj + 1);
        }
        if (!key) {
          // платёж «в размере 30% стоимости … составляет X» — сумма считается от процента
          var pcm = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(T[pi].slice(0, m.index));
          if (pcm && !/НДС/.test(T[pi])) {
            var pp = parseFloat(pcm[1].replace(',', '.'));
            if (Math.abs(v - Math.round(price.v * pp / 100)) <= 1 && free(pi, pcm.index, pcm.index + pcm[1].length)) {
              key = 'PAY' + (++payN);
              add(pi, pcm.index, pcm.index + pcm[1].length, key + '_PCT', pcm[1]);
              init.tab[key + '_PCT'] = pcm[1];
            }
          }
        }
        if (!key) return;
        var d0 = m.index, d1 = m.index + m[1].length + (m[2] ? m[2].length : 0);
        if (/\u00a0/.test(m[1])) meta.nbsp = true;
        add(pi, d0, d1, key + (m[2] ? '_NUM_D' : '_NUM'), m[1] + (m[2] || ''));
        if (m[4]) {
          var ws = d1 + m[0].slice(m[1].length + (m[2] ? m[2].length : 0)).indexOf('(') + 1;
          var wsuf = 'W' + (/^[А-ЯЁ]/.test(m[4]) ? 'C' : '') + (/руб/i.test(m[4]) ? 'U' : '');
          add(pi, ws, ws + m[4].length, key + '_' + wsuf, m[4]);
          var wv = RU.wordsToInt(m[4]);
          if (!isNaN(wv) && wv !== Math.floor(v / 100)) notes.push('В образце сумма «' + m[1] + (m[2] || '') + '» и прописью «' + m[4] + '» не совпадают — в готовом договоре прописью будет верная.');
        }
        // «рублей 84 копейки» — валюта и копейки целиком, с правильным склонением
        var curWord = (m[5] || '').replace(/^[\s\u00a0]+/, '');
        if (/^рубл/i.test(curWord)) {
          var tailLen = m[6] ? m[6].length : 0;
          var wStart = m.index + m[0].length - tailLen - curWord.length;
          var comma = /,$/.test(curWord);
          if (m[6]) add(pi, wStart, m.index + m[0].length, key + (comma || /^,/.test(m[6]) ? '_CURC' : '_CUR'), curWord + m[6]);
          else add(pi, wStart, wStart + curWord.length - (comma ? 1 : 0), key + '_CURR', curWord.replace(/,$/, ''));
        }
      });
      each(/НДС[^\d]{0,12}(\d{1,2})\s*%/g, function (pi, m) {
        var s0 = m.index + m[0].lastIndexOf(m[1]);
        if (add(pi, s0, s0 + m[1].length, 'VAT_PCT', m[1])) { if (vatPct == null) vatPct = m[1]; }
      });
      if (vatPct != null) init.tab.VAT_PCT = vatPct;
      if (meta.parts) notes.push('Составляющие цены в тексте (' + meta.parts.length + ' сумм) пересчитываются пропорционально новой цене; последняя берёт остаток, чтобы сумма сошлась до копейки.');
    } else notes.push('Общую стоимость договора не нашёл — выделите сумму в тексте и сделайте её полем.');

    /* --- стороны: поля реквизитов --- */
    function same(f) { return cust && exec && cust[f] && exec[f] && nz(cust[f]) === nz(exec[f]); }
    function party(prefix, p) {
      if (!p) return;
      var isExec = prefix === 'EXEC';
      if (isExec) {
        var fio = p.type === 'org' ? (init.execDirGen ? '' : p.director) : p.fio;
        if (p.type === 'ip' && p.fio) {
          literal('ИП' + SP + p.fio, 'EXEC_SHORTNAME', 'text');
          literal('Индивидуальный предприниматель' + SP + p.fio, 'EXEC_SHORTNAME', 'text');
        }
        if (p.fio) literal(p.fio, 'EXEC_FIO', 'text');
        if (p.inn && !same('inn')) literal(p.inn, 'EXEC_INN', 'digits');
        if (p.ogrnip) literal(p.ogrnip, 'EXEC_OGRN', 'digits');
        if (p.ogrn) literal(p.ogrn, 'EXEC_OGRN', 'digits');
        if (p.kpp && !same('kpp')) literal(p.kpp, 'EXEC_KPP', 'digits');
        if (p.rs && !same('rs')) literal(p.rs, 'EXEC_RS', 'digits');
        if (p.ks && !same('ks')) literal(p.ks, 'EXEC_KS', 'digits');
        if (p.bik && !same('bik')) literal(p.bik, 'EXEC_BIK', 'digits');
        if (p.address) literal(p.address, 'EXEC_ADDR', 'text');
        if (p.bank && !same('bank')) literal(p.bank, 'EXEC_BANK', 'text');
        return;
      }
      if (p.name) { literal(p.name, 'CUST_NAME', 'text'); }
      if (samples.CUST_LONG) literal(samples.CUST_LONG, 'CUST_LONG', 'text');
      var cl = function (f, key, mode) {
        if (!p[f]) return;
        if (same(f)) { if (custRange) literal(p[f], key, mode, null, custRange[0], custRange[1]); }
        else literal(p[f], key, mode);
      };
      cl('inn', 'CUST_INN', 'digits'); cl('kpp', 'CUST_KPP', 'digits'); cl('rs', 'CUST_RS', 'digits'); cl('ks', 'CUST_KS', 'digits');
      cl('bik', 'CUST_BIK', 'digits'); cl('address', 'CUST_ADDR', 'text'); cl('bank', 'CUST_BANK', 'text');
    }
    var custRange = null;
    if (blocks.customer && blocks.customer.length > 2) {
      var Nn = T.map(nz), cb = blocks.customer;
      for (var cp = 0; cp < P.length && !custRange; cp++) {
        if (Nn[cp] !== cb[0]) continue;
        var cq = cp + 1, hi = cp, cm2 = 1;
        for (var ck = 1; ck < cb.length; ck++) {
          while (cq < P.length && Nn[cq] === '') cq++;
          if (cq < P.length && Nn[cq] === cb[ck]) { hi = cq; cq++; cm2++; } else break;
        }
        if (cm2 >= 3) custRange = [cp, hi];
      }
    }
    if (cust && cust.bank) {
      var bre = new RegExp('(?<![А-Яа-яЁё])в[\\s\\u00a0]+' + litText(cust.bank));
      if (T.some(function (t) { return bre.test(t); })) cust.bank = 'в' + SP + cust.bank;
    }
    party('CUST', cust);
    party('EXEC', exec);

    /* --- телефоны и почта --- */
    var digits10 = function (s) { return s.replace(/\D/g, '').slice(-10); };
    each(/(?:\+7|(?<!\d)8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)/g, function (pi, m) {
      var d = digits10(m[0]);
      if (cust && cust.phone && digits10(cust.phone) === d) add(pi, m.index, m.index + m[0].length, 'CUST_PHONE', m[0]);
      else if (exec && exec.phone && digits10(exec.phone) === d) add(pi, m.index, m.index + m[0].length, 'EXEC_PHONE', m[0]);
    });
    each(/[\w.+\-]+@[\w\-]+\.[\w.\-]+/g, function (pi, m) {
      var pre = /^e-?mail[-:]/i.exec(m[0]), skip = pre ? pre[0].length : 0;
      var raw = m[0].slice(skip).replace(/[.,;]+$/, ''), em = raw.toLowerCase(), at = m.index + skip;
      if (cust && cust.email && cust.email.toLowerCase() === em) add(pi, at, at + raw.length, 'CUST_EMAIL', raw);
      else if (exec && exec.email && exec.email.toLowerCase() === em) add(pi, at, at + raw.length, 'EXEC_EMAIL', raw);
    });

    /* --- руководитель и подписи Заказчика --- */
    var custStem = init.fioGen ? stemOf(init.fioGen.split(/\s+/)[0]) : (found.signer ? stemOf(found.signer.split(SP)[0]) : '');
    var Cy = '[А-Яа-яЁё]';
    if (custStem) {
      each(new RegExp('(?<!' + Cy + ')' + esc(custStem) + '[а-яё]*[\\s\\u00a0]+[А-ЯЁ][а-яё]+[\\s\\u00a0]+[А-ЯЁ][а-яё]+(?!' + Cy + ')', 'g'), function (pi, m) {
        if (add(pi, m.index, m.index + m[0].length, 'CUST_FIO', nz(m[0]))) { }
      });
      sigs('CUST', custStem);
    }
    var execStem = '';
    if (exec) {
      var en0 = exec.type === 'org' ? (init.execDirGen || exec.director) : exec.fio;
      if (en0) execStem = stemOf(en0.split(/\s+/)[0]);
      if (execStem) sigs('EXEC', execStem);
    }
    function sigs(pref, stem) {
      each(new RegExp('(?<!' + Cy + ')' + esc(stem) + '[а-яё]*[\\s\\u00a0]+[А-ЯЁ]\\.[\\s\\u00a0]*[А-ЯЁ]\\.', 'g'), function (pi, m) {
        if (/\.\s+[А-ЯЁ]\./.test(m[0])) meta.spaced = true;
        add(pi, m.index, m.index + m[0].length, pref + '_SIGNER', nz(m[0]));
      });
      each(new RegExp('(?<!' + Cy + ')[А-ЯЁ]\\.[\\s\\u00a0]*[А-ЯЁ]\\.[\\s\\u00a0]*' + esc(stem) + '[а-яё]*(?!' + Cy + ')', 'g'), function (pi, m) {
        add(pi, m.index, m.index + m[0].length, pref + '_SIGNER_R', nz(m[0]));
      });
    }

    /* --- должность в блоке подписи --- */
    P.forEach(function (p, pi) {
      var key = null;
      edits[pi].forEach(function (e) { if (/^(CUST|EXEC)_SIGNER(_R)?$/.test(e.key)) key = e.key.slice(0, 4); });
      if (!key) return;
      for (var q = pi - 1, empties = 0; q >= 0 && empties < 10; q--) {
        var s = nz(T[q]);
        if (!s) { empties++; continue; }
        if (P[q].parentNode !== p.parentNode && !(P[q].parentNode === p.parentNode)) break;
        if (occ[q].length || s.length > 60 || /[:_]/.test(s) || REQ_WORD.test(s) || /\d{6,}/.test(s)) break;
        add(q, 0, T[q].length, key + '_SIGN_POST', s);
        break;
      }
    });

    /* --- город, объект, предмет --- */
    for (var ci = 0; ci < Math.min(P.length, 14); ci++) {
      var cm = /^\s*(г\.\s*[А-ЯЁ][А-Яа-яЁё\-]+(?:[ \-][А-ЯЁ][а-яё\-]+)?)\s*$/.exec(T[ci]);
      if (cm) { add(ci, T[ci].indexOf(cm[1]), T[ci].indexOf(cm[1]) + cm[1].length, 'CITY', cm[1]); break; }
    }
    if (found.object) {
      var obj = nz(found.object);
      if (/^[«"“]/.test(obj)) { obj = obj.replace(/^[«"“]\s*/, ''); var qe = obj.search(/[»"”]/); if (qe > 0) obj = obj.slice(0, qe); }
      obj = obj.replace(/\s*[»"”]$/, '');
      if (obj.length > 8) {
        var n0 = literal(obj, 'OBJECT', 'loose', obj);
        if (!n0) notes.push('Объект из договора не нашёл в тексте для замены — выделите его и сделайте полем.');
        samples.OBJECT = obj;
      }
    }
    each(/(?:обязуется|обязан[аы]?)\s+(?:разработать|выполнить|оказать|подготовить)\s+(.+?)\s+по\s+объекту/g, function (pi, m) {
      var s0 = m.index + m[0].indexOf(m[1], 5);
      add(pi, s0, s0 + m[1].length, 'SUBJECT', m[1]);
    });
    if (samples.SUBJECT) init.tab.SUBJECT = samples.SUBJECT;

    /* --- применяем --- */
    P.forEach(function (p, pi) {
      edits[pi].sort(function (a, b) { return b.s - a.s; }).forEach(function (e) { replaceRange(p, e.s, e.e, '{{' + e.key + '}}'); });
    });
    ops.forEach(function (o) {
      if (o.t === 'set') replaceAll(o.p, o.text);
      else if (o.t === 'del') o.p.parentNode.removeChild(o.p);
      else if (o.t === 'after') {
        var cl = o.p.cloneNode(true); replaceAll(cl, o.text); o.p.parentNode.insertBefore(cl, o.p.nextSibling);
      }
    });

    // исходные значения Заказчика и Исполнителя
    if (cust) {
      var cv = init.common;
      cv.CUST_NAME = samples.CUST_NAME || cust.name || '';
      cv.CUST_LONG = samples.CUST_LONG || '';
      cv.CUST_REP_POST = samples.CUST_REP_POST || '';
      cv.CUST_REP_BASIS = samples.CUST_REP_BASIS || '';
      cv.CUST_FIO = samples.CUST_FIO || '';
      cv.CUST_SIGN_POST = samples.CUST_SIGN_POST || '';
      cv.CUST_INN = cust.inn || ''; cv.CUST_KPP = cust.kpp || ''; cv.CUST_ADDR = nz(cust.address || '');
      cv.CUST_RS = cust.rs || ''; cv.CUST_KS = cust.ks || ''; cv.CUST_BIK = cust.bik || ''; cv.CUST_BANK = nz(cust.bank || '');
      cv.CUST_PHONE = cust.phone || samples.CUST_PHONE || ''; cv.CUST_EMAIL = cust.email || '';
      if (samples.CUST_FIO_GEN) init.ov.CUST_FIO_GEN = samples.CUST_FIO_GEN;
      if (samples.CUST_SIGNER) init.ov.CUST_SIGNER = samples.CUST_SIGNER;
      if (samples.CUST_SIGNER_R) init.ov.CUST_SIGNER_R = samples.CUST_SIGNER_R;
    }
    if (found.object) init.common.OBJECT = samples.OBJECT || '';
    if (samples.CITY) init.common.CITY = samples.CITY;
    if (exec) {
      init.exec = exec;
      if (exec.type === 'org' && !exec.director && init.execDirGen) exec.director = init.execDirGen;
    }
    if (samples.EXEC_INTRO) init.ov.EXEC_INTRO = samples.EXEC_INTRO;
    if (samples.EXEC_SIGN_POST) init.execSignPost = samples.EXEC_SIGN_POST;

    var xml = Docx.serialize(doc);
    return { xml: xml, samples: samples, counts: counts, init: init, notes: notes, meta: meta };
  }

  /* ---------- подстановка ---------- */

  function tokensOf(xml) {
    var out = {}, m;
    TOK.lastIndex = 0;
    var txt = '';
    var doc = Docx.parseXml(xml);
    paras(doc).forEach(function (p) {
      var t = ptext(p);
      TOK.lastIndex = 0;
      while ((m = TOK.exec(t))) out[m[1]] = (out[m[1]] || 0) + 1;
    });
    return out;
  }

  /** @param valFn  key → string | string[] (для *_LINES) | undefined (неизвестная метка остаётся) */
  function fill(xml, valFn) {
    var doc = Docx.parseXml(xml);
    paras(doc).forEach(function (p) {
      var text = ptext(p);
      if (text.indexOf('{{') < 0) return;
      var toks = [], m;
      TOK.lastIndex = 0;
      while ((m = TOK.exec(text))) toks.push({ s: m.index, e: m.index + m[0].length, key: m[1] });
      var lineTok = toks.filter(function (t) { return /_LINES$/.test(t.key); })[0];
      function apply(par, lineVal) {
        var ts = toks.slice().sort(function (a, b) { return b.s - a.s; });
        var allEmpty = true, anyKnown = false;
        var rest = text.replace(TOK, '');
        if (nz(rest).length > 40) allEmpty = false;
        ts.forEach(function (t) {
          var v = t.key === (lineTok && lineTok.key) ? lineVal : valFn(t.key);
          if (v === undefined) { allEmpty = false; return; }
          anyKnown = true;
          if (Array.isArray(v)) v = v.join('; ');
          v = String(v == null ? '' : v).replace(/[\r\n]+/g, SP);
          if (v !== '') allEmpty = false;
          replaceRange(par, t.s, t.e, v);
          void 0;
        });
        return anyKnown && allEmpty;
      }
      var tc = p.parentNode && p.parentNode.localName === 'tc' ? p.parentNode : null;
      if (lineTok) {
        var lines = valFn(lineTok.key) || [];
        if (!Array.isArray(lines)) lines = [lines];
        lines.forEach(function (ln1) {
          var cp = p.cloneNode(true);
          apply(cp, ln1);
          p.parentNode.insertBefore(cp, p);
        });
        removeOrBlank(p, tc);
        return;
      }
      if (apply(p, null)) removeOrBlank(p, tc);
    });
    return Docx.serialize(doc);
  }

  function removeOrBlank(p, tc) {
    if (tc && children(tc, 'p').length <= 1) replaceAll(p, '');
    else p.parentNode.removeChild(p);
  }

  /* ---------- предпросмотр ---------- */

  var PX = 1 / 15;
  function borderCss(b) {
    if (!b) return null;
    var v = wval(b);
    if (!v || v === 'nil' || v === 'none') return null;
    var sz = parseInt(b.getAttributeNS(W, 'sz') || '4', 10);
    return Math.max(1, Math.round(sz / 8 * 96 / 72)) + 'px solid #000';
  }

  /** @param ctx {pmap:Map, val:fn(key)→string|array|undefined, label:fn(key)→string} */
  function renderPage(doc, ctx) {
    var body = ln(doc, 'body')[0];
    var page = document.createElement('div');
    page.className = 'wpage';
    var pmap = new Map();
    paras(doc).forEach(function (p, i) { pmap.set(p, i); });
    ctx.pmap = pmap;

    function renderPara(p) {
      var d = document.createElement('div');
      d.className = 'p';
      d.setAttribute('data-pi', pmap.get(p));
      var ppr = child(p, 'pPr');
      var jc = ppr ? wval(child(ppr, 'jc')) : null;
      if (jc === 'center') d.style.textAlign = 'center';
      else if (jc === 'right' || jc === 'end') d.style.textAlign = 'right';
      else if (jc === 'both') d.style.textAlign = 'justify';
      var allEmptyTok = false, hasTok = false, nonTokText = false;
      for (var c = p.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1 || c.namespaceURI !== W || c.localName !== 'r') continue;
        var rpr = child(c, 'rPr'), st = [];
        if (rpr) {
          if (child(rpr, 'b') && wval(child(rpr, 'b')) !== '0') st.push('font-weight:700');
          if (child(rpr, 'i') && wval(child(rpr, 'i')) !== '0') st.push('font-style:italic');
          if (child(rpr, 'u') && wval(child(rpr, 'u')) !== 'none') st.push('text-decoration:underline');
          var sz = child(rpr, 'sz');
          if (sz) st.push('font-size:' + (parseInt(wval(sz), 10) / 2) + 'pt');
        }
        for (var k = c.firstChild; k; k = k.nextSibling) {
          if (k.nodeType !== 1 || k.namespaceURI !== W) continue;
          if (k.localName === 'tab') {
            var tb = document.createElement('span'); tb.className = 'tab'; tb.innerHTML = '&nbsp;'; tb.setAttribute('contenteditable', 'false'); d.appendChild(tb);
          } else if (k.localName === 'br') {
            var br = document.createElement('span'); br.className = 'brk'; br.setAttribute('contenteditable', 'false'); br.innerHTML = '<br>'; d.appendChild(br);
          } else if (k.localName === 't') {
            var text = k.textContent, last = 0, m;
            TOK.lastIndex = 0;
            function lit(s) {
              if (!s) return;
              nonTokText = nonTokText || /\S/.test(s);
              var sp = document.createElement('span');
              if (st.length) sp.setAttribute('style', st.join(';'));
              sp.textContent = s;
              d.appendChild(sp);
            }
            while ((m = TOK.exec(text))) {
              lit(text.slice(last, m.index));
              last = m.index + m[0].length;
              hasTok = true;
              var v = ctx.val(m[1]);
              var chip = document.createElement('span');
              chip.className = 'chip' + (v === undefined ? ' unk' : (v === '' || (Array.isArray(v) && !v.length)) ? ' blank' : '');
              chip.setAttribute('data-tk', m[1]);
              chip.setAttribute('contenteditable', 'false');
              if (st.length) chip.setAttribute('style', st.join(';'));
              if (Array.isArray(v)) chip.innerHTML = v.map(function (x) { return x.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }).join('<br>') || '';
              else chip.textContent = v === undefined ? '{{' + m[1] + '}}' : (v === '' ? '‹' + ctx.label(m[1]) + '›' : v);
              if (!(Array.isArray(v) ? v.length : v)) allEmptyTok = true;
              d.appendChild(chip);
            }
            lit(text.slice(last));
          }
        }
      }
      if (!d.firstChild) d.innerHTML = '&nbsp;';
      if (hasTok && nz(d.textContent.replace(/‹[^›]*›/g, '')).length <= 40) {
        // абзац только из меток: если все пусты — в договор он не попадёт
        var emptyAll = true;
        Array.prototype.forEach.call(d.querySelectorAll('.chip'), function (ch) { if (!ch.classList.contains('blank')) emptyAll = false; });
        if (emptyAll) d.classList.add('dropped');
      }
      return d;
    }

    function renderTable(tbl) {
      var table = document.createElement('table');
      table.className = 'wtbl';
      var grid = child(tbl, 'tblGrid');
      var cols = grid ? children(grid, 'gridCol') : [];
      var total = 0, cg = document.createElement('colgroup');
      cols.forEach(function (gc) {
        var w = parseInt(gc.getAttributeNS(W, 'w'), 10) * PX; total += w;
        var col = document.createElement('col'); col.style.width = w + 'px'; cg.appendChild(col);
      });
      if (total) table.style.width = total + 'px';
      table.appendChild(cg);
      var tb = document.createElement('tbody');
      children(tbl, 'tr').forEach(function (tr) {
        var row = document.createElement('tr');
        children(tr, 'tc').forEach(function (tc) {
          var td = document.createElement('td');
          var pr = child(tc, 'tcPr');
          if (pr) {
            var gs = child(pr, 'gridSpan'); if (gs) td.colSpan = parseInt(wval(gs), 10);
            var va = child(pr, 'vAlign');
            if (va && wval(va) === 'bottom') td.style.verticalAlign = 'bottom'; else if (va && wval(va) === 'center') td.style.verticalAlign = 'middle';
            var bs = child(pr, 'tcBorders');
            if (bs) [['top', 'borderTop'], ['left', 'borderLeft'], ['bottom', 'borderBottom'], ['right', 'borderRight']].forEach(function (pair) {
              var css = borderCss(child(bs, pair[0])); if (css) td.style[pair[1]] = css;
            });
          }
          for (var c = tc.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
            if (c.localName === 'p') td.appendChild(renderPara(c));
            else if (c.localName === 'tbl') td.appendChild(renderTable(c));
          }
          row.appendChild(td);
        });
        tb.appendChild(row);
      });
      table.appendChild(tb);
      return table;
    }

    for (var c = body.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'tbl') page.appendChild(renderTable(c));
      else if (c.localName === 'p') page.appendChild(renderPara(c));
    }
    return page;
  }

  /** Текст абзаца-блока предпросмотра обратно в вид шаблона («метки» вместо значений). */
  function readBack(div) {
    var s = '';
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) s += c.nodeValue.replace(/​/g, '');
        else if (c.nodeType === 1) {
          if (c.classList.contains('chip')) s += '{{' + c.getAttribute('data-tk') + '}}';
          else if (c.classList.contains('tab') || c.classList.contains('brk')) continue;
          else if (c.tagName === 'BR') continue;
          else walk(c);
        }
      }
    })(div);
    return s.replace(/ $/, function (x) { return x; });
  }

  /** Смещение в тексте шаблона для точки выделения внутри абзаца предпросмотра; -1, если точка внутри метки. */
  function offsetIn(div, node, off) {
    var total = 0, res = -1, done = false;
    (function walk(n) {
      for (var c = n.firstChild; c && !done; c = c.nextSibling) {
        if (c === node && c.nodeType === 3) { res = total + off; done = true; return; }
        if (c.nodeType === 3) total += c.nodeValue.length;
        else if (c.nodeType === 1) {
          if (c.classList.contains('chip')) {
            if (c === node || c.contains(node)) { res = -1; done = true; return; }
            total += ('{{' + c.getAttribute('data-tk') + '}}').length;
          } else if (c.classList.contains('tab') || c.classList.contains('brk')) continue;
          else {
            if (c === node) { // выделение на границе элемента: считаем по числу дочерних
              var cnt = 0; for (var k = c.firstChild; k && cnt < off; k = k.nextSibling, cnt++) total += textLen(k);
              res = total; done = true; return;
            }
            walk(c);
          }
        }
      }
    })(div);
    if (!done && node === div) {
      var cnt2 = 0, tt = 0;
      for (var k2 = div.firstChild; k2 && cnt2 < off; k2 = k2.nextSibling, cnt2++) tt += textLen(k2);
      return tt;
    }
    return res;
  }
  function textLen(n) {
    if (n.nodeType === 3) return n.nodeValue.length;
    if (n.nodeType === 1) {
      if (n.classList.contains('chip')) return ('{{' + n.getAttribute('data-tk') + '}}').length;
      if (n.classList.contains('tab') || n.classList.contains('brk')) return 0;
      var s = 0; for (var c = n.firstChild; c; c = c.nextSibling) s += textLen(c);
      return s;
    }
    return 0;
  }

  /** Применяет правку абзаца: заменяет только изменившуюся середину, форматирование вокруг сохраняется. */
  function applyEdit(p, newText) {
    var old = ptext(p);
    if (old === newText) return false;
    var a = 0;
    while (a < old.length && a < newText.length && old.charAt(a) === newText.charAt(a)) a++;
    var b = 0;
    while (b < old.length - a && b < newText.length - a && old.charAt(old.length - 1 - b) === newText.charAt(newText.length - 1 - b)) b++;
    replaceRange(p, a, old.length - b, newText.slice(a, newText.length - b));
    return true;
  }

  g.Ctpl = {
    analyze: analyze, fill: fill, tokensOf: tokensOf, renderPage: renderPage, readBack: readBack, offsetIn: offsetIn,
    applyEdit: applyEdit, paras: paras, ptext: ptext, replaceRange: replaceRange, replaceAll: replaceAll, nz: nz, litText: litText
  };
})(window);
