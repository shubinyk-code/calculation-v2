'use strict';

/*
    Вывод: текст приложения с формулами, таблица участков, выгрузки.

    Текст повторяет лист «Вывод данных» калькулятора: те же слагаемые, в том
    же порядке, с подстановкой чисел. Проверяющему нужна подстановка, а не
    только итог, — чтобы пересчитать на калькуляторе, не залезая в программу.
*/

var Report = (function () {

    var HEAD = ['№ уч.', 'Напор Н, м вод. ст.', 'Удельн. хар-ка тр-да, Kт', 'Коэф. произв. оросит. k',
        'Расход Q, л/с', 'Ду, мм', 'Наружн. диаметр, мм', 'Толщ. стенки, мм', 'Материал трубы',
        'Скорость V, м/с', 'L, м', 'Потери ΔH, м'];

    /*
        На плане внутреннего пожаротушения в третьем и четвёртом столбцах стоят
        λ и Re: потери считаются по Дарси–Вейсбаху, а Kт и k — величины расчёта
        оросителей.
    */
    function headOf(project) {
        if (!project || project.settings.planKind !== 'vpv') return HEAD;
        var out = HEAD.slice();
        out[2] = 'Коэф. трения λ';
        out[3] = 'Re';
        return out;
    }

    function n2(v) { return Fmt.num(v, 2); }

    /** Строка таблицы как массив ячеек: числа — числами, для Excel. */
    function cells(row) {
        if (row.type === 'seg') {
            return [row.name, row.H, row.kt, row.k === null ? '' : row.k, row.Q,
                row.dn === null ? '' : row.dn, row.od, row.wall, row.material,
                row.V, row.L, row.dH];
        }
        if (row.type === 'summary') {
            return [row.name, row.Hk, '', '', row.Q, '', '', '', '', '', '', ''];
        }
        if (row.type === 'total') {
            return [row.name, row.H, '', '', row.Q, '', '', '', '', '', '', row.dH];
        }
        return [row.text];
    }

    function summaryText(row) {
        return row.sp
            ? 'Q = ' + n2(row.Qk) + '·√(' + n2(row.Hnode) + ' / ' + n2(row.Hk) + ') = ' + n2(row.Q) + ' л/с'
            : 'Q = ' + n2(row.Q) + ' л/с при H = ' + n2(row.Hnode) + ' м';
    }

    /**
        План этажа системы «АПТ по этажам» заканчивается врезкой в стояк, а не
        вводом. Чтобы расчёт был сквозным, к строкам плана добавляются участки
        стояка и магистрали до насосной.
    */
    /*
        Номер приложения берётся у той системы, чей расчёт сейчас печатается,
        а не у открытой в программе: пакетом приложения идут подряд, и каждое
        должно нести свой номер.
    */
    function appendixNo(app) {
        if (typeof App === 'undefined' || !App.book) return '';
        if (app.plan) return Appendix.of(App.book, 'plan:' + app.plan.sys + ':' + app.plan.plan);

        var own = null;
        App.book.systems.forEach(function (s) {
            if (s.project === app.project) own = s;
        });

        return Appendix.of(App.book, Appendix.keyOf(App.book, own || Systems.active(App.book)));
    }

    function riserPart(app) {
        if (!app.plan || !App.book) return null;

        var sys = Systems.find(App.book, app.plan.sys);
        if (!sys || !sys.floors) return null;

        var res = Floors.solve(sys.floors, App.book);
        var chain = Floors.chain(sys.floors, res, app.plan.plan);
        if (!chain) return null;

        return { sys: sys, v: sys.floors, res: res, chain: chain, planId: app.plan.plan };
    }

    /** Строки таблицы: у плана этажа — вместе с продолжением по стояку. */
    function rowsOf(app) {
        var part = riserPart(app);
        if (!part) return app.calc.rows;

        var rows = app.calc.rows.slice();
        rows.push({ type: 'group', text: 'Стояк и магистраль — от врезки этажа до насосной' });
        part.chain.rows.forEach(function (r) { rows.push(r); });
        rows.push({
            type: 'total',
            name: 'Итого',
            H: part.chain.atPump,
            Q: part.chain.rec.Qr,
            dH: part.chain.sumRaw
        });

        return rows;
    }

    function tableHtml(rows, project) {
        var byPlan = !!project && project.settings.planKind === 'vpv';
        var html = '<table class="report-table"><thead><tr>';
        headOf(project).forEach(function (h) { html += '<th>' + Fmt.html(h) + '</th>'; });
        html += '</tr></thead><tbody>';

        rows.forEach(function (r) {
            if (r.type === 'group') {
                html += '<tr class="r-group"><td colspan="12">' + Fmt.html(r.text) + '</td></tr>';
            } else if (r.type === 'seg') {
                html += '<tr><td>' + Fmt.html(r.name) + '</td><td>' + n2(r.H) + '</td><td>' + Fmt.kt(r.kt)
                    + '</td><td>' + (r.k === null ? '—' : byPlan ? Fmt.num(r.k, 0) : Fmt.trim(r.k, 3))
                    + '</td><td>' + n2(r.Q)
                    + '</td><td>' + (r.dn || '—') + '</td><td>' + Fmt.trim(r.od, 1) + '</td><td>' + Fmt.trim(r.wall, 1)
                    + '</td><td>' + Fmt.html(r.material) + '</td><td>' + n2(r.V) + '</td><td>' + n2(r.L)
                    + '</td><td>' + n2(r.dH) + '</td></tr>';
            } else if (r.type === 'summary') {
                html += '<tr class="r-summary"><td>' + Fmt.html(r.name) + '</td><td>' + n2(r.Hk)
                    + '</td><td colspan="2"></td><td>' + n2(r.Q) + '</td><td colspan="7">'
                    + Fmt.html(summaryText(r)) + '</td></tr>';
            } else if (r.type === 'total') {
                html += '<tr class="r-total"><td>Итого</td><td>' + n2(r.H) + '</td><td colspan="2"></td><td>'
                    + n2(r.Q) + '</td><td colspan="6"></td><td>' + n2(r.dH) + '</td></tr>';
            }
        });

        return html + '</tbody></table>';
    }

    /**
        Текст приложения для плана этажа: один расчёт от диктующего оросителя
        через стояк и магистраль до ввода. Отметки, узел управления и насосная
        берутся со схемы стояка, а не из исходных данных плана.
    */
    function planLines(app, part) {
        var v = part.v;
        var c = part.chain;
        var rec = c.rec;
        var i = v.inlet;
        var out = [];

        function add(text, cls) { out.push({ text: text, cls: cls || '' }); }

        add('Приложение ' + Appendix.of(App.book, 'plan:' + part.sys.id + ':' + part.planId), 'appendix');
        add('Определение требуемого напора в системе ' + part.sys.code, 'title');
        add(part.sys.code + ' — ' + v.zone + (v.purpose ? ', ' + v.purpose : ''), 'title');
        add('Расчёт выполнен по методике СП 485.1311500.2020 (приложение Б) сквозным — от диктующего оросителя на этаже '
            + 'через поэтажный отвод, стояк и магистраль до ввода в здание: секция ' + rec.section.name + ', '
            + rec.floor.label + ', отм. ' + Fmt.num(rec.floor.elev, 3) + ', план «' + rec.plan.name + '».');
        add('Требуемый напор:', 'sub');
        add('Нтр = Нгеом + Ннас + Нсети + Нуу + Нсв + Нпу + Нвсас, где', 'formula');
        add('Нгеом = ' + Fmt.num(rec.floor.elev, 3) + ' + ' + Fmt.trim(v.sprinklerHeight, 2) + ' − ('
            + Fmt.num(i.elev, 3) + ') = ' + n2(rec.Hgeom) + ' м — от оси ввода до оросителей этажа;', 'formula');
        add('Нсети = (ΣΔHэтажа + ΔHстояка + ΔHмагистрали) · ' + Fmt.trim(i.localFactor, 2) + ' = ('
            + Fmt.num(rec.HplanRaw, 3) + ' + ' + Fmt.num(rec.dHr, 3) + ' + ' + Fmt.num(rec.dHm, 3) + ') · '
            + Fmt.trim(i.localFactor, 2) + ' = ' + n2(rec.Hnet) + ' м — потери от оросителя до ввода (таблица ниже);', 'formula');
        add('Нуу = 1000 · ' + Fmt.sci(c.xi) + ' · (' + n2(rec.Qr) + ' · 3,6)² = ' + n2(rec.Hcu)
            + ' м — узел управления «' + i.cuKind + '» Ду' + i.cuDn + ';', 'formula');
        add('Нсв = ' + n2(rec.Hfree) + ' м — свободный напор у диктующего оросителя;', 'formula');
        add('Нпу = ' + n2(v.floorNodeLoss) + ' м — потери в поэтажном узле; Ннас = ' + n2(i.stationLoss)
            + ' м — потери в насосной; Нвсас = ' + n2(i.suction) + ' м.', 'formula');
        add('Нтр = ' + [rec.Hgeom, i.stationLoss, rec.Hnet, rec.Hcu, rec.Hfree, v.floorNodeLoss, i.suction].map(n2).join(' + ')
            + ' = ' + n2(rec.Htr) + ' м.', 'result');
        add('Нгар — гарантированный напор на вводе: ' + n2(i.guaranteed) + ' м.');
        add('Нр = Нтр − Нгар = ' + n2(rec.Htr) + ' − ' + n2(i.guaranteed) + ' = ' + n2(rec.Hp) + ' м.', 'result');
        if (rec.Hp <= 0) add('Гарантированного напора достаточно: насосная установка не требуется.');
        add('Расчётный расход: Q = ' + n2(rec.Q) + ' л/с (' + n2(rec.Q * 3.6) + ' м³/ч)'
            + (rec.Qr > rec.Q + 1e-9 ? '; по стояку и магистрали с пожарными кранами ' + n2(rec.Qr) + ' л/с' : '') + '.', 'result');

        if (rec !== part.res.dict) {
            add('Этот этаж не диктующий в системе: наибольший напор — ' + part.res.dict.section.name + ', '
                + part.res.dict.floor.label + ', Нтр = ' + n2(part.res.dict.Htr) + ' м.');
        }

        add('Таблица — «' + (app.project.settings.tableTitle || 'Гидравлический расчёт') + '»', 'sub');
        return out;
    }

    /** Строки текста приложения; каждая — { text, cls }. */
    function lines(app) {
        var part = riserPart(app);
        if (part) return planLines(app, part);

        var s = app.project.settings;
        var h = app.calc.head;
        var out = [];
        var percent = Math.round((s.localFactor - 1) * 100);

        function add(text, cls) { out.push({ text: text, cls: cls || '' }); }

        // План внутреннего пожаротушения: диктующая точка — кран, а не ороситель.
        var byPlan = s.planKind === 'vpv';
        var point = byPlan ? 'пожарного крана' : 'оросителя';

        add('Приложение ' + appendixNo(app), 'appendix');
        add('Определение требуемого напора в системе ' + s.systemName, 'title');
        add(byPlan
            ? 'Расчёт напора производится по методике СП 30.13330.2020 с учётом требований СП 10.13130.2020.'
            : 'Расчёт напора производится по методике, предложенной в СП 485.1311500.2020.');
        add('Расчёт требуемого напора для системы ' + (byPlan ? 'внутреннего' : 'автоматического')
            + ' пожаротушения ' + s.objectText + ' выполнен для наиболее удалённого и высокорасположенного '
            + (byPlan ? 'пожарного крана.' : 'спринклерного оросителя.'));
        add('Требуемый напор в системе:', 'sub');
        // Потери во всасывающих трубопроводах есть не всегда: в формуле они
        // появляются тогда же, когда и в сумме.
        add((byPlan ? 'Нтр = Нгеом + Ннас + Нсети + Нпк' : 'Нтр = Нгеом + Ннас + Нсети + Нуу + Нсв')
            + (h.Hsuction ? ' + Нвсас.тр' : '') + ', где', 'formula');
        // Отметка, к которой приведён расчёт: у кранов — клапана, у АУП — оросителя.
        var plane = Model.planeElev(s);

        add('Нгеом — геометрическая высота подачи воды от оси насоса до диктующего ' + point + ', м:');
        add('Нгеом = ' + n2(plane) + ' − (' + n2(s.inletElev) + ') = ' + n2(h.Hgeom) + ' м, где '
            + n2(plane) + ' — относительная отметка ' + (byPlan ? 'клапана пожарного крана' : 'установки спринклерного оросителя') + '; '
            + n2(s.inletElev) + ' — глубина заложения ввода относительно отм. 0,000;', 'formula');
        add('Нсети = Нтупик + Нкольцо + Нлуч — потери напора от диктующего ' + point + ' до ввода, м:');

        /*
            Внутреннее пожаротушение считается как ВПВ: потери по длине по
            Дарси–Вейсбаху, λ по Шевелеву для неновых стальных труб. В записке
            это надо назвать прямо — проверяющий ищет именно эти формулы.
        */
        if (byPlan) {
            var hy = s.hydr || {};
            var reserve = hy.reserve > 0 ? hy.reserve : 0;
            add('Потери по длине — по Дарси–Вейсбаху: h = λ · L/dр · V²/(2g), где λ — коэффициент '
                + 'гидравлического трения по формуле ' + (Vpv.FORMULAS[hy.formula] || Vpv.FORMULAS.shevelev)
                + ' для неновых стальных труб'
                + (reserve > 0
                    ? ', dр = d − ' + Fmt.trim(reserve, 1) + ' мм — расчётный диаметр с запасом на отложения'
                    : '') + '; ν = ' + Fmt.trim(hy.nu > 0 ? hy.nu : 1.31, 2) + '·10⁻⁶ м²/с.');
        }

        add('Нсети = ' + n2(h.HnetRaw) + ' м; с учётом местных сопротивлений (' + percent + ' %) — '
            + n2(h.HnetRaw) + ' · ' + Fmt.trim(s.localFactor, 3) + ' = ' + n2(h.Hnet) + ' м;', 'formula');
        // У внутреннего пожаротушения узла управления нет — и строки о нём тоже.
        if (!byPlan) {
            add('Нуу — потери напора в узле управления «' + s.cuKind + '» Ду' + s.cuDn + ':');
            add('Нуу = 1000 · ' + Fmt.sci(h.xi) + ' · (' + n2(h.Q) + ' · 3,6)² = ' + n2(h.Hcu) + ' м;', 'formula');
        }

        if (byPlan && h.dictKind === 'pk') {
            // Кран со своей отметкой приводится к расчётной: разница в напоре.
            var off = Math.abs(h.pkElev - plane) > 1e-9;
            add('Нпк — давление у диктующего пожарного крана ' + h.dictName + ' (СП 10.13130.2020 табл. 7.3): '
                + n2(h.pkHead) + ' м у клапана на отм. ' + n2(h.pkElev) + (off
                    ? '; к расчётной отметке ' + n2(plane) + ': ' + n2(h.pkHead) + ' − (' + n2(plane)
                        + ' − (' + n2(h.pkElev) + ')) = ' + n2(h.Hfree) + ' м;'
                    : ';'));
        } else if (h.dictKind === 'pk') {
            var lower = Math.abs(h.pkElev - plane) > 1e-9;
            add('Нсв — давление у диктующего пожарного крана ' + h.dictName + ': ' + n2(h.pkHead) + ' м у клапана на отм. '
                + n2(h.pkElev) + (lower
                    ? '; к отметке оросителей: ' + n2(h.pkHead) + ' − (' + n2(plane) + ' − (' + n2(h.pkElev) + ')) = ' + n2(h.Hfree) + ' м;'
                    : ';'));
        } else {
            add('Нсв — свободный напор перед спринклерным оросителем для обеспечения интенсивности '
                + Fmt.trim(s.intensity, 3) + ' л/(с·м²) — ' + n2(h.Hfree) + ' м;');
        }
        if (h.Hsuction) add('Нвсас.тр = ' + n2(h.Hsuction) + ' м — потери напора во всасывающих трубопроводах;');
        add('Ннас — потери напора в насосной установке — ' + n2(h.Hpump) + ' м;');
        // Слагаемые суммы — те же, что в формуле: без узла управления у плана
        // кранов его нулю в строке взяться неоткуда.
        var terms = [n2(h.Hgeom), n2(h.Hpump), n2(h.Hnet)];
        if (!byPlan) terms.push(n2(h.Hcu));
        terms.push(n2(h.Hfree));
        if (h.Hsuction) terms.push(n2(h.Hsuction));

        add('Нтр = ' + terms.join(' + ') + ' = ' + n2(h.Hreq) + ' м.', 'result');
        add('Нгар — гарантированный напор на вводе на оси водомерного узла: ' + n2(h.Hguar) + ' м.');
        add('Ннас = Нтр − Нгар = ' + n2(h.Hreq) + ' − ' + n2(h.Hguar) + ' = ' + n2(h.HpumpReq) + ' м.', 'result');
        add('Расчётный расход: Q = ' + n2(h.Q) + ' л/с (' + n2(h.Q * 3.6) + ' м³/ч).', 'result');
        var pk = app.calc.hydrants || [];
        if (pk.length) {
            var named = pk.some(function (k) { return k.use !== null; });

            add(byPlan
                ? 'Пожарные краны системы (в расчётном случае работает ' + Fmt.trim(s.pkJets, 0)
                    + ' стр. у ' + (named ? 'принятых в расчёт' : 'наиболее невыгодных')
                    + ' кранов, СП 10.13130.2020 табл. 7.1):'
                : 'Пожарные краны включены в расчётную сеть АУП; их расход не прибавляется к расходу АУП отдельно '
                    + '(СП 485 п. Б.1.3.16):', 'sub');
            pk.forEach(function (k) {
                if (byPlan && !k.working) {
                    add(k.name + ': в расчётном случае закрыт; объём его трубопроводов учтён в объёме системы.', 'formula');
                    return;
                }
                add(k.name + ': ' + k.jets + ' стр. × ' + Fmt.trim(k.flow, 2) + ' л/с = ' + n2(k.Q)
                    + ' л/с; давление у клапана требуемое ' + n2(k.head) + ' м, расчётное '
                    + (k.reach ? n2(k.valve) + ' м' : '— кран не соединён с вводом') + '.', 'formula');
            });
        }

        /*
            Воздухозаполненная установка: объём трубопроводов и время подачи
            воды в приложение не идут. Приложение — определение требуемого
            напора; эти проверки видно в программе (карточки и замечания), а
            про объём системы говорит записка.
        */

        // Насос нужен не всегда: когда хватает гарантированного напора, строка
        // про насосную установку в приложении только мешает.
        if (h.HpumpReq > 0) {
            add('Требуемый напор обеспечивает насосная установка: ' + (s.pumpText || '________________') + '.');
        } else {
            add('Насосная установка не требуется: требуемый напор обеспечивает гарантированный напор наружной сети — '
                + n2(h.Hguar) + ' м.');
        }
        add('Таблица — «' + s.tableTitle + '»', 'sub');

        return out;
    }

    function html(app) {
        if (!app.calc || !app.calc.ok) {
            return '<p class="empty">Расчёт не выполнен: ' + Fmt.html((app.net && app.net.errors.join(' ')) || '') + '</p>';
        }

        var body = '';
        lines(app).forEach(function (l) {
            body += '<p class="r-' + (l.cls || 'text') + '">' + Fmt.html(l.text) + '</p>';
        });

        body += tableHtml(rowsOf(app), app.project);

        if (app.project.settings.code) {
            body += '<p class="r-code">' + Fmt.html(app.project.settings.code) + '</p>';
        }

        return body;
    }

    /* --- выгрузки -------------------------------------------------------- */

    /** Для вставки в Excel: табуляция, запятая, полная точность. */
    function tsv(app) {
        var out = [headOf(app.project).join('\t')];

        function value(v) {
            if (typeof v === 'number') return String(Math.round(v * 1e9) / 1e9).replace('.', ',');
            return String(v === null || v === undefined ? '' : v);
        }

        rowsOf(app).forEach(function (r) {
            out.push(cells(r).map(value).join('\t'));
        });

        return out.join('\r\n');
    }

    function copy(app) {
        if (!app.calc || !app.calc.ok) return;

        var text = tsv(app);

        function fallback() {
            var area = document.createElement('textarea');
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                App.status('Таблица скопирована — вставьте в Excel.', 'done');
            }, function () {
                fallback();
                App.status('Таблица скопирована.', 'done');
            });
        } else {
            fallback();
            App.status('Таблица скопирована.', 'done');
        }
    }

    function inputRows(app) {
        var s = app.project.settings;
        var c = app.calc.checks;
        var h = app.calc.head;

        /*
            У плана внутреннего пожаротушения своя геометрия и свои исходные
            данные: краны и ствол, а не ороситель с интенсивностью.
        */
        if (s.planKind === 'vpv') {
            var hy = s.hydr || {};
            return [
                ['Число струй в расчёте (СП 10.13130 табл. 7.1)', s.pkJets, 'шт.'],
                ['Расход одной струи', s.pkFlow > 0 ? s.pkFlow : Model.pkTable(s).q, 'л/с'],
                ['Давление у клапана ПК', s.pkHead > 0 ? s.pkHead : Model.pkTable(s).p, 'м'],
                ['DN клапана · спрыск · рукав · компактная струя',
                    s.pkDn + ' · ' + s.pkNozzle + ' мм · ' + s.pkHose + ' м · ' + s.pkCompact + ' м', ''],
                ['Отметка клапана ПК', Model.planeElev(s), 'м'],
                ['Глубина заложения ввода', s.inletElev, 'м'],
                ['Потери во всасывающих трубопроводах', s.suction, 'м'],
                ['Гарантированный напор на вводе', s.guaranteed, 'м'],
                ['Потери в насосной установке', s.pumpLoss, 'м'],
                ['Коэффициент местных сопротивлений', s.localFactor, ''],
                ['Система', s.systemKind, ''],
                ['Коэффициент трения λ по формуле', Vpv.FORMULAS[hy.formula] || Vpv.FORMULAS.shevelev, ''],
                ['Запас к диаметру на отложения', hy.reserve > 0 ? hy.reserve : 0, 'мм'],
                ['Кинематическая вязкость ν · 10⁻⁶', hy.nu > 0 ? hy.nu : 1.31, 'м²/с'],
                ['Пожарных кранов на плане', (app.calc.hydrants || []).length, 'шт.'],
                ['Шифр объекта', s.code, '']
            ];
        }

        return [
            ['Группа помещений', s.group, ''],
            ['Интенсивность орошения', s.intensity, 'л/(с·м²)'],
            ['Нормативная площадь орошения', s.area, 'м²'],
            ['Производитель оросителей', s.maker, ''],
            ['Тип оросителя', s.sprinklerType, ''],
            ['Давление на диктующем оросителе', s.dictHead, 'м вод. ст.'],
            ['Коэффициент производительности оросителя k', s.k, 'л/(с·МПа^0,5)'],
            ['Шаг между оросителями', s.spacing, 'м'],
            ['Отметка установки оросителя', s.sprinklerElev, 'м'],
            ['Глубина заложения ввода', s.inletElev, 'м'],
            ['Узел управления', s.cuKind + ' Ду' + s.cuDn, ''],
            ['Коэффициент потерь в узле управления ξ', h.xi, ''],
            ['Потери во всасывающих трубопроводах', s.suction, 'м'],
            ['Гарантированный напор на вводе', s.guaranteed, 'м'],
            ['Потери в насосной установке', s.pumpLoss, 'м'],
            ['Система', s.systemKind, ''],
            ['Пожарные краны на схеме', (app.calc.hydrants || []).length, 'шт.'],
            ['ПК по умолчанию: струй × расход', s.pkJets + ' × ' + String(s.pkFlow).replace('.', ','), 'л/с'],
            ['ПК по умолчанию: давление у клапана', s.pkHead, 'м'],
            ['Шифр объекта', s.code, ''],
            ['qi = I·L²', c.qi, 'л/с'],
            ['q = k·√H', c.q, 'л/с'],
            ['f = qi/q (не более 0,85)', c.f, '']
        ];
    }

    function sheets(app) {
        var calcRows = rowsOf(app).map(cells);

        return [
            {
                name: 'Исходные данные',
                blocks: [
                    { kind: 'title', text: 'Данные по оросителю, узлу управления, системе' },
                    { kind: 'table', head: ['Параметр', 'Значение', 'Ед. изм.'], rows: inputRows(app), widths: [46, 18, 16] }
                ]
            },
            {
                name: 'Расчет',
                blocks: [
                    { kind: 'title', text: app.project.settings.tableTitle },
                    { kind: 'table', head: headOf(app.project), rows: calcRows, widths: [12, 11, 12, 9, 10, 7, 9, 8, 14, 9, 8, 10] }
                ]
            },
            {
                name: 'Вывод данных',
                blocks: lines(app).map(function (l) {
                    return { kind: l.cls === 'appendix' || l.cls === 'title' ? 'title' : 'note', text: l.text };
                }).concat([
                    { kind: 'table', head: headOf(app.project), rows: calcRows, widths: [12, 11, 12, 9, 10, 7, 9, 8, 14, 9, 8, 10] }
                ])
            }
        ];
    }

    function saveXlsx(app) {
        if (!app.calc || !app.calc.ok) {
            App.status('Нечего выгружать: расчёт не выполнен.', 'warn');
            return;
        }
        Xlsx.save(ExcelExport.sheets(app), Storage.safeName(app.project.name, ' — расчёт.xlsx'));
        App.status('Выгружено в Excel с формулами: исходные данные можно менять прямо в книге.', 'done');
    }

    function print(app) {
        var area = document.getElementById('printArea');
        area.innerHTML = '<div class="report">' + html(app) + '</div>';
        App.print();
    }

    return {
        HEAD: HEAD,
        headOf: headOf,
        cells: cells,
        summaryText: summaryText,
        html: html,
        tsv: tsv,
        copy: copy,
        saveXlsx: saveXlsx,
        print: print
    };
})();
