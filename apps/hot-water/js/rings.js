'use strict';

/*
    Разделение сети на кольцевые и тупиковые участки и сборка циркуляционных колец.
    Порт HotWaterCirculation/src/RingFinder.cs.

    Основание такое. Циркуляционный расход может идти через участок тогда и только
    тогда, когда участок лежит на замкнутом пути через ИТП: вода ушла по Т3 и вернулась
    по Т4. В теории графов участок лежит на цикле тогда и только тогда, когда он не мост.
    Значит кольцевые участки — это в точности компонента двухрёберной связности,
    содержащая узел источника, а всё остальное (мосты и висящие на них ветки) —
    тупиковые подводки к потребителям, которые в расчёт теплопотерь не идут.

    Побочный результат: стояк, у которого забыли перемычку, целиком состоит из мостов
    и сразу попадает в диагностику как стояк без циркуляции.
*/

var RingFinder = {

    run: function (network) {
        if (network.segments.length === 0)
            return;

        var adjacency = buildAdjacency(network);
        var isBridge = findBridges(network, adjacency);

        markCirculating(network, adjacency, isBridge);
        buildRings(network, adjacency);
        numberNodesAndSegments(network, adjacency);
        reportDeadEnds(network);
    },

    /**
     * Слияние выхода Т3 и входа Т4 в ИТП в один узел. До этого в графе нет ни одного
     * цикла: Т3 и Т4 сходятся только на перемычках, а у ИТП обрываются порознь.
     */
    setSource: function (network, supplyNode, returnNode) {
        if (supplyNode < 0 || returnNode < 0
            || supplyNode >= network.nodes.length || returnNode >= network.nodes.length)
            return false;

        if (supplyNode === returnNode) {
            remember(network, supplyNode);
            return true;
        }

        var keep = network.nodes[supplyNode];
        var drop = network.nodes[returnNode];

        for (var i = 0; i < drop.segments.length; i++) {
            var index = drop.segments[i];
            var segment = network.segments[index];

            if (segment.nodeA === returnNode) segment.nodeA = supplyNode;
            if (segment.nodeB === returnNode) segment.nodeB = supplyNode;

            if (keep.segments.indexOf(index) < 0)
                keep.segments.push(index);
        }

        drop.segments = [];
        drop.mergedInto = supplyNode;

        remember(network, supplyNode);
        return true;
    }
};

function remember(network, node) {
    if (network.sourceNodes.indexOf(node) < 0)
        network.sourceNodes.push(node);
}

function buildAdjacency(network) {
    var adjacency = [];
    var i;

    for (i = 0; i < network.nodes.length; i++)
        adjacency.push([]);

    for (i = 0; i < network.segments.length; i++) {
        var segment = network.segments[i];
        if (segment.nodeA === segment.nodeB)
            continue;

        adjacency[segment.nodeA].push({ segment: segment.index, other: segment.nodeB });
        adjacency[segment.nodeB].push({ segment: segment.index, other: segment.nodeA });
    }

    return adjacency;
}

/*
    Поиск мостов по Тарьяну, обход итеративный. Рекурсия здесь опасна:
    на реальном стояке глубина обхода — это сотни и тысячи участков.
*/
function findBridges(network, adjacency) {
    var count = network.nodes.length;

    var discovered = new Int32Array(count);
    var low = new Int32Array(count);
    var parentSegment = new Int32Array(count);
    var cursor = new Int32Array(count);
    var stack = new Int32Array(count);

    var isBridge = [];
    for (var b = 0; b < network.segments.length; b++)
        isBridge.push(false);

    var timer = 1;

    for (var root = 0; root < count; root++) {
        if (discovered[root] !== 0)
            continue;

        var top = 0;
        stack[0] = root;
        parentSegment[root] = -1;
        cursor[root] = 0;
        discovered[root] = timer;
        low[root] = timer;
        timer++;

        while (top >= 0) {
            var node = stack[top];

            if (cursor[node] < adjacency[node].length) {
                var arc = adjacency[node][cursor[node]];
                cursor[node]++;

                // Пропускается именно то ребро, по которому пришли, а не все рёбра
                // к родителю: две параллельные трубы между теми же узлами образуют
                // цикл, и мостами они не являются.
                if (arc.segment === parentSegment[node])
                    continue;

                var next = arc.other;
                if (discovered[next] !== 0) {
                    if (discovered[next] < low[node])
                        low[node] = discovered[next];
                    continue;
                }

                parentSegment[next] = arc.segment;
                discovered[next] = timer;
                low[next] = timer;
                timer++;
                cursor[next] = 0;

                top++;
                stack[top] = next;
                continue;
            }

            top--;
            if (top < 0)
                continue;

            var parent = stack[top];
            if (low[node] < low[parent])
                low[parent] = low[node];

            if (low[node] > discovered[parent] && parentSegment[node] >= 0)
                isBridge[parentSegment[node]] = true;
        }
    }

    return isBridge;
}

