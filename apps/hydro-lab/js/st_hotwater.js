/* Стенд 7. Циркуляция ГВС и балансировка стояков.

   Схема — только трубы: водоподогреватель, подающая магистраль по подвалу,
   стояки ГВС с верхними перемычками, циркуляционные стояки, балансировочные
   клапаны и циркуляционный насос.

   Теплопотери — СП 61.13330, приложение Э: многослойная цилиндрическая стенка,
       R = Σ ln(d_нар/d_вн)/(2πλ) + 1/(π·d_пов·α),   q = (t_воды − t_окр)/R,
   потери участка Q = q·L·(1 + β), β = 0,2 на опоры и арматуру.

   Остывание воды в трубе при массовом расходе G (кг/ч):
       Δt = Q·3600/(c·G).
   Чем меньше циркуляция, тем сильнее остывание — отсюда и вся задача балансировки:
   раздать расход так, чтобы в верхней точке каждого стояка было не ниже 60 °C
   (СП 30.13330: в местах водоразбора 60…75 °C).

   Балансировочные клапаны — VALTEC VT.054 с настроечной шкалой 0…99;
   Kv на положении берётся из паспортной таблицы (js/valtec.js), перепад
       Δp = (Q/Kv)² бар,   в метрах столба горячей воды это Δp·10,37. */
