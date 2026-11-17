'use strict';

/*
    Каталог трубопроводов и изоляций для выпадающих списков.

    В плагине эти числа приходят из Revit: наружный и внутренний диаметры трубы
    читаются параметрами RBS_PIPE_OUTER_DIAMETER и RBS_PIPE_INNER_DIAM_PARAM.
    Здесь модели нет, поэтому таблица задана явно.

    Оба диаметра нужны и отвечают за разное:
      внутренний — скорость и потери напора (Дарси — Вейсбах),
      наружный   — теплоотдача с поверхности (СП 61.13330 прил. Э).
    У стали они близки, у полипропилена внутренний много меньше наружного,
    и подменить один другим нельзя.

    Шероховатость и теплопроводность стенки берутся не отсюда, а из HeatLoss —
    по имени материала, ровно как в плагине. Поэтому имена материалов ниже
    подобраны так, чтобы те таблицы их узнавали.
*/

var PipeCatalog = (function () {

    /* Ряды заданы в миллиметрах: [Ду, наружный, толщина стенки]. */
    var groups = [
        {
            name: 'Сталь',
            materials: [
                {
                    name: 'Сталь ВГП ГОСТ 3262-75',
                    sizes: [
                        [15, 21.3, 2.8], [20, 26.8, 2.8], [25, 33.5, 3.2], [32, 42.3, 3.2],
                        [40, 48.0, 3.5], [50, 60.0, 3.5], [65, 75.5, 4.0], [80, 88.5, 4.0],
                        [100, 114.0, 4.5], [125, 140.0, 4.5], [150, 165.0, 4.5]
                    ]
                },
                {
                    name: 'Сталь ВГП оцинкованная ГОСТ 3262-75',
                    sizes: [
                        [15, 21.3, 2.8], [20, 26.8, 2.8], [25, 33.5, 3.2], [32, 42.3, 3.2],
                        [40, 48.0, 3.5], [50, 60.0, 3.5], [65, 75.5, 4.0], [80, 88.5, 4.0],
                        [100, 114.0, 4.5], [125, 140.0, 4.5], [150, 165.0, 4.5]
                    ]
                },
                {
                    name: 'Сталь электросварная ГОСТ 10704-91',
                    sizes: [
                        [50, 57.0, 3.0], [65, 76.0, 3.0], [80, 89.0, 3.5], [100, 108.0, 4.0],
                        [125, 133.0, 4.0], [150, 159.0, 4.5], [200, 219.0, 6.0]
                    ]
                }
            ]
        },
        {
            name: 'Нержавеющая сталь и медь',
            materials: [
                {
                    name: 'Нержавеющая сталь AISI 304 пресс',
                    sizes: [
                        [15, 15.0, 1.0], [18, 18.0, 1.0], [20, 22.0, 1.2], [25, 28.0, 1.2],
                        [32, 35.0, 1.5], [40, 42.0, 1.5], [50, 54.0, 1.5], [65, 76.1, 2.0],
                        [80, 88.9, 2.0], [100, 108.0, 2.0]
                    ]
                },
                {
                    name: 'Медь EN 1057',
                    sizes: [
                        [15, 15.0, 1.0], [18, 18.0, 1.0], [20, 22.0, 1.0], [25, 28.0, 1.5],
                        [32, 35.0, 1.5], [40, 42.0, 1.5], [50, 54.0, 2.0], [65, 76.1, 2.0],
                        [80, 88.9, 2.0]
                    ]
                }
            ]
        },
        {
            name: 'Полимеры',
            materials: [
                {
                    name: 'Полипропилен PP-R PN20',
                    sizes: [
                        [15, 20.0, 3.4], [20, 25.0, 4.2], [25, 32.0, 5.4], [32, 40.0, 6.7],
                        [40, 50.0, 8.3], [50, 63.0, 10.5], [65, 75.0, 12.5], [80, 90.0, 15.0],
                        [100, 110.0, 18.3]
                    ]
                },
                {
                    name: 'Полипропилен PP-R PN25 стекловолокно',
                    sizes: [
                        [15, 20.0, 2.8], [20, 25.0, 3.5], [25, 32.0, 4.4], [32, 40.0, 5.5],
                        [40, 50.0, 6.9], [50, 63.0, 8.6], [65, 75.0, 10.3], [80, 90.0, 12.3],
                        [100, 110.0, 15.1]
                    ]
                },
                {
                    name: 'Сшитый полиэтилен PEX-a',
                    sizes: [
                        [12, 16.0, 2.2], [15, 20.0, 2.8], [20, 25.0, 3.5], [25, 32.0, 4.4],
                        [32, 40.0, 5.5], [40, 50.0, 6.9], [50, 63.0, 8.6]
                    ]
                },
                {
                    name: 'Полиэтилен ПЭ100 SDR11',
                    sizes: [
                        [20, 25.0, 2.3], [25, 32.0, 3.0], [32, 40.0, 3.7], [40, 50.0, 4.6],
                        [50, 63.0, 5.8], [65, 75.0, 6.8], [80, 90.0, 8.2], [100, 110.0, 10.0]
                    ]
                }
            ]
        }
    ];

    /* Развёртка в плоский список: по имени материала — готовые размеры в метрах. */
    var byMaterial = {};
    var materialNames = [];

    for (var g = 0; g < groups.length; g++) {
        for (var m = 0; m < groups[g].materials.length; m++) {
            var material = groups[g].materials[m];
            var list = [];

            for (var s = 0; s < material.sizes.length; s++) {
                var row = material.sizes[s];
                var outerMm = row[1];
                var wallMm = row[2];
                var innerMm = outerMm - 2.0 * wallMm;

                list.push({
                    material: material.name,
                    nominalMm: row[0],
                    outerMm: outerMm,
                    wallMm: wallMm,
                    innerMm: innerMm,
                    outer: outerMm / 1000.0,
                    inner: innerMm / 1000.0,
                    /* Подпись в списке: «Ду32 (42,3×3,2)» — по ней размер и узнают. */
                    caption: 'Ду' + row[0] + '  (' + Fmt.num(outerMm) + '×' + Fmt.num(wallMm) + ')'
                });
            }

            byMaterial[material.name] = list;
            materialNames.push(material.name);
            material.group = groups[g].name;
        }
    }

    return {
        Groups: groups,
        MaterialNames: materialNames,

        /** Размеры выбранного материала. Неизвестный материал даёт пустой список. */
        sizesOf: function (materialName) {
            return byMaterial[materialName] || [];
        },

        /**
         * Размер по материалу и условному диаметру. Возвращает null, если такого
         * размера у материала нет: тогда участок остаётся с прежними числами,
         * а не получает молча чужой диаметр.
         */
        find: function (materialName, nominalMm) {
            var list = byMaterial[materialName];
            if (!list) return null;

            for (var i = 0; i < list.length; i++) {
                if (Math.abs(list[i].nominalMm - nominalMm) < 0.5)
                    return list[i];
            }
            return null;
        },

        /** Первый (самый узкий) размер материала — им заполняются новые участки. */
        first: function (materialName) {
            var list = byMaterial[materialName];
            return list && list.length > 0 ? list[0] : null;
        },

        /**
         * Ближайший по внутреннему диаметру размер того же материала. Нужен при
         * импорте: в модели диаметр бывает нестандартным, а список должен что-то
         * показать.
         */
        nearest: function (materialName, innerMetres) {
            var list = byMaterial[materialName];
            if (!list || list.length === 0) return null;

            var best = list[0];
            var bestDelta = Math.abs(best.inner - innerMetres);

            for (var i = 1; i < list.length; i++) {
                var delta = Math.abs(list[i].inner - innerMetres);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = list[i];
                }
            }
            return best;
        }
    };
})();

/*
    Изоляции. λ — справочные значения из InsulationFacts.LambdaByName плагина;
    толщины — ходовой ряд трубной изоляции.
*/
var InsulationCatalog = {
    Kinds: [
        { name: 'Нет изоляции', lambda: 0.0 },
        { name: 'Вспененный каучук (K-Flex, Armaflex)', lambda: 0.036 },
        { name: 'Вспененный полиэтилен (Энергофлекс)', lambda: 0.037 },
        { name: 'Пенополиуретан (ППУ)', lambda: 0.033 },
        { name: 'Пенополистирол', lambda: 0.038 },
        { name: 'Минеральная вата (базальт)', lambda: 0.045 }
    ],

    /** Ходовые толщины, мм. */
    Thicknesses: [6, 9, 13, 16, 19, 20, 25, 30, 32, 40, 50, 60, 80, 100],

    lambdaOf: function (name) {
        for (var i = 0; i < InsulationCatalog.Kinds.length; i++) {
            if (InsulationCatalog.Kinds[i].name === name)
                return InsulationCatalog.Kinds[i].lambda;
        }
        return 0.0;
    }
};
