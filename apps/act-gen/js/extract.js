/* Разбор договора (.docx): стороны, номер и дата, предмет по стадиям, платежи, НДС.
   Договоры пишут по-разному, поэтому: несколько способов поиска каждого поля, цитата из договора
   рядом с найденным, а всё сомнительное — в список предупреждений. Ничего не угадываем молча. */
(function (g) {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var SP = String.fromCharCode(32);

  function norm(s) { return String(s).replace(/[   ]/g, SP).replace(/[ \t]+/g, SP).trim(); }
  function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  /** «разработки …» / «разработку …» (падеж из фразы договора) → «Разработка …» */
  function fixTitle(s) {
    s = s.trim().replace(/^разработк[иу](?=\s)/i, 'Разработка').replace(/^выполнени[яю](?=\s)/i, 'Выполнение');
    return capFirst(s);
  }

  /** Абзацы договора в порядке чтения. Для текста в таблицах — номер внешней ячейки (вложенные таблицы входят в неё). */
  function readLines(documentXml) {
    var doc = Docx.parseXml(documentXml);
    var body = doc.getElementsByTagNameNS(W, 'body')[0];
    var lines = [];
    var cellId = 0;
    function paraLines(p, cell) {
      var s = '';
      (function walk(n) {
        for (var c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
          if (c.localName === 't') s += c.textContent;
          else if (c.localName === 'tab') s += SP;
          else if (c.localName === 'br') s += '\n';
          else if (c.localName === 'del' || c.localName === 'tbl') continue;
          else walk(c);
        }
      })(p);
      s.split('\n').forEach(function (part) {
        var t = norm(part);
        if (t) lines.push({ text: t, cell: cell });
      });
    }
    function walkBlock(parent, cell) {
      for (var c = parent.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
        if (c.localName === 'p') paraLines(c, cell);
        else if (c.localName === 'tbl') {
          for (var tr = c.firstChild; tr; tr = tr.nextSibling) {
            if (tr.nodeType !== 1 || tr.localName !== 'tr') continue;
            for (var tc = tr.firstChild; tc; tc = tc.nextSibling) {
              if (tc.nodeType === 1 && tc.localName === 'tc') walkBlock(tc, cell == null ? ++cellId : cell);
            }
          }
        } else if (c.localName === 'sdt') {
          var content = null;
          for (var k = c.firstChild; k; k = k.nextSibling) if (k.localName === 'sdtContent') content = k;
          if (content) walkBlock(content, cell);
        }
      }
    }
    walkBlock(body, null);
    return lines;
  }

  /* ---------- заголовки разделов ---------- */

  function isHeadingCaps(t) {
    var s = t.replace(/^\d+[.)]?\s*/, '');
    return s.length >= 6 && s.length < 100 && s === s.toUpperCase() && /[А-ЯЁ]{3}/.test(s) && !/\d{4}/.test(s) && s.indexOf('№') < 0;
  }
  var HEAD_WORDS = /^(?:\d+[.)]?\s*)?(предмет|размер|стоимост|цена|порядок|срок|права|обязанност|ответственност|гаранти|форс|споры|разрешени|заключительн|прочие|реквизит|адрес|расторжени|конфиденциальн|прием|приём|сдач|условия|подписи|юридическ|передача)/i;
  function isHeading(t) {
    if (isHeadingCaps(t)) return true;
    return t.length < 90 && !/[.;:,]$/.test(t) && HEAD_WORDS.test(t) && t.split(SP).length <= 10;
  }

  /** Раздел: от заголовка по startRe до следующего заголовка, не подходящего под contRe. */
  function section(lines, startRe, contRe) {
    var from = -1, i;
    for (i = 0; i < lines.length; i++) {
      if (isHeading(lines[i].text) && startRe.test(lines[i].text)) { from = i + 1; break; }
    }
    if (from < 0) return { from: -1, lines: [] };
    var to = lines.length;
    for (var j = from; j < lines.length; j++) {
      if (isHeading(lines[j].text) && !(contRe && contRe.test(lines[j].text))) { to = j; break; }
    }
    return { from: from, lines: lines.slice(from, to).map(function (l) { return l.text; }) };
  }

  /* ---------- вспомогательное ---------- */

  var STAGE_RE = /^[\s\-–—•*]*(проектн\S*\s+документаци\S*|рабоч\S*\s+документаци\S*|проектно-сметн\S*\s+документаци\S*)\s*:?\s*$/i;
  var ITEM_START = /^(раздел|том|подраздел|часть|книга|альбом|[-–—•*]|\d+[.)]\s)/i;
  var STOP_CLAUSE = /^\d+\.\d+|соответствовать|являющ|постановлен|срок\s+(начала|окончания)/i;

  var AMOUNT_RE = /(\d{1,3}(?:[ ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(?:\(([^)]+)\))?\s*(?:руб\S*|₽)(?:\s*\(([^)]+)\))?(?:\s+(\d{1,2})\s*коп)?/gi;

  function stageKey(title) {
    var s = title.toLowerCase();
    if (s.indexOf('проектно-сметн') >= 0) return 'пс';
    if (s.indexOf('проектн') >= 0) return 'п';
    if (s.indexOf('рабоч') >= 0) return 'р';
    return s;
  }

  function findAmounts(text) {
    var out = [], m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(text))) {
      var kop = m[5] ? parseInt(m[5], 10) : (m[2] ? parseInt((m[2] + '0').slice(0, 2), 10) : 0);
      out.push({ digits: parseInt(m[1].replace(/ /g, ''), 10), kop: kop, words: m[3] || m[4] || '' });
    }
    return out;
  }

  /** Значение суммы в копейках + замечание, если цифры и слова в договоре расходятся. */
  function amountValue(a) {
    var val = a.digits * 100 + a.kop, note = null;
    if (a.words) {
      var wv = RU.wordsToInt(a.words);
      if (!isNaN(wv) && wv * 100 !== a.digits * 100) {
        if (a.digits * 1000 === wv) { val = wv * 100 + a.kop; note = 'в договоре «' + a.digits + '», прописью «' + a.words + '» — принято ' + RU.fmtMoney(val) + ' (в цифрах опечатка)'; }
        else note = 'в договоре цифрами ' + RU.fmtMoney(val) + ', а прописью «' + a.words + '» (' + RU.fmtMoney(wv * 100) + '); принято по цифрам — проверьте';
      }
    }
    return { value: val, note: note };
  }

  function parseDate(text) {
    var m = /[«"“]\s*(\d{1,2})\s*[»"”]\s*([а-яё]+)\s*(\d{4})/i.exec(text);
    if (m) { var mi = RU.monthIndex(m[2]); if (mi >= 0) return { d: +m[1], m: mi, y: +m[3] }; }
    m = /(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i.exec(text);
    if (m) { var mi2 = RU.monthIndex(m[2]); if (mi2 >= 0) return { d: +m[1], m: mi2, y: +m[3] }; }
    m = /(\d{1,2})\.(\d{2})\.(\d{4})/.exec(text);
    if (m) return { d: +m[1], m: +m[2] - 1, y: +m[3] };
    return null;
  }

  /* ---------- реквизиты ---------- */

  var STATUS_ONLY = /^(самозанят\S*|индивидуальный предприниматель|ип|физическое лицо|гражданин\S*)$/i;

  function digitsAfter(txt, labelRe, n) {
    var re = new RegExp(labelRe + '[^0-9]{0,25}((?:\\d[ ]?){' + (n - 1) + '}\\d)', 'i');
    var m = re.exec(txt);
    if (!m) return null;
    var d = m[1].replace(/ /g, '');
    return d.length === n ? d : null;
  }

  function parseRequisites(block) {
    var r = {}, txt = block.join('\n'), m, i;
    for (i = 0; i < block.length; i++) {
      var t = block[i].replace(/^(заказчик|исполнитель|подрядчик|проектировщик)\s*:\s*/i, '').trim();
      if (!t || STATUS_ONLY.test(t) || /^наименование\s*:?$/i.test(t)) continue;
      r.name = t.replace(/^наименование\s*:\s*/i, '');
      break;
    }
    r.name = (r.name || '').replace(/^самозанят\S*\s+/i, '').replace(/^индивидуальный предприниматель\s+/i, 'ИП ');
    m = /ИНН(?:\s*\/\s*КПП)?[^0-9]{0,4}(\d{10,12})/i.exec(txt); if (m) r.inn = m[1];
    m = /ИНН\s*\/\s*КПП[^0-9]{0,6}(\d{10,12})\s*\/\s*(\d{9})/i.exec(txt);
    if (m) { r.inn = m[1]; r.kpp = m[2]; }
    else { m = /КПП[^0-9]{0,4}(\d{9})(?!\d)/i.exec(txt); if (m) r.kpp = m[1]; }
    for (i = 0; i < block.length; i++) {
      if (/адрес/i.test(block[i]) && !/@|эл\.?\s*почт/i.test(block[i])) {
        var after = block[i].replace(/^.*?адрес[^:]*:\s*/i, '').trim();
        var j = i + 1;
        if (!after && block[j]) after = block[j++];
        while (/,\s*$/.test(after) && block[j] && !/^(инн|огрн|кпп|р\/с|эл|тел)/i.test(block[j])) after += SP + block[j++];
        r.address = after.replace(/^по адресу\s*/i, '').replace(/[;,\s]+$/, '');
        break;
      }
    }
    if (!r.address) {
      for (i = 1; i < block.length; i++) {
        if (/^\d{6}\s*,/.test(block[i]) || (/(^|\s)(ул\.|ул\s|пр-кт|пер\.|проезд|д\.\s*\d)/i.test(block[i]) && !/инн|р\/с|огрн|@|банк/i.test(block[i]))) { r.address = block[i].replace(/[;,\s]+$/, ''); break; }
      }
    }
    r.rs = digitsAfter(txt, '(?:р\\s*\\/\\s*с|р\\.\\s*с|расч[её]тный\\s+сч[её]т|номер\\s+сч[её]та|сч[её]т)', 20) || undefined;
    r.ks = digitsAfter(txt, '(?:к\\s*\\/\\s*с|корр?\\.?\\s*сч[её]т)', 20) || undefined;
    r.bik = digitsAfter(txt, 'БИК', 9) || undefined;
    for (i = 0; i < block.length; i++) {
      var bm = /^(?:название\s+)?банк[а-я ]{0,12}:\s*(.+)$/i.exec(block[i]);
      if (bm) { r.bank = bm[1]; break; }
    }
    if (!r.bank) {
      for (i = 0; i < block.length; i++) {
        if (/банк/i.test(block[i]) && !/^бик/i.test(block[i]) && !/@|инн|р\/с|сч[её]т/i.test(block[i])) { r.bank = block[i]; break; }
      }
    }
    if (r.bank) r.bank = r.bank.replace(/^в\s+/i, '').replace(/[;,.\s]+$/, '');
    m = /(?:тел(?:ефон)?\.?|т\.)[:\s]*(\+?\d[\d\s()\-]{9,})/i.exec(txt); if (m) r.phone = m[1].trim().replace(/\s+$/, '');
    return r;
  }

  var LABEL_RE = /^(заказчик|исполнитель|подрядчик|проектировщик)\s*(?::\s*(.*))?$/i;

  /** Делит весь договор на сегменты «метка стороны + её данные». Метка может стоять в той же ячейке, что и данные, или в соседней. */
  function findParties(lines) {
    var segs = [], cur = null, lastCell;
    lines.forEach(function (l, idx) {
      var lm = LABEL_RE.exec(l.text);
      var isLabel = lm && l.text.length <= 70 && (lm[2] !== undefined || /^[А-ЯЁ]+$/.test(lm[1]) || lm[0] === lm[1]);
      if (isLabel && lm[2] === undefined && !/^[А-ЯЁ]+$/.test(lm[1]) && l.cell == null) isLabel = false; // «Заказчик» обычным текстом — не метка
      var newSeg = isLabel || !cur || l.cell !== lastCell;
      if (newSeg) {
        cur = { role: null, lines: [], cell: l.cell, at: idx };
        segs.push(cur);
      }
      if (isLabel) {
        cur.role = /^заказчик$/i.test(lm[1]) ? 'customer' : 'executor';
        if (lm[2]) cur.lines.push(lm[2]);
      } else cur.lines.push(l.text);
      lastCell = l.cell;
    });
    var queue = [], best = {};
    function score(sc) {
      var t = sc.lines.join('\n');
      var s = 0;
      if (/ИНН[^0-9]{0,4}\d{10,12}/i.test(t)) s += 3;
      if (/(?:\d[ ]?){19}\d/.test(t)) s += 3;
      if (/БИК/i.test(t)) s += 2;
      if (sc.lines.length >= 4) s += 1;
      return s + Math.min(sc.lines.length, 12) / 20;
    }
    segs.forEach(function (sg) {
      var role = sg.role;
      if (role && !sg.lines.length) { queue.push(role); return; }
      if (!role && queue.length && sg.lines.length) role = queue.shift();
      if (!role) return;
      var sc = score(sg);
      if (!best[role] || sc > best[role].score) best[role] = { score: sc, lines: sg.lines };
    });
    return best;
  }

  /** Запасной вариант: название из преамбулы (если реквизитов в конце нет). */
  function preambleParty(pre, roleWords) {
    var re = new RegExp('именуем\\S*\\s+в\\s+дальнейшем\\s+[«"“]?\\s*(?:' + roleWords + ')', 'i');
    var m = re.exec(pre);
    if (!m) return null;
    var before = pre.slice(Math.max(0, m.index - 400), m.index);
    var org = null, mo, ore = /((?:ООО|АО|ПАО|ЗАО|НАО|ИП)\s*[«"“][^»"”]{2,70}[»"”])/g;
    while ((mo = ore.exec(before))) org = mo[1];
    var res = {};
    if (org) res.name = org;
    else {
      var pm, person = null, pre2 = /([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/g;
      while ((pm = pre2.exec(before))) person = pm[1];
      if (person) res.name = person;
    }
    var im = /ИНН\s*:?\s*(\d{10,12})/i.exec(before); if (im) res.inn = im[1];
    return res.name ? res : null;
  }

  /* ---------- главная функция ---------- */

  function parseContract(lines) {
    var res = { found: {}, src: {}, warnings: [], stages: [], payments: [] };
    var warn = function (level, text) { res.warnings.push({ level: level, text: text }); };
    var all = lines.map(function (l) { return l.text; });
    var i;

    // --- номер и дата ---
    var head = all.slice(0, 14);
    for (i = 0; i < head.length; i++) {
      var mm = /договор[^№\n]{0,60}№\s*([^\s,;]+)/i.exec(head[i]);
      if (mm) { res.found.contractNo = mm[1].replace(/[.,;]+$/, ''); res.src.contractNo = head[i]; break; }
    }
    for (var d = 0; d < head.length; d++) {
      var dt = parseDate(head[d]);
      if (dt) { res.found.contractDate = dt; res.src.contractDate = head[d]; break; }
    }
    if (!res.found.contractNo) warn('err', 'Не нашёл номер договора — введите вручную.');
    if (!res.found.contractDate) warn('err', 'Не нашёл дату договора — введите вручную.');

    // --- преамбула: директор Заказчика ---
    var pre = all.slice(0, 14).join(SP);
    var dir = /в\s+лице\s+(.+?),\s*действующ/i.exec(pre);
    var dirWords = dir ? dir[1].trim().split(/\s+/) : [];
    var dirSurnameGen = '';
    if (dirWords.length >= 3) dirSurnameGen = dirWords[dirWords.length - 3];

    // --- подписи ---
    var sigs = [], sm;
    var tail = all.slice(Math.max(0, all.length - 80)).join('\n');
    var sre = /([А-ЯЁ])\.\s*([А-ЯЁ])\.\s*([А-ЯЁ][а-яё\-]+)/g;
    while ((sm = sre.exec(tail))) sigs.push({ sur: sm[3], ini: sm[1] + '.' + SP + sm[2] + '.', raw: sm[0] });
    var sre2 = /([А-ЯЁ][а-яё\-]+)\s+([А-ЯЁ])\.\s*([А-ЯЁ])\./g;
    while ((sm = sre2.exec(tail))) sigs.push({ sur: sm[1], ini: sm[2] + '.' + SP + sm[3] + '.', raw: sm[0] });

    // --- стороны ---
    var parties = findParties(lines);
    res.blocks = { customer: parties.customer ? parties.customer.lines : null, executor: parties.executor ? parties.executor.lines : null };
    if (parties.customer) {
      res.found.customer = parseRequisites(parties.customer.lines);
      res.src.customer = parties.customer.lines.slice(0, 3).join(' / ');
    } else {
      var pc = preambleParty(pre, 'Заказчик');
      if (pc) { res.found.customer = pc; res.src.customer = pc.name + ' (из вводной части договора)'; warn('warn', 'Реквизиты Заказчика в конце договора не найдены — взято только название из вводной части. Остальное (адрес, счёт, банк) заполните вручную.'); }
      else warn('err', 'Не нашёл Заказчика — заполните вручную.');
    }
    if (parties.executor) {
      res.found.executor = parseRequisites(parties.executor.lines);
      res.src.executor = parties.executor.lines.slice(0, 2).join(' / ');
    } else {
      var pe = preambleParty(pre, 'Исполнитель|Подрядчик|Проектировщик') || null;
      if (pe) { res.found.executor = pe; res.src.executor = pe.name + ' (из вводной части договора — проверьте падеж)'; warn('warn', 'Исполнитель взят из вводной части договора (там он может стоять в косвенном падеже) — проверьте ФИО.'); }
      else warn('err', 'Не нашёл Исполнителя — заполните вручную.');
    }
    var cust = res.found.customer;
    if (cust && !cust.rs && !cust.inn) warn('warn', 'У Заказчика не найдены ИНН и счёт — проверьте блок «Заказчик».');

    if (dirSurnameGen && sigs.length) {
      var stem = dirSurnameGen.slice(0, Math.max(4, dirSurnameGen.length - 3)).toLowerCase();
      var hit = null;
      sigs.forEach(function (s) { if (!hit && s.sur.toLowerCase().indexOf(stem) === 0) hit = s; });
      if (hit) { res.found.signer = hit.sur + SP + hit.ini; res.src.signer = hit.raw + ' (директор: ' + dir[1].trim() + ')'; }
    }
    if (!res.found.signer && cust && /^[А-ЯЁ][а-яё\-]+(\s+[А-ЯЁ][а-яё\-]+){2}$/.test(cust.name || '')) {
      var pw = cust.name.split(/\s+/);
      res.found.signer = pw[0] + SP + pw[1].charAt(0) + '.' + SP + pw[2].charAt(0) + '.';
      res.src.signer = 'Заказчик — физическое лицо / ИП: ' + cust.name;
    }
    if (!res.found.signer) warn('warn', 'Подписанта Заказчика определить не удалось — впишите «Фамилия И. О.».');

    // --- предмет договора ---
    var subj = section(lines, /предмет/i);
    var sl = subj.lines;
    var stages = [], byKey = {}, mode = null, curStage = null, object = '';
    for (i = 0; i < sl.length; i++) {
      var t = sl[i];
      var sh = STAGE_RE.exec(t);
      if (sh) {
        var key = stageKey(sh[1]);
        if (byKey[key]) { curStage = byKey[key]; mode = 'terms'; }
        else {
          curStage = { key: key, title: capFirst(sh[1].replace(/\s+/g, SP).toLowerCase()), lines: [], start: null, end: null };
          byKey[key] = curStage; stages.push(curStage); mode = 'items';
        }
        continue;
      }
      if (/^объект\s*:/i.test(t)) {
        object = t.replace(/^объект\s*:\s*/i, '');
        while (i + 1 < sl.length && !/[.»;]$/.test(object) && !STOP_CLAUSE.test(sl[i + 1]) && !STAGE_RE.test(sl[i + 1])) object += SP + sl[++i];
        res.src.object = t; mode = null; continue;
      }
      if (mode === 'terms' && curStage) {
        var ms = /срок\s+начала[^:]*:\s*(.+)$/i.exec(t), me = /срок\s+окончания[^:]*:\s*(.+)$/i.exec(t);
        if (ms) curStage.start = parseDate(ms[1]);
        if (me) curStage.end = parseDate(me[1]);
        if (!ms && !me && STOP_CLAUSE.test(t)) mode = null;
        continue;
      }
      if (mode === 'items' && curStage) {
        if (STOP_CLAUSE.test(t)) { mode = null; continue; }
        var clean = t.replace(/^[\s\-–—•*]+/, '');
        var last = curStage.lines.length ? curStage.lines[curStage.lines.length - 1] : null;
        if (!last || ITEM_START.test(t) || /[;.:]$/.test(last)) curStage.lines.push(clean);
        else curStage.lines[curStage.lines.length - 1] = last + SP + clean;
      }
    }

    // объект: «по объекту: «…»» в тексте предмета
    if (!object) {
      var subjText = (sl.length ? sl : all.slice(0, 30)).slice(0, 14).join(SP);
      var om = /объект[а-яё]*\s*:\s*([«"“][^»"”]+[»"”]|.+?)(?=\s*\(далее|\s*,\s*(?:в\s+сроки|на\s+условия)|\s+передать|$)/i.exec(subjText);
      if (om) { object = om[1].trim().replace(/[;,\s]+$/, ''); res.src.object = om[0].slice(0, 160); }
    }
    if (object) res.found.object = object;
    else warn('warn', 'Объект в договоре не найден — впишите вручную или оставьте пустым.');

    // позиции без деления на стадии: «выполняет следующую работу: …»
    if (!stages.length) {
      var intro = -1;
      for (i = 0; i < sl.length; i++) if (/следующ\S*\s+(?:работ\S*|услуг\S*)\s*:?\s*$/i.test(sl[i])) { intro = i; break; }
      var one = { key: 'one', title: '', lines: [], start: null, end: null };
      if (intro >= 0) {
        var got = [];
        for (var k = intro + 1; k < sl.length && got.length < 12; k++) {
          var cl = sl[k].replace(/^[\s\-–—•*]+/, '');
          var prev = got.length ? got[got.length - 1] : null;
          if (/^\d+\.\d+/.test(sl[k])) break;
          if (prev === null || /[;:,]$/.test(prev) || ITEM_START.test(sl[k])) got.push(cl); else break;
        }
        if (got.length === 1) one.title = capFirst(got[0].replace(/[;]$/, ''));
        else if (got.length > 1) {
          if (/:$/.test(got[0])) { one.title = got[0]; one.lines = got.slice(1); }
          else { one.title = 'Работы по договору:'; one.lines = got; }
        }
        res.src.work = sl[intro] + ' → ' + got.join(' / ').slice(0, 160);
      }
      if (!one.title) {
        var fb = /выполнить\s+(.{25,}?)(?=\s+(?:по|для)\s+объект|\s+в\s+соответствии|\.\s|$)/i.exec(sl.join(SP));
        if (fb) { one.title = fixTitle(fb[1].trim()); res.src.work = fb[0].slice(0, 160); }
      }
      if (!one.title) warn('warn', 'Не удалось выделить перечень работ — заполните название и состав позиции вручную.');
      stages = [one];
    }

    // --- стоимость и платежи ---
    var cost = section(lines, /стоимост|размер|цена|расч[её]т|оплат/i, /стоимост|размер|цена|расч[её]т|оплат/i);
    if (!cost.lines.length) cost = { lines: all };
    var total = null, stageCtx = null, payments = [], comps = [];
    cost.lines.forEach(function (t) {
      var sh2 = STAGE_RE.exec(t);
      if (sh2) { stageCtx = stageKey(sh2[1]); return; }
      var am = findAmounts(t);
      if (!am.length) return;
      var av = amountValue(am[0]);
      var cm = /^[\s\-–—•*]*(?:стоимость|цена)\s+(.{6,}?)\s*[–—-]\s*\d/i.exec(t);
      if (cm) { comps.push({ title: fixTitle(cm[1]), value: av.value, note: av.note, src: t }); return; }
      var isTotal = /^.{0,15}(?:стоимость|цена)/i.test(t) && /(составляет|равна|определяется|является)/i.test(t) && !/платеж|аванс/i.test(t);
      if (isTotal && total === null) { total = { value: av.value, src: t, note: av.note }; if (av.note) warn('warn', 'Общая стоимость: ' + av.note + '.'); return; }
      if (/платеж|аванс|оплат|расч[её]т|перечисля|окончательн/i.test(t)) payments.push({ stage: stageCtx, value: av.value, src: t, note: av.note });
    });
    res.payments = payments; res.total = total;
    var sumAll = 0;
    payments.forEach(function (p) { sumAll += p.value; if (p.note) warn('warn', 'Платёж: ' + p.note + '.'); });
    if (total && payments.length && sumAll !== total.value) warn('err', 'Платежи в сумме дают ' + RU.fmtMoney(sumAll) + ', а общая стоимость договора ' + RU.fmtMoney(total.value) + ' — цены позиций проверьте особенно внимательно (возможна опечатка в договоре).');
    if (!total && !payments.length && !comps.length) warn('warn', 'Стоимость в договоре не найдена — введите цены вручную.');

    var staged = stages.length > 1 || stages[0].key !== 'one';
    if (!staged && comps.length >= 2) {
      var csum = 0;
      stages = comps.map(function (c) { csum += c.value; if (c.note) warn('warn', 'Позиция «' + c.title + '»: ' + c.note + '.'); return { key: 'c', title: capFirst(c.title), lines: [], start: null, end: null, price: c.value, priceSrc: 'из договора: «' + c.src.slice(0, 90) + '»' }; });
      if (total && csum !== total.value) warn('err', 'Позиции в сумме дают ' + RU.fmtMoney(csum) + ', а общая стоимость договора ' + RU.fmtMoney(total.value) + '.');
    } else {
      stages.forEach(function (st) {
        var ps = payments.filter(function (p) { return p.stage === st.key; });
        if (staged && ps.length) {
          var s = 0; ps.forEach(function (p) { s += p.value; });
          st.price = s; st.priceSrc = ps.map(function (p) { return RU.fmtMoney(p.value); }).join(' + ');
        } else if (!staged) {
          var v = total ? total.value : (payments.length ? sumAll : null);
          if (v != null) { st.price = v; st.priceSrc = total ? 'общая стоимость договора' : 'сумма платежей'; }
        }
        if (st.price == null) warn('warn', 'Для «' + (st.title || 'позиции') + '» цену из договора определить не удалось — введите вручную.');
      });
    }
    res.stages = stages;

    // --- НДС ---
    var allText = all.join(SP);
    var vat = { mode: 'none', rate: 0, src: '' }, vm;
    var NONVAT = /[^.]*(?:НДС\s+не\s+(?:предусмотрен|облагается|начисляется|предъявляется)|не\s+(?:облагается|начисляется)\s+(?:налогом\s+на\s+добавленную\s+стоимость|НДС)|без\s+(?:учета\s+)?НДС|не\s+является\s+плательщиком\s+НДС|налог\S*\s+на\s+профессиональный\s+доход|упрощ[её]нн\S*\s+систем\S*\s+налогообложения)[^.]*/i;
    if ((vm = NONVAT.exec(allText))) {
      vat = { mode: 'none', rate: 0, src: norm(vm[0]).slice(0, 150) };
    } else if ((vm = /в\s+т\.?\s*ч\.?\s*НДС[^\d]{0,12}(\d{1,2})\s*%/i.exec(allText)) || (vm = /НДС\s*\(?\s*(\d{1,2})\s*%/i.exec(allText)) || (vm = /в\s+том\s+числе\s+НДС[^\d]{0,12}(\d{1,2})\s*%/i.exec(allText))) {
      vat = { mode: 'incl', rate: +vm[1], src: norm(vm[0]) };
    } else warn('warn', 'Про НДС в договоре ничего не нашёл — выбрано «Без налога (НДС)», проверьте.');
    res.found.vat = vat;

    return res;
  }

  g.Extract = { readLines: readLines, parseContract: parseContract };
})(window);
