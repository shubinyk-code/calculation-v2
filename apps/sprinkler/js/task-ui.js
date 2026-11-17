'use strict';

/*
    Рабочее место «Задание для ЭЛ и СС»: слева шапка бланка, справа таблица
    позиций — ровно те столбцы, что в бланке бюро. Позиции собирает Task из
    книги; всё, что вписано руками, остаётся в книге и расчётом не затирается.

    Выгрузка — книга Excel в том же виде: шапка, легенда изменений, таблица и
    лист «Данные» с выпадающими списками, из которых выбирают категорию
    оборудования, диспетчеризацию и протокол.
*/

var TaskUI = (function () {

    function $(id) { return document.getElementById(id); }
    function esc(text) { return Fmt.html(text === null || text === undefined ? '' : String(text)); }

    /* --- столбцы бланка ---------------------------------------------------- */

    var COLS = [
        { key: 'num', head: 'N', width: 3.14 },
        { key: 'code', head: 'Проектный номер', width: 13.71 },
        { key: 'room', head: 'Номер помещения', width: 19 },
        { key: 'category', head: 'Категория оборудования', width: 23.57 },
        { key: 'name', head: 'Наименование', width: 27 },
        { key: 'note', head: 'Описание', width: 108.43 },
        { key: 'work', head: 'Рабочие', width: 7.29 },
        { key: 'reserve', head: 'Резервные', width: 7.43 },
        { key: 'total', head: 'Общее', width: 7.43 },
        { key: 'power', head: 'Нагрузка на единицу кВт', width: 6.29 },
        { key: 'voltage', head: 'Напряжение, В', width: 6.29 },
        { key: 'telemetry', head: 'Диспетчеризация требуется?', width: 6.43 },
        { key: 'protocol', head: 'Протокол диспетчеризации', width: 9.86 },
        { key: 'remark', head: 'Примечание', width: 42.43 },
        { key: 'el', head: 'Согласование раздела ЭЛ', width: 5.43 },
        { key: 'ss', head: 'Согласование раздела СС', width: 5.29 }
    ];

    /* --- форма слева ------------------------------------------------------- */

    function field(label, key, value, unit) {
        return '<label class="field"><span>' + esc(label) + (unit ? ', ' + esc(unit) : '') + '</span>'
            + '<input type="text" data-key="' + key + '" value="' + esc(value) + '"></label>';
    }

    function selectField(label, key, value, options) {
        var html = '<label class="field"><span>' + esc(label) + '</span><select data-key="' + key + '">';
        options.forEach(function (o) {
            html += '<option value="' + esc(o) + '"' + (String(o) === String(value) ? ' selected' : '') + '>' + esc(o) + '</option>';
        });
        return html + '</select></label>';
    }

    function section(title, body) {
        return '<section class="block"><h3>' + esc(title) + '</h3>' + body + '</section>';
    }

    function form() {
        var book = App.book;
        var t = book.task;
        var o = book.object;

        return '<div class="form">'
            + section('Бланк задания',
                field('Объект (из книги)', 'obj:name', o.name)
                + '<div class="pair">' + field('Шифр', 'obj:code', o.code)
                + field('Этап', 't:step', t.step) + '</div>'
                + '<div class="pair">' + field('Стадия проектирования', 't:stage', t.stage)
                + field('Ревизия задания', 't:revision', t.revision) + '</div>'
                + field('Дата выдачи', 't:date', t.date)
                + '<p class="hint">Дата пустая — в бланк встанет сегодняшняя.</p>')
            + section('Подписи',
                field('Разработал', 't:developer', t.developer)
                + field('Выдал', 't:issuer', t.issuer)
                + field('Принял', 't:receiver', t.receiver))
            + section('По умолчанию для позиций',
                field('Номер помещения насосной', 't:room', t.room)
                + '<div class="pair">' + field('Напряжение', 't:voltage', t.voltage, 'В')
                + selectField('Протокол диспетчеризации', 't:protocol', t.protocol, Task.PROTOCOLS) + '</div>'
                + '<p class="hint">Эти значения идут во все позиции насосной. У отдельной позиции их '
                + 'можно поправить прямо в таблице — вписанное расчёт больше не трогает.</p>')
            + section('Бланк бюро',
                '<div class="actions"><button data-action="task-template">Шаблон .xlsx…</button>'
                + (t.template ? '<button data-action="task-forget">Вернуть встроенный</button>' : '') + '</div>'
                + '<p class="hint">Бланк: <b>' + esc(t.template ? t.template.name : 'встроенный, форма бюро')
                + '</b>. Выгрузка идёт прямо в него: заполняются поля, а штамп, цветная легенда, подсказки '
                + 'в ячейках, лист «Пример заполнения» и печать остаются бланковские. Вышла новая ревизия '
                + 'формы — загрузите её кнопкой, она запомнится в книге.</p>')
            + '</div>';
    }

    /* --- таблица справа ---------------------------------------------------- */

    function cellInput(row, key, value, cls) {
        return '<input class="cell ' + (cls || '') + '" data-row="' + esc(row.key) + '" data-field="' + key
            + '" value="' + esc(value) + '">';
    }

    function table(rows) {
        var html = '<table class="grid task"><thead><tr><th>N</th>'
            + COLS.slice(1).map(function (c) { return '<th>' + esc(c.head) + '</th>'; }).join('')
            + '<th></th></tr></thead><tbody>';

        rows.forEach(function (row, i) {
            var total = (Number(row.work) || 0) + (Number(row.reserve) || 0);
            html += '<tr data-row="' + esc(row.key) + '">'
                + '<td class="num">' + (i + 1) + '</td>'
                + '<td>' + cellInput(row, 'code', row.code, 'short') + '</td>'
                + '<td>' + cellInput(row, 'room', row.room) + '</td>'
                + '<td>' + cellInput(row, 'category', row.category) + '</td>'
                + '<td>' + cellInput(row, 'name', row.name) + '</td>'
                + '<td class="note"><textarea class="cell" data-row="' + esc(row.key) + '" data-field="note" rows="3">'
                + esc(row.note) + '</textarea></td>'
                + '<td>' + cellInput(row, 'work', row.work, 'short') + '</td>'
                + '<td>' + cellInput(row, 'reserve', row.reserve, 'short') + '</td>'
                + '<td class="num strong">' + total + '</td>'
                + '<td>' + cellInput(row, 'power', row.power, 'short') + '</td>'
                + '<td>' + cellInput(row, 'voltage', row.voltage, 'short') + '</td>'
                + '<td>' + cellInput(row, 'telemetry', row.telemetry, 'short') + '</td>'
                + '<td>' + cellInput(row, 'protocol', row.protocol, 'short') + '</td>'
                + '<td>' + cellInput(row, 'remark', row.remark) + '</td>'
                + '<td class="actions-cell"><button data-action="task-off:' + esc(row.key) + '" title="Убрать позицию из задания">×</button></td>'
                + '</tr>';
        });

        return html + '</tbody></table>';
    }

    function warningsHtml(list) {
        if (!list.length) return '';
        return '<ul class="warnings">' + list.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    }

    function refresh() {
        var book = App.book;
        if (!book.task) book.task = Task.create();

        var list = Task.rows(book);
        $('taskForm').innerHTML = form();
        $('taskPreview').innerHTML = warningsHtml(Task.warnings(book, list)) + table(list)
            + '<div class="actions"><button data-action="task-add">+ Своя позиция</button>'
            + '<button data-action="task-reset">Вернуть расчётные значения</button></div>';
        $('taskInfo').textContent = 'позиций: ' + list.length;
    }

    /* --- выгрузка ---------------------------------------------------------- */

    /*
        Выгрузка всегда идёт в бланк бюро: загруженный в книгу или встроенный в
        программу. Своя форма — только запасной выход, если бланк не прочитался.
    */
    function saveXlsx() {
        var book = App.book;
        var rows = Task.rows(book);
        var blank = TaskForm.blankOf(book);
        var name = Storage.safeName(book.object.name, ' — задание для ЭЛ и СС.xlsx');

        TaskForm.fill(book, rows).then(function (bytes) {
            Zip.save(new Blob([bytes], { type: 'application/octet-stream' }), name);
            App.status('Задание заполнено в бланк «' + (blank ? blank.name : '') + '»: позиций '
                + rows.length + '.', 'done');
        }).catch(function (err) {
            App.status('Бланк не заполнился: ' + (err && err.message ? err.message : err)
                + ' Выгружаю своей формой.', 'warn');
            Xlsx.save(TaskForm.sheets(book, rows), name);
        });
    }

    /* --- правка ------------------------------------------------------------ */

    function own(book, key) {
        if (!book.task.rows[key]) book.task.rows[key] = {};
        return book.task.rows[key];
    }

    function extraOf(book, key) {
        for (var i = 0; i < book.task.extra.length; i++) {
            if (book.task.extra[i].key === key) return book.task.extra[i];
        }
        return null;
    }

    function onChange(e) {
        var el = e.target;
        var book = App.book;

        if (el.dataset.row && el.dataset.field) {
            var extra = extraOf(book, el.dataset.row);
            var target = extra || own(book, el.dataset.row);
            target[el.dataset.field] = el.value;
            App.afterEdit('задание');
            return;
        }

        if (!el.dataset.key) return;
        var parts = el.dataset.key.split(':');

        if (parts[0] === 'obj') {
            book.object[parts[1]] = el.value;
            if (parts[1] === 'name') $('projectName').value = el.value;
        } else if (parts[0] === 't') {
            book.task[parts[1]] = el.value;
        }

        App.afterEdit('задание');
    }

    function onClick(e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;

        var book = App.book;
        var action = b.dataset.action;

        if (action === 'task-add') {
            book.task.extra.push(Task.normalize({ extra: [{}] }).extra[0]);
            App.afterEdit('позиция задания');
            return;
        }

        if (action === 'task-reset') {
            book.task.rows = {};
            App.afterEdit('расчётные значения задания');
            return;
        }

        if (action.indexOf('task-off:') === 0) {
            var key = action.slice('task-off:'.length);
            var extra = extraOf(book, key);
            if (extra) {
                book.task.extra = book.task.extra.filter(function (r) { return r.key !== key; });
            } else {
                own(book, key).off = true;
            }
            App.afterEdit('позиция задания');
            return;
        }

        if (action === 'task-template') { $('taskTemplateInput').click(); return; }

        if (action === 'task-forget') {
            book.task.template = null;
            App.afterEdit('бланк задания');
            App.status('Свой бланк забыт: задание пойдёт во встроенный бланк бюро.', 'done');
            return;
        }

        if (action === 'task-xlsx') saveXlsx();
        if (action === 'task-print') App.print();
    }

    function loadTemplate(file) {
        var reader = new FileReader();
        reader.onload = function () {
            var bytes = new Uint8Array(reader.result);
            TaskForm.check(bytes).then(function () {
                App.book.task.template = { name: file.name, data: Zip.toBase64(bytes) };
                App.afterEdit('бланк задания');
                App.status('Бланк «' + file.name + '» запомнен в книге.', 'done');
            }).catch(function (err) {
                App.status('Бланк не подошёл: ' + (err && err.message ? err.message : err), 'warn');
            });
        };
        reader.readAsArrayBuffer(file);
    }

    function init() {
        $('taskForm').addEventListener('change', onChange);
        $('taskPreview').addEventListener('change', onChange);
        $('taskForm').addEventListener('click', onClick);
        $('taskPreview').addEventListener('click', onClick);
        document.getElementById('taskMain').addEventListener('click', onClick);

        $('taskTemplateInput').addEventListener('change', function () {
            if (this.files && this.files[0]) loadTemplate(this.files[0]);
            this.value = '';
        });
    }

    return {
        init: init,
        refresh: refresh,
        saveXlsx: saveXlsx
    };
})();