function markCirculating(network, adjacency, isBridge) {
    var i, segment;

    for (i = 0; i < network.segments.length; i++)
        network.segments[i].isCirculating = false;

    if (network.sourceNodes.length === 0) {
        // Источник не указан — считать кольцевым можно только «всё, что на циклах».
        // Это шире правильного ответа, поэтому результат сопровождается замечанием.
        for (i = 0; i < network.segments.length; i++)
            network.segments[i].isCirculating = !isBridge[i];

        network.diagnostics.push('Источник (ИТП) не указан: кольцевыми помечены все участки, '
            + 'лежащие на циклах, без проверки, что цикл проходит через ИТП.');
        return;
    }

    // Убрав мосты, сеть распадается на куски. Кольцевые участки — это те куски,
    // где остался хоть один источник: в ИТП обычно несколько выходов по зонам,
    // и каждый питает свою часть сети.
    var inComponent = [];
    for (i = 0; i < network.nodes.length; i++)
        inComponent.push(false);

    var queue = [];
    for (i = 0; i < network.sourceNodes.length; i++) {
        var source = network.sourceNodes[i];
        if (source < 0 || source >= network.nodes.length || inComponent[source])
            continue;

        inComponent[source] = true;
        queue.push(source);
    }

    var head = 0;
    while (head < queue.length) {
        var node = queue[head++];
        var arcs = adjacency[node];

        for (var a = 0; a < arcs.length; a++) {
            if (isBridge[arcs[a].segment] || inComponent[arcs[a].other])
                continue;

            inComponent[arcs[a].other] = true;
            queue.push(arcs[a].other);
        }
    }

    for (i = 0; i < network.segments.length; i++) {
        segment = network.segments[i];
        segment.isCirculating = !segment.isExcluded
            && !isBridge[i]
            && inComponent[segment.nodeA]
            && inComponent[segment.nodeB];
    }
}

// --- кольца -----------------------------------------------------------

