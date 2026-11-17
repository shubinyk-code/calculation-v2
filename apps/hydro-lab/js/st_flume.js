/* Стенд 13. Прозрачный лоток: наполнение и добегание залпового сброса.

   Равномерное движение — формула Маннинга для частично заполненной круглой трубы:
       v = (1/n)·R^(2/3)·i^(1/2),  Q = A·v,
   геометрия сечения считается через центральный угол θ = 2·arccos(1 − 2h/d).

   Неустановившийся режим — кинематическая волна с дисперсией (схема, эквивалентная
   методу Маскингама — Кюнжа): труба представлена каскадом из N линейных ёмкостей,
   подобранных так, чтобы время добегания и «размазывание» пика совпадали с
   физическими: c = dQ/dA — скорость волны, D = Q/(2·B·i) — коэффициент дисперсии.
   Отсюда и главный вывод стенда: длина влияет на время и на форму пика,
   а наполнение при том же расходе — почти не меняет. */
(function () {
  "use strict";

  var W = 1180, HH = 420;
  var X0 = 70, X1 = 880;
  var NRES = 20;

  var S = {
    id: "flume", group: "sewer", star: true,
    title: "Лоток: наполнение и добегание",
    lead: "Прозрачный лоток с регулируемым уклоном. Наполнение зависит от расхода, диаметра и уклона — и почти не зависит от длины. А вот залповый сброс по дороге запаздывает и расплывается.",
    hint: "Кнопка «Залповый сброс» опрокидывает бак в начало лотка. Смотрите, как волна бежит и как она выглядит на выходе при разных длинах.",
    vis: { kind: "svg" },
    speeds: [0.25, 1, 4],
    maxStep: 0.05
  };

  S.defaults = function () {
    return {
      d: 110,           // диаметр лотка, мм
      slope: 20,        // уклон, ‰
      rough: "pvc",
      Qbase: 1.0,       // постоянный расход, л/с
      L: 200,           // длина трубопровода, м
      pulseV: 60,       // объём залпа, л
      pulseT: 8         // длительность залпа, с
    };
  };

  S.fields = [
    { title: "Лоток", open: true, fields: [
      { k: "Qbase", t: "range", l: "Постоянный расход", u: "л/с", min: 0, max: 20, step: 0.1, d: 2 },
      { k: "d", t: "range", l: "Диаметр", u: "мм", min: 50, max: 500, step: 10, d: 0 },
      { k: "slope", t: "range", l: "Уклон", u: "‰", min: 1, max: 100, step: 0.5, d: 1,
        hint: "Нормативный минимум для d110 — 20 ‰ (1/d), для d160 — 8 ‰." },
      { k: "rough", t: "select", l: "Материал", opts: Hydro.MANNING.map(function (x) { return [x.id, x.name + " (n = " + U.fmt(x.n, 3) + ")"]; }) }
    ] },
    { title: "Залповый сброс", open: true, fields: [
      { k: "L", t: "range", l: "Длина трубопровода", u: "м", min: 10, max: 1500, step: 10, d: 0 },
      { k: "pulseV", t: "range", l: "Объём залпа", u: "л", min: 5, max: 500, step: 5, d: 0,
        hint: "Смыв унитаза — 6 л за 5 с, ванна — 150…200 л за 1…2 мин." },
      { k: "pulseT", t: "range", l: "Длительность залпа", u: "с", min: 2, max: 120, step: 1, d: 0 },
      { t: "custom", k: "pulseV", render: function () {
        return '<button type="button" data-act="pulse" class="primary">Залповый сброс</button> ' +
          '<button type="button" data-act="clear">Очистить графики</button>';
      }, onClick: function (act) { if (act === "pulse") S.pulse(); else S.clearTr(); } }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {}, tr = new Plot.Trend(9000), trT = 0;

  /* Параметры каскада для длины L: время добегания и дисперсия. */
  function cascade(st, L, Qref) {
    var d = st.d / 1000, n = Hydro.manningById(st.rough).n, i = st.slope / 1000;
    var Q = Math.max(Qref, 0.05) / 1000;
    var y = Hydro.normalDepth(Q, d, n, i);
    var g = Hydro.circGeom(d, Math.max(y, 0.02));
    var v = Q / g.A;
    var c = 1.35 * v;                                   // скорость кинематической волны
    var T = L / Math.max(c, 0.05);                      // время добегания
    var D = Q / (2 * g.B * Math.max(i, 1e-5));          // коэффициент дисперсии (Хаями)
    var sig2 = 2 * D * L / Math.pow(Math.max(c, 0.05), 3);
    var nRes = U.clamp(T * T / Math.max(sig2, 1e-6), 1.2, NRES);
    var K = T / nRes;
    return { T: T, c: c, K: Math.max(K, 0.05), n: nRes, v: v, y: y, sig: Math.sqrt(sig2) };
  }

  function makeChain(st, L, Qref) {
    var cs = cascade(st, L, Qref);
    var N = Math.max(1, Math.round(cs.n));
    var K = cs.T / N;
    return { N: N, K: Math.max(K, 0.05), S: new Array(N), cs: cs, out: Qref / 1000 };
  }

  S.clearTr = function () { tr.clear(); };

  S.reset = function () {
    var st = S.state;
    m = { t: 0, pulse: 0, pulseLeft: 0, chains: {}, Qin: st.Qbase / 1000 };
    ["main", "short", "long"].forEach(function (key) {
      var L = key === "main" ? st.L : (key === "short" ? Math.max(10, st.L / 4) : st.L * 4);
      var ch = makeChain(st, L, st.Qbase);
      for (var i = 0; i < ch.N; i++) ch.S[i] = (st.Qbase / 1000) * ch.K;
      ch.L = L;
      m.chains[key] = ch;
    });
    tr.clear(); trT = 0;
    steady(st);
  };
  S.onChange = function () { S.reset(); };

  S.pulse = function () {
    var st = S.state;
    m.pulseLeft = st.pulseV / 1000;                     // м³
    m.pulseRate = (st.pulseV / 1000) / Math.max(st.pulseT, 0.5);
  };

  /* Равномерный режим при текущем постоянном расходе. */
  function steady(st) {
    var d = st.d / 1000, n = Hydro.manningById(st.rough).n, i = st.slope / 1000;
    var Q = st.Qbase / 1000;
    var y = Hydro.normalDepth(Q, d, n, i);
    var g = Hydro.circGeom(d, Math.max(y, 1e-4));
    var v = Q > 0 ? Q / g.A : 0;
    var yc = Hydro.criticalDepth(Q, d);
    var Fr = Hydro.froude(Q, d, Math.max(y, 1e-4));
    var tau = Hydro.shear(U.rho(15), g.R, i);
    var vmin = Hydro.selfCleanV(st.d);
    var Qfull = Hydro.manningQ(d, 0.938, n, i);
    m.st = {
      y: y, h: y * d, g: g, v: v, yc: yc, Fr: Fr, tau: tau, vmin: vmin,
      Qfull: Qfull, Q: Q, R: g.R, i: i, n: n, d: d
    };
  }

  S.tick = function (dt) {
    var st = S.state;
    /* Приток: постоянный плюс залп. */
    var qPulse = 0;
    if (m.pulseLeft > 0) {
      qPulse = Math.min(m.pulseRate, m.pulseLeft / dt);
      m.pulseLeft = Math.max(0, m.pulseLeft - qPulse * dt);
    }
    m.Qin = st.Qbase / 1000 + qPulse;

    /* Прогон по каскадам: dS/dt = Qвх − S/K. */
    for (var key in m.chains) {
      var ch = m.chains[key], q = m.Qin;
      for (var i = 0; i < ch.N; i++) {
        var out = ch.S[i] / ch.K;
        ch.S[i] = Math.max(0, ch.S[i] + (q - out) * dt);
        q = out;
      }
      ch.out = q;
    }
    steady(st);
    trT += dt;
    if (trT > 0.5) {
      trT = 0;
      tr.push(S.t, {
        in: m.Qin * 1000,
        main: m.chains.main.out * 1000,
        short: m.chains.short.out * 1000,
        long: m.chains.long.out * 1000
      });
    }
  };

  /* Наполнение в точке x (0…1) основного трубопровода. */
  function depthAt(st, frac) {
    var ch = m.chains.main;
    var idx = U.clamp(Math.floor(frac * ch.N), 0, ch.N - 1);
    var Q = ch.S[idx] / ch.K;
    var d = st.d / 1000, n = Hydro.manningById(st.rough).n, i = st.slope / 1000;
    return { y: Hydro.normalDepth(Q, d, n, i), Q: Q };
  }

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH);
    s += SK.path("pipeTop", "", "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    s += SK.path("pipeBot", "", "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');
    s += SK.path("pipeFill", "", "", ' fill="var(--glass)" stroke="none"');
    s += SK.path("wat", "", "", ' fill="var(--water)" opacity="0.45" stroke="none"');
    s += SK.path("surf", "", "", ' fill="none" stroke="var(--water)" stroke-width="2"');
    s += SK.txt(null, (X0 + X1) / 2, 40, "cap", "middle", "прозрачный лоток (вид сбоку, уклон показан с увеличением)");
    s += SK.txt("inT", X0, 380, "tiny muted", "start", "");
    s += SK.txt("outT", X1, 380, "tiny muted", "end", "");

    // --- поперечное сечение
    s += SK.circle(null, 1010, 190, 92, "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="3"');
    s += SK.path("crossW", "", "", ' fill="var(--water)" opacity="0.45" stroke="none"');
    s += SK.line("critL", 918, 190, 1102, 190, "", ' stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="4 3"');
    s += SK.txt(null, 1010, 72, "cap", "middle", "сечение");
    s += SK.txt("crossT", 1010, 300, "val", "middle", "");
    s += SK.txt("crossT2", 1010, 322, "tiny muted", "middle", "");
    s += SK.txt("crossT3", 1010, 344, "tiny", "middle", "");

    // --- бак залпа
    s += SK.rect(null, 20, 80, 44, 60, "", ' fill="var(--panel)" stroke="var(--casing-dark)" stroke-width="2" rx="3"');
    s += SK.rect("tankW", 22, 100, 40, 38, "", ' fill="var(--water)" opacity="0.5"');
    s += SK.txt(null, 42, 72, "tiny muted", "middle", "залп");

    s += SK.txt("sumT", 70, 400, "val", "start", "");
    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["pipeTop", "pipeBot", "pipeFill", "wat", "surf", "inT", "outT",
      "crossW", "critL", "crossT", "crossT2", "crossT3", "tankW", "sumT"]);
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, i;
    var yTop = 110, drop = U.clamp(st.slope / 1000 * st.L * 4, 20, 160);
    var dPix = U.clamp(st.d * 0.5, 40, 110);

    /* Труба идёт под уклоном; наполнение считается по местному расходу. */
    var N = 60, top = "", bot = [], wat = [], surf = "";
    for (i = 0; i <= N; i++) {
      var f = i / N, x = X0 + (X1 - X0) * f;
      var yb = yTop + drop * f + dPix;                   // лоток (низ трубы)
      var yt = yTop + drop * f;                          // верх трубы
      top += (i ? " L" : "M") + SK.n(x) + " " + SK.n(yt);
      bot.push([x, yb]);
      var dd = depthAt(st, f);
      var hPix = U.clamp(dd.y, 0, 1) * dPix;
      wat.push([x, yb - hPix]);
      surf += (i ? " L" : "M") + SK.n(x) + " " + SK.n(yb - hPix);
    }
    SK.set(R.pipeTop, { d: top });
    SK.set(R.pipeBot, { d: "M" + bot.map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") });
    SK.set(R.pipeFill, {
      d: top + " L" + bot.slice().reverse().map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") + " Z"
    });
    SK.set(R.wat, {
      d: "M" + wat.map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") +
        " L" + bot.slice().reverse().map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") + " Z"
    });
    SK.set(R.surf, { d: surf });

    SK.text(R.inT, "вход: " + U.fmt(m.Qin * 1000, 2) + " л/с");
    SK.text(R.outT, "выход (через " + U.fmt(st.L, 0) + " м): " + U.fmt(m.chains.main.out * 1000, 2) + " л/с");
    SK.set(R.tankW, { height: U.clamp(m.pulseLeft * 1000 / Math.max(st.pulseV, 1), 0, 1) * 38, y: 138 - U.clamp(m.pulseLeft * 1000 / Math.max(st.pulseV, 1), 0, 1) * 38 });

    /* Сечение: заливка сегмента по наполнению на выходе. */
    var qOut = m.chains.main.out;
    var yOut = Hydro.normalDepth(qOut, st.d / 1000, Hydro.manningById(st.rough).n, st.slope / 1000);
    var Rc = 92, hc = yOut * 2 * Rc;
    var yLine = 190 + Rc - hc;
    var halfW = Math.sqrt(Math.max(0, Rc * Rc - Math.pow(yLine - 190, 2)));
    var seg = "M" + SK.n(1010 - halfW) + " " + SK.n(yLine) + " A " + Rc + " " + Rc + " 0 " +
      (hc > Rc ? 1 : 0) + " 0 " + SK.n(1010 + halfW) + " " + SK.n(yLine) + " Z";
    SK.set(R.crossW, { d: hc > 1 ? seg : "" });
    var ycPix = 190 + Rc - m.st.yc * 2 * Rc;
    SK.set(R.critL, { y1: ycPix, y2: ycPix, opacity: m.st.yc > 0.01 ? 0.9 : 0 });
    SK.text(R.crossT, "наполнение h/d = " + U.fmt(yOut, 3));
    SK.text(R.crossT2, "h = " + U.fmt(yOut * st.d, 0) + " мм из " + U.fmt(st.d, 0) + " мм");
    SK.text(R.crossT3, m.st.Fr > 1 ? "бурный поток, Fr = " + U.fmt(m.st.Fr, 2) : "спокойный поток, Fr = " + U.fmt(m.st.Fr, 2));
    SK.set(R.crossT3, { fill: m.st.Fr > 1 ? "var(--warn)" : "var(--ink)" });

    var cs = m.chains.main.cs;
    SK.text(R.sumT, "скорость " + U.fmt(m.st.v, 2) + " м/с · время добегания " + U.fmtTime(cs.T) +
      " · скорость волны " + U.fmt(cs.c, 2) + " м/с · τ = " + U.fmt(m.st.tau, 2) + " Па");

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "hydro", title: "Залповый сброс на выходе при разной длине", h: 330 },
    { id: "fill", title: "Наполнение и скорость в зависимости от расхода", h: 330 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var win = U.clamp(m.chains.long.cs.T * 2.5 + st.pulseT * 3, 60, 3000);
    var f = U.fitCanvas(ui.canvas("hydro"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: Math.max(0, S.t - win), x1: Math.max(win, S.t), y0: 0,
      y1: Plot.niceMax(Math.max(st.Qbase + st.pulseV / Math.max(st.pulseT, 1), 1) * 1.15),
      xLabel: "время, с", yLabel: "расход, л/с"
    });
    Plot.clip(p);
    Plot.line(p, tr.series("in", S.t, win), { color: U.css("--muted"), width: 1.6, dash: [4, 3] });
    Plot.line(p, tr.series("short", S.t, win), { color: U.css("--p1"), width: 1.8 });
    Plot.line(p, tr.series("main", S.t, win), { color: U.css("--accent"), width: 2.4 });
    Plot.line(p, tr.series("long", S.t, win), { color: U.css("--p3"), width: 1.8 });
    Plot.unclip(p);
    Plot.legend(p, [
      { color: U.css("--muted"), text: "сброс на входе", dash: [4, 3] },
      { color: U.css("--p1"), text: U.fmt(m.chains.short.L, 0) + " м" },
      { color: U.css("--accent"), text: U.fmt(m.chains.main.L, 0) + " м (стенд)" },
      { color: U.css("--p3"), text: U.fmt(m.chains.long.L, 0) + " м" }
    ]);

    /* Кривая наполнения. */
    var f2 = U.fitCanvas(ui.canvas("fill"));
    var d = st.d / 1000, nn = Hydro.manningById(st.rough).n, ii = st.slope / 1000;
    var Qmax = Hydro.manningQ(d, 0.938, nn, ii) * 1000;
    var fillPts = [], velPts = [], i2;
    for (i2 = 1; i2 <= 100; i2++) {
      var q = Qmax * i2 / 100;
      var y = Hydro.normalDepth(q / 1000, d, nn, ii);
      var g = Hydro.circGeom(d, Math.max(y, 1e-4));
      fillPts.push([q, y]);
      velPts.push([q, (q / 1000) / g.A]);
    }
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: Qmax * 1.05, y0: 0, y1: 1.05,
      xLabel: "расход, л/с", yLabel: "наполнение h/d",
      y2: [0, Math.max(3, Plot.niceMax(velPts[99][1] * 1.2))], y2Label: "скорость, м/с"
    });
    Plot.band(p2, 0, 0.3, U.css("--warn"), 0.10);
    Plot.clip(p2);
    Plot.line(p2, fillPts, { color: U.css("--water"), width: 2.4 });
    Plot.line(p2, velPts, { color: U.css("--p2"), width: 1.8, dash: [6, 4] }, true);
    Plot.hline(p2, 0.6, { color: U.css("--good"), dash: [5, 4] });
    Plot.hline(p2, 0.3, { color: U.css("--warn"), dash: [5, 4] });
    Plot.dot(p2, m.st.Q * 1000, m.st.y, 5.5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--water"), text: "наполнение" },
      { color: U.css("--p2"), text: "скорость (правая ось)", dash: [6, 4] },
      { color: U.css("--good"), text: "предел 0,6 по СП", dash: [5, 4] },
      { color: U.css("--warn"), text: "минимум 0,3 для самоочищения", dash: [5, 4] }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, s = m.st, cs = m.chains.main.cs;
    var okFill = s.y <= 0.6 && s.y >= 0.3;
    return [
      { h: "Равномерный режим при " + U.fmt(st.Qbase, 2) + " л/с" },
      { n: "Наполнение h/d", v: U.fmt(s.y, 3) + " (h = " + U.fmt(s.h * 1000, 0) + " мм)",
        cls: s.y > 0.6 ? "bad" : (s.y < 0.3 ? "warn" : "good") },
      { n: "Скорость", v: U.fmt(s.v, 2) + " м/с", cls: s.v < s.vmin ? "bad" : "good" },
      { n: "Минимальная по СП для d" + U.fmt(st.d, 0), v: U.fmt(s.vmin, 2) + " м/с", cls: "sub" },
      { n: "Гидравлический радиус R", v: U.fmt(s.R * 1000, 1) + " мм" },
      { n: "Касательное напряжение τ", v: U.fmt(s.tau, 2) + " Па", cls: s.tau < 1.5 ? "warn" : "good" },
      { n: "Число Фруда", v: U.fmt(s.Fr, 2) + (s.Fr > 1 ? " (бурный)" : " (спокойный)") },
      { n: "Критическая глубина", v: U.fmt(s.yc * st.d, 0) + " мм (h/d = " + U.fmt(s.yc, 3) + ")" },
      { n: "Пропускная способность при h/d = 0,938", v: U.fmt(s.Qfull * 1000, 1) + " л/с" },
      { h: "Длина и добегание" },
      { n: "Длина трубопровода", v: U.fmt(st.L, 0) + " м" },
      { n: "Скорость кинематической волны", v: U.fmt(cs.c, 2) + " м/с" },
      { n: "Время добегания", v: U.fmtTime(cs.T) },
      { n: "Размывание пика (σ)", v: U.fmtTime(cs.sig) },
      { h: "Сейчас" },
      { n: "Расход на входе", v: U.fmt(m.Qin * 1000, 2) + " л/с" },
      { n: "Расход на выходе", v: U.fmt(m.chains.main.out * 1000, 2) + " л/с" },
      { n: "Осталось в баке залпа", v: U.fmt(m.pulseLeft * 1000, 1) + " л", cls: "sub" }
    ];
  };

  S.explain = function () {
    var st = S.state, s = m.st, out = [], cs = m.chains.main.cs;
    if (st.Qbase < 0.01 && m.pulseLeft <= 0 && m.chains.main.out < 1e-5) {
      out.push({ lvl: "info", text: "Расхода нет. Задайте постоянный расход или нажмите «Залповый сброс»." });
      return out;
    }
    out.push({
      lvl: s.y > 0.6 ? "bad" : (s.y < 0.3 ? "warn" : "good"),
      text: "Наполнение <b>h/d = " + U.fmt(s.y, 3) + "</b> при уклоне " + U.fmt(st.slope, 1) + " ‰. " +
        (s.y > 0.6 ? "Это больше допустимых 0,6: при залпе труба заработает полным сечением, и начнутся срывы гидрозатворов."
          : (s.y < 0.3 ? "Меньше 0,3 — поток «размазан» по дну, взвесь оседает." : "В норме: 0,3…0,6 — рабочий диапазон для самотёчной канализации."))
    });
    out.push({
      lvl: s.v >= s.vmin ? "good" : "bad",
      text: "Скорость " + U.fmt(s.v, 2) + " м/с при минимально допустимой " + U.fmt(s.vmin, 2) + " м/с (СП 32.13330 для d" + U.fmt(st.d, 0) + "). " +
        "Касательное напряжение на стенке τ = ρ·g·R·i = " + U.fmt(s.tau, 2) + " Па" +
        (s.tau >= 1.5 ? " — этого хватает, чтобы тащить песок." : " — маловато: для транспортировки песка нужно 1,5…2 Па.")
    });
    out.push({
      lvl: "info",
      text: "Уклон и диаметр задают наполнение, длина — нет. Проверьте сами: подвигайте «Длину трубопровода» — наполнение на выходе не изменится, изменится только время добегания (" +
        U.fmtTime(cs.T) + ") и то, насколько расплывётся залп."
    });
    if (m.pulseLeft > 0 || m.chains.main.out > st.Qbase / 1000 * 1.05) {
      out.push({
        lvl: "info",
        text: "Идёт залповый сброс. Волна движется со скоростью <b>" + U.fmt(cs.c, 2) + " м/с</b> — это примерно 1,3 скорости воды: гребень догоняет сам себя, потому что при большем наполнении вода течёт быстрее. " +
          "На выходе пик придёт позже входа и будет ниже: часть объёма растянулась по трубе."
      });
    }
    if (s.Fr > 1) {
      out.push({
        lvl: "warn",
        text: "Поток бурный (Fr = " + U.fmt(s.Fr, 2) + "): глубина меньше критической, скорость выше критической. На переходе к пологому участку получится гидравлический прыжок — резкое вскипание потока с гашением энергии. В канализации это источник шума и выброса запахов."
      });
    }
    if (st.d === 110 && st.slope < 20) {
      out.push({ lvl: "warn", text: "Для d110 нормативный минимальный уклон — 20 ‰ (правило «уклон 1/d»). При меньшем труба работает, но ниже самоочищающей скорости, и со временем заилится." });
    }
    if (s.y > 0.9) {
      out.push({ lvl: "bad", text: "Труба почти полная. Дальше она перейдёт на напорный режим, и сток пойдёт в подвал или через гидрозатворы. Максимум расхода у круглой трубы, кстати, не при полном сечении, а при h/d ≈ 0,94 — выше растёт смоченный периметр и падает гидравлический радиус." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Уклон, диаметр, расход", tag: "★ главный",
      preset: { d: 110, slope: 20, rough: "pvc", Qbase: 1.0, L: 200 },
      steps: [
        "Смотрите на наполнение при расходе 1 л/с и уклоне 20 ‰.",
        "Увеличивайте расход до 5 л/с — наполнение растёт.",
        "Верните 1 л/с и меняйте уклон: 5, 10, 40, 80 ‰.",
        "Потом поменяйте диаметр на 160 и 200 мм."
      ],
      watch: [
        "Круче уклон — меньше наполнение, но больше скорость.",
        "Больше диаметр при том же расходе — меньше наполнение и меньше скорость.",
        "На правом графике видно: наполнение растёт с расходом нелинейно."
      ],
      why: "Формула Маннинга: при заданных уклоне и диаметре каждому расходу отвечает своё наполнение. Крутой уклон разгоняет воду, и тот же расход проходит более тонким слоем. Отсюда парадокс проектировщика: увеличив диаметр, можно потерять самоочищающую скорость."
    },
    {
      title: "2. Длина не меняет наполнение", tag: "★ важное",
      preset: { d: 110, slope: 20, rough: "pvc", Qbase: 2.0, L: 50 },
      steps: ["Запишите наполнение и скорость при длине 50 м.", "Увеличьте длину до 500, потом до 1500 м.", "Сравните наполнение — и время добегания."],
      watch: [
        "Наполнение и скорость не меняются вовсе.",
        "Время добегания растёт пропорционально длине.",
        "Размывание пика (σ в показаниях) растёт как корень из длины."
      ],
      why: "При равномерном движении наполнение определяется балансом силы тяжести и трения — то есть уклоном, диаметром и расходом. Длина в формулу Маннинга не входит. Это принципиальное отличие безнапорного потока от напорного, где потери прямо пропорциональны длине."
    },
    {
      title: "3. Один залп, три длины", tag: "★ добегание",
      preset: { d: 110, slope: 20, rough: "pvc", Qbase: 0.3, L: 200, pulseV: 60, pulseT: 8 },
      speed: 4,
      steps: [
        "Нажмите «Залповый сброс» (кнопка слева) и смотрите на верхний график.",
        "Три цветные кривые — один и тот же сброс на выходе трубы длиной 50, 200 и 800 м.",
        "Дождитесь, пока все волны пройдут."
      ],
      watch: [
        "Чем длиннее труба, тем позже приходит пик.",
        "И тем он ниже и шире: объём тот же, а пик размазался.",
        "На коротком участке форма сброса почти не изменилась."
      ],
      why: "Волна расхода движется со скоростью c = dQ/dA, примерно в 1,3 раза быстрее воды. По дороге она расплывается: гребень движется быстрее подошвы, но одновременно работает дисперсия, связанная с наклоном свободной поверхности. Практический вывод: чем дальше от источника залпа, тем спокойнее режим — поэтому срыв гидрозатворов случается на стояке и в первых метрах отводов, а не в городском коллекторе."
    },
    {
      title: "4. Гидравлический прыжок", tag: "бурный поток",
      preset: { d: 160, slope: 90, rough: "pvc", Qbase: 6, L: 100 },
      steps: ["Крутой уклон 90 ‰: посмотрите на число Фруда.", "Уменьшайте уклон до 5 ‰.", "Следите за критической глубиной (оранжевая линия в сечении)."],
      watch: [
        "На крутом уклоне поток бурный: глубина меньше критической.",
        "На пологом — спокойный, глубина больше критической.",
        "Где-то между ними наполнение равно критической глубине — это критический уклон."
      ],
      why: "Если бурный поток попадает на пологий участок, переход происходит скачком — гидравлическим прыжком, с бурлением и потерей энергии. В канализации это происходит в перепадных колодцах и на выходе из крутых участков: шум, выброс запаха, эрозия лотка."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Равномерное движение</h3>' +
    '<p class="formula">v = (1/n)·R<sup>2/3</sup>·i<sup>1/2</sup>,  Q = A·v</p>' +
    "<p>Здесь R = A/P — гидравлический радиус, n — коэффициент шероховатости Маннинга (0,010 для пластмассы, 0,013…0,014 для чугуна и бетона). Для частично заполненной круглой трубы A и P считаются через центральный угол θ = 2·arccos(1 − 2h/d).</p>" +
    "<p>Особенность круглого сечения: максимум расхода не при полном заполнении, а при h/d ≈ 0,938, а максимум скорости — при h/d ≈ 0,81. Выше этих значений смоченный периметр растёт быстрее площади, и гидравлический радиус падает.</p></section>" +

    '<section class="card txt"><h3>Нормы наполнения</h3>' +
    "<ul><li><b>h/d ≤ 0,6</b> для d до 500 мм (СП 32.13330) — запас на залповые расходы и вентиляцию сети по трубе.</li>" +
    "<li><b>h/d ≥ 0,3</b> — иначе поток слишком тонкий и не тащит взвесь.</li>" +
    "<li><b>Минимальная скорость</b> — от 0,7 м/с для d150…250 до 1,5 м/с для больших диаметров.</li>" +
    "<li><b>Минимальный уклон</b> — правило «1/d»: 0,02 для d110, 0,008 для d160, 0,005 для d200.</li></ul>" +
    "<p>Верхняя часть сечения нужна не «на запас», а для воздуха: канализационная сеть вентилируется через стояки, и перекрытие сечения водой означает срыв затворов.</p></section>" +

    '<section class="card txt"><h3>Спокойный и бурный поток</h3>' +
    '<p class="formula">Fr = v/√(g·A/B)</p>' +
    "<p>При Fr &lt; 1 поток спокойный: возмущения распространяются и вверх по течению, глубина больше критической. При Fr &gt; 1 поток бурный: вода «не знает», что впереди, — и при встрече с препятствием возникает прыжок.</p>" +
    "<p>Критическая глубина — та, при которой Fr = 1. Она зависит только от расхода и формы сечения, но не от уклона и шероховатости. Уклон, при котором нормальная глубина равна критической, называют критическим.</p></section>" +

    '<section class="card txt"><h3>Добегание и размывание пика</h3>' +
    '<p class="formula">c = dQ/dA ≈ 1,3·v</p>' +
    "<p>Волна расхода бежит быстрее самой воды: при большем наполнении скорость больше, поэтому гребень догоняет подошву. Это кинематическая волна.</p>" +
    "<p>Одновременно работает дисперсия: наклон свободной поверхности расталкивает волну в обе стороны. Её коэффициент D = Q/(2·B·i) — обратите внимание, чем меньше уклон, тем сильнее размывается пик.</p>" +
    "<p>Практический смысл: залповый сброс из квартиры опасен только в первые десятки метров — на стояке и в отводах. К моменту прихода в уличный коллектор он превращается в пологую волну, а тысячи таких волн складываются в плавный суточный график.</p></section>";

  Lab.register(S);
})();
