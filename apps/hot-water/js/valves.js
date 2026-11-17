'use strict';

/*
    Настроечные таблицы балансировочных клапанов. Две фирмы.

    VALTEC VT.054 — паспорт и руководство по эксплуатации ПС−7151−1.2, таблица 3
    «Настроечная таблица с гидравлическими характеристиками». Шкала 0…99 целыми,
    на положениях 0…3 пропускной способности нет: золотник там только выбирает
    упругость прокладки. Предельный перепад 500 кПа по условию шума (таблица 2).

    Ридан MVT-R2 DN15–50 — техническое описание RC.HE.88.03, 2024, таблица значений
    Kv при различных настройках. Шкала 0,0…8,0 десятыми: в окне рукоятки целые,
    в соседнем десятые. Ноль означает полное закрытие, 8,0 — это и есть Kvs.
    Предельный перепад 1,5 бар из технических характеристик.

    Методика подбора у обеих одна: Kvs = Q/√Δp, Q в м³/ч, Δp в барах,
    промежуточные значения интерполяцией.

    Шкалы разные не только по числам, но и по устройству: у VALTEC редкий ряд
    положений с мёртвой зоной, у Ридана сплошной ряд без неё. Поэтому и ряд
    положений, и шаг округления, и мёртвая зона — свойства самой модели,
    а не общие константы каталога.
*/

