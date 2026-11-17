/* Стенд 9. Тупиковая и кольцевая сеть: распределение давлений и расходов.

   Пять узлов, пять участков. В кольцевом режиме работают все, в тупиковом
   замыкающий участок отключён. Любой участок можно «сломать» щелчком — и увидеть,
   кто остался без воды.

   Расчёт узловым методом: неизвестные — напоры в узлах, уравнения — баланс расходов
   в каждом узле. Нелинейность h = r·Q² снимается линеаризацией c = 1/(r·|Q|),
   после чего система решается методом Гаусса — Зейделя с релаксацией. */
(function () {
  "use strict";

  var W = 1180, HH = 520;

  /* Узлы: 0 — насосная станция (напор задан), дальше потребители. */
  var POS = [[150, 300], [430, 130], [790, 140], [1000, 330], [590, 440]];
  var NAMES = ["Насосная станция", "Узел 1", "Узел 2", "Узел 3", "Узел 4"];
  /* Участки: от — до. Последний замыкает кольцо. */
  var LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]];

  var S = {
    id: "network", group: "water",
    title: "Тупиковая и кольцевая сеть",
    lead: "Одна и та же сеть в двух видах: кольцо и тупиковая ветка. Видно, как делятся расходы по кольцу, где самая слабая точка и что происходит при аварии на участке.",
    hint: "Щелчок по участку отключает его (авария или ремонт). Щелчок по замыкающему участку превращает кольцо в тупиковую сеть и обратно.",
    vis: { kind: "svg" },
    speeds: false
  };

  S.defaults = function () {
    return {
      Hsrc: 45,                 // напор на выходе насосной станции, м (над отметкой 0)
      ring: true,
      Hreq: 12,                 // требуемый свободный напор у потребителя, м
      z: [0, 4, 8, 6, 2],       // отметки узлов, м
      q: [0, 8, 12, 6, 10],     // отборы в узлах, л/с
      links: [
        { L: 320, d: 200 },
        { L: 380, d: 150 },
        { L: 260, d: 150 },
        { L: 420, d: 150 },
        { L: 300, d: 150 }
      ],
      closed: [false, false, false, false, false],
      rough: "castIron"
    };
  };

  S.fields = [
    { title: "Источник и режим", open: true, fields: [
      { k: "Hsrc", t: "range", l: "Напор на выходе насосной", u: "м", min: 10, max: 90, step: 1, d: 0 },
      { k: "ring", t: "check", l: "Кольцевая сеть (замыкающий участок включён)" },
      { k: "Hreq", t: "range", l: "Требуемый свободный напор", u: "м", min: 4, max: 40, step: 1, d: 0 },
      { k: "rough", t: "select", l: "Материал труб", opts: Hydro.ROUGH.map(function (r) { return [r.id, r.name]; }) }
    ] },
    { title: "Отборы в узлах", open: true, fields: [
      { k: "q.1", t: "range", l: "Отбор в узле 1", u: "л/с", min: 0, max: 60, step: 0.5, d: 1 },
      { k: "q.2", t: "range", l: "Отбор в узле 2", u: "л/с", min: 0, max: 60, step: 0.5, d: 1 },
      { k: "q.3", t: "range", l: "Отбор в узле 3", u: "л/с", min: 0, max: 60, step: 0.5, d: 1 },
      { k: "q.4", t: "range", l: "Отбор в узле 4", u: "л/с", min: 0, max: 60, step: 0.5, d: 1 }
    ] },
    { title: "Отметки узлов", fields: [
      { k: "z.1", t: "range", l: "Отметка узла 1", u: "м", min: -10, max: 40, step: 1, d: 0 },
      { k: "z.2", t: "range", l: "Отметка узла 2", u: "м", min: -10, max: 40, step: 1, d: 0 },
      { k: "z.3", t: "range", l: "Отметка узла 3", u: "м", min: -10, max: 40, step: 1, d: 0 },
      { k: "z.4", t: "range", l: "Отметка узла 4", u: "м", min: -10, max: 40, step: 1, d: 0 }
    ] },
    { title: "Участки", fields: [
      { k: "links.0.d", t: "range", l: "Участок НС — 1: диаметр", u: "мм", min: 50, max: 500, step: 10, d: 0 },
      { k: "links.0.L", t: "range", l: "длина", u: "м", min: 50, max: 1500, step: 10, d: 0 },
      { k: "links.1.d", t: "range", l: "Участок 1 — 2: диаметр", u: "мм", min: 50, max: 500, step: 10, d: 0 },
      { k: "links.1.L", t: "range", l: "длина", u: "м", min: 50, max: 1500, step: 10, d: 0 },
      { k: "links.2.d", t: "range", l: "Участок 2 — 3: диаметр", u: "мм", min: 50, max: 500, step: 10, d: 0 },
      { k: "links.2.L", t: "range", l: "длина", u: "м", min: 50, max: 1500, step: 10, d: 0 },
      { k: "links.3.d", t: "range", l: "Участок 3 — 4: диаметр", u: "мм", min: 50, max: 500, step: 10, d: 0 },
      { k: "links.3.L", t: "range", l: "длина", u: "м", min: 50, max: 1500, step: 10, d: 0 },
      { k: "links.4.d", t: "range", l: "Замыкающий 4 — НС: диаметр", u: "мм", min: 50, max: 500, step: 10, d: 0 },
      { k: "links.4.L", t: "range", l: "длина", u: "м", min: 50, max: 1500, step: 10, d: 0 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {};

  /* Сопротивление участка: h = r·Q², Q в л/с. */
  function resist(st, link, Qls) {
    var d = link.d / 1000, A = Hydro.area(d);
    var v = Math.max(Math.abs(Qls), 0.2) / 1000 / A;
    var lam = Hydro.lambda(Hydro.reynolds(v, d, U.nu(10)), Hydro.roughById(st.rough).k / 1000, d);
    return lam * link.L / d / (2 * Hydro.G * Math.pow(1000 * A, 2));
  }

  function openLinks(st) {
    return LINKS.map(function (lk, i) {
      var open = !st.closed[i];
      if (i === 4 && !st.ring) open = false;
      return open;
    });
  }

  function connectivity(open) {
    var seen = [true, false, false, false, false], changed = true;
    while (changed) {
      changed = false;
      LINKS.forEach(function (lk, i) {
        if (!open[i]) return;
        if (seen[lk[0]] && !seen[lk[1]]) { seen[lk[1]] = true; changed = true; }
        if (seen[lk[1]] && !seen[lk[0]]) { seen[lk[0]] = true; changed = true; }
      });
    }
    return seen;
  }

  function solve(st) {
    var open = openLinks(st), live = connectivity(open);
    var H = [st.Hsrc, st.Hsrc, st.Hsrc, st.Hsrc, st.Hsrc];
    var Q = [0.1, 0.1, 0.1, 0.1, 0.1], r = [0, 0, 0, 0, 0], i, k;

    /* Узловой метод Ньютона: для каждого узла делается шаг по невязке баланса.
       Производная dQ/dH = 1/(2·r·|Q|) — отсюда поправка напора. */
    for (var it = 0; it < 300; it++) {
      for (k = 0; k < LINKS.length; k++) r[k] = resist(st, st.links[k], Q[k]);
      var worstF = 0;
      for (i = 1; i < 5; i++) {
        if (!live[i]) { H[i] = st.z[i]; continue; }
        var F = -st.q[i], dF = 0;
        for (k = 0; k < LINKS.length; k++) {
          if (!open[k]) continue;
          var a = LINKS[k][0], b = LINKS[k][1], other = -1;
          if (a === i) other = b; else if (b === i) other = a; else continue;
          var dh = H[other] - H[i];
          var q = (dh >= 0 ? 1 : -1) * Math.sqrt(Math.abs(dh) / r[k]);   // приток в узел i
          F += q;
          dF += 1 / (2 * r[k] * Math.max(Math.abs(q), 0.02));
        }
        if (dF < 1e-12) continue;
        worstF = Math.max(worstF, Math.abs(F));
        H[i] = H[i] + U.clamp(F / dF, -20, 20);
      }
      for (k = 0; k < LINKS.length; k++) {
        if (!open[k]) { Q[k] = 0; continue; }
        var dhk = H[LINKS[k][0]] - H[LINKS[k][1]];
        Q[k] = (dhk >= 0 ? 1 : -1) * Math.sqrt(Math.abs(dhk) / r[k]);
      }
      if (worstF < 1e-7 && it > 4) break;
    }

    /* Невязки: насколько сошёлся баланс в узлах. */
    var res = [0, 0, 0, 0, 0];
    for (i = 1; i < 5; i++) {
      var sum = 0;
      for (k = 0; k < LINKS.length; k++) {
        if (!open[k]) continue;
        if (LINKS[k][1] === i) sum += Q[k];
        if (LINKS[k][0] === i) sum -= Q[k];
      }
      res[i] = sum - st.q[i];
    }
    var Qsrc = 0;
    for (k = 0; k < LINKS.length; k++) {
      if (!open[k]) continue;
      if (LINKS[k][0] === 0) Qsrc += Q[k];
      if (LINKS[k][1] === 0) Qsrc -= Q[k];
    }
    return { H: H, Q: Q, r: r, open: open, live: live, res: res, Qsrc: Qsrc };
  }

  function compute(st) {
    var s = solve(st), i;
    var nodes = [], worst = 1;
    for (i = 0; i < 5; i++) {
      var free = s.H[i] - st.z[i];
      nodes.push({
        H: s.H[i], z: st.z[i], free: free, q: st.q[i], live: s.live[i],
        ok: s.live[i] && free >= st.Hreq
      });
      if (i > 0 && (!s.live[i] || free < nodes[worst].free)) worst = i;
    }
    var links = LINKS.map(function (lk, k) {
      var d = st.links[k].d / 1000;
      var v = Math.abs(s.Q[k]) / 1000 / Hydro.area(d);
      return {
        from: lk[0], to: lk[1], Q: s.Q[k], v: v, open: s.open[k],
        h: s.r[k] * s.Q[k] * s.Q[k], L: st.links[k].L, d: st.links[k].d,
        i1000: 1000 * s.r[k] * s.Q[k] * s.Q[k] / Math.max(st.links[k].L, 1)
      };
    });
    m = { nodes: nodes, links: links, Qsrc: s.Qsrc, worst: worst, res: s.res,
      demand: st.q.reduce(function (a, b) { return a + b; }, 0),
      dead: s.live.filter(function (x) { return !x; }).length };
  }

  S.reset = function () { compute(S.state); };
  S.onChange = function () { compute(S.state); };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH), i;

    LINKS.forEach(function (lk, k) {
      var a = POS[lk[0]], b = POS[lk[1]];
      s += '<g class="clickable" id="lk' + k + '">';
      s += SK.line(null, a[0], a[1], b[0], b[1], "", ' stroke="transparent" stroke-width="22"');
      s += SK.line("lkl" + k, a[0], a[1], b[0], b[1], "", ' stroke="var(--pipe-lo)" stroke-width="10" stroke-linecap="round"');
      s += SK.path("lka" + k, "", "", ' fill="none" stroke="var(--panel)" stroke-width="2.5"');
      s += "</g>";
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      s += SK.txt("lkt" + k, mx, my - 14, "val", "middle", "");
      s += SK.txt("lkt2" + k, mx, my + 18, "tiny muted", "middle", "");
    });

    POS.forEach(function (p, i2) {
      if (i2 === 0) {
        s += SK.rect(null, p[0] - 60, p[1] - 34, 120, 68, "", ' fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" rx="6"');
        s += SK.txt(null, p[0], p[1] - 12, "cap", "middle", "насосная");
        s += SK.txt("n0", p[0], p[1] + 10, "val", "middle", "");
        s += SK.txt("n0b", p[0], p[1] + 28, "tiny muted", "middle", "");
      } else {
        s += SK.circle("nd" + i2, p[0], p[1], 16, "", ' fill="var(--panel)" stroke="var(--pipe-hi)" stroke-width="2.5"');
        s += SK.txt(null, p[0], p[1] + 5, "val", "middle", String(i2));
        s += SK.txt("n" + i2, p[0], p[1] - 26, "val", "middle", "");
        s += SK.txt("n" + i2 + "b", p[0], p[1] + 34, "tiny", "middle", "");
        s += SK.txt("n" + i2 + "c", p[0], p[1] + 50, "tiny muted", "middle", "");
      }
    });

    s += SK.txt("hdr", 40, 40, "cap", "start", "");
    s += SK.txt("hdr2", 40, 62, "tiny muted", "start", "");
    s += SK.close();
    ui.vis.innerHTML = s;
    var ids = ["hdr", "hdr2", "n0", "n0b"];
    for (i = 0; i < 5; i++) ids.push("lk" + i, "lkl" + i, "lka" + i, "lkt" + i, "lkt2" + i);
    for (i = 1; i < 5; i++) ids.push("nd" + i, "n" + i, "n" + i + "b", "n" + i + "c");
    R = SK.refs(ui.vis, ids);

    ui.vis.addEventListener("click", function (e) {
      for (var k = 0; k < 5; k++) {
        if (e.target.closest("#lk" + k)) {
          if (k === 4) S.state.ring = !S.state.ring;
          else S.state.closed[k] = !S.state.closed[k];
          compute(S.state);
          ui.refresh(); ui.save();
          return;
        }
      }
    });
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, k, i;
    compute(st);

    for (k = 0; k < 5; k++) {
      var lk = m.links[k], a = POS[LINKS[k][0]], b = POS[LINKS[k][1]];
      var col = !lk.open ? U.css("--line") : U.mix(U.css("--pipe-lo"), U.css("--pipe-hi"), U.clamp(lk.v / 2, 0, 1));
      SK.set(R["lkl" + k], { stroke: col, "stroke-dasharray": lk.open ? "none" : "8 8", "stroke-width": U.clamp(lk.d / 20, 5, 14) });
      /* стрелка направления в середине участка */
      var ar = "";
      if (lk.open && Math.abs(lk.Q) > 0.05) {
        var dir = lk.Q >= 0 ? 1 : -1;
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        var ex = mx + dir * 13 * Math.cos(ang), ey = my + dir * 13 * Math.sin(ang);
        ar = "M" + SK.n(mx - dir * 9 * Math.cos(ang) - 6 * Math.sin(ang)) + " " + SK.n(my - dir * 9 * Math.sin(ang) + 6 * Math.cos(ang)) +
          " L" + SK.n(ex) + " " + SK.n(ey) +
          " L" + SK.n(mx - dir * 9 * Math.cos(ang) + 6 * Math.sin(ang)) + " " + SK.n(my - dir * 9 * Math.sin(ang) - 6 * Math.cos(ang));
      }
      SK.set(R["lka" + k], { d: ar });
      SK.text(R["lkt" + k], lk.open ? U.fmt(Math.abs(lk.Q), 1) + " л/с" : (k === 4 ? "тупиковая сеть" : "авария"));
      SK.set(R["lkt" + k], { fill: lk.open ? "var(--ink)" : "var(--bad)" });
      SK.text(R["lkt2" + k], lk.open ? U.fmt(lk.d, 0) + " мм · " + U.fmt(lk.L, 0) + " м · v " + U.fmt(lk.v, 2) + " м/с · h " + U.fmt(lk.h, 2) + " м"
        : U.fmt(lk.d, 0) + " мм · " + U.fmt(lk.L, 0) + " м");
    }

    SK.text(R.n0, U.fmt(st.Hsrc, 0) + " м");
    SK.text(R.n0b, U.fmt(m.Qsrc, 1) + " л/с в сеть");
    for (i = 1; i < 5; i++) {
      var nd = m.nodes[i];
      SK.text(R["n" + i], nd.live ? U.fmt(nd.H, 1) + " м" : "нет воды");
      SK.set(R["n" + i], { fill: !nd.live ? "var(--bad)" : "var(--ink)" });
      SK.text(R["n" + i + "b"], nd.live ? "своб. " + U.fmt(nd.free, 1) + " м" : "");
      SK.set(R["n" + i + "b"], { fill: nd.ok ? "var(--good)" : "var(--bad)" });
      SK.text(R["n" + i + "c"], "отм. " + U.fmt(nd.z, 0) + " м · отбор " + U.fmt(nd.q, 1) + " л/с");
      SK.set(R["nd" + i], { stroke: !nd.live ? "var(--bad)" : (nd.ok ? "var(--good)" : "var(--warn)") });
    }
    SK.text(R.hdr, st.ring ? "Кольцевая сеть" : "Тупиковая сеть");
    SK.text(R.hdr2, "щелчок по участку — авария на нём; щелчок по замыкающему участку переключает кольцо и тупик");

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "heads", title: "Свободный напор в узлах", h: 300 },
    { id: "flows", title: "Расходы по участкам", h: 300 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var f = U.fitCanvas(ui.canvas("heads"));
    var items = [];
    for (var i = 1; i < 5; i++) {
      var nd = m.nodes[i];
      items.push({
        y: nd.live ? Math.max(0, nd.free) : 0,
        color: !nd.live ? U.css("--bad") : (nd.ok ? U.css("--good") : U.css("--warn")),
        label: "узел " + i
      });
    }
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: 0, x1: 1, y0: 0, y1: Plot.niceMax(Math.max(st.Hsrc * 0.9, st.Hreq * 1.5)),
      yLabel: "свободный напор, м", noXLabels: true, pad: { l: 46, r: 14, t: 14, b: 46 }
    });
    Plot.bars(p, items, 0.5);
    Plot.hline(p, st.Hreq, { color: U.css("--bad"), dash: [6, 4], width: 1.8 });
    Plot.label(p, p.x0 + 0.02, st.Hreq, " требуемый напор " + U.fmt(st.Hreq, 0) + " м", U.css("--bad"), "left", "bottom", true);

    var f2 = U.fitCanvas(ui.canvas("flows"));
    var it2 = m.links.map(function (lk, k) {
      return {
        y: lk.open ? Math.abs(lk.Q) : 0,
        color: lk.open ? (lk.v > 1.5 ? U.css("--warn") : U.css("--water")) : U.css("--line"),
        label: LINKS[k][0] === 0 ? "НС—" + LINKS[k][1] : (LINKS[k][1] === 0 ? LINKS[k][0] + "—НС" : LINKS[k][0] + "—" + LINKS[k][1])
      };
    });
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 1, y0: 0, y1: Plot.niceMax(Math.max(m.demand * 0.9, 1)),
      yLabel: "расход, л/с", noXLabels: true, pad: { l: 46, r: 14, t: 14, b: 46 }
    });
    Plot.bars(p2, it2, 0.5);
    Plot.legend(p2, [
      { color: U.css("--water"), text: "всего в сеть: " + U.fmt(m.Qsrc, 1) + " л/с, отбор " + U.fmt(m.demand, 1) + " л/с" },
      { color: U.css("--warn"), text: "скорость выше 1,5 м/с" }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, rows = [];
    rows.push({ n: "Подача в сеть", v: U.fmt(m.Qsrc, 2) + " л/с (" + U.fmt(m.Qsrc * 3.6, 1) + " м³/ч)" });
    rows.push({ n: "Суммарный отбор", v: U.fmt(m.demand, 2) + " л/с" });
    rows.push({ n: "Схема", v: st.ring ? "кольцевая" : "тупиковая" });
    rows.push({ h: "Узлы" });
    for (var i = 1; i < 5; i++) {
      var nd = m.nodes[i];
      rows.push({
        n: NAMES[i] + " (отм. " + U.fmt(nd.z, 0) + " м)",
        v: nd.live ? U.fmt(nd.H, 2) + " м, своб. " + U.fmt(nd.free, 2) + " м" : "нет воды",
        cls: !nd.live ? "bad" : (nd.ok ? "good" : "warn")
      });
    }
    rows.push({ h: "Участки" });
    m.links.forEach(function (lk, k) {
      var nm = (LINKS[k][0] === 0 ? "НС" : LINKS[k][0]) + " — " + (LINKS[k][1] === 0 ? "НС" : LINKS[k][1]);
      rows.push({
        n: nm + " (" + U.fmt(lk.d, 0) + " мм, " + U.fmt(lk.L, 0) + " м)",
        v: lk.open ? U.fmt(lk.Q, 2) + " л/с · " + U.fmt(lk.v, 2) + " м/с" : "отключён",
        cls: !lk.open ? "bad" : (lk.v > 1.5 ? "warn" : "")
      });
      if (lk.open) rows.push({ n: "", v: "потери " + U.fmt(lk.h, 2) + " м, уклон " + U.fmt(lk.i1000, 2) + " ‰", cls: "sub" });
    });
    return rows;
  };

  S.explain = function () {
    var st = S.state, out = [], i;
    var closedCount = st.closed.filter(function (x) { return x; }).length;

    if (m.dead > 0) {
      var names = [];
      for (i = 1; i < 5; i++) if (!m.nodes[i].live) names.push("узел " + i);
      out.push({
        lvl: "bad",
        text: "<b>Без воды: " + names.join(", ") + ".</b> " + (st.ring
          ? "Даже в кольце отключено столько участков, что до этих узлов вода дойти не может."
          : "Это и есть главная беда тупиковой сети: авария на одном участке оставляет без воды всё, что за ним.")
      });
    }

    if (st.ring) {
      var l0 = m.links[0], l4 = m.links[4];
      out.push({
        lvl: "good",
        text: "Кольцо: вода идёт к потребителям с двух сторон — " + U.fmt(Math.abs(l0.Q), 1) + " л/с по участку НС—1 и " +
          U.fmt(Math.abs(l4.Q), 1) + " л/с по замыкающему. Расходы делятся сами, так, чтобы потери по обоим путям до точки встречи были одинаковы. Эту точку так и называют — точка схода потоков."
      });
      if (closedCount === 0) {
        out.push({ lvl: "info", text: "Попробуйте отключить любой участок щелчком по нему: в кольце вода просто пойдёт в обход, и напоры просядут, но вода останется у всех. Ради этого кольцевые сети и делают." });
      } else {
        out.push({ lvl: "warn", text: "Отключён участок: вода пошла в обход. Посмотрите, как изменились направления стрелок и насколько просел свободный напор в узлах — это и есть проверка сети на аварийный режим." });
      }
    } else {
      out.push({
        lvl: "warn",
        text: "Тупиковая сеть: у каждого узла единственный путь питания. Расходы по участкам определяются однозначно — просто сумма отборов «за» участком, никакого распределения нет. Зато любая авария отрезает всех, кто дальше."
      });
    }

    var w = m.nodes[m.worst];
    if (w.live) {
      out.push({
        lvl: w.free >= st.Hreq ? "good" : "bad",
        text: "Самая слабая точка — узел " + m.worst + ": свободный напор " + U.fmt(w.free, 1) + " м при требуемых " + U.fmt(st.Hreq, 0) + " м. " +
          (w.free >= st.Hreq ? "Запас есть." : "Не хватает " + U.fmt(st.Hreq - w.free, 1) + " м: нужно либо поднять напор на станции, либо увеличить диаметр на пути к этому узлу.") +
          " Отметка узла " + U.fmt(w.z, 0) + " м съедает столько же метров напора."
      });
    }

    var fast = m.links.filter(function (l) { return l.open && l.v > 1.5; });
    if (fast.length) {
      out.push({ lvl: "warn", text: "На " + fast.length + " участке(ах) скорость выше 1,5 м/с — потери растут как квадрат, а при аварийном закрытии задвижки такой поток даст заметный гидравлический удар. Экономичные скорости в городских сетях: 0,7…1,2 м/с." });
    }

    out.push({
      lvl: "info",
      text: "Гидравлический уклон участка i = h/L показан в показаниях в промилле. Это самая удобная величина для проверки: в городских сетях он обычно 1…5 ‰, во внутридомовых — до 10…20 ‰."
    });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Авария в тупике и в кольце", tag: "★ главный",
      preset: { ring: false, Hsrc: 45, closed: [false, false, false, false, false] },
      steps: [
        "Сеть тупиковая. Щёлкните по участку 1—2 — авария.",
        "Посмотрите, кто остался без воды.",
        "Включите кольцо (щелчок по замыкающему участку или галочка слева) и повторите ту же аварию."
      ],
      watch: [
        "В тупике узлы 2, 3, 4 полностью без воды.",
        "В кольце те же узлы получают воду с другой стороны, напор проседает, но сеть работает.",
        "Стрелки на участках меняют направление."
      ],
      why: "Надёжность — главный аргумент за кольцевые сети. По нормам кольцевание обязательно для сетей, питающих потребителей I и II категории, и для сетей с пожарными расходами. Цена — больше труб и сложнее расчёт: распределение расходов по кольцу заранее неизвестно."
    },
    {
      title: "2. Точка схода потоков", tag: "кольцо",
      preset: { ring: true, Hsrc: 45, q: [0, 8, 12, 6, 10], closed: [false, false, false, false, false] },
      steps: ["Кольцо, все участки в работе. Найдите, где встречаются потоки — по стрелкам.", "Увеличьте отбор в узле 3 до 40 л/с.", "Посмотрите, как точка схода переместилась."],
      watch: ["Стрелки с двух сторон сходятся в одном узле.", "При изменении отборов точка схода переезжает.", "Расходы по половинам кольца делятся так, чтобы потери по обоим путям были равны."],
      why: "В кольце расходы неизвестны заранее: их определяет условие равенства потерь по двум путям до точки схода. Раньше это считали методом Лобачёва — Кросса с увязкой колец вручную, теперь — узловым методом, как в этом стенде."
    },
    {
      title: "3. Отметка узла съедает напор", tag: "высота",
      preset: { ring: true, Hsrc: 45, z: [0, 4, 8, 6, 2], Hreq: 12, closed: [false, false, false, false, false] },
      steps: ["Поднимайте отметку узла 2 с 8 до 30 м.", "Смотрите на свободный напор в нём и на столбик на графике.", "Потом поднимите напор насосной и посмотрите, что изменится во всех узлах."],
      watch: ["Свободный напор падает ровно на столько, на сколько поднялась отметка.", "Поднятие напора станции поднимает все узлы одинаково.", "Расходы при этом почти не меняются."],
      why: "Свободный напор = напор в узле минус отметка земли. Именно он определяет, дойдёт ли вода до верхнего этажа. Поэтому в городах с перепадом рельефа сеть делят на зоны, а не задирают давление на станции: лишнее давление в низких точках — это аварии и утечки."
    },
    {
      title: "4. Узкое место", tag: "диаметры",
      preset: { ring: false, Hsrc: 45, links: [{ L: 320, d: 100 }, { L: 380, d: 150 }, { L: 260, d: 150 }, { L: 420, d: 150 }, { L: 300, d: 150 }], closed: [false, false, false, false, false] },
      steps: ["Головной участок НС—1 всего 100 мм. Посмотрите скорость и потери на нём.", "Увеличивайте его диаметр: 150, 200, 250 мм.", "Следите за свободными напорами во всех узлах."],
      watch: ["Потери на головном участке падают как пятая степень диаметра.", "Напор во всех узлах растёт одновременно.", "У остальных участков потери почти не меняются."],
      why: "Головной участок несёт весь расход, поэтому его диаметр решает судьбу всей сети. Правило: потери распределены по сети крайне неравномерно, и увеличивать диаметр нужно там, где произведение расхода на длину максимально, а не везде подряд."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Тупиковая сеть</h3>' +
    "<p>Расходы по участкам известны заранее: каждый участок несёт сумму отборов всех узлов, расположенных за ним. Поэтому расчёт прост — идём от концов к началу, складывая расходы, потом считаем потери и напоры.</p>" +
    "<p>Достоинства: меньше труб, простой расчёт, дешевле. Недостаток один, но серьёзный: любая авария отключает всё, что дальше. Поэтому тупиковые сети допускают для небольших потребителей и там, где перерыв в подаче не страшен.</p></section>" +

    '<section class="card txt"><h3>Кольцевая сеть</h3>' +
    "<p>Распределение расходов заранее неизвестно: вода сама выбирает, сколько пойдёт по каждой половине кольца. Условие простое — потери по обоим путям до точки встречи равны, иначе вода перетекла бы.</p>" +
    '<p class="formula">Σ h по кольцу = 0 (с учётом знаков)</p>' +
    "<p>Классический способ решения — метод Лобачёва — Кросса: задаются расходы, считают невязку по кольцу и вводят поправочный расход, пока невязка не станет меньше допустимой. Этот стенд решает задачу иначе, узловым методом: неизвестные — напоры в узлах, а не расходы в кольцах.</p></section>" +

    '<section class="card txt"><h3>Свободный напор</h3>' +
    '<p class="formula">H<sub>своб</sub> = H<sub>узла</sub> − z<sub>земли</sub></p>' +
    "<p>Это то, что остаётся потребителю. Требуемый напор для одноэтажной застройки — 10 м, на каждый следующий этаж добавляют по 4 м. Отсюда привычная формула H = 10 + 4·(n − 1).</p>" +
    "<p>Максимальный напор тоже нормируется (обычно 60 м): избыточное давление рвёт арматуру, гонит утечки и увеличивает расход воды у потребителя.</p></section>" +

    '<section class="card txt"><h3>Как считает стенд</h3>' +
    "<p>Неизвестные — напоры в четырёх узлах. Для каждого записывается баланс расходов: сколько пришло по трубам, столько и ушло к потребителю. Расход в трубе связан с перепадом нелинейно (Q ~ √Δh), поэтому на каждой итерации сопротивление линеаризуется: c = 1/(r·|Q|), и система решается как линейная, методом Гаусса — Зейделя с релаксацией.</p>" +
    "<p>Коэффициент λ пересчитывается на каждой итерации по Колбруку для текущего расхода, так что квадратичность и область сопротивления учтены честно.</p>" +
    "<p>Отдельно проверяется связность: если узел оказался отрезан от станции закрытыми участками, он помечается как «нет воды», а не получает бессмысленный напор.</p></section>";

  Lab.register(S);
})();
