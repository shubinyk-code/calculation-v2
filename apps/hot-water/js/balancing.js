'use strict';

/*
    Увязка циркуляционных колец и подбор ручных балансировочных клапанов.
    Порт HotWaterCirculation/src/Balancing.cs с одним расширением — клапан
    ставит человек, в любую точку сети.

    Вода сама пойдёт по кольцу с наименьшим сопротивлением, и дальние стояки
    останутся без циркуляции. Чтобы расходы распределились так, как их подобрал
    FlowSolver, каждое кольцо, кроме самого невыгодного, надо дожать до его потерь.
    Недостающее сопротивление создаёт балансировочный клапан:
        Kv = G / √Δp,   G в м³/ч, Δp в барах.

    Про клапаны, поставленные вручную.

    Увязка сравнивает кольца между собой, поэтому считается она по потерям ТРУБ
    (pipeDrop), без клапанов: иначе подобранный клапан менял бы базу сравнения,
    по которой его же и подбирали. Клапаны добавляются к потерям кольца уже после
    подбора — так получается тот перепад, который увидит насос.

    Клапан на общей магистрали в увязке не участвует и настройка ему не подбирается:
    он одинаково давит все кольца, идущие через него, и относительную невязку
    не меняет. Такой клапан остаётся полностью открытым, а в отчёте объясняется, почему.
*/

var Balancing = {

    /**
     * Пропускная способность клапана Kv, м³/ч при перепаде 1 бар,
     * которая создаёт заданное сопротивление при заданном расходе.
     */
    kv: function (flowKgPerHour, dropPascals) {
        if (dropPascals <= 1e-6 || flowKgPerHour <= 1e-9)
            return 0.0;

        var cubicMetresPerHour = flowKgPerHour / Water.Density;
        var bar = dropPascals / 1e5;

        return cubicMetresPerHour / Math.sqrt(bar);
    },

    /** Обратная задача: какой перепад, Па, даст клапан с известным Kv при известном расходе. */
    dropForKv: function (flowKgPerHour, kv) {
        if (kv <= 1e-9 || flowKgPerHour <= 1e-9)
            return 0.0;

        var cubicMetresPerHour = flowKgPerHour / Water.Density;
        var ratio = cubicMetresPerHour / kv;

        return ratio * ratio * 1e5;
    },

    apply: function (network, settings) {
        if (network.rings.length === 0)
            return;

        var i, ring, segment;

        // Потери труб по кольцу — база сравнения. Клапаны сюда не входят.
        for (i = 0; i < network.rings.length; i++) {
            ring = network.rings[i];
            ring.pipeDrop = 0.0;
            for (var k = 0; k < ring.segments.length; k++)
                ring.pipeDrop += network.segments[ring.segments[k]].pipeDrop;
        }

        // Клапаны сбрасываются в полностью открытые: подбор начинается с чистого листа,
        // иначе прошлая настройка тянулась бы в новый расчёт.
        for (i = 0; i < network.segments.length; i++) {
            segment = network.segments[i];
            if (segment.valve) {
                segment.valve.model = null;
                segment.valve.position = 0;
                segment.valve.exactPosition = 0.0;
                segment.valve.requiredKv = 0.0;
                segment.valve.actualKv = 0.0;
                segment.valve.actualDrop = 0.0;
                segment.valve.ringNumber = 0;
                segment.valve.note = '';
                segment.valve.inUse = false;
                segment.valve.byHand = false;
                // chosenArticle не сбрасывается: это решение человека, а не итог расчёта.
            }
            segment.valveDrop = 0.0;
            segment.pressureDrop = segment.pipeDrop;
        }

        /*
            Увязка ведётся внутри зоны, а не по всей сети. У зон свои выходы ИТП,
            и гидравлически это независимые контуры: сравнивать потери кольца первой
            зоны с кольцом второй незачем, балансировать одно по другому нельзя.
        */
        var balanced = 0;

        for (var z = 0; z < network.zones.length; z++) {
            var zone = network.zones[z];
            var rings = [];

            for (var r = 0; r < zone.rings.length; r++) {
                ring = network.rings[zone.rings[r]];
                if (ring.segments.length > 0)
                    rings.push(ring);
            }

            if (rings.length > 0 && balanceGroup(network, settings, rings, zone))
                balanced++;
        }

        finishValves(network, settings);
        sumRingDrops(network);

        if (balanced === 0)
            network.diagnostics.push('Увязка не выполнена: ни в одной зоне нет колец с потерями.');
    }
};

