/* Графики на холстах: оси и сетка, кривые, заливки, легенда и осциллограф. */
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


  /* Вертикальная и горизонтальная отметки на поле графика. */
  function vline(p, x, st) {
    var c = p.ctx; c.save();
    c.strokeStyle = st.color; c.lineWidth = st.width || 1.2; c.setLineDash(st.dash || [5, 4]); c.globalAlpha = st.alpha || 1;
    var X = Math.round(p.X(x)) + 0.5;
    c.beginPath(); c.moveTo(X, p.T); c.lineTo(X, p.B); c.stroke(); c.restore();
  }
  function hline(p, y, st) {
    var c = p.ctx; c.save();
    c.strokeStyle = st.color; c.lineWidth = st.width || 1.2; c.setLineDash(st.dash || [5, 4]); c.globalAlpha = st.alpha || 1;
    var Y = Math.round(p.Y(y)) + 0.5;
    c.beginPath(); c.moveTo(p.L, Y); c.lineTo(p.R, Y); c.stroke(); c.restore();
  }

  /* Заливка полосы по оси y (например, зона кавитации или переходного режима). */
  function band(p, ya, yb, color, alpha) {
    var c = p.ctx; c.save(); c.fillStyle = color; c.globalAlpha = alpha === undefined ? 0.12 : alpha;
    var y1 = p.Y(Math.max(ya, yb)), y2 = p.Y(Math.min(ya, yb));
    c.fillRect(p.L, Math.max(p.T, y1), p.R - p.L, Math.min(p.B, y2) - Math.max(p.T, y1));
    c.restore();
  }
  function bandX(p, xa, xb, color, alpha) {
    var c = p.ctx; c.save(); c.fillStyle = color; c.globalAlpha = alpha === undefined ? 0.12 : alpha;
    var x1 = p.X(Math.min(xa, xb)), x2 = p.X(Math.max(xa, xb));
    c.fillRect(Math.max(p.L, x1), p.T, Math.min(p.R, x2) - Math.max(p.L, x1), p.B - p.T);
    c.restore();
  }

  /* Столбики: items = [{x, y, color, label}] в координатах поля. */
  function bars(p, items, wFrac) {
    var c = p.ctx, n = items.length;
    if (!n) return;
    var step = (p.R - p.L) / n, w = step * (wFrac || 0.6);
    c.save();
    items.forEach(function (it, i) {
      var X = p.L + step * (i + 0.5), Y = p.Y(it.y), Y0 = p.Y(0);
      c.fillStyle = it.color;
      c.fillRect(X - w / 2, Math.min(Y, Y0), w, Math.abs(Y0 - Y));
      if (it.label) {
        c.fillStyle = U.css("--muted"); c.font = "11px system-ui, Segoe UI, sans-serif";
        c.textAlign = "center"; c.textBaseline = "top";
        c.fillText(it.label, X, p.B + 4);
      }
    });
    c.restore();
  }

  /* --------------------------------------------------------------- осциллограф */

  /* Кольцевой буфер показаний: push(t, {ключ: значение}). */
  function Trend(capacity) {
    this.cap = capacity || 6000;
    this.t = [];
    this.v = {};
    this.head = 0;
    this.n = 0;
  }
  Trend.prototype.push = function (t, vals) {
    var i = this.head;
    this.t[i] = t;
    for (var k in vals) {
      if (!this.v[k]) this.v[k] = [];
      this.v[k][i] = vals[k];
    }
    this.head = (i + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  };
  Trend.prototype.clear = function () { this.t = []; this.v = {}; this.head = 0; this.n = 0; };
  /* Точки [t, значение] за последние win секунд, в порядке времени. */
  Trend.prototype.series = function (key, t1, win) {
    var out = [], arr = this.v[key];
    if (!arr) return out;
    var start = (this.head - this.n + this.cap) % this.cap;
    for (var j = 0; j < this.n; j++) {
      var i = (start + j) % this.cap;
      if (this.t[i] >= t1 - win - 1e-9 && arr[i] !== undefined) out.push([this.t[i], arr[i]]);
    }
    return out;
  };
  Trend.prototype.last = function (key) {
    var arr = this.v[key];
    if (!arr || !this.n) return undefined;
    return arr[(this.head - 1 + this.cap) % this.cap];
  };
  /* Размах значений по нескольким ключам за окно — для автомасштаба. */
  Trend.prototype.range = function (keys, t1, win) {
    var lo = 1e30, hi = -1e30, self = this;
    keys.forEach(function (k) {
      self.series(k, t1, win).forEach(function (q) {
        if (q[1] < lo) lo = q[1];
        if (q[1] > hi) hi = q[1];
      });
    });
    if (lo > hi) return null;
    return [lo, hi];
  };

  /* Готовый осциллограф: холст, буфер, набор кривых.
     series = [{key, color, text, width, dash, y2}] */
  function trendChart(cv, tr, t1, win, series, o) {
    o = o || {};
    var f = U.fitCanvas(cv), keys = series.filter(function (s) { return !s.y2; }).map(function (s) { return s.key; });
    var r = tr.range(keys, t1, win) || [0, 1];
    var lo = o.y0 !== undefined ? o.y0 : r[0], hi = o.y1 !== undefined ? o.y1 : r[1];
    if (hi - lo < (o.minSpan || 1e-6)) { var m = (hi + lo) / 2, s = (o.minSpan || 1) / 2; lo = m - s; hi = m + s; }
    var padY = (hi - lo) * 0.12;
    var opts = {
      x0: Math.max(0, t1 - win), x1: Math.max(win, t1), y0: lo - padY, y1: hi + padY,
      xLabel: o.xLabel || "время, с", yLabel: o.yLabel, y2Label: o.y2Label,
      xFmt: o.xFmt, xTicks: o.xTicks || 7
    };
    if (o.y2) opts.y2 = o.y2;
    var p = frame(f.ctx, f.w, f.h, opts);
    if (o.bands) o.bands.forEach(function (b) { band(p, b[0], b[1], b[2], b[3]); });
    clip(p);
    series.forEach(function (s) {
      line(p, tr.series(s.key, t1, win), { color: s.color, width: s.width || 1.8, dash: s.dash }, s.y2);
    });
    unclip(p);
    legend(p, series.map(function (s) { return { color: s.color, text: s.text, dash: s.dash }; }));
    return p;
  }

  return {
    frame: frame, line: line, fillBetween: fillBetween, dot: dot, cross: cross, label: label,
    legend: legend, clip: clip, unclip: unclip, niceMax: niceMax,
    vline: vline, hline: hline, band: band, bandX: bandX, bars: bars,
    Trend: Trend, trendChart: trendChart
  };
})();
