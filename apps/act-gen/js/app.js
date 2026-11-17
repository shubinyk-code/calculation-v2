/* Интерфейс: загрузка договора → форма + живой предпросмотр акта → проверка и скачивание .docx */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var SP = RU.SP;

  var KNOWN_TOKENS = ['ACT_NO', 'ACT_DATE', 'EXECUTOR', 'CUSTOMER', 'BASIS', 'ITEM_NO', 'ITEM_TITLE', 'ITEM_LINE', 'OBJECT',
    'ITEM_QTY', 'ITEM_UNIT', 'ITEM_PRICE', 'ITEM_SUM', 'TOTAL', 'COUNT', 'TOTAL_WORDS', 'VAT_LABEL', 'VAT_VALUE',
    'EXECUTOR_SIGN', 'CUSTOMER_SIGN', 'SIGNER'];
  var CALC = { ITEM_NO: 1, ITEM_SUM: 1, TOTAL: 1, COUNT: 1 };
  var OV_NAMES = {
    ACT_DATE: 'дата акта', CUSTOMER: 'строка «Заказчик»', BASIS: 'строка «Основание»', TOTAL_WORDS: 'сумма прописью',
    VAT_LABEL: 'подпись НДС', VAT_VALUE: 'значение НДС', EXECUTOR_SIGN: 'подпись исполнителя', CUSTOMER_SIGN: 'подпись заказчика'
  };
  // какие ручные правки сбрасываются, когда меняется поле формы, из которого они собраны
  var DEPS = {
    actDate: ['ACT_DATE'], contractNo: ['BASIS'], contractDate: ['BASIS'],
    custName: ['CUSTOMER', 'CUSTOMER_SIGN'], custInn: ['CUSTOMER'], custAddr: ['CUSTOMER'], custPhone: ['CUSTOMER'],
    custRs: ['CUSTOMER'], custBank: ['CUSTOMER'], custBik: ['CUSTOMER'], custKs: ['CUSTOMER'],
    execName: ['EXECUTOR_SIGN'], vat: ['VAT_LABEL', 'VAT_VALUE', 'TOTAL_WORDS']
  };

  var S = {
    tplBytes: null, tplEntries: null, tplDoc: '', tplName: '', tplCustom: false,
    f: {}, items: [], ov: {}, parsed: null, fileName: ''
  };

  /* ---------- утилиты ---------- */

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function bytesToB64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function normText(s) { return String(s).replace(/[  ]/g, SP).replace(/\s+/g, SP).trim(); }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* приватный режим */ }
    return null;
  }

  /* ---------- шаблон ---------- */

  function loadTemplate(bytes, name, custom) {
    return Zip.read(bytes).then(function (entries) {
      var d = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
      if (!d) throw new Error('В файле нет word/document.xml — это не документ Word.');
      var xml = new TextDecoder('utf-8').decode(d.data);
      Docx.parseXml(xml);
      S.tplBytes = bytes; S.tplEntries = entries; S.tplDoc = xml; S.tplName = name; S.tplCustom = custom;
      $('#tplName').textContent = 'Шаблон: ' + name;
      $('#btnTplReset').hidden = !custom;
      var found = {}; (xml.match(/\{\{[A-Z0-9_]+\}\}/g) || []).forEach(function (t) { found[t.slice(2, -2)] = 1; });
      return Object.keys(found);
    });
  }
  function loadBuiltin() {
    return loadTemplate(b64ToBytes(window.ACT_TEMPLATE_B64), 'встроенный (по вашему акту)', false);
  }
  function initTemplate() {
    var saved = ls('actgen.tpl');
    var name = ls('actgen.tplName') || 'свой';
    var p = saved ? loadTemplate(b64ToBytes(saved), name, true).catch(function () { return loadBuiltin(); }) : loadBuiltin();
    return p;
  }

  /* ---------- состояние → модель документа ---------- */

  function ovr(key, auto, ignore) {
    return (!ignore && S.ov[key] != null) ? S.ov[key] : auto;
  }

  function compute(ignoreOv) {
    var f = S.f;
    var vals = {}, errs = [];
    var cd = RU.fromIso(f.actDate), kd = RU.fromIso(f.contractDate);
    vals.ACT_NO = (f.actNo || '').trim();
    vals.ACT_DATE = ovr('ACT_DATE', cd ? RU.dateWords(cd) : '', ignoreOv);
    vals.EXECUTOR = (f.execName || '').trim();

    var cp = [(f.custName || '').trim()];
    if (f.custInn) cp.push('ИНН ' + f.custInn.trim());
    if (f.custAddr) cp.push(f.custAddr.trim().replace(/[,;\s]+$/, ''));
    if (f.custPhone) cp.push('тел.: ' + f.custPhone.trim());
    if (f.custRs) cp.push('р/с ' + f.custRs.trim());
    if (f.custBank) cp.push('в банке ' + f.custBank.trim());
    if (f.custBik) cp.push('БИК ' + f.custBik.trim());
    if (f.custKs) cp.push('к/с ' + f.custKs.trim());
    vals.CUSTOMER = ovr('CUSTOMER', cp.filter(Boolean).join(', '), ignoreOv);

    vals.BASIS = ovr('BASIS', 'ДОГОВОР № ' + (f.contractNo || '').trim() + ' от «' + (kd ? RU.pad2(kd.d) : '') + '» ' + (kd ? RU.MONTHS_GEN[kd.m] + SP + kd.y : '') + ' г', ignoreOv);

    var incl = S.items.filter(function (i) { return i.include; });
    var total = 0;
    var items = incl.map(function (it, idx) {
      var price = RU.parseMoney(it.price);
      var qtyStr = (it.qty || '').trim();
      var qty = qtyStr === '' ? null : parseFloat(qtyStr.replace(',', '.'));
      var sum = price == null ? null : (qty == null || isNaN(qty) ? price : Math.round(price * qty));
      if (sum != null) total += sum;
      return {
        vals: {
          ITEM_NO: String(idx + 1), ITEM_TITLE: (it.title || '').trim(), ITEM_QTY: qtyStr, ITEM_UNIT: (it.unit || '').trim(),
          ITEM_PRICE: price == null ? (it.price || '') : RU.fmtMoney(price),
          ITEM_SUM: sum == null ? '' : RU.fmtMoney(sum)
        },
        lines: it.lines.slice(), object: (f.object || '').trim(),
        price: price, sum: sum, qty: qty, qtyStr: qtyStr, title: it.title
      };
    });
    vals.COUNT = String(items.length);
    vals.TOTAL = RU.fmtMoney(total);
    vals.TOTAL_WORDS = ovr('TOTAL_WORDS', RU.rubWords(total), ignoreOv);
    if (f.vat === 'none' || !f.vat) {
      vals.VAT_LABEL = ovr('VAT_LABEL', 'Без налога (НДС)', ignoreOv);
      vals.VAT_VALUE = ovr('VAT_VALUE', '-', ignoreOv);
    } else {
      var rate = parseInt(f.vat, 10);
      vals.VAT_LABEL = ovr('VAT_LABEL', 'В том числе НДС (' + rate + '%)', ignoreOv);
      vals.VAT_VALUE = ovr('VAT_VALUE', RU.fmtMoney(Math.round(total * rate / (100 + rate))), ignoreOv);
    }
    vals.EXECUTOR_SIGN = ovr('EXECUTOR_SIGN', vals.EXECUTOR, ignoreOv);
    vals.CUSTOMER_SIGN = ovr('CUSTOMER_SIGN', (f.custName || '').trim(), ignoreOv);
    vals.SIGNER = (f.signer || '').trim();
    return { vals: vals, items: items, total: total };
  }

  /* ---------- проверка заполненности ---------- */

  function validate(m) {
    var f = S.f, out = [];
    function need(ok, text) { out.push({ ok: !!ok, text: text }); }
    need(m.vals.ACT_NO, 'Номер акта указан');
    var cd = RU.fromIso(f.actDate), kd = RU.fromIso(f.contractDate);
    need(cd, 'Дата акта указана');
    need((f.contractNo || '').trim() && kd, 'Номер и дата договора указаны');
    if (cd && kd) need(RU.dateIso(cd) >= RU.dateIso(kd), 'Дата акта не раньше даты договора');
    need((f.custName || '').trim(), 'Заказчик указан');
    need(m.vals.EXECUTOR, 'Исполнитель указан');
    need(m.vals.SIGNER, 'Подписант Заказчика указан');
    need(m.items.length > 0, 'В акте есть хотя бы одна позиция');
    m.items.forEach(function (it, i) {
      var n = 'Позиция ' + (i + 1) + ': ';
      need(it.title, n + 'есть название');
      need(it.price != null && it.price > 0, n + 'цена — положительное число');
      if (it.qtyStr !== '') need(!isNaN(it.qty) && it.qty > 0, n + 'количество — положительное число');
      need(it.lines.every(function (l) { return l.trim(); }), n + 'в составе работ нет пустых строк');
    });
    return out;
  }

  /* ---------- предпросмотр ---------- */

  function buildPage(m) {
    var doc = Docx.fill(S.tplDoc, { vals: m.vals, items: m.items }, true);
    var page = Docx.renderPage(doc);
    decorate(page, m);
    return page;
  }

  function decorate(page, m) {
    var incl = S.items.filter(function (i) { return i.include; });
    Array.prototype.slice.call(page.querySelectorAll('.fld')).forEach(function (sp) {
      var k = sp.getAttribute('data-k');
      if (CALC[k]) sp.classList.add('calc');
      else {
        sp.setAttribute('contenteditable', 'plaintext-only');
        sp.setAttribute('spellcheck', 'false');
      }
      if (!sp.textContent) sp.classList.add('empty');
      if (S.ov[k] != null) sp.classList.add('manual');
      if (k === 'ITEM_PRICE') {
        var i = +sp.getAttribute('data-i');
        if (incl[i] && RU.parseMoney(incl[i].price) == null) sp.classList.add('bad');
      }
    });
  }

  function fit() {
    var wrap = $('#paperwrap');
    var avail = wrap.clientWidth - 34;
    var z = Math.min(1, avail / 794);
    $('#paper').style.zoom = z > 0 ? z : 1;
  }

  function renderPreview() {
    var m = compute();
    $('#paper').replaceChildren(buildPage(m));
    fit();
    renderOverrides();
  }

  function syncPreview() {
    var m = compute();
    var page = buildPage(m);
    var live = $('#paper .wpage');
    if (!live) { $('#paper').replaceChildren(page); return; }
    var a = live.querySelectorAll('.fld'), b = page.querySelectorAll('.fld');
    if (a.length !== b.length) { $('#paper').replaceChildren(page); fit(); renderOverrides(); return; }
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== document.activeElement && a[i].textContent !== b[i].textContent) a[i].textContent = b[i].textContent;
      a[i].className = b[i].className.replace(/\bempty\b/, '') + (a[i].textContent ? '' : ' empty');
    }
    renderOverrides();
    renderLiveChecks(m);
  }

  function renderOverrides() {
    var box = $('#ovBox'), keys = Object.keys(S.ov);
    box.replaceChildren();
    if (!keys.length) return;
    var d = el('div', { class: 'ov' });
    d.appendChild(el('b', { text: 'Правлено вручную в акте: ' }));
    keys.forEach(function (k) {
      var chip = el('span', { class: 'chip' }, [el('span', { text: OV_NAMES[k] || k })]);
      var x = el('button', { title: 'Вернуть значение, собранное из договора', text: '✕' });
      x.onclick = function () { delete S.ov[k]; syncPreview(); };
      chip.appendChild(x);
      d.appendChild(chip);
    });
    box.appendChild(d);
  }

  function renderLiveChecks(m) {
    var bad = validate(m).filter(function (c) { return !c.ok; });
    var box = $('#checkBox');
    if (box.getAttribute('data-mode') === 'result') {
      // результат сборки остаётся, пока данные те же; изменили что-то — он устарел и убирается
      if (JSON.stringify(m) === S.builtSig) return;
      box.removeAttribute('data-mode');
    }
    box.replaceChildren();
    if (!bad.length) return;
    var ul = el('ul');
    bad.forEach(function (c) { ul.appendChild(el('li', { class: 'fail', text: c.text })); });
    box.appendChild(el('div', { class: 'warn err checks' }, [el('b', { text: 'Перед выпуском акта исправьте:' }), ul]));
  }

  /* правки прямо в предпросмотре */
  function onPreviewInput(e) {
    var sp = e.target.closest ? e.target.closest('.fld') : null;
    if (!sp || sp.classList.contains('calc')) return;
    var k = sp.getAttribute('data-k'), i = +sp.getAttribute('data-i'), j = +sp.getAttribute('data-j');
    var txt = sp.textContent.replace(/[\r\n]+/g, SP);
    var incl = S.items.filter(function (x) { return x.include; });
    var f = S.f;
    switch (k) {
      case 'ACT_NO': f.actNo = txt; break;
      case 'EXECUTOR': f.execName = txt; break;
      case 'SIGNER': f.signer = txt; break;
      case 'OBJECT': f.object = txt; break;
      case 'ITEM_TITLE': if (incl[i]) incl[i].title = txt; break;
      case 'ITEM_LINE': if (incl[i]) incl[i].lines[j] = txt; break;
      case 'ITEM_QTY': if (incl[i]) incl[i].qty = txt; break;
      case 'ITEM_UNIT': if (incl[i]) incl[i].unit = txt; break;
      case 'ITEM_PRICE': if (incl[i]) { incl[i].price = txt; delete S.ov.TOTAL_WORDS; delete S.ov.VAT_VALUE; } break;
      default:
        var auto = compute(true).vals[k];
        if (txt === auto) delete S.ov[k]; else S.ov[k] = txt;
    }
    syncForm();
    syncPreview();
  }

  /* ---------- форма ---------- */

  var itemCtl = [];

  function syncForm() {
    $$('[data-f]').forEach(function (inp) {
      if (inp !== document.activeElement) inp.value = S.f[inp.getAttribute('data-f')] || '';
    });
    itemCtl.forEach(function (c) { c.sync(); });
  }

  function bindStatic() {
    $$('[data-f]').forEach(function (inp) {
      var k = inp.getAttribute('data-f');
      inp.addEventListener('input', function () {
        S.f[k] = inp.value;
        (DEPS[k] || []).forEach(function (t) { delete S.ov[t]; });
        if (k === 'custPhone' && S.f.custInn) ls('actgen.phone.' + S.f.custInn.trim(), inp.value);
        if (k === 'vat' || k === 'object') delete S.ov.TOTAL_WORDS;
        syncPreview();
      });
    });
  }

  function renderItems() {
    var box = $('#items');
    box.replaceChildren();
    itemCtl = [];
    S.items.forEach(function (it, idx) {
      var card = el('div', { class: 'item' + (it.include ? '' : ' off') });
      var chk = el('input', { type: 'checkbox' });
      chk.checked = it.include;
      var title = el('input', { class: 't', placeholder: 'Название позиции, например: Проектная документация' });
      var head = el('div', { class: 'item-head' }, [chk, title]);
      if (it.custom) {
        var rm = el('button', { class: 'rm', title: 'Удалить позицию', text: '✕' });
        rm.onclick = function () { S.items.splice(idx, 1); renderItems(); syncPreview(); };
        head.appendChild(rm);
      }
      var lines = el('textarea', { rows: Math.min(8, Math.max(3, it.lines.length + 1)), placeholder: 'Разделы / состав работ — по одному в строке' });
      var qty = el('input', { placeholder: 'Кол-во', inputmode: 'decimal' });
      var unit = el('input', { placeholder: 'Ед.' });
      var price = el('input', { placeholder: 'Цена, руб.', inputmode: 'decimal' });
      var priceLab = el('label', { text: 'Цена, руб. (сумма = цена × кол-во)' }, [price]);
      var grid = el('div', { class: 'grid3' }, [
        el('label', { text: 'Кол-во' }, [qty]), el('label', { text: 'Ед.' }, [unit]), priceLab
      ]);
      var linesLab = el('label', { text: 'Состав (по строке на раздел)' }, [lines]);
      addPick(head, title, 'text', false);
      addPick(linesLab, lines, 'text', true);
      addPick(priceLab, price, 'money', false);
      card.appendChild(head);
      card.appendChild(linesLab);
      card.appendChild(grid);
      if (it.hint) card.appendChild(el('div', { class: 'hint', text: it.hint }));
      box.appendChild(card);

      function sync() {
        if (document.activeElement !== title) title.value = it.title;
        if (document.activeElement !== lines) lines.value = it.lines.join('\n');
        if (document.activeElement !== qty) qty.value = it.qty;
        if (document.activeElement !== unit) unit.value = it.unit;
        if (document.activeElement !== price) price.value = it.price;
        price.classList.toggle('bad', RU.parseMoney(it.price) == null);
        chk.checked = it.include;
        card.classList.toggle('off', !it.include);
      }
      chk.onchange = function () { it.include = chk.checked; delete S.ov.TOTAL_WORDS; delete S.ov.VAT_VALUE; card.classList.toggle('off', !it.include); syncPreview(); };
      title.oninput = function () { it.title = title.value; syncPreview(); };
      lines.oninput = function () {
        it.lines = lines.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        syncPreview();
      };
      qty.oninput = function () { it.qty = qty.value; syncPreview(); };
      unit.oninput = function () { it.unit = unit.value; syncPreview(); };
      price.oninput = function () { it.price = price.value; delete S.ov.TOTAL_WORDS; delete S.ov.VAT_VALUE; price.classList.toggle('bad', RU.parseMoney(it.price) == null); syncPreview(); };
      itemCtl.push({ sync: sync });
      sync();
    });
  }

  function renderWarnings(p) {
    var box = $('#warnBox');
    box.replaceChildren();
    var worst = p.warnings.some(function (w) { return w.level === 'err'; }) ? 'err' : (p.warnings.length ? 'warn' : 'ok');
    var d = el('div', { class: 'warn ' + worst });
    if (!p.warnings.length) {
      d.appendChild(el('b', { text: 'Разбор договора: расхождений не найдено' }));
      d.appendChild(el('div', { text: 'Все поля найдены, суммы платежей сошлись с общей стоимостью. Всё равно просмотрите акт справа.' }));
    } else {
      d.appendChild(el('b', { text: 'Что проверить после разбора договора (' + p.warnings.length + ')' }));
      var ul = el('ul');
      p.warnings.forEach(function (w) { ul.appendChild(el('li', { class: 'w-' + w.level, text: w.text })); });
      d.appendChild(ul);
    }
    box.appendChild(d);
  }

  function renderSources(p) {
    function q(s) { return s ? '«' + (s.length > 170 ? s.slice(0, 170) + '…' : s) + '»' : ''; }
    $('#src-contract').textContent = p.src.contractNo ? 'Найдено в договоре: ' + q(p.src.contractNo) + (p.src.contractDate && p.src.contractDate !== p.src.contractNo ? ' и ' + q(p.src.contractDate) : '') : '';
    $('#src-customer').textContent = p.src.customer ? 'Найдено в договоре: ' + q(p.src.customer) + (p.src.signer ? '. Подписант: ' + q(p.src.signer) : '') : '';
    $('#src-executor').textContent = p.src.executor ? 'Найдено в договоре: ' + q(p.src.executor) : '';
    var pr = [];
    if (p.total) pr.push('Общая стоимость по договору: ' + RU.fmtMoney(p.total.value) + ' руб.');
    if (p.payments.length) pr.push('Платежей найдено: ' + p.payments.length + ', в сумме ' + RU.fmtMoney(p.payments.reduce(function (a, x) { return a + x.value; }, 0)) + ' руб.');
    $('#src-price').textContent = pr.join(' ');
  }

  /* ---------- загрузка договора ---------- */

  function suggestActNo(contractNo) {
    var v = ls('actgen.next.' + contractNo);
    return v || '1';
  }

  function applyParsed(p, fileName) {
    S.parsed = p; S.ov = {}; S.fileName = fileName;
    var fo = p.found, f = {};
    f.contractNo = fo.contractNo || '';
    f.contractDate = fo.contractDate ? RU.dateIso(fo.contractDate) : '';
    f.actNo = suggestActNo(f.contractNo);
    f.actDate = RU.dateIso(RU.today());
    var c = fo.customer || {};
    f.custName = c.name || ''; f.custInn = c.inn || ''; f.custAddr = c.address || '';
    f.custRs = c.rs || ''; f.custBank = c.bank || ''; f.custBik = c.bik || ''; f.custKs = c.ks || '';
    f.custPhone = c.phone || (c.inn ? ls('actgen.phone.' + c.inn) : '') || '';
    f.signer = fo.signer || '';
    f.execName = (fo.executor && fo.executor.name) || '';
    f.object = fo.object || '';
    var vat = fo.vat || { mode: 'none' };
    f.vat = vat.mode === 'incl' ? String(vat.rate) : 'none';
    var sel = $('select[data-f="vat"]');
    if (f.vat !== 'none' && !Array.prototype.some.call(sel.options, function (o) { return o.value === f.vat; })) {
      sel.appendChild(el('option', { value: f.vat, text: 'В том числе НДС ' + f.vat + '%' }));
    }
    S.f = f;
    var multi = p.stages.length > 1;
    S.items = p.stages.map(function (st, idx) {
      var title = st.title;
      if (!title && st.fallbackIntro) {
        var m = /результат\s+(?:работ|услуг)\s+(.*?)\s*:?\s*$/i.exec(st.fallbackIntro);
        title = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : '';
      }
      if (title && st.lines.length && !/:$/.test(title)) title += ':'; // как в вашем образце: «Проектная документация:»
      var hint = [];
      if (st.price != null) hint.push('Цена из договора: ' + st.priceSrc + (st.priceSrc.indexOf('+') >= 0 ? ' = ' + RU.fmtMoney(st.price) : ''));
      if (st.start || st.end) hint.push('срок по договору: ' + (st.start ? RU.dateDots(st.start) : '…') + ' – ' + (st.end ? RU.dateDots(st.end) : '…'));
      return {
        include: !multi || idx === 0, custom: false, title: title,
        lines: st.lines.slice(), qty: '', unit: '', price: st.price != null ? RU.fmtMoney(st.price) : '',
        hint: hint.join(' · ')
      };
    });
    $('#work').hidden = false;
    $('#checkBox').replaceChildren(); $('#checkBox').removeAttribute('data-mode');
    renderWarnings(p); renderSources(p); renderItems(); syncForm(); renderPreview();
    $('#drop').classList.add('loaded');
    $('#dropTitle').textContent = 'Договор: ' + fileName;
    $('#dropHint').innerHTML = 'Чтобы загрузить другой — перетащите файл сюда или <a href="#" id="pick2">выберите</a>.' + (multi ? ' В договоре несколько стадий — отметьте галочками те, что принимает этот акт.' : '');
    $('#pick2').onclick = function (ev) { ev.preventDefault(); $('#contractFile').click(); };
    if (multi) toast('В договоре ' + p.stages.length + ' стадии — по умолчанию включена первая. Отметьте нужные.');
  }

  /* Старый .doc / .rtf: превращаем в .docx через Word на этом компьютере (это умеет serve.ps1). */
  function toDocx(buf, name) {
    var u = new Uint8Array(buf);
    if (u[0] === 0x50 && u[1] === 0x4B) return Promise.resolve(buf); // «PK» — уже .docx
    if (/\.pdf$/i.test(name) || (u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44)) {
      return Promise.reject(new Error('это PDF. Сохраните договор из Word как .docx (из PDF текст надёжно не достать).'));
    }
    if (location.protocol.indexOf('http') !== 0) {
      return Promise.reject(new Error('файл в старом формате .doc. Откройте программу через serve.ps1 (http://localhost:8790/) — там она сама конвертирует через Word, либо сохраните договор как .docx.'));
    }
    toast('Старый формат .doc — конвертирую через Word, секунду…');
    return fetch('convert', { method: 'POST', body: buf }).then(function (r) {
      if (!r.ok) throw new Error('Word не смог открыть файл (' + r.status + '). Сохраните договор как .docx вручную.');
      return r.arrayBuffer();
    });
  }

  function renderContractText(lines) {
    var box = $('#ctext');
    box.replaceChildren();
    var frag = document.createDocumentFragment();
    lines.forEach(function (l) { frag.appendChild(el('div', { class: 'cl', text: l.text })); });
    box.appendChild(frag);
  }

  function handleContract(file) {
    file.arrayBuffer().then(function (buf) { return toDocx(buf, file.name); }).then(function (buf) { return Zip.read(buf); }).then(function (entries) {
      var d = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
      if (!d) throw new Error('В файле нет текста договора (word/document.xml).');
      var lines = Extract.readLines(new TextDecoder('utf-8').decode(d.data));
      if (lines.length < 5) throw new Error('В документе почти нет текста — возможно, это скан.');
      S.lines = lines;
      applyParsed(Extract.parseContract(lines), file.name);
      renderContractText(lines);
    }).catch(function (err) { toast('Не удалось прочитать договор: ' + err.message); console.error(err); });
  }

  /* ---------- подстановка выделенного из текста договора ---------- */

  function picked() {
    var s = window.getSelection(), t = s ? String(s).replace(/\s+/g, SP).trim() : '';
    var box = $('#ctext');
    if (t && s.anchorNode && box.contains(s.anchorNode)) S.picked = t;
    return S.picked || '';
  }
  function pickValue(kind, text) {
    if (kind === 'text') return text;
    if (kind === 'money') {
      var m = /(\d{1,3}(?:[ ]\d{3})+|\d+)(?:[.,](\d{1,2}))?/.exec(text);
      return m ? RU.fmtMoney(RU.parseMoney(m[1].replace(/ /g, '') + (m[2] ? ',' + m[2] : '')) || 0) : null;
    }
    if (kind === 'inn') { var iv = /\b(\d{12}|\d{10})\b/.exec(text); return iv ? iv[1] : null; }
    var n = parseInt(kind, 10);
    var re = new RegExp('(?:\\d[ ]?){' + (n - 1) + '}\\d');
    var d = re.exec(text);
    return d ? d[0].replace(/ /g, '') : null;
  }
  /** Маленькая кнопка «⇦» у поля: вставляет в него текст, выделенный в разделе «Текст договора». */
  function addPick(label, input, kind, append) {
    var b = el('button', { type: 'button', class: 'pick', title: 'Вставить сюда текст, выделенный в разделе «Текст договора»', text: '⇦' });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // не сбрасывать выделение
    b.addEventListener('click', function () {
      var t = picked();
      if (!t) { toast('Сначала выделите нужный текст в разделе «Текст договора» слева внизу'); return; }
      var v = pickValue(kind, t);
      if (v == null) { toast('В выделенном тексте не нашёл ' + (kind === 'money' ? 'сумму' : 'нужные цифры')); return; }
      input.value = append && input.value ? input.value.replace(/\s+$/, '') + '\n' + v : v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    label.appendChild(b);
  }
  var PICK_KIND = { contractNo: 'text', custName: 'text', custInn: 'inn', custAddr: 'text', custPhone: 'text', custRs: '20', custBank: 'text', custBik: '9', custKs: '20', signer: 'text', execName: 'text', object: 'text' };
  function addStaticPicks() {
    $$('[data-f]').forEach(function (inp) {
      var k = inp.getAttribute('data-f');
      if (PICK_KIND[k]) addPick(inp.parentNode, inp, PICK_KIND[k], false);
    });
  }

  /* ---------- сборка, проверка, скачивание ---------- */

  function verify(bytes, m) {
    var res = [];
    function chk(ok, text) { res.push({ ok: !!ok, text: text }); }
    return Zip.read(bytes).then(function (entries) {
      var byName = {}; entries.forEach(function (e) { byName[e.name] = e; });
      var d = byName['word/document.xml'];
      chk(d, 'Файл открывается как архив Word, document.xml на месте');
      var xml = new TextDecoder('utf-8').decode(d.data);
      var doc = null;
      try { doc = Docx.parseXml(xml); chk(true, 'Разметка документа корректна (XML читается)'); } catch (e) { chk(false, 'XML повреждён: ' + e.message); return res; }
      var text = normText(Docx.docParagraphs(doc).join('\n'));
      chk(!/\{\{|\}\}/.test(text), 'В документе не осталось неподставленных меток {{…}}');

      // все подставленные значения реально стоят в готовом файле
      var miss = [];
      function has(label, v) { if (v && text.indexOf(normText(v)) < 0) miss.push(label + ': «' + v.slice(0, 40) + '»'); }
      Object.keys(m.vals).forEach(function (k) { has(k, m.vals[k]); });
      m.items.forEach(function (it, i) {
        Object.keys(it.vals).forEach(function (k) { has(k + '[' + (i + 1) + ']', it.vals[k]); });
        it.lines.forEach(function (l, j) { has('ITEM_LINE[' + (i + 1) + '.' + (j + 1) + ']', l); });
        has('OBJECT[' + (i + 1) + ']', it.object);
      });
      chk(!miss.length, miss.length ? 'Не найдены в готовом файле: ' + miss.join('; ') : 'Все значения из формы найдены в готовом файле (' + (Object.keys(m.vals).length + m.items.length) + ' групп данных)');

      // структура таблицы
      var tpl = Docx.parseXml(S.tplDoc);
      var trs = Array.prototype.slice.call(Docx.ln(tpl, 'tr'));
      var itemRows = trs.filter(function (t) { return /\{\{(ITEM_[A-Z]+|OBJECT)\}\}/.test(t.textContent); }).length;
      var expected = trs.length - itemRows + itemRows * m.items.length;
      var got = Docx.ln(doc, 'tr').length;
      chk(got === expected, 'Строк в таблице ' + got + ' (ожидалось ' + expected + ': шаблон, где позиция размножена ×' + m.items.length + ')');

      // арифметика независимым путём — по тексту, который реально стоит в файле
      var sumK = 0, okParse = true;
      m.items.forEach(function (it) { var k = RU.parseMoney(it.vals.ITEM_SUM); if (k == null) okParse = false; else sumK += k; });
      var totK = RU.parseMoney(m.vals.TOTAL);
      chk(okParse && totK === sumK, 'Сумма позиций ' + RU.fmtMoney(sumK) + ' = «Итого» ' + m.vals.TOTAL);
      if (S.ov.TOTAL_WORDS == null) {
        var wr = RU.wordsToInt(m.vals.TOTAL_WORDS);
        chk(!isNaN(wr) && wr * 100 + parseInt((/(\d{2})\s*коп/.exec(m.vals.TOTAL_WORDS) || [0, 0])[1], 10) === totK, 'Сумма прописью обратно читается как ' + m.vals.TOTAL + ' руб.');
      } else chk(true, 'Сумма прописью правлена вручную — сверьте её сами: «' + m.vals.TOTAL_WORDS + '»');

      // остальные части файла не тронуты
      var same = true, diff = [];
      S.tplEntries.forEach(function (te) {
        if (te.name === 'word/document.xml') return;
        var oe = byName[te.name];
        if (!oe || Zip.crc32(oe.data) !== Zip.crc32(te.data) || oe.data.length !== te.data.length) { same = false; diff.push(te.name); }
      });
      chk(same && entries.length === S.tplEntries.length, 'Стили, шрифты, колонтитулы и настройки шаблона не тронуты (' + (S.tplEntries.length - 1) + ' частей совпадают побайтно)' + (same ? '' : ': расходятся ' + diff.join(', ')));
      return res;
    });
  }

  function fileNameFor(m) {
    var kd = RU.fromIso(S.f.actDate);
    var sur = (S.f.execName || '').replace(/^ИП\s+/i, '').split(/\s+/)[0] || '';
    var nm = 'Акт № ' + (S.f.actNo || '').trim() + ' от ' + (kd ? RU.dateDots(kd) : '') + 'г' + (sur ? '_' + sur : '') + '.docx';
    return nm.replace(/[\\/:*?"<>|]/g, '_');
  }

  function download(bytes, name) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function showResult(list, fileName, downloaded) {
    var box = $('#checkBox');
    box.setAttribute('data-mode', 'result');
    box.replaceChildren();
    var allOk = list.every(function (c) { return c.ok; });
    var ul = el('ul');
    list.forEach(function (c) { ul.appendChild(el('li', { class: c.ok ? 'ok' : 'fail', text: c.text })); });
    var head = allOk ? (downloaded ? 'Готово: файл «' + fileName + '» проверен и скачан' : 'Проверка пройдена') : 'Файл НЕ выпущен: проверка нашла проблемы';
    box.appendChild(el('div', { class: 'warn checks ' + (allOk ? 'ok' : 'err') }, [el('b', { text: head }), ul]));
  }

  function build() {
    var m = compute();
    var pre = validate(m);
    var bad = pre.filter(function (c) { return !c.ok; });
    var box = $('#checkBox');
    box.removeAttribute('data-mode');
    if (bad.length) { renderLiveChecks(m); toast('Сначала исправьте отмеченное в проверке'); return; }
    var bytes;
    try {
      var doc = Docx.fill(S.tplDoc, { vals: m.vals, items: m.items }, false);
      bytes = Docx.buildDocx(S.tplEntries, Docx.serialize(doc));
    } catch (e) { toast('Ошибка сборки: ' + e.message); console.error(e); return; }
    verify(bytes, m).then(function (list) {
      var ok = list.every(function (c) { return c.ok; });
      var name = fileNameFor(m);
      if (ok) {
        download(bytes, name);
        var n = parseInt(S.f.actNo, 10);
        if (!isNaN(n) && S.f.contractNo) ls('actgen.next.' + S.f.contractNo.trim(), String(n + 1));
      }
      S.builtSig = JSON.stringify(m);
      showResult(list, name, ok);
    });
  }

  /* ---------- запуск ---------- */

  function init() {
    bindStatic();
    addStaticPicks();
    var drop = $('#drop'), inp = $('#contractFile');
    $('#pick').onclick = function (e) { e.preventDefault(); inp.click(); };
    inp.onchange = function () { if (inp.files[0]) handleContract(inp.files[0]); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) handleContract(f);
    });

    var paper = $('#paper');
    paper.addEventListener('input', onPreviewInput);
    paper.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    paper.addEventListener('focusout', function () { setTimeout(syncPreview, 0); });
    paper.addEventListener('click', function (e) {
      var sp = e.target.closest && e.target.closest('.fld.calc');
      if (sp) toast('Это значение считается само (по ценам позиций). Меняйте цену или количество.');
    });
    window.addEventListener('resize', fit);

    $('#btnAddItem').onclick = function () {
      S.items.push({ include: true, custom: true, title: '', lines: [], qty: '', unit: '', price: '', hint: '' });
      renderItems(); syncPreview();
    };
    $('#btnBuild').onclick = build;

    $('#btnTplHelp').onclick = function () { $('#helpDlg').showModal(); };
    $('#btnTplDownload').onclick = function () { download(S.tplBytes, 'Шаблон акта.docx'); };
    $('#btnTplUpload').onclick = function () { $('#tplFile').click(); };
    $('#tplFile').onchange = function () {
      var f = $('#tplFile').files[0]; $('#tplFile').value = '';
      if (!f) return;
      f.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        return loadTemplate(bytes, f.name, true).then(function (tokens) {
          var unknown = tokens.filter(function (t) { return KNOWN_TOKENS.indexOf(t) < 0; });
          ls('actgen.tpl', bytesToB64(bytes)); ls('actgen.tplName', f.name);
          toast(unknown.length ? 'Шаблон загружен. Неизвестные метки (останутся как есть): ' + unknown.join(', ') : 'Шаблон загружен: меток найдено ' + tokens.length);
          if (S.parsed) { renderPreview(); }
        });
      }).catch(function (err) { toast('Шаблон не принят: ' + err.message); });
    };
    $('#btnTplReset').onclick = function () {
      try { localStorage.removeItem('actgen.tpl'); localStorage.removeItem('actgen.tplName'); } catch (e) { /* ничего */ }
      loadBuiltin().then(function () { toast('Вернул встроенный шаблон'); if (S.parsed) renderPreview(); });
    };

    if (location.protocol.indexOf('http') === 0) {
      $('#btnSample').hidden = false;
      $('#btnSample').onclick = function () {
        fetch('samples/sample_contract.docx').then(function (r) { return r.blob(); }).then(function (b) {
          handleContract(new File([b], 'Договор ЦОД (пример).docx'));
        });
      };
    }
    initTemplate().catch(function (e) { toast('Шаблон не загрузился: ' + e.message); });
  }

  init();
  window.__act = { S: S, compute: compute, validate: validate, build: build, handleContract: handleContract };
})();
