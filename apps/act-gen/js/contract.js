/* Вкладка «Договор»: общие данные (Заказчик, объект, город) + по вкладке на раздел (АР, ОВ, ВК, СС, ЭЛ…):
   свой образец договора, свой исполнитель, номер, дата, цена. Общее правится один раз — меняется во всех договорах. */
(function (g) {
  'use strict';

  var SP = String.fromCharCode(32);
  var NB = String.fromCharCode(160);
  var LSKEY = 'actgen.ct.v1';
  var ORGKEY = 'actgen.ct.orgs';
  var ORGS = { cur: 'o1', seq: 1, list: [{ id: 'o1', name: 'Организация 1' }] };
  function lsKey() { return ORGS.cur === 'o1' ? LSKEY : LSKEY + ':' + ORGS.cur; }
  function tplKey(id) { return 'tpl:' + (ORGS.cur === 'o1' ? '' : ORGS.cur + ':') + id; }
  function saveOrgs() { try { localStorage.setItem(ORGKEY, JSON.stringify(ORGS)); } catch (e) { /* ничего */ } }

  /* ---------- справочник полей ---------- */

  var CAT = {
    CITY: { label: 'Город', scope: 'common' },
    OBJECT: { label: 'Объект', scope: 'common', area: true },
    CUST_NAME: { label: 'Заказчик: краткое наименование', scope: 'common' },
    CUST_LONG: { label: 'Заказчик: полное наименование', scope: 'common', area: true },
    CUST_REP_POST: { label: 'Должность представителя Заказчика (в род. падеже)', scope: 'common' },
    CUST_FIO: { label: 'Представитель Заказчика: ФИО (им. падеж)', scope: 'common' },
    CUST_FIO_GEN: { label: 'Представитель Заказчика: ФИО (род. падеж)', scope: 'common', derived: true },
    CUST_REP_BASIS: { label: 'Основание полномочий', scope: 'common', area: true },
    CUST_SIGN_POST: { label: 'Должность в блоке подписи', scope: 'common' },
    CUST_SIGNER: { label: 'Подпись «Фамилия И.О.»', scope: 'common', derived: true },
    CUST_SIGNER_R: { label: 'Подпись «И.О. Фамилия»', scope: 'common', derived: true },
    CUST_INN: { label: 'Заказчик: ИНН', scope: 'common' },
    CUST_KPP: { label: 'Заказчик: КПП', scope: 'common' },
    CUST_ADDR: { label: 'Заказчик: адрес', scope: 'common', area: true },
    CUST_RS: { label: 'Заказчик: расчётный счёт', scope: 'common' },
    CUST_BANK: { label: 'Заказчик: банк', scope: 'common' },
    CUST_KS: { label: 'Заказчик: корр. счёт', scope: 'common' },
    CUST_BIK: { label: 'Заказчик: БИК', scope: 'common' },
    CUST_PHONE: { label: 'Заказчик: телефон', scope: 'common' },
    CUST_EMAIL: { label: 'Заказчик: e-mail', scope: 'common' },
    CNO: { label: 'Номер договора', scope: 'tab' },
    CDATE: { label: 'Дата договора', scope: 'tab', date: true },
    PRICE: { label: 'Цена договора', scope: 'tab', money: true },
    VAT_PCT: { label: 'Ставка НДС, %', scope: 'tab' },
    SUBJECT: { label: 'Предмет (что разрабатывает Исполнитель)', scope: 'tab', area: true },
    EXEC_INTRO: { label: 'Исполнитель: описание в вводной части', scope: 'tab', exec: true },
    EXEC_REQ_NAME: { label: 'Исполнитель: название в реквизитах', scope: 'tab', exec: true },
    EXEC_REQ_LINES: { label: 'Исполнитель: строки реквизитов', scope: 'tab', exec: true },
    EXEC_FIO: { label: 'Исполнитель: ФИО', scope: 'tab', exec: true },
    EXEC_SHORTNAME: { label: 'Исполнитель: «ИП ФИО» / наименование', scope: 'tab', exec: true },
    EXEC_SIGNER: { label: 'Исполнитель: подпись «Фамилия И.О.»', scope: 'tab', exec: true },
    EXEC_SIGNER_R: { label: 'Исполнитель: подпись «И.О. Фамилия»', scope: 'tab', exec: true },
    EXEC_SIGN_POST: { label: 'Исполнитель: должность в подписи', scope: 'tab', exec: true },
    EXEC_INN: { label: 'Исполнитель: ИНН', scope: 'tab', exec: true },
    EXEC_KPP: { label: 'Исполнитель: КПП', scope: 'tab', exec: true },
    EXEC_OGRN: { label: 'Исполнитель: ОГРН / ОГРНИП', scope: 'tab', exec: true },
    EXEC_RS: { label: 'Исполнитель: расчётный счёт', scope: 'tab', exec: true },
    EXEC_KS: { label: 'Исполнитель: корр. счёт', scope: 'tab', exec: true },
    EXEC_BIK: { label: 'Исполнитель: БИК', scope: 'tab', exec: true },
    EXEC_ADDR: { label: 'Исполнитель: адрес', scope: 'tab', exec: true },
    EXEC_BANK: { label: 'Исполнитель: банк', scope: 'tab', exec: true },
    EXEC_PHONE: { label: 'Исполнитель: телефон', scope: 'tab', exec: true },
    EXEC_EMAIL: { label: 'Исполнитель: e-mail', scope: 'tab', exec: true }
  };

  var DEFAULT_TABS = ['АР', 'ОВ', 'ВК', 'СС', 'ЭЛ'];

  /* ---------- состояние ---------- */

  var C = null;      // { common:{vals,ov}, customDefs:{}, tabs:[], cur, seq }
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var fieldRefs = [];
  var saveTimer = null, renderTimer = null, dirtyTpl = {};

  function newTab(name) {
    return { id: 't' + (++C.seq), name: name, doc: null, entries: null, meta: null, samples: {}, counts: {}, notes: [], sampleName: '', v: {}, ov: {}, exec: Person.empty(), raw: '', sampleStr: null };
  }
  function curTab() { return C.tabs.filter(function (t) { return t.id === C.cur; })[0] || null; }
  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(toast.h);
    toast.h = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  /* ---------- хранение ---------- */

  function idbOpen() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('actgen-ct', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function kv(mode, key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', mode === 'get' ? 'readonly' : 'readwrite');
        var st = tx.objectStore('kv');
        var rq = mode === 'get' ? st.get(key) : st.put(val, key);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }
  function saveNow() {
    if (!C) return;
    var slim = {
      seq: C.seq, cur: C.cur, common: C.common, customDefs: C.customDefs,
      tabs: C.tabs.map(function (t) {
        return { id: t.id, name: t.name, meta: t.meta, samples: t.samples, counts: t.counts, notes: t.notes, sampleName: t.sampleName, v: t.v, ov: t.ov, exec: t.exec, raw: t.raw, sampleStr: t.sampleStr, sampleCommon: t.sampleCommon, hasTpl: !!t.doc };
      })
    };
    try { localStorage.setItem(lsKey(), JSON.stringify(slim)); } catch (e) { /* нет места / приватный режим */ }
    C.tabs.forEach(function (t) {
      if (!t.doc || !dirtyTpl[t.id]) return;
      delete dirtyTpl[t.id];
      kv('put', tplKey(t.id), { xml: Docx.serialize(t.doc), entries: t.entries.filter(function (e) { return e.name !== 'word/document.xml'; }) }).catch(function () { toast('Образец не удалось сохранить в браузере — после перезапуска его придётся загрузить заново.'); });
    });
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(lsKey()); } catch (e) { /* ничего */ }
    C = { seq: 0, cur: 'common', common: { vals: {}, ov: {} }, customDefs: {}, tabs: [] };
    var jobs = [];
    if (raw) {
      try {
        var s = JSON.parse(raw);
        C.seq = s.seq || 0; C.cur = s.cur || 'common'; C.common = s.common || C.common; C.customDefs = s.customDefs || {};
        (s.tabs || []).forEach(function (st) {
          var t = newTab(st.name); C.seq--; t.id = st.id;
          ['meta', 'samples', 'counts', 'notes', 'sampleName', 'v', 'ov', 'exec', 'raw', 'sampleStr', 'sampleCommon'].forEach(function (k) { if (st[k] !== undefined) t[k] = st[k]; });
          C.tabs.push(t);
          if (st.hasTpl) jobs.push(kv('get', tplKey(st.id)).then(function (rec) {
            if (!rec) return;
            t.doc = Docx.parseXml(rec.xml);
            t.entries = rec.entries.concat([{ name: 'word/document.xml', data: new Uint8Array(0) }]);
          }).catch(function () { }));
        });
      } catch (e) { C.tabs = []; }
    }
    if (!C.tabs.length) DEFAULT_TABS.forEach(function (n) { C.tabs.push(newTab(n)); });
    return Promise.all(jobs);
  }

  /* ---------- значения ---------- */

  function store(tab, scope) { return scope === 'common' ? C.common : tab; }
  function scopeOf(tab, key) {
    if (CAT[key]) return CAT[key].scope;
    if (C.customDefs[key]) return C.customDefs[key].scope;
    return 'tab';
  }
  function labelOf(key) {
    var m = /^(CDATE|PRICE|VATAMT)_/.exec(key);
    if (m) return m[1] === 'CDATE' ? 'Дата договора' : m[1] === 'PRICE' ? 'Цена договора' : 'НДС, сумма';
    if (/^PART\d+_/.test(key)) return 'Составляющая цены №' + key.slice(4, key.indexOf('_'));
    if (/^PAY\d+_PCT$/.test(key)) return 'Платёж №' + key.slice(3, key.indexOf('_')) + ': % от цены';
    if (/^PAY\d+_/.test(key)) return 'Платёж №' + key.slice(3, key.indexOf('_')) + ', сумма';
    return (CAT[key] && CAT[key].label) || (C.customDefs[key] && C.customDefs[key].label) || key;
  }
  function rawGet(tab, key) {
    var st = store(tab, scopeOf(tab, key));
    var vals = st.vals || st.v;
    return vals && vals[key] != null ? vals[key] : '';
  }
  function rawSet(tab, key, val) {
    var sc = scopeOf(tab, key), st = store(tab, sc);
    var vals = sc === 'common' ? st.vals : st.v;
    vals[key] = val;
    // зависимые, вычисляемые из этого поля, сбрасываем на автоматические
    if (key === 'CUST_FIO') ['CUST_FIO_GEN', 'CUST_SIGNER', 'CUST_SIGNER_R'].forEach(function (k) { delete C.common.ov[k]; });
  }
  function spaced(tab) { return !!(tab.meta && tab.meta.spaced); }

  function dateOf(tab) { return RU.fromIso(tab.v.CDATE); }
  function priceK(tab) { return RU.parseMoney(tab.v.PRICE || ''); }
  function groupNum(k, withDec, nbsp) {
    var s = RU.fmtMoney(k).replace(new RegExp(NB, 'g'), nbsp ? NB : SP);
    return withDec ? s : s.replace(/,\d\d$/, '');
  }
  function plural(n, f1, f2, f5) {
    var a = n % 100, b = n % 10;
    if (a >= 11 && a <= 19) return f5;
    return b === 1 ? f1 : (b >= 2 && b <= 4 ? f2 : f5);
  }
  function wordsOf(k, units, cap) {
    var s;
    if (units) s = RU.rubWords(k).replace(/\.$/, '');
    else s = RU.intToWords(Math.floor(k / 100));
    return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s.charAt(0).toLowerCase() + s.slice(1);
  }

  function execFio(ex) { return ex.type === 'org' ? ex.director : ex.fio; }
  function execShort(ex) {
    if (ex.type === 'org') return ex.name;
    if (ex.type === 'ip') return 'ИП' + SP + ex.fio;
    if (ex.type === 'selfemployed') return 'Самозанятый ' + ex.fio;
    return ex.fio;
  }
  function execSignPost(tab) {
    var ex = tab.exec, shortStyle = tab.sampleStr && /^ИП$/i.test(tab.sampleStr.signPost || '');
    if (ex.type === 'org') return ex.post || 'Генеральный директор';
    if (ex.type === 'ip') return shortStyle ? 'ИП' : 'Индивидуальный предприниматель';
    if (ex.type === 'selfemployed') return 'Самозанятый';
    return '';
  }

  /** Значение метки; undefined — метка неизвестна. */
  function tokenValue(tab, key) {
    var m, ex = tab.exec;
    if ((m = /^CDATE_([QLD])$/.exec(key))) {
      var d = dateOf(tab); if (!d) return '';
      if (m[1] === 'Q') return '«' + RU.pad2(d.d) + '» ' + RU.MONTHS_GEN[d.m] + SP + d.y;
      if (m[1] === 'L') return RU.pad2(d.d) + SP + RU.MONTHS_GEN[d.m] + SP + d.y;
      return RU.dateDots(d);
    }
    if (/^PAY\d+_PCT$/.test(key)) return tab.v[key] == null ? '' : tab.v[key];
    if ((m = /^(PRICE|VATAMT|PART\d+|PAY\d+)_(NUM_D|NUM|WCU|WC|WU|W|CURC|CURR|CUR)$/.exec(key))) {
      var pk = priceK(tab);
      if (pk == null) return '';
      var k = pk;
      if (m[1] === 'VATAMT') {
        var pct = parseFloat(String(tab.v.VAT_PCT || '').replace(',', '.'));
        if (isNaN(pct)) return '';
        k = Math.round(tab.meta && tab.meta.vatMode === 'incl' ? pk * pct / (100 + pct) : pk * pct / 100);
      } else if (/^PAY/.test(m[1])) {
        var pc = parseFloat(String(tab.v[m[1] + '_PCT'] || '').replace(',', '.'));
        if (isNaN(pc)) return '';
        k = Math.round(pk * pc / 100);
        // последний платёж берёт остаток, чтобы платежи в сумме дали цену до копейки
        var pks = Object.keys(tab.counts).filter(function (q) { return /^PAY\d+_PCT$/.test(q); }).map(function (q) { return +q.slice(3, q.indexOf('_')); }).sort(function (x, y) { return x - y; });
        var me = +m[1].slice(3);
        if (pks.length > 1 && me === pks[pks.length - 1]) {
          var pctAll = 0, accP = 0;
          pks.forEach(function (n2) { var v2 = parseFloat(String(tab.v['PAY' + n2 + '_PCT'] || '').replace(',', '.')) || 0; pctAll += v2; if (n2 !== me) accP += Math.round(pk * v2 / 100); });
          if (Math.abs(pctAll - 100) < 0.001) k = pk - accP;
        }
      } else if (m[1] !== 'PRICE') {
        var parts = (tab.meta && tab.meta.parts) || [], pn = +m[1].slice(4) - 1, tot = 0, acc = 0;
        if (pn >= parts.length) return undefined;
        parts.forEach(function (x) { tot += x; });
        for (var pj = 0; pj < pn; pj++) acc += Math.round(pk * parts[pj] / tot);
        k = pn === parts.length - 1 ? pk - acc : Math.round(pk * parts[pn] / tot);
      }
      var nb = !!(tab.meta && tab.meta.nbsp);
      if (m[2] === 'NUM') return groupNum(k, false, nb);
      if (m[2] === 'NUM_D') return groupNum(k, true, nb);
      if (/^CUR/.test(m[2])) {
        var rub = Math.floor(k / 100), kop = k % 100;
        var rw = plural(rub, 'рубль', 'рубля', 'рублей');
        if (m[2] === 'CURR') return rw;
        return rw + (m[2] === 'CURC' ? ',' : '') + SP + RU.pad2(kop) + SP + plural(kop, 'копейка', 'копейки', 'копеек');
      }
      return wordsOf(k, /U/.test(m[2]), /C/.test(m[2]));
    }
    if (key === 'EXEC_INTRO' && tab.ov.EXEC_INTRO != null) return tab.ov.EXEC_INTRO;
    if (/^EXEC_/.test(key)) {
      if (!tab.doc && false) return undefined;
      var role = (tab.meta && tab.meta.roleE) || 'Исполнитель';
      switch (key) {
        case 'EXEC_INTRO': return Person.intro(ex, role);
        case 'EXEC_REQ_NAME': return Person.reqLines(ex).name;
        case 'EXEC_REQ_LINES': return Person.reqLines(ex).lines;
        case 'EXEC_FIO': return execFio(ex);
        case 'EXEC_SHORTNAME': return execShort(ex);
        case 'EXEC_SIGNER': return Person.signer(ex, spaced(tab));
        case 'EXEC_SIGNER_R': return Person.signerR(ex, spaced(tab));
        case 'EXEC_SIGN_POST': return execSignPost(tab);
        case 'EXEC_INN': return ex.inn;
        case 'EXEC_KPP': return ex.kpp;
        case 'EXEC_OGRN': return ex.type === 'ip' ? ex.ogrnip : ex.ogrn;
        case 'EXEC_RS': return ex.rs;
        case 'EXEC_KS': return ex.ks;
        case 'EXEC_BIK': return ex.bik;
        case 'EXEC_ADDR': return ex.address;
        case 'EXEC_BANK': return ex.bank;
        case 'EXEC_PHONE': return ex.phone;
        case 'EXEC_EMAIL': return ex.email;
        default: return undefined;
      }
    }
    if (CAT[key] && CAT[key].derived) {
      if (C.common.ov[key] != null) return C.common.ov[key];
      var fio = C.common.vals.CUST_FIO || '';
      if (key === 'CUST_FIO_GEN') return fio ? Person.genitive(fio) : '';
      if (key === 'CUST_SIGNER') return fio ? Person.shortFio(fio, spaced(tab)) : '';
      if (key === 'CUST_SIGNER_R') return fio ? Person.shortFioR(fio, spaced(tab)) : '';
    }
    if (CAT[key] || C.customDefs[key]) return rawGet(tab, key);
    return undefined;
  }

  /* ---------- проверки ---------- */

  function checkTab(tab) {
    var out = [];
    function e(t) { out.push({ level: 'err', text: t }); }
    function w(t) { out.push({ level: 'warn', text: t }); }
    function i(t) { out.push({ level: 'info', text: t }); }
    if (!tab.doc) { e('Не загружен образец договора для этой вкладки.'); return out; }
    var cv = C.common.vals;
    if (!cv.CUST_NAME) e('Заказчик: не указано наименование.');
    if (!cv.CUST_INN) e('Заказчик: нет ИНН.');
    else if (!Person.innOk(cv.CUST_INN)) e('Заказчик: ИНН ' + cv.CUST_INN + ' не проходит проверку контрольной цифры — опечатка?');
    if (cv.CUST_RS || cv.CUST_BIK) {
      if (!/^\d{20}$/.test(cv.CUST_RS || '')) e('Заказчик: расчётный счёт должен быть 20 цифр.');
      else if (!Person.accountOk(cv.CUST_RS, cv.CUST_BIK)) e('Заказчик: расчётный счёт не сходится с БИК по контрольной цифре — опечатка.');
    }
    if (cv.CUST_KPP && !/^\d{9}$/.test(cv.CUST_KPP)) e('Заказчик: КПП — 9 цифр.');
    if (!cv.CUST_FIO && tab.counts.CUST_FIO_GEN) w('Заказчик: ФИО представителя в именительном падеже не указано — родительный падеж и подпись не вычислить.');
    Person.check(tab.exec, 'Исполнитель').forEach(function (c) { out.push(c); });
    if (!tab.v.CNO) e('Не указан номер договора.');
    else C.tabs.forEach(function (o) { if (o !== tab && o.doc && o.v.CNO && o.v.CNO === tab.v.CNO) e('Номер договора ' + tab.v.CNO + ' уже стоит на вкладке «' + o.name + '».'); });
    if (!dateOf(tab)) e('Не указана дата договора.');
    if (tab.counts.PRICE_NUM || tab.counts.PRICE_NUM_D || Object.keys(tab.counts).some(function (k) { return /^PRICE_/.test(k); })) {
      var pk = priceK(tab);
      if (!pk || pk <= 0) e('Не указана цена договора.');
      else if (pk % 100 !== 0 && Object.keys(tab.counts).some(function (k) { return /^PRICE_(NUM|W|WC)$/.test(k); }) && !Object.keys(tab.counts).some(function (k) { return /^PRICE_CURC?$/.test(k); }))
        e('Цена с копейками, а в образце копейки записаны обычным текстом («… рублей 00 копеек»). Введите цену в целых рублях либо поправьте этот текст в образце.');
    }
    var payKeys = Object.keys(tab.counts).filter(function (k) { return /^PAY\d+_PCT$/.test(k); });
    if (payKeys.length && priceK(tab)) {
      var ps = 0, pctSum = 0;
      payKeys.forEach(function (k) { ps += Math.round(priceK(tab) * (parseFloat(String(tab.v[k] || '').replace(',', '.')) || 0) / 100); pctSum += parseFloat(String(tab.v[k] || '').replace(',', '.')) || 0; });
      if (Math.abs(pctSum - 100) > 0.001) w('Платежи в процентах дают ' + pctSum + '%, а не 100%.');
      else if (ps !== priceK(tab)) e('Платежи в сумме дают ' + RU.fmtMoney(ps) + ', а цена договора ' + RU.fmtMoney(priceK(tab)) + ' — разница из-за округления копеек, поправьте платёж вручную в предпросмотре.');
    }
    var pctOk = tab.counts.VAT_PCT ? !isNaN(parseFloat(String(tab.v.VAT_PCT || '').replace(',', '.'))) : true;
    if (!pctOk) e('Не указана ставка НДС.');
    // метки
    var unknown = [];
    Object.keys(Ctpl.tokensOf(Docx.serialize(tab.doc))).forEach(function (k) { if (tokenValue(tab, k) === undefined) unknown.push(k); });
    if (unknown.length) e('В образце есть неизвестные метки: ' + unknown.map(function (k) { return '{{' + k + '}}'; }).join(', ') + '.');
    // пустые поля
    var blanks = [];
    Object.keys(tab.counts).forEach(function (k) {
      var v = tokenValue(tab, k);
      if ((v === '' || (Array.isArray(v) && !v.length)) && tab.counts[k] && !/_SIGN_POST$|_KPP$|_KS$|_LINES$|^EXEC_(OGRN|EMAIL|PHONE)$|^CUST_(KPP|KS|PHONE|EMAIL)$|VATAMT|VAT_PCT/.test(k)) blanks.push(labelOf(k));
    });
    var uniq = blanks.filter(function (x, ix) { return blanks.indexOf(x) === ix; });
    if (uniq.length) w('Пустые поля (в договоре будет пропуск): ' + uniq.join('; ') + '.');
    // остатки образца
    var txt = (($('#ctPaper') && $('#ctPaper').textContent) || '').replace(/[\s ]+/g, ' ');
    var ss = tab.sampleStr || {}, ex = tab.exec, left = [];
    function chk(val, cur, what, digits) {
      if (!val || val === cur) return;
      var hay = digits ? txt.replace(/[\s]/g, '') : txt;
      if (hay.indexOf(digits ? val.replace(/\D/g, '') : val) >= 0) left.push(what + ' «' + val + '»');
    }
    chk(ss.inn, ex.inn, 'ИНН образца', true);
    chk(ss.ogrn, ex.type === 'ip' ? ex.ogrnip : ex.ogrn, 'ОГРН образца', true);
    chk(ss.rs, ex.rs, 'счёт образца', true);
    chk(ss.email, ex.email, 'e-mail образца');
    if (ss.stem && execFio(ex) && execFio(ex).toLowerCase().indexOf(ss.stem.toLowerCase()) !== 0) {
      var sre = new RegExp(ss.stem + '[а-яё]*', 'i');
      if (sre.test(txt)) left.push('фамилия «' + ss.stem + '…» из образца');
    }
    if (left.length) e('В тексте остались данные образца (не заменены полями): ' + left.join(', ') + '. Выделите их в предпросмотре и сделайте полем, либо поправьте текст.');
    // суммы и даты вне полей
    var moneyOut = 0, re = /(\d{1,3}(?:\s\d{3})+|\d+)(?:[.,]\d\d)?\s*(?:₽|руб)/g, mm, pk2 = priceK(tab);
    while ((mm = re.exec(txt))) { var kv2 = RU.parseMoney(mm[0].replace(/\s*(₽|руб).*/, '')); if (kv2 != null && kv2 !== pk2) moneyOut++; }
    var datesOut = (txt.match(/\d{2}\.\d{2}\.\d{4}/g) || []).length;
    if (moneyOut || datesOut) i('В тексте образца остались суммы (' + moneyOut + ') и даты (' + datesOut + '), не связанные с полями — например приложения «График финансирования» и «График проектирования». Они печатаются как в образце: проверьте их глазами и при необходимости правьте прямо в предпросмотре.');
    (tab.notes || []).forEach(function (n) { w(n); });
    return out;
  }

  /* ---------- экран ---------- */

  function render() {
    renderOrg();
    renderTabs();
    renderLeft();
    renderPreview();
  }

  function renderTabs() {
    var box = $('#ctTabs');
    box.replaceChildren();
    function tabBtn(id, name, cls) {
      var b = el('button', { class: 'ct-tab' + (C.cur === id ? ' on' : '') + (cls ? ' ' + cls : ''), text: name, type: 'button',
        onclick: function () { C.cur = id; saveSoon(); render(); } });
      return b;
    }
    box.appendChild(tabBtn('common', '★ Общее', 'common'));
    C.tabs.forEach(function (t) {
      var b = tabBtn(t.id, t.name);
      if (t.doc) b.classList.add('has');
      b.title = t.doc ? ('Образец: ' + (t.sampleName || '—')) : 'Образец не загружен';
      box.appendChild(b);
    });
    box.appendChild(el('button', { class: 'ct-tab add', type: 'button', text: '+', title: 'Добавить вкладку (раздел)', onclick: function () {
      var n = prompt('Название вкладки (раздела), например ТХ или АС:', '');
      if (!n) return;
      var t = newTab(n.trim()); C.tabs.push(t); C.cur = t.id; saveSoon(); render();
    } }));
    var xf = el('input', { type: 'file', accept: '.xlsx', hidden: 'hidden' });
    xf.addEventListener('change', function () { if (xf.files[0]) importExcel(xf.files[0]); xf.value = ''; });
    box.appendChild(el('div', { class: 'ct-xl' }, [
      el('button', { class: 'btn sm', type: 'button', text: '⇩ Excel: шаблон с данными', title: 'Скачать таблицу карточек (Заказчик + исполнители по разделам)', onclick: exportExcel }),
      el('button', { class: 'btn sm primary', type: 'button', text: '⇪ Загрузить Excel', title: 'Заполненная таблица карточек → все договоры заполнятся сами', onclick: function () { xf.click(); } }),
      xf
    ]));
  }

  /* поле ввода, привязанное к значению */
  function field(label, get, set, opts) {
    opts = opts || {};
    var inp = el(opts.area ? 'textarea' : 'input', { 'data-fk': opts.key || '', rows: opts.area ? (opts.rows || 2) : false, type: opts.type || 'text', inputmode: opts.inputmode || false, placeholder: opts.placeholder || '' });
    inp.value = get() == null ? '' : get();
    inp.addEventListener('input', function () { set(inp.value); afterChange(); });
    var lab = el('label', null, [document.createTextNode(label), opts.hint ? el('span', { class: 'muted', text: ' ' + opts.hint }) : null, inp]);
    if (opts.reset) {
      lab.appendChild(el('button', { class: 'ct-reset', type: 'button', title: 'Вернуть автоматическое значение', text: '↺', onclick: function () { opts.reset(); inp.value = get(); afterChange(); } }));
    }
    fieldRefs.push({ inp: inp, get: get });
    return lab;
  }
  function afterChange() {
    syncFields();
    saveSoon();
    schedulePreview();
  }
  function syncFields() {
    fieldRefs.forEach(function (r) {
      if (document.activeElement === r.inp) return;
      var v = r.get(); v = v == null ? '' : v;
      if (r.inp.value !== v) r.inp.value = v;
    });
  }
  function schedulePreview() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () { renderPreview(true); }, 220);
  }

  function card(title, kids, open) {
    return el('details', { class: 'card', open: open === false ? false : 'open' }, [el('summary', { text: title })].concat(kids));
  }

  function commonField(key, extra) {
    var c = CAT[key];
    var o = { key: key, area: c.area, reset: c.derived ? function () { delete C.common.ov[key]; } : null };
    for (var k in (extra || {})) o[k] = extra[k];
    var tab = curTab() || { v: {}, meta: null };
    return field(c.label, function () { return tokenValue(tab, key); }, function (v) {
      if (c.derived) C.common.ov[key] = v; else rawSet(tab, key, v);
    }, o);
  }

  function renderLeft() {
    var box = $('#ctLeft');
    box.replaceChildren();
    fieldRefs = [];
    var tab = curTab();
    if (C.cur === 'common' || !tab) return renderCommon(box);

    // образец
    var file = el('input', { type: 'file', accept: '.docx,.doc', hidden: 'hidden' });
    file.addEventListener('change', function () { if (file.files[0]) loadSample(tab, file.files[0]); file.value = ''; });
    var others = C.tabs.filter(function (t) { return t !== tab && t.doc; });
    var copySel = el('select', { onchange: function (ev) {
      var src = C.tabs.filter(function (t) { return t.id === ev.target.value; })[0];
      if (src) copyTemplate(src, tab);
    } }, [el('option', { value: '', text: 'или взять образец с другой вкладки…' })].concat(others.map(function (t) { return el('option', { value: t.id, text: t.name }); })));
    box.appendChild(card('Образец договора — ' + tab.name, [
      el('div', { class: 'ct-sample' }, [
        el('div', { class: 'ct-sname', text: tab.doc ? ('Загружен: ' + (tab.sampleName || 'образец')) : 'Образец не загружен' }),
        el('div', { class: 'ct-sbtns' }, [
          el('button', { class: 'btn primary sm', type: 'button', text: tab.doc ? 'Заменить образец' : 'Загрузить образец (.docx, .doc)', onclick: function () { file.click(); } }),
          file
        ]),
        others.length ? copySel : null,
        el('p', { class: 'muted', text: 'Образец — обычный договор Word с реальными данными. Программа найдёт в нём стороны, номер, дату, цену, объект и заменит на поля; оформление и текст остаются как в Word. Образец у каждой вкладки свой (разные приложения, ТЗ, сроки).' })
      ])
    ]));
    if (!tab.doc) return;

    // исполнитель
    box.appendChild(card('Исполнитель', executorForm(tab)));
    // договор
    var dk = [
      field('Номер договора', function () { return tab.v.CNO || ''; }, function (v) { tab.v.CNO = v; }, { key: 'CNO' }),
      el('div', { class: 'grid2' }, [
        field('Дата договора', function () { return tab.v.CDATE || ''; }, function (v) { tab.v.CDATE = v; }, { type: 'date', key: 'CDATE' }),
        field('Цена договора, ₽', function () { return tab.v.PRICE || ''; }, function (v) { tab.v.PRICE = v; }, { key: 'PRICE', inputmode: 'decimal', hint: '(с копейками: 8000000,00)' })
      ])
    ];
    if (tab.counts.VAT_PCT || tab.counts.VATAMT_NUM || tab.counts.VATAMT_NUM_D) dk.push(field('Ставка НДС, %', function () { return tab.v.VAT_PCT || ''; }, function (v) { tab.v.VAT_PCT = v; }, { key: 'VAT_PCT', hint: '(сумма НДС и прописью пересчитаются)' }));
    Object.keys(tab.counts).filter(function (k) { return /^PAY\d+_PCT$/.test(k); }).sort().forEach(function (k) {
      dk.push(field(labelOf(k), function () { return tab.v[k] || ''; }, function (v) { tab.v[k] = v; }, { key: k, hint: '(сумма платежа пересчитается)' }));
    });
    if (tab.counts.SUBJECT) dk.push(field(CAT.SUBJECT.label, function () { return tab.v.SUBJECT || ''; }, function (v) { tab.v.SUBJECT = v; }, { key: 'SUBJECT', area: true, rows: 3 }));
    Object.keys(C.customDefs).forEach(function (k) {
      if (C.customDefs[k].scope === 'tab' && tab.counts[k]) dk.push(field(C.customDefs[k].label, function () { return tab.v[k] || ''; }, function (v) { tab.v[k] = v; }, { key: k, area: true }));
    });
    var allBtn = el('button', { class: 'btn ghost sm', type: 'button', text: 'Дату — во все вкладки', onclick: function () {
      C.tabs.forEach(function (t) { if (t.doc) t.v.CDATE = tab.v.CDATE; });
      saveSoon(); toast('Дата договора проставлена на всех вкладках с образцом.'); schedulePreview();
    } });
    dk.push(allBtn);
    box.appendChild(card('Договор', dk));

    // общее, использованное в этом образце
    var cust = el('div', { class: 'ct-commonhint', html: 'Заказчик, объект и город — на вкладке <b>★ Общее</b>: правятся один раз и меняются во всех договорах.' });
    box.appendChild(cust);

    // поля шаблона
    box.appendChild(card('Поля образца', [fieldsTable(tab)], false));
    var chk = el('div', { id: 'ctChecks' });
    box.insertBefore(chk, box.firstChild);
    renderChecks();
  }

  function renderCommon(box) {
    var tab = curTab() || { v: {}, meta: null };
    var paste = el('textarea', { rows: 4, placeholder: 'Вставьте реквизиты Заказчика: наименование, ИНН, КПП, адрес, счёт, банк, БИК, директор…' });
    box.appendChild(el('div', { class: 'ct-commonhint', html: '<b>Общее для всех договоров.</b> Что здесь поменять — поменяется во всех вкладках, где это поле есть в образце.' }));
    C.tabs.filter(function (t) { return t.doc && t.sampleCommon; }).forEach(function (t) {
      var sc = t.sampleCommon, cv = C.common.vals;
      var keys = Object.keys(sc).filter(function (k) { return sc[k] && Ctpl.nz(sc[k]) !== Ctpl.nz(cv[k] || ''); });
      if (!keys.length) return;
      var tbl = el('table', { class: 'ct-read' });
      keys.forEach(function (k) {
        tbl.appendChild(el('tr', null, [
          el('td', { text: labelOf(k) }),
          el('td', { class: 'diff', text: sc[k] }),
          el('td', { text: cv[k] || '—' }),
          el('td', null, [el('button', { class: 'btn ghost sm', type: 'button', text: 'взять', onclick: function () { cv[k] = sc[k]; if (k === 'CUST_FIO') ['CUST_FIO_GEN', 'CUST_SIGNER', 'CUST_SIGNER_R'].forEach(function (q) { delete C.common.ov[q]; }); autoNameOrg(); saveSoon(); render(); } })])
        ]));
      });
      box.appendChild(card('Прочитано из договора «' + t.name + '» — отличается от общего (' + keys.length + ')', [
        el('p', { class: 'muted', text: 'Колонки: поле · в договоре (оранжевое) · сейчас в «Общем». Нажмите «взять», чтобы принять значение из договора.' }),
        tbl,
        el('button', { class: 'btn sm', type: 'button', text: 'Взять всё из договора «' + t.name + '»', onclick: function () {
          keys.forEach(function (k) { cv[k] = sc[k]; });
          ['CUST_FIO_GEN', 'CUST_SIGNER', 'CUST_SIGNER_R'].forEach(function (q) { delete C.common.ov[q]; });
          autoNameOrg(); saveSoon(); render();
        } })
      ]));
    });
    box.appendChild(card('Заказчик: вставить исходные данные', [
      paste,
      el('button', { class: 'btn sm', type: 'button', text: 'Разобрать и заполнить', onclick: function () {
        var r = Person.parse(paste.value).party, cv = C.common.vals, n = 0;
        function setIf(k, v) { if (v) { cv[k] = v; n++; } }
        setIf('CUST_NAME', r.name); setIf('CUST_LONG', r.fullName); setIf('CUST_INN', r.inn); setIf('CUST_KPP', r.kpp);
        setIf('CUST_ADDR', r.address); setIf('CUST_RS', r.rs); setIf('CUST_KS', r.ks); setIf('CUST_BIK', r.bik); setIf('CUST_BANK', r.bank);
        setIf('CUST_PHONE', r.phone); setIf('CUST_EMAIL', r.email); setIf('CUST_FIO', r.director);
        if (r.director) ['CUST_FIO_GEN', 'CUST_SIGNER', 'CUST_SIGNER_R'].forEach(function (k) { delete C.common.ov[k]; });
        toast('Заполнено полей: ' + n + '. Проверьте результат ниже.');
        saveSoon(); render();
      } })
    ], false));
    box.appendChild(card('Город и объект', [
      commonField('CITY'), commonField('OBJECT', { rows: 4 })
    ]));
    box.appendChild(card('Заказчик', [
      commonField('CUST_NAME'), commonField('CUST_LONG'),
      commonField('CUST_FIO'), commonField('CUST_REP_POST'), commonField('CUST_REP_BASIS'),
      el('div', { class: 'grid2' }, [commonField('CUST_FIO_GEN'), commonField('CUST_SIGNER')]),
      commonField('CUST_SIGN_POST'),
      el('div', { class: 'grid2' }, [commonField('CUST_INN'), commonField('CUST_KPP')]),
      commonField('CUST_ADDR'),
      el('div', { class: 'grid2' }, [commonField('CUST_RS'), commonField('CUST_KS')]),
      el('div', { class: 'grid2' }, [commonField('CUST_BANK'), commonField('CUST_BIK')]),
      el('div', { class: 'grid2' }, [commonField('CUST_PHONE'), commonField('CUST_EMAIL')])
    ]));
    var extra = Object.keys(C.customDefs).filter(function (k) { return C.customDefs[k].scope === 'common'; });
    if (extra.length) box.appendChild(card('Свои общие поля', extra.map(function (k) {
      return field(C.customDefs[k].label, function () { return C.common.vals[k] || ''; }, function (v) { C.common.vals[k] = v; }, { key: k, area: true });
    })));
    box.insertBefore(el('div', { id: 'ctChecks' }), box.firstChild);
    renderChecks();
  }

  function executorForm(tab) {
    var ex = tab.exec, kids = [];
    var paste = el('textarea', { rows: 5, placeholder: 'Вставьте исходные данные Исполнителя как есть: ФИО, паспорт, ИНН, ОГРНИП, адрес, счёт, БИК, телефон, почта. Можно написать «самозанятый» или «ИП» — вид определится сам.' });
    paste.value = tab.raw || '';
    paste.addEventListener('input', function () { tab.raw = paste.value; saveSoon(); });
    kids.push(paste);
    kids.push(el('div', { class: 'ct-row' }, [
      el('button', { class: 'btn sm primary', type: 'button', text: 'Разобрать и заполнить', onclick: function () {
        var r = Person.parse(paste.value);
        tab.exec = r.party; delete tab.ov.EXEC_INTRO;
        toast('Вид: ' + Person.TYPE_NAMES[r.party.type] + (r.notes.length ? '. ' + r.notes.join(' ') : '.'));
        saveSoon(); renderLeft(); renderPreview(true);
      } })
    ]));
    var sel = el('select', { onchange: function (ev) { ex.type = ev.target.value; if (ex.type === 'ip' && !ex.name) ex.name = 'ИП ' + ex.fio; delete tab.ov.EXEC_INTRO; saveSoon(); renderLeft(); schedulePreview(); } },
      Object.keys(Person.TYPE_NAMES).map(function (k) { return el('option', { value: k, text: Person.TYPE_NAMES[k], selected: ex.type === k ? 'selected' : false }); }));
    kids.push(el('label', null, [document.createTextNode('Вид исполнителя'), sel]));
    function pf(label, prop, o) { return field(label, function () { return ex[prop] || ''; }, function (v) { ex[prop] = v; delete tab.ov.EXEC_INTRO; }, o); }
    if (ex.type === 'org') {
      kids.push(pf('Наименование (кратко: ООО «…»)', 'name'), pf('Полное наименование', 'fullName', { hint: '(пусто — раскрою ООО/АО автоматически)' }));
      kids.push(el('div', { class: 'grid2' }, [pf('Должность руководителя', 'post'), pf('Основание (Устава, Доверенности…)', 'basis')]));
      kids.push(pf('Руководитель (ФИО)', 'director'));
      kids.push(el('div', { class: 'grid2' }, [pf('ИНН', 'inn'), pf('КПП', 'kpp')]));
      kids.push(pf('ОГРН', 'ogrn'));
    } else {
      kids.push(pf('ФИО', 'fio'));
      kids.push(el('div', { class: 'grid2' }, [pf('ИНН', 'inn'), ex.type === 'ip' ? pf('ОГРНИП', 'ogrnip') : pf('Дата рождения', 'birth')]));
      if (ex.type === 'person' || ex.type === 'selfemployed') {
        kids.push(el('div', { class: 'grid2' }, [pf('Паспорт: серия', 'passSeries'), pf('Паспорт: номер', 'passNumber')]));
        kids.push(pf('Кем выдан', 'passIssued'));
        kids.push(el('div', { class: 'grid2' }, [pf('Дата выдачи', 'passDate'), pf('Код подразделения', 'passCode')]));
      }
    }
    kids.push(pf(ex.type === 'org' ? 'Юридический адрес' : 'Адрес', 'address', { area: true }));
    kids.push(el('div', { class: 'grid2' }, [pf('Расчётный счёт', 'rs'), pf('Корр. счёт', 'ks')]));
    kids.push(el('div', { class: 'grid2' }, [pf('Банк', 'bank'), pf('БИК', 'bik')]));
    kids.push(el('div', { class: 'grid2' }, [pf('Телефон', 'phone'), pf('E-mail', 'email')]));
    return kids;
  }

  function fieldsTable(tab) {
    var rows = Object.keys(tab.counts).filter(function (k) { return tab.counts[k] > 0; }).sort();
    var live = Ctpl.tokensOf(Docx.serialize(tab.doc));
    var tbl = el('table', { class: 'ct-fields' });
    rows.concat(Object.keys(live).filter(function (k) { return rows.indexOf(k) < 0; })).forEach(function (k) {
      var n = live[k] || 0;
      if (!n) return;
      var scope = scopeOf(tab, k);
      var tr = el('tr', null, [
        el('td', { text: labelOf(k) + (/^(CDATE|PRICE|VATAMT)_/.test(k) ? ' (' + k.replace(/^[A-Z]+_/, '') + ')' : '') }),
        el('td', { class: 'sc ' + scope, text: scope === 'common' ? 'общее' : 'договор' }),
        el('td', { class: 'n', text: '×' + n }),
        el('td', null, [C.customDefs[k] ? el('button', { class: 'btn ghost sm', type: 'button', text: 'вернуть текстом', title: 'Заменить поле обратно на обычный текст', onclick: function () { unmark(tab, k); } }) : null])
      ]);
      tbl.appendChild(tr);
    });
    return tbl;
  }

  /* ---------- предпросмотр ---------- */

  function renderPreview(keepScroll) {
    var tab = curTab() || C.tabs.filter(function (t) { return t.doc; })[0] || null;
    var wrap = $('#ctPaperWrap'), paper = $('#ctPaper');
    var st = wrap.scrollTop;
    paper.replaceChildren();
    if (!tab || !tab.doc) {
      paper.appendChild(el('div', { class: 'ct-empty', html: '<b>Здесь появится договор.</b><br>Откройте вкладку раздела (АР, ОВ, ВК…) и загрузите образец договора.' }));
      $('#ctBuild').disabled = true; $('#ctZip').disabled = true; $('#ctMark').disabled = true;
      return;
    }
    $('#ctBuild').disabled = false; $('#ctZip').disabled = false; $('#ctMark').disabled = false;
    var ctx = { val: function (k) { return tokenValue(tab, k); }, label: labelOf };
    var page = Ctpl.renderPage(tab.doc, ctx);
    page.classList.add('ctpage');
    Array.prototype.forEach.call(page.querySelectorAll('.p'), function (d) { d.setAttribute('contenteditable', 'true'); d.setAttribute('spellcheck', 'false'); });
    paper.appendChild(page);
    tab._paras = Ctpl.paras(tab.doc);
    $('#ctPreviewTitle').textContent = 'Предпросмотр: ' + tab.name + (C.cur === 'common' ? ' (на вкладке «Общее» показан первый договор)' : '');
    if (keepScroll) wrap.scrollTop = st;
    renderChecks();
  }

  function renderChecks() {
    var box = $('#ctChecks');
    if (!box) return;
    var tab = curTab();
    var list;
    if (C.cur === 'common' || !tab) {
      list = [];
      var cv = C.common.vals;
      if (cv.CUST_INN && !Person.innOk(cv.CUST_INN)) list.push({ level: 'err', text: 'Заказчик: ИНН ' + cv.CUST_INN + ' не проходит проверку контрольной цифры.' });
      if ((cv.CUST_RS || cv.CUST_BIK) && !Person.accountOk(cv.CUST_RS, cv.CUST_BIK)) list.push({ level: 'err', text: 'Заказчик: расчётный счёт не сходится с БИК по контрольной цифре (или неполный).' });
      if (cv.CUST_KPP && !/^\d{9}$/.test(cv.CUST_KPP)) list.push({ level: 'err', text: 'Заказчик: КПП — 9 цифр.' });
      if (!cv.CUST_NAME) list.push({ level: 'warn', text: 'Заказчик не заполнен.' });
      if (!list.length && cv.CUST_NAME) list.push({ level: 'ok', text: 'Реквизиты Заказчика проходят проверку контрольных цифр.' });
    } else list = checkTab(tab);
    box.replaceChildren();
    if (!list.length) list = [{ level: 'ok', text: 'Замечаний нет.' }];
    var errs = list.filter(function (c) { return c.level === 'err'; }).length;
    var head = errs ? 'Ошибок: ' + errs + ' — договор лучше не отправлять' : (list.some(function (c) { return c.level === 'warn'; }) ? 'Есть предупреждения' : 'Проверки пройдены');
    var ul = el('ul');
    list.forEach(function (c) { ul.appendChild(el('li', { class: 'ck-' + c.level, text: c.text })); });
    box.appendChild(el('div', { class: 'warn ' + (errs ? 'err' : (list.some(function (c) { return c.level === 'warn'; }) ? '' : 'ok')) }, [el('b', { text: head }), ul]));
  }

  /* правка текста прямо в предпросмотре */
  function onPaperInput(ev) {
    var d = ev.target.closest && ev.target.closest('.p');
    if (!d) return;
    var tab = curTab() || C.tabs.filter(function (t) { return t.doc; })[0];
    if (!tab || !tab._paras) return;
    var p = tab._paras[+d.getAttribute('data-pi')];
    if (!p) return;
    var text = Ctpl.readBack(d).replace(/ /g, ' ');
    var cur = Ctpl.ptext(p);
    if (text.replace(/\s+$/, '') === cur.replace(/[ ]/g, ' ').replace(/\s+$/, '') && text.length === cur.length) return;
    if (Ctpl.applyEdit(p, Ctpl.readBack(d))) { dirtyTpl[tab.id] = true; saveSoon(); }
  }

  /* окошко правки значения метки */
  function openPop(chip) {
    var tab = curTab() || C.tabs.filter(function (t) { return t.doc; })[0];
    var key = chip.getAttribute('data-tk'), pop = $('#ctPop');
    var m = /^(CDATE|PRICE|VATAMT|PART\d+)_/.exec(key), base = m ? (m[1] === 'VATAMT' ? 'VAT_PCT' : /^PART/.test(m[1]) ? 'PRICE' : m[1]) : key;
    var sc = scopeOf(tab, base);
    pop.replaceChildren();
    pop.appendChild(el('div', { class: 'pop-h', text: labelOf(key) }));
    pop.appendChild(el('div', { class: 'pop-sc ' + sc, text: sc === 'common' ? 'Общее поле — изменится во всех договорах' : 'Только в этом договоре' }));
    if (CAT[base] && CAT[base].exec) {
      pop.appendChild(el('div', { class: 'muted', text: 'Собирается из данных Исполнителя (левая колонка).' }));
      pop.appendChild(el('button', { class: 'btn sm', type: 'button', text: 'К данным Исполнителя', onclick: function () { closePop(); if (C.cur === 'common') { C.cur = tab.id; render(); } var x = $('#ctLeft'); if (x) x.scrollTop = 0; } }));
      if (key === 'EXEC_INTRO') {
        var ta = el('textarea', { rows: 5 }); ta.value = tokenValue(tab, key);
        ta.addEventListener('input', function () { tab.ov.EXEC_INTRO = ta.value; saveSoon(); schedulePreview(); });
        pop.appendChild(el('div', { class: 'muted', text: 'Или поправьте текст вручную:' })); pop.appendChild(ta);
        pop.appendChild(el('button', { class: 'btn ghost sm', type: 'button', text: '↺ автоматический', onclick: function () { delete tab.ov.EXEC_INTRO; closePop(); saveSoon(); renderPreview(true); } }));
      }
    } else {
      var inp = CAT[base] && CAT[base].area || (C.customDefs[base] && true) ? el('textarea', { rows: 4 }) : el('input', { type: CAT[base] && CAT[base].date ? 'date' : 'text' });
      if (base === 'CDATE') inp.value = tab.v.CDATE || ''; else { var cv = CAT[base] && CAT[base].derived ? tokenValue(tab, base) : rawGet(tab, base); inp.value = cv == null ? '' : cv; }
      inp.addEventListener('input', function () {
        if (CAT[base] && CAT[base].derived) C.common.ov[base] = inp.value;
        else if (base === 'CDATE' || base === 'PRICE' || base === 'VAT_PCT') tab.v[base] = inp.value;
        else rawSet(tab, base, inp.value);
        saveSoon(); syncFields(); schedulePreview();
      });
      pop.appendChild(inp);
      setTimeout(function () { inp.focus(); inp.select && inp.select(); }, 0);
    }
    pop.appendChild(el('button', { class: 'btn ghost sm pop-x', type: 'button', text: '✕', onclick: closePop }));
    var r = chip.getBoundingClientRect();
    pop.hidden = false;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - 340), top = r.bottom + 6;
    if (top + 220 > window.innerHeight) top = Math.max(8, r.top - 226);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function closePop() { var p = $('#ctPop'); if (p) p.hidden = true; }

  /* «Сделать полем»: выделенный в предпросмотре текст */
  function markSelection() {
    var tab = curTab() || C.tabs.filter(function (t) { return t.doc; })[0];
    var sel = window.getSelection();
    if (!tab || !sel.rangeCount || sel.isCollapsed) { toast('Сначала выделите в предпросмотре текст, который должен стать полем.'); return; }
    var rg = sel.getRangeAt(0);
    var d1 = (rg.startContainer.nodeType === 3 ? rg.startContainer.parentNode : rg.startContainer).closest('.p');
    var d2 = (rg.endContainer.nodeType === 3 ? rg.endContainer.parentNode : rg.endContainer).closest('.p');
    if (!d1 || d1 !== d2) { toast('Выделение должно быть внутри одного абзаца.'); return; }
    var a = Ctpl.offsetIn(d1, rg.startContainer, rg.startOffset), b = Ctpl.offsetIn(d1, rg.endContainer, rg.endOffset);
    if (a < 0 || b < 0 || b <= a) { toast('В выделение попало готовое поле — выделите только обычный текст.'); return; }
    var p = tab._paras[+d1.getAttribute('data-pi')], full = Ctpl.ptext(p), s = full.slice(a, b);
    if (/\{\{|\}\}/.test(s)) { toast('В выделение попало готовое поле.'); return; }
    var name = prompt('Название поля (например: «Срок выполнения» или «Кадастровые номера»):', s.length < 40 ? s : '');
    if (!name) return;
    var common = confirm('Это поле общее для всех договоров (как Заказчик или Объект)?\n\nОК — общее (правится один раз, меняется во всех вкладках)\nОтмена — только в этом договоре');
    var all = confirm('Заменить полем все такие же фрагменты текста в этом договоре?\n\nОК — все совпадения\nОтмена — только выделенный');
    var key = 'X' + (Object.keys(C.customDefs).length + 1);
    while (C.customDefs[key]) key = key + 'X';
    C.customDefs[key] = { label: name, scope: common ? 'common' : 'tab' };
    if (common) C.common.vals[key] = s; else tab.v[key] = s;
    var n = 0;
    Ctpl.paras(tab.doc).forEach(function (pp, i) {
      if (pp === p) { Ctpl.replaceRange(pp, a, b, '{{' + key + '}}'); n++; if (all) rescan(pp); }
      else if (all) { n += rescan(pp); }
    });
    function rescan(pp) {
      var c = 0, t = Ctpl.ptext(pp), idx;
      while ((idx = t.indexOf(s)) >= 0 && !/\{\{[A-Z0-9_]*$/.test(t.slice(0, idx))) {
        Ctpl.replaceRange(pp, idx, idx + s.length, '{{' + key + '}}'); c++; t = Ctpl.ptext(pp);
        if (t.indexOf(s) >= 0 && c > 50) break;
      }
      return c;
    }
    tab.counts[key] = n; dirtyTpl[tab.id] = true;
    toast('Поле «' + name + '» создано (' + n + ' мест). Значение — в левой колонке.');
    saveSoon(); sel.removeAllRanges(); render();
  }

  function unmark(tab, key) {
    var val = tokenValue(tab, key); if (Array.isArray(val)) val = val.join('; ');
    Ctpl.paras(tab.doc).forEach(function (p) {
      var t = Ctpl.ptext(p), tok = '{{' + key + '}}', idx;
      while ((idx = t.indexOf(tok)) >= 0) { Ctpl.replaceRange(p, idx, idx + tok.length, val || ''); t = Ctpl.ptext(p); }
    });
    delete tab.counts[key]; dirtyTpl[tab.id] = true; saveSoon(); render();
  }

  /* ---------- загрузка образца ---------- */

  function toDocx(buf, name) {
    var u = new Uint8Array(buf);
    if (u[0] === 0x50 && u[1] === 0x4B) return Promise.resolve(buf);
    if (/\.pdf$/i.test(name) || (u[0] === 0x25 && u[1] === 0x50)) return Promise.reject(new Error('это PDF — сохраните образец из Word как .docx.'));
    if (location.protocol.indexOf('http') !== 0) return Promise.reject(new Error('файл .doc: откройте программу через serve.ps1 (http://localhost:8790/), там конвертация через Word, либо сохраните образец как .docx.'));
    toast('Старый формат .doc — конвертирую через Word…');
    return fetch('convert', { method: 'POST', body: buf }).then(function (r) {
      if (!r.ok) throw new Error('Word не смог открыть файл. Сохраните образец как .docx.');
      return r.arrayBuffer();
    });
  }

  function loadSample(tab, file) {
    toast('Читаю образец…');
    file.arrayBuffer().then(function (b) { return toDocx(b, file.name); }).then(function (b) { return Zip.read(b); }).then(function (entries) {
      var d = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
      if (!d) throw new Error('В файле нет текста договора.');
      var xml = new TextDecoder('utf-8').decode(d.data);
      var lines = Extract.readLines(xml), parsed = Extract.parseContract(lines);
      var res = Ctpl.analyze(xml, lines, parsed);
      applyAnalysis(tab, res, entries, file.name);
    }).catch(function (e) { toast('Не получилось: ' + (e && e.message || e)); console.error(e); });
  }

  function applyAnalysis(tab, res, entries, name) {
    tab.entries = entries;
    tab.doc = Docx.parseXml(res.xml);
    tab.meta = res.meta; tab.samples = res.samples; tab.counts = res.counts;
    tab.notes = res.notes.slice(); tab.sampleName = name;
    tab.v = {}; tab.ov = {};
    for (var k in res.init.tab) tab.v[k] = res.init.tab[k];
    if (tab.v.PRICE) tab.v.PRICE = tab.v.PRICE.replace(new RegExp(NB, 'g'), SP);
    tab.exec = res.init.exec || Person.empty();
    tab.raw = '';
    var ex = tab.exec;
    tab.sampleStr = {
      inn: ex.inn, ogrn: ex.type === 'ip' ? ex.ogrnip : ex.ogrn, rs: ex.rs, email: ex.email,
      stem: (execFioOf(ex) || '').split(/\s+/)[0].slice(0, 5), signPost: res.samples.EXEC_SIGN_POST || ''
    };
    // общие данные: читаем из образца; если в «Общем» уже другое — спрашиваем, что считать верным
    var cv = C.common.vals, sc = res.init.common;
    if (res.init.fioGen && !sc.CUST_FIO) {
      sc.CUST_FIO = Person.nominative(res.init.fioGen);
      tab.notes.push('ФИО представителя Заказчика в образце только в родительном падеже («' + res.init.fioGen + '»); именительный («' + sc.CUST_FIO + '») получен автоматически — проверьте на вкладке «Общее».');
    }
    tab.sampleCommon = sc;
    var diffKeys = Object.keys(sc).filter(function (k) { return sc[k] && cv[k] && Ctpl.nz(cv[k]) !== Ctpl.nz(sc[k]); });
    var useAll = !Object.keys(cv).some(function (k) { return cv[k]; });
    if (!useAll && diffKeys.length) {
      useAll = confirm('В договоре «' + name + '» общие данные отличаются от тех, что сейчас на вкладке «Общее»:\n\n' + diffKeys.slice(0, 8).map(function (k) { return '• ' + labelOf(k) + ': в договоре «' + String(sc[k]).slice(0, 50) + '», сейчас «' + String(cv[k]).slice(0, 50) + '»'; }).join('\n') + (diffKeys.length > 8 ? '\n…и ещё ' + (diffKeys.length - 8) : '') + '\n\nОК — взять общие данные из этого договора.\nОтмена — оставить как есть (потом можно выбрать по полям на вкладке «Общее»).');
    }
    Object.keys(sc).forEach(function (k) { if (sc[k] && (useAll || !cv[k])) cv[k] = sc[k]; });
    if (useAll || diffKeys.length === 0) ['CUST_FIO_GEN', 'CUST_SIGNER', 'CUST_SIGNER_R'].forEach(function (k) { delete C.common.ov[k]; });
    if (!useAll && diffKeys.length) tab.notes.push('В образце «' + name + '» отличаются от общих данных: ' + diffKeys.map(labelOf).join(', ') + '. В договор пойдут общие данные.');
    if (res.init.ov.CUST_SIGNER && !cv.CUST_FIO) C.common.ov.CUST_SIGNER = res.init.ov.CUST_SIGNER;
    dirtyTpl[tab.id] = true;
    C.cur = tab.id; autoNameOrg();
    saveNow(); render();
    toast('Образец «' + name + '» разобран: ' + Object.keys(res.counts).length + ' видов полей, ' + Object.keys(res.counts).reduce(function (s, k) { return s + res.counts[k]; }, 0) + ' замен.');
  }
  function execFioOf(ex) { return ex.type === 'org' ? ex.director : ex.fio; }

  function copyTemplate(src, dst) {
    var xml = Docx.serialize(src.doc);
    dst.entries = src.entries.slice(); dst.doc = Docx.parseXml(xml);
    dst.meta = JSON.parse(JSON.stringify(src.meta || {})); dst.samples = JSON.parse(JSON.stringify(src.samples)); dst.counts = JSON.parse(JSON.stringify(src.counts));
    dst.notes = ['Образец взят с вкладки «' + src.name + '» — замените его своим, если у раздела другие приложения и сроки.'];
    dst.sampleName = src.sampleName;
    dst.v = {}; ['CUST_X'].forEach(function () { });
    dst.v.SUBJECT = src.v.SUBJECT; dst.v.VAT_PCT = src.v.VAT_PCT; dst.v.CDATE = src.v.CDATE;
    dst.exec = Person.empty(); dst.sampleStr = JSON.parse(JSON.stringify(src.sampleStr || {}));
    Object.keys(C.customDefs).forEach(function (k) { if (C.customDefs[k].scope === 'tab' && src.v[k] != null) dst.v[k] = src.v[k]; });
    dirtyTpl[dst.id] = true; saveNow(); render();
    toast('Образец скопирован. Заполните исполнителя, номер и цену.');
  }

  /* ---------- выпуск файла ---------- */

  function bytesOfDocx(tab) {
    var xml = Docx.serialize(tab.doc);
    var filled = Ctpl.fill(xml, function (k) { return tokenValue(tab, k); });
    var problems = [];
    var chk = Docx.parseXml(filled);
    var paras = Docx.docParagraphs(chk).join('\n');
    if (/\{\{[A-Z0-9_]+\}\}/.test(paras)) problems.push('остались неподставленные метки: ' + (paras.match(/\{\{[A-Z0-9_]+\}\}/g) || []).slice(0, 5).join(', '));
    var must = [['номер договора', tab.v.CNO], ['ИНН Заказчика', C.common.vals.CUST_INN]];
    if (tab.counts.EXEC_REQ_NAME || tab.counts.EXEC_INN) must.push(['ИНН Исполнителя', tab.exec.inn]);
    must.forEach(function (m) { if (m[1] && paras.replace(/\s/g, '').indexOf(String(m[1]).replace(/\s/g, '')) < 0) problems.push('в договоре нет значения «' + m[0] + '»'); });
    var pk = priceK(tab);
    if (pk != null && Object.keys(tab.counts).some(function (k) { return /^PRICE_NUM/.test(k); })) {
      var want = RU.fmtMoney(pk).replace(new RegExp(NB, 'g'), '').replace(/,\d\d$/, '');
      if (paras.replace(/[\s ]/g, '').indexOf(want) < 0) problems.push('в договоре нет суммы ' + want);
      if (RU.wordsToInt(wordsOf(pk, false, false)) !== Math.floor(pk / 100)) problems.push('сумма прописью не сошлась с цифрами');
    }
    return { bytes: Docx.buildDocx(tab.entries, filled), problems: problems };
  }
  function fileNameOf(tab) {
    var n = 'Договор №' + (tab.v.CNO || 'б-н') + ' ' + tab.name + ' ' + (execShort(tab.exec) || '');
    return n.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.docx';
  }
  function download(bytes, name, type) {
    var url = URL.createObjectURL(new Blob([bytes], { type: type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function buildOne() {
    var tab = curTab() || C.tabs.filter(function (t) { return t.doc; })[0];
    if (!tab || !tab.doc) return;
    var errs = checkTab(tab).filter(function (c) { return c.level === 'err'; });
    if (errs.length && !confirm('В договоре есть ошибки проверки (' + errs.length + '):\n\n' + errs.slice(0, 5).map(function (e) { return '• ' + e.text; }).join('\n') + '\n\nВсё равно скачать?')) return;
    var r = bytesOfDocx(tab);
    if (r.problems.length) { alert('Файл не выпущен — итоговая проверка нашла проблемы:\n\n' + r.problems.join('\n')); return; }
    download(r.bytes, fileNameOf(tab));
    toast('Готово: ' + fileNameOf(tab));
  }
  function buildAll() {
    var tabs = C.tabs.filter(function (t) { return t.doc; }), out = [], bad = [];
    tabs.forEach(function (t) {
      var errs = checkTab(t).filter(function (c) { return c.level === 'err'; });
      var r = bytesOfDocx(t);
      if (r.problems.length) { bad.push(t.name + ': ' + r.problems.join('; ')); return; }
      if (errs.length) bad.push(t.name + ': в договоре есть ошибки проверки (' + errs.length + '), файл всё равно положен в архив');
      out.push({ name: fileNameOf(t), data: r.bytes });
    });
    if (!out.length) { alert('Нечего выпускать:\n' + bad.join('\n')); return; }
    if (bad.length && !confirm('Замечания:\n\n' + bad.join('\n') + '\n\nСкачать архив с тем, что получилось?')) return;
    download(Zip.write(out), 'Договоры.zip', 'application/zip');
    toast('В архиве договоров: ' + out.length);
  }

  /* ---------- Excel: карточки сторон ---------- */

  var X_COMMON = [
    ['CITY', 'Город', 'г. Екатеринбург'], ['OBJECT', 'Объект (название стройки)', ''],
    ['CUST_NAME', 'Заказчик: краткое наименование', 'ООО ПБ «АРМ»'], ['CUST_LONG', 'Заказчик: полное наименование', ''],
    ['CUST_FIO', 'Представитель Заказчика: ФИО (именительный падеж)', 'Шмидт Дмитрий Аркадьевич'],
    ['CUST_REP_POST', 'Должность представителя (родительный падеж)', 'Управляющего индивидуального предпринимателя'],
    ['CUST_REP_BASIS', 'Основание полномочий', 'действующего на основании Устава'],
    ['CUST_SIGN_POST', 'Должность в блоке подписи', 'Управляющий ИП'],
    ['CUST_INN', 'ИНН', ''], ['CUST_KPP', 'КПП', ''], ['CUST_ADDR', 'Адрес', ''], ['CUST_RS', 'Расчётный счёт', ''],
    ['CUST_BANK', 'Банк', ''], ['CUST_KS', 'Корр. счёт', ''], ['CUST_BIK', 'БИК', ''], ['CUST_PHONE', 'Телефон', ''], ['CUST_EMAIL', 'E-mail', '']
  ];
  var X_PER = [
    ['type', 'Вид исполнителя (выберите из списка)'], ['fio', 'ФИО (для ИП, самозанятого, физлица)'], ['name', 'Наименование (для организации)'],
    ['director', 'Руководитель организации: ФИО'], ['post', 'Должность руководителя'], ['basis', 'Основание (Устава, Доверенности…)'],
    ['inn', 'ИНН'], ['kpp', 'КПП (организация)'], ['ogrn', 'ОГРН (организация) / ОГРНИП (ИП)'],
    ['passSeries', 'Паспорт: серия'], ['passNumber', 'Паспорт: номер'], ['passIssued', 'Паспорт: кем выдан'], ['passDate', 'Паспорт: дата выдачи'], ['passCode', 'Паспорт: код подразделения'], ['birth', 'Дата рождения'],
    ['address', 'Адрес'], ['rs', 'Расчётный счёт'], ['ks', 'Корр. счёт'], ['bank', 'Банк'], ['bik', 'БИК'], ['phone', 'Телефон'], ['email', 'E-mail']
  ];
  var X_CT = [
    ['CNO', 'Номер договора'], ['CDATE', 'Дата договора (дд.мм.гггг)'], ['PRICE', 'Цена договора, ₽'], ['VAT_PCT', 'Ставка НДС, %'], ['SUBJECT', 'Предмет договора (что разрабатывает)']
  ];
  var X_TYPES = { 'Организация': 'org', 'ИП': 'ip', 'Самозанятый': 'selfemployed', 'Физлицо': 'person' };

  function isoToDots(s) { var d = RU.fromIso(s); return d ? RU.dateDots(d) : (s || ''); }
  function xlsxDate(v) {
    v = String(v || '').trim();
    if (/^\d{5}(\.\d+)?$/.test(v)) { var dt = new Date(Math.round((parseFloat(v) - 25569) * 86400000)); return RU.pad2(dt.getUTCDate()) + '.' + RU.pad2(dt.getUTCMonth() + 1) + '.' + dt.getUTCFullYear(); }
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (m) return m[3] + '.' + m[2] + '.' + m[1];
    return v;
  }

  function exportExcel() {
    var tabs = C.tabs, rows = [], lists = [];
    var head = [{ v: '' }, { v: 'Поле', s: 'head' }, { v: 'ОБЩЕЕ (для всех договоров)', s: 'head' }].concat(tabs.map(function (t) { return { v: t.name, s: 'head' }; }));
    rows.push([{ v: 'Карточки сторон для договоров. Заполните жёлтые ячейки и загрузите файл в программу (вкладка «Договор» → «Загрузить Excel»). Колонка «ОБЩЕЕ» — Заказчик и объект (одни на все договоры), колонки АР, ОВ, ВК… — исполнитель и условия каждого договора. Все ячейки текстовые — пишите как есть, ИНН и счета без пробелов.', s: 'note' }]);
    rows[0].h = 44;
    rows.push(head); rows[1].h = 24;
    function sec(t) { var r = [{ v: '' }, { v: t, s: 'sec' }, { s: 'sec', v: '' }]; tabs.forEach(function () { r.push({ s: 'sec', v: '' }); }); rows.push(r); }
    sec('ОБЩИЕ ДАННЫЕ: заказчик и объект');
    X_COMMON.forEach(function (f) {
      var r = [{ v: 'c.' + f[0], s: 'key' }, { v: f[1], s: 'label' }, { v: (f[0] === 'CUST_FIO_GEN' ? '' : C.common.vals[f[0]] || ''), s: 'input' }];
      tabs.forEach(function () { r.push({ v: '' }); });
      rows.push(r);
    });
    sec('ИСПОЛНИТЕЛЬ ПО РАЗДЕЛУ');
    X_PER.forEach(function (f) {
      var r = [{ v: 'e.' + f[0], s: 'key' }, { v: f[1], s: 'label' }, { v: '' }];
      tabs.forEach(function (t) {
        var ex = t.exec, v = '';
        if (f[0] === 'type') v = t.doc || ex.inn || ex.fio || ex.name ? Object.keys(X_TYPES).filter(function (k) { return X_TYPES[k] === ex.type; })[0] : '';
        else if (f[0] === 'ogrn') v = ex.type === 'ip' ? ex.ogrnip : ex.ogrn;
        else v = ex[f[0]];
        r.push({ v: v || '', s: 'input' });
      });
      if (f[0] === 'type') lists.push({ ref: Xlsx.colName(3) + (rows.length + 1) + ':' + Xlsx.colName(2 + tabs.length) + (rows.length + 1), items: Object.keys(X_TYPES) });
      rows.push(r);
    });
    sec('ДОГОВОР');
    X_CT.forEach(function (f) {
      var r = [{ v: 't.' + f[0], s: 'key' }, { v: f[1], s: 'label' }, { v: '' }];
      tabs.forEach(function (t) { r.push({ v: f[0] === 'CDATE' ? isoToDots(t.v.CDATE) : (t.v[f[0]] || ''), s: 'input' }); });
      rows.push(r);
    });
    sec('ИЛИ ПРОСТО ТЕКСТОМ');
    var rr = [{ v: 'e.raw', s: 'key' }, { v: 'Исходные данные исполнителя текстом (паспорт, ИНН, счёт… как есть). Разберутся сами, а явно заполненные ячейки выше главнее.', s: 'label' }, { v: '' }];
    tabs.forEach(function (t) { rr.push({ v: t.raw || '', s: 'input' }); });
    rr.h = 110; rows.push(rr);
    var widths = [0, 46, 44].concat(tabs.map(function () { return 34; }));
    var bytes = Xlsx.write(rows, { widths: widths, freeze: { row: 2, col: 3 }, lists: lists, sheet: 'Карточки' });
    download(bytes, 'Карточки сторон для договоров.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('Шаблон Excel скачан. Заполните жёлтые ячейки и загрузите обратно.');
  }

  function importExcel(file) {
    file.arrayBuffer().then(function (buf) { return Xlsx.read(buf); }).then(function (x) {
      var cells = x.cells, rowOf = {}, r, report = [], bad = [];
      for (r = 1; r <= x.rows; r++) { var k = cells['A' + r]; if (k) rowOf[k] = r; }
      if (!rowOf['c.CITY'] && !rowOf['e.fio']) throw new Error('Не тот файл: не нашёл служебные строки. Скачайте шаблон кнопкой «Скачать Excel» и заполните его.');
      function cell(col, key) { var rw = rowOf[key]; return rw ? String(cells[col + rw] || '').replace(/ /g, ' ').trim() : ''; }
      function chkNum(v, what) { if (/^\d\.?\d*E\+\d+$/i.test(v)) { bad.push(what + ': «' + v + '» — Excel превратил число в экспоненту (ячейка не текстовая)'); return ''; } return v; }
      // общее
      var n = 0;
      X_COMMON.forEach(function (f) {
        var v = chkNum(cell('C', 'c.' + f[0]), 'Заказчик, ' + f[1]);
        if (!v) return;
        C.common.vals[f[0]] = v; n++;
        if (f[0] === 'CUST_FIO') ['CUST_FIO_GEN', 'CUST_SIGNER', 'CUST_SIGNER_R'].forEach(function (kk) { delete C.common.ov[kk]; });
      });
      report.push('общее: ' + n + ' полей');
      // вкладки: заголовки в строке 2, начиная с колонки D
      var noTpl = [];
      for (var ci = 3; ci < x.cols; ci++) {
        var col = Xlsx.colName(ci), name = String(cells[col + 2] || '').trim();
        if (!name) continue;
        var vals = {}, any = false;
        X_PER.concat(X_CT).forEach(function (f) { var key = (X_PER.indexOf(f) >= 0 ? 'e.' : 't.') + f[0]; vals[f[0]] = chkNum(cell(col, key), name + ', ' + f[1]); if (vals[f[0]]) any = true; });
        vals.raw = cell(col, 'e.raw'); if (vals.raw) any = true;
        if (!any) continue;
        var tab = C.tabs.filter(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })[0];
        if (!tab) { tab = newTab(name); C.tabs.push(tab); }
        var ex = vals.raw ? Person.parse(vals.raw).party : Person.empty();
        function put(prop, v) { if (v) ex[prop] = v; }
        ['fio', 'name', 'director', 'post', 'basis', 'inn', 'kpp', 'passSeries', 'passNumber', 'passIssued', 'passCode', 'address', 'rs', 'ks', 'bank', 'bik', 'phone', 'email'].forEach(function (p) { put(p, vals[p]); });
        put('passDate', xlsxDate(vals.passDate)); put('birth', xlsxDate(vals.birth));
        var ty = vals.type ? Object.keys(X_TYPES).filter(function (k) { return k.toLowerCase() === vals.type.toLowerCase(); })[0] : null;
        if (!ty && vals.type) { var lt = vals.type.toLowerCase(); ty = /орг|ооо|ао/.test(lt) ? 'Организация' : /^ип|индив/.test(lt) ? 'ИП' : /самоз/.test(lt) ? 'Самозанятый' : /физ/.test(lt) ? 'Физлицо' : null; }
        if (ty) ex.type = X_TYPES[ty];
        else if (!vals.raw) ex.type = ex.name ? 'org' : (ex.passNumber ? 'person' : 'ip');
        if (vals.ogrn) { if (ex.type === 'ip') ex.ogrnip = vals.ogrn; else ex.ogrn = vals.ogrn; }
        if (ex.type === 'ip' && ex.fio && !ex.name) ex.name = 'ИП ' + ex.fio;
        tab.exec = ex; tab.raw = vals.raw || tab.raw; delete tab.ov.EXEC_INTRO;
        if (vals.CNO) tab.v.CNO = vals.CNO;
        if (vals.CDATE) { var dd = xlsxDate(vals.CDATE), m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(dd); if (m) tab.v.CDATE = m[3] + '-' + RU.pad2(+m[2]) + '-' + RU.pad2(+m[1]); else bad.push(name + ': дата договора «' + vals.CDATE + '» — нужен вид дд.мм.гггг'); }
        if (vals.PRICE) { var pk = RU.parseMoney(vals.PRICE.replace(/[₽р.]*$/i, '').trim()); tab.v.PRICE = pk != null ? RU.fmtMoney(pk).replace(new RegExp(NB, 'g'), SP) : vals.PRICE; }
        if (vals.VAT_PCT) tab.v.VAT_PCT = vals.VAT_PCT.replace('%', '').trim();
        if (vals.SUBJECT) tab.v.SUBJECT = vals.SUBJECT;
        report.push(name + (tab.doc ? '' : ' (образец не загружен)'));
        if (!tab.doc) noTpl.push(name);
      }
      saveNow(); render();
      var msg = 'Загружено из Excel: ' + report.join('; ') + '.';
      if (bad.length) alert(msg + '\n\nПроверьте:\n• ' + bad.join('\n• ')); else toast(msg);
    }).catch(function (e) { alert('Excel не загрузился: ' + (e && e.message || e)); });
  }

  /* ---------- организации: у каждой свои общие данные, вкладки и образцы ---------- */

  function renderOrg() {
    var box = $('#ctOrg');
    if (!box) return;
    box.replaceChildren();
    var sel = el('select', { onchange: function (ev) { switchOrg(ev.target.value); } }, ORGS.list.map(function (o) {
      return el('option', { value: o.id, text: o.name, selected: o.id === ORGS.cur ? 'selected' : false });
    }));
    box.appendChild(el('span', { class: 'ct-orglabel', text: 'Организация:' }));
    box.appendChild(sel);
    box.appendChild(el('button', { class: 'btn ghost sm', type: 'button', text: '+ Новая', title: 'Добавить организацию: у неё будут свои Заказчик, объект, вкладки и образцы', onclick: function () {
      var n = prompt('Название организации (как вы её различаете):', '');
      if (!n) return;
      saveNow(); ORGS.seq++;
      var id = 'o' + ORGS.seq;
      ORGS.list.push({ id: id, name: n.trim() }); ORGS.cur = id; saveOrgs();
      Object.keys(dirtyTpl).forEach(function (k) { delete dirtyTpl[k]; });
      load().then(render);
    } }));
    box.appendChild(el('button', { class: 'btn ghost sm', type: 'button', text: 'Переименовать', onclick: function () {
      var o = ORGS.list.filter(function (x) { return x.id === ORGS.cur; })[0];
      var n = prompt('Название организации:', o.name);
      if (n) { o.name = n.trim(); saveOrgs(); renderOrg(); }
    } }));
    if (ORGS.list.length > 1) box.appendChild(el('button', { class: 'btn ghost sm', type: 'button', text: 'Удалить', onclick: function () {
      var o = ORGS.list.filter(function (x) { return x.id === ORGS.cur; })[0];
      if (!confirm('Удалить организацию «' + o.name + '» вместе с её данными и образцами договоров?')) return;
      try { localStorage.removeItem(lsKey()); } catch (e) { /* ничего */ }
      ORGS.list = ORGS.list.filter(function (x) { return x.id !== o.id; }); ORGS.cur = ORGS.list[0].id; saveOrgs();
      Object.keys(dirtyTpl).forEach(function (k) { delete dirtyTpl[k]; });
      load().then(render);
    } }));
  }

  function switchOrg(id) {
    saveNow();
    ORGS.cur = id; saveOrgs();
    Object.keys(dirtyTpl).forEach(function (k) { delete dirtyTpl[k]; });
    load().then(render);
  }

  function autoNameOrg() {
    var o = ORGS.list.filter(function (x) { return x.id === ORGS.cur; })[0], n = C.common.vals.CUST_NAME;
    if (o && n && /^Организация \d+$/.test(o.name)) { o.name = n; saveOrgs(); }
  }

  /* ---------- запуск ---------- */

  function init() {
    var body = document.body;
    $('#modeAct').addEventListener('click', function () { body.classList.remove('mode-ct'); $('#modeAct').classList.add('on'); $('#modeCt').classList.remove('on'); });
    $('#modeCt').addEventListener('click', function () {
      body.classList.add('mode-ct'); $('#modeCt').classList.add('on'); $('#modeAct').classList.remove('on');
      if (!C) start();
    });
    $('#ctBuild').addEventListener('click', buildOne);
    $('#ctZip').addEventListener('click', buildAll);
    $('#ctMark').addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    $('#ctMark').addEventListener('click', markSelection);
    var paper = $('#ctPaper');
    paper.addEventListener('input', onPaperInput);
    paper.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ev.preventDefault(); });
    paper.addEventListener('paste', function (ev) {
      ev.preventDefault();
      var t = (ev.clipboardData || window.clipboardData).getData('text').replace(/[\r\n]+/g, ' ');
      document.execCommand('insertText', false, t);
    });
    paper.addEventListener('click', function (ev) {
      var chip = ev.target.closest && ev.target.closest('.chip');
      if (chip) { ev.preventDefault(); openPop(chip); } else closePop();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closePop(); });
    g.__ct = { exportExcel: exportExcel, importExcelBuf: function (b) { return importExcel({ arrayBuffer: function () { return Promise.resolve(b); } }); }, state: function () { return C; }, tokenValue: function (k) { return tokenValue(curTab() || C.tabs.filter(function (t) { return t.doc; })[0], k); }, checkTab: checkTab, loadSampleBuf: function (buf, name, tabName) {
      var tab = C.tabs.filter(function (t) { return t.name === tabName; })[0] || curTab() || C.tabs[0];
      return toDocx(buf, name).then(function (b) { return Zip.read(b); }).then(function (entries) {
        var xml = new TextDecoder('utf-8').decode(entries.filter(function (e) { return e.name === 'word/document.xml'; })[0].data);
        var lines = Extract.readLines(xml), parsed = Extract.parseContract(lines);
        var t0 = performance.now(), res = Ctpl.analyze(xml, lines, parsed);
        applyAnalysis(tab, res, entries, name);
        return { ms: Math.round(performance.now() - t0), counts: res.counts, notes: res.notes, init: res.init, samples: res.samples };
      });
    }, buildOne: function () { var t = curTab(); return bytesOfDocx(t); }, parsePerson: Person.parse };
  }

  function start() {
    try { var o = JSON.parse(localStorage.getItem(ORGKEY) || 'null'); if (o && o.list && o.list.length) ORGS = o; } catch (e) { /* ничего */ }
    return load().then(function () { render(); });
  }

  document.addEventListener('DOMContentLoaded', function () { init(); });
  g.CtApp = { start: start };
})(window);
