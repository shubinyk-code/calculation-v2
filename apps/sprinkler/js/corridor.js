'use strict';

/*
    Расстановка оросителей в коридорах жилых домов выше 75 м.

    ЗАЧЕМ ОТДЕЛЬНО ОТ ОБЫЧНОГО ЛУЧА. Луч в зале ставится по сетке: шаг один на
    всю площадь, и его задаёт площадь орошения. В коридоре сетки нет — есть
    двери. Каждая квартирная дверь должна быть прикрыта оросителем, и это
    требование сильнее равномерности: между двумя дверями шаг может выйти и
    2,33 м, и 3,06 м, как на рабочих чертежах, и оба правильны.

    ПРАВИЛА, по которым идёт расстановка:

      — у каждой квартирной двери ороситель не далее 0,5 м. Обычно он стоит
        прямо напротив двери, и 0,5 м — это допуск на то, что напротив мешает
        светильник или короб;
      — между оросителями не ближе 1,5 м и не далее 3,5 м;
      — от торца коридора не далее половины наибольшего шага: иначе конец
        коридора остаётся неорошённым.

    Двери НЕквартирные — электрощитовая, мусорокамера, выход на лестницу — в
    расстановку не входят: оросителем прикрывают пути эвакуации из квартир.
    Отмечает их проектировщик, а не программа: по чертежу-подложке отличить
    квартирную дверь от технической нельзя.

    ЧТО ЗДЕСЬ. Ось коридора — ломаная, она же ось трубы: повороты коридора
    получаются сами, а последняя точка ломаной — врезка в стояк. Расстановка
    считается вдоль оси в одной координате s, от начала ломаной, и только
    потом переводится в точки плана. Так повороты не мешают считать шаг.

    Revit и DOM здесь не нужны: это числа. Поэтому модуль проверяется
    самопроверкой наравне с расчётом.
*/

