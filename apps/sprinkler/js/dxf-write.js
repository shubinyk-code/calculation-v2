'use strict';

/*
    Запись DXF — чертёж для AutoCAD.

    Пишем версию R12: в ней нет дескрипторов объектов, таблицы записей блоков
    и раздела OBJECTS, поэтому файл невозможно собрать «почти правильно» — он
    либо верный, либо сразу видно, что не так. AutoCAD 2018 читает такой файл
    без разговоров, а всё, что нужно принципиальной схеме (слои, веса линий,
    блоки с атрибутами, текст), в R12 есть.

    Цвет в R12 — только по индексу AutoCAD (ACI). Поэтому канонные цвета
    систем переводятся в ближайший индекс по таблице ACI, которая лежит ниже;
    точный оттенок при этом может чуть сдвинуться, зато файл открывается
    везде. Там, где важен ровно тот цвет, его правят в свойствах слоя.

    Кириллица пишется байтами cp1251, а в заголовке стоит $DWGCODEPAGE =
    ANSI_1251 — так подписи читаются в русском AutoCAD без «кракозябр».
*/

var DxfWrite = (function () {

    /*
        Таблица индексов AutoCAD: первые девять цветов, серая шкала и 24 тона
        цветового круга в пяти яркостях. Этого достаточно, чтобы подобрать
        ближайший индекс к любому цвету канона; полная таблица из 255 цветов
        для подбора ничего не добавит, а ошибиться в ней легко.
    */
    function aciTable() {
        var out = [
            { i: 1, rgb: [255, 0, 0] }, { i: 2, rgb: [255, 255, 0] }, { i: 3, rgb: [0, 255, 0] },
            { i: 4, rgb: [0, 255, 255] }, { i: 5, rgb: [0, 0, 255] }, { i: 6, rgb: [255, 0, 255] },
            { i: 7, rgb: [0, 0, 0] }, { i: 8, rgb: [128, 128, 128] }, { i: 9, rgb: [192, 192, 192] },
            { i: 250, rgb: [51, 51, 51] }, { i: 251, rgb: [91, 91, 91] }, { i: 252, rgb: [132, 132, 132] },
            { i: 253, rgb: [173, 173, 173] }, { i: 254, rgb: [214, 214, 214] }
        ];

        // Круг: индекс 10 + 10·группа — чистый тон, дальше затемнения.
        var shades = [1, 0.75, 0.55, 0.4, 0.25];
        for (var g = 0; g < 24; g++) {
            var hue = g * 15;
            for (var s = 0; s < shades.length; s++) {
                out.push({ i: 10 + g * 10 + s * 2, rgb: hsv(hue, 1, shades[s]) });
            }
        }
        return out;
    }

    function hsv(h, s, v) {
        var c = v * s;
        var x = c * (1 - Math.abs((h / 60) % 2 - 1));
        var m = v - c;
        var r = 0, g = 0, b = 0;

        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }

        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }

    var ACI = aciTable();

    function rgbOf(color) {
        var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color || ''));
        if (!m) return [0, 0, 0];
        return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    }

    /** Ближайший индекс AutoCAD к цвету #RRGGBB. */
    function aci(color) {
        var c = rgbOf(color);
        var best = 7;
        var bestD = Infinity;

        ACI.forEach(function (item) {
            var dr = item.rgb[0] - c[0], dg = item.rgb[1] - c[1], db = item.rgb[2] - c[2];
            // Веса как у глаза: зелёный заметнее красного, синий — слабее всех.
            var d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
            if (d < bestD) { bestD = d; best = item.i; }
        });

        return best;
    }

    /* --- сборка файла -------------------------------------------------------- */

    function Writer() {
        this.out = [];
    }

    Writer.prototype.pair = function (code, value) {
        this.out.push(String(code), String(value));
        return this;
    };

    Writer.prototype.num = function (code, value) {
        var v = Math.round(Number(value) * 1000) / 1000;
        return this.pair(code, isFinite(v) ? v : 0);
    };

    Writer.prototype.text = function () {
        return this.out.join('\r\n') + '\r\n';
    };

    /* --- примитивы ----------------------------------------------------------- */

    /*
        Общие коды сущности: слой и цвет. Внутри блока геометрия идёт на слое 0
        цветом «по блоку» (код 62 = 0) — тогда вставка на слой системы красит
        знак в цвет системы, и отдельный блок на каждый цвет не нужен.
    */
    function head(w, type, layer, color) {
        w.pair(0, type).pair(8, layer || '0');
        if (color !== undefined && color !== null) w.pair(62, color);
    }

    function entity(w, e, layer, color) {
        if (e.t === 'l') {
            head(w, 'LINE', layer, color);
            w.num(10, e.x1).num(20, e.y1).num(30, 0).num(11, e.x2).num(21, e.y2).num(31, 0);
        } else if (e.t === 'pl') {
            head(w, 'POLYLINE', layer, color);
            w.pair(66, 1).num(10, 0).num(20, 0).num(30, 0).pair(70, e.closed ? 1 : 0);
            for (var i = 0; i < e.v.length; i += 2) {
                head(w, 'VERTEX', layer, color);
                w.num(10, e.v[i]).num(20, e.v[i + 1]).num(30, 0);
            }
            w.pair(0, 'SEQEND').pair(8, layer || '0');
        } else if (e.t === 'c') {
            head(w, 'CIRCLE', layer, color);
            w.num(10, e.x).num(20, e.y).num(30, 0).num(40, e.r);
        } else if (e.t === 'a') {
            head(w, 'ARC', layer, color);
            w.num(10, e.x).num(20, e.y).num(30, 0).num(40, e.r).num(50, e.a0).num(51, e.a1);
        } else if (e.t === 's') {
            // Закраска: у SOLID четвёртая точка повторяет третью для треугольника.
            head(w, 'SOLID', layer, color);
            var v = e.v.slice();
            if (v.length === 6) v = v.concat([v[4], v[5]]);
            w.num(10, v[0]).num(20, v[1]).num(30, 0);
            w.num(11, v[2]).num(21, v[3]).num(31, 0);
            // Третья и четвёртая точки SOLID идут крест-накрест — иначе «бабочка».
            w.num(12, v[6]).num(22, v[7]).num(32, 0);
            w.num(13, v[4]).num(23, v[5]).num(33, 0);
        } else if (e.t === 'txt') {
            head(w, 'TEXT', layer, color);
            w.num(10, e.x).num(20, e.y).num(30, 0).num(40, e.h || 250).pair(1, e.s === undefined ? '' : e.s);
            w.pair(7, e.style || 'ГОСТ');
            if (e.rot) w.num(50, e.rot);
            var align = e.align === 'left' ? 0 : e.align === 'right' ? 2 : 1;
            if (align || e.middle) {
                w.pair(72, align).pair(73, e.middle ? 2 : 0);
                w.num(11, e.x).num(21, e.y).num(31, 0);
            }
        } else if (e.t === 'ins') {
            insert(w, e, layer, color);
        }
    }

    /** Вставка блока; если у блока есть атрибуты, за ней идут их значения. */
    function insert(w, e, layer, color) {
        var values = e.attrs || {};
        var block = Canon.block(e.name);
        var defs = (block && block.attrs) || [];
        var filled = defs.filter(function (a) { return values[a.tag] !== undefined && values[a.tag] !== ''; });
        var scale = e.scale === undefined ? Canon.BLOCK_SCALE : e.scale;

        head(w, 'INSERT', layer, color);
        if (filled.length) w.pair(66, 1);
        w.pair(2, e.name).num(10, e.x).num(20, e.y).num(30, 0);
        w.num(41, scale).num(42, scale).num(43, scale);
        if (e.rot) w.num(50, e.rot);

        filled.forEach(function (a) {
            head(w, 'ATTRIB', layer, color);
            w.num(10, e.x + a.x * scale).num(20, e.y + a.y * scale).num(30, 0);
            w.num(40, a.h * scale).pair(1, String(values[a.tag]));
            w.pair(7, 'ГОСТ').pair(2, a.tag).pair(70, 0);
            var align = a.align === 'left' ? 0 : a.align === 'right' ? 2 : 1;
            w.pair(72, align).pair(73, 2);
            w.num(11, e.x + a.x * scale).num(21, e.y + a.y * scale).num(31, 0);
        });

        if (filled.length) w.pair(0, 'SEQEND').pair(8, layer || '0');
    }

    /* --- разделы ------------------------------------------------------------- */

    function header(w, box) {
        w.pair(0, 'SECTION').pair(2, 'HEADER');
        w.pair(9, '$ACADVER').pair(1, 'AC1009');
        w.pair(9, '$DWGCODEPAGE').pair(3, 'ANSI_1251');
        w.pair(9, '$INSUNITS').pair(70, 4);
        w.pair(9, '$LTSCALE').num(40, 100);
        w.pair(9, '$TEXTSTYLE').pair(7, 'ГОСТ');
        w.pair(9, '$EXTMIN').num(10, box.x0).num(20, box.y0);
        w.pair(9, '$EXTMAX').num(10, box.x1).num(20, box.y1);
        w.pair(0, 'ENDSEC');
    }

    function tables(w, layers, blocks) {
        w.pair(0, 'SECTION').pair(2, 'TABLES');

        // Типы линий.
        w.pair(0, 'TABLE').pair(2, 'LTYPE').pair(70, 2);
        w.pair(0, 'LTYPE').pair(2, 'CONTINUOUS').pair(70, 0).pair(3, 'Сплошная').pair(72, 65).pair(73, 0).num(40, 0);
        w.pair(0, 'LTYPE').pair(2, 'DASHED').pair(70, 0).pair(3, 'Штриховая ___ ___').pair(72, 65).pair(73, 2)
            .num(40, 1500).num(49, 1000).num(49, -500);
        w.pair(0, 'ENDTAB');

        // Слои.
        w.pair(0, 'TABLE').pair(2, 'LAYER').pair(70, layers.length);
        layers.forEach(function (l) {
            w.pair(0, 'LAYER').pair(2, l.name).pair(70, 0).pair(62, aci(l.color))
                .pair(6, l.linetype || 'CONTINUOUS').pair(370, l.weight === undefined ? 25 : l.weight);
        });
        w.pair(0, 'ENDTAB');

        // Текстовый стиль: чертёжный шрифт, который есть в любом AutoCAD.
        w.pair(0, 'TABLE').pair(2, 'STYLE').pair(70, 1);
        w.pair(0, 'STYLE').pair(2, 'ГОСТ').pair(70, 0).num(40, 0).num(41, 0.8).num(50, 15)
            .pair(71, 0).num(42, 250).pair(3, 'isocpeur.ttf').pair(4, '');
        w.pair(0, 'ENDTAB');

        w.pair(0, 'ENDSEC');
    }

    function blocksSection(w, blocks) {
        w.pair(0, 'SECTION').pair(2, 'BLOCKS');

        blocks.forEach(function (b) {
            w.pair(0, 'BLOCK').pair(8, '0').pair(2, b.name).pair(70, (b.attrs || []).length ? 2 : 0)
                .num(10, 0).num(20, 0).num(30, 0).pair(3, b.name).pair(1, '');

            (b.ents || []).forEach(function (e) { entity(w, e, '0', 0); });

            (b.attrs || []).forEach(function (a) {
                w.pair(0, 'ATTDEF').pair(8, '0').pair(62, 0);
                w.num(10, a.x).num(20, a.y).num(30, 0).num(40, a.h);
                w.pair(1, a.value || '').pair(3, a.tag).pair(2, a.tag).pair(70, 0);
                w.pair(7, 'ГОСТ');
                var align = a.align === 'left' ? 0 : a.align === 'right' ? 2 : 1;
                w.pair(72, align).pair(73, 2);
                w.num(11, a.x).num(21, a.y).num(31, 0);
            });

            w.pair(0, 'ENDBLK').pair(8, '0');
        });

        w.pair(0, 'ENDSEC');
    }

    function entitiesSection(w, items) {
        w.pair(0, 'SECTION').pair(2, 'ENTITIES');
        items.forEach(function (e) { entity(w, e, e.layer || '0', e.color); });
        w.pair(0, 'ENDSEC');
    }

    /**
     * Собрать файл: слои, блоки и сущности. Сущности — те же примитивы, что
     * и в каноне, плюс вставка { t: 'ins', name, x, y, attrs }.
     */
    function build(opts) {
        var layers = opts.layers || Canon.layers(null);
        var blocks = opts.blocks || Canon.BLOCKS;
        var items = opts.entities || [];
        var w = new Writer();

        header(w, opts.box || bounds(items));
        tables(w, layers, blocks);
        blocksSection(w, blocks);
        entitiesSection(w, items);
        w.pair(0, 'EOF');

        return w.text();
    }

    function bounds(items) {
        var box = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
        var any = false;

        items.forEach(function (e) {
            var pts = [];
            if (e.t === 'l') pts = [e.x1, e.y1, e.x2, e.y2];
            else if (e.t === 'pl' || e.t === 's') pts = e.v;
            else if (e.t === 'c' || e.t === 'a') pts = [e.x - e.r, e.y - e.r, e.x + e.r, e.y + e.r];
            else if (e.x !== undefined) pts = [e.x, e.y];

            for (var i = 0; i < pts.length; i += 2) {
                if (!any) { box = { x0: pts[i], y0: pts[i + 1], x1: pts[i], y1: pts[i + 1] }; any = true; }
                box.x0 = Math.min(box.x0, pts[i]); box.y0 = Math.min(box.y0, pts[i + 1]);
                box.x1 = Math.max(box.x1, pts[i]); box.y1 = Math.max(box.y1, pts[i + 1]);
            }
        });

        return box;
    }

    /* --- cp1251 -------------------------------------------------------------- */

    /*
        В cp1251 кириллица лежит подряд: А…я — это 0xC0…0xFF, а ё и Ё стоят
        отдельно. Остальные буквы и знаки совпадают с ASCII, поэтому таблица
        нужна короткая.
    */
    function cp1251(text) {
        var out = new Uint8Array(text.length * 2);
        var n = 0;

        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            var byte;

            if (c < 128) byte = c;
            else if (c >= 0x410 && c <= 0x44F) byte = c - 0x410 + 0xC0;
            else if (c === 0x401) byte = 0xA8;
            else if (c === 0x451) byte = 0xB8;
            else if (c === 0x2116) byte = 0xB9;          // №
            else if (c === 0x00B0) byte = 0xB0;          // °
            else if (c === 0x00AB) byte = 0xAB;          // «
            else if (c === 0x00BB) byte = 0xBB;          // »
            else if (c === 0x2014 || c === 0x2013) byte = 0x97;
            else if (c === 0x00D8 || c === 0x2300) byte = 0x4F;   // Ø → O
            else if (c === 0x00B2) byte = 0x32;          // ² → 2
            else if (c === 0x00B3) byte = 0x33;
            else byte = 0x3F;                            // всё прочее — знак вопроса

            out[n++] = byte;
        }

        return out.subarray(0, n);
    }

    /** Сохранить файл на диск браузером. */
    function save(text, name) {
        var blob = new Blob([cp1251(text)], { type: 'application/dxf' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');

        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    return {
        build: build,
        save: save,
        aci: aci,
        cp1251: cp1251,
        bounds: bounds
    };
})();
