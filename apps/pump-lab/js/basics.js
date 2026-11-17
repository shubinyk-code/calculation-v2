/* Вкладка «Азбука кривых»: небольшие интерактивные карточки по разделам пособий. */
var Basics = (function () {
  "use strict";
  var host, cards = [];
  var PUMP = { H0: 58, Qopt: 6, Hopt: 46, hump: 0, etaMax: 0.66, p0ratio: 0.38, npsh0: 0.8, npshOpt: 2, fNom: 50 };

  function slider(id, label, min, max, step, val, unit, d) {
    return '<label class="bs"><span class="bl">' + label + '</span><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><b id="' + id + 'V" data-unit="' + unit + '" data-d="' + (d === undefined ? 1 : d) + '"></b></label>';
  }
  function select(id, label, opts, val) {
    return '<label class="bs"><span class="bl">' + label + '</span><select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select><b></b></label>";
  }
  function v(id) { var e = U.$(id); return e.tagName === "SELECT" ? e.value : +e.value; }
  function showVals(card) {
    Array.prototype.forEach.call(card.el.querySelectorAll("input[type=range]"), function (e) {
      var o = U.$(e.id + "V");
      if (o) o.textContent = U.fmt(+e.value, +o.getAttribute("data-d")) + " " + o.getAttribute("data-unit");
    });
  }

  function add(def) {
    var el = U.el("section", { "class": "card bcard" });
    el.innerHTML = '<h3>' + def.title + '</h3><p class="lead">' + def.lead + '</p><div class="bgrid"><div class="bctl">' + def.controls + '</div><div class="bplot"><canvas></canvas></div></div><div class="bout"></div>' + (def.note ? '<details class="note"><summary>Подробнее</summary>' + def.note + "</details>" : "");
    host.appendChild(el);
    var card = { el: el, def: def, cv: el.querySelector("canvas"), out: el.querySelector(".bout") };
    el.addEventListener("input", function () { redraw(card); });
    el.addEventListener("change", function () { redraw(card); });
    cards.push(card);
  }
  function redraw(card) { showVals(card); card.def.draw(card); }

  /* Корни уравнения насос = сеть:  H0·r² + A·Q·r − B·Q² = Hst + Rs·Q²  (Q ≥ 0). */
  function intersections(co, r, Hst, Rs) {
    var a = co.B + Rs, b = -co.A * r, c = Hst - PUMP.H0 * r * r;
    var d = b * b - 4 * a * c, res = [];
    if (d < 0) return res;
    var q1 = (-b + Math.sqrt(d)) / (2 * a), q2 = (-b - Math.sqrt(d)) / (2 * a);
    if (q1 > 1e-6) res.push(q1);
    if (q2 > 1e-6 && Math.abs(q2 - q1) > 1e-6) res.push(q2);
    return res.sort(function (x, y) { return x - y; });
  }

  function qgrid(xMax, n) { var a = []; for (var i = 0; i <= (n || 100); i++) a.push(xMax * i / (n || 100)); return a; }

  function init() {
    host = U.$("basicsHost");
    var co0 = Pump.coef(PUMP);

    /* ----------------------------------------------------------- A. законы подобия */
    add({
      title: "Частота вращения: законы подобия и минимальная частота",
      lead: "Меняем частоту ПЧ — вся кривая насоса «сжимается» к началу координат: подача ~ n, напор ~ n², мощность ~ n³ (пособие Wilo, с. 23; Аникин, § 2.4). Но рабочая точка — это пересечение с сетью, а у сети есть статический напор.",
      controls: slider("aF", "Частота", 10, 60, 0.5, 40, "Гц") + slider("aHst", "Статический напор сети Hст", 0, 50, 1, 20, "м") + slider("aR", "Потери в сети при 6 м³/ч", 0, 30, 1, 12, "м"),
      note: "<p>Пересчёт по законам подобия: Q₂ = Q₁·n₂/n₁, H₂ = H₁·(n₂/n₁)², P₂ = P₁·(n₂/n₁)³, NPSHтр₂ = NPSHтр₁·(n₂/n₁)². Они верны для <b>подобных режимов</b> — точки лежат на параболе H = k·Q², проходящей через начало координат.</p><p>Сеть с геодезическим подъёмом (или с подпором, который надо «перебить» до уставки) — не парабола из нуля, а Hст + R·Q². Поэтому при снижении частоты подача падает <b>быстрее</b>, чем частота, а при частоте f* = fном·√(Hст/H0) насос перестаёт подавать совсем: его напор при нулевой подаче равен статике, обратный клапан не открывается. Ниже f* насос крутится впустую и греет воду.</p>",
      draw: function (cd) {
        var f = v("aF"), Hst = v("aHst"), Rs = v("aR") / 36, r = f / 50, co = co0;
        var fc = U.fitCanvas(cd.cv), xMax = 16, yMax = 80;
        var P = Plot.frame(fc.ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, м³/ч", yLabel: "H, м" });
        Plot.clip(P);
        var qs = qgrid(xMax);
        for (var ff = 20; ff <= 60; ff += 10) {
          var rr = ff / 50;
          Plot.line(P, qs.map(function (q) { var h = Pump.head(PUMP, co, q, rr); return h > 0 ? [q, h] : null; }), { color: U.css("--muted"), width: 0.9, alpha: 0.5 });
          Plot.label(P, 0.15, PUMP.H0 * rr * rr + 0.4, ff + " Гц", U.css("--muted"));
        }
        Plot.line(P, qs.map(function (q) { var h = Pump.head(PUMP, co, q, r); return h > 0 ? [q, h] : null; }), { color: U.css("--accent"), width: 3 });
        Plot.line(P, qs.map(function (q) { return [q, Hst + Rs * q * q]; }), { color: U.css("--water"), width: 2.2 });
        var q50 = intersections(co, 1, Hst, Rs)[0] || 0, h50 = Hst + Rs * q50 * q50;
        if (q50 > 0) {
          var k = h50 / (q50 * q50);
          Plot.line(P, qs.map(function (q) { return [q, k * q * q]; }), { color: U.css("--est"), width: 1.2, dash: [3, 4] });
          Plot.dot(P, q50, h50, 4, U.css("--muted"));
          var qp = q50 * r;
          Plot.dot(P, qp, k * qp * qp, 5, null, U.css("--est"), 2);
        }
        var qi = intersections(co, r, Hst, Rs), q = qi.length ? qi[qi.length - 1] : 0, h = q > 0 ? Hst + Rs * q * q : PUMP.H0 * r * r;
        Plot.dot(P, q, h, 6, U.css("--accent"), U.css("--panel"), 2);
        Plot.unclip(P);
        Plot.legend(P, [{ text: "насос на " + U.fmt(f, 1) + " Гц", color: U.css("--accent"), width: 3 }, { text: "сеть Hст + R·Q²", color: U.css("--water") }, { text: "парабола подобия через точку 50 Гц", color: U.css("--est"), dash: [3, 4] }]);
        var fstar = 50 * Math.sqrt(Hst / PUMP.H0);
        var P50 = q50 > 0 ? Pump.power(PUMP, co, q50, 1) : 0, Pf = Pump.power(PUMP, co, q, r);
        cd.out.innerHTML =
          '<div class="kvs">' +
          kv("Подача", U.fmt(q, 2) + " м³/ч", q50 > 0 ? U.fmt(100 * q / q50, 0) + "% от 50 Гц (по закону подобия было бы " + U.fmt(100 * r, 0) + "%)" : "") +
          kv("Напор", U.fmt(h, 1) + " м", "") +
          kv("Мощность на валу", U.fmt(Pf, 2) + " кВт", P50 > 0 ? U.fmt(100 * Pf / P50, 0) + "% от 50 Гц (по n³: " + U.fmt(100 * r * r * r, 0) + "%)" : "") +
          kv("Частота отсечки f*", U.fmt(fstar, 1) + " Гц", "ниже неё насос не преодолевает Hст = " + U.fmt(Hst, 0) + " м") + "</div>" +
          (f <= fstar + 0.01 ? '<p class="msg bad">Частота ' + U.fmt(f, 1) + " Гц ниже f* = " + U.fmt(fstar, 1) + " Гц: напор насоса при Q = 0 всего " + U.fmt(PUMP.H0 * r * r, 1) + " м &lt; Hст. Подачи нет, насос работает «на закрытый клапан» и греет воду. Поэтому f мин в ПЧ выбирают выше f* с запасом.</p>" :
            '<p class="msg">Фиолетовый кружок — где была бы точка, если бы сеть была чистой параболой (Hст = 0). Зелёная — где она на самом деле. Чем больше Hст, тем сильнее они расходятся.</p>');
      }
    });

    /* ----------------------------------------------------------- B. форма кривой */
    add({
      title: "Форма кривой: крутая, пологая, стабильная, с «горбом»",
      lead: "Пособие Wilo, с. 21: пологая кривая — большие изменения расхода при малых изменениях напора; крутая — наоборот. Кривая с горбом нестабильна: одному напору соответствуют два расхода.",
      controls: slider("bSteep", "Hопт / H0 (крутизна)", 0.5, 0.95, 0.01, 0.79, "", 2) + slider("bHump", "Горб (0 — стабильная)", 0, 0.6, 0.02, 0, "", 2) + slider("bHst", "Hст сети", 0, 70, 1, 30, "м") + slider("bR", "Потери в сети при 6 м³/ч", 0, 30, 1, 8, "м"),
      note: "<p>Коэффициент напора (градиент) = (H0 − Hопт) / Hопт. Для установок повышения давления пособие требует <b>стабильные</b> кривые: там регулятор давления однозначно понимает, куда двигать частоту.</p><p>На горбатой кривой при высокой статике возможны две точки пересечения. Левая — неустойчивая: малейшее уменьшение расхода роняет напор насоса ниже сети, и поток срывается (помпаж, «качание» давления). Правая — устойчивая.</p>",
      draw: function (cd) {
        var pmp = U.merge(U.deepCopy(PUMP), { Hopt: PUMP.H0 * v("bSteep"), hump: v("bHump") });
        var co = Pump.coef(pmp), Hst = v("bHst"), Rs = v("bR") / 36;
        var xMax = 16, yMax = Plot.niceMax(Math.max(Pump.peak(pmp, co, 1).H, Hst) * 1.15);
        var fc = U.fitCanvas(cd.cv);
        var P = Plot.frame(fc.ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, м³/ч", yLabel: "H, м" });
        Plot.clip(P);
        var qs = qgrid(xMax);
        Plot.line(P, qs.map(function (q) { var h = Pump.head(pmp, co, q, 1); return h > 0 ? [q, h] : null; }), { color: U.css("--accent"), width: 3 });
        Plot.line(P, qs.map(function (q) { return [q, Hst + Rs * q * q]; }), { color: U.css("--water"), width: 2.2 });
        var a = co.B + Rs, b = -co.A, c = Hst - pmp.H0, d = b * b - 4 * a * c, roots = [];
        if (d >= 0) { [(-b + Math.sqrt(d)) / (2 * a), (-b - Math.sqrt(d)) / (2 * a)].forEach(function (q) { if (q > 1e-6) roots.push(q); }); }
        roots.forEach(function (q) {
          var stable = (co.A - 2 * co.B * q) < 2 * Rs * q; // наклон насоса меньше наклона сети
          Plot.dot(P, q, Hst + Rs * q * q, 6, stable ? U.css("--accent") : null, stable ? U.css("--panel") : U.css("--bad"), 2.5);
          Plot.label(P, q + 0.2, Hst + Rs * q * q + 1, stable ? "устойчивая" : "неустойчивая", stable ? U.css("--good") : U.css("--bad"), "left", "bottom", true);
        });
        Plot.unclip(P);
        var grad = (pmp.H0 - pmp.Hopt) / pmp.Hopt;
        var dq = 0, q0 = roots.length ? roots[0] : 0;
        if (q0 > 0) {
          // насколько сдвинется расход при изменении статики на 5 м
          var d2 = b * b - 4 * a * (c + 5);
          var q5 = d2 >= 0 ? (-b + Math.sqrt(d2)) / (2 * a) : 0;
          dq = q0 - q5;
        }
        cd.out.innerHTML = '<div class="kvs">' +
          kv("Коэффициент напора (H0 − Hопт)/Hопт", U.fmt(grad, 2), grad < 0.15 ? "пологая кривая" : (grad > 0.35 ? "крутая кривая" : "средняя")) +
          kv("Точек пересечения", String(roots.length), roots.length === 2 ? "одна из них неустойчива" : "") +
          kv("Если сеть потребует на 5 м больше", roots.length ? "расход упадёт на " + U.fmt(dq, 2) + " м³/ч" : "—", "") + "</div>" +
          (roots.length === 0 ? '<p class="msg bad">Кривые не пересекаются: насос не может поднять воду на Hст = ' + U.fmt(Hst, 0) + " м.</p>" : "");
      }
    });

    /* ----------------------------------------------------------- C. параллельно и последовательно */
    add({
      title: "Два насоса: параллельно и последовательно",
      lead: "Параллельно — расходы складываются при одинаковом напоре; последовательно (как ступени многоступенчатого насоса) — напоры складываются при одинаковом расходе (пособие Wilo, с. 22).",
      controls: select("cMode", "Соединение", [["par", "параллельно"], ["ser", "последовательно"]], "par") + slider("cHst", "Hст сети", 0, 90, 1, 25, "м") + slider("cR", "Потери в сети при 6 м³/ч", 0, 60, 1, 14, "м"),
      note: "<p>Главный урок параллельной работы: <b>второй насос не удваивает расход</b>. Сеть на большем расходе требует большего напора, точка съезжает вверх по суммарной кривой. Чем круче сеть (больше потери), тем меньше прибавка. Поэтому в установках повышения давления резервный насос считают на полный расход, а пиковые — включают каскадом.</p>",
      draw: function (cd) {
        var mode = v("cMode"), Hst = v("cHst"), Rs = v("cR") / 36, co = co0;
        var xMax = mode === "par" ? 24 : 14, yMax = mode === "par" ? 80 : 140;
        var fc = U.fitCanvas(cd.cv);
        var P = Plot.frame(fc.ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, м³/ч", yLabel: "H, м" });
        Plot.clip(P);
        var qs = qgrid(xMax);
        function h1(q) { return Pump.head(PUMP, co, q, 1); }
        Plot.line(P, qs.map(function (q) { var h = h1(q); return h > 0 ? [q, h] : null; }), { color: U.css("--p1"), width: 1.8, dash: [6, 3] });
        var comb = mode === "par" ? qs.map(function (q) { var h = h1(q / 2); return h > 0 ? [q, h] : null; }) : qs.map(function (q) { var h = 2 * h1(q); return h > 0 ? [q, h] : null; });
        Plot.line(P, comb, { color: U.css("--accent"), width: 3 });
        Plot.line(P, qs.map(function (q) { return [q, Hst + Rs * q * q]; }), { color: U.css("--water"), width: 2.2 });
        var q1 = intersections(co, 1, Hst, Rs).pop() || 0;
        var q2 = mode === "par" ? U.bisect(function (q) { return h1(q / 2) - Hst - Rs * q * q; }, 0, 2 * Pump.qMax(PUMP, co, 1), 60)
                                : U.bisect(function (q) { return 2 * h1(q) - Hst - Rs * q * q; }, 0, Pump.qMax(PUMP, co, 1), 60);
        if (mode === "par" && h1(0) < Hst) q2 = 0;
        if (q1 > 0) Plot.dot(P, q1, Hst + Rs * q1 * q1, 5, U.css("--p1"), U.css("--panel"));
        if (q2 > 0) Plot.dot(P, q2, Hst + Rs * q2 * q2, 6, U.css("--accent"), U.css("--panel"), 2);
        if (mode === "par" && q2 > 0) Plot.dot(P, q2 / 2, Hst + Rs * q2 * q2, 4, null, U.css("--p1"), 2);
        Plot.unclip(P);
        Plot.legend(P, [{ text: "один насос", color: U.css("--p1"), dash: [6, 3] }, { text: mode === "par" ? "два параллельно" : "два последовательно", color: U.css("--accent"), width: 3 }, { text: "сеть", color: U.css("--water") }]);
        var gain = q1 > 0 ? (q2 / q1 - 1) * 100 : NaN;
        cd.out.innerHTML = '<div class="kvs">' + kv("Один насос", U.fmt(q1, 2) + " м³/ч", "H = " + U.fmt(Hst + Rs * q1 * q1, 1) + " м") +
          kv("Два насоса", U.fmt(q2, 2) + " м³/ч", "H = " + U.fmt(Hst + Rs * q2 * q2, 1) + " м") +
          kv("Прибавка расхода", isFinite(gain) ? "+" + U.fmt(gain, 0) + "%" : (q2 > 0 ? "только вдвоём насосы вообще подают" : "—"), mode === "par" ? "каждый насос даёт " + U.fmt(q2 / 2, 2) + " м³/ч" : "") + "</div>";
      }
    });

    /* ----------------------------------------------------------- D. дроссель или ПЧ */
    add({
      title: "Регулирование: задвижка (дросселирование) против частоты",
      lead: "Нужен меньший расход. Можно прикрыть задвижку — насос остаётся на своей кривой 50 Гц, лишний напор «сгорает» в задвижке. А можно снизить частоту — кривая опускается до сети (Аникин, рис. 36 и 37).",
      controls: slider("dQ", "Нужный расход", 0.5, 9, 0.1, 4, "м³/ч") + slider("dHst", "Hст сети", 0, 45, 1, 20, "м") + slider("dR", "Потери в сети при 6 м³/ч", 1, 30, 1, 12, "м"),
      note: "<p>Потеря в задвижке ΔH = H₅₀(Q) − Hсети(Q) умножается на расход — это и есть выброшенная мощность. Частотное регулирование «экономичнее всего» (Аникин, § 2.4), но выигрыш сильно зависит от доли статики: при большой Hст частоту много не снизишь, и экономия меньше, чем обещает закон n³.</p>",
      draw: function (cd) {
        var Q = v("dQ"), Hst = v("dHst"), Rs = v("dR") / 36, co = co0;
        var Hs = Hst + Rs * Q * Q, H50 = Pump.head(PUMP, co, Q, 1);
        var r = (-co.A * Q + Math.sqrt(co.A * co.A * Q * Q + 4 * PUMP.H0 * (Hs + co.B * Q * Q))) / (2 * PUMP.H0);
        var fc = U.fitCanvas(cd.cv), xMax = 14, yMax = 70;
        var P = Plot.frame(fc.ctx, fc.w, fc.h, { x1: xMax, y1: yMax, xLabel: "Q, м³/ч", yLabel: "H, м" });
        Plot.clip(P);
        var qs = qgrid(xMax);
        Plot.line(P, qs.map(function (q) { var h = Pump.head(PUMP, co, q, 1); return h > 0 ? [q, h] : null; }), { color: U.css("--p2"), width: 2.2 });
        Plot.line(P, qs.map(function (q) { var h = Pump.head(PUMP, co, q, r); return h > 0 ? [q, h] : null; }), { color: U.css("--accent"), width: 2.6 });
        Plot.line(P, qs.map(function (q) { return [q, Hst + Rs * q * q]; }), { color: U.css("--water"), width: 2.2 });
        if (H50 > Hs) {
          var Rt = (H50 - Hst) / (Q * Q);
          Plot.line(P, qs.map(function (q) { return [q, Hst + Rt * q * q]; }), { color: U.css("--water"), width: 1.2, dash: [5, 4] });
          var c = P.ctx; c.save(); c.strokeStyle = U.css("--bad"); c.lineWidth = 3; c.beginPath(); c.moveTo(P.X(Q), P.Y(Hs)); c.lineTo(P.X(Q), P.Y(H50)); c.stroke(); c.restore();
          Plot.label(P, Q + 0.2, (Hs + H50) / 2, "ΔH в задвижке " + U.fmt(H50 - Hs, 1) + " м", U.css("--bad"), "left", "middle", true);
        }
        Plot.dot(P, Q, H50, 5, U.css("--p2"), U.css("--panel"));
        Plot.dot(P, Q, Hs, 6, U.css("--accent"), U.css("--panel"), 2);
        Plot.unclip(P);
        Plot.legend(P, [{ text: "50 Гц + задвижка", color: U.css("--p2") }, { text: "ПЧ " + U.fmt(50 * r, 1) + " Гц", color: U.css("--accent"), width: 2.6 }, { text: "сеть", color: U.css("--water") }, { text: "сеть с прикрытой задвижкой", color: U.css("--water"), dash: [5, 4] }]);
        var Pt = Pump.power(PUMP, co, Q, 1), Pv = Pump.power(PUMP, co, Q, r) * 1.03;
        var ok = H50 >= Hs;
        cd.out.innerHTML = ok ? '<div class="kvs">' + kv("Задвижка: мощность", U.fmt(Pt, 2) + " кВт", "КПД насоса " + U.fmt(100 * Pump.eta(PUMP, co, Q, 1), 0) + "%") +
          kv("ПЧ: мощность (с потерями ПЧ 3%)", U.fmt(Pv, 2) + " кВт", "частота " + U.fmt(50 * r, 1) + " Гц") +
          kv("Экономия", U.fmt(100 * (1 - Pv / Pt), 0) + "%", U.fmt((Pt - Pv) * 8760 / 1000, 1) + " МВт·ч в год при круглосуточной работе") + "</div>" +
          '<div class="pbars"><div><span>задвижка</span><i style="width:' + (100 * Pt / Math.max(Pt, Pv)).toFixed(0) + '%;background:var(--p2)"></i></div><div><span>ПЧ</span><i style="width:' + (100 * Pv / Math.max(Pt, Pv)).toFixed(0) + '%;background:var(--accent)"></i></div></div>'
          : '<p class="msg bad">При 50 Гц насос не даёт ' + U.fmt(Q, 1) + " м³/ч в эту сеть — нужен более мощный насос.</p>";
      }
    });

    /* ----------------------------------------------------------- E. подпор и f мин */
    add({
      title: "Колебания подпора: хватит ли частотника или нужен редуктор",
      lead: "Пособие Wilo, с. 41: ПЧ компенсирует колебания давления на входе, пока насос может «уйти вниз» достаточно. Предел — напор насоса при Q = 0 на минимальной частоте.",
      controls: slider("eSet", "Уставка на выходе", 20, 100, 1, 50, "м") + slider("eH0", "H0 насоса при 50 Гц", 20, 150, 1, 60, "м") + slider("eFmin", "f мин ПЧ", 10, 40, 1, 25, "Гц") + slider("eMin", "Подпор минимальный", 0, 60, 0.5, 15, "м") + slider("eMax", "Подпор максимальный", 0, 80, 0.5, 30, "м"),
      note: "<p>Физический смысл условия: даже при нулевом разборе насос, вращаясь на f мин, добавляет к подпору свой напор H0(fмин) = H0·(fмин/fном)². Если максимальный подпор плюс эта добавка больше уставки — давление на выходе <b>выше уставки</b>, и регулятор ничего не может сделать (снижать частоту дальше некуда). Тогда перед установкой ставят редуктор «после себя».</p><p>В пособии это записано через бары: ΔHdiff = уставка − H0 при nмин сравнивают с размахом подпора Δpv. Пример 1 (MVISE 805): 5 − 1,7 = 3,3 бар > 1,5 бар — компенсируется. Пример 2 (MVIE 402): 2 − 0,6 = 1,4 бар &lt; 1,5 бар — нужен редуктор.</p><p>С другой стороны, при минимальном подпоре насос на f макс должен добрать до уставки на расчётном расходе — это проверяется подбором насоса.</p>",
      draw: function (cd) {
        var Hset = v("eSet"), H0 = v("eH0"), fmin = v("eFmin"), hmin = Math.min(v("eMin"), v("eMax")), hmax = Math.max(v("eMin"), v("eMax"));
        var H0min = H0 * Math.pow(fmin / 50, 2);
        var reach = hmax + H0min;
        var ok = reach <= Hset;
        var fc = U.fitCanvas(cd.cv), c = fc.ctx, w = fc.w, h = fc.h;
        var yMax = Plot.niceMax(Math.max(Hset, reach, hmin + H0) * 1.1);
        var P = Plot.frame(c, w, h, { x0: 0, x1: 4, y1: yMax, noXLabels: true, xTicks: 4, yLabel: "Напор на выходе, м" });
        function bar(x, lo, hi, col, alpha, text) {
          c.save(); c.fillStyle = col; c.globalAlpha = alpha; c.fillRect(P.X(x - 0.35), P.Y(hi), P.X(x + 0.35) - P.X(x - 0.35), P.Y(lo) - P.Y(hi)); c.restore();
          if (text) Plot.label(P, x, hi + yMax * 0.01, text, U.css("--ink"), "center", "bottom");
        }
        bar(1, 0, hmin, U.css("--muted"), 0.35, "подпор мин " + U.fmt(hmin, 1));
        bar(1, hmin, hmin + H0, U.css("--accent"), 0.35, "+ H0 при 50 Гц");
        bar(2.5, 0, hmax, U.css("--muted"), 0.35, "");
        bar(2.5, hmax, reach, ok ? U.css("--accent") : U.css("--bad"), 0.45, "подпор макс + H0(f мин) = " + U.fmt(reach, 1));
        Plot.line(P, [[0, Hset], [4, Hset]], { color: U.css("--bad"), width: 1.6, dash: [7, 4] });
        Plot.label(P, 3.95, Hset + 0.5, "уставка " + U.fmt(Hset, 0) + " м", U.css("--bad"), "right", "bottom", true);
        Plot.label(P, 1, -0.02 * yMax, "Слабый подпор, f макс", U.css("--muted"), "center", "top");
        Plot.label(P, 2.5, -0.02 * yMax, "Сильный подпор, f мин, Q = 0", U.css("--muted"), "center", "top");
        var fl = Hset > hmax ? 50 * Math.sqrt((Hset - hmax) / H0) : 0;
        cd.out.innerHTML = '<div class="kvs">' + kv("H0 при f мин", U.fmt(H0min, 1) + " м", "= " + U.fmt(H0, 0) + "·(" + fmin + "/50)²") +
          kv("Запас по пособию ΔHdiff = уставка − H0(fмин)", U.fmt(Hset - H0min, 1) + " м", "размах подпора Δpv = " + U.fmt(hmax - hmin, 1) + " м") +
          kv("Наибольшая f мин, при которой ещё компенсирует", Hset > hmax ? U.fmt(fl, 1) + " Гц" : "никакая", "") + "</div>" +
          (ok ? '<p class="msg good">Компенсируется частотой: при максимальном подпоре насос на f мин не перекачает выше уставки.</p>' :
            '<p class="msg bad">Не компенсируется: при максимальном подпоре давление уйдёт выше уставки на ' + U.fmt(reach - Hset, 1) + " м. Нужен редуктор давления перед установкой (или уставку выше, или f мин ниже, если мотор позволяет).</p>") +
          (hmin + H0 < Hset ? '<p class="msg bad">При минимальном подпоре насосу даже на 50 Гц и Q = 0 не хватает: ' + U.fmt(hmin + H0, 1) + " м &lt; уставки.</p>" : "");
      }
    });

    /* ----------------------------------------------------------- F. мембранный бак и пуски */
    add({
      title: "Мембранный бак: полезный объём и число пусков",
      lead: "Пособие Wilo, с. 42: полезный объём бака VEN = VE·Δp(выкл−вкл) / pабс выкл. Без ПЧ (широкий диапазон давлений) бак отдаёт ~26% объёма, с ПЧ (узкий диапазон) — ~3%.",
      controls: slider("fV", "Объём бака VE", 8, 1000, 1, 100, "л", 0) + slider("fOn", "Давление включения", 10, 80, 0.5, 38, "м") + slider("fOff", "Давление выключения", 10, 90, 0.5, 55, "м") + slider("fQ", "Подача насоса (средняя)", 1, 20, 0.5, 6, "м³/ч"),
      note: "<p>Цикл реле давления: пока насос стоит, бак отдаёт VEN со скоростью разбора q; пока насос работает — набирается со скоростью (Qнас − q). Время цикла t = VEN/q + VEN/(Qнас − q). Хуже всего, когда разбор равен половине подачи: тогда пусков в час больше всего, <b>n = Qнас / (4·VEN)</b>.</p><p>Пример пособия: 800 л, 3,8/5,5 бар → 209 л (26%); с ПЧ 3,8/4,0 бар → 32 л (3%). Поэтому в установках с ПЧ бак на напорной стороне нужен не для регулирования, а как буфер при быстром закрытии кранов и для спящего режима.</p>",
      draw: function (cd) {
        var V = v("fV"), pon = Math.min(v("fOn"), v("fOff")), poff = Math.max(v("fOn"), v("fOff")), Qp = v("fQ");
        var ven = V * (poff - pon) / (poff + 10.33);
        var fc = U.fitCanvas(cd.cv);
        var nmax = Qp / (4 * ven / 1000);
        var yMax = Plot.niceMax(Math.min(400, nmax * 1.2));
        var P = Plot.frame(fc.ctx, fc.w, fc.h, { x1: Qp, y1: yMax, xLabel: "разбор, м³/ч", yLabel: "пусков в час" });
        Plot.clip(P);
        var pts = [];
        for (var i = 1; i < 100; i++) { var q = Qp * i / 100; pts.push([q, 1 / ((ven / 1000) / q + (ven / 1000) / (Qp - q))]); }
        Plot.line(P, pts, { color: U.css("--accent"), width: 2.6 });
        Plot.dot(P, Qp / 2, nmax, 5, U.css("--bad"));
        Plot.label(P, Qp / 2, nmax + yMax * 0.02, "максимум " + U.fmt(nmax, 0) + " пусков/ч", U.css("--bad"), "center", "bottom", true);
        [20, 30].forEach(function (lim) { if (lim < yMax) { Plot.line(P, [[0, lim], [Qp, lim]], { color: U.css("--muted"), width: 1, dash: [4, 4] }); Plot.label(P, Qp * 0.02, lim + 0.3, lim + " пусков/ч", U.css("--muted"), "left", "bottom"); } });
        Plot.unclip(P);
        cd.out.innerHTML = '<div class="kvs">' + kv("Полезный объём VEN", U.fmt(ven, 1) + " л", U.fmt(100 * ven / V, 1) + "% от бака") +
          kv("Пусков в час, худший случай", U.fmt(nmax, 0), "при разборе " + U.fmt(Qp / 2, 1) + " м³/ч") +
          kv("Бак, чтобы было не больше 20 пусков/ч", U.fmt(V * nmax / 20, 0) + " л", "при тех же давлениях") + "</div>";
      }
    });

    /* ----------------------------------------------------------- G. кавитация */
    add({
      title: "Кавитация: насколько высоко насос можно поставить над водой",
      lead: "Пособие Wilo, с. 20: H = pатм·10,2 − NPSH − Hf − Hv − Hs. Положительное H — допустимая высота всасывания, отрицательное — какой подпор нужен на входе.",
      controls: slider("gT", "Температура воды", 0, 95, 1, 20, "°C", 0) + slider("gAlt", "Высота местности", 0, 3000, 50, 200, "м", 0) + slider("gN", "NPSH насоса в рабочей точке", 0.5, 8, 0.1, 2.5, "м") + slider("gHf", "Потери во всасывающей линии Hf", 0, 4, 0.1, 1, "м"),
      note: "<p>Кавитация — вскипание воды в зоне пониженного давления на входе в колесо. Пузырьки схлопываются там, где давление выше, — удары разрушают металл (кавитационная эрозия), растут шум и вибрация, падает напор (Аникин, § 2.5). Стадии: начальная (шум, редкие пузырьки), частично развившаяся (падают напор и КПД), полностью развившаяся — срыв работы.</p><p>NPSH3 — надкавитационный напор, при котором напор падает на 3%. Требование: NPSHA ≥ NPSH3 + 0,5 м (или + 1 м, или ≥ SA·NPSH3). NPSHтр растёт с расходом и пропорционален n². Горячая вода и высокогорье резко уменьшают допустимую высоту всасывания.</p>",
      draw: function (cd) {
        var T = v("gT"), alt = v("gAlt"), N = v("gN"), Hf = v("gHf"), Hs = 0.5;
        var pAmb = 1.01325 * Math.pow(1 - 2.25577e-5 * alt, 5.25588);
        function Hmax(t) { return pAmb * 10.2 - N - Hf - U.vaporHead(t) - Hs; }
        var H = Hmax(T);
        var fc = U.fitCanvas(cd.cv);
        var P = Plot.frame(fc.ctx, fc.w, fc.h, { x1: 100, y0: -8, y1: 10, xLabel: "температура воды, °C", yLabel: "H, м" });
        Plot.clip(P);
        var pts = []; for (var t = 0; t <= 100; t += 1) pts.push([t, Hmax(t)]);
        Plot.fillBetween(P, pts.map(function (q) { return [q[0], Math.max(0, q[1])]; }), pts.map(function (q) { return [q[0], 0]; }), U.css("--good"), 0.12);
        Plot.fillBetween(P, pts.map(function (q) { return [q[0], 0]; }), pts.map(function (q) { return [q[0], Math.min(0, q[1])]; }), U.css("--bad"), 0.1);
        Plot.line(P, [[0, 0], [100, 0]], { color: U.css("--axis"), width: 1 });
        Plot.line(P, pts, { color: U.css("--accent"), width: 2.6 });
        Plot.dot(P, T, H, 6, U.css("--accent"), U.css("--panel"), 2);
        Plot.label(P, 3, 8.8, "насос может стоять выше уровня воды", U.css("--good"), "left", "bottom");
        Plot.label(P, 3, -7.5, "нужен подпор на входе", U.css("--bad"), "left", "bottom");
        Plot.unclip(P);
        cd.out.innerHTML = '<div class="kvs">' + kv("pатм", U.fmt(pAmb, 3) + " бар", "= " + U.fmt(pAmb * 10.2, 2) + " м вод. ст.") +
          kv("Давление пара Hv при " + T + " °C", U.fmt(U.vaporHead(T), 2) + " м", "") +
          kv(H >= 0 ? "Допустимая высота всасывания" : "Нужен подпор на входе не меньше", U.fmt(Math.abs(H), 2) + " м", "с запасом Hs = 0,5 м") + "</div>";
      }
    });

    redrawAll();
    window.addEventListener("resize", function () { if (U.$("tab-basics").classList.contains("active")) redrawAll(); });
  }

  function kv(a, b, c) { return '<div class="kv2"><span>' + a + "</span><b>" + b + "</b>" + (c ? "<em>" + c + "</em>" : "") + "</div>"; }
  function redrawAll() { cards.forEach(redraw); }

  return { init: init, redrawAll: redrawAll };
})();
