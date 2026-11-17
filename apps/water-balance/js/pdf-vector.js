/*
    Векторный PDF без библиотек.

    Линии, контуры и заливки пишутся в PDF настоящими векторами: масштабируются
    без потери качества, толщина линии остаётся ровной при любом увеличении.

    Текст — кириллица, а стандартные шрифты PDF её не содержат, поэтому шрифт
    собирается на лету: каждая использованная буква один раз рисуется на canvas
    крупно (160 px на кегль) и кладётся в шрифт Type 3 как одноцветная маска.
    Получается встроенный шрифт — файл открывается везде, текст выделяется и
    ищется (есть таблица ToUnicode), буквы остаются чёткими при увеличении
    в десятки раз.

    Единицы страницы — миллиметры, начало слева внизу, ось y вверх (как у PDF).
    Если вашей системе координат нужна другая (ось вниз, масштаб) — задайте её
    через cm(); текст сам не зеркалится, ему передаётся матрица.

    Использование:
        var pdf = PdfVec.create('Название');
        var pg = pdf.page(420, 297);
        pg.strokeColor('#1030d0'); pg.lineWidth(0.3); pg.moveTo(10, 10); pg.lineTo(100, 50); pg.stroke();
        pg.text('Привет', [1, 0, 0, 1, 20, 20], 5, '#000000');
        pdf.bytes().then(function (u8) { … });
*/

