/*
    Справочные данные вкладки «Гидравлика»: трубы, допустимые скорости, наборы
    приборов квартиры, умолчания опросника.

    Трубы взяты из HotWaterCirculationWeb/js/catalog.js (стали, нержавейка, PP-R,
    PEX-a, ПЭ100) и дополнены тем, что встречается в образцах ИОС2: нержавеющая
    сталь по ГОСТ 9941 (Ø38×3, 48×3, 57×3, 76×3, 108×3,5), PE-RT (Термолайн,
    63×10,5), ПЭ100 SDR17 на вводе (160×9,5). Сортаменты — ходовые, в проекте
    правятся прямо здесь: таблица лежит текстом-массивом, сборки не нужно.

    reserveMm — запас на внутренний диаметр (отложения). По подписям схемы
    образца: у стали и нержавейки расчётный d = dвн − 1 мм (Ø48×3 даёт 41 мм),
    у ПЭ100 на вводе запаса нет (160×9,5 → 141 мм). У полимерных стояков образца
    (63×10,5) подпись схемы соответствует d ≈ 41,2 мм вместо 42 — принят запас
    0,8 мм; значение условное и правится в опроснике.
*/

var HydData = (function () {
    'use strict';

    /* Ряды: [Ду, наружный, стенка], мм. formula: 'shevelev' — неновая сталь,
       'smooth' — гладкая труба (полимеры) по Колбруку; roughMm — для 'smooth'. */
    var MATERIALS = [
        {
            key: 'steel3262', name: 'Сталь ВГП ГОСТ 3262-75', cls: 'steel', formula: 'shevelev', reserveMm: 1.0, roughMm: 0.2,
            sizes: [[15, 21.3, 2.8], [20, 26.8, 2.8], [25, 33.5, 3.2], [32, 42.3, 3.2], [40, 48.0, 3.5],
                [50, 60.0, 3.5], [65, 75.5, 4.0], [80, 88.5, 4.0], [100, 114.0, 4.5], [125, 140.0, 4.5], [150, 165.0, 4.5]]
        },
        {
            key: 'steel10704', name: 'Сталь электросварная ГОСТ 10704-91', cls: 'steel', formula: 'shevelev', reserveMm: 1.0, roughMm: 0.2,
            sizes: [[50, 57.0, 3.0], [65, 76.0, 3.0], [80, 89.0, 3.5], [100, 108.0, 4.0], [125, 133.0, 4.0],
                [150, 159.0, 4.5], [200, 219.0, 6.0]]
        },
        {
            key: 'ss9941', name: 'Нержавеющая сталь ГОСТ 9941-81', cls: 'steel', formula: 'shevelev', reserveMm: 1.0, roughMm: 0.01,
            sizes: [[15, 20.0, 2.0], [20, 25.0, 2.0], [25, 32.0, 2.5], [32, 38.0, 3.0], [40, 48.0, 3.0],
                [50, 57.0, 3.0], [65, 76.0, 3.0], [80, 89.0, 3.5], [100, 108.0, 3.5], [125, 133.0, 4.0], [150, 159.0, 4.5]]
        },
        {
            key: 'ss304', name: 'Нержавеющая сталь AISI 304 пресс', cls: 'steel', formula: 'shevelev', reserveMm: 0, roughMm: 0.01,
            sizes: [[15, 15.0, 1.0], [20, 22.0, 1.2], [25, 28.0, 1.2], [32, 35.0, 1.5], [40, 42.0, 1.5],
                [50, 54.0, 1.5], [65, 76.1, 2.0], [80, 88.9, 2.0], [100, 108.0, 2.0]]
        },
        {
            key: 'pprc20', name: 'Полипропилен PP-R PN20', cls: 'polymer', formula: 'smooth', reserveMm: 0.8, roughMm: 0.007,
            sizes: [[15, 20.0, 3.4], [20, 25.0, 4.2], [25, 32.0, 5.4], [32, 40.0, 6.7], [40, 50.0, 8.3],
                [50, 63.0, 10.5], [65, 75.0, 12.5], [80, 90.0, 15.0], [100, 110.0, 18.3]]
        },
        {
            key: 'pprc25', name: 'Полипропилен PP-R PN25 стекловолокно', cls: 'polymer', formula: 'smooth', reserveMm: 0.8, roughMm: 0.007,
            sizes: [[15, 20.0, 2.8], [20, 25.0, 3.5], [25, 32.0, 4.4], [32, 40.0, 5.5], [40, 50.0, 6.9],
                [50, 63.0, 8.6], [65, 75.0, 10.3], [80, 90.0, 12.3], [100, 110.0, 15.1]]
        },
        {
            key: 'pert', name: 'PE-RT Термолайн ГОСТ Р 32415', cls: 'polymer', formula: 'smooth', reserveMm: 0.8, roughMm: 0.007,
            sizes: [[15, 20.0, 3.4], [20, 25.0, 4.2], [25, 32.0, 5.4], [32, 40.0, 6.7], [40, 50.0, 8.3],
                [50, 63.0, 10.5], [65, 75.0, 12.5], [80, 90.0, 15.0], [100, 110.0, 18.3]]
        },
        {
            key: 'pexa', name: 'Сшитый полиэтилен PEX-a', cls: 'polymer', formula: 'smooth', reserveMm: 0, roughMm: 0.007,
            sizes: [[12, 16.0, 2.2], [15, 20.0, 2.8], [20, 25.0, 3.5], [25, 32.0, 4.4], [32, 40.0, 5.5],
                [40, 50.0, 6.9], [50, 63.0, 8.6]]
        },
        {
            key: 'pe100s17', name: 'Полиэтилен ПЭ100 SDR17', cls: 'polymer', formula: 'smooth', reserveMm: 0, roughMm: 0.007,
            sizes: [[50, 63.0, 3.8], [65, 75.0, 4.5], [80, 90.0, 5.4], [100, 110.0, 6.6], [125, 125.0, 7.4],
                [125, 140.0, 8.3], [150, 160.0, 9.5], [200, 200.0, 11.9], [200, 225.0, 13.4]]
        },
        {
            key: 'pe100s11', name: 'Полиэтилен ПЭ100 SDR11', cls: 'polymer', formula: 'smooth', reserveMm: 0, roughMm: 0.007,
            sizes: [[20, 25.0, 2.3], [25, 32.0, 3.0], [32, 40.0, 3.7], [40, 50.0, 4.6], [50, 63.0, 5.8],
                [65, 75.0, 6.8], [80, 90.0, 8.2], [100, 110.0, 10.0]]
        }
    ];

    var byKey = {};
    var list;
    var i, k, m, row;

    for (i = 0; i < MATERIALS.length; i++) {
        m = MATERIALS[i];
        list = [];
        for (k = 0; k < m.sizes.length; k++) {
            row = m.sizes[k];
            list.push({
                material: m.key,
                dn: row[0], od: row[1], wall: row[2],
                di: Math.round((row[1] - 2 * row[2]) * 100) / 100,
                label: 'Ø' + String(row[1]).replace('.', ',') + '×' + String(row[2]).replace('.', ',')
            });
        }
        m.list = list;
        byKey[m.key] = m;
    }

    function material(key) { return byKey[key] || MATERIALS[0]; }
    function sizesOf(key) { return material(key).list; }

    /* Размер по материалу и наружному диаметру × стенке (как пишут на схеме). */
    function find(key, od, wall) {
        var l = sizesOf(key);
        for (var n = 0; n < l.length; n++) {
            if (Math.abs(l[n].od - od) < 0.05 && (wall === undefined || Math.abs(l[n].wall - wall) < 0.05)) return l[n];
        }
        return null;
    }

    /* --- допустимая скорость, приложение И СП 30.13330.2020 ------------------
       Строки — допустимый эквивалентный уровень шума, дБ; колонки — сумма
       коэффициентов местных сопротивлений подключения прибора или стояка с
       арматурой, приведённых к скорости в трубах. Пара: [кран, вентиль], м/с. */
    var APP_I_ZETA = [5, 10, 15, 20, 30];
    var APP_I = {
        25: [[1.5, 1.5], [1.1, 0.7], [0.9, 0.55], [0.75, 0.5], [0.6, 0.4]],
        30: [[1.5, 1.5], [1.5, 1.2], [1.2, 1.0], [1.0, 0.8], [0.85, 0.65]],
        35: [[1.5, 1.5], [1.5, 1.5], [1.5, 1.1], [1.2, 0.95], [1.0, 0.8]],
        40: [[1.5, 1.5], [1.5, 1.5], [1.5, 1.5], [1.5, 1.5], [1.3, 1.2]]
    };

    /*
        Предельная скорость по шуму. noiseDb > 40 — п. 8.26 а): 1,5 м/с в общественных,
        2 в административно-бытовых, 3 в производственных. valve: false — краны,
        true — вентили. zetaSum — сумма ζ арматуры (округляется вверх до колонки).
    */
    function vmaxByNoise(noiseDb, zetaSum, valve, buildingKind) {
        if (noiseDb > 40) {
            return buildingKind === 'industrial' ? 3 : (buildingKind === 'admin' ? 2 : 1.5);
        }
        var rows = [25, 30, 35, 40];
        var row = 25;
        for (var r = 0; r < rows.length; r++) if (noiseDb >= rows[r]) row = rows[r];
        var col = APP_I_ZETA.length - 1;
        for (var c = 0; c < APP_I_ZETA.length; c++) {
            if (zetaSum <= APP_I_ZETA[c]) { col = c; break; }
        }
        return APP_I[row][col][valve ? 1 : 0];
    }

    /* --- приборы квартиры -------------------------------------------------- */

    /* hot — подводится ли горячая вода. Смеситель считается и в ХВС, и в ГВС;
       унитаз с бачком и стиральная машина — только холодная. */
    var FIXTURES = [
        { id: 'sink', name: 'Мойка со смесителем', hot: true },
        { id: 'basin', name: 'Умывальник со смесителем', hot: true },
        { id: 'bath', name: 'Ванна со смесителем', hot: true },
        { id: 'shower', name: 'Душевая кабина со смесителем', hot: true },
        { id: 'bidet', name: 'Биде / гигиенический душ', hot: true },
        { id: 'wc', name: 'Унитаз со смывным бачком', hot: false },
        { id: 'washer', name: 'Стиральная машина', hot: false },
        { id: 'dishwasher', name: 'Посудомоечная машина', hot: false }
    ];

    function fixture(id) {
        for (var n = 0; n < FIXTURES.length; n++) if (FIXTURES[n].id === id) return FIXTURES[n];
        return FIXTURES[0];
    }

    /* Шаблоны квартиры — один щелчок в редакторе выхода. */
    var APARTMENT_SETS = [
        { id: 'std', name: 'Стандарт: мойка, умывальник, ванна, унитаз', fixtures: [['sink', 1], ['basin', 1], ['bath', 1], ['wc', 1]] },
        { id: 'stdw', name: 'Стандарт + стиральная машина', fixtures: [['sink', 1], ['basin', 1], ['bath', 1], ['wc', 1], ['washer', 1]] },
        { id: 'two', name: 'Два санузла + стиральная машина', fixtures: [['sink', 1], ['basin', 2], ['bath', 1], ['shower', 1], ['wc', 2], ['washer', 1]] },
        { id: 'studio', name: 'Студия: мойка, умывальник, душ, унитаз', fixtures: [['sink', 1], ['basin', 1], ['shower', 1], ['wc', 1]] }
    ];

    /* Люди по числу комнат. Формула п. 9 примечаний к таблице А.2 в тексте СП не
       распознана — по умолчанию K + 1, значения правятся в опроснике. */
    function defaultPeople() { return { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }; }

    /* --- умолчания опросника ----------------------------------------------- */

    function defaultSurvey() {
        return {
            objectName: '',
            height: 40,            // высота здания, м (> 75 — ветка записки для высотных)
            groundElev: 0,         // отметка чистого пола 1 этажа
            parking: 'none',       // none | underground | above
            pumpElev: -2.95,       // отметка оси насосов, м
            floorHeight: 3.0,
            inputs: [{ id: 'I1', name: 'Ввод 1', Hgar: 24, hv: 0.5, elev: -2.95, length: 12, material: 'pe100s17', od: 160, wall: 9.5 }],
            materials: { mains: 'ss9941', risers: 'pert', apartment: 'pexa' },
            vmax: { mains: 1.0, risers: 1.0, apartment: 1.5, input: 1.5 },
            noiseDb: 40,
            nu: { cold: 1.0, hot: 0.48 },     // кинематическая вязкость, 1e-6 м²/с
            kl: 0.3,               // п. 8.28: хоз-питьевые жилых и общественных
            hPr: 20,               // п. 8.21: свободный напор у диктующего прибора
            hNs: 3,                // потери в насосной станции
            hItp: 5,               // потери в ИТП
            hReg: 3,               // регулятор давления на квартиру
            regulators: true,
            hFilter: 0.3,          // фильтр у квартирного счётчика
            staticLimit: 45,       // п. 8.22
            zoneLimit: 60,         // предел гидростатического напора в зоне, м
            q0cEqualsQ0h: true
        };
    }

    return {
        MATERIALS: MATERIALS,
        material: material,
        sizesOf: sizesOf,
        find: find,
        APP_I: APP_I,
        APP_I_ZETA: APP_I_ZETA,
        vmaxByNoise: vmaxByNoise,
        FIXTURES: FIXTURES,
        fixture: fixture,
        APARTMENT_SETS: APARTMENT_SETS,
        defaultPeople: defaultPeople,
        defaultSurvey: defaultSurvey
    };
})();
