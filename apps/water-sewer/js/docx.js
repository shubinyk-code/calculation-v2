/*
    Документ Word (.docx) без библиотек.

    Выгрузка нужна ровно для одного: расчёт вкладывается в пояснительную
    записку. Поэтому — таблица, и ничего кроме: книжный лист A4, чёрные линии,
    один шрифт, никаких заливок и цветных заголовков. Оформление снято с
    образца, по которому сдают: поля 1701 слева и 850 справа, таблица шириной
    9928 твипов, границы single sz=4 цвета auto.

    Цветное оформление осталось только на экране. В записке оно чужеродно: её
    верстают по своему шаблону, и синие заголовки из выгрузки пришлось бы
    вычищать руками.

    Форматирование прямое, а не через именованные стили: у записки, в которую
    выгрузку вставят, свои стили с теми же именами, и именованный стиль там
    переопределится чужим. Прямое форматирование переживает вставку.

    Модель на входе та же, что у выгрузки в Excel, см. report.js. Шапка с
    объединениями задаётся полем headRows — Excel её не использует, там
    объединённых ячеек нет намеренно.
*/

var Docx = (function () {
    'use strict';

    /*
        Ширина таблицы в твипах — как в образце. Лист книжный A4 (11906),
        поля 1701 слева и 850 справа; таблица чуть шире полосы набора и
        выступает влево на 294 твипа, ровно как в образце.
    */
    var PAGE = 9928;
    var INDENT = -294;

    function text(value) {
        return '<w:t xml:space="preserve">' + Zip.xml(value) + '</w:t>';
    }

    /*
        Абзац. options: size — полуточки (20 = 10 пунктов), bold, italic,
        align, space — отступ сверху в твипах.

        Шрифт один на весь документ — Times New Roman: записка набирается им, и
        вставленная таблица не должна выделяться чужой гарнитурой.
    */
    function paragraph(value, options) {
        options = options || {};

        var runProps = ['<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"'
            + ' w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'];

        if (options.bold) runProps.push('<w:b/>');
        if (options.italic) runProps.push('<w:i/>');
        runProps.push('<w:sz w:val="' + (options.size || 20) + '"/>');
        runProps.push('<w:szCs w:val="' + (options.size || 20) + '"/>');

        var paraProps = ['<w:spacing w:before="' + (options.space || 0) + '" w:after="'
            + (options.after === undefined ? 0 : options.after) + '" w:line="240"'
            + ' w:lineRule="auto"/>', '<w:ind w:firstLine="0"/>'];

        if (options.align) paraProps.push('<w:jc w:val="' + options.align + '"/>');

        return '<w:p><w:pPr>' + paraProps.join('') + '</w:pPr>'
            + '<w:r><w:rPr>' + runProps.join('') + '</w:rPr>'
            + text(value) + '</w:r></w:p>';
    }

    /*
        Ячейка таблицы. Числа прижимаются вправо, текст влево — так же, как на
        экране: колонку чисел читают по последней цифре, и разнобой в
        выравнивании сбивает счёт.
    */
    /*
        Ячейка таблицы.

        options.merge: 'restart' — начало вертикального объединения,
        'continue' — его продолжение; options.span — объединение по горизонтали.
        Через них и собирается двухуровневая шапка образца.
    */
    function tableCell(value, width, options) {
        options = options || {};

        var numeric = typeof value === 'number' && isFinite(value);

        /*
            Разрядность задаёт таблица, а не число: в формах расходы пишут
            тремя знаками — «52,380», «11,892», «4,656», — и автоматический
            выбор по величине превратил бы их в «52,38» и «11,89».
        */
        var shown = numeric
            ? Format.num(value, options.digits)
            : (value === null || value === undefined ? '' : value);

        var props = ['<w:tcW w:w="' + width + '" w:type="dxa"/>'];

        if (options.span > 1) props.push('<w:gridSpan w:val="' + options.span + '"/>');
        if (options.merge === 'restart') props.push('<w:vMerge w:val="restart"/>');
        if (options.merge === 'continue') props.push('<w:vMerge/>');

        props.push('<w:shd w:val="clear" w:color="auto" w:fill="auto"/>');
        props.push('<w:vAlign w:val="center"/>');

        // Продолжение вертикального объединения несёт пустой абзац: текст в
        // нём Word покажет второй строкой внутри объединённой ячейки.
        var content = options.merge === 'continue'
            ? '<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>'
            : paragraph(shown, {
                bold: options.bold,
                size: options.size || 20,
                align: options.align || (numeric ? 'center' : 'left')
            });

        return '<w:tc><w:tcPr>' + props.join('') + '</w:tcPr>' + content + '</w:tc>';
    }

    /*
        Ширины колонок приходят в «символах Excel» — переводим в доли листа.
        Пересчёт, а не фиксированные значения: у таблицы расходов шестнадцать
        колонок, у таблицы по этажам одиннадцать, и одинаковые ширины сделали бы
        первую нечитаемой.
    */
    function columnWidths(count, weights) {
        var widths = [];
        var sum = 0;
        var i;

        for (i = 0; i < count; i++) {
            var w = weights && weights[i] > 0 ? weights[i] : 10;
            widths.push(w);
            sum += w;
        }

        var out = [];
        var used = 0;

        for (i = 0; i < count; i++) {
            var value = i === count - 1
                ? PAGE - used
                : Math.round(PAGE * widths[i] / sum);

            out.push(value);
            used += value;
        }

        return out;
    }

    /* Разрядность колонки: число — на всю таблицу, массив — по колонкам. */
    function digitsFor(block, column) {
        if (block.digits === undefined || block.digits === null) return undefined;

        if (Object.prototype.toString.call(block.digits) === '[object Array]') {
            var value = block.digits[column];
            return value === null ? undefined : value;
        }

        return block.digits;
    }

    function table(block) {
        var head = block.head || [];
        var count = Math.max(head.length, block.rows.length ? block.rows[0].length : 0);
        if (count === 0) return '';

        var widths = columnWidths(count, block.widths);
        var parts = [];
        var i;

        // Границы чёрные и тонкие — как в образце. Никаких цветных линий:
        // записка печатается, и синяя сетка на бумаге выглядит браком.
        var border = function (side) {
            return '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="auto"/>';
        };

        parts.push('<w:tbl><w:tblPr>'
            + '<w:tblW w:w="' + PAGE + '" w:type="dxa"/>'
            + '<w:tblInd w:w="' + INDENT + '" w:type="dxa"/>'
            + '<w:tblBorders>'
            + border('top') + border('left') + border('bottom') + border('right')
            + border('insideH') + border('insideV')
            + '</w:tblBorders>'
            + '<w:tblLayout w:type="fixed"/>'
            + '<w:tblCellMar>'
            + '<w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
            + '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>'
            + '</w:tblCellMar>'
            + '</w:tblPr>');

        var grid = [];
        for (i = 0; i < count; i++) grid.push('<w:gridCol w:w="' + widths[i] + '"/>');
        parts.push('<w:tblGrid>' + grid.join('') + '</w:tblGrid>');

        parts.push(header(block, widths, count));

        for (var r = 0; r < block.rows.length; r++) {
            var source = block.rows[r];
            var line = [];

            /*
                Жирным выделяются только строки, которые в образце жирные:
                заголовки групп и итоги. Заливок нет вовсе.
            */
            var strong = block.total !== undefined && r >= block.total;
            if (!strong && block.bold && block.bold.indexOf(r) >= 0) strong = true;

            for (i = 0; i < count; i++) {
                /*
                    Разрядность задаётся по колонкам: расходы пишут тремя
                    знаками, а норма — целым числом литров. Одна разрядность на
                    всю таблицу превратила бы «110» в «110,000».
                */
                line.push(tableCell(source[i], widths[i], {
                    bold: strong,
                    digits: digitsFor(block, i)
                }));
            }

            parts.push('<w:tr>' + line.join('') + '</w:tr>');
        }

        parts.push('</w:tbl>');

        // Пустой абзац после таблицы: две таблицы подряд Word склеивает в одну.
        parts.push('<w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>');

        return parts.join('');
    }

    /*
        Шапка. Простая — одна строка; с объединениями — столько строк, сколько
        задано в headRows, где ячейка описывается как {t, span, rows}.

        Шапка повторяется на каждой странице: таблица расходов легко уходит на
        второй лист, и без повтора его читать нечем.
    */
    function header(block, widths, count) {
        var i;

        if (block.headRows && block.headRows.length) return mergedHeader(block, widths, count);

        if (!block.head || !block.head.length) return '';

        var simple = [];

        for (i = 0; i < count; i++) {
            simple.push(tableCell(block.head[i] === undefined ? '' : block.head[i],
                widths[i], { bold: true, align: 'center' }));
        }

        return '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + simple.join('') + '</w:tr>';
    }

    /*
        Шапка с объединениями строится через сетку занятости.

        Иначе не обойтись: ячейка «Наименование потребителя» занимает две
        строки, и во второй строке на её месте всё равно должна стоять ячейка с
        продолжением объединения. Просто пропустить её нельзя — Word тогда
        сдвинет остальные колонки влево и сетка разъедется.
    */
    function mergedHeader(block, widths, count) {
        var lines = block.headRows;
        var taken = [];
        var placed = [];
        var r, c, i;

        for (r = 0; r < lines.length; r++) {
            taken.push(new Array(count));
            placed.push([]);
        }

        for (r = 0; r < lines.length; r++) {
            var column = 0;

            for (i = 0; i < lines[r].length; i++) {
                var cell = lines[r][i];
                var span = cell.span || 1;
                var rows = cell.rows || 1;

                while (column < count && taken[r][column]) column++;
                if (column >= count) break;

                var width = 0;
                for (c = 0; c < span; c++) width += widths[column + c] || 0;

                placed[r].push({
                    column: column,
                    text: cell.t,
                    width: width,
                    span: span,
                    merge: rows > 1 ? 'restart' : null
                });

                for (var down = 0; down < rows; down++) {
                    for (c = 0; c < span; c++) {
                        if (taken[r + down]) taken[r + down][column + c] = true;
                    }

                    // Продолжение объединения — своей ячейкой в нижней строке.
                    if (down > 0 && placed[r + down]) {
                        placed[r + down].push({
                            column: column,
                            text: '',
                            width: width,
                            span: span,
                            merge: 'continue'
                        });
                    }
                }

                column += span;
            }
        }

        var out = [];

        for (r = 0; r < placed.length; r++) {
            placed[r].sort(function (a, b) { return a.column - b.column; });

            var cells = [];

            for (i = 0; i < placed[r].length; i++) {
                var one = placed[r][i];

                cells.push(tableCell(one.text, one.width, {
                    align: 'center',
                    span: one.span,
                    merge: one.merge
                }));
            }

            out.push('<w:tr><w:trPr><w:tblHeader/></w:trPr>' + cells.join('') + '</w:tr>');
        }

        return out.join('');
    }

    function body(sections) {
        var parts = [];

        for (var s = 0; s < sections.length; s++) {
            var section = sections[s];

            for (var b = 0; b < section.blocks.length; b++) {
                var block = section.blocks[b];

                if (block.kind === 'title') {
                    parts.push(paragraph(block.text, {
                        bold: true, size: 20, space: s === 0 && b === 0 ? 0 : 240, after: 120
                    }));
                } else if (block.kind === 'note') {
                    parts.push(paragraph(block.text, { size: 18, after: 120 }));
                } else if (block.kind === 'table') {
                    parts.push(table(block));
                } else if (block.kind === 'mono') {
                    // Разбор формул: моноширинный, чтобы подстановки стояли в столбик.
                    parts.push('<w:p><w:pPr><w:spacing w:after="0" w:line="240"'
                        + ' w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr>'
                        + '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
                        + '<w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>'
                        + text(block.text) + '</w:r></w:p>');
                }
            }
        }

        return parts.join('');
    }

    function build(sections, title) {
        /*
            Лист книжный A4 с полями образца: 1701 слева под подшивку, 850
            справа, 1134 сверху и снизу. Альбомная ориентация была бы удобнее
            широким таблицам, но записку верстают книжной, и вставленный туда
            альбомный лист рвёт нумерацию.
        */
        var document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            + '<w:body>'
            + (title ? paragraph(title, { bold: true, size: 22, after: 160 }) : '')
            + body(sections)
            + '<w:sectPr>'
            + '<w:pgSz w:w="11906" w:h="16838"/>'
            + '<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701"'
            + ' w:header="708" w:footer="708" w:gutter="0"/>'
            + '</w:sectPr>'
            + '</w:body></w:document>';

        return [
            {
                name: '[Content_Types].xml',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package'
                    + '.relationships+xml"/>'
                    + '<Default Extension="xml" ContentType="application/xml"/>'
                    + '<Override PartName="/word/document.xml" ContentType="application/vnd'
                    + '.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                    + '<Override PartName="/word/styles.xml" ContentType="application/vnd'
                    + '.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                    + '</Types>'
            },
            {
                name: '_rels/.rels',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument'
                    + '/2006/relationships/officeDocument" Target="word/document.xml"/>'
                    + '</Relationships>'
            },
            {
                name: 'word/_rels/document.xml.rels',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument'
                    + '/2006/relationships/styles" Target="styles.xml"/>'
                    + '</Relationships>'
            },
            {
                name: 'word/styles.xml',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    + '<w:docDefaults><w:rPrDefault><w:rPr>'
                    + '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"'
                    + ' w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'
                    + '<w:sz w:val="20"/><w:szCs w:val="20"/>'
                    + '</w:rPr></w:rPrDefault>'
                    + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240"'
                    + ' w:lineRule="auto"/></w:pPr></w:pPrDefault>'
                    + '</w:docDefaults>'
                    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
                    + '<w:name w:val="Normal"/><w:qFormat/>'
                    + '</w:style>'
                    + '</w:styles>'
            },
            { name: 'word/document.xml', text: document }
        ];
    }

    function bytes(sections, title) {
        return Zip.create(build(sections, title));
    }

    function save(sections, title, fileName) {
        Zip.save(bytes(sections, title), fileName,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }

    return {
        build: build,
        bytes: bytes,
        save: save
    };
})();
