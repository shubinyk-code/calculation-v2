/* Мелочи для живых SVG-схем: схема строится строкой один раз, дальше каждый кадр
   меняются только атрибуты найденных по id элементов.

   Важно: внутри <text> — только простой текст. HTML-теги (<sub>, <b>) в SVG,
   вставленном через innerHTML, закрывают <svg>, и хвост схемы уезжает вниз. */
var SK = (function () {
  "use strict";

  function n(x) { return (Math.round(x * 100) / 100).toString(); }

  function open(w, h, cls) {
    return '<svg viewBox="0 0 ' + w + " " + h + '" xmlns="http://www.w3.org/2000/svg" class="scheme-svg ' + (cls || "") + '">';
  }
  function close() { return "</svg>"; }

  /* Труба: тело + бегущие штрихи поверх (штрихи двигаются сменой dashoffset). */
  function pipe(id, d, extra) {
    return '<path class="pipe" id="pb_' + id + '" d="' + d + '"' + (extra || "") + "/>" +
           '<path class="flow" id="pf_' + id + '" d="' + d + '"/>';
  }

  function path(id, d, cls, extra) {
    return '<path' + (id ? ' id="' + id + '"' : "") + ' class="' + (cls || "") + '" d="' + d + '"' + (extra || "") + "/>";
  }
  function line(id, x1, y1, x2, y2, cls, extra) {
    return '<line' + (id ? ' id="' + id + '"' : "") + ' class="' + (cls || "") + '" x1="' + n(x1) + '" y1="' + n(y1) +
      '" x2="' + n(x2) + '" y2="' + n(y2) + '"' + (extra || "") + "/>";
  }
  function rect(id, x, y, w, h, cls, extra) {
    return '<rect' + (id ? ' id="' + id + '"' : "") + ' class="' + (cls || "") + '" x="' + n(x) + '" y="' + n(y) +
      '" width="' + n(Math.max(0, w)) + '" height="' + n(Math.max(0, h)) + '"' + (extra || "") + "/>";
  }
  function circle(id, cx, cy, r, cls, extra) {
    return '<circle' + (id ? ' id="' + id + '"' : "") + ' class="' + (cls || "") + '" cx="' + n(cx) + '" cy="' + n(cy) +
      '" r="' + n(r) + '"' + (extra || "") + "/>";
  }
  function txt(id, x, y, cls, anchor, content) {
    return "<text" + (id ? ' id="' + id + '"' : "") + ' x="' + n(x) + '" y="' + n(y) + '" class="' + (cls || "") +
      '" text-anchor="' + (anchor || "start") + '">' + (content === undefined ? "" : content) + "</text>";
  }
  function g(id, cls, inner, extra) {
    return "<g" + (id ? ' id="' + id + '"' : "") + ' class="' + (cls || "") + '"' + (extra || "") + ">" + inner + "</g>";
  }

  /* Задвижка-«бабочка». */
  function valve(id, x, y, cls, r) {
    r = r || 9;
    return '<g class="valve ' + (cls || "") + '"' + (id ? ' id="' + id + '"' : "") + '><path d="M' + n(x - r) + " " + n(y - r * 0.9) +
      " L" + n(x + r) + " " + n(y + r * 0.9) + " L" + n(x + r) + " " + n(y - r * 0.9) + " L" + n(x - r) + " " + n(y + r * 0.9) +
      ' Z"/><line class="stem" x1="' + n(x) + '" y1="' + n(y - r * 0.9) + '" x2="' + n(x) + '" y2="' + n(y - r * 1.9) +
      '"/><line class="stem" x1="' + n(x - r * 0.7) + '" y1="' + n(y - r * 1.9) + '" x2="' + n(x + r * 0.7) + '" y2="' + n(y - r * 1.9) + '"/></g>';
  }

  /* Манометр: шкала и стрелка (id — у стрелки). */
  function gauge(id, x, y, r) {
    var s = '<g class="gauge" transform="translate(' + n(x) + "," + n(y) + ')"><circle r="' + n(r) + '"/>';
    for (var k = 0; k <= 10; k++) {
      var a = (-225 + 270 * k / 10) * Math.PI / 180;
      s += '<line x1="' + n((r - 2) * Math.cos(a)) + '" y1="' + n((r - 2) * Math.sin(a)) +
        '" x2="' + n((r - 5) * Math.cos(a)) + '" y2="' + n((r - 5) * Math.sin(a)) + '"/>';
    }
    s += '<line class="needle" id="' + id + '" x1="0" y1="0" x2="0" y2="' + n(-(r - 4)) + '"/><circle class="hub" r="2"/></g>';
    return s;
  }
  /* Угол стрелки манометра: 0…max по дуге 270°. */
  function needle(v, vmax) { return -135 + 270 * U.clamp(v / vmax, 0, 1); }

  /* Прибор в рамке: подпись сверху, значение крупно. */
  function box(id, x, y, w, h, cap) {
    return '<g class="box">' + rect(null, x, y, w, h, "", ' rx="4"') +
      txt(null, x + w / 2, y + 13, "tiny muted", "middle", cap) +
      txt(id, x + w / 2, y + h - 7, "val", "middle", "") + "</g>";
  }

  /* Размерная линия со стрелками и подписью. */
  function dimV(x, y1, y2, label, side) {
    var s = line(null, x, y1, x, y2, "dim");
    s += line(null, x - 4, y1, x + 4, y1, "dim") + line(null, x - 4, y2, x + 4, y2, "dim");
    if (label) s += txt(null, x + (side === "left" ? -7 : 7), (y1 + y2) / 2 + 4, "tiny muted", side === "left" ? "end" : "start", label);
    return s;
  }
  function dimH(y, x1, x2, label) {
    var s = line(null, x1, y, x2, y, "dim");
    s += line(null, x1, y - 4, x1, y + 4, "dim") + line(null, x2, y - 4, x2, y + 4, "dim");
    if (label) s += txt(null, (x1 + x2) / 2, y - 5, "tiny muted", "middle", label);
    return s;
  }

  /* Стрелка от (x1,y1) к (x2,y2). */
  function arrow(id, x1, y1, x2, y2, cls, w) {
    var a = Math.atan2(y2 - y1, x2 - x1), L = 7;
    var d = "M" + n(x1) + " " + n(y1) + " L" + n(x2) + " " + n(y2) +
      " M" + n(x2) + " " + n(y2) + " L" + n(x2 - L * Math.cos(a - 0.4)) + " " + n(y2 - L * Math.sin(a - 0.4)) +
      " M" + n(x2) + " " + n(y2) + " L" + n(x2 - L * Math.cos(a + 0.4)) + " " + n(y2 - L * Math.sin(a + 0.4));
    return '<path' + (id ? ' id="' + id + '"' : "") + ' class="' + (cls || "") + '" d="' + d +
      '" fill="none" stroke-width="' + (w || 1.6) + '" stroke-linecap="round"/>';
  }

  /* Подпись на подложке — чтобы читалась поверх схемы. */
  function tag(id, x, y, w, content, cls) {
    return "<g" + (id ? ' id="' + id + '"' : "") + ">" + rect(null, x - w / 2, y - 12, w, 17, "lblbg", ' rx="3"') +
      txt(id ? id + "_t" : null, x, y, (cls || "val"), "middle", content) + "</g>";
  }

  /* --------------------------------------------------------------- работа с готовым SVG */

  function refs(root, ids) {
    var r = {};
    ids.forEach(function (id) { r[id] = root.querySelector("#" + id); });
    return r;
  }
  function set(e, attrs) {
    if (!e) return;
    for (var k in attrs) e.setAttribute(k, attrs[k]);
  }
  function text(e, s) { if (e && e.textContent !== s) e.textContent = s; }
  function cls(e, name, on) { if (e) e.classList.toggle(name, !!on); }

  /* Бегущие штрихи в трубе: скорость v (условная), знак задаёт направление. */
  function flow(e, v, phase) {
    if (!e) return;
    var a = U.clamp(Math.abs(v) * 0.5, 0, 1);
    e.setAttribute("opacity", a * 0.75);
    e.setAttribute("stroke-dashoffset", (-phase * v * 20).toFixed(1));
  }

  return {
    n: n, open: open, close: close, pipe: pipe, path: path, line: line, rect: rect, circle: circle,
    txt: txt, g: g, valve: valve, gauge: gauge, needle: needle, box: box,
    dimV: dimV, dimH: dimH, arrow: arrow, tag: tag,
    refs: refs, set: set, text: text, cls: cls, flow: flow
  };
})();
