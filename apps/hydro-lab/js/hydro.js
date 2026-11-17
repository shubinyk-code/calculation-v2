/* Ядро гидравлики: всё, что считают стенды. Единицы внутри — СИ (м, с, м³/с, Па),
   в интерфейс числа переводятся уже на месте (л/с, м³/ч, кПа, бар).

   Источники формул (в комментариях по месту):
     Чугаев Р. Р. «Гидравлика», Штеренлихт Д. В. «Гидравлика» — основы, истечение, удар;
     Идельчик И. Е. «Справочник по гидравлическим сопротивлениям» — местные сопротивления;
     Шевелев Ф. А. — таблицы для водопроводных труб, старение труб;
     СП 32.13330 и Лукиных А. А. «Таблицы для гидравлического расчёта канализационных сетей»;
     Wylie E. B., Streeter V. L. «Fluid Transients» — метод характеристик для удара. */
var Hydro = (function () {
  "use strict";
  var G = U.G;

  /* --------------------------------------------------------------- геометрия */

  function area(d) { return Math.PI * d * d / 4; }
  function velocity(Q, d) { return Q / area(d); }             // Q — м³/с, d — м
  function velHead(v) { return v * v / (2 * G); }             // скоростной напор, м

  /* --------------------------------------------------------------- режим потока */

  function reynolds(v, d, nu) { return Math.abs(v) * d / nu; }

  var RE_LAM = 2320;          // нижнее критическое число Рейнольдса (опыт Рейнольдса, 1883)
  var RE_TURB = 4000;         // выше — развитая турбулентность

  function regime(Re) {
    if (Re < RE_LAM) return "lam";
    if (Re < RE_TURB) return "trans";
    return "turb";
  }
  function regimeName(Re) {
    return Re < RE_LAM ? "ламинарный" : (Re < RE_TURB ? "переходный" : "турбулентный");
  }

  /* Коэффициент Дарси по Колбруку — Уайту (неявная формула, решается итерациями).
     Ламинарная область — 64/Re; в переходной зоне склейка, чтобы не было разрыва. */
  function lambdaColebrook(Re, k, d) {
    if (Re < 1e-6) return 0;
    if (Re <= RE_LAM) return 64 / Re;
    var rel = k / d;
    function cw(re) {
      // старт по Свами — Джейну, затем три уточнения по Колбруку
      var x = 0.25 / Math.pow(Math.log10(rel / 3.7 + 5.74 / Math.pow(re, 0.9)), 2);
      for (var i = 0; i < 6; i++) {
        var inv = -2 * Math.log10(rel / 3.7 + 2.51 / (re * Math.sqrt(x)));
        x = 1 / (inv * inv);
      }
      return x;
    }
    if (Re >= RE_TURB) return cw(Re);
    var t = (Re - RE_LAM) / (RE_TURB - RE_LAM);
    return U.lerp(64 / RE_LAM, cw(RE_TURB), t * t * (3 - 2 * t));   // плавная склейка
  }

  /* Формула Альтшуля — та, что в наших нормах и справочниках:
     λ = 0,11·(k/d + 68/Re)^0,25. Даётся рядом для сравнения. */
  function lambdaAltshul(Re, k, d) {
    if (Re <= RE_LAM) return Re > 1e-6 ? 64 / Re : 0;
    return 0.11 * Math.pow(k / d + 68 / Re, 0.25);
  }

  /* Блазиус — гладкие трубы, 4·10³ < Re < 10⁵. */
  function lambdaBlasius(Re) { return 0.3164 / Math.pow(Re, 0.25); }

  /* Потери по длине, м. */
  function hFriction(L, d, v, lam) { return lam * (L / d) * velHead(v); }

  /* Местные потери, м: h = ζ·v²/2g. */
  function hLocal(zeta, v) { return zeta * velHead(v); }

  /* --------------------------------------------------------------- шероховатость и местные */

  /* Эквивалентная шероховатость, мм (Шевелев, Идельчик). */
  var ROUGH = [
    { id: "glass", name: "стекло, латунь (стенд)", k: 0.0015 },
    { id: "pe", name: "полиэтилен, полипропилен", k: 0.01 },
    { id: "steelNew", name: "сталь новая", k: 0.05 },
    { id: "steelUsed", name: "сталь бывшая в работе", k: 0.2 },
    { id: "steelOld", name: "сталь старая, с отложениями", k: 1.0 },
    { id: "castIron", name: "чугун новый", k: 0.3 },
    { id: "castIronOld", name: "чугун старый", k: 1.5 },
    { id: "concrete", name: "бетон", k: 2.0 }
  ];
  function roughById(id) {
    for (var i = 0; i < ROUGH.length; i++) if (ROUGH[i].id === id) return ROUGH[i];
    return ROUGH[2];
  }

  /* Коэффициенты местных сопротивлений (Идельчик; ζ отнесён к скорости в трубе). */
  var ZETA = {
    inletSharp: 0.5,          // вход в трубу с острой кромкой
    inletRound: 0.2,          // вход со скруглением
    inletBorda: 1.0,          // вход «изнутри» (насадок Борда)
    outlet: 1.0,              // выход в резервуар — теряется весь скоростной напор
    elbow90: 1.1,             // резкое колено 90°
    bend90: 0.3,              // плавный отвод 90°, R/d = 1
    bend45: 0.15,
    tee: 1.5,                 // тройник на ответвление
    gateOpen: 0.15,           // задвижка открытая
    globeValve: 4.5,          // вентиль
    checkValve: 2.0,          // обратный клапан
    meter: 3.0                // водосчётчик
  };

  /* Внезапное расширение — формула Борда: ζ = (1 − A1/A2)², отнесён к v1. */
  function zetaExpansion(d1, d2) { var r = area(d1) / area(d2); return (1 - r) * (1 - r); }
  /* Внезапное сужение (Идельчик), отнесён к скорости в узкой трубе v2. */
  function zetaContraction(d1, d2) { var r = area(d2) / area(d1); return 0.5 * (1 - r); }
  /* Диффузор с углом раскрытия alfa (град): потери меньше, чем при внезапном расширении. */
  function zetaDiffuser(d1, d2, alfaDeg) {
    var a = U.clamp(alfaDeg, 2, 60) * Math.PI / 180;
    var phi = 3.2 * Math.pow(Math.tan(a / 2), 1.25);          // коэффициент смягчения удара
    return phi * zetaExpansion(d1, d2);
  }

  /* --------------------------------------------------------------- расходомеры */

  /* Труба Вентури / диафрагма. dP задан в метрах столба жидкости.
     Q = C/√(1 − β⁴) · A2 · √(2g·Δh),  β = d2/d1. */
  function flowByDp(d1, d2, dh, C) {
    var b = d2 / d1, k = (C || 0.98) / Math.sqrt(1 - Math.pow(b, 4));
    return k * area(d2) * Math.sqrt(2 * G * Math.max(0, dh));
  }
  function dpByFlow(d1, d2, Q, C) {
    var b = d2 / d1, k = (C || 0.98) / Math.sqrt(1 - Math.pow(b, 4));
    var v = Q / (k * area(d2));
    return v * v / (2 * G);
  }
  /* Невозвратимые потери расходомера: у трубы Вентури 10…20 % от перепада,
     у диафрагмы — 50…80 % (зависит от β). Идельчик, разд. «Измерительные устройства». */
  function meterLoss(kind, b) {
    return kind === "orifice" ? (1 - Math.pow(b, 1.9)) : U.clamp(0.22 - 0.2 * b, 0.05, 0.22);
  }

  /* --------------------------------------------------------------- истечение */

  /* Отверстия и насадки: ε — сжатие струи, φ — скорость, μ = ε·φ — расход.
     Значения классические (Чугаев, гл. 5; Штеренлихт, гл. 6). */
  var NOZZLES = [
    { id: "hole", name: "Отверстие в тонкой стенке", eps: 0.64, phi: 0.97, zeta: 0.06,
      note: "Струя сжимается за стенкой примерно на четверть диаметра: сжатое сечение — ε·A." },
    { id: "cyl", name: "Внешний цилиндрический насадок (l = 3d)", eps: 1.0, phi: 0.82, zeta: 0.5,
      note: "Струя сжимается внутри насадка и снова заполняет его. В сжатом сечении — вакуум ≈ 0,75·H, он и подсасывает воду: расход больше, чем у отверстия." },
    { id: "borda", name: "Внутренний насадок (Борда)", eps: 1.0, phi: 0.71, zeta: 1.0,
      note: "Вход «изнутри» сосуда: сжатие сильнее всех, μ наименьший." },
    { id: "conv", name: "Конически сходящийся (θ = 13°24′)", eps: 0.98, phi: 0.96, zeta: 0.09,
      note: "Лучший по дальности струи: и расход, и скорость высоки — отсюда пожарные стволы и брандспойты." },
    { id: "cono", name: "Коноидальный (по форме струи)", eps: 1.0, phi: 0.98, zeta: 0.04,
      note: "Стенки повторяют очертание сжатой струи — потерь почти нет, μ ≈ 0,98." },
    { id: "div", name: "Конически расходящийся (θ = 5…7°)", eps: 1.0, phi: 0.45, zeta: 4.0,
      note: "Работает как диффузор: в горле вакуум, расход большой, а скорость на выходе мала. Так устроены эжекторы и водоструйные насосы." }
  ];
  function nozzleById(id) {
    for (var i = 0; i < NOZZLES.length; i++) if (NOZZLES[i].id === id) return NOZZLES[i];
    return NOZZLES[0];
  }
  function mu(n) { return n.eps * n.phi; }

  /* Расход при истечении под напором H (м) в атмосферу. */
  function outflow(n, d, H) { return mu(n) * area(d) * Math.sqrt(2 * G * Math.max(0, H)); }

  /* Вакуум в сжатом сечении цилиндрического насадка: h_вак ≈ 0,75·H (Чугаев, § 5.6).
     Когда он доходит до давления насыщенного пара, насадок «срывает» — он начинает
     работать как отверстие, расход падает с 0,82 до 0,62. */
  function nozzleVacuum(H) { return 0.75 * H; }

  /* Траектория струи из горизонтального отверстия: x = 2·φ·√(H·y). */
  function jetX(phi, H, y) { return 2 * phi * Math.sqrt(Math.max(0, H) * Math.max(0, y)); }

  /* Время опорожнения сосуда постоянного сечения S от H1 до H2. */
  function emptyTime(S, n, d, H1, H2) {
    return 2 * S * (Math.sqrt(Math.max(0, H1)) - Math.sqrt(Math.max(0, H2))) / (mu(n) * area(d) * Math.sqrt(2 * G));
  }

  /* --------------------------------------------------------------- кавитация */

  /* Число кавитации: σ = (p − p_нас)/(ρv²/2). Кавитация начинается около σ ≈ 1…2. */
  function cavNumber(pAbsHead, vaporH, v) {
    var hv = velHead(v);
    return hv > 1e-9 ? (pAbsHead - vaporH) / hv : 999;
  }

  /* --------------------------------------------------------------- гидравлический удар */

  /* Скорость ударной волны (Жуковский — Аллиеви):
     a = √(K/ρ) / √(1 + (K·d)/(E·e)),   e — толщина стенки, E — модуль упругости трубы. */
  function celerity(K, rho, d, wall, E) {
    var a0 = Math.sqrt(K / rho);
    return a0 / Math.sqrt(1 + (K * d) / (E * wall));
  }
  /* Прямой удар по Жуковскому: Δp = ρ·a·Δv (Па), в метрах — a·Δv/g. */
  function jukovsky(a, dv) { return a * dv / G; }
  /* Фаза удара (время пробега волны туда и обратно). */
  function phase(L, a) { return 2 * L / a; }
  /* Непрямой удар (формула Мишо) при закрытии дольше фазы. */
  function michaud(L, dv, tClose) { return 2 * L * dv / (G * tClose); }

  var PIPE_MAT = [
    { id: "steel", name: "сталь", E: 2.1e11, wall: 0.004 },
    { id: "castIron", name: "чугун", E: 1.0e11, wall: 0.008 },
    { id: "copper", name: "медь", E: 1.1e11, wall: 0.002 },
    /* Для удара берут кратковременный (динамический) модуль упругости полимеров:
       он в полтора-два раза выше длительного. */
    { id: "pe", name: "полиэтилен ПЭ100", E: 1.4e9, wall: 0.012 },
    { id: "pp", name: "полипропилен", E: 1.2e9, wall: 0.010 }
  ];
  function matById(id) {
    for (var i = 0; i < PIPE_MAT.length; i++) if (PIPE_MAT[i].id === id) return PIPE_MAT[i];
    return PIPE_MAT[0];
  }

  /* --------------------------------------------------------------- насос */

  /* Кривая насоса H(Q) = H0 − B·Q², Q в м³/ч (как в насосной лаборатории).
     Законы подобия при относительной частоте r: H = H0·r² − B·Q². */
  function pumpCoef(p) {
    var B = (p.H0 - p.Hopt) / (p.Qopt * p.Qopt);
    return { B: B > 1e-6 ? B : 1e-6 };
  }
  function pumpHead(p, c, Q, r) {
    if (r === undefined) r = 1;
    return p.H0 * r * r - c.B * Q * Q;
  }
  function pumpQmax(p, c, r) { return (r === undefined ? 1 : r) * Math.sqrt(p.H0 / c.B); }
  /* КПД — парабола с нулями в 0 и 2·Qопт (учебное приближение). */
  function pumpEta(p, c, Q, r) {
    if (r === undefined) r = 1;
    if (r <= 0 || Q <= 0) return 0;
    var x = Q / (p.Qopt * r);
    var e = p.etaMax * (2 * x - x * x);
    return U.clamp(e, 0, 0.95);
  }
  function pumpPower(p, c, Q, r) {          // кВт, Q — м³/ч, H — м
    var H = pumpHead(p, c, Q, r), e = pumpEta(p, c, Q, r);
    if (H <= 0) return 0;
    var Pw = 1000 * G * (Q / 3600) * H / 1000;
    return e > 0.03 ? Pw / e : Pw / 0.03;
  }

  /* --------------------------------------------------------------- безнапорный поток */

  /* Геометрия частично заполненной круглой трубы по относительному наполнению y = h/d. */
  function circGeom(d, y) {
    y = U.clamp(y, 1e-6, 1);
    var th = 2 * Math.acos(U.clamp(1 - 2 * y, -1, 1));        // центральный угол, рад
    var A = d * d / 8 * (th - Math.sin(th));
    var P = d * th / 2;
    var B = y >= 1 ? 1e-6 : d * Math.sin(th / 2);             // ширина по свободной поверхности
    return { th: th, A: A, P: P, B: B, R: A / P, h: y * d };
  }

  /* Равномерное движение, формула Маннинга: v = (1/n)·R^(2/3)·i^(1/2). */
  function manningV(n, R, i) { return (1 / n) * Math.pow(Math.max(R, 1e-9), 2 / 3) * Math.sqrt(Math.max(i, 0)); }
  function manningQ(d, y, n, i) { var g = circGeom(d, y); return g.A * manningV(n, g.R, i); }

  /* Шероховатость по Маннингу, с/м^(1/3). */
  var MANNING = [
    { id: "pvc", name: "пластмасса (ПВХ, ПП)", n: 0.010 },
    { id: "castIron", name: "чугун", n: 0.013 },
    { id: "concrete", name: "бетон, керамика", n: 0.014 },
    { id: "old", name: "старая труба с отложениями", n: 0.018 }
  ];
  function manningById(id) {
    for (var i = 0; i < MANNING.length; i++) if (MANNING[i].id === id) return MANNING[i];
    return MANNING[0];
  }

  /* Нормальная (равномерная) глубина: подбор наполнения по расходу.
     Максимум расхода у круглой трубы — при h/d ≈ 0,938, дальше Q снова падает,
     поэтому ищем корень только на участке роста, до 0,938. */
  function normalDepth(Q, d, n, i) {
    if (!(Q > 0) || !(i > 0)) return 0;
    var yFull = 0.938;
    var Qmax = manningQ(d, yFull, n, i);
    if (Q >= Qmax) return 1;                                   // труба работает полным сечением
    return U.bisect(function (y) { return manningQ(d, y, n, i) - Q; }, 1e-4, yFull, 60);
  }

  /* Критическая глубина: Fr = 1, то есть Q²·B/(g·A³) = 1. */
  function criticalDepth(Q, d) {
    if (!(Q > 0)) return 0;
    var f = function (y) {
      var g = circGeom(d, y);
      return Q * Q * g.B / (G * g.A * g.A * g.A) - 1;
    };
    if (f(0.99) > 0) return 0.99;                              // поток бурный при любом наполнении
    return U.bisect(f, 1e-4, 0.99, 60);
  }

  /* Число Фруда для потока со свободной поверхностью: Fr = v/√(g·A/B). */
  function froude(Q, d, y) {
    var g = circGeom(d, y);
    if (g.A < 1e-9 || g.B < 1e-9) return 0;
    var v = Q / g.A;
    return v / Math.sqrt(G * g.A / g.B);
  }

  /* Касательное напряжение на стенке: τ = ρ·g·R·i. Главный критерий самоочищения
     (ATV-A110: τ ≥ 1…1,5 Па для бытовых стоков; у нас показываем рядом с таблицей СП). */
  function shear(rho, R, i) { return rho * G * R * i; }

  /* Минимальная (самоочищающая) скорость по СП 32.13330.2018, табл. 5. */
  function selfCleanV(dmm) {
    if (dmm <= 250) return 0.7;
    if (dmm <= 400) return 0.8;
    if (dmm <= 500) return 0.9;
    if (dmm <= 800) return 1.0;
    if (dmm <= 1200) return 1.15;
    if (dmm <= 1500) return 1.3;
    return 1.5;
  }

  /* --------------------------------------------------------------- наносы */

  /* Гидравлическая крупность (скорость осаждения) частицы, м/с.
     Фергюсон и Чёрч (2004) — одна формула на весь диапазон от ила до гравия. */
  function settling(dpart, rhoS, rho, nu) {
    var R = rhoS / rho - 1, C1 = 18, C2 = 1.0;
    return R * G * dpart * dpart / (C1 * nu + Math.sqrt(0.75 * C2 * R * G * dpart * dpart * dpart));
  }
  /* Критическое касательное напряжение начала движения (Шильдс). */
  function shieldsCrit(dpart, rhoS, rho, nu) {
    var R = rhoS / rho - 1;
    var dStar = dpart * Math.pow(R * G / (nu * nu), 1 / 3);
    // аппроксимация кривой Шильдса (Соулсби, 1997)
    var th = 0.3 / (1 + 1.2 * dStar) + 0.055 * (1 - Math.exp(-0.02 * dStar));
    return th * (rhoS - rho) * G * dpart;
  }

  /* --------------------------------------------------------------- старение труб */

  /* Рост шероховатости со временем: k = k0 + α·t (Шевелев, Кольбрук — Уайт).
     α — мм/год, зависит от агрессивности воды. */
  function agedRoughness(k0, alpha, years) { return k0 + alpha * years; }
  /* Зарастание: внутренний диаметр уменьшается вдвое медленнее, чем растёт слой. */
  function agedDiameter(d0, growthMmYear, years) {
    return Math.max(0.2 * d0, d0 - 2 * growthMmYear * years / 1000);
  }

  return {
    G: G, area: area, velocity: velocity, velHead: velHead,
    reynolds: reynolds, regime: regime, regimeName: regimeName, RE_LAM: RE_LAM, RE_TURB: RE_TURB,
    lambda: lambdaColebrook, lambdaAltshul: lambdaAltshul, lambdaBlasius: lambdaBlasius,
    hFriction: hFriction, hLocal: hLocal,
    ROUGH: ROUGH, roughById: roughById, ZETA: ZETA,
    zetaExpansion: zetaExpansion, zetaContraction: zetaContraction, zetaDiffuser: zetaDiffuser,
    flowByDp: flowByDp, dpByFlow: dpByFlow, meterLoss: meterLoss,
    NOZZLES: NOZZLES, nozzleById: nozzleById, mu: mu, outflow: outflow,
    nozzleVacuum: nozzleVacuum, jetX: jetX, emptyTime: emptyTime,
    cavNumber: cavNumber,
    celerity: celerity, jukovsky: jukovsky, phase: phase, michaud: michaud,
    PIPE_MAT: PIPE_MAT, matById: matById,
    pumpCoef: pumpCoef, pumpHead: pumpHead, pumpQmax: pumpQmax, pumpEta: pumpEta, pumpPower: pumpPower,
    circGeom: circGeom, manningV: manningV, manningQ: manningQ, MANNING: MANNING, manningById: manningById,
    normalDepth: normalDepth, criticalDepth: criticalDepth, froude: froude,
    shear: shear, selfCleanV: selfCleanV,
    settling: settling, shieldsCrit: shieldsCrit,
    agedRoughness: agedRoughness, agedDiameter: agedDiameter
  };
})();
