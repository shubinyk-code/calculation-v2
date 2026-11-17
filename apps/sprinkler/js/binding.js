'use strict';

/*
    Привязка: размеры между элементами и сдвиг на заданную величину.

    Любой размер на плане — это длина участка между двумя узлами: шаг
    оросителей на луче, расстояние от магистрали до первого оросителя,
    расстояние между лучами вдоль магистрали (магистраль разбита в узлах
    присоединения лучей). Поэтому привязка сводится к одной операции —
    задать длину участку, сдвинув один из его концов вдоль самого участка.

    Двигается конец, дальний от ввода. «Цепочкой» — вместе со всем, что за
    ним: поменяли расстояние до первого луча, и все следующие лучи уехали
    на ту же величину, их размеры сохранились. Без цепочки двигается только
    сам узел с висящими на нём лучами, а соседний размер меняется.

    Перед сдвигом проверяется, что ни один узел не проходит сквозь соседа:
    иначе участок вывернулся бы наизнанку с отрицательной длиной, а на плане
    это выглядело бы как обычная труба.
*/

var Binding = (function () {

    var MIN = 0.02;
    var BLOCKED = 'Сдвиг упирается в соседний узел — уменьшите значение.';

    function adjacency(p) {
        var adj = {};
        p.nodes.forEach(function (n) { adj[n.id] = []; });
        p.segments.forEach(function (s) {
            if (adj[s.a] && adj[s.b]) {
                adj[s.a].push(s);
                adj[s.b].push(s);
            }
        });
        return adj;
    }

    /**
     * Удалённость узлов от ввода по числу участков. Части сети без ввода
     * отсчитываются от магистрали, а совсем отдельные — от любого узла.
     */
    function depths(p) {
        var adj = adjacency(p);
        var dep = {};
        var starts = [];
        var src = Model.source(p);

        if (src) starts.push(src.id);
        p.nodes.forEach(function (n) { if (Model.touchesMain(p, n.id)) starts.push(n.id); });
        p.nodes.forEach(function (n) { starts.push(n.id); });

        starts.forEach(function (start) {
            if (dep[start] !== undefined) return;
            dep[start] = 0;
            var queue = [start];

            while (queue.length) {
                var id = queue.shift();
                adj[id].forEach(function (s) {
                    var o = s.a === id ? s.b : s.a;
                    if (dep[o] === undefined) {
                        dep[o] = dep[id] + 1;
                        queue.push(o);
                    }
                });
            }
        });

        return dep;
    }

    /** Всё, что достижимо от start, не проходя участок blockSeg. null — если есть обход (кольцо). */
    function component(p, start, blockSeg, blockNode) {
        var adj = adjacency(p);
        var seen = {};
        var queue = [start];
        seen[start] = true;

        while (queue.length) {
            var id = queue.shift();
            var list = adj[id];

            for (var i = 0; i < list.length; i++) {
                var s = list[i];
                if (s.id === blockSeg) continue;
                var o = s.a === id ? s.b : s.a;
                if (o === blockNode) return null;
                if (!seen[o]) {
                    seen[o] = true;
                    queue.push(o);
                }
            }
        }

        return Object.keys(seen).map(Number);
    }

    /** Узел и лучи, висящие на нём, если он стоит на магистрали. */
    function hanging(p, id) {
        var set = {};
        set[id] = true;

        var n = Model.node(p, id);
        if (n && (Model.touchesMain(p, id) || n.src)) {
            Model.segmentsAt(p, id).forEach(function (s) {
                if (s.role === 'main') return;
                var br = Model.branchOf(p, s.id);
                if (br && br.attaches.length === 1) br.nodes.forEach(function (x) { set[x] = true; });
            });
        }

        return Object.keys(set).map(Number);
    }

    /** Участок к соседу, более близкому к вводу. */
    function parentLink(p, id, dep) {
        var best = null;
        Model.segmentsAt(p, id).forEach(function (s) {
            var o = Model.other(s, id);
            if (dep[o] < dep[id] && (!best || dep[o] < dep[best.o])) best = { s: s, o: o };
        });
        return best;
    }

    /** Узел со всем, что за ним дальше от ввода. */
    function tailOf(p, id) {
        var dep = depths(p);
        var link = parentLink(p, id, dep);
        var comp = link ? component(p, id, link.s.id, link.o) : null;
        return comp || hanging(p, id);
    }

    function check(p, ids, dx, dy) {
        var inSet = {};
        ids.forEach(function (x) { inSet[x] = true; });

        for (var i = 0; i < p.segments.length; i++) {
            var s = p.segments[i];
            var ina = !!inSet[s.a];
            if (ina === !!inSet[s.b]) continue;

            var M = Model.node(p, ina ? s.a : s.b);
            var O = Model.node(p, ina ? s.b : s.a);
            var ox = O.x - M.x;
            var oy = O.y - M.y;
            var nx = ox - dx;
            var ny = oy - dy;

            if (Math.sqrt(nx * nx + ny * ny) < MIN || ox * nx + oy * ny <= 0) return BLOCKED;
        }

        return null;
    }

    function translate(p, ids, dx, dy) {
        ids.forEach(function (id) {
            var n = Model.node(p, id);
            n.x += dx;
            n.y += dy;
        });
    }

    /**
     * Задать участку длину по плану, сдвинув конец movingId вдоль участка.
     * tail — цепочкой, если двигается конец, дальний от ввода.
     */
    function moveEnd(p, segId, movingId, newLen, tail) {
        var s = Model.seg(p, segId);
        if (!s) return { error: 'Участок не найден.' };
        if (!(newLen > MIN)) return { error: 'Длина должна быть больше нуля.' };

        var fixedId = Model.other(s, movingId);
        var A = Model.node(p, fixedId);
        var M = Model.node(p, movingId);
        var L = Model.geomLength(p, s);
        if (L < 1e-9) return { error: 'У участка нулевая длина — направление не определить.' };

        var d = newLen - L;
        var dx = (M.x - A.x) / L * d;
        var dy = (M.y - A.y) / L * d;
        var dep = depths(p);
        var ids = null;

        if (tail && dep[fixedId] < dep[movingId]) ids = component(p, movingId, segId, fixedId);
        if (!ids) ids = hanging(p, movingId);
        if (ids.indexOf(fixedId) >= 0) return { error: BLOCKED };

        var err = check(p, ids, dx, dy);
        if (err) return { error: err };

        translate(p, ids, dx, dy);
        s.len = null;
        return { moved: ids.length };
    }

    /** Сдвинуть узел (с висящими лучами, а с tail — со всем хвостом). */
    function shift(p, id, dx, dy, tail) {
        var ids = tail ? tailOf(p, id) : hanging(p, id);
        var err = check(p, ids, dx, dy);
        if (err) return { error: err };
        translate(p, ids, dx, dy);
        return { moved: ids.length };
    }

    /** Оси узла: u — вдоль трубы от соседа ближе к вводу, v — поперёк. */
    function axisOf(p, id) {
        var n = Model.node(p, id);
        var dep = depths(p);
        var link = parentLink(p, id, dep);

        if (!link) {
            var list = Model.segmentsAt(p, id);
            if (list.length) link = { s: list[0], o: Model.other(list[0], id) };
        }

        if (!link) return { u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, from: null };

        var O = Model.node(p, link.o);
        var u = Model.unit(n.x - O.x, n.y - O.y);
        return { u: u, v: { x: -u.y, y: u.x }, from: link.o };
    }

    /** Направление магистрали в узле присоединения; null — если там угол. */
    function mainAxis(p, attachId) {
        var A = Model.node(p, attachId);
        var mains = Model.segmentsAt(p, attachId).filter(function (s) { return s.role === 'main'; });
        if (!mains.length) return null;

        var towards = Model.other(mains[0], attachId);
        var O = Model.node(p, towards);
        var u = Model.unit(O.x - A.x, O.y - A.y);

        for (var i = 1; i < mains.length; i++) {
            var O2 = Model.node(p, Model.other(mains[i], attachId));
            var w = Model.unit(O2.x - A.x, O2.y - A.y);
            if (Math.abs(u.x * w.y - u.y * w.x) > 1e-3) return null;
        }

        return { x: u.x, y: u.y, towards: towards };
    }

    /** Пределы сдвига узла присоединения вдоль магистрали — до соседних узлов. */
    function mainLimits(p, attachId, u) {
        var A = Model.node(p, attachId);
        var lim = { min: -Infinity, max: Infinity };

        Model.segmentsAt(p, attachId).forEach(function (s) {
            if (s.role !== 'main') return;
            var O = Model.node(p, Model.other(s, attachId));
            var t = (O.x - A.x) * u.x + (O.y - A.y) * u.y;
            if (t > 0) lim.max = Math.min(lim.max, t - 0.05);
            else lim.min = Math.max(lim.min, t + 0.05);
        });

        return lim;
    }

    function firstNode(p, br) {
        var list = Model.segmentsAt(p, br.attach);
        for (var i = 0; i < list.length; i++) {
            if (br.segs.indexOf(list[i].id) >= 0) return Model.other(list[i], br.attach);
        }
        return null;
    }

    /** Участки луча по порядку от магистрали: { segId, inner, outer }. */
    function rayOrder(p, br) {
        var order = [];
        var used = {};
        var seen = {};
        var queue = [br.attach];
        seen[br.attach] = true;

        while (queue.length) {
            var id = queue.shift();
            Model.segmentsAt(p, id).forEach(function (s) {
                if (used[s.id] || br.segs.indexOf(s.id) < 0) return;
                used[s.id] = true;
                var o = Model.other(s, id);
                order.push({ segId: s.id, inner: id, outer: o });
                if (!seen[o]) {
                    seen[o] = true;
                    queue.push(o);
                }
            });
        }

        return order;
    }

    /** Один шаг всем оросителям луча, кроме участка от магистрали. */
    function setRayStep(p, br, step) {
        if (!br || br.attach === null) return { error: 'Луч не присоединён к магистрали.' };
        if (!(step > MIN)) return { error: 'Шаг должен быть больше нуля.' };

        var order = rayOrder(p, br);
        for (var i = 1; i < order.length; i++) {
            var res = moveEnd(p, order[i].segId, order[i].outer, step, true);
            if (res.error) return res;
        }
        return { moved: order.length - 1 };
    }

    /**
     * Сдвинуть луч на delta: 'main' — вдоль магистрали (вместе с узлом
     * присоединения), 'ray' — вдоль самого луча (узел присоединения стоит).
     */
    function moveBranchAlong(p, br, which, delta) {
        if (!br || br.attach === null) return { error: 'Луч не присоединён к магистрали.' };
        if (!delta) return { error: 'Введите величину сдвига.' };

        var A = Model.node(p, br.attach);
        var ids;
        var u;

        if (which === 'main') {
            u = mainAxis(p, br.attach);
            if (!u) return { error: 'В узле присоединения магистраль поворачивает — вдоль неё не сдвинуть.' };
            ids = hanging(p, br.attach);
        } else {
            var F = Model.node(p, firstNode(p, br));
            u = Model.unit(F.x - A.x, F.y - A.y);
            ids = br.nodes;
        }

        var dx = u.x * delta;
        var dy = u.y * delta;
        var err = check(p, ids, dx, dy);
        if (err) return { error: err };

        translate(p, ids, dx, dy);
        return { moved: ids.length };
    }

    return {
        depths: depths,
        hanging: hanging,
        tailOf: tailOf,
        check: check,
        moveEnd: moveEnd,
        shift: shift,
        axisOf: axisOf,
        mainAxis: mainAxis,
        mainLimits: mainLimits,
        firstNode: firstNode,
        rayOrder: rayOrder,
        setRayStep: setRayStep,
        moveBranchAlong: moveBranchAlong
    };
})();
