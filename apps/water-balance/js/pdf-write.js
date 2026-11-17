'use strict';

/*
    Сборка PDF из готовых PDF: каталожные листы насосов складываются в один
    файл, и на каждой странице в правом верхнем углу появляется штамп
    «Приложение N».

    Делается это честной пересборкой: каждый исходный файл читается своим же
    разбором (js/pdf.js), его объекты переписываются с новыми номерами, а из
    страниц собирается новое дерево. Поэтому результат — обычный PDF, а не
    склейка байтов, и Acrobat с Chrome читают его как родной.

    Штамп — картинка-маска: текст рисуется на холсте браузера и кладётся в
    страницу чёрной краской через /ImageMask. Так получается кириллица без
    встроенных шрифтов — шрифт в PDF нужно носить с собой, а холст уже есть.
*/

var PdfWrite = (function () {

    /* --- штамп картинкой ----------------------------------------------------- */

    var STAMP_SCALE = 8;        // точек холста на миллиметр: хватает для печати

    /**
     * Нарисовать надпись и вернуть её однобитной маской: 1 — прозрачно,
     * 0 — краска. Такой порядок у /ImageMask с /Decode [0 1].
     */
    function stampMask(text, mm) {
        var height = Math.round(mm * STAMP_SCALE);
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        ctx.font = height + 'px "Times New Roman", serif';
        var width = Math.ceil(ctx.measureText(text).width) + 4;

        canvas.width = width;
        canvas.height = Math.round(height * 1.35);
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        ctx.font = height + 'px "Times New Roman", serif';
        ctx.textBaseline = 'top';
        ctx.fillText(text, 2, Math.round(height * 0.15));

        var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        var rowBytes = Math.ceil(canvas.width / 8);
        var bits = new Uint8Array(rowBytes * canvas.height);

        for (var y = 0; y < canvas.height; y++) {
            for (var x = 0; x < canvas.width; x++) {
                var dark = data[(y * canvas.width + x) * 4] < 128;
                if (!dark) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }

        return { width: canvas.width, height: canvas.height, bits: bits };
    }

    /* --- сборка файла -------------------------------------------------------- */

    function bytesOf(text) {
        var out = new Uint8Array(text.length);
        for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xFF;
        return out;
    }

    /** Склейка кусков: текст пишется однобайтово, потоки идут как есть. */
    function Buffer() {
        this.parts = [];
        this.length = 0;
    }

    Buffer.prototype.push = function (chunk) {
        var bytes = typeof chunk === 'string' ? bytesOf(chunk) : chunk;
        this.parts.push(bytes);
        this.length += bytes.length;
        return this;
    };

    Buffer.prototype.bytes = function () {
        var out = new Uint8Array(this.length);
        var at = 0;
        this.parts.forEach(function (p) { out.set(p, at); at += p.length; });
        return out;
    };

    /*
        Ссылки на объекты в словаре — «12 0 R». При переносе объекта в новый
        файл номера меняются, поэтому в тексте словаря они переписываются по
        карте. Потоки при этом не трогаются: там двоичные данные.
    */
    function renumber(dict, map) {
        return dict.replace(/(\d+)\s+(\d+)\s+R/g, function (all, num) {
            var to = map[Number(num)];
            return to === undefined ? 'null' : to + ' 0 R';
        });
    }

    /** Значение ключа словаря как текст — для /MediaBox и /Resources. */
    function value(dict, key) {
        var at = dict.indexOf('/' + key);
        if (at < 0) return null;

        var tail = dict.slice(at + key.length + 1);
        var ref = /^\s*(\d+)\s+(\d+)\s+R/.exec(tail);
        if (ref) return ref[0].trim();

        if (/^\s*\[/.test(tail)) {
            var end = tail.indexOf(']');
            return end < 0 ? null : tail.slice(tail.indexOf('['), end + 1);
        }
        if (/^\s*<</.test(tail)) return sliceDict(tail);
        var word = /^\s*(\/[^\s/<>\[\]]+|[-+\d.]+)/.exec(tail);
        return word ? word[1] : null;
    }

    function sliceDict(tail) {
        var at = tail.indexOf('<<');
        if (at < 0) return null;
        var depth = 0;
        for (var i = at; i < tail.length - 1; i++) {
            if (tail[i] === '<' && tail[i + 1] === '<') { depth++; i++; }
            else if (tail[i] === '>' && tail[i + 1] === '>') {
                depth--;
                i++;
                if (!depth) return tail.slice(at, i + 1);
            }
        }
        return null;
    }

    /** Унаследованное от /Pages значение: его у страницы может не быть. */
    function inherited(doc, pageNum, key) {
        var dict = doc.dictNum(pageNum);

        for (var step = 0; step < 6 && dict; step++) {
            var v = value(dict, key);
            if (v) return { value: v, dict: dict };
            var parent = /\/Parent\s+(\d+)\s+(\d+)\s+R/.exec(dict);
            dict = parent ? doc.dictNum(Number(parent[1])) : '';
        }

        return null;
    }

    /* --- перенос объектов ---------------------------------------------------- */

    /*
        Из исходного файла в новый переносится страница со всем, что ей нужно:
        ресурсы, шрифты, картинки, потоки содержимого. Обход идёт по ссылкам
        от самой страницы, поэтому лишние объекты (закладки, разметка форм) в
        новый файл не попадают.
    */
    function collect(doc, pageNum, skipKeys) {
        var order = [];
        var seen = {};

        function walk(num, depth) {
            if (seen[num] || depth > 24 || !doc.objects[num]) return;
            seen[num] = true;
            order.push(num);

            var dict = doc.dictNum(num);
            if (skipKeys) dict = dict.replace(/\/Parent\s+\d+\s+\d+\s+R/g, '');

            var re = /(\d+)\s+(\d+)\s+R/g;
            var m;
            while ((m = re.exec(dict))) walk(Number(m[1]), depth + 1);
        }

        walk(pageNum, 0);
        return order;
    }

    /*
        Отступы штампа от правого и верхнего краёв листа, миллиметры. У
        каталожных листов в правом верхнем углу стоит логотип изготовителя,
        поэтому по умолчанию надпись уходит левее его и выше заголовка.
    */
    var PLACE = { right: 40, top: 7 };

    /**
     * Собрать один PDF из нескольких: каждый элемент — { bytes, stamp }.
     * Штамп (строка) печатается в правом верхнем углу каждой страницы;
     * place — { right, top } в миллиметрах, если углы заняты.
     */
    function merge(items, place) {
        var where = {
            right: place && place.right > 0 ? place.right : PLACE.right,
            top: place && place.top > 0 ? place.top : PLACE.top
        };

        var jobs = items.map(function (item) {
            var doc = new Pdf.Doc(new Uint8Array(item.bytes));
            doc.scan();
            return doc.readObjectStreams().then(function () {
                return { doc: doc, stamp: item.stamp || '' };
            });
        });

        return Promise.all(jobs).then(function (sources) {
            return build(sources, where);
        });
    }

    function build(sources, place) {
        var out = new Buffer();
        var objects = [];           // { num, body } — тела объектов по порядку
        var pages = [];             // номера страниц в новом файле
        var next = 3;               // 1 — каталог, 2 — дерево страниц

        function add(body) {
            var num = next++;
            objects.push({ num: num, body: body });
            return num;
        }

        sources.forEach(function (src) {
            var doc = src.doc;
            var list = Pdf.pagesOf(doc);

            /*
                Карта номеров общая на весь исходный файл: шрифты, картинки и
                прочее добро у страниц общее, и переносить его на каждую
                страницу заново — значит раздуть файл в разы.
            */
            var map = {};
            var written = {};

            /*
                Страницы пишутся только в свой черёд: на них ссылаются закладки
                и переходы, и если записать такую ссылку как обычный объект,
                страница окажется в файле дважды и дерево листов развалится.
            */
            var isPage = {};
            list.forEach(function (n) { isPage[n] = true; });

            list.forEach(function (pageNum) {
                var nums = collect(doc, pageNum, true);

                // Сначала раздаём новые номера, потом переписываем ссылки.
                nums.forEach(function (n) { if (map[n] === undefined) map[n] = next++; });

                var stampNum = src.stamp ? next++ : 0;
                var contentNum = src.stamp ? next++ : 0;
                var guardNum = src.stamp ? next++ : 0;

                nums.forEach(function (n) {
                    if (n !== pageNum && (written[n] || isPage[n])) return;
                    written[n] = true;

                    var dict = doc.dictNum(n).replace(/\/Parent\s+\d+\s+\d+\s+R/g, '');
                    var body = renumber(dict, map);
                    var raw = doc.streamBytes(doc.objects[n]);

                    if (n === pageNum) {
                        body = pageDict(doc, pageNum, body, map, stampNum, contentNum, guardNum);
                        pages.push(map[n]);
                    }

                    objects.push({ num: map[n], body: body, stream: raw });
                });

                if (src.stamp) {
                    var box = inherited(doc, pageNum, 'MediaBox');
                    stampObjects(src.stamp, box ? box.value : null, stampNum, contentNum, guardNum, objects, place);
                }
            });
        });

        applyPatches(objects);

        // Каталог и дерево страниц — всегда объекты 1 и 2.
        objects.unshift({ num: 2, body: '<< /Type /Pages /Count ' + pages.length + ' /Kids ['
            + pages.map(function (p) { return p + ' 0 R'; }).join(' ') + '] >>' });
        objects.unshift({ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });

        /*
            Сведения о файле: без них просмотрщики показывают пустые свойства
            документа, а некоторые ворчат на «неполный» файл. Дата — в формате
            PDF: D:ГГГГММДДччммсс.
        */
        var infoNum = 0;
        objects.forEach(function (o) { infoNum = Math.max(infoNum, o.num); });
        infoNum++;
        objects.push({ num: infoNum, body: '<< /Producer (WaterBalanceWeb) /CreationDate (' + pdfDate(new Date()) + ') >>' });

        objects.sort(function (a, b) { return a.num - b.num; });

        out.push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
        var offsets = {};
        var max = 0;

        objects.forEach(function (o) {
            offsets[o.num] = out.length;
            max = Math.max(max, o.num);
            out.push(o.num + ' 0 obj\n');
            out.push(o.body);
            if (o.stream) {
                out.push('\nstream\n');
                out.push(o.stream);
                out.push('\nendstream');
            }
            out.push('\nendobj\n');
        });

        var xref = out.length;
        var lines = ['xref', '0 ' + (max + 1), '0000000000 65535 f '];
        for (var i = 1; i <= max; i++) {
            lines.push(offsets[i] === undefined
                ? '0000000000 65535 f '
                : String(offsets[i]).padStart(10, '0') + ' 00000 n ');
        }

        out.push(lines.join('\n') + '\n');
        // /ID — опознавательный номер файла; его ждут почтовые и архивные
        // программы, и без него некоторые считают файл неполным.
        var id = fileId();
        out.push('trailer\n<< /Size ' + (max + 1) + ' /Root 1 0 R /Info ' + infoNum + ' 0 R'
            + ' /ID [<' + id + '> <' + id + '>] >>\nstartxref\n' + xref + '\n%%EOF\n');

        return out.bytes();
    }

    /*
        Страница в новом файле: родитель — наше дерево, содержимое — прежнее
        плюс наш поток со штампом, ресурсы — прежние плюс наша картинка.
    */
    /** Добавить картинку штампа в словарь ресурсов (в его /XObject). */
    function withStamp(res, xobj) {
        if (/\/XObject\s*<</.test(res)) return res.replace(/\/XObject\s*<</, '/XObject << ' + xobj + ' ');
        return res.replace(/>>\s*$/, '/XObject << ' + xobj + ' >> >>');
    }

    /*
        Правки, которые делаются после сборки: в объект ресурсов дописывается
        картинка штампа. Раньше это сделать нельзя — объект ещё не собран, а
        на него может ссылаться несколько страниц.
    */
    var patches = [];

    function applyPatches(objects) {
        patches.forEach(function (p) {
            objects.forEach(function (o) {
                if (o.num !== p.num) return;

                var ref = /\/XObject\s+(\d+)\s+\d+\s+R/.exec(o.body);
                if (ref) {
                    // /XObject сам отдельным объектом — дописываем в него.
                    var num = Number(ref[1]);
                    objects.forEach(function (x) {
                        if (x.num === num) x.body = x.body.replace(/>>\s*$/, p.xobj + ' >>');
                    });
                    return;
                }

                o.body = withStamp(o.body, p.xobj);
            });
        });

        patches = [];
    }

    function pageDict(doc, pageNum, body, map, stampNum, contentNum, guardNum) {
        var dict = body;

        // Унаследованные от /Pages ресурсы и габарит переносим прямо в страницу.
        ['MediaBox', 'Resources', 'Rotate'].forEach(function (key) {
            if (value(dict, key)) return;
            var got = inherited(doc, pageNum, key);
            if (!got) return;
            var text = renumber(got.value, map);
            dict = dict.replace(/>>\s*$/, '/' + key + ' ' + text + ' >>');
        });

        dict = dict.replace(/\/Parent\s+\d+\s+\d+\s+R/g, '');
        dict = dict.replace(/>>\s*$/, '/Parent 2 0 R >>');

        if (!stampNum) return dict;

        // Содержимое: к прежнему добавляется страница со штампом.
        var contents = value(dict, 'Contents');
        var list = contents && contents.charAt(0) === '['
            ? contents.slice(1, -1).trim()
            : (contents || '');

        /*
            Перед чужим содержимым встаёт «q», после — наш поток, который
            сначала закрывает его «Q». Лист из AutoCAD оставляет после себя и
            масштаб, и обрезку: без этого штамп уехал бы вместе с ними.
        */
        dict = dict.replace(/\/Contents[^/]*?(?=\/|>>\s*$)/, '');
        dict = dict.replace(/>>\s*$/, '/Contents [' + guardNum + ' 0 R ' + list + ' ' + contentNum + ' 0 R] >>');

        /*
            Ресурсы: свою картинку надо положить в те же ресурсы, что у
            страницы. Второй ключ /Resources добавлять нельзя — просмотрщик
            возьмёт один из них, и страница останется без шрифтов и картинок.
            Если ресурсы лежат отдельным объектом, правится он.
        */
        var res = value(dict, 'Resources');
        var xobj = '/Stamp' + stampNum + ' ' + stampNum + ' 0 R';

        if (res && res.charAt(0) === '<') {
            dict = dict.replace(res, withStamp(res, xobj));
        } else if (res && /^\d+\s+\d+\s+R$/.test(res)) {
            patches.push({ num: Number(/^(\d+)/.exec(res)[1]), xobj: xobj });
        } else {
            dict = dict.replace(/>>\s*$/, '/Resources << /XObject << ' + xobj + ' >> >> >>');
        }

        return dict;
    }

    /** Объекты штампа: картинка-маска и поток, который её кладёт на страницу. */
    function stampObjects(text, box, stampNum, contentNum, guardNum, objects, place) {
        var mask = stampMask(text, 4);
        var size = boxSize(box);
        var mm = 72 / 25.4;
        var w = mask.width / STAMP_SCALE * mm;              // мм холста в пункты
        var h = mask.height / STAMP_SCALE * mm;
        var x = size.width - w - place.right * mm;
        var y = size.height - h - place.top * mm;

        objects.push({
            num: stampNum,
            body: '<< /Type /XObject /Subtype /Image /Width ' + mask.width + ' /Height ' + mask.height
                + ' /ImageMask true /Decode [0 1] /BitsPerComponent 1 /Length ' + mask.bits.length + ' >>',
            stream: mask.bits
        });

        // «Q» закрывает состояние чужого листа, дальше штамп рисуется начисто.
        var content = 'Q q 0 0 0 rg ' + round(w) + ' 0 0 ' + round(h) + ' ' + round(x) + ' ' + round(y)
            + ' cm /Stamp' + stampNum + ' Do Q';

        objects.push({
            num: contentNum,
            body: '<< /Length ' + content.length + ' >>',
            stream: bytesOf(content)
        });

        var guard = 'q';
        objects.push({
            num: guardNum,
            body: '<< /Length ' + guard.length + ' >>',
            stream: bytesOf(guard)
        });
    }

    /** Дата в формате PDF: D:ГГГГММДДччммсс. */
    function pdfDate(d) {
        function two(v) { return (v < 10 ? '0' : '') + v; }
        return 'D:' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate())
            + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
    }

    /** Опознавательный номер файла: шестнадцать байт шестнадцатеричной строкой. */
    function fileId() {
        var out = '';
        for (var i = 0; i < 16; i++) {
            out += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2);
        }
        return out.toUpperCase();
    }

    function round(v) { return Math.round(v * 100) / 100; }

    function boxSize(box) {
        var f = String(box || '[0 0 595 842]').replace(/[\[\]]/g, '').trim().split(/\s+/).map(Number);
        if (f.length !== 4 || !f.every(isFinite)) return { width: 595, height: 842 };
        return { width: Math.abs(f[2] - f[0]), height: Math.abs(f[3] - f[1]) };
    }

    function save(bytes, name) {
        var blob = new Blob([bytes], { type: 'application/pdf' });
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
        PLACE: PLACE,
        merge: merge,
        save: save,
        stampMask: stampMask,
        boxSize: boxSize
    };
})();
