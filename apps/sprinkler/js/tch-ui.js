'use strict';

/*
    Рабочее место текстовой части: форма исходных данных слева, предпросмотр
    записки в центре, выгрузка в Word.

    Шаблон .docx загружается кнопкой один раз и хранится в файле проекта: при
    следующем открытии книги записка сразу собирается в вашу форму с рамкой и
    основной надписью. В память браузера шаблон не кладётся — только имя. Без
    шаблона записка собирается самостоятельным файлом теми же шрифтами.

    Каталожные листы насосных установок (.pdf) читаются здесь же: программа
    берёт из них марку, мощность, число насосов и фактическую рабочую точку и
    раскладывает по системам книги.
*/

var TchUI = (function () {

    var template = null;        // { name, zip, info }
    var restoring = false;
    var blocks = [];

    function $(id) { return document.getElementById(id); }
    function esc(t) { return Fmt.html(t); }

    function data() {
        return App.book ? App.book.text : null;
    }

    function valueText(v) {
        if (v === null || v === undefined || v === '') return '';
        return typeof v === 'number' ? Fmt.trim(v, 3) : String(v);
    }

    function field(label, key, value, unit) {
        return '<label class="field"><span>' + esc(label) + (unit ? ', ' + esc(unit) : '') + '</span>'
            + '<input type="text" data-key="' + key + '" value="' + esc(valueText(value)) + '"></label>';
    }

    /*
        Предел гидростатики ВПВ берётся из расчётов систем, а обоснование — из
        галочки «Есть СТУ»: без неё в записке нельзя ссылаться на СТУ, даже
        если здание высотное.
    */
    function hydroBlock(book, t) {
        var h = Tch.hydroLimit(book);
        var why = t.stu ? 'согласно СТУ'
            : Math.abs(h.value - 90) < 0.5 ? 'п. 6.2.20 СП 10.13130.2020'
                : 'согласно заданию на проектирование';

        return '<div class="inspector"><div class="row"><span>Предел гидростатики ВПВ</span><b>'
            + Fmt.num(h.value, 0) + ' м</b></div><div class="row"><span>Обоснование в тексте</span><b>'
            + esc(why) + '</b></div></div>'
            + '<p class="' + (h.values.length > 1 ? 'note-warn' : 'hint') + '">'
            + (h.values.length > 1
                ? 'У систем ВПВ пределы разные: ' + h.values.map(function (v) { return Fmt.num(v, 0); }).join(', ')
                    + ' м — в записку пойдёт больший.'
                : 'Берётся из расчёта ВПВ, раздел «Пределы». Ссылка на СТУ появляется только с галочкой '
                    + '«Есть СТУ» в исходных данных.')
            + '</p>';
    }

    function area(label, key, value, hint) {
        return '<label class="field"><span>' + esc(label) + '</span>'
            + '<textarea rows="3" data-key="' + key + '">' + esc(value) + '</textarea>'
            + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</label>';
    }

    function select(label, key, value, options) {
        return '<label class="field"><span>' + esc(label) + '</span><select data-key="' + key + '">'
            + options.map(function (o) {
                return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
            }).join('') + '</select></label>';
    }

    function check(label, key, checked) {
        return '<label class="check"><input type="checkbox" data-key="' + key + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }

    function section(title, body) {
        return '<fieldset class="section"><legend>' + esc(title) + '</legend>' + body + '</fieldset>';
    }

    function rowOf(list, id, role) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id !== id) continue;
            if (role === undefined || (list[i].role || 'main') === role) return list[i];
        }
        return null;
    }

    /* --- форма -------------------------------------------------------------- */

    function renderForm(book, t) {
        var info = Tch.systems(book);
        var tall = Tch.tall(book);

        var html = section('Том и объект',
            '<div class="pair">' + field('Шифр тома', 'obj:code', book.object.code)
            + field('Высота здания', 'obj:height', book.object.height || '', 'м') + '</div>'
            + '<p class="hint">' + (tall
                ? 'Выше 75 м: в записку войдут СП 550.1311500.2026, СП 477.1325800 и СП 253.1325800. СТУ — только по галочке «Есть СТУ».'
                : 'До 75 м: записка по СП 10.13130 и СП 485.1311500.') + '</p>'
            + '<div class="pair">' + field('Наименование объекта', 'obj:name', book.object.name)
            + field('Главный инженер проекта', 't:engineer', t.engineer) + '</div>');

        html += section('Исходные данные',
            area('Основания (по строке)', 't:basis', t.basis, 'Каждая строка станет пунктом перечня. Нормы СП добавляются сами.')
            + check('Есть СТУ', 't:stu', t.stu)
            + area('Дополнительные нормы (по строке)', 't:extraNorms', t.extraNorms));

        var guar = Tch.guaranteed(book);

        html += section('Ввод и насосная',
            area('Описание ввода', 't:inletText', t.inletText)
            + '<div class="inspector"><div class="row"><span>Гарантированный напор</span><b>'
            + Fmt.num(guar.value, 2) + ' м</b></div></div>'
            + '<p class="' + (guar.values.length > 1 ? 'note-warn' : 'hint') + '">'
            + (guar.values.length > 1
                ? 'У систем он разный: ' + guar.values.map(function (v) { return Fmt.num(v, 2); }).join(', ')
                    + ' м. На вводе напор один — поправьте исходные данные систем.'
                : 'Берётся из исходных данных систем — по нему и считается. Правится там же, '
                    + 'в «Гарантированный напор на вводе» каждой системы.')
            + '</p>'
            + field('Задвижки на вводе', 't:inletValves', t.inletValves)
            + '<div class="pair">' + field('Размещение насосной', 't:stationPlace', t.stationPlace)
            + field('Источник водоснабжения', 't:waterSource', t.waterSource) + '</div>');

        html += section('Здание',
            '<div class="pair">' + field('Тип здания', 't:buildingKind', t.buildingKind)
            + select('Паркинг', 't:parking', t.parking, [['нет', 'нет'], ['отапливаемый', 'отапливаемый'],
                ['неотапливаемый', 'неотапливаемый'], ['частично отапливаемый', 'частично отапливаемый']]) + '</div>'
            + area('Зоны (по строке)', 't:zonesText', t.zonesText)
            + check('Для автостоянки принимается один пожар (п. 5.6 СП 485)', 't:onePlace', t.onePlace)
            + '<div class="pair">' + field('Высота установки ПК', 't:valveHeight', t.valveHeight, 'м')
            + field('Время работы ПК', 't:pkTime', t.pkTime, 'ч') + '</div>'
            + field('Давление в воздухозаполненной сети', 't:airPressure', t.airPressure, 'МПа')
            + hydroBlock(book, t));

        var appendices = Appendix.list(book, info);
        var sheets = appendices.filter(function (e) {
            if (e.kind !== 'pump' && e.kind !== 'jockey') return false;
            var row = rowOf(t.pumps, e.owner, e.role);
            return row && row.file && row.file.data;
        }).length;
        var calcs = appendices.filter(function (e) { return e.kind === 'calc'; }).length;

        html += section('Пакетный вывод приложений',
            '<div class="actions">'
            + '<button data-action="tch-all-print">Все расчёты на печать / PDF…</button>'
            + '<button data-action="tch-sheets-pdf"' + (sheets ? '' : ' disabled') + '>Каталожные листы в PDF…</button>'
            + '</div>'
            + '<p class="hint">Расчётов в книге: <b>' + calcs + '</b> — они собираются в один поток печати по порядку '
            + 'номеров приложений, «Сохранить как PDF» в окне печати даёт один файл.</p>'
            + (sheets
                ? '<div class="pair">' + field('Отступ штампа справа', 't:stampRight', t.stampRight, 'мм')
                    + field('Отступ штампа сверху', 't:stampTop', t.stampTop, 'мм') + '</div>'
                : '')
            + '<p class="' + (sheets ? 'hint' : 'note-warn') + '">'
            + (sheets
                ? 'Каталожных листов с файлами: <b>' + sheets + '</b>. Они складываются в один PDF, и на каждой '
                    + 'странице в правом верхнем углу печатается «Приложение N». Отступы подвиньте, если надпись '
                    + 'попадает на логотип изготовителя.'
                : 'Файлов каталожных листов в книге нет: номера проставлять не на чем. Загрузите листы заново '
                    + 'в окне «Насосы…» — программа запомнит сами файлы и соберёт из них пакет.')
            + '</p>');

        html += section('Приложения и жокей-насос',
            '<div class="pair">' + field('Номер первого приложения', 't:appendixStart', t.appendixStart, '')
            + field('Запас жокея', 't:jockeyDelta', t.jockeyDelta, 'м') + '</div>'
            + '<p class="hint">Жокей: давление включения — напор после насосной установки (требуемый напор насоса плюс подпор на вводе) и запас; выключения — ещё на запас выше.</p>'
            + '<div class="appendix-list">' + appendices.map(function (e) {
                return '<div' + (e.ready ? '' : ' class="bad"') + '><b>Приложение ' + e.no + '</b> — ' + esc(e.title)
                    + (e.ready ? '' : ' <span class="dim">(лист не загружен)</span>') + '</div>';
            }).join('') + '</div>'
            + '<p class="hint">Номера раздаются сами и подряд: сначала каталожные листы насосных установок и жокей-насосов, '
            + 'дальше расчёты систем. Жокей включается галочкой в окне «Насосы…», листы грузятся туда же.</p>'
            + field('Мембранная ёмкость жокея', 't:jockeyMembrane', t.jockeyMembrane, 'л'));

        // Таблица насосов широкая — здесь только сводка, правка в отдельном окне.
        var pumpSummary = Tch.owners(info).map(function (item) {
            var main = rowOf(t.pumps, item.sys.id, 'main');
            var jockeys = t.pumps.filter(function (p) { return p.id === item.sys.id && (p.role || 'main') === 'jockey'; });
            return '<li><b>' + esc(item.sys.code) + '</b> — '
                + (main && main.name ? esc(main.name) : '<span class="dim">установка не задана</span>')
                + jockeys.map(function (j) { return '<br><span class="dim">жокей:</span> ' + esc(j.name || '—'); }).join('')
                + '</li>';
        }).join('');

        html += section('Насосное оборудование (таблица 4)',
            '<div class="actions"><button data-action="pw-open" class="primary">Таблица насосов…</button>'
            + '<button data-action="tch-sheets">Каталожные листы .pdf…</button></div>'
            + '<ul class="pump-summary">' + pumpSummary + '</ul>'
            + '<p class="hint">Таблица открывается в отдельном окне во всю ширину, с масштабом. Там же листы заменяются, убираются '
            + 'и загружаются заново, если насосы поменялись.</p>');

        var unitRows = info.apt.map(function (a) {
            var row = rowOf(t.units, a.sys.id) || {};
            var auto = Tch.unitTable({ apt: [a], vpv: [], all: [a] }, t)[0];
            function cell(f, v, placeholder) {
                return '<td><input class="cell wide" data-key="tu:' + a.sys.id + ':' + f + '" value="' + esc(valueText(v))
                    + '" placeholder="' + esc(placeholder) + '"></td>';
            }
            return '<tr><td>' + esc(a.sys.code) + '</td>' + cell('part', row.part, auto[0]) + cell('kind', row.kind, auto[1])
                + cell('cu', row.cu, auto[2]) + cell('note', row.note, '') + '</tr>';
        }).join('');

        html += section('Оборудование АПТ (таблица 5)',
            '<div class="table-wrap"><table class="grid"><thead><tr><th>Система</th><th>Часть здания</th><th>Тип системы</th>'
            + '<th>Узел управления</th><th>Примечание</th></tr></thead><tbody>' + unitRows + '</tbody></table></div>'
            + '<p class="hint">Пустые поля заполнятся сами из настроек системы: тип системы, узел управления, наличие насоса, жокея и эксгаустера.</p>');

        html += section('Дополнения',
            area('Абзацы в конец записки (по строке)', 't:extraText', t.extraText));

        var form = $('tchForm');
        var active = document.activeElement;
        var key = active && form.contains(active) && active.dataset ? active.dataset.key : null;
        var scroll = form.scrollTop;

        form.innerHTML = html;
        form.scrollTop = scroll;
        if (key) {
            var el = form.querySelector('[data-key="' + key.replace(/"/g, '\\"') + '"]');
            if (el) el.focus({ preventScroll: true });
        }
    }

    /* --- предпросмотр -------------------------------------------------------- */

    function preview(list) {
        return list.map(function (b) {
            switch (b.type) {
                case 'heading': return '<h2>' + esc(b.text) + '</h2>';
                case 'sub': return '<h3>' + esc(b.text) + '</h3>';
                case 'caption': return '<p class="r-caption">' + esc(b.text) + '</p>';
                case 'list': return '<ul>' + b.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
                case 'break': return '<hr>';
                case 'table':
                    return '<table class="report-table">'
                        + (b.head ? '<thead><tr>' + b.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead>' : '')
                        + '<tbody>' + b.rows.map(function (r) {
                            return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
                        }).join('') + '</tbody></table>';
                default: return '<p>' + esc(b.text) + '</p>';
            }
        }).join('');
    }

    /* --- сборка и выгрузка ---------------------------------------------------- */

    function fileName(book) {
        return Storage.safeName(book.object.code || book.object.name || 'Записка',
            ' ' + (book.text.volume || 'ПБ3') + '.docx');
    }

    function entries(book) {
        return template
            ? Docx.graft(template.zip, blocks, true)
            : Docx.standalone(blocks);
    }

    function saveDocx() {
        try {
            Docx.save(entries(App.book), fileName(App.book));
            App.status(template
                ? 'Записка собрана по шаблону «' + template.name + '»: штампы и титульные листы из него.'
                : 'Записка собрана без шаблона — со своими стилями, без штампов.', 'done');
        } catch (e) {
            App.status('Не удалось собрать записку: ' + (e && e.message ? e.message : e), 'warn');
        }
    }

    /** Шаблон живёт в файле проекта: один раз загрузили — он всегда под рукой. */
    function useTemplate(name, bytes) {
        return Zip.read(bytes.buffer ? bytes.buffer : bytes).then(function (zip) {
            var info = Docx.templateInfo(zip);
            if (!info.ok) throw new Error('В файле нет word/document.xml.');
            template = { name: name, zip: zip, info: info };
            return template;
        });
    }

    function loadTemplate(file) {
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function () {
            var bytes = new Uint8Array(reader.result);
            useTemplate(file.name, bytes).then(function (tpl) {
                App.book.text.template = { name: file.name, data: Zip.toBase64(bytes) };
                App.afterEdit('шаблон записки');
                App.status('Шаблон «' + file.name + '» прочитан и сохранён в проекте: разделов ' + tpl.info.sections
                    + ', колонтитулов со штампом ' + tpl.info.headers + '.', 'done');
            }).catch(function (e) {
                App.status('Не удалось прочитать шаблон: ' + (e && e.message ? e.message : e), 'warn');
            });
        };
        reader.readAsArrayBuffer(file);
    }

    /** Шаблон из файла проекта — после открытия книги грузить заново не нужно. */
    function restoreTemplate() {
        var t = App.book.text;
        if (template || restoring || !t.template || !t.template.data) return;

        restoring = true;
        useTemplate(t.template.name, Zip.fromBase64(t.template.data)).then(function () {
            restoring = false;
            refresh();
        }).catch(function () {
            restoring = false;
        });
    }

    function refresh() {
        var book = App.book;
        var t = book.text;

        restoreTemplate();
        blocks = TchText.build(book, t);

        renderForm(book, t);
        $('tchPreview').innerHTML = '<div class="report">' + preview(blocks) + '</div>';
        $('tchTemplate').textContent = template ? template.name : (t.template ? t.template.name + ' — читается…' : 'не загружен');
        $('summary').innerHTML = '<span>Записка ' + esc(t.volume) + '</span><span>систем <b>' + book.systems.length + '</b></span>'
            + '<span>абзацев <b>' + blocks.length + '</b></span>';

        PumpWindow.refresh();
    }

    /* --- события -------------------------------------------------------------- */

    function apply(key, value) {
        var book = App.book;
        var t = book.text;
        var parts = key.split(':');

        if (parts[0] === 'obj') {
            if (parts[1] === 'height') book.object.height = Fmt.parse(value) || 0;
            else book.object[parts[1]] = String(value).trim();
            if (parts[1] === 'name') $('projectName').value = book.object.name;
            return;
        }

        if (parts[0] === 't') {
            var name = parts[1];
            if (typeof t[name] === 'boolean') t[name] = !!value;
            else if (typeof t[name] === 'number') {
                var num = Fmt.parse(value);
                if (num !== null) t[name] = num;
            } else {
                t[name] = String(value);
            }
            return;
        }

        // Насосы: tp:система:роль:поле, оборудование АПТ: tu:система:поле.
        if (parts[0] === 'tp') {
            var role = parts[2] === 'main' || parts[2] === 'jockey' ? parts[2] : 'main';
            var field = parts[3] || parts[2];
            var pump = rowOf(t.pumps, parts[1], role);

            if (!pump) {
                pump = { id: parts[1], role: role, name: '', zone: '', power: '', count: '', Qf: '', Hf: '', sheet: '' };
                t.pumps.push(pump);
            }

            if (field === 'system') pump.id = String(value);
            else if (field === 'dutyQ' || field === 'dutyH') pump[field] = Fmt.parse(value);
            else pump[field] = String(value).trim();
            return;
        }

        if (parts[0] === 'tu') {
            var unit = rowOf(t.units, parts[1]);
            if (!unit) {
                unit = { id: parts[1], part: '', kind: '', cu: '', pump: '', jockey: '', exhauster: '', note: '' };
                t.units.push(unit);
            }
            unit[parts[2]] = String(value).trim();
        }
    }

    function onChange(e) {
        var el = e.target;
        var key = el.dataset ? el.dataset.key : null;
        if (!key) return;

        var value = el.type === 'checkbox' ? el.checked : el.value;

        setTimeout(function () {
            apply(key, value);
            App.afterEdit('записка');
        }, 0);
    }

    /* --- пакет приложений ---------------------------------------------------- */

    /*
        Расчёты печатаются пакетом: все приложения книги собираются в один
        поток с разрывами страниц, и «Сохранить как PDF» в окне печати даёт
        один файл со всеми листами по порядку номеров.
    */
    function printAppendices() {
        var book = App.book;
        var list = Appendix.list(book).filter(function (e) { return e.kind === 'calc'; });

        if (!list.length) {
            App.status('Расчётов в книге нет.', 'warn');
            return;
        }

        var html = list.map(function (e) {
            var sys = Systems.find(book, e.sys);
            if (!sys) return '';
            return '<div class="report appendix-page">' + appendixHtml(sys, e) + '</div>';
        }).join('');

        $('printArea').innerHTML = html;
        App.status('Приложений в пакете: ' + list.length + '. В окне печати выберите «Сохранить как PDF» — '
            + 'листы пойдут по порядку номеров.');
        App.print();
    }

    /** Лист расчёта как в его рабочем месте: АПТ по плану, ВПВ или план этажа. */
    function appendixHtml(sys, entry) {
        if (sys.kind === 'vpv') {
            return VpvUI.appendix(sys, sys.vpv, Vpv.solve(sys.vpv, App.book));
        }

        if (sys.kind === 'floors') {
            // План этажа считается своим расчётом, а текст приложения —
            // сквозной, вместе с продолжением по стояку до ввода.
            var plan = Floors.findPlan(sys.floors, String(entry.key).split(':')[2]);
            if (!plan) return '';
            var pnet = Solver.solve(plan.project);
            return Report.html({
                project: plan.project, net: pnet, calc: Calc.build(plan.project, pnet),
                plan: { sys: sys.id, plan: plan.id, name: plan.name }
            });
        }

        var net = Solver.solve(sys.project);
        return Report.html({ project: sys.project, net: net, calc: Calc.build(sys.project, net) });
    }

    /*
        Каталожные листы: исходные .pdf складываются в один файл, и на каждой
        странице в правом верхнем углу печатается «Приложение N» — номер тот
        же, что в перечне приложений.
    */
    function sheetsPdf() {
        var book = App.book;
        var items = [];

        Appendix.list(book).forEach(function (e) {
            if (e.kind !== 'pump' && e.kind !== 'jockey') return;
            var row = rowOf(book.text.pumps, e.owner, e.role);
            if (!row || !row.file || !row.file.data) return;
            items.push({ bytes: Zip.fromBase64(row.file.data), stamp: 'Приложение ' + e.no, name: row.file.name });
        });

        if (!items.length) {
            App.status('Нет сохранённых файлов каталожных листов. Загрузите их заново в окне «Насосы…» — '
                + 'тогда программа сможет поставить номера приложений и собрать пакет.', 'warn');
            return;
        }

        App.status('Собираю пакет каталожных листов: ' + items.length + '…');

        PdfWrite.merge(items, { right: book.text.stampRight, top: book.text.stampTop }).then(function (bytes) {
            PdfWrite.save(bytes, Storage.safeName(book.object.name, ' — каталожные листы.pdf'));
            App.status('Пакет собран: ' + items.length + ' листов со штампом «Приложение N».', 'done');
        }).catch(function (err) {
            App.status('Пакет не собрался: ' + (err && err.message ? err.message : err), 'warn');
        });
    }

    function onClick(e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;

        switch (b.dataset.action) {
            case 'pw-open':
                PumpWindow.open();
                break;
            case 'tch-template':
                $('tchTemplateInput').click();
                break;
            case 'tch-docx':
                saveDocx();
                break;
            case 'tch-print':
                $('printArea').innerHTML = '<div class="report">' + preview(blocks) + '</div>';
                App.print();
                break;
            case 'tch-sheets':
                PumpWindow.pick();
                break;
            case 'tch-all-print':
                printAppendices();
                break;
            case 'tch-sheets-pdf':
                sheetsPdf();
                break;
            case 'tch-forget':
                template = null;
                App.book.text.template = null;
                App.afterEdit('шаблон записки');
                break;
        }
    }

    function init() {
        $('tchForm').addEventListener('change', onChange);
        $('tchMain').addEventListener('click', onClick);

        $('tchTemplateInput').addEventListener('change', function () {
            loadTemplate(this.files[0]);
            this.value = '';
        });
    }

    return {
        init: init,
        refresh: refresh,
        apply: apply,
        preview: function () { return preview(blocks); },
        blocks: function () { return blocks; },
        entries: entries
    };
})();
