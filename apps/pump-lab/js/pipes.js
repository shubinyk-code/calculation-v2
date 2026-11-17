/* Стальные трубы и потери напора — те же таблицы и формулы, что в SprinklerWeb.

   Kт — удельная характеристика трубы по СП 485.1311500.2020, табл. Б.2
   (лист «Удельн. хар-ки тр-в» калькулятора АПТ):   ΔH = Q²·L / Kт,  Q в л/с.

   Шевелев для неновых стальных труб (как в SprinklerWeb → ВПВ):
       h = λ·L/dр·V²/2g,   dр = dвн − запас на отложения (1 мм)
       λ = 0,021/dр^0,3                        при V ≥ 1,2 м/с
       λ = 0,0179/dр^0,3·(1 + 0,867/V)^0,3     при V < 1,2 м/с   (dр в м)
   Это то же самое, что таблицы Шевелева 1000i = 1,07·V²/dр^1,3. */
var Pipes = (function () {
  "use strict";
  var G = 9.81;

  // [Ду, наружный, стенка, Kт]
  var RAW = [
    { key: "3262", name: "Сталь водогазопроводная, ГОСТ 3262", sizes: [
      [15, 21.3, 2.5, 0.18], [20, 26.8, 2.5, 0.926], [25, 33.5, 2.8, 3.65], [32, 42.3, 2.8, 16.5],
      [40, 48, 3, 34.5], [50, 60, 3, 135], [65, 75.5, 3.2, 517], [80, 88.5, 3.5, 1262],
      [90, 101, 3.5, 2725], [100, 114, 4, 5205], [125, 140, 4, 16940], [150, 165, 4, 43000]] },
    { key: "10704", name: "Сталь электросварная, ГОСТ 10704", sizes: [
      [20, 25, 2, 0.75], [25, 32, 2.2, 3.44], [32, 40, 2.2, 13.97], [40, 45, 2.2, 28.7],
      [50, 57, 3, 99.53], [65, 76, 3, 554.57], [80, 89, 3.5, 1304.2], [100, 108, 4, 3803.14],
      [100, 114, 3, 5757], [125, 133, 4, 12637.68], [150, 159, 4.5, 33657], [200, 219, 4.5, 204577.35]] }
  ];

  var LIST = [];
  RAW.forEach(function (m) {
    m.sizes.forEach(function (r) {
      LIST.push({ id: m.key + ":" + r[0] + ":" + r[1] + ":" + r[2], mat: m.key, matName: m.name, dn: r[0], od: r[1], wall: r[2], kt: r[3], dIn: r[1] - 2 * r[2] });
    });
  });

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }
  function label(p) { return "Ду" + p.dn + " (" + U.fmt(p.od, 1) + "×" + U.fmt(p.wall, 1) + ")"; }
  function options(mat) {
    return LIST.filter(function (p) { return !mat || p.mat === mat; }).map(function (p) { return [p.id, label(p) + (mat ? "" : " · " + p.mat)]; });
  }

  /* Скорость, м/с. Q — м³/ч, d — мм. */
  function velocity(Qm3h, dmm) { var d = dmm / 1000; return d > 0 ? Math.abs(Qm3h) / 3600 / (Math.PI * d * d / 4) : 0; }

  function lambdaShevelev(dmm, V) {
    var dm = Math.pow(dmm / 1000, 0.3);
    if (V <= 1e-6) V = 1e-6;
    return V >= 1.2 ? 0.021 / dm : 0.0179 / dm * Math.pow(1 + 0.867 / V, 0.3);
  }

  /* Потери на участке по Шевелеву + местные по Σζ. Q — м³/ч, L — м, reserve — мм.
     Возвращает разбор: V, λ, по длине, местные, итог. */
  function shevelev(Qm3h, pipe, L, zeta, reserve) {
    var d = pipe.dIn - (reserve || 0);
    var V = velocity(Qm3h, d);
    var lam = lambdaShevelev(d, V);
    var hl = lam * L / (d / 1000) * V * V / (2 * G);
    var hm = (zeta || 0) * V * V / (2 * G);
    return { V: V, lambda: lam, hl: hl, hm: hm, h: hl + hm, d: d, i1000: 1000 * lam / (d / 1000) * V * V / (2 * G) };
  }

  /* Потери по Kт СП 485: ΔH = Q²·L/Kт, Q в л/с. */
  function ktLoss(Qls, pipe, L) { return Qls * Qls * L / pipe.kt; }

  return { LIST: LIST, byId: byId, label: label, options: options, velocity: velocity, lambdaShevelev: lambdaShevelev, shevelev: shevelev, ktLoss: ktLoss, MATS: RAW.map(function (m) { return [m.key, m.name]; }) };
})();

