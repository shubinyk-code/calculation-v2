'use strict';

/*
    Оркестратор расчёта: от сети к таблицам.

    Порядок повторяет плагин и менять его нельзя — каждый шаг опирается
    на результат предыдущего:

      1. зоны        — участки разложены по системам, снятые с расчёта исключены;
      2. кольца      — мосты по Тарьяну, разделение кольцевых и тупиковых, нумерация;
      3. расходы     — подбор из условия 60 °C либо расчёт по формуле СП;
      4. увязка      — сравнение колец, подбор клапанов;
      5. сводка      — итоги по зонам вместе с напором насоса.

    Считать теплопотери до разбора колец бессмысленно: неизвестно, какие участки
    кольцевые. Увязывать до расчёта расходов тоже: Kv зависит от расхода.
*/

var Calc = {

    /**
     * Полный прогон. Возвращает саму сеть — таблицы читают её напрямую,
     * промежуточного объекта результатов нет намеренно: он мог бы разойтись
     * с сетью, которую тут же правят в таблице.
     */
    run: function (network, settings) {
        network.clearResults();

        /*
            Пары ИТП разбираются ПЕРВЫМИ, до раскладки по зонам.

            Порядок здесь не вкусовой: pairSources снимает соединения прошлого
            прогона и перенумеровывает участки. Если к этому моменту зоны уже
            собраны, их списки индексов указывают на сдвинувшиеся участки —
            и расчёт молча идёт не по тем трубам. Ловится это только тогда,
            когда трубу дорисовали уже после первого расчёта.
        */
        Calc.pairSources(network);
        Calc.assignZones(network, settings);
        Calc.applyExclusions(network);

        if (network.sourceNodes.length === 0) {
            network.diagnostics.push('ИТП не поставлен. Пока не указан выход Т3 и вход Т4, '
                + 'в сети нет ни одного цикла и кольца не собираются.');
        }

        RingFinder.run(network);
        Calc.reportOpenEnds(network, settings);

        if (settings.useNormMethod)
            NormSolver.solve(network, settings);
        else
            FlowSolver.solve(network, settings);

        Balancing.apply(network, settings);
        FlowSolver.aggregateZones(network, settings);

        // Насос подбирается последним: ему нужны и расход зоны, и потери
        // самого невыгодного кольца уже вместе с клапанами.
        PumpSelector.apply(network, settings);
        Calc.reportPumpHead(network);
        Calc.reportReturnTemperature(network, settings);

        return network;
    },

    /**
     * Раскладка участков по зонам. Зона выводится из имени системы: у Т3.1 и Т4.1
     * остаток имени одинаков, значит это одна зона — подающая и циркуляционная
     * её части.
     */
    assignZones: function (network, settings) {
        var i, zone;

        for (i = 0; i < network.zones.length; i++) {
            network.zones[i].segments = [];
            network.zones[i].supplyNames = [];
            network.zones[i].returnNames = [];
        }

        for (i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];

            // Перемычка наследует зону того, что связывает, и своей роли не имеет.
            if (!segment.zoneKey && segment.systemName) {
                var info = SystemNaming.parse(segment.systemName);
                segment.zoneKey = info.zoneKey;
                if (segment.role === PipeRole.None)
                    segment.role = info.role;
            }

            if (!segment.zoneKey)
                continue;

            zone = network.zoneEnsure(segment.zoneKey, segment.zoneKey);
            zone.segments.push(i);

            /*
                В подпись зоны идут только имена настоящих Т3 и Т4.

                У перемычек своей роли нет, а имя есть: плагин называет их
                «перемычка». Раньше всё, что не Т4, считалось подачей, и зона
                получала подпись «Т3, перемычка / Т4» — в отчёте это выглядит
                как система, которой в проекте нет.
            */
            if (segment.systemName && !segment.isVirtualLink) {
                var list = segment.role === PipeRole.Return ? zone.returnNames
                    : (segment.role === PipeRole.Supply ? zone.supplyNames : null);

                if (list && list.indexOf(segment.systemName) < 0)
                    list.push(segment.systemName);
            }
        }

        // Зоны без единого участка остаются в списке: человек мог их завести заранее,
        // и молча стирать заведённое нельзя.
        for (i = 0; i < network.zones.length; i++) {
            zone = network.zones[i];
            var caption = SystemNaming.makeCaption(zone.supplyNames, zone.returnNames);
            if (caption !== '—')
                zone.caption = caption;
        }
    },

    /**
     * Разбор помеченных узлов ИТП на пары «выход Т3 — вход Т4» и замыкание каждой
     * пары условным соединением.
     *
     * Зачем это нужно. Т3 и Т4 сходятся только на перемычках у потребителей,
     * а у ИТП обрываются порознь: выход подачи и вход обратки — два разных узла.
     * Пока они не соединены, в графе нет ни одного цикла, все участки оказываются
     * мостами, и кольцевые от тупиковых не отделяются вовсе.
     *
     * Плагин сливает такую пару в один узел. Здесь вместо слияния ставится
     * соединение нулевой длины: результат тот же — цикл появляется, — но чертёж
     * остаётся каким его нарисовали, и снять ИТП можно, ничего не разрушив.
     *
     * Узел, у которого сходятся и Т3, и Т4, уже сам себе пара: так выглядит
     * ИТП, нарисованный одной точкой, и достраивать ему нечего.
     */
    pairSources: function (network) {
        var i;

        // Соединения прошлого прогона снимаются: пары могли измениться.
        var kept = [];
        for (i = 0; i < network.segments.length; i++) {
            if (!network.segments[i].isSourceLink)
                kept.push(network.segments[i]);
        }
        if (kept.length !== network.segments.length) {
            network.segments = kept;
            network.reindex();
        }

        network.supplySourceNodes = [];

        if (network.sourceNodes.length === 0)
            return;

        var supplyEnds = [];
        var returnEnds = [];
        var lone = [];

        for (i = 0; i < network.sourceNodes.length; i++) {
            var node = network.sourceNodes[i];
            if (node < 0 || node >= network.nodes.length) continue;

            var roles = rolesAt(network, node);

            if (roles.supply && roles.circulation) {
                // Уже слитый узел: и подача, и обратка на нём.
                network.supplySourceNodes.push(node);
            } else if (roles.supply) {
                supplyEnds.push(node);
            } else if (roles.circulation) {
                returnEnds.push(node);
            } else {
                lone.push(node);
            }
        }

        var paired = 0;
        var taken = {};

        for (i = 0; i < supplyEnds.length; i++) {
            var supply = supplyEnds[i];
            var partner = nearestFree(network, supply, returnEnds, taken);

            if (partner < 0)
                continue;

            taken[partner] = true;
            paired++;

            var link = network.addSegment(supply, partner);
            link.isVirtualLink = true;
            link.isSourceLink = true;
            link.role = PipeRole.None;
            link.zoneKey = zoneAt(network, supply);
            link.length = 0.0;

            network.supplySourceNodes.push(supply);
        }

        if (paired > 0) {
            network.diagnostics.push('Выходов ИТП собрано в пары «Т3 — Т4»: ' + Fmt.int(paired)
                + '. Выход подачи и вход обратки замкнуты внутри ИТП — только после этого '
                + 'в графе появляется цикл, по которому и отделяются кольцевые участки.');
        }

        var orphanSupply = supplyEnds.length - paired;
        if (orphanSupply > 0) {
            network.diagnostics.push('Помеченных выходов Т3 без пары: ' + Fmt.int(orphanSupply)
                + '. Отметьте инструментом «ИТП» ещё и узел, куда приходит Т4: '
                + 'без него кольцо не замкнётся.');
        }

        var orphanReturn = 0;
        for (i = 0; i < returnEnds.length; i++) {
            if (!taken[returnEnds[i]]) orphanReturn++;
        }

        if (orphanReturn > 0) {
            network.diagnostics.push('Помеченных входов Т4 без пары: ' + Fmt.int(orphanReturn)
                + '. Отметьте узел, из которого выходит Т3 этой же зоны.');
        }

        if (lone.length > 0) {
            network.diagnostics.push('Узлов, помеченных как ИТП, но не подключённых '
                + 'ни к Т3, ни к Т4: ' + Fmt.int(lone.length) + '. Пометка на них ничего не даёт.');
        }
    },

    /**
     * Незамкнутые концы труб и пары, которые стоят рядом, но не соединены.
     *
     * Это самая частая причина «кольца не найдено» при черчении: конец Т3 и конец
     * Т4 нарисованы в сантиметре друг от друга, на глаз стояк выглядит замкнутым,
     * а перемычки между ними нет. Найти такое место глазами на плотной схеме
     * почти невозможно, поэтому программа обязана назвать его сама.
     */
    reportOpenEnds: function (network, settings) {
        var open = [];
        var i;

        for (i = 0; i < network.nodes.length; i++) {
            if (network.nodes[i].segments.length !== 1) continue;
            if (network.isSource(i)) continue;
            open.push(i);
        }

        if (open.length === 0)
            return;

        // Радиус поиска шире допуска замыкания: поднимать сам допуск ради одного
        // забытого стояка нельзя — он тут же наловит ложных срабатываний по всей сети.
        var radius = Math.min(2.0, settings.linkToleranceMm / 1000.0 * 25.0);
        var pairs = NetworkEdit.findCandidates(network, radius);

        var closeable = [];
        for (i = 0; i < pairs.length; i++) {
            if (!pairs[i].sameSystem)
                closeable.push(pairs[i]);
        }

        if (closeable.length > 0) {
            var lines = [];
            for (i = 0; i < closeable.length && i < 8; i++) {
                var pair = closeable[i];
                var point = network.nodes[pair.a.node].point3d;

                lines.push('отметка ' + Fmt.length(point.z) + ' м (X ≈ '
                    + Fmt.length(point.x) + ') — зазор ' + Fmt.fixed(pair.gapMm, 0) + ' мм');
            }

            network.diagnostics.push('Концы Т3 и Т4 стоят рядом, но не соединены: '
                + Fmt.int(closeable.length) + ' ' + Fmt.plural(closeable.length, 'место', 'места', 'мест')
                + '. Это и есть незамкнутые стояки — кольцо через них не собирается. '
                + Fmt.plural(closeable.length, 'Оно', 'Они', 'Они') + ': '
                + lines.join('; ')
                + (closeable.length > 8 ? ' и другие' : '')
                + '. Нарисуйте перемычку инструментом «Перемычка Т3–Т4» либо нажмите '
                + '«Замкнуть близкие концы» над схемой.');
        }

        network.diagnostics.push('Незаконченных концов труб: ' + Fmt.int(open.length)
            + '. На схеме они помечены кружком: труба обрывается и никуда не ведёт.');
    },

    /** Зона, снятая галочкой, целиком выпадает из расчёта. */
    applyExclusions: function (network) {
        var excluded = {};
        var i;

        for (i = 0; i < network.zones.length; i++) {
            if (!network.zones[i].isEnabled)
                excluded[network.zones[i].key] = true;
        }

        for (i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            segment.isExcluded = !!(segment.zoneKey && excluded[segment.zoneKey]);
        }
    },

    /**
     * Напор, который должен развить циркуляционный насос зоны, — потери самого
     * невыгодного кольца вместе с клапанами. Считается по настоящей плотности
     * горячей воды, а не по 1000 кг/м³.
     */
    reportPumpHead: function (network) {
        for (var i = 0; i < network.zones.length; i++) {
            var zone = network.zones[i];
            if (zone.worstDrop <= 1e-9)
                continue;

            var line = 'Зона ' + zone.caption + ': требуемый напор насоса '
                + Fmt.pressure(zone.worstDrop) + ' кПа ('
                + Fmt.head(zone.worstDrop) + ' м вод. ст.) при расходе '
                + Fmt.flowLs(zone.flow) + ' л/с — по кольцу № '
                + Fmt.int(zone.worstRingNumber) + '.';

            if (zone.pump && zone.pump.model) {
                line += ' Подобран ' + zone.pump.model.brand + ' '
                    + zone.pump.model.model + ', запас '
                    + Fmt.num(zone.pump.margin) + '-кратный (данные каталога '
                    + 'ориентировочные, сверьте с паспортом).';
            } else if (zone.pump && zone.pump.note) {
                line += ' Насос не подобран: ' + zone.pump.note + '.';
            }

            network.diagnostics.push(line);
        }
    },

    /**
     * Обратка на вводе ИТП — число для теплообменника, а не для крана.
     *
     * Пишется в диагностику рядом с напором, потому что спрашивают их вместе:
     * насос по напору и расходу, теплообменник по подогреву. Проверка
     * c·G·Δt против суммы теплопотерь зоны стоит здесь же: если эти два числа
     * разошлись, значит расход и температуры посчитаны по разным сетям,
     * и верить нельзя ни тому, ни другому.
     */
    reportReturnTemperature: function (network, settings) {
        for (var i = 0; i < network.zones.length; i++) {
            var zone = network.zones[i];
            if (zone.rings.length === 0) continue;

            if (zone.returnFlow <= 1e-9) {
                network.diagnostics.push('Зона ' + zone.caption + ': обратка до ИТП '
                    + 'не доходит — ни один участок Т4 не замкнут на ввод. '
                    + 'Подогрев в ИТП посчитать не из чего.');
                continue;
            }

            network.diagnostics.push('Зона ' + zone.caption + ': обратка на вводе ИТП '
                + Fmt.temperature(zone.returnTemperature) + ' °C, подогрев '
                + Fmt.num(zone.itpDeltaT) + ' К, нагрузка на циркуляцию '
                + Fmt.kilowatts(zone.itpHeat) + ' кВт при теплопотерях '
                + Fmt.kilowatts(zone.heatLoss) + ' кВт.');

            var gap = Math.abs(zone.itpHeat - zone.heatLoss);
            if (zone.heatLoss > 1.0 && gap / zone.heatLoss > 0.05) {
                network.diagnostics.push('Зона ' + zone.caption + ': подогрев по обратке '
                    + 'расходится с теплопотерями на ' + Fmt.percent(gap / zone.heatLoss)
                    + ' %. Так бывает, когда часть Т4 не кольцевая или расход '
                    + 'задан не подбором — сверьте, прежде чем брать нагрузку в ИТП.');
            }
        }
    },

    /**
     * Размеры участка по каталогу. Возвращает false, если такого размера
     * у материала нет: тогда прежние числа сохраняются, а не подменяются молча.
     */
    applySize: function (segment, materialName, nominalMm) {
        var size = PipeCatalog.find(materialName, nominalMm);
        if (!size) return false;

        segment.material = materialName;
        segment.nominalDiameterMm = size.nominalMm;
        segment.outerDiameter = size.outer;
        segment.innerDiameter = size.inner;
        return true;
    },

    /** Изоляция участка по названию и толщине в миллиметрах. */
    applyInsulation: function (segment, kindName, thicknessMm) {
        var lambda = InsulationCatalog.lambdaOf(kindName);

        if (lambda <= 1e-9) {
            segment.insulationName = 'нет';
            segment.insulationThickness = 0.0;
            segment.insulationLambda = 0.0;
            return;
        }

        segment.insulationName = kindName;
        segment.insulationThickness = thicknessMm / 1000.0;
        segment.insulationLambda = lambda;
    }
};

