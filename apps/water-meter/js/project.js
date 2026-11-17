/* Настройки, файл проекта и автосохранение.

   Формат .wms — тот же, что у настольной версии: UTF-8, табуляция, числа с
   точкой. Файл намеренно совместим в обе стороны — подбор, начатый в окне,
   открывается в браузере и наоборот.                                        */
var Project = (function () {
  "use strict";

  var STORE = "watermeter.project.v1";
  var MAGIC = "WMS";
  var VERSION = 1;

  var KIND_OUT = { vane: "Vane", turbine: "Turbine" };
  var KIND_IN = { Vane: "vane", Turbine: "turbine" };
  var MEDIUM_OUT = { cold: "Cold", hot: "Hot", circ: "Circulation", heat: "Heat" };
  var MEDIUM_IN = { Cold: "cold", Hot: "hot", Circulation: "circ", Heat: "heat" };
  var METHOD_OUT = { passport: "Passport", sp: "Sp" };
  var METHOD_IN = { Passport: "passport", Sp: "sp" };

  function defaults() {
    return {
      calc: Calc.defaults(),
      tableTitle: "Таблица подбора счетчиков.",
      tableFooter: "Все счетчики предусмотрены с импульсным выходом.",
      reportTitle: "Расчёт потерь напора в счётчиках воды",
      docFont: "Times New Roman",
      docFontSize: 10,
      mergePlaces: true,
      defaultMethod: "sp",
      pulse: true
    };
  }

  /* Табуляция и переводы строк в тексте сломали бы формат — меняем на пробел. */
  function clean(text) {
    return String(text === null || text === undefined ? "" : text).replace(/[\t\r\n]/g, " ");
  }

  function serialize(settings, rows) {
    var out = [MAGIC + "\t" + VERSION];

    function set(key, value) { out.push("SET\t" + key + "\t" + clean(value)); }
    set("LimitVane", U.store(settings.calc.limitVane));
    set("LimitTurbine", U.store(settings.calc.limitTurbine));
    set("Class", Tables.CLASSES[settings.calc.cls]);
    set("Title", settings.tableTitle);
    set("Footer", settings.tableFooter);
    set("ReportTitle", settings.reportTitle);
    set("Font", settings.docFont);
    set("FontSize", U.store(settings.docFontSize));
    set("Merge", settings.mergePlaces ? "1" : "0");
    set("Method", METHOD_OUT[settings.defaultMethod]);
    set("Pulse", settings.pulse ? "1" : "0");

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push([
        "ROW",
        clean(r.place), clean(r.systemName), U.store(r.qLs),
        clean(r.mark), clean(r.variant), String(r.dn),
        KIND_OUT[r.kind], MEDIUM_OUT[r.medium], r.pulse ? "1" : "0",
        U.store(r.k), r.hasSp ? "1" : "0", U.store(r.s),
        U.store(r.hPassport), U.store(r.hSp),
        METHOD_OUT[r.method], U.store(r.limit),
        U.store(r.qmin), U.store(r.qmax),
        clean(r.note)
      ].join("\t"));
    }

    return out.join("\n") + "\n";
  }

  function parse(text) {
    var lines = String(text).replace(/\r/g, "").split("\n");
    if (!lines.length || lines[0].indexOf(MAGIC) !== 0)
      throw new Error("Это не файл проекта подбора счётчиков.");

    var settings = defaults(), rows = [];

    for (var i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      var f = lines[i].split("\t");

      if (f[0] === "SET" && f.length >= 3) {
        applySetting(settings, f[1], f[2]);
      } else if (f[0] === "ROW" && f.length >= 20) {
        var kind = KIND_IN[f[7]] || "vane";
        rows.push({
          place: f[1], systemName: f[2], qLs: U.restore(f[3]),
          mark: f[4], variant: f[5], dn: parseInt(f[6], 10),
          kind: kind,
          kindName: kind === "vane" ? "крыльчатый" : "турбинный",
          kindGen: kind === "vane" ? "крыльчатого" : "турбинного",
          medium: MEDIUM_IN[f[8]] || "cold", pulse: f[9] === "1",
          k: U.restore(f[10]), hasSp: f[11] === "1", s: U.restore(f[12]),
          hPassport: U.restore(f[13]), hSp: U.restore(f[14]),
          method: METHOD_IN[f[15]] || "sp", limit: U.restore(f[16]),
          qmin: U.restore(f[17]), qmax: U.restore(f[18]),
          note: f[19]
        });
      }
    }

    return { settings: settings, rows: rows };
  }

  function applySetting(s, key, value) {
    switch (key) {
      case "LimitVane": s.calc.limitVane = U.restore(value); break;
      case "LimitTurbine": s.calc.limitTurbine = U.restore(value); break;
      case "Class": s.calc.cls = Math.max(0, Tables.CLASSES.indexOf(value)); break;
      case "Title": s.tableTitle = value; break;
      case "Footer": s.tableFooter = value; break;
      case "ReportTitle": s.reportTitle = value; break;
      case "Font": s.docFont = value; break;
      case "FontSize": s.docFontSize = U.restore(value); break;
      case "Merge": s.mergePlaces = value === "1"; break;
      case "Method": s.defaultMethod = METHOD_IN[value] || "sp"; break;
      case "Pulse": s.pulse = value === "1"; break;
    }
  }

  /* Автосохранение в браузере: программа открывается там, где её закрыли.
     Приватный режим и заблокированные куки ломают localStorage — молча
     обходимся без него, работать это не мешает. */
  function autoSave(settings, rows) {
    try { localStorage.setItem(STORE, serialize(settings, rows)); } catch (e) { }
  }

  function autoLoad() {
    try {
      var text = localStorage.getItem(STORE);
      if (!text) return null;
      return parse(text);
    } catch (e) { return null; }
  }

  function autoClear() {
    try { localStorage.removeItem(STORE); } catch (e) { }
  }

  return {
    defaults: defaults, serialize: serialize, parse: parse,
    autoSave: autoSave, autoLoad: autoLoad, autoClear: autoClear
  };
})();