var Corridor = (function () {

    var EPS = 1e-9;

    function rules() {
        return {
            /** Не далее этого от квартирной двери, м. */
            doorReach: 0.5,

            /** Не ближе этого между оросителями, м. */
            minStep: 1.5,

            /** Не далее этого между оросителями, м. */
            maxStep: 3.5,

            /**
             * Не далее этого от торца коридора, м. Ноль — половина наибольшего
             * шага: столько же, сколько у обычной сетки до стены.
             */
            endReach: 0,

            /** Таблица «оросителей : Ду» для участков трубы. */
            diameters: '3:25|6:32|12:40|20:50|40:65'
        };
    }

    function merged(custom) {
        var r = rules();
        if (!custom) return r;

        for (var key in r) {
            if (Object.prototype.hasOwnProperty.call(custom, key)
                && custom[key] !== null && custom[key] !== undefined && custom[key] !== '') {
                r[key] = custom[key];
            }
        }
        return r;
    }

    /* --- ось ------------------------------------------------------------- */

    /** Длины звеньев ломаной и общая длина. */
    function spans(pts) {
        var out = [];
        var total = 0;

        for (var i = 0; i + 1 < pts.length; i++) {
            var dx = pts[i + 1].x - pts[i].x;
            var dy = pts[i + 1].y - pts[i].y;
            var len = Math.sqrt(dx * dx + dy * dy);

            out.push({ from: total, len: len, a: pts[i], b: pts[i + 1] });
            total += len;
        }

        return { parts: out, length: total };
    }

    function length(pts) {
        return spans(pts).length;
    }

    /** Точка на оси по расстоянию от её начала. */
    function at(pts, s) {
        var sp = spans(pts);
        if (!sp.parts.length) return pts.length ? { x: pts[0].x, y: pts[0].y } : null;

        if (s <= 0) return { x: pts[0].x, y: pts[0].y };
        if (s >= sp.length) {
            var tail = pts[pts.length - 1];
            return { x: tail.x, y: tail.y };
        }

        for (var i = 0; i < sp.parts.length; i++) {
            var part = sp.parts[i];
            if (s > part.from + part.len + EPS) continue;

            var t = part.len > EPS ? (s - part.from) / part.len : 0;
            return {
                x: part.a.x + (part.b.x - part.a.x) * t,
                y: part.a.y + (part.b.y - part.a.y) * t
            };
        }

        return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
    }

    /** Проекция точки на ось: расстояние вдоль оси и отход от неё. */
    function project(pts, x, y) {
        var sp = spans(pts);
        var best = null;

        for (var i = 0; i < sp.parts.length; i++) {
            var part = sp.parts[i];
            var dx = part.b.x - part.a.x;
            var dy = part.b.y - part.a.y;
            var l2 = dx * dx + dy * dy;

            var t = l2 > EPS ? ((x - part.a.x) * dx + (y - part.a.y) * dy) / l2 : 0;
            if (t < 0) t = 0;
            if (t > 1) t = 1;

            var px = part.a.x + dx * t;
            var py = part.a.y + dy * t;
            var dist = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));

            if (!best || dist < best.dist) {
                best = { s: part.from + part.len * t, dist: dist, x: px, y: py };
            }
        }

        return best || { s: 0, dist: 0, x: x, y: y };
    }

    /* --- расстановка ------------------------------------------------------ */

    /**
     * Двери, сведённые к остановкам на оси.
     *
     * Две двери ближе наименьшего шага одним оросителем не обслужить, если
     * они разнесены больше чем на два допуска. Разнесены меньше — ставится
     * один посередине, и обе оказываются в пределах 0,5 м. Иначе остаются обе
     * остановки, а в замечаниях говорится, что шаг вышел меньше нормы:
     * выбрасывать дверь молча нельзя, это недоорошённый выход из квартиры.
     */
    function stopsOf(doors, pts, r, notes) {
        var ds = [];

        for (var i = 0; i < doors.length; i++) {
            var pr = project(pts, doors[i].x, doors[i].y);
            ds.push({ s: pr.s, dist: pr.dist, no: i + 1 });
        }

        ds.sort(function (a, b) { return a.s - b.s; });

        var stops = [];

        for (var k = 0; k < ds.length; k++) {
            var d = ds[k];
            var prev = stops.length ? stops[stops.length - 1] : null;

            if (prev && d.s - prev.s < r.minStep - EPS) {
                var lo = Math.min(prev.lo, d.s);
                var hi = Math.max(prev.hi, d.s);

                if (hi - lo <= 2 * r.doorReach + EPS) {
                    prev.lo = lo;
                    prev.hi = hi;
                    prev.s = (lo + hi) / 2;
                    prev.doors.push(d.no);

                    notes.push('Двери ' + prev.doors.join(', ') + ' стоят рядом: '
                        + 'их прикрывает один ороситель посередине, каждая в пределах '
                        + mm(r.doorReach) + ' мм.');
                    continue;
                }

                notes.push('Двери ' + prev.doors.join(', ') + ' и ' + d.no + ' разнесены на '
                    + mm(d.s - prev.s) + ' мм — это меньше наименьшего шага '
                    + mm(r.minStep) + ' мм, а одним оросителем их не прикрыть. '
                    + 'Оба оросителя поставлены, шаг между ними разведите вручную.');
            }

            stops.push({ s: d.s, lo: d.s, hi: d.s, doors: [d.no] });
        }

        return stops;
    }

    function mm(metres) {
        return String(Math.round(metres * 1000));
    }

    /**
     * Заполнители между двумя точками: поровну, шагом не больше наибольшего.
     *
     * Поровну, а не «максимальным шагом до упора»: равномерный ряд и выглядит
     * как чертёж, и считается гидравликой ровнее. Крайний кусок при шаге «до
     * упора» вышел бы огрызком в двадцать сантиметров.
     */
    function portions(gap, r) {
        var n = Math.ceil(gap / r.maxStep - EPS);
        if (n < 1) n = 1;

        while (n > 1 && gap / n < r.minStep - EPS) n--;
        return n;
    }

    /**
     * Оросители вдоль оси коридора.
     *
     * Возвращает точки в порядке от начала оси к её концу — к стояку, если
     * последняя точка ломаной поставлена на стояк.
     */
    function place(pts, doors, custom) {
        var r = merged(custom);
        var notes = [];
        var out = [];

        if (!pts || pts.length < 2) {
            notes.push('Ось коридора не задана: нужны хотя бы две точки.');
            return { spots: out, notes: notes, length: 0 };
        }

        var L = length(pts);
        var end = r.endReach > 0 ? r.endReach : r.maxStep / 2;

        function add(s, stop) {
            var p = at(pts, s);
            out.push({
                s: s,
                x: p.x,
                y: p.y,
                doors: stop ? stop.doors.slice() : []
            });
        }

        var stops = stopsOf(doors || [], pts, r, notes);

        // Дверей не отмечено — ряд равномерный по всей длине коридора.
        if (!stops.length) {
            var a = Math.min(end, L / 2);
            var b = Math.max(L - end, L / 2);

            if (b - a < EPS) {
                add(L / 2, null);
            } else {
                var k = portions(b - a, r);
                for (var j = 0; j <= k; j++) add(a + (b - a) / k * j, null);
            }

            notes.push('Квартирные двери не отмечены: ряд поставлен равномерно, '
                + 'шагом не больше ' + mm(r.maxStep) + ' мм. Отметьте двери — '
                + 'и оросители встанут напротив них.');

            return finish(out, r, L, notes);
        }

        // Перед первой дверью: довести ряд до торца коридора.
        var first = stops[0].s;
        if (first > end + EPS) {
            var kHead = portions(first - end, r);
            var stepHead = (first - end) / kHead;

            /*
                Ороситель, который встал бы ближе наименьшего шага, не ставится
                вовсе: труба с двумя розетками в полуметре друг от друга — это
                не «добрали торец», это ошибка. Торец останется недобранным, и
                об этом будет сказано числом в замечаниях.
            */
            if (stepHead >= r.minStep - EPS) {
                for (var h = 0; h < kHead; h++) add(end + stepHead * h, null);
            }
        }

        for (var m = 0; m < stops.length; m++) {
            if (m > 0) {
                var from = stops[m - 1].s;
                var gap = stops[m].s - from;

                if (gap > r.maxStep + EPS) {
                    var kMid = portions(gap, r);
                    var stepMid = gap / kMid;
                    for (var i2 = 1; i2 < kMid; i2++) add(from + stepMid * i2, null);
                }
            }

            add(stops[m].s, stops[m]);
        }

        // После последней двери: тем же порядком до другого торца.
        var last = stops[stops.length - 1].s;
        if (L - last > end + EPS) {
            var kTail = portions(L - end - last, r);
            var stepTail = (L - end - last) / kTail;

            if (stepTail >= r.minStep - EPS) {
                for (var t2 = 1; t2 <= kTail; t2++) add(last + stepTail * t2, null);
            }
        }

        return finish(out, r, L, notes);
    }

    /** Проверка получившегося ряда: шаги и торцы. */
    function finish(spots, r, L, notes) {
        var end = r.endReach > 0 ? r.endReach : r.maxStep / 2;

        for (var i = 1; i < spots.length; i++) {
            var step = spots[i].s - spots[i - 1].s;

            if (step < r.minStep - 1e-6) {
                notes.push('Шаг между оросителями ' + i + ' и ' + (i + 1) + ' вышел '
                    + mm(step) + ' мм — меньше наименьшего ' + mm(r.minStep) + ' мм.');
            }

            if (step > r.maxStep + 1e-6) {
                notes.push('Шаг между оросителями ' + i + ' и ' + (i + 1) + ' вышел '
                    + mm(step) + ' мм — больше наибольшего ' + mm(r.maxStep) + ' мм.');
            }
        }

        if (spots.length) {
            if (spots[0].s > end + 1e-6) {
                notes.push('От начала коридора до первого оросителя '
                    + mm(spots[0].s) + ' мм — дальше ' + mm(end) + ' мм.');
            }

            var tail = L - spots[spots.length - 1].s;
            if (tail > end + 1e-6) {
                notes.push('От последнего оросителя до конца коридора '
                    + mm(tail) + ' мм — дальше ' + mm(end) + ' мм.');
            }
        }

        return { spots: spots, notes: notes, length: L };
    }

    /* --- диаметры --------------------------------------------------------- */

    /**
     * Таблица «оросителей : Ду» из строки вида «3:25|6:32|12:40».
     *
     * Читается как «до скольких оросителей держится диаметр»: до трёх — Ду 25,
     * до шести — Ду 32 и так далее. Строка, а не набор полей: диаметры по
     * числу оросителей проектировщик держит в голове одной строкой, и править
     * её быстрее, чем десяток ячеек.
     */
    function table(text) {
        var rows = [];
        if (!text) return rows;

        String(text).split('|').forEach(function (chunk) {
            var pair = chunk.split(':');
            if (pair.length !== 2) return;

            var count = parseInt(pair[0], 10);
            var dn = parseFloat(String(pair[1]).replace(',', '.'));

            if (count > 0 && dn > 0) rows.push({ count: count, dn: dn });
        });

        rows.sort(function (a, b) { return a.count - b.count; });
        return rows;
    }

    /** Ду для участка, питающего заданное число оросителей. */
    function pick(rows, count) {
        if (!rows || !rows.length) return 0;

        for (var i = 0; i < rows.length; i++) {
            if (count <= rows[i].count) return rows[i].dn;
        }

        return rows[rows.length - 1].dn;
    }

    /* --- сборка на плане --------------------------------------------------- */

    /**
     * Узлы трубы: оросители и повороты оси, в порядке от начала к стояку.
     *
     * Повороты нужны наравне с оросителями: без них труба срезала бы угол
     * коридора и пошла сквозь стену.
     */
    function chain(pts, spots) {
        var sp = spans(pts);
        var list = [];

        spots.forEach(function (spot) {
            list.push({ s: spot.s, x: spot.x, y: spot.y, spr: true, doors: spot.doors });
        });

        // Начало оси в трубу не входит: труба начинается с первого оросителя,
        // тянуть её в глухой торец коридора незачем. Конец входит всегда —
        // это врезка в стояк.
        var head = spots.length ? spots[0].s : 0;

        var walked = 0;
        for (var i = 0; i + 1 < sp.parts.length; i++) {
            walked += sp.parts[i].len;
            if (walked < head - 1e-6) continue;

            var corner = sp.parts[i].b;
            list.push({ s: walked, x: corner.x, y: corner.y, spr: false, doors: [] });
        }

        var tail = pts[pts.length - 1];
        list.push({ s: sp.length, x: tail.x, y: tail.y, spr: false, doors: [] });

        list.sort(function (a, b) { return a.s - b.s; });

        // Поворот, совпавший с оросителем, отдельным узлом не нужен.
        var out = [];
        list.forEach(function (item) {
            var prev = out.length ? out[out.length - 1] : null;
            if (prev && Math.abs(prev.s - item.s) < 1e-6) {
                prev.spr = prev.spr || item.spr;
                if (item.doors.length) prev.doors = prev.doors.concat(item.doors);
                return;
            }
            out.push(item);
        });

        return out;
    }

    /**
     * Построить коридор на плане: оросители, труба, врезка в стояк.
     *
     * Диаметр участка — по числу оросителей, которые через него идут, считая
     * от дальнего конца к стояку. Задан один диаметр — он ставится всем
     * участкам: так бывает на коротком коридоре, где делить нечего.
     */
    function build(project_, pts, doors, custom, opts) {
        var r = merged(custom);
        var o = opts || {};
        var result = place(pts, doors, r);

        if (!result.spots.length) {
            result.added = { nodes: 0, segments: 0 };
            return result;
        }

        var rows = o.dn > 0 ? [] : table(r.diameters);
        var material = o.material || project_.settings.pipeRay.material;
        var sizes = Catalog.sizes(material);

        function pipeOf(count) {
            var dn = o.dn > 0 ? o.dn : pick(rows, count);
            var row = null;

            for (var i = 0; i < sizes.length; i++) {
                if (Math.abs(sizes[i].dn - dn) < 0.5) { row = sizes[i]; break; }
            }

            if (!row) row = sizes.length ? sizes[0] : null;
            return row
                ? { material: material, od: row.od, wall: row.wall }
                : { material: material };
        }

        var items = chain(pts, result.spots);
        var ids = [];
        var nodes = 0;

        items.forEach(function (item) {
            var node = Model.addNode(project_, item.x, item.y, { spr: item.spr });
            ids.push(node.id);
            nodes++;
        });

        /*
            Стояк — в конце оси. Если на плане ввода ещё нет, последний узел и
            становится вводом: на плане этажа «Ввод» и есть врезка в стояк.
            Ввод уже есть — коридор к нему прицепляется отдельным участком,
            второй ввод на плане был бы ошибкой расчёта.
        */
        var src = Model.source(project_);
        var tailId = ids[ids.length - 1];

        if (!src) {
            var tail = Model.node(project_, tailId);
            tail.spr = false;
            tail.src = true;
        }

        var segments = 0;
        var total = result.spots.length;

        /*
            Вода идёт от стояка к дальнему торцу, значит счёт оросителей
            накапливается в обратную сторону: участок несёт всех, кто остался
            за ним в сторону торца. Первый участок — один ороситель, последний,
            у стояка, — все.
        */
        var fed = 0;

        for (var i = 0; i + 1 < ids.length; i++) {
            var node = Model.node(project_, ids[i]);
            if (node.spr) fed++;

            var seg = Model.addSegment(project_, ids[i], ids[i + 1], { role: 'ray' });
            if (!seg) continue;

            var props = pipeOf(fed);
            seg.material = props.material;
            if (props.od) { seg.od = props.od; seg.wall = props.wall; }

            segments++;
        }

        if (src && src.id !== tailId) {
            var link = Model.addSegment(project_, tailId, src.id, { role: 'ray' });
            if (link) {
                var lp = pipeOf(total);
                link.material = lp.material;
                if (lp.od) { link.od = lp.od; link.wall = lp.wall; }
                segments++;
            }
        }

        result.added = { nodes: nodes, segments: segments };
        return result;
    }

    return {
        rules: rules,
        length: length,
        at: at,
        project: project,
        place: place,
        table: table,
        pick: pick,
        chain: chain,
        build: build
    };
})();
