/* Настроечные таблицы ручных балансировочных клапанов VALTEC VT.054.

   Перенесено из расчёта циркуляции ГВС (`HotWaterCirculationWeb\js\valves.js`),
   чтобы числа на стенде совпадали с числами рабочей программы. Источник данных —
   паспорт и руководство по эксплуатации ПС−7151−1.2, таблица 3 «Настроечная
   таблица с гидравлическими характеристиками»; оттуда же методика подбора

       Kv = Q/√Δp   (Q в м³/ч, Δp в барах)

   и предельный перепад на клапане 500 кПа по условию шума (таблица 2). */
var Valtec = (function () {
  "use strict";

  /* Положения, для которых паспорт даёт Kv. Шкала клапана — 0…99. */
  var positions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99];

  /* Ниже этого положения золотник только выбирает упругость прокладки:
     пропускной способности у клапана нет (примечание 2 к таблице 3). */
  var deadBand = 3;

  /* Предельный перепад по условию шума, кПа. */
  var maxNoiseDrop = 500;

  function make(article, size, dn, lowFlow, kv) {
    return {
      article: article, size: size, dn: dn, lowFlow: lowFlow, kv: kv,
      maxKv: kv[kv.length - 1],
      caption: size + " (DN" + dn + ")" + (lowFlow ? ", Low Flow" : "")
    };
  }

  var models = [
    make("VT.054.NLF.04", "1/2\" Low Flow", 15, true, [
      0.00, 0.05, 0.15, 0.19, 0.27, 0.43, 0.62, 0.81, 1.00, 1.22, 1.43,
      1.63, 1.82, 1.99, 2.16, 2.35, 2.50, 2.68, 2.77, 2.82, 2.90
    ]),
    make("VT.054.N.04", "1/2\"", 15, false, [
      0.00, 1.06, 1.43, 1.44, 1.69, 1.98, 2.21, 2.37, 2.52, 2.66, 2.84,
      3.03, 3.20, 3.40, 3.84, 4.01, 4.19, 4.25, 4.44, 4.52, 4.58
    ]),
    make("VT.054.N.05", "3/4\"", 20, false, [
      0.00, 1.83, 2.02, 2.32, 2.60, 2.87, 2.99, 3.14, 3.25, 3.42, 3.50,
      3.75, 3.80, 4.19, 4.21, 4.34, 4.39, 4.47, 4.52, 4.59, 4.68
    ]),
    make("VT.054.N.06", "1\"", 25, false, [
      0.00, 2.06, 2.77, 3.22, 3.54, 4.13, 4.48, 5.00, 5.20, 5.62, 5.78,
      6.30, 6.56, 6.95, 7.19, 7.64, 7.70, 8.20, 8.35, 8.96, 9.19
    ]),
    make("VT.054.N.07", "1 1/4\"", 32, false, [
      0.00, 2.17, 4.75, 5.53, 6.08, 7.09, 7.70, 8.59, 8.92, 9.64, 9.92,
      10.80, 11.25, 11.92, 12.34, 13.10, 13.20, 14.06, 14.34, 15.37, 15.76
    ]),
    make("VT.054.N.08", "1 1/2\"", 40, false, [
      0.00, 2.62, 3.01, 4.14, 5.06, 6.22, 7.59, 8.73, 10.28, 12.31, 13.33,
      14.34, 15.62, 16.45, 17.18, 18.00, 18.76, 19.85, 20.28, 20.75, 21.12
    ]),
    make("VT.054.N.09", "2\"", 50, false, [
      0.00, 4.49, 5.16, 7.10, 8.68, 10.67, 13.02, 14.98, 17.63, 21.11, 22.78,
      24.60, 26.80, 28.21, 29.47, 30.87, 32.18, 34.05, 34.78, 35.55, 36.23
    ])
  ];

  function byArticle(article) {
    for (var i = 0; i < models.length; i++) if (models[i].article === article) return models[i];
    return models[2];
  }

  /* Kv на произвольном положении: между табличными значениями — линейно
     (примечание 1 к таблице 3). */
  function kvAt(model, position) {
    if (position <= deadBand) return 0;
    var last = positions.length - 1;
    if (position >= positions[last]) return model.kv[last];
    if (position < positions[1]) {
      return model.kv[1] * (position - deadBand) / (positions[1] - deadBand);
    }
    for (var i = 1; i < last; i++) {
      if (position <= positions[i + 1]) {
        var part = (position - positions[i]) / (positions[i + 1] - positions[i]);
        return model.kv[i] + (model.kv[i + 1] - model.kv[i]) * part;
      }
    }
    return model.kv[last];
  }

  /* Обратная задача: какое положение даёт нужный Kv. −1, если не даёт вовсе. */
  function positionFor(model, kv) {
    if (kv <= 0) return 0;
    var last = positions.length - 1;
    if (kv > model.kv[last]) return -1;
    if (kv <= model.kv[1]) return deadBand + (positions[1] - deadBand) * kv / model.kv[1];
    for (var i = 1; i < last; i++) {
      var lo = model.kv[i], hi = model.kv[i + 1];
      if (kv > lo && kv <= hi) {
        if (hi - lo < 1e-9) return positions[i + 1];
        return positions[i] + (positions[i + 1] - positions[i]) * (kv - lo) / (hi - lo);
      }
    }
    return positions[last];
  }

  /* Самый узкий обычный клапан, у которого настройка попадает в рабочую часть
     шкалы (от 10): чем ближе к полному открытию, тем мельче цена деления.
     Исполнение Low Flow берётся, только когда обычные не годятся. */
  function choose(requiredKv) {
    var i, m, p;
    for (i = 0; i < models.length; i++) {
      m = models[i];
      if (m.lowFlow) continue;
      p = positionFor(m, requiredKv);
      if (p >= 10) return m;
    }
    for (i = 0; i < models.length; i++) {
      m = models[i];
      if (!m.lowFlow) continue;
      p = positionFor(m, requiredKv);
      if (p >= 10) return m;
    }
    var best = models[0], bp = -1;
    for (i = 0; i < models.length; i++) {
      p = positionFor(models[i], requiredKv);
      if (p > bp) { bp = p; best = models[i]; }
    }
    return best;
  }

  return {
    Positions: positions, DeadBand: deadBand, MaxNoiseDrop: maxNoiseDrop,
    Models: models, byArticle: byArticle, kvAt: kvAt, positionFor: positionFor, choose: choose
  };
})();
