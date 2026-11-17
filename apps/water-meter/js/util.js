/* Общие мелочи: числа по-русски, разбор ввода, короткие обёртки над DOM. */
var U = (function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (html !== undefined && html !== null) e.innerHTML = html;
    return e;
  }

  /* Число с фиксированным количеством знаков, разделитель — запятая.
     Разряды не группируем: в таблицах подбора это только мешает. */
  function fmt(x, d) {
    if (x === null || x === undefined || typeof x !== "number" || !isFinite(x)) return "—";
    if (d === undefined) d = 2;
    var s = x.toFixed(d);
    if (/^-0[.,]?0*$/.test(s)) s = s.slice(1);
    return s.replace(".", ",");
  }

  /* Коэффициенты K и S живут в разных порядках (от 6944 до 0,000018),
     поэтому фиксированное число знаков не годится — убираем хвостовые нули. */
  function coef(x) {
    if (x === null || x === undefined || typeof x !== "number" || !isFinite(x)) return "—";
    var s = x.toFixed(10);
    s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (s === "" || s === "-") s = "0";
    return s.replace(".", ",");
  }

  /* На вводе принимаем и запятую, и точку: руки набирают то одно, то другое.
     Вернёт NaN, если строка не число. */
  function num(text) {
    if (text === null || text === undefined) return NaN;
    var s = String(text).trim().replace(/\s| /g, "").replace(",", ".");
    if (s === "") return NaN;
    if (!/^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /* В файле проекта числа храним с точкой, чтобы он не зависел от
     региональных настроек машины и открывался где угодно. */
  function store(x) {
    if (x === null || x === undefined || typeof x !== "number" || !isFinite(x)) return "";
    return String(x);
  }

  function restore(text) {
    if (text === null || text === undefined || text === "") return NaN;
    var v = parseFloat(String(text).replace(",", "."));
    return isFinite(v) ? v : NaN;
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Отдать файл пользователю. Blob и <a download> работают и с локального
     диска, и с сервера — ничего никуда не отправляется. */
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  var toastTimer = null;
  function toast(text) {
    var t = $("toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("on");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  return {
    $: $, el: el, fmt: fmt, coef: coef, num: num,
    store: store, restore: restore, esc: esc, download: download, toast: toast
  };
})();
