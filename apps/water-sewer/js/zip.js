/*
    Запись ZIP-архива в браузере — основа выгрузки в Excel и Word.

    И .xlsx, и .docx устроены одинаково: это ZIP с XML-файлами внутри. Своей
    записи архива хватает, чтобы отдавать НАСТОЯЩИЕ файлы вместо HTML-таблицы,
    переименованной в .xls: такую Excel открывает с предупреждением «формат не
    соответствует расширению», а в записку она попадает с чужим оформлением.

    Сжатия здесь нет — файлы кладутся методом «store». Причина простая: своего
    deflate в браузере не достать, а XML отчёта весит десятки килобайт, и
    сжимать их незачем. Формат этого не запрещает: и Excel, и Word открывают
    несжатый архив как обычный.

    Библиотек нет намеренно. Программа работает и по протоколу file://, откуда
    ни один CDN не подключится.
*/

var Zip = (function () {
    'use strict';

    /* --- CRC32 ----------------------------------------------------------- */

    var table = null;

    function crcTable() {
        if (table) return table;

        table = new Int32Array(256);

        for (var i = 0; i < 256; i++) {
            var c = i;
            for (var k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c;
        }

        return table;
    }

    function crc32(bytes) {
        var t = crcTable();
        var c = -1;

        for (var i = 0; i < bytes.length; i++) {
            c = (c >>> 8) ^ t[(c ^ bytes[i]) & 0xFF];
        }

        return (c ^ -1) >>> 0;
    }

    /* --- UTF-8 ----------------------------------------------------------- */

    /*
        Своя кодировка, а не TextEncoder: в отчёте русский текст, и он должен
        одинаково записываться и в имя файла внутри архива, и в содержимое.
        TextEncoder есть везде, но своя реализация избавляет от вопроса, что
        делать, когда его нет.
    */
    function utf8(text) {
        var out = [];

        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);

            if (code < 0x80) {
                out.push(code);
            } else if (code < 0x800) {
                out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
            } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
                // Суррогатная пара — один символ вне основной плоскости.
                var low = text.charCodeAt(i + 1);
                var full = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                i++;

                out.push(0xF0 | (full >> 18),
                    0x80 | ((full >> 12) & 0x3F),
                    0x80 | ((full >> 6) & 0x3F),
                    0x80 | (full & 0x3F));
            } else {
                out.push(0xE0 | (code >> 12),
                    0x80 | ((code >> 6) & 0x3F),
                    0x80 | (code & 0x3F));
            }
        }

        return new Uint8Array(out);
    }

    /* --- сборка архива --------------------------------------------------- */

    function Writer() {
        this.parts = [];
        this.length = 0;
    }

    Writer.prototype.bytes = function (data) {
        this.parts.push(data);
        this.length += data.length;
    };

    Writer.prototype.u16 = function (value) {
        this.bytes(new Uint8Array([value & 0xFF, (value >> 8) & 0xFF]));
    };

    Writer.prototype.u32 = function (value) {
        this.bytes(new Uint8Array([
            value & 0xFF,
            (value >>> 8) & 0xFF,
            (value >>> 16) & 0xFF,
            (value >>> 24) & 0xFF
        ]));
    };

    Writer.prototype.join = function () {
        var all = new Uint8Array(this.length);
        var at = 0;

        for (var i = 0; i < this.parts.length; i++) {
            all.set(this.parts[i], at);
            at += this.parts[i].length;
        }

        return all;
    };

    /*
        entries: [{ name: 'xl/workbook.xml', text: '<?xml ...' }]

        Имена файлов внутри архива — только латиница: так требуют и формат
        документов, и здравый смысл. Флаг UTF-8 всё равно выставляется: он
        ничего не портит, а архив остаётся правильным, если имя однажды станет
        русским.
    */
    function create(entries) {
        var local = new Writer();
        var central = new Writer();
        var offsets = [];

        var i;

        for (i = 0; i < entries.length; i++) {
            var name = utf8(entries[i].name);
            var data = utf8(entries[i].text);
            var sum = crc32(data);

            offsets.push(local.length);

            local.u32(0x04034B50);      // подпись локального заголовка
            local.u16(20);              // нужная версия
            local.u16(0x0800);          // флаг: имена в UTF-8
            local.u16(0);               // метод: без сжатия
            local.u16(0);               // время
            local.u16(0);               // дата
            local.u32(sum);
            local.u32(data.length);     // сжатый размер
            local.u32(data.length);     // исходный размер
            local.u16(name.length);
            local.u16(0);               // дополнительное поле
            local.bytes(name);
            local.bytes(data);

            central.u32(0x02014B50);    // подпись записи каталога
            central.u16(20);            // версия записавшего
            central.u16(20);            // нужная версия
            central.u16(0x0800);
            central.u16(0);
            central.u16(0);
            central.u16(0);
            central.u32(sum);
            central.u32(data.length);
            central.u32(data.length);
            central.u16(name.length);
            central.u16(0);             // дополнительное поле
            central.u16(0);             // комментарий
            central.u16(0);             // номер диска
            central.u16(0);             // внутренние атрибуты
            central.u32(0);             // внешние атрибуты
            central.u32(offsets[i]);    // смещение локального заголовка
            central.bytes(name);
        }

        var out = new Writer();
        out.bytes(local.join());

        var directoryAt = out.length;
        out.bytes(central.join());

        out.u32(0x06054B50);            // конец центрального каталога
        out.u16(0);                     // номер диска
        out.u16(0);                     // диск с каталогом
        out.u16(entries.length);
        out.u16(entries.length);
        out.u32(central.length);
        out.u32(directoryAt);
        out.u16(0);                     // комментарий

        return out.join();
    }

    function blob(entries, type) {
        return new Blob([create(entries)], { type: type || 'application/zip' });
    }

    /*
        Сохранение файла. Ссылка создаётся и щёлкается программно: другого
        способа отдать браузеру собранный в памяти файл нет.
    */
    function save(bytesOrBlob, fileName, type) {
        var data = bytesOrBlob instanceof Blob
            ? bytesOrBlob
            : new Blob([bytesOrBlob], { type: type || 'application/octet-stream' });

        var link = document.createElement('a');
        link.href = URL.createObjectURL(data);
        link.download = fileName.replace(/[\\\/:*?"<>|]/g, '-');

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    }

    /* Экранирование текста для вставки в XML документа. */
    function xml(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')
            // Управляющие символы в XML документа недопустимы вовсе.
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    }

    return {
        crc32: crc32,
        utf8: utf8,
        create: create,
        blob: blob,
        save: save,
        xml: xml
    };
})();