var ValveCatalog = (function () {

    /** Настроечные положения VALTEC, для которых паспорт даёт Kvs. */
    var valtecPositions = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65,
                           70, 75, 80, 85, 90, 95, 99];

    /** Настроечные положения Ридан: 0,0…8,0 шагом 0,1. */
    var ridanPositions = (function () {
        var list = [];
        for (var i = 0; i <= 80; i++)
            list.push(Math.round(i) / 10);
        return list;
    })();

    function make(fields) {
        if (fields.kv.length !== fields.positions.length)
            throw new Error('Настроечная таблица клапана ' + fields.article
                + ' не совпадает по длине с рядом положений: ' + fields.kv.length
                + ' против ' + fields.positions.length + '.');

        fields.maxKv = fields.kv[fields.kv.length - 1];
        fields.caption = fields.brand + ' ' + fields.family + ' ' + fields.size
            + ' (' + fields.article + ')';
        return fields;
    }

    /* --- VALTEC VT.054, паспорт ПС−7151−1.2, таблица 3 --- */

    function valtec(article, size, dn, lowFlow, kv) {
        return make({
            brand: 'VALTEC', family: 'VT.054', article: article, size: size,
            dn: dn, lowFlow: lowFlow,
            positions: valtecPositions, kv: kv,
            step: 1, deadBand: 3, maxDrop: 500000.0,
            dropNote: 'паспортный предел по шуму 500 кПа'
        });
    }

    /* --- Ридан MVT-R2, техническое описание RC.HE.88.03 --- */

    function ridan(article, size, dn, lowFlow, kv) {
        return make({
            brand: 'Ридан', family: 'MVT-R2', article: article, size: size,
            dn: dn, lowFlow: lowFlow,
            positions: ridanPositions, kv: kv,
            step: 0.1, deadBand: 0, maxDrop: 150000.0,
            dropNote: 'предел по техническим характеристикам 1,5 бар'
        });
    }

    var models = [
        // Порядок — по возрастанию пропускной способности, как в паспорте.
        valtec('VT.054.NLF.04', '1/2" Low Flow', 15, true, [
            0.00, 0.05, 0.15, 0.19, 0.27, 0.43, 0.62, 0.81, 1.00, 1.22, 1.43,
            1.63, 1.82, 1.99, 2.16, 2.35, 2.50, 2.68, 2.77, 2.82, 2.90
        ]),
        valtec('VT.054.N.04', '1/2"', 15, false, [
            0.00, 1.06, 1.43, 1.44, 1.69, 1.98, 2.21, 2.37, 2.52, 2.66, 2.84,
            3.03, 3.20, 3.40, 3.84, 4.01, 4.19, 4.25, 4.44, 4.52, 4.58
        ]),
        valtec('VT.054.N.05', '3/4"', 20, false, [
            0.00, 1.83, 2.02, 2.32, 2.60, 2.87, 2.99, 3.14, 3.25, 3.42, 3.50,
            3.75, 3.80, 4.19, 4.21, 4.34, 4.39, 4.47, 4.52, 4.59, 4.68
        ]),
        valtec('VT.054.N.06', '1"', 25, false, [
            0.00, 2.06, 2.77, 3.22, 3.54, 4.13, 4.48, 5.00, 5.20, 5.62, 5.78,
            6.30, 6.56, 6.95, 7.19, 7.64, 7.70, 8.20, 8.35, 8.96, 9.19
        ]),
        valtec('VT.054.N.07', '1 1/4"', 32, false, [
            0.00, 2.17, 4.75, 5.53, 6.08, 7.09, 7.70, 8.59, 8.92, 9.64, 9.92,
            10.80, 11.25, 11.92, 12.34, 13.10, 13.20, 14.06, 14.34, 15.37, 15.76
        ]),
        valtec('VT.054.N.08', '1 1/2"', 40, false, [
            0.00, 2.62, 3.01, 4.14, 5.06, 6.22, 7.59, 8.73, 10.28, 12.31, 13.33,
            14.34, 15.62, 16.45, 17.18, 18.00, 18.76, 19.85, 20.28, 20.75, 21.12
        ]),
        valtec('VT.054.N.09', '2"', 50, false, [
            0.00, 4.49, 5.16, 7.10, 8.68, 10.67, 13.02, 14.98, 17.63, 21.11, 22.78,
            24.60, 26.80, 28.21, 29.47, 30.87, 32.18, 34.05, 34.78, 35.55, 36.23
        ]),

        ridan('003Z4060R', 'DN15 Low Flow', 15, true, [
            0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.28, 0.32, 0.35, 0.39,
            0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.49, 0.51, 0.53, 0.54,
            0.56, 0.58, 0.59, 0.60, 0.62, 0.63, 0.64, 0.66, 0.67, 0.69,
            0.70, 0.72, 0.73, 0.74, 0.76, 0.77, 0.78, 0.80, 0.81, 0.83,
            0.84, 0.85, 0.87, 0.88, 0.89, 0.91, 0.92, 0.94, 0.95, 0.97,
            0.98, 1.00, 1.02, 1.03, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18,
            1.21, 1.27, 1.32, 1.38, 1.44, 1.49, 1.60, 1.70, 1.80, 1.90,
            2.00, 2.12, 2.24, 2.35, 2.47, 2.58, 2.68, 2.78, 2.88, 2.97,
            3.07
        ]),
        ridan('003Z4061R', 'DN15', 15, false, [
            0.00, 0.08, 0.15, 0.23, 0.30, 0.38, 0.42, 0.45, 0.49, 0.52,
            0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.75, 0.79, 0.84, 0.88,
            0.92, 0.95, 0.97, 1.00, 1.03, 1.06, 1.11, 1.17, 1.23, 1.29,
            1.34, 1.42, 1.50, 1.58, 1.66, 1.73, 1.84, 1.95, 2.06, 2.16,
            2.27, 2.39, 2.52, 2.64, 2.76, 2.89, 3.01, 3.13, 3.25, 3.37,
            3.49, 3.59, 3.68, 3.77, 3.86, 3.96, 4.00, 4.05, 4.10, 4.14,
            4.19, 4.23, 4.27, 4.32, 4.36, 4.40, 4.43, 4.47, 4.50, 4.53,
            4.57, 4.60, 4.64, 4.68, 4.72, 4.76, 4.80, 4.85, 4.90, 4.95,
            4.99
        ]),
        ridan('003Z4062R', 'DN20', 20, false, [
            0.00, 0.08, 0.17, 0.25, 0.34, 0.42, 0.46, 0.49, 0.53, 0.56,
            0.60, 0.63, 0.67, 0.70, 0.74, 0.77, 0.81, 0.84, 0.88, 0.91,
            0.95, 0.98, 1.01, 1.04, 1.07, 1.10, 1.16, 1.23, 1.29, 1.36,
            1.42, 1.53, 1.64, 1.74, 1.85, 1.96, 2.09, 2.22, 2.36, 2.49,
            2.62, 2.77, 2.92, 3.06, 3.21, 3.36, 3.52, 3.68, 3.83, 3.99,
            4.15, 4.25, 4.35, 4.44, 4.54, 4.64, 4.72, 4.80, 4.87, 4.95,
            5.03, 5.09, 5.14, 5.20, 5.25, 5.31, 5.36, 5.42, 5.47, 5.53,
            5.58, 5.61, 5.64, 5.67, 5.70, 5.73, 5.75, 5.77, 5.78, 5.80,
            5.82
        ]),
        ridan('003Z4063R', 'DN25', 25, false, [
            0.00, 0.09, 0.19, 0.28, 0.38, 0.47, 0.52, 0.57, 0.63, 0.68,
            0.73, 0.80, 0.87, 0.93, 1.00, 1.07, 1.13, 1.20, 1.26, 1.33,
            1.39, 1.48, 1.57, 1.65, 1.74, 1.83, 1.96, 2.08, 2.21, 2.33,
            2.46, 2.64, 2.83, 3.01, 3.20, 3.38, 3.58, 3.78, 3.99, 4.19,
            4.39, 4.57, 4.74, 4.92, 5.09, 5.27, 5.43, 5.60, 5.76, 5.93,
            6.09, 6.25, 6.42, 6.58, 6.75, 6.91, 7.07, 7.23, 7.38, 7.54,
            7.70, 7.85, 7.99, 8.14, 8.28, 8.43, 8.56, 8.69, 8.83, 8.96,
            9.09, 9.20, 9.31, 9.41, 9.52, 9.63, 9.67, 9.71, 9.74, 9.78,
            9.82
        ]),
        ridan('003Z4064R', 'DN32', 32, false, [
            0.00, 0.17, 0.34, 0.51, 0.68, 0.85, 0.98, 1.11, 1.25, 1.38,
            1.51, 1.74, 1.97, 2.20, 2.43, 2.66, 2.95, 3.25, 3.54, 3.84,
            4.13, 4.43, 4.74, 5.04, 5.35, 5.65, 5.93, 6.21, 6.50, 6.78,
            7.06, 7.32, 7.57, 7.83, 8.08, 8.34, 8.58, 8.82, 9.06, 9.30,
            9.54, 9.79, 10.03, 10.28, 10.52, 10.77, 10.98, 11.18, 11.39, 11.59,
            11.80, 11.99, 12.19, 12.38, 12.58, 12.77, 12.94, 13.11, 13.27, 13.44,
            13.61, 13.75, 13.90, 14.04, 14.19, 14.33, 14.48, 14.63, 14.78, 14.93,
            15.08, 15.19, 15.31, 15.42, 15.54, 15.65, 15.69, 15.74, 15.78, 15.83,
            15.87
        ]),
        ridan('003Z4065R', 'DN40', 40, false, [
            0.00, 0.23, 0.46, 0.68, 0.91, 1.14, 1.37, 1.59, 1.82, 2.04,
            2.27, 2.51, 2.75, 2.99, 3.23, 3.47, 3.75, 4.03, 4.30, 4.58,
            4.86, 5.20, 5.54, 5.88, 6.22, 6.56, 6.86, 7.16, 7.45, 7.75,
            8.05, 8.37, 8.68, 9.00, 9.31, 9.63, 9.93, 10.23, 10.54, 10.84,
            11.14, 11.47, 11.80, 12.12, 12.45, 12.78, 13.08, 13.39, 13.69, 14.00,
            14.30, 14.65, 15.00, 15.36, 15.71, 16.06, 16.36, 16.66, 16.95, 17.25,
            17.55, 17.87, 18.19, 18.52, 18.84, 19.16, 19.46, 19.75, 20.05, 20.34,
            20.64, 20.96, 21.27, 21.59, 21.90, 22.22, 22.37, 22.52, 22.68, 22.83,
            22.98
        ]),
        ridan('003Z4066R', 'DN50', 50, false, [
            0.00, 0.58, 1.16, 1.73, 2.31, 2.89, 3.15, 3.41, 3.67, 3.93,
            4.19, 4.61, 5.03, 5.44, 5.86, 6.28, 6.76, 7.24, 7.72, 8.20,
            8.68, 9.24, 9.80, 10.35, 10.91, 11.47, 12.00, 12.53, 13.05, 13.58,
            14.11, 14.68, 15.25, 15.82, 16.39, 16.96, 17.43, 17.91, 18.38, 18.86,
            19.33, 19.73, 20.14, 20.54, 20.95, 21.35, 21.74, 22.13, 22.51, 22.90,
            23.29, 23.67, 24.05, 24.42, 24.80, 25.18, 25.50, 25.82, 26.13, 26.45,
            26.77, 27.11, 27.44, 27.78, 28.11, 28.45, 28.75, 29.04, 29.34, 29.63,
            29.93, 30.23, 30.53, 30.82, 31.12, 31.42, 31.58, 31.75, 31.91, 32.08,
            32.24
        ])
    ];

    /** Фирмы в порядке появления. */
    var brands = (function () {
        var list = [];
        for (var i = 0; i < models.length; i++) {
            if (list.indexOf(models[i].brand) < 0)
                list.push(models[i].brand);
        }
        return list;
    })();

    return {
        Models: models,
        Brands: brands,

        /** Клапаны одной фирмы, в порядке возрастания пропускной способности. */
        ofBrand: function (brand) {
            var list = [];
            for (var i = 0; i < models.length; i++) {
                if (models[i].brand === brand) list.push(models[i]);
            }
            return list;
        },

        byArticle: function (article) {
            for (var i = 0; i < models.length; i++) {
                if (models[i].article === article) return models[i];
            }
            return null;
        },

        /** Положение полного открытия — последнее в ряду этой модели. */
        fullOpen: function (model) {
            return model.positions[model.positions.length - 1];
        },

        /** Настройка, записанная так, как её читают на рукоятке. */
        formatPosition: function (model, position) {
            if (!model) return '—';
            return model.step < 1 ? Fmt.fixed(position, 1) : Fmt.int(position);
        },

        /** Округление до цены деления шкалы этой модели. */
        roundPosition: function (model, position) {
            if (model.step >= 1) return Math.round(position);
            return Math.round(position / model.step) * model.step;
        },

        /**
         * Kv на произвольном настроечном положении, м³/ч.
         * Промежуточные значения находятся интерполяцией.
         */
        kvAt: function (model, position) {
            var positions = model.positions;
            var last = positions.length - 1;

            if (position <= model.deadBand) return 0.0;
            if (position >= positions[last]) return model.kv[last];

            /*
                У VALTEC между мёртвой зоной и первым табличным значением идёт
                своя прямая: от нуля на границе зоны до Kv первого положения.
                У Ридана мёртвой зоны нет, граница равна нулю, и та же формула
                превращается в обычную интерполяцию от нулевого положения.
            */
            if (position < positions[1]) {
                var share = (position - model.deadBand) / (positions[1] - model.deadBand);
                return model.kv[1] * share;
            }

            for (var i = 1; i < last; i++) {
                if (position <= positions[i + 1]) {
                    var span = positions[i + 1] - positions[i];
                    var part = (position - positions[i]) / span;
                    return model.kv[i] + (model.kv[i + 1] - model.kv[i]) * part;
                }
            }

            return model.kv[last];
        },

        /**
         * Настроечное положение, дающее заданный Kv. Возвращает −1, если клапан
         * такой пропускной способности не даёт даже полностью открытым.
         */
        positionFor: function (model, kv) {
            if (kv <= 0.0) return 0.0;

            var positions = model.positions;
            var last = positions.length - 1;

            if (kv > model.kv[last]) return -1.0;

            if (kv <= model.kv[1]) {
                var share = kv / model.kv[1];
                return model.deadBand + (positions[1] - model.deadBand) * share;
            }

            for (var i = 1; i < last; i++) {
                // Таблица местами не строго возрастает (VALTEC 1/2" на положениях
                // 10 и 15), поэтому берётся первый интервал, который значение накрывает.
                var low = model.kv[i];
                var high = model.kv[i + 1];

                if (kv > low && kv <= high) {
                    if (high - low < 1e-9) return positions[i + 1];

                    var part = (kv - low) / (high - low);
                    return positions[i] + (positions[i + 1] - positions[i]) * part;
                }
            }

            return positions[last];
        }
    };
})();

