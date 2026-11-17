'use strict';

/*
    Мелочи, которыми пользуются все остальные файлы: разбор чисел с запятой,
    вывод чисел с запятой, округление до значащих цифр.

    Программа собирается без сборщика (см. README): обычные <script src>,
    глобальные объекты, никаких импортов.
*/

var U = (function () {

    /** «1,25» и «1.25» — одно и то же число; пустая строка — NaN. */
    function num(value) {
        if (typeof value === 'number') return value;
        if (value === null || value === undefined) return NaN;
        var s = String(value).trim().replace(/\s+/g, '').replace(',', '.');
        if (s === '') return NaN;
        var v = Number(s);
        return isFinite(v) ? v : NaN;
    }

    /** Число с фиксированным числом знаков и запятой вместо точки. */
    function fmt(value, digits) {
        if (value === null || value === undefined || !isFinite(value)) return '—';
        var d = (digits === undefined) ? 2 : digits;
        var s = Number(value).toFixed(d);
        if (s === '-' + (0).toFixed(d)) s = (0).toFixed(d);
        return s.replace('.', ',');
    }

    /** Точка вместо запятой — для DXF и прочих машинных форматов. */
    function dot(value, digits) {
        if (!isFinite(value)) return '0';
        return Number(value).toFixed(digits === undefined ? 3 : digits);
    }

    /** Столько знаков, сколько нужно для трёх значащих цифр, но не больше max. */
    function sig(value, max) {
        if (!isFinite(value)) return '—';
        var a = Math.abs(value);
        var d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
        if (max !== undefined && d > max) d = max;
        return fmt(value, d);
    }

    /** Линейная интерполяция по таблице [[x, y], ...]; за краями — край. */
    function interp(table, x) {
        if (!table || !table.length) return NaN;
        if (x <= table[0][0]) return table[0][1];
        var last = table.length - 1;
        if (x >= table[last][0]) return table[last][1];
        for (var i = 0; i < last; i++) {
            var x0 = table[i][0], x1 = table[i + 1][0];
            if (x >= x0 && x <= x1) {
                var t = (x1 === x0) ? 0 : (x - x0) / (x1 - x0);
                return table[i][1] + t * (table[i + 1][1] - table[i][1]);
            }
        }
        return table[last][1];
    }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    /** Экранирование для вставки в HTML. */
    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Дополнить строку пробелами справа (для колонок в текстовом отчёте). */
    function pad(s, n) {
        s = String(s);
        while (s.length < n) s += ' ';
        return s;
    }

    /** Дополнить пробелами слева. */
    function padl(s, n) {
        s = String(s);
        while (s.length < n) s = ' ' + s;
        return s;
    }

    /** Сохранить текст/байты файлом. */
    function save(name, data, mime) {
        var blob = (data instanceof Blob) ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    /** Сегодняшняя дата в виде 22.09.2026. */
    function today() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    return {
        num: num, fmt: fmt, dot: dot, sig: sig, interp: interp, clamp: clamp,
        esc: esc, pad: pad, padl: padl, save: save, today: today
    };
})();
