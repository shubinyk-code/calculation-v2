/* Интерфейс: вкладки, форма подбора, обе таблицы, файлы и выгрузка. */
(function () {
  "use strict";
  var $ = U.$;

  var settings = Project.defaults();
  var rows = [];
  var candidates = [];
  var pick = -1;            // выбранный вариант в списке калибров
  var selRow = -1;          // выделенная строка таблицы подбора
  var editIndex = -1;       // -1 — добавляем новую строку, иначе правим эту

  /* ------------------------------------------------------------ вкладки */

  function initTabs() {
    var buttons = document.querySelectorAll(".tabs-nav button");
    function show(name) {
      for (var i = 0; i < buttons.length; i++)
        buttons[i].classList.toggle("on", buttons[i].getAttribute("data-tab") === name);
      var tabs = document.querySelectorAll(".tab");
      for (var j = 0; j < tabs.length; j++)
        tabs[j].classList.toggle("active", tabs[j].id === "tab-" + name);
      if (name === "report") renderReport();
      if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    }
    for (var i = 0; i < buttons.length; i++) {
      (function (b) {
        b.addEventListener("click", function () { show(b.getAttribute("data-tab")); });
      })(buttons[i]);
    }
    var start = (location.hash || "#pick").slice(1);
    if (!document.getElementById("tab-" + start)) start = "pick";
    show(start);
  }

  /* ------------------------------------------------------------ форма */

  function currentMethod() {
    var r = document.querySelector("input[name=method]:checked");
    return r ? r.value : "sp";
  }

  function kindFilter() { return $("fKind").value || null; }

  /* Примечание про СП подставляем сами, но не затираем написанное руками:
     если строку очистили или переписали — такой она и останется. */
  function syncNoteToMethod() {
    var note = $("fNote");
    if (currentMethod() === "sp") {
      if (!note.value.trim()) note.value = Rows.SP_NOTE;
    } else {
      if (note.value.trim() === Rows.SP_NOTE) note.value = "";
    }
  }

  function initForm() {
    var sel = $("fMedium");
    for (var i = 0; i < Tables.MEDIA.length; i++)
      sel.appendChild(U.el("option", { value: Tables.MEDIA[i].id, text: Tables.MEDIA[i].title }));

    var dl = $("dlSystems");
    for (var j = 0; j < Tables.SYSTEMS.length; j++)
      dl.appendChild(U.el("option", { value: Tables.SYSTEMS[j] }));

    $("fQ").addEventListener("input", recalc);
    $("fMedium").addEventListener("change", recalc);
    $("fKind").addEventListener("change", recalc);
    $("fPulse").addEventListener("change", function () { settings.pulse = $("fPulse").checked; recalc(); });

    $("fQ").addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      addOrUpdate();
    });

    var radios = document.querySelectorAll("input[name=method]");
    for (var m = 0; m < radios.length; m++) {
      radios[m].addEventListener("change", function () {
        settings.defaultMethod = currentMethod();
        syncNoteToMethod();
        recalc();
      });
    }

    $("fMerge").addEventListener("change", function () {
      settings.mergePlaces = $("fMerge").checked;
      renderRows();
      save();
    });
  }

  /* ------------------------------------------------------------ варианты */

  function recalc() {
    var body = $("tCand").tBodies[0];
    body.innerHTML = "";
    candidates = [];
    pick = -1;

    var q = U.num($("fQ").value);
    if (!(q > 0)) {
      $("candEmpty").hidden = false;
      $("candEmpty").textContent = "Введите расход, л/с — варианты появятся сразу.";
      $("btnAdd").disabled = true;
      setSummary("Введите расход, л/с.", "dim");
      return;
    }
    $("candEmpty").hidden = true;

    candidates = Calc.build(q, $("fMedium").value, $("fPulse").checked, settings.calc);
    var method = currentMethod();
    var recommended = Calc.recommend(candidates, method, kindFilter());

    for (var i = 0; i < candidates.length; i++) {
      body.appendChild(candidateRow(candidates[i], i, method));
    }

    pick = recommended;
    markPick();
    $("btnAdd").disabled = false;
    summarize(recommended, method, q);
  }

  function candidateRow(c, index, method) {
    var tr = U.el("tr");
    if (!c.flowOk) tr.className = "dim";

    var state = Calc.status(c, method);
    var stateClass = state === "подходит" ? "st-ok"
      : (state === "потери выше предела" || state === "расход выше Qmax" ? "st-bad" : "st-warn");

    var cells = [
      { t: c.markFull, c: "l" },
      { t: String(c.dn), c: "c" },
      { t: c.kindName, c: "l" },
      { t: U.coef(c.k) },
      { t: U.fmt(c.hPassport, 2), c: method === "passport" ? "act" : "" },
      { t: c.hasSp ? U.coef(c.s) : "—" },
      { t: c.hasSp ? U.fmt(c.hSp, 2) : "—", c: method === "sp" ? "act" : "" },
      { t: U.coef(c.limit) },
      { t: U.fmt(c.qM3h, 2) },
      { t: (c.qmin === null || !isFinite(c.qmin) ? "—" : U.coef(c.qmin)) + " … " + U.coef(c.qmax), c: "c" },
      { t: state, c: "l " + stateClass }
    ];

    // Красным — то число, которое сейчас идёт в таблицу и не проходит по пределу.
    if (Calc.hasLoss(c, method) && !Calc.lossOk(c, method)) {
      var lossCell = method === "passport" ? 4 : 6;
      cells[lossCell].c += " over";
    }

    for (var i = 0; i < cells.length; i++) {
      var td = U.el("td", { "class": cells[i].c || "" });
      td.textContent = cells[i].t;
      tr.appendChild(td);
    }

    tr.addEventListener("click", function () { pick = index; markPick(); });
    tr.addEventListener("dblclick", function () { pick = index; markPick(); addOrUpdate(); });
    return tr;
  }

  function markPick() {
    var trs = $("tCand").tBodies[0].rows;
    for (var i = 0; i < trs.length; i++) trs[i].classList.toggle("pick", i === pick);
    if (pick >= 0 && trs[pick] && trs[pick].scrollIntoView) {
      trs[pick].scrollIntoView({ block: "nearest" });
    }
  }

  function setSummary(text, kind) {
    var s = $("summary");
    s.textContent = text;
    s.className = "summary " + (kind || "");
  }

  function summarize(recommended, method, q) {
    var head = "Q = " + U.fmt(q * Calc.LS_TO_M3H, 2) + " м³/ч.  ";
    if (recommended < 0) {
      setSummary(head + "Подходящего калибра нет — проверьте расход и тип счётчика.", "bad");
      return;
    }
    var c = candidates[recommended];
    if (Calc.suitable(c, method)) {
      setSummary(head + "Рекомендуется " + c.markFull + " (" + c.kindName + "): потери " +
        U.fmt(Calc.loss(c, method), 2) + " м при пределе " + U.coef(c.limit) + " м.", "good");
    } else {
      setSummary(head + "По пределу потерь не проходит ни один калибр; показан вариант с наименьшими потерями — " +
        c.markFull + ", " + U.fmt(Calc.loss(c, method), 2) + " м.", "bad");
    }
  }

  /* ------------------------------------------------------------ таблица подбора */

  function addOrUpdate() {
    if (!candidates.length || pick < 0) {
      U.toast("Выберите вариант в списке.");
      return;
    }
    var c = candidates[pick];
    var method = currentMethod();

    if (!Calc.hasLoss(c, method)) {
      alert("Для DN " + c.dn + " в таблице СНиП 2.04.01-85* (прил. 4) нет строки.\n" +
            "Выберите паспортный метод или другой калибр.");
      return;
    }

    if (!Calc.suitable(c, method)) {
      var what = !c.flowOk
        ? "Расход вне паспортного диапазона счётчика (" + c.flowStatus + ")."
        : "Потери " + U.fmt(Calc.loss(c, method), 2) + " м больше предела " + U.coef(c.limit) + " м.";
      if (!confirm(what + "\n\nВсё равно добавить строку?")) return;
    }

    var r = Rows.fromCandidate(c, $("fMedium").value, $("fPulse").checked, method);
    r.place = $("fPlace").value.trim();
    r.systemName = $("fSystem").value.trim();
    r.note = $("fNote").value.trim();

    if (editIndex >= 0) {
      rows[editIndex] = r;
      selRow = editIndex;
      cancelEdit();
    } else {
      rows.push(r);
      selRow = rows.length - 1;
      // Место установки оставляем: подряд обычно заполняется одна секция.
      $("fSystem").value = "";
      $("fQ").value = "";
      $("fQ").focus();
      recalc();
    }

    renderRows();
    save();
  }

  function cancelEdit() {
    editIndex = -1;
    $("btnAdd").textContent = "ОК — добавить строку";
    $("btnCancelEdit").hidden = true;
  }

  function editRow() {
    if (selRow < 0) { U.toast("Выберите строку в таблице."); return; }
    var r = rows[selRow];

    $("fPlace").value = r.place;
    $("fSystem").value = r.systemName;
    $("fNote").value = r.note;
    $("fMedium").value = r.medium;
    $("fPulse").checked = r.pulse;
    $("fKind").value = r.kind;
    document.querySelector("input[name=method][value=" + r.method + "]").checked = true;
    $("fQ").value = U.coef(r.qLs);

    recalc();
    selectCandidate(r.dn, r.kind, r.variant);

    editIndex = selRow;
    $("btnAdd").textContent = "Сохранить изменения";
    $("btnCancelEdit").hidden = false;
    window.scrollTo(0, 0);
  }

  function selectCandidate(dn, kind, variant) {
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.dn !== dn || c.kind !== kind) continue;
      if (variant && c.variant !== variant) continue;
      pick = i;
      markPick();
      return;
    }
  }

  function moveRow(delta) {
    if (selRow < 0) { U.toast("Выберите строку в таблице."); return; }
    var target = selRow + delta;
    if (target < 0 || target >= rows.length) return;
    var tmp = rows[selRow];
    rows[selRow] = rows[target];
    rows[target] = tmp;
    selRow = target;
    renderRows();
    save();
  }

  function dupRow() {
    if (selRow < 0) { U.toast("Выберите строку в таблице."); return; }
    rows.splice(selRow + 1, 0, Rows.clone(rows[selRow]));
    selRow = selRow + 1;
    renderRows();
    save();
  }

  function delRow() {
    if (selRow < 0) { U.toast("Выберите строку в таблице."); return; }
    rows.splice(selRow, 1);
    if (editIndex === selRow) cancelEdit();
    selRow = Math.min(selRow, rows.length - 1);
    renderRows();
    save();
  }

  function clearRows() {
    if (!rows.length) return;
    if (!confirm("Очистить всю таблицу подбора?")) return;
    rows = [];
    selRow = -1;
    cancelEdit();
    renderRows();
    save();
  }

  function renderRows() {
    var body = $("tRows").tBodies[0];
    body.innerHTML = "";
    $("rowsEmpty").hidden = rows.length > 0;
    $("rowsCount").textContent = rows.length ? "строк: " + rows.length : "";

    var merge = $("fMerge").checked;
    var spans = Rows.spans(rows, merge);

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tr = U.el("tr");
      if (i === selRow) tr.className = "sel";

      var num = U.el("td", { "class": "c" });
      num.textContent = String(i + 1);
      tr.appendChild(num);

      // Объединение по месту установки: одна ячейка на всю группу — ровно так
      // же, как потом в выгруженном документе.
      if (!merge || spans[i] > 0) {
        var place = U.el("td", { "class": "l wrap" + (merge && spans[i] > 1 ? " vm" : "") });
        if (merge && spans[i] > 1) place.setAttribute("rowspan", String(spans[i]));
        place.textContent = r.place;
        tr.appendChild(place);
      }

      tr.appendChild(cellText(r.systemName, "l wrap"));
      tr.appendChild(cellText(U.fmt(r.qLs, 2), "c"));

      var loss = cellText(U.fmt(Rows.loss(r), 2), "c" + (Rows.lossOk(r) && Rows.flowOk(r) ? "" : " over"));
      tr.appendChild(loss);

      tr.appendChild(cellText(r.mark, "c"));
      tr.appendChild(cellText(r.method === "passport" ? "паспорт" : "СП", "c"));
      tr.appendChild(cellText(r.note, "l wrap"));

      (function (index) {
        tr.addEventListener("click", function () { selRow = index; renderRows(); });
        tr.addEventListener("dblclick", function () { selRow = index; editRow(); });
      })(i);

      body.appendChild(tr);
    }

    renderPlaces();
    renderReport();
  }

  function cellText(text, cls) {
    var td = U.el("td", { "class": cls || "" });
    td.textContent = text === null || text === undefined ? "" : text;
    return td;
  }

  function renderPlaces() {
    var dl = $("dlPlaces");
    dl.innerHTML = "";
    var seen = [];
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].place;
      if (!p || seen.indexOf(p) >= 0) continue;
      seen.push(p);
      dl.appendChild(U.el("option", { value: p }));
    }
  }

  /* ------------------------------------------------------------ расчёт и справочники */

  function renderReport() {
    $("report").textContent = Report.build(rows, settings).join("\n");
  }

  function renderRefs() {
    var cls = settings.calc.cls;
    $("refVaneTitle").textContent =
      "Крыльчатые счётчики — паспортные данные (Qmin и Qt показаны для класса " + Tables.CLASSES[cls] + ")";

    fill("tVane", Tables.VANE.map(function (v) {
      return [
        { t: v.code, c: "l" }, { t: String(v.dn), c: "c" }, { t: U.coef(v.k) },
        { t: U.coef(v.qn) }, { t: U.coef(v.qmax) },
        { t: U.coef(v.qminCold[cls]) }, { t: U.coef(v.qtCold[cls]) },
        { t: U.coef(v.qminHot[cls]) }, { t: U.coef(v.qtHot[cls]) }
      ];
    }));

    fill("tTurbine", Tables.TURBINE.map(function (m) {
      return [
        { t: String(m.dn), c: "c" }, { t: U.coef(m.k) },
        { t: U.coef(m.qminCold) }, { t: U.coef(m.qtCold) }, { t: U.coef(m.qnCold) }, { t: U.coef(m.qmaxCold) },
        { t: U.coef(m.qminHot) }, { t: U.coef(m.qtHot) }, { t: U.coef(m.qnHot) }, { t: U.coef(m.qmaxHot) }
      ];
    }));

    fill("tSp", Tables.SP.map(function (s) {
      return [
        { t: String(s.dn), c: "c" }, { t: U.coef(s.s) },
        { t: U.coef(s.qmin) }, { t: U.coef(s.qoper) }, { t: U.coef(s.qmax) }
      ];
    }));
  }

  function fill(tableId, data) {
    var body = $(tableId).tBodies[0];
    body.innerHTML = "";
    for (var i = 0; i < data.length; i++) {
      var tr = U.el("tr");
      for (var j = 0; j < data[i].length; j++) tr.appendChild(cellText(data[i][j].t, data[i][j].c));
      body.appendChild(tr);
    }
  }

  /* ------------------------------------------------------------ настройки */

  function settingsToUi() {
    $("sLimitVane").value = U.coef(settings.calc.limitVane);
    $("sLimitTurbine").value = U.coef(settings.calc.limitTurbine);
    $("sClass").value = Tables.CLASSES[settings.calc.cls];
    $("sTitle").value = settings.tableTitle;
    $("sFooter").value = settings.tableFooter;
    $("sReportTitle").value = settings.reportTitle;
    $("sFont").value = settings.docFont;
    $("sFontSize").value = U.coef(settings.docFontSize);

    $("fMerge").checked = settings.mergePlaces;
    $("fPulse").checked = settings.pulse;
    document.querySelector("input[name=method][value=" + settings.defaultMethod + "]").checked = true;
  }

  function applySettings() {
    var limitVane = U.num($("sLimitVane").value);
    var limitTurbine = U.num($("sLimitTurbine").value);
    var size = U.num($("sFontSize").value);

    if (!(limitVane > 0) || !(limitTurbine > 0)) {
      alert("Пределы потерь должны быть положительными числами.");
      return;
    }
    if (!(size >= 6 && size <= 24)) {
      alert("Кегль должен быть числом от 6 до 24.");
      return;
    }

    settings.calc.limitVane = limitVane;
    settings.calc.limitTurbine = limitTurbine;
    settings.calc.cls = Math.max(0, Tables.CLASSES.indexOf($("sClass").value));
    settings.tableTitle = $("sTitle").value;
    settings.tableFooter = $("sFooter").value;
    settings.reportTitle = $("sReportTitle").value;
    settings.docFont = $("sFont").value.trim() || "Times New Roman";
    settings.docFontSize = size;

    // Строки держат свой предел — иначе после смены норматива старые строки
    // продолжали бы проверяться по-старому.
    for (var i = 0; i < rows.length; i++)
      rows[i].limit = Calc.limit(settings.calc, rows[i].kind);

    renderRefs();
    renderRows();
    recalc();
    save();
    U.toast("Настройки применены.");
  }

  function resetSettings() {
    var fresh = Project.defaults();
    settings.calc = fresh.calc;
    settings.tableTitle = fresh.tableTitle;
    settings.tableFooter = fresh.tableFooter;
    settings.reportTitle = fresh.reportTitle;
    settings.docFont = fresh.docFont;
    settings.docFontSize = fresh.docFontSize;
    settingsToUi();
    applySettings();
  }

  /* ------------------------------------------------------------ файлы */

  function save() { Project.autoSave(settings, rows); }

  function exportTable() {
    if (!rows.length) { U.toast("Таблица подбора пуста."); return; }
    settings.mergePlaces = $("fMerge").checked;
    U.download(Docx.table(settings, rows), "Подбор счетчиков.docx");
  }

  function exportReport() {
    U.download(Docx.report(settings, Report.build(rows, settings)), "Расчет потерь в счетчиках.docx");
  }

  function saveProject() {
    var text = Project.serialize(settings, rows);
    U.download(new Blob([text], { type: "text/plain;charset=utf-8" }), "Подбор счетчиков.wms");
  }

  function openProject(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = Project.parse(String(reader.result));
        settings = data.settings;
        rows = data.rows;
        selRow = rows.length ? 0 : -1;
        cancelEdit();
        settingsToUi();
        renderRefs();
        renderRows();
        recalc();
        save();
        U.toast("Проект открыт: строк " + rows.length + ".");
      } catch (e) {
        alert("Не удалось открыть проект: " + e.message);
      }
    };
    // Файлы проекта всегда в UTF-8 — и из настольной версии, и отсюда.
    reader.readAsText(file, "utf-8");
  }

  function newProject() {
    if (rows.length && !confirm("Начать новый проект? Текущая таблица будет очищена.")) return;
    rows = [];
    selRow = -1;
    cancelEdit();
    renderRows();
    Project.autoClear();
    U.toast("Новый проект.");
  }

  /* ------------------------------------------------------------ запуск */

  function initButtons() {
    $("btnAdd").addEventListener("click", addOrUpdate);
    $("btnCancelEdit").addEventListener("click", cancelEdit);
    $("btnUp").addEventListener("click", function () { moveRow(-1); });
    $("btnDown").addEventListener("click", function () { moveRow(1); });
    $("btnEdit").addEventListener("click", editRow);
    $("btnDup").addEventListener("click", dupRow);
    $("btnDel").addEventListener("click", delRow);
    $("btnClear").addEventListener("click", clearRows);

    $("btnExportTable").addEventListener("click", exportTable);
    $("btnExportReport").addEventListener("click", exportReport);
    $("btnExportReport2").addEventListener("click", exportReport);
    $("btnSaveProject").addEventListener("click", saveProject);
    $("btnNewProject").addEventListener("click", newProject);

    $("btnOpenProject").addEventListener("click", function () { $("fileProject").click(); });
    $("fileProject").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) openProject(e.target.files[0]);
      e.target.value = "";
    });

    $("btnCopyReport").addEventListener("click", function () {
      var text = $("report").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { U.toast("Текст расчёта скопирован."); },
          function () { U.toast("Браузер не дал скопировать — выделите текст вручную."); });
      } else {
        U.toast("Браузер не дал скопировать — выделите текст вручную.");
      }
    });

    $("btnApplySets").addEventListener("click", applySettings);
    $("btnResetSets").addEventListener("click", resetSettings);
  }

  function start() {
    initTabs();
    initForm();
    initButtons();

    var saved = Project.autoLoad();
    if (saved) {
      settings = saved.settings;
      rows = saved.rows;
      selRow = rows.length ? 0 : -1;
    }

    settingsToUi();
    renderRefs();
    renderRows();
    syncNoteToMethod();
    recalc();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
