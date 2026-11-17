/*
    Вкладка «Итоги и зоны»: произвольные своды по потребителям.

    Матрица «потребитель × набор» с галочками — не украшение, а единственный
    способ увидеть сразу, куда потребитель входит. Списком внутри каждого
    набора этого не видно: чтобы понять, учтено ли жильё в «1 зоне», пришлось
    бы открывать «1 зону» и искать его там глазами, а строка матрицы отвечает
    на этот вопрос без единого щелчка.

    Наборы вкладываются друг в друга: «ИТОГО ПО ОБЪЕКТУ» собирается из «Итого
    по жилым» и «Итого по встроенным», а не перечисляет потребителей заново.
    Добавили секцию в жилую часть — она сама попала в объектный итог.

    Свод считается по формулам (1) и (4), а не сложением: секундный расход двух
    секций 4,656 и 1,610 л/с даёт вместе 5,222 л/с, а не 6,266.
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

        for (var i = 0; i < sets.length; i++) {
            html.push('<span class="chip" data-index="' + i + '">'
                + '<input type="text" value="' + Format.html(sets[i].name) + '" style="width:15em">'
                + '<button class="small" data-action="up" title="Выше"'
                + (i === 0 ? ' disabled' : '') + '>↑</button>'
                + '<button class="small danger" data-action="remove" title="Удалить итог">×</button>'
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
        var action = event.target.getAttribute('data-action');
        var sets = App.project.sets;

        if (action === 'up' && index > 0) {
            var moved = sets[index];
            sets[index] = sets[index - 1];
            sets[index - 1] = moved;
        } else if (action === 'remove') {
            var removed = sets[index];

            // Удаляемый набор вычёркивается из тех, куда он вложен: иначе
            // объектный итог продолжил бы ссылаться на пустоту.
            for (var s = 0; s < sets.length; s++) {
                var at = sets[s].sets.indexOf(removed.id);
                if (at >= 0) sets[s].sets.splice(at, 1);
            }

            sets.splice(index, 1);
        }

        render();
        App.run();
    }

    function renderMatrix() {
        var project = App.project;
        var html = [];

        if (project.sets.length === 0 || project.consumers.length === 0) {
            matrixBox.innerHTML = '<p class="hint">Нужны хотя бы один потребитель и один итог.</p>';
            return;
        }

        html.push('<div class="scroll"><table>');
        html.push('<thead><tr><th class="left" style="min-width:260px">Потребитель</th>');
        html.push('<th>Группа</th>');

        for (var s = 0; s < project.sets.length; s++) {
            html.push('<th class="vertical">' + Format.html(project.sets[s].name) + '</th>');
        }

        html.push('</tr></thead><tbody>');

        for (var c = 0; c < project.consumers.length; c++) {
            var consumer = project.consumers[c];
            var group = Consumers.byId(project.groups, consumer.group);

            html.push('<tr>');
            html.push('<td class="left">' + Format.html(consumer.name) + '</td>');
            html.push('<td class="dim">' + Format.html(group ? group.name : '—') + '</td>');

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
            nestingBox.innerHTML = '<p class="hint">Вложенность появляется, когда итогов больше одного.</p>';
            return;
        }

        var html = [];

        html.push('<div class="scroll"><table>');
        html.push('<thead><tr><th class="left" style="min-width:260px">Итог</th>');

        for (var s = 0; s < sets.length; s++) {
            html.push('<th class="vertical">включает<br>' + Format.html(sets[s].name) + '</th>');
        }

        html.push('</tr></thead><tbody>');

        for (var i = 0; i < sets.length; i++) {
            html.push('<tr><td class="left">' + Format.html(sets[i].name) + '</td>');

            for (s = 0; s < sets.length; s++) {
                if (i === s) {
                    html.push('<td class="dim">—</td>');
                    continue;
                }

                /*
                    Кольцо запрещается на входе, а не при расчёте: если «жильё»
                    уже включает «объект», то «объект» включить «жильё» нельзя,
                    и клетка гасится. Разворачивание состава кольцо и так
                    переживёт, но пользователю важнее не создать его вовсе.
                */
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

        last = { totals: totals };

        show();
        return last;
    }

    /*
        Таблица «Основные показатели по системе водоснабжения и водоотведения».

        Один потребитель — четыре строки: В1, Т3, В1 общ., К1. Так эта таблица
        и выглядит в записке, и переносить её оттуда обратно в наш вид пришлось
        бы руками.
    */
    function show() {
        var project = App.project;
        var perConsumer = UiConsumers.results();

        if (!last || (project.consumers.length === 0 && project.extras.length === 0)) {
            resultBox.innerHTML = '<p class="hint">Потребители не заданы.</p>';
            return;
        }

        var html = [];

        html.push('<div class="scroll"><table class="form">');
        html.push('<thead>');
        html.push('<tr>'
            + '<th rowspan="2" class="left" style="min-width:280px">Наименование потребителя<br>(единицы измерения)</th>'
            + '<th rowspan="2">Кол-во потре-<br>бителей сут.</th>'
            + '<th rowspan="2">Норма водо-<br>потреб-<br>ления, л/сут</th>'
            + '<th colspan="3">Расчётный расход</th>'
            + '<th rowspan="2" class="left" style="min-width:140px">Примечание</th>'
            + '</tr>');
        html.push('<tr><th>м³/сут</th><th>м³/час</th><th>л/с</th></tr>');
        html.push('</thead><tbody>');

        var groups = project.groups.slice();
        groups.push({ id: '', name: 'Без группы' });

        var g, i;

        for (g = 0; g < groups.length; g++) {
            var inGroup = [];

            for (i = 0; i < project.consumers.length; i++) {
                if (project.consumers[i].group === groups[g].id) inGroup.push(project.consumers[i]);
            }

            if (inGroup.length === 0) continue;

            html.push('<tr class="group"><td colspan="7" class="left">'
                + Format.html(groups[g].name) + '</td></tr>');

            for (i = 0; i < inGroup.length; i++) {
                var consumer = inGroup[i];
                var result = perConsumer ? perConsumer.results[consumer.id] : null;

                block(html, consumer.name, counts(consumer), result, consumer.note, '');
            }
        }

        // Прочие расходы — полив и пожаротушение, заданные напрямую.
        if (project.extras.length) {
            html.push('<tr class="group"><td colspan="7" class="left">Прочие расходы</td></tr>');

            for (i = 0; i < project.extras.length; i++) {
                var e = project.extras[i];

                html.push('<tr>');
                html.push('<td class="left">' + Format.html(e.name) + '</td>');
                html.push('<td>' + (e.count > 0 ? Format.num(e.count, 0) + ' ' + Format.html(e.unit) : '') + '</td>');
                html.push('<td>' + (e.rate > 0 ? Format.num(e.rate) : '') + '</td>');
                html.push('<td>' + Format.num(Consumers.extraDay(e)) + '</td>');
                html.push('<td></td>');
                html.push('<td>' + (e.ls > 0 ? Format.num(e.ls) : '') + '</td>');
                html.push('<td class="left small">' + Format.html(e.note) + '</td>');
                html.push('</tr>');
            }
        }

        // Итоги — своды по наборам.
        for (i = 0; i < last.totals.length; i++) {
            var total = last.totals[i];
            if (!total.result) continue;

            block(html, total.set.name + ':', pair(total.result.group), total.result,
                'потребителей: ' + total.consumers.length, ' class="total"');
        }

        html.push('</tbody></table></div>');

        resultBox.innerHTML = html.join('');
    }

    /*
        Количество потребителей: «291/620», когда суточное и часовое разные, и
        одно число, когда они совпадают. Дробь при равных числах читалась бы как
        ошибка ввода.
    */
    function counts(consumer) {
        var hour = consumer.usersHour > 0 ? consumer.usersHour : consumer.usersDay;
        return consumer.usersDay === hour
            ? String(consumer.usersDay)
            : consumer.usersDay + '/' + hour;
    }

    function pair(group) {
        return group.usersDay === group.users
            ? String(group.usersDay)
            : group.usersDay + '/' + group.users;
    }

    /*
        Четыре строки одного потребителя или итога.

        Заголовочная строка несёт имя и количество, дальше идут системы. Так
        сделано в форме: колонка «Наименование» в строках систем занята самой
        системой, и повторять там имя незачем.
    */
    function block(html, name, users, result, note, css) {
        html.push('<tr' + css + '>');
        html.push('<td class="left"><b>' + Format.html(name) + '</b></td>');
        html.push('<td>' + Format.html(users) + '</td>');
        html.push('<td colspan="4"></td>');
        html.push('<td class="left small">' + Format.html(note) + '</td>');
        html.push('</tr>');

        if (!result) {
            html.push('<tr' + css + '><td colspan="7" class="left dim">'
                + 'Расход не считается: не заданы норма или количество.</td></tr>');
            return;
        }

        var norm = result.group && result.group.norm ? result.group.norm : null;

        var systems = [
            ['В1', result.cold, norm ? norm.quc : 0],
            ['Т3', result.hot, norm ? norm.quh : 0],
            ['В1 общ.', result.total, norm ? norm.qu : 0]
        ];

        for (var i = 0; i < systems.length; i++) {
            var flow = systems[i][1];
            if (!flow) continue;

            html.push('<tr' + css + '>');
            html.push('<td class="left indent">' + systems[i][0] + '</td>');
            html.push('<td></td>');
            html.push('<td>' + (systems[i][2] > 0 ? Format.num(systems[i][2], 0) : '') + '</td>');
            html.push('<td>' + Format.num(flow.qDay, 3) + '</td>');
            html.push('<td>' + Format.num(flow.qhr, 3) + '</td>');
            html.push('<td><b>' + Format.num(flow.q, 3) + '</b></td>');
            html.push('<td></td>');
            html.push('</tr>');
        }

        html.push('<tr' + css + '>');
        html.push('<td class="left indent">К1</td>');
        html.push('<td></td>');
        html.push('<td>' + (norm && norm.qu > 0 ? Format.num(norm.qu, 0) : '') + '</td>');
        html.push('<td>' + Format.num(result.sewerDay, 3) + '</td>');
        html.push('<td>' + Format.num(result.total ? result.total.qhr : 0, 3) + '</td>');
        html.push('<td><b>' + Format.num(result.sewer, 3) + '</b></td>');
        html.push('<td class="left small">формула (5)</td>');
        html.push('</tr>');
    }

    function results() {
        return last;
    }

    return {
        init: init,
        render: render,
        run: run,
        results: results
    };
})();
