/* Вкладка «Как устроен насос»: разрез колеса и спирального отвода с частицами воды,
   треугольник скоростей на выходе колеса, кривая «Эйлер минус потери». */
var Anatomy = (function () {
  "use strict";
  var st = { f: 50, D2: 150, stages: 1, open: 0.6, beta: 25 };
  var cv, cvChart, parts = [], rot = 0, last = 0, active = false;
  var G = 9.81, b2 = 0.009, RPM50 = 2900, NB = 7, SWEEP = 1.1;
  var TH0 = -Math.PI / 2;           // «язык» отвода и выход в патрубок — вверху

  /* ------------------------------------------------------------ физика ступени */
  function stage(f, D2mm, beta) {
    var D2 = D2mm / 1000, n = RPM50 * f / 50;
    var u2 = Math.PI * D2 * n / 60;
    var A2 = Math.PI * D2 * b2 * 0.9;                 // площадь выхода колеса, м²
    var tb = Math.tan(beta * Math.PI / 180);
    var Qth0 = u2 * tb * A2 * 3600;                   // подача, при которой c2u = 0, м³/ч
    var Hth0 = u2 * u2 / G;
    return { n: n, u2: u2, A2: A2, tb: tb, Qth0: Qth0, Hth0: Hth0, D2: D2 };
  }
  /* Напор ступени: теория Эйлера с поправкой на конечное число лопаток (0,62)
     минус потери трения (~Q²) и удара на входе (~(Q − Qрасч)²). */
  function stageHead(s, Q) {
    if (s.Qth0 <= 0) return { Hth: 0, H: 0 };
    var x = Q / s.Qth0;
    var Hth = s.Hth0 * 0.62 * (1 - x);
    var H = Hth - s.Hth0 * (0.12 * x * x + 0.2 * Math.pow(x - 0.4, 2));
    return { Hth: Hth, H: H };
  }
  /* Сеть стенда — задвижка и трубы без подъёма (H = R·Q²). При полном открытии
     рабочая точка на 50 Гц попадает в расчётный режим; R от частоты не зависит,
     поэтому при смене частоты точка идёт по параболе подобия. */
  function operating() {
    var s = stage(st.f, st.D2, st.beta);
    var s50 = stage(50, st.D2, st.beta), qd = 0.42 * s50.Qth0;
    var R = st.stages * stageHead(s50, qd).H / (qd * qd) / Math.max(1e-4, st.open * st.open);
    if (st.open <= 0.005 || s.Qth0 <= 0) return { s: s, Q: 0, H: Math.max(0, st.stages * stageHead(s, 0).H), R: undefined };
    var Q = st.stages * stageHead(s, 0).H > 0 ? U.bisect(function (q) { return st.stages * stageHead(s, q).H - R * q * q; }, 0, s.Qth0 * 0.99, 50) : 0;
    return { s: s, Q: Q, H: R * Q * Q, R: R };
  }
  function power(s, Q, Hth) {
    var qleak = 0.03 * s.Qth0;
    var Pdisc = 0.035 * 1000 * G * (s.Qth0 / 3600) * s.Hth0 * 0.62;
    return (1000 * G * ((Q + qleak) / 3600) * Hth + Pdisc) / 1000 * st.stages;
  }

  /* ------------------------------------------------------------ частицы
     Радиусы хранятся в долях R2, чтобы не зависеть от размера холста.
     ph = 0 — в канале колеса, 1 — в спиральном отводе, 2 — в напорном патрубке. */
  var RF1 = 0.32;
  function volRf(a) { var t = ((a - TH0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return 1.1 + 0.42 * t / (2 * Math.PI); }
  function spawn(p) {
    p.ph = 0; p.rf = RF1 * (1 + Math.random() * 0.2); p.k = Math.floor(Math.random() * NB); p.j = 0.2 + Math.random() * 0.6;
    p.a = 0; p.rel = 0; p.x = 0; p.y = 0; p.lane = Math.random();
    return p;
  }
  function initParts() {
    parts = [];
    for (var i = 0; i < 240; i++) {
      var p = spawn({});
      if (i < 120) p.rf = RF1 + Math.random() * (1 - RF1);
      else { p.ph = 1; p.a = TH0 + Math.random() * Math.PI * 2; p.rel = ((p.a - TH0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); }
      parts.push(p);
    }
  }

  function draw(ts) {
    if (!active) return;
    requestAnimationFrame(draw);
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    var fc = U.fitCanvas(cv), c = fc.ctx, w = fc.w, h = fc.h;
    c.clearRect(0, 0, w, h);

    var op = operating(), s = op.s;
    var R2 = Math.min(w * 0.2, h * 0.27) * (0.8 + 0.2 * st.D2 / 250);
    var R1 = R2 * RF1;
    var cx = Math.min(w * 0.36, w - R2 * 2.6 - 220), cy = h * 0.55;
    cx = Math.max(cx, R2 * 1.6 + 10);
    var Qfrac = s.Qth0 > 0 ? U.clamp(op.Q / s.Qth0, 0, 1) : 0;
    var fr = st.f / 50;
    var omega = st.f * 0.09;                            // визуальная скорость, рад/с (замедлена)
    rot += omega * dt;
    var pr = Math.min(1, Math.pow(st.f / 60, 2));        // «насыщенность» давления ~ n²
    var lo = U.css("--pipe-lo"), hi = U.css("--pipe-hi");

    // Спиральный отвод: корпус и вода в нём
    function volPath(extra) {
      c.beginPath();
      for (var a = 0; a <= 2 * Math.PI + 1e-3; a += 0.04) {
        var rr = volRf(TH0 + a) * R2 + extra;
        var X = cx + rr * Math.cos(TH0 + a), Y = cy + rr * Math.sin(TH0 + a);
        if (a === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
      }
      var top = cy - 1.52 * R2 - extra;
      c.lineTo(cx + R2 * 2.4, top);
      c.lineTo(cx + R2 * 2.4, cy - 1.1 * R2 + extra);
      c.lineTo(cx, cy - 1.1 * R2 + extra);
      c.closePath();
    }
    volPath(10); c.fillStyle = U.css("--casing-dark"); c.fill();
    volPath(0); c.fillStyle = U.mix(lo, hi, 0.3 + 0.55 * pr); c.fill();

    // Колесо: давление растёт от «глаза» к периферии
    var grd = c.createRadialGradient(cx, cy, R1 * 0.6, cx, cy, R2);
    grd.addColorStop(0, lo);
    grd.addColorStop(1, U.mix(lo, hi, 0.15 + 0.5 * pr));
    c.beginPath(); c.arc(cx, cy, R2, 0, Math.PI * 2); c.fillStyle = grd; c.fill();
    c.strokeStyle = U.css("--blade"); c.lineWidth = 1; c.stroke();

    // Лопатки (загнуты назад относительно вращения по часовой стрелке)
    c.lineWidth = Math.max(3, R2 * 0.04); c.strokeStyle = U.css("--blade"); c.lineCap = "round";
    for (var k = 0; k < NB; k++) {
      c.beginPath();
      for (var t = 0; t <= 1.0001; t += 0.1) {
        var r = R1 + (R2 - R1) * t, ang = rot + k * 2 * Math.PI / NB - SWEEP * t;
        var X = cx + r * Math.cos(ang), Y = cy + r * Math.sin(ang);
        if (t === 0) c.moveTo(X, Y); else c.lineTo(X, Y);
      }
      c.stroke();
    }
    c.beginPath(); c.arc(cx, cy, R1 * 0.6, 0, Math.PI * 2); c.fillStyle = U.css("--casing-dark"); c.fill();
    c.fillStyle = "#fff"; c.font = "11px system-ui, Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("вал", cx, cy);

    // Частицы воды
    var vr = 1.8 * Qfrac * fr;                           // радиальная скорость в каналах, долей R2 в секунду
    var vv = omega * (0.55 + 0.6 * Qfrac);               // угловая скорость в отводе
    var nozzleEnd = cx + R2 * 2.4;
    c.lineWidth = 1;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], px, py, tone;
      if (p.ph === 0) {
        p.rf += vr * dt * Math.sqrt(RF1 / Math.max(p.rf, RF1));
        var tt = U.clamp((p.rf - RF1) / (1 - RF1), 0, 1);
        var angp = rot + (p.k + p.j) * 2 * Math.PI / NB - SWEEP * tt;
        px = cx + p.rf * R2 * Math.cos(angp); py = cy + p.rf * R2 * Math.sin(angp);
        if (p.rf >= 1) { p.ph = 1; p.a = angp; p.rel = ((p.a - TH0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); }
        tone = 0.2 + 0.6 * tt;
      } else if (p.ph === 1) {
        p.a += vv * dt;
        var rel = ((p.a - TH0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        if (rel < p.rel) {                               // прошли «язык»: выход в патрубок или ещё круг
          if (Math.random() < Math.min(1, Qfrac * 3)) { p.ph = 2; p.x = cx; p.y = cy - (1.1 + 0.42 * p.lane) * R2; }
        }
        p.rel = rel;
        var rv = (1.03 + (volRf(p.a) - 1.06) * p.lane) * R2;
        px = cx + rv * Math.cos(p.a); py = cy + rv * Math.sin(p.a);
        tone = 0.75;
      } else {
        p.x += R2 * (0.6 + 3 * Qfrac) * fr * dt;
        px = p.x; py = p.y;
        if (p.x > nozzleEnd) spawn(p);
        tone = 0.9;
      }
      if (p.ph === 2 && px > nozzleEnd) continue;
      c.beginPath(); c.arc(px, py, 2.6, 0, Math.PI * 2);
      c.fillStyle = "#ffffff"; c.fill();
      c.strokeStyle = U.mix(lo, hi, tone); c.stroke();
    }

    // Подписи
    c.textAlign = "left"; c.textBaseline = "alphabetic"; c.font = "12px system-ui, Segoe UI, sans-serif";
    c.fillStyle = U.css("--ink");
    c.fillText("напорный патрубок →", cx + R2 * 1.2, cy - R2 * 1.62 - 10);
    c.fillStyle = U.css("--muted");
    c.fillText("вращение по часовой стрелке, " + Math.round(s.n) + " об/мин", 12, 18);
    c.fillText("спиральный отвод: скорость превращается в давление", 12, h - 30);
    c.fillText("вода входит по оси в «глаз» колеса — там разрежение", 12, h - 12);
    if (op.Q < 0.01 && st.f > 0) {
      c.fillStyle = U.css("--bad");
      c.fillText("задвижка закрыта: вода крутится вместе с колесом и греется", 12, 36);
    }

    // Треугольник скоростей на выходе колеса
    var cm2 = (op.Q / 3600) / s.A2;
    var c2u = s.u2 - cm2 / s.tb;
    var bw = 210, bh = 170, bx = w - bw - 8, by = 8;
    var sc = (bw - 40) / Math.max(20, stage(60, st.D2, st.beta).u2);
    c.save();
    c.fillStyle = U.css("--panel"); c.fillRect(bx, by, bw, bh);
    c.strokeStyle = U.css("--line"); c.strokeRect(bx + 0.5, by + 0.5, bw, bh);
    c.fillStyle = U.css("--ink"); c.font = "600 12px system-ui, Segoe UI, sans-serif";
    c.fillText("Треугольник скоростей на выходе", bx + 8, by + 18);
    c.font = "11px system-ui, Segoe UI, sans-serif";
    var ox = bx + 14, oy = by + 110, k3 = 3;
    arrow(c, ox, oy, ox + s.u2 * sc, oy, U.css("--muted"), "u2");
    arrow(c, ox + s.u2 * sc, oy, ox + c2u * sc, oy - cm2 * sc * k3, U.css("--est"), "w2");
    arrow(c, ox, oy, ox + c2u * sc, oy - cm2 * sc * k3, U.css("--accent"), "c2");
    c.fillStyle = U.css("--muted");
    c.fillText("u2 " + U.fmt(s.u2, 1) + " · c2u " + U.fmt(c2u, 1) + " · cm2 " + U.fmt(cm2, 2) + " м/с", bx + 8, by + 132);
    c.fillText("Hт = u2·c2u/g = " + U.fmt(s.u2 * Math.max(0, c2u) / G, 1) + " м", bx + 8, by + 148);
    c.fillText("радиальная скорость cm2 — ×3", bx + 8, by + 163);
    c.restore();

    // Показания
    var sh = stageHead(s, op.Q);
    var P = power(s, op.Q, sh.Hth);
    var eta = P > 0 ? 1000 * G * (op.Q / 3600) * op.H / 1000 / P : 0;
    U.$("anaOut").innerHTML =
      row("Частота вращения", Math.round(s.n) + " об/мин") +
      row("Окружная скорость u2 = π·D2·n/60", U.fmt(s.u2, 1) + " м/с") +
      row("Подача", U.fmt(op.Q, 1) + " м³/ч") +
      row("Напор" + (st.stages > 1 ? " (" + st.stages + " ступ.)" : ""), U.fmt(op.H, 1) + " м") +
      row("Напор при Q = 0", U.fmt(Math.max(0, st.stages * stageHead(s, 0).H), 1) + " м") +
      row("Мощность на валу", U.fmt(P, 2) + " кВт") +
      row("КПД", U.fmt(eta * 100, 0) + " %");
    U.$("anaLaws").innerHTML =
      bar("Q ~ n", fr, "подача") + bar("H ~ n²", fr * fr, "напор") + bar("P ~ n³", fr * fr * fr, "мощность");

    drawChart(op, s);
  }

  function row(a, b) { return '<div class="kv"><span>' + a + '</span><b>' + b + "</b></div>"; }
  function bar(name, v, what) {
    return '<div class="lawbar"><span class="ln">' + name + '</span><span class="lb"><i style="width:' + U.clamp(v / 1.8 * 100, 0, 100).toFixed(1) + '%"></i></span><span class="lv">' + U.fmt(v * 100, 0) + "% " + what + "</span></div>";
  }

  function arrow(c, x1, y1, x2, y2, col, lab) {
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    var a = Math.atan2(y2 - y1, x2 - x1);
    if (Math.hypot(x2 - x1, y2 - y1) > 6) {
      c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4)); c.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4)); c.closePath(); c.fill();
    }
    c.fillText(lab, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 5);
  }

  function drawChart(op, s) {
    var fc = U.fitCanvas(cvChart), ctx = fc.ctx;
    var s60 = stage(60, st.D2, st.beta);
    var xMax = Plot.niceMax(s60.Qth0 * 0.8), yMax = Plot.niceMax(st.stages * s60.Hth0 * 0.64);
    var P = Plot.frame(ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, м³/ч", yLabel: "H, м", pad: { l: 46, r: 14, t: 52, b: 34 } });
    Plot.clip(P);
    var qs = [];
    for (var i = 0; i <= 80; i++) qs.push(s.Qth0 * i / 80);
    Plot.line(P, qs.map(function (q) { return [q, st.stages * stageHead(s, q).Hth]; }), { color: U.css("--est"), width: 1.5, dash: [6, 4] });
    Plot.line(P, qs.map(function (q) { var hh = st.stages * stageHead(s, q).H; return hh > 0 ? [q, hh] : null; }), { color: U.css("--accent"), width: 2.6 });
    if (op.R !== undefined) Plot.line(P, qs.map(function (q) { return [q, op.R * q * q]; }), { color: U.css("--water"), width: 1.8 });
    Plot.dot(P, op.Q, op.H, 5, U.css("--accent"), U.css("--panel"));
    Plot.unclip(P);
    Plot.legend({ ctx: ctx, L: P.L - 40, R: P.R, T: 0 }, [
      { text: "теория Эйлера", color: U.css("--est"), dash: [6, 4] },
      { text: "реальная = теория − потери", color: U.css("--accent"), width: 2.6 },
      { text: "задвижка", color: U.css("--water") }
    ]);
  }

  function bindRange(id, key, fmt) {
    var e = U.$(id), o = U.$(id + "V");
    function upd() { st[key] = +e.value; if (o) o.textContent = fmt(st[key]); }
    e.addEventListener("input", upd); upd();
  }

  function init() {
    cv = U.$("anaCanvas"); cvChart = U.$("anaChart");
    bindRange("anaF", "f", function (v) { return U.fmt(v, 0) + " Гц"; });
    bindRange("anaD", "D2", function (v) { return U.fmt(v, 0) + " мм"; });
    bindRange("anaZ", "stages", function (v) { return U.fmt(v, 0); });
    bindRange("anaOpen", "open", function (v) { return U.fmt(v * 100, 0) + " %"; });
    bindRange("anaBeta", "beta", function (v) { return U.fmt(v, 0) + "°"; });
    initParts();
  }
  function start() { if (active) return; active = true; last = 0; requestAnimationFrame(draw); }
  function stop() { active = false; }

  return { init: init, start: start, stop: stop, _stage: stage, _stageHead: stageHead, _operating: operating };
})();
