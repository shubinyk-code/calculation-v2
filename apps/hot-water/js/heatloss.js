'use strict';

/*
    Теплопотери трубопровода по СП 61.13330.2012, приложение Э.
    Порт HotWaterCirculation/src/HeatLoss.cs — формулы и таблицы без изменений.

    Труба считается многослойной цилиндрической стенкой: стенка трубы, слой изоляции,
    теплоотдача с наружной поверхности. Сопротивления складываются, и
        q = (t_воды − t_окр) / ΣR,  Вт/м,
        Q = q · L · (1 + β_мест),   Вт,
    где β_мест учитывает опоры, подвески и арматуру (СП 61.13330 табл. 13).
*/

var HeatLoss = {

    /**
     * Теплопроводность стенки трубы, Вт/(м·К). У стали её можно не учитывать,
     * а у полипропилена сопротивление стенки сравнимо с сопротивлением изоляции,
     * и выбросить его нельзя.
     */
    wallLambda: function (material) {
        if (!material) return 50.0;
        var t = material.toLowerCase();

        if (has(t, 'нержав') || has(t, 'нерж') || has(t, 'aisi') || has(t, 'inox')) return 17.0;
        if (has(t, 'медь') || has(t, 'медн') || has(t, 'copper')) return 390.0;
        if (has(t, 'полипропилен') || has(t, 'ппр') || has(t, 'ppr') || has(t, 'pp-r')) return 0.24;
        if (has(t, 'сшит') || has(t, 'pex') || has(t, 'пекс')) return 0.38;
        if (has(t, 'полиэтилен') || has(t, 'пнд') || has(t, 'pe-') || has(t, 'пэ')) return 0.40;
        if (has(t, 'поливинилхлорид') || has(t, 'пвх') || has(t, 'pvc')) return 0.19;

        return 50.0;                                   // сталь, в том числе оцинкованная
    },

    /**
     * Эквивалентная шероховатость внутренней поверхности, мм.
     * Нужна не здесь, а в гидравлике, но таблица материалов одна на оба расчёта.
     */
    roughness: function (material, fallback) {
        if (!material) return fallback;
        var t = material.toLowerCase();

        if (has(t, 'нержав') || has(t, 'нерж') || has(t, 'aisi') || has(t, 'inox')) return 0.01;
        if (has(t, 'медь') || has(t, 'медн') || has(t, 'copper')) return 0.01;
        if (has(t, 'полипропилен') || has(t, 'ппр') || has(t, 'ppr') || has(t, 'pp-r')) return 0.007;
        if (has(t, 'сшит') || has(t, 'pex') || has(t, 'пекс')) return 0.007;
        if (has(t, 'полиэтилен') || has(t, 'пнд') || has(t, 'pe-') || has(t, 'пэ')) return 0.01;
        if (has(t, 'оцинк')) return 0.15;
        if (has(t, 'сталь') || has(t, 'стальн') || has(t, 'steel')) return 0.20;

        return fallback;
    },

    /**
     * Сталь, которая со временем зарастает: чёрная, оцинкованная, чугун.
     *
     * Нержавейка сюда не идёт, хотя слово «сталь» в её имени есть: она не
     * обрастает отложениями так, как углеродистая, и считается по шероховатости.
     * Проверка на «нержав» стоит первой именно поэтому.
     */
    isCarbonSteel: function (material) {
        if (!material) return false;
        var t = material.toLowerCase();

        if (has(t, 'нержав') || has(t, 'нерж') || has(t, 'aisi') || has(t, 'inox'))
            return false;

        return has(t, 'сталь') || has(t, 'стальн') || has(t, 'steel')
            || has(t, 'оцинк') || has(t, 'чугун');
    },

    /**
     * Термическое сопротивление цилиндрического слоя, м·К/Вт.
     * СП 61.13330.2012, формула (Э.7): R = ln(d_н/d_в) / (2·π·λ).
     */
    layerResistance: function (innerDiameter, outerDiameter, lambda) {
        if (lambda <= 1e-9 || innerDiameter <= 0.0 || outerDiameter <= innerDiameter)
            return 0.0;

        return Math.log(outerDiameter / innerDiameter) / (2.0 * Math.PI * lambda);
    },

    /**
     * Термическое сопротивление теплоотдаче с наружной поверхности, м·К/Вт.
     * СП 61.13330.2012, формула (Э.6): R = 1 / (π·d_н·α).
     */
    surfaceResistance: function (outerDiameter, alpha) {
        if (outerDiameter <= 0.0 || alpha <= 1e-9)
            return 0.0;

        return 1.0 / (Math.PI * outerDiameter * alpha);
    },

    /** Полное сопротивление участка, м·К/Вт: стенка трубы, изоляция и теплоотдача. */
    totalResistance: function (innerDiameter, outerDiameter, material,
                               insulationThickness, insulationLambda, alpha) {
        var resistance = HeatLoss.layerResistance(
            innerDiameter, outerDiameter, HeatLoss.wallLambda(material));

        var surfaceDiameter = outerDiameter;
        if (insulationThickness > 1e-6 && insulationLambda > 1e-9) {
            var overInsulation = outerDiameter + 2.0 * insulationThickness;
            resistance += HeatLoss.layerResistance(outerDiameter, overInsulation, insulationLambda);
            surfaceDiameter = overInsulation;
        }

        return resistance + HeatLoss.surfaceResistance(surfaceDiameter, alpha);
    },

    /** Линейная плотность теплового потока q, Вт/м. */
    linearFlux: function (waterTemperature, ambientTemperature, resistance) {
        if (resistance <= 1e-9) return 0.0;
        return (waterTemperature - ambientTemperature) / resistance;
    },

    /**
     * Пересчёт теплопотерь всех кольцевых участков при текущих температурах.
     * Вызывается на каждой итерации подбора расходов: остывая, вода теряет меньше.
     */
    apply: function (network, settings) {
        for (var i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];

            segment.heatFluxPerMetre = 0.0;
            segment.heatLoss = 0.0;

            // Тупиковые подводки циркуляции не имеют: компенсировать их
            // циркуляционным расходом нечем, и в сумму они не идут.
            if (!segment.isCirculating || segment.isVirtualLink)
                continue;

            // У зоны могут быть свои условия прокладки: подвал, шахта и чердак
            // греются в разную среду. Нет своих — берутся общие.
            segment.ambientTemperature = settings.ambientFor(segment.zoneKey);
            segment.alpha = settings.alphaFor(segment.zoneKey);

            if (!segmentHasInsulation(segment) && !settings.countBarePipes)
                continue;

            var resistance = HeatLoss.totalResistance(
                segment.innerDiameter,
                segment.outerDiameter,
                segment.material,
                segment.insulationThickness,
                segment.insulationLambda,
                segment.alpha);

            var water = 0.5 * (segment.temperatureIn + segment.temperatureOut);
            if (water <= 0.0)
                water = settings.supplyTemperature;

            segment.heatFluxPerMetre = HeatLoss.linearFlux(
                water, segment.ambientTemperature, resistance);
            segment.heatLoss = segment.heatFluxPerMetre * segment.length
                * (1.0 + settings.localHeatFactor);

            // Полотенцесушитель отдаёт заметно больше, чем труба той же длины,
            // и в жилье это основная доля теплопотерь кольца.
            if (segment.towelRailCount > 0)
                segment.heatLoss += segment.towelRailCount * settings.towelRailWatts;
        }
    },

    /** Суммарные теплопотери кольцевых участков сети, Вт. */
    total: function (network) {
        var total = 0.0;
        for (var i = 0; i < network.segments.length; i++)
            total += network.segments[i].heatLoss;
        return total;
    },

    /**
     * Контрольный общий циркуляционный расход, кг/ч, по формуле
     * q_cir = β·ΣQ/(c·Δt). Служит сверкой к расходу, полученному подбором.
     */
    circulationFlowByNorm: function (totalHeatWatts, settings) {
        if (settings.deltaT <= 1e-6) return 0.0;

        // Q в кВт, c в кДж/(кг·К) → расход в кг/с, дальше в кг/ч.
        var kilowatts = totalHeatWatts / 1000.0;
        var kgPerSecond = settings.beta * kilowatts / (Water.HeatCapacity * settings.deltaT);
        return kgPerSecond * 3600.0;
    }
};

function has(text, part) {
    return text.indexOf(part) >= 0;
}

function segmentHasInsulation(segment) {
    return segment.insulationThickness > 1e-6 && segment.insulationLambda > 1e-9;
}