/** Увязка одной группы колец между собой. Возвращает false, если увязывать нечего. */
function balanceGroup(network, settings, rings, zone) {
    var i, ring;

    var worst = 0.0;
    var worstRing = null;

    for (i = 0; i < rings.length; i++) {
        if (rings[i].pipeDrop > worst) {
            worst = rings[i].pipeDrop;
            worstRing = rings[i];
        }
    }

    if (!worstRing || worst <= 1e-9)
        return false;

    worstRing.isWorstRing = true;

    var needBalancing = 0;

    for (i = 0; i < rings.length; i++) {
        ring = rings[i];
        ring.imbalance = (worst - ring.pipeDrop) / worst;
        ring.requiredValveDrop = worst - ring.pipeDrop;

        var target = valveSegmentFor(network, ring);
        ring.valveSegment = target;
        ring.valvePipeDN = target >= 0 ? network.segments[target].nominalDiameterMm : 0.0;

        if (ring.imbalance <= settings.allowedImbalance) {
            // Невязка в допуске — клапан не нужен, кольцо увязывается само.
            ring.needsValve = false;
            ring.requiredKv = 0.0;
            ring.valve = null;
            continue;
        }

        needBalancing++;
        ring.needsValve = true;
        ring.requiredKv = Balancing.kv(ring.flow, ring.requiredValveDrop);

        if (target < 0) {
            ring.note = join(ring.note, 'некуда поставить балансировочный клапан: '
                + 'у кольца нет собственного участка Т4');
            ring.valve = null;
            continue;
        }

        /*
            Типоразмер задан человеком — подбор его не трогает и считает только
            то, что этот клапан даст: положение, Kv на нём и настоящий перепад.
            Так видно цену принятого решения, а не только сам выбор.
        */
        var fixed = network.segments[target].valve
            && network.segments[target].valve.chosenArticle;

        var selection = fixed
            ? ValveSelector.selectArticle(ring.flow, ring.requiredValveDrop,
                                          ring.valvePipeDN, fixed, settings.valveBrand)
            : ValveSelector.select(ring.flow, ring.requiredValveDrop, ring.valvePipeDN,
                                   settings.valveBrand);

        ring.valve = selection;

        var segment = network.segments[target];
        if (!segment.valve)
            segment.valve = newValve(true);

        segment.valve.inUse = true;
        segment.valve.byHand = selection.byHand;
        segment.valve.model = selection.model;
        segment.valve.position = selection.position;
        segment.valve.exactPosition = selection.exactPosition;
        segment.valve.requiredKv = selection.requiredKv;
        segment.valve.actualKv = selection.actualKv;
        segment.valve.actualDrop = selection.actualDrop;
        segment.valve.ringNumber = ring.number;
        segment.valve.note = selection.note;
    }

    network.diagnostics.push('Зона ' + zone.caption + ': самое невыгодное кольцо № '
        + Fmt.int(worstRing.number) + ', потери труб ' + Fmt.pressure(worst) + ' кПа. '
        + 'Колец с клапаном: ' + Fmt.int(needBalancing) + ' из ' + Fmt.int(rings.length)
        + ' (допустимая невязка ' + Fmt.percent(settings.allowedImbalance) + ' %).');

    return true;
}

/**
 * Участок, на который встаёт увязывающий клапан кольца.
 *
 * Сначала ищется клапан, поставленный человеком на СОБСТВЕННЫЙ участок кольца:
 * раз он его туда поставил, увязывать надо им. Клапан на общей магистрали
 * не годится — он давит все кольца сразу и невязку между ними не меняет.
 *
 * Если ручного клапана нет, клапан подставляется сам — туда же, куда его ставит
 * плагин: на циркуляционный Т4 у самой врезки в магистраль, то есть на последний
 * собственный участок Т4 перед возвратом в ИТП.
 */
function valveSegmentFor(network, ring) {
    var i, index, segment;

    for (i = ring.segments.length - 1; i >= 0; i--) {
        index = ring.segments[i];
        segment = network.segments[index];

        if (segment.valve && !segment.valve.automatic
            && segment.ringIndices.length === 1
            && !segment.isVirtualLink)
            return index;
    }

    for (i = ring.segments.length - 1; i >= 0; i--) {
        index = ring.segments[i];
        segment = network.segments[index];

        if (segment.role === PipeRole.Return
            && segment.ringIndices.length === 1
            && !segment.isVirtualLink)
            return index;
    }

    return -1;
}

