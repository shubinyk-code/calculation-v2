/*
    Числа в русском инженерном виде: запятая вместо точки и столько знаков,
    сколько имеет смысл читать.

    Разрядность выбирается по величине, а не задаётся всюду одинаковой.
    Вероятность действия приборов — это 0,0081, и три знака после запятой
    превратили бы её в 0,008; расход в 15,73 м³/сут четырьмя знаками читать
    неудобно. Поэтому чем меньше число, тем больше знаков.
*/

var Format = (function () {
    'use strict';

    function num(value, digits) {
        if (value === null || value === undefined) return '—';
        if (typeof value !== 'number' || !isFinite(value)) return '—';

        if (digits === undefined) {
            var abs = Math.abs(value);

            if (abs === 0) digits = 0;
            else if (abs < 0.001) digits = 6;
            else if (abs < 0.01) digits = 5;
            else if (abs < 0.1) digits = 4;
            else if (abs < 10) digits = 3;
            else if (abs < 1000) digits = 2;
            else digits = 1;
        }

        return value.toFixed(digits).replace('.', ',');
    }

    /* Число для полей ввода — точка, без хвостовых нулей. */
    function plain(value) {
        if (typeof value !== 'number' || !isFinite(value)) return '';
        return String(Math.round(value * 1e6) / 1e6);
    }

    /* Читать поле ввода: запятая и точка равноправны, пусто — это ноль. */
    function parse(text, fallback) {
        if (text === null || text === undefined) return fallback;

        var value = parseFloat(String(text).replace(',', '.').trim());
        return isFinite(value) ? value : fallback;
    }

    function diameter(mm) {
        return 'Ø' + num(mm, 0);
    }

    function angle(deg) {
        return num(deg, deg === Math.round(deg) ? 0 : 1) + '°';
    }

    /* Экранирование для вставки в HTML: имена норм и приборов приходят из
       таблиц, а имена стояков вводит пользователь. */
    function html(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return {
        num: num,
        plain: plain,
        parse: parse,
        diameter: diameter,
        angle: angle,
        html: html
    };
})();
