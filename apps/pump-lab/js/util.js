/* Общие мелочи: числа, поиск корня, цвета из CSS, холст с учётом плотности пикселей. */
var U = (function () {
  "use strict";

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Число по-русски: запятая, без хвостовых нулей не режем — в приборах важна ровная ширина. */
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    if (d === undefined) d = 1;
    var s = x.toFixed(d);
    if (s === "-0" || /^-0[.,]0+$/.test(s)) s = s.slice(1);
    return s.replace(".", ",");
  }

  /* Корень монотонной функции на отрезке [a, b] делением пополам.
     Функция может как расти, так и падать: знак берём по концам. */
  function bisect(f, a, b, iters) {
    var fa = f(a), fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if ((fa > 0) === (fb > 0)) return Math.abs(fa) < Math.abs(fb) ? a : b;
    var n = iters || 50;
    for (var i = 0; i < n; i++) {
      var m = 0.5 * (a + b), fm = f(m);
      if (fm === 0) return m;
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
    }
    return 0.5 * (a + b);
  }

  /* Давление насыщенного пара воды в метрах водяного столба. Уравнение Антуана:
     lg p[мм рт. ст.] = A − B/(C + T), два набора коэффициентов — до и после 100 °C. */
  function vaporHead(T) {
    var mm = T <= 100 ? Math.pow(10, 8.07131 - 1730.63 / (233.426 + T))
                      : Math.pow(10, 8.14019 - 1810.94 / (244.485 + T));
    return mm * 0.133322 / 9.81;                            // мм рт. ст. → кПа → м
  }

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* Цвета берём из CSS-переменных, чтобы холсты следовали теме. */
  var colorCache = {};
  function css(name) {
    if (colorCache[name]) return colorCache[name];
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    colorCache[name] = v || "#888";
    return colorCache[name];
  }
  function resetColors() { colorCache = {}; }

  /* Холст под размер элемента с учётом devicePixelRatio. Возвращает контекст в CSS-пикселях. */
  function fitCanvas(cv) {
    var r = cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  /* «Красивый» шаг сетки. */
  function niceStep(range, target) {
    var raw = range / (target || 6);
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var m = raw / p;
    var s = m < 1.5 ? 1 : (m < 3 ? 2 : (m < 7 ? 5 : 10));
    return s * p;
  }

  /* Смешение двух цветов #rrggbb. */
  function mix(c1, c2, t) {
    function h(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }
    var a = h(c1), b = h(c2);
    var r = [0, 1, 2].map(function (i) { return Math.round(lerp(a[i], b[i], clamp(t, 0, 1))); });
    return "rgb(" + r.join(",") + ")";
  }

  /* Детерминированный генератор случайных чисел — опыты повторяются одинаково. */
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  /* Слияние: значения из src поверх dst, вглубь по объектам; массивы заменяются целиком. */
  function merge(dst, src) {
    for (var k in src) {
      if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === "object") merge(dst[k], src[k]);
      else dst[k] = deepCopy(src[k]);
    }
    return dst;
  }

  function getPath(obj, path) {
    var p = path.split("."), o = obj;
    for (var i = 0; i < p.length; i++) { if (o == null) return undefined; o = o[p[i]]; }
    return o;
  }
  function setPath(obj, path, v) {
    var p = path.split("."), o = obj;
    for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = v;
  }

  return {
    clamp: clamp, lerp: lerp, fmt: fmt, bisect: bisect, vaporHead: vaporHead,
    $: $, el: el, css: css, resetColors: resetColors, fitCanvas: fitCanvas, niceStep: niceStep,
    mix: mix, rng: rng, deepCopy: deepCopy, merge: merge, getPath: getPath, setPath: setPath
  };
})();