(function () {
  "use strict";

  var W = 1180, HH = 604;
  var YSUP = 470, YRET = 532;          // магистрали в подвале
  var YTOP = 110;                      // верхняя перемычка
  var RHO = 983;                       // плотность воды при 60 °C, кг/м³
  var CP = 4190;                       // теплоёмкость, Дж/(кг·К)
  var BAR_M = 1e5 / (RHO * 9.80665);   // 1 бар в метрах столба горячей воды ≈ 10,37
  var NMAX = 5;

  var S = {
    id: "hotwater", group: "water", star: true,
    title: "Циркуляция ГВС и балансировка",
    lead: "Четыре стояка горячей воды на одной магистрали. Крутим настроечные положения клапанов VT.054 — и смотрим, как перераспределяются циркуляционные расходы и температура в верхних точках.",
    hint: "Цвет труб — температура воды. Щелчок по клапану открывает его полностью или закрывает. Кнопка «Подобрать настройки» увязывает кольца по той же методике, что и рабочий расчёт.",
    vis: { kind: "svg" },
    speeds: [1, 4, 30],
    speed0: 4,
    maxStep: 0.25
  };

  S.defaults = function () {
    return {
      n: 4,                  // число стояков
      tSup: 65,              // температура на выходе водоподогревателя
      tAmb: 22,              // температура воздуха в шахте
      dtNorm: 5,             // допустимое остывание в циркуляционном кольце, К
      floors: 9,
      hFloor: 3.0,
      dSup: 32,              // внутренний диаметр подающего стояка, мм
      dCirc: 25,             // внутренний диаметр циркуляционного стояка, мм
      mat: "steelGalv",
      ins: 9,                // толщина изоляции, мм
      mainD: 32,
      mainL: 120,            // длина магистралей (подающая + циркуляционная)
      hxS: 2.0,              // потери в подогревателе и обвязке ИТП при 1 м³/ч, м
      pumpH0: 3.0,
      pumpQmax: 1.5,
      pumpMode: "const",
      speed: 1.0,
      dpSet: 3.0,
      risers: [
        { valve: "VT.054.N.05", pos: 99 },
        { valve: "VT.054.N.05", pos: 99 },
        { valve: "VT.054.N.05", pos: 99 },
        { valve: "VT.054.N.05", pos: 99 },
        { valve: "VT.054.N.05", pos: 99 }
      ]
    };
  };

  /* ------------------------------------------------------------ панель */

  var MATS = [
    { id: "steelGalv", name: "сталь оцинкованная", lam: 50, wall: 3.0, k: 0.15 },
    { id: "inox", name: "нержавеющая сталь", lam: 17, wall: 1.5, k: 0.01 },
    { id: "ppr", name: "полипропилен PP-R", lam: 0.24, wall: 0, k: 0.007 },
    { id: "copper", name: "медь", lam: 390, wall: 1.5, k: 0.01 }
  ];
  function matById(id) {
    for (var i = 0; i < MATS.length; i++) if (MATS[i].id === id) return MATS[i];
    return MATS[0];
  }

  function riserFields(i) {
    var show = function (st) { return st.n > i; };
    return [
      { k: "risers." + i + ".valve", t: "select", l: "Клапан", show: show,
        opts: Valtec.Models.map(function (v) { return [v.article, v.caption]; }) },
      { k: "risers." + i + ".pos", t: "range", l: "Настроечное положение", u: "", min: 0, max: 99, step: 1, d: 0, show: show,
        hint: "Шкала VT.054: 0 — закрыт, 99 — полностью открыт. Ниже 3 клапан не пропускает вовсе." },
      { t: "note", k: "risers." + i + ".pos", show: show, render: function (st) {
        var r = m.risers && m.risers[i];
        if (!r) return "";
        return '<div class="hint">Kv = ' + U.fmt(r.kv, 3) + " м³/ч · перепад " + U.fmt(r.hValve * RHO * 9.80665 / 1000, 1) +
          " кПа · требуется положение " + (r.needPos < 0 ? "больше, чем даёт клапан" : U.fmt(r.needPos, 0)) + "</div>";
      } }
    ];
  }

  S.fields = [
    { title: "Источник и насос", open: true, fields: [
      { k: "tSup", t: "range", l: "Температура на выходе подогревателя", u: "°C", min: 55, max: 75, step: 0.5, d: 1,
        hint: "СП 30.13330: в местах водоразбора 60…75 °C. Запас на остывание в магистрали и стояке." },
      { k: "tAmb", t: "range", l: "Температура в шахте", u: "°C", min: 5, max: 30, step: 1, d: 0 },
      { k: "pumpMode", t: "select", l: "Режим насоса", opts: [["const", "постоянная скорость"], ["dp", "поддержание перепада (ПЧ)"]] },
      { k: "speed", t: "range", l: "Скорость насоса", u: "%", min: 0.3, max: 1.1, step: 0.01, pct: true, d: 0,
        show: function (st) { return st.pumpMode === "const"; } },
      { k: "dpSet", t: "range", l: "Уставка перепада", u: "м", min: 0.5, max: 10, step: 0.1, d: 1,
        show: function (st) { return st.pumpMode === "dp"; } },
      { k: "pumpH0", t: "range", l: "Напор насоса при Q = 0", u: "м", min: 1, max: 14, step: 0.1, d: 1 },
      { k: "pumpQmax", t: "range", l: "Расход насоса при H = 0", u: "м³/ч", min: 0.3, max: 10, step: 0.1, d: 1 },
      { t: "custom", k: "dtNorm", render: function () {
        return '<button type="button" data-act="auto" class="primary">Подобрать настройки</button> ' +
          '<button type="button" data-act="open">Открыть все</button>';
      }, onClick: function (act) { if (act === "auto") S.autoBalance(); else S.openAll(); } },
      { k: "dtNorm", t: "range", l: "Допустимое остывание в кольце", u: "К", min: 2, max: 15, step: 0.5, d: 1,
        hint: "Отсюда берётся расчётная циркуляция: G = 3600·ΣQ/(c·Δt). При подаче 65 °C и требовании 60 °C у потребителя на остывание остаётся 5 К." }
    ] },
    { title: "Стояк 1 (ближний)", open: true, fields: riserFields(0) },
    { title: "Стояк 2", fields: riserFields(1) },
    { title: "Стояк 3", fields: riserFields(2) },
    { title: "Стояк 4 (дальний)", fields: riserFields(3) },
    { title: "Стояк 5", fields: riserFields(4) },
    { title: "Трубы и изоляция", fields: [
      { k: "n", t: "range", l: "Число стояков", u: "шт", min: 2, max: NMAX, step: 1, d: 0 },
      { k: "floors", t: "range", l: "Этажей", u: "", min: 2, max: 16, step: 1, d: 0 },
      { k: "hFloor", t: "range", l: "Высота этажа", u: "м", min: 2.5, max: 4, step: 0.1, d: 1 },
      { k: "dSup", t: "range", l: "Диаметр подающего стояка", u: "мм", min: 15, max: 80, step: 1, d: 0 },
      { k: "dCirc", t: "range", l: "Диаметр циркуляционного стояка", u: "мм", min: 10, max: 50, step: 1, d: 0 },
      { k: "mat", t: "select", l: "Материал труб", opts: MATS.map(function (x) { return [x.id, x.name]; }) },
      { k: "ins", t: "range", l: "Толщина изоляции", u: "мм", min: 0, max: 50, step: 1, d: 0,
        hint: "λ изоляции принята 0,04 Вт/(м·К) — вспененный каучук или полиэтилен." },
      { k: "mainD", t: "range", l: "Диаметр магистралей", u: "мм", min: 20, max: 100, step: 1, d: 0,
        hint: "Узкая длинная магистраль — главная причина разрегулировки: до дальнего стояка напора почти не доходит." },
      { k: "mainL", t: "range", l: "Длина магистралей (подача + циркуляция)", u: "м", min: 10, max: 300, step: 5, d: 0 },
      { k: "hxS", t: "range", l: "Потери в подогревателе и ИТП при 1 м³/ч", u: "м", min: 0, max: 8, step: 0.1, d: 1,
        hint: "Общее сопротивление для всех колец: на увязку не влияет, но напор насоса забирает." }
    ] }
  ];

  /* ------------------------------------------------------------ теплопотери */

  /* Удельный тепловой поток трубы, Вт/м (СП 61.13330, прил. Э). */
  function flux(st, dInMm, tWater) {
    var mat = matById(st.mat);
    var dIn = dInMm / 1000;
    var wall = mat.wall > 0 ? mat.wall / 1000 : 0.12 * dIn;      // у PP-R стенка пропорциональна диаметру
    var dOut = dIn + 2 * wall;
    var R = Math.log(dOut / dIn) / (2 * Math.PI * mat.lam);
    var dSurf = dOut;
    if (st.ins > 0.5) {
      var dIns = dOut + 2 * st.ins / 1000;
      R += Math.log(dIns / dOut) / (2 * Math.PI * 0.04);
      dSurf = dIns;
    }
    R += 1 / (Math.PI * dSurf * 8);                              // α = 8 Вт/(м²·К)
    return Math.max(0, (tWater - st.tAmb)) / R;
  }
  function heatOf(st, dInMm, L, tWater) { return flux(st, dInMm, tWater) * L * 1.2; }

  /* ------------------------------------------------------------ гидравлика */

  /* Сопротивление трубы: h = s·Q², Q в м³/ч, h в метрах. Местные учтены
     множителем 1,3 — обычная надбавка для стояков с отводами и тройниками. */
  function pipeS(st, L, dmm, Qref) {
    var d = dmm / 1000, A = Hydro.area(d);
    var v = Math.max(Qref, 0.02) / 3600 / A;
    var lam = Hydro.lambda(Hydro.reynolds(v, d, U.nu(60)), matById(st.mat).k / 1000, d);
    return 1.3 * lam * L / d / (2 * Hydro.G * Math.pow(3600 * A, 2));
  }
  function valveS(st, i) {
    var r = st.risers[i];
    var kv = Valtec.kvAt(Valtec.byArticle(r.valve), r.pos);
    return kv > 1e-4 ? BAR_M / (kv * kv) : 1e9;
  }
  function pumpHead(st, Q, r) {
    return st.pumpH0 * r * r - (st.pumpH0 / (st.pumpQmax * st.pumpQmax)) * Q * Q;
  }

  /* Сопротивления при известных расходах. Коэффициент λ считается один раз на
     расчёт: от расхода он зависит слабо, а Колбрук в каждой итерации — дорого. */
  function resistances(st, Q) {
    var n = st.n, i, j, sMain = [], sRing = [];
    var segL = st.mainL / (2 * n);
    for (i = 0; i < n; i++) {
      var Qseg = 0;
      for (j = i; j < n; j++) Qseg += Q[j];
      sMain[i] = 2 * pipeS(st, segL, st.mainD, Qseg);               // подача и циркуляция
      sRing[i] = riserS(st, i, Q[i]) + valveS(st, i);
    }
    return { sMain: sMain, sRing: sRing, segL: segL };
  }

  /* Расходы колец при заданном напоре Hp на выходе из ИТП (после подогревателя).
     Обратная связь отрицательная — больше расход, больше потери в магистрали,
     меньше остаётся кольцу, — поэтому простые итерации сходятся. */
  function ringsAt(st, Hp, res, Qguess) {
    var n = st.n, i, j, Q = [], dP = [], lost = [];
    for (i = 0; i < n; i++) Q[i] = (Qguess && Qguess[i] > 0) ? Qguess[i] : 0.1;

    for (var it = 0; it < 120; it++) {
      var acc = 0, diff = 0, scale = 0;
      for (i = 0; i < n; i++) {
        var Qseg = 0;
        for (j = i; j < n; j++) Qseg += Q[j];
        acc += res.sMain[i] * Qseg * Qseg;
        lost[i] = acc;
      }
      for (i = 0; i < n; i++) {
        dP[i] = Hp - lost[i];
        var Qi = dP[i] > 0 ? Math.sqrt(dP[i] / res.sRing[i]) : 0;
        diff = Math.max(diff, Math.abs(Qi - Q[i]));
        scale = Math.max(scale, Qi);
        Q[i] = Q[i] + 0.45 * (Qi - Q[i]);
      }
      if (diff < 1e-9 + 1e-7 * scale) break;
    }
    var tot = 0;
    for (i = 0; i < n; i++) tot += Q[i];
    return { Q: Q, dP: dP, lost: lost, Qtot: tot, segL: res.segL };
  }

  /* Решение сети: рабочая точка насоса ищется делением пополам по напору.
     Напрямую итерировать расход нельзя — кривая насоса вместе с сопротивлением
     подогревателя слишком крутая по сравнению с кольцами, и итерации расходятся. */
  function solveOnce(st, res, Qguess) {
    var r = st.speed;
    var B = st.pumpH0 / (st.pumpQmax * st.pumpQmax);

    if (st.pumpMode === "dp") {
      /* Регулятор держит заданный перепад на коллекторах — напор известен сразу,
         а скорость получается из кривой насоса. */
      var out = ringsAt(st, st.dpSet, res, Qguess);
      var need = st.dpSet + (st.hxS + B) * out.Qtot * out.Qtot;
      out.Hp = st.dpSet;
      out.r = U.clamp(Math.sqrt(Math.max(0, need / st.pumpH0)), 0.15, 1.3);
      return out;
    }

    var g = function (Hp) {
      var rr = ringsAt(st, Hp, res, Qguess);
      return pumpHead(st, rr.Qtot, r) - st.hxS * rr.Qtot * rr.Qtot - Hp;
    };
    var Hmax = st.pumpH0 * r * r;
    var Hp = g(0) <= 0 ? 0 : U.bisect(g, 0, Hmax, 34);
    var o2 = ringsAt(st, Hp, res, Qguess);
    o2.Hp = Hp;
    o2.r = r;
    return o2;
  }

  /* Два прохода: первый по сопротивлениям от прошлых расходов, второй — с
     уточнёнными λ. Этого достаточно: λ меняется на единицы процентов. */
  function solve(st, Qguess) {
    var start = [];
    for (var i = 0; i < st.n; i++) start[i] = (Qguess && Qguess[i] > 0) ? Qguess[i] : 0.1;
    var out = solveOnce(st, resistances(st, start), start);
    out = solveOnce(st, resistances(st, out.Q), out.Q);
    return out;
  }

  /* Сопротивление труб кольца (стояк туда и обратно), без клапана. */
  function riserS(st, i, Qref) {
    var L = st.floors * st.hFloor;
    return pipeS(st, L + 2, st.dSup, Qref) + pipeS(st, L + 2, st.dCirc, Qref);
  }

  /* ------------------------------------------------------------ модель */

  var m = { risers: [] }, tr = new Plot.Trend(4000), trT = 0;

  function compute(st, dt) {
    var n = st.n, i;
    var prevQ = m.risers && m.risers.length === n ? m.risers.map(function (r) { return r.Q; }) : null;
    var sol = solve(st, prevQ);
    var L = st.floors * st.hFloor;
    var segL = sol.segL;

    /* Теплопотери зависят от температуры воды, а температура — от расхода.
       Три прохода дают сходимость с запасом. */
    var risers = [];
    for (i = 0; i < n; i++) {
      risers.push({ Q: sol.Q[i], tIn: st.tSup, tTop: st.tSup, tBot: st.tSup, Qup: 0, Qdn: 0 });
    }
    for (var pass = 0; pass < 4; pass++) {
      /* Подающая магистраль: участок j несёт расход всех дальних стояков. */
      var tLine = st.tSup, mainLoss = 0;
      for (i = 0; i < n; i++) {
        var Qseg = 0;
        for (var j = i; j < n; j++) Qseg += risers[j].Q;
        var Gseg = Qseg * RHO;                                   // кг/ч
        var qSeg = heatOf(st, st.mainD, segL, tLine);
        mainLoss += qSeg;
        if (Gseg > 1e-6) tLine -= qSeg * 3600 / (CP * Gseg);
        risers[i].tIn = tLine;
      }
      for (i = 0; i < n; i++) {
        var R = risers[i];
        var G = R.Q * RHO;
        R.Qup = heatOf(st, st.dSup, L, (R.tIn + R.tTop) / 2);
        R.tTop = G > 1e-6 ? R.tIn - R.Qup * 3600 / (CP * G) : st.tAmb;
        R.Qdn = heatOf(st, st.dCirc, L, (R.tTop + R.tBot) / 2);
        R.tBot = G > 1e-6 ? R.tTop - R.Qdn * 3600 / (CP * G) : st.tAmb;
        R.tTop = Math.max(R.tTop, st.tAmb);
        R.tBot = Math.max(R.tBot, st.tAmb);
        R.Qloss = R.Qup + R.Qdn;
      }
      m.mainLoss = mainLoss;
    }

    /* Инерция: температуры меняются не мгновенно. */
    for (i = 0; i < n; i++) {
      var old = m.risers && m.risers[i];
      if (dt && old && old.tTopShown !== undefined) {
        var tau = 90;
        risers[i].tTopShown = old.tTopShown + (risers[i].tTop - old.tTopShown) * U.clamp(dt / tau, 0, 1);
        risers[i].tBotShown = old.tBotShown + (risers[i].tBot - old.tBotShown) * U.clamp(dt / tau, 0, 1);
      } else {
        risers[i].tTopShown = risers[i].tTop;
        risers[i].tBotShown = risers[i].tBot;
      }
    }

    /* Требуемые расходы: общий по теплопотерям всей системы, распределённый
       между стояками пропорционально их потерям. */
    var lossRisers = 0;
    for (i = 0; i < n; i++) lossRisers += risers[i].Qloss;
    var GtotReq = 3600 * (lossRisers + m.mainLoss) / (CP * st.dtNorm);

    /* Справочные величины по каждому стояку. */
    var Gsum = 0, Tmix = 0, lossTot = m.mainLoss;
    for (i = 0; i < n; i++) {
      var r = risers[i], model = Valtec.byArticle(st.risers[i].valve);
      r.kv = Valtec.kvAt(model, st.risers[i].pos);
      r.model = model;
      r.hValve = valveS(st, i) * r.Q * r.Q;
      r.hPipe = riserS(st, i, r.Q) * r.Q * r.Q;
      r.dP = sol.dP[i];
      r.G = r.Q * RHO;
      r.vSup = r.Q / 3600 / Hydro.area(st.dSup / 1000);
      r.vCirc = r.Q / 3600 / Hydro.area(st.dCirc / 1000);
      r.Greq = lossRisers > 1e-6 ? GtotReq * r.Qloss / lossRisers : 0;   // кг/ч
      r.Qreq = r.Greq / RHO;                                     // м³/ч
      r.rel = r.Greq > 1e-6 ? r.G / r.Greq : 0;
      r.ok = r.tTop >= 60;
      lossTot += r.Qloss;
      Gsum += r.G;
      Tmix += r.G * r.tBot;
    }

    /* Какое положение нужно, чтобы через стояк пошёл расчётный расход при
       нынешнем напоре насоса: клапан забирает всё, что осталось от располагаемого
       перепада после потерь в трубах кольца. Kv = G/√Δp. */
    for (i = 0; i < n; i++) {
      var rr = risers[i];
      var sPipe = riserS(st, i, rr.Qreq);
      var hNeed = rr.dP - sPipe * rr.Qreq * rr.Qreq;
      if (hNeed <= 1e-4 || rr.Qreq < 1e-6) {
        rr.needKv = rr.model.maxKv;
        rr.needPos = 99;
      } else {
        rr.needKv = rr.Qreq / Math.sqrt(hNeed / BAR_M);
        rr.needPos = Valtec.positionFor(rr.model, Math.min(rr.needKv, rr.model.maxKv * 0.999));
        if (rr.needKv > rr.model.maxKv) rr.needPos = -1;
      }
    }

    m.risers = risers;
    m.n = n;
    m.Qtot = sol.Qtot;
    m.Hp = sol.Hp;
    m.r = sol.r;
    m.lossTot = lossTot;
    m.tRet = Gsum > 1e-6 ? Tmix / Gsum : st.tSup;
    m.Gtot = Gsum;
    m.dtSys = st.tSup - m.tRet;
    m.worst = 0;
    for (i = 1; i < n; i++) if (risers[i].tTop < risers[m.worst].tTop) m.worst = i;
    m.Greq = GtotReq;
    m.vMain = m.Qtot / 3600 / Hydro.area(st.mainD / 1000);
  }

  /* ------------------------------------------------------------ автобалансировка */

  /* Та же методика, что в рабочем расчёте: расход каждого кольца — по его
     теплопотерям, кольцо с наибольшими потерями труб остаётся открытым,
     остальным недостающее сопротивление добирает клапан (Kv = G/√Δp). */
  /* Насос под требуемый суммарный расход: подбираем напор делением пополам. */
  function fitPump(st, Qreq) {
    var need = 0, i;
    for (i = 0; i < st.n; i++) need += Qreq[i];
    st.speed = 1;
    st.pumpQmax = Math.max(0.4, Math.round(need * 2.2 * 10) / 10);
    var f = function (H0) {
      var save = st.pumpH0;
      st.pumpH0 = H0;
      var s = solve(st, Qreq);
      st.pumpH0 = save;
      return s.Qtot - need;
    };
    st.pumpH0 = Math.round(U.clamp(U.bisect(f, 0.3, 25, 34), 0.3, 25) * 10) / 10;
  }

  /* Увязка колец. Порядок тот же, что в рабочем расчёте:
       1) расход кольца — по его теплопотерям;
       2) насос — под суммарный требуемый расход;
       3) клапан кольца забирает весь перепад, оставшийся после потерь в трубах:
          Kv = G/√Δp, дальше по настроечной таблице ищется положение шкалы.
     Шаги повторяются несколько раз: прикрытый клапан меняет расходы соседей,
     а значит, и располагаемые перепады. Так же балансируют и на объекте. */
  S.autoBalance = function () {
    var st = S.state, n = st.n, i, pass;
    compute(st, 0);
    var Qreq = [];
    for (i = 0; i < n; i++) Qreq[i] = m.risers[i].Qreq;

    for (pass = 0; pass < 6; pass++) {
      fitPump(st, Qreq);
      compute(st, 0);
      for (i = 0; i < n; i++) {
        var r = m.risers[i];
        var hNeed = r.dP - riserS(st, i, Qreq[i]) * Qreq[i] * Qreq[i];
        if (hNeed <= 1e-4 || Qreq[i] < 1e-6) {
          st.risers[i].pos = 99;
          continue;
        }
        var kv = Qreq[i] / Math.sqrt(hNeed / BAR_M);
        var model = Valtec.choose(kv);
        st.risers[i].valve = model.article;
        var pos = Valtec.positionFor(model, kv);
        st.risers[i].pos = pos < 0 ? 99 : U.clamp(Math.round(pos), 0, 99);
      }
      compute(st, 0);
      /* Теплопотери зависят от температур, поэтому требуемые расходы уточняются. */
      for (i = 0; i < n; i++) Qreq[i] = m.risers[i].Qreq;
    }
    fitPump(st, Qreq);
    compute(st, 0);
    if (st.pumpMode === "dp") st.dpSet = Math.max(0.5, Math.round(m.Hp * 10) / 10);
    compute(st, 0);
  };

  S.openAll = function () {
    var st = S.state;
    for (var i = 0; i < NMAX; i++) st.risers[i].pos = 99;
    compute(st, 0);
  };

  S.reset = function () { m = { risers: [] }; tr.clear(); trT = 0; compute(S.state, 0); };
  S.onChange = function () { compute(S.state, 0); };

  S.tick = function (dt) {
    compute(S.state, dt);
    trT += dt;
    if (trT > 1) {
      trT = 0;
      var v = { Qtot: m.Qtot, tRet: m.tRet };
      m.risers.forEach(function (r, i) { v["G" + i] = r.G; v["T" + i] = r.tTopShown; });
      tr.push(S.t, v);
    }
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function xOf(st, i) {
    var n = st.n, gap = Math.min(190, (950 - 60) / n);
    return 300 + i * gap;
  }

  function build(ui) {
    var st = S.state;
    var key = [st.n, st.floors].join("|");
    if (built === key) return;
    built = key;
    var s = SK.open(W, HH), i, k;
    var hF = (YSUP - 40 - YTOP) / st.floors;

    // --- водоподогреватель
    s += SK.rect(null, 40, 420, 110, 130, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt(null, 95, 442, "cap", "middle", "подогреватель");
    s += SK.txt("srcT", 95, 466, "val", "middle", "");
    s += SK.txt(null, 95, 486, "tiny muted", "middle", "ИТП / бойлер");
    s += SK.txt("retT", 95, 522, "val", "middle", "");

    // --- магистрали
    s += SK.path("supMain", "M150 " + YSUP + " H1110", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="10" stroke-linecap="round"');
    s += SK.path("retMain", "M150 " + YRET + " H1110", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="10" stroke-linecap="round"');
    s += SK.txt(null, 160, YSUP - 12, "tiny muted", "start", "подающая магистраль Т3");
    s += SK.txt(null, 160, YRET + 22, "tiny muted", "start", "циркуляционная магистраль Т4");

    // --- циркуляционный насос
    s += SK.g("pump", "", SK.circle(null, 0, 0, 20, "", ' fill="var(--panel)" stroke="var(--accent)" stroke-width="2"') +
      SK.path("imp", "M-10 0 L10 0 M0 -10 L0 10", "", ' stroke="var(--accent)" stroke-width="2.5"') +
      SK.txt("pumpT", 0, 34, "tiny", "middle", ""),
      ' transform="translate(215,' + YRET + ')"');

    // --- этажи
    for (k = 1; k <= st.floors; k++) {
      var y = YSUP - 40 - (k - 1) * hF;
      s += SK.line(null, 250, y, 1120, y, "", ' stroke="var(--line)" stroke-width="1"');
      s += SK.txt(null, 256, y - 5, "tiny muted", "start", k + " этаж");
    }

    // --- стояки
    for (i = 0; i < st.n; i++) {
      var x = xOf(st, i), xr = x + 46;
      s += SK.path("rs" + i, "M" + x + " " + YSUP + " V" + YTOP + " H" + xr + " V" + YRET, "",
        ' fill="none" stroke="var(--pipe-lo)" stroke-width="7" stroke-linejoin="round"');
      s += SK.path("rsUp" + i, "M" + x + " " + YSUP + " V" + YTOP, "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="7"');
      s += SK.path("rsTop" + i, "M" + x + " " + YTOP + " H" + xr, "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="7"');
      s += SK.path("rsDn" + i, "M" + xr + " " + YTOP + " V" + YRET, "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="7"');
      /* водоразборные подводки — просто отростки на каждом этаже */
      for (k = 1; k <= st.floors; k++) {
        var yf = YSUP - 40 - (k - 1) * hF;
        s += SK.line(null, x, yf, x - 26, yf, "", ' stroke="var(--pipe-lo)" stroke-width="4" stroke-linecap="round"');
      }
      s += SK.txt(null, x + 23, YTOP - 34, "cap", "middle", "Ст " + (i + 1) + (i === 0 ? " (ближний)" : (i === st.n - 1 ? " (дальний)" : "")));
      s += SK.txt("tTop" + i, x + 23, YTOP - 14, "val", "middle", "");
      // балансировочный клапан на циркуляционном стояке
      s += SK.valve("bv" + i, xr, (YSUP + YRET) / 2 + 4, "clickable", 11);
      s += SK.txt("bvT" + i, xr + 15, YSUP + 18, "tiny", "start", "");
      s += SK.txt("bvT2" + i, xr + 15, YSUP + 31, "tiny muted", "start", "");
      s += SK.txt("gT" + i, x - 8, YSUP + 18, "val", "end", "");
      s += SK.txt("gT2" + i, x - 8, YSUP + 31, "tiny muted", "end", "");
    }

    // --- итог
    s += SK.rect(null, 40, HH - 44, 1100, 36, "", ' fill="var(--panel2)" stroke="var(--line)" rx="6"');
    s += SK.txt("sumT", 56, HH - 20, "val", "start", "");
    s += SK.txt("sumT2", 1124, HH - 20, "val", "end", "");
    s += SK.close();
    ui.vis.innerHTML = s;

    var ids = ["supMain", "retMain", "pump", "imp", "pumpT", "srcT", "retT", "sumT", "sumT2"];
    for (i = 0; i < st.n; i++) ids.push("rsUp" + i, "rsTop" + i, "rsDn" + i, "tTop" + i, "bv" + i, "bvT" + i, "bvT2" + i, "gT" + i, "gT2" + i);
    R = SK.refs(ui.vis, ids);

    ui.vis.addEventListener("click", function (e) {
      for (var j = 0; j < NMAX; j++) {
        if (R["bv" + j] && e.target.closest("#bv" + j)) {
          S.state.risers[j].pos = S.state.risers[j].pos > 3 ? 0 : 99;
          compute(S.state, 0);
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
    var st = S.state, i;
    var t0 = st.tAmb, t1 = Math.max(st.tSup, st.tAmb + 5);

    SK.set(R.supMain, { stroke: U.heatColor(st.tSup, t0, t1) });
    SK.set(R.retMain, { stroke: U.heatColor(m.tRet, t0, t1) });
    SK.text(R.srcT, U.fmt(st.tSup, 1) + " °C");
    SK.text(R.retT, "обратка " + U.fmt(m.tRet, 1) + " °C");
    SK.set(R.imp, { transform: "rotate(" + ((S.anim || 0) * 260 * m.r % 360) + ")" });
    SK.text(R.pumpT, U.fmt(m.Hp, 2) + " м · " + U.fmt(m.r * 100, 0) + " %");

    for (i = 0; i < st.n; i++) {
      var r = m.risers[i], rs = st.risers[i];
      SK.set(R["rsUp" + i], { stroke: U.heatColor((r.tIn + r.tTopShown) / 2, t0, t1) });
      SK.set(R["rsTop" + i], { stroke: U.heatColor(r.tTopShown, t0, t1) });
      SK.set(R["rsDn" + i], { stroke: U.heatColor((r.tTopShown + r.tBotShown) / 2, t0, t1) });
      SK.text(R["tTop" + i], U.fmt(r.tTopShown, 1) + " °C");
      SK.set(R["tTop" + i], { fill: r.tTopShown >= 60 ? "var(--good)" : "var(--bad)" });
      SK.text(R["gT" + i], U.fmt(r.G, 0) + " кг/ч");
      SK.text(R["gT2" + i], U.fmt(r.rel * 100, 0) + " % от нормы");
      SK.set(R["gT2" + i], { fill: r.rel > 0.75 && r.rel < 1.5 ? "var(--muted)" : "var(--warn)" });
      SK.text(R["bvT" + i], "поз. " + U.fmt(rs.pos, 0));
      SK.text(R["bvT2" + i], "Kv " + U.fmt(r.kv, 2));
      SK.cls(R["bv" + i], "shut", rs.pos <= Valtec.DeadBand);
      SK.cls(R["bv" + i], "throttled", rs.pos > Valtec.DeadBand && rs.pos < 90);
    }

    SK.text(R.sumT, "Циркуляция " + U.fmt(m.Gtot, 0) + " кг/ч (" + U.fmt(m.Qtot, 3) + " м³/ч) · напор насоса " +
      U.fmt(m.Hp, 2) + " м · теплопотери " + U.fmt(m.lossTot / 1000, 2) + " кВт");
    SK.text(R.sumT2, "по расчёту нужно " + U.fmt(m.Greq, 0) + " кг/ч при Δt = " + U.fmt(st.dtNorm, 1) +
      " К · обратка " + U.fmt(m.tRet, 1) + " °C");
    SK.set(R.sumT2, { fill: m.Gtot >= m.Greq * 0.9 ? "var(--good)" : "var(--bad)" });

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "scada", title: "Расходы стояков и температура в верхних точках", h: 330 },
    { id: "valve", title: "Настроечная таблица VT.054: Kv на положении шкалы", h: 330 }
  ];

  function drawCharts(ui) {
    var st = S.state, i;
    var cols = [U.css("--p1"), U.css("--p2"), U.css("--p3"), U.css("--p4"), U.css("--est")];

    var f = U.fitCanvas(ui.canvas("scada"));
    var win = 900;
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: Math.max(0, S.t - win), x1: Math.max(win, S.t), y0: 0,
      y1: Plot.niceMax(Math.max(20, m.Gtot * 1.3)),
      y2: [Math.min(st.tAmb, 50), Math.max(st.tSup + 2, 70)],
      xLabel: "время, с", yLabel: "расход стояка, кг/ч", y2Label: "температура вверху, °C",
      xFmt: function (x) { return U.fmt(x / 60, 0) + " мин"; }
    });
    Plot.clip(p);
    Plot.hline(p, 0, { color: U.css("--axis"), dash: [2, 3] });
    for (i = 0; i < st.n; i++) {
      Plot.line(p, tr.series("G" + i, S.t, win), { color: cols[i], width: 2 });
      Plot.line(p, tr.series("T" + i, S.t, win), { color: cols[i], width: 1.3, dash: [5, 3] }, true);
    }
    Plot.unclip(p);
    var y60 = p.Y2 ? null : null;
    Plot.legend(p, [
      { color: cols[0], text: "Ст 1" }, { color: cols[1], text: "Ст 2" },
      { color: cols[2], text: "Ст 3" }, { color: cols[3], text: "Ст 4" },
      { color: U.css("--ink"), text: "штриховые — температура в верхней точке (правая ось)", dash: [5, 3] }
    ]);
    /* Линия 60 °C по правой оси. */
    if (p.Y2) {
      var c = p.ctx;
      c.save();
      c.strokeStyle = U.css("--bad"); c.setLineDash([6, 4]); c.lineWidth = 1.6;
      var yy = Math.round(p.Y2(60)) + 0.5;
      c.beginPath(); c.moveTo(p.L, yy); c.lineTo(p.R, yy); c.stroke();
      c.restore();
      Plot.label(p, p.L + 6, 0, "60 °C — предел по СП 30", U.css("--bad"), "left", "bottom", true);
      Plot.label(p, p.L + 6, 0, "", U.css("--bad"), "left", "bottom", false);
    }

    /* Настроечная таблица клапана. */
    var f2 = U.fitCanvas(ui.canvas("valve"));
    var model = Valtec.byArticle(st.risers[0].valve);
    var maxKv = 0;
    for (i = 0; i < st.n; i++) maxKv = Math.max(maxKv, Valtec.byArticle(st.risers[i].valve).maxKv);
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 99, y0: 0, y1: Plot.niceMax(maxKv * 1.1),
      xLabel: "положение шкалы", yLabel: "Kv, м³/ч"
    });
    Plot.clip(p2);
    var used = {};
    for (i = 0; i < st.n; i++) used[st.risers[i].valve] = true;
    Valtec.Models.forEach(function (mm, k) {
      var pts = [];
      for (var q = 0; q <= 99; q++) pts.push([q, Valtec.kvAt(mm, q)]);
      var on = !!used[mm.article];
      Plot.line(p2, pts, { color: on ? U.css("--accent") : U.css("--muted"), width: on ? 2.2 : 1, dash: on ? null : [4, 4], alpha: on ? 1 : 0.5 });
    });
    for (i = 0; i < st.n; i++) {
      Plot.dot(p2, st.risers[i].pos, m.risers[i].kv, 5.5, cols[i], U.css("--panel"), 2);
      if (m.risers[i].needPos > 0) {
        Plot.cross(p2, m.risers[i].needPos, Math.min(m.risers[i].needKv, maxKv), 5, cols[i]);
      }
    }
    Plot.unclip(p2);
    Plot.legend(p2, [
      { color: U.css("--accent"), text: "клапаны, стоящие на стояках" },
      { color: U.css("--muted"), text: "остальные типоразмеры VT.054", dash: [4, 4] },
      { color: cols[0], text: "кружок — как выставлено", dot: true },
      { color: cols[0], text: "крестик — как надо по увязке", cross: true }
    ]);
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, rows = [], i;
    rows.push({ n: "Циркуляционный расход", v: U.fmt(m.Gtot, 0) + " кг/ч (" + U.fmt(m.Qtot, 3) + " м³/ч)" });
    rows.push({ n: "По расчёту нужно", v: U.fmt(m.Greq, 0) + " кг/ч при Δt = " + U.fmt(st.dtNorm, 1) + " К",
      cls: m.Gtot >= m.Greq * 0.9 ? "good" : "bad" });
    rows.push({ n: "Напор насоса", v: U.fmt(m.Hp, 2) + " м (" + U.fmt(m.r * 100, 0) + " % скорости)" });
    rows.push({ n: "Теплопотери всего", v: U.fmt(m.lossTot / 1000, 2) + " кВт" });
    rows.push({ n: "из них магистрали", v: U.fmt(m.mainLoss / 1000, 2) + " кВт", cls: "sub" });
    rows.push({ n: "Температура обратки", v: U.fmt(m.tRet, 1) + " °C" });
    rows.push({ n: "Перепад по системе", v: U.fmt(m.dtSys, 1) + " К" });
    rows.push({ n: "Скорость в магистрали", v: U.fmt(m.vMain, 2) + " м/с", cls: m.vMain > 1.5 ? "warn" : "sub" });
    for (i = 0; i < st.n; i++) {
      var r = m.risers[i], rs = st.risers[i];
      rows.push({ h: "Стояк " + (i + 1) + " — " + r.model.caption });
      rows.push({ n: "Положение / Kv", v: U.fmt(rs.pos, 0) + " / " + U.fmt(r.kv, 3) + " м³/ч" });
      rows.push({ n: "Нужно по увязке", v: r.needPos < 0 ? "клапан мал" : U.fmt(r.needPos, 0) + " (Kv " + U.fmt(r.needKv, 3) + ")",
        cls: Math.abs(r.needPos - rs.pos) > 8 ? "warn" : "sub" });
      rows.push({ n: "Расход", v: U.fmt(r.G, 0) + " кг/ч (" + U.fmt(r.rel * 100, 0) + " % от нужного)",
        cls: r.rel < 0.75 ? "bad" : (r.rel > 1.6 ? "warn" : "good") });
      rows.push({ n: "Температура вверху / внизу", v: U.fmt(r.tTop, 1) + " / " + U.fmt(r.tBot, 1) + " °C",
        cls: r.tTop >= 60 ? "good" : "bad" });
      rows.push({ n: "Остывание по стояку", v: U.fmt(r.tIn - r.tBot, 1) + " К" });
      rows.push({ n: "Теплопотери стояка", v: U.fmt(r.Qloss, 0) + " Вт" });
      rows.push({ n: "Перепад: трубы / клапан", v: U.fmt(r.hPipe, 2) + " / " + U.fmt(r.hValve, 2) + " м", cls: "sub" });
      rows.push({ n: "Перепад на клапане", v: U.fmt(r.hValve * RHO * 9.80665 / 1000, 1) + " кПа",
        cls: r.hValve * RHO * 9.80665 / 1000 > 30 ? "warn" : "sub" });
      rows.push({ n: "Скорость подача / циркуляция", v: U.fmt(r.vSup, 2) + " / " + U.fmt(r.vCirc, 2) + " м/с",
        cls: r.vCirc > 1.5 ? "warn" : "sub" });
    }
    return rows;
  };

  S.explain = function () {
    var st = S.state, out = [], i;
    var cold = [];
    for (i = 0; i < st.n; i++) if (m.risers[i].tTop < 60) cold.push(i + 1);

    if (cold.length) {
      out.push({
        lvl: "bad",
        text: "<b>Недогрев: стояк" + (cold.length > 1 ? "и " : " ") + cold.join(", ") + ".</b> В верхней точке " +
          U.fmt(m.risers[m.worst].tTop, 1) + " °C вместо нормативных 60 °C (СП 30.13330). Причина не в подогревателе — на выходе " +
          U.fmt(st.tSup, 1) + " °C, — а в том, что через этот стояк идёт " + U.fmt(m.risers[m.worst].rel * 100, 0) +
          " % нужного расхода: вода ползёт медленно и успевает остыть."
      });
    } else {
      out.push({ lvl: "good", text: "Во всех стояках вверху не ниже 60 °C — требование СП 30.13330 выполнено. Самый холодный стояк " + (m.worst + 1) + ": " + U.fmt(m.risers[m.worst].tTop, 1) + " °C." });
    }

    var rels = m.risers.map(function (r) { return r.rel; });
    var spread = Math.max.apply(null, rels) / Math.max(Math.min.apply(null, rels), 1e-6);
    if (spread > 1.6) {
      out.push({
        lvl: "warn",
        text: "Расходы разошлись в " + U.fmt(spread, 1) + " раза: ближний стояк получает " + U.fmt(rels[0] * 100, 0) +
          " % нормы, дальний — " + U.fmt(rels[st.n - 1] * 100, 0) + " %. Вода идёт туда, где короче путь и меньше сопротивление. " +
          "Нажмите «Подобрать настройки» — клапаны прижмут ближние кольца, и расходы выровняются."
      });
    } else {
      out.push({ lvl: "good", text: "Кольца увязаны: расходы стояков " + rels.map(function (r) { return U.fmt(r * 100, 0) + " %"; }).join(" · ") + " от расчётных." });
    }

    out.push({
      lvl: "info",
      text: "Циркуляционный расход не берётся с потолка: он покрывает теплопотери труб. " +
        "При теплопотерях " + U.fmt(m.lossTot / 1000, 2) + " кВт и допустимом остывании " + U.fmt(st.dtNorm, 1) +
        " К нужно G = 3600·Q/(c·Δt) = <b>" + U.fmt(m.Greq, 0) + " кг/ч</b>. Сейчас насос гонит " + U.fmt(m.Gtot, 0) + " кг/ч."
    });

    var badValve = -1;
    for (i = 0; i < st.n; i++) if (Math.abs(m.risers[i].needPos - st.risers[i].pos) > 8) { badValve = i; break; }
    if (badValve >= 0) {
      var r = m.risers[badValve];
      out.push({
        lvl: "warn",
        text: "Стояк " + (badValve + 1) + ": выставлено положение " + U.fmt(st.risers[badValve].pos, 0) + " (Kv = " + U.fmt(r.kv, 2) +
          "), а по увязке нужно " + (r.needPos < 0 ? "больше, чем может этот клапан" : U.fmt(r.needPos, 0) + " (Kv = " + U.fmt(r.needKv, 2) + ")") +
          ". Kv = G/√Δp: чтобы забрать лишний перепад " + U.fmt(Math.max(0, r.dP - r.hPipe), 2) + " м, клапан должен быть именно такой пропускной способности."
      });
    }

    if (st.ins < 1) {
      out.push({
        lvl: "bad",
        text: "Изоляции нет вовсе: теплопотери " + U.fmt(m.lossTot / 1000, 2) + " кВт, и циркуляции нужно втрое больше обычного. " +
          "Поставьте 9…13 мм — потери упадут в 2,5–3 раза, а вместе с ними и требуемый расход, и мощность насоса."
      });
    } else if (st.ins < 9) {
      out.push({ lvl: "warn", text: "Изоляция " + U.fmt(st.ins, 0) + " мм — тонковато. Для стояков ГВС обычно берут толщину не меньше 9…13 мм: дальше эффект насыщается, но первые миллиметры дают больше всего." });
    }

    var noisy = -1;
    for (i = 0; i < st.n; i++) if (m.risers[i].hValve * RHO * 9.80665 / 1000 > 30) { noisy = i; break; }
    if (noisy >= 0) {
      out.push({
        lvl: "warn",
        text: "На клапане стояка " + (noisy + 1) + " гасится " + U.fmt(m.risers[noisy].hValve * RHO * 9.80665 / 1000, 0) +
          " кПа. Паспортный предел по шуму у VT.054 — 500 кПа, но в жилом доме стараются держаться ниже 20…30 кПа: иначе клапан слышно в квартирах. Если перепад велик, значит, насос подобран с избытком — убавьте напор."
      });
    }

    if (st.pumpMode === "dp") {
      out.push({ lvl: "info", text: "Насос держит перепад " + U.fmt(st.dpSet, 1) + " м и работает на " + U.fmt(m.r * 100, 0) + " % скорости. В ГВС это полезно вдвойне: ночью, когда разбора нет, циркуляция остаётся, а мощность насоса падает." });
    }

    var lowPos = -1;
    for (i = 0; i < st.n; i++) if (st.risers[i].pos > Valtec.DeadBand && st.risers[i].pos < 10) { lowPos = i; break; }
    if (lowPos >= 0) {
      out.push({ lvl: "warn", text: "Стояк " + (lowPos + 1) + " прижат до положения " + U.fmt(st.risers[lowPos].pos, 0) + ". В начале шкалы цена деления огромна: пол-оборота меняет Kv в разы, настройка не держится. Лучше взять клапан поменьше — тогда та же увязка получится на положении ближе к открытому." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Без балансировки: дальний стояк холодный", tag: "★ главный",
      preset: {
        n: 4, tSup: 65, tAmb: 22, ins: 9, mainD: 32, mainL: 120, hxS: 2, pumpMode: "const", speed: 1, pumpH0: 3, pumpQmax: 1.5,
        risers: [{ valve: "VT.054.N.05", pos: 99 }, { valve: "VT.054.N.05", pos: 99 },
          { valve: "VT.054.N.05", pos: 99 }, { valve: "VT.054.N.05", pos: 99 }, { valve: "VT.054.N.05", pos: 99 }]
      },
      speed: 4,
      steps: [
        "Все клапаны открыты настежь — «как смонтировали».",
        "Посмотрите на расходы стояков и на температуры вверху.",
        "Прижмите клапан первого стояка: положение 40, потом 25.",
        "Следите, как оживает дальний стояк."
      ],
      watch: [
        "Расход перераспределяется сразу, температура — через минуту-другую.",
        "Цвет труб дальнего стояка теплеет.",
        "Суммарный расход при этом падает, а холодных стояков не остаётся."
      ],
      why: "Вода идёт по кольцу с наименьшим сопротивлением. Ближний стояк подключён к магистрали раньше и имеет короткий путь, поэтому забирает почти всю циркуляцию. Дальнему остаётся ток настолько слабый, что вода в нём успевает остыть — и жильцы верхних этажей сливают её в канализацию, ожидая горячую."
    },
    {
      title: "2. Подобрать настройки по методике", tag: "★ увязка",
      preset: {
        n: 4, tSup: 65, ins: 9, mainD: 32, mainL: 120, hxS: 2, dtNorm: 5, pumpMode: "const", speed: 1, pumpH0: 3, pumpQmax: 1.5,
        risers: [{ valve: "VT.054.N.05", pos: 99 }, { valve: "VT.054.N.05", pos: 99 },
          { valve: "VT.054.N.05", pos: 99 }, { valve: "VT.054.N.05", pos: 99 }, { valve: "VT.054.N.05", pos: 99 }]
      },
      speed: 4,
      steps: [
        "Нажмите «Подобрать настройки» на панели слева.",
        "Посмотрите, какие положения получились и какие типоразмеры выбраны.",
        "На правом графике сравните кружки (как выставлено) и крестики (как надо).",
        "Сбейте одну настройку вручную и посмотрите, что станет с соседями."
      ],
      watch: [
        "Дальний стояк остаётся почти открытым — он самый невыгодный.",
        "Ближним достаются малые положения: им надо погасить больше.",
        "Температуры вверху выравниваются около 60…62 °C."
      ],
      why: "Методика та же, что в рабочем расчёте: расход каждого кольца считается по его теплопотерям (G = 3600·Q/(c·Δt)), затем находится кольцо с наибольшими потерями труб, а остальным недостающее сопротивление добирает клапан: Kv = G/√Δp, Δp в барах. Дальше по настроечной таблице VT.054 ищется положение шкалы."
    },
    {
      title: "3. Что делает изоляция", tag: "теплопотери",
      preset: { n: 4, tSup: 65, ins: 13, dtNorm: 5, mainD: 32, mainL: 120, hxS: 2, pumpMode: "const", speed: 1 },
      speed: 4,
      steps: ["Изоляция 13 мм: запишите теплопотери и требуемый расход.", "Убирайте изоляцию: 9, 5, 0 мм.", "Посмотрите на температуры вверху и на требуемый расход."],
      watch: [
        "Без изоляции теплопотери растут в 2,5–3 раза.",
        "Требуемая циркуляция растёт во столько же раз.",
        "Температуры проваливаются даже при увязанных кольцах."
      ],
      why: "Циркуляция компенсирует теплопотери, поэтому изоляция — самый дешёвый способ уменьшить и насос, и трубы, и счёт за тепло. Первые же 9 мм снимают большую часть потерь: сопротивление изоляции входит под логарифмом, и дальше эффект быстро насыщается."
    },
    {
      title: "4. Перекрыть стояк", tag: "эксплуатация",
      preset: { n: 4, tSup: 65, ins: 9, dtNorm: 5, mainD: 32, mainL: 120, hxS: 2, pumpMode: "const", speed: 1 },
      speed: 4,
      steps: ["Подберите настройки, дождитесь установившегося режима.", "Щёлкните по клапану второго стояка — он закроется.", "Смотрите, что стало с соседями и с насосом.", "Переключите насос в режим поддержания перепада и повторите."],
      watch: [
        "Циркуляция во втором стояке прекращается, он остывает до температуры шахты.",
        "На постоянной скорости насос идёт влево по кривой, напор растёт, соседи получают лишнюю воду.",
        "С поддержанием перепада этого не происходит."
      ],
      why: "Закрытый стояк — это не только его собственный недогрев. Уменьшение суммарного расхода поднимает напор насоса, и вся увязка съезжает. Поэтому после любого вмешательства в настройку балансировку проверяют заново, а насос с электронным управлением по перепаду сильно упрощает жизнь."
    },
    {
      title: "5. Мелкая шкала — плохая настройка", tag: "★ подбор клапана",
      preset: {
        n: 4, tSup: 65, ins: 9, mainD: 32, mainL: 120, hxS: 2, pumpH0: 8, pumpQmax: 3, speed: 1, pumpMode: "const",
        risers: [{ valve: "VT.054.N.09", pos: 20 }, { valve: "VT.054.N.09", pos: 30 },
          { valve: "VT.054.N.09", pos: 45 }, { valve: "VT.054.N.09", pos: 99 }, { valve: "VT.054.N.05", pos: 99 }]
      },
      speed: 4,
      steps: [
        "На всех стояках стоят клапаны 2\" — заведомо большие.",
        "Посмотрите на правый график: рабочие точки сидят в начале шкалы, где она крутая.",
        "Подвиньте положение первого стояка на два деления и посмотрите, как прыгнул расход.",
        "Нажмите «Подобрать настройки» — программа сама выберет типоразмер поменьше."
      ],
      watch: [
        "У большого клапана два деления шкалы меняют Kv в полтора раза.",
        "После подбора положения уходят в верхнюю половину шкалы.",
        "Там же шкала пологая, и настройка держится."
      ],
      why: "Подбирают не «клапан по диаметру трубы», а клапан по требуемому Kv: самый узкий из тех, у кого настройка попадает в рабочую часть шкалы. Чем ближе положение к полному открытию, тем мельче цена деления и тем точнее выйдет увязка — именно так устроен подбор в паспорте VT.054."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Зачем в ГВС циркуляция</h3>' +
    "<p>Если бы воду только разбирали, в стояке она остывала бы между разборами, и утром пришлось бы сливать по ведру перед умыванием. Поэтому горячая вода постоянно бежит по кольцу: подающий стояк вверх — перемычка — циркуляционный стояк вниз — магистраль — насос — подогреватель.</p>" +
    "<p>Расход циркуляции определяется не потреблением, а теплопотерями труб:</p>" +
    '<p class="formula">G = 3600·Q<sub>потерь</sub> / (c·Δt),   Δt = 5…10 К</p>' +
    "<p>СП 30.13330 требует в местах водоразбора 60…75 °C. Отсюда и проверка стенда: в верхней точке каждого стояка должно быть не ниже 60 °C.</p></section>" +

    '<section class="card txt"><h3>Почему без балансировки не работает</h3>' +
    "<p>Все стояки подключены параллельно к одной паре магистралей, но пути у них разной длины. Ближний имеет меньшее сопротивление и забирает непропорционально много. Дальнему остаётся ток настолько слабый, что вода в нём остывает.</p>" +
    "<p>Балансировочный клапан — регулируемое сопротивление. Его задача не «ограничить расход», а <b>сравнять сопротивления колец</b>, чтобы распределение получилось расчётным.</p>" +
    '<p class="formula">Δp = (G/Kv)²,  Δp в барах, G в м³/ч</p>' +
    "<p>Для горячей воды один бар — это 10,37 м столба (плотность 983 кг/м³), а не 10,2 м.</p></section>" +

    '<section class="card txt"><h3>Настроечная шкала VT.054</h3>' +
    "<p>У ручного балансировочного клапана VALTEC VT.054 шкала 0…99. Каждому положению паспорт (ПС−7151−1.2, таблица 3) даёт свой Kv; между табличными точками значения интерполируются. Ниже положения 3 клапан не пропускает вовсе — золотник только выбирает упругость прокладки.</p>" +
    '<table class="tbl"><tr><th>Типоразмер</th><th>Kv макс.</th></tr>' +
    Valtec.Models.map(function (v) {
      return "<tr><td>" + v.caption + "</td><td>" + U.fmt(v.maxKv, 2) + "</td></tr>";
    }).join("") + "</table>" +
    "<p>Правило подбора: берут самый узкий клапан, у которого нужное положение попадает в рабочую часть шкалы (выше 10). В начале шкалы цена деления слишком велика — настройка не держится и не повторяется.</p></section>" +

    '<section class="card txt"><h3>Теплопотери труб</h3>' +
    '<p class="formula">R = Σ ln(d<sub>нар</sub>/d<sub>вн</sub>)/(2πλ) + 1/(π·d<sub>пов</sub>·α),   q = (t<sub>воды</sub> − t<sub>окр</sub>)/R</p>' +
    "<p>СП 61.13330, приложение Э. Складываются сопротивление стенки трубы, слоя изоляции и теплоотдачи с наружной поверхности. Потери участка умножаются на коэффициент местных потерь β = 0,2 — опоры, подвески, арматура.</p>" +
    "<p>У стали сопротивление стенки можно не учитывать, а у полипропилена оно сравнимо с изоляцией — поэтому на стенде материал труб влияет на теплопотери, а не только на шероховатость.</p></section>" +

    '<section class="card txt"><h3>Как увязывают кольца</h3>' +
    "<ol><li>Считают теплопотери каждого кольца и по ним — требуемый расход.</li>" +
    "<li>Считают потери труб каждого кольца при этих расходах (без клапанов — иначе подобранный клапан менял бы базу сравнения).</li>" +
    "<li>Находят самое невыгодное кольцо: у него клапан остаётся открытым.</li>" +
    "<li>Остальным добирают недостающий перепад клапаном: Kv = G/√Δp.</li>" +
    "<li>По настроечной таблице находят положение шкалы.</li>" +
    "<li>Напор насоса — это потери самого невыгодного кольца вместе с общими участками.</li></ol>" +
    "<p>Ровно это и делает кнопка «Подобрать настройки». Полноценный расчёт с произвольной схемой, поиском колец, подбором диаметров и выгрузкой таблиц — в соседней программе «Циркуляция ГВС».</p></section>";

  Lab.register(S);
})();
