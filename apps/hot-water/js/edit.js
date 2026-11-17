'use strict';

/*
    Правка сети: добавление и удаление узлов и участков.

    Вынесено отдельно от модели, потому что это операции интерфейса, а не расчёта:
    расчёт сеть только читает. Все они сохраняют главный инвариант — индексы
    узлов и участков плотные и совпадают с положением в массиве, иначе ссылки
    в кольцах и в таблицах поедут.
*/

var NetworkEdit = {

    /** Допуск, в пределах которого две точки считаются одним узлом, м. */
    NodeTolerance: 0.002,

    /** Узел в этой точке, либо −1. */
    nodeAt: function (network, point, tolerance) {
        var limit = tolerance || NetworkEdit.NodeTolerance;

        for (var i = 0; i < network.nodes.length; i++) {
            if (network.nodes[i].point3d.distanceTo(point) <= limit)
                return i;
        }
        return -1;
    },

    /** Узел в этой точке, создавая его при необходимости. */
    ensureNode: function (network, point, tolerance) {
        var found = NetworkEdit.nodeAt(network, point, tolerance);
        if (found >= 0) return found;

        var node = network.addNode(point.clone());
        node.pointFlat = { x: point.x + point.y * 0.5, y: point.z };
        node.flatPlaced = true;
        return node.index;
    },

    /**
     * Труба между узлами по заготовке из панели инструментов.
     * Длина в трёхмерной схеме берётся из геометрии, в плоской — задаётся числом:
     * плоская схема не масштабная, и мерить по ней длину нельзя.
     */
    addPipe: function (network, a, b, template) {
        if (a === b) return null;

        var segment = network.addSegment(a, b);

        segment.role = template.role;
        segment.zoneKey = template.zoneKey;
        segment.systemName = template.systemName;
        segment.material = template.material;

        var size = PipeCatalog.find(template.material, template.nominalMm);
        if (size) {
            segment.nominalDiameterMm = size.nominalMm;
            segment.outerDiameter = size.outer;
            segment.innerDiameter = size.inner;
        }

        Calc.applyInsulation(segment, template.insulationName, template.insulationMm);

        segment.length = template.lengthFromGeometry
            ? network.nodes[a].point3d.distanceTo(network.nodes[b].point3d)
            : template.defaultLength;

        if (segment.length <= 0.0)
            segment.length = template.defaultLength;

        return segment;
    },

    /**
     * Перемычка Т3–Т4, замыкающая кольцо. Своей роли не имеет и в теплопотери
     * не идёт: это условное соединение, а не труба.
     */
    addRingClosure: function (network, a, b, zoneKey) {
        if (a === b) return null;

        var segment = network.addSegment(a, b);
        segment.role = PipeRole.None;
        segment.zoneKey = zoneKey;
        segment.isVirtualLink = true;
        segment.isRingClosure = true;
        segment.length = network.nodes[a].point3d.distanceTo(network.nodes[b].point3d);
        segment.nominalDiameterMm = 0;
        segment.material = null;
        return segment;
    },

    /** Сшивка разрыва внутри одной системы. Кольца не замыкает. */
    addStitch: function (network, a, b, role, zoneKey, systemName) {
        if (a === b) return null;

        var segment = network.addSegment(a, b);
        segment.role = role;
        segment.zoneKey = zoneKey;
        segment.systemName = systemName;
        segment.isVirtualLink = true;
        segment.isRingClosure = false;
        segment.length = network.nodes[a].point3d.distanceTo(network.nodes[b].point3d);
        return segment;
    },

    /**
     * Ход участка от узла A к узлу B в координатах модели.
     * У импортированного участка это его настоящая ломаная, у начерченного —
     * прямая между узлами. Ломаная из модели может начинаться с любого конца,
     * поэтому её разворачивают: доля вдоль участка отсчитывается от узла A.
     */
    orientedWay: function (network, segment) {
        var a = network.nodes[segment.nodeA].point3d;
        var b = network.nodes[segment.nodeB].point3d;

        if (!segment.polyline || segment.polyline.length < 2)
            return [a, b];

        var way = segment.polyline.slice(0);
        if (way[0].distanceTo(a) > way[way.length - 1].distanceTo(a))
            way.reverse();

        return way;
    },

    /**
     * Ближайшая точка на оси участка и доля пути до неё от узла A.
     * Доля считается по длине хода, а не по прямой: у участка с отводом
     * это разные вещи, и делить его длину надо по трубе.
     */
    pointOnSegment: function (network, segment, point) {
        var way = NetworkEdit.orientedWay(network, segment);

        var best = null;
        var bestDistance = Infinity;
        var bestBefore = 0.0;
        var total = 0.0;
        var i;

        var lengths = [];
        for (i = 1; i < way.length; i++) {
            var leg = way[i - 1].distanceTo(way[i]);
            lengths.push(leg);
            total += leg;
        }

        var before = 0.0;
        for (i = 1; i < way.length; i++) {
            var foot = footOnLine(way[i - 1], way[i], point);
            var distance = foot.point.distanceTo(point);

            if (distance < bestDistance) {
                bestDistance = distance;
                best = foot;
                bestBefore = before;
            }

            before += lengths[i - 1];
        }

        if (!best || total <= 1e-9)
            return { point: way[0], fraction: 0.0, distance: bestDistance };

        var along = bestBefore + best.along;
        return { point: best.point, fraction: along / total, distance: bestDistance };
    },

    /**
     * Разрезать участок в точке: там появляется узел, к которому можно
     * присоединиться. Без этого подводка, дотянутая до магистрали, остаётся
     * с ней не связанной — на глаз линии пересекаются, а в графе это два
     * разных куска, и кольцо через них не замыкается.
     *
     * Возвращает номер узла в точке разреза. Если точка пришлась на конец
     * участка, разрез не нужен — возвращается существующий узел.
     *
     * Индексы прежних участков не меняются: исходный правится на месте,
     * а вторая половина добавляется в конец. На это опирается тот, кто режет
     * два участка подряд.
     */
    splitSegment: function (network, index, point, existingNode) {
        var segment = network.segments[index];
        if (!segment) return -1;

        var found = NetworkEdit.pointOnSegment(network, segment, point);
        var fraction = found.fraction;

        // Совсем у конца резать нечего: там уже есть узел.
        if (fraction <= 1e-4) return segment.nodeA;
        if (fraction >= 1.0 - 1e-4) return segment.nodeB;

        var flatA = network.nodes[segment.nodeA].pointFlat;
        var flatB = network.nodes[segment.nodeB].pointFlat;

        var node;
        if (existingNode !== undefined && existingNode >= 0) {
            node = network.nodes[existingNode];
        } else {
            node = network.addNode(found.point.clone());
            node.pointFlat = {
                x: flatA.x + (flatB.x - flatA.x) * fraction,
                y: flatA.y + (flatB.y - flatA.y) * fraction
            };
            node.flatPlaced = network.nodes[segment.nodeA].flatPlaced;
        }

        var tail = network.addSegment(node.index, segment.nodeB);

        tail.role = segment.role;
        tail.zoneKey = segment.zoneKey;
        tail.systemName = segment.systemName;
        tail.material = segment.material;
        tail.nominalDiameterMm = segment.nominalDiameterMm;
        tail.outerDiameter = segment.outerDiameter;
        tail.innerDiameter = segment.innerDiameter;
        tail.insulationName = segment.insulationName;
        tail.insulationThickness = segment.insulationThickness;
        tail.insulationLambda = segment.insulationLambda;
        tail.isVirtualLink = segment.isVirtualLink;
        tail.isRingClosure = segment.isRingClosure;

        // Id элементов модели остаются у обеих половин: обе действительно
        // сделаны из этих труб, и потерять след разрезанного участка нельзя.
        tail.elementIds = segment.elementIds.slice(0);

        var whole = segment.length;
        segment.length = whole * fraction;
        tail.length = whole * (1.0 - fraction);

        splitPolyline(network, segment, tail, found.point);

        // Исходный участок теперь доходит только до узла разреза. Без этого
        // он остаётся сквозным: узел висит на второй половине, труба всё так же
        // идёт мимо него, и то же место режется снова и снова.
        segment.nodeB = node.index;

        // Полотенцесушители и клапан — вещи в конкретном месте, а где именно,
        // модель не знает. Оставляем их на длинной половине и говорим об этом.
        if (segment.towelRailCount > 0 && tail.length > segment.length) {
            tail.towelRailCount = segment.towelRailCount;
            segment.towelRailCount = 0;
        }

        if (segment.valve && tail.length > segment.length) {
            tail.valve = segment.valve;
            segment.valve = null;
        }

        network.reindex();
        return node.index;
    },

    /**
     * Разрезать трубы во всех местах, где к ним вплотную подходит чужой узел.
     *
     * Нужно для того, что уже начерчено или пришло из модели: подводка упирается
     * в магистраль, на схеме они пересекаются, а связи между ними нет.
     * Возвращает число сделанных разрезов.
     */
    splitAtTouchingNodes: function (network, toleranceM) {
        var made = 0;
        var guard = 0;

        // Разрез добавляет участок, поэтому список пересматривается заново,
        // пока не перестанут находиться новые места. Ограничитель — от зацикливания
        // на вырожденной геометрии.
        var again = true;
        while (again && guard++ < 200) {
            again = false;

            for (var n = 0; n < network.nodes.length; n++) {
                var node = network.nodes[n];
                if (node.segments.length === 0) continue;

                var index = touchedSegment(network, n, toleranceM);
                if (index < 0) continue;

                NetworkEdit.splitSegment(network, index, node.point3d, n);
                made++;
                again = true;
                break;
            }
        }

        return made;
    },

    removeSegment: function (network, index) {
        if (index < 0 || index >= network.segments.length) return;

        network.segments.splice(index, 1);
        network.reindex();
        NetworkEdit.dropOrphanNodes(network);
    },

    /** Узел вместе со всем, что к нему подходит. */
    removeNode: function (network, index) {
        if (index < 0 || index >= network.nodes.length) return;

        var keep = [];
        for (var i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            if (segment.nodeA !== index && segment.nodeB !== index)
                keep.push(segment);
        }

        network.segments = keep;
        network.nodes.splice(index, 1);

        // Ссылки на узлы после удалённого сдвигаются на единицу.
        for (i = 0; i < network.segments.length; i++) {
            var s = network.segments[i];
            if (s.nodeA > index) s.nodeA--;
            if (s.nodeB > index) s.nodeB--;
        }

        var sources = [];
        for (i = 0; i < network.sourceNodes.length; i++) {
            var node = network.sourceNodes[i];
            if (node === index) continue;
            sources.push(node > index ? node - 1 : node);
        }
        network.sourceNodes = sources;

        network.reindex();
    },

    /** Узлы, к которым больше ничего не подходит, в сети не нужны. */
    dropOrphanNodes: function (network) {
        for (var i = network.nodes.length - 1; i >= 0; i--) {
            if (network.nodes[i].segments.length > 0) continue;
            if (network.isSource(i)) continue;      // ИТП остаётся и без труб
            NetworkEdit.removeNode(network, i);
        }
    },

    /** Пометить или снять узел как выход ИТП. */
    toggleSource: function (network, index) {
        var at = network.sourceNodes.indexOf(index);
        if (at >= 0) {
            network.sourceNodes.splice(at, 1);
            return false;
        }

        network.sourceNodes.push(index);
        return true;
    },

    /** Поставить или снять балансировочный клапан на участке. */
    toggleValve: function (network, index) {
        var segment = network.segments[index];
        if (!segment) return false;

        if (segment.valve && !segment.valve.automatic) {
            segment.valve = null;
            return false;
        }

        segment.valve = newValveState(false);
        return true;
    },

    /**
     * Пары свободных концов, которые стоят близко, но не соединены. Ими
     * заполняется вкладка «Возможные перемычки»: программа предлагает, решает человек.
     */
    findCandidates: function (network, radiusMetres) {
        var free = [];
        var i, k;

        for (i = 0; i < network.nodes.length; i++) {
            if (network.nodes[i].segments.length !== 1) continue;
            if (network.isSource(i)) continue;

            var segment = network.segments[network.nodes[i].segments[0]];
            free.push({ node: i, role: segment.role, zoneKey: segment.zoneKey,
                        systemName: segment.systemName });
        }

        var pairs = [];
        for (i = 0; i < free.length; i++) {
            for (k = i + 1; k < free.length; k++) {
                var distance = network.nodes[free[i].node].point3d
                    .distanceTo(network.nodes[free[k].node].point3d);

                if (distance > radiusMetres) continue;

                pairs.push({
                    a: free[i], b: free[k],
                    gapMm: distance * 1000.0,
                    sameSystem: free[i].role === free[k].role,
                    sameZone: free[i].zoneKey === free[k].zoneKey
                });
            }
        }

        // Сначала пары в своей зоне, потом ближние: имя всё-таки что-то значит,
        // просто одного его мало.
        pairs.sort(function (x, y) {
            if (x.sameZone !== y.sameZone) return x.sameZone ? -1 : 1;
            return x.gapMm - y.gapMm;
        });

        return pairs;
    },

    /**
     * Автоматическая сшивка: замыкания колец Т3–Т4 по одному допуску, разрывы
     * внутри одной системы — по своему, заметно большему. Порог отдельный потому,
     * что это разные вещи: замыкание — два конца, подведённых вплотную,
     * а разрыв в трубе бывает шире.
     *
     * Каждый свободный конец достаётся одной перемычке, ближние разбираются первыми.
     */
    autoConnect: function (network, settings) {
        var closureLimit = settings.linkToleranceMm / 1000.0;
        var stitchLimit = settings.linkSameSystem ? settings.sameSystemToleranceMm / 1000.0 : 0.0;

        var pairs = NetworkEdit.findCandidates(network, Math.max(closureLimit, stitchLimit));
        var taken = {};

        var closures = 0;
        var stitches = 0;
        var widest = 0.0;

        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i];
            if (taken[pair.a.node] || taken[pair.b.node]) continue;

            var allowed = pair.sameSystem ? stitchLimit : closureLimit;
            if (pair.gapMm / 1000.0 > allowed) continue;

            if (!pair.sameSystem && !settings.linkAcrossZones && !pair.sameZone)
                continue;

            taken[pair.a.node] = true;
            taken[pair.b.node] = true;

            if (pair.sameSystem) {
                NetworkEdit.addStitch(network, pair.a.node, pair.b.node,
                    pair.a.role, pair.a.zoneKey, pair.a.systemName);
                stitches++;
            } else {
                // Перемычка идёт от Т3 к Т4: кольцо собирается по подаче
                // до перемычки и по обратке от неё.
                var supply = pair.a.role === PipeRole.Supply ? pair.a : pair.b;
                var ret = pair.a.role === PipeRole.Supply ? pair.b : pair.a;

                NetworkEdit.addRingClosure(network, supply.node, ret.node, supply.zoneKey);
                closures++;
            }

            if (pair.gapMm > widest) widest = pair.gapMm;
        }

        return { closures: closures, stitches: stitches, widestGapMm: widest };
    }
};

