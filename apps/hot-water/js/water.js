'use strict';

/*
    Свойства воды при расчётных температурах ГВС (60–65 °C) и форматирование чисел.

    Значения перенесены из HotWaterCirculation/src/Format.cs без изменений: числа
    в браузере обязаны совпадать с числами плагина, а плотность и теплоёмкость
    входят в каждую формулу расчёта.
*/

var Water = {
    /** Плотность, кг/м³. */
    Density: 983.0,

    /** Удельная теплоёмкость, кДж/(кг·К). Значение из методики расчёта циркуляции. */
    HeatCapacity: 4.19,

    /** Кинематическая вязкость при 60 °C, м²/с — нужна для числа Рейнольдса. */
    Viscosity: 0.478e-6,

    /** Ускорение свободного падения, м/с² — для перевода перепада в метры водяного столба. */
    G: 9.80665
};

/** Удельная теплоёмкость воды, Дж/(кг·К). */
var HEAT_CAPACITY_J = Water.HeatCapacity * 1000.0;

/*
    Форматирование. Числа выводятся русской локалью: так их принимает Excel,
    когда таблицу вставляют из буфера обмена.
*/
var Fmt = {
    _fix: function (value, digits) {
        if (value === null || value === undefined || !isFinite(value))
            return '—';
        return value.toFixed(digits).replace('.', ',');
    },

    /** Произвольное число, до трёх знаков, без хвостовых нулей. */
    num: function (value) {
        if (value === null || value === undefined || !isFinite(value))
            return '—';
        var text = (Math.round(value * 1000) / 1000).toString();
        return text.replace('.', ',');
    },

    fixed: function (value, digits) { return Fmt._fix(value, digits); },
    int: function (value) { return String(Math.round(value)); },

    /** Длина в метрах. */
    length: function (metres) { return Fmt._fix(metres, 2); },

    watts: function (w) { return Fmt._fix(w, 0); },
    kilowatts: function (w) { return Fmt._fix(w / 1000.0, 3); },

    /** Удельный тепловой поток, Вт/м. */
    heatFlux: function (wattsPerMetre) { return Fmt._fix(wattsPerMetre, 1); },

    /** Расход в л/с — единица, в которой расход показывается в таблицах и на схемах. */
    flowLs: function (kgPerHour) {
        return Fmt._fix(kgPerHour / 3600.0 / Water.Density * 1000.0, 4);
    },

    /** Расход в кг/ч. Внутри расчёт ведётся именно в них: Q = c·G·Δt требует массового расхода. */
    flowKgH: function (kgPerHour) { return Fmt._fix(kgPerHour, 1); },

    /** Расход в м³/ч — в них паспорта арматуры дают Kv. */
    flowM3H: function (kgPerHour) { return Fmt._fix(kgPerHour / Water.Density, 3); },

    velocity: function (mps) { return Fmt._fix(mps, 2); },
    temperature: function (celsius) { return Fmt._fix(celsius, 2); },

    /** Перепад в килопаскалях. */
    pressure: function (pascals) { return Fmt._fix(pascals / 1000.0, 2); },

    /** Перепад в барах — в них паспорта арматуры дают Kv. */
    bar: function (pascals) { return Fmt._fix(pascals / 1e5, 4); },

    /*
        Перепад в метрах водяного столба. Считается по настоящей плотности горячей
        воды, а не по 1000 кг/м³: это тот напор, который должен развить насос.
    */
    head: function (pascals) { return Fmt._fix(pascals / (Water.Density * Water.G), 3); },

    percent: function (fraction) { return Fmt._fix(fraction * 100.0, 1); },

    /** Kv балансировочного клапана, м³/ч при перепаде 1 бар. */
    kv: function (value) { return Fmt._fix(value, 3); },

    /** Расход из кг/ч в л/с числом, а не строкой. */
    toLs: function (kgPerHour) { return kgPerHour / 3600.0 / Water.Density * 1000.0; },

    /** Перепад из Па в метры водяного столба числом. */
    toHead: function (pascals) { return pascals / (Water.Density * Water.G); },

    plural: function (count, one, few, many) {
        var tens = count % 100;
        if (tens >= 11 && tens <= 14) return many;
        switch (count % 10) {
            case 1: return one;
            case 2:
            case 3:
            case 4: return few;
            default: return many;
        }
    }
};
