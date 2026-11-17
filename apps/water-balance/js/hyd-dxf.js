/*
    Выгрузка схемы в AutoCAD (DXF).

    Формат — R12 (AC1009): открывается всем, от AutoCAD до nanoCAD. Кириллица —
    байтами CP1251 с $DWGCODEPAGE = ANSI_1251, как в остальных выгрузках семьи.
    Единицы — миллиметры модели, чертёж рассчитан на печать 1:100.

    Слои, цвета и обозначения сняты с образца (ПБ-1303-2/26-ИОС2, Изм.1):
      ВК_В1 (синий) — ХВС, ВК_Т3 (красный) — ГВС, ВК_Текст — подписи участков,
      ВК — оборудование, П_Элементы узлов — условный знак счётчика, Перекрытие,
      Подписи — напоры, Расчётные точки. Шрифт — ISOCPEUR, высота текста
      4,5 мм на бумаге (450 по модели).
    Условные знаки сделаны БЛОКАМИ (счётчик, задвижка, обратный клапан,
    манометр), чтобы их можно было править и заменять на блоки бюро.

    Масштаб: вертикаль — в натуральную величину (этаж в блоке стояка равен
    высоте этажа в метрах), горизонталь — тем же коэффициентом, что и холст.
    Координаты холста переводятся в модель множителем S мм на пиксель.
*/

