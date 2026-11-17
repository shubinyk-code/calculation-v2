/*
    Книга Excel (.xlsx) без библиотек.

    Числа записываются ЧИСЛАМИ, а не текстом: инженер открывает выгрузку, чтобы
    считать дальше. Текст в ячейке это ломает.

    Два вида листов:

      blocks — поток заголовков, примечаний и таблиц, адреса ячеек складываются
               сами (прежний формат из WaterSewerWeb):
                 { name, blocks: [{ kind: 'title'|'note'|'table', ... }] }

      grid   — точная сетка: строка и столбец ячейки известны заранее, поэтому
               на неё можно ссылаться формулами с других ячеек и листов:
                 { name, grid: [[ячейка, ...], ...], widths: [...] }
               Для бланков у сетки есть ещё три необязательных поля:
                 merges     — ['B2:Q2', …] объединённые ячейки;
                 heights    — { 13: 90 } высота строки в пунктах;
                 validations — [{ ref: 'M13:M40', list: 'Данные!$B$2:$B$3' }]
                               или { ref, values: ['Да', 'Нет'] } — выпадающий
                               список в ячейке.

    Ячейка сетки — число, строка или объект { v, f, s }:
      v — значение (у формулы — последнее вычисленное, его видно без пересчёта);
      f — формула без знака «=», в английской записи: SQRT, SUMIFS, точка в числах.
          Excel сам покажет её на языке пользователя;
      s — стиль: title, note, head, text, num, num2, num3, input, inputSci,
          group, totalText, totalNum2.

    Книга помечается «пересчитать при открытии»: кэшированные значения нужны
    только программам просмотра, Excel всё считает заново по формулам.
*/