/*
    Подбор типоразмера и настроечного положения.

    Берётся самый узкий клапан выбранной фирмы, способный дать требуемую
    пропускную способность: у него настройка оказывается ближе к полному
    открытию, и точность настройки выше, чем у широкого клапана,
    приоткрытого на пару делений.
*/
var ValveSelector = (function () {

    /** Доля шкалы, ниже которой настройка слишком груба, чтобы на неё полагаться. */
    var LOW_SHARE = 0.10;

    /** Ниже этой доли шкалы настройка считается ненадёжной. */
    function lowPosition(model) {
        return ValveCatalog.fullOpen(model) * LOW_SHARE;
    }

    /*
        Исполнение Low Flow идёт в дело только когда даже самый маленький обычный
        клапан пришлось бы придушить до нижнего края шкалы. Просто «самый узкий»
        выбирал бы Low Flow всегда, а это отдельное исполнение, и ставить его
        там, где хватает обычного, незачем.
    */
    function choose(requiredKv, brand) {
        var catalogue = ValveCatalog.ofBrand(brand);
        if (catalogue.length === 0) catalogue = ValveCatalog.Models;

        var i, model, position;

        for (i = 0; i < catalogue.length; i++) {
            model = catalogue[i];
            if (model.lowFlow) continue;

            position = ValveCatalog.positionFor(model, requiredKv);
            if (position >= lowPosition(model)) return model;
        }

        for (i = 0; i < catalogue.length; i++) {
            model = catalogue[i];
            if (!model.lowFlow) continue;

            position = ValveCatalog.positionFor(model, requiredKv);
            if (position >= lowPosition(model)) return model;
        }

        // В рабочую часть шкалы не попал никто. Тогда берётся тот, у кого настройка
        // ближе всех к полному открытию: там цена деления меньше, а значит меньше
        // и ошибка при выставлении.
        var best = null;
        var bestShare = -1.0;

        for (i = 0; i < catalogue.length; i++) {
            model = catalogue[i];
            position = ValveCatalog.positionFor(model, requiredKv);

            var share = position / ValveCatalog.fullOpen(model);
            if (share > bestShare) {
                bestShare = share;
                best = model;
            }
        }

        return bestShare >= 0.0 ? best : null;
    }

    function describe(selection, pipeDN) {
        var notes = [];
        var model = selection.model;

        if (selection.position <= model.deadBand) {
            notes.push('настройка в мёртвой зоне шкалы: клапан закрыт, увязать им нельзя');
        } else if (selection.position < lowPosition(model)) {
            notes.push(model.lowFlow
                ? 'настройка у нижнего края шкалы даже на исполнении Low Flow — '
                    + 'требуемое сопротивление слишком велико для этого расхода'
                : 'настройка у нижнего края шкалы — деление стоит дорого, '
                    + 'точность выставления пострадает');
        }

        if (selection.actualDrop > model.maxDrop)
            notes.push('перепад выше допустимого для этого клапана: ' + model.dropNote);

        // Клапан заметно уже трубы — сужение допустимо, но его стоит увидеть.
        if (pipeDN > 0.0 && model.dn < pipeDN - 10.5) {
            notes.push('клапан на два типоразмера уже трубы Ду' + Fmt.fixed(pipeDN, 0)
                + ' — проверьте, приемлемо ли сужение');
        }

        return notes.join('; ');
    }

    /** Требуемая пропускная способность и пустой результат под неё. */
    function begin(flowKgPerHour, requiredDropPa) {
        var selection = {
            model: null, requiredKv: 0.0, exactPosition: 0.0,
            position: 0, actualKv: 0.0, actualDrop: 0.0,
            note: '', found: false, byHand: false
        };

        if (flowKgPerHour <= 1e-9 || requiredDropPa <= 1e-6) {
            selection.note = 'клапан не нужен';
            return selection;
        }

        var cubicMetresPerHour = flowKgPerHour / Water.Density;
        var bar = requiredDropPa / 1e5;

        selection.requiredKv = cubicMetresPerHour / Math.sqrt(bar);
        return selection;
    }

    /** Настройка выбранного типоразмера и то, что она даст на деле. */
    function fit(selection, model, flowKgPerHour, pipeDN) {
        var position = ValveCatalog.positionFor(model, selection.requiredKv);

        selection.model = model;
        selection.found = true;

        /*
            Положение −1 означает, что требуемая пропускная способность выше той,
            что клапан даёт полностью открытым. Подобрать тут нечего: он душит
            сильнее, чем нужно, при любой настройке. Открываем до конца и говорим
            об этом прямо — при ручном выборе это самая частая ошибка.
        */
        if (position < 0) {
            selection.exactPosition = ValveCatalog.fullOpen(model);
            selection.position = selection.exactPosition;
            selection.actualKv = model.maxKv;
            selection.actualDrop = Balancing.dropForKv(flowKgPerHour, selection.actualKv);
            selection.note = 'даже полностью открытым этот клапан душит сильнее, чем нужно '
                + 'для увязки (Kv ' + Fmt.kv(model.maxKv) + ' против требуемых '
                + Fmt.kv(selection.requiredKv) + ') — возьмите типоразмер крупнее';
            return selection;
        }

        selection.exactPosition = position;
        selection.position = ValveCatalog.roundPosition(model, position);

        // Ноль на шкале — полностью закрытый клапан. Даже самая малая настройка
        // должна оставлять хоть какой-то проход.
        if (selection.position <= 0)
            selection.position = model.step;

        selection.actualKv = ValveCatalog.kvAt(model, selection.position);
        selection.actualDrop = Balancing.dropForKv(flowKgPerHour, selection.actualKv);
        selection.note = describe(selection, pipeDN);

        return selection;
    }

    return {
        LowShare: LOW_SHARE,
        lowPosition: lowPosition,

        /** Подбор типоразмера и настройки программой, в пределах выбранной фирмы. */
        select: function (flowKgPerHour, requiredDropPa, pipeDN, brand) {
            var selection = begin(flowKgPerHour, requiredDropPa);
            if (selection.requiredKv <= 0.0) return selection;

            var model = choose(selection.requiredKv, brand || ValveCatalog.Brands[0]);
            if (!model) {
                selection.note = 'требуемая пропускная способность выше, чем у самого большого клапана '
                    + 'в каталоге — нужен другой типоразмер или другое решение по увязке';
                return selection;
            }

            return fit(selection, model, flowKgPerHour, pipeDN);
        },

        /**
         * Настройка заданного человеком типоразмера. Типоразмер не обсуждается —
         * считается только то, что он даст: положение, Kv на нём и настоящий перепад.
         * Так видно цену решения, а не только сам выбор.
         */
        selectArticle: function (flowKgPerHour, requiredDropPa, pipeDN, article, brand) {
            var model = ValveCatalog.byArticle(article);
            if (!model)
                return ValveSelector.select(flowKgPerHour, requiredDropPa, pipeDN, brand);

            var selection = begin(flowKgPerHour, requiredDropPa);
            selection.byHand = true;

            // Увязка не нужна, но клапан человек поставил: показываем его
            // полностью открытым, а не делаем вид, что его нет.
            if (selection.requiredKv <= 0.0) {
                selection.model = model;
                selection.position = ValveCatalog.fullOpen(model);
                selection.exactPosition = selection.position;
                selection.actualKv = model.maxKv;
                selection.note = 'увязка этим кольцом не требуется — клапан оставлен полностью открытым';
                return selection;
            }

            return fit(selection, model, flowKgPerHour, pipeDN);
        }
    };
})();
