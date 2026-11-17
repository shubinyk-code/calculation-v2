/*
    Вкладка «Итоги»: полная сводная таблица по всему дереву плюс необязательные
    ручные «Итоги» — для выборок, которые не укладываются в структуру папок
    (например, зона, собранная из кусков двух разных корпусов).

    Первый, автоматический итог — «ИТОГО ПО ОБЪЕКТУ»: свод по формулам (1) и
    (4) СП 30 сразу по всем потребителям проекта, без единой галочки. Он же —
    главный итог программы: по нему подтягивается нагрузка на ГВС в шапке и он
    же обычно уходит в технические условия.

    Матрица «потребитель × итог» с галочками остаётся такой же, как была —
    только колонка «Папка» вместо плоской «Группа» показывает путь по дереву.
*/

var UiTotals = (function () {
    'use strict';

    var setsBox, matrixBox, nestingBox, resultBox;
    var last = null;

    function init() {
        setsBox = document.getElementById('setsBox');
        matrixBox = document.getElementById('matrixBox');
        nestingBox = document.getElementById('nestingBox');
        resultBox = document.getElementById('totalsResult');

        document.getElementById('addSet').addEventListener('click', function () {
            App.project.sets.push({
                id: Storage.id('s'),
                name: 'Итого по ' + (App.project.sets.length + 1),
                members: [],
                sets: []
            });

            render();
            App.run();
        });
    }

    /* --- ввод ------------------------------------------------------------ */

    function render() {
        renderSets();
        renderMatrix();
        renderNesting();
    }

    function renderSets() {
        var sets = App.project.sets;
        var html = [];

        if (sets.length === 0) {
            html.push('<p class="hint">Пока ни одного ручного итога — «ИТОГО ПО ОБЪЕКТУ» '
                + 'ниже уже считается сам, по всему дереву папок. Ручной итог нужен только '
                + 'для выборки, которая не укладывается в папки.</p>');
        }

        for (var i = 0; i < sets.length; i++) {
            html.push('<span class="chip" data-index="' + i + '">'
                + '<input type="text" value="' + Format.html(sets[i].name) + '" style="width:15em">'
                + '<button class="mini danger" data-action="remove" title="Удалить итог">×</button>'
                + '</span>');
        }

        setsBox.innerHTML = html.join('');

        var inputs = setsBox.querySelectorAll('input');
        for (var n = 0; n < inputs.length; n++) {
            inputs[n].addEventListener('change', function (event) {
                var index = parseInt(event.target.parentNode.getAttribute('data-index'), 10);
                App.project.sets[index].name = event.target.value;
                render();
                App.run();
            });
        }

        var buttons = setsBox.querySelectorAll('button');
        for (var b = 0; b < buttons.length; b++) {
            buttons[b].addEventListener('click', onSetButton);
        }
    }

    function onSetButton(event) {
        var index = parseInt(event.target.parentNode.getAttribute('data-index'), 10);
        var sets = App.project.sets;
        var removed = sets[index];

        // Удаляемый набор вычёркивается из тех, куда он вложен: иначе
        // объектный итог продолжил бы ссылаться на пустоту.
        for (var s = 0; s < sets.length; s++) {
            var at = sets[s].sets.indexOf(removed.id);
            if (at >= 0) sets[s].sets.splice(at, 1);
        }

        sets.splice(index, 1);

        render();
        App.run();
    }

    function renderMatrix() {
        var project = App.project;
        var html = [];

        if (project.sets.length === 0 || project.consumers.length === 0) {
            matrixBox.innerHTML = '<p class="hint">Нужны хотя бы один потребитель и один ручной итог.</p>';
            return;
        }

        html.push('<div class="scroll"><table class="grid">');
        html.push('<thead><tr><th class="l" style="min-width:260px">Потребитель</th>');
        html.push('<th class="l">Папка</th>');

        for (var s = 0; s < project.sets.length; s++) {
            html.push('<th class="vertical">' + Format.html(project.sets[s].name) + '</th>');
        }

        html.push('</tr></thead><tbody>');

        for (var c = 0; c < project.consumers.length; c++) {
            var consumer = project.consumers[c];

            html.push('<tr>');
            html.push('<td class="l">' + Format.html(consumer.name) + '</td>');
            html.push('<td class="l dim">' + Format.html(Consumers.path(consumer.group, project) || '—') + '</td>');

            for (s = 0; s < project.sets.length; s++) {
                var direct = project.sets[s].members.indexOf(consumer.id) >= 0;

                /*
                    Потребитель может попадать в набор и через вложенный набор.
                    Такая галочка показывается серой и не снимается здесь: снять
                    её надо там, где он выбран прямо, иначе щелчок обманывал бы.
                */
                var through = !direct && inherited(project.sets[s], consumer.id, project);

                html.push('<td>' + (through
                    ? '<span class="through" title="Через вложенный итог">•</span>'
                    : '<input type="checkbox" data-set="' + s + '" data-consumer="'
                        + Format.html(consumer.id) + '"' + (direct ? ' checked' : '') + '>')
                    + '</td>');
            }

            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        matrixBox.innerHTML = html.join('');

        var boxes = matrixBox.querySelectorAll('input[type="checkbox"]');
        for (var i = 0; i < boxes.length; i++) boxes[i].addEventListener('change', onMemberToggle);
    }

    function inherited(set, consumerId, project) {
        var all = Consumers.expand(set, project);

        for (var i = 0; i < all.length; i++) {
            if (all[i].id === consumerId) return true;
        }

        return false;
    }

    function onMemberToggle(event) {
        var setIndex = parseInt(event.target.getAttribute('data-set'), 10);
        var consumerId = event.target.getAttribute('data-consumer');
        var members = App.project.sets[setIndex].members;
        var at = members.indexOf(consumerId);

        if (event.target.checked && at < 0) members.push(consumerId);
        else if (!event.target.checked && at >= 0) members.splice(at, 1);

        renderMatrix();
        App.run();
    }

    function renderNesting() {
        var sets = App.project.sets;

        if (sets.length < 2) {
            nestingBox.innerHTML = '<p class="hint">Вложенность ручных итогов появляется, когда их больше одного.</p>';
            return;
        }

        var html = [];

        html.push('<div class="scroll"><table class="grid">');
        html.push('<thead><tr><th class="l" style="min-width:260px">Итог</th>');

        for (var s = 0; s < sets.length; s++) {
            html.push('<th class="vertical">включает<br>' + Format.html(sets[s].name) + '</th>');
        }

        html.push('</tr></thead><tbody>');

        for (var i = 0; i < sets.length; i++) {
            html.push('<tr><td class="l">' + Format.html(sets[i].name) + '</td>');

            for (s = 0; s < sets.length; s++) {
                if (i === s) {
                    html.push('<td class="dim">—</td>');
                    continue;
                }

                var loops = wouldLoop(sets[i], sets[s], App.project);
                var on = sets[i].sets.indexOf(sets[s].id) >= 0;

                html.push('<td>' + (loops && !on
                    ? '<span class="dim" title="Получилось бы кольцо">×</span>'
                    : '<input type="checkbox" data-outer="' + i + '" data-inner="'
                        + Format.html(sets[s].id) + '"' + (on ? ' checked' : '') + '>')
                    + '</td>');
            }

            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        nestingBox.innerHTML = html.join('');

        var boxes = nestingBox.querySelectorAll('input[type="checkbox"]');
        for (var b = 0; b < boxes.length; b++) boxes[b].addEventListener('change', onNestToggle);
    }

    /* Включение inner в outer создаст кольцо, если inner уже содержит outer. */
    function wouldLoop(outer, inner, project) {
        var stack = [inner];
        var seen = {};

        while (stack.length) {
            var current = stack.pop();
            if (!current || seen[current.id]) continue;
            seen[current.id] = true;

            if (current.id === outer.id) return true;

            for (var i = 0; i < current.sets.length; i++) {
                stack.push(Consumers.byId(project.sets, current.sets[i]));
            }
        }

        return false;
    }

    function onNestToggle(event) {
        var outer = App.project.sets[parseInt(event.target.getAttribute('data-outer'), 10)];
        var innerId = event.target.getAttribute('data-inner');
        var at = outer.sets.indexOf(innerId);

        if (event.target.checked && at < 0) outer.sets.push(innerId);
        else if (!event.target.checked && at >= 0) outer.sets.splice(at, 1);

        render();
        App.run();
    }

    /* --- расчёт ---------------------------------------------------------- */

    /*
        Автоматический «ИТОГО ПО ОБЪЕКТУ» — свод по всем потребителям проекта,
        без единой галочки. Кладётся ПОСЛЕДНИМ в списке итогов: так App.js
        подбирает «главный» итог для нагрузки на ГВС и статуса в шапке — тем же
        способом, что и раньше, только теперь последний итог гарантированно
        есть всегда, а не зависит от порядка, в котором их завели руками.
    */
    var GRAND_ID = '__all__';

    function run(node) {
        var project = App.project;
        var totals = [];

        for (var i = 0; i < project.sets.length; i++) {
            var result = Consumers.runSet(project.sets[i], project, node);

            totals.push({
                set: project.sets[i],
                result: result,
                consumers: result ? result.consumers : []
            });
        }

        if (project.consumers.length) {
            var grand = Consumers.combine('ИТОГО ПО ОБЪЕКТУ', project.consumers, node);

            totals.push({
                set: { id: GRAND_ID, name: 'ИТОГО ПО ОБЪЕКТУ', members: [], sets: [] },
                result: grand,
                consumers: project.consumers
            });
        }

        last = { totals: totals };

        show();
        return last;
    }

    function show() {
        var project = App.project;

        if (project.consumers.length === 0 && project.extras.length === 0) {
            resultBox.innerHTML = '<p class="hint">Потребители не заданы.</p>';
            return;
        }

        var node = project.alphaMode === 'node';
        var built = Consumers.mainRows(project, node);

        var html = [];

        html.push('<div class="scroll"><table class="grid form">');
        html.push('<thead>');
        html.push('<tr>'
            + '<th rowspan="2" class="l" style="min-width:280px">Наименование потребителя<br>(единицы измерения)</th>'
            + '<th rowspan="2">Кол-во потре-<br>бителей сут.</th>'
            + '<th rowspan="2">Норма водо-<br>потреб-<br>ления, л/сут</th>'
            + '<th colspan="3">Расчётный расход</th>'
            + '<th rowspan="2" class="l" style="min-width:140px">Примечание</th>'
            + '</tr>');
        html.push('<tr><th>м³/сут</th><th>м³/час</th><th>л/с</th></tr>');
        html.push('</thead><tbody>');

        var boldSet = {};
        for (var i = 0; i < built.bold.length; i++) boldSet[built.bold[i]] = true;

        for (i = 0; i < built.rows.length; i++) {
            var row = built.rows[i];
            var css = boldSet[i]
                ? ' class="group"'
                : (built.total !== undefined && i >= built.total ? ' class="total"' : '');

            html.push('<tr' + css + '>');
            html.push('<td class="l">' + (boldSet[i] ? '<b>' + Format.html(row[0]) + '</b>' : Format.html(row[0])) + '</td>');
            html.push('<td>' + Format.html(row[1]) + '</td>');
            html.push('<td>' + (row[2] !== '' && row[2] !== undefined ? Format.num(row[2], 0) : '') + '</td>');
            html.push('<td>' + (row[3] !== '' && row[3] !== undefined ? Format.num(row[3], 3) : '') + '</td>');
            html.push('<td>' + (row[4] !== '' && row[4] !== undefined ? Format.num(row[4], 3) : '') + '</td>');
            html.push('<td>' + (row[5] !== '' && row[5] !== undefined ? '<b>' + Format.num(row[5], 3) + '</b>' : '') + '</td>');
            html.push('<td class="l small">' + Format.html(row[6]) + '</td>');
            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        resultBox.innerHTML = html.join('');
    }

    function results() {
        return last;
    }

    return {
        init: init,
        render: render,
        run: run,
        results: results,
        GRAND_ID: GRAND_ID
    };
})();
