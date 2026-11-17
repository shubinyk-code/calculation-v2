/* Лабораторная установка: живая SVG-схема.
   Строится строкой один раз (при смене состава), дальше каждый кадр меняются только атрибуты.
   В <text> — только простой текст: HTML-теги внутри SVG, вставленного через innerHTML,
   закрывают <svg> (см. заметку svg-innerhtml-no-html-tags). */
var Scheme = (function () {
  "use strict";
  var W = 1140, H = 612;
  var host, svg, refs = {}, key = "", geo = {}, anim = { flows: [], ang: [0, 0, 0] };
  var PC = ["--p1", "--p2", "--p3"];
  var handlers = {};

  function rowsFor(n) { return n === 1 ? [285] : (n === 2 ? [200, 370] : [150, 285, 420]); }

  function layoutKey(cfg) {
    return [cfg.pumpCount, cfg.source.type, cfg.source.loop, cfg.net.tankOn, cfg.taps.length,
      cfg.taps.map(function (t) { return t.z + ":" + t.name; }).join(",")].join("|");
  }

  /* ---------------------------------------------------------------- построение */

  function pipe(id, d, extra) {
    return '<path class="pipe" id="pb_' + id + '" d="' + d + '"' + (extra || "") + '/>' +
           '<path class="flow" id="pf_' + id + '" d="' + d + '"/>';
  }
  function bowtie(x, y, cls, id) {
    return '<g class="' + (cls || "valve") + '"' + (id ? ' id="' + id + '"' : "") + '><path d="M' + (x - 9) + ' ' + (y - 8) + ' L' + (x + 9) + ' ' + (y + 8) + ' L' + (x + 9) + ' ' + (y - 8) + ' L' + (x - 9) + ' ' + (y + 8) + ' Z"/></g>';
  }
  function gauge(id, x, y, r) {
    var s = '<g class="gauge" transform="translate(' + x + ',' + y + ')"><circle r="' + r + '"/>';
    for (var k = 0; k <= 10; k++) {
      var a = (-225 + 270 * k / 10) * Math.PI / 180;
      s += '<line x1="' + ((r - 2) * Math.cos(a)).toFixed(1) + '" y1="' + ((r - 2) * Math.sin(a)).toFixed(1) + '" x2="' + ((r - 5) * Math.cos(a)).toFixed(1) + '" y2="' + ((r - 5) * Math.sin(a)).toFixed(1) + '"/>';
    }
    s += '<line class="needle" id="' + id + '" x1="0" y1="0" x2="0" y2="' + (-(r - 4)) + '"/><circle class="hub" r="2"/></g>';
    return s;
  }
  function txt(id, x, y, cls, anchor, content) {
    return '<text' + (id ? ' id="' + id + '"' : "") + ' x="' + x + '" y="' + y + '" class="' + (cls || "") + '" text-anchor="' + (anchor || "start") + '">' + (content || "") + '</text>';
  }

  function impeller(i, cx, cy) {
    var s = '<g class="imp" id="imp' + i + '"><circle class="imp-disc" cx="' + cx + '" cy="' + cy + '" r="21"/>';
    for (var k = 0; k < 6; k++) {
      var a = k * 60 * Math.PI / 180;
      // загнутая назад лопатка: от ступицы к краю с поворотом против вращения
      var r1 = 7, r2 = 20, a2 = a - 0.75;
      var x1 = cx + r1 * Math.cos(a), y1 = cy + r1 * Math.sin(a);
      var xm = cx + 14 * Math.cos(a - 0.2), ym = cy + 14 * Math.sin(a - 0.2);
      var x2 = cx + r2 * Math.cos(a2), y2 = cy + r2 * Math.sin(a2);
      s += '<path class="blade" d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' Q' + xm.toFixed(1) + ' ' + ym.toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '"/>';
    }
    s += '<circle class="imp-hub" cx="' + cx + '" cy="' + cy + '" r="5"/></g>';
    return s;
  }

  function build(cfg) {
    var n = cfg.pumpCount, rows = rowsFor(n), ym = rows.reduce(function (a, b) { return a + b; }, 0) / rows.length;
    var tank = cfg.source.type === "tank";
    geo = { rows: rows, ym: ym, xh: 232, xd: 512, xr: 872, taps: [] };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" class="scheme-svg">';
    anim.flows = [];

    // --- Здание: отметка 0 (ось насосов) внизу, краны на своих высотах
    var zMax = 0;
    cfg.taps.forEach(function (t) { zMax = Math.max(zMax, t.z); });
    zMax = Math.max(zMax, 10) + 3;
    var ybase = 572, ytop = 34, sc = (ybase - ytop) / zMax;
    geo.ybase = ybase;
    geo.yz = function (z) { return ybase - z * sc; };
    s += '<rect class="building" x="838" y="' + ytop + '" width="294" height="' + (ybase - ytop + 8) + '" rx="4"/>';
    for (var fz = 3; fz < zMax; fz += 3) s += '<line class="floor" x1="838" x2="1132" y1="' + geo.yz(fz).toFixed(1) + '" y2="' + geo.yz(fz).toFixed(1) + '"/>';
    s += txt(null, 1126, ytop + 14, "cap muted", "end", "Здание");
    s += txt(null, 1126, ybase - 4, "tiny muted", "end", "отм. 0 = ось насосов");

    // --- Источник
    if (!tank) {
      s += txt(null, 12, ym + 28, "cap", "start", "Городской");
      s += txt(null, 12, ym + 44, "cap", "start", "водопровод");
      s += pipe("src", "M8 " + ym + " H" + geo.xh);
      s += '<g class="meter"><rect x="60" y="' + (ym - 12) + '" width="34" height="24" rx="4"/>' + txt(null, 77, ym + 4, "tiny", "middle", "ВС") + '</g>';
      s += '<line class="stem" x1="150" y1="' + ym + '" x2="150" y2="' + (ym - 26) + '"/>' + gauge("gIn", 150, ym - 44, 17);
      s += txt("tIn", 172, ym - 50, "val", "start", "");
      s += txt("tIn2", 172, ym - 36, "tiny muted", "start", "подпор");
      geo.srcBottom = ym;
    } else {
      var tx = 18, tw = 150, ty = 175, th = 250;
      geo.tank = { x: tx, y: ty, w: tw, h: th };
      s += txt(null, tx, ty - 34, "cap", "start", "Бак разрыва струи");
      s += '<rect class="tank-wall" x="' + tx + '" y="' + ty + '" width="' + tw + '" height="' + th + '"/>';
      s += '<rect class="tank-water" id="tankW" x="' + (tx + 2) + '" y="' + ty + '" width="' + (tw - 4) + '" height="0"/>';
      s += '<line class="lvl-min" id="tankMin" x1="' + tx + '" x2="' + (tx + tw) + '" y1="0" y2="0"/>';
      s += txt("tankT", tx + tw / 2, ty + th + 18, "val", "middle", "");
      s += txt("tankT2", tx + tw / 2, ty + th + 33, "tiny muted", "middle", "");
      // подпитка с поплавковым клапаном
      s += txt(null, tx, ty - 18, "tiny muted", "start", "подпитка из водопровода");
      s += pipe("float", "M" + tx + " " + (ty - 8) + " H" + (tx + 40) + " V" + (ty + 26));
      s += '<circle class="float" id="floatBall" cx="' + (tx + 62) + '" cy="' + (ty + 40) + '" r="7"/>';
      s += '<line class="stem" id="floatArm" x1="' + (tx + 40) + '" y1="' + (ty + 26) + '" x2="' + (tx + 62) + '" y2="' + (ty + 40) + '"/>';
      s += pipe("src", "M" + (tx + tw) + " " + (ty + th - 16) + " H200 V" + ym + " H" + geo.xh);
      s += '<line class="stem" x1="200" y1="' + ym + '" x2="200" y2="' + (ym - 26) + '"/>' + gauge("gIn", 200, ym - 44, 16);
      s += txt("tIn", 200, ym - 66, "val", "middle", "");
      geo.srcBottom = ty + th - 16;
    }

    // --- Коллекторы
    rows.forEach(function (y, i) {
      if (Math.abs(y - ym) > 1) {
        s += pipe("sh" + i, "M" + geo.xh + " " + ym + " V" + y);
        s += pipe("dh" + i, "M" + geo.xd + " " + y + " V" + ym);
      }
    });

    // --- Насосы
    rows.forEach(function (y, i) {
      var cx = 345;
      s += pipe("ps" + i, "M" + geo.xh + " " + y + " H313");
      s += bowtie(266, y);
      s += pipe("pd" + i, "M" + (cx + 26) + " " + (y - 20) + " H" + geo.xd + " V" + y, "");
      s += '<g class="check" id="cv' + i + '" transform="translate(425,' + (y - 20) + ')"><path class="cv-body" d="M-11 -9 L11 0 L-11 9 Z"/><line class="cv-bar" x1="11" y1="-10" x2="11" y2="10"/><line class="cv-flap" id="cvf' + i + '" x1="0" y1="-10" x2="0" y2="10"/></g>';
      s += bowtie(474, y - 20);
      s += '<g class="pump" id="pump' + i + '" data-pump="' + i + '">' +
        '<path class="casing" id="cas' + i + '" d="M' + cx + ' ' + (y - 34) + ' A34 34 0 1 1 ' + (cx - 30) + ' ' + (y - 16) + ' L' + (cx - 34) + ' ' + (y - 34) + ' Z"/>' +
        '<path class="casing" d="M' + (cx - 4) + ' ' + (y - 34) + ' H' + (cx + 28) + ' V' + (y - 10) + ' H' + (cx + 2) + ' Z"/>' +
        '<circle class="casing-in" id="casIn' + i + '" cx="' + cx + '" cy="' + y + '" r="27"/>' +
        impeller(i, cx, y) +
        '<g id="bub' + i + '" class="bubbles"></g>' +
        '<g class="failed-x" id="fx' + i + '"><line x1="' + (cx - 26) + '" y1="' + (y - 26) + '" x2="' + (cx + 26) + '" y2="' + (y + 26) + '"/><line x1="' + (cx - 26) + '" y1="' + (y + 26) + '" x2="' + (cx + 26) + '" y2="' + (y - 26) + '"/></g>' +
        '<title id="ptt' + i + '"></title></g>';
      // ПЧ / пускатель
      s += '<g class="drive" id="drv' + i + '"><rect x="300" y="' + (y - 76) + '" width="92" height="26" rx="4"/>' +
        txt("drvT" + i, 346, y - 58, "drv-text", "middle", "") + '</g>';
      s += txt("pl" + i, 345, y + 50, "val", "middle", "");
      s += txt("pl2" + i, 345, y + 64, "tiny muted", "middle", "");
      s += '<circle class="pump-badge" cx="' + (cx - 30) + '" cy="' + (y + 30) + '" r="9" style="fill:var(' + PC[i] + ')"/>' + txt(null, cx - 30, y + 34, "badge-t", "middle", String(i + 1));
    });

    // --- Напорная магистраль
    var xT = 640;
    s += pipe("m1", "M" + geo.xd + " " + ym + " H" + xT);
    s += pipe("m2", "M" + xT + " " + ym + " H818 V" + ybase + " H" + geo.xr + " V" + geo.yz(zMax - 3).toFixed(1));
    s += txt(null, 812, ybase - 8, "tiny muted", "end", "ввод в стояк");
    s += '<line class="stem" x1="550" y1="' + ym + '" x2="550" y2="' + (ym - 30) + '"/><g class="pt"><rect x="537" y="' + (ym - 52) + '" width="26" height="22" rx="3"/>' + txt(null, 550, ym - 37, "tiny", "middle", "PT") + '</g>';
    s += '<line class="stem" x1="595" y1="' + ym + '" x2="595" y2="' + (ym - 28) + '"/>' + gauge("gOut", 595, ym - 46, 18);
    s += txt("tOut", 620, ym - 54, "val", "start", "");
    s += txt("tOut2", 620, ym - 40, "tiny muted", "start", "на выходе");
    if (cfg.net.tankOn) {
      s += pipe("tk", "M" + xT + " " + ym + " V" + (ym + 38));
      s += '<rect class="mtank" x="' + (xT - 26) + '" y="' + (ym + 38) + '" width="52" height="112" rx="24"/>';
      s += '<clipPath id="mtClip"><rect x="' + (xT - 26) + '" y="' + (ym + 38) + '" width="52" height="112" rx="24"/></clipPath>';
      s += '<rect class="mtank-air" x="' + (xT - 26) + '" y="' + (ym + 38) + '" width="52" height="112" clip-path="url(#mtClip)"/>';
      s += '<rect class="mtank-water" id="mtW" x="' + (xT - 26) + '" y="' + (ym + 150) + '" width="52" height="0" clip-path="url(#mtClip)"/>';
      s += '<line class="membrane" id="mtM" x1="' + (xT - 26) + '" x2="' + (xT + 26) + '" y1="0" y2="0"/>';
      s += txt(null, xT + 32, ym + 60, "tiny muted", "start", "мембранный");
      s += txt(null, xT + 32, ym + 72, "tiny muted", "start", "бак");
      s += txt("mtT", xT + 32, ym + 90, "val", "start", "");
      s += txt("mtT2", xT + 32, ym + 104, "tiny muted", "start", "");
    }
    s += '<g id="mainValve" class="mvalve" data-mvalve="1">' + bowtie(720, ym, "valve big") + '<rect x="708" y="' + (ym - 30) + '" width="24" height="10" rx="2" class="handwheel"/><line class="stem" x1="720" y1="' + (ym - 20) + '" x2="720" y2="' + (ym - 8) + '"/></g>';
    s += txt("tValve", 720, ym + 26, "tiny", "middle", "");
    s += '<g class="meter"><rect x="770" y="' + (ym - 13) + '" width="46" height="26" rx="4"/>' + txt(null, 793, ym + 4, "tiny", "middle", "Q") + '</g>';
    s += txt("tQ", 793, ym - 20, "val", "middle", "");
    s += txt("tQ2", 793, ym + 30, "tiny muted", "middle", "");

    // --- Краны по этажам
    var used = [];
    cfg.taps.forEach(function (t, i) {
      var y = geo.yz(t.z);
      for (var u = 0; u < used.length; u++) if (Math.abs(used[u] - y) < 34) { y = used[u] + 36; u = -1; }
      used.push(y);
      geo.taps.push(y);
      var xs = geo.xr;
      s += pipe("t" + i, "M" + xs + " " + y.toFixed(1) + " H934");
      s += '<g class="tap" id="tap' + i + '" data-tap="' + i + '">' + bowtie(902, y, "valve") + '<rect x="884" y="' + (y - 16) + '" width="38" height="32" fill="transparent"/></g>';
      s += '<path class="spout" d="M928 ' + (y - 5) + ' H942 Q948 ' + (y - 5) + ' 948 ' + (y + 2) + ' V' + (y + 6) + ' H940 V' + (y + 3) + ' H928 Z"/>';
      s += '<line class="stream" id="st' + i + '" x1="944" y1="' + (y + 7) + '" x2="944" y2="' + (y + 26) + '"/>';
      s += '<path class="basin" d="M932 ' + (y + 22) + ' H958 L952 ' + (y + 29) + ' H938 Z"/>';
      s += txt(null, 964, y - 3, "tiny", "start", t.name + " · " + U.fmt(t.z, 0) + " м");
      s += txt("tt" + i, 964, y + 11, "tiny muted", "start", "");
      s += '<line class="drainpipe" x1="945" y1="' + (y + 29) + '" x2="1122" y2="' + (y + 29) + '"/>';
    });
    s += '<line class="drainpipe" x1="1122" y1="' + (Math.min.apply(null, used) + 29) + '" x2="1122" y2="598"/>';
    if (tank && cfg.source.loop) {
      s += pipe("ret", "M1122 598 H" + (geo.tank.x + 110) + " V" + (geo.tank.y + 8));
      s += txt(null, 560, 590, "tiny muted", "middle", "слив от потребителей возвращается в бак (замкнутый стенд)");
    } else {
      s += pipe("ret", "M1122 598 H960");
      s += txt(null, 954, 602, "tiny muted", "end", "в канализацию");
    }

    // --- Шкаф управления и сигнальные линии
    s += '<path class="wire" d="M550 ' + (ym - 52) + ' V124"/>';
    rows.forEach(function (y) { s += '<path class="wire" d="M560 76 H404 V' + (y - 63) + ' H392"/>'; });
    s += '<g class="cabinet"><rect x="560" y="10" width="270" height="114" rx="6"/>' +
      txt(null, 572, 28, "cap", "start", "Шкаф управления") +
      txt("cab1", 572, 46, "tiny", "start", "") +
      txt("cab2", 572, 62, "val", "start", "") +
      txt("cab3", 572, 78, "tiny", "start", "") +
      txt("cab4", 572, 94, "tiny", "start", "") +
      txt("cab5", 572, 112, "tiny strong", "start", "") + '</g>';
    s += '</svg>';

    host.innerHTML = s;
    svg = host.firstChild;
    refs = {};
    Array.prototype.forEach.call(svg.querySelectorAll("[id]"), function (e) { refs[e.id] = e; });
    Array.prototype.forEach.call(svg.querySelectorAll("path.flow"), function (e) {
      e._len = 0; e._off = 0;
      anim.flows.push(e);
    });
  }

  /* ---------------------------------------------------------------- обновление */

  function pcolor(Hh) {
    if (Hh < 0) return U.mix(U.css("--pipe-lo"), U.css("--warn-hex"), U.clamp(-Hh / 6, 0, 1));
    return U.mix(U.css("--pipe-lo"), U.css("--pipe-hi"), U.clamp(Hh / 90, 0, 1));
  }
  function setFlow(id, Q, Hh, dt) {
    var b = refs["pb_" + id], f = refs["pf_" + id];
    if (!b) return;
    b.style.stroke = pcolor(Hh);
    var aq = Math.abs(Q);
    if (aq < 0.004) { f.style.opacity = 0; return; }
    f.style.opacity = U.clamp(0.35 + aq * 0.12, 0.45, 1);
    f._off -= (Q > 0 ? 1 : -1) * (14 + 34 * Math.sqrt(aq)) * dt;
    f._off %= 1600;
    f.setAttribute("stroke-dashoffset", f._off.toFixed(1));
  }
  function setText(id, s) { var e = refs[id]; if (e && e.textContent !== s) e.textContent = s; }
  function needle(id, Hh, scale) {
    var e = refs[id]; if (!e) return;
    var a = -135 + 270 * U.clamp(Hh / scale, 0, 1);
    e.setAttribute("transform", "rotate(" + a.toFixed(1) + ")");
  }

  function update(sim, dt) {
    var cfg = sim.cfg;
    var k = layoutKey(cfg);
    if (k !== key) { key = k; build(cfg); }
    var p = cfg.pump, c = cfg.ctrl, n = cfg.pumpCount, rows = geo.rows;
    var tank = cfg.source.type === "tank";

    // Источник
    setFlow("src", sim.Qp, sim.Hin, dt);
    needle("gIn", sim.Hin, 60);
    setText("tIn", U.fmt(sim.Hin, 1) + " м");
    if (tank) {
      var g = geo.tank, src = cfg.source;
      var hw = U.clamp(sim.level / src.tankH, 0, 1) * g.h;
      refs.tankW.setAttribute("y", (g.y + g.h - hw).toFixed(1));
      refs.tankW.setAttribute("height", Math.max(0, hw - 2).toFixed(1));
      var ymin = g.y + g.h - src.levelMin / src.tankH * g.h;
      refs.tankMin.setAttribute("y1", ymin.toFixed(1)); refs.tankMin.setAttribute("y2", ymin.toFixed(1));
      setText("tankT", "уровень " + U.fmt(sim.level, 2) + " м");
      setText("tankT2", "подпитка " + U.fmt(sim.Qfloat, 1) + " м³/ч");
      setFlow("float", sim.Qfloat, 20, dt);
      var ball = g.y + g.h - U.clamp(sim.level / src.tankH, 0.05, 0.98) * g.h;
      refs.floatBall.setAttribute("cy", ball.toFixed(1));
      refs.floatArm.setAttribute("y2", ball.toFixed(1));
    }

    // Насосы
    for (var i = 0; i < n; i++) {
      var ps = sim.pumps[i], y = rows[i];
      if (refs["pb_sh" + i]) { setFlow("sh" + i, ps.Q, sim.Hin, dt); setFlow("dh" + i, ps.Q, sim.Hn, dt); }
      setFlow("ps" + i, ps.Q, sim.Hin, dt);
      setFlow("pd" + i, ps.Q, sim.Hn, dt);
      anim.ang[i] = (anim.ang[i] + ps.f * 14 * dt) % 360;
      refs["imp" + i].setAttribute("transform", "rotate(" + anim.ang[i].toFixed(1) + " 345 " + y + ")");
      var failed = c.failed[i];
      var run = ps.f > 0.5;
      var pumpEl = refs["pump" + i];
      pumpEl.setAttribute("class", "pump" + (run ? " run" : "") + (failed ? " failed" : "") + (ps.cavStage >= 2 ? " cav" : ""));
      var hot = U.clamp((ps.T - 35) / 55, 0, 1);
      refs["casIn" + i].style.fill = hot > 0 ? U.mix(U.css("--casing-hex"), "#e0452b", hot) : "";
      refs["fx" + i].style.display = failed ? "" : "none";
      // обратный клапан: открыт, если есть подача
      var open = ps.Q > 0.01;
      refs["cvf" + i].setAttribute("transform", open ? "rotate(-62 0 -10)" : "");
      refs["cv" + i].setAttribute("class", "check" + (open ? " open" : (run ? " shut-run" : "")));
      // пузырьки кавитации
      var bub = refs["bub" + i];
      if (ps.cavStage >= 1 && run) {
        var nb = ps.cavStage * 4, sb = "";
        for (var b = 0; b < nb; b++) {
          var a = Math.random() * Math.PI * 2, rr = 4 + Math.random() * 14;
          sb += '<circle cx="' + (345 + rr * Math.cos(a)).toFixed(1) + '" cy="' + (y + rr * Math.sin(a)).toFixed(1) + '" r="' + (1 + Math.random() * 2.2).toFixed(1) + '"/>';
        }
        bub.innerHTML = sb;
      } else if (bub.firstChild) bub.innerHTML = "";
      // привод
      var dtxt;
      if (failed) dtxt = "АВАРИЯ";
      else if (ps.drive === "vfd") dtxt = "ПЧ " + U.fmt(ps.f, 1) + " Гц";
      else dtxt = ps.on ? "Сеть " + U.fmt(ps.f, 0) + " Гц" : (ps.f > 0.5 ? "выбег " + U.fmt(ps.f, 0) + " Гц" : "Пускатель: стоп");
      setText("drvT" + i, dtxt);
      refs["drv" + i].setAttribute("class", "drive" + (ps.drive === "vfd" ? " vfd" : "") + (ps.on ? " on" : ""));
      setText("pl" + i, run ? U.fmt(ps.Q, 1) + " м³/ч · " + U.fmt(ps.H, 1) + " м" : "стоит");
      setText("pl2" + i, U.fmt(ps.T, 0) + " °C · " + (run ? "КПД " + U.fmt(ps.eta * 100, 0) + "% · " + U.fmt(ps.Pel, 2) + " кВт" : "пусков " + ps.starts));
      var man = c.mode === "manualDol" || c.mode === "manualVfd";
      setText("ptt" + i, man ? "Щелчок — включить / выключить насос " + (i + 1) : "Щелчок — авария / ремонт насоса " + (i + 1) + " (в автомате насосами командует шкаф)");
    }

    // Напорная сторона
    setFlow("m1", sim.Qp, sim.Hn, dt);
    setFlow("m2", sim.Qs, sim.Hn, dt);
    needle("gOut", sim.Hn, 100);
    setText("tOut", U.fmt(sim.Hn, 1) + " м (" + U.fmt(sim.Hn / 10.2, 2) + " бар)");
    if (cfg.net.tankOn && refs.mtW) {
      var V = cfg.net.tankV, vw = sim.tankWater(sim.Hn), frac = V > 0 ? vw / V : 0, ym = geo.ym;
      var hh = 112 * frac;
      refs.mtW.setAttribute("y", (ym + 150 - hh).toFixed(1));
      refs.mtW.setAttribute("height", hh.toFixed(1));
      refs.mtM.setAttribute("y1", (ym + 150 - hh).toFixed(1)); refs.mtM.setAttribute("y2", (ym + 150 - hh).toFixed(1));
      setText("mtT", U.fmt(vw, 1) + " из " + U.fmt(V, 0) + " л");
      var dq = sim.Qp - sim.Qs;
      setText("mtT2", Math.abs(dq) < 0.03 ? "подкачка " + U.fmt(cfg.net.tankPre, 0) + " м" : (dq > 0 ? "набирает " : "отдаёт ") + U.fmt(Math.abs(dq), 2) + " м³/ч");
      setFlow("tk", sim.Qp - sim.Qs, sim.Hn, dt);
    }
    var vo = cfg.net.valveOpen;
    setText("tValve", "задвижка " + U.fmt(vo * 100, 0) + "%");
    refs.mainValve.setAttribute("class", "mvalve" + (vo < 0.999 ? " throttled" : "") + (vo < 0.01 ? " shut" : ""));
    setText("tQ", U.fmt(sim.Qs, 2) + " м³/ч");
    setText("tQ2", "разбор");

    // Краны
    var taps = cfg.taps;
    for (var t = 0; t < taps.length; t++) {
      var q = sim.tapQ[t] || 0, free = sim.HD - taps[t].z;
      setFlow("t" + t, q, free, dt);
      var st = refs["st" + t];
      st.style.opacity = q > 0.004 ? 1 : 0;
      st.style.strokeWidth = (1.2 + Math.min(5, Math.sqrt(q) * 2.2)).toFixed(1);
      var f = st._off || 0; f -= (30 + 60 * Math.sqrt(q)) * dt; st._off = f % 400;
      st.setAttribute("stroke-dashoffset", st._off.toFixed(1));
      refs["tap" + t].setAttribute("class", "tap" + (taps[t].on ? " on" : "") + (taps[t].on && free < cfg.needFree ? " starving" : ""));
      setText("tt" + t, (taps[t].on ? U.fmt(q, 2) + " м³/ч · напор " : "закрыт · напор ") + U.fmt(Math.max(0, free), 1) + " м");
    }
    setFlow("ret", sim.Qs, 0, dt);

    // Шкаф
    var modeName = { manualDol: "Ручной, прямой пуск", manualVfd: "Ручной, частота от ПЧ", relay: "Реле давления, каскад без ПЧ", vfd1: "ПЧ на ведущем + пиковые", vfdAll: "ПЧ на каждом насосе" }[c.mode];
    setText("cab1", "Режим: " + modeName);
    var sp = sim.setpoint();
    setText("cab2", "Датчик " + U.fmt(sim.Hmeas, 1) + " м" + (sp !== null ? " · уставка " + U.fmt(sp, 1) + " м" : ""));
    if (c.mode === "vfd1" || c.mode === "vfdAll") setText("cab3", "ПИ-регулятор: задание частоты " + U.fmt(sim.u, 1) + " Гц");
    else if (c.mode === "relay") setText("cab3", "Реле насоса 1: вкл < " + U.fmt(c.relayOn, 0) + " м, выкл > " + U.fmt(c.relayOff, 0) + " м");
    else setText("cab3", c.mode === "manualVfd" ? "Частота задана вручную: " + U.fmt(c.fManual, 1) + " Гц" : "Насосы на полной частоте сети");
    var run2 = 0; for (var j = 0; j < n; j++) if (sim.pumps[j].on) run2++;
    setText("cab4", "В работе насосов: " + run2 + " из " + n + " · ведущий № " + (sim.lead + 1));
    var stTxt = sim.dry ? "СУХОЙ ХОД — насосы заблокированы" : (sim.state === "sleep" ? "Спящий режим" : (sim.state === "boost" ? "Подъём давления перед сном" : "Работа"));
    setText("cab5", stTxt);
    refs.cab5.setAttribute("class", "tiny strong" + (sim.dry ? " bad" : ""));
  }

  function mount(el, h) {
    host = el; handlers = h || {};
    key = "";
    host.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== host) {
        if (t.getAttribute) {
          if (t.getAttribute("data-tap") !== null) { handlers.tap && handlers.tap(+t.getAttribute("data-tap")); return; }
          if (t.getAttribute("data-pump") !== null) { handlers.pump && handlers.pump(+t.getAttribute("data-pump")); return; }
          if (t.getAttribute("data-mvalve") !== null) { handlers.valve && handlers.valve(); return; }
        }
        t = t.parentNode;
      }
    });
  }

  return { mount: mount, update: update, invalidate: function () { key = ""; } };
})();
