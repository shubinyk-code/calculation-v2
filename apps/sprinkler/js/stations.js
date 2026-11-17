'use strict';

/*
    Насосные установки объекта: какие системы питает одна насосная и что она
    должна дать.

    Одна насосная часто работает сразу на АПТ коридоров (В21) и на ВПВ (В2.1).
    Тогда:

        напор   — наибольший требуемый из систем: Нр = max(Нтр − Нгар);
        расход  — сумма расходов систем, если они работают одновременно,
                  или наибольший, если нет (галочка «суммировать расходы»).

    Если у АПТ по этажам пожарные краны стоят прямо на стояке АПТ, расход этих
    кранов уже вошёл в расход АПТ. Тогда та же система ВПВ второй раз в сумму
    не добавляется — иначе краны посчитались бы дважды.
*/

var Stations = (function () {

    function create(book) {
        var n = book.nextStation || 1;
        book.nextStation = n + 1;
        return {
            id: 'p' + n,
            name: 'Насосная установка ' + n,
            zone: '',
            systems: [],
            sumFlows: true,
            jockey: true
        };
    }

    function normalize(list) {
        return (Array.isArray(list) ? list : []).map(function (s, i) {
            return {
                id: String(s.id || 'p' + (i + 1)),
                name: s.name || 'Насосная установка ' + (i + 1),
                zone: s.zone || '',
                systems: Array.isArray(s.systems) ? s.systems.map(String) : [],
                sumFlows: s.sumFlows !== false,
                jockey: s.jockey !== false
            };
        });
    }

    function nextId(list) {
        var max = 0;
        list.forEach(function (s) {
            var n = parseInt(String(s.id).replace(/\D/g, ''), 10);
            if (n > max) max = n;
        });
        return max + 1;
    }

    /** Требование одной системы к насосной: Q, Нтр, Нр, Нгар. */
    function demand(book, sys) {
        if (sys.kind === 'apt' || sys.kind === 'vpvplan') {
            var net = Solver.solve(sys.project);
            var calc = Calc.build(sys.project, net);
            var head = calc.head;
            return {
                sys: sys, ok: net.ok, Q: net.Qtotal,
                Htr: head ? head.Hreq : 0, Hp: head ? head.HpumpReq : 0, guar: sys.project.settings.guaranteed
            };
        }

        if (sys.kind === 'vpv') {
            var r = Vpv.solve(sys.vpv);
            return {
                sys: sys, ok: r.ok, Q: r.ok ? r.dict.Q : 0,
                Htr: r.ok ? r.dict.Htr : 0, Hp: r.ok ? r.dict.Hp : 0, guar: sys.vpv.inlet.guaranteed
            };
        }

        var f = Floors.solve(sys.floors, book, true);
        return {
            sys: sys, ok: f.ok, Q: f.ok ? f.dict.Qr : 0,
            Htr: f.ok ? f.dict.Htr : 0, Hp: f.ok ? f.dict.Hp : 0, guar: sys.floors.inlet.guaranteed,
            includes: f.ok && f.vpv.sys ? f.vpv.sys.id : null
        };
    }

    /** Что должна дать насосная: расход, напор и из чего они сложились. */
    function need(book, station) {
        var parts = [];
        station.systems.forEach(function (id) {
            var sys = Systems.find(book, id);
            if (sys) parts.push(demand(book, sys));
        });

        // Краны на стояке АПТ уже в расходе АПТ — их систему ВПВ не складываем.
        var included = {};
        parts.forEach(function (p) { if (p.includes) included[p.includes] = p.sys.code; });
        parts.forEach(function (p) { p.inOther = included[p.sys.id] || null; });

        var counted = parts.filter(function (p) { return p.ok && !p.inOther; });
        var Q = 0;
        counted.forEach(function (p) {
            Q = station.sumFlows ? Q + p.Q : Math.max(Q, p.Q);
        });

        var dict = null;
        parts.forEach(function (p) {
            if (p.ok && (!dict || p.Hp > dict.Hp)) dict = p;
        });

        return {
            station: station,
            parts: parts,
            Q: Q,
            H: dict ? Math.max(0, dict.Hp) : 0,
            Htr: dict ? dict.Htr : 0,
            guar: dict ? dict.guar : 0,
            after: dict ? Math.max(0, dict.Hp) + (dict.guar > 0 ? dict.guar : 0) : 0,
            dict: dict
        };
    }

    /** Насосная, в которую входит система (или null). */
    function stationOf(book, sysId) {
        var list = book.stations || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].systems.indexOf(String(sysId)) >= 0) return list[i];
        }
        return null;
    }

    /** Система может входить только в одну насосную. */
    function assign(book, station, sysId, on) {
        (book.stations || []).forEach(function (s) {
            s.systems = s.systems.filter(function (id) { return id !== String(sysId); });
        });
        if (on) station.systems.push(String(sysId));
    }

    function remove(book, id) {
        book.stations = (book.stations || []).filter(function (s) { return s.id !== id; });
    }

    return {
        create: create,
        normalize: normalize,
        nextId: nextId,
        demand: demand,
        need: need,
        stationOf: stationOf,
        assign: assign,
        remove: remove
    };
})();
