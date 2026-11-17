'use strict';

/*
    Выгрузка в Excel живыми формулами — как рабочий калькулятор АПТ.

    В каждой расчётной ячейке стоит формула, а не число: щёлкнул — видно,
    откуда оно взялось; поменял исходные данные — таблица пересчиталась.

      Исходные данные  параметры на зелёном фоне, qi, q, f формулами
      Расчет           H = H пред. + ΔH пред.;  Q = Q пред. + k·√H + лучи;
                       V и ΔH = Q²·L/Kт формулами; Kт — СУММЕСЛИМН по «Трубам»;
                       строка приведения луча Q = Qк·√(Hуз/Hк)
      Вывод данных     Нгеом, Нсети, Нуу, Нтр, Ннас — ссылками на листы
      Пожарные краны   Q = струи × расход, требуемый напор у узла
      Трубы            справочник Kт

    Формулы — это марш по СП, тот же, что в Excel. Он совпадает с решателем
    программы точно (проверено в tests.html пересчётом каждой формулы), пока
    не поменяли исходные данные так, что диктующим стал другой ороситель:
    тогда формулы честно покажут старую схему, и таблицу надо выгрузить
    заново из программы.

    Кэшированные значения формул записываются теми же числами, что показывает
    программа, — их видно и в просмотрщиках, которые не умеют считать.
*/

