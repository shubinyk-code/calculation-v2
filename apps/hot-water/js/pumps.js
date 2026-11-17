'use strict';

/*
    Подбор циркуляционного насоса ГВС по рабочей точке «расход — напор».

    Расход и напор программа уже знает: расход — циркуляционный по зоне,
    напор — потери самого невыгодного кольца. Остаётся выбрать насос,
    характеристика которого проходит выше этой точки, и показать, с каким
    запасом.

    ЧЕГО ЗДЕСЬ НЕТ. Настоящих заводских характеристик по точкам. Кривая каждого
    насоса приближена параболой по двум паспортным крайностям — напору при
    нулевом расходе и расходу при нулевом напоре:

        H(Q) = H_max·(1 − (Q/Q_max)²)

    Для циркуляции ГВС этого хватает: рабочая точка лежит в левой части
    характеристики, где парабола к настоящей кривой ближе всего, а запас
    всё равно берётся кратным. Но подбор отсюда — ОРИЕНТИРОВОЧНЫЙ: перед
    выдачей сверяйте с паспортом. В таблице и в записке это сказано прямо,
    чтобы число не ушло в проект как заводское.

    ГВС — НЕ ОТОПЛЕНИЕ. Корпус насоса для горячей воды должен быть бронзовым
    или нержавеющим: вода питьевая и постоянно проточная, чугун в ней
    ржавеет и красит воду. Чугунные насосы в каталоге помечены и к подбору
    не допускаются вовсе — именно потому, что по напору и расходу они
    подходят, и спутать легко.
*/

var PumpCatalog = {

    /*
        Напор в обозначении большинства циркуляционных насосов назван прямо:
        UP 20-30 — это 3,0 м, Star-Z 25/6 — 6 м. Это и взято за H_max,
        потому что цифра в имени ошибиться не даёт. Q_max — порядковая
        величина по типоразмеру, её и надо сверять по паспорту.
    */
    models: [
        {
            brand: 'Grundfos', model: 'UP 15-14 B',
            headMax: 1.4, flowMax: 1.2, power: 25,
            body: 'бронза', connection: 'G 1/2', dhw: true
        },
        {
            brand: 'Grundfos', model: 'UP 20-07 N',
            headMax: 0.7, flowMax: 1.0, power: 25,
            body: 'нержавеющая сталь', connection: 'G 3/4', dhw: true
        },
        {
            brand: 'Grundfos', model: 'UP 20-14 BX',
            headMax: 1.4, flowMax: 1.6, power: 30,
            body: 'бронза', connection: 'G 3/4', dhw: true
        },
        {
            brand: 'Grundfos', model: 'UP 20-30 N',
            headMax: 3.0, flowMax: 2.4, power: 65,
            body: 'нержавеющая сталь', connection: 'G 3/4', dhw: true
        },
        {
            brand: 'Grundfos', model: 'UP 32-45 N',
            headMax: 4.5, flowMax: 4.0, power: 140,
            body: 'нержавеющая сталь', connection: 'G 1 1/4', dhw: true
        },
        {
            brand: 'Wilo', model: 'Star-Z 20/1',
            headMax: 1.0, flowMax: 1.1, power: 20,
            body: 'бронза', connection: 'G 1', dhw: true
        },
        {
            brand: 'Wilo', model: 'Star-Z 25/2',
            headMax: 2.0, flowMax: 1.8, power: 45,
            body: 'бронза', connection: 'G 1 1/2', dhw: true
        },
        {
            brand: 'Wilo', model: 'Star-Z 25/6',
            headMax: 6.0, flowMax: 3.5, power: 140,
            body: 'бронза', connection: 'G 1 1/2', dhw: true
        },
        {
            brand: 'Wilo', model: 'Stratos-Z 30/1-8',
            headMax: 8.0, flowMax: 7.0, power: 220,
            body: 'бронза', connection: 'DN 30', dhw: true
        },
        {
            brand: 'Wilo', model: 'Stratos-Z 40/1-12',
            headMax: 12.0, flowMax: 14.0, power: 480,
            body: 'бронза', connection: 'DN 40', dhw: true
        },

        /*
            Чугунные. В каталоге их держать надо: их предлагают чаще всего,
            они дешевле и по характеристике подходят. Поэтому они здесь
            и помечены — чтобы программа могла сказать, почему не берёт,
            а не промолчать, будто такого насоса нет.
        */
        {
            brand: 'Grundfos', model: 'ALPHA2 25-40',
            headMax: 4.0, flowMax: 2.8, power: 22,
            body: 'чугун', connection: 'G 1 1/2', dhw: false,
            note: 'корпус чугунный — только отопление'
        },
        {
            brand: 'Wilo', model: 'Star-RS 25/4',
            headMax: 4.0, flowMax: 3.0, power: 48,
            body: 'чугун', connection: 'G 1 1/2', dhw: false,
            note: 'корпус чугунный — только отопление'
        }
    ],

    /** Напор насоса при заданном расходе, м вод. ст. Ниже нуля не опускается. */
    headAt: function (model, flowM3h) {
        if (!model || model.flowMax <= 0.0) return 0.0;

        var ratio = flowM3h / model.flowMax;
        var head = model.headMax * (1.0 - ratio * ratio);

        return head > 0.0 ? head : 0.0;
    },

    find: function (name) {
        for (var i = 0; i < PumpCatalog.models.length; i++) {
            if (PumpCatalog.models[i].model === name)
                return PumpCatalog.models[i];
        }
        return null;
    },

    /** Насосы, допущенные к ГВС: бронза и нержавейка. */
    forDhw: function () {
        var out = [];
        for (var i = 0; i < PumpCatalog.models.length; i++) {
            if (PumpCatalog.models[i].dhw)
                out.push(PumpCatalog.models[i]);
        }
        return out;
    }
};

