/* Графики на холстах: общий каркас (оси, сетка), график Q–H лаборатории, осциллограф. */
var Plot = (function () {
  "use strict";

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var s = U.niceStep(v, 5);
    return Math.ceil(v / s) * s;
  }

  /* Каркас: возвращает объект с преобразованиями X(), Y() и контекстом. */
  function frame(ctx, w, h, o) {
    var pad = o.pad || { l: 46, r: o.y2 ? 44 : 14, t: 14, b: 34 };
    var p = {
      ctx: ctx, w: w, h: h, pad: pad,
      x0: o.x0 || 0, x1: o.x1, y0: o.y0 || 0, y1: o.y1,
      L: pad.l, R: w - pad.r, T: pad.t, B: h - pad.b
    };
    p.X = function (x) { return p.L + (x - p.x0) / (p.x1 - p.x0) * (p.R - p.L); };
    p.Y = function (y) { return p.B - (y - p.y0) / (p.y1 - p.y0) * (p.B - p.T); };
    if (o.y2) {
      p.y2a = o.y2[0]; p.y2b = o.y2[1];
      p.Y2 = function (y) { return p.B - (y - p.y2a) / (p.y2b - p.y2a) * (p.B - p.T); };
    }
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px system-ui, Segoe UI, sans-serif";
    ctx.lineWidth = 1;
    var grid = U.css("--grid"), ink = U.css("--muted");
    var xs = U.niceStep(p.x1 - p.x0, o.xTicks || 7), ys = U.niceStep(p.y1 - p.y0, o.yTicks || 6);
    ctx.strokeStyle = grid; ctx.fillStyle = ink;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (var x = Math.ceil(p.x0 / xs) * xs; x <= p.x1 + 1e-9; x += xs) {
      var X = Math.round(p.X(x)) + 0.5;
      ctx.beginPath(); ctx.moveTo(X, p.T); ctx.lineTo(X, p.B); ctx.stroke();
      if (!o.noXLabels) ctx.fillText(o.xFmt ? o.xFmt(x) : U.fmt(x, xs < 1 ? 1 : 0), X, p.B + 4);
    }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (var y = Math.ceil(p.y0 / ys) * ys; y <= p.y1 + 1e-9; y += ys) {
      var Y = Math.round(p.Y(y)) + 0.5;
      ctx.beginPath(); ctx.moveTo(p.L, Y); ctx.lineTo(p.R, Y); ctx.stroke();
      ctx.fillText(U.fmt(y, ys < 1 ? 1 : 0), p.L - 5, Y);
    }
    if (o.y2) {
      ctx.textAlign = "left";
      var s2 = U.niceStep(p.y2b - p.y2a, 5);
      for (var z = Math.ceil(p.y2a / s2) * s2; z <= p.y2b + 1e-9; z += s2) ctx.fillText(U.fmt(z, 0), p.R + 5, p.Y2(z));
    }
    ctx.strokeStyle = U.css("--axis");
    ctx.strokeRect(p.L + 0.5, p.T + 0.5, p.R - p.L, p.B - p.T);
    ctx.fillStyle = ink;
    if (o.xLabel) { ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(o.xLabel, p.R, h - 2); }
    if (o.yLabel) { ctx.save(); ctx.translate(11, p.T); ctx.rotate(-Math.PI / 2); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(o.yLabel, 0, 0); ctx.restore(); }
    if (o.y2Label) { ctx.save(); ctx.translate(w - 8, p.T); ctx.rotate(-Math.PI / 2); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(o.y2Label, 0, 0); ctx.restore(); }
    return p;
  }

  function clip(p) { p.ctx.save(); p.ctx.beginPath(); p.ctx.rect(p.L, p.T, p.R - p.L, p.B - p.T); p.ctx.clip(); }
  function unclip(p) { p.ctx.restore(); }

  function line(p, pts, st, useY2) {
    if (pts.length < 2) return;
    var c = p.ctx, Y = useY2 ? p.Y2 : p.Y;
    c.save();
    c.strokeStyle = st.color; c.lineWidth = st.width || 1.5; c.globalAlpha = st.alpha || 1;
    c.setLineDash(st.dash || []);
    c.lineJoin = "round";
    c.beginPath();
    var started = false;
    for (var i = 0; i < pts.length; i++) {
      var q = pts[i];
      if (q === null || !isFinite(q[0]) || !isFinite(q[1])) { started = false; continue; }
      var X = p.X(q[0]), YY = Y(q[1]);
      if (!started) { c.moveTo(X, YY); started = true; } else c.lineTo(X, YY);
    }
    c.stroke();
    c.restore();
  }

  function fillBetween(p, top, bottom, color, alpha) {
    if (top.length < 2) return;
    var c = p.ctx;
    c.save(); c.fillStyle = color; c.globalAlpha = alpha || 0.15;
    c.beginPath();
    c.moveTo(p.X(top[0][0]), p.Y(top[0][1]));
    for (var i = 1; i < top.length; i++) c.lineTo(p.X(top[i][0]), p.Y(top[i][1]));
    for (var j = bottom.length - 1; j >= 0; j--) c.lineTo(p.X(bottom[j][0]), p.Y(bottom[j][1]));
    c.closePath(); c.fill(); c.restore();
  }

  function dot(p, x, y, r, fill, stroke, lw) {
    var c = p.ctx;
    c.beginPath(); c.arc(p.X(x), p.Y(y), r, 0, 2 * Math.PI);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1.5; c.stroke(); }
  }

  function cross(p, x, y, r, color) {
    var c = p.ctx, X = p.X(x), Y = p.Y(y);
    c.save(); c.strokeStyle = color; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(X - r, Y - r); c.lineTo(X + r, Y + r); c.moveTo(X - r, Y + r); c.lineTo(X + r, Y - r); c.stroke();
    c.restore();
  }

  function label(p, x, y, text, color, align, base, bg) {
    var c = p.ctx, X = typeof x === "number" && p.X ? p.X(x) : x, Y = p.Y(y);
    c.save();
    c.font = "11px system-ui, Segoe UI, sans-serif";
    c.textAlign = align || "left"; c.textBaseline = base || "bottom";
    if (bg) {
      var w = c.measureText(text).width;
      var bx = c.textAlign === "right" ? X - w - 2 : (c.textAlign === "center" ? X - w / 2 - 2 : X - 2);
      var by = c.textBaseline === "top" ? Y : (c.textBaseline === "middle" ? Y - 7 : Y - 14);
      c.fillStyle = U.css("--panel"); c.globalAlpha = 0.85; c.fillRect(bx, by, w + 4, 14); c.globalAlpha = 1;
    }
    c.fillStyle = color; c.fillText(text, X, Y);
    c.restore();
  }

  /* Легенда в строку в верхней части графика. */
  function legend(p, items) {
    var c = p.ctx, x = p.L + 8, y = p.T + 8;
    c.save(); c.font = "11px system-ui, Segoe UI, sans-serif"; c.textBaseline = "middle"; c.textAlign = "left";
    var widths = items.map(function (it) { return c.measureText(it.text).width + 30; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var rows = [], row = [], rw = 0, maxW = p.R - p.L - 16;
    items.forEach(function (it, k) {
      if (rw + widths[k] > maxW && row.length) { rows.push(row); row = []; rw = 0; }
      row.push(k); rw += widths[k];
    });
    if (row.length) rows.push(row);
    c.fillStyle = U.css("--panel"); c.globalAlpha = 0.85;
    c.fillRect(x - 4, y - 7, Math.min(maxW, total) + 8, rows.length * 15 + 2);
    c.globalAlpha = 1;
    rows.forEach(function (r, ri) {
      var xx = x, yy = y + ri * 15;
      r.forEach(function (k) {
        var it = items[k];
        c.strokeStyle = it.color; c.fillStyle = it.color; c.lineWidth = it.width || 2; c.setLineDash(it.dash || []);
        if (it.dot) { c.beginPath(); c.arc(xx + 9, yy + 1, 4, 0, 2 * Math.PI); if (it.hollow) c.stroke(); else c.fill(); }
        else if (it.cross) { c.beginPath(); c.moveTo(xx + 5, yy - 3); c.lineTo(xx + 13, yy + 5); c.moveTo(xx + 5, yy + 5); c.lineTo(xx + 13, yy - 3); c.stroke(); }
        else { c.beginPath(); c.moveTo(xx, yy + 1); c.lineTo(xx + 20, yy + 1); c.stroke(); }
        c.setLineDash([]);
        c.fillStyle = U.css("--ink"); c.fillText(it.text, xx + 24, yy + 1);
        xx += widths[k];
      });
    });
    c.restore();
  }

  return { frame: frame, line: line, fillBetween: fillBetween, dot: dot, cross: cross, label: label, legend: legend, clip: clip, unclip: unclip, niceMax: niceMax };
})();

