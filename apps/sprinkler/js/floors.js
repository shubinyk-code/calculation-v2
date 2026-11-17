'use strict';

/*
    АПТ коридоров по этажам: стояк с поэтажными отростками (В21, В22…).

    Система самостоятельная — от ВПВ не зависит: бывает ВПВ без АПТ и АПТ без
    ВПВ. С ВПВ её связывает только общая насосная (stations.js) и, если
    включено, пожарные краны на стояке АПТ.

    Этажи и секции задаются так же, как в ВПВ: секция — этажи с–по, отметка и
    высоты первого, типового и подземного этажей, ручные отметки. Геометрия
    сети на этаже — обычный план АПТ, какой рисуется в программе:

        типовой план   «Типовой этаж», этажи 2–12 во всех секциях;
        нетиповой      «1 этаж», этаж 1 — узкий диапазон перекрывает типовой.

    Точка «Ввод» на плане этажа — место врезки в стояк.

    Расчёт каждого этажа — по методике АПТ (СП 485, прил. Б), как в
    калькуляторе «Приложение 6»:

        план этажа       Solver: Hсв у диктующего оросителя, ΣΔH сети этажа, Q;
        стояк            ΔH = Q²·L/Kт от врезки этажа до магистрали;
        магистраль       ΔH = Q²·L/Kт до насосной;
        Нтр = Нгеом + Ннас + (ΣΔHэтажа + ΔHст + ΔHмаг)·1,2 + Нуу + Нсв
              + Нпоэт.узла + Нвсас,
        Нгеом = отметка этажа + высота оросителей − отметка ввода,
        Нуу = 1000·ξ·(Q·3,6)²,   Нр = Нтр − Нгар.

    Диктующий — этаж с наибольшим Нтр (обычно верхний). Если на стояке АПТ
    стоят пожарные краны, по стояку, магистрали и узлу управления идёт
    Q АПТ + Q ВПВ выбранной системы — потери считаются от суммы.
*/