/** Основание перпендикуляра из точки на отрезок и путь до него от начала отрезка. */
function footOnLine(a, b, point) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    var lengthSquared = dx * dx + dy * dy + dz * dz;

    if (lengthSquared < 1e-12)
        return { point: a.clone(), along: 0.0 };

    var t = ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) / lengthSquared;
    if (t < 0.0) t = 0.0;
    if (t > 1.0) t = 1.0;

    var foot = new Pt3(a.x + dx * t, a.y + dy * t, a.z + dz * t);
    return { point: foot, along: Math.sqrt(lengthSquared) * t };
}

/** Разделить ломаную участка между двумя половинами по точке разреза. */
function splitPolyline(network, head, tail, point) {
    if (!head.polyline || head.polyline.length < 3) {
        head.polyline = [];
        tail.polyline = [];
        return;
    }

    var way = NetworkEdit.orientedWay(network, head);

    var cut = 0;
    var best = Infinity;
    for (var i = 1; i < way.length; i++) {
        var foot = footOnLine(way[i - 1], way[i], point);
        var distance = foot.point.distanceTo(point);
        if (distance < best) { best = distance; cut = i; }
    }

    var first = way.slice(0, cut);
    first.push(point.clone());

    var second = [point.clone()];
    for (var k = cut; k < way.length; k++)
        second.push(way[k]);

    head.polyline = first;
    tail.polyline = second;
}

