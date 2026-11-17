/*
    Вкладка «Стояки канализации»: ввод стояка и проверка на срыв гидрозатворов.

    Этажи задаются участками — «с 1 по 16 такой набор, с 17 по 25 такой», — а не
    одним набором на весь стояк: однородным стояк бывает разве что в учебнике.

    Выпадающие списки исполнений строятся из самого приложения К, а не прописаны
    в разметке. Иначе в списке однажды окажется диаметр, которого в таблице нет,
    и расчёт вернёт «строки не найдено» без объяснения причины.
*/

var UiRiser = (function () {
    'use strict';

    var fields = {};
    var sectionsBox, summaryBox, verdict, result, alternatives;
    var last = null;

    function init() {
        sectionsBox = document.getElementById('sectionsBox');
        summaryBox = document.getElementById('riserSummary');
        verdict = document.getElementById('riserVerdict');
        result = document.getElementById('riserResult');
        alternatives = document.getElementById('riserAlternatives');

        fields.mark = document.getElementById('riserMark');
        fields.norm = document.getElementById('riserNorm');
        fields.floorHeight = document.getElementById('floorHeight');
        fields.byFixtures = document.getElementById('byFixtures');
        fields.totalFixtures = document.getElementById('totalFixtures');
        fields.totalUsers = document.getElementById('totalUsers');
        fields.vented = document.getElementById('vented');
        fields.material = document.getElementById('material');
        fields.riserMm = document.getElementById('riserMm');
        fields.branchMm = document.getElementById('branchMm');
        fields.angleDeg = document.getElementById('angleDeg');

        var norms = Tables.norms();
        var html = [];
        for (var i = 0; i < norms.length; i++) {
            html.push('<option value="' + Format.html(norms[i].name) + '">'
                + Format.html(norms[i].name) + '</option>');
        }
        fields.norm.innerHTML = html.join('');

        for (var key in fields) {
            if (!fields.hasOwnProperty(key)) continue;
            fields[key].addEventListener('change', onChange);
        }

        document.getElementById('addSection').addEventListener('click', addSection);
    }

    /*
        Новый участок продолжает стояк вверх: начинается с этажа, следующего за
        верхним из уже заданных, и повторяет его набор приборов. Так и растёт
        дом, и переписывать набор заново не приходится.
    */
    function addSection() {
        var sections = App.project.riser.sections;
        var top = 0;
        var sample = null;

        for (var i = 0; i < sections.length; i++) {
            if (sections[i].to > top) {
                top = sections[i].to;
                sample = sections[i];
            }
        }

        var fixtures = [];

        if (sample) {
            for (var k = 0; k < sample.fixtures.length; k++) {
                fixtures.push({
                    name: sample.fixtures[k].name,
                    count: sample.fixtures[k].count
                });
            }
        } else {
            fixtures = [
                { name: 'Унитаз со смывным бачком', count: 1 },
                { name: 'Ванна со смесителем', count: 1 },
                { name: 'Мойка со смесителем', count: 1 },
                { name: 'Умывальник со смесителем', count: 1 }
            ];
        }

        sections.push(Storage.section(Storage.id('r'), top + 1, top + 1,
            sample ? sample.residents : 3, fixtures));

        render();
        App.run();
    }

    /* --- ввод ------------------------------------------------------------ */

    function render() {
        var riser = App.project.riser;

        fields.mark.value = riser.mark;
        fields.norm.value = riser.norm;
        fields.floorHeight.value = Format.plain(riser.floorHeightM);
        fields.byFixtures.checked = riser.byFixtures;
        fields.totalFixtures.value = riser.totalFixtures > 0 ? riser.totalFixtures : '';
        fields.totalUsers.value = riser.totalUsers > 0 ? riser.totalUsers : '';
        fields.vented.checked = riser.vented;

        renderMode();
        renderStackOptions();
        renderSections();
    }

    /*
        Поля общих N и U показываются только в расчёте по приборам: в расчёте по
        потребителям они не участвуют, и пустая пара полей рядом с работающими
        читалась бы как «сюда тоже что-то надо вписать».
    */
    function renderMode() {
        var on = App.project.riser.byFixtures;

        document.getElementById('byFixturesFields').classList.toggle('hidden', !on);
        document.getElementById('byFixturesHint').classList.toggle('hidden', !on);
    }

    /*
        Списки исполнений зависят друг от друга: у вентилируемого и
        невентилируемого стояка разные материалы, у каждого материала свои
        диаметры и углы. Поэтому списки перестраиваются при каждой правке, а
        выбранное значение сохраняется, только если оно в новом списке есть.
    */
    function renderStackOptions() {
        var riser = App.project.riser;

        var materials = Tables.materials(riser.vented);
        if (materials.indexOf(riser.material) < 0) riser.material = materials[0];

        fill(fields.material, materials, riser.material, function (v) { return v; });

        var options = Tables.stackOptions(riser.vented, riser.material);

        if (options.risers.indexOf(riser.riserMm) < 0) {
            riser.riserMm = options.risers[options.risers.length - 1];
        }

        fill(fields.riserMm, options.risers, riser.riserMm, function (v) { return Format.num(v, 0); });

        // Отвод крупнее стояка не бывает — такие строки из списка убираем.
        var branches = [];
        for (var i = 0; i < options.branches.length; i++) {
            if (options.branches[i] <= riser.riserMm) branches.push(options.branches[i]);
        }
        if (branches.length === 0) branches = options.branches;
        if (branches.indexOf(riser.branchMm) < 0) riser.branchMm = branches[branches.length - 1];

        fill(fields.branchMm, branches, riser.branchMm, function (v) { return Format.num(v, 0); });

        if (options.angles.indexOf(riser.angleDeg) < 0) {
            riser.angleDeg = options.angles[options.angles.length - 1];
        }

        fill(fields.angleDeg, options.angles, riser.angleDeg, function (v) { return Format.angle(v); });
    }

    function fill(select, values, current, label) {
        var html = [];

        for (var i = 0; i < values.length; i++) {
            html.push('<option value="' + values[i] + '"'
                + (values[i] === current ? ' selected' : '') + '>'
                + label(values[i]) + '</option>');
        }

        select.innerHTML = html.join('');
    }

    function renderSections() {
        var sections = App.project.riser.sections;
        var catalog = Tables.fixtures();
        var html = [];
        var s, k;

        for (s = 0; s < sections.length; s++) {
            var section = sections[s];
            var set = Riser.fixtureSet(section.fixtures);
            var floors = Math.abs(section.to - section.from) + 1;

            html.push('<div class="section" data-section="' + s + '">');

            html.push('<div class="row">');
            html.push('<label class="field">Этажи с'
                + '<input type="number" min="1" step="1" data-field="from" value="'
                + section.from + '"></label>');
            html.push('<label class="field">по'
                + '<input type="number" min="1" step="1" data-field="to" value="'
                + section.to + '"></label>');
            html.push('<label class="field">Жильцов на этаж'
                + '<input type="number" min="0" step="1" data-field="residents" value="'
                + section.residents + '"></label>');

            html.push('<div class="field wide"><span class="note">Этажей ' + floors
                + ', приборов на этаже ' + set.count
                + ', по участку ' + (set.count * floors) + ' приборов и '
                + (section.residents * floors) + ' жильцов</span></div>');

            html.push('<button class="small danger" data-action="remove-section"'
                + (sections.length < 2 ? ' disabled title="Последний участок удалить нельзя"' : '')
                + '>× Участок</button>');
            html.push('</div>');

            html.push('<div class="scroll"><table>');
            html.push('<thead><tr>'
                + '<th class="left" style="min-width:300px">Прибор — таблица А.1</th>'
                + '<th>Штук<br>на этаже</th><th>q0, л/с</th>'
                + '<th>q0_s, л/с<br>стоки</th><th>Ø отвода,<br>мм</th><th></th>'
                + '</tr></thead><tbody>');

            for (k = 0; k < section.fixtures.length; k++) {
                var item = section.fixtures[k];
                var fixture = Tables.fixture(item.name);

                html.push('<tr data-fixture="' + k + '">');

                html.push('<td class="left"><select data-field="name">');
                for (var c = 0; c < catalog.length; c++) {
                    html.push('<option value="' + Format.html(catalog[c].name) + '"'
                        + (catalog[c].name === item.name ? ' selected' : '') + '>'
                        + Format.html(catalog[c].name) + '</option>');
                }
                html.push('</select></td>');

                html.push('<td><input type="number" min="0" step="1" data-field="count" value="'
                    + item.count + '"></td>');
                html.push('<td class="dim">' + (fixture ? Format.num(fixture.q0) : '—') + '</td>');
                html.push('<td class="dim">' + (fixture ? Format.num(fixture.qs) : '—') + '</td>');
                html.push('<td class="dim">' + (fixture && fixture.dyo
                    ? Format.num(fixture.dyo, 0) : '—') + '</td>');
                html.push('<td><button class="small danger" data-action="remove-fixture">×</button></td>');
                html.push('</tr>');
            }

            html.push('</tbody></table></div>');

            html.push('<div class="row" style="margin-top:8px">');
            html.push('<button class="small" data-action="add-fixture">+ Прибор</button>');
            html.push('<button class="small" data-action="flat"'
                + ' title="Унитаз, ванна, мойка, умывальник — по одному">Типовая квартира</button>');
            html.push('</div>');

            html.push('</div>');
        }

        sectionsBox.innerHTML = html.join('');

        var inputs = sectionsBox.querySelectorAll('input, select');
        for (var n = 0; n < inputs.length; n++) inputs[n].addEventListener('change', onSectionChange);

        var buttons = sectionsBox.querySelectorAll('button[data-action]');
        for (var b = 0; b < buttons.length; b++) buttons[b].addEventListener('click', onSectionButton);
    }

    function sectionIndex(element) {
        var box = element;
        while (box && !box.getAttribute('data-section')) box = box.parentNode;
        return box ? parseInt(box.getAttribute('data-section'), 10) : -1;
    }

    function fixtureIndex(element) {
        var row = element;
        while (row && row.tagName !== 'TR') row = row.parentNode;
        return row ? parseInt(row.getAttribute('data-fixture'), 10) : -1;
    }

    function onSectionChange(event) {
        var s = sectionIndex(event.target);
        if (s < 0) return;

        var section = App.project.riser.sections[s];
        var field = event.target.getAttribute('data-field');
        var k = fixtureIndex(event.target);

        if (k >= 0) {
            if (field === 'name') section.fixtures[k].name = event.target.value;
            else section.fixtures[k].count = Math.max(0, Math.round(Format.parse(event.target.value, 0)));
        } else if (field === 'residents') {
            section.residents = Math.max(0, Math.round(Format.parse(event.target.value, 0)));
        } else {
            section[field] = Math.max(1, Math.round(Format.parse(event.target.value, 1)));
        }

        renderSections();
        App.run();
    }

    function onSectionButton(event) {
        var s = sectionIndex(event.target);
        if (s < 0) return;

        var sections = App.project.riser.sections;
        var section = sections[s];
        var action = event.target.getAttribute('data-action');

        if (action === 'remove-section') {
            if (sections.length < 2) return;
            sections.splice(s, 1);
        } else if (action === 'add-fixture') {
            section.fixtures.push({ name: Tables.fixtures()[0].name, count: 1 });
        } else if (action === 'flat') {
            section.fixtures = [
                { name: 'Унитаз со смывным бачком', count: 1 },
                { name: 'Ванна со смесителем', count: 1 },
                { name: 'Мойка со смесителем', count: 1 },
                { name: 'Умывальник со смесителем', count: 1 }
            ];
        } else if (action === 'remove-fixture') {
            var k = fixtureIndex(event.target);
            if (k >= 0) section.fixtures.splice(k, 1);
        }

        render();
        App.run();
    }

    function onChange() {
        var riser = App.project.riser;

        riser.mark = fields.mark.value;
        riser.norm = fields.norm.value;
        riser.floorHeightM = Math.max(0.1, Format.parse(fields.floorHeight.value, riser.floorHeightM));
        riser.byFixtures = fields.byFixtures.checked;
        riser.totalFixtures = Math.max(0, Math.round(Format.parse(fields.totalFixtures.value, 0)));
        riser.totalUsers = Math.max(0, Math.round(Format.parse(fields.totalUsers.value, 0)));
        riser.vented = fields.vented.checked;
        riser.material = fields.material.value;
        riser.riserMm = Format.parse(fields.riserMm.value, riser.riserMm);
        riser.branchMm = Format.parse(fields.branchMm.value, riser.branchMm);
        riser.angleDeg = Format.parse(fields.angleDeg.value, riser.angleDeg);

        renderMode();
        renderStackOptions();
        App.run();
    }

    /* --- расчёт ---------------------------------------------------------- */

    function run(node) {
        var riser = App.project.riser;
        var norm = Tables.norm(riser.norm);

        if (!norm) {
            last = null;
            show();
            return null;
        }

        var input = {
            mark: riser.mark,
            norm: norm,
            sections: riser.sections,
            floorHeightM: riser.floorHeightM,
            byFixtures: riser.byFixtures,
            totalFixtures: riser.totalFixtures,
            totalUsers: riser.totalUsers,
            vented: riser.vented,
            material: riser.material,
            riserMm: riser.riserMm,
            branchMm: riser.branchMm,
            angleDeg: riser.angleDeg,
            node: node
        };

        last = Riser.run(input);
        last.limit = Riser.limitFloors(input, 60);
        last.options = last.passes ? [] : Riser.alternatives(input);

        show();
        return last;
    }

    function show() {
        showSummary();

        if (!last || !last.base) {
            verdict.innerHTML = '<div class="verdict unknown"><b>Расчёт не выполнен</b>'
                + '<p>Не заданы приборы, жильцы или этажи участков.</p></div>';
            result.innerHTML = '';
            alternatives.innerHTML = '';
            return;
        }

        showMode();
        showVerdict();
        showFloors();
        showAlternatives();
    }

    /* Сводка по стояку рядом с высотой этажа: сколько всего этажей и приборов. */
    function showSummary() {
        if (!summaryBox) return;

        if (!last) {
            summaryBox.innerHTML = '';
            return;
        }

        summaryBox.innerHTML = 'Этажей на стояке: <b>' + last.top
            + '</b>, высота стояка ' + Format.num(last.heightM) + ' м<br>'
            + 'Всего приборов ' + last.set.fixtures + ', жильцов ' + last.set.residents;
    }

    /*
        Сводка расчёта по приборам рядом с полями ввода: общее N·P и вероятность
        на один прибор. Это два числа, которые инженер и держит в голове, ведя
        такой расчёт руками.
    */
    function showMode() {
        var target = document.getElementById('byFixturesSummary');
        if (!target) return;

        if (!last || !last.byFixtures) {
            target.innerHTML = '';
            return;
        }

        target.innerHTML = 'Общее N·P = <b>' + Format.num(last.NP)
            + '</b>, вероятность на один прибор P = <b>' + Format.num(last.P)
            + '</b><br>при N = ' + last.totalFixtures + ' и U = ' + last.totalUsers;
    }

    function showVerdict() {
        var base = last.base;

        if (!(last.capacity > 0)) {
            verdict.innerHTML = '<div class="verdict unknown">'
                + '<b>Пропускная способность не определена</b>'
                + '<p>' + Format.html(last.capacitySource) + '.</p>'
                + '<p>Расчётный расход стоков у основания стояка q_s = '
                + Format.num(base.qs) + ' л/с.</p></div>';
            return;
        }

        var css = last.passes ? 'pass' : 'fail';
        var head = last.passes
            ? 'Стояк проходит — гидрозатворы не срывает'
            : 'Стояк НЕ проходит — гидрозатворы сорвёт';

        var html = [];
        html.push('<div class="verdict ' + css + '">');
        html.push('<b>' + head + '</b>');
        html.push('<p>q_s = <b>' + Format.num(base.qs) + ' л/с</b> '
            + (last.passes ? '≤' : '>') + ' q_К = <b>' + Format.num(last.capacity)
            + ' л/с</b>, загрузка стояка ' + Format.num(last.load * 100, 1) + ' %.</p>');
        html.push('<p>' + Format.html(last.capacitySource) + '.</p>');
        html.push('<p>Способ расчёта: ' + (last.byFixtures
            ? 'по приборам, вероятность одна на стояк — P = ' + Format.num(last.P)
                + ' при N = ' + last.totalFixtures + ' и U = ' + last.totalUsers
            : 'по потребителям, вероятность вычисляется на каждом этаже') + '.</p>');

        if (last.limit > 0) {
            html.push('<p>В этом исполнении стояк принимает стоки не более чем с <b>'
                + last.limit + '</b> этажей при заданной раскладке приборов'
                + (last.limit >= 60 ? ' (перебор остановлен на шестидесяти)' : '') + '.</p>');
        }

        if (!last.passes) {
            html.push('<p>Что можно сделать: уменьшить угол присоединения поэтажных '
                + 'отводов, увеличить диаметр стояка, вывести вытяжную часть выше кровли, '
                + 'разделить стояк на два. Проходящие исполнения перечислены ниже.</p>');
        }

        html.push('</div>');
        verdict.innerHTML = html.join('');
    }

    function showFloors() {
        var html = [];

        html.push('<p class="hint">Этажи нумеруются как в проекте: первый — нижний. '
            + 'Стояк собирает стоки сверху вниз, поэтому на каждом этаже он несёт приборы '
            + 'этого этажа и всех вышележащих, а расчётное сечение — основание, то есть '
            + 'первый этаж, нижняя строка.'
            + (last.byFixtures
                ? ' В расчёте по приборам вероятность на всех этажах одна, а растёт '
                    + 'только N; число жильцов показано серым — в расчёте оно не участвует.'
                : '')
            + '</p>');

        html.push('<div class="scroll"><table>');
        html.push('<thead><tr>');
        html.push('<th>Этаж</th>');
        html.push('<th>Этажей<br>сверху</th>');
        html.push('<th>Приборов<br>на этаже</th>');
        html.push('<th>N приборов<br>на этаже и выше</th>');
        html.push('<th>U жильцов<br>на этаже и выше</th>');
        html.push('<th>P</th><th>N·P</th><th>α</th><th>Табл.</th>');
        html.push('<th>q_tot,<br>л/с</th>');
        html.push('<th>q_s,<br>л/с</th>');
        html.push('<th>q_К,<br>л/с</th>');
        html.push('<th>Загрузка</th>');
        html.push('</tr></thead><tbody>');

        for (var i = 0; i < last.floors.length; i++) {
            var floor = last.floors[i];
            var over = last.capacity > 0 && floor.qs > last.capacity;
            var isBase = i === last.floors.length - 1;
            var own = last.layout[floor.floor - 1];

            html.push('<tr class="' + (over ? 'fail' : (isBase ? 'here' : '')) + '">');
            html.push('<td><b>' + floor.floor + '</b></td>');
            html.push('<td class="dim">' + floor.above + '</td>');
            html.push('<td class="dim">' + (own ? own.fixtures : 0) + '</td>');
            html.push('<td>' + floor.fixtures + '</td>');
            html.push('<td' + (last.byFixtures ? ' class="dim"' : '') + '>'
                + floor.residents + '</td>');
            html.push('<td' + (last.byFixtures ? ' class="dim"' : '') + '>'
                + Format.num(floor.P) + '</td>');
            html.push('<td>' + Format.num(floor.NP) + '</td>');
            html.push('<td>' + Format.num(floor.alpha) + '</td>');
            html.push('<td class="dim">' + floor.table + '</td>');
            html.push('<td>' + Format.num(floor.q) + '</td>');
            html.push('<td><b>' + Format.num(floor.qs) + '</b></td>');
            html.push('<td class="dim">' + (last.capacity > 0 ? Format.num(last.capacity) : '—') + '</td>');
            html.push('<td>' + (last.capacity > 0
                ? Format.num(floor.qs / last.capacity * 100, 1) + ' %' : '—') + '</td>');
            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        result.innerHTML = html.join('');
    }

    function showAlternatives() {
        if (!last.options || last.options.length === 0) {
            alternatives.innerHTML = last.passes
                ? '<p class="hint">Заданное исполнение проходит — перебор не нужен.</p>'
                : '<p class="hint">В приложении К нет исполнения, которое пропустило бы '
                    + 'такой расход. Стояк нужно разделить либо уменьшить число приборов на нём.</p>';
            return;
        }

        var html = [];

        html.push('<p class="hint">Перебор исполнений из приложения К при том же расходе. '
            + 'Сверху самые нагруженные из проходящих — они и есть экономичные.</p>');

        html.push('<div class="scroll"><table>');
        html.push('<thead><tr>');
        html.push('<th>Вытяжная<br>часть</th><th>Материал</th>');
        html.push('<th>Ø стояка,<br>мм</th><th>Ø отвода,<br>мм</th><th>Угол</th>');
        html.push('<th>q_К,<br>л/с</th><th>Загрузка</th>');
        html.push('</tr></thead><tbody>');

        var limit = Math.min(last.options.length, 20);

        for (var i = 0; i < limit; i++) {
            var option = last.options[i];

            html.push('<tr>');
            html.push('<td>' + (option.vented ? 'есть' : 'нет') + '</td>');
            html.push('<td>' + Format.html(option.material) + '</td>');
            html.push('<td>' + Format.num(option.riserMm, 0) + '</td>');
            html.push('<td>' + Format.num(option.branchMm, 0) + '</td>');
            html.push('<td>' + Format.angle(option.angleDeg) + '</td>');
            html.push('<td>' + Format.num(option.capacity) + '</td>');
            html.push('<td>' + Format.num(option.load * 100, 1) + ' %</td>');
            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        if (last.options.length > limit) {
            html.push('<p class="hint">Показаны ' + limit + ' из '
                + last.options.length + ' проходящих исполнений.</p>');
        }

        alternatives.innerHTML = html.join('');
    }

    function trace() {
        return last ? last.trace : null;
    }

    function result_() {
        return last;
    }

    return {
        init: init,
        render: render,
        run: run,
        trace: trace,
        result: result_
    };
})();