/* ================================================================ Q–H лаборатории */

var LabChart = (function () {
  "use strict";
  var PC = ["--p1", "--p2", "--p3"];

  function draw(cv, sim, opt) {
    var fc = U.fitCanvas(cv), ctx = fc.ctx;
    var cfg = sim.cfg, p = cfg.pump, v = cfg.vfd, c = cfg.ctrl, co = Pump.coef(p);
    sim.coef = co;
    var mode = c.mode, vfd = mode === "vfd1" || mode === "vfdAll" || mode === "manualVfd";
    var outMode = opt.yMode === "out";
    var rMax = Math.max(v.fMax, mode === "manualVfd" ? c.fManual : 0, p.fNom) / p.fNom;
    var N = cfg.pumpCount;
    var Rpv = sim.rpv();

    // Преобразование напора в коллекторе в ось Y
    function Yof(Hn, Q) { return outMode ? Hn : Hn - sim.hinAt(Q); }

    var qm = Pump.qMax(p, co, rMax);
    var xMax = Plot.niceMax(Math.max(qm * (1 + 0.8 * (N - 1)) * 0.95, sim.Qp * 1.2, sim.Qs * 1.2, 2));
    var pk = Pump.peak(p, co, rMax).H;
    var yMax = outMode ? Plot.niceMax(Math.max(sim.HinRaw + pk, c.Hset, sim.Hn, c.relayOff) * 1.1)
                       : Plot.niceMax(Math.max(pk, c.Hset - sim.hinAt(0), sim.Hn - sim.Hin, 5) * 1.15);
    var P = Plot.frame(ctx, fc.w, fc.h, {
      x1: xMax, y1: yMax, y0: 0,
      xLabel: "Q, м³/ч", yLabel: outMode ? "Напор на выходе, м" : "Напор насоса, м",
      y2: opt.eta && !outMode ? [0, 100] : null, y2Label: opt.eta && !outMode ? "КПД, %" : null
    });
    Plot.clip(P);

    var qs = [], i, k;
    for (i = 0; i <= 90; i++) qs.push(xMax * i / 90);

    function single(r) {
      return qs.map(function (Q) {
        var H = Pump.head(p, co, Q, r);
        if (H < -1) return null;
        return [Q, outMode ? sim.hinAt(Q) + H - Rpv * Q * Q : H];
      });
    }

    // Подпор (только на оси «напор на выходе»)
    if (outMode) {
      var hin = qs.map(function (Q) { return [Q, Math.max(0, sim.hinAt(Q))]; });
      Plot.fillBetween(P, hin, qs.map(function (Q) { return [Q, 0]; }), U.css("--muted"), 0.13);
      Plot.line(P, hin, { color: U.css("--muted"), width: 1.2 });
      Plot.label(P, xMax * 0.98, Math.max(0.5, sim.hinAt(xMax * 0.98)) , "подпор на вводе", U.css("--muted"), "right", "bottom");
    }

    // Поле регулирования ПЧ между f мин и f макс
    if (vfd && opt.range) {
      var top = single(v.fMax / p.fNom).filter(Boolean), bot = single(v.fMin / p.fNom).filter(Boolean);
      Plot.fillBetween(P, top, bot.length ? bot : [[0, 0]], U.css("--accent"), 0.07);
      Plot.line(P, top, { color: U.css("--muted"), width: 1, dash: [6, 4] });
      Plot.line(P, bot, { color: U.css("--muted"), width: 1, dash: [2, 3] });
      if (bot.length) {
        var bl = bot[Math.min(bot.length - 1, 6)];
        Plot.label(P, bl[0] + xMax * 0.01, bl[1] + 0.5, "f мин " + U.fmt(v.fMin, 0) + " Гц", U.css("--muted"), "left", "bottom");
      }
      var tl = top[Math.min(top.length - 1, 4)];
      if (tl) Plot.label(P, tl[0] + xMax * 0.01, tl[1] + 0.5, "f макс " + U.fmt(v.fMax, 0) + " Гц", U.css("--muted"), "left", "bottom");
    }
    if (opt.family) {
      for (var f = 20; f <= 60; f += 5) {
        var fam = single(f / p.fNom).filter(Boolean);
        Plot.line(P, fam, { color: U.css("--muted"), width: 0.8, alpha: 0.45 });
        if (fam.length) Plot.label(P, fam[0][0] + 0.2, fam[0][1], U.fmt(f, 0) + " Гц", U.css("--muted"), "left", "bottom");
      }
    }

    // Характеристика сети
    var Hlim = sim.headLimit(), Hlo = -5;
    var sys = [], zmin = Infinity;
    cfg.taps.forEach(function (t) { if (t.on && t.open > 0) zmin = Math.min(zmin, t.z); });
    if (isFinite(zmin) && isFinite(sim.rsys())) {
      for (i = 0; i <= 120; i++) {
        var Hs = zmin + (Hlim - zmin) * Math.pow(i / 120, 1.6);
        var Qs = sim.systemFlow(Hs);
        if (Qs > xMax * 1.05) break;
        sys.push([Qs, Yof(Hs, Qs)]);
      }
      Plot.line(P, sys, { color: U.css("--water"), width: 2.4 });
      var sl = sys[Math.max(0, sys.length - 1)];
      if (sl) Plot.label(P, sl[0], sl[1], "сеть", U.css("--water"), "right", "bottom", true);
    }

    // Уставка / пороги реле
    if (mode === "vfd1" || mode === "vfdAll") {
      var sp = sim.setpoint();
      Plot.line(P, qs.map(function (Q) { return [Q, Yof(sp, Q)]; }), { color: U.css("--bad"), width: 1.2, dash: [7, 4] });
      Plot.label(P, xMax * 0.99, Yof(sp, xMax * 0.99) + 0.3, "уставка " + U.fmt(sp, 1) + " м", U.css("--bad"), "right", "bottom", true);
    } else if (mode === "relay") {
      [["вкл", c.relayOn], ["выкл", c.relayOff]].forEach(function (a) {
        Plot.line(P, qs.map(function (Q) { return [Q, Yof(a[1], Q)]; }), { color: U.css("--bad"), width: 1, dash: [3, 3] });
        Plot.label(P, xMax * 0.99, Yof(a[1], xMax * 0.99) + 0.3, "реле: " + a[0] + " " + U.fmt(a[1], 0) + " м (насос 1)", U.css("--bad"), "right", "bottom", true);
      });
    }

    // Кривые отдельных насосов на их текущей частоте
    for (i = 0; i < N; i++) {
      var ps = sim.pumps[i];
      if (ps.f < 0.5) continue;
      var r = ps.f / p.fNom;
      var cur = qs.map(function (Q) {
        var H = ps.cav * Pump.head(p, co, Q, r);
        if (H < -1) return null;
        return [Q, outMode ? sim.hinAt(Q) + H - Rpv * Q * Q : H];
      });
      Plot.line(P, cur, { color: U.css(PC[i]), width: 1.3, dash: [5, 3], alpha: 0.9 });
    }

    // Совместная кривая работающих насосов (параллельная работа, с потерями на вводе)
    var anyRun = false;
    for (i = 0; i < N; i++) if (sim.pumps[i].f > 0.5) anyRun = true;
    if (anyRun) {
      var comb = [];
      var Hstart = Math.min(sim.HinRaw - 2, 0);
      for (i = 0; i <= 140; i++) {
        var Hc = Hstart + (Hlim - Hstart) * i / 140;
        var Qc = sim.pumpsTotal(Hc);
        if (Qc > xMax * 1.1) continue;
        comb.push([Qc, Yof(Hc, Qc)]);
        if (Qc <= 1e-6) break;
      }
      Plot.line(P, comb, { color: U.css("--accent"), width: 3 });
    }

    // КПД ведущего насоса
    if (opt.eta && !outMode) {
      for (i = 0; i < N; i++) {
        var pe = sim.pumps[i];
        if (pe.f < 3) continue;
        var re = pe.f / p.fNom;
        Plot.line(P, qs.map(function (Q) { var e = Pump.eta(p, co, Q, re); return e > 0 ? [Q, 100 * e] : null; }), { color: U.css(PC[i]), width: 1, dash: [1, 3] }, true);
        break;
      }
    }

    // Парабола подобных режимов через точку ведущего насоса
    if (opt.parabola && !outMode) {
      for (i = 0; i < N; i++) {
        var pp = sim.pumps[i];
        if (pp.f < 3 || pp.Q < 0.2) continue;
        var kk = pp.H / (pp.Q * pp.Q);
        Plot.line(P, qs.map(function (Q) { return [Q, kk * Q * Q]; }), { color: U.css("--est"), width: 1, dash: [2, 4] });
        var qlab = Math.min(xMax * 0.9, Math.sqrt(yMax * 0.92 / kk));
        Plot.label(P, qlab, kk * qlab * qlab, "парабола подобия H = k·Q²", U.css("--est"), "right", "top");
        break;
      }
    }

    // След рабочей точки
    if (opt.trail && sim.hist.length > 2) {
      var n = Math.min(sim.hist.length, 250), ctx2 = P.ctx;
      for (k = sim.hist.length - n + 1; k < sim.hist.length; k++) {
        var a = sim.hist[k - 1], b = sim.hist[k];
        var al = (k - (sim.hist.length - n)) / n;
        ctx2.strokeStyle = U.css("--accent"); ctx2.globalAlpha = 0.1 + 0.6 * al; ctx2.lineWidth = 2;
        ctx2.beginPath(); ctx2.moveTo(P.X(a.Qp), P.Y(Yof(a.Hn, a.Qp))); ctx2.lineTo(P.X(b.Qp), P.Y(Yof(b.Hn, b.Qp))); ctx2.stroke();
      }
      ctx2.globalAlpha = 1;
    }

    // Цель — точка равновесия при текущих оборотах
    var eq = opt.eq;
    if (eq && anyRun && eq.Q > 0.01) Plot.cross(P, eq.Q, Yof(eq.H, eq.Q), 6, U.css("--ink"));

    // Точки насосов
    for (i = 0; i < N; i++) {
      var pd = sim.pumps[i];
      if (pd.f < 0.5) continue;
      var y = outMode ? sim.Hin + pd.H - Rpv * pd.Q * pd.Q : pd.H;
      Plot.dot(P, pd.Q, y, 4.5, U.css(PC[i]), U.css("--panel"), 1.5);
    }
    // Потребители и суммарная подача
    Plot.dot(P, sim.Qs, Yof(sim.Hn, sim.Qs), 6.5, null, U.css("--water"), 2.5);
    if (anyRun) Plot.dot(P, sim.Qp, Yof(sim.Hn, sim.Qp), 5.5, U.css("--accent"), U.css("--panel"), 1.5);

    Plot.unclip(P);

    var items = [
      { text: "насосы вместе", color: U.css("--accent"), width: 3 },
      { text: "насос 1/2/3 на своей частоте", color: U.css("--p1"), dash: [5, 3] },
      { text: "сеть", color: U.css("--water"), width: 2.4 },
      { text: "подача", color: U.css("--accent"), dot: true },
      { text: "разбор", color: U.css("--water"), dot: true, hollow: true },
      { text: "куда стремится", color: U.css("--ink"), cross: true }
    ];
    Plot.legend(P, items);
    return P;
  }

  return { draw: draw };
})();

