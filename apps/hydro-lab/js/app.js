/* Каркас лаборатории: список стендов, вкладки, общий цикл моделирования и вывод.

   Стенд регистрируется объектом:
     id, group, title, lead      — кто он и куда попадёт в меню
     defaults()                  — состояние (то, что крутится на панели)
     fields                      — описание панели (см. panel.js)
     vis: { kind: "svg"|"canvas", h }   — главная картинка стенда
     charts: [{ id, title, h, opts }]   — холсты с графиками
     hint                        — строка-подсказка под картинкой
     speeds                      — набор скоростей модели (false — стенд без времени)
     build(ui)                   — один раз: построить картинку
     reset()                     — сбросить модель
     tick(dt)                    — шаг модели, dt — секунды модели
     draw(ui)                    — нарисовать картинку и графики
     readings()                  — [{ n, v, cls }]
     explain()                   — [{ lvl, text }]
     theory                      — html под стендом
     experiments                 — [{ title, tag, steps, watch, why, preset, speed }]

   Анимация вынесена в tick(dt)/draw() ещё и потому, что в скрытой панели
   предпросмотра requestAnimationFrame не срабатывает: для проверок есть
   window.HydroLab.advance(секунды). */
var Lab = (function () {
  "use strict";
  var $ = U.$;

  var GROUPS = [
    { id: "basics", name: "Основы гидравлики" },
    { id: "water", name: "Водоснабжение" },
    { id: "sewer", name: "Канализация" }
  ];

  var stands = {}, order = [];
  var active = null, activeGroup = null;
  var running = true, speed = 1, lastTs = 0, uiT = 0;

  function register(st) {
    if (!st.id) throw new Error("у стенда нет id");
    stands[st.id] = st;
    order.push(st.id);
  }
  function get(id) { return stands[id]; }
  function inGroup(g) { return order.map(function (i) { return stands[i]; }).filter(function (s) { return s.group === g; }); }

  /* --------------------------------------------------------------- хранение */

  function store(st) { return "hydrolab." + st.id + ".v1"; }
  function loadState(st) {
    var d = st.defaults();
    try {
      var s = localStorage.getItem(store(st));
      if (s) { var o = JSON.parse(s); if (o && typeof o === "object") return U.merge(d, o); }
    } catch (e) { /* хранилище недоступно — работаем с умолчаниями */ }
    return d;
  }
  var saveTimer = null;
  function save(st) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(store(st), JSON.stringify(st.state)); } catch (e) { /* не важно */ }
    }, 400);
  }

  /* --------------------------------------------------------------- построение стенда */

  function buildStand(st) {
    if (st._ui) return st._ui;
    st.state = loadState(st);

    var sec = U.el("section", { "class": "stand", id: "stand-" + st.id });
    var vis = st.vis || { kind: "svg", h: 460 };
    var charts = st.charts || [];
    var hasSide = (st.fields && st.fields.length) ? true : false;

    var html =
      '<div class="lab' + (hasSide ? "" : " nosides") + '">' +
      (hasSide ? '<aside class="side" id="' + st.id + '_side"></aside>' : "") +
      '<div class="labmain">' +
        '<div class="card exp-banner" id="' + st.id + '_banner" hidden></div>' +
        '<div class="card vis-card">' +
          '<div class="toolbar" id="' + st.id + '_tools"></div>' +
          '<div class="vis" id="' + st.id + '_vis"></div>' +
          (st.hint ? '<p class="scheme-hint">' + st.hint + "</p>" : "") +
        "</div>" +
        (charts.length ? '<div class="' + (charts.length > 1 ? "grid2" : "grid1") + '">' + charts.map(function (c) {
          return '<div class="card chart-card"><div class="ctitle"><b>' + c.title + "</b>" +
            (c.opts ? '<span class="opts" id="' + st.id + "_copt_" + c.id + '">' + c.opts + "</span>" : "") +
            '</div><canvas id="' + st.id + "_ch_" + c.id + '" style="height:' + (c.h || 300) + 'px"></canvas></div>';
        }).join("") + "</div>" : "") +
        '<div class="grid2">' +
          '<div class="card"><h3>Что сейчас происходит</h3><ul class="explain" id="' + st.id + '_explain"></ul></div>' +
          '<div class="card"><h3>Показания</h3><div class="readings" id="' + st.id + '_readings"></div></div>' +
        "</div>" +
        (st.experiments && st.experiments.length ?
          '<div class="card exp-strip"><h3>Опыты</h3><div class="exp-list" id="' + st.id + '_exps"></div></div>' : "") +
        (st.theory ? '<div class="text-cols">' + st.theory + "</div>" : "") +
      "</div></div>";
    sec.innerHTML = html;
    $("stands").appendChild(sec);

    var ui = {
      stand: st,
      root: sec,
      vis: $(st.id + "_vis"),
      canvas: function (id) { return $(st.id + "_ch_" + id); },
      opts: function (id) { return $(st.id + "_copt_" + id); },
      refresh: function () { syncPanel(st); },
      save: function () { save(st); }
    };
    st._ui = ui;

    /* Панель управления */
    if (hasSide) {
      st._panel = Panel.build($(st.id + "_side"), st.fields, st.state, function (key, f) {
        if (st.onChange) st.onChange(key, f);
        save(st);
      });
    }

    /* Панель инструментов над картинкой */
    var tools = $(st.id + "_tools");
    if (st.speeds !== false) {
      var sp = st.speeds || [0.25, 1, 4];
      tools.innerHTML =
        '<button type="button" class="btnRun">⏸ Пауза</button>' +
        '<span class="speeds">скорость ' + sp.map(function (v) {
          return '<button type="button" data-speed="' + v + '">' + speedLabel(v) + "</button>";
        }).join("") + "</span>" +
        '<button type="button" class="btnReset">Сброс</button>' +
        '<span class="clock">t = <b class="simClock">0 с</b></span>';
      tools.querySelector(".btnRun").addEventListener("click", function () { running = !running; syncRun(); });
      tools.querySelector(".btnReset").addEventListener("click", function () { resetStand(st); });
      Array.prototype.forEach.call(tools.querySelectorAll("[data-speed]"), function (b) {
        b.addEventListener("click", function () { setSpeed(+b.getAttribute("data-speed")); });
      });
    }
    if (st.tools) {
      var extra = U.el("span", { "class": "tools-extra" }, st.tools);
      tools.appendChild(extra);
      if (st.onTool) extra.addEventListener("click", function (e) {
        var b = e.target.closest("[data-act]");
        if (b) { st.onTool(b.getAttribute("data-act"), b); syncPanel(st); save(st); }
      });
    }

    /* Опыты */
    if (st.experiments && st.experiments.length) {
      var host = $(st.id + "_exps");
      host.innerHTML = st.experiments.map(function (e, i) {
        return '<section class="exp"><div class="exp-h"><h4 class="expt">' + e.title + "</h4>" +
          (e.tag ? '<span class="tag">' + e.tag + "</span>" : "") + "</div>" +
          "<p>" + e.why + '</p><button type="button" class="primary" data-exp="' + i + '">Поставить опыт</button></section>';
      }).join("");
      host.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-exp]");
        if (b) startExp(st, st.experiments[+b.getAttribute("data-exp")]);
      });
    }

    st.t = 0;
    if (st.build) st.build(ui);
    if (st.reset) st.reset();
    return ui;
  }

  function speedLabel(v) {
    if (v === 0.05) return "×1/20";
    if (v === 0.1) return "×1/10";
    if (v === 0.25) return "×¼";
    if (v === 0.5) return "×½";
    return "×" + U.fmt(v, v < 1 ? 2 : 0);
  }

  function syncPanel(st) { if (st._panel) st._panel.sync(); }

  function resetStand(st) {
    st.t = 0;
    if (st.reset) st.reset();
    syncPanel(st);
    drawStand(st);
  }

  /* --------------------------------------------------------------- опыты */

  function startExp(st, e) {
    st._exp = e;
    if (e.preset) U.merge(st.state, e.preset);
    if (e.apply) e.apply(st.state, st);
    if (st.onChange) st.onChange(null, null);
    resetStand(st);
    setSpeed(e.speed || 1);
    running = true; syncRun();
    save(st);
    showBanner(st);
    window.scrollTo(0, 0);
  }

  function showBanner(st) {
    var b = $(st.id + "_banner"), e = st._exp;
    if (!e) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = '<div class="eb-head"><b>Опыт: ' + e.title + '</b><span>' +
      '<button type="button" data-eb="again">Заново</button> <button type="button" data-eb="close">Закрыть</button></span></div>' +
      '<div class="eb-grid"><div><h4>Что делать</h4><ol>' + e.steps.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ol></div>" +
      "<div><h4>На что смотреть</h4><ul>" + e.watch.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div></div>" +
      '<p class="eb-why"><b>Почему так.</b> ' + e.why + "</p>";
    b.onclick = function (ev) {
      var t = ev.target.closest("[data-eb]");
      if (!t) return;
      if (t.getAttribute("data-eb") === "again") startExp(st, e);
      else { st._exp = null; showBanner(st); }
    };
  }

  /* --------------------------------------------------------------- вывод */

  function drawStand(st) {
    if (st.draw) st.draw(st._ui);
  }

  function updateText(st) {
    if (st.readings) {
      var rows = st.readings() || [];
      $(st.id + "_readings").innerHTML = rows.map(function (r) {
        if (r.h) return '<div class="rd-h">' + r.h + "</div>";
        return '<div class="rd ' + (r.cls || "") + '"><span>' + r.n + "</span><b>" + r.v + "</b></div>";
      }).join("");
    }
    if (st.explain) {
      var items = st.explain() || [];
      $(st.id + "_explain").innerHTML = items.map(function (it) {
        return '<li class="' + (it.lvl || "info") + '">' + it.text + "</li>";
      }).join("");
    }
    var clk = st._ui.root.querySelector(".simClock");
    if (clk) clk.textContent = U.fmtTime(st.t || 0);
  }

  /* --------------------------------------------------------------- цикл */

  function frame(ts) {
    requestAnimationFrame(frame);
    var real = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (!active) return;
    tick(real);
  }

  /* Один кадр: real — прошедшее реальное время, с. */
  function tick(real) {
    var st = stands[active];
    if (!st || !st._ui) return;
    var dt = (running && st.speeds !== false) ? real * speed : 0;
    if (dt > 0 && st.tick) {
      var h = st.maxStep || 0.01;
      var n = Math.min(4000, Math.max(1, Math.round(dt / h)));
      var hh = dt / n, t0 = performance.now();
      for (var i = 0; i < n; i++) {
        st.tick(hh);
        st.t += hh;
        if (performance.now() - t0 > 25) break;
      }
    }
    st.anim = (st.anim || 0) + real;
    drawStand(st);
    uiT += real;
    if (uiT > 0.2) { uiT = 0; updateText(st); }
  }

  function setSpeed(v) {
    speed = v;
    Array.prototype.forEach.call(document.querySelectorAll("[data-speed]"), function (b) {
      b.classList.toggle("on", +b.getAttribute("data-speed") === v);
    });
  }
  function syncRun() {
    Array.prototype.forEach.call(document.querySelectorAll(".btnRun"), function (b) {
      b.textContent = running ? "⏸ Пауза" : "▶ Пуск";
      b.classList.toggle("primary", !running);
    });
  }

  /* --------------------------------------------------------------- вкладки */

  function showGroup(g) {
    activeGroup = g;
    Array.prototype.forEach.call(document.querySelectorAll("[data-group]"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-group") === g);
    });
    var sub = $("subnav");
    if (g === "help") {
      sub.innerHTML = "";
      sub.hidden = true;
      showStand(null);
      $("tab-help").classList.add("active");
      $("stands").classList.remove("active");
      return;
    }
    $("tab-help").classList.remove("active");
    $("stands").classList.add("active");
    sub.hidden = false;
    var list = inGroup(g);
    sub.innerHTML = list.map(function (s) {
      return '<button type="button" data-stand="' + s.id + '">' + s.title + (s.star ? " ★" : "") + "</button>";
    }).join("");
    var want = null;
    try { want = localStorage.getItem("hydrolab.stand." + g); } catch (e) { /* не важно */ }
    var ok = list.some(function (s) { return s.id === want; });
    showStand(ok ? want : list[0].id);
    try { localStorage.setItem("hydrolab.group", g); } catch (e) { /* не важно */ }
  }

  function showStand(id) {
    active = id;
    Array.prototype.forEach.call(document.querySelectorAll("[data-stand]"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-stand") === id);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".stand"), function (s) {
      s.classList.toggle("active", s.id === "stand-" + id);
    });
    if (!id) return;
    var st = stands[id];
    buildStand(st);
    st._ui.root.classList.add("active");
    $("standTitle").textContent = st.title;
    $("standLead").innerHTML = st.lead || "";
    showBanner(st);
    syncPanel(st);
    setSpeed(st.speeds === false ? speed : (st.speed0 || 1));
    syncRun();
    if (st.onShow) st.onShow(st._ui);
    drawStand(st);
    updateText(st);
    try { localStorage.setItem("hydrolab.stand." + st.group, id); } catch (e) { /* не важно */ }
  }

  /* --------------------------------------------------------------- запуск */

  function init() {
    var nav = $("groupNav");
    nav.innerHTML = GROUPS.map(function (g) {
      return '<button type="button" data-group="' + g.id + '">' + g.name + "</button>";
    }).join("") + '<button type="button" data-group="help">Справка</button>';
    nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-group]");
      if (b) showGroup(b.getAttribute("data-group"));
    });
    $("subnav").addEventListener("click", function (e) {
      var b = e.target.closest("[data-stand]");
      if (b) showStand(b.getAttribute("data-stand"));
    });

    document.addEventListener("keydown", function (e) {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); running = !running; syncRun(); }
    });
    window.addEventListener("resize", function () { U.resetColors(); if (active) drawStand(stands[active]); });
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onTheme = function () {
        U.resetColors();
        order.forEach(function (id) { if (stands[id]._ui && stands[id].invalidate) stands[id].invalidate(); });
        if (active) drawStand(stands[active]);
      };
      if (mq.addEventListener) mq.addEventListener("change", onTheme);
      else if (mq.addListener) mq.addListener(onTheme);
    }

    var g = "basics";
    try { g = localStorage.getItem("hydrolab.group") || "basics"; } catch (e) { /* не важно */ }
    if (!GROUPS.some(function (x) { return x.id === g; }) && g !== "help") g = "basics";
    showGroup(g);
    syncRun();

    window.HydroLab = {
      stands: stands,
      get active() { return stands[active]; },
      get state() { return stands[active] ? stands[active].state : null; },
      show: showStand,
      group: showGroup,
      setSpeed: setSpeed,
      pause: function () { running = false; syncRun(); },
      play: function () { running = true; syncRun(); },
      /* Прогон модели на seconds секунд без анимации + один кадр отрисовки. */
      advance: function (seconds) {
        var st = stands[active];
        if (!st) return 0;
        var h = st.maxStep || 0.01, n = Math.round(seconds / h);
        if (st.tick) for (var i = 0; i < n; i++) { st.tick(h); st.t += h; }
        st.anim = (st.anim || 0) + seconds;
        drawStand(st);
        updateText(st);
        return st.t;
      },
      exp: function (i) {
        var st = stands[active];
        if (st && st.experiments && st.experiments[i]) startExp(st, st.experiments[i]);
      }
    };

    requestAnimationFrame(frame);
  }

  return { register: register, get: get, GROUPS: GROUPS, init: init, showStand: showStand, save: save };
})();
