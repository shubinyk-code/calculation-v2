'use strict';

/*
    Внутренний противопожарный водопровод: стояки с пожарными кранами.

    Методика — как в рабочем калькуляторе «Приложение 4,5 - ВПВ»:

        Нр    = Нтр − Нгар
        Нтр   = Нgeom + ΣНl,tot + Hпр
        ΣНl,tot = ΣНl + ΣНм + ННС + Нв
        ΣНl   = ΣНl подв + ΣНl ст + ΣНl маг,   ΣНм = ΣНl · 0,1

    Потери по длине — по Дарси–Вейсбаху, а не через Kт (Kт остаётся за АПТ):

        h  = λ · L/dр · V²/(2g),   Re = V·dр/ν,   dр = d − запас
        λ по Шевелеву (неновые        V ≥ 1,2 м/с: 0,021 / dр^0,3
        стальные трубы, dр в м)       V < 1,2 м/с: 0,0179 / dр^0,3 · (1 + 0,867/V)^0,3
        λ по Альтшулю                 0,11 · (Δ/dр + 68/Re)^0,25
        λ по Колбруку–Уайту (явная
        запись Свами–Джейна)          0,25 / lg²(Δ/(3,7·dр) + 5,74/Re^0,9)

    Трубы не новые: расчётный диаметр dр меньше фактического на запас под
    отложения (1 мм по умолчанию), по нему же считаются V и Re. Формулы
    Шевелева в виде 1000i = 1,07·V²/dр^1,3 — это те же таблицы Шевелева.

    Все формулы явные, поэтому в выгрузке .xlsx они остаются формулами.

    Расход по умолчанию условный: число струй × q по табл. 7.3 (2 × 2,9 =
    5,8 л/с). Число струй задаётся отдельно для стояка и для магистрали:
    стояк на 2 струи, магистраль в подвале на 3; или стояк на 1, магистраль
    на 2 (вторая струя — с соседнего стояка). Признак «рост расхода нижних
    ПК» включает уточнение по п. 7.6 СП 10.13130: ПК этажом ниже стоит под
    бо́льшим напором и даёт q = k·√P, k = q₁/√Hпр.

    Давление у каждого ПК при работе насоса считается, чтобы найти этажи,
    где нужны диафрагмы (больше 0,45 МПа, п. 7.5), а гидростатика у нижнего
    ПК сравнивается с пределом (0,9 МПа по п. 6.2.20, либо 60 м по СТУ).

    Напоры — м вод. ст., расходы — л/с, длины — м, Δ — мм, ν — 10⁻⁶ м²/с.
*/

