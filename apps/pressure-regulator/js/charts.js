/*
  Два графика для выбранной установки, всё в метрах водяного столба.

  1. Q–H: кривая насоса и потребный напор при разных напорах в сети.
     Без ПЧ — рабочая точка съезжает вправо при росте напора на входе
     (слайд «Стандартный насос»). С ПЧ — видно, где потребный напор уходит
     ниже кривой минимальной частоты (слайд «Регулируемый насос»).
  2. «Лестница напоров» по пути воды: диапазоны без регулятора и с ним,
     как стрелки «15…58 м → 10…20 м» в пособии.
*/
var Charts = (function () {
  "use strict";

  var n = Fmt.num, g = Fmt.g, isSet = Fmt.isSet;
  var C = {
    lo: "#2f7dd1", hi: "#e07b00", reg: "#0f8a7e", live: "#1d2733", pump: "#1d2733",
    grid: "#e6ebf0", axis: "#8a97a5", shade: "#e9edf1", bad: "#c62f2f", noreg: "#b7c1cb"
  };
  var W = 560, H = 340, M = { l: 50, r: 16, t: 14, b: 42 };
  var clipSeq = 0;

  function f1(v) { return (Math.round(v * 10) / 10).toString(); }
  function m1(v) { return n(v, 1) + " м"; }

  function niceStep(range, count) {
    var raw = range / Math.max(count, 1);
    if (!(raw > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * mag >= raw - 1e-12) return steps[i] * mag;
    return 10 * mag;
  }

  function line(x1, y1, x2, y2, stroke, w, extra) {
    return '<line x1="' + f1(x1) + '" y1="' + f1(y1) + '" x2="' + f1(x2) + '" y2="' + f1(y2) + '" stroke="' + stroke + '" stroke-width="' + (w || 1) + '"' + (extra || "") + "/>";
  }

  // В SVG-тексте нельзя HTML-теги: <sub> закрывает <svg> при разборе innerHTML.
  function txt(x, y, t, cls, anchor, fill) {
    return '<text x="' + f1(x) + '" y="' + f1(y) + '" class="' + cls + '" text-anchor="' + (anchor || "middle") + '"' + (fill ? ' fill="' + fill + '"' : "") + ">" + t + "</text>";
  }

  function frame(xMaxRaw, yMaxRaw, xLabel, yLabel, noX) {
    var pw = W - M.l - M.r, ph = H - M.t - M.b;
    var xs = niceStep(xMaxRaw, 6), ys = niceStep(yMaxRaw, 6);
    var xMax = Math.max(xs, Math.ceil(xMaxRaw / xs - 1e-9) * xs);
    var yMax = Math.max(ys, Math.ceil(yMaxRaw / ys - 1e-9) * ys);
    var X = function (v) { return M.l + (v / xMax) * pw; };
    var Y = function (v) { return M.t + ph - (v / yMax) * ph; };
    var id = "chClip" + (++clipSeq);
    var s = [];
    s.push('<defs><clipPath id="' + id + '"><rect x="' + M.l + '" y="' + M.t + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>');
    var k, v;
    if (!noX) {
      for (k = 0; (v = k * xs) <= xMax + 1e-9; k++) {
        s.push(line(X(v), M.t, X(v), M.t + ph, C.grid));
        s.push(txt(X(v), M.t + ph + 16, g(v, 2), "ax"));
      }
    }
    for (k = 0; (v = k * ys) <= yMax + 1e-9; k++) {
      s.push(line(M.l, Y(v), M.l + pw, Y(v), C.grid));
      s.push(txt(M.l - 6, Y(v) + 4, g(v, 2), "ax", "end"));
    }
    s.push('<rect x="' + M.l + '" y="' + M.t + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="' + C.axis + '"/>');
    if (xLabel) s.push(txt(M.l + pw / 2, H - 6, xLabel, "al"));
    s.push('<text class="al" transform="translate(14 ' + f1(M.t + ph / 2) + ') rotate(-90)" text-anchor="middle">' + yLabel + "</text>");
    return { X: X, Y: Y, xMax: xMax, yMax: yMax, clip: id, grid: s.join(""), pw: pw, ph: ph };
  }

  function sample(fn, x0, x1, steps) {
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var q = x0 + (x1 - x0) * i / steps;
      pts.push([q, fn(q)]);
    }
    return pts;
  }

  function path(fr, pts, stroke, w, extra) {
    var d = pts.map(function (p, i) {
      var y = Fmt.clamp(fr.Y(p[1]), -2000, 4000);
      return (i ? "L" : "M") + f1(fr.X(p[0])) + " " + f1(y);
    }).join(" ");
    return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + (w || 2) + '" stroke-linejoin="round"' + (extra || "") + "/>";
  }

  function dot(fr, q, h, fill, label, labelDy, ring) {
    var x = fr.X(q), y = fr.Y(h);
    var s = ring
      ? '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="7" fill="#fff" stroke="' + fill + '" stroke-width="3"/>'
      : '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="4.5" fill="' + fill + '" stroke="#fff" stroke-width="1.5"/>';
    if (label) s += txt(x + 8, y + (labelDy || -8), label, "pl", "start", fill);
    return s;
  }

  function legendHtml(items) {
    return items.map(function (it) {
      return '<span class="lg"><i style="border-color:' + it.col + (it.dash ? ";border-top-style:dashed" : "") + (it.box ? ";background:" + it.col + ";height:10px;border-width:0" : "") + '"></i>' + it.label + "</span>";
    }).join("");
  }

  // ----------------------------------------------------------------- Q–H

  function qh(host, legend, project, res, r, sim, live) {
    if (!r || !r.valid) {
      host.innerHTML = '<p class="muted pad">Нет данных для графика.</p>';
      legend.innerHTML = "";
      return;
    }
    var m = Calc.model(project, r), inl = project.inlet;
    var st = sim.byId[r.id];
    var reg = Calc.regulatorFor(project, res, r);
    var regLive = live.regOn ? reg : null;
    var items = [], body = [], marks = [];
    var qZero = Math.sqrt(m.h0 / m.a);

    if (r.drive === "const") {
      var reqFn = function (hNet, rg, phi) {
        var bPhi = m.b / (phi * phi);
        return function (Q) { return m.S + bPhi * Q * Q - Calc.inletAt(m, hNet, Q, rg, 0).after; };
      };
      var cases = [
        { label: "потребный при Н<sub>гар.min</sub> = " + g(inl.hGarMin) + " м", hNet: inl.hGarMin, rg: null, col: C.lo, op: r.op.design, mark: "Р.Т." },
        { label: "потребный при Н<sub>макс</sub> = " + g(inl.hMax) + " м, без РД", hNet: inl.hMax, rg: null, col: C.hi, op: r.op.maxNoReg, mark: "без РД" }
      ];
      if (reg) cases.push({ label: "потребный при Н<sub>макс</sub>, с РД " + m1(reg.setpoint), hNet: inl.hMax, rg: reg, col: C.reg, op: r.op.maxReg || Calc.simSystem(project, r, { hNet: inl.hMax, phi: 1, fire: "fire" }, reg, 0), mark: "с РД" });

      var xMax = Math.max(m.qd * 1.5, st && st.on ? st.Q * 1.15 : 0);
      cases.forEach(function (c) { xMax = Math.max(xMax, c.op.Q * 1.15); });
      xMax = Math.min(xMax, qZero * 1.02);
      var fr = frame(xMax, m.h0 * 1.15, "Q, л/с", "H, м");

      body.push(path(fr, sample(function (Q) { return Calc.pumpHead(m, 1, Q); }, 0, Math.min(qZero, fr.xMax), 60), C.pump, 3));
      items.push({ col: C.pump, label: "насос (парабола через H<sub>Q=0</sub> и рабочую точку)" });

      cases.forEach(function (c, i) {
        body.push(path(fr, sample(reqFn(c.hNet, c.rg, 1), 0, fr.xMax, 60), c.col, 2));
        items.push({ col: c.col, label: c.label });
        if (c.op.Q > 0) {
          marks.push(line(fr.X(c.op.Q), fr.Y(c.op.H), fr.X(c.op.Q), fr.Y(0), c.col, 1, ' stroke-dasharray="4 3"'));
          marks.push(txt(fr.X(c.op.Q), fr.Y(0) - 6 - i * 12, "Q" + (i + 1) + " = " + n(c.op.Q, 1), "pl", "middle", c.col));
          marks.push(dot(fr, c.op.Q, c.op.H, c.col, c.mark, -8 - i * 2));
        }
      });

      if (st && st.on) {
        if (st.phi > 0) {
          body.push(path(fr, sample(reqFn(live.hNet, regLive, st.phi), 0, fr.xMax, 60), C.live, 1.6, ' stroke-dasharray="6 4"'));
          items.push({ col: C.live, dash: true, label: "сейчас: Н сети = " + m1(live.hNet) + ", водоразбор " + Math.round(st.phi * 100) + " %" });
        }
        marks.push(dot(fr, st.Q, st.H, C.live, "сейчас", 18, true));
      }
      finish(host, fr, body, marks, st);
    } else {
      var nMin2 = m.nMin * m.nMin;
      var reqV = function (hNet, rg) {
        return function (Q) { return m.hOutSet - Calc.inletAt(m, hNet, Q, rg, 0).after; };
      };
      var fr2 = frame(Math.min(m.qd * 1.6, qZero), m.h0 * 1.15, "Q, л/с", "H, м");
      var qMinZero = Math.sqrt(nMin2 * m.h0 / m.a);

      var shade = sample(function (Q) { return Calc.pumpHead(m, nMin2, Q); }, 0, Math.min(qMinZero, fr2.xMax), 40);
      var poly = shade.map(function (p) { return f1(fr2.X(p[0])) + "," + f1(fr2.Y(p[1])); }).join(" ");
      poly += " " + f1(fr2.X(shade[shade.length - 1][0])) + "," + f1(fr2.Y(0)) + " " + f1(fr2.X(0)) + "," + f1(fr2.Y(0));
      body.push('<polygon points="' + poly + '" fill="' + C.shade + '"/>');
      items.push({ col: C.shade, box: true, label: "ниже кривой f<sub>min</sub> ПЧ опуститься не может" });

      body.push(path(fr2, sample(function (Q) { return Calc.pumpHead(m, 1, Q); }, 0, Math.min(qZero, fr2.xMax), 60), C.pump, 3));
      body.push(path(fr2, shade, C.pump, 1.6, ' stroke-dasharray="5 4"'));
      marks.push(txt(fr2.X(0) + 6, fr2.Y(nMin2 * m.h0) - 6, g(r.fMin) + " Гц", "pl", "start", C.pump));
      marks.push(txt(fr2.X(0) + 6, fr2.Y(m.h0) - 6, g(m.fNom) + " Гц", "pl", "start", C.pump));
      items.push({ col: C.pump, label: "насос на " + g(m.fNom) + " Гц и на f<sub>min</sub> = " + g(r.fMin) + " Гц" });

      var vc = [
        { label: "нужный напор при Н<sub>гар.min</sub>", hNet: inl.hGarMin, rg: null, col: C.lo },
        { label: "нужный напор при Н<sub>макс</sub>, без РД", hNet: inl.hMax, rg: null, col: C.hi }
      ];
      if (reg) vc.push({ label: "нужный напор при Н<sub>макс</sub>, с РД " + m1(reg.setpoint), hNet: inl.hMax, rg: reg, col: C.reg });
      vc.forEach(function (c, i) {
        var fn = reqV(c.hNet, c.rg);
        body.push(path(fr2, sample(fn, 0, fr2.xMax, 40), c.col, 2));
        items.push({ col: c.col, label: c.label + " (Н<sub>вых</sub> = " + m1(m.hOutSet) + ")" });
        var h0 = fn(0);
        var below = h0 < nMin2 * m.h0 - 1e-6;
        if (h0 >= 0) marks.push(dot(fr2, 0, h0, below ? C.bad : c.col, below ? "Q = 0: ниже f мин" : "", 14 + i * 2));
        else marks.push(txt(fr2.X(0) + 8, fr2.Y(0) - 8 - i * 12, "вход выше Н вых", "pl", "start", C.bad));
      });

      if (st && st.on) {
        if (st.n2 > 0) body.push(path(fr2, sample(function (Q) { return Calc.pumpHead(m, st.n2, Q); }, 0, fr2.xMax, 50), C.reg, 1.4, ' stroke-dasharray="2 3"'));
        items.push({ col: C.reg, dash: true, label: "насос сейчас: " + n(st.f, 1) + " Гц" });
        marks.push(dot(fr2, st.Q, st.H, st.status === "fmin" ? C.bad : C.live, "сейчас", 18, true));
      }
      finish(host, fr2, body, marks, st);
    }
    legend.innerHTML = legendHtml(items) + (m.hStEst || r.h0Est ? '<span class="lg est">≈ кривые построены по оценочным данным</span>' : "");
  }

  function finish(host, fr, body, marks, st) {
    var s = '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' + fr.grid +
      '<g clip-path="url(#' + fr.clip + ')">' + body.join("") + marks.join("") + "</g>";
    if (st && !st.on) s += txt(W - M.r - 8, M.t + 18, "насосы выключены", "pl", "end", C.axis);
    host.innerHTML = s + "</svg>";
  }

  // ----------------------------------------------------------------- лестница напоров

  function ladder(host, legend, project, res, r, sim) {
    if (!r || !r.valid) {
      host.innerHTML = '<p class="muted pad">Нет данных для графика.</p>';
      legend.innerHTML = "";
      return;
    }
    var st = sim.byId[r.id], sys = r.sys, K = r.K;
    var nodes = [
      { name: ["Сеть у точки", "подключения"], a: [r.hConnMin, r.hConnMax], b: [r.hConnMin, r.hConnMax], live: st && st.hConn },
      { name: ["После ввода", "и водомера"], a: [r.hInMin, r.hInMax], b: [r.hInMin, r.hInMax], live: st && st.hBefore },
      { name: ["Всас", "насосов"], a: [r.hInMin, r.hInMax], b: [r.hInMinAfter, r.hInMaxAfter], live: st && st.hIn },
      { name: ["Выход", "насосов"], a: [r.hOutLo, r.hNetMaxNoReg], b: [r.hOutLo - (r.drive === "const" ? r.dhOpen : 0), r.hNetMax], live: st && st.hOut }
    ];
    var pnHead = isSet(sys.pn) ? sys.pn * K : null;
    var yMax = 0;
    nodes.forEach(function (nd) { yMax = Math.max(yMax, nd.a[1], nd.b[1], nd.live || 0); });
    if (pnHead !== null) yMax = Math.max(yMax, pnHead);
    if (isSet(sys.hNetAllow)) yMax = Math.max(yMax, sys.hNetAllow);
    var fr = frame(4, yMax * 1.12, "", "Н, м", true);
    var s = [fr.grid];
    var colW = fr.pw / 4;
    var cx = function (i) { return M.l + colW * (i + 0.5); };
    var items = [];

    function bar(x, lo, hi, fill, labels) {
      var y1 = fr.Y(hi), y2 = fr.Y(lo);
      if (y2 - y1 < 3) { y1 -= 1.5; y2 += 1.5; }
      var out = '<rect x="' + f1(x - 11) + '" y="' + f1(y1) + '" width="22" height="' + f1(y2 - y1) + '" rx="3" fill="' + fill + '"/>';
      if (labels) {
        out += txt(x, y1 - 4, n(hi, 0), "bl", "middle", labels);
        if (hi - lo > 0.5) out += txt(x, y2 + 11, n(lo, 0), "bl", "middle", labels);
      }
      return out;
    }

    nodes.forEach(function (nd, i) {
      var x = cx(i);
      if (r.hasReg) {
        s.push(bar(x - 14, nd.a[0], nd.a[1], C.noreg, "#6b7784"));
        s.push(bar(x + 14, nd.b[0], nd.b[1], C.reg, C.reg));
      } else {
        s.push(bar(x, nd.a[0], nd.a[1], C.lo, C.lo));
      }
      s.push(txt(x, H - M.b + 16, nd.name[0], "ax"));
      s.push(txt(x, H - M.b + 31, nd.name[1], "ax"));
    });
    if (r.hasReg) {
      items.push({ col: C.noreg, box: true, label: "диапазон без регулятора, м" });
      items.push({ col: C.reg, box: true, label: "с регулятором, м" });
    } else {
      items.push({ col: C.lo, box: true, label: "диапазон напоров, м (регулятор не нужен)" });
    }

    var x0 = M.l, x1 = M.l + fr.pw;
    if (r.hasReg) {
      s.push(line(cx(1) + 30, fr.Y(r.setpoint), cx(2) + 34, fr.Y(r.setpoint), C.reg, 1.5, ' stroke-dasharray="2 3"'));
      s.push(txt(cx(1) + 30, fr.Y(r.setpoint) - 5, "уставка " + m1(r.setpoint), "pl", "start", C.reg));
    }
    if (pnHead !== null) {
      s.push(line(x0, fr.Y(pnHead), x1, fr.Y(pnHead), C.hi, 1.5, ' stroke-dasharray="7 4"'));
      s.push(txt(x1 - 4, fr.Y(pnHead) - 5, "PN" + sys.pn + " установки = " + g(pnHead) + " м", "pl", "end", C.hi));
      items.push({ col: C.hi, dash: true, label: "исполнение установки" });
    }
    if (isSet(sys.hNetAllow)) {
      s.push(line(x0, fr.Y(sys.hNetAllow), x1, fr.Y(sys.hNetAllow), C.bad, 1.5, ' stroke-dasharray="7 4"'));
      s.push(txt(x1 - 4, fr.Y(sys.hNetAllow) + 13, "допустимо в сети " + g(sys.hNetAllow) + " м", "pl", "end", C.bad));
      items.push({ col: C.bad, dash: true, label: "допустимый напор сети" });
    }

    if (st) {
      var pts = nodes.map(function (nd, i) { return f1(cx(i)) + "," + f1(fr.Y(nd.live)); }).join(" ");
      s.push('<polyline points="' + pts + '" fill="none" stroke="' + C.live + '" stroke-width="1.6" stroke-dasharray="5 4"/>');
      nodes.forEach(function (nd, i) {
        s.push('<circle cx="' + f1(cx(i)) + '" cy="' + f1(fr.Y(nd.live)) + '" r="5" fill="#fff" stroke="' + C.live + '" stroke-width="2.4"/>');
      });
      items.push({ col: C.live, dash: true, label: "сейчас (по ползункам)" });
    }

    host.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg">' + s.join("") + "</svg>";
    legend.innerHTML = legendHtml(items);
  }

  return { qh: qh, ladder: ladder };
})();