/** Какие роли трубопроводов сходятся в узле. Перемычки и сшивки роли не несут. */
function rolesAt(network, node) {
    var result = { supply: false, circulation: false };
    var list = network.nodes[node].segments;

    for (var i = 0; i < list.length; i++) {
        var segment = network.segments[list[i]];
        if (!segment || segment.isVirtualLink) continue;

        if (segment.role === PipeRole.Supply) result.supply = true;
        else if (segment.role === PipeRole.Return) result.circulation = true;
    }

    return result;
}

/** Зона трубопровода, подходящего к узлу. */
function zoneAt(network, node) {
    var list = network.nodes[node].segments;

    for (var i = 0; i < list.length; i++) {
        var segment = network.segments[list[i]];
        if (segment && !segment.isVirtualLink && segment.zoneKey)
            return segment.zoneKey;
    }

    return null;
}

/**
 * Ближайший свободный узел из списка. Сначала перебираются узлы своей зоны,
 * потом чужие: имя системы что-то значит, но одного его мало — в ИТП выходы
 * разных зон стоят рядом, и геометрия решает.
 */
function nearestFree(network, from, candidates, taken) {
    var ownZone = zoneAt(network, from);
    var best = -1;
    var bestKey = null;

    for (var i = 0; i < candidates.length; i++) {
        var node = candidates[i];
        if (taken[node]) continue;

        var sameZone = zoneAt(network, node) === ownZone;
        var distance = network.nodes[from].point3d.distanceTo(network.nodes[node].point3d);
        var key = (sameZone ? 0 : 1) * 1e9 + distance;

        if (bestKey === null || key < bestKey) {
            bestKey = key;
            best = node;
        }
    }

    return best;
}
