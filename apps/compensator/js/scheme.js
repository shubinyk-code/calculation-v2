'use strict';

/*
    Динамические схемы: узел компенсатора и стояк по этажам.

    Рисуется всё через функции отображения X(x, y) и Y(x, y): модельные
    координаты в метрах → пиксели. Дуги отводов приближаются ломаной из 18
    отрезков вместо команды A — так схема одинаково верно строится и в «лежачей»
    ориентации (магистраль), и в «стоячей» (стояк), и не надо следить за флагами
    sweep. В DXF те же отводы уходят настоящими дугами, см. js/dxf.js.

    Цвета задаются атрибутами, а не классами CSS: иначе при выводе схемы в PDF
    (отрисовка SVG в canvas) переменные --ink и прочие не разрешаются и картинка
    получается чёрно-белой.
*/

var Scheme = (function () {

    var ARC_STEPS = 18;

    /* ------------------------------------------------------------ палитра */

    function readVar(name, fallback) {
        try {
            var v = getComputedStyle(document.documentElement).getPropertyValue(name);
            v = (v || '').trim();
            return v || fallback;
        } catch (e) { return fallback; }
    }

    /** mode: 'light' — фиксированная светлая палитра для печати и PDF. */
    function palette(mode) {
        if (mode === 'light') {
            return {
                ink: '#1d2733', muted: '#5d6b79', line: '#d9e0e7', panel: '#ffffff',
                panel2: '#f2f5f8', steel: '#46566a', dim: '#b0483a', water: '#2f7dd1',
                accent: '#0f8a7e', axis: '#b9c3cd', bad: '#c62f2f', good: '#1f7a4d'
            };
        }
        return {
            ink: readVar('--ink', '#1d2733'), muted: readVar('--muted', '#5d6b79'),
            line: readVar('--line', '#d9e0e7'), panel: readVar('--panel', '#ffffff'),
            panel2: readVar('--panel2', '#f7f9fb'), steel: readVar('--steel', '#46566a'),
            dim: readVar('--dim', '#b0483a'), water: readVar('--water', '#2f7dd1'),
            accent: readVar('--accent', '#0f8a7e'), axis: readVar('--axis', '#b9c3cd'),
            bad: readVar('--bad', '#c62f2f'), good: readVar('--good', '#1f7a4d')
        };
    }

    /* ------------------------------------------------------------ примитивы */

    function f(v) { return (Math.round(v * 100) / 100); }
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function Pen() { this.parts = []; }
    Pen.prototype.add = function (s) { this.parts.push(s); return this; };
    Pen.prototype.line = function (x1, y1, x2, y2, stroke, w, dash) {
        this.add('<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) +
            '" stroke="' + stroke + '" stroke-width="' + (w || 1) + '"' +
            (dash ? ' stroke-dasharray="' + dash + '"' : '') + ' stroke-linecap="round"/>');
        return this;
    };
    Pen.prototype.poly = function (pts, stroke, w, fill) {
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1]); }).join(' ');
        this.add('<path d="' + d + '" fill="' + (fill || 'none') + '" stroke="' + stroke +
            '" stroke-width="' + (w || 1) + '" stroke-linecap="round" stroke-linejoin="round"/>');
        return this;
    };
    Pen.prototype.rect = function (x, y, w, h, stroke, sw, fill) {
        this.add('<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) +
            '" fill="' + (fill || 'none') + '" stroke="' + stroke + '" stroke-width="' + (sw || 1) + '"/>');
        return this;
    };
    Pen.prototype.text = function (x, y, s, opt) {
        opt = opt || {};
        this.add('<text x="' + f(x) + '" y="' + f(y) + '"' +
            ' fill="' + (opt.fill || '#000') + '"' +
            ' font-family="system-ui, Segoe UI, Arial, sans-serif"' +
            ' font-size="' + (opt.size || 11) + '"' +
            (opt.weight ? ' font-weight="' + opt.weight + '"' : '') +
            (opt.anchor ? ' text-anchor="' + opt.anchor + '"' : '') +
            (opt.rotate ? ' transform="rotate(' + opt.rotate + ' ' + f(x) + ' ' + f(y) + ')"' : '') +
            '>' + esc(s) + '</text>');
        return this;
    };
    Pen.prototype.svg = function (w, h, bg) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f(w) + ' ' + f(h) + '"' +
            ' width="' + f(w) + '" height="' + f(h) + '">' +
            (bg ? '<rect x="0" y="0" width="' + f(w) + '" height="' + f(h) + '" fill="' + bg + '"/>' : '') +
            this.parts.join('') + '</svg>';
    };

    /** Стрелка размерной линии. */
    function arrow(pen, x, y, dx, dy, color) {
        var n = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= n; dy /= n;
        var L = 7, W = 2.4;
        var bx = x - dx * L, by = y - dy * L;
        var px = -dy * W, py = dx * W;
        pen.add('<path d="M' + f(x) + ' ' + f(y) + 'L' + f(bx + px) + ' ' + f(by + py) +
            'L' + f(bx - px) + ' ' + f(by - py) + 'Z" fill="' + color + '"/>');
    }

    /** Размерная линия со стрелками и подписью посередине. */
    function dimLine(pen, x1, y1, x2, y2, label, color, opt) {
        opt = opt || {};
        pen.line(x1, y1, x2, y2, color, 0.9);
        var dx = x2 - x1, dy = y2 - y1;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > 24) {
            arrow(pen, x1, y1, -dx, -dy, color);
            arrow(pen, x2, y2, dx, dy, color);
        }
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        if (Math.abs(dy) > Math.abs(dx)) {
            pen.text(mx - 4, my, label, { fill: color, size: opt.size || 11.5, weight: 600, anchor: 'middle', rotate: -90 });
        } else {
            pen.text(mx, my - 5, label, { fill: color, size: opt.size || 11.5, weight: 600, anchor: 'middle' });
        }
    }

    function ext(pen, x1, y1, x2, y2, color) { pen.line(x1, y1, x2, y2, color, 0.7, '3 2'); }

    /** Неподвижная опора — косой крест (ГОСТ 21.205-93). */
    function fixSupport(pen, x, y, color, size) {
        var r = size || 6;
        pen.line(x - r, y - r, x + r, y + r, color, 1.7);
        pen.line(x - r, y + r, x + r, y - r, color, 1.7);
    }

    /** Подвижная опора (скоба поперёк трубы). */
    function slideSupport(pen, x, y, color, horizontalPipe, size) {
        var r = size || 6;
        if (horizontalPipe) {
            pen.line(x - r, y + r, x + r, y + r, color, 1.4);
            pen.line(x - r * 0.7, y + r, x - r * 0.7, y + r * 1.9, color, 1.1);
            pen.line(x + r * 0.7, y + r, x + r * 0.7, y + r * 1.9, color, 1.1);
        } else {
            pen.line(x + r, y - r, x + r, y + r, color, 1.4);
            pen.line(x + r, y - r * 0.7, x + r * 1.9, y - r * 0.7, color, 1.1);
            pen.line(x + r, y + r * 0.7, x + r * 1.9, y + r * 0.7, color, 1.1);
        }
    }

    /** Излом («разрыв») на длинном прямом участке. */
    function breakMark(pen, x, y, dirX, dirY, color) {
        var px = -dirY, py = dirX, a = 5;
        pen.poly([
            [x - dirX * a * 1.8, y - dirY * a * 1.8],
            [x - dirX * a * 0.4 + px * a, y - dirY * a * 0.4 + py * a],
            [x + dirX * a * 0.4 - px * a, y + dirY * a * 0.4 - py * a],
            [x + dirX * a * 1.8, y + dirY * a * 1.8]
        ], color, 1.2);
    }

    /* ------------------------------------------------------------ ось компенсатора */

    /** Добавить точки дуги: центр (cx, cy), радиус r, углы в градусах. */
    function arcPts(pts, cx, cy, r, a0, a1) {
        for (var i = 0; i <= ARC_STEPS; i++) {
            var ang = (a0 + (a1 - a0) * (i / ARC_STEPS)) * Math.PI / 180;
            pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
        }
    }

    /**
     * Ось П-образного компенсатора в модельных координатах (метры).
     * Начало — левая опора; x вдоль трубопровода, y вдоль вылета.
     * H — вылет (до оси спинки), B — расстояние между осями вылетов,
     * R — радиус гиба, arm — рисуемая длина каждого плеча.
     */
    function loopPath(H, B, R, arm) {
        var axL = arm + R;          // ось левого вылета
        var axR = axL + B;          // ось правого вылета
        var xEnd = axR + R + arm;   // правая опора
        var pts = [];

        pts.push([0, 0]);
        pts.push([axL - R, 0]);
        arcPts(pts, axL - R, R, R, -90, 0);          // нижний левый отвод
        pts.push([axL, H - R]);
        arcPts(pts, axL + R, H - R, R, 180, 90);     // верхний левый отвод
        pts.push([axR - R, H]);
        arcPts(pts, axR - R, H - R, R, 90, 0);       // верхний правый отвод
        pts.push([axR, R]);
        arcPts(pts, axR + R, R, R, 180, 270);        // нижний правый отвод
        pts.push([xEnd, 0]);

        return { pts: pts, axL: axL, axR: axR, xEnd: xEnd, arm: arm };
    }

    /* ------------------------------------------------------------ узел */

    /**
     * Схема узла компенсатора со всеми размерами.
     * res — результат Calc.run(); opts: { mode, width, maxH }.
     */
    function node(res, opts) {
        opts = opts || {};
        var P = palette(opts.mode);
        var pen = new Pen();

        var H = res.H, B = res.B, R = res.R;
        if (!(H > 2 * R) || !(B > 2 * R) || !(R > 0)) {
            pen.text(14, 26, 'Геометрия не задана: нужны H > 2R и B > 2R.', { fill: P.bad, size: 13 });
            return pen.svg(460, 46, P.panel);
        }

        var vertical = (res.plane === 'v');
        var arm = U.clamp(Math.max(H * 0.45, B * 0.35), R * 1.8, Math.max(H, B) * 1.2);
        var path = loopPath(H, B, R, arm);

        // модельная рамка с учётом мест под размерные линии
        var yLow = -(H * 0.22 + R * 0.6);       // линия размеров L1 / L2
        var yHigh = H + (H * 0.18 + R);         // линия размера B
        var modW = path.xEnd;
        var modH = yHigh - yLow;

        var padL = 92, padR = 74, padT = 76, padB = 44;
        var boxW = opts.width || 880;
        var maxH = opts.maxH || 430;

        var sc;
        if (vertical) {
            sc = Math.min((boxW - padL - padR) / modH, maxH / modW);
        } else {
            sc = Math.min((boxW - padL - padR) / modW, maxH / modH);
        }
        if (!(sc > 0)) sc = 1;

        var drawA = modW * sc;   // вдоль оси трубопровода
        var drawB = modH * sc;   // поперёк
        var totalW = vertical ? (drawB + padL + padR) : (drawA + padL + padR);
        var totalH = vertical ? (drawA + padT + padB) : (drawB + padT + padB);

        function X(mx, my) { return vertical ? padL + (my - yLow) * sc : padL + mx * sc; }
        function Y(mx, my) { return vertical ? padT + mx * sc : padT + (yHigh - my) * sc; }
        function px(p) { return X(p[0], p[1]); }
        function py(p) { return Y(p[0], p[1]); }

        var D = P.dim;
        var dirX = vertical ? 0 : 1, dirY = vertical ? 1 : 0;

        // --- ось трубопровода
        pen.line(X(0, 0) - dirX * 16, Y(0, 0) - dirY * 16,
                 X(path.xEnd, 0) + dirX * 16, Y(path.xEnd, 0) + dirY * 16,
                 P.axis, 0.8, '10 3 2 3');

        // --- труба
        pen.poly(path.pts.map(function (p) { return [px(p), py(p)]; }), P.steel, 3.4);

        // --- опоры
        fixSupport(pen, X(0, 0), Y(0, 0), P.ink, 7);
        fixSupport(pen, X(path.xEnd, 0), Y(path.xEnd, 0), P.ink, 7);

        // --- изломы и подвижные опоры на плечах
        breakMark(pen, X(arm * 0.5, 0), Y(arm * 0.5, 0), dirX, dirY, P.steel);
        breakMark(pen, X(path.xEnd - arm * 0.5, 0), Y(path.xEnd - arm * 0.5, 0), dirX, dirY, P.steel);
        slideSupport(pen, X(arm * 0.82, 0), Y(arm * 0.82, 0), P.muted, !vertical, 7);
        slideSupport(pen, X(path.xEnd - arm * 0.82, 0), Y(path.xEnd - arm * 0.82, 0), P.muted, !vertical, 7);

        // --- стрелки перемещения концов к компенсатору
        var mv = res.delta / 2;
        (function moveArrows() {
            var off = 24;
            function draw(fromM, toM) {
                var x1 = X(fromM, 0), y1 = Y(fromM, 0);
                var x2 = X(toM, 0), y2 = Y(toM, 0);
                var ox = vertical ? off : 0, oy = vertical ? 0 : -off;
                pen.line(x1 + ox, y1 + oy, x2 + ox, y2 + oy, P.water, 1.5);
                arrow(pen, x2 + ox, y2 + oy, x2 - x1, y2 - y1, P.water);
                var tx = vertical ? x2 + ox + 7 : (x1 + x2) / 2;
                var ty = vertical ? (y1 + y2) / 2 : y2 + oy - 6;
                pen.text(tx, ty, U.fmt(mv * 1000, 1) + ' мм',
                    { fill: P.water, size: 10.5, anchor: vertical ? 'start' : 'middle' });
            }
            draw(arm * 0.12, arm * 0.46);
            draw(path.xEnd - arm * 0.12, path.xEnd - arm * 0.46);
        })();

        // ======================= размеры =======================

        // вылет H
        var hx = arm * 0.52;
        ext(pen, X(path.axL - R, 0), Y(path.axL - R, 0), X(hx, 0), Y(hx, 0), D);
        ext(pen, X(path.axL - R, H), Y(path.axL - R, H), X(hx, H), Y(hx, H), D);
        dimLine(pen, X(hx, 0), Y(hx, 0), X(hx, H), Y(hx, H), 'H = ' + U.fmt(H * 1000, 0), D);

        // спинка B
        ext(pen, X(path.axL, H), Y(path.axL, H), X(path.axL, yHigh), Y(path.axL, yHigh), D);
        ext(pen, X(path.axR, H), Y(path.axR, H), X(path.axR, yHigh), Y(path.axR, yHigh), D);
        dimLine(pen, X(path.axL, yHigh), Y(path.axL, yHigh), X(path.axR, yHigh), Y(path.axR, yHigh),
            'B = ' + U.fmt(B * 1000, 0), D);

        // радиус гиба — выноска к верхнему левому отводу
        (function radiusLeader() {
            var cx = path.axL + R, cy = H - R;
            var ang = 145 * Math.PI / 180;
            var rx = cx + R * Math.cos(ang), ry = cy + R * Math.sin(ang);
            var sx = X(rx, ry), sy = Y(rx, ry);
            var ex = sx + (vertical ? 34 : -30), ey = sy + (vertical ? -26 : -26);
            pen.line(sx, sy, ex, ey, D, 0.9);
            pen.line(ex, ey, ex + (vertical ? 26 : -26), ey, D, 0.9);
            pen.text(ex + (vertical ? 28 : -28), ey - 3, 'R ' + U.fmt(R * 1000, 0),
                { fill: D, size: 11, weight: 600, anchor: vertical ? 'start' : 'end' });
        })();

        // плечи L1 и L2
        ext(pen, X(0, 0), Y(0, 0), X(0, yLow), Y(0, yLow), D);
        ext(pen, X(path.axL + B / 2, 0), Y(path.axL + B / 2, 0), X(path.axL + B / 2, yLow), Y(path.axL + B / 2, yLow), D);
        ext(pen, X(path.xEnd, 0), Y(path.xEnd, 0), X(path.xEnd, yLow), Y(path.xEnd, yLow), D);
        var mid = path.axL + B / 2;
        dimLine(pen, X(0, yLow), Y(0, yLow), X(mid, yLow), Y(mid, yLow),
            'L1 = ' + U.fmt(res.L1, 2) + ' м', D, { size: 11 });
        dimLine(pen, X(mid, yLow), Y(mid, yLow), X(path.xEnd, yLow), Y(path.xEnd, yLow),
            'L2 = ' + U.fmt(res.L2, 2) + ' м', D, { size: 11 });

        // ось симметрии
        pen.line(X(mid, yLow - H * 0.02), Y(mid, yLow - H * 0.02), X(mid, yHigh), Y(mid, yHigh), P.axis, 0.8, '9 3 2 3');

        // ======================= подписи =======================
        pen.text(10, 20, 'Узел П-образного компенсатора  ' +
            U.fmt(res.sec.dOut * 1000, 1) + '×' + U.fmt(res.sec.s * 1000, 1) + '  ' + res.steel.name,
            { fill: P.ink, size: 13, weight: 600 });
        pen.text(10, 37, 'Δt = ' + U.fmt(res.dt, 0) + ' °C · Δl = ' + U.fmt(res.dl * 1000, 1) + ' мм · растяжка ' +
            U.fmt(res.stretch * 100, 0) + ' % (' + U.fmt(res.dlStretch * 1000, 1) + ' мм) · Δ = ' +
            U.fmt(res.delta * 1000, 1) + ' мм', { fill: P.muted, size: 11 });
        pen.text(10, 53, 'Px = ' + U.fmt(res.Px / 1000, 2) + ' кН · Mmax = ' + U.fmt(res.Mmax / 1000, 2) +
            ' кН·м · σ = ' + U.fmt(res.sigmaCheck, 1) + ' МПа при [σ] = ' + U.fmt(res.sigmaAdm, 0) + ' МПа',
            { fill: res.ok ? P.good : P.bad, size: 11, weight: 600 });

        // подпись внизу слева, легенда — строкой выше справа: иначе длинная
        // подпись наезжает на легенду
        pen.text(10, totalH - 10, vertical
            ? 'Плоскость компенсатора вертикальная (стояк); вылет направлен от стены.'
            : 'Плоскость компенсатора горизонтальная. Растяжку выполнять при монтаже до закрепления неподвижных опор.',
            { fill: P.muted, size: 10.5 });
        pen.text(totalW - 8, totalH - 26, '× — неподвижная опора,  скоба — подвижная опора',
            { fill: P.muted, size: 10, anchor: 'end' });

        return pen.svg(totalW, totalH, P.panel);
    }

    /* ------------------------------------------------------------ стояк */

    /** Значок П-образного компенсатора на вертикальном стояке. */
    function loopSymbol(pen, x, y, P) {
        var w = 56, h = 34;
        pen.poly([
            [x, y + h / 2], [x + w, y + h / 2], [x + w, y - h / 2], [x, y - h / 2]
        ], P.accent, 2.8);
        pen.text(x + w + 6, y + 4, 'П', { fill: P.accent, size: 11.5, weight: 600 });
    }

    /** Схема стояка по этажам с расстановкой неподвижных опор и компенсаторов. */
    function riser(res, opts) {
        opts = opts || {};
        var P = palette(opts.mode);
        var pen = new Pen();

        var floors = U.clamp(res.floors, 1, 60);
        var fh = res.floorH;
        var perZone = res.floorsPerZone;

        var rowH = U.clamp(opts.rowH || 52, 26, 90);
        var padT = 66, padB = 50, padL = 112, padR = 300;
        var totalH = padT + padB + floors * rowH;
        var totalW = padL + padR + 150;
        var pipeX = padL + 58;

        // перекрытие обрывается сразу за стояком, чтобы значок компенсатора
        // выходил за его край, а не тонул в штриховке
        var slabL = padL - 44, slabR = pipeX + 18;

        function yOfLevel(level) { return padT + (floors - level) * rowH; }

        // --- перекрытия
        for (var i = 0; i <= floors; i++) {
            var y = yOfLevel(i);
            pen.rect(slabL, y - 5, slabR - slabL, 10, P.axis, 0.8, P.panel2);
            for (var hx = slabL + 2; hx < slabR - 4; hx += 9) {
                pen.line(hx, y + 5, hx + 5, y - 5, P.axis, 0.5);
            }
            pen.text(padL - 50, y + 3, (i === 0 ? '0,000' : '+' + U.fmt(i * fh, 3)),
                { fill: P.muted, size: 9.5, anchor: 'end' });
        }

        // --- подписи этажей
        for (var fl = 1; fl <= floors; fl++) {
            var yc = (yOfLevel(fl) + yOfLevel(fl - 1)) / 2;
            pen.text(padL - 50, yc + 4, fl + ' эт.', { fill: P.ink, size: 11, anchor: 'end', weight: 600 });
        }

        // --- стояк
        pen.line(pipeX, yOfLevel(floors) - 24, pipeX, yOfLevel(0) + 24, P.steel, 3.4);

        // --- границы компенсирующих участков
        var bounds = [0];
        if (perZone > 0) {
            var lvl = 0;
            while (lvl < floors) { lvl = Math.min(lvl + perZone, floors); bounds.push(lvl); }
        } else {
            bounds.push(floors);
        }

        // --- компенсаторы
        var loopY = [];
        for (var z = 0; z < bounds.length - 1; z++) {
            var a = bounds[z], b = bounds[z + 1];
            var ym = (yOfLevel(a) + yOfLevel(b)) / 2;
            loopY.push(ym);
            loopSymbol(pen, pipeX, ym, P);
            var zoneLen = (b - a) * fh;
            var dlz = res.alpha * zoneLen * res.dt;
            pen.text(pipeX + 96, ym - 5, 'Участок ' + (z + 1) + ': ' + (b - a) + ' эт. = ' + U.fmt(zoneLen, 2) + ' м',
                { fill: P.ink, size: 10.5 });
            pen.text(pipeX + 96, ym + 9, 'Δl = ' + U.fmt(dlz * 1000, 1) + ' мм → на компенсатор Δ = ' +
                U.fmt(dlz * (1 - res.stretch) * 1000, 1) + ' мм', { fill: P.muted, size: 10 });
        }

        // --- неподвижные опоры: крайние нагружены суммой сил, промежуточные — разностью
        for (var q = 0; q < bounds.length; q++) {
            var yb = yOfLevel(bounds[q]);
            var edge = (q === 0 || q === bounds.length - 1);
            var load = edge ? res.NendCalc : res.NmidCalc;
            fixSupport(pen, pipeX, yb, P.ink, 8);
            pen.text(pipeX + 14, yb - 5, edge ? 'Н.О. концевая' : 'Н.О. промежуточная',
                { fill: P.ink, size: 10, weight: 600 });
            pen.text(pipeX + 14, yb + 8, U.fmt(load / 1000, 2) + ' кН', { fill: P.dim, size: 9.5 });
        }

        // --- подвижные крепления (мимо опор и мимо самого компенсатора)
        var nClamp = Math.max(1, Math.round(fh / res.riserStep));
        for (var fl2 = 1; fl2 <= floors; fl2++) {
            for (var c = 0; c < nClamp; c++) {
                var yy = yOfLevel(fl2 - 1) - (c + 0.5) * (rowH / nClamp);
                var near = false;
                for (var w2 = 0; w2 < bounds.length; w2++) if (Math.abs(yy - yOfLevel(bounds[w2])) < 12) near = true;
                for (var w3 = 0; w3 < loopY.length; w3++) if (Math.abs(yy - loopY[w3]) < 22) near = true;
                if (!near) slideSupport(pen, pipeX, yy, P.muted, false, 6);
            }
        }

        // --- заголовок
        pen.text(10, 20, 'Стояк: расстановка неподвижных опор и компенсаторов', { fill: P.ink, size: 13, weight: 600 });
        pen.text(10, 37, floors + ' эт. × ' + U.fmt(fh, 2) + ' м = ' + U.fmt(floors * fh, 2) + ' м; труба ' +
            U.fmt(res.sec.dOut * 1000, 1) + '×' + U.fmt(res.sec.s * 1000, 1) + ', ' + res.steel.name,
            { fill: P.muted, size: 11 });
        pen.text(10, 52, perZone > 0
            ? ('Предельная длина компенсируемого участка — ' + U.fmt(res.Lmax, 2) + ' м, это ' + perZone + ' эт.; принято участков: ' + (bounds.length - 1))
            : 'Принятый компенсатор не держит даже один этаж: увеличьте вылет H или спинку B.',
            { fill: perZone > 0 ? P.good : P.bad, size: 11 });

        pen.text(totalW - 8, totalH - 26, '× — неподвижная опора, скоба — крепление (подвижное)',
            { fill: P.muted, size: 10, anchor: 'end' });
        pen.text(totalW - 8, totalH - 12, 'Шаг креплений: ' + res.riserStepWhy + ' — СП 73.13330.2016 п. 6.1.9',
            { fill: P.muted, size: 10, anchor: 'end' });

        return pen.svg(totalW, totalH, P.panel);
    }

    return {
        palette: palette, node: node, riser: riser,
        Pen: Pen, loopPath: loopPath, arrow: arrow, fixSupport: fixSupport, arcPts: arcPts
    };
})();