/* ================================================================ Осциллограф */

var Trends = (function () {
  "use strict";
  var PC = ["--p1", "--p2", "--p3"];

  function draw(cv, sim, win) {
    var fc = U.fitCanvas(cv), ctx = fc.ctx, w = fc.w, h = fc.h;
    ctx.clearRect(0, 0, w, h);
    var H = sim.hist, cfg = sim.cfg, N = cfg.pumpCount;
    var t1 = Math.max(sim.t, win), t0 = t1 - win;
    var data = [];
    for (var k = 0; k < H.length; k++) if (H[k].t >= t0 - 0.2) data.push(H[k]);

    var lanes = [
      { name: "Давление, м", h: 0.34 },
      { name: "Частота, Гц", h: 0.22 },
      { name: "Расход, м³/ч", h: 0.26 },
      { name: "Мощность, кВт", h: 0.18 }
    ];
    var top = 4, bottom = h - 18, avail = bottom - top, gap = 6;
    var y = top;
    lanes.forEach(function (ln) { ln.T = y; ln.B = y + ln.h * avail - gap; y += ln.h * avail; });

    function mk(ln, y0, y1) {
      var p = { ctx: ctx, L: 44, R: w - 10, T: ln.T, B: ln.B, x0: t0, x1: t1, y0: y0, y1: y1 };
      p.X = function (x) { return p.L + (x - p.x0) / (p.x1 - p.x0) * (p.R - p.L); };
      p.Y = function (v) { return p.B - (v - p.y0) / (p.y1 - p.y0) * (p.B - p.T); };
      ctx.strokeStyle = U.css("--grid"); ctx.fillStyle = U.css("--muted"); ctx.lineWidth = 1;
      ctx.font = "10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      var s = U.niceStep(y1 - y0, 3);
      for (var v = Math.ceil(y0 / s) * s; v <= y1 + 1e-9; v += s) {
        var Y = Math.round(p.Y(v)) + 0.5;
        ctx.beginPath(); ctx.moveTo(p.L, Y); ctx.lineTo(p.R, Y); ctx.stroke();
        ctx.fillText(U.fmt(v, s < 1 ? 1 : 0), p.L - 4, Y);
      }
      ctx.strokeStyle = U.css("--axis");
      ctx.strokeRect(p.L + 0.5, p.T + 0.5, p.R - p.L, p.B - p.T);
      ctx.fillStyle = U.css("--ink"); ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.font = "600 10.5px system-ui, Segoe UI, sans-serif";
      ctx.fillText(ln.name, p.L + 5, p.T + 3);
      return p;
    }
    function series(p, get, st) {
      var pts = data.map(function (d) { var v = get(d); return v === null || v === undefined ? null : [d.t, v]; });
      Plot.clip(p); Plot.line(p, pts, st); Plot.unclip(p);
    }
    function range(get) {
      var a = Infinity, b = -Infinity;
      data.forEach(function (d) { var vs = get(d); vs.forEach(function (v) { if (v !== null && isFinite(v)) { a = Math.min(a, v); b = Math.max(b, v); } }); });
      if (!isFinite(a)) { a = 0; b = 1; }
      return [a, b];
    }

    // Давление
    var pr = range(function (d) { return [d.Hn, d.sp, d.Hin]; });
    var c = cfg.ctrl;
    if (c.mode === "relay") { pr[0] = Math.min(pr[0], c.relayOn - (N - 1) * c.relayStep); pr[1] = Math.max(pr[1], c.relayOff); }
    var p1 = mk(lanes[0], Math.max(0, Math.floor((pr[0] - 3) / 5) * 5), Math.ceil((pr[1] + 3) / 5) * 5);
    if (c.mode === "relay") {
      for (var j = 0; j < N; j++) {
        series(p1, function () { return c.relayOn - j * c.relayStep; }, { color: U.css("--bad"), width: 0.8, dash: [2, 3], alpha: 0.6 });
        series(p1, function () { return c.relayOff - j * c.relayStep; }, { color: U.css("--bad"), width: 0.8, dash: [2, 3], alpha: 0.6 });
      }
    }
    series(p1, function (d) { return d.Hin; }, { color: U.css("--muted"), width: 1.2 });
    series(p1, function (d) { return d.sp; }, { color: U.css("--bad"), width: 1.2, dash: [6, 3] });
    series(p1, function (d) { return d.Hn; }, { color: U.css("--ink"), width: 1.8 });
    lbl(p1, [["выход", "--ink"], ["уставка", "--bad"], ["подпор", "--muted"]]);

    // Частота
    var p2 = mk(lanes[1], 0, Math.max(60, Math.ceil(cfg.ctrl.fManual / 10) * 10));
    for (var i = 0; i < N; i++) (function (i) { series(p2, function (d) { return d.f[i]; }, { color: U.css(PC[i]), width: 1.6 }); })(i);
    series(p2, function () { return cfg.vfd.fMin; }, { color: U.css("--muted"), width: 0.8, dash: [2, 3] });

    // Расход
    var qr = range(function (d) { return [d.Qp, d.Qs]; });
    var p3 = mk(lanes[2], 0, Math.max(2, Math.ceil(qr[1] * 1.15 + 0.5)));
    for (var i2 = 0; i2 < N; i2++) (function (i) { series(p3, function (d) { return d.q[i]; }, { color: U.css(PC[i]), width: 1, alpha: 0.8 }); })(i2);
    series(p3, function (d) { return d.Qp; }, { color: U.css("--accent"), width: 2 });
    series(p3, function (d) { return d.Qs; }, { color: U.css("--water"), width: 1.6, dash: [5, 3] });
    lbl(p3, [["подача", "--accent"], ["разбор", "--water"]]);

    // Мощность
    var er = range(function (d) { return [d.P]; });
    var p4 = mk(lanes[3], 0, Math.max(0.5, Math.ceil(er[1] * 1.2 * 2) / 2));
    series(p4, function (d) { return d.P; }, { color: U.css("--warn"), width: 1.6 });

    // Ось времени
    ctx.fillStyle = U.css("--muted"); ctx.font = "10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    var ts = U.niceStep(win, 6);
    for (var t = Math.ceil(t0 / ts) * ts; t <= t1; t += ts) ctx.fillText(U.fmt(t, 0) + " с", p4.X(t), p4.B + 3);

    function lbl(p, arr) {
      ctx.font = "10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "top";
      var x = p.R - 5;
      for (var a = arr.length - 1; a >= 0; a--) {
        ctx.fillStyle = U.css(arr[a][1]);
        ctx.fillText(arr[a][0], x, p.T + 3);
        x -= ctx.measureText(arr[a][0]).width + 10;
      }
    }
  }

  return { draw: draw };
})();