/* Небольшой построитель панелей настроек для вкладок «Дренаж» и «Спринклеры»:
   поля описываются массивом, значения живут в объекте состояния по пути «a.b». */
var Form = (function () {
  "use strict";
  function build(host, sections, getState, onChange) {
    host.innerHTML = "";
    var rows = [];
    sections.forEach(function (sec) {
      var det = U.el("details", { "class": "sec" });
      if (sec.open) det.open = true;
      det.innerHTML = "<summary>" + sec.title + "</summary>";
      var box = U.el("div", { "class": "fields" });
      sec.fields.forEach(function (f) {
        var row;
        if (f.t === "html") { row = U.el("div", { "class": "field" }); row.id = f.id; }
        else if (f.t === "select") {
          row = U.el("label", { "class": "field sel" });
          row.innerHTML = '<span class="lbl">' + f.l + '</span><select></select>';
        } else if (f.t === "check") {
          row = U.el("label", { "class": "field chk" });
          row.innerHTML = '<input type="checkbox"><span>' + f.l + "</span>";
        } else {
          row = U.el("div", { "class": "field rng" });
          row.innerHTML = '<div class="rl"><span class="lbl">' + f.l + '</span><span class="rv"><input type="text" inputmode="decimal" class="num"><em>' + (f.u || "") + '</em></span></div><input type="range" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">' + (f.hint ? '<div class="hint">' + f.hint + "</div>" : "");
        }
        box.appendChild(row);
        rows.push({ f: f, row: row });
        if (f.t === "html") return;
        var inp = row.querySelector("select, input[type=checkbox], input[type=range]");
        var num = row.querySelector(".num");
        inp.addEventListener("input", function () {
          var v = f.t === "check" ? inp.checked : (f.t === "select" ? inp.value : +inp.value);
          if (f.t === "select" && f.num) v = +v;
          U.setPath(getState(), f.k, v);
          onChange(f.k); sync();
        });
        if (f.t === "select") inp.addEventListener("change", function () { var v = inp.value; if (f.num) v = +v; U.setPath(getState(), f.k, v); onChange(f.k); sync(); });
        if (num) num.addEventListener("change", function () {
          var x = parseFloat(String(num.value).replace(",", "."));
          if (isFinite(x)) { U.setPath(getState(), f.k, U.clamp(x, f.min, f.max)); onChange(f.k); }
          sync();
        });
      });
      det.appendChild(box);
      host.appendChild(det);
    });
    function sync() {
      var st = getState();
      rows.forEach(function (r) {
        var f = r.f;
        r.row.style.display = (!f.show || f.show(st)) ? "" : "none";
        if (f.t === "html") return;
        var v = U.getPath(st, f.k);
        if (f.t === "select") {
          var sel = r.row.querySelector("select");
          var opts = typeof f.opts === "function" ? f.opts(st) : f.opts;
          var sig = opts.map(function (o) { return o[0]; }).join("|");
          if (sel._sig !== sig) { sel.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join(""); sel._sig = sig; }
          sel.value = String(v);
        } else if (f.t === "check") r.row.querySelector("input").checked = !!v;
        else {
          var inp = r.row.querySelector("input[type=range]"), num = r.row.querySelector(".num");
          if (document.activeElement !== inp) inp.value = v;
          if (document.activeElement !== num) num.value = U.fmt(v, f.d !== undefined ? f.d : (f.step >= 1 ? 0 : (f.step >= 0.1 ? 1 : 2)));
        }
      });
    }
    sync();
    return { sync: sync };
  }
  return { build: build };
})();
