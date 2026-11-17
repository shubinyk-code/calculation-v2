/*
  Числа в русском написании и мелкие помощники.
  Ввод принимает и запятую, и точку: поля текстовые, а не type="number",
  потому что браузер с русской локалью по-разному понимает «1,67» и «1.67».
*/
var Fmt = (function () {
  "use strict";

  function isSet(v) {
    return v !== null && v !== undefined && v !== "" && !(typeof v === "number" && isNaN(v));
  }

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  // Фиксированное число знаков: 5,80
  function num(x, d) {
    if (!isNum(x)) return "—";
    if (d === undefined) d = 2;
    var eps = Math.pow(10, -d) / 2;
    var s = (Math.abs(x) < eps ? 0 : x).toFixed(d);
    return s.replace(".", ",").replace("-", "−");
  }

  // Без хвостовых нулей: 15, 1,67, 22,26
  function g(x, d) {
    if (!isNum(x)) return "—";
    if (d === undefined) d = 2;
    var s = num(x, d);
    if (s.indexOf(",") >= 0) s = s.replace(/0+$/, "").replace(/,$/, "");
    return s;
  }

  // «+ 5» или «− 5» для подстановки в формулу
  function signed(x, d) {
    return x < 0 ? "− " + g(-x, d) : "+ " + g(x, d);
  }

  function parse(text) {
    if (text === null || text === undefined) return null;
    var t = String(text).trim().replace(/\s+/g, "").replace(",", ".").replace("−", "-");
    if (t === "") return null;
    var v = Number(t);
    return isFinite(v) ? v : NaN;
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  return { isSet: isSet, isNum: isNum, num: num, g: g, signed: signed, parse: parse, esc: esc, clamp: clamp };
})();
