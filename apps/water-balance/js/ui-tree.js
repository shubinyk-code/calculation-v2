/*
    Вкладка «Потребители»: дерево папок слева, форма выбранного узла справа.

    Папка — узел дерева (project.groups, поле parentId). Внутри неё лежат
    вложенные папки, потребители и прочие расходы. Выбор узла показывает
    справа его редактор: у папки — имя и авто-итог по всему её поддереву
    (Consumers.runGroup), у потребителя — те же поля, что раньше стояли
    столбцами широкой таблицы, теперь в виде формы.

    Баланс водопотребления (19 колонок) — под деревом, целиком по проекту.
*/

var UiTree = (function () {
    'use strict';

    var treeBox, formBox, balanceBox;
    var last = null;
    var selected = null;           // { kind: 'group'|'consumer'|'extra', id }
    var expanded = {};             // groupId -> bool, по умолчанию раскрыто

    function init() {
        treeBox = document.getElementById('consumerTree');
        formBox = document.getElementById('nodeForm');
        balanceBox = document.getElementById('balanceTable');

        document.getElementById('addRootGroup').addEventListener('click', function () {
            var g = { id: Storage.id('g'), name: 'Новая папка', parentId: '' };
            App.project.groups.push(g);
            select('group', g.id);
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

    function select(kind, id) {
        selected = { kind: kind, id: id };
    }

    /* --- дерево: разметка -------------------------------------------------- */

    function render() {
        renderTree();
        renderForm();
        renderBalance();

        var project = App.project;
        document.getElementById('objectName').value = project.object.name;
        document.getElementById('objectAddress').value = project.object.address;
        document.getElementById('objectNote').value = project.object.note;
    }

    function renderTree() {
        var project = App.project;
        var html = ['<ul class="tree">'];

        var roots = Consumers.roots(project);
        for (var i = 0; i < roots.length; i++) html.push(treeGroup(roots[i], 0));

        html.push('</ul>');
        treeBox.innerHTML = html.join('');

        bindTree();
    }

    function treeGroup(g, depth) {
        var project = App.project;
        var kids = Consumers.children(g.id, project);
        var cons = Consumers.consumersIn(g.id, project);
        var extras = Consumers.extrasIn(g.id, project);
        var open = expanded[g.id] !== false;
        var isSel = selected && selected.kind === 'group' && selected.id === g.id;

        var html = ['<li class="node folder' + (isSel ? ' sel' : '') + '" data-kind="group" data-id="'
            + Format.html(g.id) + '">'];

        html.push('<div class="row">');
        html.push('<button type="button" class="twirl" data-action="toggle">'
            + (open ? '▾' : '▸') + '</button>');
        html.push('<span class="ico">📁</span>');
        html.push('<span class="label" data-action="select" title="' + Format.html(g.name) + '">'
            + Format.html(g.name) + '</span>');
        html.push('<span class="rowbtns">');
        html.push('<button type="button" class="mini" data-action="add-group" title="Подпапка">+папка</button>');
        html.push('<button type="button" class="mini" data-action="add-consumer" title="Потребитель">+потр.</button>');
        html.push('<button type="button" class="mini" data-action="add-extra" title="Прочий расход">+расх.</button>');
        html.push('</span>');
        html.push('</div>');

        if (open) {
            html.push('<ul>');
            for (var i = 0; i < kids.length; i++) html.push(treeGroup(kids[i], depth + 1));
            for (i = 0; i < cons.length; i++) html.push(treeConsumer(cons[i]));
            for (i = 0; i < extras.length; i++) html.push(treeExtra(extras[i]));

            if (kids.length === 0 && cons.length === 0 && extras.length === 0) {
                html.push('<li class="empty-hint">пусто</li>');
            }

            html.push('</ul>');
        }

        html.push('</li>');
        return html.join('');
    }

    function treeConsumer(c) {
        var isSel = selected && selected.kind === 'consumer' && selected.id === c.id;
        return '<li class="node leaf' + (isSel ? ' sel' : '') + '" data-kind="consumer" data-id="'
            + Format.html(c.id) + '"><div class="row">'
            + '<span class="ico">💧</span>'
            + '<span class="label" data-action="select" title="' + Format.html(c.name) + '">'
            + Format.html(c.name) + '</span>'
            + '</div></li>';
    }

    function treeExtra(e) {
        var isSel = selected && selected.kind === 'extra' && selected.id === e.id;
        return '<li class="node leaf' + (isSel ? ' sel' : '') + '" data-kind="extra" data-id="'
            + Format.html(e.id) + '"><div class="row">'
            + '<span class="ico">＋</span>'
            + '<span class="label" data-action="select" title="' + Format.html(e.name) + '">'
            + Format.html(e.name) + '</span>'
            + '</div></li>';
    }

    function bindTree() {
        var nodes = treeBox.querySelectorAll('.node > .row');

        for (var i = 0; i < nodes.length; i++) {
            var row = nodes[i];
            var li = row.parentNode;
            var kind = li.getAttribute('data-kind');
            var id = li.getAttribute('data-id');

            var buttons = row.querySelectorAll('button, .label');
            for (var b = 0; b < buttons.length; b++) {
                (function (el, kind, id) {
                    el.addEventListener('click', function (event) {
                        event.stopPropagation();
                        onTreeAction(el.getAttribute('data-action'), kind, id);
                    });
                })(buttons[b], kind, id);
            }
        }
    }

    function onTreeAction(action, kind, id) {
        var project = App.project;

        if (action === 'toggle') {
            expanded[id] = expanded[id] === false;
            renderTree();
            return;
        }

        if (action === 'select') {
            select(kind, id);
            render();
            return;
        }

        if (action === 'add-group') {
            var g = { id: Storage.id('g'), name: 'Новая папка', parentId: id };
            project.groups.push(g);
            expanded[id] = true;
            select('group', g.id);
            render();
            App.run();
            return;
        }

        if (action === 'add-consumer') {
            var name = Tables.norms()[0].name;
            var c = Storage.consumer(Storage.id('c'), name, id, name, 0, 0);
            project.consumers.push(c);
            expanded[id] = true;
            select('consumer', c.id);
            render();
            App.run();
            return;
        }

        if (action === 'add-extra') {
            var e = Storage.extra(Storage.id('e'), 'Полив территории');
            e.group = id;
            project.extras.push(e);
            expanded[id] = true;
            select('extra', e.id);
            render();
            App.run();
            return;
        }
    }

    /* --- форма узла --------------------------------------------------------- */

    function renderForm() {
        if (!selected) {
            formBox.innerHTML = '<p class="hint">Выберите папку, потребителя или прочий расход '
                + 'в дереве слева — здесь появится его форма. Новый проект начинается с кнопки '
                + '«+ папка» над деревом.</p>';
            return;
        }

        var project = App.project;

        if (selected.kind === 'group') {
            var g = Consumers.byId(project.groups, selected.id);
            if (!g) { selected = null; renderForm(); return; }
            renderGroupForm(g);
            return;
        }

        if (selected.kind === 'consumer') {
            var c = Consumers.byId(project.consumers, selected.id);
            if (!c) { selected = null; renderForm(); return; }
            renderConsumerForm(c);
            return;
        }

        var e = Consumers.byId(project.extras, selected.id);
        if (!e) { selected = null; renderForm(); return; }
        renderExtraForm(e);
    }

    function groupOptions(excludeSubtreeOf, current) {
        var project = App.project;
        var html = ['<option value=""' + (current === '' ? ' selected' : '') + '>— корень —</option>'];

        for (var i = 0; i < project.groups.length; i++) {
            var g = project.groups[i];
            if (excludeSubtreeOf && Consumers.isInside(excludeSubtreeOf, g.id, project)) continue;

            html.push('<option value="' + Format.html(g.id) + '"'
                + (g.id === current ? ' selected' : '') + '>'
                + Format.html(Consumers.path(g.id, project)) + '</option>');
        }

        return html.join('');
    }

    function renderGroupForm(g) {
        var project = App.project;
        var html = [];

        html.push('<div class="card">');
        html.push('<div class="ctitle"><b>Папка: ' + Format.html(Consumers.path(g.id, project)) + '</b>'
            + '<button type="button" class="small danger" data-act="delete-group">Удалить папку</button></div>');

        html.push('<div class="form">');
        html.push('<label class="field wide">Название<input type="text" data-act="rename" value="'
            + Format.html(g.name) + '"></label>');

        html.push('<label class="field wide">Родительская папка'
            + '<select data-act="reparent" title="' + Format.html(project.groups.some(function (x) { return x.id === g.parentId; })
                ? Consumers.path(g.parentId, project) : '— корень —') + '">'
            + groupOptions(g.id, g.parentId) + '</select></label>');
        html.push('</div>');

        html.push('<p class="hint">Авто-итог считается по этой папке и всем вложенным сразу — '
            + 'по формулам (1) и (4) СП 30, не сложением. Добавили сюда ещё одну подпапку — '
            + 'итог пересчитался сам, ничего заново выбирать не нужно.</p>');

        var count = Consumers.consumersInSubtree(g.id, project).length;

        if (count === 0) {
            html.push('<p class="hint">В поддереве нет ни одного потребителя.</p>');
        } else {
            var result = Consumers.runGroup(g.id, project, App.project.alphaMode === 'node');
            html.push('<div id="groupTotalBox"></div>');
        }

        html.push('</div>');
        formBox.innerHTML = html.join('');

        bindGroupForm(g);

        if (count > 0) {
            var box = document.getElementById('groupTotalBox');
            var res = Consumers.runGroup(g.id, App.project, App.project.alphaMode === 'node');
            box.innerHTML = groupTotalTable(res, count);
        }
    }

    function groupTotalTable(result, count) {
        if (!result) return '<p class="hint">Расход не считается.</p>';

        var norm = result.group && result.group.norm ? result.group.norm : null;
        var rows = [
            ['В1', result.cold, norm ? norm.quc : 0],
            ['Т3', result.hot, norm ? norm.quh : 0],
            ['В1 общ.', result.total, norm ? norm.qu : 0]
        ];

        var html = ['<div class="scroll"><table class="grid">'];
        html.push('<thead><tr><th class="l">Система</th><th>м³/сут</th><th>м³/час</th><th>л/с</th></tr></thead><tbody>');

        for (var i = 0; i < rows.length; i++) {
            var flow = rows[i][1];
            if (!flow) continue;
            html.push('<tr><td class="l">' + rows[i][0] + '</td><td>' + Format.num(flow.qDay, 3)
                + '</td><td>' + Format.num(flow.qhr, 3) + '</td><td><b>' + Format.num(flow.q, 3) + '</b></td></tr>');
        }

        html.push('<tr><td class="l">К1</td><td>' + Format.num(result.sewerDay, 3) + '</td><td>'
            + Format.num(result.total ? result.total.qhr : 0, 3) + '</td><td><b>'
            + Format.num(result.sewer, 3) + '</b></td></tr>');

        html.push('</tbody></table></div>');
        html.push('<p class="hint small">Потребителей в поддереве: ' + count + '.</p>');

        return html.join('');
    }

    function bindGroupForm(g) {
        formBox.querySelector('[data-act="rename"]').addEventListener('change', function (event) {
            g.name = event.target.value;
            render();
            App.run();
        });

        formBox.querySelector('[data-act="reparent"]').addEventListener('change', function (event) {
            g.parentId = event.target.value;
            render();
            App.run();
        });

        formBox.querySelector('[data-act="delete-group"]').addEventListener('click', function () {
            removeGroup(g.id);
        });
    }

    /*
        Удаление папки не роняет её содержимое: подпапки, потребители и прочие
        расходы поднимаются на уровень родителя удаляемой папки — ровно то же
        правило, что раньше действовало для потребителей удалённой плоской
        группы («остаются без группы»), только теперь есть куда подняться.
    */
    function removeGroup(id) {
        var project = App.project;
        var g = Consumers.byId(project.groups, id);
        if (!g) return;

        var parentId = g.parentId;
        var i;

        for (i = 0; i < project.groups.length; i++) {
            if (project.groups[i].parentId === id) project.groups[i].parentId = parentId;
        }

        for (i = 0; i < project.consumers.length; i++) {
            if (project.consumers[i].group === id) project.consumers[i].group = parentId;
        }

        for (i = 0; i < project.extras.length; i++) {
            if (project.extras[i].group === id) project.extras[i].group = parentId;
        }

        var at = project.groups.indexOf(g);
        if (at >= 0) project.groups.splice(at, 1);

        selected = parentId ? { kind: 'group', id: parentId } : null;
        render();
        App.run();
    }

    function renderConsumerForm(c) {
        var project = App.project;
        var norms = Tables.norms();
        var norm = Tables.norm(c.norm) || norms[0];

        var html = [];
        html.push('<div class="card">');
        html.push('<div class="ctitle"><b>Потребитель</b>'
            + '<button type="button" class="small danger" data-act="delete">Удалить</button></div>');

        html.push('<div class="form">');

        html.push(field('wide', 'Наименование', input('text', 'name', c.name)));
        html.push(field('wide', 'Папка', select_('group', groupOptions(null, c.group), Consumers.path(c.group, project))));
        html.push(field('wide', 'Норма — таблица А.2', select_('norm', normOptions(norms, c.norm), c.norm)));
        html.push(field('', '№ по таблице А.2', '<span class="dim">' + (norm.item ? 'п. ' + Format.html(norm.item) : '— своя строка') + '</span>'));
        html.push(field('', 'Измеритель', '<span class="dim">' + Format.html(norm.unit) + '</span>'));
        html.push(field('', 'Норма сут., л/сут', '<span class="dim">' + Format.num(norm.qu, 0) + '</span>'));
        html.push(field('', 'Норма в час, л/ч', '<span class="dim">' + Format.num(norm.qhru) + '</span>'));
        html.push(field('wide', 'Обоснование', input('text', 'reason', c.reason, defaultReason(norm))));
        html.push(field('', 'Технологический процесс', input('text', 'process', c.process)));
        html.push(field('', 'Часов работы', input('number', 'hours', c.hours > 0 ? c.hours : '', Format.num(norm.t, 0))));
        html.push(field('', 'U сут.', input('number', 'usersDay', c.usersDay)));
        html.push(field('', 'U час.', input('number', 'usersHour', c.usersHour > 0 ? c.usersHour : '', c.usersDay)));
        html.push(field('', 'N приборов', input('number', 'fixtures', c.fixtures > 0 ? c.fixtures : '', 'как U')));
        html.push(field('', 'Качество воды', input('text', 'quality', c.quality)));
        html.push(field('', 'Источник', select_('source', listOptions(Consumers.SOURCES, c.source))));
        html.push(field('', 'Канализация', select_('drain', listOptions(Consumers.DRAINS, c.drain))));
        html.push(field('', 'Потери, %', input('number', 'lossPercent', c.lossPercent)));
        html.push(field('', 'q0_s, л/с', input('number', 'q0Sewer', c.q0Sewer)));
        html.push(field('wide', 'Примечание', input('text', 'note', c.note)));

        html.push('</div></div>');

        formBox.innerHTML = html.join('');
        bindConsumerForm(c);
    }

    function field(width, label, controlHtml) {
        return '<label class="field ' + width + '">' + Format.html(label) + controlHtml + '</label>';
    }

    function input(type, name, value, placeholder) {
        var attrs = type === 'number' ? ' min="0" step="any"' : '';
        return '<input type="' + type + '" data-field="' + name + '"' + attrs + ' value="'
            + Format.html(value === undefined || value === null ? '' : value) + '"'
            + (placeholder !== undefined ? ' placeholder="' + Format.html(String(placeholder)) + '"' : '') + '>';
    }

    /*
        title — на случай, когда выбранная строка не помещается в select и
        обрезается многоточием: длинная норма («Жилые дома с ваннами от 1500 мм,
        оборудованными душами») или путь по дереву папок в несколько уровней.
    */
    function select_(name, options, title) {
        return '<select data-field="' + name + '"' + (title ? ' title="' + Format.html(title) + '"' : '') + '>'
            + options + '</select>';
    }

    /* Номер пункта таблицы А.2 — впереди имени, чтобы его было видно сразу в
       списке, не только после выбора строки. */
    function normOptions(norms, current) {
        var html = [];
        for (var i = 0; i < norms.length; i++) {
            var prefix = norms[i].item ? norms[i].item + '. ' : '';
            html.push('<option value="' + Format.html(norms[i].name) + '"'
                + (norms[i].name === current ? ' selected' : '') + '>'
                + Format.html(prefix + norms[i].name) + '</option>');
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

    function defaultReason(norm) {
        return 'СП 30.13330.2020 табл. А.2' + (norm.item ? ', п. ' + norm.item : '') + ' — ' + norm.name;
    }

    var NUMBERS = ['hours', 'usersDay', 'usersHour', 'fixtures', 'fixturesHot', 'lossPercent', 'q0Sewer'];
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

    function bindConsumerForm(c) {
        var inputs = formBox.querySelectorAll('[data-field]');

        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('change', function (event) {
                var f = event.target.getAttribute('data-field');
                apply(c, f, event.target);

                if (f === 'norm' || f === 'group') { render(); } else { renderForm(); }
                App.run();
            });
        }

        formBox.querySelector('[data-act="delete"]').addEventListener('click', function () {
            removeConsumer(c.id);
        });
    }

    function removeConsumer(id) {
        var project = App.project;
        var index = -1;

        for (var i = 0; i < project.consumers.length; i++) {
            if (project.consumers[i].id === id) { index = i; break; }
        }
        if (index < 0) return;

        for (var s = 0; s < project.sets.length; s++) {
            var members = project.sets[s].members;
            var at = members.indexOf(id);
            if (at >= 0) members.splice(at, 1);
        }

        var parentId = project.consumers[index].group;
        project.consumers.splice(index, 1);

        selected = parentId ? { kind: 'group', id: parentId } : null;
        render();
        App.run();
    }

    function renderExtraForm(e) {
        var html = [];
        html.push('<div class="card">');
        html.push('<div class="ctitle"><b>Прочий расход</b>'
            + '<button type="button" class="small danger" data-act="delete">Удалить</button></div>');

        html.push('<div class="form">');
        html.push(field('wide', 'Наименование', input('text', 'name', e.name)));
        html.push(field('wide', 'Папка', select_('group', groupOptions(null, e.group), Consumers.path(e.group, App.project))));
        html.push(field('', 'Единица', input('text', 'unit', e.unit)));
        html.push(field('', 'Количество', input('number', 'count', e.count)));
        html.push(field('', 'Норма, л/ед.', input('number', 'rate', e.rate)));
        html.push(field('', 'м³/сут (прямо)', input('number', 'm3day', e.m3day, Format.num(Consumers.extraDay(e)))));
        html.push(field('', 'л/с', input('number', 'ls', e.ls)));
        html.push('<label class="field chk"><input type="checkbox" data-field="inBalance"'
            + (e.inBalance ? ' checked' : '') + '> В баланс</label>');
        html.push(field('wide', 'Примечание', input('text', 'note', e.note)));
        html.push('</div></div>');

        formBox.innerHTML = html.join('');
        bindExtraForm(e);
    }

    function bindExtraForm(e) {
        var inputs = formBox.querySelectorAll('[data-field]');

        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('change', function (event) {
                var f = event.target.getAttribute('data-field');
                apply(e, f, event.target);
                if (f === 'group') render(); else renderForm();
                App.run();
            });
        }

        formBox.querySelector('[data-act="delete"]').addEventListener('click', function () {
            removeExtra(e.id);
        });
    }

    function removeExtra(id) {
        var project = App.project;
        var index = -1;

        for (var i = 0; i < project.extras.length; i++) {
            if (project.extras[i].id === id) { index = i; break; }
        }
        if (index < 0) return;

        var parentId = project.extras[index].group;
        project.extras.splice(index, 1);

        selected = parentId ? { kind: 'group', id: parentId } : null;
        render();
        App.run();
    }

    /* --- расчёт и баланс ---------------------------------------------------- */

    function run(node) {
        var project = App.project;
        var results = {};

        for (var i = 0; i < project.consumers.length; i++) {
            var c = project.consumers[i];
            results[c.id] = Consumers.run(c, node);
        }

        last = { results: results };

        showBalanceCache = null;
        renderBalance();
        return last;
    }

    var showBalanceCache = null;

    /*
        Баланс водопотребления и водоотведения — форма из 19 колонок.

        Обход дерева papok рекурсивный: у папки с потребителями/расходами прямо
        внутри — заголовок и «Итог по группе», у папки с вложенными папками —
        ещё и свой «Итог по «Путь»» после них, сумма которого не пересчитывается
        заново, а складывается из уже посчитанных строк (суточные объёмы льются
        напрямую, вероятность к ним отношения не имеет).
    */
    function balanceRows() {
        var project = App.project;
        var rows = [];
        var grand = blankSums();
        var numberRef = { n: 0 };
        var any = false;

        var roots = Consumers.roots(project);
        for (var i = 0; i < roots.length; i++) {
            if (walkBalance(roots[i].id, rows, grand, numberRef)) any = true;
        }

        var orphanGroups = {};
        for (i = 0; i < project.groups.length; i++) orphanGroups[project.groups[i].id] = true;

        var orphanCons = [];
        for (i = 0; i < project.consumers.length; i++) {
            if (!orphanGroups[project.consumers[i].group]) orphanCons.push(project.consumers[i]);
        }

        var orphanExtras = [];
        for (i = 0; i < project.extras.length; i++) {
            if (project.extras[i].inBalance && !orphanGroups[project.extras[i].group]) {
                orphanExtras.push(project.extras[i]);
            }
        }

        if (orphanCons.length || orphanExtras.length) {
            any = true;
            rows.push({ kind: 'group', name: 'Без папки' });
            var sums = blankSums();

            for (i = 0; i < orphanCons.length; i++) {
                numberRef.n++;
                var row = consumerRow(numberRef.n, orphanCons[i]);
                rows.push(row);
                addSums(sums, row);
                addSums(grand, row);
            }

            for (i = 0; i < orphanExtras.length; i++) {
                numberRef.n++;
                var erow = extraLine(numberRef.n, orphanExtras[i]);
                rows.push(erow);
                addSums(sums, erow);
                addSums(grand, erow);
            }

            rows.push(sumRow('Итог по группе «Без папки»', sums));
        }

        if (any) rows.push(sumRow('ИТОГО', grand));

        return rows;
    }

    /* Возвращает true, если в поддереве этой папки нашлось хоть что-то. */
    function walkBalance(groupId, rows, grand, numberRef) {
        var project = App.project;
        var label = Consumers.path(groupId, project);
        var direct = Consumers.consumersIn(groupId, project);
        var directExtras = [];

        var allExtras = Consumers.extrasIn(groupId, project);
        for (var k = 0; k < allExtras.length; k++) if (allExtras[k].inBalance) directExtras.push(allExtras[k]);

        var kids = Consumers.children(groupId, project);
        var i;

        var hasDirect = direct.length > 0 || directExtras.length > 0;
        var subtreeSums = blankSums();
        var any = false;

        if (hasDirect) {
            rows.push({ kind: 'group', name: 'Группа «' + label + '»' });
            var directSums = blankSums();

            for (i = 0; i < direct.length; i++) {
                numberRef.n++;
                var row = consumerRow(numberRef.n, direct[i]);
                rows.push(row);
                addSums(directSums, row);
                addSums(grand, row);
            }

            for (i = 0; i < directExtras.length; i++) {
                numberRef.n++;
                var erow = extraLine(numberRef.n, directExtras[i]);
                rows.push(erow);
                addSums(directSums, erow);
                addSums(grand, erow);
            }

            rows.push(sumRow('Итог по группе «' + label + '»', directSums));
            mergeSums(subtreeSums, directSums);
            any = true;
        }

        for (i = 0; i < kids.length; i++) {
            var childSums = walkBalance(kids[i].id, rows, grand, numberRef);
            if (childSums) { mergeSums(subtreeSums, childSums); any = true; }
        }

        // Папка-родитель с несколькими подпапками получает свой авто-итог
        // после них — суммой уже посчитанных строк, без нового обхода.
        if (kids.length > 0 && any) {
            rows.push(sumRow('Итог по «' + label + '»', subtreeSums));
        }

        return any ? subtreeSums : null;
    }

    function blankSums() {
        return {
            units: 0, total: 0, loss: 0, drained: 0,
            source: { city: 0, well: 0, tech: 0, recycle: 0 },
            drain: { household: 0, clean: 0, mineral: 0, chemical: 0, storm: 0 }
        };
    }

    function mergeSums(into, from) {
        into.units += from.units;
        into.total += from.total;
        into.loss += from.loss;
        into.drained += from.drained;
        for (var k in from.source) if (from.source.hasOwnProperty(k)) into.source[k] = (into.source[k] || 0) + from.source[k];
        for (var d in from.drain) if (from.drain.hasOwnProperty(d)) into.drain[d] = (into.drain[d] || 0) + from.drain[d];
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

    function renderBalance() {
        var rows = balanceRows();

        if (rows.length === 0) {
            balanceBox.innerHTML = '<p class="hint">Потребители не заданы.</p>';
            return;
        }

        var html = [];

        html.push('<div class="scroll"><table class="grid form">');
        html.push('<thead>');
        html.push('<tr>'
            + '<th rowspan="3">№ пот-<br>реби-<br>теля</th>'
            + '<th rowspan="3" class="l" style="min-width:240px">Наименование потребителя</th>'
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
        html.push('</thead><tbody>');

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            if (row.kind === 'group') {
                html.push('<tr class="group"><td colspan="19" class="l">'
                    + Format.html(row.name) + '</td></tr>');
                continue;
            }

            if (row.kind === 'sum') {
                html.push('<tr class="total">');
                html.push('<td></td><td class="l">' + Format.html(row.name) + '</td>');
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
            html.push('<td class="l">' + Format.html(row.name) + '</td>');
            html.push('<td>' + Format.html(row.process) + '</td>');
            html.push('<td>' + (row.hours > 0 ? Format.num(row.hours, 0) : '') + '</td>');
            html.push('<td>' + Format.num(row.units, 0) + '</td>');
            html.push('<td class="l small">' + Format.html(row.reason) + '</td>');
            html.push('<td>' + Format.num(row.rate) + '</td>');
            html.push('<td>' + Format.html(row.quality) + '</td>');
            html.push('<td><b>' + Format.num(row.total) + '</b></td>');
            html.push(sourceCells(single(row.source, row.total)));
            html.push('<td>' + (row.loss > 0 ? Format.num(row.loss) : '') + '</td>');
            html.push(drainCells(single(row.drain, row.drained)));
            html.push('</tr>');
        }

        html.push('</tbody></table></div>');

        balanceBox.innerHTML = html.join('');
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
