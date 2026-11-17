/*
    Ядро расчёта для вкладки «По узлам» — то же самое ядро, что и у дерева
    потребителей (Tables.js / Demand.js), под интерфейсом, который ждёт
    js/ui-branch.js: список норм PRESETS и функция resultFor(groups).

    Перенесено из найденного в присланном архиве прототипа «Водобаланс»
    (dist/core-adapter.js) без изменений в математике — там уже было
    переведено с самодельных приближённых норм (dist/engine.js, в интерфейс
    не подключён и сюда не переносился) на настоящие
    Tables.norms()/Demand.run()/Demand.combine().
*/

var BranchCalc = (function () {
    'use strict';

    /* Норма по «привычному» имени пресета — только для двух частых строк,
       чтобы старые файлы этой вкладки читались. Остальные ищутся по id
       вида 'norm'+i, присвоенному по порядку строк таблицы А.2. */
    var ALIASES = {
        bath: 'Жилые дома с ваннами от 1500 мм, оборудованными душами',
        office: 'Административные здания'
    };

    var PRESETS = Tables.norms().map(function (p, i) {
        var id = Object.keys(ALIASES).find(function (k) { return ALIASES[k] === p.name; }) || ('norm' + i);

        return {
            id: id, name: p.name, unit: p.unit,
            day: p.qu, hotDay: p.quh, hour: p.qhru, hotHour: p.qhruh,
            q: p.q0, qPart: p.q0h, qhr: p.q0hr, qhrPart: p.q0hrh,
            T: p.t, item: p.item, ref: 'Таблица А.2' + (p.item ? ', п. ' + p.item : ''), norm: p
        };
    });

    function parameters(g, channel) {
        var p = g.custom || PRESETS.find(function (x) { return x.id === g.preset; });
        if (!p) throw new Error('Не выбрана норма потребления.');

        var hot = channel === 'hot';
        var part = channel !== 'total';

        return {
            day: hot ? p.hotDay : (part ? p.day - p.hotDay : p.day),
            hour: hot ? p.hotHour : (part ? p.hour - p.hotHour : p.hour),
            q: part ? p.qPart : p.q,
            qhr: part ? p.qhrPart : p.qhr,
            T: p.T, ref: p.ref
        };
    }

    function alpha(N, P) {
        if (P < 0 || P > 1) throw new Error('Вероятность вне диапазона 0–1. Проверьте число приборов.');
        if (N * P > 2000) throw new Error('NP превышает 2000 — верхнюю границу таблицы Б.2.');
        if (P > 0.8 && N <= 200) throw new Error('P > 0,8 при N ≤ 200 — вне таблицы Б.1. Автоматическая экстраполяция отключена.');

        return { value: Tables.alpha(N, P, false), table: Tables.tableOf(N, P) };
    }

    /*
        Свод по списку групп — тем же путём, что и у дерева: Demand.run для
        одной группы, Demand.combine (формулы (1) и (4)) для нескольких.
        g.custom позволяет группе нести собственную, не табличную норму.
    */
    function resultFor(groups) {
        var unique = [];
        var seen = {};
        var i;

        for (i = 0; i < groups.length; i++) {
            if (seen[groups[i].id]) continue;
            seen[groups[i].id] = true;
            unique.push(groups[i]);
        }

        var gs = unique.map(function (g) {
            var preset = PRESETS.find(function (p) { return p.id === g.preset; });

            var n = g.custom ? {
                name: g.custom.name, unit: g.custom.unit,
                qu: g.custom.day, quh: g.custom.hotDay, quc: g.custom.day - g.custom.hotDay,
                qhru: g.custom.hour, qhruh: g.custom.hotHour, qhruc: g.custom.hour - g.custom.hotHour,
                q0: g.custom.q, q0h: g.custom.qPart, q0c: g.custom.qPart,
                q0hr: g.custom.qhr, q0hrh: g.custom.qhrPart, q0hrc: g.custom.qhrPart,
                t: g.custom.T
            } : (preset && preset.norm);

            if (!n) throw new Error('Неизвестная норма у группы «' + g.name + '».');

            var dayUsers = g.Uday !== undefined && g.Uday !== null ? g.Uday : g.U;
            var U = g.Uhour !== undefined && g.Uhour !== null ? g.Uhour : dayUsers;

            if (!Number.isInteger(dayUsers) || dayUsers < 0 || !Number.isInteger(U) || U < 0) {
                throw new Error('Число потребителей должно быть целым неотрицательным.');
            }

            var N = g.autoN ? U : g.N;
            var Nh = g.autoN ? U : g.Nhot;

            var checks = [
                [N, n.q0, n.qhru, n.q0hr],
                [N, n.q0c, n.qhruc, n.q0hrc],
                [Nh, n.q0h, n.qhruh, n.q0hrh]
            ];

            for (var c = 0; c < checks.length; c++) {
                var num = checks[c][0], q = checks[c][1], qh = checks[c][2], qhr = checks[c][3];
                if (!U || !qh) continue;

                if (!Number.isInteger(num) || num <= 0 || !(q > 0) || !(qhr > 0)) {
                    throw new Error('Укажите число приборов и расходы прибором для «' + g.name + '».');
                }

                var P = qh * U / (3600 * q * num);
                var Ph = qh * U / (qhr * num);
                alpha(num, P);
                alpha(num, Ph);
            }

            return {
                name: (g.comment && g.comment.trim()) || n.name, norm: n,
                users: U, usersDay: dayUsers, fixtures: N, fixturesHot: Nh,
                q0Sewer: g.q0Sewer !== undefined && g.q0Sewer !== null ? g.q0Sewer : 1.6
            };
        });

        var raw = gs.length === 1 ? Demand.run(gs[0], false)
            : (gs.length ? Demand.combine('Итого', gs, false) : null);

        var out = {};

        ['cold', 'hot', 'total'].forEach(function (c) {
            var f = raw ? raw[c] : null;

            var day = gs.reduce(function (s, g) {
                var qu = c === 'cold' ? g.norm.quc : (c === 'hot' ? g.norm.quh : g.norm.qu);
                return s + g.usersDay * qu / 1000;
            }, 0);

            var T = Math.max.apply(null, [0].concat(gs.map(function (g) { return g.norm.t; })));

            if (f) { alpha(f.fixtures, f.P); alpha(f.fixtures, f.Phr); }

            out[c] = {
                U: gs.reduce(function (s, g) { return s + g.users; }, 0),
                N: f ? f.fixtures : 0, P: f ? f.P : 0, Ph: f ? f.Phr : 0,
                NP: f ? f.NP : 0, NPh: f ? f.NPhr : 0,
                q0: f ? f.q0 : 0, q0hr: f ? f.q0hr : 0,
                day: day, hour: f ? f.qhr : 0, second: f ? f.q : 0,
                avg: T ? day / T : 0,
                a: { value: f ? f.alpha : 0, table: f ? f.table : '—' },
                ah: { value: f ? f.alphaHr : 0, table: f ? Tables.tableOf(f.fixtures, f.Phr) : '—' }
            };
        });

        out.trace = raw && raw.trace ? raw.trace.lines : [];
        return out;
    }

    function calculate(groups, c) {
        return resultFor(groups)[c || 'total'];
    }

    return {
        PRESETS: PRESETS,
        parameters: parameters,
        alpha: alpha,
        resultFor: resultFor,
        calculate: calculate
    };
})();
