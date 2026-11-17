/* Строка таблицы подбора и группировка по месту установки.

   Строка хранит не только то, что попадёт в Word, но и всё, из чего получены
   потери: иначе вкладку с формулами пришлось бы пересчитывать по текущим
   справочникам, и она разъезжалась бы со старыми проектами.                 */
var Rows = (function () {
  "use strict";

  var SP_NOTE = "Потери приняты по СП 30.13330.2020 (СНиП 2.04.01-85*), прил. 4";

  function fromCandidate(c, mediumId, pulse, method) {
    return {
      place: "", systemName: "", note: "",
      qLs: c.qLs,
      mark: c.mark, variant: c.variant, dn: c.dn,
      kind: c.kind, kindName: c.kindName, kindGen: c.kindGen,
      medium: mediumId, pulse: pulse,
      k: c.k, hasSp: c.hasSp, s: c.s,
      hPassport: c.hPassport, hSp: c.hSp,
      method: method, limit: c.limit,
      qmin: c.qmin, qmax: c.qmax
    };
  }

  function qM3h(r) { return r.qLs * Calc.LS_TO_M3H; }
  function loss(r) { return r.method === "passport" ? r.hPassport : r.hSp; }
  function lossOk(r) { return loss(r) <= r.limit + 1e-9; }

  function flowOk(r) {
    var q = qM3h(r);
    if (q > r.qmax) return false;
    if (r.qmin !== null && isFinite(r.qmin) && q < r.qmin) return false;
    return true;
  }

  function markFull(r) { return r.variant ? r.mark + " (" + r.variant + ")" : r.mark; }

  /* Для каждой строки: размер группы, если строка первая в группе, и 0, если
     она продолжает группу сверху. Ровно это и есть будущий rowspan в Word. */
  function spans(rows, merge) {
    var out = new Array(rows.length), i;
    if (!merge) {
      for (i = 0; i < rows.length; i++) out[i] = 1;
      return out;
    }
    var start = 0;
    while (start < rows.length) {
      var place = rows[start].place;
      var end = start + 1;
      while (end < rows.length && rows[end].place === place) end++;
      out[start] = end - start;
      for (i = start + 1; i < end; i++) out[i] = 0;
      start = end;
    }
    return out;
  }

  function clone(r) {
    var c = {};
    for (var k in r) if (r.hasOwnProperty(k)) c[k] = r[k];
    return c;
  }

  return {
    SP_NOTE: SP_NOTE,
    fromCandidate: fromCandidate, qM3h: qM3h, loss: loss, lossOk: lossOk,
    flowOk: flowOk, markFull: markFull, spans: spans, clone: clone
  };
})();
