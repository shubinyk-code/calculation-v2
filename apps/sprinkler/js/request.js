'use strict';

/*
    Запрос на подбор насосного оборудования.

    После расчёта остаётся отправить поставщику подачу и напор каждой
    насосной — и это то место, где числа чаще всего перебивают руками и
    ошибаются. Письмо собирается само: по блоку на насосную, в блоке зона,
    состав (ВПВ+АПТ), требуемые Q и H, а следом жокей-насос, если он у этой
    насосной есть.

    Открывается письмо в почтовой программе ссылкой mailto: — в Windows это
    Outlook. Длинные письма в mailto: не влезают (ограничение самой ссылки),
    поэтому рядом есть выгрузка .eml: такой файл Outlook открывает как
    черновик со всеми строками.
*/

var Request = (function () {

    var MAIL_LIMIT = 1800;          // дальше mailto: обрезают сами Windows

    /*
        Поставщики, которым шлём подбор. Список — чтобы не вспоминать адреса и
        не ошибаться в них: отмечаешь, кому письмо, остальное дописывается
        руками в поле «Кому».
    */
    var CONTACTS = [
        { name: 'Ярков Константин', mail: 'konstantin.yarkov@wilo.ru', firm: 'Wilo' },
        { name: 'Копылов Кирилл', mail: 'kirill.kopylov@wilo.ru', firm: 'Wilo' }
    ];

    /** Адреса строкой «кому» списком: разделители — точка с запятой и запятая. */
    function recipients(text) {
        return String(text || '').split(/[;,]/).map(function (one) {
            return one.trim();
        }).filter(function (one) { return one.length > 0; });
    }

    /** Обратно в строку для поля «Кому». */
    function joinTo(list) {
        return list.join('; ');
    }

    function n2(v) { return Fmt.num(v, 2); }

    /** Состав насосной словами: «ВПВ+АПТ», «АПТ», «ВПВ». */
    function kindsOf(owner) {
        var list = owner.kind === 'station' ? (owner.kinds || []) : [owner.kind];
        var out = [];

        list.forEach(function (k) {
            // Внутреннее пожаротушение по плану — это тоже ВПВ.
            var name = k === 'vpv' || k === 'vpvplan' ? 'ВПВ' : 'АПТ';
            if (out.indexOf(name) < 0) out.push(name);
        });

        // Привычный порядок записки и писем: сначала ВПВ, потом АПТ.
        out.sort(function (a, b) { return a === 'ВПВ' ? -1 : b === 'ВПВ' ? 1 : 0; });
        return out.join('+');
    }

    /** Заголовок блока: зона, если она задана, иначе обозначение системы. */
    function title(owner) {
        var kinds = kindsOf(owner);

        if (owner.kind === 'station') {
            return (owner.station.zone || owner.station.name) + (kinds ? ' ' + kinds : '');
        }

        // Система сама по себе: обозначение, состав и наименование через тире.
        var sys = owner.sys;
        return sys.code + (kinds ? ' ' + kinds : '') + (sys.title ? ' — ' + sys.title : '');
    }

    /** Насосные, которым нужен подбор: те, которым не хватает гарантированного напора. */
    function stations(book) {
        var data = Tch.systems(book);
        return Tch.owners(data).filter(function (o) { return Tch.pumpNeed(o).H > 0; });
    }

    /**
     * Текст письма: шапка с объектом и по блоку на насосную. Жокей-насос
     * идёт следом за своей установкой — с напором включения из расчёта.
     */
    function body(book) {
        var t = book.text || {};
        var delta = t.jockeyDelta > 0 ? t.jockeyDelta : 5;
        var lines = [];
        var o = book.object;

        lines.push('Добрый день!');
        lines.push('');
        lines.push('Прошу подобрать насосное оборудование для систем противопожарного водоснабжения.');
        lines.push('');
        lines.push('Объект: ' + (o.name || '—') + (o.address ? ', ' + o.address : ''));
        if (o.code) lines.push('Шифр: ' + o.code);
        lines.push('Гарантированный напор на вводе: ' + n2(Tch.guaranteed(book).value) + ' м.');
        lines.push('');

        stations(book).forEach(function (owner) {
            var need = Tch.pumpNeed(owner);

            lines.push(title(owner));
            lines.push('Q = ' + n2(need.Q) + ' л/с, H = ' + n2(need.H) + ' м.');

            /*
                Жокею нужен напор самого насоса, а не давление в сети: он
                принимается на запас выше напора основной установки. Давление
                включения (напор после установки плюс запас) — другая величина,
                она идёт в записку, в таблицу жокей-насосов.
            */
            if (Appendix.jockeyOn(owner)) {
                lines.push('Жокей-насос');
                lines.push('Q = 1 м³/ч, H = ' + n2(need.H + delta) + ' м.');
            }

            lines.push('');
        });

        lines.push('Напор жокей-насоса принят на ' + Fmt.trim(delta, 2)
            + ' м выше напора основной насосной установки.');
        lines.push('');
        lines.push('Прошу подобрать оборудование и прислать каталожные листы.');

        if (t.engineer) {
            lines.push('');
            lines.push('С уважением,');
            lines.push(t.engineer);
        }

        return lines.join('\n');
    }

    /** Тема — название объекта: так письма складываются по объектам в почте. */
    function subject(book) {
        return book.object.name || 'Подбор насосного оборудования';
    }

    /*
        Вложения — расчёты систем книгой Excel с живыми формулами: поставщику
        видно не только требуемую точку, но и откуда она взялась. Система,
        которая не считается, вложением не идёт.
    */
    var XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    function attachments(book) {
        var out = [];

        (book.systems || []).forEach(function (s) {
            try {
                if (s.kind === 'apt' || s.kind === 'vpvplan') {
                    var net = Solver.solve(s.project);
                    var calc = Calc.build(s.project, net);
                    if (!calc.ok) return;
                    out.push({
                        name: 'Расчёт ' + s.code + '.xlsx', type: XLSX_TYPE,
                        bytes: Xlsx.bytes(ExcelExport.sheets({ project: s.project, net: net, calc: calc }))
                    });
                } else if (s.kind === 'vpv') {
                    var r = Vpv.solve(s.vpv, book);
                    if (!r.ok) return;
                    out.push({
                        name: 'Расчёт ' + s.code + '.xlsx', type: XLSX_TYPE,
                        bytes: Xlsx.bytes(VpvUI.excelSheets(s, s.vpv, r))
                    });
                }
            } catch (e) {
                // Система не собирается в книгу — письмо уходит без её вложения.
            }
        });

        return out;
    }

    /** Письмо целиком: кому, тема, текст и сколько в нём насосных. */
    function letter(book, withFiles) {
        var t = book.text || {};
        return {
            to: t.supplierMail || CONTACTS[0].mail,
            subject: subject(book),
            body: body(book),
            files: withFiles ? attachments(book) : [],
            stations: stations(book).length
        };
    }

    /*
        Ссылка для почтовой программы. Адресов может быть несколько — в ссылке
        они разделяются запятой, и каждый кодируется отдельно: закодированная
        запятая превратила бы список в один длинный адрес.
    */
    function mailto(mail) {
        var to = recipients(mail.to).map(encodeURIComponent).join(',');

        return 'mailto:' + to
            + '?subject=' + encodeURIComponent(mail.subject)
            + '&body=' + encodeURIComponent(mail.body);
    }

    /*
        Письмо файлом .eml — его Outlook открывает черновиком: длина не
        ограничена, и к нему можно приложить расчёты. Вложения идут частями
        multipart/mixed, каждое в base64 по 76 символов в строке, как велит
        почтовый формат.
    */
    function eml(mail) {
        var text = mail.body.replace(/\n/g, '\r\n');
        var files = mail.files || [];
        var head = [
            // В заголовке письма адреса разделяет запятая — так велит RFC 5322.
            'To: ' + recipients(mail.to).join(', '),
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

        var mark = '----aupt-' + Date.now();
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

    function wrap(text) {
        var out = [];
        for (var i = 0; i < text.length; i += 76) out.push(text.slice(i, i + 76));
        return out.join('\r\n');
    }

    /*
        Заголовки письма ходят в ASCII, поэтому русская тема кодируется по
        RFC 2047 — иначе Outlook покажет кракозябры в строке темы.
    */
    function encodeHeader(text) {
        if (/^[\x20-\x7E]*$/.test(text)) return text;
        return '=?UTF-8?B?' + base64(utf8(text)) + '?=';
    }

    function utf8(text) {
        return new TextEncoder().encode(text);
    }

    function base64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
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
        MAIL_LIMIT: MAIL_LIMIT,
        CONTACTS: CONTACTS,
        recipients: recipients,
        joinTo: joinTo,
        letter: letter,
        body: body,
        subject: subject,
        mailto: mailto,
        eml: eml,
        saveEml: saveEml,
        stations: stations,
        attachments: attachments,
        title: title
    };
})();
