/* Вкладка «Дренаж»: приямок с поплавками, погружные насосы по каталожным кривым,
   напорные трубы по Шевелеву; раздельная работа (у каждого насоса своя труба)
   и совместная (ветки с обратными клапанами сходятся в общий трубопровод).

   Напоры — м, отсчёт от дна приямка. Расходы — м³/ч.
   Насос i:   zw + Hi(Qi) − hветви(Qi) = E          (E — напор в узле слияния)
   Общая:     E − hобщ(ΣQ) = zвып                     (излив в колодец)
   Раздельно: zw + Hi(Qi) − hлинии(Qi) = zвып */
var DrainPumps = [
  { id: "nsp400-11", name: "NSP 50/400-1,1 (3~400 В)", use: "насосная + УВ", P2: 1.1, starts: 96, pass: 40, dnd: "G2",
    H: [[0, 13.5], [5, 12.8], [10, 11.9], [15, 10.7], [20, 9.0], [25, 6.7], [28.7, 4.5]],
    P1: [[0, 0.8], [10, 1.2], [20, 1.5], [28.7, 1.7]] },
  { id: "nsp400-075", name: "NSP 50/400-0,75 (3~400 В)", use: "паркинг", P2: 0.75, starts: 144, pass: 40, dnd: "G2",
    H: [[0, 11.4], [5, 10.5], [10, 9.5], [15, 7.9], [20, 4.9], [22.2, 2.9]],
    P1: [[0, 0.55], [10, 0.84], [20, 1.15], [22.2, 1.2]] },
  { id: "nsp230-075", name: "NSP 50/230-0,75/S (1~230 В, с поплавком)", use: "кладовые", P2: 0.75, starts: 144, pass: 40, dnd: "G2",
    H: [[0, 11.7], [5, 10.5], [10, 9.4], [15, 7.7], [20, 4.7], [22.9, 2.3]],
    P1: [[0, 0.7], [10, 0.93], [20, 1.2], [22.9, 1.27]] },
  { id: "tmt32", name: "Wilo Drain TMT 32M113/7,5Ci", use: "ИТП (1+1), горячая вода до 95 °C", P2: 0.75, starts: 60, pass: 9, dnd: "G1¼",
    H: [[0, 14.6], [4, 14.0], [8, 13.0], [11.6, 11.1], [14, 9.5], [16, 8.0], [18, 6.2], [20, 4.2], [21.6, 2.5]],
    P1: [[0, 0.51], [6, 0.72], [11.6, 0.89], [16, 0.95], [21.6, 0.93]] },
  { id: "slift430", name: "TAEN S-Lift 430 (КНУ в ПУИ, 400 Вт)", use: "ПУИ, раковины", P2: 0.4, starts: 0, pass: 0, dnd: "Ø40",
    H: [[0, 6.6], [1, 6.2], [2, 5.5], [3, 4.6], [4, 3.5], [5, 2.1], [6, 0.45]],
    P1: [[0, 0.4], [6, 0.4]] }
];

