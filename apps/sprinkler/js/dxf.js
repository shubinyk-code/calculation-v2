'use strict';

/*
    Чтение чертежа DXF — подложка плана из AutoCAD.

    Берётся пространство модели: раздел ENTITIES целиком (объекты листа в нём
    помечены кодом 67 = 1 и пропускаются) и блоки, на которые ссылаются вставки.
    Листы (*Paper_Space) не читаются вовсе: в них рамки и штампы, а план лежит
    в модели.

    Что понимает: LINE, LWPOLYLINE, POLYLINE с дугами по выпуклости, CIRCLE,
    ARC, ELLIPSE, SOLID, 3DFACE, TEXT и MTEXT, вставки INSERT с блоками (со
    сдвигом, поворотом, масштабом и рядами) и размеры DIMENSION — у них
    геометрия лежит в своём блоке в мировых координатах. Штриховки, растры и
    трёхмерные тела пропускаются и попадают в сводку пропущенного.

    Двоичный DXF и .dwg не читаются: из AutoCAD нужен «Сохранить как → DXF».

    Координаты наружу отдаются в единицах чертежа, ось Y вверх — как в
    AutoCAD. Перевод в метры и переворот оси — в place(): программа считает
    Y вниз, как на экране.
*/

var Dxf = (function () {

    var MAX_NUMBERS = 2000000;      // ограничение на размер геометрии
    var MAX_ARRAY = 400;            // копий у одной вставки с рядами
    var MAX_DEPTH = 6;              // вложенность блоков

    /* Единицы чертежа: $INSUNITS и то, сколько в единице метров. */
    var UNITS = [
        { code: 4, name: 'мм', factor: 0.001 },
        { code: 5, name: 'см', factor: 0.01 },
        { code: 6, name: 'м', factor: 1 },
        { code: 1, name: 'дюймы', factor: 0.0254 },
        { code: 2, name: 'футы', factor: 0.3048 },
        { code: 7, name: 'км', factor: 1000 }
    ];

    function unitOf(code) {
        for (var i = 0; i < UNITS.length; i++) {
            if (UNITS[i].code === code) return UNITS[i];
        }
        return null;
    }

    /* --- разбор пар «код — значение» ---------------------------------------- */

    function reader(text) {
        var lines = text.split(/\r\n|\r|\n/);
        var i = 0;
        var back = null;

        function next() {
            if (back) {
                var b = back;
                back = null;
                return b;
            }
            while (i + 1 < lines.length) {
                var code = parseInt(lines[i], 10);
                if (isNaN(code)) {
                    // Рассинхрон (пустая строка в начале файла) — сдвигаемся на строку.
                    i++;
                    continue;
                }
                var value = lines[i + 1];
                i += 2;
                return { c: code, v: value };
            }
            return null;
        }

        return {
            next: next,
            unread: function (pair) { back = pair; }
        };
    }

    /** Пары одного объекта: всё до следующего кода 0. */
    function entityPairs(rd) {
        var out = [];
        var pair;
        while ((pair = rd.next())) {
            if (pair.c === 0) {
                rd.unread(pair);
                break;
            }
            out.push(pair);
        }
        return out;
    }

    function first(pairs, code, dflt) {
        for (var i = 0; i < pairs.length; i++) {
            if (pairs[i].c === code) return pairs[i].v;
        }
        return dflt;
    }

    function num(pairs, code, dflt) {
        var v = first(pairs, code, null);
        if (v === null) return dflt;
        var n = parseFloat(v);
        return isNaN(n) ? dflt : n;
    }

    /* --- геометрия ---------------------------------------------------------- */

    function rad(deg) { return deg * Math.PI / 180; }

    /**
     * Дуга по выпуклости (bulge) между двумя вершинами полилинии: точки
     * добавляются в out, начальная вершина там уже есть.
     */
    function bulgeTo(out, x1, y1, x2, y2, b) {
        var d = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
        if (!b || d < 1e-12) {
            out.push(x2, y2);
            return;
        }

        var th = 4 * Math.atan(b);               // угол дуги, против часовой — плюс
        var r = d / 2 / Math.sin(th / 2);        // знак радиуса — как у угла
        var ux = (x2 - x1) / d, uy = (y2 - y1) / d;
        var cx = (x1 + x2) / 2 - uy * r * Math.cos(th / 2);
        var cy = (y1 + y2) / 2 + ux * r * Math.cos(th / 2);
        var a0 = Math.atan2(y1 - cy, x1 - cx);
        var n = Math.max(2, Math.min(96, Math.ceil(Math.abs(th) / 0.15)));

        for (var i = 1; i <= n; i++) {
            var a = a0 + th * i / n;
            out.push(cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a));
        }
    }

    /** Дуга точками — когда вставка зеркалит или тянет по осям по-разному. */
    function arcPoints(e) {
        var out = [];
        var sweep = e.a1 - e.a0;
        while (sweep <= 0) sweep += Math.PI * 2;
        var n = Math.max(4, Math.min(180, Math.ceil(sweep / 0.12)));
        for (var i = 0; i <= n; i++) {
            var a = e.a0 + sweep * i / n;
            out.push(e.x + e.r * Math.cos(a), e.y + e.r * Math.sin(a));
        }
        return { t: 'p', v: out };
    }

    /* --- объекты ------------------------------------------------------------ */

    function lwpolyline(pairs) {
        var pts = [];
        var bulges = [];
        var closed = (num(pairs, 70, 0) & 1) === 1;
        var x = null;

        pairs.forEach(function (p) {
            if (p.c === 10) {
                x = parseFloat(p.v);
            } else if (p.c === 20 && x !== null) {
                pts.push(x, parseFloat(p.v));
                bulges.push(0);
                x = null;
            } else if (p.c === 42 && bulges.length) {
                bulges[bulges.length - 1] = parseFloat(p.v);
            }
        });

        return build(pts, bulges, closed);
    }

    function build(pts, bulges, closed) {
        if (pts.length < 4) return null;

        var out = [pts[0], pts[1]];
        var last = pts.length / 2 - 1;

        for (var i = 0; i < last; i++) {
            bulgeTo(out, pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], bulges[i]);
        }
        if (closed) bulgeTo(out, pts[last * 2], pts[last * 2 + 1], pts[0], pts[1], bulges[last]);

        return { t: 'p', v: out };
    }

    function ellipse(pairs) {
        var cx = num(pairs, 10, 0), cy = num(pairs, 20, 0);
        var mx = num(pairs, 11, 0), my = num(pairs, 21, 0);
        var ratio = num(pairs, 40, 1);
        var a0 = num(pairs, 41, 0), a1 = num(pairs, 42, Math.PI * 2);
        var major = Math.sqrt(mx * mx + my * my);
        if (major < 1e-12) return null;

        var rot = Math.atan2(my, mx);
        var sweep = a1 - a0;
        while (sweep <= 0) sweep += Math.PI * 2;
        var n = Math.max(8, Math.min(180, Math.ceil(sweep / 0.12)));
        var out = [];

        for (var i = 0; i <= n; i++) {
            var t = a0 + sweep * i / n;
            var ex = major * Math.cos(t), ey = major * ratio * Math.sin(t);
            out.push(cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot));
        }
        return { t: 'p', v: out };
    }

    /** Текст MTEXT приходит с кодами оформления — оставляем сами буквы. */
    function plainText(raw) {
        return String(raw || '')
            .replace(/\\P/g, ' ')
            .replace(/\\[A-Za-z]+[^;\\]*;/g, '')
            .replace(/[{}]/g, '')
            .replace(/%%[cC]/g, '⌀')
            .replace(/%%[dD]/g, '°')
            .replace(/%%[pP]/g, '±')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function textEntity(pairs, mtext) {
        // Длинный MTEXT приходит кусками: сначала код 3, хвост — кодом 1.
        var raw = '';
        pairs.forEach(function (p) {
            if (p.c === 3) raw += p.v;
        });
        raw += first(pairs, 1, '');

        var s = plainText(raw);
        if (!s) return null;
        return {
            t: 't',
            x: num(pairs, 10, 0),
            y: num(pairs, 20, 0),
            h: num(pairs, 40, 2.5),
            rot: rad(num(pairs, 50, 0)),
            s: s,
            m: !!mtext
        };
    }

    function solid(pairs) {
        var pts = [];
        [[10, 20], [11, 21], [13, 23], [12, 22]].forEach(function (c) {
            var x = num(pairs, c[0], null), y = num(pairs, c[1], null);
            if (x !== null && y !== null) pts.push(x, y);
        });
        if (pts.length < 6) return null;
        pts.push(pts[0], pts[1]);
        return { t: 'p', v: pts };
    }

    /* --- преобразование вставки --------------------------------------------- */

    function transform(ents, tr, out, state) {
        var cos = Math.cos(tr.rot), sin = Math.sin(tr.rot);
        var mirror = tr.sx * tr.sy < 0;
        var even = Math.abs(Math.abs(tr.sx) - Math.abs(tr.sy)) < 1e-9;

        function px(x, y) { return tr.x + (x * tr.sx) * cos - (y * tr.sy) * sin; }
        function py(x, y) { return tr.y + (x * tr.sx) * sin + (y * tr.sy) * cos; }

        ents.forEach(function (e) {
            if (state.numbers > MAX_NUMBERS) { state.cut = true; return; }

            if (e.t === 'a' && (!even || mirror)) e = arcPoints(e);

            if (e.t === 'p') {
                var v = new Array(e.v.length);
                for (var i = 0; i < e.v.length; i += 2) {
                    v[i] = px(e.v[i], e.v[i + 1]);
                    v[i + 1] = py(e.v[i], e.v[i + 1]);
                }
                state.numbers += v.length;
                out.push({ t: 'p', v: v });
            } else if (e.t === 'a') {
                state.numbers += 5;
                out.push({
                    t: 'a',
                    x: px(e.x, e.y), y: py(e.x, e.y),
                    r: e.r * Math.abs(tr.sx),
                    a0: e.a0 + tr.rot, a1: e.a1 + tr.rot
                });
            } else if (e.t === 't') {
                state.numbers += 4;
                out.push({
                    t: 't',
                    x: px(e.x, e.y), y: py(e.x, e.y),
                    h: e.h * Math.abs(tr.sy),
                    rot: e.rot + tr.rot,
                    s: e.s, m: e.m
                });
            } else if (e.t === 'i') {
                // Вставка внутри блока: складываем преобразования.
                out.push({
                    t: 'i',
                    name: e.name,
                    x: px(e.x, e.y), y: py(e.x, e.y),
                    sx: e.sx * tr.sx, sy: e.sy * tr.sy,
                    rot: e.rot + tr.rot,
                    cols: e.cols, rows: e.rows, dx: e.dx * tr.sx, dy: e.dy * tr.sy
                });
            }
        });
    }

    /** Разворачивает вставки в готовую геометрию. */
    function expand(ents, blocks, state, depth) {
        var out = [];

        ents.forEach(function (e) {
            if (state.numbers > MAX_NUMBERS) { state.cut = true; return; }

            if (e.t !== 'i') {
                if (e.t === 'p') state.numbers += e.v.length;
                out.push(e);
                return;
            }

            var block = blocks[String(e.name || '').toUpperCase()];
            if (!block || depth >= MAX_DEPTH) {
                state.skipped['вставка ' + (e.name || '?')] = (state.skipped['вставка ' + (e.name || '?')] || 0) + 1;
                return;
            }

            var inner = expand(block.ents, blocks, state, depth + 1);
            var cols = Math.max(1, Math.min(MAX_ARRAY, e.cols || 1));
            var rows = Math.max(1, Math.min(MAX_ARRAY, e.rows || 1));

            for (var c = 0; c < cols && c * rows < MAX_ARRAY; c++) {
                for (var r = 0; r < rows; r++) {
                    var cos = Math.cos(e.rot), sin = Math.sin(e.rot);
                    var ox = c * (e.dx || 0), oy = r * (e.dy || 0);
                    transform(inner, {
                        x: e.x + ox * cos - oy * sin,
                        y: e.y + ox * sin + oy * cos,
                        sx: e.sx, sy: e.sy, rot: e.rot,
                        bx: block.bx, by: block.by
                    }, out, state);
                }
            }
        });

        return out;
    }

    /* --- чтение файла -------------------------------------------------------- */

    /*
        Сплайн точно по NURBS не строим: ведём ломаную по точкам подгонки, а
        если их нет — по определяющим точкам. Для подложки плана этого хватает.
    */
    function spline(pairs) {
        var fit = [];
        var ctrl = [];
        var x = null, cx = null;

        pairs.forEach(function (p) {
            if (p.c === 11) x = parseFloat(p.v);
            else if (p.c === 21 && x !== null) { fit.push(x, parseFloat(p.v)); x = null; }
            else if (p.c === 10) cx = parseFloat(p.v);
            else if (p.c === 20 && cx !== null) { ctrl.push(cx, parseFloat(p.v)); cx = null; }
        });

        var pts = fit.length >= 4 ? fit : ctrl;
        if (pts.length < 4) return null;
        return { t: 'p', v: pts };
    }

    function parse(text) {
        if (/^\s*AutoCAD Binary DXF/.test(text.slice(0, 40))) {
            return { ok: false, error: 'Это двоичный DXF. Сохраните из AutoCAD как «DXF ASCII».' };
        }
        if (text.indexOf('SECTION') < 0) {
            return { ok: false, error: 'Файл не похож на DXF: нет разделов. Из AutoCAD — «Сохранить как → DXF».' };
        }

        var rd = reader(text);
        var state = { numbers: 0, skipped: {}, cut: false };
        var blocks = {};
        var model = [];
        var insunits = 0;
        var section = '';
        var block = null;
        var polyline = null;
        var pair;

        function target() {
            return block ? block.ents : model;
        }

        function put(e, paper) {
            if (!e) return;
            if (paper && !block) return;
            target().push(e);
        }

        while ((pair = rd.next())) {
            if (pair.c === 9 && pair.v.trim() === '$INSUNITS') {
                var next = rd.next();
                if (next && next.c === 70) insunits = parseInt(next.v, 10) || 0;
                continue;
            }

            if (pair.c !== 0) continue;

            var type = pair.v.trim().toUpperCase();

            if (type === 'SECTION') {
                var name = rd.next();
                section = name && name.c === 2 ? name.v.trim().toUpperCase() : '';
                continue;
            }
            if (type === 'ENDSEC') { section = ''; continue; }
            if (section !== 'ENTITIES' && section !== 'BLOCKS') continue;

            if (type === 'BLOCK') {
                var bp = entityPairs(rd);
                var bname = String(first(bp, 2, '')).trim();
                block = {
                    name: bname,
                    paper: /^\*paper_space/i.test(bname),
                    bx: num(bp, 10, 0), by: num(bp, 20, 0),
                    ents: []
                };
                continue;
            }
            if (type === 'ENDBLK') {
                if (block && !block.paper) blocks[block.name.toUpperCase()] = block;
                block = null;
                continue;
            }

            if (type === 'SEQEND') {
                if (polyline) {
                    put(build(polyline.pts, polyline.bulges, polyline.closed));
                    polyline = null;
                }
                continue;
            }

            if (type === 'VERTEX') {
                var vp = entityPairs(rd);
                if (polyline) {
                    polyline.pts.push(num(vp, 10, 0), num(vp, 20, 0));
                    polyline.bulges.push(num(vp, 42, 0));
                }
                continue;
            }

            var pairs = entityPairs(rd);
            var paper = num(pairs, 67, 0) === 1;

            if (polyline && type !== 'VERTEX') {
                put(build(polyline.pts, polyline.bulges, polyline.closed));
                polyline = null;
            }

            switch (type) {
                case 'LINE':
                    put({ t: 'p', v: [num(pairs, 10, 0), num(pairs, 20, 0), num(pairs, 11, 0), num(pairs, 21, 0)] }, paper);
                    break;
                case 'LWPOLYLINE':
                    put(lwpolyline(pairs), paper);
                    break;
                case 'POLYLINE':
                    polyline = paper ? null : { pts: [], bulges: [], closed: (num(pairs, 70, 0) & 1) === 1 };
                    break;
                case 'CIRCLE':
                    put({ t: 'a', x: num(pairs, 10, 0), y: num(pairs, 20, 0), r: num(pairs, 40, 0), a0: 0, a1: Math.PI * 2 }, paper);
                    break;
                case 'ARC':
                    put({
                        t: 'a', x: num(pairs, 10, 0), y: num(pairs, 20, 0), r: num(pairs, 40, 0),
                        a0: rad(num(pairs, 50, 0)), a1: rad(num(pairs, 51, 0))
                    }, paper);
                    break;
                case 'ELLIPSE':
                    put(ellipse(pairs), paper);
                    break;
                case 'SPLINE':
                    put(spline(pairs), paper);
                    break;
                case 'SOLID':
                case '3DFACE':
                    put(solid(pairs), paper);
                    break;
                case 'TEXT':
                case 'MTEXT':
                    put(textEntity(pairs, type === 'MTEXT'), paper);
                    break;
                case 'ATTRIB':
                    // Значение атрибута вставки — это видимая надпись чертежа.
                    put(textEntity(pairs, false), paper);
                    break;
                case 'INSERT':
                    put({
                        t: 'i',
                        name: String(first(pairs, 2, '')).trim(),
                        x: num(pairs, 10, 0), y: num(pairs, 20, 0),
                        sx: num(pairs, 41, 1) || 1, sy: num(pairs, 42, 1) || 1,
                        rot: rad(num(pairs, 50, 0)),
                        cols: num(pairs, 70, 1), rows: num(pairs, 71, 1),
                        dx: num(pairs, 44, 0), dy: num(pairs, 45, 0)
                    }, paper);
                    break;
                case 'DIMENSION':
                    // Геометрия размера лежит в своём блоке в мировых координатах.
                    put({
                        t: 'i', name: String(first(pairs, 2, '')).trim(),
                        x: 0, y: 0, sx: 1, sy: 1, rot: 0, cols: 1, rows: 1, dx: 0, dy: 0
                    }, paper);
                    break;
                default:
                    // Остальное (штриховки, растры, тела) — в сводку пропущенного.
                    state.skipped[type] = (state.skipped[type] || 0) + 1;
            }
        }

        if (polyline) put(build(polyline.pts, polyline.bulges, polyline.closed));

        // Блоки вставок разворачиваем в точки, базовую точку блока учитываем сдвигом.
        Object.keys(blocks).forEach(function (key) {
            var b = blocks[key];
            if (!b.bx && !b.by) return;
            b.ents = shift(b.ents, -b.bx, -b.by);
        });

        var ents = expand(model, blocks, state, 0);
        var unit = unitOf(insunits);

        return {
            ok: true,
            ents: ents,
            bounds: bounds(ents),
            insunits: insunits,
            unit: unit,
            skipped: state.skipped,
            cut: state.cut,
            count: ents.length
        };
    }

    function shift(ents, dx, dy) {
        return ents.map(function (e) {
            if (e.t === 'p') {
                var v = e.v.slice();
                for (var i = 0; i < v.length; i += 2) { v[i] += dx; v[i + 1] += dy; }
                return { t: 'p', v: v };
            }
            var c = {};
            Object.keys(e).forEach(function (k) { c[k] = e[k]; });
            c.x += dx;
            c.y += dy;
            return c;
        });
    }

    function bounds(ents) {
        var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

        function add(x, y) {
            if (!isFinite(x) || !isFinite(y)) return;
            b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y);
            b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y);
        }

        ents.forEach(function (e) {
            if (e.t === 'p') {
                for (var i = 0; i < e.v.length; i += 2) add(e.v[i], e.v[i + 1]);
            } else if (e.t === 'a') {
                add(e.x - e.r, e.y - e.r);
                add(e.x + e.r, e.y + e.r);
            } else if (e.t === 't') {
                add(e.x, e.y);
            }
        });

        if (!isFinite(b.x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
        return b;
    }

    /* --- в метры ------------------------------------------------------------ */

    function round(v) { return Math.round(v * 1000) / 1000; }

    /**
     * Чертёж в мир программы: множитель — метров в единице чертежа, ось Y
     * переворачивается (в AutoCAD вверх, на экране вниз), начало координат
     * переносится в левый верхний угол чертежа.
     */
    function place(parsed, factor) {
        var f = Number(factor) || 1;
        var b = parsed.bounds;
        var ox = b.x0 * f, oy = -b.y1 * f;
        var ents = [];

        parsed.ents.forEach(function (e) {
            if (e.t === 'p') {
                var v = new Array(e.v.length);
                for (var i = 0; i < e.v.length; i += 2) {
                    v[i] = round(e.v[i] * f - ox);
                    v[i + 1] = round(-e.v[i + 1] * f - oy);
                }
                ents.push({ t: 'p', v: v });
            } else if (e.t === 'a') {
                ents.push({
                    t: 'a',
                    x: round(e.x * f - ox), y: round(-e.y * f - oy),
                    r: round(e.r * f),
                    a0: round(-e.a0), a1: round(-e.a1)
                });
            } else if (e.t === 't') {
                ents.push({
                    t: 't',
                    x: round(e.x * f - ox), y: round(-e.y * f - oy),
                    h: round(e.h * f), rot: round(-e.rot), s: e.s
                });
            }
        });

        return {
            ents: ents,
            w: round((b.x1 - b.x0) * f),
            h: round((b.y1 - b.y0) * f)
        };
    }

    /** Сводка пропущенного — словами, для строки состояния. */
    function skippedText(parsed) {
        var keys = Object.keys(parsed.skipped || {});
        if (!keys.length) return '';
        return keys.slice(0, 4).map(function (k) { return k + ' — ' + parsed.skipped[k]; }).join(', ')
            + (keys.length > 4 ? ' и другое' : '');
    }

    return {
        UNITS: UNITS,
        unitOf: unitOf,
        parse: parse,
        place: place,
        bounds: bounds,
        plainText: plainText,
        skippedText: skippedText
    };
})();