/**
 * Разбор оставшихся клапанов: те, что человек поставил, а увязка их не выбрала.
 * Молча выбросить их нельзя — клапан стоит в сети, и объяснить, почему он
 * не настраивается, обязательно.
 */
function finishValves(network, settings) {
    var shared = 0;
    var spare = 0;

    for (var i = 0; i < network.segments.length; i++) {
        var segment = network.segments[i];
        if (!segment.valve) continue;

        if (segment.valve.inUse) {
            segment.valveDrop = segment.valve.actualDrop;
            segment.pressureDrop = segment.pipeDrop + segment.valveDrop;
            continue;
        }

        // Автоматически подставленный и не пригодившийся клапан просто исчезает:
        // его в сети никто не ставил.
        if (segment.valve.automatic) {
            segment.valve = null;
            continue;
        }

        // Ручной клапан остаётся, но полностью открытым.
        // Полностью открытый — последнее положение шкалы этой модели.
        // Модель известна не всегда: у клапана без заданного артикула,
        // не пригодившегося увязке, подбирать было нечего.
        var wide = segment.valve.chosenArticle
            ? ValveCatalog.byArticle(segment.valve.chosenArticle)
            : segment.valve.model;

        segment.valve.position = wide ? ValveCatalog.fullOpen(wide) : 0;
        segment.valve.exactPosition = segment.valve.position;

        // Заданный типоразмер показывается и здесь: человек его выбрал,
        // и видеть в таблице прочерк вместо своего артикула он не должен.
        if (segment.valve.chosenArticle) {
            segment.valve.model = ValveCatalog.byArticle(segment.valve.chosenArticle);
            segment.valve.byHand = true;

            if (segment.valve.model)
                segment.valve.actualKv = segment.valve.model.maxKv;
        }

        if (!segment.isCirculating) {
            segment.valve.note = 'участок не на циркуляции — клапан в расчёте не участвует';
        } else if (segment.ringIndices.length > 1) {
            shared++;
            segment.valve.note = 'на общей магистрали ' + Fmt.int(segment.ringIndices.length)
                + ' колец: одинаково давит их все, относительную невязку не меняет — '
                + 'настройка не подбирается, оставлен полностью открытым';
        } else {
            spare++;
            segment.valve.note = 'на этом кольце увязка не требуется либо клапан уже стоит '
                + 'ближе к врезке — оставлен полностью открытым';
        }

        segment.valveDrop = 0.0;
        segment.pressureDrop = segment.pipeDrop;
    }

    if (shared > 0) {
        network.diagnostics.push('Балансировочных клапанов на общих магистралях: '
            + Fmt.int(shared) + '. Они давят все проходящие кольца одинаково и невязку '
            + 'между ними не меняют, поэтому настройка им не подбирается. Для увязки '
            + 'клапан нужен на собственном участке кольца.');
    }

    if (spare > 0) {
        network.diagnostics.push('Балансировочных клапанов, оставленных полностью открытыми: '
            + Fmt.int(spare) + '. Кольцо увязывается без них либо увязку взял на себя '
            + 'клапан ближе к врезке.');
    }
}

/** Полные потери кольца — трубы вместе с клапанами. Это и есть напор, нужный насосу. */
function sumRingDrops(network) {
    var i, k, ring, zone;

    for (i = 0; i < network.rings.length; i++) {
        ring = network.rings[i];
        ring.pressureDrop = 0.0;
        for (k = 0; k < ring.segments.length; k++)
            ring.pressureDrop += network.segments[ring.segments[k]].pressureDrop;
    }

    for (i = 0; i < network.zones.length; i++) {
        zone = network.zones[i];
        zone.worstDrop = 0.0;
        zone.worstRingNumber = 0;

        for (k = 0; k < zone.rings.length; k++) {
            ring = network.rings[zone.rings[k]];
            if (ring.pressureDrop > zone.worstDrop) {
                zone.worstDrop = ring.pressureDrop;
                zone.worstRingNumber = ring.number;
            }
        }
    }
}

/** Пустой клапан. automatic = подставлен расчётом, а не поставлен человеком. */
function newValve(automatic) {
    return newValveState(automatic);
}

function join(existing, addition) {
    if (!existing) return addition;
    return existing + '; ' + addition;
}
