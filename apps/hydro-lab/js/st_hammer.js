/* Стенд 5. Гидравлический удар: быстрое закрытие задвижки, датчик давления, осциллограмма.

   Труба между резервуаром и задвижкой считается методом характеристик
   (Wylie & Streeter). Труба разбита на N участков, шаг по времени жёстко связан
   с шагом по длине: Δt = Δx/a, где a — скорость ударной волны.

     C+:  H_i = CP − B·Q_i,   CP = H_{i−1} + B·Q_{i−1} − R·Q_{i−1}|Q_{i−1}|
     C−:  H_i = CM + B·Q_i,   CM = H_{i+1} − B·Q_{i+1} + R·Q_{i+1}|Q_{i+1}|
     B = a/(g·A),  R = λ·Δx/(2·g·d·A²)

   Если напор опускается ниже давления насыщенного пара, в узле открывается
   паровая каверна (модель DVCM): её объём растёт и схлопывается, давая второй,
   часто более опасный удар. */
(function () {
  "use strict";

  var W = 1180, HH = 380;
  var NSEG = 40;
  var XA = 150, XB = 1010, YP = 250;

  var S = {
    id: "hammer", group: "basics", star: true,
    title: "Гидравлический удар",
    lead: "Закрыли задвижку — вода остановилась не вся сразу: по трубе побежала волна повышенного давления. Скорость волны, фаза удара, формула Жуковского и осциллограмма — всё на одном стенде.",
    hint: "Нажмите «Закрыть задвижку». Цвет трубы — напор: красный выше начального, синий ниже. Волна бежит со скоростью a — на малой скорости модели её видно.",
    vis: { kind: "svg" },
    speeds: [0.02, 0.1, 0.25, 1],
    speed0: 0.1,
    maxStep: 0.02
  };

  S.defaults = function () {
    return {
      L: 600,           // длина трубопровода, м
      dmm: 200,         // диаметр, мм
      mat: "steel",
      wall: 6,          // толщина стенки, мм
      Hres: 40,         // напор в резервуаре над осью трубы, м
      v0: 1.5,          // начальная скорость, м/с
      tClose: 1.0,      // время закрытия, с
      kmm: 0.2,
      cavitation: true,
      airVessel: false,
      airV: 300,        // объём воздушного колпака, л
      T: 10
    };
  };

  S.fields = [
    { title: "Закрытие задвижки", open: true, fields: [
      { k: "tClose", t: "range", l: "Время закрытия", u: "с", min: 0.02, max: 20, step: 0.02, d: 2,
        hint: "Если оно меньше фазы 2L/a — удар прямой, и работает формула Жуковского в полную силу." },
      { k: "v0", t: "range", l: "Начальная скорость воды", u: "м/с", min: 0.1, max: 4, step: 0.05, d: 2 },
      { k: "Hres", t: "range", l: "Напор в резервуаре", u: "м", min: 5, max: 120, step: 1, d: 0 },
      { t: "custom", k: "tClose", render: function () {
        return '<button type="button" data-act="close" class="primary">Закрыть задвижку</button> ' +
          '<button type="button" data-act="open">Открыть</button>';
      }, onClick: function (act) { if (act === "close") S.closeValve(); else S.openValve(); } }
    ] },
    { title: "Трубопровод", open: true, fields: [
      { k: "L", t: "range", l: "Длина трубопровода", u: "м", min: 50, max: 3000, step: 10, d: 0 },
      { k: "dmm", t: "range", l: "Диаметр", u: "мм", min: 50, max: 800, step: 10, d: 0 },
      { k: "mat", t: "select", l: "Материал трубы", opts: Hydro.PIPE_MAT.map(function (p) { return [p.id, p.name]; }) },
      { k: "wall", t: "range", l: "Толщина стенки", u: "мм", min: 1, max: 25, step: 0.5, d: 1,
        hint: "Тонкая стенка = податливая труба = медленная волна = слабее удар." },
      { k: "kmm", t: "range", l: "Шероховатость", u: "мм", min: 0.01, max: 2, step: 0.01, d: 2 },
      { k: "T", t: "range", l: "Температура воды", u: "°C", min: 2, max: 90, step: 1, d: 0 }
    ] },
    { title: "Защита и явления", fields: [
      { k: "cavitation", t: "check", l: "Разрешить разрыв сплошности (паровая каверна)",
        hint: "Вода не выдерживает растяжения: при падении ниже давления насыщенного пара столб рвётся, а потом схлопывается с ударом." },
      { k: "airVessel", t: "check", l: "Воздушный колпак у задвижки" },
      { k: "airV", t: "range", l: "Объём колпака", u: "л", min: 20, max: 3000, step: 10, d: 0, show: function (st) { return st.airVessel; } }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {}, tr = new Plot.Trend(20000), acc = 0;

  function setup(st) {
    var d = st.dmm / 1000, wall = st.wall / 1000, mat = Hydro.matById(st.mat);
    var rho = U.rho(st.T), K = U.bulkK(st.T);
    var a = Hydro.celerity(K, rho, d, wall, mat.E);
    var A = Hydro.area(d);
    var Q0 = st.v0 * A;
    var Re = Hydro.reynolds(st.v0, d, U.nu(st.T));
    var lam = Hydro.lambda(Re, st.kmm / 1000, d);
    var dx = st.L / NSEG, dt = dx / a;
    var B = a / (Hydro.G * A);
    var Rf = lam * dx / (2 * Hydro.G * d * A * A);
    var hf = Hydro.hFriction(st.L, d, st.v0, lam);
    var Hvalve = Math.max(0.5, st.Hres - hf);

    m = {
      a: a, A: A, d: d, Q0: Q0, lam: lam, dx: dx, dt: dt, B: B, Rf: Rf, hf: hf,
      Hvalve0: Hvalve, phase: Hydro.phase(st.L, a),
      dHjuk: Hydro.jukovsky(a, st.v0),
      dHmich: Hydro.michaud(st.L, st.v0, Math.max(st.tClose, 1e-3)),
      hVap: -(10.33 - U.vaporHead(st.T)),           // манометрический напор насыщенного пара
      H: [], Q: [], cav: [], tau: 1, closing: false, tStart: -1,
      hiEnv: [], loEnv: [], maxH: Hvalve, minH: Hvalve, cavOn: false, cavMax: 0,
      Va: st.airV / 1000, Va0: st.airV / 1000, pAirC: 0
    };
    for (var i = 0; i <= NSEG; i++) {
      m.H[i] = st.Hres - hf * i / NSEG;
      m.Q[i] = Q0;
      m.cav[i] = 0;
      m.hiEnv[i] = m.H[i];
      m.loEnv[i] = m.H[i];
    }
    /* Постоянная политропы для воздушного колпака: p·V^1,2 = const. */
    m.pAirC = (Hvalve + 10.33) * Math.pow(m.Va0, 1.2);
    tr.clear();
    acc = 0;
  }

  S.reset = function () { setup(S.state); S.t = 0; };
  S.onChange = function () { setup(S.state); S.t = 0; };

  S.closeValve = function () {
    m.closing = true;
    m.tStart = S.t;
  };
  S.openValve = function () { setup(S.state); S.t = 0; };

  function tauAt(st, t) {
    if (!m.closing) return 1;
    var x = (t - m.tStart) / Math.max(st.tClose, 1e-4);
    return U.clamp(1 - x, 0, 1);
  }

  /* Один шаг метода характеристик. */
  function stepMOC(st) {
    var N = NSEG, B = m.B, R = m.Rf, H = m.H, Q = m.Q, cav = m.cav;
    var Hn = new Array(N + 1), Qn = new Array(N + 1);
    var Qup = new Array(N + 1), Qdn = new Array(N + 1);      // расходы по сторонам узла (для каверн)
    var i, CP, CM;

    for (i = 1; i < N; i++) {
      CP = H[i - 1] + B * Q[i - 1] - R * Q[i - 1] * Math.abs(Q[i - 1]);
      CM = H[i + 1] - B * Q[i + 1] + R * Q[i + 1] * Math.abs(Q[i + 1]);
      Hn[i] = (CP + CM) / 2;
      Qn[i] = (CP - CM) / (2 * B);
      Qup[i] = (CP - Hn[i]) / B;
      Qdn[i] = (Hn[i] - CM) / B;
    }

    /* Верх: резервуар с постоянным уровнем (вход с потерей скоростного напора). */
    CM = H[1] - B * Q[1] + R * Q[1] * Math.abs(Q[1]);
    Hn[0] = st.Hres;
    Qn[0] = (Hn[0] - CM) / B;
    Qup[0] = Qn[0]; Qdn[0] = Qn[0];

    /* Низ: задвижка (плюс воздушный колпак, если он включён). */
    CP = H[N - 1] + B * Q[N - 1] - R * Q[N - 1] * Math.abs(Q[N - 1]);
    var tau = tauAt(st, S.t);
    var Cv = Math.pow(m.Q0 * tau, 2) / m.Hvalve0;
    if (st.airVessel) {
      /* Колпак стоит между трубой и задвижкой: он принимает воду, сглаживая скачок. */
      var Hg = H[N];
      for (var it = 0; it < 12; it++) {
        var Qv = tau > 0 ? Math.sqrt(Math.max(0, Cv * Math.max(Hg, 0))) : 0;
        var Qin = (CP - Hg) / B;
        var Va = U.clamp(m.Va - (Qin - Qv) * m.dt, 1e-4, m.Va0 * 40);
        var Hnew = m.pAirC / Math.pow(Va, 1.2) - 10.33;
        Hg = Hg + 0.5 * (Hnew - Hg);
      }
      var QvF = tau > 0 ? Math.sqrt(Math.max(0, Cv * Math.max(Hg, 0))) : 0;
      var QinF = (CP - Hg) / B;
      m.Va = U.clamp(m.Va - (QinF - QvF) * m.dt, 1e-4, m.Va0 * 40);
      Hn[N] = Hg;
      Qn[N] = QinF;
      m.Qvalve = QvF;
    } else {
      if (tau <= 0) {
        Qn[N] = 0;
        Hn[N] = CP;
      } else {
        var bc = B * Cv / 2;
        Qn[N] = -bc + Math.sqrt(bc * bc + Cv * Math.max(CP, 0));
        Hn[N] = CP - B * Qn[N];
      }
      m.Qvalve = Qn[N];
    }
    Qup[N] = Qn[N]; Qdn[N] = m.Qvalve;

    /* Разрыв сплошности: где напор ушёл ниже давления пара, держим его на этом
       уровне и копим объём каверны. Каверна закрылась — схлопывание. */
    if (st.cavitation) {
      m.cavOn = false;
      for (i = 1; i <= N; i++) {
        if (Hn[i] >= m.hVap && cav[i] <= 0) continue;
        /* Каверна растёт, когда из узла уходит больше, чем в него приходит. */
        cav[i] = cav[i] + (Qdn[i] - Qup[i]) * m.dt;
        if (cav[i] <= 0) {
          cav[i] = 0;                                        // каверна схлопнулась — узел снова обычный
        } else {
          Hn[i] = m.hVap;
          Qn[i] = 0.5 * (Qup[i] + Qdn[i]);
          m.cavOn = true;
          m.cavMax = Math.max(m.cavMax, cav[i]);
        }
      }
    }

    m.H = Hn; m.Q = Qn;
    for (i = 0; i <= N; i++) {
      if (Hn[i] > m.hiEnv[i]) m.hiEnv[i] = Hn[i];
      if (Hn[i] < m.loEnv[i]) m.loEnv[i] = Hn[i];
    }
    m.tau = tau;
    m.maxH = Math.max(m.maxH, Hn[N]);
    m.minH = Math.min(m.minH, Hn[N]);
  }

  S.tick = function (dt) {
    var st = S.state;
    acc += dt;
    var guard = 0;
    while (acc >= m.dt && guard++ < 4000) {
      stepMOC(st);
      acc -= m.dt;
      tr.push(S.t, { valve: m.H[NSEG], mid: m.H[Math.round(NSEG / 2)], q: m.Qvalve * 1000, tau: m.tau * 100 });
    }
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH), i;
    // --- резервуар
    s += SK.rect(null, 40, 60, 110, 230, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("res", 42, 100, 106, 188, "water");
    s += SK.txt(null, 44, 54, "cap", "start", "Резервуар");
    s += SK.txt("resT", 44, 306, "tiny muted", "start", "");

    // --- труба из отрезков, каждый красится по напору
    for (i = 0; i < NSEG; i++) {
      var x = XA + (XB - XA) * i / NSEG, w = (XB - XA) / NSEG + 0.8;
      s += SK.rect("sg" + i, x, YP - 13, w, 26, "", ' fill="var(--pipe-lo)"');
    }
    s += SK.rect(null, XA, YP - 13, XB - XA, 26, "", ' fill="none" stroke="var(--casing-dark)" stroke-width="1.5"');

    // --- задвижка и манометр
    s += SK.valve("valve", XB + 20, YP, "", 13);
    s += SK.gauge("needle", XB + 78, YP - 46, 26);
    s += SK.txt("gT", XB + 78, YP + 4, "val", "middle", "");
    s += SK.txt(null, XB + 78, YP + 22, "tiny muted", "middle", "датчик у задвижки");
    s += SK.path(null, "M" + (XB + 34) + " " + YP + " H" + (XB + 60), "tube");

    // --- воздушный колпак
    s += SK.g("air", "", SK.rect(null, -34, -96, 68, 96, "", ' fill="var(--panel)" stroke="var(--casing-dark)" stroke-width="2" rx="6"') +
      SK.rect("airW", -32, -40, 64, 38, "", ' fill="var(--water)" opacity="0.5"') +
      SK.txt(null, 0, -104, "tiny muted", "middle", "колпак") +
      SK.txt("airT", 0, -50, "tiny", "middle", ""),
      ' transform="translate(' + (XB - 60) + "," + (YP - 14) + ')"');

    // --- шкала и подписи
    s += SK.txt("waveT", (XA + XB) / 2, 40, "cap", "middle", "");
    s += SK.txt("phaseT", (XA + XB) / 2, 60, "tiny muted", "middle", "");
    s += SK.txt("cavT", (XA + XB) / 2, YP + 60, "val bad", "middle", "");
    s += SK.dimH(YP + 36, XA, XB, "");
    s += SK.txt("lenT", (XA + XB) / 2, YP + 32, "tiny muted", "middle", "");

    s += SK.close();
    ui.vis.innerHTML = s;
    var ids = ["res", "resT", "valve", "needle", "gT", "waveT", "phaseT", "cavT", "lenT", "air", "airW", "airT"];
    for (i = 0; i < NSEG; i++) ids.push("sg" + i);
    R = SK.refs(ui.vis, ids);
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, i;
    var span = Math.max(m.dHjuk * 0.6, 5);
    for (i = 0; i < NSEG; i++) {
      var h = 0.5 * (m.H[i] + m.H[i + 1]);
      var rel = U.clamp((h - m.Hvalve0) / span, -1, 1);
      var col = rel >= 0 ? U.mix(U.css("--pipe-lo"), U.css("--bad"), rel) : U.mix(U.css("--pipe-lo"), U.css("--pipe-hi"), -rel);
      if (st.cavitation && m.cav[i] > 1e-9) col = U.css("--warn-hex");
      SK.set(R["sg" + i], { fill: col });
    }
    SK.cls(R.valve, "shut", m.tau <= 0.01);
    SK.cls(R.valve, "throttled", m.tau > 0.01 && m.tau < 0.99);
    SK.set(R.needle, { transform: "rotate(" + SK.needle(m.H[NSEG], Math.max(m.Hvalve0 + m.dHjuk * 1.2, 10)) + ")" });
    SK.text(R.gT, U.fmt(m.H[NSEG], 1) + " м");
    SK.set(R.gT, { fill: m.H[NSEG] > m.Hvalve0 * 1.05 ? "var(--bad)" : (m.H[NSEG] < 0 ? "var(--water)" : "var(--ink)") });
    SK.text(R.resT, "уровень " + U.fmt(st.Hres, 0) + " м");
    SK.text(R.lenT, "L = " + U.fmt(st.L, 0) + " м,  a = " + U.fmt(m.a, 0) + " м/с,  волна пробегает за " + U.fmt(st.L / m.a, 3) + " с");
    SK.text(R.waveT, m.closing
      ? (m.tau > 0 ? "задвижка закрывается: " + U.fmt(m.tau * 100, 0) + " % открыта" : "задвижка закрыта")
      : "установившийся режим, v = " + U.fmt(st.v0, 2) + " м/с");
    SK.text(R.phaseT, "фаза удара 2L/a = " + U.fmt(m.phase, 3) + " с;  время закрытия " + U.fmt(st.tClose, 2) + " с — удар " +
      (st.tClose <= m.phase ? "ПРЯМОЙ" : "непрямой"));
    SK.text(R.cavT, m.cavOn ? "разрыв сплошности: паровая каверна " + U.fmt(m.cavMax * 1000, 1) + " л" : "");
    SK.set(R.air, { opacity: st.airVessel ? 1 : 0 });
    if (st.airVessel) {
      var fill = U.clamp(1 - m.Va / (m.Va0 * 1.6), 0, 1);
      SK.set(R.airW, { y: -2 - 90 * fill, height: 90 * fill });
      SK.text(R.airT, U.fmt(m.Va * 1000, 0) + " л возд.");
    }
    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "osc", title: "Осциллограмма: напор у задвижки", h: 330 },
    { id: "prof", title: "Напор по длине трубопровода (и огибающие за весь опыт)", h: 330 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var win = U.clamp(m.phase * 12, 0.5, 60);
    var hi = m.Hvalve0 + m.dHjuk * 1.15, lo = Math.min(m.hVap - 2, m.Hvalve0 - m.dHjuk * 1.15);
    var f = U.fitCanvas(ui.canvas("osc"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: Math.max(0, S.t - win), x1: Math.max(win, S.t), y0: lo, y1: hi,
      xLabel: "время, с", yLabel: "напор у задвижки, м",
      xFmt: function (x) { return U.fmt(x, win < 2 ? 2 : 1); }
    });
    Plot.band(p, m.hVap, lo, U.css("--bad"), 0.10);
    Plot.clip(p);
    Plot.hline(p, m.Hvalve0, { color: U.css("--muted"), dash: [4, 4] });
    Plot.hline(p, m.Hvalve0 + m.dHjuk, { color: U.css("--bad"), dash: [6, 4] });
    Plot.hline(p, m.Hvalve0 - m.dHjuk, { color: U.css("--water"), dash: [6, 4] });
    Plot.hline(p, m.hVap, { color: U.css("--bad"), dash: [2, 3] });
    Plot.line(p, tr.series("valve", S.t, win), { color: U.css("--p1"), width: 2 });
    Plot.unclip(p);
    Plot.legend(p, [
      { color: U.css("--p1"), text: "датчик у задвижки" },
      { color: U.css("--bad"), text: "Жуковский: +" + U.fmt(m.dHjuk, 1) + " м", dash: [6, 4] },
      { color: U.css("--water"), text: "−" + U.fmt(m.dHjuk, 1) + " м", dash: [6, 4] },
      { color: U.css("--muted"), text: "исходный напор " + U.fmt(m.Hvalve0, 1) + " м", dash: [4, 4] }
    ]);

    var f2 = U.fitCanvas(ui.canvas("prof"));
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: st.L, y0: lo, y1: hi,
      xLabel: "расстояние от резервуара, м", yLabel: "напор, м"
    });
    var hiE = [], loE = [], cur = [], i;
    for (i = 0; i <= NSEG; i++) {
      var x = st.L * i / NSEG;
      cur.push([x, m.H[i]]);
      hiE.push([x, m.hiEnv[i]]);
      loE.push([x, m.loEnv[i]]);
    }
    Plot.band(p2, m.hVap, lo, U.css("--bad"), 0.10);
    Plot.clip(p2);
    Plot.fillBetween(p2, hiE, loE, U.css("--est"), 0.12);
    Plot.line(p2, hiE, { color: U.css("--bad"), width: 1.4, dash: [5, 3] });
    Plot.line(p2, loE, { color: U.css("--water"), width: 1.4, dash: [5, 3] });
    Plot.line(p2, cur, { color: U.css("--p1"), width: 2.4 });
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--p1"), text: "сейчас" },
      { color: U.css("--bad"), text: "максимум за опыт", dash: [5, 3] },
      { color: U.css("--water"), text: "минимум за опыт", dash: [5, 3] }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, mat = Hydro.matById(st.mat);
    return [
      { n: "Скорость ударной волны a", v: U.fmt(m.a, 0) + " м/с" },
      { n: "Фаза удара 2L/a", v: U.fmt(m.phase, 3) + " с" },
      { n: "Время закрытия", v: U.fmt(st.tClose, 2) + " с", cls: st.tClose <= m.phase ? "bad" : "good" },
      { n: "Тип удара", v: st.tClose <= m.phase ? "прямой" : "непрямой", cls: st.tClose <= m.phase ? "bad" : "good" },
      { h: "Расчёт по формулам" },
      { n: "Жуковский Δh = a·v/g", v: U.fmt(m.dHjuk, 1) + " м (" + U.fmt(m.dHjuk / 10.2, 1) + " бар)" },
      { n: "Мишо (непрямой) 2Lv/(g·t)", v: U.fmt(m.dHmich, 1) + " м", cls: "sub" },
      { h: "Что намерил стенд" },
      { n: "Напор у задвижки сейчас", v: U.fmt(m.H[NSEG], 1) + " м" },
      { n: "Максимум за опыт", v: U.fmt(m.maxH, 1) + " м", cls: "bad" },
      { n: "Минимум за опыт", v: U.fmt(m.minH, 1) + " м", cls: m.minH < m.hVap + 0.5 ? "bad" : "" },
      { n: "Размах", v: U.fmt(m.maxH - m.minH, 1) + " м" },
      { n: "Объём паровой каверны (макс.)", v: m.cavMax > 0 ? U.fmt(m.cavMax * 1000, 2) + " л" : "—", cls: m.cavMax > 0 ? "bad" : "" },
      { h: "Труба" },
      { n: "Материал", v: mat.name + ", E = " + U.fmt(mat.E / 1e9, 0) + " ГПа" },
      { n: "Расход в начале", v: U.fmt(m.Q0 * 1000, 1) + " л/с" },
      { n: "Потери по длине при v₀", v: U.fmt(m.hf, 2) + " м" },
      { n: "Шаг схемы Δx / Δt", v: U.fmt(m.dx, 1) + " м / " + U.fmt(m.dt * 1000, 2) + " мс", cls: "sub" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [];
    out.push({
      lvl: "info",
      text: "Волна бежит со скоростью <b>" + U.fmt(m.a, 0) + " м/с</b>. В абсолютно жёсткой трубе она была бы равна скорости звука в воде (1425 м/с), но труба растягивается, и волна замедляется. " +
        (st.mat === "pe" || st.mat === "pp" ? "У пластмассовой трубы модуль упругости в 200 раз меньше, чем у стали, поэтому волна медленная, а удар слабый — это главная причина, по которой пластик спокойно переносит закрытие кранов." : "")
    });
    if (!m.closing) {
      out.push({ lvl: "info", text: "Пока задвижка открыта, всё спокойно: напор у задвижки " + U.fmt(m.Hvalve0, 1) + " м — это уровень в резервуаре минус потери по длине " + U.fmt(m.hf, 2) + " м. Нажмите «Закрыть задвижку»." });
      return out;
    }
    if (st.tClose <= m.phase) {
      out.push({
        lvl: "bad",
        text: "<b>Удар прямой:</b> задвижка закрылась за " + U.fmt(st.tClose, 2) + " с, а волне нужно " + U.fmt(m.phase, 3) +
          " с, чтобы сбегать до резервуара и вернуться. Отражённая волна не успевает помочь, и скачок равен полному значению по Жуковскому: Δh = a·v/g = " + U.fmt(m.dHjuk, 1) + " м."
      });
    } else {
      out.push({
        lvl: "warn",
        text: "<b>Удар непрямой:</b> закрытие (" + U.fmt(st.tClose, 2) + " с) длиннее фазы (" + U.fmt(m.phase, 3) +
          " с). Отражённая от резервуара волна разрядки возвращается раньше, чем задвижка закрылась, и срезает пик: по формуле Мишо остаётся примерно " + U.fmt(m.dHmich, 1) +
          " м вместо " + U.fmt(m.dHjuk, 1) + " м."
      });
    }
    out.push({
      lvl: "info",
      text: "Дальше идут колебания с периодом 4L/a = " + U.fmt(2 * m.phase, 3) + " с: повышенное давление — пониженное — снова повышенное. Затухают они на трении, поэтому в длинной трубе с большой скоростью звенеть будет долго."
    });
    if (m.minH < m.hVap + 0.5) {
      out.push({
        lvl: "bad",
        text: "<b>Разрыв сплошности.</b> В фазе разрядки напор дошёл до давления насыщенного пара (" + U.fmt(m.hVap, 1) +
          " м по манометру). Вода не выдерживает растяжения: столб разорвался, образовалась паровая каверна до " + U.fmt(m.cavMax * 1000, 1) +
          " л. Когда она схлопывается, скорости встречаются в точке — и получается второй удар, часто сильнее первого. Именно так рвёт трубопроводы после отключения насоса."
      });
    }
    if (st.airVessel) {
      out.push({
        lvl: "good",
        text: "Воздушный колпак работает как пружина: он принимает воду, которой некуда деться, и отдаёт её обратно. Скачок у задвижки срезан, а колебания стали длиннее и мягче. Чем больше объём, тем сильнее эффект — попробуйте от 50 до 2000 л."
      });
    }
    out.push({
      lvl: "info",
      text: "Практический вывод: давление удара не зависит ни от длины трубы, ни от напора — только от скорости воды и от скорости волны. Уменьшили скорость вдвое (взяли трубу пошире) — вдвое уменьшили удар. " +
        "Растянули закрытие в " + U.fmt(4 * m.phase / Math.max(st.tClose, 0.01), 0) + " раз — и удар почти исчез."
    });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Прямой удар: формула Жуковского", tag: "★ главный",
      preset: { L: 600, dmm: 200, mat: "steel", wall: 6, Hres: 40, v0: 1.5, tClose: 0.1, cavitation: true, airVessel: false },
      speed: 0.1,
      steps: [
        "Скорость модели ×1/10 — иначе волну не разглядеть.",
        "Нажмите «Закрыть задвижку» (кнопка на панели слева).",
        "Смотрите, как по трубе бежит красная волна: от задвижки к резервуару и обратно.",
        "Сравните максимум на осциллограмме с красной штриховой линией."
      ],
      watch: [
        "Пик ровно совпадает с линией Жуковского a·v/g.",
        "Волна доходит до резервуара за L/a и возвращается волной разрежения.",
        "Период колебаний равен 4L/a."
      ],
      why: "Останавливая слой воды, задвижка забирает у него количество движения. Импульс силы за время Δt равен изменению количества движения массы, которую волна успела остановить, отсюда Δp = ρ·a·v — формула Жуковского 1898 года. Она не содержит ни длины трубы, ни начального давления."
    },
    {
      title: "2. Медленное закрытие спасает", tag: "защита",
      preset: { L: 600, dmm: 200, mat: "steel", wall: 6, Hres: 40, v0: 1.5, tClose: 0.1, cavitation: true, airVessel: false },
      speed: 0.25,
      steps: [
        "Закройте задвижку за 0,1 с и запомните максимум.",
        "Нажмите «Открыть», поставьте время закрытия 1 с, закройте снова.",
        "Повторите с 3 с и с 10 с."
      ],
      watch: [
        "Пока время закрытия меньше фазы 2L/a — ничего не меняется.",
        "Как только оно превысит фазу, пик начинает падать обратно пропорционально времени.",
        "При 10 с удара практически нет."
      ],
      why: "Формула Мишо: Δh = 2L·v/(g·t). Отражённая волна разрядки приходит к задвижке через 2L/a и гасит нарастание. Отсюда нормативное требование к приводам задвижек на больших водоводах: время хода должно быть в несколько раз больше фазы."
    },
    {
      title: "3. Пластик вместо стали", tag: "материал",
      preset: { L: 600, dmm: 200, mat: "steel", wall: 6, Hres: 40, v0: 1.5, tClose: 0.1, cavitation: true },
      speed: 0.1,
      steps: ["Закройте задвижку на стальной трубе, запомните пик.", "Смените материал на полиэтилен ПЭ100 и повторите.", "Посмотрите на скорость волны a."],
      watch: ["a падает с ~1250 до 200…300 м/с — смотря какая стенка.", "Удар уменьшается во столько же раз.", "Колебания стали заметно медленнее: период 4L/a вырос."],
      why: "a = √(K/ρ)/√(1 + K·d/(E·e)). Податливая труба расширяется под давлением, принимая часть воды, — именно это и смягчает удар. По той же причине тонкостенная труба мягче толстостенной, а труба с воздушным колпаком мягче любой."
    },
    {
      title: "4. Разрыв колонны и второй удар", tag: "★ опасно",
      preset: { L: 1200, dmm: 150, mat: "steel", wall: 5, Hres: 15, v0: 2.5, tClose: 0.05, cavitation: true, airVessel: false },
      speed: 0.1,
      steps: [
        "Низкий напор (15 м) и высокая скорость (2,5 м/с) — так бывает после аварийной остановки насоса.",
        "Закройте задвижку мгновенно.",
        "Следите за нижней частью осциллограммы и за оранжевыми участками трубы."
      ],
      watch: [
        "В фазе разрежения напор упирается в давление насыщенного пара и не идёт ниже.",
        "Оранжевым помечены участки с паровой каверной.",
        "Когда каверна схлопывается, на осциллограмме появляется острый пик — часто выше первого."
      ],
      why: "Вода почти не выдерживает растяжения: при падении давления до давления насыщенного пара она вскипает, и в трубе образуется полость. Схлопывание полости — это столкновение двух водяных столбов, то есть удар Жуковского на удвоенной скорости. Отсюда требования к воздушным клапанам и колпакам на профилях с переломами."
    },
    {
      title: "5. Воздушный колпак", tag: "защита",
      preset: { L: 600, dmm: 200, mat: "steel", wall: 6, Hres: 40, v0: 2, tClose: 0.1, cavitation: true, airVessel: true, airV: 300 },
      speed: 0.25,
      steps: ["Колпак 300 л включён. Закройте задвижку.", "Отключите колпак и повторите.", "Поменяйте объём колпака от 50 до 2000 л."],
      watch: ["С колпаком пик срезан в разы.", "Колебания стали медленными и плавными — период задаёт уже не длина трубы, а объём воздуха.", "Маленький колпак почти не помогает."],
      why: "Сжатый воздух работает как пружина: вода, которой некуда деться, идёт в колпак, сжимает воздух и возвращается назад. Тот же принцип у мембранного бака в насосной станции и у гасителей ударов, которые ставят перед быстродействующими клапанами."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Формула Жуковского</h3>' +
    '<p class="formula">Δp = ρ·a·Δv,   в метрах: Δh = a·Δv/g</p>' +
    "<p>Н. Е. Жуковский вывел её в 1898 году после серии аварий на московском водопроводе. В формуле нет ни длины трубы, ни рабочего давления: повышение зависит только от того, какую скорость отняли у воды и как быстро бежит волна.</p>" +
    "<p>Числа для оценки: при a = 1000 м/с каждый метр в секунду скорости даёт около 100 м столба, то есть 10 бар. Поэтому в водопроводе и держат скорости 1…2 м/с — не только из-за потерь.</p></section>" +

    '<section class="card txt"><h3>Скорость волны</h3>' +
    '<p class="formula">a = √(K/ρ) / √(1 + K·d/(E·e))</p>' +
    "<p>K = 2,06 ГПа — модуль упругости воды, E — материала трубы, e — толщина стенки. В жёсткой трубе a = 1425 м/с (звук в воде), в стальной — 1000…1250, в чугунной — 1000…1100, в полиэтиленовой — 250…400 м/с.</p>" +
    "<p>Отсюда правило: чем податливее труба, тем мягче удар. Полиэтиленовый водопровод переносит резкое закрытие крана почти без последствий, стальной — нет.</p></section>" +

    '<section class="card txt"><h3>Фаза удара</h3>' +
    '<p class="formula">T<sub>ф</sub> = 2L/a</p>' +
    "<p>Столько времени волне нужно, чтобы добежать до резервуара и вернуться обратно уже волной разрежения. Если задвижка закрылась быстрее — удар <b>прямой</b>, и он максимален. Если медленнее — <b>непрямой</b>, и пик срезается примерно по формуле Мишо Δh = 2L·v/(g·t).</p>" +
    "<p>Полный цикл колебаний — 4L/a: повышение, разрежение, снова повышение. Затухают они за счёт трения о стенки.</p></section>" +

    '<section class="card txt"><h3>Как с этим борются</h3>' +
    "<ul><li><b>Время закрытия.</b> Электропривод задвижки на водоводе подбирают так, чтобы ход был в 5…10 раз длиннее фазы.</li>" +
    "<li><b>Скорость воды.</b> Диаметр побольше — скорость поменьше — удар слабее линейно.</li>" +
    "<li><b>Воздушный колпак, мембранный бак, гаситель</b> у быстродействующей арматуры.</li>" +
    "<li><b>Вантузы и воздушные клапаны</b> в высоких точках профиля: они впускают воздух и не дают разорваться колонне.</li>" +
    "<li><b>Обратные клапаны с демпфером</b> у насосов: обычный «хлопающий» клапан сам становится источником удара.</li>" +
    "<li><b>Плавный пуск и останов насосов</b> — частотный преобразователь решает задачу целиком.</li></ul></section>" +

    '<section class="card txt"><h3>Как считает этот стенд</h3>' +
    "<p>Метод характеристик: уравнения неразрывности и движения для упругой жидкости в упругой трубе сводятся к двум обыкновенным уравнениям вдоль линий dx/dt = ±a. Труба разбита на 40 участков, шаг по времени жёстко связан с шагом по длине: Δt = Δx/a.</p>" +
    "<p>Трение учитывается квазистационарно — как при установившемся течении с той же скоростью. Настоящие осциллограммы затухают чуть быстрее: в нестационарном потоке профиль скорости перестраивается, и трение растёт.</p>" +
    "<p>Разрыв сплошности считается по модели дискретных паровых каверн: в узле, где напор упал до давления пара, открывается полость, её объём интегрируется по разности расходов; когда объём обращается в ноль, полость схлопывается.</p></section>";

  Lab.register(S);
})();
