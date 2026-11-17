/* Боковая панель настроек стенда: описание полей → готовые ползунки, списки и галочки.
   Один и тот же строитель работает на всех стендах, поэтому стенд описывает только,
   что у него крутится, а не как это нарисовать.

   Описание поля:
     { k: "путь.в.состоянии", t: "range|select|check|num|text|note|custom", l: "подпись",
       u: "единица", min, max, step, d (знаков после запятой), pct (показывать ×100),
       opts: [[значение, подпись], …], hint: "пояснение", show: function (state) { … },
       render: function (state) { return "<html>"; }   // для t = "note" и "custom"
       onClick: function (id, state) { … }             // для кнопок внутри custom
     }
   Разделы: [{ title, open, fields: [...] }] или просто массив полей. */
var Panel = (function () {
  "use strict";

  function fmtVal(f, v) {
    if (f.pct) return U.fmt(v * 100, f.d === undefined ? 0 : f.d);
    var d = f.d !== undefined ? f.d : (f.step >= 1 ? 0 : (f.step >= 0.1 ? 1 : (f.step >= 0.01 ? 2 : 3)));
    return U.fmt(v, d);
  }

  function build(host, sections, state, onChange) {
    if (!sections.length) return { sync: function () {} };
    if (!sections[0].fields) sections = [{ title: null, open: true, fields: sections }];

    host.innerHTML = "";
    var all = [];

    sections.forEach(function (sec, si) {
      var box, holder;
      if (sec.title) {
        var det = U.el("details", { "class": "sec" });
        if (sec.open !== false) det.open = true;
        det.innerHTML = "<summary>" + sec.title + "</summary>";
        box = U.el("div", { "class": "fields" });
        det.appendChild(box);
        holder = det;
      } else {
        box = U.el("div", { "class": "fields plain" });
        holder = box;
      }

      sec.fields.forEach(function (f, fi) {
        var id = "pf_" + si + "_" + fi + "_" + Math.random().toString(36).slice(2, 6);
        f._id = id;
        var row = U.el("div", { "class": "field " + (f.t || "range"), id: id + "_row" });

        if (f.t === "select") {
          row.innerHTML = '<span class="lbl">' + f.l + "</span>" +
            '<select id="' + id + '">' + f.opts.map(function (o) {
              return '<option value="' + o[0] + '">' + o[1] + "</option>";
            }).join("") + "</select>";
        } else if (f.t === "check") {
          row.innerHTML = '<label class="chk"><input type="checkbox" id="' + id + '"><span>' + f.l + "</span></label>";
        } else if (f.t === "num") {
          row.innerHTML = '<div class="rl"><span class="lbl">' + f.l + '</span><span class="rv">' +
            '<input class="num" type="text" id="' + id + '"><em>' + (f.u || "") + "</em></span></div>";
        } else if (f.t === "note" || f.t === "custom") {
          row.innerHTML = "";
          row.id = id;
        } else {                                   // range
          row.innerHTML = '<div class="rl"><span class="lbl">' + f.l + '</span><span class="rv">' +
            '<input class="num" type="text" id="' + id + '_n"><em>' + (f.u || "") + "</em></span></div>" +
            '<input type="range" id="' + id + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">';
        }
        if (f.hint) row.innerHTML += '<div class="hint">' + f.hint + "</div>";
        box.appendChild(row);
        all.push(f);
      });

      host.appendChild(holder);
    });

    function fire(f) {
      if (onChange) onChange(f ? f.k : null, f);
      sync();
    }

    /* Обработчики: вешаем после того, как всё построено. */
    all.forEach(function (f) {
      var id = f._id, e = U.$(id);
      if (f.t === "select") {
        e.addEventListener("change", function () {
          var v = this.value, cur = U.getPath(state, f.k);
          U.setPath(state, f.k, typeof cur === "number" ? +v : v);
          fire(f);
        });
      } else if (f.t === "check") {
        e.addEventListener("change", function () { U.setPath(state, f.k, this.checked); fire(f); });
      } else if (f.t === "num") {
        e.addEventListener("change", function () {
          var v = parseFloat(this.value.replace(",", "."));
          if (isFinite(v)) U.setPath(state, f.k, v);
          fire(f);
        });
      } else if (f.t === "note" || f.t === "custom") {
        if (f.onClick) e.addEventListener("click", function (ev) {
          var b = ev.target.closest("[data-act]");
          if (b) { f.onClick(b.getAttribute("data-act"), state, b); fire(f); }
        });
      } else {
        e.addEventListener("input", function () {
          U.setPath(state, f.k, +this.value);
          var n = U.$(id + "_n");
          if (n) n.value = fmtVal(f, +this.value);
          if (onChange) onChange(f.k, f);
        });
        e.addEventListener("change", function () { fire(f); });
        var num = U.$(id + "_n");
        num.addEventListener("change", function () {
          var v = parseFloat(this.value.replace(",", "."));
          if (isFinite(v)) {
            v = U.clamp(f.pct ? v / 100 : v, f.min, f.max);
            U.setPath(state, f.k, v);
          }
          fire(f);
        });
      }
    });

    function sync() {
      all.forEach(function (f) {
        var row = U.$(f._id + "_row") || U.$(f._id);
        if (!row) return;
        var vis = f.show ? !!f.show(state) : true;
        row.style.display = vis ? "" : "none";
        if (!vis) return;
        var v = U.getPath(state, f.k);
        var e = U.$(f._id);
        if (f.t === "select") { if (e.value !== String(v)) e.value = String(v); }
        else if (f.t === "check") e.checked = !!v;
        else if (f.t === "num") { if (document.activeElement !== e) e.value = fmtVal(f, v); }
        else if (f.t === "note" || f.t === "custom") { if (f.render) e.innerHTML = f.render(state); }
        else {
          if (document.activeElement !== e) e.value = v;
          var n = U.$(f._id + "_n");
          if (n && document.activeElement !== n) n.value = fmtVal(f, v);
        }
      });
    }

    sync();
    return { sync: sync };
  }

  return { build: build, fmtVal: fmtVal };
})();
