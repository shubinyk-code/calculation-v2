/* Стенд 14. Канализационный стояк: срыв гидрозатвора при залповом сбросе.

   Вода, сброшенная в стояк, не падает свободно: она растекается по стенке кольцом
   и через несколько метров выходит на предельную скорость (Wyly & Eaton):
       v_т = 0,635·(q/D)^0,4   (q в л/с, D в м).
   Кольцо воды увлекает за собой воздух — эжекция. Этот воздух должен откуда-то
   прийти: через вытяжную часть на кровле, через вакуумный клапан — или через
   гидрозатворы приборов, если другого пути нет.

   Перепад на пути воздуха создаёт в стояке разрежение. Гидрозатвор — это U-образный
   маятник: при перепаде Δh столб отклоняется, а из-за инерции проскакивает дальше
   равновесия. Поэтому срывает затвор уже при перепаде около половины его высоты. */
(function () {
  "use strict";

  var W = 1180, HH = 560;
  var XS = 300;                       // ось стояка
  var YTOP = 60, YBOT = 480;
  var RHO_AIR = 1.2;

  var S = {
    id: "stack", group: "sewer", star: true,
    title: "Стояк и срыв гидрозатвора",
    lead: "Залповый сброс по стояку: вода увлекает воздух, в стояке возникает разрежение, и вода из сифона уходит в трубу. Видно, что спасает вытяжная часть и вакуумный клапан.",
    hint: "Нажмите «Сброс сверху». Цвет стояка — давление воздуха: синий — разрежение, красный — подпор. Внизу справа — сифон рассматриваемого прибора.",
    vis: { kind: "svg" },
    speeds: [0.25, 1, 4],
    maxStep: 0.01
  };

  S.defaults = function () {
    return {
      D: 110,            // диаметр стояка, мм
      floors: 9,
      hFloor: 3.0,
      q: 1.6,            // расход сброса, л/с
      pulseT: 6,         // длительность сброса, с
      vent: "roof",      // roof | aav | none | frozen
      ventD: 110,
      sealH: 60,         // высота гидрозатвора, мм
      obs: 3,            // этаж наблюдаемого прибора
      branchD: 50
    };
  };

  S.fields = [
    { title: "Сброс", open: true, fields: [
      { k: "q", t: "range", l: "Расход сброса", u: "л/с", min: 0.2, max: 8, step: 0.1, d: 1,
        hint: "Унитаз — 1,6 л/с, ванна — 0,8 л/с, мойка — 0,6 л/с. Одновременный сброс с нескольких этажей складывается." },
      { k: "pulseT", t: "range", l: "Длительность сброса", u: "с", min: 2, max: 60, step: 1, d: 0 },
      { t: "custom", k: "q", render: function () {
        return '<button type="button" data-act="flush" class="primary">Сброс сверху</button> ' +
          '<button type="button" data-act="refill">Долить затворы</button>';
      }, onClick: function (act) { if (act === "flush") S.flush(); else S.refill(); } }
    ] },
    { title: "Вентиляция стояка", open: true, fields: [
      { k: "vent", t: "select", l: "Как стояк дышит", opts: [
        ["roof", "вытяжная часть выведена на кровлю"],
        ["aav", "вакуумный (воздушный) клапан"],
        ["frozen", "вытяжка обмёрзла / забита"],
        ["none", "стояк заглушён сверху"]
      ] },
      { k: "ventD", t: "range", l: "Диаметр вытяжной части", u: "мм", min: 50, max: 160, step: 10, d: 0,
        show: function (st) { return st.vent === "roof" || st.vent === "frozen"; },
        hint: "Уменьшать диаметр вытяжной части против стояка нельзя — это прямой путь к срыву затворов." }
    ] },
    { title: "Стояк и приборы", open: true, fields: [
      { k: "D", t: "range", l: "Диаметр стояка", u: "мм", min: 50, max: 200, step: 10, d: 0 },
      { k: "floors", t: "range", l: "Число этажей", u: "", min: 2, max: 16, step: 1, d: 0 },
      { k: "hFloor", t: "range", l: "Высота этажа", u: "м", min: 2.5, max: 4, step: 0.1, d: 1 },
      { k: "obs", t: "range", l: "Наблюдаемый прибор на этаже", u: "", min: 1, max: 16, step: 1, d: 0 },
      { k: "sealH", t: "range", l: "Высота гидрозатвора", u: "мм", min: 20, max: 100, step: 5, d: 0,
        hint: "Нормальный сифон — 60 мм. Плоские сифоны под душевые поддоны бывают 30…40 мм." },
      { k: "branchD", t: "range", l: "Диаметр отвода к прибору", u: "мм", min: 32, max: 110, step: 2, d: 0 }
    ] }
  ];

  /* ------------------------------------------------------------ модель */

  var m = {}, tr = new Plot.Trend(6000), trT = 0;

  function ventZeta(st) {
    if (st.vent === "roof") return 3.0;
    if (st.vent === "aav") return 4.5;
    if (st.vent === "frozen") return 250;
    return 1e6;                                      // заглушён
  }

  S.flush = function () {
    var st = S.state;
    m.flushLeft = st.pulseT;
  };
  S.refill = function () {
    var st = S.state;
    for (var i = 1; i <= 16; i++) { m.seal[i] = st.sealH; m.x[i] = 0; m.vx[i] = 0; m.broken[i] = false; m.venting[i] = false; }
  };

  S.reset = function () {
    var st = S.state;
    m = { flushLeft: 0, q: 0, seal: [], x: [], vx: [], broken: [], venting: [], events: [] };
    for (var i = 0; i <= 16; i++) { m.seal[i] = st.sealH; m.x[i] = 0; m.vx[i] = 0; m.broken[i] = false; m.venting[i] = false; }
    tr.clear(); trT = 0;
    air(st);
  };
  S.onChange = function () { air(S.state); };

  /* Воздушный тракт: сколько воздуха увлекает вода и какое от этого разрежение. */
  function air(st) {
    var D = st.D / 1000, A = Hydro.area(D);
    var H = st.floors * st.hFloor;
    var q = m.q || 0;
    var vt = q > 0.01 ? 0.635 * Math.pow(q / D, 0.4) : 0;            // предельная скорость плёнки
    var Lt = 0.159 * vt * vt;                                        // длина разгона
    var frac = vt > 0.01 ? U.clamp((q / 1000) / (vt * A), 0, 0.6) : 0;
    var Acore = A * (1 - frac);
    var Qfree = 1.1 * vt * Acore;                                    // свободная эжекция, м³/с

    /* Падающая вода работает как вентилятор: при свободном притоке она увлекает
       Qfree, а при полностью перекрытом даёт предельное разрежение dpMax.
       Реальная точка — пересечение этой «характеристики» с сопротивлением притока. */
    var dpMax = 400 * Math.pow(Math.max(q, 0.01), 1.2) * Math.pow(Math.max(H, 3) / 27, 0.4);

    /* Пути притока воздуха: вытяжка плюс затворы, через которые сейчас прорывается воздух. */
    var Cvent = Hydro.area(st.ventD / 1000) / Math.sqrt(ventZeta(st));
    var Ctraps = 0;
    for (var i = 1; i <= st.floors; i++) {
      if (m.broken[i] || m.venting[i]) Ctraps += Hydro.area(st.branchD / 1000) * 0.35 / Math.sqrt(6);
    }
    var Csum = Cvent + Ctraps;

    /* Итерация: расход воздуха падает по мере роста разрежения. */
    var Qair = Qfree, dpIn = 0, lamFilm = 0.05, vAir = 0, dpStack = 0;
    for (var k = 0; k < 30; k++) {
      vAir = Acore > 1e-9 ? Qair / Acore : 0;
      dpStack = lamFilm * (H / D) * RHO_AIR * vAir * vAir / 2;
      dpIn = Csum > 1e-12 ? RHO_AIR / 2 * Math.pow(Qair / Csum, 2) : dpMax;
      var total = Math.min(dpIn + dpStack, dpMax);
      var Qn = Qfree * Math.sqrt(Math.max(0, 1 - total / Math.max(dpMax, 1e-6)));
      if (Math.abs(Qn - Qair) < 1e-9) { Qair = Qn; break; }
      Qair = Qair + 0.4 * (Qn - Qair);
    }
    vAir = Acore > 1e-9 ? Qair / Acore : 0;
    dpStack = lamFilm * (H / D) * RHO_AIR * vAir * vAir / 2;
    dpIn = Csum > 1e-12 ? Math.min(RHO_AIR / 2 * Math.pow(Qair / Csum, 2), dpMax) : dpMax;
    var dpBase = 9 * RHO_AIR * vAir * vAir / 2;                      // отвод и водяная пробка внизу

    m.air = {
      vt: vt, Lt: Lt, Qair: Qair, Qfree: Qfree, vAir: vAir, frac: frac, H: H,
      dpIn: dpIn, dpStack: dpStack, dpBase: dpBase, dpMax: dpMax,
      ratio: q > 0.01 ? Qair * 1000 / q : 0
    };
    /* Эпюра: разрежение растёт от вытяжки вниз, у основания — подпор. */
    m.press = function (y) {                                         // y — высота от низа стояка, м
      var top = -dpIn;                                               // сразу под вытяжкой
      var zone = Math.min(0.2 * H, 3);                               // зона подпора у основания
      if (y > zone) {
        var f = (H - y) / Math.max(H - zone, 1e-6);
        return (top - dpStack * f) / 9.81;                           // Па → мм вод. ст.
      }
      var t = 1 - y / Math.max(zone, 1e-6);
      var low = (top - dpStack) / 9.81;
      return U.lerp(low, dpBase / 9.81, t * t);
    };
  }

  S.tick = function (dt) {
    var st = S.state, i;
    if (m.flushLeft > 0) {
      m.flushLeft = Math.max(0, m.flushLeft - dt);
      m.q = m.q + (st.q - m.q) * U.clamp(dt / 0.6, 0, 1);
    } else {
      m.q = m.q + (0 - m.q) * U.clamp(dt / 1.2, 0, 1);
      if (m.q < 0.005) m.q = 0;
    }
    air(st);

    /* Гидрозатвор каждого этажа — маятник в U-образной трубке. */
    var Lcol = 0.28;                                                 // длина столба воды в сифоне, м
    for (i = 1; i <= st.floors; i++) {
      var y = (i - 0.5) * st.hFloor;
      var dh = m.press(y) / 1000;                                    // мм вод. ст. → м
      var seal = m.seal[i] / 1000;
      var acc = (Hydro.G / Lcol) * (dh - 2 * m.x[i]) - 2.2 * m.vx[i];
      m.vx[i] += acc * dt;
      m.x[i] += m.vx[i] * dt;
      /* Прорыв: столб отклонился больше, чем позволяет оставшаяся вода.
         Пока он упирается в предел, воду уносит в стояк, а через затвор идёт воздух. */
      var limit = seal / 2;
      if (Math.abs(m.x[i]) > limit) {
        /* Уносится и то, что выплеснулось, и то, что уносит прорывающийся воздух. */
        var bubble = 14 * U.clamp(Math.abs(dh) * 1000 / Math.max(m.seal[i], 1), 0, 2);
        var lost = (Math.abs(m.vx[i]) * 1000 * 0.6 + bubble) * dt;   // мм, унесённые за шаг
        m.seal[i] = Math.max(0, m.seal[i] - lost);
        m.x[i] = (m.x[i] > 0 ? 1 : -1) * limit;
        m.vx[i] *= 0.5;
        m.venting[i] = true;
        if (m.seal[i] < 25 && !m.broken[i]) {
          m.broken[i] = true;
          m.events.push({ t: S.t, floor: i });
        }
      } else {
        m.venting[i] = false;
      }
      if (m.seal[i] <= 0.5) m.broken[i] = true;
    }

    trT += dt;
    if (trT > 0.1) {
      trT = 0;
      tr.push(S.t, {
        p: m.press((st.obs - 0.5) * st.hFloor),
        seal: m.seal[st.obs],
        q: m.q,
        x: m.x[st.obs] * 1000
      });
    }
  };

  /* ------------------------------------------------------------ картинка */

  var R = {}, built = "";
  S.invalidate = function () { built = ""; };

  function build(ui) {
    var st = S.state;
    var key = [st.floors, st.D, st.vent].join("|");
    if (built === key) return;
    built = key;
    var s = SK.open(W, HH), i;
    var rr = U.clamp(st.D * 0.18, 8, 26);
    var hF = (YBOT - YTOP) / st.floors;

    // --- вытяжная часть
    if (st.vent === "none") {
      s += SK.line(null, XS - rr - 8, YTOP, XS + rr + 8, YTOP, "", ' stroke="var(--bad)" stroke-width="6"');
      s += SK.txt(null, XS + rr + 16, YTOP + 4, "tiny bad", "start", "стояк заглушён");
    } else if (st.vent === "aav") {
      s += SK.rect(null, XS - 22, YTOP - 40, 44, 36, "", ' fill="var(--panel)" stroke="var(--accent)" stroke-width="2" rx="4"');
      s += SK.txt(null, XS + 32, YTOP - 18, "tiny muted", "start", "вакуумный клапан");
    } else {
      s += SK.rect(null, XS - rr, YTOP - 46, 2 * rr, 46, "", ' fill="var(--glass)" stroke="var(--casing-dark)" stroke-width="1.5"');
      s += SK.line(null, XS - 60, YTOP - 46, XS + 60, YTOP - 46, "", ' stroke="var(--casing-dark)" stroke-width="3"');
      s += SK.txt(null, XS + 68, YTOP - 40, "tiny muted", "start", st.vent === "frozen" ? "вытяжка обмёрзла" : "вытяжная часть на кровле");
      if (st.vent === "frozen") s += SK.circle(null, XS, YTOP - 42, 8, "", ' fill="var(--bad)" opacity="0.6"');
    }

    // --- стояк по этажам
    for (i = 1; i <= st.floors; i++) {
      var yTopF = YBOT - i * hF, yBotF = YBOT - (i - 1) * hF;
      s += SK.rect("seg" + i, XS - rr, yTopF, 2 * rr, hF + 0.5, "", ' fill="var(--pipe-lo)" stroke="none"');
      s += SK.line(null, 120, yBotF, 900, yBotF, "floor", ' stroke="var(--line)" stroke-width="1"');
      s += SK.txt(null, 126, yBotF - 6, "tiny muted", "start", i + " этаж");
      // отвод и сифон
      s += SK.path(null, "M" + (XS + rr) + " " + (yBotF - hF * 0.45) + " H" + (XS + 120), "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="7"');
      s += SK.g("trap" + i, "", SK.path(null, "M0 0 v14 q0 10 10 10 h10 q10 0 10 -10 v-14", "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"') +
        SK.rect("sealR" + i, 2, 8, 26, 14, "", ' fill="var(--water)" opacity="0.6"'),
        ' transform="translate(' + (XS + 120) + "," + (yBotF - hF * 0.45 - 12) + ')"');
      s += SK.txt("sealT" + i, XS + 176, yBotF - hF * 0.45 + 4, "tiny", "start", "");
    }
    s += SK.rect(null, XS - rr - 3, YTOP, 2 * rr + 6, YBOT - YTOP, "", ' fill="none" stroke="var(--casing-dark)" stroke-width="2"');

    // --- плёнка воды и воздух
    s += SK.path("filmL", "", "", ' fill="none" stroke="var(--water)" stroke-width="3" stroke-linecap="round"');
    s += SK.path("filmR", "", "", ' fill="none" stroke="var(--water)" stroke-width="3" stroke-linecap="round"');
    s += SK.g("airArrows", "", "", "");

    // --- низ: отвод в выпуск
    s += SK.path(null, "M" + (XS - rr) + " " + YBOT + " q0 40 40 40 H860", "", ' fill="none" stroke="var(--pipe-lo)" stroke-width="18"');
    s += SK.txt(null, 700, YBOT + 58, "tiny muted", "start", "выпуск в колодец");

    // --- шкала давления
    s += SK.txt(null, 960, 40, "cap", "middle", "эпюра давления");
    s += SK.line(null, 960, YTOP, 960, YBOT + 40, "scale");
    s += SK.path("epure", "", "", ' fill="none" stroke="var(--p1)" stroke-width="2.4"');
    s += SK.path("epureFill", "", "", ' fill="var(--p1)" opacity="0.15" stroke="none"');
    s += SK.line("sealLineL", 0, 0, 0, 0, "", ' stroke="var(--bad)" stroke-width="1.2" stroke-dasharray="4 3"');
    s += SK.line("sealLineR", 0, 0, 0, 0, "", ' stroke="var(--bad)" stroke-width="1.2" stroke-dasharray="4 3"');
    s += SK.txt(null, 1090, YBOT + 60, "tiny muted", "end", "мм вод. ст.");

    s += SK.txt("hdr", 40, 34, "val", "start", "");
    s += SK.txt("hdr2", 40, 56, "tiny muted", "start", "");
    s += SK.close();
    ui.vis.innerHTML = s;
    var ids = ["filmL", "filmR", "airArrows", "epure", "epureFill", "sealLineL", "sealLineR", "hdr", "hdr2"];
    for (i = 1; i <= st.floors; i++) ids.push("seg" + i, "trap" + i, "sealR" + i, "sealT" + i);
    R = SK.refs(ui.vis, ids);
  }

  S.build = function (ui) { build(ui); };
  S.onShow = function (ui) { build(ui); };

  S.draw = function (ui) {
    build(ui);
    var st = S.state, i;
    var rr = U.clamp(st.D * 0.18, 8, 26);
    var hF = (YBOT - YTOP) / st.floors;
    var H = st.floors * st.hFloor;

    /* Цвет стояка по давлению. */
    var pmax = 0;
    for (i = 1; i <= st.floors; i++) pmax = Math.max(pmax, Math.abs(m.press((i - 0.5) * st.hFloor)));
    pmax = Math.max(pmax, st.sealH);
    for (i = 1; i <= st.floors; i++) {
      var p = m.press((i - 0.5) * st.hFloor);
      var col = p < 0 ? U.mix(U.css("--pipe-lo"), U.css("--water"), U.clamp(-p / pmax, 0, 1))
                      : U.mix(U.css("--pipe-lo"), U.css("--bad"), U.clamp(p / pmax, 0, 1));
      SK.set(R["seg" + i], { fill: col });
      var sealFrac = U.clamp(m.seal[i] / Math.max(st.sealH, 1), 0, 1);
      SK.set(R["sealR" + i], { height: 14 * sealFrac, y: 8 + 14 * (1 - sealFrac), opacity: m.broken[i] ? 0.2 : 0.6 });
      SK.text(R["sealT" + i], U.fmt(m.seal[i], 0) + " мм" + (m.broken[i] ? " — сорван" : "") + (i === st.obs ? "  ◀" : ""));
      SK.set(R["sealT" + i], { fill: m.broken[i] ? "var(--bad)" : (i === st.obs ? "var(--accent)" : "var(--muted)") });
    }

    /* Плёнка воды по стенке. */
    var fl = "", fr2 = "", t = S.anim || 0;
    if (m.q > 0.01) {
      var N = 30;
      for (i = 0; i <= N; i++) {
        var yy = YTOP + (YBOT - YTOP) * i / N;
        var wob = 2.5 * Math.sin(i * 0.9 + t * 8);
        fl += (i ? " L" : "M") + SK.n(XS - rr + 3 + wob) + " " + SK.n(yy);
        fr2 += (i ? " L" : "M") + SK.n(XS + rr - 3 - wob) + " " + SK.n(yy);
      }
    }
    SK.set(R.filmL, { d: fl, "stroke-width": U.clamp(m.q * 2, 1.5, 7) });
    SK.set(R.filmR, { d: fr2, "stroke-width": U.clamp(m.q * 2, 1.5, 7) });

    /* Стрелки воздуха. */
    var arr = "";
    if (m.air.Qair > 0.001) {
      var n = 6;
      for (i = 0; i < n; i++) {
        var yA = YTOP + ((i / n + (t * 0.25 % 1)) % 1) * (YBOT - YTOP);
        arr += '<path d="M' + XS + " " + SK.n(yA) + " l0 16 m-4 -6 l4 6 l4 -6" + '" fill="none" stroke="var(--muted)" stroke-width="1.6" opacity="0.7"/>';
      }
    }
    R.airArrows.innerHTML = arr;

    /* Эпюра давления. */
    var scale = 120 / Math.max(pmax, 20);
    var ep = "", pts = [];
    for (i = 0; i <= 40; i++) {
      var yM = H * i / 40;
      var py = YBOT - (YBOT - YTOP) * (yM / H);
      var px = 960 + U.clamp(m.press(yM) * scale, -130, 130);
      ep += (i ? " L" : "M") + SK.n(px) + " " + SK.n(py);
      pts.push([px, py]);
    }
    SK.set(R.epure, { d: ep });
    SK.set(R.epureFill, {
      d: ep + " L960 " + SK.n(pts[pts.length - 1][1]) + " L960 " + SK.n(pts[0][1]) + " Z"
    });
    var sx = st.sealH * scale;
    SK.set(R.sealLineL, { x1: 960 - sx, x2: 960 - sx, y1: YTOP, y2: YBOT });
    SK.set(R.sealLineR, { x1: 960 + sx, x2: 960 + sx, y1: YTOP, y2: YBOT });

    var pObs = m.press((st.obs - 0.5) * st.hFloor);
    SK.text(R.hdr, "Сброс " + U.fmt(m.q, 2) + " л/с · воздуха " + U.fmt(m.air.Qair * 1000, 0) + " л/с (" +
      U.fmt(m.air.ratio, 0) + " объёмов на объём воды) · разрежение на " + st.obs + "-м этаже " + U.fmt(pObs, 0) + " мм вод. ст.");
    SK.set(R.hdr, { fill: Math.abs(pObs) > st.sealH / 2 ? "var(--bad)" : "var(--ink)" });
    SK.text(R.hdr2, "предельная скорость плёнки " + U.fmt(m.air.vt, 2) + " м/с, разгон " + U.fmt(m.air.Lt, 1) +
      " м · штриховые линии на эпюре — высота гидрозатвора " + U.fmt(st.sealH, 0) + " мм");

    drawCharts(ui);
  };

  /* ------------------------------------------------------------ графики */

  S.charts = [
    { id: "osc", title: "Осциллограмма: разрежение и остаток гидрозатвора", h: 330 },
    { id: "curve", title: "Разрежение в зависимости от сброса", h: 330 }
  ];

  function drawCharts(ui) {
    var st = S.state;
    var win = 60;
    var f = U.fitCanvas(ui.canvas("osc"));
    var lim = Math.max(st.sealH * 1.6, 40);
    var p = Plot.frame(f.ctx, f.w, f.h, {
      x0: Math.max(0, S.t - win), x1: Math.max(win, S.t), y0: -lim, y1: lim,
      xLabel: "время, с", yLabel: "давление в стояке, мм вод. ст.",
      y2: [0, Math.max(st.sealH * 1.2, 10)], y2Label: "остаток затвора, мм"
    });
    Plot.band(p, -st.sealH / 2, -lim, U.css("--bad"), 0.10);
    Plot.band(p, st.sealH / 2, lim, U.css("--bad"), 0.10);
    Plot.clip(p);
    Plot.hline(p, 0, { color: U.css("--axis"), dash: [3, 3] });
    Plot.hline(p, -st.sealH / 2, { color: U.css("--bad"), dash: [6, 4] });
    Plot.line(p, tr.series("p", S.t, win), { color: U.css("--p1"), width: 2.2 });
    Plot.line(p, tr.series("seal", S.t, win), { color: U.css("--good"), width: 1.8, dash: [5, 3] }, true);
    Plot.line(p, tr.series("x", S.t, win), { color: U.css("--p3"), width: 1.2 });
    Plot.unclip(p);
    Plot.legend(p, [
      { color: U.css("--p1"), text: "давление на " + st.obs + "-м этаже" },
      { color: U.css("--p3"), text: "отклонение столба в сифоне, мм" },
      { color: U.css("--good"), text: "остаток затвора (правая ось)", dash: [5, 3] },
      { color: U.css("--bad"), text: "порог срыва ≈ половина высоты затвора", dash: [6, 4] }
    ]);

    /* Разрежение от расхода для разных вариантов вентиляции. */
    var f2 = U.fitCanvas(ui.canvas("curve"));
    var opts = [
      { id: "roof", name: "вытяжка на кровлю", col: U.css("--good") },
      { id: "aav", name: "вакуумный клапан", col: U.css("--p1") },
      { id: "frozen", name: "вытяжка забита", col: U.css("--warn") },
      { id: "none", name: "заглушён", col: U.css("--bad") }
    ];
    var D = st.D / 1000, A = Hydro.area(D), H = st.floors * st.hFloor;
    var p2 = Plot.frame(f2.ctx, f2.w, f2.h, {
      x0: 0, x1: 8, y0: 0, y1: Math.max(st.sealH * 2, 60),
      xLabel: "расход сброса, л/с", yLabel: "разрежение в стояке, мм вод. ст."
    });
    Plot.clip(p2);
    opts.forEach(function (o) {
      var pts = [];
      for (var i = 1; i <= 80; i++) {
        var q = 8 * i / 80;
        var vt = 0.635 * Math.pow(q / D, 0.4);
        var frac = U.clamp((q / 1000) / (vt * A), 0, 0.6);
        var Acore = A * (1 - frac);
        var Qair = 1.1 * vt * Acore;
        var Cvent = Hydro.area(st.ventD / 1000) / Math.sqrt(ventZeta({ vent: o.id }));
        var dpIn = RHO_AIR / 2 * Math.pow(Qair / Math.max(Cvent, 1e-9), 2);
        var vAir = Qair / Acore;
        var dpStack = 0.05 * (H / D) * RHO_AIR * vAir * vAir / 2;
        pts.push([q, (dpIn + dpStack) / 9.81]);
      }
      Plot.line(p2, pts, { color: o.col, width: o.id === st.vent ? 2.6 : 1.4, dash: o.id === st.vent ? null : [5, 4] });
    });
    Plot.unclip(p2);
    Plot.hline(p2, st.sealH / 2, { color: U.css("--bad"), dash: [6, 4], width: 1.8 });
    Plot.hline(p2, st.sealH, { color: U.css("--bad"), dash: [2, 3] });
    Plot.legend(p2, opts.map(function (o) {
      return { color: o.col, text: o.name, dash: o.id === st.vent ? null : [5, 4] };
    }).concat([{ color: U.css("--bad"), text: "порог срыва", dash: [6, 4] }]));
  }

  /* ------------------------------------------------------------ показания */

  S.readings = function () {
    var st = S.state, a = m.air;
    var pObs = m.press((st.obs - 0.5) * st.hFloor);
    var broken = [];
    for (var i = 1; i <= st.floors; i++) if (m.broken[i]) broken.push(i);
    return [
      { n: "Сброс сейчас", v: U.fmt(m.q, 2) + " л/с" },
      { n: "Предельная скорость плёнки", v: U.fmt(a.vt, 2) + " м/с" },
      { n: "Длина разгона", v: U.fmt(a.Lt, 2) + " м", cls: "sub" },
      { n: "Доля сечения под водой", v: U.fmt(a.frac * 100, 1) + " %" },
      { h: "Воздух" },
      { n: "Увлекается воздуха", v: U.fmt(a.Qair * 1000, 0) + " л/с" },
      { n: "На объём воды", v: U.fmt(a.ratio, 0) + " объёмов воздуха" },
      { n: "Скорость воздуха в стояке", v: U.fmt(a.vAir, 2) + " м/с" },
      { h: "Давление" },
      { n: "Потери на притоке (вытяжка)", v: U.fmt(a.dpIn / 9.81, 1) + " мм вод. ст.", cls: a.dpIn / 9.81 > st.sealH / 2 ? "bad" : "" },
      { n: "Потери по стояку", v: U.fmt(a.dpStack / 9.81, 1) + " мм вод. ст." },
      { n: "Подпор у основания", v: "+" + U.fmt(a.dpBase / 9.81, 1) + " мм вод. ст." },
      { n: "На " + st.obs + "-м этаже", v: U.fmt(pObs, 1) + " мм вод. ст.",
        cls: Math.abs(pObs) > st.sealH / 2 ? "bad" : "good" },
      { h: "Гидрозатворы" },
      { n: "Затвор на " + st.obs + "-м этаже", v: U.fmt(m.seal[st.obs], 1) + " мм из " + U.fmt(st.sealH, 0) + " мм",
        cls: m.broken[st.obs] ? "bad" : (m.seal[st.obs] < st.sealH * 0.8 ? "warn" : "good") },
      { n: "Отклонение столба", v: U.fmt(m.x[st.obs] * 1000, 1) + " мм", cls: "sub" },
      { n: "Сорвано затворов", v: broken.length ? broken.join(", ") + " этаж" : "нет", cls: broken.length ? "bad" : "good" }
    ];
  };

  S.explain = function () {
    var st = S.state, out = [], a = m.air;
    var pObs = m.press((st.obs - 0.5) * st.hFloor);

    if (m.q < 0.01) {
      out.push({ lvl: "info", text: "Сброса нет, воздух в стояке неподвижен, давление атмосферное. Нажмите «Сброс сверху» — и смотрите на эпюру справа." });
      if (m.seal[st.obs] < st.sealH * 0.95) {
        out.push({ lvl: m.broken[st.obs] ? "bad" : "warn", text: "После сброса в затворе " + st.obs + "-го этажа осталось " + U.fmt(m.seal[st.obs], 0) + " мм из " + U.fmt(st.sealH, 0) + " мм." + (m.broken[st.obs] ? " Это меньше 25 мм — затвор считается сорванным, запах из канализации идёт в помещение." : " Затвор ослаблен: следующий такой же сброс может его добить.") });
      }
      return out;
    }

    out.push({
      lvl: "info",
      text: "Вода не падает свободно: на первых " + U.fmt(a.Lt, 1) + " метрах она растекается по стенке и выходит на предельную скорость " +
        U.fmt(a.vt, 2) + " м/с. Дальше она движется равномерно — трение о стенку уравновешивает тяжесть. Сечение под водой занято всего на " +
        U.fmt(a.frac * 100, 1) + " %, остальное — воздух."
    });
    out.push({
      lvl: "info",
      text: "Движущаяся плёнка тянет за собой воздух: <b>" + U.fmt(a.Qair * 1000, 0) + " л/с</b>, то есть " + U.fmt(a.ratio, 0) +
        " объёмов воздуха на объём воды. Этот воздух должен откуда-то взяться — и уйти вниз, в выпуск."
    });

    if (st.vent === "roof") {
      out.push({ lvl: "good", text: "Вытяжная часть выведена на кровлю: воздух свободно подсасывается сверху, и разрежение мало — " + U.fmt(-m.press((st.floors - 0.5) * st.hFloor), 0) + " мм вод. ст. в верхней части. Затворы держат." });
    } else if (st.vent === "aav") {
      out.push({ lvl: "good", text: "Вакуумный клапан открывается при малом разрежении и впускает воздух. Он защищает затворы от срыва, но, в отличие от вытяжки на кровлю, не вентилирует сеть: запах из стояка наружу не уходит, а внизу подпор от этого не уменьшается." });
    } else if (st.vent === "frozen") {
      out.push({ lvl: "bad", text: "<b>Вытяжка забита или обмёрзла.</b> Воздуху почти не пройти, и всё сопротивление превращается в разрежение: " + U.fmt(a.dpIn / 9.81, 0) + " мм вод. ст. Это классическая зимняя авария: иней на срезе вытяжной трубы затягивает её за ночь, и утром по всему стояку срывает затворы." });
    } else {
      out.push({ lvl: "bad", text: "<b>Стояк заглушён сверху.</b> Единственный путь воздуха — через гидрозатворы. Они и сработают как клапаны: вода из сифона будет высосана в стояк." });
    }

    if (Math.abs(pObs) > st.sealH / 2) {
      out.push({
        lvl: "bad",
        text: "На " + st.obs + "-м этаже " + (pObs < 0 ? "разрежение " : "подпор ") + U.fmt(Math.abs(pObs), 0) +
          " мм вод. ст. при высоте затвора " + U.fmt(st.sealH, 0) + " мм. <b>Порог срыва — примерно половина высоты</b>: столб в сифоне отклоняется на Δh/2 в каждую сторону, а из-за инерции проскакивает ещё дальше. " +
          (pObs < 0 ? "Воду высасывает в стояк." : "Воздух прорывается через затвор в помещение — булькает и пахнет.")
      });
    }

    if (st.obs <= 2) {
      out.push({
        lvl: "warn",
        text: "Нижние этажи — отдельная беда. У основания стояка воздух тормозится водяной пробкой в отводе, и там не разрежение, а <b>подпор</b> (+" +
          U.fmt(a.dpBase / 9.81, 0) + " мм вод. ст.). Затвор выдавливает в обратную сторону. Поэтому приборы на первом этаже часто подключают отдельным выпуском."
      });
    }

    if (st.D < 100 && m.q > 1) {
      out.push({ lvl: "warn", text: "Стояк " + U.fmt(st.D, 0) + " мм для такого сброса маловат: доля сечения под водой " + U.fmt(a.frac * 100, 0) + " %, скорость воздуха " + U.fmt(a.vAir, 1) + " м/с. При заполнении сечения больше трети образуются водяные поршни, и разрежение скачком вырастет." });
    }
    if (st.sealH < 50) {
      out.push({ lvl: "warn", text: "Затвор всего " + U.fmt(st.sealH, 0) + " мм — таких много под душевыми поддонами и в плоских сифонах. Порог срыва у него ниже вдвое по сравнению с обычным 60-миллиметровым." });
    }
    return out;
  };

  /* ------------------------------------------------------------ опыты */

  S.experiments = [
    {
      title: "1. Сорвать затвор", tag: "★ главный",
      preset: { D: 110, floors: 9, hFloor: 3, q: 1.6, pulseT: 6, vent: "none", sealH: 60, obs: 2, branchD: 50 },
      speed: 1,
      steps: [
        "Стояк заглушён сверху — так бывает, когда вытяжку «зашили» при ремонте.",
        "Нажмите «Сброс сверху» и смотрите на сифоны: первым сдаётся тот, где разрежение глубже всего — над самым основанием стояка.",
        "Повторите сброс ещё раз, если затвор уцелел."
      ],
      watch: [
        "Разрежение в стояке проваливается ниже порога.",
        "Столб воды в сифоне раскачивается и выплёскивается в стояк.",
        "Остаток затвора падает; ниже 25 мм — запах в квартире."
      ],
      why: "Вода в стояке увлекает в десятки раз больший объём воздуха. Если взять его неоткуда, единственным «клапаном» становится гидрозатвор: разрежение высасывает из него воду. Отсюда категорическое требование не заглушать вытяжную часть стояка."
    },
    {
      title: "2. Вытяжка на кровлю спасает", tag: "★ защита",
      preset: { D: 110, floors: 9, hFloor: 3, q: 1.6, pulseT: 6, vent: "roof", ventD: 110, sealH: 60, obs: 3 },
      speed: 1,
      steps: ["Вытяжка выведена на кровлю. Нажмите «Долить затворы», потом «Сброс сверху».", "Сравните разрежение с предыдущим опытом.", "Теперь уменьшите диаметр вытяжной части до 50 мм и повторите."],
      watch: [
        "С полноценной вытяжкой разрежение в несколько раз меньше порога.",
        "Сужение вытяжной части сразу поднимает разрежение: сопротивление растёт как четвёртая степень диаметра.",
        "На правом графике видно, как расходятся кривые вариантов."
      ],
      why: "Вытяжная часть — это воздухозаборник стояка. Норма прямо запрещает делать её диаметр меньше диаметра стояка и требует выводить выше кровли. Заодно она вентилирует сеть, унося газы наружу."
    },
    {
      title: "3. Зимнее обмерзание", tag: "★ авария",
      preset: { D: 110, floors: 9, hFloor: 3, q: 2.5, pulseT: 8, vent: "frozen", ventD: 110, sealH: 60, obs: 5 },
      speed: 1,
      steps: ["Вытяжка забита инеем. Долейте затворы и сделайте сброс.", "Посмотрите, на каких этажах сорвало затворы.", "Переключите на вакуумный клапан и повторите."],
      watch: [
        "При забитой вытяжке срывает затворы сразу на нескольких этажах.",
        "Хуже всего верхним — они ближе к источнику разрежения.",
        "Вакуумный клапан снимает разрежение почти полностью."
      ],
      why: "Тёплый влажный воздух из канализации конденсируется на срезе вытяжной трубы; за морозную ночь отверстие затягивает льдом. Поэтому вытяжную часть делают большего диаметра, чем стояк, не утепляют её внутри чердака и не ставят на неё дефлекторов и зонтов."
    },
    {
      title: "4. Первый этаж: подпор вместо разрежения", tag: "низ стояка",
      preset: { D: 110, floors: 9, hFloor: 3, q: 3.0, pulseT: 10, vent: "roof", sealH: 60, obs: 1 },
      speed: 1,
      steps: ["Наблюдаемый прибор — на первом этаже. Сделайте сброс сверху.", "Смотрите на эпюру давления в нижней части стояка.", "Увеличьте расход сброса до 5 л/с."],
      watch: [
        "Внизу эпюра уходит вправо: там не разрежение, а подпор.",
        "Затвор выдавливает в обратную сторону — в квартиру идёт воздух.",
        "Чем больше расход, тем выше подпор."
      ],
      why: "У основания стояка поток разворачивается в горизонтальный отвод и частично перекрывает сечение водой. Воздуху деваться некуда, и он создаёт подпор. Поэтому приборы нижних этажей рекомендуют присоединять к отдельному выпуску или ставить на них затворы увеличенной высоты."
    },
    {
      title: "5. Маленький сифон", tag: "высота затвора",
      preset: { D: 110, floors: 9, hFloor: 3, q: 2.0, pulseT: 6, vent: "frozen", sealH: 30, obs: 4 },
      speed: 1,
      steps: ["Плоский сифон 30 мм — такие ставят под душевые поддоны.", "Сделайте сброс.", "Теперь поставьте 60 мм и повторите при том же режиме."],
      watch: ["Низкий затвор срывает при вдвое меньшем разрежении.", "Штриховые линии на эпюре сдвигаются.", "После срыва воздух свистит через сифон, и разрежение в стояке падает."],
      why: "Гидрозатвор держит перепад, равный своей высоте, — но только статически. На переходном процессе столб раскачивается, проскакивает равновесие и выплёскивается уже при половине этой величины. Отсюда нормативные 60 мм и требование не применять сифоны меньшей высоты там, где возможны залповые сбросы."
    }
  ];

  S.theory =
    '<section class="card txt"><h3>Что происходит в стояке</h3>' +
    "<p>Сброшенная вода прилипает к стенке и образует кольцевой поток. Через 2–4 метра трение о стенку уравновешивает силу тяжести, и плёнка выходит на предельную скорость:</p>" +
    '<p class="formula">v<sub>т</sub> = 0,635·(q/D)<sup>0,4</sup></p>' +
    "<p>Дальше вода падает равномерно — она не разгоняется до конца стояка. Поэтому этажность на расход почти не влияет, а на разрежение влияет через длину трения.</p>" +
    "<p>Сечение стояка при этом занято водой всего на несколько процентов. Вся остальная труба — воздух, и он движется вместе с водой.</p></section>" +

    '<section class="card txt"><h3>Эжекция воздуха</h3>' +
    "<p>Плёнка воды тянет воздух за счёт трения. Соотношение объёмов — десятки к одному: сброс 2 л/с в стояке 110 мм увлекает около 20–30 л/с воздуха.</p>" +
    "<p>Этот воздух обязан откуда-то взяться. Пути всего три:</p>" +
    "<ul><li><b>вытяжная часть</b> над кровлей — правильный путь;</li>" +
    "<li><b>вакуумный клапан</b> — впускает воздух, но наружу ничего не выпускает;</li>" +
    "<li><b>гидрозатворы приборов</b> — аварийный путь, тот самый срыв.</li></ul>" +
    "<p>Сопротивление пути и определяет разрежение: Δp = ζ·ρ<sub>возд</sub>·v²/2. Воздух лёгкий, поэтому счёт идёт на десятки миллиметров водяного столба — но и затвор всего 60 мм.</p></section>" +

    '<section class="card txt"><h3>Почему затвор срывает на половине</h3>' +
    "<p>Гидрозатвор — U-образная трубка. Статически он держит перепад, равный высоте затвора: вода в одном колене поднимается, в другом опускается, каждое на Δh/2.</p>" +
    "<p>Но при залповом сбросе разрежение нарастает за доли секунды, и столб воды ведёт себя как маятник с периодом около секунды: он проскакивает положение равновесия почти вдвое. Поэтому в опытах срыв начинается уже при перепаде около половины высоты затвора.</p>" +
    "<p>После срыва затвор редко теряет всю воду сразу: часть выплёскивается, часть возвращается. Но каждый следующий сброс отнимает ещё. Затвор ниже 25 мм считается неработающим — через него идёт запах.</p></section>" +

    '<section class="card txt"><h3>Как делают правильно</h3>' +
    "<ul><li><b>Вытяжная часть</b> не меньше диаметра стояка, выведена выше кровли, без зонтов и дефлекторов.</li>" +
    "<li><b>Невентилируемый стояк</b> допускается только при малых расходах и ограниченной этажности.</li>" +
    "<li><b>Вакуумный клапан</b> — когда вытяжку не вывести; ставят выше отметки перелива приборов.</li>" +
    "<li><b>Затворы 50…60 мм</b> и регулярное пользование приборами: редко используемый трап пересыхает и перестаёт держать не хуже сорванного.</li>" +
    "<li><b>Нижние этажи</b> — отдельный выпуск или увеличенное расстояние от основания стояка.</li>" +
    "<li><b>Косые крестовины и плавные отводы</b> у основания: они уменьшают подпор.</li></ul></section>";

  Lab.register(S);
})();
