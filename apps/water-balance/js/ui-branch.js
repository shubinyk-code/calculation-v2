/*
    Вкладка «По узлам» — ЕЩЁ ОДИН, отдельный расчёт, а не второе
    представление дерева потребителей с вкладки «Потребители».

    Перенесено из найденного в присланном архиве прототипа «Водобаланс»
    (dist/app.js + dist/report.js): секции — один уровень, без вложенности —
    и «расчётные узлы» — именованные наборы групп с флагом «не учитывать в
    итоге по комплексу». Математика — BranchCalc (то же ядро Tables/Demand,
    что и у дерева). Оформление переведено на стиль семьи (app.css), сама
    логика не менялась.

    Выгрузка в Word — не реконструкция по образцу, а правка НАСТОЯЩЕГО файла
    пользователя: js/word-template.js несёт исходный .docx в base64, сюда
    подставляются только строки таблицы (js/jszip.min.js — открыть, дописать,
    собрать обратно).
*/

var UiBranch = (function () {
    'use strict';

    var root, treeBox, nodesBox, metricsBox, contentBox, warningsBox;
    var titleEl, crumbEl, subtitleEl, deleteBtn, renameBtn;
    var editor, editForm, editorFields, editorTitle, deleteGroupBtn;

    var selected = 'all';      // 'all' | id секции | id узла
    var subtab = 'consumers';  // 'consumers' | 'composition' | 'calculation' | 'report'
    var editing = null;        // id редактируемой группы, null — новая

    function project() { return App.project.branch; }

    function init() {
        root = document.getElementById('tab-branch');
        treeBox = document.getElementById('branchSections');
        nodesBox = document.getElementById('branchNodes');
        metricsBox = document.getElementById('branchMetrics');
        contentBox = document.getElementById('branchContent');
        warningsBox = document.getElementById('branchWarnings');
        titleEl = document.getElementById('branchTitle');
        crumbEl = document.getElementById('branchCrumb');
        subtitleEl = document.getElementById('branchSubtitle');
        deleteBtn = document.getElementById('branchDelete');
        renameBtn = document.getElementById('branchRename');

        editor = document.getElementById('branchEditor');
        editForm = document.getElementById('branchEditForm');
        editorFields = document.getElementById('branchEditorFields');
        editorTitle = document.getElementById('branchEditorTitle');
        deleteGroupBtn = document.getElementById('branchDeleteGroup');

        document.getElementById('branchAddSection').addEventListener('click', addSection);
        document.getElementById('branchAddNode').addEventListener('click', addNode);
        renameBtn.addEventListener('click', renameSelected);
        document.getElementById('branchConsumersWord').addEventListener('click', exportConsumers);
        deleteBtn.addEventListener('click', deleteSelected);

        document.getElementById('branchCloseEditor').addEventListener('click', function () { editor.close(); });
        deleteGroupBtn.addEventListener('click', deleteGroup);
        editForm.addEventListener('submit', submitGroup);

        /* Один делегированный обработчик на весь блок вкладки — проще, чем
           перевешивать слушатели на каждой перерисовке дерева и узлов. */
        root.addEventListener('click', function (event) {
            var b = event.target.closest('[data-select],[data-edit],[data-subtab]');
            if (!b) return;

            if (b.dataset.select) { selected = b.dataset.select; render(); }
            if (b.dataset.edit) editGroup(b.dataset.edit);
            if (b.dataset.subtab) { subtab = b.dataset.subtab; render(); }
        });
    }

    function changed() {
        render();
        App.run();
    }

    /* --- имена и выборки --------------------------------------------------- */

    function sectionName(id) {
        var s = project().sections.find(function (x) { return x.id === id; });
        return s ? s.name : '';
    }

    function selectionName() {
        var p = project();
        if (selected === 'all') return p.name;
        var s = p.sections.find(function (x) { return x.id === selected; });
        if (s) return s.name;
        var n = p.nodes.find(function (x) { return x.id === selected; });
        return n ? n.name : p.name;
    }

    function normName(g) {
        var p = BranchCalc.PRESETS.find(function (x) { return x.id === g.preset; });
        return g.custom ? g.custom.name : (p ? p.name : 'Своя норма');
    }

    function consumerName(g) {
        return (g.comment && g.comment.trim()) || normName(g);
    }

    function dayUsers(g) { return g.Uday !== undefined && g.Uday !== null ? g.Uday : (g.U || 0); }
    function hourUsers(g) { return g.Uhour !== undefined && g.Uhour !== null ? g.Uhour : dayUsers(g); }

    function selectedGroups(includeDisabled) {
        var p = project();
        var node = p.nodes.find(function (n) { return n.id === selected; });

        if (node) return p.groups.filter(function (g) { return node.ids.indexOf(g.id) >= 0; });

        return p.groups.filter(function (g) {
            return (includeDisabled || g.enabled) && (selected === 'all' || g.section === selected);
        });
    }

    function groupsForNode(node) {
        var p = project();
        return p.groups.filter(function (g) { return node.ids.indexOf(g.id) >= 0; });
    }

    function complexGroups() {
        var p = project();
        var excluded = {};

        p.nodes.forEach(function (n) {
            if (n.excludeFromComplex) n.ids.forEach(function (id) { excluded[id] = true; });
        });

        return p.groups.filter(function (g) { return g.enabled && !excluded[g.id]; });
    }

    function safeResult(gs) {
        try { return BranchCalc.resultFor(gs); } catch (e) { return { error: e.message }; }
    }

    /* --- отрисовка ----------------------------------------------------------- */

    function render() {
        var p = project();

        titleEl.textContent = selectionName();
        crumbEl.textContent = selected === 'all'
            ? 'ОБЪЕКТ / ОБЩИЙ ИТОГ'
            : 'ОБЪЕКТ / ' + (p.nodes.some(function (n) { return n.id === selected; }) ? 'РАСЧЁТНЫЙ УЗЕЛ' : 'СЕКЦИЯ');

        var gs = selected === 'all' ? complexGroups() : selectedGroups();
        var r = safeResult(gs);

        subtitleEl.textContent = gs.length + ' потребителей · '
            + gs.reduce(function (s, g) { return s + dayUsers(g); }, 0) + ' чел. в сутки / '
            + gs.reduce(function (s, g) { return s + hourUsers(g); }, 0) + ' чел. в час'
            + (selected === 'all' ? ' · учтено в итоге по комплексу' : '');

        renderTree();
        renderNodes();
        warningsBox.innerHTML = r.error ? '<p class="note warning">' + Format.html(r.error) + '</p>' : '';
        renderMetrics(r);

        var selSection = p.sections.some(function (s) { return s.id === selected; });
        var selNode = p.nodes.some(function (n) { return n.id === selected; });

        renameBtn.textContent = selSection ? 'Переименовать секцию' : selNode ? 'Переименовать итог' : 'Переименовать расчёт';
        deleteBtn.classList.toggle('hidden', !(selSection || selNode));
        deleteBtn.textContent = selSection ? 'Удалить секцию' : 'Удалить итог';

        document.querySelectorAll('#branchSubtabs [data-subtab]').forEach(function (b) {
            b.classList.toggle('on', b.dataset.subtab === subtab);
        });

        if (subtab === 'consumers') renderConsumers();
        else if (subtab === 'composition') renderComposition();
        else if (subtab === 'calculation') renderCalculation(r);
        else renderReport();
    }

    /*
        Название — в собственном <span class="lbl"> с многоточием при переполнении
        и title-подсказкой: длинное имя нормы («Жилые дома с ваннами от 1500 мм,
        оборудованными душами») иначе разъезжалось бы на несколько строк вперемешку
        со счётчиком справа, вместо того чтобы аккуратно обрезаться.
    */
    function bitem(text, count, extraClass, dataAttr, dataValue) {
        return '<button type="button" class="bitem' + (extraClass ? ' ' + extraClass : '') + '" data-' + dataAttr + '="'
            + Format.html(dataValue) + '" title="' + Format.html(text) + '">'
            + '<span class="lbl">' + Format.html(text) + '</span>'
            + (count !== undefined ? '<em>' + Format.html(count) + '</em>' : '') + '</button>';
    }

    function renderTree() {
        var p = project();
        var html = [];

        html.push(bitem('▦ ' + p.name, undefined, selected === 'all' ? 'sel' : '', 'select', 'all'));

        p.sections.forEach(function (s) {
            var gs = p.groups.filter(function (g) { return g.section === s.id; });

            html.push(bitem('⌑ ' + s.name, gs.length, selected === s.id ? 'sel' : '', 'select', s.id));

            gs.forEach(function (g) {
                html.push(bitem(consumerName(g), dayUsers(g) + ' / ' + hourUsers(g),
                    'child' + (g.enabled ? '' : ' off'), 'edit', g.id));
            });
        });

        treeBox.innerHTML = '<div class="blist">' + html.join('') + '</div>';
    }

    function renderNodes() {
        var p = project();

        if (p.nodes.length === 0) {
            nodesBox.innerHTML = '<p class="hint small">Узлов пока нет.</p>';
            return;
        }

        var html = p.nodes.map(function (n) {
            return bitem('∑ ' + n.name + (n.excludeFromComplex ? ' ⊘' : ''), n.ids.length,
                selected === n.id ? 'sel' : '', 'select', n.id);
        });

        nodesBox.innerHTML = '<div class="blist">' + html.join('') + '</div>';
    }

    function renderMetrics(r) {
        var rows = [
            ['second', 'Максимальный секундный', 'л/с'],
            ['hour', 'Максимальный часовой', 'м³/ч'],
            ['day', 'Среднесуточный', 'м³/сут']
        ];

        metricsBox.innerHTML = rows.map(function (row, i) {
            var k = row[0], l = row[1], u = row[2];

            return '<div class="metric' + (i === 0 ? ' main' : '') + '"><div class="label">' + l + '</div>'
                + '<strong>' + (r.error ? '—' : Format.num(r.total[k], 3)) + '</strong><small>' + u + '</small>'
                + '<div class="split">ХВС ' + (r.error ? '—' : Format.num(r.cold[k], 3))
                + ' · ГВС ' + (r.error ? '—' : Format.num(r.hot[k], 3)) + '</div></div>';
        }).join('');
    }

    function renderConsumers() {
        var gs = selectedGroups(true);

        var rows = gs.map(function (g) {
            var r = safeResult([g]);

            return '<tr><td class="l"><strong>' + Format.html(consumerName(g)) + '</strong><br>'
                + '<small class="dim">' + Format.html(sectionName(g.section)) + ' · ' + Format.html(normName(g)) + '</small></td>'
                + '<td>' + dayUsers(g) + '</td><td>' + hourUsers(g) + '</td>'
                + '<td>' + (g.autoN ? '<span class="badge">N = Uчас</span>' : g.N) + '</td>'
                + '<td>' + (!g.enabled ? 'Исключено' : (r.error ? 'Проверьте данные' : Format.num(r.total.second, 3))) + '</td>'
                + '<td><button type="button" class="small" data-edit="' + Format.html(g.id) + '">Изменить</button></td></tr>';
        });

        contentBox.innerHTML = '<div class="ctitle"><div><b>Потребители</b><p class="hint" style="margin:2px 0 0">'
            + 'Норма выбирается по таблице А.2. Комментарий показывает проектное название.</p></div>'
            + '<button type="button" id="branchAddGroup" class="small primary">+ Потребитель</button></div>'
            + '<div class="scroll"><table class="grid"><thead><tr><th class="l">Потребитель / норма</th>'
            + '<th>Сутки</th><th>Час</th><th>N приборов</th><th>Общий, л/с</th><th></th></tr></thead>'
            + '<tbody>' + rows.join('') + '</tbody></table>'
            + (gs.length ? '' : '<div class="empty">Добавьте первого потребителя.</div>') + '</div>'
            + '<p class="hint" style="margin-top:8px">Суточный расход использует только численность «в сутки». '
            + 'Максимальные секундный и часовой расходы используют только численность «в час».</p>';

        document.getElementById('branchAddGroup').addEventListener('click', function () { editGroup(); });
    }

    function renderComposition() {
        var p = project();
        var node = p.nodes.find(function (n) { return n.id === selected; });
        var groups = node ? p.groups : selectedGroups(true);

        var html = ['<div class="ctitle"><div><b>Что входит в «' + Format.html(selectionName()) + '»</b>'
            + '<p class="hint" style="margin:2px 0 0">' + (node
                ? 'Отметьте потребителей, которые входят в этот итог.'
                : 'Галочка включает потребителя в расчёт объекта и всех его итогов.') + '</p></div>'
            + (node ? '<button type="button" id="branchRemoveNode" class="small danger">Удалить итог</button>' : '') + '</div>'];

        if (node) {
            html.push('<label class="check" style="margin-bottom:10px"><input id="branchExcludeComplex" type="checkbox"'
                + (node.excludeFromComplex ? ' checked' : '') + '> Не учитывать потребителей этого итога в «Итого по комплексу»</label>'
                + '<p class="hint">Итог остаётся отдельным расчётом и попадает в Word. Даже если потребитель ниже отмечен '
                + 'как исключённый из объекта, в этот итог он входит и рассчитывается.</p>');
        }

        html.push(groups.map(function (g) {
            var checked = node ? node.ids.indexOf(g.id) >= 0 : g.enabled;
            var note = !g.enabled ? (node ? ' · входит только в этот итог' : ' · исключён из объекта') : '';

            return '<label class="groupcheck"><input type="checkbox" data-member="' + Format.html(g.id) + '"'
                + (checked ? ' checked' : '') + '><span><strong>' + Format.html(consumerName(g)) + '</strong><br>'
                + '<small>' + Format.html(sectionName(g.section)) + note + '</small></span>'
                + '<span>' + dayUsers(g) + ' / ' + hourUsers(g) + ' чел.</span></label>';
        }).join(''));

        html.push('<p class="hint" style="margin-top:8px">Итог — это набор исходных потребителей. Состав отдельного '
            + 'итога и состав комплекса рассчитываются независимо.</p>');

        contentBox.innerHTML = html.join('');

        document.querySelectorAll('#branchContent [data-member]').forEach(function (x) {
            x.addEventListener('change', function () {
                var g = p.groups.find(function (g) { return g.id === x.dataset.member; });

                if (node) {
                    if (x.checked && node.ids.indexOf(g.id) < 0) node.ids.push(g.id);
                    else if (!x.checked) node.ids = node.ids.filter(function (id) { return id !== g.id; });
                } else {
                    g.enabled = x.checked;
                }

                changed();
            });
        });

        if (node) {
            document.getElementById('branchExcludeComplex').addEventListener('change', function (e) {
                node.excludeFromComplex = e.target.checked;
                changed();
            });

            document.getElementById('branchRemoveNode').addEventListener('click', function () {
                if (!window.confirm('Удалить этот итог? Потребители сохранятся.')) return;
                p.nodes = p.nodes.filter(function (n) { return n !== node; });
                selected = 'all';
                changed();
            });
        }
    }

    function renderCalculation(r) {
        var rowsDef = [
            ['N', 'Число приборов'], ['q0', 'q₀, л/с'], ['P', 'Вероятность P'], ['NP', 'N × P'],
            ['q0hr', 'q₀,hr, л/ч'], ['Ph', 'Вероятность Phr'], ['NPh', 'N × Phr']
        ];

        var body = r.error ? Format.html(r.error) : (
            '<div class="scroll"><table class="grid"><thead><tr><th class="l">Параметр</th>'
            + '<th>ХВС</th><th>ГВС</th><th>Общий</th></tr></thead><tbody>'
            + rowsDef.map(function (row) {
                var k = row[0], l = row[1];
                return '<tr><td class="l">' + l + '</td>' + ['cold', 'hot', 'total'].map(function (c) {
                    return '<td>' + Format.num(r[c][k], k === 'N' ? 0 : 5) + '</td>';
                }).join('') + '</tr>';
            }).join('')
            + '<tr><td class="l">α / таблица</td>' + ['cold', 'hot', 'total'].map(function (c) {
                return '<td>' + Format.num(r[c].a.value, 5) + ' / ' + r[c].a.table + '</td>';
            }).join('') + '</tr>'
            + '<tr><td class="l">αhr / таблица</td>' + ['cold', 'hot', 'total'].map(function (c) {
                return '<td>' + Format.num(r[c].ah.value, 5) + ' / ' + r[c].ah.table + '</td>';
            }).join('') + '</tr></tbody></table></div>'
        );

        contentBox.innerHTML = '<div class="ctitle"><div><b>Проверяемый расчёт</b>'
            + '<p class="hint" style="margin:2px 0 0">СП 30.13330.2020, раздел 5, приложения А и Б.</p></div></div>'
            + body
            + '<p class="trace" style="margin-top:10px">Pᵢ = qhr,u,ᵢ × Uᵢ / (3600 × q₀,ᵢ × Nᵢ)<br>'
            + 'q₀ = Σ(q₀,ᵢ × Nᵢ × Pᵢ) / Σ(Nᵢ × Pᵢ)<br>P = Σ(Nᵢ × Pᵢ) / ΣNᵢ<br>q = 5 × q₀ × α<br>'
            + 'qhr = 0,005 × q₀,hr × αhr<br>Qсут = Σ(qсут,u,ᵢ × Uᵢ) / 1000</p>'
            + '<p class="hint">Таблица Б.1: двойная интерполяция по N и P. Таблица Б.2: интерполяция по NP. '
            + 'Округление выполняется только при отображении.</p>'
            + '<p class="hint">К1 в балансе: суточный и часовой расход для подключённых к канализации групп. '
            + 'Секундный расход канализационного стояка или выпуска — отдельная расчётная схема (вкладка '
            + '«Стояки канализации»), здесь не подменяется расходом воды.</p>';
    }

    /* --- строки отчёта и выгрузка в Word ------------------------------------ */

    /*
        Общее ядро строк отчёта для ДВУХ выгрузок сразу: в Word (правкой
        настоящего файла, числа нужны СТРОКОЙ по-русски — «5,599») и в Excel
        (числа нужны ЧИСЛОМ, чтобы книгу можно было считать дальше). numFmt
        решает, во что превращается число; для Word это Format.num, для Excel —
        тождественная функция, оставляющая число числом.
    */
    function buildRows(numFmt) {
        var p = project();
        var rows = [];

        function add(name, gs) {
            if (!gs.length) return;

            var r = BranchCalc.resultFor(gs);
            var U = gs.reduce(function (s, g) { return s + dayUsers(g); }, 0);
            var Uh = gs.reduce(function (s, g) { return s + hourUsers(g); }, 0);

            rows.push({ kind: 'group', cells: [name, U === Uh ? String(U) : U + ' / ' + Uh, '', '', '', '', ''] });

            [['cold', 'В1'], ['hot', 'Т3'], ['total', 'В1 общ.']].forEach(function (pair) {
                var c = pair[0], label = pair[1];
                var norm = gs.length === 1 ? BranchCalc.parameters(gs[0], c).day : null;

                rows.push({
                    kind: 'data',
                    cells: [label, '', norm === null ? '' : numFmt(norm, 1),
                        numFmt(r[c].day, 3), numFmt(r[c].hour, 3), numFmt(r[c].second, 3), '']
                });
            });

            var sewerGroups = gs.filter(function (g) { return g.sewer; });
            var sr = BranchCalc.resultFor(sewerGroups).total;

            rows.push({
                kind: 'data',
                cells: ['К1', '', gs.length === 1 ? numFmt(BranchCalc.parameters(gs[0], 'total').day, 1) : '',
                    numFmt(sr.day, 3), numFmt(sr.hour, 3), numFmt(sr.second, 3), 'Баланс']
            });
        }

        p.sections.forEach(function (s) {
            var gs = p.groups.filter(function (g) { return g.section === s.id && g.enabled; });
            if (p.settings.details) gs.forEach(function (g) { add(consumerName(g) + ' — ' + s.name, [g]); });
            if (p.settings.sections) add('Итого — ' + s.name, gs);
        });

        p.nodes.forEach(function (n) { if (n.report) add(n.name, groupsForNode(n)); });

        add('Итого по комплексу', complexGroups());

        if (p.settings.fire) {
            rows.push({ kind: 'group', cells: ['Пожаротушение', '', '', '', '', '', ''] });

            [['Жилой дом — внутреннее', 'fireHome'], ['Паркинг — внутреннее', 'fireParking'],
                ['Наружное пожаротушение', 'fireOuter']].forEach(function (row) {
                rows.push({ kind: 'data', cells: [row[0], '', '', '', '', numFmt(p.settings[row[1]], 3), 'Задано проектом'] });
            });
        }

        if (p.settings.heat) {
            var r = BranchCalc.resultFor(p.groups.filter(function (g) { return g.enabled; }));
            var q = Demand.heat(r.hot.hour, p.settings.hotTemp, p.settings.coldTemp, p.settings.heatLoss);

            rows.push({
                kind: 'heat',
                cells: ['Нагрузка ГВС', 'Q=1,16×' + Format.num(r.hot.hour, 3) + '×(' + p.settings.hotTemp + '−'
                    + p.settings.coldTemp + ')+' + Format.num(p.settings.heatLoss, 3) + '=' + Format.num(q, 3) + ' кВт']
            });
        }

        return rows;
    }

    function identity(v) { return v; }

    function reportRows() { return buildRows(Format.num); }
    function excelRows() { return buildRows(identity); }

    /*
        Выгрузка в Excel — тот же расчёт, что и в предпросмотре и в Word, но
        числами, а не строками: книгу открывают, чтобы считать дальше, а не
        просто посмотреть. Один лист «По узлам», без объединений и цветных
        заголовков — как и лист «Расходы» у дерева потребителей.
    */
    function exportExcel() {
        try {
            var rows = excelRows();
            var bold = [];
            var out = [];

            rows.forEach(function (r, i) {
                if (r.kind === 'group') bold.push(i);
                out.push(r.cells);
            });

            var p = project();

            Xlsx.save([{
                name: 'По узлам',
                blocks: [
                    { kind: 'title', text: p.name + ' — расчёт по секциям и узлам' },
                    { kind: 'note', text: 'СП 30.13330.2020, раздел 5. Секции и расчётные узлы — вкладка «По узлам».' },
                    {
                        kind: 'table',
                        head: ['Наименование', 'Кол-во потребителей сут. / час', 'Норма, л/сут',
                            'Расход, м³/сут', 'Расход, м³/ч', 'Расход, л/с', 'Примечание'],
                        widths: [46, 16, 12, 12, 12, 10, 20],
                        digits: [null, null, 1, 3, 3, 3, null],
                        rows: out,
                        bold: bold
                    }
                ]
            }], (p.name || 'Расчёт').replace(/[\\\/:*?"<>|]/g, '-') + ' — по узлам.xlsx');

            App.say('Выгружено в Excel', 'done');
        } catch (e) {
            App.say('Выгрузка в Excel не удалась: ' + e.message, 'fail');
        }
    }

    function renderReport() {
        var p = project();
        var rows = [], error = '';

        try { rows = reportRows(); } catch (e) { error = e.message; }

        var checks = [['details', 'Расходы каждой группы'], ['sections', 'Промежуточные итоги секций'],
            ['fire', 'Пожаротушение отдельными строками'], ['heat', 'Тепловая нагрузка ГВС']];

        var left = '<div class="card"><h2>Состав отчёта</h2>'
            + '<p class="hint">Эти галочки управляют обеими выгрузками сразу — и Word, и Excel. '
            + 'В Word меняются только числа в строках вашего файла-образца: шрифты, объединения '
            + 'ячеек и поля страницы остаются как в оригинале. В Excel те же строки, но числа — '
            + 'числами, чтобы книгу можно было считать дальше.</p>'
            + checks.map(function (row) {
                return '<label class="check"><input type="checkbox" data-setting="' + row[0] + '"'
                    + (p.settings[row[0]] ? ' checked' : '') + '> ' + row[1] + '</label>';
            }).join('')
            + '<h3 style="margin-top:16px">Вывести расчётные узлы</h3>'
            + p.nodes.map(function (n) {
                return '<label class="check"><input data-report-node="' + Format.html(n.id) + '" type="checkbox"'
                    + (n.report ? ' checked' : '') + '> ' + Format.html(n.name) + '</label>';
            }).join('')
            + '<p class="hint">К1 пока выводится только как балансный расход. Расчёт стояков и выпусков — '
            + 'отдельная вкладка «Стояки канализации».</p>'
            + '<div class="row" style="margin-top:8px">'
            + '<button type="button" id="branchExport" class="primary">↓ Скачать Word по вашему шаблону</button>'
            + '<button type="button" id="branchExportExcel">↓ Скачать Excel</button>'
            + '</div></div>';

        var settingFields = [['fireHome', 'Жилой дом, л/с'], ['fireParking', 'Паркинг, л/с'], ['fireOuter', 'Наружное, л/с'],
            ['hotTemp', 'Температура ГВС, °C'], ['coldTemp', 'Температура ХВС, °C'], ['heatLoss', 'Теплопотери, кВт']];

        var right = '<div class="card"><h2>Дополнительные параметры</h2>'
            + '<p class="hint">Пожарные расходы вводятся по проекту; СП 30 не определяет их величину автоматически.</p>'
            + '<div class="columns">' + settingFields.map(function (f) {
                return '<label class="field">' + f[1] + '<input data-setting="' + f[0] + '" type="number" min="0" step="any" value="'
                    + Format.plain(p.settings[f[0]]) + '"></label>';
            }).join('') + '</div>'
            + '<p class="hint">Q = 1,16 × qhr,h × (tг − tх) + Qпотерь, п. 5.12.</p></div>';

        var preview = error ? '<p class="note warning">' + Format.html(error) + '</p>' : (
            '<div class="scroll"><table class="grid"><thead><tr><th class="l">Потребитель</th>'
            + '<th>U сут. / час</th><th>Норма</th><th>м³/сут</th><th>м³/ч</th><th>л/с</th><th class="l">Примечание</th></tr></thead>'
            + '<tbody>' + rows.map(function (r) {
                return '<tr class="' + (r.kind === 'group' ? 'group' : '') + '">' + r.cells.map(function (c, i) {
                    return '<td' + (i === 0 ? ' class="l"' : '') + '>' + Format.html(c) + '</td>';
                }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>'
        );

        contentBox.innerHTML = '<div class="columns">' + left + right + '</div>'
            + '<div class="card"><div class="ctitle"><div><b>Содержимое отчёта</b>'
            + '<p class="hint" style="margin:2px 0 0">Предпросмотр данных. Оформление в Word — из вашего образца.</p></div></div>'
            + preview + '</div>';

        document.querySelectorAll('#branchContent [data-setting]').forEach(function (x) {
            x.addEventListener('change', function () {
                var value = x.type === 'checkbox' ? x.checked : Number(x.value);

                if (x.type === 'number' && (!isFinite(value) || value < 0)) {
                    App.say('Введите неотрицательное число.', 'fail');
                    return;
                }

                p.settings[x.dataset.setting] = value;
                changed();
            });
        });

        document.querySelectorAll('#branchContent [data-report-node]').forEach(function (x) {
            x.addEventListener('change', function () {
                p.nodes.find(function (n) { return n.id === x.dataset.reportNode; }).report = x.checked;
                changed();
            });
        });

        document.getElementById('branchExport').addEventListener('click', exportDocx);
        document.getElementById('branchExportExcel').addEventListener('click', exportExcel);
    }

    var WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    function writeCell(cell, text) {
        var texts = cell.getElementsByTagNameNS(WNS, 't');

        if (texts.length) {
            texts[0].textContent = text;
            for (var i = 1; i < texts.length; i++) texts[i].textContent = '';
            return;
        }

        var p = cell.getElementsByTagNameNS(WNS, 'p')[0];
        if (!p) { p = cell.ownerDocument.createElementNS(WNS, 'w:p'); cell.appendChild(p); }

        var r = cell.ownerDocument.createElementNS(WNS, 'w:r');
        var t = cell.ownerDocument.createElementNS(WNS, 'w:t');
        t.textContent = text;
        r.appendChild(t);
        p.appendChild(r);
    }

    /*
        Word собирается не с нуля, а правкой настоящего файла: строка-образец
        клонируется под каждую строку отчёта, а её ячейки просто переписываются
        новым текстом. Оформление — шрифты, объединения, поля страницы —
        достаётся из самого файла и не пересобирается.
    */
    async function makeDocx() {
        var p = project();

        if (p.settings.heat && p.settings.hotTemp <= p.settings.coldTemp) {
            throw new Error('Температура ГВС должна быть выше температуры ХВС.');
        }

        var rows = reportRows();
        if (!p.groups.some(function (g) { return g.enabled; })) throw new Error('Добавьте потребителей в расчёт.');

        var zip = await JSZip.loadAsync(TEMPLATE_BASE64, { base64: true });
        var xml = await zip.file('word/document.xml').async('string');
        var doc = new DOMParser().parseFromString(xml, 'application/xml');

        if (doc.querySelector('parsererror')) throw new Error('Не читается XML шаблона.');

        var table = doc.getElementsByTagNameNS(WNS, 'tbl')[0];
        var trs = Array.prototype.filter.call(table.children, function (n) { return n.localName === 'tr'; });

        var titleRow = trs[2].cloneNode(true);
        var groupRow = trs[3].cloneNode(true);
        var dataRow = trs[4].cloneNode(true);
        var heatRow = trs[64].cloneNode(true);

        for (var i = 2; i < trs.length; i++) trs[i].remove();

        writeCell(titleRow.getElementsByTagNameNS(WNS, 'tc')[0], p.name);
        table.appendChild(titleRow);

        rows.forEach(function (row) {
            var template = row.kind === 'group' ? groupRow : (row.kind === 'heat' ? heatRow : dataRow);
            var tr = template.cloneNode(true);
            var cells = Array.prototype.filter.call(tr.children, function (n) { return n.localName === 'tc'; });

            cells.forEach(function (c, idx) { writeCell(c, row.cells[idx] || ''); });
            table.appendChild(tr);
        });

        zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));

        return zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            compression: 'DEFLATE'
        });
    }

    function download(blob, name) {
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url; a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    }

    /* Норма группы в виде строки таблицы А.2 (как в BranchCalc.resultFor): готовая норма или своя. */
    function normOf(g) {
        var c = g.custom;
        if (c) {
            return {
                name: c.name, unit: c.unit, ref: 'норма задана в проекте',
                qu: c.day, quh: c.hotDay, quc: c.day - c.hotDay,
                qhru: c.hour, qhruh: c.hotHour, qhruc: c.hour - c.hotHour,
                q0: c.q, q0h: c.qPart, q0c: c.qPart,
                q0hr: c.qhr, q0hrh: c.qhrPart, q0hrc: c.qhrPart
            };
        }

        var preset = BranchCalc.PRESETS.find(function (x) { return x.id === g.preset; });
        return preset && preset.norm ? Object.assign({}, preset.norm, { name: preset.name, unit: preset.unit, ref: preset.ref }) : null;
    }

    /*
        Таблица «Потребители и нормы»: что введено в расчёт (включённые потребители выбранной секции,
        узла или всего объекта) и по каким нормам СП 30 (таблица А.2) он считается. По каждому
        потребителю — строка с числом потребителей и три строки В1 общ / Т3 / В1, как в таблице 1
        записки: норма на сутки и в час наибольшего водопотребления и расход воды прибором.
    */
    function consumersBlocks(gs) {
        var s = function (v) { return typeof v === 'number' && isFinite(v) ? String(Math.round(v * 1000) / 1000).replace('.', ',') : '—'; };
        var rows = [];
        var bold = [];

        // по разновидности: потребители с одной и той же нормой — одна группа строк, число потребителей складывается
        var kinds = [];
        var byKey = {};

        gs.forEach(function (g) {
            var n = normOf(g);
            if (!n) return;

            var key = n.name + '|' + (n.unit || '') + '|' + n.qu + '|' + n.qhru + '|' + n.quh;
            if (!byKey[key]) { byKey[key] = { n: n, day: 0, hour: 0, names: [] }; kinds.push(byKey[key]); }
            byKey[key].day += dayUsers(g);
            byKey[key].hour += hourUsers(g);
            byKey[key].names.push(consumerName(g));
        });

        kinds.forEach(function (k, i) {
            var n = k.n;

            // название нормы пишется один раз: в первом столбце, если там не оно, — то в последнем
            var title = k.names.length === 1 ? k.names[0] : n.name;
            var source = (title === n.name ? '' : n.name) + (title !== n.name && n.ref ? ' — ' : '') + (n.ref || '');

            bold.push(rows.length);
            rows.push([(i + 1) + '. ' + title, n.unit || '', k.day + ' / ' + k.hour, '', '', '', '', source]);

            rows.push(['    В1 общ', '', '', s(n.qu), s(n.qhru), s(n.q0), s(n.q0hr), '']);
            if (n.quh > 0) {
                rows.push(['    Т3', '', '', s(n.quh), s(n.qhruh), s(n.q0h), s(n.q0hrh), '']);
                rows.push(['    В1', '', '', s(n.quc), s(n.qhruc), s(n.q0c), s(n.q0hrc), '']);
            }
        });

        return {
            rows: rows,
            bold: bold,
            blocks: [
                { kind: 'title', text: 'Таблица – Потребители, принятые в расчёт, по разновидностям и нормы водопотребления (' + selectionName() + ').' },
                {
                    kind: 'table',
                    headRows: [
                        [
                            { t: 'Разновидность потребителя / система', rows: 2 },
                            { t: 'Единица измерения', rows: 2 },
                            { t: 'Всего потребителей сут. / час', rows: 2 },
                            { t: 'Норма расхода в сутки наиб. водопотребления, л/сут', rows: 2 },
                            { t: 'Норма расхода воды в час наиб. водопотребления, л/ч', rows: 2 },
                            { t: 'Расход воды прибором', span: 2 },
                            { t: 'Норма по СП 30.13330.2020', rows: 2 }
                        ],
                        [{ t: 'л/с' }, { t: 'л/ч' }]
                    ],
                    widths: [3000, 1100, 1300, 1300, 1300, 700, 700, 2600],
                    aligns: ['left', 'center', 'center', 'center', 'center', 'center', 'center', 'left'],
                    rows: rows,
                    bold: bold
                },
                { kind: 'note', text: 'Нормы — таблица А.2 СП 30.13330.2020 (или норма, заведённая в проекте). В1 общ — общая норма на хозяйственно-питьевые нужды, '
                    + 'Т3 — горячая вода, В1 — холодная вода. Суточный расход считается по числу потребителей «в сутки», секундный и часовой — «в час».' }
            ]
        };
    }

    function exportConsumers() {
        try {
            var gs = selectedGroups(false);
            if (!gs.length) { App.say('В выбранной секции нет потребителей, включённых в расчёт.', 'fail'); return; }

            var out = consumersBlocks(gs);
            var base = (project().name || 'Расчёт').replace(/[\\/:*?"<>|]/g, '-');

            Docx.save([{ name: 'Потребители и нормы', blocks: out.blocks }], '', base + ' — потребители и нормы.docx');
            App.say('Выгружено в Word: потребителей ' + gs.length + '.', 'done');
        } catch (e) {
            App.say('Выгрузка не удалась: ' + e.message, 'fail');
        }
    }

    function exportDocx() {
        makeDocx().then(function (blob) {
            download(blob, 'Расходы ' + project().name.replace(/[\\\/:*?"<>|]/g, '-') + '.docx');
            App.say('Word сформирован по вашему шаблону.', 'done');
        }).catch(function (e) {
            App.say('Выгрузка не удалась: ' + e.message, 'fail');
        });
    }

    /* --- редактор потребителя (диалог) --------------------------------------- */

    function field(label, name, value, type, extra) {
        return '<label class="field">' + Format.html(label) + '<input name="' + name + '" type="' + (type || 'number')
            + '" value="' + Format.html(value === undefined || value === null ? '' : value) + '" ' + (extra || '') + '></label>';
    }

    function editGroup(id) {
        var p = project();
        editing = id || null;

        var g = p.groups.find(function (g) { return g.id === id; }) || {
            section: p.sections.some(function (s) { return s.id === selected; }) ? selected : (p.sections[0] && p.sections[0].id),
            preset: 'bath', Uday: 1, Uhour: 1, N: 1, Nhot: 1, autoN: true, sewer: true, enabled: true
        };

        editorTitle.textContent = id ? 'Потребитель' : 'Новый потребитель';

        editorFields.innerHTML = '<div class="columns">'
            + '<label class="field">Секция<select name="section">' + p.sections.map(function (s) {
                return '<option value="' + Format.html(s.id) + '"' + (s.id === g.section ? ' selected' : '') + '>'
                    + Format.html(s.name) + '</option>';
            }).join('') + '</select></label>'
            + '<label class="field">Норма потребления<select name="preset">' + BranchCalc.PRESETS.map(function (pr) {
                var prefix = pr.item ? pr.item + '. ' : '';
                return '<option value="' + Format.html(pr.id) + '"' + (pr.id === g.preset ? ' selected' : '') + '>'
                    + Format.html(prefix + pr.name) + '</option>';
            }).join('') + '</select></label></div>'
            + field('Комментарий / пользовательское название', 'comment', g.comment || '', 'text', 'maxlength="100" placeholder="Например: Жилые помещения, секция 1"')
            + '<div class="columns">' + field('Количество потребителей в сутки', 'Uday', dayUsers(g), 'number', 'min="0" step="1" required')
            + field('Количество потребителей в час', 'Uhour', hourUsers(g), 'number', 'min="0" step="1" required') + '</div>'
            + '<p class="hint">Суточный расход рассчитывается по «в сутки». Секундный и максимальный часовой — по «в час».</p>'
            + '<label class="check"><input name="autoN" type="checkbox"' + (g.autoN ? ' checked' : '')
            + '> Количество приборов неизвестно — принять N = Uчас</label>'
            + '<div class="columns">' + field('Приборы ХВС / общий N', 'N', g.N, 'number', 'min="1" step="1"')
            + field('Приборы ГВС N', 'Nhot', g.Nhot, 'number', 'min="1" step="1"') + '</div>'
            + '<label class="check"><input name="sewer" type="checkbox"' + (g.sewer ? ' checked' : '') + '> Отвод стоков в К1</label>'
            + '<label class="check"><input name="enabled" type="checkbox"' + (g.enabled ? ' checked' : '') + '> Учитывать в расчёте объекта</label>'
            + '<div class="hint" id="branchNormPreview" style="margin-top:8px"></div>';

        var form = editForm;

        function preview() {
            var pr = BranchCalc.PRESETS.find(function (x) { return x.id === form.elements.preset.value; });

            // Длинную норму select обрезает многоточием без подсказки — title
            // отдаёт название целиком при наведении.
            form.elements.preset.title = pr.name;
            form.elements.section.title = form.elements.section.options[form.elements.section.selectedIndex].text;

            document.getElementById('branchNormPreview').textContent = 'Название потребителя: ' + pr.name + '. '
                + pr.ref + ' · ' + pr.unit + '. Норма: ' + Format.num(pr.day, 0) + ' л/сут общая, '
                + Format.num(pr.hotDay, 0) + ' л/сут ГВС; в максимальный час ' + Format.num(pr.hour, 1) + ' и '
                + Format.num(pr.hotHour, 1) + ' л/ч. Период ' + pr.T + ' ч.';

            form.elements.N.disabled = form.elements.Nhot.disabled = form.elements.autoN.checked;
        }

        form.elements.preset.onchange = preview;
        form.elements.autoN.onchange = preview;
        form.elements.section.onchange = preview;
        preview();

        deleteGroupBtn.hidden = !id;
        editor.showModal();
    }

    function deleteGroup() {
        if (!window.confirm('Удалить группу из всех расчётов?')) return;

        var p = project();
        p.groups = p.groups.filter(function (g) { return g.id !== editing; });
        p.nodes.forEach(function (n) { n.ids = n.ids.filter(function (id) { return id !== editing; }); });

        editor.close();
        changed();
    }

    function submitGroup(event) {
        event.preventDefault();

        var f = event.target.elements;
        var normal = BranchCalc.PRESETS.find(function (p) { return p.id === f.preset.value; });

        var g = {
            id: editing || Storage.id('bg'), name: normal.name, comment: f.comment.value.trim(),
            section: f.section.value, preset: f.preset.value, custom: null,
            Uday: Number(f.Uday.value), Uhour: Number(f.Uhour.value),
            N: Number(f.N.value), Nhot: Number(f.Nhot.value),
            autoN: f.autoN.checked, sewer: f.sewer.checked, enabled: f.enabled.checked,
            q0Sewer: 1.6
        };

        var r = safeResult([g]);
        if (r.error) { App.say(r.error, 'fail'); return; }

        var p = project();

        if (editing) {
            p.groups = p.groups.map(function (x) { return x.id === editing ? g : x; });
        } else {
            p.groups.push(g);
            var node = p.nodes.find(function (n) { return n.id === selected; });
            if (node) node.ids.push(g.id);
        }

        editor.close();
        changed();
    }

    /* --- секции, узлы, переименование, удаление ------------------------------ */

    function addSection() {
        var name = window.prompt('Название секции', 'Секция ' + (project().sections.length + 1));
        if (!name || !name.trim()) return;

        var id = Storage.id('bs');
        project().sections.push({ id: id, name: name.trim().slice(0, 100) });
        selected = id;
        changed();
    }

    function addNode() {
        var name = window.prompt('Название расчётного узла', 'Ввод 1');
        if (!name || !name.trim()) return;

        var id = Storage.id('bn');

        project().nodes.push({
            id: id, name: name.trim().slice(0, 100),
            ids: selectedGroups().map(function (g) { return g.id; }),
            excludeFromComplex: false, report: true
        });

        selected = id;
        subtab = 'composition';
        changed();
    }

    function renameSelected() {
        var p = project();
        var target = selected === 'all' ? p
            : (p.sections.find(function (s) { return s.id === selected; }) || p.nodes.find(function (n) { return n.id === selected; }));

        if (!target) return;

        var name = window.prompt('Название', target.name);
        if (!name || !name.trim()) return;

        target.name = name.trim().slice(0, 100);
        changed();
    }

    function deleteSelected() {
        var p = project();
        var section = p.sections.find(function (s) { return s.id === selected; });
        var node = p.nodes.find(function (n) { return n.id === selected; });

        if (section) {
            var count = p.groups.filter(function (g) { return g.section === section.id; }).length;

            if (count) {
                App.say('Сначала удалите или перенесите потребителей из этой секции.', 'fail');
                return;
            }

            if (!window.confirm('Удалить секцию «' + section.name + '»?')) return;

            p.sections = p.sections.filter(function (s) { return s !== section; });
            selected = 'all';
            changed();
            return;
        }

        if (node) {
            if (!window.confirm('Удалить итог «' + node.name + '»? Потребители сохранятся.')) return;

            p.nodes = p.nodes.filter(function (n) { return n !== node; });
            selected = 'all';
            changed();
        }
    }

    return {
        init: init,
        render: render
    };
})();