function buildRings(network, adjacency) {
    network.rings = [];

    if (network.sourceNodes.length === 0) {
        network.diagnostics.push('Без указанного источника кольца не собираются: '
            + 'неизвестно, откуда и куда идёт вода.');
        return;
    }

    var number = 1;
    var i, k;

    for (i = 0; i < network.segments.length; i++) {
        var link = network.segments[i];

        // Кольцо замыкает только перемычка Т3–Т4. Сшивка разрыва внутри системы
        // кольца не образует: она лишь восстанавливает целостность трубы.
        if (!link.isRingClosure)
            continue;

        /*
            Перемычка есть, а кольца нет — значит она не лежит на цикле через ИТП.
            Раньше такая перемычка просто пропускалась, и человек оставался
            без единого слова о том, почему стояк не считается. Молчание здесь
            хуже неверного ответа: искать разрыв в сети глазами — это часы.
        */
        if (!link.isCirculating) {
            explainDeadClosure(network, adjacency, link);
            continue;
        }

        /*
            Кольцо собирается «от ИТП по Т3 до перемычки и обратно по Т4», поэтому
            концы перемычки надо различать. Автоматика их и ставит в этом порядке,
            а вот рукой перемычку рисуют с той стороны, с которой удобнее, и конец
            на Т4 запросто оказывается первым. Без этой проверки такое кольцо
            молча не собиралось бы: путь по Т3 от конца, лежащего на Т4, не находится.
        */
        var supplyEnd = link.nodeA;
        var returnEnd = link.nodeB;

        if (!touchesRole(network, supplyEnd, PipeRole.Supply)
            && touchesRole(network, returnEnd, PipeRole.Supply)) {
            supplyEnd = link.nodeB;
            returnEnd = link.nodeA;
        }

        // Путь ищется до ЛЮБОГО источника: у каждой зоны ИТП свой выход,
        // и кольцо второй зоны замыкается не на тот же узел, что первой.
        var toLink = pathToAnySource(network, adjacency, supplyEnd, PipeRole.Supply);
        var fromLink = pathToAnySource(network, adjacency, returnEnd, PipeRole.Return);

        // Обе половины возвращаются в порядке «от источника»; обратная
        // в кольце идёт наоборот — от перемычки к ИТП.
        if (fromLink.path)
            fromLink.path.reverse();

        var ring = new HwRing(network.rings.length);
        ring.number = number++;
        ring.zoneKey = link.zoneKey;
        ring.linkIndex = link.index;

        // Самая дальняя точка кольца — узел перед перемычкой на подающей стороне.
        // Хранится отдельно: у нарисованной рукой перемычки он может оказаться
        // как первым её концом, так и вторым.
        ring.farNode = supplyEnd;
        ring.sourceNode = toLink.source;

        if (!toLink.path || !fromLink.path) {
            ring.note = !toLink.path
                ? 'не найден путь от ИТП до перемычки по Т3'
                : 'не найден путь от перемычки до ИТП по Т4';

            network.diagnostics.push('Кольцо ' + Fmt.int(ring.number) + ': ' + ring.note + '.');
            network.rings.push(ring);
            continue;
        }

        ring.segments = toLink.path.concat([link.index], fromLink.path);

        for (k = 0; k < ring.segments.length; k++) {
            var segment = network.segments[ring.segments[k]];
            ring.length += segment.length;
            if (segment.ringIndices.indexOf(ring.index) < 0)
                segment.ringIndices.push(ring.index);
        }

        network.rings.push(ring);

        var zone = network.zone(ring.zoneKey);
        if (zone)
            zone.rings.push(ring.index);
    }

    // Участок, попавший в одно-единственное кольцо, принадлежит только ему.
    // Всё остальное — общие магистрали, их теплопотери делятся между кольцами.
    for (i = 0; i < network.rings.length; i++) {
        var r = network.rings[i];
        for (k = 0; k < r.segments.length; k++) {
            if (network.segments[r.segments[k]].ringIndices.length === 1)
                r.ownSegments.push(r.segments[k]);
        }
    }

    if (network.rings.length === 0) {
        network.diagnostics.push('Циркуляционных колец не найдено. Проверьте места замыкания '
            + 'и допуск поиска: без перемычек Т3 и Т4 остаются двумя отдельными деревьями.');
    }
}

/**
 * Кратчайший путь от узла до ближайшего источника по участкам заданной роли.
 * Возвращает участки в порядке «от источника к узлу».
 */
function pathToAnySource(network, adjacency, from, role, relaxed) {
    var count = network.nodes.length;
    var cameBySegment = new Int32Array(count);
    var cameFromNode = new Int32Array(count);
    var visited = [];
    var i;

    for (i = 0; i < count; i++) {
        cameBySegment[i] = -1;
        cameFromNode[i] = -1;
        visited.push(false);
    }

    var queue = [from];
    var head = 0;
    visited[from] = true;

    var reached = network.isSource(from) ? from : -1;

    while (head < queue.length && reached < 0) {
        var node = queue[head++];
        var arcs = adjacency[node];

        for (var a = 0; a < arcs.length; a++) {
            var arc = arcs[a];
            if (visited[arc.other])
                continue;

            var segment = network.segments[arc.segment];
            // Ослабленный поиск не требует кольцевого участка: им проверяется,
            // соединены ли трубы вообще, когда кольцо не собралось.
            if (!relaxed && !segment.isCirculating)
                continue;
            if (segment.role !== role)
                continue;

            visited[arc.other] = true;
            cameBySegment[arc.other] = arc.segment;
            cameFromNode[arc.other] = node;

            if (network.isSource(arc.other)) {
                reached = arc.other;
                break;
            }

            queue.push(arc.other);
        }
    }

    if (reached < 0)
        return { path: null, source: -1 };

    // Обход идёт назад от источника, поэтому участки ложатся в порядке
    // «от источника к узлу» — именно так и нужна подающая половина кольца.
    var path = [];
    var current = reached;

    while (current !== from && cameBySegment[current] >= 0) {
        path.push(cameBySegment[current]);
        current = cameFromNode[current];
    }

    return current === from
        ? { path: path, source: reached }
        : { path: null, source: -1 };
}

