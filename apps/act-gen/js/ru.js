/* Русский язык: сумма прописью, обратный разбор, даты, деньги. Деньги считаем в копейках (целые числа). */
(function (g) {
  'use strict';

  var NBSP = String.fromCharCode(160);
  var SP = String.fromCharCode(32);

  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  /** Номер месяца (0..11) по русскому названию в любом падеже; -1 если не найден. */
  function monthIndex(word) {
    var w = String(word).toLowerCase().replace(/ё/g, 'е');
    for (var i = 0; i < 12; i++) {
      if (MONTHS_GEN[i] === w || MONTHS_NOM[i] === w) return i;
    }
    for (var j = 0; j < 12; j++) {
      var stem = MONTHS_NOM[j].replace(/[ьй]$/, '');
      if (w.indexOf(stem) === 0 && w.length - stem.length <= 3) return j;
    }
    return -1;
  }

  var ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  var ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  var TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  function plural(n, f1, f2, f5) {
    var a = n % 100;
    if (a >= 11 && a <= 19) return f5;
    var b = n % 10;
    if (b === 1) return f1;
    if (b >= 2 && b <= 4) return f2;
    return f5;
  }

  function triad(n, female) {
    var out = [];
    var h = Math.floor(n / 100), r = n % 100;
    if (h) out.push(HUNDREDS[h]);
    if (r >= 10 && r <= 19) out.push(TEENS[r - 10]);
    else {
      var t = Math.floor(r / 10), o = r % 10;
      if (t) out.push(TENS[t]);
      if (o) out.push((female ? ONES_F : ONES_M)[o]);
    }
    return out;
  }

  /** Целое неотрицательное число прописью (мужской род), до 999 999 999 999. */
  function intToWords(n) {
    if (n === 0) return 'ноль';
    var parts = [];
    var billions = Math.floor(n / 1e9) % 1000;
    var millions = Math.floor(n / 1e6) % 1000;
    var thousands = Math.floor(n / 1e3) % 1000;
    var rest = n % 1000;
    if (billions) parts = parts.concat(triad(billions, false), [plural(billions, 'миллиард', 'миллиарда', 'миллиардов')]);
    if (millions) parts = parts.concat(triad(millions, false), [plural(millions, 'миллион', 'миллиона', 'миллионов')]);
    if (thousands) parts = parts.concat(triad(thousands, true), [plural(thousands, 'тысяча', 'тысячи', 'тысяч')]);
    if (rest) parts = parts.concat(triad(rest, false));
    return parts.join(SP);
  }

  /** kopecks — целое число копеек. Результат вида «Двести пятьдесят тысяч рублей 00 копеек.» */
  function rubWords(kopecks) {
    var rub = Math.floor(kopecks / 100), kop = kopecks % 100;
    var s = intToWords(rub) + SP + plural(rub, 'рубль', 'рубля', 'рублей') + SP + (kop < 10 ? '0' : '') + kop + SP + plural(kop, 'копейка', 'копейки', 'копеек');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  var W_VAL = {
    'ноль': 0, 'нуль': 0, 'один': 1, 'одна': 1, 'одно': 1, 'два': 2, 'две': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9,
    'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18, 'девятнадцать': 19,
    'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50, 'шестьдесят': 60, 'семьдесят': 70, 'восемьдесят': 80, 'девяносто': 90,
    'сто': 100, 'двести': 200, 'триста': 300, 'четыреста': 400, 'пятьсот': 500, 'шестьсот': 600, 'семьсот': 700, 'восемьсот': 800, 'девятьсот': 900
  };
  var W_SCALE = { 'тысяча': 1e3, 'тысячи': 1e3, 'тысяч': 1e3, 'миллион': 1e6, 'миллиона': 1e6, 'миллионов': 1e6, 'миллиард': 1e9, 'миллиарда': 1e9, 'миллиардов': 1e9 };

  /** «сто двадцать тысяч» → 120000; NaN, если в тексте есть непонятные слова. Слова «рублей/копеек» и цифры пропускаются. */
  function wordsToInt(text) {
    var toks = String(text).toLowerCase().replace(/ё/g, 'е').split(/[^а-я0-9]+/).filter(Boolean);
    var total = 0, cur = 0, seen = false;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (/^\d+$/.test(t)) continue;
      if (/^(рубл|копе|руб$|коп$)/.test(t)) continue;
      if (Object.prototype.hasOwnProperty.call(W_VAL, t)) { cur += W_VAL[t]; seen = true; }
      else if (Object.prototype.hasOwnProperty.call(W_SCALE, t)) { total += (cur || 1) * W_SCALE[t]; cur = 0; seen = true; }
      else return NaN;
    }
    return seen ? total + cur : NaN;
  }

  /** 25000000 коп. → «250 000,00» (неразрывный пробел как разделитель разрядов). */
  function fmtMoney(kopecks) {
    var neg = kopecks < 0;
    if (neg) kopecks = -kopecks;
    var rub = Math.floor(kopecks / 100), kop = kopecks % 100;
    var s = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return (neg ? '-' : '') + s + ',' + (kop < 10 ? '0' : '') + kop;
  }

  /** «250 000,00» / «250000.5» → копейки; null, если не число. */
  function parseMoney(str) {
    var s = String(str).replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split('.');
    var rub = parseInt(parts[0], 10);
    var kop = parts[1] ? parseInt((parts[1] + '0').slice(0, 2), 10) : 0;
    return (rub < 0 || parts[0].charAt(0) === '-') ? rub * 100 - kop : rub * 100 + kop;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** {d,m(0..11),y} → «05 ноября 2026» */
  function dateWords(dt) { return pad2(dt.d) + SP + MONTHS_GEN[dt.m] + SP + dt.y; }
  function dateDots(dt) { return pad2(dt.d) + '.' + pad2(dt.m + 1) + '.' + dt.y; }
  function dateIso(dt) { return dt.y + '-' + pad2(dt.m + 1) + '-' + pad2(dt.d); }
  function fromIso(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }
  function today() { var n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; }

  g.RU = {
    NBSP: NBSP, SP: SP, MONTHS_GEN: MONTHS_GEN, monthIndex: monthIndex,
    intToWords: intToWords, rubWords: rubWords, wordsToInt: wordsToInt,
    fmtMoney: fmtMoney, parseMoney: parseMoney,
    dateWords: dateWords, dateDots: dateDots, dateIso: dateIso, fromIso: fromIso, today: today, pad2: pad2
  };
})(window);
