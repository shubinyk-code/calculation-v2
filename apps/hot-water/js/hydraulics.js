'use strict';

/*
    Гидравлика участка: скорость, режим течения, потери напора.
    Порт HotWaterCirculation/src/Hydraulics.cs.

    Потери по длине считаются по Дарси — Вейсбаху, коэффициент трения — по Альтшулю:
        λ = 0,11·(k_э/d + 68/Re)^0,25,
    формула перекрывает и переходную область, и квадратичную, что для сетей ГВС
    как раз тот диапазон. Местные сопротивления учитываются долей от линейных.
*/

var Hydraulics = {

    /** Число Рейнольдса, ниже которого течение считается ламинарным. */
    LaminarLimit: 2300.0,

    /*
        Число Рейнольдса, выше которого течение считается развитым
        турбулентным. Между ним и ламинарным пределом лежит переходная область,
        где λ плавно переходит от 64/Re к Альтшулю.

        ЗАЧЕМ ЭТО НУЖНО. Две формулы на границе 2300 не стыкуются: ниже неё
        64/Re даёт 0,028, выше Альтшуль — 0,06, то есть вдвое больше. Труба
        при Re 2290 оказывалась вдвое легче такой же при Re 2310, а разница
        в расходе между ними — доли процента. Это не физика, а стык двух
        приближений.

        Для сетей ГВС это не редкий случай, а основной: при циркуляционных
        расходах в этой полосе сидит половина участков. На восьми стояках
        из 34 участков с расходом 20 попадали в Re 1877…2730 — и ровно
        поэтому проверочный расчёт не мог сойтись: невязка упиралась в скачок
        и ниже него не опускалась никаким дроблением шага.

        Ниже 2300 не меняется ничего: там по-прежнему чистое 64/Re, как
        в плагине. Выше 4000 — чистый Альтшуль, тоже как в плагине. Переход
        между ними сшит так, что в обоих концах совпадают и само значение,
        и его производная: Ньютону нужна именно гладкость, а не только
        непрерывность.
    */
    TurbulentStart: 4000.0,

    /** Ряд условных диаметров для подбора, мм. */
    NominalSeries: [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200],

    /** Объёмный расход, м³/с, из массового в кг/ч. */
    volumeFlow: function (flowKgPerHour) {
        return flowKgPerHour / 3600.0 / Water.Density;
    },

    area: function (innerDiameter) {
        if (innerDiameter <= 0.0) return 0.0;
        return Math.PI * innerDiameter * innerDiameter / 4.0;
    },

    velocity: function (flowKgPerHour, innerDiameter) {
        var area = Hydraulics.area(innerDiameter);
        if (area <= 1e-12) return 0.0;
        return Hydraulics.volumeFlow(flowKgPerHour) / area;
    },

    reynolds: function (velocity, innerDiameter) {
        if (innerDiameter <= 0.0) return 0.0;
        return Math.abs(velocity) * innerDiameter / Water.Viscosity;
    },

    /*
        Коэффициент трения стальных трубопроводов по Ф. А. Шевелёву,
        для НЕНОВЫХ труб — тех, что уже обросли отложениями.

        Исходные формулы даны для удельных потерь, м вод. ст. на метр:
            i = 0,00107·v²/d^1,3                        при v ≥ 1,2 м/с
            i = 0,000912·v²/d^1,3·(1 + 0,867/v)^0,3     при v < 1,2 м/с

        Отсюда λ = i·d·2g/v², и скорость сокращается: остаётся зависимость
        только от диаметра и — во второй ветви — от скорости через поправку.
        Плотность в переходе не участвует, она сокращается тоже.

        На границе v = 1,2 ветви сходятся: (1 + 0,867/1,2)^0,3 = 1,1772,
        и 0,000912·1,1772 = 0,00107. Это и есть проверка, что коэффициенты
        переписаны верно.
    */
    SHEVELEV_QUADRATIC: 0.00107,
    SHEVELEV_TRANSITION: 0.000912,
    SHEVELEV_LIMIT: 1.2,

    shevelev: function (velocity, innerDiameter) {
        var v = Math.abs(velocity);
        if (v <= 1e-9 || innerDiameter <= 0.0) return 0.0;

        var base = Math.pow(innerDiameter, 0.3);
        var twiceG = 2.0 * Water.G;

        if (v >= Hydraulics.SHEVELEV_LIMIT)
            return Hydraulics.SHEVELEV_QUADRATIC * twiceG / base;

        return Hydraulics.SHEVELEV_TRANSITION * twiceG / base
            * Math.pow(1.0 + 0.867 / v, 0.3);
    },

    /**
     * Эквивалентная шероховатость неновой стальной трубы по Шевелёву, мм.
     *
     * Выводится из его квадратичной ветви: приравниваем λ = 0,00107·2g/d^0,3
     * к Альтшулю в области полного проявления шероховатости λ = 0,11·(k/d)^0,25
     * и выражаем k. Получается не одно число, а зависимость от диаметра —
     * от 2,6 мм при Ду32 до 1,7 мм при Ду300. Это и есть заросшая труба.
     *
     * ПОЧЕМУ ЧЕРЕЗ ШЕРОХОВАТОСТЬ, А НЕ ПРЯМО ПО ФОРМУЛЕ ШЕВЕЛЁВА.
     *
     * В квадратичной области разницы нет: k подобрана ровно так, чтобы ответы
     * совпали. А вот переходная ветвь Шевелёва при циркуляционных скоростях
     * вырождается. Множитель (1 + 0,867/v)^0,3 писался для водопроводных сетей,
     * где v около метра в секунду; при v = 0,03 м/с он разгоняет λ до 0,13 —
     * выше всего, что есть на диаграмме Муди при таком числе Рейнольдса.
     * Рядом с ламинарной веткой это давало скачок в четыре с половиной раза,
     * на котором проверочный расчёт зацикливался.
     *
     * Альтшуль с той же шероховатостью ведёт себя в переходной области
     * как положено и к ламинарной ветке примыкает так же, как весь остальной
     * расчёт. В полосе 0,2…1,2 м/с он даёт до 1,4 раза меньше, чем переходная
     * ветвь Шевелёва, — это цена отказа от её экстраполяции.
     */
    shevelevRoughness: function (innerDiameter) {
        if (innerDiameter <= 0.0) return 0.0;

        var quadratic = Hydraulics.SHEVELEV_QUADRATIC * 2.0 * Water.G;
        var ratio = Math.pow(quadratic / 0.11, 4.0);      // (k/d)/d^(-1,2)

        return ratio * Math.pow(innerDiameter, -0.2) * 1000.0;
    },

    /**
     * Коэффициент трения по материалу трубы.
     *
     * Ламинарный режим ни от шероховатости, ни от состояния трубы не зависит —
     * там всегда 64/Re. Выше него стальные и чугунные считаются по Шевелёву
     * для неновых труб, остальные — по Альтшулю со своей шероховатостью:
     * нержавейка, медь и полимеры отложениями не обрастают, и методика
     * для заросшей стали к ним отношения не имеет.
     */
    frictionFor: function (reynolds, velocity, innerDiameter, material, settings) {
        if (reynolds <= 1e-6 || innerDiameter <= 0.0)
            return { friction: 0.0, law: '—' };

        if (reynolds <= Hydraulics.LaminarLimit)
            return { friction: 64.0 / reynolds, law: 'ламинарный, 64/Re', roughness: 0.0 };

        // У стали шероховатость берётся по Шевелёву для неновых труб
        // и зависит от диаметра, у остальных — своя из таблицы материалов.
        var roughness = HeatLoss.isCarbonSteel(material)
            ? Hydraulics.shevelevRoughness(innerDiameter)
            : HeatLoss.roughness(material, settings.roughnessMm);

        var law = HeatLoss.isCarbonSteel(material) ? 'Шевелёв, неновые' : 'Альтшуль';

        // В переходной полосе работают обе ветви, и называть одну из них
        // единственной значило бы соврать о том, как посчитано.
        if (reynolds < Hydraulics.TurbulentStart)
            law = 'переход 64/Re → ' + law;

        return {
            friction: Hydraulics.frictionFactor(reynolds, roughness, innerDiameter),
            law: law,
            roughness: roughness
        };
    },

    /**
     * Коэффициент гидравлического трения. Ламинарный режим — 64/Re,
     * развитый турбулентный — Альтшуль, между ними плавный переход.
     */
    frictionFactor: function (reynolds, roughnessMm, innerDiameter) {
        if (reynolds <= 1e-6 || innerDiameter <= 0.0)
            return 0.0;

        var laminar = 64.0 / reynolds;
        if (reynolds <= Hydraulics.LaminarLimit)
            return laminar;

        var relative = (roughnessMm / 1000.0) / innerDiameter;
        var turbulent = 0.11 * Math.pow(relative + 68.0 / reynolds, 0.25);

        if (reynolds >= Hydraulics.TurbulentStart)
            return turbulent;

        /*
            Сглаживающая ступенька 3w² − 2w³. В концах полосы она равна 0 и 1,
            а производная её в обоих концах нулевая — поэтому λ выходит
            из ламинарной ветви и входит в турбулентную без излома.
            Простая линейная доля дала бы непрерывность, но излом остался бы,
            а Ньютон спотыкается именно о него.
        */
        var share = (reynolds - Hydraulics.LaminarLimit)
            / (Hydraulics.TurbulentStart - Hydraulics.LaminarLimit);
        var smooth = share * share * (3.0 - 2.0 * share);

        return laminar + (turbulent - laminar) * smooth;
    },

    /**
     * Весь ход расчёта участка, а не только итог.
     *
     * Нужен таблице гидравлики: там показывается, из чего сложились потери —
     * скорость, режим течения, коэффициент трения, удельное сопротивление
     * на метр. Итог считается здесь же, чтобы таблица и расчёт не разошлись:
     * pressureDrop берёт из этой же функции.
     */
    detail: function (flowKgPerHour, length, innerDiameter, material, settings) {
        var result = {
            velocity: 0.0, reynolds: 0.0, friction: 0.0, roughness: 0.0,
            perMetre: 0.0, linear: 0.0, local: 0.0, total: 0.0,
            laminar: false, law: '—', usesRoughness: false
        };

        if (innerDiameter <= 0.0 || Math.abs(flowKgPerHour) <= 1e-9)
            return result;

        result.velocity = Hydraulics.velocity(flowKgPerHour, innerDiameter);
        result.reynolds = Hydraulics.reynolds(result.velocity, innerDiameter);
        result.laminar = result.reynolds > 0 && result.reynolds <= Hydraulics.LaminarLimit;

        var picked = Hydraulics.frictionFor(result.reynolds, result.velocity,
                                            innerDiameter, material, settings);
        result.friction = picked.friction;
        result.law = picked.law;

        // В ламинарном режиме шероховатость на трение не влияет вовсе,
        // и показывать её рядом значило бы делать вид, что влияет.
        result.roughness = picked.roughness;
        result.usesRoughness = picked.roughness > 0.0;

        // Удельное сопротивление, Па/м: те же Дарси — Вейсбах, но на метр длины.
        result.perMetre = result.friction / innerDiameter
            * Water.Density * result.velocity * result.velocity / 2.0;

        if (length > 0.0) {
            result.linear = result.perMetre * length;
            result.local = result.linear * settings.localPressureFactor;
            result.total = result.linear + result.local;
        }

        return result;
    },

    /** Потери напора на участке, Па, вместе с местными сопротивлениями. */
    pressureDrop: function (flowKgPerHour, length, innerDiameter, material, settings) {
        return Hydraulics.detail(flowKgPerHour, length, innerDiameter, material, settings).total;
    },

    /**
     * Пересчёт скоростей и потерь по всем участкам при уже известных расходах.
     *
     * Отличие от плагина: к потерям трубы прибавляется перепад на ручном
     * балансировочном клапане, если он на этом участке стоит. В плагине клапан
     * появлялся только на бумаге, здесь его ставит человек в конкретную точку,
     * и не учесть его сопротивление значило бы посчитать кольцо не тем, что построено.
     */
    apply: function (network, settings) {
        for (var i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];

            segment.velocity = Hydraulics.velocity(segment.flow, segment.innerDiameter);
            segment.pipeDrop = Hydraulics.pressureDrop(
                segment.flow, segment.length, segment.innerDiameter, segment.material, settings);

            segment.valveDrop = 0.0;
            if (segment.valve && segment.valve.actualKv > 1e-9)
                segment.valveDrop = Balancing.dropForKv(segment.flow, segment.valve.actualKv);

            segment.pressureDrop = segment.pipeDrop + segment.valveDrop;
        }
    },

    /**
     * Наименьший условный диаметр, при котором скорость укладывается в допустимую.
     * Возвращает 0, если существующий диаметр подходит.
     */
    suggestNominal: function (flowKgPerHour, currentNominalMm, settings) {
        if (Math.abs(flowKgPerHour) <= 1e-9 || currentNominalMm <= 0.0)
            return 0.0;

        var current = Hydraulics.velocity(flowKgPerHour, currentNominalMm / 1000.0);

        if (current <= settings.maxVelocity && current >= settings.minVelocity)
            return 0.0;

        var best = 0.0;
        for (var i = 0; i < Hydraulics.NominalSeries.length; i++) {
            var nominal = Hydraulics.NominalSeries[i];
            var velocity = Hydraulics.velocity(flowKgPerHour, nominal / 1000.0);
            if (velocity > settings.maxVelocity)
                continue;

            // Из подходящих берётся самый узкий: он же самый дешёвый
            // и даёт наибольшую скорость в допустимых пределах.
            best = nominal;
            break;
        }

        if (best <= 0.0)
            return Hydraulics.NominalSeries[Hydraulics.NominalSeries.length - 1];

        return Math.abs(best - currentNominalMm) < 0.5 ? 0.0 : best;
    }
};
