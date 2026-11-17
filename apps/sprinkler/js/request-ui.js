'use strict';

/*
    Окно «Отправить на подбор»: письмо поставщику с требуемыми подачей и
    напором каждой насосной.

    Текст собирается из расчёта и показывается целиком — его можно поправить
    перед отправкой, это обычное письмо, а не бланк. Дальше два пути:
    «Открыть в Outlook» — ссылка mailto:, самый короткий путь, но длинные
    письма Windows обрезает; «Скачать письмо .eml» — файл, который Outlook
    открывает черновиком, с вложенными расчётами.
*/

var RequestUI = (function () {

    var open = false;
    var mail = null;
    var withFiles = true;

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }

    /*
        Кому слать: отмеченные галочками адресаты складываются в поле «Кому»,
        а вписанные руками адреса в нём остаются — список знакомых лиц не
        отменяет свободной строки.
    */
    function contacts() {
        var list = Request.recipients(mail.to);

        return '<div class="mail-contacts"><span class="vb-label">Адресаты</span>'
            + Request.CONTACTS.map(function (c, i) {
                var on = list.indexOf(c.mail) >= 0;
                return '<label class="check inline"><input type="checkbox" data-contact="' + i + '"'
                    + (on ? ' checked' : '') + '> ' + esc(c.name) + ' <span class="dim">'
                    + esc(c.firm + ', ' + c.mail) + '</span></label>';
            }).join('')
            + '</div>';
    }

    /** Галочка адресата: добавить его в «Кому» или убрать оттуда. */
    function toggleContact(index, on) {
        pull();

        var who = Request.CONTACTS[index];
        if (!who) return;

        var list = Request.recipients(mail.to).filter(function (one) { return one !== who.mail; });
        if (on) list.push(who.mail);

        mail.to = Request.joinTo(list);
        render();
    }

    function render() {
        var root = $('modalRoot');
        if (!open) {
            root.innerHTML = '';
            return;
        }

        var long = mail.body.length > Request.MAIL_LIMIT;
        var files = withFiles ? Request.attachments(App.book) : [];

        root.innerHTML = '<div class="modal mail-modal" data-close="1"><div class="sheet mail-sheet">'
            + '<h2>Отправить на подбор</h2>'
            + contacts()
            + '<div class="pair">'
            + '<label class="field"><span>Кому</span><input type="text" id="mailTo" value="' + esc(mail.to) + '"></label>'
            + '<label class="field"><span>Тема (название объекта)</span><input type="text" id="mailSubject" value="'
            + esc(mail.subject) + '"></label>'
            + '</div>'
            + '<label class="field"><span>Письмо</span><textarea id="mailBody" rows="16">' + esc(mail.body) + '</textarea></label>'
            + '<label class="check inline"><input type="checkbox" id="mailFiles"' + (withFiles ? ' checked' : '')
            + '> приложить расчёты системами (.xlsx): ' + (files.length ? files.length + ' шт.' : 'нечего прикладывать')
            + '</label>'
            + '<p class="hint">Насосных в письме: <b>' + mail.stations + '</b>. Подача и напор — из расчёта, '
            + 'напор жокей-насоса — давление включения (напор после установки плюс запас из записки).</p>'
            + (long
                ? '<p class="note-warn">Письмо длинное: Outlook через ссылку может его обрезать. Надёжнее «Скачать письмо .eml» '
                    + '— файл откроется черновиком со всем текстом и вложениями.</p>'
                : '<p class="hint">Вложения уходят только с файлом .eml: ссылка mailto: прикладывать файлы не умеет. '
                    + 'Расчёт в PDF программа не делает — лист печатают кнопкой «Печать / PDF» и прикладывают сами.</p>')
            + '<div class="sheet-buttons">'
            + '<button data-close="1">Отмена</button>'
            + '<button data-action="mail-copy">Скопировать текст</button>'
            + '<button data-action="mail-eml">Скачать письмо .eml</button>'
            + '<button data-action="mail-open" class="primary">Открыть в Outlook</button>'
            + '</div></div></div>';
    }

    /** Поправки из полей — письмо отправляют тем, что видно на экране. */
    function pull() {
        if (!$('mailTo')) return;
        mail.to = $('mailTo').value.trim();
        mail.subject = $('mailSubject').value;
        mail.body = $('mailBody').value;
        withFiles = $('mailFiles').checked;
    }

    function openWindow() {
        var book = App.book;
        mail = Request.letter(book, false);
        withFiles = true;

        if (!mail.stations) {
            App.status('Насосные установки не требуются: подбирать нечего.', 'warn');
            return;
        }

        open = true;
        render();
    }

    function close() {
        open = false;
        render();
    }

    function remember() {
        var book = App.book;
        if (book.text.supplierMail === mail.to) return;
        book.text.supplierMail = mail.to;
        App.afterEdit('адрес поставщика');
    }

    function action(name) {
        pull();

        if (name === 'mail-open') {
            remember();
            window.location.href = Request.mailto(mail);
            App.status('Письмо открыто в почтовой программе. Вложения ссылка не переносит — '
                + 'если нужны расчёты, возьмите «Скачать письмо .eml».', 'done');
            close();
        } else if (name === 'mail-eml') {
            remember();
            var full = { to: mail.to, subject: mail.subject, body: mail.body,
                files: withFiles ? Request.attachments(App.book) : [] };
            Request.saveEml(full, Storage.safeName(App.book.object.name, ' — подбор насосов.eml'));
            App.status('Письмо сохранено файлом .eml' + (full.files.length ? ' с ' + full.files.length + ' вложениями' : '')
                + '. Откройте его — Outlook покажет черновик.', 'done');
            close();
        } else if (name === 'mail-copy') {
            navigator.clipboard.writeText(mail.body).then(function () {
                App.status('Текст письма скопирован.', 'done');
            }, function () {
                App.status('Скопировать не вышло — выделите текст в окне и скопируйте вручную.', 'warn');
            });
        }
    }

    function init() {
        var root = $('modalRoot');

        root.addEventListener('click', function (e) {
            if (!open) return;
            var b = e.target.closest('[data-action]');
            if (b && /^mail-/.test(b.dataset.action)) {
                action(b.dataset.action);
                return;
            }
            var closer = e.target.closest('[data-close]');
            if (closer && (closer.tagName === 'BUTTON' || e.target === closer)) close();
        });

        root.addEventListener('change', function (e) {
            if (!open) return;
            var box = e.target.closest('[data-contact]');
            if (box) toggleContact(Number(box.dataset.contact), box.checked);
        });
    }

    return {
        init: init,
        open: openWindow,
        close: close,
        isOpen: function () { return open; }
    };
})();
