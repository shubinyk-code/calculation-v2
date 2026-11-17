/* Стенд 8. Характеристика насоса Q–H: параллельная и последовательная работа,
   регулирование частотой против дросселирования.

   Кривая насоса  H = H0·r² − B·Q²  (r — относительная частота).
   Параллельно n насосов:  H(Q) = H0·r² − B·(Q/n)²  — складываются расходы.
   Последовательно:        H(Q) = n·(H0·r² − B·Q²)  — складываются напоры.
   Сеть:                   H = Hст + K·Q².
   Рабочая точка — пересечение; оно находится аналитически. */
(function () {
  "use strict";

  var W = 1180, HH = 400;

  var S = {
    id: "pumps", group: "water",
    title: "Характеристика насоса Q–H",
    lead: "Два насоса параллельно дают не удвоенный расход, а два последовательно — не удвоенный напор. Всё решает крутизна сети. Здесь же видно, чем дросселирование отличается от частотного регулирования.",
    hint: "Щелчок по насосу включает и выключает его. Зелёная точка — рабочая: пересечение кривой насосов с кривой сети.",
    vis: { kind: "svg" },
    speeds: false
  };

  S.defaults = function () {
    return {
      n: 2,
      arrange: "par",     // параллельно / последовательно
      H0: 60, Qopt: 30, Hopt: 45, etaMax: 0.72,
      freq: 50,
      Hst: 20,            // статический напор (геометрия + остаточный)
      valve: 1.0,         // открытие задвижки
      Kmin: 0.012         // сопротивление сети при открытой задвижке, м/(м³/ч)²
    };
  };

  S.fields = [
    { title: "Насосная группа", open: true, fields: [
      { k: "n", t: "range", l: "Число насосов в работе", u: "шт", min: 1, max: 4, step: 1, d: 0 },
      { k: "arrange", t: "select", l: "Схема включения", opts: [["par", "параллельно"], ["ser", "последовательно"]] },
      { k: "freq", t: "range", l: "Частота (ПЧ)", u: "Гц", min: 15, max: 50, step: 0.5, d: 1 },
      { k: "valve", t: "range", l: "Открытие задвижки на напоре", u: "%", min: 0.08, max: 1, step: 0.01, pct: true, d: 0 }
    ] },
    { title: "Насос", fields: [
      { k: "H0", t: "range", l: "Напор при Q = 0", u: "м", min: 10, max: 120, step: 1, d: 0 },
      { k: "Qopt", t: "range", l: "Подача в оптимуме", u: "м³/ч", min: 5, max: 80, step: 1, d: 0 },
      { k: "Hopt", t: "range", l: "Напор в оптимуме", u: "м", min: 5, max: 110, step: 1, d: 0 },
      { k: "etaMax", t: "range", l: "КПД в оптимуме", u: "%", min: 0.3, max: 0.88, step: 0.01, pct: true, d: 0 }
    ] },
    { title: "Сеть", fields: [
      { k: "Hst", t: "range", l: "Статический напор", u: "м", min: 0, max: 80, step: 1, d: 0,
        hint: "Геодезическая высота плюс требуемый остаточный напор. Чем он больше, тем меньше толку от параллельной работы." },
      { k: "Kmin", t: "range", l: "Сопротивление сети (при открытой задвижке)", u: "", min: 0.001, max: 0.08, step: 0.001, d: 3 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {};

  function coef(st) { return { B: (st.H0 - st.Hopt) / Math.max(st.Qopt * st.Qopt, 1e-6) }; }
  function pumpH(st, c, Q, r) { return st.H0 * r * r - c.B * Q * Q; }
  function groupH(st, c, Q, r, n, arrange) {
    if (n <= 0) return -1e9;
    return arrange === "ser" ? n * pumpH(st, c, Q, r) : pumpH(st, c, Q / n, r);
  }
  function sysK(st) { return st.Kmin / Math.pow(U.clamp(st.valve, 0.05, 1), 2.6); }
  function sysH(st, Q) { return st.Hst + sysK(st) * Q * Q; }

  /* Пересечение аналитически: H0 r² − B(Q/n)² = Hst + K Q². */
  function operate(st, c, r, n, arrange, K) {
    var a, Hmax;
    if (arrange === "ser") { a = n * c.B; Hmax = n * st.H0 * r * r; }
    else { a = c.B / (n * n); Hmax = st.H0 * r * r; }
    var num = Hmax - st.Hst;
    if (num <= 0) return { Q: 0, H: Math.max(st.Hst, Hmax) };
    var Q = Math.sqrt(num / (a + K));
    return { Q: Q, H: st.Hst + K * Q * Q };
  }

  function eta(st, c, Q, r) {
    if (r <= 0 || Q <= 0) return 0;
    var x = Q / (st.Qopt * r);
    return U.clamp(st.etaMax * (2 * x - x * x), 0, 0.95);
  }

  function compute(st) {
    var c = coef(st), r = st.freq / 50, K = sysK(st);
    var op = operate(st, c, r, st.n, st.arrange, K);
    var qEach = st.arrange === "ser" ? op.Q : op.Q / st.n;
    var hEach = st.arrange === "ser" ? op.H / st.n : op.H;
    var e = eta(st, c, qEach, r);
    var Pshaft = e > 0.02 ? 1000 * Hydro.G * (qEach / 3600) * Math.max(hEach, 0) / 1000 / e : 0;

    /* Для сравнения: один насос и та же сеть; и что было бы без дросселирования. */
    var op1 = operate(st, c, r, 1, st.arrange, K);
    var Kopen = st.Kmin;
    var opOpen = operate(st, c, r, st.n, st.arrange, Kopen);

    /* Сколько нужно частоты, чтобы получить текущий расход при полностью открытой задвижке. */
    var rNeed = U.bisect(function (rr) {
      return operate(st, c, rr, st.n, st.arrange, Kopen).Q - op.Q;
    }, 0.05, 1.2, 50);
    var opVfd = operate(st, c, rNeed, st.n, st.arrange, Kopen);
    var qEachV = st.arrange === "ser" ? opVfd.Q : opVfd.Q / st.n;
    var hEachV = st.arrange === "ser" ? opVfd.H / st.n : opVfd.H;
    var eV = eta(st, c, qEachV, rNeed);
    var PvfdOne = eV > 0.02 ? 1000 * Hydro.G * (qEachV / 3600) * Math.max(hEachV, 0) / 1000 / eV : 0;

    m = {
      c: c, r: r, K: K, op: op, op1: op1, opOpen: opOpen,
      qEach: qEach, hEach: hEach, eta: e, P: Pshaft, Ptot: Pshaft * st.n,
      rNeed: rNeed, opVfd: opVfd, Pvfd: PvfdOne * st.n,
      gain: op1.Q > 1e-6 ? op.Q / op1.Q : 0,
      hThrottle: op.H - (st.Hst + Kopen * op.Q * op.Q),
      Phyd: 1000 * Hydro.G * (op.Q / 3600) * Math.max(op.H, 0) / 1000
    };
  }

  S.reset = function () { compute(S.state); };
  S.onChange = function () { compute(S.state); };
  S.draw = function (ui) { compute(S.state); drawScheme(ui); drawCharts(ui); };

  /* ------------------------------------------------------------ схема */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    var st = S.state;
    var key = [st.n, st.arrange].join("|");
    if (built === key) return;
    built = key;
    var s = SK.open(W, HH), i, n = st.n;

    s += SK.rect(null, 40, 230, 150, 130, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect(null, 42, 270, 146, 88, "water");
    s += SK.txt(null, 46, 224, "cap", "start", "приёмный резервуар");

    var xs = [], ys = [];
    for (i = 0; i < n; i++) {
      if (st.arrange === "par") { xs.push(420); ys.push(120 + i * 70); }
      else { xs.push(300 + i * 150); ys.push(220); }
    }
    // трубы
    if (st.arrange === "par") {
      s += SK.path(null, "M190 300 H300 V" + ys[0] + " V" + ys[n - 1], "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
      s += SK.path(null, "M540 " + ys[0] + " V" + ys[n - 1] + " M540 " + ys[0] + " H760", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
      for (i = 0; i < n; i++) {
        s += SK.path(null, "M300 " + ys[i] + " H" + (xs[i] - 26), "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
        s += SK.path(null, "M" + (xs[i] + 26) + " " + ys[i] + " H540", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
      }
    } else {
      s += SK.path(null, "M190 300 H" + (xs[0] - 26) + " M" + (xs[n - 1] + 26) + " 220 H760", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
      s += SK.path(null, "M190 300 V220 H" + (xs[0] - 26), "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
      for (i = 0; i < n - 1; i++) s += SK.path(null, "M" + (xs[i] + 26) + " 220 H" + (xs[i + 1] - 26), "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
    }
    for (i = 0; i < n; i++) {
      s += SK.g("p" + i, "clickable", SK.circle(null, 0, 0, 26, "", ' fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"') +
        SK.path("imp" + i, "M-13 0 L13 0 M0 -13 L0 13", "", ' stroke="var(--accent)" stroke-width="2.5"') +
        SK.txt("pT" + i, 0, 44, "tiny", "middle", ""),
        ' transform="translate(' + xs[i] + "," + ys[i] + ')"');
    }
    s += SK.valve("valve", 800, st.arrange === "par" ? ys[0] : 220, "clickable", 12);
    s += SK.path(null, "M812 " + (st.arrange === "par" ? ys[0] : 220) + " H980", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="9"');
    s += SK.rect(null, 980, 60, 150, 300, "tank-wall", ' rx="3" fill-opacity="0"');
    s += SK.rect("wtop", 982, 120, 146, 238, "water");
    s += SK.txt(null, 986, 54, "cap", "start", "напорный бак");
    s += SK.txt("hstT", 1055, 380, "tiny muted", "middle", "");
    s += SK.txt("opT", 600, 330, "val", "middle", "");
    s += SK.txt("opT2", 600, 354, "tiny muted", "middle", "");

    s += SK.close();
    ui.vis.innerHTML = s;
    var ids = ["valve", "wtop", "hstT", "opT", "opT2"];
    for (i = 0; i < n; i++) ids.push("p" + i, "imp" + i, "pT" + i);
    R = SK.refs(ui.vis, ids);
    ui.vis.addEventListener("click", function (e) {
      if (e.target.closest("#valve")) { S.state.valve = S.state.valve > 0.5 ? 0.3 : 1; ui.refresh(); ui.save(); return; }
      for (var j = 0; j < 4; j++) {
        if (R["p" + j] && e.target.closest("#p" + j)) {
          S.state.n = Math.max(1, j === S.state.n - 1 ? S.state.n - 1 : j + 1);
          built = "";
          build(ui);
          ui.refresh(); ui.save();
          return;
        }
      }
    });
  }

  function drawScheme(ui) {
    build(ui);
    var st = S.state, i;
    for (i = 0; i < st.n; i++) {
      SK.set(R["imp" + i], { transform: "rotate(" + ((S.anim || 0) * 300 * m.r % 360) + ")" });
      SK.text(R["pT" + i], "насос " + (i + 1) + ": " + U.fmt(m.qEach, 1) + " м³/ч, " + U.fmt(m.hEach, 1) + " м");
    }
    SK.cls(R.valve, "throttled", st.valve < 0.9);
    SK.cls(R.valve, "shut", st.valve <= 0.1);
    SK.text(R.hstT, "статический напор " + U.fmt(st.Hst, 0) + " м");
    SK.text(R.opT, "рабочая точка: " + U.fmt(m.op.Q, 1) + " м³/ч при " + U.fmt(m.op.H, 1) + " м");
    SK.text(R.opT2, "КПД " + U.fmt(m.eta * 100, 0) + " % · мощность группы " + U.fmt(m.Ptot, 2) + " кВт · частота " + U.fmt(st.freq, 1) + " Гц");
  }

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "qh", title: "Кривые насосов и сети", h: 400 },
    { id: "cmp", title: "Что даёт следующий насос и чем дросселирование хуже ПЧ", h: 400 }
  ];

  function drawCharts(ui) {
    var st = S.state, c = m.c, i, q;
    var Qmax = Math.max(st.Qopt * 2.4 * st.n, m.op.Q * 1.3, 10);
    var Hmax = Math.max(st.H0 * (st.arrange === "ser" ? st.n : 1) * 1.15, st.Hst * 1.2, 10);

    var f = U.fitCanvas(ui.canvas("qh"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: Qmax, y0: 0, y1: Hmax,
      xLabel: "подача Q, м³/ч", yLabel: "напор H, м",
      y2: [0, 100], y2Label: "КПД, %"
    });
    Plot.clip(p);
    /* кривые для 1…n насосов */
    for (var k = 1; k <= st.n; k++) {
      var pts = [];
      for (i = 0; i <= 120; i++) {
        q = Qmax * i / 120;
        var h = groupH(st, c, q, m.r, k, st.arrange);
        if (h < 0) break;
        pts.push([q, h]);
      }
      Plot.line(p, pts, {
        color: k === st.n ? U.css("--p1") : U.css("--muted"),
        width: k === st.n ? 2.4 : 1.3, dash: k === st.n ? null : [5, 4]
      });
    }
    /* кривая при 50 Гц, если частота снижена */
    if (st.freq < 49.9) {
      var p50 = [];
      for (i = 0; i <= 120; i++) {
        q = Qmax * i / 120;
        var h50 = groupH(st, c, q, 1, st.n, st.arrange);
        if (h50 < 0) break;
        p50.push([q, h50]);
      }
      Plot.line(p, p50, { color: U.css("--p1"), width: 1.2, dash: [3, 3], alpha: 0.7 });
    }
    /* сеть */
    var sys = [], sysOpen = [];
    for (i = 0; i <= 120; i++) {
      q = Qmax * i / 120;
      sys.push([q, sysH(st, q)]);
      sysOpen.push([q, st.Hst + st.Kmin * q * q]);
    }
    Plot.line(p, sys, { color: U.css("--water"), width: 2.2 });
    if (st.valve < 0.99) Plot.line(p, sysOpen, { color: U.css("--water"), width: 1.3, dash: [5, 4] });
    /* КПД */
    var ep = [];
    for (i = 1; i <= 120; i++) {
      q = Qmax * i / 120;
      var qe = st.arrange === "ser" ? q : q / st.n;
      ep.push([q, eta(st, c, qe, m.r) * 100]);
    }
    Plot.line(p, ep, { color: U.css("--p3"), width: 1.4, dash: [6, 3] }, true);
    Plot.unclip(p);
    Plot.dot(p, m.op.Q, m.op.H, 6, U.css("--good"), U.css("--panel"), 2);
    if (st.n > 1) Plot.dot(p, m.op1.Q, m.op1.H, 4.5, U.css("--muted"), U.css("--panel"), 1.5);
    Plot.legend(p, [
      { color: U.css("--p1"), text: st.n + " насос(а) " + (st.arrange === "ser" ? "последовательно" : "параллельно") + " при " + U.fmt(st.freq, 0) + " Гц" },
      { color: U.css("--muted"), text: "меньшее число насосов", dash: [5, 4] },
      { color: U.css("--water"), text: "сеть" },
      { color: U.css("--p3"), text: "КПД одного насоса", dash: [6, 3] },
      { color: U.css("--good"), text: "рабочая точка", dot: true }
    ]);

    /* --- сравнение */
    var f2 = U.fitCanvas(ui.canvas("cmp"));
    var items = [];
    for (k = 1; k <= 4; k++) {
      var o = operate(st, c, m.r, k, st.arrange, m.K);
      items.push({ y: o.Q, color: k === st.n ? U.css("--accent") : U.css("--water"), label: k + " нас." });
    }
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 1, y0: 0, y1: Plot.niceMax(Math.max.apply(null, items.map(function (x) { return x.y; })) * 1.2),
      yLabel: "подача группы, м³/ч", noXLabels: true, pad: { l: 50, r: 150, t: 14, b: 46 }
    });
    Plot.bars(p2, items, 0.55);
    var txt = [
      "Прирост от второго насоса: " + (items[0].y > 0 ? U.fmt(100 * (items[1].y / items[0].y - 1), 0) + " %" : "—"),
      "от третьего: " + (items[1].y > 0 ? U.fmt(100 * (items[2].y / items[1].y - 1), 0) + " %" : "—"),
      "",
      "Сейчас: " + U.fmt(m.op.Q, 1) + " м³/ч",
      "Мощность группы: " + U.fmt(m.Ptot, 2) + " кВт",
      "",
      "Тот же расход частотой:",
      "  " + U.fmt(m.rNeed * 50, 1) + " Гц, задвижка открыта",
      "  мощность " + U.fmt(m.Pvfd, 2) + " кВт",
      m.Ptot > 0.01 ? "  экономия " + U.fmt(100 * (1 - m.Pvfd / m.Ptot), 0) + " %" : "",
      "",
      "На задвижке теряется " + U.fmt(Math.max(0, m.hThrottle), 1) + " м"
    ];
    var ctx = p2.ctx;
    ctx.save();
    ctx.font = "11.5px system-ui, Segoe UI, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = U.css("--ink");
    txt.forEach(function (line, idx) { ctx.fillText(line, p2.R + 10, p2.T + 4 + idx * 16); });
    ctx.restore();
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state;
    return [
      { n: "Рабочая точка группы", v: U.fmt(m.op.Q, 1) + " м³/ч · " + U.fmt(m.op.H, 1) + " м" },
      { n: "На один насос", v: U.fmt(m.qEach, 1) + " м³/ч · " + U.fmt(m.hEach, 1) + " м" },
      { n: "КПД насоса", v: U.fmt(m.eta * 100, 0) + " %", cls: m.eta > 0.6 ? "good" : (m.eta > 0.4 ? "warn" : "bad") },
      { n: "Мощность на валу (один / группа)", v: U.fmt(m.P, 2) + " / " + U.fmt(m.Ptot, 2) + " кВт" },
      { n: "Полезная гидравлическая мощность", v: U.fmt(m.Phyd, 2) + " кВт", cls: "sub" },
      { h: "Сравнение" },
      { n: "Один насос дал бы", v: U.fmt(m.op1.Q, 1) + " м³/ч" },
      { n: "Прирост от группы", v: U.fmt(m.gain, 2) + "× при " + st.n + " насосах",
        cls: m.gain > st.n * 0.8 ? "good" : "warn" },
      { n: "Без дросселирования было бы", v: U.fmt(m.opOpen.Q, 1) + " м³/ч" },
      { n: "Потеряно на задвижке", v: U.fmt(Math.max(0, m.hThrottle), 1) + " м" },
      { h: "Тот же расход частотой" },
      { n: "Нужная частота", v: U.fmt(m.rNeed * 50, 1) + " Гц" },
      { n: "Мощность группы при ПЧ", v: U.fmt(m.Pvfd, 2) + " кВт" },
      { n: "Экономия", v: m.Ptot > 0.01 ? U.fmt(100 * (1 - m.Pvfd / m.Ptot), 0) + " %" : "—", cls: "good" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [];
    var slope = m.K * m.op.Q * m.op.Q;
    var statPart = m.op.H > 0 ? st.Hst / m.op.H : 0;

    if (st.arrange === "par") {
      out.push({
        lvl: statPart > 0.6 ? "warn" : "info",
        text: st.n === 1
          ? "Один насос: рабочая точка — пересечение его кривой с кривой сети. Включите второй и посмотрите, что будет."
          : "Параллельно " + st.n + " насоса дают " + U.fmt(m.op.Q, 1) + " м³/ч — это <b>" + U.fmt(m.gain, 2) +
            "×</b> от одного, а не " + st.n + "×. Кривые складываются по расходу при одинаковом напоре, но сеть с ростом расхода требует больше напора, и точка съезжает влево по объединённой кривой."
      });
      if (statPart > 0.6) {
        out.push({ lvl: "info", text: "Статический напор " + U.fmt(st.Hst, 0) + " м — это " + U.fmt(statPart * 100, 0) + " % от рабочего. Чем больше статики, тем <b>лучше</b> работает параллель: кривая сети идёт полого, и второй насос добавляет почти полный расход." });
      } else {
        out.push({ lvl: "warn", text: "Сеть крутая (статика всего " + U.fmt(statPart * 100, 0) + " % напора): каждый следующий насос добавляет всё меньше. В пределе, на чисто сопротивленческой сети, два насоса дают в 1,41 раза больше одного, четыре — ровно вдвое." });
      }
    } else {
      out.push({
        lvl: "info",
        text: "Последовательно " + st.n + " насоса: складываются напоры. Рабочая точка — " + U.fmt(m.op.Q, 1) + " м³/ч при " + U.fmt(m.op.H, 1) +
          " м, на каждый насос приходится " + U.fmt(m.hEach, 1) + " м. Это полезно, когда сеть крутая: высокий напор при умеренном расходе."
      });
      out.push({ lvl: "warn", text: "Второй насос в последовательной схеме работает под давлением первого: корпус и сальник должны быть рассчитаны на суммарное давление. И пускать их нужно одновременно — иначе один гонит воду через стоящий." });
    }

    if (st.valve < 0.95) {
      out.push({
        lvl: "warn",
        text: "Задвижка прикрыта до " + U.fmt(st.valve * 100, 0) + " %: на ней теряется " + U.fmt(Math.max(0, m.hThrottle), 1) +
          " м. Тот же расход можно получить частотой " + U.fmt(m.rNeed * 50, 1) + " Гц при открытой задвижке, и мощность будет " +
          U.fmt(m.Pvfd, 2) + " вместо " + U.fmt(m.Ptot, 2) + " кВт — экономия " + U.fmt(100 * (1 - m.Pvfd / Math.max(m.Ptot, 1e-6)), 0) + " %."
      });
    }
    if (st.freq < 49.5) {
      out.push({
        lvl: "good",
        text: "Частота " + U.fmt(st.freq, 1) + " Гц: по законам подобия кривая «съёжилась» — H0 падает как квадрат частоты (" +
          U.fmt(st.H0 * m.r * m.r, 1) + " м вместо " + U.fmt(st.H0, 0) + "), а мощность — как куб. Обратите внимание: при большом статическом напоре снижать частоту можно лишь до определённого предела, ниже которого насос вообще перестанет подавать воду."
      });
    }
    if (m.eta < 0.45 && m.op.Q > 0.1) {
      out.push({ lvl: "bad", text: "КПД всего " + U.fmt(m.eta * 100, 0) + " %: рабочая точка далеко от оптимума (" + U.fmt(st.Qopt, 0) + " м³/ч на насос). Насос подобран не под эту сеть — или включено слишком много насосов." });
    }
    if (st.H0 * m.r * m.r <= st.Hst) {
      out.push({ lvl: "bad", text: "Насос не может преодолеть статический напор: при " + U.fmt(st.freq, 1) + " Гц его напор при нулевой подаче " + U.fmt(st.H0 * m.r * m.r, 1) + " м, а поднять воду надо на " + U.fmt(st.Hst, 0) + " м. Подачи нет вовсе." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Два насоса — не двойной расход", tag: "★ главный",
      preset: { n: 1, arrange: "par", H0: 60, Qopt: 30, Hopt: 45, Hst: 10, Kmin: 0.03, valve: 1, freq: 50 },
      steps: ["Один насос: запомните расход.", "Добавьте второй, третий, четвёртый.", "Посмотрите на столбики справа: прирост от каждого следующего."],
      watch: ["Второй добавляет заметно меньше, чем первый.", "Рабочая точка каждого насоса уезжает влево — в зону меньшего расхода и большего напора.", "КПД при этом может упасть."],
      why: "Параллельные насосы складывают подачи при одинаковом напоре. Но сеть на большем расходе требует большего напора, поэтому объединённая рабочая точка оказывается не на удвоенном расходе, а левее. На чисто сопротивленческой сети (Hст = 0) два одинаковых насоса дают ровно √2 ≈ 1,41 раза больше."
    },
    {
      title: "2. Статический напор помогает параллели", tag: "сеть",
      preset: { n: 2, arrange: "par", H0: 60, Qopt: 30, Hopt: 45, Hst: 0, Kmin: 0.03, valve: 1, freq: 50 },
      steps: ["Статика 0: посмотрите прирост от второго насоса.", "Поднимайте статический напор: 10, 20, 30, 40 м.", "Следите за приростом."],
      watch: ["При Hст = 0 прирост всего 41 %.", "При большой статике прирост приближается к 100 %.", "Кривая сети становится всё более пологой относительно кривой насоса."],
      why: "Кривая сети H = Hст + K·Q². Чем больше доля Hст, тем меньше напора нужно добавлять при росте расхода — и тем ближе параллельная работа к идеальному сложению. Поэтому в скважинных и высотных системах параллель работает хорошо, а в коротких кольцах — плохо."
    },
    {
      title: "3. Последовательно против параллельно", tag: "схема",
      preset: { n: 2, arrange: "par", H0: 60, Qopt: 30, Hopt: 45, Hst: 45, Kmin: 0.02, valve: 1, freq: 50 },
      steps: ["Крутая сеть с большой статикой (45 м). Посмотрите расход при параллельной схеме.", "Переключите на последовательную.", "Теперь уменьшите статику до 5 м и сравните снова."],
      watch: ["На высокой статике последовательная схема выигрывает.", "На пологой сети выигрывает параллельная.", "Граница — там, где кривые двух схем пересекаются."],
      why: "Параллель добавляет расход, последовательность — напор. Что выгоднее, решает форма кривой сети: если системе не хватает напора (высота, длинный водовод) — последовательно; если не хватает расхода (разбор, пожар) — параллельно."
    },
    {
      title: "4. Дросселирование против частоты", tag: "★ энергия",
      preset: { n: 2, arrange: "par", H0: 60, Qopt: 30, Hopt: 45, Hst: 20, Kmin: 0.012, valve: 1, freq: 50 },
      steps: ["Задвижка открыта, запишите расход и мощность.", "Прикройте задвижку так, чтобы расход упал примерно вдвое.", "Прочитайте в показаниях «нужная частота» и поставьте её, открыв задвижку полностью.", "Сравните мощности."],
      watch: ["При дросселировании напор насоса растёт, а расход падает — мощность снижается слабо.", "При частотном регулировании падают и напор, и расход — мощность падает резко.", "Экономия в показаниях: обычно 30–50 % на половинном расходе."],
      why: "Дросселирование гасит лишний напор в задвижке: насос всё равно его создаёт, а энергия уходит в нагрев. ПЧ уменьшает саму кривую насоса: H ~ n², P ~ n³. Если в сети нет статического напора, точка идёт по параболе подобия, и экономия максимальна; чем больше статика, тем меньше выигрыш."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Рабочая точка</h3>' +
    "<p>Насос не «выдаёт расход». Он может работать в любой точке своей кривой, а какую займёт — решает сеть:</p>" +
    '<p class="formula">H<sub>нас</sub>(Q) = H<sub>ст</sub> + K·Q²</p>' +
    "<p>Слева — что насос может дать, справа — что сеть требует. Пересечение и есть рабочая точка. Меняется что-нибудь одно — точка едет по другой кривой.</p>" +
    "<p>Подробный стенд установки повышения давления с реле, частотником, мембранным баком, сухим ходом и кавитацией — в соседней программе «Насосная лаборатория».</p></section>" +

    '<section class="card txt"><h3>Сложение кривых</h3>' +
    "<ul><li><b>Параллельно</b> — складываем подачи при одинаковом напоре. Объединённая кривая вдвое «шире».</li>" +
    "<li><b>Последовательно</b> — складываем напоры при одинаковой подаче. Кривая вдвое «выше».</li></ul>" +
    "<p>Для одинаковых насосов на сети без статики параллель даёт коэффициент √2 ≈ 1,41 для двух насосов, √3 для трёх. С ростом статического напора коэффициенты растут к 2 и 3.</p>" +
    "<p>Разные насосы параллельно работать могут, но у насоса с меньшим H0 есть предел: если напор в коллекторе выше его H0, он не подаст ничего, а обратный клапан у него закроется.</p></section>" +

    '<section class="card txt"><h3>Законы подобия</h3>' +
    '<p class="formula">Q ~ n,  H ~ n²,  P ~ n³</p>' +
    "<p>При изменении частоты рабочая точка переходит на подобную — она лежит на параболе H = kQ², проходящей через начало координат. Если в сети есть статический напор, реальная точка сходит с этой параболы, и кубической экономии уже не получится.</p>" +
    "<p>Отсюда практическое правило: частотное регулирование тем выгоднее, чем меньше доля статического напора. В системах отопления и циркуляции ГВС статики нет вовсе — там ПЧ экономит максимум.</p></section>" +

    '<section class="card txt"><h3>Как читать КПД</h3>' +
    "<p>Кривая КПД имеет максимум в расчётной точке. Работа далеко слева (малый расход) — это не только низкий КПД, но и рециркуляция в колесе, нагрев, вибрация и износ подшипников. Работа далеко справа — риск кавитации и перегрузки двигателя.</p>" +
    "<p>Рабочий диапазон обычно ограничивают 0,7…1,2 от подачи в оптимуме. При параллельной работе следите за точкой каждого насоса отдельно: группа может стоять в хорошей точке, а отдельный насос — нет.</p></section>";

  Lab.register(S);
})();
