/* Модель насосной установки повышения давления.

   Все напоры — в метрах водяного столба относительно оси насосов (манометрические).
   Расходы в интерфейсе и в модели — м³/ч; в теплоте и мощности переводим в м³/с.

   Гидравлика квазистатическая: течение в насосах и трубах устанавливается мгновенно,
   а «память» системы — только объём воды, запасённый в мембранном баке и в упругости
   труб. Поэтому давление в коллекторе Hn — единственная гидравлическая переменная
   состояния, и шаг по времени делается неявно (устойчив при любой жёсткости). */

var Pump = (function () {
  "use strict";
  var G = 9.81, RHO = 1000;

  /* Кривая насоса при номинальной частоте:  H(Q) = H0 + A·Q − B·Q².
     При частоте f (r = f/fном) по законам подобия:  H(Q, r) = H0·r² + A·Q·r − B·Q².
     A > 0 даёт «горб» — нестабильную кривую (пособие Wilo, с. 21).
     Мощность на валу  P(Q, r) = P0·r³ + kP·Q·r²  — тоже подчиняется законам подобия. */
  function coef(p) {
    var A = p.hump * p.H0 / p.Qopt;
    var B = (p.H0 + A * p.Qopt - p.Hopt) / (p.Qopt * p.Qopt);
    if (!(B > 1e-5)) B = 1e-5;
    var Popt = RHO * G * (p.Qopt / 3600) * p.Hopt / p.etaMax / 1000;
    var P0 = p.p0ratio * Popt;
    var kP = (Popt - P0) / p.Qopt;
    return { A: A, B: B, Popt: Popt, P0: P0, kP: kP };
  }

  function head(p, c, Q, r) { return p.H0 * r * r + c.A * Q * r - c.B * Q * Q; }
  function power(p, c, Q, r) { if (r <= 0) return 0; return c.P0 * r * r * r + c.kP * Math.max(0, Q) * r * r; }
  function hydPower(Q, H) { return RHO * G * (Math.max(0, Q) / 3600) * Math.max(0, H) / 1000; }
  function eta(p, c, Q, r) {
    if (r <= 0 || Q <= 0) return 0;
    var H = head(p, c, Q, r);
    if (H <= 0) return 0;
    return hydPower(Q, H) / power(p, c, Q, r);
  }
  function npshr(p, Q, r) { return r * r * p.npsh0 + (p.npshOpt - p.npsh0) * Math.pow(Math.max(0, Q) / p.Qopt, 2); }
  /* Подача при H = 0 (правый конец кривой). */
  function qMax(p, c, r) { return r * (c.A + Math.sqrt(c.A * c.A + 4 * c.B * p.H0)) / (2 * c.B); }
  /* Вершина кривой (для горбатой кривой — максимум напора). */
  function peak(p, c, r) {
    if (c.A <= 0) return { Q: 0, H: p.H0 * r * r };
    var Q = c.A * r / (2 * c.B);
    return { Q: Q, H: head(p, c, Q, r) };
  }

  return { coef: coef, head: head, power: power, hydPower: hydPower, eta: eta, npshr: npshr, qMax: qMax, peak: peak, G: G, RHO: RHO };
})();

