/* Стенд 1. Опыт Рейнольдса (1883): стеклянная труба, струйка краски, напорный бак с переливом.

   Расход не задаётся ползунком «расход», а получается из напора и сопротивлений —
   так же, как на настоящем стенде: открыли кран, вода поехала.
     H = (1 + ζвх + ζкрана + λ·L/d)·v²/2g,   λ = λ(Re),  Re = v·d/ν(T).
   Уравнение решается итерациями: λ зависит от скорости, скорость — от λ. */
(function () {
  "use strict";

  var W = 1160, HH = 470;
  var AX = 262;                       // ось трубы по вертикали, px
  var X0 = 196, X1 = 980;             // труба от бака до крана
  var XP1 = 430, XP2 = 830;           // пьезометры мерного участка
  var XDYE = 300;                     // ввод красителя

  var S = {
    id: "reynolds", group: "basics", star: true,
    title: "Опыт Рейнольдса",
    lead: "Струйка краски в стеклянной трубе: пока течение ламинарное — тонкая нить, после критической скорости — размывается по всему сечению. Заодно видно, как меняется степень зависимости потерь от скорости.",
    hint: "Кран справа — им задаётся расход. Щелчок по бутылочке с краской включает и выключает подачу красителя; щелчок по крану — открыть/закрыть.",
    vis: { kind: "svg" },
    speeds: [0.25, 1, 4],
    maxStep: 0.02
  };

  S.defaults = function () {
    return {
      d: 25,            // внутренний диаметр стеклянной трубы, мм
      L: 3.0,           // длина трубы, м
      H: 1.2,           // напор в баке над осью трубы, м
      T: 20,            // температура воды, °C
      open: 0.12,       // открытие крана, 0…1
      dye: true,
      kmm: 0.0015,      // шероховатость стекла, мм
      showProfile: true,
      autoTrail: true
    };
  };

  S.fields = [
    { title: "Кран и напор", open: true, fields: [
      { k: "open", t: "range", l: "Открытие крана", u: "%", min: 0, max: 1, step: 0.005, pct: true, d: 1,
        hint: "Единственная «ручка расхода» на стенде. Открывайте медленно — критическая скорость проходится незаметно." },
      { k: "H", t: "range", l: "Напор в баке над осью трубы", u: "м", min: 0.2, max: 3, step: 0.05, d: 2,
        hint: "Бак с переливом: уровень постоянный, что бы ни делал кран." },
      { k: "dye", t: "check", l: "Подача красителя" }
    ] },
    { title: "Труба и вода", open: true, fields: [
      { k: "d", t: "range", l: "Внутренний диаметр трубы", u: "мм", min: 4, max: 60, step: 1, d: 0 },
      { k: "L", t: "range", l: "Длина трубы", u: "м", min: 1, max: 6, step: 0.1, d: 1 },
      { k: "T", t: "range", l: "Температура воды", u: "°C", min: 2, max: 90, step: 1, d: 0,
        hint: "Горячая вода жиже: вязкость при 80 °C втрое меньше, чем при 5 °C, — и Re втрое больше при той же скорости." },
      { k: "showProfile", t: "check", l: "Показывать профиль скорости в сечении" },
      { k: "autoTrail", t: "check", l: "Наносить точки опыта на график потерь" }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {};                                   // текущее состояние потока
  var trail = [];                               // точки опыта: [v, h_l]
  var dyeSeed = U.rng(7);
  var volume = 0, volT = 0;                     // мерный бак

  function nu(st) { return U.nu(st.T); }

  /* Скорость в трубе при текущем открытии крана. */
  function solve(st) {
    var d = st.d / 1000, k = st.kmm / 1000, v = 0.3, lam = 0.03, Re = 0;
    var zIn = Hydro.ZETA.inletSharp;
    var zV = st.open <= 0.001 ? 1e9 : U.clamp(0.15 / Math.pow(st.open, 3), 0.15, 1e9);
    for (var i = 0; i < 40; i++) {
      Re = Hydro.reynolds(v, d, nu(st));
      lam = Hydro.lambda(Re, k, d);
      var K = 1 + zIn + zV + lam * st.L / d;
      var vNew = Math.sqrt(2 * Hydro.G * st.H / K);
      if (Math.abs(vNew - v) < 1e-9) { v = vNew; break; }
      v = v + 0.6 * (vNew - v);
    }
    Re = Hydro.reynolds(v, d, nu(st));
    lam = Hydro.lambda(Re, k, d);
    return { v: v, Re: Re, lam: lam, zV: zV };
  }

  S.reset = function () {
    var st = S.state, r = solve(st);
    m = { v: r.v, vEq: r.v, Re: r.Re, lam: r.lam, zV: r.zV, phase: 0 };
    trail = [];
    volume = 0; volT = 0;
    recalc();
  };

  /* Пересчёт производных величин по текущей скорости. */
  function recalc() {
    var st = S.state, d = st.d / 1000, k = st.kmm / 1000;
    m.Re = Hydro.reynolds(m.v, d, nu(st));
    m.lam = Hydro.lambda(m.Re, k, d);
    m.A = Hydro.area(d);
    m.Q = m.v * m.A;                                        // м³/с
    m.hv = Hydro.velHead(m.v);
    m.Lm = st.L * (XP2 - XP1) / (X1 - X0);                  // длина мерного участка
    m.hl = Hydro.hFriction(m.Lm, d, m.v, m.lam);            // потери на мерном участке
    m.hlFull = Hydro.hFriction(st.L, d, m.v, m.lam);
    m.regime = Hydro.regime(m.Re);
    m.vCrit = Hydro.RE_LAM * nu(st) / d;                    // нижняя критическая скорость
    m.vCrit2 = Hydro.RE_TURB * nu(st) / d;
    /* Пуазейль для сравнения: при ламинарном режиме потери прямо пропорциональны скорости. */
    m.hPois = 32 * nu(st) * m.Lm * m.v / (Hydro.G * d * d);
  }

  S.onChange = function () { if (m.v !== undefined) recalc(); };

  S.tick = function (dt) {
    var st = S.state;
    var r = solve(st);
    m.vEq = r.v;
    m.zV = r.zV;
    /* Немного инерции: вода в трубе разгоняется не мгновенно (L/g·dv/dt = ΔH). */
    var tau = U.clamp(st.L / 6, 0.15, 1.2);
    m.v += (m.vEq - m.v) * U.clamp(dt / tau, 0, 1);
    recalc();
    m.phase = (m.phase || 0) + dt * Math.max(0.05, m.v);
    volume += m.Q * 1000 * dt;                               // литры в мерном баке
    volT += dt;
    if (volume > 60) { volume = 0; volT = 0; }               // бак опорожнили

    if (st.autoTrail && m.v > 0.001) {
      var last = trail.length ? trail[trail.length - 1] : null;
      if (!last || Math.abs(Math.log(m.v / last[0])) > 0.02) {
        trail.push([m.v, m.hl]);
        if (trail.length > 400) trail.shift();
      }
    }
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";

  function tubeR(st) { return U.clamp(st.d * 0.62, 7, 26); }   // полувысота трубы на схеме, px

  S.invalidate = function () { built = ""; };

  function build(ui) {
    var st = S.state, r = tubeR(st);
    var key = [st.d, st.L].join("|");
    if (built === key) return;
    built = key;

    var s = SK.open(W, HH);

    // --- напорный бак с переливом
    s += SK.rect(null, 30, 70, 166, 250, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("rw", 32, 96, 162, 222, "water");
    s += SK.line(null, 32, 96, 194, 96, "scale");
    s += SK.txt(null, 38, 90, "tiny muted", "start", "перелив — уровень постоянный");
    s += SK.path(null, "M196 96 H214 V330", "tube");
    s += SK.arrow(null, 20, 300, 44, 300, "tube", 1.6);
    s += SK.txt(null, 20, 292, "tiny muted", "start", "подпитка");
    s += SK.txt(null, 36, 336, "cap", "start", "Напорный бак");

    // --- успокоительная решётка и плавный вход
    s += SK.line(null, 150, 110, 150, 306, "tube", ' stroke-dasharray="3 5"');
    s += SK.txt(null, 150, 330, "tiny muted", "middle", "успокоитель");

    // --- стеклянная труба
    s += SK.rect(null, X0, AX - r, X1 - X0, 2 * r, "glass", ' rx="2"');
    s += SK.rect("water", X0 + 1, AX - r + 1, X1 - X0 - 2, 2 * r - 2, "glass-in");
    s += SK.txt(null, (X0 + X1) / 2, AX + r + 30, "tiny muted", "middle", "стеклянная труба — видно, что делает краска");

    // --- краситель
    s += SK.rect("dyeBottle", XDYE - 26, 40, 52, 44, "glass", ' rx="4"');
    s += SK.rect("dyeLiq", XDYE - 24, 56, 48, 26, "", ' fill="var(--dye)" opacity="0.55" rx="2"');
    s += SK.txt(null, XDYE, 34, "tiny muted", "middle", "краситель");
    s += SK.path(null, "M" + XDYE + " 84 V" + (AX - r - 2), "tube");
    s += SK.circle("dyeTap", XDYE, 110, 7, "clickable", ' fill="var(--panel)" stroke="var(--casing-dark)" stroke-width="1.5"');

    // --- пьезометры мерного участка
    [[XP1, "1"], [XP2, "2"]].forEach(function (p, i) {
      s += SK.path(null, "M" + p[0] + " " + (AX - r) + " V40", "tube");
      s += SK.rect("pz" + i, p[0] - 3, 100, 6, 100, "", ' fill="var(--water)" opacity="0.8"');
      s += SK.txt(null, p[0] + 8, 36, "tiny muted", "start", "пьезометр " + p[1]);
    });
    s += SK.line("hlBar", XP1, 120, XP2, 120, "", ' stroke="var(--bad)" stroke-width="1.5" stroke-dasharray="4 3"');
    s += SK.txt("hlT", (XP1 + XP2) / 2, 114, "val bad", "middle", "");

    // --- кран и мерный бак
    s += SK.valve("valve", X1 + 22, AX, "clickable", 11);
    s += SK.path(null, "M" + X1 + " " + AX + " H" + (X1 + 60) + " V" + (AX + 60), "tube");
    s += SK.rect(null, X1 + 10, AX + 62, 120, 118, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("mw", X1 + 12, AX + 178, 116, 0, "water");
    s += SK.txt(null, X1 + 70, AX + 196, "tiny muted", "middle", "мерный бак");
    s += SK.txt("mwT", X1 + 70, AX + 56, "val", "middle", "");

    // --- струйка краски (заполняется в draw)
    s += SK.path("dyeBand", "", "", ' fill="var(--dye)" opacity="0.18" stroke="none"');
    s += SK.path("dyeLine", "", "dye", "");

    // --- вставка: поперечное сечение с профилем скорости
    s += SK.g("profBox", "", SK.circle(null, 0, 0, 46, "glass") +
      SK.path("profPath", "", "", ' fill="var(--water)" opacity="0.35" stroke="var(--water)" stroke-width="1.5"') +
      SK.line(null, -46, 0, 46, 0, "scale") +
      SK.txt("profT", 0, 66, "tiny muted", "middle", ""),
      ' transform="translate(1075,120)"');

    // --- шильдики
    s += SK.tag("tRe", (X0 + X1) / 2, AX - r - 16, 230, "", "val");
    s += SK.txt("tReg", (X0 + X1) / 2, AX - r - 34, "cap", "middle", "");

    s += SK.close();
    ui.vis.innerHTML = s;

    R = SK.refs(ui.vis, ["rw", "water", "dyeLine", "dyeBand", "dyeLiq", "pz0", "pz1", "hlBar", "hlT",
      "mw", "mwT", "valve", "profPath", "profT", "profBox", "tRe", "tRe_t", "tReg", "dyeTap"]);

    ui.vis.addEventListener("click", function (e) {
      var t = e.target.closest("#valve, #dyeTap, #dyeBottle, #dyeLiq");
      if (!t) return;
      if (t.id === "valve") S.state.open = S.state.open > 0.02 ? 0 : 0.15;
      else S.state.dye = !S.state.dye;
      ui.refresh(); ui.save();
    });
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  /* Боковое смещение струйки краски в точке x (0…1 вдоль трубы). */
  function wiggle(x, t, reg, Re) {
    if (reg === "lam") return 0;
    var grow = Math.pow(U.clamp(x, 0, 1), 1.6);
    if (reg === "trans") {
      var s = (Re - Hydro.RE_LAM) / (Hydro.RE_TURB - Hydro.RE_LAM);
      return grow * s * (0.55 * Math.sin(9 * x - 3.1 * t) + 0.35 * Math.sin(14 * x + 2.2 * t));
    }
    return grow * (0.5 * Math.sin(13 * x - 5 * t) + 0.3 * Math.sin(21 * x + 3.7 * t) + 0.2 * Math.sin(31 * x - 8 * t));
  }

  S.draw = function (ui) {
    build(ui);
    var st = S.state, r = tubeR(st), t = S.anim || 0;

    /* Уровень в баке и вертикальный масштаб напоров: уровень бака = H над осью трубы. */
    var sc = 152 / Math.max(0.2, st.H);                       // px на метр
    SK.set(R.rw, { y: 96, height: 222 });

    /* Пьезометры: напор в точке = H − ζвх·hv − hv − потери до точки. */
    var d = st.d / 1000;
    var hIn = (Hydro.ZETA.inletSharp + 1) * m.hv;
    var h1 = st.H - hIn - Hydro.hFriction(st.L * (XP1 - X0) / (X1 - X0), d, m.v, m.lam);
    var h2 = h1 - m.hl;
    var yTube = AX;
    function pz(el, h) {
      var y = yTube - sc * U.clamp(h, -0.2, st.H + 0.1);
      SK.set(el, { y: Math.min(y, yTube - r), height: Math.max(1, yTube - r - Math.min(y, yTube - r)) });
      return y;
    }
    var y1 = pz(R.pz0, h1), y2 = pz(R.pz1, h2);
    SK.set(R.hlBar, { x1: XP1, y1: y1, x2: XP2, y2: y1 });
    SK.text(R.hlT, m.hl > 0.0005 ? "h тр = " + U.fmt(m.hl * 1000, 1) + " мм" : "");
    SK.set(R.hlT, { x: (XP1 + XP2) / 2, y: Math.min(y1, y2) - 6 });

    /* Струйка краски. */
    var band = "", ln = "";
    if (st.dye && m.v > 0.002) {
      var N = 90, pts = [], up = [], dn = [];
      for (var i = 0; i <= N; i++) {
        var xr = i / N;
        var X = XDYE + (X1 - XDYE) * xr;
        var w = wiggle(xr, t * Math.max(0.4, Math.min(3, m.v * 2)), m.regime, m.Re);
        var amp = (r - 2) * 0.92;
        var Y = AX + U.clamp(w, -1, 1) * amp;
        pts.push([X, Y]);
        var spread = m.regime === "turb" ? Math.pow(xr, 1.2) * (r - 1.5) : (m.regime === "trans" ? Math.pow(xr, 2) * (r - 1.5) * 0.45 : 0);
        up.push([X, Y - spread]); dn.push([X, Y + spread]);
      }
      ln = "M" + pts.map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L");
      if (m.regime !== "lam") {
        band = "M" + up.map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") +
          " L" + dn.reverse().map(function (p) { return SK.n(p[0]) + " " + SK.n(p[1]); }).join(" L") + " Z";
      }
    }
    SK.set(R.dyeLine, { d: ln });
    SK.set(R.dyeBand, { d: band });
    SK.set(R.dyeLiq, { opacity: st.dye ? 0.55 : 0.18 });

    /* Кран. */
    SK.cls(R.valve, "shut", st.open <= 0.02);
    SK.cls(R.valve, "throttled", st.open > 0.02 && st.open < 0.5);

    /* Мерный бак. */
    var hw = U.clamp(volume / 60, 0, 1) * 116;
    SK.set(R.mw, { y: AX + 178 - hw, height: hw });
    SK.text(R.mwT, volT > 0.5 ? U.fmt(volume, 1) + " л за " + U.fmt(volT, 0) + " с" : "");

    /* Профиль скорости. */
    if (st.showProfile) {
      SK.set(R.profBox, { opacity: 1 });
      var Rp = 40, prof = "M0 " + (-Rp);
      var nExp = m.regime === "lam" ? 0 : (m.regime === "trans" ? 5 : 7);
      for (var j = -Rp; j <= Rp; j += 2) {
        var rr = Math.abs(j) / Rp;
        var u = nExp === 0 ? (1 - rr * rr) : Math.pow(Math.max(0, 1 - rr), 1 / nExp);
        prof += " L" + SK.n(u * 42) + " " + j;
      }
      prof += " L0 " + Rp + " Z";
      SK.set(R.profPath, { d: prof });
      SK.text(R.profT, m.regime === "lam" ? "парабола: vmax = 2·vср" :
        (m.regime === "turb" ? "логарифмический: vmax ≈ 1,2·vср" : "профиль перестраивается"));
    } else {
      SK.set(R.profBox, { opacity: 0 });
    }

    /* Шильдик с режимом. */
    SK.text(R.tRe_t, "v = " + U.fmt(m.v, 3) + " м/с   Re = " + U.fmt(m.Re, 0));
    SK.text(R.tReg, Hydro.regimeName(m.Re).toUpperCase() + " режим");
    SK.set(R.tReg, { fill: m.regime === "lam" ? "var(--good)" : (m.regime === "trans" ? "var(--warn)" : "var(--bad)") });

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "hv", title: "Потери напора и скорость (логарифмические оси)", h: 320 },
    { id: "moody", title: "Коэффициент λ и число Рейнольдса", h: 320 }
  ];

  function drawCharts(ui) {
    var st = S.state, d = st.d / 1000, k = st.kmm / 1000, nuT = nu(st);

    /* --- потери от скорости, lg—lg */
    var f = U.fitCanvas(ui.canvas("hv"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: -2.3, x1: 0.9, y0: -4.2, y1: 0.3,
      xLabel: "скорость v, м/с", yLabel: "потери на участке, м",
      xFmt: function (x) { return U.fmt(Math.pow(10, x), Math.pow(10, x) < 0.1 ? 2 : (Math.pow(10, x) < 1 ? 2 : 1)); },
      xTicks: 6, yTicks: 6
    });
    /* Подписи оси Y — степени десяти, поэтому рисуем свои. */
    var lam = [], turb = [], i, v, hl;
    for (i = -23; i <= 9; i++) {
      v = Math.pow(10, i / 10);
      hl = 32 * nuT * m.Lm * v / (Hydro.G * d * d);
      lam.push([i / 10, Math.log(hl) / Math.LN10]);
      var Re = Hydro.reynolds(v, d, nuT);
      var lm = Hydro.lambda(Math.max(Re, 4000), k, d);
      turb.push([i / 10, Math.log(Hydro.hFriction(m.Lm, d, v, lm)) / Math.LN10]);
    }
    var vc = Math.log(m.vCrit) / Math.LN10, vc2 = Math.log(m.vCrit2) / Math.LN10;
    Plot.bandX(p, vc, vc2, U.css("--warn"), 0.14);
    Plot.clip(p);
    Plot.line(p, lam, { color: U.css("--good"), width: 1.6, dash: [6, 4] });
    Plot.line(p, turb, { color: U.css("--bad"), width: 1.6, dash: [6, 4] });
    var tp = trail.map(function (q) { return [Math.log(q[0]) / Math.LN10, Math.log(Math.max(q[1], 1e-7)) / Math.LN10]; });
    Plot.line(p, tp, { color: U.css("--accent"), width: 2.4 });
    if (m.v > 0.002 && m.hl > 1e-7) {
      Plot.dot(p, Math.log(m.v) / Math.LN10, Math.log(m.hl) / Math.LN10, 5, U.css("--accent"), U.css("--panel"), 2);
    }
    Plot.unclip(p);
    Plot.vline(p, vc, { color: U.css("--warn"), dash: [5, 4] });
    Plot.label(p, vc, p.y0 + (p.y1 - p.y0) * 0.97, " vкр = " + U.fmt(m.vCrit, 3) + " м/с", U.css("--warn"), "left", "top", true);
    Plot.legend(p, [
      { color: U.css("--good"), text: "ламинарный закон: h ~ v (Пуазейль)", dash: [6, 4] },
      { color: U.css("--bad"), text: "турбулентный: h ~ v^1,75…2", dash: [6, 4] },
      { color: U.css("--accent"), text: "опыт (точки стенда)" }
    ]);

    /* --- λ(Re): кусочек диаграммы Никурадзе — Муди */
    var f2 = U.fitCanvas(ui.canvas("moody"));
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 2, x1: 6, y0: -1.75, y1: -0.7,
      xLabel: "Re", yLabel: "λ",
      xFmt: function (x) { var v10 = Math.pow(10, x); return v10 >= 1e4 ? U.fmt(v10 / 1000, 0) + " тыс." : U.fmt(v10, 0); },
      yTicks: 5, xTicks: 5
    });
    var cl = [], cw = [], al = [];
    for (i = 20; i <= 60; i++) {
      var Rex = Math.pow(10, i / 10);
      cl.push([i / 10, Math.log(64 / Rex) / Math.LN10]);
      cw.push([i / 10, Math.log(Hydro.lambda(Math.max(Rex, Hydro.RE_TURB), k, d)) / Math.LN10]);
      al.push([i / 10, Math.log(Hydro.lambdaAltshul(Math.max(Rex, Hydro.RE_TURB), k, d)) / Math.LN10]);
    }
    Plot.bandX(p2, Math.log(Hydro.RE_LAM) / Math.LN10, Math.log(Hydro.RE_TURB) / Math.LN10, U.css("--warn"), 0.14);
    Plot.clip(p2);
    Plot.line(p2, cl, { color: U.css("--good"), width: 2 });
    Plot.line(p2, cw, { color: U.css("--bad"), width: 2 });
    Plot.line(p2, al, { color: U.css("--est"), width: 1.5, dash: [5, 4] });
    if (m.Re > 100) Plot.dot(p2, Math.log(m.Re) / Math.LN10, Math.log(m.lam) / Math.LN10, 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--good"), text: "λ = 64/Re" },
      { color: U.css("--bad"), text: "Колбрук — Уайт" },
      { color: U.css("--est"), text: "Альтшуль", dash: [5, 4] },
      { color: U.css("--accent"), text: "стенд сейчас", dot: true }
    ]);
  }

  /* ------------------------------------------------------------ показания и пояснения */

  S.readings = function () {
    var st = S.state;
    return [
      { n: "Скорость в трубе v", v: U.fmt(m.v, 3) + " м/с" },
      { n: "Число Рейнольдса Re = v·d/ν", v: U.fmt(m.Re, 0), cls: m.regime === "lam" ? "good" : (m.regime === "trans" ? "warn" : "bad") },
      { n: "Режим", v: Hydro.regimeName(m.Re), cls: m.regime === "lam" ? "good" : (m.regime === "trans" ? "warn" : "bad") },
      { n: "Расход Q", v: U.fmt(m.Q * 1000, 3) + " л/с (" + U.fmt(m.Q * 3600, 2) + " м³/ч)" },
      { h: "Вода" },
      { n: "Вязкость ν при " + U.fmt(st.T, 0) + " °C", v: U.fmt(nu(st) * 1e6, 3) + "·10⁻⁶ м²/с" },
      { n: "Критическая скорость (Re = 2320)", v: U.fmt(m.vCrit, 3) + " м/с" },
      { n: "Верхняя граница (Re = 4000)", v: U.fmt(m.vCrit2, 3) + " м/с" },
      { h: "Потери на мерном участке " + U.fmt(m.Lm, 2) + " м" },
      { n: "Коэффициент λ", v: U.fmt(m.lam, 4) },
      { n: "Потери по длине h", v: U.fmt(m.hl * 1000, 2) + " мм (" + U.fmt(m.hl, 4) + " м)" },
      { n: "То же по Пуазейлю (h ~ v)", v: U.fmt(m.hPois * 1000, 2) + " мм", cls: "sub" },
      { n: "Скоростной напор v²/2g", v: U.fmt(m.hv * 1000, 1) + " мм" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [];
    if (m.v < 0.002) {
      out.push({ lvl: "info", text: "Кран закрыт, вода стоит. Краска в неподвижной воде почти не расплывается — только молекулярная диффузия, и та медленная." });
      return out;
    }
    if (m.regime === "lam") {
      out.push({ lvl: "good", text: "<b>Ламинарный режим</b> (Re = " + U.fmt(m.Re, 0) + " < 2320). Слои воды скользят друг по другу не перемешиваясь, и краска идёт тонкой нитью до самого крана. Профиль скорости — парабола: у стенки ноль, на оси вдвое больше средней." });
      out.push({ lvl: "info", text: "Потери здесь прямо пропорциональны скорости: h = 32·ν·L·v/(g·d²). На логарифмическом графике это прямая с наклоном 1 — откройте кран сильнее и увидите, как точки свернут на более крутую линию." });
      out.push({ lvl: "info", text: "До срыва осталось немного: критическая скорость " + U.fmt(m.vCrit, 3) + " м/с, сейчас " + U.fmt(m.v, 3) + " м/с (" + U.fmt(100 * m.v / m.vCrit, 0) + " %)." });
    } else if (m.regime === "trans") {
      out.push({ lvl: "warn", text: "<b>Переходная область</b> (2320 < Re = " + U.fmt(m.Re, 0) + " < 4000). Нить краски начинает вилять и время от времени рвётся: возмущения уже не затухают, но ещё не захватили весь поток. Именно это увидел Рейнольдс, медленно открывая кран." });
      out.push({ lvl: "info", text: "В этой зоне опыт плохо повторяется: если вход в трубу сделать очень плавным, а стенд не трясти, ламинарное течение держится и до Re = 10 000 и больше. Нижнее критическое число 2320 устойчиво, верхнее — нет." });
    } else {
      out.push({ lvl: "bad", text: "<b>Турбулентный режим</b> (Re = " + U.fmt(m.Re, 0) + " > 4000). Краска размывается по всему сечению почти сразу за иглой: поперечные пульсации перемешивают воду. Профиль скорости стал «наполненным», у стенки остаётся только тонкий вязкий подслой." });
      out.push({ lvl: "info", text: "Потери растут уже почти как квадрат скорости (в гладкой трубе h ~ v^1,75, в шероховатой — ровно v²). Вдвое больше расход — вчетверо больше потери: отсюда всё проектирование трубопроводов." });
    }
    out.push({
      lvl: "info",
      text: "При " + U.fmt(st.T, 0) + " °C вязкость ν = " + U.fmt(nu(st) * 1e6, 3) + "·10⁻⁶ м²/с. " +
        (st.T > 50 ? "Горячая вода жиже, Re при той же скорости выше — в подающем трубопроводе отопления турбулентность наступает раньше."
                   : "Нагрейте воду до 80 °C, не трогая кран: скорость почти не изменится, а Re вырастет примерно втрое — режим сорвётся сам собой.")
    });
    if (st.d <= 8) {
      out.push({ lvl: "info", text: "В тонкой трубке ламинарный режим держится до больших скоростей: Re = v·d/ν, и маленький d тянет Re вниз. Поэтому в капиллярах, в фильтрующем грунте и в узких щелях течение почти всегда ламинарное." });
    }
    var vWater = 1.0, ReWater = vWater * (0.02) / nu(st);
    out.push({ lvl: "info", text: "Для сравнения: в бытовом водопроводе d = 20 мм при v = 1 м/с даёт Re ≈ " + U.fmt(ReWater, 0) + ". Ламинарного течения в водопроводе не бывает — только турбулентное." });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Поймать критическую скорость", tag: "★ главный",
      preset: { d: 25, L: 3, H: 1.2, T: 20, open: 0.03, dye: true, autoTrail: true },
      speed: 1,
      steps: [
        "Кран приоткрыт чуть-чуть, краска идёт ровной нитью.",
        "Очень медленно двигайте ползунок «Открытие крана» вправо — по одному-два процента.",
        "Как только нить начнёт вилять, остановитесь и запишите скорость и Re.",
        "Откройте ещё немного — нить порвётся и размоется."
      ],
      watch: [
        "Нить краски: прямая → волнистая → облако.",
        "Число Рейнольдса в момент срыва: должно получиться около 2300.",
        "Жёлтая полоса на графиках — переходная область 2320…4000.",
        "Профиль скорости в сечении: парабола сменяется «наполненным»."
      ],
      why: "Рейнольдс в 1883 году показал, что режим определяет не скорость сама по себе, а безразмерное отношение сил инерции к силам вязкости: Re = v·d/ν. Ниже 2320 возмущения гасятся вязкостью, выше — нарастают и превращаются в турбулентность."
    },
    {
      title: "2. Сменить режим, не трогая кран", tag: "температура",
      preset: { d: 25, L: 3, H: 0.8, T: 5, open: 0.06, dye: true },
      speed: 1,
      steps: [
        "Вода холодная, 5 °C, кран не трогаем — нить краски ровная.",
        "Ползунком «Температура воды» грейте воду до 80 °C.",
        "Следите за Re и за нитью."
      ],
      watch: [
        "Скорость меняется мало, а Re растёт почти втрое.",
        "Нить краски срывается сама, хотя кран стоит на месте.",
        "Вязкость в показаниях: 1,52 → 0,37·10⁻⁶ м²/с."
      ],
      why: "Re = v·d/ν. Вязкость воды при нагреве от 5 до 80 °C падает в четыре раза, поэтому одно и то же течение из ламинарного становится турбулентным. По этой же причине горячая вода «шумит» в трубах сильнее холодной."
    },
    {
      title: "3. Капилляр: ламинарный режим при больших скоростях", tag: "диаметр",
      preset: { d: 4, L: 3, H: 3, T: 20, open: 1, dye: true },
      speed: 1,
      steps: [
        "Диаметр 4 мм, кран открыт полностью, напор максимальный.",
        "Посмотрите на скорость и на Re.",
        "Увеличивайте диаметр до 60 мм, не трогая кран."
      ],
      watch: [
        "В тонкой трубке скорость приличная, а Re всё равно невелик.",
        "С ростом диаметра Re растёт: он пропорционален d.",
        "Потери в тонкой трубке огромны — смотрите на пьезометры."
      ],
      why: "В тонких каналах вязкость побеждает инерцию: движение грунтовых вод, течение в капиллярах и щелях, смазка в подшипниках — всё это ламинарные потоки. Там работает закон Пуазейля: расход пропорционален четвёртой степени диаметра."
    },
    {
      title: "4. Две степени: собрать график потерь", tag: "потери",
      preset: { d: 20, L: 4, H: 2, T: 20, open: 0.01, dye: true, autoTrail: true },
      speed: 1,
      steps: [
        "Нажмите «Сброс» — точки опыта очистятся.",
        "Плавно откройте кран от нуля до конца за 20–30 секунд.",
        "Смотрите на верхний график: точки стенда ложатся на теоретические линии."
      ],
      watch: [
        "В ламинарной части точки идут по зелёной линии с наклоном 1.",
        "После переходной зоны они перескакивают на красную линию с наклоном ≈ 1,8.",
        "Излом — это и есть смена закона сопротивления."
      ],
      why: "Никурадзе повторил опыт Рейнольдса с измерением потерь и получил тот самый излом. В ламинарной области h ~ v, в турбулентной h ~ v^1,75 (гладкие трубы) и до v² (вполне шероховатые). Логарифмические оси превращают степенную зависимость в прямую, а показатель степени — в наклон."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Что именно сделал Рейнольдс</h3>' +
    "<p>Установка 1883 года выглядела почти так же, как на этой схеме: бак с постоянным уровнем, горизонтальная стеклянная труба, кран на выходе и тонкая игла, подающая краску в центр потока у самого входа.</p>" +
    "<p>Открывая кран по чуть-чуть, Рейнольдс увидел три картины: ровная окрашенная нить; нить, которая начинает колебаться и рваться; и полное перемешивание, когда вся вода в трубе окрашивается равномерно. Главный вывод: граница между режимами определяется не скоростью, а комбинацией</p>" +
    '<p class="formula">Re = v·d/ν — отношение сил инерции к силам вязкости.</p>' +
    "<p>Одно и то же значение Re можно получить разной скоростью, разным диаметром, разной жидкостью — картина течения будет одинаковой. Это первый пример гидродинамического подобия.</p></section>" +

    '<section class="card txt"><h3>Критические числа</h3>' +
    "<ul><li><b>Re &lt; 2320</b> — ламинарный режим. Устойчив: любое возмущение гасится вязкостью.</li>" +
    "<li><b>2320 … 4000</b> — переходная область. Режим неустойчив и зависит от того, насколько плавный вход, нет ли вибрации, есть ли шероховатость.</li>" +
    "<li><b>Re &gt; 4000</b> — развитая турбулентность.</li></ul>" +
    "<p>Нижнее критическое число 2320 воспроизводится надёжно: ниже него турбулентность гаснет всегда. Верхнее — нет: в тщательно сделанных установках ламинарное течение удавалось удержать до Re в десятки тысяч.</p>" +
    "<p>В практике водоснабжения всё это академично: при обычных скоростях 0,5…2 м/с и диаметрах от 15 мм Re составляет десятки и сотни тысяч. Ламинарный режим встречается в фильтрах, в грунте, в капиллярах и при перекачке вязких жидкостей.</p></section>" +

    '<section class="card txt"><h3>Почему меняется закон потерь</h3>' +
    "<p>При ламинарном течении энергия тратится только на вязкое трение слоёв, и закон Пуазейля даёт прямую пропорциональность:</p>" +
    '<p class="formula">h = 32·ν·L·v/(g·d²),  то есть λ = 64/Re.</p>' +
    "<p>При турбулентном течении к вязкому трению добавляется перенос импульса поперёк потока — вихрями. Он пропорционален квадрату скорости, поэтому потери растут почти как v². В гладких трубах остаётся вязкий подслой, и показатель степени немного меньше двойки (λ = 0,3164/Re^0,25 — формула Блазиуса); в шероховатых подслой «тонет» в бугорках, и λ перестаёт зависеть от Re вовсе — это квадратичная область.</p>" +
    "<p>На нижнем графике это видно: зелёная и красная кривые разного наклона и жёлтая полоса неопределённости между ними.</p></section>" +

    '<section class="card txt"><h3>Профиль скорости</h3>' +
    "<p>Ламинарный профиль — парабола. Средняя скорость ровно вдвое меньше осевой, а напряжение трения линейно растёт от оси к стенке.</p>" +
    "<p>Турбулентный профиль «наполненный»: почти по всему сечению скорость близка к средней (отношение осевой к средней около 1,15…1,25), и весь перепад скорости сосредоточен в тонком пристенном слое. Поэтому турбулентный поток лучше перемешивает примеси, лучше отдаёт тепло стенке — и сильнее сопротивляется движению.</p>" +
    "<p>Включите галочку «Показывать профиль скорости» и меняйте расход: кружок в правом верхнем углу перестраивается вместе с режимом.</p></section>";

  Lab.register(S);
})();
