'use strict';

/*
    Сборка файла .docx: записка ПБ3 текстом, заголовками и таблицами.

    Главный путь — правка по шаблону бюро. Штампы ГОСТ в колонтитулах весят
    сотни килобайт и рисуются таблицами; повторять их незачем и опасно. Поэтому
    программа открывает вашу записку .docx, оставляет всё — стили, штампы,
    картинки, титульные листы до последнего разрыва раздела — и заменяет только
    текст после него. Стили берутся из шаблона: заголовок «1», таблицы «afa» и
    «afb» есть во всех трёх записках бюро.

    Без шаблона собирается самостоятельный файл с теми же шрифтами (Arial
    Narrow 12 пт), но без штампов — для быстрой проверки текста.

    Блоки, из которых собирается записка:

        { type: 'heading', text }          заголовок раздела
        { type: 'sub', text }              подзаголовок (жирный, без номера)
        { type: 'p', text, indent, bold }  абзац
        { type: 'list', items: [...] }     перечисление через дефис
        { type: 'caption', text }          подпись таблицы
        { type: 'table', head, rows, widths }
        { type: 'break' }                  разрыв страницы
*/

var Docx = (function () {

    var FONT = 'Arial Narrow';
    var SIZE = 24;          // половины пункта: 24 = 12 пт
    var SMALL = 20;         // текст таблиц
    var WIDTH = 9600;       // ширина полосы набора в твипах

    function esc(t) { return Zip.xml(t); }

    function fonts() {
        return '<w:rFonts w:ascii="' + FONT + '" w:hAnsi="' + FONT + '" w:cs="' + FONT + '"/>';
    }

    function runProps(o) {
        return '<w:rPr>' + fonts() + (o.bold ? '<w:b/>' : '') + (o.italic ? '<w:i/>' : '')
            + '<w:sz w:val="' + (o.size || SIZE) + '"/><w:szCs w:val="' + (o.size || SIZE) + '"/></w:rPr>';
    }

    /** Абзац; текст с переводами строк разбивается на строки внутри абзаца. */
    function para(text, o) {
        o = o || {};
        var pr = '<w:pPr>'
            + (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '')
            + (o.align ? '<w:jc w:val="' + o.align + '"/>' : '<w:jc w:val="both"/>')
            + '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after === undefined ? 60 : o.after) + '" w:line="240" w:lineRule="auto"/>'
            + (o.indent ? '<w:ind w:firstLine="' + o.indent + '"/>' : '')
            + (o.style ? '' : '<w:rPr>' + fonts() + (o.bold ? '<w:b/>' : '') + '<w:sz w:val="' + (o.size || SIZE) + '"/></w:rPr>')
            + '</w:pPr>';

        var parts = String(text === undefined || text === null ? '' : text).split('\n');
        var runs = parts.map(function (line, i) {
            return '<w:r>' + runProps(o) + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + esc(line) + '</w:t></w:r>';
        }).join('');

        return '<w:p>' + pr + runs + '</w:p>';
    }

    function cell(text, width, o) {
        o = o || {};
        return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/><w:vAlign w:val="center"/>'
            + (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>' : '') + '</w:tcPr>'
            + para(text, { size: SMALL, bold: o.bold, align: o.align || 'center', after: 0 }) + '</w:tc>';
    }

    function widthsOf(block) {
        var count = (block.head || (block.rows[0] || [])).length;
        var raw = block.widths && block.widths.length === count ? block.widths : [];
        var sum = 0;
        var i;

        for (i = 0; i < count; i++) sum += raw[i] || 1;

        var out = [];
        var used = 0;
        for (i = 0; i < count; i++) {
            var w = i === count - 1 ? WIDTH - used : Math.round(WIDTH * (raw[i] || 1) / sum);
            used += w;
            out.push(w);
        }
        return out;
    }

    function table(block) {
        var w = widthsOf(block);
        var border = '<w:tblBorders>'
            + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (side) {
                return '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
            }).join('') + '</w:tblBorders>';

        var xml = '<w:tbl><w:tblPr><w:tblW w:w="' + WIDTH + '" w:type="dxa"/>' + border
            + '<w:tblLayout w:type="fixed"/><w:tblCellMar>'
            + '<w:top w:w="28" w:type="dxa"/><w:left w:w="57" w:type="dxa"/>'
            + '<w:bottom w:w="28" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr>'
            + '<w:tblGrid>' + w.map(function (x) { return '<w:gridCol w:w="' + x + '"/>'; }).join('') + '</w:tblGrid>';

        if (block.head) {
            xml += '<w:tr><w:trPr><w:tblHeader/></w:trPr>'
                + block.head.map(function (t, i) { return cell(t, w[i], { bold: true, shade: 'F2F2F2' }); }).join('') + '</w:tr>';
        }

        (block.rows || []).forEach(function (row) {
            xml += '<w:tr>' + row.map(function (t, i) {
                return cell(t, w[i], { align: i === 0 ? 'left' : 'center' });
            }).join('') + '</w:tr>';
        });

        return xml + '</w:tbl>' + para('', { after: 0, size: SMALL });
    }

    /** Блоки записки в XML тела документа. */
    function body(blocks) {
        return blocks.map(function (b) {
            switch (b.type) {
                case 'heading': return para(b.text, { style: '1', align: 'left', before: 200, after: 120 });
                case 'sub': return para(b.text, { bold: true, align: 'left', before: 160, after: 80 });
                case 'caption': return para(b.text, { before: 120, after: 60, align: 'left' });
                case 'list': return (b.items || []).map(function (t) { return para('- ' + t, { align: 'left', after: 0 }); }).join('');
                case 'table': return table(b);
                case 'break': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
                default: return para(b.text, { indent: b.indent === false ? 0 : 709, bold: b.bold });
            }
        }).join('');
    }

    /* --- самостоятельный файл (без штампов) -------------------------------- */

    function stylesXml() {
        var rpr = fonts() + '<w:sz w:val="' + SIZE + '"/><w:szCs w:val="' + SIZE + '"/><w:lang w:val="ru-RU"/>';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            + '<w:docDefaults><w:rPrDefault><w:rPr>' + rpr + '</w:rPr></w:rPrDefault>'
            + '<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>'
            + '<w:style w:type="paragraph" w:default="1" w:styleId="a0"><w:name w:val="Normal"/><w:qFormat/></w:style>'
            + '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a0"/>'
            + '<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="200" w:after="120"/><w:jc w:val="left"/></w:pPr>'
            + '<w:rPr>' + fonts() + '<w:b/><w:sz w:val="' + SIZE + '"/></w:rPr></w:style>'
            + '</w:styles>';
    }

    function documentXml(blocks) {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            + '<w:body>' + body(blocks)
            + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            + '<w:pgMar w:top="1134" w:right="567" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>'
            + '</w:sectPr></w:body></w:document>';
    }

    function standalone(blocks) {
        return [
            {
                name: '[Content_Types].xml',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                    + '<Default Extension="xml" ContentType="application/xml"/>'
                    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                    + '</Types>'
            },
            {
                name: '_rels/.rels',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                    + '</Relationships>'
            },
            {
                name: 'word/_rels/document.xml.rels',
                text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                    + '</Relationships>'
            },
            { name: 'word/document.xml', text: documentXml(blocks) },
            { name: 'word/styles.xml', text: stylesXml() }
        ];
    }

    /* --- правка по шаблону ------------------------------------------------- */

    /**
        Тело шаблона до последнего разрыва раздела остаётся как есть: это
        содержание тома, подпись главного инженера и прочие титульные листы.
        Дальше идёт собранный текст, а в конце — раздел шаблона со ссылками
        на колонтитулы со штампом.
    */
    function graft(zip, blocks, keepFront) {
        var part = zip.map['word/document.xml'];
        if (!part) throw new Error('В файле нет word/document.xml — это не документ Word.');

        var doc = Zip.decode(part.bytes);
        var bodyAt = doc.indexOf('<w:body>');
        var endAt = doc.lastIndexOf('</w:body>');
        if (bodyAt < 0 || endAt < 0) throw new Error('Не разобрать документ Word: нет тела.');

        bodyAt += '<w:body>'.length;

        var finalSect = doc.lastIndexOf('<w:sectPr', endAt);
        var tail = finalSect > bodyAt ? doc.slice(finalSect, endAt) : '';
        var limit = finalSect > bodyAt ? finalSect : endAt;

        var front = '';
        if (keepFront) {
            var breakAt = doc.lastIndexOf('<w:sectPr', limit - 1);
            if (breakAt > bodyAt) {
                var pEnd = doc.indexOf('</w:p>', breakAt);
                if (pEnd > 0) front = doc.slice(bodyAt, pEnd + '</w:p>'.length);
            }
        }

        var text = doc.slice(0, bodyAt) + front + body(blocks) + tail + doc.slice(endAt);

        return zip.files.map(function (f) {
            return f.name === 'word/document.xml' ? { name: f.name, text: text } : { name: f.name, bytes: f.bytes };
        });
    }

    /** Что нашлось в шаблоне: разрывы разделов, колонтитулы, стиль заголовка. */
    function templateInfo(zip) {
        var part = zip.map['word/document.xml'];
        var doc = part ? Zip.decode(part.bytes) : '';
        var styles = zip.map['word/styles.xml'] ? Zip.decode(zip.map['word/styles.xml'].bytes) : '';

        return {
            ok: !!part,
            sections: (doc.match(/<w:sectPr/g) || []).length,
            headers: zip.files.filter(function (f) { return /word\/header\d+\.xml/.test(f.name); }).length,
            heading: styles.indexOf('w:styleId="1"') >= 0
        };
    }

    function bytes(entries) {
        return Zip.create(entries);
    }

    function save(entries, fileName) {
        Zip.save(Zip.blob(entries, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), fileName);
    }

    return {
        FONT: FONT,
        body: body,
        para: para,
        table: table,
        standalone: standalone,
        graft: graft,
        templateInfo: templateInfo,
        bytes: bytes,
        save: save
    };
})();
