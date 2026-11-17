'use strict';

/*
    Числа для интерфейса и отчёта.

    Внутри программы числа всегда с точкой, наружу — с запятой, как в Excel
    на русской локали. Граница проходит только здесь: смешение дало бы
    «0.0755» в одной ячейке и «0,0755» в соседней, и таблица, вставленная
    в Excel, превратилась бы наполовину в текст.
*/

var Fmt = (function () {

    var SUPER = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
                  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

    function valid(value) {
        return typeof value === 'number' && isFinite(value);
    }

    /** Фиксированное число знаков: 18 → «18,00». */
    function num(value, digits) {
        if (!valid(value)) return '—';

        var text = value.toFixed(digits);
        // «-0,00» после округления маленького отрицательного — это просто ноль.
        if (/^-0(\.0*)?$/.test(text)) text = text.substring(1);

        return text.replace('.', ',');
    }

    /** До заданного числа знаков, без хвостовых нулей: 3.20 → «3,2». */
    function trim(value, digits) {
        var text = num(value, digits);
        if (text === '—' || text.indexOf(',') < 0) return text;
        return text.replace(/0+$/, '').replace(/,$/, '');
    }

    /** Удельная характеристика: у Ду15 это 0,0755, у Ду200 — 204 577,35. */
    function kt(value) {
        if (!(value > 0)) return '—';
        return trim(value, value >= 100 ? 2 : value >= 1 ? 3 : 4);
    }

    /** Коэффициент узла управления: 3,858·10⁻⁸. */
    function sci(value) {
        if (!valid(value) || value === 0) return '0';

        var exponent = Math.floor(Math.log(Math.abs(value)) / Math.LN10);
        var mantissa = value / Math.pow(10, exponent);

        // 9,9999 после деления — это 10 со сдвигом порядка.
        if (Math.abs(mantissa) >= 9.99995) {
            mantissa /= 10;
            exponent += 1;
        }

        var power = String(exponent).split('').map(function (c) { return SUPER[c] || c; }).join('');
        return trim(mantissa, 4) + '·10' + power;
    }

    /**
     * Разбор ввода: «3,2», «3.2», « 3 200 », «3.858e-8». Пустое и мусор — null,
     * а не ноль: ноль в длине участка и пустая ячейка значат разное.
     */
    function parse(text) {
        if (typeof text === 'number') return valid(text) ? text : null;

        var clean = String(text === null || text === undefined ? '' : text)
            .replace(/\s+/g, '')
            .replace(',', '.');

        if (clean === '') return null;

        var value = Number(clean);
        return valid(value) ? value : null;
    }

    function html(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return {
        num: num,
        trim: trim,
        kt: kt,
        sci: sci,
        parse: parse,
        html: html
    };
})();