var PumpSelector = (function () {

    /**
     * Напор в метрах водяного столба из паскалей.
     *
     * По настоящей плотности горячей воды, 983 кг/м³, а не по 1000. Разница
     * без малого два процента — на фоне запаса мелочь, но считать горячую
     * воду холодной незачем, когда плотность уже задана.
     */
    function metres(pascals) {
        return pascals / (Water.Density * Water.G);
    }

    function cubicMetres(flowKgPerHour) {
        return flowKgPerHour / Water.Density;
    }

    /**
     * Подбор по рабочей точке.
     *
     * Берётся самый слабый насос из подходящих. Причина та же, что при подборе
     * диаметров: лишний напор в циркуляции не бесплатный. Он весь уходит
     * в балансировочные клапаны, которые придётся душить сильнее, а шум
     * на клапане растёт именно от перепада.
     */
    function select(flowKgPerHour, headPascals, settings) {
        var reserve = settings && settings.pumpHeadReserve > 0
            ? settings.pumpHeadReserve : 1.2;

        var result = {
            flow: cubicMetres(flowKgPerHour),       // м³/ч
            required: metres(headPascals),          // м вод. ст.
            reserveFactor: reserve,
            model: null,
            workingHead: 0.0,
            margin: 0.0,                            // во сколько раз напор больше требуемого
            rejected: [],
            note: null
        };

        result.demand = result.required * reserve;

        if (flowKgPerHour <= 1e-9) {
            result.note = 'расхода нет — подбирать нечего';
            return result;
        }

        var candidates = PumpCatalog.forDhw();
        var best = null;
        var bestHead = 0.0;

        for (var i = 0; i < candidates.length; i++) {
            var model = candidates[i];
            var available = PumpCatalog.headAt(model, result.flow);

            if (result.flow > model.flowMax) {
                result.rejected.push(model.model + ' — расход выше характеристики');
                continue;
            }
            if (available < result.demand) {
                result.rejected.push(model.model + ' — напора не хватает');
                continue;
            }

            // Из подходящих — с наименьшим напором в рабочей точке.
            if (best === null || available < bestHead) {
                best = model;
                bestHead = available;
            }
        }

        /*
            Чугунные проверяются отдельно и только затем, чтобы объяснить отказ.
            Иначе человек увидел бы «ничего не подошло», имея на складе насос,
            который по напору подходит, — и поставил бы его, не зная почему нельзя.
        */
        for (i = 0; i < PumpCatalog.models.length; i++) {
            var other = PumpCatalog.models[i];
            if (other.dhw) continue;

            if (result.flow <= other.flowMax
                && PumpCatalog.headAt(other, result.flow) >= result.demand) {
                result.rejected.push(other.model + ' — подходит по напору, но '
                    + (other.note || 'корпус не для ГВС'));
            }
        }

        if (best === null) {
            result.note = 'в каталоге нет насоса на ' + Fmt.num(result.demand)
                + ' м при ' + Fmt.num(result.flow) + ' м³/ч — подбирайте по паспортам';
            return result;
        }

        result.model = best;
        result.workingHead = bestHead;
        result.margin = result.required > 1e-9 ? bestHead / result.required : 0.0;

        /*
            Запас больше трёхкратного — не победа. Такой насос всю лишнюю
            энергию отдаст в клапаны, а они зашумят. Это не ошибка подбора:
            циркуляционные расходы малы, и слабее серийных насосов не делают.
            Но сказать об этом надо, чтобы решение было осознанным.
        */
        if (result.margin > 3.0) {
            result.note = 'запас ' + Fmt.num(result.margin) + '-кратный: слабее '
                + 'в каталоге нет. Излишек напора придётся душить клапанами, '
                + 'проверьте их на шум';
        }

        return result;
    }

    return {
        select: select,
        metres: metres,
        cubicMetres: cubicMetres,

        /** Подбор по всем зонам. Пишет результат в zone.pump. */
        apply: function (network, settings) {
            for (var i = 0; i < network.zones.length; i++) {
                var zone = network.zones[i];

                zone.pump = zone.rings.length > 0
                    ? select(zone.flow, zone.worstDrop, settings)
                    : null;
            }
        }
    };
})();
