/* Стенд 4. Истечение через отверстия и насадки.

   Сосуд с боковым отверстием, сменные насадки, мерный лоток и линейка для струи.
       v = φ·√(2gH),  Q = μ·A·√(2gH),  μ = ε·φ,
   где ε — сжатие струи, φ — коэффициент скорости. У насадка ε = 1, но φ меньше:
   он выигрывает расходом и проигрывает скоростью. */
(function () {
  "use strict";

  var W = 1180, HH = 520;
  var TX = 90, TW = 300;               // бак: левый край и ширина
  var YBOT = 430;                      // дно бака и пол лотка
  var PM = 120;                        // px на метр

  var S = {
    id: "orifice", group: "basics",
    title: "Истечение через отверстия и насадки",
    lead: "Одно и то же отверстие с насадком и без: расход отличается в полтора раза, дальность струи — наоборот. Видно сжатие струи, вакуум внутри насадка и его срыв при большом напоре.",
    hint: "Щелчок по сосуду переключает постоянный напор и опорожнение. Пунктир — траектория струи, она же линейка дальности.",
    vis: { kind: "svg" },
    speeds: [0.25, 1, 4, 10],
    maxStep: 0.02
  };

  S.defaults = function () {
    return {
      kind: "hole",
      d: 20,              // диаметр отверстия, мм
      H0: 1.6,            // напор над центром отверстия, м
      Sves: 0.6,          // площадь сосуда в плане, м²
      steady: true,       // постоянный напор (подпитка) или опорожнение
      zHole: 0.35,        // высота отверстия над полом, м
      T: 20
    };
  };

  S.fields = [
    { title: "Насадок", open: true, fields: [
      { k: "kind", t: "select", l: "Что стоит в отверстии", opts: Hydro.NOZZLES.map(function (n) { return [n.id, n.name]; }) },
      { k: "d", t: "range", l: "Диаметр отверстия", u: "мм", min: 5, max: 60, step: 1, d: 0 },
      { k: "zHole", t: "range", l: "Высота отверстия над полом", u: "м", min: 0.1, max: 1, step: 0.05, d: 2,
        hint: "От неё зависит дальность полёта струи, но не расход." },
      { t: "note", k: "kind", render: function (st) {
        var n = Hydro.nozzleById(st.kind);
        return '<div class="hint" style="margin-top:2px">' + n.note + "</div>";
      } }
    ] },
    { title: "Напор", open: true, fields: [
      { k: "H0", t: "range", l: "Напор над центром отверстия", u: "м", min: 0.05, max: 12, step: 0.05, d: 2 },
      { k: "steady", t: "check", l: "Поддерживать уровень (постоянный напор)" },
      { k: "Sves", t: "range", l: "Площадь сосуда в плане", u: "м²", min: 0.05, max: 3, step: 0.05, d: 2,
        show: function (st) { return !st.steady; } },
      { k: "T", t: "range", l: "Температура воды", u: "°C", min: 2, max: 95, step: 1, d: 0 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {}, hist = [], volume = 0;

  function nozzle(st) {
    var n = Hydro.nozzleById(st.kind);
    /* Срыв вакуума: в цилиндрическом насадке разрежение 0,75·H. Как только оно
       опускается ниже давления насыщенного пара, насадок «срывает» — внутри
       образуется пар, струя отрывается от стенок, и он работает как отверстие. */
    if (st.kind === "cyl" || st.kind === "div") {
      var hvac = Hydro.nozzleVacuum(m.H === undefined ? st.H0 : m.H);
      var limit = 10.33 - U.vaporHead(st.T);
      if (hvac > limit) {
        var hole = Hydro.nozzleById("hole");
        return { eps: hole.eps, phi: hole.phi, zeta: hole.zeta, name: n.name, broken: true, note: n.note };
      }
    }
    return n;
  }

  function compute(st) {
    var H = m.H === undefined ? st.H0 : m.H;
    var n = nozzle(st);
    var d = st.d / 1000, A = Hydro.area(d);
    var mu = n.eps * n.phi;
    var v = n.phi * Math.sqrt(2 * Hydro.G * Math.max(0, H));         // скорость в сжатом сечении
    var vIdeal = Math.sqrt(2 * Hydro.G * Math.max(0, H));
    var Q = mu * A * Math.sqrt(2 * Hydro.G * Math.max(0, H));
    /* Дальность струи: свободное падение от отверстия до пола. */
    var t = Math.sqrt(2 * st.zHole / Hydro.G);
    var range = v * t;
    m = U.merge(m, {
      H: H, n: n, mu: mu, eps: n.eps, phi: n.phi, A: A, Q: Q, v: v, vIdeal: vIdeal,
      range: range, hvac: (st.kind === "cyl" || st.kind === "div") && !n.broken ? Hydro.nozzleVacuum(H) : 0,
      broken: !!n.broken,
      tEmpty: st.steady ? 0 : Hydro.emptyTime(st.Sves, { eps: n.eps, phi: n.phi }, d, H, 0),
      hLoss: n.zeta * v * v / (2 * Hydro.G)
    });
  }

  S.reset = function () {
    m = { H: S.state.H0 };
    hist = []; volume = 0;
    compute(S.state);
  };
  S.onChange = function (key) {
    if (key === "H0" || key === "steady") m.H = S.state.H0;
    compute(S.state);
  };

  S.tick = function (dt) {
    var st = S.state;
    compute(st);
    if (st.steady) { m.H = st.H0; }
    else if (m.H > 0) {
      m.H = Math.max(0, m.H - m.Q / Math.max(st.Sves, 0.01) * dt);
    }
    volume += m.Q * 1000 * dt;
    if (hist.length === 0 || S.t - hist[hist.length - 1][0] > 0.15) {
      hist.push([S.t, m.H, m.Q * 1000]);
      if (hist.length > 2000) hist.shift();
    }
    compute(st);
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    var st = S.state;
    var key = [st.d, st.kind, st.zHole].join("|");
    if (built === key) return;
    built = key;
    var yHole = YBOT - st.zHole * PM;
    var rr = U.clamp(st.d * 0.35, 3, 14);
    var s = SK.open(W, HH);

    // --- сосуд
    s += SK.rect("vessel", TX, 40, TW, YBOT - 40, "tank-wall clickable", ' rx="3" fill-opacity="0"');
    s += SK.rect("vw", TX + 2, 200, TW - 4, YBOT - 202, "water");
    s += SK.txt(null, TX + 8, 34, "cap", "start", "Сосуд");
    s += SK.arrow("feed", TX + 40, 60, TX + 40, 96, "tube", 1.6);
    s += SK.txt("feedT", TX + 48, 70, "tiny muted", "start", "подпитка");

    // --- шкала напора
    s += SK.line(null, TX + TW + 16, 40, TX + TW + 16, YBOT, "scale");
    for (var i = 0; i <= 12; i++) {
      var y = yHole - i * 0.5 * PM;
      if (y < 30) break;
      s += SK.line(null, TX + TW + 12, y, TX + TW + 20, y, "scale");
      if (i % 2 === 0) s += SK.txt(null, TX + TW + 24, y + 4, "tiny muted", "start", U.fmt(i * 0.5, 1) + " м");
    }

    // --- насадок и струя
    s += SK.g("nozzle", "", "", "");
    s += SK.path("jet", "", "", ' fill="none" stroke="var(--water)" stroke-width="3" stroke-linecap="round"');
    s += SK.path("jetPath", "", "", ' fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="4 4"');
    s += SK.txt("jetT", 0, 0, "val", "middle", "");

    // --- пол и мерный лоток
    s += SK.line(null, TX, YBOT, W - 40, YBOT, "ground");
    s += SK.rect(null, TX + TW + 120, YBOT - 90, 180, 90, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("mw", TX + TW + 122, YBOT - 2, 176, 0, "water");
    s += SK.txt("mwT", TX + TW + 210, YBOT - 96, "tiny muted", "middle", "мерный бак");
    s += SK.line("rangeDim", TX + TW, YBOT + 16, TX + TW + 100, YBOT + 16, "dim");
    s += SK.txt("rangeT", TX + TW + 60, YBOT + 34, "tiny", "middle", "");

    // --- вставка: сжатое сечение
    s += SK.g("inset", "", SK.rect(null, 0, 0, 300, 150, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"') +
      SK.txt(null, 150, 20, "cap", "middle", "что происходит в отверстии") +
      SK.path("insetShape", "", "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2.5"') +
      SK.path("insetJet", "", "", ' fill="var(--water)" opacity="0.45" stroke="none"') +
      SK.txt("insetT", 150, 140, "tiny muted", "middle", "") +
      SK.txt("insetV", 150, 128, "tiny", "middle", ""),
      ' transform="translate(' + (W - 330) + ',40)"');

    // --- вакуумметр
    s += SK.g("vac", "", SK.rect(null, -55, -26, 110, 34, "", ' fill="var(--panel)" stroke="var(--bad)" rx="4"') +
      SK.txt("vacT", 0, -4, "val bad", "middle", ""),
      ' transform="translate(' + (TX + TW + 70) + "," + (yHole - 60) + ')"');

    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["vessel", "vw", "nozzle", "jet", "jetPath", "jetT", "mw", "mwT", "rangeDim", "rangeT",
      "insetShape", "insetJet", "insetT", "insetV", "vac", "vacT", "feed", "feedT"]);

    ui.vis.addEventListener("click", function (e) {
      if (e.target.closest("#vessel") || e.target.closest("#vw")) {
        S.state.steady = !S.state.steady;
        if (S.state.steady) m.H = S.state.H0;
        ui.refresh(); ui.save();
      }
    });
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state;
    var yHole = YBOT - st.zHole * PM;
    var yTop = yHole - m.H * PM;
    var rr = U.clamp(st.d * 0.35, 3, 14);

    SK.set(R.vw, { y: U.clamp(yTop, 42, YBOT - 2), height: Math.max(1, YBOT - U.clamp(yTop, 42, YBOT - 2)) });
    SK.set(R.feed, { opacity: st.steady ? 1 : 0.15 });
    SK.set(R.feedT, { opacity: st.steady ? 1 : 0.15 });

    /* Насадок: короткая трубка для цилиндрического, конус для конических. */
    var nx = TX + TW, g = "";
    if (st.kind === "hole") {
      g = SK.rect(null, nx - 3, yHole - rr, 6, 2 * rr, "", ' fill="var(--casing-dark)"');
    } else if (st.kind === "borda") {
      g = SK.rect(null, nx - 36, yHole - rr, 40, 2 * rr, "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    } else if (st.kind === "cyl") {
      g = SK.rect(null, nx, yHole - rr, 3 * rr + 12, 2 * rr, "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    } else if (st.kind === "conv") {
      g = SK.path(null, "M" + nx + " " + (yHole - rr * 1.6) + " L" + (nx + 42) + " " + (yHole - rr) +
        " M" + nx + " " + (yHole + rr * 1.6) + " L" + (nx + 42) + " " + (yHole + rr), "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    } else if (st.kind === "cono") {
      g = SK.path(null, "M" + nx + " " + (yHole - rr * 2) + " Q" + (nx + 26) + " " + (yHole - rr * 1.1) + " " + (nx + 40) + " " + (yHole - rr) +
        " M" + nx + " " + (yHole + rr * 2) + " Q" + (nx + 26) + " " + (yHole + rr * 1.1) + " " + (nx + 40) + " " + (yHole + rr), "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    } else {
      g = SK.path(null, "M" + nx + " " + (yHole - rr * 0.7) + " L" + (nx + 46) + " " + (yHole - rr * 1.5) +
        " M" + nx + " " + (yHole + rr * 0.7) + " L" + (nx + 46) + " " + (yHole + rr * 1.5), "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    }
    R.nozzle.innerHTML = g;

    /* Струя: парабола свободного падения. */
    var jx = nx + (st.kind === "hole" ? 6 : 46), pts = "", trace = "";
    if (m.H > 0.001 && m.v > 0.01) {
      var k = 0;
      for (var tt = 0; tt <= 3; tt += 0.01) {
        var x = jx + m.v * tt * PM, y = yHole + Hydro.G * tt * tt / 2 * PM;
        if (y > YBOT) break;
        if (x > W - 20) break;
        pts += (k++ ? " L" : "M") + SK.n(x) + " " + SK.n(y);
      }
      trace = pts;
    }
    SK.set(R.jet, { d: pts, "stroke-width": Math.max(2, rr * 0.55) });
    SK.set(R.jetPath, { d: trace });
    SK.text(R.jetT, m.H > 0.001 ? "v = " + U.fmt(m.v, 2) + " м/с" : "");
    SK.set(R.jetT, { x: jx + 70, y: yHole - 12 });

    /* Дальность струи. */
    var xEnd = Math.min(jx + m.range * PM, W - 20);
    SK.set(R.rangeDim, { x1: jx, x2: xEnd, y1: YBOT + 16, y2: YBOT + 16 });
    SK.text(R.rangeT, m.H > 0.001 ? "дальность " + U.fmt(m.range, 2) + " м" : "");
    SK.set(R.rangeT, { x: (jx + xEnd) / 2 });

    /* Мерный бак. */
    var hw = U.clamp(volume / 200, 0, 1) * 88;
    SK.set(R.mw, { y: YBOT - 2 - hw, height: hw });
    SK.text(R.mwT, "мерный бак: " + U.fmt(volume, 1) + " л");

    /* Вакуумметр на насадке. */
    var showVac = m.hvac > 0.01;
    SK.set(R.vac, { opacity: showVac ? 1 : 0 });
    SK.text(R.vacT, showVac ? "вакуум " + U.fmt(m.hvac, 2) + " м" : "");

    /* Вставка со сжатым сечением. */
    drawInset(st);
    drawCharts(ui);
  };

  function drawInset(st) {
    var cx = 150, cy = 80, r = 34;
    var eps = m.eps, shape = "", jet = "";
    var xw = 96;                                     // положение стенки внутри вставки
    if (st.kind === "hole") {
      shape = "M" + xw + " " + (cy - 60) + " V" + (cy - r) + " M" + xw + " " + (cy + r) + " V" + (cy + 60);
      var rc = r * Math.sqrt(eps);
      jet = "M" + xw + " " + (cy - r) + " Q" + (xw + 22) + " " + (cy - rc) + " " + (xw + 120) + " " + (cy - rc) +
        " L" + (xw + 120) + " " + (cy + rc) + " Q" + (xw + 22) + " " + (cy + rc) + " " + xw + " " + (cy + r) + " Z";
      SK.text(R.insetT, "струя сжимается: ε = " + U.fmt(eps, 2) + ", сжатое сечение на расстоянии 0,5·d");
    } else if (st.kind === "borda") {
      shape = "M" + xw + " " + (cy - 60) + " V" + (cy + 60) + " M" + (xw - 46) + " " + (cy - r) + " H" + xw +
        " M" + (xw - 46) + " " + (cy + r) + " H" + xw;
      var rb = r * Math.sqrt(eps);
      jet = "M" + xw + " " + (cy - r) + " Q" + (xw + 16) + " " + (cy - rb) + " " + (xw + 120) + " " + (cy - rb) +
        " L" + (xw + 120) + " " + (cy + rb) + " Q" + (xw + 16) + " " + (cy + rb) + " " + xw + " " + (cy + r) + " Z";
      SK.text(R.insetT, "вход изнутри: сжатие самое сильное, ε = " + U.fmt(eps, 2));
    } else if (st.kind === "cyl" || st.kind === "div") {
      var len = 96, rOut = st.kind === "div" ? r * 1.5 : r;
      shape = "M" + xw + " " + (cy - 60) + " V" + (cy - r) + " H" + (xw + len) + (st.kind === "div" ? " L" + (xw + len) + " " + (cy - rOut) : "") +
        " M" + xw + " " + (cy + 60) + " V" + (cy + r) + " H" + (xw + len) + (st.kind === "div" ? " L" + (xw + len) + " " + (cy + rOut) : "");
      if (m.broken) {
        var rc2 = r * 0.8;
        jet = "M" + xw + " " + (cy - r) + " Q" + (xw + 20) + " " + (cy - rc2) + " " + (xw + 130) + " " + (cy - rc2) +
          " L" + (xw + 130) + " " + (cy + rc2) + " Q" + (xw + 20) + " " + (cy + rc2) + " " + xw + " " + (cy + r) + " Z";
        SK.text(R.insetT, "вакуум сорван: струя оторвалась от стенок, насадок работает как отверстие");
      } else {
        jet = "M" + xw + " " + (cy - r) + " Q" + (xw + 22) + " " + (cy - r * 0.8) + " " + (xw + 44) + " " + (cy - r) +
          " L" + (xw + len) + " " + (cy - rOut) + " L" + (xw + 130) + " " + (cy - rOut) +
          " L" + (xw + 130) + " " + (cy + rOut) + " L" + (xw + len) + " " + (cy + rOut) +
          " L" + (xw + 44) + " " + (cy + r) + " Q" + (xw + 22) + " " + (cy + r * 0.8) + " " + xw + " " + (cy + r) + " Z";
        SK.text(R.insetT, "сжатие внутри, потом струя снова заполняет насадок — там и сидит вакуум");
      }
    } else {
      shape = "M" + xw + " " + (cy - 60) + " V" + (cy - r * 1.6) + " L" + (xw + 60) + " " + (cy - r) + " M" +
        xw + " " + (cy + 60) + " V" + (cy + r * 1.6) + " L" + (xw + 60) + " " + (cy + r);
      jet = "M" + xw + " " + (cy - r * 1.6) + " L" + (xw + 60) + " " + (cy - r) + " L" + (xw + 130) + " " + (cy - r) +
        " L" + (xw + 130) + " " + (cy + r) + " L" + (xw + 60) + " " + (cy + r) + " L" + xw + " " + (cy + r * 1.6) + " Z";
      SK.text(R.insetT, "плавное поджатие: сжатия почти нет, потери малы");
    }
    SK.set(R.insetShape, { d: shape });
    SK.set(R.insetJet, { d: jet });
    SK.text(R.insetV, "μ = " + U.fmt(m.mu, 3) + "   ε = " + U.fmt(m.eps, 2) + "   φ = " + U.fmt(m.phi, 2));
  }

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "coef", title: "Коэффициенты насадков и расход при текущем напоре", h: 300 },
    { id: "empty", title: "Опорожнение сосуда", h: 300 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var f = U.fitCanvas(ui.canvas("coef"));
    var d = st.d / 1000, A = Hydro.area(d);
    var items = Hydro.NOZZLES.map(function (nz) {
      var q = nz.eps * nz.phi * A * Math.sqrt(2 * Hydro.G * Math.max(0, m.H)) * 1000;
      return { y: q, color: nz.id === st.kind ? U.css("--accent") : U.css("--water"), label: shortName(nz.id) };
    });
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: 1, y0: 0, y1: Plot.niceMax(Math.max.apply(null, items.map(function (i) { return i.y; })) * 1.15 || 1),
      yLabel: "расход, л/с", noXLabels: true, pad: { l: 46, r: 14, t: 14, b: 50 }
    });
    Plot.bars(p, items, 0.6);
    Plot.legend(p, [{ color: U.css("--accent"), text: "выбранный насадок: μ = " + U.fmt(m.mu, 3) + ", Q = " + U.fmt(m.Q * 1000, 2) + " л/с" }]);

    /* Опорожнение: теоретическая кривая H(t) и точки модели. */
    var f2 = U.fitCanvas(ui.canvas("empty"));
    var mu = m.mu, k = mu * A * Math.sqrt(2 * Hydro.G) / Math.max(st.Sves, 0.01);
    var tE = 2 * Math.sqrt(Math.max(st.H0, 0)) / Math.max(k, 1e-9);
    var theo = [], i2;
    for (i2 = 0; i2 <= 80; i2++) {
      var tt = tE * i2 / 80;
      var hh = Math.pow(Math.max(0, Math.sqrt(st.H0) - k * tt / 2), 2);
      theo.push([tt, hh]);
    }
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: Math.max(tE * 1.05, 1), y0: 0, y1: Plot.niceMax(st.H0 * 1.1),
      xLabel: "время, с", yLabel: "напор над отверстием, м"
    });
    Plot.clip(p2);
    Plot.line(p2, theo, { color: U.css("--muted"), width: 1.6, dash: [6, 4] });
    Plot.line(p2, hist.map(function (q) { return [q[0], q[1]]; }), { color: U.css("--water"), width: 2.2 });
    Plot.dot(p2, S.t, m.H, 4.5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--muted"), text: "формула t = 2·S·(√H₁ − √H₂)/(μ·A·√2g): полное опорожнение за " + U.fmtTime(tE), dash: [6, 4] },
      { color: U.css("--water"), text: st.steady ? "стенд (напор поддерживается)" : "стенд" }
    ]);
  }

  function shortName(id) {
    return { hole: "отверстие", cyl: "цилиндр.", borda: "Борда", conv: "сходящ.", cono: "коноид.", div: "расходящ." }[id] || id;
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state;
    return [
      { n: "Напор над отверстием H", v: U.fmt(m.H, 3) + " м" },
      { n: "Площадь отверстия A", v: U.fmt(m.A * 1e6, 0) + " мм²" },
      { h: "Коэффициенты" },
      { n: "Сжатие ε", v: U.fmt(m.eps, 3) },
      { n: "Скорость φ", v: U.fmt(m.phi, 3) },
      { n: "Расход μ = ε·φ", v: U.fmt(m.mu, 3), cls: "good" },
      { n: "Сопротивление ζ", v: U.fmt(m.n.zeta, 2) },
      { h: "Что получилось" },
      { n: "Идеальная скорость √(2gH)", v: U.fmt(m.vIdeal, 2) + " м/с", cls: "sub" },
      { n: "Действительная скорость", v: U.fmt(m.v, 2) + " м/с" },
      { n: "Расход Q", v: U.fmt(m.Q * 1000, 3) + " л/с (" + U.fmt(m.Q * 3600, 2) + " м³/ч)" },
      { n: "Потери напора в насадке", v: U.fmt(m.hLoss, 3) + " м" },
      { n: "Дальность струи по полу", v: U.fmt(m.range, 2) + " м" },
      { n: "Вакуум внутри насадка", v: m.hvac > 0.01 ? U.fmt(m.hvac, 2) + " м вод. ст." : "—", cls: m.hvac > 7 ? "bad" : (m.hvac > 0.01 ? "warn" : "") },
      { n: "Налито в мерный бак", v: U.fmt(volume, 1) + " л", cls: "sub" },
      { n: st.steady ? "Опорожнение (если отключить подпитку)" : "До полного опорожнения", v: U.fmtTime(m.tEmpty), cls: "sub" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [], hole = Hydro.nozzleById("hole");
    if (m.H <= 0.002) {
      out.push({ lvl: "info", text: "Сосуд пуст, истечения нет. Включите подпитку (галочка «Поддерживать уровень») или нажмите «Сброс»." });
      return out;
    }
    out.push({
      lvl: "info",
      text: "Скорость истечения по Торричелли была бы " + U.fmt(m.vIdeal, 2) + " м/с — столько же, сколько наберёт камень, падая с высоты " + U.fmt(m.H, 2) +
        " м. Действительная меньше в φ = " + U.fmt(m.phi, 2) + " раз: часть напора съели трение и вихри."
    });
    if (st.kind === "hole") {
      out.push({
        lvl: "info",
        text: "Струя за острой кромкой <b>сжимается</b>: частицы подходят к отверстию со всех сторон и не могут повернуть мгновенно. Сжатое сечение примерно в половине диаметра от стенки, его площадь ε = 0,64 от отверстия. Отсюда μ = 0,64·0,97 = 0,62 — классическое число."
      });
    }
    if (st.kind === "cyl" && !m.broken) {
      out.push({
        lvl: "good",
        text: "Насадок даёт расход в " + U.fmt(m.mu / (hole.eps * hole.phi), 2) + " раза больше, чем то же отверстие без него, хотя площадь та же. Внутри струя сначала сжимается, а потом снова прилипает к стенкам; в месте сжатия стоит вакуум " +
          U.fmt(m.hvac, 2) + " м, и он подсасывает воду наружу."
      });
    }
    if (m.broken) {
      out.push({
        lvl: "bad",
        text: "<b>Срыв вакуума.</b> При напоре " + U.fmt(m.H, 2) + " м разрежение в насадке достигло бы " + U.fmt(0.75 * m.H, 2) +
          " м, а это ниже давления насыщенного пара. Вода вскипает, струя отрывается от стенок — и насадок сразу теряет своё преимущество: μ падает до 0,62. Практический предел для цилиндрического насадка — напор около 9…10 м."
      });
    }
    if (st.kind === "borda") {
      out.push({ lvl: "info", text: "Насадок Борда — единственный случай, где сжатие можно посчитать точно из теоремы об изменении количества движения: ε = 0,5. Реально получается около 0,52…0,53." });
    }
    if (st.kind === "conv") {
      out.push({ lvl: "good", text: "Конически сходящийся насадок даёт и хороший расход (μ = " + U.fmt(m.mu, 2) + "), и высокую скорость (φ = " + U.fmt(m.phi, 2) + "). Отсюда дальность струи " + U.fmt(m.range, 2) + " м — больше, чем у любого другого при том же напоре. Именно так делают пожарные стволы, гидромониторы и сопла фонтанов." });
    }
    if (st.kind === "div") {
      out.push({ lvl: "info", text: "Конически расходящийся насадок — это диффузор: он гасит скорость (всего " + U.fmt(m.v, 2) + " м/с), зато пропускает много воды и создаёт сильное разрежение в горле. На этом принципе работают эжекторы, дозаторы реагентов и водоструйные насосы." });
    }
    if (!st.steady) {
      out.push({
        lvl: "info",
        text: "Подпитка отключена: напор падает, и расход падает вместе с ним, но медленнее — как √H. Поэтому опорожнение затягивается: полное время вдвое больше, чем если бы всё время держался начальный расход."
      });
    }
    out.push({
      lvl: "info",
      text: "Дальность струи зависит не от расхода, а от скорости: " + U.fmt(m.range, 2) + " м при высоте отверстия " + U.fmt(st.zHole, 2) +
        " м. Формула та же, что у брошенного горизонтально камня: x = v·√(2z/g) = 2φ·√(H·z)."
    });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Отверстие и насадок: та же дырка, разный расход", tag: "★ главный",
      preset: { kind: "hole", d: 20, H0: 1.6, steady: true, zHole: 0.35 },
      steps: ["Запишите расход для отверстия в тонкой стенке.", "Переключите на внешний цилиндрический насадок.", "Сравните расход, скорость и дальность струи."],
      watch: ["Расход вырос примерно на треть: μ с 0,62 до 0,82.", "Скорость, наоборот, упала: φ с 0,97 до 0,82 — струя летит ближе.", "Во вставке появился вакуум внутри насадка."],
      why: "Насадок убирает сжатие струи (ε = 1), поэтому площадь работает полностью. Но внутри появляются потери на вихри в зоне сжатия, и скорость падает. Насадок выигрывает расходом, отверстие — скоростью."
    },
    {
      title: "2. Сорвать вакуум", tag: "★ эффект",
      preset: { kind: "cyl", d: 20, H0: 3, steady: true, zHole: 0.35 },
      speed: 1,
      steps: ["Цилиндрический насадок, напор 3 м — вакуумметр показывает 2,25 м.", "Поднимайте напор: 6, 9, 12 м.", "Следите за вакуумметром и за расходом."],
      watch: ["Вакуум растёт как 0,75·H.", "Около 13…14 м напора он доходит до давления насыщенного пара.", "Расход скачком падает: μ возвращается к 0,62, как у простого отверстия."],
      why: "Вакуум в насадке не может быть глубже полного вакуума, а на деле — глубже давления насыщенного пара. Как только вода в зоне сжатия вскипает, струя отрывается от стенок и насадок перестаёт работать. Нагрейте воду — предел наступит раньше: у горячей воды давление пара выше."
    },
    {
      title: "3. Кто дальше бьёт", tag: "дальность",
      preset: { kind: "conv", d: 16, H0: 4, steady: true, zHole: 0.9 },
      steps: ["Отверстие поднято на 0,9 м над полом, напор 4 м.", "Переберите все насадки подряд.", "Записывайте дальность струи."],
      watch: ["Коноидальный и конически сходящийся — самые дальнобойные.", "Расходящийся почти не бьёт, зато льёт.", "Дальность ~ φ, а расход ~ μ — это разные вещи."],
      why: "Для пожарного ствола важна дальность и компактность струи, значит, нужен большой φ. Для водосброса или донного выпуска важна пропускная способность, значит, большой μ. Конически сходящийся насадок — компромисс, поэтому он и стал стандартом для стволов."
    },
    {
      title: "4. Опорожнить сосуд", tag: "время",
      preset: { kind: "hole", d: 25, H0: 2, steady: false, Sves: 0.5, zHole: 0.2 },
      speed: 4,
      steps: ["Подпитка отключена, сосуд 0,5 м² с напором 2 м.", "Смотрите на нижний график: точки стенда и формула.", "Меняйте диаметр отверстия и площадь сосуда."],
      watch: ["Кривая H(t) — парабола, а не прямая: расход падает вместе с напором.", "Время опорожнения обратно пропорционально площади отверстия.", "Точки стенда ложатся ровно на формулу — численная схема сходится к аналитике."],
      why: "t = 2S(√H₁ − √H₂)/(μA√2g). Двойка в числителе означает: опорожнение идёт вдвое дольше, чем если бы весь объём вытек при начальном расходе. Эта же формула считает время опорожнения резервуаров, бассейнов и отстойников."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Три коэффициента</h3>' +
    '<p class="formula">ε = A<sub>сж</sub>/A — сжатие струи<br>φ = v/√(2gH) — скорость<br>μ = ε·φ — расход</p>' +
    "<p>Формула Торричелли v = √(2gH) описывает идеальную жидкость: вся потенциальная энергия превращается в кинетическую. Реальная струя и медленнее, и тоньше отверстия — отсюда два поправочных множителя.</p>" +
    "<p>Связь коэффициентов: φ = 1/√(1 + ζ), где ζ — коэффициент сопротивления насадка. У отверстия ζ = 0,06, у цилиндрического насадка 0,5.</p></section>" +

    '<section class="card txt"><h3>Таблица</h3>' +
    '<table class="tbl"><tr><th>Тип</th><th>ε</th><th>φ</th><th>μ</th></tr>' +
    Hydro.NOZZLES.map(function (n) {
      return "<tr><td>" + shortName(n.id) + "</td><td>" + U.fmt(n.eps, 2) + "</td><td>" + U.fmt(n.phi, 2) + "</td><td>" + U.fmt(n.eps * n.phi, 2) + "</td></tr>";
    }).join("") + "</table>" +
    "<p class=\"muted small\">Значения для больших напоров и чисел Рейнольдса выше 10⁵. При малых напорах и вязких жидкостях коэффициенты заметно меняются.</p></section>" +

    '<section class="card txt"><h3>Почему насадок работает</h3>' +
    "<p>Струя, войдя в короткую трубку, сначала сжимается точно так же, как при истечении из отверстия. Но дальше она снова расширяется и прилипает к стенкам. В кольцевом пространстве вокруг сжатого сечения вода крутится в вихре, и там устанавливается пониженное давление.</p>" +
    '<p class="formula">h<sub>вак</sub> ≈ 0,75·H</p>' +
    "<p>Этот вакуум добавляется к напору: на выходное сечение действует перепад больше, чем H. Поэтому расход растёт, хотя потерь стало больше. Длина насадка должна быть около трёх диаметров: короче — струя не успеет прилипнуть, длиннее — начнут расти потери по длине.</p></section>" +

    '<section class="card txt"><h3>Где это встречается</h3>' +
    "<ul><li><b>Пожарные стволы и гидромониторы</b> — конически сходящиеся насадки.</li>" +
    "<li><b>Спринклерные оросители</b> — расход считают по той же формуле Q = μA√(2gH), только записывают её как Q = K√P.</li>" +
    "<li><b>Водомерные и водосливные устройства</b>, донные выпуски резервуаров.</li>" +
    "<li><b>Эжекторы и водоструйные насосы</b> — расходящийся насадок и вакуум в горле.</li>" +
    "<li><b>Расчёт опорожнения</b> бассейнов, отстойников, аварийного сброса.</li></ul>" +
    "<p>Кстати, отверстие «в тонкой стенке» — это когда толщина стенки меньше полутора диаметров. Толще — и оно уже работает как насадок, с другим коэффициентом.</p></section>";

  Lab.register(S);
})();