var Xlsx = (function () {
    'use strict';

    /* Номера соответствуют порядку в cellXfs. */
    var STYLE = {
        plain: 0,
        title: 1,
        note: 2,
        head: 3,
        text: 4,
        num: 5,
        totalText: 6,
        totalNum: 7,
        num2: 8,
        totalNum2: 9,
        input: 10,
        group: 11,
        num3: 12,
        inputSci: 13,
        // Бланк задания: заголовок, подпись поля, значение, по центру, описание.
        formTitle: 14,
        label: 15,
        field: 16,
        center: 17,
        wrap: 18
    };

    function styleIndex(key) {
        return STYLE[key] !== undefined ? STYLE[key] : STYLE.text;
    }

    /* --- адреса ячеек ---------------------------------------------------- */

    function column(index) {
        var name = '';
        var n = index;

        do {
            name = String.fromCharCode(65 + (n % 26)) + name;
            n = Math.floor(n / 26) - 1;
        } while (n >= 0);

        return name;
    }

    /*
        Двенадцать значащих цифр. Округлять до знаков после запятой нельзя:
        коэффициент узла управления 3,858·10⁻⁸ превратился бы в ноль.
    */
    function number(value) {
        return String(Number(value.toPrecision(12)));
    }

    function cell(value, style, columnIndex, rowIndex) {
        var reference = column(columnIndex) + rowIndex;

        if (value !== null && typeof value === 'object') {
            var s = value.s !== undefined ? styleIndex(value.s) : style;

            if (value.f) {
                var formula = '<f>' + Zip.xml(value.f) + '</f>';
                var cached = value.v;

                if (typeof cached === 'number' && isFinite(cached)) {
                    return '<c r="' + reference + '" s="' + s + '">' + formula + '<v>' + number(cached) + '</v></c>';
                }
                if (typeof cached === 'string') {
                    return '<c r="' + reference + '" s="' + s + '" t="str">' + formula + '<v>' + Zip.xml(cached) + '</v></c>';
                }
                return '<c r="' + reference + '" s="' + s + '">' + formula + '</c>';
            }

            return cell(value.v, s, columnIndex, rowIndex);
        }

        if (value === null || value === undefined || value === '') {
            return '<c r="' + reference + '" s="' + style + '"/>';
        }

        if (typeof value === 'number' && isFinite(value)) {
            return '<c r="' + reference + '" s="' + style + '"><v>' + number(value) + '</v></c>';
        }

        return '<c r="' + reference + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">'
            + Zip.xml(value) + '</t></is></c>';
    }

    function colsXml(widths, widest) {
        if (!widths || !widths.length) return '';

        var parts = [];
        for (var w = 0; w < Math.max(widths.length, widest || 0); w++) {
            parts.push('<col min="' + (w + 1) + '" max="' + (w + 1) + '" width="'
                + (widths[w] || 12) + '" customWidth="1"/>');
        }
        return '<cols>' + parts.join('') + '</cols>';
    }

    /*
        Порядок частей листа задан схемой: сначала столбцы и строки, потом
        объединения и только затем проверки ввода. Excel не прощает перестановки
        — файл откажется открываться.
    */
    function worksheet(cols, rows, extra) {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>'
            + cols
            + '<sheetData>' + rows.join('') + '</sheetData>'
            + (extra || '')
            + '</worksheet>';
    }

    function mergesXml(list) {
        if (!list || !list.length) return '';
        return '<mergeCells count="' + list.length + '">'
            + list.map(function (ref) { return '<mergeCell ref="' + Zip.xml(ref) + '"/>'; }).join('')
            + '</mergeCells>';
    }

    /*
        Выпадающий список: либо ссылкой на столбец листа данных, либо перечнем
        прямо в проверке. Перечень Excel держит до 255 символов, поэтому длинные
        списки всегда уходят на лист.
    */
    function validationsXml(list) {
        if (!list || !list.length) return '';

        return '<dataValidations count="' + list.length + '">' + list.map(function (v) {
            var formula = v.list ? v.list : '"' + v.values.join(',') + '"';
            return '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"'
                + ' sqref="' + Zip.xml(v.ref) + '"><formula1>' + Zip.xml(formula) + '</formula1></dataValidation>';
        }).join('') + '</dataValidations>';
    }

    /* --- лист-сетка ------------------------------------------------------ */

    function gridSheet(model) {
        var rows = [];
        var widest = 0;

        for (var r = 0; r < model.grid.length; r++) {
            var line = model.grid[r];
            if (!line) continue;

            var cells = [];
            for (var c = 0; c < line.length; c++) {
                var value = line[c];
                if (value === null || value === undefined) continue;
                var style = typeof value === 'number' ? STYLE.num : STYLE.text;
                cells.push(cell(value, style, c, r + 1));
            }

            if (cells.length) {
                var height = model.heights ? model.heights[r + 1] : 0;
                rows.push('<row r="' + (r + 1) + '"'
                    + (height > 0 ? ' ht="' + height + '" customHeight="1"' : '') + '>'
                    + cells.join('') + '</row>');
                widest = Math.max(widest, line.length);
            }
        }

        return worksheet(colsXml(model.widths, widest), rows,
            mergesXml(model.merges) + validationsXml(model.validations));
    }

    /* --- лист-поток ------------------------------------------------------ */

    function sheet(model) {
        if (model.grid) return gridSheet(model);

        var rows = [];
        var at = 1;
        var widest = 0;
        var widths = null;

        for (var b = 0; b < model.blocks.length; b++) {
            var block = model.blocks[b];

            if (block.kind === 'title') {
                if (at > 1) at++;
                rows.push('<row r="' + at + '" ht="18" customHeight="1">'
                    + cell(block.text, STYLE.title, 0, at) + '</row>');
                at++;
                continue;
            }

            if (block.kind === 'note' || block.kind === 'mono') {
                rows.push('<row r="' + at + '">' + cell(block.text, STYLE.note, 0, at) + '</row>');
                at++;
                continue;
            }

            if (block.kind !== 'table') continue;

            if (block.widths && block.widths.length > (widths ? widths.length : 0)) {
                widths = block.widths;
            }

            var head = block.head || [];
            var line = [];
            var c;

            if (head.length) {
                for (c = 0; c < head.length; c++) line.push(cell(head[c], STYLE.head, c, at));
                rows.push('<row r="' + at + '" ht="30" customHeight="1">' + line.join('') + '</row>');
                at++;
                if (head.length > widest) widest = head.length;
            }

            for (var r = 0; r < block.rows.length; r++) {
                var source = block.rows[r];
                var last = block.total !== undefined && r >= block.total;

                line = [];

                for (c = 0; c < source.length; c++) {
                    var value = source[c];
                    var numeric = typeof value === 'number' && isFinite(value);

                    var style = last
                        ? (numeric ? STYLE.totalNum : STYLE.totalText)
                        : (numeric ? STYLE.num : STYLE.text);

                    line.push(cell(value, style, c, at));
                }

                rows.push('<row r="' + at + '">' + line.join('') + '</row>');
                at++;

                if (source.length > widest) widest = source.length;
            }

            at++;
        }

        return worksheet(colsXml(widths, widest), rows);
    }

    /* --- оформление ------------------------------------------------------ */

    function styles() {
        var thin = '<left style="thin"><color rgb="FFC3D6E8"/></left>'
            + '<right style="thin"><color rgb="FFC3D6E8"/></right>'
            + '<top style="thin"><color rgb="FFC3D6E8"/></top>'
            + '<bottom style="thin"><color rgb="FFC3D6E8"/></bottom>';

        function xf(numFmt, font, fill, border, align) {
            return '<xf xfId="0" numFmtId="' + numFmt + '" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '"'
                + ' applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
                + '<alignment ' + align + '/></xf>';
        }

        var LEFT = 'horizontal="left" vertical="center" wrapText="1"';
        var RIGHT = 'horizontal="right" vertical="center"';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'

            + '<numFmts count="2">'
            + '<numFmt numFmtId="164" formatCode="0.000"/>'
            + '<numFmt numFmtId="165" formatCode="0.0000E+00"/>'
            + '</numFmts>'

            + '<fonts count="7">'
            + '<font><sz val="10"/><name val="Segoe UI"/></font>'
            + '<font><b/><sz val="12"/><color rgb="FF1D6FB8"/><name val="Segoe UI"/></font>'
            + '<font><i/><sz val="9"/><color rgb="FF5B7186"/><name val="Segoe UI"/></font>'
            + '<font><b/><sz val="10"/><name val="Segoe UI"/></font>'
            + '<font><sz val="10"/><color rgb="FF1B2A38"/><name val="Segoe UI"/></font>'
            + '<font><b/><sz val="10"/><color rgb="FF1D6FB8"/><name val="Segoe UI"/></font>'
            + '<font><b/><sz val="14"/><name val="Segoe UI"/></font>'
            + '</fonts>'

            + '<fills count="5">'
            + '<fill><patternFill patternType="none"/></fill>'
            + '<fill><patternFill patternType="gray125"/></fill>'
            + '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3FB"/><bgColor indexed="64"/></patternFill></fill>'
            + '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE7F2"/><bgColor indexed="64"/></patternFill></fill>'
            + '<fill><patternFill patternType="solid"><fgColor rgb="FFDDF3E6"/><bgColor indexed="64"/></patternFill></fill>'
            + '</fills>'

            + '<borders count="2">'
            + '<border><left/><right/><top/><bottom/><diagonal/></border>'
            + '<border>' + thin + '<diagonal/></border>'
            + '</borders>'

            + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'

            + '<cellXfs count="19">'
            + '<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>'          // 0 обычная
            + xf(0, 1, 0, 0, 'vertical="center"')                                     // 1 заголовок
            + xf(0, 2, 0, 0, 'vertical="center"')                                     // 2 примечание
            + xf(0, 3, 2, 1, 'horizontal="center" vertical="center" wrapText="1"')    // 3 шапка
            + xf(0, 4, 0, 1, LEFT)                                                    // 4 текст
            + xf(0, 4, 0, 1, RIGHT)                                                   // 5 число
            + xf(0, 3, 3, 1, LEFT)                                                    // 6 итог, текст
            + xf(0, 3, 3, 1, RIGHT)                                                   // 7 итог, число
            + xf(2, 4, 0, 1, RIGHT)                                                   // 8 число 0,00
            + xf(2, 3, 3, 1, RIGHT)                                                   // 9 итог 0,00
            + xf(0, 4, 4, 1, RIGHT)                                                   // 10 ввод
            + xf(0, 5, 2, 1, 'horizontal="left" vertical="center"')                   // 11 группа
            + xf(164, 4, 0, 1, RIGHT)                                                 // 12 число 0,000
            + xf(165, 4, 4, 1, RIGHT)                                                 // 13 ввод 0,0000E+00
            // Бланк задания: заголовок, подписи полей, текст по центру ячейки.
            + xf(0, 6, 0, 0, 'horizontal="center" vertical="center" wrapText="1"')    // 14 название бланка
            + xf(0, 3, 0, 0, 'horizontal="left" vertical="center"')                   // 15 подпись поля
            + xf(0, 4, 0, 0, 'horizontal="left" vertical="center" wrapText="1"')      // 16 значение поля
            + xf(0, 4, 0, 1, 'horizontal="center" vertical="center" wrapText="1"')    // 17 ячейка по центру
            + xf(0, 4, 0, 1, 'horizontal="left" vertical="top" wrapText="1"')         // 18 описание
            + '</cellXfs>'

            + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            + '</styleSheet>';
    }

    /*
        Имя листа: Excel запрещает : \ / ? * [ ] и длину больше 31 символа.
        Дубликаты тоже запрещены, поэтому повтор получает номер.
    */
    function sheetName(name, used) {
        var clean = String(name).replace(/[:\\\/?*\[\]]/g, ' ').substring(0, 31).trim();
        if (!clean) clean = 'Лист';

        var candidate = clean;
        var n = 2;

        while (used.indexOf(candidate) >= 0) {
            var suffix = ' ' + n;
            candidate = clean.substring(0, 31 - suffix.length) + suffix;
            n++;
        }

        used.push(candidate);
        return candidate;
    }

    /* --- книга ----------------------------------------------------------- */

    function build(sheets) {
        var entries = [];
        var names = [];
        var tabs = [];
        var rels = [];
        var overrides = [];
        var i;

        for (i = 0; i < sheets.length; i++) {
            var name = sheetName(sheets[i].name, names);
            var id = i + 1;

            entries.push({ name: 'xl/worksheets/sheet' + id + '.xml', text: sheet(sheets[i]) });

            tabs.push('<sheet name="' + Zip.xml(name) + '" sheetId="' + id
                + '" r:id="rId' + id + '"/>');

            rels.push('<Relationship Id="rId' + id + '" Type="http://schemas.openxmlformats.org'
                + '/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'
                + id + '.xml"/>');

            overrides.push('<Override PartName="/xl/worksheets/sheet' + id + '.xml"'
                + ' ContentType="application/vnd.openxmlformats-officedocument'
                + '.spreadsheetml.worksheet+xml"/>');
        }

        var stylesId = sheets.length + 1;

        rels.push('<Relationship Id="rId' + stylesId + '" Type="http://schemas.openxmlformats.org'
            + '/officeDocument/2006/relationships/styles" Target="styles.xml"/>');

        entries.push({
            name: '[Content_Types].xml',
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package'
                + '.relationships+xml"/>'
                + '<Default Extension="xml" ContentType="application/xml"/>'
                + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd'
                + '.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                + overrides.join('')
                + '<Override PartName="/xl/styles.xml" ContentType="application/vnd'
                + '.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                + '</Types>'
        });

        entries.push({
            name: '_rels/.rels',
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument'
                + '/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                + '</Relationships>'
        });

        entries.push({
            name: 'xl/workbook.xml',
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
                + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                + '<sheets>' + tabs.join('') + '</sheets>'
                + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
                + '</workbook>'
        });

        entries.push({
            name: 'xl/_rels/workbook.xml.rels',
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + rels.join('')
                + '</Relationships>'
        });

        entries.push({ name: 'xl/styles.xml', text: styles() });

        return entries;
    }

    function bytes(sheets) {
        return Zip.create(build(sheets));
    }

    function save(sheets, fileName) {
        Zip.save(bytes(sheets), fileName,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    return {
        column: column,
        build: build,
        bytes: bytes,
        save: save
    };
})();