var PdfVec = (function () {
    'use strict';

    var EM = 160;                 // px на кегль при рисовании буквы
    var THRESHOLD = 110;          // порог яркости маски 0…255
    var PT = 72 / 25.4;

    var scratch = null;

    function scratchCtx() {
        if (!scratch) {
            scratch = document.createElement('canvas');
            scratch.width = EM * 3;
            scratch.height = EM * 3;
        }
        return scratch.getContext('2d', { willReadFrequently: true });
    }

    function num(v) {
        if (!isFinite(v)) return '0';
        var s = (Math.round(v * 10000) / 10000).toString();
        return s.indexOf('e') >= 0 ? '0' : s;
    }

    function strBytes(s) {
        var a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xFF;
        return a;
    }

    function hexUtf16(s) {
        var out = 'FEFF';
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i).toString(16).toUpperCase();
            while (c.length < 4) c = '0' + c;
            out += c;
        }
        return '<' + out + '>';
    }

    /* Цвет: «#rrggbb», «#rgb», «rgb(...)», «rgba(...)» → «r g b» в долях единицы. */
    function rgb(color) {
        var c = String(color || '#000000').trim();
        var r = 0, g = 0, b = 0, m;

        if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
            r = parseInt(m[1].charAt(0) + m[1].charAt(0), 16);
            g = parseInt(m[1].charAt(1) + m[1].charAt(1), 16);
            b = parseInt(m[1].charAt(2) + m[1].charAt(2), 16);
        } else if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
            r = parseInt(m[1].slice(0, 2), 16);
            g = parseInt(m[1].slice(2, 4), 16);
            b = parseInt(m[1].slice(4, 6), 16);
        } else if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c))) {
            r = +m[1]; g = +m[2]; b = +m[3];
        }

        return num(r / 255) + ' ' + num(g / 255) + ' ' + num(b / 255);
    }

    /* --- шрифт из букв ------------------------------------------------------------ */

    /*
        Шрифт одного начертания (семейство + жирность). Букв может оказаться больше 255,
        а в простом шрифте код — один байт, поэтому буквы раскладываются по «банкам».
    */
    function Font(doc, index, family, bold) {
        this.doc = doc;
        this.index = index;
        this.family = family;
        this.bold = bold;
        this.glyphs = {};
        this.banks = [];
    }

    Font.prototype.cssFont = function () {
        return (this.bold ? 'bold ' : '') + EM + 'px ' + this.family;
    };

    Font.prototype.glyph = function (ch) {
        var g = this.glyphs[ch];
        if (g) return g;

        var ctx = scratchCtx();
        ctx.font = this.cssFont();
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        var adv = ctx.measureText(ch).width;

        g = { ch: ch, adv: adv, bank: 0, code: 0, bits: null, w: 0, h: 0, ox: 0, oy: 0 };

        // рисуем на листе с запасом и обрезаем по краске
        var W = scratch.width;
        var H = scratch.height;
        var bx = EM;                   // начало буквы по x
        var by = EM * 2;               // базовая линия по y
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#000';
        ctx.fillText(ch, bx, by);

        var data = ctx.getImageData(0, 0, W, H).data;
        var x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                if (data[(y * W + x) * 4 + 3] >= THRESHOLD) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }

        if (x1 >= 0) {
            var w = x1 - x0 + 1;
            var h = y1 - y0 + 1;
            var stride = Math.ceil(w / 8);
            var bits = new Uint8Array(stride * h);
            bits.fill(0xFF);                       // 1 — прозрачно, 0 — краска
            for (var yy = 0; yy < h; yy++) {
                for (var xx = 0; xx < w; xx++) {
                    if (data[((y0 + yy) * W + (x0 + xx)) * 4 + 3] >= THRESHOLD) {
                        bits[yy * stride + (xx >> 3)] &= ~(0x80 >> (xx & 7));
                    }
                }
            }
            g.bits = bits;
            g.w = w;
            g.h = h;
            g.ox = bx - x0;                        // сколько пикселей слева от начала буквы
            g.oy = by - y0;                        // сколько пикселей выше базовой линии
        }

        // место в банке
        var bank = this.banks.length ? this.banks[this.banks.length - 1] : null;
        if (!bank || bank.list.length >= 250) {
            bank = { list: [] };
            this.banks.push(bank);
        }
        g.bank = this.banks.length - 1;
        g.code = bank.list.length + 1;             // код 0 не берём
        bank.list.push(g);

        this.glyphs[ch] = g;
        return g;
    };

    Font.prototype.name = function (bank) { return 'F' + this.index + '_' + bank; };

    /* Ширина строки при кегле size (в единицах страницы). */
    Font.prototype.width = function (text, size) {
        var w = 0;
        for (var i = 0; i < text.length; i++) w += this.glyph(text.charAt(i)).adv;
        return w / EM * size;
    };

    /* --- страница ----------------------------------------------------------------- */

    function Page(doc, wMm, hMm) {
        this.doc = doc;
        this.w = wMm;
        this.h = hMm;
        this.ops = [num(PT) + ' 0 0 ' + num(PT) + ' 0 0 cm'];      // дальше единицы — миллиметры
        this.gs = {};                                              // прозрачности
        this.depth = 0;
    }

    Page.prototype.op = function (s) { this.ops.push(s); return this; };

    Page.prototype.save = function () { this.depth++; return this.op('q'); };
    Page.prototype.restore = function () { this.depth--; return this.op('Q'); };
    Page.prototype.cm = function (a, b, c, d, e, f) { return this.op([a, b, c, d, e, f].map(num).join(' ') + ' cm'); };

    Page.prototype.lineWidth = function (w) { return this.op(num(w) + ' w'); };
    Page.prototype.cap = function (n) { return this.op(n + ' J'); };      // 0 — плоский, 1 — круглый, 2 — квадратный
    Page.prototype.join = function (n) { return this.op(n + ' j'); };
    Page.prototype.dash = function (list, phase) {
        return this.op(list && list.length ? '[' + list.map(num).join(' ') + '] ' + num(phase || 0) + ' d' : '[] 0 d');
    };
    Page.prototype.strokeColor = function (c) { return this.op(rgb(c) + ' RG'); };
    Page.prototype.fillColor = function (c) { return this.op(rgb(c) + ' rg'); };

    /* Прозрачность 0…1 для линий и заливки; ставится до рисования, действует до restore. */
    Page.prototype.alpha = function (a) {
        var key = Math.round(Math.max(0, Math.min(1, a)) * 100);
        this.gs[key] = true;
        return this.op('/GS' + key + ' gs');
    };

    Page.prototype.moveTo = function (x, y) { return this.op(num(x) + ' ' + num(y) + ' m'); };
    Page.prototype.lineTo = function (x, y) { return this.op(num(x) + ' ' + num(y) + ' l'); };
    Page.prototype.curveTo = function (x1, y1, x2, y2, x3, y3) { return this.op([x1, y1, x2, y2, x3, y3].map(num).join(' ') + ' c'); };
    Page.prototype.close = function () { return this.op('h'); };
    Page.prototype.rect = function (x, y, w, h) { return this.op([x, y, w, h].map(num).join(' ') + ' re'); };
    Page.prototype.stroke = function () { return this.op('S'); };
    Page.prototype.fill = function () { return this.op('f'); };
    Page.prototype.fillStroke = function () { return this.op('B'); };
    Page.prototype.end = function () { return this.op('n'); };
    Page.prototype.clip = function () { return this.op('W n'); };

    Page.prototype.circle = function (cx, cy, r) {
        var k = r * 0.5522847498;
        this.moveTo(cx + r, cy);
        this.curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r);
        this.curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy);
        this.curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r);
        this.curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy);
        return this.close();
    };

    Page.prototype.font = function (family, bold) { return this.doc.font(family, bold); };

    Page.prototype.textWidth = function (text, size, family, bold) {
        return this.doc.font(family, bold).width(text, size);
    };

    /*
        Строка текста. m — матрица [a b c d e f], переводящая «глиф в обычной ориентации»
        (ось y вверх, начало — на базовой линии слева) в текущие единицы страницы;
        size — кегль в тех же единицах. Цвет — заливка.
    */
    Page.prototype.text = function (text, m, size, color, family, bold) {
        if (!text) return this;
        var font = this.doc.font(family, bold);
        var runs = [];
        var run = null;

        for (var i = 0; i < text.length; i++) {
            var g = font.glyph(text.charAt(i));
            if (!run || run.bank !== g.bank) {
                run = { bank: g.bank, codes: '' };
                runs.push(run);
            }
            run.codes += '\\' + ('000' + g.code.toString(8)).slice(-3);
        }

        var out = ['q', rgb(color) + ' rg', 'BT', m.map(num).join(' ') + ' Tm'];
        runs.forEach(function (r) {
            out.push('/' + font.name(r.bank) + ' ' + num(size) + ' Tf');
            out.push('(' + r.codes + ') Tj');
        });
        out.push('ET', 'Q');
        return this.op(out.join('\n'));
    };

    /* --- документ ----------------------------------------------------------------- */

    function Doc(title) {
        this.title = title || '';
        this.pages = [];
        this.fonts = [];
        this.byKey = {};
    }

    Doc.prototype.page = function (wMm, hMm) {
        var pg = new Page(this, wMm, hMm);
        this.pages.push(pg);
        return pg;
    };

    Doc.prototype.font = function (family, bold) {
        var fam = family || 'Arial, sans-serif';
        var key = fam + '|' + (bold ? 'b' : 'n');
        if (!this.byKey[key]) {
            this.byKey[key] = new Font(this, this.fonts.length, fam, !!bold);
            this.fonts.push(this.byKey[key]);
        }
        return this.byKey[key];
    };

    function deflate(bytes) {
        if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
        var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
        return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    }

    /* PDF → Promise<Uint8Array>. */
    Doc.prototype.bytes = function () {
        var doc = this;
        var jobs = doc.pages.map(function (pg) {
            if (pg.depth !== 0) throw new Error('PdfVec: save()/restore() не сходятся на странице');
            return deflate(strBytes(pg.ops.join('\n')));
        });

        return Promise.all(jobs).then(function (packed) { return doc.assemble(packed); });
    };

    Doc.prototype.assemble = function (packed) {
        var doc = this;
        var chunks = [];
        var total = 0;
        var objs = [];

        function push(u8) { chunks.push(u8); total += u8.length; }
        function pushStr(s) { push(strBytes(s)); }
        function add(o) { objs.push(o); return objs.length; }
        function text(body) { return { kind: 'text', body: body }; }
        function stream(head, data) { return { kind: 'stream', head: head, data: data }; }

        var catalog = add(null);
        var pagesRoot = add(null);
        var info = add(text('<< /Title ' + hexUtf16(doc.title) + ' /Producer ' + hexUtf16('Гидравлика ХВС/ГВС') + ' >>'));

        // шрифты
        var fontRes = [];
        doc.fonts.forEach(function (font) {
            font.banks.forEach(function (bank, bi) {
                var procs = [];
                var widths = [];
                var diffs = [];
                var cmap = [];

                bank.list.forEach(function (g) {
                    var s = 1000 / EM;
                    var wx = g.adv * s;
                    var body;

                    if (g.bits) {
                        var left = -g.ox * s;
                        var bottom = (g.oy - g.h) * s;
                        body = num(wx) + ' 0 ' + num(left) + ' ' + num(bottom) + ' ' + num(left + g.w * s) + ' ' + num(bottom + g.h * s) + ' d1\n'
                            + 'q ' + num(g.w * s) + ' 0 0 ' + num(g.h * s) + ' ' + num(left) + ' ' + num(bottom) + ' cm\n'
                            + 'BI /IM true /W ' + g.w + ' /H ' + g.h + ' /BPC 1 ID\n';
                        var head = strBytes(body);
                        var tail = strBytes('\nEI Q');
                        var all = new Uint8Array(head.length + g.bits.length + tail.length);
                        all.set(head, 0);
                        all.set(g.bits, head.length);
                        all.set(tail, head.length + g.bits.length);
                        procs.push({ code: g.code, id: add(stream('', all)) });
                    } else {
                        procs.push({ code: g.code, id: add(stream('', strBytes(num(wx) + ' 0 0 0 0 0 d1'))) });
                    }

                    widths[g.code] = Math.round(wx * 100) / 100;
                    diffs.push(g.code);
                    var cp = g.ch.charCodeAt(0).toString(16).toUpperCase();
                    while (cp.length < 4) cp = '0' + cp;
                    cmap.push('<' + ('0' + g.code.toString(16)).slice(-2).toUpperCase() + '> <' + cp + '>');
                });

                var last = bank.list.length;
                var wlist = [];
                for (var c = 1; c <= last; c++) wlist.push(widths[c] || 0);

                var cmapText = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n'
                    + '/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n1 begincodespacerange <00> <FF> endcodespacerange\n'
                    + cmap.length + ' beginbfchar\n' + cmap.join('\n') + '\nendbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end';
                var cmapId = add(stream('', strBytes(cmapText)));

                var diffText = '[1 ' + procs.map(function (p) { return '/g' + p.code; }).join(' ') + ']';
                var charProcs = '<< ' + procs.map(function (p) { return '/g' + p.code + ' ' + p.id + ' 0 R'; }).join(' ') + ' >>';

                var fontId = add(text('<< /Type /Font /Subtype /Type3 /Name /' + font.name(bi) + ' /FontBBox [-200 -400 1400 1100] /FontMatrix [0.001 0 0 0.001 0 0]'
                    + ' /CharProcs ' + charProcs + ' /Encoding << /Type /Encoding /Differences ' + diffText + ' >>'
                    + ' /FirstChar 1 /LastChar ' + last + ' /Widths [' + wlist.join(' ') + '] /Resources << >> /ToUnicode ' + cmapId + ' 0 R >>'));
                fontRes.push('/' + font.name(bi) + ' ' + fontId + ' 0 R');
            });
        });

        // страницы
        var pageIds = [];
        doc.pages.forEach(function (pg, i) {
            var raw = strBytes(pg.ops.join('\n'));
            var zipped = packed[i];
            var contId = add(zipped ? stream('/Filter /FlateDecode', zipped) : stream('', raw));

            var gs = Object.keys(pg.gs).map(function (k) { return '/GS' + k + ' << /Type /ExtGState /CA ' + (k / 100) + ' /ca ' + (k / 100) + ' >>'; }).join(' ');
            var res = '<< /Font << ' + fontRes.join(' ') + ' >>' + (gs ? ' /ExtGState << ' + gs + ' >>' : '') + ' >>';
            var wpt = num(pg.w * PT);
            var hpt = num(pg.h * PT);
            pageIds.push(add(text('<< /Type /Page /Parent ' + pagesRoot + ' 0 R /MediaBox [0 0 ' + wpt + ' ' + hpt + '] /Resources ' + res + ' /Contents ' + contId + ' 0 R >>')));
        });

        objs[catalog - 1] = text('<< /Type /Catalog /Pages ' + pagesRoot + ' 0 R >>');
        objs[pagesRoot - 1] = text('<< /Type /Pages /Count ' + pageIds.length + ' /Kids [' + pageIds.map(function (n) { return n + ' 0 R'; }).join(' ') + '] >>');

        pushStr('%PDF-1.4\n');
        push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

        var offsets = [];
        objs.forEach(function (o, i) {
            offsets[i] = total;
            pushStr((i + 1) + ' 0 obj\n');
            if (o.kind === 'text') pushStr(o.body + '\n');
            else {
                pushStr('<< ' + o.head + ' /Length ' + o.data.length + ' >>\nstream\n');
                push(o.data);
                pushStr('\nendstream\n');
            }
            pushStr('endobj\n');
        });

        var xref = total;
        pushStr('xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n');
        offsets.forEach(function (off) { pushStr(('0000000000' + off).slice(-10) + ' 00000 n \n'); });
        pushStr('trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

        var out = new Uint8Array(total);
        var pos = 0;
        chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
        return out;
    };

    function create(title) { return new Doc(title); }

    return { create: create, rgb: rgb, EM: EM };
})();
