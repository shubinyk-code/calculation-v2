/*
  Принципиальная схема: наружная сеть → колодец (точка подключения) → ввод →
  водомерный узел с обводной линией → [общий регулятор] → коллектор →
  по строке на каждую установку: [регулятор] → насосная установка → сеть.
  Все значения — в метрах водяного столба.

  Схема перерисовывается целиком при каждом изменении — она небольшая.
  Бегущий пунктир («течёт вода») сдвигается отдельно, в animate(): смещение
  считается от абсолютного времени, поэтому перерисовка его не сбивает.
*/
var Scheme = (function () {
  "use strict";

  var n = Fmt.num, g = Fmt.g, esc = Fmt.esc, isSet = Fmt.isSet;
  var W = 1240, ROW = 170, Y0 = 118;
  var X = {
    main: 36, well: 104, wall: 168, meter: 242, gMeter: 342, creg: 432, gCreg: 520,
    coll: 580, breg: 670, gIn: 764, st0: 820, st1: 990, gOut: 1060, end: 1232
  };
  var C = {
    water: "#2f7dd1", fire: "#d0443c", ink: "#1d2733", muted: "#7b8a99", line: "#c9d3dc",
    reg: "#0f8a7e", warn: "#e07b00", bad: "#c62f2f", sel: "#eef5fc"
  };
  var flowEls = [];

  function f1(v) { return (Math.round(v * 10) / 10).toString(); }
  function m1(v) { return n(v, 1) + " м"; }

  function text(x, y, t, cls, fill, anchor) {
    return '<text x="' + f1(x) + '" y="' + f1(y) + '" class="' + cls + '"' +
      (fill ? ' fill="' + fill + '"' : "") + ' text-anchor="' + (anchor || "middle") + '">' + t + "</text>";
  }

  function pipe(x1, y1, x2, y2, color, w, extra) {
    return '<line x1="' + f1(x1) + '" y1="' + f1(y1) + '" x2="' + f1(x2) + '" y2="' + f1(y2) +
      '" stroke="' + color + '" stroke-width="' + (w || 6) + '" stroke-linecap="round"' + (extra || "") + "/>";
  }

  function flow(x1, y1, x2, y2, ratio) {
    if (!(ratio > 0.01)) return "";
    var speed = Fmt.clamp(60 * ratio, 10, 170);
    return '<line class="flow" data-speed="' + speed.toFixed(1) + '" x1="' + f1(x1) + '" y1="' + f1(y1) +
      '" x2="' + f1(x2) + '" y2="' + f1(y2) + '" stroke="#ffffff" stroke-opacity="0.9" stroke-width="2" stroke-dasharray="6 18"/>';
  }

  function valve(x, y, size, fill, stroke) {
    var s = size || 8, h = s * 0.7;
    return '<path d="M' + f1(x - s) + " " + f1(y - h) + " L" + f1(x - s) + " " + f1(y + h) + " L" + f1(x + s) + " " + f1(y - h) +
      " L" + f1(x + s) + " " + f1(y + h) + ' Z" fill="' + (fill || "#fff") + '" stroke="' + (stroke || C.ink) + '" stroke-width="1.4" stroke-linejoin="round"/>';
  }

  function gauge(x, y, head, cls, caption) {
    var col = cls === "bad" ? C.bad : cls === "warn" ? C.warn : cls === "reg" ? C.reg : C.ink;
    var strong = cls === "bad" || cls === "warn" || cls === "reg";
    var s = '<g class="gauge">';
    s += '<line x1="' + x + '" y1="' + (y - 4) + '" x2="' + x + '" y2="' + (y - 24) + '" stroke="' + C.muted + '" stroke-width="1.5"/>';
    s += '<rect x="' + (x - 44) + '" y="' + (y - 56) + '" width="88" height="32" rx="7" fill="#fff" stroke="' + col + '" stroke-width="' + (strong ? 2.2 : 1.2) + '"/>';
    s += text(x, y - 35, Fmt.isNum(head) ? m1(head) : "—", "gv", col);
    if (caption) s += text(x, y - 62, caption, "gc");
    return s + "</g>";
  }

  // state: reg — редуцирует, open — открыт полностью, missing — нужен, но снят
  function regulator(x, y, state, setpoint) {
    var s = '<g class="regulator">';
    if (state === "missing") {
      s += '<rect x="' + (x - 36) + '" y="' + (y - 42) + '" width="72" height="58" rx="6" fill="#fff5f5" stroke="' + C.bad + '" stroke-dasharray="5 4" stroke-width="1.6"/>';
      s += text(x, y - 20, "нужен", "rl", C.bad) + text(x, y - 5, "регулятор!", "rl", C.bad);
      s += text(x, y + 30, "снят для сравнения", "rs", C.bad);
      return s + "</g>";
    }
    var col = state === "reg" ? C.reg : C.ink;
    s += '<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (y - 16) + '" stroke="' + col + '" stroke-width="1.6"/>';
    s += valve(x, y, 13, "#fff", col);
    s += '<path d="M' + (x - 13) + " " + (y - 16) + " A13 10 0 0 1 " + (x + 13) + " " + (y - 16) + ' Z" fill="' + (state === "reg" ? "#d9f1ee" : "#fff") + '" stroke="' + col + '" stroke-width="1.6"/>';
    // импульсная трубка «после себя» — отбор давления за клапаном
    s += '<path d="M' + (x + 11) + " " + (y - 20) + " L" + (x + 34) + " " + (y - 20) + " L" + (x + 34) + " " + (y - 4) + '" fill="none" stroke="' + col + '" stroke-width="1.2" stroke-dasharray="3 2"/>';
    s += text(x, y + 26, "РД «после себя»", "rl", col);
    s += text(x, y + 40, "уставка " + m1(setpoint), "rs");
    s += text(x, y + 53, state === "reg" ? "редуцирует" : "открыт полностью", "rs", col);
    return s + "</g>";
  }

  function pump(x, y, running, col) {
    return '<circle cx="' + x + '" cy="' + y + '" r="12" fill="' + (running ? col : "#fff") + '" fill-opacity="' + (running ? 0.18 : 1) +
      '" stroke="' + (running ? col : C.muted) + '" stroke-width="1.6"/>' +
      '<path d="M' + (x - 5) + " " + (y - 7) + " L" + (x + 8) + " " + y + " L" + (x - 5) + " " + (y + 7) + ' Z" fill="' + (running ? col : C.muted) + '"/>';
  }

  function station(r, st, y, col) {
    var x0 = X.st0, x1 = X.st1, mid = (x0 + x1) / 2, mi = x0 + 28, mo = x1 - 28;
    var running = st && st.on;
    var s = '<rect x="' + x0 + '" y="' + (y - 44) + '" width="' + (x1 - x0) + '" height="88" rx="10" fill="#f8fafc" stroke="' + C.line + '" stroke-width="1.4"/>';
    s += text(mid, y - 52, esc(r.sys.name), "sn", C.ink);
    s += pipe(mi, y - 22, mi, y + 22, col, 4) + pipe(mo, y - 22, mo, y + 22, col, 4);
    [-22, 22].forEach(function (dy, i) {
      s += pipe(mi, y + dy, mo, y + dy, col, 3);
      s += valve(mi + 20, y + dy, 5);
      s += valve(mo - 20, y + dy, 5);
      s += pump(mid, y + dy, running && i === 0, col);
    });
    s += text(x1 - 8, y + 38, r.valid ? (r.drive === "vfd" ? "ПЧ" : "без ПЧ") : "", "sd", C.muted, "end");
    s += text(x0 + 8, y + 38, "1 раб. + 1 рез.", "sd", C.muted, "start");
    return s;
  }

  function overLimit(r, st) {
    var sys = r.sys;
    if (isSet(sys.pn) && st.hOut > sys.pn * r.K + 1e-6) return "PN" + sys.pn + " = " + g(sys.pn * r.K) + " м";
    if (isSet(sys.hNetAllow) && st.hOut > sys.hNetAllow + 1e-6) return g(sys.hNetAllow) + " м";
    return "";
  }

  function statusLines(r, st) {
    var lines = [];
    if (!st) return lines;
    if (!st.on) {
      lines.push(["Насосы в дежурном режиме", ""]);
      lines.push(["в сети за ними напор ввода " + m1(st.hOut), ""]);
      return lines;
    }
    if (r.drive === "vfd") {
      lines.push(["f = " + n(st.f, 1) + " Гц · Q = " + n(st.Q) + " л/с · H = " + m1(st.H), ""]);
      if (st.status === "fmin") lines.push(["ПЧ на минимуме: Н вых " + m1(st.hOut) + " > " + m1(r.hOut), "bad"]);
      else if (st.status === "fmax" && st.phi > 0 && st.Q < 0.005) lines.push(["насос не достигает уставки " + m1(r.hOut) + " даже без расхода — вода не идёт", "bad"]);
      else if (st.status === "fmax") lines.push(["не хватает напора: Н вых " + m1(st.hOut) + " < " + m1(r.hOut), "warn"]);
      else lines.push(["держит Н вых = " + m1(r.hOut), "ok"]);
    } else {
      lines.push(["Q = " + n(st.Q) + " л/с (" + Math.round(st.qRatio * 100) + " %) · H = " + m1(st.H), ""]);
      if (st.phi === 0) lines.push(["работа на закрытую сеть", "warn"]);
      else if (st.Q < 0.005) lines.push(["насос не преодолевает напор сети — вода не идёт", "bad"]);
      else if (st.qRatio > 1.1) lines.push(["рабочая точка ушла вправо — перегрузка двигателя", "bad"]);
      else if (st.qRatio < 0.9) lines.push(["расход ниже расчётного", "warn"]);
      else lines.push(["работа около расчётной точки", "ok"]);
    }
    var lim = overLimit(r, st);
    if (lim) lines.push(["напор выше допустимого (" + lim + ")", "bad"]);
    return lines;
  }

  function inletClass(project, r, st) {
    if (!st) return "";
    if (st.hIn < 0) return "bad";
    if (st.regMode === "reg") return "reg";
    var upper = r.hasReg ? r.hInMaxAfter : (r.drive === "const" ? r.hInMin + project.settings.fluctLimit : Math.max(r.hRedMax, r.hInMax));
    return st.hIn > upper + 0.2 ? "warn" : "";
  }

  function outClass(r, st) {
    if (!st) return "";
    if (overLimit(r, st)) return "bad";
    if (st.status === "fmin" || st.status === "fmax" || st.hOut > r.hNetMax + 0.2) return "warn";
    return "";
  }

  function render(host, project, res, sim, live, selectedId) {
    var list = res.list;
    var rows = Math.max(list.length, 1);
    var yLast = Y0 + (rows - 1) * ROW;
    var H = yLast + 104;
    var s = [];

    s.push('<svg class="scheme-svg" viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема ввода водопровода и насосных установок">');
    s.push('<defs><pattern id="schHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="6" stroke="#9aa7b4" stroke-width="2"/></pattern>' +
      '<marker id="schArrW" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="' + C.water + '"/></marker>' +
      '<marker id="schArrF" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="' + C.fire + '"/></marker></defs>');

    // Подсветка выбранной строки и области для щелчка
    list.forEach(function (r, i) {
      var y = Y0 + i * ROW;
      s.push('<rect class="row-hit" data-sel="' + r.id + '" x="' + (X.coll + 14) + '" y="' + (y - 86) + '" width="' + (W - X.coll - 18) + '" height="' + (ROW - 6) +
        '" rx="10" fill="' + (r.id === selectedId ? C.sel : "transparent") + '"/>');
    });

    // Наружная сеть и стена
    s.push('<rect x="29" y="16" width="14" height="' + (H - 32) + '" rx="3" fill="' + C.water + '" fill-opacity="0.85"/>');
    s.push('<text class="lbl" transform="translate(21 ' + f1(H / 2) + ') rotate(-90)" text-anchor="middle">Наружная сеть водопровода</text>');
    s.push('<rect x="' + (X.wall - 6) + '" y="16" width="12" height="' + (H - 40) + '" fill="url(#schHatch)" stroke="#9aa7b4"/>');
    s.push(text(X.wall, H - 8, "стена здания", "lbl"));

    var main = sim.main || { hConn: live.hNet, hMeter: live.hNet, hCreg: live.hNet, cregMode: "none", qRatio: 0 };

    // Ввод
    s.push(pipe(43, Y0, X.coll, Y0, C.water, 7));
    s.push(flow(46, Y0, X.coll - 4, Y0, main.qRatio));

    // Колодец — точка подключения
    s.push('<rect x="' + (X.well - 22) + '" y="' + (Y0 - 28) + '" width="44" height="56" rx="4" fill="none" stroke="' + C.muted + '" stroke-dasharray="4 3"/>');
    s.push(valve(X.well, Y0, 8));
    s.push(text(X.well, Y0 + 44, "точка", "lbl") + text(X.well, Y0 + 59, "подключения", "lbl"));
    s.push(gauge(X.well, Y0 - 30, main.hConn, "", "сеть"));

    // Водомерный узел с обводной линией
    var mx = X.meter;
    s.push('<path d="M' + (mx - 44) + " " + Y0 + " L" + (mx - 44) + " " + (Y0 - 34) + " L" + (mx + 44) + " " + (Y0 - 34) + " L" + (mx + 44) + " " + Y0 + '" fill="none" stroke="' + C.water + '" stroke-width="3"/>');
    s.push(valve(mx, Y0 - 34, 6, C.ink, C.ink));
    s.push(valve(mx - 30, Y0, 6) + valve(mx + 30, Y0, 6));
    s.push('<circle cx="' + mx + '" cy="' + Y0 + '" r="11" fill="#fff" stroke="' + C.ink + '" stroke-width="1.6"/>');
    s.push('<rect x="' + (mx - 5) + '" y="' + (Y0 - 4) + '" width="10" height="8" fill="none" stroke="' + C.ink + '" stroke-width="1.2"/>');
    s.push(text(mx, Y0 + 28, "водомерный узел", "lbl") + text(mx, Y0 + 41, "с обводной линией", "rs"));
    s.push(gauge(X.gMeter, Y0, main.hMeter, "", "после ввода"));

    // Общий регулятор
    if (project.layout === "common") {
      var c = res.common;
      if (c && c.need) {
        var cst = !live.regOn ? "missing" : main.cregMode === "reg" ? "reg" : "open";
        s.push(regulator(X.creg, Y0, cst, c.setpoint));
        s.push(gauge(X.gCreg, Y0, main.hCreg, main.cregMode === "reg" && live.regOn ? "reg" : "", "после РД"));
      } else if (c) {
        s.push(text(X.creg, Y0 + 26, "общий РД", "rs", C.muted) + text(X.creg, Y0 + 39, "не нужен", "rs", C.muted));
      }
    }

    // Коллектор
    if (rows > 1) s.push(pipe(X.coll, Y0, X.coll, yLast, C.water, 7));

    list.forEach(function (r, i) {
      var y = Y0 + i * ROW;
      var fire = Calc.isFire(r.sys.kind);
      var col = fire ? C.fire : C.water;
      var st = sim.byId[r.id];
      var mi = X.st0 + 28, mo = X.st1 - 28;

      if (!r.valid) {
        s.push(pipe(X.coll, y, X.end - 8, y, C.line, 4, ' stroke-dasharray="8 6"'));
        s.push(text((X.st0 + X.st1) / 2, y - 12, esc(r.sys.name || "без названия"), "sn", C.ink));
        s.push(text((X.st0 + X.st1) / 2, y + 22, esc(r.errors[0] || "нет данных"), "rs", C.bad));
        return;
      }

      s.push(pipe(X.coll, y, mi, y, col, 6));
      s.push(pipe(mo, y, X.end - 10, y, col, 6, ' marker-end="url(#' + (fire ? "schArrF" : "schArrW") + ')"'));
      var ratio = st ? st.Q / r.sys.q : 0;
      s.push(flow(X.coll + 4, y, mi - 4, y, ratio));
      s.push(flow(mo + 4, y, X.end - 16, y, ratio));

      if (project.layout === "common") {
        if (res.common && res.common.need) s.push(text(X.breg, y + 26, "через общий РД", "rs", C.muted));
      } else if (r.hasReg) {
        var state = !live.regOn ? "missing" : st && st.regMode === "reg" ? "reg" : "open";
        s.push(regulator(X.breg, y, state, r.setpoint));
      } else {
        s.push(text(X.breg, y + 26, "РД не нужен", "rs", C.muted));
      }

      s.push(gauge(X.gIn, y, st ? st.hIn : NaN, inletClass(project, r, st), "всас"));
      s.push(station(r, st, y, col));
      s.push(gauge(X.gOut, y, st ? st.hOut : NaN, outClass(r, st), "напор"));

      statusLines(r, st).forEach(function (ln, k) {
        var fill = ln[1] === "bad" ? C.bad : ln[1] === "warn" ? C.warn : ln[1] === "ok" ? C.reg : C.ink;
        s.push(text((X.st0 + X.st1) / 2, y + 60 + k * 14, esc(ln[0]), "ss", fill));
      });

      s.push(text(X.end - 4, y + 24, "в сеть " + esc(r.sys.kind), "lbl", C.ink, "end"));
      s.push(text(X.end - 4, y + 38, st && st.on ? "Q = " + n(st.Q) + " л/с" : "Q = 0", "rs", C.muted, "end"));
    });

    s.push("</svg>");
    host.innerHTML = s.join("");
    flowEls = Array.prototype.slice.call(host.querySelectorAll(".flow"));
  }

  function animate(ts) {
    for (var i = 0; i < flowEls.length; i++) {
      var el = flowEls[i];
      var speed = +el.getAttribute("data-speed");
      el.setAttribute("stroke-dashoffset", (-((ts / 1000) * speed) % 24).toFixed(2));
    }
  }

  return { render: render, animate: animate };
})();
