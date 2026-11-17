/* Стенд 3. Потери напора: по длине и местные. Пьезометрическая линия.

   Два бака и трубопровод между ними: вход, прямой участок, колена, задвижка,
   внезапное расширение, второй участок, выход. Расход не задаётся — он находится
   из баланса напоров, как в настоящей системе:
       zА − zБ = Σ (ζ + λ·L/d) · v²/2g.
   Уравнение решается итерациями, потому что λ зависит от расхода. */
(function () {
  "use strict";

  var W = 1180, HH = 540;
  var YD = 470;                        // ось трубы
  var SC = 26;                         // px на метр напора
  var XA = 165, XB = 1035;             // начало и конец трубопровода

  /* Опорные точки схемы по горизонтали. */
  var XP = { bend: 470, valve: 590, exp: 720 };

  var S = {
    id: "losses", group: "basics",
    title: "Потери напора и пьезометрическая линия",
    lead: "Потери по длине — плавный уклон линии напоров, местные — ступеньки. Видно, какая часть напора уходит на трение о стенки, а какая на повороты, задвижку и удар при расширении.",
    hint: "Синяя ломаная — пьезометрическая линия. На внезапном расширении она поднимается: скорость упала, давление выросло, хотя энергия при этом потерялась.",
    vis: { kind: "svg" },
    speeds: [0.25, 1, 4],
    maxStep: 0.05
  };

  S.defaults = function () {
    return {
      zA: 12, zB: 2,          // уровни в баках над осью трубы, м
      d1: 100, d2: 150,       // диаметры участков, мм
      L1: 40, L2: 60,         // длины участков, м
      rough: "steelUsed",
      bends: 2,
      bendType: "elbow",
      valveOpen: 1.0,
      hasExp: true,
      inlet: "sharp",
      T: 10
    };
  };

  S.fields = [
    { title: "Напор и арматура", open: true, fields: [
      { k: "zA", t: "range", l: "Уровень в верхнем баке", u: "м", min: 1, max: 30, step: 0.5, d: 1 },
      { k: "zB", t: "range", l: "Уровень в нижнем баке", u: "м", min: 0, max: 20, step: 0.5, d: 1 },
      { k: "valveOpen", t: "range", l: "Открытие задвижки", u: "%", min: 0.02, max: 1, step: 0.01, pct: true, d: 0,
        hint: "Прикрытая задвижка — это местное сопротивление с огромным ζ. Расход падает, а потери перераспределяются." },
      { k: "inlet", t: "select", l: "Вход в трубу из бака", opts: [["sharp", "острая кромка, ζ = 0,5"], ["round", "скруглённый, ζ = 0,2"], ["borda", "выступающий внутрь (Борда), ζ = 1,0"]] },
      { k: "bends", t: "range", l: "Число поворотов на 90°", u: "шт", min: 0, max: 8, step: 1, d: 0 },
      { k: "bendType", t: "select", l: "Тип поворота", opts: [["elbow", "резкое колено, ζ = 1,1"], ["bend", "плавный отвод, ζ = 0,3"]] },
      { k: "hasExp", t: "check", l: "Внезапное расширение между участками" }
    ] },
    { title: "Трубопровод", open: true, fields: [
      { k: "d1", t: "range", l: "Диаметр первого участка", u: "мм", min: 25, max: 300, step: 5, d: 0 },
      { k: "L1", t: "range", l: "Длина первого участка", u: "м", min: 1, max: 300, step: 1, d: 0 },
      { k: "d2", t: "range", l: "Диаметр второго участка", u: "мм", min: 25, max: 400, step: 5, d: 0 },
      { k: "L2", t: "range", l: "Длина второго участка", u: "м", min: 1, max: 300, step: 1, d: 0 },
      { k: "rough", t: "select", l: "Материал и состояние труб",
        opts: Hydro.ROUGH.map(function (r) { return [r.id, r.name + " (k = " + U.fmt(r.k, 3) + " мм)"]; }) },
      { k: "T", t: "range", l: "Температура воды", u: "°C", min: 2, max: 90, step: 1, d: 0 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {};

  function zetaInlet(st) {
    return st.inlet === "round" ? Hydro.ZETA.inletRound : (st.inlet === "borda" ? Hydro.ZETA.inletBorda : Hydro.ZETA.inletSharp);
  }
  /* Задвижка: ζ растёт с прикрытием. Значения близки к таблицам Идельчика
     (открыта — 0,15; половина — около 2; четверть — десятки). */
  function zetaValve(open) {
    var o = U.clamp(open, 0.02, 1);
    return 0.15 / Math.pow(o, 3.2);
  }

  function elements(st) {
    var d1 = st.d1 / 1000, d2 = st.hasExp ? st.d2 / 1000 : st.d1 / 1000;
    var zb = st.bendType === "bend" ? Hydro.ZETA.bend90 : Hydro.ZETA.elbow90;
    var list = [
      { id: "in", name: "Вход в трубу", kind: "local", zeta: zetaInlet(st), d: d1, x: XA },
      { id: "p1", name: "Труба " + U.fmt(st.d1, 0) + " мм, " + U.fmt(st.L1, 0) + " м", kind: "pipe", L: st.L1, d: d1, x0: XA, x1: XP.bend },
      { id: "bend", name: st.bends + "×поворот 90°", kind: "local", zeta: zb * st.bends, d: d1, x: XP.bend },
      { id: "valve", name: "Задвижка", kind: "local", zeta: zetaValve(st.valveOpen), d: d1, x: XP.valve },
      { id: "p1b", name: "Труба (продолжение)", kind: "pipe", L: 0, d: d1, x0: XP.valve, x1: XP.exp }
    ];
    if (st.hasExp) list.push({ id: "exp", name: "Внезапное расширение " + U.fmt(st.d1, 0) + " → " + U.fmt(st.d2, 0) + " мм", kind: "local", zeta: Hydro.zetaExpansion(d1, d2), d: d1, x: XP.exp });
    list.push({ id: "p2", name: "Труба " + U.fmt(st.hasExp ? st.d2 : st.d1, 0) + " мм, " + U.fmt(st.L2, 0) + " м", kind: "pipe", L: st.L2, d: d2, x0: XP.exp, x1: XB });
    list.push({ id: "out", name: "Выход в бак", kind: "local", zeta: Hydro.ZETA.outlet, d: d2, x: XB });
    return list;
  }

  /* Сумма коэффициентов сопротивления, приведённая к Q²: h = K·Q². */
  function resistance(st, Q, els) {
    var nu = U.nu(st.T), k = Hydro.roughById(st.rough).k / 1000, K = 0;
    els.forEach(function (e) {
      var A = Hydro.area(e.d), v = Q / A;
      if (e.kind === "pipe") {
        if (e.L <= 0) { e.K = 0; e.lam = 0; return; }
        var Re = Hydro.reynolds(v, e.d, nu);
        e.lam = Hydro.lambda(Re, k, e.d);
        e.Re = Re;
        e.K = e.lam * e.L / e.d / (2 * Hydro.G * A * A);
      } else {
        e.K = e.zeta / (2 * Hydro.G * A * A);
      }
      K += e.K;
    });
    return K;
  }

  function compute(st) {
    var els = elements(st);
    var dH = st.zA - st.zB;
    var Q = 0.02;
    if (dH > 0) {
      for (var i = 0; i < 60; i++) {
        var K = resistance(st, Q, els);
        var Qn = Math.sqrt(dH / Math.max(K, 1e-12));
        if (Math.abs(Qn - Q) < 1e-10) { Q = Qn; break; }
        Q = Q + 0.7 * (Qn - Q);
      }
    } else { Q = 0; resistance(st, 1e-6, els); }

    var Ktot = resistance(st, Math.max(Q, 1e-6), els);
    var hLen = 0, hLoc = 0;
    els.forEach(function (e) {
      e.h = e.K * Q * Q;
      e.v = Q / Hydro.area(e.d);
      if (e.kind === "pipe") hLen += e.h;
      else {
        hLoc += e.h;
        /* эквивалентная длина: сколько метров этой же трубы дают те же потери */
        var kr = Hydro.roughById(st.rough).k / 1000;
        var lam = Hydro.lambda(Math.max(Hydro.reynolds(e.v, e.d, U.nu(st.T)), 1), kr, e.d);
        e.Lekv = lam > 1e-6 ? e.zeta * e.d / lam : 0;
      }
    });

    /* Станции для линий напоров. Скорость меняется там, где меняется диаметр:
       после расширения она другая, поэтому пьезометрическая линия шагает вверх. */
    var d2n = (st.hasExp ? st.d2 : st.d1) / 1000;
    var st8 = [], E = st.zA, dCur = st.d1 / 1000;
    els.forEach(function (e) {
      if (e.kind === "pipe") {
        dCur = e.d;
        if (e.x1 > e.x0) {
          st8.push({ x: e.x0, E: E, d: dCur });
          E -= e.h;
          st8.push({ x: e.x1, E: E, d: dCur });
        }
      } else {
        st8.push({ x: e.x, E: E, d: dCur });
        E -= e.h;
        if (e.id === "exp") dCur = d2n;
        if (e.id === "out") dCur = 1e9;             // в баке скорость нулевая
        st8.push({ x: e.x, E: E, d: dCur });
      }
    });

    m = {
      Q: Q, els: els, K: Ktot, hLen: hLen, hLoc: hLoc, dH: dH, stations: st8,
      v1: Q / Hydro.area(st.d1 / 1000), v2: Q / Hydro.area((st.hasExp ? st.d2 : st.d1) / 1000)
    };
    m.piez = st8.map(function (s) {
      var vv = Q / Hydro.area(s.d);
      return { x: s.x, piez: s.E - Hydro.velHead(vv), E: s.E };
    });
    m.hOut = els[els.length - 1].h;
  }

  S.reset = function () { compute(S.state); };
  S.onChange = function () { compute(S.state); };
  S.tick = function () { compute(S.state); };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };
  var scNow = SC;                      // масштаб напоров подстраивается под уровень в баке А
  function yh(h) { return YD - scNow * h; }

  function build(ui) {
    var st = S.state;
    var key = [st.d1, st.d2, st.hasExp, st.bends].join("|");
    if (built === key) return;
    built = key;
    var r1 = U.clamp(st.d1 * 0.06, 4, 14), r2 = U.clamp((st.hasExp ? st.d2 : st.d1) * 0.06, 4, 16);
    var s = SK.open(W, HH);

    // --- баки
    s += SK.rect(null, 30, 70, 135, YD - 70, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("wa", 32, 200, 131, 198, "water");
    s += SK.txt(null, 36, YD + 22, "cap", "start", "Бак А");
    s += SK.rect(null, XB, 150, 130, YD - 150, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("wb", XB + 2, 300, 126, 98, "water");
    s += SK.txt(null, XB + 4, YD + 22, "cap", "start", "Бак Б");

    // --- труба
    s += SK.rect(null, XA, YD - r1, XP.exp - XA, 2 * r1, "glass");
    s += SK.rect(null, XP.exp, YD - r2, XB - XP.exp, 2 * r2, "glass");
    s += SK.path("flow1", "M" + XA + " " + YD + " H" + XB, "flow", "");

    // --- арматура
    s += SK.g("gBend", "", SK.circle(null, XP.bend, YD, 13, "", ' fill="var(--panel)" stroke="var(--casing-dark)" stroke-width="1.5"') +
      SK.txt("bendT", XP.bend, YD + 4, "tiny", "middle", ""), "");
    s += SK.valve("gValve", XP.valve, YD, "clickable", 11);
    s += SK.txt(null, XP.valve, YD + 34, "tiny muted", "middle", "задвижка");
    s += SK.txt(null, XP.exp, YD + 34, "tiny muted", "middle", st.hasExp ? "расширение" : "");

    // --- линии напоров
    s += SK.path("eline", "", "energy-line", "");
    s += SK.path("pline", "", "piezo-line", "");
    s += SK.txt(null, XA + 10, 40, "tiny", "start", "красная штриховая — напорная линия, синяя — пьезометрическая");

    // --- подписи потерь
    ["in", "bend", "valve", "exp", "out"].forEach(function (id) {
      s += SK.txt("lb_" + id, 0, 0, "tiny bad", "middle", "");
    });
    s += SK.txt("lb_p1", (XA + XP.bend) / 2, 0, "tiny muted", "middle", "");
    s += SK.txt("lb_p2", (XP.exp + XB) / 2, 0, "tiny muted", "middle", "");
    s += SK.txt("qT", (XA + XB) / 2, YD + 62, "cap", "middle", "");

    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["wa", "wb", "eline", "pline", "gValve", "bendT", "gBend", "qT", "flow1",
      "lb_in", "lb_bend", "lb_valve", "lb_exp", "lb_out", "lb_p1", "lb_p2"]);
    ui.vis.addEventListener("click", function (e) {
      if (e.target.closest("#gValve")) {
        S.state.valveOpen = S.state.valveOpen > 0.5 ? 0.15 : 1;
        ui.refresh(); ui.save();
      }
    });
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state;

    /* Баки. */
    scNow = Math.min(SC, 392 / Math.max(st.zA, 1));
    var ya = yh(st.zA), yb = yh(st.zB);
    SK.set(R.wa, { y: Math.max(72, ya), height: Math.max(2, YD - Math.max(72, ya)) });
    SK.set(R.wb, { y: Math.max(152, yb), height: Math.max(2, YD - Math.max(152, yb)) });

    /* Линии напоров. */
    var el = "", pl = "";
    m.stations.forEach(function (s, i) {
      el += (i ? " L" : "M") + SK.n(s.x) + " " + SK.n(yh(s.E));
    });
    m.piez.forEach(function (s, i) {
      pl += (i ? " L" : "M") + SK.n(s.x) + " " + SK.n(yh(s.piez));
    });
    SK.set(R.eline, { d: el });
    SK.set(R.pline, { d: pl });

    /* Подписи потерь у элементов. */
    var byId = {};
    m.els.forEach(function (e) { byId[e.id] = e; });
    function lab(id, x) {
      var e = byId[id];
      if (!R["lb_" + id]) return;
      if (!e || e.h < 0.005) { SK.text(R["lb_" + id], ""); return; }
      SK.text(R["lb_" + id], U.fmt(e.h, 2) + " м");
      var xx = e.kind === "pipe" ? (e.x0 + e.x1) / 2 : e.x;
      SK.set(R["lb_" + id], { x: xx, y: yh(m.stations.length ? findE(xx) : 0) - 8 });
    }
    function findE(x) {
      var best = m.stations[0].E;
      for (var i = 0; i < m.stations.length; i++) if (m.stations[i].x <= x + 1) best = m.stations[i].E;
      return best;
    }
    ["in", "bend", "valve", "exp", "out", "p1", "p2"].forEach(function (id) { lab(id); });

    SK.cls(R.gValve, "shut", st.valveOpen <= 0.05);
    SK.cls(R.gValve, "throttled", st.valveOpen > 0.05 && st.valveOpen < 0.7);
    SK.text(R.bendT, st.bends ? st.bends + "×" : "—");
    SK.set(R.gBend, { opacity: st.bends ? 1 : 0.25 });
    SK.text(R.qT, "Q = " + U.fmt(m.Q * 1000, 2) + " л/с (" + U.fmt(m.Q * 3600, 1) + " м³/ч),  v₁ = " + U.fmt(m.v1, 2) + " м/с,  v₂ = " + U.fmt(m.v2, 2) + " м/с");
    SK.flow(R.flow1, m.v1, S.anim || 0);

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "bars", title: "Куда ушёл напор", h: 300 },
    { id: "curve", title: "Характеристика трубопровода", h: 300 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var items = m.els.filter(function (e) { return e.h > 1e-4 || e.kind === "pipe"; });
    var f = U.fitCanvas(ui.canvas("bars"));
    var hmax = Plot.niceMax(Math.max.apply(null, items.map(function (e) { return e.h; }).concat([0.1])));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: 1, y0: 0, y1: hmax, yLabel: "потери, м", noXLabels: true, pad: { l: 46, r: 14, t: 14, b: 52 }
    });
    Plot.bars(p, items.map(function (e) {
      return {
        y: e.h, color: e.kind === "pipe" ? U.css("--water") : U.css("--p2"),
        label: shortName(e)
      };
    }), 0.62);
    Plot.legend(p, [
      { color: U.css("--water"), text: "по длине: " + U.fmt(m.hLen, 2) + " м (" + U.fmt(100 * m.hLen / Math.max(m.hLen + m.hLoc, 1e-9), 0) + " %)" },
      { color: U.css("--p2"), text: "местные: " + U.fmt(m.hLoc, 2) + " м (" + U.fmt(100 * m.hLoc / Math.max(m.hLen + m.hLoc, 1e-9), 0) + " %)" }
    ]);

    /* Характеристика трубопровода: h = K·Q², и где на ней стоит рабочая точка. */
    var f2 = U.fitCanvas(ui.canvas("curve"));
    var Qmax = Math.max(m.Q * 1.8, 0.005);
    var cur = [], open = [], i, Qq;
    var save = st.valveOpen;
    for (i = 0; i <= 60; i++) {
      Qq = Qmax * i / 60;
      cur.push([Qq * 1000, resistance(st, Math.max(Qq, 1e-6), elements(st)) * Qq * Qq]);
    }
    st.valveOpen = 1;
    var elsOpen = elements(st);
    for (i = 0; i <= 60; i++) {
      Qq = Qmax * i / 60;
      open.push([Qq * 1000, resistance(st, Math.max(Qq, 1e-6), elsOpen) * Qq * Qq]);
    }
    st.valveOpen = save;
    compute(st);

    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: Qmax * 1000, y0: 0, y1: Plot.niceMax(Math.max(m.dH * 1.3, 1)),
      xLabel: "расход, л/с", yLabel: "потребный напор, м"
    });
    Plot.clip(p2);
    Plot.line(p2, open, { color: U.css("--muted"), width: 1.6, dash: [6, 4] });
    Plot.line(p2, cur, { color: U.css("--water"), width: 2.2 });
    Plot.hline(p2, m.dH, { color: U.css("--good"), dash: [6, 4], width: 1.8 });
    Plot.dot(p2, m.Q * 1000, m.dH, 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--water"), text: "сеть при текущей задвижке" },
      { color: U.css("--muted"), text: "задвижка открыта полностью", dash: [6, 4] },
      { color: U.css("--good"), text: "располагаемый напор zА − zБ = " + U.fmt(m.dH, 1) + " м", dash: [6, 4] }
    ]);
  }

  function shortName(e) {
    if (e.id === "in") return "вход";
    if (e.id === "p1") return "труба 1";
    if (e.id === "p1b") return "";
    if (e.id === "bend") return "повороты";
    if (e.id === "valve") return "задвижка";
    if (e.id === "exp") return "расшир.";
    if (e.id === "p2") return "труба 2";
    if (e.id === "out") return "выход";
    return "";
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, rows = [];
    rows.push({ n: "Расход Q", v: U.fmt(m.Q * 1000, 2) + " л/с · " + U.fmt(m.Q * 3600, 1) + " м³/ч" });
    rows.push({ n: "Скорость на участке 1", v: U.fmt(m.v1, 2) + " м/с", cls: m.v1 > 3 ? "warn" : "" });
    rows.push({ n: "Скорость на участке 2", v: U.fmt(m.v2, 2) + " м/с" });
    rows.push({ n: "Располагаемый напор", v: U.fmt(m.dH, 2) + " м" });
    rows.push({ h: "Ведомость потерь" });
    m.els.forEach(function (e) {
      if (e.kind === "pipe" && e.L <= 0) return;
      var extra = e.kind === "pipe"
        ? "λ = " + U.fmt(e.lam, 4) + ", Re = " + U.fmt(e.Re || 0, 0)
        : "ζ = " + U.fmt(e.zeta, 2) + (e.Lekv ? ", Lэкв = " + U.fmt(e.Lekv, 1) + " м" : "");
      rows.push({ n: e.name, v: U.fmt(e.h, 3) + " м" });
      rows.push({ n: "", v: extra, cls: "sub" });
    });
    rows.push({ h: "Итого" });
    rows.push({ n: "Потери по длине", v: U.fmt(m.hLen, 2) + " м (" + U.fmt(100 * m.hLen / Math.max(m.hLen + m.hLoc, 1e-9), 0) + " %)" });
    rows.push({ n: "Потери местные", v: U.fmt(m.hLoc, 2) + " м (" + U.fmt(100 * m.hLoc / Math.max(m.hLen + m.hLoc, 1e-9), 0) + " %)", cls: "warn" });
    rows.push({ n: "Гидравлический уклон участка 1", v: U.fmt(1000 * m.els[1].h / Math.max(st.L1, 0.001), 2) + " ‰" });
    return rows;
  };

  S.explain = function () {
    var st = S.state, out = [];
    if (m.dH <= 0) {
      out.push({ lvl: "warn", text: "Уровень в нижнем баке не ниже верхнего — течь некуда. Самотёк возможен только сверху вниз: движущая сила здесь только разность уровней." });
      return out;
    }
    var part = 100 * m.hLoc / Math.max(m.hLen + m.hLoc, 1e-9);
    out.push({
      lvl: "info",
      text: "Разность уровней " + U.fmt(m.dH, 2) + " м целиком израсходована на потери: " + U.fmt(m.hLen, 2) + " м на трение о стенки и " + U.fmt(m.hLoc, 2) +
        " м на местные сопротивления. Расход устанавливается сам — там, где кривая сети пересекает горизонталь располагаемого напора."
    });
    if (part > 45) {
      out.push({ lvl: "warn", text: "Местные потери дают " + U.fmt(part, 0) + " % — это «короткая» система. В таких случаях считать их «десятью процентами от линейных», как иногда делают, нельзя: ошибка будет в разы." });
    } else if (part < 12) {
      out.push({ lvl: "good", text: "Местные потери всего " + U.fmt(part, 0) + " % — система длинная, в ней правит трение о стенки. Здесь уместна привычная надбавка 5…10 % на местные сопротивления." });
    }
    if (st.valveOpen < 0.5) {
      var eV = m.els[3];
      out.push({
        lvl: "warn",
        text: "Задвижка прикрыта до " + U.fmt(st.valveOpen * 100, 0) + " %: ζ вырос до " + U.fmt(eV.zeta, 1) + ", на ней теряется " + U.fmt(eV.h, 2) +
          " м. Дросселирование не «останавливает» воду, оно съедает напор — на графике справа вся кривая сети становится круче."
      });
    }
    if (st.hasExp && m.els.length > 5) {
      var eE = m.els.filter(function (e) { return e.id === "exp"; })[0];
      if (eE && eE.h > 0.002) {
        out.push({
          lvl: "info",
          text: "На внезапном расширении теряется " + U.fmt(eE.h, 3) + " м (формула Борда: ζ = (1 − A₁/A₂)² = " + U.fmt(eE.zeta, 2) +
            "), но <b>давление при этом растёт</b> — синяя линия на схеме шагает вверх. Скорость упала с " + U.fmt(m.v1, 2) + " до " + U.fmt(m.v2, 2) +
            " м/с, и большая часть скоростного напора превратилась в давление; в потери ушла разница."
        });
      }
    }
    if (m.v1 > 3) {
      out.push({ lvl: "warn", text: "Скорость " + U.fmt(m.v1, 2) + " м/с — многовато для водопровода: шум, износ, риск удара при закрытии. Обычно держат 0,8…1,5 м/с в разводке и до 2,5 м/с на вводах." });
    }
    var eIn = m.els[0];
    out.push({
      lvl: "info",
      text: "Вход в трубу: " + (st.inlet === "round" ? "скруглённая кромка, ζ = 0,2" : (st.inlet === "borda" ? "выступающий внутрь патрубок, ζ = 1,0" : "острая кромка, ζ = 0,5")) +
        " — это " + U.fmt(eIn.h, 3) + " м. Скругление входного отверстия — самый дешёвый способ сэкономить напор, который существует."
    });
    out.push({
      lvl: "info",
      text: "Выход в бак забирает ровно скоростной напор: " + U.fmt(m.els[m.els.length - 1].h, 3) +
        " м. Эту энергию нельзя вернуть — вода гасит её в приёмном баке вихрями. Поэтому выходной патрубок и делают пошире."
    });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Дросселирование задвижкой", tag: "арматура",
      preset: { zA: 12, zB: 2, d1: 100, d2: 150, L1: 40, L2: 60, valveOpen: 1, bends: 2, hasExp: true },
      steps: ["Задвижка открыта, запомните расход.", "Прикрывайте её: 70 %, 50 %, 30 %, 15 %.", "Смотрите на ведомость потерь и на пьезометрическую линию."],
      watch: ["Расход падает не пропорционально открытию: до 50 % почти ничего не меняется.", "Ступенька на задвижке растёт и забирает почти весь напор.", "Потери в трубах при этом уменьшаются — воды-то стало меньше."],
      why: "Регулирующая арматура работает не «перекрытием дороги», а поглощением напора. Пока сопротивление задвижки мало по сравнению с остальной сетью, прикрытие ничего не даёт — это и есть «плохая характеристика регулирования» у обычной задвижки."
    },
    {
      title: "2. Старение труб", tag: "шероховатость",
      preset: { zA: 12, zB: 2, d1: 100, d2: 100, L1: 120, L2: 150, valveOpen: 1, bends: 2, hasExp: false, rough: "steelNew" },
      steps: ["Трубы новые, стальные. Запишите расход.", "Меняйте материал: сталь бывшая в работе → старая с отложениями → старый чугун.", "Сравните расход и коэффициент λ."],
      watch: ["Расход падает на десятки процентов при том же напоре.", "λ растёт с 0,02 до 0,04 и выше.", "Кривая сети на правом графике поднимается."],
      why: "Шероховатость k входит в формулу Колбрука под логарифмом, но в квадратичной области определяет λ целиком. Стальная труба за 20–30 лет теряет треть пропускной способности: отсюда и таблицы Шевелёва с поправкой на возраст, и стенд «Отложения и коррозия» в разделе водоснабжения."
    },
    {
      title: "3. Когда местные потери главные", tag: "★ важное",
      preset: { zA: 6, zB: 0, d1: 50, d2: 50, L1: 3, L2: 2, valveOpen: 1, bends: 6, hasExp: false, inlet: "sharp" },
      steps: ["Короткий трубопровод: всего 5 м, но 6 поворотов, вход с острой кромкой и выход.", "Посмотрите на столбики: местные против линейных.", "Теперь увеличьте длины до 100 и 150 м и посмотрите ещё раз."],
      watch: ["На коротком участке местные потери — большая часть всего.", "На длинном они тонут в трении о стенки.", "Эквивалентная длина в показаниях: сколько метров трубы «стоит» каждое сопротивление."],
      why: "Правило простое: длина трубы против эквивалентной длины арматуры. Один резкий поворот 90 мм «стоит» примерно 3–4 м трубы, обратный клапан — десяток. В обвязке насоса или узле ввода местные потери могут дать 80 % всего сопротивления."
    },
    {
      title: "4. Расширение: давление растёт, энергия падает", tag: "★ эффект",
      preset: { zA: 10, zB: 1, d1: 50, d2: 200, L1: 30, L2: 30, valveOpen: 1, bends: 0, hasExp: true },
      steps: ["Узкая труба 50 мм переходит в широкую 200 мм.", "Смотрите на синюю линию в точке расширения.", "Меняйте d₂ от 60 до 300 мм."],
      watch: ["Синяя (пьезометрическая) линия шагает <b>вверх</b>: давление после расширения больше.", "Красная (напорная) в той же точке шагает вниз — энергия потерялась.", "Потеря Борда максимальна, когда d₂ много больше d₁."],
      why: "При внезапном расширении струя не успевает растечься и срывается: вокруг неё крутятся вихри, которые и съедают энергию. Но скорость упала, а значит, часть скоростного напора всё же превратилась в давление — прибор показывает прирост. Плавный диффузор делает то же самое почти без потерь."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Две формулы</h3>' +
    '<p class="formula">по длине: h = λ·(L/d)·v²/2g — формула Дарси — Вейсбаха</p>' +
    '<p class="formula">местные: h = ζ·v²/2g — формула Вейсбаха</p>' +
    "<p>Обе пропорциональны скоростному напору. Разница в том, что λ·L/d накапливается с длиной, а ζ — свойство одного узла: поворота, тройника, клапана, входа.</p>" +
    "<p>Скорость, к которой отнесён ζ, надо указывать: у внезапного расширения — скорость до него, у сужения — после. Ошибка здесь даёт разницу в разы.</p></section>" +

    '<section class="card txt"><h3>Эквивалентная длина</h3>' +
    '<p class="formula">L<sub>экв</sub> = ζ·d/λ</p>' +
    "<p>Удобный способ сравнить арматуру с трубой. При λ ≈ 0,03 и диаметре 100 мм один резкий поворот (ζ = 1,1) эквивалентен 3,7 м трубы, вентиль (ζ = 4,5) — 15 м, обратный клапан — 7 м.</p>" +
    "<p>В показаниях стенда эквивалентная длина считается для каждого элемента. Сравните её с длиной участков — сразу видно, стоит ли вообще возиться с местными потерями в этой задаче.</p></section>" +

    '<section class="card txt"><h3>Почему расход не задаётся, а получается</h3>' +
    "<p>Трубопровод между двумя баками не имеет «настройки расхода». Есть располагаемый напор — разность уровней, и есть сопротивление. Вода разгоняется до тех пор, пока потери не съедят весь напор:</p>" +
    '<p class="formula">zА − zБ = (Σζ + Σλ·L/d)·v²/2g = K·Q²</p>' +
    "<p>Это уравнение и решает стенд. График справа — та самая парабола K·Q²: характеристика трубопровода. Пересечение с горизонталью располагаемого напора даёт рабочую точку. Если вместо баков поставить насос, горизонталь сменится кривой Q–H — получится стенд «Характеристика насоса».</p></section>" +

    '<section class="card txt"><h3>Таблица коэффициентов ζ</h3>' +
    '<table class="tbl"><tr><th>Элемент</th><th>ζ</th></tr>' +
    "<tr><td>Вход с острой кромкой</td><td>0,5</td></tr>" +
    "<tr><td>Вход скруглённый</td><td>0,2</td></tr>" +
    "<tr><td>Вход выступающий (Борда)</td><td>1,0</td></tr>" +
    "<tr><td>Выход в резервуар</td><td>1,0</td></tr>" +
    "<tr><td>Колено 90° резкое</td><td>1,1</td></tr>" +
    "<tr><td>Отвод 90° плавный</td><td>0,3</td></tr>" +
    "<tr><td>Задвижка открытая</td><td>0,15</td></tr>" +
    "<tr><td>Вентиль</td><td>4…6</td></tr>" +
    "<tr><td>Обратный клапан</td><td>2…3</td></tr>" +
    "<tr><td>Тройник на ответвление</td><td>1,5</td></tr>" +
    "<tr><td>Водосчётчик</td><td>3…5</td></tr></table>" +
    "<p class=\"muted small\">Значения по Идельчику, округлённые. Точное значение зависит от числа Рейнольдса и от геометрии, но для расчёта водопровода этой точности хватает.</p></section>";

  Lab.register(S);
})();