var HydDxf = (function () {
    'use strict';

    /* --- кодировка CP1251 ----------------------------------------------------- */

    var EXTRA = {
        'Ё': 0xA8, 'ё': 0xB8, '«': 0xAB, '»': 0xBB, '–': 0x96, '—': 0x97, '…': 0x85,
        '№': 0xB9, '°': 0xB0, '·': 0xB7, '±': 0xB1, '“': 0x93, '”': 0x94, '§': 0xA7, '©': 0xA9
    };
    var SUBST = {
        'Δ': 'D', 'δ': 'd', 'σ': 'sigma', 'α': 'alpha', 'Σ': 'S', 'μ': 'mu', 'γ': 'gamma',
        '×': 'x', '≤': '<=', '≥': '>=', '≈': '~', '→': '->', '←': '<-', '↑': '^', '₀': '0', '²': '2', '³': '3',
        '∅': '%%c', '⌀': '%%c', 'Ø': '%%c', 'ø': '%%c', ' ': ' ', '★': '*'
    };

    function cp1251(str) {
        var out = [];
        var s = String(str === null || str === undefined ? '' : str);
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            if (SUBST[ch] !== undefined) {
                var rep = SUBST[ch];
                for (var r = 0; r < rep.length; r++) out.push(rep.charCodeAt(r) & 0x7F);
                continue;
            }
            var code = s.charCodeAt(i);
            if (code < 0x80) { out.push(code); continue; }
            if (code >= 0x410 && code <= 0x44F) { out.push(code - 0x410 + 0xC0); continue; }
            if (EXTRA[ch] !== undefined) { out.push(EXTRA[ch]); continue; }
            out.push(0x3F);
        }
        return out;
    }

    function n(v) {
        if (!isFinite(v)) return '0.0';
        return (Math.round(v * 100) / 100).toFixed(2);
    }

    /* --- документ -------------------------------------------------------------- */

    function Doc() {
        this.ents = [];
        this.blocks = [];
        this.min = [1e18, 1e18];
        this.max = [-1e18, -1e18];
        this.sink = this.ents;
        this.ops = [];
        this.curOps = this.ops;
        this.blockOps = {};
    }

    Doc.prototype.g = function (code, value) {
        this.sink.push(String(code));
        this.sink.push(String(value));
        return this;
    };

    Doc.prototype.track = function (x, y) {
        if (this.sink !== this.ents) return;
        if (x < this.min[0]) this.min[0] = x;
        if (y < this.min[1]) this.min[1] = y;
        if (x > this.max[0]) this.max[0] = x;
        if (y > this.max[1]) this.max[1] = y;
    };

    Doc.prototype.line = function (layer, x1, y1, x2, y2) {
        this.g(0, 'LINE').g(8, layer)
            .g(10, n(x1)).g(20, n(y1)).g(30, '0.0')
            .g(11, n(x2)).g(21, n(y2)).g(31, '0.0');
        this.track(x1, y1); this.track(x2, y2);
        this.curOps.push({ t: 'line', layer: layer, x1: x1, y1: y1, x2: x2, y2: y2 });
        return this;
    };

    Doc.prototype.circle = function (layer, cx, cy, r) {
        this.g(0, 'CIRCLE').g(8, layer).g(10, n(cx)).g(20, n(cy)).g(30, '0.0').g(40, n(r));
        this.track(cx - r, cy - r); this.track(cx + r, cy + r);
        this.curOps.push({ t: 'circle', layer: layer, cx: cx, cy: cy, r: r });
        return this;
    };

    Doc.prototype.solid = function (layer, p1, p2, p3) {
        this.g(0, 'SOLID').g(8, layer)
            .g(10, n(p1[0])).g(20, n(p1[1])).g(30, '0.0')
            .g(11, n(p2[0])).g(21, n(p2[1])).g(31, '0.0')
            .g(12, n(p3[0])).g(22, n(p3[1])).g(32, '0.0')
            .g(13, n(p3[0])).g(23, n(p3[1])).g(33, '0.0');
        this.track(p1[0], p1[1]); this.track(p2[0], p2[1]); this.track(p3[0], p3[1]);
        this.curOps.push({ t: 'solid', layer: layer, p: [p1, p2, p3] });
        return this;
    };

    /* Ломаная POLYLINE/VERTEX с шириной линии w (по модели). */
    Doc.prototype.poly = function (layer, pts, w) {
        this.g(0, 'POLYLINE').g(8, layer).g(66, 1).g(10, '0.0').g(20, '0.0').g(30, '0.0').g(70, 0);
        if (w) this.g(40, n(w)).g(41, n(w));
        for (var i = 0; i < pts.length; i++) {
            this.g(0, 'VERTEX').g(8, layer).g(10, n(pts[i][0])).g(20, n(pts[i][1])).g(30, '0.0');
            this.track(pts[i][0], pts[i][1]);
        }
        this.g(0, 'SEQEND').g(8, layer);
        this.curOps.push({ t: 'poly', layer: layer, pts: pts, w: w || 0 });
        return this;
    };

    Doc.prototype.rect = function (layer, x0, y0, x1, y1) {
        return this.poly(layer, [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
    };

    /* Текст: align 'l' | 'c' | 'r'; вертикально — по середине строки. */
    Doc.prototype.text = function (layer, x, y, h, s, align, rot) {
        if (s === '' || s === null || s === undefined) return this;
        var hj = align === 'c' ? 1 : (align === 'r' ? 2 : 0);
        this.g(0, 'TEXT').g(8, layer)
            .g(10, n(x)).g(20, n(y)).g(30, '0.0')
            .g(40, n(h)).g(1, s).g(7, 'ISOCPEUR')
            .g(50, n(rot || 0)).g(72, hj).g(73, 2)
            .g(11, n(x)).g(21, n(y)).g(31, '0.0');
        this.track(x, y);
        this.track(x + (hj === 0 ? h * String(s).length * 0.6 : 0), y + h);
        this.curOps.push({ t: 'text', layer: layer, x: x, y: y, h: h, s: String(s), align: align || 'l', rot: rot || 0 });
        return this;
    };

    Doc.prototype.insert = function (layer, name, x, y, rot, sx, sy) {
        this.g(0, 'INSERT').g(8, layer).g(2, name).g(10, n(x)).g(20, n(y)).g(30, '0.0');
        if (sx !== undefined && sx !== 1) this.g(41, n(sx)).g(42, n(sy === undefined ? sx : sy)).g(43, '1.0');
        if (rot) this.g(50, n(rot));
        this.track(x, y);
        this.curOps.push({ t: 'insert', layer: layer, name: name, x: x, y: y, rot: rot || 0, sx: sx === undefined ? 1 : sx, sy: sy === undefined ? (sx === undefined ? 1 : sx) : sy });
        return this;
    };

    /* Блок: тело задаётся функцией, рисующей на слое «0» в локальных координатах. */
    Doc.prototype.defineBlock = function (name, draw) {
        var saved = this.sink;
        var savedOps = this.curOps;
        this.sink = [];
        this.curOps = this.blockOps[name] = [];
        this.g(0, 'BLOCK').g(8, '0').g(2, name).g(70, 0).g(10, '0.0').g(20, '0.0').g(30, '0.0').g(3, name);
        draw(this);
        this.g(0, 'ENDBLK').g(8, '0');
        this.blocks.push(this.sink);
        this.sink = saved;
        this.curOps = savedOps;
    };

    /* --- слои ------------------------------------------------------------------- */

    var LAYERS = [
        { name: 'ВК_В1', color: 5 },
        { name: 'ВК_Т3', color: 1 },
        { name: 'ВК_Т4', color: 30 },
        { name: 'ВК_Текст', color: 7 },
        { name: 'ВК', color: 7 },
        { name: 'П_Элементы_узлов', color: 7 },
        { name: 'Перекрытие', color: 8 },
        { name: 'Подписи', color: 3 },
        { name: 'Уровни', color: 3 },
        { name: 'Расчётные_точки', color: 30 },
        { name: 'Основная_надпись', color: 7 }
    ];

    Doc.prototype.build = function () {
        var h = [];
        function g(code, value) { h.push(String(code)); h.push(String(value)); }

        if (this.min[0] > this.max[0]) { this.min = [0, 0]; this.max = [1000, 1000]; }

        g(0, 'SECTION'); g(2, 'HEADER');
        g(9, '$ACADVER'); g(1, 'AC1009');
        g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251');
        g(9, '$INSUNITS'); g(70, 4);
        g(9, '$LTSCALE'); g(40, '1.0');
        g(9, '$EXTMIN'); g(10, n(this.min[0])); g(20, n(this.min[1])); g(30, '0.0');
        g(9, '$EXTMAX'); g(10, n(this.max[0])); g(20, n(this.max[1])); g(30, '0.0');
        g(0, 'ENDSEC');

        g(0, 'SECTION'); g(2, 'TABLES');

        g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
        g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
        g(0, 'ENDTAB');

        g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length + 1);
        g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
        for (var i = 0; i < LAYERS.length; i++) {
            g(0, 'LAYER'); g(2, LAYERS[i].name); g(70, 0); g(62, LAYERS[i].color); g(6, 'CONTINUOUS');
        }
        g(0, 'ENDTAB');

        g(0, 'TABLE'); g(2, 'STYLE'); g(70, 2);
        g(0, 'STYLE'); g(2, 'ISOCPEUR'); g(70, 0); g(40, '0.0'); g(41, '1.0'); g(50, '0.0'); g(71, 0); g(42, '2.5'); g(3, 'isocpeur.ttf'); g(4, '');
        g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, '0.0'); g(41, '1.0'); g(50, '0.0'); g(71, 0); g(42, '2.5'); g(3, 'isocpeur.ttf'); g(4, '');
        g(0, 'ENDTAB');

        g(0, 'ENDSEC');

        g(0, 'SECTION'); g(2, 'BLOCKS');
        var bl = h;
        this.blocks.forEach(function (b) { for (var k = 0; k < b.length; k++) bl.push(b[k]); });
        g(0, 'ENDSEC');

        g(0, 'SECTION'); g(2, 'ENTITIES');
        var all = h.concat(this.ents);
        all.push('0'); all.push('ENDSEC');
        all.push('0'); all.push('EOF');

        var bytes = [];
        for (var k = 0; k < all.length; k++) {
            var b = cp1251(all[k]);
            for (var m = 0; m < b.length; m++) bytes.push(b[m]);
            bytes.push(13); bytes.push(10);
        }
        return new Uint8Array(bytes);
    };

    /* --- условные знаки как блоки --------------------------------------------- */

    function defineSymbols(doc) {
        // Счётчик воды: прямоугольник 800×500, диагональ, одна половина залита (как в образце)
        doc.defineBlock('УГО_Счётчик', function (d) {
            d.line('0', -400, -250, 400, -250).line('0', 400, -250, 400, 250).line('0', 400, 250, -400, 250).line('0', -400, 250, -400, -250);
            d.line('0', -400, -250, 400, 250);
            d.solid('0', [400, 250], [-400, -250], [400, -250]);
        });

        // Задвижка: «бабочка» с двумя планками, 500×300
        doc.defineBlock('задв', function (d) {
            d.line('0', -250, 150, 250, -150).line('0', 250, 150, -250, -150);
            d.line('0', -250, 150, -250, -150).line('0', 250, 150, 250, -150);
        });

        // Обратный клапан по ходу слева направо
        doc.defineBlock('обр_клапан', function (d) {
            d.line('0', -250, 180, 250, 0).line('0', 250, 0, -250, -180).line('0', -250, -180, -250, 180);
            d.line('0', 250, 220, 250, -220);
        });

        // Манометр: круг на трубке
        doc.defineBlock('манометр', function (d) {
            d.circle('0', 0, 600, 250).line('0', 0, 0, 0, 350);
            d.line('0', -120, 540, 120, 540);
        });

        // Насос: окружность с треугольником по направлению потока
        doc.defineBlock('насос', function (d) {
            d.circle('0', 0, 0, 420);
            d.line('0', -200, -250, 330, 0).line('0', 330, 0, -200, 250).line('0', -200, 250, -200, -250);
        });
    }

    /* --- рисование схемы -------------------------------------------------------- */

    function num(x, d) { return Format.num(x, d); }

    function fixedText(x) { return String(x); }

    /*
        Построение. opts: { points (id системы или ''), th (высота текста, по умолчанию 450) }.
        Возвращает байты DXF.
    */
    function makeDoc(result, hyd, opts, nets) {
        opts = opts || {};
        var th = opts.th || 450;
        var survey = hyd.survey;
        var S = survey.floorHeight * 1000 / survey.floorPx;       // мм на пиксель холста
        var doc = new Doc();
        var byId = result && result.net ? result.net.byId : {};
        var yOff = 0;

        defineSymbols(doc);

        nets.forEach(function (net) {
            var bounds = drawSheet(doc, result, hyd, net, S, th, byId, yOff, opts);
            if (bounds) yOff = bounds.minY - th * 40;
        });

        return doc;
    }

    function build(result, hyd, opts) {
        return makeDoc(result, hyd, opts, ['c', 'h']).build();
    }

    function layerColor(name) {
        for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].name === name) return LAYERS[i].color;
        return 7;
    }

    function drawSheet(doc, result, hyd, net, S, th, byId, yOff, opts) {
        var survey = hyd.survey;
        var cold = net === 'c';
        var pipeLayer = cold ? 'ВК_В1' : 'ВК_Т3';
        var minY = 1e18;
        var any = false;

        function X(x) { return x * S; }
        function Y(y) { return -y * S + yOff; }
        function P(p) { return [X(p.x), Y(p.y)]; }
        function track(y) { if (y < minY) minY = y; any = true; }

        // заголовок листа
        var nodes = hyd.canvas.nodes.filter(function (nd) { return HydGraph.onSheet(nd, net); });
        if (!nodes.length) return null;

        var firstNode = nodes[0];
        var top = Math.min.apply(null, nodes.map(function (nd) { return HydModel.pos(nd, net).y - (nd.kind === 'riser' ? nd.floorTo * survey.floorPx : 0); }));
        var left = Math.min.apply(null, nodes.map(function (nd) { return HydModel.pos(nd, net).x; }));
        doc.text('ВК_Текст', X(left) - 4000, Y(top) + 4 * th, th * 1.6,
            (survey.objectName ? survey.objectName + '. ' : '') + (cold ? 'Схема холодного водоснабжения В1' : 'Схема горячего водоснабжения Т3'), 'l', 0);

        /* --- трубы --- */
        hyd.canvas.pipes.forEach(function (p) {
            if (p.sheet !== net) return;
            var pts = HydGraph.ptsOf(hyd, p).map(P);
            var a = HydModel.nodeById(hyd, p.a);
            var b = HydModel.nodeById(hyd, p.b);

            // у проходных счётчиков и насосных труба идёт до знака
            doc.poly(pipeLayer, pts, 30);
            pts.forEach(function (q) { track(q[1]); });

            var s = byId[net + '|' + p.id];
            if (!s || !s.res || !s.res.size) return;
            var z = s.res.size;
            var lines = [z.label + '  q=' + num(s.res.q, 3) + ' л/с', 'V=' + num(z.v, 2) + ' м/с  i=' + num(z.iMm, 2) + ' мм/м  L=' + num(s.L, 1) + ' м'];
            if (s.res.hd) lines.push('H ' + num(s.res.hd.inDyn, 1) + ' -> ' + num(s.res.hd.outDyn, 1) + ' м');

            var best = 0;
            var bl = -1;
            for (var i = 0; i + 1 < pts.length; i++) {
                var l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
                if (l > bl) { bl = l; best = i; }
            }
            if (bl < th * 8) return;

            var A = pts[best];
            var B = pts[best + 1];
            var mx = (A[0] + B[0]) / 2;
            var my = (A[1] + B[1]) / 2;
            var vertical = Math.abs(B[0] - A[0]) < Math.abs(B[1] - A[1]);

            lines.forEach(function (t, i2) {
                if (vertical) doc.text(i2 === 2 ? 'Подписи' : 'ВК_Текст', mx + th * 0.8, my + th * 1.0 - i2 * th * 1.3, th, t, 'l', 0);
                else doc.text(i2 === 2 ? 'Подписи' : 'ВК_Текст', mx, my + th * (2.6 - i2 * 1.3) - (i2 === 2 ? th * 0.8 : 0), th, t, 'c', 0);
            });
        });

        /* --- объекты --- */
        nodes.forEach(function (nd) {
            var pos = HydModel.pos(nd, net);
            var x = X(pos.x);
            var y = Y(pos.y);
            track(y);

            if (nd.kind === 'tee') {
                doc.circle(pipeLayer, x, y, 90);
            } else if (nd.kind === 'input') {
                var inSeg = byId['c|in'];
                doc.circle('ВК', x, y, 450);
                doc.text('ВК', x, y, th, 'В', 'c', 0);
                doc.text('ВК_Текст', x, y + 900, th * 1.2, nd.name, 'c', 0);
                doc.text('ВК_Текст', x, y - 900, th, 'Hгар=' + num(nd.Hgar, 1) + ' м', 'c', 0);
                if (inSeg && inSeg.res && inSeg.res.size) {
                    doc.text('ВК_Текст', x, y - 900 - th * 1.3, th, inSeg.res.size.label + '  q=' + num(inSeg.res.q, 3) + ' л/с', 'c', 0);
                    if (inSeg.res.hd) doc.text('Подписи', x, y - 900 - th * 2.6, th, 'после ввода H ' + num(inSeg.res.hd.outDyn, 1) + ' м', 'c', 0);
                }
            } else if (nd.kind === 'meter') {
                var vertical = nd.rot === 90;
                var dev = byId[net + '|dev:' + nd.id];
                // отрезки трубы от портов до знака
                var ports = HydGraph.portsOf(nd, net);
                ports.forEach(function (q) {
                    var qx = X(q.x);
                    var qy = Y(q.y);
                    var dx = x - qx;
                    var dy = y - qy;
                    var len = Math.hypot(dx, dy) || 1;
                    doc.line(pipeLayer, qx, qy, x - dx / len * 400, y - dy / len * 400);
                });
                doc.insert('П_Элементы_узлов', 'УГО_Счётчик', x, y, vertical ? 90 : 0);
                var ml = [];
                if (dev && dev.res && dev.res.meter) {
                    ml.push(dev.res.meter.mark + (dev.res.meter.manual ? ' *' : ''));
                    ml.push('hсч=' + num(dev.res.meter.h, 2) + ' м');
                    if (dev.res.hd) ml.push('H ' + num(dev.res.hd.inDyn, 1) + ' -> ' + num(dev.res.hd.outDyn, 1) + ' м');
                }
                ml.forEach(function (t, i) {
                    if (vertical) doc.text(i === 2 ? 'Подписи' : 'ВК_Текст', x + 700, y + th * (1.3 - i * 1.3), th, t, 'l', 0);
                    else doc.text(i === 2 ? 'Подписи' : 'ВК_Текст', x, y - 700 - i * th * 1.3, th, t, 'c', 0);
                });
            } else if (nd.kind === 'pump') {
                drawPump(doc, nd, x, y, th, result, byId, pipeLayer, S, hyd.pumpSel ? hyd.pumpSel[nd.id] : null);
            } else if (nd.kind === 'itp') {
                doc.rect('ВК', x - 2200, y - 1100, x + 2200, y + 1100);
                doc.text('ВК', x, y, th * 1.4, nd.name || 'ИТП', 'c', 0);
                var d2 = byId['h|dev:' + nd.id];
                if (d2 && d2.res && !cold) doc.text('ВК_Текст', x, y - 1100 - th * 1.5, th, 'ГВС q=' + num(d2.res.q, 3) + ' л/с', 'c', 0);
                var feed = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (s) { return s.kind === 'pipe' && s.net === 'c' && s.node === nd.id; })[0];
                if (feed && feed.res.hd && cold) doc.text('Подписи', x, y - 1100 - th * 1.5, th, 'на входе ИТП H ' + num(feed.res.hd.outDyn, 1) + ' м', 'c', 0);
            } else if (nd.kind === 'buildin') {
                doc.rect('ВК', x - 3500, y - 900, x + 3500, y + 900);
                doc.text('ВК', x, y + th * 0.7, th * 1.1, nd.name, 'c', 0);
                doc.text('ВК_Текст', x, y - th * 0.8, th, nd.U + ' чел.' + (nd.hasHot ? '' : ', без ГВС'), 'c', 0);
            } else if (nd.kind === 'riser') {
                drawRiser(doc, nd, pos, net, S, th, result, byId, hyd, yOff, pipeLayer, track);
            }
        });

        /* --- расчётные точки --- */
        var sys = result && result.systems ? result.systems.filter(function (s) { return s.id === (opts.points === 'auto' ? (result.systems[0] && result.systems[0].id) : opts.points); })[0] : null;
        if (sys && sys.route) {
            sys.route.points.forEach(function (pt) {
                if (pt.net !== net) return;
                var cx = X(pt.x) - 900;
                var cy = Y(pt.y) + 1000;
                doc.line('Расчётные_точки', X(pt.x), Y(pt.y), cx, cy);
                doc.circle('Расчётные_точки', cx, cy, 380);
                doc.text('Расчётные_точки', cx, cy, th * 0.95, String(pt.no), 'c', 0);
            });
        }

        return { minY: any ? minY : yOff };
    }

    function drawPump(doc, nd, x, y, th, result, byId, pipeLayer, S, sel) {
        var cnt = HydGraph.pumpCount(nd);
        var work = Math.max(1, nd.work || 1);
        var step = 1700;
        var top = y + (cnt - 1) * step / 2;
        var bot = y - (cnt - 1) * step / 2;
        var cl = x - 2200;
        var cr = x + 2200;
        var ports = HydGraph.portsOf(nd, 'c');

        // подводящие и отводящие линии от портов до коллекторов
        ports.forEach(function (q) {
            if (q.id === 'l') doc.line(pipeLayer, q.x * S, -q.y * S + (y - (-nd.y * S)), cl, y);
            if (q.id === 'r') doc.line(pipeLayer, q.x * S, -q.y * S + (y - (-nd.y * S)), cr, y);
        });

        doc.poly(pipeLayer, [[cl, top], [cl, bot]], 60);
        doc.poly(pipeLayer, [[cr, top], [cr, bot]], 60);

        for (var i = 0; i < cnt; i++) {
            var ry = top - i * step;
            doc.line(pipeLayer, cl, ry, cr, ry);
            doc.insert('ВК', 'задв', cl + 800, ry, 0);
            doc.insert('ВК', 'насос', x - 500, ry, 0);
            doc.insert('ВК', 'обр_клапан', x + 900, ry, 0);
            doc.insert('ВК', 'задв', cr - 800, ry, 0);
            if (i >= work) doc.text('ВК_Текст', cl + 150, ry + 420, th * 0.8, 'рез.', 'l', 0);
        }

        doc.insert('ВК', 'манометр', cl, top + 300, 0);
        doc.insert('ВК', 'манометр', cr, top + 300, 0);

        var sys = result && result.systems ? result.systems.filter(function (s) { return s.id === nd.id; })[0] : null;
        doc.text('ВК_Текст', x, top + 1900, th * 1.2, nd.name + ' — насосная установка', 'c', 0);
        if (sys && sys.pump) {
            doc.text('ВК_Текст', x, bot - 1100, th, 'Q=' + num(sys.pump.q, 2) + ' л/с  H=' + num(sys.pump.hp, 1) + ' м  (' + work + ' раб.' + (cnt - work ? ' + ' + (cnt - work) + ' рез.' : '') + ')', 'c', 0);
            if (sel && sel.name) {
                doc.text('ВК_Текст', x, bot - 1100 - th * 1.8, th, sel.name + (sel.Qf !== null && sel.Hf !== null ? '  Qф=' + num(sel.Qf, 2) + ' л/с  Hф=' + num(sel.Hf, 1) + ' м' : ''), 'c', 0);
            }
            var dev = byId['c|dev:' + nd.id];
            if (dev && dev.res.hd) {
                doc.text('Подписи', cl - 300, y + 700, th, 'до насоса H ' + num(dev.res.hd.inDyn, 1) + ' м', 'r', 0);
                doc.text('Подписи', cr + 300, y + 700, th, 'после H ' + num(dev.res.hd.outDyn, 1) + ' м', 'l', 0);
            }
        }
    }

    function drawRiser(doc, nd, pos, net, S, th, result, byId, hyd, yOff, pipeLayer, track) {
        var survey = hyd.survey;
        var fp = survey.floorPx;
        var top = nd.floorTo;
        var x = pos.x * S;
        var yBase = -pos.y * S + yOff;
        var floorMm = fp * S;
        var entry = result && result.ex ? result.ex.risers.filter(function (r) { return r.node.id === nd.id; })[0] : null;
        var mark = entry ? (net === 'c' ? entry.markC : entry.markH) : nd.id;
        var first = byId[net + '|' + nd.id + '|R|1'];

        track(yBase);

        // опора стояка и вертикаль
        doc.rect('ВК', x - 900, yBase - 900, x + 900, yBase);
        doc.line(pipeLayer, x, yBase - 900, x, yBase - 18 * S);      // труба от порта до подставки
        doc.text('ВК_Текст', x, yBase - 450, th, mark, 'c', 0);
        doc.poly(pipeLayer, [[x, yBase], [x, yBase + top * floorMm]], 40);

        var arrive = null;
        Object.keys(byId).forEach(function (k) { if (byId[k].kind === 'pipe' && byId[k].net === net && byId[k].node === nd.id) arrive = byId[k]; });
        if (arrive && arrive.res.hd) doc.text('Подписи', x, yBase - 1500, th, 'у основания H ' + num(arrive.res.hd.outDyn, 1) + ' м', 'c', 0);

        if (first && first.res.size) {
            var z = first.res.size;
            var ym = yBase + Math.min(top, 4) * floorMm / 2;
            doc.text('ВК_Текст', x - 500, ym + th * 1.3, th, mark + '  ' + z.label, 'r', 0);
            doc.text('ВК_Текст', x - 500, ym, th, 'q=' + num(first.res.q, 3) + ' л/с', 'r', 0);
            doc.text('ВК_Текст', x - 500, ym - th * 1.3, th, 'V=' + num(z.v, 2) + ' м/с  i=' + num(z.iMm, 2) + ' мм/м', 'r', 0);
        }

        if (!entry) return;

        var colW = 3000;
        var colGap = 3500;

        entry.floors.forEach(function (fl) {
            var slab = yBase + fl.f * floorMm - floorMm;      // пол этажа
            var mid = slab + floorMm / 2;
            var cols = fl.collectors.length;

            // перекрытие и отметка этажа
            doc.line('Перекрытие', x - 1500, slab, x + 1500 + Math.max(cols, 1) * colGap + 3000, slab);
            doc.text('Уровни', x + 1500 + Math.max(cols, 1) * colGap + 3200, slab + 60, th * 0.9,
                'Этаж ' + fl.f + '  ' + (fl.elev >= 0 ? '+' : '') + num(fl.elev, 3), 'l', 0);

            fl.collectors.forEach(function (c, j) {
                var bx = x + 1500 + j * colGap;
                doc.line(pipeLayer, x, mid, bx, mid);
                doc.rect('ВК', bx, mid - 400, bx + colW, mid + 400);
                var outs = c.outlets;
                var label = outs.length ? (outs.length === 1 ? outs[0].label : outs[0].label + '-' + String(outs[outs.length - 1].label).split(/\s+/).pop()) : c.col.name;
                doc.text('ВК_Текст', bx + colW / 2, mid, th * 0.85, label, 'c', 0);
            });

            // напор у коллектора
            var best = null;
            fl.collectors.forEach(function (c) {
                var s = byId[net + '|' + c.id + '|fb'];
                if (s && s.res && s.res.press && (best === null || s.res.press.dyn < best)) best = s.res.press.dyn;
            });
            if (best !== null) doc.text('Подписи', x + 1500 + cols * colGap, mid, th * 0.85, 'H ' + num(best, 1) + ' м', 'l', 0);
        });
    }

    function fileName(hyd) {
        var d = new Date();
        var two = function (v) { return (v < 10 ? '0' : '') + v; };
        var base = (hyd.survey.objectName || 'Схема ВК').replace(/[\\\/:*?"<>|]/g, '-');
        return base + ' — схема В1-Т3 — ' + two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear() + '.dxf';
    }

    function save(result, hyd, opts) {
        var bytes = build(result, hyd, opts);
        Zip.save(bytes, fileName(hyd), 'application/dxf');
    }

    return { build: build, makeDoc: makeDoc, save: save, cp1251: cp1251, layerColor: layerColor };
})();