var Drain = (function () {
  "use strict";

  /* ------------------------------------------------------------ кривые */
  /* Монотонный кубический сплайн (Фрича–Карлсона) по точкам листа; за последней
     точкой — прямая по последнему отрезку до H = 0 (там уже «вне рабочего поля»). */
  function curve(pts) {
    var n = pts.length, x = pts.map(function (p) { return p[0]; }), y = pts.map(function (p) { return p[1]; });
    var d = [], m = [];
    for (var i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    var mEnd = d[n - 2];
    function f(q) {
      if (q <= x[0]) return y[0];
      if (q >= x[n - 1]) return y[n - 1] + mEnd * (q - x[n - 1]);
      var k = 0; while (q > x[k + 1]) k++;
      var h = x[k + 1] - x[k], t = (q - x[k]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * h * m[k + 1];
    }
    f.qLast = x[n - 1];
    f.qZero = mEnd < 0 ? x[n - 1] - y[n - 1] / mEnd : x[n - 1] * 1.3;
    return f;
  }
  var cache = {};
  function pumpModel(id) {
    if (cache[id]) return cache[id];
    var p = DrainPumps.filter(function (x) { return x.id === id; })[0] || DrainPumps[0];
    var m = { def: p, H: curve(p.H), P1: curve(p.P1) };
    m.H0 = p.H[0][1];
    cache[id] = m;
    return m;
  }

  /* ------------------------------------------------------------ состояние */
  function defaults() {
    return {
      pumps: ["nsp400-11", "nsp400-11"], count: 2, layout: "joint", cv: true,
      pit: { L: 1.5, W: 1.2, depth: 1.5 },
      lv: { dry: 0.2, off: 0.35, on1: 0.8, on2: 1.0, alarm: 1.25 },
      zOut: 4.5,
      pipe: { branch: "3262:50:60:3", Lb: 3, zb: 3.3, common: "3262:65:75.5:3.2", Lc: 25, zc: 3, reserve: 1 },
      inflow: 8,
      ctrl: { mode: "auto", duty: "both", manual: [false, false], failed: [false, false], alternate: true },
      speed: 5
    };
  }

  function Sim(st) { this.st = st; this.reset(); }
  Sim.prototype.reset = function () {
    this.t = 0; this.level = this.st.lv.on1 - 0.05; this.lead = 0; this.dry = false; this.flood = 0;
    this.p = [0, 1].map(function () { return { on: false, r: 0, Q: 0, H: 0, P1: 0, starts: 0, times: [], run: 0 }; });
    this.Qout = 0; this.E = 0; this.burst = 0; this.hist = []; this.histT = 0; this.events = []; this.seq = 0;
    this.peakOn = false;
  };
  Sim.prototype.log = function (s, lvl) { this.events.push({ t: this.t, text: s, level: lvl || "info", id: ++this.seq }); if (this.events.length > 200) this.events.shift(); };
  Sim.prototype.area = function () { return this.st.pit.L * this.st.pit.W; };

  /* ------------------------------------------------------------ гидравлика */
  function pipes(st) {
    var pb = Pipes.byId(st.pipe.branch), pc = Pipes.byId(st.pipe.common);
    return { pb: pb, pc: pc, res: st.pipe.reserve };
  }
  function hBranch(st, P, q) { return q > 0 ? Pipes.shevelev(q, P.pb, st.pipe.Lb, st.pipe.zb, P.res).h : 0; }
  function hCommon(st, P, q) { return q > 0 ? Pipes.shevelev(q, P.pc, st.pipe.Lc, st.pipe.zc, P.res).h : 0; }
  // Раздельная линия: та же ветка + своя «общая» труба той же длины и диаметра
  function hSeparate(st, P, q) { return hBranch(st, P, q) + hCommon(st, P, q); }

  /* Установившийся режим при уровне zw и оборотах r[i] (0…1). */
  function solve(st, zw, r) {
    var P = pipes(st), N = st.count, res = { q: [0, 0], H: [0, 0], E: 0, Q: 0 };
    var models = [pumpModel(st.pumps[0]), pumpModel(st.pumps[1])];
    function Hp(i, q) { var rr = r[i]; return rr * rr * models[i].H(q / Math.max(rr, 1e-3)); }
    function qmax(i) { return models[i].H.qZero * r[i]; }

    if (st.layout === "separate") {
      for (var i = 0; i < N; i++) {
        if (r[i] < 0.02) continue;
        var g = function (q) { return zw + Hp(i, q) - hSeparate(st, P, q) - st.zOut; };
        if (g(0) <= 0) continue;
        var q = U.bisect(g, 0, qmax(i), 40);
        res.q[i] = q; res.H[i] = Hp(i, q);
      }
      res.Q = res.q[0] + res.q[1];
      return res;
    }

    // Совместная работа: ищем напор E в узле слияния
    function branchQ(i, E) {
      if (i >= N) return 0;
      if (r[i] >= 0.02) {
        var g = function (q) { return zw + Hp(i, q) - hBranch(st, P, q) - E; };
        if (g(0) <= 0) return 0;
        return U.bisect(g, 0, qmax(i), 40);
      }
      // Стоящий насос: без обратного клапана вода идёт через него назад в приямок
      if (!st.cv && E > zw) {
        var k = 0.03; // сопротивление проточной части стоящего насоса, м/(м³/ч)²
        return -U.bisect(function (q) { return hBranch(st, P, q) + k * q * q - (E - zw); }, 0, 80, 40);
      }
      return 0;
    }
    function commonQ(E) {
      if (E <= st.zOut) return 0;
      var hi = 20; while (hCommon(st, P, hi) < E - st.zOut && hi < 2000) hi *= 2;
      return U.bisect(function (q) { return E - hCommon(st, P, q) - st.zOut; }, 0, hi, 40);
    }
    var any = false; for (var j = 0; j < N; j++) if (r[j] >= 0.02) any = true;
    if (!any) return res;
    var Emax = zw + Math.max(models[0].H0, models[1].H0) + 0.01;
    var f = function (E) { return branchQ(0, E) + branchQ(1, E) - commonQ(E); };
    if (f(st.zOut) <= 0) return res;
    var E = U.bisect(f, st.zOut, Emax, 44);
    res.E = E;
    for (j = 0; j < N; j++) { res.q[j] = branchQ(j, E); res.H[j] = r[j] >= 0.02 ? Hp(j, Math.max(0, res.q[j])) : 0; }
    res.Q = commonQ(E);
    return res;
  }

  /* ------------------------------------------------------------ шаг */
  Sim.prototype.step = function (dt) {
    var st = this.st, lv = st.lv, c = st.ctrl, self = this, N = st.count;
    this.t += dt;
    this.control(dt);
    for (var i = 0; i < 2; i++) {
      var ps = this.p[i];
      var want = ps.on && i < N && !c.failed[i];
      ps.r += (want ? 1 : -1) * dt / 0.6;
      ps.r = U.clamp(ps.r, 0, 1);
    }
    var sol = solve(st, this.level, [this.p[0].r, this.p[1].r]);
    this.sol = sol;
    var Qpumped = 0;
    for (i = 0; i < 2; i++) {
      var p = this.p[i];
      p.Q = sol.q[i]; p.H = sol.H[i];
      var m = pumpModel(st.pumps[i]);
      p.P1 = p.r > 0.02 ? p.r * p.r * p.r * m.P1(Math.max(0, p.Q) / Math.max(p.r, 1e-3)) : 0;
      if (p.r > 0.5) p.run += dt;
      Qpumped += p.Q;
    }
    this.Qout = sol.Q;
    // баланс приямка: притоки − откачка (обратный ток через стоящий насос возвращается в приямок)
    var qin = st.inflow + (this.burst > 0 ? 30 : 0);
    if (this.burst > 0) this.burst -= 30 * dt / 3600;
    this.level += (qin - this.Qout) / 3600 / this.area() * dt;
    if (this.level > st.pit.depth) {
      this.flood += (this.level - st.pit.depth) * this.area();
      if (!this.flooded) { this.flooded = true; this.log("Приямок переполнен — вода выходит на пол!", "bad"); }
      this.level = st.pit.depth;
    } else if (this.level < st.pit.depth - 0.05) this.flooded = false;
    if (this.level < 0) this.level = 0;

    this.histT += dt;
    if (this.histT >= 0.5) {
      this.histT = 0;
      this.hist.push({ t: this.t, lvl: this.level, q: [this.p[0].Q, this.p[1].Q], Q: this.Qout, qin: qin });
      if (this.hist.length > 4000) this.hist.shift();
    }
  };

  Sim.prototype.setOn = function (i, on, why) {
    var p = this.p[i];
    if (p.on === on) return;
    p.on = on;
    if (on) { p.starts++; p.times.push(this.t); if (p.times.length > 300) p.times.shift(); }
    this.log("Насос " + (i + 1) + (on ? ": пуск" : ": стоп") + (why ? " — " + why : ""), "info");
  };
  Sim.prototype.startsPerHour = function (i) {
    var win = Math.min(this.t, 3600);
    if (win < 60) return 0;
    var n = 0; this.p[i].times.forEach(function (t) { if (t > this.t - win) n++; }, this);
    return n * 3600 / win;
  };

  /* Логика поплавков — как тип регулирования 4 у SK-712 */
  Sim.prototype.control = function (dt) {
    var st = this.st, lv = st.lv, c = st.ctrl, N = st.count, L = this.level, i;
    if (c.mode === "manual") {
      for (i = 0; i < 2; i++) this.setOn(i, i < N && !!c.manual[i] && !c.failed[i]);
      return;
    }
    var avail = [];
    for (i = 0; i < N; i++) { var k = (this.lead + i) % N; if (!c.failed[k]) avail.push(k); }
    if (!avail.length) return;
    var base = avail[0], peak = avail[1];

    if (L < lv.dry) {
      if (!this.dry) { this.dry = true; this.log("Сухой ход: уровень ниже нижнего поплавка — насосы заблокированы", "warn"); }
    } else if (this.dry && L > lv.off) this.dry = false;
    if (this.dry) { for (i = 0; i < 2; i++) this.setOn(i, false, "сухой ход"); return; }

    var anyOn = this.p[0].on || this.p[1].on;
    if (L <= lv.off && anyOn) {
      for (i = 0; i < 2; i++) this.setOn(i, false, "уровень " + U.fmt(L, 2) + " м ≤ «выкл»");
      if (c.alternate && N > 1) this.lead = (this.lead + 1) % N;
      this.peakOn = false;
      return;
    }
    if (L >= lv.on1 && !this.p[base].on) this.setOn(base, true, "поплавок «вкл 1»");
    var needPeak = (c.duty === "both" && L >= lv.on2) || L >= lv.alarm;
    if (peak !== undefined && needPeak && !this.p[peak].on) {
      this.setOn(peak, true, L >= lv.alarm ? "авария: верхний поплавок" : "поплавок «вкл 2»");
      if (L >= lv.alarm) this.log("Аварийный уровень " + U.fmt(L, 2) + " м — работают все насосы", "warn");
    }
  };

  /* ------------------------------------------------------------ сравнение режимов */
  function compare(st, zw) {
    var s = U.deepCopy(st);
    function run(layout, r) { s.layout = layout; return solve(s, zw, r); }
    var out = {};
    out.sep1 = run("separate", [1, 0]);
    out.sep2 = st.count > 1 ? run("separate", [1, 1]) : null;
    out.join1 = run("joint", [1, 0]);
    out.join2 = st.count > 1 ? run("joint", [1, 1]) : null;
    return out;
  }

  return { defaults: defaults, Sim: Sim, solve: solve, pumpModel: pumpModel, compare: compare, hBranch: hBranch, hCommon: hCommon, hSeparate: hSeparate, pipes: pipes };
})();

/* ================================================================ интерфейс вкладки */
var DrainUI = (function () {
  "use strict";
  var $ = U.$;
  var st, sim, form, active = false, last = 0, running = true, uiT = 0, anim = { off: {}, ang: [0, 0] };
  var refs = {}, key = "", geo = {}, lastEv = 0;
  var STORE = "pumplab.drain.v1";

  function sections() {
    var pumpOpts = DrainPumps.map(function (p) { return [p.id, p.name]; });
    var pipeOpts = Pipes.options();
    return [
      { title: "Насосы и управление", open: true, fields: [
        { k: "count", t: "select", l: "Насосов в приямке", num: true, opts: [[1, "1"], [2, "2"]] },
        { k: "pumps.0", t: "select", l: "Насос 1", opts: pumpOpts },
        { k: "pumps.1", t: "select", l: "Насос 2", opts: pumpOpts, show: function (s) { return s.count > 1; } },
        { k: "layout", t: "select", l: "Напорный трубопровод", opts: [["joint", "Совместный: ветки → один общий трубопровод"], ["separate", "Раздельный: у каждого насоса своя труба"]], show: function (s) { return s.count > 1; } },
        { k: "cv", t: "check", l: "Обратные клапаны на ветках", show: function (s) { return s.count > 1 && s.layout === "joint"; } },
        { k: "ctrl.mode", t: "select", l: "Управление", opts: [["auto", "Автомат по поплавкам (шкаф типа SK-712)"], ["manual", "Вручную"]] },
        { k: "ctrl.duty", t: "select", l: "Схема работы", opts: [["both", "Оба рабочие (второй — пиковый)"], ["standby", "1 рабочий + 1 резервный"]], show: function (s) { return s.count > 1 && s.ctrl.mode === "auto"; } },
        { t: "html", id: "drPumpBtns" },
        { k: "ctrl.alternate", t: "check", l: "Чередовать насосы после каждого цикла", show: function (s) { return s.count > 1 && s.ctrl.mode === "auto"; } }
      ] },
      { title: "Приток воды", open: true, fields: [
        { k: "inflow", t: "range", l: "Приток в приямок", u: "м³/ч", min: 0, max: 60, step: 0.5, hint: "Дренаж с трапов, протечки, вода после пожаротушения. Кнопка «Залп» над схемой добавит 30 м³/ч на время." }
      ] },
      { title: "Геометрия", open: true, fields: [
        { k: "zOut", t: "range", l: "Высота выпуска над дном приямка", u: "м", min: 1, max: 14, step: 0.1, hint: "Отметка оси трубы в колодце (гасителе напора) минус отметка дна приямка." },
        { k: "pit.depth", t: "range", l: "Глубина приямка", u: "м", min: 0.6, max: 3, step: 0.05, d: 2 },
        { k: "pit.L", t: "range", l: "Длина приямка", u: "м", min: 0.5, max: 4, step: 0.05, d: 2 },
        { k: "pit.W", t: "range", l: "Ширина приямка", u: "м", min: 0.5, max: 4, step: 0.05, d: 2 }
      ] },
      { title: "Трубопроводы (сталь, Шевелев)", open: true, fields: [
        { k: "pipe.branch", t: "select", l: "Ветка от насоса (до узла слияния)", opts: pipeOpts },
        { k: "pipe.Lb", t: "range", l: "Длина ветки", u: "м", min: 0.5, max: 20, step: 0.5 },
        { k: "pipe.zb", t: "range", l: "Σζ ветки (клапан ≈2, задвижка 0,3, отвод 0,5)", u: "", min: 0, max: 15, step: 0.1 },
        { k: "pipe.common", t: "select", l: "Общий трубопровод (раздельно — у каждого такой же)", opts: pipeOpts },
        { k: "pipe.Lc", t: "range", l: "Длина общего трубопровода", u: "м", min: 1, max: 200, step: 1, d: 0 },
        { k: "pipe.zc", t: "range", l: "Σζ общего (отводы + выход 1,0)", u: "", min: 0, max: 20, step: 0.1 },
        { k: "pipe.reserve", t: "range", l: "Запас на отложения (dр = dвн − запас)", u: "мм", min: 0, max: 3, step: 0.5 }
      ] },
      { title: "Уровни поплавков (от дна)", fields: [
        { k: "lv.alarm", t: "range", l: "Авария / включить все", u: "м", min: 0.3, max: 3, step: 0.05, d: 2 },
        { k: "lv.on2", t: "range", l: "Включить второй (пиковый)", u: "м", min: 0.3, max: 3, step: 0.05, d: 2 },
        { k: "lv.on1", t: "range", l: "Включить базовый", u: "м", min: 0.2, max: 3, step: 0.05, d: 2 },
        { k: "lv.off", t: "range", l: "Выключить", u: "м", min: 0.1, max: 2, step: 0.05, d: 2 },
        { k: "lv.dry", t: "range", l: "Сухой ход", u: "м", min: 0.05, max: 1, step: 0.05, d: 2 }
      ] }
    ];
  }

  /* ------------------------------------------------------------ схема */
  function layoutKey() { return [st.count, st.layout, st.zOut, st.pit.depth, st.pumps.join()].join("|"); }

  function build() {
    var host = $("drScheme");
    var W = 1140, H = 560, yb = 520;
    var s = Math.min(95, (yb - 60) / (st.zOut + 0.4));
    function y(z) { return yb - z * s; }
    var yTop = y(st.pit.depth), yOut = y(st.zOut), yh = Math.min(yTop - 70, yOut + 40);
    var xs = st.count === 1 ? [170] : [125, 230];
    geo = { s: s, y: y, yb: yb, yTop: yTop, yOut: yOut, yh: yh, xs: xs };
    function pipe(id, d) { return '<path class="pipe" id="db_' + id + '" d="' + d + '"/><path class="flow" id="df_' + id + '" d="' + d + '"/>'; }
    function txt(id, x, yy, cls, a, c) { return "<text" + (id ? ' id="' + id + '"' : "") + ' x="' + x + '" y="' + yy + '" class="' + (cls || "") + '" text-anchor="' + (a || "start") + '">' + (c || "") + "</text>"; }
    function bow(x, yy) { return '<g class="valve"><path d="M' + (x - 8) + " " + (yy - 7) + " L" + (x + 8) + " " + (yy + 7) + " L" + (x + 8) + " " + (yy - 7) + " L" + (x - 8) + " " + (yy + 7) + ' Z"/></g>'; }
    function check(id, x, yy) { return '<g class="check" id="' + id + '" transform="translate(' + x + "," + yy + ') rotate(-90)"><path class="cv-body" d="M-10 -8 L10 0 L-10 8 Z"/><line class="cv-bar" x1="10" y1="-9" x2="10" y2="9"/></g>'; }

    var sv = '<svg viewBox="0 0 ' + W + " " + H + '" class="scheme-svg">';
    // пол помещения и приямок
    sv += '<rect class="ground" x="0" y="' + yTop + '" width="460" height="' + (H - yTop) + '"/>';
    sv += '<rect class="pit" x="60" y="' + yTop + '" width="320" height="' + (yb - yTop) + '"/>';
    sv += '<rect class="pit-water" id="drWater" x="62" y="' + yb + '" width="316" height="0"/>';
    sv += txt(null, 66, yb + 16, "tiny muted", "start", "дно приямка — отметка 0");
    sv += txt(null, 8, yTop - 6, "tiny muted", "start", "пол");
    // приток
    sv += '<path class="pipe" d="M0 ' + (yTop - 26) + ' H96 V' + (yTop + 4) + '"/><path class="flow" id="df_in" d="M0 ' + (yTop - 26) + ' H96 V' + (yTop + 4) + '"/>';
    sv += '<line class="stream" id="drInStream" x1="96" y1="' + (yTop + 6) + '" x2="96" y2="' + yb + '"/>';
    sv += txt("drInT", 4, yTop - 34, "val", "start", "");
    // поплавки
    var names = [["alarm", "авария"], ["on2", "вкл 2"], ["on1", "вкл 1"], ["off", "выкл"], ["dry", "сух. ход"]];
    names.forEach(function (n, k) {
      var xf = 305 + k * 14;
      sv += '<line class="stem thin" x1="' + xf + '" y1="' + yTop + '" x2="' + xf + '" y2="' + y(st.lv[n[0]]) + '"/>';
      sv += '<ellipse class="float2" id="drF_' + n[0] + '" cx="' + xf + '" cy="' + y(st.lv[n[0]]) + '" rx="6" ry="9"/>';
      sv += '<line class="lvl-line" x1="' + (xf + 6) + '" x2="392" y1="' + y(st.lv[n[0]]) + '" y2="' + y(st.lv[n[0]]) + '"/>';
      sv += txt(null, 396, y(st.lv[n[0]]) + 4, "tiny", "start", n[1] + " " + U.fmt(st.lv[n[0]], 2));
    });
    // насосы и стояки
    xs.forEach(function (x, i) {
      sv += '<g class="spump" id="drP' + i + '" data-dpump="' + i + '"><rect x="' + (x - 22) + '" y="' + (yb - 78) + '" width="44" height="62" rx="6"/>' +
        '<rect class="foot" x="' + (x - 26) + '" y="' + (yb - 18) + '" width="52" height="14" rx="3"/>' +
        '<g id="drImp' + i + '"><circle class="imp-disc" cx="' + x + '" cy="' + (yb - 11) + '" r="6"/><line class="blade" x1="' + (x - 6) + '" y1="' + (yb - 11) + '" x2="' + (x + 6) + '" y2="' + (yb - 11) + '"/><line class="blade" x1="' + x + '" y1="' + (yb - 17) + '" x2="' + x + '" y2="' + (yb - 5) + '"/></g>' +
        '<circle class="pump-badge" cx="' + x + '" cy="' + (yb - 52) + '" r="9" style="fill:var(--p' + (i + 1) + ')"/>' + txt(null, x, yb - 48, "badge-t", "middle", String(i + 1)) +
        '<g class="failed-x" id="drFx' + i + '"><line x1="' + (x - 20) + '" y1="' + (yb - 76) + '" x2="' + (x + 20) + '" y2="' + (yb - 20) + '"/><line x1="' + (x + 20) + '" y1="' + (yb - 76) + '" x2="' + (x - 20) + '" y2="' + (yb - 20) + '"/></g></g>';
      var yri = st.layout === "separate" ? yh - 22 * i : yh;
      sv += pipe("r" + i, "M" + x + " " + (yb - 78) + " V" + yri);
      sv += check("drCv" + i, x, yTop - 18) + bow(x, yTop - 44);
      sv += '<rect class="lblbg" x="' + (x - 46) + '" y="' + (yb - 124) + '" width="92" height="34" rx="4"/>';
      sv += txt("drPl" + i, x, yb - 109, "val", "middle", "");
      sv += txt("drPlb" + i, x, yb - 95, "tiny", "middle", "");
    });
    var xUp = 720;
    if (st.layout === "separate" || st.count === 1) {
      xs.forEach(function (x, i) {
        var yri = yh - 22 * i, xu = xUp + 22 * i, yo = yOut - 16 * i;
        sv += pipe("c" + i, "M" + x + " " + yri + " H" + xu + " V" + yo + " H968");
      });
    } else {
      sv += pipe("h", "M" + xs[0] + " " + yh + " H" + xs[1]);
      sv += '<circle class="node" cx="' + xs[1] + '" cy="' + yh + '" r="4"/>';
      sv += pipe("c", "M" + xs[1] + " " + yh + " H" + xUp + " V" + yOut + " H968");
      sv += txt(null, xs[1] + 8, yh - 8, "tiny muted", "start", "узел слияния");
    }
    // колодец гасителя напора
    sv += '<rect class="well" x="968" y="' + (yOut - 40) + '" width="90" height="120" rx="3"/>';
    sv += '<line class="stream" id="drOutStream" x1="972" y1="' + (yOut + 2) + '" x2="972" y2="' + (yOut + 74) + '"/>';
    sv += '<path class="pipe" d="M1058 ' + (yOut + 66) + ' H1140"/>';
    sv += txt(null, 1013, yOut - 48, "tiny", "middle", "колодец / гаситель напора");
    sv += txt(null, 1136, yOut + 90, "tiny muted", "end", "самотёком в сеть К");
    // размерная линия геометрического напора
    sv += '<line class="dim" id="drDim" x1="880" x2="880" y1="' + yOut + '" y2="' + yb + '"/>';
    sv += '<line class="lvl-line" id="drDimLvl" x1="380" x2="890" y1="0" y2="0"/>';
    sv += '<line class="lvl-line" x1="860" x2="968" y1="' + yOut + '" y2="' + yOut + '"/>';
    sv += txt("drDimT", 888, (yOut + yb) / 2, "val", "start", "");
    sv += txt("drDimT2", 888, (yOut + yb) / 2 + 15, "tiny muted", "start", "");
    // подписи труб
    sv += txt("drPipeT", xUp - 8, yh + 18, "tiny muted", "end", "");
    sv += txt("drVT", xUp + 16, yOut - 26, "val", "start", "");
    // шкаф
    // шкаф — под напорными трубами, если есть место, иначе вверху
    var cy = yh + 24 + 118 < yb - 10 ? yh + 24 : 10;
    sv += '<g class="cabinet" transform="translate(0,' + (cy - 10) + ')"><rect x="420" y="10" width="290" height="118" rx="6"/>' + txt(null, 432, 28, "cap", "start", "Шкаф управления (поплавки)") +
      txt("drC1", 432, 46, "tiny", "start", "") + txt("drC2", 432, 62, "val", "start", "") + txt("drC3", 432, 78, "tiny", "start", "") + txt("drC4", 432, 94, "tiny", "start", "") + txt("drC5", 432, 112, "tiny strong", "start", "") + "</g>";
    sv += '<path class="wire" d="M420 ' + (cy + 60) + ' H400 V' + (yTop - 4) + '"/>';
    sv += "</svg>";
    host.innerHTML = sv;
    refs = {};
    Array.prototype.forEach.call(host.querySelectorAll("[id]"), function (e) { refs[e.id] = e; });
  }

  function flow(id, q, dt) {
    var f = refs["df_" + id]; if (!f) return;
    if (Math.abs(q) < 0.02) { f.style.opacity = 0; if (refs["db_" + id]) refs["db_" + id].style.stroke = ""; return; }
    f.style.opacity = 0.9;
    anim.off[id] = ((anim.off[id] || 0) - (q > 0 ? 1 : -1) * (12 + 14 * Math.sqrt(Math.abs(q))) * dt) % 1600;
    f.setAttribute("stroke-dashoffset", anim.off[id].toFixed(1));
    var b = refs["db_" + id]; if (b) b.style.stroke = q < 0 ? U.css("--warn-hex") : U.mix(U.css("--pipe-lo"), U.css("--pipe-hi"), 0.65);
  }
  function setT(id, s) { var e = refs[id]; if (e && e.textContent !== s) e.textContent = s; }

  function drawScheme(dt) {
    var k = layoutKey(); if (k !== key) { key = k; build(); }
    var g = geo, L = sim.level;
    var wy = g.y(L);
    refs.drWater.setAttribute("y", wy.toFixed(1)); refs.drWater.setAttribute("height", Math.max(0, g.yb - wy).toFixed(1));
    ["alarm", "on2", "on1", "off", "dry"].forEach(function (n) { refs["drF_" + n].setAttribute("class", "float2" + (L >= st.lv[n] ? " up" : "")); });
    var qin = st.inflow + (sim.burst > 0 ? 30 : 0);
    flow("in", qin, dt);
    refs.drInStream.style.opacity = qin > 0.05 ? 1 : 0;
    refs.drInStream.setAttribute("y2", wy.toFixed(1));
    anim.inOff = ((anim.inOff || 0) - 60 * dt) % 400; refs.drInStream.setAttribute("stroke-dashoffset", anim.inOff.toFixed(1));
    setT("drInT", "приток " + U.fmt(qin, 1) + " м³/ч");
    var P = Drain.pipes(st);
    for (var i = 0; i < st.count; i++) {
      var p = sim.p[i];
      flow("r" + i, p.Q, dt);
      anim.ang[i] = (anim.ang[i] + p.r * 900 * dt) % 360;
      var im = refs["drImp" + i]; if (im) im.setAttribute("transform", "rotate(" + anim.ang[i].toFixed(0) + " " + g.xs[i] + " " + (g.yb - 11) + ")");
      refs["drP" + i].setAttribute("class", "spump" + (p.r > 0.05 ? " run" : "") + (st.ctrl.failed[i] ? " failed" : ""));
      refs["drFx" + i].style.display = st.ctrl.failed[i] ? "" : "none";
      refs["drCv" + i].setAttribute("class", "check" + (p.Q > 0.02 ? " open" : (p.r > 0.05 ? " shut-run" : "")) + (st.layout === "joint" && !st.cv && st.count > 1 ? " none" : ""));
      setT("drPl" + i, p.r > 0.05 ? U.fmt(p.Q, 1) + " м³/ч" : (p.Q < -0.02 ? "назад " + U.fmt(-p.Q, 1) + " м³/ч" : "стоит"));
      setT("drPlb" + i, p.r > 0.05 ? "H = " + U.fmt(p.H, 1) + " м" : (p.Q < -0.02 ? "обратный ток!" : ""));
      if (st.layout === "separate" || st.count === 1) flow("c" + i, p.Q, dt);
    }
    if (st.layout === "joint" && st.count > 1) { flow("h", sim.p[0].Q, dt); flow("c", sim.Qout, dt); }
    refs.drOutStream.style.opacity = sim.Qout > 0.05 ? 1 : 0;
    anim.oOff = ((anim.oOff || 0) - 60 * dt) % 400; refs.drOutStream.setAttribute("stroke-dashoffset", anim.oOff.toFixed(1));
    refs.drDimLvl.setAttribute("y1", wy.toFixed(1)); refs.drDimLvl.setAttribute("y2", wy.toFixed(1));
    refs.drDim.setAttribute("y2", wy.toFixed(1));
    setT("drDimT", "Hгеом = " + U.fmt(st.zOut - L, 2) + " м");
    setT("drDimT2", U.fmt(st.zOut, 2) + " − уровень " + U.fmt(L, 2));
    var pc = P.pc, pb = P.pb;
    setT("drPipeT", (st.layout === "joint" && st.count > 1 ? "общий " : "") + Pipes.label(pc) + ", L = " + U.fmt(st.pipe.Lc, 0) + " м");
    var Vc = Pipes.velocity(st.layout === "joint" && st.count > 1 ? sim.Qout : Math.max(sim.p[0].Q, sim.p[1].Q), pc.dIn - st.pipe.reserve);
    setT("drVT", sim.Qout > 0.05 ? "V = " + U.fmt(Vc, 2) + " м/с" : "");
    var c = st.ctrl;
    setT("drC1", c.mode === "auto" ? "Автомат · " + (st.count > 1 ? (c.duty === "both" ? "2 рабочих" : "1 раб. + 1 рез.") : "1 насос") : "Ручной режим");
    setT("drC2", "Уровень " + U.fmt(L, 2) + " м · откачка " + U.fmt(sim.Qout, 1) + " м³/ч");
    setT("drC3", "Базовый: насос " + (sim.lead + 1) + " · пусков: " + sim.p.slice(0, st.count).map(function (p) { return p.starts; }).join(" / "));
    var up = ["dry", "off", "on1", "on2", "alarm"].filter(function (n) { return L >= st.lv[n]; }).length;
    setT("drC4", "Поплавков в воде: " + up + " из 5");
    var stTxt = sim.flooded ? "ЗАТОПЛЕНИЕ" : (L >= st.lv.alarm ? "АВАРИЙНЫЙ УРОВЕНЬ" : (sim.dry ? "Сухой ход — блокировка" : (sim.p[0].on || sim.p[1].on ? "Откачка" : "Ожидание: приямок наполняется")));
    setT("drC5", stTxt);
    refs.drC5.setAttribute("class", "tiny strong" + (sim.flooded || L >= st.lv.alarm ? " bad" : ""));
  }

  /* ------------------------------------------------------------ график Q–H */
  function drawQH() {
    var fc = U.fitCanvas($("drQH")), ctx = fc.ctx, N = st.count;
    var m = [Drain.pumpModel(st.pumps[0]), Drain.pumpModel(st.pumps[1])];
    var P = Drain.pipes(st), zw = sim.level, joint = st.layout === "joint" && N > 1;
    var qz = Math.max(m[0].H.qZero, N > 1 ? m[1].H.qZero : 0);
    var xMax = Plot.niceMax(qz * (joint ? 1.7 : 1.05));
    var yMax = Plot.niceMax(Math.max(m[0].H0, N > 1 ? m[1].H0 : 0, st.zOut + 1) * 1.15);
    var p = Plot.frame(ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, м³/ч", yLabel: "Напор над уровнем воды, м" });
    Plot.clip(p);
    var qs = []; for (var i = 0; i <= 120; i++) qs.push(xMax * i / 120);
    function sysAt(z, sep) { return qs.map(function (q) { return [q, st.zOut - z + (sep ? Drain.hSeparate(st, P, q) : Drain.hCommon(st, P, q))]; }); }
    // полоса: сеть при уровне «выкл» и «вкл 2» — туда-сюда ходит точка за цикл
    var sep = !joint;
    Plot.fillBetween(p, sysAt(st.lv.off, sep), sysAt(Math.max(st.lv.on2, st.lv.on1), sep), U.css("--water"), 0.1);
    Plot.line(p, sysAt(st.lv.off, sep), { color: U.css("--water"), width: 1, dash: [4, 4] });
    Plot.line(p, sysAt(Math.max(st.lv.on2, st.lv.on1), sep), { color: U.css("--water"), width: 1, dash: [4, 4] });
    Plot.line(p, sysAt(zw, sep), { color: U.css("--water"), width: 2.4 });
    for (i = 0; i < N; i++) {
      var col = U.css("--p" + (i + 1));
      Plot.line(p, qs.map(function (q) { var h = m[i].H(q); return h > 0 && q <= m[i].H.qLast ? [q, h] : null; }), { color: col, width: 2 });
      Plot.line(p, qs.map(function (q) { var h = m[i].H(q); return h > 0 && q >= m[i].H.qLast ? [q, h] : null; }), { color: col, width: 1, dash: [2, 3] });
      m[i].def.H.forEach(function (pt) { Plot.dot(p, pt[0], pt[1], 2.5, col); });
      if (joint) Plot.line(p, qs.map(function (q) { var h = m[i].H(q) - Drain.hBranch(st, P, q); return h > 0 ? [q, h] : null; }), { color: col, width: 1, dash: [6, 3] });
    }
    if (joint) {
      // совместная кривая насосов, приведённая к узлу слияния
      var comb = [];
      var Hmax = Math.max(m[0].H0, m[1].H0);
      for (var k = 0; k <= 100; k++) {
        var h = Hmax * (1 - k / 100);
        var qt = 0;
        for (i = 0; i < 2; i++) {
          if (m[i].H0 - 0 <= h) continue;
          qt += U.bisect(function (q) { return m[i].H(q) - Drain.hBranch(st, P, q) - h; }, 0, m[i].H.qZero, 30);
        }
        comb.push([qt, h]);
      }
      Plot.line(p, comb, { color: U.css("--accent"), width: 3 });
    }
    // точки
    var s = sim.sol || { q: [0, 0], E: 0, Q: 0 };
    for (i = 0; i < N; i++) if (sim.p[i].r > 0.05 && sim.p[i].Q > 0) Plot.dot(p, sim.p[i].Q, sim.p[i].H, 5, U.css("--p" + (i + 1)), U.css("--panel"), 1.5);
    if (joint && sim.Qout > 0.02) Plot.dot(p, sim.Qout, s.E - zw, 6.5, U.css("--accent"), U.css("--panel"), 2);
    if (!joint) for (i = 0; i < N; i++) if (sim.p[i].Q > 0.02) Plot.dot(p, sim.p[i].Q, st.zOut - zw + Drain.hSeparate(st, P, sim.p[i].Q), 7, null, U.css("--water"), 2);
    if (joint && sim.Qout > 0.02) Plot.dot(p, sim.Qout, st.zOut - zw + Drain.hCommon(st, P, sim.Qout), 8, null, U.css("--water"), 2);
    // след
    var hh = sim.hist.slice(-240);
    ctx.save(); ctx.strokeStyle = U.css("--accent"); ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.beginPath();
    var started = false;
    hh.forEach(function (d) {
      if (d.Q < 0.05) { started = false; return; }
      var qx = sep ? Math.max(d.q[0], d.q[1]) : d.Q;
      var yv = st.zOut - d.lvl + (sep ? Drain.hSeparate(st, P, qx) : Drain.hCommon(st, P, qx));
      var X = p.X(qx), Y = p.Y(yv);
      if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
    });
    ctx.stroke(); ctx.restore();
    Plot.unclip(p);
    Plot.legend(p, [
      { text: "насос по листу (точки — снято с листа)", color: U.css("--p1"), width: 2 },
      joint ? { text: "насос минус потери ветки", color: U.css("--p1"), dash: [6, 3] } : null,
      joint ? { text: "насосы вместе (у узла)", color: U.css("--accent"), width: 3 } : null,
      { text: "трубопровод сейчас", color: U.css("--water"), width: 2.4 },
      { text: "при уровнях «выкл» и «вкл»", color: U.css("--water"), dash: [4, 4] }
    ].filter(Boolean));
  }

  /* ------------------------------------------------------------ осциллограф */
  function drawTrend() {
    var fc = U.fitCanvas($("drTrend")), ctx = fc.ctx, w = fc.w, h = fc.h;
    ctx.clearRect(0, 0, w, h);
    var win = Math.max(300, Math.min(3600, st.speed * 120));
    var t1 = Math.max(sim.t, win), t0 = t1 - win;
    var data = sim.hist.filter(function (d) { return d.t >= t0; });
    var half = (h - 24) / 2;
    function lane(T, B, y0, y1, name) {
      var p = { ctx: ctx, L: 44, R: w - 10, T: T, B: B, x0: t0, x1: t1, y0: y0, y1: y1 };
      p.X = function (x) { return p.L + (x - p.x0) / (p.x1 - p.x0) * (p.R - p.L); };
      p.Y = function (v) { return p.B - (v - p.y0) / (p.y1 - p.y0) * (p.B - p.T); };
      ctx.strokeStyle = U.css("--axis"); ctx.lineWidth = 1; ctx.strokeRect(p.L + 0.5, p.T + 0.5, p.R - p.L, p.B - p.T);
      ctx.fillStyle = U.css("--muted"); ctx.font = "10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      var s = U.niceStep(y1 - y0, 4);
      for (var v = Math.ceil(y0 / s) * s; v <= y1 + 1e-9; v += s) ctx.fillText(U.fmt(v, s < 1 ? 1 : 0), p.L - 4, p.Y(v));
      ctx.fillStyle = U.css("--ink"); ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "600 10.5px system-ui, Segoe UI, sans-serif"; ctx.fillText(name, p.L + 5, p.T + 3);
      return p;
    }
    var p1 = lane(4, 4 + half, 0, st.pit.depth, "Уровень в приямке, м");
    Plot.clip(p1);
    ["dry", "off", "on1", "on2", "alarm"].forEach(function (n) { Plot.line(p1, [[t0, st.lv[n]], [t1, st.lv[n]]], { color: U.css("--bad"), width: 0.8, dash: [3, 3], alpha: 0.6 }); });
    Plot.line(p1, data.map(function (d) { return [d.t, d.lvl]; }), { color: U.css("--water"), width: 2 });
    Plot.unclip(p1);
    var qmax = 5; data.forEach(function (d) { qmax = Math.max(qmax, d.Q, d.qin); });
    var p2 = lane(10 + half, 10 + 2 * half - 6, 0, Plot.niceMax(qmax * 1.15), "Расход, м³/ч: приток / откачка / насосы");
    Plot.clip(p2);
    Plot.line(p2, data.map(function (d) { return [d.t, d.qin]; }), { color: U.css("--muted"), width: 1.4, dash: [5, 3] });
    for (var i = 0; i < st.count; i++) (function (i) { Plot.line(p2, data.map(function (d) { return [d.t, d.q[i]]; }), { color: U.css("--p" + (i + 1)), width: 1.2 }); })(i);
    Plot.line(p2, data.map(function (d) { return [d.t, d.Q]; }), { color: U.css("--accent"), width: 2 });
    Plot.unclip(p2);
    ctx.fillStyle = U.css("--muted"); ctx.font = "10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    var ts = U.niceStep(win, 6);
    for (var t = Math.ceil(t0 / ts) * ts; t <= t1; t += ts) ctx.fillText(t >= 120 ? U.fmt(t / 60, 0) + " мин" : U.fmt(t, 0) + " с", p2.X(t), p2.B + 3);
  }

  /* ------------------------------------------------------------ расчёт и сравнение */
  function info() {
    var P = Drain.pipes(st), N = st.count, joint = st.layout === "joint" && N > 1, s = "", i;
    function row(a, b, cls) { s += '<div class="rd' + (cls ? " " + cls : "") + '"><span>' + a + "</span><b>" + b + "</b></div>"; }
    row("Уровень / Hгеом", U.fmt(sim.level, 2) + " м / " + U.fmt(st.zOut - sim.level, 2) + " м");
    row("Приток / откачка", U.fmt(st.inflow, 1) + " / " + U.fmt(sim.Qout, 2) + " м³/ч");
    for (i = 0; i < N; i++) {
      var p = sim.p[i], m = Drain.pumpModel(st.pumps[i]);
      var eta = p.P1 > 0.01 && p.Q > 0 ? 1000 * 9.81 * p.Q / 3600 * p.H / 1000 / p.P1 : 0;
      row("Насос " + (i + 1) + " — " + m.def.name, p.r > 0.05 ? U.fmt(p.Q, 2) + " м³/ч · " + U.fmt(p.H, 2) + " м · P1 " + U.fmt(p.P1, 2) + " кВт · η " + U.fmt(eta * 100, 0) + "%" : "стоит", "p" + (i + 1));
      var sph = sim.startsPerHour(i);
      row("", "пусков " + p.starts + (sim.t > 60 ? " · ≈ " + U.fmt(sph, 0) + " в час" : "") + (m.def.starts ? " (допустимо " + m.def.starts + ")" : "") + " · в работе " + U.fmt(p.run / 60, 1) + " мин", "sub");
      if (p.Q > m.H.qLast) row("", "точка правее конца кривой по листу — вне рабочего поля", "sub bad");
    }
    // разбор потерь в текущей точке
    s += '<table class="loss"><tr><th>Участок</th><th>Q, м³/ч</th><th>dр, мм</th><th>V, м/с</th><th>λ</th><th>1000i</th><th>hдл, м</th><th>hм, м</th></tr>';
    function lrow(name, q, pipe, L, z) {
      var r = Pipes.shevelev(Math.max(q, 0), pipe, L, z, st.pipe.reserve);
      s += "<tr><td>" + name + "</td><td>" + U.fmt(q, 2) + "</td><td>" + U.fmt(r.d, 1) + "</td><td" + (q > 0.05 && r.V < 0.7 ? ' class="bad"' : "") + ">" + U.fmt(r.V, 2) + "</td><td>" + U.fmt(r.lambda, 4) + "</td><td>" + U.fmt(r.i1000, 1) + "</td><td>" + U.fmt(r.hl, 2) + "</td><td>" + U.fmt(r.hm, 2) + "</td></tr>";
      return r;
    }
    var vmin = 99;
    if (joint) {
      for (i = 0; i < N; i++) lrow("ветка " + (i + 1) + ", " + Pipes.label(P.pb) + ", " + U.fmt(st.pipe.Lb, 1) + " м", sim.p[i].Q, P.pb, st.pipe.Lb, st.pipe.zb);
      var rc = lrow("общий, " + Pipes.label(P.pc) + ", " + U.fmt(st.pipe.Lc, 0) + " м", sim.Qout, P.pc, st.pipe.Lc, st.pipe.zc);
      if (sim.Qout > 0.05) vmin = rc.V;
    } else {
      for (i = 0; i < N; i++) {
        lrow("линия " + (i + 1) + ": ветка", sim.p[i].Q, P.pb, st.pipe.Lb, st.pipe.zb);
        var rr = lrow("линия " + (i + 1) + ": труба " + Pipes.label(P.pc), sim.p[i].Q, P.pc, st.pipe.Lc, st.pipe.zc);
        if (sim.p[i].Q > 0.05) vmin = Math.min(vmin, rr.V);
      }
    }
    s += "</table>";
    var notes = [];
    if (vmin < 0.7) notes.push('<li class="warn">Скорость в напорной трубе ' + U.fmt(vmin, 2) + " м/с — меньше ~0,7 м/с: с песком и грязью труба будет заиливаться. Уменьшите диаметр.</li>");
    if (vmin > 3 && vmin < 99) notes.push('<li class="warn">Скорость ' + U.fmt(vmin, 2) + " м/с — большие потери и шум. Увеличьте диаметр.</li>");
    var anyRun = sim.p[0].r > 0.5 || sim.p[1].r > 0.5;
    if (anyRun && sim.Qout < 0.02) notes.push('<li class="bad">Насос работает, а воды нет: напор при Q = 0 меньше геометрической высоты подъёма ' + U.fmt(st.zOut - sim.level, 2) + " м.</li>");
    var cyc = cycleInfo();
    if (cyc) notes.push("<li>" + cyc + "</li>");
    if (joint && !st.cv && (sim.p[0].Q < -0.02 || sim.p[1].Q < -0.02)) notes.push('<li class="bad">Без обратного клапана вода из общего трубопровода уходит через стоящий насос обратно в приямок — работающий насос качает по кругу.</li>');
    s += notes.length ? '<ul class="notes">' + notes.join("") + "</ul>" : "";
    $("drInfo").innerHTML = s;
  }

  function cycleInfo() {
    var A = sim.area(), V = A * (st.lv.on1 - st.lv.off), q = st.inflow;
    var sol = Drain.solve(st, (st.lv.on1 + st.lv.off) / 2, [1, 0]);
    var Q = sol.Q;
    if (!(Q > 0) || q <= 0) return "";
    if (q >= Q) return "Приток " + U.fmt(q, 1) + " м³/ч больше, чем один насос откачивает (" + U.fmt(Q, 1) + " м³/ч): уровень дойдёт до «вкл 2» или аварии.";
    var tc = V / q + V / (Q - q);
    return "Цикл одного насоса: рабочий объём между «вкл 1» и «выкл» " + U.fmt(V * 1000, 0) + " л, наполнение " + U.fmt(V / q * 60, 1) + " мин + откачка " + U.fmt(V / (Q - q) * 60, 1) + " мин = " + U.fmt(tc * 60, 1) + " мин → " + U.fmt(1 / tc, 0) + " пусков в час" + (st.count > 1 && st.ctrl.alternate ? " на установку (на каждый насос вдвое меньше)" : "") + ". Хуже всего при притоке = Q/2: " + U.fmt(Q / (4 * V), 0) + " пусков/ч.";
  }

  function compareBlock() {
    if (st.count < 2) { $("drCompare").innerHTML = '<p class="muted">Сравнение раздельной и совместной работы — для двух насосов.</p>'; return; }
    var c = Drain.compare(st, sim.level);
    var P = Drain.pipes(st);
    function V(q, pipe) { return U.fmt(Pipes.velocity(q, pipe.dIn - st.pipe.reserve), 2); }
    var gainSep = c.sep1.Q > 0 ? (c.sep2.Q / c.sep1.Q - 1) * 100 : 0, gainJ = c.join1.Q > 0 ? (c.join2.Q / c.join1.Q - 1) * 100 : 0;
    $("drCompare").innerHTML =
      '<table class="loss"><tr><th></th><th>Один насос</th><th>Два насоса</th><th>Прибавка от второго</th></tr>' +
      "<tr><td>Раздельно (у каждого своя " + Pipes.label(P.pc) + ")</td><td>" + U.fmt(c.sep1.Q, 2) + " м³/ч, V " + V(c.sep1.Q, P.pc) + "</td><td>" + U.fmt(c.sep2.Q, 2) + " м³/ч (" + U.fmt(c.sep2.q[0], 1) + " + " + U.fmt(c.sep2.q[1], 1) + ")</td><td>+" + U.fmt(gainSep, 0) + "%</td></tr>" +
      "<tr><td>Совместно в общий " + Pipes.label(P.pc) + "</td><td>" + U.fmt(c.join1.Q, 2) + " м³/ч, V " + V(c.join1.Q, P.pc) + "</td><td>" + U.fmt(c.join2.Q, 2) + " м³/ч (" + U.fmt(c.join2.q[0], 1) + " + " + U.fmt(c.join2.q[1], 1) + "), V " + V(c.join2.Q, P.pc) + "</td><td>+" + U.fmt(gainJ, 0) + "%</td></tr></table>" +
      '<p class="small muted">При уровне ' + U.fmt(sim.level, 2) + " м. Раздельно второй насос почти удваивает откачку — трубы у насосов независимы. В общий трубопровод потери растут как Q², точка съезжает вверх по кривым, и второй насос добавляет меньше. Чем тоньше и длиннее общий трубопровод и чем больше доля потерь по сравнению с геометрическим подъёмом, тем меньше прибавка.</p>";
  }

  function logUpd() {
    var ev = sim.events; if (!ev.length || ev[ev.length - 1].id === lastEv) return;
    lastEv = ev[ev.length - 1].id;
    var s = "";
    for (var i = ev.length - 1; i >= Math.max(0, ev.length - 40); i--) s += '<li class="' + ev[i].level + '"><span>' + (ev[i].t >= 120 ? U.fmt(ev[i].t / 60, 1) + " мин" : U.fmt(ev[i].t, 0) + " с") + "</span>" + ev[i].text + "</li>";
    $("drLog").innerHTML = s;
  }

  function pumpButtons() {
    var box = $("drPumpBtns"); if (!box) return;
    var man = st.ctrl.mode === "manual", s = "";
    for (var i = 0; i < st.count; i++) s += '<div class="prow"><span class="pdot" style="background:var(--p' + (i + 1) + ')"></span><b>Насос ' + (i + 1) + "</b>" +
      (man ? '<button type="button" class="tgl' + (st.ctrl.manual[i] ? " on" : "") + '" data-dman="' + i + '">' + (st.ctrl.manual[i] ? "работает" : "стоит") + "</button>" : '<span class="muted small">по поплавкам</span>') +
      '<label class="fail"><input type="checkbox" data-dfail="' + i + '"' + (st.ctrl.failed[i] ? " checked" : "") + "> авария</label></div>";
    if (box.innerHTML !== s) box.innerHTML = s;
  }

  /* ------------------------------------------------------------ цикл */
  function tick(real) {
    var simDt = running ? real * st.speed : 0;
    var h = 0.05, n = Math.min(2000, Math.round(simDt / h)), t0 = performance.now();
    for (var k = 0; k < n; k++) { sim.step(h); if (performance.now() - t0 > 25) break; }
    drawScheme(running ? real * Math.min(st.speed, 3) : 0);
    drawQH(); drawTrend();
    uiT += real;
    if (uiT > 0.3) { uiT = 0; info(); compareBlock(); logUpd(); pumpButtons(); $("drClock").textContent = sim.t >= 120 ? U.fmt(sim.t / 60, 1) + " мин" : U.fmt(sim.t, 1) + " с"; }
  }
  function frame(ts) {
    if (!active) return;
    requestAnimationFrame(frame);
    var real = last ? Math.min(0.1, (ts - last) / 1000) : 0.016; last = ts;
    tick(real);
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* не важно */ } }

  function init() {
    st = Drain.defaults();
    try { var o = JSON.parse(localStorage.getItem(STORE) || "null"); if (o && o.pipe && o.lv) st = U.merge(st, o); } catch (e) { /* по умолчанию */ }
    sim = new Drain.Sim(st);
    form = Form.build($("drSide"), sections(), function () { return st; }, function (k) {
      if (k === "ctrl.mode") st.ctrl.manual = [sim.p[0].on, sim.p[1].on];
      save(); pumpButtons();
    });
    var foot = U.el("div", { "class": "side-foot" }); foot.innerHTML = '<button type="button" id="drDefaults">Всё по умолчанию</button>'; $("drSide").appendChild(foot);
    $("drDefaults").addEventListener("click", function () { st = Drain.defaults(); sim.st = st; sim.reset(); key = ""; form = Form.build($("drSide"), sections(), function () { return st; }, function () { save(); pumpButtons(); }); $("drSide").appendChild(foot); save(); });
    $("drSide").addEventListener("click", function (e) {
      var b = e.target.closest("[data-dman]"); if (b) { var i = +b.getAttribute("data-dman"); st.ctrl.manual[i] = !st.ctrl.manual[i]; pumpButtons(); save(); }
    });
    $("drSide").addEventListener("change", function (e) { var f = e.target.getAttribute("data-dfail"); if (f !== null) { st.ctrl.failed[+f] = e.target.checked; save(); } });
    $("drScheme").addEventListener("click", function (e) {
      var t = e.target.closest("[data-dpump]"); if (!t) return;
      var i = +t.getAttribute("data-dpump");
      if (st.ctrl.mode === "manual") st.ctrl.manual[i] = !st.ctrl.manual[i]; else st.ctrl.failed[i] = !st.ctrl.failed[i];
      pumpButtons(); save();
    });
    $("drRun").addEventListener("click", function () { running = !running; this.textContent = running ? "⏸ Пауза" : "▶ Пуск"; });
    $("drReset").addEventListener("click", function () { sim.reset(); lastEv = 0; $("drLog").innerHTML = ""; });
    $("drBurst").addEventListener("click", function () { sim.burst += 1; sim.log("Залп: +1 м³ воды за 2 минуты (30 м³/ч)", "info"); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-drspeed]"), function (b) {
      b.addEventListener("click", function () {
        st.speed = +b.getAttribute("data-drspeed"); save();
        Array.prototype.forEach.call(document.querySelectorAll("[data-drspeed]"), function (x) { x.classList.toggle("on", x === b); });
      });
      b.classList.toggle("on", +b.getAttribute("data-drspeed") === st.speed);
    });
    pumpButtons();
    window.DrainLab = { get sim() { return sim; }, get st() { return st; }, advance: function (sec) { var n = Math.round(sec / 0.05); for (var k = 0; k < n; k++) sim.step(0.05); var r = running; running = false; tick(0.02); uiT = 1; tick(0); running = r; return sim.t; } };
  }
  function start() { if (active) return; active = true; last = 0; key = ""; requestAnimationFrame(frame); }
  function stop() { active = false; }
  return { init: init, start: start, stop: stop };
})();
