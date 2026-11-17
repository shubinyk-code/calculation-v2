'use strict';

/*
    План: подложка, сеть, подписи.

    Мир — метры, камера — левый верхний угол в метрах и масштаб в пикселях
    на метр. Подписи рисуются в экранных пикселях, а не в метрах: при любом
    масштабе они остаются читаемыми, а при сильном отдалении прячутся, чтобы
    не превращать план в кашу из цифр.
*/

var View = (function () {

    var canvas = null;
    var ctx = null;
    var width = 0;
    var height = 0;
    var dpr = 1;
    var cam = { x: -3, y: -3, s: 40 };

    var image = null;
    var imageSrc = '';

    var C = {
        main: '#1D6FB8',
        ray: '#1F9BB5',
        idle: '#9FB3C4',
        loose: '#C9D5DF',
        fast: '#D2413A',
        dictPath: 'rgba(232, 137, 43, 0.33)',
        select: '#E8892B',
        hover: 'rgba(29, 111, 184, 0.22)',
        working: '#17916B',
        dict: '#D2413A',
        closed: '#8A9BAB',
        zone: '#D2413A',
        text: '#1B2A38',
        pressure: '#0F7A57',
        junctionPressure: '#1D6FB8',
        cu: '#2DB84D',
        fixed: '#7A5AA8',
        grid: '#EEF3F8'
    };

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function init(el) {
        canvas = el;
        ctx = canvas.getContext('2d');

        window.addEventListener('resize', resize);
        if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentNode);

        resize();
    }

    function resize() {
        var r = canvas.parentNode.getBoundingClientRect();
        dpr = window.devicePixelRatio || 1;
        width = r.width;
        height = r.height;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        render();
    }

    function scale() { return cam.s; }
    function sx(x) { return (x - cam.x) * cam.s; }
    function sy(y) { return (y - cam.y) * cam.s; }

    function toWorld(px, py) {
        return { x: px / cam.s + cam.x, y: py / cam.s + cam.y };
    }

    function zoomAt(px, py, factor) {
        var w = toWorld(px, py);
        cam.s = clamp(cam.s * factor, 0.3, 3000);
        cam.x = w.x - px / cam.s;
        cam.y = w.y - py / cam.s;
        render();
    }

    function panBy(dx, dy) {
        cam.x -= dx / cam.s;
        cam.y -= dy / cam.s;
        render();
    }

    /** Точку за краем экрана подвинуть в центр. */
    function reveal(x, y) {
        var px = sx(x);
        var py = sy(y);
        if (px < 40 || py < 40 || px > width - 40 || py > height - 40) {
            cam.x = x - width / 2 / cam.s;
            cam.y = y - height / 2 / cam.s;
        }
        render();
    }

    function bounds() {
        var p = App.project;
        var b = null;

        function add(x, y) {
            if (!b) b = { x0: x, y0: y, x1: x, y1: y };
            b.x0 = Math.min(b.x0, x);
            b.y0 = Math.min(b.y0, y);
            b.x1 = Math.max(b.x1, x);
            b.y1 = Math.max(b.y1, y);
        }

        p.nodes.forEach(function (n) { add(n.x, n.y); });
        if (p.zone) p.zone.forEach(function (v) { add(v.x, v.y); });
        if (p.corridor && p.corridor.axis) p.corridor.axis.forEach(function (v) { add(v.x, v.y); });

        var u = p.underlay;
        if (u && u.w && u.visible !== false) {
            add(u.x, u.y);
            add(u.x + u.w * u.scale, u.y + u.h * u.scale);
        }

        var d = p.dxf;
        if (d && d.w && d.visible !== false) {
            add(d.x, d.y);
            add(d.x + d.w, d.y + d.h);
        }

        return b;
    }

    function fit() {
        var b = bounds();
        if (!b || !width) {
            cam = { x: -3, y: -3, s: 40 };
            render();
            return;
        }

        var w = Math.max(b.x1 - b.x0, 3);
        var h = Math.max(b.y1 - b.y0, 3);
        var s = clamp(Math.min((width - 90) / w, (height - 90) / h), 0.3, 400);

        cam.s = s;
        cam.x = (b.x0 + b.x1) / 2 - width / 2 / s;
        cam.y = (b.y0 + b.y1) / 2 - height / 2 / s;
        render();
    }

    function syncUnderlay() {
        var u = App.project ? App.project.underlay : null;

        if (!u || !u.src) {
            image = null;
            imageSrc = '';
            return;
        }

        if (u.src !== imageSrc) {
            imageSrc = u.src;
            image = new Image();
            image.onload = render;
            image.src = u.src;
        }
    }

    /* --- попадание ------------------------------------------------------- */

    function nodeMap(p) {
        var map = {};
        p.nodes.forEach(function (n) { map[n.id] = n; });
        return map;
    }

    function hit(px, py, opts) {
        var p = App.project;
        var exclude = opts && opts.exclude;
        var best = null;
        var bestD = 10;
        var map = nodeMap(p);

        p.nodes.forEach(function (n) {
            if (n.id === exclude) return;
            var d = Math.sqrt((sx(n.x) - px) * (sx(n.x) - px) + (sy(n.y) - py) * (sy(n.y) - py));
            if (d < bestD) {
                bestD = d;
                best = { type: 'node', id: n.id };
            }
        });

        if (best) return best;

        bestD = 7;
        p.segments.forEach(function (s) {
            if (exclude !== undefined && (s.a === exclude || s.b === exclude)) return;
            var A = map[s.a];
            var B = map[s.b];
            var pr = Model.projectOn(sx(A.x), sy(A.y), sx(B.x), sy(B.y), px, py);
            if (pr.d < bestD) {
                bestD = pr.d;
                best = { type: 'seg', id: s.id };
            }
        });

        return best;
    }

    /* --- рисование ------------------------------------------------------- */

    function text(str, x, y, opts) {
        ctx.font = opts.font || '11px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = opts.align || 'left';
        ctx.textBaseline = opts.baseline || 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 3.5;
        ctx.strokeText(str, x, y);
        ctx.fillStyle = opts.color || C.text;
        ctx.fillText(str, x, y);
    }

    function drawGrid() {
        var step = cam.s >= 14 ? 1 : cam.s >= 3 ? 5 : 10;
        var w0 = toWorld(0, 0);
        var w1 = toWorld(width, height);

        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (var x = Math.floor(w0.x / step) * step; x <= w1.x; x += step) {
            ctx.moveTo(Math.round(sx(x)) + 0.5, 0);
            ctx.lineTo(Math.round(sx(x)) + 0.5, height);
        }
        for (var y = Math.floor(w0.y / step) * step; y <= w1.y; y += step) {
            ctx.moveTo(0, Math.round(sy(y)) + 0.5);
            ctx.lineTo(width, Math.round(sy(y)) + 0.5);
        }
        ctx.stroke();
    }

    function drawUnderlay(u) {
        if (!u || u.visible === false || !image || !image.complete || !image.naturalWidth) return;

        ctx.save();
        ctx.globalAlpha = u.opacity === undefined ? 0.6 : u.opacity;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, sx(u.x), sy(u.y), image.naturalWidth * u.scale * cam.s, image.naturalHeight * u.scale * cam.s);
        ctx.restore();
    }

    /* --- чертёж DXF -------------------------------------------------------- */

    /*
        Геометрия чертежа не меняется, поэтому ломаные и дуги один раз
        складываются в Path2D в метрах, а на каждой перерисовке только
        переставляется матрица — иначе тысячи линий тормозили бы.
    */
    var dxfPath = null;
    var dxfSource = null;

    function syncDxf(d) {
        if (!d || !d.ents || !d.ents.length) {
            dxfPath = null;
            dxfSource = null;
            return;
        }
        if (dxfSource === d.ents) return;

        var path = new Path2D();
        d.ents.forEach(function (e) {
            if (e.t === 'p') {
                path.moveTo(e.v[0], e.v[1]);
                for (var i = 2; i < e.v.length; i += 2) path.lineTo(e.v[i], e.v[i + 1]);
            } else if (e.t === 'a' && e.r > 0) {
                path.moveTo(e.x + e.r * Math.cos(e.a0), e.y + e.r * Math.sin(e.a0));
                path.arc(e.x, e.y, e.r, e.a0, e.a1, true);
            }
        });

        dxfPath = path;
        dxfSource = d.ents;
    }

    function drawDxf(d) {
        if (!d || d.visible === false) return;
        syncDxf(d);
        if (!dxfPath) return;

        ctx.save();
        ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s,
            dpr * (d.x - cam.x) * cam.s, dpr * (d.y - cam.y) * cam.s);
        ctx.strokeStyle = 'rgba(96, 106, 122, 0.62)';
        ctx.lineWidth = 0.85 / cam.s;
        ctx.lineJoin = 'round';
        ctx.stroke(dxfPath);
        ctx.restore();

        // Надписи чертежа — обычным преобразованием, чтобы буквы не растягивались.
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = 'rgba(96, 106, 122, 0.78)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        d.ents.forEach(function (e) {
            if (e.t !== 't') return;
            var px = e.h * cam.s;
            if (px < 5 || px > 160) return;

            ctx.save();
            ctx.translate(sx(e.x + d.x), sy(e.y + d.y));
            if (e.rot) ctx.rotate(e.rot);
            ctx.font = px.toFixed(1) + 'px "Segoe UI", Arial, sans-serif';
            ctx.fillText(e.s, 0, 0);
            ctx.restore();
        });
        ctx.restore();
    }

    function drawZone(zone) {
        if (!zone || zone.length < 3) return;

        ctx.beginPath();
        zone.forEach(function (v, i) {
            if (i === 0) ctx.moveTo(sx(v.x), sy(v.y));
            else ctx.lineTo(sx(v.x), sy(v.y));
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(210, 65, 58, 0.05)';
        ctx.fill();
        ctx.strokeStyle = C.zone;
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    /*
        Разметка коридора: ось будущей трубы и квартирные двери.

        Рисуется подложкой, под сетью: после расстановки труба ложится прямо
        на ось, и ось не должна её перекрывать. Двери — косые засечки: кружок
        читался бы как ороситель, а крест — как врезка.
    */
    function drawCorridor(c) {
        if (!c) return;

        var axis = c.axis || [];
        var doors = c.doors || [];

        if (axis.length > 1) {
            ctx.beginPath();
            axis.forEach(function (v, i) {
                if (i === 0) ctx.moveTo(sx(v.x), sy(v.y));
                else ctx.lineTo(sx(v.x), sy(v.y));
            });
            ctx.strokeStyle = 'rgba(122, 90, 168, 0.75)';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([9, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        axis.forEach(function (v) {
            var x = sx(v.x);
            var y = sy(v.y);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(122, 90, 168, 0.9)';
            ctx.fill();
        });

        doors.forEach(function (d) {
            var x = sx(d.x);
            var y = sy(d.y);
            ctx.beginPath();
            ctx.moveTo(x - 5, y + 5);
            ctx.lineTo(x + 5, y - 5);
            ctx.moveTo(x - 5, y - 5);
            ctx.lineTo(x + 5, y + 5);
            ctx.strokeStyle = '#7A5AA8';
            ctx.lineWidth = 1.8;
            ctx.stroke();
        });
    }

    function segLine(A, B, color, widthPx, dash) {
        ctx.beginPath();
        ctx.moveTo(sx(A.x), sy(A.y));
        ctx.lineTo(sx(B.x), sy(B.y));
        ctx.strokeStyle = color;
        ctx.lineWidth = widthPx;
        ctx.setLineDash(dash || []);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function segColor(seg, info) {
        if (!info || !info.inTree) return C.loose;
        if (!info.active) return C.idle;
        if (info.V > Solver.MAX_VELOCITY) return C.fast;
        return seg.role === 'main' ? C.main : C.ray;
    }

    function segmentLabel(p, seg, info, L, dimsDrawn) {
        var parts = [];

        if (L.pipe && info) parts.push(info.dn ? 'Ду' + info.dn : String(seg.od).replace('.', ',') + '×' + String(seg.wall).replace('.', ','));
        // У магистрали длину показывает размерная цепочка — но только если она
        // нарисована: на мелком масштабе цепочек нет, и длина нужна в подписи.
        if (L.length && !(dimsDrawn && seg.role === 'main')) parts.push(Fmt.num(Model.length(p, seg), 2) + (seg.len > 0 ? '*' : ''));

        if (info && info.active) {
            if (L.flow) parts.push('Q ' + Fmt.num(info.Q, 2));
            if (L.loss) parts.push('Δ ' + Fmt.num(info.dH, 2));
        }

        if (seg.ring) parts.push('½');
        return parts.join('   ');
    }

    /*
        Подписи, по которым можно щёлкнуть и ввести длину. Хранятся в экранных
        координатах текущего кадра и собираются заново при каждой перерисовке.
    */
    var hotspots = [];

    function rotatedLabel(cx, cy, angle, label, color, segId, font) {
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;

        ctx.font = font || '11px "Segoe UI", Arial, sans-serif';
        var w = ctx.measureText(label).width;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        text(label, 0, -5, { align: 'center', color: color, font: font });
        ctx.restore();

        if (segId !== undefined) {
            hotspots.push({ segId: segId, cx: cx, cy: cy, ux: Math.cos(angle), uy: Math.sin(angle), hw: w / 2 });
        }
    }

    function drawSegmentLabel(A, B, label, color, segId) {
        if (!label) return;

        var ax = sx(A.x), ay = sy(A.y), bx = sx(B.x), by = sy(B.y);
        var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));

        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        if (ctx.measureText(label).width + 12 > len) return;

        rotatedLabel((ax + bx) / 2, (ay + by) / 2, Math.atan2(by - ay, bx - ax), label, color, segId);
    }

    /**
     * Размерные цепочки вдоль магистрали: расстояния между лучами. Цепочка
     * встаёт на ту сторону магистрали, где лучей меньше, чтобы не лечь поверх
     * оросителей.
     */
    function drawDims(p, map) {
        p.segments.forEach(function (seg) {
            if (seg.role !== 'main') return;

            var A = map[seg.a], B = map[seg.b];
            var ax = sx(A.x), ay = sy(A.y), bx = sx(B.x), by = sy(B.y);
            var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
            if (len < 36) return;

            var ux = (bx - ax) / len, uy = (by - ay) / len;
            var nx = -uy, ny = ux;
            var side = 0;

            [seg.a, seg.b].forEach(function (id) {
                var P = map[id];
                Model.segmentsAt(p, id).forEach(function (t) {
                    if (t.role === 'main') return;
                    var O = map[Model.other(t, id)];
                    var dot = (sx(O.x) - sx(P.x)) * nx + (sy(O.y) - sy(P.y)) * ny;
                    side += dot > 0 ? 1 : dot < 0 ? -1 : 0;
                });
            });

            var k = side > 0 ? -1 : 1;
            var off = 28 * k;
            var a1x = ax + nx * off, a1y = ay + ny * off;
            var b1x = bx + nx * off, b1y = by + ny * off;

            ctx.strokeStyle = '#9A7B4F';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ax + nx * 7 * k, ay + ny * 7 * k); ctx.lineTo(a1x + nx * 4 * k, a1y + ny * 4 * k);
            ctx.moveTo(bx + nx * 7 * k, by + ny * 7 * k); ctx.lineTo(b1x + nx * 4 * k, b1y + ny * 4 * k);
            ctx.moveTo(a1x, a1y); ctx.lineTo(b1x, b1y);
            ctx.moveTo(a1x - (ux + nx) * 3.5, a1y - (uy + ny) * 3.5); ctx.lineTo(a1x + (ux + nx) * 3.5, a1y + (uy + ny) * 3.5);
            ctx.moveTo(b1x - (ux + nx) * 3.5, b1y - (uy + ny) * 3.5); ctx.lineTo(b1x + (ux + nx) * 3.5, b1y + (uy + ny) * 3.5);
            ctx.stroke();

            // Со звёздочкой — длина, вписанная для расчёта: именно она в таблице.
            var label = Fmt.num(Model.length(p, seg), 2) + (seg.len > 0 ? '*' : '');
            rotatedLabel((a1x + b1x) / 2, (a1y + b1y) / 2, Math.atan2(uy, ux), label, '#7A5A2B', seg.id,
                'bold 11px "Segoe UI", Arial, sans-serif');
        });
    }

    /** Подпись длины под курсором — щёлкнуть и ввести новое значение. */
    function hotspot(px, py) {
        for (var i = hotspots.length - 1; i >= 0; i--) {
            var h = hotspots[i];
            var dx = px - h.cx, dy = py - h.cy;
            var along = dx * h.ux + dy * h.uy;
            var across = -dx * h.uy + dy * h.ux;
            if (Math.abs(along) <= h.hw + 3 && across >= -18 && across <= 1) return h;
        }
        return null;
    }

    function drawSprinkler(x, y, fill, stroke, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    function render() {
        if (!ctx || !App.project) return;

        var p = App.project;
        var net = App.net;
        var calc = App.calc;
        var s = p.settings;
        var L = s.labels;
        var map = nodeMap(p);
        var sel = App.selection;
        var i;

        hotspots = [];

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        syncUnderlay();
        if (!p.underlay || p.underlay.visible === false || !image) drawGrid();
        drawUnderlay(p.underlay);
        drawDxf(p.dxf);
        drawZone(p.zone);
        drawCorridor(p.corridor);

        var N = net && net.N ? net.N : {};
        var S = net && net.S ? net.S : {};

        // Круги зон орошения: у оросителя свой диаметр, иначе из исходных.
        if (L.circles) {
            ctx.strokeStyle = 'rgba(29, 111, 184, 0.35)';
            ctx.fillStyle = 'rgba(29, 111, 184, 0.06)';
            ctx.lineWidth = 1;
            p.nodes.forEach(function (n) {
                if (!n.spr) return;
                var dia = n.cover > 0 ? n.cover : s.coverDia;
                if (!(dia > 0)) return;
                ctx.beginPath();
                ctx.arc(sx(n.x), sy(n.y), dia / 2 * cam.s, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        }

        // Выделение и подсветка под сетью.
        var selectedSegs = {};
        var selectedNodes = {};

        if (sel) {
            if (sel.type === 'seg') selectedSegs[sel.id] = true;
            if (sel.type === 'node') selectedNodes[sel.id] = true;
            if (sel.type === 'branch' && sel.branch) {
                sel.branch.segs.forEach(function (id) { selectedSegs[id] = true; });
                sel.branch.nodes.forEach(function (id) { selectedNodes[id] = true; });
            }
        }

        // Путь от диктующего оросителя до ввода.
        if (net && net.ok && net.path.length > 1) {
            for (i = 0; i + 1 < net.path.length; i++) {
                segLine(map[net.path[i]], map[net.path[i + 1]], C.dictPath, 9);
            }
        }

        p.segments.forEach(function (seg) {
            var A = map[seg.a], B = map[seg.b];
            if (selectedSegs[seg.id]) segLine(A, B, 'rgba(232, 137, 43, 0.55)', 10);
            else if (App.hoverSeg === seg.id) segLine(A, B, C.hover, 10);
        });

        p.segments.forEach(function (seg) {
            var info = S[seg.id];
            var color = segColor(seg, info);
            segLine(map[seg.a], map[seg.b], color, seg.role === 'main' ? 3.4 : 2.2, seg.ring ? [11, 4] : null);
        });

        // Узлы.
        var degree = {};
        p.segments.forEach(function (seg) {
            degree[seg.a] = (degree[seg.a] || 0) + 1;
            degree[seg.b] = (degree[seg.b] || 0) + 1;
        });

        p.nodes.forEach(function (n) {
            var info = N[n.id];
            var x = sx(n.x), y = sy(n.y);

            if (selectedNodes[n.id]) {
                ctx.beginPath();
                ctx.arc(x, y, 10, 0, Math.PI * 2);
                ctx.strokeStyle = C.select;
                ctx.lineWidth = 2.5;
                ctx.stroke();
            }

            if (n.q > 0 || n.pk) {
                // На плане внутреннего пожаротушения струи крану раздал расчёт.
                var hyd = Model.hydrant(p, n, s.planKind === 'vpv' && info ? info.pkJets : undefined);
                var dictPk = net && net.dict === n.id;

                ctx.beginPath();
                ctx.arc(x, y, 8, 0, Math.PI * 2);
                ctx.fillStyle = '#FFFFFF';
                ctx.fill();
                ctx.strokeStyle = dictPk ? C.dict : C.fixed;
                ctx.lineWidth = dictPk ? 2.4 : 1.6;
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x - 5.5, y - 5.5); ctx.lineTo(x + 5.5, y + 5.5);
                ctx.moveTo(x + 5.5, y - 5.5); ctx.lineTo(x - 5.5, y + 5.5);
                ctx.stroke();

                var small = '10.5px "Segoe UI", Arial, sans-serif';

                if (hyd) {
                    text(Model.hydrantName(p, n) + (hyd.jets > 0
                        ? '  ' + hyd.jets + '×' + Fmt.trim(hyd.flow, 2) + ' л/с'
                            + (n.pk.use === true || n.pk.jets > 0 ? ' ✔' : '')
                        : n.pk.use === false ? '  не в расчёте' : ''),
                        x - 11, y + 18, { align: 'right', color: C.fixed, font: 'bold ' + small });

                    if (hyd.jets > 0 && info && info.reach && net.ok) {
                        var valve = info.H + (Model.planeElev(s) - hyd.elev);
                        text('у клапана ' + Fmt.num(valve, 2) + ' / ' + Fmt.num(hyd.head, 2) + ' м',
                            x - 11, y + 30, { align: 'right', color: valve < hyd.head - 1e-6 ? C.dict : C.fixed, font: small });
                    }
                }

                if (n.q > 0) {
                    text('+' + Fmt.trim(n.q, 2) + ' л/с', x - 11, y + (hyd ? 42 : 18), { align: 'right', color: C.fixed, font: small });
                }
            }

            if (n.src) {
                ctx.fillStyle = C.main;
                ctx.fillRect(x - 7, y - 7, 14, 14);
                text('В', x, y + 0.5, { align: 'center', baseline: 'middle', color: '#fff', font: 'bold 10px "Segoe UI", Arial, sans-serif' });
                return;
            }

            if (n.cu) {
                ctx.fillStyle = C.cu;
                ctx.fillRect(x - 10, y - 7, 20, 14);
                ctx.strokeStyle = '#1D6B31';
                ctx.lineWidth = 1;
                ctx.strokeRect(x - 10, y - 7, 20, 14);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 8.5px "Segoe UI", Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('УУ', x, y + 0.5);
                if (!n.spr) return;
            }

            if (n.spr) {
                var fill = '#FFFFFF';
                var stroke = C.closed;

                if (info && info.working) {
                    fill = net.dict === n.id ? C.dict : C.working;
                    stroke = net.dict === n.id ? '#8E1F1A' : '#0D5C44';
                } else if (info && !info.reach && (degree[n.id] || 0) > 0) {
                    stroke = C.select;
                } else if (!degree[n.id]) {
                    stroke = C.select;
                }

                drawSprinkler(x, y, fill, stroke, 5);
                return;
            }

            if ((degree[n.id] || 0) >= 3) {
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = C.text;
                ctx.fill();
            } else if ((degree[n.id] || 0) <= 1) {
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.strokeStyle = C.idle;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
        });

        // Подписи участков.
        // Цепочки нужны и на общем виде: длину магистрали правят именно там, а
        // короткие участки отсеет сама drawDims (меньше 36 px на экране).
        var dimsDrawn = L.dims && cam.s >= 1.5;
        if (cam.s >= 7) {
            p.segments.forEach(function (seg) {
                var info = S[seg.id];
                var label = segmentLabel(p, seg, info, L, dimsDrawn);
                drawSegmentLabel(map[seg.a], map[seg.b], label, info && info.active ? C.text : '#6D8295', seg.id);
            });
        }

        if (dimsDrawn) drawDims(p, map);

        // Подписи узлов: номер и напор.
        if (net && net.ok && calc && calc.ok && cam.s >= 3) {
            p.nodes.forEach(function (n) {
                var labels = calc.nodeLabels[n.id];
                var info = N[n.id];
                var x = sx(n.x), y = sy(n.y);

                if (L.nodes && labels && labels.length) {
                    text(labels.join(' / '), x + 8, y - 7, { font: 'bold 12px "Segoe UI", Arial, sans-serif' });
                }

                if (!info || !info.reach || !info.active) return;

                var lines = [];
                if (L.pressure && (info.working || (labels && labels.length))) {
                    lines.push({ t: Fmt.num(info.H, 2), c: info.working ? C.pressure : C.junctionPressure });
                }
                if (L.flow && info.working) {
                    lines.push({ t: 'q ' + Fmt.num(info.qOwn, 2), c: C.pressure });
                }

                lines.forEach(function (line, k) {
                    text(line.t, x + 8, y + 6 + k * 12, {
                        baseline: 'top',
                        color: line.c,
                        font: '11px "Segoe UI", Arial, sans-serif'
                    });
                });
            });
        }

        Tools.drawOverlay(ctx);
    }

    function savePng(name) {
        render();
        canvas.toBlob(function (blob) {
            if (blob) Zip.save(blob, (name || 'План АУПТ') + '.png', 'image/png');
        }, 'image/png');
    }

    return {
        init: init,
        resize: resize,
        scale: scale,
        sx: sx,
        sy: sy,
        toWorld: toWorld,
        zoomAt: zoomAt,
        panBy: panBy,
        reveal: reveal,
        fit: fit,
        hit: hit,
        hotspot: hotspot,
        text: text,
        render: render,
        savePng: savePng,
        colors: C,
        size: function () { return { width: width, height: height }; }
    };
})();