var Floors = (function () {

    function newPlan(id, name, from, to) {
        var project = Model.create();
        project.name = name;
        return {
            id: id,
            name: name,
            section: 'all',
            floorsFrom: from,
            floorsTo: to,
            project: project
        };
    }

    function create() {
        return {
            zone: '1 зона',
            purpose: 'жилая часть, коридоры',

            sections: [Vpv.newSection(1, 'С1')],
            nextSection: 2,

            plans: [newPlan(1, 'Типовой этаж', 1, 12)],
            nextPlan: 2,

            sprinklerHeight: 2.7,
            floorNodeLoss: 0.5,

            riser: { material: 'ГОСТ10704', od: 76, wall: 3 },
            main: { material: 'ГОСТ10704', od: 108, wall: 4 },
            baseElev: -0.5,

            inlet: {
                guaranteed: 26,
                elev: -3.6,
                stationLoss: 3,
                localFactor: 1.2,
                suction: 0,
                cuKind: 'Прямоточный',
                cuDn: 100,
                cuXi: null
            },

            pk: { onRiser: false, vpv: '' },

            // Подбор диафрагм на поэтажных отводах и на стояке.
            dia: {
                on: true,
                mode: 'excess',
                target: 100,
                margin: 0,
                step: 1,
                minD: 6,
                round: 'up',
                riser: true,
                station: true
            },

            view: 'flat'
        };
    }

    function isObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function merge(target, source) {
        Object.keys(source || {}).forEach(function (key) {
            if (key === 'sections' || key === 'plans') return;
            if (isObject(source[key]) && isObject(target[key])) merge(target[key], source[key]);
            else if (source[key] !== undefined) target[key] = source[key];
        });
        return target;
    }

    function normalize(data) {
        var v = merge(create(), data || {});

        if (data && Array.isArray(data.sections) && data.sections.length) {
            v.sections = data.sections.map(function (s, i) {
                var sec = Vpv.newSection(s.id || i + 1, s.name);
                Object.keys(s).forEach(function (k) { if (s[k] !== undefined && k !== 'overrides') sec[k] = s[k]; });
                sec.overrides = isObject(s.overrides) ? s.overrides : {};
                return sec;
            });
        }

        if (data && Array.isArray(data.plans)) {
            v.plans = data.plans.map(function (p, i) {
                return {
                    id: p.id || i + 1,
                    name: p.name || 'План ' + (i + 1),
                    section: p.section === undefined || p.section === null || p.section === '' ? 'all' : String(p.section),
                    floorsFrom: Number(p.floorsFrom) || 1,
                    floorsTo: Number(p.floorsTo) || Number(p.floorsFrom) || 1,
                    project: Storage.unpack(p.project && p.project.format ? p.project : Model.create())
                };
            });
        }

        var maxSec = 0;
        v.sections.forEach(function (s) { maxSec = Math.max(maxSec, s.id); });
        v.nextSection = Math.max(v.nextSection || 1, maxSec + 1);

        var maxPlan = 0;
        v.plans.forEach(function (p) { maxPlan = Math.max(maxPlan, p.id); });
        v.nextPlan = Math.max(v.nextPlan || 1, maxPlan + 1);

        if (v.view !== 'iso') v.view = 'flat';
        return v;
    }

    function addSection(v) {
        return Vpv.addSection(v);
    }

    /** Новый план этажа; копия берёт геометрию и настройки исходного. */
    function addPlan(v, copyOf) {
        var id = v.nextPlan++;
        var plan;

        if (copyOf) {
            plan = JSON.parse(JSON.stringify(copyOf));
            plan.id = id;
            plan.name = copyOf.name + ' (копия)';
            plan.project = Storage.unpack(plan.project);
            if (copyOf.project.underlay) plan.project.underlay.src = copyOf.project.underlay.src;
        } else {
            plan = newPlan(id, 'Этаж', 1, 1);
            var base = v.plans[0];
            if (base) plan.project.settings = Storage.merge(Model.defaults(), JSON.parse(JSON.stringify(base.project.settings)));
        }

        v.plans.push(plan);
        return plan;
    }

    function findPlan(v, id) {
        for (var i = 0; i < v.plans.length; i++) {
            if (String(v.plans[i].id) === String(id)) return v.plans[i];
        }
        return null;
    }

    /** План для этажа секции: из подходящих берётся самый узкий диапазон. */
    function planFor(v, sec, n) {
        var best = null;
        v.plans.forEach(function (p) {
            if (p.section !== 'all' && String(p.section) !== String(sec.id)) return;
            var from = Math.min(p.floorsFrom, p.floorsTo);
            var to = Math.max(p.floorsFrom, p.floorsTo);
            if (n < from || n > to) return;
            var span = to - from + (p.section === 'all' ? 0.5 : 0);
            if (!best || span < best.span) best = { plan: p, span: span };
        });
        return best ? best.plan : null;
    }

    /* --- гидравлика --------------------------------------------------------- */

    function pipeOf(p) {
        var info = Catalog.pipe({ material: p.material, od: p.od, wall: p.wall, kt: null });
        return { material: p.material, od: p.od, wall: p.wall, dn: info.dn, dIn: info.dIn, kt: info.kt, source: info.source };
    }

    function loss(q, len, kt) {
        return kt > 0 && len > 0 ? q * q * len / kt : 0;
    }

    /** Внутренний диаметр трубы у врезки в стояк — в ней и стоит шайба этажа. */
    function branchDIn(plan) {
        var p = plan.project;
        var src = p.nodes.filter(function (n) { return n.src; })[0];
        if (!src) return 0;

        var seg = p.segments.filter(function (s) { return s.a === src.id || s.b === src.id; })[0];
        return seg ? Catalog.pipe(seg).dIn : 0;
    }

    /** Расчёт плана этажа: напор у диктующего оросителя, потери сети этажа, расход. */
    function solvePlan(plan) {
        var net = Solver.solve(plan.project);
        if (!net.ok) {
            return { ok: false, errors: net.errors.length ? net.errors : ['План не считается.'], net: net };
        }
        return {
            ok: true, Q: net.Qtotal, Hfree: net.Hdict, HnetRaw: net.HnetRaw,
            dictKind: net.dictKind, dIn: branchDIn(plan), net: net
        };
    }

    /**
        Подбор диафрагм. У этажа срезается лишний напор у врезки в стояк: либо
        до заданного давления, либо до того, что нужно сети этажа, с запасом.
        Диаметр шайбы считается на расчётный расход этажа в трубе поэтажного
        отвода.

        На стояк подбирается общая шайба: она срезает то, что лишнее у всех
        этажей сразу, поэтажные добирают остальное. Общая шайба работает только
        при протоке: в дежурном режиме давление она не снижает.
    */
    function pickDiaphragms(v, res, riser) {
        var dia = v.dia;
        res.dia = { floors: 0, risers: [] };
        if (!dia || !dia.on || !res.ok) return;

        var opts = { step: dia.step, min: dia.minD, round: dia.round };
        var bySection = {};

        res.floors.forEach(function (rec) {
            if (!rec.ok) return;

            var required = rec.Hfree + rec.HplanRaw * v.inlet.localFactor;
            var atFloor = required + rec.excess;
            var allowed = dia.mode === 'fixed' ? dia.target : required + (dia.margin || 0);

            if (allowed < required) allowed = required;

            rec.required = required;
            rec.atFloor = atFloor;
            rec.allowed = allowed;
            rec.need = atFloor - allowed;
            rec.dia = rec.need > 0.05
                ? Diaphragm.pick(rec.Q, rec.need, rec.plan && res.plans[rec.plan.id].dIn > 0 ? res.plans[rec.plan.id].dIn : riser.dIn, opts)
                : null;

            if (rec.dia && rec.dia.ok) {
                rec.after = atFloor - rec.dia.cut;
                res.dia.floors++;
            }

            var key = String(rec.section.id);
            if (!bySection[key]) bySection[key] = { section: rec.section, needs: [], Q: 0 };
            bySection[key].needs.push(rec.need);
            bySection[key].Q = Math.max(bySection[key].Q, rec.Qr);
        });

        if (!dia.riser) return;

        Object.keys(bySection).forEach(function (key) {
            var group = bySection[key];
            var common = Diaphragm.common(group.needs);
            if (common <= 0.05) return;

            var pick = Diaphragm.pick(group.Q, common, riser.dIn, opts);
            pick.q = group.Q;
            if (pick.ok) res.dia.risers.push({ section: group.section, pick: pick });
        });
    }

    /** Расход ВПВ, который идёт по стояку АПТ, если на нём стоят пожарные краны. */
    function vpvFlow(v, book) {
        if (!v.pk.onRiser || !book || !v.pk.vpv) return { Q: 0, sys: null };
        var sys = Systems.find(book, v.pk.vpv);
        if (!sys || sys.kind !== 'vpv') return { Q: 0, sys: null };
        var r = Vpv.solve(sys.vpv);
        return { Q: r.ok ? r.dict.Q : 0, sys: sys };
    }

    /**
        Напор общей насосной: если система входит в насосную с другими, насос
        подбирается по наибольшему требуемому напору, и у этажей давление выше
        собственного расчётного — по нему и считаются излишки и диафрагмы.

        Признак raw ставит Stations.demand, когда спрашивает собственное
        требование системы: иначе расчёт звал бы насосную по кругу.
    */
    function stationApplied(v, book, raw) {
        if (raw || !book || !Array.isArray(book.stations) || !book.stations.length) return null;
        if (!v.dia || v.dia.station === false) return null;

        var sys = null;
        book.systems.forEach(function (s) { if (s.floors === v) sys = s; });
        if (!sys) return null;

        var st = Stations.stationOf(book, sys.id);
        if (!st) return null;

        var need = Stations.need(book, st);
        return { station: st, need: need, H: need.H, by: need.dict ? need.dict.sys : null };
    }

    function solve(v, book, raw) {
        var res = { ok: false, errors: [], warnings: [], floors: [], plans: {}, dict: null, pumpHead: 0 };
        var inlet = v.inlet;
        var riser = pipeOf(v.riser);
        var main = pipeOf(v.main);
        var xi = inlet.cuXi > 0 ? inlet.cuXi : Catalog.cuXi(inlet.cuKind, inlet.cuDn);
        var vpv = vpvFlow(v, book);

        res.riser = riser;
        res.main = main;
        res.xi = xi;
        res.vpv = vpv;

        if (v.pk.onRiser && !vpv.sys) {
            res.warnings.push('Отмечено «ПК на стояке АПТ», но система ВПВ не выбрана — расход кранов в стояк не добавлен.');
        }
        if (!(xi > 0)) res.warnings.push('Для узла управления ' + inlet.cuKind + ' Ду' + inlet.cuDn + ' нет ξ — впишите вручную.');

        v.plans.forEach(function (p) { res.plans[p.id] = solvePlan(p); });

        v.sections.forEach(function (sec) {
            Vpv.floorsOf(sec).sort(function (a, b) { return b.elev - a.elev; }).forEach(function (f) {
                var plan = planFor(v, sec, f.n);
                var rec = { section: sec, floor: f, plan: plan, ok: false };
                res.floors.push(rec);
                if (!plan) return;

                var ps = res.plans[plan.id];
                if (!ps.ok) {
                    rec.errors = ps.errors;
                    return;
                }

                rec.ok = true;
                rec.Q = ps.Q;
                rec.Qr = ps.Q + vpv.Q;
                rec.zSpr = f.elev + v.sprinklerHeight;
                rec.Lr = Math.max(0, rec.zSpr - v.baseElev);
                rec.dHr = loss(rec.Qr, rec.Lr, riser.kt);
                rec.dHm = loss(rec.Qr, sec.mainLen, main.kt);
                rec.HplanRaw = ps.HnetRaw;
                rec.Hfree = ps.Hfree;
                rec.netRaw = ps.HnetRaw + rec.dHr + rec.dHm;
                rec.Hnet = rec.netRaw * inlet.localFactor;
                rec.Hcu = 1000 * xi * (rec.Qr * 3.6) * (rec.Qr * 3.6);
                rec.Hgeom = rec.zSpr - inlet.elev;
                rec.Htr = rec.Hgeom + inlet.stationLoss + rec.Hnet + rec.Hcu + rec.Hfree + v.floorNodeLoss + inlet.suction;
                rec.Hp = rec.Htr - inlet.guaranteed;
                rec.Vr = Solver.velocity(rec.Qr, riser.dIn);
                rec.Vm = Solver.velocity(rec.Qr, main.dIn);

                if (!res.dict || rec.Htr > res.dict.Htr) res.dict = rec;
            });
        });

        var planErrors = {};
        res.floors.forEach(function (rec) {
            if (rec.plan && !rec.ok && !planErrors[rec.plan.id]) {
                planErrors[rec.plan.id] = true;
                res.warnings.push('План «' + rec.plan.name + '»: ' + rec.errors.join(' '));
            }
        });

        if (!res.dict) {
            res.errors.push(v.plans.length
                ? 'Ни один этаж не считается: проверьте планы этажей и диапазоны этажей.'
                : 'Добавьте план этажа — без него считать нечего.');
            return res;
        }

        var empty = res.floors.filter(function (r) { return !r.plan; }).length;
        if (empty) res.warnings.push('Этажей без плана АПТ: ' + empty + ' — на схеме они без отростков.');

        var d = res.dict;
        if (d.Vr > 10) res.warnings.push('Скорость в стояке ' + Fmt.num(d.Vr, 2) + ' м/с больше 10 м/с — увеличьте Ду стояка.');
        if (d.Vm > 10) res.warnings.push('Скорость в магистрали ' + Fmt.num(d.Vm, 2) + ' м/с больше 10 м/с — увеличьте Ду.');

        res.pumpHead = Math.max(0, d.Hp);
        res.appliedHead = res.pumpHead;

        var st = stationApplied(v, book, raw);
        if (st && st.H > res.pumpHead + 1e-9) {
            res.appliedHead = st.H;
            res.station = { name: st.station.name, H: st.H, by: st.by ? st.by.code : '' };
            res.warnings.push('Насосная «' + st.station.name + '»: напор ' + Fmt.num(st.H, 2) + ' м'
                + (st.by ? ' задаёт ' + st.by.code : '') + ', это больше собственного ' + Fmt.num(res.pumpHead, 2)
                + ' м — давления у этажей и диафрагмы посчитаны по напору насосной.');
        }

        // Давление у врезки этажа при работе насоса на расчётный расход этажа:
        // сколько останется сверх нужного сети этажа.
        var supply = inlet.guaranteed + res.appliedHead - inlet.stationLoss - inlet.suction;
        res.floors.forEach(function (rec) {
            if (!rec.ok) return;
            var atFloor = supply - rec.Hcu - (rec.dHr + rec.dHm) * inlet.localFactor - v.floorNodeLoss - rec.Hgeom;
            rec.excess = atFloor - (rec.Hfree + rec.HplanRaw * inlet.localFactor);
        });

        res.ok = true;
        pickDiaphragms(v, res, riser);

        var short = res.floors.filter(function (rec) { return rec.dia && rec.dia.ok && rec.after < rec.required - 1e-6; }).length;
        if (short) {
            res.warnings.push('На ' + short + ' этажах шайба срезает ниже нужного сети этажа — возьмите шаг диаметра мельче '
                + 'или округление «не срезать лишнего».');
        }

        if (res.dia.floors) {
            res.warnings.push('Подобраны диафрагмы на ' + res.dia.floors + ' этажах: лишний напор у врезки срезается'
                + (v.dia.mode === 'fixed' ? ' до ' + Fmt.num(v.dia.target, 2) + ' м.' : ' до нужного сети этажа'
                    + (v.dia.margin ? ' с запасом ' + Fmt.num(v.dia.margin, 2) + ' м.' : '.')));
        }

        return res;
    }

    /**
        Продолжение расчёта плана этажа: от врезки в стояк до ввода.

        План этажа считается сам по себе и заканчивается на точке «Ввод» — это
        врезка в стояк. Чтобы расчёт был сквозным, к строкам плана добавляются
        участки стояка и магистрали с тем же расходом и напором, накопленным от
        диктующего оросителя. Используется в таблице приложения и на вкладке
        «Стояк» в редакторе плана.

        Этаж берётся тот, где этот план диктует: из этажей с этим планом — с
        наибольшим Нтр.
    */
    function chain(v, res, planId) {
        if (!res.ok) return null;

        var best = null;
        res.floors.forEach(function (rec) {
            if (!rec.ok || !rec.plan || String(rec.plan.id) !== String(planId)) return;
            if (!best || rec.Htr > best.Htr) best = rec;
        });
        if (!best) return null;

        function seg(name, q, len, pipe, H) {
            return {
                type: 'seg', name: name, H: H, kt: pipe.kt, k: null, Q: q,
                dn: pipe.dn, od: pipe.od, wall: pipe.wall, material: pipe.material,
                V: Solver.velocity(q, pipe.dIn), L: len, dH: loss(q, len, pipe.kt)
            };
        }

        var atTee = best.Hfree + best.HplanRaw;
        var rows = [
            seg('врезка — низ стояка', best.Qr, best.Lr, res.riser, atTee),
            seg('стояк — насосная', best.Qr, best.section.mainLen, res.main, atTee + best.dHr)
        ];

        return {
            rec: best,
            rows: rows,
            atTee: atTee,
            atPump: atTee + best.dHr + best.dHm,
            sumRaw: best.netRaw,
            riser: res.riser,
            main: res.main,
            xi: res.xi,
            pumpHead: res.pumpHead
        };
    }

    return {
        chain: chain,
        create: create,
        normalize: normalize,
        addSection: addSection,
        addPlan: addPlan,
        findPlan: findPlan,
        planFor: planFor,
        pipeOf: pipeOf,
        solvePlan: solvePlan,
        branchDIn: branchDIn,
        solve: solve
    };
})();
