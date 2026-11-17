/* Стенд 11. Обнаружение утечки по падению давления (опрессовка участка).

   Участок отсечён задвижками и накачан. Давление падает по двум причинам:
   вода уходит через утечку и вода меняет объём от температуры.

       C = dV/dp — податливость системы, л/бар:
           вода      V·(1/K)              (K = 2,06 ГПа)
           труба     V·d/(E·e)            (растяжение стенки)
           воздух    V_возд/p_абс         (самое большое слагаемое)
       dp/dt = −(Q_утечки − V·β·dT/dt)/C

   Отсюда два практических вывода: невыпущенный воздух делает испытание
   бессмысленным, а перепад температуры на градус легко перекрывает утечку. */
(function () {
  "use strict";

  var W = 1180, HH = 400;

  var S = {
    id: "leak", group: "water",
    title: "Утечка и падение давления",
    lead: "Опрессованный участок: давление падает. Сколько из этого — настоящая утечка, сколько — остывающая вода, и почему в пластиковой трубе с воздухом утечку не поймать.",
    hint: "Щелчок по манометру сбрасывает и снова накачивает участок до испытательного давления.",
    vis: { kind: "svg" },
    speeds: [1, 10, 60, 300],
    speed0: 10,
    maxStep: 0.5
  };

  S.defaults = function () {
    return {
      L: 200,          // длина участка, м
      dmm: 100,        // диаметр, мм
      mat: "steel",
      wall: 4,         // толщина стенки, мм
      p0: 10,          // испытательное давление, бар
      air: 0,          // остаточный воздух, л
      leakMm: 0.8,     // диаметр отверстия утечки, мм
      dTdt: 0,         // изменение температуры воды, К/ч
      T: 15,
      norm: 0.2        // допустимое падение за 10 мин, бар
    };
  };

  S.fields = [
    { title: "Испытание", open: true, fields: [
      { k: "p0", t: "range", l: "Испытательное давление", u: "бар", min: 2, max: 25, step: 0.5, d: 1 },
      { k: "leakMm", t: "range", l: "Диаметр отверстия утечки", u: "мм", min: 0, max: 5, step: 0.05, d: 2,
        hint: "0 — участок герметичен. Свищ 0,5 мм при 10 бар даёт около 0,3 л/мин." },
      { k: "air", t: "range", l: "Остаточный воздух в участке", u: "л", min: 0, max: 50, step: 0.1, d: 1,
        hint: "Главный враг опрессовки: воздух растягивает падение давления во времени." },
      { k: "dTdt", t: "range", l: "Изменение температуры воды", u: "К/ч", min: -3, max: 3, step: 0.05, d: 2,
        hint: "Свежезалитая холодная вода нагревается от грунта, а на солнце труба греется сильнее." },
      { k: "norm", t: "range", l: "Допустимое падение за 10 мин", u: "бар", min: 0.05, max: 1, step: 0.05, d: 2 }
    ] },
    { title: "Участок", open: true, fields: [
      { k: "L", t: "range", l: "Длина участка", u: "м", min: 10, max: 2000, step: 10, d: 0 },
      { k: "dmm", t: "range", l: "Диаметр", u: "мм", min: 15, max: 600, step: 5, d: 0 },
      { k: "mat", t: "select", l: "Материал", opts: Hydro.PIPE_MAT.map(function (p) { return [p.id, p.name]; }) },
      { k: "wall", t: "range", l: "Толщина стенки", u: "мм", min: 1, max: 30, step: 0.5, d: 1 },
      { k: "T", t: "range", l: "Температура воды", u: "°C", min: 1, max: 60, step: 1, d: 0 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {}, tr = new Plot.Trend(8000), trT = 0;

  function geom(st) {
    var d = st.dmm / 1000, A = Hydro.area(d);
    var V = A * st.L * 1000;                                // литры воды
    var mat = Hydro.matById(st.mat);
    var cWater = V * 1e5 / U.bulkK(st.T);                   // л/бар
    var cPipe = V * 1e5 * d / (mat.E * st.wall / 1000);     // л/бар
    var cAir = st.air > 0 ? st.air : 0;                     // делится на p_абс в расчёте
    return { d: d, A: A, V: V, mat: mat, cWater: cWater, cPipe: cPipe, cAir: cAir };
  }

  function compliance(st, g, pBar) {
    return g.cWater + g.cPipe + (g.cAir > 0 ? g.cAir / (pBar + 1.0133) : 0);
  }
  /* Коэффициент объёмного расширения воды, 1/К. Подобран по таблице:
     0,88·10⁻⁴ при 10 °C, 2,07·10⁻⁴ при 20 °C, 4,57·10⁻⁴ при 50 °C.
     Ниже 4 °C получается отрицательным — как и должно быть у воды. */
  function beta(T) {
    var x = T - 4;
    return 1.454e-5 * x - 1.0e-7 * x * x;
  }

  function leakFlow(st, pBar) {
    if (st.leakMm <= 0.001 || pBar <= 0) return 0;
    var A = Hydro.area(st.leakMm / 1000);
    return 0.62 * A * Math.sqrt(2 * Hydro.G * pBar * 10.197) * 1000;    // л/с
  }

  S.reset = function () {
    var st = S.state;
    m = { p: st.p0, p0meas: st.p0, lost: 0, g: geom(st) };
    tr.clear(); trT = 0;
    recalc(st, 0);
  };
  S.onChange = function () { m.g = geom(S.state); recalc(S.state, 0); };
  S.pumpUp = function () { m.p = S.state.p0; m.lost = 0; S.t = 0; tr.clear(); };

  function recalc(st, dt) {
    var g = m.g = geom(st);
    var C = compliance(st, g, m.p);
    var qLeak = leakFlow(st, m.p);                                    // л/с
    var qTherm = -g.V * beta(st.T) * (st.dTdt / 3600);                // л/с (нагрев = приток объёма)
    m.C = C; m.qLeak = qLeak; m.qTherm = qTherm;
    m.dpLeak = -qLeak / C;                                            // бар/с
    m.dpTherm = -qTherm / C;
    if (dt > 0) {
      m.p = Math.max(0, m.p + (m.dpLeak + m.dpTherm) * dt);
      m.lost += qLeak * dt;
    }
    m.rate10 = -(m.dpLeak + m.dpTherm) * 600;                         // падение за 10 мин, бар
    m.rateLeak10 = -m.dpLeak * 600;
    m.rateTherm10 = -m.dpTherm * 600;
    m.leakLh = qLeak * 3600;
    m.verdict = m.rate10 <= st.norm;
    /* Время, за которое давление упадёт на нормативную величину. */
    m.tNorm = m.rate10 > 1e-9 ? 600 * st.norm / m.rate10 : Infinity;
    m.share = Math.abs(m.dpLeak) + Math.abs(m.dpTherm) > 1e-12
      ? Math.abs(m.dpLeak) / (Math.abs(m.dpLeak) + Math.abs(m.dpTherm)) : 1;
  }

  S.tick = function (dt) {
    recalc(S.state, dt);
    trT += dt;
    if (trT > 1) {
      trT = 0;
      tr.push(S.t, { p: m.p, lost: m.lost });
    }
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH);
    var y = 230;

    s += SK.rect(null, 150, y - 26, 800, 52, "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="2" rx="4"');
    s += SK.rect("water", 152, y - 24, 796, 48, "", ' fill="var(--water)" opacity="0.3"');
    s += SK.rect("airPk", 400, y - 24, 0, 16, "", ' fill="var(--p4)" opacity="0.35"');
    s += SK.txt("airT", 500, y - 34, "tiny", "middle", "");

    // заглушки и задвижки
    s += SK.valve(null, 150, y, "shut", 13);
    s += SK.valve(null, 950, y, "shut", 13);
    s += SK.txt(null, 150, y + 44, "tiny muted", "middle", "участок отсечён");
    s += SK.txt(null, 950, y + 44, "tiny muted", "middle", "участок отсечён");

    // опрессовочный насос
    s += SK.rect(null, 40, y - 30, 90, 60, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt(null, 85, y - 10, "tiny muted", "middle", "опрессовка");
    s += SK.txt(null, 85, y + 12, "tiny muted", "middle", "насос");

    // манометр
    s += SK.g("gauge", "clickable", SK.gauge("needle", 0, 0, 40) +
      SK.txt("gT", 0, 62, "val", "middle", "") + SK.txt(null, 0, 80, "tiny muted", "middle", "щелчок — накачать заново"),
      ' transform="translate(550,110)"');
    s += SK.path(null, "M550 150 V" + (y - 26), "tube");

    // утечка
    s += SK.path("drip", "", "", ' fill="none" stroke="var(--water)" stroke-width="3" stroke-dasharray="4 5" stroke-linecap="round"');
    s += SK.circle("hole", 760, y + 26, 3, "", ' fill="var(--bad)"');
    s += SK.txt("leakT", 760, y + 92, "val bad", "middle", "");

    // термометр
    s += SK.rect(null, 990, y - 60, 150, 120, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt(null, 1065, y - 38, "tiny muted", "middle", "температура воды");
    s += SK.txt("tT", 1065, y - 12, "val", "middle", "");
    s += SK.txt("tT2", 1065, y + 14, "tiny muted", "middle", "");
    s += SK.txt("tT3", 1065, y + 38, "tiny", "middle", "");

    s += SK.txt("verdict", 40, 60, "cap", "start", "");
    s += SK.txt("verdict2", 40, 84, "tiny muted", "start", "");

    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["water", "airPk", "airT", "needle", "gT", "gauge", "drip", "hole", "leakT", "tT", "tT2", "tT3", "verdict", "verdict2"]);
    ui.vis.addEventListener("click", function (e) {
      if (e.target.closest("#gauge")) { S.pumpUp(); ui.refresh(); }
    });
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, y = 230;
    SK.set(R.needle, { transform: "rotate(" + SK.needle(m.p, Math.max(st.p0 * 1.3, 2)) + ")" });
    SK.text(R.gT, U.fmt(m.p, 3) + " бар");
    SK.set(R.gT, { fill: m.p < st.p0 - st.norm ? "var(--bad)" : "var(--ink)" });

    var aw = U.clamp(st.air / Math.max(m.g.V, 1) * 4000, 0, 600);
    SK.set(R.airPk, { x: 550 - aw / 2, width: aw });
    SK.text(R.airT, st.air > 0.05 ? "воздух " + U.fmt(st.air, 1) + " л (" + U.fmt(100 * st.air / m.g.V, 2) + " % объёма)" : "воздух выпущен");
    SK.set(R.airT, { fill: st.air > 0.05 ? "var(--warn)" : "var(--good)" });

    var drip = "";
    if (m.qLeak > 1e-5) {
      drip = "M760 " + (y + 26) + " V" + (y + 26 + U.clamp(20 + m.qLeak * 800, 20, 60));
      SK.set(R.drip, { "stroke-dashoffset": -(S.anim || 0) * 60, opacity: 0.9 });
    } else {
      SK.set(R.drip, { opacity: 0 });
    }
    SK.set(R.drip, { d: drip });
    SK.set(R.hole, { r: U.clamp(st.leakMm * 1.6, 0.5, 8), opacity: st.leakMm > 0.01 ? 1 : 0 });
    SK.text(R.leakT, m.qLeak > 1e-6 ? U.fmt(m.leakLh, 2) + " л/ч" : "");

    SK.text(R.tT, U.fmt(st.T, 0) + " °C");
    SK.text(R.tT2, st.dTdt === 0 ? "постоянная" : (st.dTdt > 0 ? "нагрев " + U.fmt(st.dTdt, 2) + " К/ч" : "остывание " + U.fmt(-st.dTdt, 2) + " К/ч"));
    SK.text(R.tT3, Math.abs(m.rateTherm10) > 0.001 ? (m.rateTherm10 > 0 ? "−" : "+") + U.fmt(Math.abs(m.rateTherm10), 2) + " бар/10 мин" : "");
    SK.set(R.tT3, { fill: Math.abs(m.rateTherm10) > st.norm * 0.5 ? "var(--bad)" : "var(--muted)" });

    SK.text(R.verdict, "Падение " + U.fmt(m.rate10, 3) + " бар за 10 мин при допустимых " + U.fmt(st.norm, 2) + " — " +
      (m.verdict ? "испытание проходит" : "участок не герметичен"));
    SK.set(R.verdict, { fill: m.verdict ? "var(--good)" : "var(--bad)" });
    SK.text(R.verdict2, "податливость системы " + U.fmt(m.C, 4) + " л/бар · утечка " + U.fmt(m.leakLh, 2) +
      " л/ч · вытекло за опыт " + U.fmt(m.lost, 2) + " л");

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "p", title: "Падение давления", h: 320 },
    { id: "air", title: "Как воздух и материал трубы прячут утечку", h: 320 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var win = U.clamp(Math.max(S.t, 600), 600, 7200);
    var f = U.fitCanvas(ui.canvas("p"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: Math.max(0, S.t - win), x1: Math.max(win, S.t), y0: Math.max(0, st.p0 - Math.max(st.norm * 6, 1)), y1: st.p0 * 1.03,
      xLabel: "время", yLabel: "давление, бар",
      xFmt: function (x) { return x < 600 ? U.fmt(x, 0) + " с" : U.fmt(x / 60, 0) + " мин"; }
    });
    Plot.clip(p);
    Plot.hline(p, st.p0, { color: U.css("--muted"), dash: [4, 4] });
    Plot.hline(p, st.p0 - st.norm, { color: U.css("--bad"), dash: [6, 4] });
    Plot.line(p, tr.series("p", S.t, win), { color: U.css("--p1"), width: 2.2 });
    Plot.unclip(p);
    Plot.vline(p, 600, { color: U.css("--axis"), dash: [3, 3] });
    Plot.legend(p, [
      { color: U.css("--p1"), text: "манометр" },
      { color: U.css("--bad"), text: "допустимое падение " + U.fmt(st.norm, 2) + " бар", dash: [6, 4] },
      { color: U.css("--axis"), text: "10 минут", dash: [3, 3] }
    ]);

    /* Скорость падения в зависимости от остаточного воздуха — для разных труб. */
    var f2 = U.fitCanvas(ui.canvas("air"));
    var mats = [Hydro.matById("steel"), Hydro.matById("pe")];
    var cols = [U.css("--p1"), U.css("--p2")];
    var series = mats.map(function (mat) {
      var pts = [];
      for (var i = 0; i <= 60; i++) {
        var air = 50 * i / 60;
        var g = m.g;
        var cPipe = g.V * 1e5 * g.d / (mat.E * st.wall / 1000);
        var C = g.cWater + cPipe + (air > 0 ? air / (st.p0 + 1.0133) : 0);
        pts.push([air, leakFlow(st, st.p0) / C * 600]);
      }
      return pts;
    });
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 50, y0: 0, y1: Plot.niceMax(Math.max(series[0][0][1], st.norm * 2) * 1.1),
      xLabel: "остаточный воздух, л", yLabel: "падение за 10 мин, бар"
    });
    Plot.clip(p2);
    series.forEach(function (s, i) { Plot.line(p2, s, { color: cols[i], width: 2 }); });
    Plot.hline(p2, st.norm, { color: U.css("--bad"), dash: [6, 4] });
    Plot.dot(p2, st.air, m.rateLeak10, 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: cols[0], text: "стальная труба" },
      { color: cols[1], text: "полиэтиленовая труба" },
      { color: U.css("--bad"), text: "порог " + U.fmt(st.norm, 2) + " бар", dash: [6, 4] },
      { color: U.css("--accent"), text: "сейчас (только утечка, без температуры)", dot: true }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state;
    return [
      { n: "Давление сейчас", v: U.fmt(m.p, 3) + " бар" },
      { n: "Испытательное давление", v: U.fmt(st.p0, 1) + " бар" },
      { n: "Прошло времени", v: U.fmtTime(S.t) },
      { h: "Падение за 10 минут" },
      { n: "Всего", v: U.fmt(m.rate10, 3) + " бар", cls: m.verdict ? "good" : "bad" },
      { n: "из них от утечки", v: U.fmt(m.rateLeak10, 3) + " бар (" + U.fmt(m.share * 100, 0) + " %)" },
      { n: "из них от температуры", v: U.fmt(m.rateTherm10, 3) + " бар", cls: Math.abs(m.rateTherm10) > st.norm * 0.5 ? "bad" : "" },
      { n: "Допустимое", v: U.fmt(st.norm, 2) + " бар" },
      { h: "Утечка" },
      { n: "Расход через отверстие", v: U.fmt(m.leakLh, 3) + " л/ч (" + U.fmt(m.qLeak * 60, 3) + " л/мин)" },
      { n: "Вытекло за опыт", v: U.fmt(m.lost, 2) + " л" },
      { n: "Время до нормативного падения", v: isFinite(m.tNorm) ? U.fmtTime(m.tNorm) : "—" },
      { h: "Участок" },
      { n: "Объём воды", v: U.fmt(m.g.V, 1) + " л" },
      { n: "Податливость всего", v: U.fmt(m.C, 4) + " л/бар" },
      { n: "из неё вода", v: U.fmt(m.g.cWater, 4) + " л/бар", cls: "sub" },
      { n: "растяжение трубы", v: U.fmt(m.g.cPipe, 4) + " л/бар", cls: "sub" },
      { n: "остаточный воздух", v: U.fmt(st.air > 0 ? st.air / (m.p + 1.0133) : 0, 4) + " л/бар", cls: st.air > 0.05 ? "warn" : "sub" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [];
    out.push({
      lvl: "info",
      text: "Податливость участка " + U.fmt(m.C, 4) + " л/бар: чтобы давление упало на бар, из него должно уйти именно столько воды. " +
        "В " + U.fmt(m.g.V, 0) + " литрах воды сжатие даёт " + U.fmt(m.g.cWater, 4) + " л/бар, растяжение трубы — " + U.fmt(m.g.cPipe, 4) + " л/бар."
    });

    if (st.air > 0.05) {
      var cAir = st.air / (m.p + 1.0133);
      out.push({
        lvl: cAir > m.g.cWater ? "bad" : "warn",
        text: "<b>Остаточный воздух " + U.fmt(st.air, 1) + " л</b> добавляет " + U.fmt(cAir, 4) + " л/бар — это " +
          U.fmt(100 * cAir / m.C, 0) + " % всей податливости. Воздух в сотни раз сжимаемее воды, поэтому утечка «съедает» его объём, почти не роняя давление. " +
          "Классическая ошибка: не выпустили воздух — испытание показало герметичность, а через месяц нашли свищ."
      });
    } else {
      out.push({ lvl: "good", text: "Воздух выпущен: система жёсткая, и даже маленькая утечка сразу видна по манометру. Именно поэтому опрессовку начинают с полного удаления воздуха через воздушники." });
    }

    if (st.mat === "pe" || st.mat === "pp") {
      out.push({
        lvl: "warn",
        text: "Полимерная труба очень податлива: её растяжение даёт " + U.fmt(m.g.cPipe, 4) + " л/бар — в " +
          U.fmt(m.g.cPipe / Math.max(m.g.cWater, 1e-9), 0) + " раз больше, чем сжатие воды. Плюс к этому полиэтилен ползёт: давление падает само по себе даже в идеально герметичной трубе. Поэтому для ПЭ приняты отдельные методики испытаний — с предварительной релаксацией и по расходу подкачки."
      });
    }

    if (Math.abs(m.rateTherm10) > 0.01) {
      out.push({
        lvl: Math.abs(m.rateTherm10) > st.norm * 0.5 ? "bad" : "warn",
        text: "Температура меняется на " + U.fmt(st.dTdt, 2) + " К/ч — это " + (m.rateTherm10 > 0 ? "минус " : "плюс ") +
          U.fmt(Math.abs(m.rateTherm10), 3) + " бар за 10 минут. " +
          (m.rateTherm10 > 0
            ? "Остывающая вода сжимается, и манометр показывает «утечку», которой нет."
            : "Нагрев, наоборот, поднимает давление и маскирует настоящую утечку.") +
          " На жёстком участке один градус стоит нескольких бар — поэтому испытания проводят, дав воде отстояться и выровняться по температуре."
      });
    }

    if (m.qLeak > 1e-6) {
      out.push({
        lvl: m.verdict ? "warn" : "bad",
        text: "Отверстие " + U.fmt(st.leakMm, 2) + " мм при " + U.fmt(m.p, 1) + " бар пропускает " + U.fmt(m.leakLh, 2) +
          " л/ч — это " + U.fmt(m.leakLh * 24 / 1000, 2) + " м³ в сутки. " +
          (m.verdict ? "Формально испытание проходит: падение в норме. Утечка спрятана податливостью системы." : "Падение давления больше допустимого — утечка найдена.")
      });
    } else {
      out.push({ lvl: "good", text: "Утечки нет. Всё, что показывает манометр, — это температура." });
    }

    out.push({
      lvl: "info",
      text: "В реальных сетях по падению давления ищут только грубые утечки. Для мелких пользуются другими способами: расход подкачки при постоянном давлении, ночной минимальный расход по зонам, корреляционные течеискатели по шуму, тепловизор и трассировка индикаторами."
    });
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Воздух прячет утечку", tag: "★ главный",
      preset: { L: 200, dmm: 100, mat: "steel", wall: 4, p0: 10, air: 0, leakMm: 0.8, dTdt: 0, norm: 0.2 },
      speed: 60,
      steps: ["Воздух выпущен, есть свищ 0,8 мм. Нажмите на манометр (накачать) и смотрите падение.", "Запишите падение за 10 минут.", "Теперь задайте остаточный воздух 5 л и повторите. Потом 20 л."],
      watch: ["Без воздуха давление валится за секунды.", "С 5 л воздуха падение растягивается на минуты.", "С 20 л испытание формально проходит, хотя утечка та же."],
      why: "Воздух при 10 бар сжимается в 11 раз, а вода — на 0,05 %. Один литр воздуха даёт такую же податливость, как тонна воды. Пока утечка «съедает» расширяющийся воздух, манометр почти не двигается."
    },
    {
      title: "2. Один градус против утечки", tag: "★ важное",
      preset: { L: 200, dmm: 100, mat: "steel", wall: 4, p0: 10, air: 0, leakMm: 0, dTdt: -0.5, norm: 0.2 },
      speed: 60,
      steps: ["Утечки нет совсем, но вода остывает на 0,5 К/ч.", "Смотрите на давление: оно падает.", "Поставьте нагрев +0,5 К/ч и включите утечку 0,8 мм."],
      watch: ["Герметичный участок «не проходит» испытание из-за остывания.", "При нагреве давление растёт и маскирует настоящую утечку.", "В показаниях вклад температуры отделён от вклада утечки."],
      why: "Вода расширяется примерно на 0,02 % на градус. На жёстком участке это даёт единицы бар на градус. Поэтому нормы требуют выдержать участок до выравнивания температур, а при длительных испытаниях — измерять температуру и вводить поправку."
    },
    {
      title: "3. Сталь против полиэтилена", tag: "материал",
      preset: { L: 200, dmm: 100, mat: "steel", wall: 4, p0: 10, air: 0, leakMm: 0.5, dTdt: 0, norm: 0.2 },
      speed: 60,
      steps: ["Стальная труба со свищом 0,5 мм: посмотрите скорость падения.", "Переключите материал на полиэтилен ПЭ100 и повторите.", "Сравните податливость в показаниях."],
      watch: ["У полиэтилена податливость стенки в десятки раз больше.", "Падение давления растягивается во времени.", "На правом графике две кривые расходятся в разы."],
      why: "Растяжение стенки даёт объём V·d/(E·e) на единицу давления. У полиэтилена модуль упругости в 200 раз меньше, чем у стали, поэтому труба «дышит». К этому добавляется ползучесть материала — поэтому для ПЭ испытания проводят по особой методике."
    },
    {
      title: "4. Какую утечку вообще видно", tag: "чувствительность",
      preset: { L: 500, dmm: 150, mat: "steel", wall: 4, p0: 10, air: 2, leakMm: 0.2, dTdt: 0, norm: 0.2 },
      speed: 300,
      steps: ["Большой участок, маленькая утечка 0,2 мм и 2 л воздуха.", "Посмотрите «время до нормативного падения» в показаниях.", "Увеличивайте отверстие: 0,5, 1, 2 мм."],
      watch: ["Мелкая утечка требует часов наблюдения.", "Расход через отверстие растёт как квадрат диаметра.", "Порог обнаружения зависит от объёма участка, а не только от утечки."],
      why: "Чем больше объём участка, тем больше его податливость и тем медленнее падает давление при той же утечке. Поэтому большие сети испытывают по участкам, а не целиком, а для поиска мелких утечек применяют метод подкачки: держат давление постоянным и мерят, сколько воды приходится добавлять."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Почему падает давление</h3>' +
    "<p>Закрытый участок — это ёмкость с очень маленькой, но конечной упругостью. Чтобы давление упало на один бар, из неё должно уйти вполне определённое количество воды:</p>" +
    '<p class="formula">C = V/K + V·d/(E·e) + V<sub>возд</sub>/p<sub>абс</sub>   [л/бар]</p>' +
    "<p>Первое слагаемое — сжимаемость воды, второе — растяжение трубы, третье — сжатие оставшегося воздуха. Для 200 м стальной трубы 100 мм это примерно 0,08 + 0,02 + (воздух) л/бар.</p>" +
    "<p>Дальше всё просто: dp/dt = −Q<sub>утечки</sub>/C. Чем больше C, тем медленнее падает давление при той же утечке — и тем хуже испытание ловит дефект.</p></section>" +

    '<section class="card txt"><h3>Температура</h3>' +
    "<p>Коэффициент объёмного расширения воды около 0,0002 на градус. Для 1000 л это 0,2 л на градус — при податливости 0,1 л/бар получается <b>2 бара на градус</b>.</p>" +
    "<p>Поэтому:</p>" +
    "<ul><li>участок выдерживают до выравнивания температуры с грунтом;</li>" +
    "<li>при длительных испытаниях измеряют температуру и вводят поправку;</li>" +
    "<li>испытание в солнечный день на открытой трубе не имеет смысла;</li>" +
    "<li>рост давления «сам собой» — это почти всегда нагрев, а не ошибка манометра.</li></ul></section>" +

    '<section class="card txt"><h3>Расход через отверстие</h3>' +
    '<p class="formula">Q = μ·A·√(2gH),  μ ≈ 0,62</p>' +
    "<p>Та же формула, что в стенде истечения. Ориентиры при 10 бар (100 м напора):</p>" +
    '<table class="tbl"><tr><th>Отверстие</th><th>Расход</th><th>В сутки</th></tr>' +
    "<tr><td>0,2 мм</td><td>0,05 л/мин</td><td>0,07 м³</td></tr>" +
    "<tr><td>0,5 мм</td><td>0,3 л/мин</td><td>0,4 м³</td></tr>" +
    "<tr><td>1 мм</td><td>1,3 л/мин</td><td>1,9 м³</td></tr>" +
    "<tr><td>3 мм</td><td>11 л/мин</td><td>16 м³</td></tr></table>" +
    "<p class=\"muted small\">Отсюда видно, почему «маленькая» течь в сети — это десятки кубометров в месяц.</p></section>" +

    '<section class="card txt"><h3>Как ищут утечки в жизни</h3>' +
    "<ul><li><b>Испытание на герметичность</b> — то, что моделирует стенд: годится для приёмки, но ловит только заметные дефекты.</li>" +
    "<li><b>Метод подкачки</b>: давление держат постоянным и измеряют объём добавляемой воды. Чувствительнее, потому что не зависит от податливости.</li>" +
    "<li><b>Ночной минимальный расход</b> по зонам учёта: ночью потребление минимально, и всё, что течёт, — это утечки.</li>" +
    "<li><b>Акустика</b>: шумопеленгаторы и корреляторы по звуку струи в грунте.</li>" +
    "<li><b>Внутритрубная диагностика</b>, трассировка индикаторами, тепловизор для горячей воды.</li></ul></section>";

  Lab.register(S);
})();
