/* Стенд 12. Отложения и коррозия: что делает с трубой время.

   Две вещи идут одновременно:
     k(t) = k₀ + α·t          — шероховатость растёт (Колбрук — Уайт, старение);
     d(t) = d₀ − 2·δ·t        — просвет зарастает бугорками и накипью.
   Первая поднимает λ, вторая уменьшает сечение — и пропускная способность падает
   гораздо быстрее, чем кажется: Q ~ d^2,5 при одном и том же напоре. */
(function () {
  "use strict";

  var W = 1180, HH = 430;

  /* Условия эксплуатации: скорость старения и скорость зарастания, мм/год. */
  var COND = [
    { id: "soft", name: "мягкая, неагрессивная вода", a: 0.025, g: 0.02 },
    { id: "normal", name: "обычная вода", a: 0.07, g: 0.06 },
    { id: "hard", name: "жёсткая вода (накипь)", a: 0.12, g: 0.15 },
    { id: "aggr", name: "агрессивная вода (коррозия, бугорки)", a: 0.30, g: 0.25 },
    { id: "hot", name: "горячее водоснабжение выше 60 °C", a: 0.20, g: 0.22 }
  ];
  /* Материалы: начальная шероховатость и стойкость к зарастанию. */
  var MAT = [
    { id: "steelBare", name: "сталь без покрытия", k0: 0.05, f: 1.0 },
    { id: "castIron", name: "чугун без покрытия", k0: 0.30, f: 1.1 },
    { id: "cement", name: "чугун с цементным покрытием", k0: 0.10, f: 0.25 },
    { id: "galv", name: "сталь оцинкованная", k0: 0.15, f: 0.6 },
    { id: "pe", name: "полиэтилен, полипропилен", k0: 0.01, f: 0.05 }
  ];

  var S = {
    id: "deposits", group: "water",
    title: "Отложения и коррозия",
    lead: "Прозрачная труба, в которой видно, что делается со стенкой за двадцать лет. Пропускная способность падает вдвое — и не столько от шероховатости, сколько от потерянного просвета.",
    hint: "Двигайте возраст трубы и смотрите на разрез справа. Кнопка «прочистить» убирает отложения, но не возвращает металл.",
    vis: { kind: "svg" },
    speeds: false
  };

  S.defaults = function () {
    return {
      d0: 100,         // диаметр новой трубы, мм
      L: 500,          // длина, м
      mat: "steelBare",
      cond: "normal",
      years: 15,
      H: 12,           // располагаемый напор, м
      Qfix: 12,        // расход для расчёта потерь, л/с
      cleaned: 0       // возраст на момент прочистки
    };
  };

  S.fields = [
    { title: "Труба", open: true, fields: [
      { k: "years", t: "range", l: "Возраст трубы", u: "лет", min: 0, max: 60, step: 1, d: 0 },
      { k: "mat", t: "select", l: "Материал", opts: MAT.map(function (x) { return [x.id, x.name]; }) },
      { k: "cond", t: "select", l: "Вода и условия", opts: COND.map(function (x) { return [x.id, x.name]; }) },
      { k: "d0", t: "range", l: "Диаметр новой трубы", u: "мм", min: 15, max: 600, step: 5, d: 0 },
      { k: "L", t: "range", l: "Длина участка", u: "м", min: 10, max: 3000, step: 10, d: 0 },
      { t: "custom", k: "cleaned", render: function () {
        return '<button type="button" data-act="clean">Прочистить трубу</button> ' +
          '<button type="button" data-act="new">Заменить на новую</button>';
      }, onClick: function (act, st) {
        if (act === "clean") st.cleaned = st.years;
        else { st.cleaned = 0; st.years = 0; }
      } }
    ] },
    { title: "Режим", open: true, fields: [
      { k: "H", t: "range", l: "Располагаемый напор на участке", u: "м", min: 1, max: 60, step: 0.5, d: 1,
        hint: "При нём считается, сколько труба пропустит сегодня." },
      { k: "Qfix", t: "range", l: "Требуемый расход", u: "л/с", min: 0.2, max: 120, step: 0.2, d: 1,
        hint: "При нём считаются потери напора — как в проверочном расчёте." }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {};

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  /* Состояние трубы в возрасте t лет. Прочистка убирает слой, но шероховатость
     остаётся хуже, чем у новой: поверхность уже изъедена. */
  function state(st, years) {
    var mat = byId(MAT, st.mat), cond = byId(COND, st.cond);
    var a = cond.a * mat.f, g = cond.g * mat.f;
    var sinceClean = Math.max(0, years - st.cleaned);
    var k = mat.k0 + a * (st.cleaned > 0 ? st.cleaned * 0.35 + sinceClean : years);
    var dep = g * sinceClean;                                  // толщина слоя, мм
    var d = Math.max(st.d0 * 0.2, st.d0 - 2 * dep);
    return { k: k, d: d, dep: dep, mat: mat, cond: cond };
  }

  /* Пропускная способность при заданном напоре (итерация по λ). */
  function capacity(st, s) {
    var d = s.d / 1000, k = s.k / 1000, Q = 0.02;
    for (var i = 0; i < 40; i++) {
      var v = Q / Hydro.area(d);
      var lam = Hydro.lambda(Hydro.reynolds(v, d, U.nu(10)), k, d);
      var vNew = Math.sqrt(2 * Hydro.G * st.H * d / (lam * st.L));
      var Qn = vNew * Hydro.area(d);
      if (Math.abs(Qn - Q) < 1e-9) { Q = Qn; break; }
      Q = Q + 0.6 * (Qn - Q);
    }
    return Q;
  }
  function lossAt(st, s, Qls) {
    var d = s.d / 1000, v = (Qls / 1000) / Hydro.area(d);
    var lam = Hydro.lambda(Hydro.reynolds(v, d, U.nu(10)), s.k / 1000, d);
    return { h: Hydro.hFriction(st.L, d, v, lam), v: v, lam: lam };
  }

  function compute(st) {
    var now = state(st, st.years), zero = state({ d0: st.d0, mat: st.mat, cond: st.cond, cleaned: 0 }, 0);
    var Qnow = capacity(st, now), Qnew = capacity(st, zero);
    var lNow = lossAt(st, now, st.Qfix), lNew = lossAt(st, zero, st.Qfix);
    m = {
      now: now, zero: zero, Q: Qnow, Qnew: Qnew, keep: Qnew > 0 ? Qnow / Qnew : 1,
      loss: lNow, lossNew: lNew,
      growth: lNew.h > 0 ? lNow.h / lNew.h : 1,
      /* Разделение вклада: только шероховатость и только зарастание. */
      Qk: capacity(st, { k: now.k, d: st.d0 }),
      Qd: capacity(st, { k: zero.k, d: now.d })
    };
  }

  S.reset = function () { compute(S.state); };
  S.onChange = function () { compute(S.state); };
  S.draw = function (ui) { compute(S.state); drawVis(ui); drawCharts(ui); };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH);
    var y = 180, x0 = 60, x1 = 720;

    // --- продольный разрез
    s += SK.rect(null, x0, y - 70, x1 - x0, 140, "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="2"');
    s += SK.path("depTop", "", "", ' fill="var(--warn-hex)" opacity="0.55" stroke="none"');
    s += SK.path("depBot", "", "", ' fill="var(--warn-hex)" opacity="0.55" stroke="none"');
    s += SK.rect("bore", x0 + 2, y - 50, x1 - x0 - 4, 100, "", ' fill="var(--water)" opacity="0.28"');
    s += SK.path("flow", "M" + (x0 + 10) + " " + y + " H" + (x1 - 10), "flow", "");
    s += SK.txt(null, (x0 + x1) / 2, y - 92, "cap", "middle", "продольный разрез");
    s += SK.txt("longT", (x0 + x1) / 2, y + 110, "val", "middle", "");
    s += SK.txt("longT2", (x0 + x1) / 2, y + 132, "tiny muted", "middle", "");

    // --- поперечный разрез
    s += SK.circle(null, 900, y, 105, "", ' fill="var(--casing-hex)" stroke="var(--casing-dark)" stroke-width="3"');
    s += SK.circle("depRing", 900, y, 100, "", ' fill="var(--warn-hex)" opacity="0.55"');
    s += SK.path("depRough", "", "", ' fill="var(--warn-hex)" opacity="0.75" stroke="none"');
    s += SK.circle("boreC", 900, y, 90, "", ' fill="var(--water)" opacity="0.30"');
    s += SK.txt(null, 900, y - 125, "cap", "middle", "поперечный разрез");
    s += SK.txt("crossT", 900, y + 135, "val", "middle", "");
    s += SK.txt("crossT2", 900, y + 157, "tiny muted", "middle", "");

    // --- итоги
    s += SK.rect(null, 60, 320, 1060, 80, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt("sum1", 80, 348, "val", "start", "");
    s += SK.txt("sum2", 80, 374, "tiny muted", "start", "");
    s += SK.txt("sum3", 1100, 348, "val", "end", "");
    s += SK.txt("sum4", 1100, 374, "tiny muted", "end", "");

    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["depTop", "depBot", "bore", "flow", "longT", "longT2",
      "depRing", "depRough", "boreC", "crossT", "crossT2", "sum1", "sum2", "sum3", "sum4"]);
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  function drawVis(ui) {
    build(ui);
    var st = S.state, y = 180, x0 = 60, x1 = 720;
    var rel = m.now.d / st.d0;                       // доля оставшегося просвета
    var half = 70 * rel;
    var rnd = U.rng(3);

    /* Слой отложений с неровной кромкой — бугорки, а не ровная труба. */
    var top = "M" + x0 + " " + (y - 70), bot = "M" + x0 + " " + (y + 70);
    var N = 60, rough = U.clamp(m.now.k / 3, 0, 1);
    for (var i = 0; i <= N; i++) {
      var x = x0 + (x1 - x0) * i / N;
      var bump = (rnd() - 0.5) * 10 * rough;
      top += " L" + SK.n(x) + " " + SK.n(y - half + bump);
      bot += " L" + SK.n(x) + " " + SK.n(y + half - bump);
    }
    top += " L" + x1 + " " + (y - 70) + " Z";
    bot += " L" + x1 + " " + (y + 70) + " Z";
    SK.set(R.depTop, { d: st.years > 0 ? top : "" });
    SK.set(R.depBot, { d: st.years > 0 ? bot : "" });
    SK.set(R.bore, { y: y - half + 1, height: Math.max(2, 2 * half - 2) });
    SK.flow(R.flow, m.loss.v, S.anim || 0);
    SK.set(R.flow, { "stroke-width": U.clamp(half / 8, 2, 6) });

    SK.text(R.longT, "просвет " + U.fmt(m.now.d, 1) + " мм из " + U.fmt(st.d0, 0) + " мм");
    SK.text(R.longT2, "слой отложений " + U.fmt(m.now.dep, 2) + " мм на стенку · шероховатость k = " + U.fmt(m.now.k, 3) + " мм");

    var rr = 100 * rel;
    SK.set(R.boreC, { r: Math.max(3, rr) });
    /* Бугорки: клинья между просветом и стенкой, а не заливка всего круга. */
    var bumps = "";
    for (var j = 0; j < 40; j++) {
      var a = j / 40 * Math.PI * 2, a2 = a + 0.13;
      var rb = Math.min(100, rr + 2 + rnd() * 9 * rough);
      bumps += "M" + SK.n(900 + rr * Math.cos(a)) + " " + SK.n(y + rr * Math.sin(a)) +
        " L" + SK.n(900 + rb * Math.cos(a)) + " " + SK.n(y + rb * Math.sin(a)) +
        " L" + SK.n(900 + rb * Math.cos(a2)) + " " + SK.n(y + rb * Math.sin(a2)) +
        " L" + SK.n(900 + rr * Math.cos(a2)) + " " + SK.n(y + rr * Math.sin(a2)) + " Z";
    }
    SK.set(R.depRough, { d: st.years > 0 && rough > 0.02 ? bumps : "" });
    SK.text(R.crossT, "сечение " + U.fmt(100 * rel * rel, 0) + " % от нового");
    SK.text(R.crossT2, m.now.mat.name + ", " + m.now.cond.name);

    SK.text(R.sum1, "Пропускает " + U.fmt(m.Q * 1000, 1) + " л/с — это " + U.fmt(m.keep * 100, 0) + " % от новой трубы");
    SK.text(R.sum2, "при располагаемом напоре " + U.fmt(st.H, 1) + " м на " + U.fmt(st.L, 0) + " м");
    SK.text(R.sum3, "Потери при " + U.fmt(st.Qfix, 1) + " л/с: " + U.fmt(m.loss.h, 2) + " м (было " + U.fmt(m.lossNew.h, 2) + " м)");
    SK.text(R.sum4, "рост потерь в " + U.fmt(m.growth, 2) + " раза · λ = " + U.fmt(m.loss.lam, 4) + " · v = " + U.fmt(m.loss.v, 2) + " м/с");
  }

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "cap", title: "Пропускная способность с годами", h: 330 },
    { id: "split", title: "Что важнее: шероховатость или потерянный просвет", h: 330 }
  ];

  function drawCharts(ui) {
    var st = S.state, i;
    var f = U.fitCanvas(ui.canvas("cap"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: 60, y0: 0, y1: 105,
      xLabel: "возраст трубы, лет", yLabel: "пропускная способность, % от новой"
    });
    Plot.clip(p);
    var cols = [U.css("--p1"), U.css("--p2"), U.css("--p3"), U.css("--good"), U.css("--bad")];
    MAT.forEach(function (mat, mi) {
      var pts = [];
      for (i = 0; i <= 60; i++) {
        var sState = state({ d0: st.d0, mat: mat.id, cond: st.cond, cleaned: 0 }, i);
        var q = capacity(st, sState);
        pts.push([i, 100 * q / m.Qnew]);
      }
      Plot.line(p, pts, {
        color: cols[mi % cols.length],
        width: mat.id === st.mat ? 2.6 : 1.3,
        dash: mat.id === st.mat ? null : [5, 4]
      });
    });
    Plot.dot(p, st.years, m.keep * 100, 5.5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p);
    Plot.legend(p, MAT.map(function (mat, mi) {
      return { color: cols[mi % cols.length], text: mat.name, dash: mat.id === st.mat ? null : [5, 4] };
    }));

    /* Раздельный вклад. */
    var f2 = U.fitCanvas(ui.canvas("split"));
    var items = [
      { y: 100, color: U.css("--muted"), label: "новая" },
      { y: 100 * m.Qk / m.Qnew, color: U.css("--p2"), label: "только k" },
      { y: 100 * m.Qd / m.Qnew, color: U.css("--p3"), label: "только просвет" },
      { y: 100 * m.keep, color: U.css("--bad"), label: "вместе" }
    ];
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 1, y0: 0, y1: 110,
      yLabel: "пропускная способность, %", noXLabels: true, pad: { l: 50, r: 14, t: 14, b: 48 }
    });
    Plot.bars(p2, items, 0.5);
    Plot.legend(p2, [
      { color: U.css("--p2"), text: "если бы росла только шероховатость" },
      { color: U.css("--p3"), text: "если бы только зарастал просвет" },
      { color: U.css("--bad"), text: "как есть: " + U.fmt(m.keep * 100, 0) + " %" }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state;
    return [
      { n: "Возраст", v: U.fmt(st.years, 0) + " лет" + (st.cleaned > 0 ? " (прочищена на " + U.fmt(st.cleaned, 0) + "-м году)" : "") },
      { n: "Материал", v: m.now.mat.name },
      { n: "Условия", v: m.now.cond.name },
      { h: "Состояние стенки" },
      { n: "Шероховатость k", v: U.fmt(m.now.k, 3) + " мм (было " + U.fmt(m.zero.k, 3) + " мм)" },
      { n: "Слой отложений", v: U.fmt(m.now.dep, 2) + " мм" },
      { n: "Внутренний диаметр", v: U.fmt(m.now.d, 1) + " мм из " + U.fmt(st.d0, 0) + " мм" },
      { n: "Площадь сечения", v: U.fmt(100 * Math.pow(m.now.d / st.d0, 2), 0) + " % от новой" },
      { h: "Пропускная способность при " + U.fmt(st.H, 1) + " м" },
      { n: "Сейчас", v: U.fmt(m.Q * 1000, 2) + " л/с", cls: m.keep < 0.7 ? "bad" : "good" },
      { n: "Новая труба", v: U.fmt(m.Qnew * 1000, 2) + " л/с", cls: "sub" },
      { n: "Осталось", v: U.fmt(m.keep * 100, 0) + " %", cls: m.keep < 0.7 ? "bad" : "good" },
      { h: "Потери при " + U.fmt(st.Qfix, 1) + " л/с" },
      { n: "Скорость", v: U.fmt(m.loss.v, 2) + " м/с" },
      { n: "Коэффициент λ", v: U.fmt(m.loss.lam, 4) + " (был " + U.fmt(m.lossNew.lam, 4) + ")" },
      { n: "Потери напора", v: U.fmt(m.loss.h, 2) + " м (были " + U.fmt(m.lossNew.h, 2) + " м)", cls: m.growth > 1.5 ? "bad" : "" },
      { n: "Рост потерь", v: U.fmt(m.growth, 2) + " раза" },
      { n: "Гидравлический уклон", v: U.fmt(1000 * m.loss.h / st.L, 2) + " ‰" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [];
    if (st.years === 0) {
      out.push({ lvl: "good", text: "Труба новая: шероховатость " + U.fmt(m.now.k, 3) + " мм, просвет полный. Двигайте ползунок возраста и смотрите, что будет через 10, 20, 40 лет." });
      return out;
    }
    out.push({
      lvl: m.keep < 0.7 ? "bad" : "info",
      text: "За " + U.fmt(st.years, 0) + " лет труба потеряла " + U.fmt((1 - m.keep) * 100, 0) + " % пропускной способности: " +
        U.fmt(m.Q * 1000, 1) + " л/с вместо " + U.fmt(m.Qnew * 1000, 1) + " л/с при том же напоре."
    });
    var kEffect = 100 * (1 - m.Qk / m.Qnew), dEffect = 100 * (1 - m.Qd / m.Qnew);
    out.push({
      lvl: "info",
      text: "Разложим: шероховатость сама по себе отняла бы " + U.fmt(kEffect, 0) + " %, а потерянный просвет — " + U.fmt(dEffect, 0) +
        " %. " + (dEffect > kEffect
          ? "<b>Главное — просвет.</b> Расход при заданном напоре пропорционален d^2,5: диаметр меньше на 10 % — расход меньше на четверть."
          : "Здесь главное — шероховатость: слой тонкий, но поверхность стала бугристой, и λ вырос с " + U.fmt(m.lossNew.lam, 3) + " до " + U.fmt(m.loss.lam, 3) + ".")
    });
    if (st.mat === "pe") {
      out.push({ lvl: "good", text: "Полимерная труба почти не стареет: гладкая непроводящая стенка, коррозии нет, отложения держатся плохо. Поэтому для неё в расчёте берут k = 0,01 мм и на весь срок службы, а не с надбавкой на возраст." });
    } else if (st.mat === "cement") {
      out.push({ lvl: "good", text: "Цементно-песчаное покрытие отделяет воду от металла: коррозии нет, бугорков нет. Именно поэтому старые чугунные водоводы не меняют, а наносят покрытие изнутри — пропускная способность возвращается почти к новой." });
    } else {
      out.push({
        lvl: "warn",
        text: "Незащищённый металл в воде с кислородом обрастает бугорками ржавчины (туберкулами). Они и шершавые, и объёмные: слой " + U.fmt(m.now.dep, 2) +
          " мм на стенку — это минус " + U.fmt(2 * m.now.dep, 2) + " мм диаметра."
      });
    }
    if (st.cond === "hot") {
      out.push({ lvl: "warn", text: "В горячем водоснабжении выше 60 °C карбонат кальция выпадает особенно активно: накипь растёт на стенках и на приборах. Отсюда требование СП держать температуру в системе не выше 75 °C и водоподготовка для жёсткой воды." });
    }
    if (m.loss.v > 2.5) {
      out.push({ lvl: "warn", text: "Скорость " + U.fmt(m.loss.v, 2) + " м/с в заросшей трубе — сечение уменьшилось, а расход остался. Растёт и износ, и шум, и опасность удара." });
    }
    if (st.cleaned > 0) {
      out.push({ lvl: "info", text: "Труба прочищена на " + U.fmt(st.cleaned, 0) + "-м году. Просвет вернулся, но шероховатость — нет: изъеденная поверхность так и осталась шершавой, и зарастает она потом быстрее, чем новая." });
    }
    out.push({
      lvl: "info",
      text: "В проектной практике это учитывают запасом: для стальных и чугунных труб без покрытия расчёт ведут по таблицам Шевелёва для «бывших в эксплуатации» труб, а не для новых. Разница в пропускной способности — 20–40 %."
    });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Двадцать лет за двадцать секунд", tag: "★ главный",
      preset: { d0: 100, L: 500, mat: "steelBare", cond: "normal", years: 0, H: 12, Qfix: 12, cleaned: 0 },
      steps: ["Труба новая. Запишите пропускную способность.", "Двигайте возраст: 5, 10, 20, 40 лет.", "Следите за разрезом и за процентами внизу."],
      watch: ["К 20 годам остаётся около двух третей.", "Слой на стенке всего пара миллиметров, а эффект огромный.", "λ растёт, но сечение падает сильнее."],
      why: "Q ~ d^2,5/√λ при заданном напоре. Потеря 5 % диаметра — это минус 12 % расхода, ещё до всякой шероховатости. Поэтому зарастание опаснее коррозии как таковой."
    },
    {
      title: "2. Материал решает", tag: "★ выбор",
      preset: { d0: 100, L: 500, mat: "steelBare", cond: "aggr", years: 25, H: 12, Qfix: 12, cleaned: 0 },
      steps: ["Агрессивная вода, 25 лет, незащищённая сталь.", "Переберите материалы: чугун, оцинковка, цементное покрытие, полиэтилен.", "Сравните кривые на левом графике."],
      watch: ["Полиэтилен идёт почти горизонтально.", "Цементное покрытие почти так же хорошо.", "Незащищённые металлы теряют половину и больше."],
      why: "Старение — это коррозия плюс отложения, а обе привязаны к контакту воды с металлом. Внутреннее покрытие (цементно-песчаное, эпоксидное) или полимерный материал снимают задачу. Отсюда и практика санации: старый водовод изнутри покрывают, не вскрывая улицу."
    },
    {
      title: "3. Прочистка помогает не навсегда", tag: "эксплуатация",
      preset: { d0: 150, L: 800, mat: "castIron", cond: "hard", years: 30, H: 15, Qfix: 20, cleaned: 0 },
      steps: ["Чугун, жёсткая вода, 30 лет: посмотрите, что осталось.", "Нажмите «Прочистить трубу».", "Продолжайте двигать возраст дальше — 35, 40, 50 лет."],
      watch: ["После прочистки расход подскакивает.", "Шероховатость остаётся выше, чем у новой трубы.", "Дальше труба зарастает снова, с той же скоростью."],
      why: "Механическая или гидропневматическая прочистка убирает отложения, но поверхность металла под ними уже изъедена. Без нанесения покрытия труба зарастает вновь за несколько лет — поэтому прочистку обычно совмещают с санацией."
    },
    {
      title: "4. Что будет с напором в доме", tag: "практика",
      preset: { d0: 50, L: 60, mat: "galv", cond: "hard", years: 0, H: 8, Qfix: 3, cleaned: 0 },
      steps: ["Внутридомовой стояк 50 мм, жёсткая вода. Посмотрите потери при 3 л/с.", "Двигайте возраст до 30 лет.", "Следите за потерями и за гидравлическим уклоном."],
      watch: ["Потери растут в несколько раз.", "Жильцы верхних этажей первыми теряют напор.", "Скорость в трубе растёт, появляется шум."],
      why: "Внутридомовые стальные трубы малого диаметра зарастают относительно быстрее: слой в 1 мм на стенку для трубы 50 мм — это минус 4 мм диаметра, то есть 8 % сечения теряется за первые же годы. Отсюда типичная жалоба «на верхних этажах нет воды» в старом доме без замены стояков."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Что происходит со стенкой</h3>' +
    "<ul><li><b>Коррозия</b> незащищённого металла: продукты коррозии не уносятся водой, а нарастают бугорками (туберкулами). Поверхность становится шершавой, просвет уменьшается.</li>" +
    "<li><b>Накипь</b>: при нагреве и в жёсткой воде выпадает карбонат кальция. В ГВС и теплообменниках это главный механизм.</li>" +
    "<li><b>Биообрастание</b>: плёнки микроорганизмов; в водопроводе это ещё и санитарная проблема.</li>" +
    "<li><b>Заиливание</b> при малых скоростях: взвесь оседает в тупиках и на малых уклонах.</li></ul></section>" +

    '<section class="card txt"><h3>Как это считают</h3>' +
    '<p class="formula">k(t) = k₀ + α·t</p>' +
    "<p>Формула Колбрука — Уайта для старения. Коэффициент α берут по опыту эксплуатации: 0,025 мм/год для мягкой неагрессивной воды, 0,05…0,15 для обычной, до 0,5 и больше для агрессивной.</p>" +
    "<p>Отдельно учитывают уменьшение просвета: слой толщиной δ на стенке уменьшает диаметр на 2δ.</p>" +
    "<p>В отечественной практике проще: берут таблицы Шевелёва, где для стальных и чугунных труб отдельно даны значения для новых и «бывших в эксплуатации». Разница в расходе при том же уклоне — 20…40 %.</p></section>" +

    '<section class="card txt"><h3>Почему просвет важнее</h3>' +
    '<p class="formula">Q ~ d<sup>2,5</sup>·√(i/λ)</p>' +
    "<p>Пропускная способность при заданном уклоне пропорциональна диаметру в степени 2,5. Потеря 10 % диаметра — это 25 % расхода. Шероховатость входит только под корнем и через логарифм, поэтому её влияние заметно слабее.</p>" +
    "<p>Отсюда правило: труба, потерявшая четверть диаметра, потеряла больше половины расхода — независимо от того, насколько гладкими остались отложения.</p></section>" +

    '<section class="card txt"><h3>Что с этим делают</h3>' +
    "<ul><li><b>Внутренние покрытия</b> при изготовлении: цементно-песчаное, эпоксидное, полимерное.</li>" +
    "<li><b>Санация</b> существующих сетей: прочистка и нанесение покрытия изнутри, протяжка полимерного рукава, взрывное разрушение старой трубы с протяжкой новой.</li>" +
    "<li><b>Водоподготовка</b>: удаление кислорода, стабилизационная обработка, умягчение для ГВС.</li>" +
    "<li><b>Скорость не ниже самоочищающей</b> — чтобы взвесь не оседала.</li>" +
    "<li><b>Правильные тупики</b>: их либо не делают, либо промывают по графику.</li></ul></section>";

  Lab.register(S);
})();
