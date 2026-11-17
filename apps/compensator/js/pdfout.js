'use strict';

/*
    Вывод расчёта в PDF — настоящим файлом, без диалога печати.

    Почему так: чтобы написать в PDF кириллицу векторным текстом, нужен
    встроенный шрифт, а шрифтов в проекте нет (программа собирается без сборки
    и без внешних файлов, см. README). Поэтому страница сначала рисуется на
    canvas — там кириллица берётся из системного шрифта и выглядит как надо, —
    а потом кладётся в PDF картинкой JPEG (фильтр DCTDecode). Текст в таком
    файле не выделяется, зато файл получается сам собой, и схема узла уходит
    в него ровно той же, что на экране.

    Рядом оставлена кнопка обычной печати: она даёт векторный PDF через
    «Сохранить как PDF» в диалоге браузера.
*/

var PdfOut = (function () {

    var PT_W = 595.28, PT_H = 841.89;     // A4
    var DPI = 150;
    var K = DPI / 72;                      // пиксели на пункт
    var MARGIN_X = 34, MARGIN_T = 32, MARGIN_B = 34;

    /* ------------------------------------------------------------ байты */

    function strBytes(s) {
        var a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xFF;
        return a;
    }

    function b64Bytes(b64) {
        var bin = atob(b64);
        var a = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        return a;
    }

    /** Строка PDF в UTF-16BE с BOM, шестнадцатеричная — для кириллицы в Info. */
    function pdfHexStr(s) {
        var out = 'FEFF';
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i).toString(16).toUpperCase();
            while (c.length < 4) c = '0' + c;
            out += c;
        }
        return '<' + out + '>';
    }

    /* ------------------------------------------------------------ холст страницы */

    function Painter() {
        this.pages = [];
        this.ctx = null;
        this.y = 0;
        this.pageNo = 0;
        this.title = '';
        this.subtitle = '';
    }

    Painter.prototype.newPage = function () {
        var cv = document.createElement('canvas');
        cv.width = Math.round(PT_W * K);
        cv.height = Math.round(PT_H * K);
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.scale(K, K);
        ctx.textBaseline = 'alphabetic';
        this.pages.push(cv);
        this.ctx = ctx;
        this.pageNo = this.pages.length;
        this.y = MARGIN_T;

        // колонтитул
        ctx.fillStyle = '#5d6b79';
        ctx.font = '7.5px system-ui, "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(this.title, MARGIN_X, this.y);
        ctx.textAlign = 'right';
        ctx.fillText('стр. ' + this.pageNo, PT_W - MARGIN_X, this.y);
        ctx.textAlign = 'left';
        ctx.strokeStyle = '#d9e0e7';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(MARGIN_X, this.y + 3);
        ctx.lineTo(PT_W - MARGIN_X, this.y + 3);
        ctx.stroke();
        this.y += 16;
        return ctx;
    };

    Painter.prototype.ensure = function (h) {
        if (!this.ctx || this.y + h > PT_H - MARGIN_B) this.newPage();
    };

    Painter.prototype.heading = function (text, size) {
        this.ensure(22);
        var ctx = this.ctx;
        ctx.fillStyle = '#1d2733';
        ctx.font = '600 ' + (size || 11) + 'px system-ui, "Segoe UI", Arial, sans-serif';
        this.y += (size || 11) + 2;
        ctx.fillText(text, MARGIN_X, this.y);
        this.y += 5;
    };

    Painter.prototype.small = function (text, color) {
        this.ensure(12);
        var ctx = this.ctx;
        ctx.fillStyle = color || '#5d6b79';
        ctx.font = '8px system-ui, "Segoe UI", Arial, sans-serif';
        this.y += 9;
        ctx.fillText(text, MARGIN_X, this.y);
    };

    /** Моноширинный блок — текстовый отчёт как есть. */
    Painter.prototype.mono = function (lines, size, lead) {
        var s = size || 7.1, lh = lead || 9.1;
        for (var i = 0; i < lines.length; i++) {
            this.ensure(lh + 2);
            var ctx = this.ctx;
            ctx.font = s + 'px ui-monospace, Consolas, "Courier New", monospace';
            ctx.fillStyle = /^\s*!/.test(lines[i]) ? '#c62f2f' : '#1d2733';
            this.y += lh;
            ctx.fillText(lines[i], MARGIN_X, this.y);
        }
    };

    /** Картинка во всю ширину полосы. */
    Painter.prototype.image = function (img, capt) {
        var maxW = PT_W - 2 * MARGIN_X;
        var w = maxW;
        var h = img.height * (w / img.width);
        var maxH = PT_H - MARGIN_T - MARGIN_B - 40;
        if (h > maxH) { h = maxH; w = img.width * (h / img.height); }
        this.ensure(h + 16);
        var ctx = this.ctx;
        this.y += 6;
        ctx.drawImage(img, MARGIN_X + (maxW - w) / 2, this.y, w, h);
        this.y += h + 4;
        if (capt) this.small(capt);
        this.y += 4;
    };

    /* ------------------------------------------------------------ SVG → Image */

    function svgToImage(svgText) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('Схема не отрисовалась')); };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        });
    }

    /* ------------------------------------------------------------ сборка PDF */

    function assemble(pages, meta) {
        var jpegs = pages.map(function (cv) {
            return b64Bytes(cv.toDataURL('image/jpeg', 0.92).split(',')[1]);
        });

        var objs = [];                       // objs[i] — тело объекта (i с единицы)
        function put(body) { objs.push(body); return objs.length; }

        var catalogId = put(null);           // 1
        var pagesId = put(null);             // 2
        var infoId = put(null);              // 3

        var kids = [];
        for (var i = 0; i < pages.length; i++) {
            var imgId = put({
                dict: '<< /Type /XObject /Subtype /Image /Width ' + pages[i].width +
                    ' /Height ' + pages[i].height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8' +
                    ' /Filter /DCTDecode /Length ' + jpegs[i].length + ' >>',
                stream: jpegs[i]
            });
            var content = 'q ' + PT_W.toFixed(2) + ' 0 0 ' + PT_H.toFixed(2) + ' 0 0 cm /Im0 Do Q\n';
            var contId = put({
                dict: '<< /Length ' + content.length + ' >>',
                stream: strBytes(content)
            });
            var pageId = put({
                dict: '<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' +
                    PT_W.toFixed(2) + ' ' + PT_H.toFixed(2) + '] /Resources << /XObject << /Im0 ' +
                    imgId + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' + contId + ' 0 R >>'
            });
            kids.push(pageId + ' 0 R');
        }

        objs[catalogId - 1] = { dict: '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>' };
        objs[pagesId - 1] = {
            dict: '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>'
        };
        objs[infoId - 1] = {
            dict: '<< /Title ' + pdfHexStr(meta.title || 'Расчёт компенсатора') +
                ' /Creator ' + pdfHexStr('CompensatorWeb') +
                ' /Producer ' + pdfHexStr('CompensatorWeb') + ' >>'
        };

        var chunks = [], total = 0;
        function push(u8) { chunks.push(u8); total += u8.length; }
        function pushStr(s) { push(strBytes(s)); }

        pushStr('%PDF-1.4\n%âãÏÓ\n');

        var offsets = [0];
        for (var j = 0; j < objs.length; j++) {
            offsets.push(total);
            pushStr((j + 1) + ' 0 obj\n' + objs[j].dict + '\n');
            if (objs[j].stream) {
                pushStr('stream\n');
                push(objs[j].stream);
                pushStr('\nendstream\n');
            }
            pushStr('endobj\n');
        }

        var xrefPos = total;
        var xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
        for (var m = 1; m <= objs.length; m++) {
            var o = String(offsets[m]);
            while (o.length < 10) o = '0' + o;
            xref += o + ' 00000 n \n';
        }
        pushStr(xref);
        pushStr('trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogId + ' 0 R /Info ' +
            infoId + ' 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

        var out = new Uint8Array(total), pos = 0;
        for (var c = 0; c < chunks.length; c++) { out.set(chunks[c], pos); pos += chunks[c].length; }
        return out;
    }

    /* ------------------------------------------------------------ наружу */

    /**
     * Собрать PDF: отчёт, схема узла, схема стояка, список источников.
     * Возвращает Promise с Uint8Array.
     */
    function build(inp, res, reportText) {
        return buildPages(inp, res, reportText).then(function (pages) {
            return assemble(pages, { title: 'Расчёт П-образного компенсатора' });
        });
    }

    /** Те же страницы, но холстами — ими удобно проверять вёрстку глазами. */
    function buildPages(inp, res, reportText) {
        var nodeSvg = Scheme.node(res, { mode: 'light', width: 1000, maxH: 520 });
        var riserSvg = Scheme.riser(res, { mode: 'light', rowH: 46 });

        return Promise.all([svgToImage(nodeSvg), svgToImage(riserSvg)]).then(function (imgs) {
            var p = new Painter();
            p.title = 'Расчёт П-образного компенсатора' +
                (inp.object ? ' · ' + inp.object : '') + ' · ' + U.today();
            p.newPage();

            p.heading('Расчёт стального П-образного компенсатора', 13);
            p.small(U.today() + (inp.object ? '   ·   ' + inp.object : '') +
                (inp.system ? '   ·   ' + inp.system : ''));
            p.y += 4;

            p.image(imgs[0], 'Узел компенсатора: размеры в миллиметрах, перемещения — в расчётном состоянии.');

            p.heading('Расчёт', 11);
            p.mono(reportText.split('\n'));

            p.newPage();
            p.heading('Схема стояка', 12);
            p.image(imgs[1], 'Расстановка неподвижных опор и компенсаторов по этажам.');

            return p.pages;
        });
    }

    return { build: build, buildPages: buildPages, svgToImage: svgToImage, assemble: assemble };
})();
