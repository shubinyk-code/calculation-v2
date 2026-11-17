/* Стенд 2. Уравнение Бернулли и труба Вентури.

   Труба переменного сечения с подъёмом, на ней стойка пьезометров и одна трубка Пито.
   В каждом сечении считается полная удельная энергия
       E = z + p/ρg + α·v²/2g,
   которая убывает по потоку на величину потерь. Пьезометр показывает z + p/ρg,
   трубка Пито — всё E. Где труба сужается, скорость растёт, а давление падает —
   это и есть эффект Вентури. */
(function () {
  "use strict";

  var W = 1180, HH = 560;
  var X0 = 150, X1 = 1030;            // труба по горизонтали
  var YD = 500;                        // датум (отметка 0)
  var SC = 118;                        // px на метр напора и высоты
  var DS = 420;                        // px на метр диаметра (нарочно увеличено)

  /* Пьезометры: относительное положение вдоль трубы. */
  var PZ = [0.10, 0.26, 0.46, 0.62, 0.90];

  var S = {
    id: "bernoulli", group: "basics",
    title: "Бернулли и труба Вентури",
    lead: "Пьезометры на трубе переменного сечения: в горле вода проседает, за диффузором почти возвращается. Линия полного напора идёт вниз только на величину потерь.",
    hint: "Синяя линия — пьезометрическая (z + p/ρg), красная штриховая — напорная (полная энергия). Расстояние между ними в каждом сечении равно скоростному напору v²/2g.",
    vis: { kind: "svg" },
    speeds: [0.25, 1, 4],
    maxStep: 0.02
  };

  S.defaults = function () {
    return {
      Q: 4.0,            // расход, л/с
      d1: 80,            // диаметр трубы, мм
      d2: 40,            // диаметр горла, мм
      dz: 0.0,           // подъём выходного конца, м
      L: 4.0,            // длина участка, м
      pOut: 1.5,         // напор на выходе (свободный конец в бак), м
      kmm: 0.05,         // шероховатость, мм
      meter: "venturi",  // расходомер: труба Вентури или диафрагма
      T: 20,
      showPitot: true
    };
  };

  S.fields = [
    { title: "Режим", open: true, fields: [
      { k: "Q", t: "range", l: "Расход (насос стенда)", u: "л/с", min: 0, max: 14, step: 0.1, d: 2 },
      { k: "pOut", t: "range", l: "Напор на выходе (уровень в приёмном баке)", u: "м", min: 0, max: 4, step: 0.1, d: 1,
        hint: "Вся линия напоров поднимается или опускается целиком: перепады между сечениями от этого не зависят." },
      { k: "dz", t: "range", l: "Подъём выходного конца", u: "м", min: -1, max: 1.5, step: 0.05, d: 2,
        hint: "Геометрический напор z. Поднимите трубу — пьезометры просядут ровно на столько же." }
    ] },
    { title: "Труба", open: true, fields: [
      { k: "d1", t: "range", l: "Диаметр трубы", u: "мм", min: 40, max: 120, step: 1, d: 0 },
      { k: "d2", t: "range", l: "Диаметр горла", u: "мм", min: 12, max: 100, step: 1, d: 0 },
      { k: "L", t: "range", l: "Длина участка", u: "м", min: 2, max: 8, step: 0.5, d: 1 },
      { k: "meter", t: "select", l: "Сужающее устройство", opts: [["venturi", "труба Вентури (плавная)"], ["orifice", "диафрагма (острая)"]],
        hint: "Перепад давления одинаково измеряет расход, а вот безвозвратные потери отличаются в разы." },
      { k: "kmm", t: "range", l: "Шероховатость стенок", u: "мм", min: 0.001, max: 1, step: 0.005, d: 3 },
      { k: "T", t: "range", l: "Температура воды", u: "°C", min: 2, max: 90, step: 1, d: 0 },
      { k: "showPitot", t: "check", l: "Трубка Пито в конце участка" }
    ] }
  ];

  /* ------------------------------------------------------------ геометрия трубы */

  /* Диаметр в относительной координате s (0…1). Плавная труба Вентури: конфузор 19°,
     диффузор 6…8°. Диафрагма — скачок сечения на коротком участке. */
  function diamAt(st, s) {
    var d1 = st.d1 / 1000, d2 = Math.min(st.d2, st.d1) / 1000;
    if (st.meter === "orifice") {
      if (s < 0.455 || s > 0.475) return d1;
      return d2;
    }
    if (s < 0.30) return d1;
    if (s < 0.42) return U.lerp(d1, d2, (s - 0.30) / 0.12);
    if (s < 0.50) return d2;
    if (s < 0.74) return U.lerp(d2, d1, (s - 0.50) / 0.24);
    return d1;
  }
  function zAt(st, s) { return 0.25 + st.dz * s; }

  /* ------------------------------------------------------------ модель */

  var m = {};

  function compute(st) {
    var Q = st.Q / 1000, nu = U.nu(st.T), k = st.kmm / 1000;
    var N = 240, prof = [], i, s, d, A, v, hv, Re, lam;
    var d1 = st.d1 / 1000, d2 = Math.min(st.d2, st.d1) / 1000;

    /* Местные потери сужающего устройства (Идельчик): у диафрагмы почти весь
       перепад теряется безвозвратно, у трубы Вентури — малая часть. */
    var beta = d2 / d1;
    var dpMeter = Hydro.dpByFlow(d1, d2, Q, st.meter === "orifice" ? 0.62 : 0.985);
    var lossMeter = dpMeter * Hydro.meterLoss(st.meter, beta);

    /* Идём по трубе и накапливаем потери. */
    var hLoss = 0, prev = null;
    for (i = 0; i <= N; i++) {
      s = i / N;
      d = diamAt(st, s);
      A = Hydro.area(d);
      v = Q / A;
      hv = Hydro.velHead(v);
      Re = Hydro.reynolds(v, d, nu);
      lam = Hydro.lambda(Re, k, d);
      if (prev) {
        var dx = (s - prev.s) * st.L;
        hLoss += Hydro.hFriction(dx, 0.5 * (d + prev.d), 0.5 * (v + prev.v), lam);
        /* Местные потери размазываем по длине сужающего устройства, чтобы линия
           напоров была непрерывной, а не прыгала. */
        var w = st.meter === "orifice"
          ? (s > 0.455 && s <= 0.52 ? (s - prev.s) / 0.065 : 0)
          : (s > 0.30 && s <= 0.74 ? (s - prev.s) / 0.44 : 0);
        hLoss += lossMeter * w;
      }
      prof.push({ s: s, x: s * st.L, d: d, A: A, v: v, hv: hv, Re: Re, lam: lam, loss: hLoss, z: zAt(st, s) });
      prev = { s: s, d: d, v: v };
    }

    /* Полная энергия в конце известна: выход в бак с уровнем pOut над датумом
       (весь скоростной напор на выходе теряется в баке). */
    var last = prof[prof.length - 1];
    var E0 = st.pOut + last.z + last.hv;           // энергия в конце трубы: уровень в баке плюс скоростной напор
    var Ein = E0 + hLoss;                          // в начале участка — больше на все потери

    prof.forEach(function (q) {
      q.E = Ein - q.loss;
      q.p = q.E - q.z - q.hv;                      // пьезометрический напор p/ρg
      q.piez = q.z + q.p;                          // отметка пьезометрической линии
    });

    m = {
      prof: prof, Q: Q, hLoss: hLoss, lossMeter: lossMeter, dpMeter: dpMeter, beta: beta,
      Ein: Ein, Eend: E0,
      inlet: prof[Math.round(0.26 * N)],
      throat: prof[Math.round((st.meter === "orifice" ? 0.465 : 0.46) * N)],
      exit: prof[N],
      vapor: -10.33 + U.vaporHead(st.T)            // абсолютный ноль по манометрической шкале
    };
    m.dh = m.inlet.piez - m.throat.piez;
    m.Qmeter = Hydro.flowByDp(d1, d2, Math.max(0, m.dh), st.meter === "orifice" ? 0.62 : 0.985);
    m.minPiez = prof.reduce(function (a, q) { return Math.min(a, q.p); }, 1e9);
  }

  S.reset = function () { compute(S.state); };
  S.onChange = function () { compute(S.state); };
  S.tick = function () { compute(S.state); };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function yh(h) { return YD - SC * h; }            // напор → пиксель
  function xs(s) { return X0 + (X1 - X0) * s; }

  function build(ui) {
    var st = S.state;
    var key = [st.d1, st.d2, st.meter, st.L, st.showPitot].join("|");
    if (built === key) return;
    built = key;

    var s = SK.open(W, HH);
    var i;

    // --- датум и шкала напоров
    s += SK.line(null, 40, YD, W - 20, YD, "datum");
    s += SK.txt(null, 44, YD + 14, "tiny muted", "start", "плоскость сравнения (датум)");
    for (i = 1; i <= 4; i++) {
      s += SK.line(null, 46, yh(i), 54, yh(i), "scale");
      s += SK.txt(null, 42, yh(i) + 4, "tiny muted", "end", i + " м");
    }
    s += SK.line(null, 50, yh(4.2), 50, YD, "scale");

    // --- труба (заполняется в draw: форма зависит от диаметров)
    s += SK.path("pipeBody", "", "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="1.5"');
    s += SK.path("pipeWater", "", "", ' fill="var(--water)" opacity="0.3" stroke="none"');
    s += SK.path("axis", "", "", ' fill="none" stroke="var(--axis)" stroke-width="1" stroke-dasharray="6 4"');

    // --- пьезометры
    PZ.forEach(function (p, j) {
      s += SK.line(null, xs(p), 60, xs(p), YD, "tube");
      s += SK.rect("pz" + j, xs(p) - 3.5, 200, 7, 60, "", ' fill="var(--water)" opacity="0.85"');
      s += SK.txt(null, xs(p) + 9, 52, "tiny muted", "start", "П" + (j + 1));
      s += SK.txt("pzv" + j, xs(p) + 9, 66, "tiny", "start", "");
    });

    // --- трубка Пито
    if (st.showPitot) {
      s += SK.path(null, "M" + xs(0.80) + " " + YD + " V70", "tube");
      s += SK.rect("pit", xs(0.80) - 3.5, 200, 7, 60, "", ' fill="var(--bad)" opacity="0.7"');
      s += SK.txt(null, xs(0.80) + 9, 62, "tiny muted", "start", "Пито");
    }

    // --- линии напоров
    s += SK.path("eline", "", "energy-line", "");
    s += SK.path("pline", "", "piezo-line", "");
    s += SK.txt("elineT", X1 + 6, 100, "tiny", "start", "напорная линия");
    s += SK.txt("plineT", X1 + 6, 130, "tiny", "start", "пьезометрическая");

    // --- перепад на расходомере
    s += SK.line("dhBar", xs(PZ[1]), 200, xs(PZ[2]), 200, "", ' stroke="var(--p2)" stroke-width="1.6" stroke-dasharray="4 3"');
    s += SK.txt("dhT", xs((PZ[1] + PZ[2]) / 2), 190, "val", "middle", "");

    // --- подписи
    s += SK.txt("capIn", X0 - 6, YD - 12, "cap", "end", "");
    s += SK.txt(null, xs(0.46), HH - 16, "tiny muted", "middle", "горло");
    s += SK.txt("capMeter", xs(0.46), HH - 32, "cap", "middle", "");
    s += SK.txt("hvT", xs(0.46), 0, "tiny", "middle", "");

    s += SK.close();
    ui.vis.innerHTML = s;

    var ids = ["pipeBody", "pipeWater", "axis", "eline", "pline", "dhBar", "dhT", "capIn", "capMeter", "hvT", "elineT", "plineT"];
    PZ.forEach(function (p, j) { ids.push("pz" + j, "pzv" + j); });
    if (st.showPitot) ids.push("pit");
    R = SK.refs(ui.vis, ids);
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, P = m.prof, i, q;

    /* Контур трубы: верх и низ от оси z(s) с учётом «увеличенного» диаметра. */
    var top = "", bot = [], ax = "";
    for (i = 0; i < P.length; i++) {
      q = P[i];
      var X = xs(q.s), yc = yh(q.z), rr = q.d * DS / 2;
      top += (i ? " L" : "M") + SK.n(X) + " " + SK.n(yc - rr);
      bot.push([X, yc + rr]);
      ax += (i ? " L" : "M") + SK.n(X) + " " + SK.n(yc);
    }
    var body = top + " L" + bot.reverse().map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") + " Z";
    SK.set(R.pipeBody, { d: body });
    SK.set(R.pipeWater, { d: body });
    SK.set(R.axis, { d: ax });

    /* Линии напоров. */
    var el = "", pl = "";
    for (i = 0; i < P.length; i++) {
      q = P[i];
      el += (i ? " L" : "M") + SK.n(xs(q.s)) + " " + SK.n(yh(q.E));
      pl += (i ? " L" : "M") + SK.n(xs(q.s)) + " " + SK.n(yh(q.piez));
    }
    SK.set(R.eline, { d: el });
    SK.set(R.pline, { d: pl });
    SK.set(R.elineT, { y: yh(m.exit.E) - 4 });
    SK.set(R.plineT, { y: yh(m.exit.piez) + 12 });

    /* Пьезометры: столбик воды от трубы до отметки пьезометрической линии. */
    PZ.forEach(function (p, j) {
      var idx = Math.round(p * (P.length - 1)), qq = P[idx];
      var yTop = yh(qq.piez), yBase = yh(qq.z);
      var neg = qq.p < 0;
      SK.set(R["pz" + j], {
        y: Math.min(yTop, yBase), height: Math.max(1, Math.abs(yBase - yTop)),
        fill: neg ? "var(--bad)" : "var(--water)", opacity: neg ? 0.5 : 0.85
      });
      SK.text(R["pzv" + j], U.fmt(qq.p, 2) + " м");
      SK.set(R["pzv" + j], { fill: neg ? "var(--bad)" : "var(--ink)" });
    });
    if (R.pit) {
      var qp = P[Math.round(0.80 * (P.length - 1))], yB = yh(qp.z);
      var yT = yh(qp.E);
      SK.set(R.pit, { y: Math.min(yT, yB), height: Math.max(1, Math.abs(yB - yT)) });
    }

    /* Перепад на расходомере. */
    var y1 = yh(m.inlet.piez), y2 = yh(m.throat.piez);
    SK.set(R.dhBar, { x1: xs(PZ[1]), y1: y1, x2: xs(PZ[2]), y2: y1 });
    SK.text(R.dhT, "Δh = " + U.fmt(m.dh, 3) + " м");
    SK.set(R.dhT, { y: Math.min(y1, y2) - 8 });

    SK.text(R.capIn, U.fmt(st.Q, 2) + " л/с");
    SK.text(R.capMeter, st.meter === "orifice" ? "диафрагма" : "труба Вентури");
    SK.text(R.hvT, "v горла = " + U.fmt(m.throat.v, 2) + " м/с");
    SK.set(R.hvT, { y: yh(m.throat.E) - 8 });

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "lines", title: "Линии напоров по длине участка", h: 320 },
    { id: "meter", title: "Расходомер: перепад и безвозвратные потери", h: 320 }
  ];

  function drawCharts(ui) {
    var st = S.state, P = m.prof;

    var f = U.fitCanvas(ui.canvas("lines"));
    var hi = Math.max(m.Ein, 0.5) * 1.1, lo = Math.min(0, m.minPiez, m.prof[0].z) - 0.2;
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: st.L, y0: lo, y1: hi,
      xLabel: "расстояние по трубе, м", yLabel: "напор, м"
    });
    Plot.clip(p);
    Plot.line(p, P.map(function (q) { return [q.x, q.E]; }), { color: U.css("--bad"), width: 2, dash: [7, 4] });
    Plot.line(p, P.map(function (q) { return [q.x, q.piez]; }), { color: U.css("--water"), width: 2.2 });
    Plot.line(p, P.map(function (q) { return [q.x, q.z]; }), { color: U.css("--muted"), width: 1.4 });
    Plot.fillBetween(p, P.map(function (q) { return [q.x, q.E]; }), P.map(function (q) { return [q.x, q.piez]; }), U.css("--bad"), 0.10);
    Plot.fillBetween(p, P.map(function (q) { return [q.x, q.piez]; }), P.map(function (q) { return [q.x, q.z]; }), U.css("--water"), 0.12);
    Plot.unclip(p);
    Plot.hline(p, 0, { color: U.css("--axis"), dash: [3, 3] });
    Plot.legend(p, [
      { color: U.css("--bad"), text: "полный напор E = z + p/ρg + v²/2g", dash: [7, 4] },
      { color: U.css("--water"), text: "пьезометрический z + p/ρg" },
      { color: U.css("--muted"), text: "ось трубы z" }
    ]);

    /* --- расходомер: Q(Δh) и разложение потерь */
    var f2 = U.fitCanvas(ui.canvas("meter"));
    var d1 = st.d1 / 1000, d2 = Math.min(st.d2, st.d1) / 1000;
    var dhMax = Math.max(0.3, m.dh * 1.6);
    var pts = [], po = [], i2;
    for (i2 = 0; i2 <= 60; i2++) {
      var dh = dhMax * i2 / 60;
      pts.push([dh, Hydro.flowByDp(d1, d2, dh, 0.985) * 1000]);
      po.push([dh, Hydro.flowByDp(d1, d2, dh, 0.62) * 1000]);
    }
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: dhMax, y0: 0, y1: Math.max(1, Plot.niceMax(Math.max(pts[60][1], st.Q * 1.2))),
      xLabel: "перепад Δh на расходомере, м", yLabel: "расход, л/с"
    });
    Plot.clip(p2);
    Plot.line(p2, pts, { color: U.css("--p1"), width: 2 });
    Plot.line(p2, po, { color: U.css("--p2"), width: 2, dash: [6, 4] });
    if (m.dh > 0) Plot.dot(p2, m.dh, st.Q, 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--p1"), text: "труба Вентури, C = 0,985" },
      { color: U.css("--p2"), text: "диафрагма, C = 0,62", dash: [6, 4] },
      { color: U.css("--accent"), text: "стенд сейчас", dot: true }
    ]);
    var lossPart = m.dpMeter > 0 ? m.lossMeter / m.dpMeter : 0;
    Plot.label(p2, p2.x0 + (p2.x1 - p2.x0) * 0.03, p2.y0 + (p2.y1 - p2.y0) * 0.12,
      "безвозвратно теряется " + U.fmt(lossPart * 100, 0) + " % перепада (" + U.fmt(m.lossMeter, 3) + " м)",
      U.css("--muted"), "left", "bottom", true);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, T = m.throat, I = m.inlet;
    return [
      { h: "Сечение трубы (перед горлом)" },
      { n: "Диаметр / скорость", v: U.fmt(st.d1, 0) + " мм · " + U.fmt(I.v, 2) + " м/с" },
      { n: "Пьезометрический напор", v: U.fmt(I.p, 3) + " м" },
      { n: "Скоростной напор v²/2g", v: U.fmt(I.hv, 3) + " м" },
      { h: "Горло" },
      { n: "Диаметр / скорость", v: U.fmt(Math.min(st.d2, st.d1), 0) + " мм · " + U.fmt(T.v, 2) + " м/с" },
      { n: "Пьезометрический напор", v: U.fmt(T.p, 3) + " м", cls: T.p < 0 ? "bad" : (T.p < 1 ? "warn" : "") },
      { n: "Скоростной напор v²/2g", v: U.fmt(T.hv, 3) + " м" },
      { n: "Число Рейнольдса", v: U.fmt(T.Re, 0) },
      { h: "Расходомер" },
      { n: "Перепад Δh (П2 − П3)", v: U.fmt(m.dh, 3) + " м" },
      { n: "Расход по перепаду", v: U.fmt(m.Qmeter * 1000, 2) + " л/с", cls: "sub" },
      { n: "Отношение β = d₂/d₁", v: U.fmt(m.beta, 3) },
      { n: "Безвозвратные потери в нём", v: U.fmt(m.lossMeter, 3) + " м" },
      { h: "Баланс энергии на участке" },
      { n: "Полный напор в начале", v: U.fmt(m.Ein, 3) + " м" },
      { n: "Полный напор в конце", v: U.fmt(m.exit.E, 3) + " м" },
      { n: "Потери всего", v: U.fmt(m.hLoss, 3) + " м", cls: "warn" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [], T = m.throat, I = m.inlet;
    if (st.Q < 0.02) {
      out.push({ lvl: "info", text: "Расхода нет: скоростного напора нет, потерь нет. Все пьезометры показывают одно и то же — гидростатика. Линия полного напора горизонтальна." });
      return out;
    }
    out.push({
      lvl: "info",
      text: "Сечение сузилось в " + U.fmt(I.A / T.A, 1) + " раза — скорость во столько же раз выросла (" + U.fmt(I.v, 2) + " → " + U.fmt(T.v, 2) +
        " м/с), а скоростной напор в " + U.fmt(T.hv / Math.max(I.hv, 1e-9), 1) + " раз (v² в формуле). Ровно на эту прибавку и проседает давление в горле: Δh = " + U.fmt(m.dh, 3) + " м."
    });
    if (T.p < 0) {
      out.push({ lvl: "bad", text: "<b>В горле вакуум:</b> " + U.fmt(T.p, 2) + " м вод. ст. ниже атмосферы. Пьезометр показал бы подсос воздуха, а не столб воды. До кавитации остаётся " + U.fmt(T.p - m.vapor, 2) + " м — посмотрите стенд «Кавитация»." });
    } else if (T.p < 0.5) {
      out.push({ lvl: "warn", text: "Давление в горле упало до " + U.fmt(T.p, 2) + " м. Ещё немного расхода или ещё чуть уже горло — и будет вакуум: в этой точке трубы удобно ставить эжектор, но опасно — обычную арматуру." });
    }
    out.push({
      lvl: "good",
      text: "За диффузором давление возвращается: скорость снова упала, скоростной напор превратился обратно в давление. Вернулось не всё — " + U.fmt(m.lossMeter, 3) +
        " м осталось в потерях. " + (st.meter === "orifice"
          ? "У диафрагмы теряется больше половины перепада: струя за острой кромкой срывается и гасит энергию в вихрях."
          : "У трубы Вентури теряется всего " + U.fmt(100 * Hydro.meterLoss("venturi", m.beta), 0) + " % перепада — плавный диффузор возвращает давление почти полностью.")
    });
    if (Math.abs(st.dz) > 0.02) {
      out.push({
        lvl: "info",
        text: "Выходной конец " + (st.dz > 0 ? "поднят" : "опущен") + " на " + U.fmt(Math.abs(st.dz), 2) + " м. Пьезометры вдоль трубы " +
          (st.dz > 0 ? "проседают" : "подрастают") + ", но полный напор это не меняет: z и p/ρg перетекают друг в друга, сумма остаётся."
      });
    }
    out.push({
      lvl: "info",
      text: "Расстояние между красной и синей линиями — скоростной напор. Где труба уже, полоса шире. Красная линия не может подняться по потоку: энергия только убывает, на потери."
    });
    if (Math.abs(m.Qmeter * 1000 - st.Q) > 0.05) {
      out.push({ lvl: "warn", text: "Расход, вычисленный по перепаду (" + U.fmt(m.Qmeter * 1000, 2) + " л/с), немного отличается от настоящего (" + U.fmt(st.Q, 2) + " л/с): коэффициент расхода C взят постоянным, а он слегка зависит от числа Рейнольдса. Так же ведёт себя и настоящий расходомер." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Куда девается давление в горле", tag: "основы",
      preset: { Q: 4, d1: 80, d2: 40, dz: 0, pOut: 1.5, meter: "venturi" },
      steps: ["Смотрите на пьезометры: в горле столбик заметно ниже.", "Увеличивайте расход от 0 до 10 л/с.", "Следите за линиями на графике: синяя проваливается, красная только опускается."],
      watch: ["Δh растёт как квадрат расхода.", "Расстояние между красной и синей линиями — скоростной напор.", "Полный напор нигде не увеличивается."],
      why: "Уравнение Бернулли: сумма z + p/ρg + v²/2g вдоль потока постоянна за вычетом потерь. Сужение не добавляет энергии, оно перекладывает её из давления в скорость."
    },
    {
      title: "2. Сделать вакуум в горле", tag: "★ эффект",
      preset: { Q: 8, d1: 80, d2: 22, dz: 0, pOut: 1.0, meter: "venturi" },
      speed: 1,
      steps: ["Горло сужено до 22 мм, расход 8 л/с.", "Смотрите на пьезометр в горле — он покраснел: столб ушёл ниже трубы.", "Уменьшайте «Напор на выходе» до нуля и смотрите, насколько глубоким станет вакуум."],
      watch: ["Отрицательный пьезометрический напор — это разрежение.", "Физический предел — около −10 м (полный вакуум), и то недостижимый: раньше вскипит вода.", "На этом эффекте работают водоструйные насосы и эжекторы."],
      why: "Чем выше скорость в горле, тем больше v²/2g и тем меньше остаётся на долю давления. Если в горле сделать боковое отверстие, оно будет подсасывать воздух или жидкость — так устроены эжектор, пеносмеситель, карбюратор и вакуумный насос Бунзена."
    },
    {
      title: "3. Труба Вентури против диафрагмы", tag: "расходомер",
      preset: { Q: 6, d1: 80, d2: 40, meter: "venturi", dz: 0 },
      steps: ["Запомните перепад Δh и потери участка.", "Переключите «Сужающее устройство» на диафрагму.", "Сравните перепад, безвозвратные потери и наклон красной линии."],
      watch: ["Перепад у диафрагмы больше — у неё меньше коэффициент расхода.", "Потери участка вырастают в несколько раз: за острой кромкой струя срывается.", "Красная линия на схеме падает ступенькой."],
      why: "Измерять расход можно и тем, и другим: перепад однозначно связан с расходом. Но диафрагма проста и дёшева, а платит за это потерянным напором — 50…80 % перепада против 10…20 % у трубы Вентури."
    },
    {
      title: "4. Поднять трубу: z против p", tag: "геометрия",
      preset: { Q: 5, d1: 80, d2: 40, dz: 0, pOut: 2.5, meter: "venturi" },
      steps: ["Медленно поднимайте выходной конец на 1,5 м.", "Смотрите на пьезометры в конце участка и на линию z."],
      watch: ["Пьезометрические столбики оседают почти на ту же величину, на какую поднялась труба.", "Пьезометрическая линия в пространстве почти не двигается — двигается труба под ней.", "Полный напор и потери не меняются вовсе."],
      why: "В уравнении Бернулли z и p/ρg входят суммой, и прибор-пьезометр показывает именно сумму. Поэтому пьезометрическая линия — свойство потока, а не трубы: подняли трубу — давление в ней упало ровно на высоту подъёма."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Три слагаемых</h3>' +
    '<p class="formula">z + p/ρg + α·v²/2g = const − h<sub>потерь</sub></p>' +
    "<p>Каждое слагаемое — энергия на единицу веса жидкости, поэтому у всех размерность длины, и все три можно отложить по вертикали в метрах:</p>" +
    "<ul><li><b>z</b> — геометрический напор, высота точки над плоскостью сравнения;</li>" +
    "<li><b>p/ρg</b> — пьезометрический напор, высота столба, который поднимется в трубке;</li>" +
    "<li><b>v²/2g</b> — скоростной напор, то, во что превратится скорость, если её полностью затормозить.</li></ul>" +
    "<p>Коэффициент α (Кориолиса) учитывает неравномерность скорости по сечению: при турбулентном режиме α ≈ 1,05…1,1, при ламинарном α = 2. В стенде принято α = 1.</p></section>" +

    '<section class="card txt"><h3>Две линии</h3>' +
    "<p><b>Пьезометрическая линия</b> соединяет уровни в пьезометрах: она может и подниматься, и опускаться — в расширении давление растёт.</p>" +
    "<p><b>Напорная линия</b> (линия полного напора) всегда идёт вниз по потоку: энергия тратится на трение и вихри. Подняться она может только там, где есть насос.</p>" +
    "<p>Вертикальное расстояние между ними в каждом сечении равно v²/2g, то есть характеризует скорость. Уклон напорной линии — это гидравлический уклон i = h/L, главная величина в расчёте трубопроводов.</p>" +
    "<p>Трубка Пито, направленная навстречу потоку, тормозит воду и показывает полный напор, поэтому её уровень стоит на напорной линии. Разница показаний Пито и пьезометра даёт скорость: v = √(2g·Δh) — так работает трубка Пито — Прандтля.</p></section>" +

    '<section class="card txt"><h3>Труба Вентури как расходомер</h3>' +
    '<p class="formula">Q = C/√(1 − β⁴) · A₂ · √(2g·Δh),  β = d₂/d₁</p>' +
    "<p>Перепад измеряется двумя отборами — перед конфузором и в горле. Коэффициент C учитывает потери и неравномерность: у классической трубы Вентури 0,98…0,99, у диафрагмы около 0,6.</p>" +
    "<p>Множитель 1/√(1 − β⁴) появляется потому, что скорость в широкой части не нулевая. При β = 0,5 он равен 1,03, при β = 0,75 уже 1,2.</p>" +
    "<p>Практическое правило: β берут 0,4…0,7. Меньше — огромный перепад и потери, больше — перепад мал, и погрешность измерения растёт.</p></section>" +

    '<section class="card txt"><h3>Где это в водоснабжении</h3>' +
    "<ul><li><b>Водомер с сужением</b>, счётчики перепада, балансировочные клапаны с измерительными ниппелями — всё это Вентури в разных видах.</li>" +
    "<li><b>Эжекторы</b>: дозаторы реагентов, пеносмесители, водоструйные насосы — используют вакуум в горле.</li>" +
    "<li><b>Кавитация в арматуре</b>: в приоткрытом клапане скорость в щели огромна, давление падает ниже давления насыщенного пара, и клапан «гремит».</li>" +
    "<li><b>Насос на всасе</b>: чем выше скорость во всасывающем патрубке, тем ниже давление — отсюда требование к NPSH и правило делать всас шире нагнетания.</li></ul></section>";

  Lab.register(S);
})();
