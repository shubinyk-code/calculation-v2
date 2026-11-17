/*
    Каркас: проект, вкладки, пересчёт, сохранение.

    Кнопка «Расчёт» в шапке есть, но нажимать её не обязательно: любая правка
    исходных данных пересчитывает всё сразу. Расчёт здесь занимает миллисекунды,
    и держать инженера в неведении «а что будет, если» незачем.
*/

var App = (function () {
    'use strict';

    var project = Storage.blank();
    var status;
    var traceTarget = '';

    function init() {
        status = document.getElementById('status');

        var saved = Storage.recall();
        if (saved) project = saved;
        var hadSaved = !!saved;

        // Проектные нормы кладутся поверх таблицы А.2 до первой отрисовки:
        // иначе списки потребителей соберутся без них.
        Tables.setCustom(project.norms);

        UiTree.init();
        UiTotals.init();
        UiRiser.init();
        UiBranch.init();
        UiHyd.init();

        tabs();
        topbar();

        render();
        run();

        // библиотека объектов: текущий проект становится рабочей копией открытого объекта
        UiLibrary.init();
        Library.boot(project, hadSaved).then(function (res) {
            if (res.opened) load(res.project);
            UiLibrary.chip();
        }, function () { UiLibrary.unavailable(); });
    }

    /* Открыть проект: подставить, перерисовать, пересчитать. */
    function load(data, message) {
        project = data;
        traceTarget = '';
        Tables.setCustom(project.norms);
        render();
        run();
        if (message) say(message, 'done');
    }

    /* Название проекта изменено снаружи (библиотека): поле шапки и сам проект. */
    function syncName(name) {
        project.name = name;
        document.getElementById('projectName').value = name;
    }

    function render() {
        document.getElementById('projectName').value = project.name;
        document.getElementById('alphaMode').value = project.alphaMode;
        document.getElementById('hotT').value = project.heat.hotT;
        document.getElementById('coldT').value = project.heat.coldT;
        document.getElementById('heatLoss').value = project.heat.losses;

        UiTree.render();
        UiTotals.render();
        UiRiser.render();
        UiBranch.render();
        UiHyd.render();
    }

    /*
        Пересчёт целиком: потребители, итоги, стояк, разбор.

        Раздельного пересчёта нет намеренно. Норма таблицы А.2 у стояка и у
        потребителя — одна и та же строка норматива, и показать их
        расходящимися нельзя.
    */
    function run() {
        var node = project.alphaMode === 'node';

        UiTree.run(node);
        var totals = UiTotals.run(node);
        var riser = UiRiser.run(node);
        UiHyd.run(node);

        heat(totals);
        traceChoices(totals);

        Storage.remember(project);
        if (window.Library) Library.touch(project);

        var parts = [];
        var main = mainTotal(totals);

        if (main && main.result && main.result.total.q > 0) {
            parts.push(main.set.name + ': ' + Format.num(main.result.total.q) + ' л/с');
        }

        if (riser && riser.base) {
            parts.push('стояк ' + Format.num(riser.base.qs) + ' л/с — '
                + (riser.capacity > 0
                    ? (riser.passes ? 'проходит' : 'НЕ проходит')
                    : 'нет строки в таблице К'));
        }

        var failed = riser && riser.base && riser.capacity > 0 && !riser.passes;
        say(parts.join(', '), failed ? 'fail' : 'done');
    }

    /*
        Главный итог — последний в списке. UiTotals.run() всегда кладёт туда
        автоматическое «ИТОГО ПО ОБЪЕКТУ», так что главный итог есть всегда,
        даже если ни одного ручного «Итога» в проекте не заведено.
    */
    function mainTotal(totals) {
        if (!totals || !totals.totals.length) return null;

        for (var i = totals.totals.length - 1; i >= 0; i--) {
            if (totals.totals[i].result) return totals.totals[i];
        }

        return null;
    }

    function say(text, kind) {
        status.textContent = text;
        status.className = 'status' + (kind ? ' ' + kind : '');
    }

    /* --- нагрузка на ГВС -------------------------------------------------- */

    /*
        Нагрузка считается по выбранному итогу, а не по всему подряд: у объекта
        с двумя вводами и двумя ИТП их две, и общая цифра там не нужна никому.
    */
    function heat(totals) {
        var select = document.getElementById('heatSet');
        var target = document.getElementById('heatResult');

        if (!totals || !totals.totals.length) {
            select.innerHTML = '';
            target.innerHTML = '<p class="hint">Итоги не заданы.</p>';
            return;
        }

        var html = [];
        var chosen = project.heat.set || '';

        for (var i = 0; i < totals.totals.length; i++) {
            var set = totals.totals[i].set;
            html.push('<option value="' + Format.html(set.id) + '"'
                + (set.id === chosen ? ' selected' : '') + '>'
                + Format.html(set.name) + '</option>');
        }

        select.innerHTML = html.join('');

        var picked = null;

        for (i = 0; i < totals.totals.length; i++) {
            if (totals.totals[i].set.id === chosen) picked = totals.totals[i];
        }

        if (!picked) picked = mainTotal(totals);
        if (picked) select.value = picked.set.id;

        if (!picked || !picked.result || !picked.result.hot || !(picked.result.hot.qhr > 0)) {
            target.innerHTML = '<p class="hint">Горячей воды у выбранных потребителей нет.</p>';
            return;
        }

        var hot = picked.result.hot;
        var settings = project.heat;

        var max = Demand.heat(hot.qhr, settings.hotT, settings.coldT, settings.losses);
        var average = Demand.heat(hot.qAvgHour, settings.hotT, settings.coldT, settings.losses);

        html = [];
        html.push('<div class="scroll"><table class="grid"><tbody>');
        html.push(pair('Итог, по которому считается нагрузка', Format.html(picked.set.name)));
        html.push(pair('Q_hr — в час наибольшего водопотребления, формула (13)',
            '<b>' + Format.num(max) + ' кВт</b>'));
        html.push(pair('Q_T — в средний час, формула (12)', Format.num(average) + ' кВт'));
        html.push(pair('Расход горячей воды q_hr^h', Format.num(hot.qhr) + ' м³/ч'));
        html.push(pair('Разность температур t_г − t_х',
            Format.num(settings.hotT - settings.coldT) + ' °C'));
        html.push('</tbody></table></div>');

        if (!(settings.losses > 0)) {
            html.push('<p class="hint">Потери теплоты в подающих и циркуляционных '
                + 'трубопроводах приняты нулевыми: их даёт тепловой расчёт системы ГВС, '
                + 'здесь они не считаются.</p>');
        }

        target.innerHTML = html.join('');
    }

    function pair(name, value) {
        return '<tr><td class="l">' + name + '</td><td>' + value + '</td></tr>';
    }

    /* --- разбор ---------------------------------------------------------- */

    /*
        Разбор показывается по одному выбранному итогу или потребителю: вывести
        все сразу значило бы получить простыню на сотню формул, в которой не
        найти нужную.
    */
    function traceChoices(totals) {
        var select = document.getElementById('traceTarget');
        var html = [];
        var i;

        if (totals) {
            for (i = 0; i < totals.totals.length; i++) {
                html.push('<option value="set:' + Format.html(totals.totals[i].set.id) + '">Итог: '
                    + Format.html(totals.totals[i].set.name) + '</option>');
            }
        }

        for (i = 0; i < project.consumers.length; i++) {
            html.push('<option value="consumer:' + Format.html(project.consumers[i].id)
                + '">Потребитель: ' + Format.html(project.consumers[i].name) + '</option>');
        }

        select.innerHTML = html.join('');

        if (!traceTarget && html.length) {
            var main = mainTotal(totals);
            traceTarget = main ? 'set:' + main.set.id : select.options[0].value;
        }

        var exists = false;
        for (i = 0; i < select.options.length; i++) {
            if (select.options[i].value === traceTarget) exists = true;
        }

        if (!exists && select.options.length) traceTarget = select.options[0].value;
        select.value = traceTarget;

        showTrace('traceWater', traceFor(totals));
        showTrace('traceRiser', UiRiser.trace());
    }

    function traceFor(totals) {
        if (!traceTarget) return null;

        var kind = traceTarget.substring(0, traceTarget.indexOf(':'));
        var id = traceTarget.substring(traceTarget.indexOf(':') + 1);
        var i;

        if (kind === 'set' && totals) {
            for (i = 0; i < totals.totals.length; i++) {
                if (totals.totals[i].set.id === id && totals.totals[i].result) {
                    return totals.totals[i].result.trace;
                }
            }
            return null;
        }

        var results = UiTree.results();
        if (!results) return null;

        var result = results.results[id];
        return result ? result.trace : null;
    }

    function showTrace(id, trace) {
        var target = document.getElementById(id);

        if (!trace || trace.lines.length === 0) {
            target.innerHTML = '<span class="t-note">Расчёт не выполнен.</span>';
            return;
        }

        var html = [];

        for (var i = 0; i < trace.lines.length; i++) {
            var line = trace.lines[i];

            if (line.kind === 'section') {
                html.push('<span class="t-section">' + Format.html(line.text) + '</span>');
            } else if (line.kind === 'note') {
                html.push('<span class="t-note">' + Format.html(line.text) + '</span>');
            } else if (line.kind === 'formula') {
                html.push('<span class="t-formula"><span class="t-name">'
                    + Format.html(line.name) + '</span> = ' + Format.html(line.form)
                    + (line.substitution ? ' = ' + Format.html(line.substitution) : '')
                    + ' = <span class="t-value">' + Format.num(line.value) + '</span>'
                    + (line.unit ? ' ' + Format.html(line.unit) : '') + '</span>');
            } else if (line.kind === 'table') {
                html.push('<span class="t-formula"><span class="t-name">'
                    + Format.html(line.name) + '</span> = <span class="t-value">'
                    + Format.num(line.value) + '</span> <span class="t-table">— по таблице '
                    + Format.html(line.table) + ' при ' + Format.html(line.argument)
                    + (line.node ? ', по ближайшему большему узлу' : ', интерполяция')
                    + '</span></span>');
            }
        }

        target.innerHTML = html.join('');
    }

    /* --- вкладки --------------------------------------------------------- */

    var SECTIONS = ['consumers', 'totals', 'riser', 'branch', 'hyd', 'trace', 'ref'];

    function tabs() {
        var buttons = document.querySelectorAll('.tabs-nav button');

        for (var i = 0; i < buttons.length; i++) {
            buttons[i].addEventListener('click', function (event) {
                var name = event.target.getAttribute('data-tab');

                for (var k = 0; k < buttons.length; k++) {
                    buttons[k].classList.toggle('on',
                        buttons[k].getAttribute('data-tab') === name);
                }

                for (var s = 0; s < SECTIONS.length; s++) {
                    document.getElementById('tab-' + SECTIONS[s])
                        .classList.toggle('active', SECTIONS[s] === name);
                }

                // Справочник строится при первом показе: три сотни строк разметки
                // при запуске программы никому не нужны.
                if (name === 'ref') UiRef.build();
                if (name === 'hyd') UiHyd.onShow();
            });
        }
    }

    /* --- шапка ----------------------------------------------------------- */

    function topbar() {
        document.getElementById('projectName').addEventListener('change', function (event) {
            project.name = event.target.value;
            Storage.remember(project);
            if (window.Library) Library.touch(project);
        });

        document.getElementById('alphaMode').addEventListener('change', function (event) {
            project.alphaMode = event.target.value;
            run();
        });

        document.getElementById('traceTarget').addEventListener('change', function (event) {
            traceTarget = event.target.value;
            run();
        });

        document.getElementById('heatSet').addEventListener('change', function (event) {
            project.heat.set = event.target.value;
            run();
        });

        var heatFields = [['hotT', 'hotT'], ['coldT', 'coldT'], ['heatLoss', 'losses']];

        for (var i = 0; i < heatFields.length; i++) {
            (function (elementId, field) {
                document.getElementById(elementId).addEventListener('change', function (event) {
                    project.heat[field] = Format.parse(event.target.value, project.heat[field]);
                    run();
                });
            })(heatFields[i][0], heatFields[i][1]);
        }

        document.getElementById('run').addEventListener('click', run);
        document.getElementById('printBtn').addEventListener('click', function () { window.print(); });

        /*
            Выгрузка собирается из того, что показано на экране, поэтому перед
            ней делается пересчёт: иначе в файл уйдут числа предыдущей правки,
            если она пришла из восстановленного состояния и расчёт ещё не шёл.
        */
        document.getElementById('excelBtn').addEventListener('click', function () {
            run();

            try {
                Report.toExcel();
                say('Выгружено в Excel', 'done');
            } catch (error) {
                say('Выгрузка в Excel не удалась: ' + error.message, 'fail');
            }
        });

        document.getElementById('wordBtn').addEventListener('click', function () {
            run();

            try {
                Report.toWord();
                say('Выгружено в Word', 'done');
            } catch (error) {
                say('Выгрузка в Word не удалась: ' + error.message, 'fail');
            }
        });

        document.getElementById('saveBtn').addEventListener('click', function () {
            Storage.download(project);
            say('Проект сохранён файлом', 'done');
        });

        document.getElementById('openBtn').addEventListener('click', function () {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', function (event) {
            var file = event.target.files && event.target.files[0];
            if (!file) return;

            // файл становится новым объектом библиотеки (или читается как архив с ревизиями)
            if (Library.isReady()) UiLibrary.openFile(file);
            else {
                Storage.read(file, function (data) { load(data, 'Проект открыт: ' + data.name); }, function (message) { say(message, 'fail'); });
            }

            event.target.value = '';
        });

        document.getElementById('newBtn').addEventListener('click', function () {
            // в библиотеке прежний объект остаётся — потерять работу «Новым» больше нельзя
            if (Library.isReady()) { UiLibrary.newObject(); return; }

            if (!window.confirm('Начать новый проект? Введённые данные будут потеряны.')) return;
            load(Storage.blank());
        });
    }

    /*
        Запуск откладывается всегда, даже когда документ уже разобран: init
        обращается к App, а переменная App получит значение только после того,
        как этот модуль вернёт свой объект.
    */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }

    return {
        get project() { return project; },
        render: render,
        load: load,
        syncName: syncName,
        run: run,
        say: say,
        mainTotal: mainTotal
    };
})();
