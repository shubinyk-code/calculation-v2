/*
    Вкладка «Гидравлика»: результаты — таблица участков и напоры насосных
    установок; карточка участка с ручной правкой диаметра и длины (она же
    показывается в инспекторе схемы).
*/

var UiHydView = (function () {
    'use strict';

    var esc = Format.html;
    var num = Format.num;
    var body, state, reg;
    var result = null;

    function init(b, s, r) {
        body = b;
        state = s;
        reg = r;
    }

    function hyd() { return App.project.hyd; }

    function show(sub, res) {
        result = res;
        reg.length = 0;

        if (!res) { body.innerHTML = '<div class="card"><p class="hint">Расчёт не выполнен.</p></div>'; return; }

        if (sub === 'rows') rowsPage(res);
        else if (sub === 'meters') metersPage(res);
        else headsPage(res);
    }

    function warningsBox(res) {
        if (!res.warnings.length) return '';
        var items = res.warnings.slice(0, 12).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
        var more = res.warnings.length > 12 ? '<li>… и ещё ' + (res.warnings.length - 12) + '</li>' : '';
        return '<div class="verdict unknown no-print"><b>Замечания расчёта (' + res.warnings.length + ')</b><ul style="margin:6px 0 0;padding-left:18px">'
            + items + more + '</ul></div>';
    }

    /* --- карточка участка ---------------------------------------------------------- */

    function pair(a, b) { return '<tr><td class="l">' + a + '</td><td class="l">' + b + '</td></tr>'; }

    /*
        Расчёт участка и ручные правки. segId — идентификатор участка сети.
        У участка стояка размер ставится на весь стояк (sizeKey).
    */
    function segCard(res, segId, inline) {
        var s = res && res.net ? res.net.byId[segId] : null;
        if (!s) return '<div class="card no-print"><p class="hint">Участок не найден.</p></div>';

        var r = s.res;
        var z = r.size;
        var d = hyd();
        var h = [];

        if (!inline) h.push('<div class="card"><div class="ctitle"><b>' + esc(s.name) + '</b><span class="badge">' + esc(s.id) + '</span></div>');
        else h.push('<h4>' + esc(s.name) + '</h4>');

        h.push('<div class="scroll"><table class="grid"><tbody>');
        h.push(pair('Сеть и канал расхода', (s.net === 'c' ? 'ХВС' : 'ГВС') + ', канал «' + ({ total: 'общий', cold: 'холодный', hot: 'горячий' }[s.ch]) + '»'));
        h.push(pair('Нагрузка ниже участка', 'людей U = ' + r.U + ', приборов N = ' + r.N));
        h.push(pair('Вероятность P · N·P', num(r.P, 5) + ' · ' + num(r.N * r.P, 4)));
        h.push(pair('α по таблице', num(r.alpha, 3) + ' (' + esc(r.table) + ')'));
        h.push(pair('Расход q = 5·q₀·α', '<b>' + num(r.q, 3) + ' л/с</b> (' + num(r.q * 3.6, 2) + ' м³/ч)'));

        if (z) {
            h.push(pair('Труба', esc(HydData.material(z.material).name) + ', <b>' + esc(z.label) + '</b>, Ду ' + z.dn
                + (z.manual && s.kind !== 'input' ? ' (задано вручную)' : '') + (s.chain ? ' — один диаметр на весь стояк' : '')));
            h.push(pair('Скорость', num(z.v, 3) + ' м/с' + (z.ok ? '' : ' — выше допустимой ' + num(z.vmax, 2))));
            h.push(pair('Удельные потери i', num(z.iMm, 3) + ' мм/м'));
            h.push(pair('Длина · потери по длине', num(s.L, 2) + ' м' + (s.Lmanual ? ' (задана вручную)' : '') + ' · ' + num(z.h, 3) + ' м'));
        }

        if (r.meter && r.meter.pick) h.push(pair('Узел учёта', esc(r.meter.mark) + ', потери ' + num(r.meter.h, 3) + ' м (с фильтром)' + (r.meter.ok ? '' : ' — вне допуска')));
        h.push('</tbody></table></div>');

        if (s.kind !== 'input' && s.cls !== 'device' && z) {
            var key = s.sizeKey || s.id;
            var current = d.pipes[key];
            var matOpts = [['auto', 'Автоподбор']].concat(HydData.MATERIALS.map(function (m) { return [m.key, m.name]; }));
            var proxy = { mat: current ? current.material : 'auto', size: current ? current.od + '|' + current.wall : '' };
            var matKey = current ? current.material : null;

            h.push('<div class="row no-print" style="margin-top:10px">');
            h.push(UiHyd.inp('Материал', proxy, 'mat', {
                type: 'select', options: matOpts, after: function (v) {
                    if (v === 'auto') { delete d.pipes[key]; return; }
                    var list = HydData.sizesOf(v);
                    var first = list[0];
                    for (var i = 0; i < list.length; i++) if (list[i].dn >= z.dn) { first = list[i]; break; }
                    d.pipes[key] = { material: v, od: first.od, wall: first.wall };
                }
            }));

            if (matKey) {
                var opts = HydData.sizesOf(matKey).map(function (x) { return [x.od + '|' + x.wall, x.label + ' Ду' + x.dn]; });
                h.push(UiHyd.inp('Размер', proxy, 'size', {
                    type: 'select', options: opts, after: function (v) {
                        var p = v.split('|');
                        d.pipes[key] = { material: matKey, od: parseFloat(p[0]), wall: parseFloat(p[1]) };
                    }
                }));
            }

            var lp = { L: s.L };
            h.push(UiHyd.inp('Длина участка, м', lp, 'L', { min: 0, after: function (v) { d.lengths[s.id] = v; } }));

            if (d.lengths[s.id] >= 0) {
                h.push('<button type="button" class="small" data-v="autoLen" data-arg="' + esc(s.id) + '">Длина — с рисунка</button>');
            }

            h.push('</div>');
        } else if (s.kind === 'input') {
            h.push('<p class="note">Диаметр ввода задаётся в параметрах объекта «Ввод».</p>');
        }

        if (!inline) h.push('</div>');
        return h.join('');
    }

    /* --- участки ------------------------------------------------------------------- */

    var KINDS = [
        ['mains', 'Магистрали, ввод, узлы учёта'],
        ['riser', 'Стояки (по одному на блок)'],
        ['fb', 'Этажные ветки'],
        ['outlet', 'Квартирные выходы'],
        ['all', 'Все участки']
    ];

    /* Строки таблицы: стояк сворачивается в одну строку. */
    function rowsFor(segs, kind, netFilter) {
        var list = [];
        segs = segs.filter(function (s) { return netFilter === 'all' || s.net === netFilter; });

        if (kind === 'riser') {
            var chains = {};
            var order = [];

            segs.forEach(function (s) {
                if (s.kind !== 'riser') return;
                if (!chains[s.chain]) { chains[s.chain] = []; order.push(s.chain); }
                chains[s.chain].push(s);
            });

            order.forEach(function (key) {
                var chain = chains[key];
                var a = chain[0];
                var sumL = 0;
                var sumH = 0;
                chain.forEach(function (s) { sumL += s.L; sumH += s.res.size ? s.res.size.h : 0; });
                var f1 = chain[chain.length - 1].meta.floor;
                list.push({ seg: a, name: a.name + ', эт. 1–' + f1, L: sumL, h: sumH });
            });

            return list;
        }

        segs.forEach(function (s) {
            var ok = kind === 'all'
                || (kind === 'mains' && (s.cls === 'mains' || s.cls === 'input' || s.cls === 'device'))
                || (kind === 'fb' && s.kind === 'fbranch')
                || (kind === 'outlet' && s.kind === 'outlet');
            if (ok) list.push({ seg: s, name: s.name, L: s.L, h: s.res && s.res.size ? s.res.size.h : 0 });
        });

        return list;
    }

    function rowsPage(res) {
        var h = [warningsBox(res)];

        if (!res.segs.length) { body.innerHTML = h.join('') + '<div class="card"><p class="hint">Расчётной сети нет: на схеме должен быть ввод со стояками.</p></div>'; return; }

        var pool = res.segs;

        if (state.sysId) {
            var sys = res.systems.filter(function (x) { return x.id === state.sysId; })[0];
            if (sys) pool = sys.segs;
        }

        h.push('<div class="card"><div class="row no-print">');
        h.push('<label class="field">Система<select id="hvSys"><option value="">Вся сеть</option>' + res.systems.map(function (s) {
            return '<option value="' + esc(s.id) + '"' + (s.id === state.sysId ? ' selected' : '') + '>после насоса: ' + esc(s.name) + '</option>';
        }).join('') + '</select></label>');
        h.push('<label class="field">Участки<select id="hvKind">' + KINDS.map(function (k) {
            return '<option value="' + k[0] + '"' + (k[0] === state.rowKind ? ' selected' : '') + '>' + k[1] + '</option>';
        }).join('') + '</select></label>');
        h.push('<label class="field">Сеть<select id="hvRowNet">' + [['all', 'ХВС и ГВС'], ['c', 'ХВС'], ['h', 'ГВС']].map(function (k) {
            return '<option value="' + k[0] + '"' + (k[0] === state.rowNet ? ' selected' : '') + '>' + k[1] + '</option>';
        }).join('') + '</select></label>');
        h.push('<button type="button" class="small" data-v="exportRows">Гидравлика в Excel</button></div>');

        var rows = rowsFor(pool, state.rowKind, state.rowNet);
        var limit = 600;

        h.push('<div class="scroll" style="max-height:70vh"><table class="grid"><thead><tr>'
            + '<th class="left">Участок</th><th>Сеть</th><th>Канал</th><th>U</th><th>N</th><th>P</th><th>α</th><th>q, л/с</th>'
            + '<th class="left">Труба</th><th>L, м</th><th>V, м/с</th><th>i, мм/м</th><th>h, м</th><th class="left">Счётчик</th></tr></thead><tbody>');

        rows.slice(0, limit).forEach(function (row) {
            var s = row.seg;
            var r = s.res;
            var z = r.size;
            h.push('<tr data-segrow="' + esc(s.id) + '" class="' + (state.selected && state.selected.segRow === s.id ? 'here' : (z && !z.ok && s.kind !== 'outlet' ? 'fail' : '')) + '" style="cursor:pointer">'
                + '<td class="left">' + esc(row.name) + '</td>'
                + '<td class="c">' + (s.net === 'c' ? 'ХВС' : 'ГВС') + '</td>'
                + '<td class="c">' + ({ total: 'общ.', cold: 'хол.', hot: 'гор.' }[s.ch]) + '</td>'
                + '<td>' + r.U + '</td><td>' + r.N + '</td><td>' + num(r.P, 5) + '</td><td>' + num(r.alpha, 3) + '</td>'
                + '<td><b>' + num(r.q, 3) + '</b></td>'
                + '<td class="left">' + (z ? esc(z.label) + ' Ду' + z.dn : '—') + '</td>'
                + '<td>' + num(row.L, 1) + '</td><td>' + (z ? num(z.v, 2) : '—') + '</td><td>' + (z ? num(z.iMm, 2) : '—') + '</td>'
                + '<td>' + num(row.h, 3) + '</td>'
                + '<td class="left">' + (r.meter && r.meter.pick ? esc(r.meter.mark) + ' (' + num(r.meter.h, 2) + ' м)' : '') + '</td></tr>');
        });

        h.push('</tbody></table></div>');
        if (rows.length > limit) h.push('<p class="hint">Показаны первые ' + limit + ' из ' + rows.length + ' строк — выберите вид «Магистрали», «Стояки» или нужную систему.</p>');
        h.push('</div><div id="hvCard">' + (state.rowSeg && res.net.byId[state.rowSeg] ? segCard(res, state.rowSeg) : '') + '</div>');

        body.innerHTML = h.join('');
    }

    /* --- водомерные узлы: таблица подбора и расчёт потерь ---------------------------- */

    function metersPage(res) {
        var h = [warningsBox(res)];
        var d = hyd();

        if (!res.input) { body.innerHTML = h.join('') + '<div class="card"><p class="hint">Расчёта нет: на схеме нужен ввод и стояки.</p></div>'; return; }

        var rows = HydReport.meterRows(res, d);

        h.push('<div class="card"><div class="ctitle"><b>Таблица подбора счётчиков</b><span class="no-print">'
            + '<button type="button" class="small" data-v="metersWord">В Word</button> '
            + '<button type="button" class="small" data-v="exportRows">В Excel (вся гидравлика)</button></span></div>'
            + '<p class="hint">Счётчик выбирается на схеме: щёлкните по знаку счётчика — справа панель подбора со всеми калибрами. '
            + 'Здесь — итоговая таблица и расчёт потерь для записки.</p>');

        if (!rows.length) {
            h.push('<p class="hint">Водомерных узлов на схеме нет — поставьте «Счётчик» на трубу.</p>');
        } else {
            h.push('<div class="scroll"><table class="grid"><thead><tr><th>№</th><th class="left">Место установки</th><th class="left">Система</th><th>Q, л/с</th>'
                + '<th class="left">Марка</th><th>DN</th><th class="left">Тип</th><th>h, м</th><th>Предел, м</th><th class="left">Статус</th><th class="left">Примечание</th><th></th></tr></thead><tbody>');

            rows.forEach(function (r, i) {
                var loss = r.method === 'passport' ? r.c.hPassport : r.c.hSp;
                var bad = !(r.c.suitable);
                h.push('<tr class="' + (bad ? 'fail' : '') + '"><td>' + (i + 1) + '</td><td class="left">' + esc(r.place) + '</td><td class="left">' + esc(r.systemName) + '</td>'
                    + '<td>' + num(r.qLs, 3) + '</td><td class="left"><b>' + esc(r.c.markFull) + '</b>' + (r.manual ? ' *' : '') + '</td><td>' + r.c.dn + '</td><td class="left">' + r.c.kindName + '</td>'
                    + '<td>' + num(loss, 2) + '</td><td>' + HydMeter.coef(r.c.limit) + '</td><td class="left ' + (r.c.status === 'подходит' ? 'st-ok' : 'st-bad') + '">' + esc(r.c.status) + '</td>'
                    + '<td class="left">' + esc(r.note) + '</td><td><button type="button" class="mini" data-v="gotoMeter" data-arg="' + esc(r.node.id + '|' + r.seg.net) + '">на схеме</button></td></tr>');
            });

            h.push('</tbody></table></div><p class="hint">* — калибр выбран вручную. Все счётчики предусмотрены ' + (d.survey.meter.pulse ? 'с импульсным выходом' : 'без импульсного выхода') + '.</p>');
        }

        var apt = HydReport.aptMeters(res);
        if (apt.length) h.push('<p class="note">Квартирные счётчики (подбор автоматический): ' + esc(apt.join('; ')) + '.</p>');
        h.push('</div>');

        var lines = HydMeter.reportLines(rows.map(function (r) {
            return { place: r.place, systemName: r.systemName, qLs: r.qLs, c: r.c, method: r.method, note: r.note };
        }), d.survey.meter);

h.push('<div class="card"><h2>Расчёт потерь напора в счётчиках воды</h2><div class="trace">' + esc(lines.join(String.fromCharCode(10))) + '</div></div>');

        body.innerHTML = h.join('');
    }

    /* --- напоры -------------------------------------------------------------------- */

    function headsPage(res) {
        var h = [warningsBox(res)];

        if (!res.input) { body.innerHTML = h.join('') + '<div class="card"><p class="hint">Расчёта нет: на схеме нужен ввод и стояки.</p></div>'; return; }

        h.push('<div class="card"><div class="ctitle"><h2 style="margin:0">Насосные установки — требуемые параметры</h2>'
            + '<span class="no-print"><button type="button" class="small" data-v="naporApp" title="Для записки и стадии П: по форме бюро — методика, формула, значения и сводная таблица в одном приложении">Приложение «Расчёт напоров» (Word)</button> '
            + '<button type="button" class="small" data-v="naporWork" title="Рабочий вид: напоры, участки и расчётные точки таблицами — не для выдачи">Рабочие таблицы напоров (Word)</button> '
            + '<button type="button" class="small" data-v="exportRows">Гидравлика в Excel</button></span></div>'
            + '<p class="hint">Qтр — расход за насосом по СП 30; Hтр — напор по диктующему прибору за вычетом Hгар. '
            + 'Подбор насосов по каталогу и рабочая точка Qф/Hф — отдельный этап. Циркуляция Т4 в Hтр ГВС не входит.</p>'
            + '<div class="scroll"><table class="grid"><thead><tr><th class="left">Система</th><th class="left">Установка</th>'
            + '<th>Qтр, л/с</th><th>Qтр, м³/ч</th><th>Hтр, м</th><th>Hгар, м</th><th>Нужно у ввода, м</th><th>Статика внизу, м</th><th>Регуляторов</th><th>Прибор низ, м</th><th>Прибор верх, м</th><th class="left">Диктующий прибор</th></tr></thead><tbody>');

        res.systems.forEach(function (sys) {
            var p = sys.pump;
            if (!p) return;
            h.push('<tr><td class="left">' + esc(sys.name) + '</td><td class="left">' + (p.pumped ? (p.needed ? 'насос' : 'насос не нужен') : 'городская сеть') + '</td>'
                + '<td>' + num(p.q, 3) + '</td><td>' + num(p.qM3h, 2) + '</td><td><b>' + num(p.hp, 1) + '</b></td><td>' + num(p.hgar, 1) + '</td>'
                + '<td>' + num(p.req, 1) + '</td><td>' + num(p.maxStatic, 1) + '</td><td>' + p.regs + '</td>'
                + '<td>' + (sys.span && sys.span.low ? num(sys.span.low.elev, 3) : '—') + '</td><td><b>' + (sys.span && sys.span.high ? num(sys.span.high.elev, 3) : '—') + '</b></td>'
                + '<td class="left">' + esc(sys.dict.leaf.label) + ' (' + (sys.dict.leaf.net === 'c' ? 'ХВС' : 'ГВС') + ')</td></tr>');
        });

        h.push('</tbody></table></div></div>');

        var inp = res.input;
        h.push('<div class="card"><h2>Ввод</h2><div class="scroll"><table class="grid"><tbody>'
            + pair('Расход общий q', num(inp.q, 3) + ' л/с (людей ' + inp.U + ', N·P по СП 30)')
            + pair('Труба ввода', esc(inp.size.label) + ', ' + esc(HydData.material(inp.size.material).name) + ', L=' + num(inp.input.length, 1) + ' м')
            + pair('Скорость · i · потери', num(inp.v, 3) + ' м/с · ' + num(inp.iMm, 2) + ' мм/м · ' + num(inp.h, 3) + ' м')
            + pair('Водомерный узел на вводе', inp.meter && inp.meter.c ? esc(inp.meter.c.markFull) + ', потери ' + num(inp.hMeter, 2) + ' м (с фильтром)' : '— (поставьте «Счётчик» на ввод)')
            + '</tbody></table></div></div>');

        res.systems.forEach(function (sys) {
            if (sys.dict) h.push(headForm(sys, hyd().survey, inp));
            if (sys.dict && sys.route) h.push(routeCard(sys, hyd().survey, inp));
        });

        body.innerHTML = h.join('');
    }

    /*
        «Как получен потребный напор»: пошаговое объяснение с подстановкой чисел и
        таблица расчётных точек диктующего пути (те же номера нанесены на схему).
    */
    function routeCard(sys, s, inp) {
        var p = sys.dict.part;
        var leaf = sys.dict.leaf;
        var route = sys.route;
        var pumped = sys.kind === 'pump';
        var ref = pumped ? sys.node.elev : inp.input.elev;
        var hgar = inp.input.Hgar;
        var N = route.sections.length;
        var count = sys.leaves.length;
        var h = [];

        function n2(x) { return num(x, 2); }

        h.push('<div class="card"><h2>Как получен потребный напор — ' + esc(sys.name) + '</h2><ol class="steps">');

        h.push('<li><b>Диктующий прибор.</b> Расчёт перебирает все приборы системы и для каждого считает полный потребный напор (с учётом ХВС и ГВС их ' + count + '). '
            + 'Наибольший — у прибора <b>' + esc(leaf.label) + '</b> (' + (leaf.net === 'c' ? 'ХВС' : 'ГВС') + (leaf.floor ? ', этаж ' + leaf.floor : '') + ', отметка '
            + n2(leaf.elev) + ' м): ' + n2(p.req) + ' м. Он и задаёт напор насоса.</li>');

        // сравнение с самым высоким прибором: диктует не обязательно он — выигрывает прибор с наибольшим полным Hтр
        var top = null;
        sys.leaves.forEach(function (lf) {
            if (!lf.part) return;
            if (!top || lf.elev > top.elev + 0.005 || (lf.elev > top.elev - 0.005 && lf.part.req > top.part.req)) top = lf;
        });
        if (top && Math.abs(top.elev - leaf.elev) < 0.05) {
            h.push('<li><b>Самый высокий прибор</b> здесь и есть диктующий: отметка ' + n2(top.elev) + ' м — на этом уровне напор нужен больше всего.</li>');
        } else if (top) {
            var tp = top.part;
            h.push('<li><b>Почему не самый высокий прибор.</b> Самый высокий — <b>' + esc(top.label) + '</b> (' + (top.net === 'c' ? 'ХВС' : 'ГВС') + ', отметка ' + n2(top.elev) + ' м): '
                + 'Hgeom ' + n2(tp.geom) + ' + ΣHl,tot ' + n2(tp.tot) + ' + Hпр ' + n2(tp.pr) + ' = <b>' + n2(tp.req) + ' м</b>, это на ' + n2(p.req - tp.req) + ' м меньше. '
                + 'У диктующего подъём меньше на ' + n2(tp.geom - p.geom) + ' м, зато потери больше на ' + n2(p.tot - tp.tot) + ' м (длина пути ' + n2(p.sumL) + ' м против ' + n2(tp.sumL)
                + ' м). Диктует тот прибор, которому нужен наибольший напор, а не тот, что выше.</li>');
        }

        h.push('<li><b>Путь воды</b> от ввода до этого прибора разбит на ' + N + ' участков; расчётные точки <b>1–' + (N + 1) + '</b> нанесены на схему '
            + '(список «Расчётные точки» над схемой). На каждом участке расход берётся по СП 30 (q = 5·q₀·α), диаметр подбирается по допустимой скорости, '
            + 'потери по длине — как удельные потери i на длину L. Все участки — в таблице ниже.</li>');

        h.push('<li><b>Геометрическая высота подъёма</b> Hgeom = отметка прибора − отметка ' + (pumped ? 'оси насосов' : 'ввода') + ' = '
            + n2(leaf.elev) + ' − (' + n2(ref) + ') = <b>' + n2(p.geom) + ' м</b>.</li>');

        h.push('<li><b>Потери по длине</b> ΣHl = квартирная разводка + стояк и этажная ветка + магистрали и ввод = '
            + n2(p.lApt) + ' + ' + n2(p.lRiser) + ' + ' + n2(p.lMains) + ' = <b>' + n2(p.sumL) + ' м</b>.</li>');

        h.push('<li><b>Местные потери</b> Hмест = Kl · ΣHl = ' + n2(s.kl) + ' · ' + n2(p.sumL) + ' = <b>' + n2(p.local) + ' м</b> (п. 8.28 СП 30).</li>');

        var equip = p.mApt + p.mSec + p.main + p.reg + p.ns + p.itp + p.hv;
        h.push('<li><b>Оборудование на пути:</b> квартирный счётчик ' + n2(p.mApt) + ', счётчики секции и встроенных ' + n2(p.mSec) + ', счётчик на вводе ' + n2(p.main)
            + ', регулятор ' + n2(p.reg) + ', насосная ' + n2(p.ns) + ', ИТП ' + n2(p.itp) + ', потери во вводе ' + n2(p.hv) + ' — всего <b>' + n2(equip) + ' м</b>.</li>');

        h.push('<li><b>Итого потерь</b> ΣHl,tot = ΣHl + Hмест + оборудование = ' + n2(p.sumL) + ' + ' + n2(p.local) + ' + ' + n2(equip) + ' = <b>' + n2(p.tot) + ' м</b>.</li>');

        h.push('<li><b>Потребный напор</b> Hтр = Hgeom + ΣHl,tot + Hпр = ' + n2(p.geom) + ' + ' + n2(p.tot) + ' + ' + n2(p.pr) + ' = <b>' + n2(p.req)
            + ' м</b>. Hпр — свободный напор у прибора (п. 8.21 СП 30).</li>');

        if (pumped) {
            h.push('<li><b>Напор насоса</b> Hp = Hтр − Hгар = ' + n2(p.req) + ' − ' + n2(hgar) + ' = <b>' + n2(sys.pump.hp) + ' м</b> при расходе Qтр = '
                + num(sys.pump.q, 3) + ' л/с (' + num(sys.pump.qM3h, 2) + ' м³/ч). Гарантированный напор Hгар уже есть в сети, насос добавляет остальное.</li>');
        } else {
            h.push('<li><b>Сеть</b>: потребный напор ' + n2(p.req) + ' м, гарантированный Hгар = ' + n2(hgar) + ' м — '
                + (sys.pump.deficit > 0.05 ? 'не хватает ' + n2(sys.pump.deficit) + ' м, нужен насос.' : 'напора хватает.') + '</li>');
        }

        var lastSec = route.sections[N - 1];
        h.push('<li><b>Проверка по таблице.</b> Напор в точке ' + (N + 1) + ' (у прибора), собранный по участкам от Hгар на вводе, равен '
            + n2(lastSec.dynEnd) + ' м — это и есть Hпр = ' + n2(p.pr) + ' м.</li>');

        h.push('</ol>');

        h.push('<div class="scroll"><table class="grid"><thead><tr><th>Точки</th><th class="left">Участок</th><th>q, л/с</th><th class="left">Труба</th>'
            + '<th>L, м</th><th>V, м/с</th><th>i, мм/м</th><th>Hl, м</th><th>Hмест, м</th><th>Обор., м</th><th>+ насос, м</th>'
            + '<th>Подъём, м</th><th>Напор в начале, м</th><th>Напор в конце, м</th></tr></thead><tbody>');

        var sum = { L: 0, hFr: 0, local: 0, equip: 0, gain: 0 };

        route.sections.forEach(function (sec) {
            sum.L += sec.L;
            sum.hFr += sec.hFr;
            sum.local += sec.local;
            sum.equip += sec.equip;
            sum.gain += sec.gain;
            var z = sec.size;
            h.push('<tr><td class="c">' + sec.no + ' → ' + (sec.no + 1) + '</td><td class="left">' + esc(sec.name) + (sec.what ? '<br><span class="dim">' + esc(sec.what) + '</span>' : '') + '</td>'
                + '<td>' + num(sec.q, 3) + '</td><td class="left">' + (z ? esc(z.label) : '—') + '</td><td>' + (sec.L ? num(sec.L, 1) : '—') + '</td>'
                + '<td>' + (z ? num(z.v, 2) : '—') + '</td><td>' + (z ? num(z.iMm, 2) : '—') + '</td>'
                + '<td>' + (sec.hFr ? num(sec.hFr, 3) : '—') + '</td><td>' + (sec.local ? num(sec.local, 3) : '—') + '</td>'
                + '<td>' + (sec.equip ? num(sec.equip, 2) : '—') + '</td><td>' + (sec.gain ? '+' + num(sec.gain, 2) : '—') + '</td>'
                + '<td>' + (Math.abs(sec.dz) > 0.005 ? num(sec.dz, 2) : '—') + '</td><td>' + num(sec.dynStart, 2) + '</td><td><b>' + num(sec.dynEnd, 2) + '</b></td></tr>');
        });

        h.push('<tr class="total"><td class="left" colspan="4">Итого</td><td>' + num(sum.L, 1) + '</td><td></td><td></td><td>' + num(sum.hFr, 3) + '</td><td>' + num(sum.local, 3)
            + '</td><td>' + num(sum.equip, 2) + '</td><td>+' + num(sum.gain, 2) + '</td><td colspan="3"></td></tr>');
        h.push('</tbody></table></div>'
            + '<p class="hint">Напор в конце участка = напор в начале − Hl − Hмест − оборудование + напор насоса − подъём трубы на участке (напор — это пьезометрическая высота минус отметка точки). '
            + 'Начало отсчёта — Hгар на вводе.</p></div>');

        return h.join('');
    }

    /* «Расчёт напоров» по форме приложений образца ИОС2. */
    function headForm(sys, s, inp) {
        var p = sys.dict.part;
        var leaf = sys.dict.leaf;
        var pumped = sys.kind === 'pump';
        var ref = pumped ? sys.node.elev : inp.input.elev;
        var hgar = inp.input.Hgar;
        var out = [];

        function line(name, formula, value, note) {
            out.push('<tr><td class="l"><b>' + name + '</b></td><td class="l">' + formula + '</td><td><b>' + num(value, 2) + '</b></td><td class="l dim">' + (note || '') + '</td></tr>');
        }

        out.push('<div class="card"><h2>Расчёт напоров — ' + esc(sys.name) + '</h2>'
            + '<p class="hint">Диктующий прибор: <b>' + esc(leaf.label) + '</b> (' + (leaf.net === 'c' ? 'ХВС' : 'ГВС') + '), отметка '
            + num(leaf.elev, 2) + ' м' + (leaf.floor ? ', этаж ' + leaf.floor : '') + '. '
            + 'Hp = Hgeom + ΣHl,tot + Hпр − Hгар.</p>'
            + '<div class="scroll"><table class="grid"><thead><tr><th class="left">Составляющая</th><th class="left">Формула</th><th>Значение, м</th><th class="left">Примечание</th></tr></thead><tbody>');

        line('Hgeom', 'отметка прибора − отметка ' + (pumped ? 'оси насосов' : 'ввода') + ' = ' + num(leaf.elev, 2) + ' − (' + num(ref, 2) + ')', p.geom, '');
        line('Hl кв', 'потери по длине в квартирной разводке', p.lApt, '');
        line('Hl ст', 'потери по длине в стояках и этажных ветках', p.lRiser, '');
        line('Hl маг', 'потери по длине в магистралях, подаче в ИТП и на вводе', p.lMains, '');
        line('ΣHl', 'Hl кв + Hl ст + Hl маг', p.sumL, '');
        line('Hмест', 'Kl · ΣHl = ' + num(s.kl, 2) + ' · ' + num(p.sumL, 2), p.local, 'п. 8.28 СП 30');
        line('Hсч кв+ф', 'квартирный счётчик с фильтром', p.mApt, '');
        line('Hсч+ф секц', 'счётчик секции / встроенного с фильтром', p.mSec, '');
        line('Hрег.д+ф', 'регулятор давления у диктующего прибора', p.reg, leaf.reg ? 'статика ' + num(leaf.static, 1) + ' м выше ' + num(s.staticLimit, 0) + ' м' : 'не требуется');
        line('Hнс', 'потери в насосной станции', p.ns, '');
        line('Hитп', 'потери в ИТП', p.itp, p.itp > 0 ? 'диктует ГВС' : '');
        line('Hв', 'потери во вводе', p.hv, '');
        line('Hсч+ф', 'водомерный узел на вводе с фильтром', p.main, '');
        line('ΣHl,tot', 'ΣHl + Hмест + Hсч кв+ф + Hсч+ф секц + Hрег + Hнс + Hитп + Hв + Hсч+ф', p.tot, '');
        line('Hпр', 'свободный напор у диктующего прибора', p.pr, 'п. 8.21 СП 30');
        line('Hтр,полн', 'Hgeom + ΣHl,tot + Hпр', p.req, '');
        line('Hгар', 'гарантированный напор в городской сети', hgar, '');
        out.push('<tr class="total"><td class="l">Hp</td><td class="l">' + (pumped ? 'Hтр,полн − Hгар' : 'без насоса: Hгар − Hтр,полн') + '</td><td>'
            + num(sys.pump.pumped ? sys.pump.hp : hgar - p.req, 2) + '</td><td class="l">'
            + (sys.pump.pumped ? 'Qтр = ' + num(sys.pump.q, 3) + ' л/с' : (sys.pump.deficit > 0.05 ? 'не хватает ' + num(sys.pump.deficit, 1) + ' м' : 'напора хватает')) + '</td></tr>');
        out.push('</tbody></table></div>');

        out.push('<h3>Участки диктующего пути</h3><div class="scroll"><table class="grid"><thead><tr><th class="left">Участок</th><th class="left">Сеть</th><th>q, л/с</th>'
            + '<th class="left">Труба</th><th>L, м</th><th>V, м/с</th><th>i, мм/м</th><th>h, м</th><th class="left">Узел учёта</th></tr></thead><tbody>');

        p.path.forEach(function (sg) {
            var z = sg.res.size;
            out.push('<tr data-segrow="' + esc(sg.id) + '"><td class="left">' + esc(sg.name) + '</td><td class="left">' + (sg.net === 'c' ? 'ХВС' : 'ГВС') + '</td>'
                + '<td>' + num(sg.res.q, 3) + '</td><td class="left">' + (z ? esc(z.label) : '—') + '</td><td>' + num(sg.L, 1) + '</td>'
                + '<td>' + (z ? num(z.v, 2) : '—') + '</td><td>' + (z ? num(z.iMm, 2) : '—') + '</td><td>' + (z ? num(z.h, 3) : '—') + '</td>'
                + '<td class="left">' + (sg.res.meter && sg.res.meter.pick ? esc(sg.res.meter.mark) + ' ' + num(sg.res.meter.h, 2) + ' м' : '') + '</td></tr>');
        });

        out.push('</tbody></table></div></div>');
        return out.join('');
    }

    /* --- события ------------------------------------------------------------------- */

    function onChange(e, changed) {
        var id = e.target.id;

        if (id === 'hvSys') { state.sysId = e.target.value; show(state.sub, result); }
        else if (id === 'hvKind') { state.rowKind = e.target.value; show(state.sub, result); }
        else if (id === 'hvRowNet') { state.rowNet = e.target.value; show(state.sub, result); }
    }

    function onClick(e, changed) {
        var v = e.target.closest('[data-v]');

        if (v) {
            var act = v.getAttribute('data-v');
            var arg = v.getAttribute('data-arg');

            if (act === 'autoLen') { delete hyd().lengths[arg]; changed(false); }
            else if (act === 'exportRows') { exportRows(); }
            else if (act === 'naporApp') { naporExport(false); }
            else if (act === 'naporWork') { naporExport(true); }
            else if (act === 'metersWord') { if (result) HydReport.metersToWord(result, hyd()); }
            else if (act === 'gotoMeter') {
                var p = arg.split('|');
                state.sub = 'scheme';
                state.net = p[1];
                state.selected = { type: 'node', id: p[0] };
                state.multi = [];
                UiHyd.renderBody();
            }
            return;
        }

        var tr = e.target.closest('[data-segrow]');
        if (tr && (state.sub === 'rows' || state.sub === 'heads')) {
            state.rowSeg = tr.getAttribute('data-segrow');
            if (state.sub === 'rows') show('rows', result);
            else {
                var card = document.getElementById('hvCardHeads');
                if (!card) {
                    card = document.createElement('div');
                    card.id = 'hvCardHeads';
                    body.appendChild(card);
                }
                card.innerHTML = segCard(result, state.rowSeg);
                card.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    function naporExport(work) {
        if (!result || !result.input) return;
        var t = document.getElementById('hydHist');
        try {
            if (work) HydNote.saveWorkTables(App.project, result, hyd());
            else HydNote.saveNapor(App.project, result, hyd());
            if (t) t.textContent = work ? 'Рабочие таблицы напоров выгружены в Word.' : 'Приложение «Расчёт напоров» выгружено в Word.';
        } catch (e) { if (t) t.textContent = 'Не выгружено: ' + e.message; }
    }

    function exportRows() {
        if (typeof HydReport === 'undefined' || !result) return;
        HydReport.toExcel(result, hyd());
    }

    return { init: init, show: show, onChange: onChange, onClick: onClick, segCard: segCard };
})();
