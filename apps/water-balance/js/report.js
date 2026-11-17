/*
    Сбор отчёта: одна модель — две выгрузки.

    Модель собирается один раз и отдаётся и в Excel, и в Word. Иначе через месяц
    выгрузки разойдутся: в одной колонку добавят, в другой забудут, и объяснять
    заказчику, почему в xlsx число есть, а в docx его нет, придётся инженеру.

    Строки «Основных показателей» строит Consumers.mainRows() — обходом дерева
    папок; тот же массив рисует на экране вкладка «Итоги» (ui-totals.js), так
    что расхождений между экраном и выгрузкой не бывает по построению.

    Формы взяты не с потолка, а с образцов, по которым сдают:

      «Баланс водопотребления и водоотведения» — 19 колонок, шапка в три уровня,
      строки группами с итогом по каждой и общим ИТОГО.

      «Основные показатели по системе водоснабжения и водоотведения» — каждый
      потребитель четырьмя строками В1 / Т3 / В1 общ. / К1, дальше итоги.

    Блоки:
      { kind: 'title', text }              заголовок раздела
      { kind: 'note',  text }              пояснение
      { kind: 'mono',  text }              строка разбора формул
      { kind: 'table', head, head2, rows, widths, total }
                                           head2 — второй уровень шапки

    Числа кладутся ЧИСЛАМИ. Excel их посчитает дальше, Word отформатирует по
    русским правилам сам — за это отвечает Docx.tableCell.
*/

