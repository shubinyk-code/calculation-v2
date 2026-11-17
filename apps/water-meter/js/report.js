/* Построчная расшифровка: откуда взялись потери в каждом счётчике.
   Возвращаем плоский список строк — вкладка склеивает их переводами строк,
   а выгрузка в Word делает из каждой строки абзац. */
var Report = (function () {
  "use strict";

  /* Расход в м³/ч показываем до трёх знаков: два дают заметную расфазировку
     с числом, которое реально возводится в квадрат. */
  function q3(x) { return U.coef(Math.round(x * 1000) / 1000); }

  function build(rows, settings) {
    var lines = [];

    lines.push("Формулы");
    lines.push("");
    lines.push("По паспорту счётчика:  ΔP = K · Q² · 10⁻⁴,  где ΔP — потеря давления, кгс/см²;");
    lines.push("K — коэффициент гидравлического сопротивления по таблице 2 паспорта; Q — расход, м³/ч.");
    lines.push("Потеря напора h = ΔP · 10, м вод. ст. (1 кгс/см² = 10 м вод. ст.).");
    lines.push("");
    lines.push("По СП 30.13330 (СНиП 2.04.01-85*, прил. 4):  h = S · q²,  где h — потеря напора, м;");
    lines.push("S — гидравлическое сопротивление счётчика, м/(л/с)²; q — расход, л/с.");
    lines.push("");
    lines.push("Пересчёт расхода: Q [м³/ч] = q [л/с] · 3,6.");
    lines.push("");
    lines.push("Предельные потери напора: крыльчатые счётчики — " + U.coef(settings.calc.limitVane) +
               " м, турбинные — " + U.coef(settings.calc.limitTurbine) + " м.");
    lines.push("");
    lines.push(new Array(97).join("-"));
    lines.push("");

    if (!rows.length) {
      lines.push("Таблица подбора пуста — расчёт появится, когда будет добавлена первая строка.");
      return lines;
    }

    for (var i = 0; i < rows.length; i++) {
      appendRow(lines, rows[i], i + 1);
      lines.push("");
    }
    return lines;
  }

  function appendRow(lines, r, number) {
    var head = number + ". ";
    if (r.place) head += r.place;
    if (r.systemName) head += (r.place ? " — " : "") + r.systemName;
    lines.push(head);

    lines.push("    Счётчик " + Rows.markFull(r) + " (" + r.kindName + "), DN " + r.dn + ".");
    lines.push("    Расход q = " + U.coef(r.qLs) + " л/с = " + q3(Rows.qM3h(r)) + " м³/ч.");

    var p = Calc.passportPressure(r.k, Rows.qM3h(r));
    lines.push("    По паспорту:  ΔP = K · Q² · 10⁻⁴ = " + U.coef(r.k) + " · " + q3(Rows.qM3h(r)) +
               "² · 10⁻⁴ = " + U.coef(Math.round(p * 1e6) / 1e6) + " кгс/см²;");
    lines.push("                  h = ΔP · 10 = " + U.fmt(r.hPassport, 2) + " м.");

    if (r.hasSp) {
      lines.push("    По СП 30.13330 (СНиП 2.04.01-85*, прил. 4):  h = S · q² = " + U.coef(r.s) +
                 " · " + U.coef(r.qLs) + "² = " + U.fmt(r.hSp, 2) + " м.");
    } else {
      lines.push("    По СП 30.13330: строки DN " + r.dn + " в таблице прил. 4 нет — метод неприменим.");
    }

    var methodName = r.method === "passport" ? "по паспорту" : "по СП";
    var verdict = Rows.lossOk(r) ? "условие выполняется" : "ПРЕВЫШЕНИЕ, условие не выполняется";
    lines.push("    Принято: h = " + U.fmt(Rows.loss(r), 2) + " м (" + methodName + "). Предел для " +
               r.kindGen + " счётчика — " + U.coef(r.limit) + " м, " + verdict + ".");

    var qmin = (r.qmin === null || !isFinite(r.qmin)) ? "не нормируется" : U.coef(r.qmin) + " м³/ч";
    lines.push("    Диапазон счётчика: Qmin = " + qmin + ", Qmax = " + U.coef(r.qmax) +
               " м³/ч; расчётный Q = " + q3(Rows.qM3h(r)) + " м³/ч — " +
               (Rows.flowOk(r) ? "в пределах." : "ВНЕ ДИАПАЗОНА."));

    if (r.note) lines.push("    Примечание: " + r.note);
  }

  return { build: build };
})();
