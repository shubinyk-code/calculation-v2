'use strict';

/*
    Выгрузка схем в DXF.

    Формат — R12 (AC1009): он самый простой и открывается всем, от AutoCAD до
    nanoCAD и QCAD. Кириллица пишется байтами CP1251, а в заголовке ставится
    $DWGCODEPAGE = ANSI_1251 — так подписи читаются без бубна. Греческих букв
    в подписях нет: Δ, σ, α в CP1251 не живут и заменяются латиницей.

    Единицы чертежа — миллиметры, масштаб 1:1. Высота текста и размер стрелок
    считаются от габарита схемы, иначе на компенсаторе Ду500 надписи 2,5 мм
    выглядят как волос.
*/

var Dxf = (function () {

    /* ------------------------------------------------------------ кодировка */

    var EXTRA = {
        'Ё': 0xA8, 'ё': 0xB8, '«': 0xAB, '»': 0xBB, '–': 0x96, '—': 0x97, '…': 0x85,
        '№': 0xB9, '°': 0xB0, '·': 0xB7, '±': 0xB1, '“': 0x93, '”': 0x94, '„': 0x84,
        '‘': 0x91, '’': 0x92, '§': 0xA7, '©': 0xA9
    };
    var SUBST = {
        'Δ': 'D', 'δ': 'd', 'σ': 'sigma', 'α': 'alpha', 'Σ': 'S', 'μ': 'mu', 'γ': 'gamma',
        '×': 'x', '≤': '<=', '≥': '>=', '≈': '~', '∅': '%%c', '⌀': '%%c', ' ': ' '
    };

    /** Строка → байты CP1251. Неизвестные знаки заменяются латиницей. */
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
            out.push(0x3F); // «?»
        }
        return out;
    }

    /* ------------------------------------------------------------ документ */

    function Doc() {
        this.lines = [];
        this.ents = [];
        this.min = [1e18, 1e18];
        this.max = [-1e18, -1e18];
    }

    Doc.prototype.g = function (code, value) {
        this.ents.push(String(code));
        this.ents.push(String(value));
        return this;
    };

    Doc.prototype.track = function (x, y) {
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
        return this;
    };

    /** Дуга: углы в градусах, против часовой стрелки от начального к конечному. */
    Doc.prototype.arc = function (layer, cx, cy, r, a0, a1) {
        this.g(0, 'ARC').g(8, layer)
            .g(10, n(cx)).g(20, n(cy)).g(30, '0.0')
            .g(40, n(r)).g(50, n(a0)).g(51, n(a1));
        this.track(cx - r, cy - r); this.track(cx + r, cy + r);
        return this;
    };

    Doc.prototype.circle = function (layer, cx, cy, r) {
        this.g(0, 'CIRCLE').g(8, layer).g(10, n(cx)).g(20, n(cy)).g(30, '0.0').g(40, n(r));
        this.track(cx - r, cy - r); this.track(cx + r, cy + r);
        return this;
    };

    /** Залитый треугольник (стрелка размерной линии). */
    Doc.prototype.solid = function (layer, p1, p2, p3) {
        this.g(0, 'SOLID').g(8, layer)
            .g(10, n(p1[0])).g(20, n(p1[1])).g(30, '0.0')
            .g(11, n(p2[0])).g(21, n(p2[1])).g(31, '0.0')
            .g(12, n(p3[0])).g(22, n(p3[1])).g(32, '0.0')
            .g(13, n(p3[0])).g(23, n(p3[1])).g(33, '0.0');
        this.track(p1[0], p1[1]); this.track(p2[0], p2[1]); this.track(p3[0], p3[1]);
        return this;
    };

    /**
     * Текст. align: 'l' | 'c' | 'r'; rot — угол в градусах.
     * Вертикальное выравнивание — по середине строки, так проще ставить подписи.
     */
    Doc.prototype.text = function (layer, x, y, h, s, align, rot) {
        var hj = align === 'c' ? 1 : (align === 'r' ? 2 : 0);
        this.g(0, 'TEXT').g(8, layer)
            .g(10, n(x)).g(20, n(y)).g(30, '0.0')
            .g(40, n(h)).g(1, s).g(7, 'STANDARD')
            .g(50, n(rot || 0)).g(72, hj).g(73, 2)
            .g(11, n(x)).g(21, n(y)).g(31, '0.0');
        this.track(x, y);
        this.track(x + h * String(s).length * 0.7 * (hj === 0 ? 1 : 0), y + h);
        return this;
    };

    var LAYERS = [
        { name: 'ТРУБОПРОВОД', color: 5, lt: 'CONTINUOUS' },
        { name: 'ОСИ', color: 4, lt: 'DASHDOT' },
        { name: 'ОПОРЫ', color: 7, lt: 'CONTINUOUS' },
        { name: 'РАЗМЕРЫ', color: 1, lt: 'CONTINUOUS' },
        { name: 'ТЕКСТ', color: 3, lt: 'CONTINUOUS' },
        { name: 'СТРОИТ', color: 8, lt: 'CONTINUOUS' }
    ];

    function n(v) {
        if (!isFinite(v)) return '0.0';
        return (Math.round(v * 1000) / 1000).toFixed(3);
    }

    /** Собрать готовый файл: заголовок, таблицы, объекты. */
    Doc.prototype.build = function () {
        var h = [];
        function g(code, value) { h.push(String(code)); h.push(String(value)); }

        if (this.min[0] > this.max[0]) { this.min = [0, 0]; this.max = [100, 100]; }

        g(0, 'SECTION'); g(2, 'HEADER');
        g(9, '$ACADVER'); g(1, 'AC1009');
        g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1251');
        g(9, '$INSUNITS'); g(70, 4);            // миллиметры
        g(9, '$INSBASE'); g(10, '0.0'); g(20, '0.0'); g(30, '0.0');
        g(9, '$EXTMIN'); g(10, n(this.min[0])); g(20, n(this.min[1])); g(30, '0.0');
        g(9, '$EXTMAX'); g(10, n(this.max[0])); g(20, n(this.max[1])); g(30, '0.0');
        g(0, 'ENDSEC');

        g(0, 'SECTION'); g(2, 'TABLES');

        g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
        g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, '0.0');
        g(0, 'LTYPE'); g(2, 'DASHDOT'); g(70, 0); g(3, '__ . __ . __'); g(72, 65); g(73, 4); g(40, '25.0');
        g(49, '12.5'); g(49, '-4.0'); g(49, '0.0'); g(49, '-4.0');
        g(0, 'ENDTAB');

        g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length);
        for (var i = 0; i < LAYERS.length; i++) {
            g(0, 'LAYER'); g(2, LAYERS[i].name); g(70, 0); g(62, LAYERS[i].color); g(6, LAYERS[i].lt);
        }
        g(0, 'ENDTAB');

        g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
        g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, '0.0'); g(41, '1.0'); g(50, '0.0');
        g(71, 0); g(42, '2.5'); g(3, 'txt'); g(4, '');
        g(0, 'ENDTAB');

        g(0, 'ENDSEC');

        g(0, 'SECTION'); g(2, 'ENTITIES');
        var all = h.concat(this.ents);
        all.push('0'); all.push('ENDSEC');
        all.push('0'); all.push('EOF');

        // пары «код / значение», каждая — своя строка, перевод строки CRLF
        var bytes = [];
        for (var k = 0; k < all.length; k++) {
            var b = cp1251(all[k]);
            for (var m = 0; m < b.length; m++) bytes.push(b[m]);
            bytes.push(13); bytes.push(10);
        }
        return new Uint8Array(bytes);
    };

    /* ------------------------------------------------------------ вспомогательное */

    /** Стрелка: остриё в (x, y), направление (dx, dy). */
    function arrowAt(doc, x, y, dx, dy, size) {
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len; dy /= len;
        var bx = x - dx * size, by = y - dy * size;
        var px = -dy * size * 0.3, py = dx * size * 0.3;
        doc.solid('РАЗМЕРЫ', [x, y], [bx + px, by + py], [bx - px, by - py]);
    }

    /** Размерная линия с выносками и подписью. */
    function dim(doc, x1, y1, x2, y2, label, th) {
        doc.line('РАЗМЕРЫ', x1, y1, x2, y2);
        var dx = x2 - x1, dy = y2 - y1;
        var len = Math.sqrt(dx * dx + dy * dy);
        var a = th * 1.1;
        if (len > a * 3) {
            arrowAt(doc, x1, y1, -dx, -dy, a);
            arrowAt(doc, x2, y2, dx, dy, a);
        }
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var vertical = Math.abs(dy) > Math.abs(dx);
        if (vertical) doc.text('ТЕКСТ', mx - th * 0.7, my, th, label, 'c', 90);
        else doc.text('ТЕКСТ', mx, my + th * 0.8, th, label, 'c', 0);
    }

    function breakMark(doc, x, y, dx, dy, a) {
        var px = -dy, py = dx;
        doc.line('ТРУБОПРОВОД', x - dx * a * 1.8, y - dy * a * 1.8, x - dx * a * 0.4 + px * a, y - dy * a * 0.4 + py * a);
        doc.line('ТРУБОПРОВОД', x - dx * a * 0.4 + px * a, y - dy * a * 0.4 + py * a, x + dx * a * 0.4 - px * a, y + dy * a * 0.4 - py * a);
        doc.line('ТРУБОПРОВОД', x + dx * a * 0.4 - px * a, y + dy * a * 0.4 - py * a, x + dx * a * 1.8, y + dy * a * 1.8);
    }

    function fixMark(doc, x, y, a) {
        doc.line('ОПОРЫ', x - a, y - a, x + a, y + a);
        doc.line('ОПОРЫ', x - a, y + a, x + a, y - a);
    }

    function slideMark(doc, x, y, a, horizontalPipe) {
        if (horizontalPipe) {
            doc.line('ОПОРЫ', x - a, y - a, x + a, y - a);
            doc.line('ОПОРЫ', x - a * 0.7, y - a, x - a * 0.7, y - a * 1.9);
            doc.line('ОПОРЫ', x + a * 0.7, y - a, x + a * 0.7, y - a * 1.9);
        } else {
            doc.line('ОПОРЫ', x + a, y - a, x + a, y + a);
            doc.line('ОПОРЫ', x + a, y - a * 0.7, x + a * 1.9, y - a * 0.7);
            doc.line('ОПОРЫ', x + a, y + a * 0.7, x + a * 1.9, y + a * 0.7);
        }
    }

    /* ------------------------------------------------------------ узел */

    /**
     * Узел П-образного компенсатора в DXF: настоящие отрезки и дуги в
     * миллиметрах, размеры, подписи. Плоскость вертикальная — схема
     * разворачивается так, чтобы трубопровод шёл сверху вниз.
     */
    function nodeDxf(res) {
        var doc = new Doc();
        var K = 1000;                       // метры → миллиметры
        var H = res.H * K, B = res.B * K, R = res.R * K;
        var arm = Math.max(H * 0.5, R * 3);
        var axL = arm + R, axR = axL + B, xEnd = axR + R + arm;
        var vertical = (res.plane === 'v');

        var th = Math.max(xEnd / 65, 20);   // высота текста
        var aw = th * 1.1;

        // Поворот на −90° для вертикальной плоскости: (x, y) → (y, −x)
        function PX(x, y) { return vertical ? y : x; }
        function PY(x, y) { return vertical ? -x : y; }
        function A(a) { return vertical ? a - 90 : a; }

        function L(layer, x1, y1, x2, y2) { doc.line(layer, PX(x1, y1), PY(x1, y1), PX(x2, y2), PY(x2, y2)); }
        function ARC(layer, cx, cy, r, a0, a1) { doc.arc(layer, PX(cx, cy), PY(cx, cy), r, A(a0), A(a1)); }
        function T(layer, x, y, s, align, rot) { doc.text(layer, PX(x, y), PY(x, y), th, s, align, (rot || 0) + (vertical ? -90 : 0)); }

        // --- ось трубопровода
        L('ОСИ', -arm * 0.2, 0, xEnd + arm * 0.2, 0);

        // --- труба
        L('ТРУБОПРОВОД', 0, 0, axL - R, 0);
        ARC('ТРУБОПРОВОД', axL - R, R, R, 270, 360);
        L('ТРУБОПРОВОД', axL, R, axL, H - R);
        ARC('ТРУБОПРОВОД', axL + R, H - R, R, 90, 180);
        L('ТРУБОПРОВОД', axL + R, H, axR - R, H);
        ARC('ТРУБОПРОВОД', axR - R, H - R, R, 0, 90);
        L('ТРУБОПРОВОД', axR, H - R, axR, R);
        ARC('ТРУБОПРОВОД', axR + R, R, R, 180, 270);
        L('ТРУБОПРОВОД', axR + R, 0, xEnd, 0);

        // --- опоры и изломы
        var dx = vertical ? 0 : 1, dy = vertical ? -1 : 0;
        fixMark(doc, PX(0, 0), PY(0, 0), aw);
        fixMark(doc, PX(xEnd, 0), PY(xEnd, 0), aw);
        breakMark(doc, PX(arm * 0.5, 0), PY(arm * 0.5, 0), dx, dy, aw * 0.8);
        breakMark(doc, PX(xEnd - arm * 0.5, 0), PY(xEnd - arm * 0.5, 0), dx, dy, aw * 0.8);
        slideMark(doc, PX(arm * 0.8, 0), PY(arm * 0.8, 0), aw, !vertical);
        slideMark(doc, PX(xEnd - arm * 0.8, 0), PY(xEnd - arm * 0.8, 0), aw, !vertical);

        // --- размеры
        var hx = arm * 0.45;
        doc.line('РАЗМЕРЫ', PX(axL - R, 0), PY(axL - R, 0), PX(hx, 0), PY(hx, 0));
        doc.line('РАЗМЕРЫ', PX(axL - R, H), PY(axL - R, H), PX(hx, H), PY(hx, H));
        dim(doc, PX(hx, 0), PY(hx, 0), PX(hx, H), PY(hx, H), 'H = ' + U.fmt(H, 0), th);

        var by = H + Math.max(H * 0.2, R * 1.5);
        doc.line('РАЗМЕРЫ', PX(axL, H), PY(axL, H), PX(axL, by), PY(axL, by));
        doc.line('РАЗМЕРЫ', PX(axR, H), PY(axR, H), PX(axR, by), PY(axR, by));
        dim(doc, PX(axL, by), PY(axL, by), PX(axR, by), PY(axR, by), 'B = ' + U.fmt(B, 0), th);

        var ly = -Math.max(H * 0.22, R * 1.6);
        var mid = axL + B / 2;
        doc.line('РАЗМЕРЫ', PX(0, 0), PY(0, 0), PX(0, ly), PY(0, ly));
        doc.line('РАЗМЕРЫ', PX(mid, 0), PY(mid, 0), PX(mid, ly), PY(mid, ly));
        doc.line('РАЗМЕРЫ', PX(xEnd, 0), PY(xEnd, 0), PX(xEnd, ly), PY(xEnd, ly));
        dim(doc, PX(0, ly), PY(0, ly), PX(mid, ly), PY(mid, ly), 'L1 = ' + U.fmt(res.L1 * K, 0), th);
        dim(doc, PX(mid, ly), PY(mid, ly), PX(xEnd, ly), PY(xEnd, ly), 'L2 = ' + U.fmt(res.L2 * K, 0), th);

        // выноска радиуса
        var rcx = axL + R, rcy = H - R;
        var ang = 145 * Math.PI / 180;
        var rpx = rcx + R * Math.cos(ang), rpy = rcy + R * Math.sin(ang);
        var lex = rpx - arm * 0.35, ley = rpy + H * 0.12;
        doc.line('РАЗМЕРЫ', PX(rpx, rpy), PY(rpx, rpy), PX(lex, ley), PY(lex, ley));
        doc.line('РАЗМЕРЫ', PX(lex, ley), PY(lex, ley), PX(lex - arm * 0.2, ley), PY(lex - arm * 0.2, ley));
        T('ТЕКСТ', lex - arm * 0.21, ley + th * 0.8, 'R ' + U.fmt(R, 0), 'r');

        // --- подписи
        var tx = 0, ty = by + th * 3.2;
        var lines = [
            'П-ОБРАЗНЫЙ КОМПЕНСАТОР ' + U.fmt(res.sec.dOut * 1000, 1) + 'x' + U.fmt(res.sec.s * 1000, 1) +
                ', сталь ' + res.steel.name,
            'Dt = ' + U.fmt(res.dt, 0) + ' град.C; удлинение Dl = ' + U.fmt(res.dl * 1000, 1) + ' мм; ' +
                'растяжка ' + U.fmt(res.stretch * 100, 0) + '% = ' + U.fmt(res.dlStretch * 1000, 1) + ' мм',
            'Расчётное перемещение D = ' + U.fmt(res.delta * 1000, 1) + ' мм; сила упругого отпора Px = ' +
                U.fmt(res.Px / 1000, 2) + ' кН',
            'Напряжение ' + U.fmt(res.sigmaCheck, 1) + ' МПа при допускаемом ' + U.fmt(res.sigmaAdm, 0) + ' МПа' +
                (res.ok ? ' — проходит' : ' — НЕ ПРОХОДИТ'),
            'Нагрузка на неподвижную опору: концевую ' + U.fmt(res.NendCalc / 1000, 2) +
                ' кН, промежуточную ' + U.fmt(res.NmidCalc / 1000, 2) + ' кН'
        ];
        for (var i = 0; i < lines.length; i++) {
            doc.text('ТЕКСТ', vertical ? PX(0, ly) - th * 2 : 0, (vertical ? -xEnd - th * 3 : ty) - i * th * 1.6,
                th, lines[i], 'l', 0);
        }

        return doc.build();
    }

    /* ------------------------------------------------------------ стояк */

    /** Схема стояка с расстановкой опор и компенсаторов. */
    function riserDxf(res) {
        var doc = new Doc();
        var K = 1000;
        var fh = res.floorH * K;
        var floors = U.clamp(res.floors, 1, 60);
        var th = Math.max(fh / 22, 40);

        var x0 = 0;                         // ось стояка
        var slabHalf = fh * 0.55;
        var slabT = th * 0.6;

        // --- перекрытия
        for (var i = 0; i <= floors; i++) {
            var y = i * fh;
            doc.line('СТРОИТ', x0 - slabHalf, y - slabT / 2, x0 + slabHalf * 0.7, y - slabT / 2);
            doc.line('СТРОИТ', x0 - slabHalf, y + slabT / 2, x0 + slabHalf * 0.7, y + slabT / 2);
            doc.line('СТРОИТ', x0 - slabHalf, y - slabT / 2, x0 - slabHalf, y + slabT / 2);
            doc.text('ТЕКСТ', x0 - slabHalf - th * 0.5, y, th * 0.8,
                (i === 0 ? '0,000' : '+' + U.fmt(i * res.floorH, 3)), 'r', 0);
        }
        for (var fl = 1; fl <= floors; fl++) {
            doc.text('ТЕКСТ', x0 - slabHalf - th * 0.5, (fl - 0.5) * fh, th, fl + ' эт.', 'r', 0);
        }

        // --- стояк
        doc.line('ТРУБОПРОВОД', x0, -fh * 0.35, x0, floors * fh + fh * 0.35);

        // --- участки
        var bounds = [0];
        if (res.floorsPerZone > 0) {
            var lvl = 0;
            while (lvl < floors) { lvl = Math.min(lvl + res.floorsPerZone, floors); bounds.push(lvl); }
        } else { bounds.push(floors); }

        var w = fh * 0.5, hh = fh * 0.32;
        for (var z = 0; z < bounds.length - 1; z++) {
            var ym = (bounds[z] + bounds[z + 1]) / 2 * fh;
            doc.line('ТРУБОПРОВОД', x0, ym - hh / 2, x0 + w * 0.25, ym - hh / 2);
            doc.line('ТРУБОПРОВОД', x0 + w * 0.25, ym - hh / 2, x0 + w, ym - hh / 2);
            doc.line('ТРУБОПРОВОД', x0 + w, ym - hh / 2, x0 + w, ym + hh / 2);
            doc.line('ТРУБОПРОВОД', x0 + w, ym + hh / 2, x0, ym + hh / 2);
            var zoneLen = (bounds[z + 1] - bounds[z]) * res.floorH;
            var dlz = res.alpha * zoneLen * res.dt;
            doc.text('ТЕКСТ', x0 + w * 1.25, ym + th * 0.8, th * 0.9,
                'Участок ' + (z + 1) + ': ' + (bounds[z + 1] - bounds[z]) + ' эт. = ' + U.fmt(zoneLen, 2) + ' м', 'l', 0);
            doc.text('ТЕКСТ', x0 + w * 1.25, ym - th * 0.6, th * 0.8,
                'Dl = ' + U.fmt(dlz * 1000, 1) + ' мм, на компенсатор D = ' +
                U.fmt(dlz * (1 - res.stretch) * 1000, 1) + ' мм', 'l', 0);
        }

        // --- опоры
        for (var q = 0; q < bounds.length; q++) {
            var yb = bounds[q] * fh;
            var edge = (q === 0 || q === bounds.length - 1);
            fixMark(doc, x0, yb, th * 0.9);
            doc.text('ТЕКСТ', x0 + th * 1.2, yb, th * 0.9,
                (edge ? 'Н.О. концевая ' : 'Н.О. промежуточная ') +
                U.fmt((edge ? res.NendCalc : res.NmidCalc) / 1000, 2) + ' кН', 'l', 0);
        }
        var nClamp = Math.max(1, Math.round(res.floorH / res.riserStep));
        for (var fl2 = 1; fl2 <= floors; fl2++) {
            for (var c = 0; c < nClamp; c++) {
                var yy = (fl2 - 1) * fh + (c + 0.5) * (fh / nClamp);
                var near = false;
                for (var b2 = 0; b2 < bounds.length; b2++) if (Math.abs(yy - bounds[b2] * fh) < fh * 0.12) near = true;
                if (!near) slideMark(doc, x0, yy, th * 0.7, false);
            }
        }

        // --- подписи
        var top = floors * fh + fh * 1.1;
        var lines = [
            'СТОЯК: РАССТАНОВКА НЕПОДВИЖНЫХ ОПОР И П-ОБРАЗНЫХ КОМПЕНСАТОРОВ',
            floors + ' эт. x ' + U.fmt(res.floorH, 2) + ' м = ' + U.fmt(floors * res.floorH, 2) + ' м; труба ' +
                U.fmt(res.sec.dOut * 1000, 1) + 'x' + U.fmt(res.sec.s * 1000, 1) + ', сталь ' + res.steel.name,
            'Компенсатор H = ' + U.fmt(res.H * 1000, 0) + ', B = ' + U.fmt(res.B * 1000, 0) +
                ', R = ' + U.fmt(res.R * 1000, 0) + ' мм',
            'Предельная длина участка ' + U.fmt(res.Lmax, 2) + ' м; крепления стояка: ' + res.riserStepWhy
        ];
        for (var k = 0; k < lines.length; k++) {
            doc.text('ТЕКСТ', x0 - slabHalf, top + (lines.length - k) * th * 1.5, th, lines[k], 'l', 0);
        }

        return doc.build();
    }

    return { cp1251: cp1251, Doc: Doc, nodeDxf: nodeDxf, riserDxf: riserDxf };
})();
