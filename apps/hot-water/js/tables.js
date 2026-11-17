'use strict';

/*
    Таблицы отчёта. Колонки перенесены из HotWaterCirculation/src/ReportForm.cs
    один в один — отчёт из браузера и отчёт из плагина должны читаться как один
    документ.

    Разбивка по системам вынесена отдельной вкладкой не для красоты: Т3 и Т4
    отвечают за разное. Остывание Т3 определяет температуру у потребителя и через
    неё — циркуляционный расход. Т4 остывает уже за потребителем: на температуру
    у крана не влияет, нагружает только ИТП. Полотенцесушители идут третьей
    колонкой, потому что это не труба, и подмешивать их в среднее удельное q нельзя.

    Каждая таблица копируется в буфер обмена текстом с табуляцией: так Excel
    принимает её числами, а не текстом.
*/

var Tables = (function () {

    /* Что показано в таблице участков: все, только Т3 или только Т4. */
    var roleFilter = 'all';

    var definitions = {

        zones: {
            title: 'Системы',
            columns: ['Система', 'Колец', 'Теплопотери Т3+Т4, кВт', 'Расход, л/с', 'Расход, кг/ч',
                      'Худшая температура, °C', 'Обратка на ИТП, °C', 'Подогрев в ИТП, К',
                      'Худшее кольцо', 'Потери, кПа', 'Потери, бар',
                      'Напор насоса, м вод. ст.', 'Насос', 'Замечание'],
            rows: function (app) {
                var out = [];
                for (var i = 0; i < app.network.zones.length; i++) {
                    var zone = app.network.zones[i];
                    if (!app.acceptsZone(zone)) continue;

                    out.push([
                        zone.caption,
                        Fmt.int(zone.rings.length),
                        Fmt.kilowatts(zone.heatLoss),
                        Fmt.flowLs(zone.flow),
                        Fmt.flowKgH(zone.flow),
                        Fmt.temperature(zone.minTemperature),
                        zone.returnFlow > 1e-9 ? Fmt.temperature(zone.returnTemperature) : '—',
                        zone.returnFlow > 1e-9 ? Fmt.num(zone.itpDeltaT) : '—',
                        zone.worstRingNumber > 0 ? '№' + zone.worstRingNumber : '—',
                        Fmt.pressure(zone.worstDrop),
                        Fmt.bar(zone.worstDrop),
                        Fmt.head(zone.worstDrop),
                        zone.pump && zone.pump.model
                            ? zone.pump.model.brand + ' ' + zone.pump.model.model
                            : '—',
                        zone.note || ''
                    ]);
                }
                return out;
            }
        },

        heat: {
            title: 'Теплопотери',
            columns: ['Система', 'Т3: длина, м', 'Т3: Q, кВт', 'Т3: q, Вт/м',
                      'Т4: длина, м', 'Т4: Q, кВт', 'Т4: q, Вт/м',
                      'Полотенцесуш., кВт', 'Шт.', 'Всего, кВт', 'Доля Т3, %',
                      'Расход подбором, л/с', 'Расход по СП, л/с'],
            rows: function (app) {
                var out = [];
                for (var i = 0; i < app.network.zones.length; i++) {
                    var zone = app.network.zones[i];
                    if (!app.acceptsZone(zone)) continue;

                    var byNorm = HeatLoss.circulationFlowByNorm(
                        app.settings.normHeatSupplyOnly ? zone.heatLossSupply : zone.heatLoss,
                        app.settings);

                    out.push([
                        zone.caption,
                        Fmt.length(zone.lengthSupply),
                        Fmt.kilowatts(zone.heatLossSupply),
                        zone.lengthSupply > 0 ? Fmt.heatFlux(zone.heatLossSupply / zone.lengthSupply) : '—',
                        Fmt.length(zone.lengthReturn),
                        Fmt.kilowatts(zone.heatLossReturn),
                        zone.lengthReturn > 0 ? Fmt.heatFlux(zone.heatLossReturn / zone.lengthReturn) : '—',
                        Fmt.kilowatts(zone.towelHeat),
                        Fmt.int(zone.towelCount),
                        Fmt.kilowatts(zone.heatLoss),
                        zone.heatLoss > 0 ? Fmt.percent(zone.heatLossSupply / zone.heatLoss) : '—',
                        Fmt.flowLs(zone.flow),
                        Fmt.flowLs(byNorm)
                    ]);
                }
                return out;
            }
        },

        rings: {
            title: 'Кольца',
            columns: ['№', 'Система', 'Длина, м', 'Теплопотери, Вт', 'Расход, л/с',
                      'Потери напора, кПа', 't в конце, °C', 'Невязка, %',
                      'Δp клапана, кПа', 'Требуемый Kv', 'Замечание'],
            rows: function (app) {
                var out = [];
                for (var i = 0; i < app.network.rings.length; i++) {
                    var ring = app.network.rings[i];
                    if (!app.acceptsZoneKey(ring.zoneKey)) continue;

                    out.push([
                        Fmt.int(ring.number) + (ring.isWorstRing ? '  ★' : ''),
                        captionOfZone(app, ring.zoneKey),
                        Fmt.length(ring.length),
                        Fmt.watts(ring.heatLoss),
                        Fmt.flowLs(ring.flow),
                        Fmt.pressure(ring.pressureDrop),
                        Fmt.temperature(ring.temperatureAtEnd),
                        Fmt.percent(ring.imbalance),
                        ring.needsValve ? Fmt.pressure(ring.requiredValveDrop) : '—',
                        ring.needsValve ? Fmt.kv(ring.requiredKv) : '—',
                        ring.note || ''
                    ]);
                }
                return out;
            }
        },

        valves: {
            title: 'Балансировка',
            columns: ['Кольцо', 'Система', 'Расход, л/с', 'Расход, м³/ч',
                      'Потери кольца, кПа', 'Потери, бар', 'Потери, м вод. ст.', 'Невязка, %',
                      'Клапан нужен', 'Δp клапана, кПа', 'Δp клапана, бар', 'Δp клапана, м',
                      'Требуемый Kv', 'Ду трубы, мм', 'Участок', 'Подбор', 'Клапан', 'Настройка',
                      'Kv на настройке', 'Факт. Δp, кПа', 'Замечание'],
            rows: function (app) {
                var out = [];
                var i;

                for (i = 0; i < app.network.rings.length; i++) {
                    var ring = app.network.rings[i];
                    if (!app.acceptsZoneKey(ring.zoneKey)) continue;

                    var valve = ring.valve;
                    var segment = ring.valveSegment >= 0
                        ? app.network.segments[ring.valveSegment] : null;
                    var live = segment ? segment.valve : null;

                    out.push({
                        segment: ring.valveSegment,
                        byHand: !!(live && live.chosenArticle),
                        cells: [
                            Fmt.int(ring.number),
                            captionOfZone(app, ring.zoneKey),
                            Fmt.flowLs(ring.flow),
                            Fmt.flowM3H(ring.flow),
                            Fmt.pressure(ring.pressureDrop),
                            Fmt.bar(ring.pressureDrop),
                            Fmt.head(ring.pressureDrop),
                            Fmt.percent(ring.imbalance),
                            ring.needsValve ? 'да' : 'нет',
                            ring.needsValve ? Fmt.pressure(ring.requiredValveDrop) : '—',
                            ring.needsValve ? Fmt.bar(ring.requiredValveDrop) : '—',
                            ring.needsValve ? Fmt.head(ring.requiredValveDrop) : '—',
                            ring.needsValve ? Fmt.kv(ring.requiredKv) : '—',
                            ring.valvePipeDN > 0 ? Fmt.fixed(ring.valvePipeDN, 0) : '—',
                            segment && segment.number > 0 ? '№' + segment.number : '—',
                            live && live.chosenArticle ? 'вручную' : 'автоматически',
                            valve && valve.model ? valve.model.caption : '—',
                            valve && valve.model ? ValveCatalog.formatPosition(valve.model, valve.position) : '—',
                            valve && valve.model ? Fmt.kv(valve.actualKv) : '—',
                            valve && valve.model ? Fmt.pressure(valve.actualDrop) : '—',
                            valve ? (valve.note || '') : ''
                        ]
                    });
                }

                // Клапаны, поставленные вручную и не пригодившиеся увязке, идут
                // отдельными строками: они стоят в сети, и умолчать про них нельзя.
                for (i = 0; i < app.network.segments.length; i++) {
                    var s = app.network.segments[i];
                    if (!s.valve || s.valve.inUse || s.valve.automatic) continue;
                    if (!app.accepts(s)) continue;

                    out.push({
                        segment: i,
                        byHand: !!s.valve.chosenArticle,
                        cells: [
                            '—', captionOfZone(app, s.zoneKey),
                            Fmt.flowLs(s.flow), Fmt.flowM3H(s.flow),
                            '—', '—', '—', '—', 'нет', '—', '—', '—', '—',
                            Fmt.fixed(s.nominalDiameterMm, 0),
                            s.number > 0 ? '№' + s.number : '—',
                            s.valve.chosenArticle ? 'вручную' : 'автоматически',
                            s.valve.model ? s.valve.model.caption : '—',
                            'открыт полностью',
                            s.valve.model ? Fmt.kv(s.valve.actualKv) : '—',
                            '—',
                            s.valve.note || ''
                        ]
                    });
                }

                return out;
            }
        },

        /*
            Гидравлика по кольцам: откуда взялись потери, а не только их итог.

            Участки идут в порядке обхода кольца — от ИТП по Т3, через перемычку
            и обратно по Т4, — поэтому нарастающие длина и перепад читаются как
            путь воды. Общая магистраль попадает в каждое кольцо, через которое
            проходит: потери на ней несут все они.
        */
        hydraulics: {
            title: 'Гидравлика по кольцам',
            columns: ['Кольцо', 'Система', '№ уч.', 'Узлы', 'Роль', 'Тип',
                      'Материал', 'Ду, мм', 'Dвн, мм', 'k_э, мм',
                      'Длина, м', 'Длина по кольцу, м',
                      'Расход, кг/ч', 'Расход, л/с', 'v, м/с', 'Re', 'Закон трения', 'λ',
                      'R, Па/м', 'По длине, Па', 'Местные, Па',
                      'Δp трубы, Па', 'Δp клапана, Па', 'Δp участка, кПа',
                      'Нарастающий Δp, кПа'],
            rows: function (app) {
                var out = [];

                for (var r = 0; r < app.network.rings.length; r++) {
                    var ring = app.network.rings[r];
                    if (!app.acceptsZoneKey(ring.zoneKey)) continue;
                    if (ring.segments.length === 0) continue;

                    var alongLength = 0.0;
                    var alongDrop = 0.0;

                    for (var k = 0; k < ring.segments.length; k++) {
                        var s = app.network.segments[ring.segments[k]];
                        var detail = Hydraulics.detail(s.flow, s.length, s.innerDiameter,
                                                       s.material, app.settings);

                        alongLength += s.length;
                        alongDrop += s.pressureDrop;

                        out.push([
                            Fmt.int(ring.number),
                            captionOfZone(app, ring.zoneKey),
                            s.number > 0 ? Fmt.int(s.number) : '—',
                            app.network.nodes[s.nodeA].number + ' → ' + app.network.nodes[s.nodeB].number,
                            roleCaption(s.role),
                            kindOf(s),
                            s.material || '—',
                            s.nominalDiameterMm > 0 ? Fmt.fixed(s.nominalDiameterMm, 0) : '—',
                            s.innerDiameter > 0 ? Fmt.fixed(s.innerDiameter * 1000, 1) : '—',
                            detail.usesRoughness ? Fmt.num(detail.roughness) : '—',
                            Fmt.length(s.length),
                            Fmt.length(alongLength),
                            Fmt.flowKgH(s.flow),
                            Fmt.flowLs(s.flow),
                            detail.velocity > 0 ? Fmt.velocity(detail.velocity) : '—',
                            detail.reynolds > 0 ? Fmt.fixed(detail.reynolds, 0) : '—',
                            detail.law,
                            detail.friction > 0 ? Fmt.fixed(detail.friction, 4) : '—',
                            detail.perMetre > 0 ? Fmt.num(detail.perMetre) : '—',
                            detail.linear > 0 ? Fmt.fixed(detail.linear, 1) : '—',
                            detail.local > 0 ? Fmt.fixed(detail.local, 1) : '—',
                            s.pipeDrop > 0 ? Fmt.fixed(s.pipeDrop, 1) : '—',
                            s.valveDrop > 0 ? Fmt.fixed(s.valveDrop, 1) : '—',
                            kPa3(s.pressureDrop),
                            kPa3(alongDrop)
                        ]);
                    }

                    // Итог кольца отдельной строкой: он и есть то, что потом
                    // сравнивается с другими кольцами при увязке.
                    out.push([
                        'Итог ' + Fmt.int(ring.number),
                        captionOfZone(app, ring.zoneKey),
                        '', '', '', '', '', '', '', '',
                        Fmt.length(alongLength), Fmt.length(alongLength),
                        '', '', '', '', '', '', '', '', '', '', '',
                        kPa3(ring.pressureDrop),
                        kPa3(ring.pressureDrop)
                    ]);
                }

                return out;
            }
        },

        /*
            Подбор клапанов, расписанный по шагам.

            Вкладка «Балансировка» показывает, что получилось; здесь видно, как
            это посчитано: от потерь худшего кольца к недостающему перепаду,
            от него к требуемому Kv, от Kv по настроечной таблице к положению
            и обратно — к тому, что даст округлённое положение на деле.
        */
        valveCalc: {
            title: 'Подбор клапанов',
            columns: ['Кольцо', 'Система', 'Участок', 'Ду трубы, мм',
                      'G, кг/ч', 'Q, м³/ч',
                      'Δp кольца (трубы), кПа', 'Δp худшего кольца, кПа',
                      'Невязка, %', 'Требуемый Δp клапана, кПа', 'То же, бар',
                      'Kv = Q/√Δp', 'Фирма', 'Клапан', 'Подбор',
                      'Положение расчётное', 'Положение принятое', 'Шаг шкалы',
                      'Kv на положении', 'Факт. Δp, кПа', 'Расхождение, %', 'Замечание'],
            rows: function (app) {
                var out = [];
                var i;

                // Потери худшего кольца своей зоны — та самая база сравнения.
                var worst = {};
                for (i = 0; i < app.network.zones.length; i++) {
                    var zone = app.network.zones[i];
                    var top = 0.0;

                    for (var z = 0; z < zone.rings.length; z++)
                        top = Math.max(top, app.network.rings[zone.rings[z]].pipeDrop);

                    worst[zone.key] = top;
                }

                for (i = 0; i < app.network.rings.length; i++) {
                    var ring = app.network.rings[i];
                    if (!app.acceptsZoneKey(ring.zoneKey)) continue;
                    if (ring.segments.length === 0) continue;

                    var valve = ring.valve;
                    var model = valve ? valve.model : null;
                    var segment = ring.valveSegment >= 0
                        ? app.network.segments[ring.valveSegment] : null;
                    var live = segment ? segment.valve : null;

                    var base = worst[ring.zoneKey] || 0.0;
                    var want = ring.requiredValveDrop;

                    out.push([
                        Fmt.int(ring.number) + (ring.isWorstRing ? '  ★' : ''),
                        captionOfZone(app, ring.zoneKey),
                        segment && segment.number > 0 ? '№' + segment.number : '—',
                        ring.valvePipeDN > 0 ? Fmt.fixed(ring.valvePipeDN, 0) : '—',
                        Fmt.flowKgH(ring.flow),
                        m3h4(ring.flow),
                        kPa3(ring.pipeDrop),
                        kPa3(base),
                        Fmt.percent(ring.imbalance),
                        ring.needsValve ? kPa3(want) : 'не требуется',
                        ring.needsValve ? bar6(want) : '—',
                        ring.needsValve ? Fmt.kv(ring.requiredKv) : '—',
                        model ? model.brand : '—',
                        model ? model.family + ' ' + model.size + ' (' + model.article + ')' : '—',
                        live && live.chosenArticle ? 'вручную' : 'автоматически',
                        // Расчётное положение показывается точнее принятого: иначе
                        // не видно, насколько округление сдвинуло настройку.
                        model ? Fmt.fixed(valve.exactPosition, 2) : '—',
                        model ? ValveCatalog.formatPosition(model, valve.position) : '—',
                        model ? ValveCatalog.formatPosition(model, model.step) : '—',
                        model ? Fmt.kv(valve.actualKv) : '—',
                        model ? kPa3(valve.actualDrop) : '—',
                        model && want > 1e-6
                            ? Fmt.percent((valve.actualDrop - want) / want) : '—',
                        valve ? (valve.note || '') : ''
                    ]);
                }

                return out;
            }
        },

        /*
            ИТП и насос. Таблица нарочно вертикальная, не как остальные.

            Остальные таблицы — списки однородных вещей: участков, колец,
            клапанов. Здесь же на систему приходится один набор разных величин,
            и в строку они не укладываются: вышло бы двадцать колонок, из которых
            девятнадцать пустых. Вертикальный ход с колонкой «как получено»
            читается как лист расчёта и в записку переносится без переделки.
        */
        itp: {
            title: 'ИТП и насос',
            columns: ['Система', 'Показатель', 'Значение', 'Как получено'],
            rows: function (app) {
                var out = [];

                for (var i = 0; i < app.network.zones.length; i++) {
                    var zone = app.network.zones[i];
                    if (!app.acceptsZone(zone)) continue;
                    if (zone.rings.length === 0) continue;

                    var row = makeRow(out, zone.caption);

                    // --- циркуляционный расход ---
                    row('Расход циркуляционный, л/с', Fmt.flowLs(zone.flow),
                        'сумма расходов колец, подбор по '
                            + Fmt.num(app.settings.requiredTemperature) + ' °C у потребителя');
                    row('то же, м³/ч', Fmt.flowM3H(zone.flow),
                        'G/ρ при ρ = ' + Fmt.num(Water.Density) + ' кг/м³');
                    row('то же, кг/ч', Fmt.flowKgH(zone.flow),
                        'в массовом расходе ведётся весь расчёт: Q = c·G·Δt');

                    // --- сторона ИТП ---
                    row('Обратка на вводе ИТП, °C',
                        zone.returnFlow > 1e-9 ? Fmt.temperature(zone.returnTemperature) : '—',
                        'смешение веток Т4 по расходам; не путать с худшей точкой '
                            + Fmt.temperature(zone.minTemperature) + ' °C');
                    row('Подогрев в ИТП, К',
                        zone.returnFlow > 1e-9 ? Fmt.num(zone.itpDeltaT) : '—',
                        'подача ' + Fmt.num(app.settings.supplyTemperature)
                            + ' °C минус обратка');
                    row('Нагрузка на циркуляцию, кВт', Fmt.kilowatts(zone.itpHeat),
                        'c·G·Δt при c = ' + Fmt.num(Water.HeatCapacity) + ' кДж/(кг·К)');
                    row('Теплопотери системы, кВт', Fmt.kilowatts(zone.heatLoss),
                        'сверка: должна совпасть с нагрузкой на циркуляцию');

                    // --- напор ---
                    row('Худшее кольцо',
                        zone.worstRingNumber > 0 ? '№ ' + zone.worstRingNumber : '—',
                        'кольцо с наибольшими потерями — по нему и подбирается насос');
                    row('Потери худшего кольца, кПа', kPa3(zone.worstDrop),
                        'трубы вместе с балансировочными клапанами');
                    row('Требуемый напор, м вод. ст.', Fmt.head(zone.worstDrop),
                        'Δp/(ρ·g) по горячей воде, ρ = ' + Fmt.num(Water.Density) + ' кг/м³');

                    var pump = zone.pump;
                    if (!pump) {
                        row('Насос', '—', 'подбор не выполнялся');
                        continue;
                    }

                    row('Запас напора, раз', Fmt.num(pump.reserveFactor),
                        'из исходных данных: на зарастание труб, наладку и фильтр');
                    row('Напор с запасом, м вод. ст.', Fmt.num(pump.demand),
                        'требуемый напор × запас — по нему и ищется насос');

                    if (!pump.model) {
                        row('Насос', 'не подобран', pump.note || '');
                    } else {
                        row('Насос', pump.model.brand + ' ' + pump.model.model,
                            'самый слабый из подходящих: лишний напор уходит '
                                + 'в клапаны и шумит');
                        row('Корпус', pump.model.body,
                            'для ГВС обязательны бронза или нержавейка — вода '
                                + 'питьевая и проточная');
                        row('Присоединение', pump.model.connection, 'по паспорту насоса');
                        row('Напор насоса в рабочей точке, м', Fmt.num(pump.workingHead),
                            'H = H_max·(1 − (Q/Q_max)²), H_max = '
                                + Fmt.num(pump.model.headMax) + ' м, Q_max = '
                                + Fmt.num(pump.model.flowMax) + ' м³/ч');
                        row('Фактический запас, раз', Fmt.num(pump.margin),
                            'напор насоса к требуемому напору кольца');
                        row('Мощность, Вт', Fmt.int(pump.model.power),
                            'по паспорту, для расчёта электрики');
                    }

                    if (pump.rejected.length > 0) {
                        row('Отклонено', pump.rejected.join('; '),
                            'почему не взяты остальные — чтобы отказ не был молчаливым');
                    }

                    row('Данные каталога', 'ориентировочные',
                        'характеристика приближена параболой по двум паспортным '
                            + 'крайностям; перед выдачей сверьте с паспортом');

                    if (pump.note)
                        row('Замечание', pump.note, '');
                }

                return out;
            }
        },

        /*
            Проверочный расчёт: как расход разойдётся сам.

            Основной расчёт назначает кольцам расходы из условия 60 °C
            у потребителя. Вода про эти 60 °C ничего не знает — она идёт туда,
            где меньше сопротивление. Здесь видно, куда именно, и что из этого
            выйдет с температурой, если клапанов не ставить.

            Схема и результаты основного расчёта при этом не меняются.

            Столбец «Положение клапана» правится: можно выставить то, что
            выставил наладчик, и посмотреть, что из этого вышло. Пустая ячейка
            означает положение из расчёта. Полностью открытый клапан — это
            не то же, что столбец «без клапанов»: открытый он всё равно
            сопротивляется своим наибольшим Kv.
        */
        proof: {
            title: 'Проверочный расчёт',
            columns: ['Система', 'Кольцо', 'Расход на ИТП, л/с', 'Задан',
                      'Расчётный расход, л/с', 'Клапан',
                      'Положение', 'по расчёту', 'Kv на нём',
                      'С клапанами: расход, л/с', 'доля, %', 't в конце, °C',
                      'Без клапанов: расход, л/с', 'доля, %', 't в конце, °C',
                      'Отклонение от расчётного, %', 'Δp кольца без клапанов, кПа',
                      'Замечание'],
            rows: function (app) {
                var out = [];
                var result = app.proof;

                if (!result) return out;

                for (var z = 0; z < result.zones.length; z++) {
                    var zone = result.zones[z];
                    if (!app.acceptsZoneKey(zone.key)) continue;

                    for (var r = 0; r < zone.withValves.rings.length; r++) {
                        var withV = zone.withValves.rings[r];
                        var without = zone.without.rings[r];
                        var design = app.network.rings[withV.index].flow;

                        var drift = design > 1e-9
                            ? (without.flow - design) / design : 0.0;

                        var notes = [];

                        if (withV.byHand) {
                            notes.push('положение задано вручную'
                                + (withV.wideOpen ? ' — открыт полностью' : ''));
                        }
                        if (withV.clamped) {
                            notes.push('«' + withV.asked + '» вне шкалы 0…'
                                + Fmt.num(withV.scaleLimit) + ' — принято ближайшее');
                        }
                        if (withV.byHand
                            && withV.endTemperature < app.settings.requiredTemperature - 0.05) {
                            notes.push('при этом положении не добирает '
                                + Fmt.num(app.settings.requiredTemperature) + ' °C');
                        }
                        if (without.endTemperature < app.settings.requiredTemperature - 0.05) {
                            notes.push('без клапанов не добирает '
                                + Fmt.num(app.settings.requiredTemperature) + ' °C');
                        }
                        if (without.flow < design * 0.5 && design > 1e-9)
                            notes.push('расход падает больше чем вдвое');
                        if (without.flow > design * 1.5 && design > 1e-9)
                            notes.push('кольцо забирает расход на себя');

                        out.push({
                            ring: withV.index,
                            byHand: withV.byHand,
                            editable: withV.hasValve,
                            cells: [
                                zone.caption,
                                Fmt.int(withV.number),
                                Fmt.flowLs(zone.total),
                                zone.given ? 'вручную' : 'по расчёту',
                                Fmt.flowLs(design),
                                withV.valveCaption,
                                withV.byHand ? withV.positionText : '',
                                withV.designPosition,
                                withV.valveKv > 1e-9 ? Fmt.kv(withV.valveKv) : '—',
                                Fmt.flowLs(withV.flow),
                                Fmt.percent(withV.share),
                                Fmt.temperature(withV.endTemperature),
                                Fmt.flowLs(without.flow),
                                Fmt.percent(without.share),
                                Fmt.temperature(without.endTemperature),
                                Fmt.percent(drift),
                                kPa3(without.drop),
                                notes.join('; ')
                            ]
                        });
                    }

                    // Итог зоны: напор, который должен развить насос в обоих случаях.
                    out.push({
                        ring: -1, byHand: false, editable: false,
                        cells: [
                            zone.caption, 'Итог',
                            Fmt.flowLs(zone.total),
                            zone.given ? 'вручную' : 'по расчёту',
                            Fmt.flowLs(zone.design),
                            zone.handPositions > 0
                                ? 'вручную: ' + zone.handPositions : 'все по расчёту',
                            '', '', '',
                            Fmt.flowLs(zone.total), '100,0',
                            'напор ' + kPa3(zone.withValves.head) + ' кПа',
                            Fmt.flowLs(zone.total), '100,0',
                            'напор ' + kPa3(zone.without.head) + ' кПа',
                            '', '',
                            'шагов: ' + zone.withValves.steps + ' и ' + zone.without.steps
                        ]
                    });
                }

                return out;
            }
        },

        diagnostics: {
            title: 'Диагностика',
            columns: ['Замечание'],
            rows: function (app) {
                var out = [];
                for (var i = 0; i < app.network.diagnostics.length; i++)
                    out.push([app.network.diagnostics[i]]);
                return out;
            }
        }
    };

    function captionOfZone(app, key) {
        var zone = app.network.zone(key);
        return zone ? zone.caption : (key || '—');
    }

    // --- таблица участков: единственная редактируемая -------------------------

    var segmentColumns = ['№', 'Узлы', 'Система', 'Роль', 'Тип участка', 'Кольца',
        'Материал', 'Ду, мм', 'Длина, м', 'Изоляция', 'δ, мм', 'λ, Вт/(м·К)',
        'Полот., шт', 't окр, °C', 'q, Вт/м', 'Q, Вт', 'Расход, л/с', 'v, м/с',
        'Δp, кПа', 'Клапан', 'в т.ч. клапан, кПа', 't вход, °C', 't выход, °C',
        'Реком. Ду, мм', 'Замечание'];

    function segmentRows(app) {
        var out = [];

        for (var i = 0; i < app.network.segments.length; i++) {
            var s = app.network.segments[i];
            if (!app.accepts(s)) continue;
            if (roleFilter === 'supply' && s.role !== PipeRole.Supply) continue;
            if (roleFilter === 'return' && s.role !== PipeRole.Return) continue;

            var rings = [];
            for (var k = 0; k < s.ringIndices.length; k++)
                rings.push(app.network.rings[s.ringIndices[k]].number);

            out.push({
                index: i,
                cells: [
                    s.number > 0 ? Fmt.int(s.number) : '—',
                    app.network.nodes[s.nodeA].number + ' → ' + app.network.nodes[s.nodeB].number,
                    captionOfZone(app, s.zoneKey),
                    roleCaption(s.role),
                    kindOf(s),
                    rings.join(', ') || '—',
                    s.material || '—',
                    s.nominalDiameterMm > 0 ? Fmt.fixed(s.nominalDiameterMm, 0) : '—',
                    Fmt.length(s.length),
                    s.insulationName || 'нет',
                    s.insulationThickness > 0 ? Fmt.fixed(s.insulationThickness * 1000, 0) : '0',
                    s.insulationLambda > 0 ? Fmt.num(s.insulationLambda) : '—',
                    Fmt.int(s.towelRailCount),
                    s.isCirculating ? Fmt.fixed(s.ambientTemperature, 1) : '—',
                    s.isCirculating ? Fmt.heatFlux(s.heatFluxPerMetre) : '—',
                    s.isCirculating ? Fmt.watts(s.heatLoss) : '—',
                    s.flow > 0 ? Fmt.flowLs(s.flow) : '—',
                    s.velocity > 0 ? Fmt.velocity(s.velocity) : '—',
                    s.pressureDrop > 0 ? Fmt.pressure(s.pressureDrop) : '—',
                    valveCaption(s),
                    s.valveDrop > 0 ? Fmt.pressure(s.valveDrop) : '—',
                    s.isCirculating ? Fmt.temperature(s.temperatureIn) : '—',
                    s.isCirculating ? Fmt.temperature(s.temperatureOut) : '—',
                    s.suggestedDiameterMm > 0 ? Fmt.fixed(s.suggestedDiameterMm, 0) : '—',
                    s.note || ''
                ]
            });
        }

        return out;
    }

    function kindOf(s) {
        if (s.isSourceLink) return 'ИТП';
        if (s.isRingClosure) return 'перемычка';
        if (s.isVirtualLink) return 'сшивка';
        if (!s.isCirculating) return 'тупиковый';
        return 'кольцевой';
    }

    // --- построение разметки --------------------------------------------------

    function buildTable(columns, rows, onRowClick, rowKeys) {
        var table = document.createElement('table');
        table.className = 'grid';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        for (var c = 0; c < columns.length; c++) {
            var th = document.createElement('th');
            th.textContent = columns[c];
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        for (var r = 0; r < rows.length; r++) {
            var tr = document.createElement('tr');
            for (var k = 0; k < rows[r].length; k++) {
                var td = document.createElement('td');
                td.textContent = rows[r][k];
                tr.appendChild(td);
            }
            if (onRowClick) {
                tr.dataset.key = rowKeys ? rowKeys[r] : r;
                tr.addEventListener('click', onRowClick);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        if (rows.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = 'Пусто. Начертите сеть и нажмите «Расчёт».';
            var wrap = document.createElement('div');
            wrap.appendChild(table);
            wrap.appendChild(empty);
            return wrap;
        }

        return table;
    }

    /* Колонки таблицы участков, которые правятся прямо в ячейке. */
    var EDITABLE = { 6: 'material', 7: 'nominal', 8: 'length', 9: 'insulation',
                     10: 'thickness', 12: 'towels', 19: 'valve' };

    /*
        В таблицах, показывающих ход расчёта, разрядов нужно больше обычного:
        иначе «Kv = Q/√Δp» глазами не пересчитать, а ради этого они и сделаны.
        При здешних расходах перепады идут сотыми долями килопаскаля.
    */
    function kPa3(pascals) { return Fmt.fixed(pascals / 1000.0, 3); }
    function bar6(pascals) { return Fmt.fixed(pascals / 1e5, 6); }
    function m3h4(kgPerHour) { return Fmt.fixed(kgPerHour / Water.Density, 4); }

    /**
     * Строкопишущий для вертикальных таблиц: первая колонка повторяется,
     * остальные три — показатель, значение и как получено.
     */
    function makeRow(out, caption) {
        return function (label, value, how) {
            out.push([caption, label, value, how || '']);
        };
    }

    /** Что написано про клапан в таблице участков. */
    function valveCaption(segment) {
        if (!segment.valve) return '—';
        if (segment.valve.chosenArticle) return segment.valve.chosenArticle + ' (вручную)';
        if (segment.valve.model) return segment.valve.model.caption;
        return 'подбор автоматически';
    }

    /* Правимый столбец таблицы проверочного расчёта — настроечное положение. */
    var PROOF_POSITION_COLUMN = 6;

    /**
     * Поле настроечного положения в проверочном расчёте.
     *
     * Положения хранятся не в сети, а отдельно, в app.proofPositions: это
     * предположение «что если», а не свойство клапана. Записать его в клапан
     * значило бы подменить подобранную настройку выдуманной — и выдать её
     * потом в ведомость.
     */
    function positionEditor(app, ringIndex) {
        var ring = app.network.rings[ringIndex];
        var valve = ring && ring.valveSegment >= 0
            ? app.network.segments[ring.valveSegment].valve : null;
        var model = valve ? valve.model : null;

        var control = document.createElement('input');
        control.type = 'text';
        control.inputMode = 'decimal';
        control.className = 'cell-editor position';

        if (!app.proofPositions) app.proofPositions = {};

        var kept = app.proofPositions[ringIndex];
        control.value = kept === undefined || kept === null ? '' : String(kept);

        if (model) {
            control.placeholder = ValveCatalog.formatPosition(model, valve.position);
            control.title = 'Пусто — положение из расчёта ('
                + ValveCatalog.formatPosition(model, valve.position) + '). Шкала 0…'
                + Fmt.num(ValveCatalog.fullOpen(model))
                + ' шагом ' + Fmt.num(model.step) + '.';
        }

        control.dataset.ring = ringIndex;

        /*
            Пересчёт по «change», а не по каждой клавише. Поле стоит внутри
            таблицы, а пересчёт её перерисовывает: по «input» поле исчезало бы
            из-под пальцев на первой же цифре. «change» срабатывает по Enter
            и при уходе из поля — и то, и другое человек делает намеренно.
        */
        control.addEventListener('change', function () {
            var text = control.value.trim();

            if (text === '') delete app.proofPositions[ringIndex];
            else app.proofPositions[ringIndex] = text;

            focusRing = ringIndex;
            app.refreshProof();
        });

        control.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') control.blur();
            if (e.key === 'Escape') {
                control.value = '';
                control.blur();
            }
        });

        control.addEventListener('click', function (e) { e.stopPropagation(); });
        return control;
    }

    /*
        Кольцо, в чьё поле надо вернуть курсор после перерисовки. Иначе после
        каждого Enter курсор уезжал бы в начало страницы, и вторую настройку
        пришлось бы искать мышью.
    */
    var focusRing = -1;

    function restoreFocus(table) {
        if (focusRing < 0) return;

        var want = focusRing;
        focusRing = -1;

        setTimeout(function () {
            var field = table.querySelector('input.position[data-ring="' + want + '"]');
            if (!field) return;
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
        }, 0);
    }

    /* Управляющие столбцы таблицы балансировки. */
    var MODE_COLUMN = 15;
    var ARTICLE_COLUMN = 16;

    /**
     * Переключатель «кто выбирает типоразмер».
     *
     * При переходе на ручной артикул берётся тот, что уже подобран: иначе
     * при первом же щелчке в таблице менялись бы разом и режим, и клапан,
     * и понять, что из этого дало новые числа, было бы нельзя.
     */
    function modeEditor(app, segment) {
        var control = document.createElement('select');
        control.appendChild(option('auto', 'автоматически'));
        control.appendChild(option('hand', 'вручную'));
        control.value = segment.valve && segment.valve.chosenArticle ? 'hand' : 'auto';

        control.addEventListener('change', function () {
            if (!segment.valve)
                segment.valve = newValveState(false);

            if (control.value === 'auto') {
                segment.valve.chosenArticle = null;
            } else {
                segment.valve.automatic = false;
                segment.valve.chosenArticle = segment.valve.model
                    ? segment.valve.model.article
                    : ValveCatalog.Models[0].article;
            }

            app.afterEdit('способ подбора клапана');
        });

        control.className = 'cell-editor';
        control.addEventListener('click', function (e) { e.stopPropagation(); });
        return control;
    }

    /**
     * Артикулы каталога, разложенные по фирмам. Выбирать можно любой:
     * ручной выбор на то и ручной, что фирма из исходных данных ему не указ.
     */
    function addArticleOptions(control) {
        for (var b = 0; b < ValveCatalog.Brands.length; b++) {
            var brand = ValveCatalog.Brands[b];
            var group = document.createElement('optgroup');
            group.label = brand;

            var list = ValveCatalog.ofBrand(brand);
            for (var i = 0; i < list.length; i++)
                group.appendChild(option(list[i].article, list[i].size + '  ' + list[i].family
                    + '  (' + list[i].article + ')'));

            control.appendChild(group);
        }
    }

    /** Список артикулов каталога для ручного выбора. */
    function articleEditor(app, segment) {
        var control = document.createElement('select');

        addArticleOptions(control);

        control.value = segment.valve.chosenArticle;

        control.addEventListener('change', function () {
            segment.valve.chosenArticle = control.value;
            segment.valve.automatic = false;
            app.afterEdit('типоразмер клапана');
        });

        control.className = 'cell-editor';
        control.addEventListener('click', function (e) { e.stopPropagation(); });
        return control;
    }

    /* Как правка называется в кнопке «Отменить». */
    var EDIT_LABELS = {
        material: 'смену материала',
        nominal: 'смену диаметра',
        length: 'длину участка',
        insulation: 'смену изоляции',
        thickness: 'смену толщины изоляции',
        towels: 'полотенцесушители'
    };

    /** Поле ввода или список для редактируемой ячейки. */
    function editor(app, segment, column) {
        var what = EDITABLE[column];
        var control;
        var i;

        if (what === 'material') {
            control = document.createElement('select');

            // Своё значение — первым пунктом. В модели материал называется как
            // угодно: «Полипропилен» из Revit ни одному имени каталога не равен,
            // и список показал бы пустоту вместо того, что в участке записано.
            keepOwn(control, segment.material, segment.material);

            for (i = 0; i < PipeCatalog.MaterialNames.length; i++)
                control.appendChild(option(PipeCatalog.MaterialNames[i], PipeCatalog.MaterialNames[i]));

            control.value = segment.material || PipeCatalog.MaterialNames[0];

            control.addEventListener('change', function () {
                // Выбрали то же, что было в модели — ничего не трогаем: её числа
                // точнее каталожных, они пришли из настоящей трубы.
                if (control.value === segment.material) { app.afterEdit(EDIT_LABELS[what]); return; }

                // Материал меняется вместе с диаметром: тот же Ду у другого
                // материала — другая стенка и другой внутренний диаметр.
                if (!Calc.applySize(segment, control.value, segment.nominalDiameterMm)) {
                    var near = PipeCatalog.nearest(control.value, segment.innerDiameter);
                    if (near) Calc.applySize(segment, control.value, near.nominalMm);
                }
                app.afterEdit(EDIT_LABELS[what]);
            });

        } else if (what === 'nominal') {
            control = document.createElement('select');

            var sizes = PipeCatalog.sizesOf(segment.material);
            var known = PipeCatalog.find(segment.material, segment.nominalDiameterMm);

            // Ду из модели может не совпасть с каталожным рядом: у Revit условным
            // считается наружный размер, у PP-R в каталоге — свой номинал.
            // Без этого пункта у неизвестного материала список пуст вовсе.
            if (!known && segment.nominalDiameterMm > 0)
                keepOwn(control, segment.nominalDiameterMm, ownSizeCaption(segment));

            for (i = 0; i < sizes.length; i++)
                control.appendChild(option(sizes[i].nominalMm, sizes[i].caption));

            control.value = String(segment.nominalDiameterMm);

            control.addEventListener('change', function () {
                var chosen = parseFloat(control.value);
                if (!known && Math.abs(chosen - segment.nominalDiameterMm) < 0.5) {
                    app.afterEdit(EDIT_LABELS[what]);
                    return;
                }

                Calc.applySize(segment, segment.material, chosen);
                app.afterEdit(EDIT_LABELS[what]);
            });

        } else if (what === 'insulation') {
            control = document.createElement('select');

            var ownInsulation = segment.insulationName
                && segment.insulationLambda > 1e-9
                && InsulationCatalog.lambdaOf(segment.insulationName) <= 0;

            if (ownInsulation)
                keepOwn(control, segment.insulationName,
                    segment.insulationName + '  (λ ' + Fmt.num(segment.insulationLambda) + ')');

            for (i = 0; i < InsulationCatalog.Kinds.length; i++)
                control.appendChild(option(InsulationCatalog.Kinds[i].name, InsulationCatalog.Kinds[i].name));

            control.value = ownInsulation || InsulationCatalog.lambdaOf(segment.insulationName) > 0
                ? segment.insulationName : 'Нет изоляции';

            control.addEventListener('change', function () {
                if (control.value === segment.insulationName) { app.afterEdit(EDIT_LABELS[what]); return; }

                Calc.applyInsulation(segment, control.value, segment.insulationThickness * 1000 || 13);
                app.afterEdit(EDIT_LABELS[what]);
            });

        } else if (what === 'thickness') {
            control = document.createElement('select');

            var thickness = Math.round(segment.insulationThickness * 1000);
            if (thickness > 0 && InsulationCatalog.Thicknesses.indexOf(thickness) < 0)
                keepOwn(control, thickness, thickness);

            control.appendChild(option(0, '0'));
            for (i = 0; i < InsulationCatalog.Thicknesses.length; i++)
                control.appendChild(option(InsulationCatalog.Thicknesses[i], InsulationCatalog.Thicknesses[i]));

            control.value = String(thickness);

            control.addEventListener('change', function () {
                // λ из модели сохраняется: меняется только толщина.
                var mm = parseFloat(control.value);

                if (segment.insulationLambda > 1e-9
                    && InsulationCatalog.lambdaOf(segment.insulationName) <= 0) {
                    segment.insulationThickness = mm / 1000.0;
                    if (mm <= 0) segment.insulationLambda = 0.0;
                } else {
                    Calc.applyInsulation(segment, segment.insulationName, mm);
                }

                app.afterEdit(EDIT_LABELS[what]);
            });

        } else if (what === 'valve') {
            /*
                Клапан ставится и выбирается прямо здесь: «нет» — убрать,
                «подбор автоматически» — поставить и отдать типоразмер программе,
                артикул — поставить и закрепить типоразмер за собой.

                У клапана, подставленного расчётом, пункта «нет» нет: его сюда
                поставила не рука, а потребность кольца в увязке. Убрать его
                можно только одним способом — поставить клапан в другом месте
                этого же кольца, и тогда он исчезнет сам.
            */
            control = document.createElement('select');

            var placed = segment.valve;
            if (!placed || !placed.automatic)
                control.appendChild(option('', 'нет'));

            control.appendChild(option('auto', 'подбор автоматически'));

            addArticleOptions(control);

            control.value = !placed ? ''
                : (placed.chosenArticle ? placed.chosenArticle : 'auto');

            control.addEventListener('change', function () {
                if (control.value === '') {
                    segment.valve = null;
                    app.afterEdit('снятие клапана');
                    return;
                }

                if (!segment.valve)
                    segment.valve = newValveState(false);

                segment.valve.automatic = false;
                segment.valve.chosenArticle = control.value === 'auto' ? null : control.value;

                app.afterEdit(control.value === 'auto'
                    ? 'клапан с автоматическим подбором' : 'типоразмер клапана');
            });

        } else {
            control = document.createElement('input');
            control.type = 'number';
            control.step = what === 'length' ? '0.01' : '1';
            control.min = '0';
            control.value = what === 'length' ? segment.length.toFixed(2) : String(segment.towelRailCount);

            control.addEventListener('change', function () {
                var value = parseFloat(control.value.replace(',', '.'));
                if (!isFinite(value) || value < 0) return;

                if (what === 'length') segment.length = value;
                else segment.towelRailCount = Math.round(value);

                app.afterEdit(EDIT_LABELS[what]);
            });
        }

        control.className = 'cell-editor';
        control.addEventListener('click', function (e) { e.stopPropagation(); });
        return control;
    }

    /**
     * Пункт «как в модели» — первым в списке.
     *
     * Списки собраны по каталогу, а данные приходят из Revit, где материал
     * и изоляция называются как угодно. Список без подходящего пункта
     * показывает пустоту, и выглядит это так, будто данные потерялись, —
     * хотя в участке они записаны. Хуже того: тронув такой список, человек
     * затёр бы настоящие числа модели каталожными.
     */
    function keepOwn(control, value, caption) {
        if (value === null || value === undefined || value === '') return;

        var node = option(value, caption + '  — из модели');
        node.className = 'from-model';
        control.appendChild(node);
    }

    /** Подпись собственного размера участка: «Ду50 (50,0×6,9)». */
    function ownSizeCaption(segment) {
        var outer = segment.outerDiameter * 1000;
        var wall = (segment.outerDiameter - segment.innerDiameter) * 500;

        if (outer <= 0)
            return 'Ду' + Fmt.fixed(segment.nominalDiameterMm, 0);

        return 'Ду' + Fmt.fixed(segment.nominalDiameterMm, 0)
            + '  (' + Fmt.num(Math.round(outer * 10) / 10)
            + '×' + Fmt.num(Math.round(wall * 10) / 10) + ')';
    }

    function option(value, text) {
        var node = document.createElement('option');
        node.value = value;
        node.textContent = text;
        return node;
    }

    function tsv(columns, rows) {
        var lines = [columns.join('\t')];
        for (var i = 0; i < rows.length; i++)
            lines.push(rows[i].join('\t'));
        return lines.join('\n');
    }

    return {
        get roleFilter() { return roleFilter; },
        set roleFilter(value) { roleFilter = value; },

        Names: ['zones', 'heat', 'rings', 'valves', 'segments',
                'hydraulics', 'valveCalc', 'itp', 'proof', 'diagnostics'],

        titleOf: function (name) {
            return name === 'segments' ? 'Участки' : definitions[name].title;
        },

        /** Разметка одной таблицы в готовый узел. */
        render: function (name, app) {
            if (name === 'segments')
                return Tables.renderSegments(app);
            if (name === 'valves')
                return Tables.renderValves(app);
            if (name === 'proof')
                return Tables.renderProof(app);

            var definition = definitions[name];
            return buildTable(definition.columns, definition.rows(app), null, null);
        },

        /*
            Проверочный расчёт. Правится один столбец — настроечное положение.

            Поле текстовое, а не числовое, нарочно: числовое молча выбрасывает
            запятую, а положение Ридана читается с рукоятки как «3,5». Пустое
            поле означает «по расчёту», и рядом стоит столбец с расчётным
            положением — чтобы было видно, от чего человек отклоняется.
        */
        renderProof: function (app) {
            var rows = definitions.proof.rows(app);
            var columns = definitions.proof.columns;

            var table = document.createElement('table');
            table.className = 'grid';

            var thead = document.createElement('tr');
            for (var c = 0; c < columns.length; c++) {
                var th = document.createElement('th');
                th.textContent = columns[c];
                if (c === PROOF_POSITION_COLUMN) th.className = 'editable-head';
                thead.appendChild(th);
            }

            var head = document.createElement('thead');
            head.appendChild(thead);
            table.appendChild(head);

            var tbody = document.createElement('tbody');

            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                var tr = document.createElement('tr');

                if (row.byHand) tr.className = 'by-hand';

                for (var k = 0; k < row.cells.length; k++) {
                    var td = document.createElement('td');

                    if (k === PROOF_POSITION_COLUMN && row.editable)
                        td.appendChild(positionEditor(app, row.ring));
                    else
                        td.textContent = row.cells[k];

                    tr.appendChild(td);
                }

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);

            if (rows.length === 0) {
                var wrap = document.createElement('div');
                var empty = document.createElement('p');
                empty.className = 'empty';
                empty.textContent = 'Колец нет. Нажмите «Расчёт».';
                wrap.appendChild(table);
                wrap.appendChild(empty);
                return wrap;
            }

            restoreFocus(table);
            return table;
        },

        /*
            Таблица балансировки. Два столбца в ней управляющие.

            «Подбор» переключает, кто выбирает типоразмер: программа или человек.
            «Клапан» при ручном подборе становится списком артикулов — программа
            тогда не спорит с выбором, а считает, что он даст: положение, Kv на нём
            и настоящий перепад. Видно цену решения, а не только сам выбор.

            Строка с ручным выбором затемняется: в таблице на два десятка столбцов
            иначе не отличить, где числа подобраны, а где приняты.
        */
        renderValves: function (app) {
            var rows = definitions.valves.rows(app);
            var columns = definitions.valves.columns;

            var table = document.createElement('table');
            table.className = 'grid';

            var thead = document.createElement('tr');
            for (var c = 0; c < columns.length; c++) {
                var th = document.createElement('th');
                th.textContent = columns[c];
                if (c === MODE_COLUMN || c === ARTICLE_COLUMN) th.className = 'editable-head';
                thead.appendChild(th);
            }

            var head = document.createElement('thead');
            head.appendChild(thead);
            table.appendChild(head);

            var tbody = document.createElement('tbody');

            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                var segment = row.segment >= 0 ? app.network.segments[row.segment] : null;
                var tr = document.createElement('tr');

                if (row.byHand) tr.className = 'by-hand';

                for (var k = 0; k < row.cells.length; k++) {
                    var td = document.createElement('td');

                    if (k === MODE_COLUMN && segment)
                        td.appendChild(modeEditor(app, segment));
                    else if (k === ARTICLE_COLUMN && segment && row.byHand)
                        td.appendChild(articleEditor(app, segment));
                    else
                        td.textContent = row.cells[k];

                    tr.appendChild(td);
                }

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);

            if (rows.length === 0) {
                var wrap = document.createElement('div');
                var empty = document.createElement('p');
                empty.className = 'empty';
                empty.textContent = 'Колец с увязкой нет. Нажмите «Расчёт».';
                wrap.appendChild(table);
                wrap.appendChild(empty);
                return wrap;
            }

            return table;
        },

        /*
            Таблица участков — единственная редактируемая. Материал, Ду, длина,
            изоляция и число полотенцесушителей правятся прямо в ячейке.

            После правки расчёт перезапускается целиком, а не пересчитывается
            одна строка: диаметр меняет потери, потери меняют невязку, невязка
            меняет подобранный клапан. Показать новую скорость, не тронув всего
            остального, значило бы соврать.
        */
        renderSegments: function (app) {
            var rows = segmentRows(app);

            var table = document.createElement('table');
            table.className = 'grid';

            var thead = document.createElement('thead');
            var headRow = document.createElement('tr');
            for (var c = 0; c < segmentColumns.length; c++) {
                var th = document.createElement('th');
                th.textContent = segmentColumns[c];
                if (EDITABLE[c]) th.className = 'editable-head';
                headRow.appendChild(th);
            }
            thead.appendChild(headRow);
            table.appendChild(thead);

            var tbody = document.createElement('tbody');

            for (var r = 0; r < rows.length; r++) {
                var index = rows[r].index;
                var segment = app.network.segments[index];
                var tr = document.createElement('tr');

                var classes = [];
                if (segment.valve && segment.valve.chosenArticle) classes.push('by-hand');
                if (app.selection && app.selection.kind === 'segment' && app.selection.index === index)
                    classes.push('selected');
                if (classes.length > 0) tr.className = classes.join(' ');

                for (var k = 0; k < rows[r].cells.length; k++) {
                    var td = document.createElement('td');

                    if (EDITABLE[k] && !segment.isVirtualLink)
                        td.appendChild(editor(app, segment, k));
                    else
                        td.textContent = rows[r].cells[k];

                    tr.appendChild(td);
                }

                (function (i) {
                    tr.addEventListener('click', function () {
                        app.select({ kind: 'segment', index: i });
                    });
                })(index);

                tbody.appendChild(tr);
            }

            table.appendChild(tbody);

            if (rows.length === 0) {
                var wrap = document.createElement('div');
                var empty = document.createElement('p');
                empty.className = 'empty';
                empty.textContent = 'Пусто. Начертите трубы и нажмите «Расчёт».';
                wrap.appendChild(table);
                wrap.appendChild(empty);
                return wrap;
            }

            return table;
        },

        /**
         * Таблица в разобранном виде: название, столбцы и строки простыми
         * массивами.
         *
         * Нужна записке. Переписывать там таблицы заново значило бы завести
         * второй источник правды, и однажды записка разошлась бы с расчётом —
         * причём незаметно, потому что рядом их никто не держит.
         */
        blockOf: function (name, app) {
            if (name === 'segments') {
                return {
                    title: 'Участки',
                    columns: segmentColumns,
                    rows: segmentRows(app).map(function (row) { return row.cells; })
                };
            }

            var definition = definitions[name];
            var rows = definition.rows(app);

            // У балансировки и проверочного расчёта строки приходят с пометками
            // для разметки; записке нужны только сами ячейки.
            var plain = [];
            for (var i = 0; i < rows.length; i++)
                plain.push(rows[i].cells || rows[i]);

            return { title: definition.title, columns: definition.columns, rows: plain };
        },

        /** Текст таблицы с табуляцией — для буфера обмена и выгрузки в CSV. */
        toText: function (name, app) {
            if (name === 'segments') {
                var rows = segmentRows(app);
                var plain = [];
                for (var i = 0; i < rows.length; i++) plain.push(rows[i].cells);
                return tsv(segmentColumns, plain);
            }

            var definition = definitions[name];
            var data = definition.rows(app);

            // У балансировки строки приходят с пометкой ручного выбора,
            // в текст идут только сами ячейки.
            if (data.length > 0 && data[0].cells) {
                var only = [];
                for (var k = 0; k < data.length; k++) only.push(data[k].cells);
                data = only;
            }

            return tsv(definition.columns, data);
        }
    };
})();
