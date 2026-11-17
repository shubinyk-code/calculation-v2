'use strict';

/*
    Справочные таблицы.

    Трубы — лист «Удельн. хар-ки тр-в» рабочего калькулятора АПТ, дополненный
    строками СП 485.1311500.2020 табл. Б.2 из плагина SprinklerHydraulics.
    Где значения расходятся, взято значение калькулятора: 159×4 — 34 879,39
    (эмпирическая формула) против 34 880 по СП. Разница на пятом знаке, зато
    числа совпадают с Excel, по которому программу сверяют.

    Ключ подбора — пара (наружный диаметр, толщина стенки), а не условный
    проход: у Ду100 в ходу 108×2,8, 108×4 и 114×3, и Kт у них отличается
    в полтора раза.
*/

var Catalog = (function () {

    // [Ду, наружный, стенка, Kт]
    var RAW = [
        {
            key: 'ГОСТ10704',
            name: 'Сталь электросварная, ГОСТ 10704-91',
            sizes: [
                [15, 18, 2, 0.0755], [20, 25, 2, 0.75], [25, 32, 2.2, 3.44],
                [32, 40, 2.2, 13.97], [40, 45, 2.2, 28.7],
                [50, 57, 2.5, 110], [50, 57, 3, 99.53],
                [65, 76, 2.8, 572], [65, 76, 3, 554.57],
                [80, 89, 2.8, 1429], [80, 89, 3.5, 1304.2],
                [100, 108, 2.8, 4322], [100, 108, 3, 4231], [100, 108, 4, 3803.14],
                [100, 114, 2.8, 5872], [100, 114, 3, 5757],
                [125, 133, 3.2, 13530], [125, 133, 3.5, 13190], [125, 133, 4, 12637.68],
                [125, 140, 3.2, 18070],
                [150, 152, 3.2, 28690], [150, 159, 3.2, 36920],
                [150, 159, 4, 34879.39], [150, 159, 4.5, 33657],
                [200, 219, 4, 209900], [200, 219, 4.5, 204577.35],
                [250, 273, 4, 711300], [300, 325, 4, 1856000], [350, 377, 5, 4062000]
            ]
        },
        {
            key: 'ГОСТ3262',
            name: 'Сталь водогазопроводная, ГОСТ 3262-75',
            sizes: [
                [15, 21.3, 2.5, 0.18], [20, 26.8, 2.5, 0.926], [25, 33.5, 2.8, 3.65],
                [32, 42.3, 2.8, 16.5], [40, 48, 3, 34.5], [50, 60, 3, 135],
                [65, 75.5, 3.2, 517], [80, 88.5, 3.5, 1262], [90, 101, 3.5, 2725],
                [100, 114, 4, 5205], [125, 140, 4, 16940], [150, 165, 4, 43000]
            ]
        },
        {
            key: 'ПОТОК-FIREPROFF',
            name: 'Трубы ПОТОК-FIREPROFF',
            sizes: [
                [25, 25, 3.5, 2.533], [32, 32, 4.2, 9.597], [40, 40, 5.5, 31.55],
                [50, 50, 6.9, 103.396], [63, 63, 7.1, 413.826], [75, 75, 8.4, 1053.13],
                [90, 90, 10.1, 2780.99], [110, 110, 10, 9990.544], [110, 110, 12.3, 8129.267],
                [125, 125, 11.4, 19360.519], [140, 140, 12.7, 35125.969],
                [160, 160, 14.6, 69854.882], [180, 180, 10.7, 190151.958],
                [200, 200, 11.9, 328439.224], [225, 225, 13.4, 604954.304],
                [250, 250, 14.8, 1049524.698], [280, 280, 16.6, 1887418.459],
                [315, 315, 18.7, 3473031.975], [355, 355, 21.1, 6448417.079]
            ]
        },
        {
            key: 'Antifire SDR7.4',
            name: 'Трубы Antifire SDR 7,4',
            sizes: [
                [20, 20, 2.8, 0.37], [25, 25, 3.5, 1.32], [32, 32, 4.4, 4.88],
                [40, 40, 5.5, 18.9], [50, 50, 6.9, 49.43], [63, 63, 8.6, 165.26],
                [75, 75, 10.3, 287.3], [90, 90, 12.3, 865.7], [110, 110, 15.1, 2114],
                [125, 125, 17.1, 3480]
            ]
        },
        {
            key: 'Antifire SDR9',
            name: 'Трубы Antifire SDR 9',
            sizes: [
                [25, 25, 2.8, 1.56], [32, 32, 3.6, 5.502], [40, 40, 4.5, 17.395],
                [50, 50, 5.6, 55.671], [63, 63, 7.1, 187.38], [75, 75, 8.4, 466.037],
                [90, 90, 10.1, 1215.431], [110, 110, 12.3, 3451.693], [125, 125, 14, 6793.551]
            ]
        }
    ];

    var MATERIALS = RAW.map(function (m) {
        return {
            key: m.key,
            name: m.name,
            sizes: m.sizes.map(function (r) {
                return { dn: r[0], od: r[1], wall: r[2], kt: r[3] };
            })
        };
    });

    /*
        СП 485 табл. 6.1 (с Изм. 1, 2), колонки как в Группы.txt плагина.
        Для групп 5–7 интенсивность берётся из табл. 6.2/6.3 — здесь ноль,
        и её надо ввести руками.
    */
    var GROUPS = [
        { key: '1',   intensity: 0.08, area: 60,  minutes: 30, maxSpacing: 4,   name: '1 — библиотеки, музеи, магазины, гостиницы, больницы' },
        { key: '2',   intensity: 0.12, area: 120, minutes: 60, maxSpacing: 4,   name: '2 — производства, гаражи и стоянки' },
        { key: '3',   intensity: 0.24, area: 120, minutes: 60, maxSpacing: 4,   name: '3 — производство резинотехнических изделий' },
        { key: '4.1', intensity: 0.30, area: 180, minutes: 60, maxSpacing: 3.5, name: '4.1 — горючие волокна, окрасочные и сушильные камеры' },
        { key: '4.2', intensity: 0,    area: 180, minutes: 60, maxSpacing: 3,   name: '4.2 — компрессорные, обращение ЛВЖ и ГЖ (пена)' },
        { key: '5',   intensity: 0,    area: 90,  minutes: 60, maxSpacing: 3,   name: '5 — склады, табл. 6.2' },
        { key: '6',   intensity: 0,    area: 90,  minutes: 60, maxSpacing: 3,   name: '6 — склады, табл. 6.3' },
        { key: '7',   intensity: 0,    area: 90,  minutes: 60, maxSpacing: 3,   name: '7 — склады, табл. 6.3' }
    ];

    /* Узлы управления «Спецавтоматики» — лист «Доп. данные» калькулятора. */
    var CONTROL_UNITS = [
        { kind: 'Прямоточный', dn: 65,  xi: 5.8642e-7 },
        { kind: 'Прямоточный', dn: 80,  xi: 1.7625e-7 },
        { kind: 'Прямоточный', dn: 100, xi: 1.6975e-7 },
        { kind: 'Прямоточный', dn: 150, xi: 0.3858e-7 },
        { kind: 'Шалтан',      dn: 65,  xi: 15.27e-7 },
        { kind: 'Шалтан',      dn: 80,  xi: 5.79e-7 },
        { kind: 'Шалтан',      dn: 100, xi: 2.01e-7 },
        { kind: 'Шалтан',      dn: 150, xi: 0.39e-7 },
        { kind: 'Шалтан',      dn: 200, xi: 0.13e-7 },
        { kind: 'Воздушный',   dn: 100, xi: 2.3148e-7 },
        { kind: 'Воздушный',   dn: 150, xi: 0.4627e-7 }
    ];

    function material(key) {
        for (var i = 0; i < MATERIALS.length; i++) {
            if (MATERIALS[i].key === key) return MATERIALS[i];
        }
        return null;
    }

    function sizes(key) {
        var m = material(key);
        return m ? m.sizes : [];
    }

    /** Строка таблицы по материалу и паре (наружный, стенка). */
    function find(key, od, wall) {
        var list = sizes(key);
        for (var i = 0; i < list.length; i++) {
            if (Math.abs(list[i].od - od) <= 0.15 && Math.abs(list[i].wall - wall) <= 0.05) {
                return list[i];
            }
        }
        return null;
    }

    function inner(od, wall) {
        return od - 2 * wall;
    }

    /*
        Эмпирическая формула калькулятора: Kт = 10⁻¹⁰·864,6122·(Dвн − 1)^5,3333.
        Против значений СП отклоняется на 0…0,6 %, поэтому идёт только тогда,
        когда размера нет в таблице, и участок об этом помечается.
    */
    function ktFormula(dIn) {
        if (!(dIn > 1)) return 0;
        return 1e-10 * 864.6122 * Math.pow(dIn - 1, 5.3333);
    }

    /** Характеристики трубы участка: Kт, внутренний диаметр, Ду и откуда взято Kт. */
    function pipe(segment) {
        var dIn = inner(segment.od, segment.wall);
        var row = find(segment.material, segment.od, segment.wall);

        if (segment.kt > 0) {
            return { kt: segment.kt, dIn: dIn, dn: row ? row.dn : null, source: 'manual' };
        }

        if (row) {
            return { kt: row.kt, dIn: dIn, dn: row.dn, source: 'table' };
        }

        var kt = ktFormula(dIn);
        return { kt: kt, dIn: dIn, dn: null, source: kt > 0 ? 'formula' : 'none' };
    }

    function sizeLabel(row) {
        return 'Ду' + row.dn + ' · ' + String(row.od).replace('.', ',') + '×' + String(row.wall).replace('.', ',');
    }

    function group(key) {
        for (var i = 0; i < GROUPS.length; i++) {
            if (GROUPS[i].key === String(key)) return GROUPS[i];
        }
        return null;
    }

    function cuXi(kind, dn) {
        for (var i = 0; i < CONTROL_UNITS.length; i++) {
            var u = CONTROL_UNITS[i];
            if (u.kind === kind && Math.abs(u.dn - dn) < 0.5) return u.xi;
        }
        return 0;
    }

    function cuKinds() {
        var kinds = [];
        CONTROL_UNITS.forEach(function (u) {
            if (kinds.indexOf(u.kind) < 0) kinds.push(u.kind);
        });
        return kinds;
    }

    function cuSizes(kind) {
        return CONTROL_UNITS.filter(function (u) { return u.kind === kind; })
            .map(function (u) { return u.dn; });
    }

    return {
        MATERIALS: MATERIALS,
        GROUPS: GROUPS,
        CONTROL_UNITS: CONTROL_UNITS,
        material: material,
        sizes: sizes,
        find: find,
        inner: inner,
        ktFormula: ktFormula,
        pipe: pipe,
        sizeLabel: sizeLabel,
        group: group,
        cuXi: cuXi,
        cuKinds: cuKinds,
        cuSizes: cuSizes
    };
})();
