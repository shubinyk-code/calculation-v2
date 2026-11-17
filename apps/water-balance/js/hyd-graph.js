/*
    Граф холста: порты (точки подключения), геометрия труб, правка (разрезать
    трубу, удалить узел), автотрассировка, стартовая схема и копирование трассы
    ХВС на лист ГВС.

    Труба — ломаная от порта узла a до порта узла b через промежуточные вершины
    pts. Порт — именованная точка подключения на объекте (слева, справа, сверху,
    снизу; у тройника — центр). Если порт у трубы не указан (pa / pb), берётся
    ближайший к соседней точке трассы — так работают трубы, созданные вставкой
    узла в разрыв.

    Все операции работают с hyd.canvas напрямую; перерисовку и пересчёт
    запускает вызывающий.
*/

var HydGraph = (function () {
    'use strict';

    function nodeById(hyd, id) { return HydModel.nodeById(hyd, id); }

    function onSheet(node, sheet) { return node.sheet === 'both' || node.sheet === sheet; }

    /* --- порты ----------------------------------------------------------------- */

    /* [id, dx, dy, направление выхода x, y] относительно положения узла. */
    var PORTS = {
        input: [['r', 16, 0, 1, 0], ['b', 0, 16, 0, 1], ['t', 0, -16, 0, -1], ['l', -16, 0, -1, 0]],
        // счётчик всегда на линии трубы: два порта вдоль оси, горизонтальный или вертикальный
        meter: function (n) {
            return n.rot === 90 ? [['t', 0, -22, 0, -1], ['b', 0, 22, 0, 1]] : [['l', -22, 0, -1, 0], ['r', 22, 0, 1, 0]];
        },
        pump: function (n) {
            var h = pumpHeight(n) / 2 + 4;
            return [['l', -75, 0, -1, 0], ['r', 75, 0, 1, 0], ['t', 0, -h, 0, -1], ['b', 0, h, 0, 1]];
        },
        itp: [['l', -30, 0, -1, 0], ['r', 30, 0, 1, 0], ['t', 0, -16, 0, -1], ['b', 0, 16, 0, 1]],
        buildin: [['l', -62, 0, -1, 0], ['r', 62, 0, 1, 0], ['t', 0, -14, 0, -1], ['b', 0, 14, 0, 1]],
        tee: [['c', 0, 0, 0, 0]],
        riser: [['b', 0, 18, 0, 1], ['l', -26, 9, -1, 0], ['r', 26, 9, 1, 0]]
    };

    /* Число насосов установки (рабочие + резервные) и высота её обвязки на схеме. */
    function pumpCount(n) { return Math.max(1, Math.min(5, (n.work || 1) + (n.reserve || 0))); }
    function pumpHeight(n) { return 30 + pumpCount(n) * 36; }

    /* Порты объекта относительно его положения: [id, dx, dy, выход x, выход y]. */
    function portDefs(node) {
        var d = PORTS[node.kind] || PORTS.tee;
        return typeof d === 'function' ? d(node) : d;
    }

    /* Порты узла в координатах листа. */
    function portsOf(node, sheet) {
        var p = HydModel.pos(node, sheet);
        return portDefs(node).map(function (q) {
            return { id: q[0], x: p.x + q[1], y: p.y + q[2], dx: q[3], dy: q[4] };
        });
    }

    /* Порт трубы на конце node: названный или ближайший к точке toward. */
    function endPort(node, portId, sheet, toward) {
        var list = portsOf(node, sheet);
        var best = null;

        for (var i = 0; i < list.length; i++) {
            if (portId && list[i].id === portId) return list[i];
            var d = Math.hypot(list[i].x - toward.x, list[i].y - toward.y);
            if (!best || d < best.d) best = { port: list[i], d: d };
        }

        return best.port;
    }

    /* Точки трубы: порт начала, вершины, порт конца — в координатах её листа. */
    function ptsOf(hyd, pipe) {
        var a = nodeById(hyd, pipe.a);
        var b = nodeById(hyd, pipe.b);
        var pa0 = HydModel.pos(a, pipe.sheet);
        var pb0 = HydModel.pos(b, pipe.sheet);
        var first = pipe.pts.length ? pipe.pts[0] : pb0;
        var last = pipe.pts.length ? pipe.pts[pipe.pts.length - 1] : pa0;
        var pa = endPort(a, pipe.pa, pipe.sheet, first);
        var pb = endPort(b, pipe.pb, pipe.sheet, last);
        return [pa].concat(pipe.pts, [pb]);
    }

    /* Ближайший порт на листе к точке p в пределах maxDist: { node, port, d }. */
    function nearestPort(hyd, sheet, p, maxDist, accept) {
        var best = null;

        hyd.canvas.nodes.forEach(function (n) {
            if (!onSheet(n, sheet)) return;
            if (accept && !accept(n)) return;
            portsOf(n, sheet).forEach(function (q) {
                var d = Math.hypot(q.x - p.x, q.y - p.y);
                if (d <= maxDist && (!best || d < best.d)) best = { node: n, port: q, d: d };
            });
        });

        return best;
    }

    /* Промежуточные точки ортогональной трассы между портами с выходами d0 и d1. */
    function route(p0, d0, p1, d1) {
        if (p0.x === p1.x || p0.y === p1.y) return [];

        var h0 = d0 && (d0.dx || d0.dy) ? d0.dx !== 0 : null;
        var h1 = d1 && (d1.dx || d1.dy) ? d1.dx !== 0 : null;

        if (h0 === null && h1 === null) h0 = true;
        if (h0 === null) h0 = !h1;
        if (h1 === null) h1 = !h0;

        if (h0 && !h1) return [{ x: p1.x, y: p0.y }];
        if (!h0 && h1) return [{ x: p0.x, y: p1.y }];

        if (h0) {
            var mx = Math.round((p0.x + p1.x) / 2);
            return [{ x: mx, y: p0.y }, { x: mx, y: p1.y }];
        }

        var my = Math.round((p0.y + p1.y) / 2);
        return [{ x: p0.x, y: my }, { x: p1.x, y: my }];
    }

    /* --- геометрия ------------------------------------------------------------- */

    function polyLen(pts) {
        var s = 0;
        for (var i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return s;
    }

    /* Ближайшая к точке p точка ломаной: { i — номер звена, pt, d — расстояние }. */
    function nearestOnPoly(pts, p) {
        var best = null;

        for (var i = 0; i + 1 < pts.length; i++) {
            var a = pts[i];
            var b = pts[i + 1];
            var dx = b.x - a.x;
            var dy = b.y - a.y;
            var len2 = dx * dx + dy * dy;
            var t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
            t = Math.max(0, Math.min(1, t));
            var q = { x: a.x + t * dx, y: a.y + t * dy };
            var d = Math.hypot(p.x - q.x, p.y - q.y);
            if (!best || d < best.d) best = { i: i, pt: q, d: d, t: t };
        }

        return best;
    }

    function nearestPipe(hyd, sheet, p, maxDist) {
        var best = null;

        hyd.canvas.pipes.forEach(function (pipe) {
            if (pipe.sheet !== sheet) return;
            var hit = nearestOnPoly(ptsOf(hyd, pipe), p);
            if (hit && hit.d <= maxDist && (!best || hit.d < best.hit.d)) best = { pipe: pipe, hit: hit };
        });

        return best;
    }

    function nextPipeId(hyd) {
        var max = 0;
        hyd.canvas.pipes.forEach(function (p) {
            var m = /^P(\d+)$/.exec(p.id);
            if (m) max = Math.max(max, +m[1]);
        });
        return 'P' + (max + 1);
    }

    /* Новая труба; pa / pb — названные порты концов (необязательно). */
    /* Другая труба между той же парой объектов на том же листе (в любую сторону). */
    function parallelOf(hyd, pipe) {
        return hyd.canvas.pipes.filter(function (q) {
            return q !== pipe && q.sheet === pipe.sheet && ((q.a === pipe.a && q.b === pipe.b) || (q.a === pipe.b && q.b === pipe.a));
        })[0] || null;
    }

    /* Две трубы между одними и теми же объектами — это кольцо из двух труб: вторая не считается. Убрать вторые. */
    function dropDuplicates(hyd) {
        var seen = {};
        var before = hyd.canvas.pipes.length;
        hyd.canvas.pipes = hyd.canvas.pipes.filter(function (p) {
            var key = p.sheet + '|' + (p.a < p.b ? p.a + '|' + p.b : p.b + '|' + p.a);
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
        return before - hyd.canvas.pipes.length;
    }

    function addPipe(hyd, a, b, sheet, pts, pa, pb) {
        var pipe = { id: nextPipeId(hyd), a: a, b: b, sheet: sheet, pts: pts || [] };
        if (pa) pipe.pa = pa;
        if (pb) pipe.pb = pb;
        hyd.canvas.pipes.push(pipe);
        return pipe;
    }

    /* Разрезать трубу в точке hit новым узлом node: возвращает две трубы. */
    function splitPipe(hyd, pipe, hit, node) {
        var tail = { id: nextPipeId(hyd), a: node.id, b: pipe.b, sheet: pipe.sheet, pts: pipe.pts.slice(hit.i) };
        if (pipe.pb) tail.pb = pipe.pb;
        pipe.b = node.id;
        delete pipe.pb;
        pipe.pts = pipe.pts.slice(0, hit.i);
        hyd.canvas.pipes.push(tail);
        return [pipe, tail];
    }

    function degree(hyd, id) {
        var n = 0;
        hyd.canvas.pipes.forEach(function (p) { if (p.a === id || p.b === id) n++; });
        return n;
    }

    /*
        Сколько труб на листе может прийти к объекту. Стояк и встроенное помещение —
        тупики (одна труба); ИТП на листе ХВС — тоже (подача), а на листе ГВС от него
        отходит вся горячая сеть.
    */
    function limit(node, sheet) {
        if (node.kind === 'riser' || node.kind === 'buildin') return 1;
        if (node.kind === 'itp' && sheet === 'c') return 1;
        return 99;
    }

    function degreeOn(hyd, id, sheet) {
        var n = 0;
        hyd.canvas.pipes.forEach(function (p) { if (p.sheet === sheet && (p.a === id || p.b === id)) n++; });
        return n;
    }

    /* К объекту уже подведено максимум труб на этом листе. */
    function full(hyd, node, sheet) {
        return degreeOn(hyd, node.id, sheet) >= limit(node, sheet);
    }

    /*
        Удалить узел. Проходной узел (счётчик, насос, тройник на двух трубах)
        удаляется с сохранением трассы — две трубы склеиваются в одну.
    */
    function removeNode(hyd, id) {
        var node = nodeById(hyd, id);
        if (!node) return;

        var attached = hyd.canvas.pipes.filter(function (p) { return p.a === id || p.b === id; });

        if (attached.length === 2 && attached[0].sheet === attached[1].sheet
            && (node.kind === 'meter' || node.kind === 'pump' || node.kind === 'tee')) {
            var p1 = attached[0];
            var p2 = attached[1];
            var sheet = p1.sheet;

            // направить обе трубы «к узлу — от узла»
            var in1 = p1.b === id;
            var pts1 = in1 ? p1.pts.slice() : p1.pts.slice().reverse();
            var from = in1 ? p1.a : p1.b;
            var fromPort = in1 ? p1.pa : p1.pb;
            var out2 = p2.a === id;
            var pts2 = out2 ? p2.pts.slice() : p2.pts.slice().reverse();
            var to = out2 ? p2.b : p2.a;
            var toPort = out2 ? p2.pb : p2.pa;

            p1.a = from;
            p1.b = to;
            delete p1.pa;
            delete p1.pb;
            if (fromPort) p1.pa = fromPort;
            if (toPort) p1.pb = toPort;
            p1.pts = pts1.concat([HydModel.pos(node, sheet)], pts2);
            hyd.canvas.pipes = hyd.canvas.pipes.filter(function (p) { return p !== p2; });
        } else {
            hyd.canvas.pipes = hyd.canvas.pipes.filter(function (p) { return p.a !== id && p.b !== id; });
        }

        hyd.canvas.nodes = hyd.canvas.nodes.filter(function (n) { return n.id !== id; });
        dropOrphanTees(hyd);
    }

    /*
        Удалить трубу. Узел-тройник, у которого не осталось ни одной трубы, больше ничего не
        соединяет — он удаляется вместе с последней трубой, иначе на схеме остаются «кружки».
    */
    function removePipe(hyd, id) {
        hyd.canvas.pipes = hyd.canvas.pipes.filter(function (p) { return p.id !== id; });
        dropOrphanTees(hyd);
    }

    /* Тройники без единой трубы — мусор после удаления: убрать. Возвращает, сколько убрано. */
    function dropOrphanTees(hyd) {
        var used = {};
        hyd.canvas.pipes.forEach(function (p) { used[p.a] = true; used[p.b] = true; });
        var before = hyd.canvas.nodes.length;
        hyd.canvas.nodes = hyd.canvas.nodes.filter(function (n) { return n.kind !== 'tee' || used[n.id]; });
        return before - hyd.canvas.nodes.length;
    }

    /*
        Дерево обхода листа от корней. Возвращает
        { order, parent: { id: { p, pipe } }, children: { id: [id] }, reached, cycles }.
        Труба — двунаправленная; направление задаёт обход от ввода (или ИТП).
    */
    function tree(hyd, sheet, roots) {
        var adj = {};

        hyd.canvas.pipes.forEach(function (pipe) {
            if (pipe.sheet !== sheet) return;
            var a = nodeById(hyd, pipe.a);
            var b = nodeById(hyd, pipe.b);
            if (!a || !b || !onSheet(a, sheet) || !onSheet(b, sheet)) return;
            (adj[pipe.a] = adj[pipe.a] || []).push({ pipe: pipe, other: pipe.b });
            (adj[pipe.b] = adj[pipe.b] || []).push({ pipe: pipe, other: pipe.a });
        });

        var out = { order: [], parent: {}, children: {}, reached: {}, cycles: 0 };
        var queue = [];

        roots.forEach(function (r) {
            out.reached[r] = true;
            queue.push(r);
        });

        for (var q = 0; q < queue.length; q++) {
            var id = queue[q];
            out.order.push(id);
            out.children[id] = out.children[id] || [];

            (adj[id] || []).forEach(function (e) {
                if (out.parent[id] && out.parent[id].pipe === e.pipe) return;

                if (out.reached[e.other]) {
                    // дойдя до уже обойдённого узла по другой трубе, нашли кольцо
                    if (!(out.parent[e.other] && out.parent[e.other].pipe === e.pipe)) out.cycles++;
                    return;
                }

                out.reached[e.other] = true;
                out.parent[e.other] = { p: id, pipe: e.pipe };
                out.children[id].push(e.other);
                queue.push(e.other);
            });
        }

        out.cycles = Math.floor(out.cycles / 2);
        return out;
    }

    /* --- стартовая схема ------------------------------------------------------- */

    function connect(hyd, a, b, sheet, pts, pa, pb) {
        return addPipe(hyd, a.id, b.id, sheet, pts, pa, pb);
    }

    /*
        Каркас по умолчанию: ввод → счётчик → насосная → магистраль с ответвлениями на
        стояки секций, ответвление на ИТП; ГВС — копией трассы.
        opts: { sections, risers (на секцию), floors (всего), zones }.
        При нескольких зонах этажи делятся поровну; у каждой зоны своя насосная,
        свой ряд стояков (нижние этажи — транзит без выходов) и своя ИТП. Зоны
        рисуются рядами сверху вниз и подключаются к общей магистрали после счётчика.
    */
    function starter(hyd, opts) {
        opts = opts || {};
        var sections = Math.max(1, opts.sections || 1);
        var perSection = Math.max(1, opts.risers || 2);
        var floors = Math.max(1, opts.floors || 9);
        var zones = Math.max(1, Math.min(4, opts.zones || 1));
        var yMain = 660;
        var step = zones > 1 ? floors * hyd.survey.floorPx + 230 : 0;

        hyd.canvas = { nodes: [], pipes: [] };
        hyd.pipes = {};
        hyd.lengths = {};
        hyd.pumpSel = {};

        if (!hyd.floorTypes.length) hyd.floorTypes = HydModel.defaultTypes();

        var typeId = hyd.floorTypes[0].id;
        var N = function (kind, x, y, sheet) {
            var n = HydModel.newNode(hyd, kind, x, y, sheet);
            hyd.canvas.nodes.push(n);
            return n;
        };

        var input = N('input', 60, yMain);
        var meter = N('meter', 190, yMain);
        meter.role = 'main';
        connect(hyd, input, meter, 'c', [], 'r', 'l');

        var trunk = meter;          // откуда берётся вода для зоны
        var trunkPort = 'r';
        var perZone = Math.floor(floors / zones);

        for (var z = 0; z < zones; z++) {
            var y = yMain + z * step;
            var from = z * perZone + 1;
            var to = z === zones - 1 ? floors : (z + 1) * perZone;
            var feed;

            if (zones > 1) {
                // отвод на зону от общей магистрали (вертикальная линия слева)
                var tz = N('tee', 330, y);
                connect(hyd, trunk, tz, 'c', [], trunkPort, 'c');
                trunk = tz;
                trunkPort = 'c';
                feed = tz;
            } else {
                feed = meter;
            }

            var pump = N('pump', zones > 1 ? 500 : 390, y);
            pump.name = (z + 1) + ' зона';
            connect(hyd, feed, pump, 'c', [], zones > 1 ? 'c' : 'r', 'l');

            var tee0 = N('tee', zones > 1 ? 660 : 560, y);
            connect(hyd, pump, tee0, 'c', [], 'r', 'c');

            var itp = N('itp', tee0.x, y + 100);
            itp.name = zones > 1 ? 'ИТП ' + (z + 1) : 'ИТП';
            itp.hx = tee0.x;
            itp.hy = y;
            connect(hyd, tee0, itp, 'c', [], 'c', 't');

            var prev = tee0;
            var x = zones > 1 ? 820 : 720;
            var riserCount = 0;
            var total = sections * perSection;

            for (var s = 0; s < sections; s++) {
                if (sections > 1) {
                    // водомерный узел на ввод в секцию
                    var sec = N('meter', x - 90, y);
                    sec.role = 'section';
                    connect(hyd, prev, sec, 'c', [], 'c', 'l');
                    prev = sec;
                }

                for (var r = 0; r < perSection; r++) {
                    riserCount++;
                    var base = N('riser', x, y - 70);
                    base.baseElev = hyd.survey.pumpElev;
                    base.floorFrom = from;
                    base.floorTo = to;
                    base.ranges = [{ from: from, to: to, typeId: typeId }];
                    base.hx = x;
                    base.hy = y - 70;

                    if (riserCount < total) {
                        var tee = N('tee', x, y);
                        connect(hyd, prev, tee, 'c', [], prev.kind === 'meter' ? 'r' : 'c', 'c');
                        connect(hyd, tee, base, 'c', [], 'c', 'b');
                        prev = tee;
                    } else {
                        connect(hyd, prev, base, 'c', [{ x: x, y: y }], prev.kind === 'meter' ? 'r' : 'c', 'b');
                    }

                    x += 240;
                }

                x += 40;
            }
        }

        copyToHot(hyd);
    }

    /* Типы этажей заменены — диапазоны стояков, ссылающиеся на пропавшие, переводятся на первый. */
    function retype(hyd) {
        var ids = {};
        hyd.floorTypes.forEach(function (t) { ids[t.id] = true; });
        var first = hyd.floorTypes[0] ? hyd.floorTypes[0].id : '';

        hyd.canvas.nodes.forEach(function (n) {
            if (n.kind !== 'riser') return;
            n.ranges.forEach(function (r) { if (!ids[r.typeId]) r.typeId = first; });
            n.exceptions.forEach(function (e) { if (!ids[e.typeId]) e.typeId = first; });
        });
    }

    /*
        ГВС по трассе ХВС. Для каждой ИТП точка ответвления на неё в холодной сети
        становится началом горячей: всё, что холодная сеть питает ниже этой точки
        (тройники, стояки, встроенные, водомерные узлы секций), повторяется на листе
        ГВС с теми же координатами. Прежнее содержимое листа ГВС заменяется.
        Стояк или встроенное, попавшее под несколько ИТП, достаётся первой по порядку.
        Возвращает { ok, message }.
    */
    function copyToHot(hyd) {
        var nodes = hyd.canvas.nodes;
        var itps = nodes.filter(function (n) { return n.kind === 'itp'; });
        var inputs = nodes.filter(function (n) { return n.kind === 'input'; });

        if (!itps.length) return { ok: false, message: 'Поставьте на холсте ИТП и соедините его трубой с ХВС.' };
        if (!inputs.length) return { ok: false, message: 'На листе ХВС нет ввода.' };

        var cold = tree(hyd, 'c', inputs.map(function (n) { return n.id; }));
        var done = 0;

        // стереть лист ГВС
        hyd.canvas.pipes = hyd.canvas.pipes.filter(function (p) { return p.sheet !== 'h'; });
        hyd.canvas.nodes = hyd.canvas.nodes.filter(function (n) { return n.sheet !== 'h'; });
        nodes = hyd.canvas.nodes;

        var taken = {};

        itps.forEach(function (itp) {
            var arrival = cold.parent[itp.id];
            if (!arrival) return;

            var T = nodeById(hyd, arrival.p);
            var map = {};
            map[T.id] = itp;
            itp.hx = T.x;
            itp.hy = T.y;

            var queue = (cold.children[T.id] || []).slice().filter(function (id) {
                return nodeById(hyd, id).kind !== 'itp';
            });

            for (var q = 0; q < queue.length; q++) {
                var id = queue[q];
                var node = nodeById(hyd, id);
                var par = cold.parent[id];
                var skip = !map[par.p] || node.kind === 'itp';

                if (!skip) {
                    if (node.kind === 'tee') {
                        var t = HydModel.newNode(hyd, 'tee', node.x, node.y, 'h');
                        nodes.push(t);
                        map[id] = t;
                    } else if (node.kind === 'meter' && node.role !== 'main') {
                        var m = HydModel.newNode(hyd, 'meter', node.x, node.y, 'h');
                        m.role = node.role;
                        m.rot = node.rot;
                        nodes.push(m);
                        map[id] = m;
                    } else if ((node.kind === 'riser' || (node.kind === 'buildin' && node.hasHot)) && !taken[id]) {
                        node.hx = node.x;
                        node.hy = node.y;
                        map[id] = node;
                        taken[id] = true;
                    }
                }

                if (map[id]) {
                    var pipe = par.pipe;
                    // направление копии: от родителя к ребёнку; порты — как у холодной трубы
                    var fwd = pipe.a === par.p;
                    var pts = fwd ? pipe.pts.map(clonePt) : pipe.pts.map(clonePt).reverse();
                    var childPort = fwd ? pipe.pb : pipe.pa;
                    var parentPort = fwd ? pipe.pa : pipe.pb;
                    addPipe(hyd, map[par.p].id, map[id].id, 'h', pts, map[par.p] === itp ? '' : (map[par.p].kind === 'tee' ? 'c' : parentPort), childPort);
                }

                (cold.children[id] || []).forEach(function (c) { queue.push(c); });
            }

            done++;
        });

        if (!done) return { ok: false, message: 'ИТП не соединён трубой с ХВС.' };
        return { ok: true, message: 'ГВС скопирована с трассы ХВС (ИТП: ' + done + ').' };
    }

    function clonePt(p) { return { x: p.x, y: p.y }; }

    return {
        PORTS: PORTS,
        portDefs: portDefs,
        dropOrphanTees: dropOrphanTees,
        parallelOf: parallelOf,
        dropDuplicates: dropDuplicates,
        pumpCount: pumpCount,
        pumpHeight: pumpHeight,
        portsOf: portsOf,
        endPort: endPort,
        nearestPort: nearestPort,
        route: route,
        ptsOf: ptsOf,
        polyLen: polyLen,
        nearestOnPoly: nearestOnPoly,
        nearestPipe: nearestPipe,
        addPipe: addPipe,
        splitPipe: splitPipe,
        removeNode: removeNode,
        removePipe: removePipe,
        degree: degree,
        limit: limit,
        degreeOn: degreeOn,
        full: full,
        tree: tree,
        starter: starter,
        retype: retype,
        copyToHot: copyToHot,
        onSheet: onSheet
    };
})();
