'use strict';

/*
    Чтение текста из PDF — чтобы забирать данные из каталожных листов насосных
    установок, не перепечатывая их руками.

    Библиотеки не подключаются: программа работает и по file://. Нужен минимум —
    объекты, потоки, страницы, шрифты и операторы текста:

        объекты     «N G obj … endobj», плюс сжатые пачки /ObjStm;
        потоки      /FlateDecode распаковывается DecompressionStream браузера;
        шрифты      /ToUnicode CMap: bfchar и bfrange дают букву по коду глифа,
                    поэтому кириллица читается правильно даже там, где обычные
                    просмотрщики показывают пустоту;
        текст       BT/ET, Tf, Td, TD, Tm, T*, TL, Tj, TJ, ' и " — этого хватает,
                    чтобы получить куски текста с их координатами.

    Наружу отдаются строки страницы: слова, сгруппированные по строкам сверху
    вниз и слева направо, и отдельно — все куски с координатами, если нужно
    разбирать колонку значений справа от подписи.

    Чего здесь нет: шифрование, CCITT и JPX картинки, вычисление CTM для текста
    внутри форм XObject. Для каталожных листов Wilo этого не требуется.
*/

var Pdf = (function () {

    /** Байты в строку «один байт — один символ»: позиции совпадают со смещениями. */
    function latin(bytes) {
        var out = '';
        var step = 0x8000;
        for (var i = 0; i < bytes.length; i += step) {
            out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
        }
        return out;
    }

    /*
        DecompressionStream ругается на лишние байты после сжатых данных, а в
        PDF перед «endstream» почти всегда стоит перевод строки. Поэтому хвост
        обрезается, а если не помогло — пробуем без заголовка zlib.
    */
    function inflate(bytes) {
        var end = bytes.length;
        while (end > 0 && (bytes[end - 1] === 0x0A || bytes[end - 1] === 0x0D || bytes[end - 1] === 0x20)) end--;
        var trimmed = bytes.subarray(0, end);

        function pipe(data, format) {
            var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
            return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
        }

        return pipe(trimmed, 'deflate')
            .catch(function () { return pipe(bytes, 'deflate'); })
            .catch(function () { return pipe(trimmed, 'deflate-raw'); })
            .catch(function () { return pipe(bytes.subarray(2, end), 'deflate-raw'); });
    }

    /* --- разбор структуры ---------------------------------------------------- */

    function Doc(bytes) {
        this.bytes = bytes;
        this.text = latin(bytes);
        this.objects = {};      // номер → { dict, start, end }
        this.cache = {};
    }

    Doc.prototype.scan = function () {
        var re = /(\d+)\s+(\d+)\s+obj\b/g;
        var m;

        while ((m = re.exec(this.text))) {
            var start = m.index + m[0].length;
            var end = this.text.indexOf('endobj', start);
            if (end < 0) end = this.text.length;
            this.objects[Number(m[1])] = { start: start, end: end };
            re.lastIndex = end;
        }
    };

    /** Словарь объекта — как текст; значения достаются поиском по ключу. */
    Doc.prototype.dictOf = function (obj) {
        var at = this.text.indexOf('stream', obj.start);
        var end = at >= 0 && at < obj.end ? at : obj.end;
        return this.text.slice(obj.start, end);
    };

    Doc.prototype.value = function (dict, key) {
        var at = dict.indexOf('/' + key);
        if (at < 0) return null;

        var rest = dict.slice(at + key.length + 1);
        var ref = /^\s*(\d+)\s+(\d+)\s+R/.exec(rest);
        if (ref) return { ref: Number(ref[1]) };

        var num = /^\s*([-+]?[\d.]+)/.exec(rest);
        if (num && !/^\s*\//.test(rest)) return { num: Number(num[1]) };

        var name = /^\s*\/([^\s/\[\]<>()]+)/.exec(rest);
        if (name) return { name: name[1] };

        if (/^\s*\[/.test(rest)) {
            var depth = 0;
            for (var i = rest.indexOf('['); i < rest.length; i++) {
                if (rest[i] === '[') depth++;
                else if (rest[i] === ']' && --depth === 0) return { array: rest.slice(rest.indexOf('['), i + 1) };
            }
        }
        if (/^\s*<</.test(rest)) return { dict: rest };
        return null;
    };

    /*
        Потоки страницы: «/Contents 4 0 R» или массив «/Contents [4 0 R 18 0 R]»,
        который в чертежах из AutoCAD занимает несколько строк. Поэтому значение
        берётся до закрывающей скобки, а не до конца строки.
    */
    function contentRefs(doc, dict) {
        var at = dict.indexOf('/Contents');
        if (at < 0) return [];

        var tail = dict.slice(at + '/Contents'.length);
        if (/^\s*\[/.test(tail)) {
            var end = tail.indexOf(']');
            return refsIn(end < 0 ? tail : tail.slice(0, end));
        }

        var one = /^\s*(\d+)\s+(\d+)\s+R/.exec(tail);
        return one ? [Number(one[1])] : [];
    }

    /** Ссылки «N 0 R» из массива или одиночного значения. */
    function refsIn(text) {
        var out = [];
        var re = /(\d+)\s+(\d+)\s+R/g;
        var m;
        while ((m = re.exec(text))) out.push(Number(m[1]));
        return out;
    }

    /** Сырые байты потока объекта. */
    Doc.prototype.streamBytes = function (obj) {
        // Объект из сжатой пачки лежит строкой и потока иметь не может.
        if (!obj || obj.inline !== undefined || obj.start === undefined) return null;

        var at = this.text.indexOf('stream', obj.start);
        if (at < 0 || at > obj.end) return null;

        var from = at + 'stream'.length;
        if (this.text[from] === '\r') from++;
        if (this.text[from] === '\n') from++;

        var dict = this.dictOf(obj);
        var len = this.value(dict, 'Length');
        var to;

        // Длина часто задана ссылкой: «/Length 3 0 R», а в объекте 3 лежит число.
        if (len && len.ref !== undefined) {
            var target = this.objects[len.ref];
            var num = target ? /^\s*(\d+)/.exec(this.text.slice(target.start, target.start + 32)) : null;
            if (num) len = { num: Number(num[1]) };
        }

        if (len && typeof len.num === 'number') {
            to = from + len.num;
        } else {
            to = this.text.indexOf('endstream', from);
            if (to < 0) to = obj.end;
        }

        if (to > obj.end + 64) to = this.text.indexOf('endstream', from);
        return this.bytes.subarray(from, to);
    };

    /** Распакованное содержимое объекта; результат помнится. */
    Doc.prototype.content = function (num) {
        var self = this;
        if (this.cache[num]) return this.cache[num];

        var obj = this.objects[num];
        if (!obj) return Promise.resolve(null);

        var raw = this.streamBytes(obj);
        if (!raw) return Promise.resolve(null);

        var dict = this.dictOf(obj);
        var filter = this.value(dict, 'Filter');
        var flate = filter && (filter.name === 'FlateDecode' || /FlateDecode/.test(dict));

        var task = flate ? inflate(raw).catch(function () { return null; }) : Promise.resolve(raw);
        this.cache[num] = task;
        return task;
    };

    /* --- сжатые пачки объектов ----------------------------------------------- */

    /** /ObjStm: словари страниц и шрифтов часто лежат внутри сжатой пачки. */
    Doc.prototype.readObjectStreams = function () {
        var self = this;
        var nums = Object.keys(this.objects).filter(function (n) {
            return /\/Type\s*\/ObjStm/.test(self.dictOf(self.objects[n]));
        });

        return Promise.all(nums.map(function (n) {
            return self.content(Number(n)).then(function (bytes) {
                if (!bytes) return;

                var dict = self.dictOf(self.objects[n]);
                var count = self.value(dict, 'N');
                var first = self.value(dict, 'First');
                if (!count || !first) return;

                var text = latin(bytes);
                var head = text.slice(0, first.num).trim().split(/\s+/).map(Number);

                for (var i = 0; i < count.num; i++) {
                    var num = head[i * 2];
                    var at = first.num + head[i * 2 + 1];
                    var to = i + 1 < count.num ? first.num + head[i * 2 + 3] : text.length;
                    if (!self.objects[num]) self.objects[num] = { inline: text.slice(at, to) };
                }
            });
        }));
    };

    Doc.prototype.dictNum = function (num) {
        var obj = this.objects[num];
        if (!obj) return '';
        return obj.inline !== undefined ? obj.inline : this.dictOf(obj);
    };

    /* --- шрифты --------------------------------------------------------------- */

    /** Карта /ToUnicode: код глифа → символ. */
    function parseCMap(text) {
        var map = {};
        var m;

        var charRe = /beginbfchar([\s\S]*?)endbfchar/g;
        while ((m = charRe.exec(text))) {
            var pairs = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
            pairs.forEach(function (pair) {
                var p = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(pair);
                map[parseInt(p[1], 16)] = fromHex(p[2]);
            });
        }

        var rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
        while ((m = rangeRe.exec(rangeRe.lastIndex >= 0 ? text : text))) {
            var body = m[1];
            var simple = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
            var r;
            while ((r = simple.exec(body))) {
                var from = parseInt(r[1], 16);
                var to = parseInt(r[2], 16);
                var code = parseInt(r[3], 16);
                for (var c = from; c <= to && c - from < 4096; c++) map[c] = String.fromCharCode(code + (c - from));
            }
        }

        return map;
    }

    function fromHex(hex) {
        var out = '';
        for (var i = 0; i + 3 < hex.length + 1; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
        return out;
    }

    /* --- операторы текста ------------------------------------------------------ */

    function decodeString(raw, font) {
        var out = '';
        var i;

        if (font && font.twoByte) {
            for (i = 0; i + 1 < raw.length; i += 2) {
                var code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
                out += font.map && font.map[code] !== undefined ? font.map[code] : '';
            }
            return out;
        }

        for (i = 0; i < raw.length; i++) {
            var c = raw.charCodeAt(i);
            if (font && font.map && font.map[c] !== undefined) out += font.map[c];
            else out += c >= 0x80 ? cp1251(c) : String.fromCharCode(c);
        }
        return out;
    }

    /*
        В старых листах шрифт без /ToUnicode, а коды — обычная кириллица
        Windows-1251. Без этой таблицы текст выглядел бы как «Íàïîð».
    */
    var CP1251_HIGH = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕї';

    function cp1251(code) {
        if (code >= 0xC0) return String.fromCharCode(0x0410 + (code - 0xC0));
        return CP1251_HIGH.charAt(code - 0x80) || String.fromCharCode(code);
    }

    /** Литеральная строка (…) с экранированием и шестнадцатеричная <…>. */
    function readString(text, at) {
        if (text[at] === '<') {
            var end = text.indexOf('>', at);
            var hex = text.slice(at + 1, end).replace(/[^0-9A-Fa-f]/g, '');
            if (hex.length % 2) hex += '0';
            var out = '';
            for (var h = 0; h < hex.length; h += 2) out += String.fromCharCode(parseInt(hex.substr(h, 2), 16));
            return { value: out, end: end + 1 };
        }

        var depth = 0;
        var res = '';
        for (var i = at; i < text.length; i++) {
            var ch = text[i];
            if (ch === '\\') {
                var next = text[i + 1];
                var octal = /[0-7]{1,3}/.exec(text.substr(i + 1, 3));
                if (octal && octal.index === 0) {
                    res += String.fromCharCode(parseInt(octal[0], 8));
                    i += octal[0].length;
                } else {
                    res += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
                    i++;
                }
                continue;
            }
            if (ch === '(') {
                depth++;
                if (depth === 1) continue;
            } else if (ch === ')') {
                depth--;
                if (depth === 0) return { value: res, end: i + 1 };
            }
            res += ch;
        }
        return { value: res, end: text.length };
    }

    /** Куски текста страницы с координатами. */
    function runContent(text, fonts) {
        var items = [];
        var font = null;
        var tm = [1, 0, 0, 1, 0, 0];
        var line = tm.slice();
        var leading = 0;
        var size = 1;
        var stack = [];
        var at = 0;

        function push(value) {
            if (!value) return;
            items.push({ x: tm[4], y: tm[5], size: size * Math.abs(tm[3] || 1), text: value });
        }

        while (at < text.length) {
            var ch = text[at];

            if (ch === '(' || ch === '<') {
                if (ch === '<' && text[at + 1] === '<') { at += 2; continue; }
                var str = readString(text, at);
                stack.push({ str: str.value });
                at = str.end;
                continue;
            }

            var token = /^[^\s\[\]()<>/]+|^[/[\]]/.exec(text.slice(at));
            if (!token) { at++; continue; }
            var t = token[0];
            at += t.length;

            if (t === 'BT') { tm = [1, 0, 0, 1, 0, 0]; line = tm.slice(); stack = []; continue; }
            if (t === '/') {
                var name = /^[^\s/[\]()<>]+/.exec(text.slice(at));
                if (name) { stack.push({ name: name[0] }); at += name[0].length; }
                continue;
            }

            if (/^[-+]?[\d.]+$/.test(t)) { stack.push({ num: Number(t) }); continue; }

            switch (t) {
                case 'Tf':
                    size = stack.length && stack[stack.length - 1].num !== undefined ? stack[stack.length - 1].num : size;
                    var fname = null;
                    for (var i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].name) { fname = stack[i].name; break; }
                    }
                    font = fname && fonts[fname] ? fonts[fname] : null;
                    break;
                case 'Td':
                case 'TD':
                    var dy = stack.pop();
                    var dx = stack.pop();
                    if (t === 'TD' && dy) leading = -dy.num;
                    line[4] += (dx ? dx.num : 0) * line[0] + (dy ? dy.num : 0) * line[2];
                    line[5] += (dx ? dx.num : 0) * line[1] + (dy ? dy.num : 0) * line[3];
                    tm = line.slice();
                    break;
                case 'Tm':
                    var f = stack.slice(-6).map(function (s) { return s.num || 0; });
                    if (f.length === 6) { line = f.slice(); tm = f.slice(); }
                    break;
                case 'TL':
                    if (stack.length) leading = stack[stack.length - 1].num;
                    break;
                case 'T*':
                    line[4] -= leading * line[2];
                    line[5] -= leading * line[3];
                    tm = line.slice();
                    break;
                case 'Tj':
                case "'":
                case '"':
                    if (t !== 'Tj') {
                        line[4] -= leading * line[2];
                        line[5] -= leading * line[3];
                        tm = line.slice();
                    }
                    for (var s = stack.length - 1; s >= 0; s--) {
                        if (stack[s].str !== undefined) { push(decodeString(stack[s].str, font)); break; }
                    }
                    break;
                case 'TJ':
                    var joined = '';
                    stack.forEach(function (item) {
                        if (item.str !== undefined) joined += decodeString(item.str, font);
                        else if (item.num !== undefined && item.num < -120) joined += ' ';
                    });
                    push(joined);
                    break;
            }

            if (/^(Tf|Td|TD|Tm|TL|T\*|Tj|TJ|'|"|ET|Q|q|cm|BT)$/.test(t)) stack = [];
        }

        return items;
    }

    /* --- геометрия страницы ----------------------------------------------------- */

    /*
        Чертёж из PDF читается как линии, а не как картинка: план, напечатанный
        из AutoCAD или Revit, внутри лежит векторными путями. Разбираются
        операторы рисования (m, l, c, v, y, re, h и команды закраски), матрица
        преобразования (cm, q, Q), формы XObject со своей матрицей и ресурсами
        и текст — он кладётся надписями, как в DXF.

        Кривые Безье разбиваются на отрезки, заливки берутся контуром: подложке
        этого хватает, а штриховки и растры не читаются вовсе.
    */

    var MAX_NUMBERS = 2000000;

    function mul(m, n) {
        return [
            m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
        ];
    }

    function apply(m, x, y) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    }

    /** Словарь «<< … >>», начинающийся после ключа. */
    function sliceDict(tail) {
        var at = tail.indexOf('<<');
        if (at < 0) return '';
        var depth = 0;
        for (var i = at; i < tail.length - 1; i++) {
            if (tail[i] === '<' && tail[i + 1] === '<') { depth++; i++; }
            else if (tail[i] === '>' && tail[i + 1] === '>') {
                depth--;
                i++;
                if (!depth) return tail.slice(at, i + 1);
            }
        }
        return tail.slice(at);
    }

    function resourcesOf(doc, dict) {
        var at = dict.indexOf('/Resources');
        if (at < 0) return dict;

        var tail = dict.slice(at + '/Resources'.length);
        var ref = /^\s*(\d+)\s+(\d+)\s+R/.exec(tail);
        return ref ? doc.dictNum(Number(ref[1])) : sliceDict(tail);
    }

    function namedRefs(doc, resources, key) {
        var out = {};
        var at = resources.indexOf('/' + key);
        if (at < 0) return out;

        var tail = resources.slice(at + key.length + 1);
        var ref = /^\s*(\d+)\s+(\d+)\s+R/.exec(tail);
        var body = ref ? doc.dictNum(Number(ref[1])) : sliceDict(tail);

        (body.match(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+(\d+)\s+R/g) || []).forEach(function (pair) {
            var p = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+(\d+)\s+R/.exec(pair);
            out[p[1]] = Number(p[2]);
        });
        return out;
    }

    function matrixOf(dict) {
        var m = /\/Matrix\s*\[([^\]]*)\]/.exec(dict);
        if (!m) return [1, 0, 0, 1, 0, 0];
        var f = m[1].trim().split(/\s+/).map(Number);
        return f.length === 6 && f.every(isFinite) ? f : [1, 0, 0, 1, 0, 0];
    }

    /** Формы XObject страницы: содержимое, матрица, свои ресурсы и шрифты. */
    function loadForms(doc, resources, depth, forms) {
        if (depth > 4) return Promise.resolve(forms);

        var map = namedRefs(doc, resources, 'XObject');
        var jobs = [];

        Object.keys(map).forEach(function (name) {
            var num = map[name];
            if (forms[num] !== undefined) return;

            var dict = doc.dictNum(num);
            if (!/\/Subtype\s*\/Form/.test(dict)) {
                forms[num] = null;      // картинки и прочее не рисуем
                return;
            }

            var form = { matrix: matrixOf(dict), resources: resourcesOf(doc, dict), text: '', fonts: {} };
            forms[num] = form;

            jobs.push(doc.content(num).then(function (bytes) {
                form.text = bytes ? latin(bytes) : '';
                return pageFonts(doc, form.resources).then(function (fonts) {
                    form.fonts = fonts;
                    return loadForms(doc, form.resources, depth + 1, forms);
                });
            }));
        });

        return Promise.all(jobs).then(function () { return forms; });
    }

    /** Кривая Безье отрезками: шагов тем больше, чем длиннее кривая на листе. */
    function bezier(out, x0, y0, x1, y1, x2, y2, x3, y3) {
        var len = Math.abs(x1 - x0) + Math.abs(y1 - y0) + Math.abs(x2 - x1)
            + Math.abs(y2 - y1) + Math.abs(x3 - x2) + Math.abs(y3 - y2);
        var n = Math.max(2, Math.min(24, Math.ceil(len / 4)));

        for (var i = 1; i <= n; i++) {
            var t = i / n, u = 1 - t;
            out.push(
                u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
                u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
            );
        }
    }

    function runGraphics(text, env, ctm, resources, fonts, depth) {
        var xobjects = namedRefs(env.doc, resources, 'XObject');
        var stack = [];
        var states = [];
        var path = [];                  // подпути: массивы координат листа
        var current = null;
        var start = null;
        var here = null;
        var font = null;
        var size = 1;
        var tm = [1, 0, 0, 1, 0, 0];
        var line = tm.slice();
        var leading = 0;
        var at = 0;

        function nums(count) {
            var out = [];
            for (var i = stack.length - count; i < stack.length; i++) {
                out.push(stack[i] && stack[i].num !== undefined ? stack[i].num : 0);
            }
            return out.length === count ? out : null;
        }

        function moveTo(x, y) {
            var p = apply(ctm, x, y);
            current = [p[0], p[1]];
            path.push(current);
            here = [x, y];
            start = [x, y];
        }

        function lineTo(x, y) {
            if (!current) { moveTo(x, y); return; }
            var p = apply(ctm, x, y);
            current.push(p[0], p[1]);
            here = [x, y];
        }

        function curveTo(x1, y1, x2, y2, x3, y3) {
            if (!current) moveTo(x1, y1);
            var a = apply(ctm, here[0], here[1]);
            var b = apply(ctm, x1, y1);
            var c = apply(ctm, x2, y2);
            var d = apply(ctm, x3, y3);
            bezier(current, a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
            here = [x3, y3];
        }

        function paint(close) {
            path.forEach(function (sub) {
                if (sub.length < 4 || env.numbers > MAX_NUMBERS) {
                    if (env.numbers > MAX_NUMBERS) env.cut = true;
                    return;
                }
                if (close && (sub[0] !== sub[sub.length - 2] || sub[1] !== sub[sub.length - 1])) {
                    sub.push(sub[0], sub[1]);
                }
                env.numbers += sub.length;
                env.out.push({ t: 'p', v: sub });
            });
            path = [];
            current = null;
        }

        function showText(value) {
            if (!value) return;
            var m = mul(tm, ctm);
            var h = size * Math.sqrt(m[2] * m[2] + m[3] * m[3]);
            if (!(h > 0)) return;
            env.numbers += 4;
            env.out.push({ t: 't', x: m[4], y: m[5], h: h, rot: Math.atan2(m[1], m[0]), s: value });
        }

        while (at < text.length) {
            if (env.numbers > MAX_NUMBERS) { env.cut = true; break; }

            var ch = text[at];
            if (ch === '(' || (ch === '<' && text[at + 1] !== '<')) {
                var str = readString(text, at);
                stack.push({ str: str.value });
                at = str.end;
                continue;
            }
            if (ch === '<' && text[at + 1] === '<') {
                // Встроенный словарь (например, у маркированного содержимого) пропускаем.
                at += sliceDict(text.slice(at)).length || 2;
                continue;
            }

            var token = /^[^\s\[\]()<>/]+|^[/[\]]/.exec(text.slice(at));
            if (!token) { at++; continue; }
            var t = token[0];
            at += t.length;

            if (t === '/') {
                var name = /^[^\s/[\]()<>]+/.exec(text.slice(at));
                if (name) { stack.push({ name: name[0] }); at += name[0].length; }
                continue;
            }
            // Скобки массива — не оператор: «[ (…) -250 (…) ] TJ» должен дойти
            // до TJ со всеми кусками, иначе текст пропадёт.
            if (t === '[' || t === ']') continue;
            if (/^[-+]?[\d.]+$/.test(t)) { stack.push({ num: Number(t) }); continue; }

            switch (t) {
                case 'q':
                    states.push({ ctm: ctm.slice(), font: font, size: size });
                    break;
                case 'Q':
                    var s = states.pop();
                    if (s) { ctm = s.ctm; font = s.font; size = s.size; }
                    break;
                case 'cm':
                    var cm = nums(6);
                    if (cm) ctm = mul(cm, ctm);
                    break;
                case 'm':
                    var mp = nums(2);
                    if (mp) moveTo(mp[0], mp[1]);
                    break;
                case 'l':
                    var lp = nums(2);
                    if (lp) lineTo(lp[0], lp[1]);
                    break;
                case 'c':
                    var cp = nums(6);
                    if (cp) curveTo(cp[0], cp[1], cp[2], cp[3], cp[4], cp[5]);
                    break;
                case 'v':
                    var vp = nums(4);
                    if (vp && here) curveTo(here[0], here[1], vp[0], vp[1], vp[2], vp[3]);
                    break;
                case 'y':
                    var yp = nums(4);
                    if (yp) curveTo(yp[0], yp[1], yp[2], yp[3], yp[2], yp[3]);
                    break;
                case 're':
                    var r = nums(4);
                    if (r) {
                        moveTo(r[0], r[1]);
                        lineTo(r[0] + r[2], r[1]);
                        lineTo(r[0] + r[2], r[1] + r[3]);
                        lineTo(r[0], r[1] + r[3]);
                        lineTo(r[0], r[1]);
                    }
                    break;
                case 'h':
                    if (start) lineTo(start[0], start[1]);
                    break;
                case 'S': paint(false); break;
                case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
                    paint(true);
                    break;
                case 'n':
                    path = [];
                    current = null;
                    break;
                case 'BT':
                    tm = [1, 0, 0, 1, 0, 0];
                    line = tm.slice();
                    break;
                case 'Tf':
                    var fname = null;
                    for (var i = stack.length - 1; i >= 0; i--) {
                        if (stack[i].name) { fname = stack[i].name; break; }
                        if (stack[i].num !== undefined) size = stack[i].num;
                    }
                    font = fname && fonts[fname] ? fonts[fname] : null;
                    break;
                case 'Td':
                case 'TD':
                    var d = nums(2);
                    if (d) {
                        if (t === 'TD') leading = -d[1];
                        line[4] += d[0] * line[0] + d[1] * line[2];
                        line[5] += d[0] * line[1] + d[1] * line[3];
                        tm = line.slice();
                    }
                    break;
                case 'Tm':
                    var f6 = nums(6);
                    if (f6) { line = f6.slice(); tm = f6.slice(); }
                    break;
                case 'TL':
                    var tl = nums(1);
                    if (tl) leading = tl[0];
                    break;
                case 'T*':
                    line[4] -= leading * line[2];
                    line[5] -= leading * line[3];
                    tm = line.slice();
                    break;
                case 'Tj':
                case "'":
                case '"':
                    if (t !== 'Tj') {
                        line[4] -= leading * line[2];
                        line[5] -= leading * line[3];
                        tm = line.slice();
                    }
                    for (var k = stack.length - 1; k >= 0; k--) {
                        if (stack[k].str !== undefined) { showText(decodeString(stack[k].str, font)); break; }
                    }
                    break;
                case 'TJ':
                    var joined = '';
                    stack.forEach(function (item) {
                        if (item.str !== undefined) joined += decodeString(item.str, font);
                        else if (item.num !== undefined && item.num < -120) joined += ' ';
                    });
                    showText(joined);
                    break;
                case 'Do':
                    var ref = null;
                    for (var j = stack.length - 1; j >= 0; j--) {
                        if (stack[j].name) { ref = stack[j].name; break; }
                    }
                    var form = ref && xobjects[ref] !== undefined ? env.forms[xobjects[ref]] : null;
                    if (form && depth < 5) {
                        runGraphics(form.text, env, mul(form.matrix, ctm), form.resources, form.fonts, depth + 1);
                    }
                    break;
            }

            stack = [];
        }

        return env;
    }

    /** Геометрия страницы: пути и надписи в пунктах, ось Y вверх — как в DXF. */
    function pageGeometry(doc, pageNum) {
        var dict = doc.dictNum(pageNum);
        var resources = resourcesOf(doc, dict);
        var nums = contentRefs(doc, dict);

        return Promise.all([
            pageFonts(doc, resources),
            loadForms(doc, resources, 0, {}),
            Promise.all(nums.map(function (n) { return doc.content(n); }))
        ]).then(function (res) {
            var env = { doc: doc, forms: res[1], out: [], numbers: 0, cut: false };
            var text = res[2].filter(Boolean).map(latin).join('\n');
            runGraphics(text, env, [1, 0, 0, 1, 0, 0], resources, res[0], 0);
            return { ents: env.out, cut: env.cut, skipped: {} };
        });
    }

    /* --- страницы -------------------------------------------------------------- */

    /** Собрать шрифты страницы: имя в ресурсах → карта кодов. */
    function pageFonts(doc, resources) {
        var fonts = {};
        var at = resources.indexOf('/Font');
        if (at < 0) return Promise.resolve(fonts);

        var tail = resources.slice(at);
        var ref = /^\/Font\s+(\d+)\s+(\d+)\s+R/.exec(tail);
        if (ref) tail = doc.dictNum(Number(ref[1]));

        var pairs = tail.match(/\/([^\s/<>\[\]]+)\s+(\d+)\s+0\s+R/g) || [];
        var jobs = [];

        pairs.forEach(function (pair) {
            var p = /\/([^\s/<>\[\]]+)\s+(\d+)\s+0\s+R/.exec(pair);
            var name = p[1];
            var num = Number(p[2]);
            var dict = doc.dictNum(num);
            if (!/\/Font|\/Type0|\/TrueType|\/Type1/.test(dict)) return;

            var entry = { twoByte: /Identity-H|Identity-V/.test(dict), map: null };
            fonts[name] = entry;

            var uni = /\/ToUnicode\s+(\d+)\s+(\d+)\s+R/.exec(dict);
            if (uni) {
                jobs.push(doc.content(Number(uni[1])).then(function (bytes) {
                    if (bytes) entry.map = parseCMap(latin(bytes));
                }));
            }
        });

        return Promise.all(jobs).then(function () { return fonts; });
    }

    /** Куски текста страницы. */
    function pageItems(doc, pageNum) {
        var dict = doc.dictNum(pageNum);
        var resources = dict;
        var res = /\/Resources\s+(\d+)\s+(\d+)\s+R/.exec(dict);
        if (res) resources = doc.dictNum(Number(res[1]));

        return pageFonts(doc, resources).then(function (fonts) {
            var nums = contentRefs(doc, dict);
            if (!nums.length) return [];

            return Promise.all(nums.map(function (n) { return doc.content(n); })).then(function (parts) {
                var text = parts.filter(Boolean).map(latin).join('\n');
                return runContent(text, fonts);
            });
        });
    }

    /** Куски в строки: сверху вниз, слева направо. */
    function toLines(items, tolerance) {
        var tol = tolerance || 3;
        var rows = [];

        items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; }).forEach(function (item) {
            if (!item.text.trim()) return;
            var row = rows[rows.length - 1];
            if (row && Math.abs(row.y - item.y) <= tol) {
                row.items.push(item);
                return;
            }
            rows.push({ y: item.y, items: [item] });
        });

        return rows.map(function (row) {
            row.items.sort(function (a, b) { return a.x - b.x; });
            var text = '';
            var prev = null;
            row.items.forEach(function (item) {
                if (prev && item.x - prev > item.size * 0.3) text += ' ';
                text += item.text;
                prev = item.x + item.text.length * item.size * 0.5;
            });
            return { y: row.y, text: text.replace(/\s+/g, ' ').trim(), items: row.items };
        });
    }

    /** Текст всех страниц: страницы → строки. */
    function read(buffer) {
        var doc = new Doc(new Uint8Array(buffer));
        doc.scan();

        return doc.readObjectStreams().then(function () {
            var pages = Object.keys(doc.objects).filter(function (n) {
                return /\/Type\s*\/Page(\s|\/|>|$)/.test(doc.dictNum(Number(n)));
            }).map(Number).sort(function (a, b) { return a - b; });

            return Promise.all(pages.map(function (n) {
                return pageItems(doc, n).then(function (items) {
                    return { page: n, items: items, lines: toLines(items) };
                });
            }));
        });
    }

    /** Размер листа: /CropBox или /MediaBox, можно унаследованный от /Pages. */
    function boxOf(doc, num) {
        var dict = doc.dictNum(num);

        for (var step = 0; step < 5 && dict; step++) {
            var box = /\/(?:Crop|Media)Box\s*\[([^\]]*)\]/.exec(dict);
            if (box) {
                var f = box[1].trim().split(/\s+/).map(Number);
                if (f.length === 4 && f.every(isFinite)) return f;
            }
            var parent = /\/Parent\s+(\d+)\s+(\d+)\s+R/.exec(dict);
            dict = parent ? doc.dictNum(Number(parent[1])) : '';
        }

        return [0, 0, 595.28, 841.89];
    }

    /** Номера объектов страниц по порядку листов. */
    function pagesOf(doc) {
        var nums = Object.keys(doc.objects).filter(function (n) {
            return /\/Type\s*\/Page(\s|\/|>|$)/.test(doc.dictNum(Number(n)));
        }).map(Number);

        // Порядок листов — как в /Kids, а что не нашлось, идёт по номерам.
        var order = [];
        Object.keys(doc.objects).forEach(function (n) {
            var dict = doc.dictNum(Number(n));
            if (!/\/Type\s*\/Pages/.test(dict)) return;
            var kids = /\/Kids\s*\[([^\]]*)\]/.exec(dict);
            if (kids) refsIn(kids[1]).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
        });

        var sorted = order.filter(function (n) { return nums.indexOf(n) >= 0; });
        nums.sort(function (a, b) { return a - b; }).forEach(function (n) {
            if (sorted.indexOf(n) < 0) sorted.push(n);
        });

        return sorted;
    }

    /** Открыть файл и перечислить страницы с размерами листа в пунктах. */
    function open(buffer) {
        var doc = new Doc(new Uint8Array(buffer));
        doc.scan();

        return doc.readObjectStreams().then(function () {
            return {
                doc: doc,
                pages: pagesOf(doc).map(function (n) {
                    var b = boxOf(doc, n);
                    return { num: n, w: Math.abs(b[2] - b[0]), h: Math.abs(b[3] - b[1]) };
                })
            };
        });
    }

    return {
        Doc: Doc,
        pagesOf: pagesOf,
        read: read,
        open: open,
        geometry: pageGeometry,
        toLines: toLines,
        parseCMap: parseCMap,
        readString: readString
    };
})();
