/* Проверки ядра: формулы сверяются с учебниками и с самими собой.
   Открыть tests.html — зелёные строки прошли, красные нет. */
(function () {
  "use strict";
  var results = [];
  function ok(name, cond, info) { results.push({ name: name, ok: !!cond, info: info === undefined ? "" : String(info) }); }
  function near(a, b, tol) { return Math.abs(a - b) <= tol; }
  var G = Hydro.G;

  /* ------------------------------------------------------------ вода */

  ok("Плотность воды при 4 °C максимальна", U.rho(4) > U.rho(0) && U.rho(4) > U.rho(10), U.fmt(U.rho(4), 2));
  ok("Плотность при 20 °C ≈ 998,2 кг/м³", near(U.rho(20), 998.2, 0.2), U.fmt(U.rho(20), 2));
  ok("Вязкость при 20 °C ≈ 1,004·10⁻⁶ м²/с", near(U.nu(20) * 1e6, 1.004, 0.02), U.fmt(U.nu(20) * 1e6, 4));
  ok("Вязкость при 10 °C ≈ 1,306·10⁻⁶", near(U.nu(10) * 1e6, 1.306, 0.03), U.fmt(U.nu(10) * 1e6, 4));
  ok("Давление пара при 20 °C ≈ 0,24 м", near(U.vaporHead(20), 0.24, 0.02), U.fmt(U.vaporHead(20), 3));
  ok("Давление пара при 100 °C ≈ 10,33 м", near(U.vaporHead(100), 10.33, 0.25), U.fmt(U.vaporHead(100), 2));
  ok("Давление пара при 60 °C ≈ 2,03 м", near(U.vaporHead(60), 2.03, 0.1), U.fmt(U.vaporHead(60), 3));

  /* ------------------------------------------------------------ режимы и трение */

  var d = 0.1, nu20 = U.nu(20);
  ok("Re = v·d/ν", near(Hydro.reynolds(1, d, nu20), 1 / nu20 * d, 1e-6), U.fmt(Hydro.reynolds(1, d, nu20), 0));
  ok("Ламинарный режим ниже 2320", Hydro.regime(2000) === "lam" && Hydro.regime(3000) === "trans" && Hydro.regime(5000) === "turb");
  ok("λ = 64/Re в ламинарной области", near(Hydro.lambda(1000, 0.0001, d), 64 / 1000, 1e-9), U.fmt(Hydro.lambda(1000, 0.0001, d), 4));

  /* Блазиус для гладких труб: Колбрук должен лечь рядом. */
  var lamCW = Hydro.lambda(1e5, 1e-7, d), lamBl = Hydro.lambdaBlasius(1e5);
  ok("Гладкая труба: Колбрук ≈ Блазиус при Re = 10⁵", near(lamCW, lamBl, 0.002), U.fmt(lamCW, 4) + " / " + U.fmt(lamBl, 4));

  /* Квадратичная область: λ не зависит от Re. */
  var lq1 = Hydro.lambda(1e7, 0.002, d), lq2 = Hydro.lambda(1e8, 0.002, d);
  ok("Квадратичная область: λ перестаёт зависеть от Re", near(lq1, lq2, 0.0015), U.fmt(lq1, 4) + " / " + U.fmt(lq2, 4));

  /* Альтшуль — наша нормативная формула — должен быть близок к Колбруку. */
  var la = Hydro.lambdaAltshul(2e5, 0.0005, d), lc = Hydro.lambda(2e5, 0.0005, d);
  ok("Альтшуль ≈ Колбрук (в пределах 6 %)", Math.abs(la - lc) / lc < 0.06, U.fmt(la, 4) + " / " + U.fmt(lc, 4));

  /* Пуазейль: потери по Дарси при λ = 64/Re совпадают с аналитикой. */
  var vLam = 0.01, ReL = Hydro.reynolds(vLam, d, nu20);
  var hDarcy = Hydro.hFriction(10, d, vLam, 64 / ReL);
  var hPois = 32 * nu20 * 10 * vLam / (G * d * d);
  ok("Дарси при λ = 64/Re совпадает с Пуазейлем", near(hDarcy, hPois, 1e-12), U.fmt(hDarcy * 1000, 5) + " мм");

  /* Местные сопротивления. */
  ok("Внезапное расширение в одинаковую трубу: ζ = 0", near(Hydro.zetaExpansion(0.1, 0.1), 0, 1e-12));
  ok("Расширение в бесконечность: ζ → 1", near(Hydro.zetaExpansion(0.1, 100), 1, 1e-3), U.fmt(Hydro.zetaExpansion(0.1, 100), 4));
  ok("Внезапное сужение вдвое по площади: ζ = 0,25", near(Hydro.zetaContraction(0.1, 0.1 / Math.SQRT2), 0.25, 0.01), U.fmt(Hydro.zetaContraction(0.1, 0.1 / Math.SQRT2), 3));
  ok("Диффузор мягче внезапного расширения", Hydro.zetaDiffuser(0.05, 0.1, 8) < Hydro.zetaExpansion(0.05, 0.1),
    U.fmt(Hydro.zetaDiffuser(0.05, 0.1, 8), 3) + " < " + U.fmt(Hydro.zetaExpansion(0.05, 0.1), 3));

  /* ------------------------------------------------------------ расходомеры */

  var Qm = 0.01;
  var dpV = Hydro.dpByFlow(0.1, 0.05, Qm, 0.98);
  ok("Перепад и расход расходомера обратны друг другу", near(Hydro.flowByDp(0.1, 0.05, dpV, 0.98), Qm, 1e-9), U.fmt(dpV, 4) + " м");
  ok("У диафрагмы теряется больше, чем у Вентури",
    Hydro.meterLoss("orifice", 0.5) > Hydro.meterLoss("venturi", 0.5),
    U.fmt(Hydro.meterLoss("orifice", 0.5), 2) + " / " + U.fmt(Hydro.meterLoss("venturi", 0.5), 2));

  /* ------------------------------------------------------------ истечение */

  var hole = Hydro.nozzleById("hole"), cyl = Hydro.nozzleById("cyl");
  ok("Отверстие в тонкой стенке: μ ≈ 0,62", near(Hydro.mu(hole), 0.62, 0.01), U.fmt(Hydro.mu(hole), 3));
  ok("Цилиндрический насадок: μ ≈ 0,82", near(Hydro.mu(cyl), 0.82, 0.01), U.fmt(Hydro.mu(cyl), 3));
  ok("Насадок даёт расход больше отверстия примерно на треть",
    near(Hydro.mu(cyl) / Hydro.mu(hole), 1.32, 0.05), U.fmt(Hydro.mu(cyl) / Hydro.mu(hole), 3));
  ok("Скорость истечения меньше торричеллиевой", Hydro.NOZZLES.every(function (n) { return n.phi <= 1; }));
  var Qout = Hydro.outflow(hole, 0.02, 2);
  ok("Q = μ·A·√(2gH)", near(Qout, 0.62 * Hydro.area(0.02) * Math.sqrt(2 * G * 2), 1e-4), U.fmt(Qout * 1000, 3) + " л/с");
  ok("Вакуум в насадке ≈ 0,75·H", near(Hydro.nozzleVacuum(4), 3, 1e-9));
  /* Время опорожнения: вдвое больше, чем при неизменном начальном расходе. */
  var Sves = 1, H1 = 1;
  var tE = Hydro.emptyTime(Sves, hole, 0.02, H1, 0);
  var tNaive = Sves * H1 / Hydro.outflow(hole, 0.02, H1);
  ok("Опорожнение вдвое дольше наивной оценки", near(tE / tNaive, 2, 0.01), U.fmt(tE, 1) + " с / " + U.fmt(tNaive, 1) + " с");

  /* ------------------------------------------------------------ удар */

  var aRigid = Hydro.celerity(2.06e9, 998, 0.1, 1e6, 2.1e11);
  ok("В жёсткой трубе скорость волны ≈ 1437 м/с", near(aRigid, 1437, 15), U.fmt(aRigid, 0));
  var aSteel = Hydro.celerity(2.06e9, 998, 0.2, 0.006, 2.1e11);
  ok("Сталь 200×6: a ≈ 1250 м/с", near(aSteel, 1250, 60), U.fmt(aSteel, 0));
  /* ПЭ100 SDR17: стенка d/17, кратковременный модуль 1,4 ГПа. */
  var aPe = Hydro.celerity(2.06e9, 998, 0.2, 0.2 / 17, 1.4e9);
  ok("Полиэтилен ПЭ100 SDR17: a ≈ 280 м/с", near(aPe, 285, 45), U.fmt(aPe, 0));
  ok("Жуковский: a = 1000, v = 1 → 102 м", near(Hydro.jukovsky(1000, 1), 101.97, 0.1), U.fmt(Hydro.jukovsky(1000, 1), 2));
  ok("Фаза удара 2L/a", near(Hydro.phase(600, 1200), 1, 1e-9));
  ok("Мишо при t = фазе даёт Жуковского", near(Hydro.michaud(600, 1, 1), Hydro.jukovsky(1200, 1), 1e-6),
    U.fmt(Hydro.michaud(600, 1, 1), 2));

  /* ------------------------------------------------------------ безнапорный поток */

  var dc = 0.2;
  var gFull = Hydro.circGeom(dc, 1);
  ok("Полное сечение: A = πd²/4", near(gFull.A, Math.PI * dc * dc / 4, 1e-9), U.fmt(gFull.A * 1e4, 2) + " см²");
  ok("Полное сечение: P = πd", near(gFull.P, Math.PI * dc, 1e-9));
  var gHalf = Hydro.circGeom(dc, 0.5);
  ok("Половина сечения: A = πd²/8", near(gHalf.A, Math.PI * dc * dc / 8, 1e-9));
  ok("Половина сечения: R = d/4", near(gHalf.R, dc / 4, 1e-9), U.fmt(gHalf.R * 1000, 2) + " мм");
  ok("Ширина по поверхности при h/d = 0,5 равна d", near(gHalf.B, dc, 1e-9));

  var nMan = 0.013, iMan = 0.005;
  var Q938 = Hydro.manningQ(dc, 0.938, nMan, iMan), Q100 = Hydro.manningQ(dc, 1, nMan, iMan);
  ok("Максимум расхода при h/d ≈ 0,938, а не при полном сечении", Q938 > Q100,
    U.fmt(Q938 * 1000, 2) + " > " + U.fmt(Q100 * 1000, 2) + " л/с");
  var Q81 = Hydro.circGeom(dc, 0.81);
  ok("Максимум скорости при h/d ≈ 0,81", Hydro.manningV(nMan, Q81.R, iMan) > Hydro.manningV(nMan, gFull.R, iMan));

  var Qn = 0.02;
  var yN = Hydro.normalDepth(Qn, dc, nMan, iMan);
  ok("Нормальная глубина обратна формуле Маннинга", near(Hydro.manningQ(dc, yN, nMan, iMan), Qn, 1e-6),
    "h/d = " + U.fmt(yN, 4));
  var yC = Hydro.criticalDepth(Qn, dc);
  ok("При критической глубине Fr = 1", near(Hydro.froude(Qn, dc, yC), 1, 0.01), U.fmt(Hydro.froude(Qn, dc, yC), 4));
  ok("Критическая глубина не зависит от уклона и шероховатости",
    near(Hydro.criticalDepth(Qn, dc), yC, 1e-12));
  ok("Касательное напряжение τ = ρgRi", near(Hydro.shear(1000, 0.05, 0.005), 1000 * G * 0.05 * 0.005, 1e-9),
    U.fmt(Hydro.shear(1000, 0.05, 0.005), 3) + " Па");
  ok("Минимальные скорости по СП растут с диаметром",
    Hydro.selfCleanV(150) === 0.7 && Hydro.selfCleanV(400) === 0.8 && Hydro.selfCleanV(800) === 1.0);

  /* ------------------------------------------------------------ наносы */

  var wSand = Hydro.settling(0.0002, 2650, 998, nu20);
  ok("Осаждение песка 0,2 мм ≈ 20…25 мм/с", wSand * 1000 > 15 && wSand * 1000 < 30, U.fmt(wSand * 1000, 1) + " мм/с");
  var wSilt = Hydro.settling(0.00005, 2650, 998, nu20);
  ok("Ил 0,05 мм оседает в разы медленнее", wSilt < wSand / 5, U.fmt(wSilt * 1000, 2) + " мм/с");
  var tc035 = Hydro.shieldsCrit(0.00035, 2650, 998, nu20);
  ok("Критическое напряжение для песка 0,35 мм ≈ 0,2 Па", near(tc035, 0.21, 0.08), U.fmt(tc035, 3) + " Па");
  ok("Крупная частица требует большего напряжения",
    Hydro.shieldsCrit(0.002, 2650, 998, nu20) > tc035 * 4,
    U.fmt(Hydro.shieldsCrit(0.002, 2650, 998, nu20), 2) + " Па");

  /* ------------------------------------------------------------ насос */

  var p = { H0: 60, Qopt: 30, Hopt: 45, etaMax: 0.72 }, pc = Hydro.pumpCoef(p);
  ok("Кривая насоса проходит через H0 и оптимум",
    near(Hydro.pumpHead(p, pc, 0, 1), 60, 1e-9) && near(Hydro.pumpHead(p, pc, 30, 1), 45, 1e-9));
  ok("Законы подобия: H(Q·r, r) = r²·H(Q, 1)",
    near(Hydro.pumpHead(p, pc, 30 * 0.7, 0.7), 0.49 * Hydro.pumpHead(p, pc, 30, 1), 1e-9));
  ok("КПД максимален в оптимуме", near(Hydro.pumpEta(p, pc, 30, 1), 0.72, 1e-9), U.fmt(Hydro.pumpEta(p, pc, 30, 1) * 100, 1) + " %");
  ok("Qmax при H = 0", near(Hydro.pumpHead(p, pc, Hydro.pumpQmax(p, pc, 1), 1), 0, 1e-9));

  /* ------------------------------------------------------------ старение труб */

  ok("Шероховатость растёт линейно", near(Hydro.agedRoughness(0.05, 0.07, 20), 1.45, 1e-9));
  ok("Зарастание уменьшает диаметр вдвое быстрее толщины слоя",
    near(Hydro.agedDiameter(0.1, 0.5, 10), 0.09, 1e-9), U.fmt(Hydro.agedDiameter(0.1, 0.5, 10) * 1000, 1) + " мм");

  /* ------------------------------------------------------------ балансировочные клапаны */

  (function () {
    var m20 = Valtec.byArticle("VT.054.N.05");
    ok("Клапан 3/4\": Kv на положении 50 — табличный", near(Valtec.kvAt(m20, 50), 3.50, 1e-9), U.fmt(Valtec.kvAt(m20, 50), 2));
    ok("Полностью открытый 3/4\": Kv = 4,68", near(Valtec.kvAt(m20, 99), 4.68, 1e-9));
    ok("Ниже мёртвой зоны клапан закрыт", Valtec.kvAt(m20, 3) === 0 && Valtec.kvAt(m20, 2) === 0);
    ok("Между табличными точками — интерполяция",
      near(Valtec.kvAt(m20, 52), (3.50 + 3.75) / 2, 0.06), U.fmt(Valtec.kvAt(m20, 52), 3));
    var pos = Valtec.positionFor(m20, 3.0);
    ok("Положение по Kv обратно таблице", near(Valtec.kvAt(m20, pos), 3.0, 1e-6), U.fmt(pos, 1));
    ok("Kv больше максимального не даёт положения", Valtec.positionFor(m20, 99) === -1);
    var chosen = Valtec.choose(2.0);
    ok("Подбор берёт клапан с настройкой в рабочей части шкалы",
      Valtec.positionFor(chosen, 2.0) >= 10, chosen.caption + ", положение " + U.fmt(Valtec.positionFor(chosen, 2.0), 0));

    /* Перепад на клапане: Δp = (Q/Kv)² бар; в метрах столба горячей воды — ×10,37. */
    var barM = 1e5 / (983 * 9.80665);
    ok("Один бар — это 10,37 м столба горячей воды", near(barM, 10.37, 0.02), U.fmt(barM, 3));
    var Qv = 0.25, kvv = Valtec.kvAt(m20, 30);
    var dropM = barM * Math.pow(Qv / kvv, 2);
    ok("Перепад на клапане считается по Kv", near(Math.pow(Qv / kvv, 2) * 1e5, dropM * 983 * 9.80665, 1e-6),
      U.fmt(dropM * 983 * 9.80665 / 1000, 2) + " кПа");
  })();

  /* Теплопотери изолированной трубы: сопротивление слоёв складывается,
     а изоляция уменьшает поток в разы. */
  (function () {
    function res(dIn, wall, lamWall, ins) {
      var dOut = dIn + 2 * wall;
      var R = Math.log(dOut / dIn) / (2 * Math.PI * lamWall);
      var dS = dOut;
      if (ins > 0) { R += Math.log((dOut + 2 * ins) / dOut) / (2 * Math.PI * 0.04); dS = dOut + 2 * ins; }
      return R + 1 / (Math.PI * dS * 8);
    }
    var bare = (60 - 22) / res(0.032, 0.003, 50, 0);
    var ins9 = (60 - 22) / res(0.032, 0.003, 50, 0.009);
    ok("Голая труба DN32 теряет 35…50 Вт/м", bare > 30 && bare < 55, U.fmt(bare, 1) + " Вт/м");
    ok("Изоляция 9 мм уменьшает потери в 2…3 раза", bare / ins9 > 2 && bare / ins9 < 3.2,
      U.fmt(ins9, 1) + " Вт/м, в " + U.fmt(bare / ins9, 2) + " раза меньше");
    /* Остывание: Δt = Q·3600/(c·G). */
    var dtd = 1000 * 3600 / (4190 * 200);
    ok("1 кВт потерь при 200 кг/ч остужает на 4,3 К", near(dtd, 4.3, 0.1), U.fmt(dtd, 2) + " К");
  })();

  /* ------------------------------------------------------------ утилиты */

  var root = U.bisect(function (x) { return x * x - 2; }, 0, 3);
  ok("Деление пополам находит корень", near(root, Math.SQRT2, 1e-9), U.fmt(root, 8));
  ok("Числа выводятся с запятой", U.fmt(1.5, 1) === "1,5" && U.fmt(-0.0004, 2) === "0,00");
  var tr = new Plot.Trend(10);
  for (var i = 0; i < 25; i++) tr.push(i, { a: i * 2 });
  var ser = tr.series("a", 24, 5);
  ok("Кольцевой буфер отдаёт последние значения", ser.length === 6 && ser[ser.length - 1][1] === 48,
    ser.length + " точек, последняя " + ser[ser.length - 1][1]);
  ok("Размах по буферу считается", tr.range(["a"], 24, 5)[1] === 48);

  /* ------------------------------------------------------------ сквозная проверка */

  /* Самотёк между баками: расход из баланса напоров должен воспроизводиться
     обратным расчётом потерь. */
  (function () {
    var L = 100, dd = 0.15, k = 0.0002, dH = 5, Q = 0.02;
    for (var it = 0; it < 60; it++) {
      var v = Q / Hydro.area(dd);
      var lam = Hydro.lambda(Hydro.reynolds(v, dd, U.nu(10)), k, dd);
      var K = 1 + 0.5 + lam * L / dd;
      var vNew = Math.sqrt(2 * G * dH / K);
      Q = vNew * Hydro.area(dd);
    }
    var v2 = Q / Hydro.area(dd);
    var lam2 = Hydro.lambda(Hydro.reynolds(v2, dd, U.nu(10)), k, dd);
    var hTot = Hydro.hFriction(L, dd, v2, lam2) + Hydro.hLocal(1.5, v2);
    ok("Самотёк: сумма потерь равна располагаемому напору", near(hTot, dH, 1e-6),
      U.fmt(Q * 1000, 2) + " л/с, потери " + U.fmt(hTot, 4) + " м");
  })();

  /* Труба Вентури: перепад из Бернулли должен совпасть с формулой расходомера. */
  (function () {
    var d1 = 0.08, d2 = 0.04, Q = 0.006;
    var v1 = Q / Hydro.area(d1), v2 = Q / Hydro.area(d2);
    var dhBernoulli = (v2 * v2 - v1 * v1) / (2 * G);
    var dhMeter = Hydro.dpByFlow(d1, d2, Q, 1.0);
    ok("Перепад в трубе Вентури = разности скоростных напоров (C = 1)",
      near(dhBernoulli, dhMeter, 1e-9), U.fmt(dhBernoulli, 4) + " м");
  })();

  /* ------------------------------------------------------------ вывод */

  var pass = results.filter(function (r) { return r.ok; }).length;
  document.getElementById("sum").innerHTML = "<b>" + pass + " из " + results.length + "</b> проверок пройдено." +
    (pass === results.length ? " Всё в порядке." : " <span class=\"fail\">Есть расхождения.</span>");
  document.getElementById("out").innerHTML = results.map(function (r) {
    return '<li class="' + (r.ok ? "pass" : "fail") + '">' + (r.ok ? "✓ " : "✗ ") + r.name +
      (r.info ? ' <span style="color:#5d6b79">— ' + r.info + "</span>" : "") + "</li>";
  }).join("");
})();