/**
 * Нумерация узловых точек циркуляции обходом в ширину от ИТП. Порядок обхода,
 * а не порядок в модели: номер 1 всегда у ИТП, дальше номера растут по мере
 * удаления от него, и на принципиальной схеме их можно читать как маршрут.
 */
function numberNodesAndSegments(network, adjacency) {
    var i;

    for (i = 0; i < network.nodes.length; i++)
        network.nodes[i].number = 0;
    for (i = 0; i < network.segments.length; i++)
        network.segments[i].number = 0;

    var nextNode = 1;
    var nextSegment = 1;

    if (network.sourceNodes.length > 0) {
        var visited = [];
        for (i = 0; i < network.nodes.length; i++)
            visited.push(false);

        var queue = [];

        // Нумерация идёт от всех выходов ИТП сразу: номер 1 у первого из них,
        // дальше номера расходятся по сети волной.
        for (i = 0; i < network.sourceNodes.length; i++) {
            var source = network.sourceNodes[i];
            if (source < 0 || source >= network.nodes.length || visited[source])
                continue;

            visited[source] = true;
            network.nodes[source].number = nextNode++;
            queue.push(source);
        }

        var head = 0;
        while (head < queue.length) {
            var node = queue[head++];
            var arcs = adjacency[node];

            for (var a = 0; a < arcs.length; a++) {
                var arc = arcs[a];
                var segment = network.segments[arc.segment];
                if (!segment.isCirculating)
                    continue;

                // Участок нумеруется при первом же проходе по нему, даже если
                // оба его узла уже пронумерованы: иначе замыкающие участки
                // кольца остались бы без номеров.
                if (segment.number === 0)
                    segment.number = nextSegment++;

                if (visited[arc.other])
                    continue;

                visited[arc.other] = true;
                network.nodes[arc.other].number = nextNode++;
                queue.push(arc.other);
            }
        }
    }

    // Узел или участок на циркуляции, до которого обход не дошёл, всё равно
    // должен получить номер: иначе на схеме он окажется безымянным.
    for (i = 0; i < network.segments.length; i++) {
        var s = network.segments[i];
        if (!s.isCirculating)
            continue;

        if (s.number === 0)
            s.number = nextSegment++;
        if (network.nodes[s.nodeA].number === 0)
            network.nodes[s.nodeA].number = nextNode++;
        if (network.nodes[s.nodeB].number === 0)
            network.nodes[s.nodeB].number = nextNode++;
    }
}

function reportDeadEnds(network) {
    var deadEnds = 0;
    var deadReturn = 0;
    var deadLength = 0.0;
    var i;

    for (i = 0; i < network.segments.length; i++) {
        var segment = network.segments[i];
        if (segment.isCirculating || segment.isVirtualLink)
            continue;

        deadEnds++;
        deadLength += segment.length;

        // Тупиковый Т4 — почти наверняка ошибка: циркуляционный трубопровод,
        // через который ничего не течёт, смысла не имеет.
        if (segment.role === PipeRole.Return)
            deadReturn++;
    }

    network.diagnostics.push('Тупиковых участков: ' + Fmt.int(deadEnds)
        + ', суммарной длиной ' + Fmt.length(deadLength) + ' м. '
        + 'В расчёт теплопотерь они не идут.');

    if (deadReturn > 0) {
        network.diagnostics.push('Из них ' + Fmt.int(deadReturn)
            + ' на трубопроводах Т4. Циркуляционный трубопровод без циркуляции — '
            + 'это либо забытая перемычка, либо ошибка модели.');
    }

    for (i = 0; i < network.zones.length; i++) {
        var zone = network.zones[i];
        if (zone.rings.length === 0 && !zone.note)
            zone.note = 'в зоне не найдено ни одного циркуляционного кольца';
    }
}