/**
 * Участок, к которому узел прижался вплотную, но с которым не связан.
 * Возвращает −1, если такого нет.
 *
 * Перед точным замером идёт грубый отсев по габариту: на импортированной сети
 * узлов и участков тысячи, и мерить каждый с каждым значило бы ждать минуту.
 */
function touchedSegment(network, nodeIndex, tolerance) {
    var node = network.nodes[nodeIndex];
    var point = node.point3d;

    for (var i = 0; i < network.segments.length; i++) {
        var segment = network.segments[i];

        if (segment.nodeA === nodeIndex || segment.nodeB === nodeIndex) continue;
        if (segment.isVirtualLink) continue;          // перемычки не режем: они условные

        var a = network.nodes[segment.nodeA].point3d;
        var b = network.nodes[segment.nodeB].point3d;

        if (point.x < Math.min(a.x, b.x) - tolerance || point.x > Math.max(a.x, b.x) + tolerance) continue;
        if (point.y < Math.min(a.y, b.y) - tolerance || point.y > Math.max(a.y, b.y) + tolerance) continue;
        if (point.z < Math.min(a.z, b.z) - tolerance || point.z > Math.max(a.z, b.z) + tolerance) continue;

        var found = NetworkEdit.pointOnSegment(network, segment, point);
        if (found.distance > tolerance) continue;
        if (found.fraction <= 1e-4 || found.fraction >= 1.0 - 1e-4) continue;

        return i;
    }

    return -1;
}
