/*
    Выгрузка схемы-чертежа в PDF (те же примитивы, что уходят в DXF — HydDxf.makeDoc).

    PDF векторный: линии, стрелки, блоки — настоящие контуры, текст — встроенный
    шрифт (см. pdf-vector.js). Увеличивайте сколько нужно — ничего не «мылится».
    Лист большой: масштаб подбирается из ряда 1:50 … 1:2000 — наименьший, при котором
    схема умещается на листе не больше 2400 × 1700 мм (A0 — 1189 × 841), поэтому
    высота букв на бумаге остаётся читаемой: 4,5 мм при 1:100, 2,25 мм при 1:200.
    Размер страницы равен размеру чертежа в этом масштабе плюс поля, как у плоттера.
*/

var HydPdf = (function () {
    'use strict';

    var SCALES = [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];
    var MAX_LONG = 2400;     // мм
    var MAX_SHORT = 1700;
    var MARGIN = 20;         // мм
    var FONT = 'ISOCPEUR, "Arial Narrow", Arial, sans-serif';

    var COLORS = { 1: '#e00000', 3: '#00902a', 4: '#009a9a', 5: '#1030d0', 7: '#101010', 8: '#8a8a8a', 30: '#f07800' };

    function colorOf(layer) { return COLORS[HydDxf.layerColor(layer)] || '#101010'; }

    /* Список примитивов → векторные операции страницы. Единицы — мм модели, ось y вверх. */
    function drawOps(pg, doc, ops, N, layerOverride) {
        var minLine = N * 0.2;                // не тоньше 0,2 мм на бумаге

        ops.forEach(function (o) {
            var color = colorOf(layerOverride || o.layer);

            if (o.t === 'line') {
                pg.strokeColor(color).lineWidth(Math.max(25, minLine));
                pg.moveTo(o.x1, o.y1).lineTo(o.x2, o.y2).stroke();
            } else if (o.t === 'poly') {
                pg.strokeColor(color).lineWidth(Math.max(o.w || 25, minLine));
                o.pts.forEach(function (p, i) { if (i) pg.lineTo(p[0], p[1]); else pg.moveTo(p[0], p[1]); });
                pg.stroke();
            } else if (o.t === 'circle') {
                pg.strokeColor(color).lineWidth(Math.max(25, minLine));
                pg.circle(o.cx, o.cy, o.r).stroke();
            } else if (o.t === 'solid') {
                pg.fillColor(color);
                pg.moveTo(o.p[0][0], o.p[0][1]).lineTo(o.p[1][0], o.p[1][1]).lineTo(o.p[2][0], o.p[2][1]).close().fill();
            } else if (o.t === 'text') {
                var size = o.h / 0.7;                          // как раньше: кегль = высота / 0,7
                var width = pg.textWidth(o.s, size, FONT, false);
                var dx = o.align === 'c' ? -width / 2 : (o.align === 'r' ? -width : 0);
                var dy = -size * 0.35;                         // базовая линия ниже середины строки
                var r = (o.rot || 0) * Math.PI / 180;
                var c = Math.cos(r);
                var s = Math.sin(r);
                pg.text(o.s, [c, s, -s, c, o.x + dx * c - dy * s, o.y + dx * s + dy * c], size, color, FONT, false);
            } else if (o.t === 'insert') {
                var block = doc.blockOps[o.name];
                if (!block) return;
                var rr = (o.rot || 0) * Math.PI / 180;
                var cc = Math.cos(rr);
                var ss = Math.sin(rr);
                pg.save();
                pg.cm(o.sx * cc, o.sx * ss, -o.sy * ss, o.sy * cc, o.x, o.y);
                drawOps(pg, doc, block, N, o.layer);
                pg.restore();
            }
        });
    }

    /* Границы чертежа по примитивам. */
    function extents(doc) {
        var min = [1e18, 1e18];
        var max = [-1e18, -1e18];

        function add(x, y) {
            if (x < min[0]) min[0] = x;
            if (y < min[1]) min[1] = y;
            if (x > max[0]) max[0] = x;
            if (y > max[1]) max[1] = y;
        }

        doc.ops.forEach(function (o) {
            if (o.t === 'line') { add(o.x1, o.y1); add(o.x2, o.y2); }
            else if (o.t === 'poly') o.pts.forEach(function (p) { add(p[0], p[1]); });
            else if (o.t === 'circle') { add(o.cx - o.r, o.cy - o.r); add(o.cx + o.r, o.cy + o.r); }
            else if (o.t === 'solid') o.p.forEach(function (p) { add(p[0], p[1]); });
            else if (o.t === 'text') { add(o.x, o.y - o.h); add(o.x + (o.align === 'l' ? o.s.length * o.h * 0.55 : (o.align === 'c' ? o.s.length * o.h * 0.28 : 0)), o.y + o.h); if (o.align === 'c') add(o.x - o.s.length * o.h * 0.28, o.y); if (o.align === 'r') add(o.x - o.s.length * o.h * 0.55, o.y); }
            else if (o.t === 'insert') { add(o.x - 500, o.y - 500); add(o.x + 500, o.y + 500); }
        });

        return { min: min, max: max };
    }

    /* Страница чертежа в масштабе 1:N на листе минимального подходящего размера. */
    function addPage(pdf, doc) {
        var e = extents(doc);
        var w = e.max[0] - e.min[0];
        var h = e.max[1] - e.min[1];
        var N = SCALES[SCALES.length - 1];

        for (var i = 0; i < SCALES.length; i++) {
            var pw = w / SCALES[i] + 2 * MARGIN;
            var ph = h / SCALES[i] + 2 * MARGIN;
            if (Math.max(pw, ph) <= MAX_LONG && Math.min(pw, ph) <= MAX_SHORT) { N = SCALES[i]; break; }
        }

        var pageW = Math.max(297, Math.ceil(w / N + 2 * MARGIN));
        var pageH = Math.max(210, Math.ceil(h / N + 2 * MARGIN));
        var pg = pdf.page(pageW, pageH);

        pg.save();
        pg.cm(1 / N, 0, 0, 1 / N, MARGIN - e.min[0] / N, MARGIN - e.min[1] / N);     // мм модели → мм бумаги
        pg.cap(1).join(1);
        drawOps(pg, doc, doc.ops, N, null);
        pg.restore();

        // рамка листа и масштаб
        pg.strokeColor('#101010').lineWidth(0.5).rect(5, 5, pageW - 10, pageH - 10).stroke();
        var label = 'М 1:' + N;
        var size = 3.5;
        pg.text(label, [1, 0, 0, 1, pageW - 8 - pg.textWidth(label, size, 'Arial, sans-serif', false), 8], size, '#101010', 'Arial, sans-serif', false);
        return { w: pageW, h: pageH, scale: N };
    }

    /* Страницы ХВС и ГВС → Promise<байты PDF>. */
    function build(result, hyd, opts) {
        var pdf = PdfVec.create((hyd.survey.objectName || 'Схема ВК') + ' — схемы В1 и Т3');
        var any = false;

        ['c', 'h'].forEach(function (net) {
            var has = hyd.canvas.nodes.some(function (n) { return HydGraph.onSheet(n, net); });
            if (!has) return;
            var doc = HydDxf.makeDoc(result, hyd, opts, [net]);
            if (doc.ops.length) { addPage(pdf, doc); any = true; }
        });

        if (!any) return Promise.reject(new Error('на схеме нечего выгружать'));
        return pdf.bytes();
    }

    function fileName(hyd, kind) {
        var d = new Date();
        var two = function (v) { return (v < 10 ? '0' : '') + v; };
        var base = (hyd.survey.objectName || 'Схема ВК').replace(/[\\/:*?"<>|]/g, '-');
        return base + ' — ' + (kind || 'схема В1-Т3') + ' — ' + two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() + '.pdf';
    }

    function save(result, hyd, opts) {
        return build(result, hyd, opts).then(function (bytes) {
            Zip.save(bytes, fileName(hyd), 'application/pdf');
        });
    }

    return { build: build, save: save, fileName: fileName };
})();
