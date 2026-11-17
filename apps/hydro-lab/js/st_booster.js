/* Стенд 10. Гидропневмобак и станция повышения давления.

   Насос, мембранный бак и реле давления. Воздух в баке сжимается изотермически:
       p_абс · V_возд = const,  при p = p_подкачки  V_возд = V бака.
   Полезный объём (то, что бак реально отдаёт между порогами реле):
       V_пол = V · (p_выкл − p_вкл) · p_подк / ((p_выкл + 1)(p_вкл + 1))   [абс. бары]
   Отсюда число включений в час — главный показатель долговечности насоса. */
(function () {
  "use strict";

  var W = 1180, HH = 430;

  var S = {
    id: "booster", group: "water",
    title: "Гидропневмобак и станция повышения давления",
    lead: "Насос, мембранный бак и реле давления. Видно, почему маленький бак убивает насос частыми пусками и как давление подкачки воздуха меняет полезный объём.",
    hint: "Щелчок по крану открывает и закрывает разбор. Розовая часть бака — воздух, синяя — вода.",
    vis: { kind: "svg" },
    speeds: [1, 4, 30],
    speed0: 4,
    maxStep: 0.05
  };

  S.defaults = function () {
    return {
      V: 100,           // объём бака, л
      pre: 2.7,         // давление подкачки воздуха, бар
      pOn: 3.0,         // реле: включение, бар
      pOff: 4.5,        // реле: выключение, бар
      Qpump: 6.0,       // подача насоса при нулевом напоре, м³/ч
      Hpump: 60,        // напор при нулевой подаче, м
      Qdraw: 1.2,       // разбор, м³/ч
      tapOpen: true,
      minRun: 0         // минимальное время работы, с
    };
  };

  S.fields = [
    { title: "Разбор", open: true, fields: [
      { k: "tapOpen", t: "check", l: "Кран открыт" },
      { k: "Qdraw", t: "range", l: "Разбор", u: "м³/ч", min: 0, max: 8, step: 0.05, d: 2,
        hint: "Самый частый пуск — при разборе около половины подачи насоса." }
    ] },
    { title: "Бак и реле", open: true, fields: [
      { k: "V", t: "range", l: "Объём мембранного бака", u: "л", min: 2, max: 1000, step: 2, d: 0 },
      { k: "pre", t: "range", l: "Давление подкачки воздуха", u: "бар", min: 0.5, max: 8, step: 0.05, d: 2,
        hint: "Обычно принимают 0,9 от давления включения (в абсолютных). Проверяется только на пустом баке." },
      { k: "pOn", t: "range", l: "Реле: включение", u: "бар", min: 0.5, max: 8, step: 0.05, d: 2 },
      { k: "pOff", t: "range", l: "Реле: выключение", u: "бар", min: 1, max: 10, step: 0.05, d: 2 },
      { k: "minRun", t: "range", l: "Минимальное время работы", u: "с", min: 0, max: 60, step: 1, d: 0 }
    ] },
    { title: "Насос", fields: [
      { k: "Hpump", t: "range", l: "Напор при нулевой подаче", u: "м", min: 10, max: 120, step: 1, d: 0 },
      { k: "Qpump", t: "range", l: "Подача при нулевом напоре", u: "м³/ч", min: 0.5, max: 20, step: 0.1, d: 1 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {}, tr = new Plot.Trend(8000), trT = 0;

  function airVol(st, pBar) {
    var pa = Math.max(pBar, 0) + 1.0133, ppre = st.pre + 1.0133;
    return Math.min(st.V, st.V * ppre / pa);
  }
  function pressFromWater(st, Vw) {
    var ppre = st.pre + 1.0133;
    var Va = Math.max(st.V - Vw, 1e-4);
    return ppre * st.V / Va - 1.0133;
  }
  /* Подача насоса при давлении p (бар): кривая H = H0 − B·Q². */
  function pumpQ(st, pBar) {
    var H = pBar * 10.197;
    if (H >= st.Hpump) return 0;
    return st.Qpump * Math.sqrt(1 - H / st.Hpump);
  }
  /* Полезный объём бака по формуле (л). */
  function useful(st) {
    var a = st.pOn + 1.0133, b = st.pOff + 1.0133, c = st.pre + 1.0133;
    if (c > a) return 0;                                  // подкачка выше включения — бак не работает
    return st.V * (b - a) * c / (a * b);
  }

  S.reset = function () {
    var st = S.state;
    m = { p: st.pOn + 0.01, on: false, Vw: 0, starts: 0, runT: 0, lastStart: -1, cycle: 0, tOn: 0, tOff: 0, sinceStart: 0 };
    m.Vw = st.V - airVol(st, m.p);
    tr.clear(); trT = 0;
    update(st, 0);
  };
  S.onChange = function () { update(S.state, 0); };

  function update(st, dt) {
    if (st.pOff <= st.pOn + 0.1) st.pOff = st.pOn + 0.1;
    var Qin = m.on ? pumpQ(st, m.p) : 0;
    var Qout = st.tapOpen ? st.Qdraw : 0;
    m.Qin = Qin; m.Qout = Qout;

    if (dt > 0) {
      m.Vw = Math.max(0, m.Vw + (Qin - Qout) * 1000 / 3600 * dt);
      if (m.Vw > st.V) m.Vw = st.V;
      m.p = pressFromWater(st, m.Vw);
      m.sinceStart += dt;
      if (m.on) m.runT += dt;

      if (!m.on && m.p <= st.pOn) {
        m.on = true;
        m.starts++;
        if (m.lastStart >= 0) m.cycle = S.t - m.lastStart;
        m.lastStart = S.t;
        m.sinceStart = 0;
      } else if (m.on && m.p >= st.pOff && m.sinceStart >= st.minRun) {
        m.on = false;
      }
      /* Насос работает, а воды в баке нет и давление не растёт: разбор больше подачи. */
      if (m.on && Qout > Qin && m.Vw <= 0.001) m.p = Math.max(0, pressFromWater(st, 0));
    }

    /* Аналитика цикла. */
    var Vp = useful(st);
    var QinAvg = pumpQ(st, (st.pOn + st.pOff) / 2);
    var tOff = Qout > 1e-6 ? Vp / (Qout * 1000 / 3600) : Infinity;
    var tOn = QinAvg > Qout ? Vp / ((QinAvg - Qout) * 1000 / 3600) : Infinity;
    m.Vuse = Vp;
    m.QinAvg = QinAvg;
    m.tOnCalc = tOn; m.tOffCalc = tOff;
    m.perHour = isFinite(tOn + tOff) && (tOn + tOff) > 0 ? 3600 / (tOn + tOff) : 0;
    m.Vair = st.V - m.Vw;
    m.starve = st.tapOpen && Qout > QinAvg;
  }

  S.tick = function (dt) {
    var st = S.state;
    update(st, dt);
    trT += dt;
    if (trT > 0.25) {
      trT = 0;
      tr.push(S.t, { p: m.p, on: m.on ? 1 : 0, Vw: m.Vw, Q: m.Qin });
    }
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    if (built === "1") return;
    built = "1";
    var s = SK.open(W, HH);

    // --- ввод и насос
    s += SK.path(null, "M40 300 H180", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="10"');
    s += SK.txt(null, 44, 288, "tiny muted", "start", "из городской сети / бака");
    s += SK.g("pump", "", SK.circle(null, 0, 0, 28, "", ' fill="var(--panel)" stroke="var(--accent)" stroke-width="2"') +
      SK.path("imp", "M-14 0 L14 0 M0 -14 L0 14", "", ' stroke="var(--accent)" stroke-width="2.5"'),
      ' transform="translate(212,300)"');
    s += SK.txt("pumpT", 212, 348, "val", "middle", "");
    s += SK.path(null, "M240 300 H560", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="10"');

    // --- бак
    s += SK.rect(null, 380, 80, 150, 190, "", ' fill="var(--panel)" stroke="var(--casing-dark)" stroke-width="2.5" rx="18"');
    s += SK.rect("air", 382, 82, 146, 90, "", ' fill="var(--p4)" opacity="0.22"');
    s += SK.rect("wtr", 382, 172, 146, 96, "", ' fill="var(--water)" opacity="0.45"');
    s += SK.line("membrane", 382, 172, 528, 172, "", ' stroke="var(--warn-hex)" stroke-width="3"');
    s += SK.path(null, "M455 270 V300", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="10"');
    s += SK.txt(null, 455, 68, "cap", "middle", "мембранный бак");
    s += SK.txt("airT", 455, 120, "val", "middle", "");
    s += SK.txt("wtrT", 455, 226, "val", "middle", "");

    // --- реле и манометр
    s += SK.rect(null, 590, 236, 150, 60, "", ' fill="var(--panel2)" stroke="var(--est)" stroke-width="1.5" rx="6"');
    s += SK.txt(null, 665, 256, "tiny muted", "middle", "реле давления");
    s += SK.txt("relT", 665, 280, "val", "middle", "");
    s += SK.path(null, "M640 236 V210 H455 V270", "wire");
    s += SK.gauge("needle", 640, 150, 34);
    s += SK.txt("gT", 640, 202, "val", "middle", "");

    // --- разбор
    s += SK.path(null, "M560 300 H900", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="10"');
    s += SK.valve("tap", 930, 300, "clickable", 13);
    s += SK.path("stream", "M930 316 V400", "", ' fill="none" stroke="var(--water)" stroke-width="5" stroke-dasharray="6 5" opacity="0"');
    s += SK.txt("tapT", 930, 268, "val", "middle", "");
    s += SK.rect(null, 870, 396, 120, 24, "", ' fill="var(--panel2)" stroke="var(--line)" rx="4"');
    s += SK.txt(null, 930, 412, "tiny muted", "middle", "потребитель");

    // --- итог
    s += SK.txt("sumT", 40, 60, "val", "start", "");
    s += SK.txt("sumT2", 40, 82, "tiny muted", "start", "");

    s += SK.close();
    ui.vis.innerHTML = s;
    R = SK.refs(ui.vis, ["pump", "imp", "pumpT", "air", "wtr", "membrane", "airT", "wtrT",
      "relT", "needle", "gT", "tap", "tapT", "stream", "sumT", "sumT2"]);
    ui.vis.addEventListener("click", function (e) {
      if (e.target.closest("#tap")) { S.state.tapOpen = !S.state.tapOpen; ui.refresh(); ui.save(); }
    });
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state;
    var frac = U.clamp(m.Vw / Math.max(st.V, 1e-6), 0, 1);
    var yMid = 82 + 186 * (1 - frac);
    SK.set(R.air, { y: 82, height: Math.max(0, yMid - 82) });
    SK.set(R.wtr, { y: yMid, height: Math.max(0, 268 - yMid) });
    SK.set(R.membrane, { y1: yMid, y2: yMid });
    SK.text(R.airT, U.fmt(m.Vair, 0) + " л воздуха");
    SK.text(R.wtrT, U.fmt(m.Vw, 0) + " л воды");
    SK.set(R.imp, { transform: "rotate(" + (m.on ? ((S.anim || 0) * 320 % 360) : 0) + ")" });
    SK.set(R.pump, { opacity: 1 });
    SK.text(R.pumpT, m.on ? "работает, " + U.fmt(m.Qin, 2) + " м³/ч" : "стоит");
    SK.set(R.pumpT, { fill: m.on ? "var(--good)" : "var(--muted)" });
    SK.set(R.needle, { transform: "rotate(" + SK.needle(m.p, Math.max(st.pOff * 1.4, 6)) + ")" });
    SK.text(R.gT, U.fmt(m.p, 2) + " бар (" + U.fmt(m.p * 10.197, 1) + " м)");
    SK.text(R.relT, U.fmt(st.pOn, 1) + " / " + U.fmt(st.pOff, 1) + " бар · " + (m.on ? "ВКЛ" : "выкл"));
    SK.set(R.relT, { fill: m.on ? "var(--good)" : "var(--muted)" });
    SK.cls(R.tap, "shut", !st.tapOpen);
    SK.text(R.tapT, st.tapOpen ? U.fmt(st.Qdraw, 2) + " м³/ч" : "закрыт");
    SK.set(R.stream, { opacity: st.tapOpen && st.Qdraw > 0.01 ? 0.8 : 0, "stroke-dashoffset": -(S.anim || 0) * 90 });
    SK.text(R.sumT, "Полезный объём бака " + U.fmt(m.Vuse, 1) + " л из " + U.fmt(st.V, 0) + " л · включений в час " + U.fmt(m.perHour, 1));
    SK.text(R.sumT2, "пусков за опыт: " + m.starts + " · насос в работе " + U.fmtTime(m.runT) + " из " + U.fmtTime(S.t));

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "osc", title: "Давление и работа насоса", h: 320 },
    { id: "cyc", title: "Число включений в час: объём бака и разбор", h: 320 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var win = U.clamp(Math.max(m.cycle * 4, 60), 60, 1800);
    var f = U.fitCanvas(ui.canvas("osc"));
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: Math.max(0, S.t - win), x1: Math.max(win, S.t), y0: 0, y1: Math.max(st.pOff * 1.25, 1),
      xLabel: "время, с", yLabel: "давление, бар", y2: [0, Math.max(st.V, 1)], y2Label: "вода в баке, л"
    });
    Plot.clip(p);
    Plot.hline(p, st.pOn, { color: U.css("--good"), dash: [6, 4] });
    Plot.hline(p, st.pOff, { color: U.css("--bad"), dash: [6, 4] });
    Plot.hline(p, st.pre, { color: U.css("--p4"), dash: [3, 3] });
    Plot.line(p, tr.series("Vw", S.t, win), { color: U.css("--water"), width: 1.4, dash: [4, 3] }, true);
    Plot.line(p, tr.series("p", S.t, win), { color: U.css("--p1"), width: 2.2 });
    Plot.unclip(p);
    Plot.legend(p, [
      { color: U.css("--p1"), text: "давление" },
      { color: U.css("--good"), text: "включение " + U.fmt(st.pOn, 1), dash: [6, 4] },
      { color: U.css("--bad"), text: "выключение " + U.fmt(st.pOff, 1), dash: [6, 4] },
      { color: U.css("--p4"), text: "подкачка " + U.fmt(st.pre, 1), dash: [3, 3] },
      { color: U.css("--water"), text: "вода в баке (правая ось)", dash: [4, 3] }
    ]);

    /* Включений в час: от разбора при нескольких объёмах бака. */
    var f2 = U.fitCanvas(ui.canvas("cyc"));
    var QinAvg = m.QinAvg;
    var vols = [Math.max(2, Math.round(st.V / 4)), st.V, st.V * 2];
    var cols = [U.css("--bad"), U.css("--accent"), U.css("--good")];
    var series = vols.map(function (V) {
      var pts = [];
      for (var i = 1; i <= 100; i++) {
        var Qd = QinAvg * i / 100 * 0.995;
        var Vp = useful({ V: V, pre: st.pre, pOn: st.pOn, pOff: st.pOff });
        var tOff = Vp / (Qd * 1000 / 3600);
        var tOn = Vp / ((QinAvg - Qd) * 1000 / 3600);
        pts.push([Qd, 3600 / (tOn + tOff)]);
      }
      return pts;
    });
    var maxY = 0;
    series.forEach(function (s) { s.forEach(function (q) { maxY = Math.max(maxY, q[1]); }); });
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: Math.max(QinAvg, 0.1), y0: 0, y1: Plot.niceMax(Math.min(maxY, 400) * 1.1),
      xLabel: "разбор, м³/ч", yLabel: "включений в час"
    });
    Plot.clip(p2);
    series.forEach(function (s, i) { Plot.line(p2, s, { color: cols[i], width: i === 1 ? 2.4 : 1.5, dash: i === 1 ? null : [5, 4] }); });
    Plot.vline(p2, QinAvg / 2, { color: U.css("--muted"), dash: [3, 3] });
    if (st.tapOpen && st.Qdraw > 0 && st.Qdraw < QinAvg) Plot.dot(p2, st.Qdraw, Math.min(m.perHour, 400), 5, U.css("--accent"), U.css("--panel"), 2);
    Plot.unclip(p2);
    Plot.hline(p2, 20, { color: U.css("--warn"), dash: [6, 4] });
    Plot.legend(p2, [
      { color: cols[0], text: "бак " + U.fmt(vols[0], 0) + " л", dash: [5, 4] },
      { color: cols[1], text: "бак " + U.fmt(vols[1], 0) + " л (сейчас)" },
      { color: cols[2], text: "бак " + U.fmt(vols[2], 0) + " л", dash: [5, 4] },
      { color: U.css("--warn"), text: "обычный предел 15–20 пусков в час", dash: [6, 4] }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state;
    return [
      { n: "Давление в системе", v: U.fmt(m.p, 2) + " бар (" + U.fmt(m.p * 10.197, 1) + " м)" },
      { n: "Насос", v: m.on ? "работает, " + U.fmt(m.Qin, 2) + " м³/ч" : "стоит", cls: m.on ? "good" : "" },
      { n: "Разбор", v: st.tapOpen ? U.fmt(st.Qdraw, 2) + " м³/ч" : "нет" },
      { h: "Бак" },
      { n: "Воды в баке", v: U.fmt(m.Vw, 1) + " л" },
      { n: "Воздуха в баке", v: U.fmt(m.Vair, 1) + " л" },
      { n: "Полезный объём (расчёт)", v: U.fmt(m.Vuse, 1) + " л (" + U.fmt(100 * m.Vuse / Math.max(st.V, 1), 0) + " % бака)",
        cls: m.Vuse < st.V * 0.1 ? "bad" : "good" },
      { n: "Давление подкачки", v: U.fmt(st.pre, 2) + " бар", cls: st.pre >= st.pOn ? "bad" : "" },
      { h: "Цикл" },
      { n: "Подача насоса в рабочей зоне", v: U.fmt(m.QinAvg, 2) + " м³/ч" },
      { n: "Время работы за цикл", v: isFinite(m.tOnCalc) ? U.fmtTime(m.tOnCalc) : "—" },
      { n: "Время паузы", v: isFinite(m.tOffCalc) ? U.fmtTime(m.tOffCalc) : "—" },
      { n: "Включений в час", v: U.fmt(m.perHour, 1), cls: m.perHour > 20 ? "bad" : "good" },
      { n: "Пусков за опыт", v: String(m.starts) },
      { n: "Измеренный цикл", v: m.cycle ? U.fmtTime(m.cycle) : "—", cls: "sub" },
      { n: "Насос в работе", v: U.fmtTime(m.runT) + " из " + U.fmtTime(S.t), cls: "sub" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [];
    if (st.pre >= st.pOn) {
      out.push({ lvl: "bad", text: "<b>Давление подкачки выше давления включения.</b> Мембрана прижата к стенке, вода в бак не входит вовсе — бак не работает, насос будет включаться от малейшего разбора. Подкачку ставят примерно на 0,9 от давления включения." });
    } else if (st.pre < st.pOn * 0.6) {
      out.push({ lvl: "warn", text: "Подкачка " + U.fmt(st.pre, 2) + " бар заметно ниже рекомендуемой (" + U.fmt(0.9 * (st.pOn + 1) - 1, 2) + " бар). Бак наберёт больше воды, но отдаст её не всю: часть останется ниже давления включения и будет просто занимать место." });
    } else {
      out.push({ lvl: "good", text: "Подкачка " + U.fmt(st.pre, 2) + " бар при включении " + U.fmt(st.pOn, 2) + " бар — близко к правилу «0,9 от давления включения в абсолютных»." });
    }

    out.push({
      lvl: "info",
      text: "Полезный объём бака — <b>" + U.fmt(m.Vuse, 1) + " л</b> из " + U.fmt(st.V, 0) +
        " л. Больше и не бывает: бак отдаёт воду только в промежутке между порогами реле, а сжатый воздух в конце всё равно занимает место. Отсюда практическое правило: реально работает 20–35 % объёма."
    });

    if (m.starve) {
      out.push({ lvl: "bad", text: "Разбор " + U.fmt(st.Qdraw, 2) + " м³/ч больше подачи насоса в рабочей зоне (" + U.fmt(m.QinAvg, 2) + " м³/ч). Насос не выключится никогда, давление просядет до равновесного — бак тут уже не поможет, нужен насос побольше или второй." });
    } else if (m.perHour > 20) {
      out.push({
        lvl: "bad",
        text: "<b>" + U.fmt(m.perHour, 0) + " включений в час</b> — слишком часто. Для бытовых насосов держат 15–20, для больших — 6–10. Лечится увеличением бака (пропорционально), расширением зоны реле или частотным преобразователем, который вообще не выключает насос."
      });
    } else if (m.perHour > 0) {
      out.push({ lvl: "good", text: U.fmt(m.perHour, 1) + " включений в час — нормально. Цикл: " + U.fmtTime(m.tOnCalc) + " работы и " + U.fmtTime(m.tOffCalc) + " паузы." });
    }

    out.push({
      lvl: "info",
      text: "Самый тяжёлый режим — разбор около <b>половины подачи насоса</b> (" + U.fmt(m.QinAvg / 2, 2) +
        " м³/ч): тогда время работы и время паузы равны, и цикл самый короткий. Попробуйте поставить именно такой разбор — число включений станет максимальным."
    });

    if (st.pOff - st.pOn < 1) {
      out.push({ lvl: "warn", text: "Зона реле всего " + U.fmt(st.pOff - st.pOn, 2) + " бар. Чем она уже, тем стабильнее давление у потребителя, но тем меньше полезный объём и тем чаще пуски. Обычный компромисс — 1,0…1,5 бар." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Маленький бак — частые пуски", tag: "★ главный",
      preset: { V: 24, pre: 2.7, pOn: 3.0, pOff: 4.5, Qdraw: 1.2, tapOpen: true, Qpump: 6, Hpump: 60 },
      speed: 4,
      steps: ["Бак 24 л, разбор 1,2 м³/ч. Смотрите на осциллограмму: пила давления.", "Посчитайте включения в час в показаниях.", "Увеличьте бак до 100, потом до 300 л."],
      watch: ["Период цикла растёт пропорционально объёму бака.", "Пила становится реже, амплитуда та же — её задаёт реле.", "Точка на правом графике переезжает на другую кривую."],
      why: "Полезный объём бака прямо пропорционален его вместимости, а время цикла — полезному объёму. Двойной бак — вдвое реже пуски. Ресурс пускателя и двигателя считается именно в пусках, поэтому бак — это не «запас воды», а защита насоса."
    },
    {
      title: "2. Худший разбор — половина подачи", tag: "★ неожиданно",
      preset: { V: 100, pre: 2.7, pOn: 3.0, pOff: 4.5, Qdraw: 0.3, tapOpen: true, Qpump: 6, Hpump: 60 },
      speed: 30,
      steps: ["Начните с маленького разбора 0,3 м³/ч и запишите включения в час.", "Увеличивайте разбор шагами: 1, 2, 2,5, 3 м³/ч.", "Потом до 4, 5 — и смотрите, что происходит."],
      watch: ["Максимум включений приходится на разбор около половины подачи насоса.", "При малом и при большом разборе пусков меньше.", "На правом графике виден горб — точка ползает по нему."],
      why: "Время цикла складывается из времени наполнения (V/(Qнас − Qразб)) и времени опорожнения (V/Qразб). Сумма минимальна, когда Qразб = Qнас/2. Поэтому станции проверяют не на максимальном расходе, а на «половинном» — самом вредном."
    },
    {
      title: "3. Неправильная подкачка воздуха", tag: "настройка",
      preset: { V: 100, pre: 2.7, pOn: 3.0, pOff: 4.5, Qdraw: 1.2, tapOpen: true },
      speed: 4,
      steps: ["Подкачка 2,7 бар при включении 3,0 — как положено. Запишите полезный объём.", "Поставьте подкачку 1,0 бар и посмотрите.", "Теперь 3,2 бар — выше давления включения."],
      watch: ["При низкой подкачке бак набирает много воды, но отдаёт мало.", "При подкачке выше включения бак не работает совсем.", "Полезный объём в показаниях меняется в разы."],
      why: "Вода входит в бак только там, где давление выше подкачки. Между порогами реле отдаётся объём V·(p₂ − p₁)·p₀/((p₁+1)(p₂+1)) в абсолютных барах. Максимум достигается, когда подкачка чуть ниже давления включения — отсюда правило 0,9."
    },
    {
      title: "4. Кран закрыт — бак держит давление", tag: "основы",
      preset: { V: 100, pre: 2.7, pOn: 3.0, pOff: 4.5, Qdraw: 1.2, tapOpen: false },
      speed: 4,
      steps: ["Кран закрыт: давление стоит, насос не включается.", "Откройте кран щелчком по нему на схеме.", "Дождитесь пуска и снова закройте кран во время работы насоса."],
      watch: ["Без разбора система стоит сколько угодно — это и есть смысл бака.", "При закрытии крана во время работы бак добирается до верхнего порога за секунды.", "Чем меньше бак, тем резче скачок."],
      why: "Без бака любой, даже капельный, разбор вызывал бы включение насоса. Бак — это упругая ёмкость: сжатый воздух отдаёт воду при падении давления и принимает при росте. Мембрана нужна, чтобы воздух не растворялся в воде."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Как работает мембранный бак</h3>' +
    "<p>Внутри — резиновая мембрана (груша). С одной стороны вода, с другой воздух, закачанный заранее. Воздух сжимается изотермически:</p>" +
    '<p class="formula">p<sub>абс</sub> · V<sub>возд</sub> = const</p>' +
    "<p>Пока давление в системе ниже давления подкачки, воды в баке нет совсем: мембрана прижата. Дальше каждый литр воды сжимает воздух и поднимает давление.</p></section>" +

    '<section class="card txt"><h3>Полезный объём</h3>' +
    '<p class="formula">V<sub>пол</sub> = V · (p₂ − p₁) · p₀ / ((p₁ + 1)(p₂ + 1))</p>' +
    "<p>Здесь p₁ — включение, p₂ — выключение, p₀ — подкачка, все в избыточных барах (в формуле они переведены в абсолютные). Для бака 100 л при 3,0/4,5/2,7 бар получается около 20 л — пятая часть.</p>" +
    "<p>Отсюда правило подбора: нужный объём бака = полезный объём × 4…5. А полезный объём определяют из допустимого числа пусков.</p></section>" +

    '<section class="card txt"><h3>Число включений</h3>' +
    '<p class="formula">n = 3600 / (t<sub>раб</sub> + t<sub>пауза</sub>),  максимум при Q<sub>разб</sub> = Q<sub>нас</sub>/2</p>' +
    "<p>В этой точке n = Q<sub>нас</sub>·900/V<sub>пол</sub> (Q в м³/ч, V в литрах). Допустимое число пусков берут из паспорта: бытовые насосы 15–20 в час, средние 10, крупные 6.</p>" +
    "<p>Частотный преобразователь снимает задачу целиком: насос не выключается, а плавно подстраивает обороты под разбор. Бак при этом всё равно ставят, но маленький — чтобы насос засыпал при нулевом разборе.</p></section>" +

    '<section class="card txt"><h3>Что ещё бывает</h3>' +
    "<ul><li><b>Гидропневмобак без мембраны</b> (старые системы): воздух контактирует с водой, растворяется и уходит — нужен компрессор для подкачки.</li>" +
    "<li><b>Бак на всасывании</b> — не путать с напорным: он гасит удары и колебания, а не запасает объём.</li>" +
    "<li><b>Расширительный бак отопления</b> — та же конструкция, но задача другая: принять расширение воды при нагреве.</li>" +
    "<li><b>Проверка подкачки</b>: только на сброшенном давлении, иначе манометр покажет давление воды, а не воздуха. Проверяют раз в год.</li></ul>" +
    "<p>Подробный стенд установки повышения давления — с несколькими насосами, реле, частотником, сухим ходом, чередованием и авариями — в соседней программе «Насосная лаборатория».</p></section>";

  Lab.register(S);
})();
