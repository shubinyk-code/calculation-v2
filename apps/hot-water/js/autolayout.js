'use strict';

/*
    Автоматическая раскладка плоской принципиальной схемы.
    Порт HotWaterCirculation/src/SchematicLayout.cs.

    Настоящая геометрия здесь не годится: стояки в плане стоят там, где им положено
    по зданию, и в проекции налезают друг на друга. Принципиальная схема раскладывает
    сеть по смыслу, а не по месту:

      по вертикали — настоящая отметка узла, чтобы этажи выстроились в линию;
      по горизонтали — колонка кольца, к которому узел относится.

    Узел, принадлежащий нескольким кольцам (общая магистраль), встаёт посередине
    между их колонками, и магистраль сама собой рисуется стволом с ветвлениями.
    Подающая и циркуляционная части кольца расходятся на полшага влево и вправо —
    получается привычная пара стояков Т3 и Т4, сомкнутая перемычкой поверху.

    Раскладка НЕ трогает длину участка. Плоская схема и трёхмерная — две
    независимые картинки одной сети: двигать узел на одной можно как угодно,
    расчёт берёт длину из отдельного поля.
*/

var AutoLayout = (function () {

    /** Шаг между кольцами по горизонтали, условные единицы. */
    var RING_SPACING = 10.0;

    /** Разбег подающей и циркуляционной частей внутри пары стояков. */
    var SIDE_OFFSET = 2.2;

    /** Разбег узлов, попавших в одну точку. */
    var COLLISION_OFFSET = 1.4;

    /** Кольца, проходящие через каждый узел. */
    function ringsOfNode(network) {
        var result = [];
        var i, k;

        for (i = 0; i < network.nodes.length; i++)
            result.push([]);

        for (i = 0; i < network.rings.length; i++) {
            var ring = network.rings[i];
            for (k = 0; k < ring.segments.length; k++) {
                var segment = network.segments[ring.segments[k]];
                addOnce(result[segment.nodeA], i);
                addOnce(result[segment.nodeB], i);
            }
        }

        return result;
    }

    function addOnce(list, value) {
        if (list.indexOf(value) < 0)
            list.push(value);
    }

    /**
     * На какую сторону пары стояков встаёт узел: −1 подающая, +1 циркуляционная,
     * 0 — ИТП и точки, где сходятся обе.
     */
    function sides(network) {
        var count = network.nodes.length;
        var side = new Int32Array(count);
        var supply = new Int32Array(count);
        var circulation = new Int32Array(count);
        var i;

        for (i = 0; i < network.segments.length; i++) {
            var segment = network.segments[i];
            if (!segment.isCirculating || segment.isVirtualLink)
                continue;

            if (segment.role === PipeRole.Supply) {
                supply[segment.nodeA]++;
                supply[segment.nodeB]++;
            } else if (segment.role === PipeRole.Return) {
                circulation[segment.nodeA]++;
                circulation[segment.nodeB]++;
            }
        }

        for (i = 0; i < count; i++) {
            if (network.isSource(i) || supply[i] === circulation[i])
                side[i] = 0;
            else
                side[i] = supply[i] > circulation[i] ? -1 : 1;
        }

        return side;
    }

    /**
     * Узлы, попавшие в одну точку, разводятся по горизонтали. Так бывает на прямой
     * магистрали: несколько узлов на одной отметке и с одним набором колец слились бы
     * в одну точку, и участки между ними выродились бы в невидимые нули.
     */
    function separateOverlaps(network, placed) {
        var buckets = {};
        var i;

        for (i = 0; i < network.nodes.length; i++) {
            if (!placed[i]) continue;

            var node = network.nodes[i];
            var key = Math.round(node.pointFlat.x * 10.0) + '|' + Math.round(node.pointFlat.y * 100.0);

            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(i);
        }

        for (var key in buckets) {
            if (!buckets.hasOwnProperty(key)) continue;

            var bucket = buckets[key];
            if (bucket.length < 2) continue;

            bucket.sort(function (a, b) { return a - b; });

            var start = -COLLISION_OFFSET * (bucket.length - 1) / 2.0;
            for (i = 0; i < bucket.length; i++)
                network.nodes[bucket[i]].pointFlat.x += start + i * COLLISION_OFFSET;
        }
    }

    return {
        /**
         * Разложить плоскую схему по разобранной сети. Возвращает число
         * размещённых узлов: ноль означает, что колец ещё нет и раскладывать нечего.
         */
        build: function (network) {
            var rings = ringsOfNode(network);
            var side = sides(network);
            var placed = [];
            var i;

            for (i = 0; i < network.nodes.length; i++) {
                placed.push(false);
                network.nodes[i].flatPlaced = false;
            }

            var count = 0;

            for (i = 0; i < network.segments.length; i++) {
                var segment = network.segments[i];
                if (!segment.isCirculating) continue;

                count += place(network, rings, side, placed, segment.nodeA);
                count += place(network, rings, side, placed, segment.nodeB);
            }

            separateOverlaps(network, placed);
            return count;
        },

        /**
         * Запасная раскладка для сети, где колец ещё нет: узлы ставятся
         * по настоящим отметкам и по расстоянию в плане. Черновик, но лучше,
         * чем пустой лист.
         */
        buildRough: function (network) {
            var i;
            for (i = 0; i < network.nodes.length; i++) {
                var node = network.nodes[i];
                node.pointFlat.x = node.point3d.x + node.point3d.y * 0.5;
                node.pointFlat.y = node.point3d.z;
                node.flatPlaced = true;
            }
            return network.nodes.length;
        }
    };

    function place(network, rings, side, placed, index) {
        if (placed[index]) return 0;

        placed[index] = true;

        var node = network.nodes[index];
        node.flatPlaced = true;
        node.pointFlat.y = node.point3d.z;

        var list = rings[index];
        if (list.length === 0) {
            node.pointFlat.x = 0.0;
        } else {
            var sum = 0.0;
            for (var i = 0; i < list.length; i++)
                sum += list[i] * RING_SPACING;

            node.pointFlat.x = sum / list.length;
        }

        node.pointFlat.x += side[index] * SIDE_OFFSET;
        return 1;
    }
})();
