/* Вкладка «Спринклеры»: распределительная сеть на расчётном участке.
   Методика — СП 485.1311500.2020, прил. Б, как в SprinklerWeb:
       q = K·√H                 ороситель (л/с, H в м; K — л/(с·МПа^0,5))
       ΔH = 1,2·Q²·L/Kт         участок трубы (+20% на местные)
       Hуу = 1000·ξ·(Q·3,6)²    узел управления
   Сеть однородна (все расходы ~√H, все потери ~Q²), поэтому любое поддерево
   описывается одним числом B = Q²/H и складывается без итераций:
       ороситель B = K²;  за участком S: B' = 1/(1/B + S);  в узле B = (Σ√Bi)².
   Баланс с насосом:  Hгар + Hнас(Q) = z + Sподв·Q² + Hуу(Q) + Q²/Bсети. */
var Sprink = (function () {
  "use strict";

  var UU = [
    ["Прямоточный Ду65", 5.8642e-7], ["Прямоточный Ду80", 1.7625e-7], ["Прямоточный Ду100", 1.6975e-7], ["Прямоточный Ду150", 0.3858e-7],
    ["Шалтан Ду65", 15.27e-7], ["Шалтан Ду80", 5.79e-7], ["Шалтан Ду100", 2.01e-7], ["Шалтан Ду150", 0.39e-7]
  ];
  var KLIST = [[0.35, "0,35 (СВН-10)"], [0.42, "0,42 (К80)"], [0.47, "0,47 (СВН-12)"], [0.6, "0,60 (К115)"], [0.77, "0,77 (СВН-15)"], [0.84, "0,84 (К160)"]];

  function defaults() {
    return {
      rows: 3, perRow: 4, a: 3.0, b: 3.5, a0: 1.5,
      k: 0.47,
      pipeTip: "3262:25:33.5:2.8", pipeRoot: "3262:40:48:3", nTip: 2,
      pipeMain: "3262:65:75.5:3.2", pipeSup: "3262:100:114:4", Lsup: 40, z: 6, uu: 2, local: 1.2,
      pump: { on: true, H0: 46, Qn: 22, Hn: 32 }, Hgar: 10,
      norm: { i: 0.12, area: 120 },
      open: {}
    };
  }

  function id(r, j) { return r + ":" + j; }
  function ser(B, S) { return B > 0 ? 1 / (1 / B + S) : 0; }
  function par(B1, B2) { var s = Math.sqrt(B1) + Math.sqrt(B2); return s * s; }

  function segS(st, pipeId, L) { var p = Pipes.byId(pipeId); return st.local * L / p.kt; }
  function rowPipe(st, j) { return j >= st.perRow - st.nTip ? st.pipeTip : st.pipeRoot; } // участок j ведёт к оросителю j
  function rowSegL(st, j) { return j === 0 ? st.a0 : st.a; }

  function pumpH(st, Q) {
    if (!st.pump.on) return 0;
    var B = (st.pump.H0 - st.pump.Hn) / (st.pump.Qn * st.pump.Qn);
    return st.pump.H0 - B * Q * Q;
  }
  function uuH(st, Q) { return 1000 * UU[st.uu][1] * Math.pow(Q * 3.6, 2); }
  function supS(st) { return segS(st, st.pipeSup, st.Lsup); }
  function srcH(st, Q) { return st.Hgar + pumpH(st, Q); }
  function needH(st, Q, Bnet) { return st.z + supS(st) * Q * Q + uuH(st, Q) + (Bnet > 0 ? Q * Q / Bnet : Infinity); }

  /* Свёртка сети: B каждого рядка и магистрали для заданного набора вскрытых оросителей. */
  function reduce(st, open) {
    var R = st.rows, n = st.perRow, K2 = st.k * st.k;
    var rows = [];
    for (var r = 0; r < R; r++) {
      var node = [], down = []; // node[j] — B узла j с его оросителем и всем, что дальше; down[j] — B того, что за участком j+1
      var B = 0;
      for (var j = n - 1; j >= 0; j--) {
        var beyond = j < n - 1 ? ser(node[j + 1], segS(st, rowPipe(st, j + 1), rowSegL(st, j + 1))) : 0;
        down[j] = beyond;
        node[j] = par(open[id(r, j)] ? K2 : 0, beyond);
      }
      rows.push({ node: node, down: down, B: ser(node[0], segS(st, rowPipe(st, 0), st.a0)) });
    }
    var main = [], after = [];
    for (r = R - 1; r >= 0; r--) {
      after[r] = r < R - 1 ? ser(main[r + 1], segS(st, st.pipeMain, st.b)) : 0;
      main[r] = par(rows[r].B, after[r]);
    }
    return { rows: rows, main: main, after: after, B: main[0] };
  }

  /* Полный расчёт: баланс с насосом и распределение напоров и расходов. */
  function solve(st, open) {
    var red = reduce(st, open), Bn = red.B, res = { B: Bn, Q: 0, Htee: 0, sp: {}, segQ: {}, segH: {}, open: 0, Hpump: 0 };
    if (Bn <= 0) {
      res.Htee = srcH(st, 0) - st.z;
      res.Hsrc = srcH(st, 0);
      return res;
    }
    var hi = 1;
    while (srcH(st, hi) - needH(st, hi, Bn) > 0 && hi < 1e4) hi *= 2;
    var Q = srcH(st, 0) - needH(st, 0, Bn) > 0 ? U.bisect(function (q) { return srcH(st, q) - needH(st, q, Bn); }, 0, hi, 60) : 0;
    res.Q = Q; res.Htee = Q * Q / Bn; res.Hsrc = srcH(st, Q); res.Hpump = pumpH(st, Q);
    distribute(st, red, res, open, res.Htee);
    return res;
  }

  function distribute(st, red, res, open, Htee) {
    var R = st.rows, n = st.perRow, H = Htee;
    for (var r = 0; r < R; r++) {
      var Qrow = Math.sqrt(red.rows[r].B * H);
      var Qon = Math.sqrt(red.after[r] * H);
      res.segQ["m" + r] = Qrow + Qon; res.segH["m" + r] = H;
      // рядок
      var Hj = H - segS(st, rowPipe(st, 0), st.a0) * Qrow * Qrow;
      res.segQ["r" + r + "_0"] = Qrow; res.segH["r" + r + "_0"] = (H + Hj) / 2;
      for (var j = 0; j < n; j++) {
        var q = open[id(r, j)] ? st.k * Math.sqrt(Math.max(0, Hj)) : 0;
        res.sp[id(r, j)] = { H: Hj, q: q };
        if (q > 0) res.open++;
        if (j < n - 1) {
          var Qd = Math.sqrt(red.rows[r].down[j] * Math.max(0, Hj));
          var Hn = Hj - segS(st, rowPipe(st, j + 1), st.a) * Qd * Qd;
          res.segQ["r" + r + "_" + (j + 1)] = Qd; res.segH["r" + r + "_" + (j + 1)] = (Hj + Hn) / 2;
          Hj = Hn;
        }
      }
      H = H - segS(st, st.pipeMain, st.b) * Qon * Qon;
    }
  }

  /* Порядок «удалённости»: от диктующего оросителя (дальний рядок, конец) к ближним. */
  function order(st) {
    var list = [];
    for (var r = 0; r < st.rows; r++) for (var j = 0; j < st.perRow; j++) {
      var dx = (st.rows - 1 - r) * st.b, dy = (st.perRow - 1 - j) * st.a;
      list.push({ id: id(r, j), d: Math.hypot(dx, dy), r: r, j: j });
    }
    list.sort(function (x, y) { return x.d - y.d || y.r - x.r || y.j - x.j; });
    return list;
  }

  /* Нормативный режим: расчётная площадь вокруг диктующего, диктующий даёт q = i·S. */
  function design(st) {
    var S = st.a * st.b, N = Math.min(st.rows * st.perRow, Math.ceil(st.norm.area / S - 1e-9));
    var ord = order(st), open = {};
    for (var k = 0; k < N; k++) open[ord[k].id] = true;
    var red = reduce(st, open);
    var probe = { sp: {}, segQ: {}, segH: {}, open: 0 };
    distribute(st, red, probe, open, 1);
    var d = probe.sp[ord[0].id];
    var qd = st.norm.i * S, Hd = Math.max(5, Math.pow(qd / st.k, 2));
    var Htee = Hd / d.H;                          // сеть однородна: всё масштабируется
    var Q = Math.sqrt(red.B * Htee);
    var Hreq = st.z + supS(st) * Q * Q + uuH(st, Q) + Htee;
    return { N: N, open: open, Q: Q, Hreq: Hreq, Hpump: Hreq - st.Hgar, Hd: Hd, qd: qd, ids: ord.slice(0, N).map(function (o) { return o.id; }) };
  }

  return { defaults: defaults, solve: solve, reduce: reduce, order: order, design: design, pumpH: pumpH, srcH: srcH, needH: needH, uuH: uuH, supS: supS, segS: segS, rowPipe: rowPipe, id: id, UU: UU, KLIST: KLIST };
})();

