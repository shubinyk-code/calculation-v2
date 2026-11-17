/* Эталоны — числа из пособия (в метрах: 1 бар = 10 м) и посчитанные вручную. */
(function () {
  "use strict";

  var rows = [], failed = 0;

  function check(name, got, want, tol) {
    var ok;
    if (typeof want === "number") ok = typeof got === "number" && Math.abs(got - want) <= (tol === undefined ? 1e-6 : tol);
    else ok = got === want;
    if (!ok) failed++;
    rows.push([ok, name, got, want]);
  }

  function project() { return Calc.exampleProject(); }
  function byName(res, name) {
    for (var i = 0; i < res.list.length; i++) if (res.list[i].sys.name === name) return res.list[i];
    return null;
  }
  function hasWarn(r, word) { return r.warnings.some(function (w) { return w.indexOf(word) >= 0; }); }

  // --- Форматирование и разбор ввода
  check("разбор «1,67»", Fmt.parse("1,67"), 1.67);
  check("разбор пустой строки", Fmt.parse(""), null);
  check("вывод 5,80", Fmt.num(5.8), "5,80");
  check("вывод без хвоста 22,26", Fmt.g(22.26), "22,26");
  check("вывод без хвоста 15", Fmt.g(15), "15");
  var rg = Calc.parseRanges("5–30; 10-60");
  check("диапазонов разобрано", rg.length, 2);
  check("диапазон 5–30: низ", rg[0].lo, 5);
  check("таблица Kvs: Ду80", Calc.parseKvsTable("80:80; 50:35")[1].kvs, 80);
  check("PN по 78 м при K = 10 → PN10", Calc.pickPN(78, 10), 10);
  check("PN по 116 м при K = 10 → PN16", Calc.pickPN(116, 10), 16);

  // --- Пример из пособия, разнесённые регуляторы
  var p = project();
  var res = Calc.compute(p);

  var vpv1 = byName(res, "ВПВ 1 зона");
  check("ВПВ 1: Н вх.min = 10 м (1,0 бар)", vpv1.hInMin, 10);
  check("ВПВ 1: Н вх.max = 58 м (5,8 бар)", vpv1.hInMax, 58);
  check("ВПВ 1: колебание 48 м", vpv1.fluct, 48, 1e-9);
  check("ВПВ 1: регулятор нужен", vpv1.need, true);
  check("ВПВ 1: уставка 20 м (2,0 бар, пособие)", vpv1.setpoint, 20, 1e-9);
  check("ВПВ 1: корпус с РД 20 + 58 = 78 м", vpv1.hBody, 78, 1e-9);
  check("ВПВ 1: корпус с РД → PN10", vpv1.pnReq, 10);
  check("ВПВ 1: корпус без РД 116 м", vpv1.hBodyNoReg, 116, 1e-9);
  check("ВПВ 1: без РД → PN16", vpv1.pnReqNoReg, 16);

  var apt = byName(res, "АПТ паркинга");
  check("АПТ: уставка 20 м (пособие)", apt.setpoint, 20, 1e-9);
  check("АПТ: H₀ оценочный", apt.h0Est, true);

  var hpv1 = byName(res, "ХПВ 1 зона");
  check("ХПВ 1: Н вых 58 м (как в пособии)", hpv1.hOut, 58);
  check("ХПВ 1: Н ред.max = 58 − 16 = 42 м (4,2 бар, пособие)", hpv1.hRedMax, 42, 1e-9);
  check("ХПВ 1: регулятор нужен (58 > 42)", hpv1.need, true);
  check("ХПВ 1: H min по подобию 65·(25/50)² = 16,25 м", hpv1.hMinQ0Auto, 16.25, 1e-9);
  check("ХПВ 1: частота при Н вх.max и Q=0 ниже минимума", hpv1.fAtMax < hpv1.fMin, true);

  // Н вых по напору насоса вместо 58
  p.systems[0].hOut = null;
  var res2 = Calc.compute(p);
  check("ХПВ 1: Н вых по напору 10 + 50 = 60 м", res2.list[0].hOut, 60, 1e-9);
  check("ХПВ 1: тогда Н ред.max = 44 м", res2.list[0].hRedMax, 44, 1e-9);

  // ПЧ, регулятор не нужен
  var q = project();
  q.systems[1].h0 = 100;       // ХПВ 2: 2,4 л/с, 78 м
  q.systems[1].hMinQ0 = 25;
  var hpv2 = Calc.compute(q).list[1];
  check("ХПВ 2: Н вых = 10 + 78 = 88 м", hpv2.hOut, 88, 1e-9);
  check("ХПВ 2: Н ред.max = 88 − 25 = 63 м", hpv2.hRedMax, 63, 1e-9);
  check("ХПВ 2: регулятор не нужен", hpv2.need, false);
  check("ХПВ 2: уставки нет", hpv2.hasReg, false);

  // Недостижимая уставка: насос не даёт её даже без расхода, модель — Q = 0
  var u = project();
  u.systems[0].hOut = 800;
  var resU = Calc.compute(u);
  check("Н вых = 800 м — замечание «недостижима»", hasWarn(resU.list[0], "недостижима"), true);
  var stU = Calc.simulate(u, resU, { hNet: 34, phi: 0.6, fire: "off", regOn: true }).byId[resU.list[0].id];
  check("Н вых = 800 м — в живом режиме Q = 0", stU.Q < 0.005, true);
  u.systems[0].hOut = 5.8;     // по привычке ввели бары
  check("Н вых = 5,8 (бары вместо метров) — замечание о единицах", hasWarn(Calc.compute(u).list[0], "единицы"), true);
  check("Н вых = 58 м (пособие) — замечаний о единицах нет", hasWarn(hpv1, "единицы") || hasWarn(hpv1, "недостижима"), false);

  // Порог ровно 10 м — регулятор не нужен
  var t = project();
  t.inlet.hMax = 20; // 20 м при Н вх.min 10
  var vpvEdge = byName(Calc.compute(t), "ВПВ 1 зона");
  check("колебание ровно 10 м — регулятор не нужен", vpvEdge.need, false);

  // СП 30 п. 13.13: ХПВ без ПЧ при колебаниях > 10 м
  var sp = project();
  sp.systems[0].drive = "const";
  check("ХПВ без ПЧ при колебаниях 43 м — замечание по СП 30 п. 13.13", hasWarn(Calc.compute(sp).list[0], "13.13"), true);
  sp.systems[0].hasTank = true;
  check("…но с гидропневмобаком замечания нет", hasWarn(Calc.compute(sp).list[0], "13.13"), false);

  // Общий регулятор: уставка по самой низкой
  var cm = project();
  cm.layout = "common";
  var rc = Calc.compute(cm);
  check("общий регулятор нужен", rc.common.need, true);
  check("общий регулятор: уставка 20 м", rc.common.setpoint, 20, 1e-9);
  check("общий регулятор: ХПВ 1 получает 20 м", byName(rc, "ХПВ 1 зона").hInMaxAfter, 20, 1e-9);

  // --- Подбор регулятора
  var reg = vpv1.reg;
  check("Kvs треб. = 31,32/√(3 м / 10) = 57,18", reg.kvReq, 8.7 * 3.6 / Math.sqrt(0.3), 1e-9);
  check("типоразмер Ду80", reg.dn, 80);
  check("скорость в Ду80 = 1,73 м/с", reg.v, 0.0087 / (Math.PI * 0.08 * 0.08 / 4), 1e-9);
  check("потери в открытом = (31,32/80)²·10 = 1,53 м", reg.dhOpen, Math.pow(31.32 / 80, 2) * 10, 1e-9);
  check("диапазон для 20 м — 5–30", reg.range.lo + "–" + reg.range.hi, "5–30");
  check("PN регулятора по 58 м — PN10", reg.pn, 10);
  check("отношение напоров 58/20 = 2,9", reg.ratio, 2.9, 1e-9);

  // --- Модель: рабочие точки насоса без ПЧ
  check("ВПВ 1: при Н гар.min рабочая точка = расчётная", vpv1.op.design.Q, 8.7, 1e-6);
  check("ВПВ 1: при Н макс без РД расход растёт", vpv1.op.maxNoReg.Q > 8.7 * 1.05, true);
  check("ВПВ 1: с РД расход ближе к расчётному", vpv1.op.maxReg.Q < vpv1.op.maxNoReg.Q, true);
  check("ВПВ 1: при Н гар.min Н вых = 10 + 37 = 47 м", vpv1.op.design.hOut, 47, 1e-6);

  // Живой режим: ПЧ упирается в минимум при Н макс и закрытых кранах
  var live = { hNet: 58, phi: 0, fire: "off", regOn: false };
  var s1 = Calc.simulate(p = project(), res = Calc.compute(p), live).byId[res.list[0].id];
  check("ХПВ 1 без РД, Q = 0, Н макс: ПЧ на минимуме", s1.status, "fmin");
  check("…напор на выходе выше уставки", s1.hOut > 58, true);
  live.regOn = true;
  var s2 = Calc.simulate(p, res, live).byId[res.list[0].id];
  check("ХПВ 1 с РД: напор на всасе = уставке 42 м", s2.hIn, 42, 1e-9);
  check("ХПВ 1 с РД: ПЧ держит 58 м", s2.hOut, 58, 1e-6);
  var sFire = Calc.simulate(p, res, { hNet: 58, phi: 0.5, fire: "q0", regOn: false }).byId[res.list[2].id];
  check("ВПВ 1 пуск на закрытую сеть без РД: 58 + 58 = 116 м", sFire.hOut, 116, 1e-6);

  // --- Перевод старых проектов (давления в барах) в метры
  var old = {
    version: 1, layout: "separate", inlet: { hGarMin: 15, hMax: 58, lossM: 5, dz: 0 },
    settings: { mPerBar: 10, fluctLimit: 1, dpOpenMax: 0.3, springRanges: "0,5–3; 1–6" },
    systems: [{ id: "a", name: "ХПВ", kind: "ХПВ", drive: "vfd", q: 1.67, h: 50, pOut: 5.8, pnNet: 12, h0: 65, hMinQ0: 16 }]
  };
  var mig = Calc.normalize(old);
  check("старый проект: уставка 5,8 бар → 58 м", mig.systems[0].hOut, 58, 1e-9);
  check("старый проект: допустимо 12 бар → 120 м", mig.systems[0].hNetAllow, 120, 1e-9);
  check("старый проект: порог 1 бар → 10 м", mig.settings.fluctLimit, 10, 1e-9);
  check("старый проект: потери в РД 0,3 бар → 3 м", mig.settings.dhOpenMax, 3, 1e-9);
  check("старый проект: диапазоны → «5–30; 10–60»", mig.settings.springRanges, "5–30; 10–60");
  check("старый проект: версия 2", mig.version, 2);
  check("старый проект считается как пример: Н ред.max = 42 м", Calc.compute(mig).list[0].hRedMax, 42, 1e-9);

  // --- вывод
  var tb = document.querySelector("#out tbody");
  tb.innerHTML = rows.map(function (r) {
    return '<tr><td class="' + (r[0] ? "ok" : "fail") + '">' + (r[0] ? "✓" : "✗") + "</td><td>" + Fmt.esc(r[1]) + "</td><td>" + Fmt.esc(String(r[2])) + "</td><td>" + Fmt.esc(String(r[3])) + "</td></tr>";
  }).join("");
  var total = document.getElementById("total");
  total.textContent = failed ? "Не прошло: " + failed + " из " + rows.length : "Все " + rows.length + " проверок прошли";
  total.className = failed ? "fail" : "ok";
  window.testResult = { total: rows.length, failed: failed };
})();