var Model = (function () {
  "use strict";
  var HATM = 10.33, CW = 4186, MAXP = 3;

  function defaults() {
    return {
      pumpCount: 2,
      pump: {
        H0: 58, Qopt: 6, Hopt: 46, hump: 0, etaMax: 0.66, p0ratio: 0.38,
        npsh0: 0.8, npshOpt: 2.0, fNom: 50, rpmNom: 2900,
        dhPV: 0.8, waterMass: 3, heatLoss: 5, etaMotor: 0.86
      },
      vfd: { fMin: 25, fMax: 50, ramp: 3 },
      source: {
        type: "main", Hmain: 25, fluct: "none", fluctAmp: 8, fluctPeriod: 40,
        dHin: 2, Qref: 12,
        tankZ: 0.5, tankH: 2.0, tankArea: 1.5, level0: 1.6, levelSet: 1.7, floatQ: 12, levelMin: 0.3,
        loop: true, Tin: 10, Tamb: 20
      },
      net: { Qref: 12, dhPipe: 6, valveOpen: 1, valveKvs: 60, tankOn: true, tankV: 24, tankPre: 50, Cpipe: 0.02 },
      taps: [
        { name: "1–3 этаж", z: 6, kv: 1.6, open: 1, on: false },
        { name: "4–6 этаж", z: 15, kv: 1.6, open: 1, on: false },
        { name: "7–9 этаж", z: 24, kv: 1.6, open: 1, on: false },
        { name: "10–12 этаж", z: 33, kv: 1.6, open: 1, on: false },
        { name: "Утечка", z: 33, kv: 0.08, open: 1, on: false }
      ],
      needFree: 10,
      auto: { on: false, level: 0.45, period: 10 },
      ctrl: {
        mode: "vfd1", Hset: 60, Kp: 0.8, Ti: 1.0,
        fManual: 50, manualOn: [true, false, false], failed: [false, false, false],
        relayOn: 52, relayOff: 64, relayStep: 3, afterRun: 0, minRun: 2,
        addDH: 2, remDH: 4, addDelay: 3, remDelay: 5, fAdd: 48, fRem: 33,
        sleep: true, sleepQ: 0.4, sleepDelay: 8, boost: 3, wake: 5,
        dryProt: true, dryH: 10, sensorTau: 0.3, alternate: true
      }
    };
  }

  var MODES = {
    manualDol: "Ручной: прямой пуск, без ПЧ",
    manualVfd: "Ручной: ПЧ, частоту задаю сам",
    relay: "Автомат без ПЧ: реле давления (каскад)",
    vfd1: "Автомат: ПЧ на ведущем + пиковые без ПЧ",
    vfdAll: "Автомат: ПЧ на каждом насосе"
  };

  function Sim(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  Sim.prototype.reset = function () {
    var cfg = this.cfg;
    this.t = 0;
    this.pumps = [];
    for (var i = 0; i < MAXP; i++) {
      this.pumps.push({
        on: false, drive: "dol", f: 0, fCmd: cfg.vfd.fMin, Q: 0, H: 0, P: 0, Pel: 0, eta: 0,
        T: cfg.source.Tin, cav: 1, cavStage: 0, npshA: 0, npshR: 0, starts: 0, startTimes: [],
        tOn: -1e9, tOff: -1e9, runTime: 0, afterT: null, cvClosedT: 0, cvLogged: false, t60: false, t90: false
      });
    }
    this.lead = 0;
    this.state = "run";           // run | boost | sleep
    this.u = cfg.vfd.fMin;        // выход ПИ-регулятора, Гц
    this.ePrev = 0;
    this.piT = 0;
    this.addT = 0; this.remT = 0; this.sleepT = 0; this.boostT = 0;
    this.dry = false; this.dryT = 0;
    this.level = cfg.source.level0;
    this.HinRaw = this.inletRaw(0);
    this.Hin = this.HinRaw;
    this.Hn = Math.max(this.Hin, 0);
    this.Hmeas = this.Hn;
    this.S = this.stored(this.Hn);
    this.Qp = 0; this.Qs = 0; this.HD = this.Hn; this.tapQ = cfg.taps.map(function () { return 0; });
    this.Qfloat = 0;
    this.energy = 0; this.volume = 0;
    this.hist = [];
    this.histT = 0;
    this.events = [];
    this.stepRand = U.rng(12345);
    this.autoRand = U.rng(777);
    this.autoNext = 3;
    this.stepValue = cfg.source.Hmain;
    this.stepNext = 0;
    this.seq = 0;
  };

  Sim.prototype.log = function (text, level) {
    this.events.push({ t: this.t, text: text, level: level || "info", id: ++this.seq });
    if (this.events.length > 300) this.events.shift();
  };

  /* ------------------------------------------------------------ источник */

  Sim.prototype.inletRaw = function (t) {
    var s = this.cfg.source;
    if (s.type === "tank") return s.tankZ + this.level;
    var h = s.Hmain;
    if (s.fluct === "sine") h += s.fluctAmp * Math.sin(2 * Math.PI * t / Math.max(1, s.fluctPeriod));
    else if (s.fluct === "steps") h = this.stepValue;
    else if (s.fluct === "night") h += s.fluctAmp * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / Math.max(1, s.fluctPeriod)));
    return h;
  };
  Sim.prototype.Rin = function () { var s = this.cfg.source; return s.dHin / (s.Qref * s.Qref); };
  Sim.prototype.hinAt = function (Qt) { return this.HinRaw - this.Rin() * Qt * Qt; };

  /* ------------------------------------------------------------ гидравлика */

  /* Объём воды, запасённый в коллекторе при напоре H: упругость труб + мембранный бак
     (газ сжимается изотермически: p·V = const в абсолютных давлениях). */
  Sim.prototype.stored = function (H) {
    var n = this.cfg.net;
    var s = n.Cpipe / 1000 * H;
    if (n.tankOn && n.tankV > 0 && H > n.tankPre) s += n.tankV / 1000 * (1 - (n.tankPre + HATM) / (H + HATM));
    return s;
  };
  Sim.prototype.tankWater = function (H) {
    var n = this.cfg.net;
    if (!n.tankOn || n.tankV <= 0 || H <= n.tankPre) return 0;
    return n.tankV * (1 - (n.tankPre + HATM) / (H + HATM));
  };

  Sim.prototype.rpv = function () { var p = this.cfg.pump; return p.dhPV / (p.Qopt * p.Qopt); };

  /* Подача одного насоса при заданных подпоре Hin и давлении в коллекторе Hn.
     Уравнение  Hin + cav·H(Q, r) − Rpv·Q² = Hn  — квадратное, решается точно.
     Обратный клапан не даёт обратного тока: Q ≥ 0. Для горбатой кривой берём
     правый (устойчивый) корень. */
  Sim.prototype.pumpFlow = function (i, Hin, Hn) {
    var p = this.cfg.pump, c = this.coef, ps = this.pumps[i];
    var r = ps.f / p.fNom, cv = ps.cav;
    var c0 = Hin + cv * p.H0 * r * r, c1 = cv * c.A * r, c2 = cv * c.B + this.rpv();
    var d = Hn - c0;
    var disc = c1 * c1 - 4 * c2 * d;
    if (disc < 0) return 0;
    var q = (c1 + Math.sqrt(disc)) / (2 * c2);
    return q > 0 ? q : 0;
  };

  /* Суммарная подача насосов при напоре в коллекторе Hn; подпор зависит от общего
     расхода (потери на вводе), поэтому ищем самосогласованный расход. */
  Sim.prototype.pumpsTotal = function (Hn, out) {
    var self = this, N = this.cfg.pumpCount, Raw = this.HinRaw, Rin = this.Rin();
    function sum(Qt) {
      var Hin = Raw - Rin * Qt * Qt, s = 0;
      for (var i = 0; i < N; i++) s += self.pumpFlow(i, Hin, Hn);
      return s;
    }
    var hi = sum(0), Qt = 0;
    if (hi > 1e-9) Qt = Rin > 0 ? U.bisect(function (q) { return sum(q) - q; }, 0, hi, 28) : hi;
    if (out) {
      var Hin = Raw - Rin * Qt * Qt;
      out.Hin = Hin;
      out.q = [];
      for (var i = 0; i < N; i++) out.q.push(this.pumpFlow(i, Hin, Hn));
    }
    return Qt;
  };

  Sim.prototype.rsys = function () {
    var n = this.cfg.net;
    var R = n.dhPipe / (n.Qref * n.Qref);
    var kv = n.valveKvs * n.valveOpen * n.valveOpen;
    if (kv < 1e-3) return Infinity;
    return R + 10 / (kv * kv);
  };

  Sim.prototype.tapsFlow = function (HD, out) {
    var taps = this.cfg.taps, s = 0;
    for (var i = 0; i < taps.length; i++) {
      var t = taps[i], q = 0;
      if (t.on && t.open > 0 && HD > t.z) q = t.kv * t.open * Math.sqrt((HD - t.z) / 10);
      if (out) out[i] = q;
      s += q;
    }
    return s;
  };

  /* Разбор потребителей при напоре в коллекторе Hn: вода идёт через задвижку и
     трубы (R·Q²) к распределительной точке, откуда краны на своих отметках. */
  Sim.prototype.systemFlow = function (Hn) {
    var self = this, R = this.rsys();
    if (!isFinite(R)) return 0;
    var hi = this.tapsFlow(Hn);
    if (hi <= 1e-9) return 0;
    return U.bisect(function (q) { return self.tapsFlow(Hn - R * q * q) - q; }, 0, hi, 30);
  };

  /* Точка равновесия при текущих оборотах: подача насосов = разбору. Туда и
     стремится рабочая точка, пока бак заполняется или опорожняется. */
  Sim.prototype.equilibrium = function () {
    var self = this;
    this.coef = Pump.coef(this.cfg.pump);
    var hi = this.headLimit();
    var H = U.bisect(function (h) { return self.pumpsTotal(h) - self.systemFlow(h); }, -HATM + 0.5, hi, 45);
    return { H: H, Q: this.systemFlow(H), Qp: this.pumpsTotal(H) };
  };

  Sim.prototype.headLimit = function () {
    var p = this.cfg.pump, c = this.coef;
    var rmax = Math.max(1.25, this.cfg.vfd.fMax / p.fNom);
    return Math.max(this.Hn, this.HinRaw) + Pump.peak(p, c, rmax).H + 30;
  };

  /* ------------------------------------------------------------ шаг */

  Sim.prototype.step = function (dt) {
    var cfg = this.cfg, p = cfg.pump, src = cfg.source, self = this;
    this.coef = Pump.coef(p);
    this.t += dt;

    // Колебания подпора «ступеньками»
    if (src.fluct === "steps" && this.t >= this.stepNext) {
      this.stepValue = src.Hmain + src.fluctAmp * (2 * this.stepRand() - 1);
      this.stepNext = this.t + Math.max(2, src.fluctPeriod) * (0.5 + this.stepRand());
    }
    this.autoTaps();

    this.HinRaw = this.inletRaw(this.t);
    this.control(dt);
    this.motors(dt);

    // Неявный шаг по запасённому объёму: S(H) − S0 = dt·(Qнасосов(H) − Qразбора(H))
    var S0 = this.S;
    var hi = this.headLimit();
    var Hn = U.bisect(function (h) {
      return self.stored(h) - S0 - dt * (self.pumpsTotal(h) - self.systemFlow(h)) / 3600;
    }, -HATM + 0.5, hi, 44);
    this.Hn = Hn;
    this.S = this.stored(Hn);

    var out = {};
    this.Qp = this.pumpsTotal(Hn, out);
    this.Hin = out.Hin;
    this.Qs = this.systemFlow(Hn);
    this.HD = Hn - (isFinite(this.rsys()) ? this.rsys() * this.Qs * this.Qs : 0);
    this.tapQ = [];
    this.tapsFlow(this.HD, this.tapQ);

    var Pel = 0;
    for (var i = 0; i < MAXP; i++) {
      var ps = this.pumps[i];
      ps.Q = i < cfg.pumpCount ? out.q[i] : 0;
      this.pumpPhysics(i, dt);
      Pel += ps.Pel;
    }
    this.Pel = Pel;
    this.energy += Pel * dt / 3600;
    this.volume += this.Qs * dt / 3600;

    // Бак-источник: уровень, поплавковый клапан, возврат воды от потребителей
    if (src.type === "tank") {
      var open = U.clamp((src.levelSet - this.level) / 0.1, 0, 1);
      this.Qfloat = src.floatQ * open;
      var qin = this.Qfloat + (src.loop ? this.Qs : 0);
      this.level += (qin - this.Qp) / 3600 / src.tankArea * dt;
      this.level = U.clamp(this.level, 0, src.tankH);
    } else this.Qfloat = 0;

    this.histT += dt;
    if (this.histT >= 0.1) {
      this.histT = 0;
      this.hist.push({
        t: this.t, Hn: this.Hn, Hm: this.Hmeas, sp: this.setpoint(), Hin: this.Hin, Qp: this.Qp, Qs: this.Qs, P: this.Pel,
        f: this.pumps.map(function (q) { return q.f; }), q: this.pumps.map(function (q) { return q.Q; }),
        T: this.pumps.map(function (q) { return q.T; }), lvl: this.level
      });
      if (this.hist.length > 4000) this.hist.shift();
    }
  };

  Sim.prototype.pumpPhysics = function (i, dt) {
    var cfg = this.cfg, p = cfg.pump, c = this.coef, src = cfg.source, ps = this.pumps[i];
    var r = ps.f / p.fNom;
    ps.H = ps.cav * Pump.head(p, c, ps.Q, r);
    ps.P = Pump.power(p, c, ps.Q, r);
    var Ph = Pump.hydPower(ps.Q, ps.H);
    ps.eta = ps.P > 1e-6 ? Ph / ps.P : 0;
    ps.Pel = ps.P / p.etaMotor * (ps.drive === "vfd" ? 1.03 : 1);

    // Нагрев воды в корпусе: всё, что не стало напором, превращается в тепло.
    var loss = Math.max(0, ps.P - Ph) * 1000;
    var flowCool = Pump.RHO * CW * (ps.Q / 3600) * (ps.T - src.Tin);
    var wall = p.heatLoss * (ps.T - src.Tamb);
    ps.T += (loss - flowCool - wall) / (p.waterMass * CW) * dt;
    ps.T = U.clamp(ps.T, -5, 180);

    // Кавитация: имеющийся NPSH против требуемого.
    ps.npshA = HATM + this.Hin - U.vaporHead(ps.T);
    ps.npshR = Pump.npshr(p, ps.Q, r);
    var m = ps.npshA - ps.npshR, drop;
    if (m >= 0) drop = 0.03 * Math.exp(-m / 0.15);
    else drop = 0.03 + 0.6 * (-m) / Math.max(ps.npshR, 0.5);
    drop = U.clamp(drop, 0, 0.85);
    if (ps.f < 1) drop = 0;
    ps.cav += ((1 - drop) - ps.cav) * Math.min(1, dt / 0.3);
    // Стадии: запас меньше 0,5 м (требование NPSHа ≥ NPSH3 + 0,5) — начальная;
    // запас около нуля и ниже (напор уже упал на ~3%, это и есть NPSH3) — развитая; большой провал — срыв.
    var stage = 0;
    if (ps.f > 1) {
      if (1 - ps.cav > 0.25) stage = 3; else if (m < 0.1) stage = 2; else if (m < 0.5) stage = 1;
    }
    if (stage >= 2 && ps.cavStage < 2) this.log("Насос " + (i + 1) + ": кавитация — NPSHа " + U.fmt(ps.npshA, 1) + " м < NPSHтр " + U.fmt(ps.npshR, 1) + " м, напор падает", "bad");
    ps.cavStage = stage;

    if (ps.T > 60 && !ps.t60) { ps.t60 = true; this.log("Насос " + (i + 1) + ": вода в корпусе нагрелась до 60 °C — торцевое уплотнение под угрозой", "warn"); }
    if (ps.T > 90 && !ps.t90) { ps.t90 = true; this.log("Насос " + (i + 1) + ": перегрев 90 °C — так насос выходит из строя", "bad"); }
    if (ps.T < 50) ps.t60 = false;
    if (ps.T < 80) ps.t90 = false;

    // Обратный клапан закрыт у вращающегося насоса — насос «крутится на задвижку».
    if (ps.on && ps.f > 3 && ps.Q < 1e-3) {
      ps.cvClosedT += dt;
      if (ps.cvClosedT > 4 && !ps.cvLogged) {
        ps.cvLogged = true;
        this.log("Насос " + (i + 1) + " на " + U.fmt(ps.f, 1) + " Гц не открывает обратный клапан: подачи нет, вода греется", "warn");
      }
    } else { ps.cvClosedT = 0; if (ps.Q > 0.05) ps.cvLogged = false; }

    if (ps.f > 1) ps.runTime += dt;
  };

  /* ------------------------------------------------------------ приводы */

  Sim.prototype.motors = function (dt) {
    var cfg = this.cfg, fNom = cfg.pump.fNom;
    var rate = fNom / Math.max(0.2, cfg.vfd.ramp);
    for (var i = 0; i < MAXP; i++) {
      var ps = this.pumps[i];
      if (i >= cfg.pumpCount || cfg.ctrl.failed[i]) ps.on = false;
      if (ps.drive === "vfd") {
        var target = ps.on ? ps.fCmd : 0;
        ps.f += U.clamp(target - ps.f, -rate * dt, rate * dt);
      } else {
        // Прямой пуск: разгон за доли секунды; после отключения — выбег.
        if (ps.on) ps.f += (fNom - ps.f) * Math.min(1, dt / 0.25);
        else { ps.f -= ps.f * Math.min(1, dt / 1.2); if (ps.f < 0.3) ps.f = 0; }
      }
      if (ps.f < 0) ps.f = 0;
    }
  };

  Sim.prototype.setOn = function (i, on, why) {
    var ps = this.pumps[i];
    if (ps.on === on) return;
    ps.on = on;
    if (on) {
      ps.tOn = this.t; ps.starts++; ps.startTimes.push(this.t);
      if (ps.startTimes.length > 400) ps.startTimes.shift();
      this.log("Насос " + (i + 1) + ": пуск" + (ps.drive === "vfd" ? " через ПЧ" : " прямой") + (why ? " — " + why : ""), "info");
    } else {
      ps.tOff = this.t; ps.afterT = null;
      this.log("Насос " + (i + 1) + ": стоп" + (why ? " — " + why : ""), "info");
    }
  };

  Sim.prototype.startsPerHour = function (i) {
    var ps = this.pumps[i], win = Math.min(this.t, 3600);
    if (win < 20) return 0;
    var t0 = this.t - win, n = 0;
    for (var k = 0; k < ps.startTimes.length; k++) if (ps.startTimes[k] > t0) n++;
    return n * 3600 / win;
  };

  /* Порядок насосов: ведущий первым, аварийные пропускаем. */
  Sim.prototype.order = function () {
    var N = this.cfg.pumpCount, failed = this.cfg.ctrl.failed, res = [];
    for (var k = 0; k < N; k++) {
      var i = (this.lead + k) % N;
      if (!failed[i]) res.push(i);
    }
    return res;
  };

  Sim.prototype.rotateLead = function () {
    if (!this.cfg.ctrl.alternate) return;
    var N = this.cfg.pumpCount;
    for (var k = 1; k <= N; k++) {
      var i = (this.lead + k) % N;
      if (!this.cfg.ctrl.failed[i]) { this.lead = i; return; }
    }
  };

  Sim.prototype.setpoint = function () {
    var c = this.cfg.ctrl;
    if (c.mode === "vfd1" || c.mode === "vfdAll") return c.Hset + (this.state === "boost" ? c.boost : 0);
    if (c.mode === "relay") return null;
    return null;
  };

  /* ------------------------------------------------------------ управление */

  Sim.prototype.control = function (dt) {
    var cfg = this.cfg, c = cfg.ctrl, N = cfg.pumpCount, i;
    this.Hmeas += (this.Hn - this.Hmeas) * Math.min(1, dt / Math.max(0.02, c.sensorTau));

    var dry = this.dryCheck(dt);

    for (i = N; i < MAXP; i++) this.pumps[i].on = false;
    for (i = 0; i < N; i++) if (c.failed[i] && this.pumps[i].on) this.setOn(i, false, "авария");

    if (c.mode === "manualDol" || c.mode === "manualVfd") {
      this.state = "run";
      for (i = 0; i < N; i++) {
        var ps = this.pumps[i];
        ps.drive = c.mode === "manualVfd" ? "vfd" : "dol";
        ps.fCmd = U.clamp(c.fManual, 0, 70);
        this.setOn(i, !!c.manualOn[i] && !c.failed[i] && !dry);
      }
      return;
    }

    if (dry) {
      for (i = 0; i < N; i++) this.setOn(i, false, "защита от сухого хода");
      return;
    }

    if (c.mode === "relay") this.relayControl(dt);
    else this.vfdControl(dt);
  };

  Sim.prototype.dryCheck = function (dt) {
    var c = this.cfg.ctrl, s = this.cfg.source;
    if (!c.dryProt) { this.dry = false; return false; }
    var low, ok;
    if (s.type === "tank") { low = this.level < s.levelMin; ok = this.level > s.levelMin + 0.25; }
    else { low = this.Hin < c.dryH; ok = this.HinRaw > c.dryH + 3; }
    if (!this.dry) {
      this.dryT = low ? this.dryT + dt : 0;
      if (this.dryT >= 1) {
        this.dry = true; this.dryT = 0;
        this.log(s.type === "tank" ? "Сухой ход: уровень в баке ниже минимального — насосы остановлены" : "Сухой ход: подпор на вводе ниже " + U.fmt(c.dryH, 0) + " м — насосы остановлены", "bad");
      }
    } else {
      this.dryT = ok ? this.dryT + dt : 0;
      if (this.dryT >= 5) { this.dry = false; this.dryT = 0; this.log("Вода вернулась — защита от сухого хода сброшена", "info"); }
    }
    return this.dry;
  };

  Sim.prototype.relayControl = function (dt) {
    var c = this.cfg.ctrl, ord = this.order(), H = this.Hmeas;
    this.state = "run";
    for (var k = 0; k < ord.length; k++) {
      var i = ord[k], ps = this.pumps[i];
      ps.drive = "dol";
      var hOn = c.relayOn - k * c.relayStep, hOff = c.relayOff - k * c.relayStep;
      if (!ps.on) {
        if (H < hOn) this.setOn(i, true, "давление " + U.fmt(H, 1) + " м < " + U.fmt(hOn, 1) + " м");
      } else {
        if (ps.afterT !== null) {
          if (H < hOn) ps.afterT = null;
          else {
            ps.afterT += dt;
            if (ps.afterT >= c.afterRun) this.setOn(i, false, "закончился выбег " + U.fmt(c.afterRun, 0) + " с");
          }
        } else if (H > hOff && this.t - ps.tOn >= c.minRun) {
          if (k === 0 && c.afterRun > 0) ps.afterT = 0;
          else this.setOn(i, false, "давление " + U.fmt(H, 1) + " м > " + U.fmt(hOff, 1) + " м");
        }
      }
    }
    if (this.anyOn()) this.wasRunning = true;
    else this.rotateLeadIfStopped();
  };

  Sim.prototype.anyOn = function () {
    for (var i = 0; i < this.cfg.pumpCount; i++) if (this.pumps[i].on) return true;
    return false;
  };
  Sim.prototype.rotateLeadIfStopped = function () {
    if (this.wasRunning) { this.rotateLead(); this.wasRunning = false; }
  };

  Sim.prototype.vfdControl = function (dt) {
    var cfg = this.cfg, c = cfg.ctrl, v = cfg.vfd, ord = this.order(), k, i;
    if (!ord.length) return;
    var all = c.mode === "vfdAll";
    var sp = c.Hset + (this.state === "boost" ? c.boost : 0);

    // ПИ-регулятор в приращениях; ограничение [fмин; fмакс] заодно гасит насыщение интеграла.
    this.piT += dt;
    if (this.piT >= 0.05) {
      var h = this.piT; this.piT = 0;
      var e = sp - this.Hmeas;
      this.u += c.Kp * (e - this.ePrev) + c.Kp * h / Math.max(0.05, c.Ti) * e;
      this.ePrev = e;
      this.u = U.clamp(this.u, v.fMin, v.fMax);
    }

    for (k = 0; k < ord.length; k++) this.pumps[ord[k]].drive = (all || k === 0) ? "vfd" : "dol";

    if (this.state === "sleep") {
      for (k = 0; k < ord.length; k++) this.setOn(ord[k], false);
      if (this.Hmeas < c.Hset - c.wake) {
        this.state = "run";
        this.u = v.fMin + 0.5 * (v.fMax - v.fMin);
        this.setOn(ord[0], true, "давление упало до " + U.fmt(this.Hmeas, 1) + " м — выход из спящего режима");
      }
      return;
    }

    var lead = ord[0];
    if (!this.pumps[lead].on) this.setOn(lead, true, "ведущий насос");
    this.wasRunning = true;

    var running = [];
    for (k = 0; k < ord.length; k++) if (this.pumps[ord[k]].on) running.push(ord[k]);
    for (k = 0; k < running.length; k++) {
      i = running[k];
      if (all || i === lead) this.pumps[i].fCmd = this.u;
    }

    // Подключение и отключение пиковых насосов
    var addCond, remCond;
    if (all) {
      addCond = this.u >= c.fAdd - 1e-6 && running.length < ord.length;
      remCond = running.length > 1 && this.u <= c.fRem;
    } else {
      addCond = this.u >= v.fMax - 0.3 && this.Hmeas < sp - c.addDH && running.length < ord.length;
      remCond = running.length > 1 && (this.u <= c.fRem || this.Hmeas > sp + c.remDH);
    }
    this.addT = addCond ? this.addT + dt : 0;
    this.remT = remCond ? this.remT + dt : 0;
    if (this.addT >= c.addDelay) {
      this.addT = 0;
      for (k = 0; k < ord.length; k++) if (!this.pumps[ord[k]].on) {
        var np = this.pumps[ord[k]];
        if (all) { np.fCmd = this.u; }
        this.setOn(ord[k], true, all ? "частота ≥ " + U.fmt(c.fAdd, 0) + " Гц" : "ведущий на максимуме, давления не хватает");
        break;
      }
    }
    if (this.remT >= c.remDelay) {
      this.remT = 0;
      for (k = ord.length - 1; k >= 1; k--) if (this.pumps[ord[k]].on) {
        this.setOn(ord[k], false, all ? "частота ≤ " + U.fmt(c.fRem, 0) + " Гц" : (this.Hmeas > sp + c.remDH ? "давление выше уставки" : "ведущий на малой частоте"));
        break;
      }
    }

    // Спящий режим: малый разбор распознаётся по расходу (реле протока или оценка ПЧ по мощности).
    // По частоте его не узнать: при высокой уставке насосу и при Q = 0 нужна частота намного выше f мин.
    if (c.sleep) {
      if (this.state === "run") {
        var calm = running.length === 1 && this.Qp <= c.sleepQ && Math.abs(this.Hmeas - c.Hset) < 2;
        this.sleepT = calm ? this.sleepT + dt : 0;
        if (this.sleepT >= c.sleepDelay) {
          this.sleepT = 0; this.state = "boost"; this.boostT = 0;
          this.log("Разбора почти нет: подъём давления на " + U.fmt(c.boost, 0) + " м перед остановкой", "info");
        }
      } else if (this.state === "boost") {
        this.boostT += dt;
        if (this.Hmeas >= c.Hset + c.boost - 0.3) {
          this.state = "sleep";
          for (k = 0; k < ord.length; k++) this.setOn(ord[k], false, "спящий режим");
          this.rotateLead();
        } else if (this.boostT > 20) {
          this.state = "run";
          this.log("Давление не поднялось — разбор есть, спящий режим отменён", "info");
        }
      }
    } else if (this.state !== "run") this.state = "run";
  };

  /* ------------------------------------------------------------ автоматический водоразбор */

  Sim.prototype.autoTaps = function () {
    var a = this.cfg.auto, taps = this.cfg.taps;
    if (!a.on || this.t < this.autoNext) return;
    this.autoNext = this.t + a.period * (0.4 + 1.2 * this.autoRand());
    var n = Math.min(4, taps.length);
    var k = Math.floor(this.autoRand() * n);
    var want = this.autoRand() < a.level;
    taps[k].on = want;
    if (want) taps[k].open = Math.round((0.35 + 0.65 * this.autoRand()) * 20) / 20;
    this.tapsChanged = true;
  };

  return { Sim: Sim, defaults: defaults, MODES: MODES, HATM: HATM, MAXP: MAXP };
})();