var Report = (function () {
    'use strict';

    function today() {
        var d = new Date();
        var two = function (n) { return (n < 10 ? '0' : '') + n; };
        return two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' + d.getFullYear();
    }

    function head() {
        var project = App.project;
        var parts = [];

        if (project.object.name) parts.push('Объект: ' + project.object.name);
        if (project.object.address) parts.push('Адрес: ' + project.object.address);
        if (project.object.note) parts.push('Примечание: ' + project.object.note);

        parts.push('Дата: ' + today());
        parts.push('Коэффициент α снят ' + (project.alphaMode === 'node'
            ? 'по ближайшему большему узлу таблицы'
            : 'интерполяцией между узлами таблицы'));

        return parts.join('. ') + '.';
    }

    /* --- баланс водопотребления и водоотведения --------------------------- */

    /*
        Форма из 19 колонок. Шапка трёхуровневая, но в выгрузке она сводится к
        двум строкам: третий уровень раскрывается прямо в названиях колонок
        («Городская канализация — хозяйственно-бытовые»). Объединённых ячеек
        нет намеренно — их Excel не даёт ни отфильтровать, ни отсортировать, а
        выгрузку для того и открывают.
    */
    function balance() {
        var blocks = [];
        var rows = UiTree.balanceRows();

        blocks.push({ kind: 'title', text: 'Баланс водопотребления и водоотведения' });
        blocks.push({ kind: 'note', text: head() });

        if (rows.length === 0) {
            blocks.push({ kind: 'note', text: 'Потребители не заданы.' });
            return { name: 'Баланс', blocks: blocks };
        }

        var out = [];
        var totalFrom = -1;
        var i;

        for (i = 0; i < rows.length; i++) {
            var row = rows[i];

            if (row.kind === 'group') {
                out.push([row.name, '', '', '', '', '', '', '', '', '', '', '',
                    '', '', '', '', '', '', '']);
                continue;
            }

            if (row.kind === 'sum') {
                if (totalFrom < 0 && row.name === 'ИТОГО') totalFrom = out.length;

                out.push(['', row.name, '', '', row.sums.units, '', '', '',
                    row.sums.total]
                    .concat(sourceValues(row.sums.source))
                    .concat([row.sums.loss])
                    .concat(drainValues(row.sums.drain)));
                continue;
            }

            out.push([row.number, row.name, row.process, row.hours || '', row.units,
                row.reason, row.rate, row.quality, row.total]
                .concat(sourceValues(single(row.source, row.total)))
                .concat([row.loss > 0 ? row.loss : ''])
                .concat(drainValues(single(row.drain, row.drained))));
        }

        blocks.push({
            kind: 'table',
            head: ['№ потре-\nбителя', 'Наименование потребителя', 'Технологи-\nческий процесс',
                'Количество часов работы', 'Количество единиц оборудования',
                'Норма водопотребления — обоснование',
                'Расход на ед. оборуд., м³/сут наибольшего водопотребления',
                'Требуемое качество воды', 'Общее водопотребление, м³/сут',
                'Источники: городской водопровод', 'Источники: артезианские скважины',
                'Источники: технический водопровод', 'Источники: оборотно-повторные системы',
                'Безвозвратные потери, м³/сут',
                'Городская канализация: хозяйственно-бытовые',
                'Городская канализация: нормативно чистые',
                'Городская канализация: загрязнённые механич. минерал. примесями',
                'Городская канализация: загрязнённые химич. органич. и проч. примесями',
                'Водосток'],
            widths: [7, 40, 12, 10, 12, 26, 14, 11, 13, 12, 12, 12, 13, 12, 13, 12, 14, 14, 10],
            digits: 3,
            rows: out,
            total: totalFrom >= 0 ? totalFrom : undefined
        });

        blocks.push({
            kind: 'note',
            text: 'Суточные объёмы складываются напрямую: вероятность действия приборов '
                + 'к ним отношения не имеет. Секундные и часовые расходы сводятся по '
                + 'формулам (1) и (4) — см. лист «Расходы».'
        });

        return { name: 'Баланс', blocks: blocks };
    }

    function single(key, value) {
        var one = {};
        one[key] = value;
        return one;
    }

    function sourceValues(values) {
        var out = [];

        for (var i = 0; i < Consumers.SOURCES.length; i++) {
            var v = values[Consumers.SOURCES[i].id];
            out.push(v > 0 ? v : '');
        }

        return out;
    }

    function drainValues(values) {
        var out = [];

        for (var i = 0; i < Consumers.DRAINS.length; i++) {
            var v = values[Consumers.DRAINS[i].id];
            out.push(v > 0 ? v : '');
        }

        return out;
    }

    /* --- основные показатели ---------------------------------------------- */

    function main() {
        var blocks = [];
        var node = App.project.alphaMode === 'node';
        var built = Consumers.mainRows(App.project, node);

        blocks.push({
            kind: 'title',
            text: 'Основные показатели по системе водоснабжения и водоотведения'
        });
        blocks.push({ kind: 'note', text: head() });

        blocks.push({
            kind: 'table',
            head: ['Наименование потребителя\n(единицы измерения)', 'Кол-во потре-\nбителей сут.',
                'Норма водо-\nпотребления, л/сут', 'Расчётный расход, м³/сут',
                'Расчётный расход, м³/час', 'Расчётный расход, л/с', 'Примечание'],
            widths: [46, 14, 14, 13, 13, 12, 22],
            digits: [null, null, 0, 3, 3, 3, null],
            rows: built.rows,
            bold: built.bold,
            total: built.total
        });

        blocks.push({
            kind: 'note',
            text: 'Итоги — своды по формулам (1) и (4) СП 30.13330.2020, а не суммы: '
                + 'вероятность одновременного действия приборов у объекта в целом ниже, '
                + 'чем у каждой части. Суточные объёмы, наоборот, складываются.'
        });

        return { name: 'Расходы', blocks: blocks };
    }

    /*
        Word — ровно одна таблица по образцу, и ничего кроме.

        Ни балансовой формы, ни разбора формул, ни цветных заголовков: в
        записку вставляют именно эту таблицу, а всё остальное чистили бы руками.
        Кому нужен полный расчёт — тот берёт выгрузку в Excel, там четыре листа.

        Ширины колонок и шапка с объединениями — как в образце: 3681, 1106, 919,
        1129, 961, 1123, 1009 твипов при таблице шириной 9928.
    */
    function template() {
        var node = App.project.alphaMode === 'node';
        var built = Consumers.mainRows(App.project, node);

        return {
            name: 'Основные показатели',
            blocks: [
                {
                    kind: 'title',
                    text: 'Таблица 2 – Основные показатели по системе водоснабжения '
                        + 'и водоотведения.'
                },
                {
                    kind: 'table',
                    headRows: [
                        [
                            { t: 'Наименование потребителя (единицы измерения)', rows: 2 },
                            { t: 'Кол-во потре-бителей сут.', rows: 2 },
                            { t: 'Норма водо-потреб-ления, л/сут', rows: 2 },
                            { t: 'Расчетный расход', span: 3 },
                            { t: 'Примечание', rows: 2 }
                        ],
                        [
                            { t: 'м3/сут' },
                            { t: 'м3/час' },
                            { t: 'л/с' }
                        ]
                    ],
                    widths: [3681, 1106, 919, 1129, 961, 1123, 1009],
                    digits: [null, null, 0, 3, 3, 3, null],
                    rows: built.rows,
                    bold: built.bold,
                    total: built.total
                }
            ]
        };
    }

    /*
        Таблица 1 записки — «Исходные данные для расчёта»: по каждому потребителю три
        строки В1 общ / Т3 / В1 с нормой на сутки и в час наибольшего водопотребления и
        расходом воды прибором. Числа — из таблицы А.2 СП 30 (или нормы, заведённой в
        проекте), как в образце: 180 · 11,6 · 0,3 · 300 для жилого дома.
    */
    function inputsTable() {
        var rows = [];
        var bold = [];
        var seen = {};

        // Потребители с одной и той же нормой дают одну группу строк: в образце «Жилой дом»,
        // а не «С1», «С2», «С3». Имя группы — имя нормы; имя потребителя — если он один.
        var groups = [];

        App.project.consumers.forEach(function (c) {
            var g = Consumers.group(c);
            if (!g) return;

            var key = g.norm.name + '|' + g.norm.t;
            if (!seen[key]) {
                seen[key] = { norm: g.norm, names: [] };
                groups.push(seen[key]);
            }
            seen[key].names.push(g.name);
        });

        groups.forEach(function (one) {
            var n = one.norm;

            bold.push(rows.length);
            rows.push([one.names.length === 1 ? one.names[0] : n.name, '', '', '', '']);

            // числа как в образце — без хвостовых нулей: 180 · 11,6 · 0,3 · 300
            var s = function (v) { return String(Math.round(v * 1000) / 1000).replace('.', ','); };
            rows.push(['    В1 общ', s(n.qu), s(n.qhru), s(n.q0), s(n.q0hr)]);
            if (n.quh > 0) {
                rows.push(['    Т3', s(n.quh), s(n.qhruh), s(n.q0h), s(n.q0hrh)]);
                rows.push(['    В1', s(n.quc), s(n.qhruc), s(n.q0c), s(n.q0hrc)]);
            }
        });

        return {
            name: 'Исходные данные',
            blocks: [
                { kind: 'title', text: 'Таблица 1 – Исходные данные для расчёта.' },
                {
                    kind: 'table',
                    headRows: [
                        [
                            { t: 'Наименование системы', rows: 2 },
                            { t: 'Норма расхода в сутки наиб. водопотребления, л/сут', rows: 2 },
                            { t: 'Норма расхода воды в час наиб. водопотребления, л/ч', rows: 2 },
                            { t: 'Расход воды прибором', span: 2 }
                        ],
                        [{ t: 'л/с' }, { t: 'л/ч' }]
                    ],
                    widths: [3700, 2200, 2200, 914, 914],
                    aligns: ['left', 'center', 'center', 'center', 'center'],
                    rows: rows,
                    bold: bold
                }
            ]
        };
    }

    /* Состав выгрузки в Word: таблицы 1 и 2, а при наличии гидравлики — таблица насосов. */
    function wordSections() {
        var list = [inputsTable(), template()];

        if (typeof HydPumps !== 'undefined' && App.project.hyd) {
            try {
                var res = HydCalc.run(App.project.hyd, App.project.alphaMode === 'node');
                if (res && res.input && HydPumps.rows(res, App.project.hyd).length) {
                    var t = HydPumps.sheetOf(res, App.project.hyd);
                    t.blocks[0].text = 'Таблица 3';
                    list.push(t);
                }
            } catch (error) { /* гидравлика не считается — в записку идут первые две таблицы */ }
        }

        return list;
    }

    /* --- стояк канализации ------------------------------------------------ */

    function riser() {
        var blocks = [];
        var data = UiRiser.result();
        var input = App.project.riser;

        blocks.push({ kind: 'title', text: 'Канализационный стояк ' + input.mark
            + ' — проверка на срыв гидрозатворов' });
        blocks.push({ kind: 'note', text: head() });

        if (!data || !data.base) {
            blocks.push({ kind: 'note', text: 'Расчёт не выполнен: не заданы приборы, '
                + 'потребители или этажи.' });
            return { name: 'Стояк ' + input.mark, blocks: blocks };
        }

        blocks.push({ kind: 'note', text: 'Проверка сводится к сравнению расчётного расхода '
            + 'стоков с пропускной способностью стояка по приложению К: q_s ≤ q_К. '
            + 'Пропускная способность в приложении К получена из условия, что разрежение '
            + 'в стояке гидрозатворы не срывает.' });

        blocks.push({ kind: 'title', text: 'Исходные данные' });
        blocks.push({
            kind: 'table',
            head: ['Параметр', 'Значение'],
            widths: [46, 40],
            rows: [
                ['Норма по таблице А.2', data.input.norm.name],
                ['Способ расчёта', data.byFixtures
                    ? 'по приборам — вероятность одна на стояк'
                    : 'по потребителям — вероятность на каждом этаже'],
                ['Этажей на стояке', data.top],
                ['Высота этажа, м', input.floorHeightM],
                ['Высота стояка, м', data.heightM],
                ['Приборов на стояке всего N', data.totalFixtures],
                ['Потребителей на стояке всего U', data.totalUsers],
                ['Вероятность действия приборов P', data.P],
                ['Общее N·P', data.NP],
                ['Прибор с наибольшим водоотведением', data.set.worst || '—'],
                ['q0_s, л/с', data.set.q0Sewer],
                ['Материал стояка', input.material],
                ['Диаметр стояка, мм', input.riserMm],
                ['Диаметр поэтажного отвода, мм', input.branchMm],
                ['Угол присоединения отвода, °', input.angleDeg],
                ['Вытяжная часть', input.vented ? 'есть — стояк вентилируемый' : 'нет']
            ]
        });

        /*
            Приборы по участкам: у неоднородного стояка их несколько наборов, и
            один список «приборы на этаже» такой стояк не описывает.
        */
        var rows = [];
        var i, k;

        for (i = 0; i < input.sections.length; i++) {
            var section = input.sections[i];
            var span = 'с ' + section.from + ' по ' + section.to;

            for (k = 0; k < section.fixtures.length; k++) {
                var item = section.fixtures[k];
                var fixture = Tables.fixture(item.name);
                if (!fixture) continue;

                rows.push([k === 0 ? span : '', section.residents,
                    fixture.name, item.count, fixture.q0, fixture.qs, fixture.dyo]);
            }
        }

        blocks.push({ kind: 'title', text: 'Приборы по участкам стояка — таблица А.1' });
        blocks.push({
            kind: 'table',
            head: ['Этажи', 'Жильцов на этаж', 'Прибор', 'Штук на этаже',
                'q0, л/с', 'q0_s, л/с', 'Ø отвода, мм'],
            widths: [12, 12, 40, 12, 10, 10, 12],
            rows: rows
        });

        rows = [];

        for (i = 0; i < data.floors.length; i++) {
            var floor = data.floors[i];
            var own = data.layout[floor.floor - 1];

            rows.push([
                floor.floor, floor.above, own ? own.fixtures : 0,
                floor.fixtures, floor.residents,
                floor.P, floor.NP, floor.alpha, floor.table,
                floor.q, floor.qs,
                data.capacity > 0 ? data.capacity : '',
                data.capacity > 0 ? floor.qs / data.capacity : ''
            ]);
        }

        blocks.push({ kind: 'title', text: 'Расход стоков по этажам' });
        blocks.push({
            kind: 'table',
            head: ['Этаж', 'Этажей сверху', 'Приборов на этаже',
                'N приборов на этаже и выше', 'U жильцов на этаже и выше',
                'P', 'N·P', 'α', 'Табл.', 'q_tot, л/с', 'q_s, л/с', 'q_К, л/с', 'Загрузка'],
            widths: [8, 10, 11, 13, 13, 10, 9, 9, 8, 11, 11, 11, 10],
            rows: rows,
            total: rows.length - 1
        });

        blocks.push({ kind: 'note', text: 'Этажи нумеруются как в проекте: первый — нижний. '
            + 'Стояк собирает стоки сверху вниз, поэтому на каждом этаже он несёт приборы '
            + 'этого этажа и всех вышележащих, а расчётное сечение — основание, то есть '
            + 'первый этаж, последняя строка.' });

        blocks.push({ kind: 'title', text: 'Вывод' });

        if (!(data.capacity > 0)) {
            blocks.push({ kind: 'note', text: 'Пропускная способность не определена: '
                + data.capacitySource + '. Расчётный расход стоков у основания стояка q_s = '
                + Format.num(data.base.qs) + ' л/с.' });
        } else {
            blocks.push({
                kind: 'table',
                head: ['Величина', 'Значение', 'Единица'],
                widths: [56, 14, 12],
                rows: [
                    ['Расчётный расход стоков у основания стояка q_s', data.base.qs, 'л/с'],
                    ['Пропускная способность стояка q_К — приложение К', data.capacity, 'л/с'],
                    ['Загрузка стояка q_s / q_К', data.load, ''],
                    [data.passes
                        ? 'Стояк проходит: q_s ≤ q_К, разрежение гидрозатворы не срывает'
                        : 'Стояк НЕ проходит: q_s > q_К, разрежение сорвёт гидрозатворы',
                        '', '']
                ],
                total: 3
            });

            blocks.push({ kind: 'note', text: data.capacitySource + '.' });

            if (data.limit > 0) {
                blocks.push({ kind: 'note', text: 'В этом исполнении стояк принимает стоки '
                    + 'не более чем с ' + data.limit + ' этажей при заданном наборе приборов '
                    + 'и потребителей.' });
            }
        }

        if (data.options && data.options.length) {
            rows = [];

            var limit = Math.min(data.options.length, 20);

            for (var o = 0; o < limit; o++) {
                var option = data.options[o];

                rows.push([
                    option.vented ? 'есть' : 'нет', option.material,
                    option.riserMm, option.branchMm, option.angleDeg,
                    option.capacity, option.load
                ]);
            }

            blocks.push({ kind: 'title', text: 'Исполнения, которые проходят' });
            blocks.push({
                kind: 'table',
                head: ['Вытяжная часть', 'Материал', 'Ø стояка, мм', 'Ø отвода, мм',
                    'Угол, °', 'q_К, л/с', 'Загрузка'],
                widths: [14, 14, 12, 12, 10, 11, 11],
                rows: rows
            });
        }

        return { name: 'Стояк ' + input.mark, blocks: blocks };
    }

    /* --- разбор расчёта --------------------------------------------------- */

    function trace(title, source) {
        var blocks = [];

        blocks.push({ kind: 'title', text: title });

        if (!source || source.lines.length === 0) {
            blocks.push({ kind: 'note', text: 'Расчёт не выполнен.' });
            return blocks;
        }

        for (var i = 0; i < source.lines.length; i++) {
            var line = source.lines[i];

            if (line.kind === 'section') {
                blocks.push({ kind: 'title', text: line.text });
            } else if (line.kind === 'note') {
                blocks.push({ kind: 'note', text: line.text });
            } else if (line.kind === 'formula') {
                blocks.push({
                    kind: 'mono',
                    text: line.name + ' = ' + line.form
                        + (line.substitution ? ' = ' + line.substitution : '')
                        + ' = ' + Format.num(line.value) + (line.unit ? ' ' + line.unit : '')
                });
            } else if (line.kind === 'table') {
                blocks.push({
                    kind: 'mono',
                    text: line.name + ' = ' + Format.num(line.value)
                        + ' — по таблице ' + line.table + ' при ' + line.argument
                        + (line.node ? ', по ближайшему большему узлу' : ', интерполяция')
                });
            }
        }

        return blocks;
    }

    /*
        Разбор выгружается по КАЖДОМУ итогу, а не только по показанному на
        экране: на экране выбирают один, чтобы не листать, а в записку нужны
        все — эксперт проверяет каждую цифру таблицы.
    */
    function explanation() {
        var blocks = [];
        var totals = UiTotals.results();

        if (totals) {
            for (var i = 0; i < totals.totals.length; i++) {
                var total = totals.totals[i];
                if (!total.result) continue;

                blocks = blocks.concat(trace('Разбор: ' + total.set.name, total.result.trace));
            }
        }

        blocks = blocks.concat(trace('Разбор: стояк канализации', UiRiser.trace()));

        return { name: 'Разбор расчёта', blocks: blocks };
    }

    /* --- выгрузка --------------------------------------------------------- */

    function sections() {
        return [balance(), main(), riser(), explanation()];
    }

    function fileName(extension) {
        var project = App.project;

        var name = project.object.name
            || (project.name && project.name !== 'Без названия' ? project.name : 'Расчёт ВК по СП 30');

        return name + ' — ' + today() + '.' + extension;
    }

    function toExcel() {
        Xlsx.save(sections(), fileName('xlsx'));
    }

    /*
        В Word уходят таблицы образца (1, 2 и, если есть насосные установки, 3), без
        заголовка документа: их вставляют в готовую записку, где заголовок уже свой.
    */
    function toWord() {
        Docx.save(wordSections(), '', fileName('docx'));
    }

    return {
        sections: sections,
        template: template,
        inputsTable: inputsTable,
        wordSections: wordSections,
        fileName: fileName,
        balance: balance,
        main: main,
        toExcel: toExcel,
        toWord: toWord
    };
})();
