/* Проверки расчёта и выгрузки. Открыть tests.html — зелёные строки прошли, красные нет.
   Контрольные значения те же, что в настольной версии: паспортная точка и семь строк
   реальной таблицы подбора. */
(function () {
  "use strict";
  var results = [];

  function ok(name, cond, info) { results.push({ name: name, ok: !!cond, info: info || "" }); }
  function near(a, b, tol) { return isFinite(a) && Math.abs(a - b) <= tol; }
  function nearOk(name, actual, expected, tol) {
    ok(name, near(actual, expected, tol), U.coef(Math.round(actual * 1e6) / 1e6));
  }
  function note(text) { results.push({ note: text }); }

  function vane(code) {
    for (var i = 0; i < Tables.VANE.length; i++) if (Tables.VANE[i].code === code) return Tables.VANE[i];
    return null;
  }
  function turbine(dn) {
    for (var i = 0; i < Tables.TURBINE.length; i++) if (Tables.TURBINE[i].dn === dn) return Tables.TURBINE[i];
    return null;
  }

  /* ---------------------------------------------------------- паспортный метод */

  nearOk("K=1,479, Q=21,611 м³/ч → ΔP, кгс/см²", Calc.passportPressure(1.479, 21.611), 0.06907, 0.00001);
  nearOk("K=1,479, Q=21,611 м³/ч → h, м", Calc.passportHead(1.479, 21.611), 0.691, 0.001);
  nearOk("K турбинного DN 50", turbine(50).k, 0.692, 1e-9);
  nearOk("K крыльчатого DN 25", vane("25").k, 204.08, 1e-9);
  nearOk("K крыльчатого DN 15 (Qn=1,5)", vane("15-1.5").k, 1111, 1e-9);

  /* ---------------------------------------------------------- метод СП */

  function sp(name, qLs, dn, expected) {
    var s = Tables.spFor(dn);
    nearOk(name, Math.round(Calc.spHead(s.s, qLs) * 100) / 100, expected, 0.005);
  }
  sp("Общий на вводе — 4,14 л/с, DN 50", 4.14, 50, 2.45);
  sp("ХВС встроенные — 0,75 л/с, DN 20", 0.75, 20, 2.91);
  sp("ХВС на ГВС 1 зоны — 1,95 л/с, DN 40", 1.95, 40, 1.90);
  sp("ХВС на ГВС 2 зоны — 1,01 л/с, DN 25", 1.01, 25, 2.69);
  sp("Циркуляция 1 зоны — 0,59 л/с, DN 20", 0.59, 20, 1.80);
  sp("Циркуляция 2 зоны — 0,27 л/с, DN 15", 0.27, 15, 1.06);
  sp("Циркуляция встроенных — 0,16 л/с, DN 15", 0.16, 15, 0.37);

  nearOk("S для DN 200 (а не 0,0081 из Excel)", Tables.spFor(200).s, 0.000035, 1e-12);
  ok("DN 125 в таблице СП отсутствует", Tables.spFor(125) === null);

  /* ---------------------------------------------------------- автоподбор */

  function pickDn(qLs, mediumId, filter) {
    var list = Calc.build(qLs, mediumId, true, Calc.defaults());
    var i = Calc.recommend(list, "sp", filter || null);
    return i < 0 ? null : list[i];
  }

  function rec(name, qLs, mediumId, expectDn, expectKind) {
    var c = pickDn(qLs, mediumId);
    ok(name, c && c.dn === expectDn && c.kind === expectKind, c ? c.markFull + ", " + U.fmt(c.hSp, 2) + " м" : "ничего");
  }

  rec("4,14 л/с, ХВС → DN 50 турбинный", 4.14, "cold", 50, "turbine");
  rec("0,75 л/с, ХВС → DN 20 крыльчатый", 0.75, "cold", 20, "vane");
  rec("1,01 л/с, ХВС → DN 25 крыльчатый", 1.01, "cold", 25, "vane");
  rec("0,59 л/с, циркуляция → DN 20 крыльчатый", 0.59, "circ", 20, "vane");
  rec("0,27 л/с, циркуляция → DN 15 крыльчатый", 0.27, "circ", 15, "vane");
  rec("0,16 л/с, циркуляция → DN 15 крыльчатый", 0.16, "circ", 15, "vane");

  var c195 = pickDn(1.95, "cold");
  note("1,95 л/с — автоподбор предлагает " + c195.markFull + " (" + U.fmt(c195.hSp, 2) +
       " м, впритык к пределу 5 м); в проекте принят DN 40 (1,90 м). Оба варианта видны в списке.");

  /* ---------------------------------------------------------- марки и фильтр типа */

  ok("Марка ХВС с импульсным выходом", Tables.mark("cold", true, 50) === "ВСХНд-50", Tables.mark("cold", true, 50));
  ok("Марка ГВС без импульсного выхода", Tables.mark("hot", false, 15) === "ВСГН-15", Tables.mark("hot", false, 15));
  ok("Теплоноситель — всегда ВСТН, без «д»", Tables.mark("heat", true, 80) === "ВСТН-80", Tables.mark("heat", true, 80));

  var onlyTurb = pickDn(0.75, "cold", "turbine");
  ok("Фильтр «только турбинные» уважается", onlyTurb && onlyTurb.kind === "turbine", onlyTurb ? onlyTurb.markFull : "ничего");

  var hotList = Calc.build(1.0, "hot", true, Calc.defaults());
  var turb40hot = null, turb40cold = null, i;
  for (i = 0; i < hotList.length; i++) if (hotList[i].dn === 40 && hotList[i].kind === "turbine") turb40hot = hotList[i];
  var coldList = Calc.build(1.0, "cold", true, Calc.defaults());
  for (i = 0; i < coldList.length; i++) if (coldList[i].dn === 40 && coldList[i].kind === "turbine") turb40cold = coldList[i];
  ok("Для горячей воды диапазон уже, чем для холодной", turb40hot.qmax === 30 && turb40cold.qmax === 60,
     U.coef(turb40hot.qmax) + " против " + U.coef(turb40cold.qmax));

  /* ---------------------------------------------------------- числа */

  ok("Запятая и точка на вводе равноправны", U.num("4,14") === 4.14 && U.num("4.14") === 4.14);
  ok("Мусор на вводе — не число", isNaN(U.num("abc")) && isNaN(U.num("")));
  ok("Коэффициент без хвостовых нулей", U.coef(0.000035) === "0,000035", U.coef(0.000035));
  ok("Крупный коэффициент целым", U.coef(6944) === "6944", U.coef(6944));
  ok("Потери — два знака", U.fmt(2.4505, 2) === "2,45", U.fmt(2.4505, 2));

  /* ---------------------------------------------------------- группировка */

  function row(place, system, qLs, dn, kind, mediumId) {
    var list = Calc.build(qLs, mediumId, true, Calc.defaults());
    for (var i = 0; i < list.length; i++) {
      if (list[i].dn !== dn || list[i].kind !== kind) continue;
      var r = Rows.fromCandidate(list[i], mediumId, true, "sp");
      r.place = place;
      r.systemName = system;
      return r;
    }
    throw new Error("не найден вариант DN " + dn);
  }

  var demo = [
    row("Секция 2", "Общий на вводе", 4.14, 50, "turbine", "cold"),
    row("Секция 2", "ХВС на встроенные помещения", 0.75, 20, "vane", "cold"),
    row("Секция 1", "ХВС на приготовление ГВС 1 зоны (ИТП)", 1.95, 40, "vane", "cold")
  ];

  var spans = Rows.spans(demo, true);
  ok("Группа «Секция 2» из двух строк", spans[0] === 2 && spans[1] === 0, spans.join(","));
  ok("Группа «Секция 1» из одной строки", spans[2] === 1);
  var noMerge = Rows.spans(demo, false);
  ok("Без объединения каждая строка сама по себе", noMerge[0] === 1 && noMerge[1] === 1 && noMerge[2] === 1);

  /* ---------------------------------------------------------- .docx */

  function unzip(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var dec = new TextDecoder();
    var out = {}, count = 0, pos = 0;
    while (pos + 4 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
      var crc = view.getUint32(pos + 14, true);
      var csize = view.getUint32(pos + 18, true);
      var nlen = view.getUint16(pos + 26, true);
      var elen = view.getUint16(pos + 28, true);
      var name = dec.decode(bytes.subarray(pos + 30, pos + 30 + nlen));
      var from = pos + 30 + nlen + elen;
      var data = bytes.subarray(from, from + csize);
      out[name] = { text: dec.decode(data), crcOk: Docx.crc32(data) === crc };
      count++;
      pos = from + csize;
    }
    out.$count = count;
    return out;
  }

  /* Word читает архив не подряд, а с конца: сначала EOCD, потом центральный
     каталог, и только по его смещениям — сами файлы. Проверяем именно так,
     иначе кривой каталог остался бы незамеченным. */
  function readCentral(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var dec = new TextDecoder();
    var eocd = bytes.length - 22;
    if (view.getUint32(eocd, true) !== 0x06054b50) return { error: "EOCD не на месте" };

    var count = view.getUint16(eocd + 10, true);
    var cdSize = view.getUint32(eocd + 12, true);
    var cdStart = view.getUint32(eocd + 16, true);
    if (cdStart + cdSize !== eocd) return { error: "размер каталога не сходится" };

    var names = [], pos = cdStart, i;
    for (i = 0; i < count; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) return { error: "запись каталога " + i + " испорчена" };
      var crc = view.getUint32(pos + 16, true);
      var nlen = view.getUint16(pos + 28, true);
      var elen = view.getUint16(pos + 30, true);
      var clen = view.getUint16(pos + 32, true);
      var offset = view.getUint32(pos + 42, true);
      var name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nlen));

      if (view.getUint32(offset, true) !== 0x04034b50) return { error: name + ": смещение мимо файла" };
      if (view.getUint32(offset + 14, true) !== crc) return { error: name + ": CRC каталога и файла разошлись" };
      var localName = dec.decode(bytes.subarray(offset + 30, offset + 30 + nlen));
      if (localName !== name) return { error: name + ": имя в каталоге и в файле разное" };

      names.push(name);
      pos += 46 + nlen + elen + clen;
    }
    return { count: count, names: names };
  }

  var settings = Project.defaults();
  var bytes = Docx.zipBytes(Docx.parts("<w:p/>", settings));
  var pack = unzip(bytes);
  ok("В пакете пять частей", pack.$count === 5, String(pack.$count));

  var central = readCentral(bytes);
  ok("Центральный каталог zip читается так, как его читает Word",
     !central.error && central.count === 5, central.error || central.names.join(", "));
  ok("Контрольные суммы zip сходятся",
     pack["word/document.xml"].crcOk && pack["[Content_Types].xml"].crcOk && pack["word/styles.xml"].crcOk);
  ok("Есть word/document.xml и _rels/.rels", !!pack["word/document.xml"] && !!pack["_rels/.rels"]);

  var xml = Docx.tableXml(settings, demo);
  var doc = new DOMParser().parseFromString(xml, "application/xml");
  ok("document.xml — корректный XML", doc.getElementsByTagName("parsererror").length === 0);
  ok("Заголовок таблицы на месте", xml.indexOf("Место установки счетчика") > 0);
  ok("Подпись под таблицей на месте", xml.indexOf(settings.tableFooter) > 0);

  var restarts = (xml.match(/w:vMerge w:val="restart"/g) || []).length;
  var continues = (xml.match(/<w:vMerge\/>/g) || []).length;
  ok("Объединение по месту установки: одно начало и одно продолжение",
     restarts === 1 && continues === 1, restarts + " / " + continues);

  var noteRows = demo.map(function (r) { var c = Rows.clone(r); c.note = Rows.SP_NOTE; return c; });
  ok("Столбец «Примечание» появляется, когда он заполнен",
     Docx.tableXml(settings, noteRows).indexOf("Примечание") > 0 && xml.indexOf("Примечание") < 0);

  var flat = Docx.tableXml({
    tableTitle: settings.tableTitle, tableFooter: settings.tableFooter,
    docFont: settings.docFont, docFontSize: settings.docFontSize, mergePlaces: false
  }, demo);
  ok("С выключенным объединением vMerge не появляется", flat.indexOf("w:vMerge") < 0);

  /* ---------------------------------------------------------- файл проекта */

  var saveSettings = Project.defaults();
  saveSettings.calc.limitVane = 4.5;
  saveSettings.tableFooter = "Проверка: табуляция\tи перевод строки\n";

  var one = Rows.clone(demo[0]);
  one.note = Rows.SP_NOTE;
  var text = Project.serialize(saveSettings, [one]);
  var back = Project.parse(text);

  ok("Строка вернулась", back.rows.length === 1);
  nearOk("Расход сохранён", back.rows[0].qLs, one.qLs, 1e-12);
  nearOk("Потери по СП сохранены", back.rows[0].hSp, one.hSp, 1e-12);
  nearOk("Потери по паспорту сохранены", back.rows[0].hPassport, one.hPassport, 1e-12);
  ok("Примечание сохранено", back.rows[0].note === Rows.SP_NOTE);
  ok("Марка и тип сохранены", back.rows[0].mark === one.mark && back.rows[0].kind === one.kind, back.rows[0].mark);
  nearOk("Настройки сохранены", back.settings.calc.limitVane, 4.5, 1e-12);
  ok("Табуляция и перевод строки в тексте обезврежены",
     back.settings.tableFooter === "Проверка: табуляция и перевод строки ",
     "«" + back.settings.tableFooter + "»");

  ok("Формат совместим с настольной версией (ключи Vane/Cold/Sp)",
     text.indexOf("\tTurbine\tCold\t") > 0 && text.indexOf("\tSp\t") > 0);

  /* ---------------------------------------------------------- вывод */

  var pass = 0, fail = 0, out = document.getElementById("out");
  for (var n = 0; n < results.length; n++) {
    var r = results[n], li = document.createElement("li");
    if (r.note) {
      li.className = "note";
      li.textContent = r.note;
    } else {
      if (r.ok) pass++; else fail++;
      li.className = r.ok ? "pass" : "fail";
      li.textContent = (r.ok ? "OK  " : "FAIL  ") + r.name + (r.info ? "  — " + r.info : "");
    }
    out.appendChild(li);
  }
  document.getElementById("sum").textContent =
    "Пройдено: " + pass + ", провалено: " + fail + ".";
  document.getElementById("sum").className = fail ? "fail" : "pass";
})();