/** Подходит ли к узлу труба заданной роли. Перемычки и сшивки роли не несут. */
function touchesRole(network, node, role) {
    var list = network.nodes[node].segments;

    for (var i = 0; i < list.length; i++) {
        var segment = network.segments[list[i]];
        if (segment && !segment.isVirtualLink && segment.role === role)
            return true;
    }

    return false;
}

/**
 * Почему перемычка не дала кольца.
 *
 * Причина всегда одна из двух: от неё нет пути до ИТП по подающим либо нет пути
 * по циркуляционным. Чтобы отличить «пути нет вовсе» от «путь есть, но он сам
 * не на цикле», поиск повторяется без требования кольцевого участка: если
 * ослабленный путь находится, значит трубы соединены, и виновата вторая половина.
 */
function explainDeadClosure(network, adjacency, link) {
    var supplyEnd = link.nodeA;
    var returnEnd = link.nodeB;

    if (!touchesRole(network, supplyEnd, PipeRole.Supply)
        && touchesRole(network, returnEnd, PipeRole.Supply)) {
        supplyEnd = link.nodeB;
        returnEnd = link.nodeA;
    }

    var where = placeOf(network, link);

    var hasSupplyPipe = touchesRole(network, supplyEnd, PipeRole.Supply);
    var hasReturnPipe = touchesRole(network, returnEnd, PipeRole.Return);

    if (!hasSupplyPipe || !hasReturnPipe) {
        network.diagnostics.push('Перемычка ' + where + ' висит в воздухе: '
            + (!hasSupplyPipe && !hasReturnPipe
                ? 'ни один её конец не присоединён к трубе'
                : (!hasSupplyPipe ? 'её конец на стороне Т3' : 'её конец на стороне Т4')
                  + ' не присоединён к трубе')
            + '. Точка нарисована рядом с трубой, но не на ней — перетащите конец '
            + 'на узел трубы или удалите перемычку и нарисуйте заново, дождавшись привязки.');
        return;
    }

    var bySupply = pathToAnySource(network, adjacency, supplyEnd, PipeRole.Supply, true);
    var byReturn = pathToAnySource(network, adjacency, returnEnd, PipeRole.Return, true);

    if (!bySupply.path && !byReturn.path) {
        network.diagnostics.push('Перемычка ' + where + ': от неё не доходит до ИТП '
            + 'ни подающий Т3, ни циркуляционный Т4. Эта часть сети не соединена '
            + 'с магистралями — ищите разрыв между стояком и магистралью.');
        return;
    }

    if (!bySupply.path) {
        network.diagnostics.push('Перемычка ' + where + ': от неё не доходит до ИТП '
            + 'подающий Т3. Циркуляционный Т4 доходит, значит разрыв на подаче — '
            + 'проверьте, соединён ли подающий стояк с магистралью Т3 и помечен ли '
            + 'выход Т3 в ИТП.');
        return;
    }

    if (!byReturn.path) {
        network.diagnostics.push('Перемычка ' + where + ': от неё не доходит до ИТП '
            + 'циркуляционный Т4. Подающий Т3 доходит, значит разрыв на обратке — '
            + 'проверьте, соединён ли циркуляционный стояк с магистралью Т4 и помечен ли '
            + 'вход Т4 в ИТП.');
        return;
    }

    // Обе половины на месте, а цикла нет — так бывает, когда путь туда и обратно
    // идёт по одним и тем же трубам.
    network.diagnostics.push('Перемычка ' + where + ': пути по Т3 и по Т4 находятся, '
        + 'но замкнутого кольца через ИТП не получается. Похоже, подача и обратка '
        + 'идут по одной и той же трубе — проверьте роли участков.');
}

/** Место перемычки словами: по отметке и координатам, чтобы найти её на схеме. */
function placeOf(network, link) {
    var a = network.nodes[link.nodeA].point3d;
    var b = network.nodes[link.nodeB].point3d;

    return 'на отметке ' + Fmt.length(0.5 * (a.z + b.z)) + ' м (X ≈ '
        + Fmt.length(0.5 * (a.x + b.x)) + ', Y ≈ ' + Fmt.length(0.5 * (a.y + b.y)) + ')';
}
