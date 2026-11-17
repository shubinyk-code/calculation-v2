/*
    Вкладка «Потребители»: единственное место, где вводятся исходные данные.

    Список плоский. Группа («Секция 1», «9 этап») — это только раскладка формы
    баланса, а не принадлежность: как считать итоги, решает вкладка «Итоги».
    Смешивать эти две вещи нельзя — потребитель стоит в одной группе, но входит
    в несколько итогов сразу.

    Два количества потребителей в соседних колонках намеренно: суточное идёт в
    объём, часовое — в вероятность действия приборов. В формах их и пишут через
    дробь, «291/620», и разница между ними — не описка, а разные основания.
*/

var UiConsumers = (function () {
    'use strict';

    var body, extrasBody, balance, groupsBox;
    var last = null;

    function init() {
        body = document.getElementById('consumersBody');
        extrasBody = document.getElementById('extrasBody');
        balance = document.getElementById('balanceTable');
        groupsBox = document.getElementById('groupsBox');

        document.getElementById('addConsumer').addEventListener('click', function () {
            var project = App.project;
            var name = Tables.norms()[0].name;

            project.consumers.push(Storage.consumer(Storage.id('c'), name,
                project.groups.length ? project.groups[0].id : '', name, 0, 0));

            render();
            App.run();
        });

        document.getElementById('addGroup').addEventListener('click', function () {
            App.project.groups.push({
                id: Storage.id('g'),
                name: 'Группа ' + (App.project.groups.length + 1)
            });

            render();
            App.run();
        });

        document.getElementById('addExtra').addEventListener('click', function () {
            App.project.extras.push(Storage.extra(Storage.id('e'), 'Полив территории'));
            render();
            App.run();
        });

        var fields = ['objectName', 'objectAddress', 'objectNote'];

        for (var i = 0; i < fields.length; i++) {
            (function (elementId, key) {
                document.getElementById(elementId).addEventListener('change', function (event) {
                    App.project.object[key] = event.target.value;
                    App.run();
                });
            })(fields[i], fields[i].replace('object', '').toLowerCase());
        }
    }

    /* --- ввод ------------------------------------------------------------ */

    function render() {
        renderGroups();
        renderConsumers();
        renderExtras();

        var project = App.project;
        document.getElementById('objectName').value = project.object.name;
        document.getElementById('objectAddress').value = project.object.address;
        document.getElementById('objectNote').value = project.object.note;
    }

    function renderGroups() {
        var groups = App.project.groups;
        var html = [];

        for (var i = 0; i < groups.length; i++) {
            html.push('<span class="chip" data-index="' + i + '">'
                + '<input type="text" value="' + Format.html(groups[i].name) + '" data-field="name">'
                + '<button class="small danger" data-action="remove" title="Удалить группу">×</button>'
                + '</span>');
        }

        groupsBox.innerHTML = html.join('');

        var inputs = groupsBox.querySelectorAll('input');
        for (var n = 0; n < inputs.length; n++) {
            inputs[n].addEventListener('change', function (event) {
                var index = parseInt(event.target.parentNode.getAttribute('data-index'), 10);
                App.project.groups[index].name = event.target.value;
                App.run();
            });
        }

        var buttons = groupsBox.querySelectorAll('button');
        for (var b = 0; b < buttons.length; b++) {
            buttons[b].addEventListener('click', function (event) {
                var index = parseInt(event.target.parentNode.getAttribute('data-index'), 10);
                var removed = App.project.groups[index];

                // Потребители удалённой группы не пропадают — они просто
                // остаются без группы и уходят в конец формы баланса.
                for (var c = 0; c < App.project.consumers.length; c++) {
                    if (App.project.consumers[c].group === removed.id) {
                        App.project.consumers[c].group = '';
                    }
                }

                App.project.groups.splice(index, 1);
                render();
                App.run();
            });
        }
    }

    function renderConsumers() {
        var project = App.project;
        var norms = Tables.norms();
        var html = [];

        for (var i = 0; i < project.consumers.length; i++) {
            var c = project.consumers[i];
            var norm = Tables.norm(c.norm) || norms[0];

            html.push('<tr data-index="' + i + '">');
            html.push('<td class="dim">' + (i + 1) + '</td>');

            html.push('<td class="left"><input type="text" data-field="name" value="'
                + Format.html(c.name) + '"></td>');

            html.push('<td class="left">' + select('group', groupOptions(c.group)) + '</td>');

            html.push('<td class="left">' + select('norm', normOptions(norms, c.norm)) + '</td>');

            html.push('<td class="left"><input type="text" data-field="reason" value="'
                + Format.html(c.reason) + '" placeholder="' + Format.html(defaultReason(norm))
                + '"></td>');

            html.push('<td><input type="text" data-field="process" value="'
                + Format.html(c.process) + '"></td>');

            html.push('<td><input type="number" min="0" step="1" data-field="hours" value="'
                + (c.hours > 0 ? c.hours : '') + '" placeholder="' + Format.num(norm.t, 0) + '"></td>');

            html.push('<td><input type="number" min="0" step="1" data-field="usersDay" value="'
                + c.usersDay + '"></td>');

            html.push('<td><input type="number" min="0" step="1" data-field="usersHour" value="'
                + (c.usersHour > 0 ? c.usersHour : '') + '" placeholder="'
                + c.usersDay + '"></td>');

            html.push('<td><input type="number" min="0" step="1" data-field="fixtures" value="'
                + (c.fixtures > 0 ? c.fixtures : '') + '" placeholder="как U"></td>');

            html.push('<td class="dim">' + Format.html(norm.unit) + '</td>');
            html.push('<td class="dim">' + Format.num(norm.qu, 0) + '</td>');
            html.push('<td class="dim">' + Format.num(norm.qhru) + '</td>');

            html.push('<td><input type="text" data-field="quality" value="'
                + Format.html(c.quality) + '"></td>');

            html.push('<td class="left">' + select('source',
                listOptions(Consumers.SOURCES, c.source)) + '</td>');

            html.push('<td class="left">' + select('drain',
                listOptions(Consumers.DRAINS, c.drain)) + '</td>');

            html.push('<td><input type="number" min="0" max="100" step="1" data-field="lossPercent" value="'
                + Format.plain(c.lossPercent) + '"></td>');

            html.push('<td><input type="number" min="0" step="0.1" data-field="q0Sewer" value="'
                + Format.plain(c.q0Sewer) + '"></td>');

            html.push('<td class="left"><input type="text" data-field="note" value="'
                + Format.html(c.note) + '"></td>');

            html.push('<td><button class="small danger" data-action="remove">×</button></td>');
            html.push('</tr>');
        }

        body.innerHTML = html.join('');
        bind(body, onConsumerChange, onConsumerRemove);
    }

    function renderExtras() {
        var extras = App.project.extras;
        var html = [];

        for (var i = 0; i < extras.length; i++) {
            var e = extras[i];

            html.push('<tr data-index="' + i + '">');
            html.push('<td class="left"><input type="text" data-field="name" value="'
                + Format.html(e.name) + '"></td>');
            html.push('<td class="left">' + select('group', groupOptions(e.group)) + '</td>');
            html.push('<td><input type="text" data-field="unit" value="'
                + Format.html(e.unit) + '"></td>');
            html.push('<td><input type="number" min="0" step="1" data-field="count" value="'
                + Format.plain(e.count) + '"></td>');
            html.push('<td><input type="number" min="0" step="0.1" data-field="rate" value="'
                + Format.plain(e.rate) + '"></td>');
            html.push('<td><input type="number" min="0" step="0.001" data-field="m3day" value="'
                + Format.plain(e.m3day) + '" placeholder="' + Format.num(Consumers.extraDay(e))
                + '"></td>');
            html.push('<td><input type="number" min="0" step="0.01" data-field="ls" value="'
                + Format.plain(e.ls) + '"></td>');
            html.push('<td><input type="checkbox" data-field="inBalance"'
                + (e.inBalance ? ' checked' : '') + '></td>');
            html.push('<td class="left"><input type="text" data-field="note" value="'
                + Format.html(e.note) + '"></td>');
            html.push('<td><button class="small danger" data-action="remove">×</button></td>');
            html.push('</tr>');
        }

        extrasBody.innerHTML = html.join('');
        bind(extrasBody, onExtraChange, onExtraRemove);
    }

    /* --- вспомогательное для разметки ------------------------------------ */

    function select(field, options) {
        return '<select data-field="' + field + '">' + options + '</select>';
    }

    function groupOptions(current) {
        var html = ['<option value=""' + (current ? '' : ' selected') + '>— без группы —</option>'];
        var groups = App.project.groups;

        for (var i = 0; i < groups.length; i++) {
            html.push('<option value="' + Format.html(groups[i].id) + '"'
                + (groups[i].id === current ? ' selected' : '') + '>'
                + Format.html(groups[i].name) + '</option>');
        }

        return html.join('');
    }

    function normOptions(norms, current) {
        var html = [];

        for (var i = 0; i < norms.length; i++) {
            html.push('<option value="' + Format.html(norms[i].name) + '"'
                + (norms[i].name === current ? ' selected' : '') + '>'
                + Format.html(norms[i].name) + '</option>');
        }

        return html.join('');
    }

    function listOptions(list, current) {
        var html = [];

        for (var i = 0; i < list.length; i++) {
            html.push('<option value="' + list[i].id + '"'
                + (list[i].id === current ? ' selected' : '') + '>'
                + Format.html(list[i].name) + '</option>');
        }

        return html.join('');
    }

    /*
        Обоснование по умолчанию. Номер пункта таблицы А.2 программа не знает —
        в перенесённых данных его нет, — поэтому подставляется ссылка на саму
        таблицу, а пункт инженер дописывает: «СП 30.13330.2020 табл. А.2 п.1.6».
    */
    function defaultReason(norm) {
        return 'СП 30.13330.2020 табл. А.2 — ' + norm.name;
    }

    function bind(container, onChange, onRemove) {
        var inputs = container.querySelectorAll('input, select');
        for (var i = 0; i < inputs.length; i++) inputs[i].addEventListener('change', onChange);

        var buttons = container.querySelectorAll('button[data-action="remove"]');
        for (var b = 0; b < buttons.length; b++) buttons[b].addEventListener('click', onRemove);
    }

    function rowIndex(element) {
        var row = element;
        while (row && row.tagName !== 'TR') row = row.parentNode;
        return row ? parseInt(row.getAttribute('data-index'), 10) : -1;
    }

    /* --- правки ---------------------------------------------------------- */

    var NUMBERS = ['hours', 'usersDay', 'usersHour', 'fixtures', 'fixturesHot',
        'lossPercent', 'q0Sewer', 'count', 'rate', 'm3day', 'ls'];

    var WHOLE = ['hours', 'usersDay', 'usersHour', 'fixtures', 'fixturesHot'];

    function apply(target, field, element) {
        if (element.type === 'checkbox') {
            target[field] = element.checked;
            return;
        }

        if (NUMBERS.indexOf(field) < 0) {
            target[field] = element.value;
            return;
        }

        var value = Math.max(0, Format.parse(element.value, 0));
        target[field] = WHOLE.indexOf(field) >= 0 ? Math.round(value) : value;
    }

    function onConsumerChange(event) {
        var index = rowIndex(event.target);
        if (index < 0) return;

        var field = event.target.getAttribute('data-field');
        var c = App.project.consumers[index];

        apply(c, field, event.target);

        // Норма меняет единицу измерения, часы и подсказку обоснования —
        // перерисовываем строку целиком, чтобы они не остались от прежней.
        if (field === 'norm') renderConsumers();

        App.run();
    }

    function onConsumerRemove(event) {
        var index = rowIndex(event.target);
        if (index < 0) return;

        var removed = App.project.consumers[index];

        // Ссылки на удалённого потребителя убираются из всех наборов: иначе
        // итог молча считался бы по призраку.
        for (var s = 0; s < App.project.sets.length; s++) {
            var members = App.project.sets[s].members;
            var at = members.indexOf(removed.id);
            if (at >= 0) members.splice(at, 1);
        }

        App.project.consumers.splice(index, 1);
        render();
        App.run();
    }

    function onExtraChange(event) {
        var index = rowIndex(event.target);
        if (index < 0) return;

        apply(App.project.extras[index], event.target.getAttribute('data-field'), event.target);
        renderExtras();
        App.run();
    }

    function onExtraRemove(event) {
        var index = rowIndex(event.target);
        if (index < 0) return;

        App.project.extras.splice(index, 1);
        render();
        App.run();
    }

    /* --- расчёт и баланс -------------------------------------------------- */

    function run(node) {
        var project = App.project;
        var results = {};

        for (var i = 0; i < project.consumers.length; i++) {
            var c = project.consumers[i];
            results[c.id] = Consumers.run(c, node);
        }

        last = { results: results };

        showBalance();
        return last;
    }

    /*
        Баланс водопотребления и водоотведения — форма из 19 колонок.

        Строки идут группами: заголовок группы, потребители, «Итог по группе»,
        и в конце «ИТОГО». Это раскладка формы, а не расчётные итоги: суточные
        объёмы складываются, и вероятность действия приборов к ним отношения не
        имеет.
    */
    function balanceRows() {
        var project = App.project;
        var rows = [];
        var i;

        var groups = project.groups.slice();
        groups.push({ id: '', name: 'Без группы' });

        var number = 0;
        var grand = blankSums();

        for (var g = 0; g < groups.length; g++) {
            var groupId = groups[g].id;
            var inGroup = [];

            for (i = 0; i < project.consumers.length; i++) {
                if (project.consumers[i].group === groupId) inGroup.push(project.consumers[i]);
            }

            var extras = [];
            for (i = 0; i < project.extras.length; i++) {
                if (project.extras[i].group === groupId && project.extras[i].inBalance) {
                    extras.push(project.extras[i]);
                }
            }

            if (inGroup.length === 0 && extras.length === 0) continue;

            rows.push({ kind: 'group', name: 'Группа «' + groups[g].name + '»' });

            var sums = blankSums();

            for (i = 0; i < inGroup.length; i++) {
                number++;
                var row = consumerRow(number, inGroup[i]);
                rows.push(row);
                addSums(sums, row);
                addSums(grand, row);
            }

            for (i = 0; i < extras.length; i++) {
                number++;
                var extraRow = extraLine(number, extras[i]);
                rows.push(extraRow);
                addSums(sums, extraRow);
                addSums(grand, extraRow);
            }

            rows.push(sumRow('Итог по группе «' + groups[g].name + '»', sums));
        }

        if (rows.length) rows.push(sumRow('ИТОГО', grand));

        return rows;
    }

    function blankSums() {
        return {
            units: 0, total: 0, loss: 0, drained: 0,
            source: { city: 0, well: 0, tech: 0, recycle: 0 },
            drain: { household: 0, clean: 0, mineral: 0, chemical: 0, storm: 0 }
        };
    }

    function consumerRow(number, c) {
        var norm = Tables.norm(c.norm);
        var result = last && last.results ? last.results[c.id] : null;
        var m3day = result && result.total ? result.total.qDay : 0;
        var b = Consumers.balance(c, m3day);

        return {
            kind: 'consumer',
            number: number,
            consumer: c,
            name: c.name,
            process: c.process,
            hours: c.hours > 0 ? c.hours : (norm ? norm.t : 0),
            units: c.usersDay,
            reason: c.reason || defaultReason(norm || { name: c.norm }),
            rate: norm ? norm.qu / 1000 : 0,
            quality: c.quality,
            total: m3day,
            source: b.source,
            loss: b.loss,
            drain: b.drain,
            drained: b.drained
        };
    }

    function extraLine(number, e) {
        var m3day = Consumers.extraDay(e);

        return {
            kind: 'extra',
            number: number,
            name: e.name,
            process: '',
            hours: 0,
            units: e.count,
            reason: e.note,
            rate: e.rate / 1000,
            quality: '',
            total: m3day,
            source: 'city',
            loss: m3day,   // полив уходит безвозвратно
            drain: 'household',
            drained: 0
        };
    }

    function addSums(sums, row) {
        sums.units += row.units;
        sums.total += row.total;
        sums.loss += row.loss;
        sums.drained += row.drained;

        if (sums.source[row.source] !== undefined) sums.source[row.source] += row.total;
        if (sums.drain[row.drain] !== undefined) sums.drain[row.drain] += row.drained;
    }

    function sumRow(name, sums) {
        return { kind: 'sum', name: name, sums: sums };
    }

    function showBalance() {
        var rows = balanceRows();

        if (rows.length === 0) {
            balance.innerHTML = '<p class="hint">Потребители не заданы.</p>';
            return;
        }

        var html = [];

        html.push('<div class="scroll"><table class="form">');
        html.push('<thead>');
        html.push('<tr>'
            + '<th rowspan="3">№ пот-<br>реби-<br>теля</th>'
            + '<th rowspan="3" class="left" style="min-width:240px">Наименование потребителя</th>'
            + '<th rowspan="3">Технологи-<br>ческий<br>процесс</th>'
            + '<th rowspan="3">Количество<br>часов<br>работы</th>'
            + '<th rowspan="3">Количество<br>единиц<br>оборудования</th>'
            + '<th colspan="3">Норма водопотребления</th>'
            + '<th rowspan="3">Общее<br>водопотреб-<br>ление, м³/сут</th>'
            + '<th colspan="4">Источники водоснабжения, м³/сут</th>'
            + '<th rowspan="3">Безвоз-<br>вратные<br>потери,<br>м³/сут</th>'
            + '<th colspan="5">Водоотведение, м³/сут</th>'
            + '</tr>');
        html.push('<tr>'
            + '<th rowspan="2">Обоснование</th>'
            + '<th rowspan="2">Расход на ед.<br>оборуд., м³/сут<br>наибольшего<br>водопотребления</th>'
            + '<th rowspan="2">Требуемое<br>качество<br>воды</th>'
            + '<th rowspan="2">Городской<br>водопровод</th>'
            + '<th rowspan="2">Артезианские<br>скважины</th>'
            + '<th rowspan="2">Технический<br>водопровод</th>'
            + '<th rowspan="2">Оборотно-<br>повторные<br>системы</th>'
            + '<th colspan="4">Городская канализация</th>'
            + '<th rowspan="2">Водосток</th>'
            + '</tr>');
        html.push('<tr>'
            + '<th>Хозяйственно-<br>бытовые</th>'
            + '<th>Нормативно<br>чистые</th>'
            + '<th>Загрязнённые<br>механич.<br>минерал.<br>примесями</th>'
            + '<th>Загрязнённые<br>химич. органич.<br>и проч.<br>примесями</th>'
            + '</tr>');
        html.push('<tr class="numbering">');
        for (var n = 1; n <= 19; n++) html.push('<th>' + n + '</th>');
        html.push('</tr>');
        html.push('</thead><tbody>');

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            if (row.kind === 'group') {
                html.push('<tr class="group"><td colspan="19" class="left">'
                    + Format.html(row.name) + '</td></tr>');
                continue;
            }

            if (row.kind === 'sum') {
                html.push('<tr class="total">');
                html.push('<td></td><td class="left">' + Format.html(row.name) + '</td>');
                html.push('<td></td><td></td>');
                html.push('<td>' + Format.num(row.sums.units, 0) + '</td>');
                html.push('<td></td><td></td><td></td>');
                html.push('<td>' + Format.num(row.sums.total) + '</td>');
                html.push(sourceCells(row.sums.source));
                html.push('<td>' + Format.num(row.sums.loss) + '</td>');
                html.push(drainCells(row.sums.drain));
                html.push('</tr>');
                continue;
            }

            html.push('<tr>');
            html.push('<td>' + row.number + '</td>');
            html.push('<td class="left">' + Format.html(row.name) + '</td>');
            html.push('<td>' + Format.html(row.process) + '</td>');
            html.push('<td>' + (row.hours > 0 ? Format.num(row.hours, 0) : '') + '</td>');
            html.push('<td>' + Format.num(row.units, 0) + '</td>');
            html.push('<td class="left small">' + Format.html(row.reason) + '</td>');
            html.push('<td>' + Format.num(row.rate) + '</td>');
            html.push('<td>' + Format.html(row.quality) + '</td>');
            html.push('<td><b>' + Format.num(row.total) + '</b></td>');
            html.push(sourceCells(single(row.source, row.total)));
            html.push('<td>' + (row.loss > 0 ? Format.num(row.loss) : '') + '</td>');
            html.push(drainCells(single(row.drain, row.drained)));
            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        balance.innerHTML = html.join('');
    }

    function single(key, value) {
        var one = {};
        one[key] = value;
        return one;
    }

    function sourceCells(values) {
        var html = [];

        for (var i = 0; i < Consumers.SOURCES.length; i++) {
            var v = values[Consumers.SOURCES[i].id];
            html.push('<td>' + (v > 0 ? Format.num(v) : '') + '</td>');
        }

        return html.join('');
    }

    function drainCells(values) {
        var html = [];

        for (var i = 0; i < Consumers.DRAINS.length; i++) {
            var v = values[Consumers.DRAINS[i].id];
            html.push('<td>' + (v > 0 ? Format.num(v) : '') + '</td>');
        }

        return html.join('');
    }

    function results() {
        return last;
    }

    return {
        init: init,
        render: render,
        run: run,
        results: results,
        balanceRows: balanceRows,
        defaultReason: defaultReason
    };
})();
