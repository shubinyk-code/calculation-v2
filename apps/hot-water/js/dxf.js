'use strict';

/*
    Выгрузка схемы в DXF — чтобы её можно было вставить в чертёж, а не только
    посмотреть картинкой.

    ФОРМАТ. DXF R12, самый простой и самый всеядный: его читают и AutoCAD,
    и nanoCAD, и Revit, и все вьюеры. Из сущностей используются только LINE,
    CIRCLE и TEXT — ничего, что в R12 появилось позже.

    КОДИРОВКА. Не UTF-8, а CP1251, и в заголовке стоит $DWGCODEPAGE ANSI_1251.
    Причина простая: R12 про Юникод не знает, и русский текст в UTF-8 читается
    кракозябрами. Поэтому файл собирается байтами, а не строкой, — см. cp1251().

    Греческих букв в подписях нет намеренно: λ, Δ и α в CP1251 отсутствуют,
    и вместо них вышли бы вопросительные знаки. Там, где в таблицах стоит Δp,
    в чертёж идёт «dP».

    ЕДИНИЦЫ. Миллиметры — так чертят. Модель хранится в метрах, поэтому всё
    умножается на 1000. Высота текста взята 250 мм: это 2,5 мм на листе
    при масштабе 1:100, то есть нормальный читаемый размер. Для другого
    масштаба текст масштабируется вместе со схемой.
*/

