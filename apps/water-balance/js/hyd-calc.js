/*
    Гидравлический расчёт ХВС и ГВС по участкам и напор насосных установок.

    Порядок: модель → развёртка стояков → сеть из графа холста (HydNet) → расход
    каждого участка (HydFlow.aggregate) → диаметр и потери → счётчики →
    диктующий прибор каждой системы → напор насоса.

    Напор насосной установки — формула образца ИОС2 (приложения «Расчёт напоров»):
        Hp = Hgeom + ΣHl,tot + Hпр − Hгар
        ΣHl,tot = ΣHl + ΣHм + Hнс + Hитп + Hв + Hсч+ф
        ΣHl  = Hl кв + Hl ст + Hl маг;   ΣHм = Hмест (Kl·ΣHl) + Hсч кв+ф + Hсч+ф секц + Hрег
    Циркуляция Т4 в Hтр ГВС не входит — расчёт её даст отдельным этапом.

    Стояк считается одним диаметром на всю высоту: он подбирается по расходу
    нижнего звена, у остальных звеньев — тот же размер, а потери берутся по их
    собственным расходам.
*/

var HydCalc = (function () {
    'use strict';

    var CLASS_VMAX = { mains: 'mains', riser: 'risers', apartment: 'apartment', input: 'input' };

    /* Настройки подбора счётчика: общие для проекта, метод потерь — свой у узла, если задан. */
    function meterOpts(survey, node) {
        var m = survey.meter;
        return { limitVane: m.limitVane, limitTurbine: m.limitTurbine, cls: m.cls, pulse: m.pulse, method: node && node.method ? node.method : m.method };
    }

    /* Квартирные счётчики подбираются автоматически и кэшируются по расходу. */
    function pickMeter(cache, survey, q, hot) {
        var key = (hot ? 'h' : 'c') + q.toFixed(4);
        if (cache[key]) return cache[key];

        var opts = meterOpts(survey);
        var m = null;

        // квартирный счётчик — Ду 15 с заданным Qn (1,5); если расход вне его диапазона — подбор по расходу
        if (survey.meter.aptQn > 0) {
            var fixed = HydMeter.pick(q, hot, opts, { chosen: { dn: 15, kind: 'vane', variant: HydMeter.vaneVariant(survey.meter.aptQn) } });
            if (fixed && fixed.c && fixed.c.flowOk && fixed.c.hasLoss) m = fixed;
        }

        cache[key] = m || HydMeter.pick(q, hot, opts);
        return cache[key];
    }

    /* Водомерный узел на схеме: расход из сети (или заданный), выбранный вручную калибр. */
    function pickNodeMeter(hyd, node, q, hot) {
        var qUsed = node && node.qOver > 0 ? node.qOver : q;
        var m = HydMeter.pick(qUsed, hot, meterOpts(hyd.survey, node), node ? { kind: node.kindFilter, chosen: node.chosen } : null);
        return { m: m, q: qUsed };
    }

    /* Диаметр, скорость, потери участка. forced — размер, унаследованный от цепочки стояка. */
    function sizeSegment(hyd, s, nu, q, forced) {
        var survey = hyd.survey;
        var matKey = survey.materials[s.pipe];
        var vmax = survey.vmax[CLASS_VMAX[s.cls] || 'mains'];
        var key = s.sizeKey || s.id;
        var over = hyd.pipes[key];
        var size = forced || null;
        var ok = true;

        if (over) {
            size = HydData.find(over.material, over.od, over.wall);
            matKey = over.material;
        }

        if (!size) {
            var pick = HydFlow.pickSize(matKey, q, vmax, nu, s.cls === 'apartment' ? 15 : 0);
            size = pick.size;
            ok = pick.ok;
        }

        var fr = HydFlow.friction(q, HydFlow.designMm(size), size.material, nu);

        return {
            size: size, material: size.material, label: size.label, dn: size.dn, v: fr.v, iMm: fr.iMm,
            h: fr.i * s.L, vmax: vmax, ok: ok && fr.v <= vmax + 1e-9, manual: !!over
        };
    }

    function emptyResult(hyd, ex, net, warnings) {
        return {
            method: hyd.method, ex: ex, net: net, segs: net.segs, systems: [], warnings: warnings,
            people: ex.people, input: null, marks: net.marks
        };
    }

    /* Нижний и верхний приборы по списку листьев: отметка и подпись. */
    function spanOf(leaves) {
        var low = null;
        var high = null;
        (leaves || []).forEach(function (lf) {
            if (!isFinite(lf.elev)) return;
            if (!low || lf.elev < low.elev) low = lf;
            if (!high || lf.elev > high.elev) high = lf;
        });
        return { low: low, high: high };
    }

    function run(hyd, node) {
        var survey = hyd.survey;
        var ex = HydModel.expand(hyd);
        var net = HydNet.build(hyd, ex);
        var warnings = net.warnings.slice();
        var cache = {};
        var fixtures = hyd.method === 'fixtures';
        var result = emptyResult(hyd, ex, net, warnings);

        var root = hyd.canvas.nodes.filter(function (n) { return n.kind === 'input'; })[0];

        if (!root || !net.segs.length) return result;

        // P способа «по приборам»: на систему (за насосом) и на всю установку (общие участки выше насосов)
        var sysP = {};

        if (fixtures) {
            var plant = new Set();
            net.systems.forEach(function (sys) {
                sysP[sys.id] = {};
                ['total', 'cold', 'hot'].forEach(function (ch) { sysP[sys.id][ch] = HydFlow.aggregate(sys.groups, ch, { node: node }).P; });
                sys.groups.forEach(function (g) { plant.add(g); });
            });
            var all = Array.from(plant);
            sysP[''] = {};
            ['total', 'cold', 'hot'].forEach(function (ch) { sysP[''][ch] = HydFlow.aggregate(all, ch, { node: node }).P; });
        }

        var chainSize = {};

        net.segs.forEach(function (s) {
            // Длина, исправленная вручную, перекрывает рисунок.
            if (hyd.lengths && hyd.lengths[s.id] >= 0) { s.Lauto = s.L; s.L = hyd.lengths[s.id]; s.Lmanual = true; }

            var fixedP = fixtures && sysP[s.sys] ? sysP[s.sys][s.ch] : 0;
            var agg = HydFlow.aggregate(s.groups, s.ch, { node: node, fixedP: fixedP });
            var nu = s.net === 'h' && s.kind !== 'itpdev' ? survey.nu.hot : survey.nu.cold;
            var sz = null;

            if (s.kind === 'input') {
                var size = HydData.find(root.material, root.od, root.wall);
                var fr = HydFlow.friction(agg.q, HydFlow.designMm(size), size.material, nu);
                sz = {
                    size: size, material: size.material, label: size.label, dn: size.dn, v: fr.v, iMm: fr.iMm,
                    h: fr.i * s.L, vmax: survey.vmax.input, ok: fr.v <= survey.vmax.input + 1e-9, manual: true
                };
            } else if (agg.q > 0 && s.cls !== 'device') {
                sz = sizeSegment(hyd, s, nu, agg.q, s.chain ? chainSize[s.chain] : null);
                if (s.chain && !chainSize[s.chain]) chainSize[s.chain] = sz.size;
            }

            s.res = {
                q: agg.q, N: agg.N, U: agg.U, P: agg.P, alpha: agg.alpha, table: agg.table, q0: agg.q0,
                size: sz, meter: null
            };

            if (s.meter && agg.q > 0) {
                var hot = s.net === 'h';
                var m;
                var qUsed = agg.q;

                if (s.dev === 'meter') {
                    var pn = pickNodeMeter(hyd, HydModel.nodeById(hyd, s.node), agg.q, hot);
                    m = pn.m;
                    qUsed = pn.q;
                } else {
                    m = pickMeter(cache, survey, agg.q, hot);
                }

                s.res.meter = { pick: m, mark: m ? m.mark : '', h: m && m.c ? m.h + survey.hFilter : 0, ok: !!(m && m.ok), role: s.meter, q: qUsed, manual: !!(m && m.manual) };
            }

            if (sz && !sz.ok && s.kind !== 'outlet') {
                warnings.push(s.name + ' (' + (s.net === 'c' ? 'ХВС' : 'ГВС') + ', ' + s.id + '): скорость '
                    + Format.num(sz.v) + ' м/с выше допустимой ' + Format.num(sz.vmax) + ' м/с'
                    + (sz.manual ? ' при заданном вручную диаметре' : ' — нет подходящего диаметра в ряду') + '.');
            }
        });

        var inSeg = net.byId['c|in'];
        var mainMeter = null;

        net.segs.forEach(function (s) {
            if (!mainMeter && s.net === 'c' && s.dev === 'meter' && s.meter === 'main' && s.res.meter) mainMeter = s.res.meter;
        });

        result.input = {
            input: root, q: inSeg.res.q, N: inSeg.res.N, U: inSeg.res.U, P: inSeg.res.P, size: inSeg.res.size.size,
            v: inSeg.res.size.v, iMm: inSeg.res.size.iMm, h: inSeg.res.size.h,
            meter: mainMeter ? mainMeter.pick : null, hMeter: mainMeter ? mainMeter.h : 0,
            vmax: survey.vmax.input, ok: inSeg.res.size.ok
        };

        if (!result.input.ok) {
            warnings.push('Ввод ' + inSeg.res.size.label + ': скорость ' + Format.num(inSeg.res.size.v) + ' м/с выше допустимой '
                + Format.num(survey.vmax.input) + ' м/с.');
        }

        if (!(inSeg.res.q > 0)) {
            warnings.push('Нагрузки нет: ни одной квартиры или встроенного помещения с людьми, подключённых к вводу.');
        }

        net.systems.forEach(function (sys) {
            result.systems.push(calcSystem(hyd, sys, net, root, node, warnings));
        });

        pressures(hyd, net, result, root);
        heads(hyd, net, result, root);

        result.systems.forEach(function (sys) { sys.span = spanOf(sys.leaves); });

        result.systems.forEach(function (sys) {
            if (sys.dict) sys.route = HydRoute.build(hyd, net, sys.dict, root);
        });

        if (fixtures) {
            var noFix = 0;
            ex.outlets.forEach(function (it) { if (!(it.N > 0)) noFix++; });
            if (noFix) {
                warnings.push('Способ «по приборам»: у ' + noFix + ' выходов нет приборов — для них приборов принято столько же, сколько людей.');
            }
        }

        return result;
    }

    function nodeElev(hyd, n) {
        if (!n) return hyd.survey.pumpElev;
        if (n.kind === 'input' || n.kind === 'pump' || n.kind === 'buildin') return n.elev;
        if (n.kind === 'riser') return n.baseElev;
        return hyd.survey.pumpElev;
    }

    /*
        Напор в начале и в конце каждого участка (hd): отметка пьезометрической линии
        начинается с Hгар на вводе, падает на потери (по длине с Kl, счётчики, ИТП, ввод)
        и растёт на напор насоса (за вычетом потерь в самой насосной). Напор в точке —
        пьезометр минус отметка точки. Статический — то же без потерь, с полным напором насосов.
    */
    function heads(hyd, net, result, root) {
        var survey = hyd.survey;
        var byId = net.byId;
        var pumps = {};
        result.systems.forEach(function (s) { pumps[s.id] = s; });
        var start = root.Hgar + root.elev;
        var piez = {};

        function endElev(s) {
            if (s.kind === 'input') return root.elev;
            if (s.kind === 'riser') return s.meta.elevHigh;
            if (s.kind === 'fbranch') return s.meta.collElev;
            if (s.kind === 'outlet') return s.meta.elev;
            if (s.kind === 'itpdev') return survey.pumpElev;
            return nodeElev(hyd, s.node ? HydModel.nodeById(hyd, s.node) : null);
        }

        net.segs.forEach(function (s) {
            var inn = s.parent ? piez[s.parent] : { dyn: start, stat: start };
            var elevStart = s.parent ? byId[s.parent].res.elevEnd : root.elev;
            var elevEnd = endElev(s);
            var fr = s.res.size ? s.res.size.h : 0;
            var loss = 0;
            var add = 0;
            var addStat = 0;

            if (s.kind === 'input') {
                loss = fr * (1 + survey.kl) + root.hv;
            } else if (s.kind === 'itpdev') {
                loss = survey.hItp;
            } else if (s.cls === 'device') {
                if (s.dev === 'meter' && s.res.meter) loss = s.res.meter.h;
                else if (s.dev === 'pump' && s.net === 'c') {
                    var ps = pumps[s.node];
                    var hp = ps && ps.pump ? ps.pump.hp : 0;
                    add = hp - survey.hNs;
                    addStat = hp;
                }
            } else {
                loss = fr * (1 + survey.kl) + (s.meter === 'apt' && s.res.meter ? s.res.meter.h : 0);
            }

            var out = { dyn: inn.dyn - loss + add, stat: inn.stat + addStat };
            piez[s.id] = out;
            s.res.elevEnd = elevEnd;
            s.res.hd = { inDyn: inn.dyn - elevStart, outDyn: out.dyn - elevEnd, inStat: inn.stat - elevStart, outStat: out.stat - elevEnd };
        });
    }

    /*
        Напор у коллекторного узла каждого этажа: при расчётном расходе (dyn) и без
        расхода (stat). От Hгар + Hp вычитается подъём до оси коллектора и потери
        по пути от ввода до отвода на этаж (по длине с Kl, счётчики, насос, ИТП, ввод).
    */
    function pressures(hyd, net, result, root) {
        var survey = hyd.survey;
        var byId = net.byId;
        var pumps = {};
        result.systems.forEach(function (s) { pumps[s.id] = s; });

        net.segs.forEach(function (s) {
            if (s.kind !== 'fbranch') return;

            var pumped = s.sys !== '' && pumps[s.sys] && pumps[s.sys].pump;
            var hp = pumped ? pumps[s.sys].pump.hp : 0;
            var ref = pumped ? pumps[s.sys].node.elev : root.elev;
            var sumL = 0;
            var extra = root.hv;
            var q = byId[s.parent];

            while (q) {
                if (q.res.size) sumL += q.res.size.h;
                if (q.dev === 'pump' && q.net === 'c') extra += survey.hNs;
                if (q.kind === 'itpdev') extra += survey.hItp;
                if (q.res.meter && q.meter !== 'apt') extra += q.res.meter.h;
                q = q.parent ? byId[q.parent] : null;
            }

            var head = root.Hgar + hp - (s.meta.collElev - ref);
            s.res.press = { dyn: head - (sumL * (1 + survey.kl) + extra), stat: head };
        });
    }

    function calcSystem(hyd, sys, net, root, node, warnings) {
        var survey = hyd.survey;
        var byId = net.byId;
        var pumped = sys.kind === 'pump';
        var refElev = pumped ? sys.node.elev : root.elev;
        var hgar = root.Hgar;

        var res = {
            id: sys.id, name: sys.name, kind: sys.kind, node: sys.node, segs: sys.segs, leaves: sys.leaves,
            groups: sys.groups, pump: null, dict: null, q: 0
        };

        if (pumped) {
            var pd = byId['c|dev:' + sys.id];
            res.q = pd ? pd.res.q : 0;
        } else {
            res.q = HydFlow.aggregate(sys.groups, 'total', { node: node }).q;
        }

        function pathOf(leaf) {
            var list = [];
            var s = byId[leaf.seg];
            while (s) {
                list.push(s);
                s = s.parent ? byId[s.parent] : null;
            }
            return list.reverse();
        }

        /* Составляющие напора для прибора; reg — стоит ли регулятор квартиры. */
        function head(leaf, reg) {
            var path = pathOf(leaf);
            var part = {
                geom: leaf.elev - refElev, lApt: 0, lRiser: 0, lMains: 0,
                mApt: 0, mSec: 0, reg: reg ? survey.hReg : 0, ns: 0,
                itp: 0, hv: root.hv, main: 0, pr: survey.hPr, path: path
            };

            path.forEach(function (s) {
                var h = s.res.size ? s.res.size.h : 0;

                if (s.cls === 'apartment') part.lApt += h;
                else if (s.cls === 'riser') part.lRiser += h;
                else part.lMains += h;

                if (s.dev === 'pump' && s.net === 'c') part.ns = survey.hNs;
                if (s.kind === 'itpdev') part.itp = survey.hItp;

                if (s.res.meter) {
                    if (s.meter === 'apt') part.mApt += s.res.meter.h;
                    else if (s.meter === 'main') part.main += s.res.meter.h;
                    else part.mSec += s.res.meter.h;
                }
            });

            part.sumL = part.lApt + part.lRiser + part.lMains;
            part.local = survey.kl * part.sumL;
            part.metersAll = part.mApt + part.mSec;
            part.tot = part.sumL + part.local + part.mApt + part.mSec + part.main + part.reg + part.ns + part.itp + part.hv;
            part.req = part.geom + part.tot + part.pr;

            return part;
        }

        var leaves = sys.leaves;
        var best = null;

        leaves.forEach(function (lf) {
            var p = head(lf, false);
            if (!best || p.req > best.req) best = p;
        });

        if (!best) return res;

        var hp0 = pumped ? Math.max(0, best.req - hgar) : 0;
        var regs = {};

        leaves.forEach(function (lf) {
            var s = byId[lf.seg];
            if (s.kind !== 'outlet') return;
            var stat = hgar + hp0 - (lf.elev - refElev);
            lf.static = stat;

            if (survey.regulators === 'all') regs[lf.seg] = true;
            else if (survey.regulators === 'auto' && stat > survey.staticLimit) regs[lf.seg] = true;
        });

        var dict = null;

        leaves.forEach(function (lf) {
            var p = head(lf, !!regs[lf.seg]);
            lf.part = p;
            if (!dict || p.req > dict.part.req) dict = { leaf: lf, part: p };
        });

        var hp = pumped ? Math.max(0, dict.part.req - hgar) : 0;

        leaves.forEach(function (lf) {
            lf.static = hgar + hp - (lf.elev - refElev);
            lf.reg = !!regs[lf.seg];
        });

        var lowest = leaves.reduce(function (a, b) { return !a || b.elev < a.elev ? b : a; }, null);
        var maxStatic = lowest ? lowest.static : 0;

        res.dict = dict;

        res.pump = {
            needed: pumped && hp > 0.05,
            pumped: pumped,
            q: res.q,
            qM3h: res.q * 3.6,
            hp: hp,
            hgar: hgar,
            req: dict.part.req,
            maxStatic: maxStatic,
            regs: Object.keys(regs).length,
            available: hgar
        };

        if (!pumped) {
            res.pump.deficit = Math.max(0, dict.part.req - hgar);
            if (res.pump.deficit > 0.05) {
                warnings.push(sys.name + ': от городской сети не хватает напора ' + Format.num(res.pump.deficit)
                    + ' м (нужно ' + Format.num(dict.part.req) + ' м при гарантированном ' + Format.num(hgar) + ' м) — потребуется насос.');
            }
        } else if (!res.pump.needed) {
            warnings.push(sys.name + ': гарантированного напора хватает, повысительный насос не требуется.');
        }

        if (survey.regulators === 'none' && maxStatic > survey.zoneLimit) {
            warnings.push(sys.name + ': статический напор у нижнего прибора ' + Format.num(maxStatic)
                + ' м выше предела ' + Format.num(survey.zoneLimit) + ' м, а регуляторы давления отключены.');
        } else if (maxStatic > survey.staticLimit && survey.regulators === 'none') {
            warnings.push(sys.name + ': статика у нижнего прибора выше 45 м (п. 8.22) — нужен регулятор давления.');
        }

        return res;
    }

    return { run: run, meterOpts: meterOpts, spanOf: spanOf };
})();