var Vpv = (function () {

    var G = 9.81;

    /*
        СП 10.13130.2020 табл. 7.3 (с Изм. 1). Строка:
        [DN клапана, компактная струя м, спрыск мм, расход л/с,
         давление МПа при рукаве 10 м, 15 м, 20 м]
    */
    var T73 = [
        [50, 6, 16, 2.6, 0.092, 0.096, 0.100], [50, 6, 19, 3.4, 0.088, 0.096, 0.104],
        [50, 8, 16, 2.9, 0.120, 0.125, 0.130], [50, 8, 19, 4.1, 0.129, 0.138, 0.148],
        [50, 10, 16, 3.3, 0.151, 0.157, 0.164], [50, 10, 19, 4.6, 0.160, 0.173, 0.185],
        [50, 12, 13, 2.6, 0.202, 0.206, 0.210], [50, 12, 16, 3.7, 0.192, 0.196, 0.210], [50, 12, 19, 5.2, 0.206, 0.223, 0.240],
        [50, 14, 13, 2.8, 0.236, 0.241, 0.245], [50, 14, 16, 4.2, 0.248, 0.255, 0.263],
        [50, 16, 13, 3.2, 0.316, 0.322, 0.328], [50, 16, 16, 4.6, 0.293, 0.300, 0.318],
        [50, 18, 13, 3.6, 0.390, 0.398, 0.406], [50, 18, 16, 5.1, 0.360, 0.380, 0.400],
        [65, 6, 16, 2.6, 0.088, 0.089, 0.090], [65, 6, 19, 3.4, 0.078, 0.080, 0.083],
        [65, 8, 16, 2.9, 0.110, 0.112, 0.114], [65, 8, 19, 4.1, 0.114, 0.117, 0.121],
        [65, 10, 16, 3.3, 0.140, 0.143, 0.146], [65, 10, 19, 4.6, 0.143, 0.147, 0.151],
        [65, 12, 13, 2.6, 0.198, 0.199, 0.201], [65, 12, 16, 3.7, 0.180, 0.183, 0.186], [65, 12, 19, 5.2, 0.182, 0.190, 0.199],
        [65, 14, 13, 2.8, 0.230, 0.231, 0.233], [65, 14, 16, 4.2, 0.230, 0.233, 0.236], [65, 14, 19, 5.7, 0.218, 0.224, 0.230],
        [65, 16, 13, 3.2, 0.310, 0.313, 0.315], [65, 16, 16, 4.6, 0.276, 0.280, 0.284], [65, 16, 19, 6.3, 0.266, 0.273, 0.280],
        [65, 18, 13, 3.6, 0.380, 0.383, 0.385], [65, 18, 16, 5.1, 0.338, 0.342, 0.346], [65, 18, 19, 7.0, 0.329, 0.338, 0.348],
        [65, 20, 13, 4.0, 0.464, 0.467, 0.470], [65, 20, 16, 5.6, 0.412, 0.418, 0.424], [65, 20, 19, 7.5, 0.372, 0.385, 0.397]
    ];

    var FORMULAS = {
        shevelev: 'Шевелева',
        altshul: 'Альтшуля',
        colebrook: 'Колбрука–Уайта'
    };

    /** Расход и давление (м) диктующего ПК по табл. 7.3. */
    function lookup(dn, compact, nozzle, hose) {
        var col = hose <= 10 ? 4 : hose <= 15 ? 5 : 6;
        for (var i = 0; i < T73.length; i++) {
            var r = T73[i];
            if (r[0] === Number(dn) && r[1] === Number(compact) && r[2] === Number(nozzle)) {
                return { q: r[3], p: Math.round(r[col] * 100000) / 1000, found: true };
            }
        }
        return { q: 0, p: 0, found: false };
    }

    /* --- модель ------------------------------------------------------------ */

    function newSection(id, name) {
        return {
            id: id,
            name: name || 'С' + id,
            floorsFrom: 1,
            floorsTo: 12,
            firstElev: 0,
            firstHeight: 3.3,
            floorHeight: 3.0,
            underHeight: 3.3,
            mainLen: 30,
            overrides: {}
        };
    }

    function create() {
        return {
            zone: '1 зона',
            purpose: 'жилая часть',
            airFilled: false,

            pk: {
                dn: 50,
                nozzle: 16,
                hose: 20,
                compact: 8,
                jets: 2,
                mainJets: 2,
                growth: false,
                perFloor: 1,
                qMin: 2.5,
                q: null,
                p: null,
                valveHeight: 1.35
            },

            inlet: {
                guaranteed: 26,
                elev: -3.6,
                inletLoss: 0.5,
                stationLoss: 3,
                localFactor: 0.1,
                pumps: true,
                pumpZero: null
            },

            limits: {
                hydro: 90,
                diaphragm: 45
            },

            // Подбор диафрагм: до какого давления срезаем и шаг изготовления.
            dia: {
                on: true,
                mode: 'fixed',
                target: 45,
                margin: 0,
                step: 1,
                minD: 6,
                round: 'down',
                riser: true,
                station: true
            },

            hydr: {
                formula: 'shevelev',
                nu: 1.31,
                reserve: 1
            },

            branch: { material: 'ГОСТ3262', od: 60, wall: 3, rough: 0.5, len: 1 },
            riser: { material: 'ГОСТ10704', od: 76, wall: 3, rough: 0.5 },
            main: { material: 'ГОСТ10704', od: 108, wall: 4, rough: 0.5 },
            baseElev: -0.5,

            sections: [newSection(1, 'С1')],
            nextSection: 2
        };
    }

    function isObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function merge(target, source) {
        Object.keys(source || {}).forEach(function (key) {
            if (key === 'sections') return;
            if (isObject(source[key]) && isObject(target[key])) merge(target[key], source[key]);
            else if (source[key] !== undefined) target[key] = source[key];
        });
        return target;
    }

    function normalize(data) {
        var v = merge(create(), data || {});
        if (data && Array.isArray(data.sections) && data.sections.length) {
            v.sections = data.sections.map(function (s, i) {
                var sec = merge(newSection(s.id || i + 1, s.name), s);
                sec.overrides = isObject(s.overrides) ? s.overrides : {};
                return sec;
            });
        }

        // В прежних файлах струи задавались одним числом — магистраль на столько же.
        if (!(data && data.pk && data.pk.mainJets > 0)) v.pk.mainJets = v.pk.jets;
        // Данные без запаса к диаметру считались для новых труб — переводим на Шевелева.
        if (!(data && data.hydr && typeof data.hydr.reserve === 'number')) {
            v.hydr.formula = 'shevelev';
            v.hydr.reserve = 1;
            if (v.inlet.stationLoss === 2) v.inlet.stationLoss = 3;
        }
        if (!FORMULAS[v.hydr.formula]) v.hydr.formula = 'shevelev';
        if (!(v.hydr.nu > 0)) v.hydr.nu = 1.31;
        if (!(v.hydr.reserve >= 0)) v.hydr.reserve = 0;

        var maxId = 0;
        v.sections.forEach(function (s) { maxId = Math.max(maxId, s.id); });
        v.nextSection = Math.max(v.nextSection || 1, maxId + 1);
        return v;
    }

    function addSection(v) {
        var last = v.sections[v.sections.length - 1];
        var sec = newSection(v.nextSection++);
        if (last) {
            ['floorsFrom', 'floorsTo', 'firstElev', 'firstHeight', 'floorHeight', 'underHeight'].forEach(function (k) { sec[k] = last[k]; });
            sec.mainLen = last.mainLen + 20;
        }
        v.sections.push(sec);
        return sec;
    }

    /* --- этажи ------------------------------------------------------------- */

    /** Своя отметка этажа, если её вписали руками. */
    function ownElev(sec, n) {
        var o = sec.overrides ? sec.overrides[String(n)] : undefined;
        return typeof o === 'number' && isFinite(o) ? o : null;
    }

    /** Высота этажа n (до следующего): у первого своя, у остальных типовая. */
    function stepUp(sec, n) {
        return n === 1 ? sec.firstHeight : sec.floorHeight;
    }

    /*
        Отметка этажа. Считается не от первого этажа, а от ближайшего заданного
        руками: дом редко бывает ровным — первый этаж выше, второй тоже бывает
        нетиповым, а дальше идёт типовая высота. Вписали отметку третьего —
        четвёртый и выше поднимаются вслед за ним на типовую высоту, пока не
        встретится следующая заданная отметка. Нулевого этажа не бывает.
    */
    function floorElev(sec, n) {
        var own = ownElev(sec, n);
        if (own !== null) return own;

        var elev = sec.firstElev;
        var from = 1;
        var m;

        if (n >= 1) {
            for (m = n - 1; m >= 1; m--) {
                var up = ownElev(sec, m);
                if (up !== null) { elev = up; from = m; break; }
            }
            for (m = from; m < n; m++) elev += stepUp(sec, m);
            return elev;
        }

        // Подземные этажи — вниз от первого или от ближайшего заданного над ним.
        for (m = n + 1; m <= 1; m++) {
            if (m === 0) continue;
            var down = ownElev(sec, m);
            if (down !== null) { elev = down; from = m; break; }
        }
        for (m = from; m > n; m--) {
            if (m === 0) continue;
            elev -= sec.underHeight;
        }
        return elev;
    }

    function floorsOf(sec) {
        var list = [];
        var from = Math.round(Math.min(sec.floorsFrom, sec.floorsTo));
        var to = Math.round(Math.max(sec.floorsFrom, sec.floorsTo));
        for (var n = from; n <= to; n++) {
            if (n === 0) continue;
            list.push({ n: n, label: 'Этаж ' + n, elev: floorElev(sec, n), generated: !(sec.overrides && typeof sec.overrides[String(n)] === 'number') });
        }
        return list;
    }

    /* --- гидравлика -------------------------------------------------------- */

    /** Труба с расчётным диаметром dр = d − запас на отложения, мм. */
    function pipeOf(p, reserve) {
        var info = Catalog.pipe({ material: p.material, od: p.od, wall: p.wall, kt: null });
        return {
            material: p.material,
            od: p.od,
            wall: p.wall,
            dn: info.dn,
            dIn: info.dIn,
            dCalc: info.dIn - (reserve > 0 ? reserve : 0),
            rough: p.rough >= 0 ? p.rough : 0
        };
    }

    /** Коэффициент гидравлического трения; Δ и d — мм, V — м/с. */
    function friction(Re, rough, d, formula, V) {
        if (formula === 'shevelev') {
            var dm = Math.pow(d / 1000, 0.3);
            return V >= 1.2 ? 0.021 / dm : 0.0179 / dm * Math.pow(1 + 0.867 / V, 0.3);
        }
        if (formula === 'colebrook') {
            var lg = Math.log(rough / (3.7 * d) + 5.74 / Math.pow(Re, 0.9)) / Math.LN10;
            return 0.25 / (lg * lg);
        }
        return 0.11 * Math.pow(rough / d + 68 / Re, 0.25);
    }

    /** Потери по длине по Дарси–Вейсбаху. */
    function darcy(q, len, pipe, hydr) {
        var r = { V: 0, Re: 0, lambda: 0, dH: 0 };
        var d = pipe.dCalc / 1000;
        if (!(d > 0) || !(q > 0)) return r;

        r.V = 4 * q / 1000 / (Math.PI * d * d);
        r.Re = r.V * d / (hydr.nu * 1e-6);
        r.lambda = friction(r.Re, pipe.rough, pipe.dCalc, hydr.formula, r.V);
        r.dH = len > 0 ? r.lambda * len / d * r.V * r.V / (2 * G) : 0;
        return r;
    }

    function segment(kind, name, q, len, pipe, hydr) {
        var r = darcy(q, len, pipe, hydr);
        return { kind: kind, name: name, Q: q, L: len, pipe: pipe, dH: r.dH, V: r.V, Re: r.Re, lambda: r.lambda };
    }

    /** Давление у клапана ПК, если в узле стояка напор H: P + h подводки(k·√P) = H. */
    function valvePressure(H, ctx, len) {
        var P = H;
        for (var i = 0; i < 60; i++) {
            var next = H - darcy(ctx.k * Math.sqrt(Math.max(P, 0)), len, ctx.branch, ctx.hydr).dH;
            if (Math.abs(next - P) < 1e-13) return next;
            P = next;
        }
        return P;
    }

    /** Марш от верхнего ПК секции вниз до магистрали и по магистрали до ввода. */
    function march(v, sec, ctx) {
        var floors = floorsOf(sec).sort(function (a, b) { return b.elev - a.elev; });
        if (!floors.length) return null;

        var pk = v.pk;
        var brLen = v.branch.len > 0 ? v.branch.len : 0;
        var per = Math.max(1, Math.round(pk.perFloor));
        var riserJets = Math.max(1, Math.round(pk.jets));
        var mainJets = Math.max(1, Math.round(pk.mainJets > 0 ? pk.mainJets : pk.jets));
        var jetsLeft = riserJets;
        var segs = [];
        var jets = [];
        var Q = 0;
        var H = 0;
        var above = 0;
        var riserLoss = 0;
        var prev = null;

        floors.forEach(function (f, i) {
            f.z = f.elev + pk.valveHeight;

            if (i === 0) {
                var take = Math.min(per, jetsLeft);
                var first = segment('branch', 'Подводка к ПК, ' + f.label, ctx.q1, brLen, ctx.branch, ctx.hydr);
                segs.push(first);
                H = ctx.P1 + first.dH;
                above = first.dH;
                for (var j = 0; j < take; j++) jets.push({ floor: f, P: ctx.P1, q: ctx.q1 });
                Q += ctx.q1 * take;
                jetsLeft -= take;
            } else {
                var dz = prev.z - f.z;
                var rs = segment('riser', prev.label + ' — ' + f.label, Q, dz, ctx.riser, ctx.hydr);
                segs.push(rs);
                H += dz + rs.dH;
                riserLoss += rs.dH;
                above += rs.dH;

                if (jetsLeft > 0) {
                    var takeHere = Math.min(per, jetsLeft);
                    var P = ctx.P1;
                    var q = ctx.q1;
                    if (pk.growth) {
                        P = valvePressure(H, ctx, brLen);
                        q = ctx.k * Math.sqrt(P);
                    }
                    for (var t = 0; t < takeHere; t++) jets.push({ floor: f, P: P, q: q });
                    Q += q * takeHere;
                    jetsLeft -= takeHere;
                }
            }

            f.H = H;
            f.above = above;
            prev = f;
        });

        var Qriser = Q;

        var dzBase = prev.z - v.baseElev;
        if (dzBase > 0) {
            var base = segment('riser', prev.label + ' — магистраль', Qriser, dzBase, ctx.riser, ctx.hydr);
            segs.push(base);
            riserLoss += base.dH;
        }

        // Магистраль: недостающие струи — с соседних стояков, по q диктующего ПК.
        var extra = [];
        var Qmain;
        if (mainJets >= riserJets) {
            for (var e = 0; e < mainJets - riserJets; e++) extra.push({ P: ctx.P1, q: ctx.q1 });
            Qmain = Qriser + extra.length * ctx.q1;
        } else {
            Qmain = Qriser * mainJets / riserJets;
        }

        var mainSeg = segment('main', 'Магистраль до стояка ' + sec.name, Qmain, sec.mainLen, ctx.main, ctx.hydr);
        segs.push(mainSeg);

        var friction = { branch: segs[0].dH, riser: riserLoss, main: mainSeg.dH };
        var sumL = friction.branch + friction.riser + friction.main;
        var Hm = sumL * v.inlet.localFactor;
        var HlTot = sumL + Hm + v.inlet.stationLoss + v.inlet.inletLoss;
        var zTop = floors[0].z;
        var Hgeom = zTop - v.inlet.elev;
        var Htr = Hgeom + HlTot + ctx.P1;

        return {
            section: sec,
            floors: floors,
            segments: segs,
            jets: jets,
            mainExtra: extra,
            jetsMissing: jetsLeft,
            riserJets: riserJets,
            mainJets: mainJets,
            Qriser: Qriser,
            Q: Qmain,
            friction: friction,
            sumL: sumL,
            Hm: Hm,
            HlTot: HlTot,
            Hgeom: Hgeom,
            zTop: zTop,
            topFloor: floors[0],
            Htr: Htr,
            Hp: Htr - v.inlet.guaranteed
        };
    }

    /**
        Подбор диафрагм. У каждого ПК давление срезается до заданного (обычно
        0,45 МПа по п. 7.5) или до требуемого Hпр с запасом; диаметр шайбы
        считается на расход, который ПК даёт уже после среза: q = k·√P.

        Дополнительно на каждый стояк подбирается общая шайба: она срезает то,
        что лишнее у всех его ПК сразу (наименьший излишек), а поэтажные шайбы
        добирают остальное. Общая шайба работает только при протоке — на
        гидростатику в дежурном режиме она не влияет.
    */
    function pickDiaphragms(v, res, ctx) {
        var dia = v.dia;
        res.dia = { need: 0, floors: 0, risers: [] };
        if (!dia || !dia.on) return;

        var opts = { step: dia.step, min: dia.minD, round: dia.round };
        var allowedBase = dia.mode === 'excess' ? res.P1 + (dia.margin || 0) : dia.target;

        if (allowedBase < res.P1 - 1e-9) {
            res.warnings.push('Срезать до ' + Fmt.num(allowedBase, 2) + ' м нельзя: у диктующего ПК требуется '
                + Fmt.num(res.P1, 2) + ' м. Диафрагмы подобраны до требуемого напора.');
            allowedBase = res.P1;
        }

        res.dia.allowed = allowedBase;

        res.marches.forEach(function (m) {
            m.floors.forEach(function (f) {
                f.need = f.P - allowedBase;
                var qAfter = ctx.k * Math.sqrt(allowedBase);
                f.dia = f.need > 0.05 ? Diaphragm.pick(qAfter, f.need, ctx.branch.dIn, opts) : null;
                if (f.dia) f.dia.q = qAfter;
                if (f.dia && f.dia.ok) {
                    f.after = f.P - f.dia.cut;
                    res.dia.floors++;
                }
            });

            var common = Diaphragm.common(m.floors.map(function (f) { return f.need; }));
            m.riserDia = null;

            if (dia.riser && common > 0.05) {
                var pickRiser = Diaphragm.pick(m.Q, common, ctx.riser.dIn, opts);
                if (pickRiser.ok) {
                    m.riserDia = pickRiser;
                    res.dia.risers.push({ section: m.section, pick: pickRiser });
                }
            }
        });

        if (res.dia.floors) {
            res.dia.need = true;
            res.warnings.push('Подобраны диафрагмы у ' + res.dia.floors + ' ПК: срез до ' + Fmt.num(allowedBase, 2)
                + ' м (' + Fmt.trim(allowedBase / 100, 2) + ' МПа).');
        }

        var tooDeep = 0;
        var tooHigh = 0;
        res.marches.forEach(function (m) {
            m.floors.forEach(function (f) {
                if (!f.dia || !f.dia.ok) return;
                if (f.after < res.P1 - 1e-6) tooDeep++;
                else if (f.after > v.limits.diaphragm + 1e-6) tooHigh++;
            });
        });

        if (tooDeep) {
            res.warnings.push('У ' + tooDeep + ' ПК шайба срезает ниже требуемого Hпр ' + Fmt.num(res.P1, 2)
                + ' м — возьмите шаг диаметра мельче или округление «не срезать лишнего».');
        }
        if (tooHigh) {
            res.warnings.push('У ' + tooHigh + ' ПК после шайбы остаётся больше ' + Fmt.trim(v.limits.diaphragm / 100, 2)
                + ' МПа — возьмите шаг мельче или округление «срезать не меньше нужного».');
        }
    }

    /**
        Напор общей насосной. Если система входит в насосную вместе с другими,
        насос подбирается по наибольшему требуемому напору — и у пожарных кранов
        этой системы давление будет выше собственного расчётного. По нему и надо
        считать диафрагмы.

        Система ищется по самим данным (s.vpv === v): Vpv.solve получает только
        их. Stations.need внутри зовёт Vpv.solve уже без книги, поэтому круга не
        возникает.
    */
    function stationApplied(v, book) {
        if (!book || !Array.isArray(book.stations) || !book.stations.length) return null;
        if (!v.dia || v.dia.station === false) return null;

        var sys = null;
        book.systems.forEach(function (s) { if (s.vpv === v) sys = s; });
        if (!sys) return null;

        var st = Stations.stationOf(book, sys.id);
        if (!st) return null;

        var need = Stations.need(book, st);
        return { station: st, need: need, H: need.H, by: need.dict ? need.dict.sys : null };
    }

    function solve(v, book) {
        var res = { ok: false, errors: [], warnings: [], marches: [], dict: null };
        var pk = v.pk;
        var t = lookup(pk.dn, pk.compact, pk.nozzle, pk.hose);
        var q1 = pk.q > 0 ? pk.q : t.q;
        var P1 = pk.p > 0 ? pk.p : t.p;

        res.table = t;
        res.q1 = q1;
        res.P1 = P1;
        res.formulaName = FORMULAS[v.hydr.formula] || FORMULAS.shevelev;

        if (!(q1 > 0 && P1 > 0)) {
            res.errors.push('Сочетания DN ' + pk.dn + ', спрыска ' + pk.nozzle + ' мм и компактной струи ' + pk.compact
                + ' м нет в табл. 7.3 СП 10.13130.2020 — впишите расход и давление у ПК вручную.');
            return res;
        }

        if (!t.found) res.warnings.push('Расход и давление у ПК введены вручную: в табл. 7.3 такого сочетания нет.');
        if (q1 < pk.qMin - 1e-9) {
            res.warnings.push('Расход диктующего ПК ' + Fmt.num(q1, 2) + ' л/с меньше минимального ' + Fmt.num(pk.qMin, 2) + ' л/с по табл. 7.1.');
        }

        var ctx = {
            q1: q1,
            P1: P1,
            k: q1 / Math.sqrt(P1),
            hydr: v.hydr,
            branch: pipeOf(v.branch, v.hydr.reserve),
            riser: pipeOf(v.riser, v.hydr.reserve),
            main: pipeOf(v.main, v.hydr.reserve)
        };

        res.marches = v.sections.map(function (sec) { return march(v, sec, ctx); }).filter(Boolean);
        if (!res.marches.length) {
            res.errors.push('Задайте хотя бы одну секцию с этажами.');
            return res;
        }

        var dict = res.marches[0];
        res.marches.forEach(function (m) { if (m.Htr > dict.Htr) dict = m; });
        res.dict = dict;

        if (dict.jetsMissing > 0) {
            res.warnings.push('В секции ' + dict.section.name + ' пожарных кранов меньше, чем струй на стояке.');
        }
        if (dict.mainJets < dict.riserJets) {
            res.warnings.push('На магистрали струй меньше, чем на стояке: расход магистрали уменьшен пропорционально.');
        }

        var inlet = v.inlet;
        var pumpHead = inlet.pumps ? Math.max(0, dict.Hp) : 0;
        var applied = pumpHead;
        var st = inlet.pumps ? stationApplied(v, book) : null;

        if (st && st.H > pumpHead + 1e-9) {
            applied = st.H;
            res.station = { name: st.station.name, H: st.H, by: st.by ? st.by.code : '' };
            res.warnings.push('Насосная «' + st.station.name + '»: напор ' + Fmt.num(st.H, 2) + ' м'
                + (st.by ? ' задаёт ' + st.by.code : '') + ', это больше собственного ' + Fmt.num(pumpHead, 2)
                + ' м — давления у ПК и диафрагмы посчитаны по напору насосной.');
        }

        var supply = inlet.guaranteed + applied - inlet.inletLoss - inlet.stationLoss;
        var brLoss = darcy(q1, v.branch.len, ctx.branch, v.hydr).dH;

        res.pumpHead = pumpHead;
        res.appliedHead = applied;

        // Давление у каждого ПК при работе насоса на расчётный расход в своей секции.
        var diaphragms = 0;
        res.marches.forEach(function (m) {
            m.floors.forEach(function (f) {
                f.P = supply - (f.z - inlet.elev) - (1 + inlet.localFactor) * (m.sumL - f.above) - brLoss;
                f.diaphragm = f.P > v.limits.diaphragm;
                f.excess = f.P - P1;
                if (f.diaphragm) diaphragms++;
            });
        });

        if (diaphragms) {
            res.warnings.push('Давление больше ' + Fmt.trim(v.limits.diaphragm / 100, 2) + ' МПа у ' + diaphragms
                + ' ПК — между клапаном и головкой нужны диафрагмы или регуляторы (СП 10.13130 п. 7.5).');
        }

        pickDiaphragms(v, res, ctx);

        if (!inlet.pumps && dict.Hp > 0) {
            res.warnings.push('Гарантированного напора не хватает на ' + Fmt.num(dict.Hp, 2) + ' м — нужна насосная установка.');
        }

        // Гидростатика у самого нижнего ПК.
        var low = null;
        res.marches.forEach(function (m) {
            m.floors.forEach(function (f) { if (!low || f.z < low.z) low = f; });
        });

        var staticPump = inlet.pumps ? (inlet.pumpZero > 0 ? inlet.pumpZero : applied) : 0;
        var Hst = inlet.guaranteed + staticPump - (low.z - inlet.elev);
        res.hydro = { floor: low, value: Hst, limit: v.limits.hydro, ok: Hst <= v.limits.hydro + 1e-9 };

        if (!res.hydro.ok) {
            res.warnings.push('Гидростатическое давление у нижнего ПК ' + Fmt.num(Hst, 2) + ' м больше предела ' + v.limits.hydro
                + ' м — нужно деление на зоны или регуляторы давления.');
        }
        if (inlet.pumps && !(inlet.pumpZero > 0)) {
            res.warnings.push('Гидростатика посчитана по напору насоса в рабочей точке; при нулевой подаче он выше — впишите его из паспорта.');
        }

        var n = dict.mainJets;
        res.jetsText = n + 'х' + Fmt.trim(pk.qMin, 2) + ' / (' + n + 'х' + Fmt.trim(q1, 2) + ')';
        res.ok = true;
        return res;
    }

    return {
        T73: T73,
        FORMULAS: FORMULAS,
        lookup: lookup,
        create: create,
        normalize: normalize,
        newSection: newSection,
        addSection: addSection,
        floorElev: floorElev,
        floorsOf: floorsOf,
        pipeOf: pipeOf,
        darcy: darcy,
        solve: solve
    };
})();
