'use strict';

/*
    Расчёт по формуле СП, без подбора расходов — вторая ветвь, для сверки с подбором.
    Порт HotWaterCirculation/src/NormSolver.cs.

    Ход прямой, в один проход:
      1. теплопотери всех кольцевых трубопроводов при средней температуре системы,
         с учётом опор и арматуры;
      2. общий циркуляционный расход из ИТП по формуле q_cir = β·ΣQ/(c·Δt),
         где Δt берётся из исходных данных;
      3. этот расход разносится сверху вниз: в каждом узле он делится между ветками
         пропорционально теплопотерям того, что за этими ветками;
      4. по полученным расходам разносятся температуры и считается гидравлика.

    Ключевое отличие от подбора: температура здесь — следствие, а не условие.
    Расход назначается формулой, и 60 °C у дальнего потребителя может не получиться.

    Деление в каждом узле пропорционально теплопотерям за узлом равносильно одному
    общему делению: доли перемножаются по пути и телескопируются. Поэтому расход
    кольца считается сразу как доля его собственных теплопотерь в сумме собственных
    теплопотерь всех колец.
*/

var NormSolver = (function () {

    /**
     * Теплопотери кольцевых участков заданной роли, Вт.
     * role = PipeRole.None складывает всё: и Т3, и Т4, и полотенцесушители.
     */
    function heatFor(network, role) {
        if (role === PipeRole.None)
            return HeatLoss.total(network);

        var total = 0.0;
        for (var i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            if (!segment.isCirculating || segment.isVirtualLink)
                continue;
            if (segment.role !== role)
                continue;

            total += segment.heatLoss;
        }

        return total;
    }

    /** Температура воды, при которой считаются теплопотери, — одна на всю сеть. */
    function fixTemperatures(network, temperature) {
        var i;
        for (i = 0; i < network.nodes.length; i++)
            network.nodes[i].temperature = temperature;

        for (i = 0; i < network.segments.length; i++) {
            network.segments[i].temperatureIn = temperature;
            network.segments[i].temperatureOut = temperature;
        }
    }

    /**
     * Разнос общего расхода по кольцам пропорционально их собственным теплопотерям.
     * Собственные — это участки, принадлежащие только этому кольцу: именно они
     * и составляют «то, что за узлом», когда поток на узле делится.
     */
    function distribute(network, rings, totalFlow, basis) {
        var own = new Float64Array(rings.length);
        var flows = new Float64Array(rings.length);
        var sum = 0.0;
        var i;

        for (i = 0; i < rings.length; i++) {
            // База деления та же, что и база формулы: иначе сумма долей
            // разойдётся с общим расходом.
            own[i] = FlowSolver.ownHeat(network, rings[i], basis);
            sum += own[i];
        }

        if (sum <= 1e-9) {
            // Теплопотерь нет вовсе — делить пропорционально нечему, остаётся поровну.
            for (i = 0; i < rings.length; i++)
                flows[i] = totalFlow / rings.length;

            network.diagnostics.push('Расчёт по СП: собственные теплопотери колец нулевые, '
                + 'расход разделён поровну. Проверьте изоляцию и условия прокладки.');
            return flows;
        }

        for (i = 0; i < rings.length; i++)
            flows[i] = totalFlow * own[i] / sum;

        return flows;
    }

    function report(network, settings, rings, totalHeat, totalFlow, meanTemperature, basis) {
        var what = basis === PipeRole.Supply
            ? 'только подающих Т3'
            : 'всей системы Т3 и Т4';

        network.diagnostics.push('Расчёт по формуле СП, без подбора расходов. '
            + 'Теплопотери ' + what + ' посчитаны один раз при средней температуре '
            + Fmt.temperature(meanTemperature) + ' °C: '
            + Fmt.kilowatts(totalHeat) + ' кВт.');

        if (basis === PipeRole.Supply) {
            network.diagnostics.push('В формулу взяты теплопотери только Т3: до потребителя '
                + 'вода идёт по подающим, и остывание именно в них определяет температуру '
                + 'у крана. Буква СП требует ΣQ по всей системе — это запас, снимается '
                + 'галочкой в исходных данных.');
        }

        network.diagnostics.push('Общий циркуляционный расход q_cir = β·ΣQ/(c·Δt) при β = '
            + Fmt.num(settings.beta) + ' и Δt = ' + Fmt.num(settings.deltaT)
            + ' К: ' + Fmt.flowLs(totalFlow) + ' л/с. Разнесён по кольцам пропорционально '
            + 'их собственным теплопотерям.');

        var cold = 0;
        var worst = settings.supplyTemperature;

        for (var i = 0; i < rings.length; i++) {
            var ring = rings[i];
            if (ring.temperatureAtEnd < worst)
                worst = ring.temperatureAtEnd;

            if (ring.temperatureAtEnd < settings.requiredTemperature - 0.05) {
                cold++;
                ring.note = FlowSolver.join(ring.note,
                    'при расходе по СП температура в конце ниже требуемой');
            }
        }

        if (cold > 0) {
            // Ради этого сравнение и затевается: формула назначает расход, не спрашивая
            // о температуре, и на длинных кольцах её может не хватить.
            network.diagnostics.push('Колец, где при расходе по СП температура в конце ниже '
                + Fmt.num(settings.requiredTemperature) + ' °C: ' + Fmt.int(cold)
                + ' из ' + Fmt.int(rings.length) + '. Худшая точка '
                + Fmt.temperature(worst) + ' °C. '
                + 'Формула назначает расход по суммарным теплопотерям и температуру '
                + 'у дальнего потребителя не проверяет — на длинных кольцах её не хватает. '
                + 'Сравните с расчётом подбором.');
        } else {
            network.diagnostics.push('При расходе по СП все кольца укладываются в '
                + Fmt.num(settings.requiredTemperature) + ' °C, худшая точка '
                + Fmt.temperature(worst) + ' °C.');
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
            network.diagnostics.push('Расчёт по СП не выполнен: нет ни одного собранного кольца.');
            return;
        }

        if (settings.deltaT <= 1e-6) {
            network.diagnostics.push('Расчёт по СП не выполнен: перепад Δt в исходных данных равен нулю.');
            return;
        }

        // Теплопотери считаются один раз, при средней температуре системы.
        // Подбор пересчитывает их на каждой итерации, здесь итераций нет —
        // в этом и смысл ветви «без подбора».
        var mean = 0.5 * (settings.supplyTemperature + settings.requiredTemperature);
        fixTemperatures(network, mean);
        HeatLoss.apply(network, settings);

        // База формулы: по умолчанию только подающие Т3.
        var basis = settings.normHeatSupplyOnly ? PipeRole.Supply : PipeRole.None;

        var totalHeat = heatFor(network, basis);
        var totalFlow = HeatLoss.circulationFlowByNorm(totalHeat, settings);

        var flows = distribute(network, rings, totalFlow, basis);

        var directions = FlowSolver.buildDirections(network, rings);
        FlowSolver.distributeFlows(network, rings, directions, flows);
        FlowSolver.propagateTemperatures(network, settings);
        FlowSolver.readRingTemperatures(network, rings);
        Hydraulics.apply(network, settings);

        for (i = 0; i < rings.length; i++) {
            rings[i].flow = flows[i];
            rings[i].heatLoss = FlowSolver.ownHeat(network, rings[i], PipeRole.None);
        }

        FlowSolver.suggestDiameters(network, settings);
        FlowSolver.aggregateZones(network, settings);

        report(network, settings, rings, totalHeat, totalFlow, mean, basis);
    }

    return { solve: solve };
})();