/* ================================================================ интерфейс */
var SprinkUI = (function () {
  "use strict";
  var $ = U.$;
  var st, form, active = false, last = 0, sol, shown = null, hist = [], key = "", refs = {}, geo = {}, anim = { t: 0, off: {} };
  var STORE = "pumplab.sprink.v1";

  function sections() {
    var popts = Pipes.options();
    return [
      { title: "Насос и ввод", open: true, fields: [
        { k: "pump.on", t: "check", l: "Пожарный насос работает" },
        { k: "Hgar", t: "range", l: "Гарантированный напор на вводе", u: "м", min: 0, max: 40, step: 1, d: 0 },
        { k: "pump.H0", t: "range", l: "Напор насоса при Q = 0", u: "м", min: 10, max: 150, step: 1, d: 0 },
        { k: "pump.Qn", t: "range", l: "Номинальная подача", u: "л/с", min: 2, max: 80, step: 0.5 },
        { k: "pump.Hn", t: "range", l: "Напор при номинальной подаче", u: "м", min: 5, max: 140, step: 1, d: 0 },
        { k: "z", t: "range", l: "Оросители выше оси насоса на", u: "м", min: 0, max: 60, step: 0.5 },
        { k: "Lsup", t: "range", l: "Длина подающего трубопровода и стояка", u: "м", min: 1, max: 300, step: 1, d: 0 },
        { k: "pipeSup", t: "select", l: "Подающий трубопровод", opts: popts },
        { k: "uu", t: "select", l: "Узел управления", num: true, opts: Sprink.UU.map(function (u, i) { return [i, u[0] + " (ξ = " + u[1].toExponential(2) + ")"]; }) }
      ] },
      { title: "Секция и оросители", open: true, fields: [
        { k: "k", t: "select", l: "Ороситель, K л/(с·МПа^0,5)", num: true, opts: Sprink.KLIST },
        { k: "rows", t: "range", l: "Рядков", u: "", min: 1, max: 8, step: 1, d: 0 },
        { k: "perRow", t: "range", l: "Оросителей в рядке", u: "", min: 1, max: 8, step: 1, d: 0 },
        { k: "a", t: "range", l: "Шаг оросителей в рядке", u: "м", min: 1.5, max: 4.5, step: 0.1 },
        { k: "b", t: "range", l: "Шаг рядков", u: "м", min: 1.5, max: 4.5, step: 0.1 },
        { k: "a0", t: "range", l: "От магистрали до первого оросителя", u: "м", min: 0.5, max: 6, step: 0.1 },
        { k: "pipeMain", t: "select", l: "Распределительная магистраль", opts: popts },
        { k: "pipeRoot", t: "select", l: "Рядок (у магистрали)", opts: popts },
        { k: "pipeTip", t: "select", l: "Рядок (концевые участки)", opts: popts },
        { k: "nTip", t: "range", l: "Концевых участков меньшего Ду", u: "", min: 0, max: 8, step: 1, d: 0 },
        { k: "local", t: "range", l: "Коэффициент на местные потери", u: "", min: 1, max: 1.5, step: 0.05, d: 2 }
      ] },
      { title: "Норматив (СП 485, табл. 6.1)", fields: [
        { k: "norm.i", t: "range", l: "Интенсивность орошения", u: "л/(с·м²)", min: 0.04, max: 0.5, step: 0.01, d: 2, hint: "Группа 1 — 0,08; группа 2 (гаражи, стоянки) — 0,12; группа 3 — 0,24." },
        { k: "norm.area", t: "range", l: "Площадь для расчёта расхода", u: "м²", min: 30, max: 360, step: 10, d: 0 }
      ] }
    ];
  }

  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* не важно */ } }

  function recalc() {
    // убрать открытые оросители за пределами сетки
    Object.keys(st.open).forEach(function (k) { var p = k.split(":"); if (+p[0] >= st.rows || +p[1] >= st.perRow) delete st.open[k]; });
    sol = Sprink.solve(st, st.open);
    var sig = Object.keys(st.open).sort().join(",") + "|" + JSON.stringify([st.rows, st.perRow, st.k, st.pump, st.Hgar, st.z]);
    if (!hist.length || hist[hist.length - 1].sig !== sig) {
      hist.push({ sig: sig, B: sol.B, Q: sol.Q, H: sol.Hsrc, n: sol.open });
      if (hist.length > 7) hist.shift();
    }
    if (!shown) shown = { Q: sol.Q, H: sol.Hsrc };
  }

  /* ------------------------------------------------------------ план секции */
  function layoutKey() { return [st.rows, st.perRow, st.a, st.b, st.a0].join("|"); }
  function build() {
    var W = 1140, H = 560, x0 = 330, y0 = 500;
    var spanX = (st.rows - 1) * st.b + st.b, spanY = st.a0 + (st.perRow - 1) * st.a + st.a * 0.8;
    var s = Math.min(70, 740 / Math.max(spanX, 1), 440 / Math.max(spanY, 1));
    geo = { s: s, x0: x0, y0: y0,
      X: function (r) { return x0 + r * st.b * s; },
      Y: function (j) { return y0 - (st.a0 + j * st.a) * s; } };
    var sv = '<svg viewBox="0 0 ' + W + " " + H + '" class="scheme-svg">';
    function pipe(idn, d, w) { return '<path class="pipe' + (w ? " " + w : "") + '" id="sb_' + idn + '" d="' + d + '"/><path class="flow" id="sf_' + idn + '" d="' + d + '"/>'; }
    function txt(idn, x, y, cls, a, c) { return "<text" + (idn ? ' id="' + idn + '"' : "") + ' x="' + x + '" y="' + y + '" class="' + (cls || "") + '" text-anchor="' + (a || "start") + '">' + (c || "") + "</text>"; }
    // зона площади орошения каждого оросителя (сетка)
    sv += '<rect class="room" x="' + (x0 - st.b * s / 2) + '" y="' + (geo.Y(st.perRow - 1) - st.a * s / 2) + '" width="' + (st.rows * st.b * s) + '" height="' + ((st.a0 + (st.perRow - 1) * st.a + st.a / 2) * s) + '"/>';
    // насосная и подводка
    sv += '<g class="spump run" id="spPump"><circle cx="70" cy="' + y0 + '" r="26" class="casing-in"/>' +
      '<g id="spImp"><line class="blade" x1="52" y1="' + y0 + '" x2="88" y2="' + y0 + '"/><line class="blade" x1="70" y1="' + (y0 - 18) + '" x2="70" y2="' + (y0 + 18) + '"/></g></g>';
    sv += txt(null, 70, y0 + 44, "tiny", "middle", "пожарный насос");
    sv += txt("spPumpT", 70, y0 - 36, "val", "middle", "");
    sv += pipe("sup", "M96 " + y0 + " H" + x0, "big");
    sv += '<g class="uu"><rect x="160" y="' + (y0 - 16) + '" width="44" height="32" rx="4"/>' + txt(null, 182, y0 + 4, "tiny", "middle", "УУ") + "</g>";
    sv += txt(null, 182, y0 + 32, "tiny muted", "middle", "узел управления");
    sv += txt("spSupT", 250, y0 + 48, "tiny muted", "middle", "");
    sv += txt("spHtee", x0 - 8, y0 - 12, "val", "end", "");
    // магистраль и рядки
    for (var r = 0; r < st.rows; r++) {
      var x = geo.X(r);
      if (r < st.rows - 1) sv += pipe("m" + (r + 1), "M" + x + " " + y0 + " H" + geo.X(r + 1), "big");
      sv += pipe("r" + r + "_0", "M" + x + " " + y0 + " V" + geo.Y(0));
      for (var j = 1; j < st.perRow; j++) sv += pipe("r" + r + "_" + j, "M" + x + " " + geo.Y(j - 1) + " V" + geo.Y(j));
    }
    // оросители
    for (r = 0; r < st.rows; r++) for (j = 0; j < st.perRow; j++) {
      var cx = geo.X(r), cy = geo.Y(j), sid = Sprink.id(r, j), R0 = Math.min(st.a, st.b) * s * 0.48;
      sv += '<g class="spr" id="sp_' + sid + '" data-spr="' + sid + '">' +
        '<circle class="spray" id="spS_' + sid + '" cx="' + cx + '" cy="' + cy + '" r="' + R0.toFixed(1) + '"/>' +
        '<circle class="spray-ring" id="spR_' + sid + '" cx="' + cx + '" cy="' + cy + '" r="' + (R0 * 0.6).toFixed(1) + '"/>' +
        '<circle class="head" cx="' + cx + '" cy="' + cy + '" r="6"/>' +
        '<circle class="hit" cx="' + cx + '" cy="' + cy + '" r="' + Math.max(12, R0 * 0.8).toFixed(1) + '"/></g>';
      sv += txt("spT_" + sid, cx + 9, cy - 6, "tiny", "start", "");
      sv += txt("spT2_" + sid, cx + 9, cy + 7, "tiny muted", "start", "");
    }
    sv += '<rect class="dzone" id="spZone" x="0" y="0" width="0" height="0"/>';
    // табло
    sv += '<g class="cabinet"><rect x="16" y="14" width="290" height="126" rx="6"/>' + txt(null, 28, 32, "cap", "start", "Расчётный участок") +
      txt("spC1", 28, 50, "tiny", "start", "") + txt("spC2", 28, 66, "val", "start", "") + txt("spC3", 28, 82, "tiny", "start", "") + txt("spC4", 28, 98, "tiny", "start", "") + txt("spC5", 28, 116, "tiny strong", "start", "") + txt("spC6", 28, 132, "tiny muted", "start", "") + "</g>";
    sv += txt(null, x0, y0 + 50, "tiny muted", "start", "план: магистраль внизу, рядки вверх; щёлкните по оросителю — он вскроется");
    sv += "</svg>";
    $("spScheme").innerHTML = sv;
    refs = {};
    Array.prototype.forEach.call($("spScheme").querySelectorAll("[id]"), function (e) { refs[e.id] = e; });
  }

  function pcol(h) { return U.mix(U.css("--pipe-lo"), U.css("--pipe-hi"), U.clamp(h / 80, 0, 1)); }
  function setT(idn, s) { var e = refs[idn]; if (e && e.textContent !== s) e.textContent = s; }
  function flow(idn, q, h, dt) {
    var b = refs["sb_" + idn], f = refs["sf_" + idn]; if (!b) return;
    b.style.stroke = pcol(h);
    if (!(q > 0.01)) { f.style.opacity = 0; return; }
    f.style.opacity = 0.95;
    anim.off[idn] = ((anim.off[idn] || 0) - (10 + 22 * Math.sqrt(q)) * dt) % 1600;
    f.setAttribute("stroke-dashoffset", anim.off[idn].toFixed(1));
  }

  function drawScheme(dt) {
    var k = layoutKey(); if (k !== key) { key = k; build(); }
    anim.t += dt;
    // сглаженное «течение»: показ стремится к решению (набор давления в сети не мгновенный)
    var a = Math.min(1, dt / 0.5);
    shown.Q += (sol.Q - shown.Q) * a; shown.H += (sol.Hsrc - shown.H) * a;
    var scale = sol.Q > 0 ? shown.Q / sol.Q : 0;
    var S = st.a * st.b;
    refs.spImp.setAttribute("transform", st.pump.on ? "rotate(" + ((anim.t * 600) % 360).toFixed(0) + " 70 " + geo.y0 + ")" : "");
    refs.spPump.setAttribute("class", "spump" + (st.pump.on ? " run" : ""));
    setT("spPumpT", st.pump.on ? U.fmt(shown.Q, 1) + " л/с · " + U.fmt(sol.Hpump, 1) + " м" : "насос стоит");
    flow("sup", shown.Q, sol.Hsrc, dt);
    setT("spSupT", Pipes.label(Pipes.byId(st.pipeSup)) + ", " + U.fmt(st.Lsup, 0) + " м, Δz " + U.fmt(st.z, 1) + " м");
    setT("spHtee", "у магистрали " + U.fmt(sol.Htee, 1) + " м");
    for (var r = 0; r < st.rows; r++) {
      if (r > 0) flow("m" + r, (sol.segQ["m" + r] || 0) * scale, sol.segH["m" + r] || sol.Htee, dt);
      for (var j = 0; j < st.perRow; j++) {
        var sg = "r" + r + "_" + j;
        flow(sg, (sol.segQ[sg] || 0) * scale, sol.segH[sg] !== undefined ? sol.segH[sg] : sol.Htee, dt);
        var sid = Sprink.id(r, j), sp = sol.sp[sid] || { H: sol.Htee, q: 0 }, open = !!st.open[sid];
        var q = sp.q * scale, inten = q / S;
        refs["sp_" + sid].setAttribute("class", "spr" + (open ? " open" : "") + (open && inten < st.norm.i ? " low" : ""));
        var spray = refs["spS_" + sid], ring = refs["spR_" + sid];
        if (open && q > 0.01) {
          spray.style.opacity = U.clamp(0.15 + 0.5 * inten / (st.norm.i * 2), 0.15, 0.75).toFixed(2);
          var R0 = Math.min(st.a, st.b) * geo.s * 0.48 * U.clamp(0.55 + 0.25 * Math.sqrt(sp.H / 10), 0.6, 1.25);
          spray.setAttribute("r", R0.toFixed(1));
          var ph = (anim.t * (0.8 + q)) % 1;
          ring.setAttribute("r", (R0 * (0.3 + 0.7 * ph)).toFixed(1));
          ring.style.opacity = (1 - ph).toFixed(2);
          setT("spT_" + sid, U.fmt(q, 2) + " л/с");
          setT("spT2_" + sid, U.fmt(sp.H, 1) + " м · " + U.fmt(inten, 3));
        } else {
          spray.style.opacity = 0; ring.style.opacity = 0;
          setT("spT_" + sid, ""); setT("spT2_" + sid, open ? "" : "");
        }
      }
    }
    // расчётная площадь
    var d = Sprink.design(st), minR = 99, maxR = -1, minJ = 99, maxJ = -1;
    d.ids.forEach(function (x) { var p = x.split(":"); minR = Math.min(minR, +p[0]); maxR = Math.max(maxR, +p[0]); minJ = Math.min(minJ, +p[1]); maxJ = Math.max(maxJ, +p[1]); });
    var z = refs.spZone;
    z.setAttribute("x", (geo.X(minR) - st.b * geo.s / 2).toFixed(1)); z.setAttribute("width", ((maxR - minR + 1) * st.b * geo.s).toFixed(1));
    z.setAttribute("y", (geo.Y(maxJ) - st.a * geo.s / 2).toFixed(1)); z.setAttribute("height", ((maxJ - minJ + 1) * st.a * geo.s).toFixed(1));
    setT("spC1", "Вскрыто оросителей: " + sol.open + " из " + st.rows * st.perRow);
    setT("spC2", "Q = " + U.fmt(shown.Q, 2) + " л/с · Hнас = " + U.fmt(sol.Hpump, 1) + " м");
    var qs = [], hs = [];
    Object.keys(st.open).forEach(function (x) { if (sol.sp[x]) { qs.push(sol.sp[x].q); hs.push(sol.sp[x].H); } });
    var qmin = qs.length ? Math.min.apply(null, qs) : 0, hmax = hs.length ? Math.max.apply(null, hs) : 0;
    setT("spC3", qs.length ? "Интенсивность: мин " + U.fmt(qmin / S, 3) + " при норме " + U.fmt(st.norm.i, 2) + " л/(с·м²)" : "Сеть заполнена, вода стоит");
    setT("spC4", "Требуется по СП 485: Q " + U.fmt(d.Q, 1) + " л/с, Hнас " + U.fmt(d.Hpump, 1) + " м (" + d.N + " оросит.)");
    var ok = qs.length && qmin / S >= st.norm.i - 1e-9;
    setT("spC5", !qs.length ? "Ожидание пожара" : (ok ? "Интенсивность обеспечена" : "Интенсивность НЕ обеспечена"));
    refs.spC5.setAttribute("class", "tiny strong" + (qs.length && !ok ? " bad" : ""));
    setT("spC6", hmax > 100 ? "Давление у оросителя " + U.fmt(hmax / 100, 2) + " МПа > 1,0 МПа!" : "пунктир — расчётная площадь " + U.fmt(st.norm.area, 0) + " м²");
  }

  /* ------------------------------------------------------------ графики */
  function drawQH() {
    var fc = U.fitCanvas($("spQH")), ctx = fc.ctx;
    var d = Sprink.design(st);
    var qz = st.pump.on ? st.pump.Qn * Math.sqrt(st.pump.H0 / (st.pump.H0 - st.pump.Hn)) : 20;
    var xMax = Plot.niceMax(Math.max(qz, d.Q * 1.2, sol.Q * 1.2, 5));
    var yMax = Plot.niceMax(Math.max(st.Hgar + (st.pump.on ? st.pump.H0 : 0), d.Hreq, sol.Hsrc) * 1.12);
    var p = Plot.frame(ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, л/с", yLabel: "Напор на выходе насоса + подпор, м" });
    Plot.clip(p);
    var qs = []; for (var i = 0; i <= 120; i++) qs.push(xMax * i / 120);
    Plot.line(p, qs.map(function (q) { var h = Sprink.srcH(st, q); return h > 0 ? [q, h] : null; }), { color: U.css("--accent"), width: 3 });
    Plot.line(p, [[0, st.Hgar], [xMax, st.Hgar]], { color: U.css("--muted"), width: 1, dash: [3, 3] });
    // история характеристик сети — «по очереди меняется»
    hist.forEach(function (h, k) {
      if (!(h.B > 0)) return;
      var cur = k === hist.length - 1, al = cur ? 1 : 0.2 + 0.5 * k / hist.length;
      Plot.line(p, qs.map(function (q) { return [q, Sprink.needH(st, q, h.B)]; }), { color: U.css("--water"), width: cur ? 2.6 : 1.2, alpha: al, dash: cur ? [] : [5, 3] });
      if (h.Q > 0) {
        Plot.dot(p, h.Q, h.H, cur ? 6 : 3.5, cur ? U.css("--accent") : U.css("--water"), U.css("--panel"), 1.5);
        Plot.label(p, h.Q + xMax * 0.01, h.H + yMax * 0.012, h.n + " шт", U.css("--ink"), "left", "bottom", true);
      }
    });
    // нормативная точка
    Plot.cross(p, d.Q, d.Hreq, 6, U.css("--bad"));
    Plot.label(p, d.Q + xMax * 0.01, d.Hreq - yMax * 0.02, "требуется по СП 485 (" + d.N + " шт)", U.css("--bad"), "left", "top", true);
    Plot.unclip(p);
    Plot.legend(p, [
      { text: "насос + гарантированный напор", color: U.css("--accent"), width: 3 },
      { text: "сеть при текущем числе оросителей", color: U.css("--water"), width: 2.6 },
      { text: "предыдущие состояния", color: U.css("--water"), dash: [5, 3] },
      { text: "нормативный режим", color: U.css("--bad"), cross: true }
    ]);
  }

  function drawBars() {
    var fc = U.fitCanvas($("spBars")), ctx = fc.ctx, S = st.a * st.b;
    var ord = Sprink.order(st).filter(function (o) { return st.open[o.id]; });
    var vals = ord.map(function (o) { var sp = sol.sp[o.id]; return { id: o.id, q: sp ? sp.q : 0, H: sp ? sp.H : 0 }; });
    var yMax = Plot.niceMax(Math.max(st.norm.i * 1.5, vals.reduce(function (m, v) { return Math.max(m, v.q / S); }, 0) * 1.15));
    var n = Math.max(vals.length, 1);
    var p = Plot.frame(ctx, fc.w, fc.h, { x0: 0, x1: n, y1: yMax, noXLabels: true, xTicks: n, yLabel: "Интенсивность, л/(с·м²)" });
    var bw = (p.R - p.L) / n * 0.7;
    vals.forEach(function (v, k) {
      var it = v.q / S, X = p.X(k + 0.5) - bw / 2;
      ctx.fillStyle = it >= st.norm.i ? U.css("--accent") : U.css("--bad");
      ctx.fillRect(X, p.Y(it), bw, p.B - p.Y(it));
      ctx.fillStyle = U.css("--muted"); ctx.font = "10px system-ui, Segoe UI, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      var rj = v.id.split(":");
      ctx.fillText("р" + (+rj[0] + 1) + "·" + (+rj[1] + 1), p.X(k + 0.5), p.B + 3);
      ctx.textBaseline = "bottom"; ctx.fillStyle = U.css("--ink");
      if (bw > 26) ctx.fillText(U.fmt(v.q, 2), p.X(k + 0.5), p.Y(it) - 2);
    });
    Plot.line(p, [[0, st.norm.i], [n, st.norm.i]], { color: U.css("--bad"), width: 1.5, dash: [6, 3] });
    Plot.label(p, n * 0.99, st.norm.i, "норма " + U.fmt(st.norm.i, 2), U.css("--bad"), "right", "bottom", true);
    if (!vals.length) Plot.label(p, n / 2, yMax / 2, "вскройте оросители — щелчком по плану", U.css("--muted"), "center", "middle");
  }

  function info() {
    var S = st.a * st.b, d = Sprink.design(st), s = "";
    function row(a, b, cls) { s += '<div class="rd' + (cls ? " " + cls : "") + '"><span>' + a + "</span><b>" + b + "</b></div>"; }
    row("Вскрыто оросителей", sol.open + " из " + st.rows * st.perRow);
    row("Расход сети / напор насоса", U.fmt(sol.Q, 2) + " л/с (" + U.fmt(sol.Q * 3.6, 1) + " м³/ч) / " + U.fmt(sol.Hpump, 1) + " м");
    row("Напор у начала магистрали", U.fmt(sol.Htee, 1) + " м");
    row("Потери в подводке и УУ", U.fmt(Sprink.supS(st) * sol.Q * sol.Q, 2) + " + " + U.fmt(Sprink.uuH(st, sol.Q), 2) + " м");
    row("Характеристика сети B = Q²/H", sol.B > 0 ? U.fmt(sol.B, 3) + " (л/с)²/м" : "—");
    row("Нормативный режим", d.N + " оросит. на " + U.fmt(st.norm.area, 0) + " м², диктующий " + U.fmt(d.qd, 2) + " л/с при " + U.fmt(d.Hd, 1) + " м");
    row("", "Qтр " + U.fmt(d.Q, 2) + " л/с, Hтр насоса " + U.fmt(d.Hpump, 1) + " м (с учётом Hгар " + U.fmt(st.Hgar, 0) + " м)", "sub");
    var pumpAtD = Sprink.srcH(st, d.Q);
    row("Насос в нормативной точке даёт", U.fmt(pumpAtD, 1) + " м против " + U.fmt(d.Hreq, 1) + " м — " + (pumpAtD >= d.Hreq ? "хватает" : "НЕ хватает"), pumpAtD >= d.Hreq ? "" : "bad");
    // скорости
    var vmax = 0, where = "";
    Object.keys(sol.segQ).forEach(function (kk) {
      var pipe = kk[0] === "m" ? Pipes.byId(st.pipeMain) : Pipes.byId(Sprink.rowPipe(st, +kk.split("_")[1]));
      var v = Pipes.velocity(sol.segQ[kk] * 3.6, pipe.dIn);
      if (v > vmax) { vmax = v; where = kk[0] === "m" ? "магистраль" : "рядок"; }
    });
    var vs = Pipes.velocity(sol.Q * 3.6, Pipes.byId(st.pipeSup).dIn);
    row("Наибольшая скорость", U.fmt(Math.max(vmax, vs), 2) + " м/с (" + (vs > vmax ? "подводка" : where) + ")", Math.max(vmax, vs) > 10 ? "bad" : "");
    var notes = [];
    if (sol.open === 1) notes.push("<li>Один ороситель при работающем насосе стоит почти под напором насоса при Q ≈ 0: расход и интенсивность в разы больше нормы. Это нормально — расчёт ведётся на худший случай, когда вскрылась вся расчётная площадь.</li>");
    if (sol.open > d.N) notes.push('<li class="warn">Вскрыто больше, чем в расчётной площади (' + d.N + "): точка уходит правее нормативной, напор падает, интенсивность у дальних оросителей может стать ниже нормы.</li>");
    if (!st.pump.on && sol.open) notes.push('<li class="warn">Насос не работает — оросители питаются только гарантированным напором ' + U.fmt(st.Hgar, 0) + " м.</li>");
    s += notes.length ? '<ul class="notes">' + notes.join("") + "</ul>" : "";
    // таблица оросителей
    var ord = Sprink.order(st).filter(function (o) { return st.open[o.id]; });
    if (ord.length) {
      s += '<table class="loss"><tr><th>Ороситель</th><th>H, м</th><th>P, МПа</th><th>q, л/с</th><th>i, л/(с·м²)</th></tr>';
      ord.forEach(function (o) {
        var sp = sol.sp[o.id], it = sp.q / S;
        s += "<tr><td>рядок " + (o.r + 1) + ", № " + (o.j + 1) + (o === Sprink.order(st)[0] ? " (диктующий)" : "") + "</td><td>" + U.fmt(sp.H, 1) + "</td><td>" + U.fmt(sp.H / 100, 3) + "</td><td>" + U.fmt(sp.q, 2) + "</td><td" + (it < st.norm.i ? ' class="bad"' : "") + ">" + U.fmt(it, 3) + "</td></tr>";
      });
      s += "</table>";
    }
    $("spInfo").innerHTML = s;
  }

  function tick(real) {
    drawScheme(real);
    drawQH();
    drawBars();
    anim.ui = (anim.ui || 0) + real;
    if (anim.ui > 0.3) { anim.ui = 0; info(); }
  }
  function frame(ts) {
    if (!active) return;
    requestAnimationFrame(frame);
    var real = last ? Math.min(0.1, (ts - last) / 1000) : 0.016; last = ts;
    tick(real);
  }

  function changed() { recalc(); save(); }

  function init() {
    st = Sprink.defaults();
    try { var o = JSON.parse(localStorage.getItem(STORE) || "null"); if (o && o.pump && o.norm) st = U.merge(st, o); } catch (e) { /* по умолчанию */ }
    form = Form.build($("spSide"), sections(), function () { return st; }, changed);
    recalc();
    $("spScheme").addEventListener("click", function (e) {
      var t = e.target.closest("[data-spr]"); if (!t) return;
      var k = t.getAttribute("data-spr");
      if (st.open[k]) delete st.open[k]; else st.open[k] = true;
      changed();
    });
    $("spClose").addEventListener("click", function () { st.open = {}; hist = []; changed(); });
    $("spAll").addEventListener("click", function () { for (var r = 0; r < st.rows; r++) for (var j = 0; j < st.perRow; j++) st.open[Sprink.id(r, j)] = true; changed(); });
    $("spDesign").addEventListener("click", function () { st.open = {}; Sprink.design(st).ids.forEach(function (x) { st.open[x] = true; }); changed(); });
    $("spNext").addEventListener("click", function () {
      var ord = Sprink.order(st); for (var i = 0; i < ord.length; i++) if (!st.open[ord[i].id]) { st.open[ord[i].id] = true; break; }
      changed();
    });
    $("spPrev").addEventListener("click", function () {
      var ord = Sprink.order(st); for (var i = ord.length - 1; i >= 0; i--) if (st.open[ord[i].id]) { delete st.open[ord[i].id]; break; }
      changed();
    });
    $("spDefaults").addEventListener("click", function () { st = Sprink.defaults(); hist = []; key = ""; form = Form.build($("spSide"), sections(), function () { return st; }, changed); changed(); });
    window.SprinkLab = { get st() { return st; }, get sol() { return sol; }, recalc: recalc, draw: function () { tick(0.6); anim.ui = 1; tick(0); } };
  }
  function start() { if (active) return; active = true; last = 0; key = ""; requestAnimationFrame(frame); }
  function stop() { active = false; }
  return { init: init, start: start, stop: stop };
})();
