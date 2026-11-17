'use strict';

/*
    Чтение сети, выгруженной из Revit командой плагина
    «ГВС Циркуляция: выгрузка сети для браузера».

    Почему JSON, а не NWC. NWC — закрытый двоичный формат Navisworks, читать его
    в браузере нечем: открытого разбора не существует. Плагин же уже умеет всё,
    что нужно: собирает граф по коннекторам, сворачивает цепочки труб и фитингов
    в участки, читает диаметры, материал, изоляцию и имена систем. Выгрузить
    готовый результат надёжнее, чем восстанавливать его из геометрии заново.

    Участки приходят уже свёрнутыми — здесь они только раскладываются по системам,
    а недостающие связи достраиваются: сначала автоматически по допускам,
    потом руками там, где автоматика не справилась.
*/

var RevitImport = (function () {

    function roleOf(name, explicit) {
        if (explicit === 'Т3' || explicit === 3) return PipeRole.Supply;
        if (explicit === 'Т4' || explicit === 4) return PipeRole.Return;
        return SystemNaming.parse(name).role;
    }

    return {

        /** Разбор выгрузки в сеть. Бросает исключение, если файл не тот. */
        parse: function (plain, settings) {
            if (!plain || !plain.узлы || !plain.участки)
                throw new Error('Это не выгрузка сети из Revit: нет узлов или участков.');

            var network = new HwNetwork();
            var i;

            for (i = 0; i < plain.узлы.length; i++) {
                var raw = plain.узлы[i];
                var node = network.addNode(new Pt3(raw.x, raw.y, raw.z));
                node.hubElementId = raw.элемент || 0;
            }

            var unknownSystems = {};
            var unknownCount = 0;
            var guessedDiameters = 0;

            for (i = 0; i < plain.участки.length; i++) {
                var item = plain.участки[i];

                if (item.a === undefined || item.b === undefined) continue;
                if (item.a < 0 || item.b < 0) continue;
                if (item.a >= network.nodes.length || item.b >= network.nodes.length) continue;

                var segment = network.addSegment(item.a, item.b);

                segment.systemName = item.система || null;
                segment.role = roleOf(item.система, item.роль);
                segment.zoneKey = item.зона || SystemNaming.parse(item.система || '').zoneKey;

                // Связи, достроенные плагином, приходят флагами на самом участке,
                // а не отдельным списком: сводить список с участками по индексам
                // значило бы завести лишний повод разойтись.
                segment.isVirtualLink = !!item.виртуальный;
                segment.isRingClosure = !!item.замыкание;
                segment.length = item.длина || 0;
                segment.nominalDiameterMm = item.ду || 0;
                segment.outerDiameter = item.dн || 0;
                segment.innerDiameter = item.dвн || 0;
                segment.material = item.материал || null;
                segment.towelRailCount = item.полотенцесушители || 0;
                segment.elementIds = item.элементы || [];

                if (item.изоляция) {
                    segment.insulationName = item.изоляция.имя || null;
                    segment.insulationThickness = item.изоляция.толщина || 0;
                    segment.insulationLambda = item.изоляция.лямбда || 0;

                    // λ, не заданная в модели, — предмет проверки, а не данность.
                    if (segment.insulationLambda <= 0)
                        segment.insulationLambda = settings.defaultLambda;
                    if (!item.изоляция.изМодели)
                        segment.note = 'λ изоляции взята не из модели';
                } else {
                    segment.insulationName = 'нет';
                }

                if (item.ломаная) {
                    for (var k = 0; k < item.ломаная.length; k++) {
                        var p = item.ломаная[k];
                        segment.polyline.push(new Pt3(p[0], p[1], p[2]));
                    }
                }

                // Внутренний диаметр, равный наружному, означает, что в модели
                // его не было: считать по нему скорость нельзя не сказав об этом.
                if (segment.innerDiameter <= 0 || segment.innerDiameter >= segment.outerDiameter) {
                    var size = segment.material
                        ? PipeCatalog.nearest(segment.material, segment.nominalDiameterMm / 1000.0)
                        : null;

                    if (size) {
                        segment.outerDiameter = size.outer;
                        segment.innerDiameter = size.inner;
                    } else if (segment.nominalDiameterMm > 0) {
                        segment.outerDiameter = segment.nominalDiameterMm / 1000.0;
                        segment.innerDiameter = segment.nominalDiameterMm / 1000.0;
                    }
                    guessedDiameters++;
                }

                if (segment.role === PipeRole.None && segment.systemName
                    && !unknownSystems[segment.systemName]) {
                    unknownSystems[segment.systemName] = true;
                    unknownCount++;
                }
            }

            // Источники: выход Т3 и вход Т4 сливаются в один узел. До этого
            // в графе нет ни одного цикла и кольца не собираются вовсе.
            if (plain.источники) {
                for (i = 0; i < plain.источники.length; i++) {
                    var source = plain.источники[i];
                    RingFinder.setSource(network, source['т3'], source['т4']);
                }
            }

            var stitched = NetworkEdit.autoConnect(network, settings);

            var report = [];
            report.push('Прочитано узлов: ' + network.nodes.length
                + ', участков: ' + network.segments.length + '.');

            if (stitched.closures > 0 || stitched.stitches > 0) {
                report.push('Достроено автоматически: замыканий колец Т3–Т4 — '
                    + stitched.closures + ', сшивок разрывов — ' + stitched.stitches
                    + '. Самый широкий закрытый зазор ' + Fmt.fixed(stitched.widestGapMm, 1) + ' мм.');
            }

            if (unknownCount > 0) {
                report.push('Систем, в именах которых не нашлось ни Т3, ни Т4: ' + unknownCount
                    + '. Их участки в кольца не пойдут — проверьте имена систем в модели.');
            }

            if (guessedDiameters > 0) {
                report.push('Участков, где внутренний диаметр в модели не задан: ' + guessedDiameters
                    + '. Он подобран по каталогу — скорости и потери по ним стоит проверить.');
            }

            if (network.sourceNodes.length === 0) {
                report.push('В выгрузке нет ни одного выхода ИТП. Поставьте его инструментом «ИТП»: '
                    + 'без слияния выхода Т3 и входа Т4 в графе не появится ни одного цикла.');
            }

            return { network: network, report: report, name: plain.проект || 'Из Revit' };
        },

        /**
         * Пары свободных концов, не уложившиеся в допуск. Радиус поиска шире
         * самого допуска: поднимать общий порог ради одного забытого замыкания
         * нельзя, он тут же наловит ложных срабатываний по всей модели.
         */
        candidates: function (network, settings) {
            var radius = Math.min(2.0, settings.linkToleranceMm / 1000.0 * 25.0);
            return NetworkEdit.findCandidates(network, radius);
        }
    };
})();
