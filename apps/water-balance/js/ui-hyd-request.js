/*
    Окно «Отправить на подбор»: письмо поставщику с требуемыми подачей и напором каждой насосной
    установки. Текст собирается из расчёта и показывается целиком — его можно поправить перед
    отправкой, это обычное письмо, а не бланк. Дальше: «Открыть в Outlook» (ссылка mailto:,
    длинные письма Windows обрезает), «Скачать письмо .eml» (Outlook открывает черновиком, с
    вложенным расчётом) или «Скопировать текст».
*/

var UiHydRequest = (function () {
    'use strict';

    var esc = Format.html;
    var root = null;
    var mail = null;
    var withFiles = true;
    var attached = 0;

    function hyd() { return App.project.hyd; }

    function $(id) { return document.getElementById(id); }

    function status(text, kind) {
        if (App.status) App.status(text, kind || 'done');
    }

    function render() {
        if (!root) return;
        if (!mail) { root.innerHTML = ''; return; }

        var long = mail.body.length > HydRequest.MAIL_LIMIT;

        root.innerHTML = '<div class="rq-back" data-rq="close"><div class="rq-sheet">'
            + '<h2>Отправить на подбор</h2>'
            + '<div class="rq-who"><span>Кому отправить</span>'
            + HydRequest.CONTACTS.map(function (c) {
                var on = HydRequest.addresses(mail.to).indexOf(c.mail) >= 0;
                return '<label class="rq-check"><input type="checkbox" data-rq-who="' + esc(c.mail) + '"' + (on ? ' checked' : '') + '> '
                    + esc(c.name) + ' <span class="rq-addr">' + esc(c.mail) + '</span></label>';
            }).join('')
            + '</div>'
            + '<div class="rq-pair">'
            + '<label class="rq-field"><span>Адреса (можно дописать другие через «;»)</span><input type="text" id="rqTo" value="' + esc(mail.to) + '"></label>'
            + '<label class="rq-field"><span>Тема (название объекта)</span><input type="text" id="rqSubject" value="' + esc(mail.subject) + '"></label>'
            + '</div>'
            + '<label class="rq-field"><span>Письмо</span><textarea id="rqBody" rows="14">' + esc(mail.body) + '</textarea></label>'
            + '<label class="rq-check"><input type="checkbox" id="rqFiles"' + (withFiles ? ' checked' : '') + '> приложить расчёт гидравлики (.xlsx)'
            + (attached ? '' : ' — не собрался') + '</label>'
            + '<p class="hint">Установок в письме: <b>' + mail.stations + '</b>. Подача и напор — из расчёта (Hтр = Hgeom + ΣHl,tot + Hпр − Hгар).</p>'
            + (long
                ? '<p class="st-bad">Письмо длинное: Outlook через ссылку может его обрезать. Надёжнее «Скачать письмо .eml» — файл откроется черновиком со всем текстом и вложением.</p>'
                : '<p class="hint">Вложение уходит только с файлом .eml: ссылка mailto: прикладывать файлы не умеет.</p>')
            + '<div class="rq-buttons">'
            + '<button type="button" data-rq="close">Отмена</button>'
            + '<button type="button" data-rq="copy">Скопировать текст</button>'
            + '<button type="button" data-rq="eml">Скачать письмо .eml</button>'
            + '<button type="button" data-rq="open" class="primary">Открыть в Outlook</button>'
            + '</div></div></div>';
    }

    /* Поправки из полей — письмо уходит тем, что видно на экране. */
    function pull() {
        if (!$('rqTo')) return;
        mail.to = $('rqTo').value.trim();
        mail.subject = $('rqSubject').value;
        mail.body = $('rqBody').value;
        withFiles = $('rqFiles').checked;
    }

    /* Галочка у адресата добавляет его адрес в поле «Кому» или убирает оттуда. */
    function toggleWho(address, on) {
        pull();
        var list = HydRequest.addresses(mail.to).filter(function (a) { return a !== address; });
        if (on) list.push(address);
        mail.to = list.join('; ');
        $('rqTo').value = mail.to;
    }

    function close() {
        mail = null;
        render();
    }

    /* Адрес поставщика запоминается в проекте — в следующий раз подставится сам. */
    function remember() {
        var note = hyd().note;
        if (note.supplierMail === mail.to) return;
        note.supplierMail = mail.to;
        UiHyd.changed(false);
    }

    function open() {
        var res = UiHyd.result;
        if (!res || !res.input) { status('Расчёта нет: на схеме нужен ввод и стояки.', 'warn'); return; }

        mail = HydRequest.letter(res, hyd(), App.project);
        if (!mail.stations) { mail = null; status('Насосные установки не требуются: подбирать нечего.', 'warn'); return; }

        attached = HydRequest.attachments(res, hyd()).length;
        withFiles = true;
        render();
    }

    function fileName() {
        var base = (mail.subject || 'Подбор насосов').replace(/[\\\/:*?"<>|]/g, '-');
        return base + ' — подбор насосов.eml';
    }

    function act(name) {
        pull();

        if (name === 'open') {
            remember();
            window.location.href = HydRequest.mailto(mail);
            status('Письмо открыто в почтовой программе. Вложение ссылка не переносит — если нужен расчёт, возьмите «Скачать письмо .eml».');
            close();
        } else if (name === 'eml') {
            remember();
            var files = withFiles ? HydRequest.attachments(UiHyd.result, hyd()) : [];
            HydRequest.saveEml({ to: mail.to, subject: mail.subject, body: mail.body, files: files }, fileName());
            status('Письмо сохранено файлом .eml' + (files.length ? ' с вложением' : '') + '. Откройте его — Outlook покажет черновик.');
            close();
        } else if (name === 'copy') {
            navigator.clipboard.writeText(mail.body).then(function () {
                status('Текст письма скопирован.');
            }, function () {
                status('Скопировать не вышло — выделите текст в окне и скопируйте вручную.', 'warn');
            });
        } else if (name === 'close') {
            close();
        }
    }

    function init() {
        root = document.createElement('div');
        root.id = 'rqRoot';
        document.body.appendChild(root);

        root.addEventListener('click', function (e) {
            if (!mail) return;
            var b = e.target.closest('[data-rq]');
            if (!b) return;
            // щелчок по фону закрывает окно, по самому листу — нет
            if (b.classList.contains('rq-back') && e.target !== b) return;
            act(b.getAttribute('data-rq'));
        });

        root.addEventListener('change', function (e) {
            var c = e.target.closest('[data-rq-who]');
            if (c && mail) toggleWho(c.getAttribute('data-rq-who'), c.checked);
        });

        // адрес, вписанный руками, сверяется с галочками
        root.addEventListener('input', function (e) {
            if (!mail || e.target.id !== 'rqTo') return;
            var list = HydRequest.addresses(e.target.value);
            root.querySelectorAll('[data-rq-who]').forEach(function (c) {
                c.checked = list.indexOf(c.getAttribute('data-rq-who')) >= 0;
            });
        });
    }

    return { init: init, open: open, close: close, isOpen: function () { return !!mail; } };
})();