var ExcelExport = (function () {

    var IN_SHEET = 'Исходные данные';
    var CALC_SHEET = 'Расчет';
    var OUT_SHEET = 'Вывод данных';
    var PK_SHEET = 'Пожарные краны';
    var PIPE_SHEET = 'Трубы';

    /* Строки листа «Исходные данные». Столбец значения — B. */
    var IN = {
        group: 3, I: 4, S: 5, maker: 6, type: 7, H: 8, k: 9, L: 10,
        elSpr: 11, elIn: 12, cu: 13, xi: 14, suction: 15, guar: 16,
        pump: 17, local: 18, system: 19, code: 20, reserve: 21,
        qi: 22, q: 23, f: 24, Qn: 25
    };

    var HEAD = ['№ уч.', 'Напор Н, м вод. ст.', 'Удельн. хар-ка тр-да Kт', 'Коэф. произв. оросит. k',
        'Расход Q, л/с', 'Ду, мм', 'Наружн. диаметр, мм', 'Толщ. стенки, мм', 'Материал трубы',
        'Скорость V, м/с', 'L, м', 'Потери ΔH, м', 'Откуда расход'];

    /** На плане кранов в столбцах Kт и k стоят λ и Re — счёт по Шевелеву. */
    function headOf(s) {
        if (s.planKind !== 'vpv') return HEAD;
        var out = HEAD.slice();
        out[2] = 'Коэф. трения λ';
        out[3] = 'Re';
        return out;
    }

    function sheetRef(name) {
        return "'" + name + "'!";
    }

    function inRef(row) {
        return sheetRef(IN_SHEET) + '$B$' + row;
    }

    function F(formula, value, style) {
        return { f: formula, v: value, s: style || 'num2' };
    }

    function V(value, style) {
        return { v: value, s: style };
    }

    function head(text) {
        return V(text, 'head');
    }

    /** Число внутри формулы: точка, без хвоста двоичной арифметики. */
    function lit(x) {
        return String(Number(x.toPrecision(12)));
    }

    /* --- Исходные данные ------------------------------------------------ */

    function inputsSheet(app) {
        var s = app.project.settings;
        var h = app.calc.head;
        var c = app.calc.checks;
        var g = [];

        function put(row, label, value, unit, note) {
            g[row - 1] = [V(label, 'text'), value, V(unit || '', 'text'), V(note || '', 'note')];
        }

        g[0] = [V('Исходные данные. Зелёные ячейки можно менять — листы «Расчет» и «Вывод данных» пересчитаются', 'title')];
        g[1] = ['Параметр', 'Значение', 'Ед. изм.', 'Примечание'].map(head);

        put(IN.group, 'Группа помещений', V(s.group, 'text'));
        put(IN.I, 'Интенсивность орошения', V(s.intensity, 'input'), 'л/(с·м²)');
        put(IN.S, 'Площадь для расчёта расхода', V(s.area, 'input'), 'м²');
        put(IN.maker, 'Производитель оросителей', V(s.maker, 'text'));
        put(IN.type, 'Тип оросителя', V(s.sprinklerType, 'text'));
        put(IN.H, 'Давление на диктующем оросителе', V(s.dictHead, 'input'), 'м вод. ст.');
        put(IN.k, 'Коэффициент производительности оросителя k', V(s.k, 'input'), 'л/(с·МПа^0,5)');
        put(IN.L, 'Шаг между оросителями', V(s.spacing, 'input'), 'м');
        put(IN.elSpr, 'Относительная отметка установки оросителя', V(s.sprinklerElev, 'input'), 'м');
        put(IN.elIn, 'Глубина заложения ввода относительно 0,000', V(s.inletElev, 'input'), 'м');
        put(IN.cu, 'Узел управления', V(s.cuKind + ' Ду' + s.cuDn, 'text'));
        put(IN.xi, 'Коэффициент потерь в узле управления ξ', V(h.xi, 'inputSci'), '',
            h.xiFromTable ? 'по таблице узлов управления' : 'введён вручную');
        put(IN.suction, 'Потери на всасывающих трубопроводах', V(s.suction, 'input'), 'м');
        put(IN.guar, 'Гарантированный напор на вводе', V(s.guaranteed, 'input'), 'м');
        put(IN.pump, 'Потери напора в насосной установке', V(s.pumpLoss, 'input'), 'м');
        put(IN.local, 'Коэффициент местных сопротивлений', V(s.localFactor, 'input'), '', '1,2 — 20 %, СП 485 п. Б.1.3.13');
        put(IN.system, 'Система', V(s.systemKind, 'text'));
        put(IN.code, 'Шифр объекта', V(s.code, 'text'));

        // План внутреннего пожаротушения считается по Дарси–Вейсбаху: в
        // формулах листа участвует расчётный диаметр dр = d − запас.
        if (s.planKind === 'vpv') {
            var hy = s.hydr || {};
            put(IN.reserve, 'Запас к диаметру на отложения', V(hy.reserve > 0 ? hy.reserve : 0, 'input'), 'мм',
                'трубы не новые: dр = d − запас, по нему V, λ и потери');
        }

        put(IN.qi, 'qi = I·L²', F('B' + IN.I + '*B' + IN.L + '^2', c.qi, 'num3'), 'л/с');
        put(IN.q, 'q = k·√H', F('B' + IN.k + '*SQRT(B' + IN.H + ')', c.q, 'num3'), 'л/с');
        put(IN.f, 'f = qi / q', F('B' + IN.qi + '/B' + IN.q, c.f, 'num3'), '', 'не более 0,85 — в «мёртвых зонах» интенсивность обеспечена');
        put(IN.Qn, 'Нормативный расход I·S', F('B' + IN.I + '*B' + IN.S, c.normFlow), 'л/с');

        return { name: IN_SHEET, grid: g, widths: [48, 16, 14, 46] };
    }

    /* --- Трубы ---------------------------------------------------------- */

    function pipesSheet() {
        var g = [
            [V('Удельные характеристики трубопроводов Kт — СП 485 табл. Б.2 и калькулятор АПТ', 'title')],
            ['Материал', 'Ду', 'Наружный диаметр, мм', 'Толщина стенки, мм', 'Kт', 'Внутренний диаметр, мм'].map(head)
        ];

        Catalog.MATERIALS.forEach(function (m) {
            m.sizes.forEach(function (r) {
                var row = g.length + 1;
                g.push([V(m.key, 'text'), V(r.dn, 'num'), V(r.od, 'num'), V(r.wall, 'num'), V(r.kt, 'input'),
                    F('C' + row + '-2*D' + row, r.od - 2 * r.wall, 'num')]);
            });
        });

        return { name: PIPE_SHEET, grid: g, widths: [20, 8, 14, 14, 14, 14] };
    }

    function inCatalog(seg) {
        return Catalog.sizes(seg.material).some(function (r) {
            return r.od === seg.od && r.wall === seg.wall;
        });
    }

    /* --- Пожарные краны ------------------------------------------------- */

    function hydrantRows(app) {
        var rows = {};
        (app.calc.hydrants || []).forEach(function (k, i) { rows[k.id] = 3 + i; });
        return rows;
    }

    function hydrantsSheet(app, pkRow, calcRowOf) {
        var list = app.calc.hydrants || [];
        if (!list.length) return null;

        var g = [
            [V('Пожарные краны — входят в расчётную сеть АУП, СП 485 п. Б.1.3.16', 'title')],
            ['Пожарный кран', 'Число струй', 'Расход струи, л/с', 'Расход Q, л/с', 'Давление у клапана требуемое, м',
                'Отметка клапана, м', 'Требуемый напор в узле (к отметке оросителей), м', 'Давление у клапана расчётное, м'].map(head)
        ];

        list.forEach(function (k) {
            var row = pkRow[k.id];
            var at = calcRowOf[k.id];
            var needValue = k.head - (Model.planeElev(app.project.settings) - k.elev);

            g[row - 1] = [
                V(k.name, 'text'),
                V(k.jets, 'input'),
                V(k.flow, 'input'),
                F('B' + row + '*C' + row, k.Q),
                V(k.head, 'input'),
                V(k.elev, 'input'),
                F('E' + row + '-(' + inRef(IN.elSpr) + '-F' + row + ')', needValue),
                k.reach && at
                    ? F(sheetRef(CALC_SHEET) + '$B$' + at + '+(' + inRef(IN.elSpr) + '-F' + row + ')', k.valve)
                    : V(k.reach ? k.valve : 'не соединён', k.reach ? 'num2' : 'text')
            ];
        });

        return { name: PK_SHEET, grid: g, widths: [16, 12, 14, 12, 18, 14, 22, 18] };
    }

    /* --- Расчет --------------------------------------------------------- */

    function groupTitle(calc, g) {
        for (var i = 0; i < calc.rows.length; i++) {
            if (calc.rows[i].type === 'group' && calc.rows[i].group === g) return calc.rows[i].text;
        }
        return g.name;
    }

    /**
     * Раскладка строк: заголовок группы, строки участков, итог или строка
     * приведения, пустая строка. Адреса известны заранее, поэтому строка
     * основной ветви может сослаться на строку приведения луча ниже неё.
     */
    function layout(groups) {
        var lay = [];
        var r = 3;

        groups.forEach(function (g) {
            var L = { header: r++, rowOf: {} };
            for (var i = 0; i + 1 < g.path.length; i++) L.rowOf[g.path[i]] = r++;
            L.end = r++;
            r++;
            lay[g.index] = L;
        });

        return lay;
    }

    function calcSheet(app, lay, pkRow) {
        var p = app.project;
        var s = p.settings;
        var net = app.net;
        var calc = app.calc;
        /*
            План внутреннего пожаротушения: расходы кранов заданы, приводить
            лучи не к чему, а потери считаются по Дарси–Вейсбаху с λ по
            Шевелеву — формулы листа идут по dр = d − запас.
        */
        var byPlan = s.planKind === 'vpv';
        var sp = s.tableMode !== 'actual' && !byPlan;
        var shevelev = byPlan && (!s.hydr || s.hydr.formula === 'shevelev');
        var byId = {};
        var segById = {};
        var g = [];

        p.nodes.forEach(function (n) { byId[n.id] = n; });
        p.segments.forEach(function (x) { segById[x.id] = x; });

        g[0] = [V(s.tableTitle, 'title')];
        g[1] = headOf(s).map(head);

        /** Расчётный диаметр строки в метрах: (d − 2·стенка − запас) / 1000. */
        function dCalc(row) {
            return '((G' + row + '-2*H' + row + '-' + inRef(IN.reserve) + ')/1000)';
        }

        calc.groups.forEach(function (grp) {
            var L = lay[grp.index];
            var beta = sp ? grp.beta : 1;
            var root = Math.sqrt(beta);
            var i;

            g[L.header - 1] = [V(groupTitle(calc, grp), 'group')];

            for (i = 0; i + 1 < grp.path.length; i++) {
                var id = grp.path[i];
                var row = L.rowOf[id];
                var info = net.N[id];
                var seg = net.S[info.pseg];
                var model = segById[info.pseg];
                var n = byId[id];
                var cells = [];
                var terms = [];
                var notes = [];
                var Hv = info.H * beta;
                var Qv = seg.Q * root;

                cells[0] = V(grp.labels[id] + '-' + grp.labels[grp.path[i + 1]], 'text');

                // Напор: первая строка — от диктующего, дальше H пред. + ΔH пред.
                if (i > 0) {
                    cells[1] = F('B' + (row - 1) + '+L' + (row - 1), Hv);
                } else if (info.working && Math.abs(Hv - s.dictHead) < 1e-9) {
                    cells[1] = F(inRef(IN.H), Hv);
                } else if (n.pk && pkRow[id] && net.dict === id) {
                    cells[1] = F(sheetRef(PK_SHEET) + '$G$' + pkRow[id], Hv);
                } else {
                    cells[1] = V(Hv, 'num2');
                }

                // λ по Шевелеву — явная формула: по скорости и расчётному диаметру.
                if (byPlan) {
                    cells[2] = shevelev
                        ? F('IF(J' + row + '>=1.2,0.021/' + dCalc(row) + '^0.3,'
                            + '0.0179/' + dCalc(row) + '^0.3*(1+0.867/J' + row + ')^0.3)', seg.lambda, 'num3')
                        : V(seg.lambda, 'num3');
                    cells[3] = V(seg.Re, 'num');
                } else if (seg.ktSource === 'manual') {
                    cells[2] = V(seg.kt, 'input');
                } else if (seg.ktSource === 'table' && inCatalog(model)) {
                    var P = sheetRef(PIPE_SHEET);
                    cells[2] = F('SUMIFS(' + P + '$E:$E,' + P + '$A:$A,I' + row + ',' + P + '$C:$C,G' + row + ','
                        + P + '$D:$D,H' + row + ')', seg.kt, 'num');
                } else if (seg.kt > 0) {
                    cells[2] = F('10^-10*864.6122*(G' + row + '-2*H' + row + '-1)^5.3333', seg.kt, 'num');
                } else {
                    cells[2] = V(0, 'input');
                }

                // Расход: предыдущий участок + ороситель + постоянный расход + лучи.
                if (i > 0) {
                    var mPrev = net.S[net.N[grp.path[i - 1]].pseg].m;
                    terms.push(mPrev === 1 ? 'E' + (row - 1) : 'E' + (row - 1) + '/' + lit(mPrev));
                    notes.push('Q пред.');
                }

                if (info.working) {
                    cells[3] = n.k > 0 ? V(n.k, 'input') : F(inRef(IN.k), info.k, 'num');
                    terms.push('D' + row + '*SQRT(B' + row + ')');
                    notes.push('k·√H');
                }

                if (info.fixed > 0) {
                    if (n.pk && pkRow[id] && Math.abs(beta - 1) < 1e-12) {
                        terms.push(sheetRef(PK_SHEET) + '$D$' + pkRow[id]);
                        notes.push(Model.hydrantName(p, n));
                        if (n.q > 0) {
                            terms.push(lit(n.q));
                            notes.push('доп. ' + Fmt.trim(n.q, 2));
                        }
                    } else {
                        // В кадре «как в СП» постоянный расход масштабируется на √β.
                        terms.push(lit(info.fixed * root));
                        notes.push('пост. расход');
                    }
                }

                grp.children.forEach(function (child) {
                    if (child.attach !== id) return;
                    terms.push('E' + lay[child.index].end);
                    notes.push('луч ' + child.name);
                });

                if (terms.length) {
                    var sum = terms.join('+');
                    cells[4] = F(seg.m === 1 ? sum : '(' + sum + ')*' + lit(seg.m), Qv);
                } else {
                    cells[4] = V(Qv, 'num2');
                }

                cells[5] = V(seg.dn === null ? '' : seg.dn, 'num');
                cells[6] = V(model.od, 'num');
                cells[7] = V(model.wall, 'num');
                cells[8] = V(model.material, 'text');
                // Скорость и потери: у плана кранов — по dр и Дарси–Вейсбаху.
                cells[9] = byPlan
                    ? F('4*E' + row + '/1000/(PI()*' + dCalc(row) + '^2)', seg.V)
                    : F('4*E' + row + '/1000/(PI()*((G' + row + '-2*H' + row + ')/1000)^2)', Solver.velocity(Qv, seg.dIn));
                cells[10] = V(seg.L, model.len > 0 ? 'input' : 'num2');
                cells[11] = byPlan
                    ? F('C' + row + '*K' + row + '/' + dCalc(row) + '*J' + row + '^2/(2*9.81)', seg.dH, 'num3')
                    : F('E' + row + '^2*K' + row + '/C' + row, seg.dH * beta, 'num3');
                cells[12] = V('Q = ' + notes.join(' + ') + (seg.m !== 1 ? '; ×' + Fmt.trim(seg.m, 2) + ' — полукольцо' : ''), 'note');

                g[row - 1] = cells;
            }

            if (grp.path.length < 2) return;

            var lastId = grp.path[grp.path.length - 2];
            var lastRow = L.rowOf[lastId];
            var lastSeg = net.S[net.N[lastId].pseg];
            var lastQ = lastSeg.m === 1 ? 'E' + lastRow : 'E' + lastRow + '/' + lit(lastSeg.m);
            var firstRow = L.rowOf[grp.path[0]];
            var end = [];

            if (grp.kind === 'main') {
                var srcId = grp.path[grp.path.length - 1];
                var total = [lastQ];
                var totalNotes = ['Q последнего участка'];

                if (net.N[srcId].fixed > 0) {
                    total.push(lit(net.N[srcId].fixed));
                    totalNotes.push('пост. расход');
                }
                grp.children.forEach(function (child) {
                    if (child.attach !== srcId) return;
                    total.push('E' + lay[child.index].end);
                    totalNotes.push('луч ' + child.name);
                });

                for (i = 0; i < 13; i++) end[i] = V('', 'totalText');
                end[0] = V('Итого', 'totalText');
                end[1] = F('B' + lastRow + '+L' + lastRow, net.Hsource, 'totalNum2');
                end[4] = F(total.join('+'), net.Qtotal, 'totalNum2');
                end[11] = F('SUM(L' + firstRow + ':L' + lastRow + ')', net.HnetRaw, 'totalNum2');
                end[12] = V('H на вводе; Q = ' + totalNotes.join(' + ') + '; ΔH — сумма по основной ветви', 'totalText');
            } else {
                var parentLay = lay[grp.parent.index];
                var parentLast = grp.parent.path[grp.parent.path.length - 1];
                var hRow = parentLay.rowOf[grp.attach] || (grp.parent.kind === 'main' && grp.attach === parentLast ? parentLay.end : null);
                var parentBeta = sp ? grp.parent.beta : 1;
                var Hk = net.N[grp.attach].H * beta;
                var Hnode = net.N[grp.attach].H * parentBeta;
                var Qs = lastSeg.Qsub * root * Math.sqrt(Hnode / Hk);

                end[0] = V('→ ' + grp.parent.labels[grp.attach], 'text');
                end[1] = F('B' + lastRow + '+L' + lastRow, Hk);

                // У кранов расход задан: луч приходит в узел как есть.
                end[4] = byPlan ? F(lastQ, Qs)
                    : hRow ? F(lastQ + '*SQRT(B' + hRow + '/B' + L.end + ')', Qs)
                        : V(Qs, 'num2');
                end[12] = V(byPlan
                    ? 'Hк = H пред. + ΔH; Q — расход луча в узел ' + grp.parent.labels[grp.attach]
                    : 'Hк = H пред. + ΔH; Q = Qк·√(Hуз/Hк), Hуз — ячейка B' + (hRow || '?')
                        + ' (узел ' + grp.parent.labels[grp.attach] + ')', 'note');
            }

            g[L.end - 1] = end;
        });

        return { name: CALC_SHEET, grid: g, widths: [12, 12, 14, 10, 12, 7, 11, 10, 16, 11, 9, 11, 46] };
    }

    /* --- Вывод данных --------------------------------------------------- */

    /** Номер приложения — общий счёт книги; в самопроверке книги нет. */
    function appendixNo(app) {
        if (typeof App === 'undefined' || !App.book) return '';
        return Appendix.of(App.book, Appendix.keyOf(App.book, Systems.active(App.book), app.plan && app.plan.plan));
    }

    function outputSheet(app, lay) {
        var s = app.project.settings;
        var h = app.calc.head;
        var main = app.calc.groups[0];
        var L = lay[main.index];
        var C = sheetRef(CALC_SHEET);
        var qRef = C + '$E$' + L.end;
        var firstRow = L.rowOf[main.path[0]];
        var g = [];
        var r = 0;

        function line(cells) { g[r++] = cells; }

        line([V('Приложение ' + appendixNo(app), 'title')]);
        line([V('Определение требуемого напора в системе ' + s.systemName, 'title')]);
        line([V('Расчёт напора по методике СП 485.1311500.2020 для наиболее удалённого и высокорасположенного оросителя, '
            + 'пожаротушение ' + s.objectText, 'note')]);
        r++;
        line(['Составляющая', 'Формула', 'Значение, м', 'Откуда'].map(head));

        var rows = {};
        function put(key, name, formula, value, source, style) {
            rows[key] = r + 1;
            line([V(name, style === 'totalNum2' ? 'totalText' : 'text'), V(formula, style === 'totalNum2' ? 'totalText' : 'text'),
                F(value.f, value.v, style || 'num2'), V(source, 'note')]);
        }

        put('geom', 'Нгеом', 'отм. оросителя − отм. ввода',
            { f: inRef(IN.elSpr) + '-' + inRef(IN.elIn), v: h.Hgeom }, 'Исходные данные B' + IN.elSpr + ', B' + IN.elIn);
        put('netRaw', 'Нсети без местных', 'Σ ΔH основной ветви',
            { f: C + '$L$' + L.end, v: h.HnetRaw }, 'Расчет L' + L.end);
        put('net', 'Нсети', 'Нсети без местных × коэф.',
            { f: 'C' + rows.netRaw + '*' + inRef(IN.local), v: h.Hnet }, 'коэффициент — Исходные данные B' + IN.local);
        put('cu', 'Нуу', '1000·ξ·(Q·3,6)²',
            { f: '1000*' + inRef(IN.xi) + '*(' + qRef + '*3.6)^2', v: h.Hcu }, 'ξ — Исходные данные B' + IN.xi + ', Q — Расчет E' + L.end);
        put('free', 'Нсв', h.dictKind === 'pk' ? 'напор у диктующего ПК' : 'напор у диктующего оросителя',
            { f: C + '$B$' + firstRow, v: h.Hfree }, 'Расчет B' + firstRow);
        put('suction', 'Нвсас', 'потери во всасывающих',
            { f: inRef(IN.suction), v: h.Hsuction }, 'Исходные данные B' + IN.suction);
        put('pump', 'Ннас', 'потери в насосной установке',
            { f: inRef(IN.pump), v: h.Hpump }, 'Исходные данные B' + IN.pump);
        put('req', 'Нтр', 'Нгеом + Ннас + Нсети + Нуу + Нсв + Нвсас',
            { f: 'C' + rows.geom + '+C' + rows.pump + '+C' + rows.net + '+C' + rows.cu + '+C' + rows.free + '+C' + rows.suction, v: h.Hreq },
            '', 'totalNum2');
        put('guar', 'Нгар', 'гарантированный напор на вводе',
            { f: inRef(IN.guar), v: h.Hguar }, 'Исходные данные B' + IN.guar);
        put('pumpReq', 'Ннас.треб', 'Нтр − Нгар',
            { f: 'C' + rows.req + '-C' + rows.guar, v: h.HpumpReq }, '', 'totalNum2');

        r++;
        line([V('Расчётный расход Q, л/с', 'text'), V('', 'text'), F(qRef, h.Q), V('Расчет E' + L.end, 'note')]);
        line([V('Расчётный расход Q, м³/ч', 'text'), V('Q · 3,6', 'text'), F('C' + r + '*3.6', h.Q * 3.6), V('', 'note')]);
        r++;
        line([V(h.HpumpReq > 0
            ? 'Требуемый напор обеспечивает насосная установка: ' + (s.pumpText || '________________')
            : 'Насосная установка не требуется: требуемый напор обеспечивает гарантированный напор наружной сети — '
                + Fmt.num(h.Hguar, 2) + ' м', 'note')]);
        line([V('Таблица участков — лист «' + CALC_SHEET + '»' + (app.calc.hydrants.length ? ', пожарные краны — лист «' + PK_SHEET + '»' : ''), 'note')]);

        return { name: OUT_SHEET, grid: g, widths: [26, 40, 14, 44] };
    }

    /* --- книга ---------------------------------------------------------- */

    /**
        Лист «Стояк» — только у плана этажа системы «АПТ по этажам»: продолжение
        от врезки в стояк до насосной и итог по всей системе. Потери участков
        живут формулами Q²·L/Kт, как и на листе «Расчет».
    */
    function riserSheet(app) {
        if (!app.plan || typeof App === 'undefined' || !App.book) return null;

        var sys = Systems.find(App.book, app.plan.sys);
        if (!sys || !sys.floors) return null;

        var v = sys.floors;
        var res = Floors.solve(v, App.book);
        var chain = Floors.chain(v, res, app.plan.plan);
        if (!chain) return null;

        var rec = chain.rec;
        var i = v.inlet;
        var g = [
            [V('Стояк ' + sys.code + ' — от врезки этажа до насосной', 'title')],
            ['Участок', 'Q, л/с', 'Ду', 'Dнар, мм', 'Стенка, мм', 'L, м', 'Kт', 'V, м/с', 'ΔH, м'].map(head)
        ];

        chain.rows.forEach(function (r) {
            var n = g.length + 1;
            g.push([
                V(r.name, 'text'), V(r.Q, 'input'), V(r.dn || '', 'num'), V(r.od, 'num'), V(r.wall, 'num'),
                V(r.L, 'input'), V(r.kt, 'num'),
                F('4*B' + n + '/1000/(PI()*((D' + n + '-2*E' + n + ')/1000)^2)', r.V),
                F('B' + n + '^2*F' + n + '/G' + n, r.dH, 'num3')
            ]);
        });

        var first = 3;
        var last = g.length;
        var sumRow = g.length + 1;
        g.push([V('Итого по стояку и магистрали', 'text'), V('', 'text'), V('', 'text'), V('', 'text'), V('', 'text'),
            V('', 'text'), V('', 'text'), V('', 'text'), F('SUM(I' + first + ':I' + last + ')', rec.dHr + rec.dHm, 'totalNum2')]);

        g.push([]);
        g.push([V('Требуемый напор системы ' + sys.code + ' (диктующий этаж: ' + res.dict.section.name + ', '
            + res.dict.floor.label + ')', 'title')]);
        g.push(['Величина', 'Формула', 'Значение, м'].map(head));

        var out = [];
        function put(name, formula, cell) {
            g.push([V(name, 'text'), V(formula, 'text'), cell]);
            out.push(g.length);
            return g.length;
        }

        var rPlan = put('ΣΔH сети этажа', 'из листа «Расчет»', V(rec.HplanRaw, 'num3'));
        var rRiser = put('ΣΔH стояка и магистрали', 'итог таблицы выше', F('I' + sumRow, rec.dHr + rec.dHm, 'num3'));
        var rNet = put('Нсети', '(этаж + стояк) × коэффициент', F('(C' + rPlan + '+C' + rRiser + ')*' + lit(i.localFactor), rec.Hnet));
        var rGeom = put('Нгеом', 'отм. этажа + h оросителей − отм. ввода',
            F(lit(rec.floor.elev) + '+' + lit(v.sprinklerHeight) + '-(' + lit(i.elev) + ')', rec.Hgeom));
        var rCu = put('Нуу', '1000·ξ·(Q·3,6)²', F('1000*' + lit(chain.xi) + '*(' + lit(rec.Qr) + '*3.6)^2', rec.Hcu));
        var rFree = put('Нсв', 'у диктующего оросителя', V(rec.Hfree, 'num2'));
        var rNode = put('Нпу + Ннас + Нвсас', 'поэтажный узел, насосная, всасывание',
            F(lit(v.floorNodeLoss) + '+' + lit(i.stationLoss) + '+' + lit(i.suction), v.floorNodeLoss + i.stationLoss + i.suction));
        var rReq = put('Нтр', 'сумма слагаемых',
            F('C' + rNet + '+C' + rGeom + '+C' + rCu + '+C' + rFree + '+C' + rNode, rec.Htr, 'totalNum2'));
        put('Нр', 'Нтр − Нгар (' + Fmt.num(i.guaranteed, 2) + ')', F('C' + rReq + '-' + lit(i.guaranteed), rec.Hp, 'totalNum2'));

        return { name: 'Стояк', grid: g, widths: [34, 10, 8, 11, 11, 9, 11, 10, 10] };
    }

    function sheets(app) {
        var lay = layout(app.calc.groups);
        var pkRow = hydrantRows(app);

        // Строка «Расчета», начинающаяся в узле: на неё ссылается лист кранов.
        var calcRowOf = {};
        app.calc.groups.forEach(function (grp) {
            var beta = app.project.settings.tableMode !== 'actual' ? grp.beta : 1;
            if (Math.abs(beta - 1) > 1e-12) return;
            Object.keys(lay[grp.index].rowOf).forEach(function (id) {
                if (!calcRowOf[id]) calcRowOf[id] = lay[grp.index].rowOf[id];
            });
        });

        var list = [
            inputsSheet(app),
            calcSheet(app, lay, pkRow),
            outputSheet(app, lay)
        ];

        var riser = riserSheet(app);
        if (riser) list.push(riser);

        var pk = hydrantsSheet(app, pkRow, calcRowOf);
        if (pk) list.push(pk);
        list.push(pipesSheet());

        return list;
    }

    return {
        SHEETS: { input: IN_SHEET, calc: CALC_SHEET, output: OUT_SHEET, pk: PK_SHEET, pipes: PIPE_SHEET },
        IN: IN,
        sheets: sheets
    };
})();
