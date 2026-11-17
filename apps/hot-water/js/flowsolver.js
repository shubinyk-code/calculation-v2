'use strict';

/*
    Подбор циркуляционных расходов из условия «у самого дальнего потребителя не ниже 60 °C».
    Порт HotWaterCirculation/src/FlowSolver.cs.

    Задача неявная: температура на входе в кольцо зависит от расхода в общей магистрали,
    а расход в магистрали складывается из расходов колец. Поэтому решение итерационное.
    Каждое кольцо несёт свой контурный расход, расход участка — сумма контурных расходов
    всех колец, через него проходящих (со знаком: общая магистраль складывает, встречные
    направления вычитают).

    На каждой итерации:
      1. расходы участков собираются из контурных;
      2. по сети разносятся температуры (смешение потоков в узлах);
      3. по текущим температурам пересчитываются теплопотери — остывая, вода теряет меньше;
      4. расход кольца правится в отношении «фактическое падение / допустимое».
    Падение температуры монотонно убывает с ростом расхода, поэтому итерация сходится.
*/

var FlowSolver = (function () {

    /** Доля нового значения в шаге итерации. Без демпфирования расходы раскачиваются. */
    var DAMPING = 0.5;

    /** Предел падения температуры на участке за один проход, К. Защита от деления на почти нулевой расход. */
    var MAX_DROP_PER_SEGMENT = 60.0;

    /** Проходов разноса температур за итерацию. Дерево сходится за один, кольца — за несколько. */
    var TEMPERATURE_PASSES = 60;

    /**
     * Для каждого кольца — знак каждого его участка при обходе от источника.
     * Без этого нельзя сложить контурные расходы: в общей магистрали они
     * складываются, а на встречных ветках вычитаются.
     */
    function buildDirections(network, rings) {
        var directions = [];

        for (var i = 0; i < rings.length; i++) {
            var ring = rings[i];
            var signs = [];

            // Обход начинается от источника этого кольца, а не от первого
            // в проекте: у каждой зоны ИТП свой выход.
            var node = ring.sourceNode >= 0 ? ring.sourceNode : network.sourceNode;

            for (var k = 0; k < ring.segments.length; k++) {
                var segment = network.segments[ring.segments[k]];

                if (segment.nodeA === node) {
                    signs.push(1);
                    node = segment.nodeB;
                } else if (segment.nodeB === node) {
                    signs.push(-1);
                    node = segment.nodeA;
                } else {
                    // Путь разорван — дальше знаки бессмысленны.
                    signs.push(0);
                    ring.note = 'путь кольца не сходится: обход прервался';
                    break;
                }
            }

            directions.push(signs);
        }

        return directions;
    }

    function distributeFlows(network, rings, directions, flows) {
        var signed = new Float64Array(network.segments.length);
        var i, k;

        for (i = 0; i < rings.length; i++) {
            var ring = rings[i];
            var signs = directions[i];

            for (k = 0; k < ring.segments.length && k < signs.length; k++)
                signed[ring.segments[k]] += signs[k] * flows[i];
        }

        for (i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            var value = signed[i];

            segment.flow = Math.abs(value);

            if (value > 1e-9) segment.flowDirection = 1;
            else if (value < -1e-9) segment.flowDirection = -1;
            else segment.flowDirection = 0;
        }
    }

    function resetTemperatures(network, settings) {
        var i;
        for (i = 0; i < network.nodes.length; i++)
            network.nodes[i].temperature = settings.supplyTemperature;

        for (i = 0; i < network.segments.length; i++) {
            network.segments[i].temperatureIn = settings.supplyTemperature;
            network.segments[i].temperatureOut = settings.supplyTemperature;
        }
    }

    /** Падение температуры на участке, К: ΔT = Q/(c·G). */
    function dropAcross(segment) {
        var kgPerSecond = segment.flow / 3600.0;
        if (kgPerSecond <= 1e-9 || segment.heatLoss <= 0.0)
            return 0.0;

        var drop = segment.heatLoss / (HEAT_CAPACITY_J * kgPerSecond);
        return Math.min(drop, MAX_DROP_PER_SEGMENT);
    }

    /**
     * Разнос температур по сети. В узле потоки смешиваются, поэтому температура узла —
     * среднее по входящим расходам, а не по участкам.
     */
    function propagateTemperatures(network, settings) {
        var count = network.nodes.length;
        var outlet = new Float64Array(network.segments.length);
        var numerator = new Float64Array(count);
        var denominator = new Float64Array(count);
        var i, s, segment;

        for (i = 0; i < count; i++)
            network.nodes[i].temperature = settings.supplyTemperature;

        for (var pass = 0; pass < TEMPERATURE_PASSES; pass++) {
            for (s = 0; s < network.segments.length; s++) {
                segment = network.segments[s];

                if (segment.flowDirection === 0) {
                    outlet[s] = settings.supplyTemperature;
                    continue;
                }

                var upstream = segment.flowDirection > 0 ? segment.nodeA : segment.nodeB;
                outlet[s] = network.nodes[upstream].temperature - dropAcross(segment);
            }

            for (i = 0; i < count; i++) {
                numerator[i] = 0.0;
                denominator[i] = 0.0;
            }

            for (s = 0; s < network.segments.length; s++) {
                segment = network.segments[s];
                if (segment.flowDirection === 0)
                    continue;

                var downstream = segment.flowDirection > 0 ? segment.nodeB : segment.nodeA;
                numerator[downstream] += segment.flow * outlet[s];
                denominator[downstream] += segment.flow;
            }

            for (i = 0; i < count; i++) {
                // Из любого выхода ИТП всегда идут расчётные 65 °C.
                if (network.isSupplySource(i))
                    continue;
                if (denominator[i] > 1e-9)
                    network.nodes[i].temperature = numerator[i] / denominator[i];
            }
        }

        for (s = 0; s < network.segments.length; s++) {
            segment = network.segments[s];

            if (segment.flowDirection === 0) {
                segment.temperatureIn = settings.supplyTemperature;
                segment.temperatureOut = settings.supplyTemperature;
                continue;
            }

            var up = segment.flowDirection > 0 ? segment.nodeA : segment.nodeB;
            segment.temperatureIn = network.nodes[up].temperature;
            segment.temperatureOut = outlet[s];
        }
    }

    function readRingTemperatures(network, rings) {
        for (var i = 0; i < rings.length; i++) {
            var ring = rings[i];
            if (ring.linkIndex < 0) continue;

            // Самая дальняя точка кольца — узел перед перемычкой на подающей стороне.
            // Она определена при сборке кольца: у нарисованной рукой перемычки
            // подающий конец бывает и первым, и вторым.
            var far = ring.farNode >= 0
                ? ring.farNode
                : network.segments[ring.linkIndex].nodeA;

            ring.temperatureAtEnd = network.nodes[far].temperature;
        }
    }

    /** Расход, кг/ч, компенсирующий заданные теплопотери при заданном перепаде. */
    function flowForHeat(heatWatts, deltaT) {
        if (deltaT <= 1e-6 || heatWatts <= 0.0)
            return 0.0;

        return heatWatts / (HEAT_CAPACITY_J * deltaT) * 3600.0;
    }

    /**
     * Теплопотери участков, принадлежащих только этому кольцу, Вт.
     * role = PipeRole.None считает всё кольцо, Supply — только подающую часть.
     */
    function ownHeat(network, ring, role) {
        var total = 0.0;
        for (var i = 0; i < ring.ownSegments.length; i++) {
            var segment = network.segments[ring.ownSegments[i]];
            if (role !== PipeRole.None && segment.role !== role)
                continue;
            total += segment.heatLoss;
        }
        return total;
    }

    function suggestDiameters(network, settings) {
        for (var i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            if (!segment.isCirculating || segment.isVirtualLink)
                continue;

            segment.suggestedDiameterMm = Hydraulics.suggestNominal(
                segment.flow, segment.nominalDiameterMm, settings);
        }
    }

    /**
     * Сведение итогов по зонам. Вынесено отдельно: этим же пользуется расчёт
     * по формуле СП, и расходиться двум сводкам нельзя.
     */
    function aggregateZones(network, settings) {
        for (var z = 0; z < network.zones.length; z++) {
            var zone = network.zones[z];

            zone.heatLoss = 0.0;
            zone.heatLossSupply = 0.0;
            zone.heatLossReturn = 0.0;
            zone.towelHeat = 0.0;
            zone.towelCount = 0;
            zone.lengthSupply = 0.0;
            zone.lengthReturn = 0.0;
            zone.flow = 0.0;
            zone.minTemperature = settings.supplyTemperature;

            // Теплопотери разносятся по системам: Т3 отвечает за температуру
            // у потребителя, Т4 только нагружает ИТП, а полотенцесушители — вообще
            // не труба. Складывать их в одно число значит терять смысл каждого.
            for (var i = 0; i < zone.segments.length; i++) {
                var segment = network.segments[zone.segments[i]];
                zone.heatLoss += segment.heatLoss;

                if (!segment.isCirculating || segment.isVirtualLink)
                    continue;

                var towel = segment.towelRailCount * settings.towelRailWatts;
                zone.towelHeat += towel;
                zone.towelCount += segment.towelRailCount;

                var pipes = segment.heatLoss - towel;
                if (pipes < 0.0) pipes = 0.0;

                if (segment.role === PipeRole.Supply) {
                    zone.heatLossSupply += pipes;
                    zone.lengthSupply += segment.length;
                } else if (segment.role === PipeRole.Return) {
                    zone.heatLossReturn += pipes;
                    zone.lengthReturn += segment.length;
                }
            }

            for (var r = 0; r < zone.rings.length; r++) {
                var ring = network.rings[zone.rings[r]];
                zone.flow += ring.flow;
                if (ring.temperatureAtEnd < zone.minTemperature)
                    zone.minTemperature = ring.temperatureAtEnd;
            }

            mixReturn(network, settings, zone);
        }
    }

    /**
     * Обратка на вводе ИТП: смешение всех циркуляционных веток, пришедших
     * на вход Т4.
     *
     * Зачем отдельное число. Худшая точка зоны — это самая холодная ветка,
     * и она отвечает за кран у потребителя. Теплообменник же греет воду уже
     * перемешанную: одна ветка пришла с 58 °C, другая с 63 °C, и подогревать
     * надо от их смеси. Считать подогрев от худшей точки значило бы завысить
     * нагрузку, а от расчётной подачи — вовсе её потерять.
     *
     * Смешение идёт по расходам, а не по числу веток: ветка с втрое большим
     * расходом и весит втрое. Берутся участки Т4, которые действительно
     * доходят до ввода, — у остальных смешиваться ещё негде.
     */
    function mixReturn(network, settings, zone) {
        var weighted = 0.0;
        var flow = 0.0;

        for (var i = 0; i < zone.segments.length; i++) {
            var segment = network.segments[zone.segments[i]];

            if (segment.flowDirection === 0 || segment.isVirtualLink)
                continue;
            if (segment.role !== PipeRole.Return)
                continue;

            /*
                Куда участок отдаёт воду. Признак ввода — что это узел ИТП
                и что приходит в него циркуляционный трубопровод.

                Проверять дополнительно, что узел «не подающий», нельзя:
                ИТП бывает отмечен одним слитым узлом — так его размечает
                плагин, — и тогда этот же узел считается и выходом подачи.
                С такой проверкой обратка не находилась бы вовсе, а подогрев
                молча выходил бы нулевым.
            */
            var downstream = segment.flowDirection > 0 ? segment.nodeB : segment.nodeA;
            if (!network.isSource(downstream))
                continue;

            weighted += segment.flow * segment.temperatureOut;
            flow += segment.flow;
        }

        zone.returnFlow = flow;

        /*
            Обратка не нашлась — сеть не замкнута на ИТП. Тогда показывается
            расчётная подача и нулевой подогрев: это честнее нуля градусов,
            из которого вышел бы подогрев в 65 К и нагрузка в сотни киловатт.
        */
        zone.returnTemperature = flow > 1e-9
            ? weighted / flow
            : settings.supplyTemperature;

        zone.itpDeltaT = settings.supplyTemperature - zone.returnTemperature;
        zone.itpHeat = HEAT_CAPACITY_J * (flow / 3600.0) * zone.itpDeltaT;
    }

    function join(existing, addition) {
        if (!existing) return addition;
        return existing + '; ' + addition;
    }

    function summarise(network, settings, iterations) {
        var totalHeat = HeatLoss.total(network);
        aggregateZones(network, settings);

        var byNorm = HeatLoss.circulationFlowByNorm(totalHeat, settings);
        var bySolve = 0.0;
        var i;

        for (i = 0; i < network.rings.length; i++)
            bySolve += network.rings[i].flow;

        network.diagnostics.push('Итераций подбора расходов: ' + Fmt.int(iterations)
            + '. Суммарные теплопотери кольцевых участков: ' + Fmt.kilowatts(totalHeat) + ' кВт.');

        network.diagnostics.push('Общий циркуляционный расход подбором: ' + Fmt.flowLs(bySolve)
            + ' л/с; по формуле q_cir = β·ΣQ/(c·Δt) при Δt = '
            + Fmt.num(settings.deltaT) + ' К: ' + Fmt.flowLs(byNorm) + ' л/с.');

        // Подбор ведётся по условию 60 °C у потребителя, то есть по остыванию в Т3.
        // Формула СП берёт теплопотери всей системы, включая Т4, и потому обычно даёт
        // больше. Расхождение показывается, решение — за проектировщиком.
        if (byNorm > bySolve * 1.05) {
            network.diagnostics.push('Расход по формуле СП выше подобранного в '
                + Fmt.fixed(byNorm / Math.max(bySolve, 1e-6), 2) + ' раза. '
                + 'Подбор обеспечивает 60 °C у потребителя, формула дополнительно '
                + 'компенсирует остывание обратки Т4. Если нужен запас — принимайте больший.');
        }

        for (i = 0; i < network.rings.length; i++) {
            var ring = network.rings[i];
            if (ring.segments.length === 0)
                continue;

            if (ring.temperatureAtEnd < settings.requiredTemperature - 0.05) {
                ring.note = join(ring.note,
                    'температура в конце ниже требуемой даже при подобранном расходе');
                network.diagnostics.push('Кольцо ' + Fmt.int(ring.number) + ': на дальнем участке '
                    + Fmt.temperature(ring.temperatureAtEnd) + ' °C — ниже требуемых '
                    + Fmt.num(settings.requiredTemperature) + ' °C. '
                    + 'Расход упёрся в ограничение: проверьте диаметры и изоляцию.');
            }
        }
    }

    function solve(network, settings) {
        var rings = [];
        var i;

        for (i = 0; i < network.rings.length; i++) {
            if (network.rings[i].segments.length > 0)
                rings.push(network.rings[i]);
        }

        if (rings.length === 0) {
            network.diagnostics.push('Расчёт расходов не выполнен: нет ни одного собранного кольца.');
            return;
        }

        var allowedDrop = settings.supplyTemperature - settings.requiredTemperature;
        if (allowedDrop <= 0.1) {
            network.diagnostics.push('Температура подачи не выше требуемой у потребителя — '
                + 'компенсировать теплопотери нечем. Проверьте настройки.');
            return;
        }

        var directions = buildDirections(network, rings);

        resetTemperatures(network, settings);
        HeatLoss.apply(network, settings);

        var flows = new Float64Array(rings.length);
        var floors = new Float64Array(rings.length);

        for (i = 0; i < rings.length; i++) {
            // Нижняя оценка берётся по теплопотерям ПОДАЮЩЕЙ части кольца.
            // До потребителя вода идёт только по Т3, и требование «не ниже 60 °C»
            // ограничивает именно этот путь. Остывание обратки Т4 происходит уже
            // после потребителя: оно нагружает ИТП, но температуру у крана не меняет.
            floors[i] = flowForHeat(ownHeat(network, rings[i], PipeRole.Supply), allowedDrop);
            flows[i] = Math.max(floors[i], 1.0);
        }

        var iterations = 0;
        for (; iterations < settings.maxIterations; iterations++) {
            distributeFlows(network, rings, directions, flows);
            propagateTemperatures(network, settings);
            HeatLoss.apply(network, settings);
            readRingTemperatures(network, rings);

            var change = 0.0;

            for (i = 0; i < rings.length; i++) {
                var drop = settings.supplyTemperature - rings[i].temperatureAtEnd;
                var target;

                if (drop <= 1e-6) {
                    target = floors[i];
                } else {
                    target = flows[i] * drop / allowedDrop;

                    // Шаг ограничен вчетверо в обе стороны: на первых итерациях
                    // отношение падений бывает огромным, и без ограничения расход
                    // улетает в тысячи тонн за проход.
                    target = Math.min(target, flows[i] * 4.0);
                    target = Math.max(target, flows[i] * 0.25);
                }

                target = Math.max(target, Math.max(floors[i], 0.1));

                var relative = Math.abs(target - flows[i]) / Math.max(flows[i], 1e-6);
                if (relative > change)
                    change = relative;

                flows[i] = DAMPING * target + (1.0 - DAMPING) * flows[i];
            }

            if (change < settings.convergence)
                break;
        }

        distributeFlows(network, rings, directions, flows);
        propagateTemperatures(network, settings);
        HeatLoss.apply(network, settings);
        readRingTemperatures(network, rings);
        Hydraulics.apply(network, settings);

        for (i = 0; i < rings.length; i++) {
            rings[i].flow = flows[i];
            rings[i].heatLoss = ownHeat(network, rings[i], PipeRole.None);
        }

        suggestDiameters(network, settings);
        summarise(network, settings, iterations);
    }

    return {
        solve: solve,
        buildDirections: buildDirections,
        distributeFlows: distributeFlows,
        propagateTemperatures: propagateTemperatures,
        readRingTemperatures: readRingTemperatures,
        flowForHeat: flowForHeat,
        ownHeat: ownHeat,
        suggestDiameters: suggestDiameters,
        aggregateZones: aggregateZones,
        join: join
    };
})();
