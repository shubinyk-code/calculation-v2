/* Нормативные справочники.

   В настольной версии они лежат отдельными текстовыми файлами в data\, но в
   браузере по протоколу file:// подтянуть их через fetch нельзя — CORS режет.
   Поэтому таблицы живут прямо здесь: это единственный файл, который нужно
   править при изменении паспортов или норматива.

   Потери по паспорту:  dP [кгс/см²] = K · Q² · 1e-4,  Q — расход, м³/ч.
   Потери по СП:        h  [м]       = S · q²,         q — расход, л/с.        */
var Tables = (function () {
  "use strict";

  /* Крыльчатые ВСХН / ВСГН / ВСТН. Прочерк в паспорте (исполнения такого класса
     нет) хранится как null. Qmin и Qt — по классам [A, B, C]. */
  var VANE = [
    { code: "15-0.6", dn: 15, qn: 0.6, qmax: 1.2, k: 6944,
      qminCold: [null, 0.0100, 0.0060], qtCold: [null, 0.0160, 0.0090],
      qminHot: [null, 0.0125, 0.0060], qtHot: [null, 0.0200, 0.0090] },
    { code: "15-1.0", dn: 15, qn: 1.0, qmax: 2.0, k: 2500,
      qminCold: [null, 0.0160, 0.0100], qtCold: [null, 0.0260, 0.0150],
      qminHot: [null, 0.0200, 0.0100], qtHot: [null, 0.0320, 0.0150] },
    { code: "15-1.5", dn: 15, qn: 1.5, qmax: 3.0, k: 1111,
      qminCold: [null, 0.0250, 0.0150], qtCold: [null, 0.0400, 0.0225],
      qminHot: [null, 0.0310, 0.0150], qtHot: [null, 0.0500, 0.0225] },
    { code: "20", dn: 20, qn: 2.5, qmax: 5.0, k: 400,
      qminCold: [null, 0.0400, 0.0150], qtCold: [null, 0.0640, 0.0375],
      qminHot: [null, 0.0500, 0.0150], qtHot: [null, 0.0800, 0.0375] },
    { code: "25", dn: 25, qn: 3.5, qmax: 7.0, k: 204.08,
      qminCold: [0.1400, 0.0630, 0.0210], qtCold: [0.3500, 0.1000, 0.0525],
      qminHot: [0.1400, 0.0630, null], qtHot: [0.3500, 0.1000, null] },
    { code: "32", dn: 32, qn: 6.0, qmax: 12.0, k: 69.444,
      qminCold: [0.2400, 0.1000, 0.0360], qtCold: [0.6000, 0.1600, 0.0900],
      qminHot: [0.2400, 0.1000, null], qtHot: [0.6000, 0.1600, null] },
    { code: "40", dn: 40, qn: 10.0, qmax: 20.0, k: 25,
      qminCold: [0.3000, 0.1600, 0.0600], qtCold: [1.0000, 0.2600, 0.1500],
      qminHot: [0.3000, 0.1600, null], qtHot: [1.0000, 0.2600, null] }
  ];

  /* Турбинные ВСХН / ВСГН / ВСТН, класс B. */
  var TURBINE = [
    { dn: 40, k: 1.479, qminCold: 0.45, qtCold: 0.9, qnCold: 30, qmaxCold: 60, qminHot: 0.7, qtHot: 1.5, qnHot: 15, qmaxHot: 30 },
    { dn: 50, k: 0.692, qminCold: 0.45, qtCold: 0.9, qnCold: 50, qmaxCold: 90, qminHot: 0.7, qtHot: 1.6, qnHot: 15, qmaxHot: 30 },
    { dn: 65, k: 0.625, qminCold: 0.45, qtCold: 1.0, qnCold: 60, qmaxCold: 120, qminHot: 1.0, qtHot: 2.0, qnHot: 25, qmaxHot: 60 },
    { dn: 80, k: 0.1, qminCold: 0.5, qtCold: 0.8, qnCold: 120, qmaxCold: 200, qminHot: 1.6, qtHot: 3.2, qnHot: 45, qmaxHot: 90 },
    { dn: 100, k: 0.061, qminCold: 0.6, qtCold: 1.8, qnCold: 230, qmaxCold: 300, qminHot: 2.4, qtHot: 4.8, qnHot: 70, qmaxHot: 140 },
    { dn: 125, k: 0.0346, qminCold: 1.5, qtCold: 2.0, qnCold: 250, qmaxCold: 350, qminHot: 4.0, qtHot: 8.0, qnHot: 100, qmaxHot: 200 },
    { dn: 150, k: 0.0104, qminCold: 1.8, qtCold: 4.0, qnCold: 400, qmaxCold: 600, qminHot: 6.0, qtHot: 12.0, qnHot: 150, qmaxHot: 300 },
    { dn: 200, k: 0.0033, qminCold: 4.0, qtCold: 6.0, qnCold: 750, qmaxCold: 1000, qminHot: 10.0, qtHot: 20.0, qnHot: 250, qmaxHot: 500 },
    { dn: 250, k: 0.00156, qminCold: 10.0, qtCold: 16.0, qnCold: 1100, qmaxCold: 1600, qminHot: 20.0, qtHot: 40.0, qnHot: 500, qmaxHot: 1000 }
  ];

  /* Гидравлическое сопротивление S по СНиП 2.04.01-85*, прил. 4 (СП 30.13330).

     DN 200: в СНиП стоит 3,5·10⁻⁵. В ходовой Excel-табличке там часто
     продублировано значение DN 65 (0,0081) — это опечатка, берём 0,000035.
     Строки DN 125 в таблице нет вовсе, поэтому для него доступен только
     паспортный расчёт. */
  var SP = [
    { dn: 15, s: 14.5, qmin: 0.03, qoper: 1.2, qmax: 3 },
    { dn: 20, s: 5.18, qmin: 0.05, qoper: 2, qmax: 5 },
    { dn: 25, s: 2.64, qmin: 0.07, qoper: 2.8, qmax: 7 },
    { dn: 32, s: 1.3, qmin: 0.1, qoper: 4, qmax: 10 },
    { dn: 40, s: 0.5, qmin: 0.16, qoper: 6.4, qmax: 16 },
    { dn: 50, s: 0.143, qmin: 0.3, qoper: 12, qmax: 30 },
    { dn: 65, s: 0.0081, qmin: 1.5, qoper: 17, qmax: 70 },
    { dn: 80, s: 0.00264, qmin: 2, qoper: 36, qmax: 110 },
    { dn: 100, s: 0.000766, qmin: 3, qoper: 65, qmax: 180 },
    { dn: 150, s: 0.00013, qmin: 4, qoper: 140, qmax: 350 },
    { dn: 200, s: 0.000035, qmin: 6, qoper: 210, qmax: 600 },
    { dn: 250, s: 0.000018, qmin: 15, qoper: 380, qmax: 1000 }
  ];

  var SYSTEMS = [
    "Общий на вводе",
    "Холодное водоснабжение",
    "Горячее водоснабжение",
    "ХВС на встроенные помещения",
    "ХВС на приготовление ГВС 1 зоны (ИТП)",
    "ХВС на приготовление ГВС 2 зоны + встроенные помещения (ИТП)",
    "Циркуляция на 1 зону (ИТП)",
    "Циркуляция на 2 зону (ИТП)",
    "Циркуляция на встроенные помещения (ИТП)"
  ];

  var MEDIA = [
    { id: "cold", title: "ХВС — холодная вода (ВСХН)", hot: false, prefix: "ВСХН", pulse: true },
    { id: "hot", title: "ГВС — горячая вода (ВСГН)", hot: true, prefix: "ВСГН", pulse: true },
    { id: "circ", title: "Циркуляция ГВС (ВСГН)", hot: true, prefix: "ВСГН", pulse: true },
    { id: "heat", title: "Теплоноситель до 150 °C (ВСТН)", hot: true, prefix: "ВСТН", pulse: false }
  ];

  function medium(id) {
    for (var i = 0; i < MEDIA.length; i++) if (MEDIA[i].id === id) return MEDIA[i];
    return MEDIA[0];
  }

  function spFor(dn) {
    for (var i = 0; i < SP.length; i++) if (SP[i].dn === dn) return SP[i];
    return null;
  }

  /* Марка счётчика: среда даёт приставку, галочка — суффикс «д»
     (импульсный выход). ВСТН выпускается с импульсным выходом изначально. */
  function mark(mediumId, pulse, dn) {
    var m = medium(mediumId);
    return m.prefix + (pulse && m.pulse ? "д" : "") + "-" + dn;
  }

  var CLASSES = ["A", "B", "C"];

  return {
    VANE: VANE, TURBINE: TURBINE, SP: SP, SYSTEMS: SYSTEMS, MEDIA: MEDIA, CLASSES: CLASSES,
    medium: medium, spFor: spFor, mark: mark
  };
})();
