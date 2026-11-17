/*
    Расчётные расходы воды и стоков по разделу 5 СП 30.13330.2020.

    Считаются три ветви сразу — общая, горячая и холодная, — потому что именно
    так они и нужны: в таблице водопотребления это строки «В1 общ.», «Т3» и
    «В1», а расход стоков берётся от общего.

    Формулы (номера по СП):

      (1)   q0   = sum(P_i * q0_i * N_i) / sum(P_i * N_i)   — свод по группам
      (2)   q    = 5 * q0 * alpha
      (3)   P    = q_hr,u * U / (3600 * q0 * N)
      (4)   P    = sum(q_hr,u,i * U_i) / (3600 * q0 * N)    — свод по группам
      (5)   q_s  = q_tot + q0_s
      (9)   P_hr = 3600 * P * q0 / q0_hr
      (10)  q_hr = 0,005 * q0_hr * alpha_hr
            q_T  = q_u * U / 1000
      (11)  q_ср = q_T / T

    Формулы перенесены из плагина WaterDemand один в один, вплоть до констант,
    и это проверяется тестами: tests.html считает те же эталонные числа, что
    WaterDemand\tests\demand.ps1.
*/

var Demand = (function () {
    'use strict';

    /* Разбор расчёта: формула, подстановка, результат — то, что читает эксперт. */
    function Trace() {
        this.lines = [];
    }

    Trace.prototype.section = function (title) {
        this.lines.push({ kind: 'section', text: title });
        return this;
    };

    Trace.prototype.note = function (text) {
        this.lines.push({ kind: 'note', text: text });
        return this;
    };

    Trace.prototype.formula = function (name, form, substitution, value, unit) {
        this.lines.push({
            kind: 'formula',
            name: name,
            form: form,
            substitution: substitution || '',
            value: value,
            unit: unit || ''
        });
        return this;
    };

    Trace.prototype.fromTable = function (name, table, argument, value, node) {
        this.lines.push({
            kind: 'table',
            name: name,
            table: table,
            argument: argument,
            value: value,
            node: !!node
        });
        return this;
    };

    Trace.prototype.text = function () {
        var out = [];

        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];

            if (line.kind === 'section') out.push('== ' + line.text);
            else if (line.kind === 'note') out.push(line.text);
            else if (line.kind === 'formula') {
                out.push(line.name + ' = ' + line.form
                    + (line.substitution ? ' = ' + line.substitution : '')
                    + ' = ' + Format.num(line.value) + (line.unit ? ' ' + line.unit : ''));
            } else if (line.kind === 'table') {
                out.push(line.name + ' = ' + Format.num(line.value)
                    + ' — по таблице ' + line.table + ' при ' + line.argument
                    + (line.node ? ' (по ближайшему большему узлу)' : ' (интерполяция)'));
            }
        }

        return out.join('\n');
    };

    /* --- одна ветвь: общая, горячая или холодная ------------------------- */

    /*
        kind — 'total' | 'hot' | 'cold'.

        Нулевая норма означает, что этой воды у потребителя нет: жилой дом без
        централизованного ГВС не имеет ни горячей ветви, ни холодной отдельно
        от общей. Такая ветвь возвращается пустой, а не нулями наугад.
    */
    function branch(group, kind, node, trace) {
        var norm = group.norm;

        var flow = {
            kind: kind,
            fixtures: group.fixtures,
            q0: 0, q0hr: 0,
            P: 0, NP: 0, alpha: 0, q: 0,
            Phr: 0, NPhr: 0, alphaHr: 0, qhr: 0,
            qDay: 0, qAvgHour: 0, khr: 0,
            table: ''
        };

        if (kind === 'hot') {
            flow.fixtures = group.fixturesHot;
            flow.q0 = norm.q0h;
            flow.q0hr = norm.q0hrh;
        } else if (kind === 'cold') {
            flow.q0 = norm.q0c;
            flow.q0hr = norm.q0hrc;
        } else {
            flow.q0 = norm.q0;
            flow.q0hr = norm.q0hr;
        }

        var qhru = kind === 'hot' ? norm.qhruh : (kind === 'cold' ? norm.qhruc : norm.qhru);
        var qu = kind === 'hot' ? norm.quh : (kind === 'cold' ? norm.quc : norm.qu);

        if (trace) trace.section(title(kind));

        if (!(flow.q0 > 0) || !(flow.fixtures > 0) || !(group.users > 0) || !(qhru > 0)) {
            if (trace) trace.note('Расход не считается: норма или число приборов равны нулю.');
            return flow;
        }

        // (3) вероятность действия приборов
        flow.P = qhru * group.users / (3600 * flow.q0 * flow.fixtures);
        flow.NP = flow.fixtures * flow.P;

        if (trace) {
            trace.formula('P', 'q_hr,u · U / (3600 · q0 · N)',
                Format.num(qhru) + ' · ' + group.users + ' / (3600 · '
                + Format.num(flow.q0) + ' · ' + flow.fixtures + ')', flow.P, '');

            trace.formula('N·P', 'N · P',
                flow.fixtures + ' · ' + Format.num(flow.P), flow.NP, '');
        }

        flow.table = Tables.tableOf(flow.fixtures, flow.P);
        flow.alpha = Tables.alpha(flow.fixtures, flow.P, node);

        if (trace) {
            trace.fromTable('α', flow.table,
                flow.table === 'Б.1'
                    ? 'N = ' + flow.fixtures + ' и P = ' + Format.num(flow.P)
                    : 'N·P = ' + Format.num(flow.NP),
                flow.alpha, node);
        }

        // (2) максимальный секундный расход
        flow.q = 5 * flow.q0 * flow.alpha;

        if (trace) {
            trace.formula('q', '5 · q0 · α',
                '5 · ' + Format.num(flow.q0) + ' · ' + Format.num(flow.alpha), flow.q, 'л/с');
        }

        // (9) вероятность использования приборов в течение часа
        if (flow.q0hr > 0) {
            flow.Phr = 3600 * flow.P * flow.q0 / flow.q0hr;
            flow.NPhr = flow.fixtures * flow.Phr;

            var tableHr = Tables.tableOf(flow.fixtures, flow.Phr);
            flow.alphaHr = Tables.alpha(flow.fixtures, flow.Phr, node);

            // (10) максимальный часовой расход
            flow.qhr = 0.005 * flow.q0hr * flow.alphaHr;

            if (trace) {
                trace.formula('P_hr', '3600 · P · q0 / q0_hr',
                    '3600 · ' + Format.num(flow.P) + ' · ' + Format.num(flow.q0)
                    + ' / ' + Format.num(flow.q0hr), flow.Phr, '');

                trace.formula('N·P_hr', 'N · P_hr',
                    flow.fixtures + ' · ' + Format.num(flow.Phr), flow.NPhr, '');

                trace.fromTable('α_hr', tableHr,
                    tableHr === 'Б.1'
                        ? 'N = ' + flow.fixtures + ' и P_hr = ' + Format.num(flow.Phr)
                        : 'N·P_hr = ' + Format.num(flow.NPhr),
                    flow.alphaHr, node);

                trace.formula('q_hr', '0,005 · q0_hr · α_hr',
                    '0,005 · ' + Format.num(flow.q0hr) + ' · ' + Format.num(flow.alphaHr),
                    flow.qhr, 'м³/ч');
            }
        }

        // суточный расход
        flow.qDay = qu * group.users / 1000;

        if (trace) {
            trace.formula('q_T', 'q_u · U / 1000',
                Format.num(qu) + ' · ' + group.users + ' / 1000', flow.qDay, 'м³/сут');
        }

        // (11) средний часовой расход за расчётное время
        if (norm.t > 0) {
            flow.qAvgHour = flow.qDay / norm.t;
            flow.khr = flow.qAvgHour > 0 ? flow.qhr / flow.qAvgHour : 0;

            if (trace) {
                trace.formula('q_ср.ч', 'q_T / T',
                    Format.num(flow.qDay) + ' / ' + Format.num(norm.t), flow.qAvgHour, 'м³/ч');

                trace.formula('K_ч', 'q_hr / q_ср.ч',
                    Format.num(flow.qhr) + ' / ' + Format.num(flow.qAvgHour), flow.khr, '');
            }
        }

        return flow;
    }

    /*
        Расход стоков по формуле (5): общий расчётный расход плюс расход от
        прибора с наибольшим водоотведением.

        Прибавка не «на всякий случай»: она не даёт сорвать гидрозатворы, когда
        одновременно с расчётным расходом сработает смывной бачок. Для жилья
        это унитаз со смывным бачком — 1,6 л/с.

        Пункт 8.2.2: прибавка вводится, пока общий расход не превышает 8 л/с.
        Дальше вероятность совпадения залпового сброса с расчётным расходом уже
        учтена самим расходом, и q_s = q_tot.
    */
    function sewer(qTotal, q0Sewer, trace) {
        var value = qTotal <= 8.0 ? qTotal + q0Sewer : qTotal;

        if (trace) {
            trace.section('Расход стоков');

            if (qTotal <= 8.0) {
                trace.formula('q_s', 'q_tot + q0_s',
                    Format.num(qTotal) + ' + ' + Format.num(q0Sewer), value, 'л/с');
            } else {
                trace.note('Общий расход больше 8 л/с — по 8.2.2 расход прибора '
                    + 'с наибольшим водоотведением не прибавляется.');
                trace.formula('q_s', 'q_tot', Format.num(qTotal), value, 'л/с');
            }
        }

        return value;
    }

    /*
        Расход по числу приборов при УЖЕ ИЗВЕСТНОЙ вероятности их действия.

        Нужен там, где P определена один раз для системы в целом, а по участкам
        меняется только число приборов. Это второй способ вести расчёт по СП, и
        для стояка он и есть основной: вероятность действия приборов — свойство
        всего дома, а не отдельного этажа, и пересчитывать её на каждом участке
        значило бы делать вид, что верхняя квартира живёт по своим правилам.

        От формулы (3) здесь остаётся только правая часть цепочки:

            N·P → α (5.3) → q = 5 · q0 · α (2)
    */
    function byFixtures(q0, n, P, node, trace) {
        var flow = {
            fixtures: n,
            q0: q0,
            P: P,
            NP: n * P,
            alpha: 0,
            q: 0,
            table: ''
        };

        if (!(q0 > 0) || !(n > 0) || !(P > 0)) return flow;

        flow.table = Tables.tableOf(n, P);
        flow.alpha = Tables.alpha(n, P, node);
        flow.q = 5 * q0 * flow.alpha;

        if (trace) {
            trace.formula('N·P', 'N · P', n + ' · ' + Format.num(P), flow.NP, '');

            trace.fromTable('α', flow.table,
                flow.table === 'Б.1'
                    ? 'N = ' + n + ' и P = ' + Format.num(P)
                    : 'N·P = ' + Format.num(flow.NP),
                flow.alpha, node);

            trace.formula('q', '5 · q0 · α',
                '5 · ' + Format.num(q0) + ' · ' + Format.num(flow.alpha), flow.q, 'л/с');
        }

        return flow;
    }

    /*
        Вероятность действия приборов по формуле (3) — отдельно от остального
        расчёта, потому что в расчёте по приборам она вычисляется один раз.
    */
    function probability(norm, users, fixtures) {
        if (!norm || !(users > 0) || !(fixtures > 0) || !(norm.q0 > 0)) return 0;
        return norm.qhru * users / (3600 * norm.q0 * fixtures);
    }

    /* --- расчёт одной группы потребителей -------------------------------- */

    function run(group, node) {
        var trace = new Trace();

        var result = {
            group: group,
            trace: trace,
            total: null, hot: null, cold: null,
            sewer: 0, sewerDay: 0
        };

        if (!group || !group.norm) return result;

        var norm = group.norm;

        trace.section('Исходные данные' + (group.name ? ': ' + group.name : ''));
        trace.note('Норма по таблице А.2: ' + norm.name);
        trace.note('Потребителей U = ' + group.users + ' (' + norm.unit + ')');
        trace.note('Приборов N = ' + group.fixtures
            + ', в том числе горячей воды ' + group.fixturesHot);
        trace.note('Нормы: q_u = ' + Format.num(norm.qu) + ' л/сут (горячей '
            + Format.num(norm.quh) + '), q_hr,u = ' + Format.num(norm.qhru)
            + ' л/ч (горячей ' + Format.num(norm.qhruh) + ')');
        trace.note('Расход прибором: q0 = ' + Format.num(norm.q0) + ' л/с, q0_hr = '
            + Format.num(norm.q0hr) + ' л/ч');

        result.total = branch(group, 'total', node, trace);
        result.hot = branch(group, 'hot', node, trace);
        result.cold = branch(group, 'cold', node, trace);

        result.sewer = sewer(result.total.q, group.q0Sewer, trace);

        // Суточный расход стоков равен водопотреблению: вода, поданная в дом,
        // уходит в канализацию целиком.
        result.sewerDay = result.total.qDay;

        return result;
    }

    /* --- свод по нескольким группам разных потребителей ------------------ */

    /*
        Складывать расходы групп напрямую нельзя: вероятность одновременного
        действия приборов у объекта в целом ниже, чем у каждой части, и простая
        сумма даёт заведомо завышенный расход, а с ним лишний диаметр ввода.

        Норматив требует вычислить средний расход прибором по формуле (1) и
        общую вероятность по формуле (4), и уже по ним взять коэффициент.
    */
    function mix(groups, kind, node, trace) {
        var flow = {
            kind: kind,
            fixtures: 0, q0: 0, q0hr: 0,
            P: 0, NP: 0, alpha: 0, q: 0,
            Phr: 0, NPhr: 0, alphaHr: 0, qhr: 0,
            qDay: 0, qAvgHour: 0, khr: 0,
            table: ''
        };

        if (trace) trace.section(title(kind) + ' — свод');

        var sumQhrU = 0;
        var sumQuU = 0;

        // Числитель и знаменатель формулы (1): средний расход прибором — это
        // средневзвешенное по вероятности и числу приборов, а не среднее
        // арифметическое.
        var sumPq0N = 0;
        var sumPN = 0;
        var sumQ0hrPN = 0;

        for (var i = 0; i < groups.length; i++) {
            var group = groups[i];
            if (!group.norm || !(group.users > 0)) continue;

            var norm = group.norm;

            var n = kind === 'hot' ? group.fixturesHot : group.fixtures;
            var q0 = kind === 'hot' ? norm.q0h : (kind === 'cold' ? norm.q0c : norm.q0);
            var q0hr = kind === 'hot' ? norm.q0hrh : (kind === 'cold' ? norm.q0hrc : norm.q0hr);
            var qhru = kind === 'hot' ? norm.qhruh : (kind === 'cold' ? norm.qhruc : norm.qhru);
            var qu = kind === 'hot' ? norm.quh : (kind === 'cold' ? norm.quc : norm.qu);

            if (!(n > 0) || !(q0 > 0) || !(qhru > 0)) continue;

            var p = qhru * group.users / (3600 * q0 * n);

            sumQhrU += qhru * group.users;
            sumQuU += qu * group.users;
            flow.fixtures += n;

            sumPq0N += p * q0 * n;
            sumPN += p * n;
            sumQ0hrPN += p * q0hr * n;
        }

        if (!(flow.fixtures > 0) || !(sumPN > 0)) {
            if (trace) trace.note('Расход не считается: подходящих групп нет.');
            return flow;
        }

        // (1) средний расход прибором по группам
        flow.q0 = sumPq0N / sumPN;
        flow.q0hr = sumQ0hrPN / sumPN;

        // (4) вероятность действия приборов при разных группах
        flow.P = sumQhrU / (3600 * flow.q0 * flow.fixtures);
        flow.NP = flow.fixtures * flow.P;

        flow.table = Tables.tableOf(flow.fixtures, flow.P);
        flow.alpha = Tables.alpha(flow.fixtures, flow.P, node);
        flow.q = 5 * flow.q0 * flow.alpha;

        if (trace) {
            trace.formula('q0', 'Σ(P_i · q0_i · N_i) / Σ(P_i · N_i)', '', flow.q0, 'л/с');
            trace.formula('q0_hr', 'Σ(P_i · q0_hr,i · N_i) / Σ(P_i · N_i)', '', flow.q0hr, 'л/ч');
            trace.formula('P', 'Σ(q_hr,u,i · U_i) / (3600 · q0 · N)',
                Format.num(sumQhrU) + ' / (3600 · ' + Format.num(flow.q0)
                + ' · ' + flow.fixtures + ')', flow.P, '');
            trace.fromTable('α', flow.table, 'N·P = ' + Format.num(flow.NP), flow.alpha, node);
            trace.formula('q', '5 · q0 · α',
                '5 · ' + Format.num(flow.q0) + ' · ' + Format.num(flow.alpha), flow.q, 'л/с');
        }

        if (flow.q0hr > 0) {
            flow.Phr = 3600 * flow.P * flow.q0 / flow.q0hr;
            flow.NPhr = flow.fixtures * flow.Phr;
            flow.alphaHr = Tables.alpha(flow.fixtures, flow.Phr, node);
            flow.qhr = 0.005 * flow.q0hr * flow.alphaHr;

            if (trace) {
                trace.formula('P_hr', '3600 · P · q0 / q0_hr', '', flow.Phr, '');
                trace.fromTable('α_hr', Tables.tableOf(flow.fixtures, flow.Phr),
                    'N·P_hr = ' + Format.num(flow.NPhr), flow.alphaHr, node);
                trace.formula('q_hr', '0,005 · q0_hr · α_hr', '', flow.qhr, 'м³/ч');
            }
        }

        flow.qDay = sumQuU / 1000;

        /*
            Среднее время водопотребления по группам взвешивать не по чему: у
            жилья это круглые сутки, у встроенных помещений смена. Берём
            наибольшее — оно и определяет длительность работы системы.
        */
        var t = 0;
        for (var k = 0; k < groups.length; k++) {
            if (groups[k].norm && groups[k].norm.t > t) t = groups[k].norm.t;
        }

        if (t > 0) {
            flow.qAvgHour = flow.qDay / t;
            flow.khr = flow.qAvgHour > 0 ? flow.qhr / flow.qAvgHour : 0;
        }

        if (trace) {
            trace.formula('q_T', 'Σ(q_u,i · U_i) / 1000', '', flow.qDay, 'м³/сут');
            if (t > 0) trace.formula('q_ср.ч', 'q_T / T', '', flow.qAvgHour, 'м³/ч');
        }

        return flow;
    }

    function combine(name, groups, node) {
        var trace = new Trace();

        var result = {
            group: { name: name, users: 0, fixtures: 0, fixturesHot: 0, q0Sewer: 0 },
            trace: trace,
            total: null, hot: null, cold: null,
            sewer: 0, sewerDay: 0
        };

        if (!groups || groups.length === 0) return result;

        trace.section('Свод: ' + name);
        trace.note('Групп водопотребителей: ' + groups.length
            + '. Расходы складываются не напрямую: по 5.2 и 5.4 сначала вычисляются '
            + 'средний расход прибором и общая вероятность действия приборов.');

        result.total = mix(groups, 'total', node, trace);
        result.hot = mix(groups, 'hot', node, trace);
        result.cold = mix(groups, 'cold', node, trace);

        var q0Sewer = 0;
        var users = 0;

        for (var i = 0; i < groups.length; i++) {
            if (groups[i].q0Sewer > q0Sewer) q0Sewer = groups[i].q0Sewer;
            users += groups[i].users;
        }

        result.group.users = users;
        result.group.fixtures = result.total.fixtures;
        result.group.fixturesHot = result.hot.fixtures;
        result.group.q0Sewer = q0Sewer;

        result.sewer = sewer(result.total.q, q0Sewer, trace);
        result.sewerDay = result.total.qDay;

        return result;
    }

    /*
        Расход теплоты на приготовление горячей воды, кВт — формулы (12) и (13).

        Считается по часовому расходу горячей воды: среднему для формулы (12) и
        максимальному для (13). Потери в подающих и циркуляционных
        трубопроводах приходят снаружи — их даёт тепловой расчёт системы ГВС.
    */
    function heat(hotFlowM3PerHour, hotT, coldT, lossesKw) {
        return 1.16 * hotFlowM3PerHour * (hotT - coldT) + (lossesKw || 0);
    }

    function title(kind) {
        if (kind === 'hot') return 'Горячая вода Т3';
        if (kind === 'cold') return 'Холодная вода В1';
        return 'Общий расход В1 общ.';
    }

    return {
        Trace: Trace,
        run: run,
        combine: combine,
        byFixtures: byFixtures,
        probability: probability,
        sewer: sewer,
        heat: heat
    };
})();
