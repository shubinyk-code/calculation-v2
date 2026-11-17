/* Проверки модели. Открыть tests.html — зелёные строки прошли, красные нет. */
(function () {
  "use strict";
  var results = [];
  function ok(name, cond, info) { results.push({ name: name, ok: !!cond, info: info || "" }); }
  function near(a, b, tol) { return Math.abs(a - b) <= tol; }
  function sim(over) { var c = Model.defaults(); if (over) U.merge(c, over); return new Model.Sim(c); }
  function run(s, sec) { var n = Math.round(sec / 0.01); for (var i = 0; i < n; i++) s.step(0.01); return s; }
  function tapsOn(list) { return Model.defaults().taps.map(function (t, i) { t.on = list.indexOf(i) >= 0; return t; }); }

  // --- Насос и законы подобия
  var p = Model.defaults().pump, c = Pump.coef(p);
  ok("Кривая проходит через H0 и оптимум", near(Pump.head(p, c, 0, 1), p.H0, 1e-9) && near(Pump.head(p, c, p.Qopt, 1), p.Hopt, 1e-9));
  var r = 0.7, q = 4;
  ok("Напор: H(Q·r, r) = r²·H(Q, 1)", near(Pump.head(p, c, q * r, r), r * r * Pump.head(p, c, q, 1), 1e-9));
  ok("Мощность: P(Q·r, r) = r³·P(Q, 1)", near(Pump.power(p, c, q * r, r), r * r * r * Pump.power(p, c, q, 1), 1e-9));
  ok("NPSHтр: ~ r² в подобных режимах", near(Pump.npshr(p, q * r, r), r * r * Pump.npshr(p, q, 1), 1e-9));
  var ph = U.merge(U.deepCopy(p), { hump: 0.3 }), ch = Pump.coef(ph);
  ok("Горбатая кривая: вершина выше H0", Pump.peak(ph, ch, 1).H > ph.H0, U.fmt(Pump.peak(ph, ch, 1).H, 2));
  var etaBest = 0; for (var qq = 0.5; qq < 12; qq += 0.05) etaBest = Math.max(etaBest, Pump.eta(p, c, qq, 1));
  ok("КПД в разумных пределах", etaBest > 0.55 && etaBest < 0.8, U.fmt(etaBest * 100, 1) + "%");

  // --- Давление пара
  ok("Давление пара при 20 °C ≈ 0,24 м", near(U.vaporHead(20), 0.24, 0.02), U.fmt(U.vaporHead(20), 3));
  ok("Давление пара при 100 °C ≈ 10,3 м", near(U.vaporHead(100), 10.33, 0.25), U.fmt(U.vaporHead(100), 2));

  // --- Гидравлика
  var s0 = sim();
  var mono = true, prev = -1;
  for (var H = -5; H < 120; H += 0.5) { var v = s0.stored(H); if (v < prev) mono = false; prev = v; }
  ok("Запас воды в баке растёт с давлением", mono);

  var s1 = sim({ pumpCount: 1, ctrl: { mode: "manualDol", manualOn: [true, false, false] }, taps: tapsOn([1, 3]) });
  run(s1, 400);
  var eq = s1.equilibrium();
  ok("Ручной пуск: давление приходит в равновесие", near(s1.Hn, eq.H, 0.05), U.fmt(s1.Hn, 2) + " / " + U.fmt(eq.H, 2));
  ok("В равновесии подача = разбору", near(s1.Qp, s1.Qs, 0.01), U.fmt(s1.Qp, 3) + " / " + U.fmt(s1.Qs, 3));

  var s2 = sim({ pumpCount: 1, net: { valveOpen: 0 }, ctrl: { mode: "manualDol", manualOn: [true, false, false] } });
  run(s2, 60);
  ok("Закрытая задвижка: давление = подпор + H0 − потери", near(s2.Hn, s2.cfg.source.Hmain + p.H0, 0.3), U.fmt(s2.Hn, 2));
  ok("Закрытая задвижка: вода греется", s2.pumps[0].T > s2.cfg.source.Tin + 1, U.fmt(s2.pumps[0].T, 2) + " °C");

  var s3 = sim({ pumpCount: 1, source: { type: "tank" }, ctrl: { mode: "manualVfd", fManual: 34, manualOn: [true, false, false] }, taps: tapsOn([3]) });
  run(s3, 30);
  ok("Ниже частоты отсечки обратный клапан закрыт", s3.Qp < 1e-3, U.fmt(s3.Qp, 4) + " м³/ч");

  // --- Регуляторы
  var s4 = sim({ ctrl: { sleep: false }, taps: tapsOn([0, 1, 2, 3]) });
  run(s4, 60);
  ok("ПЧ держит уставку", near(s4.Hn, 60, 0.2), U.fmt(s4.Hn, 2));
  ok("При большом разборе включён пиковый насос", s4.pumps[1].on);

  var s5 = sim({ ctrl: { mode: "vfdAll", sleep: false }, taps: tapsOn([0, 1, 2, 3]) });
  run(s5, 60);
  ok("ПЧ на каждом: одинаковая частота работающих", s5.pumps[0].on && s5.pumps[1].on && near(s5.pumps[0].f, s5.pumps[1].f, 0.01));

  var s6 = sim({ ctrl: { mode: "relay" }, taps: tapsOn([1]) });
  run(s6, 30);
  var mn = 1e9, mx = -1e9;
  for (var k = 0; k < 900; k++) { s6.step(0.01 * 10); }
  s6.hist.slice(-500).forEach(function (h) { mn = Math.min(mn, h.Hn); mx = Math.max(mx, h.Hn); });
  ok("Реле давления: пила между порогами", mn > 52 - 3 && mx < 64 + 3 && mx - mn > 5, U.fmt(mn, 1) + "…" + U.fmt(mx, 1));

  var s7 = sim({ taps: tapsOn([4]) });
  run(s7, 150);
  var slept = s7.events.some(function (e) { return /спящий режим/.test(e.text); });
  ok("Утечка: насос уходит в спящий режим", slept);

  var s8 = sim({ source: { type: "tank", loop: false, floatQ: 3, level0: 0.8, tankArea: 0.2 }, ctrl: { sleep: false }, taps: tapsOn([0, 1, 2]) });
  run(s8, 200);
  ok("Бак пустеет — срабатывает защита от сухого хода", s8.events.some(function (e) { return /Сухой ход/.test(e.text); }));

  var s9 = sim({ pumpCount: 1, source: { type: "tank", tankZ: -5.5, level0: 1.2, levelSet: 1.3, Tin: 75 }, ctrl: { mode: "manualDol", manualOn: [true, false, false] }, taps: tapsOn([0, 1, 2, 3]) });
  run(s9, 20);
  ok("Горячая вода и всасывание: кавитация", s9.pumps[0].cavStage >= 2, "NPSHа " + U.fmt(s9.pumps[0].npshA, 2) + ", NPSHтр " + U.fmt(s9.pumps[0].npshR, 2));

  var s10 = sim({ source: { Hmain: 55 }, ctrl: { sleep: false }, taps: tapsOn([4]) });
  run(s10, 60);
  ok("Высокий подпор: частота упирается в f мин, давление выше уставки", s10.u <= s10.cfg.vfd.fMin + 0.01 && s10.Hn > 62, U.fmt(s10.u, 1) + " Гц, " + U.fmt(s10.Hn, 1) + " м");

  // --- Трубы: Шевелев в форме Дарси совпадает с табличной 1000i = 1,07·V²/dр^1,3
  var p50 = Pipes.byId("3262:50:60:3"), sh = Pipes.shevelev(10, p50, 1, 0, 1);
  var tab = 1.07 * sh.V * sh.V / Math.pow(sh.d / 1000, 1.3);
  ok("Шевелев: 1000i по Дарси = 1,07·V²/dр^1,3 (V ≥ 1,2)", near(sh.i1000, tab, tab * 0.01), U.fmt(sh.i1000, 2) + " / " + U.fmt(tab, 2));

  // --- Дренаж
  var ds = Drain.defaults();
  ds.layout = "separate";
  var a1 = Drain.solve(ds, 0.6, [1, 0]), a2 = Drain.solve(ds, 0.6, [1, 1]);
  ok("Дренаж раздельно: два одинаковых насоса дают ровно вдвое", near(a2.Q, 2 * a1.Q, 0.01), U.fmt(a1.Q, 2) + " → " + U.fmt(a2.Q, 2));
  ds.layout = "joint";
  var j1 = Drain.solve(ds, 0.6, [1, 0]), j2 = Drain.solve(ds, 0.6, [1, 1]);
  var P = Drain.pipes(ds);
  ok("Дренаж совместно: прибавка второго насоса меньше 100%", j2.Q > j1.Q && j2.Q < 2 * j1.Q, U.fmt(j1.Q, 2) + " → " + U.fmt(j2.Q, 2));
  ok("Дренаж совместно: баланс в узле слияния", near(j2.E - Drain.hCommon(ds, P, j2.Q), ds.zOut, 0.01) && near(j2.q[0] + j2.q[1], j2.Q, 0.02));
  ok("Дренаж: один насос одинаков в обеих схемах", near(j1.Q, a1.Q, 0.02), U.fmt(j1.Q, 3) + " / " + U.fmt(a1.Q, 3));
  ds.cv = false;
  var nc = Drain.solve(ds, 0.6, [1, 0]);
  ok("Без обратного клапана вода идёт назад через стоящий насос", nc.q[1] < -0.1, U.fmt(nc.q[1], 2) + " м³/ч");
  var dsim = new Drain.Sim(Drain.defaults()); dsim.st.inflow = 10;
  for (var t = 0; t < 1800 / 0.05; t++) dsim.step(0.05);
  ok("Поплавки: насос включается и выключается, уровень в пределах", dsim.p[0].starts + dsim.p[1].starts >= 2 && dsim.level < dsim.st.lv.on2 + 0.05 && dsim.level > dsim.st.lv.off - 0.05, "пусков " + (dsim.p[0].starts + dsim.p[1].starts));

  // --- Спринклеры: один рядок сверяется с «маршем» калькулятора
  var ss = Sprink.defaults(); ss.rows = 1; ss.perRow = 4; ss.nTip = 0; ss.pipeRoot = "3262:32:42.3:2.8";
  var op = {}; for (var j = 0; j < 4; j++) op[Sprink.id(0, j)] = true;
  var sr = Sprink.solve(ss, op);
  var Hd = sr.sp["0:3"].H, Q = ss.k * Math.sqrt(Hd), H = Hd, kt = Pipes.byId(ss.pipeRoot).kt;
  for (j = 2; j >= 0; j--) { H += ss.local * Q * Q * ss.a / kt; Q += ss.k * Math.sqrt(H); }
  H += ss.local * Q * Q * ss.a0 / kt;
  ok("Спринклеры: свёртка B совпадает с маршем от диктующего", near(Q, sr.Q, 1e-6) && near(H, sr.Htee, 1e-6), U.fmt(Q, 4) + " / " + U.fmt(sr.Q, 4));
  var sa = Sprink.defaults(), ordS = Sprink.order(sa), o1 = {}; o1[ordS[0].id] = true;
  var s1 = Sprink.solve(sa, o1), dsn = Sprink.design(sa);
  var sd = Sprink.solve(sa, dsn.open);
  ok("Спринклеры: один ороситель даёт больше нормы, чем в расчётной площади", s1.sp[ordS[0].id].q > sd.sp[ordS[0].id].q, U.fmt(s1.sp[ordS[0].id].q, 2) + " > " + U.fmt(sd.sp[ordS[0].id].q, 2) + " л/с");
  ok("Спринклеры: баланс насоса и сети", near(Sprink.srcH(sa, sd.Q), Sprink.needH(sa, sd.Q, sd.B), 1e-6));

  // --- Вывод
  var host = document.getElementById("out"), passed = 0;
  results.forEach(function (r) {
    if (r.ok) passed++;
    var li = document.createElement("li");
    li.className = r.ok ? "pass" : "fail";
    li.textContent = (r.ok ? "✓ " : "✗ ") + r.name + (r.info ? " — " + r.info : "");
    host.appendChild(li);
  });
  document.getElementById("sum").textContent = "Прошло " + passed + " из " + results.length;
  document.getElementById("sum").className = passed === results.length ? "pass" : "fail";
})();
