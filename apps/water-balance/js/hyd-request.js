/*
    Запрос на подбор насосного оборудования — вкладка «Гидравлика» → «Насосы».

    Письмо поставщику собирается из расчёта (так же, как в SprinklerWeb): по блоку на насосную
    установку — зона, требуемые Q и H. Адресат по умолчанию тот же — Константин Ярков (Wilo).
    Письмо открывается в Outlook ссылкой mailto: (длинные письма Windows обрезает) либо
    скачивается файлом .eml: Outlook открывает его черновиком, со всем текстом и вложением —
    книгой Excel с расчётом гидравлики.
*/

var HydRequest = (function () {
    'use strict';

    var MAIL_LIMIT = 1800;          // дальше mailto: обрезают сами Windows
    var DEFAULT_TO = 'konstantin.yarkov@wilo.ru';

    /* Адресаты, из которых выбирают галочками; любые другие адреса вписываются в поле «Кому». */
    var CONTACTS = [
        { name: 'Константин Ярков', mail: 'konstantin.yarkov@wilo.ru' },
        { name: 'Кирилл Копылов', mail: 'kirill.kopylov@wilo.ru' }
    ];

    /* Адреса из строки «a@b.ru; c@d.ru, e@f.ru» — по одному, без пустых. */
    function addresses(text) {
        return String(text || '').split(/[;,\s]+/).filter(function (s) { return s; });
    }

    /* Для заголовка To и ссылки mailto: адреса через запятую. */
    function recipients(text) { return addresses(text).join(','); }
    var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    function n2(v) { return Format.num(v, 2); }

    /* Установки, которым нужен подбор: насос на схеме есть и напор сети не хватает. */
    function stations(result, hyd) {
        return HydPumps.rows(result, hyd).filter(function (r) { return r.sys.pump.needed; });
    }

    function body(result, hyd, project) {
        var o = project.object || {};
        var name = hyd.survey.objectName || o.name || '';
        var note = hyd.note || {};
        var engineer = note.engineer || (hyd.itp && hyd.itp.author) || '';
        var lines = [];

        lines.push('Добрый день!');
        lines.push('');
        lines.push('Прошу подобрать насосное оборудование для систем хозяйственно-питьевого водоснабжения.');
        lines.push('');
        lines.push('Объект: ' + (name || '—') + (o.address ? ', ' + o.address : ''));
        if (hyd.itp && hyd.itp.cipher) lines.push('Шифр: ' + hyd.itp.cipher);
        lines.push('Гарантированный напор на вводе: ' + n2(result.input.input.Hgar) + ' м.');
        lines.push('');

        stations(result, hyd).forEach(function (r) {
            lines.push(r.sys.name);
            lines.push('Q = ' + n2(r.sys.pump.q) + ' л/с, H = ' + n2(r.sys.pump.hp) + ' м.');
            lines.push('');
        });

        lines.push('Прошу подобрать оборудование и прислать каталожные листы.');

        if (engineer) {
            lines.push('');
            lines.push('С уважением,');
            lines.push(engineer);
        }

        return lines.join('\n');
    }

    /* Тема — название объекта: так письма складываются по объектам в почте. */
    function subject(hyd, project) {
        return hyd.survey.objectName || (project.object && project.object.name) || 'Подбор насосного оборудования';
    }

    /* Вложение — расчёт гидравлики книгой Excel с живыми формулами. */
    function attachments(result, hyd) {
        try {
            return [{ name: 'Расчёт гидравлики.xlsx', type: XLSX_TYPE, bytes: Xlsx.bytes(HydReport.sheets(result, hyd)) }];
        } catch (e) {
            return [];     // книга не собралась — письмо уходит без вложения
        }
    }

    /* Письмо целиком: кому, тема, текст и сколько в нём установок. */
    function letter(result, hyd, project) {
        return {
            to: (hyd.note && hyd.note.supplierMail) || DEFAULT_TO,
            subject: subject(hyd, project),
            body: body(result, hyd, project),
            files: [],
            stations: stations(result, hyd).length
        };
    }

    function mailto(mail) {
        return 'mailto:' + encodeURIComponent(recipients(mail.to)).replace(/%2C/g, ',')
            + '?subject=' + encodeURIComponent(mail.subject)
            + '&body=' + encodeURIComponent(mail.body);
    }

    /* --- письмо файлом .eml ------------------------------------------------------ */

    function utf8(text) { return new TextEncoder().encode(text); }

    function base64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function wrap(text) {
        var out = [];
        for (var i = 0; i < text.length; i += 76) out.push(text.slice(i, i + 76));
        return out.join('\r\n');
    }

    /* Заголовки ходят в ASCII: русская тема кодируется по RFC 2047, иначе Outlook покажет кракозябры. */
    function encodeHeader(text) {
        if (/^[\x20-\x7E]*$/.test(text)) return text;
        return '=?UTF-8?B?' + base64(utf8(text)) + '?=';
    }

    function eml(mail) {
        var text = mail.body.replace(/\n/g, '\r\n');
        var files = mail.files || [];
        var head = [
            'To: ' + recipients(mail.to),
            'Subject: ' + encodeHeader(mail.subject),
            'X-Unsent: 1',                      // Outlook откроет как черновик
            'MIME-Version: 1.0'
        ];

        if (!files.length) {
            return head.concat([
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: base64',
                '',
                wrap(base64(utf8(text)))
            ]).join('\r\n');
        }

        var mark = '----vk-' + Date.now();
        var out = head.concat([
            'Content-Type: multipart/mixed; boundary="' + mark + '"',
            '',
            '--' + mark,
            'Content-Type: text/plain; charset=utf-8',
            'Content-Transfer-Encoding: base64',
            '',
            wrap(base64(utf8(text)))
        ]);

        files.forEach(function (f) {
            out.push('--' + mark);
            out.push('Content-Type: ' + (f.type || 'application/octet-stream') + '; name="' + encodeHeader(f.name) + '"');
            out.push('Content-Transfer-Encoding: base64');
            out.push('Content-Disposition: attachment; filename="' + encodeHeader(f.name) + '"');
            out.push('');
            out.push(wrap(base64(f.bytes)));
        });

        out.push('--' + mark + '--');
        return out.join('\r\n');
    }

    function saveEml(mail, name) {
        var blob = new Blob([eml(mail)], { type: 'message/rfc822' });
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
        MAIL_LIMIT: MAIL_LIMIT, DEFAULT_TO: DEFAULT_TO, CONTACTS: CONTACTS, addresses: addresses, recipients: recipients,
        letter: letter, body: body, subject: subject, mailto: mailto, eml: eml, saveEml: saveEml,
        stations: stations, attachments: attachments
    };
})();
