/* Исходные данные стороны договора: разбор свободного текста (паспорт, ИНН, ИП, самозанятый, организация),
   склонение ФИО, проверка ИНН/ОГРН/счёта по контрольным цифрам, сборка вводной части и реквизитов. */
(function (g) {
  'use strict';

  var SP = String.fromCharCode(32);
  var NB = String.fromCharCode(160);

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s\-])([а-яёa-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  /* ---------- пол и склонение ---------- */

  function gender(fio) {
    var w = String(fio || '').trim().split(/\s+/);
    var pat = (w[2] || '').toLowerCase();
    if (/(вич|ич|оглы)$/.test(pat)) return 'm';
    if (/(вна|чна|кызы)$/.test(pat)) return 'f';
    var name = (w[1] || '').toLowerCase();
    if (/[ая]$/.test(name) && !/^(никита|илья|лука|фома|кузьма|савва|данила|гоша|миша|саша|женя|валера|дима|вова|паша)$/.test(name)) return 'f';
    return 'm';
  }

  function hardCons(ch) { return /[гкхжчшщ]/.test(ch); }

  function declWord(w, kind, gen) {
    // родительный падеж: kind = 'sur' | 'name' | 'pat'
    var l = w.toLowerCase(), r;
    if (!l) return w;
    function sub(n, add) { return w.slice(0, w.length - n) + add; }
    if (kind === 'pat') {
      if (/(вич|ич)$/.test(l)) return w + 'а';
      if (/на$/.test(l)) return sub(1, 'ы');
      return w;
    }
    if (kind === 'sur') {
      if (/(енко|ко|ых|их|ово|аго|яго|ых)$/.test(l)) return w;
      if (gen === 'f') {
        if (/(ова|ева|ёва|ина|ына)$/.test(l)) return sub(1, 'ой');
        if (/(ая)$/.test(l)) return sub(2, 'ой');
        if (/(яя)$/.test(l)) return sub(2, 'ей');
        if (/ска$/.test(l) || /цка$/.test(l)) return sub(1, 'ой');
        if (/а$/.test(l)) return hardCons(l.charAt(l.length - 2)) ? sub(1, 'и') : sub(1, 'ы');
        if (/я$/.test(l)) return sub(1, 'и');
        return w;
      }
      if (/(ский|цкий|ской|ной|ый|ой)$/.test(l)) return sub(2, 'ого');
      if (/ий$/.test(l)) return sub(2, 'ия');
      if (/ей$/.test(l)) return sub(2, 'ея');
      if (/й$/.test(l)) return sub(1, 'я');
      if (/ь$/.test(l)) return sub(1, 'я');
      if (/ец$/.test(l) && l.length > 3) return sub(2, 'ца');
      if (/а$/.test(l)) return hardCons(l.charAt(l.length - 2)) ? sub(1, 'и') : sub(1, 'ы');
      if (/я$/.test(l)) return sub(1, 'и');
      if (/[аеёиоуыэюя]$/.test(l)) return w;
      return w + 'а';
    }
    // имя
    if (gen === 'f') {
      if (/ия$/.test(l)) return sub(1, 'и');
      if (/я$/.test(l)) return sub(1, 'и');
      if (/а$/.test(l)) return hardCons(l.charAt(l.length - 2)) ? sub(1, 'и') : sub(1, 'ы');
      if (/ь$/.test(l)) return sub(1, 'и');
      return w;
    }
    if (/(ий)$/.test(l)) return sub(2, 'ия');
    if (/й$/.test(l)) return sub(1, 'я');
    if (/ь$/.test(l)) return sub(1, 'я');
    if (/ия$/.test(l)) return sub(1, 'и');
    if (/я$/.test(l)) return sub(1, 'и');
    if (/а$/.test(l)) return hardCons(l.charAt(l.length - 2)) ? sub(1, 'и') : sub(1, 'ы');
    if (/[аеёиоуыэюя]$/.test(l)) return w;
    r = w + 'а';
    return r;
  }

  /** «Иванов Иван Иванович» → «Иванова Ивана Ивановича» */
  function genitive(fio) {
    var w = String(fio || '').trim().split(/\s+/);
    if (w.length < 2) return fio || '';
    var gn = gender(fio);
    var out = [declWord(w[0], 'sur', gn), declWord(w[1], 'name', gn)];
    if (w[2]) out.push(declWord(w[2], 'pat', gn));
    return out.concat(w.slice(3)).join(SP);
  }

  /** Обратно: «Шмидта Дмитрия Аркадьевича» → «Шмидт Дмитрий Аркадьевич» (приблизительно — для подстановки по умолчанию) */
  function nominative(fioGen) {
    var w = String(fioGen || '').trim().split(/\s+/);
    if (w.length < 2) return fioGen || '';
    var pat = (w[2] || '').toLowerCase();
    var f = /(вны|чны)$/.test(pat);
    function cut(s, n, add) { return s.slice(0, s.length - n) + add; }
    function sur(s) {
      var l = s.toLowerCase();
      if (f) {
        if (/(ой)$/.test(l)) return /(ск|цк)ой$/.test(l) ? cut(s, 2, 'ая') : cut(s, 2, 'а');
        return s;
      }
      if (/(ского|цкого)$/.test(l)) return cut(s, 3, 'ий');
      if (/(ого)$/.test(l)) return cut(s, 3, 'ой');
      if (/(ова|ева|ёва|ина|ына)$/.test(l)) return cut(s, 1, '');
      if (/(ря)$/.test(l)) return cut(s, 1, 'ь');
      if (/(ея)$/.test(l)) return cut(s, 1, 'й');
      if (/[бвгджзклмнпрстфхцчшщ]а$/.test(l)) return cut(s, 1, '');
      if (/[гкхжчшщ]и$/.test(l)) return cut(s, 1, 'а');
      return s;
    }
    function nm(s) {
      var l = s.toLowerCase();
      if (f) {
        if (/ии$/.test(l)) return cut(s, 1, 'я');
        if (/[гкхжчшщ]и$/.test(l)) return cut(s, 1, 'а');
        if (/ы$/.test(l)) return cut(s, 1, 'а');
        if (/и$/.test(l)) return cut(s, 1, 'я');
        return s;
      }
      if (/(ия)$/.test(l)) return cut(s, 1, 'й');
      if (/(ея)$/.test(l)) return cut(s, 1, 'й');
      if (/(ря|ля)$/.test(l)) return cut(s, 1, 'ь');
      if (/[бвгджзклмнпрстфхцчшщ]а$/.test(l)) return cut(s, 1, '');
      if (/[гкхжчшщ]и$/.test(l)) return cut(s, 1, 'а');
      if (/ы$/.test(l)) return cut(s, 1, 'а');
      return s;
    }
    function pt(s) {
      var l = s.toLowerCase();
      if (f) return /(вны|чны)$/.test(l) ? cut(s, 1, 'а') : s;
      return /(вича|ича)$/.test(l) ? cut(s, 1, '') : s;
    }
    return [sur(w[0]), nm(w[1])].concat(w[2] ? [pt(w[2])] : [], w.slice(3)).join(SP);
  }

  /** «Иванов Иван Иванович» → «Иванов И.И.» (разделитель инициалов — по образцу) */
  function shortFio(fio, spaced) {
    var w = String(fio || '').trim().split(/\s+/);
    if (w.length < 2) return fio || '';
    var ini = w[1].charAt(0).toUpperCase() + '.' + (w[2] ? (spaced ? SP : '') + w[2].charAt(0).toUpperCase() + '.' : '');
    return w[0] + SP + ini;
  }
  function shortFioR(fio, spaced) {
    var w = String(fio || '').trim().split(/\s+/);
    if (w.length < 2) return fio || '';
    var ini = w[1].charAt(0).toUpperCase() + '.' + (w[2] ? (spaced ? SP : '') + w[2].charAt(0).toUpperCase() + '.' : '');
    return ini + SP + w[0];
  }

  /* ---------- формы собственности ---------- */

  var FORMS = [
    ['ООО', 'Общество с ограниченной ответственностью'],
    ['АО', 'Акционерное общество'],
    ['ПАО', 'Публичное акционерное общество'],
    ['ЗАО', 'Закрытое акционерное общество'],
    ['НАО', 'Непубличное акционерное общество'],
    ['ИП', 'Индивидуальный предприниматель']
  ];
  function expandForm(short) {
    var s = String(short || '').trim();
    for (var i = 0; i < FORMS.length; i++) {
      var re = new RegExp('^' + FORMS[i][0] + '(?=[\\s«"“])');
      if (re.test(s)) return FORMS[i][1] + s.slice(FORMS[i][0].length);
    }
    return s;
  }
  function collapseForm(full) {
    var s = String(full || '').trim();
    for (var i = 0; i < FORMS.length; i++) {
      var f = FORMS[i][1];
      if (s.toLowerCase().indexOf(f.toLowerCase()) === 0) return FORMS[i][0] + s.slice(f.length);
    }
    return s;
  }

  /* ---------- контрольные цифры ---------- */

  function innOk(inn) {
    var d = String(inn || '').replace(/\D/g, '');
    function chk(w) { var s = 0; for (var i = 0; i < w.length; i++) s += w[i] * +d.charAt(i); return (s % 11) % 10; }
    if (d.length === 10) return chk([2, 4, 10, 3, 5, 9, 4, 6, 8]) === +d.charAt(9);
    if (d.length === 12) return chk([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +d.charAt(10) && chk([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +d.charAt(11);
    return false;
  }
  function ogrnOk(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 13) return +d.slice(12) === (parseInt(d.slice(0, 12), 10) % 11) % 10;
    if (d.length === 15) return +d.slice(14) === (parseInt(d.slice(0, 14), 10) % 13) % 10;
    return false;
  }
  function accountOk(rs, bik) {
    var a = String(rs || '').replace(/\D/g, ''), b = String(bik || '').replace(/\D/g, '');
    if (a.length !== 20 || b.length !== 9) return false;
    var s = (b.slice(6) + a), w = [7, 1, 3], sum = 0;
    for (var i = 0; i < s.length; i++) sum += (+s.charAt(i) * w[i % 3]) % 10;
    return sum % 10 === 0;
  }

  /* ---------- разбор свободного текста ---------- */

  function emptyParty() {
    return {
      type: 'selfemployed', fio: '', name: '', inn: '', kpp: '', ogrn: '', ogrnip: '',
      passSeries: '', passNumber: '', passIssued: '', passDate: '', passCode: '', birth: '',
      address: '', rs: '', ks: '', bik: '', bank: '', phone: '', email: '',
      post: 'Генеральный директор', director: '', basis: 'Устава', fullName: ''
    };
  }

  function digitsLabel(txt, label, n) {
    var re = new RegExp(label + '[^0-9]{0,20}((?:\\d[ ' + NB + ']?){' + (n - 1) + '}\\d)(?!\\d)', 'i');
    var m = re.exec(txt);
    if (!m) return '';
    var d = m[1].replace(/\D/g, '');
    return d.length === n ? d : '';
  }

  /** @returns {{party:Object, notes:string[]}} */
  function parse(text) {
    var p = emptyParty(), notes = [];
    var raw = String(text || '').replace(/[  ]/g, SP).replace(/\r/g, '');
    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var flat = lines.join('\n');
    var m, i;

    m = /[\w.+\-]+@[\w\-]+\.[\w.\-]+/.exec(flat); if (m) p.email = m[0];
    m = /(?<!\d)(?:\+7|8)[\s\-(]*\d{3}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/.exec(flat);
    if (m) {
      var ph = m[0].replace(/\D/g, '');
      if (ph.length === 11) p.phone = '+7 (' + ph.slice(1, 4) + ') ' + ph.slice(4, 7) + '-' + ph.slice(7, 9) + '-' + ph.slice(9);
    }

    // счета: двадцатизначные числа
    var accRe = /(?:^|[^\d])((?:\d[ ]?){19}\d)(?!\d)/g, accs = [];
    while ((m = accRe.exec(flat))) accs.push(m[1].replace(/\D/g, ''));
    accs.forEach(function (a) {
      if (/^301/.test(a)) { if (!p.ks) p.ks = a; }
      else if (!p.rs) p.rs = a;
    });
    var kl = digitsLabel(flat, '(?:к\\s*\\/\\s*с|корр?\\.?\\s*сч[её]т)', 20); if (kl) p.ks = kl;
    var rl = digitsLabel(flat, '(?:р\\s*\\/\\s*с|р\\.\\s*с|расч[её]тный\\s+сч[её]т|сч[её]т)', 20); if (rl && !/^301/.test(rl)) p.rs = rl;
    p.bik = digitsLabel(flat, 'БИК', 9) || ((/(?:^|[^\d])(04\d{7})(?!\d)/.exec(flat) || [])[1] || '');

    var pair = /ИНН\s*\/\s*КПП[^0-9]{0,6}(\d{10,12})\s*\/\s*(\d{9})/i.exec(flat);
    p.inn = pair ? pair[1] : (digitsLabel(flat, 'ИНН', 12) || digitsLabel(flat, 'ИНН', 10));
    if (!p.inn) {
      var lone = flat.replace(/(?:\d[ ]?){19}\d/g, ' ').match(/(?:^|[^\d])(\d{12}|\d{10})(?!\d)/);
      if (lone) p.inn = lone[1];
    }
    p.kpp = pair ? pair[2] : digitsLabel(flat, 'КПП', 9);
    p.ogrnip = digitsLabel(flat, 'ОГРНИП', 15);
    if (!p.ogrnip) p.ogrn = digitsLabel(flat, 'ОГРН', 13) || '';
    if (!p.ogrnip && !p.ogrn) {
      var o15 = /(?:^|[^\d])(3\d{14})(?!\d)/.exec(flat); if (o15) p.ogrnip = o15[1];
    }

    // паспорт
    m = /паспорт[^0-9\n]{0,25}(\d{2})\s*(\d{2})\s*(?:№|N|номер)?\s*(\d{6})/i.exec(flat) || /серия\s*(\d{2})\s*(\d{2})\s*(?:№|N|номер)?\s*(\d{6})/i.exec(flat);
    if (m) { p.passSeries = m[1] + SP + m[2]; p.passNumber = m[3]; }
    else {
      m = /(?:^|[^\d])(\d{4})\s*(\d{6})(?!\d)/.exec(flat.replace(/(?:\d[ ]?){19}\d/g, ' '));
      if (m && !/^(04|30)/.test(m[1])) { p.passSeries = m[1].slice(0, 2) + SP + m[1].slice(2); p.passNumber = m[2]; }
    }
    m = /выдан[а-я]*\s*:?\s*([^\n]+)/i.exec(flat);
    if (m) {
      var iss = m[1];
      var dm = /(\d{2}\.\d{2}\.\d{4})/.exec(iss);
      if (dm) { p.passDate = dm[1]; iss = iss.slice(0, dm.index); }
      iss = iss.replace(/(?:,?\s*(?:дата выдачи|код подразделения)[^,]*)$/i, '');
      iss = iss.replace(/,?\s*код\s*подразделения.*$/i, '');
      p.passIssued = iss.replace(/[,;\s]+$/, '').trim();
      if (!dm) {
        var dm2 = /дата\s+выдачи\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i.exec(flat); if (dm2) p.passDate = dm2[1];
      }
    }
    m = /код\s*подразделения\s*:?\s*(\d{3})\s*[-–]?\s*(\d{3})/i.exec(flat); if (m) p.passCode = m[1] + '-' + m[2];
    m = /(?:дата\s+рождения|д\.\s*р\.|родил\S*)\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i.exec(flat); if (m) p.birth = m[1];

    // адрес
    for (i = 0; i < lines.length; i++) {
      var am = /(?:юр(?:идическ\S*)?\.?\s*адрес|адрес(?:\s+регистрации|\s+места\s+жительства)?|зарегистрирова\S*(?:\s+по\s+адресу)?|прописк\S*|проживает(?:\s+по\s+адресу)?|место\s+жительства)\s*:?\s*(.+)$/i.exec(lines[i]);
      if (am && am[1].length > 8) { p.address = am[1].replace(/[;\s]+$/, ''); break; }
    }
    if (!p.address) {
      for (i = 0; i < lines.length; i++) {
        if (/^\d{6}\s*,/.test(lines[i]) || (/(^|[\s,])(г\.|ул\.|пр-кт|д\.\s*\d)/i.test(lines[i]) && !/паспорт|выдан|банк|инн|р\/с/i.test(lines[i]))) { p.address = lines[i].replace(/^(г\.?\s*)?/, function (x) { return x; }).replace(/[;\s]+$/, ''); break; }
      }
    }

    // банк
    for (i = 0; i < lines.length; i++) {
      var bm = /(?:банк\s*:\s*|(?:^|[\s,;])в\s+)([^,;\n]*?(?:банк|Сбер|Тинькофф|Альфа|ВТБ|Точка|Райффайзен)[^,;\n]*)/i.exec(lines[i]);
      if (bm) { p.bank = bm[1].replace(/[\s.]+$/, '').trim(); break; }
    }

    // тип и наименование
    var org = /((?:ООО|АО|ПАО|ЗАО|НАО)\s*(?:[А-ЯЁA-Z]{1,6}\s+)?[«"“][^»"”\n]{1,80}[»"”])/.exec(flat);
    var orgFull = /((?:Общество с ограниченной ответственностью|Акционерное общество|Публичное акционерное общество|Непубличное акционерное общество|Закрытое акционерное общество)\s*[«"“][^»"”\n]{1,80}[»"”])/i.exec(flat);
    var isIp = /индивидуальн\S*\s+предпринимател|(^|[\s,])ИП(?=[\s,])|ОГРНИП/i.test(flat);
    var isSelf = /самозанят|налог\S*\s+на\s+профессиональн|(^|[^а-я])НПД([^а-я]|$)/i.test(flat);
    var fioRe = /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+(?:вич|ич|вна|чна|оглы|кызы))/;
    var fioCaps = /([А-ЯЁ]{2,}(?:-[А-ЯЁ]+)?)\s+([А-ЯЁ]{2,})\s+([А-ЯЁ]{2,}(?:ВИЧ|ИЧ|ВНА|ЧНА|ОГЛЫ|КЫЗЫ))/;
    function findFio(s) {
      var f = fioRe.exec(s);
      if (f) return f[1] + SP + f[2] + SP + f[3];
      f = fioCaps.exec(s);
      return f ? titleCase(f[0]) : '';
    }

    if ((org || orgFull) && !isIp) {
      p.type = 'org';
      p.name = org ? org[1] : collapseForm(orgFull[1]);
      p.fullName = orgFull ? orgFull[1] : expandForm(p.name);
      var dr = /(?:генеральн\S*\s+директор|директор|руководитель|президент|управляющий)[^А-ЯЁ\n]{0,15}([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i.exec(flat) || /в\s+лице\s+[а-яё\s]*?([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/.exec(flat);
      if (dr) p.director = dr[1];
      else p.director = findFio(flat.replace(p.name, ''));
      var pm = /(генеральн\S*\s+директор|директор|управляющий|президент|руководитель)/i.exec(flat); if (pm) p.post = cap(pm[1].toLowerCase());
      if (/доверенн/i.test(flat)) p.basis = 'Доверенности'; else if (/свидетельств/i.test(flat)) p.basis = 'Свидетельства';
      if (!p.kpp) notes.push('КПП не найден.');
    } else {
      p.fio = findFio(flat);
      if (isIp || (p.ogrnip && !isSelf)) p.type = 'ip';
      else if (isSelf) p.type = 'selfemployed';
      else p.type = p.passNumber ? 'person' : (p.inn.length === 12 ? 'selfemployed' : 'person');
      if (!p.fio) {
        var any = /(?:^|\n)\s*(?:ИП\s+)?([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/.exec(flat);
        if (any) p.fio = any[1];
      }
      if (p.type === 'ip') p.name = 'ИП' + SP + p.fio;
    }
    if (!p.inn) notes.push('ИНН не найден.');
    return { party: p, notes: notes };
  }

  /* ---------- сборка текста для договора ---------- */

  var TYPE_NAMES = { org: 'Организация', ip: 'Индивидуальный предприниматель', selfemployed: 'Самозанятый (НПД)', person: 'Физическое лицо' };

  function isF(p) { return p.type === 'org' ? gender(p.director) === 'f' : gender(p.fio) === 'f'; }

  function passportLine(p) {
    var s = '';
    if (p.passSeries || p.passNumber) s += 'паспорт серия ' + p.passSeries + ' № ' + p.passNumber;
    if (p.passIssued) s += ', выдан ' + p.passIssued;
    if (p.passDate) s += ' ' + p.passDate;
    if (p.passCode) s += ', код подразделения ' + p.passCode;
    return s;
  }

  /** Вводная часть: «…, именуемый в дальнейшем «Исполнитель», …» без завершающей запятой. */
  function intro(p, role) {
    var f = isF(p), tag = '«' + role + '»';
    var named = f ? 'именуемая' : 'именуемый';
    if (p.type === 'org') {
      var nm = p.fullName || expandForm(p.name);
      var o = nm + ', ' + (/ое$/.test(nm.split(SP)[0]) || true ? 'именуемое' : 'именуемый') + ' в дальнейшем ' + tag;
      if (p.director) {
        var post = (p.post || 'Генеральный директор').toLowerCase().replace(/(?:ый|ий) директор$/, 'ого директора').replace(/^директор$/, 'директора').replace(/^управляющий$/, 'управляющего').replace(/^президент$/, 'президента').replace(/^руководитель$/, 'руководителя');
        var act = f ? 'действующей' : 'действующего';
        o += ', в лице ' + post + SP + genitive(p.director) + ', ' + act + ' на основании ' + (p.basis || 'Устава');
      }
      return o;
    }
    var who = p.type === 'ip' ? 'Индивидуальный предприниматель ' + p.fio : (f ? 'Гражданка' : 'Гражданин') + ' Российской Федерации ' + p.fio;
    var s = who + ', ' + named + ' в дальнейшем ' + tag;
    if (p.type === 'selfemployed') {
      s += ', ' + (f ? 'являющаяся' : 'являющийся') + ' плательщиком налога на профессиональный доход (самозанятый)';
      if (p.inn) s += ', ИНН ' + p.inn;
    }
    if (p.type !== 'org') {
      var pl = passportLine(p);
      if (pl && p.type !== 'ip') s += ', ' + pl;
      if (p.type === 'person' && p.address) s += ', зарегистрированн' + (f ? 'ая' : 'ый') + ' по адресу: ' + p.address;
    }
    return s;
  }

  /** Подпись «Иванов И.И.» для блока подписей. */
  function signer(p, spaced) {
    return shortFio(p.type === 'org' ? p.director : p.fio, spaced);
  }
  function signerR(p, spaced) {
    return shortFioR(p.type === 'org' ? p.director : p.fio, spaced);
  }

  /** Реквизиты строками: [название, остальные…] */
  function reqLines(p) {
    var name, L = [];
    if (p.type === 'org') name = p.name;
    else if (p.type === 'ip') name = 'ИП' + SP + p.fio;
    else if (p.type === 'selfemployed') name = 'Самозанятый ' + p.fio;
    else name = p.fio;
    if (p.type === 'org') {
      if (p.inn || p.kpp) L.push('ИНН' + (p.kpp ? '/КПП' : '') + ': ' + p.inn + (p.kpp ? ' / ' + p.kpp : ''));
      if (p.ogrn) L.push('ОГРН: ' + p.ogrn);
      if (p.address) L.push('Юридический адрес: ' + p.address);
    } else {
      if (p.inn) L.push('ИНН: ' + p.inn);
      if (p.ogrnip) L.push('ОГРНИП: ' + p.ogrnip);
      if (p.type === 'person' || p.type === 'selfemployed') {
        var pl = passportLine(p); if (pl) L.push(cap(pl));
        if (p.birth) L.push('Дата рождения: ' + p.birth);
      }
      if (p.address) L.push((p.type === 'ip' ? 'Адрес: ' : 'Адрес регистрации: ') + p.address);
    }
    if (p.rs) L.push('Р/с: ' + p.rs);
    if (p.bank) L.push('Банк: ' + p.bank);
    if (p.bik) L.push('БИК: ' + p.bik);
    if (p.ks) L.push('К/с: ' + p.ks);
    if (p.phone) L.push('Тел.: ' + p.phone);
    if (p.email) L.push('E-mail: ' + p.email);
    return { name: name, lines: L };
  }

  /** Проверки: список {level:'err'|'warn', text} */
  function check(p, who) {
    var out = [];
    function e(t) { out.push({ level: 'err', text: who + ': ' + t }); }
    function w(t) { out.push({ level: 'warn', text: who + ': ' + t }); }
    var nm = p.type === 'org' ? p.name : p.fio;
    if (!nm) e(p.type === 'org' ? 'не указано наименование.' : 'не указано ФИО.');
    if (p.type !== 'org' && p.fio && p.fio.trim().split(/\s+/).length < 3) w('в ФИО меньше трёх слов — отчество указано?');
    if (p.type === 'org' && !p.director) w('не указан руководитель (подписант).');
    if (!p.inn) e('нет ИНН.');
    else if (p.type === 'org' && p.inn.length !== 10) e('у организации ИНН должен быть 10 цифр.');
    else if (p.type !== 'org' && p.inn.length !== 12) e('у физлица, ИП и самозанятого ИНН должен быть 12 цифр.');
    else if (!innOk(p.inn)) e('ИНН ' + p.inn + ' не проходит проверку контрольной цифры — опечатка?');
    if (p.type === 'org') {
      if (p.kpp && !/^\d{9}$/.test(p.kpp)) e('КПП — 9 цифр.');
      if (p.ogrn && !(p.ogrn.length === 13 && ogrnOk(p.ogrn))) e('ОГРН ' + p.ogrn + ' не проходит проверку.');
    }
    if (p.type === 'ip') {
      if (!p.ogrnip) w('нет ОГРНИП.');
      else if (!(p.ogrnip.length === 15 && ogrnOk(p.ogrnip))) e('ОГРНИП ' + p.ogrnip + ' не проходит проверку.');
    }
    if ((p.type === 'person' || p.type === 'selfemployed') && !p.passNumber) w('нет паспортных данных.');
    if (p.passNumber && !/^\d{6}$/.test(p.passNumber)) e('номер паспорта — 6 цифр.');
    if (p.passSeries && !/^\d{2}\s?\d{2}$/.test(p.passSeries)) e('серия паспорта — 4 цифры.');
    if (!p.address) w('нет адреса.');
    if (p.rs || p.bik) {
      if (!/^\d{20}$/.test(p.rs || '')) e('расчётный счёт — 20 цифр.');
      if (!/^\d{9}$/.test(p.bik || '')) e('БИК — 9 цифр.');
      else if (/^\d{20}$/.test(p.rs) && !accountOk(p.rs, p.bik)) e('расчётный счёт не сходится с БИК по контрольной цифре — опечатка в счёте или БИК.');
      if (p.ks && !/^\d{20}$/.test(p.ks)) e('корр. счёт — 20 цифр.');
      if (!p.bank) w('не указан банк.');
    } else w('нет банковских реквизитов.');
    return out;
  }

  g.Person = {
    empty: emptyParty, parse: parse, gender: gender, genitive: genitive, nominative: nominative, shortFio: shortFio, shortFioR: shortFioR,
    expandForm: expandForm, collapseForm: collapseForm, intro: intro, reqLines: reqLines, signer: signer, signerR: signerR,
    check: check, innOk: innOk, ogrnOk: ogrnOk, accountOk: accountOk, TYPE_NAMES: TYPE_NAMES, passportLine: passportLine
  };
})(window);
