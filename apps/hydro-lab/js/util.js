/* Общие мелочи: числа, поиск корня, свойства воды, холст с учётом плотности пикселей.
   Стиль тот же, что в PumpLabWeb: глобальные объекты, никаких модулей и сборки. */
var U = (function () {
  "use strict";

  var G = 9.80665;                                    // ускорение свободного падения, м/с²

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Число по-русски: запятая вместо точки. */
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return "—";
    if (d === undefined) d = 1;
    var s = x.toFixed(d);
    if (s === "-0" || /^-0[.,]0+$/.test(s)) s = s.slice(1);
    return s.replace(".", ",");
  }

  /* Число с автоматическим числом знаков: мелкие величины подробнее. */
  function fmtA(x) {
    if (!isFinite(x)) return "—";
    var a = Math.abs(x);
    return fmt(x, a >= 100 ? 0 : (a >= 10 ? 1 : (a >= 1 ? 2 : (a >= 0.01 ? 3 : 4))));
  }

  /* Корень монотонной функции на отрезке [a, b] делением пополам. */
  function bisect(f, a, b, iters) {
    var fa = f(a), fb = f(b);
    if (fa === 0) return a;
    if (fb === 0) return b;
    if ((fa > 0) === (fb > 0)) return Math.abs(fa) < Math.abs(fb) ? a : b;
    var n = iters || 60;
    for (var i = 0; i < n; i++) {
      var m = 0.5 * (a + b), fm = f(m);
      if (fm === 0) return m;
      if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
    }
    return 0.5 * (a + b);
  }

  /* --------------------------------------------------------- свойства воды */

  /* Плотность воды при атмосферном давлении, кг/м³ (формула Танаки, 0…100 °C). */
  function rho(T) {
    var t = clamp(T, 0, 100);
    return 1000 * (1 - (t + 288.9414) / (508929.2 * (t + 68.12963)) * (t - 3.9863) * (t - 3.9863));
  }

  /* Кинематическая вязкость, м²/с. Формула Пуазейля, та самая, что во всех
     учебниках гидравлики (Чугаев, § 1.5): ню = 0,0178/(1 + 0,0337·t + 0,000221·t²) см²/с. */
  function nu(T) {
    var t = clamp(T, 0, 100);
    return 1e-4 * 0.0178 / (1 + 0.0337 * t + 0.000221 * t * t);
  }

  /* Давление насыщенного пара воды в метрах водяного столба (уравнение Антуана).
     Столб — стандартный, при 1000 кг/м³: в этой же шкале атмосфера равна 10,33 м,
     и все манометрические отсчёты в программе сравниваются именно с ней. */
  function vaporHead(T) {
    var mm = T <= 100 ? Math.pow(10, 8.07131 - 1730.63 / (233.426 + T))
                      : Math.pow(10, 8.14019 - 1810.94 / (244.485 + T));
    return mm * 0.133322 * 1000 / (1000 * 9.81);      // мм рт. ст. → Па → м вод. ст.
  }

  /* Модуль объёмной упругости воды, Па (слабо зависит от температуры). */
  function bulkK(T) { return 2.06e9 * (1 - 0.0022 * (clamp(T, 0, 100) - 20)); }

  /* --------------------------------------------------------- DOM и холсты */

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

  /* Холст под размер элемента с учётом devicePixelRatio. Контекст — в CSS-пикселях. */
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
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var m = raw / p;
    var s = m < 1.5 ? 1 : (m < 3 ? 2 : (m < 7 ? 5 : 10));
    return s * p;
  }

  /* Смешение двух цветов; принимает #rrggbb и rgb(...). */
  function mix(c1, c2, t) {
    function h(c) {
      if (c.charAt(0) === "#") {
        if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
        return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)];
      }
      var m = c.match(/[\d.]+/g) || [128, 128, 128];
      return [+m[0], +m[1], +m[2]];
    }
    var a = h(c1), b = h(c2);
    var r = [0, 1, 2].map(function (i) { return Math.round(lerp(a[i], b[i], clamp(t, 0, 1))); });
    return "rgb(" + r.join(",") + ")";
  }

  /* Цвет по шкале «холодно → горячо»: для схем отопления и тепловизора. */
  function heatColor(t, t0, t1) {
    var x = clamp((t - t0) / (t1 - t0 || 1), 0, 1);
    var stops = ["#2f6fd0", "#3fb0c8", "#5ec27a", "#e2c044", "#e08a2e", "#c8392f"];
    var p = x * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p));
    return mix(stops[i], stops[i + 1], p - i);
  }

  /* Детерминированный генератор случайных чисел — опыты повторяются одинаково. */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
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
    for (var i = 0; i < p.length - 1; i++) { if (o[p[i]] === undefined) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = v;
  }

  /* Время моделирования словами. */
  function fmtTime(t) {
    if (t < 60) return fmt(t, 1) + " с";
    var m = Math.floor(t / 60), s = t - m * 60;
    if (m < 60) return m + " мин " + fmt(s, 0) + " с";
    var h = Math.floor(m / 60);
    return h + " ч " + (m - h * 60) + " мин";
  }

  return {
    G: G, clamp: clamp, lerp: lerp, fmt: fmt, fmtA: fmtA, bisect: bisect,
    rho: rho, nu: nu, vaporHead: vaporHead, bulkK: bulkK,
    $: $, el: el, css: css, resetColors: resetColors, fitCanvas: fitCanvas, niceStep: niceStep,
    mix: mix, heatColor: heatColor, rng: rng, deepCopy: deepCopy, merge: merge,
    getPath: getPath, setPath: setPath, fmtTime: fmtTime
  };
})();
