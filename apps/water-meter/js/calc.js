/* Расчёт потерь и подбор калибра.

   Обе величины считаются одновременно: по паспорту завода и по СП. Какую
   записать в таблицу — решает пользователь переключателем, поэтому в каждом
   варианте лежат обе.                                                       */
var Calc = (function () {
  "use strict";

  var LS_TO_M3H = 3.6;

  /* Паспорт: dP [кгс/см²] = K · Q² · 1e-4, Q в м³/ч. 1 кгс/см² = 10 м вод. ст. */
  function passportPressure(k, qM3h) { return k * qM3h * qM3h * 1e-4; }
  function passportHead(k, qM3h) { return passportPressure(k, qM3h) * 10; }

  /* СП: h [м] = S · q², q в л/с. */
  function spHead(s, qLs) { return s * qLs * qLs; }

  function defaults() {
    return { limitVane: 5, limitTurbine: 2.5, cls: 1 };   // cls: 0=A, 1=B, 2=C
  }

  function limit(opt, kind) {
    return kind === "vane" ? opt.limitVane : opt.limitTurbine;
  }

  function applySp(c, qLs) {
    var s = Tables.spFor(c.dn);
    if (!s) { c.hasSp = false; c.s = NaN; c.hSp = NaN; return; }
    c.hasSp = true;
    c.s = s.s;
    c.hSp = spHead(s.s, qLs);
  }

  /* Расход должен укладываться в паспортный диапазон счётчика. */
  function flowOk(c) {
    if (c.qM3h > c.qmax) return false;
    if (c.qmin !== null && isFinite(c.qmin) && c.qM3h < c.qmin) return false;
    return true;
  }

  function flowStatus(c) {
    if (c.qM3h > c.qmax) return "расход выше Qmax";
    if (c.qmin !== null && isFinite(c.qmin) && c.qM3h < c.qmin) return "расход ниже Qmin";
    if (c.qM3h > c.qn) return "выше Qn, в пределах Qmax";
    return "ок";
  }

  function hasLoss(c, method) { return method === "passport" || c.hasSp; }
  function loss(c, method) { return method === "passport" ? c.hPassport : c.hSp; }
  function lossOk(c, method) { return hasLoss(c, method) && loss(c, method) <= c.limit + 1e-9; }
  function suitable(c, method) { return c.flowOk && lossOk(c, method); }

  /* Все калибры под введённый расход: сперва крыльчатые, затем турбинные —
     в этом же порядке потом ищется рекомендация. */
  function build(qLs, mediumId, pulse, opt) {
    var m = Tables.medium(mediumId);
    var qM3h = qLs * LS_TO_M3H;
    var prefix = m.prefix + (pulse && m.pulse ? "д" : "");
    var list = [], i, c;

    for (i = 0; i < Tables.VANE.length; i++) {
      var v = Tables.VANE[i];
      c = {
        mark: prefix + "-" + v.dn,
        variant: v.dn === 15 ? "Qn=" + U.coef(v.qn) : "",
        dn: v.dn, kind: "vane", kindName: "крыльчатый", kindGen: "крыльчатого",
        qLs: qLs, qM3h: qM3h, k: v.k,
        hPassport: passportHead(v.k, qM3h),
        limit: limit(opt, "vane"),
        qmin: (m.hot ? v.qminHot : v.qminCold)[opt.cls],
        qt: (m.hot ? v.qtHot : v.qtCold)[opt.cls],
        qn: v.qn, qmax: v.qmax
      };
      applySp(c, qLs);
      list.push(c);
    }

    for (i = 0; i < Tables.TURBINE.length; i++) {
      var t = Tables.TURBINE[i];
      c = {
        mark: prefix + "-" + t.dn,
        variant: "",
        dn: t.dn, kind: "turbine", kindName: "турбинный", kindGen: "турбинного",
        qLs: qLs, qM3h: qM3h, k: t.k,
        hPassport: passportHead(t.k, qM3h),
        limit: limit(opt, "turbine"),
        qmin: m.hot ? t.qminHot : t.qminCold,
        qt: m.hot ? t.qtHot : t.qtCold,
        qn: m.hot ? t.qnHot : t.qnCold,
        qmax: m.hot ? t.qmaxHot : t.qmaxCold
      };
      applySp(c, qLs);
      list.push(c);
    }

    for (i = 0; i < list.length; i++) {
      list[i].markFull = list[i].variant ? list[i].mark + " (" + list[i].variant + ")" : list[i].mark;
      list[i].flowOk = flowOk(list[i]);
      list[i].flowStatus = flowStatus(list[i]);
    }
    return list;
  }

  /* Рекомендация — наименьший калибр, проходящий и по потерям, и по диапазону.
     Если не проходит ни один, показываем тот, где потери наименьшие: решать,
     чем жертвовать, всё равно пользователю. */
  function recommend(list, method, kindFilter) {
    var i, c;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (kindFilter && c.kind !== kindFilter) continue;
      if (suitable(c, method)) return i;
    }
    var best = -1, bestLoss = Infinity;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (kindFilter && c.kind !== kindFilter) continue;
      if (!c.flowOk) continue;
      if (!hasLoss(c, method)) continue;
      if (loss(c, method) < bestLoss) { bestLoss = loss(c, method); best = i; }
    }
    return best;
  }

  function status(c, method) {
    if (!c.flowOk) return c.flowStatus;
    if (!hasLoss(c, method)) return "нет строки в таблице СП";
    if (!lossOk(c, method)) return "потери выше предела";
    if (c.flowStatus !== "ок") return c.flowStatus;
    return "подходит";
  }

  return {
    LS_TO_M3H: LS_TO_M3H,
    passportPressure: passportPressure, passportHead: passportHead, spHead: spHead,
    defaults: defaults, limit: limit, build: build, recommend: recommend,
    hasLoss: hasLoss, loss: loss, lossOk: lossOk, suitable: suitable, status: status
  };
})();