var Dxf = (function () {

    var MM = 1000.0;              // метры модели в миллиметры чертежа
    var TEXT_HEIGHT = 250.0;      // мм, 2,5 мм при 1:100
    var NODE_RADIUS = 120.0;      // мм
    var SOURCE_RADIUS = 300.0;    // мм

    /*
        Имена слоёв латиницей. Русские имена слоёв формально допустимы,
        но на них спотыкается то обмен между версиями, то сторонние вьюеры,
        а переименовать слой в чертеже — дело одной минуты.
    */
    var LAYERS = [
        { name: 'GVS-T3',      colour: 1, about: 'подающие Т3' },
        { name: 'GVS-T4',      colour: 5, about: 'циркуляционные Т4' },
        { name: 'GVS-LINK',    colour: 3, about: 'перемычки Т3-Т4' },
        { name: 'GVS-ITP',     colour: 6, about: 'ИТП' },
        { name: 'GVS-VALVE',   colour: 2, about: 'балансировочные клапаны' },
        { name: 'GVS-NODE',    colour: 8, about: 'узлы' },
        { name: 'GVS-TEXT',    colour: 7, about: 'подписи' },
        { name: 'GVS-LEGEND',  colour: 7, about: 'условные обозначения' }
    ];

    /* --- CP1251 ------------------------------------------------------------ */

    /*
        Отдельные знаки, которые в CP1251 есть, но лежат не там, где в Юникоде.
        Всё, чего нет вовсе, заменяется вопросительным знаком — пусть будет
        видно, что знак потерян, чем молча съеден.
    */
    var SINGLES = {
        0x0401: 0xA8,   // Ё
        0x0451: 0xB8,   // ё
        0x00B0: 0xB0,   // °
        0x2116: 0xB9,   // №
        0x2014: 0x97,   // —
        0x2013: 0x96,   // –
        0x00AB: 0xAB,   // «
        0x00BB: 0xBB,   // »
        0x2026: 0x85,   // …
        0x00A0: 0x20    // неразрывный пробел — обычным
    };

    function cp1251(text) {
        var bytes = [];

        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);

            if (code < 0x80) { bytes.push(code); continue; }
            if (SINGLES[code] !== undefined) { bytes.push(SINGLES[code]); continue; }

            // Основной блок кириллицы А…я лежит в CP1251 подряд, с 0xC0.
            if (code >= 0x0410 && code <= 0x044F) {
                bytes.push(code - 0x0410 + 0xC0);
                continue;
            }

            bytes.push(0x3F);   // '?'
        }

        return bytes;
    }

    /* --- сборка файла ----------------------------------------------------- */

    function Writer() {
        this.lines = [];
    }

    /** Пара «код группы — значение», как и устроен весь DXF. */
    Writer.prototype.pair = function (code, value) {
        this.lines.push(String(code));
        this.lines.push(String(value));
        return this;
    };

    /** Число с точкой-разделителем: DXF русской запятой не понимает. */
    Writer.prototype.number = function (code, value) {
        return this.pair(code, (Math.round(value * 1000) / 1000).toFixed(3));
    };

    Writer.prototype.line = function (layer, a, b) {
        this.pair(0, 'LINE').pair(8, layer)
            .number(10, a.x).number(20, a.y).number(30, a.z || 0)
            .number(11, b.x).number(21, b.y).number(31, b.z || 0);
        return this;
    };

    Writer.prototype.circle = function (layer, centre, radius) {
        this.pair(0, 'CIRCLE').pair(8, layer)
            .number(10, centre.x).number(20, centre.y).number(30, centre.z || 0)
            .number(40, radius);
        return this;
    };

    Writer.prototype.text = function (layer, at, height, value) {
        this.pair(0, 'TEXT').pair(8, layer)
            .number(10, at.x).number(20, at.y).number(30, at.z || 0)
            .number(40, height).pair(1, value);
        return this;
    };

    Writer.prototype.toBytes = function () {
        var bytes = [];

        for (var i = 0; i < this.lines.length; i++) {
            var part = cp1251(this.lines[i]);
            for (var k = 0; k < part.length; k++) bytes.push(part[k]);
            bytes.push(0x0D);
            bytes.push(0x0A);
        }

        return new Uint8Array(bytes);
    };

    function header(writer) {
        writer.pair(0, 'SECTION').pair(2, 'HEADER');

        writer.pair(9, '$ACADVER').pair(1, 'AC1009');
        writer.pair(9, '$DWGCODEPAGE').pair(3, 'ANSI_1251');

        // Единицы — миллиметры. Без этого вставка в чертёж приезжает
        // в неизвестном масштабе и её приходится угадывать.
        writer.pair(9, '$INSUNITS').pair(70, 4);

        writer.pair(0, 'ENDSEC');
    }

    function tables(writer) {
        writer.pair(0, 'SECTION').pair(2, 'TABLES');
        writer.pair(0, 'TABLE').pair(2, 'LAYER').pair(70, LAYERS.length);

        for (var i = 0; i < LAYERS.length; i++) {
            writer.pair(0, 'LAYER').pair(2, LAYERS[i].name)
                .pair(70, 0).pair(62, LAYERS[i].colour).pair(6, 'CONTINUOUS');
        }

        writer.pair(0, 'ENDTAB').pair(0, 'ENDSEC');
    }

    /* --- геометрия -------------------------------------------------------- */

    function layerOf(segment) {
        if (segment.isVirtualLink || segment.role === PipeRole.None) return 'GVS-LINK';
        return segment.role === PipeRole.Supply ? 'GVS-T3' : 'GVS-T4';
    }

    /**
     * Точки участка в координатах чертежа, в миллиметрах.
     *
     * На плоской схеме берутся её собственные координаты, в трёхмерной —
     * настоящие, вместе с ломаной: отвод, который на схеме срезан хордой,
     * в чертеже должен быть отводом.
     */
    function wayOf(network, segment, flat) {
        var a = network.nodes[segment.nodeA];
        var b = network.nodes[segment.nodeB];

        if (flat) {
            return [
                { x: a.pointFlat.x * MM, y: a.pointFlat.y * MM, z: 0 },
                { x: b.pointFlat.x * MM, y: b.pointFlat.y * MM, z: 0 }
            ];
        }

        if (!segment.polyline || segment.polyline.length < 3) {
            return [
                { x: a.point3d.x * MM, y: a.point3d.y * MM, z: a.point3d.z * MM },
                { x: b.point3d.x * MM, y: b.point3d.y * MM, z: b.point3d.z * MM }
            ];
        }

        var points = [];
        for (var i = 0; i < segment.polyline.length; i++) {
            points.push({
                x: segment.polyline[i].x * MM,
                y: segment.polyline[i].y * MM,
                z: segment.polyline[i].z * MM
            });
        }

        return points;
    }

    function pointOf(network, index, flat) {
        var node = network.nodes[index];
        if (!node) return null;

        return flat
            ? { x: node.pointFlat.x * MM, y: node.pointFlat.y * MM, z: 0 }
            : { x: node.point3d.x * MM, y: node.point3d.y * MM, z: node.point3d.z * MM };
    }

    /** Самое длинное звено ломаной — там и место подписи. */
    function longest(way) {
        var best = 1;
        var bestLength = -1;

        for (var i = 1; i < way.length; i++) {
            var dx = way[i].x - way[i - 1].x;
            var dy = way[i].y - way[i - 1].y;
            var dz = way[i].z - way[i - 1].z;
            var length = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (length > bestLength) { bestLength = length; best = i; }
        }

        return {
            x: (way[best].x + way[best - 1].x) / 2.0,
            y: (way[best].y + way[best - 1].y) / 2.0,
            z: (way[best].z + way[best - 1].z) / 2.0
        };
    }

    /*
        Подпись участка. Состав — тот же, что включён галочками на схеме:
        что человек видит на экране, то и уходит в чертёж. Иначе пришлось бы
        держать второй набор настроек и объяснять, чем он отличается.
    */
    function captionOf(segment, network) {
        var parts = [];

        if (LabelOptions.segmentNumbers) parts.push(String(segment.number || segment.index + 1));
        if (LabelOptions.diameters && segment.nominalDiameterMm > 0)
            parts.push('Ду' + Fmt.fixed(segment.nominalDiameterMm, 0));
        if (LabelOptions.lengths && segment.length > 0)
            parts.push(Fmt.length(segment.length) + ' м');
        if (LabelOptions.flows && segment.flow > 0)
            parts.push(Fmt.flowLs(segment.flow) + ' л/с');
        if (LabelOptions.velocities && segment.velocity > 0)
            parts.push(Fmt.velocity(segment.velocity) + ' м/с');
        if (LabelOptions.temperatures && segment.temperatureOut > 0)
            parts.push(Fmt.temperature(segment.temperatureOut) + '°C');

        return parts.join('  ');
    }

    function ringsOf(network, segment) {
        var numbers = [];
        for (var i = 0; i < network.rings.length; i++) {
            if (network.rings[i].segments.indexOf(segment.index) >= 0)
                numbers.push(network.rings[i].number);
        }
        return numbers;
    }

    /* --- условные обозначения --------------------------------------------- */

    /*
        Легенда и шапка. Ставятся слева снизу от схемы, со отступом: вставлять
        их внутрь схемы нельзя — они налезут на трубы, а переносить потом
        в чертеже неудобно.
    */
    function legend(writer, app, bounds, flat) {
        var step = TEXT_HEIGHT * 2.0;
        var x = bounds.minX;
        var y = bounds.minY - step * 3.0;

        var zone = app.zoneFilter ? app.network.zone(app.zoneFilter) : null;
        var lines = [];

        lines.push((app.projectName || 'Без названия') + ' — '
            + (flat ? 'принципиальная схема ГВС' : 'схема ГВС, трёхмерная'));
        lines.push('Системы: ' + (zone ? zone.caption : 'все'));

        if (zone) {
            lines.push('Расход ' + Fmt.flowLs(zone.flow) + ' л/с, колец '
                + zone.rings.length + ', теплопотери ' + Fmt.kilowatts(zone.heatLoss) + ' кВт');
            lines.push('Напор насоса ' + Fmt.head(zone.worstDrop) + ' м вод. ст. ('
                + Fmt.pressure(zone.worstDrop) + ' кПа), худшее кольцо № '
                + zone.worstRingNumber);
            lines.push('Обратка на ИТП ' + Fmt.temperature(zone.returnTemperature)
                + '°C, подогрев ' + Fmt.num(zone.itpDeltaT) + ' К');
        }

        lines.push('');
        lines.push('Слои:');
        for (var i = 0; i < LAYERS.length; i++)
            lines.push('    ' + LAYERS[i].name + ' — ' + LAYERS[i].about);

        for (i = 0; i < lines.length; i++) {
            if (lines[i] === '') continue;
            writer.text('GVS-LEGEND', { x: x, y: y - i * step, z: 0 },
                        TEXT_HEIGHT, lines[i]);
        }
    }

    function boundsOf(network, flat) {
        var box = { minX: 0, minY: 0, maxX: 0, maxY: 0, empty: true };

        for (var i = 0; i < network.nodes.length; i++) {
            var point = pointOf(network, i, flat);
            if (!point) continue;

            if (box.empty) {
                box.minX = box.maxX = point.x;
                box.minY = box.maxY = point.y;
                box.empty = false;
                continue;
            }

            if (point.x < box.minX) box.minX = point.x;
            if (point.x > box.maxX) box.maxX = point.x;
            if (point.y < box.minY) box.minY = point.y;
            if (point.y > box.maxY) box.maxY = point.y;
        }

        return box;
    }

    return {
        Layers: LAYERS,
        toCp1251: cp1251,

        /**
         * Схема в DXF. mode — 'flat' или '3d'.
         *
         * Фильтр по системам соблюдается: если наверху выбрана одна система,
         * в чертёж уходит она одна. Это и нужно — на листе обычно одна система.
         */
        build: function (app, mode) {
            var network = app.network;
            var flat = mode !== '3d';
            var writer = new Writer();

            header(writer);
            tables(writer);

            writer.pair(0, 'SECTION').pair(2, 'ENTITIES');

            var i, k;

            // --- трубы ---
            for (i = 0; i < network.segments.length; i++) {
                var segment = network.segments[i];
                if (!app.accepts(segment)) continue;
                if (segment.isSourceLink) continue;      // связь внутри ИТП не труба

                var way = wayOf(network, segment, flat);
                for (k = 1; k < way.length; k++)
                    writer.line(layerOf(segment), way[k - 1], way[k]);

                var caption = captionOf(segment, network);
                if (caption) {
                    var at = longest(way);
                    writer.text('GVS-TEXT',
                                { x: at.x + NODE_RADIUS, y: at.y + NODE_RADIUS, z: at.z },
                                TEXT_HEIGHT, caption);
                }

                if (LabelOptions.ringNumbers) {
                    var rings = ringsOf(network, segment);
                    if (rings.length > 0) {
                        var mid = longest(way);
                        writer.text('GVS-TEXT',
                                    { x: mid.x + NODE_RADIUS,
                                      y: mid.y - TEXT_HEIGHT * 1.4, z: mid.z },
                                    TEXT_HEIGHT * 0.8, 'к' + rings.join(','));
                    }
                }

                // --- клапан ---
                if (segment.valve && segment.valve.inUse) {
                    var spot = longest(way);
                    writer.circle('GVS-VALVE', spot, NODE_RADIUS * 1.8);

                    var valveText = segment.valve.model
                        ? segment.valve.model.article + ' поз. '
                            + ValveCatalog.formatPosition(segment.valve.model,
                                                          segment.valve.position)
                        : 'балансировочный клапан';

                    writer.text('GVS-VALVE',
                                { x: spot.x + NODE_RADIUS * 2.0,
                                  y: spot.y + TEXT_HEIGHT * 1.4, z: spot.z },
                                TEXT_HEIGHT, valveText);
                }
            }

            // --- узлы ---
            for (i = 0; i < network.nodes.length; i++) {
                var point = pointOf(network, i, flat);
                if (!point) continue;

                var isSource = network.isSource(i);

                // Узлы рисуются не все: на схеме из сотен участков кружок
                // в каждой точке превращает её в сплошную сыпь. ИТП — всегда,
                // остальные — только если их номера включены галочкой.
                if (!isSource && !LabelOptions.nodeNumbers) continue;

                writer.circle(isSource ? 'GVS-ITP' : 'GVS-NODE', point,
                              isSource ? SOURCE_RADIUS : NODE_RADIUS);

                if (isSource) {
                    writer.text('GVS-ITP',
                                { x: point.x + SOURCE_RADIUS * 1.3,
                                  y: point.y + SOURCE_RADIUS * 0.5, z: point.z },
                                TEXT_HEIGHT * 1.2,
                                network.isSupplySource(i) ? 'ИТП, выход Т3' : 'ИТП, вход Т4');
                } else if (LabelOptions.nodeNumbers) {
                    writer.text('GVS-NODE',
                                { x: point.x + NODE_RADIUS * 1.4,
                                  y: point.y + NODE_RADIUS, z: point.z },
                                TEXT_HEIGHT * 0.8,
                                String(network.nodes[i].number || i + 1));
                }
            }

            var bounds = boundsOf(network, flat);
            if (!bounds.empty) legend(writer, app, bounds, flat);

            writer.pair(0, 'ENDSEC').pair(0, 'EOF');

            return writer.toBytes();
        }
    };
})();
