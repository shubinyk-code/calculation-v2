/* «Что сейчас происходит»: пояснения по текущему состоянию модели простыми словами.
   Каждое пояснение — { lvl: good|info|warn|bad, text }. HTML допустим: выводится в список. */
var Explain = (function () {
  "use strict";
  var f1 = function (x) { return U.fmt(x, 1); };
  var f0 = function (x) { return U.fmt(x, 0); };

  function now(sim, eq) {
    var cfg = sim.cfg, p = cfg.pump, c = cfg.ctrl, v = cfg.vfd, co = Pump.coef(p);
    var N = cfg.pumpCount, out = [], i;
    var mode = c.mode, auto = mode === "vfd1" || mode === "vfdAll";
    var running = [];
    for (i = 0; i < N; i++) if (sim.pumps[i].f > 1) running.push(i);

    // 1. Баланс воды: куда девается разница подачи и разбора
    var dq = sim.Qp - sim.Qs;
    if (!running.length && sim.Qs < 0.02 && sim.Qp < 0.02) {
      out.push({ lvl: "info", text: "Насосы стоят, разбора нет. Давление в коллекторе <b>" + f1(sim.Hn) + " м</b> держит " + (cfg.net.tankOn && sim.tankWater(sim.Hn) > 0.05 ? "мембранный бак (в нём " + f1(sim.tankWater(sim.Hn)) + " л воды)." : "закрытая сеть.") });
    } else if (Math.abs(dq) > 0.15 && cfg.net.tankOn) {
      out.push({
        lvl: "info",
        text: "Насосы подают <b>" + f1(sim.Qp) + " м³/ч</b>, потребители берут <b>" + f1(sim.Qs) + " м³/ч</b>. " +
          (dq > 0 ? "Излишек " + f1(dq) + " м³/ч уходит в мембранный бак — давление <b>растёт</b>, точка насоса ползёт по кривой вверх-влево."
                  : "Недостачу " + f1(-dq) + " м³/ч отдаёт мембранный бак — давление <b>падает</b>, точка насоса сползает по кривой вправо-вниз.")
      });
    } else if (running.length) {
      out.push({ lvl: "info", text: "Подача насосов равна разбору (" + f1(sim.Qs) + " м³/ч): рабочая точка — пересечение кривой насосов с характеристикой сети. Напор в коллекторе <b>" + f1(sim.Hn) + " м</b>." });
    }

    // 2. Куда стремится точка
    if (eq && running.length && Math.abs(eq.H - sim.Hn) > 0.7) {
      out.push({ lvl: "info", text: "Если обороты не менять, точка придёт в равновесие: <b>Q = " + f1(eq.Q) + " м³/ч, H = " + f1(eq.H) + " м</b> на выходе (крестик на графике). Сейчас давление ещё в пути: " + f1(sim.Hn) + " → " + f1(eq.H) + " м." });
    }

    // 3. Регулятор
    if (sim.dry) {
      out.push({ lvl: "bad", text: cfg.source.type === "tank" ? "Защита от сухого хода: уровень в баке " + U.fmt(sim.level, 2) + " м ниже минимального " + U.fmt(cfg.source.levelMin, 2) + " м. Насосы ждут, пока поплавковый клапан наберёт воду." : "Защита от сухого хода: подпор на вводе " + f1(sim.Hin) + " м ниже " + f0(c.dryH) + " м (пособие Wilo: отключение при падении давления на входе до 1 бар)." });
    } else if (auto) {
      var sp = sim.setpoint(), e = sp - sim.Hmeas, u = sim.u;
      if (sim.state === "sleep") {
        out.push({ lvl: "good", text: "<b>Спящий режим.</b> Насосы стоят, воду отдаёт мембранный бак. Пуск, когда давление упадёт ниже " + f1(c.Hset - c.wake) + " м (сейчас " + f1(sim.Hmeas) + " м)." });
      } else if (sim.state === "boost") {
        out.push({ lvl: "info", text: "Разбора почти нет: регулятор поднимает давление до " + f1(c.Hset + c.boost) + " м, запасает воду в бак и остановит насос." });
      } else if (u >= v.fMax - 0.3 && e > 0.5) {
        var more = "";
        for (i = 0; i < N; i++) if (!sim.pumps[i].on && !c.failed[i]) { more = " Через " + f1(Math.max(0, c.addDelay - sim.addT)) + " с включится насос " + (i + 1) + "."; break; }
        out.push({ lvl: "warn", text: "Частота упёрлась в <b>f макс = " + f0(v.fMax) + " Гц</b>, давление ниже уставки на " + f1(e) + " м: одному насосу не хватает сил." + (more || " Резерва нет — давление провалится.") });
      } else if (u <= v.fMin + 0.3 && e < -0.5) {
        var H0min = p.H0 * Math.pow(v.fMin / p.fNom, 2);
        var reach = sim.Hin + H0min;
        if (reach > c.Hset + 0.3) {
          out.push({ lvl: "bad", text: "Частота на <b>минимуме " + f0(v.fMin) + " Гц</b>, а давление выше уставки на " + f1(-e) + " м. Насос при f мин и Q = 0 даёт напор " + f1(H0min) + " м, плюс подпор " + f1(sim.Hin) + " м = <b>" + f1(reach) + " м > уставки " + f1(c.Hset) + " м</b>. ПЧ ниже не опустится: такие колебания подпора частотой не компенсировать — нужен редуктор перед насосами (пособие Wilo, с. 41)." });
        } else {
          out.push({ lvl: "info", text: "Частота на минимуме " + f0(v.fMin) + " Гц, давление выше уставки на " + f1(-e) + " м: разбор очень мал, это переходный процесс." });
        }
      } else if (Math.abs(e) > 0.5) {
        out.push({ lvl: "info", text: "Давление " + (e > 0 ? "ниже" : "выше") + " уставки на <b>" + f1(Math.abs(e)) + " м</b> → ПИ-регулятор " + (e > 0 ? "поднимает" : "снижает") + " частоту (сейчас задание " + f1(u) + " Гц)." });
      } else {
        out.push({ lvl: "good", text: "Давление держится на уставке " + f1(sp) + " м. Частота " + f1(u) + " Гц — ровно столько, сколько нужно под текущий разбор." });
      }
      if (sim.state === "run" && sim.Qp <= c.sleepQ && running.length === 1) {
        out.push({ lvl: "info", text: "Подача " + U.fmt(sim.Qp, 2) + " м³/ч — почти ноль: насос крутится на " + f1(sim.pumps[running[0]].f) + " Гц только чтобы держать давление, вода в нём греется. " +
          (c.sleep ? "Спящий режим остановит его через " + f1(Math.max(0, c.sleepDelay - sim.sleepT)) + " с." : "Спящий режим выключен — так насос и будет молотить воду.") });
      }
      if (sim.remT > 0.2) out.push({ lvl: "info", text: "Условие отключения пикового насоса выполняется уже " + f1(sim.remT) + " с из " + f0(c.remDelay) + " с." });
    } else if (mode === "relay") {
      var ord = sim.order(), s = [];
      for (var k = 0; k < ord.length; k++) s.push("насос " + (ord[k] + 1) + ": пуск < " + f1(c.relayOn - k * c.relayStep) + ", стоп > " + f1(c.relayOff - k * c.relayStep));
      out.push({ lvl: "info", text: "Реле давления, без ПЧ: насосы только «вкл/выкл» на полной частоте, давление ходит пилой между порогами (" + s.join("; ") + " м). Сейчас " + f1(sim.Hmeas) + " м." });
    } else if (mode === "manualVfd") {
      out.push({ lvl: "info", text: "Ручная частота " + f1(c.fManual) + " Гц: регулятор не вмешивается, насос просто сидит на своей кривой для этой частоты, а рабочая точка — где эта кривая пересекает сеть." });
    } else {
      out.push({ lvl: "info", text: "Прямой пуск: насос всегда на " + f0(p.fNom) + " Гц, изменить можно только задвижкой (дросселированием) или числом насосов." });
    }

    // 4. Каждый насос
    for (i = 0; i < N; i++) {
      var ps = sim.pumps[i], r = ps.f / p.fNom;
      if (c.failed[i]) { out.push({ lvl: "warn", text: "Насос " + (i + 1) + " в аварии — его работу берут остальные." }); continue; }
      if (ps.f <= 1) continue;
      var H0r = p.H0 * r * r;
      if (ps.Q < 0.02) {
        out.push({
          lvl: "bad",
          text: "Насос " + (i + 1) + " крутится на " + f1(ps.f) + " Гц, но <b>обратный клапан закрыт</b>: его напор при Q = 0 — " + f1(H0r) + " м (= " + f0(p.H0) + "·(" + f1(ps.f) + "/" + f0(p.fNom) + ")²), с подпором " + f1(sim.Hin) + " м это " + f1(H0r + sim.Hin) + " м, а в коллекторе " + f1(sim.Hn) + " м. " +
            "Вся мощность " + U.fmt(ps.P, 2) + " кВт уходит в нагрев воды: <b>" + f0(ps.T) + " °C</b>."
        });
        continue;
      }
      var Qb = p.Qopt * r;
      if (ps.Q < 0.25 * Qb) out.push({ lvl: "warn", text: "Насос " + (i + 1) + " на малой подаче: " + f1(ps.Q) + " м³/ч — " + f0(100 * ps.Q / Qb) + "% от оптимума на этой частоте. КПД " + f0(100 * ps.eta) + "%, вода в корпусе подогревается (" + f0(ps.T) + " °C)." });
      else if (ps.Q > 1.35 * Qb) out.push({ lvl: "warn", text: "Насос " + (i + 1) + " далеко справа по кривой: " + f1(ps.Q) + " м³/ч при оптимуме " + f1(Qb) + " м³/ч. Напор мал, КПД " + f0(100 * ps.eta) + "%, растёт NPSHтр (" + f1(ps.npshR) + " м)." });
      if (ps.cavStage === 1) out.push({ lvl: "warn", text: "Насос " + (i + 1) + ": запас по кавитации мал — NPSHа " + f1(ps.npshA) + " м, NPSHтр " + f1(ps.npshR) + " м (нужно NPSHа ≥ NPSH3 + 0,5 м). Начальная кавитация: шум, отдельные пузырьки." });
      if (ps.cavStage >= 2) out.push({ lvl: "bad", text: "Насос " + (i + 1) + ": <b>" + (ps.cavStage === 3 ? "срыв работы" : "развитая кавитация") + "</b>. NPSHа " + f1(ps.npshA) + " м < NPSHтр " + f1(ps.npshR) + " м — вода вскипает на входе в колесо, напор упал на " + f0(100 * (1 - ps.cav)) + "%." });
      if (ps.T > 45 && ps.Q >= 0.02) out.push({ lvl: "warn", text: "Насос " + (i + 1) + ": вода в корпусе " + f0(ps.T) + " °C." });
    }

    // 5. Потребители
    var taps = cfg.taps, low = [];
    for (i = 0; i < taps.length; i++) {
      if (!taps[i].on || taps[i].kv * taps[i].open < 0.2) continue;
      var free = sim.HD - taps[i].z;
      if (free < cfg.needFree) low.push(taps[i].name + " — " + f1(Math.max(0, free)) + " м");
    }
    if (low.length) out.push({ lvl: "warn", text: "Мало свободного напора у кранов (нужно ≥ " + f0(cfg.needFree) + " м): " + low.join(", ") + "." });

    if (sim.Hn > 100) out.push({ lvl: "bad", text: "Давление в коллекторе " + f1(sim.Hn) + " м — больше PN 10 (100 м). Так бывает при работе без ПЧ на закрытую задвижку с высоким подпором." });

    return out;
  }

  return { now: now };
})();
