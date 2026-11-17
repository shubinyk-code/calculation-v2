/*
  Интерфейс: формы, сохранение, живые ползунки, отчёт.
  Все давления вводятся и выводятся в метрах водяного столба.
  Любая правка → полный пересчёт (миллисекунды) → перерисовка.
  Форма ввода при этом не перестраивается, иначе терялся бы фокус в поле.
*/
var UI = (function () {
  "use strict";

  var n = Fmt.num, g = Fmt.g, esc = Fmt.esc, isSet = Fmt.isSet;
  var STORE = "pressure-regulator-web/v1";
  var DAY_SECONDS = 36;
  // Суточный водоразбор, доля пика по часам. Им же моделируется просадка городской сети.
  var PROFILE = [0.2, 0.12, 0.1, 0.1, 0.12, 0.3, 0.65, 0.95, 1, 0.75, 0.6, 0.55, 0.6, 0.55, 0.5, 0.55, 0.65, 0.8, 0.95, 1, 0.9, 0.7, 0.5, 0.3];

  var project, res, sim, selectedId;
  var live = { hNet: null, phi: 0.6, fire: "off", regOn: true };
  var play = { on: false, t: 3, last: 0 };

  function $(id) { return document.getElementById(id); }
  function m1(v) { return n(v, 1) + " м"; }

  var INLET_FIELDS = [
    { key: "hGarMin", label: "Гарантированный напор в точке подключения", sym: "Н<sub>гар.min</sub>", unit: "м", hint: "По ТУ водоканала, в час максимального водоразбора (СП 30.13330.2020 п. 3.1.9)." },
    { key: "hMax", label: "Максимальный напор в сети", sym: "Н<sub>макс</sub>", unit: "м", hint: "Фактический, обычно ночью. Если в ТУ его нет — запросить у водоканала или замерить." },
    { key: "lossM", label: "Потери от точки подключения до всаса", sym: "Δh<sub>ввод</sub>", unit: "м", hint: "Ввод, водомерный узел, фильтр, арматура — при расчётном расходе. В пособии принято 5 м." },
    { key: "dz", label: "Превышение точки подключения над осью насосов", sym: "Δz", unit: "м", hint: "«+», если насосная ниже точки подключения. В пособии не учитывается." }
  ];

  var SETTINGS_FIELDS = [
    { key: "mPerBar", label: "Метров водяного столба в 1 бар", sym: "K", unit: "м/бар", hint: "Нужен только для PN и Kvs — они определены в барах. В пособии 10, точно при 1000 кг/м³ — 10,2." },
    { key: "fluctLimit", label: "Допустимое колебание для насосов без ПЧ", unit: "м", hint: "Рекомендация Wilo — 1 бар, то есть 10 м." },
    { key: "fNom", label: "Номинальная частота", unit: "Гц" },
    { key: "fMin", label: "Минимальная частота ПЧ по умолчанию", unit: "Гц", hint: "В пособии 20…25 Гц." },
    { key: "h0Factor", label: "Оценка напора при Q = 0, если он не задан", unit: "×H", hint: "Только для прикидки, пока нет каталога." },
    { key: "hStFactor", label: "Доля статического напора за насосом", unit: "", hint: "Только для графиков рабочей точки." },
    { key: "dhOpenMax", label: "Допустимые потери в открытом регуляторе", unit: "м", hint: "По ним считается требуемый Kvs." },
    { key: "vMax", label: "Предельная скорость в регуляторе", unit: "м/с" },
    { key: "cavRatio", label: "Предельное отношение напоров до/после", unit: ": 1", hint: "Практическое правило против кавитации." },
    { key: "kvsTable", label: "Ду : Kvs регуляторов", type: "text", wide: true, hint: "Типовые значения мембранных регуляторов, м³/ч. Замените данными выбранного производителя." },
    { key: "springRanges", label: "Диапазоны настройки, м", type: "text", wide: true, hint: "Через «;». Уставка должна попадать ближе к середине." }
  ];

  var SYSTEM_FIELDS = [
    { key: "name", label: "Название", type: "text" },
    { key: "kind", label: "Назначение", type: "select", options: [["ХПВ", "ХПВ — хозяйственно-питьевой"], ["ВПВ", "ВПВ — внутренний противопожарный"], ["АПТ", "АПТ — автоматическое пожаротушение"], ["ВПВ+АПТ", "ВПВ + АПТ совмещённые"], ["Прочее", "Прочее"]] },
    { key: "drive", label: "Насосы", type: "select", options: [["vfd", "С частотным преобразователем (ПЧ)"], ["const", "С постоянной частотой"]] },
    { key: "q", label: "Расход", sym: "Q", unit: "л/с" },
    { key: "h", label: "Напор насоса в рабочей точке", sym: "H", unit: "м", hint: "Подобран при гарантированном напоре." },
    { key: "hOut", label: "Напор на выходе (уставка станции)", sym: "Н<sub>вых</sub>", unit: "м", auto: true, show: "vfd", hint: "Пусто — Н<sub>вх.min</sub> + H." },
    { key: "h0", label: "Напор при Q = 0 на номинальной частоте", sym: "H<sup>max</sup><sub>Q=0</sub>", unit: "м", auto: true, hint: "Из каталога насоса. Нужен для проверки корпуса." },
    { key: "fMin", label: "Минимальная частота ПЧ", sym: "f<sub>min</sub>", unit: "Гц", auto: true, show: "vfd" },
    { key: "hMinQ0", label: "Напор при Q = 0 на минимальной частоте", sym: "H<sup>min</sup><sub>Q=0</sub>", unit: "м", auto: true, show: "vfd", hint: "Из каталога. Пусто — пересчёт по законам подобия." },
    { key: "pn", label: "Исполнение насоса/установки", type: "select", numeric: true, options: [["", "не выбрано"], ["10", "PN10 (≈ 100 м)"], ["16", "PN16 (≈ 160 м)"], ["25", "PN25 (≈ 250 м)"], ["30", "PN30 (≈ 300 м)"], ["40", "PN40 (≈ 400 м)"]] },
    { key: "hNetAllow", label: "Допустимый напор в сети после насосов", unit: "м", hint: "Трубы и арматура: PN10 ≈ 100 м. Для ВПВ — СП 10.13330.2020 п. 13.12." },
    { key: "lossM", label: "Потери на вводе для этой системы", sym: "Δh<sub>ввод</sub>", unit: "м", auto: true, hint: "Пусто — общее значение из данных ввода." },
    { key: "hSt", label: "Статический напор за насосом (Нг + Нсв)", sym: "Н<sub>ст</sub>", unit: "м", auto: true, hint: "Только для графика рабочей точки." },
    { key: "hasTank", label: "Есть водонапорный или гидропневматический бак", type: "check", show: "khpv" },
    { key: "simult", label: "Работает одновременно с другими (расход через общий регулятор)", type: "check", show: "common" }
  ];

  function fieldDef(scope, key) {
    var list = scope === "inlet" ? INLET_FIELDS : scope === "settings" ? SETTINGS_FIELDS : SYSTEM_FIELDS;
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }

  function fieldHtml(scope, f, value) {
    var attrs = ' data-scope="' + scope + '" data-key="' + f.key + '"';
    var show = f.show ? ' data-show="' + f.show + '"' : "";
    var label = '<span class="lbl">' + f.label + (f.sym ? ' <i class="sym">' + f.sym + "</i>" : "") + "</span>";
    if (f.type === "check") {
      return '<label class="field check"' + show + '><input type="checkbox"' + attrs + (value ? " checked" : "") + ">" + label + "</label>";
    }
    var control;
    if (f.type === "select") {
      var cur = value === null || value === undefined ? "" : String(value);
      control = "<select" + attrs + ">" + f.options.map(function (o) {
        return '<option value="' + o[0] + '"' + (cur === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select>";
    } else if (f.type === "text") {
      control = '<input type="text"' + attrs + ' value="' + esc(value) + '">';
    } else {
      control = '<input type="text" inputmode="decimal" autocomplete="off"' + attrs + (f.auto ? ' data-auto="1"' : "") +
        ' value="' + (isSet(value) ? String(value).replace(".", ",") : "") + '">';
    }
    return '<label class="field' + (f.wide ? " wide" : "") + '"' + show + ">" + label +
      '<span class="ctl">' + control + (f.unit ? '<span class="unit">' + f.unit + "</span>" : "") + "</span>" +
      (f.hint ? '<span class="hint">' + f.hint + "</span>" : "") + "</label>";
  }

  function currentSystem() {
    for (var i = 0; i < project.systems.length; i++) if (project.systems[i].id === selectedId) return project.systems[i];
    selectedId = project.systems[0].id;
    return project.systems[0];
  }

  // ----------------------------------------------------------------- формы

  function buildForms() {
    $("inletForm").innerHTML = INLET_FIELDS.map(function (f) { return fieldHtml("inlet", f, project.inlet[f.key]); }).join("");
    $("settingsForm").innerHTML = SETTINGS_FIELDS.map(function (f) { return fieldHtml("settings", f, project.settings[f.key]); }).join("") +
      '<div class="form-actions"><button type="button" data-act="resetSettings">Вернуть значения по умолчанию</button></div>';
    $("projTitle").value = project.title || "";
    Array.prototype.forEach.call(document.querySelectorAll('input[name="layout"]'), function (el) { el.checked = el.value === project.layout; });
    buildSystemForm();
  }

  function buildSystemForm() {
    var sys = currentSystem();
    $("sysForm").innerHTML = SYSTEM_FIELDS.map(function (f) { return fieldHtml("sys", f, sys[f.key]); }).join("") +
      '<div class="form-actions"><button type="button" data-act="dup">Дублировать</button>' +
      '<button type="button" data-act="del" class="danger"' + (project.systems.length < 2 ? " disabled" : "") + ">Удалить</button></div>";
    updateShow();
  }

  function updateShow() {
    var sys = currentSystem();
    Array.prototype.forEach.call(document.querySelectorAll("[data-show]"), function (el) {
      var rule = el.getAttribute("data-show"), ok = true;
      if (rule === "vfd") ok = sys.drive !== "const";
      else if (rule === "khpv") ok = sys.kind === "ХПВ";
      else if (rule === "common") ok = project.layout === "common";
      el.hidden = !ok;
    });
  }

  function updatePlaceholders() {
    var r = res.byId[selectedId], s = project.settings, auto;
    if (r && r.valid) {
      auto = {
        hOut: n(r.hOutAuto, 1),
        h0: n(r.sys.h * s.h0Factor, 1) + " (оценка)",
        fMin: g(s.fMin),
        hMinQ0: r.drive === "vfd" ? n(r.hMinQ0Auto, 1) : "",
        lossM: g(project.inlet.lossM),
        hSt: n(r.hStAuto, 1) + " (оценка)"
      };
    } else {
      auto = { hOut: "Н вх.min + H", h0: g(s.h0Factor) + "·H", fMin: g(s.fMin), hMinQ0: "по подобию", lossM: g(project.inlet.lossM), hSt: "оценка" };
    }
    Array.prototype.forEach.call(document.querySelectorAll("#sysForm input[data-auto]"), function (el) {
      var k = el.getAttribute("data-key");
      el.placeholder = "авто: " + (auto[k] !== undefined ? auto[k] : "");
    });
  }

  function onField(e) {
    var el = e.target;
    if (el.name === "layout") {
      if (el.checked && project.layout !== el.value) { project.layout = el.value; updateShow(); changed(); }
      return;
    }
    if (el.id === "projTitle") { project.title = el.value; save(); return; }
    var scope = el.getAttribute("data-scope"), key = el.getAttribute("data-key");
    if (!scope) return;
    var f = fieldDef(scope, key);
    if (!f) return;
    var target = scope === "inlet" ? project.inlet : scope === "settings" ? project.settings : currentSystem();
    var v;
    if (f.type === "check") v = el.checked;
    else if (f.type === "text") v = el.value;
    else if (f.type === "select") v = f.numeric ? (el.value === "" ? null : Number(el.value)) : el.value;
    else {
      v = Fmt.parse(el.value);
      var bad = typeof v === "number" && isNaN(v);
      el.classList.toggle("invalid", bad);
      if (bad) return;
      if (scope === "settings" && v === null) v = Calc.defaultSettings()[key];
    }
    if (target[key] === v) return;
    target[key] = v;
    if (scope === "sys" && (key === "drive" || key === "kind")) updateShow();
    changed();
  }

  // ----------------------------------------------------------------- системы

  function select(id) {
    if (!id || id === selectedId) return;
    var found = project.systems.some(function (s) { return s.id === id; });
    if (!found) return;
    selectedId = id;
    buildSystemForm();
    renderStatic();
    renderLive();
    save();
  }

  function addSystem() {
    var sys = Calc.newSystem("Система " + (project.systems.length + 1));
    project.systems.push(sys);
    selectedId = sys.id;
    buildSystemForm();
    changed();
    var first = document.querySelector('#sysForm input[data-key="q"]');
    if (first) first.focus();
  }

  function dupSystem() {
    var cur = currentSystem();
    var copy = JSON.parse(JSON.stringify(cur));
    copy.id = Calc.newSystem().id;
    copy.name = cur.name + " (копия)";
    project.systems.splice(project.systems.indexOf(cur) + 1, 0, copy);
    selectedId = copy.id;
    buildSystemForm();
    changed();
  }

  function delSystem() {
    if (project.systems.length < 2) return;
    var cur = currentSystem();
    if (!window.confirm("Удалить «" + cur.name + "»?")) return;
    var i = project.systems.indexOf(cur);
    project.systems.splice(i, 1);
    selectedId = project.systems[Math.max(0, i - 1)].id;
    buildSystemForm();
    changed();
  }

  // ----------------------------------------------------------------- вывод

  function renderTabs() {
    $("sysTabs").innerHTML = project.systems.map(function (s) {
      var r = res.byId[s.id];
      var cls = !r || !r.valid ? "na" : r.warnings.length ? "warn" : r.hasReg ? "need" : "ok";
      return '<button type="button" class="tab' + (s.id === selectedId ? " on" : "") + '" data-sel="' + s.id + '"><span class="dot ' + cls + '"></span>' + esc(s.name || "без названия") + "</button>";
    }).join("") + '<button type="button" class="tab add" data-act="add">+ система</button>';
  }

  function badgeFor(r) {
    if (r.hasReg && r.need) return '<span class="badge bad">нужен</span>';
    if (r.hasReg) return '<span class="badge mid">через общий</span>';
    return '<span class="badge good">не нужен</span>';
  }

  function pnText(pn, K) {
    return pn ? "PN" + pn + " (до " + g(pn * K) + " м)" : "больше PN40";
  }

  function renderSummary() {
    var s = project.settings;
    var head = "<thead><tr><th>Система</th><th>Насосы</th><th>Q, л/с</th><th>H, м</th><th>Н на всасе без РД, м</th><th>Критерий, м</th><th>Регулятор</th><th>Уставка, м</th><th>Н на всасе с РД, м</th><th>Корпус Н<sub>max</sub>, м</th><th></th></tr></thead>";
    var rows = res.list.map(function (r) {
      var sys = r.sys, on = sys.id === selectedId ? ' class="on"' : "";
      if (!r.valid) {
        return '<tr data-sel="' + sys.id + '"' + on + "><td><b>" + esc(sys.name) + '</b></td><td colspan="10" class="muted">' + esc(r.errors.join(" ")) + "</td></tr>";
      }
      var crit = r.drive === "const"
        ? "ΔН " + n(r.fluct, 1) + (r.need ? " &gt; " : " ≤ ") + g(s.fluctLimit)
        : "Н<sub>вх.max</sub> " + n(r.hInMax, 1) + (r.need ? " &gt; " : " ≤ ") + n(r.hRedMax, 1);
      var body = n(r.hBody, 1) + (r.pnReq ? " → PN" + r.pnReq : "") +
        (r.hasReg ? '<div class="sub">без РД ' + n(r.hBodyNoReg, 1) + (r.pnReqNoReg ? " → PN" + r.pnReqNoReg : "") + "</div>" : "");
      var flags = (r.warnings.length ? '<span class="flag bad" title="Замечания">!' + (r.warnings.length > 1 ? r.warnings.length : "") + "</span>" : "") +
        (r.estimates.length ? '<span class="flag est" title="Есть оценочные величины">≈</span>' : "");
      return '<tr data-sel="' + sys.id + '"' + on + "><td><b>" + esc(sys.name) + '</b><div class="sub">' + esc(sys.kind) + "</div></td>" +
        "<td>" + (r.drive === "vfd" ? "с ПЧ" : "без ПЧ") + "</td>" +
        '<td class="num">' + g(sys.q) + '</td><td class="num">' + g(sys.h) + "</td>" +
        '<td class="num">' + n(r.hInMin, 1) + " … " + n(r.hInMax, 1) + "</td>" +
        "<td>" + crit + "</td><td>" + badgeFor(r) + "</td>" +
        '<td class="num">' + (r.hasReg ? "<b>" + n(r.setpoint, 1) + "</b>" : "—") + "</td>" +
        '<td class="num">' + n(r.hInMinAfter, 1) + " … " + n(r.hInMaxAfter, 1) + "</td>" +
        '<td class="num">' + body + "</td><td>" + flags + "</td></tr>";
    }).join("");
    $("summary").innerHTML = '<table class="grid">' + head + "<tbody>" + rows + "</tbody></table>";

    var cc = $("commonCard");
    if (project.layout === "common" && res.common) {
      var c = res.common;
      cc.hidden = false;
      cc.innerHTML = c.need
        ? '<div class="verdict bad"><b>Общий регулятор на вводе нужен.</b> Уставка ' + m1(c.setpoint) + " — по самой требовательной системе «" + esc(c.governing.sys.name) + "». Расход через регулятор " + g(c.q) + " л/с.</div>" + regCardHtml(c.reg, null, true)
        : '<div class="verdict good"><b>Общий регулятор на вводе не нужен</b> — ни одной системе колебания напора не мешают.</div>';
    } else {
      cc.hidden = true;
      cc.innerHTML = "";
    }
  }

  function stepsHtml(steps) {
    return '<ol class="steps">' + steps.map(function (st) {
      return '<li class="' + (st.cls || "") + '"><div class="st-t">' + st.t + (st.src ? ' <span class="src">' + st.src + "</span>" : "") + "</div>" +
        (st.f ? '<div class="st-f">' + st.f + "</div>" : "") +
        (st.v ? '<div class="st-v">' + st.v + "</div>" : "") +
        (st.note ? '<div class="st-n">' + st.note + "</div>" : "") + "</li>";
    }).join("") + "</ol>";
  }

  function messagesHtml(r) {
    var h = "";
    if (r.warnings.length) h += '<div class="msg bad"><b>Замечания</b><ul>' + r.warnings.map(function (w) { return "<li>" + w + "</li>"; }).join("") + "</ul></div>";
    if (r.estimates.length) h += '<div class="msg est"><b>Оценочные величины</b><ul>' + r.estimates.map(function (w) { return "<li>" + w + "</li>"; }).join("") + "</ul></div>";
    if (r.notes.length) h += '<div class="msg info"><b>Что ещё важно</b><ul>' + r.notes.map(function (w) { return "<li>" + w + "</li>"; }).join("") + "</ul></div>";
    return h;
  }

  function verdictHtml(r) {
    if (r.hasReg) {
      var why = r.need ? "" : " Этой системе он сам по себе не нужен, но стоит на общем вводе.";
      return '<div class="verdict bad"><b>Регулятор давления «после себя» перед насосами ' + (r.need ? "нужен" : "есть (общий)") + ".</b> Уставка " + m1(r.setpoint) + ", напор на всасе " + n(r.hInMinAfter, 1) + " … " + m1(r.hInMaxAfter) + "." + why + "</div>";
    }
    return '<div class="verdict good"><b>Регулятор давления перед насосами не нужен.</b> ' +
      (r.drive === "vfd" ? "ПЧ компенсирует колебания: Н<sub>вх.max</sub> " + n(r.hInMax, 1) + " ≤ " + m1(r.hRedMax) + "." : "Колебание " + m1(r.fluct) + " не больше " + g(project.settings.fluctLimit) + " м.") +
      " Проверьте корпус: Н<sub>max</sub> = " + m1(r.hBody) + " → " + pnText(r.pnReq, r.K) + ".</div>";
  }

  function regCardHtml(reg, r, common) {
    if (!reg) return "";
    var s = project.settings, K = s.mPerBar;
    var fire = common ? res.list.some(function (x) { return x.valid && Calc.isFire(x.sys.kind); }) : Calc.isFire(r.sys.kind);
    var rows = [
      ["Место установки", common ? "Общий ввод: после водомерного узла, перед разводкой на установки" : "Подвод к установке «" + esc(r.sys.name) + "», перед всасывающим коллектором"],
      ["Уставка (напор после себя)", "<b>" + m1(reg.setpoint) + "</b>"],
      ["Напор до регулятора", n(reg.hInMin, 1) + " … " + m1(reg.hInMax) + ", наибольший перепад " + m1(reg.dhMax)],
      ["Расчётный расход", g(reg.q) + " л/с = " + n(reg.qm3, 1) + " м³/ч" + (common ? " (одновременно работающие)" : "")],
      ["Требуемая пропускная способность", "Kvs ≥ Q / √(Δh<sub>доп</sub> / K) = " + n(reg.qm3, 1) + " / √(" + g(s.dhOpenMax) + " / " + g(K) + ") = <b>" + n(reg.kvReq, 1) + " м³/ч</b>"],
      ["Типоразмер", reg.dn ? "<b>Ду" + reg.dn + "</b>, Kvs ≈ " + g(reg.kvs) + " м³/ч, скорость " + n(reg.v) + " м/с" : "—"],
      ["Потери в полностью открытом", "(Q / Kvs)²·K = " + m1(reg.dhOpen)],
      ["Диапазон настройки", reg.range ? g(reg.range.lo) + "–" + g(reg.range.hi) + " м, уставка на " + Math.round(reg.rangePos * 100) + " % диапазона" : "—"],
      ["Условное давление", reg.pn ? pnText(reg.pn, K) + " при Н<sub>вх.max</sub> = " + m1(reg.hInMax) : "больше PN40"],
      ["Отношение напоров до/после", n(reg.ratio, 1) + " : 1 (предел " + g(s.cavRatio) + " : 1)"]
    ];
    var h = '<div class="card reg"><h3>Подбор регулятора «после себя»</h3><table class="kv">' +
      rows.map(function (x) { return "<tr><th>" + x[0] + "</th><td>" + x[1] + "</td></tr>"; }).join("") + "</table>";
    if (reg.warnings.length) h += '<div class="msg bad"><ul>' + reg.warnings.map(function (w) { return "<li>" + w + "</li>"; }).join("") + "</ul></div>";
    h += "<h4>Требования к регулятору</h4><ul class=\"req\">" +
      "<li>Снижает давление и в динамическом, и в статическом режиме: при нулевом расходе держит уставку и не пропускает напор сети <span class=\"src\">пособие Wilo</span></li>" +
      "<li>Уставка ближе к середине диапазона настройки <span class=\"src\">пособие Wilo</span></li>" +
      "<li>Корпус, пилот и импульсная линия рассчитаны на Н<sub>вх.max</sub> = " + m1(reg.hInMax) + "</li>" +
      "<li>Перед регулятором — сетчатый фильтр; до и после — манометры и запорная арматура для обслуживания</li>" +
      (fire ? "<li>Для противопожарного водопровода — резервирование: второй ввод со своим регулятором или обводная линия; решение согласовать</li>" : "") +
      "</ul>";
    h += '<p class="est-note">≈ Kvs, Ду и диапазоны настройки — типовые значения, в пособии их нет. Сверьте с каталогом выбранного производителя (таблицы правятся в настройках). Kvs и PN по определению в барах, поэтому в их формулах стоит K.</p></div>';
    return h;
  }

  function noRegHtml(r) {
    return '<div class="card"><h3>Регулятор не требуется</h3><p>' +
      (r.drive === "vfd"
        ? "При максимальном напоре в сети и нулевом расходе частотному преобразователю хватает запаса: нужна частота " + n(r.fAtMax, 1) + " Гц при минимальной " + g(r.fMin) + " Гц."
        : "Колебание напора на входе " + m1(r.fluct) + " не превышает " + g(project.settings.fluctLimit) + " м — насос с постоянной частотой работает в допустимой зоне.") +
      "</p><p>Остаётся проверить корпус насоса/установки на Н<sub>max</sub> = " + m1(r.hBody) + " и прочность сети после насосов.</p></div>";
  }

  function renderDetails() {
    var r = res.byId[selectedId];
    var host = $("details");
    $("detailTitle").textContent = r ? r.sys.name : "";
    if (!r) { host.innerHTML = ""; return; }
    if (!r.valid) {
      host.innerHTML = '<div class="msg bad"><b>Не хватает данных</b><ul>' + r.errors.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul></div>";
      return;
    }
    host.innerHTML = verdictHtml(r) +
      '<div class="cols"><div class="col"><h3>Расчёт по шагам</h3>' + stepsHtml(r.steps) + "</div>" +
      '<div class="col">' + messagesHtml(r) +
      (r.hasReg ? (r.commonMode ? '<div class="card"><h3>Общий регулятор</h3><p>Подбор — в блоке «Итог» над таблицей.</p></div>' : regCardHtml(r.reg, r, false)) : noRegHtml(r)) +
      "</div></div>";
  }

  function renderStatic() {
    renderTabs();
    updatePlaceholders();
    renderSummary();
    renderDetails();
  }

  function renderLive() {
    sim = Calc.simulate(project, res, live);
    $("hNetVal").textContent = m1(live.hNet);
    $("phiVal").textContent = Math.round(live.phi * 100) + " %";
    Scheme.render($("scheme"), project, res, sim, live, selectedId);
    var r = res.byId[selectedId];
    Charts.qh($("qh"), $("qhLegend"), project, res, r, sim, live);
    Charts.ladder($("ladder"), $("ladderLegend"), project, res, r, sim);
    var name = r ? r.sys.name : "";
    $("qhTitle").textContent = name;
    $("ladderTitle").textContent = name;
    if (play.on) {
      var hh = Math.floor(play.t), mm = Math.floor((play.t - hh) * 60);
      $("clock").textContent = (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
    }
  }

  // ----------------------------------------------------------------- живой режим

  function clampLive() {
    var inl = project.inlet;
    var lo = isSet(inl.hGarMin) ? inl.hGarMin : 0;
    var hi = isSet(inl.hMax) ? inl.hMax : lo + 10;
    var min = Math.max(0, Math.floor(Math.min(lo, hi) * 0.8));
    var max = Math.ceil(Math.max(lo, hi) * 1.1 + 1);
    var el = $("hNet");
    el.min = min;
    el.max = max;
    if (live.hNet === null || live.hNet < min || live.hNet > max) live.hNet = hi;
    el.value = live.hNet;
    var pct = function (v) { return ((v - min) / (max - min) * 100).toFixed(2) + "%"; };
    $("hNetMarks").innerHTML =
      '<span style="left:' + pct(lo) + '">гар. ' + g(lo) + " м</span>" +
      '<span style="left:' + pct(hi) + '">макс ' + g(hi) + " м</span>";
  }

  function setFire(mode) {
    live.fire = mode;
    Array.prototype.forEach.call(document.querySelectorAll("#fireSeg button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-fire") === mode);
    });
    renderLive();
  }

  function profileAt(t) {
    var i = Math.floor(t) % 24, j = (i + 1) % 24, f = t - Math.floor(t);
    return PROFILE[i] * (1 - f) + PROFILE[j] * f;
  }

  function togglePlay() {
    play.on = !play.on;
    play.last = 0;
    $("btnPlay").textContent = play.on ? "❚❚ Пауза" : "▶ Сутки";
    $("btnPlay").classList.toggle("on", play.on);
    if (!play.on) $("clock").textContent = "";
  }

  function tick(ts) {
    var dt = play.last ? Math.min((ts - play.last) / 1000, 0.1) : 0;
    play.last = ts;
    if (play.on) {
      play.t = (play.t + dt * 24 / DAY_SECONDS) % 24;
      var prof = profileAt(play.t), inl = project.inlet;
      if (isSet(inl.hGarMin) && isSet(inl.hMax)) {
        // Сеть проседает, когда город разбирает воду: ночью Н макс, в пик — Н гар.min.
        live.hNet = inl.hMax - (inl.hMax - inl.hGarMin) * (prof - 0.1) / 0.9;
      }
      live.phi = prof;
      $("hNet").value = live.hNet;
      $("phi").value = Math.round(live.phi * 100);
      renderLive();
    }
    Scheme.animate(ts);
    requestAnimationFrame(tick);
  }

  // ----------------------------------------------------------------- файлы

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ project: project, selectedId: selectedId })); } catch (e) { /* хранилище недоступно */ }
  }

  function loadStored() {
    try {
      var raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setProject(p, sel) {
    project = Calc.normalize(p);
    selectedId = sel && project.systems.some(function (s) { return s.id === sel; }) ? sel : project.systems[0].id;
    live.hNet = null;
    buildForms();
    changed();
  }

  function changed() {
    res = Calc.compute(project);
    clampLive();
    renderStatic();
    renderLive();
    save();
  }

  function saveFile() {
    var name = (project.title || "регулятор-давления").replace(/[\\/:*?"<>|]+/g, "_") + ".json";
    var blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function openFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        setProject(data.project || data);
      } catch (e) {
        window.alert("Файл не прочитан: это не проект программы (" + e.message + ").");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function printReport() {
    var inl = project.inlet, K = project.settings.mPerBar;
    var h = "<h1>" + esc(project.title || "Регулятор давления перед насосными установками") + "</h1>";
    h += '<p class="rep-in">Все давления — в метрах водяного столба. Н<sub>гар.min</sub> = ' + g(inl.hGarMin) + " м; Н<sub>макс</sub> = " + g(inl.hMax) + " м; потери на вводе " + g(inl.lossM) + " м; Δz = " + g(inl.dz) + " м; для PN и Kvs 1 бар = " + g(K) + " м. " +
      (project.layout === "common" ? "Общий регулятор на вводе." : "Регуляторы на подводах к установкам.") + "</p>";
    h += '<div class="rep-scheme">' + $("scheme").innerHTML + "</div>";
    h += "<h2>Итог</h2>" + $("summary").innerHTML + ($("commonCard").hidden ? "" : $("commonCard").innerHTML);
    res.list.forEach(function (r) {
      h += '<section class="rep-sys"><h2>' + esc(r.sys.name) + "</h2>";
      if (!r.valid) h += "<p>" + esc(r.errors.join(" ")) + "</p>";
      else h += verdictHtml(r) + stepsHtml(r.steps) + messagesHtml(r) + (r.hasReg && !r.commonMode ? regCardHtml(r.reg, r, false) : "");
      h += "</section>";
    });
    h += '<p class="rep-foot">Методика: ООО «ВИЛО РУС», «Влияние колебаний давления в наружной сети водопровода на выбор и работу насосов системы водоснабжения зданий», 2024; формулы переписаны в напорах. Kvs, Ду, диапазоны настройки и рабочие точки — инженерная оценка.</p>';
    $("report").innerHTML = h;
    window.print();
  }

  // ----------------------------------------------------------------- запуск

  function bind() {
    var aside = $("inputs");
    aside.addEventListener("input", onField);
    aside.addEventListener("change", onField);
    aside.addEventListener("click", function (e) {
      var t = e.target.closest("[data-sel],[data-act]");
      if (!t) return;
      var act = t.getAttribute("data-act");
      if (t.getAttribute("data-sel")) select(t.getAttribute("data-sel"));
      else if (act === "add") addSystem();
      else if (act === "dup") dupSystem();
      else if (act === "del") delSystem();
      else if (act === "resetSettings") {
        project.settings = Calc.defaultSettings();
        buildForms();
        changed();
      }
    });
    $("outputs").addEventListener("click", function (e) {
      var t = e.target.closest("[data-sel]");
      if (t) select(t.getAttribute("data-sel"));
    });

    $("btnExample").addEventListener("click", function () {
      if (window.confirm("Заменить текущий проект примером из пособия?")) setProject(Calc.exampleProject());
    });
    $("btnNew").addEventListener("click", function () {
      if (window.confirm("Начать новый проект? Несохранённые данные пропадут.")) setProject(Calc.blankProject());
    });
    $("btnOpen").addEventListener("click", function () { $("fileInput").click(); });
    $("fileInput").addEventListener("change", function () { openFile(this.files[0]); this.value = ""; });
    $("btnSave").addEventListener("click", saveFile);
    $("btnPrint").addEventListener("click", printReport);

    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
    });

    $("hNet").addEventListener("input", function () { live.hNet = +this.value; if (play.on) togglePlay(); renderLive(); });
    $("phi").addEventListener("input", function () { live.phi = +this.value / 100; if (play.on) togglePlay(); renderLive(); });
    $("regOn").addEventListener("change", function () { live.regOn = this.checked; renderLive(); });
    $("btnPlay").addEventListener("click", togglePlay);
    Array.prototype.forEach.call(document.querySelectorAll("#fireSeg button"), function (b) {
      b.addEventListener("click", function () { setFire(b.getAttribute("data-fire")); });
    });
  }

  function init() {
    bind();
    var stored = loadStored();
    setProject(stored && stored.project ? stored.project : Calc.exampleProject(), stored && stored.selectedId);
    $("phi").value = Math.round(live.phi * 100);
    setFire(live.fire);
    requestAnimationFrame(tick);
  }

  return { init: init };
})();

document.addEventListener("DOMContentLoaded", UI.init);
