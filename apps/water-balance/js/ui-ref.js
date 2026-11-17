/*
    Вкладка «Справочник»: таблицы норматива в том виде, в каком они лежат в
    sp30-data.js.

    Нужна не для красоты. Когда расчёт даёт неожиданное число, первый вопрос —
    «а что взято из таблицы»; ответ должен быть в двух щелчках, а не в поиске
    бумажного СП.
*/

var UiRef = (function () {
    'use strict';

    var built = false;

    function build(again) {
        if (built && !again) return;

        if (!built) {
            fixtures();
            stacks();

            document.getElementById('addNorm').addEventListener('click', function () {
                App.project.norms.push({
                    name: 'Новый потребитель ' + (App.project.norms.length + 1),
                    unit: '1 потребитель',
                    qu: 0, quh: 0, qhru: 0, qhruh: 0,
                    q0: 0.3, q0hr: 300, q0h: 0.2, q0hrh: 200, t: 24
                });

                apply();
            });
        }

        built = true;
        norms();
    }

    function fixtures() {
        var list = Tables.fixtures();
        var html = [];

        html.push('<thead><tr>');
        html.push('<th class="left" style="min-width:280px">Прибор</th>');
        html.push('<th>q0,<br>л/с</th><th>q0^c,<br>л/с</th><th>q0^h,<br>л/с</th>');
        html.push('<th>q0_hr,<br>л/ч</th><th>q0_hr^c,<br>л/ч</th><th>q0_hr^h,<br>л/ч</th>');
        html.push('<th>q0^s,<br>л/с</th><th>Ø подводки,<br>мм</th><th>Ø отвода,<br>мм</th>');
        html.push('</tr></thead><tbody>');

        for (var i = 0; i < list.length; i++) {
            var f = list[i];

            html.push('<tr>');
            html.push('<td class="left">' + Format.html(f.name) + '</td>');
            html.push(cell(f.q0));
            html.push(cell(f.q0c));
            html.push(cell(f.q0h));
            html.push(cell(f.q0hr, 0));
            html.push(cell(f.q0hrc, 0));
            html.push(cell(f.q0hrh, 0));
            html.push(cell(f.qs));
            html.push(cell(f.dy, 0));
            html.push(cell(f.dyo, 0));
            html.push('</tr>');
        }

        html.push('</tbody>');
        document.getElementById('refFixtures').innerHTML = html.join('');
    }

    /*
        Таблица А.2 редактируемая.

        В перенесённом нормативе тридцать строк, а объекту может понадобиться
        прачечная, баня или лаборатория, которых там нет. Заводить их правкой
        файла программы неправильно: своя строка должна появляться там же, где
        идёт расчёт, и уезжать вместе с проектом.

        Правка строки норматива не портит сам норматив: встроенные значения
        остаются на месте, поверх них ложится проектное переопределение, и
        столбец «Источник» показывает, где чьё.
    */
    var FIELDS = ['qu', 'quh', 'qhru', 'qhruh', 'q0', 'q0hr', 'q0h', 'q0hrh', 't'];

    function norms() {
        var list = Tables.norms();
        var html = [];

        html.push('<thead><tr>');
        html.push('<th class="left" style="min-width:260px">Потребитель</th>');
        html.push('<th class="left" style="min-width:130px">Измеритель</th>');
        html.push('<th>q_u,<br>л/сут</th><th>q_u^h,<br>л/сут</th>');
        html.push('<th>q_hr,u,<br>л/ч</th><th>q_hr,u^h,<br>л/ч</th>');
        html.push('<th>q0,<br>л/с</th><th>q0_hr,<br>л/ч</th>');
        html.push('<th>q0^h,<br>л/с</th><th>q0_hr^h,<br>л/ч</th>');
        html.push('<th>T,<br>ч</th>');
        html.push('<th>Источник</th>');
        html.push('<th></th>');
        html.push('</tr></thead><tbody>');

        for (var i = 0; i < list.length; i++) {
            var n = list[i];
            var own = !!n.custom;
            var builtIn = Tables.isBuiltIn(n.name);

            html.push('<tr data-name="' + Format.html(n.name) + '">');
            html.push('<td class="left"><input type="text" data-field="name" value="'
                + Format.html(n.name) + '"' + (builtIn ? ' readonly title="Имя строки норматива не меняется"' : '') + '></td>');
            html.push('<td class="left"><input type="text" data-field="unit" value="'
                + Format.html(n.unit) + '"></td>');

            for (var f = 0; f < FIELDS.length; f++) {
                html.push('<td><input type="number" min="0" step="0.01" data-field="'
                    + FIELDS[f] + '" value="' + Format.plain(n[FIELDS[f]]) + '"></td>');
            }

            html.push('<td class="dim">' + (own
                ? (builtIn ? 'правка' : 'своя')
                : 'СП 30') + '</td>');

            html.push('<td>' + (own
                ? '<button class="small danger" data-action="reset" title="'
                    + (builtIn ? 'Вернуть значения норматива' : 'Удалить строку') + '">×</button>'
                : '') + '</td>');

            html.push('</tr>');
        }

        html.push('</tbody>');

        var target = document.getElementById('refNorms');
        target.innerHTML = html.join('');

        var inputs = target.querySelectorAll('input');
        for (var k = 0; k < inputs.length; k++) inputs[k].addEventListener('change', onNormChange);

        var buttons = target.querySelectorAll('button[data-action="reset"]');
        for (var b = 0; b < buttons.length; b++) buttons[b].addEventListener('click', onNormReset);
    }

    function rowName(element) {
        var row = element;
        while (row && row.tagName !== 'TR') row = row.parentNode;
        return row ? row.getAttribute('data-name') : null;
    }

    /* Проектная копия нормы: создаётся при первой же правке встроенной строки. */
    function own(name) {
        var list = App.project.norms;

        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) return list[i];
        }

        var source = Tables.norm(name);
        var made = { name: name, unit: source ? source.unit : '1 потребитель' };

        for (var f = 0; f < FIELDS.length; f++) {
            made[FIELDS[f]] = source ? source[FIELDS[f]] : 0;
        }

        list.push(made);
        return made;
    }

    function onNormChange(event) {
        var name = rowName(event.target);
        if (!name) return;

        var field = event.target.getAttribute('data-field');
        var target = own(name);

        if (field === 'name') {
            var renamed = String(event.target.value).trim();
            if (!renamed) { build(true); return; }

            // Переименование своей строки тянет за собой ссылки на неё.
            rename(name, renamed);
            target.name = renamed;
        } else if (field === 'unit') {
            target.unit = event.target.value;
        } else {
            target[field] = Math.max(0, Format.parse(event.target.value, 0));
        }

        apply();
    }

    function rename(from, to) {
        var project = App.project;
        var i;

        for (i = 0; i < project.consumers.length; i++) {
            if (project.consumers[i].norm === from) project.consumers[i].norm = to;
        }

        if (project.riser.norm === from) project.riser.norm = to;
    }

    function onNormReset(event) {
        var name = rowName(event.target);
        if (!name) return;

        var list = App.project.norms;

        for (var i = 0; i < list.length; i++) {
            if (list[i].name !== name) continue;

            list.splice(i, 1);
            break;
        }

        // Своя строка исчезает совсем — потребителей с ней переводим на первую
        // строку норматива, чтобы расчёт не остался без нормы.
        if (!Tables.isBuiltIn(name)) {
            var fallback = Tables.builtInNorms()[0].name;
            rename(name, fallback);
        }

        apply();
    }

    function apply() {
        Tables.setCustom(App.project.norms);
        build(true);
        App.render();
        App.run();
    }

    function stacks() {
        var rows = Tables.rows(SP30.raw['K']);
        var html = [];

        html.push('<thead><tr>');
        html.push('<th class="left">Вытяжная часть</th>');
        html.push('<th class="left">Материал</th>');
        html.push('<th>Ø стояка,<br>мм</th><th>Ø отвода,<br>мм</th><th>Угол</th>');
        html.push('<th>Высота,<br>м</th><th>q_К,<br>л/с</th>');
        html.push('</tr></thead><tbody>');

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row.length < 7) continue;

            var vented = row[0].toLowerCase().indexOf('невент') !== 0;

            html.push('<tr>');
            html.push('<td class="left">' + (vented ? 'есть' : 'нет') + '</td>');
            html.push('<td class="left">' + Format.html(row[1]) + '</td>');
            html.push('<td>' + Format.html(row[2]) + '</td>');
            html.push('<td>' + Format.html(row[3]) + '</td>');
            html.push('<td>' + Format.html(row[4]) + '°</td>');
            html.push('<td class="dim">' + (vented ? '—' : Format.html(row[5])) + '</td>');
            html.push('<td><b>' + Format.html(row[6].replace('.', ',')) + '</b></td>');
            html.push('</tr>');
        }

        html.push('</tbody>');
        document.getElementById('refStacks').innerHTML = html.join('');
    }

    /* Ноль в таблицах норматива означает прочерк, а не нулевое значение. */
    function cell(value, digits) {
        return '<td' + (value > 0 ? '' : ' class="dim"') + '>'
            + (value > 0 ? Format.num(value, digits) : '—') + '</td>';
    }

    return { build: build };
})();
