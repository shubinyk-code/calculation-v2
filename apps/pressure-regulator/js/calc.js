/*
  Регулятор давления «после себя» перед насосными установками.

  Все давления — в метрах водяного столба (напор). Бары остаются только там, где
  они зашиты в определение: класс PN и Kvs (м³/ч при Δp = 1 бар). Перевод — через K, м/бар.

  Методика — пособие ООО «ВИЛО РУС» «Влияние колебаний давления в наружной сети
  водопровода на выбор и работу насосов системы водоснабжения зданий» (24.10.2024),
  формулы переписаны в напорах:

    насосы с постоянной частотой:  регулятор нужен, если Н_вх.max − Н_вх.min > 10 м (1 бар);
                                   Н_ред.max = Н_вх.min + 10 м
    насосы с ПЧ:                   Н_ред.max = Н_вых − H_min при Q = 0;
                                   регулятор нужен, если Н_вх.max > Н_ред.max
    проверка корпуса:              Н_max = Н_вх.max + H_max при Q = 0 → PN ≥ Н_max / K

  Всего, чего в пособии нет (Kvs, Ду, диапазон настройки, кавитация, рабочие точки
  на графиках), интерфейс касается с пометкой «оценка».
*/
var Calc = (function () {
  "use strict";

  var EPS = 1e-6;
  var VERSION = 2;
  var PN_LIST = [10, 16, 25, 30, 40];
  var FIRE_KINDS = { "ВПВ": true, "АПТ": true, "ВПВ+АПТ": true };
  var isSet = Fmt.isSet, g = Fmt.g;

  function sq(x) { return x * x; }
  function m1(x) { return Fmt.num(x, 1); }

  // Напор, м → класс PN (бар)
  function pickPN(head, K) {
    var bar = head / K;
    for (var i = 0; i < PN_LIST.length; i++) if (bar <= PN_LIST[i] + EPS) return PN_LIST[i];
    return null;
  }

  function isFire(kind) { return !!FIRE_KINDS[kind]; }

  // ---------------------------------------------------------------- проект

  function defaultSettings() {
    return {
      mPerBar: 10,          // в пособии 1 бар = 10 м; нужен только для PN и Kvs
      fluctLimit: 10,       // м, порог Wilo для насосов без ПЧ (1 бар)
      fNom: 50,
      fMin: 25,             // в пособии 20…25 Гц
      h0Factor: 1.3,        // оценка H₀ = 1,3·H, если каталога нет
      hStFactor: 0.6,       // доля статики за насосом — только для графиков
      dhOpenMax: 3,         // м, потери в полностью открытом регуляторе
      vMax: 3,              // м/с в сечении регулятора
      cavRatio: 3,          // отношение напоров до/после
      kvsTable: "25:8; 32:12; 40:20; 50:35; 65:55; 80:80; 100:130; 125:200; 150:300; 200:520; 250:800; 300:1150",
      springRanges: "5–30; 10–60; 20–100; 40–160"
    };
  }

  var seq = 1;
  function newId() { return "s" + Date.now().toString(36) + (seq++); }

  function newSystem(name) {
    return {
      id: newId(), name: name || "Новая система", kind: "ХПВ", drive: "vfd",
      q: null, h: null, hOut: null, h0: null, fMin: null, hMinQ0: null,
      pn: null, hNetAllow: null, hSt: null, lossM: null, hasTank: false, simult: true
    };
  }

  function blankProject() {
    return {
      version: VERSION, title: "", layout: "separate", settings: defaultSettings(),
      inlet: { hGarMin: null, hMax: null, lossM: 5, dz: 0 },
      systems: [newSystem("Система 1")]
    };
  }

  function exampleProject() {
    var p = blankProject();
    p.title = "Жилой дом — пример из пособия Wilo";
    p.inlet = { hGarMin: 15, hMax: 58, lossM: 5, dz: 0 };
    function sys(o) { var s = newSystem(); for (var k in o) s[k] = o[k]; return s; }
    p.systems = [
      sys({ name: "ХПВ 1 зона", kind: "ХПВ", drive: "vfd", q: 1.67, h: 50, hOut: 58, h0: 65, fMin: 25, hMinQ0: 16, pn: 16 }),
      sys({ name: "ХПВ 2 зона", kind: "ХПВ", drive: "vfd", q: 2.4, h: 78 }),
      sys({ name: "ВПВ 1 зона", kind: "ВПВ", drive: "const", q: 8.7, h: 37, h0: 58 }),
      sys({ name: "ВПВ 2 зона", kind: "ВПВ", drive: "const", q: 8.7, h: 69 }),
      sys({ name: "АПТ паркинга", kind: "АПТ", drive: "const", q: 33.61, h: 22.26 })
    ];
    return p;
  }

  // Проекты первой версии хранили давления в барах — переводим в метры.
  function migrateV1(p) {
    var st = p.settings || {};
    var K = st.mPerBar > 0 ? st.mPerBar : 10;
    var mul = function (v) { return Fmt.isNum(v) ? Math.round(v * K * 1000) / 1000 : v; };
    var s2 = {};
    for (var k in st) s2[k] = st[k];
    if (Fmt.isNum(st.fluctLimit)) s2.fluctLimit = mul(st.fluctLimit);
    if (Fmt.isNum(st.dpOpenMax)) s2.dhOpenMax = mul(st.dpOpenMax);
    delete s2.dpOpenMax;
    if (typeof st.springRanges === "string") {
      s2.springRanges = parseRanges(st.springRanges).map(function (r) { return g(mul(r.lo)) + "–" + g(mul(r.hi)); }).join("; ");
    }
    var systems = (Array.isArray(p.systems) ? p.systems : []).map(function (s) {
      var x = {};
      for (var k2 in s) x[k2] = s[k2];
      if (Fmt.isNum(s.pOut)) x.hOut = mul(s.pOut);
      if (Fmt.isNum(s.pnNet)) x.hNetAllow = mul(s.pnNet);
      delete x.pOut;
      delete x.pnNet;
      return x;
    });
    var out = {};
    for (var k3 in p) out[k3] = p[k3];
    out.settings = s2;
    out.systems = systems;
    out.version = VERSION;
    return out;
  }

  function normalize(p) {
    var base = blankProject();
    if (!p || typeof p !== "object") return base;
    if (!(p.version >= 2)) p = migrateV1(p);
    var out = {
      version: VERSION,
      title: typeof p.title === "string" ? p.title : "",
      layout: p.layout === "common" ? "common" : "separate",
      settings: Object.assign(defaultSettings(), p.settings || {}),
      inlet: Object.assign(base.inlet, p.inlet || {}),
      systems: []
    };
    var seen = {};
    (Array.isArray(p.systems) ? p.systems : []).forEach(function (s) {
      var x = Object.assign(newSystem(), s || {});
      if (!x.id || seen[x.id]) x.id = newId();
      seen[x.id] = true;
      out.systems.push(x);
    });
    if (!out.systems.length) out.systems.push(newSystem("Система 1"));
    return out;
  }

  // «25:8; 32:12» → [{dn, kvs}]
  function parseKvsTable(text) {
    var rows = [];
    String(text || "").split(/[;\n]/).forEach(function (part) {
      var m = part.split(":");
      if (m.length !== 2) return;
      var dn = Fmt.parse(m[0]), kvs = Fmt.parse(m[1]);
      if (Fmt.isNum(dn) && Fmt.isNum(kvs) && dn > 0 && kvs > 0) rows.push({ dn: dn, kvs: kvs });
    });
    rows.sort(function (a, b) { return a.dn - b.dn; });
    return rows;
  }

  // «5–30; 10–60» → [{lo, hi}]
  function parseRanges(text) {
    var rows = [];
    String(text || "").split(/[;\n]/).forEach(function (part) {
      var m = part.split(/–|—|…|\.\.\.|-/);
      if (m.length !== 2) return;
      var lo = Fmt.parse(m[0]), hi = Fmt.parse(m[1]);
      if (Fmt.isNum(lo) && Fmt.isNum(hi) && lo >= 0 && hi > lo) rows.push({ lo: lo, hi: hi });
    });
    return rows;
  }

  // ---------------------------------------------------------------- расчёт системы

  function base(project, sys) {
    var s = project.settings, inl = project.inlet, K = s.mPerBar;
    var r = { id: sys.id, sys: sys, K: K, errors: [], warnings: [], notes: [], estimates: [], steps: [] };

    if (!(K > 0)) r.errors.push("Коэффициент K (м в 1 бар) должен быть больше нуля.");
    if (!(s.fNom > 0)) r.errors.push("Номинальная частота должна быть больше нуля.");
    if (!isSet(inl.hGarMin)) r.errors.push("Не задан гарантированный напор Н гар.min.");
    if (!isSet(inl.hMax)) r.errors.push("Не задан максимальный напор Н макс.");
    if (!(sys.q > 0)) r.errors.push("Не задан расход Q.");
    if (!(sys.h > 0)) r.errors.push("Не задан напор насоса H.");
    if (r.errors.length) { r.valid = false; return r; }
    r.valid = true;

    r.drive = sys.drive === "const" ? "const" : "vfd";
    r.loss = isSet(sys.lossM) ? sys.lossM : (isSet(inl.lossM) ? inl.lossM : 0);
    r.dz = isSet(inl.dz) ? inl.dz : 0;
    r.hConnMin = inl.hGarMin;
    r.hConnMax = inl.hMax;
    r.hInMin = inl.hGarMin - r.loss + r.dz;
    r.hInMax = inl.hMax + r.dz;
    r.fluct = r.hInMax - r.hInMin;

    if (inl.hMax < inl.hGarMin) r.warnings.push("Н макс меньше Н гар.min — проверьте исходные данные.");
    if (r.hInMin <= 0) r.warnings.push("При гарантированном напоре напор на всасе " + m1(r.hInMin) + " м — не больше нуля. Проверьте потери на вводе и кавитационный запас насоса; регулятор этого не исправит.");

    r.h0Est = !isSet(sys.h0);
    r.h0 = r.h0Est ? sys.h * s.h0Factor : sys.h0;
    if (r.h0Est) r.estimates.push("Напор при Q = 0 не задан — принят " + g(s.h0Factor) + "·H = " + m1(r.h0) + " м. Возьмите значение из каталога насоса: от него зависят проверка корпуса и настройка регулятора.");
    if (!r.h0Est && r.h0 <= sys.h) r.warnings.push("Напор при Q = 0 (" + g(r.h0, 1) + " м) не больше рабочего напора (" + g(sys.h, 1) + " м) — у центробежного насоса так не бывает.");

    r.hOutAuto = r.hInMin + sys.h;
    r.hOutManual = r.drive === "vfd" && isSet(sys.hOut);
    r.hOut = r.hOutManual ? sys.hOut : r.hOutAuto;
    r.hStAuto = s.hStFactor * (r.drive === "const" ? r.hOutAuto : r.hOut);

    // Уставку легко ввести в барах по привычке (5,8 вместо 58) или перепутать порядок.
    // Недостижимую уставку насос не даёт даже без расхода — живая модель показывает Q = 0.
    if (r.hOutManual) {
      var hReach = r.hInMin + r.h0;
      if (r.hOut > hReach + EPS) {
        r.warnings.push("Уставка Н<sub>вых</sub> = " + m1(r.hOut) + " м недостижима: даже при нулевом расходе насос даёт не больше Н<sub>вх.min</sub> + H<sub>Q=0</sub> = " + m1(hReach) + " м, поэтому вода в сеть не идёт (Q = 0).");
      } else if (Math.abs(r.hOut - r.hOutAuto) > 15) {
        r.warnings.push("Уставка Н<sub>вых</sub> = " + m1(r.hOut) + " м заметно отличается от Н<sub>вх.min</sub> + H = " + m1(r.hOutAuto) + " м. Проверьте единицы (метры, не бары) и напор насоса.");
      }
    }

    var st = r.steps;
    st.push({
      t: "Напор на всасе при гарантированном напоре",
      f: "Н<sub>вх.min</sub> = Н<sub>гар.min</sub> − Δh<sub>ввод</sub> + Δz",
      v: g(inl.hGarMin) + " − " + g(r.loss) + " " + Fmt.signed(r.dz) + " = <b>" + m1(r.hInMin) + " м</b>",
      note: "Минимальный напор в сети за вычетом потерь на вводе, водомерном узле и арматуре."
    });
    st.push({
      t: "Напор на всасе при максимальном напоре в сети",
      f: "Н<sub>вх.max</sub> = Н<sub>макс</sub> + Δz",
      v: g(inl.hMax) + " " + Fmt.signed(r.dz) + " = <b>" + m1(r.hInMax) + " м</b>",
      note: "Расход нулевой — потерь на вводе нет, до насосов доходит весь напор сети."
    });
    st.push({
      t: "Колебание напора на входе",
      f: "ΔН = Н<sub>вх.max</sub> − Н<sub>вх.min</sub>",
      v: m1(r.hInMax) + " − " + m1(r.hInMin) + " = <b>" + m1(r.fluct) + " м</b>"
    });

    if (r.drive === "const") {
      var lim = s.fluctLimit;
      r.hRedMax = r.hInMin + lim;
      r.need = r.fluct > lim + EPS;
      st.push({
        t: "Насосы с постоянной частотой: нужен ли регулятор", src: "рекомендация Wilo",
        f: "ΔН > " + g(lim) + " м → регулятор «после себя» перед насосами",
        v: m1(r.fluct) + " м " + (r.need ? "&gt; " : "≤ ") + g(lim) + " м → <b>" + (r.need ? "регулятор нужен" : "регулятор не нужен") + "</b>",
        cls: r.need ? "bad" : "good"
      });
      st.push({
        t: "Настройка регулятора", src: "рекомендация Wilo",
        f: "Н<sub>ред.max</sub> = Н<sub>вх.min</sub> + " + g(lim) + " м",
        v: m1(r.hInMin) + " + " + g(lim) + " = <b>" + m1(r.hRedMax) + " м</b>" + (r.need ? "" : " (справочно)")
      });
    } else {
      r.fMin = isSet(sys.fMin) ? sys.fMin : s.fMin;
      r.hMinQ0Auto = r.h0 * sq(r.fMin / s.fNom);
      r.hMinQ0Manual = isSet(sys.hMinQ0);
      r.hMinQ0 = r.hMinQ0Manual ? sys.hMinQ0 : r.hMinQ0Auto;

      st.push(r.hOutManual ? {
        t: "Напор на выходе установки",
        f: "Н<sub>вых</sub> — уставка станции",
        v: "задано: <b>" + m1(r.hOut) + " м</b> (по напору насоса было бы " + m1(r.hInMin) + " + " + g(sys.h) + " = " + m1(r.hOutAuto) + " м)"
      } : {
        t: "Напор на выходе установки",
        f: "Н<sub>вых</sub> = Н<sub>вх.min</sub> + H",
        v: m1(r.hInMin) + " + " + g(sys.h) + " = <b>" + m1(r.hOut) + " м</b>"
      });
      st.push(r.hMinQ0Manual ? {
        t: "Напор при нулевом расходе на минимальной частоте",
        f: "H<sup>min</sup><sub>Q=0</sub> — по каталогу при f<sub>min</sub> = " + g(r.fMin) + " Гц",
        v: "задано: <b>" + m1(r.hMinQ0) + " м</b>"
      } : {
        t: "Напор при нулевом расходе на минимальной частоте",
        f: "H<sup>min</sup><sub>Q=0</sub> = H<sub>Q=0</sub>·(f<sub>min</sub> / f<sub>ном</sub>)²",
        v: g(r.h0, 1) + "·(" + g(r.fMin) + " / " + g(s.fNom) + ")² = <b>" + m1(r.hMinQ0) + " м</b>",
        note: "Законы подобия. Точнее — снять с кривой насоса на минимальной частоте в каталоге."
      });

      r.hRedMax = r.hOut - r.hMinQ0;
      r.need = r.hInMax > r.hRedMax + EPS;
      st.push({
        t: "Предельный напор на входе, который ПЧ ещё компенсирует", src: "рекомендация Wilo",
        f: "Н<sub>ред.max</sub> = Н<sub>вых</sub> − H<sup>min</sup><sub>Q=0</sub>",
        v: m1(r.hOut) + " − " + m1(r.hMinQ0) + " = <b>" + m1(r.hRedMax) + " м</b>"
      });
      st.push({
        t: "Сравнение с максимальным напором на входе",
        f: "Н<sub>вх.max</sub> > Н<sub>ред.max</sub> → регулятор «после себя» перед насосами",
        v: m1(r.hInMax) + " м " + (r.need ? "&gt; " : "≤ ") + m1(r.hRedMax) + " м → <b>" + (r.need ? "регулятор нужен, уставка " + m1(r.hRedMax) + " м" : "ПЧ компенсирует сам, регулятор не нужен") + "</b>",
        cls: r.need ? "bad" : "good"
      });

      var freqAt = function (hIn) {
        var hr = r.hOut - hIn;
        return hr <= 0 ? 0 : s.fNom * Math.sqrt(hr / r.h0);
      };
      r.fAtMin = freqAt(r.hInMin);
      r.fAtMax = freqAt(r.hInMax);
      st.push({
        t: "Частота, нужная при нулевом расходе",
        f: "f = f<sub>ном</sub>·√((Н<sub>вых</sub> − Н<sub>вх</sub>) / H<sub>Q=0</sub>)",
        v: "при Н<sub>вх.min</sub>: " + Fmt.num(r.fAtMin, 1) + " Гц; при Н<sub>вх.max</sub>: <b>" + Fmt.num(r.fAtMax, 1) + " Гц</b> (минимум ПЧ " + g(r.fMin) + " Гц)",
        cls: r.fAtMax < r.fMin - EPS ? "bad" : "",
        note: "Ниже минимальной частоты ПЧ опуститься не может — напор на выходе растёт вместе с напором на входе."
      });

      if (r.hRedMax < r.hInMin - EPS) {
        r.warnings.push("Н<sub>ред.max</sub> = " + m1(r.hRedMax) + " м ниже Н<sub>вх.min</sub> = " + m1(r.hInMin) + " м: даже при гарантированном напоре установка на нулевом расходе упирается в минимальную частоту. Регулятор тут не поможет — насос завышен по напору или занижен Н<sub>вых</sub>.");
      }
    }

    if (sys.kind === "ХПВ" && r.drive === "const" && (inl.hMax - inl.hGarMin) > 10 + EPS && !sys.hasTank) {
      r.warnings.push("СП 30.13330.2020 п. 13.13: насосы ХПВ с переменным водоразбором, присоединённые к сети с колебаниями напора более 10 м (0,1 МПа; здесь " + m1(inl.hMax - inl.hGarMin) + " м), следует предусматривать с частотным регулированием. Без него допускается только при водонапорном или гидропневматическом баке.");
    }
    return r;
  }

  function finish(project, r, setpoint, reg, commonMode) {
    var K = r.K, sys = r.sys, st = r.steps;

    r.setpoint = setpoint;
    r.reg = reg;
    r.hasReg = setpoint !== null && setpoint !== undefined;
    r.commonMode = !!commonMode;
    r.dhOpen = r.hasReg && reg ? reg.dhOpen : 0;
    r.hInMaxAfter = r.hasReg ? Math.min(r.hInMax, setpoint) : r.hInMax;
    r.hInMinAfter = r.hInMin - r.dhOpen;

    if (commonMode && r.hasReg) {
      var gov = setpoint < r.hRedMax - EPS;
      st.push({
        t: "Общий регулятор на вводе",
        f: "уставка = наименьший Н<sub>ред.max</sub> из всех систем",
        v: "<b>" + m1(setpoint) + " м</b>" + (gov ? " — задаёт другая система; этой хватило бы " + m1(r.hRedMax) + " м" : " — задаёт эта система")
      });
      if (setpoint < r.hInMin - EPS) {
        r.warnings.push("Уставка общего регулятора (" + m1(setpoint) + " м) ниже расчётного напора на всасе этой системы (" + m1(r.hInMin) + " м): насос недодаст " + m1(r.hInMin - setpoint) + " м. Ставьте отдельные регуляторы на установки.");
      }
    }

    if (r.hasReg) {
      st.push({
        t: "Напор перед насосами с регулятором",
        f: "Н<sub>вх</sub> = Н<sub>вх.min</sub> … min(Н<sub>вх.max</sub>; уставка)",
        v: "<b>" + m1(r.hInMinAfter) + " … " + m1(r.hInMaxAfter) + " м</b> вместо " + m1(r.hInMin) + " … " + m1(r.hInMax) + " м без регулятора",
        note: r.dhOpen > 0 ? "Нижняя граница — с потерями в полностью открытом регуляторе " + m1(r.dhOpen) + " м." : ""
      });
    }

    // Корпус насоса/установки
    r.hBody = r.hInMaxAfter + r.h0;
    r.hBodyNoReg = r.hInMax + r.h0;
    r.pnReq = pickPN(r.hBody, K);
    r.pnReqNoReg = pickPN(r.hBodyNoReg, K);
    var pnTxt = function (pn) { return pn ? "PN" + pn + " (до " + g(pn * K) + " м)" : "больше PN40"; };
    var bodyBad = isSet(sys.pn) && r.hBody > sys.pn * K + EPS;
    st.push({
      t: "Максимальный напор в корпусе насоса/установки", src: "рекомендация Wilo",
      f: "Н<sub>max</sub> = Н<sub>вх.max</sub> + H<sup>max</sup><sub>Q=0</sub>",
      v: m1(r.hInMaxAfter) + " + " + g(r.h0, 1) + " = <b>" + m1(r.hBody) + " м → " + pnTxt(r.pnReq) + "</b>" +
        (r.hasReg ? "<br>без регулятора: " + m1(r.hInMax) + " + " + g(r.h0, 1) + " = " + m1(r.hBodyNoReg) + " м → " + pnTxt(r.pnReqNoReg) : "") +
        (isSet(sys.pn) ? "<br>выбрано " + pnTxt(sys.pn) + " — " + (bodyBad ? "не проходит" : "проходит") : ""),
      cls: bodyBad || !r.pnReq ? "bad" : "",
      note: (r.h0Est ? "H при Q = 0 оценочный — уточните по каталогу. " : "") + "PN — номинал в барах, 1 бар = " + g(K) + " м."
    });
    if (bodyBad) r.warnings.push("Корпус " + pnTxt(sys.pn) + " не выдерживает " + m1(r.hBody) + " м — нужно " + pnTxt(r.pnReq) + (r.hasReg ? "." : " или регулятор давления перед насосами."));
    if (!r.pnReq) r.warnings.push("Напор в корпусе " + m1(r.hBody) + " м больше PN40.");

    // Сеть после насосов
    if (r.drive === "const") {
      r.hOutLo = r.hInMin + sys.h;
      r.hNetMax = r.hBody;
      r.hNetMaxNoReg = r.hBodyNoReg;
    } else {
      r.hOutLo = r.hOut;
      r.hNetMax = Math.max(r.hOut, r.hInMaxAfter + r.hMinQ0);
      r.hNetMaxNoReg = Math.max(r.hOut, r.hInMax + r.hMinQ0);
    }
    if (isSet(sys.hNetAllow)) {
      var netBad = r.hNetMax > sys.hNetAllow + EPS;
      st.push({
        t: "Напор в сети после насосов",
        f: r.drive === "const" ? "Н = Н<sub>вх.max</sub> + H<sup>max</sup><sub>Q=0</sub> — насос на закрытую сеть" : "Н = max(Н<sub>вых</sub>; Н<sub>вх.max</sub> + H<sup>min</sup><sub>Q=0</sub>)",
        v: "<b>" + m1(r.hNetMax) + " м</b> при допустимом " + g(sys.hNetAllow) + " м" + (r.hasReg ? "; без регулятора " + m1(r.hNetMaxNoReg) + " м" : ""),
        cls: netBad ? "bad" : "good"
      });
      if (netBad) {
        r.warnings.push((isFire(sys.kind) ? "СП 10.13330.2020 п. 13.12: " : "") + "напор в сети после насосов " + m1(r.hNetMax) + " м выше допустимого " + g(sys.hNetAllow) + " м — нужны регуляторы давления после насосов на отдельных участках или деление сети на зоны.");
      } else if (r.hasReg && r.hNetMaxNoReg > sys.hNetAllow + EPS) {
        r.notes.push("Без регулятора напор в сети достиг бы " + m1(r.hNetMaxNoReg) + " м при допустимых " + g(sys.hNetAllow) + " м — регулятор нужен и по прочности сети" + (isFire(sys.kind) ? " (СП 10.13330.2020 п. 13.12)." : "."));
      }
    }

    // Рабочие точки по модели — иллюстрация к слайдам «стандартный насос» и «насос с ПЧ»
    var m = model(project, r);
    var hi = { hNet: project.inlet.hMax, phi: 1, fire: "fire", regOn: true };
    var lo = { hNet: project.inlet.hGarMin, phi: 1, fire: "fire", regOn: true };
    var regSim = r.hasReg && reg ? { setpoint: setpoint, kvs: reg.kvs } : null;
    r.op = {
      design: simSystem(project, r, lo, null, 0),
      maxNoReg: simSystem(project, r, hi, null, 0),
      maxReg: regSim ? simSystem(project, r, hi, regSim, 0) : null
    };
    if (r.drive === "const") {
      var o = r.op.maxNoReg;
      if (o.qRatio > 1.05) {
        // Мощность не оцениваем: без кривой КПД парабола даёт падение гидравлической
        // мощности, а мощность на валу в правой части характеристики обычно растёт.
        r.notes.push("Без регулятора при Н<sub>макс</sub> рабочая точка уходит вправо: Q ≈ " + Fmt.num(o.Q) + " л/с (" + Math.round(o.qRatio * 100) + " % расчётного). В правой части характеристики растёт мощность на валу и падает кавитационный запас — риск перегрузки двигателя (пособие, слайд «Стандартный насос»). Сверьте Q с кривой мощности насоса." + (m.hStEst || r.h0Est ? " Оценка: статика и кривая насоса приняты приближённо." : ""));
      }
    }

    if (r.hasReg && r.dhOpen > 0) {
      r.notes.push("При гарантированном напоре регулятор открыт полностью и сам теряет (Q/Kvs)²·K = " + m1(r.dhOpen) + " м. " +
        (r.dhOpen >= 0.5 ? "Добавьте это к напору насоса или возьмите регулятор с большим Kvs." : "На подбор насоса практически не влияет."));
    }
    if (r.drive === "vfd" && !r.need) {
      r.notes.push("ПЧ компенсирует колебания сам: при Н<sub>вх.max</sub> и нулевом расходе нужна частота " + Fmt.num(r.fAtMax, 1) + " Гц — не ниже минимальных " + g(r.fMin) + " Гц.");
    }
    if (sys.kind === "АПТ" || sys.kind === "ВПВ+АПТ") {
      r.notes.push("СП 485.1311500.2020 требований к колебаниям давления на вводе не содержит — решение принимается по рекомендации производителя насосов.");
    }
    if (isFire(sys.kind) && r.hasReg) {
      r.notes.push("Регулятор на вводе противопожарного водопровода — ещё один элемент на пути воды к насосам. Продумайте резервирование (второй ввод со своим регулятором, как в примере паркинга из пособия) и согласуйте решение.");
    }

    r.status = r.warnings.length ? "warn" : "ok";
    return r;
  }

  // ---------------------------------------------------------------- подбор регулятора

  function sizeRegulator(project, q, setpoint, hInMax, hInMin) {
    var s = project.settings, K = s.mPerBar;
    var reg = { q: q, qm3: q * 3.6, setpoint: setpoint, hInMax: hInMax, hInMin: hInMin, warnings: [] };
    var dhAllow = s.dhOpenMax > 0 ? s.dhOpenMax : 3;
    // Kvs определён для перепада 1 бар, поэтому допустимые метры переводятся в бары.
    reg.kvReq = reg.qm3 / Math.sqrt(dhAllow / K);
    var vel = function (dn) { return q / 1000 / (Math.PI * sq(dn / 1000) / 4); };
    var table = parseKvsTable(s.kvsTable);

    var pick = null;
    for (var i = 0; i < table.length; i++) {
      if (table[i].kvs >= reg.kvReq - EPS && vel(table[i].dn) <= s.vMax + EPS) { pick = table[i]; break; }
    }
    if (!pick && table.length) {
      pick = table[table.length - 1];
      reg.warnings.push("Ни один типоразмер из таблицы не проходит по Kvs и скорости — нужен регулятор больше Ду" + pick.dn + " или два параллельно.");
    }
    if (pick) {
      reg.dn = pick.dn;
      reg.kvs = pick.kvs;
      reg.v = vel(pick.dn);
      reg.dhOpen = sq(reg.qm3 / pick.kvs) * K;
    } else {
      reg.warnings.push("Таблица «Ду : Kvs» пуста — типоразмер не подобран.");
      reg.dhOpen = 0;
    }

    var ranges = parseRanges(s.springRanges), best = null, bestScore = Infinity;
    ranges.forEach(function (rg) {
      if (setpoint < rg.lo - EPS || setpoint > rg.hi + EPS) return;
      var pos = (setpoint - rg.lo) / (rg.hi - rg.lo);
      var score = Math.abs(pos - 0.5);
      if (score < bestScore) { best = rg; bestScore = score; reg.rangePos = pos; }
    });
    reg.range = best;
    if (!best) reg.warnings.push("Уставка " + m1(setpoint) + " м не попадает ни в один диапазон настройки из списка.");
    else if (bestScore > 0.25) reg.warnings.push("Уставка у края диапазона настройки (" + Math.round(reg.rangePos * 100) + " %). По пособию она должна быть ближе к середине — поищите регулятор с другим пилотом или пружиной.");

    reg.pn = pickPN(hInMax, K);
    reg.dhMax = hInMax - setpoint;
    reg.ratio = setpoint > 0 ? hInMax / setpoint : Infinity;
    if (reg.ratio > s.cavRatio + EPS) {
      reg.warnings.push("Отношение напоров до и после регулятора " + Fmt.num(reg.ratio, 1) + " : 1 больше " + g(s.cavRatio) + " : 1 — риск кавитации и шума. Рассмотрите два регулятора последовательно или исполнение с антикавитационной обвязкой.");
    }
    if (setpoint <= 0) reg.warnings.push("Уставка не больше нуля — регулятор подобрать нельзя.");
    return reg;
  }

  // ---------------------------------------------------------------- проект целиком

  function compute(project) {
    var list = project.systems.map(function (sys) { return base(project, sys); });
    var res = { list: list, byId: {}, common: null };
    list.forEach(function (r) { res.byId[r.id] = r; });
    var valid = list.filter(function (r) { return r.valid; });

    if (project.layout === "common" && valid.length) {
      var gov = null, need = false, q = 0, qMax = 0, hInMax = -Infinity, hInMin = Infinity;
      valid.forEach(function (r) {
        if (!gov || r.hRedMax < gov.hRedMax) gov = r;
        if (r.need) need = true;
        if (r.sys.simult !== false) q += r.sys.q;
        qMax = Math.max(qMax, r.sys.q);
        hInMax = Math.max(hInMax, r.hInMax);
        hInMin = Math.min(hInMin, r.hInMin);
      });
      if (q <= 0) q = qMax;
      var c = res.common = {
        need: need, governing: gov, q: q, hInMax: hInMax, hInMin: hInMin,
        setpoint: need ? gov.hRedMax : null, reg: null
      };
      if (need) c.reg = sizeRegulator(project, q, c.setpoint, hInMax, hInMin);
      valid.forEach(function (r) { finish(project, r, c.setpoint, c.reg, true); });
    } else {
      valid.forEach(function (r) {
        var reg = r.need ? sizeRegulator(project, r.sys.q, r.hRedMax, r.hInMax, r.hInMin) : null;
        finish(project, r, r.need ? r.hRedMax : null, reg, false);
      });
    }
    return res;
  }

  // ---------------------------------------------------------------- модель для «живой» схемы и графиков
  //
  // Насос:   H(Q, n) = n²·H₀ − a·Q²   (парабола через H₀ и рабочую точку, законы подобия)
  // Сеть:    за насосом нужно Нст + b·Q²/φ²,  φ — открытие потребителей (0 — всё закрыто)
  // Ввод:    потери ∝ Q², заданы при расчётном расходе системы
  // Регулятор: пока напор перед ним выше уставки — держит уставку,
  //            ниже — открыт полностью и теряет (Q/Kvs)²·K.

  function model(project, r) {
    var s = project.settings, qd = r.sys.q, h = r.sys.h;
    var a = Math.max(r.h0 - h, 0.05 * h) / sq(qd);
    var hOutSet = r.drive === "const" ? r.hOutAuto : r.hOut;
    var hStEst = !isSet(r.sys.hSt);
    var S = hStEst ? s.hStFactor * hOutSet : r.sys.hSt;
    var b = Math.max(hOutSet - S, 0.05 * hOutSet) / sq(qd);
    // Минимальная «скорость» берётся из напора на минимальной частоте, а не из f_min/f_ном:
    // если напор задан по каталогу, модель обязана с ним совпасть.
    var nMin = r.drive === "vfd" ? Math.sqrt(Math.max(r.hMinQ0, 0) / r.h0) : 1;
    return {
      K: r.K, qd: qd, h: h, h0: r.h0, a: a, S: S, b: b, hStEst: hStEst,
      loss: r.loss, dz: r.dz, hOutSet: hOutSet,
      nMin: nMin, fMin: r.fMin, fNom: s.fNom
    };
  }

  function inletAt(m, hNet, Q, reg, qOther) {
    var before = hNet + m.dz - m.loss * sq(Q / m.qd);
    if (!reg) return { before: before, after: before, mode: "none" };
    var dh = reg.kvs > 0 ? sq((Q + (qOther || 0)) * 3.6 / reg.kvs) * m.K : 0;
    var open = before - dh;
    if (open <= reg.setpoint) return { before: before, after: open, mode: "open" };
    return { before: before, after: reg.setpoint, mode: "reg" };
  }

  function pumpHead(m, n2, Q) {
    return Math.max(n2 * m.h0 - m.a * Q * Q, 0);
  }

  // Расход, при котором напор насоса с подпором из сети равен потребному.
  function solveFlow(m, hNet, reg, qOther, n2, phi) {
    if (!(phi > 0)) return 0;
    var bPhi = m.b / sq(phi);
    var F = function (Q) {
      return inletAt(m, hNet, Q, reg, qOther).after + pumpHead(m, n2, Q) - m.S - bPhi * Q * Q;
    };
    if (F(0) <= 0) return 0;
    var hi = Math.sqrt(Math.max(n2 * m.h0, 1) / m.a);
    for (var k = 0; k < 10 && F(hi) > 0; k++) hi *= 2;
    var lo = 0;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      if (F(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function simSystem(project, r, live, reg, qOther) {
    var m = model(project, r), hNet = live.hNet;
    var phi = live.phi, on = true;
    if (isFire(r.sys.kind)) {
      if (live.fire === "off") { on = false; phi = 0; }
      else if (live.fire === "q0") phi = 0;
      else phi = 1;
    }
    var st = { id: r.id, on: on, phi: phi, hConn: hNet, n2: 0, f: null };
    var p;
    if (!on) {
      p = inletAt(m, hNet, 0, reg, qOther);
      st.Q = 0; st.H = 0; st.hBefore = p.before; st.hIn = p.after; st.hOut = p.after;
      st.regMode = p.mode; st.status = "off"; st.qRatio = 0;
      return st;
    }
    var n2 = 1, Q;
    if (r.drive === "vfd") {
      var Qt = phi * Math.sqrt(Math.max(0, (m.hOutSet - m.S) / m.b));
      var pt = inletAt(m, hNet, Qt, reg, qOther);
      var need2 = ((m.hOutSet - pt.after) + m.a * Qt * Qt) / m.h0;
      var nMin2 = m.nMin * m.nMin;
      if (need2 < nMin2) { n2 = nMin2; st.status = "fmin"; Q = solveFlow(m, hNet, reg, qOther, n2, phi); }
      else if (need2 > 1) { n2 = 1; st.status = "fmax"; Q = solveFlow(m, hNet, reg, qOther, n2, phi); }
      else { n2 = need2; st.status = "ok"; Q = Qt; }
      st.f = st.status === "fmin" ? m.fMin : Math.sqrt(n2) * m.fNom;
    } else {
      Q = solveFlow(m, hNet, reg, qOther, 1, phi);
      st.status = "ok";
    }
    p = inletAt(m, hNet, Q, reg, qOther);
    st.n2 = n2;
    st.Q = Q;
    st.H = pumpHead(m, n2, Q);
    st.hBefore = p.before;
    st.hIn = p.after;
    st.hOut = p.after + st.H;
    st.regMode = p.mode;
    st.qRatio = Q / m.qd;
    return st;
  }

  function regulatorFor(project, res, r) {
    if (project.layout === "common") {
      var c = res.common;
      return c && c.need && c.reg && c.reg.kvs ? { setpoint: c.setpoint, kvs: c.reg.kvs, common: true } : null;
    }
    return r.hasReg && r.reg && r.reg.kvs ? { setpoint: r.setpoint, kvs: r.reg.kvs, common: false } : null;
  }

  function simulate(project, res, live) {
    var out = { byId: {}, totalQ: 0, main: null };
    var valid = res.list.filter(function (r) { return r.valid; });
    var common = project.layout === "common";
    var qs = {};
    var passes = common ? 3 : 1;
    for (var pass = 0; pass < passes; pass++) {
      var total = 0;
      valid.forEach(function (r) { total += qs[r.id] || 0; });
      valid.forEach(function (r) {
        var reg = live.regOn ? regulatorFor(project, res, r) : null;
        var qOther = reg && reg.common ? total - (qs[r.id] || 0) : 0;
        var st = simSystem(project, r, live, reg, qOther);
        out.byId[r.id] = st;
        qs[r.id] = st.Q;
      });
    }
    var qd = 0;
    valid.forEach(function (r) { out.totalQ += qs[r.id] || 0; if (r.sys.simult !== false || !common) qd += r.sys.q; });

    // Напоры на общем вводе — для схемы
    var K = project.settings.mPerBar, inl = project.inlet;
    var loss = isSet(inl.lossM) ? inl.lossM : 0;
    var dz = isSet(inl.dz) ? inl.dz : 0;
    var hNet = live.hNet;
    var ratio = qd > 0 ? out.totalQ / qd : 0;
    var hMeter = hNet + dz - loss * sq(Math.min(ratio, 3));
    out.main = { hConn: hNet, hMeter: hMeter, hCreg: hMeter, cregMode: "none", qRatio: ratio };
    if (common && live.regOn && res.common && res.common.need && res.common.reg) {
      var c = res.common;
      var open = hMeter - (c.reg.kvs ? sq(out.totalQ * 3.6 / c.reg.kvs) * K : 0);
      if (open <= c.setpoint) { out.main.hCreg = open; out.main.cregMode = "open"; }
      else { out.main.hCreg = c.setpoint; out.main.cregMode = "reg"; }
    }
    return out;
  }

  return {
    VERSION: VERSION,
    PN_LIST: PN_LIST,
    isFire: isFire,
    pickPN: pickPN,
    defaultSettings: defaultSettings,
    newSystem: newSystem,
    blankProject: blankProject,
    exampleProject: exampleProject,
    normalize: normalize,
    parseKvsTable: parseKvsTable,
    parseRanges: parseRanges,
    sizeRegulator: sizeRegulator,
    compute: compute,
    model: model,
    inletAt: inletAt,
    pumpHead: pumpHead,
    solveFlow: solveFlow,
    simSystem: simSystem,
    regulatorFor: regulatorFor,
    simulate: simulate
  };
})();
