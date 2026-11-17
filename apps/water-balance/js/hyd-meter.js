/*
    Водомерные узлы для вкладки «Гидравлика».

    Таблицы и подбор перенесены из WaterMeterWeb (js/tables.js, js/calc.js) без
    изменений по существу — крыльчатые ВСХН/ВСГН и турбинные, потери по паспорту
    завода и по СП 30 (приложение 4 СНиП 2.04.01-85*). Здесь только то, что нужно
    расчёту напоров: подобрать калибр под расход и вернуть потери в метрах.

    Потери по паспорту:  dP [кгс/см²] = K · Q² · 1e-4, Q — м³/ч, 1 кгс/см² = 10 м.
    Потери по СП:        h [м] = S · q², q — л/с.
    DN 200 в СНиП — 3,5·10⁻⁵; в ходовых таблицах там стоит значение DN 65 (опечатка).
*/

var HydMeter = (function () {
    'use strict';

    var LS_TO_M3H = 3.6;

    /* Крыльчатые: прочерк (исполнения такого класса нет) — null. Qmin и Qt — по классам [A, B, C]. */
    var VANE = [
        { dn: 15, qn: 0.6, qmax: 1.2, k: 6944, qminCold: [null, 0.0100, 0.0060], qminHot: [null, 0.0125, 0.0060], variant: 'Qn=0,6' },
        { dn: 15, qn: 1.0, qmax: 2.0, k: 2500, qminCold: [null, 0.0160, 0.0100], qminHot: [null, 0.0200, 0.0100], variant: 'Qn=1' },
        { dn: 15, qn: 1.5, qmax: 3.0, k: 1111, qminCold: [null, 0.0250, 0.0150], qminHot: [null, 0.0310, 0.0150], variant: 'Qn=1,5' },
        { dn: 20, qn: 2.5, qmax: 5.0, k: 400, qminCold: [null, 0.0400, 0.0150], qminHot: [null, 0.0500, 0.0150], variant: '' },
        { dn: 25, qn: 3.5, qmax: 7.0, k: 204.08, qminCold: [0.14, 0.0630, 0.0210], qminHot: [0.14, 0.0630, null], variant: '' },
        { dn: 32, qn: 6.0, qmax: 12.0, k: 69.444, qminCold: [0.24, 0.1000, 0.0360], qminHot: [0.24, 0.1000, null], variant: '' },
        { dn: 40, qn: 10.0, qmax: 20.0, k: 25, qminCold: [0.30, 0.1600, 0.0600], qminHot: [0.30, 0.1600, null], variant: '' }
    ];

    /* Турбинные, класс B. */
    var TURBINE = [
        { dn: 40, k: 1.479, qminCold: 0.45, qnCold: 30, qmaxCold: 60, qminHot: 0.7, qnHot: 15, qmaxHot: 30 },
        { dn: 50, k: 0.692, qminCold: 0.45, qnCold: 50, qmaxCold: 90, qminHot: 0.7, qnHot: 15, qmaxHot: 30 },
        { dn: 65, k: 0.625, qminCold: 0.45, qnCold: 60, qmaxCold: 120, qminHot: 1.0, qnHot: 25, qmaxHot: 60 },
        { dn: 80, k: 0.1, qminCold: 0.5, qnCold: 120, qmaxCold: 200, qminHot: 1.6, qnHot: 45, qmaxHot: 90 },
        { dn: 100, k: 0.061, qminCold: 0.6, qnCold: 230, qmaxCold: 300, qminHot: 2.4, qnHot: 70, qmaxHot: 140 },
        { dn: 125, k: 0.0346, qminCold: 1.5, qnCold: 250, qmaxCold: 350, qminHot: 4.0, qnHot: 100, qmaxHot: 200 },
        { dn: 150, k: 0.0104, qminCold: 1.8, qnCold: 400, qmaxCold: 600, qminHot: 6.0, qnHot: 150, qmaxHot: 300 },
        { dn: 200, k: 0.0033, qminCold: 4.0, qnCold: 750, qmaxCold: 1000, qminHot: 10.0, qnHot: 250, qmaxHot: 500 },
        { dn: 250, k: 0.00156, qminCold: 10.0, qnCold: 1100, qmaxCold: 1600, qminHot: 20.0, qnHot: 500, qmaxHot: 1000 }
    ];

    /* Сопротивление S по СНиП 2.04.01-85*, прил. 4. Строки DN 125 нет — только паспорт. */
    var SP = [
        { dn: 15, s: 14.5 }, { dn: 20, s: 5.18 }, { dn: 25, s: 2.64 }, { dn: 32, s: 1.3 },
        { dn: 40, s: 0.5 }, { dn: 50, s: 0.143 }, { dn: 65, s: 0.0081 }, { dn: 80, s: 0.00264 },
        { dn: 100, s: 0.000766 }, { dn: 150, s: 0.00013 }, { dn: 200, s: 0.000035 }, { dn: 250, s: 0.000018 }
    ];

    function spFor(dn) {
        for (var i = 0; i < SP.length; i++) if (SP[i].dn === dn) return SP[i];
        return null;
    }

    function defaults() {
        return { limitVane: 5, limitTurbine: 2.5, cls: 1, method: 'sp', pulse: true };
    }

    /* Где расход лежит относительно паспортного диапазона счётчика. */
    function flowStatus(c) {
        if (c.qM3h > c.qmax) return 'расход выше Qmax';
        if (c.qmin !== null && isFinite(c.qmin) && c.qM3h < c.qmin) return 'расход ниже Qmin';
        if (c.qn !== undefined && c.qM3h > c.qn) return 'выше Qn, в пределах Qmax';
        return 'ок';
    }

    function status(c) {
        if (!c.flowOk) return c.flowStatus;
        if (!c.hasLoss) return 'нет строки в таблице СП';
        if (!c.lossOk) return 'потери выше предела';
        if (c.flowStatus !== 'ок') return c.flowStatus;
        return 'подходит';
    }

    /*
        Все калибры под расход. hot — счётчик на горячую воду (ВСГН).
        opt: { limitVane, limitTurbine, cls (0=A,1=B,2=C), method ('sp'|'passport') }
    */
    function build(qLs, hot, opt) {
        opt = opt || defaults();
        var qM3h = qLs * LS_TO_M3H;
        var prefix = (hot ? 'ВСГН' : 'ВСХН') + (opt.pulse ? 'д' : '');
        var list = [];
        var i, c;

        function finish(c) {
            var s = spFor(c.dn);
            c.hasSp = !!s;
            c.hSp = s ? s.s * qLs * qLs : NaN;
            c.hPassport = c.k * qM3h * qM3h * 1e-4 * 10;
            c.h = opt.method === 'passport' ? c.hPassport : c.hSp;
            c.hasLoss = opt.method === 'passport' || c.hasSp;
            c.flowOk = c.qM3h <= c.qmax && !(c.qmin !== null && isFinite(c.qmin) && c.qM3h < c.qmin);
            c.lossOk = c.hasLoss && c.h <= c.limit + 1e-9;
            c.suitable = c.flowOk && c.lossOk;
            c.flowStatus = flowStatus(c);
            c.status = status(c);
            c.kindName = c.kind === 'vane' ? 'крыльчатый' : 'турбинный';
            c.kindGen = c.kind === 'vane' ? 'крыльчатого' : 'турбинного';
            c.mark = prefix + '-' + c.dn;
            c.markFull = c.variant ? c.mark + ' (' + c.variant + ')' : c.mark;
            list.push(c);
        }

        for (i = 0; i < VANE.length; i++) {
            var v = VANE[i];
            c = {
                dn: v.dn, kind: 'vane', variant: v.variant, k: v.k, qLs: qLs, qM3h: qM3h,
                limit: opt.limitVane, qn: v.qn, qmax: v.qmax,
                qmin: (hot ? v.qminHot : v.qminCold)[opt.cls]
            };
            finish(c);
        }

        for (i = 0; i < TURBINE.length; i++) {
            var t = TURBINE[i];
            c = {
                dn: t.dn, kind: 'turbine', variant: '', k: t.k, qLs: qLs, qM3h: qM3h,
                limit: opt.limitTurbine,
                qn: hot ? t.qnHot : t.qnCold, qmax: hot ? t.qmaxHot : t.qmaxCold,
                qmin: hot ? t.qminHot : t.qminCold
            };
            finish(c);
        }

        return list;
    }

    /* Наименьший калибр, проходящий и по расходу, и по потерям; иначе — с наименьшими потерями. */
    function recommend(list, kind) {
        var i;
        for (i = 0; i < list.length; i++) if ((!kind || list[i].kind === kind) && list[i].suitable) return list[i];

        var best = null;
        for (i = 0; i < list.length; i++) {
            if (kind && list[i].kind !== kind) continue;
            if (!list[i].flowOk || !list[i].hasLoss) continue;
            if (!best || list[i].h < best.h) best = list[i];
        }
        return best;
    }

    /*
        Подбор под расход. Возвращает { c, ok, h, mark } или null, если расхода нет.
        Для расхода ниже минимального расхода самого малого счётчика берётся
        самый малый — квартирный узел при ночном расходе не бывает «не подобран».
    */
    function pick(qLs, hot, opt, o) {
        if (!(qLs > 0)) return null;
        o = o || {};
        var list = build(qLs, hot, opt);
        var rec = recommend(list, o.kind || '');
        var chosen = null;

        if (o.chosen) {
            list.forEach(function (c) {
                if (c.dn === o.chosen.dn && c.kind === o.chosen.kind && (c.variant || '') === (o.chosen.variant || '')) chosen = c;
            });
        }

        var c = chosen || rec;
        if (!c) return { c: null, ok: false, h: 0, mark: 'не подобран', list: list, recommended: null, manual: false };
        return { c: c, ok: c.suitable, h: c.h, mark: c.markFull, list: list, recommended: rec, manual: !!chosen };
    }

    /* Подпись исполнения крыльчатого Ду 15 по Qn (0,6 → «Qn=0,6»). */
    function vaneVariant(qn) {
        for (var i = 0; i < VANE.length; i++) if (VANE[i].dn === 15 && VANE[i].qn === qn) return VANE[i].variant;
        return '';
    }

    /* Назначения систем для подсказки в поле «Система» (как в WaterMeterWeb). */
    var SYSTEMS = [
        'Общий на вводе',
        'Холодное водоснабжение',
        'Горячее водоснабжение',
        'ХВС на встроенные помещения',
        'ХВС на приготовление ГВС 1 зоны (ИТП)',
        'ХВС на приготовление ГВС 2 зоны + встроенные помещения (ИТП)',
        'Циркуляция на 1 зону (ИТП)',
        'Циркуляция на 2 зону (ИТП)',
        'Циркуляция на встроенные помещения (ИТП)'
    ];

    var SP_NOTE = 'Потери приняты по СП 30.13330.2020 (СНиП 2.04.01-85*), прил. 4';

    /* Коэффициенты K и S лежат в разных порядках — убираем хвостовые нули, а не фиксируем знаки. */
    function coef(x) {
        if (x === null || x === undefined || typeof x !== 'number' || !isFinite(x)) return '—';
        var s = x.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
        if (s === '' || s === '-') s = '0';
        return s.replace('.', ',');
    }

    function fmt(x, d) {
        if (x === null || x === undefined || typeof x !== 'number' || !isFinite(x)) return '—';
        return x.toFixed(d === undefined ? 2 : d).replace('.', ',');
    }

    function q3(x) { return coef(Math.round(x * 1000) / 1000); }

    /*
        Построчная расшифровка потерь: откуда взялось число у каждого счётчика.
        rows — [{ place, systemName, qLs, c, method, note }], c — вариант из build().
        opt — настройки проекта (пределы потерь).
    */
    function reportLines(rows, opt) {
        var lines = [];

        lines.push('Формулы');
        lines.push('');
        lines.push('По паспорту счётчика:  ΔP = K · Q² · 10⁻⁴,  где ΔP — потеря давления, кгс/см²;');
        lines.push('K — коэффициент гидравлического сопротивления по таблице 2 паспорта; Q — расход, м³/ч.');
        lines.push('Потеря напора h = ΔP · 10, м вод. ст. (1 кгс/см² = 10 м вод. ст.).');
        lines.push('');
        lines.push('По СП 30.13330 (СНиП 2.04.01-85*, прил. 4):  h = S · q²,  где h — потеря напора, м;');
        lines.push('S — гидравлическое сопротивление счётчика, м/(л/с)²; q — расход, л/с.');
        lines.push('');
        lines.push('Пересчёт расхода: Q [м³/ч] = q [л/с] · 3,6.');
        lines.push('');
        lines.push('Предельные потери напора: крыльчатые счётчики — ' + coef(opt.limitVane) + ' м, турбинные — ' + coef(opt.limitTurbine) + ' м.');
        lines.push('');

        if (!rows.length) {
            lines.push('Водомерных узлов на схеме нет.');
            return lines;
        }

        rows.forEach(function (r, i) {
            var c = r.c;
            var head = (i + 1) + '. ' + (r.place || '') + (r.systemName ? (r.place ? ' — ' : '') + r.systemName : '');
            lines.push(head);
            lines.push('    Счётчик ' + c.markFull + ' (' + c.kindName + '), DN ' + c.dn + '.');
            lines.push('    Расход q = ' + coef(c.qLs) + ' л/с = ' + q3(c.qM3h) + ' м³/ч.');

            var p = c.k * c.qM3h * c.qM3h * 1e-4;
            lines.push('    По паспорту:  ΔP = K · Q² · 10⁻⁴ = ' + coef(c.k) + ' · ' + q3(c.qM3h) + '² · 10⁻⁴ = ' + coef(Math.round(p * 1e6) / 1e6) + ' кгс/см²;');
            lines.push('                  h = ΔP · 10 = ' + fmt(c.hPassport, 2) + ' м.');

            if (c.hasSp) {
                lines.push('    По СП 30.13330 (СНиП 2.04.01-85*, прил. 4):  h = S · q² = ' + coef(spFor(c.dn).s) + ' · ' + coef(c.qLs) + '² = ' + fmt(c.hSp, 2) + ' м.');
            } else {
                lines.push('    По СП 30.13330: строки DN ' + c.dn + ' в таблице прил. 4 нет — метод неприменим.');
            }

            var loss = r.method === 'passport' ? c.hPassport : c.hSp;
            var ok = c.hasLoss && loss <= c.limit + 1e-9;
            lines.push('    Принято: h = ' + fmt(loss, 2) + ' м (' + (r.method === 'passport' ? 'по паспорту' : 'по СП') + '). Предел для ' + c.kindGen
                + ' счётчика — ' + coef(c.limit) + ' м, ' + (ok ? 'условие выполняется' : 'ПРЕВЫШЕНИЕ, условие не выполняется') + '.');

            var qmin = c.qmin === null || !isFinite(c.qmin) ? 'не нормируется' : coef(c.qmin) + ' м³/ч';
            lines.push('    Диапазон счётчика: Qmin = ' + qmin + ', Qmax = ' + coef(c.qmax) + ' м³/ч; расчётный Q = ' + q3(c.qM3h) + ' м³/ч — '
                + (c.flowOk ? 'в пределах.' : 'ВНЕ ДИАПАЗОНА.'));

            if (r.note) lines.push('    Примечание: ' + r.note);
            lines.push('');
        });

        return lines;
    }

    return {
        VANE: VANE, TURBINE: TURBINE, SP: SP,
        defaults: defaults, build: build, recommend: recommend, pick: pick, vaneVariant: vaneVariant, spFor: spFor, status: status, flowStatus: flowStatus, SYSTEMS: SYSTEMS, SP_NOTE: SP_NOTE, reportLines: reportLines, coef: coef, fmt: fmt
    };
})();
