'use strict';

/*
    Заполнение бланка задания бюро — правка его же .xlsx.

    Бланк — это ZIP с XML внутри, как и .docx записки. Поэтому выгрузка идёт не
    «похожей таблицей», а самим бланком: штамп, подсказки в ячейках, печать и
    листы остаются от бюро, а программа подставляет шапку и строки задания.

    Что меняется:
      — ячейки шапки: объект, шифр, этап, стадия, дата, ревизия, подписи;
      — строки таблицы с тринадцатой и ниже: старые убираются, новые пишутся
        со стилями ячеек бланка — их берём у первой строки-образца.

    Значения пишутся «встроенной строкой» (inlineStr): так не приходится
    трогать общий словарь строк книги. Итог в столбце «Общее» остаётся
    формулой H+I — бланк считает его сам.

    Лист пересчёта (calcChain) из архива убирается: он помнит, в каких ячейках
    были формулы, и после замены строк врал бы Excel. Excel соберёт его заново.
*/

var TaskForm = (function () {

    /** Колонки бланка: буква столбца → что в неё идёт. */
    var COL = {
        num: 'B', code: 'C', room: 'D', category: 'E', name: 'F', note: 'G',
        work: 'H', reserve: 'I', total: 'J', power: 'K', voltage: 'L',
        telemetry: 'M', protocol: 'N', remark: 'O', el: 'P', ss: 'Q'
    };

    var FIRST_ROW = 13;

    function text(bytes) {
        return Zip.decode(bytes);
    }

    /*
        Бланк, в который заполняется задание: загруженный в книгу — если его
        загрузили, иначе встроенный бланк бюро. Выгрузка всегда идёт в форму,
        а не «в похожую таблицу».
    */
    function blankOf(book) {
        var own = book && book.task && book.task.template;
        if (own && own.data) return own;
        return typeof TaskBlank === 'undefined' ? null : TaskBlank;
    }

    function esc(value) {
        return Zip.xml(String(value === null || value === undefined ? '' : value));
    }

    /** Имя файла листа, на котором лежит задание: первый лист книги. */
    function sheetPath(zip) {
        var book = zip.map['xl/workbook.xml'];
        if (!book) throw new Error('это не книга Excel.');

        var first = text(book.bytes).match(/<sheet[^>]*r:id="([^"]+)"/);
        if (!first) throw new Error('в книге нет листов.');

        var rels = zip.map['xl/_rels/workbook.xml.rels'];
        if (!rels) throw new Error('в книге нет связей листов.');

        var re = new RegExp('Id="' + first[1] + '"[^>]*Target="([^"]+)"');
        var target = text(rels.bytes).match(re);
        if (!target) throw new Error('первый лист книги не найден.');

        var path = target[1].replace(/^\//, '');
        return path.indexOf('xl/') === 0 ? path : 'xl/' + path;
    }

    /** Бланк ли это: есть лист и на нём строки таблицы. */
    function check(bytes) {
        return Zip.read(bytes.buffer ? bytes.buffer : bytes).then(function (zip) {
            var path = sheetPath(zip);
            var sheet = zip.map[path];
            if (!sheet) throw new Error('лист задания не найден.');

            var xml = text(sheet.bytes);
            if (xml.indexOf('<row r="' + FIRST_ROW + '"') < 0) {
                throw new Error('в бланке нет строки ' + FIRST_ROW + ' — таблица задания начинается не там.');
            }
            return { path: path };
        });
    }

    /* --- разбор строки-образца --------------------------------------------- */

    /** Стили ячеек строки-образца: столбец → номер стиля бланка. */
    function stylesOf(xml, row) {
        var out = {};
        var match = xml.match(new RegExp('<row r="' + row + '"[\\s\\S]*?</row>'));
        if (!match) return out;

        var re = /<c r="([A-Z]+)\d+"([^>]*)>/g;
        var cell;

        while ((cell = re.exec(match[0])) !== null) {
            var style = cell[2].match(/ s="(\d+)"/);
            out[cell[1]] = style ? style[1] : null;
        }
        return out;
    }

    function cell(ref, style, value, isNumber, formula) {
        var s = style === null || style === undefined ? '' : ' s="' + style + '"';

        if (formula) {
            return '<c r="' + ref + '"' + s + '><f>' + esc(formula) + '</f><v>' + esc(value) + '</v></c>';
        }
        if (value === '' || value === null || value === undefined) {
            return '<c r="' + ref + '"' + s + '/>';
        }
        if (isNumber) {
            return '<c r="' + ref + '"' + s + '><v>' + esc(value) + '</v></c>';
        }
        return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
    }

    /** Высота строки по длине описания — Excel сам её не подберёт. */
    function heightOf(note) {
        var lines = 0;
        String(note || '').split('\n').forEach(function (line) {
            lines += Math.max(1, Math.ceil(line.length / 105));
        });
        return Math.min(300, Math.max(30, lines * 15));
    }

    function number(value) {
        if (value === '' || value === null || value === undefined) return null;
        var parsed = typeof value === 'number' ? value : Fmt.parse(String(value));
        return parsed === null ? null : parsed;
    }

    /* --- правка ячеек бланка -------------------------------------------------- */

    /** Номер столбца по букве: A → 1, B → 2, …, AA → 27. */
    function colIndex(letter) {
        var n = 0;
        for (var i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
        return n;
    }

    /*
        Заполнить строку бланка значениями, не трогая в ней ничего больше.
        Ячейка остаётся своей: у неё берутся стиль и место, меняется только
        содержимое. Чего в строке нет — вставляется на своё место по порядку
        столбцов. Столбцы, которых нет в списке (номер позиции, формула «Общее»,
        графы согласования), бланк хранит сам.
    */
    function fillRow(rowText, values, styles) {
        var out = rowText;

        Object.keys(values).forEach(function (letter) {
            var value = values[letter];
            var ref = letter + (value.row);
            var re = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
            var found = out.match(re);

            if (found) {
                var attrs = found[1].replace(/ t="[^"]*"/, '');
                out = out.replace(re, body(ref, attrs, value));
                return;
            }

            // Ячейки в бланке нет — ставим её по порядку столбцов, со стилем образца.
            var attrsNew = styles[letter] === undefined || styles[letter] === null
                ? '' : ' s="' + styles[letter] + '"';
            var index = colIndex(letter);
            var at = out.length - '</row>'.length;
            var re2 = /<c r="([A-Z]+)\d+"/g;
            var cell;

            while ((cell = re2.exec(out)) !== null) {
                if (colIndex(cell[1]) > index) { at = cell.index; break; }
            }

            out = out.slice(0, at) + body(ref, attrsNew, value) + out.slice(at);
        });

        return out;
    }

    /** Содержимое ячейки: число, строка или пусто. */
    function body(ref, attrs, value) {
        if (value.number !== null && value.number !== undefined) {
            return '<c r="' + ref + '"' + attrs + '><v>' + esc(value.number) + '</v></c>';
        }
        if (value.text === '' || value.text === null || value.text === undefined) {
            return '<c r="' + ref + '"' + attrs + '/>';
        }
        return '<c r="' + ref + '"' + attrs + ' t="inlineStr"><is><t xml:space="preserve">'
            + esc(value.text) + '</t></is></c>';
    }

    /** Что идёт в строку задания: позиция или пусто, если позиций меньше. */
    function valuesOf(row, at) {
        var out = {};

        function put(key, text, num) {
            out[COL[key]] = { row: at, text: text, number: num === undefined ? null : num };
        }

        if (!row) {
            // Строка бланка свободна: очищаем поля, номер и формулы бланка не трогаем.
            ['code', 'room', 'category', 'name', 'note', 'work', 'reserve', 'power', 'voltage', 'remark']
                .forEach(function (key) { put(key, ''); });
            put('telemetry', 'Нет');
            put('protocol', '-');
            return out;
        }

        var work = Number(row.work) || 0;
        var reserve = Number(row.reserve) || 0;
        var power = number(row.power);
        var voltage = number(row.voltage);

        put('code', row.code || '');
        put('room', row.room || '');
        put('category', row.category || '');
        put('name', row.name || '');
        put('note', row.note || '');
        // Там, где штук не считают (арматура, связь, головки), клетки пустые.
        put('work', '', work > 0 ? work : undefined);
        put('reserve', '', work > 0 ? reserve : undefined);
        put('power', power === null ? '' : '', power === null ? undefined : power);
        put('voltage', voltage === null ? '' : '', voltage === null ? undefined : voltage);
        put('telemetry', row.telemetry || 'Нет');
        put('protocol', row.protocol || '-');
        put('remark', row.remark || '');
        return out;
    }

    /* --- сборка строк задания ----------------------------------------------- */

    function rowXml(row, index, styles, blank) {
        var at = FIRST_ROW + index;
        var work = Number(row.work) || 0;
        var reserve = Number(row.reserve) || 0;
        var power = number(row.power);
        var voltage = number(row.voltage);
        var cells = [];

        function put(key, value, isNumber, formula) {
            cells.push(cell(COL[key] + at, styles[COL[key]], value, isNumber, formula));
        }

        put('num', index + 1, true);

        if (blank) {
            // Пустая строка бланка: номер, нули и прочерки — как в форме бюро.
            put('code', '');
            put('room', '');
            put('category', '');
            put('name', '');
            put('note', '');
            put('work', '');
            put('reserve', '');
            put('total', 0, true, COL.work + at + '+' + COL.reserve + at);
            put('power', '');
            put('voltage', '');
            put('telemetry', 'Нет');
            put('protocol', '-');
            put('remark', '');
            put('el', '-');
            put('ss', '-');
            return '<row r="' + at + '">' + cells.join('') + '</row>';
        }

        put('code', row.code || '');
        put('room', row.room || '');
        put('category', row.category || '');
        put('name', row.name || '');
        put('note', row.note || '');
        put('work', work, true);
        put('reserve', reserve, true);
        put('total', work + reserve, true, COL.work + at + '+' + COL.reserve + at);
        put('power', power === null ? '' : power, power !== null);
        put('voltage', voltage === null ? '' : voltage, voltage !== null);
        put('telemetry', row.telemetry || 'Нет');
        put('protocol', row.protocol || '-');
        put('remark', row.remark || '');
        put('el', '-');
        put('ss', '-');

        return '<row r="' + at + '" ht="' + heightOf(row.note) + '" customHeight="1">' + cells.join('') + '</row>';
    }

    /* --- шапка --------------------------------------------------------------- */

    /**
     * Заменить значение одной ячейки шапки. Ячейка в бланке уже есть: у неё
     * берутся стиль и место, меняется только содержимое.
     */
    function setCell(xml, ref, value) {
        var re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
        var found = xml.match(re);
        if (!found) return xml;

        var attrs = found[1].replace(/ t="[^"]*"/, '');
        return xml.replace(re, '<c r="' + ref + '"' + attrs + ' t="inlineStr"><is><t xml:space="preserve">'
            + esc(value) + '</t></is></c>');
    }

    function header(xml, book) {
        var t = book.task;
        var o = book.object;

        xml = setCell(xml, 'B3', 'Объект: ' + (o.name || ''));
        xml = setCell(xml, 'G4', 'Шифр: ' + (o.code || ''));
        xml = setCell(xml, 'H4', t.step || '');
        xml = setCell(xml, 'H5', t.stage || '');
        xml = setCell(xml, 'H6', t.date || todayText());
        xml = setCell(xml, 'H7', t.revision || '');
        xml = setCell(xml, 'O5', t.developer || '');
        xml = setCell(xml, 'O6', t.issuer || '');
        xml = setCell(xml, 'O7', t.receiver || '');
        return xml;
    }

    function todayText() {
        var d = new Date();
        function two(v) { return (v < 10 ? '0' : '') + v; }
        return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    /* --- сборка архива -------------------------------------------------------- */

    /*
        Бланк считает «Общее» формулой H+I, но держит рядом последнее
        посчитанное значение — его Excel и показывает, пока не пересчитает
        книгу. После подстановки новых чисел старые итоги врали бы, поэтому
        книге ставится пометка «пересчитать при открытии».
    */
    function recalcOnLoad(xml) {
        if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(xml)) return xml;
        if (/<calcPr[^>]*\/>/.test(xml)) {
            return xml.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
        }
        return xml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    }

    /** Убрать часть из архива вместе со следами в описи и связях. */
    function dropPart(entries, name) {
        return entries.filter(function (e) { return e.name !== name; }).map(function (e) {
            if (e.name === '[Content_Types].xml') {
                var xml = text(e.bytes).replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
                return { name: e.name, text: xml };
            }
            if (e.name === 'xl/_rels/workbook.xml.rels') {
                var rels = text(e.bytes).replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, '');
                return { name: e.name, text: rels };
            }
            return e;
        });
    }

    /**
     * Заполнить бланк из книги. Возвращает байты готового .xlsx.
     */
    function fill(book, rows) {
        var template = blankOf(book);
        if (!template) return Promise.reject(new Error('бланк не найден.'));

        var bytes = Zip.fromBase64(template.data);

        return Zip.read(bytes.buffer).then(function (zip) {
            var path = sheetPath(zip);
            var sheet = zip.map[path];
            if (!sheet) throw new Error('лист задания не найден.');

            var xml = text(sheet.bytes);
            var styles = stylesOf(xml, FIRST_ROW);

            /*
                Бланк остаётся бланком: его строки, стили, формулы и высоты не
                перебираются заново — в них только подставляются значения. Так
                выгрузка выглядит ровно как файл бюро, просто заполненный.
            */
            var last = FIRST_ROW - 1;
            xml = xml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, function (whole, num, attrs, inner) {
                var at = Number(num);
                if (at < FIRST_ROW) return whole;

                last = Math.max(last, at);
                var row = rows[at - FIRST_ROW];
                var filled = fillRow('<row>' + inner + '</row>', valuesOf(row, at), styles);
                var height = row ? heightOf(row.note) : 0;

                /*
                    Высота строки идёт за описанием: оно в бланке разное по
                    длине. У строки, которая осталась свободной, высота бланка
                    снимается — иначе от прежнего задания остался бы пустой
                    провал в полстраницы.
                */
                var bare = attrs.replace(/ ht="[^"]*"/, '').replace(/ customHeight="[^"]*"/, '');
                var head = height > 0 ? bare + ' ht="' + height + '" customHeight="1"' : bare;

                return '<row r="' + num + '"' + head + '>'
                    + filled.slice('<row>'.length, filled.length - '</row>'.length) + '</row>';
            });

            // Позиций больше, чем строк в бланке — дописываем такие же.
            var extra = [];
            for (var i = last - FIRST_ROW + 1; i < rows.length; i++) {
                extra.push(rowXml(rows[i], i, styles, false));
            }
            if (extra.length) xml = xml.replace('</sheetData>', extra.join('') + '</sheetData>');

            xml = header(xml, book);

            var entries = zip.files.map(function (f) {
                if (f.name === path) return { name: f.name, text: xml };
                if (f.name === 'xl/workbook.xml') return { name: f.name, text: recalcOnLoad(text(f.bytes)) };
                return { name: f.name, bytes: f.bytes };
            });

            // Дописали строки — лист пересчёта бланка о них не знает; пусть Excel соберёт заново.
            return Zip.create(extra.length ? dropPart(entries, 'xl/calcChain.xml') : entries);
        });
    }

    /* --- своя форма бланка -------------------------------------------------- */

    var WIDTHS = [3.14, 13.71, 19, 23.57, 27, 108.43, 7.29, 7.43, 7.43, 6.29, 6.29, 6.43, 9.86, 42.43, 5.43, 5.29];

    function dateText(t) {
        if (t.date) return t.date;
        return todayText();
    }

    function V(value, style) { return { v: value, s: style }; }

    function sheets(book, rows) {
        var t = book.task;
        var o = book.object;
        var list = rows || Task.rows(book);
        var grid = [];
        var heights = {};
        var merges = ['B2:Q2', 'B3:Q3', 'B4:F4', 'H4:K4', 'L4:N4', 'O4:Q4',
            'B5:E5', 'H5:I5', 'L5:N5', 'O5:Q5', 'B6:E6', 'H6:I6', 'L6:N6', 'O6:Q6',
            'B7:E7', 'H7:I7', 'L7:N7', 'O7:Q7', 'B9:Q9',
            'B10:B11', 'C10:C11', 'D10:D11', 'E10:G10', 'H10:J10', 'K10:K11', 'L10:L11',
            'M10:M11', 'N10:N11', 'O10:O11', 'P10:P11', 'Q10:Q11', 'E12:N12'];

        function put(row, col, value, style) {
            if (!grid[row - 1]) grid[row - 1] = [];
            grid[row - 1][col - 1] = style ? V(value, style) : value;
        }

        put(2, 2, 'Задание от АПТ для ЭЛ и СС', 'formTitle');
        put(3, 2, 'Объект: ' + (o.name || ''), 'field');
        heights[3] = 49.5;

        put(4, 2, 'Обозначения для изменений', 'label');
        put(4, 7, 'Шифр: ' + (o.code || ''), 'field');
        put(4, 8, t.step, 'field');

        put(5, 2, 'Добавленная позиция', 'field');
        put(5, 7, 'Стадия проектирования:', 'label');
        put(5, 8, t.stage, 'field');
        put(5, 12, 'Разработал', 'label');
        put(5, 15, t.developer, 'field');

        put(6, 2, 'Измененная позиция', 'field');
        put(6, 7, 'Дата выдачи:', 'label');
        put(6, 8, dateText(t), 'field');
        put(6, 12, 'Выдал', 'label');
        put(6, 15, t.issuer, 'field');

        put(7, 2, 'Удаленная позиция', 'field');
        put(7, 7, 'Ревизия задания:', 'label');
        put(7, 8, t.revision, 'field');
        put(7, 12, 'Принял', 'label');
        put(7, 15, t.receiver, 'field');

        put(9, 2, 'Задание', 'label');

        // Шапка таблицы: два яруса, как в бланке.
        put(10, 2, 'N', 'head');
        put(10, 3, 'Проектный номер', 'head');
        put(10, 4, 'Номер помещения', 'head');
        put(10, 5, 'Оборудование требующее подключения', 'head');
        put(10, 8, 'Количество', 'head');
        put(10, 11, 'Нагрузка на единицу кВт', 'head');
        put(10, 12, 'Напряжение, В', 'head');
        put(10, 13, 'Диспетчеризация требуется?', 'head');
        put(10, 14, 'Протокол диспетчеризации', 'head');
        put(10, 15, 'Примечание', 'head');
        put(10, 16, 'Согласование раздела ЭЛ', 'head');
        put(10, 17, 'Согласование раздела СС', 'head');
        heights[10] = 30;

        put(11, 5, 'Категория оборудования', 'head');
        put(11, 6, 'Наименование', 'head');
        put(11, 7, 'Описание', 'head');
        put(11, 8, 'Рабочие', 'head');
        put(11, 9, 'Резервные', 'head');
        put(11, 10, 'Общее', 'head');
        heights[11] = 96;

        put(12, 3, 'ТД+Р', 'center');
        put(12, 4, 'П', 'center');
        put(12, 5, 'П+ТД+Р', 'center');

        var at = 13;
        list.forEach(function (row, i) {
            var work = Number(row.work) || 0;
            var reserve = Number(row.reserve) || 0;

            put(at, 2, i + 1, 'center');
            put(at, 3, row.code || '', 'center');
            put(at, 4, row.room || '', 'wrap');
            put(at, 5, row.category || '', 'wrap');
            put(at, 6, row.name || '', 'wrap');
            put(at, 7, row.note || '', 'wrap');
            // Там, где штук не считают, клетки количества пустые — как в бланке.
            put(at, 8, work > 0 ? work : '', 'center');
            put(at, 9, work > 0 ? reserve : '', 'center');
            put(at, 10, work + reserve, 'center');
            put(at, 11, row.power === '' ? '' : Fmt.parse(String(row.power)) === null ? row.power : Fmt.parse(String(row.power)), 'center');
            put(at, 12, row.voltage === '' ? '' : Number(row.voltage) || row.voltage, 'center');
            put(at, 13, row.telemetry || 'Нет', 'center');
            put(at, 14, row.protocol || '-', 'center');
            put(at, 15, row.remark || '', 'wrap');
            put(at, 16, '-', 'center');
            put(at, 17, '-', 'center');
            heights[at] = heightOf(row.note);
            at++;
        });

        // Пустые строки бланка: номер стоит, остальное дозаполняют руками.
        for (var k = 0; k < 10; k++) {
            put(at, 2, list.length + k + 1, 'center');
            put(at, 10, 0, 'center');
            put(at, 13, 'Нет', 'center');
            put(at, 14, '-', 'center');
            put(at, 16, '-', 'center');
            put(at, 17, '-', 'center');
            at++;
        }

        var widths = [3.43].concat(WIDTHS);
        var last = at - 1;

        var data = [
            ['Категория оборудования', 'Диспетчеризация', 'Протокол диспетчеризации'],
            [], [], []
        ];
        data = [['Категория оборудования', 'Диспетчеризация', 'Протокол диспетчеризации']];
        var depth = Math.max(Task.CATEGORIES.length, Task.PROTOCOLS.length, 2);
        for (var d = 0; d < depth; d++) {
            data.push([
                Task.CATEGORIES[d] || '',
                d === 0 ? 'Да' : d === 1 ? 'Нет' : '',
                Task.PROTOCOLS[d] || ''
            ]);
        }

        return [
            {
                name: 'Задание от АПТ для ЭЛ и СС',
                grid: grid,
                widths: widths,
                heights: heights,
                merges: merges,
                validations: [
                    { ref: 'E13:E' + last, list: "'Данные'!$A$2:$A$" + (Task.CATEGORIES.length + 1) },
                    { ref: 'M13:M' + last, list: "'Данные'!$B$2:$B$3" },
                    { ref: 'N13:N' + last, list: "'Данные'!$C$2:$C$" + (Task.PROTOCOLS.length + 1) }
                ]
            },
            { name: 'Данные', grid: data, widths: [34, 18, 26] }
        ];
    }
    return {
        COL: COL,
        FIRST_ROW: FIRST_ROW,
        check: check,
        fill: fill,
        stylesOf: stylesOf,
        heightOf: heightOf,
        blankOf: blankOf,
        sheets: sheets
    };
})();
