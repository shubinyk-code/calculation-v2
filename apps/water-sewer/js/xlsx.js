/*
    Книга Excel (.xlsx) без библиотек.

    Числа записываются ЧИСЛАМИ, а не текстом: инженер открывает выгрузку, чтобы
    считать дальше — сложить стояки, построить график, подставить в смету. Текст
    в ячейке всё это ломает, и «5,217» приходится вбивать заново.

    Строки записываются встроенными (inlineStr), без общей таблицы строк. Так
    файл чуть больше, зато вдвое меньше кода и нечему разъехаться: общая таблица
    строк — это второй индекс, который надо держать в согласии с ячейками.

    Модель на входе — та же, что у выгрузки в Word, см. report.js:

        { name: 'Водопотребление', blocks: [
            { kind: 'title', text: '...' },
            { kind: 'note',  text: '...' },
            { kind: 'table', head: [...], rows: [[...]], widths: [...], total: 3 }
        ] }
*/

var Xlsx = (function () {
    'use strict';

    /* Стили: номера соответствуют порядку в cellXfs. */
    var PLAIN = 0;
    var TITLE = 1;
    var NOTE = 2;
    var HEAD = 3;
    var TEXT = 4;
    var NUMBER = 5;
    var TOTAL_TEXT = 6;
    var TOTAL_NUMBER = 7;

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

    function cell(text, style, columnIndex, rowIndex) {
        var reference = column(columnIndex) + rowIndex;

        if (text === null || text === undefined || text === '') {
            return '<c r="' + reference + '" s="' + style + '"/>';
        }

        if (typeof text === 'number' && isFinite(text)) {
            // Округление до шести знаков: дальше идут артефакты двоичной
            // арифметики, а не значащие цифры расчёта.
            var value = Math.round(text * 1e6) / 1e6;
            return '<c r="' + reference + '" s="' + style + '"><v>' + value + '</v></c>';
        }

        return '<c r="' + reference + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">'
            + Zip.xml(text) + '</t></is></c>';
    }

    /* --- лист ------------------------------------------------------------ */

    function sheet(model) {
        var rows = [];
        var at = 1;
        var widest = 0;
        var widths = null;

        for (var b = 0; b < model.blocks.length; b++) {
            var block = model.blocks[b];

            if (block.kind === 'title') {
                if (at > 1) at++;   // пустая строка перед разделом
                rows.push('<row r="' + at + '" ht="18" customHeight="1">'
                    + cell(block.text, TITLE, 0, at) + '</row>');
                at++;
                continue;
            }

            if (block.kind === 'note' || block.kind === 'mono') {
                rows.push('<row r="' + at + '">' + cell(block.text, NOTE, 0, at) + '</row>');
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
                for (c = 0; c < head.length; c++) line.push(cell(head[c], HEAD, c, at));
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
                        ? (numeric ? TOTAL_NUMBER : TOTAL_TEXT)
                        : (numeric ? NUMBER : TEXT);

                    line.push(cell(value, style, c, at));
                }

                rows.push('<row r="' + at + '">' + line.join('') + '</row>');
                at++;

                if (source.length > widest) widest = source.length;
            }

            at++;   // пустая строка после таблицы
        }

        var cols = '';

        if (widths && widths.length) {
            var parts = [];
            for (var w = 0; w < Math.max(widths.length, widest); w++) {
                parts.push('<col min="' + (w + 1) + '" max="' + (w + 1) + '" width="'
                    + (widths[w] || 12) + '" customWidth="1"/>');
            }
            cols = '<cols>' + parts.join('') + '</cols>';
        }

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>'
            + cols
            + '<sheetData>' + rows.join('') + '</sheetData>'
            + '</worksheet>';
    }

    /* --- оформление ------------------------------------------------------ */

    function styles() {
        var thin = '<left style="thin"><color rgb="FFC3D6E8"/></left>'
            + '<right style="thin"><color rgb="FFC3D6E8"/></right>'
            + '<top style="thin"><color rgb="FFC3D6E8"/></top>'
            + '<bottom style="thin"><color rgb="FFC3D6E8"/></bottom>';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'

            + '<fonts count="5">'
            + '<font><sz val="10"/><name val="Segoe UI"/></font>'
            + '<font><b/><sz val="12"/><color rgb="FF1D6FB8"/><name val="Segoe UI"/></font>'
            + '<font><i/><sz val="9"/><color rgb="FF5B7186"/><name val="Segoe UI"/></font>'
            + '<font><b/><sz val="10"/><name val="Segoe UI"/></font>'
            + '<font><sz val="10"/><color rgb="FF1B2A38"/><name val="Segoe UI"/></font>'
            + '</fonts>'

            + '<fills count="4">'
            + '<fill><patternFill patternType="none"/></fill>'
            + '<fill><patternFill patternType="gray125"/></fill>'
            + '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3FB"/>'
            + '<bgColor indexed="64"/></patternFill></fill>'
            + '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE7F2"/>'
            + '<bgColor indexed="64"/></patternFill></fill>'
            + '</fills>'

            + '<borders count="2">'
            + '<border><left/><right/><top/><bottom/><diagonal/></border>'
            + '<border>' + thin + '<diagonal/></border>'
            + '</borders>'

            + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'

            + '<cellXfs count="8">'
            // 0 обычная
            + '<xf xfId="0" numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
            // 1 заголовок раздела
            + '<xf xfId="0" numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1">'
            + '<alignment vertical="center"/></xf>'
            // 2 примечание
            + '<xf xfId="0" numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/>'
            // 3 шапка таблицы
            + '<xf xfId="0" numFmtId="0" fontId="3" fillId="2" borderId="1"'
            + ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
            + '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
            // 4 текст
            + '<xf xfId="0" numFmtId="0" fontId="4" fillId="0" borderId="1"'
            + ' applyFont="1" applyBorder="1" applyAlignment="1">'
            + '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>'
            // 5 число
            + '<xf xfId="0" numFmtId="0" fontId="4" fillId="0" borderId="1"'
            + ' applyFont="1" applyBorder="1" applyAlignment="1">'
            + '<alignment horizontal="right" vertical="center"/></xf>'
            // 6 итоговый текст
            + '<xf xfId="0" numFmtId="0" fontId="3" fillId="3" borderId="1"'
            + ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
            + '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>'
            // 7 итоговое число
            + '<xf xfId="0" numFmtId="0" fontId="3" fillId="3" borderId="1"'
            + ' applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
            + '<alignment horizontal="right" vertical="center"/></xf>'
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
