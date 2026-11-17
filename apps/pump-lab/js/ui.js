/* Интерфейс: панель настроек, главный цикл моделирования, показания, вкладки. */
(function () {
  "use strict";
  var $ = U.$;
  var STORE = "pumplab.cfg.v1";
  var cfg, sim;
  var running = true, speed = 1, lastTs = 0, uiT = 0, expActive = null;
  var chartOpt = { yMode: "pump", range: true, family: false, parabola: false, eta: false, trail: true };
  var trendWin = 60;
  var lastEventId = 0;

  /* ------------------------------------------------------------ описание полей */

  var isAuto = function (c) { return c.ctrl.mode === "vfd1" || c.ctrl.mode === "vfdAll"; };
  var isVfd = function (c) { return isAuto(c) || c.ctrl.mode === "manualVfd"; };
  var isMain = function (c) { return c.source.type === "main"; };
  var isTank = function (c) { return c.source.type === "tank"; };

  var SECTIONS = [
    { title: "Управление", open: true, fields: [
      { k: "ctrl.mode", t: "select", l: "Режим", opts: Object.keys(Model.MODES).map(function (m) { return [m, Model.MODES[m]]; }) },
      { k: "ctrl.Hset", t: "range", l: "Уставка давления на выходе", u: "м", min: 10, max: 110, step: 0.5, show: isAuto, hint: "Датчик давления после насосов. 10 м ≈ 1 бар." },
      { k: "ctrl.fManual", t: "range", l: "Частота вручную", u: "Гц", min: 0, max: 60, step: 0.5, show: function (c) { return c.ctrl.mode === "manualVfd"; }, hint: "В ручном режиме ПЧ пускает и ниже f мин — чтобы увидеть, что там происходит." },
      { t: "pumps" },
      { k: "net.valveOpen", t: "range", l: "Задвижка на напорной линии", u: "%", min: 0, max: 1, step: 0.01, pct: true, hint: "Дросселирование: прикрытая задвижка делает сеть круче." }
    ] },
    { title: "Потребители (краны)", open: true, fields: [
      { t: "taps" },
      { k: "auto.on", t: "check", l: "Автоматический водоразбор (краны сами)" },
      { k: "auto.level", t: "range", l: "Интенсивность разбора", u: "", min: 0, max: 1, step: 0.05, d: 2, show: function (c) { return c.auto.on; } },
      { k: "auto.period", t: "range", l: "Как часто меняется", u: "с", min: 2, max: 60, step: 1, d: 0, show: function (c) { return c.auto.on; } },
      { k: "needFree", t: "range", l: "Нужный свободный напор у крана", u: "м", min: 0, max: 30, step: 1, d: 0 }
    ] },
    { title: "Источник воды", fields: [
      { k: "source.type", t: "select", l: "Откуда берём воду", opts: [["main", "Городской водопровод (прямое подключение)"], ["tank", "Бак разрыва струи (непрямое)"]] },
      { k: "source.Hmain", t: "range", l: "Подпор в сети (среднее)", u: "м", min: 0, max: 80, step: 0.5, show: isMain },
      { k: "source.fluct", t: "select", l: "Колебания подпора", show: isMain, opts: [["none", "нет"], ["sine", "синусоида"], ["steps", "случайные ступеньки"], ["night", "ночью выше (плавно)"]] },
      { k: "source.fluctAmp", t: "range", l: "Размах колебаний (±)", u: "м", min: 0, max: 30, step: 0.5, show: function (c) { return isMain(c) && c.source.fluct !== "none"; } },
      { k: "source.fluctPeriod", t: "range", l: "Период колебаний", u: "с", min: 5, max: 600, step: 5, d: 0, show: function (c) { return isMain(c) && c.source.fluct !== "none"; } },
      { k: "source.dHin", t: "range", l: "Потери на вводе (счётчик, трубы) при Qрасч", u: "м", min: 0, max: 15, step: 0.1, hint: "Чем больше расход, тем ниже подпор у насосов." },
      { k: "source.Qref", t: "range", l: "Qрасч для потерь на вводе", u: "м³/ч", min: 1, max: 60, step: 0.5 },
      { k: "source.tankZ", t: "range", l: "Дно бака выше оси насоса на", u: "м", min: -8, max: 8, step: 0.1, show: isTank, hint: "Отрицательное — насос стоит выше дна бака и всасывает (как у Аникина, рис. 23)." },
      { k: "source.tankH", t: "range", l: "Высота бака", u: "м", min: 0.5, max: 4, step: 0.1, show: isTank },
      { k: "source.tankArea", t: "range", l: "Площадь зеркала воды", u: "м²", min: 0.2, max: 10, step: 0.1, show: isTank },
      { k: "source.levelSet", t: "range", l: "Поплавок закрывается на уровне", u: "м", min: 0.3, max: 4, step: 0.05, d: 2, show: isTank },
      { k: "source.floatQ", t: "range", l: "Подпитка поплавковым клапаном", u: "м³/ч", min: 0, max: 40, step: 0.5, show: isTank },
      { k: "source.levelMin", t: "range", l: "Уровень сухого хода", u: "м", min: 0.05, max: 1.5, step: 0.05, d: 2, show: isTank },
      { k: "source.loop", t: "check", l: "Вода от кранов возвращается в бак (замкнутый стенд)", show: isTank },
      { k: "source.Tin", t: "range", l: "Температура воды", u: "°C", min: 1, max: 95, step: 1, d: 0 }
    ] },
    { title: "Насосы", fields: [
      { k: "pumpCount", t: "range", l: "Число насосов", u: "", min: 1, max: 3, step: 1, d: 0 },
      { k: "pump.H0", t: "range", l: "H0 — напор при Q = 0 (50 Гц)", u: "м", min: 10, max: 150, step: 1, d: 0 },
      { k: "pump.Qopt", t: "range", l: "Qопт — подача в точке лучшего КПД", u: "м³/ч", min: 1, max: 40, step: 0.5 },
      { k: "pump.Hopt", t: "range", l: "Hопт — напор в этой точке", u: "м", min: 5, max: 140, step: 1, d: 0 },
      { k: "pump.hump", t: "range", l: "«Горб» кривой (0 — стабильная)", u: "", min: 0, max: 0.6, step: 0.02, d: 2 },
      { k: "pump.etaMax", t: "range", l: "КПД насоса в оптимуме", u: "%", min: 0.3, max: 0.85, step: 0.01, pct: true },
      { k: "pump.p0ratio", t: "range", l: "Мощность при Q = 0, доля от оптимума", u: "", min: 0.15, max: 0.7, step: 0.01, d: 2 },
      { k: "pump.npsh0", t: "range", l: "NPSHтр при Q = 0", u: "м", min: 0.2, max: 5, step: 0.1 },
      { k: "pump.npshOpt", t: "range", l: "NPSHтр при Qопт", u: "м", min: 0.5, max: 8, step: 0.1 },
      { k: "pump.dhPV", t: "range", l: "Потери в арматуре насоса при Qопт", u: "м", min: 0, max: 5, step: 0.1 },
      { k: "pump.waterMass", t: "range", l: "Воды в корпусе насоса", u: "кг", min: 0.5, max: 20, step: 0.5, hint: "Меньше воды — быстрее нагрев при работе без подачи." },
      { k: "vfd.fMin", t: "range", l: "f мин ПЧ", u: "Гц", min: 5, max: 45, step: 0.5, show: isVfd },
      { k: "vfd.fMax", t: "range", l: "f макс ПЧ", u: "Гц", min: 30, max: 60, step: 0.5, show: isVfd },
      { k: "vfd.ramp", t: "range", l: "Разгон ПЧ 0 → 50 Гц", u: "с", min: 0.3, max: 30, step: 0.1, show: isVfd }
    ] },
    { title: "Сеть и мембранный бак", fields: [
      { k: "net.dhPipe", t: "range", l: "Потери в трубах до кранов при Qрасч", u: "м", min: 0, max: 30, step: 0.5 },
      { k: "net.Qref", t: "range", l: "Qрасч сети", u: "м³/ч", min: 1, max: 60, step: 0.5 },
      { k: "net.valveKvs", t: "range", l: "Kvs задвижки", u: "м³/ч", min: 2, max: 200, step: 1, d: 0 },
      { k: "net.tankOn", t: "check", l: "Мембранный бак на напорной стороне" },
      { k: "net.tankV", t: "range", l: "Объём бака", u: "л", min: 2, max: 500, step: 1, d: 0, show: function (c) { return c.net.tankOn; } },
      { k: "net.tankPre", t: "range", l: "Давление подкачки воздуха", u: "м", min: 0, max: 100, step: 0.5, show: function (c) { return c.net.tankOn; }, hint: "Обычно ≈ 0,9 от давления включения (в абсолютных)." },
      { k: "net.Cpipe", t: "range", l: "Упругость труб (без бака)", u: "л/м", min: 0.002, max: 0.5, step: 0.002, d: 3, hint: "Сколько литров «влезает» в сеть на 1 м роста давления. Мало — давление скачет мгновенно." }
    ] },
    { title: "Регулятор (шкаф управления)", fields: [
      { k: "ctrl.Kp", t: "range", l: "Kp — усиление", u: "Гц/м", min: 0.02, max: 6, step: 0.02, d: 2, show: isAuto },
      { k: "ctrl.Ti", t: "range", l: "Ti — время интегрирования", u: "с", min: 0.1, max: 20, step: 0.05, d: 2, show: isAuto },
      { k: "ctrl.sensorTau", t: "range", l: "Инерция датчика давления", u: "с", min: 0.05, max: 3, step: 0.05, d: 2 },
      { k: "ctrl.addDH", t: "range", l: "Пик. насос: вкл, если давление ниже уставки на", u: "м", min: 0, max: 15, step: 0.5, show: function (c) { return c.ctrl.mode === "vfd1"; } },
      { k: "ctrl.remDH", t: "range", l: "Пик. насос: выкл, если выше уставки на", u: "м", min: 0.5, max: 20, step: 0.5, show: function (c) { return c.ctrl.mode === "vfd1"; } },
      { k: "ctrl.fAdd", t: "range", l: "Добавить насос при частоте ≥", u: "Гц", min: 30, max: 60, step: 0.5, show: function (c) { return c.ctrl.mode === "vfdAll"; } },
      { k: "ctrl.fRem", t: "range", l: "Снять насос при частоте ≤", u: "Гц", min: 10, max: 55, step: 0.5, show: isAuto },
      { k: "ctrl.addDelay", t: "range", l: "Задержка подключения", u: "с", min: 0, max: 30, step: 0.5, show: isAuto },
      { k: "ctrl.remDelay", t: "range", l: "Задержка отключения", u: "с", min: 0, max: 60, step: 0.5, show: isAuto },
      { k: "ctrl.sleep", t: "check", l: "Спящий режим при малом разборе", show: isAuto },
      { k: "ctrl.sleepQ", t: "range", l: "«Разбора нет», если подача меньше", u: "м³/ч", min: 0.05, max: 3, step: 0.05, d: 2, show: function (c) { return isAuto(c) && c.ctrl.sleep; }, hint: "В жизни — реле протока или оценка расхода самим ПЧ по мощности и частоте." },
      { k: "ctrl.sleepDelay", t: "range", l: "Уснуть через", u: "с", min: 1, max: 60, step: 1, d: 0, show: function (c) { return isAuto(c) && c.ctrl.sleep; } },
      { k: "ctrl.boost", t: "range", l: "Подъём давления перед сном", u: "м", min: 0, max: 15, step: 0.5, show: function (c) { return isAuto(c) && c.ctrl.sleep; } },
      { k: "ctrl.wake", t: "range", l: "Проснуться при падении ниже уставки на", u: "м", min: 0.5, max: 20, step: 0.5, show: function (c) { return isAuto(c) && c.ctrl.sleep; } },
      { k: "ctrl.relayOn", t: "range", l: "Реле: включение насоса 1 ниже", u: "м", min: 5, max: 110, step: 0.5, show: function (c) { return c.ctrl.mode === "relay"; } },
      { k: "ctrl.relayOff", t: "range", l: "Реле: выключение насоса 1 выше", u: "м", min: 5, max: 120, step: 0.5, show: function (c) { return c.ctrl.mode === "relay"; } },
      { k: "ctrl.relayStep", t: "range", l: "Смещение порогов следующих насосов", u: "м", min: 0, max: 15, step: 0.5, show: function (c) { return c.ctrl.mode === "relay"; }, hint: "У каждого следующего насоса пороги ниже (пособие Wilo, с. 39)." },
      { k: "ctrl.afterRun", t: "range", l: "Выбег базового насоса после порога", u: "с", min: 0, max: 60, step: 1, d: 0, show: function (c) { return c.ctrl.mode === "relay"; } },
      { k: "ctrl.minRun", t: "range", l: "Минимальное время работы", u: "с", min: 0, max: 30, step: 0.5, show: function (c) { return c.ctrl.mode === "relay"; } },
      { k: "ctrl.alternate", t: "check", l: "Чередовать ведущий насос после остановки" }
    ] },
    { title: "Защиты", fields: [
      { k: "ctrl.dryProt", t: "check", l: "Защита от сухого хода" },
      { k: "ctrl.dryH", t: "range", l: "Отключение при подпоре ниже", u: "м", min: 0, max: 30, step: 0.5, show: function (c) { return c.ctrl.dryProt && isMain(c); } }
    ] }
  ];

  /* ------------------------------------------------------------ сохранение */

  function load() {
    var d = Model.defaults();
    try {
      var s = localStorage.getItem(STORE);
      if (s) { var o = JSON.parse(s); if (o && o.pump && o.ctrl && o.taps) return U.merge(d, o); }
    } catch (e) { /* хранилище недоступно — работаем с умолчаниями */ }
    return d;
  }
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* не важно */ } }, 400);
  }

  /* ------------------------------------------------------------ панель настроек */

  function fmtVal(f, v) {
    if (f.pct) return U.fmt(v * 100, 0);
    var d = f.d !== undefined ? f.d : (f.step >= 1 ? 0 : (f.step >= 0.1 ? 1 : 2));
    return U.fmt(v, d);
  }

  function buildSide() {
    var side = $("side");
    side.innerHTML = "";
    SECTIONS.forEach(function (sec, si) {
      var det = U.el("details", { "class": "sec" });
      if (sec.open) det.open = true;
      det.innerHTML = "<summary>" + sec.title + "</summary>";
      var box = U.el("div", { "class": "fields" });
      sec.fields.forEach(function (f, fi) {
        var id = "f_" + si + "_" + fi;
        f.id = id;
        var row;
        if (f.t === "pumps") { row = U.el("div", { "class": "pumprow", id: "pumpBtns" }); }
        else if (f.t === "taps") { row = U.el("div", { "class": "taplist", id: "tapList" }); }
        else if (f.t === "select") {
          row = U.el("label", { "class": "field sel" });
          row.innerHTML = '<span class="lbl">' + f.l + '</span><select data-k="' + f.k + '">' + f.opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") + "</select>";
        } else if (f.t === "check") {
          row = U.el("label", { "class": "field chk" });
          row.innerHTML = '<input type="checkbox" data-k="' + f.k + '"><span>' + f.l + "</span>";
        } else {
          row = U.el("div", { "class": "field rng" });
          row.innerHTML = '<div class="rl"><span class="lbl">' + f.l + '</span><span class="rv"><input type="text" inputmode="decimal" class="num" data-num="' + f.k + '"><em>' + (f.u || "") + '</em></span></div>' +
            '<input type="range" data-k="' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">' + (f.hint ? '<div class="hint">' + f.hint + "</div>" : "");
        }
        row.setAttribute("data-fid", id);
        f.row = row;
        box.appendChild(row);
      });
      det.appendChild(box);
      side.appendChild(det);
    });
    var foot = U.el("div", { "class": "side-foot" });
    foot.innerHTML = '<button type="button" id="btnDefaults">Всё по умолчанию</button>';
    side.appendChild(foot);
    $("btnDefaults").addEventListener("click", function () {
      expActive = null; showBanner();
      cfg = Model.defaults(); sim.cfg = cfg; sim.reset(); syncSide(); save(); Scheme.invalidate();
    });

    side.addEventListener("input", onField);
    side.addEventListener("change", onField);
  }

  function findField(k) {
    for (var s = 0; s < SECTIONS.length; s++) for (var f = 0; f < SECTIONS[s].fields.length; f++) if (SECTIONS[s].fields[f].k === k) return SECTIONS[s].fields[f];
    return null;
  }

  function onField(e) {
    var t = e.target, k = t.getAttribute("data-k"), f;
    if (t.getAttribute("data-num")) {
      if (e.type !== "change") return;
      k = t.getAttribute("data-num"); f = findField(k);
      var x = parseFloat(String(t.value).replace(",", "."));
      if (!isFinite(x)) { syncSide(); return; }
      if (f.pct) x /= 100;
      x = U.clamp(x, f.min, f.max);
      U.setPath(cfg, k, x);
      after(k);
      return;
    }
    if (t.getAttribute("data-tap") !== null) {
      var i = +t.getAttribute("data-tap"), what = t.getAttribute("data-what");
      if (what === "on") cfg.taps[i].on = t.checked;
      else if (what === "open") cfg.taps[i].open = +t.value;
      else if (what === "kv") cfg.taps[i].kv = +t.value;
      syncTaps(); save();
      return;
    }
    if (t.getAttribute("data-fail") !== null) {
      cfg.ctrl.failed[+t.getAttribute("data-fail")] = t.checked; save(); syncPumps(); return;
    }
    if (!k) return;
    f = findField(k);
    var val;
    if (t.type === "checkbox") val = t.checked;
    else if (t.tagName === "SELECT") val = t.value;
    else val = +t.value;
    U.setPath(cfg, k, val);
    after(k);
  }

  function after(k) {
    if (k === "ctrl.mode") onModeChange();
    if (k === "source.type") { sim.level = cfg.source.level0; sim.HinRaw = sim.inletRaw(sim.t); }
    save();
    syncSide();
  }

  function onModeChange() {
    sim.state = "run";
    sim.u = Math.max(cfg.vfd.fMin, Math.min(cfg.vfd.fMax, sim.pumps[sim.lead].f || cfg.vfd.fMin));
    sim.addT = sim.remT = sim.sleepT = 0;
    // при переходе в ручной режим сохраняем то, что работало
    if (cfg.ctrl.mode === "manualDol" || cfg.ctrl.mode === "manualVfd") {
      for (var i = 0; i < 3; i++) cfg.ctrl.manualOn[i] = sim.pumps[i].on;
      if (cfg.ctrl.mode === "manualVfd") {
        var f = 0; for (var j = 0; j < 3; j++) f = Math.max(f, sim.pumps[j].on ? sim.pumps[j].f : 0);
        if (f > 1) cfg.ctrl.fManual = Math.round(f * 2) / 2;
      }
    }
  }

  function syncSide() {
    SECTIONS.forEach(function (sec) {
      sec.fields.forEach(function (f) {
        if (f.row) f.row.style.display = (!f.show || f.show(cfg)) ? "" : "none";
        if (!f.k) return;
        var v = U.getPath(cfg, f.k);
        var inp = f.row.querySelector("[data-k]");
        if (f.t === "check") inp.checked = !!v;
        else if (f.t === "select") inp.value = v;
        else {
          if (document.activeElement !== inp) inp.value = v;
          var num = f.row.querySelector("[data-num]");
          if (document.activeElement !== num) num.value = fmtVal(f, v);
        }
      });
    });
    syncPumps();
    syncTaps();
    $("fManualTop").value = cfg.ctrl.fManual;
    $("fManualTopV").textContent = U.fmt(cfg.ctrl.fManual, 1) + " Гц";
    $("fManualTopWrap").style.display = cfg.ctrl.mode === "manualVfd" ? "" : "none";
    $("modeTop").value = cfg.ctrl.mode;
  }

  function syncPumps() {
    var box = $("pumpBtns"), n = cfg.pumpCount, man = cfg.ctrl.mode === "manualDol" || cfg.ctrl.mode === "manualVfd";
    var s = "";
    for (var i = 0; i < n; i++) {
      s += '<div class="prow"><span class="pdot" style="background:var(--p' + (i + 1) + ')"></span><b>Насос ' + (i + 1) + "</b>" +
        (man ? '<button type="button" class="tgl' + (cfg.ctrl.manualOn[i] ? " on" : "") + '" data-pon="' + i + '">' + (cfg.ctrl.manualOn[i] ? "работает" : "стоит") + "</button>" : '<span class="muted small">командует шкаф</span>') +
        '<label class="fail"><input type="checkbox" data-fail="' + i + '"' + (cfg.ctrl.failed[i] ? " checked" : "") + "> авария</label></div>";
    }
    if (box.innerHTML !== s) box.innerHTML = s;
  }

  function syncTaps() {
    var box = $("tapList"), taps = cfg.taps;
    if (box.children.length !== taps.length) {
      var s = "";
      taps.forEach(function (t, i) {
        s += '<div class="tapr"><label class="chk"><input type="checkbox" data-tap="' + i + '" data-what="on"><span>' + t.name + ' <em class="muted">z ' + U.fmt(t.z, 0) + " м</em></span></label>" +
          '<input type="range" min="0" max="1" step="0.05" data-tap="' + i + '" data-what="open" title="открытие крана"><span class="tv"></span></div>';
      });
      box.innerHTML = s;
    }
    taps.forEach(function (t, i) {
      var r = box.children[i];
      r.querySelector('[data-what="on"]').checked = !!t.on;
      var o = r.querySelector('[data-what="open"]');
      if (document.activeElement !== o) o.value = t.open;
      r.querySelector(".tv").textContent = U.fmt(t.open * 100, 0) + "%";
      r.classList.toggle("off", !t.on);
    });
  }

  /* ------------------------------------------------------------ показания */

  function readings() {
    var s = "", n = cfg.pumpCount;
    function r(a, b, cls) { s += '<div class="rd' + (cls ? " " + cls : "") + '"><span>' + a + "</span><b>" + b + "</b></div>"; }
    r("Время моделирования", fmtTime(sim.t));
    r("Подпор на входе", U.fmt(sim.Hin, 1) + " м");
    r("Давление на выходе", U.fmt(sim.Hn, 1) + " м · " + U.fmt(sim.Hn / 10.2, 2) + " бар");
    r("Подача насосов / разбор", U.fmt(sim.Qp, 2) + " / " + U.fmt(sim.Qs, 2) + " м³/ч");
    r("Потребляемая мощность", U.fmt(sim.Pel, 2) + " кВт");
    r("Энергия / вода", U.fmt(sim.energy, 3) + " кВт·ч / " + U.fmt(sim.volume, 3) + " м³");
    r("Удельный расход энергии", sim.volume > 0.001 ? U.fmt(sim.energy / sim.volume, 3) + " кВт·ч/м³" : "—");
    if (cfg.source.type === "tank") r("Уровень в баке", U.fmt(sim.level, 2) + " м");
    for (var i = 0; i < n; i++) {
      var ps = sim.pumps[i];
      r("Насос " + (i + 1), U.fmt(ps.f, 1) + " Гц · " + U.fmt(ps.Q, 2) + " м³/ч · " + U.fmt(ps.H, 1) + " м · КПД " + U.fmt(ps.eta * 100, 0) + "% · NPSHа/тр " + U.fmt(ps.npshA, 1) + "/" + U.fmt(ps.npshR, 1) + " м", "p" + (i + 1));
      r("", "пусков " + ps.starts + (sim.t > 20 ? " (≈ " + U.fmt(sim.startsPerHour(i), 0) + " в час)" : "") + " · в работе " + fmtTime(ps.runTime) + " · " + U.fmt(ps.T, 1) + " °C", "sub");
    }
    $("readings").innerHTML = s;
  }
  function fmtTime(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return (m ? m + " мин " : "") + U.fmt(s, m ? 0 : 1) + " с";
  }

  function logUpdate() {
    var ev = sim.events;
    if (!ev.length || ev[ev.length - 1].id === lastEventId) return;
    lastEventId = ev[ev.length - 1].id;
    var s = "";
    for (var i = ev.length - 1; i >= Math.max(0, ev.length - 60); i--) s += '<li class="' + ev[i].level + '"><span>' + fmtTime(ev[i].t) + "</span>" + ev[i].text + "</li>";
    $("log").innerHTML = s;
  }

  function explainUpdate(eq) {
    var items = Explain.now(sim, eq);
    $("explain").innerHTML = items.map(function (it) { return '<li class="' + it.lvl + '">' + it.text + "</li>"; }).join("");
  }

  /* ------------------------------------------------------------ цикл */

  function frame(ts) {
    requestAnimationFrame(frame);
    var real = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (!$("tab-lab").classList.contains("active")) return;
    tick(real);
  }

  /* Один кадр: real — прошедшее реальное время, с. Вынесено отдельно, чтобы
     прогонять модель и без анимации (скрытая вкладка, проверки). */
  function tick(real) {
    var simDt = running ? real * speed : 0;
    var h = speed > 15 ? 0.02 : 0.01;
    var steps = Math.min(4000, Math.round(simDt / h));
    var t0 = performance.now();
    for (var k = 0; k < steps; k++) {
      sim.step(h);
      if (performance.now() - t0 > 30) break;
    }
    if (sim.tapsChanged) { sim.tapsChanged = false; syncTaps(); }
    Scheme.update(sim, running ? real * Math.min(speed, 3) : 0);
    var eq = sim.equilibrium();
    chartOpt.eq = eq;
    LabChart.draw($("qh"), sim, chartOpt);
    Trends.draw($("trend"), sim, trendWin);
    uiT += real;
    if (uiT > 0.25) {
      uiT = 0;
      readings();
      explainUpdate(eq);
      logUpdate();
      $("simClock").textContent = fmtTime(sim.t);
    }
  }

  /* ------------------------------------------------------------ опыты */

  function renderExpList() {
    var host = $("expList"), s = "";
    Experiments.list.forEach(function (e, i) {
      s += '<section class="card exp"><div class="exp-h"><h3>' + e.title + '</h3><span class="tag">' + e.tag + "</span></div>" +
        "<p>" + e.why + '</p><button type="button" class="primary" data-exp="' + i + '">Запустить на стенде</button></section>';
    });
    host.innerHTML = s;
    host.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-exp]");
      if (!b) return;
      startExp(Experiments.list[+b.getAttribute("data-exp")]);
    });
  }

  function startExp(e) {
    expActive = e;
    cfg = Experiments.apply(e);
    sim.cfg = cfg; sim.reset();
    lastEventId = 0;
    Scheme.invalidate();
    chartOpt.yMode = "pump"; chartOpt.family = false; chartOpt.parabola = false; chartOpt.range = true; chartOpt.eta = false; chartOpt.trail = true;
    if (e.chart) for (var k in e.chart) chartOpt[k] = e.chart[k];
    syncChartOpts();
    setSpeed(e.speed || 1);
    running = true; syncRun();
    syncSide(); save();
    showBanner();
    showTab("lab");
    window.scrollTo(0, 0);
  }

  function showBanner() {
    var b = $("expBanner");
    if (!expActive) { b.hidden = true; return; }
    var e = expActive;
    b.hidden = false;
    b.innerHTML = '<div class="eb-head"><b>Опыт: ' + e.title + '</b><span><button type="button" id="expRestart">Заново</button> <button type="button" id="expClose">Закрыть</button></span></div>' +
      '<div class="eb-grid"><div><h4>Что делать</h4><ol>' + e.steps.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ol></div>" +
      "<div><h4>На что смотреть</h4><ul>" + e.watch.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div></div>" +
      '<p class="eb-why"><b>Почему так.</b> ' + e.why + "</p>";
    $("expRestart").onclick = function () { startExp(e); };
    $("expClose").onclick = function () { expActive = null; showBanner(); };
  }

  /* ------------------------------------------------------------ панель над схемой */

  function setSpeed(v) {
    speed = v;
    Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"), function (b) { b.classList.toggle("on", +b.getAttribute("data-speed") === v); });
  }
  function syncRun() { $("btnRun").textContent = running ? "⏸ Пауза" : "▶ Пуск"; $("btnRun").classList.toggle("primary", !running); }

  function syncChartOpts() {
    $("optY").value = chartOpt.yMode;
    ["range", "family", "parabola", "eta", "trail"].forEach(function (k) { $("opt_" + k).checked = !!chartOpt[k]; });
  }

  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) { t.classList.toggle("active", t.id === "tab-" + name); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === name); });
    if (name === "anatomy") Anatomy.start(); else Anatomy.stop();
    if (name === "drain") DrainUI.start(); else DrainUI.stop();
    if (name === "sprink") SprinkUI.start(); else SprinkUI.stop();
    if (name === "basics") Basics.redrawAll();
    try { localStorage.setItem("pumplab.tab", name); } catch (e) { /* не важно */ }
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) {
      b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
    });
    $("btnRun").addEventListener("click", function () { running = !running; syncRun(); });
    $("btnReset").addEventListener("click", function () { sim.reset(); lastEventId = 0; $("log").innerHTML = ""; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"), function (b) {
      b.addEventListener("click", function () { setSpeed(+b.getAttribute("data-speed")); });
    });
    $("optY").addEventListener("change", function () { chartOpt.yMode = this.value; });
    ["range", "family", "parabola", "eta", "trail"].forEach(function (k) {
      $("opt_" + k).addEventListener("change", function () { chartOpt[k] = this.checked; });
    });
    $("trendWin").addEventListener("change", function () { trendWin = +this.value; });
    $("modeTop").innerHTML = Object.keys(Model.MODES).map(function (m) { return '<option value="' + m + '">' + Model.MODES[m] + "</option>"; }).join("");
    $("modeTop").addEventListener("change", function () { cfg.ctrl.mode = this.value; onModeChange(); save(); syncSide(); });
    $("fManualTop").addEventListener("input", function () { cfg.ctrl.fManual = +this.value; save(); syncSide(); });

    $("side").addEventListener("click", function (e) {
      var b = e.target.closest("[data-pon]");
      if (!b) return;
      var i = +b.getAttribute("data-pon");
      cfg.ctrl.manualOn[i] = !cfg.ctrl.manualOn[i];
      save(); syncPumps();
    });

    Scheme.mount($("scheme"), {
      tap: function (i) { cfg.taps[i].on = !cfg.taps[i].on; if (cfg.taps[i].on && cfg.taps[i].open < 0.05) cfg.taps[i].open = 1; syncTaps(); save(); },
      pump: function (i) {
        if (cfg.ctrl.mode === "manualDol" || cfg.ctrl.mode === "manualVfd") cfg.ctrl.manualOn[i] = !cfg.ctrl.manualOn[i];
        else cfg.ctrl.failed[i] = !cfg.ctrl.failed[i];
        syncPumps(); save();
      },
      valve: function () { cfg.net.valveOpen = cfg.net.valveOpen > 0.5 ? 0 : 1; syncSide(); save(); }
    });

    // Клавиши: пробел — пауза. Смотрим e.key: у удалённых рабочих столов e.code бывает пустым.
    document.addEventListener("keydown", function (e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); running = !running; syncRun(); }
    });
    window.addEventListener("resize", function () { U.resetColors(); });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onTheme = function () { U.resetColors(); Scheme.invalidate(); if ($("tab-basics").classList.contains("active")) Basics.redrawAll(); };
      if (mq.addEventListener) mq.addEventListener("change", onTheme); else if (mq.addListener) mq.addListener(onTheme);
    }
  }

  function init() {
    cfg = load();
    sim = new Model.Sim(cfg);
    window.PumpLab = {
      get sim() { return sim; }, get cfg() { return cfg; }, startExp: startExp, experiments: Experiments.list, setSpeed: setSpeed,
      /* прогон на seconds секунд модели без анимации, затем один кадр отрисовки */
      advance: function (seconds) {
        var h = 0.01, n = Math.round(seconds / h);
        for (var k = 0; k < n; k++) sim.step(h);
        var keep = speed; speed = 0; tick(0.02); speed = keep;
        uiT = 1; tick(0);
        return sim.t;
      },
      syncSide: function () { syncSide(); }
    };
    buildSide();
    wire();
    syncSide();
    syncChartOpts();
    renderExpList();
    Anatomy.init();
    Basics.init();
    DrainUI.init();
    SprinkUI.init();
    var tab = "lab";
    try { tab = localStorage.getItem("pumplab.tab") || "lab"; } catch (e) { /* не важно */ }
    showTab(tab);
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
