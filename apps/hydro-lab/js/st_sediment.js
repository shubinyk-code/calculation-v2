/* Стенд 15. Самоочищающая скорость: транспорт песка по лотку.

   В лоток вместе со стоком поступает песок. Будет он унесён или ляжет на дно,
   решает касательное напряжение на стенке:
       τ = ρ·g·R·i,
   а порог начала движения — число Шильдса (аппроксимация Соулсби).
   Транспорт влекомых наносов считается по Мейеру-Петеру — Мюллеру:
       q* = 8·(τ* − τ*кр)^1,5,  q = q*·ρs·√(Δ·g·d³).

   Слой наносов на дне уменьшает сечение, поток разгоняется, τ растёт — и рано
   или поздно устанавливается равновесие. Именно поэтому труба с недостаточным
   уклоном не зарастает до конца, а работает «полузаиленной». */
(function () {
  "use strict";

  var W = 1180, HH = 430;
  var X0 = 70, X1 = 830;
  var RHO_S = 2650;                     // плотность песка, кг/м³
  var POR = 0.4;                        // пористость отложений

  var S = {
    id: "sediment", group: "sewer",
    title: "Самоочищающая скорость",
    lead: "Песок в лотке: при малом уклоне он ложится на дно, слой растёт, поток разгоняется — и всё останавливается в равновесии. Виден и порог начала движения, и суточная промывка утренним пиком.",
    hint: "Слой на дне — отложения. Скорость модели ×60 и ×600 — чтобы увидеть, как он растёт за часы.",
    vis: { kind: "svg" },
    speeds: [1, 60, 600],
    speed0: 60,
    maxStep: 2
  };

  S.defaults = function () {
    return {
      d: 200,           // диаметр, мм
      slope: 5,         // уклон, ‰
      rough: "concrete",
      Q: 6,             // расход, л/с
      d50: 0.35,        // крупность песка, мм
      coh: 7,           // во сколько раз реальный осадок «держится» крепче чистого песка
      conc: 150,        // концентрация взвеси, мг/л
      L: 50,            // длина расчётного участка, м
      daily: false      // суточная неравномерность
    };
  };

  S.fields = [
    { title: "Поток", open: true, fields: [
      { k: "Q", t: "range", l: "Расход", u: "л/с", min: 0.2, max: 60, step: 0.2, d: 1 },
      { k: "daily", t: "check", l: "Суточная неравномерность (ночь — утренний пик)",
        hint: "Ночью расход падает втрое, утром — пик. Классическая картина: за ночь намывает, утром промывает." },
      { k: "slope", t: "range", l: "Уклон", u: "‰", min: 0.5, max: 50, step: 0.5, d: 1 },
      { k: "d", t: "range", l: "Диаметр", u: "мм", min: 100, max: 800, step: 10, d: 0 },
      { k: "rough", t: "select", l: "Материал", opts: Hydro.MANNING.map(function (x) { return [x.id, x.name]; }) }
    ] },
    { title: "Наносы", open: true, fields: [
      { k: "d50", t: "range", l: "Крупность песка d₅₀", u: "мм", min: 0.05, max: 3, step: 0.05, d: 2,
        hint: "Мелкий песок 0,1…0,25 мм, средний 0,25…0,5, крупный 0,5…2 мм." },
      { k: "coh", t: "select", l: "Что лежит на дне", opts: [
        [1, "чистый промытый песок (чистая теория Шильдса)"],
        [7, "бытовой осадок: песок с органикой и жиром"],
        [15, "слежавшийся ил"]
      ], hint: "Чистая песчинка трогается при 0,2 Па, а склеенный органикой осадок держится до 1,5…3 Па. Отсюда и нормативные скорости с запасом." },
      { k: "conc", t: "range", l: "Концентрация взвеси", u: "мг/л", min: 0, max: 800, step: 10, d: 0 },
      { k: "L", t: "range", l: "Длина расчётного участка", u: "м", min: 10, max: 300, step: 10, d: 0 },
      { t: "custom", k: "conc", render: function () {
        return '<button type="button" data-act="clean">Прочистить лоток</button>';
      }, onClick: function () { m.yb = 0; } }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = { yb: 0 };

  /* Сечение потока над слоем наносов: круг минус нижний сегмент. */
  function flowGeom(d, yb, yw) {
    var gw = Hydro.circGeom(d, U.clamp(yw, 1e-6, 1));
    var A = gw.A, P = gw.P, Bbed = 0;
    if (yb > 1e-5) {
      var gb = Hydro.circGeom(d, yb);
      A = gw.A - gb.A;
      P = (gw.P - gb.P) + gb.B;
      Bbed = gb.B;
    }
    return { A: Math.max(A, 1e-9), P: Math.max(P, 1e-9), R: Math.max(A, 1e-9) / Math.max(P, 1e-9), B: gw.B, Bbed: Bbed };
  }

  function depthOver(st, Q, yb) {
    var d = st.d / 1000, n = Hydro.manningById(st.rough).n, i = st.slope / 1000;
    if (Q <= 1e-7) return yb;
    var f = function (yw) {
      var g = flowGeom(d, yb, yw);
      return g.A * Hydro.manningV(n, g.R, i) - Q;
    };
    var top = Math.min(0.95, yb + 0.95 * (1 - yb));
    if (f(top) < 0) return top;
    return U.bisect(f, yb + 1e-5, top, 50);
  }

  function inflowQ(st) {
    if (!st.daily) return st.Q / 1000;
    /* Сутки за 24 «часа» модели: ночной минимум и утренний пик. */
    var hour = (S.t / 3600) % 24;
    var k = 0.35 + 0.65 * Math.exp(-Math.pow((hour - 8) / 2.2, 2)) +
      0.45 * Math.exp(-Math.pow((hour - 20) / 3.0, 2)) + 0.25 * Math.exp(-Math.pow((hour - 13) / 3.5, 2));
    return st.Q / 1000 * U.clamp(k, 0.2, 2);
  }

  function compute(st, dt) {
    var d = st.d / 1000, n = Hydro.manningById(st.rough).n, i = st.slope / 1000;
    var Q = inflowQ(st);
    var yb = U.clamp(m.yb, 0, 0.7);
    var yw = depthOver(st, Q, yb);
    var g = flowGeom(d, yb, yw);
    var v = Q / g.A;
    var tau = Hydro.shear(U.rho(15), g.R, i);
    var dp = st.d50 / 1000;
    var tauC = Hydro.shieldsCrit(dp, RHO_S, U.rho(15), U.nu(15)) * (st.coh || 1);
    var w = Hydro.settling(dp, RHO_S, U.rho(15), U.nu(15));

    /* Мейер-Петер — Мюллер: удельный расход влекомых наносов, кг/(с·м). */
    var Delta = RHO_S / U.rho(15) - 1;
    var tauStar = tau / ((RHO_S - U.rho(15)) * Hydro.G * dp);
    var tauStarC = tauC / ((RHO_S - U.rho(15)) * Hydro.G * dp);
    var qStar = tauStar > tauStarC ? 8 * Math.pow(tauStar - tauStarC, 1.5) : 0;
    var width = Math.max(g.Bbed > 1e-4 ? g.Bbed : g.B, 1e-4);
    var Gout = qStar * RHO_S * Math.sqrt(Delta * Hydro.G * dp * dp * dp) * width;   // кг/с
    var Gin = st.conc * (Q * 1000) / 1e6;                                            // кг/с

    if (dt > 0) {
      var dAdt = (Gin - Gout) / (RHO_S * (1 - POR) * Math.max(st.L, 1));              // м²/с прироста площади слоя
      var Bb = Math.max(g.Bbed > 1e-4 ? g.Bbed : g.B, 1e-4);
      m.yb = U.clamp(yb + dAdt / (Bb * d) * dt, 0, 0.7);
    }

    var vmin = Hydro.selfCleanV(st.d);
    m.now = {
      Q: Q, yw: yw, yb: yb, h: (yw - yb) * d, v: v, tau: tau, tauC: tauC, w: w,
      Gin: Gin, Gout: Gout, vmin: vmin, g: g,
      tauStar: tauStar, tauStarC: tauStarC,
      moving: tau > tauC,
      hourly: st.daily ? (S.t / 3600) % 24 : null,
      depMm: m.yb * st.d
    };
    /* Равновесная толщина слоя: при ней вынос равен поступлению. */
    m.eq = equilibrium(st, Q, Gin);
  }

  function equilibrium(st, Q, Gin) {
    var d = st.d / 1000, dp = st.d50 / 1000, i = st.slope / 1000;
    var Delta = RHO_S / U.rho(15) - 1;
    var f = function (yb) {
      var yw = depthOver(st, Q, yb);
      var g = flowGeom(d, yb, yw);
      var tau = Hydro.shear(U.rho(15), g.R, i);
      var tS = tau / ((RHO_S - U.rho(15)) * Hydro.G * dp);
      var tSc = Hydro.shieldsCrit(dp, RHO_S, U.rho(15), U.nu(15)) * (st.coh || 1) / ((RHO_S - U.rho(15)) * Hydro.G * dp);
      var qs = tS > tSc ? 8 * Math.pow(tS - tSc, 1.5) : 0;
      var width = Math.max(g.Bbed > 1e-4 ? g.Bbed : g.B, 1e-4);
      return qs * RHO_S * Math.sqrt(Delta * Hydro.G * dp * dp * dp) * width - Gin;
    };
    if (Gin <= 1e-12) return 0;
    if (f(0) >= 0) return 0;                       // чистый лоток уносит всё
    if (f(0.69) < 0) return 0.7;                   // не справляется даже заиленный
    return U.bisect(f, 0, 0.69, 40);
  }

  S.reset = function () { m = { yb: 0 }; compute(S.state, 0); };
  S.onChange = function () { compute(S.state, 0); };
  S.tick = function (dt) { compute(S.state, dt); };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "", grains = [], rnd = U.rng(5);
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH);
    var yTop = 110, hPix = 150;
    s += SK.rect(null, X0, yTop, X1 - X0, hPix, "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="2"');
    s += SK.rect("water", X0 + 2, yTop + 40, X1 - X0 - 4, hPix - 42, "", ' fill="var(--water)" opacity="0.35"');
    s += SK.path("bed", "", "", ' fill="var(--sand)" stroke="none"');
    s += SK.g("grains", "", "", "");
    s += SK.txt(null, (X0 + X1) / 2, 88, "cap", "middle", "прозрачный лоток с песком (вид сбоку)");
    s += SK.txt("bedT", (X0 + X1) / 2, 290, "val", "middle", "");

    // --- поперечное сечение
    s += SK.circle(null, 990, 185, 92, "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="3"');
    s += SK.path("crossW", "", "", ' fill="var(--water)" opacity="0.4" stroke="none"');
    s += SK.path("crossB", "", "", ' fill="var(--sand)" stroke="none"');
    s += SK.txt(null, 990, 76, "cap", "middle", "сечение");
    s += SK.txt("crossT", 990, 300, "val", "middle", "");
    s += SK.txt("crossT2", 990, 322, "tiny muted", "middle", "");

    // --- индикаторы
    s += SK.rect(null, X0, 320, 340, 80, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt(null, X0 + 16, 342, "cap", "start", "Касательное напряжение");
    s += SK.txt("tauT", X0 + 16, 368, "val", "start", "");
    s += SK.txt("tauT2", X0 + 16, 390, "tiny muted", "start", "");
    s += SK.rect(null, X0 + 360, 320, 340, 80, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt(null, X0 + 376, 342, "cap", "start", "Баланс наносов");
    s += SK.txt("balT", X0 + 376, 368, "val", "start", "");
    s += SK.txt("balT2", X0 + 376, 390, "tiny muted", "start", "");

    s += SK.txt("hdr", X0, 56, "val", "start", "");
    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["water", "bed", "grains", "bedT", "crossW", "crossB", "crossT", "crossT2",
      "tauT", "tauT2", "balT", "balT2", "hdr"]);
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, n = m.now, i;
    var yTop = 110, hPix = 150, yBot = yTop + hPix;

    var bedPix = n.yb * hPix, watPix = n.yw * hPix;
    var bedPath = "M" + X0 + " " + yBot;
    for (i = 0; i <= 40; i++) {
      var x = X0 + (X1 - X0) * i / 40;
      var wob = bedPix > 2 ? 3 * Math.sin(i * 0.8 + (S.anim || 0) * (n.moving ? 1.5 : 0)) : 0;
      bedPath += " L" + SK.n(x) + " " + SK.n(yBot - bedPix - wob);
    }
    bedPath += " L" + X1 + " " + yBot + " Z";
    SK.set(R.bed, { d: bedPath });
    /* Слой наносов рисуется поверх воды, поэтому воду заливаем до самого дна. */
    SK.set(R.water, { y: yBot - watPix, height: Math.max(1, watPix) });

    /* Песчинки: летят при движении, лежат при осаждении. */
    while (grains.length < 45) grains.push({ x: rnd(), y: rnd(), s: 0.5 + rnd() });
    var gs = "";
    for (i = 0; i < grains.length; i++) {
      var gr = grains[i];
      var speed = n.moving ? n.v * 0.06 * gr.s : 0.002;
      gr.x += speed * 0.016 * 60;
      if (gr.x > 1) gr.x -= 1;
      var gy = yBot - bedPix - 2 - gr.y * Math.max(watPix - bedPix - 4, 2) * (n.moving ? 0.9 : 0.25);
      gs += '<circle cx="' + SK.n(X0 + (X1 - X0) * gr.x) + '" cy="' + SK.n(gy) + '" r="' + SK.n(1.2 + gr.s) +
        '" fill="var(--sand)" opacity="0.9"/>';
    }
    R.grains.innerHTML = gs;

    SK.text(R.bedT, n.depMm > 0.5
      ? "слой наносов " + U.fmt(n.depMm, 0) + " мм (h/d = " + U.fmt(n.yb, 3) + "), равновесный " + U.fmt(m.eq * st.d, 0) + " мм"
      : "дно чистое, равновесный слой " + U.fmt(m.eq * st.d, 0) + " мм");

    /* Сечение. */
    var Rc = 92, cy = 185;
    function seg(yRel) {
      var h = yRel * 2 * Rc, yLine = cy + Rc - h;
      var half = Math.sqrt(Math.max(0, Rc * Rc - Math.pow(yLine - cy, 2)));
      return { path: "M" + SK.n(990 - half) + " " + SK.n(yLine) + " A " + Rc + " " + Rc + " 0 " + (h > Rc ? 1 : 0) + " 0 " + SK.n(990 + half) + " " + SK.n(yLine) + " Z", y: yLine };
    }
    SK.set(R.crossW, { d: n.yw > 0.005 ? seg(n.yw).path : "" });
    SK.set(R.crossB, { d: n.yb > 0.002 ? seg(n.yb).path : "" });
    SK.text(R.crossT, "наполнение " + U.fmt(n.h * 1000, 0) + " мм, слой " + U.fmt(n.depMm, 0) + " мм");
    SK.text(R.crossT2, "живое сечение " + U.fmt(n.g.A * 1e4, 0) + " см², R = " + U.fmt(n.g.R * 1000, 1) + " мм");

    SK.text(R.tauT, U.fmt(n.tau, 2) + " Па при пороге " + U.fmt(n.tauC, 2) + " Па");
    SK.set(R.tauT, { fill: n.moving ? "var(--good)" : "var(--bad)" });
    SK.text(R.tauT2, n.moving ? "песок движется: τ выше критического" : "песок лежит: τ ниже критического");
    SK.text(R.balT, "приходит " + U.fmt(n.Gin * 3600, 2) + " кг/ч, уносится " + U.fmt(n.Gout * 3600, 2) + " кг/ч");
    SK.set(R.balT, { fill: n.Gout >= n.Gin ? "var(--good)" : "var(--warn)" });
    SK.text(R.balT2, n.Gout >= n.Gin ? "лоток справляется" : "часть песка оседает");

    SK.text(R.hdr, "Расход " + U.fmt(n.Q * 1000, 2) + " л/с · скорость " + U.fmt(n.v, 2) + " м/с (минимальная по СП " +
      U.fmt(n.vmin, 2) + ") · уклон " + U.fmt(st.slope, 1) + " ‰" + (n.hourly !== null ? " · " + U.fmt(n.hourly, 1) + " ч суток" : ""));

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "tau", title: "Скорость и касательное напряжение в зависимости от расхода", h: 330 },
    { id: "bed", title: "Равновесный слой наносов", h: 330 }
  ];

  function drawCharts(ui) {
    var st = S.state, n = m.now, i;
    var d = st.d / 1000, nn = Hydro.manningById(st.rough).n, ii = st.slope / 1000;
    var Qmax = Math.max(st.Q * 2.5, 5);

    var f = U.fitCanvas(ui.canvas("tau"));
    var vPts = [], tPts = [];
    for (i = 1; i <= 80; i++) {
      var q = Qmax * i / 80 / 1000;
      var yw = Hydro.normalDepth(q, d, nn, ii);
      var g = Hydro.circGeom(d, Math.max(yw, 1e-4));
      vPts.push([q * 1000, q / g.A]);
      tPts.push([q * 1000, Hydro.shear(U.rho(15), g.R, ii)]);
    }
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: Qmax, y0: 0, y1: Plot.niceMax(Math.max(vPts[79][1], n.vmin * 1.3) * 1.1),
      xLabel: "расход, л/с", yLabel: "скорость, м/с",
      y2: [0, Plot.niceMax(Math.max(tPts[79][1], n.tauC * 2) * 1.1)], y2Label: "τ, Па"
    });
    Plot.clip(p);
    Plot.line(p, vPts, { color: U.css("--water"), width: 2.4 });
    Plot.line(p, tPts, { color: U.css("--p2"), width: 1.8, dash: [6, 4] }, true);
    Plot.unclip(p);
    Plot.hline(p, n.vmin, { color: U.css("--good"), dash: [5, 4], width: 1.8 });
    Plot.dot(p, n.Q * 1000, n.v, 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.legend(p, [
      { color: U.css("--water"), text: "скорость в чистом лотке" },
      { color: U.css("--p2"), text: "касательное напряжение (правая ось)", dash: [6, 4] },
      { color: U.css("--good"), text: "минимальная скорость по СП: " + U.fmt(n.vmin, 2) + " м/с", dash: [5, 4] }
    ]);

    /* Равновесный слой в зависимости от уклона. */
    var f2 = U.fitCanvas(ui.canvas("bed"));
    var pts = [], save = st.slope;
    for (i = 1; i <= 60; i++) {
      var sl = 50 * i / 60;
      st.slope = sl;
      var eq = equilibrium(st, st.Q / 1000, n.Gin);
      pts.push([sl, eq * st.d]);
    }
    st.slope = save;
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 50, y0: 0, y1: Plot.niceMax(Math.max(pts[0][1], 10)),
      xLabel: "уклон, ‰", yLabel: "равновесный слой наносов, мм"
    });
    Plot.clip(p2);
    Plot.line(p2, pts, { color: U.css("--warn-hex"), width: 2.4 });
    Plot.dot(p2, st.slope, m.eq * st.d, 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--warn-hex"), text: "слой, при котором вынос равен поступлению" },
      { color: U.css("--accent"), text: "текущий уклон", dot: true }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, n = m.now;
    return [
      { n: "Расход", v: U.fmt(n.Q * 1000, 2) + " л/с" },
      { n: "Наполнение над слоем", v: U.fmt(n.h * 1000, 0) + " мм" },
      { n: "Скорость", v: U.fmt(n.v, 2) + " м/с", cls: n.v >= n.vmin ? "good" : "bad" },
      { n: "Минимальная по СП", v: U.fmt(n.vmin, 2) + " м/с", cls: "sub" },
      { n: "Гидравлический радиус", v: U.fmt(n.g.R * 1000, 1) + " мм" },
      { h: "Наносы" },
      { n: "Крупность d₅₀", v: U.fmt(st.d50, 2) + " мм" },
      { n: "Гидравлическая крупность", v: U.fmt(n.w * 1000, 1) + " мм/с" },
      { n: "τ на стенке", v: U.fmt(n.tau, 2) + " Па", cls: n.moving ? "good" : "bad" },
      { n: "τ критическое (Шильдс)", v: U.fmt(n.tauC, 2) + " Па" },
      { n: "Число Шильдса τ*", v: U.fmt(n.tauStar, 3) + " при пороге " + U.fmt(n.tauStarC, 3) },
      { h: "Баланс" },
      { n: "Поступает песка", v: U.fmt(n.Gin * 3600, 2) + " кг/ч" },
      { n: "Уносится", v: U.fmt(n.Gout * 3600, 2) + " кг/ч", cls: n.Gout >= n.Gin ? "good" : "warn" },
      { n: "Слой на дне", v: U.fmt(n.depMm, 1) + " мм (h/d = " + U.fmt(n.yb, 3) + ")",
        cls: n.yb > 0.15 ? "bad" : (n.yb > 0.03 ? "warn" : "good") },
      { n: "Равновесный слой", v: U.fmt(m.eq * st.d, 1) + " мм" },
      { n: "Потеря живого сечения", v: U.fmt(100 * (1 - n.g.A / Hydro.area(st.d / 1000)), 0) + " %", cls: "sub" }
    ];
  };

  S.explain = function () {
    var st = S.state, n = m.now, out = [];
    out.push({
      lvl: n.moving ? "good" : "bad",
      text: "Касательное напряжение на стенке τ = ρ·g·R·i = <b>" + U.fmt(n.tau, 2) + " Па</b> при критическом " + U.fmt(n.tauC, 2) +
        " Па для песка " + U.fmt(st.d50, 2) + " мм. " + (n.moving
          ? "Песок движется — лоток самоочищается."
          : "Песка не сдвинуть: он ложится на дно и остаётся там до более сильного потока.")
    });
    out.push({
      lvl: "info",
      text: "Скорость " + U.fmt(n.v, 2) + " м/с при нормативной минимальной " + U.fmt(n.vmin, 2) + " м/с для d" + U.fmt(st.d, 0) +
        " (СП 32.13330, табл. 5). Норматив по скорости — упрощение: настоящий критерий — именно касательное напряжение, ведь для ила хватает 1 Па, а для гравия и 10 мало."
    });
    if (n.depMm > 1) {
      out.push({
        lvl: n.yb > 0.15 ? "bad" : "warn",
        text: "На дне лежит " + U.fmt(n.depMm, 0) + " мм наносов — это " + U.fmt(100 * (1 - n.g.A / Hydro.area(st.d / 1000)), 0) +
          " % живого сечения. Заметьте, что слой не растёт бесконечно: чем он толще, тем уже сечение, тем быстрее поток и тем больше τ. Равновесие наступает на " +
          U.fmt(m.eq * st.d, 0) + " мм."
      });
    }
    if (n.Gout < n.Gin && n.Gin > 0) {
      out.push({ lvl: "warn", text: "Поступает " + U.fmt(n.Gin * 3600, 2) + " кг/ч песка, уносится " + U.fmt(n.Gout * 3600, 2) + " кг/ч — разница оседает. Слой будет расти, пока поток не разгонится достаточно." });
    } else if (n.Gin > 0) {
      out.push({ lvl: "good", text: "Вынос не меньше поступления: весь песок уходит транзитом. Именно такой режим и называют самоочищающим." });
    }
    if (st.daily) {
      out.push({
        lvl: "info",
        text: "Суточная неравномерность: ночью расход падает, τ уходит ниже критического, и песок ложится. Утренний пик поднимает τ и промывает лоток. Так и работает настоящая сеть — она не «всегда чистая», а «чистится дважды в сутки»."
      });
    }
    if (st.d50 < 0.12) {
      out.push({ lvl: "info", text: "Мелкие частицы (" + U.fmt(st.d50, 2) + " мм) держатся во взвеси: их гидравлическая крупность всего " + U.fmt(n.w * 1000, 1) + " мм/с, а пульсации в турбулентном потоке легко поднимают их со дна. Такая взвесь уходит на очистные, а на дне остаётся песок покрупнее." });
    }
    if (st.d50 > 1.2) {
      out.push({ lvl: "warn", text: "Крупный песок " + U.fmt(st.d50, 2) + " мм требует τ = " + U.fmt(n.tauC, 2) + " Па — это уже серьёзный уклон. Такие фракции задерживают в песколовках на входе очистных сооружений, а не тащат по сети." });
    }
    if (st.slope < 3) {
      out.push({ lvl: "warn", text: "Уклон " + U.fmt(st.slope, 1) + " ‰ — очень пологий. При больших диаметрах это допустимо (важно не падение на метр, а гидравлический радиус), но при малых расходах такой коллектор будет работать полузаиленным." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Порог начала движения", tag: "★ главный",
      preset: { d: 200, slope: 2, rough: "concrete", Q: 3, d50: 0.35, coh: 7, conc: 150, L: 50, daily: false },
      speed: 60,
      steps: ["Пологий уклон 2 ‰: песок ложится на дно.", "Увеличивайте уклон по полпромилле и следите за τ и порогом.", "Найдите уклон, при котором песок трогается."],
      watch: [
        "Песчинки на картинке начинают двигаться, когда τ переходит порог.",
        "Слой перестаёт расти и начинает размываться.",
        "Скорость при этом может быть ещё ниже нормативной — норматив с запасом."
      ],
      why: "Шильдс в 1936 году показал, что начало движения определяется безразмерным числом τ* = τ/((ρs−ρ)g·d). Для песка оно около 0,05. Отсюда критическое напряжение для песка 0,3 мм — примерно 0,2 Па; практические нормы для бытовых стоков берут 1,5…2 Па с запасом на слипшуюся органику."
    },
    {
      title: "2. Слой сам себя ограничивает", tag: "★ равновесие",
      preset: { d: 300, slope: 1.5, rough: "concrete", Q: 8, d50: 0.4, conc: 300, L: 50, daily: false },
      speed: 600,
      steps: ["Малый уклон и много песка: слой начинает расти.", "Дождитесь, пока он перестанет расти (скорость модели ×600).", "Сравните итог с «равновесным слоем» в показаниях."],
      watch: [
        "Рост слоя замедляется по мере его нарастания.",
        "Скорость потока растёт: сечение уменьшилось.",
        "В равновесии вынос ровно равен поступлению."
      ],
      why: "Наносы — саморегулирующаяся система. Отложения сужают живое сечение, поток разгоняется, τ растёт, вынос увеличивается. Поэтому заиленный коллектор редко забивается полностью: он находит равновесие и работает с постоянной потерей сечения — незаметно для эксплуатации, но с повышенным риском при залповых расходах."
    },
    {
      title: "3. Утренняя промывка", tag: "★ сутки",
      preset: { d: 200, slope: 4, rough: "concrete", Q: 8, d50: 0.3, conc: 200, L: 50, daily: true },
      speed: 600,
      steps: ["Включена суточная неравномерность. Скорость ×600: сутки проходят за пару минут.", "Смотрите на слой наносов ночью и утром.", "Проследите два-три цикла."],
      watch: [
        "Ночью τ падает ниже критического, слой растёт.",
        "Утренний пик поднимает τ и уносит накопленное.",
        "Слой «дышит» с суточным периодом."
      ],
      why: "Реальная канализация не работает в равномерном режиме. Расчёт ведут по максимальному секундному расходу, но самоочищение обеспечивает именно пик: он должен быть достаточно сильным, чтобы смыть то, что улеглось ночью. Отсюда практика промывных устройств на концевых участках с малым расходом."
    },
    {
      title: "4. Большой диаметр — не всегда лучше", tag: "проект",
      preset: { d: 200, slope: 5, rough: "concrete", Q: 5, d50: 0.35, conc: 150, L: 50, daily: false },
      speed: 60,
      steps: ["При d200 посмотрите скорость и τ.", "Увеличьте диаметр до 300, потом до 500 мм при том же расходе.", "Следите за τ и за равновесным слоем."],
      watch: [
        "Скорость падает, наполнение становится совсем малым.",
        "τ падает — песок перестаёт двигаться.",
        "Равновесный слой растёт."
      ],
      why: "Запас по диаметру в канализации вреден: при малом наполнении гидравлический радиус мал, скорость низкая, и труба заиливается. Поэтому диаметр выбирают не «с запасом», а под расчётный расход — и проверяют по минимальной скорости и наполнению 0,3…0,6."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Что движет наносы</h3>' +
    '<p class="formula">τ = ρ·g·R·i</p>' +
    "<p>Касательное напряжение на стенке — то, чем поток «цепляет» дно. Оно зависит от гидравлического радиуса и уклона, а не от скорости напрямую. Поэтому большой коллектор с малым уклоном может иметь приличную скорость и всё равно заиливаться: R большой, но i мал.</p>" +
    "<p>Практические пороги для бытовых стоков: τ ≥ 1,0…1,5 Па — самоочищение по европейским нормам (ATV-A110); в отечественной практике тот же смысл заложен в таблицу минимальных скоростей.</p></section>" +

    '<section class="card txt"><h3>Число Шильдса</h3>' +
    '<p class="formula">τ* = τ / ((ρ<sub>s</sub> − ρ)·g·d)</p>' +
    "<p>Безразмерное касательное напряжение. Движение начинается, когда τ* превышает критическое значение — от 0,03 для мелкого песка до 0,06 для крупного. Это и есть диаграмма Шильдса.</p>" +
    "<p>Дальше работает формула Мейера-Петера — Мюллера: q* = 8·(τ* − τ*<sub>кр</sub>)^1,5. Транспорт растёт очень круто: чуть выше порога — и наносы уносятся стремительно.</p></section>" +

    '<section class="card txt"><h3>Гидравлическая крупность</h3>' +
    "<p>Скорость свободного осаждения частицы. Для песка 0,2 мм это около 25 мм/с, для 0,5 мм — 70 мм/с, для ила 0,05 мм — меньше 2 мм/с.</p>" +
    "<p>Если вертикальные пульсации в турбулентном потоке сильнее гидравлической крупности, частица держится во взвеси. Отсюда деление: мелочь идёт транзитом во взвеси, средний песок катится по дну, крупный остаётся на месте.</p>" +
    "<p>Эта же величина — основа расчёта песколовок и отстойников: время пребывания подбирают так, чтобы частица успела осесть.</p></section>" +

    '<section class="card txt"><h3>Нормы и практика</h3>' +
    "<ul><li><b>Минимальные скорости</b> (СП 32.13330): 0,7 м/с для d150…250, 0,8 для d300…400, 1,0 для d600…800, 1,5 для больших.</li>" +
    "<li><b>Наполнение</b> не меньше 0,3: при меньшем поток «размазан» и не тащит взвесь.</li>" +
    "<li><b>Минимальные уклоны</b> по правилу 1/d: 0,008 для d160, 0,005 для d200.</li>" +
    "<li><b>Промывные устройства</b> на концевых участках, где расхода не хватает.</li>" +
    "<li><b>Песколовки</b> на входе очистных: то, что сеть донесла, нужно задержать до насосов и отстойников.</li></ul>" +
    "<p>И обратное правило, которое часто забывают: завышенный диаметр в канализации хуже заниженного. Труба должна быть «в меру тесной», чтобы поток её промывал.</p></section>";

  Lab.register(S);
})();
